import { GameKey, Role, TournamentStatus } from '@prisma/client';

export interface TournamentCreateDto {
  name: string;
  shortName: string;
  region: string;
  timezone: string;
  startDate: string | number | Date;
  endDate: string | number | Date;
  bannerUrl: string;
  logoUrl?: string | null;
  description?: string | null;
  organizationId?: string | null;
  status?: TournamentStatus | null;
  game?: GameKey | null;
  ruleset?: unknown;
}

export type TournamentUpdateDto = Partial<TournamentCreateDto> & {
  ownerUserId?: string;
  role?: Role;
};

export type TournamentDeleteDto = {
  /**
   * Must equal the string "DELETE TOURNAMENT" to confirm permanent deletion.
   */
  confirm: string;
  /**
   * Optional organization scope asserted by the caller (useful for admin dashboards).
   */
  organizationId?: string | null;
};

export type TournamentHardDeleteDto = {
  /**
   * Must exactly match the tournament name to proceed with hard deletion.
   */
  confirmName?: string | null;
};
