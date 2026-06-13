import { ConflictException, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { RedisService } from '../../redis/redis.service';
import type { ControlState } from './dto/control.dto';
import type {
  LiveSyncPlayerOwnership,
  LiveSyncTeamOwnership,
} from '../../common/live-sync-contract.util';

export type MatchStateSourceMode = 'API' | 'MANUAL';

export type MatchStateEventType =
  | 'MATCH_STARTED'
  | 'PLAYER_SEEN'
  | 'PLAYER_KNOCKED'
  | 'PLAYER_REVIVED'
  | 'PLAYER_DIED'
  | 'PLAYER_KILL'
  | 'TEAM_ELIMINATED'
  | 'CIRCLE_UPDATED'
  | 'OBSERVED_PLAYER_CHANGED'
  | 'MATCH_ENDED';

export type MatchStateCircle = {
  phase?: number | null;
  nextShrinkAt?: number | null;
  safeZone?: { x: number; y: number; r: number } | null;
  nextZone?: { x: number; y: number; r: number } | null;
};

export type MatchStatePlayer = {
  id?: string | null;
  playerId?: string | null;
  externalPlayerId?: string | null;
  pubgPlayerId?: string | null;
  name?: string | null;
  ign?: string | null;
  avatarUrl?: string | null;
  teamId?: string | null;
  slot?: number | null;
  alive: boolean;
  knocked: boolean;
  eliminated?: boolean;
  health?: number | null;
  kills: number;
  assists?: number;
  position?: { x: number; y: number } | null;
  updatedAt?: string | null;
  lifeTelemetryFresh?: boolean;
  ownership?: LiveSyncPlayerOwnership;
};

export type MatchStateBackpackItem = {
  name: string | null;
  count: number | null;
  itemId?: string | null;
  raw?: unknown;
};

export type MatchStateTeamBackpack = {
  teamId?: string | null;
  playerId?: string | null;
  slot?: number | null;
  items: MatchStateBackpackItem[];
  equipment?: MatchStateBackpackItem[];
  itemCount: number;
  raw?: unknown;
};

export type MatchStateObservedPlayer = {
  playerId?: string | null;
  externalPlayerId?: string | null;
  pubgPlayerId?: string | null;
  playerName?: string | null;
  playerIgn?: string | null;
  teamId?: string | null;
  teamName?: string | null;
  teamTag?: string | null;
  teamLogoUrl?: string | null;
  updatedAt?: string | null;
};

export type MatchStateKillFeedItem = {
  id: string;
  type: 'PLAYER_KILL';
  ts: number;
  killerTeamId?: string | null;
  killerPlayerId?: string | null;
  killerName?: string | null;
  victimTeamId?: string | null;
  victimPlayerId?: string | null;
  victimName?: string | null;
  delta?: number;
  totalKills?: number | null;
  weapon?: string | null;
};

export type MatchStateEvent = {
  id: string;
  type: MatchStateEventType;
  ts: number;
  teamId?: string | null;
  playerId?: string | null;
  payload?: Record<string, unknown> | null;
};

export type MatchStateSummary = {
  totalTeams: number;
  aliveTeams: number;
  totalPlayers: number;
  alivePlayers: number;
  winnerTeamId?: string | null;
  winnerSlot?: number | null;
};

export type TeamScoreState = {
  teamId: string;
  name: string | null;
  tag: string | null;
  slot: number | null;
  wasPresentInMatch?: boolean | null;
  presenceStatus?: 'ACTIVE' | 'NO_SHOW' | 'UNRESOLVED' | null;
  kills: number;
  placement: number | null;
  points: number | null;
  logoUrl: string | null;
  hasTelemetryPresence?: boolean;
  alivePlayers?: number | null;
  totalPlayers?: number | null;
  alive?: boolean;
  eliminated?: boolean;
  backpack?: MatchStateTeamBackpack | null;
  equipment?: MatchStateTeamBackpack | null;
  updatedAt?: string | null;
  sourceMode?: MatchStateSourceMode;
  ownership?: LiveSyncTeamOwnership;
  players?: MatchStatePlayer[];
};

export type LiveMatchState = {
  matchId: string;
  status: ControlState;
  startedAt: string | null;
  endedAt: string | null;
  version: number;
  updatedAt: string;
  initialized?: boolean;
  firstValidAt?: number | null;
  lastAliveTeams?: number;
  lastAliveTeamsAt?: number | null;
  loggedInit?: boolean;
  sourceMode?: MatchStateSourceMode;
  summary?: MatchStateSummary | null;
  circle?: MatchStateCircle | null;
  observedPlayer?: MatchStateObservedPlayer | null;
  killFeed?: MatchStateKillFeedItem[];
  events?: MatchStateEvent[];
  teams: TeamScoreState[];
};

const MIN_VALID_ALIVE_TEAMS = 2;
const MIN_VALID_TOTAL_PLAYERS = 10;
const MAX_INIT_WAIT_MS = 120_000;

const normalizeSourceMode = (value: string | null | undefined): string =>
  (value ?? '').toString().trim().toUpperCase();

export const isAutomaticMatchStateSourceMode = (
  value: string | null | undefined,
): boolean => {
  const normalized = normalizeSourceMode(value);
  return (
    normalized === 'API' || normalized === 'AUTO' || normalized === 'HYBRID'
  );
};

export const toCanonicalMatchStateSourceMode = (
  value: string | null | undefined,
): MatchStateSourceMode | null => {
  const normalized = normalizeSourceMode(value);
  if (normalized === 'MANUAL') {
    return 'MANUAL';
  }
  if (isAutomaticMatchStateSourceMode(normalized)) {
    return 'API';
  }
  return null;
};

const normalizeCount = (value: unknown): number | null => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  return Math.max(0, Math.floor(value));
};

const parseTimestampMs = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (value instanceof Date) {
    return value.getTime();
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
};

const countTeamPlayers = (team: TeamScoreState): number => {
  const totalPlayers = normalizeCount(team.totalPlayers);
  if (totalPlayers !== null) {
    return totalPlayers;
  }
  return Array.isArray(team.players) ? team.players.length : 0;
};

const countTeamAlivePlayers = (team: TeamScoreState): number | null => {
  const alivePlayers = normalizeCount(team.alivePlayers);
  if (alivePlayers !== null) {
    return alivePlayers;
  }

  if (Array.isArray(team.players) && team.players.length > 0) {
    return team.players.filter((player) => player.alive === true).length;
  }

  if (typeof team.alive === 'boolean') {
    return team.alive ? 1 : 0;
  }

  return null;
};

export const computeAliveTeams = (
  state: Pick<LiveMatchState, 'summary' | 'teams'>,
): number => {
  if (Array.isArray(state.teams) && state.teams.length > 0) {
    return state.teams.reduce((count, team) => {
      const alivePlayers = countTeamAlivePlayers(team);
      return alivePlayers !== null && alivePlayers > 0 ? count + 1 : count;
    }, 0);
  }

  return normalizeCount(state.summary?.aliveTeams) ?? 0;
};

export const computeTotalTeams = (
  state: Pick<LiveMatchState, 'summary' | 'teams'>,
): number => {
  if (Array.isArray(state.teams) && state.teams.length > 0) {
    return state.teams.length;
  }

  return normalizeCount(state.summary?.totalTeams) ?? 0;
};

export const countPlayers = (
  state: Pick<LiveMatchState, 'summary' | 'teams'>,
): number => {
  if (Array.isArray(state.teams) && state.teams.length > 0) {
    const totalPlayers = state.teams.reduce(
      (sum, team) => sum + countTeamPlayers(team),
      0,
    );
    if (totalPlayers > 0) {
      return totalPlayers;
    }
  }

  return normalizeCount(state.summary?.totalPlayers) ?? 0;
};

const withTelemetryInitializationState = (
  state: LiveMatchState,
  current?: LiveMatchState | null,
): LiveMatchState => {
  const now = Date.now();
  const carriedFirstValidAt =
    normalizeCount(state.firstValidAt) ??
    normalizeCount(current?.firstValidAt) ??
    null;
  const next: LiveMatchState = {
    ...state,
    initialized: state.initialized === true || current?.initialized === true,
    loggedInit: state.loggedInit === true || current?.loggedInit === true,
    ...(carriedFirstValidAt !== null
      ? { firstValidAt: carriedFirstValidAt }
      : {}),
  };

  if (!next.initialized) {
    const aliveTeams = computeAliveTeams(next);
    const totalPlayers = countPlayers(next);
    if (
      aliveTeams >= MIN_VALID_ALIVE_TEAMS &&
      totalPlayers >= MIN_VALID_TOTAL_PLAYERS
    ) {
      next.initialized = true;
      next.firstValidAt = now;
    } else {
      const liveStartedAt =
        parseTimestampMs(next.startedAt) ??
        parseTimestampMs(current?.startedAt);
      const timeSinceLive = liveStartedAt === null ? null : now - liveStartedAt;
      if (timeSinceLive !== null && timeSinceLive > MAX_INIT_WAIT_MS) {
        next.initialized = true;
        next.firstValidAt = now;
      }
    }
  }

  return next;
};

const withAliveTeamsStabilityState = (
  state: LiveMatchState,
  current?: LiveMatchState | null,
): LiveMatchState => {
  const now = Date.now();
  const aliveTeams = computeAliveTeams(state);

  if (aliveTeams === 1) {
    if (current?.lastAliveTeams === 1) {
      return {
        ...state,
        lastAliveTeams: 1,
        lastAliveTeamsAt:
          normalizeCount(current.lastAliveTeamsAt) ??
          normalizeCount(state.lastAliveTeamsAt) ??
          now,
      };
    }

    return {
      ...state,
      lastAliveTeams: 1,
      lastAliveTeamsAt: now,
    };
  }

  return {
    ...state,
    lastAliveTeams: aliveTeams,
    lastAliveTeamsAt: now,
  };
};

@Injectable()
export class MatchControlStateStore {
  private readonly logger = new Logger(MatchControlStateStore.name);
  private readonly keyPrefix = 'match-control:state:';
  private static readonly sharedMemoryFallback = new Map<
    string,
    LiveMatchState
  >();

  constructor(private readonly redis: RedisService) {}

  private client(): Redis | null {
    return this.redis.getClient();
  }

  private key(matchId: string): string {
    return `${this.keyPrefix}${matchId}`;
  }

  async get(matchId: string): Promise<LiveMatchState | null> {
    const client = this.client();
    if (!client) {
      return MatchControlStateStore.sharedMemoryFallback.get(matchId) ?? null;
    }
    const raw = await client.get(this.key(matchId));
    if (!raw) return null;
    return JSON.parse(raw) as LiveMatchState;
  }

  async save(
    matchId: string,
    state: LiveMatchState,
    expectedVersion?: number,
  ): Promise<LiveMatchState> {
    const client = this.client();
    if (!client) {
      const current = MatchControlStateStore.sharedMemoryFallback.get(matchId);
      if (
        expectedVersion !== undefined &&
        current &&
        current.version !== expectedVersion
      ) {
        throw new ConflictException('State version mismatch');
      }
      const nextState = withAliveTeamsStabilityState(
        withTelemetryInitializationState(state, current),
        current,
      );
      const next: LiveMatchState = {
        ...nextState,
        version: (expectedVersion ?? current?.version ?? 0) + 1,
        updatedAt: new Date().toISOString(),
      };
      if (next.initialized && !next.loggedInit) {
        this.logger.log(`[Match] Telemetry initialized matchId=${matchId}`);
        next.loggedInit = true;
      }
      MatchControlStateStore.sharedMemoryFallback.set(matchId, next);
      return next;
    }

    const key = this.key(matchId);
    for (let attempt = 0; attempt < 3; attempt++) {
      await client.watch(key);
      const currentRaw = await client.get(key);
      const current = currentRaw
        ? (JSON.parse(currentRaw) as LiveMatchState)
        : null;
      if (
        expectedVersion !== undefined &&
        current &&
        current.version !== expectedVersion
      ) {
        await client.unwatch();
        throw new ConflictException('State version mismatch');
      }
      const nextState = withAliveTeamsStabilityState(
        withTelemetryInitializationState(state, current),
        current,
      );
      const next: LiveMatchState = {
        ...nextState,
        version: (expectedVersion ?? current?.version ?? 0) + 1,
        updatedAt: new Date().toISOString(),
      };
      if (next.initialized && !next.loggedInit) {
        this.logger.log(`[Match] Telemetry initialized matchId=${matchId}`);
        next.loggedInit = true;
      }
      const multi = client.multi();
      multi.set(key, JSON.stringify(next));
      const res = await multi.exec();
      if (res) {
        return next;
      }
    }
    throw new ConflictException(
      'Failed to persist state due to concurrent update',
    );
  }

  async evictMatches(matchIds: string[]): Promise<void> {
    const client = this.client();
    const unique = Array.from(new Set(matchIds));
    for (const matchId of unique) {
      if (client) {
        try {
          await client.del(this.key(matchId));
        } catch {
          /* ignore redis cleanup errors */
        }
      }
      MatchControlStateStore.sharedMemoryFallback.delete(matchId);
    }
  }
}
