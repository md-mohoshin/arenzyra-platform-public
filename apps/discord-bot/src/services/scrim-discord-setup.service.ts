import {
  ActionRowBuilder,
  type ApplicationEmoji,
  type ApplicationEmojiManager,
  type AttachmentPayload,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  type ComponentEmojiResolvable,
  EmbedBuilder,
  Guild,
  GuildEmoji,
  Message,
  type MessageEditAttachmentData,
  MessageType,
  MessageReaction,
  OverwriteType,
  PermissionFlagsBits,
  type PermissionOverwriteOptions,
  Role,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextChannel,
} from "discord.js";
import { createHash } from "crypto";
import { readFileSync } from "fs";
import path from "path";
import sharp from "sharp";
import type {
  SessionDiscordConfigResponse,
  SessionRegistrationResponse,
  SessionResponse,
  UpdateSessionDiscordConfigPayload,
} from "../api/api-client";
import { botConfig } from "../config";
import { fetchRemoteRasterImage } from "../security/remote-image";
import {
  configuredButtonEmoji,
  configuredButtonLabel,
  configuredButtonStyle,
  playConfirmationMessageEnabled,
  playConfirmationMessageText,
  playConfirmationMessageTitle,
  playConfirmationButtonsEnabled,
  playConfirmationReactionsEnabled,
  playConfirmationWindow,
  playConfirmationWindowStatusText,
  playStatusRowEmoji,
  playStatusRowStyle,
  parseRoleAccessGroups,
  registrationMessageEnabled,
  registrationMessageDisplayMode,
  registrationMessageText,
  registrationMessageTitle,
  registrationWindowForSession,
  registrationWindowStatusTextForSession,
  resolveDiscordEmoji,
  roleAccessGroupWindow,
  roleAccessWindow,
  slotListMessageMode,
  slotListMarker,
  waitlistMessageMode,
  waitlistPromotionWindowForSession,
} from "./discord-emojis";
import {
  allowedMentionsForOrganizerText,
  mentionContentForOrganizerText,
  type OrganizerAllowedMentions,
} from "./discord-allowed-mentions";
import {
  SlotRosterImageRenderer,
  type SlotRosterImagePage,
  type SlotRosterImageRow,
} from "./slot-roster-image";

const SLOT_LIST_START = 3;
const DISCORD_CDN_BASE_URL = "https://cdn.discordapp.com";
const DEFAULT_TEAM_LOGO_EMOJI_NAME = "az_default_logo_a";
const SERVER_TEAM_LOGO_EMOJI_PREFIX = "azg";
const SERVER_TEAM_LOGO_EMOJI_VERSION = "v1";
const TEAM_LOGO_EMOJI_PREFIX = "azt";
const TEAM_LOGO_EMOJI_VERSION = "v1";
const SERVER_TEAM_LOGO_EMOJI_NAME_PATTERN =
  /^azg_v1_[0-9a-f]{8}_[0-9a-f]{6}$/;
const TEAM_LOGO_EMOJI_NAME_PATTERN =
  /^azt_v1_[0-9a-f]{10}_[0-9a-f]{6}$/;
const MAX_EMOJI_IMAGE_BYTES = 256 * 1024;
const MAX_SOURCE_LOGO_BYTES = 8 * 1024 * 1024;
const EMOJI_IMAGE_SIZE = 128;
const MAX_STALE_TEAM_LOGO_EMOJI_DELETE = 50;
const APPLICATION_EMOJI_LIMIT = 2000;
const APPLICATION_EMOJI_CACHE_TTL_MS = 60_000;
const APPLICATION_EMOJI_FULL_WARNING_TTL_MS = 60_000;
const PLAY_STATUS_NOTE_PREFIX = "ARENZYRA_PLAY_STATUS:";
const BACKGROUND_SAMPLE_EDGE_SIZE = 10;
const BACKGROUND_COLOR_BUCKET_SIZE = 16;
const BACKGROUND_MATCH_TOLERANCE = 46;
const BACKGROUND_FEATHER_TOLERANCE = 82;
const BACKGROUND_MIN_DOMINANCE = 0.35;
const DEFAULT_STAFF_ROLE_NAME = "Arenzyra Staff";
const STAFF_ROLE_NAMES = [
  "[OWNER]",
  "Arenzyra Admin",
  "Arenzyra Staff",
  "Production Lead",
  "Tournament Organizer",
];
const WAITLIST_CONTROL_PAGE_SIZE = 25;
const REGISTRATION_CONTROL_CLEANUP_SCAN_LIMIT = 300;
const DISCORD_MESSAGE_CONTENT_LIMIT = 2000;
const TEAM_LOGO_EMOJI_CLEANUP_INTERVAL_MS = 5 * 60_000;
const BOT_CONTROLLED_MEMBER_DENY_PERMISSIONS = [
  PermissionFlagsBits.AddReactions,
  PermissionFlagsBits.CreatePublicThreads,
  PermissionFlagsBits.CreatePrivateThreads,
  PermissionFlagsBits.SendMessagesInThreads,
];
const BOT_CONTROLLED_BOT_ALLOW_PERMISSIONS = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.ReadMessageHistory,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.EmbedLinks,
  PermissionFlagsBits.AttachFiles,
  PermissionFlagsBits.AddReactions,
  PermissionFlagsBits.CreatePublicThreads,
  PermissionFlagsBits.CreatePrivateThreads,
  PermissionFlagsBits.SendMessagesInThreads,
  PermissionFlagsBits.ManageMessages,
];
const BOT_CONTROLLED_MEMBER_DENY_OPTIONS: PermissionOverwriteOptions = {
  AddReactions: false,
  CreatePublicThreads: false,
  CreatePrivateThreads: false,
  SendMessagesInThreads: false,
};
const BOT_CONTROLLED_STAFF_ALLOW_OPTIONS: PermissionOverwriteOptions = {
  AddReactions: true,
  CreatePublicThreads: true,
  CreatePrivateThreads: true,
  SendMessagesInThreads: true,
};
type BotControlledSendMessagesMode = "allow" | "deny" | null;

type ScrimChannelKind =
  | "registration"
  | "slot-list"
  | "waitlist"
  | "idp"
  | "public-chat"
  | "manager"
  | "transfer"
  | "auto-registration"
  | "manage"
  | "results"
  | "screenshots"
  | "bans"
  | "log";

type SlotListRenderOptions = {
  managerMentionByTeamId?: Map<string, string>;
  teamLogoEmojiByTeamId?: Map<string, string>;
  defaultTeamLogoEmoji?: string | null;
  compactRows?: boolean;
  hideTeamLogos?: boolean;
  shortenTeamNames?: boolean;
};

type ManagedMessageComponentRow =
  | ActionRowBuilder<ButtonBuilder>
  | ActionRowBuilder<StringSelectMenuBuilder>;

type ManagedAllowedMentions = OrganizerAllowedMentions;

export type ManagedMessagePayload = {
  content?: string | null;
  embeds?: EmbedBuilder[];
  components?: ManagedMessageComponentRow[];
  allowedMentions?: ManagedAllowedMentions;
  files?: AttachmentPayload[];
  attachments?: MessageEditAttachmentData[];
};
type ManagedMessageMatcher = (message: Message) => boolean;

type RegistrationPlayStatus = {
  status: "CONFIRM" | "NOT_PLAYING";
  discordUserId: string | null;
};

type Rgb = {
  r: number;
  g: number;
  b: number;
};

type ApplicationEmojiCacheState = {
  expiresAt: number;
  fullWarningExpiresAt?: number;
  refresh?: Promise<boolean>;
};

function limitDiscordMessageContent(content: string) {
  const trimmed = content.trim();
  if (trimmed.length <= DISCORD_MESSAGE_CONTENT_LIMIT) {
    return trimmed;
  }

  const suffix = "\n\n... message shortened to fit Discord.";
  return `${trimmed
    .slice(0, DISCORD_MESSAGE_CONTENT_LIMIT - suffix.length)
    .trimEnd()}${suffix}`;
}

export type ScrimDiscordSetup = {
  categoryId: string;
  categoryName: string;
  registrationChannelId: string;
  registrationChannelName: string;
  slotListChannelId: string;
  slotListChannelName: string;
  waitlistChannelId: string;
  waitlistChannelName: string;
  idpChannelId: string;
  idpChannelName: string;
  publicChatChannelId: string;
  publicChatChannelName: string;
  managerChannelId: string;
  managerChannelName: string;
  transferChannelId: string;
  transferChannelName: string;
  autoRegistrationGrantChannelId?: string;
  autoRegistrationGrantChannelName?: string;
  manageChannelId: string;
  manageChannelName: string;
  resultsChannelId: string;
  resultsChannelName: string;
  screenshotsChannelId: string;
  screenshotsChannelName: string;
  bansChannelId: string;
  bansChannelName: string;
  logChannelId: string;
  logChannelName: string;
  slotRoleId: string | null;
  slotRoleName: string | null;
  staffRoleId: string | null;
  staffRoleName: string | null;
  waitlistRoleId: string | null;
  waitlistRoleName: string | null;
  idpRoleId: string | null;
  idpRoleName: string | null;
  bannedRoleId: string | null;
  bannedRoleName: string | null;
};

export type ScrimDiscordManagedMessageIds = {
  managedRegistrationPanelMessageId?: string;
  managedSlotListMessageId?: string;
  managedWaitlistMessageId?: string;
  managedWaitlistControlMessageId?: string;
  managedConfirmationMessageId?: string;
};

export type WaitlistControlPanelPayload = {
  payload: ManagedMessagePayload;
  page: number;
  totalPages: number;
  waitlistCount: number;
};

function shortSessionId(sessionId: string) {
  return sessionId.slice(0, 8);
}

function channelTopic(sessionId: string, kind: ScrimChannelKind) {
  return `arenzyra-session=${sessionId};kind=${kind}`;
}

function marker(sessionId: string, kind: string) {
  return `arenzyra:${sessionId}:${kind}`;
}

function legacyEmbedHasMarker(
  embed: {
    footer?: { text?: string | null } | null;
    fields?: readonly { name: string; value: string }[];
  },
  markerValue: string,
) {
  return (
    embed.footer?.text === markerValue ||
    embed.fields?.some(
      (field) => field.name === "\u200B" && field.value === markerValue,
    ) ||
    false
  );
}

function managedMessageId(
  config: SessionDiscordConfigResponse | null | undefined,
  key: keyof ScrimDiscordManagedMessageIds,
) {
  const value = config?.emojis?.[key]?.trim();
  return value && /^\d+$/.test(value) ? value : null;
}

function categoryName(session: Pick<SessionResponse, "id" | "name">) {
  return `SCRIM ${shortSessionId(session.id)} ${session.name}`.slice(0, 100);
}

function configuredOrDefaultName(
  configured: string | null | undefined,
  fallback: string,
) {
  return configured?.trim() || fallback;
}

function configuredOrDefaultChannelName(
  configured: string | null | undefined,
  fallback: string,
) {
  const candidate = configuredOrDefaultName(configured, fallback);
  return safeChannelName(candidate) ? candidate : fallback;
}

function configBoolean(
  config: SessionDiscordConfigResponse | null | undefined,
  key: string,
  fallback = false,
) {
  const value = config?.emojis?.[key]?.trim();
  if (value === undefined || value === "") {
    return fallback;
  }
  return ["true", "1", "yes", "on"].includes(value.toLowerCase());
}

function useExistingChannels(config?: SessionDiscordConfigResponse | null) {
  return configBoolean(config, "discordUseExistingChannels", false);
}

function manageChannelPermissions(
  config?: SessionDiscordConfigResponse | null,
) {
  return configBoolean(
    config,
    "discordManageChannelPermissions",
    configBoolean(config, "discordManageExistingChannels", false),
  );
}

function autoCreateRoles(config?: SessionDiscordConfigResponse | null) {
  return configBoolean(config, "discordAutoCreateRoles", false);
}

function safeChannelName(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90);
}

function trimRoleName(name: string) {
  return name.slice(0, 100);
}

function configuredStaffRoleName(config?: SessionDiscordConfigResponse | null) {
  return trimRoleName(
    config?.emojis?.staffRoleName?.trim() || DEFAULT_STAFF_ROLE_NAME,
  );
}

function configuredStaffRoleId(config?: SessionDiscordConfigResponse | null) {
  return config?.emojis?.staffRoleId?.trim() || null;
}

function clampWaitlistControlPage(waitlistCount: number, page: number) {
  const totalPages = Math.max(
    1,
    Math.ceil(waitlistCount / WAITLIST_CONTROL_PAGE_SIZE),
  );
  if (!Number.isInteger(page)) {
    return { page: 0, totalPages };
  }
  return {
    page: Math.min(Math.max(0, page), totalPages - 1),
    totalPages,
  };
}

function truncateDiscordOptionText(value: string, maxLength = 100) {
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) {
    return trimmed || "Unknown";
  }
  return `${trimmed.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function publicRegistrationOpen(
  session: Pick<
    SessionResponse,
    "status" | "registrationOpenAt" | "registrationCloseAt"
  >,
  config?: SessionDiscordConfigResponse | null,
  now = new Date(),
) {
  return registrationWindowForSession(session, config, now).allowsAction;
}

function sessionStatusAllowsRegistrationAccess(
  session: Pick<SessionResponse, "status">,
) {
  return (
    session.status === "DRAFT" ||
    session.status === "OPEN" ||
    session.status === "CHECKIN"
  );
}

function activeRegistration(registration: SessionRegistrationResponse) {
  return (
    registration.status !== "REMOVED" && registration.status !== "DECLINED"
  );
}

function normalSlotAvailable(
  session: Pick<SessionResponse, "slotCount">,
  registrations: SessionRegistrationResponse[],
  config?: SessionDiscordConfigResponse | null,
) {
  const range = slotRangeForSession(session, config);
  if (range.endSlot < range.startSlot) {
    return false;
  }
  const occupied = new Set(
    registrations
      .filter(
        (registration) =>
          activeRegistration(registration) &&
          registration.slotNumber !== null &&
          registration.slotNumber >= range.startSlot &&
          registration.slotNumber <= range.endSlot,
      )
      .map((registration) => registration.slotNumber),
  );
  for (let slot = range.startSlot; slot <= range.endSlot; slot += 1) {
    if (!occupied.has(slot)) {
      return true;
    }
  }
  return false;
}

function waitlistPromotionOpen(
  session: Pick<SessionResponse, "status" | "slotCount">,
  registrations: SessionRegistrationResponse[],
  config?: SessionDiscordConfigResponse | null,
  now = new Date(),
) {
  return (
    waitlistPromotionWindowForSession(session, config, now).allowsAction &&
    normalSlotAvailable(session, registrations, config)
  );
}

function resolveTeamLabel(
  registration: Pick<SessionRegistrationResponse, "team" | "teamId">,
) {
  return (
    registration.team?.tag?.trim() ||
    registration.team?.name?.trim() ||
    registration.teamId ||
    "UNKNOWN"
  );
}

function formatTeamSlotRow(
  registration: Pick<SessionRegistrationResponse, "team" | "teamId" | "note">,
  managerMention?: string | null,
  logoEmoji?: string | null,
  playStatus?: Pick<RegistrationPlayStatus, "discordUserId"> | null,
  opts: { hideLogo?: boolean; shortenName?: boolean } = {},
) {
  const tag = registration.team?.tag?.trim() || "NO TAG";
  const name =
    registration.team?.name?.trim() || registration.teamId || "Unknown Team";
  const displayName =
    opts.shortenName && name.length > 40
      ? `${name.slice(0, 37).trimEnd()}...`
      : name;
  const manager =
    managerMention?.trim() ||
    (playStatus?.discordUserId ? `<@${playStatus.discordUserId}>` : "");
  const logo = opts.hideLogo ? "" : logoEmoji?.trim();
  const rowBody = `[${tag}] ${displayName}${manager ? ` ${manager}` : ""}`;
  const row = `${logo ? `${logo} ` : ""}${rowBody}`;
  return row;
}

function allowedMentionsForRenderedMentions(
  content: string,
): ManagedAllowedMentions {
  const users = Array.from(
    new Set(
      Array.from(content.matchAll(/<@!?(\d{17,20})>/g))
        .map((match) => match[1])
        .filter((userId): userId is string => Boolean(userId)),
    ),
  ).slice(0, 100);
  return users.length > 0 ? { parse: [], users } : { parse: [] };
}

function mentionMirrorContent(content: string) {
  const userIds = Array.from(
    new Set(
      Array.from(content.matchAll(/<@!?(\d{17,20})>/g))
        .map((match) => match[1])
        .filter((userId): userId is string => Boolean(userId)),
    ),
  ).slice(0, 100);
  if (userIds.length === 0) {
    return null;
  }

  const mentions: string[] = [];
  let mirrored = "Managers:";
  for (const userId of userIds) {
    const mention = `<@${userId}>`;
    const next = `${mirrored} ${mention}`;
    if (next.length > 2000) {
      break;
    }
    mirrored = next;
    mentions.push(mention);
  }

  return mentions.length > 0 ? mirrored : null;
}

function formatPlayStatusRow(
  row: string,
  playStatus?: RegistrationPlayStatus | null,
  config?: SessionDiscordConfigResponse | null,
) {
  if (playStatus?.status === "NOT_PLAYING") {
    if (playStatusRowStyle(config) === "enhanced") {
      return `~~_${row}_~~ ${playStatusRowEmoji("NOT_PLAYING", config)}`;
    }
    return `~~${row}~~`;
  }
  if (playStatus?.status === "CONFIRM") {
    if (playStatusRowStyle(config) === "enhanced") {
      return `**${row}** ${playStatusRowEmoji("CONFIRM", config)}`;
    }
    return `__${row}__`;
  }
  return row;
}

function registrationPlayStatus(
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

function slotRangeForSession(
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

function vipSlotRangeForSession(
  session: Pick<SessionResponse, "slotCount">,
  config: SessionDiscordConfigResponse | null | undefined,
  normalRange: { startSlot: number; endSlot: number },
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

function placementLabel(
  session: Pick<SessionResponse, "slotCount">,
  registration: SessionRegistrationResponse,
  config?: SessionDiscordConfigResponse | null,
) {
  if (
    registration.status === "WAITLIST" &&
    registration.waitlistPosition !== null
  ) {
    return `Waitlist #${registration.waitlistPosition}`;
  }
  if (registration.slotNumber !== null) {
    const range = slotRangeForSession(session, config);
    const vipRange = vipSlotRangeForSession(session, config, range);
    if (
      registration.slotNumber >= vipRange.startSlot &&
      registration.slotNumber <= vipRange.endSlot
    ) {
      return `VIP #${registration.slotNumber - vipRange.startSlot + 1}`;
    }
    return `Slot #${registration.slotNumber}`;
  }
  return registration.status;
}

export class ScrimDiscordSetupService {
  private readonly slotRosterImageRenderer = new SlotRosterImageRenderer();
  private readonly waitlistChannelPermissionSignatures = new Map<
    string,
    string
  >();
  private readonly teamLogoEmojiCleanupAfter = new Map<string, number>();
  private readonly teamLogoEmojiCleanups = new Map<string, Promise<void>>();
  private readonly applicationEmojiCacheStates = new Map<
    string,
    ApplicationEmojiCacheState
  >();
  private readonly applicationEmojiCreates = new Map<
    string,
    Promise<ApplicationEmoji | null>
  >();
  private readonly guildEmojiCreates = new Map<
    string,
    Promise<GuildEmoji | null>
  >();

  private isUnknownDiscordMessageError(error: unknown) {
    const code = (error as { code?: unknown })?.code;
    return code === 10008 || /Unknown Message/i.test(String(error));
  }

  async ensureSetup(
    guild: Guild,
    session: Pick<
      SessionResponse,
      "id" | "name" | "status" | "registrationOpenAt" | "registrationCloseAt"
    >,
    config?: SessionDiscordConfigResponse | null,
  ): Promise<ScrimDiscordSetup> {
    await guild.channels.fetch();
    await guild.roles.fetch();
    this.scheduleManagedTeamLogoEmojiCleanup(guild);

    const allowRoleCreate = autoCreateRoles(config);
    const staffRole = await this.ensureStaffRole(
      guild,
      config,
      allowRoleCreate,
    );
    const roles = await this.ensureSessionRoles(
      guild,
      session,
      config,
      allowRoleCreate,
    );
    const category = await this.ensureCategory(guild, session, config);
    const staffRoles = this.staffRoles(guild, config, staffRole);
    const preserveExistingChannels = useExistingChannels(config);
    const manageExistingChannelPermissions = manageChannelPermissions(config);

    const registrationChannel = await this.ensureTextChannel(
      guild,
      category.id,
      session.id,
      "registration",
      configuredOrDefaultChannelName(
        config?.registrationChannelName,
        "registration",
      ),
      config?.registrationChannelId,
      this.registrationOverwrites(guild, staffRoles, session, config),
      preserveExistingChannels,
      manageExistingChannelPermissions,
    );
    const slotListChannel = await this.ensureTextChannel(
      guild,
      category.id,
      session.id,
      "slot-list",
      configuredOrDefaultChannelName(config?.slotListChannelName, "slot-list"),
      config?.slotListChannelId,
      this.protectedOverwrites(guild, staffRoles, roles.slotRole, true),
      preserveExistingChannels,
      manageExistingChannelPermissions,
    );
    const waitlistChannel = await this.ensureTextChannel(
      guild,
      category.id,
      session.id,
      "waitlist",
      configuredOrDefaultChannelName(config?.waitlistChannelName, "waitlist"),
      config?.waitlistChannelId,
      this.protectedOverwrites(guild, staffRoles, roles.waitlistRole, true),
      preserveExistingChannels,
      manageExistingChannelPermissions,
    );
    const idpChannel = await this.ensureTextChannel(
      guild,
      category.id,
      session.id,
      "idp",
      configuredOrDefaultChannelName(config?.idpChannelName, "idp"),
      config?.idpChannelId,
      this.protectedOverwrites(guild, staffRoles, roles.idpRole),
      preserveExistingChannels,
      manageExistingChannelPermissions,
    );
    const publicChatChannel = await this.ensureTextChannel(
      guild,
      category.id,
      session.id,
      "public-chat",
      configuredOrDefaultChannelName(
        config?.publicChatChannelName,
        "public-chat",
      ),
      config?.publicChatChannelId,
      this.publicChatOverwrites(guild, staffRoles, roles.slotRole, config),
      preserveExistingChannels,
      manageExistingChannelPermissions,
    );
    const managerChannel = await this.ensureTextChannel(
      guild,
      category.id,
      session.id,
      "manager",
      configuredOrDefaultChannelName(config?.managerChannelName, "manager"),
      config?.managerChannelId,
      this.publicWritableOverwrites(guild, staffRoles),
      preserveExistingChannels,
      manageExistingChannelPermissions,
    );
    const transferChannel = await this.ensureTextChannel(
      guild,
      category.id,
      session.id,
      "transfer",
      configuredOrDefaultChannelName(
        config?.transferChannelName,
        "transfer-roles",
      ),
      config?.transferChannelId,
      this.roleWritableOverwrites(guild, staffRoles, [
        roles.slotRole,
        roles.waitlistRole,
      ]),
      preserveExistingChannels,
      manageExistingChannelPermissions,
    );
    const shouldEnsureAutoRegistrationChannel =
      config?.emojis?.autoRegistrationEnabled === "true" ||
      Boolean(config?.emojis?.autoRegistrationGrantChannelId?.trim());
    const autoRegistrationGrantChannel = shouldEnsureAutoRegistrationChannel
      ? await this.ensureTextChannel(
          guild,
          category.id,
          session.id,
          "auto-registration",
          configuredOrDefaultChannelName(
            config?.emojis?.autoRegistrationGrantChannelName,
            "auto-registration",
          ),
          config?.emojis?.autoRegistrationGrantChannelId,
          this.staffOnlyOverwrites(guild, staffRoles),
          preserveExistingChannels,
          manageExistingChannelPermissions,
        )
      : null;
    const manageChannel = await this.ensureTextChannel(
      guild,
      category.id,
      session.id,
      "manage",
      configuredOrDefaultChannelName(config?.manageChannelName, "manage"),
      config?.manageChannelId,
      this.staffOnlyOverwrites(guild, staffRoles),
      preserveExistingChannels,
      manageExistingChannelPermissions,
    );
    const resultsChannel = await this.ensureTextChannel(
      guild,
      category.id,
      session.id,
      "results",
      configuredOrDefaultChannelName(config?.resultsChannelName, "results"),
      config?.resultsChannelId,
      this.protectedOverwrites(guild, staffRoles, roles.slotRole),
      preserveExistingChannels,
      manageExistingChannelPermissions,
    );
    const screenshotsChannel = await this.ensureTextChannel(
      guild,
      category.id,
      session.id,
      "screenshots",
      configuredOrDefaultChannelName(
        config?.screenshotsChannelName,
        "screenshots",
      ),
      config?.screenshotsChannelId,
      this.staffOnlyOverwrites(guild, staffRoles),
      preserveExistingChannels,
      manageExistingChannelPermissions,
    );
    const bansChannel = await this.ensureTextChannel(
      guild,
      category.id,
      session.id,
      "bans",
      configuredOrDefaultChannelName(config?.bansChannelName, "bans"),
      config?.bansChannelId,
      this.staffOnlyOverwrites(guild, staffRoles),
      preserveExistingChannels,
      manageExistingChannelPermissions,
    );
    const logChannel = await this.ensureTextChannel(
      guild,
      category.id,
      session.id,
      "log",
      configuredOrDefaultChannelName(config?.logChannelName, "log"),
      config?.logChannelId,
      this.staffOnlyOverwrites(guild, staffRoles),
      preserveExistingChannels,
      manageExistingChannelPermissions,
    );

    await this.upsertRegistrationPanel(registrationChannel, session, config);

    return {
      categoryId: category.id,
      categoryName: category.name,
      registrationChannelId: registrationChannel.id,
      registrationChannelName: registrationChannel.name,
      slotListChannelId: slotListChannel.id,
      slotListChannelName: slotListChannel.name,
      waitlistChannelId: waitlistChannel.id,
      waitlistChannelName: waitlistChannel.name,
      idpChannelId: idpChannel.id,
      idpChannelName: idpChannel.name,
      publicChatChannelId: publicChatChannel.id,
      publicChatChannelName: publicChatChannel.name,
      managerChannelId: managerChannel.id,
      managerChannelName: managerChannel.name,
      transferChannelId: transferChannel.id,
      transferChannelName: transferChannel.name,
      autoRegistrationGrantChannelId:
        autoRegistrationGrantChannel?.id ?? undefined,
      autoRegistrationGrantChannelName:
        autoRegistrationGrantChannel?.name ?? undefined,
      manageChannelId: manageChannel.id,
      manageChannelName: manageChannel.name,
      resultsChannelId: resultsChannel.id,
      resultsChannelName: resultsChannel.name,
      screenshotsChannelId: screenshotsChannel.id,
      screenshotsChannelName: screenshotsChannel.name,
      bansChannelId: bansChannel.id,
      bansChannelName: bansChannel.name,
      logChannelId: logChannel.id,
      logChannelName: logChannel.name,
      slotRoleId: roles.slotRole?.id ?? null,
      slotRoleName: roles.slotRole?.name ?? null,
      staffRoleId: staffRole?.id ?? null,
      staffRoleName: staffRole?.name ?? null,
      waitlistRoleId: roles.waitlistRole?.id ?? null,
      waitlistRoleName: roles.waitlistRole?.name ?? null,
      idpRoleId: roles.idpRole?.id ?? null,
      idpRoleName: roles.idpRole?.name ?? null,
      bannedRoleId: roles.bannedRole?.id ?? null,
      bannedRoleName: roles.bannedRole?.name ?? null,
    };
  }

  async findSetup(
    guild: Guild,
    sessionId: string,
  ): Promise<ScrimDiscordSetup | null> {
    await guild.channels.fetch();
    await guild.roles.fetch();

    const registrationChannel = this.findTextChannel(
      guild,
      sessionId,
      "registration",
    );
    const slotListChannel = this.findTextChannel(guild, sessionId, "slot-list");
    const waitlistChannel = this.findTextChannel(guild, sessionId, "waitlist");
    const idpChannel = this.findTextChannel(guild, sessionId, "idp");
    const publicChatChannel = this.findTextChannel(
      guild,
      sessionId,
      "public-chat",
    );
    const managerChannel = this.findTextChannel(guild, sessionId, "manager");
    const transferChannel = this.findTextChannel(guild, sessionId, "transfer");
    const autoRegistrationGrantChannel = this.findTextChannel(
      guild,
      sessionId,
      "auto-registration",
    );
    const manageChannel = this.findTextChannel(guild, sessionId, "manage");
    const resultsChannel = this.findTextChannel(guild, sessionId, "results");
    const screenshotsChannel = this.findTextChannel(
      guild,
      sessionId,
      "screenshots",
    );
    const bansChannel = this.findTextChannel(guild, sessionId, "bans");
    const logChannel = this.findTextChannel(guild, sessionId, "log");
    const category = guild.channels.cache.find(
      (channel) =>
        channel.type === ChannelType.GuildCategory &&
        channel.name.startsWith(`SCRIM ${shortSessionId(sessionId)}`),
    );
    const slotRole = this.findSessionRole(guild, sessionId, "Slot");
    const staffRole = this.findStaffRole(guild, null);
    const waitlistRole = this.findSessionRole(guild, sessionId, "Waitlist");
    const idpRole = this.findSessionRole(guild, sessionId, "IDP");
    const bannedRole = this.findSessionRole(guild, sessionId, "Banned");

    if (
      !registrationChannel ||
      !slotListChannel ||
      !waitlistChannel ||
      !idpChannel ||
      !publicChatChannel ||
      !managerChannel ||
      !transferChannel ||
      !manageChannel ||
      !resultsChannel ||
      !screenshotsChannel ||
      !bansChannel ||
      !logChannel ||
      !category ||
      !slotRole ||
      !staffRole ||
      !waitlistRole ||
      !bannedRole
    ) {
      return null;
    }

    return {
      categoryId: category.id,
      categoryName: category.name,
      registrationChannelId: registrationChannel.id,
      registrationChannelName: registrationChannel.name,
      slotListChannelId: slotListChannel.id,
      slotListChannelName: slotListChannel.name,
      waitlistChannelId: waitlistChannel.id,
      waitlistChannelName: waitlistChannel.name,
      idpChannelId: idpChannel.id,
      idpChannelName: idpChannel.name,
      publicChatChannelId: publicChatChannel.id,
      publicChatChannelName: publicChatChannel.name,
      managerChannelId: managerChannel.id,
      managerChannelName: managerChannel.name,
      transferChannelId: transferChannel.id,
      transferChannelName: transferChannel.name,
      autoRegistrationGrantChannelId: autoRegistrationGrantChannel?.id,
      autoRegistrationGrantChannelName: autoRegistrationGrantChannel?.name,
      manageChannelId: manageChannel.id,
      manageChannelName: manageChannel.name,
      resultsChannelId: resultsChannel.id,
      resultsChannelName: resultsChannel.name,
      screenshotsChannelId: screenshotsChannel.id,
      screenshotsChannelName: screenshotsChannel.name,
      bansChannelId: bansChannel.id,
      bansChannelName: bansChannel.name,
      logChannelId: logChannel.id,
      logChannelName: logChannel.name,
      slotRoleId: slotRole.id,
      slotRoleName: slotRole.name,
      staffRoleId: staffRole.id,
      staffRoleName: staffRole.name,
      waitlistRoleId: waitlistRole.id,
      waitlistRoleName: waitlistRole.name,
      idpRoleId: idpRole?.id ?? slotRole.id,
      idpRoleName: idpRole?.name ?? slotRole.name,
      bannedRoleId: bannedRole.id,
      bannedRoleName: bannedRole.name,
    };
  }

  async syncMessages(
    guild: Guild,
    setup: ScrimDiscordSetup,
    session: SessionResponse,
    registrations: SessionRegistrationResponse[],
    config?: SessionDiscordConfigResponse | null,
    opts: SlotListRenderOptions = {},
  ): Promise<ScrimDiscordManagedMessageIds> {
    const slotListChannel = await this.fetchTextChannel(
      guild,
      setup.slotListChannelId,
    );
    const waitlistChannel = await this.fetchTextChannel(
      guild,
      setup.waitlistChannelId,
    );
    await this.syncWaitlistPromotionChannelState(
      guild,
      waitlistChannel,
      setup,
      session,
      registrations,
      config,
    );
    this.scheduleManagedTeamLogoEmojiCleanup(guild);
    const renderOpts = {
      ...opts,
      ...this.emptyTeamLogoRenderOptions(),
      hideTeamLogos: true,
    };
    const slotListPayload = this.withoutRosterImageAttachments(
      this.buildSlotListPayload(
        session,
        registrations,
        config,
        renderOpts,
        this.buildPlayConfirmationRows(session, config),
      ),
    );
    const waitlistPayload = this.withoutRosterImageAttachments(
      this.buildWaitlistPayload(
        session,
        registrations,
        config,
        renderOpts,
      ),
    );

    const registrationPanelMessage = await this.upsertRegistrationPanel(
      await this.fetchTextChannel(guild, setup.registrationChannelId),
      session,
      config,
    );
    const slotListMessage = await this.upsertPinnedMessage(
      slotListChannel,
      managedMessageId(config, "managedSlotListMessageId"),
      marker(session.id, "slots"),
      slotListPayload,
      (message) => this.managedListMessageMatches(message, "slot-list"),
    );
    await this.syncPlayConfirmationReactions(slotListMessage, config);
    const confirmationMessage = await this.syncPlayConfirmationMessage(
      slotListChannel,
      session,
      config,
    );
    if (confirmationMessage) {
      await this.syncPlayConfirmationReactions(confirmationMessage, config);
    }
    const waitlistMessage = await this.upsertPinnedMessage(
      waitlistChannel,
      managedMessageId(config, "managedWaitlistMessageId"),
      marker(session.id, "waitlist"),
      waitlistPayload,
      (message) => this.managedListMessageMatches(message, "waitlist"),
    );
    await this.cleanupStaleManagedListMessages(
      slotListChannel,
      slotListMessage.id,
      "slot-list",
    );
    await this.cleanupStaleManagedListMessages(
      waitlistChannel,
      waitlistMessage.id,
      "waitlist",
    );
    await this.deleteWaitlistControlMessage(guild, setup, session, config);
    await this.cleanupStaleRegistrationControlMessages(
      guild,
      setup,
      session,
      registrations,
    );

    return {
      managedRegistrationPanelMessageId: registrationPanelMessage?.id ?? "",
      managedSlotListMessageId: slotListMessage.id,
      managedWaitlistMessageId: waitlistMessage.id,
      managedWaitlistControlMessageId: "",
      managedConfirmationMessageId: confirmationMessage?.id ?? "",
    };
  }

  async syncSlotListMessage(
    guild: Guild,
    setup: ScrimDiscordSetup,
    session: SessionResponse,
    registrations: SessionRegistrationResponse[],
    config?: SessionDiscordConfigResponse | null,
    opts: SlotListRenderOptions = {},
  ): Promise<Message> {
    const slotListChannel = await this.fetchTextChannel(
      guild,
      setup.slotListChannelId,
    );
    this.scheduleManagedTeamLogoEmojiCleanup(guild);
    const renderOpts = {
      ...opts,
      ...this.emptyTeamLogoRenderOptions(),
      hideTeamLogos: true,
    };
    const slotListPayload = this.withoutRosterImageAttachments(
      this.buildSlotListPayload(
        session,
        registrations,
        config,
        renderOpts,
        this.buildPlayConfirmationRows(session, config),
      ),
    );
    const slotListMessage = await this.upsertPinnedMessage(
      slotListChannel,
      managedMessageId(config, "managedSlotListMessageId"),
      marker(session.id, "slots"),
      slotListPayload,
      (message) => this.managedListMessageMatches(message, "slot-list"),
    );
    await this.syncPlayConfirmationReactions(slotListMessage, config);
    await this.cleanupStaleManagedListMessages(
      slotListChannel,
      slotListMessage.id,
      "slot-list",
    );
    return slotListMessage;
  }

  async deleteWaitlistControlMessage(
    guild: Guild,
    setup: ScrimDiscordSetup,
    session: Pick<SessionResponse, "id">,
    config?: SessionDiscordConfigResponse | null,
  ): Promise<void> {
    const manageChannel = await this.fetchTextChannel(
      guild,
      setup.manageChannelId,
    );
    await this.deleteManagedMessage(
      manageChannel,
      managedMessageId(config, "managedWaitlistControlMessageId"),
      marker(session.id, "waitlist-control"),
      (message) =>
        message.embeds.some(
          (embed) => embed.title?.trim() === "Waitlist Control",
        ),
    );
  }

  async syncSlotListAndWaitlistMessages(
    guild: Guild,
    setup: ScrimDiscordSetup,
    session: SessionResponse,
    registrations: SessionRegistrationResponse[],
    config?: SessionDiscordConfigResponse | null,
    opts: SlotListRenderOptions = {},
  ): Promise<ScrimDiscordManagedMessageIds> {
    const slotListChannel = await this.fetchTextChannel(
      guild,
      setup.slotListChannelId,
    );
    const waitlistChannel = await this.fetchTextChannel(
      guild,
      setup.waitlistChannelId,
    );
    await this.syncWaitlistPromotionChannelState(
      guild,
      waitlistChannel,
      setup,
      session,
      registrations,
      config,
    );
    this.scheduleManagedTeamLogoEmojiCleanup(guild);
    const renderOpts = {
      ...opts,
      ...this.emptyTeamLogoRenderOptions(),
      hideTeamLogos: true,
    };
    const slotListPayload = this.withoutRosterImageAttachments(
      this.buildSlotListPayload(
        session,
        registrations,
        config,
        renderOpts,
        this.buildPlayConfirmationRows(session, config),
      ),
    );
    const waitlistPayload = this.withoutRosterImageAttachments(
      this.buildWaitlistPayload(
        session,
        registrations,
        config,
        renderOpts,
      ),
    );

    const slotListMessage = await this.upsertPinnedMessage(
      slotListChannel,
      managedMessageId(config, "managedSlotListMessageId"),
      marker(session.id, "slots"),
      slotListPayload,
      (message) => this.managedListMessageMatches(message, "slot-list"),
    );
    await this.syncPlayConfirmationReactions(slotListMessage, config);
    const confirmationMessage = await this.syncPlayConfirmationMessage(
      slotListChannel,
      session,
      config,
    );
    if (confirmationMessage) {
      await this.syncPlayConfirmationReactions(confirmationMessage, config);
    }
    const waitlistMessage = await this.upsertPinnedMessage(
      waitlistChannel,
      managedMessageId(config, "managedWaitlistMessageId"),
      marker(session.id, "waitlist"),
      waitlistPayload,
      (message) => this.managedListMessageMatches(message, "waitlist"),
    );
    await this.cleanupStaleManagedListMessages(
      slotListChannel,
      slotListMessage.id,
      "slot-list",
    );
    await this.cleanupStaleManagedListMessages(
      waitlistChannel,
      waitlistMessage.id,
      "waitlist",
    );
    await this.deleteWaitlistControlMessage(guild, setup, session, config);

    return {
      managedSlotListMessageId: slotListMessage.id,
      managedWaitlistMessageId: waitlistMessage.id,
      managedWaitlistControlMessageId: "",
      managedConfirmationMessageId: confirmationMessage?.id ?? "",
    };
  }

  async syncRegistrationChannelState(
    guild: Guild,
    setup: ScrimDiscordSetup,
    session: SessionResponse,
    config?: SessionDiscordConfigResponse | null,
  ): Promise<Message | null> {
    await guild.roles.fetch().catch(() => undefined);
    const registrationChannel = await this.fetchTextChannel(
      guild,
      setup.registrationChannelId,
    );
    const staffRoles = this.staffRoles(guild, config, null);
    const overwrites = this.registrationOverwrites(
      guild,
      staffRoles,
      session,
      config,
    );
    if (manageChannelPermissions(config)) {
      await registrationChannel.permissionOverwrites
        .set(overwrites)
        .catch((error) => {
          console.warn(
            `Registration channel permission refresh failed for ${session.id}: ${String(
              error,
            )}`,
          );
        });
    } else {
      await this.applyBotControlledPermissionPatch(
        guild,
        registrationChannel,
        "registration",
        overwrites,
      );
    }
    return this.upsertRegistrationPanel(registrationChannel, session, config);
  }

  async sendIdp(
    guild: Guild,
    setup: ScrimDiscordSetup,
    embed: EmbedBuilder,
  ): Promise<TextChannel> {
    const idpChannel = await this.fetchTextChannel(guild, setup.idpChannelId);
    await idpChannel.send({
      embeds: [embed],
      allowedMentions: { parse: [] },
    });
    return idpChannel;
  }

  async sendRegistrationManagePanel(
    guild: Guild,
    setup: ScrimDiscordSetup,
    session: SessionResponse,
    registration: SessionRegistrationResponse,
    config?: SessionDiscordConfigResponse | null,
  ): Promise<TextChannel> {
    const manageChannel = await this.fetchTextChannel(
      guild,
      setup.manageChannelId,
    );
    const team = resolveTeamLabel(registration);
    const logoUrl = registration.team?.logoUrl?.trim() || null;
    const embed = new EmbedBuilder()
      .setColor(0x16a34a)
      .setTitle(
        `${resolveDiscordEmoji("team", config)} Registration Control: ${team}`,
      )
      .addFields(
        { name: "Session", value: session.name, inline: false },
        { name: "Team", value: team, inline: true },
        {
          name: "Placement",
          value: placementLabel(session, registration, config),
          inline: true,
        },
        {
          name: "Logo",
          value: logoUrl ? "Saved" : "Not provided",
          inline: true,
        },
      )
      .setFooter({ text: "Arenzyra Registration Control" })
      .setTimestamp(new Date());
    if (logoUrl) {
      embed.setThumbnail(logoUrl);
    }

    await guild.emojis.fetch().catch((error) => {
      console.warn(`Guild emoji cache refresh failed: ${String(error)}`);
      return null;
    });
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      this.manageButton(
        guild,
        `regctl:a:${session.id}:${registration.id}`,
        "Approve",
        "check",
        ButtonStyle.Success,
        config,
      ),
      this.manageButton(
        guild,
        `regctl:s:${session.id}:${registration.id}`,
        "Set Slot",
        "slot",
        ButtonStyle.Primary,
        config,
      ),
      this.manageButton(
        guild,
        `regctl:w:${session.id}:${registration.id}`,
        "Waitlist",
        "waitlist",
        ButtonStyle.Secondary,
        config,
      ),
      this.manageButton(
        guild,
        `regctl:v:${session.id}:${registration.id}`,
        "VIP",
        "vip",
        ButtonStyle.Primary,
        config,
      ),
      this.manageButton(
        guild,
        `regctl:r:${session.id}:${registration.id}`,
        "Remove",
        "reject",
        ButtonStyle.Danger,
        config,
      ),
    );
    const banRow = this.registrationBanActionRow(
      guild,
      session.id,
      registration.team?.id ?? registration.teamId,
      config,
    );

    await manageChannel.send({
      embeds: [embed],
      components: banRow ? [row, banRow] : [row],
      allowedMentions: { parse: [] },
    });
    return manageChannel;
  }

  private registrationBanActionRow(
    guild: Guild,
    sessionId: string,
    teamId: string | null | undefined,
    config?: SessionDiscordConfigResponse | null,
  ) {
    const cleanTeamId = teamId?.trim();
    if (
      !cleanTeamId ||
      config?.emojis?.banControlsEnabled === "false"
    ) {
      return null;
    }
    const temporaryId = `cardban:d:${sessionId}:${cleanTeamId}`;
    const permanentId = `cardban:p:${sessionId}:${cleanTeamId}`;
    if (temporaryId.length > 100 || permanentId.length > 100) {
      return null;
    }
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      this.manageButton(
        guild,
        temporaryId,
        "Ban",
        "ban",
        ButtonStyle.Danger,
        config,
      ),
      this.manageButton(
        guild,
        permanentId,
        "Permanent Ban",
        "ban",
        ButtonStyle.Danger,
        config,
      ),
    );
  }

  private manageButton(
    guild: Guild,
    customId: string,
    label: string,
    emojiKey: Parameters<typeof resolveDiscordEmoji>[0],
    style: ButtonStyle,
    config?: SessionDiscordConfigResponse | null,
  ) {
    const button = new ButtonBuilder()
      .setCustomId(customId)
      .setLabel(label)
      .setStyle(style);
    const emoji = this.resolveButtonEmoji(
      guild,
      resolveDiscordEmoji(emojiKey, config),
    );
    if (emoji) {
      button.setEmoji(emoji);
    }
    return button;
  }

  private resolveButtonEmoji(
    guild: Guild,
    rawEmoji: string,
  ): ComponentEmojiResolvable | null {
    const emoji = rawEmoji.trim();
    if (!emoji || ["none", "off", "false"].includes(emoji.toLowerCase())) {
      return null;
    }

    const custom = /^<(a?):([A-Za-z0-9_]{2,32}):(\d{17,20})>$/.exec(emoji);
    if (custom) {
      const [, animated, name, id] = custom;
      const guildEmoji = guild.emojis.cache.get(id);
      if (!guildEmoji) {
        return null;
      }
      return {
        id,
        name: guildEmoji.name ?? name,
        animated: guildEmoji.animated ?? animated === "a",
      };
    }

    if (/^\d{17,20}$/.test(emoji)) {
      const guildEmoji = guild.emojis.cache.get(emoji);
      return guildEmoji
        ? {
            id: emoji,
            name: guildEmoji.name ?? undefined,
            animated: guildEmoji.animated ?? false,
          }
        : null;
    }

    return this.isUnicodeButtonEmoji(emoji) ? emoji : null;
  }

  private isUnicodeButtonEmoji(value: string) {
    if (value.length > 32) {
      return false;
    }

    const segments = Array.from(
      new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(value),
    );
    if (segments.length !== 1 || segments[0]?.segment !== value) {
      return false;
    }

    if (
      !/[\p{Extended_Pictographic}\p{Emoji_Presentation}\p{Regional_Indicator}]/u.test(
        value,
      )
    ) {
      return false;
    }

    return /^[\p{Extended_Pictographic}\p{Emoji_Presentation}\p{Emoji_Modifier}\p{Regional_Indicator}\uFE0E\uFE0F\u200D\u20E3]+$/u.test(
      value,
    );
  }

  private async ensureSessionRoles(
    guild: Guild,
    session: Pick<SessionResponse, "id" | "name">,
    config?: SessionDiscordConfigResponse | null,
    allowCreate = false,
  ) {
    const slotRole = await this.ensureRole(
      guild,
      session,
      "Slot",
      0x2563eb,
      config?.slotRoleId,
      config?.slotRoleName,
      allowCreate,
    );
    const waitlistRole = await this.ensureRole(
      guild,
      session,
      "Waitlist",
      0xf59e0b,
      config?.waitlistRoleId,
      config?.waitlistRoleName,
      allowCreate,
    );
    const idpRole = await this.ensureConfiguredIdpRole(
      guild,
      session,
      config,
      slotRole,
      allowCreate,
    );
    const bannedRole = await this.ensureRole(
      guild,
      session,
      "Banned",
      0xdc2626,
      config?.bannedRoleId,
      config?.bannedRoleName,
      allowCreate,
    );

    return {
      slotRole,
      waitlistRole,
      idpRole,
      bannedRole,
    };
  }

  private hasConfiguredDistinctIdpRole(
    config: SessionDiscordConfigResponse | null | undefined,
    slotRole: Role | null,
  ) {
    const configuredId = config?.idpRoleId?.trim();
    if (configuredId) {
      return configuredId !== slotRole?.id;
    }

    const configuredName = config?.idpRoleName?.trim();
    return Boolean(configuredName && configuredName !== slotRole?.name);
  }

  private async ensureConfiguredIdpRole(
    guild: Guild,
    session: Pick<SessionResponse, "id" | "name">,
    config: SessionDiscordConfigResponse | null | undefined,
    slotRole: Role | null,
    allowCreate: boolean,
  ) {
    if (!this.hasConfiguredDistinctIdpRole(config, slotRole)) {
      return slotRole;
    }

    return this.ensureRole(
      guild,
      session,
      "IDP",
      0x2563eb,
      config?.idpRoleId,
      config?.idpRoleName,
      allowCreate,
    );
  }

  private async ensureStaffRole(
    guild: Guild,
    config?: SessionDiscordConfigResponse | null,
    allowCreate = false,
  ): Promise<Role | null> {
    const configuredManageRole = this.firstConfiguredManageRole(guild, config);
    if (configuredManageRole) {
      return configuredManageRole;
    }

    const configuredId = configuredStaffRoleId(config);
    const desiredName = configuredStaffRoleName(config);

    if (configuredId) {
      const configured = await guild.roles
        .fetch(configuredId)
        .catch(() => null);
      if (configured) {
        if (
          STAFF_ROLE_NAMES.includes(configured.name) &&
          configured.name !== desiredName
        ) {
          return configured
            .edit({
              name: desiredName,
              color: 0x0891b2,
              mentionable: false,
              reason: "Arenzyra staff role sync",
            })
            .catch(() => configured);
        }
        return configured;
      }
    }

    const existing = this.findStaffRole(guild, desiredName);
    if (existing) {
      return existing;
    }

    if (!allowCreate) {
      return null;
    }

    return guild.roles.create({
      name: desiredName,
      color: 0x0891b2,
      mentionable: false,
      reason: "Arenzyra staff role for Discord automation",
    });
  }

  private async ensureRole(
    guild: Guild,
    session: Pick<SessionResponse, "id" | "name">,
    kind: "Slot" | "Waitlist" | "IDP" | "Banned",
    color: number,
    configuredId?: string | null,
    configuredName?: string | null,
    allowCreate = false,
  ): Promise<Role | null> {
    if (configuredId) {
      const configured = await guild.roles
        .fetch(configuredId)
        .catch(() => null);
      if (configured) {
        return configured;
      }
    }

    if (configuredName) {
      const byName = guild.roles.cache.find(
        (role) => role.name === configuredName,
      );
      if (byName) {
        return byName;
      }
    }

    const existing = this.findSessionRole(guild, session.id, kind);
    if (existing) {
      return existing;
    }

    if (!allowCreate) {
      return null;
    }

    return guild.roles.create({
      name: trimRoleName(`Arenzyra ${kind} ${shortSessionId(session.id)}`),
      color,
      mentionable: false,
      reason: `Arenzyra ${kind} access for ${session.name}`,
    });
  }

  private findSessionRole(
    guild: Guild,
    sessionId: string,
    kind: "Slot" | "Waitlist" | "IDP" | "Banned",
  ) {
    const expected = `Arenzyra ${kind} ${shortSessionId(sessionId)}`;
    return guild.roles.cache.find((role) => role.name === expected) ?? null;
  }

  private findStaffRole(guild: Guild, configuredName: string | null) {
    const names = new Set(
      [configuredName?.trim(), DEFAULT_STAFF_ROLE_NAME].filter(
        (value): value is string => Boolean(value),
      ),
    );
    return guild.roles.cache.find((role) => names.has(role.name)) ?? null;
  }

  private configuredManageRoleIds(
    config?: SessionDiscordConfigResponse | null,
  ) {
    return [
      ...new Set(
        (config?.manageRoleIds ?? [])
          .map((roleId) => roleId.trim())
          .filter(Boolean),
      ),
    ];
  }

  private configuredRegistrationAccessRoleIds(
    config?: SessionDiscordConfigResponse | null,
  ) {
    return [
      ...new Set(
        [
          ...this.configuredRegistrationRestrictionRoleIds(config),
          config?.earlyAccessRoleId ?? "",
          config?.vipAccessRoleId ?? "",
          ...parseRoleAccessGroups(config).map((group) => group.roleId),
        ]
          .map((roleId) => roleId.trim())
          .filter(Boolean),
      ),
    ];
  }

  private configuredRegistrationRestrictionRoleIds(
    config?: SessionDiscordConfigResponse | null,
  ) {
    return [
      ...new Set(
        [
          ...(config?.registrationRoleIds ?? []),
          ...(config?.specialRegistrationRoleIds ?? []),
          ...(config?.vipRoleIds ?? []),
        ]
          .map((roleId) => roleId.trim())
          .filter(Boolean),
      ),
    ];
  }

  private registrationAccessRoleCanSend(
    roleId: string,
    session: Pick<SessionResponse, "status">,
    config: SessionDiscordConfigResponse | null | undefined,
    publicCanSend: boolean,
  ) {
    const restrictionRoleIds = new Set(
      this.configuredRegistrationRestrictionRoleIds(config),
    );
    if (
      publicCanSend &&
      (restrictionRoleIds.size === 0 || restrictionRoleIds.has(roleId))
    ) {
      return true;
    }
    if (!config || !sessionStatusAllowsRegistrationAccess(session)) {
      return false;
    }

    if (
      roleId === config.earlyAccessRoleId?.trim() &&
      roleAccessWindow(config, "earlyAccess").allowsAction
    ) {
      return true;
    }
    if (
      roleId === config.vipAccessRoleId?.trim() &&
      roleAccessWindow(config, "vipAccess").allowsAction
    ) {
      return true;
    }

    return parseRoleAccessGroups(config).some(
      (group) =>
        group.roleId === roleId &&
        roleAccessGroupWindow(group, config).allowsAction,
    );
  }

  private firstConfiguredManageRole(
    guild: Guild,
    config?: SessionDiscordConfigResponse | null,
  ) {
    const roleIds = this.configuredManageRoleIds(config);
    for (const roleId of roleIds) {
      const role = guild.roles.cache.get(roleId);
      if (role) {
        return role;
      }
    }
    return null;
  }

  private async ensureCategory(
    guild: Guild,
    session: Pick<SessionResponse, "id" | "name">,
    config?: SessionDiscordConfigResponse | null,
  ) {
    const desiredName = configuredOrDefaultName(
      config?.categoryName,
      categoryName(session),
    );
    if (config?.categoryId) {
      const configured = await guild.channels
        .fetch(config.categoryId)
        .catch(() => null);
      if (configured?.type === ChannelType.GuildCategory) {
        return configured;
      }
    }

    const byConfiguredName = guild.channels.cache.find(
      (channel) =>
        channel.type === ChannelType.GuildCategory &&
        channel.name === desiredName,
    );
    if (byConfiguredName?.type === ChannelType.GuildCategory) {
      return byConfiguredName;
    }

    const existing = guild.channels.cache.find(
      (channel) =>
        channel.type === ChannelType.GuildCategory &&
        channel.name.startsWith(`SCRIM ${shortSessionId(session.id)}`),
    );
    if (existing && existing.type === ChannelType.GuildCategory) {
      return existing;
    }

    return guild.channels.create({
      name: desiredName,
      type: ChannelType.GuildCategory,
      reason: `Arenzyra scrim setup for ${session.name}`,
    });
  }

  private async ensureTextChannel(
    guild: Guild,
    categoryId: string,
    sessionId: string,
    kind: ScrimChannelKind,
    name: string,
    configuredId: string | null | undefined,
    permissionOverwrites: Array<{
      id: string;
      allow?: bigint[];
      deny?: bigint[];
    }>,
    preserveExistingChannels = false,
    manageExistingChannelPermissions = false,
  ): Promise<TextChannel> {
    const desiredName = safeChannelName(name);
    if (configuredId) {
      const configured = await guild.channels
        .fetch(configuredId, { force: true })
        .catch(() => null);
      if (configured?.type === ChannelType.GuildText) {
        if (preserveExistingChannels) {
          await this.applyBotControlledPermissionPatch(
            guild,
            configured,
            kind,
            permissionOverwrites,
          );
          return configured;
        }
        const editPayload: Parameters<TextChannel["edit"]>[0] = {
          parent: categoryId,
          topic: channelTopic(sessionId, kind),
        };
        if (manageExistingChannelPermissions) {
          editPayload.permissionOverwrites = permissionOverwrites;
        }
        await configured.edit(editPayload);
        if (!manageExistingChannelPermissions) {
          await this.applyBotControlledPermissionPatch(
            guild,
            configured,
            kind,
            permissionOverwrites,
          );
        }
        return configured;
      }
    }

    const existing = this.findTextChannel(guild, sessionId, kind);
    if (existing) {
      if (preserveExistingChannels) {
        await this.applyBotControlledPermissionPatch(
          guild,
          existing,
          kind,
          permissionOverwrites,
        );
        return existing;
      }
      const editPayload: Parameters<TextChannel["edit"]>[0] = {
        parent: categoryId,
        topic: channelTopic(sessionId, kind),
        name: desiredName,
      };
      if (manageExistingChannelPermissions) {
        editPayload.permissionOverwrites = permissionOverwrites;
      }
      await existing.edit(editPayload);
      if (!manageExistingChannelPermissions) {
        await this.applyBotControlledPermissionPatch(
          guild,
          existing,
          kind,
          permissionOverwrites,
        );
      }
      return existing;
    }

    const byNameInCategory = guild.channels.cache.find(
      (channel) =>
        channel.type === ChannelType.GuildText &&
        channel.parentId === categoryId &&
        channel.name === desiredName,
    ) as TextChannel | undefined;
    if (byNameInCategory) {
      if (preserveExistingChannels) {
        await this.applyBotControlledPermissionPatch(
          guild,
          byNameInCategory,
          kind,
          permissionOverwrites,
        );
        return byNameInCategory;
      }
      const editPayload: Parameters<TextChannel["edit"]>[0] = {
        parent: categoryId,
        topic: channelTopic(sessionId, kind),
        name: desiredName,
      };
      if (manageExistingChannelPermissions) {
        editPayload.permissionOverwrites = permissionOverwrites;
      }
      await byNameInCategory.edit(editPayload);
      if (!manageExistingChannelPermissions) {
        await this.applyBotControlledPermissionPatch(
          guild,
          byNameInCategory,
          kind,
          permissionOverwrites,
        );
      }
      return byNameInCategory;
    }

    return guild.channels.create({
      name: desiredName,
      type: ChannelType.GuildText,
      parent: categoryId,
      topic: channelTopic(sessionId, kind),
      permissionOverwrites,
      reason: `Arenzyra ${kind} channel for session ${sessionId}`,
    });
  }

  private isBotControlledCleanChannel(kind: ScrimChannelKind) {
    return (
      kind === "registration" ||
      kind === "slot-list" ||
      kind === "waitlist" ||
      kind === "public-chat"
    );
  }

  private async applyBotControlledPermissionPatch(
    guild: Guild,
    channel: TextChannel,
    kind: ScrimChannelKind,
    desiredOverwrites: Array<{
      id: string;
      allow?: bigint[];
      deny?: bigint[];
    }>,
  ) {
    if (!this.isBotControlledCleanChannel(kind)) {
      return;
    }

    const permissionOverwrites = channel.permissionOverwrites;
    if (typeof permissionOverwrites?.edit !== "function") {
      return;
    }

    const botUserId =
      guild.client?.user?.id ?? guild.members?.me?.id ?? null;
    const staffRoleIds = new Set(
      desiredOverwrites
        .filter((overwrite) =>
          overwrite.id !== botUserId &&
          overwrite.allow?.includes(PermissionFlagsBits.ManageMessages),
        )
        .map((overwrite) => overwrite.id),
    );
    const desiredOverwriteById = new Map(
      desiredOverwrites.map((overwrite) => [overwrite.id, overwrite]),
    );
    const publicChatPublicMode =
      kind === "public-chat" &&
      this.desiredSendMessagesMode(
        desiredOverwriteById.get(guild.roles.everyone.id),
      ) === "allow";
    const denyRoleIds = new Set<string>([guild.roles.everyone.id]);
    const staleRegistrationRoleIds = new Set<string>();

    for (const overwrite of desiredOverwrites) {
      if (
        overwrite.id !== botUserId &&
        !staffRoleIds.has(overwrite.id) &&
        overwrite.id !== guild.roles.everyone.id
      ) {
        denyRoleIds.add(overwrite.id);
      }
    }

    for (const overwrite of permissionOverwrites.cache?.values?.() ?? []) {
      if (
        !publicChatPublicMode &&
        overwrite.type === OverwriteType.Role &&
        !staffRoleIds.has(overwrite.id)
      ) {
        if (
          kind === "registration" &&
          overwrite.id !== guild.roles.everyone.id &&
          !desiredOverwriteById.has(overwrite.id)
        ) {
          staleRegistrationRoleIds.add(overwrite.id);
          continue;
        }
        denyRoleIds.add(overwrite.id);
      }
    }

    const controlsSendMessages =
      kind === "registration" ||
      kind === "waitlist" ||
      kind === "public-chat";
    const reason = controlsSendMessages
      ? kind === "waitlist"
        ? "Arenzyra waitlist promotion access permission lock"
        : kind === "public-chat"
          ? "Arenzyra public chat access permission lock"
        : "Arenzyra registration access permission lock"
      : `Arenzyra ${kind} reaction/thread permission lock`;
    for (const roleId of staleRegistrationRoleIds) {
      if (typeof permissionOverwrites.delete !== "function") {
        denyRoleIds.add(roleId);
        continue;
      }
      await permissionOverwrites
        .delete(roleId, "Arenzyra stale registration role cleanup")
        .catch((error) => {
          console.warn(
            `Stale registration role cleanup failed for role=${roleId}: ${String(
              error,
            )}`,
          );
          denyRoleIds.add(roleId);
        });
    }

    for (const roleId of denyRoleIds) {
      const existing = permissionOverwrites.cache?.get(roleId);
      const sendMessagesMode = controlsSendMessages
        ? (this.desiredSendMessagesMode(desiredOverwriteById.get(roleId)) ??
          (publicChatPublicMode ? null : "deny"))
        : null;
      const denyPermissions = [
        ...BOT_CONTROLLED_MEMBER_DENY_PERMISSIONS,
        ...(sendMessagesMode === "deny"
          ? [PermissionFlagsBits.SendMessages]
          : []),
      ];
      const allowPermissions =
        sendMessagesMode === "allow"
          ? [PermissionFlagsBits.SendMessages]
          : [];
      if (
        existing &&
        this.permissionOverwriteMatches(
          existing,
          allowPermissions,
          denyPermissions,
        )
      ) {
        continue;
      }
      await permissionOverwrites
        .edit(
          roleId,
          this.botControlledMemberPatchOptions(sendMessagesMode),
          {
            type: OverwriteType.Role,
            reason,
          },
        )
        .catch((error) => {
          console.warn(
            `Bot-controlled permission lock failed for ${kind} role=${roleId}: ${String(
              error,
            )}`,
          );
        });
    }

    for (const roleId of staffRoleIds) {
      const existing = permissionOverwrites.cache?.get(roleId);
      const allowPermissions = [
        ...BOT_CONTROLLED_MEMBER_DENY_PERMISSIONS,
        ...(controlsSendMessages ? [PermissionFlagsBits.SendMessages] : []),
      ];
      if (
        existing &&
        this.permissionOverwriteHasAllow(existing, allowPermissions)
      ) {
        continue;
      }
      await permissionOverwrites
        .edit(
          roleId,
          this.botControlledAllowPatchOptions(controlsSendMessages),
          {
            type: OverwriteType.Role,
            reason,
          },
        )
        .catch((error) => {
          console.warn(
            `Bot-controlled staff permission lock failed for ${kind} role=${roleId}: ${String(
              error,
            )}`,
          );
        });
    }

    if (botUserId) {
      const existing = permissionOverwrites.cache?.get(botUserId);
      const allowPermissions = [
        ...BOT_CONTROLLED_MEMBER_DENY_PERMISSIONS,
        ...(controlsSendMessages ? [PermissionFlagsBits.SendMessages] : []),
      ];
      if (
        !existing ||
        !this.permissionOverwriteHasAllow(existing, allowPermissions)
      ) {
        await permissionOverwrites
          .edit(
            botUserId,
            this.botControlledAllowPatchOptions(controlsSendMessages),
            {
              type: OverwriteType.Member,
              reason,
            },
          )
          .catch((error) => {
            console.warn(
              `Bot-controlled bot permission lock failed for ${kind}: ${String(
                error,
              )}`,
            );
          });
      }
    }
  }

  private desiredSendMessagesMode(overwrite?: {
    allow?: bigint[];
    deny?: bigint[];
  }): BotControlledSendMessagesMode {
    if (overwrite?.allow?.includes(PermissionFlagsBits.SendMessages)) {
      return "allow";
    }
    if (overwrite?.deny?.includes(PermissionFlagsBits.SendMessages)) {
      return "deny";
    }
    return null;
  }

  private botControlledMemberPatchOptions(
    sendMessagesMode: BotControlledSendMessagesMode,
  ): PermissionOverwriteOptions {
    const options: PermissionOverwriteOptions = {
      ...BOT_CONTROLLED_MEMBER_DENY_OPTIONS,
    };
    if (sendMessagesMode === "allow") {
      options.SendMessages = true;
    } else if (sendMessagesMode === "deny") {
      options.SendMessages = false;
    }
    return options;
  }

  private botControlledAllowPatchOptions(
    includeSendMessages: boolean,
  ): PermissionOverwriteOptions {
    return includeSendMessages
      ? { ...BOT_CONTROLLED_STAFF_ALLOW_OPTIONS, SendMessages: true }
      : BOT_CONTROLLED_STAFF_ALLOW_OPTIONS;
  }

  private permissionOverwriteHasDeny(
    overwrite: {
      allow: { has(permission: bigint): boolean };
      deny: { has(permission: bigint): boolean };
    },
    permissions: bigint[],
  ) {
    return permissions.every(
      (permission) =>
        overwrite.deny.has(permission) && !overwrite.allow.has(permission),
    );
  }

  private permissionOverwriteHasAllow(
    overwrite: {
      allow: { has(permission: bigint): boolean };
      deny: { has(permission: bigint): boolean };
    },
    permissions: bigint[],
  ) {
    return permissions.every(
      (permission) =>
        overwrite.allow.has(permission) && !overwrite.deny.has(permission),
    );
  }

  private permissionOverwriteMatches(
    overwrite: {
      allow: { has(permission: bigint): boolean };
      deny: { has(permission: bigint): boolean };
    },
    allowPermissions: bigint[],
    denyPermissions: bigint[],
  ) {
    return (
      this.permissionOverwriteHasAllow(overwrite, allowPermissions) &&
      this.permissionOverwriteHasDeny(overwrite, denyPermissions)
    );
  }

  private findTextChannel(
    guild: Guild,
    sessionId: string,
    kind: ScrimChannelKind,
  ) {
    return (
      (guild.channels.cache.find(
        (channel) =>
          channel.type === ChannelType.GuildText &&
          channel.topic === channelTopic(sessionId, kind),
      ) as TextChannel | undefined) ?? null
    );
  }

  private async fetchTextChannel(
    guild: Guild,
    channelId: string,
  ): Promise<TextChannel> {
    const channel = await guild.channels.fetch(channelId, { force: true });
    if (!channel || channel.type !== ChannelType.GuildText) {
      throw new Error("Configured Arenzyra channel was not found.");
    }
    return channel;
  }

  private staffRoles(
    guild: Guild,
    config?: SessionDiscordConfigResponse | null,
    ensuredStaffRole?: Role | null,
  ) {
    const explicitManageRoleIds = this.configuredManageRoleIds(config);
    const hasExplicitManageRoles = explicitManageRoleIds.length > 0;
    const configuredRoleIds = new Set(
      [
        ...explicitManageRoleIds,
        ...(hasExplicitManageRoles
          ? []
          : [configuredStaffRoleId(config) ?? ""]),
        ensuredStaffRole?.id ?? "",
      ].filter(Boolean),
    );
    return guild.roles.cache.filter(
      (role) =>
        configuredRoleIds.has(role.id) ||
        (!hasExplicitManageRoles &&
          (STAFF_ROLE_NAMES.includes(role.name) ||
            role.permissions.has(PermissionFlagsBits.Administrator) ||
            role.permissions.has(PermissionFlagsBits.ManageGuild) ||
            role.permissions.has(PermissionFlagsBits.ManageChannels))),
    );
  }

  private registrationOverwrites(
    guild: Guild,
    staffRoles: Map<string, Role>,
    session: Pick<
      SessionResponse,
      "status" | "registrationOpenAt" | "registrationCloseAt"
    >,
    config?: SessionDiscordConfigResponse | null,
  ) {
    const publicCanSend = publicRegistrationOpen(session, config);
    const configuredAccessRoleIds =
      this.configuredRegistrationAccessRoleIds(config);
    const restrictToRegistrationRoles =
      this.configuredRegistrationRestrictionRoleIds(config).length > 0;
    const staffRoleIds = new Set([...staffRoles.keys()]);
    const accessRoleOverwrites = configuredAccessRoleIds
      .filter((roleId) => !staffRoleIds.has(roleId))
      .map((roleId) => guild.roles.cache.get(roleId))
      .filter((role): role is Role => Boolean(role))
      .map((role) => {
        const canSend = this.registrationAccessRoleCanSend(
          role.id,
          session,
          config,
          publicCanSend,
        );
        return {
          id: role.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.ReadMessageHistory,
            ...(canSend ? [PermissionFlagsBits.SendMessages] : []),
          ],
          deny: this.botControlledMemberDeny(
            canSend ? [] : [PermissionFlagsBits.SendMessages],
          ),
        };
      });

    return this.withBotControlledBotOverwrite(guild, [
      {
        id: guild.roles.everyone.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.ReadMessageHistory,
          ...(publicCanSend && !restrictToRegistrationRoles
            ? [PermissionFlagsBits.SendMessages]
            : []),
        ],
        deny: this.botControlledMemberDeny(
          publicCanSend && !restrictToRegistrationRoles
            ? []
            : [PermissionFlagsBits.SendMessages],
        ),
      },
      ...accessRoleOverwrites,
      ...this.staffOverwrites(staffRoles),
    ]);
  }

  private async syncWaitlistPromotionChannelState(
    guild: Guild,
    channel: TextChannel,
    setup: ScrimDiscordSetup,
    session: Pick<SessionResponse, "status" | "slotCount">,
    registrations: SessionRegistrationResponse[],
    config?: SessionDiscordConfigResponse | null,
  ) {
    const waitlistRoleId = setup.waitlistRoleId?.trim();
    const staffRoles = this.staffRoles(guild, config, null);
    const accessRole = waitlistRoleId
      ? guild.roles.cache.get(waitlistRoleId) ??
        (await guild.roles.fetch(waitlistRoleId).catch(() => null))
      : null;
    const canSend = waitlistPromotionOpen(session, registrations, config);
    const overwrites = accessRole
      ? this.waitlistPromotionOverwrites(guild, staffRoles, accessRole, canSend)
      : this.withBotControlledBotOverwrite(
          guild,
          this.staffOnlyOverwrites(guild, staffRoles),
        );

    if (!manageChannelPermissions(config)) {
      await this.applyBotControlledPermissionPatch(
        guild,
        channel,
        "waitlist",
        overwrites,
      );
      return;
    }

    if (!accessRole) {
      return;
    }

    const signature = [
      guild.id,
      channel.id,
      accessRole.id,
      canSend ? "open" : "closed",
      [...staffRoles.keys()].sort().join(","),
    ].join("|");
    const key = `${guild.id}:${channel.id}`;
    if (this.waitlistChannelPermissionSignatures.get(key) === signature) {
      return;
    }

    await channel.permissionOverwrites.set(
      overwrites,
      "Arenzyra waitlist promotion channel state sync",
    );
    this.waitlistChannelPermissionSignatures.set(key, signature);
  }

  private publicWritableOverwrites(
    guild: Guild,
    staffRoles: Map<string, Role>,
  ) {
    return [
      {
        id: guild.roles.everyone.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.SendMessages,
        ],
      },
      ...this.staffOverwrites(staffRoles),
    ];
  }

  private publicChatOverwrites(
    guild: Guild,
    staffRoles: Map<string, Role>,
    accessRole: Role | null,
    config?: SessionDiscordConfigResponse | null,
  ) {
    if (config?.emojis?.publicChatAccessMode !== "session-role" || !accessRole) {
      return this.withBotControlledBotOverwrite(
        guild,
        this.publicWritableOverwrites(guild, staffRoles),
      );
    }

    return this.withBotControlledBotOverwrite(guild, [
      {
        id: guild.roles.everyone.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.ReadMessageHistory,
        ],
        deny: this.botControlledMemberDeny([PermissionFlagsBits.SendMessages]),
      },
      {
        id: accessRole.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.SendMessages,
        ],
        deny: this.botControlledMemberDeny(),
      },
      ...this.staffOverwrites(staffRoles),
    ]);
  }

  private protectedOverwrites(
    guild: Guild,
    staffRoles: Map<string, Role>,
    accessRole: Role | null,
    botControlled = false,
  ) {
    if (!accessRole) {
      const overwrites = this.staffOnlyOverwrites(guild, staffRoles);
      return botControlled
        ? this.withBotControlledBotOverwrite(guild, overwrites)
        : overwrites;
    }

    const overwrites = [
      {
        id: guild.roles.everyone.id,
        deny: botControlled
          ? this.botControlledMemberDeny([PermissionFlagsBits.ViewChannel])
          : [PermissionFlagsBits.ViewChannel],
      },
      {
        id: accessRole.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.ReadMessageHistory,
        ],
        deny: botControlled
          ? this.botControlledMemberDeny([PermissionFlagsBits.SendMessages])
          : [PermissionFlagsBits.SendMessages],
      },
      ...this.staffOverwrites(staffRoles),
    ];
    return botControlled
      ? this.withBotControlledBotOverwrite(guild, overwrites)
      : overwrites;
  }

  private waitlistPromotionOverwrites(
    guild: Guild,
    staffRoles: Map<string, Role>,
    accessRole: Role | null,
    canSend: boolean,
  ) {
    if (!accessRole) {
      return this.withBotControlledBotOverwrite(
        guild,
        this.staffOnlyOverwrites(guild, staffRoles),
      );
    }

    return this.withBotControlledBotOverwrite(guild, [
      {
        id: guild.roles.everyone.id,
        deny: this.botControlledMemberDeny([PermissionFlagsBits.ViewChannel]),
      },
      {
        id: accessRole.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.ReadMessageHistory,
          ...(canSend ? [PermissionFlagsBits.SendMessages] : []),
        ],
        deny: this.botControlledMemberDeny(
          canSend ? [] : [PermissionFlagsBits.SendMessages],
        ),
      },
      ...this.staffOverwrites(staffRoles),
    ]);
  }

  private roleWritableOverwrites(
    guild: Guild,
    staffRoles: Map<string, Role>,
    accessRoles: Array<Role | null | undefined>,
  ) {
    const seenRoleIds = new Set<string>();
    const uniqueAccessRoles = accessRoles.filter((role): role is Role => {
      if (!role?.id || seenRoleIds.has(role.id)) {
        return false;
      }
      seenRoleIds.add(role.id);
      return true;
    });
    return [
      {
        id: guild.roles.everyone.id,
        deny: [PermissionFlagsBits.ViewChannel],
      },
      ...uniqueAccessRoles.map((role) => ({
        id: role.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.SendMessages,
        ],
      })),
      ...this.staffOverwrites(staffRoles),
    ];
  }

  private staffOnlyOverwrites(guild: Guild, staffRoles: Map<string, Role>) {
    return [
      {
        id: guild.roles.everyone.id,
        deny: [PermissionFlagsBits.ViewChannel],
      },
      ...this.staffOverwrites(staffRoles),
    ];
  }

  private readOnlyPublicOverwrites(
    guild: Guild,
    staffRoles: Map<string, Role>,
  ) {
    return [
      {
        id: guild.roles.everyone.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.ReadMessageHistory,
        ],
        deny: [PermissionFlagsBits.SendMessages],
      },
      ...this.staffOverwrites(staffRoles),
    ];
  }

  private staffOverwrites(staffRoles: Map<string, Role>) {
    return [...staffRoles.values()].map((role) => ({
      id: role.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ManageMessages,
        PermissionFlagsBits.AddReactions,
        PermissionFlagsBits.CreatePublicThreads,
        PermissionFlagsBits.CreatePrivateThreads,
        PermissionFlagsBits.SendMessagesInThreads,
      ],
    }));
  }

  private botControlledMemberDeny(extraDeny: bigint[] = []) {
    return [...extraDeny, ...BOT_CONTROLLED_MEMBER_DENY_PERMISSIONS];
  }

  private withBotControlledBotOverwrite<
    T extends {
      id: string;
      allow?: bigint[];
      deny?: bigint[];
    },
  >(guild: Guild, overwrites: T[]) {
    const botUserId =
      guild.client?.user?.id ?? guild.members?.me?.id ?? null;
    if (
      !botUserId ||
      overwrites.some((overwrite) => overwrite.id === botUserId)
    ) {
      return overwrites;
    }
    return [
      ...overwrites,
      {
        id: botUserId,
        allow: BOT_CONTROLLED_BOT_ALLOW_PERMISSIONS,
      },
    ];
  }

  private async upsertRegistrationPanel(
    channel: TextChannel,
    session: Pick<
      SessionResponse,
      "id" | "name" | "status" | "registrationOpenAt" | "registrationCloseAt"
    >,
    config?: SessionDiscordConfigResponse | null,
  ): Promise<Message | null> {
    const footerMarker = marker(session.id, "registration-panel");
    const messageId = managedMessageId(
      config,
      "managedRegistrationPanelMessageId",
    );
    if (!registrationMessageEnabled(config)) {
      await this.deleteManagedMessage(channel, messageId, footerMarker);
      await this.cleanupStaleRegistrationPanelMessages(
        channel,
        "",
        registrationMessageTitle(config),
      );
      return null;
    }

    const panelTitle = registrationMessageTitle(config);
    const registrationStatus = registrationWindowStatusTextForSession(
      session,
      config,
    );
    const messageText = registrationMessageText(config, {
      name: session.name,
      registrationCommand: config?.registrationCommand,
    });
    const payload =
      registrationMessageDisplayMode(config) === "embed"
        ? this.registrationPanelEmbedPayload(
            panelTitle,
            messageText,
            registrationStatus,
          )
        : this.registrationPanelPlainPayload(
            panelTitle,
            messageText,
            registrationStatus,
          );
    const message = await this.upsertPinnedMessage(
      channel,
      messageId,
      footerMarker,
      payload,
      (message) => this.matchesRegistrationPanelMessage(message, panelTitle),
    );
    await this.cleanupStaleRegistrationPanelMessages(
      channel,
      message.id,
      panelTitle,
    );
    return message;
  }

  private registrationPanelPlainPayload(
    title: string,
    text: string,
    statusText: string,
  ): ManagedMessagePayload {
    const content = limitDiscordMessageContent(
      [`**${title}**`, text, statusText ? `**Window**\n${statusText}` : ""]
        .filter(Boolean)
        .join("\n\n"),
    );
    return {
      content,
      embeds: [],
      components: [],
      allowedMentions: allowedMentionsForOrganizerText(content),
    };
  }

  private registrationPanelEmbedPayload(
    title: string,
    text: string,
    statusText: string,
  ): ManagedMessagePayload {
    const embed = new EmbedBuilder()
      .setColor(0x22d3ee)
      .setTitle(title.slice(0, 256))
      .setDescription(text.slice(0, 4000));
    if (statusText) {
      embed.addFields({
        name: "Window",
        value: statusText.slice(0, 1024),
      });
    }
    const mentionSource = [title, text].join("\n");
    const mentionContent = mentionContentForOrganizerText(mentionSource);
    return {
      content: mentionContent || null,
      embeds: [embed],
      components: [],
      allowedMentions: allowedMentionsForOrganizerText(mentionSource),
    };
  }

  private matchesRegistrationPanelMessage(message: Message, title: string) {
    const expectedTitle = title.trim();
    const content = this.normalizedManagedContent(message.content).trim();
    if (
      content &&
      (content.includes(expectedTitle) ||
        content.includes("Arenzyra Scrim Registration")) &&
      /register/i.test(content)
    ) {
      return true;
    }

    return message.embeds.some((embed) => {
      const embedTitle = embed.title?.trim() ?? "";
      const description = embed.description?.trim() ?? "";
      const hasRegistrationWindowField = embed.fields.some(
        (field) =>
          field.name === "Window" && /Registration/i.test(field.value ?? ""),
      );

      return (
        embedTitle === expectedTitle ||
        embedTitle === "Arenzyra Scrim Registration" ||
        (hasRegistrationWindowField && /registration/i.test(embedTitle)) ||
        (/registration/i.test(embedTitle) && /register/i.test(description))
      );
    });
  }

  private staleRegistrationPanelMessageMatches(
    message: Message,
    title: string,
  ) {
    if (this.matchesRegistrationPanelMessage(message, title)) {
      return true;
    }

    const text = this.managedListMessageText(message);
    return /%register\b/i.test(text) && /\b(format|registration|scrim)\b/i.test(text);
  }

  private async cleanupStaleRegistrationPanelMessages(
    channel: TextChannel,
    managedMessageId: string,
    title: string,
  ) {
    const botUserId = channel.client.user?.id;
    if (!botUserId) {
      return;
    }

    const recentMessages = await channel.messages
      .fetch({ limit: 100 })
      .catch(() => null);
    const pinnedMessages = await channel.messages.fetchPinned().catch(() => null);
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
        message.id === managedMessageId ||
        message.author.id !== botUserId ||
        !this.staleRegistrationPanelMessageMatches(message, title)
      ) {
        continue;
      }

      await message.delete().catch(() => undefined);
    }
  }

  private async upsertPinnedEmbed(
    channel: TextChannel,
    messageId: string | null,
    footerMarker: string,
    embed: EmbedBuilder,
    components: ActionRowBuilder<ButtonBuilder>[] = [],
    matchExisting?: ManagedMessageMatcher,
  ): Promise<Message> {
    return this.upsertPinnedMessage(
      channel,
      messageId,
      footerMarker,
      {
        content: null,
        embeds: [embed],
        components,
        allowedMentions: { parse: [] },
      },
      matchExisting,
    );
  }

  private rawMentionUserIdsFromContent(content: string | null | undefined) {
    return Array.from(
      new Set(
        Array.from((content ?? "").matchAll(/<@!?(\d{17,20})>/g))
          .map((match) => match[1])
          .filter((userId): userId is string => Boolean(userId)),
      ),
    );
  }

  private normalizedManagedContent(content: string | null | undefined) {
    return (content ?? "").replace(/\u200B+$/u, "");
  }

  private comparableJson(value: unknown): unknown {
    if (value === undefined) {
      return null;
    }
    if (Array.isArray(value)) {
      return value.map((entry) => this.comparableJson(entry));
    }
    if (!value || typeof value !== "object") {
      return value;
    }

    const record = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      if (record[key] !== undefined) {
        result[key] = this.comparableJson(record[key]);
      }
    }
    return result;
  }

  private valueToJson(value: unknown) {
    const maybeJson = value as { toJSON?: () => unknown };
    return typeof maybeJson?.toJSON === "function" ? maybeJson.toJSON() : value;
  }

  private comparableEmbedImageUrl(value: unknown) {
    const raw = typeof value === "string" ? value.trim() : "";
    if (!raw) {
      return null;
    }
    if (raw.startsWith("attachment://")) {
      return raw;
    }
    try {
      const url = new URL(raw);
      if (
        (url.hostname === "cdn.discordapp.com" ||
          url.hostname === "media.discordapp.net") &&
        /^\/attachments\/[^/]+\/[^/]+\/[^/]+$/.test(url.pathname)
      ) {
        const fileName = decodeURIComponent(
          url.pathname.slice(url.pathname.lastIndexOf("/") + 1),
        );
        return fileName ? `attachment://${fileName}` : raw;
      }
    } catch {
      return raw;
    }
    return raw;
  }

  private comparableEmbed(value: unknown) {
    const source = this.valueToJson(value);
    const embed =
      source && typeof source === "object"
        ? (source as Record<string, unknown>)
        : {};
    const footer =
      embed.footer && typeof embed.footer === "object"
        ? (embed.footer as Record<string, unknown>)
        : null;
    const fields = Array.isArray(embed.fields)
      ? embed.fields.map((field) => {
          const record =
            field && typeof field === "object"
              ? (field as Record<string, unknown>)
              : {};
          return {
            name: record.name ?? null,
            value: record.value ?? null,
            inline: record.inline ?? false,
          };
        })
      : [];
    return {
      title: embed.title ?? null,
      description: embed.description ?? null,
      color: embed.color ?? null,
      footer: footer ? { text: footer.text ?? null } : null,
      fields,
      image:
        embed.image && typeof embed.image === "object"
          ? {
              url: this.comparableEmbedImageUrl(
                (embed.image as Record<string, unknown>).url,
              ),
            }
          : null,
    };
  }

  private comparableComponents(value: unknown) {
    const components = Array.isArray(value) ? value : [];
    return components.map((component) =>
      this.comparableJson(this.valueToJson(component)),
    );
  }

  private parsedMentionUserIds(message: Message) {
    const users = message.mentions?.users;
    return new Set(typeof users?.keys === "function" ? [...users.keys()] : []);
  }

  private messageHasParsedMentions(message: Message, content: string) {
    const rawMentionIds = this.rawMentionUserIdsFromContent(content);
    if (rawMentionIds.length === 0) {
      return true;
    }
    const parsedMentionIds = this.parsedMentionUserIds(message);
    return rawMentionIds.every((userId) => parsedMentionIds.has(userId));
  }

  private managedMessagePayloadMatches(
    message: Message,
    payload: ManagedMessagePayload,
  ) {
    const payloadContent = this.normalizedManagedContent(payload.content);
    if (
      this.normalizedManagedContent(message.content) !== payloadContent ||
      !this.messageHasParsedMentions(message, payloadContent)
    ) {
      return false;
    }

    const existingEmbeds = message.embeds.map((embed) =>
      this.comparableEmbed(embed),
    );
    const payloadEmbeds = (payload.embeds ?? []).map((embed) =>
      this.comparableEmbed(embed),
    );
    if (JSON.stringify(existingEmbeds) !== JSON.stringify(payloadEmbeds)) {
      return false;
    }

    if (payload.files) {
      const expectedAttachmentNames = [
        ...new Set(
          payload.files
            .map((file) => file.name?.trim())
            .filter((name): name is string => Boolean(name)),
        ),
      ].sort();
      const attachmentCollectionNames = [
        ...((message as Message & {
          attachments?: Map<string, { name?: string | null }>;
        }).attachments?.values() ?? []),
      ]
        .map((attachment) => attachment.name?.trim())
        .filter((name): name is string => Boolean(name));
      // Discord can expose an attachment:// embed through its signed CDN URL
      // while omitting that file from Message#attachments. Count the
      // normalized embed image names too, otherwise an unchanged roster is
      // re-uploaded at every sync.
      const embedImageNames = message.embeds
        .map((embed) => this.comparableEmbed(embed).image?.url)
        .filter(
          (url): url is string =>
            typeof url === "string" && url.startsWith("attachment://"),
        )
        .map((url) => url.slice("attachment://".length))
        .filter(Boolean);
      const existingAttachmentNames = [
        ...new Set([...attachmentCollectionNames, ...embedImageNames]),
      ].sort();
      if (
        JSON.stringify(existingAttachmentNames) !==
        JSON.stringify(expectedAttachmentNames)
      ) {
        return false;
      }
    }

    return (
      JSON.stringify(this.comparableComponents(message.components)) ===
      JSON.stringify(this.comparableComponents(payload.components ?? []))
    );
  }

  private payloadForManagedEdit(
    message: Message,
    payload: ManagedMessagePayload,
  ): ManagedMessagePayload {
    if (typeof payload.content !== "string") {
      return payload;
    }

    const payloadContent = this.normalizedManagedContent(payload.content);
    if (
      this.normalizedManagedContent(message.content) !== payloadContent ||
      this.messageHasParsedMentions(message, payloadContent)
    ) {
      return payload;
    }

    const content = (message.content ?? "").endsWith("\u200B")
      ? payloadContent
      : `${payloadContent}\u200B`;
    return { ...payload, content };
  }

  private editManagedMessage(message: Message, payload: ManagedMessagePayload) {
    const editPayload = this.payloadForManagedEdit(message, payload);
    if (this.managedMessagePayloadMatches(message, editPayload)) {
      return Promise.resolve(message);
    }
    return message.edit(editPayload);
  }

  private managedListMessageText(message: Message) {
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

  private staleManagedListMessageMatches(
    message: Message,
    kind: "slot-list" | "waitlist",
  ) {
    if (message.type === MessageType.ChannelPinnedMessage) {
      return true;
    }

    return this.managedListMessageMatches(message, kind);
  }

  private managedListMessageMatches(
    message: Message,
    kind: "slot-list" | "waitlist",
  ) {
    const text = this.managedListMessageText(message);
    if (kind === "slot-list") {
      return /\bslot\s+list\s*\(/i.test(text);
    }
    return /\bwaitlist\s*\(/i.test(text);
  }

  private async cleanupStaleManagedListMessages(
    channel: TextChannel,
    managedMessageId: string,
    kind: "slot-list" | "waitlist",
  ) {
    const botUserId = channel.client.user?.id;
    if (!botUserId) {
      return;
    }

    const recentMessages = await channel.messages
      .fetch({ limit: 100 })
      .catch(() => null);
    const pinnedMessages = await channel.messages.fetchPinned().catch(() => null);
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
        message.id === managedMessageId ||
        message.author.id !== botUserId ||
        !this.staleManagedListMessageMatches(message, kind)
      ) {
        continue;
      }

      await message.delete().catch(() => undefined);
    }
  }

  private async upsertPinnedMessage(
    channel: TextChannel,
    messageId: string | null,
    footerMarker: string,
    payload: ManagedMessagePayload,
    matchExisting?: ManagedMessageMatcher,
  ): Promise<Message> {
    const botUserId = channel.client.user?.id;
    const pinIfNeeded = async (message: Message) => {
      if (!message.pinned) {
        await message
          .pin("Pin Arenzyra scrim automation message")
          .catch(() => undefined);
      }
      return message;
    };
    const stored = messageId
      ? await channel.messages.fetch(messageId).catch(() => null)
      : null;
    if (stored && stored.author.id === botUserId) {
      const edited = await this.editManagedMessage(stored, payload).catch(
        (error) => {
          if (!this.isUnknownDiscordMessageError(error)) {
            throw error;
          }
          console.warn(
            `[DiscordSync] stored managed message disappeared channel=${channel.id} message=${stored.id}; recreating`,
          );
          return null;
        },
      );
      if (edited) {
        return pinIfNeeded(edited);
      }
    }

    const pinned = await channel.messages.fetchPinned().catch(() => null);
    let existing = pinned?.find(
      (message) =>
        message.author.id === botUserId &&
        (message.embeds.some((messageEmbed) =>
          legacyEmbedHasMarker(messageEmbed, footerMarker),
        ) ||
          matchExisting?.(message)),
    );
    if (!existing) {
      const recent = await channel.messages
        .fetch({ limit: 100 })
        .catch(() => null);
      existing = recent?.find(
        (message) =>
          message.author.id === botUserId &&
          message.type !== MessageType.ChannelPinnedMessage &&
          (message.embeds.some((messageEmbed) =>
            legacyEmbedHasMarker(messageEmbed, footerMarker),
          ) ||
            matchExisting?.(message)),
      );
    }

    if (existing) {
      const edited = await this.editManagedMessage(existing, payload).catch(
        (error) => {
          if (!this.isUnknownDiscordMessageError(error)) {
            throw error;
          }
          console.warn(
            `[DiscordSync] matched managed message disappeared channel=${channel.id} message=${existing.id}; recreating`,
          );
          return null;
        },
      );
      if (edited) {
        return pinIfNeeded(edited);
      }
    }

    const { attachments: _editAttachments, content, ...sendRest } = payload;
    const sendPayload =
      content === null || content === undefined
        ? sendRest
        : { ...sendRest, content };
    const sent = await channel.send(sendPayload);
    return pinIfNeeded(sent);
  }

  private async upsertManagedMessage(
    channel: TextChannel,
    messageId: string | null,
    footerMarker: string,
    payload: ManagedMessagePayload,
    matchExisting?: ManagedMessageMatcher,
  ): Promise<Message> {
    const botUserId = channel.client.user?.id;
    const stored = messageId
      ? await channel.messages.fetch(messageId).catch(() => null)
      : null;
    if (stored && stored.author.id === botUserId) {
      const edited = await this.editManagedMessage(stored, payload).catch(
        (error) => {
          if (!this.isUnknownDiscordMessageError(error)) {
            throw error;
          }
          console.warn(
            `[DiscordSync] stored managed message disappeared channel=${channel.id} message=${stored.id}; recreating`,
          );
          return null;
        },
      );
      if (edited) {
        return edited;
      }
    }

    const messages = await channel.messages
      .fetch({ limit: 100 })
      .catch(() => null);
    const existing = messages?.find(
      (message) =>
        message.author.id === botUserId &&
        (message.embeds.some((messageEmbed) =>
          legacyEmbedHasMarker(messageEmbed, footerMarker),
        ) ||
          matchExisting?.(message)),
    );

    if (existing) {
      const edited = await this.editManagedMessage(existing, payload).catch(
        (error) => {
          if (!this.isUnknownDiscordMessageError(error)) {
            throw error;
          }
          console.warn(
            `[DiscordSync] matched managed message disappeared channel=${channel.id} message=${existing.id}; recreating`,
          );
          return null;
        },
      );
      if (edited) {
        return edited;
      }
    }

    const { attachments: _editAttachments, content, ...sendRest } = payload;
    const sendPayload =
      content === null || content === undefined
        ? sendRest
        : { ...sendRest, content };
    return channel.send(sendPayload);
  }

  private async deleteManagedMessage(
    channel: TextChannel,
    messageId: string | null,
    footerMarker: string,
    matchExisting?: ManagedMessageMatcher,
  ) {
    const botUserId = channel.client.user?.id;
    const stored = messageId
      ? await channel.messages.fetch(messageId).catch(() => null)
      : null;
    if (stored && stored.author.id === botUserId) {
      await stored.delete().catch(() => undefined);
      return;
    }

    const messages = await channel.messages
      .fetch({ limit: 100 })
      .catch(() => null);
    const existing = messages?.filter(
      (message) =>
        message.author.id === botUserId &&
        (message.embeds.some((messageEmbed) =>
          legacyEmbedHasMarker(messageEmbed, footerMarker),
        ) ||
          matchExisting?.(message)),
    );
    for (const message of existing?.values() ?? []) {
      await message.delete().catch(() => undefined);
    }
  }

  private async syncPlayConfirmationMessage(
    channel: TextChannel,
    session: Pick<SessionResponse, "id">,
    config?: SessionDiscordConfigResponse | null,
    now = new Date(),
  ): Promise<Message | null> {
    const footerMarker = marker(session.id, "confirmation");
    const messageId = managedMessageId(config, "managedConfirmationMessageId");
    const confirmationOpen = playConfirmationWindow(config, now).allowsAction;
    if (!playConfirmationMessageEnabled(config) || !confirmationOpen) {
      await this.deleteManagedMessage(channel, messageId, footerMarker);
      await this.cleanupStandalonePlayConfirmationMessages(
        channel,
        footerMarker,
        config,
      );
      return null;
    }

    const content = this.playConfirmationMessageContent(session, config, now);
    return this.upsertManagedMessage(
      channel,
      messageId,
      footerMarker,
      {
        content,
        embeds: [],
        components: this.buildPlayConfirmationRows(session, config),
        allowedMentions: allowedMentionsForOrganizerText(content),
      },
      (message) =>
        this.matchesPlayConfirmationMessage(message, footerMarker, config),
    );
  }

  private playConfirmationMessageContent(
    session: Pick<SessionResponse, "id">,
    config?: SessionDiscordConfigResponse | null,
    now = new Date(),
  ) {
    const confirmationStatus = playConfirmationWindowStatusText(config, now);
    return limitDiscordMessageContent(
      [
        `**${playConfirmationMessageTitle(config)}**`,
        playConfirmationMessageText(config),
        confirmationStatus ? `**Window**\n${confirmationStatus}` : "",
      ]
        .filter(Boolean)
        .join("\n\n"),
    );
  }

  private matchesPlayConfirmationMessage(
    message: Message,
    footerMarker: string,
    config?: SessionDiscordConfigResponse | null,
  ) {
    const title = playConfirmationMessageTitle(config);
    const description = playConfirmationMessageText(config);
    const content = this.normalizedManagedContent(message.content).trim();
    return (
      (content.includes(title) && content.includes(description)) ||
      message.embeds.some(
        (embed) =>
          legacyEmbedHasMarker(embed, footerMarker) ||
          embed.title === title ||
          embed.description === description,
      ) ||
      this.componentCustomIds(message).some((customId) =>
        customId.startsWith("play:"),
      )
    );
  }

  private componentCustomIds(message: Message) {
    const rows = message.components as Array<{
      components?: Array<{ customId?: string | null }>;
    }>;
    return rows.flatMap((row) =>
      (row.components ?? [])
        .map((component) => component.customId)
        .filter((customId): customId is string => Boolean(customId)),
    );
  }

  private async cleanupStandalonePlayConfirmationMessages(
    channel: TextChannel,
    footerMarker: string,
    config?: SessionDiscordConfigResponse | null,
  ) {
    const botUserId = channel.client.user?.id;
    if (!botUserId) {
      return;
    }

    const messages: Message[] = [];
    let before: string | undefined;
    while (messages.length < REGISTRATION_CONTROL_CLEANUP_SCAN_LIMIT) {
      const limit = Math.min(
        100,
        REGISTRATION_CONTROL_CLEANUP_SCAN_LIMIT - messages.length,
      );
      const batch = await channel.messages
        .fetch({ limit, ...(before ? { before } : {}) })
        .catch(() => null);
      if (!batch || batch.size === 0) {
        break;
      }
      messages.push(...batch.values());
      before = batch.last()?.id;
      if (!before || batch.size < limit) {
        break;
      }
    }

    for (const message of messages) {
      if (message.author.id !== botUserId || message.pinned) {
        continue;
      }

      if (this.matchesPlayConfirmationMessage(message, footerMarker, config)) {
        await message.delete().catch(() => undefined);
      }
    }
  }

  private async cleanupStaleRegistrationControlMessages(
    guild: Guild,
    setup: ScrimDiscordSetup,
    session: Pick<SessionResponse, "id">,
    registrations: SessionRegistrationResponse[],
  ) {
    if (!setup.manageChannelId) {
      return;
    }

    const channel = await this.fetchTextChannel(
      guild,
      setup.manageChannelId,
    ).catch(() => null);
    const botUserId = channel?.client.user?.id;
    if (!channel || !botUserId) {
      return;
    }

    const perTeamControlRegistrationIds = new Set(
      registrations
        .filter(
          (registration) =>
            registration.status !== "REMOVED" &&
            registration.status !== "DECLINED" &&
            registration.status !== "WAITLIST",
        )
        .map((registration) => registration.id),
    );
    const messages = await channel.messages
      .fetch({ limit: 100 })
      .catch(() => null);
    if (!messages) {
      return;
    }

    for (const message of messages.values()) {
      if (message.author.id !== botUserId || message.pinned) {
        continue;
      }

      const customIds = this.componentCustomIds(message).filter((customId) =>
        customId.startsWith("regctl:"),
      );
      const hasRegistrationControlFooter = message.embeds.some(
        (embed) => embed.footer?.text === "Arenzyra Registration Control",
      );
      if (!customIds.length && !hasRegistrationControlFooter) {
        continue;
      }

      const parsed = customIds.map((customId) => {
        const [, , controlSessionId, registrationId] = customId.split(":");
        return { controlSessionId, registrationId };
      });
      const stale =
        parsed.length === 0 ||
        parsed.some(
          ({ controlSessionId, registrationId }) =>
            controlSessionId !== session.id ||
            !perTeamControlRegistrationIds.has(registrationId),
        );

      if (stale) {
        await message.delete().catch(() => undefined);
      }
    }
  }

  private async syncPlayConfirmationReactions(
    message: Message,
    config?: SessionDiscordConfigResponse | null,
  ) {
    const botUserId = message.client.user?.id;
    const fresh = await message.fetch().catch((error) => {
      if (this.isUnknownDiscordMessageError(error)) {
        console.warn(
          `[DiscordSync] skipped play confirmation reactions for missing message channel=${message.channelId} message=${message.id}`,
        );
        return null;
      }
      throw error;
    });
    if (!fresh) {
      return;
    }
    const desiredReactions =
      playConfirmationReactionsEnabled(config) &&
      playConfirmationWindow(config).allowsAction
        ? [
            configuredButtonEmoji("playConfirmEmoji", "check", config),
            configuredButtonEmoji("playNotPlayingEmoji", "reject", config),
          ]
            .map((emoji) =>
              emoji ? this.reactionEmojiIdentifier(emoji) : null,
            )
            .filter((emoji): emoji is string => Boolean(emoji))
        : [];
    const desiredReactionSet = new Set(desiredReactions);
    const existingReactions = [...fresh.reactions.cache.values()];

    if (botUserId) {
      await Promise.all(
        existingReactions
          .filter(
            (reaction) =>
              reaction.me &&
              !desiredReactionSet.has(this.messageReactionIdentifier(reaction)),
          )
          .map((reaction) =>
            reaction.users.remove(botUserId).catch(() => undefined),
          ),
      );
    }

    for (const reaction of desiredReactionSet) {
      const alreadyAddedByBot = existingReactions.some(
        (existingReaction) =>
          existingReaction.me &&
          this.messageReactionIdentifier(existingReaction) === reaction,
      );
      if (alreadyAddedByBot) {
        continue;
      }
      await fresh.react(reaction).catch((error) => {
        if (this.isUnknownDiscordMessageError(error)) {
          console.warn(
            `[DiscordSync] skipped missing play confirmation message channel=${fresh.channelId} message=${fresh.id}`,
          );
          return;
        }
        console.warn(
          `Failed to add play confirmation reaction ${reaction}:`,
          error,
        );
      });
    }
  }

  private reactionEmojiIdentifier(value: string) {
    const trimmed = value.trim();
    const custom = /^<a?:([^:>]+):(\d+)>$/.exec(trimmed);
    return custom ? `${custom[1]}:${custom[2]}` : trimmed;
  }

  private messageReactionIdentifier(reaction: MessageReaction) {
    const name = reaction.emoji.name?.trim();
    const id = reaction.emoji.id?.trim();
    if (name && id) {
      return `${name}:${id}`;
    }
    return name ?? "";
  }

  private buildPlayConfirmationRows(
    session: Pick<SessionResponse, "id">,
    config?: SessionDiscordConfigResponse | null,
  ) {
    if (
      !playConfirmationButtonsEnabled(config) ||
      !playConfirmationWindow(config).allowsAction
    ) {
      return [];
    }

    const confirmLabel = configuredButtonLabel(
      "playConfirmLabel",
      "Confirm",
      config,
    );
    const confirmEmoji = configuredButtonEmoji(
      "playConfirmEmoji",
      "check",
      config,
    );
    const confirmButton = new ButtonBuilder()
      .setCustomId(`play:confirm:${session.id}`)
      .setStyle(
        this.buttonStyle(
          configuredButtonStyle("playConfirmStyle", "success", config),
        ),
      )
      .setDisabled(false);
    if (confirmLabel) {
      confirmButton.setLabel(confirmLabel);
    }
    if (confirmEmoji) {
      confirmButton.setEmoji(confirmEmoji);
    }
    if (!confirmLabel && !confirmEmoji) {
      confirmButton.setLabel("Confirm");
    }

    const notPlayingLabel = configuredButtonLabel(
      "playNotPlayingLabel",
      "Not Playing",
      config,
    );
    const notPlayingEmoji = configuredButtonEmoji(
      "playNotPlayingEmoji",
      "reject",
      config,
    );
    const notPlayingButton = new ButtonBuilder()
      .setCustomId(`play:not:${session.id}`)
      .setStyle(
        this.buttonStyle(
          configuredButtonStyle("playNotPlayingStyle", "danger", config),
        ),
      )
      .setDisabled(false);
    if (notPlayingLabel) {
      notPlayingButton.setLabel(notPlayingLabel);
    }
    if (notPlayingEmoji) {
      notPlayingButton.setEmoji(notPlayingEmoji);
    }
    if (!notPlayingLabel && !notPlayingEmoji) {
      notPlayingButton.setLabel("Not Playing");
    }

    return [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        confirmButton,
        notPlayingButton,
      ),
    ];
  }

  private buttonStyle(style: "primary" | "secondary" | "success" | "danger") {
    switch (style) {
      case "primary":
        return ButtonStyle.Primary;
      case "secondary":
        return ButtonStyle.Secondary;
      case "danger":
        return ButtonStyle.Danger;
      case "success":
      default:
        return ButtonStyle.Success;
    }
  }

  private emojiAssetPath(filename: string) {
    return path.resolve(__dirname, "..", "..", "assets", filename);
  }

  private emojiNameHash(value: string, length = 8) {
    return createHash("sha1").update(value).digest("hex").slice(0, length);
  }

  private serverLogoEmojiName(guild: Guild) {
    const iconHash = (guild as { icon?: string | null }).icon ?? "none";
    return `${SERVER_TEAM_LOGO_EMOJI_PREFIX}_${SERVER_TEAM_LOGO_EMOJI_VERSION}_${this.emojiNameHash(
      guild.id,
    )}_${this.emojiNameHash(iconHash, 6)}`;
  }

  private teamLogoEmojiName(teamId: string, logoUrl: string) {
    return `${TEAM_LOGO_EMOJI_PREFIX}_${TEAM_LOGO_EMOJI_VERSION}_${this.emojiNameHash(
      teamId,
      10,
    )}_${this.emojiNameHash(logoUrl, 6)}`;
  }

  private managedTeamLogoEmojiName(name: string | null | undefined) {
    return TEAM_LOGO_EMOJI_NAME_PATTERN.test(name ?? "");
  }

  private managedRosterLogoEmojiName(name: string | null | undefined) {
    return Boolean(
      this.managedTeamLogoEmojiName(name) ||
        name === DEFAULT_TEAM_LOGO_EMOJI_NAME ||
        SERVER_TEAM_LOGO_EMOJI_NAME_PATTERN.test(name ?? ""),
    );
  }

  private findGuildEmoji(guild: Guild, name: string): GuildEmoji | null {
    return guild.emojis.cache.find((emoji) => emoji.name === name) ?? null;
  }

  private findApplicationEmoji(
    manager: ApplicationEmojiManager | null,
    name: string,
  ): ApplicationEmoji | null {
    return manager?.cache.find((emoji) => emoji.name === name) ?? null;
  }

  private throwIfAborted(signal?: AbortSignal) {
    if (!signal?.aborted) {
      return;
    }
    const error = new Error("Team logo emoji resolution aborted");
    error.name = "AbortError";
    throw error;
  }

  private isAbortError(error: unknown) {
    return (
      (error as { name?: unknown })?.name === "AbortError" ||
      /aborted/i.test(String(error))
    );
  }

  private emojiMention(
    emoji: Pick<GuildEmoji | ApplicationEmoji, "animated" | "id" | "name">,
  ) {
    return `<${emoji.animated ? "a" : ""}:${emoji.name}:${emoji.id}>`;
  }

  private applicationEmojiManager(guild: Guild) {
    return (
      (guild as { client?: { application?: { emojis?: ApplicationEmojiManager } | null } })
        .client?.application?.emojis ?? null
    );
  }

  private async prepareApplicationEmojiManager(guild: Guild) {
    const manager = this.applicationEmojiManager(guild);
    if (!manager) {
      return null;
    }

    const applicationId = manager.application.id;
    let state = this.applicationEmojiCacheStates.get(applicationId);
    const now = Date.now();
    if (state && state.expiresAt > now) {
      return manager;
    }

    if (!state) {
      state = { expiresAt: 0 };
      this.applicationEmojiCacheStates.set(applicationId, state);
    }

    if (!state.refresh) {
      state.refresh = manager
        .fetch(undefined, { force: true })
        .then(() => {
          state.expiresAt = Date.now() + APPLICATION_EMOJI_CACHE_TTL_MS;
          return true;
        })
        .catch((error) => {
          state.expiresAt = Date.now() + 10_000;
          console.warn(
            `Application emoji cache refresh failed: ${String(error)}`,
          );
          return false;
        })
        .finally(() => {
          state.refresh = undefined;
        });
    }

    return (await state.refresh) ? manager : null;
  }

  private applicationEmojiCacheState(manager: ApplicationEmojiManager) {
    const applicationId = manager.application.id;
    let state = this.applicationEmojiCacheStates.get(applicationId);
    if (!state) {
      state = { expiresAt: 0 };
      this.applicationEmojiCacheStates.set(applicationId, state);
    }
    return state;
  }

  private isDiscordEmojiCapacityError(error: unknown) {
    const code = (error as { code?: unknown })?.code;
    return (
      code === 30008 || /Maximum number of emojis reached/i.test(String(error))
    );
  }

  private markApplicationEmojiFull(
    manager: ApplicationEmojiManager,
    label: string,
  ) {
    const state = this.applicationEmojiCacheState(manager);
    const now = Date.now();
    if ((state.fullWarningExpiresAt ?? 0) <= now) {
      console.warn(
        `${label} application emoji skipped: application emoji slots are full (${manager.cache.size}/${APPLICATION_EMOJI_LIMIT}).`,
      );
      state.fullWarningExpiresAt =
        now + APPLICATION_EMOJI_FULL_WARNING_TTL_MS;
    }
  }

  private canCreateApplicationEmoji(
    manager: ApplicationEmojiManager,
    label: string,
  ) {
    if (manager.cache.size < APPLICATION_EMOJI_LIMIT) {
      return true;
    }

    this.markApplicationEmojiFull(manager, label);
    return false;
  }

  private async createApplicationEmoji(
    manager: ApplicationEmojiManager,
    name: string,
    attachment: Buffer,
    label: string,
  ) {
    if (!this.canCreateApplicationEmoji(manager, label)) {
      return null;
    }

    const key = `${manager.application.id}:${name}`;
    const existing = this.applicationEmojiCreates.get(key);
    if (existing) {
      return existing;
    }

    const created = manager
      .create({ attachment, name })
      .catch(async (error) => {
        if (this.isDiscordEmojiCapacityError(error)) {
          this.markApplicationEmojiFull(manager, label);
          return null;
        }
        const recovered = await this.refreshApplicationEmojiManager(
          manager,
        ).then((refreshedManager) =>
          refreshedManager ? this.findApplicationEmoji(refreshedManager, name) : null,
        );
        if (recovered) {
          return recovered;
        }
        console.warn(
          `${label} application emoji could not be prepared: ${String(error)}`,
        );
        return null;
      })
      .finally(() => {
        this.applicationEmojiCreates.delete(key);
      });
    this.applicationEmojiCreates.set(key, created);
    return created;
  }

  private async refreshApplicationEmojiManager(
    manager: ApplicationEmojiManager,
  ) {
    const state = this.applicationEmojiCacheState(manager);
    try {
      await manager.fetch(undefined, { force: true });
      state.expiresAt = Date.now() + APPLICATION_EMOJI_CACHE_TTL_MS;
      return manager;
    } catch (error) {
      state.expiresAt = Date.now() + 10_000;
      console.warn(`Application emoji cache refresh failed: ${String(error)}`);
      return null;
    }
  }

  private async refreshGuildEmojis(guild: Guild, label: string) {
    try {
      const fetched = await guild.emojis.fetch();
      if (!fetched || typeof fetched.keys !== "function") {
        return false;
      }
      // Application emojis can appear in the in-memory guild emoji cache even
      // though they are not guild emojis. Discord turns those emoji mentions
      // into raw colon-name-colon text inside embeds. Keep only the authoritative
      // guild-emoji response so a legacy application logo is never reused in
      // a slot or waitlist list.
      const fetchedIds = new Set(fetched.keys());
      for (const [emojiId] of guild.emojis.cache) {
        if (!fetchedIds.has(emojiId)) {
          guild.emojis.cache.delete(emojiId);
        }
      }
      return true;
    } catch (error) {
      console.warn(`${label} guild emoji cache refresh failed: ${String(error)}`);
      return false;
    }
  }

  private async createGuildEmoji(
    guild: Guild,
    name: string,
    attachment: () => Promise<Buffer> | Buffer,
    reason: string,
    label: string,
    signal?: AbortSignal,
  ) {
    const cached = this.findGuildEmoji(guild, name);
    if (cached) {
      return cached;
    }

    const key = `${guild.id}:${name}`;
    const existingCreate = this.guildEmojiCreates.get(key);
    if (existingCreate) {
      return existingCreate;
    }

    const created = (async () => {
      this.throwIfAborted(signal);
      if (!this.canCreateStaticEmoji(guild, label)) {
        return null;
      }

      try {
        const emoji = await guild.emojis.create({
          attachment: await attachment(),
          name,
          reason,
        });
        return emoji;
      } catch (error) {
        if (this.isAbortError(error)) {
          throw error;
        }
        await this.refreshGuildEmojis(guild, label);
        const recovered = this.findGuildEmoji(guild, name);
        if (recovered) {
          return recovered;
        }
        console.warn(`${label} could not be prepared: ${String(error)}`);
        return null;
      }
    })().finally(() => {
      this.guildEmojiCreates.delete(key);
    });

    this.guildEmojiCreates.set(key, created);
    return created;
  }

  private isUnknownDiscordEmojiError(error: unknown) {
    const code = (error as { code?: unknown })?.code;
    return code === 10014 || /Unknown Emoji/i.test(String(error));
  }

  private staticEmojiCapacity(guild: Guild) {
    const staticCount = [...guild.emojis.cache.values()].filter(
      (emoji) => !emoji.animated,
    ).length;
    const premiumTier = Number(
      (guild as { premiumTier?: number | string | null }).premiumTier ?? 0,
    );
    const limit =
      premiumTier >= 3
        ? 250
        : premiumTier >= 2
          ? 150
          : premiumTier >= 1
            ? 100
            : 50;
    return { staticCount, limit };
  }

  private canCreateStaticEmoji(guild: Guild, label: string) {
    const { staticCount, limit } = this.staticEmojiCapacity(guild);
    if (staticCount < limit) {
      return true;
    }

    console.warn(
      `${label} skipped: server static emoji slots are full (${staticCount}/${limit}).`,
    );
    return false;
  }

  private removeEmojiFromCache(guild: Guild, emoji: GuildEmoji) {
    for (const [key, cachedEmoji] of guild.emojis.cache) {
      if (cachedEmoji.id === emoji.id) {
        guild.emojis.cache.delete(key);
      }
    }
  }

  private scheduleManagedTeamLogoEmojiCleanup(guild: Guild) {
    if (
      !guild?.id ||
      !guild.emojis?.cache ||
      typeof guild.emojis.fetch !== "function"
    ) {
      return;
    }
    const now = Date.now();
    if (
      (this.teamLogoEmojiCleanupAfter.get(guild.id) ?? 0) > now ||
      this.teamLogoEmojiCleanups.has(guild.id)
    ) {
      return;
    }

    this.teamLogoEmojiCleanupAfter.set(
      guild.id,
      now + TEAM_LOGO_EMOJI_CLEANUP_INTERVAL_MS,
    );
    const cleanup = this.pruneManagedTeamLogoEmojis(guild)
      .then(() => undefined)
      .catch((error) => {
        console.warn(
          `Managed team logo emoji cleanup failed in guild ${guild.id}: ${String(
            error,
          )}`,
        );
      })
      .finally(() => {
        this.teamLogoEmojiCleanups.delete(guild.id);
      });
    this.teamLogoEmojiCleanups.set(guild.id, cleanup);
  }

  private async pruneManagedTeamLogoEmojis(guild: Guild) {
    const refreshed = await this.refreshGuildEmojis(
      guild,
      "Managed team logo emoji cleanup",
    );
    if (!refreshed) {
      return 0;
    }
    let remaining = MAX_STALE_TEAM_LOGO_EMOJI_DELETE;
    let guildDeleted = 0;
    let applicationDeleted = 0;
    const guildCandidates = [...guild.emojis.cache.values()]
      .filter((emoji) => this.managedRosterLogoEmojiName(emoji.name))
      .slice(0, remaining);

    for (const emoji of guildCandidates) {
      try {
        await emoji.delete(
          "Arenzyra native roster rows no longer use generated logo emojis",
        );
        this.removeEmojiFromCache(guild, emoji);
        guildDeleted += 1;
        remaining -= 1;
      } catch (error) {
        if (this.isUnknownDiscordEmojiError(error)) {
          this.removeEmojiFromCache(guild, emoji);
          guildDeleted += 1;
          remaining -= 1;
          continue;
        }
        console.warn(
          `Managed guild team logo emoji cleanup failed for ${emoji.name}: ${String(
            error,
          )}`,
        );
      }
    }

    if (remaining > 0) {
      const manager = await this.prepareApplicationEmojiManager(guild);
      const applicationCandidates = manager
        ? [...manager.cache.values()]
            .filter((emoji) => this.managedRosterLogoEmojiName(emoji.name))
            .slice(0, remaining)
        : [];
      for (const emoji of applicationCandidates) {
        try {
          await emoji.delete();
          manager?.cache.delete(emoji.id);
          applicationDeleted += 1;
          remaining -= 1;
        } catch (error) {
          if (this.isUnknownDiscordEmojiError(error)) {
            manager?.cache.delete(emoji.id);
            applicationDeleted += 1;
            remaining -= 1;
            continue;
          }
          console.warn(
            `Managed application team logo emoji cleanup failed for ${emoji.name}: ${String(
              error,
            )}`,
          );
        }
      }
    }

    const deleted = guildDeleted + applicationDeleted;
    if (deleted > 0) {
      console.log(
        `Cleaned ${deleted} Arenzyra roster logo emoji(s) in guild ${guild.id} (${guildDeleted} guild, ${applicationDeleted} application); native roster rows use zero logo emoji slots.`,
      );
    }
    return deleted;
  }

  private async pruneDuplicateTeamLogoEmojis(guild: Guild) {
    const seenNames = new Set<string>();
    const duplicateCandidates: GuildEmoji[] = [];
    for (const emoji of guild.emojis.cache.values()) {
      if (emoji.animated || !this.managedTeamLogoEmojiName(emoji.name)) {
        continue;
      }
      const name = emoji.name ?? "";
      if (seenNames.has(name)) {
        duplicateCandidates.push(emoji);
        continue;
      }
      seenNames.add(name);
    }

    const candidates = duplicateCandidates.slice(
      0,
      MAX_STALE_TEAM_LOGO_EMOJI_DELETE,
    );
    if (candidates.length <= 0) {
      return 0;
    }

    let deleted = 0;
    for (const emoji of candidates) {
      try {
        await emoji.delete(
          "Arenzyra cleanup of duplicate generated team logo emoji",
        );
        this.removeEmojiFromCache(guild, emoji);
        deleted += 1;
      } catch (error) {
        if (this.isUnknownDiscordEmojiError(error)) {
          this.removeEmojiFromCache(guild, emoji);
          deleted += 1;
          continue;
        }
        console.warn(
        `Duplicate team logo emoji cleanup failed for ${emoji.name}: ${String(
            error,
          )}`,
        );
      }
    }

    if (deleted > 0) {
      console.log(
        `Cleaned ${deleted} duplicate Arenzyra team logo emoji(s) in guild ${guild.id}`,
      );
    }
    return deleted;
  }

  private async ensureDefaultTeamLogoEmoji(
    guild: Guild,
    config?: SessionDiscordConfigResponse | null,
    applicationEmojis?: ApplicationEmojiManager | null,
    signal?: AbortSignal,
  ) {
    const existing = this.findGuildEmoji(guild, DEFAULT_TEAM_LOGO_EMOJI_NAME);
    if (existing) {
      return this.emojiMention(existing);
    }
    const defaultAttachment = () =>
      readFileSync(this.emojiAssetPath("arenzyra-discord-icon-blue-a.png"));
    if (this.canCreateStaticEmoji(guild, "Default team logo emoji")) {
      const emoji = await this.createGuildEmoji(
        guild,
        DEFAULT_TEAM_LOGO_EMOJI_NAME,
        defaultAttachment,
        "Arenzyra default team logo for scrim slot lists",
        "Default team logo emoji",
        signal,
      );
      if (emoji) {
        return this.emojiMention(emoji);
      }
    }

    const existingApplicationEmoji = this.findApplicationEmoji(
      applicationEmojis ?? null,
      DEFAULT_TEAM_LOGO_EMOJI_NAME,
    );
    if (existingApplicationEmoji) {
      return this.emojiMention(existingApplicationEmoji);
    }
    if (
      applicationEmojis &&
      this.canCreateApplicationEmoji(applicationEmojis, "Default team logo")
    ) {
      const emoji = await this.createApplicationEmoji(
        applicationEmojis,
        DEFAULT_TEAM_LOGO_EMOJI_NAME,
        defaultAttachment(),
        "Default team logo",
      );
      if (emoji) {
        return this.emojiMention(emoji);
      }
    }

    return resolveDiscordEmoji("team", config);
  }

  private serverIconUrl(guild: Guild) {
    const iconHash = (guild as { icon?: string | null }).icon?.trim();
    if (!iconHash) {
      return null;
    }
    return `${DISCORD_CDN_BASE_URL}/icons/${guild.id}/${iconHash}.png?size=${EMOJI_IMAGE_SIZE}`;
  }

  private async ensureServerTeamLogoEmoji(
    guild: Guild,
    fallbackEmoji: string,
    applicationEmojis?: ApplicationEmojiManager | null,
    signal?: AbortSignal,
  ) {
    const iconUrl = this.serverIconUrl(guild);
    if (!iconUrl) {
      return fallbackEmoji;
    }

    const name = this.serverLogoEmojiName(guild);
    const existing = this.findGuildEmoji(guild, name);
    if (existing) {
      return this.emojiMention(existing);
    }

    let attachment: Buffer | null = null;
    if (this.canCreateStaticEmoji(guild, "Server default team logo emoji")) {
      const emoji = await this.createGuildEmoji(
        guild,
        name,
        async () => {
          attachment = await this.fetchEmojiImage(iconUrl, signal);
          return attachment;
        },
        "Arenzyra server default team logo for scrim slot lists",
        "Server default team logo emoji",
        signal,
      );
      if (emoji) {
        return this.emojiMention(emoji);
      }
    }

    const existingApplicationEmoji = this.findApplicationEmoji(
      applicationEmojis ?? null,
      name,
    );
    if (existingApplicationEmoji) {
      return this.emojiMention(existingApplicationEmoji);
    }
    if (
      applicationEmojis &&
      this.canCreateApplicationEmoji(
        applicationEmojis,
        "Server default team logo",
      )
    ) {
      try {
        attachment = await this.fetchEmojiImage(iconUrl, signal);
        const emoji = await this.createApplicationEmoji(
          applicationEmojis,
          name,
          attachment,
          "Server default team logo",
        );
        if (emoji) {
          return this.emojiMention(emoji);
        }
      } catch (error) {
        if (this.isAbortError(error)) {
          throw error;
        }
        console.warn(
          `Server default team logo application emoji could not be prepared: ${String(
            error,
          )}`,
        );
      }
    }

    return fallbackEmoji;
  }

  private async ensureTeamLogoEmoji(
    guild: Guild,
    registration: SessionRegistrationResponse,
    applicationEmojis?: ApplicationEmojiManager | null,
    signal?: AbortSignal,
  ) {
    const logoUrl = registration.team?.logoUrl?.trim();
    if (!logoUrl) {
      return null;
    }

    const teamId = registration.team?.id?.trim() || registration.teamId;
    const name = this.teamLogoEmojiName(teamId, logoUrl);
    const existing = this.findGuildEmoji(guild, name);
    if (existing) {
      return this.emojiMention(existing);
    }

    let attachment: Buffer | null = null;
    if (this.canCreateStaticEmoji(guild, "Team logo emoji")) {
      const emoji = await this.createGuildEmoji(
        guild,
        name,
        async () => {
          attachment = await this.fetchEmojiImage(logoUrl, signal);
          return attachment;
        },
        `Arenzyra team logo for ${(
          registration.team?.tag ||
          registration.team?.name ||
          registration.teamId
        ).slice(0, 80)}`,
        `Team logo emoji for ${registration.teamId}`,
        signal,
      );
      if (emoji) {
        return this.emojiMention(emoji);
      }
    }

    const existingApplicationEmoji = this.findApplicationEmoji(
      applicationEmojis ?? null,
      name,
    );
    if (existingApplicationEmoji) {
      return this.emojiMention(existingApplicationEmoji);
    }

    if (
      applicationEmojis &&
      this.canCreateApplicationEmoji(applicationEmojis, "Team logo")
    ) {
      try {
        attachment = await this.fetchEmojiImage(logoUrl, signal);
        const emoji = await this.createApplicationEmoji(
          applicationEmojis,
          name,
          attachment,
          `Team logo for ${registration.teamId}`,
        );
        if (emoji) {
          return this.emojiMention(emoji);
        }
      } catch (error) {
        if (this.isAbortError(error)) {
          throw error;
        }
        console.warn(
          `Team logo application emoji could not be prepared for ${registration.teamId}: ${String(
            error,
          )}`,
        );
      }
    }

    return null;
  }

  private pixelOffset(x: number, y: number, width: number) {
    return (y * width + x) * 4;
  }

  private colorDistance(left: Rgb, right: Rgb) {
    return Math.sqrt(
      (left.r - right.r) ** 2 +
        (left.g - right.g) ** 2 +
        (left.b - right.b) ** 2,
    );
  }

  private pixelColor(data: Buffer, offset: number): Rgb {
    return {
      r: data[offset],
      g: data[offset + 1],
      b: data[offset + 2],
    };
  }

  private isBackgroundPixel(data: Buffer, offset: number, background: Rgb) {
    return (
      data[offset + 3] > 20 &&
      this.colorDistance(this.pixelColor(data, offset), background) <=
        BACKGROUND_MATCH_TOLERANCE
    );
  }

  private detectEdgeBackgroundColor(
    data: Buffer,
    width: number,
    height: number,
  ): Rgb | null {
    const bucketed = new Map<
      string,
      { count: number; r: number; g: number; b: number }
    >();
    let samples = 0;

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const nearEdge =
          x < BACKGROUND_SAMPLE_EDGE_SIZE ||
          y < BACKGROUND_SAMPLE_EDGE_SIZE ||
          x >= width - BACKGROUND_SAMPLE_EDGE_SIZE ||
          y >= height - BACKGROUND_SAMPLE_EDGE_SIZE;
        if (!nearEdge) {
          continue;
        }

        const offset = this.pixelOffset(x, y, width);
        if (data[offset + 3] < 180) {
          continue;
        }

        const r = data[offset];
        const g = data[offset + 1];
        const b = data[offset + 2];
        const key = [
          Math.floor(r / BACKGROUND_COLOR_BUCKET_SIZE),
          Math.floor(g / BACKGROUND_COLOR_BUCKET_SIZE),
          Math.floor(b / BACKGROUND_COLOR_BUCKET_SIZE),
        ].join(":");
        const existing = bucketed.get(key) ?? { count: 0, r: 0, g: 0, b: 0 };
        existing.count += 1;
        existing.r += r;
        existing.g += g;
        existing.b += b;
        bucketed.set(key, existing);
        samples += 1;
      }
    }

    if (samples < 20) {
      return null;
    }

    const dominant = [...bucketed.values()].sort(
      (left, right) => right.count - left.count,
    )[0];
    if (!dominant || dominant.count / samples < BACKGROUND_MIN_DOMINANCE) {
      return null;
    }

    return {
      r: dominant.r / dominant.count,
      g: dominant.g / dominant.count,
      b: dominant.b / dominant.count,
    };
  }

  private opaqueBounds(data: Buffer, width: number, height: number) {
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    let opaquePixels = 0;

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const offset = this.pixelOffset(x, y, width);
        if (data[offset + 3] <= 20) {
          continue;
        }
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
        opaquePixels += 1;
      }
    }

    return opaquePixels > 0 ? { minX, minY, maxX, maxY, opaquePixels } : null;
  }

  private removeEdgeBackground(
    data: Buffer,
    width: number,
    height: number,
  ): Buffer {
    const background = this.detectEdgeBackgroundColor(data, width, height);
    const bounds = this.opaqueBounds(data, width, height);
    if (!background || !bounds) {
      return data;
    }

    const output = Buffer.from(data);
    const visited = new Uint8Array(width * height);
    const queue: number[] = [];
    const enqueue = (x: number, y: number) => {
      if (x < 0 || y < 0 || x >= width || y >= height) {
        return;
      }
      const index = y * width + x;
      if (visited[index]) {
        return;
      }

      const offset = this.pixelOffset(x, y, width);
      if (!this.isBackgroundPixel(data, offset, background)) {
        return;
      }

      visited[index] = 1;
      queue.push(index);
    };

    for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
      enqueue(x, bounds.minY);
      enqueue(x, bounds.maxY);
    }
    for (let y = bounds.minY; y <= bounds.maxY; y += 1) {
      enqueue(bounds.minX, y);
      enqueue(bounds.maxX, y);
    }

    let cursor = 0;
    while (cursor < queue.length) {
      const index = queue[cursor];
      cursor += 1;
      const x = index % width;
      const y = Math.floor(index / width);
      enqueue(x + 1, y);
      enqueue(x - 1, y);
      enqueue(x, y + 1);
      enqueue(x, y - 1);
    }

    if (queue.length < 8 || queue.length > bounds.opaquePixels * 0.92) {
      return data;
    }

    for (const index of queue) {
      output[index * 4 + 3] = 0;
    }

    const featherLimit = Math.max(
      BACKGROUND_FEATHER_TOLERANCE,
      BACKGROUND_MATCH_TOLERANCE + 1,
    );
    for (const index of queue) {
      const x = index % width;
      const y = Math.floor(index / width);
      for (const [nextX, nextY] of [
        [x + 1, y],
        [x - 1, y],
        [x, y + 1],
        [x, y - 1],
      ]) {
        if (nextX < 0 || nextY < 0 || nextX >= width || nextY >= height) {
          continue;
        }
        const nextIndex = nextY * width + nextX;
        if (visited[nextIndex]) {
          continue;
        }
        const offset = nextIndex * 4;
        if (output[offset + 3] <= 20) {
          continue;
        }

        const distance = this.colorDistance(
          this.pixelColor(data, offset),
          background,
        );
        if (distance >= featherLimit) {
          continue;
        }

        const alphaRatio = Math.max(
          0,
          Math.min(
            1,
            (distance - BACKGROUND_MATCH_TOLERANCE) /
              (featherLimit - BACKGROUND_MATCH_TOLERANCE),
          ),
        );
        output[offset + 3] = Math.round(output[offset + 3] * alphaRatio);
      }
    }

    return output;
  }

  private async optimizeLogoForEmoji(source: Buffer) {
    const { data, info } = await sharp(source, {
      limitInputPixels: 4096 * 4096,
    })
      .rotate()
      .resize(EMOJI_IMAGE_SIZE, EMOJI_IMAGE_SIZE, {
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 },
        withoutEnlargement: false,
      })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const cleaned = this.removeEdgeBackground(
      Buffer.from(data),
      info.width,
      info.height,
    );

    return sharp(cleaned, {
      raw: {
        width: info.width,
        height: info.height,
        channels: 4,
      },
    })
      .png({
        compressionLevel: 9,
        palette: true,
        quality: 90,
      })
      .toBuffer();
  }

  private async fetchEmojiImage(logoUrl: string, signal?: AbortSignal) {
    this.throwIfAborted(signal);
    const { buffer: source } = await fetchRemoteRasterImage(logoUrl, {
      apiBaseUrl: botConfig.apiBaseUrl,
      maxBytes: MAX_SOURCE_LOGO_BYTES,
      maxPixels: 4096 * 4096,
      signal,
    });
    this.throwIfAborted(signal);

    const optimized = await this.optimizeLogoForEmoji(source);
    this.throwIfAborted(signal);

    if (optimized.length > MAX_EMOJI_IMAGE_BYTES) {
      throw new Error(
        "optimized logo is larger than Discord custom emoji size limit",
      );
    }

    return optimized;
  }

  private async resolveTeamLogoEmojis(
    guild: Guild,
    registrations: SessionRegistrationResponse[],
    config?: SessionDiscordConfigResponse | null,
    signal?: AbortSignal,
  ): Promise<
    Pick<
      SlotListRenderOptions,
      "teamLogoEmojiByTeamId" | "defaultTeamLogoEmoji"
    >
  > {
    if (botConfig.nodeEnv !== "test") {
      this.scheduleManagedTeamLogoEmojiCleanup(guild);
      return this.emptyTeamLogoRenderOptions();
    }
    if (config?.slotTeamEmojiEnabled === false) {
      return {
        teamLogoEmojiByTeamId: new Map(),
        defaultTeamLogoEmoji: null,
      };
    }

    this.throwIfAborted(signal);
    await this.refreshGuildEmojis(guild, "Guild emoji cache");
    this.throwIfAborted(signal);

    await this.pruneDuplicateTeamLogoEmojis(guild);
    this.throwIfAborted(signal);
    // Legacy implementation retained temporarily for compatibility tests.
    // Production message sync no longer calls this method: native Discord
    // roster rows intentionally avoid generated logo emojis.
    const applicationEmojis: ApplicationEmojiManager | null = null;
    this.throwIfAborted(signal);

    const arenzyraFallbackEmoji = await this.ensureDefaultTeamLogoEmoji(
      guild,
      config,
      applicationEmojis,
      signal,
    );
    const defaultTeamLogoEmoji = await this.ensureServerTeamLogoEmoji(
      guild,
      arenzyraFallbackEmoji,
      applicationEmojis,
      signal,
    );
    const teamLogoEmojiByTeamId = new Map<string, string>();
    const seenTeamIds = new Set<string>();

    for (const registration of registrations) {
      if (
        !activeRegistration(registration) ||
        seenTeamIds.has(registration.teamId)
      ) {
        continue;
      }
      seenTeamIds.add(registration.teamId);

      const emoji = await this.ensureTeamLogoEmoji(
        guild,
        registration,
        applicationEmojis,
        signal,
      );
      if (emoji) {
        teamLogoEmojiByTeamId.set(registration.teamId, emoji);
      }
    }

    return {
      teamLogoEmojiByTeamId,
      defaultTeamLogoEmoji,
    };
  }

  private emptyTeamLogoRenderOptions(): Pick<
    SlotListRenderOptions,
    "teamLogoEmojiByTeamId" | "defaultTeamLogoEmoji"
  > {
    return {
      teamLogoEmojiByTeamId: new Map(),
      defaultTeamLogoEmoji: null,
    };
  }

  private async resolveTeamLogoEmojisForMessage(
    guild: Guild,
    _registrations: SessionRegistrationResponse[],
    _config: SessionDiscordConfigResponse | null | undefined,
    _context: string,
  ): Promise<
    Pick<
      SlotListRenderOptions,
      "teamLogoEmojiByTeamId" | "defaultTeamLogoEmoji"
    >
  > {
    // Kept as a safe compatibility shim for older internal call sites. Team
    // logo emojis must never be created or rendered in managed list messages.
    this.scheduleManagedTeamLogoEmojiCleanup(guild);
    return this.emptyTeamLogoRenderOptions();
  }

  private buildSlotRosterImageRows(
    session: SessionResponse,
    registrations: SessionRegistrationResponse[],
    config?: SessionDiscordConfigResponse | null,
  ): SlotRosterImageRow[] {
    const normalRange = slotRangeForSession(session, config);
    const vipRange = vipSlotRangeForSession(session, config, normalRange);
    const bySlot = new Map(
      registrations
        .filter(
          (registration) =>
            activeRegistration(registration) &&
            registration.slotNumber !== null,
        )
        .map((registration) => [registration.slotNumber, registration]),
    );
    const rows: SlotRosterImageRow[] = [];
    const append = (slot: number, position: string) => {
      const registration = bySlot.get(slot);
      if (!registration) {
        rows.push({
          position,
          teamName: "EMPTY",
          empty: true,
        });
        return;
      }
      const playStatus = registrationPlayStatus(registration);
      rows.push({
        position,
        teamName:
          registration.team?.name?.trim() ||
          registration.team?.tag?.trim() ||
          registration.teamId,
        teamTag: registration.team?.tag,
        status: playStatus?.status ?? registration.status,
        logoUrl: registration.team?.logoUrl,
      });
    };

    for (
      let slot = normalRange.startSlot;
      slot <= normalRange.endSlot;
      slot += 1
    ) {
      append(slot, `#${slot}`);
    }
    for (let vip = 1; vip <= vipRange.capacity; vip += 1) {
      append(vipRange.startSlot + vip - 1, `VIP ${vip}`);
    }
    return rows;
  }

  private buildWaitlistRosterImageRows(
    registrations: SessionRegistrationResponse[],
  ): SlotRosterImageRow[] {
    return registrations
      .filter(
        (registration) =>
          activeRegistration(registration) &&
          registration.status === "WAITLIST" &&
          registration.waitlistPosition !== null,
      )
      .sort(
        (left, right) =>
          (left.waitlistPosition ?? Number.MAX_SAFE_INTEGER) -
          (right.waitlistPosition ?? Number.MAX_SAFE_INTEGER),
      )
      .map((registration) => ({
        position: `#${registration.waitlistPosition}`,
        teamName:
          registration.team?.name?.trim() ||
          registration.team?.tag?.trim() ||
          registration.teamId,
        teamTag: registration.team?.tag,
        status: "WAITLIST",
        logoUrl: registration.team?.logoUrl,
      }));
  }

  private async renderTeamLogoRosterImages(
    guild: Guild,
    session: SessionResponse,
    registrations: SessionRegistrationResponse[],
    config: SessionDiscordConfigResponse | null | undefined,
    context: string,
  ): Promise<{ slots: SlotRosterImagePage[]; waitlist: SlotRosterImagePage[] }> {
    // `slotTeamEmojiEnabled` is now a legacy custom-emoji switch. Roster
    // images consume zero emoji slots, so they remain enabled even when an
    // organizer previously disabled team emojis to avoid guild capacity.
    const slotRows = this.buildSlotRosterImageRows(
      session,
      registrations,
      config,
    );
    const waitlistRows = this.buildWaitlistRosterImageRows(registrations);
    const serverDefaultLogoUrl = this.serverIconUrl(guild);
    try {
      const [slots, waitlist] = await Promise.all([
        this.slotRosterImageRenderer.render(
          "slots",
          session.id,
          `${session.name} — Slot List`,
          slotRows,
          { serverDefaultLogoUrl },
        ),
        this.slotRosterImageRenderer.render(
          "waitlist",
          session.id,
          `${session.name} — Waitlist`,
          waitlistRows,
          { serverDefaultLogoUrl },
        ),
      ]);
      return { slots, waitlist };
    } catch (error) {
      console.warn(
        `Team logo roster image rendering failed for ${context}: ${String(
          error,
        )}; retaining the accessible text roster.`,
      );
      return { slots: [], waitlist: [] };
    }
  }

  private withoutRosterImageAttachments(
    payload: ManagedMessagePayload,
  ): ManagedMessagePayload {
    return {
      ...payload,
      // Native Discord rows are now authoritative. Explicitly remove any
      // roster image left by an earlier managed-message edit.
      files: [],
      attachments: [],
    };
  }

  private withRosterImagePages(
    payload: ManagedMessagePayload,
    pages: SlotRosterImagePage[],
  ): ManagedMessagePayload {
    if (pages.length === 0) {
      return this.withoutRosterImageAttachments(payload);
    }

    const sourceEmbed = payload.embeds?.[0]?.toJSON();
    const contentTitle = (payload.content ?? "")
      .split(/\r?\n/, 1)[0]
      .replace(/^\*\*|\*\*$/g, "")
      .trim();
    const pageTitle = pages[0].description
      .replace(/,\s*page\s+\d+\s+of\s+\d+$/i, "")
      .trim();
    const title = (
      sourceEmbed?.title?.trim() ||
      contentTitle ||
      pageTitle ||
      "Team Roster"
    ).slice(0, 256);
    const primaryEmbed = new EmbedBuilder()
      .setColor(sourceEmbed?.color ?? 0x0f172a)
      .setTitle(title)
      .setImage(`attachment://${pages[0].name}`);
    if (sourceEmbed?.fields?.length) {
      primaryEmbed.addFields(sourceEmbed.fields);
    }
    const embeds = [
      primaryEmbed,
      ...pages.slice(1).map((page) =>
        new EmbedBuilder()
          .setColor(0x0f172a)
          .setImage(`attachment://${page.name}`),
        ),
    ];
    const managerMentions = mentionMirrorContent(
      [payload.content ?? "", sourceEmbed?.description ?? ""].join("\n"),
    );

    return {
      ...payload,
      // The generated roster is the slot list. Do not repeat every row as
      // message text above the same image. Keep only the compact mention
      // mirror when the original plain list was responsible for notifying
      // team managers.
      content: managerMentions,
      embeds,
      allowedMentions: managerMentions
        ? allowedMentionsForRenderedMentions(managerMentions)
        : { parse: [] },
      files: pages.map(({ attachment, name, description }) => ({
        attachment,
        name,
        description,
      })),
      // Message edits retain old files unless their ids are explicitly
      // omitted. Clearing this list makes every deterministic roster render
      // replace the previous pages instead of accumulating attachments.
      attachments: [],
    };
  }

  private buildSlotListPayload(
    session: SessionResponse,
    registrations: SessionRegistrationResponse[],
    config?: SessionDiscordConfigResponse | null,
    opts: SlotListRenderOptions = {},
    components: ActionRowBuilder<ButtonBuilder>[] = [],
  ): ManagedMessagePayload {
    const safeComponents = playConfirmationButtonsEnabled(config)
      ? components
      : [];
    const view = this.buildSlotListView(session, registrations, config, opts);
    const renderPlainContent = (viewContent: typeof view) =>
      [
        `**${viewContent.title}**`,
        viewContent.description,
        ...viewContent.fields.map(
          (field) => `**${field.name}**\n${field.value}`,
        ),
      ].join("\n\n");
    const plainContent = renderPlainContent(view);
    const allowedMentions = allowedMentionsForRenderedMentions(plainContent);
    if (slotListMessageMode(config) === "plain") {
      if (plainContent.length <= 2000) {
        return {
          content: plainContent,
          embeds: [],
          components: safeComponents,
          allowedMentions,
        };
      }

      const noLogoView = this.buildSlotListView(
        session,
        registrations,
        config,
        {
          ...opts,
          compactRows: false,
          hideTeamLogos: true,
          shortenTeamNames: false,
        },
      );
      const noLogoContent = renderPlainContent(noLogoView);
      if (noLogoContent.length <= 2000) {
        return {
          content: noLogoContent,
          embeds: [],
          components: safeComponents,
          allowedMentions: allowedMentionsForRenderedMentions(noLogoContent),
        };
      }

      const compactView = this.buildSlotListView(
        session,
        registrations,
        config,
        {
          ...opts,
          compactRows: true,
          hideTeamLogos: true,
          shortenTeamNames: true,
        },
      );
      const compactContent = renderPlainContent(compactView);
      if (compactContent.length <= 2000) {
        return {
          content: compactContent,
          embeds: [],
          components: safeComponents,
          allowedMentions: allowedMentionsForRenderedMentions(compactContent),
        };
      }

      console.warn(
        `Plain slot list for ${session.id} is ${plainContent.length} chars (${noLogoContent.length} without logos, ${compactContent.length} compact); using embed fallback to avoid truncation.`,
      );
    }

    const embed = new EmbedBuilder()
      .setColor(0x232323)
      .setTitle(view.title)
      .setDescription(view.description)
      .setTimestamp(new Date());
    for (const field of view.fields) {
      embed.addFields(field);
    }
    return {
      // Manager mentions already live in their native roster rows. Keep the
      // message content empty so Discord does not render or notify a duplicate
      // "Managers:" line above the embed.
      content: null,
      embeds: [embed],
      components: safeComponents,
      allowedMentions: { parse: [] },
    };
  }

  private buildSlotListView(
    session: SessionResponse,
    registrations: SessionRegistrationResponse[],
    config?: SessionDiscordConfigResponse | null,
    opts: SlotListRenderOptions = {},
  ) {
    const { startSlot, endSlot } = slotRangeForSession(session, config);
    const vipRange = vipSlotRangeForSession(session, config, {
      startSlot,
      endSlot,
    });
    const confirmed = registrations
      .filter(
        (registration) =>
          activeRegistration(registration) &&
          registration.slotNumber !== null &&
          registration.slotNumber >= startSlot &&
          registration.slotNumber <= endSlot,
      )
      .sort((left, right) => (left.slotNumber ?? 0) - (right.slotNumber ?? 0));
    const confirmedBySlot = new Map(
      confirmed.map((registration) => [registration.slotNumber, registration]),
    );
    const vipConfirmed = registrations
      .filter(
        (registration) =>
          activeRegistration(registration) &&
          registration.slotNumber !== null &&
          registration.slotNumber >= vipRange.startSlot &&
          registration.slotNumber <= vipRange.endSlot,
      )
      .sort((left, right) => (left.slotNumber ?? 0) - (right.slotNumber ?? 0));
    const vipBySlot = new Map(
      vipConfirmed.map((registration) => [
        registration.slotNumber,
        registration,
      ]),
    );
    const assignableSlots = Math.max(0, endSlot - startSlot + 1);
    const lines: string[] = [];
    const empty = `${resolveDiscordEmoji("empty", config)} EMPTY`;
    const rowOptions = {
      hideLogo: Boolean(opts.hideTeamLogos || opts.compactRows),
      shortenName: Boolean(opts.shortenTeamNames || opts.compactRows),
    };

    for (let slot = startSlot; slot <= endSlot; slot += 1) {
      const registration = confirmedBySlot.get(slot);
      const rowMarker = slotListMarker({ slotNumber: slot, config });
      const playStatus = registration
        ? registrationPlayStatus(registration)
        : null;
      const row = `${rowMarker} ${
        registration
          ? formatTeamSlotRow(
              registration,
              opts.managerMentionByTeamId?.get(registration.teamId),
              opts.teamLogoEmojiByTeamId?.get(registration.teamId) ??
                opts.defaultTeamLogoEmoji,
              playStatus,
              rowOptions,
            )
          : empty
      }`;
      lines.push(formatPlayStatusRow(row, playStatus, config));
    }

    for (let vip = 1; vip <= vipRange.capacity; vip += 1) {
      const slot = vipRange.startSlot + vip - 1;
      const registration = vipBySlot.get(slot);
      const rowMarker = slotListMarker({
        slotNumber: slot,
        config,
        vipIndex: vip,
      });
      const playStatus = registration
        ? registrationPlayStatus(registration)
        : null;
      const row = `${rowMarker} ${
        registration
          ? formatTeamSlotRow(
              registration,
              opts.managerMentionByTeamId?.get(registration.teamId),
              opts.teamLogoEmojiByTeamId?.get(registration.teamId) ??
                opts.defaultTeamLogoEmoji,
              playStatus,
              rowOptions,
            )
          : empty
      }`;
      lines.push(formatPlayStatusRow(row, playStatus, config));
    }

    const title =
      vipRange.capacity > 0
        ? `${resolveDiscordEmoji("slot", config)} Slot List (${confirmed.length}/${assignableSlots}) | ${resolveDiscordEmoji("vip", config)} VIP ${vipConfirmed.length}/${vipRange.capacity}`
        : `${resolveDiscordEmoji("slot", config)} Slot List (${confirmed.length}/${assignableSlots})`;

    const fields: Array<{ name: string; value: string; inline: boolean }> = [];
    const confirmationStatus = playConfirmationWindowStatusText(config);
    if (confirmationStatus) {
      fields.push({
        name: "Confirmation",
        value: confirmationStatus,
        inline: false,
      });
    }
    return {
      title,
      description:
        lines.length > 0
          ? lines.join("\n")
          : "No assignable slots are configured.",
      fields,
    };
  }

  buildWaitlistControlPanelPayload(
    session: SessionResponse,
    registrations: SessionRegistrationResponse[],
    config?: SessionDiscordConfigResponse | null,
    requestedPage = 0,
  ): WaitlistControlPanelPayload {
    const waitlist = registrations
      .filter(
        (registration) =>
          registration.status === "WAITLIST" &&
          registration.waitlistPosition !== null,
      )
      .sort(
        (left, right) =>
          (left.waitlistPosition ?? Number.MAX_SAFE_INTEGER) -
          (right.waitlistPosition ?? Number.MAX_SAFE_INTEGER),
      );
    const { page, totalPages } = clampWaitlistControlPage(
      waitlist.length,
      requestedPage,
    );
    const pageStart = page * WAITLIST_CONTROL_PAGE_SIZE;
    const visibleWaitlist = waitlist.slice(
      pageStart,
      pageStart + WAITLIST_CONTROL_PAGE_SIZE,
    );
    const descriptionLines =
      visibleWaitlist.length > 0
        ? [
            `Select a team below, then choose Approve, Set Slot, VIP, or Remove.`,
            `Page ${page + 1}/${totalPages}`,
            "",
            ...visibleWaitlist.map((registration) => {
              const teamName =
                registration.team?.name?.trim() ||
                registration.teamId ||
                "Unknown Team";
              const tag = registration.team?.tag?.trim();
              const label = tag ? `[${tag}] ${teamName}` : teamName;
              return `**${registration.waitlistPosition}.** ${truncateDiscordOptionText(
                label,
                120,
              )}`;
            }),
          ]
        : ["No teams are currently on the waitlist."];
    const embed = new EmbedBuilder()
      .setColor(0xf59e0b)
      .setTitle("Waitlist Control")
      .setDescription(descriptionLines.join("\n"))
      .setFooter({ text: "Arenzyra Waitlist Control" })
      .setTimestamp(new Date());

    const components: ManagedMessageComponentRow[] = [];
    if (visibleWaitlist.length > 0) {
      const options = visibleWaitlist.map((registration) => {
        const teamName =
          registration.team?.name?.trim() ||
          registration.teamId ||
          "Unknown Team";
        const tag = registration.team?.tag?.trim();
        const label = tag ? `${tag} - ${teamName}` : teamName;
        const placement =
          registration.waitlistPosition !== null
            ? `Waitlist #${registration.waitlistPosition}`
            : "Waitlist";
        return new StringSelectMenuOptionBuilder()
          .setLabel(truncateDiscordOptionText(label))
          .setDescription(
            truncateDiscordOptionText(
              tag ? `${placement} | ${tag}` : placement,
            ),
          )
          .setValue(registration.id);
      });
      components.push(
        new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(`waitctl:select:${session.id}:${page}`)
            .setPlaceholder("Select waitlist team")
            .setMinValues(1)
            .setMaxValues(1)
            .addOptions(options),
        ),
      );
    }

    if (totalPages > 1) {
      components.push(
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(`waitctl:p:${session.id}:${Math.max(0, page - 1)}`)
            .setLabel("Previous")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page <= 0),
          new ButtonBuilder()
            .setCustomId(
              `waitctl:p:${session.id}:${Math.min(totalPages - 1, page + 1)}`,
            )
            .setLabel("Next")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page >= totalPages - 1),
        ),
      );
    }

    return {
      payload: {
        content: null,
        embeds: [embed],
        components,
        allowedMentions: { parse: [] },
      },
      page,
      totalPages,
      waitlistCount: waitlist.length,
    };
  }

  private buildWaitlistPayload(
    session: SessionResponse,
    registrations: SessionRegistrationResponse[],
    config?: SessionDiscordConfigResponse | null,
    opts: SlotListRenderOptions = {},
  ): ManagedMessagePayload {
    const waitlist = registrations
      .filter(
        (registration) =>
          activeRegistration(registration) &&
          registration.status === "WAITLIST" &&
          registration.waitlistPosition !== null,
      )
      .sort(
        (left, right) =>
          (left.waitlistPosition ?? Number.MAX_SAFE_INTEGER) -
          (right.waitlistPosition ?? Number.MAX_SAFE_INTEGER),
      );
    const buildLines = (
      rowOptions: { hideLogo?: boolean; shortenName?: boolean } = {},
    ) =>
      waitlist.length > 0
        ? waitlist.map(
            (registration) =>
              `${resolveDiscordEmoji("waitlist", config)} ${registration.waitlistPosition}. ${formatTeamSlotRow(
                registration,
                opts.managerMentionByTeamId?.get(registration.teamId),
                opts.teamLogoEmojiByTeamId?.get(registration.teamId) ??
                  opts.defaultTeamLogoEmoji,
                registrationPlayStatus(registration),
                rowOptions,
              )}`,
          )
        : [`${resolveDiscordEmoji("empty", config)} None`];
    const title = `${resolveDiscordEmoji("waitlist", config)} Waitlist (${waitlist.length})`;
    const renderPlainContent = (lines: string[]) =>
      [`**${title}**`, lines.join("\n")].join("\n\n");

    if (waitlistMessageMode(config) === "plain") {
      let content = renderPlainContent(buildLines());
      if (content.length > DISCORD_MESSAGE_CONTENT_LIMIT) {
        content = renderPlainContent(buildLines({ hideLogo: true }));
      }
      if (content.length > DISCORD_MESSAGE_CONTENT_LIMIT) {
        content = renderPlainContent(
          buildLines({ hideLogo: true, shortenName: true }),
        );
      }
      content = limitDiscordMessageContent(content);
      return {
        content,
        embeds: [],
        allowedMentions: allowedMentionsForRenderedMentions(content),
      };
    }

    const waitlistDescription = buildLines().join("\n");
    const embed = new EmbedBuilder()
      .setColor(0xf59e0b)
      .setTitle(title)
      .setDescription(waitlistDescription)
      .setTimestamp(new Date());
    const mirroredContent = mentionMirrorContent(waitlistDescription);

    return {
      content: mirroredContent,
      embeds: [embed],
      allowedMentions: mirroredContent
        ? allowedMentionsForRenderedMentions(mirroredContent)
        : { parse: [] },
    };
  }
}
