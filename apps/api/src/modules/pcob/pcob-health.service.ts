import { Injectable } from '@nestjs/common';
import { MatchDataSource, MatchStatus } from '@prisma/client';
import { TelemetryPhase } from '../../types/telemetry-phase';
import { PCOB_ADAPTER_KEY } from '../../common/pcob-binding.util';

type HealthRecord = {
  lastTelemetryAt: number;
  avgLatencyMs: number;
  lastRateAt: number;
  windowCount: number;
  eventsPerSec: number;
  clientId?: string | null;
  phase: TelemetryPhase;
  connectionState: 'CONNECTED' | 'DISCONNECTED';
  activityState: 'ACTIVE' | 'IDLE' | 'CONNECTED_NO_DATA';
  feedState: 'PCOB_WAITING' | 'PCOB_CONNECTED' | 'PCOB_LIVE' | 'PCOB_STALE';
  rawEventCount: number;
  authoritySource?: string | null;
  scoringMode?: string | null;
};

export type HealthSnapshot = {
  status: 'ok' | 'stale' | 'down';
  lastTelemetryAt?: number;
  avgLatencyMs?: number;
  eventsPerSec?: number;
  clientId?: string | null;
  phase?: TelemetryPhase;
  connectionState?: HealthRecord['connectionState'];
  activityState?: HealthRecord['activityState'];
  age?: number;
  feedState?: HealthRecord['feedState'];
  rawEventCount?: number;
  authoritySource?: string | null;
  scoringMode?: string | null;
};

@Injectable()
export class PcobHealthService {
  private store = new Map<string, HealthRecord>();
  private activeMs = Number(process.env.PCOB_HEALTH_ACTIVE_MS ?? 30_000);
  private idleMs = Number(process.env.PCOB_HEALTH_IDLE_MS ?? 90_000);
  private feedDownMs = Number(process.env.PCOB_FEED_DOWN_MS ?? 30_000);
  private rateWindowMs = 5000;

  onTelemetry(
    matchId: string,
    clientId: string | null,
    sentAt?: string | number | null,
  ) {
    // backward compatible wrapper; default assumes live PCOB without gameplay signals
    this.onTelemetryWithContext(matchId, clientId, { sentAt });
  }

  onTelemetryWithContext(
    matchId: string,
    clientId: string | null,
    ctx: {
      sentAt?: string | number | null;
      status?: MatchStatus;
      dataSource?: MatchDataSource;
      adapterKey?: string | null;
      gameplay?: boolean;
      authoritative?: boolean;
      authoritySource?: string | null;
      scoringMode?: string | null;
    },
  ) {
    if (!matchId) return;
    const now = Date.now();
    const prev = this.store.get(matchId);
    const rec: HealthRecord = prev
      ? { ...prev }
      : {
          lastTelemetryAt: 0,
          avgLatencyMs: 0,
          lastRateAt: now,
          windowCount: 0,
          eventsPerSec: 0,
          clientId: clientId ?? null,
          phase: TelemetryPhase.OFFLINE,
          connectionState: 'DISCONNECTED',
          activityState: 'CONNECTED_NO_DATA',
          feedState: 'PCOB_WAITING',
          rawEventCount: 0,
          authoritySource: 'MANUAL',
          scoringMode: 'MANUAL_ONLY',
        };
    const prevLast = rec.lastTelemetryAt;
    rec.lastTelemetryAt = now;
    rec.rawEventCount = (rec.rawEventCount ?? 0) + 1;
    if (clientId) rec.clientId = clientId;
    if (ctx.authoritySource) rec.authoritySource = ctx.authoritySource;
    if (ctx.scoringMode) rec.scoringMode = ctx.scoringMode;
    if (ctx.sentAt) {
      const sent =
        typeof ctx.sentAt === 'string'
          ? Date.parse(ctx.sentAt)
          : Number(ctx.sentAt);
      if (Number.isFinite(sent)) {
        const latency = Math.max(0, now - sent);
        rec.avgLatencyMs =
          rec.avgLatencyMs === 0
            ? latency
            : rec.avgLatencyMs * 0.8 + latency * 0.2;
      }
    }
    if (now - rec.lastRateAt >= this.rateWindowMs) {
      rec.eventsPerSec = rec.windowCount / ((now - rec.lastRateAt) / 1000);
      rec.windowCount = 0;
      rec.lastRateAt = now;
    }
    rec.windowCount += 1;
    rec.connectionState = 'CONNECTED';
    const livePcob =
      ctx.status === MatchStatus.LIVE &&
      (ctx.dataSource === MatchDataSource.PCOB ||
        (ctx.dataSource === MatchDataSource.API &&
          ctx.adapterKey === PCOB_ADAPTER_KEY) ||
        (ctx.dataSource as any) === 'AUTO');
    if (!livePcob) {
      rec.phase = TelemetryPhase.OFFLINE;
      rec.connectionState = 'DISCONNECTED';
      rec.activityState = 'CONNECTED_NO_DATA';
      rec.feedState = 'PCOB_WAITING';
      rec.rawEventCount = 0;
      rec.authoritySource = 'MANUAL';
      rec.scoringMode = 'MANUAL_ONLY';
    } else {
      // derive feed state transitions without relying on gameplay until an authoritative event is seen
      const current = rec.feedState;
      if (ctx.authoritative) {
        rec.feedState = 'PCOB_LIVE';
        rec.phase = TelemetryPhase.IN_GAME;
      } else if (current === 'PCOB_STALE') {
        // any telemetry after stale moves back to live
        rec.feedState = 'PCOB_LIVE';
      } else if (current === 'PCOB_LIVE') {
        rec.feedState = 'PCOB_LIVE';
      } else if (current === 'PCOB_CONNECTED' || current === 'PCOB_WAITING') {
        rec.feedState = 'PCOB_CONNECTED';
      } else {
        rec.feedState = 'PCOB_CONNECTED';
      }

      // Phase tracking for UI (non-blocking)
      if (rec.feedState === 'PCOB_LIVE') {
        rec.phase = TelemetryPhase.IN_GAME;
      } else if (prevLast > 0) {
        rec.phase = TelemetryPhase.PRE_GAME;
      } else {
        rec.phase = TelemetryPhase.CONNECTED;
      }

      // Activity state from timing only
      const age = now - rec.lastTelemetryAt;
      if (age <= this.activeMs) {
        rec.activityState = 'ACTIVE';
      } else if (age <= this.idleMs) {
        rec.activityState = 'IDLE';
      } else {
        rec.activityState = 'CONNECTED_NO_DATA';
      }

      // Mark stale after prolonged silence
      const ageSinceLast = now - rec.lastTelemetryAt;
      if (ageSinceLast > this.feedDownMs) {
        rec.feedState = 'PCOB_STALE';
      }
    }
    this.store.set(matchId, rec);
  }

  setClient(matchId: string, clientId: string | null) {
    if (!matchId) return;
    const rec = this.store.get(matchId) ?? {
      lastTelemetryAt: 0,
      avgLatencyMs: 0,
      lastRateAt: Date.now(),
      windowCount: 0,
      eventsPerSec: 0,
      clientId: null,
      phase: TelemetryPhase.OFFLINE,
      connectionState: 'DISCONNECTED',
      activityState: 'CONNECTED_NO_DATA',
      feedState: 'PCOB_WAITING',
      rawEventCount: 0,
    };
    rec.clientId = clientId ?? null;
    rec.connectionState = clientId ? 'CONNECTED' : 'DISCONNECTED';
    rec.feedState = clientId ? 'PCOB_CONNECTED' : 'PCOB_WAITING';
    this.store.set(matchId, rec);
  }

  get(matchId: string): HealthSnapshot {
    if (!matchId) return { status: 'down' as const };
    const rec = this.store.get(matchId);
    if (!rec) return { status: 'down' as const };
    const age = Date.now() - rec.lastTelemetryAt;
    const status = age < 5000 ? 'ok' : age < 15000 ? 'stale' : 'down';
    return {
      status,
      lastTelemetryAt: rec.lastTelemetryAt,
      avgLatencyMs: Math.round(rec.avgLatencyMs),
      eventsPerSec: Number.isFinite(rec.eventsPerSec) ? rec.eventsPerSec : 0,
      clientId: rec.clientId ?? null,
      phase: rec.phase ?? TelemetryPhase.OFFLINE,
      connectionState: rec.connectionState,
      activityState: rec.activityState,
      age,
      feedState: rec.feedState,
      rawEventCount: rec.rawEventCount ?? 0,
      authoritySource: rec.authoritySource ?? null,
      scoringMode: rec.scoringMode ?? null,
    };
  }
}
