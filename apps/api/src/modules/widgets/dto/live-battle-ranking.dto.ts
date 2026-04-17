export type LiveBattleRankingPlayerDto = {
  playerId: string;
  name: string;
  hp?: number;
  state: 'ALIVE' | 'KNOCKED' | 'DEAD' | 'UNKNOWN';
};

export type LiveBattleRankingTeamDto = {
  teamId: string;
  slot?: number | null;
  teamName: string;
  teamTag?: string | null;
  logoUrl?: string | null;
  liveKills: number;
  alive: number;
  knocked: number;
  totalPlayers: number;
  eliminated: boolean;
  players?: LiveBattleRankingPlayerDto[];
};

export type LiveBattleRankingDto = {
  orgId: string;
  matchId: string | null;
  tournamentId: string | null;
  groupId: string | null;
  updatedAt: string;
  teams: LiveBattleRankingTeamDto[];
  branding?: Record<string, unknown> | null;
};
