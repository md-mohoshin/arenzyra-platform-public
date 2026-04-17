import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import Redis from 'ioredis';
import { EventEmitter } from 'events';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  publisher: Redis | null = null;
  subscriber: Redis | null = null;
  private readonly emitter = new EventEmitter();
  private readonly logger = new Logger(RedisService.name);

  getClient(): Redis | null {
    if (this.publisher && this.publisher.status === 'ready')
      return this.publisher;
    return null;
  }

  async publish(channel: string, payload: unknown): Promise<void> {
    if (this.publisher && this.publisher.status === 'ready') {
      await this.publisher.publish(channel, JSON.stringify(payload));
    } else {
      this.emitter.emit(channel, payload);
    }
  }

  async subscribe(
    channel: string,
    handler: (msg: unknown) => void,
  ): Promise<() => void> {
    if (this.subscriber && this.subscriber.status === 'ready') {
      const wrapped = (ch: string, msg: string) => {
        if (ch !== channel) return;
        try {
          handler(JSON.parse(msg));
        } catch {
          handler(msg);
        }
      };
      await this.subscriber.subscribe(channel);
      this.subscriber.on('message', wrapped);
      return () => {
        this.subscriber?.off('message', wrapped);
        try {
          void this.subscriber?.unsubscribe(channel);
        } catch {
          /* ignore */
        }
      };
    }

    this.emitter.on(channel, handler);
    return () => {
      this.emitter.off(channel, handler);
    };
  }

  onModuleInit() {
    const url = process.env.REDIS_URL;
    if (!url) {
      return;
    }
    try {
      this.publisher = new Redis(url);
      this.subscriber = new Redis(url);
      const onError = (err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          `Redis unavailable, falling back to in-memory bus: ${msg}`,
        );
        this.publisher = null;
        this.subscriber = null;
      };
      this.publisher.on('error', onError);
      this.subscriber.on('error', onError);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Failed to initialize Redis, using in-memory only: ${msg}`,
      );
      this.publisher = null;
      this.subscriber = null;
    }
  }

  onModuleDestroy() {
    if (this.publisher) this.publisher.disconnect();
    if (this.subscriber) this.subscriber.disconnect();
  }
}
