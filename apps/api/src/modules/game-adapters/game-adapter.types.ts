import { GameKey } from '@prisma/client';

export type MatchSummary = {
  matchId: string;
  name?: string | null;
  map?: string | null;
  status?: string | null;
  startedAt?: Date | string | null;
  endedAt?: Date | string | null;
  dataSource?: string | null;
  isLocked?: boolean | null;
  snapshotAt?: Date;
};

export type TeamSummary = {
  teamId: string;
  name: string | null;
  tag?: string | null;
  logoUrl?: string | null;
};

export type PlayerSummary = {
  playerId: string;
  name: string | null;
  teamId: string | null;
  photoUrl?: string | null;
};

export type AdapterSnapshot = {
  match: MatchSummary;
  teams: TeamSummary[];
  players: PlayerSummary[];
};

export type AdapterTelemetryPosition = {
  x: number;
  y: number;
};

export type AdapterTelemetryPlayer = {
  playerId?: string | null;
  externalPlayerId?: string | null;
  pubgAccountId?: string | null;
  ign?: string | null;
  teamId?: string | null;
  alive?: boolean;
  knocked?: boolean;
  eliminated?: boolean;
  kills?: number;
  position?: AdapterTelemetryPosition | null;
  raw?: unknown;
};

export type AdapterTelemetryTeam = {
  teamId?: string | null;
  slot?: number | null;
  name?: string | null;
  tag?: string | null;
  logoUrl?: string | null;
  aliveCount?: number;
  alivePlayers?: number | null;
  totalPlayers?: number | null;
  eliminated?: boolean;
  kills?: number;
  placement?: number | null;
  players?: AdapterTelemetryPlayer[];
  raw?: unknown;
};

export type AdapterTelemetryZone = {
  phase?: number | null;
  center?: AdapterTelemetryPosition | null;
  radius?: number | null;
  nextShrinkAt?: number | null;
  raw?: unknown;
};

export type AdapterTelemetryEventType =
  | 'KILL'
  | 'TEAM_ELIMINATED'
  | 'MATCH_START'
  | 'MATCH_END'
  | 'PLAYER_STATE';

export type AdapterTelemetryEvent = {
  type: AdapterTelemetryEventType;
  timestamp: number;
  dedupeKey?: string | null;
  teamId?: string | null;
  playerId?: string | null;
  killerId?: string | null;
  killerTeamId?: string | null;
  victimId?: string | null;
  victimTeamId?: string | null;
  payload?: Record<string, unknown>;
  raw?: unknown;
};

export type AdapterTelemetryEnvelope = {
  matchId: string;
  sessionId?: string | null;
  sequence?: number | null;
  timestamp: number;
  players: AdapterTelemetryPlayer[];
  teams: AdapterTelemetryTeam[];
  zone: AdapterTelemetryZone | null;
  events: AdapterTelemetryEvent[];
  source?: string | null;
  raw?: unknown;
};

export type AdapterContext = {
  orgId?: string | null;
  actorId?: string | null;
};

export type AdapterGameKey = GameKey | 'GENERIC';

export type AdapterDescriptor = {
  key: string;
  gameKey: AdapterGameKey;
};
