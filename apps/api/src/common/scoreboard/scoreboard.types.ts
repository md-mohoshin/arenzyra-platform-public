import { GameKey } from '@prisma/client';

export interface ScoreboardTeam {
  teamId: string;
  name: string;
  logoUrl?: string | null;
  score: number;
  placement?: number | null;
  aliveCount?: number | null;
  wasPresentInMatch?: boolean | null;
  presenceStatus?: 'ACTIVE' | 'NO_SHOW' | 'UNRESOLVED' | null;
  stats: Record<string, number>;
}

export interface ScoreboardPlayer {
  playerId: string;
  name: string;
  teamId: string;
  stats: Record<string, number>;
  isAlive?: boolean | null;
}

export interface ScoreboardEvent {
  seq: number;
  ts: string;
  type: string;
  text: string;
  teamId?: string;
  playerId?: string;
  payload?: any;
}

export interface ScoreboardView {
  matchId: string;
  gameKey: GameKey;
  adapterKey?: string | null;
  status: 'SETUP' | 'WAITING' | 'LIVE' | 'PAUSED' | 'ENDED';
  startedAt?: string | null;
  endedAt?: string | null;
  teams: ScoreboardTeam[];
  players: ScoreboardPlayer[];
  recentEvents: ScoreboardEvent[];
  meta: {
    map?: string | null;
    round?: number | null;
    totalRounds?: number | null;
    mode?: string | null;
  };
  updatedAt: string;
}
