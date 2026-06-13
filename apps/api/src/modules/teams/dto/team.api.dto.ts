export type TeamListFilters = {
  search?: string;
  gameId?: string;
  orgId?: string;
  region?: string;
  excludeTournamentId?: string;
  scope?: 'manual' | 'live-mapping' | 'all';
};

export type TeamCreateDto = {
  name: string;
  tag?: string | null;
  gameId?: string | null;
  region?: string | null;
  countryCode?: string | null;
  logoUrl?: string | null;
  logoLightUrl?: string | null;
  accentLight?: string | null;
  textOnLight?: string | null;
  logoDarkUrl?: string | null;
  accentDark?: string | null;
  textOnDark?: string | null;
  organizationId: string;
};

export type TeamUpdateDto = Partial<TeamCreateDto>;

export type TeamResponse = {
  id: string;
  name: string;
  tag: string | null;
  gameId: string | null;
  region: string | null;
  countryCode: string | null;
  logoUrl: string | null;
  logoLightUrl: string | null;
  accentLight: string | null;
  textOnLight: string | null;
  logoDarkUrl: string | null;
  accentDark: string | null;
  textOnDark: string | null;
  organizationId: string;
  ownerUserId: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  isLiveMapping?: boolean;
  _count?: {
    players: number;
  };
};

export type TeamMemberResponse = {
  id: string;
  teamId: string;
  organizationId: string;
  discordUserId: string;
  discordUsername: string | null;
  displayName: string | null;
  role: 'LEADER' | 'PLAYER';
  createdAt: Date;
  updatedAt: Date;
  leftAt: Date | null;
  deletedAt: Date | null;
};

export type DiscordTeamRegistrationResponse = {
  created: boolean;
  team: TeamResponse;
  members: TeamMemberResponse[];
};

export type DiscordTeamCleanupResponse = {
  ok: true;
  teamId: string;
  releasedMembers: number;
};

export type DiscordTeamMemberReleaseResponse = {
  ok: true;
  teamId: string;
  removedMember: TeamMemberResponse;
  promotedMember: TeamMemberResponse | null;
};

export type DiscordManagedTeamResponse = {
  team: TeamResponse;
  managers: TeamMemberResponse[];
};
