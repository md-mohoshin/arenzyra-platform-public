import { MatchStatus } from '@prisma/client';

export type LiveStatePlayer = {
  playerId: string;
  ign: string | null;
  isAlive: boolean;
  alive: boolean;
  knocked: boolean;
  kills: number;
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
