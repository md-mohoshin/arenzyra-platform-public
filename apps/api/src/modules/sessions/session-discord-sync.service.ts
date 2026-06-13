import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  Optional,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import {
  LiveState,
  MatchStatus,
  OrganizationStatus,
  OrganizationSubscriptionStatus,
  Prisma,
  Role,
  SessionRegistrationStatus,
  SessionStatus,
  SessionType,
  GameKey,
} from '@prisma/client';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import type { AuthUser } from '../../common/auth/auth.types';
import type { Actor } from '../../common/auth/jwt.strategy';
import { organizationHasActiveSubscription } from '../../common/org/launcher-license-state.util';
import { effectiveOrganizationId } from '../../common/org/org.util';
import { normalizeAndValidateTeamTag } from '../../common/team-tag.util';
import { PrismaService } from '../../db/prisma.service';
import {
  storePlayerPhotoProcessed,
  storeTeamLogoProcessed,
} from '../teams/asset.util';
import { PlayersService } from '../players/players.service';
import { ImportDiscordEventDto } from './dto/import-discord-event.dto';
import { ImportProductionEventDto } from './dto/import-production-event.dto';
import {
  syncMatchSlotsWithSessionRegistrations,
  type SyncSessionMatchSlotsResult,
} from './session-match-slot-sync';
import { defaultSlotCountForGame } from '../../common/game-rules.util';

const DISCORD_API_BASE_URL = 'https://discord.com/api/v10';
const DISCORD_CDN_BASE_URL = 'https://cdn.discordapp.com';
const GUILD_TEXT_CHANNEL = 0;
const GUILD_CATEGORY_CHANNEL = 4;
const DEFAULT_STAFF_ROLE_NAME = 'Arenzyra Staff';
const DEFAULT_TEAM_LOGO_EMOJI_NAME = 'az_default_logo_a';
const SERVER_TEAM_LOGO_EMOJI_PREFIX = 'azg';
const SERVER_TEAM_LOGO_EMOJI_VERSION = 'v1';
const TEAM_LOGO_EMOJI_PREFIX = 'azt';
const TEAM_LOGO_EMOJI_VERSION = 'v1';
const LOGO_COMMAND_PATTERN = /^(?:<@!?\d+>\s*)?%logo\b/i;
const PLAYER_PHOTO_COMMAND_PATTERN = /^(?:<@!?\d+>\s*)?%photo\b/i;
const PENDING_TEAM_LOGOS_KEY = 'pendingTeamLogos';
const MAX_PENDING_TEAM_LOGOS = 250;
const DEFAULT_SYNC_OLD_LOGOS_LIMIT = 100;
const MAX_SYNC_OLD_LOGOS_LIMIT = 500;
const MAX_LOGO_UPLOAD_BYTES = 8 * 1024 * 1024;
const SERVER_EMOJI_IMAGE_SIZE = 128;
const MAX_EMOJI_IMAGE_BYTES = 256 * 1024;
const MAX_EMOJI_SOURCE_IMAGE_BYTES = 8 * 1024 * 1024;
const EMOJI_IMAGE_SIZES = [128, 96, 64] as const;
const MAX_STALE_TEAM_LOGO_EMOJI_DELETE = 25;
const DISCORD_MESSAGE_CONTENT_LIMIT = 2000;
const DISCORD_RATE_LIMIT_RETRIES = 5;
const DISCORD_RATE_LIMIT_PADDING_MS = 350;
const DISCORD_RATE_LIMIT_MAX_DELAY_MS = 60_000;
const DISCORD_MEMBER_LOOKUP_CONCURRENCY = 4;
const DISCORD_MEMBER_CACHE_TTL_MS = 60_000;
const DISCORD_ROLE_MUTATION_SPACING_MS = 1_200;
const WAITLIST_CONTROL_PAGE_SIZE = 25;
const DISCORD_EVENT_IMPORT_NOTE_PREFIX = 'DISCORD_EVENT_IMPORT:';
const PRODUCTION_EVENT_IMPORT_NOTE_PREFIX = 'PRODUCTION_EVENT_IMPORT:';
const PRODUCTION_DISCORD_FEATURE_KEY = 'production.discord.enabled';
const PRODUCTION_EVENT_IMPORT_CATEGORY_ID = 'production-slots';
const DISCORD_SNOWFLAKE_PATTERN = /^\d{15,25}$/;
const ALLOWED_LOGO_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const DISCORD_EVENT_SERVER_ACCESS_MODES = [
  'PRIMARY',
  'CONNECTED',
  'ALL_BOT',
] as const;
const DEFAULT_FOREIGN_EVENT_SOURCE_SYNC_INTERVAL_MS = 30_000;
const MIN_FOREIGN_EVENT_SOURCE_SYNC_INTERVAL_MS = 30_000;
const FOREIGN_EVENT_SOURCE_SYNC_BATCH_SIZE = 25;

type DiscordEventServerAccessMode =
  (typeof DISCORD_EVENT_SERVER_ACCESS_MODES)[number];

type DiscordSelectableGuild = {
  organizationId: string;
  guildId: string;
  guildName: string | null;
  enabled: boolean;
  isPrimary: boolean;
};

type DiscordEventGuildSelection = DiscordSelectableGuild & {
  isForeignSource: boolean;
};

type DiscordEntitledOrganization = {
  subscriptionStatus: OrganizationSubscriptionStatus | null;
  trialEndsAt: Date | null;
  paidUntil: Date | null;
  discordConfig: {
    maxSessionCount: number;
  } | null;
};

const PERMISSION = {
  VIEW_CHANNEL: 1n << 10n,
  SEND_MESSAGES: 1n << 11n,
  ADD_REACTIONS: 1n << 6n,
  MANAGE_MESSAGES: 1n << 13n,
  MANAGE_CHANNELS: 1n << 4n,
  MANAGE_GUILD: 1n << 5n,
  ADMINISTRATOR: 1n << 3n,
  EMBED_LINKS: 1n << 14n,
  ATTACH_FILES: 1n << 15n,
  READ_MESSAGE_HISTORY: 1n << 16n,
  CREATE_PUBLIC_THREADS: 1n << 34n,
  CREATE_PRIVATE_THREADS: 1n << 35n,
  SEND_MESSAGES_IN_THREADS: 1n << 38n,
};
const BOT_CONTROLLED_MEMBER_DENY_PERMISSIONS = [
  PERMISSION.ADD_REACTIONS,
  PERMISSION.CREATE_PUBLIC_THREADS,
  PERMISSION.CREATE_PRIVATE_THREADS,
  PERMISSION.SEND_MESSAGES_IN_THREADS,
];
const BOT_CONTROLLED_BOT_ALLOW_PERMISSIONS = [
  PERMISSION.VIEW_CHANNEL,
  PERMISSION.READ_MESSAGE_HISTORY,
  PERMISSION.SEND_MESSAGES,
  PERMISSION.EMBED_LINKS,
  PERMISSION.ATTACH_FILES,
  PERMISSION.ADD_REACTIONS,
  PERMISSION.CREATE_PUBLIC_THREADS,
  PERMISSION.CREATE_PRIVATE_THREADS,
  PERMISSION.SEND_MESSAGES_IN_THREADS,
  PERMISSION.MANAGE_MESSAGES,
];
type BotControlledSendMessagesMode = 'allow' | 'deny' | null;

const STAFF_ROLE_NAMES = new Set([
  '[OWNER]',
  'Arenzyra Admin',
  'Arenzyra Staff',
  'Production Lead',
  'Tournament Organizer',
]);

type RegistrationWindowState = 'always_open' | 'not_open' | 'open' | 'closed';
type RegistrationWindowSnapshot = {
  opensAt: Date | null;
  closesAt: Date | null;
  configured: boolean;
  state: RegistrationWindowState;
  allowsAction: boolean;
  mode: 'manual' | 'always' | 'weekly' | 'session';
  timeZone: string | null;
};
type RoleAccessKind = 'earlyAccess' | 'vipAccess';
type RoleAccessGroup = {
  id: string;
  name: string;
  roleId: string;
  roleName: string;
  mode: 'normal' | 'vip' | 'both';
  enabled: boolean;
  weeklySchedule: string;
  timeZone: string;
};
type OrganizationAccessRoleIds = {
  earlyAccessRoleId: string | null;
  vipAccessRoleId: string | null;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type DiscordChannel = {
  id: string;
  name: string;
  type: number;
  parent_id?: string | null;
  topic?: string | null;
  permission_overwrites?: PermissionOverwrite[] | null;
};

type DiscordRole = {
  id: string;
  name: string;
  permissions: string;
};

type DiscordEmoji = {
  id: string;
  name: string;
  animated?: boolean;
};

type DiscordGuild = {
  id: string;
  name?: string;
  icon?: string | null;
};

type DiscordGuildMember = {
  user?: {
    id?: string;
    bot?: boolean;
  };
  roles?: string[];
};

export type DiscordMessage = {
  id: string;
  content?: string | null;
  pinned?: boolean;
  attachments?: Array<{
    id?: string | null;
    url?: string | null;
    filename?: string | null;
    content_type?: string | null;
    contentType?: string | null;
    size?: number | null;
  }>;
  mentions?: Array<{ id?: string | null }>;
  author?: {
    id?: string;
    username?: string | null;
    bot?: boolean;
  };
  embeds?: Array<{
    title?: string;
    description?: string;
    footer?: {
      text?: string;
    };
    fields?: Array<{
      name?: string;
      value?: string;
    }>;
  }>;
  components?: Array<{
    components?: Array<{
      custom_id?: string;
      customId?: string;
    }>;
  }>;
  reactions?: Array<{
    me?: boolean;
    emoji?: {
      id?: string | null;
      name?: string | null;
      animated?: boolean;
    };
  }>;
};

type PermissionOverwrite = {
  id: string;
  type: 0 | 1;
  allow: string;
  deny: string;
};

type SessionDiscordConfigRecord = {
  id: string;
  organizationId: string;
  sessionId: string;
  enabled: boolean;
  registrationMode: string;
  guildId: string | null;
  categoryId: string | null;
  categoryName: string | null;
  registrationChannelId: string | null;
  registrationChannelName: string | null;
  slotListChannelId: string | null;
  slotListChannelName: string | null;
  waitlistChannelId: string | null;
  waitlistChannelName: string | null;
  idpChannelId: string | null;
  idpChannelName: string | null;
  managerChannelId: string | null;
  managerChannelName: string | null;
  transferChannelId: string | null;
  transferChannelName: string | null;
  manageChannelId: string | null;
  manageChannelName: string | null;
  resultsChannelId: string | null;
  resultsChannelName: string | null;
  screenshotsChannelId: string | null;
  screenshotsChannelName: string | null;
  bansChannelId: string | null;
  bansChannelName: string | null;
  logChannelId: string | null;
  logChannelName: string | null;
  slotRoleId: string | null;
  slotRoleName: string | null;
  waitlistRoleId: string | null;
  waitlistRoleName: string | null;
  idpRoleId: string | null;
  idpRoleName: string | null;
  bannedRoleId: string | null;
  bannedRoleName: string | null;
  registrationRoleIds: unknown;
  specialRegistrationRoleIds: unknown;
  manageRoleIds: unknown;
  vipRoleIds: unknown;
  startSlot: number;
  normalSlots: number;
  vipSlots: number;
  maxManagersPerTeam: number;
  maxTeamsPerManager: number;
  tournamentMainPlayersRequired: number;
  tournamentLogoRequired: boolean;
  registrationCommand: string;
  registrationFormat: string | null;
  disableSlotAndVipRegistration: boolean;
  slotTeamEmojiEnabled: boolean;
  downloadPlayerElims: boolean;
  spreadsheetId: string | null;
  importSourceOrganizationId?: string | null;
  importSourceGuildId?: string | null;
  importSourceGuildName?: string | null;
  importSourceCategoryId?: string | null;
  importSourceCategoryName?: string | null;
  importSourceSlotListChannelId?: string | null;
  importSourceSlotListChannelName?: string | null;
  importSourceSyncEnabled?: boolean;
  importSourceLastSyncedAt?: Date | null;
  importSourceLastError?: string | null;
  emojis: unknown;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type DiscordSetup = {
  category: DiscordChannel;
  registrationChannel: DiscordChannel;
  slotListChannel: DiscordChannel;
  waitlistChannel: DiscordChannel;
  idpChannel: DiscordChannel;
  managerChannel: DiscordChannel;
  transferChannel: DiscordChannel;
  manageChannel: DiscordChannel;
  resultsChannel: DiscordChannel;
  screenshotsChannel: DiscordChannel;
  bansChannel: DiscordChannel;
  logChannel: DiscordChannel;
  staffRole: DiscordRole | null;
  slotRole: DiscordRole | null;
  waitlistRole: DiscordRole | null;
  idpRole: DiscordRole | null;
  legacyIdpRole?: DiscordRole | null;
  bannedRole: DiscordRole | null;
};

type SessionRegistrationForSync = {
  id: string;
  teamId: string;
  leaderDiscordUserId?: string | null;
  managerDiscordUserIds?: string[];
  status: string;
  slotNumber: number | null;
  waitlistPosition: number | null;
  note: string | null;
  team: {
    id: string;
    name: string;
    tag: string | null;
    logoUrl?: string | null;
    members?: Array<{
      discordUserId: string;
      discordUsername?: string | null;
      displayName?: string | null;
      role: string;
    }>;
  } | null;
};

type TeamLogoEmojiCleanupRegistration = {
  teamId: string;
  team?: {
    id?: string | null;
    logoUrl?: string | null;
  } | null;
};

type RegistrationPlayStatus = {
  status: 'CONFIRM' | 'NOT_PLAYING';
  discordUserId: string | null;
};

function activeRegistration(
  registration: Pick<SessionRegistrationForSync, 'status'>,
) {
  return (
    registration.status !== SessionRegistrationStatus.REMOVED &&
    registration.status !== SessionRegistrationStatus.DECLINED
  );
}

type CleanupSessionDiscordOptions = {
  deleteChannels?: boolean;
  deleteRoles?: boolean;
};

type RemovedRegistrationDiscordRoleCleanupInput = {
  teamId: string;
  leaderDiscordUserId?: string | null;
  managerDiscordUserIds?: string[] | null;
};

type DiscordLogoSource = {
  url: string;
  attachmentId: string | null;
  filename: string | null;
  contentType: string | null;
  size: number | null;
};

type PendingDiscordTeamLogoRecord = {
  key: string;
  tagKey: string;
  teamName: string;
  tag: string | null;
  channelId: string;
  messageId: string;
  attachmentId: string | null;
  url: string;
  filename: string | null;
  contentType: string | null;
  savedByDiscordId: string | null;
  savedByDiscordUsername: string | null;
  savedAt: string;
};

export type DiscordLogoHistorySyncResult = {
  ok: true;
  sessionId: string;
  guildId: string;
  channelIds: string[];
  limit: number;
  scanned: number;
  matched: number;
  saved: number;
  pending: number;
  backfilled: number;
  skipped: number;
  failed: number;
  failures: Array<{ channelId: string; messageId: string; reason: string }>;
};

export type DiscordPlayerPhotoHistorySyncResult = {
  ok: true;
  sessionId: string;
  guildId: string;
  channelIds: string[];
  limit: number;
  scanned: number;
  matched: number;
  saved: number;
  skipped: number;
  failed: number;
  failures: Array<{ channelId: string; messageId: string; reason: string }>;
};

export type DiscordEventSlotRow = {
  slotNumber: number;
  teamName: string;
  teamTag: string | null;
};

export type DiscordEventSlotParseOptions = {
  startSlot?: number | null;
  normalSlots?: number | null;
  vipSlots?: number | null;
  allowPlainTeamList?: boolean;
};

type ProductionDiscordSlotsSnapshot = {
  categoryId: string | null;
  categoryName: string | null;
  slotListChannelId: string | null;
  slotListChannelName: string | null;
  rows: DiscordEventSlotRow[];
};

function bitset(...bits: bigint[]) {
  return bits.reduce((total, bit) => total | bit, 0n).toString();
}

function permissionMask(bits: bigint[]) {
  return bits.reduce((total, bit) => total | bit, 0n);
}

function parsePermissionBitset(value: string | null | undefined) {
  try {
    return BigInt(value ?? '0');
  } catch {
    return 0n;
  }
}

function hasPermission(role: DiscordRole, permission: bigint) {
  try {
    return (BigInt(role.permissions) & permission) === permission;
  } catch {
    return false;
  }
}

function shortSessionId(sessionId: string) {
  return sessionId.slice(0, 8);
}

function marker(sessionId: string, kind: string) {
  return `arenzyra:${sessionId}:${kind}`;
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
    return trimmed || 'Unknown';
  }
  return `${trimmed.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function embedHasMarker(
  embed: {
    footer?: { text?: string } | null;
    fields?: Array<{ name?: string; value?: string }>;
  },
  markerValue: string,
) {
  return (
    embed.footer?.text === markerValue ||
    embed.fields?.some(
      (field) => field.name === '\u200B' && field.value === markerValue,
    ) ||
    false
  );
}

function managedMessageId(config: SessionDiscordConfigRecord, key: string) {
  const value = configValueOrEmpty(config, key);
  return /^\d+$/.test(value) ? value : null;
}

function channelTopic(sessionId: string, kind: string) {
  return `arenzyra-session=${sessionId};kind=${kind}`;
}

function cleanName(value: string | null | undefined, fallback: string) {
  const trimmed = value?.trim();
  return trimmed || fallback;
}

function cleanCategoryName(value: string | null | undefined, fallback: string) {
  return cleanName(value, fallback).slice(0, 100) || fallback.slice(0, 100);
}

function safeChannelName(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90);
}

function cleanTextChannelName(
  value: string | null | undefined,
  fallback: string,
) {
  const candidate = cleanName(value, fallback);
  return safeChannelName(candidate) ? candidate : fallback;
}

function comparableDiscordName(name: string | null | undefined) {
  return (name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function looksLikeSlotListChannel(channel: Pick<DiscordChannel, 'name'>) {
  const name = comparableDiscordName(channel.name);
  return (
    name === 'slot-list' ||
    name === 'slots' ||
    (name.includes('slot') && name.includes('list'))
  );
}

function playableSlotCountFromSlotListChannelName(
  name: string | null | undefined,
) {
  const normalized = (name ?? '').trim();
  const suffixMatch =
    /(?:^|[^\d])(\d{1,3})\s*[-_\s]*(?:slots?|teams?)(?:[^\p{L}\p{N}]|$)/iu.exec(
      normalized,
    );
  const prefixMatch =
    /(?:^|[^\p{L}\p{N}])(?:slots?|teams?)\s*[-_\s]*(\d{1,3})(?:[^\p{L}\p{N}]|$)/iu.exec(
      normalized,
    );
  const value = Number.parseInt(suffixMatch?.[1] ?? prefixMatch?.[1] ?? '', 10);
  if (!Number.isInteger(value) || value < 1 || value > 100) return null;
  return value;
}

function cleanDiscordSlotText(value: string) {
  return value
    .replace(/<a?:[^:>]+:\d+>/g, ' ')
    .replace(/<@!?\d+>/g, ' ')
    .replace(/<#\d+>/g, ' ')
    .replace(/<@&\d+>/g, ' ')
    .replace(/[*_`~>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripLeadingEventSlotDecorations(value: string) {
  return value
    .replace(/^\s*[-\u2022]\s+/, '')
    .replace(
      /^[^\p{L}\p{N}#[\]]+(?=(?:slot\s*)?#?\d{1,3}\b|\[[^\]]+\]|\p{L}|\p{N})/iu,
      '',
    )
    .trim();
}

function stripLeadingDiscordSnowflake(value: string) {
  return value
    .replace(/^\d{17,20}(?:\s*[-:|]\s*|\s+)(?=\[[^\]]{1,15}\]\s*\S|\S)/u, '')
    .trim();
}

function stripDiscordSlotLineMarkdown(value: string) {
  return value
    .replace(/\*\*/g, '')
    .replace(/^_+|_+$/g, '')
    .trim();
}

function leadingDiscordCustomEmojiSlotLine(value: string) {
  const match = /(<a?:[A-Za-z0-9_]{2,32}:\d{17,20}>.*)$/u.exec(value.trim());
  if (!match) return value.trim();

  const prefix = value.trim().slice(0, match.index);
  if (/[\p{L}\p{N}#[\]]/u.test(prefix)) {
    return value.trim();
  }
  return match[1].trim();
}

function slotNumberFromDiscordEmojiName(name: string) {
  const match = /(?:^|_)(?:sl|slot)_?0*(\d{1,3})(?:$|_)/i.exec(name);
  if (!match) return null;

  const slotNumber = Number.parseInt(match[1], 10);
  if (!Number.isInteger(slotNumber) || slotNumber < 1 || slotNumber > 100) {
    return null;
  }
  return slotNumber;
}

function slotNumberFromDiscordEventSlotEmojiName(name: string) {
  const explicitSlotNumber = slotNumberFromDiscordEmojiName(name);
  if (explicitSlotNumber) return explicitSlotNumber;
  if (discordEmojiNameIsVip(name)) return null;

  const suffixMatch = /^[A-Za-z]{1,12}_?0*(\d{1,3})$/i.exec(name);
  if (!suffixMatch) return null;

  const slotNumber = Number.parseInt(suffixMatch[1], 10);
  if (!Number.isInteger(slotNumber) || slotNumber < 1 || slotNumber > 100) {
    return null;
  }
  return slotNumber;
}

function discordEmojiNameIsVip(name: string) {
  return /(?:^|_)vip(?:$|_)/i.test(name);
}

function parseDiscordCustomEmojiSlotPrefix(value: string) {
  const match =
    /^<a?:([A-Za-z0-9_]{2,32}):\d{17,20}>\s*(?:[|.)\]:-]|\s+-\s+|\s+)?\s*(.+)$/u.exec(
      value,
    );
  if (!match) return null;

  const slotNumber = slotNumberFromDiscordEventSlotEmojiName(match[1]);
  if (!slotNumber) return null;

  return {
    slotNumber,
    label: match[2],
  };
}

function parseDiscordColonEmojiSlotPrefix(value: string) {
  const match =
    /^:([A-Za-z0-9_]{2,32}):\s*(?:[|.)\]:-]|\s+-\s+|\s+)?\s*(.+)$/u.exec(
      value.trim(),
    );
  if (!match) return null;

  const slotNumber = slotNumberFromDiscordEventSlotEmojiName(match[1]);
  if (!slotNumber) return null;

  return {
    slotNumber,
    label: match[2],
  };
}

function parseDiscordCustomEmojiVipPrefix(value: string) {
  const match =
    /^<a?:([A-Za-z0-9_]{2,32}):\d{17,20}>\s*(?:[|.)\]:-]|\s+-\s+|\s+)?\s*(.+)$/u.exec(
      value,
    );
  if (!match || !discordEmojiNameIsVip(match[1])) return null;
  return match[2];
}

function parseDiscordColonEmojiVipPrefix(value: string) {
  const match =
    /^:([A-Za-z0-9_]{2,32}):\s*(?:[|.)\]:-]|\s+-\s+|\s+)?\s*(.+)$/u.exec(
      value.trim(),
    );
  if (!match || !discordEmojiNameIsVip(match[1])) return null;
  return match[2];
}

function parseDiscordCustomEmojiLabelPrefix(value: string) {
  const match =
    /^<a?:([A-Za-z0-9_]{2,32}):\d{17,20}>\s*(?:[|.)\]:-]|\s+-\s+|\s+)?\s*(.+)$/u.exec(
      value,
    );
  if (!match) return null;
  return match[2];
}

function parseDiscordColonEmojiLabelPrefix(value: string) {
  const match =
    /^:([A-Za-z0-9_]{2,32}):\s*(?:[|.)\]:-]|\s+-\s+|\s+)?\s*(.+)$/u.exec(
      value.trim(),
    );
  if (!match) return null;
  return match[2];
}

function isEmptyDiscordSlotLabel(value: string) {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  if (!normalized) return true;
  return [
    'empty',
    'open',
    'available',
    'free',
    'vacant',
    'tbd',
    'to be decided',
    'none',
    'no team',
  ].some((label) => normalized === label || normalized.startsWith(`${label} `));
}

function stripLeadingDiscordSlotStatusLabel(value: string) {
  return value
    .replace(
      /^(?:invited|sponsor|reserved|paid|registered)\s*:?\s+(?=\S.{0,120}\|\s*[A-Za-z0-9_.-]{1,15}\s*\|)/i,
      '',
    )
    .replace(/^(?:invited|sponsor|reserved|paid|registered)\s*:\s*/i, '')
    .trim();
}

function deriveDiscordTeamTag(teamName: string, explicitTag: string | null) {
  if (explicitTag?.trim()) {
    return explicitTag.trim().slice(0, 15).toUpperCase();
  }
  const letters = teamName
    .split(/\s+/)
    .map((part) => part.replace(/[^a-z0-9]/gi, '').charAt(0))
    .join('')
    .slice(0, 5)
    .toUpperCase();
  const fallback = teamName
    .replace(/[^a-z0-9]/gi, '')
    .slice(0, 5)
    .toUpperCase();
  return letters || fallback || 'TEAM';
}

function parseDiscordTeamLabel(value: string) {
  let label = stripLeadingDiscordSnowflake(
    stripLeadingEventSlotDecorations(cleanDiscordSlotText(value)),
  )
    .replace(/\b(confirm|confirmed|not playing|playing)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  label = stripLeadingDiscordSlotStatusLabel(label);
  if (isEmptyDiscordSlotLabel(label)) return null;

  let tag: string | null = null;
  const bracket = /^\[([^\]]{1,15})\]\s*(.+)$/.exec(label);
  if (bracket) {
    tag = bracket[1].trim();
    label = bracket[2].trim();
  }

  const teamNameThenTag = /^(.+?)\s*\|\s*([A-Za-z0-9_.-]{1,15})\s*\|\s*$/.exec(
    label,
  );
  if (!tag && teamNameThenTag) {
    label = teamNameThenTag[1].trim();
    tag = teamNameThenTag[2].trim();
  }

  const pipe = /^([A-Z0-9_.-]{2,15})\s*[|/]\s*(.+)$/i.exec(label);
  if (!tag && pipe) {
    tag = pipe[1].trim();
    label = pipe[2].trim();
  }

  label = label.replace(/\s+/g, ' ').slice(0, 120).trim();
  if (!label || !/\p{L}/u.test(label) || isEmptyDiscordSlotLabel(label)) {
    return null;
  }

  return {
    teamName: label,
    teamTag: deriveDiscordTeamTag(label, tag),
  };
}

export function parseDiscordEventSlotLine(
  line: string,
): DiscordEventSlotRow | null {
  const lineText = stripDiscordSlotLineMarkdown(line);
  const leadingEmojiLine = leadingDiscordCustomEmojiSlotLine(lineText);
  const customEmojiSlot =
    parseDiscordCustomEmojiSlotPrefix(leadingEmojiLine) ??
    parseDiscordColonEmojiSlotPrefix(lineText);
  const stripped = stripLeadingEventSlotDecorations(lineText);
  const numericMatch =
    customEmojiSlot ??
    /^(?:slot\s*)?#?(\d{1,3})\s*(?:[.)\]:-]|\s+-\s+|\s+)\s*(.+)$/i.exec(
      stripped,
    );
  if (!numericMatch) return null;

  const slotNumber =
    'slotNumber' in numericMatch
      ? numericMatch.slotNumber
      : Number.parseInt(numericMatch[1], 10);
  if (!Number.isInteger(slotNumber) || slotNumber < 1 || slotNumber > 100) {
    return null;
  }

  const team = parseDiscordTeamLabel(
    'label' in numericMatch ? numericMatch.label : numericMatch[2],
  );
  if (!team) return null;

  return {
    slotNumber,
    teamName: team.teamName,
    teamTag: team.teamTag,
  };
}

function parseDiscordEventVipSlotLine(
  line: string,
): Omit<DiscordEventSlotRow, 'slotNumber'> | null {
  const lineText = stripDiscordSlotLineMarkdown(line);
  const leadingEmojiLine = leadingDiscordCustomEmojiSlotLine(lineText);
  const customEmojiVipLabel =
    parseDiscordCustomEmojiVipPrefix(leadingEmojiLine) ??
    parseDiscordColonEmojiVipPrefix(lineText);
  const stripped = stripLeadingEventSlotDecorations(lineText);
  const textVipMatch =
    /^vip(?:\s*#?\d{1,3})?\s*(?:[.)\]:-]|\s+-\s+|\s+)\s*(.+)$/i.exec(stripped);
  const label = customEmojiVipLabel ?? textVipMatch?.[1] ?? null;
  if (!label) return null;

  const team = parseDiscordTeamLabel(label);
  if (!team) return null;

  return {
    teamName: team.teamName,
    teamTag: team.teamTag,
  };
}

function parseDiscordEventUnnumberedSlotLine(
  line: string,
): Omit<DiscordEventSlotRow, 'slotNumber'> | null {
  const lineText = stripDiscordSlotLineMarkdown(line);
  const leadingEmojiLine = leadingDiscordCustomEmojiSlotLine(lineText);
  const customEmojiLabel =
    parseDiscordCustomEmojiLabelPrefix(leadingEmojiLine) ??
    parseDiscordColonEmojiLabelPrefix(lineText);
  const stripped = stripLeadingEventSlotDecorations(lineText);
  const textVipMatch =
    /^vip(?:\s*#?\d{1,3})?\s*(?:[.)\]:-]|\s+-\s+|\s+)\s*(.+)$/i.exec(stripped);
  const explicitTeamLabel =
    /^\[[^\]]{1,15}\]\s+\S/.test(stripped) ||
    /^[A-Z0-9_.-]{2,15}\s*[|/]\s*\S/i.test(stripped)
      ? stripped
      : null;
  const label = customEmojiLabel ?? textVipMatch?.[1] ?? explicitTeamLabel;
  if (!label) return null;

  const team = parseDiscordTeamLabel(label);
  if (!team) return null;

  return {
    teamName: team.teamName,
    teamTag: team.teamTag,
  };
}

type DiscordPlainTeamListRow = {
  row: Omit<DiscordEventSlotRow, 'slotNumber'>;
  slotNumber: number | null;
  placement: 'auto' | 'vip';
};

function parseDiscordPlainTeamListLine(
  line: string,
): DiscordPlainTeamListRow | null {
  const markdownStripped = stripDiscordSlotLineMarkdown(line).trim();
  if (/^#{2,}\s+\S/.test(markdownStripped)) {
    return null;
  }

  const stripped = stripLeadingEventSlotDecorations(markdownStripped)
    .replace(/^[-*]\s+/, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (
    !stripped ||
    stripped.length > 120 ||
    /^[%!/]/.test(stripped) ||
    /^https?:\/\//i.test(stripped) ||
    /^(?:slot\s*list|slots?|teams?|team\s*name|vip\b|\d+\s*\/\s*\d+)/i.test(
      stripped,
    )
  ) {
    return null;
  }

  let label = stripped;
  let slotNumber: number | null = null;
  let placement: 'auto' | 'vip' = 'auto';
  const vipMatch =
    /^(?:fix\s*)?vip(?:\s*#?0*\d{1,3})?\s*(?:[.)\]:-]|\s+-\s+|\s+)\s*(.+)$/i.exec(
      stripped,
    );
  const numberedMatch =
    /^(?:(?:fix|slot|team)\s*)?#?0*(\d{1,3})\s*(?:[.)\]:-]|\s+-\s+|\s+)\s*(.+)$/i.exec(
      stripped,
    );

  if (vipMatch) {
    placement = 'vip';
    label = vipMatch[1].trim();
  } else if (numberedMatch) {
    const parsedSlotNumber = Number.parseInt(numberedMatch[1], 10);
    if (
      !Number.isInteger(parsedSlotNumber) ||
      parsedSlotNumber < 1 ||
      parsedSlotNumber > 100
    ) {
      return null;
    }
    slotNumber = parsedSlotNumber;
    label = numberedMatch[2].trim();
  }

  const team = parseDiscordTeamLabel(label);
  if (!team) return null;

  return {
    row: {
      teamName: team.teamName,
      teamTag: team.teamTag,
    },
    slotNumber,
    placement,
  };
}

function parseDiscordSlotListHeaderLayout(line: string) {
  const text = cleanDiscordSlotText(stripDiscordSlotLineMarkdown(line));
  const normalMatch = /\bslot\s+list\s*\(\s*\d+\s*\/\s*(\d{1,3})\s*\)/i.exec(
    text,
  );
  const vipMatch = /\bvip\s+\d+\s*\/\s*(\d{1,3})\b/i.exec(text);
  return {
    normalSlots: normalMatch ? Number.parseInt(normalMatch[1], 10) : null,
    vipSlots: vipMatch ? Number.parseInt(vipMatch[1], 10) : null,
  };
}

function validDiscordSlotCount(
  value: number | null | undefined,
): number | null {
  return typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 100
    ? value
    : null;
}

function validDiscordStartSlot(
  value: number | null | undefined,
): number | null {
  return typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= 100
    ? value
    : null;
}

function discordMessageText(message: DiscordMessage) {
  const parts: string[] = [];
  if (message.content?.trim()) {
    parts.push(message.content);
  }
  for (const embed of message.embeds ?? []) {
    if (embed.title?.trim()) parts.push(embed.title);
    if (embed.description?.trim()) parts.push(embed.description);
    for (const field of embed.fields ?? []) {
      if (field.name?.trim()) parts.push(field.name);
      if (field.value?.trim()) parts.push(field.value);
    }
  }
  return parts.join('\n');
}

export function parseDiscordEventSlotRows(
  messages: DiscordMessage[],
  options: DiscordEventSlotParseOptions = {},
) {
  const bySlot = new Map<number, DiscordEventSlotRow>();
  const unnumberedRows: Array<{
    row: Omit<DiscordEventSlotRow, 'slotNumber'>;
    placement: 'auto' | 'vip';
  }> = [];
  let headerNormalSlots: number | null = null;
  let headerVipSlots: number | null = null;
  for (const message of messages) {
    const messageUnnumberedRows: typeof unnumberedRows = [];
    const messagePlainRowsInSourceOrder: typeof unnumberedRows = [];
    let messageHasSlotListHeader = false;
    let messageHasNumberedSlotRows = false;

    for (const line of discordMessageText(message).split(/\r?\n/)) {
      const headerLayout = parseDiscordSlotListHeaderLayout(line);
      const normalSlots = validDiscordSlotCount(headerLayout.normalSlots);
      const vipSlots = validDiscordSlotCount(headerLayout.vipSlots);
      if (normalSlots !== null || vipSlots !== null) {
        messageHasSlotListHeader = true;
      }
      headerNormalSlots ??= normalSlots;
      headerVipSlots ??= vipSlots;

      const row = parseDiscordEventSlotLine(line);
      if (row) {
        messageHasNumberedSlotRows = true;
        if (!bySlot.has(row.slotNumber)) {
          bySlot.set(row.slotNumber, row);
        }
        continue;
      }

      const vipRow = parseDiscordEventVipSlotLine(line);
      if (vipRow) {
        const entry = { row: vipRow, placement: 'vip' as const };
        messageUnnumberedRows.push(entry);
        messagePlainRowsInSourceOrder.push(entry);
        continue;
      }

      const unnumberedRow = parseDiscordEventUnnumberedSlotLine(line);
      if (unnumberedRow) {
        const entry = {
          row: unnumberedRow,
          placement: 'auto' as const,
        };
        messageUnnumberedRows.push(entry);
        messagePlainRowsInSourceOrder.push(entry);
        continue;
      }

      if (options.allowPlainTeamList === true) {
        const plainRow = parseDiscordPlainTeamListLine(line);
        if (plainRow) {
          if (plainRow.slotNumber !== null) {
            if (!bySlot.has(plainRow.slotNumber)) {
              bySlot.set(plainRow.slotNumber, {
                slotNumber: plainRow.slotNumber,
                teamName: plainRow.row.teamName,
                teamTag: plainRow.row.teamTag,
              });
            }
          } else {
            messagePlainRowsInSourceOrder.push({
              row: plainRow.row,
              placement: plainRow.placement,
            });
          }
        }
      }
    }

    if (messageHasSlotListHeader || messageHasNumberedSlotRows) {
      unnumberedRows.push(...messageUnnumberedRows);
    } else if (options.allowPlainTeamList === true) {
      if (messagePlainRowsInSourceOrder.length >= 2) {
        unnumberedRows.push(...messagePlainRowsInSourceOrder);
      }
    }
  }

  if (unnumberedRows.length > 0) {
    const optionStartSlot = validDiscordStartSlot(options.startSlot);
    const optionNormalSlots = validDiscordSlotCount(options.normalSlots);
    const optionVipSlots = validDiscordSlotCount(options.vipSlots);
    const normalSlotNumbers = Array.from(bySlot.keys());
    const inferredStartSlot =
      normalSlotNumbers.length > 0 ? Math.min(...normalSlotNumbers) : null;
    const sequentialStartSlot =
      normalSlotNumbers.length > 0
        ? Math.max(...normalSlotNumbers) + 1
        : (optionStartSlot ?? inferredStartSlot ?? 1);
    const normalEndSlot =
      optionStartSlot !== null && optionNormalSlots !== null
        ? optionStartSlot + optionNormalSlots - 1
        : inferredStartSlot !== null && headerNormalSlots !== null
          ? inferredStartSlot + headerNormalSlots - 1
          : null;
    const vipRows: Array<Omit<DiscordEventSlotRow, 'slotNumber'>> = [];
    let nextSequentialSlot = sequentialStartSlot;

    for (const entry of unnumberedRows) {
      if (entry.placement === 'vip') {
        vipRows.push(entry.row);
        continue;
      }

      while (bySlot.has(nextSequentialSlot)) {
        nextSequentialSlot += 1;
      }
      if (normalEndSlot === null || nextSequentialSlot <= normalEndSlot) {
        const slotNumber = nextSequentialSlot;
        bySlot.set(slotNumber, {
          slotNumber,
          teamName: entry.row.teamName,
          teamTag: entry.row.teamTag,
        });
        nextSequentialSlot += 1;
      } else {
        vipRows.push(entry.row);
      }
    }

    const vipStartSlot =
      optionStartSlot !== null && optionNormalSlots !== null
        ? optionStartSlot + optionNormalSlots
        : inferredStartSlot !== null && headerNormalSlots !== null
          ? inferredStartSlot + headerNormalSlots
          : normalSlotNumbers.length > 0
            ? Math.max(...normalSlotNumbers) + 1
            : null;
    const vipCapacity = optionVipSlots ?? headerVipSlots;

    if (vipStartSlot !== null) {
      vipRows.forEach((vipRow, index) => {
        if (vipCapacity !== null && index >= vipCapacity) return;
        const slotNumber = vipStartSlot + index;
        if (slotNumber < 1 || slotNumber > 100 || bySlot.has(slotNumber)) {
          return;
        }
        bySlot.set(slotNumber, {
          slotNumber,
          teamName: vipRow.teamName,
          teamTag: vipRow.teamTag,
        });
      });
    }
  }

  return Array.from(bySlot.values()).sort(
    (left, right) => left.slotNumber - right.slotNumber,
  );
}

function trimRoleName(name: string) {
  return name.slice(0, 100);
}

function configuredStaffRoleName(config: SessionDiscordConfigRecord) {
  return trimRoleName(
    configValueOrEmpty(config, 'staffRoleName') || DEFAULT_STAFF_ROLE_NAME,
  );
}

function configuredStaffRoleId(config: SessionDiscordConfigRecord) {
  return configValueOrEmpty(config, 'staffRoleId') || null;
}

function publicRegistrationOpen(
  session: {
    status: string;
    registrationOpenAt: Date | string | null;
    registrationCloseAt: Date | string | null;
  },
  config?: SessionDiscordConfigRecord | null,
  now = new Date(),
) {
  return publicRegistrationWindow(session, config, now).allowsAction;
}

function parseRegistrationSessionDate(value: Date | string | null | undefined) {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function publicRegistrationWindow(
  session: {
    status: string;
    registrationOpenAt: Date | string | null;
    registrationCloseAt: Date | string | null;
  },
  config?: SessionDiscordConfigRecord | null,
  now = new Date(),
): RegistrationWindowSnapshot {
  const scheduledWindow = registrationWindow(config, now);
  if (scheduledWindow.mode === 'manual') {
    return scheduledWindow;
  }

  if (scheduledWindow.configured) {
    const statusAllows =
      session.status === 'DRAFT' ||
      session.status === 'OPEN' ||
      session.status === 'CHECKIN';
    return {
      ...scheduledWindow,
      state: statusAllows ? scheduledWindow.state : 'closed',
      allowsAction: statusAllows && scheduledWindow.allowsAction,
    };
  }

  const statusAllows =
    session.status === 'OPEN' || session.status === 'CHECKIN';
  const opensAt = parseRegistrationSessionDate(session.registrationOpenAt);
  const closesAt = parseRegistrationSessionDate(session.registrationCloseAt);
  const state: RegistrationWindowState = !statusAllows
    ? 'closed'
    : opensAt && now < opensAt
      ? 'not_open'
      : closesAt && now >= closesAt
        ? 'closed'
        : 'open';

  return {
    opensAt,
    closesAt,
    configured: Boolean(opensAt || closesAt),
    state,
    allowsAction: state === 'open',
    mode: 'session',
    timeZone: null,
  };
}

function publicWaitlistPromotionWindow(
  session: {
    status: string;
  },
  config?: SessionDiscordConfigRecord | null,
  now = new Date(),
): RegistrationWindowSnapshot {
  const window = waitlistPromotionWindow(config, now);
  const statusAllows =
    session.status === 'DRAFT' ||
    session.status === 'OPEN' ||
    session.status === 'CHECKIN';
  return {
    ...window,
    state: statusAllows ? window.state : 'closed',
    allowsAction: statusAllows && window.allowsAction,
  };
}

function sessionStatusAllowsRegistrationAccess(session: { status: string }) {
  return (
    session.status === 'DRAFT' ||
    session.status === 'OPEN' ||
    session.status === 'CHECKIN'
  );
}

function roleAccessWindow(
  config: SessionDiscordConfigRecord,
  kind: RoleAccessKind,
  now = new Date(),
) {
  const enabled = configValueOrEmpty(config, `${kind}Enabled`) === 'true';
  if (!enabled) {
    return {
      opensAt: null,
      closesAt: null,
      configured: false,
      state: 'closed' as const,
      allowsAction: false,
      mode: 'off' as const,
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
        state: 'open' as const,
        allowsAction: true,
        mode: 'weekly' as const,
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
      state: 'closed' as const,
      allowsAction: false,
      mode: 'weekly' as const,
      timeZone,
    };
  }

  const opensAtText = configValueOrEmpty(config, `${kind}OpensAt`);
  const closesAtText = configValueOrEmpty(config, `${kind}ClosesAt`);
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
    opensAt.getTime() <= now.getTime() &&
    now.getTime() < closesAt.getTime();

  return {
    opensAt: configured ? opensAt : null,
    closesAt: configured ? closesAt : null,
    configured,
    state: allowsAction ? ('open' as const) : ('closed' as const),
    allowsAction,
    mode: configured ? ('date' as const) : ('off' as const),
    timeZone: null,
  };
}

function roleAccessGroupWindow(
  group: RoleAccessGroup,
  config: SessionDiscordConfigRecord,
  now = new Date(),
) {
  if (!group.enabled) {
    return {
      opensAt: null,
      closesAt: null,
      configured: false,
      state: 'closed' as const,
      allowsAction: false,
      mode: 'off' as const,
      timeZone: null,
    };
  }

  const schedule = parseWeeklyRoleAccessScheduleText(group.weeklySchedule);
  if (schedule.length === 0) {
    return {
      opensAt: null,
      closesAt: null,
      configured: false,
      state: 'closed' as const,
      allowsAction: false,
      mode: 'off' as const,
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
      state: 'open' as const,
      allowsAction: true,
      mode: 'weekly' as const,
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
    state: 'closed' as const,
    allowsAction: false,
    mode: 'weekly' as const,
    timeZone,
  };
}

const PLAY_STATUS_NOTE_PREFIX = 'ARENZYRA_PLAY_STATUS:';

function registrationPlayStatus(
  registration: Pick<SessionRegistrationForSync, 'note'>,
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
    if (payload.status !== 'CONFIRM' && payload.status !== 'NOT_PLAYING') {
      return null;
    }
    return {
      status: payload.status,
      discordUserId:
        typeof payload.discordUserId === 'string' &&
        payload.discordUserId.trim()
          ? payload.discordUserId.trim()
          : null,
    };
  } catch {
    return null;
  }
}

function teamSlotRow(
  registration: SessionRegistrationForSync,
  playStatus?: Pick<RegistrationPlayStatus, 'discordUserId'> | null,
  logoEmoji?: string | null,
  validGuildMemberIds?: Set<string> | null,
  opts: { compact?: boolean; hideLogo?: boolean; shortenName?: boolean } = {},
) {
  const tag = registration.team?.tag?.trim() || 'NO TAG';
  const name = registration.team?.name?.trim() || registration.teamId;
  const managerLabels: string[] = [];
  const seenDiscordIds = new Set<string>();
  const snapshotDiscordIds = uniqueStrings(
    registration.managerDiscordUserIds?.length
      ? registration.managerDiscordUserIds
      : [registration.leaderDiscordUserId],
  );
  const memberDiscordIds = snapshotDiscordIds.length
    ? []
    : (registration.team?.members ?? [])
        .filter((member) => member.role === 'LEADER')
        .map((member) => member.discordUserId);
  for (const discordUserIdValue of [
    ...snapshotDiscordIds,
    ...memberDiscordIds,
  ]) {
    const discordUserId = discordUserIdValue?.trim();
    if (
      !discordUserId ||
      seenDiscordIds.has(discordUserId) ||
      (validGuildMemberIds != null && !validGuildMemberIds.has(discordUserId))
    ) {
      continue;
    }
    seenDiscordIds.add(discordUserId);
    const mention = `<@${discordUserId}>`;
    managerLabels.push(mention);
  }
  const playStatusDiscordId = playStatus?.discordUserId?.trim();
  if (managerLabels.length === 0 && playStatusDiscordId) {
    managerLabels.push(`<@${playStatusDiscordId}>`);
  }
  const manager = managerLabels.length > 0 ? ` ${managerLabels.join(' ')}` : '';
  const displayName =
    (opts.shortenName || opts.compact) && name.length > 40
      ? `${name.slice(0, 37).trimEnd()}...`
      : name;
  const logo = opts.hideLogo || opts.compact ? '' : logoEmoji?.trim();
  const rowBody = `[${tag}] ${displayName}${manager}`;
  return `${logo ? `${logo} ` : ''}${rowBody}`;
}

function allowedMentionsForRenderedUserMentions(content: string) {
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
  let mirrored = 'Managers:';
  for (const userId of userIds) {
    const mention = `<@${userId}>`;
    const next = `${mirrored} ${mention}`;
    if (next.length > DISCORD_MESSAGE_CONTENT_LIMIT) {
      break;
    }
    mirrored = next;
    mentions.push(mention);
  }

  return mentions.length > 0 ? mirrored : null;
}

function organizerMentionIds(content: string, pattern: RegExp) {
  return Array.from(content.matchAll(pattern))
    .map((match) => match[1])
    .filter((value): value is string => Boolean(value));
}

function uniqueSnowflakes(values: Array<string | null | undefined>) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const snowflake = value?.trim();
    if (!snowflake || !DISCORD_SNOWFLAKE_PATTERN.test(snowflake)) {
      continue;
    }
    if (seen.has(snowflake)) {
      continue;
    }
    seen.add(snowflake);
    result.push(snowflake);
    if (result.length >= 100) {
      break;
    }
  }
  return result;
}

function allowedMentionsForOrganizerText(
  content: string,
  extras: {
    users?: Array<string | null | undefined>;
    roles?: Array<string | null | undefined>;
  } = {},
) {
  const users = uniqueSnowflakes([
    ...organizerMentionIds(content, /<@!?(\d{15,25})>/g),
    ...(extras.users ?? []),
  ]);
  const roles = uniqueSnowflakes([
    ...organizerMentionIds(content, /<@&(\d{15,25})>/g),
    ...(extras.roles ?? []),
  ]);
  const allowedMentions: {
    parse: string[];
    users?: string[];
    roles?: string[];
  } = {
    parse: /(^|[^\w])@(everyone|here)\b/i.test(content) ? ['everyone'] : [],
  };
  if (users.length > 0) {
    allowedMentions.users = users;
  }
  if (roles.length > 0) {
    allowedMentions.roles = roles;
  }
  return allowedMentions;
}

function mentionContentForOrganizerText(content: string) {
  const mentions: string[] = [];
  const seen = new Set<string>();
  const add = (mention: string) => {
    if (seen.has(mention) || mentions.length >= 100) {
      return;
    }
    seen.add(mention);
    mentions.push(mention);
  };

  if (/(^|[^\w])@everyone\b/i.test(content)) {
    add('@everyone');
  }
  if (/(^|[^\w])@here\b/i.test(content)) {
    add('@here');
  }
  for (const roleId of organizerMentionIds(content, /<@&(\d{15,25})>/g)) {
    add(`<@&${roleId}>`);
  }
  for (const userId of organizerMentionIds(content, /<@!?(\d{15,25})>/g)) {
    add(`<@${userId}>`);
  }

  return mentions.join(' ');
}

function limitDiscordMessageContent(content: string) {
  const trimmed = content.trim();
  if (trimmed.length <= DISCORD_MESSAGE_CONTENT_LIMIT) {
    return trimmed;
  }

  const suffix = '\n\n... message shortened to fit Discord.';
  return `${trimmed
    .slice(0, DISCORD_MESSAGE_CONTENT_LIMIT - suffix.length)
    .trimEnd()}${suffix}`;
}

function formatPlayStatusRow(
  row: string,
  playStatus?: RegistrationPlayStatus | null,
  config?: SessionDiscordConfigRecord | null,
) {
  if (playStatus?.status === 'NOT_PLAYING') {
    if (config && playStatusRowStyle(config) === 'enhanced') {
      return `~~_${row}_~~ ${playStatusRowEmoji(config, 'NOT_PLAYING')}`;
    }
    return `~~${row}~~`;
  }
  if (playStatus?.status === 'CONFIRM') {
    if (config && playStatusRowStyle(config) === 'enhanced') {
      return `**${row}** ${playStatusRowEmoji(config, 'CONFIRM')}`;
    }
    return `__${row}__`;
  }
  return row;
}

function emojiNameHash(value: string, length = 8) {
  return createHash('sha1').update(value).digest('hex').slice(0, length);
}

function serverLogoEmojiName(guildId: string, iconHash: string | null) {
  return `${SERVER_TEAM_LOGO_EMOJI_PREFIX}_${SERVER_TEAM_LOGO_EMOJI_VERSION}_${emojiNameHash(
    guildId,
  )}_${emojiNameHash(iconHash ?? 'none', 6)}`;
}

function teamLogoEmojiName(teamId: string, logoUrl: string) {
  return `${TEAM_LOGO_EMOJI_PREFIX}_${TEAM_LOGO_EMOJI_VERSION}_${emojiNameHash(
    teamId,
    10,
  )}_${emojiNameHash(logoUrl, 6)}`;
}

function managedTeamLogoEmojiName(name: string) {
  return name.startsWith(
    `${TEAM_LOGO_EMOJI_PREFIX}_${TEAM_LOGO_EMOJI_VERSION}_`,
  );
}

function serverIconUrl(guild: DiscordGuild) {
  const iconHash = guild.icon?.trim();
  if (!iconHash) {
    return null;
  }
  return `${DISCORD_CDN_BASE_URL}/icons/${guild.id}/${iconHash}.png?size=${SERVER_EMOJI_IMAGE_SIZE}`;
}

function emojiMention(emoji: DiscordEmoji) {
  return `<${emoji.animated ? 'a' : ''}:${emoji.name}:${emoji.id}>`;
}

const DEFAULT_DISCORD_EMOJIS = {
  check: '\u2705',
  reject: '\u274C',
  warning: '\u26A0\uFE0F',
  waitlist: '\u{1F552}',
  ban: '\u{1F6AB}',
  vip: '\u2B50',
  slot: '\u{1F4CB}',
  camera: '\u{1F4F7}',
  chart: '\u{1F4CA}',
  fire: '\u{1F525}',
  clock: '\u{1F552}',
  trophy: '\u{1F3C6}',
  team: '\u{1F3AE}',
  idp: '\u{1F511}',
  room: '\u{1F3E0}',
  results: '\u{1F4DD}',
  empty: '\u25AB',
  slotListMode: 'number',
  slotListMessageMode: 'embed',
  waitlistMessageMode: 'embed',
  slotStatusResponseEnabled: 'true',
  idpDmForwardingEnabled: 'false',
  confirmationMode: 'text',
  playControlMode: 'buttons',
  playButtonsEnabled: 'true',
  playConfirmationWeeklySchedule: '',
  playConfirmationOpenTime: '',
  playConfirmationCloseTime: '',
  playConfirmationWaitlistStartTime: '',
  playConfirmationTimeZone: '',
  playConfirmationOpensAt: '',
  playConfirmationClosesAt: '',
  playConfirmationMessageEnabled: 'false',
  playConfirmationMessageTitle: 'Team Confirmation',
  playConfirmationMessageText:
    'Confirm your team status for this scrim.\n\n{confirm} Playing\n{notPlaying} Not playing',
  playConfirmationCleanupEnabled: 'false',
  playConfirmationCleanupBanEnabled: 'false',
  playConfirmationCleanupReason: 'Missed confirmation for {session}',
  playConfirmationCleanupLastClosedAt: '',
  playConfirmationWaitlistGraceMinutes: '30',
  playConfirmationWaitlistGraceStartedAt: '',
  playConfirmationWaitlistGraceUntil: '',
  registrationWeeklySchedule: '',
  registrationTimeZone: '',
  waitlistPromotionWeeklySchedule: '',
  waitlistPromotionTimeZone: '',
  waitlistPromotionManualState: '',
  waitlistPromotionAutoOpenUntil: '',
  waitlistPromotionScheduleOverrideState: '',
  waitlistPromotionScheduleOverrideUpdatedAt: '',
  registrationMessageEnabled: 'true',
  registrationMessageDisplayMode: 'plain',
  registrationMessageTitle: 'Arenzyra Scrim Registration',
  registrationMessageText:
    'Register for {session} with this message format:\n\n{command}\nTeam Name\nTEAMTAG\n@manager\n\nAttach the team logo image to the same message when available.',
  registrationStatusAnnouncementMode: 'plain',
  registrationOpenAnnouncementTitle: 'Registration Open',
  registrationOpenAnnouncementText:
    '{success} Registration is now open for {session}.\n\n**Window**\n{status}',
  registrationClosedAnnouncementTitle: 'Registration Closed',
  registrationClosedAnnouncementText:
    '{reject} Registration is now closed for {session}.\n\n**Window**\n{status}',
  registrationManualState: '',
  registrationScheduleOverrideState: '',
  registrationClosedDetailsHours: '2',
  registrationOpeningSoonHours: '2',
  registrationStatusAlwaysOpenText: '{success} Registration is open.',
  registrationStatusOpenText:
    '{success} Registration open until {closesRelative} ({closes}){schedule}',
  registrationStatusOpeningSoonText:
    '{clock} Registration opens {opensRelative} ({opens}){schedule}',
  registrationStatusClosedRecentText:
    '{reject} Registration closed {closesRelative}. Opens {opensRelative}{schedule}.',
  registrationStatusClosedText: '{reject} Registration closed.',
  earlyAccessEnabled: 'false',
  earlyAccessWeeklySchedule: '',
  earlyAccessTimeZone: '',
  earlyAccessOpensAt: '',
  earlyAccessClosesAt: '',
  earlyAccessMessageEnabled: 'true',
  earlyAccessOpenMessageText:
    '{role} Early registration is open for {session}.',
  earlyAccessCloseMessageText: 'Early registration is closed for {session}.',
  vipAccessEnabled: 'false',
  vipAccessWeeklySchedule: '',
  vipAccessTimeZone: '',
  vipAccessOpensAt: '',
  vipAccessClosesAt: '',
  vipAccessMessageEnabled: 'true',
  vipAccessOpenMessageText: '{role} VIP registration is open for {session}.',
  vipAccessCloseMessageText: 'VIP registration is closed for {session}.',
  roleAccessGroups: '',
  autoRegistrationEnabled: 'false',
  autoRegistrationRoleId: '',
  autoRegistrationRoleName: '',
  autoRegistrationWeeklySchedule: '',
  autoRegistrationTimeZone: '',
  autoRegistrationPlacement: 'normal',
  autoRegistrationWaitlistFallback: 'true',
  autoRegistrationMaxTeams: '25',
  autoRegistrationLastRunKey: '',
  discordUseExistingChannels: 'false',
  discordManageExistingChannels: 'false',
  discordAllowExistingChannelCleanup: 'false',
  discordMessagePrefix: '',
  discordLogoChannelIds: '',
  discordPlayerPhotoChannelIds: '',
  resultReviewChannelId: '',
  matchResultPostChannelId: '',
  overallResultPostChannelId: '',
  finalResultPostChannelId: '',
  finalResultPostMessageId: '',
  finalResultPostBackupId: '',
  discordWidgetTemplateEnabled: 'false',
  discordWidgetTemplateBackgroundUrl: '',
  discordWidgetPrimaryColor: '',
  discordWidgetTextColor: '',
  discordWidgetMutedColor: '',
  discordWidgetRowColor: '',
  discordWidgetPanelOpacity: '',
  discordWidgetFontFamily: 'system',
  discordWidgetOverlayStrength: '0.58',
  discordWidgetSafeTop: '32',
  discordWidgetSafeRight: '32',
  discordWidgetSafeBottom: '32',
  discordWidgetSafeLeft: '32',
  discordWidgetOverlayLayers: '',
  discordWidgetStyleLibrary: '',
  discordWidgetCustomLayouts: '',
  discordRankingTableLayouts: '',
  discordStudioRendererEnabled: 'false',
  discordStudioDesignId: '',
  discordStudioDesignName: '',
  discordStudioPageId: '',
  discordStudioPageName: '',
  discordStudioDesignJson: '',
  discordStudioContract: '',
  discordPausedChannelIds: '',
  resultSummaryCount: '3',
  resultSummaryTitle: '{trophy} Match Results',
  resultSummaryRowTemplate:
    '{position}. {teamName} - {totalPoints} pts ({kills} kills)',
  finalResultWinnerCount: '3',
  finalResultPostTemplate: '{message}',
  finalResultRankEmojis: '',
  finalResultMessageTemplate:
    '{trophy} Final Results\n\nChampion: {winner}\n\nTop teams:\n{winners}',
  finalResultWinnerRowTemplate:
    '{rank}. {teamTag} - {points} pts ({kills} kills)',
  discordMatchResultEyebrow: 'Arenzyra Results',
  discordMatchResultTitle: '{matchName}',
  discordMatchResultSubtitle: '',
  discordOverallRankingEyebrow: 'Overall Ranking',
  discordOverallRankingTitle: '{sessionOrMatchName}',
  discordOverallRankingSubtitle: '{overallRankingSubtitle}',
  discordTopMvpEyebrow: 'Top MVP',
  discordTopMvpTitle: '{matchName}',
  discordTopMvpSubtitle: 'Player impact leader',
  discordTopFraggersEyebrow: 'Top Fraggers',
  discordTopFraggersTitle: '{matchName}',
  discordTopFraggersSubtitle: 'Player elimination leaders',
  discordResultMatchSchedule: '',
  staffRoleId: '',
  staffRoleName: 'Arenzyra Staff',
  playConfirmLabel: 'Confirm',
  playConfirmEmoji: '\u2705',
  playConfirmStyle: 'success',
  playNotPlayingLabel: 'Not Playing',
  playNotPlayingEmoji: '\u274C',
  playNotPlayingStyle: 'danger',
  playStatusRowStyle: 'legacy',
  playStatusConfirmEmoji: '\u2705',
  playStatusNotPlayingEmoji: '\u274C',
  banControlsEnabled: 'true',
  banDefaultScope: 'SESSION',
  banDefaultDurationDays: '3',
  banDefaultReason: 'Manual Discord ban',
  banServerAction: 'ROLE',
  banApplyRoleOnTeamBan: 'false',
  banRoleIds: '',
  permanentBanRoleIds: '',
  registrationBanReaction: '',
} as const;

const DEFAULT_EVENT_REGISTRATION_MESSAGE_TEXT =
  'Register for {session} with this message format:\n\nTeam Name | Team Tag | @manager\n\nAttach the team logo image to the same message when available.';
const DEFAULT_EVENT_REGISTRATION_MESSAGE_TITLE = 'Arenzyra Event Registration';
const LEGACY_TOURNAMENT_REGISTRATION_MESSAGE_TITLE =
  'Arenzyra Tournament Registration';
const DEFAULT_TOURNAMENT_REGISTRATION_MESSAGE_TEXT =
  'Register for {session} with this message format:\n\nteam name: Team Name\nteam tag: TEAMTAG\nteam manager: @manager\nplayer 1 name: Player Name @player\nplayer 1 uid: 123456789\n\nRepeat player rows for the required main players. Substitutes are optional, up to 2.';
const DEFAULT_TOURNAMENT_REGISTRATION_MESSAGE_TITLE =
  'Arenzyra Tournament Registration';

type DiscordEmojiKey = Exclude<
  keyof typeof DEFAULT_DISCORD_EMOJIS,
  | 'slotListMode'
  | 'slotListMessageMode'
  | 'waitlistMessageMode'
  | 'slotStatusResponseEnabled'
  | 'idpDmForwardingEnabled'
  | 'confirmationMode'
  | 'playControlMode'
  | 'playButtonsEnabled'
  | 'playConfirmationWeeklySchedule'
  | 'playConfirmationOpenTime'
  | 'playConfirmationCloseTime'
  | 'playConfirmationWaitlistStartTime'
  | 'playConfirmationTimeZone'
  | 'playConfirmationOpensAt'
  | 'playConfirmationClosesAt'
  | 'playConfirmationMessageEnabled'
  | 'playConfirmationMessageTitle'
  | 'playConfirmationMessageText'
  | 'playConfirmationCleanupEnabled'
  | 'playConfirmationCleanupBanEnabled'
  | 'playConfirmationCleanupReason'
  | 'playConfirmationCleanupLastClosedAt'
  | 'playConfirmationWaitlistGraceMinutes'
  | 'playConfirmationWaitlistGraceStartedAt'
  | 'playConfirmationWaitlistGraceUntil'
  | 'registrationWeeklySchedule'
  | 'registrationTimeZone'
  | 'waitlistPromotionWeeklySchedule'
  | 'waitlistPromotionTimeZone'
  | 'waitlistPromotionManualState'
  | 'waitlistPromotionAutoOpenUntil'
  | 'waitlistPromotionScheduleOverrideState'
  | 'waitlistPromotionScheduleOverrideUpdatedAt'
  | 'registrationMessageEnabled'
  | 'registrationMessageDisplayMode'
  | 'registrationMessageTitle'
  | 'registrationMessageText'
  | 'registrationStatusAnnouncementMode'
  | 'registrationOpenAnnouncementTitle'
  | 'registrationOpenAnnouncementText'
  | 'registrationClosedAnnouncementTitle'
  | 'registrationClosedAnnouncementText'
  | 'registrationManualState'
  | 'registrationScheduleOverrideState'
  | 'registrationClosedDetailsHours'
  | 'registrationOpeningSoonHours'
  | 'registrationStatusAlwaysOpenText'
  | 'registrationStatusOpenText'
  | 'registrationStatusOpeningSoonText'
  | 'registrationStatusClosedRecentText'
  | 'registrationStatusClosedText'
  | 'earlyAccessEnabled'
  | 'earlyAccessWeeklySchedule'
  | 'earlyAccessTimeZone'
  | 'earlyAccessOpensAt'
  | 'earlyAccessClosesAt'
  | 'earlyAccessMessageEnabled'
  | 'earlyAccessOpenMessageText'
  | 'earlyAccessCloseMessageText'
  | 'vipAccessEnabled'
  | 'vipAccessWeeklySchedule'
  | 'vipAccessTimeZone'
  | 'vipAccessOpensAt'
  | 'vipAccessClosesAt'
  | 'vipAccessMessageEnabled'
  | 'vipAccessOpenMessageText'
  | 'vipAccessCloseMessageText'
  | 'roleAccessGroups'
  | 'autoRegistrationEnabled'
  | 'autoRegistrationRoleId'
  | 'autoRegistrationRoleName'
  | 'autoRegistrationWeeklySchedule'
  | 'autoRegistrationTimeZone'
  | 'autoRegistrationPlacement'
  | 'autoRegistrationWaitlistFallback'
  | 'autoRegistrationMaxTeams'
  | 'autoRegistrationLastRunKey'
  | 'discordUseExistingChannels'
  | 'discordManageExistingChannels'
  | 'discordAllowExistingChannelCleanup'
  | 'discordMessagePrefix'
  | 'discordLogoChannelIds'
  | 'discordPlayerPhotoChannelIds'
  | 'resultReviewChannelId'
  | 'matchResultPostChannelId'
  | 'overallResultPostChannelId'
  | 'finalResultPostChannelId'
  | 'finalResultPostMessageId'
  | 'finalResultPostBackupId'
  | 'discordWidgetTemplateEnabled'
  | 'discordWidgetTemplateBackgroundUrl'
  | 'discordWidgetFontFamily'
  | 'discordWidgetOverlayStrength'
  | 'discordWidgetSafeTop'
  | 'discordWidgetSafeRight'
  | 'discordWidgetSafeBottom'
  | 'discordWidgetSafeLeft'
  | 'discordWidgetOverlayLayers'
  | 'discordWidgetStyleLibrary'
  | 'discordWidgetCustomLayouts'
  | 'discordRankingTableLayouts'
  | 'discordStudioRendererEnabled'
  | 'discordStudioDesignId'
  | 'discordStudioDesignName'
  | 'discordStudioPageId'
  | 'discordStudioPageName'
  | 'discordStudioDesignJson'
  | 'discordStudioContract'
  | 'discordPausedChannelIds'
  | 'resultSummaryCount'
  | 'resultSummaryTitle'
  | 'resultSummaryRowTemplate'
  | 'finalResultWinnerCount'
  | 'finalResultPostTemplate'
  | 'finalResultRankEmojis'
  | 'finalResultMessageTemplate'
  | 'finalResultWinnerRowTemplate'
  | 'discordMatchResultEyebrow'
  | 'discordMatchResultTitle'
  | 'discordMatchResultSubtitle'
  | 'discordOverallRankingEyebrow'
  | 'discordOverallRankingTitle'
  | 'discordOverallRankingSubtitle'
  | 'discordTopMvpEyebrow'
  | 'discordTopMvpTitle'
  | 'discordTopMvpSubtitle'
  | 'discordTopFraggersEyebrow'
  | 'discordTopFraggersTitle'
  | 'discordTopFraggersSubtitle'
  | 'discordResultMatchSchedule'
  | 'staffRoleId'
  | 'staffRoleName'
  | 'playConfirmLabel'
  | 'playConfirmEmoji'
  | 'playConfirmStyle'
  | 'playNotPlayingLabel'
  | 'playNotPlayingEmoji'
  | 'playNotPlayingStyle'
  | 'playStatusRowStyle'
  | 'playStatusConfirmEmoji'
  | 'playStatusNotPlayingEmoji'
  | 'banControlsEnabled'
  | 'banDefaultScope'
  | 'banDefaultDurationDays'
  | 'banDefaultReason'
  | 'banServerAction'
  | 'banApplyRoleOnTeamBan'
  | 'banRoleIds'
  | 'permanentBanRoleIds'
  | 'registrationBanReaction'
>;

const LEGACY_EMOJI_VALUES: Record<string, DiscordEmojiKey> = {
  CHECK: 'check',
  X: 'reject',
  REJECT: 'reject',
  WARNING: 'warning',
  WAITLIST: 'waitlist',
  BAN: 'ban',
  VIP: 'vip',
  SLOT: 'slot',
};

function emojiValue(config: SessionDiscordConfigRecord, key: DiscordEmojiKey) {
  const emojis =
    config.emojis &&
    typeof config.emojis === 'object' &&
    !Array.isArray(config.emojis)
      ? (config.emojis as Record<string, unknown>)
      : {};
  const value = typeof emojis[key] === 'string' ? emojis[key].trim() : '';
  if (!value) {
    return DEFAULT_DISCORD_EMOJIS[key];
  }
  const legacyKey = LEGACY_EMOJI_VALUES[value.toUpperCase()];
  return legacyKey ? DEFAULT_DISCORD_EMOJIS[legacyKey] : value;
}

function configuredEmoji(
  config: SessionDiscordConfigRecord,
  key: string,
  fallbackKey: DiscordEmojiKey,
) {
  const emojis =
    config.emojis &&
    typeof config.emojis === 'object' &&
    !Array.isArray(config.emojis)
      ? (config.emojis as Record<string, unknown>)
      : {};
  const value = typeof emojis[key] === 'string' ? emojis[key].trim() : '';
  if (!value) {
    return emojiValue(config, fallbackKey);
  }
  const legacyKey = LEGACY_EMOJI_VALUES[value.toUpperCase()];
  return legacyKey ? DEFAULT_DISCORD_EMOJIS[legacyKey] : value;
}

function slotListMode(config: SessionDiscordConfigRecord) {
  const emojis =
    config.emojis &&
    typeof config.emojis === 'object' &&
    !Array.isArray(config.emojis)
      ? (config.emojis as Record<string, unknown>)
      : {};
  return emojis.slotListMode === 'emoji' ? 'emoji' : 'number';
}

function waitlistMessageMode(config: SessionDiscordConfigRecord) {
  const emojis =
    config.emojis &&
    typeof config.emojis === 'object' &&
    !Array.isArray(config.emojis)
      ? (config.emojis as Record<string, unknown>)
      : {};
  return emojis.waitlistMessageMode === 'plain' ? 'plain' : 'embed';
}

function registrationMessageDisplayMode(config: SessionDiscordConfigRecord) {
  const emojis =
    config.emojis &&
    typeof config.emojis === 'object' &&
    !Array.isArray(config.emojis)
      ? (config.emojis as Record<string, unknown>)
      : {};
  return emojis.registrationMessageDisplayMode === 'embed' ? 'embed' : 'plain';
}

function playStatusRowStyle(config: SessionDiscordConfigRecord) {
  return configValue(config, 'playStatusRowStyle') === 'enhanced'
    ? 'enhanced'
    : 'legacy';
}

function playStatusRowEmoji(
  config: SessionDiscordConfigRecord,
  status: 'CONFIRM' | 'NOT_PLAYING',
) {
  return configuredEmoji(
    config,
    status === 'CONFIRM'
      ? 'playStatusConfirmEmoji'
      : 'playStatusNotPlayingEmoji',
    status === 'CONFIRM' ? 'check' : 'reject',
  );
}

function configValue(config: SessionDiscordConfigRecord, key: string) {
  const emojis =
    config.emojis &&
    typeof config.emojis === 'object' &&
    !Array.isArray(config.emojis)
      ? (config.emojis as Record<string, unknown>)
      : {};
  if (!Object.prototype.hasOwnProperty.call(emojis, key)) {
    return undefined;
  }
  const value = emojis[key];
  return typeof value === 'string' ? value.trim() : '';
}

function configValueOrEmpty(config: SessionDiscordConfigRecord, key: string) {
  return configValue(config, key) ?? '';
}

function configBoolean(
  config: SessionDiscordConfigRecord,
  key: string,
  fallback = false,
) {
  const value = configValue(config, key);
  if (value === undefined) {
    return fallback;
  }
  return ['true', '1', 'yes', 'on'].includes(value.toLowerCase());
}

function useExistingChannels(config: SessionDiscordConfigRecord) {
  return configBoolean(config, 'discordUseExistingChannels', false);
}

function preserveConfiguredChannels(config: SessionDiscordConfigRecord) {
  return useExistingChannels(config);
}

function manageChannelPermissions(config: SessionDiscordConfigRecord) {
  return configBoolean(
    config,
    'discordManageChannelPermissions',
    configBoolean(config, 'discordManageExistingChannels', false),
  );
}

function autoCreateRoles(config: SessionDiscordConfigRecord) {
  return configBoolean(config, 'discordAutoCreateRoles', false);
}

function allowBroadBotMessageCleanup(config: SessionDiscordConfigRecord) {
  return (
    !useExistingChannels(config) ||
    configBoolean(config, 'discordAllowExistingChannelCleanup', false)
  );
}

function prefixedTitle(config: SessionDiscordConfigRecord, title: string) {
  const prefix = configValueOrEmpty(config, 'discordMessagePrefix');
  return prefix ? `${prefix} ${title}` : title;
}

function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

function stringArray(value: unknown): string[] {
  if (!isUnknownArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === 'string');
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return Array.from(
    new Set(
      values
        .map((value) => value?.trim() ?? '')
        .filter((value): value is string => value.length > 0),
    ),
  );
}

function configValueOrDefault(
  config: SessionDiscordConfigRecord,
  key: string,
  fallback: string,
) {
  return configValue(config, key) ?? fallback;
}

function legacyOrConfiguredEmoji(
  config: SessionDiscordConfigRecord,
  key: string,
  fallbackKey: DiscordEmojiKey,
) {
  const raw = configValue(config, key);
  const value = raw === undefined ? emojiValue(config, fallbackKey) : raw;
  if (['none', 'off', 'false'].includes(value.toLowerCase())) {
    return '';
  }
  const legacyKey = LEGACY_EMOJI_VALUES[value.toUpperCase()];
  return legacyKey ? DEFAULT_DISCORD_EMOJIS[legacyKey] : value;
}

function emojiPayload(value: string) {
  const custom = value.match(/^<a?:([^:>]+):(\d+)>$/);
  if (custom) {
    return {
      name: custom[1],
      id: custom[2],
      animated: value.startsWith('<a:'),
    };
  }
  return value ? { name: value } : undefined;
}

function buttonComponent(params: {
  config: SessionDiscordConfigRecord;
  customId: string;
  disabled?: boolean;
  labelKey: 'playConfirmLabel' | 'playNotPlayingLabel';
  labelFallback: string;
  emojiKey: 'playConfirmEmoji' | 'playNotPlayingEmoji';
  emojiFallbackKey: DiscordEmojiKey;
  styleKey: 'playConfirmStyle' | 'playNotPlayingStyle';
  styleFallback: 'primary' | 'secondary' | 'success' | 'danger';
}) {
  const label = buttonLabel(
    params.config,
    params.labelKey,
    params.labelFallback,
  );
  const emoji = buttonEmoji(
    params.config,
    params.emojiKey,
    params.emojiFallbackKey,
  );
  const component: Record<string, unknown> = {
    type: 2,
    style: buttonStyle(params.config, params.styleKey, params.styleFallback),
    custom_id: params.customId,
    disabled: params.disabled ?? false,
  };
  if (label) {
    component.label = label;
  }
  if (emoji) {
    component.emoji = emoji;
  }
  if (!label && !emoji) {
    component.label = params.labelFallback;
  }
  return component;
}

type PlayControlMode = 'buttons' | 'reactions' | 'both' | 'off';

function playConfirmationControlMode(
  config: SessionDiscordConfigRecord,
): PlayControlMode {
  const mode = configValueOrEmpty(config, 'playControlMode').toLowerCase();
  if (
    mode === 'buttons' ||
    mode === 'reactions' ||
    mode === 'both' ||
    mode === 'off'
  ) {
    return mode;
  }

  return configValueOrEmpty(config, 'playButtonsEnabled') === 'false'
    ? 'off'
    : 'buttons';
}

function playConfirmationButtonsEnabled(config: SessionDiscordConfigRecord) {
  const mode = playConfirmationControlMode(config);
  return mode === 'buttons' || mode === 'both';
}

function playConfirmationReactionsEnabled(config: SessionDiscordConfigRecord) {
  const mode = playConfirmationControlMode(config);
  return mode === 'reactions' || mode === 'both';
}

function playConfirmationWindow(
  config: SessionDiscordConfigRecord,
  now = new Date(),
) {
  const weeklyWindow = weeklyPlayConfirmationWindow(config, now);
  if (weeklyWindow) {
    return weeklyWindow;
  }

  const dailyWindow = dailyPlayConfirmationWindow(config, now);
  if (dailyWindow) {
    return dailyWindow;
  }

  const opensAt = configuredDate(config, 'playConfirmationOpensAt');
  const closesAt = configuredDate(config, 'playConfirmationClosesAt');
  const configured = Boolean(opensAt || closesAt);
  let state: 'always_open' | 'not_open' | 'open' | 'closed' = configured
    ? 'open'
    : 'always_open';

  if (closesAt && now >= closesAt) {
    state = 'closed';
  } else if (opensAt && now < opensAt) {
    state = 'not_open';
  }

  return {
    opensAt,
    closesAt,
    configured,
    state,
    allowsAction: state === 'always_open' || state === 'open',
    mode: 'absolute' as const,
    timeZone: null,
    waitlistStartsAt: null,
  };
}

function registrationWindow(
  config: SessionDiscordConfigRecord | null | undefined,
  now = new Date(),
): RegistrationWindowSnapshot {
  if (!config) {
    return {
      opensAt: null,
      closesAt: null,
      configured: false,
      state: 'always_open' as const,
      allowsAction: true,
      mode: 'always' as const,
      timeZone: null,
    };
  }

  const schedule = parseWeeklyRegistrationSchedule(config);
  if (schedule.length > 0) {
    const overrideState = configuredRegistrationScheduleOverrideState(config);
    if (overrideState) {
      return {
        opensAt: null,
        closesAt: null,
        configured: true,
        state:
          overrideState === 'open'
            ? ('always_open' as const)
            : ('closed' as const),
        allowsAction: overrideState === 'open',
        mode: 'manual' as const,
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
        state: 'open' as const,
        allowsAction: true,
        mode: 'weekly' as const,
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
          ? ('not_open' as const)
          : ('closed' as const),
      allowsAction: false,
      mode: 'weekly' as const,
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
        manualState === 'open' ? ('always_open' as const) : ('closed' as const),
      allowsAction: manualState === 'open',
      mode: 'manual' as const,
      timeZone: null,
    };
  }

  return {
    opensAt: null,
    closesAt: null,
    configured: false,
    state: 'always_open' as const,
    allowsAction: true,
    mode: 'always' as const,
    timeZone: null,
  };
}

function waitlistPromotionWindow(
  config: SessionDiscordConfigRecord | null | undefined,
  now = new Date(),
): RegistrationWindowSnapshot {
  if (!config) {
    return {
      opensAt: null,
      closesAt: null,
      configured: false,
      state: 'closed' as const,
      allowsAction: false,
      mode: 'manual' as const,
      timeZone: null,
    };
  }

  const schedule = parseWeeklyWaitlistPromotionSchedule(config);
  if (schedule.length > 0) {
    const overrideState =
      configuredWaitlistPromotionScheduleOverrideState(config);
    if (overrideState) {
      return {
        opensAt: null,
        closesAt: null,
        configured: true,
        state:
          overrideState === 'open'
            ? ('always_open' as const)
            : ('closed' as const),
        allowsAction: overrideState === 'open',
        mode: 'manual' as const,
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
        state: 'open' as const,
        allowsAction: true,
        mode: 'weekly' as const,
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
          ? ('not_open' as const)
          : ('closed' as const),
      allowsAction: false,
      mode: 'weekly' as const,
      timeZone,
    };
  }

  const manualState = configuredWaitlistPromotionManualState(config);
  if (manualState) {
    return {
      opensAt: null,
      closesAt: null,
      configured: true,
      state:
        manualState === 'open' ? ('always_open' as const) : ('closed' as const),
      allowsAction: manualState === 'open',
      mode: 'manual' as const,
      timeZone: null,
    };
  }

  return {
    opensAt: null,
    closesAt: null,
    configured: false,
    state: 'closed' as const,
    allowsAction: false,
    mode: 'manual' as const,
    timeZone: null,
  };
}

function configuredRegistrationManualState(config: SessionDiscordConfigRecord) {
  const value = configValueOrEmpty(
    config,
    'registrationManualState',
  ).toLowerCase();
  return value === 'open' || value === 'closed' ? value : null;
}

function configuredRegistrationScheduleOverrideState(
  config: SessionDiscordConfigRecord,
) {
  const value = configValueOrEmpty(
    config,
    'registrationScheduleOverrideState',
  ).toLowerCase();
  return value === 'open' || value === 'closed' ? value : null;
}

function configuredWaitlistPromotionManualState(
  config: SessionDiscordConfigRecord,
) {
  const value = configValueOrEmpty(
    config,
    'waitlistPromotionManualState',
  ).toLowerCase();
  return value === 'open' || value === 'closed' ? value : null;
}

function configuredWaitlistPromotionScheduleOverrideState(
  config: SessionDiscordConfigRecord,
) {
  const value = configValueOrEmpty(
    config,
    'waitlistPromotionScheduleOverrideState',
  ).toLowerCase();
  return value === 'open' || value === 'closed' ? value : null;
}

type RegistrationStatusTemplateKey =
  | 'registrationStatusAlwaysOpenText'
  | 'registrationStatusOpenText'
  | 'registrationStatusOpeningSoonText'
  | 'registrationStatusClosedRecentText'
  | 'registrationStatusClosedText';

function configuredRegistrationStatusText(
  config: SessionDiscordConfigRecord,
  key: RegistrationStatusTemplateKey,
) {
  return (
    configValueOrDefault(config, key, DEFAULT_DISCORD_EMOJIS[key]) ||
    DEFAULT_DISCORD_EMOJIS[key]
  );
}

function configuredRegistrationStatusHours(
  config: SessionDiscordConfigRecord,
  key: 'registrationClosedDetailsHours' | 'registrationOpeningSoonHours',
) {
  const parsed = Number.parseFloat(
    configValueOrDefault(config, key, DEFAULT_DISCORD_EMOJIS[key]),
  );
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 2;
  }
  return Math.min(parsed, 168);
}

function registrationStatusTimingThresholds(
  config: SessionDiscordConfigRecord,
) {
  return {
    closedDetailsMs:
      configuredRegistrationStatusHours(
        config,
        'registrationClosedDetailsHours',
      ) *
      60 *
      60 *
      1000,
    openingSoonMs:
      configuredRegistrationStatusHours(
        config,
        'registrationOpeningSoonHours',
      ) *
      60 *
      60 *
      1000,
  };
}

function renderRegistrationStatusTemplate(
  template: string,
  config: SessionDiscordConfigRecord,
  window: RegistrationWindowSnapshot,
) {
  const replacements: Record<string, string> = {
    success: emojiValue(config, 'check'),
    reject: emojiValue(config, 'reject'),
    warning: emojiValue(config, 'warning'),
    clock: emojiValue(config, 'clock'),
    slot: emojiValue(config, 'slot'),
    waitlist: emojiValue(config, 'waitlist'),
    team: emojiValue(config, 'team'),
    opens: window.opensAt ? discordTimestamp(window.opensAt, 'f') : '',
    opensRelative: window.opensAt ? discordTimestamp(window.opensAt, 'R') : '',
    closes: window.closesAt ? discordTimestamp(window.closesAt, 'f') : '',
    closesRelative: window.closesAt
      ? discordTimestamp(window.closesAt, 'R')
      : '',
    timezone: window.timeZone ?? '',
    schedule: windowScheduleSuffix(window),
  };

  return template
    .replace(/\{([A-Za-z]+)\}/g, (match, key: string) => {
      return replacements[key] ?? match;
    })
    .replace(/[ \t]+([.,])/g, '$1')
    .trim();
}

function registrationStatusTextFromTemplate(
  key: RegistrationStatusTemplateKey,
  config: SessionDiscordConfigRecord,
  window: RegistrationWindowSnapshot,
) {
  return renderRegistrationStatusTemplate(
    configuredRegistrationStatusText(config, key),
    config,
    window,
  ).slice(0, 1024);
}

function registrationWindowStatusText(
  config: SessionDiscordConfigRecord,
  now = new Date(),
) {
  return registrationWindowStatusTextFromWindow(
    registrationWindow(config, now),
    config,
    now,
  );
}

function registrationWindowStatusTextFromWindow(
  window: RegistrationWindowSnapshot,
  config: SessionDiscordConfigRecord,
  now = new Date(),
) {
  if (
    window.state === 'always_open' ||
    (!window.configured && window.state !== 'closed')
  ) {
    return registrationStatusTextFromTemplate(
      'registrationStatusAlwaysOpenText',
      config,
      window,
    );
  }

  if (window.state === 'open') {
    return registrationStatusTextFromTemplate(
      window.closesAt
        ? 'registrationStatusOpenText'
        : 'registrationStatusAlwaysOpenText',
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
      'registrationStatusOpeningSoonText',
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
      'registrationStatusClosedRecentText',
      config,
      window,
    );
  }

  return registrationStatusTextFromTemplate(
    'registrationStatusClosedText',
    config,
    window,
  );
}

function registrationWindowStatusTextForSession(
  session: {
    status: string;
    registrationOpenAt: Date | string | null;
    registrationCloseAt: Date | string | null;
  },
  config: SessionDiscordConfigRecord,
  now = new Date(),
) {
  return registrationWindowStatusTextFromWindow(
    publicRegistrationWindow(session, config, now),
    config,
    now,
  );
}

function playConfirmationWindowStatusText(
  config: SessionDiscordConfigRecord,
  now = new Date(),
) {
  const window = playConfirmationWindow(config, now);
  if (!window.configured) {
    return null;
  }

  if (window.state === 'not_open' && window.opensAt) {
    return `${emojiValue(config, 'clock')} Confirmation opens ${discordTimestamp(window.opensAt, 'R')} (${discordTimestamp(window.opensAt, 'f')})${windowScheduleSuffix(window)}`;
  }

  if (window.state === 'closed') {
    const closedAt = window.closesAt;
    const waitlistStartText = waitlistStartStatusText(
      window.waitlistStartsAt,
      now,
      config,
    );
    return `${emojiValue(config, 'reject')} Confirmation closed${
      closedAt ? ` ${discordTimestamp(closedAt, 'R')}` : ''
    }.${
      waitlistStartText
        ? ` ${waitlistStartText}`
        : window.opensAt
          ? ` Opens ${discordTimestamp(window.opensAt, 'R')}${windowScheduleSuffix(window)}.`
          : ''
    }`;
  }

  if (window.closesAt) {
    return `${emojiValue(config, 'check')} Confirmation open until ${discordTimestamp(window.closesAt, 'R')} (${discordTimestamp(window.closesAt, 'f')})${windowScheduleSuffix(window)}`;
  }

  return `${emojiValue(config, 'check')} Confirmation is open.`;
}

function waitlistStartStatusText(
  waitlistStartsAt: Date | null | undefined,
  now: Date,
  config: SessionDiscordConfigRecord,
) {
  if (!waitlistStartsAt) {
    return '';
  }
  const verb = now < waitlistStartsAt ? 'starts' : 'started';
  return `${emojiValue(config, 'waitlist')} Waitlist ${verb} ${discordTimestamp(waitlistStartsAt, 'R')} (${discordTimestamp(waitlistStartsAt, 'f')}).`;
}

function windowScheduleSuffix(window: {
  mode: string;
  timeZone: string | null;
}) {
  if (!window.timeZone) {
    return '';
  }
  return ` ${window.mode === 'weekly' ? 'weekly' : 'daily'} (${window.timeZone})`;
}

type ParsedDailyTime = NonNullable<ReturnType<typeof parseDailyTime>>;
type WeeklyConfirmationEntry = {
  dayIndex: number;
  openTime: ParsedDailyTime;
  closeTime: ParsedDailyTime;
  waitlistStartTime: ParsedDailyTime | null;
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
  config: SessionDiscordConfigRecord,
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
      state: 'open' as const,
      allowsAction: true,
      mode: 'weekly' as const,
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
        ? ('not_open' as const)
        : ('closed' as const),
    allowsAction: false,
    mode: 'weekly' as const,
    timeZone,
    waitlistStartsAt: previousInterval?.waitlistStartsAt ?? null,
  };
}

function parseWeeklyConfirmationSchedule(config: SessionDiscordConfigRecord) {
  const raw = configValueOrEmpty(config, 'playConfirmationWeeklySchedule');
  if (!raw) {
    return [];
  }

  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return [];
    }

    return Object.entries(value as Record<string, unknown>)
      .map(([dayKey, dayValue]) => {
        if (
          !dayValue ||
          typeof dayValue !== 'object' ||
          Array.isArray(dayValue)
        ) {
          return null;
        }
        const dayIndex = WEEKDAY_INDEX[dayKey.toLowerCase()];
        const day = dayValue as Record<string, unknown>;
        const enabled = day.enabled === true || day.enabled === 'true';
        const openTime = parseDailyTime(stringValue(day.open));
        const closeTime = parseDailyTime(stringValue(day.close));
        const waitlistStartTime = parseDailyTime(
          stringValue(day.waitlistStart),
        );
        if (dayIndex === undefined || !enabled || !openTime || !closeTime) {
          return null;
        }
        return { dayIndex, openTime, closeTime, waitlistStartTime };
      })
      .filter((entry): entry is WeeklyConfirmationEntry => Boolean(entry));
  } catch {
    return [];
  }
}

function parseWeeklyRegistrationSchedule(config: SessionDiscordConfigRecord) {
  const raw = configValueOrEmpty(config, 'registrationWeeklySchedule');
  if (!raw) {
    return [];
  }

  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return [];
    }

    return Object.entries(value as Record<string, unknown>)
      .map(([dayKey, dayValue]) => {
        if (
          !dayValue ||
          typeof dayValue !== 'object' ||
          Array.isArray(dayValue)
        ) {
          return null;
        }
        const dayIndex = WEEKDAY_INDEX[dayKey.toLowerCase()];
        const day = dayValue as Record<string, unknown>;
        const enabled = day.enabled === true || day.enabled === 'true';
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
  config: SessionDiscordConfigRecord,
) {
  const raw = configValueOrEmpty(config, 'waitlistPromotionWeeklySchedule');
  if (!raw) {
    return [];
  }

  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return [];
    }

    return Object.entries(value as Record<string, unknown>)
      .map(([dayKey, dayValue]) => {
        if (
          !dayValue ||
          typeof dayValue !== 'object' ||
          Array.isArray(dayValue)
        ) {
          return null;
        }
        const dayIndex = WEEKDAY_INDEX[dayKey.toLowerCase()];
        const day = dayValue as Record<string, unknown>;
        const enabled = day.enabled === true || day.enabled === 'true';
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
  config: SessionDiscordConfigRecord,
  kind: RoleAccessKind,
) {
  const raw = configValueOrEmpty(config, `${kind}WeeklySchedule`);
  return parseWeeklyRoleAccessScheduleText(raw);
}

function parseWeeklyRoleAccessScheduleText(raw: string) {
  if (!raw.trim()) {
    return [];
  }

  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return [];
    }

    return Object.entries(value as Record<string, unknown>)
      .map(([dayKey, dayValue]) => {
        if (
          !dayValue ||
          typeof dayValue !== 'object' ||
          Array.isArray(dayValue)
        ) {
          return null;
        }
        const dayIndex = WEEKDAY_INDEX[dayKey.toLowerCase()];
        const day = dayValue as Record<string, unknown>;
        const enabled = day.enabled === true || day.enabled === 'true';
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
  return typeof value === 'string' ? value : '';
}

function booleanFromUnknown(value: unknown, fallback: boolean) {
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  return fallback;
}

function normalizeRoleAccessGroupId(value: unknown, fallbackIndex: number) {
  const text = stringValue(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return text || `access-${fallbackIndex + 1}`;
}

function normalizeRoleAccessGroupMode(value: unknown): RoleAccessGroup['mode'] {
  const text = stringValue(value).trim().toLowerCase();
  return text === 'vip' || text === 'both' ? text : 'normal';
}

function parseRoleAccessGroups(
  config: SessionDiscordConfigRecord,
): RoleAccessGroup[] {
  const raw = configValueOrEmpty(config, 'roleAccessGroups');
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    const source = Array.isArray(parsed)
      ? parsed
      : parsed &&
          typeof parsed === 'object' &&
          Array.isArray((parsed as Record<string, unknown>).groups)
        ? ((parsed as Record<string, unknown>).groups as unknown[])
        : [];
    const seenIds = new Set<string>();
    return source
      .map((entry, index): RoleAccessGroup | null => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
          return null;
        }
        const record = entry as Record<string, unknown>;
        let id = normalizeRoleAccessGroupId(record.id, index);
        while (seenIds.has(id)) {
          id = `${id}-${index + 1}`;
        }
        seenIds.add(id);
        const weeklySchedule =
          typeof record.weeklySchedule === 'string'
            ? record.weeklySchedule
            : record.weeklySchedule &&
                typeof record.weeklySchedule === 'object' &&
                !Array.isArray(record.weeklySchedule)
              ? JSON.stringify(record.weeklySchedule)
              : '';
        return {
          id,
          name: stringValue(record.name).trim() || `Access Group ${index + 1}`,
          roleId: stringValue(record.roleId).trim(),
          roleName: stringValue(record.roleName).trim(),
          mode: normalizeRoleAccessGroupMode(record.mode),
          enabled: booleanFromUnknown(record.enabled, true),
          weeklySchedule,
          timeZone: stringValue(record.timeZone).trim(),
        };
      })
      .filter((entry): entry is RoleAccessGroup => Boolean(entry));
  } catch {
    return [];
  }
}

function weeklyRegistrationIntervals(
  schedule: WeeklyRegistrationEntry[],
  timeZone: string,
  currentParts: ReturnType<typeof zonedDateParts>,
) {
  return weeklyConfirmationIntervals(
    schedule.map((entry) => ({ ...entry, waitlistStartTime: null })),
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
  config: SessionDiscordConfigRecord,
  now = new Date(),
) {
  const openTime = parseDailyTime(
    configValueOrEmpty(config, 'playConfirmationOpenTime'),
  );
  const closeTime = parseDailyTime(
    configValueOrEmpty(config, 'playConfirmationCloseTime'),
  );
  const waitlistStartTime = parseDailyTime(
    configValueOrEmpty(config, 'playConfirmationWaitlistStartTime'),
  );
  if (!openTime && !closeTime) {
    return null;
  }

  const timeZone = configuredTimeZone(config);
  const currentParts = zonedDateParts(now, timeZone);
  const currentMinutes = currentParts.hour * 60 + currentParts.minute;
  const openMinutes = openTime?.minutes;
  const closeMinutes = closeTime?.minutes;
  let state: 'always_open' | 'not_open' | 'open' | 'closed' = 'open';

  if (openMinutes !== undefined && closeMinutes !== undefined) {
    if (openMinutes === closeMinutes) {
      state = 'open';
    } else if (openMinutes < closeMinutes) {
      state =
        currentMinutes >= openMinutes && currentMinutes < closeMinutes
          ? 'open'
          : currentMinutes < openMinutes
            ? 'not_open'
            : 'closed';
    } else {
      state =
        currentMinutes >= openMinutes || currentMinutes < closeMinutes
          ? 'open'
          : 'closed';
    }
  } else if (openMinutes !== undefined) {
    state = currentMinutes >= openMinutes ? 'open' : 'not_open';
  } else if (closeMinutes !== undefined) {
    state = currentMinutes < closeMinutes ? 'open' : 'closed';
  }

  const opensAt = nextDailyOccurrence(
    now,
    timeZone,
    openTime,
    state === 'open' ? 'next' : 'soonest',
  );
  const closesAt = nextDailyOccurrence(
    now,
    timeZone,
    closeTime,
    state === 'closed' ? 'previous' : 'soonest',
  );
  return {
    opensAt,
    closesAt,
    configured: true,
    state,
    allowsAction: state === 'open',
    mode: 'daily' as const,
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
  state: 'always_open' | 'not_open' | 'open' | 'closed',
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
    state === 'closed' ? 'previous' : 'soonest',
  );
}

function configuredTimeZone(config: SessionDiscordConfigRecord) {
  const timeZone =
    configValueOrEmpty(config, 'playConfirmationTimeZone') || 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
    return timeZone;
  } catch {
    return 'UTC';
  }
}

function configuredRegistrationTimeZone(config: SessionDiscordConfigRecord) {
  const timeZone = configValueOrEmpty(config, 'registrationTimeZone') || 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
    return timeZone;
  } catch {
    return 'UTC';
  }
}

function configuredWaitlistPromotionTimeZone(
  config: SessionDiscordConfigRecord,
) {
  const timeZone =
    configValueOrEmpty(config, 'waitlistPromotionTimeZone') ||
    configValueOrEmpty(config, 'registrationTimeZone') ||
    'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
    return timeZone;
  } catch {
    return 'UTC';
  }
}

function configuredRoleAccessTimeZone(
  config: SessionDiscordConfigRecord,
  kind: RoleAccessKind,
) {
  const timeZone =
    configValueOrEmpty(config, `${kind}TimeZone`) ||
    configValueOrEmpty(config, 'registrationTimeZone') ||
    'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
    return timeZone;
  } catch {
    return 'UTC';
  }
}

function configuredRoleAccessGroupTimeZone(
  group: Pick<RoleAccessGroup, 'timeZone'>,
  config: SessionDiscordConfigRecord,
) {
  const timeZone =
    group.timeZone.trim() ||
    configValueOrEmpty(config, 'registrationTimeZone') ||
    'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
    return timeZone;
  } catch {
    return 'UTC';
  }
}

function parseDailyTime(value?: string | null) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value?.trim() ?? '');
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
  mode: 'soonest' | 'next' | 'previous',
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
  if (mode === 'previous') {
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
  if (mode === 'next') {
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
  return zonedDateTimeToDate(
    timeZone,
    utc.getUTCFullYear(),
    utc.getUTCMonth() + 1,
    utc.getUTCDate(),
    hour,
    minute,
  );
}

function zonedDateParts(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const entries = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== 'literal')
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

function playConfirmationMessageEnabled(config: SessionDiscordConfigRecord) {
  return (
    configValueOrEmpty(config, 'playConfirmationMessageEnabled') === 'true'
  );
}

function playConfirmationMessageTitle(config: SessionDiscordConfigRecord) {
  return (
    configValueOrDefault(
      config,
      'playConfirmationMessageTitle',
      DEFAULT_DISCORD_EMOJIS.playConfirmationMessageTitle,
    ) || DEFAULT_DISCORD_EMOJIS.playConfirmationMessageTitle
  ).slice(0, 256);
}

function playConfirmationMessageText(config: SessionDiscordConfigRecord) {
  const text =
    configValueOrDefault(
      config,
      'playConfirmationMessageText',
      DEFAULT_DISCORD_EMOJIS.playConfirmationMessageText,
    ) || DEFAULT_DISCORD_EMOJIS.playConfirmationMessageText;
  return renderPlayConfirmationMessageText(config, text).slice(0, 4000);
}

function renderPlayConfirmationMessageText(
  config: SessionDiscordConfigRecord,
  text: string,
) {
  const confirm = legacyOrConfiguredEmoji(config, 'playConfirmEmoji', 'check');
  const notPlaying = legacyOrConfiguredEmoji(
    config,
    'playNotPlayingEmoji',
    'reject',
  );
  const replacements: Record<string, string> = {
    confirm,
    notPlaying,
    success: emojiValue(config, 'check'),
    reject: emojiValue(config, 'reject'),
    warning: emojiValue(config, 'warning'),
    slot: emojiValue(config, 'slot'),
    waitlist: emojiValue(config, 'waitlist'),
    team: emojiValue(config, 'team'),
  };

  return text.replace(/\{([A-Za-z]+)\}/g, (match, key: string) => {
    return replacements[key] ?? match;
  });
}

function registrationMessageEnabled(config: SessionDiscordConfigRecord) {
  return configValueOrEmpty(config, 'registrationMessageEnabled') !== 'false';
}

function registrationMode(config: SessionDiscordConfigRecord) {
  const mode = String(config.registrationMode ?? 'SCRIM').toUpperCase();
  if (mode === 'EVENT' || mode === 'TOURNAMENT') {
    return mode;
  }
  return 'SCRIM';
}

function registrationMessageTitle(config: SessionDiscordConfigRecord) {
  const configured = configValue(config, 'registrationMessageTitle');
  const mode = registrationMode(config);
  const defaultTitle =
    mode === 'TOURNAMENT'
      ? DEFAULT_TOURNAMENT_REGISTRATION_MESSAGE_TITLE
      : mode === 'EVENT'
        ? DEFAULT_EVENT_REGISTRATION_MESSAGE_TITLE
        : DEFAULT_DISCORD_EMOJIS.registrationMessageTitle;
  return (
    configured &&
    configured !== DEFAULT_DISCORD_EMOJIS.registrationMessageTitle &&
    !(
      mode === 'EVENT' &&
      configured === LEGACY_TOURNAMENT_REGISTRATION_MESSAGE_TITLE
    )
      ? configured
      : defaultTitle
  ).slice(0, 256);
}

function registrationMessageText(params: {
  config: SessionDiscordConfigRecord;
  session: { name: string };
}) {
  const configured = configValue(params.config, 'registrationMessageText');
  const mode = registrationMode(params.config);
  const defaultText =
    mode === 'TOURNAMENT'
      ? DEFAULT_TOURNAMENT_REGISTRATION_MESSAGE_TEXT
      : mode === 'EVENT'
        ? DEFAULT_EVENT_REGISTRATION_MESSAGE_TEXT
        : DEFAULT_DISCORD_EMOJIS.registrationMessageText;
  const text =
    configured && configured !== DEFAULT_DISCORD_EMOJIS.registrationMessageText
      ? configured
      : defaultText;
  return renderRegistrationMessageText(
    params.config,
    params.session,
    normalizeRegistrationMessageTemplate(params.config, text),
  ).slice(0, 4000);
}

function normalizeRegistrationMessageTemplate(
  config: SessionDiscordConfigRecord,
  text: string,
) {
  const mode = registrationMode(config);
  if (mode !== 'EVENT') {
    return text;
  }

  return text.replace(
    /\{command\}\s+Team Name\s*\|\s*Team Tag\s*\|\s*@manager/gi,
    '{command}',
  );
}

function renderRegistrationMessageText(
  config: SessionDiscordConfigRecord,
  session: { name: string },
  text: string,
) {
  const mode = registrationMode(config);
  const replacements: Record<string, string> = {
    session: session.name,
    command:
      mode === 'EVENT'
        ? 'Team Name | Team Tag | @manager'
        : mode === 'TOURNAMENT'
          ? 'team name: Team Name\nteam tag: TEAMTAG\nteam manager: @manager'
          : config.registrationCommand?.trim() || '%register',
    status: registrationWindowStatusText(config),
    success: emojiValue(config, 'check'),
    reject: emojiValue(config, 'reject'),
    warning: emojiValue(config, 'warning'),
    slot: emojiValue(config, 'slot'),
    waitlist: emojiValue(config, 'waitlist'),
    team: emojiValue(config, 'team'),
  };

  return text.replace(/\{([A-Za-z]+)\}/g, (match, key: string) => {
    return replacements[key] ?? match;
  });
}

function configuredDate(config: SessionDiscordConfigRecord, key: string) {
  const value = configValueOrEmpty(config, key);
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function discordTimestamp(date: Date, style: 'R' | 'f') {
  return `<t:${Math.floor(date.getTime() / 1000)}:${style}>`;
}

function buttonLabel(
  config: SessionDiscordConfigRecord,
  key: 'playConfirmLabel' | 'playNotPlayingLabel',
  fallback: string,
) {
  return configValueOrDefault(config, key, fallback).slice(0, 80);
}

function buttonStyle(
  config: SessionDiscordConfigRecord,
  key: 'playConfirmStyle' | 'playNotPlayingStyle',
  fallback: 'primary' | 'secondary' | 'success' | 'danger',
) {
  const value = configValueOrEmpty(config, key).toLowerCase() || fallback;
  switch (value) {
    case 'primary':
      return 1;
    case 'secondary':
      return 2;
    case 'danger':
      return 4;
    case 'success':
    default:
      return 3;
  }
}

function buttonEmoji(
  config: SessionDiscordConfigRecord,
  key: 'playConfirmEmoji' | 'playNotPlayingEmoji',
  fallbackKey: DiscordEmojiKey,
) {
  return emojiPayload(legacyOrConfiguredEmoji(config, key, fallbackKey));
}

function slotRowMarker(params: {
  config: SessionDiscordConfigRecord;
  slotNumber: number;
  vipIndex?: number;
}) {
  if (slotListMode(params.config) !== 'emoji') {
    return params.vipIndex
      ? `**VIP ${params.vipIndex}.**`
      : `**${params.slotNumber}.**`;
  }
  return params.vipIndex
    ? configuredEmoji(params.config, `vip_${params.vipIndex}`, 'vip')
    : configuredEmoji(params.config, `slot_${params.slotNumber}`, 'slot');
}

function slotRangeForSession(
  session: { slotCount: number },
  config: SessionDiscordConfigRecord,
) {
  const startSlot =
    config.enabled === false ? 3 : Math.max(3, config.startSlot ?? 3);
  const normalSlots =
    config.enabled === false
      ? session.slotCount - startSlot + 1
      : Math.max(0, config.normalSlots ?? session.slotCount - startSlot + 1);

  return {
    startSlot,
    endSlot: Math.min(session.slotCount, startSlot + normalSlots - 1),
  };
}

function vipSlotRangeForSession(
  session: { slotCount: number },
  config: SessionDiscordConfigRecord,
  normalRange: { startSlot: number; endSlot: number },
) {
  const vipSlots =
    config.enabled === false ? 0 : Math.max(0, config.vipSlots ?? 0);
  const startSlot = normalRange.endSlot + 1;
  const endSlot = Math.min(session.slotCount, startSlot + vipSlots - 1);
  return {
    startSlot,
    endSlot,
    capacity: endSlot >= startSlot ? endSlot - startSlot + 1 : 0,
  };
}

function normalSlotAvailable(
  session: { slotCount: number },
  registrations: SessionRegistrationForSync[],
  config: SessionDiscordConfigRecord,
) {
  const range = slotRangeForSession(session, config);
  if (range.endSlot < range.startSlot) {
    return false;
  }
  const occupied = new Set(
    registrations
      .filter(
        (registration) =>
          registration.status !== 'REMOVED' &&
          registration.status !== 'DECLINED' &&
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

function waitlistPromotionOpen(params: {
  session: { status: string; slotCount: number };
  registrations: SessionRegistrationForSync[];
  config: SessionDiscordConfigRecord;
}) {
  return (
    publicWaitlistPromotionWindow(params.session, params.config).allowsAction &&
    normalSlotAvailable(params.session, params.registrations, params.config)
  );
}

@Injectable()
export class SessionDiscordSyncService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly validDiscordMemberCache = new Map<
    string,
    { expiresAt: number }
  >();
  private readonly queuedManualDiscordSyncs = new Map<
    string,
    {
      actor: Actor;
      running: boolean;
      rerun: boolean;
      timer: NodeJS.Timeout | null;
    }
  >();
  private botUserIdCache: string | null | undefined;
  private discordRoleMutationThrottle = Promise.resolve();
  private discordRoleMutationNextAt = 0;
  private foreignEventSourceSyncTimer: NodeJS.Timeout | null = null;
  private foreignEventSourceSyncRunning = false;

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly players?: PlayersService,
  ) {}

  onModuleInit() {
    this.startForeignEventSourceSyncTimer();
  }

  onModuleDestroy() {
    if (this.foreignEventSourceSyncTimer) {
      clearInterval(this.foreignEventSourceSyncTimer);
      this.foreignEventSourceSyncTimer = null;
    }
    for (const sync of this.queuedManualDiscordSyncs.values()) {
      if (sync.timer) {
        clearTimeout(sync.timer);
      }
    }
    this.queuedManualDiscordSyncs.clear();
  }

  private requireOrg(actor: Actor | null | undefined) {
    const role = actor?.actorRole ?? actor?.role ?? null;
    if (role === Role.SUPER_ADMIN && !actor?.actingOrgId) {
      throw new ForbiddenException(
        'Organization context missing for SUPER_ADMIN; impersonation required',
      );
    }
    if (role !== Role.ORGANIZER && role !== Role.SUPER_ADMIN) {
      throw new ForbiddenException('Organizer role required');
    }

    const orgId = effectiveOrganizationId(actor ?? null);
    if (!orgId) {
      throw new ForbiddenException('organizationId is required');
    }
    return orgId;
  }

  private botToken() {
    const token = process.env.DISCORD_BOT_TOKEN || process.env.DISCORD_TOKEN;
    if (!token) {
      throw new BadRequestException('Discord bot token is not configured');
    }
    return token;
  }

  private hasBotToken() {
    return Boolean(process.env.DISCORD_BOT_TOKEN || process.env.DISCORD_TOKEN);
  }

  private async getBotUserId() {
    if (this.botUserIdCache !== undefined) {
      return this.botUserIdCache;
    }

    const user = await this.discordRequest<{ id?: string }>(
      'GET',
      '/users/@me',
    );
    this.botUserIdCache =
      typeof user?.id === 'string' && user.id.trim() ? user.id : null;
    return this.botUserIdCache;
  }

  private foreignEventSourceSyncIntervalMs() {
    const configured = Number(
      process.env.DISCORD_FOREIGN_EVENT_SYNC_INTERVAL_MS,
    );
    if (Number.isFinite(configured) && configured > 0) {
      return Math.max(
        Math.trunc(configured),
        MIN_FOREIGN_EVENT_SOURCE_SYNC_INTERVAL_MS,
      );
    }
    return DEFAULT_FOREIGN_EVENT_SOURCE_SYNC_INTERVAL_MS;
  }

  private foreignEventSourceSyncDisabled() {
    return ['1', 'true', 'yes'].includes(
      (process.env.DISCORD_FOREIGN_EVENT_SYNC_DISABLED ?? '').toLowerCase(),
    );
  }

  private startForeignEventSourceSyncTimer() {
    if (this.foreignEventSourceSyncDisabled() || !this.hasBotToken()) {
      return;
    }

    const intervalMs = this.foreignEventSourceSyncIntervalMs();
    this.foreignEventSourceSyncTimer = setInterval(() => {
      void this.refreshForeignEventSources().catch((error) => {
        console.warn(
          `[DiscordEventSource] automatic refresh failed: ${String(error)}`,
        );
      });
    }, intervalMs);
    this.foreignEventSourceSyncTimer.unref?.();
  }

  private defaultEmojis() {
    return DEFAULT_DISCORD_EMOJIS;
  }

  private normalizeConfig(config: SessionDiscordConfigRecord) {
    return {
      ...config,
      registrationRoleIds: stringArray(config.registrationRoleIds),
      specialRegistrationRoleIds: stringArray(
        config.specialRegistrationRoleIds,
      ),
      manageRoleIds: stringArray(config.manageRoleIds),
      vipRoleIds: stringArray(config.vipRoleIds),
      emojis:
        config.emojis &&
        typeof config.emojis === 'object' &&
        !Array.isArray(config.emojis)
          ? {
              ...this.defaultEmojis(),
              ...(config.emojis as Record<string, unknown>),
            }
          : this.defaultEmojis(),
    };
  }

  private async discordRequest<T>(
    method: string,
    path: string,
    body?: unknown,
    opts: { auditReason?: string; notFoundOk?: boolean } = {},
  ): Promise<T | null> {
    const requestBody = body === undefined ? undefined : JSON.stringify(body);
    const headers: Record<string, string> = {
      Authorization: `Bot ${this.botToken()}`,
    };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    if (opts.auditReason) {
      headers['X-Audit-Log-Reason'] = encodeURIComponent(
        opts.auditReason,
      ).slice(0, 512);
    }

    for (let attempt = 0; attempt <= DISCORD_RATE_LIMIT_RETRIES; attempt += 1) {
      await this.waitForDiscordRoleMutationSlot(method, path);
      const response = await fetch(`${DISCORD_API_BASE_URL}${path}`, {
        method,
        headers,
        body: requestBody,
      });

      if (response.status === 429) {
        const text = await response.text().catch(() => '');
        const delayMs = this.discordRetryDelayMs(response, text, attempt);
        const message = this.discordErrorMessage(response, text);
        if (attempt < DISCORD_RATE_LIMIT_RETRIES) {
          console.warn(
            `[DiscordSync] rate limited ${method} ${this.discordRouteLogPath(
              path,
            )}; retrying in ${delayMs}ms (${attempt + 1}/${DISCORD_RATE_LIMIT_RETRIES})`,
          );
          await sleep(delayMs);
          continue;
        }

        throw new BadRequestException(
          `Discord sync failed (${response.status}): ${message}`,
        );
      }

      if (response.status === 404 && opts.notFoundOk) {
        return null;
      }
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new BadRequestException(
          `Discord sync failed (${response.status}): ${this.discordErrorMessage(
            response,
            text,
          )}`,
        );
      }
      if (response.status === 204) {
        return null;
      }
      return (await response.json()) as T;
    }

    throw new BadRequestException('Discord sync failed: request was not sent');
  }

  private discordErrorMessage(response: Response, text: string) {
    let message = text || response.statusText;
    try {
      const parsed = JSON.parse(text) as { message?: string };
      message = parsed.message ?? message;
    } catch {
      // Keep Discord's raw response text when it is not JSON.
    }
    return message;
  }

  private discordRetryDelayMs(
    response: Response,
    text: string,
    attempt: number,
  ) {
    const retryAfterSeconds = this.discordRetryAfterSeconds(response, text);
    const baseMs =
      retryAfterSeconds === null
        ? 1000 * 2 ** attempt
        : Math.ceil(retryAfterSeconds * 1000);
    return Math.min(
      Math.max(baseMs + DISCORD_RATE_LIMIT_PADDING_MS, 1000),
      DISCORD_RATE_LIMIT_MAX_DELAY_MS,
    );
  }

  private discordRetryAfterSeconds(response: Response, text: string) {
    const headerValue =
      response.headers.get('retry-after') ??
      response.headers.get('x-ratelimit-reset-after');
    const headerSeconds = Number(headerValue);
    if (Number.isFinite(headerSeconds) && headerSeconds >= 0) {
      return headerSeconds;
    }

    try {
      const parsed = JSON.parse(text) as { retry_after?: unknown };
      const retryAfter = Number(parsed.retry_after);
      if (Number.isFinite(retryAfter) && retryAfter >= 0) {
        return retryAfter;
      }
    } catch {
      // Discord usually sends JSON for 429s, but fall back when it does not.
    }

    return null;
  }

  private discordRouteLogPath(path: string) {
    return path.replace(/\d{12,}/g, ':id');
  }

  private isDiscordNotFoundError(error: unknown) {
    const message = String(error);
    return /Discord sync failed \(404\)/i.test(message);
  }

  private isDiscordRoleMutationRequest(method: string, path: string) {
    return (
      (method === 'PUT' || method === 'DELETE') &&
      /^\/guilds\/\d+\/members\/\d+\/roles\/\d+$/.test(path)
    );
  }

  private async waitForDiscordRoleMutationSlot(method: string, path: string) {
    if (!this.isDiscordRoleMutationRequest(method, path)) {
      return;
    }

    const previous = this.discordRoleMutationThrottle.catch(() => undefined);
    let release: () => void = () => undefined;
    this.discordRoleMutationThrottle = previous.then(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    await previous;

    const waitMs = Math.max(0, this.discordRoleMutationNextAt - Date.now());
    if (waitMs > 0) {
      await sleep(waitMs);
    }
    this.discordRoleMutationNextAt =
      Date.now() + DISCORD_ROLE_MUTATION_SPACING_MS;
    release();
  }

  private actorId(actor: Actor | null | undefined) {
    return actor?.actorId ?? actor?.id ?? null;
  }

  private normalizeGameKey(input: string | null | undefined) {
    const trimmed = input?.trim();
    if (!trimmed) return null;
    const normalized = trimmed.toUpperCase();
    if (!Object.values(GameKey).includes(normalized as GameKey)) {
      throw new BadRequestException(
        `gameKey must be one of ${Object.values(GameKey).join(', ')}`,
      );
    }
    return normalized as GameKey;
  }

  private async resolveGameIdentity(gameKey: string | null | undefined) {
    const normalizedGameKey = this.normalizeGameKey(gameKey);
    if (!normalizedGameKey) return null;
    const game = await this.prisma.game.findUnique({
      where: { key: normalizedGameKey },
      select: { id: true, key: true },
    });
    if (!game) {
      throw new BadRequestException(
        `No Game record found for gameKey ${normalizedGameKey}`,
      );
    }
    return game;
  }

  private cleanProductionString(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0
      ? value.trim()
      : null;
  }

  private normalizeProductionDiscordSlotsSnapshot(
    value: Prisma.JsonValue | null | undefined,
  ): ProductionDiscordSlotsSnapshot {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {
        categoryId: null,
        categoryName: null,
        slotListChannelId: null,
        slotListChannelName: null,
        rows: [],
      };
    }

    const raw = value as Record<string, unknown>;
    const rows = Array.isArray(raw.slots)
      ? raw.slots
          .map((entry) => {
            if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
              return null;
            }
            const candidate = entry as Record<string, unknown>;
            const slotNumber = Number(candidate.slotNumber);
            const teamName = this.cleanProductionString(candidate.teamName);
            if (
              !Number.isInteger(slotNumber) ||
              slotNumber < 1 ||
              slotNumber > 100 ||
              !teamName
            ) {
              return null;
            }
            return {
              slotNumber,
              teamName,
              teamTag: this.cleanProductionString(candidate.teamTag),
            } satisfies DiscordEventSlotRow;
          })
          .filter((entry): entry is DiscordEventSlotRow => entry !== null)
          .sort((left, right) => left.slotNumber - right.slotNumber)
      : [];

    return {
      categoryId: this.cleanProductionString(raw.categoryId),
      categoryName: this.cleanProductionString(raw.categoryName),
      slotListChannelId: this.cleanProductionString(raw.slotsChannelId),
      slotListChannelName: this.cleanProductionString(raw.slotsChannelName),
      rows,
    };
  }

  private eventServerAccessMode(
    mode: string | null | undefined,
  ): DiscordEventServerAccessMode {
    return DISCORD_EVENT_SERVER_ACCESS_MODES.includes(
      mode as DiscordEventServerAccessMode,
    )
      ? (mode as DiscordEventServerAccessMode)
      : 'PRIMARY';
  }

  private uniqueSelectableGuilds(guilds: DiscordSelectableGuild[]) {
    const byGuildId = new Map<string, DiscordSelectableGuild>();
    for (const guild of guilds) {
      const guildId = guild.guildId?.trim();
      if (!guildId || byGuildId.has(guildId)) continue;
      byGuildId.set(guildId, { ...guild, guildId });
    }
    return Array.from(byGuildId.values()).sort((left, right) => {
      if (left.isPrimary !== right.isPrimary) {
        return left.isPrimary ? -1 : 1;
      }
      return (left.guildName || left.guildId).localeCompare(
        right.guildName || right.guildId,
      );
    });
  }

  private assertDiscordEntitlementActive(
    organization: DiscordEntitledOrganization,
  ) {
    if ((organization.discordConfig?.maxSessionCount ?? 1) <= 0) {
      throw new ForbiddenException(
        'Discord session access is disabled for this organization',
      );
    }
    if (!organizationHasActiveSubscription(organization)) {
      throw new ForbiddenException(
        'Discord session access has expired for this organization',
      );
    }
  }

  private async requireOrganizationDiscordGuild(
    organizationId: string,
    requestedGuildId?: string | null,
  ): Promise<DiscordEventGuildSelection> {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: {
        subscriptionStatus: true,
        trialEndsAt: true,
        paidUntil: true,
        discordConfig: {
          select: {
            guildId: true,
            guildName: true,
            enabled: true,
            maxSessionCount: true,
            eventServerAccessMode: true,
            lastValidatedAt: true,
          },
        },
        discordGuilds: {
          where: { enabled: true },
          orderBy: [{ isPrimary: 'desc' }, { guildName: 'asc' }],
          select: {
            guildId: true,
            guildName: true,
            isPrimary: true,
          },
        },
      },
    });
    if (!organization) {
      throw new NotFoundException('Organization not found');
    }
    this.assertDiscordEntitlementActive(organization);

    const connectedGuilds: DiscordSelectableGuild[] =
      organization.discordGuilds.map((guild) => ({
        organizationId,
        guildId: guild.guildId,
        guildName: guild.guildName ?? null,
        enabled: true,
        isPrimary: guild.isPrimary,
      }));
    const legacyGuildId = organization.discordConfig?.guildId?.trim();
    if (
      legacyGuildId &&
      !connectedGuilds.some((guild) => guild.guildId === legacyGuildId)
    ) {
      connectedGuilds.push({
        organizationId,
        guildId: legacyGuildId,
        guildName: organization.discordConfig?.guildName ?? null,
        enabled: organization.discordConfig?.enabled ?? true,
        isPrimary: true,
      });
    }

    const mode = this.eventServerAccessMode(
      organization.discordConfig?.eventServerAccessMode,
    );
    const selectableGuilds =
      mode === 'ALL_BOT'
        ? this.uniqueSelectableGuilds([
            ...connectedGuilds,
            ...(await this.prisma.organizationDiscordGuild.findMany({
              where: {
                enabled: true,
                organization: { deletedAt: null },
              },
              orderBy: [{ guildName: 'asc' }, { createdAt: 'asc' }],
              select: {
                organizationId: true,
                guildId: true,
                guildName: true,
                enabled: true,
                isPrimary: true,
              },
            })),
          ])
        : mode === 'CONNECTED'
          ? this.uniqueSelectableGuilds(connectedGuilds)
          : this.uniqueSelectableGuilds(connectedGuilds).slice(0, 1);

    const cleanRequestedGuildId = requestedGuildId?.trim() || null;
    const selectedGuild = cleanRequestedGuildId
      ? (selectableGuilds.find(
          (guild) => guild.guildId === cleanRequestedGuildId,
        ) ?? null)
      : (selectableGuilds[0] ?? null);
    if (cleanRequestedGuildId && !selectedGuild) {
      throw new ForbiddenException(
        mode === 'ALL_BOT'
          ? 'Discord server is not available to this organization'
          : 'Discord server is not approved for event imports',
      );
    }
    if (!selectedGuild) {
      throw new BadRequestException(
        'Connect a Discord server before importing an event',
      );
    }

    await this.discordRequest('GET', `/guilds/${selectedGuild.guildId}`);
    return {
      ...selectedGuild,
      isForeignSource: selectedGuild.organizationId !== organizationId,
    };
  }

  private async fetchGuildChannels(guildId: string) {
    return (
      (await this.discordRequest<DiscordChannel[]>(
        'GET',
        `/guilds/${guildId}/channels`,
      )) ?? []
    );
  }

  private resolveDiscordEventChannels(params: {
    channels: DiscordChannel[];
    categoryId: string;
    guildId?: string | null;
    slotListChannelId?: string | null;
  }) {
    const category = params.channels.find(
      (channel) =>
        channel.id === params.categoryId &&
        channel.type === GUILD_CATEGORY_CHANNEL,
    );
    if (!category) {
      throw new NotFoundException('Discord category not found');
    }

    const childTextChannels = params.channels
      .filter(
        (channel) =>
          channel.type === GUILD_TEXT_CHANNEL &&
          channel.parent_id === category.id,
      )
      .sort((left, right) => left.name.localeCompare(right.name));

    const configuredSlotList = params.slotListChannelId
      ? (childTextChannels.find(
          (channel) => channel.id === params.slotListChannelId,
        ) ?? null)
      : null;
    if (params.slotListChannelId && !configuredSlotList) {
      throw new BadRequestException(
        'Selected slot-list channel is not inside the selected category',
      );
    }

    const slotListChannel =
      configuredSlotList ??
      childTextChannels.find((channel) => looksLikeSlotListChannel(channel)) ??
      childTextChannels.find(
        (channel) => comparableDiscordName(channel.name) === 'registration',
      ) ??
      null;

    return {
      category,
      childTextChannels,
      slotListChannel,
      registrationChannel:
        childTextChannels.find(
          (channel) => comparableDiscordName(channel.name) === 'registration',
        ) ?? null,
      waitlistChannel:
        childTextChannels.find(
          (channel) => comparableDiscordName(channel.name) === 'waitlist',
        ) ?? null,
      idpChannel:
        childTextChannels.find(
          (channel) => comparableDiscordName(channel.name) === 'idp',
        ) ?? null,
      managerChannel:
        childTextChannels.find(
          (channel) => comparableDiscordName(channel.name) === 'manager',
        ) ?? null,
      transferChannel:
        childTextChannels.find(
          (channel) =>
            comparableDiscordName(channel.name) === 'transfer-roles' ||
            comparableDiscordName(channel.name) === 'transfer',
        ) ?? null,
      manageChannel:
        childTextChannels.find(
          (channel) => comparableDiscordName(channel.name) === 'manage',
        ) ?? null,
      resultsChannel:
        childTextChannels.find(
          (channel) => comparableDiscordName(channel.name) === 'results',
        ) ?? null,
      screenshotsChannel:
        childTextChannels.find(
          (channel) => comparableDiscordName(channel.name) === 'screenshots',
        ) ?? null,
      bansChannel:
        childTextChannels.find(
          (channel) => comparableDiscordName(channel.name) === 'bans',
        ) ?? null,
      logChannel:
        childTextChannels.find(
          (channel) => comparableDiscordName(channel.name) === 'log',
        ) ?? null,
    };
  }

  private async findDiscordEventSourceSlotLayout(params: {
    organizationId: string;
    guildId: string;
    categoryId: string;
    slotListChannelId: string | null;
  }): Promise<DiscordEventSlotParseOptions | null> {
    const select = {
      startSlot: true,
      normalSlots: true,
      vipSlots: true,
    } satisfies Prisma.SessionDiscordConfigSelect;
    const baseWhere = {
      organizationId: params.organizationId,
      guildId: params.guildId,
      categoryId: params.categoryId,
      enabled: true,
      session: {
        deletedAt: null,
      },
    } satisfies Prisma.SessionDiscordConfigWhereInput;
    const exact = params.slotListChannelId
      ? await this.prisma.sessionDiscordConfig.findFirst({
          where: {
            ...baseWhere,
            slotListChannelId: params.slotListChannelId,
          },
          orderBy: { updatedAt: 'desc' },
          select,
        })
      : null;
    const fallback =
      exact ??
      (await this.prisma.sessionDiscordConfig.findFirst({
        where: baseWhere,
        orderBy: { updatedAt: 'desc' },
        select,
      }));

    return fallback
      ? {
          startSlot: fallback.startSlot,
          normalSlots: fallback.normalSlots,
          vipSlots: fallback.vipSlots,
        }
      : null;
  }

  private async readDiscordSlotRows(
    slotListChannel: DiscordChannel | null,
    parseOptions: DiscordEventSlotParseOptions = {},
  ) {
    if (!slotListChannel) return [];
    const messages =
      (await this.discordRequest<DiscordMessage[]>(
        'GET',
        `/channels/${slotListChannel.id}/messages?limit=50`,
      )) ?? [];
    return parseDiscordEventSlotRows(messages, parseOptions);
  }

  private configuredLogoChannelIds(
    config: Pick<SessionDiscordConfigRecord, 'emojis'>,
  ) {
    const emojis =
      config.emojis &&
      typeof config.emojis === 'object' &&
      !Array.isArray(config.emojis)
        ? (config.emojis as Record<string, unknown>)
        : {};
    const raw = [emojis.discordLogoChannelIds, emojis.logoChannelIds]
      .filter((value): value is string => typeof value === 'string')
      .join('\n');
    return [...new Set(raw.match(/\d{15,25}/g) ?? [])];
  }

  private configuredPlayerPhotoChannelIds(
    config: Pick<SessionDiscordConfigRecord, 'emojis'>,
  ) {
    const emojis =
      config.emojis &&
      typeof config.emojis === 'object' &&
      !Array.isArray(config.emojis)
        ? (config.emojis as Record<string, unknown>)
        : {};
    const raw = [
      emojis.discordPlayerPhotoChannelIds,
      emojis.playerPhotoChannelIds,
    ]
      .filter((value): value is string => typeof value === 'string')
      .join('\n');
    return [...new Set(raw.match(/\d{15,25}/g) ?? [])];
  }

  private logoHistorySyncLimit(limit: unknown) {
    const parsed = Number(limit);
    if (!Number.isFinite(parsed)) {
      return DEFAULT_SYNC_OLD_LOGOS_LIMIT;
    }
    return Math.min(MAX_SYNC_OLD_LOGOS_LIMIT, Math.max(1, Math.trunc(parsed)));
  }

  private normalizeLookupText(value: string | null | undefined) {
    return (value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  }

  private normalizeLogoKey(value: string | null | undefined) {
    return (value ?? '')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private parseLogoHistoryMessage(message: DiscordMessage) {
    const content = (message.content ?? '').replace(/https?:\/\/\S+/gi, ' ');
    const lines = content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const commandLine =
      lines[0]?.replace(LOGO_COMMAND_PATTERN, '').trim() ?? '';
    const fields = commandLine
      ? [commandLine, ...lines.slice(1)]
      : lines.slice(1);
    const teamName = fields
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^"|"$/g, '')
      .trim();

    return teamName || null;
  }

  private parsePlayerPhotoHistoryMessage(
    message: DiscordMessage,
    registrationMode?: string | null,
  ) {
    const content = (message.content ?? '').replace(/https?:\/\/\S+/gi, ' ');
    const lines = content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const commandLine =
      lines[0]?.replace(PLAYER_PHOTO_COMMAND_PATTERN, '').trim() ?? '';
    const commandFields = commandLine.includes('|')
      ? commandLine
          .split('|')
          .map((entry) => entry.trim())
          .filter(Boolean)
      : commandLine
        ? [commandLine]
        : [];
    const fields = [...commandFields, ...lines.slice(1)]
      .map((line) => line.trim())
      .filter(Boolean);
    const mode = (registrationMode ?? 'SCRIM').toUpperCase();

    if (mode === 'TOURNAMENT') {
      const uid = fields[0]?.replace(/\s+/g, '') ?? '';
      return uid ? { uid, teamName: null, playerName: null } : null;
    }

    const [teamName, playerName, rawUid] = fields;
    const uid = rawUid?.replace(/\s+/g, '') ?? '';
    if (!teamName || !playerName || !uid) {
      return null;
    }

    return { uid, teamName, playerName };
  }

  private logoContentTypeFromFilename(filename: string | null | undefined) {
    const lower = filename?.toLowerCase() ?? '';
    if (/\.(?:png)(?:\?|$)/.test(lower)) return 'image/png';
    if (/\.(?:jpe?g)(?:\?|$)/.test(lower)) return 'image/jpeg';
    if (/\.(?:webp)(?:\?|$)/.test(lower)) return 'image/webp';
    return null;
  }

  private findLogoSource(message: DiscordMessage): DiscordLogoSource | null {
    const attachment = (message.attachments ?? []).find((entry) => {
      const contentType = (entry.content_type ?? entry.contentType ?? '')
        .split(';')[0]
        .toLowerCase();
      const filename = entry.filename ?? entry.url ?? '';
      return (
        (contentType && ALLOWED_LOGO_TYPES.has(contentType)) ||
        /\.(png|jpe?g|webp)(?:\?|$)/i.test(filename)
      );
    });
    if (attachment?.url) {
      return {
        url: attachment.url,
        attachmentId: attachment.id?.trim() || null,
        filename: attachment.filename?.trim() || null,
        contentType:
          (attachment.content_type ?? attachment.contentType ?? '')
            .split(';')[0]
            .toLowerCase()
            .trim() || null,
        size: Number.isFinite(Number(attachment.size))
          ? Number(attachment.size)
          : null,
      };
    }

    const match = /https?:\/\/\S+/i.exec(message.content ?? '');
    const url = match?.[0]?.replace(/[)>.,]+$/, '') ?? null;
    if (!url) {
      return null;
    }
    return {
      url,
      attachmentId: null,
      filename: url,
      contentType: this.logoContentTypeFromFilename(url),
      size: null,
    };
  }

  private async downloadLogoUpload(source: DiscordLogoSource) {
    if (source.size !== null && source.size > MAX_LOGO_UPLOAD_BYTES) {
      throw new Error('logo is larger than 8 MB');
    }

    const response = await fetch(source.url);
    if (!response.ok) {
      throw new Error(`logo request failed with ${response.status}`);
    }
    const contentLength = Number(response.headers.get('content-length') ?? '0');
    if (contentLength > MAX_LOGO_UPLOAD_BYTES) {
      throw new Error('logo is larger than 8 MB');
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > MAX_LOGO_UPLOAD_BYTES) {
      throw new Error('logo is larger than 8 MB');
    }

    const responseContentType =
      response.headers.get('content-type')?.split(';')[0]?.toLowerCase() ??
      null;
    const contentType =
      (source.contentType && ALLOWED_LOGO_TYPES.has(source.contentType)
        ? source.contentType
        : null) ??
      (responseContentType && ALLOWED_LOGO_TYPES.has(responseContentType)
        ? responseContentType
        : null) ??
      this.logoContentTypeFromFilename(source.filename ?? source.url);
    if (!contentType || !ALLOWED_LOGO_TYPES.has(contentType)) {
      throw new Error('logo must be PNG, JPG, or WEBP');
    }

    return {
      buffer,
      mimetype: contentType,
    };
  }

  private parsePendingTeamLogos(
    config: Pick<SessionDiscordConfigRecord, 'emojis'>,
  ) {
    const emojis =
      config.emojis &&
      typeof config.emojis === 'object' &&
      !Array.isArray(config.emojis)
        ? (config.emojis as Record<string, unknown>)
        : {};
    const raw = emojis[PENDING_TEAM_LOGOS_KEY];
    if (typeof raw !== 'string' || !raw.trim()) {
      return {};
    }

    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return {};
      }
      const records: Record<string, PendingDiscordTeamLogoRecord> = {};
      for (const [key, value] of Object.entries(
        parsed as Record<string, unknown>,
      )) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
          continue;
        }
        const record = value as Partial<PendingDiscordTeamLogoRecord>;
        const normalizedKey = this.normalizeLogoKey(record.teamName ?? key);
        const url = record.url?.trim();
        const channelId = record.channelId?.trim();
        const messageId = record.messageId?.trim();
        if (!normalizedKey || !url || !channelId || !messageId) {
          continue;
        }
        records[normalizedKey] = {
          key: normalizedKey,
          tagKey: this.normalizeLogoKey(record.tag ?? record.tagKey ?? ''),
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

  private limitedPendingTeamLogos(
    records: Record<string, PendingDiscordTeamLogoRecord>,
  ) {
    return Object.fromEntries(
      Object.entries(records)
        .sort(
          ([, left], [, right]) =>
            Date.parse(right.savedAt) - Date.parse(left.savedAt),
        )
        .slice(0, MAX_PENDING_TEAM_LOGOS),
    );
  }

  private pendingLogoRecordFromHistoryMessage(params: {
    teamName: string;
    channelId: string;
    message: DiscordMessage;
    source: DiscordLogoSource;
  }): PendingDiscordTeamLogoRecord | null {
    const key = this.normalizeLogoKey(params.teamName);
    if (!key) {
      return null;
    }

    return {
      key,
      tagKey: '',
      teamName: params.teamName,
      tag: null,
      channelId: params.channelId,
      messageId: params.message.id,
      attachmentId: params.source.attachmentId,
      url: params.source.url,
      filename: params.source.filename,
      contentType: params.source.contentType,
      savedByDiscordId: params.message.author?.id?.trim() || null,
      savedByDiscordUsername: params.message.author?.username?.trim() || null,
      savedAt: new Date().toISOString(),
    };
  }

  private pendingLogoSource(record: PendingDiscordTeamLogoRecord) {
    return {
      url: record.url,
      attachmentId: record.attachmentId,
      filename: record.filename,
      contentType: record.contentType,
      size: null,
    } satisfies DiscordLogoSource;
  }

  private findPendingLogoSourceInMessage(
    record: PendingDiscordTeamLogoRecord,
    message: DiscordMessage,
  ): DiscordLogoSource | null {
    const attachment = record.attachmentId
      ? (message.attachments ?? []).find(
          (entry) => entry.id === record.attachmentId,
        )
      : (message.attachments ?? []).find((entry) => {
          const contentType = (entry.content_type ?? entry.contentType ?? '')
            .split(';')[0]
            .toLowerCase();
          const filename = entry.filename ?? entry.url ?? '';
          return (
            (contentType && ALLOWED_LOGO_TYPES.has(contentType)) ||
            /\.(png|jpe?g|webp)(?:\?|$)/i.test(filename)
          );
        });
    if (!attachment?.url) {
      return null;
    }

    return {
      url: attachment.url,
      attachmentId: attachment.id?.trim() || record.attachmentId,
      filename: attachment.filename?.trim() || record.filename,
      contentType:
        (attachment.content_type ?? attachment.contentType ?? '')
          .split(';')[0]
          .toLowerCase()
          .trim() ||
        record.contentType ||
        this.logoContentTypeFromFilename(attachment.filename ?? attachment.url),
      size: Number.isFinite(Number(attachment.size))
        ? Number(attachment.size)
        : null,
    };
  }

  private async resolvePendingLogoSource(record: PendingDiscordTeamLogoRecord) {
    try {
      const message = await this.discordRequest<DiscordMessage>(
        'GET',
        `/channels/${record.channelId}/messages/${record.messageId}`,
        undefined,
        { notFoundOk: true },
      );
      if (message) {
        const source = this.findPendingLogoSourceInMessage(record, message);
        if (source) {
          return source;
        }
      }
    } catch {
      // Fall back to the stored URL; downloadLogoUpload will surface a useful error if it is expired.
    }

    return this.pendingLogoSource(record);
  }

  private pendingLogoMatchesTeam(
    record: PendingDiscordTeamLogoRecord,
    team: { name: string; tag: string | null },
  ) {
    const teamNameKey = this.normalizeLogoKey(team.name);
    const teamTagKey = this.normalizeLogoKey(team.tag ?? '');
    const recordNameKey = this.normalizeLogoKey(record.teamName);
    const recordTagKey = this.normalizeLogoKey(record.tagKey || record.tag);

    const tagMatches =
      teamTagKey.length > 0 &&
      (recordTagKey === teamTagKey || record.key === teamTagKey);
    if (tagMatches) {
      return true;
    }

    const nameMatches =
      teamNameKey.length > 0 &&
      (record.key === teamNameKey || recordNameKey === teamNameKey);
    if (!nameMatches) {
      return false;
    }

    // A name match is safe only when the saved logo has no different tag.
    return !recordTagKey || !teamTagKey || recordTagKey === teamTagKey;
  }

  private findPendingLogoForTeam(
    team: { name: string; tag: string | null },
    records: PendingDiscordTeamLogoRecord[],
  ) {
    const matches = records
      .filter((record) => this.pendingLogoMatchesTeam(record, team))
      .sort(
        (left, right) => Date.parse(right.savedAt) - Date.parse(left.savedAt),
      );
    return matches[0] ?? null;
  }

  private async backfillActiveTeamLogosFromPending(params: {
    organizationId: string;
    guildId: string;
  }) {
    const configs = await this.prisma.sessionDiscordConfig.findMany({
      where: {
        organizationId: params.organizationId,
        guildId: params.guildId,
        enabled: true,
        session: {
          type: SessionType.SCRIM,
          status: { not: SessionStatus.ARCHIVED },
          deletedAt: null,
        },
      },
      select: {
        sessionId: true,
        emojis: true,
      },
    });
    const sessionIds = configs
      .map((config) => config.sessionId)
      .filter((sessionId, index, sessionIds) => {
        return sessionId.length > 0 && sessionIds.indexOf(sessionId) === index;
      });
    if (sessionIds.length === 0) {
      return {
        backfilled: 0,
        failures: [] as Array<{
          channelId: string;
          messageId: string;
          reason: string;
        }>,
      };
    }

    const recordByIdentity = new Map<string, PendingDiscordTeamLogoRecord>();
    for (const config of configs) {
      for (const record of Object.values(this.parsePendingTeamLogos(config))) {
        const identity = [
          record.key,
          record.tagKey,
          record.channelId,
          record.messageId,
          record.attachmentId ?? record.url,
        ].join('|');
        recordByIdentity.set(identity, record);
      }
    }
    const records = [...recordByIdentity.values()];
    if (records.length === 0) {
      return { backfilled: 0, failures: [] };
    }

    const registrations = await this.prisma.sessionRegistration.findMany({
      where: {
        organizationId: params.organizationId,
        sessionId: { in: sessionIds },
        deletedAt: null,
        removedAt: null,
        status: {
          notIn: [
            SessionRegistrationStatus.REMOVED,
            SessionRegistrationStatus.DECLINED,
          ],
        },
        team: {
          deletedAt: null,
          OR: [{ logoUrl: null }, { logoUrl: '' }],
        },
      },
      select: {
        team: {
          select: {
            id: true,
            name: true,
            tag: true,
          },
        },
      },
    });

    const teams = [
      ...new Map(
        registrations
          .map((registration) => registration.team)
          .filter((team): team is NonNullable<typeof team> => Boolean(team))
          .map((team) => [team.id, team]),
      ).values(),
    ];
    const failures: Array<{
      channelId: string;
      messageId: string;
      reason: string;
    }> = [];
    let backfilled = 0;

    for (const team of teams) {
      const record = this.findPendingLogoForTeam(team, records);
      if (!record) {
        continue;
      }
      try {
        const upload = await this.downloadLogoUpload(
          await this.resolvePendingLogoSource(record),
        );
        const stored = await storeTeamLogoProcessed(team.id, {
          buffer: upload.buffer,
          mimetype: upload.mimetype,
        });
        const updated = await this.prisma.team.updateMany({
          where: {
            id: team.id,
            OR: [{ logoUrl: null }, { logoUrl: '' }],
          },
          data: { logoUrl: stored.url },
        });
        if (updated.count > 0) {
          backfilled += 1;
        }
      } catch (error) {
        failures.push({
          channelId: record.channelId,
          messageId: record.messageId,
          reason:
            error instanceof Error && error.message.trim()
              ? `Backfill ${team.name}: ${error.message.trim()}`
              : `Backfill ${team.name}: logo backfill failed`,
        });
      }
    }

    return { backfilled, failures };
  }

  private async resolveLogoHistoryTeam(organizationId: string, query: string) {
    const cleaned = query.trim().replace(/^"|"$/g, '').trim();
    if (!cleaned) {
      return null;
    }

    const normalizedName = this.normalizeLookupText(cleaned);
    const tagResult = normalizeAndValidateTeamTag(cleaned);
    const normalizedTag = tagResult.error ? null : tagResult.normalized;
    const exactMatches: Prisma.TeamWhereInput[] = [
      { name: { equals: cleaned, mode: 'insensitive' } },
    ];
    if (normalizedTag) {
      exactMatches.push({
        tag: { equals: normalizedTag, mode: 'insensitive' },
      });
    }
    const teams = await this.prisma.team.findMany({
      where: {
        organizationId,
        deletedAt: null,
        OR: exactMatches,
      },
      select: {
        id: true,
        name: true,
        tag: true,
      },
    });
    const exactTeams = teams.filter(
      (team) =>
        this.normalizeLookupText(team.name) === normalizedName ||
        (normalizedTag &&
          this.normalizeLookupText(team.tag) ===
            this.normalizeLookupText(normalizedTag)),
    );
    if (exactTeams.length > 1) {
      throw new Error(`multiple teams match "${cleaned}"`);
    }
    return exactTeams[0] ?? null;
  }

  private async fetchLogoHistoryMessages(channelId: string, limit: number) {
    const messages: DiscordMessage[] = [];
    let before: string | undefined;

    while (messages.length < limit) {
      const batchLimit = Math.min(100, limit - messages.length);
      const query = new URLSearchParams({ limit: String(batchLimit) });
      if (before) {
        query.set('before', before);
      }
      const batch =
        (await this.discordRequest<DiscordMessage[]>(
          'GET',
          `/channels/${channelId}/messages?${query.toString()}`,
        )) ?? [];
      if (batch.length === 0) {
        break;
      }
      messages.push(...batch);
      before = batch[batch.length - 1]?.id;
      if (!before || batch.length < batchLimit) {
        break;
      }
    }

    return messages.sort((left, right) => {
      try {
        return BigInt(left.id) < BigInt(right.id) ? -1 : 1;
      } catch {
        return left.id.localeCompare(right.id);
      }
    });
  }

  async syncOldLogoMessages(
    sessionId: string,
    params: { limit?: unknown; channelId?: string | null },
    actor: Actor,
  ): Promise<DiscordLogoHistorySyncResult> {
    const organizationId = this.requireOrg(actor);
    const limit = this.logoHistorySyncLimit(params.limit);
    const requestedChannelId = params.channelId?.trim() || null;
    const session = await this.prisma.session.findFirst({
      where: {
        id: sessionId,
        organizationId,
        deletedAt: null,
      },
      select: {
        id: true,
        organizationId: true,
        discordConfig: true,
        organization: {
          select: {
            subscriptionStatus: true,
            trialEndsAt: true,
            paidUntil: true,
            discordConfig: {
              select: {
                guildId: true,
                maxSessionCount: true,
              },
            },
          },
        },
      },
    });
    if (!session) {
      throw new NotFoundException('Session not found');
    }
    this.assertDiscordEntitlementActive(session.organization);

    const config = session.discordConfig as SessionDiscordConfigRecord | null;
    if (!config || !config.enabled || !config.guildId) {
      throw new BadRequestException(
        'Enable Discord sync and connect a Discord server before syncing older logos',
      );
    }
    const configuredChannelIds = this.configuredLogoChannelIds(config);
    if (configuredChannelIds.length === 0) {
      throw new BadRequestException('Add a synced logo channel first');
    }
    const channelIds = requestedChannelId
      ? [requestedChannelId]
      : configuredChannelIds;
    for (const channelId of channelIds) {
      if (!configuredChannelIds.includes(channelId)) {
        throw new BadRequestException(
          'This channel is not configured as a synced logo channel',
        );
      }
    }

    const result: DiscordLogoHistorySyncResult = {
      ok: true,
      sessionId: session.id,
      guildId: config.guildId,
      channelIds,
      limit,
      scanned: 0,
      matched: 0,
      saved: 0,
      pending: 0,
      backfilled: 0,
      skipped: 0,
      failed: 0,
      failures: [],
    };
    let pendingTargets: Array<{
      id: string;
      emojis: unknown;
      records: Record<string, PendingDiscordTeamLogoRecord>;
      changed: boolean;
    }> = [];
    let pendingTargetsLoaded = false;
    const getPendingTargets = async () => {
      if (pendingTargetsLoaded) {
        return pendingTargets;
      }
      const targetConfigs = await this.prisma.sessionDiscordConfig.findMany({
        where: {
          organizationId,
          guildId: config.guildId,
          enabled: true,
          session: {
            type: SessionType.SCRIM,
            status: { not: SessionStatus.ARCHIVED },
            deletedAt: null,
          },
        },
        select: {
          id: true,
          emojis: true,
        },
      });
      const configs =
        targetConfigs.length > 0
          ? targetConfigs
          : [{ id: config.id, emojis: config.emojis }];
      pendingTargets = configs.map((targetConfig) => ({
        id: targetConfig.id,
        emojis: targetConfig.emojis,
        records: this.parsePendingTeamLogos(targetConfig),
        changed: false,
      }));
      pendingTargetsLoaded = true;
      return pendingTargets;
    };

    for (const channelId of channelIds) {
      const messages = await this.fetchLogoHistoryMessages(channelId, limit);
      result.scanned += messages.length;
      for (const message of messages) {
        if (!LOGO_COMMAND_PATTERN.test((message.content ?? '').trim())) {
          continue;
        }
        result.matched += 1;
        const teamName = this.parseLogoHistoryMessage(message);
        if (!teamName) {
          result.skipped += 1;
          continue;
        }
        const source = this.findLogoSource(message);
        if (!source) {
          result.skipped += 1;
          continue;
        }

        try {
          const upload = await this.downloadLogoUpload(source);
          const pendingRecord = this.pendingLogoRecordFromHistoryMessage({
            teamName,
            channelId,
            message,
            source,
          });
          if (!pendingRecord) {
            result.skipped += 1;
            continue;
          }
          const targets = await getPendingTargets();
          for (const target of targets) {
            target.records[pendingRecord.key] = pendingRecord;
            target.changed = true;
          }

          const team = await this.resolveLogoHistoryTeam(
            organizationId,
            teamName,
          );
          if (team) {
            const stored = await storeTeamLogoProcessed(team.id, {
              buffer: upload.buffer,
              mimetype: upload.mimetype,
            });
            await this.prisma.team.update({
              where: { id: team.id },
              data: { logoUrl: stored.url },
            });
            result.saved += 1;
            continue;
          }

          result.pending += 1;
        } catch (error) {
          result.failed += 1;
          result.failures.push({
            channelId,
            messageId: message.id,
            reason:
              error instanceof Error && error.message.trim()
                ? error.message.trim()
                : 'Logo sync failed',
          });
        }
      }
    }

    if (pendingTargetsLoaded) {
      for (const target of pendingTargets) {
        if (!target.changed) {
          continue;
        }
        const emojis =
          target.emojis &&
          typeof target.emojis === 'object' &&
          !Array.isArray(target.emojis)
            ? { ...(target.emojis as Record<string, Prisma.InputJsonValue>) }
            : {};
        emojis[PENDING_TEAM_LOGOS_KEY] = JSON.stringify(
          this.limitedPendingTeamLogos(target.records),
        );
        await this.prisma.sessionDiscordConfig.update({
          where: { id: target.id },
          data: { emojis },
        });
      }
    }

    const backfill = await this.backfillActiveTeamLogosFromPending({
      organizationId,
      guildId: config.guildId,
    });
    result.backfilled = backfill.backfilled;
    if (backfill.failures.length > 0) {
      result.failed += backfill.failures.length;
      result.failures.push(...backfill.failures);
    }

    return result;
  }

  async syncOldPlayerPhotoMessages(
    sessionId: string,
    params: { limit?: unknown; channelId?: string | null },
    actor: Actor,
  ): Promise<DiscordPlayerPhotoHistorySyncResult> {
    if (!this.players) {
      throw new InternalServerErrorException(
        'Player photo sync service is unavailable',
      );
    }
    const organizationId = this.requireOrg(actor);
    const limit = this.logoHistorySyncLimit(params.limit);
    const requestedChannelId = params.channelId?.trim() || null;
    const session = await this.prisma.session.findFirst({
      where: {
        id: sessionId,
        organizationId,
        deletedAt: null,
      },
      select: {
        id: true,
        organizationId: true,
        discordConfig: true,
        organization: {
          select: {
            subscriptionStatus: true,
            trialEndsAt: true,
            paidUntil: true,
            discordConfig: {
              select: {
                guildId: true,
                maxSessionCount: true,
              },
            },
          },
        },
      },
    });
    if (!session) {
      throw new NotFoundException('Session not found');
    }
    this.assertDiscordEntitlementActive(session.organization);

    const config = session.discordConfig as SessionDiscordConfigRecord | null;
    if (!config || !config.enabled || !config.guildId) {
      throw new BadRequestException(
        'Enable Discord sync and connect a Discord server before syncing older player photos',
      );
    }
    const configuredChannelIds = this.configuredPlayerPhotoChannelIds(config);
    if (configuredChannelIds.length === 0) {
      throw new BadRequestException('Add a synced player photo channel first');
    }
    const channelIds = requestedChannelId
      ? [requestedChannelId]
      : configuredChannelIds;
    for (const channelId of channelIds) {
      if (!configuredChannelIds.includes(channelId)) {
        throw new BadRequestException(
          'This channel is not configured as a synced player photo channel',
        );
      }
    }

    const result: DiscordPlayerPhotoHistorySyncResult = {
      ok: true,
      sessionId: session.id,
      guildId: config.guildId,
      channelIds,
      limit,
      scanned: 0,
      matched: 0,
      saved: 0,
      skipped: 0,
      failed: 0,
      failures: [],
    };

    for (const channelId of channelIds) {
      const messages = await this.fetchLogoHistoryMessages(channelId, limit);
      result.scanned += messages.length;
      for (const message of messages) {
        if (
          !PLAYER_PHOTO_COMMAND_PATTERN.test((message.content ?? '').trim())
        ) {
          continue;
        }
        result.matched += 1;
        const parsed = this.parsePlayerPhotoHistoryMessage(
          message,
          config.registrationMode,
        );
        if (!parsed) {
          result.skipped += 1;
          continue;
        }
        const source = this.findLogoSource(message);
        if (!source) {
          result.skipped += 1;
          continue;
        }

        try {
          const upload = await this.downloadLogoUpload(source);
          const target = await this.players.prepareDiscordPlayerPhotoTarget(
            organizationId,
            {
              sessionId: session.id,
              registrationMode: config.registrationMode,
              uid: parsed.uid,
              teamName: parsed.teamName,
              playerName: parsed.playerName,
            },
            actor as AuthUser,
          );
          const stored = await storePlayerPhotoProcessed(target.player.id, {
            buffer: upload.buffer,
            mimetype: upload.mimetype,
          });
          await this.prisma.player.update({
            where: { id: target.player.id },
            data: { photoUrl: stored.url },
          });
          result.saved += 1;
        } catch (error) {
          result.failed += 1;
          result.failures.push({
            channelId,
            messageId: message.id,
            reason:
              error instanceof Error && error.message.trim()
                ? error.message.trim()
                : 'Player photo sync failed',
          });
        }
      }
    }

    return result;
  }

  private discordEventSlotCount(
    rows: DiscordEventSlotRow[],
    defaultSlotCount: number,
  ) {
    const maxSlot = rows.reduce((max, row) => Math.max(max, row.slotNumber), 0);
    return Math.min(100, Math.max(defaultSlotCount, maxSlot));
  }

  private discordEventNormalSlots(params: {
    slotCount: number;
    startSlot: number;
    slotListChannel?: Pick<DiscordChannel, 'name'> | null;
    sourceSlotLayout?: DiscordEventSlotParseOptions | null;
  }) {
    const availableSlots = Math.max(0, params.slotCount - params.startSlot + 1);
    const sourceNormalSlots = validDiscordSlotCount(
      params.sourceSlotLayout?.normalSlots,
    );
    const namedNormalSlots = playableSlotCountFromSlotListChannelName(
      params.slotListChannel?.name,
    );
    const normalSlots =
      sourceNormalSlots ??
      namedNormalSlots ??
      Math.max(0, params.slotCount - 2);
    return Math.min(availableSlots, Math.max(0, normalSlots));
  }

  private discordEventImportNote(params: {
    categoryId: string;
    slotListChannelId: string | null;
    slotNumber: number;
    importNotePrefix?: string;
  }) {
    return `${params.importNotePrefix ?? DISCORD_EVENT_IMPORT_NOTE_PREFIX}category=${params.categoryId};channel=${
      params.slotListChannelId ?? ''
    };slot=${params.slotNumber}`;
  }

  private async findOrCreateImportedDiscordTeam(params: {
    tx: Prisma.TransactionClient;
    organizationId: string;
    ownerUserId: string;
    sourceOrganizationId?: string | null;
    row: DiscordEventSlotRow;
  }) {
    const tag = params.row.teamTag?.trim() || null;
    const sourceLogoUrl =
      params.sourceOrganizationId &&
      params.sourceOrganizationId !== params.organizationId
        ? (
            await params.tx.team.findFirst({
              where: {
                organizationId: params.sourceOrganizationId,
                deletedAt: null,
                name: { equals: params.row.teamName, mode: 'insensitive' },
              },
              orderBy: { updatedAt: 'desc' },
              select: { logoUrl: true },
            })
          )?.logoUrl?.trim() || null
        : null;
    const existing = await params.tx.team.findFirst({
      where: {
        organizationId: params.organizationId,
        deletedAt: null,
        name: { equals: params.row.teamName, mode: 'insensitive' },
      },
      select: { id: true, logoUrl: true },
    });
    if (existing) {
      if (sourceLogoUrl && !existing.logoUrl?.trim()) {
        await params.tx.team.update({
          where: { id: existing.id },
          data: { logoUrl: sourceLogoUrl },
        });
      }
      return existing.id;
    }

    const team = await params.tx.team.create({
      data: {
        organizationId: params.organizationId,
        ownerUserId: params.ownerUserId,
        name: params.row.teamName,
        tag,
        ...(sourceLogoUrl ? { logoUrl: sourceLogoUrl } : {}),
      },
      select: { id: true },
    });
    return team.id;
  }

  private async applyDiscordEventSlotRows(params: {
    tx: Prisma.TransactionClient;
    organizationId: string;
    sessionId: string;
    categoryId: string;
    slotListChannelId: string | null;
    ownerUserId: string;
    sourceOrganizationId?: string | null;
    rows: DiscordEventSlotRow[];
    importNotePrefix?: string;
    importSourceLabel?: string;
  }) {
    const importNotePrefix =
      params.importNotePrefix ?? DISCORD_EVENT_IMPORT_NOTE_PREFIX;
    const importSourceLabel = params.importSourceLabel ?? 'Discord slot-list';
    const existingRegistrations = await params.tx.sessionRegistration.findMany({
      where: {
        organizationId: params.organizationId,
        sessionId: params.sessionId,
        deletedAt: null,
      },
      select: {
        id: true,
        teamId: true,
        leaderDiscordUserId: true,
        managerDiscordUserIds: true,
        status: true,
        slotNumber: true,
        note: true,
      },
    });
    const importedRegistrations = existingRegistrations.filter((registration) =>
      registration.note?.startsWith(importNotePrefix),
    );
    const touchedRegistrationIds = new Set<string>();
    const touchedTeamIds = new Set<string>();
    const skipped: Array<{
      slotNumber: number;
      teamName: string;
      reason: string;
    }> = [];
    const now = new Date();

    for (const row of params.rows) {
      const teamId = await this.findOrCreateImportedDiscordTeam({
        tx: params.tx,
        organizationId: params.organizationId,
        ownerUserId: params.ownerUserId,
        sourceOrganizationId: params.sourceOrganizationId,
        row,
      });
      if (touchedTeamIds.has(teamId)) {
        skipped.push({
          slotNumber: row.slotNumber,
          teamName: row.teamName,
          reason: `team appears more than once in the ${importSourceLabel}`,
        });
        continue;
      }
      const slotConflict = existingRegistrations.find(
        (registration) =>
          registration.slotNumber === row.slotNumber &&
          registration.teamId !== teamId &&
          !registration.note?.startsWith(importNotePrefix) &&
          registration.status !== SessionRegistrationStatus.REMOVED &&
          registration.status !== SessionRegistrationStatus.DECLINED,
      );
      if (slotConflict) {
        skipped.push({
          slotNumber: row.slotNumber,
          teamName: row.teamName,
          reason: 'slot is already held by a manual registration',
        });
        continue;
      }
      touchedTeamIds.add(teamId);

      const note = this.discordEventImportNote({
        categoryId: params.categoryId,
        slotListChannelId: params.slotListChannelId,
        slotNumber: row.slotNumber,
        importNotePrefix,
      });
      const existing = existingRegistrations.find(
        (registration) => registration.teamId === teamId,
      );
      const importedSlot = existingRegistrations.find(
        (registration) =>
          registration.slotNumber === row.slotNumber &&
          registration.note?.startsWith(importNotePrefix),
      );
      if (existing && importedSlot && existing.id !== importedSlot.id) {
        await params.tx.sessionRegistration.update({
          where: { id: importedSlot.id },
          data: {
            status: SessionRegistrationStatus.REMOVED,
            slotNumber: null,
            waitlistPosition: null,
            removedAt: now,
            removalReason: `Replaced by ${importSourceLabel} import`,
          },
          select: { id: true },
        });
        importedSlot.status = SessionRegistrationStatus.REMOVED;
        importedSlot.slotNumber = null;
      }
      if (existing) {
        const updated = await params.tx.sessionRegistration.update({
          where: { id: existing.id },
          data: {
            teamId,
            status: SessionRegistrationStatus.CONFIRMED,
            slotNumber: row.slotNumber,
            waitlistPosition: null,
            confirmedAt: now,
            checkedInAt: null,
            removedAt: null,
            removalReason: null,
            deletedAt: null,
            note,
          },
          select: { id: true },
        });
        existing.teamId = teamId;
        existing.status = SessionRegistrationStatus.CONFIRMED;
        existing.slotNumber = row.slotNumber;
        existing.note = note;
        touchedRegistrationIds.add(updated.id);
      } else if (importedSlot) {
        const updated = await params.tx.sessionRegistration.update({
          where: { id: importedSlot.id },
          data: {
            teamId,
            status: SessionRegistrationStatus.CONFIRMED,
            slotNumber: row.slotNumber,
            waitlistPosition: null,
            confirmedAt: now,
            checkedInAt: null,
            removedAt: null,
            removalReason: null,
            deletedAt: null,
            note,
          },
          select: { id: true },
        });
        importedSlot.teamId = teamId;
        importedSlot.status = SessionRegistrationStatus.CONFIRMED;
        importedSlot.slotNumber = row.slotNumber;
        importedSlot.note = note;
        touchedRegistrationIds.add(updated.id);
      } else {
        const created = await params.tx.sessionRegistration.create({
          data: {
            organizationId: params.organizationId,
            sessionId: params.sessionId,
            teamId,
            status: SessionRegistrationStatus.CONFIRMED,
            slotNumber: row.slotNumber,
            waitlistPosition: null,
            confirmedAt: now,
            checkedInAt: null,
            note,
          },
          select: { id: true },
        });
        existingRegistrations.push({
          id: created.id,
          teamId,
          leaderDiscordUserId: null,
          managerDiscordUserIds: [],
          status: SessionRegistrationStatus.CONFIRMED,
          slotNumber: row.slotNumber,
          note,
        });
        touchedRegistrationIds.add(created.id);
      }
    }

    for (const registration of importedRegistrations) {
      if (touchedRegistrationIds.has(registration.id)) continue;
      await params.tx.sessionRegistration.update({
        where: { id: registration.id },
        data: {
          status: SessionRegistrationStatus.REMOVED,
          slotNumber: null,
          waitlistPosition: null,
          removedAt: now,
          removalReason: `Removed from ${importSourceLabel} import`,
        },
      });
    }

    return {
      importedTeams: touchedRegistrationIds.size,
      skipped,
    };
  }

  private async importEventWithDiscordRows(params: {
    organizationId: string;
    actor: Actor;
    categoryId: string;
    guildId?: string | null;
    slotListChannelId?: string | null;
    existingSessionId?: string | null;
    importTeams?: boolean;
    gameKey?: string | null;
  }) {
    const ownerUserId = this.actorId(params.actor);
    if (!ownerUserId) {
      throw new ForbiddenException('Actor id is required to import an event');
    }
    const selectedGuild = await this.requireOrganizationDiscordGuild(
      params.organizationId,
      params.guildId,
    );
    const guildId = selectedGuild.guildId;
    const channels = await this.fetchGuildChannels(guildId);
    const resolved = this.resolveDiscordEventChannels({
      channels,
      categoryId: params.categoryId,
      slotListChannelId: params.slotListChannelId,
    });
    const sourceSlotLayout =
      params.importTeams === false
        ? null
        : await this.findDiscordEventSourceSlotLayout({
            organizationId: selectedGuild.organizationId,
            guildId,
            categoryId: resolved.category.id,
            slotListChannelId: resolved.slotListChannel?.id ?? null,
          });
    const slotRows =
      params.importTeams === false
        ? []
        : await this.readDiscordSlotRows(
            resolved.slotListChannel,
            sourceSlotLayout ?? {},
          );
    const requestedGame = await this.resolveGameIdentity(
      params.gameKey ?? null,
    );
    const existingSessionGame = params.existingSessionId
      ? await this.prisma.session.findFirst({
          where: {
            id: params.existingSessionId,
            organizationId: params.organizationId,
            deletedAt: null,
          },
          select: { game: { select: { id: true, key: true } } },
        })
      : null;
    const effectiveGame =
      requestedGame ??
      existingSessionGame?.game ??
      ({ id: null, key: GameKey.PUBG_MOBILE } as const);
    const slotCount = this.discordEventSlotCount(
      slotRows,
      defaultSlotCountForGame(effectiveGame.key),
    );
    const startSlot = 3;
    const normalSlots = this.discordEventNormalSlots({
      slotCount,
      startSlot,
      slotListChannel: resolved.slotListChannel,
      sourceSlotLayout,
    });
    const gameId = effectiveGame.id;
    const existingConfig = params.existingSessionId
      ? null
      : await this.prisma.sessionDiscordConfig.findFirst({
          where: selectedGuild.isForeignSource
            ? {
                organizationId: params.organizationId,
                importSourceGuildId: guildId,
                importSourceCategoryId: resolved.category.id,
                session: {
                  type: SessionType.EVENT,
                  deletedAt: null,
                },
              }
            : {
                organizationId: params.organizationId,
                guildId,
                categoryId: resolved.category.id,
                session: {
                  type: SessionType.EVENT,
                  deletedAt: null,
                },
              },
          select: { sessionId: true },
        });
    const sessionId =
      params.existingSessionId ?? existingConfig?.sessionId ?? null;
    const sourceSyncedAt = new Date();
    const activeDiscordConfigData = selectedGuild.isForeignSource
      ? {
          enabled: false,
          guildId: null,
          categoryId: null,
          categoryName: null,
          registrationChannelId: null,
          registrationChannelName: null,
          slotListChannelId: null,
          slotListChannelName: null,
          waitlistChannelId: null,
          waitlistChannelName: null,
          idpChannelId: null,
          idpChannelName: null,
          managerChannelId: null,
          managerChannelName: null,
          transferChannelId: null,
          transferChannelName: null,
          manageChannelId: null,
          manageChannelName: null,
          resultsChannelId: null,
          resultsChannelName: null,
          screenshotsChannelId: null,
          screenshotsChannelName: null,
          bansChannelId: null,
          bansChannelName: null,
          logChannelId: null,
          logChannelName: null,
        }
      : {
          enabled: true,
          guildId,
          categoryId: resolved.category.id,
          categoryName: resolved.category.name,
          registrationChannelId: resolved.registrationChannel?.id ?? null,
          registrationChannelName: resolved.registrationChannel?.name ?? null,
          slotListChannelId: resolved.slotListChannel?.id ?? null,
          slotListChannelName: resolved.slotListChannel?.name ?? null,
          waitlistChannelId: resolved.waitlistChannel?.id ?? null,
          waitlistChannelName: resolved.waitlistChannel?.name ?? null,
          idpChannelId: resolved.idpChannel?.id ?? null,
          idpChannelName: resolved.idpChannel?.name ?? null,
          managerChannelId: resolved.managerChannel?.id ?? null,
          managerChannelName: resolved.managerChannel?.name ?? null,
          transferChannelId: resolved.transferChannel?.id ?? null,
          transferChannelName: resolved.transferChannel?.name ?? null,
          manageChannelId: resolved.manageChannel?.id ?? null,
          manageChannelName: resolved.manageChannel?.name ?? null,
          resultsChannelId: resolved.resultsChannel?.id ?? null,
          resultsChannelName: resolved.resultsChannel?.name ?? null,
          screenshotsChannelId: resolved.screenshotsChannel?.id ?? null,
          screenshotsChannelName: resolved.screenshotsChannel?.name ?? null,
          bansChannelId: resolved.bansChannel?.id ?? null,
          bansChannelName: resolved.bansChannel?.name ?? null,
          logChannelId: resolved.logChannel?.id ?? null,
          logChannelName: resolved.logChannel?.name ?? null,
        };
    const importSourceData = selectedGuild.isForeignSource
      ? {
          importSourceOrganizationId: selectedGuild.organizationId,
          importSourceGuildId: guildId,
          importSourceGuildName: selectedGuild.guildName ?? null,
          importSourceCategoryId: resolved.category.id,
          importSourceCategoryName: resolved.category.name,
          importSourceSlotListChannelId: resolved.slotListChannel?.id ?? null,
          importSourceSlotListChannelName:
            resolved.slotListChannel?.name ?? null,
          importSourceSyncEnabled: true,
          importSourceLastSyncedAt: sourceSyncedAt,
          importSourceLastError: null,
        }
      : {
          importSourceOrganizationId: null,
          importSourceGuildId: null,
          importSourceGuildName: null,
          importSourceCategoryId: null,
          importSourceCategoryName: null,
          importSourceSlotListChannelId: null,
          importSourceSlotListChannelName: null,
          importSourceSyncEnabled: false,
          importSourceLastSyncedAt: null,
          importSourceLastError: null,
        };

    const result = await this.prisma.$transaction(async (tx) => {
      const session = sessionId
        ? await tx.session.update({
            where: { id: sessionId },
            data: {
              name: resolved.category.name,
              type: SessionType.EVENT,
              slotCount,
              maxTeams: slotCount,
              ...(gameId ? { gameId } : {}),
              updatedById: ownerUserId,
            },
            select: {
              id: true,
              name: true,
              status: true,
              slotCount: true,
              gameId: true,
              game: { select: { id: true, key: true, name: true } },
              createdAt: true,
            },
          })
        : await tx.session.create({
            data: {
              organizationId: params.organizationId,
              name: resolved.category.name,
              type: SessionType.EVENT,
              status: SessionStatus.OPEN,
              slotCount,
              maxTeams: slotCount,
              gameId,
              waitlistEnabled: true,
              createdById: ownerUserId,
              updatedById: ownerUserId,
            },
            select: {
              id: true,
              name: true,
              status: true,
              slotCount: true,
              gameId: true,
              game: { select: { id: true, key: true, name: true } },
              createdAt: true,
            },
          });

      await tx.sessionDiscordConfig.upsert({
        where: { sessionId: session.id },
        update: {
          ...activeDiscordConfigData,
          ...importSourceData,
          startSlot,
          normalSlots,
          vipSlots: 0,
        },
        create: {
          organizationId: params.organizationId,
          sessionId: session.id,
          ...activeDiscordConfigData,
          ...importSourceData,
          registrationMode: 'SCRIM',
          startSlot,
          normalSlots,
          vipSlots: 0,
          maxManagersPerTeam: 2,
          maxTeamsPerManager: 1,
          registrationCommand: '%register',
          registrationFormat: '%register\nTeam Name\nTeam Tag\n@managers',
          disableSlotAndVipRegistration: false,
          slotTeamEmojiEnabled: true,
          downloadPlayerElims: true,
          emojis: this.defaultEmojis(),
        },
      });

      const slotImport =
        params.importTeams === false
          ? { importedTeams: 0, skipped: [] }
          : await this.applyDiscordEventSlotRows({
              tx,
              organizationId: params.organizationId,
              sessionId: session.id,
              categoryId: resolved.category.id,
              slotListChannelId: resolved.slotListChannel?.id ?? null,
              ownerUserId,
              sourceOrganizationId: selectedGuild.isForeignSource
                ? selectedGuild.organizationId
                : null,
              rows: slotRows,
            });

      return {
        ...session,
        importedTeams: slotImport.importedTeams,
        skipped: slotImport.skipped,
      };
    });

    return {
      ...result,
      type: SessionType.EVENT,
      discord: {
        guildId,
        categoryId: resolved.category.id,
        categoryName: resolved.category.name,
        slotListChannelId: resolved.slotListChannel?.id ?? null,
        slotListChannelName: resolved.slotListChannel?.name ?? null,
        parsedSlotRows: slotRows.length,
        readOnlySource: selectedGuild.isForeignSource,
        sourceOrganizationId: selectedGuild.isForeignSource
          ? selectedGuild.organizationId
          : null,
      },
    };
  }

  async importEventFromDiscord(dto: ImportDiscordEventDto, actor: Actor) {
    const organizationId = this.requireOrg(actor);
    return this.importEventWithDiscordRows({
      organizationId,
      actor,
      categoryId: dto.categoryId.trim(),
      guildId: dto.guildId?.trim() || null,
      slotListChannelId: dto.slotListChannelId?.trim() || null,
      importTeams: dto.importTeams ?? true,
      gameKey: dto.gameKey ?? null,
    });
  }

  async importEventFromProductionSlots(
    dto: ImportProductionEventDto,
    actor: Actor,
  ) {
    const organizationId = this.requireOrg(actor);
    const ownerUserId = this.actorId(actor);
    if (!ownerUserId) {
      throw new ForbiddenException('Actor id is required to import an event');
    }

    const eventName = dto.eventName.trim().replace(/\s+/g, ' ');
    if (!eventName) {
      throw new BadRequestException('Event name is required');
    }
    if (eventName.length > 120) {
      throw new BadRequestException(
        'Event name must be 120 characters or less',
      );
    }

    const feature = await this.prisma.organizationFeature.findUnique({
      where: {
        organizationId_featureKey: {
          organizationId,
          featureKey: PRODUCTION_DISCORD_FEATURE_KEY,
        },
      },
      select: { isEnabled: true, config: true },
    });
    if (feature?.isEnabled !== true) {
      throw new BadRequestException(
        'Production Discord must be approved before importing an event',
      );
    }

    const production = this.normalizeProductionDiscordSlotsSnapshot(
      feature.config,
    );
    if (production.rows.length === 0) {
      throw new BadRequestException(
        'No production slots have been imported yet',
      );
    }

    const requestedGame = await this.resolveGameIdentity(dto.gameKey ?? null);
    const effectiveGame =
      requestedGame ?? ({ id: null, key: GameKey.PUBG_MOBILE } as const);
    const slotCount = this.discordEventSlotCount(
      production.rows,
      defaultSlotCountForGame(effectiveGame.key),
    );
    const categoryId =
      production.categoryId ?? PRODUCTION_EVENT_IMPORT_CATEGORY_ID;
    const gameId = effectiveGame.id;

    const result = await this.prisma.$transaction(async (tx) => {
      const session = await tx.session.create({
        data: {
          organizationId,
          name: eventName,
          type: SessionType.EVENT,
          status: SessionStatus.OPEN,
          slotCount,
          maxTeams: slotCount,
          gameId,
          waitlistEnabled: true,
          createdById: ownerUserId,
          updatedById: ownerUserId,
        },
        select: {
          id: true,
          name: true,
          status: true,
          slotCount: true,
          gameId: true,
          game: { select: { id: true, key: true, name: true } },
          createdAt: true,
        },
      });

      const slotImport = await this.applyDiscordEventSlotRows({
        tx,
        organizationId,
        sessionId: session.id,
        categoryId,
        slotListChannelId: production.slotListChannelId,
        ownerUserId,
        sourceOrganizationId: null,
        rows: production.rows,
        importNotePrefix: PRODUCTION_EVENT_IMPORT_NOTE_PREFIX,
        importSourceLabel: 'Production slot-list',
      });

      return {
        ...session,
        importedTeams: slotImport.importedTeams,
        skipped: slotImport.skipped,
      };
    });

    const syncedMatches = await this.syncDraftEventMatchesFromRegistrations(
      result.id,
      organizationId,
    );

    return {
      ...result,
      type: SessionType.EVENT,
      production: {
        parsedSlotRows: production.rows.length,
        categoryId: production.categoryId,
        categoryName: production.categoryName,
        slotListChannelId: production.slotListChannelId,
        slotListChannelName: production.slotListChannelName,
      },
      syncedMatches,
    };
  }

  async refreshEventFromDiscord(sessionId: string, actor: Actor) {
    const organizationId = this.requireOrg(actor);
    const session = await this.prisma.session.findFirst({
      where: {
        id: sessionId,
        organizationId,
        type: SessionType.EVENT,
        deletedAt: null,
      },
      select: {
        id: true,
        discordConfig: {
          select: {
            guildId: true,
            categoryId: true,
            slotListChannelId: true,
            importSourceGuildId: true,
            importSourceCategoryId: true,
            importSourceSlotListChannelId: true,
            importSourceSyncEnabled: true,
          },
        },
      },
    });
    if (!session) {
      throw new NotFoundException('Event not found');
    }
    const sourceSyncEnabled =
      session.discordConfig?.importSourceSyncEnabled === true;
    const guildId = sourceSyncEnabled
      ? (session.discordConfig?.importSourceGuildId?.trim() ?? null)
      : (session.discordConfig?.guildId?.trim() ?? null);
    const categoryId = sourceSyncEnabled
      ? session.discordConfig?.importSourceCategoryId?.trim()
      : session.discordConfig?.categoryId?.trim();
    const slotListChannelId = sourceSyncEnabled
      ? (session.discordConfig?.importSourceSlotListChannelId ?? null)
      : (session.discordConfig?.slotListChannelId ?? null);
    if (!categoryId) {
      throw new BadRequestException(
        'This event is not linked to a Discord import source',
      );
    }

    const result = await this.importEventWithDiscordRows({
      organizationId,
      actor,
      guildId,
      categoryId,
      slotListChannelId,
      existingSessionId: session.id,
      importTeams: true,
    });
    const syncedMatches = await this.syncDraftEventMatchesFromRegistrations(
      session.id,
      organizationId,
    );

    return {
      ...result,
      syncedMatches,
    };
  }

  private foreignEventSourceActor(params: {
    organizationId: string;
    organizationName?: string | null;
    userId: string;
  }): Actor {
    return {
      id: params.userId,
      role: Role.ORGANIZER,
      organizationId: params.organizationId,
      orgId: params.organizationId,
      actorId: params.userId,
      actorRole: Role.ORGANIZER,
      actingOrgId: params.organizationId,
      actingRole: Role.ORGANIZER,
      actingOrgName: params.organizationName ?? null,
      actingAsUserId: null,
      realRole: Role.ORGANIZER,
    };
  }

  private async refreshForeignEventSourceConfigs(
    configs: Array<{
      sessionId: string;
      organizationId: string;
      importSourceGuildId: string | null;
      importSourceCategoryId: string | null;
      importSourceSlotListChannelId: string | null;
      session: {
        id: string;
        createdById: string | null;
        updatedById: string | null;
      };
      organization: {
        name: string | null;
        ownerUserId: string | null;
      };
    }>,
  ) {
    let refreshed = 0;
    for (const config of configs) {
      if (!config.importSourceGuildId || !config.importSourceCategoryId) {
        continue;
      }

      const userId =
        config.session.updatedById ??
        config.session.createdById ??
        config.organization.ownerUserId;
      if (!userId) {
        await this.prisma.sessionDiscordConfig.update({
          where: { sessionId: config.sessionId },
          data: {
            importSourceLastError:
              'No user is available to own automatic Discord source sync changes',
          },
        });
        continue;
      }

      try {
        const actor = this.foreignEventSourceActor({
          organizationId: config.organizationId,
          organizationName: config.organization.name,
          userId,
        });
        await this.importEventWithDiscordRows({
          organizationId: config.organizationId,
          actor,
          guildId: config.importSourceGuildId,
          categoryId: config.importSourceCategoryId,
          slotListChannelId: config.importSourceSlotListChannelId,
          existingSessionId: config.sessionId,
          importTeams: true,
        });
        await this.syncDraftEventMatchesFromRegistrations(
          config.sessionId,
          config.organizationId,
        );
        refreshed += 1;
      } catch (error) {
        await this.prisma.sessionDiscordConfig.update({
          where: { sessionId: config.sessionId },
          data: {
            importSourceLastError: String(error).slice(0, 2000),
          },
        });
        console.warn(
          `[DiscordEventSource] refresh skipped session=${config.sessionId}: ${String(
            error,
          )}`,
        );
      }
    }

    return refreshed;
  }

  async refreshForeignEventSourcesForSourceSession(
    sourceSessionId: string,
    actor: Actor,
  ) {
    const organizationId = this.requireOrg(actor);
    const source = await this.prisma.session.findFirst({
      where: {
        id: sourceSessionId,
        organizationId,
        deletedAt: null,
      },
      select: {
        id: true,
        discordConfig: {
          select: {
            enabled: true,
            guildId: true,
            categoryId: true,
            slotListChannelId: true,
          },
        },
      },
    });
    if (!source) {
      throw new NotFoundException('Source session not found');
    }

    const sourceConfig = source.discordConfig;
    const sourceGuildId = sourceConfig?.guildId?.trim() || null;
    const sourceCategoryId = sourceConfig?.categoryId?.trim() || null;
    const sourceSlotListChannelId =
      sourceConfig?.slotListChannelId?.trim() || null;
    if (sourceConfig?.enabled !== true || !sourceGuildId || !sourceCategoryId) {
      return { refreshed: 0, skipped: true };
    }

    if (this.foreignEventSourceSyncRunning) {
      return { refreshed: 0, skipped: true };
    }
    this.foreignEventSourceSyncRunning = true;
    try {
      const configs = await this.prisma.sessionDiscordConfig.findMany({
        where: {
          importSourceSyncEnabled: true,
          importSourceGuildId: sourceGuildId,
          importSourceCategoryId: sourceCategoryId,
          ...(sourceSlotListChannelId
            ? { importSourceSlotListChannelId: sourceSlotListChannelId }
            : {}),
          organization: {
            deletedAt: null,
            isActive: true,
            status: OrganizationStatus.APPROVED,
          },
          session: {
            deletedAt: null,
            type: SessionType.EVENT,
            status: {
              in: [
                SessionStatus.DRAFT,
                SessionStatus.OPEN,
                SessionStatus.CHECKIN,
                SessionStatus.LOCKED,
                SessionStatus.LIVE,
              ],
            },
          },
        },
        select: {
          sessionId: true,
          organizationId: true,
          importSourceGuildId: true,
          importSourceCategoryId: true,
          importSourceSlotListChannelId: true,
          session: {
            select: {
              id: true,
              createdById: true,
              updatedById: true,
            },
          },
          organization: {
            select: {
              name: true,
              ownerUserId: true,
            },
          },
        },
        orderBy: [{ updatedAt: 'asc' }],
        take: FOREIGN_EVENT_SOURCE_SYNC_BATCH_SIZE,
      });

      const refreshed = await this.refreshForeignEventSourceConfigs(configs);
      return { refreshed, skipped: false };
    } finally {
      this.foreignEventSourceSyncRunning = false;
    }
  }

  async refreshForeignEventSources() {
    if (this.foreignEventSourceSyncRunning) {
      return { refreshed: 0, skipped: true };
    }
    this.foreignEventSourceSyncRunning = true;
    try {
      const cutoff = new Date(
        Date.now() - this.foreignEventSourceSyncIntervalMs(),
      );
      const configs = await this.prisma.sessionDiscordConfig.findMany({
        where: {
          importSourceSyncEnabled: true,
          importSourceGuildId: { not: null },
          importSourceCategoryId: { not: null },
          OR: [
            { importSourceLastSyncedAt: null },
            { importSourceLastSyncedAt: { lte: cutoff } },
          ],
          organization: {
            deletedAt: null,
            isActive: true,
            status: OrganizationStatus.APPROVED,
          },
          session: {
            deletedAt: null,
            type: SessionType.EVENT,
            status: {
              in: [
                SessionStatus.DRAFT,
                SessionStatus.OPEN,
                SessionStatus.CHECKIN,
                SessionStatus.LOCKED,
                SessionStatus.LIVE,
              ],
            },
          },
        },
        select: {
          sessionId: true,
          organizationId: true,
          importSourceGuildId: true,
          importSourceCategoryId: true,
          importSourceSlotListChannelId: true,
          session: {
            select: {
              id: true,
              createdById: true,
              updatedById: true,
            },
          },
          organization: {
            select: {
              name: true,
              ownerUserId: true,
            },
          },
        },
        orderBy: [{ importSourceLastSyncedAt: 'asc' }, { updatedAt: 'asc' }],
        take: FOREIGN_EVENT_SOURCE_SYNC_BATCH_SIZE,
      });

      const refreshed = await this.refreshForeignEventSourceConfigs(configs);
      return { refreshed, skipped: false };
    } finally {
      this.foreignEventSourceSyncRunning = false;
    }
  }

  private async syncDraftEventMatchesFromRegistrations(
    sessionId: string,
    organizationId: string,
  ) {
    const session = await this.prisma.session.findFirst({
      where: { id: sessionId, organizationId, deletedAt: null },
      select: { slotCount: true },
    });
    const matches = await this.prisma.match.findMany({
      where: {
        sessionId,
        organizationId,
        deletedAt: null,
        status: MatchStatus.DRAFT,
        liveState: LiveState.UPCOMING,
      },
      select: {
        id: true,
        slotCount: true,
        dataMode: true,
        dataSource: true,
      },
      orderBy: [{ matchNumber: 'asc' }, { createdAt: 'asc' }],
    });

    const synced: SyncSessionMatchSlotsResult[] = [];
    for (const match of matches) {
      if (session && match.slotCount !== session.slotCount) {
        await this.prisma.match.update({
          where: { id: match.id },
          data: { slotCount: session.slotCount },
        });
      }
      const result = await syncMatchSlotsWithSessionRegistrations(this.prisma, {
        sessionId,
        organizationId,
        matchId: match.id,
        dataMode: match.dataMode,
        dataSource: match.dataSource,
      });
      synced.push(result);
    }
    return synced;
  }

  private async resizeDiscordEmojiImage(source: Buffer) {
    let smallest: Buffer | null = null;

    for (const size of EMOJI_IMAGE_SIZES) {
      const resized = await sharp(source, { failOn: 'none' })
        .rotate()
        .resize(size, size, {
          fit: 'inside',
          withoutEnlargement: false,
        })
        .png({
          compressionLevel: 9,
          effort: 10,
          palette: true,
        })
        .toBuffer();

      if (!smallest || resized.length < smallest.length) {
        smallest = resized;
      }
      if (resized.length <= MAX_EMOJI_IMAGE_BYTES) {
        return resized;
      }
    }

    throw new Error(
      `resized image is still larger than the Discord emoji size limit (${smallest?.length ?? 0} bytes)`,
    );
  }

  private async fetchDiscordImageDataUri(url: string) {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`image request failed with ${response.status}`);
    }

    const contentLength = Number(response.headers.get('content-length') ?? '0');
    if (contentLength > MAX_EMOJI_SOURCE_IMAGE_BYTES) {
      throw new Error('image is too large to resize for Discord emoji use');
    }

    const source = Buffer.from(await response.arrayBuffer());
    if (source.length > MAX_EMOJI_SOURCE_IMAGE_BYTES) {
      throw new Error('image is too large to resize for Discord emoji use');
    }

    const emojiImage = await this.resizeDiscordEmojiImage(source);
    return `data:image/png;base64,${emojiImage.toString('base64')}`;
  }

  private async ensureServerTeamLogoEmoji(params: {
    guildId: string;
    byName: Map<string, DiscordEmoji>;
    fallbackEmoji: string;
  }) {
    const guild = await this.discordRequest<DiscordGuild>(
      'GET',
      `/guilds/${params.guildId}`,
    ).catch((error) => {
      console.warn(
        `Guild details failed during session sync: ${String(error)}`,
      );
      return null;
    });
    const iconUrl = guild ? serverIconUrl(guild) : null;
    if (!guild || !iconUrl) {
      return params.fallbackEmoji;
    }

    const name = serverLogoEmojiName(guild.id, guild.icon ?? null);
    const existing = params.byName.get(name);
    if (existing) {
      return emojiMention(existing);
    }

    try {
      const emoji = await this.discordRequest<DiscordEmoji>(
        'POST',
        `/guilds/${params.guildId}/emojis`,
        {
          name,
          image: await this.fetchDiscordImageDataUri(iconUrl),
        },
        {
          auditReason: 'Arenzyra server default team logo for scrim slot lists',
        },
      );
      if (emoji) {
        params.byName.set(emoji.name, emoji);
        return emojiMention(emoji);
      }
    } catch (error) {
      console.warn(
        `Server default team logo emoji could not be prepared: ${String(error)}`,
      );
    }

    return params.fallbackEmoji;
  }

  private async ensureTeamLogoEmoji(params: {
    guildId: string;
    byName: Map<string, DiscordEmoji>;
    registration: SessionRegistrationForSync;
  }) {
    const logoUrl = params.registration.team?.logoUrl?.trim();
    if (!logoUrl) {
      return null;
    }

    const teamId =
      params.registration.team?.id?.trim() || params.registration.teamId;
    const name = teamLogoEmojiName(teamId, logoUrl);
    const existing = params.byName.get(name);
    if (existing) {
      return emojiMention(existing);
    }

    try {
      const emoji = await this.discordRequest<DiscordEmoji>(
        'POST',
        `/guilds/${params.guildId}/emojis`,
        {
          name,
          image: await this.fetchDiscordImageDataUri(logoUrl),
        },
        {
          auditReason: `Arenzyra team logo for ${(
            params.registration.team?.tag ||
            params.registration.team?.name ||
            params.registration.teamId
          ).slice(0, 80)}`,
        },
      );
      if (emoji) {
        params.byName.set(emoji.name, emoji);
        return emojiMention(emoji);
      }
    } catch (error) {
      console.warn(
        `Team logo emoji could not be prepared for ${params.registration.teamId}: ${String(
          error,
        )}`,
      );
    }

    return null;
  }

  private addDesiredTeamLogoEmojiName(
    desiredNames: Set<string>,
    registration: {
      teamId: string;
      team?: { id?: string | null; logoUrl?: string | null } | null;
    },
  ) {
    const logoUrl = registration.team?.logoUrl?.trim();
    if (!logoUrl) {
      return;
    }
    const teamId = registration.team?.id?.trim() || registration.teamId;
    desiredNames.add(teamLogoEmojiName(teamId, logoUrl));
  }

  private async desiredTeamLogoEmojiNames(params: {
    guildId: string;
    registrations: SessionRegistrationForSync[];
  }) {
    const desiredNames = new Set<string>();
    for (const registration of params.registrations) {
      if (activeRegistration(registration)) {
        this.addDesiredTeamLogoEmojiName(desiredNames, registration);
      }
    }

    const configs = await this.prisma.sessionDiscordConfig.findMany({
      where: {
        guildId: params.guildId,
        enabled: true,
        slotTeamEmojiEnabled: true,
      },
      select: { sessionId: true },
    });
    const sessionIds = configs
      .map((config) => config.sessionId)
      .filter((sessionId, index, sessionIds) => {
        return sessionId.length > 0 && sessionIds.indexOf(sessionId) === index;
      });
    if (sessionIds.length === 0) {
      return desiredNames;
    }

    const activeRegistrations = await this.prisma.sessionRegistration.findMany({
      where: {
        sessionId: { in: sessionIds },
        deletedAt: null,
        removedAt: null,
        status: {
          notIn: [
            SessionRegistrationStatus.REMOVED,
            SessionRegistrationStatus.DECLINED,
          ],
        },
      },
      select: {
        teamId: true,
        team: {
          select: {
            id: true,
            logoUrl: true,
          },
        },
      },
    });
    for (const registration of activeRegistrations) {
      this.addDesiredTeamLogoEmojiName(desiredNames, registration);
    }

    return desiredNames;
  }

  private async pruneStaleTeamLogoEmojis(params: {
    guildId: string;
    emojis: DiscordEmoji[];
    byName: Map<string, DiscordEmoji>;
    desiredNames: Set<string>;
    priorityNames?: Set<string>;
    maxDelete?: number;
  }) {
    const priorityNames = params.priorityNames ?? new Set<string>();
    const stale = params.emojis
      .filter((emoji) => {
        return (
          managedTeamLogoEmojiName(emoji.name) &&
          !params.desiredNames.has(emoji.name)
        );
      })
      .sort((left, right) => {
        const leftPriority = priorityNames.has(left.name) ? 1 : 0;
        const rightPriority = priorityNames.has(right.name) ? 1 : 0;
        return rightPriority - leftPriority;
      })
      .slice(0, params.maxDelete ?? MAX_STALE_TEAM_LOGO_EMOJI_DELETE);

    for (const emoji of stale) {
      await this.discordRequest(
        'DELETE',
        `/guilds/${params.guildId}/emojis/${emoji.id}`,
        undefined,
        {
          auditReason: 'Arenzyra cleanup of unused generated team logo emoji',
          notFoundOk: true,
        },
      ).catch((error) => {
        console.warn(
          `Stale team logo emoji cleanup failed for ${emoji.name}: ${String(
            error,
          )}`,
        );
      });
      params.byName.delete(emoji.name);
    }

    if (stale.length > 0) {
      console.log(
        `Cleaned ${stale.length} unused Arenzyra team logo emoji(s) in guild ${params.guildId}`,
      );
    }

    return stale.length;
  }

  async cleanupTeamLogoEmojisForRemovedRegistrations(
    sessionId: string,
    registrations: TeamLogoEmojiCleanupRegistration[],
    actor: Actor,
  ) {
    const organizationId = this.requireOrg(actor);
    if (registrations.length === 0) {
      return {
        ok: true,
        sessionId,
        deleted: 0,
        skipped: 'no-registrations',
      };
    }

    const config = (await this.prisma.sessionDiscordConfig.findUnique({
      where: { sessionId },
    })) as SessionDiscordConfigRecord | null;
    if (
      !config ||
      config.organizationId !== organizationId ||
      !config.enabled ||
      !config.guildId
    ) {
      return {
        ok: true,
        sessionId,
        deleted: 0,
        skipped: 'no-discord-config',
      };
    }

    const priorityNames = new Set<string>();
    for (const registration of registrations) {
      this.addDesiredTeamLogoEmojiName(priorityNames, registration);
    }
    if (priorityNames.size === 0) {
      return {
        ok: true,
        sessionId,
        deleted: 0,
        skipped: 'no-team-logos',
      };
    }

    const emojis =
      (await this.discordRequest<DiscordEmoji[]>(
        'GET',
        `/guilds/${config.guildId}/emojis`,
      ).catch((error) => {
        console.warn(
          `Guild emoji list failed during removed team logo cleanup: ${String(
            error,
          )}`,
        );
        return [] as DiscordEmoji[];
      })) ?? [];
    if (emojis.length === 0) {
      return {
        ok: true,
        sessionId,
        deleted: 0,
        skipped: 'no-guild-emojis',
      };
    }

    const byName = new Map(emojis.map((emoji) => [emoji.name, emoji]));
    const deleted =
      (await this.pruneStaleTeamLogoEmojis({
        guildId: config.guildId,
        emojis,
        byName,
        desiredNames: await this.desiredTeamLogoEmojiNames({
          guildId: config.guildId,
          registrations: [],
        }),
        priorityNames,
        maxDelete: Math.max(
          MAX_STALE_TEAM_LOGO_EMOJI_DELETE,
          priorityNames.size,
        ),
      })) ?? 0;

    return {
      ok: true,
      sessionId,
      deleted,
    };
  }

  private async resolveTeamLogoEmojis(params: {
    guildId: string;
    registrations: SessionRegistrationForSync[];
    config: SessionDiscordConfigRecord;
  }) {
    if (params.config.slotTeamEmojiEnabled === false) {
      return {
        teamLogoEmojiByTeamId: new Map<string, string>(),
        defaultTeamLogoEmoji: null,
      };
    }

    const emojis =
      (await this.discordRequest<DiscordEmoji[]>(
        'GET',
        `/guilds/${params.guildId}/emojis`,
      ).catch((error) => {
        console.warn(
          `Guild emoji list failed during session sync: ${String(error)}`,
        );
        return [] as DiscordEmoji[];
      })) ?? [];
    const byName = new Map(emojis.map((emoji) => [emoji.name, emoji]));
    await this.pruneStaleTeamLogoEmojis({
      guildId: params.guildId,
      emojis,
      byName,
      desiredNames: await this.desiredTeamLogoEmojiNames({
        guildId: params.guildId,
        registrations: params.registrations,
      }),
    });
    const defaultEmoji = byName.get(DEFAULT_TEAM_LOGO_EMOJI_NAME);
    const arenzyraFallbackEmoji = defaultEmoji
      ? emojiMention(defaultEmoji)
      : emojiValue(params.config, 'team');
    const defaultTeamLogoEmoji = await this.ensureServerTeamLogoEmoji({
      guildId: params.guildId,
      byName,
      fallbackEmoji: arenzyraFallbackEmoji,
    });
    const teamLogoEmojiByTeamId = new Map<string, string>();
    const seenTeamIds = new Set<string>();

    for (const registration of params.registrations) {
      if (
        !activeRegistration(registration) ||
        seenTeamIds.has(registration.teamId)
      ) {
        continue;
      }
      seenTeamIds.add(registration.teamId);

      const emoji = await this.ensureTeamLogoEmoji({
        guildId: params.guildId,
        byName,
        registration,
      });
      if (emoji) {
        teamLogoEmojiByTeamId.set(registration.teamId, emoji);
      }
    }

    return {
      teamLogoEmojiByTeamId,
      defaultTeamLogoEmoji,
    };
  }

  private async getChannels(guildId: string) {
    return (
      (await this.discordRequest<DiscordChannel[]>(
        'GET',
        `/guilds/${guildId}/channels`,
      )) ?? []
    );
  }

  private async getRoles(guildId: string) {
    return (
      (await this.discordRequest<DiscordRole[]>(
        'GET',
        `/guilds/${guildId}/roles`,
      )) ?? []
    );
  }

  private staffRoles(
    roles: DiscordRole[],
    config: SessionDiscordConfigRecord,
    ensuredStaffRole?: DiscordRole | null,
  ) {
    const explicitManageRoleIds = stringArray(config.manageRoleIds);
    const hasExplicitManageRoles = explicitManageRoleIds.length > 0;
    const configuredRoleIds = new Set(
      [
        ...explicitManageRoleIds,
        ...(hasExplicitManageRoles ? [] : [configuredStaffRoleId(config)]),
        ensuredStaffRole?.id,
      ].filter(
        (value): value is string =>
          typeof value === 'string' && value.trim().length > 0,
      ),
    );
    return roles.filter(
      (role) =>
        configuredRoleIds.has(role.id) ||
        (!hasExplicitManageRoles &&
          (STAFF_ROLE_NAMES.has(role.name) ||
            hasPermission(role, PERMISSION.ADMINISTRATOR) ||
            hasPermission(role, PERMISSION.MANAGE_GUILD) ||
            hasPermission(role, PERMISSION.MANAGE_CHANNELS))),
    );
  }

  private staffOverwrites(staffRoles: DiscordRole[]): PermissionOverwrite[] {
    return staffRoles.map((role) => ({
      id: role.id,
      type: 0,
      allow: bitset(
        PERMISSION.VIEW_CHANNEL,
        PERMISSION.READ_MESSAGE_HISTORY,
        PERMISSION.SEND_MESSAGES,
        PERMISSION.MANAGE_MESSAGES,
        PERMISSION.ADD_REACTIONS,
        PERMISSION.CREATE_PUBLIC_THREADS,
        PERMISSION.CREATE_PRIVATE_THREADS,
        PERMISSION.SEND_MESSAGES_IN_THREADS,
      ),
      deny: '0',
    }));
  }

  private registrationOverwrites(
    guildId: string,
    staffRoles: DiscordRole[],
    roles: DiscordRole[],
    session: {
      status: string;
      registrationOpenAt: Date | string | null;
      registrationCloseAt: Date | string | null;
    },
    config: SessionDiscordConfigRecord,
    organizationAccessRoles?: OrganizationAccessRoleIds | null,
    botUserId?: string | null,
  ): PermissionOverwrite[] {
    const publicCanSend = publicRegistrationOpen(session, config);
    const configuredAccessRoleIds = this.registrationAccessRoleIds(
      config,
      organizationAccessRoles,
    );
    const restrictToRegistrationRoles =
      this.registrationRestrictionRoleIds(config).length > 0;
    const accessRoleIds = new Set(configuredAccessRoleIds);
    const staffRoleIds = new Set(staffRoles.map((role) => role.id));
    const accessRoleOverwrites = roles
      .filter(
        (role) => accessRoleIds.has(role.id) && !staffRoleIds.has(role.id),
      )
      .map((role) => {
        const canSend = this.registrationAccessRoleCanSend(
          role.id,
          session,
          config,
          publicCanSend,
          organizationAccessRoles,
        );
        return {
          id: role.id,
          type: 0 as const,
          allow: bitset(
            PERMISSION.VIEW_CHANNEL,
            PERMISSION.READ_MESSAGE_HISTORY,
            ...(canSend ? [PERMISSION.SEND_MESSAGES] : []),
          ),
          deny: this.botControlledMemberDeny(
            canSend ? [] : [PERMISSION.SEND_MESSAGES],
          ),
        };
      });

    return this.withBotControlledBotOverwrite(
      [
        {
          id: guildId,
          type: 0,
          allow: bitset(
            PERMISSION.VIEW_CHANNEL,
            PERMISSION.READ_MESSAGE_HISTORY,
            ...(publicCanSend && !restrictToRegistrationRoles
              ? [PERMISSION.SEND_MESSAGES]
              : []),
          ),
          deny: this.botControlledMemberDeny(
            publicCanSend && !restrictToRegistrationRoles
              ? []
              : [PERMISSION.SEND_MESSAGES],
          ),
        },
        ...accessRoleOverwrites,
        ...this.staffOverwrites(staffRoles),
      ],
      botUserId,
    );
  }

  private registrationAccessRoleIds(
    config: SessionDiscordConfigRecord,
    organizationAccessRoles?: OrganizationAccessRoleIds | null,
  ) {
    return uniqueStrings([
      ...this.registrationRestrictionRoleIds(config),
      organizationAccessRoles?.earlyAccessRoleId,
      organizationAccessRoles?.vipAccessRoleId,
      ...parseRoleAccessGroups(config).map((group) => group.roleId),
    ]);
  }

  private registrationRestrictionRoleIds(config: SessionDiscordConfigRecord) {
    return uniqueStrings([
      ...stringArray(config.registrationRoleIds),
      ...stringArray(config.specialRegistrationRoleIds),
      ...stringArray(config.vipRoleIds),
    ]);
  }

  private registrationAccessRoleCanSend(
    roleId: string,
    session: { status: string },
    config: SessionDiscordConfigRecord,
    publicCanSend: boolean,
    organizationAccessRoles?: OrganizationAccessRoleIds | null,
  ) {
    const restrictionRoleIds = new Set(
      this.registrationRestrictionRoleIds(config),
    );
    if (
      publicCanSend &&
      (restrictionRoleIds.size === 0 || restrictionRoleIds.has(roleId))
    ) {
      return true;
    }
    if (!sessionStatusAllowsRegistrationAccess(session)) {
      return false;
    }

    if (
      roleId === organizationAccessRoles?.earlyAccessRoleId?.trim() &&
      roleAccessWindow(config, 'earlyAccess').allowsAction
    ) {
      return true;
    }
    if (
      roleId === organizationAccessRoles?.vipAccessRoleId?.trim() &&
      roleAccessWindow(config, 'vipAccess').allowsAction
    ) {
      return true;
    }

    return parseRoleAccessGroups(config).some(
      (group) =>
        group.roleId === roleId &&
        roleAccessGroupWindow(group, config).allowsAction,
    );
  }

  private publicWritableOverwrites(
    guildId: string,
    staffRoles: DiscordRole[],
  ): PermissionOverwrite[] {
    return [
      {
        id: guildId,
        type: 0,
        allow: bitset(
          PERMISSION.VIEW_CHANNEL,
          PERMISSION.READ_MESSAGE_HISTORY,
          PERMISSION.SEND_MESSAGES,
        ),
        deny: '0',
      },
      ...this.staffOverwrites(staffRoles),
    ];
  }

  private protectedOverwrites(
    guildId: string,
    staffRoles: DiscordRole[],
    accessRole: DiscordRole | null,
    botControlled = false,
    botUserId?: string | null,
  ): PermissionOverwrite[] {
    if (!accessRole) {
      const overwrites = this.staffOnlyOverwrites(guildId, staffRoles);
      return botControlled
        ? this.withBotControlledBotOverwrite(overwrites, botUserId)
        : overwrites;
    }

    const overwrites: PermissionOverwrite[] = [
      {
        id: guildId,
        type: 0,
        allow: '0',
        deny: botControlled
          ? this.botControlledMemberDeny([PERMISSION.VIEW_CHANNEL])
          : bitset(PERMISSION.VIEW_CHANNEL),
      },
      {
        id: accessRole.id,
        type: 0,
        allow: bitset(PERMISSION.VIEW_CHANNEL, PERMISSION.READ_MESSAGE_HISTORY),
        deny: botControlled
          ? this.botControlledMemberDeny([PERMISSION.SEND_MESSAGES])
          : bitset(PERMISSION.SEND_MESSAGES),
      },
      ...this.staffOverwrites(staffRoles),
    ];
    return botControlled
      ? this.withBotControlledBotOverwrite(overwrites, botUserId)
      : overwrites;
  }

  private waitlistPromotionOverwrites(
    guildId: string,
    staffRoles: DiscordRole[],
    accessRole: DiscordRole | null,
    canSend: boolean,
    botUserId?: string | null,
  ): PermissionOverwrite[] {
    if (!accessRole) {
      return this.withBotControlledBotOverwrite(
        this.staffOnlyOverwrites(guildId, staffRoles),
        botUserId,
      );
    }

    return this.withBotControlledBotOverwrite(
      [
        {
          id: guildId,
          type: 0,
          allow: '0',
          deny: this.botControlledMemberDeny([PERMISSION.VIEW_CHANNEL]),
        },
        {
          id: accessRole.id,
          type: 0,
          allow: bitset(
            PERMISSION.VIEW_CHANNEL,
            PERMISSION.READ_MESSAGE_HISTORY,
            ...(canSend ? [PERMISSION.SEND_MESSAGES] : []),
          ),
          deny: this.botControlledMemberDeny(
            canSend ? [] : [PERMISSION.SEND_MESSAGES],
          ),
        },
        ...this.staffOverwrites(staffRoles),
      ],
      botUserId,
    );
  }

  private roleWritableOverwrites(
    guildId: string,
    staffRoles: DiscordRole[],
    accessRoles: Array<DiscordRole | null | undefined>,
  ): PermissionOverwrite[] {
    const seenRoleIds = new Set<string>();
    const uniqueAccessRoles = accessRoles.filter((role) => {
      if (!role?.id || seenRoleIds.has(role.id)) {
        return false;
      }
      seenRoleIds.add(role.id);
      return true;
    }) as DiscordRole[];
    return [
      {
        id: guildId,
        type: 0,
        allow: '0',
        deny: bitset(PERMISSION.VIEW_CHANNEL),
      },
      ...uniqueAccessRoles.map((role) => ({
        id: role.id,
        type: 0 as const,
        allow: bitset(
          PERMISSION.VIEW_CHANNEL,
          PERMISSION.READ_MESSAGE_HISTORY,
          PERMISSION.SEND_MESSAGES,
        ),
        deny: '0',
      })),
      ...this.staffOverwrites(staffRoles),
    ];
  }

  private botControlledMemberDeny(extraDeny: bigint[] = []) {
    return bitset(...extraDeny, ...BOT_CONTROLLED_MEMBER_DENY_PERMISSIONS);
  }

  private withBotControlledBotOverwrite(
    overwrites: PermissionOverwrite[],
    botUserId?: string | null,
  ): PermissionOverwrite[] {
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
        type: 1,
        allow: bitset(...BOT_CONTROLLED_BOT_ALLOW_PERMISSIONS),
        deny: '0',
      },
    ];
  }

  private staffOnlyOverwrites(
    guildId: string,
    staffRoles: DiscordRole[],
  ): PermissionOverwrite[] {
    return [
      {
        id: guildId,
        type: 0,
        allow: '0',
        deny: bitset(PERMISSION.VIEW_CHANNEL),
      },
      ...this.staffOverwrites(staffRoles),
    ];
  }

  private readOnlyPublicOverwrites(
    guildId: string,
    staffRoles: DiscordRole[],
  ): PermissionOverwrite[] {
    return [
      {
        id: guildId,
        type: 0,
        allow: bitset(PERMISSION.VIEW_CHANNEL, PERMISSION.READ_MESSAGE_HISTORY),
        deny: bitset(PERMISSION.SEND_MESSAGES),
      },
      ...this.staffOverwrites(staffRoles),
    ];
  }

  private async editChannel(
    channelId: string,
    payload: Record<string, unknown>,
    reason: string,
  ) {
    return (await this.discordRequest<DiscordChannel>(
      'PATCH',
      `/channels/${channelId}`,
      payload,
      { auditReason: reason },
    )) as DiscordChannel;
  }

  private isBotControlledCleanChannel(kind: string) {
    return (
      kind === 'registration' || kind === 'slot-list' || kind === 'waitlist'
    );
  }

  private permissionOverwriteHasDeny(
    overwrite: PermissionOverwrite | null | undefined,
    permissions: bigint[],
  ) {
    if (!overwrite) {
      return false;
    }
    const mask = permissionMask(permissions);
    const allow = parsePermissionBitset(overwrite.allow);
    const deny = parsePermissionBitset(overwrite.deny);
    return (deny & mask) === mask && (allow & mask) === 0n;
  }

  private permissionOverwriteHasAllow(
    overwrite: PermissionOverwrite | null | undefined,
    permissions: bigint[],
  ) {
    if (!overwrite) {
      return false;
    }
    const mask = permissionMask(permissions);
    const allow = parsePermissionBitset(overwrite.allow);
    const deny = parsePermissionBitset(overwrite.deny);
    return (allow & mask) === mask && (deny & mask) === 0n;
  }

  private permissionOverwriteMatches(
    overwrite: PermissionOverwrite | null | undefined,
    allowPermissions: bigint[],
    denyPermissions: bigint[],
  ) {
    return (
      this.permissionOverwriteHasAllow(overwrite, allowPermissions) &&
      this.permissionOverwriteHasDeny(overwrite, denyPermissions)
    );
  }

  private buildPermissionModePatch(
    overwrite: PermissionOverwrite | null | undefined,
    allowPermissions: bigint[],
    denyPermissions: bigint[],
  ) {
    const allowMask = permissionMask(allowPermissions);
    const denyMask = permissionMask(denyPermissions);
    let allow = parsePermissionBitset(overwrite?.allow);
    let deny = parsePermissionBitset(overwrite?.deny);
    allow |= allowMask;
    deny &= ~allowMask;
    deny |= denyMask;
    allow &= ~denyMask;
    return {
      allow: allow.toString(),
      deny: deny.toString(),
    };
  }

  private desiredSendMessagesMode(
    overwrite?: PermissionOverwrite,
  ): BotControlledSendMessagesMode {
    if (
      (parsePermissionBitset(overwrite?.allow) & PERMISSION.SEND_MESSAGES) ===
      PERMISSION.SEND_MESSAGES
    ) {
      return 'allow';
    }
    if (
      (parsePermissionBitset(overwrite?.deny) & PERMISSION.SEND_MESSAGES) ===
      PERMISSION.SEND_MESSAGES
    ) {
      return 'deny';
    }
    return null;
  }

  private async editChannelPermissionOverwrite(
    channelId: string,
    overwriteId: string,
    type: 0 | 1,
    patch: { allow: string; deny: string },
    reason: string,
  ) {
    await this.discordRequest(
      'PUT',
      `/channels/${channelId}/permissions/${overwriteId}`,
      { type, ...patch },
      { auditReason: reason },
    );
  }

  private async applyBotControlledPermissionPatch(params: {
    channel: DiscordChannel;
    guildId: string;
    kind: string;
    desiredOverwrites: PermissionOverwrite[];
    botUserId?: string | null;
  }) {
    if (!this.isBotControlledCleanChannel(params.kind)) {
      return;
    }

    const existingOverwrites = params.channel.permission_overwrites ?? [];
    const existingById = new Map(
      existingOverwrites.map((overwrite) => [overwrite.id, overwrite]),
    );
    const desiredOverwriteById = new Map(
      params.desiredOverwrites.map((overwrite) => [overwrite.id, overwrite]),
    );
    const staffRoleIds = new Set(
      params.desiredOverwrites
        .filter(
          (overwrite) =>
            overwrite.type === 0 &&
            (parsePermissionBitset(overwrite.allow) &
              PERMISSION.MANAGE_MESSAGES) ===
              PERMISSION.MANAGE_MESSAGES,
        )
        .map((overwrite) => overwrite.id),
    );
    const denyRoleIds = new Set<string>([params.guildId]);

    for (const overwrite of params.desiredOverwrites) {
      if (
        overwrite.type === 0 &&
        overwrite.id !== params.botUserId &&
        overwrite.id !== params.guildId &&
        !staffRoleIds.has(overwrite.id)
      ) {
        denyRoleIds.add(overwrite.id);
      }
    }

    for (const overwrite of existingOverwrites) {
      if (overwrite.type === 0 && !staffRoleIds.has(overwrite.id)) {
        denyRoleIds.add(overwrite.id);
      }
    }

    const controlsSendMessages = params.kind === 'registration';
    const reason = controlsSendMessages
      ? 'Arenzyra registration access permission lock'
      : `Arenzyra ${params.kind} reaction/thread permission lock`;
    for (const roleId of denyRoleIds) {
      const existing = existingById.get(roleId);
      const sendMessagesMode = controlsSendMessages
        ? (this.desiredSendMessagesMode(desiredOverwriteById.get(roleId)) ??
          'deny')
        : null;
      const allowPermissions =
        sendMessagesMode === 'allow' ? [PERMISSION.SEND_MESSAGES] : [];
      const denyPermissions = [
        ...BOT_CONTROLLED_MEMBER_DENY_PERMISSIONS,
        ...(sendMessagesMode === 'deny' ? [PERMISSION.SEND_MESSAGES] : []),
      ];
      if (
        this.permissionOverwriteMatches(
          existing,
          allowPermissions,
          denyPermissions,
        )
      ) {
        continue;
      }
      await this.editChannelPermissionOverwrite(
        params.channel.id,
        roleId,
        0,
        this.buildPermissionModePatch(
          existing,
          allowPermissions,
          denyPermissions,
        ),
        reason,
      ).catch((error) => {
        console.warn(
          `Bot-controlled permission lock failed for ${params.kind} role=${roleId}: ${String(
            error,
          )}`,
        );
      });
    }

    for (const roleId of staffRoleIds) {
      const existing = existingById.get(roleId);
      const allowPermissions = [
        ...BOT_CONTROLLED_MEMBER_DENY_PERMISSIONS,
        ...(controlsSendMessages ? [PERMISSION.SEND_MESSAGES] : []),
      ];
      if (this.permissionOverwriteHasAllow(existing, allowPermissions)) {
        continue;
      }
      await this.editChannelPermissionOverwrite(
        params.channel.id,
        roleId,
        0,
        this.buildPermissionModePatch(existing, allowPermissions, []),
        reason,
      ).catch((error) => {
        console.warn(
          `Bot-controlled staff permission lock failed for ${params.kind} role=${roleId}: ${String(
            error,
          )}`,
        );
      });
    }

    if (params.botUserId) {
      const existing = existingById.get(params.botUserId);
      const allowPermissions = [
        ...BOT_CONTROLLED_MEMBER_DENY_PERMISSIONS,
        ...(controlsSendMessages ? [PERMISSION.SEND_MESSAGES] : []),
      ];
      if (!this.permissionOverwriteHasAllow(existing, allowPermissions)) {
        await this.editChannelPermissionOverwrite(
          params.channel.id,
          params.botUserId,
          1,
          this.buildPermissionModePatch(existing, allowPermissions, []),
          reason,
        ).catch((error) => {
          console.warn(
            `Bot-controlled bot permission lock failed for ${params.kind}: ${String(
              error,
            )}`,
          );
        });
      }
    }
  }

  private async ensureCategory(params: {
    guildId: string;
    channels: DiscordChannel[];
    sessionId: string;
    sessionName: string;
    config: SessionDiscordConfigRecord;
    preserveConfigured?: boolean;
  }) {
    const desiredName = cleanCategoryName(
      params.config.categoryName,
      `SCRIM ${shortSessionId(params.sessionId)} ${params.sessionName}`.slice(
        0,
        100,
      ),
    );
    const byId = params.config.categoryId
      ? params.channels.find(
          (channel) =>
            channel.id === params.config.categoryId &&
            channel.type === GUILD_CATEGORY_CHANNEL,
        )
      : null;
    const byName = params.channels.find(
      (channel) =>
        channel.type === GUILD_CATEGORY_CHANNEL && channel.name === desiredName,
    );
    const byLegacyPrefix = params.channels.find(
      (channel) =>
        channel.type === GUILD_CATEGORY_CHANNEL &&
        channel.name.startsWith(`SCRIM ${shortSessionId(params.sessionId)}`),
    );
    if (params.preserveConfigured) {
      const existing = byId ?? byName ?? byLegacyPrefix ?? null;
      if (existing) {
        return existing;
      }
    }

    const existing = byId ?? byName ?? byLegacyPrefix ?? null;

    if (existing) {
      if (existing.name !== desiredName) {
        return this.editChannel(
          existing.id,
          { name: desiredName },
          `Arenzyra scrim category sync for ${params.sessionName}`,
        );
      }
      return existing;
    }

    return (await this.discordRequest<DiscordChannel>(
      'POST',
      `/guilds/${params.guildId}/channels`,
      {
        name: desiredName,
        type: GUILD_CATEGORY_CHANNEL,
      },
      { auditReason: `Arenzyra scrim category sync for ${params.sessionName}` },
    )) as DiscordChannel;
  }

  private async ensureTextChannel(params: {
    guildId: string;
    channels: DiscordChannel[];
    categoryId: string;
    sessionId: string;
    kind: string;
    name: string;
    configuredId?: string | null;
    overwrites: PermissionOverwrite[];
    preserveConfigured?: boolean;
    manageExistingPermissions?: boolean;
    botUserId?: string | null;
  }) {
    const desiredName = safeChannelName(params.name);
    const topic = channelTopic(params.sessionId, params.kind);
    const byId = params.configuredId
      ? params.channels.find(
          (channel) =>
            channel.id === params.configuredId &&
            channel.type === GUILD_TEXT_CHANNEL,
        )
      : null;
    const byTopic = params.channels.find(
      (channel) =>
        channel.type === GUILD_TEXT_CHANNEL && channel.topic === topic,
    );
    const byNameInCategory = params.channels.find(
      (channel) =>
        channel.type === GUILD_TEXT_CHANNEL &&
        channel.parent_id === params.categoryId &&
        channel.name === desiredName,
    );
    if (params.preserveConfigured) {
      const existing = byId ?? byTopic ?? byNameInCategory ?? null;
      if (existing) {
        await this.applyBotControlledPermissionPatch({
          channel: existing,
          guildId: params.guildId,
          kind: params.kind,
          desiredOverwrites: params.overwrites,
          botUserId: params.botUserId,
        });
        return existing;
      }
    }

    const existing = byId ?? byTopic ?? byNameInCategory ?? null;
    const updatePayload = {
      name: desiredName,
      parent_id: params.categoryId,
      topic,
    };
    const createPayload = {
      ...updatePayload,
      permission_overwrites: params.overwrites,
    };

    if (existing) {
      const edited = await this.editChannel(
        existing.id,
        params.manageExistingPermissions ? createPayload : updatePayload,
        `Arenzyra ${params.kind} channel sync for ${params.sessionId}`,
      );
      if (!params.manageExistingPermissions) {
        await this.applyBotControlledPermissionPatch({
          channel: existing,
          guildId: params.guildId,
          kind: params.kind,
          desiredOverwrites: params.overwrites,
          botUserId: params.botUserId,
        });
      }
      return edited;
    }

    return (await this.discordRequest<DiscordChannel>(
      'POST',
      `/guilds/${params.guildId}/channels`,
      {
        ...createPayload,
        type: GUILD_TEXT_CHANNEL,
      },
      {
        auditReason: `Arenzyra ${params.kind} channel sync for ${params.sessionId}`,
      },
    )) as DiscordChannel;
  }

  private async ensureRole(params: {
    guildId: string;
    roles: DiscordRole[];
    sessionId: string;
    sessionName: string;
    kind: 'Slot' | 'Waitlist' | 'IDP' | 'Banned';
    color: number;
    configuredId?: string | null;
    configuredName?: string | null;
    allowCreate: boolean;
  }) {
    const desiredName = trimRoleName(
      cleanName(
        params.configuredName,
        `Arenzyra ${params.kind} ${shortSessionId(params.sessionId)}`,
      ),
    );
    const byId = params.configuredId
      ? params.roles.find((role) => role.id === params.configuredId)
      : null;
    if (byId) {
      return byId;
    }

    const byName = params.roles.find((role) => role.name === desiredName);
    const byLegacyName = params.roles.find(
      (role) =>
        role.name ===
        `Arenzyra ${params.kind} ${shortSessionId(params.sessionId)}`,
    );
    const existing = byName ?? byLegacyName ?? null;

    if (existing) {
      if (existing.name !== desiredName) {
        return (await this.discordRequest<DiscordRole>(
          'PATCH',
          `/guilds/${params.guildId}/roles/${existing.id}`,
          { name: desiredName, color: params.color, mentionable: false },
          {
            auditReason: `Arenzyra ${params.kind} role sync for ${params.sessionName}`,
          },
        )) as DiscordRole;
      }
      return existing;
    }

    if (!params.allowCreate) {
      return null;
    }

    return (await this.discordRequest<DiscordRole>(
      'POST',
      `/guilds/${params.guildId}/roles`,
      { name: desiredName, color: params.color, mentionable: false },
      {
        auditReason: `Arenzyra ${params.kind} role sync for ${params.sessionName}`,
      },
    )) as DiscordRole;
  }

  private async ensureStaffRole(params: {
    guildId: string;
    roles: DiscordRole[];
    config: SessionDiscordConfigRecord;
    allowCreate: boolean;
  }) {
    const configuredManageRole = this.firstConfiguredManageRole(
      params.roles,
      params.config,
    );
    if (configuredManageRole) {
      return configuredManageRole;
    }

    const desiredName = configuredStaffRoleName(params.config);
    const configuredId = configuredStaffRoleId(params.config);
    const byId = configuredId
      ? params.roles.find((role) => role.id === configuredId)
      : null;
    const byName = params.roles.find((role) => role.name === desiredName);
    const byKnownName = params.roles.find(
      (role) => role.name === DEFAULT_STAFF_ROLE_NAME,
    );
    const existing = byId ?? byName ?? byKnownName ?? null;

    if (existing) {
      if (
        STAFF_ROLE_NAMES.has(existing.name) &&
        existing.name !== desiredName
      ) {
        return (await this.discordRequest<DiscordRole>(
          'PATCH',
          `/guilds/${params.guildId}/roles/${existing.id}`,
          { name: desiredName, color: 0x0891b2, mentionable: false },
          { auditReason: 'Arenzyra staff role sync' },
        )) as DiscordRole;
      }
      return existing;
    }

    if (!params.allowCreate) {
      return null;
    }

    return (await this.discordRequest<DiscordRole>(
      'POST',
      `/guilds/${params.guildId}/roles`,
      { name: desiredName, color: 0x0891b2, mentionable: false },
      { auditReason: 'Arenzyra staff role sync' },
    )) as DiscordRole;
  }

  private async organizationAccessRoles(
    organizationId: string,
  ): Promise<OrganizationAccessRoleIds> {
    const organizationDiscordConfig = (
      this.prisma as unknown as {
        organizationDiscordConfig?: Pick<
          PrismaService['organizationDiscordConfig'],
          'findUnique'
        >;
      }
    ).organizationDiscordConfig;
    if (!organizationDiscordConfig?.findUnique) {
      return {
        earlyAccessRoleId: null,
        vipAccessRoleId: null,
      };
    }

    const config = await organizationDiscordConfig
      .findUnique({
        where: { organizationId },
        select: {
          earlyAccessRoleId: true,
          vipAccessRoleId: true,
        },
      })
      .catch((error) => {
        console.warn(
          `[DiscordSync] access role lookup failed organization=${organizationId}: ${String(
            error,
          )}`,
        );
        return null;
      });

    return {
      earlyAccessRoleId: config?.earlyAccessRoleId?.trim() || null,
      vipAccessRoleId: config?.vipAccessRoleId?.trim() || null,
    };
  }

  private firstConfiguredManageRole(
    roles: DiscordRole[],
    config: SessionDiscordConfigRecord,
  ) {
    const configuredRoleIds = new Set(stringArray(config.manageRoleIds));
    return roles.find((role) => configuredRoleIds.has(role.id)) ?? null;
  }

  private findLegacyIdpRole(params: {
    roles: DiscordRole[];
    sessionId: string;
    config: SessionDiscordConfigRecord;
    slotRole: DiscordRole | null;
  }) {
    const configuredId = params.config.idpRoleId?.trim();
    if (configuredId && configuredId !== params.slotRole?.id) {
      const byId = params.roles.find((role) => role.id === configuredId);
      if (byId && byId.id !== params.slotRole?.id) {
        return byId;
      }
    }

    const configuredName = params.config.idpRoleName?.trim();
    if (configuredName && configuredName !== params.slotRole?.name) {
      const byName = params.roles.find((role) => role.name === configuredName);
      if (byName && byName.id !== params.slotRole?.id) {
        return byName;
      }
    }

    const legacyName = `Arenzyra IDP ${shortSessionId(params.sessionId)}`;
    const legacy = params.roles.find((role) => role.name === legacyName);
    return legacy && legacy.id !== params.slotRole?.id ? legacy : null;
  }

  private async ensureSetup(params: {
    guildId: string;
    sessionId: string;
    sessionName: string;
    sessionStatus: string;
    registrationOpenAt: Date | string | null;
    registrationCloseAt: Date | string | null;
    config: SessionDiscordConfigRecord;
  }): Promise<DiscordSetup> {
    const [initialChannels, initialRoles, organizationAccessRoles] =
      await Promise.all([
        this.getChannels(params.guildId),
        this.getRoles(params.guildId),
        this.organizationAccessRoles(params.config.organizationId),
      ]);
    const allowRoleCreate = autoCreateRoles(params.config);
    const staffRole = await this.ensureStaffRole({
      guildId: params.guildId,
      roles: initialRoles,
      config: params.config,
      allowCreate: allowRoleCreate,
    });
    const slotRole = await this.ensureRole({
      ...params,
      roles: initialRoles,
      kind: 'Slot',
      color: 0x2563eb,
      configuredId: params.config.slotRoleId,
      configuredName: params.config.slotRoleName,
      allowCreate: allowRoleCreate,
    });
    const waitlistRole = await this.ensureRole({
      ...params,
      roles: initialRoles,
      kind: 'Waitlist',
      color: 0xf59e0b,
      configuredId: params.config.waitlistRoleId,
      configuredName: params.config.waitlistRoleName,
      allowCreate: allowRoleCreate,
    });
    const legacyIdpRole = this.findLegacyIdpRole({
      roles: initialRoles,
      sessionId: params.sessionId,
      config: params.config,
      slotRole,
    });
    const bannedRole = await this.ensureRole({
      ...params,
      roles: initialRoles,
      kind: 'Banned',
      color: 0xdc2626,
      configuredId: params.config.bannedRoleId,
      configuredName: params.config.bannedRoleName,
      allowCreate: allowRoleCreate,
    });
    const roles = await this.getRoles(params.guildId);
    const staffRoles = this.staffRoles(roles, params.config, staffRole);
    const botUserId = await this.getBotUserId().catch((error) => {
      console.warn(
        `[DiscordSync] bot user lookup skipped for guild=${params.guildId}: ${String(
          error,
        )}`,
      );
      return null;
    });
    const preserveConfigured = preserveConfiguredChannels(params.config);
    const manageExistingPermissions = manageChannelPermissions(params.config);
    const category = await this.ensureCategory({
      ...params,
      channels: initialChannels,
      preserveConfigured,
    });
    const channels = await this.getChannels(params.guildId);

    const registrationChannel = await this.ensureTextChannel({
      ...params,
      channels,
      categoryId: category.id,
      kind: 'registration',
      name: cleanTextChannelName(
        params.config.registrationChannelName,
        'registration',
      ),
      configuredId: params.config.registrationChannelId,
      preserveConfigured,
      manageExistingPermissions,
      botUserId,
      overwrites: this.registrationOverwrites(
        params.guildId,
        staffRoles,
        roles,
        {
          status: params.sessionStatus,
          registrationOpenAt: params.registrationOpenAt,
          registrationCloseAt: params.registrationCloseAt,
        },
        params.config,
        organizationAccessRoles,
        botUserId,
      ),
    });
    const slotListChannel = await this.ensureTextChannel({
      ...params,
      channels,
      categoryId: category.id,
      kind: 'slot-list',
      name: cleanTextChannelName(
        params.config.slotListChannelName,
        'slot-list',
      ),
      configuredId: params.config.slotListChannelId,
      preserveConfigured,
      manageExistingPermissions,
      botUserId,
      overwrites: this.protectedOverwrites(
        params.guildId,
        staffRoles,
        slotRole,
        true,
        botUserId,
      ),
    });
    const waitlistChannel = await this.ensureTextChannel({
      ...params,
      channels,
      categoryId: category.id,
      kind: 'waitlist',
      name: cleanTextChannelName(params.config.waitlistChannelName, 'waitlist'),
      configuredId: params.config.waitlistChannelId,
      preserveConfigured,
      manageExistingPermissions,
      botUserId,
      overwrites: this.protectedOverwrites(
        params.guildId,
        staffRoles,
        waitlistRole,
        true,
        botUserId,
      ),
    });
    const idpChannel = await this.ensureTextChannel({
      ...params,
      channels,
      categoryId: category.id,
      kind: 'idp',
      name: cleanTextChannelName(params.config.idpChannelName, 'idp'),
      configuredId: params.config.idpChannelId,
      preserveConfigured,
      manageExistingPermissions,
      botUserId,
      overwrites: this.protectedOverwrites(
        params.guildId,
        staffRoles,
        slotRole,
      ),
    });
    const managerChannel = await this.ensureTextChannel({
      ...params,
      channels,
      categoryId: category.id,
      kind: 'manager',
      name: cleanTextChannelName(params.config.managerChannelName, 'manager'),
      configuredId: params.config.managerChannelId,
      preserveConfigured,
      manageExistingPermissions,
      botUserId,
      overwrites: this.publicWritableOverwrites(params.guildId, staffRoles),
    });
    const transferChannel = await this.ensureTextChannel({
      ...params,
      channels,
      categoryId: category.id,
      kind: 'transfer',
      name: cleanTextChannelName(
        params.config.transferChannelName,
        'transfer-roles',
      ),
      configuredId: params.config.transferChannelId,
      preserveConfigured,
      manageExistingPermissions,
      botUserId,
      overwrites: this.roleWritableOverwrites(params.guildId, staffRoles, [
        slotRole,
        waitlistRole,
      ]),
    });
    const manageChannel = await this.ensureTextChannel({
      ...params,
      channels,
      categoryId: category.id,
      kind: 'manage',
      name: cleanTextChannelName(params.config.manageChannelName, 'manage'),
      configuredId: params.config.manageChannelId,
      preserveConfigured,
      manageExistingPermissions,
      botUserId,
      overwrites: this.staffOnlyOverwrites(params.guildId, staffRoles),
    });
    const resultsChannel = await this.ensureTextChannel({
      ...params,
      channels,
      categoryId: category.id,
      kind: 'results',
      name: cleanTextChannelName(params.config.resultsChannelName, 'results'),
      configuredId: params.config.resultsChannelId,
      preserveConfigured,
      manageExistingPermissions,
      botUserId,
      overwrites: this.protectedOverwrites(
        params.guildId,
        staffRoles,
        slotRole,
      ),
    });
    const screenshotsChannel = await this.ensureTextChannel({
      ...params,
      channels,
      categoryId: category.id,
      kind: 'screenshots',
      name: cleanTextChannelName(
        params.config.screenshotsChannelName,
        'screenshots',
      ),
      configuredId: params.config.screenshotsChannelId,
      preserveConfigured,
      manageExistingPermissions,
      botUserId,
      overwrites: this.staffOnlyOverwrites(params.guildId, staffRoles),
    });
    const bansChannel = await this.ensureTextChannel({
      ...params,
      channels,
      categoryId: category.id,
      kind: 'bans',
      name: cleanTextChannelName(params.config.bansChannelName, 'bans'),
      configuredId: params.config.bansChannelId,
      preserveConfigured,
      manageExistingPermissions,
      botUserId,
      overwrites: this.staffOnlyOverwrites(params.guildId, staffRoles),
    });
    const logChannel = await this.ensureTextChannel({
      ...params,
      channels,
      categoryId: category.id,
      kind: 'log',
      name: cleanTextChannelName(params.config.logChannelName, 'log'),
      configuredId: params.config.logChannelId,
      preserveConfigured,
      manageExistingPermissions,
      botUserId,
      overwrites: this.staffOnlyOverwrites(params.guildId, staffRoles),
    });

    return {
      category,
      registrationChannel,
      slotListChannel,
      waitlistChannel,
      idpChannel,
      managerChannel,
      transferChannel,
      manageChannel,
      resultsChannel,
      screenshotsChannel,
      bansChannel,
      logChannel,
      staffRole,
      slotRole,
      waitlistRole,
      idpRole: slotRole,
      legacyIdpRole,
      bannedRole,
    };
  }

  private mergeManageRoleIds(
    config: SessionDiscordConfigRecord,
    staffRoleId: string | null | undefined,
  ) {
    const configuredManageRoleIds = stringArray(config.manageRoleIds);
    const roleIds =
      configuredManageRoleIds.length > 0 || !staffRoleId
        ? configuredManageRoleIds
        : [...configuredManageRoleIds, staffRoleId];
    return roleIds.filter(
      (roleId, index, roleIds): roleId is string =>
        typeof roleId === 'string' &&
        roleId.trim().length > 0 &&
        roleIds.indexOf(roleId) === index,
    );
  }

  private buildConfigUpdate(
    setup: DiscordSetup,
    guildId: string,
    config: SessionDiscordConfigRecord,
  ) {
    return {
      guildId,
      categoryId: setup.category.id,
      categoryName: setup.category.name,
      registrationChannelId: setup.registrationChannel.id,
      registrationChannelName: setup.registrationChannel.name,
      slotListChannelId: setup.slotListChannel.id,
      slotListChannelName: setup.slotListChannel.name,
      waitlistChannelId: setup.waitlistChannel.id,
      waitlistChannelName: setup.waitlistChannel.name,
      idpChannelId: setup.idpChannel.id,
      idpChannelName: setup.idpChannel.name,
      managerChannelId: setup.managerChannel.id,
      managerChannelName: setup.managerChannel.name,
      transferChannelId: setup.transferChannel.id,
      transferChannelName: setup.transferChannel.name,
      manageChannelId: setup.manageChannel.id,
      manageChannelName: setup.manageChannel.name,
      resultsChannelId: setup.resultsChannel.id,
      resultsChannelName: setup.resultsChannel.name,
      screenshotsChannelId: setup.screenshotsChannel.id,
      screenshotsChannelName: setup.screenshotsChannel.name,
      bansChannelId: setup.bansChannel.id,
      bansChannelName: setup.bansChannel.name,
      logChannelId: setup.logChannel.id,
      logChannelName: setup.logChannel.name,
      manageRoleIds: this.mergeManageRoleIds(config, setup.staffRole?.id),
      slotRoleId: setup.slotRole?.id ?? config.slotRoleId,
      slotRoleName: setup.slotRole?.name ?? config.slotRoleName,
      waitlistRoleId: setup.waitlistRole?.id ?? config.waitlistRoleId,
      waitlistRoleName: setup.waitlistRole?.name ?? config.waitlistRoleName,
      idpRoleId: setup.idpRole?.id ?? config.idpRoleId,
      idpRoleName: setup.idpRole?.name ?? config.idpRoleName,
      bannedRoleId: setup.bannedRole?.id ?? config.bannedRoleId,
      bannedRoleName: setup.bannedRole?.name ?? config.bannedRoleName,
    };
  }

  private emojisWithManagedMessageIds(
    config: SessionDiscordConfigRecord,
    messageIds: Record<string, string>,
    setup?: DiscordSetup,
  ): Prisma.InputJsonObject {
    const emojis: Record<string, Prisma.InputJsonValue | null> = {};
    if (
      config.emojis &&
      typeof config.emojis === 'object' &&
      !Array.isArray(config.emojis)
    ) {
      for (const [key, value] of Object.entries(config.emojis)) {
        emojis[key] = value as Prisma.InputJsonValue | null;
      }
    }
    for (const [key, value] of Object.entries(messageIds)) {
      emojis[key] = value;
    }
    if (setup?.staffRole) {
      emojis.staffRoleId = setup.staffRole.id;
      emojis.staffRoleName = setup.staffRole.name;
    }
    return emojis as Prisma.InputJsonObject;
  }

  private async latestSessionDiscordConfig(
    sessionId: string,
    fallback: SessionDiscordConfigRecord,
  ) {
    const latest = await this.prisma.sessionDiscordConfig.findUnique({
      where: { sessionId },
    });
    return (latest as SessionDiscordConfigRecord | null) ?? fallback;
  }

  private rawMentionUserIdsFromContent(content: string | null | undefined) {
    return Array.from(
      new Set(
        Array.from((content ?? '').matchAll(/<@!?(\d{17,20})>/g))
          .map((match) => match[1])
          .filter((userId): userId is string => Boolean(userId)),
      ),
    );
  }

  private normalizedManagedContent(content: string | null | undefined) {
    return (content ?? '').replace(/\u200B+$/u, '');
  }

  private comparableJson(value: unknown): unknown {
    if (value === undefined) {
      return null;
    }
    if (Array.isArray(value)) {
      return value.map((entry) => this.comparableJson(entry));
    }
    if (!value || typeof value !== 'object') {
      return value;
    }

    const record = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      if (record[key] !== undefined && key !== 'timestamp') {
        result[key] = this.comparableJson(record[key]);
      }
    }
    return result;
  }

  private comparableEmbed(value: unknown) {
    const embed =
      value && typeof value === 'object'
        ? (value as Record<string, unknown>)
        : {};
    const footer =
      embed.footer && typeof embed.footer === 'object'
        ? (embed.footer as Record<string, unknown>)
        : null;
    const fields = Array.isArray(embed.fields)
      ? embed.fields.map((field) => {
          const record =
            field && typeof field === 'object'
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
    };
  }

  private messageHasParsedMentions(message: DiscordMessage, content: string) {
    const rawMentionIds = this.rawMentionUserIdsFromContent(content);
    if (rawMentionIds.length === 0) {
      return true;
    }
    const parsedMentionIds = new Set(
      (message.mentions ?? [])
        .map((mention) => mention.id?.trim())
        .filter((userId): userId is string => Boolean(userId)),
    );
    return rawMentionIds.every((userId) => parsedMentionIds.has(userId));
  }

  private markedMessagePayloadMatches(
    message: DiscordMessage,
    payload: Record<string, unknown>,
  ) {
    const payloadContent =
      typeof payload.content === 'string'
        ? this.normalizedManagedContent(payload.content)
        : '';
    if (
      this.normalizedManagedContent(message.content) !== payloadContent ||
      !this.messageHasParsedMentions(message, payloadContent)
    ) {
      return false;
    }

    if (
      JSON.stringify(
        (message.embeds ?? []).map((embed) => this.comparableEmbed(embed)),
      ) !==
      JSON.stringify(
        (Array.isArray(payload.embeds) ? payload.embeds : []).map((embed) =>
          this.comparableEmbed(embed),
        ),
      )
    ) {
      return false;
    }

    return (
      JSON.stringify(this.comparableJson(message.components ?? [])) ===
      JSON.stringify(
        this.comparableJson(
          Array.isArray(payload.components) ? payload.components : [],
        ),
      )
    );
  }

  private payloadForMarkedMessageEdit(
    message: DiscordMessage,
    payload: Record<string, unknown>,
  ) {
    if (typeof payload.content !== 'string') {
      return payload;
    }

    const payloadContent = this.normalizedManagedContent(payload.content);
    if (
      this.normalizedManagedContent(message.content) !== payloadContent ||
      this.messageHasParsedMentions(message, payloadContent)
    ) {
      return payload;
    }

    return {
      ...payload,
      content: (message.content ?? '').endsWith('\u200B')
        ? payloadContent
        : `${payloadContent}\u200B`,
    };
  }

  private async updateMarkedMessageIfChanged(params: {
    channelId: string;
    message: DiscordMessage;
    payload: Record<string, unknown>;
  }) {
    const payload = this.payloadForMarkedMessageEdit(
      params.message,
      params.payload,
    );
    if (this.markedMessagePayloadMatches(params.message, payload)) {
      return params.message;
    }
    return (await this.discordRequest<DiscordMessage>(
      'PATCH',
      `/channels/${params.channelId}/messages/${params.message.id}`,
      payload,
    )) as DiscordMessage;
  }

  private async upsertMarkedMessage(params: {
    channelId: string;
    messageId?: string | null;
    footerMarker: string;
    payload: Record<string, unknown>;
    pin?: boolean;
    matchExisting?: (message: DiscordMessage) => boolean;
  }): Promise<DiscordMessage> {
    const pinIfNeeded = async (message: DiscordMessage) => {
      if (params.pin !== false && !message.pinned) {
        await this.discordRequest(
          'PUT',
          `/channels/${params.channelId}/pins/${message.id}`,
          undefined,
          { notFoundOk: true },
        ).catch(() => null);
      }
      return message;
    };
    const stored = params.messageId
      ? await this.discordRequest<DiscordMessage>(
          'GET',
          `/channels/${params.channelId}/messages/${params.messageId}`,
          undefined,
          { notFoundOk: true },
        )
      : null;
    if (stored) {
      try {
        const updated = await this.updateMarkedMessageIfChanged({
          channelId: params.channelId,
          message: stored,
          payload: params.payload,
        });
        return await pinIfNeeded(updated);
      } catch (error) {
        if (!this.isDiscordNotFoundError(error)) {
          throw error;
        }
        console.warn(
          `[DiscordSync] stored managed message disappeared channel=${params.channelId} message=${stored.id}; recreating`,
        );
      }
    }

    const messages =
      (await this.discordRequest<DiscordMessage[]>(
        'GET',
        `/channels/${params.channelId}/messages?limit=100`,
      )) ?? [];
    const existing =
      messages.find(
        (message) =>
          message.embeds?.some((embed) =>
            embedHasMarker(embed, params.footerMarker),
          ) || params.matchExisting?.(message),
      ) ?? null;

    const message = existing
      ? await this.updateMarkedMessageIfChanged({
          channelId: params.channelId,
          message: existing,
          payload: params.payload,
        }).catch((error) => {
          if (!this.isDiscordNotFoundError(error)) {
            throw error;
          }
          console.warn(
            `[DiscordSync] matched managed message disappeared channel=${params.channelId} message=${existing.id}; recreating`,
          );
          return null;
        })
      : ((await this.discordRequest<DiscordMessage>(
          'POST',
          `/channels/${params.channelId}/messages`,
          params.payload,
        )) as DiscordMessage);

    if (!message) {
      const created = (await this.discordRequest<DiscordMessage>(
        'POST',
        `/channels/${params.channelId}/messages`,
        params.payload,
      )) as DiscordMessage;
      return pinIfNeeded(created);
    }

    return pinIfNeeded(message);
  }

  private async deleteMarkedMessage(params: {
    channelId: string;
    messageId?: string | null;
    footerMarker: string;
    matchExisting?: (message: DiscordMessage) => boolean;
  }) {
    if (params.messageId) {
      const stored = await this.discordRequest<DiscordMessage>(
        'GET',
        `/channels/${params.channelId}/messages/${params.messageId}`,
        undefined,
        { notFoundOk: true },
      );
      if (stored) {
        await this.discordRequest(
          'DELETE',
          `/channels/${params.channelId}/messages/${params.messageId}`,
          undefined,
          { notFoundOk: true },
        ).catch(() => null);
        return;
      }
    }

    const messages =
      (await this.discordRequest<DiscordMessage[]>(
        'GET',
        `/channels/${params.channelId}/messages?limit=100`,
      )) ?? [];
    const existing =
      messages.find(
        (message) =>
          message.embeds?.some((embed) =>
            embedHasMarker(embed, params.footerMarker),
          ) || params.matchExisting?.(message),
      ) ?? null;
    if (!existing) {
      return;
    }

    await this.discordRequest(
      'DELETE',
      `/channels/${params.channelId}/messages/${existing.id}`,
      undefined,
      { notFoundOk: true },
    ).catch(() => null);
  }

  private messageComponentCustomIds(message: DiscordMessage) {
    return (message.components ?? []).flatMap((row) =>
      (row.components ?? [])
        .map((component) => component.custom_id ?? component.customId ?? '')
        .filter(Boolean),
    );
  }

  private discordMemberCacheKey(guildId: string, discordUserId: string) {
    return `${guildId}:${discordUserId}`;
  }

  private cachedValidDiscordMember(guildId: string, discordUserId: string) {
    const key = this.discordMemberCacheKey(guildId, discordUserId);
    const cached = this.validDiscordMemberCache.get(key);
    if (!cached) {
      return false;
    }
    if (cached.expiresAt <= Date.now()) {
      this.validDiscordMemberCache.delete(key);
      return false;
    }
    return true;
  }

  private rememberValidDiscordMember(guildId: string, discordUserId: string) {
    if (this.validDiscordMemberCache.size > 5_000) {
      const now = Date.now();
      for (const [key, cached] of this.validDiscordMemberCache) {
        if (cached.expiresAt <= now) {
          this.validDiscordMemberCache.delete(key);
        }
      }
      if (this.validDiscordMemberCache.size > 5_000) {
        this.validDiscordMemberCache.clear();
      }
    }
    this.validDiscordMemberCache.set(
      this.discordMemberCacheKey(guildId, discordUserId),
      { expiresAt: Date.now() + DISCORD_MEMBER_CACHE_TTL_MS },
    );
  }

  private async runWithConcurrency<T>(
    items: T[],
    concurrency: number,
    worker: (item: T) => Promise<void>,
  ) {
    let nextIndex = 0;
    const workerCount = Math.min(concurrency, items.length);
    await Promise.all(
      Array.from({ length: workerCount }, async () => {
        while (nextIndex < items.length) {
          const item = items[nextIndex];
          nextIndex += 1;
          await worker(item);
        }
      }),
    );
  }

  private async validGuildMemberIdsForSlotList(
    guildId: string,
    registrations: SessionRegistrationForSync[],
  ) {
    const discordUserIds = uniqueStrings(
      registrations.flatMap((registration) => [
        registration.leaderDiscordUserId?.trim(),
        ...(registration.managerDiscordUserIds ?? []).map((discordUserId) =>
          discordUserId?.trim(),
        ),
        ...(registration.team?.members ?? []).map((member) =>
          member.discordUserId?.trim(),
        ),
        registrationPlayStatus(registration)?.discordUserId?.trim(),
      ]),
    );
    const validGuildMemberIds = new Set<string>();
    await this.runWithConcurrency(
      discordUserIds,
      DISCORD_MEMBER_LOOKUP_CONCURRENCY,
      async (discordUserId) => {
        if (this.cachedValidDiscordMember(guildId, discordUserId)) {
          validGuildMemberIds.add(discordUserId);
          return;
        }

        const member = await this.discordRequest<DiscordGuildMember>(
          'GET',
          `/guilds/${guildId}/members/${discordUserId}`,
          undefined,
          { notFoundOk: true },
        ).catch(() => null);
        if (member && member.user?.bot !== true) {
          validGuildMemberIds.add(discordUserId);
          this.rememberValidDiscordMember(guildId, discordUserId);
        }
      },
    );
    return validGuildMemberIds;
  }

  private async cleanupStandalonePlayConfirmationMessages(params: {
    channelId: string;
    footerMarker: string;
    config: SessionDiscordConfigRecord;
  }) {
    const messages =
      (await this.discordRequest<DiscordMessage[]>(
        'GET',
        `/channels/${params.channelId}/messages?limit=100`,
      )) ?? [];
    for (const message of messages) {
      if (message.pinned || message.author?.bot !== true) {
        continue;
      }

      if (
        !this.matchesPlayConfirmationMessage(
          message,
          params.config,
          params.footerMarker,
        )
      ) {
        continue;
      }

      await this.discordRequest(
        'DELETE',
        `/channels/${params.channelId}/messages/${message.id}`,
        undefined,
        { notFoundOk: true },
      ).catch(() => null);
    }
  }

  private matchesPlayConfirmationMessage(
    message: DiscordMessage,
    config: SessionDiscordConfigRecord,
    footerMarker: string,
  ) {
    const title = prefixedTitle(config, playConfirmationMessageTitle(config));
    const description = playConfirmationMessageText(config);
    const content = message.content?.trim() ?? '';
    return (
      (content.includes(title) && content.includes(description)) ||
      (message.embeds ?? []).some(
        (embed) =>
          embedHasMarker(embed, footerMarker) ||
          embed.title === title ||
          embed.description === description,
      ) ||
      this.messageComponentCustomIds(message).some((customId) =>
        customId.startsWith('play:'),
      )
    );
  }

  private async syncPlayConfirmationReactions(params: {
    channelId: string;
    message: DiscordMessage;
    config: SessionDiscordConfigRecord;
  }) {
    const message =
      params.message.reactions === undefined
        ? await this.discordRequest<DiscordMessage>(
            'GET',
            `/channels/${params.channelId}/messages/${params.message.id}`,
            undefined,
            { notFoundOk: true },
          )
        : params.message;
    if (!message) {
      console.warn(
        `[DiscordSync] skipped play confirmation reactions for missing message channel=${params.channelId} message=${params.message.id}`,
      );
      return;
    }
    const currentReactions = [
      legacyOrConfiguredEmoji(params.config, 'playConfirmEmoji', 'check'),
      legacyOrConfiguredEmoji(params.config, 'playNotPlayingEmoji', 'reject'),
      DEFAULT_DISCORD_EMOJIS.check,
      DEFAULT_DISCORD_EMOJIS.reject,
    ].filter(
      (emoji, index, list): emoji is string =>
        Boolean(emoji) && list.indexOf(emoji) === index,
    );

    const desiredReactions =
      playConfirmationReactionsEnabled(params.config) &&
      playConfirmationWindow(params.config).allowsAction
        ? currentReactions.slice(0, 2)
        : [];
    const desiredReactionParams = new Set(
      desiredReactions.map((emoji) => this.discordReactionParam(emoji)),
    );

    for (const emoji of currentReactions) {
      const encodedEmoji = this.discordReactionParam(emoji);
      if (
        desiredReactionParams.has(encodedEmoji) ||
        !this.hasOwnReaction(message, emoji)
      ) {
        continue;
      }

      await this.discordRequest(
        'DELETE',
        `/channels/${params.channelId}/messages/${message.id}/reactions/${encodedEmoji}/@me`,
        undefined,
        { notFoundOk: true },
      ).catch(() => null);
    }

    for (const emoji of desiredReactions) {
      if (this.hasOwnReaction(message, emoji)) {
        continue;
      }

      const encodedEmoji = this.discordReactionParam(emoji);
      await this.discordRequest(
        'PUT',
        `/channels/${params.channelId}/messages/${message.id}/reactions/${encodedEmoji}/@me`,
        undefined,
        { notFoundOk: true },
      ).catch((error) => {
        console.warn(
          `Failed to add play confirmation reaction ${emoji}:`,
          error,
        );
      });
    }
  }

  private hasOwnReaction(message: DiscordMessage, value: string) {
    return (message.reactions ?? []).some(
      (reaction) =>
        reaction.me === true &&
        this.reactionEmojiMatches(reaction.emoji, value),
    );
  }

  private reactionEmojiMatches(
    emoji: { id?: string | null; name?: string | null } | undefined,
    value: string,
  ) {
    const parsed = this.parseDiscordReactionValue(value);
    if (!emoji) {
      return false;
    }
    if (parsed.id) {
      return emoji.id === parsed.id;
    }
    return !emoji.id && emoji.name === parsed.name;
  }

  private parseDiscordReactionValue(value: string) {
    const trimmed = value.trim();
    const custom = /^<a?:([^:>]+):(\d+)>$/.exec(trimmed);
    return custom
      ? { name: custom[1], id: custom[2] }
      : { name: trimmed, id: null };
  }

  private discordReactionParam(value: string) {
    const trimmed = value.trim();
    const custom = /^<a?:([^:>]+):(\d+)>$/.exec(trimmed);
    return encodeURIComponent(custom ? `${custom[1]}:${custom[2]}` : trimmed);
  }

  private registrationPanelPayload(params: {
    session: {
      id: string;
      name: string;
      status: string;
      registrationOpenAt: Date | string | null;
      registrationCloseAt: Date | string | null;
    };
    config: SessionDiscordConfigRecord;
  }) {
    const title = prefixedTitle(
      params.config,
      registrationMessageTitle(params.config),
    );
    const text = registrationMessageText(params);
    const registrationStatus = registrationWindowStatusTextForSession(
      params.session,
      params.config,
    );
    if (registrationMessageDisplayMode(params.config) === 'embed') {
      const mentionSource = [title, text].join('\n');
      const mentionContent = mentionContentForOrganizerText(mentionSource);
      const fields = registrationStatus
        ? [
            {
              name: 'Window',
              value: registrationStatus.slice(0, 1024),
            },
          ]
        : [];
      return {
        content: mentionContent,
        embeds: [
          {
            color: 0x22d3ee,
            title: title.slice(0, 256),
            description: text.slice(0, 4000),
            fields,
          },
        ],
        components: [],
        allowed_mentions: allowedMentionsForOrganizerText(mentionSource),
      };
    }

    const content = limitDiscordMessageContent(
      [
        `**${title}**`,
        text,
        registrationStatus ? `**Window**\n${registrationStatus}` : '',
      ]
        .filter(Boolean)
        .join('\n\n'),
    );
    return {
      content,
      embeds: [],
      components: [],
      allowed_mentions: allowedMentionsForOrganizerText(content),
    };
  }

  private matchesRegistrationPanelMessage(
    message: DiscordMessage,
    title: string,
  ) {
    const expectedTitle = title.trim();
    const content = message.content?.trim() ?? '';
    if (
      message.author?.bot !== false &&
      content.includes(expectedTitle) &&
      /register/i.test(content)
    ) {
      return true;
    }

    return (
      message.author?.bot !== false &&
      (message.embeds ?? []).some((embed) => {
        const embedTitle = embed.title?.trim() ?? '';
        const description = embed.description?.trim() ?? '';
        const hasRegistrationWindowField = (embed.fields ?? []).some(
          (field) =>
            field.name === 'Window' && /Registration/i.test(field.value ?? ''),
        );

        return (
          embedTitle === expectedTitle ||
          embedTitle === 'Arenzyra Scrim Registration' ||
          (hasRegistrationWindowField && /registration/i.test(embedTitle)) ||
          (/registration/i.test(embedTitle) && /register/i.test(description))
        );
      })
    );
  }

  private slotListPayload(params: {
    session: { id: string; slotCount: number };
    config: SessionDiscordConfigRecord;
    registrations: SessionRegistrationForSync[];
    teamLogoEmojiByTeamId?: Map<string, string>;
    defaultTeamLogoEmoji?: string | null;
    validGuildMemberIds?: Set<string> | null;
  }) {
    const { startSlot, endSlot } = slotRangeForSession(
      params.session,
      params.config,
    );
    const vipRange = vipSlotRangeForSession(params.session, params.config, {
      startSlot,
      endSlot,
    });
    const confirmed = params.registrations
      .filter(
        (registration) =>
          registration.slotNumber !== null &&
          registration.slotNumber >= startSlot &&
          registration.slotNumber <= endSlot,
      )
      .sort((left, right) => (left.slotNumber ?? 0) - (right.slotNumber ?? 0));
    const bySlot = new Map(
      confirmed.map((registration) => [registration.slotNumber, registration]),
    );
    const vipConfirmed = params.registrations
      .filter(
        (registration) =>
          registration.slotNumber !== null &&
          registration.slotNumber >= vipRange.startSlot &&
          registration.slotNumber <= vipRange.endSlot,
      )
      .sort((left, right) => (left.slotNumber ?? 0) - (right.slotNumber ?? 0));
    const byVipSlot = new Map(
      vipConfirmed.map((registration) => [
        registration.slotNumber,
        registration,
      ]),
    );
    const assignableSlots = Math.max(0, endSlot - startSlot + 1);
    const empty = `${emojiValue(params.config, 'empty')} EMPTY`;

    const buildLines = (
      rowOptions: { hideLogo?: boolean; shortenName?: boolean } = {},
    ) => {
      const renderedLines: string[] = [];

      for (let slot = startSlot; slot <= endSlot; slot += 1) {
        const registration = bySlot.get(slot);
        const marker = slotRowMarker({
          config: params.config,
          slotNumber: slot,
        });
        const playStatus = registration
          ? registrationPlayStatus(registration)
          : null;
        const row = `${marker} ${
          registration
            ? teamSlotRow(
                registration,
                playStatus,
                params.teamLogoEmojiByTeamId?.get(registration.teamId) ??
                  params.defaultTeamLogoEmoji,
                params.validGuildMemberIds,
                rowOptions,
              )
            : empty
        }`;
        renderedLines.push(formatPlayStatusRow(row, playStatus, params.config));
      }

      for (let vip = 1; vip <= vipRange.capacity; vip += 1) {
        const slot = vipRange.startSlot + vip - 1;
        const registration = byVipSlot.get(slot);
        const marker = slotRowMarker({
          config: params.config,
          slotNumber: slot,
          vipIndex: vip,
        });
        const playStatus = registration
          ? registrationPlayStatus(registration)
          : null;
        const row = `${marker} ${
          registration
            ? teamSlotRow(
                registration,
                playStatus,
                params.teamLogoEmojiByTeamId?.get(registration.teamId) ??
                  params.defaultTeamLogoEmoji,
                params.validGuildMemberIds,
                rowOptions,
              )
            : empty
        }`;
        renderedLines.push(formatPlayStatusRow(row, playStatus, params.config));
      }

      return renderedLines;
    };
    const lines = buildLines();

    const title =
      vipRange.capacity > 0
        ? `${emojiValue(params.config, 'slot')} Slot List (${confirmed.length}/${assignableSlots}) | ${emojiValue(params.config, 'vip')} VIP ${vipConfirmed.length}/${vipRange.capacity}`
        : `${emojiValue(params.config, 'slot')} Slot List (${confirmed.length}/${assignableSlots})`;
    const confirmationWindow = playConfirmationWindow(params.config);
    const components =
      playConfirmationButtonsEnabled(params.config) &&
      confirmationWindow.allowsAction
        ? [
            {
              type: 1,
              components: [
                buttonComponent({
                  config: params.config,
                  customId: `play:confirm:${params.session.id}`,
                  disabled: false,
                  labelKey: 'playConfirmLabel',
                  labelFallback: 'Confirm',
                  emojiKey: 'playConfirmEmoji',
                  emojiFallbackKey: 'check',
                  styleKey: 'playConfirmStyle',
                  styleFallback: 'success',
                }),
                buttonComponent({
                  config: params.config,
                  customId: `play:not:${params.session.id}`,
                  disabled: false,
                  labelKey: 'playNotPlayingLabel',
                  labelFallback: 'Not Playing',
                  emojiKey: 'playNotPlayingEmoji',
                  emojiFallbackKey: 'reject',
                  styleKey: 'playNotPlayingStyle',
                  styleFallback: 'danger',
                }),
              ],
            },
          ]
        : [];
    const confirmationStatus = playConfirmationWindowStatusText(params.config);
    const fields: Array<{ name: string; value: string; inline: boolean }> = [];
    if (confirmationStatus) {
      fields.push({
        name: 'Confirmation',
        value: confirmationStatus,
        inline: false,
      });
    }
    const description =
      lines.length > 0
        ? lines.join('\n')
        : 'No assignable slots are configured.';

    const renderPlainContent = (body: string) =>
      [
        `**${prefixedTitle(params.config, title)}**`,
        body,
        ...fields.map((field) => `**${field.name}**\n${field.value}`),
      ].join('\n\n');
    const plainContent = renderPlainContent(description);

    if (plainContent.length <= DISCORD_MESSAGE_CONTENT_LIMIT) {
      return {
        content: plainContent,
        embeds: [],
        components,
        allowed_mentions: allowedMentionsForRenderedUserMentions(plainContent),
      };
    }
    const noLogoLines = buildLines({ hideLogo: true });
    const noLogoContent = renderPlainContent(
      noLogoLines.length > 0
        ? noLogoLines.join('\n')
        : 'No assignable slots are configured.',
    );
    if (noLogoContent.length <= DISCORD_MESSAGE_CONTENT_LIMIT) {
      return {
        content: noLogoContent,
        embeds: [],
        components,
        allowed_mentions: allowedMentionsForRenderedUserMentions(noLogoContent),
      };
    }
    const compactLines = buildLines({ hideLogo: true, shortenName: true });
    const compactContent = renderPlainContent(
      compactLines.length > 0
        ? compactLines.join('\n')
        : 'No assignable slots are configured.',
    );
    const content = limitDiscordMessageContent(compactContent);

    return {
      content,
      embeds: [],
      components,
      allowed_mentions: allowedMentionsForRenderedUserMentions(content),
    };
  }

  private playConfirmationMessagePayload(params: {
    session: { id: string };
    config: SessionDiscordConfigRecord;
  }) {
    const confirmationWindow = playConfirmationWindow(params.config);
    const components =
      playConfirmationButtonsEnabled(params.config) &&
      confirmationWindow.allowsAction
        ? [
            {
              type: 1,
              components: [
                buttonComponent({
                  config: params.config,
                  customId: `play:confirm:${params.session.id}`,
                  disabled: false,
                  labelKey: 'playConfirmLabel',
                  labelFallback: 'Confirm',
                  emojiKey: 'playConfirmEmoji',
                  emojiFallbackKey: 'check',
                  styleKey: 'playConfirmStyle',
                  styleFallback: 'success',
                }),
                buttonComponent({
                  config: params.config,
                  customId: `play:not:${params.session.id}`,
                  disabled: false,
                  labelKey: 'playNotPlayingLabel',
                  labelFallback: 'Not Playing',
                  emojiKey: 'playNotPlayingEmoji',
                  emojiFallbackKey: 'reject',
                  styleKey: 'playNotPlayingStyle',
                  styleFallback: 'danger',
                }),
              ],
            },
          ]
        : [];
    const confirmationStatus = playConfirmationWindowStatusText(params.config);
    const fields: Array<{ name: string; value: string; inline: boolean }> = [];
    if (confirmationStatus) {
      fields.push({
        name: 'Window',
        value: confirmationStatus,
        inline: false,
      });
    }
    const content = limitDiscordMessageContent(
      [
        `**${prefixedTitle(
          params.config,
          playConfirmationMessageTitle(params.config),
        )}**`,
        playConfirmationMessageText(params.config),
        ...fields.map((field) => `**${field.name}**\n${field.value}`),
      ]
        .filter(Boolean)
        .join('\n\n'),
    );

    return {
      content,
      embeds: [],
      components,
      allowed_mentions: allowedMentionsForOrganizerText(content),
    };
  }

  private waitlistPayload(params: {
    sessionId: string;
    config: SessionDiscordConfigRecord;
    registrations: SessionRegistrationForSync[];
    teamLogoEmojiByTeamId?: Map<string, string>;
    defaultTeamLogoEmoji?: string | null;
    validGuildMemberIds?: Set<string> | null;
  }) {
    const waitlist = params.registrations
      .filter((registration) => registration.waitlistPosition !== null)
      .sort(
        (left, right) =>
          (left.waitlistPosition ?? Number.MAX_SAFE_INTEGER) -
          (right.waitlistPosition ?? Number.MAX_SAFE_INTEGER),
      );
    const buildLines = (
      rowOptions: { hideLogo?: boolean; shortenName?: boolean } = {},
    ) =>
      waitlist.length > 0
        ? waitlist.map((registration) => {
            return `${emojiValue(params.config, 'waitlist')} ${registration.waitlistPosition}. ${teamSlotRow(
              registration,
              registrationPlayStatus(registration),
              params.teamLogoEmojiByTeamId?.get(registration.teamId) ??
                params.defaultTeamLogoEmoji,
              params.validGuildMemberIds,
              rowOptions,
            )}`;
          })
        : [`${emojiValue(params.config, 'empty')} None`];

    const renderPlainContent = (lines: string[]) =>
      [
        `**${prefixedTitle(
          params.config,
          `${emojiValue(params.config, 'waitlist')} Waitlist (${waitlist.length})`,
        )}**`,
        lines.join('\n'),
      ].join('\n\n');

    if (waitlistMessageMode(params.config) === 'plain') {
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
        allowed_mentions: allowedMentionsForRenderedUserMentions(content),
      };
    }

    const description = buildLines().join('\n').slice(0, 4096);
    const mirroredContent = mentionMirrorContent(description);

    return {
      content: mirroredContent,
      embeds: [
        {
          color: 0xf59e0b,
          title: prefixedTitle(
            params.config,
            `${emojiValue(params.config, 'waitlist')} Waitlist (${waitlist.length})`,
          ),
          description,
          timestamp: new Date().toISOString(),
        },
      ],
      allowed_mentions: mirroredContent
        ? allowedMentionsForRenderedUserMentions(mirroredContent)
        : { parse: [] },
    };
  }

  private matchesWaitlistMessage(message: DiscordMessage) {
    const content = message.content?.trim() ?? '';
    return (
      message.author?.bot !== false &&
      (/Waitlist\s*\(\d+\)/i.test(content) ||
        (message.embeds ?? []).some((embed) =>
          /Waitlist\s*\(\d+\)/i.test(embed.title?.trim() ?? ''),
        ))
    );
  }

  private matchesSlotListMessage(message: DiscordMessage) {
    return (
      message.author?.bot !== false &&
      /\bslot\s+list\s*\(/i.test(discordMessageText(message))
    );
  }

  private waitlistControlPayload(params: {
    sessionId: string;
    registrations: SessionRegistrationForSync[];
    page?: number;
  }) {
    const waitlist = params.registrations
      .filter(
        (registration) =>
          registration.status === 'WAITLIST' &&
          registration.waitlistPosition !== null,
      )
      .sort(
        (left, right) =>
          (left.waitlistPosition ?? Number.MAX_SAFE_INTEGER) -
          (right.waitlistPosition ?? Number.MAX_SAFE_INTEGER),
      );
    const { page, totalPages } = clampWaitlistControlPage(
      waitlist.length,
      params.page ?? 0,
    );
    const pageStart = page * WAITLIST_CONTROL_PAGE_SIZE;
    const visibleWaitlist = waitlist.slice(
      pageStart,
      pageStart + WAITLIST_CONTROL_PAGE_SIZE,
    );
    const descriptionLines =
      visibleWaitlist.length > 0
        ? [
            'Select a team below, then choose Approve, Set Slot, VIP, or Remove.',
            `Page ${page + 1}/${totalPages}`,
            '',
            ...visibleWaitlist.map((registration) => {
              const teamName =
                registration.team?.name?.trim() ||
                registration.teamId ||
                'Unknown Team';
              const tag = registration.team?.tag?.trim();
              const label = tag ? `[${tag}] ${teamName}` : teamName;
              return `**${registration.waitlistPosition}.** ${truncateDiscordOptionText(
                label,
                120,
              )}`;
            }),
          ]
        : ['No teams are currently on the waitlist.'];

    const components: Array<Record<string, unknown>> = [];
    if (visibleWaitlist.length > 0) {
      components.push({
        type: 1,
        components: [
          {
            type: 3,
            custom_id: `waitctl:select:${params.sessionId}:${page}`,
            placeholder: 'Select waitlist team',
            min_values: 1,
            max_values: 1,
            options: visibleWaitlist.map((registration) => {
              const teamName =
                registration.team?.name?.trim() ||
                registration.teamId ||
                'Unknown Team';
              const tag = registration.team?.tag?.trim();
              const label = tag ? `${tag} - ${teamName}` : teamName;
              const placement =
                registration.waitlistPosition !== null
                  ? `Waitlist #${registration.waitlistPosition}`
                  : 'Waitlist';
              return {
                label: truncateDiscordOptionText(label),
                description: truncateDiscordOptionText(
                  tag ? `${placement} | ${tag}` : placement,
                ),
                value: registration.id,
              };
            }),
          },
        ],
      });
    }

    if (totalPages > 1) {
      components.push({
        type: 1,
        components: [
          {
            type: 2,
            style: 2,
            custom_id: `waitctl:p:${params.sessionId}:${Math.max(0, page - 1)}`,
            label: 'Previous',
            disabled: page <= 0,
          },
          {
            type: 2,
            style: 2,
            custom_id: `waitctl:p:${params.sessionId}:${Math.min(
              totalPages - 1,
              page + 1,
            )}`,
            label: 'Next',
            disabled: page >= totalPages - 1,
          },
        ],
      });
    }

    return {
      content: '',
      embeds: [
        {
          color: 0xf59e0b,
          title: 'Waitlist Control',
          description: descriptionLines.join('\n'),
          footer: { text: 'Arenzyra Waitlist Control' },
          timestamp: new Date().toISOString(),
        },
      ],
      components,
      allowed_mentions: { parse: [] },
    };
  }

  private async syncMessages(params: {
    guildId: string;
    session: {
      id: string;
      name: string;
      status: string;
      slotCount: number;
      registrationOpenAt: Date | string | null;
      registrationCloseAt: Date | string | null;
    };
    config: SessionDiscordConfigRecord;
    setup: DiscordSetup;
    registrations: SessionRegistrationForSync[];
    validGuildMemberIds?: Set<string> | null;
  }) {
    await this.syncWaitlistPromotionChannelState(params);
    const logoOpts = await this.resolveTeamLogoEmojis({
      guildId: params.guildId,
      registrations: params.registrations,
      config: params.config,
    });
    const registrationMarker = marker(params.session.id, 'registration-panel');
    let registrationPanelMessageId = '';
    if (registrationMessageEnabled(params.config)) {
      const registrationPanelMessage = await this.upsertMarkedMessage({
        channelId: params.setup.registrationChannel.id,
        messageId: managedMessageId(
          params.config,
          'managedRegistrationPanelMessageId',
        ),
        footerMarker: registrationMarker,
        payload: this.registrationPanelPayload({
          session: params.session,
          config: params.config,
        }),
        matchExisting: (message) =>
          this.matchesRegistrationPanelMessage(
            message,
            prefixedTitle(
              params.config,
              registrationMessageTitle(params.config),
            ),
          ),
      });
      registrationPanelMessageId = registrationPanelMessage.id;
    } else {
      await this.deleteMarkedMessage({
        channelId: params.setup.registrationChannel.id,
        messageId: managedMessageId(
          params.config,
          'managedRegistrationPanelMessageId',
        ),
        footerMarker: registrationMarker,
      });
    }
    const slotListMessage = await this.upsertMarkedMessage({
      channelId: params.setup.slotListChannel.id,
      messageId: managedMessageId(params.config, 'managedSlotListMessageId'),
      footerMarker: marker(params.session.id, 'slots'),
      payload: this.slotListPayload({
        session: params.session,
        config: params.config,
        registrations: params.registrations,
        validGuildMemberIds: params.validGuildMemberIds,
        ...logoOpts,
      }),
      matchExisting: (message) => this.matchesSlotListMessage(message),
    });
    await this.syncPlayConfirmationReactions({
      channelId: params.setup.slotListChannel.id,
      message: slotListMessage,
      config: params.config,
    });
    const confirmationMarker = marker(params.session.id, 'confirmation');
    let confirmationMessageId = '';
    if (playConfirmationMessageEnabled(params.config)) {
      const confirmationMessage = await this.upsertMarkedMessage({
        channelId: params.setup.slotListChannel.id,
        messageId: managedMessageId(
          params.config,
          'managedConfirmationMessageId',
        ),
        footerMarker: confirmationMarker,
        payload: this.playConfirmationMessagePayload({
          session: params.session,
          config: params.config,
        }),
        pin: false,
        matchExisting: (message) =>
          this.matchesPlayConfirmationMessage(
            message,
            params.config,
            confirmationMarker,
          ),
      });
      await this.syncPlayConfirmationReactions({
        channelId: params.setup.slotListChannel.id,
        message: confirmationMessage,
        config: params.config,
      });
      confirmationMessageId = confirmationMessage.id;
    } else {
      await this.deleteMarkedMessage({
        channelId: params.setup.slotListChannel.id,
        messageId: managedMessageId(
          params.config,
          'managedConfirmationMessageId',
        ),
        footerMarker: confirmationMarker,
      });
      if (allowBroadBotMessageCleanup(params.config)) {
        await this.cleanupStandalonePlayConfirmationMessages({
          channelId: params.setup.slotListChannel.id,
          footerMarker: confirmationMarker,
          config: params.config,
        });
      }
    }
    const waitlistMessage = await this.upsertMarkedMessage({
      channelId: params.setup.waitlistChannel.id,
      messageId: managedMessageId(params.config, 'managedWaitlistMessageId'),
      footerMarker: marker(params.session.id, 'waitlist'),
      payload: this.waitlistPayload({
        sessionId: params.session.id,
        config: params.config,
        registrations: params.registrations,
        validGuildMemberIds: params.validGuildMemberIds,
        ...logoOpts,
      }),
      matchExisting: (message) => this.matchesWaitlistMessage(message),
    });
    await this.deleteMarkedMessage({
      channelId: params.setup.manageChannel.id,
      messageId: managedMessageId(
        params.config,
        'managedWaitlistControlMessageId',
      ),
      footerMarker: marker(params.session.id, 'waitlist-control'),
      matchExisting: (message) =>
        message.embeds?.some(
          (embed) => embed.title?.trim() === 'Waitlist Control',
        ) ?? false,
    });
    return {
      managedRegistrationPanelMessageId: registrationPanelMessageId,
      managedSlotListMessageId: slotListMessage.id,
      managedWaitlistMessageId: waitlistMessage.id,
      managedWaitlistControlMessageId: '',
      managedConfirmationMessageId: confirmationMessageId,
    };
  }

  private async syncWaitlistPromotionChannelState(params: {
    guildId: string;
    session: { id: string; status: string; slotCount: number };
    config: SessionDiscordConfigRecord;
    setup: DiscordSetup;
    registrations: SessionRegistrationForSync[];
  }) {
    const roles = await this.getRoles(params.guildId);
    const staffRoles = this.staffRoles(
      roles,
      params.config,
      params.setup.staffRole,
    );
    const canSend = waitlistPromotionOpen({
      session: params.session,
      registrations: params.registrations,
      config: params.config,
    });
    const botUserId = await this.getBotUserId().catch(() => null);
    const overwrites = this.waitlistPromotionOverwrites(
      params.guildId,
      staffRoles,
      params.setup.waitlistRole,
      canSend,
      botUserId,
    );

    if (!manageChannelPermissions(params.config)) {
      await this.applyBotControlledPermissionPatch({
        channel: params.setup.waitlistChannel,
        guildId: params.guildId,
        kind: 'waitlist',
        desiredOverwrites: overwrites,
        botUserId,
      });
      return;
    }

    await this.editChannel(
      params.setup.waitlistChannel.id,
      {
        permission_overwrites: overwrites,
      },
      `Arenzyra waitlist promotion channel state sync for ${params.session.id}`,
    ).catch((error) => {
      console.warn(
        `Waitlist promotion channel permission sync failed for ${params.session.id}:`,
        error,
      );
      return null;
    });
  }

  private async syncAccessRoles(params: {
    guildId: string;
    setup: DiscordSetup;
    organizationId: string;
    registrations: SessionRegistrationForSync[];
  }) {
    const accessRegistrations = params.registrations.filter(
      (registration) =>
        registration.slotNumber !== null ||
        registration.waitlistPosition !== null,
    );
    const activeTeamIds = [
      ...new Set(
        accessRegistrations.map((registration) => registration.teamId),
      ),
    ];
    if (activeTeamIds.length === 0) {
      return { attempted: 0, failed: 0 };
    }

    const members = await this.prisma.teamMember.findMany({
      where: {
        organizationId: params.organizationId,
        teamId: { in: activeTeamIds },
        leftAt: null,
        deletedAt: null,
      },
      select: {
        teamId: true,
        discordUserId: true,
        role: true,
      },
    });
    const membersByTeamId = new Map<string, typeof members>();
    for (const member of members) {
      const existing = membersByTeamId.get(member.teamId) ?? [];
      existing.push(member);
      membersByTeamId.set(member.teamId, existing);
    }
    const accessDiscordUserIdsByRegistrationId = new Map<string, string[]>();
    const globallyProtectedAccessDiscordUserIds = new Set<string>();
    for (const registration of accessRegistrations) {
      const accessDiscordUserIds =
        this.registrationAccessDiscordUserIdsForRoles(
          registration,
          membersByTeamId.get(registration.teamId) ?? [],
        );
      accessDiscordUserIdsByRegistrationId.set(
        registration.id,
        accessDiscordUserIds,
      );
      for (const discordUserId of accessDiscordUserIds) {
        globallyProtectedAccessDiscordUserIds.add(discordUserId);
      }
    }
    let attempted = 0;
    let failed = 0;

    for (const registration of accessRegistrations) {
      const teamMembers = membersByTeamId.get(registration.teamId) ?? [];
      const accessDiscordUserIds =
        accessDiscordUserIdsByRegistrationId.get(registration.id) ?? [];
      const candidateDiscordUserIds = uniqueStrings([
        ...teamMembers.map((member) => member.discordUserId),
        ...accessDiscordUserIds,
      ]).filter((discordUserId) =>
        DISCORD_SNOWFLAKE_PATTERN.test(discordUserId),
      );
      if (candidateDiscordUserIds.length === 0) {
        continue;
      }

      const slotAccessRoleIds = uniqueStrings([
        params.setup.slotRole?.id,
        params.setup.idpRole?.id,
      ]);
      const legacyIdpRoleIds = uniqueStrings([params.setup.legacyIdpRole?.id]);
      const add =
        registration.slotNumber !== null
          ? slotAccessRoleIds
          : registration.waitlistPosition !== null
            ? uniqueStrings([params.setup.waitlistRole?.id])
            : [];
      const remove =
        registration.slotNumber !== null
          ? uniqueStrings([params.setup.waitlistRole?.id, ...legacyIdpRoleIds])
          : registration.waitlistPosition !== null
            ? uniqueStrings([...slotAccessRoleIds, ...legacyIdpRoleIds])
            : [];
      const safeRemove = remove.filter((roleId) => !add.includes(roleId));
      const allManagedAccessRoleIds = uniqueStrings([
        ...slotAccessRoleIds,
        params.setup.waitlistRole?.id,
        ...legacyIdpRoleIds,
      ]);
      const accessDiscordUserIdSet = new Set(accessDiscordUserIds);

      for (const discordUserId of candidateDiscordUserIds) {
        const shouldHaveAccess = accessDiscordUserIdSet.has(discordUserId);
        const isProtectedByAnotherRegistration =
          !shouldHaveAccess &&
          globallyProtectedAccessDiscordUserIds.has(discordUserId);
        if (isProtectedByAnotherRegistration) {
          continue;
        }
        const rolesToRemove = shouldHaveAccess
          ? safeRemove
          : allManagedAccessRoleIds;
        const rolesToAdd = shouldHaveAccess ? add : [];

        for (const roleId of rolesToRemove) {
          attempted += 1;
          await this.discordRequest(
            'DELETE',
            `/guilds/${params.guildId}/members/${discordUserId}/roles/${roleId}`,
            undefined,
            { notFoundOk: true },
          ).catch(() => {
            failed += 1;
          });
        }
        for (const roleId of rolesToAdd) {
          attempted += 1;
          await this.discordRequest(
            'PUT',
            `/guilds/${params.guildId}/members/${discordUserId}/roles/${roleId}`,
            undefined,
            { notFoundOk: true },
          ).catch(() => {
            failed += 1;
          });
        }
      }
    }

    return { attempted, failed };
  }

  private registrationAccessDiscordUserIdsForRoles(
    registration: SessionRegistrationForSync,
    teamMembers: Array<{
      discordUserId: string;
      role?: string | null;
    }>,
  ) {
    const snapshotDiscordUserIds = uniqueStrings(
      registration.managerDiscordUserIds?.length
        ? registration.managerDiscordUserIds
        : [registration.leaderDiscordUserId],
    ).filter((discordUserId) => DISCORD_SNOWFLAKE_PATTERN.test(discordUserId));
    if (snapshotDiscordUserIds.length > 0) {
      return snapshotDiscordUserIds;
    }

    return uniqueStrings(
      teamMembers
        .filter((member) => member.role === 'LEADER')
        .map((member) => member.discordUserId),
    ).filter((discordUserId) => DISCORD_SNOWFLAKE_PATTERN.test(discordUserId));
  }

  private addRegistrationDiscordUserIds(
    target: Set<string>,
    registration: RemovedRegistrationDiscordRoleCleanupInput,
  ) {
    for (const discordUserId of [
      registration.leaderDiscordUserId,
      ...(registration.managerDiscordUserIds ?? []),
    ]) {
      const cleanDiscordUserId = discordUserId?.trim();
      if (
        cleanDiscordUserId &&
        DISCORD_SNOWFLAKE_PATTERN.test(cleanDiscordUserId)
      ) {
        target.add(cleanDiscordUserId);
      }
    }
  }

  private async fetchDiscordMemberRoleIds(
    guildId: string,
    discordUserId: string,
  ) {
    const member = await this.discordRequest<DiscordGuildMember>(
      'GET',
      `/guilds/${guildId}/members/${discordUserId}`,
      undefined,
      { notFoundOk: true },
    );
    if (!member) {
      return null;
    }
    return new Set(
      (Array.isArray(member.roles) ? member.roles : []).filter((roleId) =>
        DISCORD_SNOWFLAKE_PATTERN.test(roleId),
      ),
    );
  }

  private async removeManagedAccessRolesFromDiscordUser(params: {
    guildId: string;
    discordUserId: string;
    roleIds: string[];
    auditReason: string;
    sessionId: string;
  }) {
    const roleIds = uniqueStrings(params.roleIds);
    let attempted = 0;
    let failed = 0;

    const removeRoles = async (targetRoleIds: string[]) => {
      for (const roleId of targetRoleIds) {
        attempted += 1;
        await this.discordRequest(
          'DELETE',
          `/guilds/${params.guildId}/members/${params.discordUserId}/roles/${roleId}`,
          undefined,
          { auditReason: params.auditReason, notFoundOk: true },
        ).catch((error) => {
          failed += 1;
          console.warn(
            `[DiscordSync] removed registration role cleanup failed session=${params.sessionId} user=${params.discordUserId} role=${roleId}: ${String(
              error,
            )}`,
          );
        });
      }
    };

    await removeRoles(roleIds);

    let remainingRoleIds: string[] = [];
    try {
      const memberRoleIds = await this.fetchDiscordMemberRoleIds(
        params.guildId,
        params.discordUserId,
      );
      if (!memberRoleIds) {
        return { attempted, failed, verifiedRemaining: 0 };
      }
      remainingRoleIds = roleIds.filter((roleId) => memberRoleIds.has(roleId));
    } catch (error) {
      failed += roleIds.length;
      console.warn(
        `[DiscordSync] removed registration role verification failed session=${params.sessionId} user=${params.discordUserId}: ${String(
          error,
        )}`,
      );
      return { attempted, failed, verifiedRemaining: roleIds.length };
    }

    for (
      let retryAttempt = 0;
      retryAttempt < 2 && remainingRoleIds.length > 0;
      retryAttempt += 1
    ) {
      await sleep(500 * (retryAttempt + 1));
      await removeRoles(remainingRoleIds);
      try {
        const memberRoleIds = await this.fetchDiscordMemberRoleIds(
          params.guildId,
          params.discordUserId,
        );
        if (!memberRoleIds) {
          remainingRoleIds = [];
          break;
        }
        remainingRoleIds = remainingRoleIds.filter((roleId) =>
          memberRoleIds.has(roleId),
        );
      } catch (error) {
        console.warn(
          `[DiscordSync] removed registration role retry verification failed session=${params.sessionId} user=${params.discordUserId}: ${String(
            error,
          )}`,
        );
        break;
      }
    }

    if (remainingRoleIds.length > 0) {
      failed += remainingRoleIds.length;
      console.warn(
        `[DiscordSync] removed registration role cleanup still present session=${params.sessionId} user=${params.discordUserId} roles=${remainingRoleIds.join(
          ',',
        )}`,
      );
    }

    return {
      attempted,
      failed,
      verifiedRemaining: remainingRoleIds.length,
    };
  }

  private async managedAccessRoleIdsForCleanup(
    config: SessionDiscordConfigRecord,
  ) {
    const roleIds = new Set(
      uniqueStrings([
        config.slotRoleId,
        config.waitlistRoleId,
        config.idpRoleId,
      ]),
    );

    if (!config.guildId || !config.slotRoleId) {
      return [...roleIds];
    }

    try {
      const roles = await this.getRoles(config.guildId);
      const legacyIdpRole = this.findLegacyIdpRole({
        roles,
        sessionId: config.sessionId,
        config,
        slotRole: {
          id: config.slotRoleId,
          name: config.slotRoleName ?? '',
          permissions: '0',
        },
      });
      if (legacyIdpRole) {
        roleIds.add(legacyIdpRole.id);
      }
    } catch (error) {
      console.warn(
        `[DiscordSync] legacy IDP role lookup failed session=${config.sessionId}: ${String(
          error,
        )}`,
      );
    }

    return [...roleIds];
  }

  async cleanupManagedRolesForRemovedRegistrations(
    sessionId: string,
    registrations: RemovedRegistrationDiscordRoleCleanupInput[],
    actor: Actor,
  ) {
    const organizationId = this.requireOrg(actor);
    const removedTeamIds = uniqueStrings(
      registrations.map((registration) => registration.teamId),
    );
    if (removedTeamIds.length === 0) {
      return {
        ok: true,
        sessionId,
        attempted: 0,
        failed: 0,
        users: 0,
        protectedUsers: 0,
        roles: 0,
        skipped: 'no-registrations',
      };
    }

    const config = (await this.prisma.sessionDiscordConfig.findUnique({
      where: { sessionId },
    })) as SessionDiscordConfigRecord | null;
    if (
      !config ||
      config.organizationId !== organizationId ||
      !config.enabled ||
      !config.guildId
    ) {
      return {
        ok: true,
        sessionId,
        attempted: 0,
        failed: 0,
        users: 0,
        protectedUsers: 0,
        roles: 0,
        skipped: 'no-discord-config',
      };
    }

    const roleIds = await this.managedAccessRoleIdsForCleanup(config);
    if (roleIds.length === 0) {
      return {
        ok: true,
        sessionId,
        attempted: 0,
        failed: 0,
        users: 0,
        protectedUsers: 0,
        roles: 0,
        skipped: 'no-managed-roles',
      };
    }

    const candidateUserIds = new Set<string>();
    for (const registration of registrations) {
      this.addRegistrationDiscordUserIds(candidateUserIds, registration);
    }

    const removedMembers = await this.prisma.teamMember.findMany({
      where: {
        organizationId,
        teamId: { in: removedTeamIds },
      },
      select: { discordUserId: true },
    });
    for (const member of removedMembers) {
      const discordUserId = member.discordUserId?.trim();
      if (discordUserId && DISCORD_SNOWFLAKE_PATTERN.test(discordUserId)) {
        candidateUserIds.add(discordUserId);
      }
    }

    const activeRegistrations = await this.prisma.sessionRegistration.findMany({
      where: {
        organizationId,
        sessionId,
        deletedAt: null,
        status: {
          in: [
            SessionRegistrationStatus.CONFIRMED,
            SessionRegistrationStatus.CHECKED_IN,
            SessionRegistrationStatus.WAITLIST,
          ],
        },
        OR: [
          {
            status: {
              in: [
                SessionRegistrationStatus.CONFIRMED,
                SessionRegistrationStatus.CHECKED_IN,
              ],
            },
            slotNumber: { not: null },
          },
          {
            status: SessionRegistrationStatus.WAITLIST,
            waitlistPosition: { not: null },
          },
        ],
      },
      select: {
        teamId: true,
        leaderDiscordUserId: true,
        managerDiscordUserIds: true,
      },
    });
    const protectedUserIds = new Set<string>();
    for (const registration of activeRegistrations) {
      this.addRegistrationDiscordUserIds(protectedUserIds, registration);
    }

    const activeTeamIds = uniqueStrings(
      activeRegistrations.map((registration) => registration.teamId),
    );
    if (activeTeamIds.length > 0) {
      const activeMembers = await this.prisma.teamMember.findMany({
        where: {
          organizationId,
          teamId: { in: activeTeamIds },
          leftAt: null,
          deletedAt: null,
        },
        select: { discordUserId: true },
      });
      for (const member of activeMembers) {
        const discordUserId = member.discordUserId?.trim();
        if (discordUserId && DISCORD_SNOWFLAKE_PATTERN.test(discordUserId)) {
          protectedUserIds.add(discordUserId);
        }
      }
    }

    let attempted = 0;
    let failed = 0;
    const cleanupUserIds = [...candidateUserIds].filter(
      (discordUserId) => !protectedUserIds.has(discordUserId),
    );
    const auditReason = `Arenzyra registration cleanup ${shortSessionId(
      sessionId,
    )}`.slice(0, 180);

    for (const discordUserId of cleanupUserIds) {
      const cleanup = await this.removeManagedAccessRolesFromDiscordUser({
        guildId: config.guildId,
        discordUserId,
        roleIds,
        auditReason,
        sessionId,
      });
      attempted += cleanup.attempted;
      failed += cleanup.failed;
    }

    console.log(
      `[DiscordSync] removed registration role cleanup session=${sessionId} users=${cleanupUserIds.length} protected=${protectedUserIds.size} roles=${roleIds.length} failed=${failed}`,
    );

    return {
      ok: true,
      sessionId,
      attempted,
      failed,
      users: cleanupUserIds.length,
      protectedUsers: protectedUserIds.size,
      roles: roleIds.length,
    };
  }

  async cleanupSessionDiscord(
    sessionId: string,
    actor: Actor,
    options: CleanupSessionDiscordOptions = {},
  ) {
    const organizationId = this.requireOrg(actor);
    const session = await this.prisma.session.findFirst({
      where: {
        id: sessionId,
        organizationId,
        deletedAt: null,
      },
      select: {
        id: true,
        name: true,
        organizationId: true,
        discordConfig: true,
      },
    });
    if (!session) {
      throw new NotFoundException('Session not found');
    }

    const config = session.discordConfig as SessionDiscordConfigRecord | null;
    if (!config) {
      return {
        ok: true,
        sessionId: session.id,
        deletedChannels: 0,
        deletedRoles: 0,
      };
    }

    await this.prisma.sessionDiscordConfig.update({
      where: { id: config.id },
      data: { enabled: false },
    });

    const auditReason = `Arenzyra session deleted: ${session.name}`.slice(
      0,
      180,
    );
    let deletedChannels = 0;
    let deletedRoles = 0;

    if (options.deleteChannels && !useExistingChannels(config)) {
      const channelIds = uniqueStrings([
        config.registrationChannelId,
        config.slotListChannelId,
        config.waitlistChannelId,
        config.idpChannelId,
        config.managerChannelId,
        config.transferChannelId,
        config.manageChannelId,
        config.resultsChannelId,
        config.screenshotsChannelId,
        config.bansChannelId,
        config.logChannelId,
      ]).filter((channelId) => channelId !== config.categoryId);
      for (const channelId of channelIds) {
        await this.discordRequest(
          'DELETE',
          `/channels/${channelId}`,
          undefined,
          { auditReason, notFoundOk: true },
        );
        deletedChannels += 1;
      }
      if (config.categoryId) {
        await this.discordRequest(
          'DELETE',
          `/channels/${config.categoryId}`,
          undefined,
          { auditReason, notFoundOk: true },
        );
        deletedChannels += 1;
      }
    }

    if (options.deleteRoles && config.guildId) {
      const roleIds = await this.cleanupManagedRoleIds(config);
      for (const roleId of roleIds) {
        await this.discordRequest(
          'DELETE',
          `/guilds/${config.guildId}/roles/${roleId}`,
          undefined,
          { auditReason, notFoundOk: true },
        );
        deletedRoles += 1;
      }
    }

    await this.prisma.sessionDiscordConfig.update({
      where: { id: config.id },
      data: this.discordCleanupConfigData(config, options),
    });

    return {
      ok: true,
      sessionId: session.id,
      deletedChannels,
      deletedRoles,
    };
  }

  private async cleanupManagedRoleIds(config: SessionDiscordConfigRecord) {
    if (!config.guildId) {
      return [];
    }
    const roleFields = [
      { id: config.slotRoleId, name: config.slotRoleName },
      { id: config.waitlistRoleId, name: config.waitlistRoleName },
      { id: config.idpRoleId, name: config.idpRoleName },
      { id: config.bannedRoleId, name: config.bannedRoleName },
    ];
    const candidateIds = new Set(
      uniqueStrings(roleFields.map((field) => field.id)),
    );
    if (candidateIds.size === 0) {
      return [];
    }
    const sessionMarker = shortSessionId(config.sessionId);
    const roles = await this.getRoles(config.guildId);
    return roles
      .filter((role) => candidateIds.has(role.id))
      .filter((role) => {
        const configuredName =
          roleFields.find((field) => field.id === role.id)?.name?.trim() ?? '';
        const roleName = role.name.trim();
        return (
          roleName.includes(sessionMarker) ||
          roleName.startsWith('Arenzyra ') ||
          (configuredName.startsWith('Arenzyra ') &&
            roleName === configuredName)
        );
      })
      .map((role) => role.id);
  }

  private discordCleanupConfigData(
    config: SessionDiscordConfigRecord,
    options: CleanupSessionDiscordOptions,
  ): Prisma.SessionDiscordConfigUpdateInput {
    const data: Prisma.SessionDiscordConfigUpdateInput = {
      enabled: false,
    };
    if (options.deleteChannels) {
      Object.assign(data, {
        categoryId: null,
        registrationChannelId: null,
        slotListChannelId: null,
        waitlistChannelId: null,
        idpChannelId: null,
        managerChannelId: null,
        transferChannelId: null,
        manageChannelId: null,
        resultsChannelId: null,
        screenshotsChannelId: null,
        bansChannelId: null,
        logChannelId: null,
        emojis: this.emojisWithoutManagedMessageIds(config),
      });
    }
    if (options.deleteRoles) {
      Object.assign(data, {
        slotRoleId: null,
        waitlistRoleId: null,
        idpRoleId: null,
        bannedRoleId: null,
      });
    }
    return data;
  }

  private emojisWithoutManagedMessageIds(
    config: SessionDiscordConfigRecord,
  ): Prisma.InputJsonObject {
    const emojis: Record<string, Prisma.InputJsonValue | null> = {};
    if (
      config.emojis &&
      typeof config.emojis === 'object' &&
      !Array.isArray(config.emojis)
    ) {
      for (const [key, value] of Object.entries(config.emojis)) {
        emojis[key] = value as Prisma.InputJsonValue | null;
      }
    }
    for (const key of [
      'managedRegistrationPanelMessageId',
      'managedRegistrationStatusMessageId',
      'managedRegistrationStatusState',
      'managedRegistrationStatusSignature',
      'managedSlotListMessageId',
      'managedWaitlistMessageId',
      'managedWaitlistControlMessageId',
      'managedConfirmationMessageId',
    ]) {
      emojis[key] = '';
    }
    return emojis as Prisma.InputJsonObject;
  }

  private manualDiscordSyncKey(organizationId: string, sessionId: string) {
    return `${organizationId}:${sessionId}`;
  }

  private enqueueManualDiscordSync(
    organizationId: string,
    sessionId: string,
    actor: Actor,
  ) {
    const key = this.manualDiscordSyncKey(organizationId, sessionId);
    const existing = this.queuedManualDiscordSyncs.get(key);
    if (existing) {
      existing.actor = { ...actor };
      existing.rerun = true;
      return;
    }

    const sync = {
      actor: { ...actor },
      running: false,
      rerun: false,
      timer: null as NodeJS.Timeout | null,
    };
    sync.timer = setTimeout(() => {
      sync.timer = null;
      void this.runManualDiscordSync(key, sessionId);
    }, 100);
    sync.timer.unref?.();
    this.queuedManualDiscordSyncs.set(key, sync);
  }

  private async runManualDiscordSync(key: string, sessionId: string) {
    const sync = this.queuedManualDiscordSyncs.get(key);
    if (!sync || sync.running) {
      return;
    }

    sync.running = true;
    try {
      do {
        sync.rerun = false;
        await this.sync(sessionId, sync.actor);
      } while (sync.rerun);
    } catch (error) {
      console.warn(
        `[DiscordSync] queued manual sync failed session=${sessionId}: ${String(
          error,
        )}`,
      );
    } finally {
      this.queuedManualDiscordSyncs.delete(key);
    }
  }

  async queueSync(sessionId: string, actor: Actor) {
    const organizationId = this.requireOrg(actor);
    const session = await this.prisma.session.findFirst({
      where: {
        id: sessionId,
        organizationId,
        deletedAt: null,
      },
      select: {
        id: true,
        organizationId: true,
        discordConfig: true,
        organization: {
          select: {
            subscriptionStatus: true,
            trialEndsAt: true,
            paidUntil: true,
            discordConfig: {
              select: {
                guildId: true,
                maxSessionCount: true,
              },
            },
            discordGuilds: {
              where: { enabled: true },
              orderBy: [{ isPrimary: 'desc' }, { guildName: 'asc' }],
              select: {
                guildId: true,
                guildName: true,
                isPrimary: true,
              },
            },
          },
        },
      },
    });
    if (!session) {
      throw new NotFoundException('Session not found');
    }
    this.assertDiscordEntitlementActive(session.organization);

    const organizationGuildIds = [
      ...session.organization.discordGuilds.map((guild) =>
        guild.guildId.trim(),
      ),
      session.organization.discordConfig?.guildId?.trim() || '',
    ].filter((guildId, index, guildIds) => {
      return guildId.length > 0 && guildIds.indexOf(guildId) === index;
    });
    const config = session.discordConfig as SessionDiscordConfigRecord | null;
    const configGuildId = config?.guildId?.trim() || null;
    if (configGuildId && !organizationGuildIds.includes(configGuildId)) {
      throw new BadRequestException(
        'Session Discord guild must be connected to this organization',
      );
    }

    const guildId = configGuildId || organizationGuildIds[0] || null;
    if (!guildId) {
      throw new BadRequestException(
        'Connect a Discord server before syncing session channels',
      );
    }

    this.enqueueManualDiscordSync(organizationId, session.id, actor);

    return {
      ok: true,
      queued: true,
      sessionId: session.id,
      guildId,
      config: config ? this.normalizeConfig(config) : null,
    };
  }

  async sync(sessionId: string, actor: Actor) {
    const organizationId = this.requireOrg(actor);
    const session = await this.prisma.session.findFirst({
      where: {
        id: sessionId,
        organizationId,
        deletedAt: null,
      },
      select: {
        id: true,
        name: true,
        status: true,
        slotCount: true,
        registrationOpenAt: true,
        registrationCloseAt: true,
        organizationId: true,
        discordConfig: true,
        organization: {
          select: {
            subscriptionStatus: true,
            trialEndsAt: true,
            paidUntil: true,
            discordConfig: {
              select: {
                guildId: true,
                maxSessionCount: true,
              },
            },
            discordGuilds: {
              where: { enabled: true },
              orderBy: [{ isPrimary: 'desc' }, { guildName: 'asc' }],
              select: {
                guildId: true,
                guildName: true,
                isPrimary: true,
              },
            },
          },
        },
      },
    });
    if (!session) {
      throw new NotFoundException('Session not found');
    }
    this.assertDiscordEntitlementActive(session.organization);

    const config =
      session.discordConfig ??
      (await this.prisma.sessionDiscordConfig.create({
        data: {
          organizationId: session.organizationId,
          sessionId: session.id,
          enabled: true,
          registrationMode: 'SCRIM',
          startSlot: 3,
          normalSlots: Math.max(0, session.slotCount - 2),
          vipSlots: 0,
          maxManagersPerTeam: 2,
          maxTeamsPerManager: 1,
          registrationCommand: '%register',
          registrationFormat: '%register\nTeam Name\nTeam Tag\n@managers',
          disableSlotAndVipRegistration: false,
          slotTeamEmojiEnabled: true,
          downloadPlayerElims: true,
          emojis: this.defaultEmojis(),
        },
      }));

    const organizationGuildIds = [
      ...session.organization.discordGuilds.map((guild) =>
        guild.guildId.trim(),
      ),
      session.organization.discordConfig?.guildId?.trim() || '',
    ].filter((guildId, index, guildIds) => {
      return guildId.length > 0 && guildIds.indexOf(guildId) === index;
    });
    const primaryOrganizationGuildId = organizationGuildIds[0] ?? null;
    const configGuildId = config.guildId?.trim() || null;
    if (configGuildId && !organizationGuildIds.includes(configGuildId)) {
      throw new BadRequestException(
        'Session Discord guild must be connected to this organization',
      );
    }

    const guildId = configGuildId || primaryOrganizationGuildId;
    if (!guildId) {
      throw new BadRequestException(
        'Connect a Discord server before syncing session channels',
      );
    }

    await this.discordRequest('GET', `/guilds/${guildId}`);

    const registrations = await this.prisma.sessionRegistration.findMany({
      where: {
        organizationId: session.organizationId,
        sessionId: session.id,
        deletedAt: null,
        removedAt: null,
        status: {
          notIn: [
            SessionRegistrationStatus.REMOVED,
            SessionRegistrationStatus.DECLINED,
          ],
        },
      },
      select: {
        id: true,
        teamId: true,
        leaderDiscordUserId: true,
        managerDiscordUserIds: true,
        status: true,
        slotNumber: true,
        waitlistPosition: true,
        note: true,
        team: {
          select: {
            id: true,
            name: true,
            tag: true,
            logoUrl: true,
            members: {
              where: {
                leftAt: null,
                deletedAt: null,
              },
              select: {
                discordUserId: true,
                discordUsername: true,
                displayName: true,
                role: true,
              },
              orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
            },
          },
        },
      },
      orderBy: [
        { slotNumber: 'asc' },
        { waitlistPosition: 'asc' },
        { createdAt: 'asc' },
      ],
    });

    const setup = await this.ensureSetup({
      guildId,
      sessionId: session.id,
      sessionName: session.name,
      sessionStatus: session.status,
      registrationOpenAt: session.registrationOpenAt,
      registrationCloseAt: session.registrationCloseAt,
      config: config as SessionDiscordConfigRecord,
    });
    const roleSync = await this.syncAccessRoles({
      guildId,
      organizationId: session.organizationId,
      setup,
      registrations,
    });
    const validGuildMemberIds = await this.validGuildMemberIdsForSlotList(
      guildId,
      registrations,
    );
    const messageIds = await this.syncMessages({
      guildId,
      session,
      config: config as SessionDiscordConfigRecord,
      setup,
      registrations,
      validGuildMemberIds,
    });
    const latestConfig = await this.latestSessionDiscordConfig(
      session.id,
      config as SessionDiscordConfigRecord,
    );

    const updatedConfig = (await this.prisma.sessionDiscordConfig.update({
      where: { sessionId: session.id },
      data: {
        ...this.buildConfigUpdate(setup, guildId, latestConfig),
        emojis: this.emojisWithManagedMessageIds(
          latestConfig,
          messageIds,
          setup,
        ),
      },
    })) as SessionDiscordConfigRecord;

    return {
      ok: true,
      sessionId: session.id,
      guildId,
      categoryId: setup.category.id,
      channels: {
        registrationChannelId: setup.registrationChannel.id,
        slotListChannelId: setup.slotListChannel.id,
        waitlistChannelId: setup.waitlistChannel.id,
        idpChannelId: setup.idpChannel.id,
        transferChannelId: setup.transferChannel.id,
        manageChannelId: setup.manageChannel.id,
        resultsChannelId: setup.resultsChannel.id,
      },
      roles: {
        slotRoleId: setup.slotRole?.id ?? null,
        staffRoleId: setup.staffRole?.id ?? null,
        waitlistRoleId: setup.waitlistRole?.id ?? null,
        idpRoleId: setup.idpRole?.id ?? null,
        bannedRoleId: setup.bannedRole?.id ?? null,
      },
      roleSync,
      config: this.normalizeConfig(updatedConfig),
    };
  }
}
