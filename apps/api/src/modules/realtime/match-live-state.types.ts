import { MatchStatus } from '@prisma/client';
import type { MatchStateTeamBackpack } from '../match-control/state.store';

export type LiveStatePlayer = {
  playerId: string;
  ign: string | null;
  isAlive: boolean;
  alive: boolean;
  knocked: boolean;
  health?: number | null;
  kills: number;
  assists?: number;
  lifeTelemetryFresh?: boolean;
};

export type LiveStateTeam = {
  slotResultId: string;
  teamId: string;
  teamName: string | null;
  teamTag: string | null;
  logoUrl: string | null;
  slot: number | null;
  placement?: number | null;
  totalKills?: number | null;
  points?: number | null;
  alivePlayers?: number | null;
  totalPlayers?: number | null;
  backpack?: MatchStateTeamBackpack | null;
  equipment?: MatchStateTeamBackpack | null;
  players: LiveStatePlayer[];
};

export type MatchLiveStatePayload = {
  matchId: string | null;
  tournamentId: string | null;
  groupId: string | null;
  matchStatus?: MatchStatus | null;
  tournamentStatus?: string | null;
  teams: LiveStateTeam[];
};

export type MatchPhaseSnapshot = {
  phase: 'LIVE' | 'POST_MATCH';
  aliveTeams: number;
  isFinished: boolean;
  winnerTeamId: string | null;
  winner?: LiveStateTeam | null;
};
