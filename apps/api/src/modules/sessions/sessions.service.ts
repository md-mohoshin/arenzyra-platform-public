import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditAction,
  Prisma,
  Role,
  OrganizationStatus,
  SessionRegistrationStatus,
  SessionStatus,
  SessionType,
  TeamBanScope,
  TeamMemberRole,
  GameKey,
  PlayerSource,
} from '@prisma/client';
import type { AuthUser } from '../../common/auth/auth.types';
import { organizationHasActiveSubscription } from '../../common/org/launcher-license-state.util';
import { effectiveOrganizationId } from '../../common/org/org.util';
import { compareRankingRows } from '../../common/ranking-tiebreakers.util';
import { isPresentInMatch } from '../../common/results-presence.util';
import { PrismaService } from '../../db/prisma.service';
import {
  MatchesService,
  type SessionMatchCreatePayload,
} from '../matches/matches.service';
import { AdaptersService } from '../adapters/adapters.service';
import { AuditService } from '../audit/audit.service';
import { CreateSessionDto } from './dto/create-session.dto';
import { UpdateSessionDto } from './dto/update-session.dto';
import {
  RegisterSessionTeamDto,
  RegisterSessionTeamPlacement,
} from './dto/register-session-team.dto';
import { RemoveSessionRegistrationDto } from './dto/remove-session-registration.dto';
import { ResetSessionResultsDto } from './dto/reset-session-results.dto';
import { ListSessionRegistrationsDto } from './dto/list-session-registrations.dto';
import { UpdateDiscordChannelPauseDto } from './dto/update-discord-channel-pause.dto';
import { UpdateSessionDiscordConfigDto } from './dto/update-session-discord-config.dto';
import { defaultSlotCountForGame } from '../../common/game-rules.util';
import { assertOrganizationGameAccess } from '../../common/org/organization-plan.util';
import { buildQualificationSettingsData } from '../../common/qualification-settings.util';
import {
  SessionRegistrationPlacementAction,
  UpdateSessionRegistrationPlacementDto,
} from './dto/update-session-registration-placement.dto';
import {
  SessionRegistrationPlayStatusAction,
  UpdateSessionRegistrationPlayStatusDto,
} from './dto/update-session-registration-play-status.dto';
import { UpdateSessionRegistrationManagersDto } from './dto/update-session-registration-managers.dto';
import { syncMatchSlotsWithSessionRegistrations } from './session-match-slot-sync';

type Actor = AuthUser;

type TournamentRosterPlayerForTeam = {
  name: string;
  uid: string;
};

type ResultBackupPlayerSnapshot = {
  id: string;
  playerId: string | null;
  externalPlayerId: string | null;
  name: string;
  kills: number;
  knocks: number | null;
  assists: number | null;
  alive: boolean | null;
  isAlive: boolean | null;
  isKnocked: boolean | null;
  avatar: string | null;
};

const PLAY_STATUS_NOTE_PREFIX = 'ARENZYRA_PLAY_STATUS:';
const RESULT_BACKUP_RETENTION_DAYS = 30;
const DISCORD_SNOWFLAKE_PATTERN = /^\d{15,25}$/;
const DISCORD_CHANNEL_KINDS = new Set([
  'registration',
  'slot-list',
  'waitlist',
  'idp',
  'manager',
  'transfer',
  'manage',
  'results',
  'screenshots',
  'logos',
  'player-photos',
  'bans',
  'log',
]);
const DISCORD_TEXT_CHANNEL_NAME_FIELD_LABELS: Record<string, string> = {
  registrationChannelName: 'Registration',
  slotListChannelName: 'Slot List',
  waitlistChannelName: 'Waitlist',
  idpChannelName: 'IDP',
  managerChannelName: 'Manager Chat',
  transferChannelName: 'Transfer Roles',
  manageChannelName: 'Manage',
  resultsChannelName: 'Results',
  screenshotsChannelName: 'Screenshots',
  bansChannelName: 'Bans',
  logChannelName: 'Log',
};
const REGISTRATION_WEEKDAY_INDEX: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};
const REGISTRATION_WEEKDAY_LABELS: Record<string, string> = {
  sunday: 'Sunday',
  monday: 'Monday',
  tuesday: 'Tuesday',
  wednesday: 'Wednesday',
  thursday: 'Thursday',
  friday: 'Friday',
  saturday: 'Saturday',
};

type RegistrationTime = NonNullable<ReturnType<typeof parseRegistrationTime>>;
type WeeklyRegistrationEntry = {
  dayIndex: number;
  openTime: RegistrationTime;
  closeTime: RegistrationTime;
};
type RegistrationScheduleConfig = { emojis: unknown } | null | undefined;
type RegistrationWindowState = 'always_open' | 'not_open' | 'open' | 'closed';

type SessionResultResetSummary = {
  sessionId: string;
  organizationId: string;
  matchesRemoved: number;
  matchIds: string[];
  reason: string | null;
  resetAt: Date;
};

function safeDiscordTextChannelName(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90);
}

function registrationEmojiValue(
  config: RegistrationScheduleConfig,
  key: string,
) {
  const emojis =
    config?.emojis &&
    typeof config.emojis === 'object' &&
    !Array.isArray(config.emojis)
      ? (config.emojis as Record<string, unknown>)
      : {};
  const value = emojis[key];
  return typeof value === 'string' ? value.trim() : '';
}

function registrationScheduleWindow(
  config: RegistrationScheduleConfig,
  now = new Date(),
) {
  const schedule = parseWeeklyRegistrationSchedule(config);
  if (schedule.length > 0) {
    const overrideState = registrationScheduleOverrideState(config);
    if (overrideState) {
      return {
        configured: true,
        allowsAction: overrideState === 'open',
        state:
          overrideState === 'open'
            ? ('always_open' as RegistrationWindowState)
            : ('closed' as RegistrationWindowState),
      };
    }

    const timeZone = configuredRegistrationTimeZone(config);
    const currentParts = registrationZonedDateParts(now, timeZone);
    const intervals = weeklyRegistrationIntervals(
      schedule,
      timeZone,
      currentParts,
    );
    if (
      intervals.some(
        (interval) => interval.opensAt <= now && now < interval.closesAt,
      )
    ) {
      return {
        configured: true,
        allowsAction: true,
        state: 'open' as RegistrationWindowState,
      };
    }

    const nextInterval = intervals.find((interval) => interval.opensAt > now);
    return {
      configured: true,
      allowsAction: false,
      state:
        nextInterval &&
        isSameRegistrationZonedDate(
          nextInterval.opensAt,
          currentParts,
          timeZone,
        )
          ? ('not_open' as RegistrationWindowState)
          : ('closed' as RegistrationWindowState),
    };
  }

  const manualState = registrationManualState(config);
  if (manualState) {
    return {
      configured: true,
      allowsAction: manualState === 'open',
      state:
        manualState === 'open'
          ? ('always_open' as RegistrationWindowState)
          : ('closed' as RegistrationWindowState),
    };
  }

  return {
    configured: false,
    allowsAction: true,
    state: 'always_open' as RegistrationWindowState,
  };
}

function registrationManualState(config: RegistrationScheduleConfig) {
  const value = registrationEmojiValue(
    config,
    'registrationManualState',
  ).toLowerCase();
  return value === 'open' || value === 'closed' ? value : null;
}

function registrationScheduleOverrideState(config: RegistrationScheduleConfig) {
  const value = registrationEmojiValue(
    config,
    'registrationScheduleOverrideState',
  ).toLowerCase();
  return value === 'open' || value === 'closed' ? value : null;
}

function parseWeeklyRegistrationSchedule(config: RegistrationScheduleConfig) {
  const raw = registrationEmojiValue(config, 'registrationWeeklySchedule');
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
        const dayIndex = REGISTRATION_WEEKDAY_INDEX[dayKey.toLowerCase()];
        const day = dayValue as Record<string, unknown>;
        const enabled = day.enabled === true || day.enabled === 'true';
        const openTime = parseRegistrationTime(stringValue(day.open));
        const closeTime = parseRegistrationTime(stringValue(day.close));
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

function validateWeeklyRegistrationScheduleInput(
  raw: unknown,
  scheduleLabel = 'Registration',
) {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!text) {
    return false;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new BadRequestException(
      `${scheduleLabel} weekly schedule is invalid JSON`,
    );
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new BadRequestException(
      `${scheduleLabel} weekly schedule is invalid`,
    );
  }

  let hasConfiguredDay = false;
  for (const [dayKey, dayValue] of Object.entries(
    parsed as Record<string, unknown>,
  )) {
    if (!dayValue || typeof dayValue !== 'object' || Array.isArray(dayValue)) {
      continue;
    }
    const normalizedDay = dayKey.toLowerCase();
    const dayIndex = REGISTRATION_WEEKDAY_INDEX[normalizedDay];
    if (dayIndex === undefined) {
      continue;
    }

    const day = dayValue as Record<string, unknown>;
    const enabled = day.enabled === true || day.enabled === 'true';
    if (!enabled) {
      continue;
    }

    const dayLabel = REGISTRATION_WEEKDAY_LABELS[normalizedDay] ?? dayKey;
    const open = stringValue(day.open).trim();
    const close = stringValue(day.close).trim();
    if (!open || !close) {
      throw new BadRequestException(
        `${scheduleLabel} timing for ${dayLabel} needs both open and close time`,
      );
    }
    if (!parseRegistrationTime(open) || !parseRegistrationTime(close)) {
      throw new BadRequestException(
        `${scheduleLabel} timing for ${dayLabel} must use HH:mm format`,
      );
    }
    hasConfiguredDay = true;
  }

  return hasConfiguredDay;
}

function validateAccessDateWindowInput(
  emojis: Record<string, unknown>,
  enabledKey: string,
  opensKey: string,
  closesKey: string,
  label: string,
  options: { fallbackAllowed?: boolean } = {},
) {
  if (emojis[enabledKey] !== 'true' && emojis[enabledKey] !== true) {
    return;
  }

  const opensText = stringValue(emojis[opensKey]).trim();
  const closesText = stringValue(emojis[closesKey]).trim();
  if (!opensText || !closesText) {
    if (options.fallbackAllowed && !opensText && !closesText) {
      return;
    }
    throw new BadRequestException(
      `${label} schedule needs both open and close date/time`,
    );
  }

  const opensAt = new Date(opensText);
  const closesAt = new Date(closesText);
  if (Number.isNaN(opensAt.getTime()) || Number.isNaN(closesAt.getTime())) {
    throw new BadRequestException(
      `${label} schedule must use valid ISO date/time values`,
    );
  }
  if (opensAt >= closesAt) {
    throw new BadRequestException(
      `${label} close time must be after open time`,
    );
  }
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value : '';
}

function configuredRegistrationTimeZone(config: RegistrationScheduleConfig) {
  const timeZone =
    registrationEmojiValue(config, 'registrationTimeZone') || 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
    return timeZone;
  } catch {
    return 'UTC';
  }
}

function parseRegistrationTime(value?: string | null) {
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

function weeklyRegistrationIntervals(
  schedule: WeeklyRegistrationEntry[],
  timeZone: string,
  currentParts: ReturnType<typeof registrationZonedDateParts>,
) {
  const intervals: Array<{ opensAt: Date; closesAt: Date }> = [];
  for (let offset = -7; offset <= 14; offset += 1) {
    const openDate = shiftedRegistrationLocalDate(
      currentParts.year,
      currentParts.month,
      currentParts.day,
      offset,
    );
    for (const entry of schedule) {
      if (entry.dayIndex !== openDate.weekday) {
        continue;
      }
      const closeDate = shiftedRegistrationLocalDate(
        openDate.year,
        openDate.month,
        openDate.day,
        entry.closeTime.minutes <= entry.openTime.minutes ? 1 : 0,
      );
      intervals.push({
        opensAt: registrationZonedDateTimeToDate(
          timeZone,
          openDate.year,
          openDate.month,
          openDate.day,
          entry.openTime.hour,
          entry.openTime.minute,
        ),
        closesAt: registrationZonedDateTimeToDate(
          timeZone,
          closeDate.year,
          closeDate.month,
          closeDate.day,
          entry.closeTime.hour,
          entry.closeTime.minute,
        ),
      });
    }
  }
  return intervals.sort(
    (left, right) => left.opensAt.getTime() - right.opensAt.getTime(),
  );
}

function shiftedRegistrationLocalDate(
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

function isSameRegistrationZonedDate(
  date: Date,
  currentParts: ReturnType<typeof registrationZonedDateParts>,
  timeZone: string,
) {
  const parts = registrationZonedDateParts(date, timeZone);
  return (
    parts.year === currentParts.year &&
    parts.month === currentParts.month &&
    parts.day === currentParts.day
  );
}

function registrationZonedDateParts(date: Date, timeZone: string) {
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

function registrationZonedDateTimeToDate(
  timeZone: string,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
) {
  let guess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  for (let index = 0; index < 3; index += 1) {
    const parts = registrationZonedDateParts(guess, timeZone);
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

const sessionSelect = {
  id: true,
  organizationId: true,
  name: true,
  slug: true,
  type: true,
  status: true,
  description: true,
  logoUrl: true,
  bannerUrl: true,
  rulesetId: true,
  gameId: true,
  game: { select: { id: true, key: true, name: true, isEnabled: true } },
  adapterKey: true,
  maxTeams: true,
  slotCount: true,
  qualifiedTeamsCount: true,
  qualificationBubbleCount: true,
  qualificationLabel: true,
  waitlistEnabled: true,
  checkInEnabled: true,
  registrationOpenAt: true,
  registrationCloseAt: true,
  checkInOpenAt: true,
  checkInCloseAt: true,
  startsAt: true,
  endedAt: true,
  createdById: true,
  updatedById: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
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
} satisfies Prisma.SessionSelect;

const sessionRegistrationSelect = {
  id: true,
  organizationId: true,
  sessionId: true,
  teamId: true,
  leaderDiscordUserId: true,
  managerDiscordUserIds: true,
  tournamentRosterJson: true,
  status: true,
  slotNumber: true,
  waitlistPosition: true,
  checkedInAt: true,
  confirmedAt: true,
  removedAt: true,
  removalReason: true,
  note: true,
  registeredById: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
  team: {
    select: {
      id: true,
      name: true,
      tag: true,
      logoUrl: true,
      countryCode: true,
      region: true,
    },
  },
} satisfies Prisma.SessionRegistrationSelect;

type SessionRecord = Prisma.SessionGetPayload<{ select: typeof sessionSelect }>;
type SessionRegistrationRecord = Prisma.SessionRegistrationGetPayload<{
  select: typeof sessionRegistrationSelect;
}>;
type OrganizationDiscordGuild = {
  guildId: string | null;
  guildName: string | null;
  isPrimary?: boolean;
};
type OrganizationDiscordGuildLookup = {
  findUnique(args: {
    where: { organizationId: string };
    select: { guildId: true; guildName: true };
  }): Promise<OrganizationDiscordGuild | null>;
};
type OrganizationDiscordGuildLinkLookup = {
  findFirst(args: {
    where: {
      organizationId: string;
      guildId?: string;
      enabled?: true;
      organization?: { deletedAt?: null };
    };
    orderBy?: Array<Record<string, 'asc' | 'desc'>>;
    select: {
      guildId: true;
      guildName: true;
      isPrimary: true;
    };
  }): Promise<OrganizationDiscordGuild | null>;
};
type OrganizationDiscordStaffRoleDefaults = {
  staffRoleIds: Prisma.JsonValue | null;
};
type OrganizationDiscordStaffRoleDefaultsLookup = {
  findUnique(args: {
    where: { organizationId: string };
    select: { staffRoleIds: true };
  }): Promise<OrganizationDiscordStaffRoleDefaults | null>;
};
type OrganizationDiscordAccessRoleDefaults = {
  earlyAccessRoleId: string | null;
  earlyAccessRoleName: string | null;
  vipAccessRoleId: string | null;
  vipAccessRoleName: string | null;
};
type OrganizationDiscordAccessRoleDefaultsLookup = {
  findUnique(args: {
    where: { organizationId: string };
    select: {
      earlyAccessRoleId: true;
      earlyAccessRoleName: true;
      vipAccessRoleId: true;
      vipAccessRoleName: true;
    };
  }): Promise<OrganizationDiscordAccessRoleDefaults | null>;
};
type SessionCountLookup = {
  count?: (args: {
    where: {
      organizationId: string;
      type: SessionType;
      deletedAt: null;
      status?: { not: SessionStatus };
    };
  }) => Promise<number>;
};

const sessionDiscordConfigSelect = {
  id: true,
  organizationId: true,
  sessionId: true,
  enabled: true,
  registrationMode: true,
  guildId: true,
  categoryId: true,
  categoryName: true,
  registrationChannelId: true,
  registrationChannelName: true,
  slotListChannelId: true,
  slotListChannelName: true,
  waitlistChannelId: true,
  waitlistChannelName: true,
  idpChannelId: true,
  idpChannelName: true,
  managerChannelId: true,
  managerChannelName: true,
  transferChannelId: true,
  transferChannelName: true,
  manageChannelId: true,
  manageChannelName: true,
  resultsChannelId: true,
  resultsChannelName: true,
  screenshotsChannelId: true,
  screenshotsChannelName: true,
  bansChannelId: true,
  bansChannelName: true,
  logChannelId: true,
  logChannelName: true,
  slotRoleId: true,
  slotRoleName: true,
  waitlistRoleId: true,
  waitlistRoleName: true,
  idpRoleId: true,
  idpRoleName: true,
  bannedRoleId: true,
  bannedRoleName: true,
  registrationRoleIds: true,
  specialRegistrationRoleIds: true,
  manageRoleIds: true,
  vipRoleIds: true,
  startSlot: true,
  normalSlots: true,
  vipSlots: true,
  maxManagersPerTeam: true,
  maxTeamsPerManager: true,
  tournamentMainPlayersRequired: true,
  tournamentLogoRequired: true,
  registrationCommand: true,
  registrationFormat: true,
  disableSlotAndVipRegistration: true,
  slotTeamEmojiEnabled: true,
  downloadPlayerElims: true,
  spreadsheetId: true,
  importSourceOrganizationId: true,
  importSourceGuildId: true,
  importSourceGuildName: true,
  importSourceCategoryId: true,
  importSourceCategoryName: true,
  importSourceSlotListChannelId: true,
  importSourceSlotListChannelName: true,
  importSourceSyncEnabled: true,
  importSourceLastSyncedAt: true,
  importSourceLastError: true,
  emojis: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.SessionDiscordConfigSelect;

type SessionDiscordConfigRecord = Prisma.SessionDiscordConfigGetPayload<{
  select: typeof sessionDiscordConfigSelect;
}>;
type DiscordChannelKind =
  | 'registration'
  | 'slot-list'
  | 'waitlist'
  | 'idp'
  | 'manager'
  | 'transfer'
  | 'manage'
  | 'results'
  | 'screenshots'
  | 'logos'
  | 'player-photos'
  | 'bans'
  | 'log';

const activeSessionRegistrationSelect = {
  id: true,
  teamId: true,
  status: true,
  slotNumber: true,
  waitlistPosition: true,
  deletedAt: true,
  createdAt: true,
} satisfies Prisma.SessionRegistrationSelect;

type ActiveSessionRegistrationRecord = Prisma.SessionRegistrationGetPayload<{
  select: typeof activeSessionRegistrationSelect;
}>;

const RESERVED_LOBBY_SLOT_COUNT = 2;
const FIRST_ASSIGNABLE_SLOT = RESERVED_LOBBY_SLOT_COUNT + 1;

type SlotAssignmentRange = {
  startSlot: number;
  endSlot: number;
};

@Injectable()
export class SessionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly matches: MatchesService,
    private readonly adapters: AdaptersService,
    private readonly audit: AuditService,
  ) {}

  requireOrganizerRole(actor: Actor | null | undefined) {
    const role = actor?.actorRole ?? actor?.role ?? null;
    const actingOrg = actor?.actingOrgId ?? null;
    if (role === Role.SUPER_ADMIN) {
      if (!actingOrg) {
        throw new ForbiddenException(
          'Organization context missing for SUPER_ADMIN; impersonation required',
        );
      }
      return;
    }
    if (role !== Role.ORGANIZER) {
      throw new ForbiddenException('Organizer role required');
    }
  }

  private requireOrg(actor: Actor | null | undefined) {
    this.requireOrganizerRole(actor);
    const orgId = effectiveOrganizationId(actor);
    if (!orgId) {
      throw new ForbiddenException('organizationId is required');
    }
    return orgId;
  }

  private actorId(actor: Actor | null | undefined) {
    return actor?.actorId ?? actor?.id ?? null;
  }

  private async getDiscordEntitlement(organizationId: string) {
    const organization = await this.prisma.organization.findFirst({
      where: { id: organizationId, deletedAt: null },
      select: {
        subscriptionStatus: true,
        trialEndsAt: true,
        paidUntil: true,
        discordConfig: {
          select: {
            maxSessionCount: true,
          },
        },
      },
    });
    if (!organization) {
      return {
        maxSessionCount: 1,
        hasActiveSubscription: false,
      };
    }

    return {
      maxSessionCount: organization.discordConfig?.maxSessionCount ?? 1,
      hasActiveSubscription: organizationHasActiveSubscription(organization),
    };
  }

  private assertDiscordAccessNotExpired(entitlement: {
    hasActiveSubscription: boolean;
    maxSessionCount: number;
  }) {
    if (entitlement.maxSessionCount <= 0) {
      throw new ForbiddenException(
        'Discord session access is disabled for this organization',
      );
    }
    if (!entitlement.hasActiveSubscription) {
      throw new ForbiddenException(
        'Discord session access has expired for this organization',
      );
    }
  }

  private async assertDiscordSessionCreateAllowed(organizationId: string) {
    const entitlement = await this.getDiscordEntitlement(organizationId);
    this.assertDiscordAccessNotExpired(entitlement);

    const sessionDelegate = (
      this.prisma as unknown as { session?: SessionCountLookup }
    ).session;
    const activeScrimCount =
      typeof sessionDelegate?.count === 'function'
        ? await sessionDelegate.count({
            where: {
              organizationId,
              type: SessionType.SCRIM,
              deletedAt: null,
              status: { not: SessionStatus.ARCHIVED },
            },
          })
        : 0;
    if (activeScrimCount >= entitlement.maxSessionCount) {
      throw new ConflictException(
        `Discord session limit reached (${activeScrimCount}/${entitlement.maxSessionCount})`,
      );
    }
  }

  private async assertDiscordAutomationAllowed(organizationId: string) {
    this.assertDiscordAccessNotExpired(
      await this.getDiscordEntitlement(organizationId),
    );
  }

  private async disableSessionDiscordConfig(
    sessionId: string,
    organizationId: string,
    client: PrismaService | Prisma.TransactionClient = this.prisma,
  ) {
    await client.sessionDiscordConfig.updateMany({
      where: { sessionId, organizationId },
      data: { enabled: false },
    });
  }

  private async getOrganizationDiscordGuild(organizationId: string) {
    const guildDelegate = (
      this.prisma as unknown as {
        organizationDiscordGuild?: OrganizationDiscordGuildLinkLookup;
      }
    ).organizationDiscordGuild;
    if (guildDelegate?.findFirst) {
      const linkedGuild = await guildDelegate.findFirst({
        where: {
          organizationId,
          enabled: true,
          organization: { deletedAt: null },
        },
        orderBy: [{ isPrimary: 'desc' }, { guildName: 'asc' }],
        select: {
          guildId: true,
          guildName: true,
          isPrimary: true,
        },
      });
      if (linkedGuild?.guildId) {
        return linkedGuild;
      }
    }

    const delegate = (
      this.prisma as unknown as {
        organizationDiscordConfig?: OrganizationDiscordGuildLookup;
      }
    ).organizationDiscordConfig;
    if (!delegate?.findUnique) {
      return null;
    }

    return delegate.findUnique({
      where: { organizationId },
      select: {
        guildId: true,
        guildName: true,
      },
    });
  }

  private async getOrganizationDiscordGuildById(
    organizationId: string,
    guildId: string,
  ) {
    const guildDelegate = (
      this.prisma as unknown as {
        organizationDiscordGuild?: OrganizationDiscordGuildLinkLookup;
      }
    ).organizationDiscordGuild;
    if (guildDelegate?.findFirst) {
      const linkedGuild = await guildDelegate.findFirst({
        where: {
          organizationId,
          guildId,
          enabled: true,
          organization: { deletedAt: null },
        },
        select: {
          guildId: true,
          guildName: true,
          isPrimary: true,
        },
      });
      if (linkedGuild?.guildId) {
        return linkedGuild;
      }
    }

    const legacyGuild = await this.getOrganizationDiscordGuild(organizationId);
    return legacyGuild?.guildId === guildId ? legacyGuild : null;
  }

  private async getOrganizationStaffRoleDefaults(organizationId: string) {
    const delegate = (
      this.prisma as unknown as {
        organizationDiscordConfig?: OrganizationDiscordStaffRoleDefaultsLookup;
      }
    ).organizationDiscordConfig;
    if (!delegate?.findUnique) {
      return [];
    }

    const config = await delegate.findUnique({
      where: { organizationId },
      select: { staffRoleIds: true },
    });

    if (!Array.isArray(config?.staffRoleIds)) {
      return [];
    }

    return Array.from(
      new Set(
        config.staffRoleIds
          .map((roleId) =>
            typeof roleId === 'string' || typeof roleId === 'number'
              ? String(roleId).trim()
              : '',
          )
          .filter((roleId) => roleId.length > 0),
      ),
    );
  }

  private async getOrganizationAccessRoleDefaults(organizationId: string) {
    const delegate = (
      this.prisma as unknown as {
        organizationDiscordConfig?: OrganizationDiscordAccessRoleDefaultsLookup;
      }
    ).organizationDiscordConfig;
    if (!delegate?.findUnique) {
      return null;
    }

    return delegate.findUnique({
      where: { organizationId },
      select: {
        earlyAccessRoleId: true,
        earlyAccessRoleName: true,
        vipAccessRoleId: true,
        vipAccessRoleName: true,
      },
    });
  }

  private cleanString(value: string | null | undefined) {
    if (value === null || value === undefined) return null;
    const trimmed = `${value}`.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private cleanJsonString(value: unknown) {
    if (typeof value !== 'string' && typeof value !== 'number') return null;
    return this.cleanString(String(value));
  }

  private tournamentRosterPlayersForTeam(
    rosterJson: unknown,
  ): TournamentRosterPlayerForTeam[] {
    if (
      !rosterJson ||
      typeof rosterJson !== 'object' ||
      Array.isArray(rosterJson)
    ) {
      return [];
    }

    const roster = rosterJson as Record<string, unknown>;
    if (roster.type !== 'TOURNAMENT_ROSTER' || !Array.isArray(roster.players)) {
      return [];
    }

    const byUid = new Map<string, TournamentRosterPlayerForTeam>();
    for (const rawPlayer of roster.players) {
      if (
        !rawPlayer ||
        typeof rawPlayer !== 'object' ||
        Array.isArray(rawPlayer)
      ) {
        continue;
      }

      const player = rawPlayer as Record<string, unknown>;
      const name = this.cleanJsonString(player.name);
      const uid = this.cleanJsonString(player.uid)?.replace(/\s+/g, '');
      if (!name || !uid) continue;

      const uidKey = uid.toLowerCase();
      if (!byUid.has(uidKey)) {
        byUid.set(uidKey, { name, uid });
      }
    }

    return Array.from(byUid.values());
  }

  private async syncTournamentRosterPlayersToTeam(
    tx: Prisma.TransactionClient,
    organizationId: string,
    teamId: string,
    rosterJson: unknown,
  ) {
    const players = this.tournamentRosterPlayersForTeam(rosterJson);
    if (players.length === 0) return;

    for (const player of players) {
      const existingByExternalId = await tx.player.findFirst({
        where: {
          organizationId,
          externalPlayerId: player.uid,
          deletedAt: null,
        },
        select: { id: true },
      });
      const existing =
        existingByExternalId ??
        (await tx.player.findFirst({
          where: {
            organizationId,
            deletedAt: null,
            OR: [{ inGameId: player.uid }, { pubgPlayerId: player.uid }],
          },
          select: { id: true },
        }));

      const savedPlayer = existing
        ? await tx.player.update({
            where: { id: existing.id },
            data: {
              teamId,
              ign: player.name,
              inGameId: player.uid,
              pubgPlayerId: player.uid,
              externalPlayerId: player.uid,
              isActive: true,
            },
            select: { id: true },
          })
        : await tx.player.create({
            data: {
              organizationId,
              teamId,
              ign: player.name,
              inGameId: player.uid,
              pubgPlayerId: player.uid,
              externalPlayerId: player.uid,
              photoUrl: null,
              source: PlayerSource.MANUAL,
              isActive: true,
            },
            select: { id: true },
          });

      const activeRosterEntry = await tx.rosterEntry.findFirst({
        where: {
          teamId,
          playerId: savedPlayer.id,
          isActive: true,
        },
        select: { id: true },
      });

      if (!activeRosterEntry) {
        await tx.rosterEntry.create({
          data: {
            teamId,
            playerId: savedPlayer.id,
            startAt: new Date(),
            isActive: true,
          },
          select: { id: true },
        });
      }
    }
  }

  private cleanDiscordSnowflake(
    value: string | null | undefined,
    label: string,
  ) {
    const clean = this.cleanString(value);
    if (!clean || !DISCORD_SNOWFLAKE_PATTERN.test(clean)) {
      throw new BadRequestException(`${label} must be a Discord ID`);
    }
    return clean;
  }

  private stripRegistrationPlayStatusNote(note: string | null | undefined) {
    const source = note ?? '';
    const lines = source
      .split(/\r?\n/)
      .filter((line) => !line.startsWith(PLAY_STATUS_NOTE_PREFIX));
    const cleaned = lines.join('\n').trim();
    return cleaned.length > 0 ? cleaned : null;
  }

  private applyRegistrationPlayStatusNote(
    note: string | null | undefined,
    dto: UpdateSessionRegistrationPlayStatusDto,
  ) {
    const cleaned = this.stripRegistrationPlayStatusNote(note);
    if (dto.action === SessionRegistrationPlayStatusAction.CLEAR) {
      return cleaned;
    }

    const marker = `${PLAY_STATUS_NOTE_PREFIX}${JSON.stringify({
      status: dto.action,
      discordUserId: this.cleanString(dto.discordUserId),
      discordUsername: this.cleanString(dto.discordUsername),
      updatedAt: new Date().toISOString(),
    })}`;
    return cleaned ? `${cleaned}\n${marker}` : marker;
  }

  private cleanSlug(value: string | null | undefined) {
    const trimmed = this.cleanString(value);
    return trimmed ? trimmed.toLowerCase() : null;
  }

  private async resolveGameKey(gameId: string | null | undefined) {
    const normalizedGameId = this.cleanString(gameId);
    if (!normalizedGameId) return null;
    const game = await this.prisma.game.findUnique({
      where: { id: normalizedGameId },
      select: { key: true },
    });
    if (!game) {
      throw new BadRequestException(`Invalid gameId: ${normalizedGameId}`);
    }
    return game.key;
  }

  private normalizeGameKey(input: string | null | undefined) {
    const trimmed = this.cleanString(input);
    if (!trimmed) return null;
    const normalized = trimmed.toUpperCase();
    if (!Object.values(GameKey).includes(normalized as GameKey)) {
      throw new BadRequestException(
        `gameKey must be one of ${Object.values(GameKey).join(', ')}`,
      );
    }
    return normalized as GameKey;
  }

  private async resolveGameId(
    gameId: string | null | undefined,
    gameKey: string | null | undefined,
  ) {
    const normalizedGameId = this.cleanString(gameId);
    const normalizedGameKey = this.normalizeGameKey(gameKey);
    const byId = normalizedGameId
      ? await this.prisma.game.findUnique({
          where: { id: normalizedGameId },
          select: { id: true, key: true },
        })
      : null;

    if (normalizedGameId && !byId) {
      throw new BadRequestException(`Invalid gameId: ${normalizedGameId}`);
    }
    if (byId && normalizedGameKey && byId.key !== normalizedGameKey) {
      throw new BadRequestException(
        `gameId ${byId.id} does not match gameKey ${normalizedGameKey}`,
      );
    }
    if (byId) return byId.id;
    if (!normalizedGameKey) return null;

    const byKey = await this.prisma.game.findUnique({
      where: { key: normalizedGameKey },
      select: { id: true },
    });
    if (!byKey) {
      throw new BadRequestException(
        `No Game record found for gameKey ${normalizedGameKey}`,
      );
    }
    return byKey.id;
  }

  private async validateAdapterKey(
    adapterKey: string | null | undefined,
    gameId: string | null | undefined,
  ) {
    const normalizedAdapterKey = this.cleanString(adapterKey);
    const gameKey = await this.resolveGameKey(gameId);
    if (!normalizedAdapterKey) return null;
    const adapter = this.adapters.getAdapterByKey(normalizedAdapterKey);
    if (!adapter) {
      throw new BadRequestException(
        `Unknown adapterKey: ${normalizedAdapterKey}`,
      );
    }
    if (!gameKey) {
      throw new BadRequestException(
        'gameId is required when adapterKey is provided',
      );
    }
    if (adapter.gameKey !== gameKey) {
      throw new BadRequestException(
        `adapterKey ${adapter.key} is not valid for gameKey ${gameKey}`,
      );
    }
    return adapter.key;
  }

  private parseDate(
    field: string,
    value: string | null | undefined,
  ): Date | null | undefined {
    if (value === undefined) return undefined;
    const trimmed = this.cleanString(value);
    if (!trimmed) return null;
    const parsed = new Date(trimmed);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException(`${field} must be a valid date`);
    }
    return parsed;
  }

  private validateCapacity(maxTeams: number, slotCount: number) {
    if (!Number.isInteger(maxTeams) || maxTeams < 1) {
      throw new BadRequestException('maxTeams must be a positive integer');
    }
    if (!Number.isInteger(slotCount) || slotCount < 1) {
      throw new BadRequestException('slotCount must be a positive integer');
    }
    if (slotCount > maxTeams) {
      throw new BadRequestException('slotCount cannot exceed maxTeams');
    }
  }

  private validateDateRange(
    start: Date | null | undefined,
    end: Date | null | undefined,
    startLabel: string,
    endLabel: string,
  ) {
    if (start && end && start > end) {
      throw new BadRequestException(`${endLabel} must be after ${startLabel}`);
    }
  }

  private async assertRegistrationWindowOpen(
    session: Pick<
      SessionRecord,
      'id' | 'registrationOpenAt' | 'registrationCloseAt'
    >,
    client: {
      sessionDiscordConfig: {
        findUnique(args: {
          where: { sessionId: string };
          select: { emojis: true };
        }): Promise<{ emojis: unknown } | null>;
      };
    },
    now = new Date(),
  ) {
    const config = await client.sessionDiscordConfig.findUnique({
      where: { sessionId: session.id },
      select: { emojis: true },
    });
    const scheduledWindow = registrationScheduleWindow(config, now);
    if (scheduledWindow.configured) {
      if (scheduledWindow.allowsAction) {
        return;
      }
      throw new BadRequestException(
        scheduledWindow.state === 'not_open'
          ? 'Registration is not open yet'
          : 'Registration is closed',
      );
    }

    if (session.registrationOpenAt && now < session.registrationOpenAt) {
      throw new BadRequestException('Registration is not open yet');
    }
    if (session.registrationCloseAt && now >= session.registrationCloseAt) {
      throw new BadRequestException('Registration is closed');
    }
  }

  private buildSessionResponse(
    session: SessionRecord,
    counts: {
      confirmedCount: number;
      waitlistCount: number;
      totalRegisteredCount: number;
    },
  ) {
    const discordSourceSyncEnabled =
      session.discordConfig?.importSourceSyncEnabled === true;
    const discordCategoryId = discordSourceSyncEnabled
      ? session.discordConfig?.importSourceCategoryId
      : session.discordConfig?.categoryId;
    const discordGuildId = discordSourceSyncEnabled
      ? session.discordConfig?.importSourceGuildId
      : session.discordConfig?.guildId;
    const discordSlotListChannelId = discordSourceSyncEnabled
      ? session.discordConfig?.importSourceSlotListChannelId
      : session.discordConfig?.slotListChannelId;

    return {
      id: session.id,
      name: session.name,
      slug: session.slug,
      type: session.type,
      status: session.status,
      description: session.description,
      logoUrl: session.logoUrl,
      bannerUrl: session.bannerUrl,
      rulesetId: session.rulesetId,
      gameId: session.gameId,
      game: session.game,
      adapterKey: session.adapterKey,
      maxTeams: session.maxTeams,
      slotCount: session.slotCount,
      qualifiedTeamsCount: session.qualifiedTeamsCount,
      qualificationBubbleCount: session.qualificationBubbleCount,
      qualificationLabel: session.qualificationLabel,
      waitlistEnabled: session.waitlistEnabled,
      checkInEnabled: session.checkInEnabled,
      registrationOpenAt: session.registrationOpenAt,
      registrationCloseAt: session.registrationCloseAt,
      checkInOpenAt: session.checkInOpenAt,
      checkInCloseAt: session.checkInCloseAt,
      startsAt: session.startsAt,
      endedAt: session.endedAt,
      createdById: session.createdById,
      updatedById: session.updatedById,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      importSource: discordCategoryId
        ? {
            type: 'discord',
            guildId: discordGuildId ?? null,
            categoryId: discordCategoryId,
            slotListChannelId: discordSlotListChannelId ?? null,
            readOnlySource: discordSourceSyncEnabled,
          }
        : null,
      counts,
    };
  }

  private buildRegistrationResponse(registration: SessionRegistrationRecord) {
    return {
      id: registration.id,
      teamId: registration.teamId,
      leaderDiscordUserId: registration.leaderDiscordUserId,
      managerDiscordUserIds: registration.managerDiscordUserIds,
      tournamentRosterJson: registration.tournamentRosterJson,
      status: registration.status,
      slotNumber: registration.slotNumber,
      waitlistPosition: registration.waitlistPosition,
      checkedInAt: registration.checkedInAt,
      confirmedAt: registration.confirmedAt,
      removedAt: registration.removedAt,
      removalReason: registration.removalReason,
      note: registration.note,
      createdAt: registration.createdAt,
      updatedAt: registration.updatedAt,
      team: registration.team
        ? {
            id: registration.team.id,
            name: registration.team.name,
            tag: registration.team.tag,
            logoUrl: registration.team.logoUrl,
            countryCode: registration.team.countryCode,
            region: registration.team.region,
          }
        : null,
    };
  }

  private buildDiscordConfigResponse(
    config: SessionDiscordConfigRecord,
    accessRoles?: OrganizationDiscordAccessRoleDefaults | null,
  ) {
    return {
      ...config,
      earlyAccessRoleId: accessRoles?.earlyAccessRoleId ?? null,
      earlyAccessRoleName: accessRoles?.earlyAccessRoleName ?? null,
      vipAccessRoleId: accessRoles?.vipAccessRoleId ?? null,
      vipAccessRoleName: accessRoles?.vipAccessRoleName ?? null,
      registrationRoleIds: Array.isArray(config.registrationRoleIds)
        ? config.registrationRoleIds
        : [],
      specialRegistrationRoleIds: Array.isArray(
        config.specialRegistrationRoleIds,
      )
        ? config.specialRegistrationRoleIds
        : [],
      manageRoleIds: Array.isArray(config.manageRoleIds)
        ? config.manageRoleIds
        : [],
      vipRoleIds: Array.isArray(config.vipRoleIds) ? config.vipRoleIds : [],
      emojis:
        config.emojis &&
        typeof config.emojis === 'object' &&
        !Array.isArray(config.emojis)
          ? {
              ...this.defaultDiscordEmojis(),
              ...(config.emojis as Record<string, unknown>),
            }
          : this.defaultDiscordEmojis(),
    };
  }

  private discordChannelKind(
    config: Pick<
      SessionDiscordConfigRecord,
      | 'registrationChannelId'
      | 'slotListChannelId'
      | 'waitlistChannelId'
      | 'idpChannelId'
      | 'managerChannelId'
      | 'transferChannelId'
      | 'manageChannelId'
      | 'resultsChannelId'
      | 'screenshotsChannelId'
      | 'bansChannelId'
      | 'logChannelId'
      | 'emojis'
    >,
    channelId: string,
  ): DiscordChannelKind | null {
    const channelMap: Array<[DiscordChannelKind, string | null]> = [
      ['registration', config.registrationChannelId],
      ['slot-list', config.slotListChannelId],
      ['waitlist', config.waitlistChannelId],
      ['idp', config.idpChannelId],
      ['manager', config.managerChannelId],
      ['transfer', config.transferChannelId],
      ['manage', config.manageChannelId],
      ['results', config.resultsChannelId],
      ['screenshots', config.screenshotsChannelId],
      ['bans', config.bansChannelId],
      ['log', config.logChannelId],
    ];
    const directMatch = channelMap.find(([, id]) => id === channelId)?.[0];
    if (directMatch) {
      return directMatch;
    }

    if (this.configuredLogoChannelIds(config).includes(channelId)) {
      return 'logos';
    }

    return this.configuredPlayerPhotoChannelIds(config).includes(channelId)
      ? 'player-photos'
      : null;
  }

  private configuredLogoChannelIds(
    config: Pick<SessionDiscordConfigRecord, 'emojis'> | null | undefined,
  ) {
    const emojis =
      config?.emojis &&
      typeof config.emojis === 'object' &&
      !Array.isArray(config.emojis)
        ? (config.emojis as Record<string, unknown>)
        : {};
    const raw = [emojis.discordLogoChannelIds, emojis.logoChannelIds]
      .filter((value): value is string => typeof value === 'string')
      .join('\n');
    return this.discordSnowflakeIdsFromText(raw);
  }

  private configuredPlayerPhotoChannelIds(
    config: Pick<SessionDiscordConfigRecord, 'emojis'> | null | undefined,
  ) {
    const emojis =
      config?.emojis &&
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
    return this.discordSnowflakeIdsFromText(raw);
  }

  private discordSnowflakeIdsFromText(value: unknown) {
    if (typeof value !== 'string') {
      return [];
    }
    return [...new Set(value.match(/\d{15,25}/g) ?? [])];
  }

  private defaultDiscordEmojis() {
    return {
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
      earlyAccessCloseMessageText:
        'Early registration is closed for {session}.',
      vipAccessEnabled: 'false',
      vipAccessWeeklySchedule: '',
      vipAccessTimeZone: '',
      vipAccessOpensAt: '',
      vipAccessClosesAt: '',
      vipAccessMessageEnabled: 'true',
      vipAccessOpenMessageText:
        '{role} VIP registration is open for {session}.',
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
      discordAutoCreateRoles: 'false',
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
    };
  }

  private async buildDiscordConfigDefaults(
    session: Pick<SessionRecord, 'id' | 'organizationId' | 'slotCount'>,
  ): Promise<Prisma.SessionDiscordConfigUncheckedCreateInput> {
    const [manageRoleIds, organizationGuild] = await Promise.all([
      this.getOrganizationStaffRoleDefaults(session.organizationId),
      this.getOrganizationDiscordGuild(session.organizationId),
    ]);

    return {
      organizationId: session.organizationId,
      sessionId: session.id,
      enabled: true,
      registrationMode: 'SCRIM',
      guildId: this.cleanString(organizationGuild?.guildId),
      startSlot: FIRST_ASSIGNABLE_SLOT,
      normalSlots: Math.max(0, session.slotCount - FIRST_ASSIGNABLE_SLOT + 1),
      vipSlots: 0,
      maxManagersPerTeam: 2,
      maxTeamsPerManager: 1,
      tournamentMainPlayersRequired: 4,
      tournamentLogoRequired: false,
      registrationCommand: '%register',
      registrationFormat: '%register\nTeam Name\nTeam Tag\n@managers',
      disableSlotAndVipRegistration: false,
      slotTeamEmojiEnabled: true,
      downloadPlayerElims: true,
      manageRoleIds,
      emojis: this.defaultDiscordEmojis(),
    };
  }

  private normalizeDiscordConfigDto(
    dto: UpdateSessionDiscordConfigDto,
  ): Prisma.SessionDiscordConfigUncheckedUpdateInput {
    const data: Prisma.SessionDiscordConfigUncheckedUpdateInput = {};
    const mutableData = data as Record<string, unknown>;
    if (dto.registrationMode !== undefined) {
      const registrationMode = String(dto.registrationMode)
        .trim()
        .toUpperCase();
      if (
        registrationMode !== 'SCRIM' &&
        registrationMode !== 'EVENT' &&
        registrationMode !== 'TOURNAMENT'
      ) {
        throw new BadRequestException(
          'registrationMode must be SCRIM, EVENT, or TOURNAMENT',
        );
      }
      mutableData.registrationMode = registrationMode;
    }

    const stringFields = [
      'guildId',
      'categoryId',
      'categoryName',
      'registrationChannelId',
      'registrationChannelName',
      'slotListChannelId',
      'slotListChannelName',
      'waitlistChannelId',
      'waitlistChannelName',
      'idpChannelId',
      'idpChannelName',
      'managerChannelId',
      'managerChannelName',
      'transferChannelId',
      'transferChannelName',
      'manageChannelId',
      'manageChannelName',
      'resultsChannelId',
      'resultsChannelName',
      'screenshotsChannelId',
      'screenshotsChannelName',
      'bansChannelId',
      'bansChannelName',
      'logChannelId',
      'logChannelName',
      'slotRoleId',
      'slotRoleName',
      'waitlistRoleId',
      'waitlistRoleName',
      'idpRoleId',
      'idpRoleName',
      'bannedRoleId',
      'bannedRoleName',
      'registrationCommand',
      'registrationFormat',
      'spreadsheetId',
      'notes',
    ] as const;
    const numberFields = [
      'startSlot',
      'normalSlots',
      'vipSlots',
      'maxManagersPerTeam',
      'maxTeamsPerManager',
      'tournamentMainPlayersRequired',
    ] as const;
    const booleanFields = [
      'disableSlotAndVipRegistration',
      'slotTeamEmojiEnabled',
      'downloadPlayerElims',
      'tournamentLogoRequired',
    ] as const;
    const jsonFields = [
      'registrationRoleIds',
      'specialRegistrationRoleIds',
      'manageRoleIds',
      'vipRoleIds',
    ] as const;

    for (const field of stringFields) {
      if (dto[field] !== undefined) {
        const value = this.cleanString(dto[field]);
        const channelLabel = DISCORD_TEXT_CHANNEL_NAME_FIELD_LABELS[field];
        if (value && channelLabel && !safeDiscordTextChannelName(value)) {
          throw new BadRequestException(
            `${channelLabel} channel name must include at least one letter or number, or be left blank to use the default.`,
          );
        }
        mutableData[field] = value;
      }
    }

    const unifiedSlotRoleId =
      dto.slotRoleId !== undefined
        ? this.cleanString(dto.slotRoleId)
        : dto.idpRoleId !== undefined
          ? this.cleanString(dto.idpRoleId)
          : undefined;
    if (unifiedSlotRoleId !== undefined) {
      mutableData.slotRoleId = unifiedSlotRoleId;
      mutableData.idpRoleId = unifiedSlotRoleId;
    }

    const unifiedSlotRoleName =
      dto.slotRoleName !== undefined
        ? this.cleanString(dto.slotRoleName)
        : dto.idpRoleName !== undefined
          ? this.cleanString(dto.idpRoleName)
          : undefined;
    if (unifiedSlotRoleName !== undefined) {
      mutableData.slotRoleName = unifiedSlotRoleName;
      mutableData.idpRoleName = unifiedSlotRoleName;
    }

    for (const field of numberFields) {
      if (dto[field] !== undefined) {
        mutableData[field] = dto[field];
      }
    }

    for (const field of booleanFields) {
      if (dto[field] !== undefined) {
        mutableData[field] = dto[field];
      }
    }

    for (const field of jsonFields) {
      if (dto[field] !== undefined) {
        mutableData[field] =
          dto[field] === null
            ? Prisma.DbNull
            : (dto[field] as Prisma.InputJsonValue);
      }
    }

    if (dto.emojis !== undefined) {
      if (dto.emojis === null) {
        mutableData.emojis = Prisma.DbNull;
      } else {
        const emojis = { ...dto.emojis };
        const hasRegistrationSchedule = validateWeeklyRegistrationScheduleInput(
          emojis.registrationWeeklySchedule,
        );
        if (hasRegistrationSchedule) {
          emojis.registrationManualState = '';
        }
        const hasWaitlistPromotionSchedule =
          validateWeeklyRegistrationScheduleInput(
            emojis.waitlistPromotionWeeklySchedule,
            'Waitlist promotion',
          );
        if (hasWaitlistPromotionSchedule) {
          emojis.waitlistPromotionManualState = '';
        }
        const hasEarlyAccessSchedule = validateWeeklyRegistrationScheduleInput(
          emojis.earlyAccessWeeklySchedule,
          'Early access',
        );
        const hasVipAccessSchedule = validateWeeklyRegistrationScheduleInput(
          emojis.vipAccessWeeklySchedule,
          'VIP access',
        );
        validateAccessDateWindowInput(
          emojis,
          'earlyAccessEnabled',
          'earlyAccessOpensAt',
          'earlyAccessClosesAt',
          'Early access',
          { fallbackAllowed: hasEarlyAccessSchedule },
        );
        validateAccessDateWindowInput(
          emojis,
          'vipAccessEnabled',
          'vipAccessOpensAt',
          'vipAccessClosesAt',
          'VIP access',
          { fallbackAllowed: hasVipAccessSchedule },
        );
        mutableData.emojis = emojis as Prisma.InputJsonValue;
      }
    }

    const startSlot = dto.startSlot;
    const normalSlots = dto.normalSlots;
    const vipSlots = dto.vipSlots;
    if (startSlot !== undefined && startSlot < FIRST_ASSIGNABLE_SLOT) {
      throw new BadRequestException(
        `startSlot must be ${FIRST_ASSIGNABLE_SLOT} or greater`,
      );
    }
    if (normalSlots !== undefined && normalSlots < 1) {
      throw new BadRequestException('normalSlots must be at least 1');
    }
    if (vipSlots !== undefined && vipSlots < 0) {
      throw new BadRequestException('vipSlots cannot be negative');
    }
    if (
      dto.tournamentMainPlayersRequired !== undefined &&
      (dto.tournamentMainPlayersRequired < 2 ||
        dto.tournamentMainPlayersRequired > 4)
    ) {
      throw new BadRequestException(
        'tournamentMainPlayersRequired must be between 2 and 4',
      );
    }

    return data;
  }

  private hasDiscordGuildScopedConfig(dto: UpdateSessionDiscordConfigDto) {
    const guildScopedFields = [
      'guildId',
      'categoryId',
      'registrationChannelId',
      'slotListChannelId',
      'waitlistChannelId',
      'idpChannelId',
      'managerChannelId',
      'transferChannelId',
      'manageChannelId',
      'resultsChannelId',
      'screenshotsChannelId',
      'bansChannelId',
      'logChannelId',
      'slotRoleId',
      'waitlistRoleId',
      'idpRoleId',
      'bannedRoleId',
      'registrationRoleIds',
      'specialRegistrationRoleIds',
      'manageRoleIds',
      'vipRoleIds',
    ] as const;

    return guildScopedFields.some((field) => {
      const value = dto[field];
      if (value === undefined || value === null) {
        return false;
      }
      if (Array.isArray(value)) {
        return value.some((entry) => Boolean(this.cleanString(entry)));
      }
      if (typeof value === 'string') {
        return Boolean(this.cleanString(value));
      }
      return true;
    });
  }

  private async assertDiscordConfigGuildMatchesOrganization(
    organizationId: string,
    dto: UpdateSessionDiscordConfigDto,
    existing: Pick<SessionDiscordConfigRecord, 'guildId'> | null,
  ) {
    const requestedGuildId =
      dto.guildId !== undefined ? this.cleanString(dto.guildId) : undefined;
    const effectiveGuildId =
      requestedGuildId !== undefined
        ? requestedGuildId
        : this.cleanString(existing?.guildId);

    if (!this.hasDiscordGuildScopedConfig(dto) && !effectiveGuildId) {
      return;
    }

    const organizationGuild = effectiveGuildId
      ? await this.getOrganizationDiscordGuildById(
          organizationId,
          effectiveGuildId,
        )
      : await this.getOrganizationDiscordGuild(organizationId);
    const linkedGuildId = this.cleanString(organizationGuild?.guildId);

    if (effectiveGuildId && !linkedGuildId) {
      throw new BadRequestException(
        'Session Discord guild must be connected to this organization',
      );
    }

    if (!linkedGuildId) {
      throw new BadRequestException(
        'Connect this organization to Discord before setting session channels or roles',
      );
    }
  }

  private async getSessionCounts(
    sessionIds: string[],
    client: PrismaService | Prisma.TransactionClient = this.prisma,
  ) {
    const counts = new Map<
      string,
      {
        confirmedCount: number;
        waitlistCount: number;
        totalRegisteredCount: number;
      }
    >();
    if (sessionIds.length === 0) return counts;

    for (const sessionId of sessionIds) {
      counts.set(sessionId, {
        confirmedCount: 0,
        waitlistCount: 0,
        totalRegisteredCount: 0,
      });
    }

    const rows = await client.sessionRegistration.findMany({
      where: {
        sessionId: { in: sessionIds },
        deletedAt: null,
      },
      select: {
        sessionId: true,
        slotNumber: true,
        waitlistPosition: true,
      },
    });

    for (const row of rows) {
      const entry = counts.get(row.sessionId);
      if (!entry) continue;
      entry.totalRegisteredCount += 1;
      if (row.slotNumber !== null) {
        entry.confirmedCount += 1;
      } else if (row.waitlistPosition !== null) {
        entry.waitlistCount += 1;
      }
    }

    return counts;
  }

  private async getSessionOrThrow(
    sessionId: string,
    actor: Actor,
    client: PrismaService | Prisma.TransactionClient = this.prisma,
  ) {
    const organizationId = this.requireOrg(actor);
    const session = await client.session.findFirst({
      where: {
        id: sessionId,
        organizationId,
        deletedAt: null,
      },
      select: sessionSelect,
    });
    if (!session) {
      throw new NotFoundException('Session not found');
    }
    return session;
  }

  private async getMutableSessionOrThrow(
    tx: Prisma.TransactionClient,
    sessionId: string,
    organizationId: string,
  ) {
    const session = await tx.session.findFirst({
      where: {
        id: sessionId,
        organizationId,
        deletedAt: null,
      },
      select: sessionSelect,
    });
    if (!session) {
      throw new NotFoundException('Session not found');
    }
    return session;
  }

  private async lockSessionRow(
    tx: Prisma.TransactionClient,
    sessionId: string,
  ) {
    await tx.$queryRaw`SELECT "id" FROM "Session" WHERE "id" = ${sessionId} FOR UPDATE`;
  }

  private async listActiveRegistrations(
    tx: Prisma.TransactionClient,
    sessionId: string,
  ): Promise<ActiveSessionRegistrationRecord[]> {
    return tx.sessionRegistration.findMany({
      where: {
        sessionId,
        deletedAt: null,
      },
      select: activeSessionRegistrationSelect,
      orderBy: [
        { slotNumber: 'asc' },
        { waitlistPosition: 'asc' },
        { createdAt: 'asc' },
      ],
    });
  }

  private assertActiveRegistrationConsistency(
    session: Pick<SessionRecord, 'id' | 'slotCount'>,
    registrations: ActiveSessionRegistrationRecord[],
    opts: { requireCompactWaitlist?: boolean } = {},
  ) {
    const requireCompactWaitlist = opts.requireCompactWaitlist ?? true;
    const slotAssignments = new Map<number, string>();
    const waitlistAssignments = new Map<number, string>();
    const confirmedStatuses = new Set<SessionRegistrationStatus>([
      SessionRegistrationStatus.CONFIRMED,
      SessionRegistrationStatus.CHECKED_IN,
    ]);
    const terminalStatuses = new Set<SessionRegistrationStatus>([
      SessionRegistrationStatus.REMOVED,
      SessionRegistrationStatus.DECLINED,
    ]);

    for (const registration of registrations) {
      if (registration.deletedAt !== null) {
        throw new ConflictException(
          'Session registration set is inconsistent; retry the request',
        );
      }
      if (terminalStatuses.has(registration.status)) {
        throw new ConflictException(
          'Session registration set contains a terminal active record',
        );
      }
      if (
        registration.slotNumber !== null &&
        registration.waitlistPosition !== null
      ) {
        throw new ConflictException(
          'Session registration cannot have both slot and waitlist placement',
        );
      }
      if (
        registration.slotNumber !== null &&
        !confirmedStatuses.has(registration.status)
      ) {
        throw new ConflictException(
          'Only confirmed or checked-in registrations may hold lobby slots',
        );
      }
      if (
        registration.status === SessionRegistrationStatus.WAITLIST &&
        registration.waitlistPosition === null
      ) {
        throw new ConflictException(
          'Waitlisted registrations must have a waitlist position',
        );
      }
      if (
        confirmedStatuses.has(registration.status) &&
        registration.slotNumber === null
      ) {
        throw new ConflictException(
          'Confirmed registrations must have a slot assignment',
        );
      }

      if (registration.slotNumber !== null) {
        if (
          !Number.isInteger(registration.slotNumber) ||
          registration.slotNumber < 1 ||
          registration.slotNumber > session.slotCount
        ) {
          throw new ConflictException(
            'Session registration slot assignment is out of range',
          );
        }
        const existing = slotAssignments.get(registration.slotNumber);
        if (existing) {
          throw new ConflictException(
            'Duplicate active session slot assignment detected',
          );
        }
        slotAssignments.set(registration.slotNumber, registration.id);
      }

      if (registration.waitlistPosition !== null) {
        if (
          !Number.isInteger(registration.waitlistPosition) ||
          registration.waitlistPosition < 1
        ) {
          throw new ConflictException(
            'Session waitlist position must be a positive integer',
          );
        }
        const existing = waitlistAssignments.get(registration.waitlistPosition);
        if (existing) {
          throw new ConflictException(
            'Duplicate active session waitlist position detected',
          );
        }
        waitlistAssignments.set(registration.waitlistPosition, registration.id);
      }
    }

    const waitlist = registrations
      .filter(
        (registration) => typeof registration.waitlistPosition === 'number',
      )
      .sort((left, right) => {
        const positionDelta =
          (left.waitlistPosition ?? Number.MAX_SAFE_INTEGER) -
          (right.waitlistPosition ?? Number.MAX_SAFE_INTEGER);
        if (positionDelta !== 0) {
          return positionDelta;
        }
        return left.createdAt.getTime() - right.createdAt.getTime();
      });

    if (requireCompactWaitlist) {
      for (const [index, registration] of waitlist.entries()) {
        if (registration.waitlistPosition !== index + 1) {
          throw new ConflictException(
            'Session waitlist ordering is inconsistent; retry the request',
          );
        }
      }
    }
  }

  private async loadConsistentActiveRegistrations(
    tx: Prisma.TransactionClient,
    session: Pick<SessionRecord, 'id' | 'slotCount'>,
  ) {
    const current = await this.listActiveRegistrations(tx, session.id);
    this.assertActiveRegistrationConsistency(session, current, {
      requireCompactWaitlist: false,
    });
    await this.repackWaitlist(tx, session.id);
    const registrations = await this.listActiveRegistrations(tx, session.id);
    this.assertActiveRegistrationConsistency(session, registrations);
    return registrations;
  }

  private async getSlotAssignmentRange(
    tx: Prisma.TransactionClient,
    session: Pick<SessionRecord, 'id' | 'slotCount'>,
  ): Promise<SlotAssignmentRange> {
    const config = await tx.sessionDiscordConfig.findUnique({
      where: { sessionId: session.id },
      select: {
        enabled: true,
        startSlot: true,
        normalSlots: true,
      },
    });

    const startSlot =
      config?.enabled === false
        ? FIRST_ASSIGNABLE_SLOT
        : Math.max(
            FIRST_ASSIGNABLE_SLOT,
            config?.startSlot ?? FIRST_ASSIGNABLE_SLOT,
          );
    const normalSlots =
      config?.enabled === false
        ? session.slotCount - startSlot + 1
        : Math.max(0, config?.normalSlots ?? session.slotCount - startSlot + 1);
    const endSlot = Math.min(session.slotCount, startSlot + normalSlots - 1);

    return {
      startSlot,
      endSlot,
    };
  }

  private async getVipSlotAssignmentRange(
    tx: Prisma.TransactionClient,
    session: Pick<SessionRecord, 'id' | 'slotCount'>,
    normalRange?: SlotAssignmentRange,
  ): Promise<SlotAssignmentRange | null> {
    const config = await tx.sessionDiscordConfig.findUnique({
      where: { sessionId: session.id },
      select: {
        enabled: true,
        vipSlots: true,
      },
    });
    const vipSlots =
      config?.enabled === false ? 0 : Math.max(0, config?.vipSlots ?? 0);
    if (vipSlots < 1) {
      return null;
    }

    const resolvedNormalRange =
      normalRange ?? (await this.getSlotAssignmentRange(tx, session));
    const startSlot = resolvedNormalRange.endSlot + 1;
    const endSlot = Math.min(session.slotCount, startSlot + vipSlots - 1);
    if (endSlot < startSlot) {
      return null;
    }

    return { startSlot, endSlot };
  }

  private async withSessionMutation<T>(
    run: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(run, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
  }

  private lowestAvailableSlot(
    registrations: Array<{ slotNumber: number | null }>,
    range: SlotAssignmentRange,
  ) {
    if (range.endSlot < range.startSlot) {
      return null;
    }

    const used = new Set(
      registrations
        .map((registration) => registration.slotNumber)
        .filter(
          (slotNumber): slotNumber is number => typeof slotNumber === 'number',
        ),
    );
    for (let slot = range.startSlot; slot <= range.endSlot; slot += 1) {
      if (!used.has(slot)) {
        return slot;
      }
    }
    return null;
  }

  private assertSlotInConfiguredRange(
    slotNumber: number,
    normalRange: SlotAssignmentRange,
    vipRange: SlotAssignmentRange | null,
  ) {
    const inNormalRange =
      slotNumber >= normalRange.startSlot && slotNumber <= normalRange.endSlot;
    const inVipRange =
      vipRange !== null &&
      slotNumber >= vipRange.startSlot &&
      slotNumber <= vipRange.endSlot;
    if (inNormalRange || inVipRange) {
      return;
    }

    const ranges = [`${normalRange.startSlot}-${normalRange.endSlot}`];
    if (vipRange) {
      ranges.push(`VIP ${vipRange.startSlot}-${vipRange.endSlot}`);
    }
    throw new BadRequestException(
      `Slot number is outside the configured range (${ranges.join(', ')})`,
    );
  }

  private assertSlotAvailable(
    registrations: Array<{ id: string; slotNumber: number | null }>,
    registrationId: string,
    slotNumber: number,
  ) {
    const existing = registrations.find(
      (registration) =>
        registration.id !== registrationId &&
        registration.slotNumber === slotNumber,
    );
    if (existing) {
      throw new ConflictException(`Slot ${slotNumber} is already assigned`);
    }
  }

  private nextWaitlistPosition(
    registrations: Array<{ waitlistPosition: number | null }>,
  ) {
    return (
      registrations.reduce(
        (max, registration) =>
          registration.waitlistPosition && registration.waitlistPosition > max
            ? registration.waitlistPosition
            : max,
        0,
      ) + 1
    );
  }

  private async sessionRegistrationManagerSnapshot(
    tx: Prisma.TransactionClient,
    organizationId: string,
    teamId: string,
  ) {
    const leaders = await tx.teamMember.findMany({
      where: {
        organizationId,
        teamId,
        role: TeamMemberRole.LEADER,
        deletedAt: null,
        leftAt: null,
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { discordUserId: true },
    });
    const managerDiscordUserIds = [
      ...new Set(
        leaders
          .map((leader) => leader.discordUserId?.trim())
          .filter((discordUserId): discordUserId is string =>
            Boolean(discordUserId),
          ),
      ),
    ];

    return {
      leaderDiscordUserId: managerDiscordUserIds[0] ?? null,
      managerDiscordUserIds,
    };
  }

  private explicitSessionRegistrationManagerSnapshot(
    dto: RegisterSessionTeamDto,
  ): {
    leaderDiscordUserId: string | null;
    managerDiscordUserIds: string[];
  } | null {
    if (
      dto.leaderDiscordUserId === undefined &&
      dto.managerDiscordUserIds === undefined
    ) {
      return null;
    }

    const managerDiscordUserIds = [
      ...new Set(
        (dto.managerDiscordUserIds ?? [])
          .map((discordUserId) => this.cleanString(discordUserId))
          .filter((discordUserId): discordUserId is string =>
            Boolean(discordUserId),
          ),
      ),
    ];
    const cleanLeaderDiscordUserId = this.cleanString(dto.leaderDiscordUserId);
    const displayManagerDiscordUserIds = managerDiscordUserIds.length
      ? managerDiscordUserIds
      : cleanLeaderDiscordUserId
        ? [cleanLeaderDiscordUserId]
        : [];

    return {
      leaderDiscordUserId:
        cleanLeaderDiscordUserId &&
        displayManagerDiscordUserIds.includes(cleanLeaderDiscordUserId)
          ? cleanLeaderDiscordUserId
          : (displayManagerDiscordUserIds[0] ??
            cleanLeaderDiscordUserId ??
            null),
      managerDiscordUserIds: displayManagerDiscordUserIds,
    };
  }

  private async repackWaitlist(
    tx: Prisma.TransactionClient,
    sessionId: string,
  ) {
    const waitlist = await tx.sessionRegistration.findMany({
      where: {
        sessionId,
        deletedAt: null,
        status: SessionRegistrationStatus.WAITLIST,
      },
      select: {
        id: true,
        waitlistPosition: true,
      },
      orderBy: [{ waitlistPosition: 'asc' }, { createdAt: 'asc' }],
    });

    for (const [index, registration] of waitlist.entries()) {
      const position = index + 1;
      if (registration.waitlistPosition !== position) {
        await tx.sessionRegistration.update({
          where: { id: registration.id },
          data: { waitlistPosition: position },
        });
      }
    }
  }

  private async promoteNextWaitlist(
    tx: Prisma.TransactionClient,
    sessionId: string,
    slotNumber: number,
  ): Promise<SessionRegistrationRecord | null> {
    const next = await tx.sessionRegistration.findFirst({
      where: {
        sessionId,
        deletedAt: null,
        status: SessionRegistrationStatus.WAITLIST,
      },
      select: sessionRegistrationSelect,
      orderBy: [{ waitlistPosition: 'asc' }, { createdAt: 'asc' }],
    });

    if (!next) {
      return null;
    }

    return tx.sessionRegistration.update({
      where: { id: next.id },
      data: {
        status: SessionRegistrationStatus.CONFIRMED,
        slotNumber,
        waitlistPosition: null,
        confirmedAt: new Date(),
        removedAt: null,
        removalReason: null,
        deletedAt: null,
      },
      select: sessionRegistrationSelect,
    });
  }

  private async logAudit(params: {
    action: AuditAction;
    organizationId: string;
    actor: Actor;
    entityType: string;
    entityId: string;
    after?: unknown;
    before?: unknown;
  }) {
    const userId = this.actorId(params.actor);
    if (!userId) return;
    await this.audit.log({
      action: params.action,
      organizationId: params.organizationId,
      userId,
      entityType: params.entityType,
      entityId: params.entityId,
      before: params.before,
      after: params.after,
      source: 'MANUAL',
    });
  }

  private async clearSessionResultSystem(
    tx: Prisma.TransactionClient,
    session: Pick<SessionRecord, 'id' | 'organizationId' | 'name'>,
    reason: string | null,
  ): Promise<SessionResultResetSummary> {
    const matches = await tx.match.findMany({
      where: {
        sessionId: session.id,
        organizationId: session.organizationId,
      },
      select: { id: true, name: true, matchNumber: true },
      orderBy: [{ matchNumber: 'asc' }, { createdAt: 'asc' }],
    });
    const matchIds = matches.map((match) => match.id);
    const resetAt = new Date();

    if (matchIds.length > 0 && reason === 'Final result posted') {
      await this.storeResultBackupsForMatches(tx, session, matches, reason);
      await this.storeNoShowBanSnapshotsForMatches(
        tx,
        session,
        matches,
        reason,
      );
      await tx.match.deleteMany({
        where: {
          id: { in: matchIds },
          sessionId: session.id,
          organizationId: session.organizationId,
        },
      });
    }

    return {
      sessionId: session.id,
      organizationId: session.organizationId,
      matchesRemoved: matchIds.length,
      matchIds,
      reason,
      resetAt,
    };
  }

  private resultBackupExpiresAt(date = new Date()) {
    return new Date(
      date.getTime() + RESULT_BACKUP_RETENTION_DAYS * 24 * 60 * 60 * 1000,
    );
  }

  private resultBackupDedupeKey(params: {
    organizationId: string;
    sessionId: string;
    sourceMatchId: string | null;
    kind: string;
    source: string | null;
  }) {
    return [
      params.organizationId,
      params.sessionId,
      params.kind.toUpperCase(),
      params.sourceMatchId || 'session',
      params.source || 'manual',
    ].join(':');
  }

  private hasAppliedResultRow(row: {
    placement?: number | null;
    totalKills?: number | null;
    totalPoints?: number | null;
    points?: number | null;
    placementPoints?: number | null;
  }) {
    return (
      row.placement !== null ||
      Math.max(0, row.totalKills ?? 0) > 0 ||
      Math.max(0, row.totalPoints ?? row.points ?? 0) > 0 ||
      Math.max(0, row.placementPoints ?? 0) > 0
    );
  }

  private async storeResultBackupsForMatches(
    tx: Prisma.TransactionClient,
    session: Pick<SessionRecord, 'id' | 'organizationId' | 'name'>,
    matches: Array<{
      id: string;
      name: string | null;
      matchNumber: number | null;
    }>,
    reason: string | null,
  ) {
    const matchIds = matches.map((match) => match.id);
    if (!matchIds.length) {
      return;
    }

    await tx.resultBackup.deleteMany({
      where: {
        organizationId: session.organizationId,
        expiresAt: { lt: new Date() },
      },
    });

    const resultRows = await tx.matchSlotResult.findMany({
      where: {
        organizationId: session.organizationId,
        matchId: { in: matchIds },
        teamId: { not: null },
      },
      select: {
        matchId: true,
        slotNumber: true,
        teamId: true,
        wasPresentInMatch: true,
        placement: true,
        placementPoints: true,
        totalKills: true,
        totalPoints: true,
        points: true,
        team: {
          select: {
            id: true,
            name: true,
            tag: true,
            logoUrl: true,
          },
        },
        players: {
          orderBy: { playerName: 'asc' },
          select: {
            id: true,
            playerId: true,
            externalPlayerId: true,
            playerName: true,
            kills: true,
            knocks: true,
            assists: true,
            isAlive: true,
            alive: true,
            isKnocked: true,
            player: {
              select: {
                ign: true,
                realName: true,
                photoUrl: true,
              },
            },
          },
        },
      },
    });

    const rowsByMatch = new Map<string, typeof resultRows>();
    for (const row of resultRows) {
      if (
        !row.teamId ||
        !row.team ||
        !isPresentInMatch(row.wasPresentInMatch)
      ) {
        continue;
      }
      if (!this.hasAppliedResultRow(row)) {
        continue;
      }
      const current = rowsByMatch.get(row.matchId) ?? [];
      current.push(row);
      rowsByMatch.set(row.matchId, current);
    }

    for (const match of matches) {
      const rows = (rowsByMatch.get(match.id) ?? [])
        .map((row) => ({
          teamId: row.teamId,
          teamName:
            row.team?.name?.trim() || row.team?.tag?.trim() || row.teamId!,
          teamTag: row.team?.tag ?? null,
          logoUrl: row.team?.logoUrl ?? null,
          slotNumber: row.slotNumber,
          placement: row.placement,
          wwcd: row.placement === 1 ? 1 : 0,
          placementPoints: row.placementPoints ?? 0,
          kills: row.totalKills ?? 0,
          totalPoints: row.totalPoints ?? row.points ?? 0,
          playersJson: this.resultBackupPlayersFromMatchPlayers(
            row.players ?? [],
          ),
        }))
        .sort((left, right) => {
          const leftPlacement = left.placement ?? left.slotNumber;
          const rightPlacement = right.placement ?? right.slotNumber;
          if (leftPlacement !== rightPlacement) {
            return leftPlacement - rightPlacement;
          }
          if (right.totalPoints !== left.totalPoints) {
            return right.totalPoints - left.totalPoints;
          }
          return right.kills - left.kills;
        });
      if (!rows.length) {
        continue;
      }
      await this.replaceResultBackupRows(tx, {
        organizationId: session.organizationId,
        sessionId: session.id,
        sourceMatchId: match.id,
        kind: 'MATCH',
        source: reason,
        matchNumber: match.matchNumber,
        matchName: match.name,
        sessionName: session.name,
        title: match.name?.trim() || `Match ${match.matchNumber ?? ''}`.trim(),
        rows: rows.map((row, index) => ({ ...row, rank: index + 1 })),
      });
    }

    const aggregates = new Map<
      string,
      {
        teamId: string;
        teamName: string;
        teamTag: string | null;
        logoUrl: string | null;
        wwcd: number;
        placementPoints: number;
        kills: number;
        totalPoints: number;
      }
    >();
    for (const row of resultRows) {
      if (
        !row.teamId ||
        !row.team ||
        !isPresentInMatch(row.wasPresentInMatch) ||
        !this.hasAppliedResultRow(row)
      ) {
        continue;
      }
      const current = aggregates.get(row.teamId) ?? {
        teamId: row.teamId,
        teamName: row.team.name?.trim() || row.team.tag?.trim() || row.teamId,
        teamTag: row.team.tag ?? null,
        logoUrl: row.team.logoUrl ?? null,
        wwcd: 0,
        placementPoints: 0,
        kills: 0,
        totalPoints: 0,
      };
      current.wwcd += row.placement === 1 ? 1 : 0;
      current.placementPoints += row.placementPoints ?? 0;
      current.kills += row.totalKills ?? 0;
      current.totalPoints += row.totalPoints ?? row.points ?? 0;
      if (!current.logoUrl && row.team.logoUrl) {
        current.logoUrl = row.team.logoUrl;
      }
      aggregates.set(row.teamId, current);
    }

    const overallRows = Array.from(aggregates.values()).sort((left, right) => {
      const rankingOrder = compareRankingRows(left, right);
      if (rankingOrder !== 0) return rankingOrder;
      return left.teamName.localeCompare(right.teamName);
    });
    if (overallRows.length > 0) {
      await this.replaceResultBackupRows(tx, {
        organizationId: session.organizationId,
        sessionId: session.id,
        sourceMatchId: null,
        kind: 'OVERALL',
        source: reason,
        matchNumber: null,
        matchName: null,
        sessionName: session.name,
        title: `${session.name} Overall Ranking`,
        rows: overallRows.map((row, index) => ({
          ...row,
          rank: index + 1,
          slotNumber: null,
          placement: null,
        })),
      });
    }
  }

  private async replaceResultBackupRows(
    tx: Prisma.TransactionClient,
    params: {
      organizationId: string;
      sessionId: string;
      sourceMatchId: string | null;
      kind: string;
      source: string | null;
      matchNumber: number | null;
      matchName: string | null;
      sessionName: string | null;
      title: string | null;
      rows: Array<{
        rank: number;
        teamId: string | null;
        teamName: string;
        teamTag: string | null;
        logoUrl: string | null;
        slotNumber: number | null;
        placement: number | null;
        wwcd: number;
        placementPoints: number;
        kills: number;
        totalPoints: number;
        playersJson?: ResultBackupPlayerSnapshot[];
      }>;
    },
  ) {
    const dedupeKey = this.resultBackupDedupeKey(params);
    const backup = await tx.resultBackup.upsert({
      where: { dedupeKey },
      create: {
        organizationId: params.organizationId,
        sessionId: params.sessionId,
        sourceMatchId: params.sourceMatchId,
        kind: params.kind,
        source: params.source,
        dedupeKey,
        matchNumber: params.matchNumber,
        matchName: params.matchName,
        sessionName: params.sessionName,
        title: params.title,
        expiresAt: this.resultBackupExpiresAt(),
      },
      update: {
        sourceMatchId: params.sourceMatchId,
        kind: params.kind,
        source: params.source,
        matchNumber: params.matchNumber,
        matchName: params.matchName,
        sessionName: params.sessionName,
        title: params.title,
        expiresAt: this.resultBackupExpiresAt(),
      },
      select: { id: true },
    });

    await tx.resultBackupRow.deleteMany({
      where: { backupId: backup.id },
    });
    await tx.resultBackupRow.createMany({
      data: params.rows.map((row) => ({
        backupId: backup.id,
        ...row,
      })),
    });
  }

  private resultBackupPlayersFromMatchPlayers(
    players: Array<{
      id: string;
      playerId: string | null;
      externalPlayerId?: string | null;
      playerName: string;
      kills: number;
      knocks?: number | null;
      assists?: number | null;
      isAlive?: boolean | null;
      alive?: boolean | null;
      isKnocked?: boolean | null;
      player?: {
        ign?: string | null;
        realName?: string | null;
        photoUrl?: string | null;
      } | null;
    }>,
  ): ResultBackupPlayerSnapshot[] {
    return players
      .map((player, index) => {
        const name =
          this.cleanString(player.player?.ign) ??
          this.cleanString(player.player?.realName) ??
          this.cleanString(player.playerName);
        if (!name) return null;
        return {
          id:
            this.cleanString(player.id) ??
            this.resultBackupPlayerFallbackId(name, index),
          playerId: this.cleanString(player.playerId),
          externalPlayerId: this.cleanString(player.externalPlayerId),
          name,
          kills: this.clampResultBackupInt(player.kills, 0, 100000),
          knocks: this.optionalResultBackupInt(player.knocks, 0, 100000),
          assists: this.optionalResultBackupInt(player.assists, 0, 100000),
          alive: this.resultBackupBoolean(player.alive),
          isAlive: this.resultBackupBoolean(player.isAlive ?? player.alive),
          isKnocked: this.resultBackupBoolean(player.isKnocked),
          avatar: this.cleanString(player.player?.photoUrl),
        };
      })
      .filter((player): player is ResultBackupPlayerSnapshot =>
        Boolean(player),
      );
  }

  private resultBackupPlayerFallbackId(name: string, index: number) {
    const normalized = name
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40);
    return `backup-player-${index + 1}${normalized ? `-${normalized}` : ''}`;
  }

  private optionalResultBackupInt(
    value: number | null | undefined,
    min: number,
    max: number,
  ) {
    if (value === null || value === undefined) return null;
    return this.clampResultBackupInt(value, min, max);
  }

  private clampResultBackupInt(value: number, min: number, max: number) {
    const parsed = Number.isFinite(value) ? Math.trunc(value) : min;
    return Math.max(min, Math.min(max, parsed));
  }

  private resultBackupBoolean(value: unknown) {
    return typeof value === 'boolean' ? value : null;
  }

  private async storeNoShowBanSnapshotsForMatches(
    tx: Prisma.TransactionClient,
    session: Pick<SessionRecord, 'id' | 'organizationId'>,
    matches: Array<{
      id: string;
      name: string | null;
      matchNumber: number | null;
    }>,
    reason: string | null,
  ) {
    const matchIds = matches.map((match) => match.id);
    if (!matchIds.length) {
      return;
    }

    const matchById = new Map(matches.map((match) => [match.id, match]));
    const matchNumbers = [
      ...new Set(
        matches
          .map((match) => match.matchNumber)
          .filter((matchNumber): matchNumber is number =>
            Number.isInteger(matchNumber),
          ),
      ),
    ];

    await tx.noShowBanSnapshot.deleteMany({
      where: {
        organizationId: session.organizationId,
        sessionId: session.id,
        OR: [
          { sourceMatchId: { in: matchIds } },
          ...(matchNumbers.length
            ? [{ matchNumber: { in: matchNumbers } }]
            : []),
        ],
      },
    });

    const [assignedSlots, resultRows] = await Promise.all([
      tx.matchSlot.findMany({
        where: {
          matchId: { in: matchIds },
          deletedAt: null,
          teamId: { not: null },
        },
        select: {
          matchId: true,
          slotNumber: true,
          teamId: true,
          team: { select: { id: true, name: true, tag: true } },
        },
        orderBy: [{ matchId: 'asc' }, { slotNumber: 'asc' }],
      }),
      tx.matchSlotResult.findMany({
        where: {
          matchId: { in: matchIds },
          teamId: { not: null },
        },
        select: {
          matchId: true,
          slotNumber: true,
          teamId: true,
          wasPresentInMatch: true,
          placement: true,
          team: { select: { id: true, name: true, tag: true } },
        },
        orderBy: [{ matchId: 'asc' }, { slotNumber: 'asc' }],
      }),
    ]);

    const presentKeys = new Set<string>();
    const noShowResultRows = new Map<string, (typeof resultRows)[number]>();
    for (const row of resultRows) {
      if (!row.teamId) {
        continue;
      }
      const key = `${row.matchId}:${row.slotNumber}:${row.teamId}`;
      if (row.wasPresentInMatch === true || row.placement !== null) {
        presentKeys.add(key);
      } else if (row.wasPresentInMatch === false) {
        noShowResultRows.set(key, row);
      }
    }

    const snapshots = new Map<
      string,
      {
        organizationId: string;
        sessionId: string;
        sourceMatchId: string;
        matchNumber: number | null;
        matchName: string | null;
        slotNumber: number;
        teamId: string;
        teamName: string;
        teamTag: string | null;
        source: string | null;
      }
    >();
    const addSnapshot = (entry: {
      matchId: string;
      slotNumber: number;
      teamId: string | null;
      team: { name: string; tag: string | null } | null;
    }) => {
      if (!entry.teamId || !entry.team) {
        return;
      }
      const match = matchById.get(entry.matchId);
      if (!match) {
        return;
      }
      const key = `${entry.matchId}:${entry.teamId}`;
      if (snapshots.has(key)) {
        return;
      }
      snapshots.set(key, {
        organizationId: session.organizationId,
        sessionId: session.id,
        sourceMatchId: entry.matchId,
        matchNumber: match.matchNumber,
        matchName: match.name,
        slotNumber: entry.slotNumber,
        teamId: entry.teamId,
        teamName: entry.team.name,
        teamTag: entry.team.tag,
        source: reason,
      });
    };

    for (const slot of assignedSlots) {
      if (!slot.teamId) {
        continue;
      }
      const key = `${slot.matchId}:${slot.slotNumber}:${slot.teamId}`;
      if (!presentKeys.has(key)) {
        addSnapshot(slot);
      }
    }

    for (const row of noShowResultRows.values()) {
      addSnapshot(row);
    }

    if (!snapshots.size) {
      return;
    }

    await tx.noShowBanSnapshot.createMany({
      data: Array.from(snapshots.values()),
      skipDuplicates: true,
    });
  }

  async resetResultSystem(
    sessionId: string,
    dto: ResetSessionResultsDto,
    actor: Actor,
  ) {
    const session = await this.getSessionOrThrow(sessionId, actor);
    if (session.type === SessionType.SCRIM) {
      await this.assertDiscordAutomationAllowed(session.organizationId);
    }
    const reason =
      this.cleanString(dto.reason) || 'Reset session result system';

    const result = await this.withSessionMutation(async (tx) => {
      await this.lockSessionRow(tx, session.id);
      const lockedSession = await this.getMutableSessionOrThrow(
        tx,
        session.id,
        session.organizationId,
      );
      return this.clearSessionResultSystem(tx, lockedSession, reason);
    });

    await this.logAudit({
      action: AuditAction.MATCH_RESULT_EDIT,
      organizationId: session.organizationId,
      actor,
      entityType: 'SESSION_RESULT_SYSTEM',
      entityId: session.id,
      after: {
        reason,
        resetAt: result.resetAt,
        matchesRemoved: result.matchesRemoved,
        matchIds: result.matchIds,
      },
    });

    return result;
  }

  private async assertTeamManagersNotBannedForDiscordSession(
    tx: Prisma.TransactionClient,
    organizationId: string,
    sessionId: string,
    teamId: string,
  ) {
    const members = await tx.teamMember.findMany({
      where: {
        organizationId,
        teamId,
        deletedAt: null,
        leftAt: null,
      },
      select: {
        discordUserId: true,
        discordUsername: true,
        displayName: true,
        role: true,
        createdAt: true,
      },
      orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
    });
    const leaders = members.filter(
      (member) => member.role === TeamMemberRole.LEADER,
    );
    const checkedMembers = leaders.length ? leaders : members;
    const discordUserIds = [
      ...new Set(
        checkedMembers
          .map((member) => member.discordUserId.trim())
          .filter((id) => /^\d{15,25}$/.test(id)),
      ),
    ];
    if (!discordUserIds.length) {
      return;
    }

    const activeBan = await tx.managerBan.findFirst({
      where: {
        organizationId,
        discordUserId: { in: discordUserIds },
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        scope: { in: [TeamBanScope.TEAM, TeamBanScope.SESSION] },
        AND: [
          {
            OR: [
              { scope: TeamBanScope.TEAM },
              { scope: TeamBanScope.SESSION, sessionId },
            ],
          },
        ],
      },
      select: {
        discordUserId: true,
        displayName: true,
        discordUsername: true,
        scope: true,
        reason: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!activeBan) {
      return;
    }

    const label =
      activeBan.displayName?.trim() ||
      activeBan.discordUsername?.trim() ||
      activeBan.discordUserId;
    throw new ForbiddenException(
      activeBan.scope === TeamBanScope.SESSION
        ? `Manager is banned from this scrim: ${label} - ${activeBan.reason}`
        : `Manager is banned from Discord scrims: ${label} - ${activeBan.reason}`,
    );
  }

  async create(dto: CreateSessionDto, actor: Actor) {
    const organizationId = this.requireOrg(actor);
    const actorId = this.actorId(actor);
    const name = this.cleanString(dto.name);
    if (!name) {
      throw new BadRequestException('name is required');
    }

    const registrationOpenAt = this.parseDate(
      'registrationOpenAt',
      dto.registrationOpenAt,
    );
    const registrationCloseAt = this.parseDate(
      'registrationCloseAt',
      dto.registrationCloseAt,
    );
    const checkInOpenAt = this.parseDate('checkInOpenAt', dto.checkInOpenAt);
    const checkInCloseAt = this.parseDate('checkInCloseAt', dto.checkInCloseAt);
    const startsAt = this.parseDate('startsAt', dto.startsAt);
    const endedAt = this.parseDate('endedAt', dto.endedAt);

    this.validateDateRange(
      registrationOpenAt,
      registrationCloseAt,
      'registrationOpenAt',
      'registrationCloseAt',
    );
    this.validateDateRange(
      checkInOpenAt,
      checkInCloseAt,
      'checkInOpenAt',
      'checkInCloseAt',
    );
    this.validateDateRange(startsAt, endedAt, 'startsAt', 'endedAt');

    const gameId = await this.resolveGameId(dto.gameId, dto.gameKey);
    const gameKey =
      (await this.resolveGameKey(gameId)) ??
      this.normalizeGameKey(dto.gameKey) ??
      GameKey.PUBG_MOBILE;
    await assertOrganizationGameAccess(this.prisma, organizationId, gameKey);
    const defaultCapacity = defaultSlotCountForGame(gameKey);
    const maxTeams = dto.maxTeams ?? defaultCapacity;
    const slotCount = dto.slotCount ?? defaultCapacity;
    this.validateCapacity(maxTeams, slotCount);
    const adapterKey = await this.validateAdapterKey(dto.adapterKey, gameId);
    const type = dto.type ?? SessionType.SCRIM;
    if (type === SessionType.SCRIM) {
      await this.assertDiscordSessionCreateAllowed(organizationId);
    }

    const created = await this.prisma.session.create({
      data: {
        organizationId,
        name,
        slug: this.cleanSlug(dto.slug),
        type,
        status: dto.status ?? SessionStatus.DRAFT,
        description: this.cleanString(dto.description),
        logoUrl: this.cleanString(dto.logoUrl),
        bannerUrl: this.cleanString(dto.bannerUrl),
        rulesetId: this.cleanString(dto.rulesetId),
        gameId,
        adapterKey,
        maxTeams,
        slotCount,
        ...buildQualificationSettingsData(dto),
        waitlistEnabled: dto.waitlistEnabled ?? true,
        checkInEnabled: dto.checkInEnabled ?? false,
        registrationOpenAt: registrationOpenAt ?? null,
        registrationCloseAt: registrationCloseAt ?? null,
        checkInOpenAt: checkInOpenAt ?? null,
        checkInCloseAt: checkInCloseAt ?? null,
        startsAt: startsAt ?? null,
        endedAt: endedAt ?? null,
        createdById: actorId,
        updatedById: actorId,
      },
      select: sessionSelect,
    });

    await this.logAudit({
      action: AuditAction.SESSION_CREATE,
      organizationId,
      actor,
      entityType: 'SESSION',
      entityId: created.id,
      after: {
        name: created.name,
        type: created.type,
        status: created.status,
      },
    });

    return this.buildSessionResponse(created, {
      confirmedCount: 0,
      waitlistCount: 0,
      totalRegisteredCount: 0,
    });
  }

  async list(
    actor: Actor,
    query?: { status?: SessionStatus; type?: SessionType },
  ) {
    const organizationId = this.requireOrg(actor);
    const sessions = await this.prisma.session.findMany({
      where: {
        organizationId,
        deletedAt: null,
        status: query?.status,
        type: query?.type,
      },
      select: sessionSelect,
      orderBy: [{ startsAt: 'desc' }, { createdAt: 'desc' }],
    });

    const counts = await this.getSessionCounts(
      sessions.map((session) => session.id),
    );
    return sessions.map((session) =>
      this.buildSessionResponse(
        session,
        counts.get(session.id) ?? {
          confirmedCount: 0,
          waitlistCount: 0,
          totalRegisteredCount: 0,
        },
      ),
    );
  }

  async get(sessionId: string, actor: Actor) {
    const session = await this.getSessionOrThrow(sessionId, actor);
    const counts = await this.getSessionCounts([session.id]);
    return this.buildSessionResponse(
      session,
      counts.get(session.id) ?? {
        confirmedCount: 0,
        waitlistCount: 0,
        totalRegisteredCount: 0,
      },
    );
  }

  private async assertDiscordAutomationOrganizationActive(
    organizationId: string,
  ) {
    const organization = await this.prisma.organization.findFirst({
      where: { id: organizationId, deletedAt: null },
      select: {
        id: true,
        isActive: true,
        status: true,
        subscriptionStatus: true,
        trialEndsAt: true,
        paidUntil: true,
      },
    });

    if (
      !organization ||
      !organization.isActive ||
      organization.status !== OrganizationStatus.APPROVED ||
      !organizationHasActiveSubscription(organization)
    ) {
      throw new NotFoundException(
        'Discord server is not linked to an active Arenzyra organization',
      );
    }
  }

  private async assertDiscordAutomationOrganizationOwnsGuild(
    organizationId: string,
    guildId: string,
  ) {
    const linkedGuild = await this.prisma.organizationDiscordGuild.findFirst({
      where: {
        organizationId,
        guildId,
        enabled: true,
        organization: { deletedAt: null },
      },
      select: { guildId: true },
    });
    if (linkedGuild) {
      return;
    }

    const legacyConfig = await this.prisma.organizationDiscordConfig.findFirst({
      where: {
        organizationId,
        guildId,
        enabled: true,
        organization: { deletedAt: null },
      },
      select: { organizationId: true },
    });
    if (legacyConfig) {
      return;
    }

    throw new NotFoundException(
      'Discord channel is not linked to the owning Arenzyra organization',
    );
  }

  async resolveDiscordChannel(
    guildId: string | null | undefined,
    channelId: string | null | undefined,
    actor: Actor,
    topicMarker?: {
      topicSessionId?: string | null;
      topicKind?: string | null;
    },
  ) {
    const cleanGuildId = this.cleanString(guildId);
    const cleanChannelId = this.cleanString(channelId);
    if (!cleanGuildId || !cleanChannelId) {
      throw new BadRequestException('guildId and channelId are required');
    }

    const role = actor?.actorRole ?? actor?.role ?? null;
    if (role !== Role.SUPER_ADMIN && role !== Role.ORGANIZER) {
      throw new ForbiddenException('Organizer role required');
    }

    const organizationId =
      actor?.serviceToken || (role === Role.SUPER_ADMIN && !actor?.actingOrgId)
        ? null
        : this.requireOrg(actor);

    const findDiscordConfig = (where: Prisma.SessionDiscordConfigWhereInput) =>
      this.prisma.sessionDiscordConfig.findFirst({
        where,
        select: {
          ...sessionDiscordConfigSelect,
          session: {
            select: sessionSelect,
          },
        },
        orderBy: { updatedAt: 'desc' },
      });
    const findLogoDiscordConfig = async (
      sessionWhere: Prisma.SessionWhereInput,
    ) => {
      const configs = await this.prisma.sessionDiscordConfig.findMany({
        where: {
          ...(organizationId ? { organizationId } : {}),
          guildId: cleanGuildId,
          session: sessionWhere,
        },
        select: {
          ...sessionDiscordConfigSelect,
          session: {
            select: sessionSelect,
          },
        },
        orderBy: { updatedAt: 'desc' },
      });
      return (
        configs.find((config) =>
          this.configuredLogoChannelIds(config).includes(cleanChannelId),
        ) ?? null
      );
    };
    const findPlayerPhotoDiscordConfig = async (
      sessionWhere: Prisma.SessionWhereInput,
    ) => {
      const configs = await this.prisma.sessionDiscordConfig.findMany({
        where: {
          ...(organizationId ? { organizationId } : {}),
          guildId: cleanGuildId,
          session: sessionWhere,
        },
        select: {
          ...sessionDiscordConfigSelect,
          session: {
            select: sessionSelect,
          },
        },
        orderBy: { updatedAt: 'desc' },
      });
      return (
        configs.find((config) =>
          this.configuredPlayerPhotoChannelIds(config).includes(cleanChannelId),
        ) ?? null
      );
    };
    let organizationLogoChannelOrganizationIds: string[] | null = null;
    const findOrganizationLogoChannelOrganizationIds = async () => {
      if (organizationLogoChannelOrganizationIds) {
        return organizationLogoChannelOrganizationIds;
      }

      const organizationIds = new Set<string>();
      const legacyConfigs =
        await this.prisma.organizationDiscordConfig.findMany({
          where: {
            ...(organizationId ? { organizationId } : {}),
            guildId: cleanGuildId,
            organization: { deletedAt: null },
          },
          select: {
            organizationId: true,
            logoChannelIds: true,
          },
        });
      for (const config of legacyConfigs) {
        if (
          this.discordSnowflakeIdsFromText(config.logoChannelIds).includes(
            cleanChannelId,
          )
        ) {
          organizationIds.add(config.organizationId);
        }
      }

      const linkedGuilds = await this.prisma.organizationDiscordGuild.findMany({
        where: {
          ...(organizationId ? { organizationId } : {}),
          guildId: cleanGuildId,
          enabled: true,
          organization: { deletedAt: null },
        },
        select: {
          organizationId: true,
          organization: {
            select: {
              discordConfig: {
                select: {
                  logoChannelIds: true,
                },
              },
            },
          },
        },
      });
      for (const guild of linkedGuilds) {
        if (
          this.discordSnowflakeIdsFromText(
            guild.organization?.discordConfig?.logoChannelIds,
          ).includes(cleanChannelId)
        ) {
          organizationIds.add(guild.organizationId);
        }
      }

      organizationLogoChannelOrganizationIds = [...organizationIds];
      return organizationLogoChannelOrganizationIds;
    };
    const findOrganizationLogoDiscordConfig = async (
      sessionWhere: Prisma.SessionWhereInput,
    ) => {
      const organizationIds =
        await findOrganizationLogoChannelOrganizationIds();
      if (organizationIds.length === 0) {
        return null;
      }
      const configs = await this.prisma.sessionDiscordConfig.findMany({
        where: {
          organizationId: { in: organizationIds },
          guildId: cleanGuildId,
          enabled: true,
          session: sessionWhere,
        },
        select: {
          ...sessionDiscordConfigSelect,
          session: {
            select: sessionSelect,
          },
        },
        orderBy: { updatedAt: 'desc' },
      });
      return configs[0] ?? null;
    };

    const channelWhere = {
      ...(organizationId ? { organizationId } : {}),
      guildId: cleanGuildId,
      OR: [
        { registrationChannelId: cleanChannelId },
        { slotListChannelId: cleanChannelId },
        { waitlistChannelId: cleanChannelId },
        { idpChannelId: cleanChannelId },
        { managerChannelId: cleanChannelId },
        { transferChannelId: cleanChannelId },
        { manageChannelId: cleanChannelId },
        { resultsChannelId: cleanChannelId },
        { screenshotsChannelId: cleanChannelId },
        { bansChannelId: cleanChannelId },
        { logChannelId: cleanChannelId },
      ],
      session: {
        deletedAt: null,
      },
    } satisfies Prisma.SessionDiscordConfigWhereInput;

    const topicSessionId = this.cleanString(topicMarker?.topicSessionId);
    const topicKind =
      this.cleanString(topicMarker?.topicKind)?.toLowerCase() ?? '';
    const cleanTopicKind = DISCORD_CHANNEL_KINDS.has(topicKind)
      ? (topicKind as DiscordChannelKind)
      : null;

    let resolved: Awaited<ReturnType<typeof findDiscordConfig>> = null;
    let channelKind: DiscordChannelKind | null = null;

    if (actor?.serviceToken && topicSessionId && cleanTopicKind) {
      const topicResolved = await findDiscordConfig({
        ...(organizationId ? { organizationId } : {}),
        sessionId: topicSessionId,
        guildId: cleanGuildId,
        session: {
          deletedAt: null,
        },
      });
      const topicChannelKind = topicResolved
        ? this.discordChannelKind(topicResolved, cleanChannelId)
        : null;
      if (topicResolved && topicChannelKind === cleanTopicKind) {
        resolved = topicResolved;
        channelKind = cleanTopicKind;
      }
    }

    if (!resolved && actor?.serviceToken) {
      resolved = await findDiscordConfig({
        ...channelWhere,
        session: {
          deletedAt: null,
          type: SessionType.SCRIM,
        },
      });
      channelKind = resolved
        ? this.discordChannelKind(resolved, cleanChannelId)
        : null;
    }

    if (!resolved && actor?.serviceToken) {
      resolved = await findLogoDiscordConfig({
        deletedAt: null,
        type: SessionType.SCRIM,
      });
      channelKind = resolved ? 'logos' : null;
    }

    if (!resolved && actor?.serviceToken) {
      resolved = await findPlayerPhotoDiscordConfig({
        deletedAt: null,
        type: SessionType.SCRIM,
      });
      channelKind = resolved ? 'player-photos' : null;
    }

    if (!resolved && actor?.serviceToken) {
      resolved = await findOrganizationLogoDiscordConfig({
        deletedAt: null,
        type: SessionType.SCRIM,
      });
      channelKind = resolved ? 'logos' : null;
    }

    if (!resolved || !channelKind) {
      resolved = await findDiscordConfig(channelWhere);
      channelKind = resolved
        ? this.discordChannelKind(resolved, cleanChannelId)
        : null;
    }

    if (!resolved || !channelKind) {
      resolved = await findLogoDiscordConfig({
        deletedAt: null,
      });
      channelKind = resolved ? 'logos' : null;
    }

    if (!resolved || !channelKind) {
      resolved = await findPlayerPhotoDiscordConfig({
        deletedAt: null,
      });
      channelKind = resolved ? 'player-photos' : null;
    }

    if (!resolved || !channelKind) {
      resolved = await findOrganizationLogoDiscordConfig({
        deletedAt: null,
      });
      channelKind = resolved ? 'logos' : null;
    }

    if (!resolved && actor?.serviceToken && topicSessionId && cleanTopicKind) {
      resolved = await findDiscordConfig({
        ...(organizationId ? { organizationId } : {}),
        sessionId: topicSessionId,
        guildId: cleanGuildId,
        session: {
          deletedAt: null,
        },
      });
      channelKind = resolved ? cleanTopicKind : null;
    }

    if (!resolved || resolved.enabled === false || !channelKind) {
      throw new NotFoundException('Discord channel is not linked to a session');
    }

    const { session, ...config } = resolved;
    if (actor?.serviceToken) {
      await this.assertDiscordAutomationOrganizationOwnsGuild(
        config.organizationId,
        cleanGuildId,
      );
      await this.assertDiscordAutomationOrganizationActive(
        config.organizationId,
      );
    }
    const counts = await this.getSessionCounts([session.id]);
    const accessRoles = await this.getOrganizationAccessRoleDefaults(
      config.organizationId,
    );

    return {
      session: this.buildSessionResponse(
        session,
        counts.get(session.id) ?? {
          confirmedCount: 0,
          waitlistCount: 0,
          totalRegisteredCount: 0,
        },
      ),
      config: this.buildDiscordConfigResponse(config, accessRoles),
      channelKind,
    };
  }

  async resolveDiscordGuild(guildId: string | null | undefined, actor: Actor) {
    const cleanGuildId = this.cleanDiscordSnowflake(guildId, 'guildId');
    const role = actor?.actorRole ?? actor?.role ?? null;
    if (role !== Role.SUPER_ADMIN && role !== Role.ORGANIZER) {
      throw new ForbiddenException('Organizer role required');
    }

    const organizationId =
      actor?.serviceToken || (role === Role.SUPER_ADMIN && !actor?.actingOrgId)
        ? null
        : this.requireOrg(actor);

    const guildDelegate = (
      this.prisma as unknown as {
        organizationDiscordGuild?: {
          findFirst?: (args: {
            where: Prisma.OrganizationDiscordGuildWhereInput;
            select: Prisma.OrganizationDiscordGuildSelect;
            orderBy?: Prisma.OrganizationDiscordGuildOrderByWithRelationInput[];
          }) => Promise<{
            organizationId: string;
            guildId: string;
            guildName: string | null;
            isPrimary: boolean;
            organization: { id: string; name: string; slug: string };
          } | null>;
        };
      }
    ).organizationDiscordGuild;

    const linkedGuild = guildDelegate?.findFirst
      ? await guildDelegate.findFirst({
          where: {
            ...(organizationId ? { organizationId } : {}),
            guildId: cleanGuildId,
            enabled: true,
            organization: { deletedAt: null },
          },
          select: {
            organizationId: true,
            guildId: true,
            guildName: true,
            isPrimary: true,
            organization: {
              select: {
                id: true,
                name: true,
                slug: true,
              },
            },
          },
          orderBy: [{ isPrimary: 'desc' }, { updatedAt: 'desc' }],
        })
      : null;

    if (linkedGuild) {
      if (actor?.serviceToken) {
        await this.assertDiscordAutomationOrganizationActive(
          linkedGuild.organizationId,
        );
      }
      return {
        organizationId: linkedGuild.organizationId,
        organizationName: linkedGuild.organization.name,
        organizationSlug: linkedGuild.organization.slug,
        guildId: linkedGuild.guildId,
        guildName: linkedGuild.guildName,
        source: 'guild-link',
      };
    }

    const legacyConfig = await this.prisma.organizationDiscordConfig.findFirst({
      where: {
        ...(organizationId ? { organizationId } : {}),
        guildId: cleanGuildId,
        enabled: true,
        organization: { deletedAt: null },
      },
      select: {
        organizationId: true,
        guildId: true,
        guildName: true,
        organization: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });

    if (legacyConfig?.guildId) {
      if (actor?.serviceToken) {
        await this.assertDiscordAutomationOrganizationActive(
          legacyConfig.organizationId,
        );
      }
      return {
        organizationId: legacyConfig.organizationId,
        organizationName: legacyConfig.organization.name,
        organizationSlug: legacyConfig.organization.slug,
        guildId: legacyConfig.guildId,
        guildName: legacyConfig.guildName,
        source: 'legacy-config',
      };
    }

    throw new NotFoundException(
      'Discord server is not linked to an organization',
    );
  }

  private async assertDiscordChannelPauseAccess(guildId: string, actor: Actor) {
    const role = actor?.actorRole ?? actor?.role ?? null;
    if (actor?.serviceToken) {
      return;
    }
    if (role !== Role.SUPER_ADMIN && role !== Role.ORGANIZER) {
      throw new ForbiddenException('Organizer role required');
    }
    if (role === Role.SUPER_ADMIN && !actor?.actingOrgId) {
      return;
    }

    const organizationId = this.requireOrg(actor);
    const organizationGuild = await this.getOrganizationDiscordGuildById(
      organizationId,
      guildId,
    );
    const linkedGuildId = this.cleanString(organizationGuild?.guildId);
    if (!linkedGuildId || linkedGuildId !== guildId) {
      throw new ForbiddenException(
        "Discord channel does not belong to this organization's connected servers",
      );
    }
  }

  async getDiscordChannelPause(
    guildId: string | null | undefined,
    channelId: string | null | undefined,
    actor: Actor,
  ) {
    const cleanGuildId = this.cleanDiscordSnowflake(guildId, 'guildId');
    const cleanChannelId = this.cleanDiscordSnowflake(channelId, 'channelId');
    await this.assertDiscordChannelPauseAccess(cleanGuildId, actor);

    const pause = await this.prisma.discordGuildChannelPause.findUnique({
      where: {
        guildId_channelId: {
          guildId: cleanGuildId,
          channelId: cleanChannelId,
        },
      },
      select: { paused: true },
    });

    return {
      guildId: cleanGuildId,
      channelId: cleanChannelId,
      paused: pause?.paused === true,
    };
  }

  async updateDiscordChannelPause(
    dto: UpdateDiscordChannelPauseDto,
    actor: Actor,
  ) {
    const cleanGuildId = this.cleanDiscordSnowflake(dto.guildId, 'guildId');
    const cleanChannelId = this.cleanDiscordSnowflake(
      dto.channelId,
      'channelId',
    );
    await this.assertDiscordChannelPauseAccess(cleanGuildId, actor);

    if (!dto.paused) {
      await this.prisma.discordGuildChannelPause.deleteMany({
        where: {
          guildId: cleanGuildId,
          channelId: cleanChannelId,
        },
      });
      return {
        guildId: cleanGuildId,
        channelId: cleanChannelId,
        paused: false,
      };
    }

    const pause = await this.prisma.discordGuildChannelPause.upsert({
      where: {
        guildId_channelId: {
          guildId: cleanGuildId,
          channelId: cleanChannelId,
        },
      },
      create: {
        guildId: cleanGuildId,
        channelId: cleanChannelId,
        paused: true,
      },
      update: {
        paused: true,
      },
      select: {
        paused: true,
      },
    });

    return {
      guildId: cleanGuildId,
      channelId: cleanChannelId,
      paused: pause.paused,
    };
  }

  async getDiscordConfig(sessionId: string, actor: Actor) {
    const session = await this.getSessionOrThrow(sessionId, actor);
    const [defaults, accessRoles] = await Promise.all([
      this.buildDiscordConfigDefaults(session),
      this.getOrganizationAccessRoleDefaults(session.organizationId),
    ]);
    let config: SessionDiscordConfigRecord | null = null;
    try {
      config = await this.prisma.sessionDiscordConfig.upsert({
        where: { sessionId: session.id },
        update: {},
        create: defaults,
        select: sessionDiscordConfigSelect,
      });
    } catch (error) {
      if (!this.isSessionDiscordConfigUniqueConflict(error)) {
        throw error;
      }
      config = await this.prisma.sessionDiscordConfig.findUnique({
        where: { sessionId: session.id },
        select: sessionDiscordConfigSelect,
      });
      if (!config) {
        throw error;
      }
    }

    return this.buildDiscordConfigResponse(config, accessRoles);
  }

  private isSessionDiscordConfigUniqueConflict(error: unknown): boolean {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      return true;
    }

    const candidate = error as {
      message?: string;
      driverAdapterError?: {
        originalMessage?: string;
        cause?: { kind?: string };
      };
    };
    return (
      candidate.driverAdapterError?.cause?.kind ===
        'UniqueConstraintViolation' ||
      candidate.driverAdapterError?.originalMessage?.includes(
        'SessionDiscordConfig_sessionId_key',
      ) === true ||
      candidate.message?.includes('SessionDiscordConfig_sessionId_key') === true
    );
  }

  async updateDiscordConfig(
    sessionId: string,
    dto: UpdateSessionDiscordConfigDto,
    actor: Actor,
  ) {
    const session = await this.getSessionOrThrow(sessionId, actor);
    await this.assertDiscordAutomationAllowed(session.organizationId);
    const data = this.normalizeDiscordConfigDto(dto);
    const existing = await this.prisma.sessionDiscordConfig.findUnique({
      where: { sessionId: session.id },
      select: sessionDiscordConfigSelect,
    });
    await this.assertDiscordConfigGuildMatchesOrganization(
      session.organizationId,
      dto,
      existing,
    );
    const defaults = await this.buildDiscordConfigDefaults(session);
    const mutableData =
      data as Prisma.SessionDiscordConfigUncheckedUpdateInput &
        Record<string, unknown>;
    if (dto.enabled !== undefined) {
      const currentEnabled = existing?.enabled ?? defaults.enabled ?? true;
      if (
        dto.enabled === currentEnabled ||
        dto.enabledChangeIntent === 'USER_TOGGLE'
      ) {
        mutableData.enabled = dto.enabled;
      }
    }
    const config = await this.prisma.sessionDiscordConfig.upsert({
      where: { sessionId: session.id },
      update: data,
      create: {
        ...defaults,
        ...(data as Prisma.SessionDiscordConfigUncheckedCreateInput),
      },
      select: sessionDiscordConfigSelect,
    });

    await this.logAudit({
      action: AuditAction.SESSION_DISCORD_CONFIG_UPDATE,
      organizationId: session.organizationId,
      actor,
      entityType: 'SESSION_DISCORD_CONFIG',
      entityId: config.id,
      before: existing,
      after: config,
    });

    const accessRoles = await this.getOrganizationAccessRoleDefaults(
      session.organizationId,
    );
    return this.buildDiscordConfigResponse(config, accessRoles);
  }

  async update(sessionId: string, dto: UpdateSessionDto, actor: Actor) {
    const session = await this.getSessionOrThrow(sessionId, actor);
    const actorId = this.actorId(actor);

    const nextMaxTeams = dto.maxTeams ?? session.maxTeams;
    const nextSlotCount = dto.slotCount ?? session.slotCount;
    this.validateCapacity(nextMaxTeams, nextSlotCount);

    const registrationOpenAt = this.parseDate(
      'registrationOpenAt',
      dto.registrationOpenAt,
    );
    const registrationCloseAt = this.parseDate(
      'registrationCloseAt',
      dto.registrationCloseAt,
    );
    const checkInOpenAt = this.parseDate('checkInOpenAt', dto.checkInOpenAt);
    const checkInCloseAt = this.parseDate('checkInCloseAt', dto.checkInCloseAt);
    const startsAt = this.parseDate('startsAt', dto.startsAt);
    const endedAt = this.parseDate('endedAt', dto.endedAt);

    const nextRegistrationOpenAt =
      dto.registrationOpenAt !== undefined
        ? registrationOpenAt
        : session.registrationOpenAt;
    const nextRegistrationCloseAt =
      dto.registrationCloseAt !== undefined
        ? registrationCloseAt
        : session.registrationCloseAt;
    const nextCheckInOpenAt =
      dto.checkInOpenAt !== undefined ? checkInOpenAt : session.checkInOpenAt;
    const nextCheckInCloseAt =
      dto.checkInCloseAt !== undefined
        ? checkInCloseAt
        : session.checkInCloseAt;
    const nextStartsAt =
      dto.startsAt !== undefined ? startsAt : session.startsAt;
    const nextEndedAt = dto.endedAt !== undefined ? endedAt : session.endedAt;

    this.validateDateRange(
      nextRegistrationOpenAt,
      nextRegistrationCloseAt,
      'registrationOpenAt',
      'registrationCloseAt',
    );
    this.validateDateRange(
      nextCheckInOpenAt,
      nextCheckInCloseAt,
      'checkInOpenAt',
      'checkInCloseAt',
    );
    this.validateDateRange(nextStartsAt, nextEndedAt, 'startsAt', 'endedAt');

    const nextGameId =
      dto.gameId !== undefined ? this.cleanString(dto.gameId) : session.gameId;
    if (dto.gameId !== undefined) {
      const nextGameKey = await this.resolveGameKey(nextGameId);
      if (nextGameKey) {
        await assertOrganizationGameAccess(
          this.prisma,
          session.organizationId,
          nextGameKey,
        );
      }
    }
    const nextAdapterKey =
      dto.adapterKey !== undefined
        ? this.cleanString(dto.adapterKey)
        : session.adapterKey;
    const validatedAdapterKey = await this.validateAdapterKey(
      nextAdapterKey,
      nextGameId,
    );

    const data: Prisma.SessionUncheckedUpdateInput = {
      updatedById: actorId,
    };

    if (dto.name !== undefined) {
      const name = this.cleanString(dto.name);
      if (!name) {
        throw new BadRequestException('name is required');
      }
      data.name = name;
    }
    if (dto.slug !== undefined) data.slug = this.cleanSlug(dto.slug);
    if (dto.type !== undefined) data.type = dto.type;
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.description !== undefined)
      data.description = this.cleanString(dto.description);
    if (dto.logoUrl !== undefined) data.logoUrl = this.cleanString(dto.logoUrl);
    if (dto.bannerUrl !== undefined)
      data.bannerUrl = this.cleanString(dto.bannerUrl);
    if (dto.rulesetId !== undefined)
      data.rulesetId = this.cleanString(dto.rulesetId);
    if (dto.gameId !== undefined) data.gameId = nextGameId;
    if (dto.adapterKey !== undefined) data.adapterKey = validatedAdapterKey;
    if (dto.maxTeams !== undefined) data.maxTeams = dto.maxTeams;
    if (dto.slotCount !== undefined) data.slotCount = dto.slotCount;
    Object.assign(data, buildQualificationSettingsData(dto));
    if (dto.waitlistEnabled !== undefined)
      data.waitlistEnabled = dto.waitlistEnabled;
    if (dto.checkInEnabled !== undefined)
      data.checkInEnabled = dto.checkInEnabled;
    if (dto.registrationOpenAt !== undefined)
      data.registrationOpenAt = registrationOpenAt ?? null;
    if (dto.registrationCloseAt !== undefined)
      data.registrationCloseAt = registrationCloseAt ?? null;
    if (dto.checkInOpenAt !== undefined)
      data.checkInOpenAt = checkInOpenAt ?? null;
    if (dto.checkInCloseAt !== undefined)
      data.checkInCloseAt = checkInCloseAt ?? null;
    if (dto.startsAt !== undefined) data.startsAt = startsAt ?? null;
    if (dto.endedAt !== undefined) data.endedAt = endedAt ?? null;

    const updated = await this.prisma.session.update({
      where: { id: session.id },
      data,
      select: sessionSelect,
    });
    if (dto.status === SessionStatus.ARCHIVED) {
      await this.disableSessionDiscordConfig(
        session.id,
        session.organizationId,
      );
    }

    const counts = await this.getSessionCounts([updated.id]);
    return this.buildSessionResponse(
      updated,
      counts.get(updated.id) ?? {
        confirmedCount: 0,
        waitlistCount: 0,
        totalRegisteredCount: 0,
      },
    );
  }

  async archive(sessionId: string, actor: Actor) {
    const session = await this.getSessionOrThrow(sessionId, actor);
    const updated = await this.prisma.$transaction(async (tx) => {
      await this.disableSessionDiscordConfig(
        session.id,
        session.organizationId,
        tx,
      );
      return tx.session.update({
        where: { id: session.id },
        data: {
          status: SessionStatus.ARCHIVED,
          updatedById: this.actorId(actor),
        },
        select: sessionSelect,
      });
    });

    const counts = await this.getSessionCounts([updated.id]);
    return this.buildSessionResponse(
      updated,
      counts.get(updated.id) ?? {
        confirmedCount: 0,
        waitlistCount: 0,
        totalRegisteredCount: 0,
      },
    );
  }

  async restore(sessionId: string, actor: Actor) {
    const session = await this.getSessionOrThrow(sessionId, actor);
    if (session.status !== SessionStatus.ARCHIVED) {
      const counts = await this.getSessionCounts([session.id]);
      return this.buildSessionResponse(
        session,
        counts.get(session.id) ?? {
          confirmedCount: 0,
          waitlistCount: 0,
          totalRegisteredCount: 0,
        },
      );
    }

    const updated = await this.prisma.session.update({
      where: { id: session.id },
      data: {
        status: SessionStatus.DRAFT,
        updatedById: this.actorId(actor),
      },
      select: sessionSelect,
    });

    const counts = await this.getSessionCounts([updated.id]);
    return this.buildSessionResponse(
      updated,
      counts.get(updated.id) ?? {
        confirmedCount: 0,
        waitlistCount: 0,
        totalRegisteredCount: 0,
      },
    );
  }

  async softDelete(sessionId: string, actor: Actor) {
    const session = await this.getSessionOrThrow(sessionId, actor);
    await this.prisma.$transaction(async (tx) => {
      await this.disableSessionDiscordConfig(
        session.id,
        session.organizationId,
        tx,
      );
      await tx.session.update({
        where: { id: session.id },
        data: {
          deletedAt: new Date(),
          updatedById: this.actorId(actor),
        },
        select: { id: true },
      });
    });
    return { ok: true };
  }

  async registerTeam(
    sessionId: string,
    dto: RegisterSessionTeamDto,
    actor: Actor,
  ) {
    const session = await this.getSessionOrThrow(sessionId, actor);
    if (session.type === SessionType.SCRIM) {
      await this.assertDiscordAutomationAllowed(session.organizationId);
    }
    if (
      session.status !== SessionStatus.DRAFT &&
      session.status !== SessionStatus.OPEN &&
      session.status !== SessionStatus.CHECKIN
    ) {
      throw new BadRequestException('Session is not accepting registrations');
    }
    if (!dto.bypassRegistrationWindow) {
      await this.assertRegistrationWindowOpen(session, this.prisma);
    }

    const teamId = this.cleanString(dto.teamId);
    if (!teamId) {
      throw new BadRequestException('teamId is required');
    }

    const actorId = this.actorId(actor);

    return this.withSessionMutation(async (tx) => {
      await this.lockSessionRow(tx, session.id);
      const lockedSession = await this.getMutableSessionOrThrow(
        tx,
        session.id,
        session.organizationId,
      );
      if (
        lockedSession.status !== SessionStatus.DRAFT &&
        lockedSession.status !== SessionStatus.OPEN &&
        lockedSession.status !== SessionStatus.CHECKIN
      ) {
        throw new BadRequestException('Session is not accepting registrations');
      }
      if (!dto.bypassRegistrationWindow) {
        await this.assertRegistrationWindowOpen(lockedSession, tx);
      }

      const team = await tx.team.findFirst({
        where: {
          id: teamId,
          organizationId: lockedSession.organizationId,
          deletedAt: null,
        },
        select: {
          id: true,
          name: true,
          tag: true,
          logoUrl: true,
          countryCode: true,
          region: true,
        },
      });
      if (!team) {
        throw new NotFoundException('Team not found');
      }

      const sessionDiscordConfig = (
        tx as Prisma.TransactionClient & {
          sessionDiscordConfig?: Prisma.TransactionClient['sessionDiscordConfig'];
        }
      ).sessionDiscordConfig;
      const discordConfig = sessionDiscordConfig
        ? await sessionDiscordConfig.findUnique({
            where: { sessionId: lockedSession.id },
            select: { id: true },
          })
        : { id: '__legacy_test_discord_session__' };
      const activeBan = discordConfig
        ? await tx.teamBan.findFirst({
            where: {
              organizationId: lockedSession.organizationId,
              teamId,
              revokedAt: null,
              OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
              scope: { in: [TeamBanScope.TEAM, TeamBanScope.SESSION] },
              AND: [
                {
                  OR: [
                    { scope: TeamBanScope.TEAM },
                    {
                      scope: TeamBanScope.SESSION,
                      sessionId: lockedSession.id,
                    },
                  ],
                },
              ],
            },
            select: { scope: true, reason: true },
            orderBy: { createdAt: 'desc' },
          })
        : null;
      if (activeBan) {
        throw new ForbiddenException(
          activeBan.scope === TeamBanScope.SESSION
            ? `Team is banned from this scrim: ${activeBan.reason}`
            : `Team is banned: ${activeBan.reason}`,
        );
      }
      if (discordConfig) {
        await this.assertTeamManagersNotBannedForDiscordSession(
          tx,
          lockedSession.organizationId,
          lockedSession.id,
          teamId,
        );
      }

      const existing = await tx.sessionRegistration.findUnique({
        where: {
          sessionId_teamId: {
            sessionId: session.id,
            teamId,
          },
        },
        select: {
          id: true,
          deletedAt: true,
        },
      });

      if (
        existing?.deletedAt === null &&
        dto.placement !== RegisterSessionTeamPlacement.VIP
      ) {
        throw new BadRequestException(
          'Team is already registered for this session',
        );
      }

      const activeRegistrations = await this.loadConsistentActiveRegistrations(
        tx,
        lockedSession,
      );
      const slotRange = await this.getSlotAssignmentRange(tx, lockedSession);

      const now = new Date();
      const managerSnapshot =
        this.explicitSessionRegistrationManagerSnapshot(dto) ??
        (await this.sessionRegistrationManagerSnapshot(
          tx,
          lockedSession.organizationId,
          teamId,
        ));
      await this.syncTournamentRosterPlayersToTeam(
        tx,
        lockedSession.organizationId,
        teamId,
        dto.tournamentRosterJson,
      );

      const payload: Prisma.SessionRegistrationUncheckedCreateInput = {
        organizationId: lockedSession.organizationId,
        sessionId: lockedSession.id,
        teamId,
        ...managerSnapshot,
        note: this.cleanString(dto.note),
        tournamentRosterJson:
          dto.tournamentRosterJson === undefined
            ? Prisma.DbNull
            : (dto.tournamentRosterJson as Prisma.InputJsonValue),
        registeredById: actorId,
        status: SessionRegistrationStatus.REGISTERED,
        checkedInAt: null,
      };

      if (dto.placement === RegisterSessionTeamPlacement.VIP) {
        const vipRange = await this.getVipSlotAssignmentRange(
          tx,
          lockedSession,
          slotRange,
        );
        if (!vipRange) {
          throw new BadRequestException('No VIP slots are configured');
        }
        const slotNumber = this.lowestAvailableSlot(
          existing?.deletedAt === null
            ? activeRegistrations.filter(
                (registration) => registration.id !== existing.id,
              )
            : activeRegistrations,
          vipRange,
        );
        if (!slotNumber) {
          throw new BadRequestException('VIP slots are full');
        }
        payload.status = SessionRegistrationStatus.CONFIRMED;
        payload.slotNumber = slotNumber;
        payload.confirmedAt = now;
        payload.waitlistPosition = null;
        payload.deletedAt = null;
        payload.removedAt = null;
        payload.removalReason = null;
      } else {
        const slotNumber = this.lowestAvailableSlot(
          activeRegistrations,
          slotRange,
        );
        if (slotNumber) {
          payload.status = SessionRegistrationStatus.CONFIRMED;
          payload.slotNumber = slotNumber;
          payload.confirmedAt = now;
          payload.waitlistPosition = null;
          payload.deletedAt = null;
          payload.removedAt = null;
          payload.removalReason = null;
        } else if (lockedSession.waitlistEnabled) {
          payload.status = SessionRegistrationStatus.WAITLIST;
          payload.slotNumber = null;
          payload.waitlistPosition =
            this.nextWaitlistPosition(activeRegistrations);
          payload.confirmedAt = null;
          payload.deletedAt = null;
          payload.removedAt = null;
          payload.removalReason = null;
        } else {
          throw new BadRequestException('session full');
        }
      }

      // Re-registration intentionally reuses a prior soft-deleted row so the
      // team keeps a stable registration identity across remove/re-add cycles.
      const registration = existing
        ? await tx.sessionRegistration.update({
            where: { id: existing.id },
            data: payload,
            select: sessionRegistrationSelect,
          })
        : await tx.sessionRegistration.create({
            data: payload,
            select: sessionRegistrationSelect,
          });

      await this.loadConsistentActiveRegistrations(tx, lockedSession);

      await this.logAudit({
        action: AuditAction.SESSION_TEAM_REGISTER,
        organizationId: lockedSession.organizationId,
        actor,
        entityType: 'SESSION_REGISTRATION',
        entityId: registration.id,
        after: {
          sessionId: lockedSession.id,
          teamId,
          status: registration.status,
          slotNumber: registration.slotNumber,
          waitlistPosition: registration.waitlistPosition,
        },
      });

      return this.buildRegistrationResponse({
        ...registration,
        team: registration.team ?? team,
      } as SessionRegistrationRecord);
    });
  }

  async listRegistrations(
    sessionId: string,
    query: ListSessionRegistrationsDto,
    actor: Actor,
  ) {
    const session = await this.getSessionOrThrow(sessionId, actor);
    const registrations = await this.prisma.sessionRegistration.findMany({
      where: {
        sessionId: session.id,
        organizationId: session.organizationId,
        deletedAt: null,
        status: query?.status,
      },
      select: sessionRegistrationSelect,
      orderBy: [{ slotNumber: 'asc' }, { waitlistPosition: 'asc' }],
    });

    return registrations
      .slice()
      .sort((left, right) => {
        const leftSlot = left.slotNumber ?? Number.MAX_SAFE_INTEGER;
        const rightSlot = right.slotNumber ?? Number.MAX_SAFE_INTEGER;
        if (leftSlot !== rightSlot) return leftSlot - rightSlot;
        const leftWait = left.waitlistPosition ?? Number.MAX_SAFE_INTEGER;
        const rightWait = right.waitlistPosition ?? Number.MAX_SAFE_INTEGER;
        if (leftWait !== rightWait) return leftWait - rightWait;
        return left.createdAt.getTime() - right.createdAt.getTime();
      })
      .map((registration) => this.buildRegistrationResponse(registration));
  }

  async updateRegistrationPlacement(
    sessionId: string,
    registrationId: string,
    dto: UpdateSessionRegistrationPlacementDto,
    actor: Actor,
  ) {
    const session = await this.getSessionOrThrow(sessionId, actor);
    if (session.type === SessionType.SCRIM) {
      await this.assertDiscordAutomationAllowed(session.organizationId);
    }

    return this.withSessionMutation(async (tx) => {
      await this.lockSessionRow(tx, session.id);
      const lockedSession = await this.getMutableSessionOrThrow(
        tx,
        session.id,
        session.organizationId,
      );
      const activeRegistrations = await this.loadConsistentActiveRegistrations(
        tx,
        lockedSession,
      );

      const registration = await tx.sessionRegistration.findFirst({
        where: {
          id: registrationId,
          sessionId: lockedSession.id,
          organizationId: lockedSession.organizationId,
          deletedAt: null,
        },
        select: sessionRegistrationSelect,
      });
      if (!registration) {
        throw new NotFoundException('Session registration not found');
      }

      const normalRange = await this.getSlotAssignmentRange(tx, lockedSession);
      const vipRange = await this.getVipSlotAssignmentRange(
        tx,
        lockedSession,
        normalRange,
      );
      const otherRegistrations = activeRegistrations.filter(
        (entry) => entry.id !== registration.id,
      );
      const now = new Date();
      const noteUpdate =
        dto.note !== undefined ? { note: this.cleanString(dto.note) } : {};

      let data: Prisma.SessionRegistrationUncheckedUpdateInput;

      switch (dto.action) {
        case SessionRegistrationPlacementAction.APPROVE: {
          const slotNumber = this.lowestAvailableSlot(
            otherRegistrations,
            normalRange,
          );
          if (!slotNumber) {
            throw new BadRequestException(
              'No normal slots available; use VIP or Set Slot',
            );
          }
          data = {
            status: SessionRegistrationStatus.CONFIRMED,
            slotNumber,
            waitlistPosition: null,
            checkedInAt: null,
            confirmedAt: now,
            removedAt: null,
            removalReason: null,
            deletedAt: null,
            ...noteUpdate,
          };
          break;
        }
        case SessionRegistrationPlacementAction.SLOT: {
          if (dto.slotNumber === undefined) {
            throw new BadRequestException('slotNumber is required');
          }
          if (dto.slotNumber > lockedSession.slotCount) {
            throw new BadRequestException(
              `Slot number cannot be greater than ${lockedSession.slotCount}`,
            );
          }
          this.assertSlotInConfiguredRange(
            dto.slotNumber,
            normalRange,
            vipRange,
          );
          this.assertSlotAvailable(
            activeRegistrations,
            registration.id,
            dto.slotNumber,
          );
          data = {
            status: SessionRegistrationStatus.CONFIRMED,
            slotNumber: dto.slotNumber,
            waitlistPosition: null,
            checkedInAt: null,
            confirmedAt: now,
            removedAt: null,
            removalReason: null,
            deletedAt: null,
            ...noteUpdate,
          };
          break;
        }
        case SessionRegistrationPlacementAction.WAITLIST: {
          if (!lockedSession.waitlistEnabled) {
            throw new BadRequestException(
              'Waitlist is disabled for this session',
            );
          }
          data = {
            status: SessionRegistrationStatus.WAITLIST,
            slotNumber: null,
            waitlistPosition: this.nextWaitlistPosition(otherRegistrations),
            checkedInAt: null,
            confirmedAt: null,
            removedAt: null,
            removalReason: null,
            deletedAt: null,
            ...noteUpdate,
          };
          break;
        }
        case SessionRegistrationPlacementAction.VIP: {
          if (!vipRange) {
            throw new BadRequestException('No VIP slots are configured');
          }
          const slotNumber = this.lowestAvailableSlot(
            otherRegistrations,
            vipRange,
          );
          if (!slotNumber) {
            throw new BadRequestException('VIP slots are full');
          }
          data = {
            status: SessionRegistrationStatus.CONFIRMED,
            slotNumber,
            waitlistPosition: null,
            checkedInAt: null,
            confirmedAt: now,
            removedAt: null,
            removalReason: null,
            deletedAt: null,
            ...noteUpdate,
          };
          break;
        }
      }

      await tx.sessionRegistration.update({
        where: { id: registration.id },
        data,
        select: { id: true },
      });
      await this.loadConsistentActiveRegistrations(tx, lockedSession);

      const updated = await tx.sessionRegistration.findFirst({
        where: {
          id: registration.id,
          sessionId: lockedSession.id,
          organizationId: lockedSession.organizationId,
          deletedAt: null,
        },
        select: sessionRegistrationSelect,
      });
      if (!updated) {
        throw new ConflictException(
          'Session registration update did not persist',
        );
      }

      await this.logAudit({
        action: AuditAction.SLOT_SET,
        organizationId: lockedSession.organizationId,
        actor,
        entityType: 'SESSION_REGISTRATION',
        entityId: updated.id,
        before: {
          status: registration.status,
          slotNumber: registration.slotNumber,
          waitlistPosition: registration.waitlistPosition,
        },
        after: {
          action: dto.action,
          status: updated.status,
          slotNumber: updated.slotNumber,
          waitlistPosition: updated.waitlistPosition,
        },
      });

      return this.buildRegistrationResponse(updated);
    });
  }

  async updateRegistrationPlayStatus(
    sessionId: string,
    registrationId: string,
    dto: UpdateSessionRegistrationPlayStatusDto,
    actor: Actor,
  ) {
    const session = await this.getSessionOrThrow(sessionId, actor);
    if (session.type === SessionType.SCRIM) {
      await this.assertDiscordAutomationAllowed(session.organizationId);
    }

    const registration = await this.prisma.sessionRegistration.findFirst({
      where: {
        id: registrationId,
        sessionId: session.id,
        organizationId: session.organizationId,
        deletedAt: null,
      },
      select: sessionRegistrationSelect,
    });
    if (!registration) {
      throw new NotFoundException('Session registration not found');
    }

    const updated = await this.prisma.sessionRegistration.update({
      where: { id: registration.id },
      data: {
        note: this.applyRegistrationPlayStatusNote(registration.note, dto),
      },
      select: sessionRegistrationSelect,
    });

    await this.logAudit({
      action: AuditAction.SLOT_SET,
      organizationId: session.organizationId,
      actor,
      entityType: 'SESSION_REGISTRATION',
      entityId: updated.id,
      before: {
        playStatusNote: registration.note,
      },
      after: {
        action: dto.action,
        discordUserId: this.cleanString(dto.discordUserId),
      },
    });

    return this.buildRegistrationResponse(updated);
  }

  async updateRegistrationManagers(
    sessionId: string,
    registrationId: string,
    dto: UpdateSessionRegistrationManagersDto,
    actor: Actor,
  ) {
    const session = await this.getSessionOrThrow(sessionId, actor);
    if (session.type === SessionType.SCRIM) {
      await this.assertDiscordAutomationAllowed(session.organizationId);
    }

    const registration = await this.prisma.sessionRegistration.findFirst({
      where: {
        id: registrationId,
        sessionId: session.id,
        organizationId: session.organizationId,
        deletedAt: null,
      },
      select: sessionRegistrationSelect,
    });
    if (!registration) {
      throw new NotFoundException('Session registration not found');
    }

    const managerDiscordUserIds = [
      ...new Set(
        dto.managerDiscordUserIds
          .map((discordUserId) => this.cleanString(discordUserId))
          .filter((discordUserId): discordUserId is string =>
            Boolean(discordUserId),
          ),
      ),
    ];
    if (managerDiscordUserIds.length === 0) {
      throw new BadRequestException('At least one Discord manager is required');
    }
    const cleanLeaderDiscordUserId = this.cleanString(dto.leaderDiscordUserId);
    const leaderDiscordUserId =
      cleanLeaderDiscordUserId &&
      managerDiscordUserIds.includes(cleanLeaderDiscordUserId)
        ? cleanLeaderDiscordUserId
        : managerDiscordUserIds[0];

    const updated = await this.prisma.sessionRegistration.update({
      where: { id: registration.id },
      data: {
        leaderDiscordUserId,
        managerDiscordUserIds,
      },
      select: sessionRegistrationSelect,
    });

    await this.logAudit({
      action: AuditAction.SLOT_SET,
      organizationId: session.organizationId,
      actor,
      entityType: 'SESSION_REGISTRATION',
      entityId: updated.id,
      before: {
        leaderDiscordUserId: registration.leaderDiscordUserId,
        managerDiscordUserIds: registration.managerDiscordUserIds,
      },
      after: {
        leaderDiscordUserId: updated.leaderDiscordUserId,
        managerDiscordUserIds: updated.managerDiscordUserIds,
      },
    });

    return this.buildRegistrationResponse(updated);
  }

  async removeRegistration(
    sessionId: string,
    registrationId: string,
    dto: RemoveSessionRegistrationDto,
    actor: Actor,
  ) {
    const session = await this.getSessionOrThrow(sessionId, actor);
    if (session.type === SessionType.SCRIM) {
      await this.assertDiscordAutomationAllowed(session.organizationId);
    }
    const note = this.cleanString(dto.note);
    const removalReason = this.cleanString(dto.removalReason);

    return this.withSessionMutation(async (tx) => {
      await this.lockSessionRow(tx, session.id);
      const lockedSession = await this.getMutableSessionOrThrow(
        tx,
        session.id,
        session.organizationId,
      );
      await this.loadConsistentActiveRegistrations(tx, lockedSession);

      const registration = await tx.sessionRegistration.findFirst({
        where: {
          id: registrationId,
          sessionId: lockedSession.id,
          organizationId: lockedSession.organizationId,
          deletedAt: null,
        },
        select: sessionRegistrationSelect,
      });
      if (!registration) {
        throw new NotFoundException('Session registration not found');
      }

      const removedAt = new Date();
      await tx.sessionRegistration.update({
        where: { id: registration.id },
        data: {
          status: SessionRegistrationStatus.REMOVED,
          slotNumber: null,
          waitlistPosition: null,
          removedAt,
          removalReason,
          note,
          deletedAt: removedAt,
        },
        select: { id: true },
      });

      await this.loadConsistentActiveRegistrations(tx, lockedSession);

      await this.logAudit({
        action: AuditAction.SESSION_REGISTRATION_REMOVE,
        organizationId: lockedSession.organizationId,
        actor,
        entityType: 'SESSION_REGISTRATION',
        entityId: registration.id,
        before: {
          status: registration.status,
          slotNumber: registration.slotNumber,
          waitlistPosition: registration.waitlistPosition,
        },
        after: {
          status: SessionRegistrationStatus.REMOVED,
          removedAt,
          removalReason,
        },
      });

      return {
        removedRegistration: this.buildRegistrationResponse({
          ...registration,
          status: SessionRegistrationStatus.REMOVED,
          slotNumber: null,
          waitlistPosition: null,
          removedAt,
          removalReason,
          note,
          deletedAt: removedAt,
        }),
        promotedRegistration: null,
      };
    });
  }

  async removeSlotRegistrations(
    sessionId: string,
    dto: RemoveSessionRegistrationDto,
    actor: Actor,
  ) {
    const session = await this.getSessionOrThrow(sessionId, actor);
    if (session.type === SessionType.SCRIM) {
      await this.assertDiscordAutomationAllowed(session.organizationId);
    }
    const note = this.cleanString(dto.note);
    const removalReason =
      this.cleanString(dto.removalReason) ||
      'Cleaned all slots via Discord bot';

    return this.withSessionMutation(async (tx) => {
      await this.lockSessionRow(tx, session.id);
      const lockedSession = await this.getMutableSessionOrThrow(
        tx,
        session.id,
        session.organizationId,
      );
      const resultReset = await this.clearSessionResultSystem(
        tx,
        lockedSession,
        removalReason,
      );
      await this.loadConsistentActiveRegistrations(tx, lockedSession);

      const registrations = await tx.sessionRegistration.findMany({
        where: {
          sessionId: lockedSession.id,
          organizationId: lockedSession.organizationId,
          deletedAt: null,
          slotNumber: { not: null },
        },
        select: sessionRegistrationSelect,
        orderBy: { slotNumber: 'asc' },
      });

      if (!registrations.length) {
        await this.logAudit({
          action: AuditAction.MATCH_RESULT_EDIT,
          organizationId: lockedSession.organizationId,
          actor,
          entityType: 'SESSION_RESULT_SYSTEM',
          entityId: lockedSession.id,
          after: {
            reason: removalReason,
            resetAt: resultReset.resetAt,
            matchesRemoved: resultReset.matchesRemoved,
            matchIds: resultReset.matchIds,
            trigger: 'removeSlotRegistrations',
          },
        });

        return {
          removedRegistrations: [],
          removedTeamIds: [],
          removedSlots: [],
          resultReset,
        };
      }

      const removedAt = new Date();
      await tx.sessionRegistration.updateMany({
        where: {
          id: { in: registrations.map((registration) => registration.id) },
          sessionId: lockedSession.id,
          organizationId: lockedSession.organizationId,
          deletedAt: null,
        },
        data: {
          status: SessionRegistrationStatus.REMOVED,
          slotNumber: null,
          waitlistPosition: null,
          removedAt,
          removalReason,
          note,
          deletedAt: removedAt,
        },
      });

      await this.loadConsistentActiveRegistrations(tx, lockedSession);

      for (const registration of registrations) {
        await this.logAudit({
          action: AuditAction.SESSION_REGISTRATION_REMOVE,
          organizationId: lockedSession.organizationId,
          actor,
          entityType: 'SESSION_REGISTRATION',
          entityId: registration.id,
          before: {
            status: registration.status,
            slotNumber: registration.slotNumber,
            waitlistPosition: registration.waitlistPosition,
          },
          after: {
            status: SessionRegistrationStatus.REMOVED,
            removedAt,
            removalReason,
            bulk: true,
          },
        });
      }

      await this.logAudit({
        action: AuditAction.MATCH_RESULT_EDIT,
        organizationId: lockedSession.organizationId,
        actor,
        entityType: 'SESSION_RESULT_SYSTEM',
        entityId: lockedSession.id,
        after: {
          reason: removalReason,
          resetAt: resultReset.resetAt,
          matchesRemoved: resultReset.matchesRemoved,
          matchIds: resultReset.matchIds,
          trigger: 'removeSlotRegistrations',
        },
      });

      return {
        removedRegistrations: registrations.map((registration) =>
          this.buildRegistrationResponse({
            ...registration,
            status: SessionRegistrationStatus.REMOVED,
            slotNumber: null,
            waitlistPosition: null,
            removedAt,
            removalReason,
            note,
            deletedAt: removedAt,
          }),
        ),
        removedTeamIds: registrations.map(
          (registration) => registration.teamId,
        ),
        removedSlots: registrations
          .map((registration) => registration.slotNumber)
          .filter((slotNumber): slotNumber is number => slotNumber !== null),
        resultReset,
      };
    });
  }

  async createMatch(
    sessionId: string,
    dto: SessionMatchCreatePayload,
    actor: Actor,
  ) {
    const session = await this.getSessionOrThrow(sessionId, actor);
    if (Number.isInteger(dto.matchNumber) && Number(dto.matchNumber) > 0) {
      await this.prisma.noShowBanSnapshot.deleteMany({
        where: {
          organizationId: session.organizationId,
          sessionId: session.id,
          matchNumber: Number(dto.matchNumber),
        },
      });
    }
    const created = await this.matches.createForSession(actor, session.id, dto);
    if (session.type === SessionType.EVENT) {
      const matchId = (created as { id?: string | null }).id ?? null;
      if (matchId) {
        await this.syncMatchSlotsFromRegistrations(session.id, matchId, actor);
      }
    }
    await this.logAudit({
      action: AuditAction.SESSION_MATCH_CREATE,
      organizationId: session.organizationId,
      actor,
      entityType: 'MATCH',
      entityId: `${(created as { id?: string }).id ?? ''}`,
      after: {
        sessionId: session.id,
        name: (created as { name?: string | null }).name ?? null,
      },
    });
    return created;
  }

  async listMatches(sessionId: string, actor: Actor) {
    const session = await this.getSessionOrThrow(sessionId, actor);
    const matches = await this.matches.listBySession(actor, session.id);
    return matches.map((match) => ({
      id: match.id,
      sessionId: match.sessionId,
      name: match.name,
      status: match.status,
      liveState: match.liveState,
      matchNumber: match.matchNumber,
      slotCount: match.slotCount,
      map: match.map,
      dataMode: match.dataMode,
      dataSource: match.dataSource,
      resultSource: match.resultSource,
      scheduledAt: match.scheduledAt,
      startedAt: match.startedAt,
      endedAt: match.endedAt,
      createdAt: match.createdAt,
      updatedAt: match.updatedAt,
      teamCount: match._count.matchTeams,
    }));
  }

  async syncMatchSlotsFromRegistrations(
    sessionId: string,
    matchId: string,
    actor: Actor,
  ) {
    const session = await this.getSessionOrThrow(sessionId, actor);
    const match = await this.prisma.match.findFirst({
      where: {
        id: matchId,
        sessionId: session.id,
        organizationId: session.organizationId,
        deletedAt: null,
      },
      select: {
        id: true,
        dataMode: true,
        dataSource: true,
      },
    });
    if (!match) {
      throw new NotFoundException('Match not found');
    }

    return syncMatchSlotsWithSessionRegistrations(this.prisma, {
      sessionId: session.id,
      organizationId: session.organizationId,
      matchId: match.id,
      dataMode: match.dataMode,
      dataSource: match.dataSource,
    });
  }
}
