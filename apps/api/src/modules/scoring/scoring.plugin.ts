import { GameKey } from '@prisma/client';

export type StandingsRow = {
  teamId: string;
  teamTag?: string | null;
  teamName?: string | null;
  logoUrl?: string | null;
  total: number;
  wwcd: number;
  placementPoints: number;
  kills: number;
  bestPlacement: number; // lower is better
  bestKills: number;
};

export type StandingsSnapshotPayload = {
  tournamentId: string;
  game: GameKey;
  updatedAt: string;
  meta?: {
    tournamentName?: string | null;
    bannerUrl?: string | null;
  };
  rows: Array<StandingsRow & { rank: number }>;
};

export interface ScoringPlugin {
  game: GameKey;
  recomputeMatch(matchId: string): Promise<void>;
  recomputeTournament(tournamentId: string): Promise<StandingsSnapshotPayload>;
}
