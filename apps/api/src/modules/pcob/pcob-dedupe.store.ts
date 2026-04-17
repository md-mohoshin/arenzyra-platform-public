import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../../redis/redis.service';

@Injectable()
export class PcobDedupeStore {
  private readonly logger = new Logger('PcobDedupeStore');
  private ttlSec = Math.floor(
    Number(process.env.PCOB_DEDUPE_TTL_MS || 120_000) / 1000,
  );

  constructor(private readonly redis: RedisService) {}

  async trySet(
    matchId: string,
    sessionId: string,
    eventId: string,
  ): Promise<'redis' | 'memory' | 'duplicate' | 'error'> {
    try {
      const client = this.redis.getClient();
      if (!client) return 'memory';
      const key = `pcob:dedupe:${matchId}:${sessionId}:${eventId}`;
      const res = await client.set(key, '1', 'EX', this.ttlSec, 'NX');
      if (res === null) return 'duplicate';
      return 'redis';
    } catch (err: unknown) {
      this.logger.debug?.(
        `Redis dedupe unavailable: ${err instanceof Error ? err.message : String(err)}`,
      );
      return 'memory';
    }
  }

  async health() {
    try {
      const client = this.redis.getClient();
      if (!client) return { redis: 'down' };
      await client.ping();
      return { redis: 'up' };
    } catch {
      return { redis: 'down' };
    }
  }
}
