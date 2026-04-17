export type DiscordConfigSummary = {
  hasGuildConnection: boolean;
  hasHubCategory: boolean;
  configuredChannelCount: number;
  configuredRoleCount: number;
  automationEnabled: boolean;
};

export type DiscordConfigView = {
  organization: {
    id: string;
    name: string;
    slug: string;
    status: string;
  };
  exists: boolean;
  enabled: boolean;
  guildId: string | null;
  guildName: string | null;
  hubCategoryId: string | null;
  hubCategoryName: string | null;
  registrationsChannelId: string | null;
  registrationsChannelName: string | null;
  slotsChannelId: string | null;
  slotsChannelName: string | null;
  resultsChannelId: string | null;
  resultsChannelName: string | null;
  standingsChannelId: string | null;
  standingsChannelName: string | null;
  supportChannelId: string | null;
  supportChannelName: string | null;
  organizerRoleId: string | null;
  organizerRoleName: string | null;
  captainRoleId: string | null;
  captainRoleName: string | null;
  participantRoleId: string | null;
  participantRoleName: string | null;
  autoCreateSessionCategories: boolean;
  autoCreateSessionChannels: boolean;
  autoSyncRoles: boolean;
  sessionCategoryPrefix: string | null;
  sessionChannelPrefix: string | null;
  notes: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  lastValidatedAt: string | null;
  updatedBy: {
    id: string;
    name: string;
    email: string | null;
  } | null;
  summary: DiscordConfigSummary;
};

export type DiscordConfigDraft = {
  enabled: boolean;
  guildId: string;
  guildName: string;
  hubCategoryId: string;
  hubCategoryName: string;
  registrationsChannelId: string;
  registrationsChannelName: string;
  slotsChannelId: string;
  slotsChannelName: string;
  resultsChannelId: string;
  resultsChannelName: string;
  standingsChannelId: string;
  standingsChannelName: string;
  supportChannelId: string;
  supportChannelName: string;
  organizerRoleId: string;
  organizerRoleName: string;
  captainRoleId: string;
  captainRoleName: string;
  participantRoleId: string;
  participantRoleName: string;
  autoCreateSessionCategories: boolean;
  autoCreateSessionChannels: boolean;
  autoSyncRoles: boolean;
  sessionCategoryPrefix: string;
  sessionChannelPrefix: string;
  notes: string;
};

export function createDiscordConfigDraft(
  config: DiscordConfigView,
): DiscordConfigDraft {
  return {
    enabled: config.enabled,
    guildId: config.guildId ?? "",
    guildName: config.guildName ?? "",
    hubCategoryId: config.hubCategoryId ?? "",
    hubCategoryName: config.hubCategoryName ?? "",
    registrationsChannelId: config.registrationsChannelId ?? "",
    registrationsChannelName: config.registrationsChannelName ?? "",
    slotsChannelId: config.slotsChannelId ?? "",
    slotsChannelName: config.slotsChannelName ?? "",
    resultsChannelId: config.resultsChannelId ?? "",
    resultsChannelName: config.resultsChannelName ?? "",
    standingsChannelId: config.standingsChannelId ?? "",
    standingsChannelName: config.standingsChannelName ?? "",
    supportChannelId: config.supportChannelId ?? "",
    supportChannelName: config.supportChannelName ?? "",
    organizerRoleId: config.organizerRoleId ?? "",
    organizerRoleName: config.organizerRoleName ?? "",
    captainRoleId: config.captainRoleId ?? "",
    captainRoleName: config.captainRoleName ?? "",
    participantRoleId: config.participantRoleId ?? "",
    participantRoleName: config.participantRoleName ?? "",
    autoCreateSessionCategories: config.autoCreateSessionCategories,
    autoCreateSessionChannels: config.autoCreateSessionChannels,
    autoSyncRoles: config.autoSyncRoles,
    sessionCategoryPrefix: config.sessionCategoryPrefix ?? "",
    sessionChannelPrefix: config.sessionChannelPrefix ?? "",
    notes: config.notes ?? "",
  };
}
