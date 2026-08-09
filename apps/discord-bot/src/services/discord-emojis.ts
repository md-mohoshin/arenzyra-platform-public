import type { SessionDiscordConfigResponse } from "../api/api-client";

export const DEFAULT_DISCORD_EMOJIS = {
  check: "\u2705",
  reject: "\u274C",
  warning: "\u26A0\uFE0F",
  waitlist: "\u{1F552}",
  ban: "\u{1F6AB}",
  vip: "\u2B50",
  slot: "\u{1F4CB}",
  camera: "\u{1F4F7}",
  chart: "\u{1F4CA}",
  fire: "\u{1F525}",
  clock: "\u{1F552}",
  trophy: "\u{1F3C6}",
  team: "\u{1F3AE}",
  idp: "\u{1F511}",
  room: "\u{1F3E0}",
  idpScheduleEnabled: "true",
  idpScheduleTimeZone: "Europe/Bucharest",
  idpSchedulePrimaryMessageTemplate:
    "{idpRole}\n**{match} Room Information**\n{mapLine}\nRoom ID: `{roomId}`\nPassword: `{password}`\nStart: {startTime} ({startsRelative})",
  idpScheduleReminder5Message:
    "{idpRole}\n**{match} starts in {minutes} minutes.**\n{mapLine}\nRoom ID: `{roomId}`\nPassword: `{password}`",
  idpScheduleReminder2Message:
    "{idpRole}\n**{match} starts in {minutes} minutes.**\n{mapLine}\nRoom ID: `{roomId}`\nPassword: `{password}`",
  idpScheduleReminder1Message:
    "{idpRole}\n**{match} Last Call** — starts in {minutes} minute.\n{mapLine}\nRoom ID: `{roomId}`\nPassword: `{password}`",
  results: "\u{1F4DD}",
  empty: "\u25AB",
  slotListMode: "number",
  slotListMessageMode: "embed",
  waitlistMessageMode: "embed",
  slotStatusResponseEnabled: "true",
  idpDmForwardingEnabled: "false",
  confirmationMode: "text",
  playControlMode: "buttons",
  playButtonsEnabled: "true",
  playConfirmationWeeklySchedule: "",
  playConfirmationOpenTime: "",
  playConfirmationCloseTime: "",
  playConfirmationWaitlistStartTime: "",
  playConfirmationTimeZone: "",
  playConfirmationOpensAt: "",
  playConfirmationClosesAt: "",
  playConfirmationMessageEnabled: "false",
  playConfirmationMessageTitle: "Team Confirmation",
  playConfirmationMessageText:
    "Confirm your team status for this scrim.\n\n{confirm} Playing\n{notPlaying} Not playing",
  playConfirmationCleanupEnabled: "false",
  playConfirmationCleanupBanEnabled: "false",
  playConfirmationCleanupReason: "Missed confirmation for {session}",
  playConfirmationCleanupLastClosedAt: "",
  playCancellationCleanupEnabled: "false",
  playCancellationCleanupDelayMinutes: "10",
  playCancellationCleanupBanEnabled: "false",
  playCancellationCleanupReason: "Cancelled slot for {session}",
  playConfirmationWaitlistGraceMinutes: "30",
  playConfirmationWaitlistGraceStartedAt: "",
  playConfirmationWaitlistGraceUntil: "",
  registrationWeeklySchedule: "",
  registrationTimeZone: "",
  waitlistPromotionWeeklySchedule: "",
  waitlistPromotionTimeZone: "",
  waitlistPromotionManualState: "",
  waitlistPromotionAutoOpenUntil: "",
  waitlistPromotionScheduleOverrideState: "",
  waitlistPromotionScheduleOverrideUpdatedAt: "",
  waitlistPromotionOpenMessageText:
    "{role} A normal slot is available for {session}. Register in the waitlist channel before it closes {closesRelative}.",
  registrationMessageEnabled: "true",
  registrationMessageDisplayMode: "plain",
  registrationMessageTitle: "Arenzyra Scrim Registration",
  registrationMessageText:
    "Register for {session} with this message format:\n\n{command}\nTeam Name\nTEAMTAG\n@manager\n\nAttach the team logo image to the same message when available.",
  registrationStatusAnnouncementMode: "plain",
  registrationOpenAnnouncementTitle: "Registration Open",
  registrationOpenAnnouncementText:
    "{success} Registration is now open for {session}.\n\n**Window**\n{status}",
  registrationClosedAnnouncementTitle: "Registration Closed",
  registrationClosedAnnouncementText:
    "{reject} Registration is now closed for {session}.\n\n**Window**\n{status}",
  registrationManualState: "",
  registrationScheduleOverrideState: "",
  registrationClosedDetailsHours: "2",
  registrationOpeningSoonHours: "2",
  registrationStatusAlwaysOpenText: "{success} Registration is open.",
  registrationStatusOpenText:
    "{success} Registration open until {closesRelative} ({closes}){schedule}",
  registrationStatusOpeningSoonText:
    "{clock} Registration opens {opensRelative} ({opens}){schedule}",
  registrationStatusClosedRecentText:
    "{reject} Registration closed {closesRelative}. Opens {opensRelative}{schedule}.",
  registrationStatusClosedText: "{reject} Registration closed.",
  earlyAccessEnabled: "false",
  earlyAccessWeeklySchedule: "",
  earlyAccessTimeZone: "",
  earlyAccessOpensAt: "",
  earlyAccessClosesAt: "",
  earlyAccessMessageEnabled: "true",
  earlyAccessOpenMessageText:
    "{role} Early registration is open for {session}.",
  earlyAccessCloseMessageText: "Early registration is closed for {session}.",
  vipAccessEnabled: "false",
  vipAccessWeeklySchedule: "",
  vipAccessTimeZone: "",
  vipAccessOpensAt: "",
  vipAccessClosesAt: "",
  vipAccessMessageEnabled: "true",
  vipAccessOpenMessageText: "{role} VIP registration is open for {session}.",
  vipAccessCloseMessageText: "VIP registration is closed for {session}.",
  roleAccessGroups: "",
  autoRegistrationEnabled: "false",
  autoRegistrationRoleId: "",
  autoRegistrationRoleName: "",
  autoRegistrationWeeklySchedule: "",
  autoRegistrationTimeZone: "",
  autoRegistrationPlacement: "normal",
  autoRegistrationWaitlistFallback: "true",
  autoRegistrationMaxTeams: "25",
  autoRegistrationLastRunKey: "",
  autoRegistrationGrantChannelId: "",
  autoRegistrationGrantChannelName: "auto-registration",
  autoRegistrationGrants: "",
  roleRemovalRequests: "",
  teamLogoReminderEnabled: "false",
  teamLogoReminderWeeklySchedule: "",
  teamLogoReminderTimeZone: "",
  teamLogoReminderIntervalMinutes: "30",
  teamLogoReminderMaxMessages: "6",
  teamLogoReminderMessageText:
    "{managers} Please upload or sync your team logo for {session}.\n\nMissing logos: {missingCount}/{totalCount}\n{missingTeams}",
  discordLogoChannelIds: "",
  resultReviewChannelId: "",
  matchResultPostChannelId: "",
  overallResultPostChannelId: "",
  finalResultPostChannelId: "",
  finalResultPostMessageId: "",
  finalResultPostBackupId: "",
  discordWidgetTemplateEnabled: "false",
  discordWidgetTemplateBackgroundUrl: "",
  discordWidgetCanvasPreset: "discord-default",
  discordWidgetCanvasWidth: "1200",
  discordWidgetCanvasHeight: "630",
  discordWidgetPrimaryColor: "",
  discordWidgetTextColor: "",
  discordWidgetMutedColor: "",
  discordWidgetRowColor: "",
  discordWidgetPanelOpacity: "",
  discordWidgetOverlayStrength: "0.58",
  discordWidgetSafeTop: "32",
  discordWidgetSafeRight: "32",
  discordWidgetSafeBottom: "32",
  discordWidgetSafeLeft: "32",
  discordWidgetOverlayLayers: "",
  discordWidgetCustomLayouts: "",
  discordRankingTableLayouts: "",
  discordStudioRendererEnabled: "false",
  discordStudioDesignId: "",
  discordStudioDesignName: "",
  discordStudioPageId: "",
  discordStudioPageName: "",
  discordStudioDesignJson: "",
  discordStudioContract: "",
  discordPausedChannelIds: "",
  finalResultWinnerCount: "3",
  finalResultPostTemplate: "{message}",
  finalResultRankEmojis: "",
  finalResultMessageTemplate: "{trophy} Final Results\n\n{winners}",
  finalResultWinnerRowTemplate:
    "{winnerEmoji} **{winnerTitle}:** {teamName} - {points} pts ({kills} kills)",
  discordMatchResultEyebrow: "Arenzyra Results",
  discordMatchResultTitle: "{matchName}",
  discordMatchResultSubtitle: "",
  discordOverallRankingEyebrow: "Overall Ranking",
  discordOverallRankingTitle: "{sessionOrMatchName}",
  discordOverallRankingSubtitle: "{overallRankingSubtitle}",
  discordTopMvpEyebrow: "Top MVP",
  discordTopMvpTitle: "{matchName}",
  discordTopMvpSubtitle: "Player impact leader",
  discordTopFraggersEyebrow: "Top Fraggers",
  discordTopFraggersTitle: "{matchName}",
  discordTopFraggersSubtitle: "Player elimination leaders",
  discordResultMatchSchedule: "",
  staffRoleId: "",
  staffRoleName: "Arenzyra Staff",
  playConfirmLabel: "Confirm",
  playConfirmEmoji: "\u2705",
  playConfirmStyle: "success",
  playNotPlayingLabel: "Not Playing",
  playNotPlayingEmoji: "\u274C",
  playNotPlayingStyle: "danger",
  playStatusRowStyle: "legacy",
  playStatusConfirmEmoji: "\u2705",
  playStatusNotPlayingEmoji: "\u274C",
  banControlsEnabled: "true",
  banDefaultScope: "SESSION",
  banDefaultDurationDays: "3",
  banDefaultReason: "Manual Discord ban",
  banServerAction: "ROLE",
  slotBanDefaultScope: "",
  slotBanDefaultDurationDays: "",
  slotBanDefaultReason: "",
  slotBanServerAction: "",
  slotBanRoleIds: "",
  banApplyRoleOnTeamBan: "false",
  banRoleIds: "",
  permanentBanRoleIds: "",
  registrationBanReaction: "",
} as const;

const DEFAULT_EVENT_REGISTRATION_MESSAGE_TEXT =
  "Register for {session} with this message format:\n\nTeam Name | Team Tag | @manager\n\nAttach the team logo image to the same message when available.";
const DEFAULT_EVENT_REGISTRATION_MESSAGE_TITLE = "Arenzyra Event Registration";
const LEGACY_TOURNAMENT_REGISTRATION_MESSAGE_TITLE =
  "Arenzyra Tournament Registration";
const DEFAULT_TOURNAMENT_REGISTRATION_MESSAGE_TEXT =
  "Register for {session} with this message format:\n\nteam name: Team Name\nteam tag: TEAMTAG\nteam manager: @manager\nplayer 1 name: Player Name @player\nplayer 1 uid: 123456789\n\nRepeat player rows for the required main players. Substitutes are optional, up to 2.";
const DEFAULT_TOURNAMENT_REGISTRATION_MESSAGE_TITLE =
  "Arenzyra Tournament Registration";

export type DiscordEmojiKey = Exclude<
  keyof typeof DEFAULT_DISCORD_EMOJIS,
  | "slotListMode"
  | "slotListMessageMode"
  | "waitlistMessageMode"
  | "slotStatusResponseEnabled"
  | "idpDmForwardingEnabled"
  | "confirmationMode"
  | "playControlMode"
  | "playButtonsEnabled"
  | "playConfirmationWeeklySchedule"
  | "playConfirmationOpenTime"
  | "playConfirmationCloseTime"
  | "playConfirmationWaitlistStartTime"
  | "playConfirmationTimeZone"
  | "playConfirmationOpensAt"
  | "playConfirmationClosesAt"
  | "playConfirmationMessageEnabled"
  | "playConfirmationMessageTitle"
  | "playConfirmationMessageText"
  | "playConfirmationCleanupEnabled"
  | "playConfirmationCleanupBanEnabled"
  | "playConfirmationCleanupReason"
  | "playConfirmationCleanupLastClosedAt"
  | "playCancellationCleanupEnabled"
  | "playCancellationCleanupDelayMinutes"
  | "playCancellationCleanupBanEnabled"
  | "playCancellationCleanupReason"
  | "playConfirmationWaitlistGraceMinutes"
  | "playConfirmationWaitlistGraceStartedAt"
  | "playConfirmationWaitlistGraceUntil"
  | "registrationWeeklySchedule"
  | "registrationTimeZone"
  | "waitlistPromotionWeeklySchedule"
  | "waitlistPromotionTimeZone"
  | "waitlistPromotionManualState"
  | "waitlistPromotionAutoOpenUntil"
  | "waitlistPromotionScheduleOverrideState"
  | "waitlistPromotionScheduleOverrideUpdatedAt"
  | "registrationMessageEnabled"
  | "registrationMessageDisplayMode"
  | "registrationMessageTitle"
  | "registrationMessageText"
  | "registrationStatusAnnouncementMode"
  | "registrationOpenAnnouncementTitle"
  | "registrationOpenAnnouncementText"
  | "registrationClosedAnnouncementTitle"
  | "registrationClosedAnnouncementText"
  | "registrationManualState"
  | "registrationScheduleOverrideState"
  | "registrationClosedDetailsHours"
  | "registrationOpeningSoonHours"
  | "registrationStatusAlwaysOpenText"
  | "registrationStatusOpenText"
  | "registrationStatusOpeningSoonText"
  | "registrationStatusClosedRecentText"
  | "registrationStatusClosedText"
  | "earlyAccessEnabled"
  | "earlyAccessWeeklySchedule"
  | "earlyAccessTimeZone"
  | "earlyAccessOpensAt"
  | "earlyAccessClosesAt"
  | "earlyAccessMessageEnabled"
  | "earlyAccessOpenMessageText"
  | "earlyAccessCloseMessageText"
  | "vipAccessEnabled"
  | "vipAccessWeeklySchedule"
  | "vipAccessTimeZone"
  | "vipAccessOpensAt"
  | "vipAccessClosesAt"
  | "vipAccessMessageEnabled"
  | "vipAccessOpenMessageText"
  | "vipAccessCloseMessageText"
  | "roleAccessGroups"
  | "autoRegistrationEnabled"
  | "autoRegistrationRoleId"
  | "autoRegistrationRoleName"
  | "autoRegistrationWeeklySchedule"
  | "autoRegistrationTimeZone"
  | "autoRegistrationPlacement"
  | "autoRegistrationWaitlistFallback"
  | "autoRegistrationMaxTeams"
  | "autoRegistrationLastRunKey"
  | "autoRegistrationGrantChannelId"
  | "autoRegistrationGrantChannelName"
  | "autoRegistrationGrants"
  | "roleRemovalRequests"
  | "teamLogoReminderEnabled"
  | "teamLogoReminderWeeklySchedule"
  | "teamLogoReminderTimeZone"
  | "teamLogoReminderIntervalMinutes"
  | "teamLogoReminderMaxMessages"
  | "teamLogoReminderMessageText"
  | "discordLogoChannelIds"
  | "resultReviewChannelId"
  | "matchResultPostChannelId"
  | "overallResultPostChannelId"
  | "finalResultPostChannelId"
  | "finalResultPostMessageId"
  | "finalResultPostBackupId"
  | "discordWidgetTemplateEnabled"
  | "discordWidgetTemplateBackgroundUrl"
  | "discordWidgetCanvasPreset"
  | "discordWidgetCanvasWidth"
  | "discordWidgetCanvasHeight"
  | "discordWidgetPrimaryColor"
  | "discordWidgetTextColor"
  | "discordWidgetMutedColor"
  | "discordWidgetRowColor"
  | "discordWidgetPanelOpacity"
  | "discordWidgetOverlayStrength"
  | "discordWidgetSafeTop"
  | "discordWidgetSafeRight"
  | "discordWidgetSafeBottom"
  | "discordWidgetSafeLeft"
  | "discordWidgetOverlayLayers"
  | "discordWidgetCustomLayouts"
  | "discordRankingTableLayouts"
  | "discordStudioRendererEnabled"
  | "discordStudioDesignId"
  | "discordStudioDesignName"
  | "discordStudioPageId"
  | "discordStudioPageName"
  | "discordStudioDesignJson"
  | "discordStudioContract"
  | "discordPausedChannelIds"
  | "finalResultWinnerCount"
  | "finalResultPostTemplate"
  | "finalResultRankEmojis"
  | "finalResultMessageTemplate"
  | "finalResultWinnerRowTemplate"
  | "discordMatchResultEyebrow"
  | "discordMatchResultTitle"
  | "discordMatchResultSubtitle"
  | "discordOverallRankingEyebrow"
  | "discordOverallRankingTitle"
  | "discordOverallRankingSubtitle"
  | "discordTopMvpEyebrow"
  | "discordTopMvpTitle"
  | "discordTopMvpSubtitle"
  | "discordTopFraggersEyebrow"
  | "discordTopFraggersTitle"
  | "discordTopFraggersSubtitle"
  | "discordResultMatchSchedule"
  | "staffRoleId"
  | "staffRoleName"
  | "playConfirmLabel"
  | "playConfirmEmoji"
  | "playConfirmStyle"
  | "playNotPlayingLabel"
  | "playNotPlayingEmoji"
  | "playNotPlayingStyle"
  | "playStatusRowStyle"
  | "playStatusConfirmEmoji"
  | "playStatusNotPlayingEmoji"
  | "banControlsEnabled"
  | "banDefaultScope"
  | "banDefaultDurationDays"
  | "banDefaultReason"
  | "banServerAction"
  | "slotBanDefaultScope"
  | "slotBanDefaultDurationDays"
  | "slotBanDefaultReason"
  | "slotBanServerAction"
  | "slotBanRoleIds"
  | "banApplyRoleOnTeamBan"
  | "banRoleIds"
  | "permanentBanRoleIds"
  | "registrationBanReaction"
>;
export type DiscordEmojiMap = Partial<Record<DiscordEmojiKey, string>> &
  Record<string, string | undefined>;

export type DiscordButtonStyleName =
  | "primary"
  | "secondary"
  | "success"
  | "danger";
export type PlayControlMode = "buttons" | "reactions" | "both" | "off";
export type PlayStatusRowStyle = "legacy" | "enhanced";
export type DiscordMessageDisplayMode = "plain" | "embed";
export type PlayConfirmationWindowState =
  | "always_open"
  | "not_open"
  | "open"
  | "closed";
export type RegistrationWindowState = PlayConfirmationWindowState;
export type RegistrationWindowSnapshot = {
  opensAt: Date | null;
  closesAt: Date | null;
  configured: boolean;
  state: RegistrationWindowState;
  allowsAction: boolean;
  mode: "manual" | "always" | "weekly" | "session";
  timeZone: string | null;
};
export type PlayConfirmationCleanupWindow = {
  configured: boolean;
  cleanupAt: Date | null;
  nextCleanupAt: Date | null;
  opensAt: Date | null;
  closesAt: Date | null;
  mode: "weekly" | "none";
  timeZone: string | null;
};
export type PlayConfirmationCloseWindow = {
  configured: boolean;
  closesAt: Date | null;
  nextClosesAt: Date | null;
  opensAt: Date | null;
  mode: "weekly" | "none";
  timeZone: string | null;
};
export type RoleAccessKind = "earlyAccess" | "vipAccess";
export type RoleAccessGroupMode = "normal" | "vip" | "both";
export type RoleAccessQualificationMode = "none" | "winner";
export type AutoRegistrationPlacement = "normal" | "vip";
export type WinnerQualification = {
  id: string;
  sourceSessionId: string;
  teamId: string;
  teamName: string;
  teamTag: string | null;
  managerDiscordIds: string[];
  rank: number;
  roleId: string;
  roleName: string;
  grantedAt: string;
  expiresAt: string;
  totalPoints: number | null;
  totalKills: number | null;
};
export type RoleAccessGroup = {
  id: string;
  name: string;
  roleId: string;
  roleName: string;
  mode: RoleAccessGroupMode;
  enabled: boolean;
  weeklySchedule: string;
  timeZone: string;
  messageEnabled: boolean;
  openMessageText: string;
  closeMessageText: string;
  managedState: "open" | "closed" | "";
  managedMessageId: string;
  qualificationMode: RoleAccessQualificationMode;
  winnerSourceSessionId: string;
  winnerSourceSessionName: string;
  winnerTopCount: number;
  winnerDurationDays: number;
  winnerRemoveRoleOnExpiry: boolean;
  winnerLastSyncedAt: string;
  winnerQualifications: WinnerQualification[];
};
export type AutoRegistrationConfig = {
  enabled: boolean;
  roleId: string;
  roleName: string;
  weeklySchedule: string;
  timeZone: string;
  placement: AutoRegistrationPlacement;
  waitlistFallback: boolean;
  maxTeams: number;
  lastRunKey: string;
};
export type TeamLogoReminderConfig = {
  enabled: boolean;
  weeklySchedule: string;
  timeZone: string;
  intervalMinutes: number;
  maxMessages: number;
  messageText: string;
};
export type AutoRegistrationGrant = {
  id: string;
  teamId: string;
  teamName: string;
  teamTag: string | null;
  managerDiscordId: string;
  managerDiscordUsername: string | null;
  managerDisplayName: string | null;
  roleId: string;
  roleName: string;
  grantedAt: string;
  expiresAt: string;
  createdByDiscordId: string;
  createdByLabel: string | null;
  sourceChannelId: string;
  sourceMessageId: string;
  roleAddedByBot: boolean;
};
export type RoleRemovalRequestKind = "auto-registration" | "winner";
export type RoleRemovalRequest = {
  id: string;
  kind: RoleRemovalRequestKind;
  grantId: string | null;
  groupId: string | null;
  qualificationId: string | null;
  teamId: string;
  teamName: string;
  teamTag: string | null;
  managerDiscordId: string;
  roleId: string;
  roleName: string;
  requestedAt: string;
  requestedBy: string | null;
};
export type RoleAccessWindowSnapshot = {
  opensAt: Date | null;
  closesAt: Date | null;
  configured: boolean;
  state: "open" | "closed";
  allowsAction: boolean;
  mode: "weekly" | "date" | "off";
  timeZone: string | null;
};

type RegistrationStatusConfig =
  | (Pick<SessionDiscordConfigResponse, "emojis"> &
      Partial<
        Pick<SessionDiscordConfigResponse, "disableSlotAndVipRegistration">
      >)
  | DiscordEmojiMap
  | null;

function registrationDisabled(config: RegistrationStatusConfig | undefined) {
  return Boolean(
    config &&
    "disableSlotAndVipRegistration" in config &&
    config.disableSlotAndVipRegistration,
  );
}

const LEGACY_EMOJI_VALUES: Record<string, DiscordEmojiKey> = {
  CHECK: "check",
  X: "reject",
  REJECT: "reject",
  WARNING: "warning",
  WAITLIST: "waitlist",
  BAN: "ban",
  VIP: "vip",
  SLOT: "slot",
};
const DISCORD_CHANNEL_ID_PATTERN = /^\d{15,25}$/;

function emojiMap(
  config?:
    | Pick<SessionDiscordConfigResponse, "emojis">
    | DiscordEmojiMap
    | null,
): DiscordEmojiMap | null {
  if (!config) {
    return null;
  }
  if (
    "emojis" in config &&
    config.emojis &&
    typeof config.emojis === "object" &&
    !Array.isArray(config.emojis)
  ) {
    return config.emojis as DiscordEmojiMap;
  }
  return config as DiscordEmojiMap;
}

export function resolveDiscordEmoji(
  key: DiscordEmojiKey,
  config?:
    | Pick<SessionDiscordConfigResponse, "emojis">
    | DiscordEmojiMap
    | null,
) {
  const value = emojiMap(config)?.[key]?.trim();
  if (!value) {
    return DEFAULT_DISCORD_EMOJIS[key];
  }

  const legacyKey = LEGACY_EMOJI_VALUES[value.toUpperCase()];
  if (legacyKey) {
    return DEFAULT_DISCORD_EMOJIS[legacyKey];
  }

  return value;
}

export function configuredDiscordEmoji(
  key: string,
  fallbackKey: DiscordEmojiKey,
  config?:
    | Pick<SessionDiscordConfigResponse, "emojis">
    | DiscordEmojiMap
    | null,
) {
  const value = emojiMap(config)?.[key]?.trim();
  if (!value) {
    return resolveDiscordEmoji(fallbackKey, config);
  }

  const legacyKey = LEGACY_EMOJI_VALUES[value.toUpperCase()];
  return legacyKey ? DEFAULT_DISCORD_EMOJIS[legacyKey] : value;
}

export function slotListDisplayMode(
  config?:
    | Pick<SessionDiscordConfigResponse, "emojis">
    | DiscordEmojiMap
    | null,
) {
  return emojiMap(config)?.slotListMode === "emoji" ? "emoji" : "number";
}

export function slotListMessageMode(
  config?:
    | Pick<SessionDiscordConfigResponse, "emojis">
    | DiscordEmojiMap
    | null,
) {
  return emojiMap(config)?.slotListMessageMode === "plain" ? "plain" : "embed";
}

export function waitlistMessageMode(
  config?:
    | Pick<SessionDiscordConfigResponse, "emojis">
    | DiscordEmojiMap
    | null,
) {
  return emojiMap(config)?.waitlistMessageMode === "plain" ? "plain" : "embed";
}

export function parseDiscordPausedChannelIds(
  config?:
    | Pick<SessionDiscordConfigResponse, "emojis">
    | DiscordEmojiMap
    | null,
) {
  const emojis = emojiMap(config) as Record<string, string> | null;
  const raw = emojis?.discordPausedChannelIds?.trim() ?? "";
  if (!raw) {
    return [];
  }

  let values: unknown = raw;
  try {
    values = JSON.parse(raw) as unknown;
  } catch {
    values = raw;
  }

  const candidates = Array.isArray(values)
    ? values
    : typeof values === "string"
      ? values.split(/[\s,]+/)
      : [];

  return [
    ...new Set(
      candidates
        .map((value) => String(value).trim())
        .filter((value) => DISCORD_CHANNEL_ID_PATTERN.test(value)),
    ),
  ];
}

export function serializeDiscordPausedChannelIds(channelIds: Iterable<string>) {
  const values = [
    ...new Set(
      [...channelIds]
        .map((value) => value.trim())
        .filter((value) => DISCORD_CHANNEL_ID_PATTERN.test(value)),
    ),
  ];
  return values.length ? JSON.stringify(values) : "";
}

export function isDiscordChannelPaused(
  config:
    | Pick<SessionDiscordConfigResponse, "emojis">
    | DiscordEmojiMap
    | null
    | undefined,
  channelId: string | null | undefined,
) {
  const cleanChannelId = channelId?.trim();
  if (!cleanChannelId) {
    return false;
  }
  return parseDiscordPausedChannelIds(config).includes(cleanChannelId);
}

export function confirmationDisplayMode(
  config?:
    | Pick<SessionDiscordConfigResponse, "emojis">
    | DiscordEmojiMap
    | null,
) {
  return emojiMap(config)?.confirmationMode === "emoji" ? "emoji" : "text";
}

export function playConfirmationButtonsEnabled(
  config?:
    | Pick<SessionDiscordConfigResponse, "emojis">
    | DiscordEmojiMap
    | null,
) {
  const mode = playConfirmationControlMode(config);
  return mode === "buttons" || mode === "both";
}

export function playConfirmationReactionsEnabled(
  config?:
    | Pick<SessionDiscordConfigResponse, "emojis">
    | DiscordEmojiMap
    | null,
) {
  const mode = playConfirmationControlMode(config);
  return mode === "reactions" || mode === "both";
}

export function playConfirmationControlMode(
  config?:
    | Pick<SessionDiscordConfigResponse, "emojis">
    | DiscordEmojiMap
    | null,
): PlayControlMode {
  const emojis = emojiMap(config);
  const mode = emojis?.playControlMode?.trim().toLowerCase();
  if (
    mode === "buttons" ||
    mode === "reactions" ||
    mode === "both" ||
    mode === "off"
  ) {
    return mode;
  }

  return emojis?.playButtonsEnabled === "false" ? "off" : "buttons";
}

export function playStatusRowStyle(
  config?:
    | Pick<SessionDiscordConfigResponse, "emojis">
    | DiscordEmojiMap
    | null,
): PlayStatusRowStyle {
  return emojiMap(config)?.playStatusRowStyle === "enhanced"
    ? "enhanced"
    : "legacy";
}

export function playStatusRowEmoji(
  status: "CONFIRM" | "NOT_PLAYING",
  config?:
    | Pick<SessionDiscordConfigResponse, "emojis">
    | DiscordEmojiMap
    | null,
) {
  return configuredDiscordEmoji(
    status === "CONFIRM"
      ? "playStatusConfirmEmoji"
      : "playStatusNotPlayingEmoji",
    status === "CONFIRM" ? "check" : "reject",
    config,
  );
}

export function playConfirmationWindow(
  config?:
    | Pick<SessionDiscordConfigResponse, "emojis">
    | DiscordEmojiMap
    | null,
  now = new Date(),
) {
  const weeklyWindow = weeklyPlayConfirmationWindow(config, now);
  if (weeklyWindow) {
    return applyPlayConfirmationWaitlistGrace(weeklyWindow, config, now);
  }

  const dailyWindow = dailyPlayConfirmationWindow(config, now);
  if (dailyWindow) {
    return applyPlayConfirmationWaitlistGrace(dailyWindow, config, now);
  }

  const opensAt = configuredDate(config, "playConfirmationOpensAt");
  const closesAt = configuredDate(config, "playConfirmationClosesAt");
  const configured = Boolean(opensAt || closesAt);
  let state: PlayConfirmationWindowState = configured ? "open" : "always_open";

  if (closesAt && now >= closesAt) {
    state = "closed";
  } else if (opensAt && now < opensAt) {
    state = "not_open";
  }

  return applyPlayConfirmationWaitlistGrace(
    {
      opensAt,
      closesAt,
      configured,
      state,
      allowsAction: state === "always_open" || state === "open",
      mode: "absolute" as const,
      timeZone: null,
      waitlistStartsAt: null,
    },
    config,
    now,
  );
}

function applyPlayConfirmationWaitlistGrace<
  T extends {
    opensAt: Date | null;
    closesAt: Date | null;
    configured: boolean;
    state: PlayConfirmationWindowState;
    allowsAction: boolean;
    mode: string;
    timeZone: string | null;
    waitlistStartsAt: Date | null;
  },
>(
  window: T,
  config?:
    | Pick<SessionDiscordConfigResponse, "emojis">
    | DiscordEmojiMap
    | null,
  now = new Date(),
): T {
  const graceUntil = configuredDate(
    config,
    "playConfirmationWaitlistGraceUntil",
  );
  if (
    !graceUntil ||
    now >= graceUntil ||
    window.allowsAction ||
    window.state !== "closed"
  ) {
    return window;
  }

  return {
    ...window,
    closesAt: graceUntil,
    configured: true,
    state: "open",
    allowsAction: true,
  };
}

export function playConfirmationWaitlistGraceUntil(
  config?:
    | Pick<SessionDiscordConfigResponse, "emojis">
    | DiscordEmojiMap
    | null,
) {
  return configuredDate(config, "playConfirmationWaitlistGraceUntil");
}

export function playConfirmationCleanupWindow(
  config?:
    | Pick<SessionDiscordConfigResponse, "emojis">
    | DiscordEmojiMap
    | null,
  now = new Date(),
): PlayConfirmationCleanupWindow {
  const schedule = parseWeeklyConfirmationSchedule(config);
  if (schedule.length === 0) {
    return {
      configured: false,
      cleanupAt: null,
      nextCleanupAt: null,
      opensAt: null,
      closesAt: null,
      mode: "none",
      timeZone: null,
    };
  }

  const timeZone = configuredTimeZone(config);
  const currentParts = zonedDateParts(now, timeZone);
  const intervals = weeklyConfirmationIntervals(
    schedule,
    timeZone,
    currentParts,
  );
  const previousInterval = intervals
    .filter((interval) => interval.cleanupAt <= now)
    .at(-1);
  const nextInterval = intervals.find((interval) => interval.cleanupAt > now);

  return {
    configured: true,
    cleanupAt: previousInterval?.cleanupAt ?? null,
    nextCleanupAt: nextInterval?.cleanupAt ?? null,
    opensAt: previousInterval?.opensAt ?? nextInterval?.opensAt ?? null,
    closesAt: previousInterval?.closesAt ?? nextInterval?.closesAt ?? null,
    mode: "weekly",
    timeZone,
  };
}

export function playConfirmationCloseWindow(
  config?:
    | Pick<SessionDiscordConfigResponse, "emojis">
    | DiscordEmojiMap
    | null,
  now = new Date(),
): PlayConfirmationCloseWindow {
  const schedule = parseWeeklyConfirmationSchedule(config);
  if (schedule.length === 0) {
    return {
      configured: false,
      closesAt: null,
      nextClosesAt: null,
      opensAt: null,
      mode: "none",
      timeZone: null,
    };
  }

  const timeZone = configuredTimeZone(config);
  const currentParts = zonedDateParts(now, timeZone);
  const intervals = weeklyConfirmationIntervals(
    schedule,
    timeZone,
    currentParts,
  );
  const previousInterval = intervals
    .filter((interval) => interval.closesAt <= now)
    .at(-1);
  const nextInterval = intervals.find((interval) => interval.closesAt > now);

  return {
    configured: true,
    closesAt: previousInterval?.closesAt ?? null,
    nextClosesAt: nextInterval?.closesAt ?? null,
    opensAt: previousInterval?.opensAt ?? nextInterval?.opensAt ?? null,
    mode: "weekly",
    timeZone,
  };
}

export function playCancellationCleanupWindow(
  config?:
    | Pick<SessionDiscordConfigResponse, "emojis">
    | DiscordEmojiMap
    | null,
  now = new Date(),
) {
  const schedule = parseWeeklyConfirmationSchedule(config);
  if (schedule.length === 0) {
    return {
      configured: false,
      cleanupAt: null,
      nextCleanupAt: null,
      noBanUntilAt: null,
      banUntilAt: null,
      mode: "none" as const,
      timeZone: null,
    };
  }

  const timeZone = configuredTimeZone(config);
  const currentParts = zonedDateParts(now, timeZone);
  const intervals = weeklyConfirmationIntervals(
    schedule,
    timeZone,
    currentParts,
  );
  const previousInterval = intervals
    .filter((interval) => interval.cleanupAt <= now)
    .at(-1);
  const nextInterval = intervals.find((interval) => interval.cleanupAt > now);

  return {
    configured: true,
    cleanupAt: previousInterval?.cleanupAt ?? null,
    nextCleanupAt: nextInterval?.cleanupAt ?? null,
    noBanUntilAt: previousInterval?.cancelNoBanUntilAt ?? null,
    banUntilAt: previousInterval?.cancelBanUntilAt ?? null,
    mode: "weekly" as const,
    timeZone,
  };
}

export function waitlistPromotionAutoOpenUntil(
  config?:
    | Pick<SessionDiscordConfigResponse, "emojis">
    | DiscordEmojiMap
    | null,
) {
  return configuredDate(config, "waitlistPromotionAutoOpenUntil");
}

function temporaryWaitlistPromotionWindow(
  config?:
    | Pick<SessionDiscordConfigResponse, "emojis">
    | DiscordEmojiMap
    | null,
  now = new Date(),
): RegistrationWindowSnapshot | null {
  const autoOpenUntil = waitlistPromotionAutoOpenUntil(config);
  if (!autoOpenUntil || now >= autoOpenUntil) {
    return null;
  }

  return {
    opensAt: null,
    closesAt: autoOpenUntil,
    configured: true,
    state: "open",
    allowsAction: true,
    mode: "manual",
    timeZone: null,
  };
}

export function registrationWindow(
  config?:
    | Pick<SessionDiscordConfigResponse, "emojis">
    | DiscordEmojiMap
    | null,
  now = new Date(),
): RegistrationWindowSnapshot {
  const schedule = parseWeeklyRegistrationSchedule(config);
  if (schedule.length > 0) {
    const overrideState = configuredRegistrationScheduleOverrideState(config);
    if (overrideState) {
      return {
        opensAt: null,
        closesAt: null,
        configured: true,
        state:
          overrideState === "open"
            ? ("always_open" as RegistrationWindowState)
            : ("closed" as RegistrationWindowState),
        allowsAction: overrideState === "open",
        mode: "manual" as const,
        timeZone: null,
      };
    }

    const timeZone = configuredRegistrationTimeZone(config);
    const currentParts = zonedDateParts(now, timeZone);
    const intervals = weeklyRegistrationIntervals(
      schedule,
      timeZone,
      currentParts,
    );
    const activeInterval = intervals.find(
      (interval) => interval.opensAt <= now && now < interval.closesAt,
    );
    if (activeInterval) {
      return {
        opensAt: activeInterval.opensAt,
        closesAt: activeInterval.closesAt,
        configured: true,
        state: "open" as RegistrationWindowState,
        allowsAction: true,
        mode: "weekly" as const,
        timeZone,
      };
    }

    const nextInterval = intervals.find((interval) => interval.opensAt > now);
    const previousInterval = intervals
      .filter((interval) => interval.closesAt <= now)
      .at(-1);

    return {
      opensAt: nextInterval?.opensAt ?? null,
      closesAt: previousInterval?.closesAt ?? null,
      configured: true,
      state:
        nextInterval &&
        isSameZonedDate(nextInterval.opensAt, currentParts, timeZone)
          ? ("not_open" as RegistrationWindowState)
          : ("closed" as RegistrationWindowState),
      allowsAction: false,
      mode: "weekly" as const,
      timeZone,
    };
  }

  const manualState = configuredRegistrationManualState(config);
  if (manualState) {
    return {
      opensAt: null,
      closesAt: null,
      configured: true,
      state:
        manualState === "open"
          ? ("always_open" as RegistrationWindowState)
          : ("closed" as RegistrationWindowState),
      allowsAction: manualState === "open",
      mode: "manual" as const,
      timeZone: null,
    };
  }

  return {
    opensAt: null,
    closesAt: null,
    configured: false,
    state: "always_open" as RegistrationWindowState,
    allowsAction: true,
    mode: "always" as const,
    timeZone: null,
  };
}

export function waitlistPromotionWindow(
  config?:
    | Pick<SessionDiscordConfigResponse, "emojis">
    | DiscordEmojiMap
    | null,
  now = new Date(),
): RegistrationWindowSnapshot {
  const schedule = parseWeeklyWaitlistPromotionSchedule(config);
  if (schedule.length > 0) {
    const overrideState =
      configuredWaitlistPromotionScheduleOverrideState(config);
    if (overrideState) {
      return {
        opensAt: null,
        closesAt: null,
        configured: true,
        state: overrideState === "open" ? "always_open" : "closed",
        allowsAction: overrideState === "open",
        mode: "manual",
        timeZone: null,
      };
    }

    const timeZone = configuredWaitlistPromotionTimeZone(config);
    const currentParts = zonedDateParts(now, timeZone);
    const intervals = weeklyRegistrationIntervals(
      schedule,
      timeZone,
      currentParts,
    );
    const activeInterval = intervals.find(
      (interval) => interval.opensAt <= now && now < interval.closesAt,
    );
    if (activeInterval) {
      return {
        opensAt: activeInterval.opensAt,
        closesAt: activeInterval.closesAt,
        configured: true,
        state: "open",
        allowsAction: true,
        mode: "weekly",
        timeZone,
      };
    }

    const nextInterval = intervals.find((interval) => interval.opensAt > now);
    const previousInterval = intervals
      .filter((interval) => interval.closesAt <= now)
      .at(-1);

    return {
      opensAt: nextInterval?.opensAt ?? null,
      closesAt: previousInterval?.closesAt ?? null,
      configured: true,
      state:
        nextInterval &&
        isSameZonedDate(nextInterval.opensAt, currentParts, timeZone)
          ? "not_open"
          : "closed",
      allowsAction: false,
      mode: "weekly",
      timeZone,
    };
  }

  const manualState = configuredWaitlistPromotionManualState(config);
  if (manualState) {
    return {
      opensAt: null,
      closesAt: null,
      configured: true,
      state: manualState === "open" ? "always_open" : "closed",
      allowsAction: manualState === "open",
      mode: "manual",
      timeZone: null,
    };
  }

  const temporaryWindow = temporaryWaitlistPromotionWindow(config, now);
  if (temporaryWindow) {
    return temporaryWindow;
  }

  return {
    opensAt: null,
    closesAt: null,
    configured: false,
    state: "closed",
    allowsAction: false,
    mode: "manual",
    timeZone: null,
  };
}

export function roleAccessWindow(
  config?:
    | Pick<SessionDiscordConfigResponse, "emojis">
    | DiscordEmojiMap
    | null,
  kind: RoleAccessKind = "earlyAccess",
  now = new Date(),
): RoleAccessWindowSnapshot {
  const emojis = emojiMap(config);
  const enabled = emojis?.[`${kind}Enabled`]?.trim() === "true";
  if (!enabled) {
    return {
      opensAt: null,
      closesAt: null,
      configured: false,
      state: "closed",
      allowsAction: false,
      mode: "off",
      timeZone: null,
    };
  }

  const schedule = parseWeeklyRoleAccessSchedule(config, kind);
  if (schedule.length > 0) {
    const timeZone = configuredRoleAccessTimeZone(config, kind);
    const currentParts = zonedDateParts(now, timeZone);
    const intervals = weeklyRegistrationIntervals(
      schedule,
      timeZone,
      currentParts,
    );
    const activeInterval = intervals.find(
      (interval) => interval.opensAt <= now && now < interval.closesAt,
    );
    if (activeInterval) {
      return {
        opensAt: activeInterval.opensAt,
        closesAt: activeInterval.closesAt,
        configured: true,
        state: "open",
        allowsAction: true,
        mode: "weekly",
        timeZone,
      };
    }

    const nextInterval = intervals.find((interval) => interval.opensAt > now);
    const previousInterval = intervals
      .filter((interval) => interval.closesAt <= now)
      .at(-1);

    return {
      opensAt: nextInterval?.opensAt ?? null,
      closesAt: previousInterval?.closesAt ?? null,
      configured: true,
      state: "closed",
      allowsAction: false,
      mode: "weekly",
      timeZone,
    };
  }

  const opensAtText = emojis?.[`${kind}OpensAt`]?.trim() ?? "";
  const closesAtText = emojis?.[`${kind}ClosesAt`]?.trim() ?? "";
  const opensAt = opensAtText ? new Date(opensAtText) : null;
  const closesAt = closesAtText ? new Date(closesAtText) : null;
  const configured =
    opensAt !== null &&
    closesAt !== null &&
    !Number.isNaN(opensAt.getTime()) &&
    !Number.isNaN(closesAt.getTime()) &&
    opensAt < closesAt;
  const allowsAction =
    configured &&
    opensAt!.getTime() <= now.getTime() &&
    now.getTime() < closesAt!.getTime();

  return {
    opensAt: configured ? opensAt : null,
    closesAt: configured ? closesAt : null,
    configured,
    state: allowsAction ? "open" : "closed",
    allowsAction,
    mode: configured ? "date" : "off",
    timeZone: null,
  };
}

export function parseRoleAccessGroups(
  config?:
    | Pick<SessionDiscordConfigResponse, "emojis">
    | DiscordEmojiMap
    | null,
): RoleAccessGroup[] {
  const raw = emojiMap(config)?.roleAccessGroups?.trim();
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    const source =
      Array.isArray(parsed)
        ? parsed
        : parsed &&
            typeof parsed === "object" &&
            Array.isArray((parsed as Record<string, unknown>).groups)
          ? ((parsed as Record<string, unknown>).groups as unknown[])
          : [];
    const seenIds = new Set<string>();
    return source
      .map((entry, index): RoleAccessGroup | null => {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
          return null;
        }
        const record = entry as Record<string, unknown>;
        let id = normalizeRoleAccessGroupId(record.id, index);
        while (seenIds.has(id)) {
          id = `${id}-${index + 1}`;
        }
        seenIds.add(id);
        const weeklySchedule =
          typeof record.weeklySchedule === "string"
            ? record.weeklySchedule
            : record.weeklySchedule &&
                typeof record.weeklySchedule === "object" &&
                !Array.isArray(record.weeklySchedule)
              ? JSON.stringify(record.weeklySchedule)
              : "";
        const managedState = stringValue(record.managedState)
          .trim()
          .toLowerCase();
        const qualificationMode =
          stringValue(record.qualificationMode).trim().toLowerCase() ===
          "winner"
            ? "winner"
            : "none";
        return {
          id,
          name: stringValue(record.name).trim() || `Access Group ${index + 1}`,
          roleId: stringValue(record.roleId).trim(),
          roleName: stringValue(record.roleName).trim(),
          mode: normalizeRoleAccessGroupMode(record.mode),
          enabled: booleanFromUnknown(record.enabled, true),
          weeklySchedule,
          timeZone: stringValue(record.timeZone).trim(),
          messageEnabled: booleanFromUnknown(record.messageEnabled, true),
          openMessageText:
            stringValue(record.openMessageText).trim() ||
            "{role} {name} registration is open for {session}.",
          closeMessageText:
            stringValue(record.closeMessageText).trim() ||
            "{name} registration is closed for {session}.",
          managedState:
            managedState === "open" || managedState === "closed"
              ? managedState
              : "",
          managedMessageId: stringValue(record.managedMessageId).trim(),
          qualificationMode,
          winnerSourceSessionId: stringValue(record.winnerSourceSessionId).trim(),
          winnerSourceSessionName: stringValue(record.winnerSourceSessionName).trim(),
          winnerTopCount: integerFromUnknown(record.winnerTopCount, 1, 1, 25),
          winnerDurationDays: integerFromUnknown(
            record.winnerDurationDays,
            1,
            1,
            365,
          ),
          winnerRemoveRoleOnExpiry: booleanFromUnknown(
            record.winnerRemoveRoleOnExpiry,
            true,
          ),
          winnerLastSyncedAt: stringValue(record.winnerLastSyncedAt).trim(),
          winnerQualifications: parseWinnerQualifications(
            record.winnerQualifications,
          ),
        };
      })
      .filter((entry): entry is RoleAccessGroup => Boolean(entry));
  } catch {
    return [];
  }
}

function parseWinnerQualifications(value: unknown): WinnerQualification[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry): WinnerQualification | null => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        return null;
      }
      const record = entry as Record<string, unknown>;
      const id = stringValue(record.id).trim();
      const sourceSessionId = stringValue(record.sourceSessionId).trim();
      const teamId = stringValue(record.teamId).trim();
      const teamName = stringValue(record.teamName).trim();
      const managerDiscordIds = Array.isArray(record.managerDiscordIds)
        ? record.managerDiscordIds
            .map((managerId) => stringValue(managerId).trim())
            .filter(Boolean)
        : [];
      const grantedAt = stringValue(record.grantedAt).trim();
      const expiresAt = stringValue(record.expiresAt).trim();
      const roleId = stringValue(record.roleId).trim();
      if (
        !id ||
        !sourceSessionId ||
        !teamId ||
        !teamName ||
        managerDiscordIds.length === 0 ||
        !grantedAt ||
        !expiresAt ||
        !roleId
      ) {
        return null;
      }
      return {
        id,
        sourceSessionId,
        teamId,
        teamName,
        teamTag: stringValue(record.teamTag).trim() || null,
        managerDiscordIds,
        rank: integerFromUnknown(record.rank, 1, 1, 1000),
        roleId,
        roleName: stringValue(record.roleName).trim(),
        grantedAt,
        expiresAt,
        totalPoints:
          typeof record.totalPoints === "number" &&
          Number.isFinite(record.totalPoints)
            ? record.totalPoints
            : null,
        totalKills:
          typeof record.totalKills === "number" &&
          Number.isFinite(record.totalKills)
            ? record.totalKills
            : null,
      };
    })
    .filter((entry): entry is WinnerQualification => Boolean(entry));
}

export function roleAccessGroupWindow(
  group: RoleAccessGroup,
  config?:
    | Pick<SessionDiscordConfigResponse, "emojis">
    | DiscordEmojiMap
    | null,
  now = new Date(),
): RoleAccessWindowSnapshot {
  if (!group.enabled) {
    return {
      opensAt: null,
      closesAt: null,
      configured: false,
      state: "closed",
      allowsAction: false,
      mode: "off",
      timeZone: null,
    };
  }

  const schedule = parseWeeklyRoleAccessScheduleText(group.weeklySchedule);
  if (schedule.length === 0) {
    return {
      opensAt: null,
      closesAt: null,
      configured: false,
      state: "closed",
      allowsAction: false,
      mode: "off",
      timeZone: null,
    };
  }

  const timeZone = configuredRoleAccessGroupTimeZone(group, config);
  const currentParts = zonedDateParts(now, timeZone);
  const intervals = weeklyRegistrationIntervals(
    schedule,
    timeZone,
    currentParts,
  );
  const activeInterval = intervals.find(
    (interval) => interval.opensAt <= now && now < interval.closesAt,
  );
  if (activeInterval) {
    return {
      opensAt: activeInterval.opensAt,
      closesAt: activeInterval.closesAt,
      configured: true,
      state: "open",
      allowsAction: true,
      mode: "weekly",
      timeZone,
    };
  }

  const nextInterval = intervals.find((interval) => interval.opensAt > now);
  const previousInterval = intervals
    .filter((interval) => interval.closesAt <= now)
    .at(-1);

  return {
    opensAt: nextInterval?.opensAt ?? null,
    closesAt: previousInterval?.closesAt ?? null,
    configured: true,
    state: "closed",
    allowsAction: false,
    mode: "weekly",
    timeZone,
  };
}

function normalizeAutoRegistrationPlacement(
  value: unknown,
): AutoRegistrationPlacement {
  return stringValue(value).trim().toLowerCase() === "vip" ? "vip" : "normal";
}

function integerFromUnknown(value: unknown, fallback: number, min: number, max: number) {
  const parsed =
    typeof value === "number"
      ? value
      : Number.parseInt(stringValue(value).trim(), 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

export function parseAutoRegistrationConfig(
  config?:
    | Pick<SessionDiscordConfigResponse, "emojis">
    | DiscordEmojiMap
    | null,
): AutoRegistrationConfig {
  const emojis = emojiMap(config);
  return {
    enabled: emojis?.autoRegistrationEnabled?.trim() === "true",
    roleId: emojis?.autoRegistrationRoleId?.trim() ?? "",
    roleName: emojis?.autoRegistrationRoleName?.trim() ?? "",
    weeklySchedule: emojis?.autoRegistrationWeeklySchedule?.trim() ?? "",
    timeZone: emojis?.autoRegistrationTimeZone?.trim() ?? "",
    placement: normalizeAutoRegistrationPlacement(
      emojis?.autoRegistrationPlacement,
    ),
    waitlistFallback: emojis?.autoRegistrationWaitlistFallback !== "false",
    maxTeams: integerFromUnknown(emojis?.autoRegistrationMaxTeams, 25, 1, 100),
    lastRunKey: emojis?.autoRegistrationLastRunKey?.trim() ?? "",
  };
}

export function parseTeamLogoReminderConfig(
  config?:
    | Pick<SessionDiscordConfigResponse, "emojis">
    | DiscordEmojiMap
    | null,
): TeamLogoReminderConfig {
  const emojis = emojiMap(config);
  return {
    enabled: emojis?.teamLogoReminderEnabled?.trim() === "true",
    weeklySchedule: emojis?.teamLogoReminderWeeklySchedule?.trim() ?? "",
    timeZone: emojis?.teamLogoReminderTimeZone?.trim() ?? "",
    intervalMinutes: integerFromUnknown(
      emojis?.teamLogoReminderIntervalMinutes,
      30,
      1,
      180,
    ),
    maxMessages: integerFromUnknown(emojis?.teamLogoReminderMaxMessages, 6, 1, 24),
    messageText:
      emojis?.teamLogoReminderMessageText?.trim() ||
      DEFAULT_DISCORD_EMOJIS.teamLogoReminderMessageText,
  };
}

function stringOrNull(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  return text || null;
}

function parseAutoRegistrationGrantEntry(
  value: unknown,
): AutoRegistrationGrant | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const id = stringValue(record.id).trim();
  const teamId = stringValue(record.teamId).trim();
  const teamName = stringValue(record.teamName).trim();
  const managerDiscordId = stringValue(record.managerDiscordId).trim();
  const roleId = stringValue(record.roleId).trim();
  const grantedAt = stringValue(record.grantedAt).trim();
  const expiresAt = stringValue(record.expiresAt).trim();
  const createdByDiscordId = stringValue(record.createdByDiscordId).trim();
  const sourceChannelId = stringValue(record.sourceChannelId).trim();
  const sourceMessageId = stringValue(record.sourceMessageId).trim();
  if (
    !id ||
    !teamId ||
    !teamName ||
    !managerDiscordId ||
    !roleId ||
    !grantedAt ||
    !expiresAt ||
    !createdByDiscordId ||
    !sourceChannelId ||
    !sourceMessageId ||
    Number.isNaN(Date.parse(grantedAt)) ||
    Number.isNaN(Date.parse(expiresAt))
  ) {
    return null;
  }
  return {
    id,
    teamId,
    teamName,
    teamTag: stringOrNull(record.teamTag),
    managerDiscordId,
    managerDiscordUsername: stringOrNull(record.managerDiscordUsername),
    managerDisplayName: stringOrNull(record.managerDisplayName),
    roleId,
    roleName: stringValue(record.roleName).trim(),
    grantedAt,
    expiresAt,
    createdByDiscordId,
    createdByLabel: stringOrNull(record.createdByLabel),
    sourceChannelId,
    sourceMessageId,
    roleAddedByBot: record.roleAddedByBot === true,
  };
}

export function parseAutoRegistrationGrants(
  config?:
    | Pick<SessionDiscordConfigResponse, "emojis">
    | DiscordEmojiMap
    | null,
): AutoRegistrationGrant[] {
  const raw = emojiMap(config)?.autoRegistrationGrants?.trim();
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    const entries = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === "object"
        ? (parsed as { grants?: unknown }).grants
        : null;
    if (!Array.isArray(entries)) {
      return [];
    }
    return entries
      .map(parseAutoRegistrationGrantEntry)
      .filter((entry): entry is AutoRegistrationGrant => Boolean(entry));
  } catch {
    return [];
  }
}

export function activeAutoRegistrationGrants(
  config?:
    | Pick<SessionDiscordConfigResponse, "emojis">
    | DiscordEmojiMap
    | null,
  now = new Date(),
) {
  const nowMs = now.getTime();
  return parseAutoRegistrationGrants(config).filter(
    (grant) => Date.parse(grant.expiresAt) > nowMs,
  );
}

export function serializeAutoRegistrationGrants(
  grants: AutoRegistrationGrant[],
) {
  const clean = grants
    .map((grant) => ({
      ...grant,
      teamTag: grant.teamTag?.trim() || null,
      managerDiscordUsername: grant.managerDiscordUsername?.trim() || null,
      managerDisplayName: grant.managerDisplayName?.trim() || null,
      roleName: grant.roleName?.trim() || "",
      createdByLabel: grant.createdByLabel?.trim() || null,
    }))
    .filter(
      (grant) =>
        grant.id &&
        grant.teamId &&
        grant.teamName &&
        grant.managerDiscordId &&
        grant.roleId &&
        grant.expiresAt,
    );
  return clean.length ? JSON.stringify({ grants: clean }) : "";
}

function normalizeRoleRemovalRequestKind(
  value: unknown,
): RoleRemovalRequestKind | null {
  const clean = stringValue(value).trim().toLowerCase();
  return clean === "auto-registration" || clean === "winner" ? clean : null;
}

function parseRoleRemovalRequestEntry(
  value: unknown,
): RoleRemovalRequest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const id = stringValue(record.id).trim();
  const kind = normalizeRoleRemovalRequestKind(record.kind);
  const teamId = stringValue(record.teamId).trim();
  const teamName = stringValue(record.teamName).trim();
  const managerDiscordId = stringValue(record.managerDiscordId).trim();
  const roleId = stringValue(record.roleId).trim();
  const requestedAt = stringValue(record.requestedAt).trim();
  if (
    !id ||
    !kind ||
    !teamId ||
    !teamName ||
    !managerDiscordId ||
    !roleId ||
    !requestedAt ||
    Number.isNaN(Date.parse(requestedAt))
  ) {
    return null;
  }
  return {
    id,
    kind,
    grantId: stringOrNull(record.grantId),
    groupId: stringOrNull(record.groupId),
    qualificationId: stringOrNull(record.qualificationId),
    teamId,
    teamName,
    teamTag: stringOrNull(record.teamTag),
    managerDiscordId,
    roleId,
    roleName: stringValue(record.roleName).trim(),
    requestedAt,
    requestedBy: stringOrNull(record.requestedBy),
  };
}

export function parseRoleRemovalRequests(
  config?:
    | Pick<SessionDiscordConfigResponse, "emojis">
    | DiscordEmojiMap
    | null,
): RoleRemovalRequest[] {
  const raw = emojiMap(config)?.roleRemovalRequests?.trim();
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    const entries = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === "object"
        ? (parsed as { requests?: unknown }).requests
        : null;
    if (!Array.isArray(entries)) {
      return [];
    }
    const seen = new Set<string>();
    return entries
      .map(parseRoleRemovalRequestEntry)
      .filter((entry): entry is RoleRemovalRequest => {
        if (!entry || seen.has(entry.id)) {
          return false;
        }
        seen.add(entry.id);
        return true;
      });
  } catch {
    return [];
  }
}

export function serializeRoleRemovalRequests(
  requests: RoleRemovalRequest[],
) {
  const clean = requests
    .map((request) => ({
      ...request,
      grantId: request.grantId?.trim() || null,
      groupId: request.groupId?.trim() || null,
      qualificationId: request.qualificationId?.trim() || null,
      teamTag: request.teamTag?.trim() || null,
      roleName: request.roleName?.trim() || "",
      requestedBy: request.requestedBy?.trim() || null,
    }))
    .filter(
      (request) =>
        request.id &&
        (request.kind === "auto-registration" || request.kind === "winner") &&
        request.teamId &&
        request.teamName &&
        request.managerDiscordId &&
        request.roleId &&
        request.requestedAt,
    );
  return clean.length ? JSON.stringify({ requests: clean }) : "";
}

export function autoRegistrationWindow(
  config?:
    | Pick<SessionDiscordConfigResponse, "emojis">
    | DiscordEmojiMap
    | null,
  now = new Date(),
): RoleAccessWindowSnapshot {
  const autoConfig = parseAutoRegistrationConfig(config);
  if (!autoConfig.enabled || !autoConfig.roleId) {
    return {
      opensAt: null,
      closesAt: null,
      configured: false,
      state: "closed",
      allowsAction: false,
      mode: "off",
      timeZone: null,
    };
  }

  const schedule = parseWeeklyRoleAccessScheduleText(
    autoConfig.weeklySchedule,
  );
  if (schedule.length === 0) {
    return {
      opensAt: null,
      closesAt: null,
      configured: false,
      state: "closed",
      allowsAction: false,
      mode: "off",
      timeZone: null,
    };
  }

  const timeZone = configuredAutoRegistrationTimeZone(autoConfig, config);
  const currentParts = zonedDateParts(now, timeZone);
  const intervals = weeklyRegistrationIntervals(
    schedule,
    timeZone,
    currentParts,
  );
  const activeInterval = intervals.find(
    (interval) => interval.opensAt <= now && now < interval.closesAt,
  );
  if (activeInterval) {
    return {
      opensAt: activeInterval.opensAt,
      closesAt: activeInterval.closesAt,
      configured: true,
      state: "open",
      allowsAction: true,
      mode: "weekly",
      timeZone,
    };
  }

  const nextInterval = intervals.find((interval) => interval.opensAt > now);
  const previousInterval = intervals
    .filter((interval) => interval.closesAt <= now)
    .at(-1);

  return {
    opensAt: nextInterval?.opensAt ?? null,
    closesAt: previousInterval?.closesAt ?? null,
    configured: true,
    state: "closed",
    allowsAction: false,
    mode: "weekly",
    timeZone,
  };
}

export function teamLogoReminderWindow(
  config?:
    | Pick<SessionDiscordConfigResponse, "emojis">
    | DiscordEmojiMap
    | null,
  now = new Date(),
): RoleAccessWindowSnapshot {
  const reminderConfig = parseTeamLogoReminderConfig(config);
  if (!reminderConfig.enabled) {
    return {
      opensAt: null,
      closesAt: null,
      configured: false,
      state: "closed",
      allowsAction: false,
      mode: "off",
      timeZone: null,
    };
  }

  const schedule = parseWeeklyRoleAccessScheduleText(
    reminderConfig.weeklySchedule,
  );
  if (schedule.length === 0) {
    return {
      opensAt: null,
      closesAt: null,
      configured: false,
      state: "closed",
      allowsAction: false,
      mode: "off",
      timeZone: null,
    };
  }

  const timeZone = configuredTeamLogoReminderTimeZone(reminderConfig, config);
  const currentParts = zonedDateParts(now, timeZone);
  const intervals = weeklyRegistrationIntervals(
    schedule,
    timeZone,
    currentParts,
  );
  const activeInterval = intervals.find(
    (interval) => interval.opensAt <= now && now < interval.closesAt,
  );
  if (activeInterval) {
    return {
      opensAt: activeInterval.opensAt,
      closesAt: activeInterval.closesAt,
      configured: true,
      state: "open",
      allowsAction: true,
      mode: "weekly",
      timeZone,
    };
  }

  const nextInterval = intervals.find((interval) => interval.opensAt > now);
  const previousInterval = intervals
    .filter((interval) => interval.closesAt <= now)
    .at(-1);

  return {
    opensAt: nextInterval?.opensAt ?? null,
    closesAt: previousInterval?.closesAt ?? null,
    configured: true,
    state: "closed",
    allowsAction: false,
    mode: "weekly",
    timeZone,
  };
}

function configuredRegistrationManualState(
  config?:
    | Pick<SessionDiscordConfigResponse, "emojis">
    | DiscordEmojiMap
    | null,
) {
  const value = emojiMap(config)?.registrationManualState?.trim().toLowerCase();
  return value === "open" || value === "closed" ? value : null;
}

function configuredRegistrationScheduleOverrideState(
  config?:
    | Pick<SessionDiscordConfigResponse, "emojis">
    | DiscordEmojiMap
    | null,
) {
  const value = emojiMap(config)
    ?.registrationScheduleOverrideState?.trim()
    .toLowerCase();
  return value === "open" || value === "closed" ? value : null;
}

function configuredWaitlistPromotionManualState(
  config?:
    | Pick<SessionDiscordConfigResponse, "emojis">
    | DiscordEmojiMap
    | null,
) {
  const value = emojiMap(config)
    ?.waitlistPromotionManualState?.trim()
    .toLowerCase();
  return value === "open" || value === "closed" ? value : null;
}

function configuredWaitlistPromotionScheduleOverrideState(
  config?:
    | Pick<SessionDiscordConfigResponse, "emojis">
    | DiscordEmojiMap
    | null,
) {
  const value = emojiMap(config)
    ?.waitlistPromotionScheduleOverrideState?.trim()
    .toLowerCase();
  return value === "open" || value === "closed" ? value : null;
}

type RegistrationStatusTemplateKey =
  | "registrationStatusAlwaysOpenText"
  | "registrationStatusOpenText"
  | "registrationStatusOpeningSoonText"
  | "registrationStatusClosedRecentText"
  | "registrationStatusClosedText";

function configuredRegistrationStatusText(
  config:
    | Pick<SessionDiscordConfigResponse, "emojis">
    | DiscordEmojiMap
    | null
    | undefined,
  key: RegistrationStatusTemplateKey,
) {
  return emojiMap(config)?.[key]?.trim() || DEFAULT_DISCORD_EMOJIS[key];
}

function configuredRegistrationStatusHours(
  config:
    | Pick<SessionDiscordConfigResponse, "emojis">
    | DiscordEmojiMap
    | null
    | undefined,
  key: "registrationClosedDetailsHours" | "registrationOpeningSoonHours",
) {
  const raw = emojiMap(config)?.[key]?.trim() || DEFAULT_DISCORD_EMOJIS[key];
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 2;
  }
  return Math.min(parsed, 168);
}

export function registrationStatusTimingThresholds(
  config?:
    | Pick<SessionDiscordConfigResponse, "emojis">
    | DiscordEmojiMap
    | null,
) {
  return {
    closedDetailsMs:
      configuredRegistrationStatusHours(
        config,
        "registrationClosedDetailsHours",
      ) *
      60 *
      60 *
      1000,
    openingSoonMs:
      configuredRegistrationStatusHours(
        config,
        "registrationOpeningSoonHours",
      ) *
      60 *
      60 *
      1000,
  };
}

function renderRegistrationStatusTemplate(
  template: string,
  config:
    | Pick<SessionDiscordConfigResponse, "emojis">
    | DiscordEmojiMap
    | null
    | undefined,
  window: RegistrationWindowSnapshot,
) {
  const replacements: Record<string, string> = {
    success: resolveDiscordEmoji("check", config),
    reject: resolveDiscordEmoji("reject", config),
    warning: resolveDiscordEmoji("warning", config),
    clock: resolveDiscordEmoji("clock", config),
    slot: resolveDiscordEmoji("slot", config),
    waitlist: resolveDiscordEmoji("waitlist", config),
    team: resolveDiscordEmoji("team", config),
    opens: window.opensAt ? discordTimestamp(window.opensAt, "f") : "",
    opensRelative: window.opensAt ? discordTimestamp(window.opensAt, "R") : "",
    closes: window.closesAt ? discordTimestamp(window.closesAt, "f") : "",
    closesRelative: window.closesAt
      ? discordTimestamp(window.closesAt, "R")
      : "",
    timezone: window.timeZone ?? "",
    schedule: windowScheduleSuffix(window),
  };

  return template
    .replace(/\{([A-Za-z]+)\}/g, (match, key: string) => {
      return replacements[key] ?? match;
    })
    .replace(/[ \t]+([.,])/g, "$1")
    .trim();
}

function registrationStatusTextFromTemplate(
  key: RegistrationStatusTemplateKey,
  config:
    | Pick<SessionDiscordConfigResponse, "emojis">
    | DiscordEmojiMap
    | null
    | undefined,
  window: RegistrationWindowSnapshot,
) {
  return renderRegistrationStatusTemplate(
    configuredRegistrationStatusText(config, key),
    config,
    window,
  ).slice(0, 1024);
}

function registrationWindowStatusTextFromWindow(
  window: RegistrationWindowSnapshot,
  config?:
    | Pick<SessionDiscordConfigResponse, "emojis">
    | DiscordEmojiMap
    | null,
  now = new Date(),
) {
  if (
    window.state === "always_open" ||
    (!window.configured && window.state !== "closed")
  ) {
    return registrationStatusTextFromTemplate(
      "registrationStatusAlwaysOpenText",
      config,
      window,
    );
  }

  if (window.state === "open") {
    return registrationStatusTextFromTemplate(
      window.closesAt
        ? "registrationStatusOpenText"
        : "registrationStatusAlwaysOpenText",
      config,
      window,
    );
  }

  const { closedDetailsMs, openingSoonMs } =
    registrationStatusTimingThresholds(config);
  const nowMs = now.getTime();
  const opensInMs = window.opensAt ? window.opensAt.getTime() - nowMs : null;
  const closedForMs = window.closesAt
    ? nowMs - window.closesAt.getTime()
    : null;

  if (opensInMs !== null && opensInMs > 0 && opensInMs <= openingSoonMs) {
    return registrationStatusTextFromTemplate(
      "registrationStatusOpeningSoonText",
      config,
      window,
    );
  }

  if (
    window.opensAt &&
    closedForMs !== null &&
    closedForMs >= 0 &&
    closedForMs <= closedDetailsMs
  ) {
    return registrationStatusTextFromTemplate(
      "registrationStatusClosedRecentText",
      config,
      window,
    );
  }

  return registrationStatusTextFromTemplate(
    "registrationStatusClosedText",
    config,
    window,
  );
}

export function registrationWindowStatusText(
  config?:
    | Pick<SessionDiscordConfigResponse, "emojis">
    | DiscordEmojiMap
    | null,
  now = new Date(),
) {
  return registrationWindowStatusTextFromWindow(
    registrationWindow(config, now),
    config,
    now,
  );
}

function parseRegistrationSessionDate(value: string | null | undefined) {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function registrationWindowForSession(
  session: {
    status: string;
    registrationOpenAt?: string | null;
    registrationCloseAt?: string | null;
  },
  config?: RegistrationStatusConfig,
  now = new Date(),
): RegistrationWindowSnapshot {
  const scheduledWindow = registrationWindow(config, now);
  if (registrationDisabled(config)) {
    return {
      ...scheduledWindow,
      opensAt: null,
      closesAt: null,
      configured: true,
      state: "closed",
      allowsAction: false,
    };
  }

  if (scheduledWindow.mode === "manual") {
    return scheduledWindow;
  }

  if (scheduledWindow.configured) {
    const statusAllows =
      session.status === "DRAFT" ||
      session.status === "OPEN" ||
      session.status === "CHECKIN";
    return {
      ...scheduledWindow,
      state: statusAllows ? scheduledWindow.state : "closed",
      allowsAction: statusAllows && scheduledWindow.allowsAction,
    };
  }

  const statusAllows =
    session.status === "OPEN" || session.status === "CHECKIN";
  const opensAt = parseRegistrationSessionDate(session.registrationOpenAt);
  const closesAt = parseRegistrationSessionDate(session.registrationCloseAt);
  const state: RegistrationWindowState = !statusAllows
    ? "closed"
    : opensAt && now < opensAt
      ? "not_open"
      : closesAt && now >= closesAt
        ? "closed"
        : "open";

  return {
    opensAt,
    closesAt,
    configured: Boolean(opensAt || closesAt),
    state,
    allowsAction: state === "open",
    mode: "session",
    timeZone: null,
  };
}

export function registrationWindowStatusTextForSession(
  session: {
    status: string;
    registrationOpenAt?: string | null;
    registrationCloseAt?: string | null;
  },
  config?: RegistrationStatusConfig,
  now = new Date(),
) {
  return registrationWindowStatusTextFromWindow(
    registrationWindowForSession(session, config, now),
    config,
    now,
  );
}

export function waitlistPromotionWindowForSession(
  session: {
    status: string;
  },
  config?:
    | Pick<SessionDiscordConfigResponse, "emojis">
    | DiscordEmojiMap
    | null,
  now = new Date(),
): RegistrationWindowSnapshot {
  const window = waitlistPromotionWindow(config, now);
  const statusAllows =
    session.status === "DRAFT" ||
    session.status === "OPEN" ||
    session.status === "CHECKIN";
  return {
    ...window,
    state: statusAllows ? window.state : "closed",
    allowsAction: statusAllows && window.allowsAction,
  };
}

export function playConfirmationWindowStatusText(
  config?:
    | Pick<SessionDiscordConfigResponse, "emojis">
    | DiscordEmojiMap
    | null,
  now = new Date(),
) {
  const window = playConfirmationWindow(config, now);
  if (!window.configured) {
    return null;
  }

  if (window.state === "not_open" && window.opensAt) {
    return `${resolveDiscordEmoji("clock", config)} Confirmation opens ${discordTimestamp(window.opensAt, "R")} (${discordTimestamp(window.opensAt, "f")})${windowScheduleSuffix(window)}`;
  }

  if (window.state === "closed") {
    const closedAt = window.closesAt;
    const waitlistStartText = waitlistStartStatusText(
      window.waitlistStartsAt,
      now,
      config,
    );
    return `${resolveDiscordEmoji("reject", config)} Confirmation closed${
      closedAt ? ` ${discordTimestamp(closedAt, "R")}` : ""
    }.${
      waitlistStartText
        ? ` ${waitlistStartText}`
        : window.opensAt
          ? ` Opens ${discordTimestamp(window.opensAt, "R")}${windowScheduleSuffix(window)}.`
          : ""
    }`;
  }

  if (window.closesAt) {
    return `${resolveDiscordEmoji("check", config)} Confirmation open until ${discordTimestamp(window.closesAt, "R")} (${discordTimestamp(window.closesAt, "f")})${windowScheduleSuffix(window)}`;
  }

  return `${resolveDiscordEmoji("check", config)} Confirmation is open.`;
}

function waitlistStartStatusText(
  waitlistStartsAt: Date | null | undefined,
  now: Date,
  config?:
    | Pick<SessionDiscordConfigResponse, "emojis">
    | DiscordEmojiMap
    | null,
) {
  if (!waitlistStartsAt) {
    return "";
  }
  const verb = now < waitlistStartsAt ? "starts" : "started";
  return `${resolveDiscordEmoji("waitlist", config)} Waitlist ${verb} ${discordTimestamp(waitlistStartsAt, "R")} (${discordTimestamp(waitlistStartsAt, "f")}).`;
}

export function playConfirmationWindowRejectMessage(
  config?:
    | Pick<SessionDiscordConfigResponse, "emojis">
    | DiscordEmojiMap
    | null,
  now = new Date(),
) {
  const window = playConfirmationWindow(config, now);
  if (window.allowsAction) {
    return null;
  }

  if (window.state === "not_open" && window.opensAt) {
    return `Confirmation is not open yet. It opens ${discordTimestamp(window.opensAt, "R")} (${discordTimestamp(window.opensAt, "f")}).`;
  }

  if (window.state === "closed") {
    return window.opensAt
      ? `Confirmation is closed. It opens again ${discordTimestamp(window.opensAt, "R")} (${discordTimestamp(window.opensAt, "f")}).`
      : "Confirmation is closed for this scrim.";
  }

  return "Confirmation is not available for this scrim.";
}

function windowScheduleSuffix(window: {
  mode: string;
  timeZone: string | null;
}) {
  if (!window.timeZone) {
    return "";
  }
  return ` ${window.mode === "weekly" ? "weekly" : "daily"} (${window.timeZone})`;
}

type ParsedDailyTime = NonNullable<ReturnType<typeof parseDailyTime>>;
type WeeklyConfirmationEntry = {
  dayIndex: number;
  openTime: ParsedDailyTime;
  closeTime: ParsedDailyTime;
  waitlistStartTime: ParsedDailyTime | null;
  cleanupTime: ParsedDailyTime | null;
  cancelNoBanUntilTime: ParsedDailyTime | null;
  cancelBanUntilTime: ParsedDailyTime | null;
};
type WeeklyRegistrationEntry = {
  dayIndex: number;
  openTime: ParsedDailyTime;
  closeTime: ParsedDailyTime;
};

const WEEKDAY_INDEX: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

function weeklyPlayConfirmationWindow(
  config?:
    | Pick<SessionDiscordConfigResponse, "emojis">
    | DiscordEmojiMap
    | null,
  now = new Date(),
) {
  const schedule = parseWeeklyConfirmationSchedule(config);
  if (schedule.length === 0) {
    return null;
  }

  const timeZone = configuredTimeZone(config);
  const currentParts = zonedDateParts(now, timeZone);
  const intervals = weeklyConfirmationIntervals(
    schedule,
    timeZone,
    currentParts,
  );
  const activeInterval = intervals.find(
    (interval) => interval.opensAt <= now && now < interval.closesAt,
  );
  if (activeInterval) {
    return {
      opensAt: activeInterval.opensAt,
      closesAt: activeInterval.closesAt,
      configured: true,
      state: "open" as PlayConfirmationWindowState,
      allowsAction: true,
      mode: "weekly" as const,
      timeZone,
      waitlistStartsAt: activeInterval.waitlistStartsAt,
    };
  }

  const nextInterval = intervals.find((interval) => interval.opensAt > now);
  const previousInterval = intervals
    .filter((interval) => interval.closesAt <= now)
    .at(-1);

  return {
    opensAt: nextInterval?.opensAt ?? null,
    closesAt: previousInterval?.closesAt ?? null,
    configured: true,
    state:
      nextInterval &&
      isSameZonedDate(nextInterval.opensAt, currentParts, timeZone)
        ? ("not_open" as PlayConfirmationWindowState)
        : ("closed" as PlayConfirmationWindowState),
    allowsAction: false,
    mode: "weekly" as const,
    timeZone,
    waitlistStartsAt: previousInterval?.waitlistStartsAt ?? null,
  };
}

function parseWeeklyConfirmationSchedule(
  config?:
    | Pick<SessionDiscordConfigResponse, "emojis">
    | DiscordEmojiMap
    | null,
) {
  const raw = emojiMap(config)?.playConfirmationWeeklySchedule?.trim();
  if (!raw) {
    return [];
  }

  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return [];
    }

    return Object.entries(value as Record<string, unknown>)
      .map(([dayKey, dayValue]) => {
        if (
          !dayValue ||
          typeof dayValue !== "object" ||
          Array.isArray(dayValue)
        ) {
          return null;
        }
        const dayIndex = WEEKDAY_INDEX[dayKey.toLowerCase()];
        const day = dayValue as Record<string, unknown>;
        const enabled = day.enabled === true || day.enabled === "true";
        const openTime = parseDailyTime(stringValue(day.open));
        const closeTime = parseDailyTime(stringValue(day.close));
        const waitlistStartTime = parseDailyTime(
          stringValue(day.waitlistStart),
        );
        const cleanupTime =
          parseDailyTime(stringValue(day.cleanup)) ||
          parseDailyTime(stringValue(day.cleanupTime)) ||
          closeTime;
        const cancelNoBanUntilTime =
          parseDailyTime(stringValue(day.cancelNoBanUntil)) ||
          parseDailyTime(stringValue(day.cancelGraceUntil)) ||
          parseDailyTime(stringValue(day.noBanUntil));
        const cancelBanUntilTime =
          parseDailyTime(stringValue(day.cancelBanUntil)) ||
          parseDailyTime(stringValue(day.banUntil));
        if (dayIndex === undefined || !enabled || !openTime || !closeTime) {
          return null;
        }
        return {
          dayIndex,
          openTime,
          closeTime,
          waitlistStartTime,
          cleanupTime,
          cancelNoBanUntilTime,
          cancelBanUntilTime,
        };
      })
      .filter((entry): entry is WeeklyConfirmationEntry => Boolean(entry));
  } catch {
    return [];
  }
}

function parseWeeklyRegistrationSchedule(
  config?:
    | Pick<SessionDiscordConfigResponse, "emojis">
    | DiscordEmojiMap
    | null,
) {
  const raw = emojiMap(config)?.registrationWeeklySchedule?.trim();
  if (!raw) {
    return [];
  }

  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return [];
    }

    return Object.entries(value as Record<string, unknown>)
      .map(([dayKey, dayValue]) => {
        if (
          !dayValue ||
          typeof dayValue !== "object" ||
          Array.isArray(dayValue)
        ) {
          return null;
        }
        const dayIndex = WEEKDAY_INDEX[dayKey.toLowerCase()];
        const day = dayValue as Record<string, unknown>;
        const enabled = day.enabled === true || day.enabled === "true";
        const openTime = parseDailyTime(stringValue(day.open));
        const closeTime = parseDailyTime(stringValue(day.close));
        if (dayIndex === undefined || !enabled || !openTime || !closeTime) {
          return null;
        }
        return { dayIndex, openTime, closeTime };
      })
      .filter((entry): entry is WeeklyRegistrationEntry => Boolean(entry));
  } catch {
    return [];
  }
}

function parseWeeklyWaitlistPromotionSchedule(
  config?:
    | Pick<SessionDiscordConfigResponse, "emojis">
    | DiscordEmojiMap
    | null,
) {
  const raw = emojiMap(config)?.waitlistPromotionWeeklySchedule?.trim();
  if (!raw) {
    return [];
  }

  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return [];
    }

    return Object.entries(value as Record<string, unknown>)
      .map(([dayKey, dayValue]) => {
        if (
          !dayValue ||
          typeof dayValue !== "object" ||
          Array.isArray(dayValue)
        ) {
          return null;
        }
        const dayIndex = WEEKDAY_INDEX[dayKey.toLowerCase()];
        const day = dayValue as Record<string, unknown>;
        const enabled = day.enabled === true || day.enabled === "true";
        const openTime = parseDailyTime(stringValue(day.open));
        const closeTime = parseDailyTime(stringValue(day.close));
        if (dayIndex === undefined || !enabled || !openTime || !closeTime) {
          return null;
        }
        return { dayIndex, openTime, closeTime };
      })
      .filter((entry): entry is WeeklyRegistrationEntry => Boolean(entry));
  } catch {
    return [];
  }
}

function parseWeeklyRoleAccessSchedule(
  config?:
    | Pick<SessionDiscordConfigResponse, "emojis">
    | DiscordEmojiMap
    | null,
  kind: RoleAccessKind = "earlyAccess",
) {
  const raw = emojiMap(config)?.[`${kind}WeeklySchedule`]?.trim();
  if (!raw) {
    return [];
  }

  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return [];
    }

    return Object.entries(value as Record<string, unknown>)
      .map(([dayKey, dayValue]) => {
        if (
          !dayValue ||
          typeof dayValue !== "object" ||
          Array.isArray(dayValue)
        ) {
          return null;
        }
        const dayIndex = WEEKDAY_INDEX[dayKey.toLowerCase()];
        const day = dayValue as Record<string, unknown>;
        const enabled = day.enabled === true || day.enabled === "true";
        const openTime = parseDailyTime(stringValue(day.open));
        const closeTime = parseDailyTime(stringValue(day.close));
        if (dayIndex === undefined || !enabled || !openTime || !closeTime) {
          return null;
        }
        return { dayIndex, openTime, closeTime };
      })
      .filter((entry): entry is WeeklyRegistrationEntry => Boolean(entry));
  } catch {
    return [];
  }
}

function parseWeeklyRoleAccessScheduleText(raw: string) {
  if (!raw.trim()) {
    return [];
  }

  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return [];
    }

    return Object.entries(value as Record<string, unknown>)
      .map(([dayKey, dayValue]) => {
        if (
          !dayValue ||
          typeof dayValue !== "object" ||
          Array.isArray(dayValue)
        ) {
          return null;
        }
        const dayIndex = WEEKDAY_INDEX[dayKey.toLowerCase()];
        const day = dayValue as Record<string, unknown>;
        const enabled = day.enabled === true || day.enabled === "true";
        const openTime = parseDailyTime(stringValue(day.open));
        const closeTime = parseDailyTime(stringValue(day.close));
        if (dayIndex === undefined || !enabled || !openTime || !closeTime) {
          return null;
        }
        return { dayIndex, openTime, closeTime };
      })
      .filter((entry): entry is WeeklyRegistrationEntry => Boolean(entry));
  } catch {
    return [];
  }
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function weeklyRegistrationIntervals(
  schedule: WeeklyRegistrationEntry[],
  timeZone: string,
  currentParts: ReturnType<typeof zonedDateParts>,
) {
  return weeklyConfirmationIntervals(
    schedule.map((entry) => ({
      ...entry,
      waitlistStartTime: null,
      cleanupTime: entry.closeTime,
      cancelNoBanUntilTime: null,
      cancelBanUntilTime: null,
    })),
    timeZone,
    currentParts,
  ).map((interval) => ({
    opensAt: interval.opensAt,
    closesAt: interval.closesAt,
  }));
}

function weeklyConfirmationIntervals(
  schedule: WeeklyConfirmationEntry[],
  timeZone: string,
  currentParts: ReturnType<typeof zonedDateParts>,
) {
  const intervals: Array<{
    opensAt: Date;
    closesAt: Date;
    waitlistStartsAt: Date | null;
    cleanupAt: Date;
    cancelNoBanUntilAt: Date | null;
    cancelBanUntilAt: Date | null;
  }> = [];
  for (let offset = -7; offset <= 14; offset += 1) {
    const openDate = shiftedLocalDate(
      currentParts.year,
      currentParts.month,
      currentParts.day,
      offset,
    );
    for (const entry of schedule) {
      if (entry.dayIndex !== openDate.weekday) {
        continue;
      }
      const closeOffset =
        entry.closeTime.minutes <= entry.openTime.minutes ? 1 : 0;
      const closeDate = shiftedLocalDate(
        openDate.year,
        openDate.month,
        openDate.day,
        closeOffset,
      );
      const opensAt = zonedDateTimeToDate(
        timeZone,
        openDate.year,
        openDate.month,
        openDate.day,
        entry.openTime.hour,
        entry.openTime.minute,
      );
      const closesAt = zonedDateTimeToDate(
        timeZone,
        closeDate.year,
        closeDate.month,
        closeDate.day,
        entry.closeTime.hour,
        entry.closeTime.minute,
      );
      const cleanupTime = entry.cleanupTime ?? entry.closeTime;
      const cleanupLocalDate = shiftedLocalDate(
        closeDate.year,
        closeDate.month,
        closeDate.day,
        cleanupTime.minutes < entry.closeTime.minutes ? 1 : 0,
      );
      intervals.push({
        opensAt,
        closesAt,
        waitlistStartsAt: entry.waitlistStartTime
          ? zonedTimeAfterReference(
              timeZone,
              closeDate,
              entry.closeTime,
              entry.waitlistStartTime,
            )
          : null,
        cleanupAt: zonedDateTimeToDate(
          timeZone,
          cleanupLocalDate.year,
          cleanupLocalDate.month,
          cleanupLocalDate.day,
          cleanupTime.hour,
          cleanupTime.minute,
        ),
        cancelNoBanUntilAt: entry.cancelNoBanUntilTime
          ? zonedTimeAfterReference(
              timeZone,
              cleanupLocalDate,
              cleanupTime,
              entry.cancelNoBanUntilTime,
            )
          : null,
        cancelBanUntilAt: entry.cancelBanUntilTime
          ? zonedTimeAfterReference(
              timeZone,
              cleanupLocalDate,
              cleanupTime,
              entry.cancelBanUntilTime,
            )
          : null,
      });
    }
  }
  return intervals.sort(
    (left, right) => left.opensAt.getTime() - right.opensAt.getTime(),
  );
}

function zonedTimeAfterReference(
  timeZone: string,
  referenceDate: { year: number; month: number; day: number },
  referenceTime: ParsedDailyTime,
  targetTime: ParsedDailyTime,
) {
  const targetDate = shiftedLocalDate(
    referenceDate.year,
    referenceDate.month,
    referenceDate.day,
    targetTime.minutes < referenceTime.minutes ? 1 : 0,
  );
  return zonedDateTimeToDate(
    timeZone,
    targetDate.year,
    targetDate.month,
    targetDate.day,
    targetTime.hour,
    targetTime.minute,
  );
}

function shiftedLocalDate(
  year: number,
  month: number,
  day: number,
  offset: number,
) {
  const date = new Date(Date.UTC(year, month - 1, day + offset, 0, 0, 0));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    weekday: date.getUTCDay(),
  };
}

function isSameZonedDate(
  date: Date,
  currentParts: ReturnType<typeof zonedDateParts>,
  timeZone: string,
) {
  const parts = zonedDateParts(date, timeZone);
  return (
    parts.year === currentParts.year &&
    parts.month === currentParts.month &&
    parts.day === currentParts.day
  );
}

function dailyPlayConfirmationWindow(
  config?:
    | Pick<SessionDiscordConfigResponse, "emojis">
    | DiscordEmojiMap
    | null,
  now = new Date(),
) {
  const emojis = emojiMap(config);
  const openTime = parseDailyTime(emojis?.playConfirmationOpenTime);
  const closeTime = parseDailyTime(emojis?.playConfirmationCloseTime);
  const waitlistStartTime = parseDailyTime(
    emojis?.playConfirmationWaitlistStartTime,
  );
  if (!openTime && !closeTime) {
    return null;
  }

  const timeZone = configuredTimeZone(config);
  const currentParts = zonedDateParts(now, timeZone);
  const currentMinutes = currentParts.hour * 60 + currentParts.minute;
  const openMinutes = openTime?.minutes;
  const closeMinutes = closeTime?.minutes;
  let state: PlayConfirmationWindowState = "open";

  if (openMinutes !== undefined && closeMinutes !== undefined) {
    if (openMinutes === closeMinutes) {
      state = "open";
    } else if (openMinutes < closeMinutes) {
      state =
        currentMinutes >= openMinutes && currentMinutes < closeMinutes
          ? "open"
          : currentMinutes < openMinutes
            ? "not_open"
            : "closed";
    } else {
      state =
        currentMinutes >= openMinutes || currentMinutes < closeMinutes
          ? "open"
          : "closed";
    }
  } else if (openMinutes !== undefined) {
    state = currentMinutes >= openMinutes ? "open" : "not_open";
  } else if (closeMinutes !== undefined) {
    state = currentMinutes < closeMinutes ? "open" : "closed";
  }

  const opensAt = nextDailyOccurrence(
    now,
    timeZone,
    openTime,
    state === "open" ? "next" : "soonest",
  );
  const closesAt = nextDailyOccurrence(
    now,
    timeZone,
    closeTime,
    state === "closed" ? "previous" : "soonest",
  );
  return {
    opensAt,
    closesAt,
    configured: true,
    state,
    allowsAction: state === "open",
    mode: "daily" as const,
    timeZone,
    waitlistStartsAt: dailyWaitlistStartOccurrence(
      now,
      timeZone,
      waitlistStartTime,
      closesAt,
      closeTime,
      openTime,
      state,
    ),
  };
}

function dailyWaitlistStartOccurrence(
  now: Date,
  timeZone: string,
  waitlistStartTime: ReturnType<typeof parseDailyTime>,
  closesAt: Date | null,
  closeTime: ReturnType<typeof parseDailyTime>,
  openTime: ReturnType<typeof parseDailyTime>,
  state: PlayConfirmationWindowState,
) {
  if (!waitlistStartTime) {
    return null;
  }
  const referenceTime = closeTime ?? openTime;
  if (closesAt && referenceTime) {
    const referenceDate = zonedDateParts(closesAt, timeZone);
    return zonedTimeAfterReference(
      timeZone,
      referenceDate,
      referenceTime,
      waitlistStartTime,
    );
  }
  return nextDailyOccurrence(
    now,
    timeZone,
    waitlistStartTime,
    state === "closed" ? "previous" : "soonest",
  );
}

function configuredTimeZone(
  config?:
    | Pick<SessionDiscordConfigResponse, "emojis">
    | DiscordEmojiMap
    | null,
) {
  const timeZone = emojiMap(config)?.playConfirmationTimeZone?.trim() || "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
    return timeZone;
  } catch {
    return "UTC";
  }
}

function configuredRegistrationTimeZone(
  config?:
    | Pick<SessionDiscordConfigResponse, "emojis">
    | DiscordEmojiMap
    | null,
) {
  const timeZone = emojiMap(config)?.registrationTimeZone?.trim() || "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
    return timeZone;
  } catch {
    return "UTC";
  }
}

function configuredWaitlistPromotionTimeZone(
  config?:
    | Pick<SessionDiscordConfigResponse, "emojis">
    | DiscordEmojiMap
    | null,
) {
  const timeZone =
    emojiMap(config)?.waitlistPromotionTimeZone?.trim() ||
    emojiMap(config)?.registrationTimeZone?.trim() ||
    "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
    return timeZone;
  } catch {
    return "UTC";
  }
}

function configuredRoleAccessTimeZone(
  config?:
    | Pick<SessionDiscordConfigResponse, "emojis">
    | DiscordEmojiMap
    | null,
  kind: RoleAccessKind = "earlyAccess",
) {
  const emojis = emojiMap(config);
  const timeZone =
    emojis?.[`${kind}TimeZone`]?.trim() ||
    emojis?.registrationTimeZone?.trim() ||
    "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
    return timeZone;
  } catch {
    return "UTC";
  }
}

function configuredRoleAccessGroupTimeZone(
  group: Pick<RoleAccessGroup, "timeZone">,
  config?:
    | Pick<SessionDiscordConfigResponse, "emojis">
    | DiscordEmojiMap
    | null,
) {
  const emojis = emojiMap(config);
  const timeZone =
    group.timeZone.trim() || emojis?.registrationTimeZone?.trim() || "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
    return timeZone;
  } catch {
    return "UTC";
  }
}

function configuredAutoRegistrationTimeZone(
  autoConfig: Pick<AutoRegistrationConfig, "timeZone">,
  config?:
    | Pick<SessionDiscordConfigResponse, "emojis">
    | DiscordEmojiMap
    | null,
) {
  const emojis = emojiMap(config);
  const timeZone =
    autoConfig.timeZone.trim() || emojis?.registrationTimeZone?.trim() || "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
    return timeZone;
  } catch {
    return "UTC";
  }
}

function configuredTeamLogoReminderTimeZone(
  reminderConfig: Pick<TeamLogoReminderConfig, "timeZone">,
  config?:
    | Pick<SessionDiscordConfigResponse, "emojis">
    | DiscordEmojiMap
    | null,
) {
  const emojis = emojiMap(config);
  const timeZone =
    reminderConfig.timeZone.trim() ||
    emojis?.registrationTimeZone?.trim() ||
    "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
    return timeZone;
  } catch {
    return "UTC";
  }
}

function normalizeRoleAccessGroupId(value: unknown, fallbackIndex: number) {
  const text = stringValue(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return text || `access-${fallbackIndex + 1}`;
}

function normalizeRoleAccessGroupMode(value: unknown): RoleAccessGroupMode {
  const text = stringValue(value).trim().toLowerCase();
  return text === "vip" || text === "both" ? text : "normal";
}

function booleanFromUnknown(value: unknown, fallback: boolean) {
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  return fallback;
}

function parseDailyTime(value?: string | null) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value?.trim() ?? "");
  if (!match) {
    return null;
  }
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }
  return { hour, minute, minutes: hour * 60 + minute };
}

function nextDailyOccurrence(
  now: Date,
  timeZone: string,
  time: ReturnType<typeof parseDailyTime>,
  mode: "soonest" | "next" | "previous",
) {
  if (!time) {
    return null;
  }

  const parts = zonedDateParts(now, timeZone);
  const today = zonedDateTimeToDate(
    timeZone,
    parts.year,
    parts.month,
    parts.day,
    time.hour,
    time.minute,
  );
  if (mode === "previous") {
    return today <= now
      ? today
      : addZonedDays(
          timeZone,
          parts.year,
          parts.month,
          parts.day,
          time.hour,
          time.minute,
          -1,
        );
  }
  if (mode === "next") {
    return today > now
      ? today
      : addZonedDays(
          timeZone,
          parts.year,
          parts.month,
          parts.day,
          time.hour,
          time.minute,
          1,
        );
  }
  return today > now
    ? today
    : addZonedDays(
        timeZone,
        parts.year,
        parts.month,
        parts.day,
        time.hour,
        time.minute,
        1,
      );
}

function addZonedDays(
  timeZone: string,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  days: number,
) {
  const utc = new Date(Date.UTC(year, month - 1, day + days, hour, minute, 0));
  const parts = {
    year: utc.getUTCFullYear(),
    month: utc.getUTCMonth() + 1,
    day: utc.getUTCDate(),
  };
  return zonedDateTimeToDate(
    timeZone,
    parts.year,
    parts.month,
    parts.day,
    hour,
    minute,
  );
}

function zonedDateParts(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const entries = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
  return {
    year: entries.year,
    month: entries.month,
    day: entries.day,
    hour: entries.hour,
    minute: entries.minute,
    second: entries.second,
  };
}

function zonedDateTimeToDate(
  timeZone: string,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
) {
  let guess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  for (let index = 0; index < 3; index += 1) {
    const parts = zonedDateParts(guess, timeZone);
    const desired = Date.UTC(year, month - 1, day, hour, minute, 0);
    const actual = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    );
    const diff = desired - actual;
    if (diff === 0) {
      break;
    }
    guess = new Date(guess.getTime() + diff);
  }
  return guess;
}

export function playConfirmationMessageEnabled(
  config?:
    | Pick<SessionDiscordConfigResponse, "emojis">
    | DiscordEmojiMap
    | null,
) {
  return emojiMap(config)?.playConfirmationMessageEnabled === "true";
}

export function playConfirmationMessageTitle(
  config?:
    | Pick<SessionDiscordConfigResponse, "emojis">
    | DiscordEmojiMap
    | null,
) {
  return (
    emojiMap(config)?.playConfirmationMessageTitle?.trim() ||
    DEFAULT_DISCORD_EMOJIS.playConfirmationMessageTitle
  ).slice(0, 256);
}

export function playConfirmationMessageText(
  config?:
    | Pick<SessionDiscordConfigResponse, "emojis">
    | DiscordEmojiMap
    | null,
) {
  const text =
    emojiMap(config)?.playConfirmationMessageText?.trim() ||
    DEFAULT_DISCORD_EMOJIS.playConfirmationMessageText;
  return renderPlayConfirmationMessageText(text, config).slice(0, 4000);
}

function renderPlayConfirmationMessageText(
  text: string,
  config?:
    | Pick<SessionDiscordConfigResponse, "emojis">
    | DiscordEmojiMap
    | null,
) {
  const confirm =
    configuredButtonEmoji("playConfirmEmoji", "check", config) ?? "";
  const notPlaying =
    configuredButtonEmoji("playNotPlayingEmoji", "reject", config) ?? "";
  const replacements: Record<string, string> = {
    confirm,
    notPlaying,
    success: resolveDiscordEmoji("check", config),
    reject: resolveDiscordEmoji("reject", config),
    warning: resolveDiscordEmoji("warning", config),
    slot: resolveDiscordEmoji("slot", config),
    waitlist: resolveDiscordEmoji("waitlist", config),
    team: resolveDiscordEmoji("team", config),
  };

  return text.replace(/\{([A-Za-z]+)\}/g, (match, key: string) => {
    return replacements[key] ?? match;
  });
}

export function registrationMessageEnabled(
  config?:
    | Pick<SessionDiscordConfigResponse, "emojis">
    | DiscordEmojiMap
    | null,
) {
  return emojiMap(config)?.registrationMessageEnabled !== "false";
}

export function registrationMessageDisplayMode(
  config?:
    | Pick<SessionDiscordConfigResponse, "emojis">
    | DiscordEmojiMap
    | null,
): DiscordMessageDisplayMode {
  return emojiMap(config)?.registrationMessageDisplayMode === "embed"
    ? "embed"
    : "plain";
}

export function registrationMessageTitle(
  config?:
    | (Pick<SessionDiscordConfigResponse, "emojis"> &
        Partial<Pick<SessionDiscordConfigResponse, "registrationMode">>)
    | DiscordEmojiMap
    | null,
) {
  const configured = emojiMap(config)?.registrationMessageTitle?.trim();
  const mode = registrationMessageMode(config);
  const defaultTitle =
    mode === "TOURNAMENT"
      ? DEFAULT_TOURNAMENT_REGISTRATION_MESSAGE_TITLE
      : mode === "EVENT"
        ? DEFAULT_EVENT_REGISTRATION_MESSAGE_TITLE
        : DEFAULT_DISCORD_EMOJIS.registrationMessageTitle;
  return (
    configured &&
    configured !== DEFAULT_DISCORD_EMOJIS.registrationMessageTitle &&
    !(
      mode === "EVENT" &&
      configured === LEGACY_TOURNAMENT_REGISTRATION_MESSAGE_TITLE
    )
      ? configured
      : defaultTitle
  ).slice(0, 256);
}

export function registrationMessageText(
  config?:
    | Pick<SessionDiscordConfigResponse, "emojis">
    | DiscordEmojiMap
    | null,
  session?: { name?: string; registrationCommand?: string | null },
) {
  const configured = emojiMap(config)?.registrationMessageText?.trim();
  const mode = registrationMessageMode(config);
  const defaultText =
    mode === "TOURNAMENT"
      ? DEFAULT_TOURNAMENT_REGISTRATION_MESSAGE_TEXT
      : mode === "EVENT"
        ? DEFAULT_EVENT_REGISTRATION_MESSAGE_TEXT
        : DEFAULT_DISCORD_EMOJIS.registrationMessageText;
  const text =
    configured && configured !== DEFAULT_DISCORD_EMOJIS.registrationMessageText
      ? configured
      : defaultText;
  return renderRegistrationMessageText(
    normalizeRegistrationMessageTemplate(text, config),
    config,
    session,
  ).slice(0, 4000);
}

function registrationMessageMode(
  config?:
    | Pick<SessionDiscordConfigResponse, "emojis">
    | DiscordEmojiMap
    | null,
) {
  const mode =
    "registrationMode" in (config ?? {})
      ? String(
          (config as Pick<SessionDiscordConfigResponse, "registrationMode">)
            ?.registrationMode ?? "SCRIM",
        ).toUpperCase()
      : "SCRIM";
  if (mode === "EVENT" || mode === "TOURNAMENT") {
    return mode;
  }
  return "SCRIM";
}

function renderRegistrationMessageText(
  text: string,
  config?:
    | Pick<SessionDiscordConfigResponse, "emojis">
    | DiscordEmojiMap
    | null,
  session?: { name?: string; registrationCommand?: string | null },
) {
  const mode = registrationMessageMode(config);
  const replacements: Record<string, string> = {
    session: session?.name ?? "this scrim",
    command:
      mode === "EVENT"
        ? "Team Name | Team Tag | @manager"
        : mode === "TOURNAMENT"
          ? "team name: Team Name\nteam tag: TEAMTAG\nteam manager: @manager"
          : session?.registrationCommand?.trim() || "%register",
    status: registrationWindowStatusText(config),
    success: resolveDiscordEmoji("check", config),
    reject: resolveDiscordEmoji("reject", config),
    warning: resolveDiscordEmoji("warning", config),
    slot: resolveDiscordEmoji("slot", config),
    waitlist: resolveDiscordEmoji("waitlist", config),
    team: resolveDiscordEmoji("team", config),
  };

  return text.replace(/\{([A-Za-z]+)\}/g, (match, key: string) => {
    return replacements[key] ?? match;
  });
}

function normalizeRegistrationMessageTemplate(
  text: string,
  config?:
    | Pick<SessionDiscordConfigResponse, "emojis">
    | DiscordEmojiMap
    | null,
) {
  if (registrationMessageMode(config) !== "EVENT") {
    return text;
  }

  return text.replace(
    /\{command\}\s+Team Name\s*\|\s*Team Tag\s*\|\s*@manager/gi,
    "{command}",
  );
}

function configuredDate(
  config:
    | Pick<SessionDiscordConfigResponse, "emojis">
    | DiscordEmojiMap
    | null
    | undefined,
  key:
    | "playConfirmationOpensAt"
    | "playConfirmationClosesAt"
    | "playConfirmationWaitlistGraceUntil"
    | "waitlistPromotionAutoOpenUntil",
) {
  const value = emojiMap(config)?.[key]?.trim();
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function discordTimestamp(date: Date, style: "R" | "f") {
  return `<t:${Math.floor(date.getTime() / 1000)}:${style}>`;
}

export function configuredButtonLabel(
  key: "playConfirmLabel" | "playNotPlayingLabel",
  fallback: string,
  config?:
    | Pick<SessionDiscordConfigResponse, "emojis">
    | DiscordEmojiMap
    | null,
) {
  const emojis = emojiMap(config);
  const raw = emojis?.[key];
  const label = raw === undefined ? fallback : raw.trim();
  return label.slice(0, 80);
}

export function configuredButtonEmoji(
  key: "playConfirmEmoji" | "playNotPlayingEmoji",
  fallbackKey: DiscordEmojiKey,
  config?:
    | Pick<SessionDiscordConfigResponse, "emojis">
    | DiscordEmojiMap
    | null,
) {
  const emojis = emojiMap(config);
  const raw = emojis?.[key];
  const emoji =
    raw === undefined ? resolveDiscordEmoji(fallbackKey, config) : raw.trim();
  if (["none", "off", "false"].includes(emoji.toLowerCase())) {
    return null;
  }

  const legacyKey = LEGACY_EMOJI_VALUES[emoji.toUpperCase()];
  return legacyKey ? DEFAULT_DISCORD_EMOJIS[legacyKey] : emoji;
}

export function configuredButtonStyle(
  key: "playConfirmStyle" | "playNotPlayingStyle",
  fallback: DiscordButtonStyleName,
  config?:
    | Pick<SessionDiscordConfigResponse, "emojis">
    | DiscordEmojiMap
    | null,
): DiscordButtonStyleName {
  const value = emojiMap(config)?.[key]?.trim().toLowerCase();
  return value === "primary" ||
    value === "secondary" ||
    value === "success" ||
    value === "danger"
    ? value
    : fallback;
}

export function slotListMarker(params: {
  slotNumber: number;
  config?:
    | Pick<SessionDiscordConfigResponse, "emojis">
    | DiscordEmojiMap
    | null;
  vipIndex?: number;
}) {
  if (slotListDisplayMode(params.config) !== "emoji") {
    return params.vipIndex
      ? `**VIP ${params.vipIndex}.**`
      : `**${params.slotNumber}.**`;
  }

  return params.vipIndex
    ? configuredDiscordEmoji(`vip_${params.vipIndex}`, "vip", params.config)
    : configuredDiscordEmoji(
        `slot_${params.slotNumber}`,
        "slot",
        params.config,
      );
}

export function emojiPrefix(
  key: DiscordEmojiKey,
  config?:
    | Pick<SessionDiscordConfigResponse, "emojis">
    | DiscordEmojiMap
    | null,
) {
  const emoji = resolveDiscordEmoji(key, config).trim();
  return emoji ? `${emoji} ` : "";
}
