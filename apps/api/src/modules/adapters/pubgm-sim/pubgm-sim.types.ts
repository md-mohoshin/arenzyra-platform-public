import type { GameKey } from '@prisma/client';

export type SimPhase = 'LOBBY' | 'DROP' | 'MID' | 'END' | 'FINISHED';

export type SimTeam = {
  teamId: string;
  teamName: string;
  slot?: number | null;
  alive: boolean;
  kills: number;
  placement?: number;
};

export type SimEvent = {
  t: string;
  type: 'KILL' | 'ELIM';
  killerTeamId?: string;
  victimTeamId: string;
  count?: number;
};

export type SimSnapshot = {
  matchId: string;
  updatedAt: string;
  phase: SimPhase;
  elapsedSec: number;
  aliveTeams: number;
  alivePlayers: number;
  teams: SimTeam[];
  events: SimEvent[];
};

export type PubgmSimStartParams = {
  matchId: string;
  tickMs?: number;
  seed?: number;
};

export type PubgmSimJumpParams = {
  matchId: string;
  phase: SimPhase;
};

export const PUBGM_SIM_ADAPTER_KEY = 'pubgm-sim';
export const PUBGM_SIM_GAME_KEY: GameKey = 'PUBG_MOBILE';
