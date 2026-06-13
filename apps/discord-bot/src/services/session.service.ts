import {
  type ApplyNoShowAutoBansResponse,
  type ApplyScreenshotResultsPayload,
  type CreateSessionMatchPayload,
  type DiscordConfigResponse,
  type DiscordGuildRemovedResponse,
  type MatchSlotResponse,
  type MatchResultsResponse,
  type ManualMatchResultRowPayload,
  type ManualMatchResultsResponse,
  type MatchRenderKind,
  type ManagerBanResponse,
  type NoShowTeamBanPayload,
  type NoShowTeamBanResponse,
  type RegisterDiscordTeamResponse,
  type RefreshDiscordSourceImportsResponse,
  type RemoveRegistrationResponse,
  type ResolvedDiscordChannelResponse,
  type ResolvedProductionDiscordChannelResponse,
  type ResultBackupDetailResponse,
  type ResultBackupRowResponse,
  type ResultBackupSummaryResponse,
  type ProductionDiscordChannelKind,
  type SyncOldDiscordLogosResponse,
  type ProductionDiscordSet,
  type ScreenshotPreviewEntry,
  type ScreenshotPreviewResponse,
  type SessionDiscordConfigResponse,
  type SessionStandingsResponse,
  type SessionMatchResponse,
  type SessionRegistrationResponse,
  type SessionResultResetResponse,
  type SessionResponse,
  type SlotMapPreviewEntry,
  type SlotMapPreviewResponse,
  type TeamBanResponse,
  type TeamBanScope,
  type TeamLogoUpload,
  type PlayerPhotoUpload,
  type UpsertProductionDiscordTeamResponse,
  type UpdateMatchResultPayload,
  type UpdateResultBackupRowPayload,
  type UpdateSessionDiscordConfigPayload,
  type UpdateSessionPayload,
  type UpdateRegistrationPlacementPayload,
  type UpdateRegistrationManagersPayload,
  type UpdateRegistrationPlayStatusPayload,
  type TeamMemberSummary,
  type TeamSummary,
  type DiscordManagedTeamResponse,
  ArenzyraApiClient,
  toFriendlyApiError,
} from "../api/api-client";
import {
  ChannelType,
  EmbedBuilder,
  MessageType,
  PermissionFlagsBits,
  type Client,
  type Guild,
  type GuildMember,
  type GuildTextBasedChannel,
  type Message,
  type MessageReaction,
  type PartialMessageReaction,
  type PartialUser,
  type Role,
  type User,
} from "discord.js";
import { createHash } from "crypto";
import {
  ScrimDiscordSetupService,
  type ScrimDiscordManagedMessageIds,
  type ScrimDiscordSetup,
} from "./scrim-discord-setup.service";
import {
  configuredButtonEmoji,
  autoRegistrationWindow,
  confirmationDisplayMode,
  playConfirmationCleanupWindow,
  playConfirmationControlMode,
  playConfirmationReactionsEnabled,
  playConfirmationWindow,
  playConfirmationWindowRejectMessage,
  registrationStatusTimingThresholds,
  registrationWindowForSession,
  registrationWindowStatusTextForSession,
  parseRoleAccessGroups,
  parseAutoRegistrationConfig,
  resolveDiscordEmoji,
  roleAccessGroupWindow,
  roleAccessWindow,
  slotListMarker,
  waitlistPromotionWindowForSession,
  type DiscordEmojiKey,
  type PlayControlMode,
  type RoleAccessGroup,
  type RoleAccessGroupMode,
  type AutoRegistrationConfig,
} from "./discord-emojis";
import {
  allowedMentionsForOrganizerText,
  mentionContentForOrganizerText,
} from "./discord-allowed-mentions";

const EM_DASH = "\u2014";
const DEFAULT_RESULT_SUMMARY_ROW_TEMPLATE =
  "{position}. {teamName} - {totalPoints} pts ({kills} kills)";
const LEGACY_FINAL_RESULT_MESSAGE_TEMPLATE =
  "{trophy} Final Results\n\nChampion: {winner}\n\nTop teams:\n{winners}";
const LEGACY_FINAL_RESULT_WINNER_ROW_TEMPLATE =
  "{rank}. {teamTag} - {points} pts ({kills} kills)";
const DEFAULT_FINAL_RESULT_MESSAGE_TEMPLATE =
  "{trophy} Final Results\n\n{winners}";
const DEFAULT_FINAL_RESULT_WINNER_ROW_TEMPLATE =
  "{winnerEmoji} **{winnerTitle}:** {teamName} - {points} pts ({kills} kills)";
const DEFAULT_FINAL_RESULT_POST_TEMPLATE = "{message}";
const FINAL_RESULT_SECOND_PLACE_EMOJI = "\uD83E\uDD48";
const FINAL_RESULT_THIRD_PLACE_EMOJI = "\uD83E\uDD49";
const LEGACY_RESULT_SUMMARY_ROW_TEMPLATES = new Set([
  "{rank}. {teamName} - {kills} kills",
  `{rank}. {teamName} ${EM_DASH} {kills} kills`,
]);
const LEGACY_FINAL_RESULT_MESSAGE_TEMPLATES = new Set([
  normalizeFinalResultTemplate(LEGACY_FINAL_RESULT_MESSAGE_TEMPLATE),
]);
const LEGACY_FINAL_RESULT_WINNER_ROW_TEMPLATES = new Set([
  normalizeFinalResultTemplate(LEGACY_FINAL_RESULT_WINNER_ROW_TEMPLATE),
]);
const SLOT_LIST_START = 3;
const BACKGROUND_SYNC_DELAY_MS = 750;
const COPIED_EVENT_SOURCE_REFRESH_DELAY_MS = 500;
const PLAY_STATUS_BACKGROUND_SYNC_DELAY_MS = 5_000;
const ROLE_SYNC_CONCURRENCY = 4;
const PRODUCTION_HELP_MARKER_PREFIX = "ARENZYRA_PRODUCTION_HELP";
const MANAGER_MENTION_MEMBER_FETCH_TIMEOUT_MS = 1_000;
const MANAGER_MENTION_VALIDATION_MAX_MS = 4_000;
const MANAGER_MENTION_MEMBER_CACHE_TTL_MS = 60_000;
const QUEUED_SYNC_MAX_RETRIES = 3;
const QUEUED_SYNC_RETRY_BASE_MS = 2_500;
const QUEUED_SYNC_RETRY_MAX_MS = 30_000;
const MAX_CONFIRMATION_WINDOW_TIMER_MS = 2_147_483_647;
const CONFIRMATION_WINDOW_REFRESH_INTERVAL_MS = 15_000;
const CONFIRMATION_CLOSE_CLEANUP_GRACE_MS = 30 * 60_000;
const CONFIRMATION_WAITLIST_GRACE_DEFAULT_MINUTES = 30;
const CONFIRMATION_WAITLIST_GRACE_MINUTES_MIN = 5;
const CONFIRMATION_WAITLIST_GRACE_MINUTES_MAX = 180;
const ACTIVE_DISCORD_RECONCILE_INITIAL_DELAY_MS = 5_000;
const ACTIVE_DISCORD_RECONCILE_INTERVAL_MS = 30_000;
const ACTIVE_DISCORD_RECONCILE_FULL_INTERVAL_MS = 5 * 60_000;
const EXPIRED_BAN_ROLE_CLEANUP_INITIAL_DELAY_MS = 20_000;
const EXPIRED_BAN_ROLE_CLEANUP_INTERVAL_MS = 5 * 60_000;
const GUILD_ORGANIZATION_CACHE_TTL_MS = 5 * 60_000;
const STAFF_ROLE_NAMES = [
  "[OWNER]",
  "Arenzyra Admin",
  "Arenzyra Staff",
  "Production Lead",
  "Tournament Organizer",
];
const PENDING_TEAM_LOGOS_KEY = "pendingTeamLogos";
const MAX_PENDING_TEAM_LOGOS = 250;
const MAX_LOGO_BYTES = 8 * 1024 * 1024;
const PLAY_STATUS_NOTE_PREFIX = "ARENZYRA_PLAY_STATUS:";
const ALLOWED_LOGO_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const IMAGE_EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

function normalizeFinalResultTemplate(value: string) {
  return value.trim().replace(/\r\n/g, "\n");
}
const AUTO_CLEANUP_DEFAULT_LIMIT = 100;
const AUTO_CLEANUP_ALL_LIMIT = 500;
const AUTO_CLEANUP_MAX_LIMIT = 1_000;
const AUTO_CLEANUP_GRACE_MINUTES = 30;
const AUTO_CLEANUP_STARTUP_CATCHUP_GRACE_MINUTES = 5;
const DISCORD_BULK_DELETE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const DISCORD_SESSION_TOPIC_PATTERN =
  /(?:^|\s)arenzyra-session=([^;\s]+);kind=([^;\s]+)/i;
const DISCORD_USER_MENTION_CAPTURE_PATTERN = /<@!?(\d{17,22})>/g;

function limitDiscordContent(content: string) {
  if (content.length <= 1900) {
    return content;
  }
  return `${content.slice(0, 1870)}\n\nOutput truncated. Use the web dashboard for the full view.`;
}

export type ApplyResultsDiscordResponse = {
  content: string;
  publicContent?: string;
  noShowCount?: number;
  imageBuffer?: Buffer;
  imageFiles?: Array<{
    name: string;
    buffer: Buffer;
  }>;
};

export type AutomaticResultScreenshotMode = "results" | "slot-map";

export type AutomaticResultScreenshotOptions = {
  matchNumber?: number | null;
};

export type RegistrationPlayStatusAction =
  UpdateRegistrationPlayStatusPayload["action"];

export type RegistrationPlayStatusTarget = {
  registrationId: string;
  teamId: string;
  teamLabel: string;
  slotNumber: number;
  optionLabel: string;
  optionDescription: string;
};

export type RegistrationPlayStatusTargetResolution =
  | {
      kind: "blocked";
      content: string;
    }
  | {
      kind: "single";
      target: RegistrationPlayStatusTarget;
    }
  | {
      kind: "multiple";
      content: string;
      targets: RegistrationPlayStatusTarget[];
    };

export type UpdateRegistrationPlayStatusOptions = {
  registrationId?: string | null;
  applyAll?: boolean;
};

export type AutomaticResultPreviewResponse = {
  sessionId: string;
  matchId: string;
  matchLabel: string;
  imageUrl: string;
  imageUrls?: string[];
  mode: AutomaticResultScreenshotMode;
  content: string;
  canApply: boolean;
  preview?: ScreenshotPreviewResponse;
  slots?: MatchSlotResponse[];
};

export type ReviewedResultRow = ScreenshotPreviewEntry & {
  include: boolean;
  edited?: boolean;
  autoSkipped?: boolean;
  autoSkipReason?: string | null;
  ocrTag?: string | null;
  ocrPlayerNames?: string[];
};

type ResultSummaryEntry = Pick<
  ScreenshotPreviewEntry,
  "position" | "tag" | "kills" | "teamName"
> & {
  placementPoints?: number | null;
  totalPoints?: number | null;
};

type FinalStandingEntry = SessionStandingsResponse["teams"][number];
type FinalBackupEntry = ResultBackupRowResponse;

export type ResultSummaryConfigPatch =
  | { action: "count"; value: number }
  | { action: "title"; value: string }
  | { action: "row"; value: string }
  | { action: "reset" };

type DiscordRegistrationMemberInput = {
  discordUserId: string;
  discordUsername?: string | null;
  displayName?: string | null;
  role?: "LEADER" | "PLAYER";
};

type RegisterTeamAndJoinOptions = {
  requesterDiscordId?: string;
  logoSource?: DiscordTeamLogoSource | null;
  placement?: "NORMAL" | "VIP";
  tournamentRosterJson?: Record<string, unknown>;
  registrationWindowBypass?: boolean;
  registrationRoleBypass?: boolean;
  audit?: DiscordActionAuditContext;
  backgroundDiscordSync?: boolean;
  onSessionRegistration?: (
    result: RegisterTeamAndJoinSessionResult,
  ) => Promise<void> | void;
};

type RegisterTeamAndJoinSessionResult = {
  registration: SessionRegistrationResponse | null;
  status: string;
  warning: string | null;
  content: string;
  config: SessionDiscordConfigResponse;
};

export type DiscordActionAuditContext = {
  actorDiscordId?: string | null;
  actorLabel?: string | null;
  sourceChannelId?: string | null;
  sessionName?: string | null;
};

export type DiscordActionLogParams = DiscordActionAuditContext & {
  action: string;
  sessionId?: string | null;
  team?: {
    id?: string | null;
    name?: string | null;
    tag?: string | null;
  } | null;
  slot?: number | string | null;
  status?: string | null;
  reason?: string | null;
  targetChannelId?: string | null;
  details?: string | string[] | null;
  color?: number;
};

type RegistrationStatusAnnouncementState = "open" | "closed";
type AccessAnnouncementKind = "earlyAccess" | "vipAccess";
type AccessAnnouncementState = "open" | "closed";
type AccessWindowSnapshot = {
  opensAt: Date | null;
  closesAt: Date | null;
  configured: boolean;
  state: AccessAnnouncementState;
  allowsAction: boolean;
};

type RegistrationWindowSyncOptions = {
  announceTransition?: boolean;
  announceOnlyWhenStoredStateChanges?: boolean;
  applyWeeklyScheduleTransition?: boolean;
  expectedTransitionAt?: number;
};

type RegistrationStatusAnnouncementMemory = {
  state: RegistrationStatusAnnouncementState;
  messageId: string;
  updatedAt: number;
};

type GuildMemberValidationCacheEntry = {
  expiresAt: number;
};

type GuildOrganizationCacheEntry = {
  organizationId: string | null;
  expiresAt: number;
};

type RegistrationRefreshCandidate = {
  session: SessionResponse;
  guild: Guild | null;
  organizationId: string | null;
};

export type PlayButtonStyleName =
  | "primary"
  | "secondary"
  | "success"
  | "danger";
export type { PlayControlMode } from "./discord-emojis";

export type ConfigurePlayButtonsOptions = {
  controlMode?: PlayControlMode | null;
  confirmEmoji?: string | null;
  notPlayingEmoji?: string | null;
  confirmLabel?: string | null;
  notPlayingLabel?: string | null;
  confirmStyle?: PlayButtonStyleName | null;
  notPlayingStyle?: PlayButtonStyleName | null;
  showButtons?: boolean | null;
  emojiOnly?: boolean | null;
};

export type DiscordTeamBanTarget =
  | { kind: "team"; query: string }
  | { kind: "team-id"; teamId: string; label?: string | null }
  | { kind: "manager"; discordUserId: string };

export type DiscordTeamBanCommand = {
  target: DiscordTeamBanTarget;
  scope: TeamBanScope;
  sessionId?: string | null;
  sessionIds?: string[];
  sessionSelectors?: string[];
  matchNumbers?: number[];
  allMatches?: boolean;
  days?: number | null;
  reason?: string | null;
  note?: string | null;
  serverAction?: DiscordTeamBanServerAction | null;
};

export type DiscordTeamBanServerAction = "NONE" | "ROLE" | "DISCORD_BAN";

export type DiscordTeamBanPreview = {
  team: TeamSummary | null;
  managers: DiscordManagerBanTarget[];
  command: DiscordTeamBanCommand;
  content: string;
  activeBanCount: number;
};

type DiscordManagerBanTarget = {
  discordUserId: string;
  discordUsername: string | null;
  displayName: string | null;
};

type DiscordBanSessionTarget = {
  id: string;
  name: string | null;
};

export type DiscordNoShowTeamBanCommand = {
  sessionId: string;
  matchId?: string | null;
  matchNumber?: number | null;
  scope: TeamBanScope;
  days?: number | null;
  reason?: string | null;
  note?: string | null;
  teamIds?: string[];
  managerDiscordUserIds?: string[];
};

export type DiscordTeamUnbanCommand = {
  target: DiscordTeamBanTarget;
  scope?: TeamBanScope | null;
  sessionId?: string | null;
  sessionIds?: string[];
  sessionSelectors?: string[];
  matchNumbers?: number[];
  allMatches?: boolean;
  reason?: string | null;
};

export type DiscordResultControlBanManager = {
  discordUserId: string;
  discordUsername: string | null;
  displayName: string | null;
  activeBanIds: string[];
};

export type DiscordResultControlBanTarget =
  | {
      kind: "team";
      value: string;
      teamId: string;
      teamName: string;
      teamTag: string | null;
      teamBanIds: string[];
      managerBanIds: string[];
      managers: DiscordResultControlBanManager[];
      scopeLabels: string[];
      expiresAt: string | null;
    }
  | {
      kind: "manager";
      value: string;
      discordUserId: string;
      managerBanIds: string[];
      managers: DiscordResultControlBanManager[];
      scopeLabels: string[];
      expiresAt: string | null;
    };

export type DiscordResultControlState = {
  sessionId: string;
  sessionName: string | null;
  matchCount: number;
  latestMatchLabel: string | null;
  activeTeamBanCount: number;
  activeManagerBanCount: number;
  bannedTeamCount: number;
  targets: DiscordResultControlBanTarget[];
};

type DiscordBanChannelNoticeParams = {
  title: string;
  team?: TeamSummary | TeamBanResponse["team"] | null;
  managers?: DiscordManagerBanTarget[];
  scope?: TeamBanScope | null;
  sessionTargets?: DiscordBanSessionTarget[];
  sessionName?: string | null;
  matchLabel?: string | null;
  duration?: string | null;
  reason?: string | null;
  status?: string | null;
};

type DiscordNoShowBanChannelNoticeParams = {
  response: NoShowTeamBanResponse;
  input: DiscordNoShowTeamBanCommand;
  sessionName?: string | null;
};

type DiscordNoShowAutoBanRule = {
  enabled: boolean;
  type: "TOTAL_MISSES" | "MATCH_MISSED";
  misses: number | null;
  matchNumber: number | null;
  durationDays: number | null;
  scope: "SESSION" | "TEAM";
  reason: string;
};

export type DiscordTeamLogoSource = {
  teamName: string;
  tag?: string | null;
  channelId: string;
  messageId: string;
  attachmentId?: string | null;
  url: string;
  filename?: string | null;
  contentType?: string | null;
  savedByDiscordId?: string | null;
  savedByDiscordUsername?: string | null;
};

type AutoCleanupChannelKey =
  | "session"
  | "registration"
  | "slots"
  | "slotData"
  | "registrations"
  | "waitlist"
  | "idp"
  | "manager"
  | "transfer"
  | "roles";

type AutoCleanupMode = "safe" | "all";
type ScrimRoleCleanupMode = "reconcile" | "strip";
type ScrimRoleCleanupOptions = {
  includeBannedRole?: boolean;
  fetchAllGuildMembers?: boolean;
};

type AutoCleanupSchedule = {
  channel: AutoCleanupChannelKey;
  enabled: boolean;
  time: string;
  mode: AutoCleanupMode;
  limit: number;
};

type RegistrationPlayStatus = {
  status: "CONFIRM" | "NOT_PLAYING";
  discordUserId: string | null;
};

type ConfirmationReminderConfig = {
  enabled: boolean;
  roleId: string | null;
  openDelayMinutes: number;
  intervalMinutes: number;
  maxMessages: number;
  managerMentionThreshold: number;
  roleMessageText: string;
  managerMessageText: string;
};

type ConfirmationReminderState = {
  windowKey: string;
  sentCount: number;
  lastSentAt: number;
  lastMessageId?: string;
};

type ScrimRoleCleanupResult = {
  mode: ScrimRoleCleanupMode;
  knownMembers: number;
  cachedRoleMembers: number;
  added: number;
  removed: number;
  failed: number;
};

type ExpiredBanRoleCleanupResult = {
  expiredManagerBans: number;
  checkedMembers: number;
  removedRoles: number;
  keptActive: number;
  missingMembers: number;
  failed: number;
};

type ActiveBanRoleRestoreResult = {
  checkedManagers: number;
  restoredRoles: number;
  missingMembers: number;
  failed: number;
};

const AUTO_CLEANUP_CHANNELS: Array<{
  key: AutoCleanupChannelKey;
  label: string;
}> = [
  { key: "session", label: "Full Channel Cleanup" },
  { key: "registration", label: "Registration" },
  { key: "slotData", label: "Clear Slot Assignments" },
  { key: "registrations", label: "Clear All Registrations" },
  { key: "slots", label: "Slot Channel Messages" },
  { key: "waitlist", label: "Waitlist" },
  { key: "idp", label: "IDP" },
  { key: "manager", label: "Manager Chat" },
  { key: "transfer", label: "Transfer Roles" },
  { key: "roles", label: "Scrim Roles" },
];

type PendingTeamLogoRecord = DiscordTeamLogoSource & {
  key: string;
  tagKey?: string | null;
  savedAt: string;
};

type QueuedDiscordSync = {
  guild: Guild;
  sessionId: string;
  organizationId: string | null;
  removedTeamIds: Set<string>;
  activeTeamIds: Set<string>;
  extraDiscordUserIds: Set<string>;
  cleanupTeamIds: Set<string>;
  fastMessageRefresh: boolean;
  requiresFullSync: boolean;
  pending: boolean;
  running: boolean;
  timer: NodeJS.Timeout | null;
  delayMs: number;
  firstQueuedAt: number;
  latestQueuedAt: number;
  retryAttempt: number;
};

type QueuedDiscordSyncOptions = {
  organizationId?: string | null;
  removedTeamIds?: string[];
  activeTeamIds?: string[];
  extraDiscordUserIds?: string[];
  cleanupTeamIds?: string[];
  fastMessageRefresh?: boolean;
  skipFullSync?: boolean;
  delayMs?: number;
};

type DiscordSessionApi = Pick<
  ArenzyraApiClient,
  | "applyNoShowAutoBansForMatch"
  | "applyScreenshotResults"
  | "cleanupDiscordTeam"
  | "createSession"
  | "createSessionMatch"
  | "createManagerBan"
  | "createProductionDiscordSet"
  | "createTeamBan"
  | "createNoShowTeamBans"
  | "getDiscordConfig"
  | "getDiscordChannelPause"
  | "getMatchRenderImage"
  | "getMatchResults"
  | "getResultBackup"
  | "getResultBackupRenderImage"
  | "getSession"
  | "getSessionDiscordConfig"
  | "getSessionStandings"
  | "getProductionDiscordConfig"
  | "getTeamByTag"
  | "importProductionDiscordSlots"
  | "listSessionMatches"
  | "listDiscordManagedTeams"
  | "listManagerBans"
  | "listTeamBans"
  | "listSessions"
  | "listRegistrations"
  | "listResultBackups"
  | "listMatchSlots"
  | "listTeamMembers"
  | "markDiscordGuildRemoved"
  | "mapScreenshotSlots"
  | "previewScreenshotResults"
  | "previewNoShowTeamBans"
  | "registerDiscordTeam"
  | "registerTeam"
  | "refreshDiscordSourceImports"
  | "releaseDiscordTeamMember"
  | "resolveDiscordChannel"
  | "resolveDiscordGuild"
  | "resolveProductionDiscordChannel"
  | "removeRegistration"
  | "removeSlotRegistrations"
  | "resetSessionResults"
  | "revokeManagerBan"
  | "revokeTeamBan"
  | "searchTeams"
  | "syncOldDiscordLogos"
  | "syncOldDiscordPlayerPhotos"
  | "syncSessionMatchSlots"
  | "updateSession"
  | "updateMatchResult"
  | "updateManualMatchResults"
  | "updateResultBackupRows"
  | "deleteProductionDiscordSet"
  | "updateDiscordChannelPause"
  | "updateProductionDiscordConfig"
  | "updateSessionDiscordConfig"
  | "updateRegistrationManagers"
  | "updateRegistrationPlacement"
  | "updateRegistrationPlayStatus"
  | "uploadDiscordPlayerPhoto"
  | "uploadTeamLogo"
  | "upsertProductionDiscordTeam"
> & {
  withOrganization?<T>(
    organizationId: string | null | undefined,
    fn: () => Promise<T>,
  ): Promise<T>;
};

export class DiscordSessionService {
  private readonly apiClient: DiscordSessionApi;
  private readonly scrimDiscordSetup: ScrimDiscordSetupService;

  // Temporary creator tracking until Discord users are linked to backend users.
  private readonly sessionCreatorById = new Map<string, string>();
  private readonly queuedDiscordSyncs = new Map<string, QueuedDiscordSync>();
  private readonly copiedEventSourceRefreshTimers = new Map<
    string,
    NodeJS.Timeout
  >();
  private readonly confirmationWindowTimers = new Map<
    string,
    NodeJS.Timeout[]
  >();
  private readonly confirmationWindowSignatures = new Map<string, string>();
  private readonly registrationWindowTimers = new Map<
    string,
    NodeJS.Timeout[]
  >();
  private readonly waitlistPromotionWindowTimers = new Map<
    string,
    NodeJS.Timeout[]
  >();
  private readonly registrationWindowSignatures = new Map<string, string>();
  private readonly registrationStatusAnnouncementLocks = new Set<string>();
  private readonly registrationStatusAnnouncementWaiters = new Map<
    string,
    Array<() => void>
  >();
  private readonly registrationStatusAnnouncementMemory = new Map<
    string,
    RegistrationStatusAnnouncementMemory
  >();
  private autoCleanupStartedAt = Date.now();
  private readonly autoCleanupRunKeys = new Set<string>();
  private readonly confirmationCloseCleanupRunKeys = new Set<string>();
  private readonly confirmationReminderStates = new Map<
    string,
    ConfirmationReminderState
  >();
  private activeDiscordSessionReconcileTimer: NodeJS.Timeout | null = null;
  private activeDiscordSessionReconcileRunning = false;
  private activeDiscordSessionLastFullSyncAt = 0;
  private expiredBanRoleCleanupTimer: NodeJS.Timeout | null = null;
  private expiredBanRoleCleanupRunning = false;
  private readonly managerMentionMemberCache = new Map<
    string,
    GuildMemberValidationCacheEntry
  >();
  private readonly guildOrganizationCache = new Map<
    string,
    GuildOrganizationCacheEntry
  >();

  constructor(
    apiClient: DiscordSessionApi = new ArenzyraApiClient(),
    scrimDiscordSetup = new ScrimDiscordSetupService(),
  ) {
    this.apiClient = apiClient;
    this.scrimDiscordSetup = scrimDiscordSetup;
  }

  withOrganization<T>(
    organizationId: string | null | undefined,
    fn: () => Promise<T>,
  ): Promise<T> {
    return this.apiClient.withOrganization
      ? this.apiClient.withOrganization(organizationId, fn)
      : fn();
  }

  async resolveProductionDiscordChannel(
    guildId: string,
    channelId: string,
  ): Promise<ResolvedProductionDiscordChannelResponse | null> {
    try {
      return await this.apiClient.resolveProductionDiscordChannel(
        guildId,
        channelId,
      );
    } catch (error) {
      const message = toFriendlyApiError(error).toLowerCase();
      if (
        message.includes("not linked") ||
        message.includes("not found") ||
        message.includes("requested resource")
      ) {
        return null;
      }
      throw new Error(toFriendlyApiError(error));
    }
  }

  private productionDiscordSetKey(index: number) {
    return `production-${Math.min(20, Math.max(1, index))}`;
  }

  private defaultProductionDiscordSet(index: number): ProductionDiscordSet {
    return {
      key: this.productionDiscordSetKey(index),
      index,
      setName: `set-${index}`,
      eventId: null,
      eventName: null,
      categoryId: null,
      categoryName: null,
      slotsChannelId: null,
      slotsChannelName: null,
      logosChannelId: null,
      logosChannelName: null,
      playerPhotosChannelId: null,
      playerPhotosChannelName: null,
      idpChannelId: null,
      idpChannelName: null,
      logsChannelId: null,
      logsChannelName: null,
      controlChannelId: null,
      controlChannelName: null,
      productionRoleId: null,
      productionRoleName: `Production ${index}`,
      startSlot: null,
      normalSlots: null,
      vipSlots: null,
      slots: [],
      lastSlotImport: null,
    };
  }

  private productionDiscordSetLabel(set: ProductionDiscordSet) {
    return set.setName?.trim() || `set-${set.index}`;
  }

  private productionDiscordSetHasSetup(set: ProductionDiscordSet) {
    return Boolean(
      set.categoryId ||
      set.slotsChannelId ||
      set.logosChannelId ||
      set.playerPhotosChannelId ||
      set.idpChannelId ||
      set.logsChannelId ||
      set.controlChannelId ||
      set.productionRoleId,
    );
  }

  private productionHelpMarker(
    setKey: string,
    kind: ProductionDiscordChannelKind,
  ) {
    return `[${PRODUCTION_HELP_MARKER_PREFIX}:${setKey}:${kind}]`;
  }

  private productionHelpCommandLines(kind: ProductionDiscordChannelKind) {
    switch (kind) {
      case "slots":
        return [
          "Paste the full slot/team list in this channel.",
          "Accepted examples:",
          "`3. TEAM NAME | TAG |`",
          "`TEAM NAME | TAG |`",
          "",
          "The bot imports the list into the linked production event and syncs match slots.",
        ];
      case "logos":
        return [
          "Save a team logo for production widgets and results.",
          "Command:",
          "`%logo Team Name | TAG`",
          "",
          "Attach one PNG, JPG, or WEBP logo image to the same message.",
        ];
      case "player-photos":
        return [
          "Save a player photo for MVP, top fragger, and player widgets.",
          "Command:",
          "`%photo Team Name | Player Name | Player UID`",
          "",
          "Attach one PNG, JPG, or WEBP player photo to the same message.",
        ];
      case "idp":
        return [
          "Post room ID, password, and production lobby notes here.",
          "This channel is visible to the production role for the set.",
        ];
      case "logs":
        return [
          "Arenzyra writes production automation logs here.",
          "Use this channel to audit imports, cleanup, and setup actions.",
        ];
      case "control":
        return [
          "Production role and channel reference for this set.",
          "Use `/production-setup` again to refresh channels, topics, and these pinned instructions.",
        ];
    }
  }

  private productionChannelHelpContent(params: {
    kind: ProductionDiscordChannelKind;
    set: ProductionDiscordSet;
    productionRoleId: string;
  }) {
    const { kind, set, productionRoleId } = params;
    const titleByKind: Record<ProductionDiscordChannelKind, string> = {
      slots: "Slots",
      logos: "Logos",
      "player-photos": "Player Photos",
      idp: "IDP",
      logs: "Logs",
      control: "Role Info",
    };
    const lines = [
      `**Arenzyra Production - ${titleByKind[kind]}**`,
      `Set: ${this.productionDiscordSetLabel(set)} (${set.key})`,
      `Role: <@&${productionRoleId}>`,
      set.eventName || set.eventId
        ? `Linked event: ${set.eventName ?? set.eventId}`
        : "Linked event: Not linked",
      "",
      ...this.productionHelpCommandLines(kind),
    ];

    if (kind !== "logs") {
      lines.push(
        "",
        "Staff cleanup:",
        "`%clean-channel preview` checks what can be removed.",
        "`%clean-channel` asks for confirmation before deleting.",
      );
    }

    lines.push("", this.productionHelpMarker(set.key, kind));
    return lines.join("\n");
  }

  private async fetchProductionPinnedMessages(channel: GuildTextBasedChannel) {
    const manager = channel.messages as unknown as {
      fetchPins?: () => Promise<unknown>;
      fetchPinned?: () => Promise<unknown>;
    };
    const pinned =
      typeof manager.fetchPins === "function"
        ? await manager.fetchPins().catch(() => null)
        : typeof manager.fetchPinned === "function"
          ? await manager.fetchPinned().catch(() => null)
          : null;
    if (!pinned || typeof pinned !== "object") return [];
    const items = (pinned as { items?: Array<{ message?: Message }> }).items;
    if (Array.isArray(items)) {
      return items
        .map((item) => item.message)
        .filter((message): message is Message => Boolean(message));
    }
    const values = (pinned as { values?: () => IterableIterator<Message> })
      .values;
    return typeof values === "function" ? [...values.call(pinned)] : [];
  }

  private async ensureProductionChannelHelpPin(params: {
    channel: GuildTextBasedChannel;
    kind: ProductionDiscordChannelKind;
    set: ProductionDiscordSet;
    productionRoleId: string;
  }) {
    const { channel, kind, set, productionRoleId } = params;
    const marker = this.productionHelpMarker(set.key, kind);
    const content = this.productionChannelHelpContent({
      kind,
      set,
      productionRoleId,
    });
    const botUserId = channel.client.user?.id ?? null;
    const isManagedHelpMessage = (message: Message) =>
      message.content.includes(marker) &&
      (!botUserId || message.author?.id === botUserId);
    const pinnedHelpMessages = (
      await this.fetchProductionPinnedMessages(channel)
    ).filter(isManagedHelpMessage);
    let helpMessage: Message | null = pinnedHelpMessages[0] ?? null;

    if (!helpMessage) {
      const recent = await channel.messages
        .fetch({ limit: 50 })
        .catch(() => null);
      helpMessage = recent
        ? ([...recent.values()].find(isManagedHelpMessage) ?? null)
        : null;
    }

    if (helpMessage) {
      await helpMessage
        .edit({ content, allowedMentions: { parse: [] } })
        .catch(() => undefined);
    } else {
      helpMessage = await channel
        .send({ content, allowedMentions: { parse: [] } })
        .catch(() => null);
    }

    if (helpMessage && !helpMessage.pinned) {
      await helpMessage
        .pin(`Pin Arenzyra production ${kind} instructions`)
        .catch(() => undefined);
    }

    for (const duplicate of pinnedHelpMessages.slice(1)) {
      await duplicate
        .unpin(`Remove duplicate Arenzyra production ${kind} instructions`)
        .catch(() => undefined);
    }
  }

  private async ensureProductionChannelHelpPins(params: {
    set: ProductionDiscordSet;
    productionRoleId: string;
    channels: Record<ProductionDiscordChannelKind, GuildTextBasedChannel>;
  }) {
    const { set, productionRoleId, channels } = params;
    for (const kind of [
      "slots",
      "logos",
      "player-photos",
      "idp",
      "logs",
      "control",
    ] as const) {
      await this.ensureProductionChannelHelpPin({
        channel: channels[kind],
        kind,
        set,
        productionRoleId,
      });
    }
  }

  private async fetchProductionTextChannel(
    guild: Guild,
    channelId: string | null | undefined,
  ): Promise<GuildTextBasedChannel | null> {
    if (!channelId) return null;
    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased() || channel.isDMBased()) {
      return null;
    }
    return channel as GuildTextBasedChannel;
  }

  async refreshProductionDiscordChannelPins(guild: Guild): Promise<string> {
    const linkedGuild = await this.apiClient.resolveDiscordGuild(guild.id);
    const organizationId = linkedGuild.organizationId;
    const current = await this.withOrganization(organizationId, () =>
      this.apiClient.getProductionDiscordConfig(organizationId),
    );
    if (!current.approved) {
      throw new Error(
        "Production Discord is not approved for this organizer yet.",
      );
    }

    let refreshed = 0;
    const skipped: string[] = [];
    for (const set of current.config.sets.sort(
      (left, right) => left.index - right.index,
    )) {
      if (!this.productionDiscordSetHasSetup(set)) continue;
      if (!set.productionRoleId) {
        skipped.push(`${this.productionDiscordSetLabel(set)}: missing role`);
        continue;
      }
      const channels = {
        slots: await this.fetchProductionTextChannel(guild, set.slotsChannelId),
        logos: await this.fetchProductionTextChannel(guild, set.logosChannelId),
        "player-photos": await this.fetchProductionTextChannel(
          guild,
          set.playerPhotosChannelId,
        ),
        idp: await this.fetchProductionTextChannel(guild, set.idpChannelId),
        logs: await this.fetchProductionTextChannel(guild, set.logsChannelId),
        control: await this.fetchProductionTextChannel(
          guild,
          set.controlChannelId,
        ),
      };
      const missingKinds = Object.entries(channels)
        .filter(([, channel]) => !channel)
        .map(([kind]) => kind);
      if (missingKinds.length > 0) {
        skipped.push(
          `${this.productionDiscordSetLabel(set)}: missing ${missingKinds.join(
            ", ",
          )}`,
        );
        continue;
      }

      await this.ensureProductionChannelHelpPins({
        set,
        productionRoleId: set.productionRoleId,
        channels: channels as Record<
          ProductionDiscordChannelKind,
          GuildTextBasedChannel
        >,
      });
      refreshed += 1;
    }

    const lines = [
      `Production channel pins refreshed for ${refreshed} set(s).`,
    ];
    if (skipped.length > 0) {
      lines.push("Skipped:", ...skipped.map((entry) => `- ${entry}`));
    }
    if (refreshed === 0 && skipped.length === 0) {
      lines.push("No configured production sets were found.");
    }
    return lines.join("\n");
  }

  private selectProductionDiscordSetupSet(sets: ProductionDiscordSet[]) {
    const sortedSets = [...sets].sort(
      (left, right) => left.index - right.index,
    );
    const pendingLinkedSet = sortedSets.find(
      (set) => set.eventId && !this.productionDiscordSetHasSetup(set),
    );
    if (pendingLinkedSet) return pendingLinkedSet;
    for (let index = 1; index <= 20; index += 1) {
      const key = this.productionDiscordSetKey(index);
      const existing = sortedSets.find((set) => set.key === key);
      if (!existing) return this.defaultProductionDiscordSet(index);
      if (!existing.eventId && !this.productionDiscordSetHasSetup(existing)) {
        return {
          ...existing,
          setName: `set-${existing.index}`,
          productionRoleName:
            existing.productionRoleName ?? `Production ${existing.index}`,
        };
      }
    }
    throw new Error("Production Discord set limit reached.");
  }

  async setupProductionDiscordChannels(guild: Guild): Promise<string> {
    const linkedGuild = await this.apiClient.resolveDiscordGuild(guild.id);
    const organizationId = linkedGuild.organizationId;
    let current = await this.withOrganization(organizationId, () =>
      this.apiClient.getProductionDiscordConfig(organizationId),
    );
    if (!current.approved) {
      throw new Error(
        "Production Discord is not approved for this organizer yet.",
      );
    }
    const currentSet = this.selectProductionDiscordSetupSet(
      current.config.sets,
    );
    const setIndex = currentSet.index;
    const setKey = currentSet.key;

    const roleName =
      currentSet.productionRoleName?.trim() || `Production ${setIndex}`;
    let productionRole = currentSet.productionRoleId
      ? await guild.roles.fetch(currentSet.productionRoleId).catch(() => null)
      : null;
    productionRole ??=
      guild.roles.cache.find((role) => role.name === roleName) ?? null;
    if (!productionRole) {
      productionRole = await guild.roles.create({
        name: roleName,
        mentionable: false,
        reason: "Arenzyra production Discord setup",
      });
    }

    const botId = guild.members.me?.id ?? guild.client.user?.id ?? null;
    const botOverwrite = botId
      ? [
          {
            id: botId,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.ReadMessageHistory,
              PermissionFlagsBits.ManageMessages,
              PermissionFlagsBits.ManageChannels,
            ],
          },
        ]
      : [];
    const productionOverwrites = [
      {
        id: guild.roles.everyone.id,
        deny: [PermissionFlagsBits.ViewChannel],
      },
      {
        id: productionRole.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
        ],
      },
      ...botOverwrite,
    ];
    const logOverwrites = [
      {
        id: guild.roles.everyone.id,
        deny: [PermissionFlagsBits.ViewChannel],
      },
      ...botOverwrite,
    ];

    const setLabel = this.productionDiscordSetLabel(currentSet);
    const categoryName = currentSet.categoryName?.trim() || setLabel;
    let category = currentSet.categoryId
      ? await guild.channels.fetch(currentSet.categoryId).catch(() => null)
      : null;
    if (category?.type !== ChannelType.GuildCategory) {
      category =
        guild.channels.cache.find(
          (channel) =>
            channel.type === ChannelType.GuildCategory &&
            channel.name === categoryName,
        ) ?? null;
    }
    if (!category || category.type !== ChannelType.GuildCategory) {
      category = await guild.channels.create({
        name: categoryName,
        type: ChannelType.GuildCategory,
        permissionOverwrites: productionOverwrites,
        reason: "Arenzyra production Discord setup",
      });
    }

    const ensureTextChannel = async (
      id: string | null | undefined,
      name: string,
      kind: string,
      permissionOverwrites: typeof productionOverwrites,
    ) => {
      const existingById = id
        ? await guild.channels.fetch(id).catch(() => null)
        : null;
      if (existingById?.type === ChannelType.GuildText) {
        await existingById
          .edit({
            parent: category.id,
            topic: `arenzyra-production=${organizationId};set=${setKey};kind=${kind}`,
            reason: "Arenzyra production Discord setup refresh",
          })
          .catch(() => undefined);
        return existingById;
      }
      const existingByName =
        guild.channels.cache.find(
          (channel) =>
            channel.type === ChannelType.GuildText &&
            channel.parentId === category.id &&
            channel.name === name,
        ) ?? null;
      if (existingByName?.type === ChannelType.GuildText) {
        return existingByName;
      }
      return guild.channels.create({
        name,
        type: ChannelType.GuildText,
        parent: category.id,
        topic: `arenzyra-production=${organizationId};set=${setKey};kind=${kind}`,
        permissionOverwrites,
        reason: "Arenzyra production Discord setup",
      });
    };

    const slotsChannel = await ensureTextChannel(
      currentSet.slotsChannelId,
      currentSet.slotsChannelName?.trim() || "slots",
      "slots",
      productionOverwrites,
    );
    const logosChannel = await ensureTextChannel(
      currentSet.logosChannelId,
      currentSet.logosChannelName?.trim() || "logos",
      "logos",
      productionOverwrites,
    );
    const playerPhotosChannel = await ensureTextChannel(
      currentSet.playerPhotosChannelId,
      currentSet.playerPhotosChannelName?.trim() || "player-photos",
      "player-photos",
      productionOverwrites,
    );
    const idpChannel = await ensureTextChannel(
      currentSet.idpChannelId,
      currentSet.idpChannelName?.trim() || "idp",
      "idp",
      productionOverwrites,
    );
    const logsChannel = await ensureTextChannel(
      currentSet.logsChannelId,
      currentSet.logsChannelName?.trim() || "logs",
      "logs",
      logOverwrites,
    );
    const controlChannel = await ensureTextChannel(
      currentSet.controlChannelId,
      currentSet.controlChannelName?.trim() || "role-info",
      "control",
      logOverwrites,
    );

    const saved = await this.withOrganization(organizationId, () =>
      this.apiClient.updateProductionDiscordConfig(organizationId, {
        setKey,
        setIndex,
        setName: currentSet.setName?.trim() || `set-${setIndex}`,
        eventId: currentSet.eventId,
        guildId: guild.id,
        guildName: guild.name,
        categoryId: category.id,
        categoryName: category.name,
        slotsChannelId: slotsChannel.id,
        slotsChannelName: slotsChannel.name,
        logosChannelId: logosChannel.id,
        logosChannelName: logosChannel.name,
        playerPhotosChannelId: playerPhotosChannel.id,
        playerPhotosChannelName: playerPhotosChannel.name,
        idpChannelId: idpChannel.id,
        idpChannelName: idpChannel.name,
        logsChannelId: logsChannel.id,
        logsChannelName: logsChannel.name,
        controlChannelId: controlChannel.id,
        controlChannelName: controlChannel.name,
        productionRoleId: productionRole.id,
        productionRoleName: productionRole.name,
      }),
    );
    const savedSet =
      saved.config.sets.find((set) => set.key === setKey) ?? currentSet;

    await this.ensureProductionChannelHelpPins({
      set: savedSet,
      productionRoleId: productionRole.id,
      channels: {
        slots: slotsChannel as GuildTextBasedChannel,
        logos: logosChannel as GuildTextBasedChannel,
        "player-photos": playerPhotosChannel as GuildTextBasedChannel,
        idp: idpChannel as GuildTextBasedChannel,
        logs: logsChannel as GuildTextBasedChannel,
        control: controlChannel as GuildTextBasedChannel,
      },
    });

    await controlChannel
      .send({
        content: [
          `Production set: ${this.productionDiscordSetLabel(savedSet)}`,
          `Set key: ${savedSet.key}`,
          `Role: <@&${productionRole.id}> (${productionRole.name})`,
          `Linked event: ${savedSet.eventName ?? savedSet.eventId ?? "Not linked"}`,
          `Slots: <#${slotsChannel.id}>`,
          `Logos: <#${logosChannel.id}>`,
          `Player Photos: <#${playerPhotosChannel.id}>`,
          `IDP: <#${idpChannel.id}>`,
          `Logs: <#${logsChannel.id}>`,
        ].join("\n"),
        allowedMentions: { parse: [] },
      })
      .catch(() => undefined);

    return [
      "Production Discord setup saved.",
      `Set: ${this.productionDiscordSetLabel(savedSet)} (${savedSet.key})`,
      `Role: <@&${productionRole.id}>`,
      `Linked event: ${savedSet.eventName ?? savedSet.eventId ?? "Not linked"}`,
      `Slots: <#${savedSet.slotsChannelId}>`,
      `Logos: <#${savedSet.logosChannelId}>`,
      `Player Photos: <#${savedSet.playerPhotosChannelId}>`,
      `IDP: <#${savedSet.idpChannelId}>`,
      `Logs: <#${savedSet.logsChannelId}>`,
      `Role Info: <#${savedSet.controlChannelId}>`,
      "Pinned instructions refreshed in each production channel.",
      "Production channels only accept slot paste, `%logo`, `%photo`, and `%clean-channel` automation.",
    ].join("\n");
  }

  async deleteProductionDiscordSet(params: {
    guild: Guild;
    organizationId: string;
    set: ProductionDiscordSet;
    commandChannelId?: string | null;
  }): Promise<string> {
    const { guild, organizationId, set, commandChannelId } = params;
    const setLabel = this.productionDiscordSetLabel(set);
    const reason = `Arenzyra production Discord delete ${setLabel}`;
    const channelEntries = [
      { id: set.slotsChannelId, label: "slots" },
      { id: set.logosChannelId, label: "logos" },
      { id: set.playerPhotosChannelId, label: "player-photos" },
      { id: set.idpChannelId, label: "idp" },
      { id: set.logsChannelId, label: "logs" },
      { id: set.controlChannelId, label: "role-info" },
    ].filter((entry): entry is { id: string; label: string } =>
      Boolean(entry.id),
    );
    const deferredChannels = channelEntries.filter(
      (entry) => entry.id === commandChannelId,
    );
    let deletedChannels = 0;
    let missingChannels = 0;
    const failed: string[] = [];

    const deleteChannel = async (id: string, label: string) => {
      const channel = await guild.channels.fetch(id).catch(() => null);
      if (!channel) {
        missingChannels += 1;
        return;
      }
      try {
        await (channel as { delete(reason?: string): Promise<unknown> }).delete(
          reason,
        );
        deletedChannels += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failed.push(`${label}: ${message}`);
      }
    };

    for (const entry of channelEntries) {
      if (entry.id === commandChannelId) continue;
      await deleteChannel(entry.id, entry.label);
    }

    let deletedCategory = false;
    let missingCategory = false;
    const deleteCategory = async () => {
      if (!set.categoryId) return;
      const category = await guild.channels
        .fetch(set.categoryId)
        .catch(() => null);
      if (!category) {
        missingCategory = true;
        return;
      }
      try {
        await (
          category as { delete(reason?: string): Promise<unknown> }
        ).delete(reason);
        deletedCategory = true;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failed.push(`category: ${message}`);
      }
    };

    if (deferredChannels.length === 0) {
      await deleteCategory();
    }

    let deletedRole = false;
    let missingRole = false;
    if (set.productionRoleId) {
      const role = await guild.roles
        .fetch(set.productionRoleId)
        .catch(() => null);
      if (!role) {
        missingRole = true;
      } else {
        try {
          await role.delete(reason);
          deletedRole = true;
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          failed.push(`role: ${message}`);
        }
      }
    }

    if (failed.length > 0) {
      throw new Error(
        `Could not delete every Discord resource for ${setLabel}: ${failed.join("; ")}`,
      );
    }

    await this.withOrganization(organizationId, () =>
      this.apiClient.deleteProductionDiscordSet(organizationId, set.key),
    );

    if (deferredChannels.length > 0) {
      setTimeout(() => {
        void (async () => {
          for (const entry of deferredChannels) {
            await deleteChannel(entry.id, entry.label);
          }
          await deleteCategory();
        })();
      }, 5000).unref?.();
    }

    return [
      `Deleted ${setLabel}.`,
      `Channels removed now: ${deletedChannels}/${channelEntries.length}`,
      deferredChannels.length > 0
        ? `Current channel will be removed in 5 seconds: ${deferredChannels
            .map((entry) => entry.label)
            .join(", ")}`
        : null,
      missingChannels > 0
        ? `Missing channels skipped: ${missingChannels}`
        : null,
      set.categoryId
        ? deletedCategory
          ? "Category removed."
          : missingCategory
            ? "Category was already missing."
            : deferredChannels.length > 0
              ? "Category will be removed after the current channel."
              : null
        : null,
      set.productionRoleId
        ? deletedRole
          ? "Role removed."
          : missingRole
            ? "Role was already missing."
            : null
        : null,
      "Saved production set config removed.",
    ]
      .filter(Boolean)
      .join("\n");
  }

  async importProductionDiscordSlots(params: {
    organizationId: string;
    guildId: string;
    sourceChannelId: string;
    sourceMessageId: string;
    content: string;
    setKey?: string | null;
  }) {
    return this.withOrganization(params.organizationId, () =>
      this.apiClient.importProductionDiscordSlots(params.organizationId, {
        setKey: params.setKey,
        content: params.content,
        guildId: params.guildId,
        sourceChannelId: params.sourceChannelId,
        sourceMessageId: params.sourceMessageId,
      }),
    );
  }

  async upsertProductionDiscordTeam(params: {
    organizationId: string;
    guildId: string;
    sourceChannelId: string;
    sourceMessageId: string;
    name: string;
    tag?: string | null;
  }): Promise<UpsertProductionDiscordTeamResponse> {
    return this.withOrganization(params.organizationId, () =>
      this.apiClient.upsertProductionDiscordTeam(params.organizationId, {
        name: params.name,
        tag: params.tag,
        guildId: params.guildId,
        sourceChannelId: params.sourceChannelId,
        sourceMessageId: params.sourceMessageId,
      }),
    );
  }

  async uploadProductionTeamLogo(
    organizationId: string,
    teamId: string,
    logoUpload: TeamLogoUpload,
  ) {
    return this.withOrganization(organizationId, () =>
      this.apiClient.uploadTeamLogo(teamId, logoUpload),
    );
  }

  async uploadProductionPlayerPhoto(
    organizationId: string,
    payload: {
      uid: string;
      teamName: string;
      playerName: string;
    },
    photoUpload: PlayerPhotoUpload,
  ) {
    return this.withOrganization(organizationId, () =>
      this.apiClient.uploadDiscordPlayerPhoto(
        {
          uid: payload.uid,
          teamName: payload.teamName,
          playerName: payload.playerName,
          registrationMode: "SCRIM",
        },
        photoUpload,
      ),
    );
  }

  private async refreshCopiedEventSourceImportsNow(
    sessionId: string,
    organizationId: string | null | undefined,
  ): Promise<RefreshDiscordSourceImportsResponse> {
    return this.withOrganization(organizationId, () =>
      this.apiClient.refreshDiscordSourceImports(sessionId),
    );
  }

  async syncOldDiscordLogos(params: {
    sessionId: string;
    organizationId: string | null | undefined;
    channelId: string;
    limit?: number;
  }): Promise<SyncOldDiscordLogosResponse> {
    return this.withOrganization(params.organizationId, () =>
      this.apiClient.syncOldDiscordLogos(params.sessionId, {
        channelId: params.channelId,
        limit: params.limit,
      }),
    );
  }

  async syncOldDiscordPlayerPhotos(params: {
    sessionId: string;
    organizationId: string | null | undefined;
    channelId: string;
    limit?: number;
  }) {
    return this.withOrganization(params.organizationId, () =>
      this.apiClient.syncOldDiscordPlayerPhotos(params.sessionId, {
        channelId: params.channelId,
        limit: params.limit,
      }),
    );
  }

  async markDiscordGuildRemoved(
    guild: Pick<Guild, "id" | "name">,
  ): Promise<DiscordGuildRemovedResponse> {
    const result = await this.apiClient.markDiscordGuildRemoved(
      guild.id,
      guild.name,
    );
    this.guildOrganizationCache.delete(guild.id);
    return result;
  }

  private scheduleCopiedEventSourceImportRefresh(
    sessionId: string,
    config:
      | Pick<
          SessionDiscordConfigResponse,
          "organizationId" | "enabled" | "guildId" | "categoryId"
        >
      | null
      | undefined,
  ) {
    if (
      !config?.enabled ||
      !config.guildId?.trim() ||
      !config.categoryId?.trim()
    ) {
      return;
    }

    const key = `${config.organizationId}:${sessionId}`;
    const existing = this.copiedEventSourceRefreshTimers.get(key);
    if (existing) {
      clearTimeout(existing);
    }

    const timer = setTimeout(() => {
      this.copiedEventSourceRefreshTimers.delete(key);
      void this.refreshCopiedEventSourceImportsNow(
        sessionId,
        config.organizationId,
      )
        .then((result) => {
          if (result.refreshed > 0) {
            console.log(
              `[DiscordEventSource] refreshed copied events sourceSession=${sessionId} refreshed=${result.refreshed}`,
            );
          }
        })
        .catch((error) => {
          console.warn(
            `[DiscordEventSource] copied event refresh failed sourceSession=${sessionId}: ${String(
              error,
            )}`,
          );
        });
    }, COPIED_EVENT_SOURCE_REFRESH_DELAY_MS);
    timer.unref?.();
    this.copiedEventSourceRefreshTimers.set(key, timer);
  }

  async setDiscordChannelPaused(
    guildId: string,
    channelId: string,
    paused: boolean,
  ) {
    try {
      return await this.apiClient.updateDiscordChannelPause({
        guildId,
        channelId,
        paused,
      });
    } catch (error) {
      throw new Error(toFriendlyApiError(error));
    }
  }

  async isDiscordChannelPaused(
    guildId: string | null | undefined,
    channelId: string | null | undefined,
  ) {
    if (!guildId || !channelId) {
      return false;
    }
    try {
      const pause = await this.apiClient.getDiscordChannelPause(
        guildId,
        channelId,
      );
      return pause.paused === true;
    } catch (error) {
      const friendly = toFriendlyApiError(error);
      if (
        friendly === "Requested resource not found" ||
        friendly === "Unexpected API call"
      ) {
        return false;
      }
      console.warn(
        `Discord channel pause lookup failed guild=${guildId} channel=${channelId}: ${friendly}`,
      );
      return false;
    }
  }

  private formatResultResetNote(
    result: SessionResultResetResponse | null | undefined,
  ) {
    if (!result) {
      return "Result system reset was requested.";
    }
    const count = Number(result.matchesRemoved ?? 0);
    if (count <= 0) {
      return "Result system reset: no old match data found.";
    }
    return `Result system reset: ${count} match${count === 1 ? "" : "es"} removed.`;
  }

  async resetSessionResultSystem(
    sessionId: string,
    guild: Guild | null | undefined,
    config: SessionDiscordConfigResponse | null | undefined,
    reason: string,
    audit: DiscordActionAuditContext = {},
  ): Promise<SessionResultResetResponse> {
    const result = await this.apiClient.resetSessionResults(sessionId, {
      reason,
    });

    void this.sendDiscordActionLog(guild, config, {
      action: "Result system reset",
      actorDiscordId: audit.actorDiscordId,
      actorLabel: audit.actorLabel,
      sourceChannelId: audit.sourceChannelId,
      sessionId,
      sessionName: audit.sessionName,
      status: `${result.matchesRemoved} match${result.matchesRemoved === 1 ? "" : "es"} removed`,
      reason,
      details: this.formatResultResetNote(result),
      color: 0x38bdf8,
    }).catch((error) => {
      console.warn(
        `Discord action log failed for result reset ${sessionId}: ${String(
          error,
        )}`,
      );
    });

    return result;
  }

  private truncateLogText(value: string, maxLength: number) {
    const trimmed = value.trim();
    if (trimmed.length <= maxLength) {
      return trimmed;
    }
    return `${trimmed.slice(0, Math.max(0, maxLength - 3))}...`;
  }

  private formatLogTeam(team: DiscordActionLogParams["team"]) {
    const name = team?.name?.trim() ?? "";
    const tag = team?.tag?.trim() ?? "";
    if (name && tag) {
      return `${name} (${tag})`;
    }
    return name || tag || null;
  }

  private actorLogLabel(params: DiscordActionLogParams) {
    if (params.actorDiscordId?.trim()) {
      return this.plainDiscordUserLabel(
        params.actorDiscordId,
        params.actorLabel,
        "Discord user",
      );
    }
    return params.actorLabel?.trim() || "System";
  }

  private sanitizeDiscordReferencesForPlainText(value: string) {
    return value
      .replace(/<@!?(\d{15,25})>/g, (_match, discordUserId: string) =>
        this.plainDiscordUserLabel(discordUserId),
      )
      .replace(
        /<@&(\d{15,25})>/g,
        (_match, roleId: string) => `Discord role ${roleId}`,
      )
      .replace(
        /<#(\d{15,25})>/g,
        (_match, channelId: string) => `Discord channel ${channelId}`,
      );
  }

  private plainDiscordChannelLabel(
    channelId: string | null | undefined,
    channelName?: string | null,
  ) {
    const cleanChannelId = channelId?.trim();
    const cleanChannelName = channelName?.trim();
    if (cleanChannelName && cleanChannelId) {
      return `#${cleanChannelName} (${cleanChannelId})`;
    }
    if (cleanChannelName) {
      return `#${cleanChannelName}`;
    }
    return cleanChannelId ? `Discord channel ${cleanChannelId}` : null;
  }

  private manageCardBanControlsEnabled(
    config:
      | Partial<Pick<SessionDiscordConfigResponse, "emojis">>
      | null
      | undefined,
  ) {
    return config?.emojis?.banControlsEnabled !== "false";
  }

  private actionLogBanComponents(
    sessionId: string | null | undefined,
    team: DiscordActionLogParams["team"],
    config:
      | Partial<Pick<SessionDiscordConfigResponse, "emojis">>
      | null
      | undefined,
  ) {
    const cleanSessionId = sessionId?.trim();
    const teamId = team?.id?.trim();
    if (
      !cleanSessionId ||
      !teamId ||
      !this.manageCardBanControlsEnabled(config)
    ) {
      return [];
    }

    const temporaryId = `cardban:d:${cleanSessionId}:${teamId}`;
    const permanentId = `cardban:p:${cleanSessionId}:${teamId}`;
    if (temporaryId.length > 100 || permanentId.length > 100) {
      return [];
    }

    return [
      {
        type: 1,
        components: [
          {
            type: 2,
            style: 4,
            custom_id: temporaryId,
            label: "Ban",
          },
          {
            type: 2,
            style: 4,
            custom_id: permanentId,
            label: "Permanent Ban",
          },
        ],
      },
    ];
  }

  async sendDiscordActionLog(
    guild: Guild | null | undefined,
    config:
      | (Pick<
          SessionDiscordConfigResponse,
          "logChannelId" | "bansChannelId" | "sessionId"
        > &
          Partial<Pick<SessionDiscordConfigResponse, "emojis">>)
      | null
      | undefined,
    params: DiscordActionLogParams,
  ): Promise<void> {
    const targetChannelIds = Array.from(
      new Set(
        [config?.logChannelId?.trim() || null].filter(
          (channelId): channelId is string => Boolean(channelId),
        ),
      ),
    );
    if (!guild || targetChannelIds.length === 0) {
      return;
    }

    const fetchChannel = (
      guild as unknown as {
        channels?: {
          fetch?: (channelId: string) => Promise<unknown>;
        };
      }
    ).channels?.fetch;
    if (!fetchChannel) {
      return;
    }

    const sessionName = params.sessionName?.trim();
    const sessionId = params.sessionId?.trim() || config?.sessionId;
    const actor = this.actorLogLabel(params);
    const sourceChannelLabel = params.sourceChannelId
      ? this.plainDiscordChannelLabel(params.sourceChannelId)
      : null;
    const targetChannelLabel = params.targetChannelId
      ? this.plainDiscordChannelLabel(params.targetChannelId)
      : null;
    const fields: Array<{ name: string; value: string; inline?: boolean }> = [];
    const addField = (
      name: string,
      value: string | number | null | undefined,
      inline = true,
    ) => {
      const stringValue = this.sanitizeDiscordReferencesForPlainText(
        `${value ?? ""}`,
      ).trim();
      if (!stringValue) {
        return;
      }
      fields.push({
        name,
        value: this.truncateLogText(stringValue, 900),
        inline,
      });
    };

    addField("Actor", actor);
    addField(
      "Session",
      sessionName && sessionId
        ? `${sessionName}\n\`${sessionId}\``
        : sessionName || sessionId,
      false,
    );
    addField("Team", this.formatLogTeam(params.team));
    addField("Slot", params.slot);
    addField("Status", params.status);
    addField("Reason", params.reason, false);
    addField("Channel", sourceChannelLabel);
    addField("Target", targetChannelLabel);

    const details = Array.isArray(params.details)
      ? params.details.filter(Boolean).join("\n")
      : params.details;
    addField("Details", details, false);

    const embed = new EmbedBuilder()
      .setColor(params.color ?? 0x38bdf8)
      .setTitle(this.truncateLogText(params.action, 240))
      .setTimestamp(new Date());
    if (fields.length > 0) {
      embed.addFields(fields.slice(0, 25));
    }

    for (const channelId of targetChannelIds) {
      const channel = (await fetchChannel
        .call(guild.channels, channelId)
        .catch(() => null)) as {
        isTextBased?: () => boolean;
        isDMBased?: () => boolean;
      } | null;
      if (!channel?.isTextBased?.() || channel.isDMBased?.()) {
        continue;
      }

      await (channel as GuildTextBasedChannel)
        .send({
          embeds: [embed],
          components: this.actionLogBanComponents(
            sessionId,
            params.team,
            config,
          ),
          allowedMentions: { parse: [] },
        })
        .catch((error) => {
          console.warn(`Discord action log failed: ${String(error)}`);
        });
    }
  }

  private normalizeTag(tag: string): string {
    return tag.trim().toUpperCase().replace(/\s+/g, "");
  }

  private emoji(
    key: DiscordEmojiKey,
    config?: Pick<SessionDiscordConfigResponse, "emojis"> | null,
  ) {
    return resolveDiscordEmoji(key, config);
  }

  private isActiveMember(member: TeamMemberSummary): boolean {
    return member.leftAt === null && member.deletedAt === null;
  }

  private logTiming(label: string, startedAt: number) {
    console.log(`[DiscordSync] ${label} ${Date.now() - startedAt}ms`);
  }

  private publicRegistrationWindow(
    session: Pick<
      SessionResponse,
      "status" | "registrationOpenAt" | "registrationCloseAt"
    >,
    config?: SessionDiscordConfigResponse | null,
    now = new Date(),
  ) {
    return registrationWindowForSession(session, config, now);
  }

  private publicScheduledRegistrationWindow(
    session: Pick<
      SessionResponse,
      "status" | "registrationOpenAt" | "registrationCloseAt"
    >,
    config?: SessionDiscordConfigResponse | null,
    now = new Date(),
  ) {
    if (!this.hasWeeklyRegistrationSchedule(config)) {
      return null;
    }

    return registrationWindowForSession(
      session,
      {
        ...config,
        disableSlotAndVipRegistration: false,
        emojis: {
          ...(config?.emojis ?? {}),
          registrationManualState: "",
          registrationScheduleOverrideState: "",
        },
      } as SessionDiscordConfigResponse,
      now,
    );
  }

  private publicRegistrationAccepting(
    session: SessionResponse,
    config?: SessionDiscordConfigResponse | null,
  ) {
    return this.publicRegistrationWindow(session, config).allowsAction;
  }

  private publicScheduledWaitlistPromotionWindow(
    session: Pick<SessionResponse, "status">,
    config?: SessionDiscordConfigResponse | null,
    now = new Date(),
  ) {
    if (!this.hasWeeklyWaitlistPromotionSchedule(config)) {
      return null;
    }

    return waitlistPromotionWindowForSession(
      session,
      {
        ...config,
        emojis: {
          ...(config?.emojis ?? {}),
          waitlistPromotionManualState: "",
          waitlistPromotionScheduleOverrideState: "",
        },
      } as SessionDiscordConfigResponse,
      now,
    );
  }

  private hasWeeklyRegistrationSchedule(
    config?: SessionDiscordConfigResponse | null,
  ) {
    const value = config?.emojis?.registrationWeeklySchedule;
    return typeof value === "string" && value.trim().length > 0;
  }

  private hasWeeklyWaitlistPromotionSchedule(
    config?: SessionDiscordConfigResponse | null,
  ) {
    const value = config?.emojis?.waitlistPromotionWeeklySchedule;
    return typeof value === "string" && value.trim().length > 0;
  }

  private registrationScheduleOverrideState(
    config?: SessionDiscordConfigResponse | null,
  ) {
    const value = config?.emojis?.registrationScheduleOverrideState
      ?.trim()
      .toLowerCase();
    return value === "open" || value === "closed" ? value : null;
  }

  private waitlistPromotionScheduleOverrideState(
    config?: SessionDiscordConfigResponse | null,
  ) {
    const value = config?.emojis?.waitlistPromotionScheduleOverrideState
      ?.trim()
      .toLowerCase();
    return value === "open" || value === "closed" ? value : null;
  }

  private waitlistPromotionManualState(
    config?: SessionDiscordConfigResponse | null,
  ) {
    const value = config?.emojis?.waitlistPromotionManualState
      ?.trim()
      .toLowerCase();
    return value === "open" || value === "closed" ? value : null;
  }

  private parseConfigDate(value: string | null | undefined) {
    if (!value) {
      return null;
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private registrationScheduleOverrideChangedAt(
    session: Pick<
      SessionResponse,
      "registrationOpenAt" | "registrationCloseAt"
    >,
    config: SessionDiscordConfigResponse,
    state: "open" | "closed",
  ) {
    return (
      this.parseConfigDate(
        config.emojis?.registrationScheduleOverrideUpdatedAt,
      ) ??
      this.parseConfigDate(
        state === "closed"
          ? session.registrationCloseAt
          : session.registrationOpenAt,
      ) ??
      this.parseConfigDate(config.updatedAt)
    );
  }

  private waitlistPromotionScheduleOverrideChangedAt(
    config: SessionDiscordConfigResponse,
  ) {
    return (
      this.parseConfigDate(
        config.emojis?.waitlistPromotionScheduleOverrideUpdatedAt,
      ) ?? this.parseConfigDate(config.updatedAt)
    );
  }

  private waitlistPromotionWindow(
    session: Pick<SessionResponse, "status">,
    config?: SessionDiscordConfigResponse | null,
    now = new Date(),
  ) {
    return waitlistPromotionWindowForSession(session, config, now);
  }

  private nextAvailableNormalSlot(
    session: Pick<SessionResponse, "slotCount">,
    registrations: SessionRegistrationResponse[],
    config?: SessionDiscordConfigResponse | null,
  ) {
    const range = this.slotRangeForSession(session, config);
    if (range.endSlot < range.startSlot) {
      return null;
    }
    const occupied = new Set(
      registrations
        .filter(
          (registration) =>
            this.activeRegistrationStatus(registration) &&
            registration.slotNumber !== null &&
            registration.slotNumber >= range.startSlot &&
            registration.slotNumber <= range.endSlot,
        )
        .map((registration) => registration.slotNumber),
    );
    for (let slot = range.startSlot; slot <= range.endSlot; slot += 1) {
      if (!occupied.has(slot)) {
        return slot;
      }
    }
    return null;
  }

  private waitlistPromotionAccepting(
    session: Pick<SessionResponse, "status" | "slotCount">,
    config: SessionDiscordConfigResponse | null | undefined,
    registrations: SessionRegistrationResponse[],
  ) {
    return (
      this.waitlistPromotionWindow(session, config).allowsAction &&
      this.nextAvailableNormalSlot(session, registrations, config) !== null
    );
  }

  private syncQueueKey(guild: Guild, sessionId: string) {
    return `${guild.id}:${sessionId}`;
  }

  private scheduleQueuedDiscordSync(key: string, sync: QueuedDiscordSync) {
    if (sync.timer) {
      clearTimeout(sync.timer);
    }

    sync.timer = setTimeout(() => {
      sync.timer = null;
      void this.runQueuedDiscordSync(key);
    }, sync.delayMs);
    sync.timer.unref?.();
  }

  private queueDiscordScrimSync(
    guild: Guild | null | undefined,
    sessionId: string,
    opts: QueuedDiscordSyncOptions = {},
  ) {
    if (!guild) {
      return;
    }

    const key = this.syncQueueKey(guild, sessionId);
    const now = Date.now();
    const delayMs = Math.max(0, opts.delayMs ?? BACKGROUND_SYNC_DELAY_MS);
    let sync = this.queuedDiscordSyncs.get(key);
    if (!sync) {
      sync = {
        guild,
        sessionId,
        organizationId: opts.organizationId?.trim() || null,
        removedTeamIds: new Set<string>(),
        activeTeamIds: new Set<string>(),
        extraDiscordUserIds: new Set<string>(),
        cleanupTeamIds: new Set<string>(),
        fastMessageRefresh: opts.fastMessageRefresh === true,
        requiresFullSync: opts.skipFullSync !== true,
        pending: false,
        running: false,
        timer: null,
        delayMs,
        firstQueuedAt: now,
        latestQueuedAt: now,
        retryAttempt: 0,
      };
      this.queuedDiscordSyncs.set(key, sync);
    }

    sync.guild = guild;
    sync.delayMs = delayMs;
    if (opts.organizationId !== undefined) {
      sync.organizationId = opts.organizationId?.trim() || null;
    }
    sync.pending = true;
    sync.latestQueuedAt = now;
    for (const teamId of opts.removedTeamIds ?? []) {
      sync.removedTeamIds.add(teamId);
    }
    for (const teamId of opts.activeTeamIds ?? []) {
      sync.activeTeamIds.add(teamId);
    }
    for (const discordUserId of opts.extraDiscordUserIds ?? []) {
      const cleanDiscordUserId = discordUserId?.trim();
      if (cleanDiscordUserId) {
        sync.extraDiscordUserIds.add(cleanDiscordUserId);
      }
    }
    for (const teamId of opts.cleanupTeamIds ?? []) {
      sync.cleanupTeamIds.add(teamId);
    }
    sync.fastMessageRefresh =
      sync.fastMessageRefresh || opts.fastMessageRefresh === true;
    if (opts.skipFullSync !== true) {
      sync.requiresFullSync = true;
    }

    this.scheduleQueuedDiscordSync(key, sync);
  }

  private isRetryableDiscordSyncError(error: unknown) {
    const message =
      error instanceof Error
        ? `${error.name}: ${error.message}`
        : String(error);
    return /ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|fetch failed|socket hang up|502|503|504/i.test(
      message,
    );
  }

  private async runQueuedDiscordSync(key: string) {
    const sync = this.queuedDiscordSyncs.get(key);
    if (!sync) {
      return;
    }

    if (sync.running) {
      this.scheduleQueuedDiscordSync(key, sync);
      return;
    }

    sync.running = true;
    sync.pending = false;
    const removedTeamIds = [...sync.removedTeamIds];
    const activeTeamIds = [...sync.activeTeamIds];
    const extraDiscordUserIds = [...sync.extraDiscordUserIds];
    const cleanupTeamIds = [...sync.cleanupTeamIds];
    const fastMessageRefresh = sync.fastMessageRefresh;
    const requiresFullSync = sync.requiresFullSync;
    sync.removedTeamIds.clear();
    sync.activeTeamIds.clear();
    sync.extraDiscordUserIds.clear();
    sync.cleanupTeamIds.clear();
    sync.fastMessageRefresh = false;
    sync.requiresFullSync = false;
    const queuedForMs = Date.now() - sync.firstQueuedAt;
    const startedAt = Date.now();
    console.log(
      `[DiscordSync] queued run start session=${sync.sessionId} guild=${sync.guild.id} removed=${removedTeamIds.length} active=${activeTeamIds.length} cleanup=${cleanupTeamIds.length} fast=${fastMessageRefresh ? "yes" : "no"} full=${requiresFullSync ? "yes" : "no"} queuedFor=${queuedForMs}ms`,
    );

    try {
      const runSync = async () => {
        const fastUpdated = fastMessageRefresh
          ? await this.syncVisibleDiscordMessagesFast(
              sync.guild,
              sync.sessionId,
            )
          : false;
        if (requiresFullSync || (fastMessageRefresh && !fastUpdated)) {
          await this.syncDiscordScrimState(sync.guild, sync.sessionId, {
            removedTeamIds,
          });
        } else if (removedTeamIds.length > 0 || activeTeamIds.length > 0) {
          const rolesUpdated = await this.syncAffectedTeamAccessRoles(
            sync.guild,
            sync.sessionId,
            {
              removedTeamIds,
              activeTeamIds,
              extraDiscordUserIds,
            },
          );
          if (!rolesUpdated) {
            await this.syncDiscordScrimState(sync.guild, sync.sessionId, {
              removedTeamIds,
            });
          }
        }
        if (removedTeamIds.length > 0) {
          await this.restoreActiveBanRolesForRemovedTeams(
            sync.guild,
            sync.sessionId,
            removedTeamIds,
          );
        }
        await this.cleanupDiscordTeamsForSession(
          sync.sessionId,
          cleanupTeamIds,
        );
      };
      if (sync.organizationId) {
        await this.withOrganization(sync.organizationId, runSync);
      } else {
        await runSync();
      }
      sync.retryAttempt = 0;
      this.logTiming(`queued run done session=${sync.sessionId}`, startedAt);
    } catch (error) {
      if (
        this.isRetryableDiscordSyncError(error) &&
        sync.retryAttempt < QUEUED_SYNC_MAX_RETRIES
      ) {
        sync.retryAttempt += 1;
        for (const teamId of removedTeamIds) {
          sync.removedTeamIds.add(teamId);
        }
        for (const teamId of activeTeamIds) {
          sync.activeTeamIds.add(teamId);
        }
        for (const discordUserId of extraDiscordUserIds) {
          sync.extraDiscordUserIds.add(discordUserId);
        }
        for (const teamId of cleanupTeamIds) {
          sync.cleanupTeamIds.add(teamId);
        }
        sync.fastMessageRefresh = sync.fastMessageRefresh || fastMessageRefresh;
        sync.requiresFullSync = sync.requiresFullSync || requiresFullSync;
        sync.pending = true;
        sync.delayMs = Math.min(
          QUEUED_SYNC_RETRY_MAX_MS,
          QUEUED_SYNC_RETRY_BASE_MS * 2 ** (sync.retryAttempt - 1),
        );
        sync.firstQueuedAt = Date.now();
        console.warn(
          `Discord scrim sync failed for ${sync.sessionId}; retry ${sync.retryAttempt}/${QUEUED_SYNC_MAX_RETRIES} in ${sync.delayMs}ms: ${String(error)}`,
        );
      } else {
        sync.retryAttempt = 0;
        console.warn(
          `Discord scrim sync failed for ${sync.sessionId}: ${String(error)}`,
        );
      }
    } finally {
      sync.running = false;
      if (
        sync.pending ||
        sync.removedTeamIds.size > 0 ||
        sync.activeTeamIds.size > 0 ||
        sync.extraDiscordUserIds.size > 0 ||
        sync.fastMessageRefresh ||
        sync.requiresFullSync ||
        sync.cleanupTeamIds.size > 0
      ) {
        sync.firstQueuedAt = Date.now();
        this.scheduleQueuedDiscordSync(key, sync);
      } else {
        this.queuedDiscordSyncs.delete(key);
      }
    }
  }

  private async runLimited<T>(
    items: T[],
    concurrency: number,
    worker: (item: T) => Promise<void>,
  ) {
    let index = 0;
    const workerCount = Math.min(concurrency, items.length);
    await Promise.all(
      Array.from({ length: workerCount }, async () => {
        while (index < items.length) {
          const item = items[index];
          index += 1;
          await worker(item);
        }
      }),
    );
  }

  private async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    fallback: T,
  ): Promise<T> {
    let timer: NodeJS.Timeout | null = null;
    try {
      return await Promise.race([
        promise.catch(() => fallback),
        new Promise<T>((resolve) => {
          timer = setTimeout(() => resolve(fallback), timeoutMs);
        }),
      ]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  private async cleanupDiscordTeams(
    teamIds: string[],
  ): Promise<Map<string, number>> {
    const releasedByTeamId = new Map<string, number>();
    const uniqueTeamIds = [
      ...new Set(teamIds.filter((teamId) => teamId.trim())),
    ];
    await this.runLimited(
      uniqueTeamIds,
      ROLE_SYNC_CONCURRENCY,
      async (teamId) => {
        try {
          const cleanup = await this.apiClient.cleanupDiscordTeam(teamId);
          releasedByTeamId.set(teamId, cleanup.releasedMembers);
        } catch (error) {
          releasedByTeamId.set(teamId, 0);
          console.warn(
            `Discord team cleanup failed for ${teamId}: ${String(error)}`,
          );
        }
      },
    );
    return releasedByTeamId;
  }

  private async cleanupDiscordTeamsForSession(
    sessionId: string,
    teamIds: string[],
  ): Promise<Map<string, number>> {
    const uniqueTeamIds = [
      ...new Set(teamIds.filter((teamId) => teamId.trim())),
    ];
    if (uniqueTeamIds.length === 0) {
      return new Map();
    }

    const registrations = await this.apiClient
      .listRegistrations(sessionId)
      .catch((error) => {
        console.warn(
          `Discord team cleanup active registration check failed for ${sessionId}: ${String(
            error,
          )}`,
        );
        return null;
      });
    if (!registrations) {
      return this.cleanupDiscordTeams(uniqueTeamIds);
    }

    const activeTeamIds = new Set(
      registrations
        .filter((registration) => this.activeRegistrationStatus(registration))
        .map((registration) => registration.teamId),
    );
    const inactiveTeamIds = uniqueTeamIds.filter(
      (teamId) => !activeTeamIds.has(teamId),
    );
    return this.cleanupDiscordTeams(inactiveTeamIds);
  }

  private async syncRemovedTeamsThenCleanup(
    guild: Guild | null | undefined,
    sessionId: string,
    teamIds: string[],
    extraDiscordUserIds: string[] = [],
  ): Promise<Map<string, number>> {
    if (guild) {
      await this.syncDiscordScrimState(guild, sessionId, {
        removedTeamIds: teamIds,
      });
      if (extraDiscordUserIds.length > 0) {
        await this.syncAffectedTeamAccessRoles(guild, sessionId, {
          removedTeamIds: teamIds,
          extraDiscordUserIds,
        });
      }
      this.reconcileScrimRolesInBackground(guild, sessionId);
    }
    return this.cleanupDiscordTeamsForSession(sessionId, teamIds);
  }

  private reasonLabel(reason?: string): string | null {
    switch (reason) {
      case "TEAM_TAG_NOT_FOUND":
        return "team tag not found";
      case "TEAM_NOT_ASSIGNED_TO_MATCH":
        return "team not assigned to match";
      case "MULTIPLE_TEAMS_FOR_TAG":
        return "multiple teams matched this tag";
      case "MULTIPLE_TEAMS_FOR_SCREENSHOT_ROW":
        return "multiple teams matched this row";
      case "TEAM_EVIDENCE_NOT_MATCHED":
        return "team evidence did not match slots";
      case "BASIC_OCR_MANUAL_REVIEW":
        return "manual review required";
      case "MATCH_SLOT_NOT_FOUND":
        return "match slot not found";
      case "MATCH_SLOT_HAS_NO_TEAM":
        return "match slot has no team";
      default:
        return null;
    }
  }

  private resolveTeamLabel(
    registration: Pick<SessionRegistrationResponse, "team" | "teamId">,
  ): string {
    return (
      registration.team?.tag?.trim() ||
      registration.team?.name?.trim() ||
      registration.teamId ||
      "UNKNOWN"
    );
  }

  private formatTeamSlotRow(
    registration: Pick<SessionRegistrationResponse, "team" | "teamId">,
    managerMention?: string | null,
  ) {
    const tag = registration.team?.tag?.trim() || "NO TAG";
    const name =
      registration.team?.name?.trim() || registration.teamId || "Unknown Team";
    const manager = managerMention?.trim();
    return `[${tag}] ${name}${manager ? ` ${manager}` : ""}`;
  }

  private sortBySlotOrWaitlist(
    registrations: SessionRegistrationResponse[],
  ): SessionRegistrationResponse[] {
    return registrations.slice().sort((left, right) => {
      const leftSlot = left.slotNumber ?? Number.MAX_SAFE_INTEGER;
      const rightSlot = right.slotNumber ?? Number.MAX_SAFE_INTEGER;
      if (leftSlot !== rightSlot) {
        return leftSlot - rightSlot;
      }

      const leftWait = left.waitlistPosition ?? Number.MAX_SAFE_INTEGER;
      const rightWait = right.waitlistPosition ?? Number.MAX_SAFE_INTEGER;
      if (leftWait !== rightWait) {
        return leftWait - rightWait;
      }

      return left.id.localeCompare(right.id);
    });
  }

  private slotRangeForSession(
    session: Pick<SessionResponse, "slotCount">,
    config?: SessionDiscordConfigResponse | null,
  ) {
    const startSlot =
      config?.enabled === false
        ? SLOT_LIST_START
        : Math.max(SLOT_LIST_START, config?.startSlot ?? SLOT_LIST_START);
    const normalSlots =
      config?.enabled === false
        ? session.slotCount - startSlot + 1
        : Math.max(0, config?.normalSlots ?? session.slotCount - startSlot + 1);

    return {
      startSlot,
      endSlot: Math.min(session.slotCount, startSlot + normalSlots - 1),
    };
  }

  private vipRangeForSession(
    session: Pick<SessionResponse, "slotCount">,
    config: SessionDiscordConfigResponse | null | undefined,
    normalRange = this.slotRangeForSession(session, config),
  ) {
    const vipSlots =
      config?.enabled === false ? 0 : Math.max(0, config?.vipSlots ?? 0);
    const startSlot = normalRange.endSlot + 1;
    const endSlot = Math.min(session.slotCount, startSlot + vipSlots - 1);
    return {
      startSlot,
      endSlot,
      capacity: endSlot >= startSlot ? endSlot - startSlot + 1 : 0,
    };
  }

  private formatPlacementLabel(
    session: Pick<SessionResponse, "slotCount">,
    registration: SessionRegistrationResponse,
    config?: SessionDiscordConfigResponse | null,
  ) {
    if (
      registration.status === "WAITLIST" &&
      registration.waitlistPosition !== null
    ) {
      return `waitlist #${registration.waitlistPosition}`;
    }

    if (registration.slotNumber !== null) {
      const normalRange = this.slotRangeForSession(session, config);
      const vipRange = this.vipRangeForSession(session, config, normalRange);
      if (
        registration.slotNumber >= vipRange.startSlot &&
        registration.slotNumber <= vipRange.endSlot
      ) {
        return `VIP #${registration.slotNumber - vipRange.startSlot + 1}`;
      }
      return `slot #${registration.slotNumber}`;
    }

    return registration.status.toLowerCase();
  }

  private formatPlacementConfirmation(
    session: Pick<SessionResponse, "slotCount">,
    registration: SessionRegistrationResponse,
    config?: SessionDiscordConfigResponse | null,
  ) {
    if (confirmationDisplayMode(config) === "emoji") {
      if (
        registration.status === "WAITLIST" &&
        registration.waitlistPosition !== null
      ) {
        return this.emoji("waitlist", config);
      }

      if (registration.slotNumber !== null) {
        const normalRange = this.slotRangeForSession(session, config);
        const vipRange = this.vipRangeForSession(session, config, normalRange);
        if (
          registration.slotNumber >= vipRange.startSlot &&
          registration.slotNumber <= vipRange.endSlot
        ) {
          return this.emoji("vip", config);
        }
        return this.emoji("check", config);
      }

      return this.emoji("check", config);
    }

    if (
      registration.status === "WAITLIST" &&
      registration.waitlistPosition !== null
    ) {
      return `Waitlist ${registration.waitlistPosition}`;
    }

    if (registration.slotNumber !== null) {
      const normalRange = this.slotRangeForSession(session, config);
      const vipRange = this.vipRangeForSession(session, config, normalRange);
      if (
        registration.slotNumber >= vipRange.startSlot &&
        registration.slotNumber <= vipRange.endSlot
      ) {
        return `VIP ${registration.slotNumber - vipRange.startSlot + 1}`;
      }
      return `Slot ${registration.slotNumber}`;
    }

    return registration.status === "CONFIRMED"
      ? "Approved"
      : registration.status;
  }

  private formatRemovalConfirmation(
    config?: Pick<SessionDiscordConfigResponse, "emojis"> | null,
  ) {
    return confirmationDisplayMode(config) === "emoji"
      ? this.emoji("reject", config)
      : "Removed";
  }

  private syncDiscordScrimStateInBackground(
    guild: Guild | null | undefined,
    sessionId: string,
    opts: QueuedDiscordSyncOptions = {},
  ) {
    this.queueDiscordScrimSync(guild, sessionId, opts);
  }

  queueVisibleDiscordScrimRefresh(
    guild: Guild | null | undefined,
    sessionId: string,
    config?: Pick<SessionDiscordConfigResponse, "organizationId"> | null,
  ) {
    this.syncDiscordScrimStateInBackground(guild, sessionId, {
      organizationId: config?.organizationId,
      fastMessageRefresh: true,
      skipFullSync: true,
      delayMs: 0,
    });
  }

  async buildWaitlistControlPanel(sessionId: string, page = 0) {
    const [session, registrations, config] = await Promise.all([
      this.apiClient.getSession(sessionId),
      this.apiClient.listRegistrations(sessionId),
      this.apiClient.getSessionDiscordConfig(sessionId),
    ]);
    return this.scrimDiscordSetup.buildWaitlistControlPanelPayload(
      session,
      registrations,
      config,
      page,
    );
  }

  async describeRegistrationControlTarget(
    sessionId: string,
    registrationId: string,
  ): Promise<{ found: boolean; content: string }> {
    const [session, registrations, config] = await Promise.all([
      this.apiClient.getSession(sessionId),
      this.apiClient.listRegistrations(sessionId),
      this.apiClient.getSessionDiscordConfig(sessionId).catch(() => null),
    ]);
    const registration = registrations.find(
      (item) => item.id === registrationId,
    );
    if (!registration) {
      return {
        found: false,
        content: `${this.emoji("warning", config)} This waitlist registration is no longer available. The panel will refresh on the next sync.`,
      };
    }

    const tag = registration.team?.tag?.trim();
    const teamName =
      registration.team?.name?.trim() || registration.teamId || "Unknown Team";
    const lines = [
      `${this.emoji("team", config)} Selected registration`,
      `Team: ${tag ? `[${tag}] ` : ""}${teamName}`,
      `Placement: ${this.formatPlacementLabel(session, registration, config)}`,
      `Logo: ${registration.team?.logoUrl ? "saved" : "not provided"}`,
      "",
      "Choose an action below.",
    ];
    return { found: true, content: lines.join("\n") };
  }

  private syncDiscordScrimMessagesInBackground(
    guild: Guild | null | undefined,
    sessionId: string,
  ) {
    if (!guild) {
      return;
    }
    void this.syncDiscordScrimMessages(guild, sessionId).catch((error) => {
      console.warn(
        `Discord scrim message refresh failed for ${sessionId}: ${String(error)}`,
      );
    });
  }

  private formatPreviewEntry(entry: ScreenshotPreviewEntry): string {
    const slot = entry.slotNumber ? ` (slot ${entry.slotNumber})` : "";
    return `${entry.position}. ${entry.tag}${slot} ${EM_DASH} ${entry.kills} kills`;
  }

  private resultSummaryCount(
    config?: Pick<SessionDiscordConfigResponse, "emojis"> | null,
  ) {
    const raw = config?.emojis?.resultSummaryCount?.trim() ?? "";
    const parsed = Number(raw);
    if (!Number.isInteger(parsed)) {
      return 3;
    }
    return Math.max(0, Math.min(20, parsed));
  }

  private resultSummaryTitle(
    config?: Pick<SessionDiscordConfigResponse, "emojis"> | null,
  ) {
    const template =
      config?.emojis?.resultSummaryTitle?.trim() || "{trophy} Match Results";
    return this.renderResultSummaryTemplate(template, {
      rank: "",
      position: "",
      teamName: "",
      tag: "",
      kills: "",
      placementPoints: "",
      points: "",
      totalPoints: "",
      trophy: this.emoji("trophy", config),
      fire: this.emoji("fire", config),
      chart: this.emoji("chart", config),
    }).trim();
  }

  private resultSummaryRowTemplate(
    config?: Pick<SessionDiscordConfigResponse, "emojis"> | null,
  ) {
    const configured = config?.emojis?.resultSummaryRowTemplate?.trim() ?? "";
    if (!configured) {
      return DEFAULT_RESULT_SUMMARY_ROW_TEMPLATE;
    }
    const normalized = configured.replace(/\s+/g, " ").trim();
    return LEGACY_RESULT_SUMMARY_ROW_TEMPLATES.has(normalized)
      ? DEFAULT_RESULT_SUMMARY_ROW_TEMPLATE
      : configured;
  }

  private renderResultSummaryTemplate(
    template: string,
    values: Record<string, string>,
  ) {
    return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key: string) =>
      Object.prototype.hasOwnProperty.call(values, key) ? values[key] : match,
    );
  }

  private formatResultSummaryEntry(
    entry: ResultSummaryEntry,
    rank: number,
    config?: Pick<SessionDiscordConfigResponse, "emojis"> | null,
  ) {
    const teamName = entry.teamName?.trim() || entry.tag;
    const totalPoints =
      typeof entry.totalPoints === "number" &&
      Number.isFinite(entry.totalPoints)
        ? Math.max(0, Math.trunc(entry.totalPoints))
        : Math.max(0, Math.trunc(entry.kills));
    const placementPoints =
      typeof entry.placementPoints === "number" &&
      Number.isFinite(entry.placementPoints)
        ? Math.max(0, Math.trunc(entry.placementPoints))
        : Math.max(0, totalPoints - Math.max(0, Math.trunc(entry.kills)));
    return this.renderResultSummaryTemplate(
      this.resultSummaryRowTemplate(config),
      {
        rank: String(rank),
        position: String(entry.position),
        teamName,
        tag: entry.tag,
        kills: String(entry.kills),
        placementPoints: String(placementPoints),
        points: String(totalPoints),
        totalPoints: String(totalPoints),
        trophy: this.emoji("trophy", config),
        fire: this.emoji("fire", config),
        chart: this.emoji("chart", config),
      },
    ).trim();
  }

  private formatIssueEntry(entry: ScreenshotPreviewEntry): string {
    const reason = this.reasonLabel(entry.reason);
    return reason ? `- ${entry.tag} (${reason})` : `- ${entry.tag}`;
  }

  private formatPreview(
    preview: ScreenshotPreviewResponse,
    opts: {
      title?: string;
      includeInstruction?: boolean;
      config?: Pick<SessionDiscordConfigResponse, "emojis"> | null;
    } = {},
  ): string {
    const check = this.emoji("check", opts.config);
    const reject = this.emoji("reject", opts.config);
    const warning = this.emoji("warning", opts.config);
    if (!preview.preview.length) {
      return `${reject} No usable result rows detected from screenshot`;
    }

    const lines = [
      opts.title ?? `${this.emoji("camera", opts.config)} RESULT PREVIEW`,
      "",
    ];
    if (preview.ocrMode === "BASIC") {
      lines.push("Mode: basic OCR, review before applying.", "");
    } else if (preview.ocrMode === "MANUAL") {
      lines.push("Mode: no-AI manual review, edit rows before applying.", "");
    }

    if (preview.resolved.length > 0) {
      lines.push(`${check} Resolved`);
      lines.push(
        ...preview.resolved.map((entry) => this.formatPreviewEntry(entry)),
      );
    }

    if (preview.unresolved.length > 0) {
      if (lines[lines.length - 1] !== "") {
        lines.push("");
      }
      lines.push(`${reject} Unresolved`);
      lines.push(
        ...preview.unresolved.map((entry) => this.formatIssueEntry(entry)),
      );
    }

    if (preview.ambiguous.length > 0) {
      if (lines[lines.length - 1] !== "") {
        lines.push("");
      }
      lines.push(`${warning} Ambiguous`);
      lines.push(
        ...preview.ambiguous.map((entry) => this.formatIssueEntry(entry)),
      );
    }

    if (opts.includeInstruction !== false) {
      lines.push(
        "",
        "Use /apply-results to confirm once preview looks correct.",
      );
    }

    return lines.join("\n");
  }

  private formatSlotMapEntry(entry: SlotMapPreviewEntry): string {
    const tag = entry.tag ? ` ${entry.tag}` : "";
    const players = entry.playerNames.length
      ? ` ${EM_DASH} ${entry.playerNames.slice(0, 4).join(", ")}`
      : "";
    return `- Slot ${entry.slotNumber}${tag}${players}`;
  }

  private formatSlotMapIssue(entry: SlotMapPreviewEntry): string {
    const reason = this.reasonLabel(entry.reason);
    const tag = entry.tag ? ` ${entry.tag}` : "";
    return reason
      ? `- Slot ${entry.slotNumber}${tag} (${reason})`
      : `- Slot ${entry.slotNumber}${tag}`;
  }

  private formatSlotMapPreview(preview: SlotMapPreviewResponse): string {
    const lines = [`${this.emoji("camera")} SLOT MAP PREVIEW`, ""];
    if (preview.ocrMode === "BASIC") {
      lines.push("Mode: basic OCR, review mappings before using them.", "");
    }

    if (preview.mapped.length > 0) {
      lines.push(`${this.emoji("check")} Saved mappings`);
      lines.push(
        ...preview.mapped.map((entry) => this.formatSlotMapEntry(entry)),
      );
    }

    if (preview.unresolved.length > 0) {
      if (lines[lines.length - 1] !== "") {
        lines.push("");
      }
      lines.push(`${this.emoji("reject")} Unresolved`);
      lines.push(
        ...preview.unresolved.map((entry) => this.formatSlotMapIssue(entry)),
      );
    }

    if (preview.ambiguous.length > 0) {
      if (lines[lines.length - 1] !== "") {
        lines.push("");
      }
      lines.push(`${this.emoji("warning")} Ambiguous`);
      lines.push(
        ...preview.ambiguous.map((entry) => this.formatSlotMapIssue(entry)),
      );
    }

    if (
      !preview.mapped.length &&
      !preview.unresolved.length &&
      !preview.ambiguous.length
    ) {
      lines.push(`${this.emoji("reject")} No usable slot mappings detected`);
    }

    lines.push(
      "",
      "Send all slot/player screenshots before previewing final results.",
    );
    return lines.join("\n");
  }

  private buildApplyPayload(
    preview: ScreenshotPreviewResponse,
  ): ApplyScreenshotResultsPayload {
    return {
      matchId: preview.matchId,
      results: preview.preview.map((entry) => ({
        position: entry.position,
        tag: entry.tag,
        kills: entry.kills,
        players: entry.players ?? [],
        playerNames: entry.playerNames ?? [],
        ocrTag: entry.ocrTag ?? entry.tag,
        ocrPlayerNames: entry.playerNames ?? [],
        teamId: entry.teamId,
        slotId: entry.slotId,
        status: entry.status,
      })),
    };
  }

  private buildReviewedApplyPayload(
    matchId: string,
    rows: ReviewedResultRow[],
    opts: { markMissingSlotsNoShow?: boolean } = {},
  ): ApplyScreenshotResultsPayload {
    return {
      matchId,
      ...(opts.markMissingSlotsNoShow ? { markMissingSlotsNoShow: true } : {}),
      results: rows
        .filter((entry) => entry.include)
        .map((entry) => ({
          position: entry.position,
          tag: entry.tag,
          kills: entry.kills,
          players: entry.players ?? [],
          playerNames: entry.playerNames ?? [],
          ocrTag: entry.ocrTag ?? entry.tag,
          ocrPlayerNames: entry.ocrPlayerNames ?? entry.playerNames ?? [],
          edited: entry.edited ?? false,
          teamId: entry.teamId,
          slotId: entry.slotId,
          status: entry.status,
        })),
    };
  }

  private topResultLines(
    preview: ScreenshotPreviewResponse,
    config?: Pick<SessionDiscordConfigResponse, "emojis"> | null,
  ): string[] {
    return this.resultSummaryLines(preview.resolved, config);
  }

  private resultSummaryLines(
    entries: ResultSummaryEntry[],
    config?: Pick<SessionDiscordConfigResponse, "emojis"> | null,
  ): string[] {
    const limit = this.resultSummaryCount(config);
    if (limit <= 0) {
      return [];
    }
    return entries
      .slice()
      .sort((left, right) => left.position - right.position)
      .slice(0, limit)
      .map((entry, index) =>
        this.formatResultSummaryEntry(entry, index + 1, config),
      );
  }

  private finalResultWinnerCount(
    config?: Pick<SessionDiscordConfigResponse, "emojis"> | null,
  ) {
    const raw = config?.emojis?.finalResultWinnerCount?.trim() ?? "";
    const parsed = Number(raw);
    if (!Number.isInteger(parsed)) {
      return 3;
    }
    return Math.max(0, Math.min(20, parsed));
  }

  private finalResultMessageTemplate(
    config?: Pick<SessionDiscordConfigResponse, "emojis"> | null,
  ) {
    return this.finalResultTemplate(
      config?.emojis?.finalResultMessageTemplate,
      DEFAULT_FINAL_RESULT_MESSAGE_TEMPLATE,
      LEGACY_FINAL_RESULT_MESSAGE_TEMPLATES,
    );
  }

  private finalResultWinnerRowTemplate(
    config?: Pick<SessionDiscordConfigResponse, "emojis"> | null,
  ) {
    return this.finalResultTemplate(
      config?.emojis?.finalResultWinnerRowTemplate,
      DEFAULT_FINAL_RESULT_WINNER_ROW_TEMPLATE,
      LEGACY_FINAL_RESULT_WINNER_ROW_TEMPLATES,
    );
  }

  private finalResultPostTemplate(
    config?: Pick<SessionDiscordConfigResponse, "emojis"> | null,
  ) {
    return this.finalResultTemplate(
      config?.emojis?.finalResultPostTemplate,
      DEFAULT_FINAL_RESULT_POST_TEMPLATE,
      new Set(),
    );
  }

  private finalResultTemplate(
    configured: string | null | undefined,
    fallback: string,
    legacyTemplates: Set<string>,
  ) {
    const normalized = configured
      ? normalizeFinalResultTemplate(configured)
      : "";
    if (!normalized || legacyTemplates.has(normalized)) {
      return fallback;
    }
    return normalized;
  }

  private finalWinnerTitle(rank: number) {
    if (rank === 1) return "Champions";
    if (rank === 2) return "1st Runner-up";
    if (rank === 3) return "2nd Runner-up";
    return `${rank}th Place`;
  }

  private finalResultRankEmojiMap(
    config?: Pick<SessionDiscordConfigResponse, "emojis"> | null,
  ) {
    const raw = config?.emojis?.finalResultRankEmojis?.trim() ?? "";
    const emojis = new Map<number, string>();
    if (!raw) {
      return emojis;
    }

    let nextRank = 1;
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("//")) {
        continue;
      }

      const explicit = trimmed.match(
        /^(?:rank\s*)?#?\s*(\d{1,2})\s*(?:[=:|\-]\s*|\s+)(.+)$/i,
      );
      const rank = explicit
        ? Math.max(1, Math.trunc(Number(explicit[1])))
        : nextRank;
      const emoji = (explicit ? explicit[2] : trimmed).trim();
      if (rank >= 1 && rank <= 20 && emoji) {
        emojis.set(rank, emoji);
      }
      nextRank = Math.min(21, rank + 1);
    }

    return emojis;
  }

  private finalWinnerEmoji(
    rank: number,
    config?: Pick<SessionDiscordConfigResponse, "emojis"> | null,
  ) {
    const customEmoji = this.finalResultRankEmojiMap(config).get(rank);
    if (customEmoji) {
      return customEmoji;
    }
    if (rank === 1) return this.emoji("trophy", config);
    if (rank === 2) return FINAL_RESULT_SECOND_PLACE_EMOJI;
    if (rank === 3) return FINAL_RESULT_THIRD_PLACE_EMOJI;
    return this.emoji("chart", config);
  }

  private finalStandingTeamLabel(team: FinalStandingEntry | null | undefined) {
    if (!team) {
      return "No winner available";
    }
    return team.teamName?.trim() || team.tag?.trim() || team.teamId;
  }

  private finalBackupTeamLabel(team: FinalBackupEntry | null | undefined) {
    if (!team) {
      return "No winner available";
    }
    return team.teamName?.trim() || team.teamTag?.trim() || team.teamId || "";
  }

  private formatFinalWinnerEntry(
    team: FinalStandingEntry,
    config?: Pick<SessionDiscordConfigResponse, "emojis"> | null,
  ) {
    const rank = Math.max(1, Math.trunc(team.rank));
    const points = Math.max(0, Math.trunc(team.totalPoints));
    const kills = Math.max(0, Math.trunc(team.totalKills));
    const teamName = this.finalStandingTeamLabel(team);
    const teamTag = team.tag?.trim() || teamName;
    const rankEmoji = this.finalWinnerEmoji(rank, config);
    return this.renderResultSummaryTemplate(
      this.finalResultWinnerRowTemplate(config),
      {
        rank: String(rank),
        teamName,
        teamTag,
        tag: teamTag,
        winnerTitle: this.finalWinnerTitle(rank),
        winnerEmoji: rankEmoji,
        rankEmoji,
        points: String(points),
        totalPoints: String(points),
        kills: String(kills),
        totalKills: String(kills),
        placementPoints: String(
          Math.max(0, Math.trunc(team.placementPoints ?? 0)),
        ),
        wwcd: String(Math.max(0, Math.trunc(team.wwcd ?? 0))),
        matchesPlayed: String(Math.max(0, Math.trunc(team.matchesPlayed))),
        trophy: this.emoji("trophy", config),
        fire: this.emoji("fire", config),
        chart: this.emoji("chart", config),
      },
    ).trim();
  }

  private formatFinalBackupWinnerEntry(
    team: FinalBackupEntry,
    config?: Pick<SessionDiscordConfigResponse, "emojis"> | null,
  ) {
    const rank = Math.max(1, Math.trunc(team.rank));
    const points = Math.max(0, Math.trunc(team.totalPoints));
    const kills = Math.max(0, Math.trunc(team.kills));
    const teamName = this.finalBackupTeamLabel(team);
    const teamTag = team.teamTag?.trim() || teamName;
    const rankEmoji = this.finalWinnerEmoji(rank, config);
    return this.renderResultSummaryTemplate(
      this.finalResultWinnerRowTemplate(config),
      {
        rank: String(rank),
        teamName,
        teamTag,
        tag: teamTag,
        winnerTitle: this.finalWinnerTitle(rank),
        winnerEmoji: rankEmoji,
        rankEmoji,
        points: String(points),
        totalPoints: String(points),
        kills: String(kills),
        totalKills: String(kills),
        placementPoints: String(
          Math.max(0, Math.trunc(team.placementPoints ?? 0)),
        ),
        wwcd: String(Math.max(0, Math.trunc(team.wwcd ?? 0))),
        matchesPlayed: "",
        trophy: this.emoji("trophy", config),
        fire: this.emoji("fire", config),
        chart: this.emoji("chart", config),
      },
    ).trim();
  }

  private async finalResultPublicContent(
    matchId: string,
    config?:
      | (Pick<SessionDiscordConfigResponse, "emojis"> &
          Partial<Pick<SessionDiscordConfigResponse, "sessionId">>)
      | null,
  ) {
    const sessionId = config?.sessionId?.trim() || null;
    const standings = sessionId
      ? await this.apiClient.getSessionStandings(sessionId).catch((error) => {
          console.warn(
            `Final result standings lookup failed session=${sessionId}: ${toFriendlyApiError(
              error,
            )}`,
          );
          return null;
        })
      : null;
    const winnerCount = this.finalResultWinnerCount(config);
    const winners = (standings?.teams ?? []).slice(0, winnerCount);
    const winner = winners[0] ?? null;
    const winnerRows = winners
      .map((team) => this.formatFinalWinnerEntry(team, config))
      .filter(Boolean);
    const winnersText = winnerRows.length
      ? winnerRows.join("\n")
      : "No standings available yet.";
    const winnerName = this.finalStandingTeamLabel(winner);
    const winnerTag = winner?.tag?.trim() || winnerName;
    const winnerRank =
      winner && Number.isFinite(winner.rank)
        ? String(Math.max(1, Math.trunc(winner.rank)))
        : "";
    const winnerPoints =
      winner && Number.isFinite(winner.totalPoints)
        ? String(Math.max(0, Math.trunc(winner.totalPoints)))
        : "0";
    const winnerKills =
      winner && Number.isFinite(winner.totalKills)
        ? String(Math.max(0, Math.trunc(winner.totalKills)))
        : "0";
    const winnerPlacementPoints =
      winner && Number.isFinite(winner.placementPoints)
        ? String(Math.max(0, Math.trunc(winner.placementPoints ?? 0)))
        : "0";
    const winnerWwcd =
      winner && Number.isFinite(winner.wwcd)
        ? String(Math.max(0, Math.trunc(winner.wwcd ?? 0)))
        : "0";
    const winnerMatchesPlayed =
      winner && Number.isFinite(winner.matchesPlayed)
        ? String(Math.max(0, Math.trunc(winner.matchesPlayed)))
        : "0";
    const values = {
      matchId,
      sessionId: sessionId ?? "",
      winner: winnerName,
      winnerName,
      winnerTag,
      winnerRank,
      winnerTitle: winner ? this.finalWinnerTitle(Number(winnerRank) || 1) : "",
      winnerEmoji: winner
        ? this.finalWinnerEmoji(Number(winnerRank) || 1, config)
        : this.emoji("trophy", config),
      rankEmoji: winner
        ? this.finalWinnerEmoji(Number(winnerRank) || 1, config)
        : this.emoji("trophy", config),
      winnerPoints,
      winnerKills,
      winnerPlacementPoints,
      winnerWwcd,
      winnerMatchesPlayed,
      winners: winnersText,
      topTeams: winnersText,
      trophy: this.emoji("trophy", config),
      fire: this.emoji("fire", config),
      chart: this.emoji("chart", config),
    };
    const message = this.renderResultSummaryTemplate(
      this.finalResultMessageTemplate(config),
      values,
    ).trim();
    const body = message || `${this.emoji("trophy", config)} Overall Results`;
    const rendered = this.renderResultSummaryTemplate(
      this.finalResultPostTemplate(config),
      {
        ...values,
        message: body,
        publicContent: body,
      },
    ).trim();
    return rendered || body;
  }

  private finalResultPublicContentFromBackup(
    backup: ResultBackupDetailResponse,
    config?:
      | (Pick<SessionDiscordConfigResponse, "emojis"> &
          Partial<Pick<SessionDiscordConfigResponse, "sessionId">>)
      | null,
  ) {
    const sessionId =
      config?.sessionId?.trim() || backup.sessionId?.trim() || "";
    const winnerCount = this.finalResultWinnerCount(config);
    const winners = backup.rows.slice(0, winnerCount);
    const winner = winners[0] ?? null;
    const winnerRows = winners
      .map((team) => this.formatFinalBackupWinnerEntry(team, config))
      .filter(Boolean);
    const winnersText = winnerRows.length
      ? winnerRows.join("\n")
      : "No standings available yet.";
    const winnerName = this.finalBackupTeamLabel(winner);
    const winnerTag = winner?.teamTag?.trim() || winnerName;
    const winnerRank =
      winner && Number.isFinite(winner.rank)
        ? String(Math.max(1, Math.trunc(winner.rank)))
        : "";
    const winnerPoints =
      winner && Number.isFinite(winner.totalPoints)
        ? String(Math.max(0, Math.trunc(winner.totalPoints)))
        : "0";
    const winnerKills =
      winner && Number.isFinite(winner.kills)
        ? String(Math.max(0, Math.trunc(winner.kills)))
        : "0";
    const winnerPlacementPoints =
      winner && Number.isFinite(winner.placementPoints)
        ? String(Math.max(0, Math.trunc(winner.placementPoints ?? 0)))
        : "0";
    const winnerWwcd =
      winner && Number.isFinite(winner.wwcd)
        ? String(Math.max(0, Math.trunc(winner.wwcd ?? 0)))
        : "0";
    const values = {
      matchId: backup.sourceMatchId ?? "",
      backupId: backup.id,
      sessionId,
      winner: winnerName,
      winnerName,
      winnerTag,
      winnerRank,
      winnerTitle: winner ? this.finalWinnerTitle(Number(winnerRank) || 1) : "",
      winnerEmoji: winner
        ? this.finalWinnerEmoji(Number(winnerRank) || 1, config)
        : this.emoji("trophy", config),
      rankEmoji: winner
        ? this.finalWinnerEmoji(Number(winnerRank) || 1, config)
        : this.emoji("trophy", config),
      winnerPoints,
      winnerKills,
      winnerPlacementPoints,
      winnerWwcd,
      winnerMatchesPlayed: "",
      winners: winnersText,
      topTeams: winnersText,
      trophy: this.emoji("trophy", config),
      fire: this.emoji("fire", config),
      chart: this.emoji("chart", config),
    };
    const message = this.renderResultSummaryTemplate(
      this.finalResultMessageTemplate(config),
      values,
    ).trim();
    const body = message || `${this.emoji("trophy", config)} Overall Results`;
    const rendered = this.renderResultSummaryTemplate(
      this.finalResultPostTemplate(config),
      {
        ...values,
        message: body,
        publicContent: body,
      },
    ).trim();
    return rendered || body;
  }

  private async latestOverallResultBackup(sessionId: string) {
    const backups = await this.apiClient.listResultBackups({
      sessionId,
      kind: "OVERALL",
    });
    const backup = backups.find(
      (entry) => entry.kind?.toUpperCase() === "OVERALL",
    );
    if (!backup) {
      throw new Error(
        "No final result backup found for this session. Post final result once before refreshing it.",
      );
    }
    return this.apiClient.getResultBackup(backup.id);
  }

  async buildFinalResultBackupPost(
    sessionId: string,
    config?:
      | (Pick<SessionDiscordConfigResponse, "emojis"> &
          Partial<Pick<SessionDiscordConfigResponse, "sessionId">>)
      | null,
  ): Promise<ApplyResultsDiscordResponse & { backupId: string }> {
    const backup = await this.latestOverallResultBackup(sessionId);
    const publicContent = this.finalResultPublicContentFromBackup(backup, {
      ...(config ?? { emojis: {} }),
      sessionId,
    });
    const content = publicContent;

    try {
      const buffer = await this.apiClient.getResultBackupRenderImage(
        backup.id,
        "overall-ranking",
      );
      return {
        content,
        publicContent,
        backupId: backup.id,
        imageBuffer: buffer,
        imageFiles: [{ name: "overall-ranking.png", buffer }],
      };
    } catch (error) {
      console.warn(
        `Result backup render failed backup=${backup.id}: ${toFriendlyApiError(
          error,
        )}`,
      );
      return {
        content: `${content}\n\nImage generation failed.`,
        publicContent,
        backupId: backup.id,
      };
    }
  }

  private async buildResultImageFiles(
    matchId: string,
    renderCards: Array<{ kind: MatchRenderKind; name: string }> = [
      { kind: "match-result", name: "match-result.png" },
      { kind: "overall-ranking", name: "overall-ranking.png" },
      { kind: "top-mvp", name: "top-mvp.png" },
      { kind: "top-fraggers", name: "top-fraggers.png" },
    ],
  ): Promise<
    Array<{
      name: string;
      buffer: Buffer;
    }>
  > {
    const settled = await Promise.allSettled(
      renderCards.map(async (card) => ({
        name: card.name,
        buffer: await this.apiClient.getMatchRenderImage(matchId, card.kind),
      })),
    );

    return settled.flatMap((result, index) => {
      if (result.status === "fulfilled") {
        return [result.value];
      }
      const card = renderCards[index];
      console.warn(
        `Render image fetch failed for match ${matchId} (${card.kind}): ${toFriendlyApiError(
          result.reason,
        )}`,
      );
      return [];
    });
  }

  async buildFinalResultPost(
    matchId: string,
    config?:
      | (Pick<SessionDiscordConfigResponse, "emojis"> &
          Partial<Pick<SessionDiscordConfigResponse, "sessionId">>)
      | null,
  ): Promise<ApplyResultsDiscordResponse> {
    const imageFiles = await this.buildResultImageFiles(matchId, [
      { kind: "overall-ranking", name: "overall-ranking.png" },
      { kind: "overall-top-mvp", name: "overall-top-mvp.png" },
      { kind: "overall-top-fraggers", name: "overall-top-fraggers.png" },
      { kind: "match-schedule", name: "match-schedule.png" },
    ]);
    const publicContent = await this.finalResultPublicContent(matchId, config);
    const content = publicContent;

    if (imageFiles.length > 0) {
      return {
        content,
        publicContent,
        imageFiles,
        imageBuffer: imageFiles[0]?.buffer,
      };
    }

    return {
      content: `${content}\n\nImage generation failed.`,
      publicContent,
    };
  }

  private async resolveTeamByTag(rawTag: string): Promise<TeamSummary> {
    const normalizedTag = this.normalizeTag(rawTag);
    if (!normalizedTag) {
      throw new Error(`${this.emoji("reject")} Team tag is required`);
    }

    try {
      return await this.apiClient.getTeamByTag(normalizedTag);
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.startsWith(this.emoji("reject"))
      ) {
        throw error;
      }
      throw new Error(toFriendlyApiError(error));
    }
  }

  private normalizeLookupText(value: string | null | undefined): string {
    return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  }

  private normalizeLogoKey(value: string | null | undefined): string {
    return (value ?? "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  private logoNameTokens(key: string) {
    const ignored = new Set([
      "team",
      "esport",
      "esports",
      "gaming",
      "official",
      "club",
      "clan",
      "scrim",
    ]);
    return key
      .split(" ")
      .map((token) => token.trim())
      .filter((token) => token.length >= 3 && !ignored.has(token));
  }

  private logoNamesLookRelated(
    requestedNameKey: string,
    savedNameKey: string,
  ) {
    if (!requestedNameKey || !savedNameKey) {
      return false;
    }
    if (requestedNameKey === savedNameKey) {
      return true;
    }

    const requestedCompact = requestedNameKey.replace(/\s+/g, "");
    const savedCompact = savedNameKey.replace(/\s+/g, "");
    if (
      requestedCompact.length >= 4 &&
      savedCompact.length >= 4 &&
      (requestedCompact.includes(savedCompact) ||
        savedCompact.includes(requestedCompact))
    ) {
      return true;
    }

    const requestedTokens = new Set(this.logoNameTokens(requestedNameKey));
    return this.logoNameTokens(savedNameKey).some((token) =>
      requestedTokens.has(token),
    );
  }

  private configuredLogoChannelIds(
    config?: Pick<SessionDiscordConfigResponse, "emojis"> | null,
  ): string[] {
    const raw = [
      config?.emojis?.discordLogoChannelIds,
      config?.emojis?.logoChannelIds,
    ]
      .filter((value): value is string => Boolean(value?.trim()))
      .join("\n");
    return [...new Set(raw.match(/\d{15,25}/g) ?? [])];
  }

  private configuredPlayerPhotoChannelIds(
    config?: Pick<SessionDiscordConfigResponse, "emojis"> | null,
  ): string[] {
    const raw = [
      config?.emojis?.discordPlayerPhotoChannelIds,
      config?.emojis?.playerPhotoChannelIds,
    ]
      .filter((value): value is string => Boolean(value?.trim()))
      .join("\n");
    return [...new Set(raw.match(/\d{15,25}/g) ?? [])];
  }

  private parsePendingTeamLogos(
    config?: Pick<SessionDiscordConfigResponse, "emojis"> | null,
  ): Record<string, PendingTeamLogoRecord> {
    const raw = config?.emojis?.[PENDING_TEAM_LOGOS_KEY];
    if (typeof raw !== "string" || !raw.trim()) {
      return {};
    }

    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return {};
      }
      const records: Record<string, PendingTeamLogoRecord> = {};
      for (const [key, value] of Object.entries(
        parsed as Record<string, unknown>,
      )) {
        if (!value || typeof value !== "object" || Array.isArray(value)) {
          continue;
        }
        const record = value as Partial<PendingTeamLogoRecord>;
        const normalizedKey = this.normalizeLogoKey(record.teamName ?? key);
        const url = record.url?.trim();
        const channelId = record.channelId?.trim();
        const messageId = record.messageId?.trim();
        if (!normalizedKey || !url || !channelId || !messageId) {
          continue;
        }
        records[normalizedKey] = {
          key: normalizedKey,
          tagKey: this.normalizeLogoKey(record.tag ?? record.tagKey ?? ""),
          teamName: record.teamName?.trim() || key,
          tag: record.tag?.trim() || null,
          channelId,
          messageId,
          attachmentId: record.attachmentId?.trim() || null,
          url,
          filename: record.filename?.trim() || null,
          contentType: record.contentType?.trim() || null,
          savedByDiscordId: record.savedByDiscordId?.trim() || null,
          savedByDiscordUsername: record.savedByDiscordUsername?.trim() || null,
          savedAt: record.savedAt?.trim() || new Date().toISOString(),
        };
      }
      return records;
    } catch {
      return {};
    }
  }

  private async savePendingTeamLogo(
    config: SessionDiscordConfigResponse,
    source: DiscordTeamLogoSource,
  ): Promise<SessionDiscordConfigResponse> {
    const key = this.normalizeLogoKey(source.teamName);
    if (!key) {
      return config;
    }

    const records = this.parsePendingTeamLogos(config);
    records[key] = {
      ...source,
      key,
      tagKey: this.normalizeLogoKey(source.tag ?? ""),
      teamName: source.teamName.trim(),
      tag: source.tag?.trim() || null,
      attachmentId: source.attachmentId?.trim() || null,
      filename: source.filename?.trim() || null,
      contentType: source.contentType?.trim() || null,
      savedByDiscordId: source.savedByDiscordId?.trim() || null,
      savedByDiscordUsername: source.savedByDiscordUsername?.trim() || null,
      savedAt: new Date().toISOString(),
    };

    const limited = Object.fromEntries(
      Object.entries(records)
        .sort(
          ([, left], [, right]) =>
            Date.parse(right.savedAt) - Date.parse(left.savedAt),
        )
        .slice(0, MAX_PENDING_TEAM_LOGOS),
    );

    return this.apiClient.updateSessionDiscordConfig(config.sessionId, {
      emojis: {
        ...(config.emojis ?? {}),
        [PENDING_TEAM_LOGOS_KEY]: JSON.stringify(limited),
      },
    });
  }

  private async savePendingTeamLogoToActiveGuildSessions(
    guildId: string,
    fallbackConfig: SessionDiscordConfigResponse,
    source: DiscordTeamLogoSource,
  ) {
    const sessions = await this.apiClient.listSessions();
    const targetSessions = sessions.filter(
      (session) => session.type === "SCRIM" && session.status !== "ARCHIVED",
    );
    const savedSessionIds = new Set<string>();

    for (const session of targetSessions) {
      const config = await this.apiClient
        .getSessionDiscordConfig(session.id)
        .catch(() => null);
      if (
        !config ||
        config.enabled === false ||
        config.guildId !== guildId ||
        savedSessionIds.has(config.sessionId)
      ) {
        continue;
      }
      await this.savePendingTeamLogo(config, source);
      savedSessionIds.add(config.sessionId);
    }

    if (savedSessionIds.size === 0) {
      await this.savePendingTeamLogo(fallbackConfig, source);
      return 1;
    }

    return savedSessionIds.size;
  }

  private async savePendingTeamLogoForActiveGuildScope(
    config: SessionDiscordConfigResponse,
    source: DiscordTeamLogoSource,
    explicitGuildId?: string | null,
  ) {
    const guildId = explicitGuildId?.trim() || config.guildId?.trim() || "";
    if (!guildId) {
      await this.savePendingTeamLogo(config, source);
      return 1;
    }

    try {
      return await this.savePendingTeamLogoToActiveGuildSessions(
        guildId,
        config,
        source,
      );
    } catch (error) {
      console.warn(
        `Guild-wide pending Discord team logo save failed: ${toFriendlyApiError(
          error,
        )}`,
      );
      await this.savePendingTeamLogo(config, source);
      return 1;
    }
  }

  private pendingLogoForTeam(
    teamName: string,
    tag: string | null | undefined,
    config: SessionDiscordConfigResponse,
  ) {
    const records = this.parsePendingTeamLogos(config);
    const nameKey = this.normalizeLogoKey(teamName);
    if (nameKey && records[nameKey]) {
      return records[nameKey];
    }

    const tagKey = this.normalizeLogoKey(tag ?? "");
    if (tagKey) {
      const byTag = Object.values(records).find(
        (record) =>
          (record.tagKey === tagKey || record.key === tagKey) &&
          this.logoNamesLookRelated(nameKey, record.key),
      );
      if (byTag) {
        return byTag;
      }
    }

    return null;
  }

  private async pendingLogoForTeamAcrossActiveGuildSessions(
    teamName: string,
    tag: string | null | undefined,
    config: SessionDiscordConfigResponse,
  ) {
    const guildId = config.guildId?.trim();
    if (!guildId) {
      return null;
    }

    const sessions = await this.apiClient.listSessions();
    const targetSessions = sessions.filter(
      (session) => session.type === "SCRIM" && session.status !== "ARCHIVED",
    );
    const checkedSessionIds = new Set<string>();

    for (const session of targetSessions) {
      if (checkedSessionIds.has(session.id)) {
        continue;
      }
      checkedSessionIds.add(session.id);
      const candidateConfig = await this.apiClient
        .getSessionDiscordConfig(session.id)
        .catch(() => null);
      if (
        !candidateConfig ||
        candidateConfig.sessionId === config.sessionId ||
        candidateConfig.enabled === false ||
        candidateConfig.guildId !== guildId
      ) {
        continue;
      }
      const record = this.pendingLogoForTeam(teamName, tag, candidateConfig);
      if (record) {
        return record;
      }
    }

    return null;
  }

  async queueVisibleDiscordScrimRefreshForActiveGuildSessions(
    guild: Guild | null | undefined,
    config: SessionDiscordConfigResponse,
  ) {
    if (!guild || !config.guildId) {
      return;
    }

    await this.withOrganization(config.organizationId, async () => {
      const sessions = await this.apiClient.listSessions();
      const targetSessions = sessions.filter(
        (session) => session.type === "SCRIM" && session.status !== "ARCHIVED",
      );
      const queuedSessionIds = new Set<string>();
      for (const session of targetSessions) {
        if (queuedSessionIds.has(session.id)) {
          continue;
        }
        const candidateConfig = await this.apiClient
          .getSessionDiscordConfig(session.id)
          .catch(() => null);
        if (
          !candidateConfig ||
          candidateConfig.enabled === false ||
          candidateConfig.guildId !== config.guildId
        ) {
          continue;
        }
        queuedSessionIds.add(session.id);
        this.queueVisibleDiscordScrimRefresh(
          guild,
          session.id,
          candidateConfig,
        );
      }
    }).catch((error) => {
      console.warn(
        `Guild-wide Discord scrim refresh queue failed: ${toFriendlyApiError(
          error,
        )}`,
      );
      this.queueVisibleDiscordScrimRefresh(guild, config.sessionId, config);
    });
  }

  private async resolveDiscordChannel(
    guildId: string,
    channelId: string,
    channelTopic?: string | null,
  ): Promise<ResolvedDiscordChannelResponse | null> {
    try {
      const marker = this.parseDiscordSessionTopic(channelTopic);
      return await this.apiClient.resolveDiscordChannel(
        guildId,
        channelId,
        marker?.sessionId,
        marker?.kind,
      );
    } catch (error) {
      const friendly = toFriendlyApiError(error);
      if (
        friendly === "Requested resource not found" ||
        friendly === "Unexpected API call"
      ) {
        return null;
      }
      throw new Error(friendly);
    }
  }

  private parseDiscordSessionTopic(topic: string | null | undefined) {
    const match = topic?.match(DISCORD_SESSION_TOPIC_PATTERN);
    if (!match) {
      return null;
    }
    return {
      sessionId: match[1].trim(),
      kind: match[2].trim().toLowerCase(),
    };
  }

  private isActiveTeamMember(member: TeamMemberSummary): boolean {
    return !member.deletedAt && !member.leftAt;
  }

  private formatTeamSummary(
    team: TeamSummary | TeamBanResponse["team"] | null | undefined,
  ): string {
    if (!team) {
      return "Unknown team";
    }
    return team.tag ? `${team.name} (${team.tag})` : team.name;
  }

  private parseTeamDisplayLookup(query: string): {
    name: string;
    tag: string;
  } | null {
    const match = /^(.+?)\s*\(([^()]+)\)\s*$/.exec(query.trim());
    const name = match?.[1]?.trim() ?? "";
    const tag = match?.[2]?.trim() ?? "";
    return name && tag ? { name, tag } : null;
  }

  private async resolveTeamByNameOrTag(query: string): Promise<TeamSummary> {
    const cleaned = query.trim().replace(/^"|"$/g, "").trim();
    if (!cleaned) {
      throw new Error(
        `${this.emoji("reject")} Team name or manager mention is required`,
      );
    }

    const displayLookup = this.parseTeamDisplayLookup(cleaned);
    const lookupText = displayLookup?.name ?? cleaned;
    const normalized = this.normalizeLookupText(lookupText);
    const compact = this.normalizeTag(displayLookup?.tag ?? cleaned);
    const teams = await this.apiClient.searchTeams(lookupText);
    const exact = teams.filter((team) => {
      const name = this.normalizeLookupText(team.name);
      const tag = this.normalizeTag(team.tag ?? "");
      if (displayLookup) {
        return name === normalized && tag.length > 0 && tag === compact;
      }
      return name === normalized || (tag.length > 0 && tag === compact);
    });

    if (exact.length === 1) {
      return exact[0];
    }
    if (exact.length > 1) {
      throw new Error(
        `${this.emoji("warning")} Multiple teams match "${cleaned}": ${exact
          .slice(0, 5)
          .map((team) => this.formatTeamSummary(team))
          .join(", ")}`,
      );
    }
    if (teams.length === 1) {
      return teams[0];
    }
    if (teams.length > 1) {
      throw new Error(
        `${this.emoji("warning")} Multiple teams match "${cleaned}". Use the exact team name or tag.`,
      );
    }

    try {
      return await this.resolveTeamByTag(cleaned);
    } catch {
      throw new Error(`${this.emoji("reject")} Team not found: ${cleaned}`);
    }
  }

  async updateTeamLogoFromDiscord(
    query: string,
    logoUpload: TeamLogoUpload,
    config?:
      | (
          | SessionDiscordConfigResponse
          | Pick<SessionDiscordConfigResponse, "emojis">
        )
      | null,
    source?: DiscordTeamLogoSource | null,
    options: {
      savePendingToActiveGuildSessions?: { guildId: string };
    } = {},
  ): Promise<string> {
    let team: TeamSummary | null = null;
    try {
      team = await this.resolveTeamByNameOrTag(query);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        !message.toLowerCase().includes("team not found") ||
        !config ||
        !source ||
        !("sessionId" in config)
      ) {
        throw error;
      }

      const savedCount = await this.savePendingTeamLogoForActiveGuildScope(
        config,
        source,
        options.savePendingToActiveGuildSessions?.guildId,
      );
      const scope =
        savedCount > 1 ? ` across ${savedCount} active sessions` : "";
      return `${this.emoji("check", config)} Logo saved for ${query.trim()}${scope}. It will be attached automatically when this team registers.`;
    }

    try {
      const uploaded = await this.apiClient.uploadTeamLogo(team.id, logoUpload);
      team.logoUrl = uploaded.logoUrl;
    } catch (error) {
      throw new Error(
        `${this.emoji("warning", config)} Logo upload failed: ${toFriendlyApiError(
          error,
        )}`,
      );
    }

    if (config && source && "sessionId" in config) {
      await this.savePendingTeamLogoForActiveGuildScope(
        config,
        source,
        options.savePendingToActiveGuildSessions?.guildId,
      ).catch((error) =>
        console.warn(
          `Pending Discord team logo save failed: ${toFriendlyApiError(error)}`,
        ),
      );
    }

    return `${this.emoji("check", config)} Logo saved for ${this.formatTeamSummary(
      team,
    )}. It will be used in registrations, slot lists, and result widgets.`;
  }

  async updatePlayerPhotoFromDiscord(
    payload: {
      uid: string;
      teamName?: string | null;
      playerName?: string | null;
    },
    photoUpload: PlayerPhotoUpload,
    config: SessionDiscordConfigResponse,
  ): Promise<string> {
    const uid = payload.uid.trim().replace(/\s+/g, "");
    if (!uid) {
      throw new Error(`${this.emoji("reject", config)} Player UID is required`);
    }

    try {
      const uploaded = await this.apiClient.uploadDiscordPlayerPhoto(
        {
          sessionId: config.sessionId,
          registrationMode: config.registrationMode,
          uid,
          teamName: payload.teamName?.trim() || null,
          playerName: payload.playerName?.trim() || null,
        },
        photoUpload,
      );
      const playerLabel =
        uploaded.playerName?.trim() && uploaded.playerName !== uid
          ? `${uploaded.playerName} (${uid})`
          : uid;
      const teamLabel = uploaded.team
        ? ` for ${this.formatTeamSummary(uploaded.team)}`
        : "";
      return `${this.emoji(
        "check",
        config,
      )} Player photo saved for ${playerLabel}${teamLabel}. It will update current and future widgets by UID.`;
    } catch (error) {
      throw new Error(
        `${this.emoji(
          "warning",
          config,
        )} Player photo upload failed: ${toFriendlyApiError(error)}`,
      );
    }
  }

  async resolveTeamForDiscordBanTarget(
    target: DiscordTeamBanTarget,
  ): Promise<TeamSummary> {
    if (target.kind === "team") {
      return this.resolveTeamByNameOrTag(target.query);
    }
    if (target.kind === "team-id") {
      return this.resolveTeamById(target.teamId, target.label);
    }

    const teams = await this.apiClient.searchTeams("");
    const matches: TeamSummary[] = [];
    for (const team of teams) {
      const members = await this.apiClient
        .listTeamMembers(team.id)
        .catch(() => [] as TeamMemberSummary[]);
      if (
        members.some(
          (member) =>
            this.isActiveTeamMember(member) &&
            member.discordUserId === target.discordUserId,
        )
      ) {
        matches.push(team);
      }
    }

    if (matches.length === 1) {
      return matches[0];
    }
    if (matches.length > 1) {
      throw new Error(
        `${this.emoji("warning")} That manager is linked to multiple teams: ${matches
          .slice(0, 5)
          .map((team) => this.formatTeamSummary(team))
          .join(", ")}. Use the team name instead.`,
      );
    }
    throw new Error(
      `${this.emoji("reject")} No team is linked to that manager.`,
    );
  }

  private async resolveManagersForDiscordBanTarget(
    target: DiscordTeamBanTarget,
    sessionId?: string | null,
  ): Promise<{
    team: TeamSummary | null;
    managers: DiscordManagerBanTarget[];
  }> {
    if (target.kind === "manager") {
      return {
        team: null,
        managers: [
          {
            discordUserId: target.discordUserId,
            discordUsername: null,
            displayName: null,
          },
        ],
      };
    }

    const team =
      target.kind === "team-id"
        ? await this.resolveTeamById(target.teamId, target.label)
        : await this.resolveTeamByNameOrTag(target.query);
    const members = await this.apiClient
      .listTeamMembers(team.id)
      .catch(() => [] as TeamMemberSummary[]);
    const active = members.filter((member) => this.isActiveTeamMember(member));
    const leaders = active.filter((member) => member.role === "LEADER");
    const selected = leaders.length ? leaders : active;
    const managers = new Map<string, DiscordManagerBanTarget>();
    const addManager = (
      discordUserId: string | null | undefined,
      discordUsername?: string | null,
      displayName?: string | null,
    ) => {
      const cleanDiscordUserId = discordUserId?.trim();
      if (!cleanDiscordUserId || managers.has(cleanDiscordUserId)) {
        return;
      }
      managers.set(cleanDiscordUserId, {
        discordUserId: cleanDiscordUserId,
        discordUsername: discordUsername ?? null,
        displayName: displayName ?? null,
      });
    };
    for (const member of selected) {
      const discordUserId = member.discordUserId?.trim();
      if (!discordUserId || managers.has(discordUserId)) {
        continue;
      }
      addManager(discordUserId, member.discordUsername, member.displayName);
    }
    if (sessionId?.trim()) {
      const registrations = await this.apiClient
        .listRegistrations(sessionId.trim())
        .catch(() => [] as SessionRegistrationResponse[]);
      const registration =
        registrations.find(
          (entry) =>
            entry.teamId === team.id &&
            entry.status !== "REMOVED" &&
            !entry.removedAt,
        ) ?? null;
      addManager(registration?.leaderDiscordUserId, null, null);
      for (const managerDiscordUserId of registration?.managerDiscordUserIds ??
        []) {
        addManager(managerDiscordUserId, null, null);
      }
    }
    if (!managers.size) {
      throw new Error(
        `${this.emoji("reject")} ${this.formatTeamSummary(
          team,
        )} has no linked Discord manager to ban.`,
      );
    }
    return { team, managers: [...managers.values()] };
  }

  private async resolveTeamById(
    teamId: string,
    fallbackLabel?: string | null,
  ): Promise<TeamSummary> {
    const cleanTeamId = teamId.trim();
    if (!cleanTeamId) {
      throw new Error(`${this.emoji("reject")} Team id is required`);
    }
    const teams = await this.apiClient.searchTeams("").catch(() => []);
    const team = teams.find((entry) => entry.id === cleanTeamId);
    if (team) {
      return team;
    }
    return {
      id: cleanTeamId,
      name: fallbackLabel?.trim() || cleanTeamId,
      tag: null,
    };
  }

  private async teamManagerSummary(teamId: string): Promise<string> {
    const members = await this.apiClient
      .listTeamMembers(teamId)
      .catch(() => [] as TeamMemberSummary[]);
    const active = members.filter((member) => this.isActiveTeamMember(member));
    const leaders = active.filter((member) => member.role === "LEADER");
    const managers = leaders.length ? leaders : active;
    if (!managers.length) {
      return "No linked manager";
    }
    return managers
      .slice(0, 3)
      .map(
        (member) =>
          member.displayName?.trim() ||
          member.discordUsername?.trim() ||
          member.discordUserId,
      )
      .join(", ");
  }

  private managerBanTargetLabel(manager: {
    discordUserId: string;
    discordUsername?: string | null;
    displayName?: string | null;
  }) {
    return this.plainDiscordManagerLabel(manager);
  }

  private formatSessionMatch(
    match: SessionMatchResponse | TeamBanResponse["match"],
  ) {
    if (!match) {
      return "Unknown match";
    }
    if (match.name) {
      return match.name;
    }
    return match.matchNumber ? `Match ${match.matchNumber}` : "Match";
  }

  private matchSortTime(match: SessionMatchResponse): number {
    const raw =
      match.endedAt ??
      match.startedAt ??
      match.updatedAt ??
      match.createdAt ??
      match.scheduledAt ??
      null;
    const parsed = raw ? Date.parse(raw) : Number.NaN;
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private sortSessionMatchesForResults(
    left: SessionMatchResponse,
    right: SessionMatchResponse,
  ) {
    const leftNumber = left.matchNumber ?? 0;
    const rightNumber = right.matchNumber ?? 0;
    if (rightNumber !== leftNumber) {
      return rightNumber - leftNumber;
    }
    return this.matchSortTime(right) - this.matchSortTime(left);
  }

  private resultMatchCreatePayload(
    matchNumber: number,
    fallback: boolean,
  ): CreateSessionMatchPayload {
    return {
      name: `Game ${matchNumber}`,
      matchNumber,
      dataMode: "MANUAL",
      dataSource: "MANUAL",
      ...(fallback ? { gameKey: "PUBG_MOBILE", map: "ERANGEL" } : {}),
    };
  }

  private missingGameOrMapError(error: unknown): boolean {
    const message = error instanceof Error ? error.message.toLowerCase() : "";
    return (
      message.includes("gamekey is required") ||
      message.includes("map is required")
    );
  }

  private async createResultMatchForGameCode(
    sessionId: string,
    matchNumber: number,
  ): Promise<SessionMatchResponse> {
    try {
      return await this.apiClient.createSessionMatch(
        sessionId,
        this.resultMatchCreatePayload(matchNumber, false),
      );
    } catch (error) {
      if (!this.missingGameOrMapError(error)) {
        throw error;
      }
    }

    return this.apiClient.createSessionMatch(
      sessionId,
      this.resultMatchCreatePayload(matchNumber, true),
    );
  }

  private async ensureResultMatchSlots(
    sessionId: string,
    match: SessionMatchResponse,
  ) {
    try {
      await this.apiClient.syncSessionMatchSlots(sessionId, match.id);
    } catch (error) {
      console.warn(
        `Session match slot sync failed for ${match.id}: ${toFriendlyApiError(
          error,
        )}`,
      );
    }
    return match;
  }

  private async resolveResultMatch(
    sessionId: string,
    options: AutomaticResultScreenshotOptions = {},
  ): Promise<{ match: SessionMatchResponse; created: boolean }> {
    const matches = await this.apiClient.listSessionMatches(sessionId);
    const matchNumber =
      typeof options.matchNumber === "number" &&
      Number.isInteger(options.matchNumber) &&
      options.matchNumber > 0
        ? options.matchNumber
        : null;

    if (matchNumber) {
      const existing = matches.find(
        (match) => match.matchNumber === matchNumber,
      );
      if (existing) {
        return {
          match: await this.ensureResultMatchSlots(sessionId, existing),
          created: false,
        };
      }

      try {
        const created = await this.createResultMatchForGameCode(
          sessionId,
          matchNumber,
        );
        return { match: created, created: true };
      } catch (error) {
        const refreshed = await this.apiClient
          .listSessionMatches(sessionId)
          .catch(() => matches);
        const raced = refreshed.find(
          (match) => match.matchNumber === matchNumber,
        );
        if (raced) {
          return {
            match: await this.ensureResultMatchSlots(sessionId, raced),
            created: false,
          };
        }
        throw error;
      }
    }

    if (!matches.length) {
      throw new Error(
        `${this.emoji("reject")} Add a game code like \`G1\` with the result screenshot so the bot can create that match automatically.`,
      );
    }

    const resultReadyStatuses = new Set([
      "LIVE",
      "FINISH_PENDING",
      "FINISHED",
      "ENDED",
    ]);
    const candidates = matches.filter((match) =>
      resultReadyStatuses.has((match.status ?? "").toUpperCase()),
    );
    const match = (candidates.length ? candidates : matches)
      .slice()
      .sort((left, right) => this.sortSessionMatchesForResults(left, right))[0];
    return {
      match: await this.ensureResultMatchSlots(sessionId, match),
      created: false,
    };
  }

  private teamBanTargetSummary(
    ban: Pick<
      TeamBanResponse | ManagerBanResponse,
      "scope" | "session" | "match"
    >,
  ): string {
    if (ban.scope === "TEAM") {
      return "Discord-wide";
    }
    if (ban.scope === "SESSION") {
      return ban.session?.name ? `scrim ${ban.session.name}` : "this scrim";
    }
    return this.formatSessionMatch(ban.match);
  }

  private normalizeSessionSelector(value: string | null | undefined) {
    return (value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
  }

  private formatBanSessionTargets(targets: DiscordBanSessionTarget[]) {
    if (!targets.length) {
      return "Current scrim";
    }
    if (targets.length === 1) {
      return targets[0]?.name?.trim() || targets[0]?.id || "Current scrim";
    }
    const names = targets
      .slice(0, 5)
      .map((target) => target.name?.trim() || target.id)
      .join(", ");
    const extra = targets.length > 5 ? `, +${targets.length - 5} more` : "";
    return `${targets.length} selected scrim(s): ${names}${extra}`;
  }

  private async resolveDiscordBanSessionTargets(
    input: Pick<
      DiscordTeamBanCommand | DiscordTeamUnbanCommand,
      "sessionId" | "sessionIds" | "sessionSelectors"
    >,
    config: SessionDiscordConfigResponse | null,
  ): Promise<DiscordBanSessionTarget[]> {
    const directSessionIds = this.uniqueStrings(input.sessionIds ?? []);
    const selectors = this.uniqueStrings(input.sessionSelectors ?? []);
    const currentSessionId = input.sessionId?.trim();

    if (!directSessionIds.length && !selectors.length) {
      if (!currentSessionId) {
        return [];
      }
      const session = await this.apiClient
        .getSession(currentSessionId)
        .catch(() => null);
      return [
        {
          id: currentSessionId,
          name: session?.name ?? null,
        },
      ];
    }

    const sessions = (await this.apiClient.listSessions()).filter(
      (session) => session.type === "SCRIM" && session.status !== "ARCHIVED",
    );
    const guildId = config?.guildId?.trim() || null;
    const eligible: SessionResponse[] = [];
    for (const session of sessions) {
      if (guildId) {
        const sessionConfig = await this.apiClient
          .getSessionDiscordConfig(session.id)
          .catch(() => null);
        if (sessionConfig?.guildId !== guildId) {
          continue;
        }
      }
      eligible.push(session);
    }

    const byId = new Map(eligible.map((session) => [session.id, session]));
    const resolved = new Map<string, DiscordBanSessionTarget>();
    const addSession = (session: SessionResponse) => {
      resolved.set(session.id, { id: session.id, name: session.name });
    };

    for (const sessionId of directSessionIds) {
      const session = byId.get(sessionId);
      if (!session) {
        throw new Error(
          `Selected session is not available for this Discord server: ${sessionId}`,
        );
      }
      addSession(session);
    }

    for (const selector of selectors) {
      const normalized = this.normalizeSessionSelector(selector);
      if (!normalized) {
        continue;
      }
      const direct = byId.get(selector);
      if (direct) {
        addSession(direct);
        continue;
      }

      const exactMatches = eligible.filter((session) => {
        const name = this.normalizeSessionSelector(session.name);
        const slug = this.normalizeSessionSelector(session.slug);
        return name === normalized || (!!slug && slug === normalized);
      });
      if (exactMatches.length === 1) {
        addSession(exactMatches[0]);
        continue;
      }
      if (exactMatches.length > 1) {
        throw new Error(`Session selector is ambiguous: ${selector}`);
      }

      const partialMatches = eligible.filter((session) => {
        const name = this.normalizeSessionSelector(session.name);
        const slug = this.normalizeSessionSelector(session.slug);
        return (
          name.includes(normalized) || (!!slug && slug.includes(normalized))
        );
      });
      if (partialMatches.length === 1) {
        addSession(partialMatches[0]);
        continue;
      }
      if (partialMatches.length > 1) {
        throw new Error(
          `Session selector matches multiple scrims: ${selector}`,
        );
      }
      throw new Error(`Session not found for this Discord server: ${selector}`);
    }

    return [...resolved.values()];
  }

  private banExpiresAt(days: number | null | undefined): string | null {
    if (!days || !Number.isFinite(days) || days <= 0) {
      return null;
    }
    return new Date(
      Date.now() + Math.ceil(days) * 24 * 60 * 60 * 1000,
    ).toISOString();
  }

  private noShowBanPayload(
    input: DiscordNoShowTeamBanCommand,
  ): NoShowTeamBanPayload {
    return {
      sessionId: input.sessionId,
      matchId: input.matchId?.trim() || null,
      matchNumber:
        typeof input.matchNumber === "number" && input.matchNumber > 0
          ? input.matchNumber
          : null,
      scope: input.scope,
      reason: input.reason?.trim() || null,
      note: input.note?.trim() || "Created from Discord no-show command",
      expiresAt: this.banExpiresAt(input.days),
      teamIds: input.teamIds?.filter((teamId) => teamId.trim()) ?? undefined,
      managerDiscordUserIds:
        input.managerDiscordUserIds?.filter((discordUserId) =>
          discordUserId.trim(),
        ) ?? undefined,
    };
  }

  private noShowBanDurationLine(
    input: Pick<DiscordNoShowTeamBanCommand, "days">,
  ) {
    return input.days && Number.isFinite(input.days) && input.days > 0
      ? `Duration: ${Math.ceil(input.days)} day(s)`
      : "Duration: permanent";
  }

  private formatNoShowBanTeams(
    response: NoShowTeamBanResponse,
    onlyCreatable = false,
  ) {
    const teams = onlyCreatable
      ? response.teams.filter((team) => !team.alreadyBanned)
      : response.teams;
    if (!teams.length) {
      return ["- none"];
    }
    return teams.slice(0, 12).map((entry) => {
      const status = entry.alreadyBanned ? "already banned" : "will ban";
      const missed = (entry.missedMatches ?? [])
        .map((match) =>
          match.matchNumber
            ? `G${match.matchNumber}`
            : match.matchName?.trim() || "match",
        )
        .filter(Boolean)
        .join(", ");
      const managers = entry.managers?.length
        ? ` | managers: ${entry.managers
            .slice(0, 3)
            .map((manager) => this.plainDiscordManagerLabel(manager))
            .join(", ")}${entry.managers.length > 3 ? ", ..." : ""}`
        : "";
      return `- #${entry.slotNumber} ${this.formatTeamSummary(entry.team)} (${status}${missed ? `, missed ${missed}` : ""})${managers}`;
    });
  }

  private noShowCreatedManagerTargets(
    response: NoShowTeamBanResponse,
  ): DiscordManagerBanTarget[] {
    const createdTeamIds = new Set(
      response.createdBans.map((ban) => ban.teamId).filter(Boolean),
    );
    const managers = response.teams
      .filter((entry) => createdTeamIds.has(entry.teamId))
      .flatMap((entry) => entry.managers ?? []);
    return [
      ...new Map(
        managers
          .filter((manager) => manager.discordUserId?.trim())
          .map((manager) => [
            manager.discordUserId,
            {
              discordUserId: manager.discordUserId,
              discordUsername: manager.discordUsername ?? null,
              displayName: manager.displayName ?? null,
            },
          ]),
      ).values(),
    ];
  }

  private noShowBanMatchLabel(response: NoShowTeamBanResponse) {
    return this.formatSessionMatch(response.match);
  }

  private parseNoShowAutoBanRulesForDiscord(
    config: Pick<SessionDiscordConfigResponse, "emojis"> | null | undefined,
  ) {
    const raw = config?.emojis?.noShowBanRules;
    if (!raw) {
      return [];
    }
    const parsed = (() => {
      try {
        return JSON.parse(raw) as unknown;
      } catch {
        return null;
      }
    })();
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .map((entry) => {
        if (!entry || typeof entry !== "object") {
          return null;
        }
        const record = entry as Record<string, unknown>;
        const type = this.noShowAutoBanRuleType(record);
        const misses =
          type === "TOTAL_MISSES"
            ? this.noShowAutoBanRulePositiveInt(record.misses, 1, 20, 1)
            : null;
        const matchNumber =
          type === "MATCH_MISSED"
            ? this.noShowAutoBanRulePositiveInt(
                record.matchNumber ?? record.match ?? record.game,
                1,
                99,
                1,
              )
            : null;
        const durationDays = this.noShowAutoBanRuleDurationDays(record);
        const scope = record.scope === "TEAM" ? "TEAM" : "SESSION";
        const reason =
          typeof record.reason === "string" && record.reason.trim()
            ? record.reason.trim()
            : "Missed {misses} match(es) in {session}";
        return {
          enabled: record.enabled === true,
          type,
          misses,
          matchNumber,
          durationDays,
          scope,
          reason,
        };
      })
      .filter((rule): rule is DiscordNoShowAutoBanRule =>
        Boolean(rule?.enabled),
      )
      .sort(
        (left, right) =>
          this.noShowAutoBanRuleSortValue(left) -
          this.noShowAutoBanRuleSortValue(right),
      );
  }

  private noShowAutoBanRuleType(
    record: Record<string, unknown>,
  ): DiscordNoShowAutoBanRule["type"] {
    const raw = (
      typeof record.type === "string"
        ? record.type
        : typeof record.ruleType === "string"
          ? record.ruleType
          : typeof record.kind === "string"
            ? record.kind
            : ""
    )
      .trim()
      .toUpperCase()
      .replace(/[\s-]+/g, "_");
    if (
      raw === "MATCH_MISSED" ||
      raw === "SPECIFIC_MATCH" ||
      raw === "MATCH"
    ) {
      return "MATCH_MISSED";
    }
    if (raw === "TOTAL_MISSES" || raw === "TOTAL" || raw === "MISSES") {
      return "TOTAL_MISSES";
    }
    if (
      this.hasNoShowMatchRuleValue(record.matchNumber) ||
      this.hasNoShowMatchRuleValue(record.match) ||
      this.hasNoShowMatchRuleValue(record.game)
    ) {
      return "MATCH_MISSED";
    }
    return "TOTAL_MISSES";
  }

  private hasNoShowMatchRuleValue(value: unknown) {
    return value !== undefined && value !== null && String(value).trim() !== "";
  }

  private noShowAutoBanRulePositiveInt(
    value: unknown,
    min: number,
    max: number,
    fallback: number,
  ) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return fallback;
    }
    return Math.min(max, Math.max(min, Math.trunc(parsed)));
  }

  private noShowAutoBanRuleDurationDays(
    record: Record<string, unknown>,
  ): number | null {
    const duration =
      typeof record.duration === "string"
        ? record.duration
        : typeof record.durationType === "string"
          ? record.durationType
          : "";
    const rawDays = Object.prototype.hasOwnProperty.call(
      record,
      "durationDays",
    )
      ? record.durationDays
      : record.days;
    if (
      record.permanent === true ||
      /^(permanent|perm|none|0)$/i.test(duration.trim()) ||
      rawDays === null
    ) {
      return null;
    }
    return this.noShowAutoBanRulePositiveInt(rawDays, 1, 3650, 1);
  }

  private noShowAutoBanRuleSortValue(rule: DiscordNoShowAutoBanRule) {
    return rule.type === "MATCH_MISSED"
      ? (rule.matchNumber ?? 0)
      : (rule.misses ?? 0);
  }

  private banListMarker(sessionId: string | null | undefined) {
    return `arenzyra:${sessionId?.trim() || "global"}:ban-list`;
  }

  private banListDaysLeft(expiresAt: string | null | undefined) {
    if (!expiresAt) {
      return "";
    }
    const expires = new Date(expiresAt).getTime();
    if (!Number.isFinite(expires)) {
      return "";
    }
    const days = Math.max(
      0,
      Math.ceil((expires - Date.now()) / (24 * 60 * 60 * 1000)),
    );
    return `${days} day${days === 1 ? "" : "s"} left`;
  }

  private async teamManagerBanMentionSummary(
    teamId: string,
    guild: Guild | null | undefined,
  ): Promise<string> {
    const members = await this.apiClient
      .listTeamMembers(teamId)
      .catch(() => [] as TeamMemberSummary[]);
    const active = members.filter((member) => this.isActiveTeamMember(member));
    const leaders = active.filter((member) => member.role === "LEADER");
    const managers = (leaders.length ? leaders : active)
      .filter((member) => /^\d{15,25}$/.test(member.discordUserId))
      .slice(0, 3);
    const mentionableIds = await this.validatedManagerMentionIds(
      guild,
      managers.map((manager) => manager.discordUserId),
    );
    return managers
      .map((manager) => this.banChannelManagerLabel(manager, mentionableIds))
      .join(", ");
  }

  private banListTeamLine(
    ban: TeamBanResponse,
    managerMentions: string | null | undefined,
  ) {
    const tag = ban.team?.tag?.trim() || "-";
    const name = ban.team?.name?.trim() || ban.teamId;
    const reason = ban.reason?.trim() || "Banned";
    const duration = this.banListDaysLeft(ban.expiresAt);
    return `> **\`[${tag}]\` ${name}** (${reason})${
      duration ? ` \`${duration}\`` : ""
    }${managerMentions ? ` | Manager: ${managerMentions}` : ""}`;
  }

  private cleanBanListLabel(value: string | null | undefined) {
    return value?.trim().replace(/\s+/g, " ").slice(0, 80) || "";
  }

  private plainDiscordUserLabel(
    discordUserId: string | null | undefined,
    label?: string | null,
    fallback = "Discord user",
  ) {
    const cleanLabel = this.cleanBanListLabel(label);
    const cleanDiscordUserId = discordUserId?.trim();
    if (cleanLabel && cleanDiscordUserId) {
      return `${cleanLabel} (ID ${cleanDiscordUserId})`;
    }
    if (cleanLabel) {
      return cleanLabel;
    }
    if (cleanDiscordUserId) {
      return `${fallback} ${cleanDiscordUserId}`;
    }
    return fallback;
  }

  private plainDiscordManagerLabel(manager: {
    discordUserId?: string | null;
    discordUsername?: string | null;
    displayName?: string | null;
  }) {
    const label =
      this.cleanBanListLabel(manager.displayName) ||
      this.cleanBanListLabel(manager.discordUsername);
    return this.plainDiscordUserLabel(manager.discordUserId, label, "Discord ID");
  }

  private banChannelManagerLabel(
    manager: {
      discordUserId?: string | null;
      discordUsername?: string | null;
      displayName?: string | null;
    },
    mentionableIds: Set<string>,
  ) {
    const discordUserId = manager.discordUserId?.trim();
    if (discordUserId && mentionableIds.has(discordUserId)) {
      return this.managerClickableLabel(discordUserId);
    }
    return this.plainDiscordManagerLabel(manager);
  }

  private managerBanListLine(
    ban: ManagerBanResponse,
    resolvedDisplayName: string | null | undefined,
    mentionableIds = new Set<string>(),
  ) {
    const label =
      this.cleanBanListLabel(resolvedDisplayName) ||
      this.cleanBanListLabel(ban.displayName) ||
      this.cleanBanListLabel(ban.discordUsername) ||
      null;
    const reason = ban.reason?.trim() || "Banned";
    const duration = ban.expiresAt
      ? ` \`${this.banListDaysLeft(ban.expiresAt)}\``
      : "";
    const managerLabel = this.banChannelManagerLabel(
      {
        discordUserId: ban.discordUserId,
        discordUsername: ban.discordUsername,
        displayName: label,
      },
      mentionableIds,
    );
    return `> ${managerLabel} (${reason})${duration}`;
  }

  private splitDiscordManagedContent(
    lines: string[],
    marker: string,
  ): string[] {
    const chunks: string[] = [];
    let current = "";
    for (const line of lines) {
      const next = current ? `${current}\n${line}` : line;
      if (next.length > 1750 && current) {
        chunks.push(current);
        current = line;
      } else {
        current = next;
      }
    }
    if (current) {
      chunks.push(current);
    }
    return chunks.map(
      (chunk, index) =>
        `${chunk}\n\n\`${marker}:${index + 1}/${chunks.length}\``,
    );
  }

  private async buildDiscordBanListMessages(
    config: SessionDiscordConfigResponse,
    sessionId?: string | null,
    guild?: Guild | null,
  ) {
    const [bans, managerBans, matches] = await Promise.all([
      this.apiClient.listTeamBans({ active: true }),
      this.apiClient.listManagerBans({ active: true }).catch(() => []),
      sessionId
        ? this.apiClient
            .listSessionMatches(sessionId)
            .catch(() => [] as SessionMatchResponse[])
        : Promise.resolve([] as SessionMatchResponse[]),
    ]);
    const matchIds = new Set(matches.map((match) => match.id));
    const relevant = sessionId
      ? bans.filter(
          (ban) =>
            ban.scope === "TEAM" ||
            ban.sessionId === sessionId ||
            Boolean(ban.matchId && matchIds.has(ban.matchId)),
        )
      : bans;
    const relevantManagerBans = sessionId
      ? managerBans.filter(
          (ban) =>
            ban.scope === "TEAM" ||
            ban.sessionId === sessionId ||
            Boolean(ban.matchId && matchIds.has(ban.matchId)),
        )
      : managerBans;

    const managerMentionsByTeamId = new Map<string, string>();
    await this.runLimited(relevant, 5, async (ban) => {
      managerMentionsByTeamId.set(
        ban.teamId,
        await this.teamManagerBanMentionSummary(ban.teamId, guild),
      );
    });
    const managerDisplayNameByUserId = new Map<string, string>();
    if (guild) {
      await this.runLimited(
        this.uniqueStrings(relevantManagerBans.map((ban) => ban.discordUserId)),
        5,
        async (discordUserId) => {
          const member = await guild.members
            .fetch(discordUserId)
            .catch(() => null);
          const user = member?.user as
            | { globalName?: string | null; username?: string | null }
            | undefined;
          const label =
            this.cleanBanListLabel(member?.displayName) ||
            this.cleanBanListLabel(user?.globalName) ||
            this.cleanBanListLabel(user?.username);
          if (label) {
            managerDisplayNameByUserId.set(discordUserId, label);
          }
        },
      );
    }

    const permanent = relevant
      .filter((ban) => !ban.expiresAt)
      .sort((left, right) =>
        this.formatTeamSummary(left.team).localeCompare(
          this.formatTeamSummary(right.team),
        ),
      );
    const timed = relevant
      .filter((ban) => Boolean(ban.expiresAt))
      .sort(
        (left, right) =>
          new Date(left.expiresAt ?? 0).getTime() -
          new Date(right.expiresAt ?? 0).getTime(),
      );
    const ruleLines = this.parseNoShowAutoBanRulesForDiscord(config).map(
      (rule) => {
        const misses = rule.misses ?? 1;
        const trigger =
          rule.type === "MATCH_MISSED"
            ? `Match ${rule.matchNumber} missed`
            : `${misses} total miss${misses === 1 ? "" : "es"}`;
        const duration =
          rule.durationDays === null
            ? "permanent"
            : `${rule.durationDays} days`;
        return `${trigger} => ${duration} (${rule.scope})`;
      },
    );
    const lines = [
      ruleLines.length ? "```" : null,
      ...ruleLines,
      ruleLines.length ? "```" : null,
      "__**PERMANENT BAN**__",
      ...(permanent.length
        ? permanent.map((ban) =>
            this.banListTeamLine(ban, managerMentionsByTeamId.get(ban.teamId)),
          )
        : ["> No permanent bans."]),
      "",
      "**__BANNED TEAMS__**",
      ...(timed.length
        ? timed.map((ban) =>
            this.banListTeamLine(ban, managerMentionsByTeamId.get(ban.teamId)),
          )
        : ["> No timed bans."]),
      relevantManagerBans.length ? "" : null,
      relevantManagerBans.length ? "__**MANAGER BANS**__" : null,
      ...relevantManagerBans.map((ban) =>
        this.managerBanListLine(
          ban,
          managerDisplayNameByUserId.get(ban.discordUserId),
          new Set<string>(),
        ),
      ),
    ].filter((line): line is string => line !== null);
    return this.splitDiscordManagedContent(
      lines,
      this.banListMarker(sessionId),
    );
  }

  private async refreshDiscordBanListMessage(
    guild: Guild | null | undefined,
    config: SessionDiscordConfigResponse | null,
    sessionId?: string | null,
  ) {
    const channelId = config?.bansChannelId?.trim();
    if (!guild || !config || !channelId) {
      return;
    }
    try {
      const channel = await guild.channels.fetch(channelId).catch(() => null);
      if (!channel?.isTextBased() || channel.isDMBased()) {
        return;
      }
      const textChannel = channel as GuildTextBasedChannel;
      const messages = await this.buildDiscordBanListMessages(
        config,
        sessionId,
        guild,
      );
      if (!messages.length) {
        return;
      }
      const storedIds = (config.emojis?.managedBanListMessageIds ?? "")
        .split(/\s+/g)
        .map((id) => id.trim())
        .filter(Boolean);
      const nextIds: string[] = [];
      for (const [index, content] of messages.entries()) {
        const existingId = storedIds[index];
        const existing = existingId
          ? await textChannel.messages.fetch(existingId).catch(() => null)
          : null;
        if (existing && existing.author.id === guild.client.user?.id) {
          await existing.edit({
            content: limitDiscordContent(content),
            allowedMentions: allowedMentionsForOrganizerText(content),
          });
          nextIds.push(existing.id);
          continue;
        }
        const sent = await textChannel.send({
          content: limitDiscordContent(content),
          allowedMentions: allowedMentionsForOrganizerText(content),
        });
        nextIds.push(sent.id);
      }
      for (const staleId of storedIds.slice(messages.length)) {
        const stale = await textChannel.messages
          .fetch(staleId)
          .catch(() => null);
        if (stale?.author.id === guild.client.user?.id) {
          await stale.delete().catch(() => undefined);
        }
      }
      await this.persistManagedMessageIds(config.sessionId, config, {
        managedBanListMessageIds: nextIds.join("\n"),
      });
    } catch (error) {
      console.warn(
        `Discord ban list refresh failed session=${sessionId ?? config.sessionId}: ${String(
          error,
        )}`,
      );
    }
  }

  private formatNoShowBanPreview(
    response: NoShowTeamBanResponse,
    input: DiscordNoShowTeamBanCommand,
    config?: Pick<SessionDiscordConfigResponse, "emojis"> | null,
  ) {
    const lines = [
      `${this.emoji("ban", config)} No-show ban preview`,
      `Session: ${response.session.name ?? input.sessionId}`,
      `Match: ${this.noShowBanMatchLabel(response)}`,
      `Scope: ${response.scope}`,
      this.noShowBanDurationLine(input),
      `Reason: ${response.reason}`,
      "",
      `No-show teams: ${response.noShowCount}`,
      `New bans: ${response.creatableCount}`,
      `Already banned: ${response.alreadyBannedCount}`,
      "",
      ...this.formatNoShowBanTeams(response),
    ];
    return limitDiscordContent(lines.join("\n"));
  }

  async previewNoShowTeamBansFromDiscord(
    input: DiscordNoShowTeamBanCommand,
  ): Promise<{ response: NoShowTeamBanResponse; content: string }> {
    const config = await this.apiClient
      .getSessionDiscordConfig(input.sessionId)
      .catch(() => null);
    try {
      const response = await this.apiClient.previewNoShowTeamBans(
        this.noShowBanPayload(input),
      );
      return {
        response,
        content: this.formatNoShowBanPreview(response, input, config),
      };
    } catch (error) {
      throw new Error(toFriendlyApiError(error));
    }
  }

  private async resolveBanMatchIds(
    sessionId: string | null | undefined,
    matchNumbers: number[] | null | undefined,
    allMatches = false,
  ): Promise<string[]> {
    if (!sessionId) {
      throw new Error(
        `${this.emoji("reject")} Match bans must be used from a synced scrim channel.`,
      );
    }
    const matches = await this.apiClient.listSessionMatches(sessionId);
    if (allMatches) {
      if (!matches.length) {
        throw new Error(
          `${this.emoji("reject")} No matches are created for this scrim yet.`,
        );
      }
      return [...new Set(matches.map((match) => match.id))];
    }

    const numbers = [...new Set(matchNumbers ?? [])].filter(
      (value) => value > 0,
    );
    if (!numbers.length) {
      throw new Error(
        `${this.emoji("reject")} Add match numbers, for example \`matches=1,2\`.`,
      );
    }

    const ids: string[] = [];
    const missing: number[] = [];
    for (const number of numbers) {
      const match =
        matches.find((entry) => entry.matchNumber === number) ??
        matches[number - 1] ??
        null;
      if (match) {
        ids.push(match.id);
      } else {
        missing.push(number);
      }
    }

    if (missing.length > 0) {
      throw new Error(
        `${this.emoji("reject")} Match not found: ${missing
          .map((number) => `#${number}`)
          .join(", ")}`,
      );
    }
    return [...new Set(ids)];
  }

  private normalizedBanServerAction(
    value: string | null | undefined,
  ): DiscordTeamBanServerAction {
    const normalized = (value ?? "").trim().toUpperCase();
    if (normalized === "ROLE" || normalized === "DISCORD_BAN") {
      return normalized;
    }
    return "NONE";
  }

  private configuredBanServerAction(
    input: DiscordTeamBanCommand,
    config: SessionDiscordConfigResponse | null,
  ): DiscordTeamBanServerAction {
    const explicit = this.normalizedBanServerAction(input.serverAction);
    if (explicit !== "NONE") {
      return explicit;
    }
    const configured = this.normalizedBanServerAction(
      config?.emojis?.banServerAction,
    );
    if (configured !== "NONE" && input.scope !== "MATCH") {
      return configured;
    }
    if (
      input.scope === "TEAM" &&
      (config?.emojis?.banApplyRoleOnTeamBan ?? "").trim().toLowerCase() ===
        "true"
    ) {
      return "ROLE";
    }
    return "NONE";
  }

  private parseConfiguredRoleIds(value: string | null | undefined): string[] {
    const text = value?.trim();
    if (!text) {
      return [];
    }

    try {
      const parsed = JSON.parse(text) as unknown;
      if (Array.isArray(parsed)) {
        return this.uniqueRoleIds(
          parsed
            .map((entry) => (typeof entry === "string" ? entry : ""))
            .filter(Boolean),
        );
      }
    } catch {
      // Fall back to text parsing.
    }

    const roleMentions = Array.from(text.matchAll(/<@&(\d{10,25})>/g)).map(
      (match) => match[1],
    );
    const directIds = text
      .split(/[\s,;]+/g)
      .map((part) => part.trim())
      .filter((part) => /^\d{10,25}$/.test(part));
    return this.uniqueRoleIds([...roleMentions, ...directIds]);
  }

  private configuredTemporaryBanRoleIds(
    config: SessionDiscordConfigResponse | null,
  ): string[] {
    if (!config) {
      return [];
    }
    const configured = this.parseConfiguredRoleIds(config.emojis?.banRoleIds);
    return this.uniqueRoleIds([
      ...configured,
      ...(configured.length === 0 && config.bannedRoleId
        ? [config.bannedRoleId]
        : []),
    ]);
  }

  private configuredPermanentBanRoleIds(
    config: SessionDiscordConfigResponse | null,
  ): string[] {
    if (!config) {
      return [];
    }
    const configured = this.parseConfiguredRoleIds(
      config.emojis?.permanentBanRoleIds,
    );
    if (configured.length > 0) {
      return configured;
    }
    return this.configuredTemporaryBanRoleIds(config);
  }

  private configuredAllBanRoleIds(
    config: SessionDiscordConfigResponse | null,
  ): string[] {
    return this.uniqueRoleIds([
      ...this.configuredTemporaryBanRoleIds(config),
      ...this.parseConfiguredRoleIds(config?.emojis?.permanentBanRoleIds),
      ...(config?.bannedRoleId ? [config.bannedRoleId] : []),
    ]);
  }

  private configuredBanRoleNames(
    config: SessionDiscordConfigResponse | null,
  ): string[] {
    const configured = config?.bannedRoleName?.trim();
    return configured ? [configured] : [];
  }

  private async fetchGuildRoleById(guild: Guild, roleId: string) {
    const cached = guild.roles.cache.get(roleId);
    if (cached) {
      return cached;
    }
    const fetched =
      typeof guild.roles.fetch === "function"
        ? await guild.roles.fetch(roleId).catch(() => null)
        : null;
    return fetched && "id" in fetched ? (fetched as Role) : null;
  }

  private async liveGuildRolesById(guild: Guild, roleIds: string[]) {
    const roles: Role[] = [];
    for (const roleId of this.uniqueRoleIds(roleIds)) {
      const role = await this.fetchGuildRoleById(guild, roleId);
      if (role) {
        roles.push(role);
      }
    }
    return roles;
  }

  private async liveGuildRolesByName(guild: Guild, roleNames: string[]) {
    const names = this.uniqueStrings(roleNames);
    if (!names.length) {
      return [];
    }

    if (typeof guild.roles.fetch === "function") {
      await guild.roles.fetch().catch(() => null);
    }
    return names
      .map((roleName) =>
        guild.roles.cache.find((entry) => entry.name === roleName),
      )
      .filter((role): role is Role => Boolean(role));
  }

  private async configuredBanRoleForAction(
    guild: Guild,
    config: SessionDiscordConfigResponse | null,
    permanent: boolean,
  ) {
    if (!config) {
      return null;
    }

    const temporaryRoleIds = this.parseConfiguredRoleIds(
      config.emojis?.banRoleIds,
    );
    const permanentRoleIds = this.parseConfiguredRoleIds(
      config.emojis?.permanentBanRoleIds,
    );
    const requestedRoleIds = permanent ? permanentRoleIds : temporaryRoleIds;
    const alternateRoleIds = permanent ? temporaryRoleIds : permanentRoleIds;
    const fallbackRoleIds = config.bannedRoleId ? [config.bannedRoleId] : [];

    for (const roleIds of [
      requestedRoleIds,
      alternateRoleIds,
      fallbackRoleIds,
    ]) {
      const [role] = await this.liveGuildRolesById(guild, roleIds);
      if (role) {
        return role;
      }
    }

    const [role] = await this.liveGuildRolesByName(
      guild,
      this.configuredBanRoleNames(config),
    );
    return role ?? null;
  }

  private memberHasAnyRoleName(member: GuildMember, roleNames: string[]) {
    return roleNames.some((roleName) =>
      this.memberHasRoleName(member, roleName),
    );
  }

  private async configuredBanRoles(
    guild: Guild,
    config: SessionDiscordConfigResponse | null,
    permanent: boolean,
  ): Promise<Role[]> {
    const role = await this.configuredBanRoleForAction(
      guild,
      config,
      permanent,
    );
    return role ? [role] : [];
  }

  private async applyDiscordBanServerAction(
    guild: Guild | null | undefined,
    config: SessionDiscordConfigResponse | null,
    managers: DiscordManagerBanTarget[],
    action: DiscordTeamBanServerAction,
    reason: string,
    options: { permanent: boolean },
  ): Promise<string[]> {
    if (!guild || action === "NONE") {
      return [];
    }

    const activeMembers = [
      ...new Map(
        managers
          .filter((manager) => manager.discordUserId?.trim())
          .map((manager) => [manager.discordUserId, manager] as const),
      ).values(),
    ];
    if (!activeMembers.length) {
      return ["Server action: no linked Discord managers to apply."];
    }

    if (action === "ROLE") {
      const roles = await this.configuredBanRoles(
        guild,
        config,
        options.permanent,
      );
      if (!roles.length) {
        return [
          "Server action: banned roles are not configured or the bot cannot see them.",
        ];
      }

      let applied = 0;
      let failed = 0;
      for (const manager of activeMembers) {
        const guildMember = await guild.members
          .fetch(manager.discordUserId)
          .catch(() => null);
        if (!guildMember) {
          failed += 1;
          continue;
        }
        let memberFailed = false;
        for (const role of roles) {
          await guildMember.roles.add(role, reason).catch(() => {
            memberFailed = true;
          });
        }
        if (memberFailed) {
          failed += 1;
        } else {
          applied += 1;
        }
      }
      const roleNames = roles.map((role) => role.name).join(", ");
      return [
        `Server action: banned role(s) applied to ${applied}/${activeMembers.length} linked member(s)${
          failed ? `, ${failed} failed` : ""
        }${roleNames ? `: ${roleNames}` : ""}.`,
      ];
    }

    let banned = 0;
    let failed = 0;
    for (const manager of activeMembers) {
      await guild.members
        .ban(manager.discordUserId, { reason })
        .then(() => {
          banned += 1;
        })
        .catch(() => {
          failed += 1;
        });
    }
    return [
      `Server action: Discord banned ${banned}/${activeMembers.length} linked member(s)${
        failed ? `, ${failed} failed` : ""
      }.`,
    ];
  }

  private async configuredBanRolesForActiveBans(
    guild: Guild,
    config: SessionDiscordConfigResponse | null,
    bans: ManagerBanResponse[],
    sessionId: string,
  ): Promise<Role[]> {
    let needsTemporaryRoles = false;
    let needsPermanentRoles = false;
    for (const ban of bans) {
      if (ban.scope === "MATCH") {
        continue;
      }
      if (ban.scope === "SESSION" && ban.sessionId !== sessionId) {
        continue;
      }
      if (ban.expiresAt) {
        needsTemporaryRoles = true;
      } else {
        needsPermanentRoles = true;
      }
    }

    const roles: Role[] = [];
    if (needsTemporaryRoles) {
      roles.push(...(await this.configuredBanRoles(guild, config, false)));
    }
    if (needsPermanentRoles) {
      roles.push(...(await this.configuredBanRoles(guild, config, true)));
    }
    return roles.filter(
      (role, index, values) =>
        values.findIndex((entry) => entry.id === role.id) === index,
    );
  }

  private async activeManagerBansForRestore(
    discordUserId: string,
    sessionId: string,
    matchIds: Set<string>,
  ) {
    const active = await this.apiClient
      .listManagerBans({ active: true, discordUserId })
      .catch(() => [] as ManagerBanResponse[]);
    return active.filter(
      (ban) =>
        ban.scope !== "MATCH" &&
        this.managerBanAppliesToSession(ban, sessionId, matchIds),
    );
  }

  private async restoreActiveBanRolesForDiscordUsers(
    guild: Guild,
    config: SessionDiscordConfigResponse | null,
    sessionId: string,
    discordUserIds: string[],
    reason: string,
  ): Promise<ActiveBanRoleRestoreResult> {
    const result: ActiveBanRoleRestoreResult = {
      checkedManagers: 0,
      restoredRoles: 0,
      missingMembers: 0,
      failed: 0,
    };
    const targetUserIds = this.uniqueStrings(discordUserIds);
    if (!targetUserIds.length || !config) {
      return result;
    }
    if (config.guildId && config.guildId !== guild.id) {
      return result;
    }
    const action = this.configuredBanServerAction(
      {
        target: { kind: "manager", discordUserId: "" },
        scope: "SESSION",
        sessionId,
      },
      config,
    );
    if (action !== "ROLE") {
      return result;
    }

    const matches = await this.apiClient
      .listSessionMatches(sessionId)
      .catch(() => [] as SessionMatchResponse[]);
    const matchIds = new Set(matches.map((match) => match.id));

    await this.runLimited(
      targetUserIds,
      ROLE_SYNC_CONCURRENCY,
      async (discordUserId) => {
        const activeBans = await this.activeManagerBansForRestore(
          discordUserId,
          sessionId,
          matchIds,
        );
        if (!activeBans.length) {
          return;
        }
        result.checkedManagers += 1;
        const roles = await this.configuredBanRolesForActiveBans(
          guild,
          config,
          activeBans,
          sessionId,
        );
        if (!roles.length) {
          return;
        }

        const member = await guild.members
          .fetch({ user: discordUserId, force: true })
          .catch(() => guild.members.fetch(discordUserId).catch(() => null));
        if (!member) {
          result.missingMembers += 1;
          return;
        }

        const missingRoles = roles.filter(
          (role) => !member.roles.cache.has(role.id),
        );
        for (const role of missingRoles) {
          await member.roles
            .add(role, reason)
            .then(() => {
              result.restoredRoles += 1;
            })
            .catch((error) => {
              result.failed += 1;
              console.warn(
                `Active manager ban role restore failed for ${discordUserId}: ${String(
                  error,
                )}`,
              );
            });
        }
      },
    );

    return result;
  }

  private async restoreActiveBanRolesForRemovedTeams(
    guild: Guild | null | undefined,
    sessionId: string,
    teamIds: string[],
    config?: SessionDiscordConfigResponse | null,
  ): Promise<ActiveBanRoleRestoreResult> {
    const empty: ActiveBanRoleRestoreResult = {
      checkedManagers: 0,
      restoredRoles: 0,
      missingMembers: 0,
      failed: 0,
    };
    if (!guild || teamIds.length === 0) {
      return empty;
    }

    const resolvedConfig =
      config ??
      (await this.apiClient
        .getSessionDiscordConfig(sessionId)
        .catch(() => null));
    if (!resolvedConfig) {
      return empty;
    }

    const managerDiscordUserIds = new Set<string>();
    await this.runLimited(
      this.uniqueStrings(teamIds),
      ROLE_SYNC_CONCURRENCY,
      async (teamId) => {
        const members = await this.apiClient
          .listTeamMembers(teamId)
          .catch(() => [] as TeamMemberSummary[]);
        const active = members.filter((member) =>
          this.isActiveTeamMember(member),
        );
        const leaders = active.filter((member) => member.role === "LEADER");
        const selected = leaders.length ? leaders : active;
        for (const member of selected) {
          const discordUserId = member.discordUserId?.trim();
          if (discordUserId) {
            managerDiscordUserIds.add(discordUserId);
          }
        }
      },
    );

    const result = await this.restoreActiveBanRolesForDiscordUsers(
      guild,
      resolvedConfig,
      sessionId,
      [...managerDiscordUserIds],
      `Arenzyra active ban role restore ${sessionId.slice(0, 8)}`,
    );
    if (result.restoredRoles > 0 || result.failed > 0) {
      const level = result.failed > 0 ? "warn" : "log";
      console[level](
        `[DiscordBanRestore] session=${sessionId} teams=${teamIds.length} managers=${result.checkedManagers} restored=${result.restoredRoles} missing=${result.missingMembers} failed=${result.failed}`,
      );
    }
    return result;
  }

  private async configuredAllBanRoles(
    guild: Guild,
    config: SessionDiscordConfigResponse | null,
  ): Promise<Role[]> {
    const roleIds = this.uniqueRoleIds([
      ...this.parseConfiguredRoleIds(config?.emojis?.banRoleIds),
      ...this.parseConfiguredRoleIds(config?.emojis?.permanentBanRoleIds),
      config?.bannedRoleId,
    ]);
    const roles = await this.liveGuildRolesById(guild, roleIds);
    if (roles.length > 0) {
      return roles;
    }
    return this.liveGuildRolesByName(
      guild,
      this.configuredBanRoleNames(config),
    );
  }

  private managerBanAppliesToSession(
    ban: Pick<ManagerBanResponse, "scope" | "sessionId" | "matchId">,
    sessionId: string,
    matchIds: Set<string>,
  ) {
    if (ban.scope === "TEAM") {
      return true;
    }
    if (ban.scope === "SESSION") {
      return ban.sessionId === sessionId;
    }
    return Boolean(ban.matchId && matchIds.has(ban.matchId));
  }

  private inactiveManagerBanNeedsCleanup(
    ban: Pick<ManagerBanResponse, "expiresAt" | "revokedAt">,
    now = new Date(),
  ) {
    if (ban.revokedAt) {
      return true;
    }
    if (!ban.expiresAt) {
      return false;
    }
    const expiresAt = new Date(ban.expiresAt).getTime();
    return Number.isFinite(expiresAt) && expiresAt <= now.getTime();
  }

  private async memberHasActiveRelevantManagerBan(
    discordUserId: string,
    sessionId: string,
    matchIds: Set<string>,
  ) {
    const active = await this.apiClient
      .listManagerBans({ active: true, discordUserId })
      .catch(() => [] as ManagerBanResponse[]);
    return active.some((ban) =>
      this.managerBanAppliesToSession(ban, sessionId, matchIds),
    );
  }

  private async removeConfiguredBanRolesFromMember(
    guild: Guild,
    config: SessionDiscordConfigResponse,
    discordUserId: string,
    reason: string,
  ) {
    const roles = await this.configuredAllBanRoles(guild, config);
    if (!roles.length) {
      return { removed: 0, missing: false, failed: false };
    }

    const member = await guild.members
      .fetch({ user: discordUserId, force: true })
      .catch(() => guild.members.fetch(discordUserId).catch(() => null));
    if (!member) {
      return { removed: 0, missing: true, failed: false };
    }

    const roleIds = roles
      .filter((role) => member.roles.cache.has(role.id))
      .map((role) => role.id);
    if (!roleIds.length) {
      return { removed: 0, missing: false, failed: false };
    }

    await member.roles.remove(roleIds, reason).catch((error) => {
      console.warn(
        `Expired manager ban role remove failed for ${discordUserId}: ${String(
          error,
        )}`,
      );
      throw error;
    });
    return { removed: roleIds.length, missing: false, failed: false };
  }

  private async removeRevokedBanRolesFromMembers(
    guild: Guild | null | undefined,
    config: SessionDiscordConfigResponse | null,
    sessionTargets: DiscordBanSessionTarget[],
    discordUserIds: string[],
    reason: string,
  ) {
    const result = {
      checkedMembers: 0,
      removedRoles: 0,
      keptActive: 0,
      missingMembers: 0,
      failed: 0,
    };
    const targetUserIds = this.uniqueStrings(discordUserIds);
    if (!guild || !config || !targetUserIds.length) {
      return result;
    }

    const targets = sessionTargets.length
      ? sessionTargets
      : config.sessionId
        ? [{ id: config.sessionId, name: null }]
        : [];
    const seenSessionIds = new Set<string>();

    for (const target of targets) {
      if (seenSessionIds.has(target.id)) {
        continue;
      }
      seenSessionIds.add(target.id);

      const targetConfig =
        target.id === config.sessionId
          ? config
          : await this.apiClient
              .getSessionDiscordConfig(target.id)
              .catch(() => null);
      if (!targetConfig || targetConfig.guildId !== config.guildId) {
        continue;
      }

      const matches = await this.apiClient
        .listSessionMatches(target.id)
        .catch(() => [] as SessionMatchResponse[]);
      const matchIds = new Set(matches.map((match) => match.id));

      await this.runLimited(
        targetUserIds,
        ROLE_SYNC_CONCURRENCY,
        async (discordUserId) => {
          result.checkedMembers += 1;
          if (
            await this.memberHasActiveRelevantManagerBan(
              discordUserId,
              target.id,
              matchIds,
            )
          ) {
            result.keptActive += 1;
            return;
          }

          try {
            const removed = await this.removeConfiguredBanRolesFromMember(
              guild,
              targetConfig,
              discordUserId,
              reason,
            );
            result.removedRoles += removed.removed;
            if (removed.missing) {
              result.missingMembers += 1;
            }
          } catch {
            result.failed += 1;
          }
        },
      );
    }

    return result;
  }

  private async refreshDiscordBanListsForSessionTargets(
    guild: Guild | null | undefined,
    config: SessionDiscordConfigResponse | null,
    sessionTargets: DiscordBanSessionTarget[],
    fallbackSessionId?: string | null,
  ) {
    const sessionIds = this.uniqueStrings(
      sessionTargets.length
        ? sessionTargets.map((session) => session.id)
        : [fallbackSessionId ?? config?.sessionId],
    );
    if (!sessionIds.length) {
      return;
    }

    await this.runLimited(
      sessionIds,
      ROLE_SYNC_CONCURRENCY,
      async (sessionId) => {
        const targetConfig =
          config?.sessionId === sessionId
            ? config
            : await this.apiClient
                .getSessionDiscordConfig(sessionId)
                .catch(() => null);
        await this.refreshDiscordBanListMessage(guild, targetConfig, sessionId);
      },
    );
  }

  private simpleBanManagersLabel(
    managers: DiscordManagerBanTarget[] = [],
    mentionableIds = new Set<string>(),
  ) {
    if (!managers.length) {
      return "Not linked";
    }
    return managers
      .slice(0, 8)
      .map((manager) => this.banChannelManagerLabel(manager, mentionableIds))
      .join(", ");
  }

  private simpleBanDurationLabel(
    days: number | null | undefined,
    expiresAt?: string | null,
  ) {
    if (days && Number.isFinite(days) && days > 0) {
      return `${Math.ceil(days)} day(s)`;
    }
    if (expiresAt) {
      const expires = Date.parse(expiresAt);
      if (Number.isFinite(expires)) {
        return `Until <t:${Math.floor(expires / 1000)}:R>`;
      }
    }
    return "Permanent";
  }

  private simpleBanScopeLabel(
    scope: TeamBanScope | null | undefined,
    sessionTargets: DiscordBanSessionTarget[] = [],
    sessionName?: string | null,
    matchLabel?: string | null,
  ) {
    if (scope === "TEAM") {
      return "All sessions";
    }
    if (scope === "MATCH") {
      return matchLabel?.trim()
        ? `This match (${matchLabel.trim()})`
        : "Selected match(es)";
    }
    if (scope === "SESSION") {
      if (sessionTargets.length > 1) {
        return `Selected sessions: ${this.formatBanSessionTargets(
          sessionTargets,
        )}`;
      }
      const label =
        sessionTargets[0]?.name?.trim() ||
        sessionName?.trim() ||
        sessionTargets[0]?.id;
      return label ? `This session (${label})` : "This session";
    }
    return "All active bans";
  }

  private async sendDiscordBanChannelContent(
    guild: Guild | null | undefined,
    config: Pick<SessionDiscordConfigResponse, "bansChannelId"> | null,
    content: string,
  ) {
    const channelId = config?.bansChannelId?.trim();
    if (!guild || !channelId) {
      return;
    }
    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased() || channel.isDMBased()) {
      return;
    }

    await (channel as GuildTextBasedChannel)
      .send({
        content: limitDiscordContent(content),
        allowedMentions: allowedMentionsForOrganizerText(content),
      })
      .catch((error) => {
        console.warn(`Discord ban channel notice failed: ${String(error)}`);
      });
  }

  private async sendDiscordBanChannelNotice(
    guild: Guild | null | undefined,
    config: Pick<SessionDiscordConfigResponse, "bansChannelId"> | null,
    params: DiscordBanChannelNoticeParams,
  ) {
    const mentionableIds = await this.validatedManagerMentionIds(
      guild,
      (params.managers ?? []).map((manager) => manager.discordUserId),
    );
    const lines = [
      `**${params.title}**`,
      params.team ? `Team: ${this.formatTeamSummary(params.team)}` : null,
      `Manager${(params.managers?.length ?? 0) === 1 ? "" : "s"}: ${this.simpleBanManagersLabel(
        params.managers,
        mentionableIds,
      )}`,
      params.duration ? `Duration: ${params.duration}` : null,
      `Scope: ${this.simpleBanScopeLabel(
        params.scope,
        params.sessionTargets ?? [],
        params.sessionName,
        params.matchLabel,
      )}`,
      `Reason: ${params.reason?.trim() || "No reason provided"}`,
      params.status ? `Status: ${params.status}` : null,
    ].filter((line): line is string => Boolean(line));

    await this.sendDiscordBanChannelContent(guild, config, lines.join("\n"));
  }

  private async sendDiscordNoShowBanChannelNotice(
    guild: Guild | null | undefined,
    config: Pick<SessionDiscordConfigResponse, "bansChannelId"> | null,
    params: DiscordNoShowBanChannelNoticeParams,
  ) {
    const mentionableIds = await this.validatedManagerMentionIds(
      guild,
      params.response.teams.flatMap((entry) =>
        (entry.managers ?? []).map((manager) => manager.discordUserId),
      ),
    );
    const createdTeamIds = new Set(
      params.response.createdBans.map((ban) => ban.teamId).filter(Boolean),
    );
    const teams = params.response.teams.filter((entry) =>
      createdTeamIds.has(entry.teamId),
    );
    const teamLines = teams.length
      ? teams.slice(0, 10).map((entry) => {
          const managers = this.simpleBanManagersLabel(
            (entry.managers ?? []).map((manager) => ({
              discordUserId: manager.discordUserId,
              discordUsername: manager.discordUsername ?? null,
              displayName: manager.displayName ?? null,
            })),
            mentionableIds,
          );
          return `- ${this.formatTeamSummary(entry.team)} | Manager${
            (entry.managers?.length ?? 0) === 1 ? "" : "s"
          }: ${managers}`;
        })
      : ["- none"];
    if (teams.length > 10) {
      teamLines.push(`- +${teams.length - 10} more`);
    }

    await this.sendDiscordBanChannelContent(
      guild,
      config,
      [
        "**No-show team bans saved**",
        `Duration: ${this.simpleBanDurationLabel(
          params.input.days,
          params.response.expiresAt,
        )}`,
        `Scope: ${this.simpleBanScopeLabel(
          params.response.scope,
          [],
          params.sessionName ??
            params.response.session.name ??
            params.input.sessionId,
          this.noShowBanMatchLabel(params.response),
        )}`,
        `Reason: ${params.response.reason || "No reason provided"}`,
        `Created: ${params.response.createdCount}`,
        "Teams:",
        ...teamLines,
      ].join("\n"),
    );
  }

  async previewTeamBanFromDiscord(
    input: DiscordTeamBanCommand,
  ): Promise<DiscordTeamBanPreview> {
    const { team, managers } = await this.resolveManagersForDiscordBanTarget(
      input.target,
      input.sessionId,
    );
    const config = input.sessionId
      ? await this.apiClient
          .getSessionDiscordConfig(input.sessionId)
          .catch(() => null)
      : null;
    const matchIds =
      input.scope === "MATCH"
        ? await this.resolveBanMatchIds(
            input.sessionId,
            input.matchNumbers,
            input.allMatches,
          )
        : [];
    const sessionTargets =
      input.scope === "SESSION"
        ? await this.resolveDiscordBanSessionTargets(input, config)
        : [];
    const activeBans = (
      await Promise.all(
        managers.map((manager) =>
          this.apiClient
            .listManagerBans({
              active: true,
              discordUserId: manager.discordUserId,
            })
            .catch(() => [] as ManagerBanResponse[]),
        ),
      )
    ).flat();
    const reason = input.reason?.trim() || "Manual Discord ban";
    const normalizedCommand: DiscordTeamBanCommand = {
      ...input,
      reason,
      note: input.note?.trim() || "Created from Discord ban control",
      matchNumbers: input.matchNumbers ?? [],
      allMatches: input.scope === "MATCH" ? Boolean(input.allMatches) : false,
      sessionIds:
        input.scope === "SESSION" && sessionTargets.length
          ? sessionTargets.map((session) => session.id)
          : input.sessionIds,
    };
    const duration = input.days
      ? `${Math.ceil(input.days)} day(s)`
      : "permanent";
    const target =
      input.scope === "MATCH"
        ? input.allMatches
          ? `All matches (${matchIds.length})`
          : `${matchIds.length} selected match(es)`
        : input.scope === "SESSION"
          ? this.formatBanSessionTargets(sessionTargets)
          : "All Discord scrims";
    const serverAction = this.configuredBanServerAction(
      normalizedCommand,
      config,
    );
    const lines = [
      `${this.emoji("ban", config)} Manager ban preview`,
      team ? `Team: ${this.formatTeamSummary(team)}` : null,
      `Manager(s): ${managers
        .map((manager) => this.managerBanTargetLabel(manager))
        .join(", ")}`,
      `Scope: ${input.scope}`,
      `Target: ${target}`,
      `Duration: ${duration}`,
      `Reason: ${reason}`,
      serverAction === "NONE"
        ? null
        : `Server action: ${
            serverAction === "ROLE" ? "add banned role" : "Discord server ban"
          }`,
      activeBans.length ? `Existing active bans: ${activeBans.length}` : null,
      "",
      "Confirm only if this is the intended team and scope.",
    ].filter((line): line is string => line !== null);

    return {
      team,
      managers,
      command: normalizedCommand,
      content: limitDiscordContent(lines.join("\n")),
      activeBanCount: activeBans.length,
    };
  }

  async createTeamBanFromDiscord(
    input: DiscordTeamBanCommand,
    guild?: Guild | null,
    audit: DiscordActionAuditContext = {},
  ): Promise<string> {
    const { team, managers } = await this.resolveManagersForDiscordBanTarget(
      input.target,
      input.sessionId,
    );
    const config = input.sessionId
      ? await this.apiClient
          .getSessionDiscordConfig(input.sessionId)
          .catch(() => null)
      : null;
    const reason = input.reason?.trim() || "Manual Discord ban";
    const matchIds =
      input.scope === "MATCH"
        ? await this.resolveBanMatchIds(
            input.sessionId,
            input.matchNumbers,
            input.allMatches,
          )
        : [];
    const sessionTargets =
      input.scope === "SESSION"
        ? await this.resolveDiscordBanSessionTargets(input, config)
        : [];
    const serverAction = this.configuredBanServerAction(input, config);
    const expiresAt = this.banExpiresAt(input.days);

    try {
      const created: ManagerBanResponse[] = [];
      const sessionCreateTargets =
        input.scope === "SESSION"
          ? sessionTargets
          : ([null] as Array<DiscordBanSessionTarget | null>);
      let skippedDuplicates = 0;

      for (const sessionTarget of sessionCreateTargets) {
        try {
          const records = await this.apiClient.createManagerBan({
            teamId: team?.id ?? undefined,
            discordUserIds: team
              ? undefined
              : managers.map((manager) => manager.discordUserId),
            discordUserId: team ? undefined : managers[0]?.discordUserId,
            discordUsername: team ? undefined : managers[0]?.discordUsername,
            displayName: team ? undefined : managers[0]?.displayName,
            scope: input.scope,
            sessionId:
              input.scope === "SESSION" ? (sessionTarget?.id ?? null) : null,
            matchIds: input.scope === "MATCH" ? matchIds : undefined,
            reason,
            note: input.note?.trim() || "Created from Discord command",
            expiresAt,
          });
          created.push(...records);
        } catch (error) {
          if (
            sessionCreateTargets.length > 1 &&
            /already exists/i.test(toFriendlyApiError(error))
          ) {
            skippedDuplicates += 1;
            continue;
          }
          throw error;
        }
      }

      const syncSessionIds =
        input.scope === "SESSION"
          ? sessionTargets.map((session) => session.id)
          : input.sessionId
            ? [input.sessionId]
            : [];
      if (guild && input.scope !== "MATCH" && team) {
        await this.runLimited(
          syncSessionIds,
          ROLE_SYNC_CONCURRENCY,
          async (sessionId) => {
            await this.syncDiscordScrimState(guild, sessionId, {
              removedTeamIds: [team.id],
            }).catch((error) => {
              console.warn(
                `Discord state sync after team ban failed: ${toFriendlyApiError(error)}`,
              );
            });
          },
        );
      }

      const serverActionDetails = await this.applyDiscordBanServerAction(
        guild,
        config,
        managers,
        serverAction,
        reason,
        { permanent: !expiresAt },
      );

      const targetLines = created.length
        ? created.map(
            (ban) => `- ${ban.scope}: ${this.teamBanTargetSummary(ban)}`,
          )
        : ["- No new ban was created. Existing active bans were skipped."];
      if (skippedDuplicates > 0) {
        targetLines.push(
          `- ${skippedDuplicates} selected scrim(s) already had an active ban.`,
        );
      }
      await this.sendDiscordActionLog(guild, config, {
        action: "Manager ban saved",
        actorDiscordId: audit.actorDiscordId,
        actorLabel: audit.actorLabel,
        sourceChannelId: audit.sourceChannelId,
        sessionId: input.sessionId,
        sessionName: audit.sessionName,
        team: team ?? {
          name: managers
            .map((manager) => this.managerBanTargetLabel(manager))
            .join(", "),
          tag: null,
        },
        status: created.length
          ? `${created.length} active ban(s)`
          : "already banned",
        reason,
        details: [
          `Scope: ${input.scope}`,
          `Manager: ${managers
            .map((manager) => this.managerBanTargetLabel(manager))
            .join(", ")}`,
          input.days
            ? `Duration: ${Math.ceil(input.days)} day(s)`
            : "Duration: permanent",
          ...targetLines,
          ...serverActionDetails,
        ],
        color: 0xef4444,
      });
      await this.refreshDiscordBanListsForSessionTargets(
        guild,
        config,
        sessionTargets,
        input.sessionId,
      );
      await this.sendDiscordBanChannelNotice(guild, config, {
        title: "Manager ban saved",
        team,
        managers,
        scope: input.scope,
        sessionTargets,
        sessionName: audit.sessionName,
        duration: this.simpleBanDurationLabel(input.days, expiresAt),
        reason,
        status: created.length
          ? `${created.length} active ban(s)`
          : "already banned",
      });
      return [
        `${this.emoji("ban", config)} Manager ban saved${
          team ? ` for ${this.formatTeamSummary(team)}` : ""
        }`,
        `Manager: ${managers
          .map((manager) => this.managerBanTargetLabel(manager))
          .join(", ")}`,
        `Reason: ${reason}`,
        input.days
          ? `Duration: ${Math.ceil(input.days)} day(s)`
          : "Duration: permanent",
        ...serverActionDetails,
        "",
        ...targetLines,
      ].join("\n");
    } catch (error) {
      throw new Error(toFriendlyApiError(error));
    }
  }

  async createNoShowTeamBansFromDiscord(
    input: DiscordNoShowTeamBanCommand,
    guild?: Guild | null,
    audit: DiscordActionAuditContext = {},
  ): Promise<string> {
    const config = await this.apiClient
      .getSessionDiscordConfig(input.sessionId)
      .catch(() => null);
    try {
      const expiresAt = this.banExpiresAt(input.days);
      const response = await this.apiClient.createNoShowTeamBans(
        this.noShowBanPayload(input),
      );
      const createdTeamIds = response.createdBans.map((ban) => ban.teamId);
      const createdManagerTargets = this.noShowCreatedManagerTargets(response);
      const createdManagerIds = createdManagerTargets.map(
        (target) => target.discordUserId,
      );
      if (guild && input.scope !== "MATCH" && createdTeamIds.length > 0) {
        this.syncDiscordScrimStateInBackground(guild, input.sessionId, {
          organizationId: config?.organizationId,
          removedTeamIds: createdTeamIds,
          extraDiscordUserIds: createdManagerIds,
          cleanupTeamIds: createdTeamIds,
          fastMessageRefresh: true,
          skipFullSync: true,
          delayMs: 0,
        });
        this.reconcileScrimRolesInBackground(guild, input.sessionId);
      }

      const serverActionDetails = await this.applyDiscordBanServerAction(
        guild,
        config,
        createdManagerTargets,
        this.configuredBanServerAction(
          {
            target: { kind: "manager", discordUserId: "" },
            scope: input.scope,
            sessionId: input.sessionId,
          },
          config,
        ),
        response.reason,
        { permanent: !expiresAt },
      );
      await this.refreshDiscordBanListMessage(guild, config, input.sessionId);

      await this.sendDiscordActionLog(guild, config, {
        action: "No-show team bans saved",
        actorDiscordId: audit.actorDiscordId,
        actorLabel: audit.actorLabel,
        sourceChannelId: audit.sourceChannelId,
        sessionId: input.sessionId,
        sessionName: audit.sessionName ?? response.session.name ?? null,
        status: `${response.createdCount} ban(s) created`,
        reason: response.reason,
        details: [
          `Match: ${this.noShowBanMatchLabel(response)}`,
          `Scope: ${response.scope}`,
          this.noShowBanDurationLine(input),
          `No-show teams: ${response.noShowCount}`,
          `Already banned: ${response.alreadyBannedCount}`,
          `Manager bans: ${response.createdManagerBans ?? 0}`,
          ...serverActionDetails,
          ...this.formatNoShowBanTeams(response, true),
        ],
        color: 0xef4444,
      });
      await this.sendDiscordNoShowBanChannelNotice(guild, config, {
        response,
        input,
        sessionName: audit.sessionName,
      });

      return [
        `${this.emoji("ban", config)} No-show bans completed.`,
        `Session: ${response.session.name ?? input.sessionId}`,
        `Match: ${this.noShowBanMatchLabel(response)}`,
        `Scope: ${response.scope}`,
        this.noShowBanDurationLine(input),
        `Reason: ${response.reason}`,
        "",
        `Created: ${response.createdCount}`,
        `Manager bans: ${response.createdManagerBans ?? 0}`,
        ...serverActionDetails,
        `Already banned: ${response.alreadyBannedCount}`,
        "",
        ...this.formatNoShowBanTeams(response, true),
      ].join("\n");
    } catch (error) {
      throw new Error(toFriendlyApiError(error));
    }
  }

  async revokeTeamBansFromDiscord(
    input: DiscordTeamUnbanCommand,
    guild?: Guild | null,
    audit: DiscordActionAuditContext = {},
  ): Promise<string> {
    const { team, managers } = await this.resolveManagersForDiscordBanTarget(
      input.target,
      input.sessionId,
    );
    const config = input.sessionId
      ? await this.apiClient
          .getSessionDiscordConfig(input.sessionId)
          .catch(() => null)
      : null;
    const sessionTargets =
      input.scope === "SESSION"
        ? await this.resolveDiscordBanSessionTargets(input, config)
        : [];

    try {
      let bans = (
        await Promise.all(
          managers.map((manager) =>
            this.apiClient.listManagerBans({
              active: true,
              discordUserId: manager.discordUserId,
            }),
          ),
        )
      ).flat();
      if (input.scope) {
        bans = bans.filter((ban) => ban.scope === input.scope);
      }
      if (input.scope === "SESSION" && input.sessionId) {
        const targetSessionIds = new Set(
          sessionTargets.length
            ? sessionTargets.map((session) => session.id)
            : [input.sessionId],
        );
        bans = bans.filter(
          (ban) => ban.sessionId && targetSessionIds.has(ban.sessionId),
        );
      }
      if (input.scope === "MATCH") {
        const matchIds = await this.resolveBanMatchIds(
          input.sessionId,
          input.matchNumbers,
          input.allMatches,
        );
        const matchIdSet = new Set(matchIds);
        bans = bans.filter((ban) => ban.matchId && matchIdSet.has(ban.matchId));
      }

      if (!bans.length) {
        return `${this.emoji("reject", config)} No active manager ban found for ${
          team
            ? this.formatTeamSummary(team)
            : managers
                .map((manager) => this.managerBanTargetLabel(manager))
                .join(", ")
        }.`;
      }

      const reason = input.reason?.trim() || "Revoked from Discord command";
      await Promise.all(
        bans.map((ban) => this.apiClient.revokeManagerBan(ban.id, { reason })),
      );
      const affectedDiscordUserIds = this.uniqueStrings(
        bans.map((ban) => ban.discordUserId),
      );
      const roleCleanup = await this.removeRevokedBanRolesFromMembers(
        guild,
        config,
        sessionTargets,
        affectedDiscordUserIds,
        `Arenzyra manager ban revoked ${input.sessionId ?? ""}`.trim(),
      );
      if (guild && input.sessionId) {
        void this.syncDiscordScrimState(guild, input.sessionId).catch(
          (error) => {
            console.warn(
              `Discord state sync after team unban failed: ${toFriendlyApiError(error)}`,
            );
          },
        );
      }

      const roleCleanupDetails =
        roleCleanup.checkedMembers > 0
          ? [
              `Banned role(s) removed: ${roleCleanup.removedRoles}`,
              `Kept because another active ban exists: ${roleCleanup.keptActive}`,
              roleCleanup.missingMembers
                ? `Managers no longer in server: ${roleCleanup.missingMembers}`
                : null,
              roleCleanup.failed
                ? `Role remove failures: ${roleCleanup.failed}`
                : null,
            ].filter((line): line is string => Boolean(line))
          : [];

      await this.sendDiscordActionLog(guild, config, {
        action: "Manager ban revoked",
        actorDiscordId: audit.actorDiscordId,
        actorLabel: audit.actorLabel,
        sourceChannelId: audit.sourceChannelId,
        sessionId: input.sessionId,
        sessionName: audit.sessionName,
        team: team ?? {
          name: managers
            .map((manager) => this.managerBanTargetLabel(manager))
            .join(", "),
          tag: null,
        },
        status: `${bans.length} ban(s) revoked`,
        reason,
        details: [
          `Manager: ${managers
            .map((manager) => this.managerBanTargetLabel(manager))
            .join(", ")}`,
          input.scope === "SESSION" && sessionTargets.length
            ? `Sessions: ${this.formatBanSessionTargets(sessionTargets)}`
            : null,
          ...roleCleanupDetails,
        ].filter((line): line is string => Boolean(line)),
        color: 0x22c55e,
      });
      await this.refreshDiscordBanListsForSessionTargets(
        guild,
        config,
        sessionTargets,
        input.sessionId,
      );
      await this.sendDiscordBanChannelNotice(guild, config, {
        title: "Manager ban revoked",
        team,
        managers,
        scope: input.scope,
        sessionTargets,
        sessionName: audit.sessionName,
        duration: "Revoked now",
        reason,
        status: `${bans.length} ban(s) revoked`,
      });
      return [
        `${this.emoji("check", config)} Revoked ${bans.length} active manager ban(s)${
          team ? ` for ${this.formatTeamSummary(team)}` : ""
        }.`,
        `Manager: ${managers
          .map((manager) => this.managerBanTargetLabel(manager))
          .join(", ")}`,
        `Reason: ${reason}`,
        roleCleanup.checkedMembers > 0
          ? `Banned role(s) removed: ${roleCleanup.removedRoles}`
          : null,
      ]
        .filter((line): line is string => Boolean(line))
        .join("\n");
    } catch (error) {
      throw new Error(toFriendlyApiError(error));
    }
  }

  async listTeamBansForDiscord(sessionId?: string | null): Promise<string> {
    try {
      const [bans, managerBans, config, matches] = await Promise.all([
        this.apiClient.listTeamBans({ active: true }),
        this.apiClient.listManagerBans({ active: true }).catch(() => []),
        sessionId
          ? this.apiClient.getSessionDiscordConfig(sessionId).catch(() => null)
          : Promise.resolve(null),
        sessionId
          ? this.apiClient
              .listSessionMatches(sessionId)
              .catch(() => [] as SessionMatchResponse[])
          : Promise.resolve([] as SessionMatchResponse[]),
      ]);
      const matchIds = new Set(matches.map((match) => match.id));
      const relevant = sessionId
        ? bans.filter(
            (ban) =>
              ban.scope === "TEAM" ||
              ban.sessionId === sessionId ||
              Boolean(ban.matchId && matchIds.has(ban.matchId)),
          )
        : bans;
      const relevantManagerBans = sessionId
        ? managerBans.filter(
            (ban) =>
              ban.scope === "TEAM" ||
              ban.sessionId === sessionId ||
              Boolean(ban.matchId && matchIds.has(ban.matchId)),
          )
        : managerBans;

      if (!relevant.length && !relevantManagerBans.length) {
        return `${this.emoji("check", config)} No active team or manager bans.`;
      }

      const lines = [
        `${this.emoji("ban", config)} Active bans (${relevant.length} team, ${relevantManagerBans.length} manager)`,
        "",
      ];
      for (const ban of relevantManagerBans.slice(0, 15)) {
        lines.push(
          `- Manager ${this.managerBanTargetLabel(ban)} | ${ban.scope} | ${this.teamBanTargetSummary(
            ban,
          )} | ${ban.expiresAt ? `Expires ${new Date(ban.expiresAt).toLocaleString()}` : "Permanent"}`,
        );
      }
      for (const ban of relevant.slice(0, 15)) {
        const manager = await this.teamManagerSummary(ban.teamId);
        lines.push(
          `- ${this.formatTeamSummary(ban.team)} | ${ban.scope} | ${this.teamBanTargetSummary(
            ban,
          )} | Manager: ${manager} | ${ban.expiresAt ? `Expires ${new Date(ban.expiresAt).toLocaleString()}` : "Permanent"}`,
        );
      }
      const hidden =
        Math.max(0, relevantManagerBans.length - 15) +
        Math.max(0, relevant.length - 15);
      if (hidden > 0) {
        lines.push(`...and ${hidden} more.`);
      }
      return lines.join("\n");
    } catch (error) {
      throw new Error(toFriendlyApiError(error));
    }
  }

  private banAppliesToSession(
    ban: Pick<
      TeamBanResponse | ManagerBanResponse,
      "scope" | "sessionId" | "matchId"
    >,
    sessionId: string,
    matchIds: Set<string>,
  ) {
    if (ban.scope === "TEAM") {
      return true;
    }
    if (ban.scope === "SESSION") {
      return ban.sessionId === sessionId;
    }
    return Boolean(ban.matchId && matchIds.has(ban.matchId));
  }

  private resultControlManagerFromBan(
    ban: ManagerBanResponse,
  ): DiscordResultControlBanManager {
    return {
      discordUserId: ban.discordUserId,
      discordUsername: ban.discordUsername,
      displayName: ban.displayName,
      activeBanIds: [ban.id],
    };
  }

  private mergeResultControlManager(
    managers: Map<string, DiscordResultControlBanManager>,
    manager: DiscordResultControlBanManager,
  ) {
    const existing = managers.get(manager.discordUserId);
    if (!existing) {
      managers.set(manager.discordUserId, {
        ...manager,
        activeBanIds: this.uniqueStrings(manager.activeBanIds),
      });
      return;
    }
    existing.discordUsername =
      existing.discordUsername ?? manager.discordUsername ?? null;
    existing.displayName = existing.displayName ?? manager.displayName ?? null;
    existing.activeBanIds = this.uniqueStrings([
      ...existing.activeBanIds,
      ...manager.activeBanIds,
    ]);
  }

  private resultControlExpiresAt(values: Array<string | null | undefined>) {
    const cleaned = values.filter((value): value is string => Boolean(value));
    if (cleaned.length !== values.length) {
      return null;
    }
    const timestamps = cleaned
      .map((value) => Date.parse(value))
      .filter((value) => Number.isFinite(value));
    if (!timestamps.length) {
      return null;
    }
    return new Date(Math.min(...timestamps)).toISOString();
  }

  async getResultControlStateForDiscord(
    sessionId: string,
  ): Promise<DiscordResultControlState> {
    try {
      const [session, matches, allTeamBans, allManagerBans, registrations] =
        await Promise.all([
          this.apiClient.getSession(sessionId),
          this.apiClient
            .listSessionMatches(sessionId)
            .catch(() => [] as SessionMatchResponse[]),
          this.apiClient.listTeamBans({ active: true }),
          this.apiClient.listManagerBans({ active: true }).catch(() => []),
          this.apiClient
            .listRegistrations(sessionId)
            .catch(() => [] as SessionRegistrationResponse[]),
        ]);
      const matchIds = new Set(matches.map((match) => match.id));
      const teamBans = allTeamBans.filter((ban) =>
        this.banAppliesToSession(ban, sessionId, matchIds),
      );
      const managerBans = allManagerBans.filter((ban) =>
        this.banAppliesToSession(ban, sessionId, matchIds),
      );

      type TeamInfo = {
        id: string;
        name: string;
        tag: string | null;
        logoUrl?: string | null;
      };
      type MutableTeamTarget = {
        kind: "team";
        team: TeamInfo;
        teamBanIds: Set<string>;
        managerBanIds: Set<string>;
        managers: Map<string, DiscordResultControlBanManager>;
        scopeLabels: Set<string>;
        expiresAt: Array<string | null>;
      };

      const teams = new Map<string, TeamInfo>();
      const managerToTeamIds = new Map<string, Set<string>>();
      const registrationManagersByTeamId = new Map<
        string,
        Map<string, DiscordResultControlBanManager>
      >();

      const addTeam = (team: TeamInfo | null | undefined) => {
        if (!team?.id) {
          return null;
        }
        const existing = teams.get(team.id);
        const next = {
          id: team.id,
          name: team.name?.trim() || existing?.name || team.id,
          tag: team.tag ?? existing?.tag ?? null,
          logoUrl: team.logoUrl ?? existing?.logoUrl ?? null,
        };
        teams.set(team.id, next);
        return next;
      };
      const addManagerTeamLink = (
        discordUserId: string | null | undefined,
        teamId: string,
      ) => {
        const cleanDiscordUserId = discordUserId?.trim();
        if (!cleanDiscordUserId) {
          return;
        }
        const teamIds = managerToTeamIds.get(cleanDiscordUserId) ?? new Set();
        teamIds.add(teamId);
        managerToTeamIds.set(cleanDiscordUserId, teamIds);
      };
      const addRegistrationManager = (
        teamId: string,
        manager: DiscordResultControlBanManager,
      ) => {
        const managers =
          registrationManagersByTeamId.get(teamId) ??
          new Map<string, DiscordResultControlBanManager>();
        this.mergeResultControlManager(managers, manager);
        registrationManagersByTeamId.set(teamId, managers);
        addManagerTeamLink(manager.discordUserId, teamId);
      };

      for (const registration of registrations.filter((entry) =>
        this.activeRegistrationStatus(entry),
      )) {
        addTeam(registration.team);
        const managerIds = this.uniqueStrings([
          registration.leaderDiscordUserId,
          ...(registration.managerDiscordUserIds ?? []),
        ]);
        for (const discordUserId of managerIds) {
          addRegistrationManager(registration.teamId, {
            discordUserId,
            discordUsername: null,
            displayName: null,
            activeBanIds: [],
          });
        }
      }

      const managerDiscordUserIds = this.uniqueStrings(
        managerBans.map((ban) => ban.discordUserId),
      );
      if (managerDiscordUserIds.length) {
        const managedTeams = await this.apiClient
          .listDiscordManagedTeams(managerDiscordUserIds, 200)
          .catch(() => [] as DiscordManagedTeamResponse[]);
        for (const entry of managedTeams) {
          const team = addTeam(entry.team);
          if (!team) {
            continue;
          }
          for (const manager of entry.managers ?? []) {
            if (!manager.discordUserId) {
              continue;
            }
            addRegistrationManager(team.id, {
              discordUserId: manager.discordUserId,
              discordUsername: manager.discordUsername,
              displayName: manager.displayName,
              activeBanIds: [],
            });
          }
        }
      }

      const teamTargets = new Map<string, MutableTeamTarget>();
      const getTeamTarget = (team: TeamInfo) => {
        const existing = teamTargets.get(team.id);
        if (existing) {
          return existing;
        }
        const target: MutableTeamTarget = {
          kind: "team",
          team,
          teamBanIds: new Set(),
          managerBanIds: new Set(),
          managers: new Map(),
          scopeLabels: new Set(),
          expiresAt: [],
        };
        for (const manager of registrationManagersByTeamId
          .get(team.id)
          ?.values() ?? []) {
          this.mergeResultControlManager(target.managers, manager);
        }
        teamTargets.set(team.id, target);
        return target;
      };

      for (const ban of teamBans) {
        const team = addTeam(
          ban.team
            ? {
                id: ban.team.id,
                name: ban.team.name,
                tag: ban.team.tag,
                logoUrl: ban.team.logoUrl,
              }
            : {
                id: ban.teamId,
                name: ban.teamId,
                tag: null,
                logoUrl: null,
              },
        );
        if (!team) {
          continue;
        }
        const target = getTeamTarget(team);
        target.teamBanIds.add(ban.id);
        target.scopeLabels.add(this.teamBanTargetSummary(ban));
        target.expiresAt.push(ban.expiresAt);
      }

      const managerOnlyTargets = new Map<
        string,
        {
          kind: "manager";
          manager: DiscordResultControlBanManager;
          managerBanIds: Set<string>;
          scopeLabels: Set<string>;
          expiresAt: Array<string | null>;
        }
      >();

      for (const ban of managerBans) {
        const manager = this.resultControlManagerFromBan(ban);
        const teamIds = managerToTeamIds.get(ban.discordUserId);
        if (teamIds?.size) {
          for (const teamId of teamIds) {
            const team = teams.get(teamId);
            if (!team) {
              continue;
            }
            const target = getTeamTarget(team);
            target.managerBanIds.add(ban.id);
            target.scopeLabels.add(this.teamBanTargetSummary(ban));
            target.expiresAt.push(ban.expiresAt);
            this.mergeResultControlManager(target.managers, manager);
          }
          continue;
        }

        const existing = managerOnlyTargets.get(ban.discordUserId);
        if (existing) {
          existing.managerBanIds.add(ban.id);
          existing.scopeLabels.add(this.teamBanTargetSummary(ban));
          existing.expiresAt.push(ban.expiresAt);
          this.mergeResultControlManager(
            new Map([[existing.manager.discordUserId, existing.manager]]),
            manager,
          );
        } else {
          managerOnlyTargets.set(ban.discordUserId, {
            kind: "manager",
            manager,
            managerBanIds: new Set([ban.id]),
            scopeLabels: new Set([this.teamBanTargetSummary(ban)]),
            expiresAt: [ban.expiresAt],
          });
        }
      }

      for (const target of teamTargets.values()) {
        if (target.managers.size) {
          continue;
        }
        const managers = await this.resolveManagersForDiscordBanTarget(
          { kind: "team-id", teamId: target.team.id, label: target.team.name },
          sessionId,
        ).catch(() => null);
        for (const manager of managers?.managers ?? []) {
          this.mergeResultControlManager(target.managers, {
            ...manager,
            activeBanIds: [],
          });
        }
      }

      const targets: DiscordResultControlBanTarget[] = [
        ...[...teamTargets.values()].map((target) => {
          const managerBanIds = this.uniqueStrings([
            ...target.managerBanIds,
            ...[...target.managers.values()].flatMap(
              (manager) => manager.activeBanIds,
            ),
          ]);
          return {
            kind: "team" as const,
            value: `team:${target.team.id}`,
            teamId: target.team.id,
            teamName: target.team.name,
            teamTag: target.team.tag,
            teamBanIds: [...target.teamBanIds],
            managerBanIds,
            managers: [...target.managers.values()],
            scopeLabels: [...target.scopeLabels],
            expiresAt: this.resultControlExpiresAt(target.expiresAt),
          };
        }),
        ...[...managerOnlyTargets.values()].map((target) => ({
          kind: "manager" as const,
          value: `manager:${target.manager.discordUserId}`,
          discordUserId: target.manager.discordUserId,
          managerBanIds: [...target.managerBanIds],
          managers: [
            {
              ...target.manager,
              activeBanIds: [...target.managerBanIds],
            },
          ],
          scopeLabels: [...target.scopeLabels],
          expiresAt: this.resultControlExpiresAt(target.expiresAt),
        })),
      ].sort((left, right) => {
        const leftLabel =
          left.kind === "team"
            ? this.formatTeamSummary({
                id: left.teamId,
                name: left.teamName,
                tag: left.teamTag,
              })
            : this.managerBanTargetLabel(left.managers[0]);
        const rightLabel =
          right.kind === "team"
            ? this.formatTeamSummary({
                id: right.teamId,
                name: right.teamName,
                tag: right.teamTag,
              })
            : this.managerBanTargetLabel(right.managers[0]);
        return leftLabel.localeCompare(rightLabel);
      });

      const latestMatch = [...matches].sort(
        (left, right) => this.matchSortTime(right) - this.matchSortTime(left),
      )[0];

      return {
        sessionId,
        sessionName: session.name,
        matchCount: matches.length,
        latestMatchLabel: latestMatch
          ? this.formatSessionMatch(latestMatch)
          : null,
        activeTeamBanCount: teamBans.length,
        activeManagerBanCount: managerBans.length,
        bannedTeamCount: teamTargets.size,
        targets,
      };
    } catch (error) {
      throw new Error(toFriendlyApiError(error));
    }
  }

  async revokeResultControlBanTargetFromDiscord(
    input: {
      sessionId: string;
      targetValue: string;
      reason?: string | null;
    },
    guild?: Guild | null,
    audit: DiscordActionAuditContext = {},
  ): Promise<string> {
    const config = await this.apiClient
      .getSessionDiscordConfig(input.sessionId)
      .catch(() => null);
    const state = await this.getResultControlStateForDiscord(input.sessionId);
    const target = state.targets.find(
      (entry) => entry.value === input.targetValue,
    );
    if (!target) {
      return `${this.emoji("reject", config)} This ban target is no longer active.`;
    }

    const reason =
      input.reason?.trim() || "Revoked from Discord result control panel";
    const teamBanIds = target.kind === "team" ? target.teamBanIds : [];
    const managerBanIds = target.managerBanIds;
    if (!teamBanIds.length && !managerBanIds.length) {
      return `${this.emoji("reject", config)} This ban target has no active ban records.`;
    }

    try {
      const [teamResults, managerResults] = await Promise.all([
        Promise.allSettled(
          teamBanIds.map((banId) =>
            this.apiClient.revokeTeamBan(banId, { reason }),
          ),
        ),
        Promise.allSettled(
          managerBanIds.map((banId) =>
            this.apiClient.revokeManagerBan(banId, { reason }),
          ),
        ),
      ]);
      const revokedTeamBans = teamResults.filter(
        (result) => result.status === "fulfilled",
      ).length;
      const revokedManagerBans = managerResults.filter(
        (result) => result.status === "fulfilled",
      ).length;
      const failures =
        teamResults.length +
        managerResults.length -
        revokedTeamBans -
        revokedManagerBans;
      const managers = target.managers.map((manager) => ({
        discordUserId: manager.discordUserId,
        discordUsername: manager.discordUsername,
        displayName: manager.displayName,
      }));
      const roleCleanup = await this.removeRevokedBanRolesFromMembers(
        guild,
        config,
        [{ id: input.sessionId, name: state.sessionName }],
        managers.map((manager) => manager.discordUserId),
        `Arenzyra result-control unban ${input.sessionId}`,
      );
      await this.refreshDiscordBanListMessage(guild, config, input.sessionId);

      const team =
        target.kind === "team"
          ? {
              id: target.teamId,
              name: target.teamName,
              tag: target.teamTag,
            }
          : null;
      await this.sendDiscordActionLog(guild, config, {
        action: "Result-control ban revoked",
        actorDiscordId: audit.actorDiscordId,
        actorLabel: audit.actorLabel,
        sourceChannelId: audit.sourceChannelId,
        sessionId: input.sessionId,
        sessionName: audit.sessionName ?? state.sessionName,
        team: team ?? {
          name: managers
            .map((manager) => this.managerBanTargetLabel(manager))
            .join(", "),
          tag: null,
        },
        status: `${revokedTeamBans} team, ${revokedManagerBans} manager ban(s) revoked`,
        reason,
        details: [
          `Target: ${
            target.kind === "team"
              ? this.formatTeamSummary(team)
              : this.managerBanTargetLabel(managers[0])
          }`,
          `Managers: ${
            managers.length
              ? managers
                  .map((manager) => this.managerBanTargetLabel(manager))
                  .join(", ")
              : "none"
          }`,
          `Banned role(s) removed: ${roleCleanup.removedRoles}`,
          `Kept because another active ban exists: ${roleCleanup.keptActive}`,
          failures ? `Revoke failures: ${failures}` : null,
        ].filter((line): line is string => Boolean(line)),
        color: failures ? 0xf59e0b : 0x22c55e,
      });
      await this.sendDiscordBanChannelNotice(guild, config, {
        title: "Ban revoked from result control",
        team,
        managers,
        scope: null,
        sessionTargets: [{ id: input.sessionId, name: state.sessionName }],
        sessionName: audit.sessionName ?? state.sessionName,
        duration: "Revoked now",
        reason,
        status: `${revokedTeamBans} team ban(s), ${revokedManagerBans} manager ban(s) revoked`,
      });

      const lines = [
        `${this.emoji("check", config)} Ban target revoked.`,
        target.kind === "team"
          ? `Team: ${this.formatTeamSummary(team)}`
          : `Manager: ${this.managerBanTargetLabel(managers[0])}`,
        `Team ban records revoked: ${revokedTeamBans}`,
        `Manager ban records revoked: ${revokedManagerBans}`,
        `Reason: ${reason}`,
        roleCleanup.checkedMembers > 0
          ? `Banned role(s) removed: ${roleCleanup.removedRoles}`
          : null,
        roleCleanup.keptActive > 0
          ? `Kept role because another active ban exists: ${roleCleanup.keptActive}`
          : null,
        failures > 0 ? `Revoke failures: ${failures}` : null,
      ].filter((line): line is string => Boolean(line));
      return lines.join("\n");
    } catch (error) {
      throw new Error(toFriendlyApiError(error));
    }
  }

  async rememberResultControlPanelMessage(
    sessionId: string,
    channelId: string,
    messageId: string,
  ) {
    const config = await this.apiClient.getSessionDiscordConfig(sessionId);
    return this.apiClient.updateSessionDiscordConfig(sessionId, {
      emojis: {
        ...(config.emojis ?? {}),
        resultControlPanelChannelId: channelId,
        resultControlPanelMessageId: messageId,
      },
    });
  }

  async rememberFinalResultPost(
    sessionId: string,
    channelId: string,
    messageId: string,
    backupId?: string | null,
  ) {
    const config = await this.apiClient.getSessionDiscordConfig(sessionId);
    return this.apiClient.updateSessionDiscordConfig(sessionId, {
      emojis: {
        ...(config.emojis ?? {}),
        finalResultPostChannelId: channelId,
        finalResultPostMessageId: messageId,
        ...(backupId ? { finalResultPostBackupId: backupId } : {}),
      },
    });
  }

  async updateResultControlSettings(
    sessionId: string,
    emojis: Record<string, string>,
  ) {
    const config = await this.apiClient.getSessionDiscordConfig(sessionId);
    return this.apiClient.updateSessionDiscordConfig(sessionId, {
      emojis: {
        ...(config.emojis ?? {}),
        ...emojis,
      },
    });
  }

  async setIdpDmForwardingEnabled(sessionId: string, enabled: boolean) {
    const config = await this.apiClient.getSessionDiscordConfig(sessionId);
    return this.apiClient.updateSessionDiscordConfig(sessionId, {
      emojis: {
        ...(config.emojis ?? {}),
        idpDmForwardingEnabled: enabled ? "true" : "false",
      },
    });
  }

  async getSessionDiscordContext(sessionId: string) {
    const [session, config] = await Promise.all([
      this.apiClient.getSession(sessionId),
      this.apiClient.getSessionDiscordConfig(sessionId),
    ]);
    return { session, config };
  }

  async listRegisteredSlotManagerDiscordIds(sessionId: string) {
    const registrations = await this.apiClient.listRegistrations(sessionId);
    const ids = new Set<string>();
    const add = (discordUserId: string | null | undefined) => {
      const clean = discordUserId?.trim();
      if (clean && /^\d{17,22}$/.test(clean)) {
        ids.add(clean);
      }
    };

    registrations
      .filter(
        (
          registration,
        ): registration is SessionRegistrationResponse & {
          slotNumber: number;
        } =>
          this.activeRegistrationStatus(registration) &&
          this.registrationPlayStatus(registration)?.status === "CONFIRM" &&
          registration.slotNumber !== null,
      )
      .sort((left, right) => left.slotNumber - right.slotNumber)
      .forEach((registration) => {
        const managers = this.uniqueStrings(registration.managerDiscordUserIds);
        if (managers.length > 0) {
          managers.forEach(add);
          return;
        }
        add(registration.leaderDiscordUserId);
      });

    return [...ids];
  }

  private activeRegistrationStatus(registration: SessionRegistrationResponse) {
    return (
      registration.status !== "REMOVED" && registration.status !== "DECLINED"
    );
  }

  private registrationAccessRoleTeamIds(
    registrations: SessionRegistrationResponse[],
  ) {
    return new Set(
      registrations
        .filter(
          (registration) =>
            ((registration.status === "CONFIRMED" ||
              registration.status === "CHECKED_IN") &&
              registration.slotNumber !== null) ||
            (registration.status === "WAITLIST" &&
              registration.waitlistPosition !== null),
        )
        .map((registration) => registration.teamId),
    );
  }

  private registrationActionLogStatus(
    registration: Pick<
      SessionRegistrationResponse,
      "status" | "slotNumber" | "waitlistPosition"
    > | null,
  ) {
    if (!registration) {
      return "registered";
    }
    if (
      registration.status === "WAITLIST" ||
      registration.waitlistPosition !== null
    ) {
      return "waitlisted";
    }
    if (
      registration.status === "REMOVED" ||
      registration.status === "DECLINED"
    ) {
      return "not registered";
    }
    return "registered";
  }

  private memberHasAnyRole(member: GuildMember, roleIds: string[]) {
    return roleIds.some((roleId) => member.roles.cache.has(roleId));
  }

  private memberHasRoleName(
    member: GuildMember,
    roleName: string | null | undefined,
  ) {
    const normalized = roleName?.trim();
    return normalized
      ? member.roles.cache.some((role) => role.name === normalized)
      : false;
  }

  private configuredRegistrationRoleIds(
    config: SessionDiscordConfigResponse | null,
  ) {
    if (!config) {
      return [];
    }
    return [
      ...config.registrationRoleIds,
      ...config.specialRegistrationRoleIds,
      ...config.vipRoleIds,
    ].filter((roleId) => roleId.trim().length > 0);
  }

  private registrationModeLabel(
    config?: Pick<SessionDiscordConfigResponse, "registrationMode"> | null,
  ) {
    const mode = String(config?.registrationMode ?? "SCRIM").toUpperCase();
    if (mode === "TOURNAMENT") return "tournament";
    if (mode === "EVENT") return "event";
    return "scrim";
  }

  private configuredStaffRoleIds(config: SessionDiscordConfigResponse | null) {
    const manageRoleIds = (config?.manageRoleIds ?? []).filter(
      (roleId) => roleId.trim().length > 0,
    );
    if (manageRoleIds.length > 0) {
      return manageRoleIds;
    }
    return [config?.emojis?.staffRoleId ?? ""].filter(
      (roleId) => roleId.trim().length > 0,
    );
  }

  private memberHasStaffAccess(
    member: GuildMember,
    config: SessionDiscordConfigResponse | null,
  ) {
    if (
      member.permissions.has(PermissionFlagsBits.Administrator) ||
      member.permissions.has(PermissionFlagsBits.ManageGuild) ||
      member.permissions.has(PermissionFlagsBits.ManageChannels) ||
      member.permissions.has(PermissionFlagsBits.ManageMessages)
    ) {
      return true;
    }

    if (this.memberHasAnyRole(member, this.configuredStaffRoleIds(config))) {
      return true;
    }

    if ((config?.manageRoleIds ?? []).length > 0) {
      return false;
    }

    return STAFF_ROLE_NAMES.some((roleName) =>
      this.memberHasRoleName(member, roleName),
    );
  }

  private async requesterHasStaffAccess(
    requesterDiscordId: string,
    guild: Guild | null,
    config: SessionDiscordConfigResponse | null,
  ) {
    if (!guild) {
      return false;
    }
    const member = await guild.members
      .fetch(requesterDiscordId)
      .catch(() => null);
    return member ? this.memberHasStaffAccess(member, config) : false;
  }

  async userHasStaffAccess(
    requesterDiscordId: string,
    guild: Guild | null,
    sessionId?: string | null,
  ) {
    const config = sessionId
      ? await this.apiClient
          .getSessionDiscordConfig(sessionId)
          .catch(() => null)
      : null;
    return this.requesterHasStaffAccess(requesterDiscordId, guild, config);
  }

  private accessWindow(
    config: SessionDiscordConfigResponse | null | undefined,
    kind: AccessAnnouncementKind,
    now = new Date(),
  ): AccessWindowSnapshot {
    return roleAccessWindow(config, kind, now);
  }

  private accessRoleId(
    config: SessionDiscordConfigResponse | null | undefined,
    kind: AccessAnnouncementKind,
  ) {
    const roleId =
      kind === "earlyAccess"
        ? config?.earlyAccessRoleId
        : config?.vipAccessRoleId;
    return roleId?.trim() || null;
  }

  private accessRoleName(
    config: SessionDiscordConfigResponse | null | undefined,
    kind: AccessAnnouncementKind,
  ) {
    const roleName =
      kind === "earlyAccess"
        ? config?.earlyAccessRoleName
        : config?.vipAccessRoleName;
    return roleName?.trim() || null;
  }

  private async requesterHasAccessRole(
    requesterDiscordId: string,
    guild: Guild | null,
    roleId: string | null,
  ) {
    if (!guild || !roleId) {
      return false;
    }
    const member = await guild.members
      .fetch(requesterDiscordId)
      .catch(() => null);
    return member ? member.roles.cache.has(roleId) : false;
  }

  async userHasEarlyAccessRegistrationAccess(
    requesterDiscordId: string,
    guild: Guild | null,
    config: SessionDiscordConfigResponse | null | undefined,
    now = new Date(),
  ) {
    const window = this.accessWindow(config, "earlyAccess", now);
    if (!window.allowsAction) {
      return false;
    }
    return this.requesterHasAccessRole(
      requesterDiscordId,
      guild,
      this.accessRoleId(config, "earlyAccess"),
    );
  }

  async userHasVipRegistrationAccess(
    requesterDiscordId: string,
    guild: Guild | null,
    config: SessionDiscordConfigResponse | null | undefined,
    now = new Date(),
  ) {
    const window = this.accessWindow(config, "vipAccess", now);
    if (!window.allowsAction) {
      return false;
    }
    return this.requesterHasAccessRole(
      requesterDiscordId,
      guild,
      this.accessRoleId(config, "vipAccess"),
    );
  }

  private roleAccessGroupAllowsPlacement(
    group: Pick<RoleAccessGroup, "mode">,
    placement: "normal" | "vip",
  ) {
    return (
      group.mode === "both" ||
      (placement === "vip" ? group.mode === "vip" : group.mode === "normal")
    );
  }

  async userHasCustomRoleRegistrationAccess(
    requesterDiscordId: string,
    guild: Guild | null,
    config: SessionDiscordConfigResponse | null | undefined,
    placement: "normal" | "vip",
    now = new Date(),
  ) {
    if (!guild || !config) {
      return false;
    }
    const groups = parseRoleAccessGroups(config);
    for (const group of groups) {
      if (
        !group.roleId ||
        !this.roleAccessGroupAllowsPlacement(group, placement)
      ) {
        continue;
      }
      const window = roleAccessGroupWindow(group, config, now);
      if (!window.allowsAction) {
        continue;
      }
      if (
        await this.requesterHasAccessRole(
          requesterDiscordId,
          guild,
          group.roleId,
        )
      ) {
        return true;
      }
    }
    return false;
  }

  private autoRegistrationRunKey(params: {
    autoConfig: AutoRegistrationConfig;
    opensAt: Date;
    closesAt: Date | null;
  }) {
    return [
      params.autoConfig.roleId,
      params.autoConfig.placement,
      params.opensAt.toISOString(),
      params.closesAt?.toISOString() ?? "",
    ].join("|");
  }

  private async persistAutoRegistrationLastRunKey(
    sessionId: string,
    config: SessionDiscordConfigResponse,
    runKey: string,
  ) {
    const latestConfig = await this.latestSessionDiscordConfig(
      sessionId,
      config,
    );
    if (latestConfig.emojis?.autoRegistrationLastRunKey === runKey) {
      return latestConfig;
    }
    return this.apiClient.updateSessionDiscordConfig(sessionId, {
      emojis: {
        ...(latestConfig.emojis ?? {}),
        autoRegistrationLastRunKey: runKey,
      },
    });
  }

  private async autoRegistrationManagerMatch(
    guild: Guild,
    autoConfig: Pick<AutoRegistrationConfig, "roleId">,
    entry: DiscordManagedTeamResponse,
  ) {
    const managerIds = this.uniqueStrings(
      entry.managers
        .filter((manager) => this.isActiveMember(manager))
        .map((manager) => manager.discordUserId),
    );
    for (const discordUserId of managerIds) {
      const member = await guild.members.fetch(discordUserId).catch(() => null);
      if (member?.roles.cache.has(autoConfig.roleId)) {
        return { matchedManagerId: discordUserId, managerIds };
      }
    }
    return null;
  }

  private async autoRegistrationEligibleTeams(
    guild: Guild,
    autoConfig: AutoRegistrationConfig,
    limit: number,
  ) {
    const managedTeams = await this.apiClient.listDiscordManagedTeams(
      [],
      limit,
    );
    const eligible: Array<{
      entry: DiscordManagedTeamResponse;
      index: number;
      managerIds: string[];
      matchedManagerId: string;
    }> = [];
    await this.runLimited(
      managedTeams.map((entry, index) => ({ entry, index })),
      4,
      async ({ entry, index }) => {
        const match = await this.autoRegistrationManagerMatch(
          guild,
          autoConfig,
          entry,
        );
        if (!match) {
          return;
        }
        eligible.push({
          entry,
          index,
          managerIds: match.managerIds,
          matchedManagerId: match.matchedManagerId,
        });
      },
    );

    return eligible
      .sort((left, right) => left.index - right.index)
      .slice(0, autoConfig.maxTeams);
  }

  private autoRegistrationCandidateLimit(autoConfig: AutoRegistrationConfig) {
    return Math.min(
      1000,
      Math.max(100, autoConfig.maxTeams + 25, autoConfig.maxTeams * 5),
    );
  }

  private async runDueAutoRegistration(
    guild: Guild,
    session: SessionResponse,
    config: SessionDiscordConfigResponse,
    now = new Date(),
  ) {
    const autoConfig = parseAutoRegistrationConfig(config);
    const window = autoRegistrationWindow(config, now);
    if (
      !autoConfig.enabled ||
      !autoConfig.roleId ||
      !window.allowsAction ||
      !window.opensAt ||
      !["DRAFT", "OPEN", "CHECKIN"].includes(session.status)
    ) {
      return config;
    }

    const runKey = this.autoRegistrationRunKey({
      autoConfig,
      opensAt: window.opensAt,
      closesAt: window.closesAt,
    });
    if (autoConfig.lastRunKey === runKey) {
      return config;
    }

    const role = await guild.roles.fetch(autoConfig.roleId).catch(() => null);
    if (!role) {
      console.warn(
        `[DiscordAutoRegister] skipped session=${session.id}: role ${autoConfig.roleId} was not found`,
      );
      return config;
    }

    const registrations = await this.apiClient.listRegistrations(session.id);
    const activeTeamIds = new Set(
      registrations
        .filter((registration) => this.activeRegistrationStatus(registration))
        .map((registration) => registration.teamId),
    );
    const candidates = (
      await this.autoRegistrationEligibleTeams(
        guild,
        autoConfig,
        this.autoRegistrationCandidateLimit(autoConfig),
      )
    ).filter(({ entry }) => !activeTeamIds.has(entry.team.id));

    const accepted: SessionRegistrationResponse[] = [];
    const skipped: string[] = [];
    const mutableRegistrations = [...registrations];

    for (const candidate of candidates) {
      if (accepted.length >= autoConfig.maxTeams) {
        break;
      }
      const team = candidate.entry.team;
      if (
        autoConfig.placement === "normal" &&
        !autoConfig.waitlistFallback &&
        this.nextAvailableNormalSlot(session, mutableRegistrations, config) ===
          null
      ) {
        skipped.push(`${team.tag ?? team.name}: normal slots full`);
        break;
      }

      const leaderDiscordUserId = candidate.matchedManagerId;
      try {
        const registration = await this.apiClient.registerTeam(session.id, {
          teamId: team.id,
          note: `Auto-registered by Discord role ${role.name} during scheduled window`,
          bypassRegistrationWindow: true,
          placement: autoConfig.placement === "vip" ? "VIP" : "NORMAL",
          leaderDiscordUserId,
          managerDiscordUserIds: candidate.managerIds,
        });
        accepted.push(registration);
        mutableRegistrations.push(registration);
      } catch (error) {
        const friendly = toFriendlyApiError(error);
        skipped.push(`${team.tag ?? team.name}: ${friendly}`);
        if (/VIP slots are full|session full/i.test(friendly)) {
          break;
        }
      }
    }

    let updatedConfig = config;
    if (accepted.length > 0) {
      await this.syncAffectedTeamAccessRoles(guild, session.id, {
        activeTeamIds: accepted.map((registration) => registration.teamId),
      }).catch((error) => {
        console.warn(
          `[DiscordAutoRegister] role sync failed session=${session.id}: ${String(
            error,
          )}`,
        );
      });
      const refreshed = await this.syncVisibleDiscordMessagesFast(
        guild,
        session.id,
      );
      if (!refreshed) {
        this.queueVisibleDiscordScrimRefresh(guild, session.id, config);
      }
      await this.runLimited(
        accepted.filter(
          (registration) =>
            registration.status !== "WAITLIST" &&
            registration.slotNumber !== null,
        ),
        3,
        async (registration) => {
          await this.postRegistrationManagePanel(
            guild,
            session.id,
            registration,
          ).catch((error) => {
            console.warn(
              `[DiscordAutoRegister] manage panel failed session=${session.id} registration=${registration.id}: ${String(
                error,
              )}`,
            );
          });
        },
      );
      updatedConfig = await this.persistAutoRegistrationLastRunKey(
        session.id,
        config,
        runKey,
      );
    } else if (candidates.length === 0 || skipped.length > 0) {
      updatedConfig = await this.persistAutoRegistrationLastRunKey(
        session.id,
        config,
        runKey,
      );
    }

    const details = [
      `Role: ${role.name}`,
      `Placement: ${autoConfig.placement === "vip" ? "VIP" : "normal"}`,
      `Accepted: ${accepted.length}`,
      `Skipped: ${skipped.length}`,
      ...accepted
        .slice(0, 10)
        .map(
          (registration) =>
            `Accepted ${registration.team?.tag ?? registration.teamId}: ${this.formatPlacementLabel(
              session,
              registration,
              config,
            )}`,
        ),
      ...skipped.slice(0, 10).map((entry) => `Skipped ${entry}`),
    ];

    if (accepted.length > 0 || skipped.length > 0 || candidates.length === 0) {
      await this.sendDiscordActionLog(guild, config, {
        action: "Auto registration processed",
        sessionId: session.id,
        sessionName: session.name,
        status:
          accepted.length > 0
            ? `${accepted.length} team(s) registered`
            : "No teams registered",
        details:
          candidates.length === 0
            ? [...details, "No existing managed teams matched the role."]
            : details,
        color: accepted.length > 0 ? 0x22c55e : 0xf59e0b,
      }).catch((error) => {
        console.warn(
          `[DiscordAutoRegister] action log failed session=${session.id}: ${String(
            error,
          )}`,
        );
      });
    }

    return updatedConfig;
  }

  private async loadTeamMembersForSync(teamIds: Iterable<string>) {
    const uniqueTeamIds = [...new Set(teamIds)].filter(Boolean);
    const startedAt = Date.now();
    const entries = await Promise.all(
      uniqueTeamIds.map(async (teamId) => {
        const members = await this.apiClient
          .listTeamMembers(teamId)
          .catch((error) => {
            console.warn(
              `Team member sync lookup failed for ${teamId}: ${String(error)}`,
            );
            return [] as TeamMemberSummary[];
          });
        return [teamId, members] as const;
      }),
    );
    this.logTiming(
      `loaded team members teams=${uniqueTeamIds.length}`,
      startedAt,
    );
    return new Map(entries);
  }

  private managerMentionByTeamId(
    registrations: SessionRegistrationResponse[],
    memberCache: Map<string, TeamMemberSummary[]>,
  ) {
    return this.managerDisplayByTeamId(registrations, memberCache, null);
  }

  private managerLabelByTeamId(
    registrations: SessionRegistrationResponse[],
    memberCache: Map<string, TeamMemberSummary[]>,
  ) {
    return this.managerDisplayByTeamId(registrations, memberCache, new Set());
  }

  private managerClickableLabel(discordUserId: string) {
    return `<@${discordUserId}>`;
  }

  private isActiveLeaderMember(member: TeamMemberSummary) {
    return this.isActiveMember(member) && member.role === "LEADER";
  }

  private managerSnapshotDiscordUserIds(
    registration: Pick<
      SessionRegistrationResponse,
      "leaderDiscordUserId" | "managerDiscordUserIds"
    >,
  ) {
    const managerDiscordUserIds = this.uniqueStrings(
      registration.managerDiscordUserIds ?? [],
    );
    return managerDiscordUserIds.length
      ? managerDiscordUserIds
      : this.uniqueStrings([registration.leaderDiscordUserId]);
  }

  private registrationRoleSyncDiscordUserIds(
    registrations: Array<
      Pick<
        SessionRegistrationResponse,
        "leaderDiscordUserId" | "managerDiscordUserIds"
      >
    >,
  ) {
    return this.uniqueStrings(
      registrations.flatMap((registration) =>
        this.managerSnapshotDiscordUserIds(registration),
      ),
    );
  }

  private registrationManagersPayload(
    registration: Pick<
      SessionRegistrationResponse,
      "leaderDiscordUserId" | "managerDiscordUserIds"
    >,
    managerDiscordUserIds: string[],
  ): UpdateRegistrationManagersPayload {
    const cleanManagerDiscordUserIds = this.uniqueStrings(
      managerDiscordUserIds,
    );
    const cleanLeaderDiscordUserId = registration.leaderDiscordUserId?.trim();
    return {
      leaderDiscordUserId:
        cleanLeaderDiscordUserId &&
        cleanManagerDiscordUserIds.includes(cleanLeaderDiscordUserId)
          ? cleanLeaderDiscordUserId
          : (cleanManagerDiscordUserIds[0] ?? null),
      managerDiscordUserIds: cleanManagerDiscordUserIds,
    };
  }

  private managerDisplayByTeamId(
    registrations: SessionRegistrationResponse[],
    memberCache: Map<string, TeamMemberSummary[]>,
    validGuildMemberIds: Set<string> | null,
  ) {
    const activeRegistrationsByTeamId = new Map<
      string,
      SessionRegistrationResponse
    >();
    for (const registration of registrations) {
      if (!this.activeRegistrationStatus(registration)) {
        continue;
      }
      if (!activeRegistrationsByTeamId.has(registration.teamId)) {
        activeRegistrationsByTeamId.set(registration.teamId, registration);
      }
    }
    const entries = [...activeRegistrationsByTeamId.entries()].map(
      ([teamId, registration]) => {
        const mentions: string[] = [];
        const seenDiscordUserIds = new Set<string>();
        const snapshotDiscordUserIds =
          this.managerSnapshotDiscordUserIds(registration);
        const memberDiscordUserIds = snapshotDiscordUserIds.length
          ? []
          : (memberCache.get(teamId) ?? [])
              .filter((member) => this.isActiveLeaderMember(member))
              .slice()
              .sort((left, right) => {
                const leftRoleRank = left.role === "LEADER" ? 0 : 1;
                const rightRoleRank = right.role === "LEADER" ? 0 : 1;
                if (leftRoleRank !== rightRoleRank) {
                  return leftRoleRank - rightRoleRank;
                }
                return (
                  Date.parse(left.createdAt || "") -
                  Date.parse(right.createdAt || "")
                );
              })
              .map((member) => member.discordUserId?.trim())
              .filter((discordUserId): discordUserId is string =>
                Boolean(discordUserId),
              );

        for (const discordUserId of [
          ...snapshotDiscordUserIds,
          ...memberDiscordUserIds,
        ]) {
          if (
            seenDiscordUserIds.has(discordUserId) ||
            (validGuildMemberIds !== null &&
              !validGuildMemberIds.has(discordUserId))
          ) {
            continue;
          }
          seenDiscordUserIds.add(discordUserId);
          mentions.push(this.managerClickableLabel(discordUserId));
        }

        return mentions.length > 0
          ? ([teamId, mentions.join(" ")] as const)
          : null;
      },
    );

    return new Map(
      entries.filter((entry): entry is readonly [string, string] =>
        Boolean(entry),
      ),
    );
  }

  private guildMemberValidationCacheKey(
    guildId: string,
    discordUserId: string,
  ) {
    return `${guildId}:${discordUserId}`;
  }

  private cachedValidGuildMember(guildId: string, discordUserId: string) {
    const key = this.guildMemberValidationCacheKey(guildId, discordUserId);
    const cached = this.managerMentionMemberCache.get(key);
    if (!cached) {
      return false;
    }
    if (cached.expiresAt <= Date.now()) {
      this.managerMentionMemberCache.delete(key);
      return false;
    }
    return true;
  }

  private rememberValidGuildMember(guildId: string, discordUserId: string) {
    if (this.managerMentionMemberCache.size > 5_000) {
      const now = Date.now();
      for (const [key, cached] of this.managerMentionMemberCache) {
        if (cached.expiresAt <= now) {
          this.managerMentionMemberCache.delete(key);
        }
      }
      if (this.managerMentionMemberCache.size > 5_000) {
        this.managerMentionMemberCache.clear();
      }
    }
    this.managerMentionMemberCache.set(
      this.guildMemberValidationCacheKey(guildId, discordUserId),
      { expiresAt: Date.now() + MANAGER_MENTION_MEMBER_CACHE_TTL_MS },
    );
  }

  private async validatedManagerMentionIds(
    guild: Guild | null | undefined,
    discordUserIds: readonly (string | null | undefined)[],
  ) {
    const validGuildMemberIds = new Set<string>();
    if (!guild?.members) {
      return validGuildMemberIds;
    }

    const cleanDiscordUserIds = this.uniqueStrings(
      discordUserIds.filter(
        (discordUserId): discordUserId is string =>
          /^\d{15,25}$/.test(discordUserId?.trim() ?? ""),
      ),
    );
    const validationDeadline = Date.now() + MANAGER_MENTION_VALIDATION_MAX_MS;

    await this.runLimited(
      cleanDiscordUserIds,
      ROLE_SYNC_CONCURRENCY,
      async (discordUserId) => {
        const cachedMember = guild.members.cache?.get?.(discordUserId);
        if (cachedMember && cachedMember.user?.bot !== true) {
          validGuildMemberIds.add(discordUserId);
          this.rememberValidGuildMember(guild.id, discordUserId);
          return;
        }

        if (this.cachedValidGuildMember(guild.id, discordUserId)) {
          validGuildMemberIds.add(discordUserId);
          return;
        }

        if (!guild.members.fetch) {
          validGuildMemberIds.add(discordUserId);
          return;
        }

        const remainingMs = validationDeadline - Date.now();
        if (remainingMs <= 0) {
          validGuildMemberIds.add(discordUserId);
          return;
        }

        const member = await this.withTimeout(
          guild.members.fetch(discordUserId).catch(() => null),
          Math.max(
            100,
            Math.min(MANAGER_MENTION_MEMBER_FETCH_TIMEOUT_MS, remainingMs),
          ),
          undefined,
        );
        if (member === undefined) {
          validGuildMemberIds.add(discordUserId);
          return;
        }
        if (member && member.user?.bot !== true) {
          validGuildMemberIds.add(discordUserId);
          this.rememberValidGuildMember(guild.id, discordUserId);
        }
      },
    );

    return validGuildMemberIds;
  }

  private async managerMentionByTeamIdForGuild(
    guild: Guild | null | undefined,
    registrations: SessionRegistrationResponse[],
    memberCache: Map<string, TeamMemberSummary[]>,
  ) {
    if (!guild) {
      return this.managerMentionByTeamId(registrations, memberCache);
    }
    if (!guild.members) {
      return this.managerMentionByTeamId(registrations, memberCache);
    }

    const discordUserIds = [
      ...new Set(
        [
          ...registrations.flatMap((registration) =>
            this.activeRegistrationStatus(registration)
              ? this.managerSnapshotDiscordUserIds(registration)
              : [],
          ),
          ...[...memberCache.values()]
            .flat()
            .filter((member) => this.isActiveLeaderMember(member))
            .map((member) => member.discordUserId?.trim()),
        ].filter(
          (discordUserId): discordUserId is string =>
            typeof discordUserId === "string" &&
            /^\d{15,25}$/.test(discordUserId.trim()),
        ),
      ),
    ];
    const validGuildMemberIds = new Set<string>();
    const unverifiedGuildMemberIds = new Set<string>();
    const validationDeadline = Date.now() + MANAGER_MENTION_VALIDATION_MAX_MS;
    await this.runLimited(
      discordUserIds,
      ROLE_SYNC_CONCURRENCY,
      async (discordUserId) => {
        const cachedMember = guild.members.cache?.get?.(discordUserId);
        if (cachedMember && cachedMember.user?.bot !== true) {
          validGuildMemberIds.add(discordUserId);
          this.rememberValidGuildMember(guild.id, discordUserId);
          return;
        }

        if (this.cachedValidGuildMember(guild.id, discordUserId)) {
          validGuildMemberIds.add(discordUserId);
          return;
        }

        if (!guild.members.fetch) {
          validGuildMemberIds.add(discordUserId);
          this.rememberValidGuildMember(guild.id, discordUserId);
          return;
        }

        const remainingMs = validationDeadline - Date.now();
        if (remainingMs <= 0) {
          unverifiedGuildMemberIds.add(discordUserId);
          return;
        }

        const member = await this.withTimeout(
          guild.members
            .fetch({ user: discordUserId, force: true })
            .catch(() => null),
          Math.max(
            100,
            Math.min(MANAGER_MENTION_MEMBER_FETCH_TIMEOUT_MS, remainingMs),
          ),
          undefined,
        );
        if (member === undefined) {
          unverifiedGuildMemberIds.add(discordUserId);
          validGuildMemberIds.add(discordUserId);
          return;
        }
        if (member && member.user?.bot !== true) {
          validGuildMemberIds.add(discordUserId);
          this.rememberValidGuildMember(guild.id, discordUserId);
        }
      },
    );

    if (unverifiedGuildMemberIds.size > 0) {
      console.warn(
        `[DiscordSync] Manager mention validation timed out for ${unverifiedGuildMemberIds.size}/${discordUserIds.length} member(s); keeping stored manager mentions and only suppressing users Discord confirmed as missing.`,
      );
    }

    return this.managerDisplayByTeamId(
      registrations,
      memberCache,
      validGuildMemberIds,
    );
  }

  private async assertDiscordRegistrationAllowed(
    requesterDiscordId: string,
    memberDiscordIds: string[],
    guild: Guild | null,
    config: SessionDiscordConfigResponse | null,
    opts: {
      staffBypass?: boolean;
      registrationWindowBypass?: boolean;
      registrationRoleBypass?: boolean;
    } = {},
  ) {
    const reject = this.emoji("reject", config);
    const modeLabel = this.registrationModeLabel(config);
    if (!config) {
      return;
    }

    if (
      config.disableSlotAndVipRegistration &&
      !opts.staffBypass &&
      !opts.registrationWindowBypass
    ) {
      throw new Error(
        `${reject} Registration is currently closed for this ${modeLabel}.`,
      );
    }

    const requiredRoleIds = this.configuredRegistrationRoleIds(config);
    const bannedRoleIds = this.configuredAllBanRoleIds(config);
    const bannedRoleNames = this.configuredBanRoleNames(config);
    const mustCheckRoles =
      requiredRoleIds.length > 0 ||
      bannedRoleIds.length > 0 ||
      bannedRoleNames.length > 0;

    if (!mustCheckRoles) {
      return;
    }

    if (!guild) {
      throw new Error(
        `${reject} This ${modeLabel} requires Discord role verification. Use the command inside the server.`,
      );
    }

    if (config.guildId && config.guildId !== guild.id) {
      throw new Error(
        `${reject} This ${modeLabel} is configured for a different Discord server.`,
      );
    }

    const requester = await guild.members
      .fetch(requesterDiscordId)
      .catch(() => null);
    if (!requester) {
      throw new Error(`${reject} Could not verify your Discord server roles.`);
    }

    if (!opts.staffBypass) {
      if (
        this.memberHasAnyRole(requester, bannedRoleIds) ||
        this.memberHasAnyRoleName(requester, bannedRoleNames)
      ) {
        throw new Error(
          `${reject} You are blocked from registering for this ${modeLabel}.`,
        );
      }

      if (
        requiredRoleIds.length > 0 &&
        !opts.registrationRoleBypass &&
        !this.memberHasAnyRole(requester, requiredRoleIds)
      ) {
        throw new Error(
          `${reject} You do not have a registration role for this ${modeLabel}.`,
        );
      }
    }

    const checkedMemberIds = new Set<string>(memberDiscordIds);
    checkedMemberIds.delete(requesterDiscordId);

    for (const memberDiscordId of checkedMemberIds) {
      const member = await guild.members
        .fetch(memberDiscordId)
        .catch(() => null);
      if (!member) {
        continue;
      }
      if (
        this.memberHasAnyRole(member, bannedRoleIds) ||
        this.memberHasAnyRoleName(member, bannedRoleNames)
      ) {
        throw new Error(
          `${reject} One of the mentioned players is blocked from this ${modeLabel}.`,
        );
      }
    }
  }

  private async assertManagerTeamLimit(
    sessionId: string,
    requesterDiscordId: string,
    currentTeamId: string,
    config: SessionDiscordConfigResponse | null,
  ) {
    const reject = this.emoji("reject", config);
    const modeLabel = this.registrationModeLabel(config);
    const limit = config?.maxTeamsPerManager ?? 1;
    if (limit < 1) {
      return;
    }

    const registrations = await this.apiClient.listRegistrations(sessionId);
    let managedTeamCount = 0;

    for (const registration of registrations) {
      if (
        !this.activeRegistrationStatus(registration) ||
        registration.teamId === currentTeamId ||
        !registration.team
      ) {
        continue;
      }

      let members: Awaited<ReturnType<ArenzyraApiClient["listTeamMembers"]>>;
      try {
        members = await this.apiClient.listTeamMembers(registration.teamId);
      } catch (error) {
        const friendly = toFriendlyApiError(error).toLowerCase();
        if (
          friendly.includes("team not found") ||
          friendly.includes("requested resource not found")
        ) {
          continue;
        }
        throw error;
      }
      const leader = members.find(
        (member) =>
          member.role === "LEADER" &&
          this.isActiveMember(member) &&
          member.discordUserId === requesterDiscordId,
      );
      if (!leader) {
        continue;
      }

      managedTeamCount += 1;
      if (managedTeamCount >= limit) {
        throw new Error(
          `${reject} You already manage ${managedTeamCount} team(s) in this ${modeLabel}. Limit is ${limit}.`,
        );
      }
    }
  }

  async registerTeam(
    leaderDiscordId: string,
    leaderUsername: string,
    leaderDisplayName: string | null,
    rawTag: string,
    rawName: string,
    members: DiscordRegistrationMemberInput[],
    guild: Guild | null,
    logoUrl?: string | null,
    logoUpload?: TeamLogoUpload | null,
  ): Promise<string> {
    const reject = this.emoji("reject");
    const normalizedTag = this.normalizeTag(rawTag);
    const normalizedName = rawName.trim();
    if (!normalizedTag) {
      return `${reject} Team tag is required`;
    }
    if (!normalizedName) {
      return `${reject} Team name is required`;
    }

    try {
      const response = await this.apiClient.registerDiscordTeam({
        tag: normalizedTag,
        name: normalizedName,
        leaderDiscordUserId: leaderDiscordId,
        leaderDiscordUsername: leaderUsername,
        leaderDisplayName: leaderDisplayName ?? undefined,
        logoUrl: logoUrl?.trim() || undefined,
        members,
      });

      const logoUploadNote = await this.uploadLogoAfterRegistration(
        response,
        logoUpload,
      );
      const roleSyncNote = await this.syncDiscordRoles(response, guild);
      return this.formatRegisteredTeam(response, roleSyncNote, logoUploadNote);
    } catch (error) {
      throw new Error(toFriendlyApiError(error));
    }
  }

  private registrationManagerDiscordUserIds(
    leaderDiscordId: string,
    members: DiscordRegistrationMemberInput[],
  ) {
    const memberDiscordUserIds = this.uniqueStrings(
      members.map((member) => member.discordUserId),
    );
    return memberDiscordUserIds.length
      ? memberDiscordUserIds
      : this.uniqueStrings([leaderDiscordId]);
  }

  private discordRegistrationManagerInputs(
    members: DiscordRegistrationMemberInput[],
  ): DiscordRegistrationMemberInput[] {
    return members.map((member) => ({
      ...member,
      role: "LEADER" as const,
    }));
  }

  private formatRegisteredTeam(
    registration: RegisterDiscordTeamResponse,
    roleSyncNote?: string | null,
    logoUploadNote?: string | null,
    config?: Pick<
      SessionDiscordConfigResponse,
      "emojis" | "registrationMode"
    > | null,
  ): string {
    const check = this.emoji("check", config);
    const modeLabel = this.registrationModeLabel(config);
    const leaders = registration.members.filter(
      (member) => member.role === "LEADER",
    );
    const players = registration.members.filter(
      (member) => member.role === "PLAYER",
    );
    const leaderLabel =
      leaders[0]?.displayName ||
      leaders[0]?.discordUsername ||
      leaders[0]?.discordUserId ||
      "Unknown";

    const lines = [
      `${check} Team ${registration.team.tag ?? registration.team.id} ${
        registration.created ? "registered" : "updated"
      }`,
      "",
      `Team: ${registration.team.name}`,
      `Leader: ${leaderLabel}`,
      `Players: ${players.length}`,
      ...(registration.team.logoUrl ? ["Logo: saved"] : []),
      "",
      modeLabel === "scrim"
        ? `Use /join-scrim with tag ${registration.team.tag ?? registration.team.id}`
        : `Registered in the ${modeLabel} session.`,
    ];

    if (roleSyncNote) {
      lines.push("", roleSyncNote);
    }

    if (logoUploadNote) {
      lines.push("", logoUploadNote);
    }

    return lines.join("\n");
  }

  private async uploadLogoAfterRegistration(
    registration: RegisterDiscordTeamResponse,
    logoUpload?: TeamLogoUpload | null,
    config?: Pick<SessionDiscordConfigResponse, "emojis"> | null,
  ): Promise<string | null> {
    if (!logoUpload) {
      return null;
    }

    try {
      const uploaded = await this.apiClient.uploadTeamLogo(
        registration.team.id,
        logoUpload,
      );
      registration.team.logoUrl = uploaded.logoUrl;
      return null;
    } catch (error) {
      return `${this.emoji("warning", config)} Team registered, but logo upload failed: ${toFriendlyApiError(
        error,
      )}`;
    }
  }

  private normalizeImageContentType(
    contentTypeHeader: string | null | undefined,
    logoUrl: string,
  ) {
    const contentType = contentTypeHeader?.split(";")[0]?.trim().toLowerCase();
    if (contentType && ALLOWED_LOGO_TYPES.has(contentType)) {
      return contentType;
    }
    if (/\.png(?:\?|$)/i.test(logoUrl)) return "image/png";
    if (/\.jpe?g(?:\?|$)/i.test(logoUrl)) return "image/jpeg";
    if (/\.webp(?:\?|$)/i.test(logoUrl)) return "image/webp";
    throw new Error("Team logo must be a PNG, JPG, or WEBP image.");
  }

  private async downloadLogoUpload(logoUrl: string): Promise<TeamLogoUpload> {
    const response = await fetch(logoUrl);
    if (!response.ok) {
      throw new Error("Could not download the saved team logo.");
    }

    const contentLength = Number(response.headers.get("content-length") ?? "0");
    if (contentLength > MAX_LOGO_BYTES) {
      throw new Error("Team logo must be 8 MB or smaller.");
    }

    const contentType = this.normalizeImageContentType(
      response.headers.get("content-type"),
      logoUrl,
    );
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > MAX_LOGO_BYTES) {
      throw new Error("Team logo must be 8 MB or smaller.");
    }

    return {
      buffer,
      filename: `team-logo.${IMAGE_EXTENSIONS[contentType]}`,
      contentType,
    };
  }

  private async resolvePendingLogoUrl(
    record: PendingTeamLogoRecord,
    guild: Guild | null | undefined,
  ) {
    if (!guild) {
      return record.url;
    }

    const channel = await guild.channels
      .fetch(record.channelId)
      .catch(() => null);
    if (!channel || !("messages" in channel)) {
      return record.url;
    }

    const message = await channel.messages
      .fetch(record.messageId)
      .catch(() => null);
    if (!message) {
      return record.url;
    }

    const attachment = record.attachmentId
      ? message.attachments.get(record.attachmentId)
      : message.attachments.find((entry) => {
          const contentType = entry.contentType?.split(";")[0]?.toLowerCase();
          return (
            (contentType && ALLOWED_LOGO_TYPES.has(contentType)) ||
            /\.(png|jpe?g|webp)(?:\?|$)/i.test(entry.name ?? entry.url)
          );
        });
    return attachment?.url ?? record.url;
  }

  private async pendingLogoUploadForRegistration(
    teamName: string,
    tag: string,
    config: SessionDiscordConfigResponse,
    guild: Guild | null | undefined,
  ): Promise<{ upload: TeamLogoUpload; record: PendingTeamLogoRecord } | null> {
    let record = this.pendingLogoForTeam(teamName, tag, config);
    if (!record) {
      record = await this.pendingLogoForTeamAcrossActiveGuildSessions(
        teamName,
        tag,
        config,
      );
    }
    if (!record) {
      return null;
    }

    const logoUrl = await this.resolvePendingLogoUrl(record, guild);
    return {
      upload: await this.downloadLogoUpload(logoUrl),
      record,
    };
  }

  private async persistRegistrationLogoSource(params: {
    guild: Guild | null | undefined;
    sessionId: string;
    config: SessionDiscordConfigResponse;
    teamName: string;
    tag: string;
    logoUpload: TeamLogoUpload;
    source?: DiscordTeamLogoSource | null;
  }) {
    let source = params.source ?? null;
    const logoChannelIds = this.configuredLogoChannelIds(params.config);
    const logoChannelId = logoChannelIds[0];
    const sourceAlreadyInLogoChannel =
      source?.channelId && logoChannelIds.includes(source.channelId);
    if (params.guild && logoChannelId && !sourceAlreadyInLogoChannel) {
      const channel = await params.guild.channels
        .fetch(logoChannelId)
        .catch(() => null);
      if (channel && "send" in channel) {
        const sent = await channel
          .send({
            content: [`%logo`, params.teamName, params.tag].join("\n"),
            files: [
              {
                attachment: params.logoUpload.buffer,
                name: params.logoUpload.filename,
              },
            ],
            allowedMentions: { parse: [] },
          })
          .catch((error) => {
            console.warn(
              `Registration logo could not be copied to logo channel: ${String(
                error,
              )}`,
            );
            return null;
          });
        const attachment = sent?.attachments.first();
        if (sent && attachment) {
          source = {
            teamName: params.teamName,
            tag: params.tag,
            channelId: logoChannelId,
            messageId: sent.id,
            attachmentId: attachment.id,
            url: attachment.url,
            filename: attachment.name,
            contentType: attachment.contentType,
            savedByDiscordId: sent.author.id,
            savedByDiscordUsername: sent.author.username,
          };
        }
      }
    }

    if (source) {
      await this.savePendingTeamLogoForActiveGuildScope(params.config, {
        ...source,
        teamName: params.teamName,
        tag: params.tag,
      });
    }
  }

  private formatSessionRegistration(
    registration: SessionRegistrationResponse,
    config?: Pick<SessionDiscordConfigResponse, "emojis"> | null,
  ) {
    const check = this.emoji("check", config);
    const clock = this.emoji("clock", config);
    const teamLabel = this.resolveTeamLabel(registration);
    if (
      (registration.status === "CONFIRMED" ||
        registration.status === "CHECKED_IN") &&
      registration.slotNumber !== null
    ) {
      return `${check} ${teamLabel} added to slot #${registration.slotNumber}`;
    }

    if (
      registration.status === "WAITLIST" &&
      registration.waitlistPosition !== null
    ) {
      return `${clock} ${teamLabel} added to waitlist position #${registration.waitlistPosition}`;
    }

    return `${check} ${teamLabel} added to the session`;
  }

  async findLatestAcceptingScrim(): Promise<SessionResponse | null> {
    try {
      const sessions = await this.apiClient.listSessions();
      for (const session of sessions) {
        if (session.type !== "SCRIM") {
          continue;
        }
        const config = await this.apiClient
          .getSessionDiscordConfig(session.id)
          .catch(() => null);
        if (this.publicRegistrationAccepting(session, config)) {
          return session;
        }
      }
      return null;
    } catch (error) {
      throw new Error(toFriendlyApiError(error));
    }
  }

  async getSessionContext(sessionId: string): Promise<{
    session: SessionResponse;
    config: SessionDiscordConfigResponse;
  }> {
    try {
      const [session, config] = await Promise.all([
        this.apiClient.getSession(sessionId),
        this.apiClient.getSessionDiscordConfig(sessionId),
      ]);
      return { session, config };
    } catch (error) {
      throw new Error(toFriendlyApiError(error));
    }
  }

  async resolveOrganizationIdForGuild(guildId: string) {
    const cleanGuildId = guildId.trim();
    if (!cleanGuildId) {
      return null;
    }
    const now = Date.now();
    const cached = this.guildOrganizationCache.get(cleanGuildId);
    if (cached && cached.expiresAt > now) {
      return cached.organizationId;
    }

    const resolved = await this.apiClient
      .resolveDiscordGuild(cleanGuildId)
      .catch(() => null);
    const organizationId = resolved?.organizationId?.trim() || null;
    this.guildOrganizationCache.set(cleanGuildId, {
      organizationId,
      expiresAt: now + GUILD_ORGANIZATION_CACHE_TTL_MS,
    });
    return organizationId;
  }

  async listActiveGuildScrims(guildId: string): Promise<
    Array<{
      session: SessionResponse;
      config: SessionDiscordConfigResponse;
    }>
  > {
    try {
      const organizationId = await this.resolveOrganizationIdForGuild(guildId);
      if (!organizationId) {
        return [];
      }
      return await this.withOrganization(organizationId, async () => {
        const sessions = await this.apiClient.listSessions();
        const candidates = sessions.filter(
          (session) =>
            session.type === "SCRIM" && session.status !== "ARCHIVED",
        );
        const contexts: Array<{
          session: SessionResponse;
          config: SessionDiscordConfigResponse;
        }> = [];
        for (const session of candidates) {
          const config = await this.apiClient
            .getSessionDiscordConfig(session.id)
            .catch(() => null);
          if (config?.enabled !== false && config?.guildId === guildId) {
            contexts.push({ session, config });
          }
        }
        return contexts;
      });
    } catch (error) {
      throw new Error(toFriendlyApiError(error));
    }
  }

  async findLatestGuildScrim(guildId: string): Promise<{
    session: SessionResponse;
    config: SessionDiscordConfigResponse;
  } | null> {
    const contexts = await this.listActiveGuildScrims(guildId);
    return contexts[0] ?? null;
  }

  async listSessionMatchesForDiscord(
    sessionId: string,
  ): Promise<SessionMatchResponse[]> {
    try {
      return await this.apiClient.listSessionMatches(sessionId);
    } catch (error) {
      throw new Error(toFriendlyApiError(error));
    }
  }

  private latestEditableMatchBackups(
    backups: ResultBackupSummaryResponse[],
  ): ResultBackupSummaryResponse[] {
    const latestByMatch = new Map<string, ResultBackupSummaryResponse>();
    const ordered = backups
      .filter(
        (backup) =>
          backup.kind?.toUpperCase() === "MATCH" &&
          (backup.rowCount ?? 0) > 0,
      )
      .slice()
      .sort((left, right) => {
        const leftTime = Date.parse(left.createdAt ?? "") || 0;
        const rightTime = Date.parse(right.createdAt ?? "") || 0;
        return rightTime - leftTime;
      });

    for (const backup of ordered) {
      const matchKey =
        Number.isInteger(backup.matchNumber) && backup.matchNumber
          ? `number:${backup.matchNumber}`
          : backup.sourceMatchId?.trim()
            ? `source:${backup.sourceMatchId.trim()}`
            : `backup:${backup.id}`;
      if (!latestByMatch.has(matchKey)) {
        latestByMatch.set(matchKey, backup);
      }
    }

    return [...latestByMatch.values()].sort((left, right) => {
      const leftNumber = left.matchNumber ?? Number.MAX_SAFE_INTEGER;
      const rightNumber = right.matchNumber ?? Number.MAX_SAFE_INTEGER;
      if (leftNumber !== rightNumber) {
        return leftNumber - rightNumber;
      }
      const leftTime = Date.parse(left.createdAt ?? "") || 0;
      const rightTime = Date.parse(right.createdAt ?? "") || 0;
      return rightTime - leftTime;
    });
  }

  async listEditableResultBackupsForDiscord(
    sessionId: string,
  ): Promise<ResultBackupSummaryResponse[]> {
    try {
      const backups = await this.apiClient.listResultBackups({
        sessionId,
        kind: "MATCH",
      });
      return this.latestEditableMatchBackups(backups);
    } catch (error) {
      throw new Error(toFriendlyApiError(error));
    }
  }

  async getResultBackupForDiscord(
    backupId: string,
  ): Promise<ResultBackupDetailResponse> {
    try {
      return await this.apiClient.getResultBackup(backupId);
    } catch (error) {
      throw new Error(toFriendlyApiError(error));
    }
  }

  async updateResultBackupRowsFromDiscord(
    backupId: string,
    rows: UpdateResultBackupRowPayload[],
  ): Promise<ResultBackupDetailResponse> {
    try {
      return await this.apiClient.updateResultBackupRows(backupId, rows);
    } catch (error) {
      throw new Error(toFriendlyApiError(error));
    }
  }

  async getMatchResultsForDiscord(
    matchId: string,
  ): Promise<MatchResultsResponse> {
    try {
      return await this.apiClient.getMatchResults(matchId);
    } catch (error) {
      throw new Error(toFriendlyApiError(error));
    }
  }

  async updateMatchResultFromDiscord(
    matchId: string,
    teamId: string,
    payload: UpdateMatchResultPayload,
  ): Promise<MatchResultsResponse> {
    try {
      return await this.apiClient.updateMatchResult(matchId, teamId, payload);
    } catch (error) {
      throw new Error(toFriendlyApiError(error));
    }
  }

  async updateManualMatchResultsFromDiscord(
    matchId: string,
    rows: ManualMatchResultRowPayload[],
    expectedVersion?: number | null,
  ): Promise<ManualMatchResultsResponse> {
    try {
      return await this.apiClient.updateManualMatchResults(matchId, {
        expectedVersion,
        results: rows,
      });
    } catch (error) {
      throw new Error(toFriendlyApiError(error));
    }
  }

  async findAcceptingScrimForRegistrationChannel(
    guildId: string,
    channelId: string,
  ): Promise<SessionResponse | null> {
    try {
      const resolved = await this.findScrimForRegistrationChannel(
        guildId,
        channelId,
      );
      if (resolved) {
        return resolved.accepting ? resolved.session : null;
      }

      const sessions = await this.apiClient.listSessions();
      const candidates = sessions.filter((session) => session.type === "SCRIM");

      for (const session of candidates) {
        const config = await this.apiClient
          .getSessionDiscordConfig(session.id)
          .catch(() => null);
        if (
          config?.enabled !== false &&
          config?.guildId === guildId &&
          config?.registrationChannelId === channelId &&
          this.publicRegistrationAccepting(session, config)
        ) {
          return session;
        }
      }

      return null;
    } catch (error) {
      throw new Error(toFriendlyApiError(error));
    }
  }

  async findScrimForRegistrationChannel(
    guildId: string,
    channelId: string,
    channelTopic?: string | null,
  ): Promise<{
    session: SessionResponse;
    config: SessionDiscordConfigResponse;
    accepting: boolean;
  } | null> {
    try {
      const resolved = await this.resolveDiscordChannel(
        guildId,
        channelId,
        channelTopic,
      );
      if (resolved) {
        if (
          resolved.channelKind !== "registration" ||
          resolved.session.type !== "SCRIM" ||
          !["DRAFT", "OPEN", "CHECKIN"].includes(resolved.session.status)
        ) {
          return null;
        }
        const { session, config } =
          await this.applyDueWeeklyRegistrationScheduleTransition(
            resolved.session,
            resolved.config,
          );
        return {
          session,
          config,
          accepting: this.publicRegistrationAccepting(session, config),
        };
      }

      const organizationId = await this.resolveOrganizationIdForGuild(guildId);
      if (!organizationId) {
        return null;
      }

      const sessions = await this.withOrganization(organizationId, () =>
        this.apiClient.listSessions(),
      );
      const candidates = sessions.filter(
        (session) =>
          session.type === "SCRIM" &&
          ["DRAFT", "OPEN", "CHECKIN"].includes(session.status),
      );

      for (const session of candidates) {
        const config = await this.apiClient
          .getSessionDiscordConfig(session.id)
          .catch(() => null);
        if (
          config?.enabled !== false &&
          config?.guildId === guildId &&
          config?.registrationChannelId === channelId
        ) {
          const transition =
            await this.applyDueWeeklyRegistrationScheduleTransition(
              session,
              config,
            );
          return {
            session: transition.session,
            config: transition.config,
            accepting: this.publicRegistrationAccepting(
              transition.session,
              transition.config,
            ),
          };
        }
      }

      return null;
    } catch (error) {
      throw new Error(toFriendlyApiError(error));
    }
  }

  async findScrimForWaitlistChannel(
    guildId: string,
    channelId: string,
    channelTopic?: string | null,
  ): Promise<{
    session: SessionResponse;
    config: SessionDiscordConfigResponse;
    accepting: boolean;
  } | null> {
    try {
      const resolveCandidate = async (
        session: SessionResponse,
        config: SessionDiscordConfigResponse,
      ) => {
        return this.withOrganization(config.organizationId, async () => {
          const transition =
            await this.applyDueWeeklyWaitlistPromotionScheduleTransition(
              session,
              config,
            );
          const registrations = await this.apiClient.listRegistrations(
            transition.session.id,
          );
          return {
            session: transition.session,
            config: transition.config,
            accepting: this.waitlistPromotionAccepting(
              transition.session,
              transition.config,
              registrations,
            ),
          };
        });
      };

      const resolved = await this.resolveDiscordChannel(
        guildId,
        channelId,
        channelTopic,
      );
      if (resolved) {
        if (
          resolved.channelKind !== "waitlist" ||
          resolved.session.type !== "SCRIM" ||
          !["DRAFT", "OPEN", "CHECKIN"].includes(resolved.session.status)
        ) {
          return null;
        }
        return resolveCandidate(resolved.session, resolved.config);
      }

      const sessions = await this.apiClient.listSessions();
      const candidates = sessions.filter(
        (session) =>
          session.type === "SCRIM" &&
          ["DRAFT", "OPEN", "CHECKIN"].includes(session.status),
      );

      for (const session of candidates) {
        const config = await this.apiClient
          .getSessionDiscordConfig(session.id)
          .catch(() => null);
        if (
          config?.enabled !== false &&
          config?.guildId === guildId &&
          config?.waitlistChannelId === channelId
        ) {
          return resolveCandidate(session, config);
        }
      }

      return null;
    } catch (error) {
      throw new Error(toFriendlyApiError(error));
    }
  }

  async findScrimForSlotListChannel(
    guildId: string,
    channelId: string,
    channelTopic?: string | null,
  ): Promise<{
    session: SessionResponse;
    config: SessionDiscordConfigResponse;
  } | null> {
    try {
      const resolved = await this.resolveDiscordChannel(
        guildId,
        channelId,
        channelTopic,
      );
      if (resolved) {
        if (
          resolved.channelKind !== "slot-list" ||
          resolved.session.type !== "SCRIM" ||
          !["OPEN", "CHECKIN", "LOCKED", "LIVE"].includes(
            resolved.session.status,
          )
        ) {
          return null;
        }
        return { session: resolved.session, config: resolved.config };
      }

      const sessions = await this.apiClient.listSessions();
      const candidates = sessions.filter(
        (session) =>
          session.type === "SCRIM" &&
          ["OPEN", "CHECKIN", "LOCKED", "LIVE"].includes(session.status),
      );

      for (const session of candidates) {
        const config = await this.apiClient
          .getSessionDiscordConfig(session.id)
          .catch(() => null);
        if (
          config?.enabled !== false &&
          config?.guildId === guildId &&
          config?.slotListChannelId === channelId
        ) {
          return { session, config };
        }
      }

      return null;
    } catch (error) {
      throw new Error(toFriendlyApiError(error));
    }
  }

  async findScrimForLogoChannel(
    guildId: string,
    channelId: string,
    channelTopic?: string | null,
  ): Promise<{
    session: SessionResponse;
    config: SessionDiscordConfigResponse;
    organizationLogoChannel?: boolean;
  } | null> {
    try {
      const resolved = await this.resolveDiscordChannel(
        guildId,
        channelId,
        channelTopic,
      );
      if (resolved) {
        const sessionLogoChannel = this.configuredLogoChannelIds(
          resolved.config,
        ).includes(channelId);
        if (
          resolved.session.type !== "SCRIM" ||
          (resolved.channelKind !== "logos" && !sessionLogoChannel)
        ) {
          return null;
        }
        return {
          session: resolved.session,
          config: resolved.config,
          organizationLogoChannel:
            resolved.channelKind === "logos" && !sessionLogoChannel,
        };
      }

      const sessions = await this.apiClient.listSessions();
      const candidates = sessions.filter((session) => session.type === "SCRIM");

      for (const session of candidates) {
        const config = await this.apiClient
          .getSessionDiscordConfig(session.id)
          .catch(() => null);
        if (
          config?.enabled === false ||
          config?.guildId !== guildId ||
          !this.configuredLogoChannelIds(config).includes(channelId)
        ) {
          continue;
        }
        return { session, config };
      }

      return null;
    } catch (error) {
      throw new Error(toFriendlyApiError(error));
    }
  }

  async findScrimForPlayerPhotoChannel(
    guildId: string,
    channelId: string,
    channelTopic?: string | null,
  ): Promise<{
    session: SessionResponse;
    config: SessionDiscordConfigResponse;
  } | null> {
    try {
      const resolved = await this.resolveDiscordChannel(
        guildId,
        channelId,
        channelTopic,
      );
      if (resolved) {
        const sessionPhotoChannel = this.configuredPlayerPhotoChannelIds(
          resolved.config,
        ).includes(channelId);
        if (
          resolved.session.type !== "SCRIM" ||
          (resolved.channelKind !== "player-photos" && !sessionPhotoChannel)
        ) {
          return null;
        }
        return {
          session: resolved.session,
          config: resolved.config,
        };
      }

      const sessions = await this.apiClient.listSessions();
      const candidates = sessions.filter((session) => session.type === "SCRIM");

      for (const session of candidates) {
        const config = await this.apiClient
          .getSessionDiscordConfig(session.id)
          .catch(() => null);
        if (
          config?.enabled === false ||
          config?.guildId !== guildId ||
          !this.configuredPlayerPhotoChannelIds(config).includes(channelId)
        ) {
          continue;
        }
        return { session, config };
      }

      return null;
    } catch (error) {
      throw new Error(toFriendlyApiError(error));
    }
  }

  async findScrimForDiscordChannel(
    guildId: string,
    channelId: string,
    channelTopic?: string | null,
  ): Promise<{
    session: SessionResponse;
    config: SessionDiscordConfigResponse;
    channelKind: string;
  } | null> {
    try {
      const resolved = await this.resolveDiscordChannel(
        guildId,
        channelId,
        channelTopic,
      );
      if (resolved) {
        if (
          resolved.session.type !== "SCRIM" ||
          !["OPEN", "CHECKIN", "LOCKED", "LIVE", "ENDED"].includes(
            resolved.session.status,
          )
        ) {
          return null;
        }
        return {
          session: resolved.session,
          config: resolved.config,
          channelKind: resolved.channelKind,
        };
      }

      const organizationId = await this.resolveOrganizationIdForGuild(guildId);
      if (!organizationId) {
        return null;
      }

      const sessions = await this.withOrganization(organizationId, () =>
        this.apiClient.listSessions(),
      );
      const candidates = sessions.filter(
        (session) =>
          session.type === "SCRIM" &&
          ["OPEN", "CHECKIN", "LOCKED", "LIVE", "ENDED"].includes(
            session.status,
          ),
      );

      for (const session of candidates) {
        const config = await this.withOrganization(organizationId, () =>
          this.apiClient.getSessionDiscordConfig(session.id),
        ).catch(() => null);
        if (config?.enabled === false || config?.guildId !== guildId) {
          continue;
        }

        const channelMap: Array<[string, string | null]> = [
          ["registration", config.registrationChannelId],
          ["slot-list", config.slotListChannelId],
          ["waitlist", config.waitlistChannelId],
          ["idp", config.idpChannelId],
          ["manager", config.managerChannelId],
          ["transfer", config.transferChannelId],
          ["manage", config.manageChannelId],
          ["results", config.resultsChannelId],
          ["screenshots", config.screenshotsChannelId],
          ["bans", config.bansChannelId],
          ["log", config.logChannelId],
        ];
        const matched = channelMap.find(([, id]) => id === channelId);
        if (matched) {
          return { session, config, channelKind: matched[0] };
        }
        if (this.configuredPlayerPhotoChannelIds(config).includes(channelId)) {
          return { session, config, channelKind: "player-photos" };
        }
      }

      return null;
    } catch (error) {
      throw new Error(toFriendlyApiError(error));
    }
  }

  private async findScrimForPlayStatusMessage(
    guildId: string,
    channelId: string,
    messageId: string,
  ): Promise<{
    session: SessionResponse;
    config: SessionDiscordConfigResponse;
  } | null> {
    try {
      const resolved = await this.resolveDiscordChannel(guildId, channelId);
      if (resolved) {
        const managedIds = [
          resolved.config.emojis?.managedSlotListMessageId,
          resolved.config.emojis?.managedConfirmationMessageId,
        ]
          .map((value) => value?.trim())
          .filter(Boolean);
        if (
          resolved.channelKind !== "slot-list" ||
          resolved.session.type !== "SCRIM" ||
          !["OPEN", "CHECKIN", "LOCKED", "LIVE"].includes(
            resolved.session.status,
          ) ||
          !managedIds.includes(messageId)
        ) {
          return null;
        }
        return { session: resolved.session, config: resolved.config };
      }

      const sessions = await this.apiClient.listSessions();
      const candidates = sessions.filter(
        (session) =>
          session.type === "SCRIM" &&
          ["OPEN", "CHECKIN", "LOCKED", "LIVE"].includes(session.status),
      );

      for (const session of candidates) {
        const config = await this.apiClient
          .getSessionDiscordConfig(session.id)
          .catch(() => null);
        const managedIds = [
          config?.emojis?.managedSlotListMessageId,
          config?.emojis?.managedConfirmationMessageId,
        ]
          .map((value) => value?.trim())
          .filter(Boolean);
        if (
          config?.enabled !== false &&
          config?.guildId === guildId &&
          config?.slotListChannelId === channelId &&
          managedIds.includes(messageId)
        ) {
          return { session, config };
        }
      }

      return null;
    } catch (error) {
      throw new Error(toFriendlyApiError(error));
    }
  }

  private setupToDiscordConfigPayload(
    setup: ScrimDiscordSetup,
    guildId: string,
    config?: SessionDiscordConfigResponse | null,
  ): UpdateSessionDiscordConfigPayload {
    const staffRoleId = setup.staffRoleId ?? config?.emojis?.staffRoleId ?? "";
    const staffRoleName =
      setup.staffRoleName ?? config?.emojis?.staffRoleName ?? "Arenzyra Staff";
    const configuredManageRoleIds = (config?.manageRoleIds ?? []).filter(
      (roleId) => roleId.trim().length > 0,
    );
    const manageRoleIds = (
      configuredManageRoleIds.length > 0
        ? configuredManageRoleIds
        : [staffRoleId]
    ).filter(
      (roleId, index, roleIds) => roleId && roleIds.indexOf(roleId) === index,
    );
    return {
      guildId,
      categoryId: setup.categoryId,
      categoryName: setup.categoryName,
      registrationChannelId: setup.registrationChannelId,
      registrationChannelName: setup.registrationChannelName,
      slotListChannelId: setup.slotListChannelId,
      slotListChannelName: setup.slotListChannelName,
      waitlistChannelId: setup.waitlistChannelId,
      waitlistChannelName: setup.waitlistChannelName,
      idpChannelId: setup.idpChannelId,
      idpChannelName: setup.idpChannelName,
      managerChannelId: setup.managerChannelId,
      managerChannelName: setup.managerChannelName,
      transferChannelId: setup.transferChannelId,
      transferChannelName: setup.transferChannelName,
      manageChannelId: setup.manageChannelId,
      manageChannelName: setup.manageChannelName,
      resultsChannelId: setup.resultsChannelId,
      resultsChannelName: setup.resultsChannelName,
      screenshotsChannelId: setup.screenshotsChannelId,
      screenshotsChannelName: setup.screenshotsChannelName,
      bansChannelId: setup.bansChannelId,
      bansChannelName: setup.bansChannelName,
      logChannelId: setup.logChannelId,
      logChannelName: setup.logChannelName,
      slotRoleId: setup.slotRoleId ?? config?.slotRoleId ?? null,
      slotRoleName: setup.slotRoleName ?? config?.slotRoleName ?? null,
      manageRoleIds,
      waitlistRoleId: setup.waitlistRoleId ?? config?.waitlistRoleId ?? null,
      waitlistRoleName:
        setup.waitlistRoleName ?? config?.waitlistRoleName ?? null,
      idpRoleId: setup.idpRoleId ?? config?.idpRoleId ?? null,
      idpRoleName: setup.idpRoleName ?? config?.idpRoleName ?? null,
      bannedRoleId: setup.bannedRoleId ?? config?.bannedRoleId ?? null,
      bannedRoleName: setup.bannedRoleName ?? config?.bannedRoleName ?? null,
      emojis: {
        ...(config?.emojis ?? {}),
        staffRoleId,
        staffRoleName,
      },
    };
  }

  private async latestSessionDiscordConfig(
    sessionId: string,
    fallback: SessionDiscordConfigResponse,
  ) {
    try {
      return await this.apiClient.getSessionDiscordConfig(sessionId);
    } catch {
      return fallback;
    }
  }

  private async persistDiscordSetupConfig(
    sessionId: string,
    setup: ScrimDiscordSetup,
    guildId: string,
    config: SessionDiscordConfigResponse,
  ) {
    const latestConfig = await this.latestSessionDiscordConfig(
      sessionId,
      config,
    );
    return this.apiClient.updateSessionDiscordConfig(
      sessionId,
      this.setupToDiscordConfigPayload(setup, guildId, latestConfig),
    );
  }

  private async persistManagedMessageIds(
    sessionId: string,
    config: SessionDiscordConfigResponse,
    messageIds: Record<string, string | undefined> | void,
  ) {
    if (!messageIds) {
      return config;
    }

    const latestConfig = await this.latestSessionDiscordConfig(
      sessionId,
      config,
    );
    const nextEmojis = { ...(latestConfig.emojis ?? {}) };
    let changed = false;

    for (const [key, value] of Object.entries(messageIds)) {
      const normalized = value?.trim() ?? "";
      if (nextEmojis[key] !== normalized) {
        nextEmojis[key] = normalized;
        changed = true;
      }
    }

    if (!changed) {
      return latestConfig;
    }

    return this.apiClient.updateSessionDiscordConfig(sessionId, {
      emojis: nextEmojis,
    });
  }

  private registrationStatusAnnouncementMarker(sessionId: string) {
    return `arenzyra:${sessionId}:registration-status`;
  }

  private registrationStatusAnnouncementState(
    session: SessionResponse,
    config: SessionDiscordConfigResponse,
  ): RegistrationStatusAnnouncementState {
    return this.publicRegistrationWindow(session, config).allowsAction
      ? "open"
      : "closed";
  }

  private storedRegistrationStatusAnnouncementState(
    config: SessionDiscordConfigResponse,
  ): RegistrationStatusAnnouncementState | null {
    const value = config.emojis?.managedRegistrationStatusState
      ?.trim()
      .toLowerCase();
    return value === "open" || value === "closed" ? value : null;
  }

  private managedRegistrationStatusAnnouncementMessageId(
    config: SessionDiscordConfigResponse,
  ) {
    const value = config.emojis?.managedRegistrationStatusMessageId?.trim();
    return value && /^\d+$/.test(value) ? value : null;
  }

  private messageHasRegistrationStatusMarker(
    message: Message,
    markerText: string,
  ) {
    return (
      message.content?.includes(markerText) ||
      message.embeds.some(
        (embed) =>
          embed.footer?.text === markerText ||
          embed.fields.some(
            (field) => field.name === "\u200B" && field.value === markerText,
          ),
      )
    );
  }

  private registrationStatusAnnouncementMessageText(message: Message) {
    const parts = [message.content ?? ""];
    for (const embed of message.embeds) {
      parts.push(embed.title ?? "", embed.description ?? "");
      for (const field of embed.fields ?? []) {
        parts.push(field.name ?? "", field.value ?? "");
      }
      parts.push(embed.footer?.text ?? "");
    }
    return parts.join("\n");
  }

  private messageMatchesRegistrationStatusAnnouncement(
    message: Message,
    markerText: string,
  ) {
    if (this.messageHasRegistrationStatusMarker(message, markerText)) {
      return true;
    }

    const text = this.registrationStatusAnnouncementMessageText(message);
    return (
      /\bRegistration\s+(?:Open|Closed)\b/i.test(text) &&
      /\bRegistration is (?:now )?(?:open|closed)\b/i.test(text)
    );
  }

  private messageMatchesAccessAnnouncement(
    message: Message,
    markerText: string,
    kind: AccessAnnouncementKind,
  ) {
    if (this.messageHasRegistrationStatusMarker(message, markerText)) {
      return true;
    }

    const text = this.registrationStatusAnnouncementMessageText(message);
    const titlePattern =
      kind === "earlyAccess"
        ? /\bEarly\s+Access\s+(?:Open|Closed)\b/i
        : /\bVIP\s+Access\s+(?:Open|Closed)\b/i;
    return titlePattern.test(text);
  }

  private async deleteRegistrationStatusAnnouncements(
    channel: GuildTextBasedChannel,
    messageId: string | null,
    markerText: string,
  ) {
    const botUserId = channel.client.user?.id;
    if (!botUserId) {
      return;
    }

    const deletedIds = new Set<string>();
    const stored = messageId
      ? await channel.messages.fetch(messageId).catch(() => null)
      : null;
    if (stored && stored.author.id === botUserId) {
      await stored.delete().catch(() => undefined);
      deletedIds.add(stored.id);
    }

    const messages = await channel.messages
      .fetch({ limit: 100 })
      .catch(() => null);
    for (const message of messages?.values() ?? []) {
      if (
        deletedIds.has(message.id) ||
        message.author.id !== botUserId ||
        !this.messageMatchesRegistrationStatusAnnouncement(message, markerText)
      ) {
        continue;
      }
      await message.delete().catch(() => undefined);
      deletedIds.add(message.id);
    }
  }

  private async cleanupDuplicateRegistrationStatusAnnouncements(
    channel: GuildTextBasedChannel,
    messageId: string | null,
    markerText: string,
  ) {
    const botUserId = channel.client.user?.id;
    if (!botUserId) {
      return;
    }

    const messages = await channel.messages
      .fetch({ limit: 100 })
      .catch(() => null);
    for (const message of messages?.values() ?? []) {
      if (
        message.id === messageId ||
        message.author.id !== botUserId ||
        !this.messageMatchesRegistrationStatusAnnouncement(message, markerText)
      ) {
        continue;
      }
      await message.delete().catch(() => undefined);
    }
  }

  private async deleteAccessAnnouncements(
    channel: GuildTextBasedChannel,
    messageId: string | null,
    markerText: string,
    kind: AccessAnnouncementKind,
  ) {
    const botUserId = channel.client.user?.id;
    if (!botUserId) {
      return;
    }

    const deletedIds = new Set<string>();
    const stored = messageId
      ? await channel.messages.fetch(messageId).catch(() => null)
      : null;
    if (stored && stored.author.id === botUserId) {
      await stored.delete().catch(() => undefined);
      deletedIds.add(stored.id);
    }

    const messages = await channel.messages
      .fetch({ limit: 100 })
      .catch(() => null);
    for (const message of messages?.values() ?? []) {
      if (
        deletedIds.has(message.id) ||
        message.author.id !== botUserId ||
        !this.messageMatchesAccessAnnouncement(message, markerText, kind)
      ) {
        continue;
      }
      await message.delete().catch(() => undefined);
      deletedIds.add(message.id);
    }
  }

  private async cleanupDuplicateAccessAnnouncements(
    channel: GuildTextBasedChannel,
    messageId: string | null,
    markerText: string,
    kind: AccessAnnouncementKind,
  ) {
    const botUserId = channel.client.user?.id;
    if (!botUserId) {
      return;
    }

    const messages = await channel.messages
      .fetch({ limit: 100 })
      .catch(() => null);
    for (const message of messages?.values() ?? []) {
      if (
        message.id === messageId ||
        message.author.id !== botUserId ||
        !this.messageMatchesAccessAnnouncement(message, markerText, kind)
      ) {
        continue;
      }
      await message.delete().catch(() => undefined);
    }
  }

  private async findRecentAccessAnnouncement(
    channel: GuildTextBasedChannel,
    markerText: string,
    kind: AccessAnnouncementKind,
  ) {
    const botUserId = channel.client.user?.id;
    if (!botUserId) {
      return null;
    }

    const messages = await channel.messages
      .fetch({ limit: 100 })
      .catch(() => null);
    return (
      [...(messages?.values() ?? [])]
        .filter(
          (message) =>
            message.author.id === botUserId &&
            this.messageMatchesAccessAnnouncement(message, markerText, kind),
        )
        .sort((left, right) => right.createdTimestamp - left.createdTimestamp)
        .at(0) ?? null
    );
  }

  private async fetchRegistrationAnnouncementChannel(
    guild: Guild,
    config: SessionDiscordConfigResponse,
  ) {
    const channelId = config.registrationChannelId?.trim();
    if (!channelId) {
      return null;
    }

    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased() || channel.isDMBased()) {
      return null;
    }
    return channel as GuildTextBasedChannel;
  }

  private registrationStatusAnnouncementDisplayMode(
    config: SessionDiscordConfigResponse,
  ) {
    return config.emojis?.registrationStatusAnnouncementMode === "embed"
      ? "embed"
      : "plain";
  }

  private configuredRegistrationAnnouncementValue(
    config: SessionDiscordConfigResponse,
    key: string,
    fallback: string,
    options: { allowEmpty?: boolean } = {},
  ) {
    const emojis =
      config.emojis && typeof config.emojis === "object" ? config.emojis : {};
    if (!Object.prototype.hasOwnProperty.call(emojis, key)) {
      return fallback;
    }
    const value = emojis[key];
    if (typeof value !== "string") {
      return fallback;
    }
    const trimmed = value.trim();
    return trimmed || options.allowEmpty ? trimmed : fallback;
  }

  private registrationStatusAnnouncementTemplate(
    config: SessionDiscordConfigResponse,
    state: RegistrationStatusAnnouncementState,
  ) {
    const isOpen = state === "open";
    return {
      title: this.configuredRegistrationAnnouncementValue(
        config,
        isOpen
          ? "registrationOpenAnnouncementTitle"
          : "registrationClosedAnnouncementTitle",
        isOpen ? "Registration Open" : "Registration Closed",
      ),
      text: this.configuredRegistrationAnnouncementValue(
        config,
        isOpen
          ? "registrationOpenAnnouncementText"
          : "registrationClosedAnnouncementText",
        isOpen
          ? `${this.emoji("check", config)} Registration is now open for {session}.\n\n**Window**\n{status}`
          : `${this.emoji("reject", config)} Registration is now closed for {session}.\n\n**Window**\n{status}`,
        { allowEmpty: true },
      ),
    };
  }

  private windowScheduleSuffix(window: {
    mode: string;
    timeZone: string | null;
  }) {
    if (!window.timeZone) {
      return "";
    }
    return ` ${window.mode === "weekly" ? "weekly" : "daily"} (${window.timeZone})`;
  }

  private renderRegistrationStatusAnnouncementTemplate(
    template: string,
    guild: Guild,
    session: SessionResponse,
    config: SessionDiscordConfigResponse,
  ) {
    const window = registrationWindowForSession(session, config);
    const replacements: Record<string, string> = {
      guild: guild.name,
      server: guild.name,
      session: session.name,
      status: registrationWindowStatusTextForSession(session, config),
      success: this.emoji("check", config),
      reject: this.emoji("reject", config),
      warning: this.emoji("warning", config),
      clock: this.emoji("clock", config),
      slot: this.emoji("slot", config),
      waitlist: this.emoji("waitlist", config),
      team: this.emoji("team", config),
      opens: this.accessTimestamp(window.opensAt, "f"),
      opensRelative: this.accessTimestamp(window.opensAt, "R"),
      closes: this.accessTimestamp(window.closesAt, "f"),
      closesRelative: this.accessTimestamp(window.closesAt, "R"),
      timezone: window.timeZone ?? "",
      schedule: this.windowScheduleSuffix(window),
    };

    return template
      .replace(/\{([A-Za-z]+)\}/g, (match, key: string) => {
        return replacements[key] ?? match;
      })
      .replace(/[ \t]+([.,])/g, "$1")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  private registrationStatusAnnouncementContent(
    guild: Guild,
    session: SessionResponse,
    config: SessionDiscordConfigResponse,
    state: RegistrationStatusAnnouncementState,
  ) {
    const template = this.registrationStatusAnnouncementTemplate(config, state);
    const title = this.renderRegistrationStatusAnnouncementTemplate(
      template.title,
      guild,
      session,
      config,
    ).slice(0, 256);
    const description = this.renderRegistrationStatusAnnouncementTemplate(
      template.text,
      guild,
      session,
      config,
    );
    return {
      mode: this.registrationStatusAnnouncementDisplayMode(config),
      title:
        title ||
        (state === "open" ? "Registration Open" : "Registration Closed"),
      description,
    };
  }

  private registrationStatusAnnouncementSignature(
    guild: Guild,
    session: SessionResponse,
    config: SessionDiscordConfigResponse,
    state: RegistrationStatusAnnouncementState,
  ) {
    return createHash("sha256")
      .update(
        JSON.stringify(
          this.registrationStatusAnnouncementContent(
            guild,
            session,
            config,
            state,
          ),
        ),
      )
      .digest("hex");
  }

  private async replaceRegistrationStatusAnnouncement(
    guild: Guild,
    session: SessionResponse,
    config: SessionDiscordConfigResponse,
    state: RegistrationStatusAnnouncementState,
  ) {
    const channel = await this.fetchRegistrationAnnouncementChannel(
      guild,
      config,
    );
    if (!channel) {
      return null;
    }

    const markerText = this.registrationStatusAnnouncementMarker(session.id);
    await this.deleteRegistrationStatusAnnouncements(
      channel,
      this.managedRegistrationStatusAnnouncementMessageId(config),
      markerText,
    );

    const content = this.registrationStatusAnnouncementContent(
      guild,
      session,
      config,
      state,
    );

    if (content.mode === "embed") {
      const embed = new EmbedBuilder()
        .setColor(state === "open" ? 0x22c55e : 0xef4444)
        .setTitle(content.title)
        .setFooter({ text: markerText });
      if (content.description) {
        embed.setDescription(content.description.slice(0, 4096));
      }
      const mentionSource = [content.title, content.description].join("\n");
      const mentionContent = mentionContentForOrganizerText(mentionSource);
      return channel.send({
        ...(mentionContent ? { content: mentionContent } : {}),
        embeds: [embed],
        allowedMentions: allowedMentionsForOrganizerText(mentionSource),
      });
    }

    const message = limitDiscordContent(
      [`**${content.title}**`, content.description]
        .filter(Boolean)
        .join("\n\n"),
    );
    return channel.send({
      content: message,
      allowedMentions: allowedMentionsForOrganizerText(message),
    });
  }

  private async persistRegistrationStatusAnnouncementTracking(
    sessionId: string,
    config: SessionDiscordConfigResponse,
    state: RegistrationStatusAnnouncementState,
    messageId?: string | null,
    signature?: string | null,
  ) {
    return this.persistManagedMessageIds(sessionId, config, {
      managedRegistrationStatusState: state,
      ...(messageId !== undefined
        ? { managedRegistrationStatusMessageId: messageId ?? "" }
        : {}),
      ...(signature !== undefined
        ? { managedRegistrationStatusSignature: signature ?? "" }
        : {}),
    });
  }

  private accessAnnouncementMarker(
    sessionId: string,
    kind: AccessAnnouncementKind,
  ) {
    return `arenzyra:${sessionId}:${kind}-access-status`;
  }

  private accessAnnouncementTitle(
    kind: AccessAnnouncementKind,
    state: AccessAnnouncementState,
  ) {
    if (kind === "earlyAccess") {
      return state === "open" ? "Early Access Open" : "Early Access Closed";
    }
    return state === "open" ? "VIP Access Open" : "VIP Access Closed";
  }

  private accessAnnouncementKeys(kind: AccessAnnouncementKind) {
    return kind === "earlyAccess"
      ? {
          state: "managedEarlyAccessStatusState",
          messageId: "managedEarlyAccessStatusMessageId",
          messageEnabled: "earlyAccessMessageEnabled",
          openText: "earlyAccessOpenMessageText",
          closeText: "earlyAccessCloseMessageText",
        }
      : {
          state: "managedVipAccessStatusState",
          messageId: "managedVipAccessStatusMessageId",
          messageEnabled: "vipAccessMessageEnabled",
          openText: "vipAccessOpenMessageText",
          closeText: "vipAccessCloseMessageText",
        };
  }

  private storedAccessAnnouncementState(
    config: SessionDiscordConfigResponse,
    kind: AccessAnnouncementKind,
  ): AccessAnnouncementState | null {
    const key = this.accessAnnouncementKeys(kind).state;
    const value = config.emojis?.[key]?.trim().toLowerCase();
    return value === "open" || value === "closed" ? value : null;
  }

  private managedAccessAnnouncementMessageId(
    config: SessionDiscordConfigResponse,
    kind: AccessAnnouncementKind,
  ) {
    const key = this.accessAnnouncementKeys(kind).messageId;
    const value = config.emojis?.[key]?.trim();
    return value && /^\d+$/.test(value) ? value : null;
  }

  private accessAnnouncementMessageEnabled(
    config: SessionDiscordConfigResponse,
    kind: AccessAnnouncementKind,
  ) {
    const key = this.accessAnnouncementKeys(kind).messageEnabled;
    return config.emojis?.[key] !== "false";
  }

  private accessAnnouncementTemplate(
    config: SessionDiscordConfigResponse,
    kind: AccessAnnouncementKind,
    state: AccessAnnouncementState,
  ) {
    const keys = this.accessAnnouncementKeys(kind);
    const key = state === "open" ? keys.openText : keys.closeText;
    return config.emojis?.[key]?.trim() ?? "";
  }

  private renderAccessAnnouncementTemplate(
    template: string,
    values: Record<string, string>,
  ) {
    return this.renderConfirmationReminderTemplate(template, values);
  }

  private roleAccessGroupsJson(groups: RoleAccessGroup[]) {
    return JSON.stringify({ version: 1, groups });
  }

  private customAccessAnnouncementMarker(sessionId: string, groupId: string) {
    return `arenzyra:${sessionId}:role-access:${groupId}`;
  }

  private customAccessAnnouncementTitle(
    group: RoleAccessGroup,
    state: AccessAnnouncementState,
  ) {
    return `${group.name} Access ${state === "open" ? "Open" : "Closed"}`;
  }

  private customAccessAnnouncementMessageId(group: RoleAccessGroup) {
    const value = group.managedMessageId?.trim();
    return value && /^\d+$/.test(value) ? value : null;
  }

  private messageMatchesCustomAccessAnnouncement(
    message: Message,
    markerText: string,
    title: string,
  ) {
    if (this.messageHasRegistrationStatusMarker(message, markerText)) {
      return true;
    }
    return this.registrationStatusAnnouncementMessageText(message).includes(
      title,
    );
  }

  private async deleteCustomAccessAnnouncements(
    channel: GuildTextBasedChannel,
    messageId: string | null,
    markerText: string,
    title: string,
  ) {
    const botUserId = channel.client.user?.id;
    if (!botUserId) {
      return;
    }

    const deletedIds = new Set<string>();
    const stored = messageId
      ? await channel.messages.fetch(messageId).catch(() => null)
      : null;
    if (stored && stored.author.id === botUserId) {
      await stored.delete().catch(() => undefined);
      deletedIds.add(stored.id);
    }

    const messages = await channel.messages
      .fetch({ limit: 100 })
      .catch(() => null);
    for (const message of messages?.values() ?? []) {
      if (
        deletedIds.has(message.id) ||
        message.author.id !== botUserId ||
        !this.messageMatchesCustomAccessAnnouncement(message, markerText, title)
      ) {
        continue;
      }
      await message.delete().catch(() => undefined);
      deletedIds.add(message.id);
    }
  }

  private async cleanupDuplicateCustomAccessAnnouncements(
    channel: GuildTextBasedChannel,
    messageId: string | null,
    markerText: string,
    title: string,
  ) {
    const botUserId = channel.client.user?.id;
    if (!botUserId) {
      return;
    }

    const messages = await channel.messages
      .fetch({ limit: 100 })
      .catch(() => null);
    for (const message of messages?.values() ?? []) {
      if (
        message.id === messageId ||
        message.author.id !== botUserId ||
        !this.messageMatchesCustomAccessAnnouncement(message, markerText, title)
      ) {
        continue;
      }
      await message.delete().catch(() => undefined);
    }
  }

  private async findRecentCustomAccessAnnouncement(
    channel: GuildTextBasedChannel,
    markerText: string,
    title: string,
  ) {
    const botUserId = channel.client.user?.id;
    if (!botUserId) {
      return null;
    }

    const messages = await channel.messages
      .fetch({ limit: 100 })
      .catch(() => null);
    return (
      [...(messages?.values() ?? [])]
        .filter(
          (message) =>
            message.author.id === botUserId &&
            this.messageMatchesCustomAccessAnnouncement(
              message,
              markerText,
              title,
            ),
        )
        .sort((left, right) => right.createdTimestamp - left.createdTimestamp)
        .at(0) ?? null
    );
  }

  private async persistRoleAccessGroupTracking(
    sessionId: string,
    config: SessionDiscordConfigResponse,
    groupId: string,
    patch: Partial<Pick<RoleAccessGroup, "managedState" | "managedMessageId">>,
  ) {
    const latestConfig = await this.latestSessionDiscordConfig(
      sessionId,
      config,
    );
    const groups = parseRoleAccessGroups(latestConfig);
    const nextGroups = groups.map((group) =>
      group.id === groupId ? { ...group, ...patch } : group,
    );
    return this.persistManagedMessageIds(sessionId, latestConfig, {
      roleAccessGroups: this.roleAccessGroupsJson(nextGroups),
    });
  }

  private async replaceCustomAccessAnnouncement(
    guild: Guild,
    session: SessionResponse,
    config: SessionDiscordConfigResponse,
    group: RoleAccessGroup,
    state: AccessAnnouncementState,
    window: AccessWindowSnapshot,
  ) {
    const channel = await this.fetchRegistrationAnnouncementChannel(
      guild,
      config,
    );
    if (!channel) {
      return null;
    }

    const title = this.customAccessAnnouncementTitle(group, state);
    const markerText = this.customAccessAnnouncementMarker(
      session.id,
      group.id,
    );
    await this.deleteCustomAccessAnnouncements(
      channel,
      this.customAccessAnnouncementMessageId(group),
      markerText,
      title,
    );

    const roleMention = group.roleId ? `<@&${group.roleId}>` : "";
    const content = this.renderAccessAnnouncementTemplate(
      state === "open" ? group.openMessageText : group.closeMessageText,
      {
        role: roleMention,
        roleName: group.roleName,
        name: group.name,
        session: session.name,
        opens: this.accessTimestamp(window.opensAt, "f"),
        opensRelative: this.accessTimestamp(window.opensAt, "R"),
        closes: this.accessTimestamp(window.closesAt, "f"),
        closesRelative: this.accessTimestamp(window.closesAt, "R"),
      },
    );
    if (!content) {
      return null;
    }

    const message = limitDiscordContent(
      [`**${title}**`, content].filter(Boolean).join("\n\n"),
    );
    return channel.send({
      content: message,
      allowedMentions: allowedMentionsForOrganizerText(message, {
        roles: group.roleId ? [group.roleId] : [],
      }),
    });
  }

  private accessTimestamp(date: Date | null, style: "f" | "R") {
    return date ? `<t:${Math.floor(date.getTime() / 1000)}:${style}>` : "";
  }

  private async persistAccessAnnouncementTracking(
    sessionId: string,
    config: SessionDiscordConfigResponse,
    kind: AccessAnnouncementKind,
    state: AccessAnnouncementState,
    messageId?: string | null,
  ) {
    const keys = this.accessAnnouncementKeys(kind);
    return this.persistManagedMessageIds(sessionId, config, {
      [keys.state]: state,
      ...(messageId !== undefined ? { [keys.messageId]: messageId ?? "" } : {}),
    });
  }

  private async replaceAccessAnnouncement(
    guild: Guild,
    session: SessionResponse,
    config: SessionDiscordConfigResponse,
    kind: AccessAnnouncementKind,
    state: AccessAnnouncementState,
    window: AccessWindowSnapshot,
  ) {
    const channel = await this.fetchRegistrationAnnouncementChannel(
      guild,
      config,
    );
    if (!channel) {
      return null;
    }

    const markerText = this.accessAnnouncementMarker(session.id, kind);
    await this.deleteAccessAnnouncements(
      channel,
      this.managedAccessAnnouncementMessageId(config, kind),
      markerText,
      kind,
    );

    const roleId = this.accessRoleId(config, kind);
    const roleMention = roleId ? `<@&${roleId}>` : "";
    const content = this.renderAccessAnnouncementTemplate(
      this.accessAnnouncementTemplate(config, kind, state),
      {
        role: roleMention,
        roleName: this.accessRoleName(config, kind) ?? "",
        session: session.name,
        opens: this.accessTimestamp(window.opensAt, "f"),
        opensRelative: this.accessTimestamp(window.opensAt, "R"),
        closes: this.accessTimestamp(window.closesAt, "f"),
        closesRelative: this.accessTimestamp(window.closesAt, "R"),
      },
    );
    if (!content) {
      return null;
    }

    const message = limitDiscordContent(
      [`**${this.accessAnnouncementTitle(kind, state)}**`, content]
        .filter(Boolean)
        .join("\n\n"),
    );

    return channel.send({
      content: message,
      allowedMentions: allowedMentionsForOrganizerText(message, {
        roles: roleId ? [roleId] : [],
      }),
    });
  }

  private async syncAccessAnnouncement(
    guild: Guild,
    session: SessionResponse,
    config: SessionDiscordConfigResponse,
    kind: AccessAnnouncementKind,
  ) {
    const key = this.syncQueueKey(guild, `${session.id}:${kind}`);
    const release = await this.acquireRegistrationStatusAnnouncementLock(key);
    try {
      const latestConfig = await this.latestSessionDiscordConfig(
        session.id,
        config,
      );
      const window = this.accessWindow(latestConfig, kind);
      const nextState = window.state;
      const storedState = this.storedAccessAnnouncementState(
        latestConfig,
        kind,
      );
      const storedMessageId = this.managedAccessAnnouncementMessageId(
        latestConfig,
        kind,
      );

      if (!storedState) {
        return this.persistAccessAnnouncementTracking(
          session.id,
          latestConfig,
          kind,
          nextState,
        );
      }

      if (storedState === nextState) {
        const messageEnabled = this.accessAnnouncementMessageEnabled(
          latestConfig,
          kind,
        );
        if (!messageEnabled) {
          // Fall through so the old announcement is deleted below.
        } else if (!storedMessageId) {
          return latestConfig;
        } else {
          const channel = await this.fetchRegistrationAnnouncementChannel(
            guild,
            latestConfig,
          );
          if (!channel) {
            return latestConfig;
          }
          const storedMessage = await channel.messages
            .fetch(storedMessageId)
            .catch(() => null);
          const botUserId = channel.client.user?.id;
          if (
            storedMessage &&
            (!botUserId || storedMessage.author.id === botUserId)
          ) {
            await this.cleanupDuplicateAccessAnnouncements(
              channel,
              storedMessageId,
              this.accessAnnouncementMarker(session.id, kind),
              kind,
            );
            return latestConfig;
          }
          const markerText = this.accessAnnouncementMarker(session.id, kind);
          const recoveredMessage = await this.findRecentAccessAnnouncement(
            channel,
            markerText,
            kind,
          );
          if (recoveredMessage) {
            await this.cleanupDuplicateAccessAnnouncements(
              channel,
              recoveredMessage.id,
              markerText,
              kind,
            );
            return this.persistAccessAnnouncementTracking(
              session.id,
              latestConfig,
              kind,
              nextState,
              recoveredMessage.id,
            );
          }
          console.warn(
            `[DiscordSync] ${kind} announcement message missing session=${session.id} message=${storedMessageId}; recreating`,
          );
        }
      }

      const markerText = this.accessAnnouncementMarker(session.id, kind);
      const shouldSend =
        window.configured &&
        Boolean(this.accessRoleId(latestConfig, kind)) &&
        this.accessAnnouncementMessageEnabled(latestConfig, kind);
      if (!shouldSend) {
        const channel = await this.fetchRegistrationAnnouncementChannel(
          guild,
          latestConfig,
        );
        if (channel) {
          await this.deleteAccessAnnouncements(
            channel,
            storedMessageId,
            markerText,
            kind,
          );
        }
        return this.persistAccessAnnouncementTracking(
          session.id,
          latestConfig,
          kind,
          nextState,
          "",
        );
      }

      const message = await this.replaceAccessAnnouncement(
        guild,
        session,
        latestConfig,
        kind,
        nextState,
        window,
      );
      return this.persistAccessAnnouncementTracking(
        session.id,
        latestConfig,
        kind,
        nextState,
        message?.id ?? "",
      );
    } catch (error) {
      console.warn(
        `Access announcement failed for ${session.id} ${kind}: ${String(
          error,
        )}`,
      );
      return config;
    } finally {
      release();
    }
  }

  private async syncCustomRoleAccessGroupAnnouncement(
    guild: Guild,
    session: SessionResponse,
    config: SessionDiscordConfigResponse,
    initialGroup: RoleAccessGroup,
  ) {
    const key = this.syncQueueKey(
      guild,
      `${session.id}:roleAccess:${initialGroup.id}`,
    );
    const release = await this.acquireRegistrationStatusAnnouncementLock(key);
    try {
      const latestConfig = await this.latestSessionDiscordConfig(
        session.id,
        config,
      );
      const group =
        parseRoleAccessGroups(latestConfig).find(
          (entry) => entry.id === initialGroup.id,
        ) ?? initialGroup;
      const window = roleAccessGroupWindow(group, latestConfig);
      const nextState = window.state;
      const storedState =
        group.managedState === "open" || group.managedState === "closed"
          ? group.managedState
          : null;
      const storedMessageId = this.customAccessAnnouncementMessageId(group);

      if (!storedState) {
        return this.persistRoleAccessGroupTracking(
          session.id,
          latestConfig,
          group.id,
          { managedState: nextState },
        );
      }

      const markerText = this.customAccessAnnouncementMarker(
        session.id,
        group.id,
      );
      const title = this.customAccessAnnouncementTitle(group, nextState);
      if (storedState === nextState) {
        if (!group.messageEnabled) {
          // Fall through so the old announcement is deleted below.
        } else if (!storedMessageId) {
          return latestConfig;
        } else {
          const channel = await this.fetchRegistrationAnnouncementChannel(
            guild,
            latestConfig,
          );
          if (!channel) {
            return latestConfig;
          }
          const storedMessage = await channel.messages
            .fetch(storedMessageId)
            .catch(() => null);
          const botUserId = channel.client.user?.id;
          if (
            storedMessage &&
            (!botUserId || storedMessage.author.id === botUserId)
          ) {
            await this.cleanupDuplicateCustomAccessAnnouncements(
              channel,
              storedMessageId,
              markerText,
              title,
            );
            return latestConfig;
          }
          const recoveredMessage =
            await this.findRecentCustomAccessAnnouncement(
              channel,
              markerText,
              title,
            );
          if (recoveredMessage) {
            await this.cleanupDuplicateCustomAccessAnnouncements(
              channel,
              recoveredMessage.id,
              markerText,
              title,
            );
            return this.persistRoleAccessGroupTracking(
              session.id,
              latestConfig,
              group.id,
              {
                managedState: nextState,
                managedMessageId: recoveredMessage.id,
              },
            );
          }
          console.warn(
            `[DiscordSync] roleAccess announcement message missing session=${session.id} group=${group.id} message=${storedMessageId}; recreating`,
          );
        }
      }

      const shouldSend =
        window.configured && Boolean(group.roleId) && group.messageEnabled;
      if (!shouldSend) {
        const channel = await this.fetchRegistrationAnnouncementChannel(
          guild,
          latestConfig,
        );
        if (channel) {
          await this.deleteCustomAccessAnnouncements(
            channel,
            storedMessageId,
            markerText,
            title,
          );
        }
        return this.persistRoleAccessGroupTracking(
          session.id,
          latestConfig,
          group.id,
          { managedState: nextState, managedMessageId: "" },
        );
      }

      const message = await this.replaceCustomAccessAnnouncement(
        guild,
        session,
        latestConfig,
        group,
        nextState,
        window,
      );
      return this.persistRoleAccessGroupTracking(
        session.id,
        latestConfig,
        group.id,
        { managedState: nextState, managedMessageId: message?.id ?? "" },
      );
    } catch (error) {
      console.warn(
        `Role access announcement failed for ${session.id} ${initialGroup.id}: ${String(
          error,
        )}`,
      );
      return config;
    } finally {
      release();
    }
  }

  private async syncAccessWindowAnnouncements(
    guild: Guild,
    session: SessionResponse,
    config: SessionDiscordConfigResponse,
  ) {
    for (const kind of ["earlyAccess", "vipAccess"] as const) {
      await this.syncAccessAnnouncement(guild, session, config, kind);
    }
    for (const group of parseRoleAccessGroups(config)) {
      await this.syncCustomRoleAccessGroupAnnouncement(
        guild,
        session,
        config,
        group,
      );
    }
  }

  private async acquireRegistrationStatusAnnouncementLock(key: string) {
    while (this.registrationStatusAnnouncementLocks.has(key)) {
      await new Promise<void>((resolve) => {
        const waiters =
          this.registrationStatusAnnouncementWaiters.get(key) ?? [];
        waiters.push(resolve);
        this.registrationStatusAnnouncementWaiters.set(key, waiters);
      });
    }

    this.registrationStatusAnnouncementLocks.add(key);
    return () => {
      this.registrationStatusAnnouncementLocks.delete(key);
      const waiters = this.registrationStatusAnnouncementWaiters.get(key);
      const next = waiters?.shift();
      if (waiters && waiters.length > 0) {
        this.registrationStatusAnnouncementWaiters.set(key, waiters);
      } else {
        this.registrationStatusAnnouncementWaiters.delete(key);
      }
      next?.();
    };
  }

  private rememberRegistrationStatusAnnouncement(
    key: string,
    state: RegistrationStatusAnnouncementState,
    messageId: string,
  ) {
    this.registrationStatusAnnouncementMemory.set(key, {
      state,
      messageId,
      updatedAt: Date.now(),
    });
    if (this.registrationStatusAnnouncementMemory.size <= 1000) {
      return;
    }

    const oldest = [...this.registrationStatusAnnouncementMemory.entries()]
      .sort((left, right) => left[1].updatedAt - right[1].updatedAt)
      .slice(0, 200);
    for (const [oldKey] of oldest) {
      this.registrationStatusAnnouncementMemory.delete(oldKey);
    }
  }

  private async syncRegistrationStatusAnnouncement(
    guild: Guild,
    session: SessionResponse,
    config: SessionDiscordConfigResponse,
    options: RegistrationWindowSyncOptions,
  ) {
    if (!options.announceTransition) {
      return config;
    }

    const key = this.syncQueueKey(guild, session.id);
    const release = await this.acquireRegistrationStatusAnnouncementLock(key);
    try {
      const latestConfig = await this.latestSessionDiscordConfig(
        session.id,
        config,
      );
      const nextState = this.registrationStatusAnnouncementState(
        session,
        latestConfig,
      );
      const storedState =
        this.storedRegistrationStatusAnnouncementState(latestConfig);
      const storedMessageId =
        this.managedRegistrationStatusAnnouncementMessageId(latestConfig);
      const storedSignature =
        latestConfig.emojis?.managedRegistrationStatusSignature?.trim() ?? "";
      const nextSignature = this.registrationStatusAnnouncementSignature(
        guild,
        session,
        latestConfig,
        nextState,
      );
      const remembered = this.registrationStatusAnnouncementMemory.get(key);

      if (!storedState && options.announceOnlyWhenStoredStateChanges) {
        const tracked =
          await this.persistRegistrationStatusAnnouncementTracking(
            session.id,
            latestConfig,
            nextState,
            undefined,
            nextSignature,
          );
        this.rememberRegistrationStatusAnnouncement(
          key,
          nextState,
          storedMessageId ?? "",
        );
        return tracked;
      }

      if (
        remembered?.state === nextState &&
        remembered.messageId &&
        storedState !== nextState
      ) {
        return this.persistRegistrationStatusAnnouncementTracking(
          session.id,
          latestConfig,
          nextState,
          remembered.messageId,
          nextSignature,
        ).catch((error) => {
          console.warn(
            `Registration status announcement tracking retry failed for ${
              session.id
            }: ${String(error)}`,
          );
          return latestConfig;
        });
      }

      if (
        storedState === nextState &&
        storedMessageId &&
        storedSignature === nextSignature
      ) {
        const channel = await this.fetchRegistrationAnnouncementChannel(
          guild,
          latestConfig,
        );
        if (channel) {
          await this.cleanupDuplicateRegistrationStatusAnnouncements(
            channel,
            storedMessageId,
            this.registrationStatusAnnouncementMarker(session.id),
          );
        }
        this.rememberRegistrationStatusAnnouncement(
          key,
          nextState,
          storedMessageId,
        );
        return latestConfig;
      }

      const message = await this.replaceRegistrationStatusAnnouncement(
        guild,
        session,
        latestConfig,
        nextState,
      );
      if (!message) {
        return latestConfig;
      }

      this.rememberRegistrationStatusAnnouncement(key, nextState, message.id);
      return this.persistRegistrationStatusAnnouncementTracking(
        session.id,
        latestConfig,
        nextState,
        message.id,
        nextSignature,
      ).catch((error) => {
        console.warn(
          `Registration status announcement tracking failed for ${
            session.id
          }: ${String(error)}`,
        );
        return latestConfig;
      });
    } catch (error) {
      console.warn(
        `Registration status announcement failed for ${session.id}: ${String(
          error,
        )}`,
      );
      return config;
    } finally {
      release();
    }
  }

  private async syncRegistrationChannelStateFast(
    guild: Guild | null | undefined,
    session: SessionResponse,
    config: SessionDiscordConfigResponse | null,
  ) {
    if (!guild || !config) {
      return false;
    }

    const setup = this.setupFromConfig(config);
    if (!setup) {
      return false;
    }

    const startedAt = Date.now();
    try {
      const message = await this.scrimDiscordSetup.syncRegistrationChannelState(
        guild,
        setup,
        session,
        config,
      );
      await this.persistManagedMessageIds(session.id, config, {
        managedRegistrationPanelMessageId: message?.id ?? "",
      });
      this.logTiming(
        `fast registration channel refresh session=${session.id}`,
        startedAt,
      );
      return true;
    } catch (error) {
      console.warn(
        `Fast registration channel refresh failed for ${session.id}: ${String(
          error,
        )}`,
      );
      return false;
    }
  }

  private syncRegistrationWindowStateInBackground(
    guild: Guild | null | undefined,
    sessionId: string,
    options: RegistrationWindowSyncOptions = {},
  ) {
    if (!guild) {
      return;
    }
    void this.syncRegistrationWindowState(
      guild,
      sessionId,
      undefined,
      undefined,
      options,
    ).catch((error) => {
      console.warn(
        `Registration window refresh failed for ${sessionId}: ${String(error)}`,
      );
    });
  }

  private async applyDueWeeklyRegistrationScheduleTransition(
    session: SessionResponse,
    config: SessionDiscordConfigResponse,
    now = new Date(),
  ) {
    const overrideState = this.registrationScheduleOverrideState(config);
    if (overrideState !== "closed") {
      return { session, config };
    }

    const scheduledWindow = this.publicScheduledRegistrationWindow(
      session,
      config,
      now,
    );
    if (!scheduledWindow?.allowsAction || !scheduledWindow.opensAt) {
      return { session, config };
    }

    const overrideChangedAt = this.registrationScheduleOverrideChangedAt(
      session,
      config,
      overrideState,
    );
    if (
      overrideChangedAt &&
      overrideChangedAt.getTime() >= scheduledWindow.opensAt.getTime()
    ) {
      return { session, config };
    }

    const nextEmojis = {
      ...(config.emojis ?? {}),
      registrationManualState: "",
      registrationScheduleOverrideState: "",
      registrationScheduleOverrideUpdatedAt: "",
    };
    const updatedConfig = await this.apiClient.updateSessionDiscordConfig(
      session.id,
      {
        disableSlotAndVipRegistration: false,
        emojis: nextEmojis,
      },
    );

    let updatedSession = session;
    const sessionPatch: UpdateSessionPayload = {
      registrationOpenAt: null,
      registrationCloseAt: null,
    };
    if (session.status === "DRAFT") {
      sessionPatch.status = "OPEN";
    }
    try {
      updatedSession = await this.apiClient.updateSession(
        session.id,
        sessionPatch,
      );
    } catch (error) {
      console.warn(
        `Registration weekly schedule session timestamp update skipped: ${toFriendlyApiError(error)}`,
      );
    }

    console.log(
      `[DiscordSync] weekly registration schedule cleared closed override session=${session.id} opensAt=${scheduledWindow.opensAt.toISOString()}`,
    );
    return { session: updatedSession, config: updatedConfig };
  }

  private async applyDueWeeklyWaitlistPromotionScheduleTransition(
    session: SessionResponse,
    config: SessionDiscordConfigResponse,
    now = new Date(),
  ) {
    const overrideState = this.waitlistPromotionScheduleOverrideState(config);
    if (overrideState !== "closed") {
      return { session, config };
    }

    const scheduledWindow = this.publicScheduledWaitlistPromotionWindow(
      session,
      config,
      now,
    );
    if (!scheduledWindow?.allowsAction || !scheduledWindow.opensAt) {
      return { session, config };
    }

    const overrideChangedAt =
      this.waitlistPromotionScheduleOverrideChangedAt(config);
    if (
      overrideChangedAt &&
      overrideChangedAt.getTime() >= scheduledWindow.opensAt.getTime()
    ) {
      return { session, config };
    }

    const updatedConfig = await this.apiClient.updateSessionDiscordConfig(
      session.id,
      {
        emojis: {
          ...(config.emojis ?? {}),
          waitlistPromotionManualState: "",
          waitlistPromotionScheduleOverrideState: "",
          waitlistPromotionScheduleOverrideUpdatedAt: "",
        },
      },
    );

    console.log(
      `[DiscordSync] weekly waitlist promotion schedule cleared closed override session=${session.id} opensAt=${scheduledWindow.opensAt.toISOString()}`,
    );
    return { session, config: updatedConfig };
  }

  private async syncRegistrationWindowState(
    guild: Guild,
    sessionId: string,
    loadedSession?: SessionResponse,
    loadedConfig?: SessionDiscordConfigResponse | null,
    options: RegistrationWindowSyncOptions = {},
  ) {
    const startedAt = Date.now();
    let [session, config] =
      loadedSession && loadedConfig !== undefined
        ? [loadedSession, loadedConfig]
        : await Promise.all([
            this.apiClient.getSession(sessionId),
            this.apiClient.getSessionDiscordConfig(sessionId).catch(() => null),
          ]);
    if (config?.enabled === false || !config) {
      return false;
    }

    if (options.applyWeeklyScheduleTransition) {
      ({ session, config } =
        await this.applyDueWeeklyRegistrationScheduleTransition(
          session,
          config,
        ));
      if (options.expectedTransitionAt) {
        console.log(
          `[DiscordSync] scheduled registration transition fired session=${session.id} expected=${new Date(
            options.expectedTransitionAt,
          ).toISOString()} actual=${new Date().toISOString()} latencyMs=${
            Date.now() - options.expectedTransitionAt
          }`,
        );
      }
    }

    const updated = await this.syncRegistrationChannelStateFast(
      guild,
      session,
      config,
    );
    if (!updated) {
      this.syncDiscordScrimMessagesInBackground(guild, session.id);
      return false;
    }

    await this.syncRegistrationStatusAnnouncement(
      guild,
      session,
      config,
      options,
    );
    this.registrationWindowSignatures.set(
      this.syncQueueKey(guild, session.id),
      this.registrationWindowSignature(session, config),
    );
    this.scheduleRegistrationWindowSync(guild, session, config);
    this.logTiming(
      `registration window edge refresh session=${session.id}`,
      startedAt,
    );
    return true;
  }

  async ensureDiscordScrimSetup(
    guild: Guild,
    sessionId: string,
  ): Promise<string> {
    try {
      const session = await this.apiClient.getSession(sessionId.trim());
      const config = await this.apiClient
        .getSessionDiscordConfig(session.id)
        .catch(() => null);
      const setup = await this.syncDiscordScrimState(guild, session.id);
      return [
        `${this.emoji("check", config)} Discord scrim setup ready for ${session.name}`,
        "",
        `Registration: <#${setup.registrationChannelId}>`,
        `Slot List: <#${setup.slotListChannelId}>`,
        `Waitlist: <#${setup.waitlistChannelId}>`,
        `IDP: <#${setup.idpChannelId}>`,
        `Manage: <#${setup.manageChannelId}>`,
        `Results: <#${setup.resultsChannelId}>`,
        `Screenshots: <#${setup.screenshotsChannelId}>`,
        `Bans: <#${setup.bansChannelId}>`,
        `Log: <#${setup.logChannelId}>`,
      ].join("\n");
    } catch (error) {
      throw new Error(toFriendlyApiError(error));
    }
  }

  async configureSessionDiscord(
    guild: Guild | null,
    sessionId: string,
    payload: Pick<
      UpdateSessionDiscordConfigPayload,
      | "startSlot"
      | "normalSlots"
      | "vipSlots"
      | "maxTeamsPerManager"
      | "maxManagersPerTeam"
    >,
  ): Promise<string> {
    try {
      const trimmedSessionId = sessionId.trim();
      const [session, config] = await Promise.all([
        this.apiClient.getSession(trimmedSessionId),
        this.apiClient.updateSessionDiscordConfig(trimmedSessionId, payload),
      ]);
      const range = this.slotRangeForSession(session, config);
      const lines = [
        `${this.emoji("check", config)} Scrim Discord config updated for ${session.name}`,
        "",
        `Slots: ${range.startSlot}-${range.endSlot}`,
        `VIP Slots: ${config.vipSlots}`,
        `Max Teams Per Manager: ${config.maxTeamsPerManager}`,
      ];

      if (guild) {
        const setup = await this.syncDiscordScrimState(guild, trimmedSessionId);
        lines.push(
          "",
          "Discord synced:",
          `Slot List: <#${setup.slotListChannelId}>`,
          `Waitlist: <#${setup.waitlistChannelId}>`,
          `IDP: <#${setup.idpChannelId}>`,
        );
      }

      return lines.join("\n");
    } catch (error) {
      throw new Error(toFriendlyApiError(error));
    }
  }

  async setSlotStatusResponseEnabled(
    sessionId: string,
    enabled: boolean,
  ): Promise<SessionDiscordConfigResponse> {
    try {
      const config = await this.apiClient.getSessionDiscordConfig(sessionId);
      return await this.apiClient.updateSessionDiscordConfig(sessionId, {
        emojis: {
          ...(config.emojis ?? {}),
          slotStatusResponseEnabled: enabled ? "true" : "false",
        },
      });
    } catch (error) {
      throw new Error(toFriendlyApiError(error));
    }
  }

  async freeSlotStatusMessage(sessionId: string): Promise<string> {
    try {
      const [session, registrations, config] = await Promise.all([
        this.apiClient.getSession(sessionId),
        this.apiClient.listRegistrations(sessionId),
        this.apiClient.getSessionDiscordConfig(sessionId),
      ]);
      const normalRange = this.slotRangeForSession(session, config);
      const vipRange = this.vipRangeForSession(session, config, normalRange);
      const normalCapacity =
        normalRange.endSlot >= normalRange.startSlot
          ? normalRange.endSlot - normalRange.startSlot + 1
          : 0;
      const normalOccupied = new Set<number>();
      const vipOccupied = new Set<number>();

      for (const registration of registrations) {
        const slotNumber = registration.slotNumber;
        if (
          !this.activeRegistrationStatus(registration) ||
          slotNumber === null
        ) {
          continue;
        }
        if (
          slotNumber >= normalRange.startSlot &&
          slotNumber <= normalRange.endSlot
        ) {
          normalOccupied.add(slotNumber);
        } else if (
          slotNumber >= vipRange.startSlot &&
          slotNumber <= vipRange.endSlot
        ) {
          vipOccupied.add(slotNumber);
        }
      }

      const normalFree = Math.max(0, normalCapacity - normalOccupied.size);
      const vipFree = Math.max(0, vipRange.capacity - vipOccupied.size);
      return [
        `${this.emoji("slot", config)} Free slots: ${normalFree}`,
        `${this.emoji("vip", config)} Free VIP slots: ${vipFree}`,
      ].join("\n");
    } catch (error) {
      throw new Error(toFriendlyApiError(error));
    }
  }

  async setRegistrationChannelState(
    guild: Guild,
    sessionId: string,
    state: "open" | "closed",
    audit: DiscordActionAuditContext = {},
  ): Promise<string> {
    try {
      const [session, config] = await Promise.all([
        this.apiClient.getSession(sessionId),
        this.apiClient.getSessionDiscordConfig(sessionId),
      ]);
      const hasWeeklySchedule = this.hasWeeklyRegistrationSchedule(config);

      const now = new Date();
      const sessionPatch: UpdateSessionPayload = hasWeeklySchedule
        ? {
            registrationOpenAt: null,
            registrationCloseAt: null,
          }
        : {
            registrationOpenAt: null,
            registrationCloseAt: state === "closed" ? now.toISOString() : null,
          };
      if (state === "open" && session.status === "DRAFT") {
        sessionPatch.status = "OPEN";
      }

      const nextEmojis = {
        ...(config.emojis ?? {}),
        ...(hasWeeklySchedule
          ? {
              registrationManualState: "",
              registrationScheduleOverrideState: state,
              registrationScheduleOverrideUpdatedAt: now.toISOString(),
            }
          : {
              registrationManualState: state,
              registrationScheduleOverrideState: "",
            }),
      };

      const updatedConfig = await this.apiClient.updateSessionDiscordConfig(
        session.id,
        {
          disableSlotAndVipRegistration: state === "closed",
          emojis: nextEmojis,
        },
      );
      let updatedSession = session;
      try {
        updatedSession = await this.apiClient.updateSession(
          session.id,
          sessionPatch,
        );
      } catch (error) {
        console.warn(
          `Registration session timestamp update skipped: ${toFriendlyApiError(error)}`,
        );
      }

      const fastUpdated = await this.syncRegistrationChannelStateFast(
        guild,
        updatedSession,
        updatedConfig,
      );
      this.syncDiscordScrimStateInBackground(guild, updatedSession.id, {
        organizationId: updatedConfig.organizationId,
        delayMs: fastUpdated ? 2_500 : BACKGROUND_SYNC_DELAY_MS,
      });
      void this.sendDiscordActionLog(guild, updatedConfig, {
        action:
          state === "open" ? "Registration opened" : "Registration closed",
        actorDiscordId: audit.actorDiscordId,
        actorLabel: audit.actorLabel,
        sourceChannelId: audit.sourceChannelId,
        sessionId: updatedSession.id,
        sessionName: audit.sessionName ?? updatedSession.name,
        status: state,
        color: state === "open" ? 0x22c55e : 0xef4444,
      }).catch((error) => {
        console.warn(`Registration state action log failed: ${String(error)}`);
      });

      return state === "open"
        ? `${this.emoji("check", updatedConfig)} Registration is open.`
        : `${this.emoji("reject", updatedConfig)} Registration is closed.`;
    } catch (error) {
      throw new Error(toFriendlyApiError(error));
    }
  }

  async setWaitlistPromotionChannelState(
    guild: Guild,
    sessionId: string,
    state: "open" | "closed",
    audit: DiscordActionAuditContext = {},
  ): Promise<string> {
    try {
      const [session, config, registrations] = await Promise.all([
        this.apiClient.getSession(sessionId),
        this.apiClient.getSessionDiscordConfig(sessionId),
        this.apiClient.listRegistrations(sessionId),
      ]);
      const hasWeeklySchedule = this.hasWeeklyWaitlistPromotionSchedule(config);
      const now = new Date();
      const nextEmojis = {
        ...(config.emojis ?? {}),
        ...(hasWeeklySchedule
          ? {
              waitlistPromotionManualState: "",
              waitlistPromotionScheduleOverrideState: state,
              waitlistPromotionScheduleOverrideUpdatedAt: now.toISOString(),
            }
          : {
              waitlistPromotionManualState: state,
              waitlistPromotionScheduleOverrideState: "",
              waitlistPromotionScheduleOverrideUpdatedAt: "",
            }),
      };

      const updatedConfig = await this.apiClient.updateSessionDiscordConfig(
        session.id,
        { emojis: nextEmojis },
      );
      const accepting = this.waitlistPromotionAccepting(
        session,
        updatedConfig,
        registrations,
      );
      const fastUpdated = await this.syncVisibleDiscordMessagesFast(
        guild,
        session.id,
      );
      this.syncDiscordScrimStateInBackground(guild, session.id, {
        organizationId: updatedConfig.organizationId,
        delayMs: fastUpdated ? 2_500 : BACKGROUND_SYNC_DELAY_MS,
      });
      void this.sendDiscordActionLog(guild, updatedConfig, {
        action:
          state === "open"
            ? "Waitlist promotion opened"
            : "Waitlist promotion closed",
        actorDiscordId: audit.actorDiscordId,
        actorLabel: audit.actorLabel,
        sourceChannelId: audit.sourceChannelId,
        sessionId: session.id,
        sessionName: audit.sessionName ?? session.name,
        status:
          state === "open" && !accepting ? "open; no normal slot free" : state,
        color: state === "open" ? 0x22c55e : 0xef4444,
      }).catch((error) => {
        console.warn(
          `Waitlist promotion state action log failed: ${String(error)}`,
        );
      });

      if (state === "open") {
        return accepting
          ? `${this.emoji("check", updatedConfig)} Waitlist promotion is open.`
          : `${this.emoji("warning", updatedConfig)} Waitlist promotion is open, but the waitlist channel stays closed until a normal slot is free.`;
      }
      return `${this.emoji("reject", updatedConfig)} Waitlist promotion is closed.`;
    } catch (error) {
      throw new Error(toFriendlyApiError(error));
    }
  }

  async updateResultSummaryConfig(
    sessionId: string,
    patch: ResultSummaryConfigPatch,
  ): Promise<string> {
    try {
      const config = await this.apiClient.getSessionDiscordConfig(sessionId);
      const emojis = { ...(config.emojis ?? {}) };

      if (patch.action === "reset") {
        emojis.resultSummaryCount = "3";
        emojis.resultSummaryTitle = "{trophy} Match Results";
        emojis.resultSummaryRowTemplate = DEFAULT_RESULT_SUMMARY_ROW_TEMPLATE;
      } else if (patch.action === "count") {
        if (
          !Number.isInteger(patch.value) ||
          patch.value < 0 ||
          patch.value > 20
        ) {
          throw new Error("Count must be a whole number from 0 to 20.");
        }
        emojis.resultSummaryCount = String(patch.value);
      } else {
        const value = patch.value.trim();
        if (!value) {
          throw new Error(
            patch.action === "title"
              ? "Title text is required."
              : "Row template is required.",
          );
        }
        if (value.length > 180) {
          throw new Error("Text must be 180 characters or fewer.");
        }
        if (patch.action === "title") {
          emojis.resultSummaryTitle = value;
        } else {
          emojis.resultSummaryRowTemplate = value;
        }
      }

      const updated = await this.apiClient.updateSessionDiscordConfig(
        sessionId,
        {
          emojis,
        },
      );

      return [
        `${this.emoji("check", updated)} Result summary updated`,
        "",
        `Count: ${this.resultSummaryCount(updated)}`,
        `Title: ${updated.emojis.resultSummaryTitle}`,
        `Row: ${updated.emojis.resultSummaryRowTemplate}`,
      ].join("\n");
    } catch (error) {
      throw new Error(toFriendlyApiError(error));
    }
  }

  async configurePlayButtonsForSlotListChannel(
    guild: Guild,
    channelId: string,
    options: ConfigurePlayButtonsOptions,
  ): Promise<string> {
    try {
      const resolved = await this.findScrimForSlotListChannel(
        guild.id,
        channelId,
      );
      if (!resolved) {
        return `${this.emoji("reject")} Use this command inside a configured slot-list channel.`;
      }

      await guild.emojis.fetch().catch(() => null);
      const nextEmojis: Record<string, string> = {
        ...(resolved.config.emojis ?? {}),
      };
      const changed: string[] = [];

      if (options.controlMode) {
        nextEmojis.playControlMode = options.controlMode;
        nextEmojis.playButtonsEnabled =
          options.controlMode === "off" ? "false" : "true";
        changed.push(`mode ${options.controlMode}`);
      }

      if (
        options.showButtons !== null &&
        options.showButtons !== undefined &&
        !options.controlMode
      ) {
        nextEmojis.playControlMode = options.showButtons ? "buttons" : "off";
        nextEmojis.playButtonsEnabled = options.showButtons ? "true" : "false";
        changed.push(
          options.showButtons ? "buttons enabled" : "buttons hidden",
        );
      }

      if (options.emojiOnly) {
        nextEmojis.playConfirmLabel = "";
        nextEmojis.playNotPlayingLabel = "";
        changed.push("emoji-only labels");
      }

      if (options.confirmLabel !== null && options.confirmLabel !== undefined) {
        nextEmojis.playConfirmLabel = this.normalizeButtonLabel(
          options.confirmLabel,
        );
        changed.push("confirm label");
      }

      if (
        options.notPlayingLabel !== null &&
        options.notPlayingLabel !== undefined
      ) {
        nextEmojis.playNotPlayingLabel = this.normalizeButtonLabel(
          options.notPlayingLabel,
        );
        changed.push("not-playing label");
      }

      if (options.confirmEmoji !== null && options.confirmEmoji !== undefined) {
        nextEmojis.playConfirmEmoji = this.normalizeButtonEmoji(
          guild,
          options.confirmEmoji,
        );
        changed.push("confirm emoji");
      }

      if (
        options.notPlayingEmoji !== null &&
        options.notPlayingEmoji !== undefined
      ) {
        nextEmojis.playNotPlayingEmoji = this.normalizeButtonEmoji(
          guild,
          options.notPlayingEmoji,
        );
        changed.push("not-playing emoji");
      }

      if (options.confirmStyle) {
        nextEmojis.playConfirmStyle = options.confirmStyle;
        changed.push("confirm style");
      }

      if (options.notPlayingStyle) {
        nextEmojis.playNotPlayingStyle = options.notPlayingStyle;
        changed.push("not-playing style");
      }

      if (changed.length === 0) {
        return `${this.emoji("warning", resolved.config)} No play-control settings were changed.`;
      }

      const config = await this.apiClient.updateSessionDiscordConfig(
        resolved.session.id,
        { emojis: nextEmojis },
      );
      await this.syncDiscordScrimState(guild, resolved.session.id);

      return [
        `${this.emoji("check", config)} Play controls updated for ${resolved.session.name}.`,
        "",
        `Mode: ${this.describePlayControlMode(
          playConfirmationControlMode(config),
        )}`,
        `Confirm: ${this.describeButtonSetting(
          config.emojis.playConfirmEmoji,
          config.emojis.playConfirmLabel,
        )}`,
        `Not Playing: ${this.describeButtonSetting(
          config.emojis.playNotPlayingEmoji,
          config.emojis.playNotPlayingLabel,
        )}`,
      ].join("\n");
    } catch (error) {
      throw new Error(toFriendlyApiError(error));
    }
  }

  private normalizeButtonLabel(value: string) {
    const trimmed = value.trim();
    return ["none", "blank", "off", "-"].includes(trimmed.toLowerCase())
      ? ""
      : trimmed.slice(0, 80);
  }

  private normalizeButtonEmoji(guild: Guild, value: string) {
    const trimmed = value.trim();
    if (!trimmed) {
      return "";
    }
    const unescaped = trimmed.startsWith("\\") ? trimmed.slice(1) : trimmed;
    if (["none", "blank", "off", "-"].includes(unescaped.toLowerCase())) {
      return "";
    }
    const named = /^:([^:]+):$/.exec(unescaped);
    if (named) {
      const emoji = guild.emojis.cache.find((entry) => entry.name === named[1]);
      if (emoji) {
        return `<${emoji.animated ? "a" : ""}:${emoji.name}:${emoji.id}>`;
      }
    }
    return unescaped;
  }

  private describeButtonSetting(
    emoji: string | undefined,
    label: string | undefined,
  ) {
    const parts = [emoji?.trim(), label?.trim()].filter(
      (part): part is string => Boolean(part),
    );
    return parts.length > 0 ? parts.join(" ") : "default label";
  }

  private describePlayControlMode(mode: PlayControlMode) {
    switch (mode) {
      case "reactions":
        return "Reactions only";
      case "both":
        return "Buttons and reactions";
      case "off":
        return "Off";
      case "buttons":
      default:
        return "Buttons only";
    }
  }

  private discordMessageTextForCleanup(message: Message) {
    const parts = [message.content ?? ""];
    for (const embed of message.embeds) {
      parts.push(embed.title ?? "", embed.description ?? "");
      for (const field of embed.fields ?? []) {
        parts.push(field.name ?? "", field.value ?? "");
      }
      parts.push(embed.footer?.text ?? "");
    }
    return parts.join("\n");
  }

  private messageCustomIds(message: Message) {
    const rows = message.components as Array<{
      components?: Array<{ customId?: string | null }>;
    }>;
    return rows.flatMap((row) =>
      (row.components ?? [])
        .map((component) => component.customId)
        .filter((customId): customId is string => Boolean(customId)),
    );
  }

  private slotListPlayControlState(
    message: Message,
    sessionId: string,
    buttonsAllowed: boolean,
  ) {
    const customIds = this.messageCustomIds(message);
    const stalePlayControl = customIds.some((customId) => {
      const match = /^play:(?:confirm|not):([^:]+)$/i.exec(customId);
      return Boolean(match && match[1] !== sessionId);
    });
    const unexpectedPlayButtons =
      !buttonsAllowed &&
      customIds.some((customId) => customId.startsWith("play:"));
    return { customIds, stalePlayControl, unexpectedPlayButtons };
  }

  async cleanupStaleManagedBotMessage(message: Message) {
    if (!message.guild || message.author.id !== message.client.user?.id) {
      return false;
    }

    const topic =
      "topic" in message.channel &&
      typeof (message.channel as { topic?: unknown }).topic === "string"
        ? ((message.channel as { topic?: string | null }).topic ?? null)
        : null;
    const resolved = await this.resolveDiscordChannel(
      message.guild.id,
      message.channelId,
      topic,
    ).catch(() => null);
    if (
      !resolved ||
      resolved.session.type !== "SCRIM" ||
      resolved.channelKind !== "slot-list"
    ) {
      return false;
    }

    const managedSlotListMessageId =
      resolved.config.emojis?.managedSlotListMessageId?.trim();
    const mode = playConfirmationControlMode(resolved.config);
    const buttonsAllowed = mode === "buttons" || mode === "both";
    const { stalePlayControl, unexpectedPlayButtons } =
      this.slotListPlayControlState(
        message,
        resolved.session.id,
        buttonsAllowed,
      );
    const isPinNotice = message.type === MessageType.ChannelPinnedMessage;
    const isSlotList = /\bslot\s+list\s*\(/i.test(
      this.discordMessageTextForCleanup(message),
    );

    if (managedSlotListMessageId && message.id === managedSlotListMessageId) {
      if (stalePlayControl || unexpectedPlayButtons) {
        const freshMessage = await message.channel.messages
          .fetch(message.id)
          .catch(() => message);
        const freshState = this.slotListPlayControlState(
          freshMessage,
          resolved.session.id,
          buttonsAllowed,
        );
        if (!freshState.stalePlayControl && !freshState.unexpectedPlayButtons) {
          return false;
        }
        await freshMessage.edit({ components: [] }).catch(() => undefined);
        console.warn(
          `[DiscordCleanup] removed unexpected slot-list buttons session=${resolved.session.id} channel=${message.channelId} message=${message.id}`,
        );
        return true;
      }
      return false;
    }

    if (isSlotList && (stalePlayControl || unexpectedPlayButtons)) {
      const freshMessage = await message.channel.messages
        .fetch(message.id)
        .catch(() => message);
      const freshState = this.slotListPlayControlState(
        freshMessage,
        resolved.session.id,
        buttonsAllowed,
      );
      if (!freshState.stalePlayControl && !freshState.unexpectedPlayButtons) {
        return false;
      }
      await freshMessage.edit({ components: [] }).catch(() => undefined);
      console.warn(
        `[DiscordCleanup] removed unexpected slot-list buttons session=${resolved.session.id} channel=${message.channelId} message=${message.id}`,
      );
      return true;
    }

    if (
      !stalePlayControl &&
      !unexpectedPlayButtons &&
      !(isPinNotice && !managedSlotListMessageId) &&
      !(isPinNotice && message.id !== managedSlotListMessageId) &&
      !(isSlotList && stalePlayControl)
    ) {
      return false;
    }

    await message.delete().catch(() => undefined);
    console.warn(
      `[DiscordCleanup] deleted stale slot-list bot message session=${resolved.session.id} channel=${message.channelId} message=${message.id}`,
    );
    return true;
  }

  async handlePlayStatusReaction(
    reaction: MessageReaction | PartialMessageReaction,
    user: User | PartialUser,
  ): Promise<boolean> {
    const hydratedUser = user.partial
      ? await user.fetch().catch(() => null)
      : user;
    if (!hydratedUser || hydratedUser.bot) {
      return false;
    }

    const hydratedReaction: MessageReaction | null = reaction.partial
      ? await reaction.fetch().catch(() => null)
      : reaction;
    if (!hydratedReaction) {
      return false;
    }

    const message = hydratedReaction.message.partial
      ? await hydratedReaction.message.fetch().catch(() => null)
      : hydratedReaction.message;
    if (!message) {
      return false;
    }
    if (
      await this.isDiscordChannelPaused(message.guild?.id, message.channelId)
    ) {
      return false;
    }

    const resolvedByMessage = message.guild
      ? await this.findScrimForPlayStatusMessage(
          message.guild.id,
          message.channelId,
          message.id,
        )
      : null;
    const markerText = this.messageMarker(
      message.embeds,
      /^arenzyra:[^:]+:(?:slots|confirmation)$/i,
    );
    const marker = markerText
      ? /^arenzyra:([^:]+):(?:slots|confirmation)$/i.exec(markerText)
      : null;
    const sessionId = resolvedByMessage?.session.id ?? marker?.[1];
    if (!sessionId) {
      return false;
    }

    const config =
      resolvedByMessage?.config ??
      (await this.apiClient
        .getSessionDiscordConfig(sessionId)
        .catch(() => null));
    if (!playConfirmationReactionsEnabled(config)) {
      return false;
    }

    const action = this.playStatusActionForReaction(hydratedReaction, config);
    if (!action) {
      return false;
    }

    const organizationId =
      resolvedByMessage?.config.organizationId ??
      config?.organizationId ??
      null;
    await this.withOrganization(organizationId, async () => {
      await hydratedReaction.users
        .remove(hydratedUser.id)
        .catch(() => undefined);
      await this.updateRegistrationPlayStatus(
        sessionId,
        hydratedUser.id,
        hydratedUser.username ?? null,
        action,
        message.guild,
        {
          actorDiscordId: hydratedUser.id,
          actorLabel: hydratedUser.username ?? null,
          sourceChannelId: message.channelId,
          sessionName: resolvedByMessage?.session.name ?? null,
        },
      );
    });
    return true;
  }

  private messageMarker(
    embeds: readonly {
      footer?: { text?: string | null } | null;
      fields?: readonly { name: string; value: string }[];
    }[],
    pattern: RegExp,
  ) {
    for (const embed of embeds) {
      const footer = embed.footer?.text ?? "";
      if (pattern.test(footer)) {
        return footer;
      }
      const hidden = embed.fields?.find(
        (field) => field.name === "\u200B" && pattern.test(field.value),
      )?.value;
      if (hidden) {
        return hidden;
      }
    }
    return null;
  }

  private playStatusActionForReaction(
    reaction: MessageReaction,
    config?: Pick<SessionDiscordConfigResponse, "emojis"> | null,
  ): UpdateRegistrationPlayStatusPayload["action"] | null {
    const reactionKeys = this.reactionEmojiKeys(reaction);
    const confirmEmoji = configuredButtonEmoji(
      "playConfirmEmoji",
      "check",
      config,
    );
    if (this.configuredReactionMatches(confirmEmoji, reactionKeys)) {
      return "CONFIRM";
    }

    const notPlayingEmoji = configuredButtonEmoji(
      "playNotPlayingEmoji",
      "reject",
      config,
    );
    if (this.configuredReactionMatches(notPlayingEmoji, reactionKeys)) {
      return "NOT_PLAYING";
    }

    return null;
  }

  private reactionEmojiKeys(reaction: MessageReaction) {
    const keys = new Set<string>();
    const name = reaction.emoji.name?.trim();
    const id = reaction.emoji.id?.trim();
    if (name) {
      keys.add(name);
    }
    if (id) {
      keys.add(id);
    }
    if (name && id) {
      keys.add(`${name}:${id}`);
      keys.add(`<:${name}:${id}>`);
      keys.add(`<a:${name}:${id}>`);
    }
    return keys;
  }

  private configuredReactionMatches(
    emoji: string | null,
    reactionKeys: Set<string>,
  ) {
    if (!emoji) {
      return false;
    }
    const configuredKeys = this.configuredReactionKeys(emoji);
    return [...configuredKeys].some((key) => reactionKeys.has(key));
  }

  private configuredReactionKeys(value: string) {
    const keys = new Set<string>();
    const trimmed = value.trim();
    if (!trimmed) {
      return keys;
    }

    const custom = /^<a?:([^:>]+):(\d+)>$/.exec(trimmed);
    if (custom) {
      keys.add(trimmed);
      keys.add(custom[1]);
      keys.add(custom[2]);
      keys.add(`${custom[1]}:${custom[2]}`);
      return keys;
    }

    const named = /^:([^:]+):$/.exec(trimmed);
    keys.add(named ? named[1] : trimmed);
    return keys;
  }

  async syncDiscordScrimState(
    guild: Guild,
    sessionId: string,
    opts: { removedTeamIds?: string[] } = {},
  ): Promise<ScrimDiscordSetup> {
    const totalStartedAt = Date.now();
    console.log(
      `[DiscordSync] start session=${sessionId} guild=${guild.id} removed=${opts.removedTeamIds?.length ?? 0}`,
    );
    let stepStartedAt = Date.now();
    let [session, initialRegistrations, config] = await Promise.all([
      this.apiClient.getSession(sessionId),
      this.apiClient.listRegistrations(sessionId),
      this.apiClient.getSessionDiscordConfig(sessionId),
    ]);
    let registrations = initialRegistrations;
    this.logTiming(`load state session=${sessionId}`, stepStartedAt);
    ({ session, config } =
      await this.applyDueWeeklyWaitlistPromotionScheduleTransition(
        session,
        config,
      ));

    stepStartedAt = Date.now();
    let setup = await this.scrimDiscordSetup
      .ensureSetup(guild, session, config)
      .catch((error) => {
        console.warn(
          `[DiscordSync] setup repair failed session=${sessionId}: ${String(error)}`,
        );
        return null;
      });
    if (!setup) {
      setup = this.setupFromConfig(config);
      if (!setup) {
        throw new Error("Saved Discord setup is incomplete.");
      }
    }
    this.logTiming(`ensure setup session=${sessionId}`, stepStartedAt);

    stepStartedAt = Date.now();
    config = await this.persistDiscordSetupConfig(
      session.id,
      setup,
      guild.id,
      config,
    );
    this.logTiming(`persist setup session=${sessionId}`, stepStartedAt);

    const memberCache = await this.loadTeamMembersForSync([
      ...registrations
        .filter((registration) => this.activeRegistrationStatus(registration))
        .map((registration) => registration.teamId),
      ...(opts.removedTeamIds ?? []),
    ]);

    stepStartedAt = Date.now();
    const removedTeamIds = opts.removedTeamIds ?? [];
    if (removedTeamIds.length > 0) {
      await this.reconcileTeamSetAccessRoles(
        guild,
        setup,
        removedTeamIds,
        registrations,
        this.activeRegistrationByTeam(registrations),
        memberCache,
      );
    }
    this.logTiming(`removed role sync session=${sessionId}`, stepStartedAt);

    stepStartedAt = Date.now();
    const roleSyncedTeamIds = this.registrationAccessRoleTeamIds(registrations);
    await this.syncRegistrationAccessRoles(
      guild,
      setup,
      registrations,
      memberCache,
    );
    this.logTiming(`active role sync session=${sessionId}`, stepStartedAt);

    stepStartedAt = Date.now();
    try {
      const refreshedRegistrations =
        await this.apiClient.listRegistrations(sessionId);
      const refreshedRoleTeamIds = this.registrationAccessRoleTeamIds(
        refreshedRegistrations,
      );
      const staleRoleTeamIds = [...roleSyncedTeamIds].filter(
        (teamId) => !refreshedRoleTeamIds.has(teamId),
      );
      if (staleRoleTeamIds.length > 0) {
        const refreshedActiveByTeamId = this.activeRegistrationByTeam(
          refreshedRegistrations,
        );
        const staleMemberCache = await this.loadTeamMembersForSync(
          this.uniqueStrings([
            ...staleRoleTeamIds,
            ...refreshedActiveByTeamId.keys(),
          ]),
        );
        await this.reconcileTeamSetAccessRoles(
          guild,
          setup,
          staleRoleTeamIds,
          refreshedRegistrations,
          refreshedActiveByTeamId,
          staleMemberCache,
        );
        console.log(
          `[DiscordSync] stale role cleanup session=${sessionId} teams=${staleRoleTeamIds.length}`,
        );
      }
      registrations = refreshedRegistrations;
    } catch (error) {
      console.warn(
        `[DiscordSync] registration reload before message sync failed session=${sessionId}: ${String(error)}`,
      );
    }
    this.logTiming(
      `registration reload before message sync session=${sessionId}`,
      stepStartedAt,
    );

    if (removedTeamIds.length > 0) {
      await this.restoreActiveBanRolesForRemovedTeams(
        guild,
        sessionId,
        removedTeamIds,
        config,
      );
    }

    const messageMemberCache = new Map(memberCache);
    const missingMessageTeamIds = [
      ...new Set(
        registrations
          .filter((registration) => this.activeRegistrationStatus(registration))
          .map((registration) => registration.teamId)
          .filter((teamId) => !messageMemberCache.has(teamId)),
      ),
    ];
    if (missingMessageTeamIds.length > 0) {
      for (const [teamId, members] of await this.loadTeamMembersForSync(
        missingMessageTeamIds,
      )) {
        messageMemberCache.set(teamId, members);
      }
    }
    const managerMentionByTeamId = await this.managerMentionByTeamIdForGuild(
      guild,
      registrations,
      messageMemberCache,
    );

    stepStartedAt = Date.now();
    try {
      const messageIds = await this.scrimDiscordSetup.syncMessages(
        guild,
        setup,
        session,
        registrations,
        config,
        { managerMentionByTeamId },
      );
      config = await this.persistManagedMessageIds(
        session.id,
        config,
        messageIds,
      );
    } catch (error) {
      console.warn(
        `[DiscordSync] full message sync failed session=${sessionId}: ${String(error)}. Trying slot-list-only refresh.`,
      );
      const slotListMessage = await this.scrimDiscordSetup.syncSlotListMessage(
        guild,
        setup,
        session,
        registrations,
        config,
        { managerMentionByTeamId },
      );
      config = await this.persistManagedMessageIds(session.id, config, {
        managedSlotListMessageId: slotListMessage.id,
      });
    }
    this.logTiming(`message sync session=${sessionId}`, stepStartedAt);
    this.scheduleCopiedEventSourceImportRefresh(session.id, config);
    this.scheduleConfirmationWindowSync(guild, session.id, config);
    this.scheduleRegistrationWindowSync(guild, session, config);
    this.scheduleWaitlistPromotionWindowSync(guild, session, config);
    this.logTiming(`done session=${sessionId}`, totalStartedAt);
    return setup;
  }

  private scheduleConfirmationWindowSync(
    guild: Guild,
    sessionId: string,
    config: SessionDiscordConfigResponse | null,
  ) {
    const key = this.syncQueueKey(guild, sessionId);
    for (const timer of this.confirmationWindowTimers.get(key) ?? []) {
      clearTimeout(timer);
    }

    const window = playConfirmationWindow(config);
    const cleanupWindow = playConfirmationCleanupWindow(config);
    const targets = [
      window.opensAt,
      window.closesAt,
      window.waitlistStartsAt,
      cleanupWindow.cleanupAt,
      cleanupWindow.nextCleanupAt,
    ].filter((date): date is Date => Boolean(date));
    const now = Date.now();
    const timers = targets
      .map((date) => date.getTime() - now + 1000)
      .filter((delay) => delay > 0 && delay <= MAX_CONFIRMATION_WINDOW_TIMER_MS)
      .map((delay) => {
        const timer = setTimeout(() => {
          this.syncDiscordScrimMessagesInBackground(guild, sessionId);
        }, delay);
        timer.unref?.();
        return timer;
      });

    if (timers.length > 0) {
      this.confirmationWindowTimers.set(key, timers);
    } else {
      this.confirmationWindowTimers.delete(key);
    }
  }

  private scheduleRegistrationWindowSync(
    guild: Guild,
    session: SessionResponse,
    config: SessionDiscordConfigResponse | null,
  ) {
    const key = this.syncQueueKey(guild, session.id);
    for (const timer of this.registrationWindowTimers.get(key) ?? []) {
      clearTimeout(timer);
    }

    const window = this.publicRegistrationWindow(session, config);
    const scheduledWindow = this.publicScheduledRegistrationWindow(
      session,
      config,
    );
    const { closedDetailsMs, openingSoonMs } =
      registrationStatusTimingThresholds(config);
    const targetMap = new Map<
      string,
      {
        date: Date;
        announce: boolean;
        applyWeeklyScheduleTransition: boolean;
      }
    >();
    const addTarget = (
      date: Date | null | undefined,
      announce: boolean,
      applyWeeklyScheduleTransition: boolean,
    ) => {
      if (!date) {
        return;
      }
      const key = `${date.getTime()}:${announce ? "announce" : "silent"}`;
      const existing = targetMap.get(key);
      if (existing) {
        existing.applyWeeklyScheduleTransition =
          existing.applyWeeklyScheduleTransition ||
          applyWeeklyScheduleTransition;
        return;
      }
      targetMap.set(key, { date, announce, applyWeeklyScheduleTransition });
    };

    addTarget(window.opensAt, true, false);
    addTarget(window.closesAt, true, false);
    addTarget(
      window.opensAt
        ? new Date(window.opensAt.getTime() - openingSoonMs)
        : null,
      false,
      false,
    );
    addTarget(
      window.closesAt
        ? new Date(window.closesAt.getTime() + closedDetailsMs)
        : null,
      false,
      false,
    );
    addTarget(scheduledWindow?.opensAt, true, true);
    addTarget(scheduledWindow?.closesAt, true, true);

    const now = Date.now();
    const timers = [...targetMap.values()]
      .map((target) => ({
        delay: target.date.getTime() - now + 1000,
        announce: target.announce,
        applyWeeklyScheduleTransition: target.applyWeeklyScheduleTransition,
        expectedTransitionAt: target.applyWeeklyScheduleTransition
          ? target.date.getTime()
          : undefined,
      }))
      .filter(
        (target) =>
          target.delay > 0 && target.delay <= MAX_CONFIRMATION_WINDOW_TIMER_MS,
      )
      .map((target) => {
        const timer = setTimeout(() => {
          this.syncRegistrationWindowStateInBackground(guild, session.id, {
            announceTransition: target.announce,
            applyWeeklyScheduleTransition: target.applyWeeklyScheduleTransition,
            expectedTransitionAt: target.expectedTransitionAt,
          });
        }, target.delay);
        timer.unref?.();
        return timer;
      });

    if (timers.length > 0) {
      this.registrationWindowTimers.set(key, timers);
    } else {
      this.registrationWindowTimers.delete(key);
    }
  }

  private scheduleWaitlistPromotionWindowSync(
    guild: Guild,
    session: SessionResponse,
    config: SessionDiscordConfigResponse | null,
  ) {
    const key = this.syncQueueKey(guild, session.id);
    for (const timer of this.waitlistPromotionWindowTimers.get(key) ?? []) {
      clearTimeout(timer);
    }

    const window = this.waitlistPromotionWindow(session, config);
    const scheduledWindow = this.publicScheduledWaitlistPromotionWindow(
      session,
      config,
    );
    const seenTargetTimes = new Set<number>();
    const targets = [
      window.opensAt,
      window.closesAt,
      scheduledWindow?.opensAt,
      scheduledWindow?.closesAt,
    ]
      .filter((date): date is Date => Boolean(date))
      .filter((date) => {
        const time = date.getTime();
        if (seenTargetTimes.has(time)) {
          return false;
        }
        seenTargetTimes.add(time);
        return true;
      });
    const now = Date.now();
    const timers = targets
      .map((date) => date.getTime() - now + 1000)
      .filter((delay) => delay > 0 && delay <= MAX_CONFIRMATION_WINDOW_TIMER_MS)
      .map((delay) => {
        const timer = setTimeout(() => {
          this.syncDiscordScrimMessagesInBackground(guild, session.id);
        }, delay);
        timer.unref?.();
        return timer;
      });

    if (timers.length > 0) {
      this.waitlistPromotionWindowTimers.set(key, timers);
    } else {
      this.waitlistPromotionWindowTimers.delete(key);
    }
  }

  private boundedNumber(
    value: string | null | undefined,
    fallback: number,
    min: number,
    max: number,
  ) {
    const parsed = Number.parseFloat(value ?? "");
    if (!Number.isFinite(parsed)) {
      return fallback;
    }
    return Math.min(max, Math.max(min, parsed));
  }

  private normalizeDiscordRoleId(value: string | null | undefined) {
    const trimmed = value?.trim() ?? "";
    if (!trimmed) {
      return null;
    }
    const mention = /^<@&(\d+)>$/.exec(trimmed);
    const roleId = mention?.[1] ?? trimmed;
    return /^\d{5,32}$/.test(roleId) ? roleId : null;
  }

  private confirmationReminderConfig(
    config: SessionDiscordConfigResponse,
  ): ConfirmationReminderConfig {
    const emojis = config.emojis ?? {};
    return {
      enabled: emojis.playConfirmationReminderEnabled === "true",
      roleId:
        this.normalizeDiscordRoleId(emojis.playConfirmationReminderRoleId) ??
        config.slotRoleId,
      openDelayMinutes: this.boundedNumber(
        emojis.playConfirmationReminderOpenDelayMinutes,
        0,
        0,
        180,
      ),
      intervalMinutes: this.boundedNumber(
        emojis.playConfirmationReminderIntervalMinutes,
        10,
        1,
        180,
      ),
      maxMessages: Math.round(
        this.boundedNumber(
          emojis.playConfirmationReminderMaxMessages,
          6,
          1,
          24,
        ),
      ),
      managerMentionThreshold: Math.round(
        this.boundedNumber(
          emojis.playConfirmationReminderPendingMentionThreshold,
          7,
          1,
          50,
        ),
      ),
      roleMessageText:
        emojis.playConfirmationReminderRoleMessageText?.trim() ||
        "{role} Slot confirmation is open for {session}. Pending teams: {pendingCount}/{totalCount}.",
      managerMessageText:
        emojis.playConfirmationReminderManagerMessageText?.trim() ||
        "{managers} Please confirm playing or not playing for {session}. Pending teams: {pendingCount}.",
    };
  }

  private registrationPlayStatus(
    registration: Pick<SessionRegistrationResponse, "note">,
  ): RegistrationPlayStatus | null {
    const marker = registration.note
      ?.split(/\r?\n/)
      .find((line) => line.startsWith(PLAY_STATUS_NOTE_PREFIX));
    if (!marker) {
      return null;
    }

    try {
      const payload = JSON.parse(
        marker.slice(PLAY_STATUS_NOTE_PREFIX.length),
      ) as {
        status?: unknown;
        discordUserId?: unknown;
      };
      if (payload.status !== "CONFIRM" && payload.status !== "NOT_PLAYING") {
        return null;
      }
      return {
        status: payload.status,
        discordUserId:
          typeof payload.discordUserId === "string" &&
          payload.discordUserId.trim()
            ? payload.discordUserId.trim()
            : null,
      };
    } catch {
      return null;
    }
  }

  private confirmationCleanupEnabled(config: SessionDiscordConfigResponse) {
    return config.emojis?.playConfirmationCleanupEnabled === "true";
  }

  private confirmationCleanupBanSettings(
    config: SessionDiscordConfigResponse,
  ): {
    scope: TeamBanScope;
    days: number | null;
    reasonTemplate: string;
  } | null {
    if (config.emojis?.playConfirmationCleanupBanEnabled !== "true") {
      return null;
    }

    const [rule] = this.parseNoShowAutoBanRulesForDiscord(config);
    const defaultDays = Math.round(
      this.boundedNumber(config.emojis?.banDefaultDurationDays, 3, 0, 3650),
    );
    const defaultScope =
      config.emojis?.banDefaultScope === "TEAM" ? "TEAM" : "SESSION";
    const reasonTemplate =
      config.emojis?.playConfirmationCleanupReason?.trim() ||
      "Missed confirmation for {session}";

    return {
      scope: rule?.scope ?? defaultScope,
      days: rule ? rule.durationDays : defaultDays > 0 ? defaultDays : null,
      reasonTemplate,
    };
  }

  private confirmationWaitlistStartConfigured(
    config: SessionDiscordConfigResponse,
  ) {
    const emojis = config.emojis ?? {};
    if (emojis.playConfirmationWaitlistStartTime?.trim()) {
      return true;
    }
    if (this.hasWeeklyWaitlistPromotionSchedule(config)) {
      return true;
    }

    const rawSchedule = emojis.playConfirmationWeeklySchedule?.trim();
    if (!rawSchedule) {
      return false;
    }

    try {
      const parsed = JSON.parse(rawSchedule) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return false;
      }

      return Object.values(parsed as Record<string, unknown>).some((entry) => {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
          return false;
        }
        const day = entry as Record<string, unknown>;
        const enabled = day.enabled === true || day.enabled === "true";
        return enabled && typeof day.waitlistStart === "string"
          ? day.waitlistStart.trim().length > 0
          : false;
      });
    } catch {
      return false;
    }
  }

  private confirmationWaitlistGraceMinutes(
    config: SessionDiscordConfigResponse,
  ) {
    return Math.round(
      this.boundedNumber(
        config.emojis?.playConfirmationWaitlistGraceMinutes,
        CONFIRMATION_WAITLIST_GRACE_DEFAULT_MINUTES,
        CONFIRMATION_WAITLIST_GRACE_MINUTES_MIN,
        CONFIRMATION_WAITLIST_GRACE_MINUTES_MAX,
      ),
    );
  }

  private hasActiveWaitlistRegistration(
    registrations: SessionRegistrationResponse[],
  ) {
    return registrations.some(
      (registration) =>
        this.activeRegistrationStatus(registration) &&
        registration.status === "WAITLIST" &&
        registration.waitlistPosition !== null,
    );
  }

  private shouldKeepWaitlistPromotionClosed(
    config: SessionDiscordConfigResponse,
  ) {
    return (
      this.waitlistPromotionManualState(config) === "closed" ||
      this.waitlistPromotionScheduleOverrideState(config) === "closed"
    );
  }

  private async maybeOpenWaitlistAfterConfirmationCleanup(
    guild: Guild,
    session: SessionResponse,
    config: SessionDiscordConfigResponse,
    registrationsBeforeCleanup: SessionRegistrationResponse[],
    removedTeamIds: string[],
    now: Date,
  ): Promise<{ config: SessionDiscordConfigResponse; details: string[] }> {
    if (
      removedTeamIds.length === 0 ||
      !session.waitlistEnabled ||
      this.confirmationWaitlistStartConfigured(config) ||
      this.shouldKeepWaitlistPromotionClosed(config)
    ) {
      return { config, details: [] };
    }

    let registrations = registrationsBeforeCleanup.filter(
      (registration) => !removedTeamIds.includes(registration.teamId),
    );
    try {
      registrations = await this.apiClient.listRegistrations(session.id);
    } catch (error) {
      console.warn(
        `[DiscordConfirmation] post-cleanup registration reload failed session=${session.id}: ${String(
          error,
        )}`,
      );
    }

    if (
      !this.hasActiveWaitlistRegistration(registrations) ||
      this.nextAvailableNormalSlot(session, registrations, config) === null
    ) {
      return { config, details: [] };
    }

    const nowIso = now.toISOString();
    const graceUntil = new Date(
      now.getTime() + this.confirmationWaitlistGraceMinutes(config) * 60_000,
    );
    const graceUntilIso = graceUntil.toISOString();
    const manualState = this.waitlistPromotionManualState(config);
    const autoOpenWaitlist =
      !manualState && !this.waitlistPromotionScheduleOverrideState(config);
    const nextEmojis = {
      ...(config.emojis ?? {}),
      playConfirmationWaitlistGraceStartedAt: nowIso,
      playConfirmationWaitlistGraceUntil: graceUntilIso,
      ...(autoOpenWaitlist
        ? { waitlistPromotionAutoOpenUntil: graceUntilIso }
        : {}),
    };

    try {
      const updatedConfig = await this.apiClient.updateSessionDiscordConfig(
        session.id,
        { emojis: nextEmojis },
      );
      this.scheduleConfirmationWindowSync(guild, session.id, updatedConfig);
      this.scheduleWaitlistPromotionWindowSync(guild, session, updatedConfig);
      console.log(
        `[DiscordConfirmation] post-cleanup waitlist grace session=${session.id} until=${graceUntilIso} autoOpen=${autoOpenWaitlist}`,
      );
      return {
        config: updatedConfig,
        details: [
          `Confirmation grace until: ${graceUntilIso}`,
          autoOpenWaitlist
            ? `Waitlist auto-open until: ${graceUntilIso}`
            : "Waitlist promotion was already manually open.",
        ],
      };
    } catch (error) {
      console.warn(
        `[DiscordConfirmation] post-cleanup waitlist grace failed session=${session.id}: ${String(
          error,
        )}`,
      );
      return {
        config,
        details: ["Waitlist grace update failed; see bot logs."],
      };
    }
  }

  private confirmationCleanupStatusLabel(
    registration: Pick<SessionRegistrationResponse, "note">,
  ) {
    return this.registrationPlayStatus(registration)?.status === "NOT_PLAYING"
      ? "marked not playing"
      : "not confirmed";
  }

  private renderConfirmationCleanupReason(
    template: string,
    session: Pick<SessionResponse, "name" | "id">,
    registration: SessionRegistrationResponse,
  ) {
    const values: Record<string, string> = {
      session: session.name || session.id,
      sessionId: session.id,
      team: this.resolveTeamLabel(registration),
      teamName: registration.team?.name?.trim() || registration.teamId,
      teamTag: registration.team?.tag?.trim() || "",
      slot:
        registration.slotNumber !== null ? String(registration.slotNumber) : "",
      status: this.confirmationCleanupStatusLabel(registration),
      misses: "1",
    };
    return template
      .replace(
        /\{([A-Za-z0-9_]+)\}/g,
        (match, key: string) => values[key] ?? match,
      )
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 240);
  }

  private registrationManagerTargets(
    registration: SessionRegistrationResponse,
    members: TeamMemberSummary[] = [],
  ): DiscordManagerBanTarget[] {
    const memberByDiscordId = new Map(
      members
        .filter((member) => this.isActiveTeamMember(member))
        .filter((member) => member.discordUserId?.trim())
        .map((member) => [member.discordUserId, member] as const),
    );
    const activeLeaders = members
      .filter(
        (member) =>
          this.isActiveTeamMember(member) &&
          member.role === "LEADER" &&
          member.discordUserId?.trim(),
      )
      .map((member) => member.discordUserId);
    const ids = this.uniqueStrings([
      registration.leaderDiscordUserId,
      ...(registration.managerDiscordUserIds ?? []),
      ...activeLeaders,
    ]);

    return ids.map((discordUserId) => {
      const member = memberByDiscordId.get(discordUserId);
      return {
        discordUserId,
        discordUsername: member?.discordUsername ?? null,
        displayName: member?.displayName ?? null,
      };
    });
  }

  private confirmationCleanupNote(
    closedAtIso: string,
    registration: SessionRegistrationResponse,
  ) {
    return [
      "Automatic confirmation-close cleanup.",
      `Closed at: ${closedAtIso}.`,
      `Status: ${this.confirmationCleanupStatusLabel(registration)}.`,
    ].join(" ");
  }

  private async sendConfirmationCleanupBanNotice(
    guild: Guild,
    config: SessionDiscordConfigResponse,
    params: {
      session: SessionResponse;
      scope: TeamBanScope;
      days: number | null;
      expiresAt: string | null;
      reason: string;
      teams: Array<{
        registration: SessionRegistrationResponse;
        managers: DiscordManagerBanTarget[];
      }>;
      createdCount: number;
      alreadyBannedCount: number;
    },
  ) {
    if (!params.teams.length) {
      return;
    }

    const teamLines = params.teams.slice(0, 10).map((entry) => {
      return `- ${this.resolveTeamLabel(entry.registration)} | Manager${
        entry.managers.length === 1 ? "" : "s"
      }: ${this.simpleBanManagersLabel(entry.managers)} | ${this.confirmationCleanupStatusLabel(
        entry.registration,
      )}`;
    });
    if (params.teams.length > 10) {
      teamLines.push(`- +${params.teams.length - 10} more`);
    }

    await this.sendDiscordBanChannelContent(
      guild,
      config,
      [
        "**Confirmation cleanup bans saved**",
        `Session: ${params.session.name || params.session.id}`,
        `Duration: ${this.simpleBanDurationLabel(
          params.days,
          params.expiresAt,
        )}`,
        `Scope: ${this.simpleBanScopeLabel(
          params.scope,
          params.scope === "SESSION"
            ? [{ id: params.session.id, name: params.session.name }]
            : [],
          params.session.name,
        )}`,
        `Reason: ${params.reason}`,
        `Created: ${params.createdCount}`,
        `Already banned: ${params.alreadyBannedCount}`,
        "Teams:",
        ...teamLines,
      ].join("\n"),
    );
  }

  private async applyDueConfirmationCloseCleanup(
    guild: Guild,
    session: SessionResponse,
    config: SessionDiscordConfigResponse,
    now = new Date(),
  ): Promise<SessionDiscordConfigResponse> {
    if (!this.confirmationCleanupEnabled(config)) {
      return config;
    }

    const cleanupWindow = playConfirmationCleanupWindow(config, now);
    if (
      !cleanupWindow.configured ||
      cleanupWindow.mode !== "weekly" ||
      !cleanupWindow.cleanupAt
    ) {
      return config;
    }

    const cleanupAtIso = cleanupWindow.cleanupAt.toISOString();
    const closedAtIso = cleanupWindow.closesAt?.toISOString() ?? cleanupAtIso;
    if (config.emojis?.playConfirmationCleanupLastClosedAt === cleanupAtIso) {
      return config;
    }

    const runKey = [guild.id, session.id, cleanupAtIso].join(":");
    if (this.confirmationCloseCleanupRunKeys.has(runKey)) {
      return config;
    }
    this.confirmationCloseCleanupRunKeys.add(runKey);

    const markProcessed = () =>
      this.persistManagedMessageIds(session.id, config, {
        playConfirmationCleanupLastClosedAt: cleanupAtIso,
      });

    try {
      const cleanupAgeMs = now.getTime() - cleanupWindow.cleanupAt.getTime();
      if (
        cleanupAgeMs < 0 ||
        cleanupAgeMs > CONFIRMATION_CLOSE_CLEANUP_GRACE_MS
      ) {
        console.log(
          `[DiscordConfirmation] skipped stale close cleanup session=${session.id} cleanupAt=${cleanupAtIso}`,
        );
        return await markProcessed();
      }

      const registrations = await this.apiClient.listRegistrations(session.id);
      const targets = this.playStatusCandidateRegistrations(
        registrations,
      ).filter(
        (registration) =>
          this.registrationPlayStatus(registration)?.status !== "CONFIRM",
      );

      if (!targets.length) {
        console.log(
          `[DiscordConfirmation] close cleanup no targets session=${session.id} closedAt=${closedAtIso}`,
        );
        return await markProcessed();
      }

      const memberCache = await this.loadTeamMembersForSync(
        targets.map((registration) => registration.teamId),
      );
      const banSettings = this.confirmationCleanupBanSettings(config);
      const removedRegistrations: SessionRegistrationResponse[] = [];
      const bannedTeams: Array<{
        registration: SessionRegistrationResponse;
        managers: DiscordManagerBanTarget[];
      }> = [];
      const activeTeamIds: string[] = [];
      let failed = 0;
      let alreadyBannedCount = 0;
      let createdBanCount = 0;
      const serverActionDetails: string[] = [];
      const firstReason = targets[0]
        ? this.renderConfirmationCleanupReason(
            banSettings?.reasonTemplate ||
              config.emojis?.playConfirmationCleanupReason ||
              "Missed confirmation for {session}",
            session,
            targets[0],
          )
        : "Missed confirmation";
      const expiresAt = banSettings
        ? this.banExpiresAt(banSettings.days)
        : null;

      for (const registration of targets) {
        const managers = this.registrationManagerTargets(
          registration,
          memberCache.get(registration.teamId) ?? [],
        );
        const reason = this.renderConfirmationCleanupReason(
          banSettings?.reasonTemplate ||
            config.emojis?.playConfirmationCleanupReason ||
            "Missed confirmation for {session}",
          session,
          registration,
        );
        const note = this.confirmationCleanupNote(closedAtIso, registration);

        try {
          if (banSettings) {
            let created: TeamBanResponse[] = [];
            try {
              created = await this.apiClient.createTeamBan({
                teamId: registration.teamId,
                scope: banSettings.scope,
                sessionId:
                  banSettings.scope === "SESSION" ? session.id : undefined,
                reason,
                note,
                expiresAt,
              });
              createdBanCount += created.length;
            } catch (error) {
              const friendly = toFriendlyApiError(error);
              if (!friendly.toLowerCase().includes("active ban")) {
                throw error;
              }
              alreadyBannedCount += 1;
            }
            const removeResult: RemoveRegistrationResponse =
              await this.apiClient.removeRegistration(
                session.id,
                registration.id,
                {
                  removalReason: reason,
                  note,
                },
              );
            const details = await this.applyDiscordBanServerAction(
              guild,
              config,
              managers,
              this.configuredBanServerAction(
                {
                  target: { kind: "team-id", teamId: registration.teamId },
                  scope: banSettings.scope,
                  sessionId: session.id,
                },
                config,
              ),
              reason,
              { permanent: !expiresAt },
            );
            serverActionDetails.push(...details);
            bannedTeams.push({ registration, managers });
            removedRegistrations.push(
              removeResult.removedRegistration ?? registration,
            );
            if (removeResult.promotedRegistration) {
              activeTeamIds.push(removeResult.promotedRegistration.teamId);
            }
          } else {
            const result = await this.apiClient.removeRegistration(
              session.id,
              registration.id,
              {
                removalReason: reason,
                note,
              },
            );
            removedRegistrations.push(
              result.removedRegistration ?? registration,
            );
            if (result.promotedRegistration) {
              activeTeamIds.push(result.promotedRegistration.teamId);
            }
          }
        } catch (error) {
          failed += 1;
          console.warn(
            `[DiscordConfirmation] close cleanup failed session=${session.id} registration=${registration.id}: ${String(
              error,
            )}`,
          );
        }
      }

      const removedTeamIds = this.uniqueStrings(
        removedRegistrations.map((registration) => registration.teamId),
      );
      const waitlistGrace =
        await this.maybeOpenWaitlistAfterConfirmationCleanup(
          guild,
          session,
          config,
          registrations,
          removedTeamIds,
          now,
        );
      config = waitlistGrace.config;

      if (removedTeamIds.length > 0) {
        this.syncDiscordScrimStateInBackground(guild, session.id, {
          organizationId: config.organizationId,
          removedTeamIds,
          activeTeamIds,
          extraDiscordUserIds:
            this.registrationRoleSyncDiscordUserIds(removedRegistrations),
          cleanupTeamIds: removedTeamIds,
          fastMessageRefresh: true,
          skipFullSync: true,
          delayMs: 0,
        });
        this.reconcileScrimRolesInBackground(guild, session.id);
      }

      if (banSettings && bannedTeams.length > 0) {
        await this.refreshDiscordBanListMessage(guild, config, session.id);
        await this.sendConfirmationCleanupBanNotice(guild, config, {
          session,
          scope: banSettings.scope,
          days: banSettings.days,
          expiresAt,
          reason: firstReason,
          teams: bannedTeams,
          createdCount: createdBanCount,
          alreadyBannedCount,
        });
      }

      await this.sendDiscordActionLog(guild, config, {
        action: banSettings
          ? "Confirmation cleanup completed with bans"
          : "Confirmation cleanup completed",
        actorLabel: "System",
        sessionId: session.id,
        sessionName: session.name,
        status: `${removedRegistrations.length}/${targets.length} team(s) removed`,
        reason: firstReason,
        details: [
          `Closed at: ${closedAtIso}`,
          `Cleanup at: ${cleanupAtIso}`,
          `Not playing or unconfirmed: ${targets.length}`,
          banSettings
            ? `Bans created: ${createdBanCount}; already banned: ${alreadyBannedCount}`
            : "Bans disabled for this cleanup.",
          ...waitlistGrace.details,
          failed ? `Failed: ${failed}` : null,
          ...serverActionDetails,
        ].filter((line): line is string => Boolean(line)),
        color: banSettings ? 0xef4444 : 0xf59e0b,
      });

      console.log(
        `[DiscordConfirmation] close cleanup session=${session.id} removed=${removedRegistrations.length} targets=${targets.length} bans=${createdBanCount} failed=${failed} cleanupAt=${cleanupAtIso}`,
      );
      return await markProcessed();
    } catch (error) {
      this.confirmationCloseCleanupRunKeys.delete(runKey);
      throw error;
    }
  }

  private confirmationReminderWindowKey(
    window: ReturnType<typeof playConfirmationWindow>,
  ) {
    return [
      window.mode,
      window.opensAt?.toISOString() ?? "open",
      window.closesAt?.toISOString() ?? "no-close",
      window.waitlistStartsAt?.toISOString() ?? "no-waitlist",
      window.timeZone ?? "",
    ].join("|");
  }

  private extractDiscordUserIdsFromMentions(mentions: string[]) {
    return [
      ...new Set(
        mentions
          .flatMap((mention) =>
            [...mention.matchAll(/<@!?(\d+)>/g)].map((match) => match[1]),
          )
          .filter((value): value is string => Boolean(value)),
      ),
    ];
  }

  private renderConfirmationReminderTemplate(
    template: string,
    values: Record<string, string>,
  ) {
    return template
      .replace(/\{([A-Za-z]+)\}/g, (match, key: string) => values[key] ?? match)
      .replace(/[ \t]+([.,])/g, "$1")
      .trim()
      .slice(0, 1900);
  }

  private async deleteConfirmationReminderMessage(
    channel: GuildTextBasedChannel,
    messageId: string | undefined,
  ) {
    const id = messageId?.trim();
    if (!id) {
      return;
    }
    const message = await channel.messages.fetch(id).catch(() => null);
    await message?.delete().catch(() => undefined);
  }

  private storedConfirmationReminderMessageId(
    config: SessionDiscordConfigResponse,
    windowKey: string,
  ) {
    const storedWindowKey =
      config.emojis?.managedConfirmationReminderWindowKey?.trim();
    if (storedWindowKey !== windowKey) {
      return undefined;
    }
    return (
      config.emojis?.managedConfirmationReminderMessageId?.trim() || undefined
    );
  }

  private async persistConfirmationReminderMessageId(
    sessionId: string,
    config: SessionDiscordConfigResponse,
    windowKey: string,
    messageId: string,
  ) {
    try {
      const latestConfig = await this.latestSessionDiscordConfig(
        sessionId,
        config,
      );
      const nextEmojis = {
        ...(latestConfig.emojis ?? {}),
        managedConfirmationReminderMessageId: messageId,
        managedConfirmationReminderWindowKey: windowKey,
      };
      if (
        latestConfig.emojis?.managedConfirmationReminderMessageId ===
          messageId &&
        latestConfig.emojis?.managedConfirmationReminderWindowKey === windowKey
      ) {
        return;
      }
      await this.apiClient.updateSessionDiscordConfig(sessionId, {
        emojis: nextEmojis,
      });
    } catch (error) {
      console.warn(
        `[DiscordReminder] failed to persist reminder message session=${sessionId}: ${String(
          error,
        )}`,
      );
    }
  }

  private async runDueConfirmationReminders(
    guild: Guild,
    session: SessionResponse,
    config: SessionDiscordConfigResponse,
    now = new Date(),
  ) {
    const reminderConfig = this.confirmationReminderConfig(config);
    const stateKey = this.syncQueueKey(guild, session.id);
    const window = playConfirmationWindow(config, now);
    if (
      !reminderConfig.enabled ||
      !config.slotListChannelId ||
      !window.configured ||
      !window.allowsAction
    ) {
      this.confirmationReminderStates.delete(stateKey);
      return;
    }

    const windowKey = this.confirmationReminderWindowKey(window);
    let state = this.confirmationReminderStates.get(stateKey);
    if (!state || state.windowKey !== windowKey) {
      state = {
        windowKey,
        sentCount: 0,
        lastSentAt: 0,
        lastMessageId: this.storedConfirmationReminderMessageId(
          config,
          windowKey,
        ),
      };
      this.confirmationReminderStates.set(stateKey, state);
    }

    if (state.sentCount >= reminderConfig.maxMessages) {
      return;
    }

    const openAt = window.opensAt?.getTime() ?? now.getTime();
    const firstDueAt = openAt + reminderConfig.openDelayMinutes * 60_000;
    if (now.getTime() < firstDueAt) {
      return;
    }
    if (
      state.sentCount > 0 &&
      now.getTime() - state.lastSentAt < reminderConfig.intervalMinutes * 60_000
    ) {
      return;
    }

    const registrations = await this.apiClient.listRegistrations(session.id);
    const candidates = registrations.filter(
      (registration) =>
        this.activeRegistrationStatus(registration) &&
        (registration.status === "CONFIRMED" ||
          registration.status === "CHECKED_IN") &&
        registration.slotNumber !== null,
    );
    if (candidates.length === 0) {
      return;
    }

    const pending = candidates
      .filter((registration) => !this.registrationPlayStatus(registration))
      .sort((left, right) => (left.slotNumber ?? 0) - (right.slotNumber ?? 0));
    if (pending.length === 0) {
      return;
    }

    const memberCache = await this.loadTeamMembersForSync(
      candidates.map((registration) => registration.teamId),
    );
    const managerMentionByTeamId = await this.managerMentionByTeamIdForGuild(
      guild,
      candidates,
      memberCache,
    );
    const managerMentions = pending
      .map((registration) => managerMentionByTeamId.get(registration.teamId))
      .filter((mention): mention is string => Boolean(mention));
    const managerMentionUserIds =
      this.extractDiscordUserIdsFromMentions(managerMentions);
    const shouldMentionManagers =
      pending.length <= reminderConfig.managerMentionThreshold &&
      managerMentionUserIds.length > 0;
    const roleMention = reminderConfig.roleId
      ? `<@&${reminderConfig.roleId}>`
      : "";
    const confirmedCount = candidates.filter(
      (registration) =>
        this.registrationPlayStatus(registration)?.status === "CONFIRM",
    ).length;
    const notPlayingCount = candidates.filter(
      (registration) =>
        this.registrationPlayStatus(registration)?.status === "NOT_PLAYING",
    ).length;
    const pendingTeams = pending
      .slice(0, 12)
      .map((registration) => {
        const slot = registration.slotNumber
          ? `#${registration.slotNumber} `
          : "";
        return `${slot}${this.formatTeamSlotRow(
          registration,
          managerMentionByTeamId.get(registration.teamId),
        )}`;
      })
      .join("\n");
    const values = {
      role: roleMention,
      managers: managerMentions.join(" "),
      session: session.name,
      pendingCount: String(pending.length),
      totalCount: String(candidates.length),
      confirmedCount: String(confirmedCount),
      notPlayingCount: String(notPlayingCount),
      pendingTeams,
      closes: window.closesAt
        ? `<t:${Math.floor(window.closesAt.getTime() / 1000)}:f>`
        : "",
      closesRelative: window.closesAt
        ? `<t:${Math.floor(window.closesAt.getTime() / 1000)}:R>`
        : "",
    };
    const content = this.renderConfirmationReminderTemplate(
      shouldMentionManagers
        ? reminderConfig.managerMessageText
        : reminderConfig.roleMessageText,
      values,
    );
    if (!content) {
      return;
    }

    const channel = await this.fetchAutoCleanupChannel(
      guild,
      config.slotListChannelId,
    );
    if (!channel) {
      return;
    }

    const userIds = shouldMentionManagers ? managerMentionUserIds : [];
    const previousMessageId = state.lastMessageId;
    const sentMessage = await channel.send({
      content,
      allowedMentions: allowedMentionsForOrganizerText(content, {
        roles:
          !shouldMentionManagers && reminderConfig.roleId
            ? [reminderConfig.roleId]
            : [],
        users: userIds,
      }),
    });
    state.sentCount += 1;
    state.lastSentAt = now.getTime();
    state.lastMessageId = sentMessage.id;
    if (previousMessageId && previousMessageId !== sentMessage.id) {
      await this.deleteConfirmationReminderMessage(channel, previousMessageId);
    }
    await this.persistConfirmationReminderMessageId(
      session.id,
      config,
      windowKey,
      sentMessage.id,
    );
    console.log(
      `[DiscordReminder] sent session=${session.id} pending=${pending.length}/${candidates.length} mode=${shouldMentionManagers ? "managers" : "role"} count=${state.sentCount}`,
    );
  }

  private normalizeAutoCleanupTime(value: unknown) {
    const text = typeof value === "string" ? value.trim() : "";
    const match = /^(\d{1,2}):(\d{2})$/.exec(text);
    if (!match) {
      return "";
    }
    const hour = Number.parseInt(match[1], 10);
    const minute = Number.parseInt(match[2], 10);
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
      return "";
    }
    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  }

  private autoCleanupTimeZone(config: SessionDiscordConfigResponse | null) {
    const emojis = config?.emojis ?? {};
    const timeZone =
      emojis.autoCleanupTimeZone?.trim() ||
      emojis.registrationTimeZone?.trim() ||
      emojis.playConfirmationTimeZone?.trim() ||
      "UTC";
    try {
      new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
      return timeZone;
    } catch {
      return "UTC";
    }
  }

  private autoCleanupZonedParts(now: Date, timeZone: string) {
    try {
      const formatter = new Intl.DateTimeFormat("en-US", {
        timeZone,
        hour12: false,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
      const parts = Object.fromEntries(
        formatter
          .formatToParts(now)
          .filter((part) => part.type !== "literal")
          .map((part) => [part.type, part.value]),
      );
      return {
        year: Number.parseInt(parts.year ?? "0", 10),
        month: Number.parseInt(parts.month ?? "0", 10),
        day: Number.parseInt(parts.day ?? "0", 10),
        hour: Number.parseInt(parts.hour ?? "0", 10) % 24,
        minute: Number.parseInt(parts.minute ?? "0", 10),
      };
    } catch {
      return {
        year: now.getUTCFullYear(),
        month: now.getUTCMonth() + 1,
        day: now.getUTCDate(),
        hour: now.getUTCHours(),
        minute: now.getUTCMinutes(),
      };
    }
  }

  private autoCleanupDateKey(parts: {
    year: number;
    month: number;
    day: number;
  }) {
    return [
      parts.year,
      String(parts.month).padStart(2, "0"),
      String(parts.day).padStart(2, "0"),
    ].join("-");
  }

  private autoCleanupMinutes(parts: { hour: number; minute: number }) {
    return parts.hour * 60 + parts.minute;
  }

  private autoCleanupScheduleMinutes(
    schedule: Pick<AutoCleanupSchedule, "time">,
  ) {
    const [hour, minute] = schedule.time
      .split(":")
      .map((value) => Number(value));
    if (!Number.isInteger(hour) || !Number.isInteger(minute)) {
      return null;
    }
    return hour * 60 + minute;
  }

  private autoCleanupSchedules(
    config: SessionDiscordConfigResponse | null,
  ): AutoCleanupSchedule[] {
    const value = config?.emojis?.autoCleanupSchedules?.trim();
    if (!value) {
      return [];
    }

    try {
      const parsed = JSON.parse(value) as unknown;
      if (!Array.isArray(parsed)) {
        return [];
      }
      return parsed
        .map((entry): AutoCleanupSchedule | null => {
          if (!entry || typeof entry !== "object") {
            return null;
          }
          const record = entry as Record<string, unknown>;
          const channel = String(record.channel ?? "").trim();
          if (!AUTO_CLEANUP_CHANNELS.some((option) => option.key === channel)) {
            return null;
          }
          const time = this.normalizeAutoCleanupTime(record.time);
          const mode: AutoCleanupMode = record.mode === "all" ? "all" : "safe";
          const defaultLimit =
            mode === "all"
              ? AUTO_CLEANUP_ALL_LIMIT
              : AUTO_CLEANUP_DEFAULT_LIMIT;
          const parsedLimit = Number.parseInt(String(record.limit ?? ""), 10);
          const limit = Math.min(
            AUTO_CLEANUP_MAX_LIMIT,
            Math.max(
              1,
              Number.isFinite(parsedLimit) ? parsedLimit : defaultLimit,
            ),
          );
          return {
            channel: channel as AutoCleanupChannelKey,
            enabled: record.enabled === true || record.enabled === "true",
            time,
            mode,
            limit,
          };
        })
        .filter((schedule): schedule is AutoCleanupSchedule =>
          Boolean(schedule?.enabled && schedule.time),
        );
    } catch {
      return [];
    }
  }

  private autoCleanupChannelId(
    config: SessionDiscordConfigResponse,
    channel: AutoCleanupChannelKey,
  ) {
    switch (channel) {
      case "session":
        return null;
      case "registration":
        return config.registrationChannelId;
      case "slots":
        return config.slotListChannelId;
      case "slotData":
      case "registrations":
        return null;
      case "waitlist":
        return config.waitlistChannelId;
      case "idp":
        return config.idpChannelId;
      case "manager":
        return config.managerChannelId;
      case "transfer":
        return config.transferChannelId;
      case "roles":
        return config.logChannelId ?? config.slotListChannelId;
      default:
        return null;
    }
  }

  private autoCleanupChannelLabel(channel: AutoCleanupChannelKey) {
    return (
      AUTO_CLEANUP_CHANNELS.find((option) => option.key === channel)?.label ??
      channel
    );
  }

  private rememberAutoCleanupRunKey(runKey: string) {
    this.autoCleanupRunKeys.add(runKey);
    if (this.autoCleanupRunKeys.size <= 5000) {
      return;
    }
    for (const key of Array.from(this.autoCleanupRunKeys).slice(0, 2500)) {
      this.autoCleanupRunKeys.delete(key);
    }
  }

  private async runDueAutoCleanups(
    guild: Guild,
    session: SessionResponse,
    config: SessionDiscordConfigResponse,
    now = new Date(),
  ) {
    const schedules = this.autoCleanupSchedules(config);
    if (schedules.length === 0) {
      return;
    }

    const timeZone = this.autoCleanupTimeZone(config);
    const parts = this.autoCleanupZonedParts(now, timeZone);
    const dateKey = this.autoCleanupDateKey(parts);
    const startedParts = this.autoCleanupZonedParts(
      new Date(this.autoCleanupStartedAt),
      timeZone,
    );
    const startedDateKey = this.autoCleanupDateKey(startedParts);

    for (const schedule of schedules) {
      if (!this.autoCleanupScheduleDue(schedule, parts)) {
        continue;
      }
      const runKey = [
        guild.id,
        session.id,
        schedule.channel,
        dateKey,
        schedule.time,
      ].join(":");
      if (this.autoCleanupRunKeys.has(runKey)) {
        continue;
      }

      if (
        this.shouldSkipStartupAutoCleanupCatchup(
          schedule,
          parts,
          dateKey,
          startedParts,
          startedDateKey,
        )
      ) {
        this.rememberAutoCleanupRunKey(runKey);
        console.log(
          `[DiscordCleanup] skipped stale startup catch-up session=${session.id} channel=${schedule.channel} date=${dateKey} time=${schedule.time}`,
        );
        continue;
      }

      this.rememberAutoCleanupRunKey(runKey);
      if (schedule.channel === "session") {
        await this.withOrganization(config.organizationId, () =>
          this.cleanScheduledFullSession(guild, session, config, schedule),
        ).catch((error) => {
          console.warn(
            `[DiscordCleanup] scheduled full session cleanup failed session=${session.id}: ${String(error)}`,
          );
        });
        continue;
      }

      if (schedule.channel === "slotData") {
        await this.withOrganization(config.organizationId, () =>
          this.cleanScheduledAssignedSlots(guild, session, config, schedule),
        ).catch((error) => {
          console.warn(
            `[DiscordCleanup] scheduled assigned slot cleanup failed session=${session.id}: ${String(error)}`,
          );
        });
        continue;
      }

      if (schedule.channel === "registrations") {
        await this.withOrganization(config.organizationId, () =>
          this.cleanScheduledRegisteredTeams(guild, session, config, schedule),
        ).catch((error) => {
          console.warn(
            `[DiscordCleanup] scheduled registered team cleanup failed session=${session.id}: ${String(error)}`,
          );
        });
        continue;
      }

      if (schedule.channel === "roles") {
        await this.withOrganization(config.organizationId, () =>
          this.cleanScheduledScrimRoles(guild, session, config, schedule),
        ).catch((error) => {
          console.warn(
            `[DiscordCleanup] scheduled role cleanup failed session=${session.id}: ${String(error)}`,
          );
        });
        continue;
      }

      const channelId = this.autoCleanupChannelId(config, schedule.channel);
      if (!channelId) {
        continue;
      }
      await this.cleanScheduledDiscordChannel(
        guild,
        session,
        config,
        schedule,
        channelId,
      ).catch((error) => {
        console.warn(
          `[DiscordCleanup] scheduled cleanup failed session=${session.id} channel=${channelId}: ${String(error)}`,
        );
      });
    }
  }

  private protectedAutoCleanupMessageIds(config: SessionDiscordConfigResponse) {
    return new Set(
      [
        config.emojis?.managedRegistrationPanelMessageId,
        config.emojis?.managedRegistrationStatusMessageId,
        config.emojis?.managedEarlyAccessStatusMessageId,
        config.emojis?.managedVipAccessStatusMessageId,
        config.emojis?.managedSlotListMessageId,
        config.emojis?.managedWaitlistMessageId,
        config.emojis?.managedConfirmationMessageId,
        ...parseRoleAccessGroups(config).map((group) => group.managedMessageId),
      ]
        .map((value) => value?.trim())
        .filter((value): value is string => Boolean(value)),
    );
  }

  private async fetchAutoCleanupChannel(guild: Guild, channelId: string) {
    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased() || channel.isDMBased()) {
      return null;
    }
    return channel as GuildTextBasedChannel;
  }

  private async collectAutoCleanupTargets(
    channel: GuildTextBasedChannel,
    limit: number,
    protectedIds: Set<string>,
  ) {
    const targets: Message[] = [];
    let before: string | undefined;

    while (targets.length < limit) {
      const batch = await channel.messages.fetch({
        limit: 100,
        ...(before ? { before } : {}),
      });
      if (batch.size === 0) {
        break;
      }

      for (const candidate of batch.values()) {
        if (this.shouldAutoCleanupDeleteMessage(candidate, protectedIds)) {
          targets.push(candidate);
          if (targets.length >= limit) {
            break;
          }
        }
      }

      before = batch.last()?.id;
      if (!before || batch.size < 100) {
        break;
      }
    }

    return targets;
  }

  private autoCleanupScheduleDue(
    schedule: AutoCleanupSchedule,
    parts: { hour: number; minute: number },
  ) {
    const scheduledMinutes = this.autoCleanupScheduleMinutes(schedule);
    if (scheduledMinutes === null) {
      return false;
    }

    const currentMinutes = this.autoCleanupMinutes(parts);
    const elapsedMinutes = currentMinutes - scheduledMinutes;
    return elapsedMinutes >= 0 && elapsedMinutes <= AUTO_CLEANUP_GRACE_MINUTES;
  }

  private shouldSkipStartupAutoCleanupCatchup(
    schedule: AutoCleanupSchedule,
    parts: { hour: number; minute: number },
    dateKey: string,
    startedParts: { hour: number; minute: number },
    startedDateKey: string,
  ) {
    if (startedDateKey !== dateKey) {
      return false;
    }

    const scheduledMinutes = this.autoCleanupScheduleMinutes(schedule);
    if (scheduledMinutes === null) {
      return false;
    }

    const startupElapsed =
      this.autoCleanupMinutes(startedParts) - scheduledMinutes;
    const currentElapsed = this.autoCleanupMinutes(parts) - scheduledMinutes;
    return (
      startupElapsed > AUTO_CLEANUP_STARTUP_CATCHUP_GRACE_MINUTES &&
      currentElapsed > AUTO_CLEANUP_STARTUP_CATCHUP_GRACE_MINUTES
    );
  }

  private shouldAutoCleanupDeleteMessage(
    message: Message,
    protectedIds: Set<string>,
  ) {
    if (message.pinned || protectedIds.has(message.id)) {
      return false;
    }
    if (
      message.embeds.some((embed) =>
        embed.footer?.text?.startsWith("arenzyra:"),
      )
    ) {
      return false;
    }
    return true;
  }

  private async deleteAutoCleanupTargets(messages: Message[]) {
    const now = Date.now();
    const recent = messages.filter(
      (message) =>
        now - message.createdTimestamp < DISCORD_BULK_DELETE_MAX_AGE_MS,
    );
    const old = messages.filter(
      (message) =>
        now - message.createdTimestamp >= DISCORD_BULK_DELETE_MAX_AGE_MS,
    );
    let deleted = 0;
    let failed = 0;

    const byChannel = new Map<string, Message[]>();
    for (const message of recent) {
      const entries = byChannel.get(message.channel.id) ?? [];
      entries.push(message);
      byChannel.set(message.channel.id, entries);
    }

    for (const entries of byChannel.values()) {
      for (let index = 0; index < entries.length; index += 100) {
        const chunk = entries.slice(index, index + 100);
        const channel = chunk[0]?.channel;
        if (!channel || !("bulkDelete" in channel)) {
          failed += chunk.length;
          continue;
        }
        const deletedMessages = await channel
          .bulkDelete(chunk, true)
          .catch(() => null);
        deleted += deletedMessages?.size ?? 0;
        failed += chunk.length - (deletedMessages?.size ?? 0);
      }
    }

    for (const message of old) {
      try {
        await message.delete();
        deleted += 1;
      } catch {
        failed += 1;
      }
    }

    return { deleted, failed };
  }

  private configuredAutoCleanupChannelTargets(
    config: SessionDiscordConfigResponse,
  ) {
    const targets: Array<{
      key: string;
      label: string;
      channelId: string;
    }> = [
      {
        key: "registration",
        label: "Registration",
        channelId: config.registrationChannelId ?? "",
      },
      {
        key: "slots",
        label: "Slot Channel Messages",
        channelId: config.slotListChannelId ?? "",
      },
      {
        key: "waitlist",
        label: "Waitlist",
        channelId: config.waitlistChannelId ?? "",
      },
      { key: "idp", label: "IDP", channelId: config.idpChannelId ?? "" },
      {
        key: "manager",
        label: "Manager Chat",
        channelId: config.managerChannelId ?? "",
      },
      {
        key: "transfer",
        label: "Transfer Roles",
        channelId: config.transferChannelId ?? "",
      },
      {
        key: "manage",
        label: "Manage",
        channelId: config.manageChannelId ?? "",
      },
      {
        key: "results",
        label: "Results",
        channelId: config.resultsChannelId ?? "",
      },
      {
        key: "screenshots",
        label: "Screenshots",
        channelId: config.screenshotsChannelId ?? "",
      },
      { key: "bans", label: "Bans", channelId: config.bansChannelId ?? "" },
      { key: "log", label: "Log", channelId: config.logChannelId ?? "" },
    ];
    const byChannelId = new Map<string, (typeof targets)[number]>();
    for (const target of targets) {
      const channelId = target.channelId.trim();
      if (!channelId || byChannelId.has(channelId)) {
        continue;
      }
      byChannelId.set(channelId, { ...target, channelId });
    }
    return [...byChannelId.values()];
  }

  private async cleanAutoCleanupChannelMessages(
    guild: Guild,
    config: SessionDiscordConfigResponse,
    channelId: string,
    label: string,
    limit: number,
  ) {
    const channel = await this.fetchAutoCleanupChannel(guild, channelId);
    if (!channel) {
      return null;
    }

    const targets = await this.collectAutoCleanupTargets(
      channel,
      limit,
      this.protectedAutoCleanupMessageIds(config),
    );
    const result = await this.deleteAutoCleanupTargets(targets);
    return {
      channel,
      label,
      selected: targets.length,
      deleted: result.deleted,
      failed: result.failed,
    };
  }

  private async cleanScheduledDiscordChannel(
    guild: Guild,
    session: SessionResponse,
    config: SessionDiscordConfigResponse,
    schedule: AutoCleanupSchedule,
    channelId: string,
  ) {
    const cleanup = await this.cleanAutoCleanupChannelMessages(
      guild,
      config,
      channelId,
      this.autoCleanupChannelLabel(schedule.channel),
      schedule.limit,
    );
    if (!cleanup) {
      return;
    }

    await this.logScheduledDiscordCleanup(
      guild,
      session,
      config,
      cleanup.channel,
      schedule,
      cleanup.selected,
      { deleted: cleanup.deleted, failed: cleanup.failed },
    );
    console.log(
      `[DiscordCleanup] scheduled session=${session.id} channel=${cleanup.channel.id} selected=${cleanup.selected} deleted=${cleanup.deleted} failed=${cleanup.failed}`,
    );
  }

  private async cleanScheduledFullSession(
    guild: Guild,
    session: SessionResponse,
    config: SessionDiscordConfigResponse,
    schedule: AutoCleanupSchedule,
  ) {
    const channelResults: Array<{
      channel: GuildTextBasedChannel;
      label: string;
      selected: number;
      deleted: number;
      failed: number;
    }> = [];
    for (const target of this.configuredAutoCleanupChannelTargets(config)) {
      const result = await this.cleanAutoCleanupChannelMessages(
        guild,
        config,
        target.channelId,
        target.label,
        schedule.limit,
      ).catch((error) => {
        console.warn(
          `[DiscordCleanup] full session channel cleanup failed session=${session.id} channel=${target.channelId}: ${String(error)}`,
        );
        return null;
      });
      if (result) {
        channelResults.push(result);
      }
    }

    const roleMode: ScrimRoleCleanupMode =
      schedule.mode === "all" ? "strip" : "reconcile";
    const setup = this.setupFromConfig(config);
    const hasManagedRoles =
      setup &&
      this.scrimManagedRoleIds(setup, {
        includeBannedRole: schedule.mode === "all",
      }).length > 0;
    const roleResult = hasManagedRoles
      ? await this.runScrimRoleCleanup(guild, session, config, roleMode, {
          includeBannedRole: schedule.mode === "all",
          fetchAllGuildMembers: true,
        }).catch((error) => {
          console.warn(
            `[DiscordCleanup] full session role cleanup failed session=${session.id}: ${String(error)}`,
          );
          return null;
        })
      : null;

    await this.logScheduledFullSessionCleanup(
      guild,
      session,
      config,
      schedule,
      channelResults,
      roleResult,
    );

    const deleted = channelResults.reduce(
      (total, result) => total + result.deleted,
      0,
    );
    const failed = channelResults.reduce(
      (total, result) => total + result.failed,
      0,
    );
    console.log(
      `[DiscordCleanup] scheduled full session=${session.id} mode=${schedule.mode} channels=${channelResults.length} deleted=${deleted} failed=${failed} roleRemoved=${roleResult?.removed ?? 0} roleFailed=${roleResult?.failed ?? 0}`,
    );
  }

  private async cleanScheduledAssignedSlots(
    guild: Guild,
    session: SessionResponse,
    config: SessionDiscordConfigResponse,
    schedule: AutoCleanupSchedule,
  ) {
    const result = await this.apiClient.removeSlotRegistrations(session.id, {
      removalReason: "Scheduled assigned slot cleanup",
    });
    const removed = result.removedRegistrations ?? [];
    const removedTeamIds = this.uniqueStrings(
      result.removedTeamIds?.length
        ? result.removedTeamIds
        : removed.map((registration) => registration.teamId),
    );
    const removedSlots = (
      result.removedSlots?.length
        ? result.removedSlots
        : removed.map((registration) => registration.slotNumber)
    )
      .filter((slotNumber): slotNumber is number => slotNumber !== null)
      .sort((left, right) => left - right);

    this.syncDiscordScrimStateInBackground(guild, session.id, {
      organizationId: config.organizationId,
      removedTeamIds,
      extraDiscordUserIds: this.registrationRoleSyncDiscordUserIds(removed),
      cleanupTeamIds: removedTeamIds,
      fastMessageRefresh: true,
      skipFullSync: true,
      delayMs: 0,
    });
    this.reconcileScrimRolesInBackground(guild, session.id);

    await this.logScheduledRegistrationDataCleanup(guild, session, config, {
      title: "Scheduled assigned slot cleanup completed.",
      schedule,
      selected: removed.length,
      removed: removed.length,
      failed: 0,
      removedSlots,
      removedWaitlistPositions: [],
      note: [
        "Waitlist entries were kept.",
        this.formatResultResetNote(result.resultReset),
        "Discord refresh, role reconciliation, and roster release were queued.",
      ].join(" "),
    });
    console.log(
      `[DiscordCleanup] scheduled assigned slots session=${session.id} removed=${removed.length} slots=${removedSlots.length}`,
    );
  }

  private async cleanScheduledRegisteredTeams(
    guild: Guild,
    session: SessionResponse,
    config: SessionDiscordConfigResponse,
    schedule: AutoCleanupSchedule,
  ) {
    const registrations = await this.apiClient.listRegistrations(session.id);
    const removedRegistrations: SessionRegistrationResponse[] = [];
    let failed = 0;
    let resultReset: SessionResultResetResponse | null = null;
    let resultResetFailed = false;

    for (const registration of registrations) {
      try {
        const result = await this.apiClient.removeRegistration(
          session.id,
          registration.id,
          {
            removalReason: "Scheduled registered team cleanup",
          },
        );
        removedRegistrations.push(result.removedRegistration);
      } catch (error) {
        failed += 1;
        console.warn(
          `[DiscordCleanup] registered team cleanup failed session=${session.id} registration=${registration.id}: ${String(error)}`,
        );
      }
    }

    try {
      resultReset = await this.apiClient.resetSessionResults(session.id, {
        reason: "Scheduled registered team cleanup",
      });
    } catch (error) {
      resultResetFailed = true;
      failed += 1;
      console.warn(
        `[DiscordCleanup] registered team result reset failed session=${session.id}: ${String(error)}`,
      );
    }

    const removedTeamIds = this.uniqueStrings(
      removedRegistrations.map((registration) => registration.teamId),
    );
    const removedSlots = removedRegistrations
      .map((registration) => registration.slotNumber)
      .filter((slotNumber): slotNumber is number => slotNumber !== null)
      .sort((left, right) => left - right);
    const removedWaitlistPositions = removedRegistrations
      .map((registration) => registration.waitlistPosition)
      .filter((position): position is number => position !== null)
      .sort((left, right) => left - right);

    this.syncDiscordScrimStateInBackground(guild, session.id, {
      organizationId: config.organizationId,
      removedTeamIds,
      extraDiscordUserIds:
        this.registrationRoleSyncDiscordUserIds(removedRegistrations),
      cleanupTeamIds: removedTeamIds,
      fastMessageRefresh: true,
      skipFullSync: true,
      delayMs: 0,
    });
    this.reconcileScrimRolesInBackground(guild, session.id);

    await this.logScheduledRegistrationDataCleanup(guild, session, config, {
      title: "Scheduled registered team cleanup completed.",
      schedule,
      selected: registrations.length,
      removed: removedRegistrations.length,
      failed,
      removedSlots,
      removedWaitlistPositions,
      note: [
        "Assigned slots and waitlist entries were removed.",
        resultResetFailed
          ? "Result system reset failed; old match data may still exist."
          : this.formatResultResetNote(resultReset),
        "Teams, logos, and channel history were kept.",
      ].join(" "),
    });
    console.log(
      `[DiscordCleanup] scheduled registered teams session=${session.id} selected=${registrations.length} removed=${removedRegistrations.length} failed=${failed}`,
    );
  }

  private async cleanScheduledScrimRoles(
    guild: Guild,
    session: SessionResponse,
    config: SessionDiscordConfigResponse,
    schedule: AutoCleanupSchedule,
  ) {
    const mode: ScrimRoleCleanupMode =
      schedule.mode === "all" ? "strip" : "reconcile";
    const result = await this.runScrimRoleCleanup(
      guild,
      session,
      config,
      mode,
      {
        fetchAllGuildMembers: true,
      },
    );
    await this.logScheduledScrimRoleCleanup(guild, session, config, result);
    console.log(
      `[DiscordCleanup] scheduled roles session=${session.id} mode=${mode} known=${result.knownMembers} cached=${result.cachedRoleMembers} added=${result.added} removed=${result.removed} failed=${result.failed}`,
    );
  }

  private async logScheduledScrimRoleCleanup(
    guild: Guild,
    session: SessionResponse,
    config: SessionDiscordConfigResponse,
    result: ScrimRoleCleanupResult,
  ) {
    const logChannelId = config.logChannelId;
    if (!logChannelId) {
      return;
    }

    const logChannel = await this.fetchAutoCleanupChannel(
      guild,
      logChannelId,
    ).catch(() => null);
    if (!logChannel) {
      return;
    }

    await logChannel
      .send({
        content: [
          "Scheduled scrim role cleanup completed.",
          `Session: ${session.name}`,
          `Mode: ${result.mode}`,
          `Known Members: ${result.knownMembers}`,
          `Cached Role Members: ${result.cachedRoleMembers}`,
          `Roles Added: ${result.added}`,
          `Roles Removed: ${result.removed}`,
          `Failed: ${result.failed}`,
        ].join("\n"),
        allowedMentions: { parse: [] },
      })
      .catch(() => undefined);
  }

  private async logScheduledFullSessionCleanup(
    guild: Guild,
    session: SessionResponse,
    config: SessionDiscordConfigResponse,
    schedule: AutoCleanupSchedule,
    channelResults: Array<{
      channel: GuildTextBasedChannel;
      label: string;
      selected: number;
      deleted: number;
      failed: number;
    }>,
    roleResult: ScrimRoleCleanupResult | null,
  ) {
    const logChannelId = config.logChannelId;
    if (!logChannelId) {
      return;
    }

    const logChannel = await this.fetchAutoCleanupChannel(
      guild,
      logChannelId,
    ).catch(() => null);
    if (!logChannel) {
      return;
    }

    const selected = channelResults.reduce(
      (total, result) => total + result.selected,
      0,
    );
    const deleted = channelResults.reduce(
      (total, result) => total + result.deleted,
      0,
    );
    const failed = channelResults.reduce(
      (total, result) => total + result.failed,
      0,
    );
    const channelSummary = channelResults
      .map(
        (result) =>
          `- ${result.label}: ${result.deleted}/${result.selected} deleted, ${result.failed} failed`,
      )
      .slice(0, 12);

    await logChannel
      .send({
        content: [
          "Scheduled full channel cleanup completed.",
          `Session: ${session.name}`,
          `Mode: ${schedule.mode}`,
          `Channels: ${channelResults.length}`,
          `Messages Selected: ${selected}`,
          `Messages Deleted: ${deleted}`,
          `Message Failures: ${failed}`,
          roleResult
            ? `Roles Removed: ${roleResult.removed}, Added: ${roleResult.added}, Failed: ${roleResult.failed}`
            : "Roles: skipped or failed",
          ...channelSummary,
        ].join("\n"),
        allowedMentions: { parse: [] },
      })
      .catch(() => undefined);
  }

  private async logScheduledRegistrationDataCleanup(
    guild: Guild,
    session: SessionResponse,
    config: SessionDiscordConfigResponse,
    params: {
      title: string;
      schedule: AutoCleanupSchedule;
      selected: number;
      removed: number;
      failed: number;
      removedSlots: number[];
      removedWaitlistPositions: number[];
      note: string;
    },
  ) {
    const logChannelId = config.logChannelId;
    if (!logChannelId) {
      return;
    }

    const logChannel = await this.fetchAutoCleanupChannel(
      guild,
      logChannelId,
    ).catch(() => null);
    if (!logChannel) {
      return;
    }

    const slotSummary =
      params.removedSlots.length === 0
        ? "none"
        : params.removedSlots.length <= 20
          ? params.removedSlots.map((slot) => `#${slot}`).join(", ")
          : `${params.removedSlots.length} slots`;
    const waitlistSummary =
      params.removedWaitlistPositions.length === 0
        ? "none"
        : params.removedWaitlistPositions.length <= 20
          ? params.removedWaitlistPositions
              .map((position) => `#${position}`)
              .join(", ")
          : `${params.removedWaitlistPositions.length} waitlist entries`;

    await logChannel
      .send({
        content: [
          params.title,
          `Session: ${session.name}`,
          `Type: ${this.autoCleanupChannelLabel(params.schedule.channel)}`,
          `Time: ${params.schedule.time}`,
          `Selected: ${params.selected}`,
          `Removed: ${params.removed}`,
          `Failed: ${params.failed}`,
          `Slots: ${slotSummary}`,
          `Waitlist: ${waitlistSummary}`,
          params.note,
        ].join("\n"),
        allowedMentions: { parse: [] },
      })
      .catch(() => undefined);
  }

  private async logScheduledDiscordCleanup(
    guild: Guild,
    session: SessionResponse,
    config: SessionDiscordConfigResponse,
    channel: GuildTextBasedChannel,
    schedule: AutoCleanupSchedule,
    selected: number,
    result: { deleted: number; failed: number },
  ) {
    const logChannelId = config.logChannelId;
    if (!logChannelId || logChannelId === channel.id) {
      return;
    }

    const logChannel = await this.fetchAutoCleanupChannel(
      guild,
      logChannelId,
    ).catch(() => null);
    if (!logChannel) {
      return;
    }

    await logChannel
      .send({
        content: [
          "Scheduled channel cleanup completed.",
          `Session: ${session.name}`,
          `Channel: <#${channel.id}>`,
          `Type: ${this.autoCleanupChannelLabel(schedule.channel)}`,
          `Mode: ${schedule.mode}`,
          `Limit: ${schedule.limit}`,
          `Selected: ${selected}`,
          `Deleted: ${result.deleted}`,
          `Failed: ${result.failed}`,
        ].join("\n"),
        allowedMentions: { parse: [] },
      })
      .catch(() => undefined);
  }

  private setupFromConfig(
    config: SessionDiscordConfigResponse | null,
  ): ScrimDiscordSetup | null {
    if (
      !config?.categoryId ||
      !config.registrationChannelId ||
      !config.slotListChannelId ||
      !config.waitlistChannelId
    ) {
      return null;
    }

    const slotRoleId = config.slotRoleId ?? config.idpRoleId ?? "";
    const slotRoleName = config.slotRoleName ?? config.idpRoleName ?? "";
    const legacyIdpRoleId =
      config.idpRoleId && config.idpRoleId !== slotRoleId
        ? config.idpRoleId
        : undefined;
    const legacyIdpRoleName =
      legacyIdpRoleId && config.idpRoleName ? config.idpRoleName : undefined;

    return {
      categoryId: config.categoryId,
      categoryName: config.categoryName ?? "",
      registrationChannelId: config.registrationChannelId,
      registrationChannelName: config.registrationChannelName ?? "",
      slotListChannelId: config.slotListChannelId,
      slotListChannelName: config.slotListChannelName ?? "",
      waitlistChannelId: config.waitlistChannelId,
      waitlistChannelName: config.waitlistChannelName ?? "",
      idpChannelId: config.idpChannelId ?? "",
      idpChannelName: config.idpChannelName ?? "",
      managerChannelId: config.managerChannelId ?? "",
      managerChannelName: config.managerChannelName ?? "",
      transferChannelId: config.transferChannelId ?? "",
      transferChannelName: config.transferChannelName ?? "",
      manageChannelId: config.manageChannelId ?? "",
      manageChannelName: config.manageChannelName ?? "",
      resultsChannelId: config.resultsChannelId ?? "",
      resultsChannelName: config.resultsChannelName ?? "",
      screenshotsChannelId: config.screenshotsChannelId ?? "",
      screenshotsChannelName: config.screenshotsChannelName ?? "",
      bansChannelId: config.bansChannelId ?? "",
      bansChannelName: config.bansChannelName ?? "",
      logChannelId: config.logChannelId ?? "",
      logChannelName: config.logChannelName ?? "",
      slotRoleId,
      slotRoleName,
      staffRoleId: config.emojis.staffRoleId ?? "",
      staffRoleName: config.emojis.staffRoleName ?? "Arenzyra Staff",
      waitlistRoleId: config.waitlistRoleId ?? "",
      waitlistRoleName: config.waitlistRoleName ?? "",
      idpRoleId: slotRoleId,
      idpRoleName: slotRoleName,
      legacyIdpRoleId,
      legacyIdpRoleName,
      bannedRoleId: config.bannedRoleId ?? "",
      bannedRoleName: config.bannedRoleName ?? "",
    };
  }

  private async syncDiscordScrimMessages(guild: Guild, sessionId: string) {
    const startedAt = Date.now();
    console.log(
      `[DiscordSync] message refresh start session=${sessionId} guild=${guild.id}`,
    );
    let [session, registrations, config] = await Promise.all([
      this.apiClient.getSession(sessionId),
      this.apiClient.listRegistrations(sessionId),
      this.apiClient.getSessionDiscordConfig(sessionId),
    ]);
    ({ session, config } =
      await this.applyDueWeeklyWaitlistPromotionScheduleTransition(
        session,
        config,
      ));
    let setup = this.setupFromConfig(config);
    if (!setup) {
      console.warn(
        `[DiscordSync] message refresh skipped session=${sessionId}: saved Discord setup is incomplete`,
      );
      return;
    }

    try {
      const ensuredSetup = await this.scrimDiscordSetup.ensureSetup(
        guild,
        session,
        config,
      );
      config = await this.persistDiscordSetupConfig(
        session.id,
        ensuredSetup,
        guild.id,
        config,
      );
      setup = ensuredSetup;
    } catch (error) {
      console.warn(
        `[DiscordSync] setup repair skipped session=${sessionId}: ${String(error)}`,
      );
    }

    const memberCache = await this.loadTeamMembersForSync(
      registrations
        .filter((registration) => this.activeRegistrationStatus(registration))
        .map((registration) => registration.teamId),
    );
    const managerMentionByTeamId = await this.managerMentionByTeamIdForGuild(
      guild,
      registrations,
      memberCache,
    );
    const messageIds = await this.scrimDiscordSetup.syncMessages(
      guild,
      setup,
      session,
      registrations,
      config,
      { managerMentionByTeamId },
    );
    config = await this.persistManagedMessageIds(
      session.id,
      config,
      messageIds,
    );
    this.scheduleCopiedEventSourceImportRefresh(session.id, config);
    this.scheduleConfirmationWindowSync(guild, session.id, config);
    this.scheduleRegistrationWindowSync(guild, session, config);
    this.scheduleWaitlistPromotionWindowSync(guild, session, config);
    this.logTiming(`message refresh done session=${sessionId}`, startedAt);
  }

  private async syncVisibleDiscordMessagesFast(
    guild: Guild,
    sessionId: string,
  ) {
    const startedAt = Date.now();
    try {
      let [session, registrations, config] = await Promise.all([
        this.apiClient.getSession(sessionId),
        this.apiClient.listRegistrations(sessionId),
        this.apiClient.getSessionDiscordConfig(sessionId),
      ]);
      ({ session, config } =
        await this.applyDueWeeklyWaitlistPromotionScheduleTransition(
          session,
          config,
        ));
      let setup = this.setupFromConfig(config);
      if (!setup) {
        setup = await this.scrimDiscordSetup
          .ensureSetup(guild, session, config)
          .catch((error) => {
            console.warn(
              `[DiscordSync] fast setup repair failed session=${sessionId}: ${String(error)}`,
            );
            return null;
          });
        if (!setup) {
          console.warn(
            `[DiscordSync] fast visible refresh skipped session=${sessionId}: saved Discord setup is incomplete`,
          );
          return false;
        }
        config = await this.persistDiscordSetupConfig(
          session.id,
          setup,
          guild.id,
          config,
        );
      }

      const memberCache = await this.loadTeamMembersForSync(
        registrations
          .filter((registration) => this.activeRegistrationStatus(registration))
          .map((registration) => registration.teamId),
      );
      const managerMentionByTeamId = await this.managerMentionByTeamIdForGuild(
        guild,
        registrations,
        memberCache,
      );
      let messageIds: ScrimDiscordManagedMessageIds;
      try {
        messageIds =
          await this.scrimDiscordSetup.syncSlotListAndWaitlistMessages(
            guild,
            setup,
            session,
            registrations,
            config,
            { managerMentionByTeamId },
          );
      } catch (error) {
        console.warn(
          `[DiscordSync] fast visible refresh could not update all messages session=${sessionId}: ${String(error)}. Trying slot-list-only refresh.`,
        );
        const slotListMessage =
          await this.scrimDiscordSetup.syncSlotListMessage(
            guild,
            setup,
            session,
            registrations,
            config,
            { managerMentionByTeamId },
          );
        await this.persistManagedMessageIds(session.id, config, {
          managedSlotListMessageId: slotListMessage.id,
        });
        this.scheduleCopiedEventSourceImportRefresh(session.id, config);
        return false;
      }
      config = await this.persistManagedMessageIds(
        session.id,
        config,
        messageIds,
      );
      this.scheduleCopiedEventSourceImportRefresh(session.id, config);
      this.scheduleConfirmationWindowSync(guild, session.id, config);
      this.scheduleRegistrationWindowSync(guild, session, config);
      this.scheduleWaitlistPromotionWindowSync(guild, session, config);
      this.logTiming(
        `fast visible refresh done session=${sessionId}`,
        startedAt,
      );
      return true;
    } catch (error) {
      console.warn(
        `[DiscordSync] fast visible refresh failed session=${sessionId}: ${String(
          error,
        )}`,
      );
      return false;
    }
  }

  private async syncAffectedTeamAccessRoles(
    guild: Guild,
    sessionId: string,
    opts: {
      removedTeamIds?: string[];
      activeTeamIds?: string[];
      extraDiscordUserIds?: string[];
    },
  ) {
    const startedAt = Date.now();
    try {
      const [registrations, config] = await Promise.all([
        this.apiClient.listRegistrations(sessionId),
        this.apiClient.getSessionDiscordConfig(sessionId),
      ]);
      const setup = this.setupFromConfig(config);
      if (!setup) {
        console.warn(
          `[DiscordSync] affected role sync skipped session=${sessionId}: saved Discord setup is incomplete`,
        );
        return false;
      }

      const affectedTeamIds = [
        ...new Set([
          ...(opts.removedTeamIds ?? []).filter(Boolean),
          ...(opts.activeTeamIds ?? []).filter(Boolean),
        ]),
      ];
      const activeRegistrationByTeamId =
        this.activeRegistrationByTeam(registrations);
      const roleTeamIds = this.uniqueStrings([
        ...affectedTeamIds,
        ...activeRegistrationByTeamId.keys(),
      ]);
      const memberCache = await this.loadTeamMembersForSync(roleTeamIds);

      await this.reconcileTeamSetAccessRoles(
        guild,
        setup,
        affectedTeamIds,
        registrations,
        activeRegistrationByTeamId,
        memberCache,
        opts.extraDiscordUserIds ?? [],
      );

      this.logTiming(`affected role sync done session=${sessionId}`, startedAt);
      return true;
    } catch (error) {
      console.warn(
        `[DiscordSync] affected role sync failed session=${sessionId}: ${String(
          error,
        )}`,
      );
      return false;
    }
  }

  private async syncSessionRegistrationAccessRolesNow(
    guild: Guild | null | undefined,
    sessionId: string,
    registration: SessionRegistrationResponse | null,
    reasonLabel: string,
  ) {
    if (!guild || !registration) {
      return false;
    }
    const activeRoleTeamIds = this.registrationAccessRoleTeamIds([
      registration,
    ]);
    if (!activeRoleTeamIds.has(registration.teamId)) {
      return false;
    }
    const synced = await this.syncAffectedTeamAccessRoles(guild, sessionId, {
      activeTeamIds: [registration.teamId],
    });
    if (!synced) {
      console.warn(
        `[DiscordSync] ${reasonLabel} role sync did not complete session=${sessionId} registration=${registration.id}`,
      );
    }
    return synced;
  }

  private async syncSlotListMessageFast(
    guild: Guild | null | undefined,
    session: SessionResponse,
    registrations: SessionRegistrationResponse[],
    config: SessionDiscordConfigResponse | null,
  ) {
    if (!guild || !config) {
      return false;
    }

    const setup = this.setupFromConfig(config);
    if (!setup) {
      return false;
    }

    const startedAt = Date.now();
    try {
      const memberCache = await this.loadTeamMembersForSync(
        registrations
          .filter((registration) => this.activeRegistrationStatus(registration))
          .map((registration) => registration.teamId),
      );
      const managerMentionByTeamId = await this.managerMentionByTeamIdForGuild(
        guild,
        registrations,
        memberCache,
      );
      const message = await this.scrimDiscordSetup.syncSlotListMessage(
        guild,
        setup,
        session,
        registrations,
        config,
        { managerMentionByTeamId },
      );
      await this.persistManagedMessageIds(session.id, config, {
        managedSlotListMessageId: message.id,
      });
      this.scheduleCopiedEventSourceImportRefresh(session.id, config);
      this.logTiming(`fast slot-list refresh session=${session.id}`, startedAt);
      return true;
    } catch (error) {
      console.warn(
        `Fast slot-list refresh failed for ${session.id}: ${String(error)}`,
      );
      return false;
    }
  }

  private async resolveGuildOrganizationId(guild: Guild) {
    return this.resolveOrganizationIdForGuild(guild.id);
  }

  private async listRegistrationRefreshCandidates(
    client: Client,
  ): Promise<RegistrationRefreshCandidate[]> {
    const guilds = [...client.guilds.cache.values()];
    const sessionsByOrganization = new Map<string, SessionResponse[]>();
    const candidates: RegistrationRefreshCandidate[] = [];

    for (const guild of guilds) {
      const organizationId = await this.resolveGuildOrganizationId(guild);
      if (!organizationId) {
        continue;
      }

      let sessions = sessionsByOrganization.get(organizationId);
      if (!sessions) {
        sessions = await this.withOrganization(organizationId, () =>
          this.apiClient.listSessions(),
        ).catch((error) => {
          console.warn(
            `Failed to refresh Discord session timers for organization=${organizationId}: ${String(
              error,
            )}`,
          );
          return [];
        });
        sessionsByOrganization.set(organizationId, sessions);
      }

      for (const session of sessions) {
        candidates.push({ session, guild, organizationId });
      }
    }

    if (candidates.length > 0 || guilds.length > 0) {
      return candidates;
    }

    const sessions = await this.apiClient.listSessions().catch((error) => {
      console.warn(
        `Failed to refresh confirmation window timers: ${String(error)}`,
      );
      return [];
    });
    return sessions.map((session) => ({
      session,
      guild: null,
      organizationId: null,
    }));
  }

  startConfirmationWindowRefresh(client: Client) {
    const refresh = () => {
      void this.refreshConfirmationWindowSyncs(client).catch((error) => {
        console.warn(`Confirmation window refresh failed: ${String(error)}`);
      });
    };

    refresh();
    const timer = setInterval(() => {
      refresh();
    }, CONFIRMATION_WINDOW_REFRESH_INTERVAL_MS);
    timer.unref?.();
  }

  startActiveDiscordSessionReconciler(client: Client) {
    if (this.activeDiscordSessionReconcileTimer) {
      return;
    }

    const run = (forceFull = false) => {
      void this.reconcileActiveDiscordSessions(client, forceFull).catch(
        (error) => {
          console.warn(
            `[DiscordSync] active session reconcile failed: ${String(error)}`,
          );
        },
      );
    };

    const startupTimer = setTimeout(() => {
      run(true);
    }, ACTIVE_DISCORD_RECONCILE_INITIAL_DELAY_MS);
    startupTimer.unref?.();

    this.activeDiscordSessionReconcileTimer = setInterval(() => {
      run(false);
    }, ACTIVE_DISCORD_RECONCILE_INTERVAL_MS);
    this.activeDiscordSessionReconcileTimer.unref?.();
  }

  startExpiredBanRoleCleanup(client: Client) {
    if (this.expiredBanRoleCleanupTimer) {
      return;
    }

    const run = () => {
      void this.cleanupExpiredBanRoles(client).catch((error) => {
        console.warn(
          `[DiscordBanCleanup] expired ban role cleanup failed: ${String(
            error,
          )}`,
        );
      });
    };

    const startupTimer = setTimeout(
      run,
      EXPIRED_BAN_ROLE_CLEANUP_INITIAL_DELAY_MS,
    );
    startupTimer.unref?.();

    this.expiredBanRoleCleanupTimer = setInterval(
      run,
      EXPIRED_BAN_ROLE_CLEANUP_INTERVAL_MS,
    );
    this.expiredBanRoleCleanupTimer.unref?.();
  }

  private async cleanupExpiredBanRoles(client: Client) {
    if (this.expiredBanRoleCleanupRunning) {
      return;
    }

    this.expiredBanRoleCleanupRunning = true;
    try {
      const candidates = await this.listRegistrationRefreshCandidates(client);
      const seen = new Set<string>();
      const total: ExpiredBanRoleCleanupResult = {
        expiredManagerBans: 0,
        checkedMembers: 0,
        removedRoles: 0,
        keptActive: 0,
        missingMembers: 0,
        failed: 0,
      };
      let touchedSessions = 0;

      for (const candidate of candidates) {
        const key = `${candidate.organizationId ?? ""}:${candidate.session.id}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);

        try {
          await this.withOrganization(candidate.organizationId, async () => {
            const config = await this.apiClient
              .getSessionDiscordConfig(candidate.session.id)
              .catch(() => null);
            if (
              !config ||
              config.enabled === false ||
              !config.guildId ||
              !this.setupFromConfig(config)
            ) {
              return;
            }

            const guild =
              candidate.guild && candidate.guild.id === config.guildId
                ? candidate.guild
                : await client.guilds.fetch(config.guildId).catch(() => null);
            if (!guild) {
              return;
            }

            const result = await this.cleanupExpiredBanRolesForSession(
              guild,
              candidate.session,
              config,
            );
            if (
              result.expiredManagerBans ||
              result.removedRoles ||
              result.failed
            ) {
              touchedSessions += 1;
              total.expiredManagerBans += result.expiredManagerBans;
              total.checkedMembers += result.checkedMembers;
              total.removedRoles += result.removedRoles;
              total.keptActive += result.keptActive;
              total.missingMembers += result.missingMembers;
              total.failed += result.failed;
            }
          });
        } catch (error) {
          console.warn(
            `[DiscordBanCleanup] skipped session=${
              candidate.session.id
            } organization=${candidate.organizationId ?? "default"}: ${String(
              error,
            )}`,
          );
        }
      }

      if (
        total.expiredManagerBans ||
        total.removedRoles ||
        total.failed ||
        total.missingMembers
      ) {
        console.log(
          `[DiscordBanCleanup] sessions=${touchedSessions} expired=${total.expiredManagerBans} checked=${total.checkedMembers} removed=${total.removedRoles} kept=${total.keptActive} missing=${total.missingMembers} failed=${total.failed}`,
        );
      }
    } finally {
      this.expiredBanRoleCleanupRunning = false;
    }
  }

  private async cleanupExpiredBanRolesForSession(
    guild: Guild,
    session: SessionResponse,
    config: SessionDiscordConfigResponse,
  ): Promise<ExpiredBanRoleCleanupResult> {
    const result: ExpiredBanRoleCleanupResult = {
      expiredManagerBans: 0,
      checkedMembers: 0,
      removedRoles: 0,
      keptActive: 0,
      missingMembers: 0,
      failed: 0,
    };

    const roles = await this.configuredAllBanRoles(guild, config);
    if (!roles.length) {
      return result;
    }

    const [inactiveBans, matches] = await Promise.all([
      this.apiClient.listManagerBans({ active: false }).catch(() => []),
      this.apiClient
        .listSessionMatches(session.id)
        .catch(() => [] as SessionMatchResponse[]),
    ]);
    const matchIds = new Set(matches.map((match) => match.id));
    const relevantUserIds = this.uniqueStrings(
      inactiveBans
        .filter(
          (ban) =>
            this.inactiveManagerBanNeedsCleanup(ban) &&
            this.managerBanAppliesToSession(ban, session.id, matchIds),
        )
        .map((ban) => ban.discordUserId),
    );

    result.expiredManagerBans = relevantUserIds.length;
    if (!relevantUserIds.length) {
      return result;
    }

    await this.runLimited(
      relevantUserIds,
      ROLE_SYNC_CONCURRENCY,
      async (discordUserId) => {
        result.checkedMembers += 1;
        if (
          await this.memberHasActiveRelevantManagerBan(
            discordUserId,
            session.id,
            matchIds,
          )
        ) {
          result.keptActive += 1;
          return;
        }

        try {
          const removed = await this.removeConfiguredBanRolesFromMember(
            guild,
            config,
            discordUserId,
            `Arenzyra expired ban role cleanup ${session.id}`,
          );
          result.removedRoles += removed.removed;
          if (removed.missing) {
            result.missingMembers += 1;
          }
        } catch {
          result.failed += 1;
        }
      },
    );

    await this.refreshDiscordBanListMessage(guild, config, session.id);
    if (result.removedRoles > 0 || result.failed > 0) {
      await this.sendDiscordActionLog(
        guild,
        { ...config, bansChannelId: null },
        {
          action: "Expired manager ban roles cleaned",
          sessionId: session.id,
          sessionName: session.name,
          status: `${result.removedRoles} role(s) removed`,
          details: [
            `Expired/revoked managers checked: ${result.checkedMembers}`,
            `Kept because another active ban exists: ${result.keptActive}`,
            `Managers no longer in server: ${result.missingMembers}`,
            `Failures: ${result.failed}`,
          ],
          color: result.failed > 0 ? 0xf59e0b : 0x22c55e,
        },
      ).catch((error) => {
        console.warn(
          `[DiscordBanCleanup] action log failed session=${session.id}: ${String(
            error,
          )}`,
        );
      });
    }
    return result;
  }

  private shouldReconcileActiveDiscordSession(session: SessionResponse) {
    return (
      session.type === "SCRIM" &&
      !["ENDED", "ARCHIVED"].includes(session.status)
    );
  }

  private async reconcileActiveDiscordSessions(
    client: Client,
    forceFull = false,
  ) {
    if (this.activeDiscordSessionReconcileRunning) {
      return;
    }

    this.activeDiscordSessionReconcileRunning = true;
    try {
      const now = Date.now();
      const runFull =
        forceFull ||
        now - this.activeDiscordSessionLastFullSyncAt >=
          ACTIVE_DISCORD_RECONCILE_FULL_INTERVAL_MS;
      if (runFull) {
        this.activeDiscordSessionLastFullSyncAt = now;
      }

      const candidates = await this.listRegistrationRefreshCandidates(client);
      const seen = new Set<string>();
      let refreshed = 0;
      for (const candidate of candidates) {
        const candidateKey = `${candidate.organizationId ?? ""}:${
          candidate.session.id
        }`;
        if (
          seen.has(candidateKey) ||
          !this.shouldReconcileActiveDiscordSession(candidate.session)
        ) {
          continue;
        }
        seen.add(candidateKey);

        try {
          await this.withOrganization(candidate.organizationId, async () => {
            const config = await this.apiClient
              .getSessionDiscordConfig(candidate.session.id)
              .catch(() => null);
            if (
              !config ||
              config.enabled === false ||
              !config.guildId ||
              !this.setupFromConfig(config)
            ) {
              return;
            }

            const guild =
              candidate.guild && candidate.guild.id === config.guildId
                ? candidate.guild
                : await client.guilds.fetch(config.guildId).catch(() => null);
            if (!guild) {
              return;
            }

            if (runFull) {
              await this.syncRegistrationWindowState(
                guild,
                candidate.session.id,
                candidate.session,
                config,
                {
                  announceTransition: true,
                  announceOnlyWhenStoredStateChanges: true,
                  applyWeeklyScheduleTransition: true,
                },
              );
            }

            const updated = await this.syncVisibleDiscordMessagesFast(
              guild,
              candidate.session.id,
            );
            if (updated) {
              refreshed += 1;
            }
          });
        } catch (error) {
          console.warn(
            `[DiscordSync] active session reconcile skipped session=${
              candidate.session.id
            } organization=${candidate.organizationId ?? "default"}: ${String(
              error,
            )}`,
          );
        }
      }

      if (refreshed > 0) {
        console.log(
          `[DiscordSync] active session reconcile ${
            runFull ? "full" : "fast"
          } refreshed=${refreshed}`,
        );
      }
    } finally {
      this.activeDiscordSessionReconcileRunning = false;
    }
  }

  async refreshConfirmationWindowSyncs(client: Client) {
    const candidates = (
      await this.listRegistrationRefreshCandidates(client)
    ).filter(({ session }) =>
      ["DRAFT", "OPEN", "CHECKIN", "LOCKED", "LIVE", "ENDED"].includes(
        session.status,
      ),
    );

    for (const candidate of candidates) {
      try {
        await this.withOrganization(candidate.organizationId, async () => {
          const session = candidate.session;
          const config = await this.apiClient
            .getSessionDiscordConfig(session.id)
            .catch(() => null);
          if (config?.enabled === false || !config?.guildId) {
            return;
          }

          const guild =
            candidate.guild && candidate.guild.id === config.guildId
              ? candidate.guild
              : await client.guilds.fetch(config.guildId).catch(() => null);
          if (!guild) {
            return;
          }

          let currentSession = session;
          let currentConfig = config;
          ({ session: currentSession, config: currentConfig } =
            await this.applyDueWeeklyRegistrationScheduleTransition(
              currentSession,
              currentConfig,
            ));
          ({ session: currentSession, config: currentConfig } =
            await this.applyDueWeeklyWaitlistPromotionScheduleTransition(
              currentSession,
              currentConfig,
            ));

          await this.runDueAutoCleanups(guild, currentSession, currentConfig);
          if (currentSession.status !== "ENDED") {
            await this.syncAccessWindowAnnouncements(
              guild,
              currentSession,
              currentConfig,
            );
            currentConfig = await this.runDueAutoRegistration(
              guild,
              currentSession,
              currentConfig,
            );
          }
          if (
            currentSession.type !== "SCRIM" ||
            currentSession.status === "ENDED"
          ) {
            return;
          }
          await this.runDueConfirmationReminders(
            guild,
            currentSession,
            currentConfig,
          );
          currentConfig = await this.applyDueConfirmationCloseCleanup(
            guild,
            currentSession,
            currentConfig,
          );
          this.scheduleRegistrationWindowSync(
            guild,
            currentSession,
            currentConfig,
          );
          const registrationKey = this.syncQueueKey(guild, currentSession.id);
          const registrationSignature = this.registrationWindowSignature(
            currentSession,
            currentConfig,
          );
          if (
            this.registrationWindowSignatures.get(registrationKey) !==
            registrationSignature
          ) {
            this.registrationWindowSignatures.set(
              registrationKey,
              registrationSignature,
            );
            console.log(
              `[DiscordSync] registration window refresh queued session=${currentSession.id} state=${
                this.publicRegistrationWindow(currentSession, currentConfig)
                  .state
              }`,
            );
            this.syncRegistrationWindowStateInBackground(
              guild,
              currentSession.id,
              {
                announceTransition: true,
                announceOnlyWhenStoredStateChanges: true,
              },
            );
          }

          const window = playConfirmationWindow(currentConfig);
          if (!window.configured) {
            return;
          }

          this.scheduleConfirmationWindowSync(
            guild,
            currentSession.id,
            currentConfig,
          );
          const key = this.syncQueueKey(guild, currentSession.id);
          const signature = this.confirmationWindowSignature(
            currentConfig,
            window,
          );
          if (this.confirmationWindowSignatures.get(key) === signature) {
            return;
          }

          this.confirmationWindowSignatures.set(key, signature);
          console.log(
            `[DiscordSync] confirmation window refresh queued session=${currentSession.id} state=${window.state}`,
          );
          this.syncDiscordScrimMessagesInBackground(guild, currentSession.id);
        });
      } catch (error) {
        console.warn(
          `[DiscordSync] confirmation window refresh skipped session=${
            candidate.session.id
          } organization=${candidate.organizationId ?? "default"}: ${String(
            error,
          )}`,
        );
      }
    }
  }

  private confirmationWindowSignature(
    config: SessionDiscordConfigResponse,
    window: ReturnType<typeof playConfirmationWindow>,
  ) {
    const emojis = config.emojis ?? {};
    return [
      window.mode,
      window.state,
      window.opensAt?.getTime() ?? "",
      window.closesAt?.getTime() ?? "",
      window.waitlistStartsAt?.getTime() ?? "",
      config.guildId ?? "",
      config.registrationChannelId ?? "",
      config.slotListChannelId ?? "",
      config.waitlistChannelId ?? "",
      emojis.playControlMode ?? "",
      emojis.playButtonsEnabled ?? "",
      emojis.playConfirmEmoji ?? "",
      emojis.playNotPlayingEmoji ?? "",
      emojis.playConfirmLabel ?? "",
      emojis.playNotPlayingLabel ?? "",
      emojis.playConfirmationMessageEnabled ?? "",
      emojis.playConfirmationWeeklySchedule ?? "",
      emojis.playConfirmationOpenTime ?? "",
      emojis.playConfirmationCloseTime ?? "",
      emojis.playConfirmationWaitlistStartTime ?? "",
      emojis.playConfirmationTimeZone ?? "",
      emojis.playConfirmationCleanupEnabled ?? "",
      emojis.playConfirmationCleanupBanEnabled ?? "",
      emojis.playConfirmationCleanupLastClosedAt ?? "",
      emojis.playConfirmationWaitlistGraceMinutes ?? "",
      emojis.playConfirmationWaitlistGraceStartedAt ?? "",
      emojis.playConfirmationWaitlistGraceUntil ?? "",
      emojis.waitlistPromotionWeeklySchedule ?? "",
      emojis.waitlistPromotionTimeZone ?? "",
      emojis.waitlistPromotionManualState ?? "",
      emojis.waitlistPromotionAutoOpenUntil ?? "",
      emojis.waitlistPromotionScheduleOverrideState ?? "",
      emojis.waitlistPromotionScheduleOverrideUpdatedAt ?? "",
    ].join("|");
  }

  private registrationWindowSignature(
    session: SessionResponse,
    config: SessionDiscordConfigResponse,
  ) {
    const window = this.publicRegistrationWindow(session, config);
    const emojis = config.emojis ?? {};
    return [
      window.state,
      window.allowsAction ? "open" : "closed",
      window.opensAt?.getTime() ?? "",
      window.closesAt?.getTime() ?? "",
      session.status,
      session.registrationOpenAt ?? "",
      session.registrationCloseAt ?? "",
      config.guildId ?? "",
      config.registrationChannelId ?? "",
      config.registrationChannelName ?? "",
      emojis.registrationWeeklySchedule ?? "",
      emojis.registrationTimeZone ?? "",
      emojis.registrationMessageEnabled ?? "",
      emojis.registrationMessageTitle ?? "",
      emojis.registrationMessageText ?? "",
    ].join("|");
  }

  async postRegistrationManagePanel(
    guild: Guild,
    sessionId: string,
    registration: SessionRegistrationResponse,
  ): Promise<void> {
    const [session, config] = await Promise.all([
      this.apiClient.getSession(sessionId),
      this.apiClient.getSessionDiscordConfig(sessionId),
    ]);
    const setup = await this.scrimDiscordSetup.ensureSetup(
      guild,
      session,
      config,
    );
    await this.persistDiscordSetupConfig(session.id, setup, guild.id, config);
    await this.scrimDiscordSetup.sendRegistrationManagePanel(
      guild,
      setup,
      session,
      registration,
      config,
    );
  }

  private async syncRegistrationAccessRoles(
    guild: Guild,
    setup: ScrimDiscordSetup,
    registrations: SessionRegistrationResponse[],
    memberCache: Map<string, TeamMemberSummary[]>,
  ) {
    const activeRegistrationByTeamId =
      this.activeRegistrationByTeam(registrations);
    await this.reconcileTeamSetAccessRoles(
      guild,
      setup,
      [...activeRegistrationByTeamId.keys()],
      registrations,
      activeRegistrationByTeamId,
      memberCache,
    );
  }

  private activeTeamMemberDiscordUserIds(members: TeamMemberSummary[]) {
    return this.uniqueStrings(
      members
        .filter((member) => this.isActiveMember(member))
        .map((member) => member.discordUserId),
    );
  }

  private accessRoleManagerDiscordUserIds(
    registration: SessionRegistrationResponse | null,
    members: TeamMemberSummary[],
  ) {
    const snapshotDiscordUserIds = registration
      ? this.managerSnapshotDiscordUserIds(registration)
      : [];
    if (snapshotDiscordUserIds.length) {
      return snapshotDiscordUserIds;
    }
    return this.uniqueStrings(
      members
        .filter((member) => this.isActiveLeaderMember(member))
        .map((member) => member.discordUserId),
    );
  }

  private registrationByTeamId(registrations: SessionRegistrationResponse[]) {
    const byTeamId = new Map<string, SessionRegistrationResponse>();
    for (const registration of registrations) {
      byTeamId.set(registration.teamId, registration);
    }
    return byTeamId;
  }

  private addDesiredAccessRoles(
    desiredRolesByDiscordUserId: Map<string, string[]>,
    discordUserId: string | null | undefined,
    roleIds: string[],
  ) {
    const cleanDiscordUserId = discordUserId?.trim();
    if (!cleanDiscordUserId || roleIds.length === 0) {
      return;
    }
    const existing = desiredRolesByDiscordUserId.get(cleanDiscordUserId) ?? [];
    desiredRolesByDiscordUserId.set(
      cleanDiscordUserId,
      this.uniqueRoleIds([...existing, ...roleIds]),
    );
  }

  private desiredAccessRolesByDiscordUser(
    activeRegistrations: SessionRegistrationResponse[],
    setup: ScrimDiscordSetup,
    memberCache: Map<string, TeamMemberSummary[]>,
  ) {
    const desiredRolesByDiscordUserId = new Map<string, string[]>();
    for (const registration of activeRegistrations) {
      const desiredRoleIds = this.desiredScrimRoleIds(registration, setup);
      if (desiredRoleIds.length === 0) {
        continue;
      }
      const members = memberCache.get(registration.teamId) ?? [];
      for (const discordUserId of this.accessRoleManagerDiscordUserIds(
        registration,
        members,
      )) {
        this.addDesiredAccessRoles(
          desiredRolesByDiscordUserId,
          discordUserId,
          desiredRoleIds,
        );
      }
    }
    return desiredRolesByDiscordUserId;
  }

  private affectedAccessRoleDiscordUserIds(
    teamIds: string[],
    registrationsByTeamId: Map<string, SessionRegistrationResponse>,
    memberCache: Map<string, TeamMemberSummary[]>,
  ) {
    const discordUserIds: string[] = [];
    for (const teamId of teamIds) {
      const registration = registrationsByTeamId.get(teamId) ?? null;
      const members = memberCache.get(teamId) ?? [];
      discordUserIds.push(...this.activeTeamMemberDiscordUserIds(members));
      discordUserIds.push(
        ...this.accessRoleManagerDiscordUserIds(registration, members),
      );
    }
    return this.uniqueStrings(discordUserIds);
  }

  private async reconcileTeamSetAccessRoles(
    guild: Guild,
    setup: ScrimDiscordSetup,
    teamIds: string[],
    registrations: SessionRegistrationResponse[],
    activeRegistrationByTeamId: Map<string, SessionRegistrationResponse>,
    memberCache: Map<string, TeamMemberSummary[]>,
    extraDiscordUserIds: string[] = [],
  ) {
    const affectedTeamIds = this.uniqueStrings(teamIds);
    const explicitDiscordUserIds = this.uniqueStrings(extraDiscordUserIds);
    if (
      affectedTeamIds.length === 0 &&
      explicitDiscordUserIds.length === 0
    ) {
      return;
    }
    const managedRoleIds = this.scrimManagedRoleIds(setup);
    const registrationsByTeamId = this.registrationByTeamId(registrations);
    const desiredRolesByDiscordUserId = this.desiredAccessRolesByDiscordUser(
      [...activeRegistrationByTeamId.values()],
      setup,
      memberCache,
    );
    const affectedDiscordUserIds = this.uniqueStrings([
      ...this.affectedAccessRoleDiscordUserIds(
        affectedTeamIds,
        registrationsByTeamId,
        memberCache,
      ),
      ...explicitDiscordUserIds,
    ]);
    const reason = `Arenzyra scrim access sync ${setup.categoryId}`;

    await this.runLimited(
      affectedDiscordUserIds,
      ROLE_SYNC_CONCURRENCY,
      async (discordUserId) => {
        const guildMember = await guild.members
          .fetch(discordUserId)
          .catch(() => null);
        if (!guildMember) {
          return;
        }
        await this.applyManagedRoleSetToMember(
          guildMember,
          desiredRolesByDiscordUserId.get(discordUserId) ?? [],
          managedRoleIds,
          reason,
        );
      },
    );
  }

  private async removeTeamAccessRolesFromDiscordUser(
    guild: Guild,
    setup: ScrimDiscordSetup,
    discordUserId: string,
  ) {
    const roleIds = this.scrimManagedRoleIds(setup);
    if (roleIds.length === 0) {
      return;
    }
    const guildMember = await guild.members
      .fetch(discordUserId)
      .catch(() => null);
    if (!guildMember) {
      return;
    }
    await guildMember.roles
      .remove(roleIds, `Arenzyra manager transfer ${setup.categoryId}`)
      .catch((error) =>
        console.warn(
          `Discord transfer role remove failed for ${discordUserId}: ${String(error)}`,
        ),
      );
  }

  private normalizeTeamLookup(value: string) {
    return value.trim().replace(/\s+/g, " ").toLowerCase();
  }

  private resolveSessionRegistrationByTeamQuery(
    registrations: SessionRegistrationResponse[],
    query: string,
  ) {
    const normalizedName = this.normalizeTeamLookup(query);
    const normalizedTag = this.normalizeTag(query);
    const activeRegistrations = registrations.filter(
      (registration) =>
        this.activeRegistrationStatus(registration) && registration.team,
    );
    const nameMatches = activeRegistrations.filter((registration) => {
      const teamName = this.normalizeTeamLookup(registration.team?.name ?? "");
      return !!normalizedName && teamName === normalizedName;
    });
    const tagMatches = activeRegistrations.filter((registration) => {
      const teamTag = this.normalizeTag(registration.team?.tag ?? "");
      return !!normalizedTag && teamTag === normalizedTag;
    });
    const matches = nameMatches.length > 0 ? nameMatches : tagMatches;

    if (matches.length === 1) {
      return matches[0];
    }
    if (matches.length > 1) {
      throw new Error(
        `${this.emoji("warning")} Multiple session teams matched "${query}". Use the exact team name.`,
      );
    }
    throw new Error(
      `${this.emoji("reject")} Team "${query}" is not registered in this session.`,
    );
  }

  private async requireRequesterCanManageSessionTeam(
    team: TeamSummary,
    requesterDiscordId: string,
    staffBypass: boolean,
    config: SessionDiscordConfigResponse,
  ) {
    const members = await this.apiClient.listTeamMembers(team.id);
    const activeMembers = members.filter((member) =>
      this.isActiveMember(member),
    );
    if (
      !staffBypass &&
      !activeMembers.some(
        (member) => member.discordUserId === requesterDiscordId,
      )
    ) {
      throw new Error(
        `${this.emoji("reject", config)} Only this team's current manager or Arenzyra staff can update team managers.`,
      );
    }
    return activeMembers;
  }

  async addSessionTeamManager(
    guild: Guild,
    sessionId: string,
    teamQuery: string,
    newManager: DiscordRegistrationMemberInput,
    opts: DiscordActionAuditContext & {
      requesterDiscordId: string;
      staffBypass?: boolean;
    },
  ) {
    const [session, config, registrations] = await Promise.all([
      this.apiClient.getSession(sessionId),
      this.apiClient.getSessionDiscordConfig(sessionId),
      this.apiClient.listRegistrations(sessionId),
    ]);
    const registration = this.resolveSessionRegistrationByTeamQuery(
      registrations,
      teamQuery,
    );
    if (!registration.team) {
      throw new Error(`${this.emoji("reject", config)} Team not found.`);
    }
    const team = registration.team;
    const activeMembers = await this.requireRequesterCanManageSessionTeam(
      team,
      opts.requesterDiscordId,
      opts.staffBypass === true,
      config,
    );
    const currentSessionManagerIds =
      this.managerSnapshotDiscordUserIds(registration);
    if (currentSessionManagerIds.includes(newManager.discordUserId)) {
      return `${this.emoji("warning", config)} <@${newManager.discordUserId}> is already a manager for ${this.formatTeamSummary(team)}.`;
    }
    const leader =
      activeMembers.find((member) => member.role === "LEADER") ??
      activeMembers[0];
    if (!leader) {
      throw new Error(
        `${this.emoji("reject", config)} This team has no active manager to transfer from.`,
      );
    }
    if (!team.tag) {
      throw new Error(
        `${this.emoji("reject", config)} This team has no tag, so the manager cannot be updated safely.`,
      );
    }

    await this.apiClient.registerDiscordTeam({
      name: team.name,
      tag: team.tag,
      leaderDiscordUserId: leader.discordUserId,
      leaderDiscordUsername: leader.discordUsername ?? undefined,
      leaderDisplayName: leader.displayName ?? undefined,
      allowDiscordMemberTransfer: true,
      contextSessionId: session.id,
      members: [{ ...newManager, role: "LEADER" }],
    });
    const managerDiscordUserIds = this.uniqueStrings([
      ...(currentSessionManagerIds.length
        ? currentSessionManagerIds
        : [leader.discordUserId]),
      newManager.discordUserId,
    ]);
    await this.apiClient.updateRegistrationManagers(
      session.id,
      registration.id,
      this.registrationManagersPayload(registration, managerDiscordUserIds),
    );
    await this.syncAffectedTeamAccessRoles(guild, session.id, {
      activeTeamIds: [team.id],
    });
    const refreshed = await this.syncVisibleDiscordMessagesFast(
      guild,
      session.id,
    );
    if (!refreshed) {
      this.queueVisibleDiscordScrimRefresh(guild, session.id, config);
    }
    void this.sendDiscordActionLog(guild, config, {
      action: "Team manager added",
      actorDiscordId: opts.actorDiscordId,
      actorLabel: opts.actorLabel,
      sourceChannelId: opts.sourceChannelId,
      sessionId: session.id,
      sessionName: opts.sessionName ?? session.name,
      team,
      status: `<@${newManager.discordUserId}>`,
      color: 0x22c55e,
    }).catch((error) => {
      console.warn(`Manager transfer action log failed: ${String(error)}`);
    });

    return `${this.emoji("check", config)} Added <@${newManager.discordUserId}> to ${this.formatTeamSummary(team)}, synced the session role, and refreshed the slot list.`;
  }

  async removeSessionTeamManager(
    guild: Guild,
    sessionId: string,
    teamQuery: string,
    discordUserId: string,
    opts: DiscordActionAuditContext & {
      requesterDiscordId: string;
      staffBypass?: boolean;
    },
  ) {
    const [session, config, registrations] = await Promise.all([
      this.apiClient.getSession(sessionId),
      this.apiClient.getSessionDiscordConfig(sessionId),
      this.apiClient.listRegistrations(sessionId),
    ]);
    const registration = this.resolveSessionRegistrationByTeamQuery(
      registrations,
      teamQuery,
    );
    if (!registration.team) {
      throw new Error(`${this.emoji("reject", config)} Team not found.`);
    }
    const team = registration.team;
    const activeMembers = await this.requireRequesterCanManageSessionTeam(
      team,
      opts.requesterDiscordId,
      opts.staffBypass === true,
      config,
    );
    const currentSessionManagerIds =
      this.managerSnapshotDiscordUserIds(registration);
    const remainingSessionManagerIds = this.uniqueStrings(
      currentSessionManagerIds.filter(
        (managerDiscordUserId) => managerDiscordUserId !== discordUserId,
      ),
    );
    const isActiveTeamMember = activeMembers.some(
      (member) => member.discordUserId === discordUserId,
    );
    const isSessionManager = currentSessionManagerIds.includes(discordUserId);
    if (!isActiveTeamMember && !isSessionManager) {
      return `${this.emoji("warning", config)} <@${discordUserId}> is not an active manager for ${this.formatTeamSummary(team)}.`;
    }
    if (isSessionManager && remainingSessionManagerIds.length === 0) {
      throw new Error(
        `${this.emoji("reject", config)} Cannot remove the last manager. Add a new manager first.`,
      );
    }
    if (
      !isSessionManager &&
      currentSessionManagerIds.length === 0 &&
      activeMembers.length <= 1
    ) {
      throw new Error(
        `${this.emoji("reject", config)} Cannot remove the last manager. Add a new manager first.`,
      );
    }

    const setup = this.setupFromConfig(config);
    if (isSessionManager) {
      await this.apiClient.updateRegistrationManagers(
        session.id,
        registration.id,
        this.registrationManagersPayload(
          registration,
          remainingSessionManagerIds,
        ),
      );
    }
    if (isActiveTeamMember) {
      await this.apiClient.releaseDiscordTeamMember(team.id, discordUserId);
    }
    if (setup) {
      await this.removeTeamAccessRolesFromDiscordUser(
        guild,
        setup,
        discordUserId,
      );
    }
    await this.syncAffectedTeamAccessRoles(guild, session.id, {
      activeTeamIds: [team.id],
    });
    const refreshed = await this.syncVisibleDiscordMessagesFast(
      guild,
      session.id,
    );
    if (!refreshed) {
      this.queueVisibleDiscordScrimRefresh(guild, session.id, config);
    }
    void this.sendDiscordActionLog(guild, config, {
      action: "Team manager removed",
      actorDiscordId: opts.actorDiscordId,
      actorLabel: opts.actorLabel,
      sourceChannelId: opts.sourceChannelId,
      sessionId: session.id,
      sessionName: opts.sessionName ?? session.name,
      team,
      status: `<@${discordUserId}>`,
      color: 0xef4444,
    }).catch((error) => {
      console.warn(`Manager transfer action log failed: ${String(error)}`);
    });

    return `${this.emoji("check", config)} Removed <@${discordUserId}> from ${this.formatTeamSummary(team)}, synced the session role, and refreshed the slot list.`;
  }

  async registerTeamAndJoinScrim(
    leaderDiscordId: string,
    leaderUsername: string,
    leaderDisplayName: string | null,
    rawTag: string,
    rawName: string,
    members: DiscordRegistrationMemberInput[],
    guild: Guild | null,
    sessionId: string,
    logoUrl?: string | null,
    logoUpload?: TeamLogoUpload | null,
    options: RegisterTeamAndJoinOptions = {},
  ): Promise<string> {
    const reject = this.emoji("reject");
    const normalizedTag = this.normalizeTag(rawTag);
    const normalizedName = rawName.trim();
    if (!sessionId.trim()) {
      return `${reject} Session ID is required`;
    }
    if (!normalizedTag) {
      return `${reject} Team tag is required`;
    }
    if (!normalizedName) {
      return `${reject} Team name is required`;
    }

    try {
      const config = await this.apiClient.getSessionDiscordConfig(
        sessionId.trim(),
      );
      const modeLabel = this.registrationModeLabel(config);
      let effectiveLogoUpload = logoUpload ?? null;
      let pendingLogoRecord: PendingTeamLogoRecord | null = null;
      let pendingLogoNote: string | null = null;
      if (!effectiveLogoUpload && !logoUrl?.trim()) {
        try {
          const pendingLogo = await this.pendingLogoUploadForRegistration(
            normalizedName,
            normalizedTag,
            config,
            guild,
          );
          if (pendingLogo) {
            effectiveLogoUpload = pendingLogo.upload;
            pendingLogoRecord = pendingLogo.record;
            pendingLogoNote = `${this.emoji("check", config)} Saved logo attached from the logo channel.`;
          }
        } catch (error) {
          pendingLogoNote = `${this.emoji("warning", config)} Saved logo was found, but could not be attached: ${toFriendlyApiError(
            error,
          )}`;
        }
      }
      const requesterDiscordId = options.requesterDiscordId ?? leaderDiscordId;
      const staffBypass = await this.requesterHasStaffAccess(
        requesterDiscordId,
        guild,
        config,
      );
      await this.assertDiscordRegistrationAllowed(
        requesterDiscordId,
        [leaderDiscordId, ...members.map((member) => member.discordUserId)],
        guild,
        config,
        {
          staffBypass,
          registrationWindowBypass:
            options.registrationWindowBypass === true,
          registrationRoleBypass: options.registrationRoleBypass === true,
        },
      );
      const registrationManagerDiscordUserIds =
        this.registrationManagerDiscordUserIds(leaderDiscordId, members);
      const registrationLeaderDiscordUserId =
        registrationManagerDiscordUserIds[0] ?? leaderDiscordId;

      const response = await this.apiClient.registerDiscordTeam({
        tag: normalizedTag,
        name: normalizedName,
        leaderDiscordUserId: leaderDiscordId,
        leaderDiscordUsername: leaderUsername,
        leaderDisplayName: leaderDisplayName ?? undefined,
        logoUrl: logoUrl?.trim() || undefined,
        allowDiscordMemberTransfer: true,
        contextSessionId: sessionId.trim(),
        members: this.discordRegistrationManagerInputs(members),
      });

      const logoUploadNote = await this.uploadLogoAfterRegistration(
        response,
        effectiveLogoUpload,
        config,
      );
      if (effectiveLogoUpload && !logoUploadNote) {
        await this.persistRegistrationLogoSource({
          guild,
          sessionId: sessionId.trim(),
          config,
          teamName: normalizedName,
          tag: normalizedTag,
          logoUpload: effectiveLogoUpload,
          source:
            options.logoSource ??
            (pendingLogoRecord
              ? {
                  teamName: pendingLogoRecord.teamName,
                  tag: pendingLogoRecord.tag,
                  channelId: pendingLogoRecord.channelId,
                  messageId: pendingLogoRecord.messageId,
                  attachmentId: pendingLogoRecord.attachmentId,
                  url: pendingLogoRecord.url,
                  filename: pendingLogoRecord.filename,
                  contentType: pendingLogoRecord.contentType,
                  savedByDiscordId: pendingLogoRecord.savedByDiscordId,
                  savedByDiscordUsername:
                    pendingLogoRecord.savedByDiscordUsername,
                }
              : null),
        }).catch((error) => {
          pendingLogoNote = `${this.emoji("warning", config)} Team logo was saved, but the logo channel copy failed: ${toFriendlyApiError(
            error,
          )}`;
        });
      }
      let roleSyncNote: string | null = null;
      if (!options.backgroundDiscordSync) {
        roleSyncNote = await this.syncDiscordRoles(response, guild, config);
      }
      const lines = [
        this.formatRegisteredTeam(
          response,
          roleSyncNote,
          logoUploadNote,
          config,
        ),
      ];
      if (pendingLogoNote) {
        lines.push("", pendingLogoNote);
      }
      let shouldSyncDiscordState = false;
      let sessionRegistrationForManage: SessionRegistrationResponse | null =
        null;
      let auditRegistration: SessionRegistrationResponse | null = null;
      let auditStatus = response.created ? "team registered" : "team updated";
      let auditWarning: string | null = null;

      if (!staffBypass) {
        for (const discordUserId of registrationManagerDiscordUserIds) {
          await this.assertManagerTeamLimit(
            sessionId.trim(),
            discordUserId,
            response.team.id,
            config,
          );
        }
      }

      try {
        const sessionRegistration = await this.apiClient.registerTeam(
          sessionId.trim(),
          {
            teamId: response.team.id,
            note: `Registered via Discord ${modeLabel} panel for tag ${normalizedTag}`,
            bypassRegistrationWindow:
              staffBypass || options.registrationWindowBypass === true,
            placement: options.placement,
            leaderDiscordUserId: registrationLeaderDiscordUserId,
            managerDiscordUserIds: registrationManagerDiscordUserIds,
            tournamentRosterJson: options.tournamentRosterJson,
          },
        );
        lines.push(
          "",
          this.formatSessionRegistration(sessionRegistration, config),
        );
        shouldSyncDiscordState = true;
        sessionRegistrationForManage =
          sessionRegistration.status === "WAITLIST"
            ? null
            : sessionRegistration;
        auditRegistration = sessionRegistration;
        auditStatus = this.registrationActionLogStatus(sessionRegistration);
      } catch (error) {
        const friendly = toFriendlyApiError(error);
        if (friendly === "Already registered") {
          const registrations = await this.apiClient.listRegistrations(
            sessionId.trim(),
          );
          const existing = registrations.find(
            (registration) => registration.teamId === response.team.id,
          );
          lines.push(
            "",
            existing
              ? this.formatSessionRegistration(existing, config)
              : `${this.emoji("warning", config)} Team registered, but it was already in the session slot list.`,
          );
          shouldSyncDiscordState = true;
          auditRegistration = existing ?? null;
          auditStatus = "already registered";
        } else {
          lines.push(
            "",
            `${this.emoji("warning", config)} Team registered, but slot join failed: ${friendly}`,
          );
          auditStatus = "not registered";
          auditWarning = friendly;
        }
      }

      const notifyRegistrationResult = async () => {
        if (!options.onSessionRegistration) {
          return;
        }
        await Promise.resolve(
          options.onSessionRegistration({
            registration: auditRegistration,
            status: auditStatus,
            warning: auditWarning,
            content: lines.join("\n"),
            config,
          }),
        ).catch((error) => {
          console.warn(
            `Registration result callback failed for ${sessionId}: ${String(
              error,
            )}`,
          );
        });
      };

      await notifyRegistrationResult();

      await this.syncSessionRegistrationAccessRolesNow(
        guild,
        sessionId.trim(),
        auditRegistration,
        "post-registration immediate",
      ).catch((error) => {
        console.warn(
          `Immediate registration role sync failed for ${sessionId}: ${String(
            error,
          )}`,
        );
        return false;
      });

      if (options.backgroundDiscordSync && guild && shouldSyncDiscordState) {
        await this.withOrganization(config.organizationId, async () => {
          const refreshed = await this.syncVisibleDiscordMessagesFast(
            guild,
            sessionId.trim(),
          );
          if (!refreshed) {
            await this.syncDiscordScrimState(guild, sessionId.trim());
          }
        }).catch((error) => {
          console.warn(
            `Immediate registration message refresh failed for ${sessionId}: ${String(
              error,
            )}`,
          );
        });
      }

      const runDiscordPostRegistration = async () => {
        if (options.backgroundDiscordSync) {
          const note = await this.syncDiscordRoles(response, guild, config);
          if (note) {
            console.info(note);
          }
        }

        if (guild && shouldSyncDiscordState) {
          await this.syncVisibleDiscordMessagesFast(
            guild,
            sessionId.trim(),
          ).catch((error) => {
            console.warn(
              `Fast registration message refresh failed for ${sessionId}: ${String(
                error,
              )}`,
            );
            return false;
          });
          await this.syncSessionRegistrationAccessRolesNow(
            guild,
            sessionId.trim(),
            auditRegistration,
            "post-registration background",
          ).catch((error) => {
            console.warn(
              `Fast registration role sync failed for ${sessionId}: ${String(
                error,
              )}`,
            );
            return false;
          });
          await this.syncDiscordScrimState(guild, sessionId.trim());
          if (sessionRegistrationForManage) {
            try {
              await this.postRegistrationManagePanel(
                guild,
                sessionId.trim(),
                sessionRegistrationForManage,
              );
            } catch (error) {
              const warning = `${this.emoji("warning", config)} Manage controls were not posted: ${toFriendlyApiError(
                error,
              )}`;
              if (options.backgroundDiscordSync) {
                console.warn(warning);
              } else {
                lines.push("", warning);
              }
            }
          }
        }

        if (guild) {
          await this.sendDiscordActionLog(guild, config, {
            action: staffBypass
              ? "Staff registration accepted"
              : "Registration accepted",
            actorDiscordId: options.audit?.actorDiscordId ?? requesterDiscordId,
            actorLabel: options.audit?.actorLabel,
            sourceChannelId: options.audit?.sourceChannelId,
            sessionId: sessionId.trim(),
            sessionName: options.audit?.sessionName,
            team: response.team,
            slot:
              auditRegistration?.slotNumber ??
              (auditRegistration?.waitlistPosition
                ? `waitlist #${auditRegistration.waitlistPosition}`
                : null),
            status: auditStatus,
            reason: auditWarning,
            details: [
              `Leader: <@${leaderDiscordId}>`,
              `Managers: ${members.length}`,
              effectiveLogoUpload && !logoUploadNote ? "Logo: saved" : "",
              pendingLogoRecord ? "Logo source: saved logo channel" : "",
            ].filter(Boolean),
            color: auditWarning ? 0xf59e0b : 0x22c55e,
          });
        }
      };

      if (options.backgroundDiscordSync) {
        void runDiscordPostRegistration().catch((error) => {
          console.warn(
            `Background Discord registration sync failed for ${sessionId}: ${String(
              error,
            )}`,
          );
        });
      } else {
        await runDiscordPostRegistration();
      }

      return lines.join("\n");
    } catch (error) {
      throw new Error(toFriendlyApiError(error));
    }
  }

  private normalizeTeamName(value: string) {
    return value.trim().toUpperCase().replace(/\s+/g, " ");
  }

  async promoteWaitlistedTeamFromDiscord(
    requesterDiscordId: string,
    requesterLabel: string | null,
    rawTag: string,
    rawName: string,
    members: DiscordRegistrationMemberInput[],
    guild: Guild | null,
    sessionId: string,
    audit: DiscordActionAuditContext = {},
  ): Promise<string> {
    const sessionIdValue = sessionId.trim();
    const reject = this.emoji("reject");
    const normalizedTag = this.normalizeTag(rawTag);
    const normalizedName = this.normalizeTeamName(rawName);
    if (!sessionIdValue) {
      return `${reject} Session ID is required`;
    }
    if (!normalizedTag) {
      return `${reject} Team tag is required`;
    }
    if (!normalizedName) {
      return `${reject} Team name is required`;
    }

    try {
      const [session, config, registrations] = await Promise.all([
        this.apiClient.getSession(sessionIdValue),
        this.apiClient.getSessionDiscordConfig(sessionIdValue),
        this.apiClient.listRegistrations(sessionIdValue),
      ]);
      const staffBypass = await this.requesterHasStaffAccess(
        requesterDiscordId,
        guild,
        config,
      );
      const window = this.waitlistPromotionWindow(session, config);
      if (!window.allowsAction && !staffBypass) {
        throw new Error(
          `${this.emoji("reject", config)} Waitlist promotion is closed for this scrim.`,
        );
      }

      const nextSlot = this.nextAvailableNormalSlot(
        session,
        registrations,
        config,
      );
      if (nextSlot === null) {
        throw new Error(
          `${this.emoji("reject", config)} No normal slot is empty. VIP slots do not open waitlist promotion.`,
        );
      }

      const waitlistRegistrations = registrations.filter(
        (registration) =>
          registration.status === "WAITLIST" &&
          registration.waitlistPosition !== null,
      );
      const tagMatches = waitlistRegistrations.filter(
        (registration) =>
          this.normalizeTag(registration.team?.tag ?? "") === normalizedTag,
      );
      const nameMatches = tagMatches.filter(
        (registration) =>
          this.normalizeTeamName(registration.team?.name ?? "") ===
          normalizedName,
      );
      const candidates = nameMatches.length > 0 ? nameMatches : tagMatches;

      if (candidates.length === 0) {
        throw new Error(
          `${this.emoji("reject", config)} This team is not on the waitlist for this scrim.`,
        );
      }
      if (candidates.length > 1) {
        throw new Error(
          `${this.emoji("warning", config)} More than one waitlist team matched this tag. Ask an admin to promote it from the waitlist control panel.`,
        );
      }

      const registration = candidates[0];
      if (!staffBypass) {
        const teamMembers = await this.apiClient.listTeamMembers(
          registration.teamId,
        );
        const activeIds = new Set(
          teamMembers
            .filter((member) => this.isActiveMember(member))
            .map((member) => member.discordUserId),
        );
        if (!activeIds.has(requesterDiscordId)) {
          throw new Error(
            `${this.emoji("reject", config)} Only a manager from the waitlisted team can claim an empty slot.`,
          );
        }

        const mentionedIds = members.map((member) => member.discordUserId);
        if (
          mentionedIds.length > 0 &&
          !mentionedIds.some((discordUserId) => activeIds.has(discordUserId))
        ) {
          throw new Error(
            `${this.emoji("reject", config)} Mention a manager from the same waitlisted team.`,
          );
        }
      }

      const placement = await this.updateRegistrationPlacement(
        sessionIdValue,
        registration.id,
        { action: "APPROVE" },
        guild,
        {
          actorDiscordId: audit.actorDiscordId ?? requesterDiscordId,
          actorLabel: audit.actorLabel ?? requesterLabel,
          sourceChannelId: audit.sourceChannelId,
          sessionName: audit.sessionName ?? session.name,
        },
      );
      return `${this.emoji("check", config)} Waitlist team moved to ${placement}.`;
    } catch (error) {
      throw new Error(toFriendlyApiError(error));
    }
  }

  private async requireLeaderForTeam(
    requesterDiscordId: string,
    team: TeamSummary,
  ): Promise<void> {
    const members = await this.apiClient.listTeamMembers(team.id);
    const activeLeader = members.find(
      (member) => member.role === "LEADER" && this.isActiveMember(member),
    );

    if (!activeLeader || activeLeader.discordUserId !== requesterDiscordId) {
      throw new Error(
        `${this.emoji("reject")} Only the registered team leader can use this command. Register the team first if needed.`,
      );
    }
  }

  private async loadRoleSyncConfig(): Promise<DiscordConfigResponse | null> {
    try {
      const config = await this.apiClient.getDiscordConfig();
      if (!config.enabled || !config.autoSyncRoles) {
        return null;
      }
      return config;
    } catch (error) {
      console.warn(
        `Discord role sync config fetch failed: ${toFriendlyApiError(error)}`,
      );
      return null;
    }
  }

  private async syncDiscordRoles(
    registration: RegisterDiscordTeamResponse,
    guild: Guild | null,
    emojis?: Pick<SessionDiscordConfigResponse, "emojis"> | null,
  ): Promise<string | null> {
    const check = this.emoji("check", emojis);
    const warning = this.emoji("warning", emojis);
    const config = await this.loadRoleSyncConfig();
    if (!config) {
      return null;
    }

    if (!guild) {
      return `${warning} Discord role sync skipped because this command was not used in a server.`;
    }

    if (config.guildId && config.guildId !== guild.id) {
      return `${warning} Discord role sync skipped because this server does not match the configured Arenzyra guild.`;
    }

    let captainRoleId: string | null = null;
    let participantRoleId: string | null = null;

    if (config.captainRoleId) {
      const captainRole = await guild.roles
        .fetch(config.captainRoleId)
        .catch(() => null);
      if (captainRole) {
        captainRoleId = config.captainRoleId;
      }
    }

    if (config.participantRoleId) {
      const participantRole = await guild.roles
        .fetch(config.participantRoleId)
        .catch(() => null);
      if (participantRole) {
        participantRoleId = config.participantRoleId;
      }
    }

    if (!captainRoleId && !participantRoleId) {
      return `${warning} Discord role sync skipped because no configured team roles were found in this server.`;
    }

    let syncedCount = 0;
    let failedCount = 0;

    for (const member of registration.members.filter((entry) =>
      this.isActiveMember(entry),
    )) {
      const roleIds = new Set<string>();
      if (participantRoleId) {
        roleIds.add(participantRoleId);
      }
      if (member.role === "LEADER" && captainRoleId) {
        roleIds.add(captainRoleId);
      }
      if (roleIds.size === 0) {
        continue;
      }

      try {
        const guildMember = await guild.members.fetch(member.discordUserId);
        await guildMember.roles.add([...roleIds]);
        syncedCount += 1;
      } catch (error) {
        failedCount += 1;
        console.warn(
          `Discord role sync failed for team ${registration.team.id} user ${member.discordUserId}: ${toFriendlyApiError(error)}`,
        );
      }
    }

    if (syncedCount === 0 && failedCount > 0) {
      return `${warning} Discord role sync could not update any registered members in this server.`;
    }

    if (syncedCount > 0 && failedCount > 0) {
      return `${warning} Discord role sync updated ${syncedCount} member(s); ${failedCount} member(s) could not be updated.`;
    }

    if (syncedCount > 0) {
      return `${check} Discord roles synced for ${syncedCount} member(s).`;
    }

    return null;
  }

  async createScrim(
    creatorDiscordId: string,
    name: string,
    slots?: number,
    guild?: Guild | null,
  ): Promise<string> {
    const slotCount = slots ?? 25;

    try {
      const organizationId = guild
        ? (await this.apiClient.resolveDiscordGuild(guild.id)).organizationId
        : null;

      return await this.withOrganization(organizationId, async () => {
        const session = await this.apiClient.createSession({
          name,
          type: "SCRIM",
          status: "OPEN",
          slotCount,
          maxTeams: slotCount,
          waitlistEnabled: true,
        });
        this.sessionCreatorById.set(session.id, creatorDiscordId);
        const lines = [
          `${this.emoji("check")} Scrim created: ${session.name}`,
          `ID: ${session.id}`,
        ];

        if (guild) {
          const setup = await this.syncDiscordScrimState(guild, session.id);
          lines.push(
            "",
            "Discord setup:",
            `Registration: <#${setup.registrationChannelId}>`,
            `Slot List: <#${setup.slotListChannelId}>`,
            `Waitlist: <#${setup.waitlistChannelId}>`,
            `IDP: <#${setup.idpChannelId}>`,
          );
        }

        return lines.join("\n");
      });
    } catch (error) {
      throw new Error(toFriendlyApiError(error));
    }
  }

  async joinScrim(
    requesterDiscordId: string,
    sessionId: string,
    rawTag: string,
    guild?: Guild | null,
    audit: DiscordActionAuditContext = {},
  ): Promise<string> {
    const normalizedTag = this.normalizeTag(rawTag);
    const team = await this.resolveTeamByTag(normalizedTag);
    if (!guild) {
      await this.requireLeaderForTeam(requesterDiscordId, team);
    }

    try {
      const config = await this.apiClient.getSessionDiscordConfig(sessionId);
      const staffBypass = guild
        ? await this.requesterHasStaffAccess(requesterDiscordId, guild, config)
        : false;
      if (guild && !staffBypass) {
        await this.requireLeaderForTeam(requesterDiscordId, team);
      }
      await this.assertDiscordRegistrationAllowed(
        requesterDiscordId,
        [],
        guild ?? null,
        config,
        { staffBypass },
      );
      if (!staffBypass) {
        await this.assertManagerTeamLimit(
          sessionId,
          requesterDiscordId,
          team.id,
          config,
        );
      }

      const registration = await this.apiClient.registerTeam(sessionId, {
        teamId: team.id,
        note: `Joined via Discord for tag ${normalizedTag}`,
        bypassRegistrationWindow: staffBypass,
      });
      if (guild) {
        await this.syncDiscordScrimState(guild, sessionId);
      }

      await this.sendDiscordActionLog(guild, config, {
        action: staffBypass ? "Staff added team to scrim" : "Team joined scrim",
        actorDiscordId: audit.actorDiscordId ?? requesterDiscordId,
        actorLabel: audit.actorLabel,
        sourceChannelId: audit.sourceChannelId,
        sessionId,
        sessionName: audit.sessionName,
        team,
        slot:
          registration.slotNumber ??
          (registration.waitlistPosition
            ? `waitlist #${registration.waitlistPosition}`
            : null),
        status: this.registrationActionLogStatus(registration),
        color: 0x22c55e,
      });

      if (
        (registration.status === "CONFIRMED" ||
          registration.status === "CHECKED_IN") &&
        registration.slotNumber !== null
      ) {
        return `${this.emoji("check", config)} Joined (Slot #${registration.slotNumber})`;
      }

      if (
        registration.status === "WAITLIST" &&
        registration.waitlistPosition !== null
      ) {
        return `${this.emoji("clock", config)} Added to waitlist (Position #${registration.waitlistPosition})`;
      }

      return `${this.emoji("check", config)} ${team.tag ?? normalizedTag} registered for scrim`;
    } catch (error) {
      throw new Error(toFriendlyApiError(error));
    }
  }

  async leaveScrim(
    requesterDiscordId: string,
    sessionId: string,
    rawTag: string,
    guild?: Guild | null,
    audit: DiscordActionAuditContext = {},
  ): Promise<string> {
    const normalizedTag = this.normalizeTag(rawTag);
    const team = await this.resolveTeamByTag(normalizedTag);
    await this.requireLeaderForTeam(requesterDiscordId, team);

    try {
      const registrations = await this.apiClient.listRegistrations(sessionId);
      const registration =
        registrations.find((entry) => entry.teamId === team.id) ?? null;

      if (!registration) {
        return `${this.emoji("reject")} Team not registered in this scrim`;
      }

      const result = await this.apiClient.removeRegistration(
        sessionId,
        registration.id,
      );
      const config = await this.apiClient
        .getSessionDiscordConfig(sessionId)
        .catch(() => null);
      const cleanup = await this.syncRemovedTeamsThenCleanup(
        guild,
        sessionId,
        [team.id],
        this.registrationRoleSyncDiscordUserIds([
          result.removedRegistration ?? registration,
        ]),
      );
      const releasedMembers = cleanup.get(team.id) ?? 0;
      await this.sendDiscordActionLog(guild, config, {
        action: "Team left scrim",
        actorDiscordId: audit.actorDiscordId ?? requesterDiscordId,
        actorLabel: audit.actorLabel,
        sourceChannelId: audit.sourceChannelId,
        sessionId,
        sessionName: audit.sessionName,
        team,
        slot: registration.slotNumber,
        status: "removed",
        details: `Released member links: ${releasedMembers}`,
        color: 0xf59e0b,
      });
      return `${this.emoji("reject", config)} ${normalizedTag} removed from scrim and roster released (${releasedMembers} member link${
        releasedMembers === 1 ? "" : "s"
      })`;
    } catch (error) {
      throw new Error(toFriendlyApiError(error));
    }
  }

  async removeTeamFromScrim(
    sessionId: string,
    rawTag: string,
    guild?: Guild | null,
    audit: DiscordActionAuditContext = {},
  ): Promise<string> {
    const normalizedTag = this.normalizeTag(rawTag);
    const team = await this.resolveTeamByTag(normalizedTag);

    try {
      const [registrations, config] = await Promise.all([
        this.apiClient.listRegistrations(sessionId),
        this.apiClient.getSessionDiscordConfig(sessionId).catch(() => null),
      ]);
      const registration =
        registrations.find((entry) => entry.teamId === team.id) ?? null;

      if (!registration) {
        return `${this.emoji("reject", config)} Team not registered in this scrim`;
      }

      const result = await this.apiClient.removeRegistration(
        sessionId,
        registration.id,
      );
      const cleanup = await this.syncRemovedTeamsThenCleanup(
        guild,
        sessionId,
        [team.id],
        this.registrationRoleSyncDiscordUserIds([
          result.removedRegistration ?? registration,
        ]),
      );
      const releasedMembers = cleanup.get(team.id) ?? 0;
      await this.sendDiscordActionLog(guild, config, {
        action: "Team removed from scrim",
        actorDiscordId: audit.actorDiscordId,
        actorLabel: audit.actorLabel,
        sourceChannelId: audit.sourceChannelId,
        sessionId,
        sessionName: audit.sessionName,
        team,
        slot: registration.slotNumber,
        status: "removed",
        details: [
          `Released member links: ${releasedMembers}`,
          result.promotedRegistration
            ? `Promoted: ${this.resolveTeamLabel(result.promotedRegistration)}`
            : "",
        ].filter(Boolean),
        color: 0xf59e0b,
      });

      const lines = [
        `${this.emoji("reject", config)} ${normalizedTag} removed from scrim and roster released (${releasedMembers} member link${
          releasedMembers === 1 ? "" : "s"
        })`,
      ];
      if (result.promotedRegistration) {
        lines.push(
          "",
          this.formatSessionRegistration(result.promotedRegistration, config),
        );
      }
      return lines.join("\n");
    } catch (error) {
      throw new Error(toFriendlyApiError(error));
    }
  }

  private scrimManagedRoleIds(
    setup: ScrimDiscordSetup,
    options: { includeBannedRole?: boolean } = {},
  ) {
    return this.uniqueRoleIds([
      setup.slotRoleId,
      setup.waitlistRoleId,
      setup.idpRoleId,
      setup.legacyIdpRoleId,
      options.includeBannedRole ? setup.bannedRoleId : "",
    ]);
  }

  private uniqueRoleIds(roleIds: Array<string | null | undefined>) {
    return [
      ...new Set(
        roleIds
          .map((roleId) => roleId?.trim())
          .filter((roleId): roleId is string => Boolean(roleId)),
      ),
    ];
  }

  private uniqueStrings(values: Array<string | null | undefined>) {
    return [
      ...new Set(
        values
          .map((value) => value?.trim())
          .filter((value): value is string => Boolean(value)),
      ),
    ];
  }

  private slotAccessRoleIds(setup: ScrimDiscordSetup) {
    return this.uniqueRoleIds([setup.slotRoleId, setup.idpRoleId]);
  }

  private waitlistAccessRoleIds(setup: ScrimDiscordSetup) {
    return this.uniqueRoleIds([setup.waitlistRoleId]);
  }

  private slotAccessRemoveRoleIds(setup: ScrimDiscordSetup) {
    return this.uniqueRoleIds([setup.waitlistRoleId, setup.legacyIdpRoleId]);
  }

  private waitlistAccessRemoveRoleIds(setup: ScrimDiscordSetup) {
    return this.uniqueRoleIds([
      setup.slotRoleId,
      setup.idpRoleId,
      setup.legacyIdpRoleId,
    ]);
  }

  private desiredScrimRoleIds(
    registration: SessionRegistrationResponse | null,
    setup: ScrimDiscordSetup,
  ) {
    if (
      registration &&
      (registration.status === "CONFIRMED" ||
        registration.status === "CHECKED_IN") &&
      registration.slotNumber !== null
    ) {
      return this.slotAccessRoleIds(setup);
    }

    if (
      registration?.status === "WAITLIST" &&
      registration.waitlistPosition !== null
    ) {
      return this.waitlistAccessRoleIds(setup);
    }

    return [];
  }

  private activeRegistrationByTeam(
    registrations: SessionRegistrationResponse[],
  ) {
    const byTeamId = new Map<string, SessionRegistrationResponse>();
    for (const registration of registrations) {
      if (!this.activeRegistrationStatus(registration)) {
        continue;
      }
      const existing = byTeamId.get(registration.teamId);
      const isSlot =
        (registration.status === "CONFIRMED" ||
          registration.status === "CHECKED_IN") &&
        registration.slotNumber !== null;
      const isWaitlist =
        registration.status === "WAITLIST" &&
        registration.waitlistPosition !== null;
      if (!isSlot && !isWaitlist) {
        continue;
      }

      const existingIsSlot =
        existing &&
        (existing.status === "CONFIRMED" || existing.status === "CHECKED_IN") &&
        existing.slotNumber !== null;
      if (!existing || (isSlot && !existingIsSlot)) {
        byTeamId.set(registration.teamId, registration);
      }
    }
    return byTeamId;
  }

  private async applyManagedRoleSetToMember(
    member: GuildMember,
    desiredRoleIds: string[],
    managedRoleIds: string[],
    reason: string,
  ) {
    const desiredIds = this.uniqueRoleIds(desiredRoleIds);
    const managedIds = this.uniqueRoleIds(managedRoleIds);
    const desired = new Set(desiredIds);
    const roleCache = member.roles?.cache;
    const hasRole =
      roleCache && typeof roleCache.has === "function"
        ? (roleId: string) => roleCache.has(roleId)
        : null;
    const removeRoleIds = hasRole
      ? managedIds.filter((roleId) => !desired.has(roleId) && hasRole(roleId))
      : managedIds.filter((roleId) => !desired.has(roleId));
    const addRoleIds = hasRole
      ? desiredIds.filter((roleId) => !hasRole(roleId))
      : desiredIds;
    let added = 0;
    let removed = 0;
    let failed = 0;

    if (removeRoleIds.length > 0) {
      await member.roles
        .remove(removeRoleIds, reason)
        .then(() => {
          removed += removeRoleIds.length;
        })
        .catch((error) => {
          failed += removeRoleIds.length;
          console.warn(
            `Discord managed role remove failed for ${member.id}: ${String(
              error,
            )}`,
          );
        });
    }

    if (addRoleIds.length > 0) {
      await member.roles
        .add(addRoleIds, reason)
        .then(() => {
          added += addRoleIds.length;
        })
        .catch((error) => {
          failed += addRoleIds.length;
          console.warn(
            `Discord managed role add failed for ${member.id}: ${String(
              error,
            )}`,
          );
        });
    }

    return { added, removed, failed };
  }

  private async cachedManagedRoleMembers(
    guild: Guild,
    roleIds: string[],
    fetchAllGuildMembers = false,
  ) {
    const byUserId = new Map<string, GuildMember>();
    if (fetchAllGuildMembers) {
      const members = await guild.members.fetch().catch(() => null);
      for (const member of members?.values?.() ?? []) {
        byUserId.set(member.id, member);
      }
    }
    for (const roleId of roleIds) {
      const role = await guild.roles.fetch(roleId).catch(() => null);
      for (const member of role?.members?.values?.() ?? []) {
        byUserId.set(member.id, member);
      }
    }
    return byUserId;
  }

  private async runScrimRoleCleanup(
    guild: Guild,
    session: SessionResponse,
    config: SessionDiscordConfigResponse,
    mode: ScrimRoleCleanupMode,
    options: ScrimRoleCleanupOptions = {},
  ): Promise<ScrimRoleCleanupResult> {
    const setup = this.setupFromConfig(config);
    if (!setup) {
      throw new Error("Saved Discord setup is incomplete.");
    }

    const managedRoleIds = this.scrimManagedRoleIds(setup, {
      includeBannedRole: mode === "strip" && options.includeBannedRole,
    });
    if (managedRoleIds.length === 0) {
      throw new Error("No configured scrim roles were found.");
    }

    const registrations = await this.apiClient.listRegistrations(session.id);
    const activeByTeamId = this.activeRegistrationByTeam(registrations);
    const registrationsByTeamId = this.registrationByTeamId(registrations);
    const allTeamIds = [...new Set(registrations.map((entry) => entry.teamId))];
    const memberCache = await this.loadTeamMembersForSync(allTeamIds);
    const desiredRolesByUserId =
      mode === "strip"
        ? new Map<string, string[]>()
        : this.desiredAccessRolesByDiscordUser(
            [...activeByTeamId.values()],
            setup,
            memberCache,
          );
    const knownUserIds = new Set<string>();

    for (const teamId of allTeamIds) {
      const members = memberCache.get(teamId) ?? [];
      for (const member of members) {
        if (!this.isActiveMember(member) || !member.discordUserId) {
          continue;
        }
        knownUserIds.add(member.discordUserId);
      }
      for (const discordUserId of this.accessRoleManagerDiscordUserIds(
        activeByTeamId.get(teamId) ?? registrationsByTeamId.get(teamId) ?? null,
        members,
      )) {
        knownUserIds.add(discordUserId);
      }
    }
    for (const userId of desiredRolesByUserId.keys()) {
      knownUserIds.add(userId);
    }

    const cachedRoleMembers = await this.cachedManagedRoleMembers(
      guild,
      managedRoleIds,
      Boolean(options.fetchAllGuildMembers),
    );
    const result: ScrimRoleCleanupResult = {
      mode,
      knownMembers: knownUserIds.size,
      cachedRoleMembers: cachedRoleMembers.size,
      added: 0,
      removed: 0,
      failed: 0,
    };
    const reason =
      mode === "strip"
        ? `Arenzyra scrim managed role strip ${setup.categoryId}`
        : `Arenzyra scrim managed role reconciliation ${setup.categoryId}`;

    for (const userId of knownUserIds) {
      const member = await guild.members.fetch(userId).catch(() => null);
      if (!member) {
        continue;
      }
      const update = await this.applyManagedRoleSetToMember(
        member,
        desiredRolesByUserId.get(userId) ?? [],
        managedRoleIds,
        reason,
      );
      result.added += update.added;
      result.removed += update.removed;
      result.failed += update.failed;
    }

    for (const [userId, member] of cachedRoleMembers) {
      if (knownUserIds.has(userId)) {
        continue;
      }
      const update = await this.applyManagedRoleSetToMember(
        member,
        mode === "strip" ? [] : (desiredRolesByUserId.get(userId) ?? []),
        managedRoleIds,
        reason,
      );
      result.added += update.added;
      result.removed += update.removed;
      result.failed += update.failed;
    }

    return result;
  }

  private cleanScrimRolesInBackground(
    guild: Guild | null | undefined,
    sessionId: string,
    mode: ScrimRoleCleanupMode,
    delayMs = 1_500,
    options: ScrimRoleCleanupOptions = {},
  ) {
    if (!guild) {
      return;
    }
    setTimeout(() => {
      void this.cleanScrimRolesFromScrim(
        sessionId,
        guild,
        mode,
        {
          actorLabel: "System",
        },
        options,
      ).catch((error) => {
        console.warn(
          `[DiscordCleanup] scrim role cleanup failed session=${sessionId}: ${String(
            error,
          )}`,
        );
      });
    }, delayMs).unref?.();
  }

  private reconcileScrimRolesInBackground(
    guild: Guild | null | undefined,
    sessionId: string,
    delayMs = 1_500,
  ) {
    this.cleanScrimRolesInBackground(guild, sessionId, "reconcile", delayMs, {
      fetchAllGuildMembers: true,
    });
  }

  async cleanScrimRolesFromScrim(
    sessionId: string,
    guild?: Guild | null,
    mode: ScrimRoleCleanupMode = "reconcile",
    audit: DiscordActionAuditContext = {},
    options: ScrimRoleCleanupOptions = {},
  ): Promise<string> {
    try {
      const [session, config] = await Promise.all([
        this.apiClient.getSession(sessionId),
        this.apiClient.getSessionDiscordConfig(sessionId),
      ]);
      if (!guild) {
        return `${this.emoji("warning", config)} Use this command inside the Discord server.`;
      }
      if (config.guildId && config.guildId !== guild.id) {
        return `${this.emoji("warning", config)} This server does not match the configured Arenzyra guild.`;
      }

      const result = await this.runScrimRoleCleanup(
        guild,
        session,
        config,
        mode,
        {
          fetchAllGuildMembers: true,
          ...options,
        },
      );
      void this.sendDiscordActionLog(guild, config, {
        action:
          mode === "strip" ? "Scrim roles stripped" : "Scrim roles reconciled",
        actorDiscordId: audit.actorDiscordId,
        actorLabel: audit.actorLabel,
        sourceChannelId: audit.sourceChannelId,
        sessionId,
        sessionName: audit.sessionName ?? session.name,
        status:
          mode === "strip"
            ? "managed roles removed"
            : "managed roles reconciled",
        details: [
          `Known members: ${result.knownMembers}`,
          `Cached role members: ${result.cachedRoleMembers}`,
          `Roles added: ${result.added}`,
          `Roles removed: ${result.removed}`,
          `Failed: ${result.failed}`,
        ],
        color: mode === "strip" ? 0xef4444 : 0x22c55e,
      }).catch((error) => {
        console.warn(
          `Discord action log failed for scrim role cleanup ${sessionId}: ${String(
            error,
          )}`,
        );
      });

      const action =
        mode === "strip"
          ? "removed all managed scrim roles"
          : "reconciled managed scrim roles";
      const failed =
        result.failed > 0 ? ` ${result.failed} role update(s) failed.` : "";
      return `${this.emoji("check", config)} ${action}: ${result.removed} removed, ${result.added} added across ${result.knownMembers} known member(s) and ${result.cachedRoleMembers} cached role member(s).${failed}`;
    } catch (error) {
      throw new Error(toFriendlyApiError(error));
    }
  }

  async cleanSlotFromScrim(
    sessionId: string,
    slotNumber: number,
    guild?: Guild | null,
    audit: DiscordActionAuditContext = {},
  ): Promise<string> {
    try {
      const [registrations, config] = await Promise.all([
        this.apiClient.listRegistrations(sessionId),
        this.apiClient.getSessionDiscordConfig(sessionId).catch(() => null),
      ]);
      const registration =
        registrations.find((entry) => entry.slotNumber === slotNumber) ?? null;

      if (!registration) {
        return `${this.emoji("reject", config)} No team is assigned to slot #${slotNumber}`;
      }

      const result = await this.apiClient.removeRegistration(
        sessionId,
        registration.id,
      );
      const removedRoleSyncUserIds = this.registrationRoleSyncDiscordUserIds([
        result.removedRegistration ?? registration,
      ]);
      this.syncDiscordScrimStateInBackground(guild, sessionId, {
        organizationId: config?.organizationId,
        removedTeamIds: [registration.teamId],
        activeTeamIds: result.promotedRegistration
          ? [result.promotedRegistration.teamId]
          : [],
        extraDiscordUserIds: removedRoleSyncUserIds,
        cleanupTeamIds: [registration.teamId],
        fastMessageRefresh: true,
        skipFullSync: true,
        delayMs: 0,
      });
      this.reconcileScrimRolesInBackground(guild, sessionId);
      void this.sendDiscordActionLog(guild, config, {
        action: "Slot cleaned",
        actorDiscordId: audit.actorDiscordId,
        actorLabel: audit.actorLabel,
        sourceChannelId: audit.sourceChannelId,
        sessionId,
        sessionName: audit.sessionName,
        team: registration.team,
        slot: slotNumber,
        status: "removed",
        details: [
          "Discord refresh and roster release queued.",
          result.promotedRegistration
            ? `Promoted: ${this.resolveTeamLabel(result.promotedRegistration)}`
            : "",
        ].filter(Boolean),
        color: 0xf59e0b,
      }).catch((error) => {
        console.warn(
          `Discord action log failed for clean slot ${sessionId}: ${String(
            error,
          )}`,
        );
      });

      const lines = [
        `${this.emoji("reject", config)} Cleared slot #${slotNumber}: ${this.resolveTeamLabel(
          registration,
        )} removed from scrim. Discord refresh and roster release queued.`,
      ];
      if (result.promotedRegistration) {
        lines.push(
          "",
          this.formatSessionRegistration(result.promotedRegistration, config),
        );
      }
      return lines.join("\n");
    } catch (error) {
      throw new Error(toFriendlyApiError(error));
    }
  }

  private waitlistDiscordStateCleanupSummary(result: {
    deletedMessages: number;
    removedRoles: number;
    failedRoles: number;
  }) {
    const parts: string[] = [];
    if (result.deletedMessages > 0) {
      parts.push(
        `${result.deletedMessages} stale waitlist message${
          result.deletedMessages === 1 ? "" : "s"
        } deleted`,
      );
    }
    if (result.removedRoles > 0) {
      parts.push(
        `${result.removedRoles} stale waitlist role${
          result.removedRoles === 1 ? "" : "s"
        } removed`,
      );
    }
    if (result.failedRoles > 0) {
      parts.push(
        `${result.failedRoles} stale role removal${
          result.failedRoles === 1 ? "" : "s"
        } failed`,
      );
    }
    return parts.join("; ");
  }

  private collectMentionedDiscordUserIds(value: string | null | undefined) {
    if (!value) {
      return [];
    }
    return [...value.matchAll(DISCORD_USER_MENTION_CAPTURE_PATTERN)].map(
      (match) => match[1],
    );
  }

  private waitlistMessageText(message: Message) {
    const parts = [message.content ?? ""];
    for (const embed of message.embeds) {
      parts.push(embed.title ?? "", embed.description ?? "");
      for (const field of embed.fields ?? []) {
        parts.push(field.name ?? "", field.value ?? "");
      }
      parts.push(embed.footer?.text ?? "");
    }
    return parts.join("\n");
  }

  private isStaleWaitlistBotMessage(
    message: Message,
    managedId: string | null,
  ) {
    if (managedId && message.id === managedId) {
      return false;
    }
    if (/^Clean waitlist for\b/i.test(message.content ?? "")) {
      return true;
    }
    return message.embeds.some((embed) =>
      /\bwaitlist\b/i.test(embed.title ?? ""),
    );
  }

  private async fetchWaitlistTextChannel(
    guild: Guild,
    config: SessionDiscordConfigResponse | null,
  ) {
    const channelId = config?.waitlistChannelId?.trim();
    if (!channelId) {
      return null;
    }
    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased() || channel.isDMBased()) {
      return null;
    }
    return channel as GuildTextBasedChannel;
  }

  private async cleanupStaleWaitlistDiscordState(
    guild: Guild | null | undefined,
    config: SessionDiscordConfigResponse | null,
    extraDiscordUserIds: string[] = [],
  ) {
    const result = {
      deletedMessages: 0,
      removedRoles: 0,
      failedRoles: 0,
      staleUserIds: 0,
    };
    if (!guild || !config) {
      return result;
    }

    const channel = await this.fetchWaitlistTextChannel(guild, config);
    const botUserId = guild.client.user?.id ?? null;
    const managedId = config.emojis?.managedWaitlistMessageId?.trim() || null;
    const staleUserIds = new Set(this.uniqueStrings(extraDiscordUserIds));

    if (channel && botUserId) {
      const recentMessages = await channel.messages
        .fetch({ limit: 100 })
        .catch(() => null);
      const pinnedMessages = await channel.messages
        .fetchPinned()
        .catch(() => null);
      const seenMessageIds = new Set<string>();
      const messages = [
        ...Array.from(recentMessages?.values() ?? []),
        ...Array.from(pinnedMessages?.values() ?? []),
      ];
      for (const message of messages) {
        if (seenMessageIds.has(message.id)) {
          continue;
        }
        seenMessageIds.add(message.id);
        if (
          message.author.id !== botUserId ||
          !this.isStaleWaitlistBotMessage(message, managedId)
        ) {
          continue;
        }
        for (const userId of this.collectMentionedDiscordUserIds(
          this.waitlistMessageText(message),
        )) {
          staleUserIds.add(userId);
        }
        await message
          .delete()
          .then(() => {
            result.deletedMessages += 1;
          })
          .catch(() => undefined);
      }
    }

    const waitlistRoleId = config.waitlistRoleId?.trim();
    if (waitlistRoleId) {
      for (const userId of staleUserIds) {
        const member = await guild.members.fetch(userId).catch(() => null);
        if (!member?.roles.cache.has(waitlistRoleId)) {
          continue;
        }
        await member.roles
          .remove(
            waitlistRoleId,
            `Arenzyra waitlist cleanup ${config.sessionId}`,
          )
          .then(() => {
            result.removedRoles += 1;
          })
          .catch((error) => {
            result.failedRoles += 1;
            console.warn(
              `Discord stale waitlist role remove failed for ${userId}: ${String(
                error,
              )}`,
            );
          });
      }
    }

    result.staleUserIds = staleUserIds.size;
    return result;
  }

  async cleanWaitlistFromScrim(
    sessionId: string,
    guild?: Guild | null,
    audit: DiscordActionAuditContext = {},
  ): Promise<string> {
    try {
      const [registrations, config] = await Promise.all([
        this.apiClient.listRegistrations(sessionId),
        this.apiClient.getSessionDiscordConfig(sessionId).catch(() => null),
      ]);
      const waitlistRegistrations = registrations
        .filter((registration) => registration.waitlistPosition !== null)
        .sort(
          (left, right) =>
            (left.waitlistPosition ?? Number.MAX_SAFE_INTEGER) -
              (right.waitlistPosition ?? Number.MAX_SAFE_INTEGER) ||
            left.createdAt.localeCompare(right.createdAt),
        );

      if (!waitlistRegistrations.length) {
        const staleCleanup = await this.cleanupStaleWaitlistDiscordState(
          guild,
          config,
        );
        const staleSummary =
          this.waitlistDiscordStateCleanupSummary(staleCleanup);
        if (guild) {
          this.syncDiscordScrimStateInBackground(guild, sessionId, {
            organizationId: config?.organizationId,
            fastMessageRefresh: true,
            skipFullSync: true,
            delayMs: 0,
          });
          this.cleanScrimRolesInBackground(
            guild,
            sessionId,
            "reconcile",
            1_500,
            {
              fetchAllGuildMembers: true,
            },
          );
          return `${this.emoji(
            "reject",
            config,
          )} No waitlist teams to clean. Waitlist display and scrim role reconciliation queued from the database.${
            staleSummary ? ` ${staleSummary}.` : ""
          }`;
        }
        return `${this.emoji(
          "reject",
          config,
        )} No waitlist teams to clean.${staleSummary ? ` ${staleSummary}.` : ""}`;
      }

      const removed: SessionRegistrationResponse[] = [];
      let failed = 0;
      for (const registration of waitlistRegistrations) {
        try {
          const result = await this.apiClient.removeRegistration(
            sessionId,
            registration.id,
            {
              removalReason: "Cleaned waitlist via Discord bot",
            },
          );
          removed.push(result.removedRegistration);
        } catch (error) {
          failed += 1;
          console.warn(
            `[DiscordCleanup] clean waitlist failed session=${sessionId} registration=${registration.id}: ${String(
              error,
            )}`,
          );
        }
      }

      const removedTeamIds = this.uniqueStrings(
        removed.map((registration) => registration.teamId),
      );
      const removedDiscordUserIds = this.uniqueStrings(
        removed.flatMap((registration) => [
          registration.leaderDiscordUserId,
          ...(registration.managerDiscordUserIds ?? []),
        ]),
      );
      const staleCleanup = await this.cleanupStaleWaitlistDiscordState(
        guild,
        config,
        removedDiscordUserIds,
      );
      this.syncDiscordScrimStateInBackground(guild, sessionId, {
        organizationId: config?.organizationId,
        removedTeamIds,
        extraDiscordUserIds: removedDiscordUserIds,
        cleanupTeamIds: removedTeamIds,
        fastMessageRefresh: true,
        skipFullSync: true,
        delayMs: 0,
      });
      this.reconcileScrimRolesInBackground(guild, sessionId);

      const waitlistPositions = waitlistRegistrations
        .map((registration) => registration.waitlistPosition)
        .filter((position): position is number => position !== null)
        .sort((left, right) => left - right);
      const waitlistSummary =
        waitlistPositions.length <= 10
          ? waitlistPositions.map((position) => `#${position}`).join(", ")
          : `${waitlistPositions.length} waitlist entries`;

      void this.sendDiscordActionLog(guild, config, {
        action: "Waitlist cleaned",
        actorDiscordId: audit.actorDiscordId,
        actorLabel: audit.actorLabel,
        sourceChannelId: audit.sourceChannelId,
        sessionId,
        sessionName: audit.sessionName,
        status: `${removed.length} team(s) removed`,
        details: [
          `Waitlist: ${waitlistSummary}`,
          "Assigned slot teams were kept.",
          "Discord refresh, role reconciliation, and roster release queued.",
          this.waitlistDiscordStateCleanupSummary(staleCleanup),
          failed > 0 ? `Failed removals: ${failed}` : "",
        ].filter(Boolean),
        color: failed > 0 ? 0xf59e0b : 0xef4444,
      }).catch((error) => {
        console.warn(
          `Discord action log failed for clean waitlist ${sessionId}: ${String(
            error,
          )}`,
        );
      });

      const failedNote =
        failed > 0 ? ` ${failed} waitlist removal(s) failed.` : "";
      const staleSummary =
        this.waitlistDiscordStateCleanupSummary(staleCleanup);
      return `${this.emoji(
        "reject",
        config,
      )} Cleaned waitlist (${waitlistSummary}): ${removed.length} team${
        removed.length === 1 ? "" : "s"
      } removed. Assigned slot teams were kept. Discord refresh, role reconciliation, and roster release queued.${
        staleSummary ? ` ${staleSummary}.` : ""
      }${failedNote}`;
    } catch (error) {
      throw new Error(toFriendlyApiError(error));
    }
  }

  async cleanAllSlotsFromScrim(
    sessionId: string,
    guild?: Guild | null,
    audit: DiscordActionAuditContext = {},
  ): Promise<string> {
    try {
      const [result, config] = await Promise.all([
        this.apiClient.removeSlotRegistrations(sessionId),
        this.apiClient.getSessionDiscordConfig(sessionId).catch(() => null),
      ]);
      const removed = result.removedRegistrations ?? [];
      const resultResetNote = this.formatResultResetNote(result.resultReset);
      if (!removed.length) {
        if (guild) {
          this.syncDiscordScrimStateInBackground(guild, sessionId, {
            organizationId: config?.organizationId,
            fastMessageRefresh: true,
            skipFullSync: true,
            delayMs: 0,
          });
          this.cleanScrimRolesInBackground(
            guild,
            sessionId,
            "reconcile",
            1_500,
            {
              fetchAllGuildMembers: true,
            },
          );
          return `${this.emoji(
            "reject",
            config,
          )} No assigned slots to clean. ${resultResetNote} Slot list and scrim role reconciliation queued from the database.`;
        }
        return `${this.emoji(
          "reject",
          config,
        )} No assigned slots to clean. ${resultResetNote}`;
      }

      const teamIds = result.removedTeamIds?.length
        ? result.removedTeamIds
        : removed.map((registration) => registration.teamId);
      this.syncDiscordScrimStateInBackground(guild, sessionId, {
        organizationId: config?.organizationId,
        removedTeamIds: teamIds,
        extraDiscordUserIds: this.registrationRoleSyncDiscordUserIds(removed),
        cleanupTeamIds: teamIds,
        fastMessageRefresh: true,
        skipFullSync: true,
        delayMs: 0,
      });
      this.reconcileScrimRolesInBackground(guild, sessionId);
      const slotNumbers = (
        result.removedSlots?.length
          ? result.removedSlots
          : removed.map((registration) => registration.slotNumber)
      )
        .filter((slotNumber): slotNumber is number => slotNumber !== null)
        .sort((left, right) => left - right);
      const slotSummary =
        slotNumbers.length <= 10
          ? slotNumbers.map((slotNumber) => `#${slotNumber}`).join(", ")
          : `${slotNumbers.length} slots`;

      void this.sendDiscordActionLog(guild, config, {
        action: "All slots cleaned",
        actorDiscordId: audit.actorDiscordId,
        actorLabel: audit.actorLabel,
        sourceChannelId: audit.sourceChannelId,
        sessionId,
        sessionName: audit.sessionName,
        status: `${removed.length} team(s) removed`,
        details: [
          `Slots: ${slotSummary}`,
          resultResetNote,
          "Discord refresh, role reconciliation, and roster release queued.",
          "Waitlist entries were kept.",
        ],
        color: 0xf59e0b,
      }).catch((error) => {
        console.warn(
          `Discord action log failed for clean all slots ${sessionId}: ${String(
            error,
          )}`,
        );
      });

      return `${this.emoji("reject", config)} Cleaned all assigned slots (${slotSummary}): ${removed.length} team${
        removed.length === 1 ? "" : "s"
      } removed. ${resultResetNote} Discord refresh, role reconciliation, and roster release queued. Waitlist entries were kept.`;
    } catch (error) {
      throw new Error(toFriendlyApiError(error));
    }
  }

  async updateRegistrationPlacement(
    sessionId: string,
    registrationId: string,
    payload: UpdateRegistrationPlacementPayload | { action: "REMOVE" },
    guild?: Guild | null,
    audit: DiscordActionAuditContext = {},
  ): Promise<string> {
    try {
      const config = await this.apiClient
        .getSessionDiscordConfig(sessionId)
        .catch(() => null);
      if (payload.action === "REMOVE") {
        const result = await this.apiClient
          .removeRegistration(sessionId, registrationId)
          .catch((error) => {
            throw this.staleRegistrationControlError(error, config);
          });
        const removedRoleSyncUserIds = this.registrationRoleSyncDiscordUserIds([
          result.removedRegistration,
        ]);
        const promotedRoleSynced = result.promotedRegistration
          ? await this.syncSessionRegistrationAccessRolesNow(
              guild,
              sessionId,
              result.promotedRegistration,
              "remove placement promoted team",
            )
          : false;
        this.syncDiscordScrimStateInBackground(guild, sessionId, {
          organizationId: config?.organizationId,
          removedTeamIds: [result.removedRegistration.teamId],
          activeTeamIds:
            result.promotedRegistration && !promotedRoleSynced
              ? [result.promotedRegistration.teamId]
              : [],
          extraDiscordUserIds: removedRoleSyncUserIds,
          cleanupTeamIds: [result.removedRegistration.teamId],
          fastMessageRefresh: true,
          skipFullSync: true,
          delayMs: 0,
        });
        this.reconcileScrimRolesInBackground(guild, sessionId);
        await this.sendDiscordActionLog(guild, config, {
          action: "Team cancelled",
          actorDiscordId: audit.actorDiscordId,
          actorLabel: audit.actorLabel,
          sourceChannelId: audit.sourceChannelId,
          sessionId,
          sessionName: audit.sessionName,
          team: result.removedRegistration.team,
          slot: result.removedRegistration.slotNumber,
          status: "removed",
          details: result.promotedRegistration
            ? `Promoted: ${this.resolveTeamLabel(result.promotedRegistration)}`
            : null,
          color: 0xf59e0b,
        });
        const lines = [this.formatRemovalConfirmation(config)];
        if (result.promotedRegistration) {
          const session = await this.apiClient.getSession(sessionId);
          lines.push(
            "",
            this.formatPlacementConfirmation(
              session,
              result.promotedRegistration,
              config,
            ),
          );
        }
        return lines.join("\n");
      }

      const [session, resolvedConfig] = await Promise.all([
        this.apiClient.getSession(sessionId),
        config ?? this.apiClient.getSessionDiscordConfig(sessionId),
      ]);
      const registration = await this.apiClient
        .updateRegistrationPlacement(sessionId, registrationId, payload)
        .catch((error) => {
          throw this.staleRegistrationControlError(error, resolvedConfig);
        });
      const roleSynced = await this.syncSessionRegistrationAccessRolesNow(
        guild,
        sessionId,
        registration,
        "placement update immediate",
      );
      this.syncDiscordScrimStateInBackground(guild, sessionId, {
        organizationId: resolvedConfig.organizationId,
        activeTeamIds: roleSynced ? [] : [registration.teamId],
        fastMessageRefresh: true,
        skipFullSync: true,
        delayMs: 0,
      });
      await this.sendDiscordActionLog(guild, resolvedConfig, {
        action:
          payload.action === "SLOT"
            ? "Team moved to slot"
            : payload.action === "VIP"
              ? "Team moved to VIP"
              : payload.action === "WAITLIST"
                ? "Team moved to waitlist"
                : "Team registration approved",
        actorDiscordId: audit.actorDiscordId,
        actorLabel: audit.actorLabel,
        sourceChannelId: audit.sourceChannelId,
        sessionId,
        sessionName: audit.sessionName ?? session.name,
        team: registration.team,
        slot:
          registration.slotNumber ??
          (registration.waitlistPosition
            ? `waitlist #${registration.waitlistPosition}`
            : null),
        status: this.registrationActionLogStatus(registration),
        color: 0x22c55e,
      });
      return this.formatPlacementConfirmation(
        session,
        registration,
        resolvedConfig,
      );
    } catch (error) {
      throw new Error(toFriendlyApiError(error));
    }
  }

  private staleRegistrationControlError(
    error: unknown,
    config: SessionDiscordConfigResponse | null,
  ) {
    const friendly = toFriendlyApiError(error);
    if (/requested resource not found|registration not found/i.test(friendly)) {
      return new Error(
        `${this.emoji(
          "warning",
          config,
        )} This waitlist/control panel is out of date. Refresh the panel and try again.`,
      );
    }
    return error instanceof Error ? error : new Error(friendly);
  }

  private playStatusCandidateRegistrations(
    registrations: SessionRegistrationResponse[],
  ) {
    return registrations.filter(
      (registration) =>
        this.activeRegistrationStatus(registration) &&
        (registration.status === "CONFIRMED" ||
          registration.status === "CHECKED_IN") &&
        registration.slotNumber !== null,
    ) as Array<SessionRegistrationResponse & { slotNumber: number }>;
  }

  private truncateDiscordOptionText(value: string, maxLength = 100) {
    const text = value.trim();
    if (text.length <= maxLength) {
      return text;
    }
    return `${text.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
  }

  private playStatusTargetsForDiscordUser(
    registrations: Array<SessionRegistrationResponse & { slotNumber: number }>,
    memberCache: Map<string, TeamMemberSummary[]>,
    discordUserId: string,
    action?: RegistrationPlayStatusAction,
  ): RegistrationPlayStatusTarget[] {
    return registrations
      .filter((registration) =>
        (memberCache.get(registration.teamId) ?? []).some(
          (member) =>
            this.isActiveMember(member) &&
            member.discordUserId === discordUserId,
        ),
      )
      .filter(
        (registration) =>
          !action ||
          this.registrationNeedsPlayStatusAction(registration, action),
      )
      .sort((left, right) => left.slotNumber - right.slotNumber)
      .map((registration) => {
        const teamLabel = this.formatTeamSummary(registration.team);
        return {
          registrationId: registration.id,
          teamId: registration.teamId,
          teamLabel,
          slotNumber: registration.slotNumber,
          optionLabel: this.truncateDiscordOptionText(
            `Slot #${registration.slotNumber} - ${teamLabel}`,
          ),
          optionDescription: this.truncateDiscordOptionText(
            `Apply only ${teamLabel}`,
          ),
        };
      });
  }

  private registrationNeedsPlayStatusAction(
    registration: Pick<SessionRegistrationResponse, "note">,
    action: RegistrationPlayStatusAction,
  ) {
    const currentStatus = this.registrationPlayStatus(registration)?.status;
    if (action === "CLEAR") {
      return Boolean(currentStatus);
    }
    return currentStatus !== action;
  }

  private playStatusAlreadyAppliedContent(
    action: RegistrationPlayStatusAction,
    config: SessionDiscordConfigResponse | null,
  ) {
    if (action === "NOT_PLAYING") {
      return `${this.emoji("reject", config)} All your teams are already marked not playing.`;
    }
    if (action === "CLEAR") {
      return `${this.emoji("warning", config)} Your teams do not have a play status to clear.`;
    }
    return `${this.emoji("check", config)} All your teams are already confirmed.`;
  }

  private playStatusMultipleChoiceContent(
    action: RegistrationPlayStatusAction,
  ) {
    const actionLabel =
      action === "NOT_PLAYING" ? "mark as not playing" : "confirm";
    return `You manage multiple teams in this scrim. Choose which team to ${actionLabel}.`;
  }

  private formatPlayStatusUpdateResult(
    action: RegistrationPlayStatusAction,
    registrations: SessionRegistrationResponse[],
    config: SessionDiscordConfigResponse | null,
  ) {
    const prefix =
      action === "NOT_PLAYING"
        ? this.emoji("reject", config)
        : this.emoji("check", config);
    const verb = action === "NOT_PLAYING" ? "Marked not playing" : "Confirmed";
    const targets = registrations.map((registration) => {
      const slot = registration.slotNumber
        ? `slot #${registration.slotNumber}`
        : "assigned slot";
      return `${slot} for ${this.formatTeamSummary(registration.team)}`;
    });

    if (targets.length <= 1) {
      return `${prefix} ${verb} ${targets[0] ?? "this team"}.`;
    }

    return [
      `${prefix} ${verb} ${targets.length} teams:`,
      ...targets.map((target) => `- ${target}`),
    ].join("\n");
  }

  async resolveRegistrationPlayStatusTargets(
    sessionId: string,
    discordUserId: string,
    action: RegistrationPlayStatusAction,
  ): Promise<RegistrationPlayStatusTargetResolution> {
    try {
      const [registrations, config] = await Promise.all([
        this.apiClient.listRegistrations(sessionId),
        this.apiClient.getSessionDiscordConfig(sessionId).catch(() => null),
      ]);
      const windowMessage = playConfirmationWindowRejectMessage(config);
      if (windowMessage) {
        return {
          kind: "blocked",
          content: `${this.emoji("warning", config)} ${windowMessage}`,
        };
      }

      const candidates = this.playStatusCandidateRegistrations(registrations);
      const memberCache = await this.loadTeamMembersForSync(
        candidates.map((registration) => registration.teamId),
      );
      const targets = this.playStatusTargetsForDiscordUser(
        candidates,
        memberCache,
        discordUserId,
      );
      if (targets.length === 0) {
        return {
          kind: "blocked",
          content: `${this.emoji("reject", config)} You are not registered in a slot for this scrim.`,
        };
      }
      const actionableTargets = this.playStatusTargetsForDiscordUser(
        candidates,
        memberCache,
        discordUserId,
        action,
      );
      if (actionableTargets.length === 0) {
        return {
          kind: "blocked",
          content: this.playStatusAlreadyAppliedContent(action, config),
        };
      }
      if (actionableTargets.length === 1) {
        return {
          kind: "single",
          target: actionableTargets[0],
        };
      }
      return {
        kind: "multiple",
        content: this.playStatusMultipleChoiceContent(action),
        targets: actionableTargets,
      };
    } catch (error) {
      throw new Error(toFriendlyApiError(error));
    }
  }

  async updateRegistrationPlayStatus(
    sessionId: string,
    discordUserId: string,
    discordUsername: string | null,
    action: RegistrationPlayStatusAction,
    guild?: Guild | null,
    audit: DiscordActionAuditContext = {},
    options: UpdateRegistrationPlayStatusOptions = {},
  ): Promise<string> {
    try {
      const [session, registrations, config] = await Promise.all([
        this.apiClient.getSession(sessionId),
        this.apiClient.listRegistrations(sessionId),
        this.apiClient.getSessionDiscordConfig(sessionId).catch(() => null),
      ]);
      const windowMessage = playConfirmationWindowRejectMessage(config);
      if (windowMessage) {
        return `${this.emoji("warning", config)} ${windowMessage}`;
      }

      const candidates = this.playStatusCandidateRegistrations(registrations);
      const memberCache = await this.loadTeamMembersForSync(
        candidates.map((registration) => registration.teamId),
      );
      const targets = this.playStatusTargetsForDiscordUser(
        candidates,
        memberCache,
        discordUserId,
      );
      if (targets.length === 0) {
        return `${this.emoji("reject", config)} You are not registered in a slot for this scrim.`;
      }
      const actionableTargets = this.playStatusTargetsForDiscordUser(
        candidates,
        memberCache,
        discordUserId,
        action,
      );
      if (actionableTargets.length === 0) {
        return this.playStatusAlreadyAppliedContent(action, config);
      }

      const selectedTargets = options.applyAll
        ? actionableTargets
        : options.registrationId
          ? actionableTargets.filter(
              (target) => target.registrationId === options.registrationId,
            )
          : [actionableTargets[0]];
      if (selectedTargets.length === 0) {
        return `${this.emoji("reject", config)} That team is no longer available for this confirmation.`;
      }

      const updatedRegistrations: SessionRegistrationResponse[] = [];
      for (const target of selectedTargets) {
        const updatedRegistration =
          await this.apiClient.updateRegistrationPlayStatus(
            sessionId,
            target.registrationId,
            {
              action,
              discordUserId,
              discordUsername: discordUsername ?? undefined,
            },
          );
        updatedRegistrations.push(updatedRegistration);
      }

      const updatedById = new Map(
        updatedRegistrations.map((registration) => [
          registration.id,
          registration,
        ]),
      );
      const nextRegistrations = registrations.map(
        (item) => updatedById.get(item.id) ?? item,
      );
      const fastUpdated = await this.syncSlotListMessageFast(
        guild,
        session,
        nextRegistrations,
        config,
      );
      this.syncDiscordScrimStateInBackground(guild, sessionId, {
        organizationId: config?.organizationId,
        delayMs: fastUpdated
          ? PLAY_STATUS_BACKGROUND_SYNC_DELAY_MS
          : BACKGROUND_SYNC_DELAY_MS,
      });
      for (const updatedRegistration of updatedRegistrations) {
        await this.sendDiscordActionLog(guild, config, {
          action:
            action === "NOT_PLAYING"
              ? "Team marked not playing"
              : "Team confirmed playing",
          actorDiscordId: discordUserId,
          actorLabel: audit.actorLabel ?? discordUsername,
          sourceChannelId: audit.sourceChannelId,
          sessionName: audit.sessionName ?? session.name,
          sessionId,
          team: updatedRegistration.team,
          slot: updatedRegistration.slotNumber,
          status: action === "NOT_PLAYING" ? "cancelled" : "confirmed",
          color: action === "NOT_PLAYING" ? 0xef4444 : 0x22c55e,
        });
      }
      return this.formatPlayStatusUpdateResult(
        action,
        updatedRegistrations,
        config,
      );
    } catch (error) {
      throw new Error(toFriendlyApiError(error));
    }
  }

  async confirmSlotFromDiscord(
    requesterDiscordId: string,
    requesterLabel: string | null,
    slotNumber: number,
    guild: Guild | null | undefined,
    sessionId: string,
    audit: DiscordActionAuditContext = {},
  ): Promise<string> {
    if (!Number.isInteger(slotNumber) || slotNumber < 1) {
      return `${this.emoji("reject")} Use a valid slot number, for example %confirm 22.`;
    }

    try {
      const [session, registrations, config] = await Promise.all([
        this.apiClient.getSession(sessionId),
        this.apiClient.listRegistrations(sessionId),
        this.apiClient.getSessionDiscordConfig(sessionId).catch(() => null),
      ]);

      if (!["OPEN", "CHECKIN", "LOCKED", "LIVE"].includes(session.status)) {
        return `${this.emoji("warning", config)} This scrim is no longer accepting slot confirmations.`;
      }

      const registration = registrations.find(
        (candidate) =>
          this.activeRegistrationStatus(candidate) &&
          (candidate.status === "CONFIRMED" ||
            candidate.status === "CHECKED_IN") &&
          candidate.slotNumber === slotNumber,
      );
      if (!registration) {
        return `${this.emoji("reject", config)} No confirmed team is assigned to slot #${slotNumber}.`;
      }

      const staffBypass = await this.requesterHasStaffAccess(
        requesterDiscordId,
        guild ?? null,
        config,
      );
      if (!staffBypass) {
        const windowMessage = playConfirmationWindowRejectMessage(config);
        if (windowMessage) {
          return `${this.emoji("warning", config)} ${windowMessage}`;
        }

        const memberCache = await this.loadTeamMembersForSync([
          registration.teamId,
        ]);
        const canConfirmOwnSlot = (memberCache.get(registration.teamId) ?? [])
          .filter((member) => this.isActiveLeaderMember(member))
          .some((member) => member.discordUserId === requesterDiscordId);
        if (!canConfirmOwnSlot) {
          return `${this.emoji("reject", config)} Only staff or this slot's team managers can confirm slot #${slotNumber}.`;
        }
      }

      const updatedRegistration =
        await this.apiClient.updateRegistrationPlayStatus(
          sessionId,
          registration.id,
          {
            action: "CONFIRM",
            discordUserId: requesterDiscordId,
            discordUsername: requesterLabel ?? undefined,
          },
        );

      const nextRegistrations = registrations.map((item) =>
        item.id === updatedRegistration.id ? updatedRegistration : item,
      );
      const fastUpdated = await this.syncSlotListMessageFast(
        guild,
        session,
        nextRegistrations,
        config,
      );
      this.syncDiscordScrimStateInBackground(guild, sessionId, {
        organizationId: config?.organizationId,
        delayMs: fastUpdated
          ? PLAY_STATUS_BACKGROUND_SYNC_DELAY_MS
          : BACKGROUND_SYNC_DELAY_MS,
      });
      await this.sendDiscordActionLog(guild, config, {
        action: staffBypass
          ? "Staff confirmed team playing"
          : "Team confirmed playing",
        actorDiscordId: audit.actorDiscordId ?? requesterDiscordId,
        actorLabel: audit.actorLabel ?? requesterLabel,
        sourceChannelId: audit.sourceChannelId,
        sessionName: audit.sessionName ?? session.name,
        sessionId,
        team: updatedRegistration.team ?? registration.team,
        slot: updatedRegistration.slotNumber ?? registration.slotNumber,
        status: "confirmed",
        color: 0x22c55e,
      });

      const team = this.formatTeamSummary(
        updatedRegistration.team ?? registration.team,
      );
      return `${this.emoji("check", config)} Confirmed slot #${slotNumber} for ${team}.`;
    } catch (error) {
      throw new Error(toFriendlyApiError(error));
    }
  }

  async postIdpToDiscord(
    guild: Guild,
    sessionId: string,
    embed: EmbedBuilder,
  ): Promise<string> {
    try {
      const [session, config] = await Promise.all([
        this.apiClient.getSession(sessionId),
        this.apiClient.getSessionDiscordConfig(sessionId),
      ]);
      const setup = await this.scrimDiscordSetup.ensureSetup(
        guild,
        session,
        config,
      );
      await this.persistDiscordSetupConfig(session.id, setup, guild.id, config);
      const channel = await this.scrimDiscordSetup.sendIdp(guild, setup, embed);
      return `${this.emoji("check", config)} IDP posted in <#${channel.id}>`;
    } catch (error) {
      throw new Error(toFriendlyApiError(error));
    }
  }

  async listSlots(
    sessionId: string,
    guild: Guild | null | undefined = null,
  ): Promise<string> {
    try {
      const [session, registrations, config] = await Promise.all([
        this.apiClient.getSession(sessionId),
        this.apiClient.listRegistrations(sessionId),
        this.apiClient.getSessionDiscordConfig(sessionId),
      ]);
      const memberCache = await this.loadTeamMembersForSync(
        registrations
          .filter((registration) => this.activeRegistrationStatus(registration))
          .map((registration) => registration.teamId),
      );
      const managerMentionByTeamId = await this.managerMentionByTeamIdForGuild(
        guild,
        registrations,
        memberCache,
      );
      const sorted = this.sortBySlotOrWaitlist(registrations);
      const range = this.slotRangeForSession(session, config);
      const vipRange = this.vipRangeForSession(session, config, range);
      const confirmed = sorted
        .filter(
          (
            registration,
          ): registration is SessionRegistrationResponse & {
            slotNumber: number;
          } =>
            registration.slotNumber !== null &&
            registration.slotNumber >= range.startSlot &&
            registration.slotNumber <= range.endSlot,
        )
        .sort((left, right) => left.slotNumber - right.slotNumber);
      const confirmedBySlot = new Map(
        confirmed.map((registration) => [
          registration.slotNumber,
          registration,
        ]),
      );
      const vipConfirmed = sorted
        .filter(
          (
            registration,
          ): registration is SessionRegistrationResponse & {
            slotNumber: number;
          } =>
            registration.slotNumber !== null &&
            registration.slotNumber >= vipRange.startSlot &&
            registration.slotNumber <= vipRange.endSlot,
        )
        .sort((left, right) => left.slotNumber - right.slotNumber);
      const vipBySlot = new Map(
        vipConfirmed.map((registration) => [
          registration.slotNumber,
          registration,
        ]),
      );
      const waitlist = sorted
        .filter(
          (
            registration,
          ): registration is SessionRegistrationResponse & {
            waitlistPosition: number;
          } => registration.waitlistPosition !== null,
        )
        .sort((left, right) => left.waitlistPosition - right.waitlistPosition);

      const assignableSlots = Math.max(0, range.endSlot - range.startSlot + 1);
      const empty = `${this.emoji("empty", config)} EMPTY`;
      const title =
        vipRange.capacity > 0
          ? `${this.emoji("slot", config)} SLOTS (${confirmed.length}/${assignableSlots}) | ${this.emoji("vip", config)} VIP ${vipConfirmed.length}/${vipRange.capacity}`
          : `${this.emoji("slot", config)} SLOTS (${confirmed.length}/${assignableSlots})`;
      const lines = [title, ""];

      if (assignableSlots === 0) {
        lines.push("No assignable slots are configured.");
      }

      for (let slot = range.startSlot; slot <= range.endSlot; slot += 1) {
        const registration = confirmedBySlot.get(slot);
        const rowMarker = slotListMarker({ slotNumber: slot, config });
        lines.push(
          `${rowMarker} ${
            registration
              ? this.formatTeamSlotRow(
                  registration,
                  managerMentionByTeamId.get(registration.teamId),
                )
              : empty
          }`,
        );
      }

      for (let vip = 1; vip <= vipRange.capacity; vip += 1) {
        const slot = vipRange.startSlot + vip - 1;
        const registration = vipBySlot.get(slot);
        const rowMarker = slotListMarker({
          slotNumber: slot,
          config,
          vipIndex: vip,
        });
        lines.push(
          `${rowMarker} ${
            registration
              ? this.formatTeamSlotRow(
                  registration,
                  managerMentionByTeamId.get(registration.teamId),
                )
              : empty
          }`,
        );
      }

      lines.push(
        "",
        `${this.emoji("waitlist", config)} WAITLIST (${waitlist.length})`,
        "",
      );

      if (waitlist.length === 0) {
        lines.push(`${this.emoji("empty", config)} None`);
      } else {
        lines.push(
          ...waitlist.map(
            (registration) =>
              `${this.emoji("waitlist", config)} ${registration.waitlistPosition}. ${this.formatTeamSlotRow(
                registration,
                managerMentionByTeamId.get(registration.teamId),
              )}`,
          ),
        );
      }

      return lines.join("\n");
    } catch (error) {
      throw new Error(toFriendlyApiError(error));
    }
  }

  async startScrim(
    requesterDiscordId: string,
    sessionId: string,
    opts: { allowOrganizerOverride?: boolean } = {},
  ): Promise<string> {
    const config = await this.apiClient
      .getSessionDiscordConfig(sessionId)
      .catch(() => null);
    const creatorDiscordId = this.sessionCreatorById.get(sessionId) ?? null;
    if (
      !opts.allowOrganizerOverride &&
      (!creatorDiscordId || creatorDiscordId !== requesterDiscordId)
    ) {
      return `${this.emoji("reject", config)} Only session creator can start the scrim`;
    }

    try {
      const match = await this.apiClient.createSessionMatch(sessionId);
      return `${this.emoji("fire", config)} Scrim match created\n\nMatch ID: ${match.id}\n\nUse this match to submit results after play.`;
    } catch (error) {
      throw new Error(toFriendlyApiError(error));
    }
  }

  async standings(sessionId: string): Promise<string> {
    try {
      const [standings, config] = await Promise.all([
        this.apiClient.getSessionStandings(sessionId),
        this.apiClient.getSessionDiscordConfig(sessionId).catch(() => null),
      ]);
      if (standings.teams.length === 0) {
        return `${this.emoji("chart", config)} STANDINGS\n\nNo completed session matches yet.`;
      }

      const lines = [`${this.emoji("chart", config)} STANDINGS`, ""];
      lines.push(
        ...standings.teams.map(
          (team) =>
            `${team.rank}. ${team.tag ?? team.teamId} ${EM_DASH} ${team.totalPoints} pts`,
        ),
      );

      return lines.join("\n");
    } catch (error) {
      throw new Error(toFriendlyApiError(error));
    }
  }

  async previewResults(matchId: string, imageUrl: string): Promise<string> {
    try {
      const preview = await this.apiClient.previewScreenshotResults({
        matchId,
        imageUrl,
      });
      return this.formatPreview(preview);
    } catch (error) {
      throw new Error(toFriendlyApiError(error));
    }
  }

  private normalizeScreenshotImageUrls(imageInput: string | string[]) {
    return [
      ...new Set(
        (Array.isArray(imageInput) ? imageInput : [imageInput])
          .map((url) => url.trim())
          .filter(Boolean),
      ),
    ];
  }

  async mapSlotsForResults(
    matchId: string,
    imageInput: string | string[],
  ): Promise<string> {
    try {
      const imageUrls = this.normalizeScreenshotImageUrls(imageInput);
      const preview = await this.apiClient.mapScreenshotSlots({
        matchId,
        imageUrl: imageUrls[0],
        imageUrls,
      });
      return this.formatSlotMapPreview(preview);
    } catch (error) {
      throw new Error(toFriendlyApiError(error));
    }
  }

  async previewAutomaticResultScreenshot(
    sessionId: string,
    imageInput: string | string[],
    mode: AutomaticResultScreenshotMode,
    config?: Pick<SessionDiscordConfigResponse, "emojis"> | null,
    options: AutomaticResultScreenshotOptions = {},
  ): Promise<AutomaticResultPreviewResponse> {
    try {
      const imageUrls = this.normalizeScreenshotImageUrls(imageInput);
      const imageUrl = imageUrls[0] ?? "";
      const resolvedMatch = await this.resolveResultMatch(sessionId, options);
      const match = resolvedMatch.match;
      const matchLabel = this.formatSessionMatch(match);
      const gameCodeLine = options.matchNumber
        ? `Game code: G${options.matchNumber}`
        : null;
      const createdLine = resolvedMatch.created
        ? "Created match from this screenshot code."
        : null;

      if (mode === "slot-map") {
        const content = await this.mapSlotsForResults(match.id, imageUrls);
        return {
          sessionId,
          matchId: match.id,
          matchLabel,
          imageUrl,
          imageUrls,
          mode,
          content: [
            `${this.emoji("camera", config)} Automatic slot map`,
            `Match: ${matchLabel}`,
            gameCodeLine,
            createdLine,
            "",
            content,
          ]
            .filter((line): line is string => line !== null)
            .join("\n"),
          canApply: false,
        };
      }

      const preview = await this.apiClient.previewScreenshotResults({
        matchId: match.id,
        imageUrl,
        imageUrls,
      });
      const slots = preview.slots?.length
        ? preview.slots
        : await this.apiClient
            .listMatchSlots(match.id)
            .catch(() => [] as MatchSlotResponse[]);
      const canApply =
        preview.preview.length > 0 &&
        preview.unresolved.length === 0 &&
        preview.ambiguous.length === 0;
      const instruction = canApply
        ? "Click Apply Results if this preview is correct."
        : "Send a clearer final result screenshot if teams are unresolved.";

      return {
        sessionId,
        matchId: match.id,
        matchLabel,
        imageUrl,
        imageUrls,
        mode,
        content: [
          `${this.emoji("camera", config)} Automatic result preview`,
          `Match: ${matchLabel}`,
          gameCodeLine,
          createdLine,
          "Slot source: official scrim slot list",
          "",
          this.formatPreview(preview, {
            title: `${this.emoji("camera", config)} RESULT PREVIEW`,
            includeInstruction: false,
            config,
          }),
          "",
          instruction,
        ]
          .filter((line): line is string => line !== null)
          .join("\n"),
        canApply,
        preview,
        slots,
      };
    } catch (error) {
      throw new Error(toFriendlyApiError(error));
    }
  }

  async applyResults(
    matchId: string,
    imageUrl: string,
  ): Promise<ApplyResultsDiscordResponse> {
    try {
      const preview = await this.apiClient.previewScreenshotResults({
        matchId,
        imageUrl,
      });

      if (!preview.preview.length) {
        return {
          content: `${this.emoji("reject")} No usable result rows detected from screenshot`,
        };
      }

      if (preview.unresolved.length > 0 || preview.ambiguous.length > 0) {
        return {
          content: [
            `${this.emoji("reject")} Cannot apply results yet`,
            "",
            this.formatPreview(preview, {
              title: `${this.emoji("camera")} RESULT PREVIEW`,
              includeInstruction: false,
            }),
            "",
            "Resolve the preview issues and run /apply-results again.",
          ].join("\n"),
        };
      }

      const applyPayload = this.buildApplyPayload(preview);
      const applied = await this.apiClient.applyScreenshotResults(applyPayload);
      const config = preview.sessionId
        ? await this.apiClient
            .getSessionDiscordConfig(preview.sessionId)
            .catch(() => null)
        : null;
      const topResults = applied.summary?.length
        ? this.resultSummaryLines(applied.summary, config)
        : this.topResultLines(preview, config);
      const lines = [`${this.emoji("check")} Results applied`];

      if (topResults.length > 0) {
        lines.push("", this.resultSummaryTitle(config), ...topResults);
      }

      const imageFiles = await this.buildResultImageFiles(matchId);
      if (imageFiles.length > 0) {
        return {
          content: lines.join("\n"),
          imageBuffer: imageFiles[0]?.buffer,
          imageFiles,
        };
      }

      const fallbackLines = [
        `${this.emoji("check")} Results applied (image generation failed)`,
      ];
      if (lines.length > 1) {
        fallbackLines.push("", ...lines.slice(1));
      }
      return {
        content: fallbackLines.join("\n"),
      };
    } catch (error) {
      throw new Error(toFriendlyApiError(error));
    }
  }

  async applyReviewedResults(
    matchId: string,
    rows: ReviewedResultRow[],
    config?: Pick<SessionDiscordConfigResponse, "emojis"> | null,
    opts: { markMissingSlotsNoShow?: boolean } = {},
  ): Promise<ApplyResultsDiscordResponse> {
    try {
      const included = rows.filter((row) => row.include);
      if (!included.length) {
        return {
          content: `${this.emoji("reject")} No reviewed result rows selected.`,
        };
      }

      const invalid = included.filter(
        (row) =>
          row.status !== "OK" ||
          !row.teamId ||
          !row.slotId ||
          !Number.isInteger(row.position) ||
          row.position < 1 ||
          !Number.isInteger(row.kills) ||
          row.kills < 0,
      );
      if (invalid.length) {
        return {
          content: [
            `${this.emoji("reject")} Cannot apply results yet`,
            "",
            "Edit or skip rows that do not have a valid placement, kills, and slot.",
          ].join("\n"),
        };
      }

      const applied = await this.apiClient.applyScreenshotResults(
        this.buildReviewedApplyPayload(matchId, rows, opts),
      );
      const topResults = applied.summary?.length
        ? this.resultSummaryLines(applied.summary, config)
        : this.resultSummaryLines(included, config);
      const skippedCount = rows.length - included.length;
      const lines = [
        `${this.emoji("check")} Reviewed results applied`,
        "",
        `Rows applied: ${applied.updatedCount}`,
      ];

      if (skippedCount > 0) {
        lines.push(`Rows skipped: ${skippedCount}`);
      }
      if (opts.markMissingSlotsNoShow) {
        lines.push(`Ban candidates counted: ${applied.noShowCount ?? 0}`);
      }

      if (topResults.length > 0) {
        lines.push("", this.resultSummaryTitle(config), ...topResults);
      }
      const publicLines =
        topResults.length > 0
          ? [this.resultSummaryTitle(config), ...topResults]
          : [this.resultSummaryTitle(config)];

      const imageFiles = await this.buildResultImageFiles(matchId);
      if (imageFiles.length > 0) {
        return {
          content: lines.join("\n"),
          publicContent: publicLines.join("\n"),
          noShowCount: applied.noShowCount ?? 0,
          imageBuffer: imageFiles[0]?.buffer,
          imageFiles,
        };
      }

      return {
        content: lines.join("\n"),
        publicContent: publicLines.join("\n"),
        noShowCount: applied.noShowCount ?? 0,
      };
    } catch (error) {
      throw new Error(toFriendlyApiError(error));
    }
  }

  async applyFinalNoShowAutoBansFromDiscord(
    input: { matchId: string; sessionId: string },
    guild?: Guild | null,
    config?: SessionDiscordConfigResponse | null,
  ): Promise<ApplyNoShowAutoBansResponse> {
    try {
      const response = await this.apiClient.applyNoShowAutoBansForMatch(
        input.matchId,
      );
      const managerTargets = this.uniqueStrings([
        ...(response.createdManagerDiscordUserIds ?? []),
        ...(response.createdBans ?? []).flatMap(
          (ban) => ban.managerDiscordUserIds ?? [],
        ),
      ]).map((discordUserId) => ({
        discordUserId,
        discordUsername: null,
        displayName: null,
      }));
      const autoRoleAction =
        this.normalizedBanServerAction(config?.emojis?.banServerAction) ===
        "ROLE"
          ? "ROLE"
          : "NONE";
      const serverActionDetails = await this.applyDiscordBanServerAction(
        guild,
        config ?? null,
        managerTargets,
        autoRoleAction,
        "Automatic no-show ban",
        { permanent: false },
      );
      if (guild && response.createdTeamIds.length > 0) {
        this.syncDiscordScrimStateInBackground(guild, input.sessionId, {
          organizationId: config?.organizationId,
          removedTeamIds: response.createdTeamIds,
          extraDiscordUserIds: managerTargets.map(
            (target) => target.discordUserId,
          ),
          cleanupTeamIds: response.createdTeamIds,
          fastMessageRefresh: true,
          skipFullSync: true,
          delayMs: 0,
        });
        this.reconcileScrimRolesInBackground(guild, input.sessionId);
      }
      await this.refreshDiscordBanListMessage(
        guild,
        config ?? null,
        input.sessionId,
      );
      return { ...response, serverActionDetails };
    } catch (error) {
      throw new Error(toFriendlyApiError(error));
    }
  }
}
