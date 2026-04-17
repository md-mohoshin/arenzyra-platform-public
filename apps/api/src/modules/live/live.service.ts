import { Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { EventEmitter } from 'events';

type StandingsPayload = Record<string, unknown>;
type Unsubscribe = () => Promise<void>;

@Injectable()
export class LiveService {
  private redis: Redis | null;
  private enabled: boolean;
  private memoryCache: Map<string, string>;
  private emitter: EventEmitter;

  constructor() {
    const url = process.env.REDIS_URL;
    const allowRedis = process.env.ENABLE_REDIS === 'true';
    if (!url || !allowRedis) {
      this.enabled = false;
      this.redis = null;
      this.memoryCache = new Map();
      this.emitter = new EventEmitter();
    } else {
      this.enabled = true;
      this.memoryCache = new Map();
      this.emitter = new EventEmitter();
      this.redis = new Redis(url, {
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
      });

      this.redis.on('error', (err) => {
        const code = (err as NodeJS.ErrnoException)?.code;
        if (code === 'ECONNREFUSED') {
          this.enabled = false;
        }
      });
    }
  }

  private standingsKey(tournamentId: string): string {
    return `arenzyra:tournament:${tournamentId}:standings:latest`;
  }

  private standingsChannel(tournamentId: string): string {
    return `arenzyra:tournament:${tournamentId}:standings`;
  }

  async setLatestStandings(
    tournamentId: string,
    payload: StandingsPayload,
  ): Promise<void> {
    const data = JSON.stringify(payload);
    if (this.enabled && this.redis) {
      await this.redis.set(this.standingsKey(tournamentId), data, 'EX', 120);
      await this.redis.publish(this.standingsChannel(tournamentId), data);
    } else {
      this.memoryCache.set(tournamentId, data);
      this.emitter.emit(this.standingsChannel(tournamentId), data);
    }
  }

  async getLatestStandings(tournamentId: string): Promise<string | null> {
    if (this.enabled && this.redis) {
      return this.redis.get(this.standingsKey(tournamentId));
    }
    return this.memoryCache.get(tournamentId) ?? null;
  }

  async subscribeStandings(
    tournamentId: string,
    onMessage: (msg: string) => void,
  ): Promise<Unsubscribe> {
    const channel = this.standingsChannel(tournamentId);

    if (this.enabled && this.redis) {
      const sub = new Redis(process.env.REDIS_URL!);
      await sub.subscribe(channel);
      const handler = (ch: string, msg: string) => {
        if (ch === channel) onMessage(msg);
      };
      sub.on('message', handler);

      return async () => {
        sub.off('message', handler);
        try {
          await sub.unsubscribe(channel);
        } catch {
          /* ignore unsubscribe errors */
        }
        try {
          sub.disconnect();
        } catch {
          /* ignore disconnect errors */
        }
      };
    }

    const handler = (msg: string) => onMessage(msg);
    this.emitter.on(channel, handler);
    return () => {
      this.emitter.off(channel, handler);
      return Promise.resolve();
    };
  }

  async clearTournament(tournamentId: string): Promise<void> {
    if (this.enabled && this.redis) {
      try {
        await this.redis.del(this.standingsKey(tournamentId));
      } catch {
        /* ignore redis failures during cleanup */
      }
    }
    this.memoryCache.delete(tournamentId);
  }
}
