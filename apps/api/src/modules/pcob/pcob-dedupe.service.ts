import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';

type CacheEntry = { expiresAt: number };

@Injectable()
export class PcobDedupeService {
  private readonly logger = new Logger('PcobDedupe');
  private cache = new Map<string, CacheEntry>();
  private ttlMs = Number(process.env.PCOB_DEDUPE_TTL_MS || 120_000);
  telemetryEventsProcessed = 0;
  telemetryEventsDeduped = 0;

  computeEventId(
    matchId: string,
    sessionId: string,
    evt: unknown,
  ): string | null {
    if (!matchId || !sessionId || !evt || !isRecord(evt)) return null;
    const eventTypeRaw = stringFrom(evt.eventType) ?? 'UNKNOWN';
    const eventType = eventTypeRaw.toUpperCase();
    const payload = isRecord(evt.payload) ? evt.payload : evt;
    const timestampSource = isRecord(payload) ? payload : {};
    const tsRaw =
      timestampSource.timestamp ??
      timestampSource.ts ??
      timestampSource.time ??
      timestampSource.eventTime ??
      timestampSource.event_time ??
      evt.timestamp;
    const ts = typeof tsRaw === 'number' ? tsRaw : Date.now();

    const killer =
      (isRecord(timestampSource.killer) && timestampSource.killer) ||
      (isRecord(timestampSource.actor) && timestampSource.actor) ||
      (isRecord(timestampSource.attacker) && timestampSource.attacker) ||
      (isRecord(timestampSource.source) && timestampSource.source) ||
      {};
    const victim =
      (isRecord(timestampSource.victim) && timestampSource.victim) ||
      (isRecord(timestampSource.target) && timestampSource.target) ||
      {};

    const killerId =
      stringFrom(killer.pubgAccountId) ??
      stringFrom(killer.pubgPlayerId) ??
      stringFrom(killer.playerId) ??
      stringFrom(killer.id) ??
      stringFrom(killer.ign) ??
      stringFrom(timestampSource.killerId) ??
      stringFrom(timestampSource.attackerId) ??
      'unknown-killer';
    const victimId =
      stringFrom(victim.pubgAccountId) ??
      stringFrom(victim.pubgPlayerId) ??
      stringFrom(victim.playerId) ??
      stringFrom(victim.id) ??
      stringFrom(timestampSource.victimId) ??
      stringFrom(timestampSource.targetPlayerId) ??
      stringFrom(victim.ign) ??
      'unknown-victim';

    const key = `${matchId}|${sessionId}|${eventType}|${killerId}|${victimId}|${ts}`;
    return createHash('sha256').update(key).digest('hex');
  }

  checkAndRemember(
    matchId: string,
    sessionId: string,
    eventId: string,
  ): boolean {
    this.cleanup();
    const key = `${matchId}|${sessionId}|${eventId}`;
    const now = Date.now();
    const existing = this.cache.get(key);
    if (existing && existing.expiresAt > now) {
      this.telemetryEventsDeduped += 1;
      this.logger.debug?.(
        `Deduped event match=${matchId} session=${sessionId} id=${eventId}`,
      );
      return true;
    }
    this.cache.set(key, { expiresAt: now + this.ttlMs });
    this.telemetryEventsProcessed += 1;
    return false;
  }

  private cleanup() {
    const now = Date.now();
    if (this.cache.size === 0) return;
    for (const [key, entry] of this.cache.entries()) {
      if (entry.expiresAt <= now) {
        this.cache.delete(key);
      }
    }
  }
}

const isRecord = (val: unknown): val is Record<string, unknown> =>
  !!val && typeof val === 'object';

const stringFrom = (value: unknown): string | null =>
  typeof value === 'string' ? value : null;
