import type { TournamentTeamStatus } from '@prisma/client';

export type AddTournamentTeamDto = {
  teamId: string;
  seed?: number | null;
  slot?: number | null;
  status?: TournamentTeamStatus;
  notes?: string | null;
};

export type UpdateTournamentTeamDto = Partial<AddTournamentTeamDto>;

export type TournamentTeamResponse = {
  id: string;
  tournamentId: string;
  teamId: string;
  seed: number | null;
  slot: number | null;
  status: TournamentTeamStatus;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  team: {
    id: string;
    name: string;
    tag: string | null;
    region: string | null;
    logoUrl: string | null;
  };
};
