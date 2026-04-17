export interface NormalizedCircle {
  x: number;
  y: number;
  r: number;
}

export interface NormalizedPlayerState {
  pubgAccountId?: string;
  ign?: string;
  teamId?: string;
  alive: boolean;
  knocked: boolean;
  eliminated: boolean;
  pos?: {
    x: number;
    y: number;
  };
}

export interface NormalizedTeamState {
  slot: number;
  teamId?: string;
  name?: string;
  tag?: string;
  logoUrl?: string;
  aliveCount: number;
  eliminated: boolean;
  kills?: number;
  placement?: number;
  points?: number;
  players: NormalizedPlayerState[];
}

export interface NormalizedMatchState {
  matchId: string;
  serverTime: number;
  map: {
    name: string;
    phase?: number;
    nextShrinkAt?: number;
    worldSize?: number;
    imageUrl?: string;
  };
  zones: {
    safe?: NormalizedCircle;
    next?: NormalizedCircle;
  };
  teams: NormalizedTeamState[];
  summary?: {
    totalTeams?: number;
    aliveTeams?: number;
    totalPlayers?: number;
    alivePlayers?: number;
    updatedAt?: number;
  };
  meta?: {
    matchName?: string | null;
    tournamentId?: string | null;
    tournamentName?: string | null;
    mapAsset?: {
      imageUrl?: string;
      worldSize?: number;
    };
    telemetryPhase?: string;
    lastHeartbeatAt?: number;
    feedState?: string;
    rawEventCount?: number;
    sessionId?: string | null;
  };
  focus?: Record<string, unknown> | null;
}
