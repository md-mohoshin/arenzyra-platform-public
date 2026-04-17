import type {
  LiveSyncPlayerOwnership,
  LiveSyncTeamOwnership,
} from '../../common/live-sync-contract.util';

export type TelemetryEventType =
  | 'PLAYER_KILL'
  | 'PLAYER_KNOCK'
  | 'PLAYER_REVIVE'
  | 'PLAYER_DIED';

type TelemetryEventBase<TType extends TelemetryEventType> = {
  type: TType;
  matchId: string;
  timestamp: number;
  raw?: unknown;
};

export type TelemetryPlayerKillEvent = TelemetryEventBase<'PLAYER_KILL'> & {
  killerPlayerExternalId: string;
  victimPlayerExternalId: string;
  killerTeamId?: string | null;
  victimTeamId?: string | null;
  killerPlayerName?: string | null;
  victimPlayerName?: string | null;
  weapon?: string | null;
};

export type TelemetryPlayerKnockEvent = TelemetryEventBase<'PLAYER_KNOCK'> & {
  playerExternalId: string;
  teamId?: string | null;
  playerName?: string | null;
};

export type TelemetryPlayerReviveEvent = TelemetryEventBase<'PLAYER_REVIVE'> & {
  playerExternalId: string;
  teamId?: string | null;
  playerName?: string | null;
};

export type TelemetryPlayerDiedEvent = TelemetryEventBase<'PLAYER_DIED'> & {
  playerExternalId: string;
  teamId?: string | null;
  playerName?: string | null;
};

export type TelemetryEvent =
  | TelemetryPlayerKillEvent
  | TelemetryPlayerKnockEvent
  | TelemetryPlayerReviveEvent
  | TelemetryPlayerDiedEvent;

export const ENGINE_EVENT_TYPES = [
  'PLAYER_ALIVE_CHANGED',
  'PLAYER_KNOCKED_CHANGED',
  'PLAYER_KILL',
  'TEAM_ELIMINATED',
  'MATCH_STARTED',
  'MATCH_ENDED',
] as const;

export type EngineEventType = (typeof ENGINE_EVENT_TYPES)[number];

export const CONTROL_COMMAND_TYPES = [
  'START_MATCH',
  'END_MATCH',
  'SET_PLAYER_ALIVE',
  'SET_PLAYER_KNOCKED',
  'SET_PLAYER_KILLS',
  'LOCK_RESULTS',
] as const;

export type ControlCommandType = (typeof CONTROL_COMMAND_TYPES)[number];

export const ENGINE_SOURCE_VALUES = [
  'TELEMETRY',
  'MANUAL',
  'HTTP_FALLBACK',
  'LEGACY_OBSERVER',
] as const;

export type EngineSource =
  | (typeof ENGINE_SOURCE_VALUES)[number]
  | (string & Record<never, never>);

export type TelemetryControlMode = 'AUTO' | 'MANUAL' | 'HYBRID';

export type MatchEngineStatus = 'PENDING' | 'LIVE' | 'ENDED' | 'LOCKED';

export type EngineEvent<TPayload = Record<string, unknown>> = {
  matchId: string;
  type: EngineEventType;
  sequence: number;
  timestamp: number;
  source: EngineSource;
  payload: TPayload;
};

export type PlayerAliveChangedPayload = {
  playerId: string;
  teamId?: string | null;
  alive: boolean;
};

export type PlayerKnockedChangedPayload = {
  playerId: string;
  teamId?: string | null;
  knocked: boolean;
};

export type PlayerKillPayload = {
  killerPlayerId: string;
  killerTeamId?: string | null;
  victimPlayerId?: string | null;
  victimTeamId?: string | null;
  killerPlayerName?: string | null;
  victimPlayerName?: string | null;
  weapon?: string | null;
};

export type TeamEliminatedPayload = {
  teamId: string;
};

export type MatchStartedPayload = {
  reason?: string | null;
};

export type MatchEndedPayload = {
  reason?: string | null;
};

export type TelemetryPlayerMetadata = {
  playerName?: string | null;
  avatarUrl?: string | null;
  slotPlayerResultId?: string | null;
  externalPlayerId?: string | null;
  inGameId?: string | null;
  position?: { x: number; y: number } | null;
  observedInTelemetry?: boolean | null;
  provisional?: boolean;
};

export type TelemetryTeamMetadata = {
  teamName?: string | null;
  teamTag?: string | null;
  logoUrl?: string | null;
  slot?: number | null;
  totalPlayers?: number | null;
  slotResultId?: string | null;
  wasPresentInMatch?: boolean | null;
};

export type TelemetryPlayerState = {
  playerId: string;
  teamId: string;
  alive: boolean;
  knocked: boolean;
  kills: number;
  metadata?: TelemetryPlayerMetadata;
  ownership?: LiveSyncPlayerOwnership;
};

export type TelemetryTeamState = {
  teamId: string;
  alivePlayers: number;
  eliminated: boolean;
  placement: number | null;
  totalKills: number;
  totalPlayers: number;
  eliminatedAt: number | null;
  metadata?: TelemetryTeamMetadata;
  ownership?: LiveSyncTeamOwnership;
};

export type TelemetryCircleState = {
  phase?: number | null;
  nextShrinkAt?: number | null;
  safeZone?: { x: number; y: number; r: number } | null;
  nextZone?: { x: number; y: number; r: number } | null;
};

export type TelemetryKillFeedItem = {
  id: string;
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

export type TelemetryStateEvent = {
  id: string;
  type:
    | 'MATCH_STARTED'
    | 'PLAYER_ALIVE_CHANGED'
    | 'PLAYER_KNOCKED_CHANGED'
    | 'PLAYER_KILL'
    | 'TEAM_ELIMINATED'
    | 'CIRCLE_UPDATED'
    | 'MATCH_ENDED';
  ts: number;
  teamId?: string | null;
  playerId?: string | null;
  payload?: Record<string, unknown> | null;
};

export type TelemetryMatchState = {
  matchId: string;
  status: MatchEngineStatus;
  mode: TelemetryControlMode;
  version: number;
  sequence: number;
  updatedAt: number;
  telemetryAcceptedAt?: number | null;
  telemetryAcceptedSource?: string | null;
  startedAt: number | null;
  endedAt: number | null;
  teamsAlive: number;
  circle?: TelemetryCircleState | null;
  killFeed?: TelemetryKillFeedItem[];
  events?: TelemetryStateEvent[];
  players: Record<string, TelemetryPlayerState>;
  teams: Record<string, TelemetryTeamState>;
};

export type StartMatchCommand = {
  type: 'START_MATCH';
  matchId: string;
  timestamp?: number;
  source?: EngineSource;
};

export type EndMatchCommand = {
  type: 'END_MATCH';
  matchId: string;
  timestamp?: number;
  source?: EngineSource;
};

export type SetPlayerAliveCommand = {
  type: 'SET_PLAYER_ALIVE';
  matchId: string;
  playerId: string;
  alive: boolean;
  timestamp?: number;
  source?: EngineSource;
};

export type SetPlayerKnockedCommand = {
  type: 'SET_PLAYER_KNOCKED';
  matchId: string;
  playerId: string;
  knocked: boolean;
  timestamp?: number;
  source?: EngineSource;
};

export type SetPlayerKillsCommand = {
  type: 'SET_PLAYER_KILLS';
  matchId: string;
  playerId: string;
  kills: number;
  timestamp?: number;
  source?: EngineSource;
};

export type LockResultsCommand = {
  type: 'LOCK_RESULTS';
  matchId: string;
  timestamp?: number;
  source?: EngineSource;
};

export type ControlCommand =
  | StartMatchCommand
  | EndMatchCommand
  | SetPlayerAliveCommand
  | SetPlayerKnockedCommand
  | SetPlayerKillsCommand
  | LockResultsCommand;

export type TelemetryRosterState = {
  matchId: string;
  organizationId: string | null;
  tournamentId: string | null;
  status: MatchEngineStatus;
  mode: TelemetryControlMode;
  teams: Record<string, TelemetryTeamState>;
  players: Record<string, TelemetryPlayerState>;
};
