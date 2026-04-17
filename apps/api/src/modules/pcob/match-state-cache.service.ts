import { Injectable } from '@nestjs/common';
import { NormalizedMatchState } from '../../types/normalized-match-state';
import { PcobNormalizerService } from './pcob-normalizer.service';

@Injectable()
export class MatchStateCache {
  private cache = new Map<string, NormalizedMatchState>();
  private readonly metaDefaults: MetaState = {};

  constructor(private normalizer: PcobNormalizerService) {}

  get(matchId: string): NormalizedMatchState | undefined {
    return this.cache.get(matchId);
  }

  setState(state: NormalizedMatchState): NormalizedMatchState {
    const existing = this.cache.get(state.matchId);
    const merged = this.mergeState(existing, state);
    this.cache.set(state.matchId, merged);
    return merged;
  }

  updateFromTelemetry(
    rawPayload: TelemetryMetaPayload,
  ): NormalizedMatchState | undefined {
    const normalized = this.normalizer.normalize(rawPayload);
    const matchId = normalized.matchId;
    const existing = this.cache.get(matchId);
    const merged = this.mergeState(existing, normalized);
    const payloadRecord = rawPayload;
    const meta: MetaState = {
      ...(merged.meta ?? this.metaDefaults),
      telemetryPhase:
        typeof payloadRecord.telemetryPhase === 'string'
          ? payloadRecord.telemetryPhase
          : merged.meta?.telemetryPhase,
      lastHeartbeatAt:
        typeof payloadRecord.lastHeartbeatAt === 'number'
          ? payloadRecord.lastHeartbeatAt
          : merged.meta?.lastHeartbeatAt,
      feedState:
        typeof payloadRecord.feedState === 'string'
          ? payloadRecord.feedState
          : merged.meta?.feedState,
      rawEventCount:
        typeof payloadRecord.rawEventCount === 'number'
          ? payloadRecord.rawEventCount
          : merged.meta?.rawEventCount,
    };
    const withMeta: NormalizedMatchState = { ...merged, meta };
    this.cache.set(matchId, withMeta);
    return withMeta;
  }

  setFocus(
    matchId: string,
    focus: NormalizedMatchState['focus'] | Record<string, unknown> | null,
  ): NormalizedMatchState {
    const existing = this.cache.get(matchId);
    const next: NormalizedMatchState =
      existing ??
      ({
        matchId,
        serverTime: Date.now(),
        map: { name: 'UNKNOWN' },
        zones: {},
        teams: [],
      } as NormalizedMatchState);
    const cleanedFocus =
      focus && typeof focus === 'object'
        ? (focus as NormalizedMatchState['focus'])
        : null;
    const merged = { ...next, focus: cleanedFocus ?? undefined };
    this.cache.set(matchId, merged);
    return merged;
  }

  evict(matchIds: string[]): void {
    const unique = Array.from(new Set(matchIds));
    unique.forEach((id) => this.cache.delete(id));
  }

  private mergeState(
    prev: NormalizedMatchState | undefined,
    next: NormalizedMatchState,
  ): NormalizedMatchState {
    if (!prev) return next;

    const mergedMap = {
      name: next.map.name ?? prev.map.name,
      phase: next.map.phase ?? prev.map.phase,
      nextShrinkAt: next.map.nextShrinkAt ?? prev.map.nextShrinkAt,
      worldSize: next.map.worldSize ?? prev.map.worldSize,
      imageUrl: next.map.imageUrl ?? prev.map.imageUrl,
    };

    const mergedZones = {
      safe: next.zones.safe ?? prev.zones.safe,
      next: next.zones.next ?? prev.zones.next,
    };

    const teams =
      Array.isArray(next.teams) && next.teams.length > 0
        ? next.teams
        : prev.teams;

    const summary = next.summary ?? prev.summary;
    const meta = next.meta ?? prev.meta;
    const focus = next.focus ?? prev.focus;

    return {
      matchId: next.matchId || prev.matchId,
      serverTime: next.serverTime ?? prev.serverTime,
      map: mergedMap,
      zones: mergedZones,
      teams,
      summary,
      meta,
      focus,
    };
  }
}

type MetaState = NonNullable<NormalizedMatchState['meta']>;
type TelemetryMetaPayload = {
  telemetryPhase?: string;
  lastHeartbeatAt?: number;
  feedState?: string;
  rawEventCount?: number;
} & Record<string, unknown>;
