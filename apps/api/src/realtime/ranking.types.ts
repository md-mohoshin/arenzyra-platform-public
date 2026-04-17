export type LiveRankingTeam = {
  teamId: string;
  rank: number;
  name: string;
  tag?: string | null;
  logoUrl?: string | null;
  kills: number;
  placement: number | null;
  placementPoints: number;
  killPoints: number;
  totalPoints: number;
  wasPresentInMatch?: boolean | null;
  presenceStatus?: 'ACTIVE' | 'NO_SHOW' | 'UNRESOLVED' | null;
};

export type LiveRankingPayload = {
  matchId: string;
  computedAt: string;
  teams: LiveRankingTeam[];
};

export type OverallRankingTeam = {
  teamId: string;
  rank: number;
  name: string;
  tag?: string | null;
  logoUrl?: string | null;
  matchesPlayed: number;
  kills: number;
  placementPoints: number;
  killPoints: number;
  totalPoints: number;
  wasPresentInMatch?: boolean | null;
  presenceStatus?: 'ACTIVE' | 'NO_SHOW' | 'UNRESOLVED' | null;
};

export type OverallRankingPayload = {
  tournamentId: string;
  computedAt: string;
  teams: OverallRankingTeam[];
};
