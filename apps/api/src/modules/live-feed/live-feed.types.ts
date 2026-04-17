export type LiveMatchMeta = {
  matchId: string | null;
  status: string;
  startedAt?: string | null;
  updatedAt?: string | null;
};

export type LiveTeam = {
  id: string;
  name: string | null;
  tag: string | null;
  slot: number | null;
  logoUrl: string | null;
  color?: string | null;
  kills: number;
  placement: number | null;
  points: number | null;
  alivePlayers?: number | null;
  totalPlayers?: number | null;
  alive?: boolean;
};

export type LivePlayer = {
  id: string;
  ign: string | null;
  name: string | null;
  teamId: string | null;
  photoUrl: string | null;
};

export type KillEvent = {
  ts: number;
  killerTeamId?: string | null;
  killerName?: string | null;
  victimTeamId?: string | null;
  victimName?: string | null;
  weapon?: string | null;
};

export type CircleInfo = {
  phase?: number | null;
  radius?: number | null;
  shrinking?: boolean;
  nextShrinkAt?: number | null;
};

export type ObserverInfo = {
  playerName?: string | null;
  playerId?: string | null;
  teamId?: string | null;
};

export type LiveSnapshot = {
  match: LiveMatchMeta | null;
  teams: LiveTeam[];
  players: LivePlayer[];
  kills: KillEvent[];
  circle: CircleInfo | null;
  observer: ObserverInfo | null;
  backpack: unknown;
  shadowStatus: 'ok' | 'error';
  lastUpdate: number | null;
  lastPollAt: number | null;
  lastError?: string | null;
};
