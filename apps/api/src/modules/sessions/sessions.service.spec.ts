import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditAction,
  GameKey,
  Prisma,
  PlayerSource,
  Role,
  OrganizationStatus,
  OrganizationSubscriptionStatus,
  SessionRegistrationStatus,
  SessionStatus,
  SessionType,
  TeamBanScope,
  TeamMemberRole,
} from '@prisma/client';
import type { AuthUser } from '../../common/auth/auth.types';
import type { PrismaService } from '../../db/prisma.service';
import { RegisterSessionTeamPlacement } from './dto/register-session-team.dto';
import { SessionRegistrationPlacementAction } from './dto/update-session-registration-placement.dto';
import { SessionsService } from './sessions.service';

type TestActor = AuthUser;

type SessionRecord = {
  id: string;
  organizationId: string;
  name: string;
  slug: string | null;
  type: SessionType;
  status: SessionStatus;
  description: string | null;
  rulesetId: string | null;
  gameId: string | null;
  adapterKey: string | null;
  maxTeams: number;
  slotCount: number;
  waitlistEnabled: boolean;
  checkInEnabled: boolean;
  registrationOpenAt: Date | null;
  registrationCloseAt: Date | null;
  checkInOpenAt: Date | null;
  checkInCloseAt: Date | null;
  startsAt: Date | null;
  endedAt: Date | null;
  createdById: string | null;
  updatedById: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
};

type TeamRecord = {
  id: string;
  organizationId: string;
  name: string;
  tag: string | null;
  logoUrl: string | null;
  countryCode: string | null;
  region: string | null;
  deletedAt: Date | null;
};

type RegistrationRecord = {
  id: string;
  organizationId: string;
  sessionId: string;
  teamId: string;
  leaderDiscordUserId: string | null;
  managerDiscordUserIds: string[];
  status: SessionRegistrationStatus;
  slotNumber: number | null;
  waitlistPosition: number | null;
  checkedInAt: Date | null;
  confirmedAt: Date | null;
  removedAt: Date | null;
  removalReason: string | null;
  note: string | null;
  tournamentRosterJson: Prisma.JsonValue | null;
  registeredById: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
};

type TeamMemberRecord = {
  id: string;
  organizationId: string;
  teamId: string;
  discordUserId: string;
  role: TeamMemberRole;
  createdAt: Date;
  leftAt: Date | null;
  deletedAt: Date | null;
};

type PlayerRecord = {
  id: string;
  organizationId: string;
  teamId: string | null;
  ign: string;
  inGameId: string | null;
  pubgPlayerId: string | null;
  externalPlayerId: string | null;
  photoUrl: string | null;
  source: PlayerSource;
  isActive: boolean;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type RosterEntryRecord = {
  id: string;
  teamId: string;
  playerId: string;
  startAt: Date;
  isActive: boolean;
  createdAt: Date;
};

type DiscordConfigRecord = {
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
  importSourceOrganizationId: string | null;
  importSourceGuildId: string | null;
  importSourceGuildName: string | null;
  importSourceCategoryId: string | null;
  importSourceCategoryName: string | null;
  importSourceSlotListChannelId: string | null;
  importSourceSlotListChannelName: string | null;
  importSourceSyncEnabled: boolean;
  importSourceLastSyncedAt: Date | null;
  importSourceLastError: string | null;
  emojis: unknown;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type OrganizationDiscordConfigRecord = {
  organizationId: string;
  enabled?: boolean;
  guildId: string | null;
  guildName: string | null;
  logoChannelIds: string | null;
  maxSessionCount: number;
  accessExpiresAt: Date | null;
  staffRoleIds?: unknown;
};

type GameRecord = {
  id: string;
  key: GameKey;
};

type OrganizationRecord = {
  id: string;
  isActive: boolean;
  status: OrganizationStatus;
  planId: string | null;
  accessMode: string | null;
  enabledGames: GameKey[];
  subscriptionStatus: OrganizationSubscriptionStatus;
  trialEndsAt: Date | null;
  paidUntil: Date | null;
  deletedAt: Date | null;
};

type TeamBanRecord = {
  id: string;
  organizationId: string;
  teamId: string;
  scope: TeamBanScope;
  sessionId: string | null;
  matchId: string | null;
  reason: string;
  note: string | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  revokeReason: string | null;
  createdById: string | null;
  revokedById: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function createActor(orgId = 'org-1'): TestActor {
  return {
    id: `user-${orgId}`,
    actorId: `user-${orgId}`,
    role: Role.ORGANIZER,
    actorRole: Role.ORGANIZER,
    organizationId: orgId,
    orgId,
    actingOrgId: orgId,
    actingRole: Role.ORGANIZER,
    actingOrgName: `Org ${orgId}`,
    actingAsUserId: null,
    realRole: Role.ORGANIZER,
    email: null,
  };
}

function createPrismaMock(seed?: {
  sessions?: SessionRecord[];
  teams?: TeamRecord[];
  registrations?: RegistrationRecord[];
  discordConfigs?: DiscordConfigRecord[];
  orgDiscordConfigs?: OrganizationDiscordConfigRecord[];
  games?: GameRecord[];
  teamBans?: TeamBanRecord[];
  teamMembers?: TeamMemberRecord[];
  players?: PlayerRecord[];
  rosterEntries?: RosterEntryRecord[];
  organizations?: OrganizationRecord[];
}) {
  const state = {
    sessions: [...(seed?.sessions ?? [])],
    teams: [...(seed?.teams ?? [])],
    teamMembers: [...(seed?.teamMembers ?? [])],
    players: [...(seed?.players ?? [])],
    rosterEntries: [...(seed?.rosterEntries ?? [])],
    registrations: [...(seed?.registrations ?? [])],
    discordConfigs: [...(seed?.discordConfigs ?? [])],
    orgDiscordConfigs:
      seed?.orgDiscordConfigs !== undefined
        ? [...seed.orgDiscordConfigs]
        : [
            {
              organizationId: 'org-1',
              enabled: true,
              guildId: '775509232354983967',
              guildName: 'Org Guild',
              logoChannelIds: null,
              maxSessionCount: 100,
              accessExpiresAt: null,
              staffRoleIds: null,
            },
          ],
    organizations: [
      ...(seed?.organizations ?? [
        {
          id: 'org-1',
          isActive: true,
          status: OrganizationStatus.APPROVED,
          planId: null,
          accessMode: null,
          enabledGames: [
            GameKey.PUBG_MOBILE,
            GameKey.FREE_FIRE,
            GameKey.VALORANT,
            GameKey.CALL_OF_DUTY,
            GameKey.CRICKET,
          ],
          subscriptionStatus: OrganizationSubscriptionStatus.ACTIVE,
          trialEndsAt: null,
          paidUntil: null,
          deletedAt: null,
        },
      ]),
    ],
    teamBans: [...(seed?.teamBans ?? [])],
    games: [
      ...(seed?.games ?? [
        { id: 'game-pubgm', key: GameKey.PUBG_MOBILE },
        { id: 'game-ff', key: GameKey.FREE_FIRE },
      ]),
    ],
    sessionSeq: 0,
    registrationSeq: 0,
    discordConfigSeq: 0,
    playerSeq: 0,
    rosterEntrySeq: 0,
  };

  const withTeam = (registration: RegistrationRecord) => ({
    ...registration,
    team: state.teams.find((team) => team.id === registration.teamId) ?? null,
  });

  const makeDiscordConfig = (
    data: Record<string, any>,
    existing?: DiscordConfigRecord,
  ): DiscordConfigRecord => {
    const now = new Date();
    const value = <T>(field: string, fallback: T): T =>
      Object.prototype.hasOwnProperty.call(data, field)
        ? data[field]
        : (((existing as Record<string, unknown> | undefined)?.[field] as T) ??
          fallback);
    return {
      id:
        existing?.id ?? data.id ?? `discord-config-${++state.discordConfigSeq}`,
      organizationId: data.organizationId ?? existing?.organizationId,
      sessionId: data.sessionId ?? existing?.sessionId,
      enabled: data.enabled ?? existing?.enabled ?? true,
      registrationMode:
        data.registrationMode ?? existing?.registrationMode ?? 'SCRIM',
      guildId: value('guildId', null),
      categoryId: data.categoryId ?? existing?.categoryId ?? null,
      categoryName: data.categoryName ?? existing?.categoryName ?? null,
      registrationChannelId: value('registrationChannelId', null),
      registrationChannelName:
        data.registrationChannelName ??
        existing?.registrationChannelName ??
        null,
      slotListChannelId: value('slotListChannelId', null),
      slotListChannelName:
        data.slotListChannelName ?? existing?.slotListChannelName ?? null,
      waitlistChannelId:
        data.waitlistChannelId ?? existing?.waitlistChannelId ?? null,
      waitlistChannelName:
        data.waitlistChannelName ?? existing?.waitlistChannelName ?? null,
      idpChannelId: data.idpChannelId ?? existing?.idpChannelId ?? null,
      idpChannelName: data.idpChannelName ?? existing?.idpChannelName ?? null,
      managerChannelId:
        data.managerChannelId ?? existing?.managerChannelId ?? null,
      managerChannelName:
        data.managerChannelName ?? existing?.managerChannelName ?? null,
      transferChannelId:
        data.transferChannelId ?? existing?.transferChannelId ?? null,
      transferChannelName:
        data.transferChannelName ?? existing?.transferChannelName ?? null,
      manageChannelId:
        data.manageChannelId ?? existing?.manageChannelId ?? null,
      manageChannelName:
        data.manageChannelName ?? existing?.manageChannelName ?? null,
      resultsChannelId:
        data.resultsChannelId ?? existing?.resultsChannelId ?? null,
      resultsChannelName:
        data.resultsChannelName ?? existing?.resultsChannelName ?? null,
      screenshotsChannelId:
        data.screenshotsChannelId ?? existing?.screenshotsChannelId ?? null,
      screenshotsChannelName:
        data.screenshotsChannelName ?? existing?.screenshotsChannelName ?? null,
      bansChannelId: data.bansChannelId ?? existing?.bansChannelId ?? null,
      bansChannelName:
        data.bansChannelName ?? existing?.bansChannelName ?? null,
      logChannelId: data.logChannelId ?? existing?.logChannelId ?? null,
      logChannelName: data.logChannelName ?? existing?.logChannelName ?? null,
      slotRoleId: data.slotRoleId ?? existing?.slotRoleId ?? null,
      slotRoleName: data.slotRoleName ?? existing?.slotRoleName ?? null,
      waitlistRoleId: data.waitlistRoleId ?? existing?.waitlistRoleId ?? null,
      waitlistRoleName:
        data.waitlistRoleName ?? existing?.waitlistRoleName ?? null,
      idpRoleId: data.idpRoleId ?? existing?.idpRoleId ?? null,
      idpRoleName: data.idpRoleName ?? existing?.idpRoleName ?? null,
      bannedRoleId: data.bannedRoleId ?? existing?.bannedRoleId ?? null,
      bannedRoleName: data.bannedRoleName ?? existing?.bannedRoleName ?? null,
      registrationRoleIds:
        data.registrationRoleIds ?? existing?.registrationRoleIds ?? null,
      specialRegistrationRoleIds:
        data.specialRegistrationRoleIds ??
        existing?.specialRegistrationRoleIds ??
        null,
      manageRoleIds: value('manageRoleIds', null),
      vipRoleIds: data.vipRoleIds ?? existing?.vipRoleIds ?? null,
      startSlot: data.startSlot ?? existing?.startSlot ?? 3,
      normalSlots: data.normalSlots ?? existing?.normalSlots ?? 23,
      vipSlots: data.vipSlots ?? existing?.vipSlots ?? 0,
      maxManagersPerTeam:
        data.maxManagersPerTeam ?? existing?.maxManagersPerTeam ?? 2,
      maxTeamsPerManager:
        data.maxTeamsPerManager ?? existing?.maxTeamsPerManager ?? 1,
      registrationCommand:
        data.registrationCommand ??
        existing?.registrationCommand ??
        '%register',
      registrationFormat:
        data.registrationFormat ??
        existing?.registrationFormat ??
        '%register\nTeam Name\nTeam Tag\n@managers',
      disableSlotAndVipRegistration:
        data.disableSlotAndVipRegistration ??
        existing?.disableSlotAndVipRegistration ??
        false,
      slotTeamEmojiEnabled:
        data.slotTeamEmojiEnabled ?? existing?.slotTeamEmojiEnabled ?? true,
      downloadPlayerElims:
        data.downloadPlayerElims ?? existing?.downloadPlayerElims ?? true,
      spreadsheetId: data.spreadsheetId ?? existing?.spreadsheetId ?? null,
      importSourceOrganizationId:
        data.importSourceOrganizationId ??
        existing?.importSourceOrganizationId ??
        null,
      importSourceGuildId:
        data.importSourceGuildId ?? existing?.importSourceGuildId ?? null,
      importSourceGuildName:
        data.importSourceGuildName ?? existing?.importSourceGuildName ?? null,
      importSourceCategoryId:
        data.importSourceCategoryId ?? existing?.importSourceCategoryId ?? null,
      importSourceCategoryName:
        data.importSourceCategoryName ??
        existing?.importSourceCategoryName ??
        null,
      importSourceSlotListChannelId:
        data.importSourceSlotListChannelId ??
        existing?.importSourceSlotListChannelId ??
        null,
      importSourceSlotListChannelName:
        data.importSourceSlotListChannelName ??
        existing?.importSourceSlotListChannelName ??
        null,
      importSourceSyncEnabled:
        data.importSourceSyncEnabled ??
        existing?.importSourceSyncEnabled ??
        false,
      importSourceLastSyncedAt:
        data.importSourceLastSyncedAt ??
        existing?.importSourceLastSyncedAt ??
        null,
      importSourceLastError:
        data.importSourceLastError ?? existing?.importSourceLastError ?? null,
      emojis: data.emojis ??
        existing?.emojis ?? {
          check: 'CHECK',
          reject: 'X',
          waitlist: 'WAITLIST',
          ban: 'BAN',
          vip: 'VIP',
          slot: 'SLOT',
        },
      notes: data.notes ?? existing?.notes ?? null,
      createdAt: existing?.createdAt ?? data.createdAt ?? now,
      updatedAt: data.updatedAt ?? now,
    };
  };

  const sortRows = (
    rows: Array<Record<string, unknown>>,
    orderBy:
      | Array<Record<string, 'asc' | 'desc'>>
      | Record<string, 'asc' | 'desc'>
      | undefined,
  ) => {
    const clauses = Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : [];
    return rows.slice().sort((left, right) => {
      for (const clause of clauses) {
        const [field, direction] = Object.entries(clause)[0] ?? [];
        if (!field || !direction) continue;
        const a = left[field] as Date | number | string | null | undefined;
        const b = right[field] as Date | number | string | null | undefined;
        const leftValue =
          a instanceof Date ? a.getTime() : (a ?? Number.MAX_SAFE_INTEGER);
        const rightValue =
          b instanceof Date ? b.getTime() : (b ?? Number.MAX_SAFE_INTEGER);
        if (leftValue === rightValue) continue;
        const delta = leftValue > rightValue ? 1 : -1;
        return direction === 'desc' ? delta * -1 : delta;
      }
      return 0;
    });
  };

  const filterRegistrations = (where: Record<string, any> = {}) =>
    state.registrations.filter((registration) => {
      if (where.id && registration.id !== where.id) return false;
      if (where.sessionId && registration.sessionId !== where.sessionId)
        return false;
      if (
        where.organizationId &&
        registration.organizationId !== where.organizationId
      )
        return false;
      if (
        where.sessionId?.in &&
        !where.sessionId.in.includes(registration.sessionId)
      ) {
        return false;
      }
      if (where.teamId && registration.teamId !== where.teamId) return false;
      if (where.status && registration.status !== where.status) return false;
      if (where.deletedAt === null && registration.deletedAt !== null)
        return false;
      if (where.slotNumber?.not === null && registration.slotNumber === null)
        return false;
      return true;
    });

  const matchesTeamBanWhere = (
    ban: TeamBanRecord,
    where: Record<string, any> = {},
  ): boolean => {
    if (where.id && ban.id !== where.id) return false;
    if (where.organizationId && ban.organizationId !== where.organizationId)
      return false;
    if (where.teamId) {
      if (typeof where.teamId === 'string' && ban.teamId !== where.teamId)
        return false;
      if (where.teamId.in && !where.teamId.in.includes(ban.teamId))
        return false;
    }
    if (where.scope) {
      if (typeof where.scope === 'string' && ban.scope !== where.scope)
        return false;
      if (where.scope.in && !where.scope.in.includes(ban.scope)) return false;
    }
    if (Object.prototype.hasOwnProperty.call(where, 'sessionId')) {
      if (where.sessionId === null && ban.sessionId !== null) return false;
      if (
        typeof where.sessionId === 'string' &&
        ban.sessionId !== where.sessionId
      )
        return false;
    }
    if (Object.prototype.hasOwnProperty.call(where, 'matchId')) {
      if (where.matchId === null && ban.matchId !== null) return false;
      if (typeof where.matchId === 'string' && ban.matchId !== where.matchId)
        return false;
    }
    if (where.revokedAt === null && ban.revokedAt !== null) return false;
    if (where.revokedAt?.not === null && ban.revokedAt === null) return false;
    if (Object.prototype.hasOwnProperty.call(where, 'expiresAt')) {
      if (where.expiresAt === null && ban.expiresAt !== null) return false;
      if (
        where.expiresAt?.gt &&
        !(ban.expiresAt && ban.expiresAt > where.expiresAt.gt)
      )
        return false;
      if (
        where.expiresAt?.lte &&
        !(ban.expiresAt && ban.expiresAt <= where.expiresAt.lte)
      )
        return false;
    }
    if (
      where.OR &&
      !where.OR.some((clause: Record<string, any>) =>
        matchesTeamBanWhere(ban, clause),
      )
    ) {
      return false;
    }
    if (
      where.AND &&
      !where.AND.every((clause: Record<string, any>) =>
        matchesTeamBanWhere(ban, clause),
      )
    ) {
      return false;
    }
    return true;
  };

  const filterTeamBans = (where: Record<string, any> = {}) =>
    state.teamBans.filter((ban) => matchesTeamBanWhere(ban, where));

  const matchesDiscordConfigWhere = (
    config: DiscordConfigRecord,
    where: Record<string, any> = {},
  ): boolean => {
    if (where.organizationId) {
      if (
        typeof where.organizationId === 'string' &&
        config.organizationId !== where.organizationId
      ) {
        return false;
      }
      if (
        where.organizationId.in &&
        !where.organizationId.in.includes(config.organizationId)
      ) {
        return false;
      }
    }
    if (where.guildId && config.guildId !== where.guildId) return false;
    if (
      where.importSourceGuildId &&
      config.importSourceGuildId !== where.importSourceGuildId
    )
      return false;
    if (
      where.importSourceCategoryId &&
      config.importSourceCategoryId !== where.importSourceCategoryId
    )
      return false;
    if (where.sessionId && config.sessionId !== where.sessionId) return false;
    if (where.OR) {
      if (
        !where.OR.some((clause: Record<string, any>) =>
          matchesDiscordConfigWhere(config, clause),
        )
      ) {
        return false;
      }
    }
    const channelFields: Array<keyof DiscordConfigRecord> = [
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
    ];
    for (const field of channelFields) {
      if (where[field] && config[field] !== where[field]) return false;
    }
    if (where.session) {
      const session = state.sessions.find(
        (item) => item.id === config.sessionId,
      );
      if (!session) return false;
      if (where.session.deletedAt === null && session.deletedAt !== null)
        return false;
      if (where.session.type && session.type !== where.session.type)
        return false;
    }
    return true;
  };

  const withDiscordSession = (config: DiscordConfigRecord) => ({
    ...config,
    session: state.sessions.find((session) => session.id === config.sessionId),
  });

  const prisma = {
    __state: state,
    session: {
      create: jest.fn(async ({ data }: { data: Record<string, any> }) => {
        const now = new Date();
        const session: SessionRecord = {
          id: data.id ?? `session-${++state.sessionSeq}`,
          organizationId: data.organizationId,
          name: data.name,
          slug: data.slug ?? null,
          type: data.type ?? SessionType.SCRIM,
          status: data.status ?? SessionStatus.DRAFT,
          description: data.description ?? null,
          rulesetId: data.rulesetId ?? null,
          gameId: data.gameId ?? null,
          adapterKey: data.adapterKey ?? null,
          maxTeams: data.maxTeams ?? 25,
          slotCount: data.slotCount ?? 25,
          waitlistEnabled: data.waitlistEnabled ?? true,
          checkInEnabled: data.checkInEnabled ?? false,
          registrationOpenAt: data.registrationOpenAt ?? null,
          registrationCloseAt: data.registrationCloseAt ?? null,
          checkInOpenAt: data.checkInOpenAt ?? null,
          checkInCloseAt: data.checkInCloseAt ?? null,
          startsAt: data.startsAt ?? null,
          endedAt: data.endedAt ?? null,
          createdById: data.createdById ?? null,
          updatedById: data.updatedById ?? null,
          createdAt: data.createdAt ?? now,
          updatedAt: data.updatedAt ?? now,
          deletedAt: data.deletedAt ?? null,
        };
        state.sessions.push(session);
        return session;
      }),
      findMany: jest.fn(
        async ({
          where,
          orderBy,
        }: {
          where: Record<string, any>;
          orderBy?: any;
        }) =>
          sortRows(
            state.sessions.filter((session) => {
              if (
                where.organizationId &&
                session.organizationId !== where.organizationId
              )
                return false;
              if (where.deletedAt === null && session.deletedAt !== null)
                return false;
              if (where.status && session.status !== where.status) return false;
              if (where.type && session.type !== where.type) return false;
              return true;
            }),
            orderBy,
          ),
      ),
      findFirst: jest.fn(
        async ({ where }: { where: Record<string, any> }) =>
          state.sessions.find((session) => {
            if (where.id && session.id !== where.id) return false;
            if (
              where.organizationId &&
              session.organizationId !== where.organizationId
            )
              return false;
            if (where.deletedAt === null && session.deletedAt !== null)
              return false;
            return true;
          }) ?? null,
      ),
      update: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Record<string, any>;
        }) => {
          const session = state.sessions.find((item) => item.id === where.id);
          if (!session) throw new Error('Session not found');
          Object.assign(session, data, {
            updatedAt: data.updatedAt ?? new Date(),
          });
          return session;
        },
      ),
    },
    sessionDiscordConfig: {
      findUnique: jest.fn(async ({ where }: { where: Record<string, any> }) => {
        if (!where.sessionId) return null;
        return (
          state.discordConfigs.find(
            (config) => config.sessionId === where.sessionId,
          ) ?? null
        );
      }),
      findFirst: jest.fn(
        async ({
          where,
          orderBy,
        }: {
          where?: Record<string, any>;
          orderBy?: any;
        }) => {
          const config =
            sortRows(
              state.discordConfigs.filter((item) =>
                matchesDiscordConfigWhere(item, where),
              ),
              orderBy,
            )[0] ?? null;
          return config ? withDiscordSession(config) : null;
        },
      ),
      findMany: jest.fn(
        async ({
          where,
          orderBy,
        }: {
          where?: Record<string, any>;
          orderBy?: any;
        }) =>
          sortRows(
            state.discordConfigs.filter((item) =>
              matchesDiscordConfigWhere(item, where),
            ),
            orderBy,
          ).map(withDiscordSession),
      ),
      update: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { id?: string; sessionId?: string };
          data: Record<string, any>;
        }) => {
          const existing = state.discordConfigs.find((config) =>
            where.id
              ? config.id === where.id
              : config.sessionId === where.sessionId,
          );
          if (!existing) throw new Error('Discord config not found');
          Object.assign(existing, data, {
            updatedAt: data.updatedAt ?? new Date(),
          });
          return existing;
        },
      ),
      updateMany: jest.fn(
        async ({
          where,
          data,
        }: {
          where: Record<string, any>;
          data: Record<string, any>;
        }) => {
          let count = 0;
          for (const config of state.discordConfigs) {
            if (where.sessionId && config.sessionId !== where.sessionId) {
              continue;
            }
            if (
              where.organizationId &&
              config.organizationId !== where.organizationId
            ) {
              continue;
            }
            Object.assign(config, data, {
              updatedAt: data.updatedAt ?? new Date(),
            });
            count += 1;
          }
          return { count };
        },
      ),
      upsert: jest.fn(
        async ({
          where,
          update,
          create,
        }: {
          where: { sessionId: string };
          update: Record<string, any>;
          create: Record<string, any>;
        }) => {
          const existing = state.discordConfigs.find(
            (config) => config.sessionId === where.sessionId,
          );
          if (existing) {
            const next = makeDiscordConfig(update, existing);
            Object.assign(existing, next);
            return existing;
          }
          const created = makeDiscordConfig(create);
          state.discordConfigs.push(created);
          return created;
        },
      ),
    },
    organizationDiscordConfig: {
      findFirst: jest.fn(
        async ({
          where,
        }: {
          where?: Record<string, any>;
          select?: Record<string, any>;
          orderBy?: any;
        }) => {
          const found =
            state.orgDiscordConfigs.find((config) => {
              if (
                where?.organizationId &&
                config.organizationId !== where.organizationId
              ) {
                return false;
              }
              if (where?.guildId && config.guildId !== where.guildId) {
                return false;
              }
              if (where?.enabled === true && config.enabled === false) {
                return false;
              }
              if (where?.organization?.deletedAt === null) {
                const organization = state.organizations.find(
                  (item) => item.id === config.organizationId,
                );
                if (!organization || organization.deletedAt !== null) {
                  return false;
                }
              }
              return true;
            }) ?? null;
          if (!found) return null;
          const organization = state.organizations.find(
            (item) => item.id === found.organizationId,
          );
          return {
            ...found,
            organization: organization
              ? {
                  id: organization.id,
                  name: `Org ${organization.id}`,
                  slug: organization.id,
                }
              : null,
          };
        },
      ),
      findUnique: jest.fn(
        async ({
          where,
          select,
        }: {
          where: { organizationId: string };
          select: Record<string, true>;
        }) => {
          const found =
            state.orgDiscordConfigs.find(
              (config) => config.organizationId === where.organizationId,
            ) ?? null;
          if (!found) return null;
          const result: Record<string, unknown> = {};
          for (const field of Object.keys(select)) {
            result[field] =
              found[field as keyof OrganizationDiscordConfigRecord];
          }
          return result;
        },
      ),
      findMany: jest.fn(async ({ where }: { where?: Record<string, any> }) =>
        state.orgDiscordConfigs.filter((config) => {
          if (
            where?.organizationId &&
            config.organizationId !== where.organizationId
          ) {
            return false;
          }
          if (where?.guildId && config.guildId !== where.guildId) {
            return false;
          }
          return true;
        }),
      ),
    },
    organizationDiscordGuild: {
      findFirst: jest.fn(async () => null),
      findMany: jest.fn(async () => []),
    },
    organization: {
      findFirst: jest.fn(
        async ({
          where,
          select,
        }: {
          where: Record<string, any>;
          select?: Record<string, true>;
        }) => {
          const organization =
            state.organizations.find((item) => {
              if (where.id && item.id !== where.id) return false;
              if (where.deletedAt === null && item.deletedAt !== null)
                return false;
              return true;
            }) ?? null;
          if (!organization || !select) return organization;
          return Object.fromEntries(
            Object.keys(select).map((field) => {
              if (field === 'discordConfig') {
                return [
                  field,
                  state.orgDiscordConfigs.find(
                    (config) => config.organizationId === organization.id,
                  ) ?? null,
                ];
              }
              return [field, organization[field as keyof OrganizationRecord]];
            }),
          );
        },
      ),
    },
    sessionRegistration: {
      findMany: jest.fn(
        async ({
          where,
          orderBy,
        }: {
          where?: Record<string, any>;
          orderBy?: any;
        }) => sortRows(filterRegistrations(where), orderBy).map(withTeam),
      ),
      findFirst: jest.fn(
        async ({
          where,
          orderBy,
        }: {
          where?: Record<string, any>;
          orderBy?: any;
        }) =>
          sortRows(filterRegistrations(where), orderBy).map(withTeam)[0] ??
          null,
      ),
      findUnique: jest.fn(async ({ where }: { where: Record<string, any> }) => {
        if (where.id) {
          const byId = state.registrations.find(
            (registration) => registration.id === where.id,
          );
          return byId ? withTeam(byId) : null;
        }
        const composite = where.sessionId_teamId;
        if (!composite) return null;
        const found = state.registrations.find(
          (registration) =>
            registration.sessionId === composite.sessionId &&
            registration.teamId === composite.teamId,
        );
        return found ? withTeam(found) : null;
      }),
      create: jest.fn(async ({ data }: { data: Record<string, any> }) => {
        const now = new Date();
        const registration: RegistrationRecord = {
          id: data.id ?? `registration-${++state.registrationSeq}`,
          organizationId: data.organizationId,
          sessionId: data.sessionId,
          teamId: data.teamId,
          leaderDiscordUserId: data.leaderDiscordUserId ?? null,
          managerDiscordUserIds: data.managerDiscordUserIds ?? [],
          status: data.status,
          slotNumber: data.slotNumber ?? null,
          waitlistPosition: data.waitlistPosition ?? null,
          checkedInAt: data.checkedInAt ?? null,
          confirmedAt: data.confirmedAt ?? null,
          removedAt: data.removedAt ?? null,
          removalReason: data.removalReason ?? null,
          note: data.note ?? null,
          tournamentRosterJson: data.tournamentRosterJson ?? null,
          registeredById: data.registeredById ?? null,
          createdAt: data.createdAt ?? now,
          updatedAt: data.updatedAt ?? now,
          deletedAt: data.deletedAt ?? null,
        };
        state.registrations.push(registration);
        return withTeam(registration);
      }),
      update: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Record<string, any>;
        }) => {
          const registration = state.registrations.find(
            (item) => item.id === where.id,
          );
          if (!registration) throw new Error('Registration not found');
          Object.assign(registration, data, {
            updatedAt: data.updatedAt ?? new Date(),
          });
          return withTeam(registration);
        },
      ),
    },
    team: {
      findFirst: jest.fn(
        async ({ where }: { where: Record<string, any> }) =>
          state.teams.find((team) => {
            if (where.id && team.id !== where.id) return false;
            if (
              where.organizationId &&
              team.organizationId !== where.organizationId
            )
              return false;
            if (where.deletedAt === null && team.deletedAt !== null)
              return false;
            return true;
          }) ?? null,
      ),
    },
    teamMember: {
      findMany: jest.fn(
        async ({
          where,
          orderBy,
        }: {
          where?: Record<string, any>;
          orderBy?: any;
        }) =>
          sortRows(
            state.teamMembers.filter((member) => {
              if (
                where?.organizationId &&
                member.organizationId !== where.organizationId
              )
                return false;
              if (where?.teamId && member.teamId !== where.teamId) return false;
              if (where?.role && member.role !== where.role) return false;
              if (where?.deletedAt === null && member.deletedAt !== null)
                return false;
              if (where?.leftAt === null && member.leftAt !== null)
                return false;
              return true;
            }),
            orderBy,
          ),
      ),
    },
    player: {
      findFirst: jest.fn(async ({ where }: { where?: Record<string, any> }) => {
        return (
          state.players.find((player) => {
            if (
              where?.organizationId &&
              player.organizationId !== where.organizationId
            ) {
              return false;
            }
            if (where?.teamId && player.teamId !== where.teamId) return false;
            if (where?.deletedAt === null && player.deletedAt !== null) {
              return false;
            }
            if (
              where?.inGameId !== undefined &&
              player.inGameId !== where.inGameId
            ) {
              return false;
            }
            if (
              where?.pubgPlayerId !== undefined &&
              player.pubgPlayerId !== where.pubgPlayerId
            ) {
              return false;
            }
            if (
              where?.externalPlayerId !== undefined &&
              player.externalPlayerId !== where.externalPlayerId
            ) {
              return false;
            }
            if (Array.isArray(where?.OR) && where.OR.length > 0) {
              const matched = where.OR.some(
                (condition: Record<string, any>) => {
                  if (
                    condition.inGameId !== undefined &&
                    player.inGameId === condition.inGameId
                  ) {
                    return true;
                  }
                  if (
                    condition.pubgPlayerId !== undefined &&
                    player.pubgPlayerId === condition.pubgPlayerId
                  ) {
                    return true;
                  }
                  if (
                    condition.externalPlayerId !== undefined &&
                    player.externalPlayerId === condition.externalPlayerId
                  ) {
                    return true;
                  }
                  return false;
                },
              );
              if (!matched) return false;
            }
            return true;
          }) ?? null
        );
      }),
      create: jest.fn(async ({ data }: { data: Record<string, any> }) => {
        const now = new Date();
        const player: PlayerRecord = {
          id: data.id ?? `player-${++state.playerSeq}`,
          organizationId: data.organizationId,
          teamId: data.teamId ?? null,
          ign: data.ign,
          inGameId: data.inGameId ?? null,
          pubgPlayerId: data.pubgPlayerId ?? null,
          externalPlayerId: data.externalPlayerId ?? null,
          photoUrl: data.photoUrl ?? null,
          source: data.source ?? PlayerSource.MANUAL,
          isActive: data.isActive ?? true,
          deletedAt: data.deletedAt ?? null,
          createdAt: data.createdAt ?? now,
          updatedAt: data.updatedAt ?? now,
        };
        state.players.push(player);
        return { id: player.id };
      }),
      update: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Record<string, any>;
        }) => {
          const player = state.players.find((item) => item.id === where.id);
          if (!player) throw new Error('Player not found');
          Object.assign(player, data, {
            updatedAt: data.updatedAt ?? new Date(),
          });
          return { id: player.id };
        },
      ),
    },
    rosterEntry: {
      findFirst: jest.fn(async ({ where }: { where?: Record<string, any> }) => {
        return (
          state.rosterEntries.find((entry) => {
            if (where?.teamId && entry.teamId !== where.teamId) return false;
            if (where?.playerId && entry.playerId !== where.playerId) {
              return false;
            }
            if (
              where?.isActive !== undefined &&
              entry.isActive !== where.isActive
            ) {
              return false;
            }
            return true;
          }) ?? null
        );
      }),
      create: jest.fn(async ({ data }: { data: Record<string, any> }) => {
        const entry: RosterEntryRecord = {
          id: data.id ?? `roster-entry-${++state.rosterEntrySeq}`,
          teamId: data.teamId,
          playerId: data.playerId,
          startAt: data.startAt ?? new Date(),
          isActive: data.isActive ?? true,
          createdAt: data.createdAt ?? new Date(),
        };
        state.rosterEntries.push(entry);
        return { id: entry.id };
      }),
    },
    teamBan: {
      findFirst: jest.fn(
        async ({
          where,
          orderBy,
        }: {
          where?: Record<string, any>;
          orderBy?: any;
        }) => sortRows(filterTeamBans(where), orderBy)[0] ?? null,
      ),
      findMany: jest.fn(
        async ({
          where,
          orderBy,
        }: {
          where?: Record<string, any>;
          orderBy?: any;
        }) => sortRows(filterTeamBans(where), orderBy),
      ),
    },
    game: {
      findUnique: jest.fn(async ({ where }: { where: Record<string, any> }) => {
        if (where.id) {
          return state.games.find((game) => game.id === where.id) ?? null;
        }
        if (where.key) {
          return state.games.find((game) => game.key === where.key) ?? null;
        }
        return null;
      }),
    },
    $queryRaw: jest.fn(async () => []),
    $transaction: jest.fn(
      async (
        callback: (tx: any) => unknown,
        options?: { isolationLevel?: Prisma.TransactionIsolationLevel },
      ) => {
        void options;
        return callback(prisma as unknown as PrismaService);
      },
    ),
  };

  return prisma;
}

describe('SessionsService', () => {
  const teamA: TeamRecord = {
    id: 'team-a',
    organizationId: 'org-1',
    name: 'Alpha',
    tag: 'ALP',
    logoUrl: null,
    countryCode: null,
    region: null,
    deletedAt: null,
  };
  const teamB: TeamRecord = {
    ...teamA,
    id: 'team-b',
    name: 'Bravo',
    tag: 'BRV',
  };
  const teamC: TeamRecord = {
    ...teamA,
    id: 'team-c',
    name: 'Charlie',
    tag: 'CHR',
  };

  const makeSession = (
    overrides: Partial<SessionRecord> = {},
  ): SessionRecord => ({
    id: 'session-1',
    organizationId: 'org-1',
    name: 'Daily Scrim',
    slug: null,
    type: SessionType.SCRIM,
    status: SessionStatus.OPEN,
    description: null,
    rulesetId: null,
    gameId: null,
    adapterKey: null,
    maxTeams: 25,
    slotCount: 25,
    waitlistEnabled: true,
    checkInEnabled: false,
    registrationOpenAt: null,
    registrationCloseAt: null,
    checkInOpenAt: null,
    checkInCloseAt: null,
    startsAt: null,
    endedAt: null,
    createdById: 'user-org-1',
    updatedById: 'user-org-1',
    createdAt: new Date('2026-03-25T10:00:00.000Z'),
    updatedAt: new Date('2026-03-25T10:00:00.000Z'),
    deletedAt: null,
    ...overrides,
  });

  const makeRegistration = (
    overrides: Partial<RegistrationRecord> = {},
  ): RegistrationRecord => ({
    id: `registration-${Math.random().toString(36).slice(2, 8)}`,
    organizationId: 'org-1',
    sessionId: 'session-1',
    teamId: 'team-a',
    leaderDiscordUserId: null,
    managerDiscordUserIds: [],
    status: SessionRegistrationStatus.CONFIRMED,
    slotNumber: 3,
    waitlistPosition: null,
    checkedInAt: null,
    confirmedAt: new Date('2026-03-25T10:05:00.000Z'),
    removedAt: null,
    removalReason: null,
    note: null,
    tournamentRosterJson: null,
    registeredById: 'user-org-1',
    createdAt: new Date('2026-03-25T10:05:00.000Z'),
    updatedAt: new Date('2026-03-25T10:05:00.000Z'),
    deletedAt: null,
    ...overrides,
  });

  const makeDiscordConfig = (
    overrides: Partial<DiscordConfigRecord> = {},
  ): DiscordConfigRecord => ({
    id: 'discord-config-1',
    organizationId: 'org-1',
    sessionId: 'session-1',
    enabled: true,
    registrationMode: 'SCRIM',
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
    slotRoleId: null,
    slotRoleName: null,
    waitlistRoleId: null,
    waitlistRoleName: null,
    idpRoleId: null,
    idpRoleName: null,
    bannedRoleId: null,
    bannedRoleName: null,
    registrationRoleIds: null,
    specialRegistrationRoleIds: null,
    manageRoleIds: null,
    vipRoleIds: null,
    startSlot: 3,
    normalSlots: 23,
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
    spreadsheetId: null,
    emojis: {
      check: 'CHECK',
      reject: 'X',
      waitlist: 'WAITLIST',
      ban: 'BAN',
      vip: 'VIP',
      slot: 'SLOT',
    },
    notes: null,
    createdAt: new Date('2026-03-25T10:00:00.000Z'),
    updatedAt: new Date('2026-03-25T10:00:00.000Z'),
    ...overrides,
  });

  const makeTeamBan = (
    overrides: Partial<TeamBanRecord> = {},
  ): TeamBanRecord => ({
    id: 'team-ban-1',
    organizationId: 'org-1',
    teamId: teamA.id,
    scope: TeamBanScope.TEAM,
    sessionId: null,
    matchId: null,
    reason: 'Rule violation',
    note: null,
    expiresAt: null,
    revokedAt: null,
    revokeReason: null,
    createdById: 'user-org-1',
    revokedById: null,
    createdAt: new Date('2026-03-25T10:00:00.000Z'),
    updatedAt: new Date('2026-03-25T10:00:00.000Z'),
    ...overrides,
  });

  const buildService = (seed?: {
    sessions?: SessionRecord[];
    teams?: TeamRecord[];
    registrations?: RegistrationRecord[];
    discordConfigs?: DiscordConfigRecord[];
    orgDiscordConfigs?: OrganizationDiscordConfigRecord[];
    games?: GameRecord[];
    teamBans?: TeamBanRecord[];
    teamMembers?: TeamMemberRecord[];
    players?: PlayerRecord[];
    rosterEntries?: RosterEntryRecord[];
    organizations?: OrganizationRecord[];
  }) => {
    const prisma = createPrismaMock(seed);
    const matches = {
      createForSession: jest.fn(),
      listBySession: jest.fn(),
    } as any;
    const adapters = {
      getAdapterByKey: jest.fn((key: string | null | undefined) => {
        const normalized = `${key ?? ''}`.trim().toLowerCase();
        if (normalized === 'pubgm-manual') {
          return { key: 'pubgm-manual', gameKey: GameKey.PUBG_MOBILE };
        }
        if (normalized === 'null-adapter') {
          return { key: 'null-adapter', gameKey: 'GENERIC' };
        }
        return null;
      }),
    } as any;
    const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;
    const service = new SessionsService(
      prisma as unknown as PrismaService,
      matches,
      adapters,
      audit,
    );
    return { service, prisma, matches, adapters, audit };
  };

  it('blocks Discord automation when subscription is inactive', () => {
    const { service } = buildService();
    const internals = service as unknown as {
      assertDiscordAccessNotExpired(entitlement: {
        hasActiveSubscription: boolean;
        maxSessionCount: number;
      }): void;
    };

    expect(() =>
      internals.assertDiscordAccessNotExpired({
        maxSessionCount: 1,
        hasActiveSubscription: false,
      }),
    ).toThrow(ForbiddenException);
  });

  it('allows Discord automation for active subscriptions', () => {
    const { service } = buildService();
    const internals = service as unknown as {
      assertDiscordAccessNotExpired(entitlement: {
        hasActiveSubscription: boolean;
        maxSessionCount: number;
      }): void;
    };

    expect(() =>
      internals.assertDiscordAccessNotExpired({
        maxSessionCount: 1,
        hasActiveSubscription: true,
      }),
    ).not.toThrow();
  });

  it('creates a session with default counts', async () => {
    const { service, prisma, audit } = buildService();

    const result = await service.create(
      { name: 'Daily Scrim', slotCount: 16, maxTeams: 20 },
      createActor(),
    );

    expect(result).toMatchObject({
      name: 'Daily Scrim',
      slotCount: 16,
      maxTeams: 20,
      counts: {
        confirmedCount: 0,
        waitlistCount: 0,
        totalRegisteredCount: 0,
      },
    });
    expect(prisma.__state.sessions).toHaveLength(1);
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: AuditAction.SESSION_CREATE }),
    );
  });

  it('creates default Discord config for a session', async () => {
    const { service, prisma } = buildService({
      sessions: [makeSession({ slotCount: 25 })],
    });

    const result = await service.getDiscordConfig('session-1', createActor());

    expect(result).toMatchObject({
      sessionId: 'session-1',
      enabled: true,
      startSlot: 3,
      normalSlots: 23,
      vipSlots: 0,
      maxManagersPerTeam: 2,
      maxTeamsPerManager: 1,
      registrationCommand: '%register',
    });
    expect(result.registrationRoleIds).toEqual([]);
    expect(prisma.__state.discordConfigs).toHaveLength(1);
  });

  it('returns an existing Discord config when concurrent default creation wins the race', async () => {
    const existingConfig = makeDiscordConfig({
      sessionId: 'session-1',
      normalSlots: 18,
      registrationCommand: '%join',
    });
    const { service, prisma } = buildService({
      sessions: [makeSession({ slotCount: 25 })],
      discordConfigs: [existingConfig],
    });
    prisma.sessionDiscordConfig.upsert.mockRejectedValueOnce({
      driverAdapterError: {
        cause: { kind: 'UniqueConstraintViolation' },
        originalMessage:
          'duplicate key value violates unique constraint "SessionDiscordConfig_sessionId_key"',
      },
      message:
        'duplicate key value violates unique constraint "SessionDiscordConfig_sessionId_key"',
    });

    const result = await service.getDiscordConfig('session-1', createActor());

    expect(result).toMatchObject({
      sessionId: 'session-1',
      normalSlots: 18,
      registrationCommand: '%join',
    });
    expect(prisma.sessionDiscordConfig.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { sessionId: 'session-1' },
      }),
    );
  });

  it('copies organization staff role defaults into new session Discord config', async () => {
    const { service } = buildService({
      sessions: [makeSession({ slotCount: 25 })],
      orgDiscordConfigs: [
        {
          organizationId: 'org-1',
          guildId: '775509232354983967',
          guildName: 'Org Guild',
          logoChannelIds: null,
          maxSessionCount: 100,
          accessExpiresAt: null,
          staffRoleIds: ['staff-role', 'staff-role', ' admin-role '],
        },
      ],
    });

    const result = await service.getDiscordConfig('session-1', createActor());

    expect(result.manageRoleIds).toEqual(['staff-role', 'admin-role']);
  });

  it('updates session Discord channel and role config', async () => {
    const { service, audit } = buildService({
      sessions: [makeSession({ slotCount: 25 })],
    });

    const result = await service.updateDiscordConfig(
      'session-1',
      {
        guildId: '775509232354983967',
        registrationChannelId: 'registration-channel',
        slotListChannelId: 'slot-channel',
        waitlistChannelId: 'waitlist-channel',
        idpChannelId: 'idp-channel',
        logChannelId: 'log-channel',
        slotRoleId: 'slot-role',
        waitlistRoleId: 'wait-role',
        idpRoleId: 'idp-role',
        bannedRoleId: 'ban-role',
        registrationRoleIds: ['reg-role'],
        manageRoleIds: ['staff-role'],
        vipRoleIds: ['vip-role'],
        normalSlots: 19,
        vipSlots: 2,
      },
      createActor(),
    );

    expect(result).toMatchObject({
      guildId: '775509232354983967',
      registrationChannelId: 'registration-channel',
      slotListChannelId: 'slot-channel',
      waitlistChannelId: 'waitlist-channel',
      idpChannelId: 'idp-channel',
      logChannelId: 'log-channel',
      slotRoleId: 'slot-role',
      waitlistRoleId: 'wait-role',
      idpRoleId: 'slot-role',
      bannedRoleId: 'ban-role',
      registrationRoleIds: ['reg-role'],
      manageRoleIds: ['staff-role'],
      vipRoleIds: ['vip-role'],
      normalSlots: 19,
      vipSlots: 2,
    });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.SESSION_DISCORD_CONFIG_UPDATE,
      }),
    );
  });

  it('does not disable an active Discord config from a stale full-form save', async () => {
    const { service, prisma } = buildService({
      sessions: [makeSession({ slotCount: 25 })],
      discordConfigs: [
        makeDiscordConfig({
          organizationId: 'org-1',
          sessionId: 'session-1',
          enabled: true,
          registrationMode: 'SCRIM',
        }),
      ],
    });

    const result = await service.updateDiscordConfig(
      'session-1',
      {
        enabled: false,
        registrationMode: 'TOURNAMENT',
      },
      createActor(),
    );

    expect(result.enabled).toBe(true);
    expect(result.registrationMode).toBe('TOURNAMENT');
    expect(prisma.__state.discordConfigs[0].enabled).toBe(true);
  });

  it('allows an explicit user toggle to disable Discord config management', async () => {
    const { service, prisma } = buildService({
      sessions: [makeSession({ slotCount: 25 })],
      discordConfigs: [
        makeDiscordConfig({
          organizationId: 'org-1',
          sessionId: 'session-1',
          enabled: true,
        }),
      ],
    });

    const result = await service.updateDiscordConfig(
      'session-1',
      {
        enabled: false,
        enabledChangeIntent: 'USER_TOGGLE',
      },
      createActor(),
    );

    expect(result.enabled).toBe(false);
    expect(prisma.__state.discordConfigs[0].enabled).toBe(false);
  });

  it('resolves a shared Discord registration channel to the SCRIM session for bot service tokens', async () => {
    const registrationChannelId = '1504066467543650365';
    const guildId = '775509232354983967';
    const { service } = buildService({
      sessions: [
        makeSession({
          id: 'scrim-session',
          name: 'Official Scrim',
          type: SessionType.SCRIM,
          status: SessionStatus.OPEN,
          updatedAt: new Date('2026-05-13T18:00:00.000Z'),
        }),
        makeSession({
          id: 'event-session',
          name: 'Official Event Mirror',
          type: SessionType.EVENT,
          status: SessionStatus.OPEN,
          updatedAt: new Date('2026-05-13T19:00:00.000Z'),
        }),
      ],
      discordConfigs: [
        makeDiscordConfig({
          id: 'scrim-config',
          sessionId: 'scrim-session',
          guildId,
          registrationChannelId,
          updatedAt: new Date('2026-05-13T18:00:00.000Z'),
        }),
        makeDiscordConfig({
          id: 'event-config',
          sessionId: 'event-session',
          guildId,
          registrationChannelId,
          updatedAt: new Date('2026-05-13T19:00:00.000Z'),
        }),
      ],
    });

    const result = await service.resolveDiscordChannel(
      guildId,
      registrationChannelId,
      {
        ...createActor(),
        serviceToken: true,
      },
      {
        topicSessionId: 'scrim-session',
        topicKind: 'registration',
      },
    );

    expect(result.channelKind).toBe('registration');
    expect(result.session.id).toBe('scrim-session');
    expect(result.session.type).toBe(SessionType.SCRIM);
  });

  it('prefers SCRIM over EVENT for shared Discord channels when the bot has no topic marker', async () => {
    const registrationChannelId = '1504066467543650365';
    const guildId = '775509232354983967';
    const { service } = buildService({
      sessions: [
        makeSession({
          id: 'scrim-session',
          type: SessionType.SCRIM,
          status: SessionStatus.OPEN,
          updatedAt: new Date('2026-05-13T18:00:00.000Z'),
        }),
        makeSession({
          id: 'event-session',
          type: SessionType.EVENT,
          status: SessionStatus.OPEN,
          updatedAt: new Date('2026-05-13T19:00:00.000Z'),
        }),
      ],
      discordConfigs: [
        makeDiscordConfig({
          id: 'scrim-config',
          sessionId: 'scrim-session',
          guildId,
          registrationChannelId,
          updatedAt: new Date('2026-05-13T18:00:00.000Z'),
        }),
        makeDiscordConfig({
          id: 'event-config',
          sessionId: 'event-session',
          guildId,
          registrationChannelId,
          updatedAt: new Date('2026-05-13T19:00:00.000Z'),
        }),
      ],
    });

    const result = await service.resolveDiscordChannel(
      guildId,
      registrationChannelId,
      {
        ...createActor(),
        serviceToken: true,
      },
    );

    expect(result.session.id).toBe('scrim-session');
  });

  it('does not let a cross-organization Discord config hijack bot channel resolution', async () => {
    const registrationChannelId = '1504066467543650365';
    const guildId = '1181558946603995188';
    const { service } = buildService({
      sessions: [
        makeSession({
          id: 'foreign-linked-session',
          type: SessionType.EVENT,
          status: SessionStatus.OPEN,
        }),
      ],
      discordConfigs: [
        makeDiscordConfig({
          id: 'foreign-linked-config',
          sessionId: 'foreign-linked-session',
          guildId,
          registrationChannelId,
          enabled: true,
        }),
      ],
      orgDiscordConfigs: [
        {
          organizationId: 'org-2',
          guildId,
          guildName: 'Foreign Guild',
          logoChannelIds: null,
          maxSessionCount: 100,
          accessExpiresAt: null,
          staffRoleIds: null,
        },
      ],
    });

    await expect(
      service.resolveDiscordChannel(guildId, registrationChannelId, {
        ...createActor(),
        serviceToken: true,
      }),
    ).rejects.toThrow('owning Arenzyra organization');
  });

  it('does not resolve Discord channels for expired organizations to bot service tokens', async () => {
    const registrationChannelId = '1504066467543650365';
    const guildId = '775509232354983967';
    const { service, prisma } = buildService({
      sessions: [
        makeSession({
          id: 'expired-session',
          type: SessionType.SCRIM,
          status: SessionStatus.OPEN,
        }),
      ],
      discordConfigs: [
        makeDiscordConfig({
          id: 'expired-config',
          sessionId: 'expired-session',
          guildId,
          registrationChannelId,
        }),
      ],
    });
    Object.assign(prisma.__state.organizations[0], {
      subscriptionStatus: OrganizationSubscriptionStatus.TRIALING,
      trialEndsAt: new Date('2026-05-01T00:00:00.000Z'),
      paidUntil: null,
    });

    await expect(
      service.resolveDiscordChannel(guildId, registrationChannelId, {
        ...createActor(),
        serviceToken: true,
      }),
    ).rejects.toThrow('active Arenzyra organization');
  });

  it('does not resolve Discord guilds for expired organizations to bot service tokens', async () => {
    const guildId = '775509232354983967';
    const { service, prisma } = buildService();
    Object.assign(prisma.__state.organizations[0], {
      subscriptionStatus: OrganizationSubscriptionStatus.EXPIRED,
      trialEndsAt: null,
      paidUntil: null,
    });

    await expect(
      service.resolveDiscordGuild(guildId, {
        ...createActor(),
        serviceToken: true,
      }),
    ).rejects.toThrow('active Arenzyra organization');
  });

  it('resolves synced logo-only channels from Discord emoji config', async () => {
    const logoChannelId = '1505021887905009694';
    const guildId = '1181558946603995188';
    const { service } = buildService({
      sessions: [
        makeSession({
          id: 'scrim-session',
          name: 'Logo Scrim',
          type: SessionType.SCRIM,
          status: SessionStatus.OPEN,
        }),
      ],
      discordConfigs: [
        makeDiscordConfig({
          id: 'scrim-config',
          sessionId: 'scrim-session',
          guildId,
          registrationChannelId: '1502922822325112942',
          emojis: {
            discordLogoChannelIds: `${logoChannelId}\n1505022923952488470`,
          },
        }),
      ],
      orgDiscordConfigs: [
        {
          organizationId: 'org-1',
          guildId,
          guildName: 'Bastards',
          logoChannelIds: null,
          maxSessionCount: 100,
          accessExpiresAt: null,
          staffRoleIds: null,
        },
      ],
    });

    const result = await service.resolveDiscordChannel(guildId, logoChannelId, {
      ...createActor(),
      serviceToken: true,
    });

    expect(result.channelKind).toBe('logos');
    expect(result.session.id).toBe('scrim-session');
  });

  it('resolves organization-level logo channels for all sessions in the guild', async () => {
    const logoChannelId = '1505021887905009694';
    const guildId = '1181558946603995188';
    const { service } = buildService({
      sessions: [
        makeSession({
          id: 'scrim-session',
          name: 'Logo Scrim',
          type: SessionType.SCRIM,
          status: SessionStatus.OPEN,
        }),
      ],
      discordConfigs: [
        makeDiscordConfig({
          id: 'scrim-config',
          sessionId: 'scrim-session',
          guildId,
          registrationChannelId: '1502922822325112942',
        }),
      ],
      orgDiscordConfigs: [
        {
          organizationId: 'org-1',
          guildId,
          guildName: 'Bastards',
          logoChannelIds: `${logoChannelId}\n1505022923952488470`,
          maxSessionCount: 100,
          accessExpiresAt: null,
          staffRoleIds: null,
        },
      ],
    });

    const result = await service.resolveDiscordChannel(guildId, logoChannelId, {
      ...createActor(),
      serviceToken: true,
    });

    expect(result.channelKind).toBe('logos');
    expect(result.session.id).toBe('scrim-session');
  });

  it('prefers SCRIM logo channel matches over EVENT matches for bot resolution', async () => {
    const logoChannelId = '1505021887905009694';
    const guildId = '1181558946603995188';
    const { service } = buildService({
      sessions: [
        makeSession({
          id: 'event-session',
          type: SessionType.EVENT,
          status: SessionStatus.OPEN,
          updatedAt: new Date('2026-05-13T20:00:00.000Z'),
        }),
        makeSession({
          id: 'scrim-session',
          type: SessionType.SCRIM,
          status: SessionStatus.OPEN,
          updatedAt: new Date('2026-05-13T19:00:00.000Z'),
        }),
      ],
      discordConfigs: [
        makeDiscordConfig({
          id: 'event-config',
          sessionId: 'event-session',
          guildId,
          emojis: {
            discordLogoChannelIds: logoChannelId,
          },
          updatedAt: new Date('2026-05-13T20:00:00.000Z'),
        }),
        makeDiscordConfig({
          id: 'scrim-config',
          sessionId: 'scrim-session',
          guildId,
          emojis: {
            discordLogoChannelIds: logoChannelId,
          },
          updatedAt: new Date('2026-05-13T19:00:00.000Z'),
        }),
      ],
      orgDiscordConfigs: [
        {
          organizationId: 'org-1',
          guildId,
          guildName: 'Bastards',
          logoChannelIds: null,
          maxSessionCount: 100,
          accessExpiresAt: null,
          staffRoleIds: null,
        },
      ],
    });

    const result = await service.resolveDiscordChannel(guildId, logoChannelId, {
      ...createActor(),
      serviceToken: true,
    });

    expect(result.channelKind).toBe('logos');
    expect(result.session.id).toBe('scrim-session');
  });

  it('rejects enabled weekly registration timing without a close time', async () => {
    const { service } = buildService({
      sessions: [makeSession({ slotCount: 25 })],
    });

    await expect(
      service.updateDiscordConfig(
        'session-1',
        {
          emojis: {
            registrationTimeZone: 'UTC',
            registrationWeeklySchedule: JSON.stringify({
              monday: { enabled: true, open: '10:00', close: '' },
            }),
          },
        },
        createActor(),
      ),
    ).rejects.toThrow(
      'Registration timing for Monday needs both open and close time',
    );
  });

  it('clears manual registration state when saving a weekly schedule', async () => {
    const schedule = JSON.stringify({
      friday: { enabled: true, open: '22:02', close: '22:03' },
    });
    const { service, prisma } = buildService({
      sessions: [makeSession({ slotCount: 25 })],
      discordConfigs: [
        makeDiscordConfig({
          emojis: {
            registrationTimeZone: 'UTC',
            registrationWeeklySchedule: schedule,
            registrationManualState: 'open',
          },
        }),
      ],
    });

    const result = await service.updateDiscordConfig(
      'session-1',
      {
        emojis: {
          registrationTimeZone: 'UTC',
          registrationWeeklySchedule: schedule,
          registrationManualState: '',
        },
      },
      createActor(),
    );

    expect(result.emojis.registrationManualState).toBe('');
    expect(
      (prisma.__state.discordConfigs[0].emojis as Record<string, string>)
        .registrationManualState,
    ).toBe('');
  });

  it('clears waitlist promotion manual state when saving a weekly schedule', async () => {
    const schedule = JSON.stringify({
      friday: { enabled: true, open: '22:02', close: '22:03' },
    });
    const { service, prisma } = buildService({
      sessions: [makeSession({ slotCount: 25 })],
      discordConfigs: [
        makeDiscordConfig({
          emojis: {
            waitlistPromotionTimeZone: 'UTC',
            waitlistPromotionWeeklySchedule: schedule,
            waitlistPromotionManualState: 'open',
          },
        }),
      ],
    });

    const result = await service.updateDiscordConfig(
      'session-1',
      {
        emojis: {
          waitlistPromotionTimeZone: 'UTC',
          waitlistPromotionWeeklySchedule: schedule,
          waitlistPromotionManualState: 'open',
        },
      },
      createActor(),
    );

    expect(result.emojis.waitlistPromotionManualState).toBe('');
    expect(
      (prisma.__state.discordConfigs[0].emojis as Record<string, string>)
        .waitlistPromotionManualState,
    ).toBe('');
  });

  it('archives a Discord session and disables its bot config', async () => {
    const { service, prisma } = buildService({
      sessions: [makeSession({ status: SessionStatus.OPEN })],
      discordConfigs: [makeDiscordConfig({ enabled: true })],
    });

    const result = await service.archive('session-1', createActor());

    expect(result.status).toBe(SessionStatus.ARCHIVED);
    expect(prisma.__state.discordConfigs[0].enabled).toBe(false);
  });

  it('restores an archived Discord session without re-enabling bot config', async () => {
    const { service, prisma } = buildService({
      sessions: [makeSession({ status: SessionStatus.ARCHIVED })],
      discordConfigs: [makeDiscordConfig({ enabled: false })],
    });

    const result = await service.restore('session-1', createActor());

    expect(result.status).toBe(SessionStatus.DRAFT);
    expect(prisma.__state.discordConfigs[0].enabled).toBe(false);
  });

  it('soft-deletes a Discord session and disables its bot config', async () => {
    const { service, prisma } = buildService({
      sessions: [makeSession({ status: SessionStatus.OPEN })],
      discordConfigs: [makeDiscordConfig({ enabled: true })],
    });

    await service.softDelete('session-1', createActor());

    expect(prisma.__state.sessions[0].deletedAt).toBeInstanceOf(Date);
    expect(prisma.__state.discordConfigs[0].enabled).toBe(false);
  });

  it('rejects Discord config for another organization guild', async () => {
    const { service } = buildService({
      sessions: [makeSession({ slotCount: 25 })],
      orgDiscordConfigs: [
        {
          organizationId: 'org-1',
          guildId: 'org-guild',
          guildName: 'Org Guild',
          logoChannelIds: null,
          maxSessionCount: 100,
          accessExpiresAt: null,
        },
      ],
    });

    await expect(
      service.updateDiscordConfig(
        'session-1',
        {
          guildId: 'other-guild',
          registrationChannelId: 'registration-channel',
        },
        createActor(),
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects guild-scoped Discord config before the organization is connected', async () => {
    const { service } = buildService({
      sessions: [makeSession({ slotCount: 25 })],
      orgDiscordConfigs: [],
    });

    await expect(
      service.updateDiscordConfig(
        'session-1',
        {
          registrationChannelId: 'registration-channel',
        },
        createActor(),
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('allows blank Discord guild fields before the organization is connected', async () => {
    const { service, prisma } = buildService({
      sessions: [makeSession({ slotCount: 25 })],
      orgDiscordConfigs: [],
      discordConfigs: [
        makeDiscordConfig({
          guildId: 'stale-guild',
          registrationChannelId: 'stale-registration-channel',
          manageRoleIds: ['stale-role'],
        }),
      ],
    });

    const result = await service.updateDiscordConfig(
      'session-1',
      {
        guildId: null,
        registrationChannelId: null,
        slotListChannelId: null,
        manageRoleIds: [],
      },
      createActor(),
    );

    expect(result.guildId).toBeNull();
    expect(result.registrationChannelId).toBeNull();
    expect(result.slotListChannelId).toBeNull();
    expect(result.manageRoleIds).toEqual([]);
    expect(prisma.__state.discordConfigs[0].guildId).toBeNull();
  });

  it('rejects an unknown adapterKey during session create', async () => {
    const { service } = buildService();

    await expect(
      service.create(
        {
          name: 'Daily Scrim',
          gameId: 'game-pubgm',
          adapterKey: 'freefire-manual',
        },
        createActor(),
      ),
    ).rejects.toThrow('Unknown adapterKey: freefire-manual');
  });

  it('rejects adapterKey and gameId mismatches during session update', async () => {
    const { service } = buildService({
      sessions: [
        makeSession({
          gameId: 'game-pubgm',
          adapterKey: 'pubgm-manual',
        }),
      ],
    });

    await expect(
      service.update(
        'session-1',
        {
          gameId: 'game-ff',
        },
        createActor(),
      ),
    ).rejects.toThrow(
      'adapterKey pubgm-manual is not valid for gameKey FREE_FIRE',
    );
  });

  it('clears registration open time while updating registration close time', async () => {
    const closeAt = '2099-01-05T00:00:00.000Z';
    const { service } = buildService({
      sessions: [
        makeSession({
          registrationOpenAt: new Date('2099-01-10T00:00:00.000Z'),
          registrationCloseAt: new Date('2099-01-11T00:00:00.000Z'),
        }),
      ],
    });

    const result = await service.update(
      'session-1',
      {
        registrationOpenAt: null,
        registrationCloseAt: closeAt,
      },
      createActor(),
    );

    expect(result.registrationOpenAt).toBeNull();
    expect(result.registrationCloseAt).toEqual(new Date(closeAt));
  });

  it('registers a team into the next open slot and confirms it', async () => {
    const { service, prisma } = buildService({
      sessions: [makeSession({ slotCount: 25 })],
      teams: [teamA],
    });

    const result = await service.registerTeam(
      'session-1',
      { teamId: teamA.id },
      createActor(),
    );

    expect(result).toMatchObject({
      teamId: teamA.id,
      status: SessionRegistrationStatus.CONFIRMED,
      slotNumber: 3,
      waitlistPosition: null,
      team: { tag: 'ALP' },
    });
    expect(result.confirmedAt).toBeInstanceOf(Date);
    expect(prisma.$queryRaw).toHaveBeenCalled();
    expect(prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      }),
    );
  });

  it('persists tournament roster JSON and creates team players from it', async () => {
    const { service, prisma } = buildService({
      sessions: [makeSession({ slotCount: 25 })],
      teams: [teamA],
    });
    const roster = {
      type: 'TOURNAMENT_ROSTER',
      version: 1,
      requiredMainPlayers: 2,
      manager: { discordUserId: '1001' },
      players: [
        {
          slot: 1,
          lineupType: 'MAIN',
          name: 'Manager IGN',
          uid: '111111',
          discordUserId: '1001',
        },
        {
          slot: 2,
          lineupType: 'MAIN',
          name: 'Player Two',
          uid: '222222',
          discordUserId: '1002',
        },
      ],
    };

    const result = await service.registerTeam(
      'session-1',
      { teamId: teamA.id, tournamentRosterJson: roster },
      createActor(),
    );

    expect(result.tournamentRosterJson).toEqual(roster);
    expect(prisma.player.create).toHaveBeenCalledTimes(2);
    expect(prisma.player.create).toHaveBeenNthCalledWith(1, {
      data: expect.objectContaining({
        organizationId: 'org-1',
        teamId: teamA.id,
        ign: 'Manager IGN',
        inGameId: '111111',
        pubgPlayerId: '111111',
        externalPlayerId: '111111',
        photoUrl: null,
        source: PlayerSource.MANUAL,
        isActive: true,
      }),
      select: { id: true },
    });
    expect(prisma.player.create).toHaveBeenNthCalledWith(2, {
      data: expect.objectContaining({
        organizationId: 'org-1',
        teamId: teamA.id,
        ign: 'Player Two',
        inGameId: '222222',
        pubgPlayerId: '222222',
        externalPlayerId: '222222',
        photoUrl: null,
        source: PlayerSource.MANUAL,
        isActive: true,
      }),
      select: { id: true },
    });
    expect(prisma.rosterEntry.create).toHaveBeenCalledTimes(2);
    expect(prisma.teamMember.findMany).toHaveBeenCalled();
  });

  it('updates existing team players from tournament roster UID without duplicating roster entries', async () => {
    const existingPlayer: PlayerRecord = {
      id: 'player-existing',
      organizationId: 'org-1',
      teamId: teamA.id,
      ign: 'Old IGN',
      inGameId: '111111',
      pubgPlayerId: '111111',
      externalPlayerId: null,
      photoUrl: '/media/players/player-existing/photo?v=1',
      source: PlayerSource.MANUAL,
      isActive: true,
      deletedAt: null,
      createdAt: new Date('2026-03-25T10:00:00.000Z'),
      updatedAt: new Date('2026-03-25T10:00:00.000Z'),
    };
    const { service, prisma } = buildService({
      sessions: [makeSession({ slotCount: 25 })],
      teams: [teamA],
      players: [existingPlayer],
      rosterEntries: [
        {
          id: 'roster-entry-existing',
          teamId: teamA.id,
          playerId: existingPlayer.id,
          startAt: new Date('2026-03-25T10:00:00.000Z'),
          isActive: true,
          createdAt: new Date('2026-03-25T10:00:00.000Z'),
        },
      ],
    });

    await service.registerTeam(
      'session-1',
      {
        teamId: teamA.id,
        tournamentRosterJson: {
          type: 'TOURNAMENT_ROSTER',
          version: 1,
          players: [
            {
              slot: 1,
              lineupType: 'MAIN',
              name: 'Updated IGN',
              uid: '111111',
              discordUserId: '1001',
            },
          ],
        },
      },
      createActor(),
    );

    expect(prisma.player.update).toHaveBeenCalledWith({
      where: { id: existingPlayer.id },
      data: {
        teamId: teamA.id,
        ign: 'Updated IGN',
        inGameId: '111111',
        pubgPlayerId: '111111',
        externalPlayerId: '111111',
        isActive: true,
      },
      select: { id: true },
    });
    expect(prisma.player.create).not.toHaveBeenCalled();
    expect(prisma.rosterEntry.create).not.toHaveBeenCalled();
  });

  it('snapshots active Discord leaders on the session registration', async () => {
    const { service } = buildService({
      sessions: [makeSession({ slotCount: 25 })],
      teams: [teamA],
      teamMembers: [
        {
          id: 'member-1',
          organizationId: 'org-1',
          teamId: teamA.id,
          discordUserId: '1001',
          role: TeamMemberRole.LEADER,
          createdAt: new Date('2026-03-25T10:01:00.000Z'),
          leftAt: null,
          deletedAt: null,
        },
        {
          id: 'member-2',
          organizationId: 'org-1',
          teamId: teamA.id,
          discordUserId: '1002',
          role: TeamMemberRole.LEADER,
          createdAt: new Date('2026-03-25T10:02:00.000Z'),
          leftAt: null,
          deletedAt: null,
        },
        {
          id: 'member-3',
          organizationId: 'org-1',
          teamId: teamA.id,
          discordUserId: '1003',
          role: TeamMemberRole.PLAYER,
          createdAt: new Date('2026-03-25T10:03:00.000Z'),
          leftAt: null,
          deletedAt: null,
        },
      ],
    });

    const result = await service.registerTeam(
      'session-1',
      { teamId: teamA.id },
      createActor(),
    );

    expect(result.leaderDiscordUserId).toBe('1001');
    expect(result.managerDiscordUserIds).toEqual(['1001', '1002']);
  });

  it('uses explicit Discord manager snapshots when registering from Discord', async () => {
    const { service } = buildService({
      sessions: [makeSession({ slotCount: 25 })],
      teams: [teamA],
      teamMembers: [
        {
          id: 'member-1',
          organizationId: 'org-1',
          teamId: teamA.id,
          discordUserId: '1001',
          role: TeamMemberRole.LEADER,
          createdAt: new Date('2026-03-25T10:01:00.000Z'),
          leftAt: null,
          deletedAt: null,
        },
        {
          id: 'member-2',
          organizationId: 'org-1',
          teamId: teamA.id,
          discordUserId: '1002',
          role: TeamMemberRole.LEADER,
          createdAt: new Date('2026-03-25T10:02:00.000Z'),
          leftAt: null,
          deletedAt: null,
        },
      ],
    });

    const result = await service.registerTeam(
      'session-1',
      {
        teamId: teamA.id,
        leaderDiscordUserId: '1001',
        managerDiscordUserIds: ['1002'],
      },
      createActor(),
    );

    expect(result.leaderDiscordUserId).toBe('1002');
    expect(result.managerDiscordUserIds).toEqual(['1002']);
  });

  it('updates a session registration manager snapshot without changing the slot', async () => {
    const { service, prisma, audit } = buildService({
      sessions: [makeSession({ slotCount: 25 })],
      teams: [teamA],
      registrations: [
        makeRegistration({
          id: 'registration-1',
          teamId: teamA.id,
          leaderDiscordUserId: 'old-manager',
          managerDiscordUserIds: ['old-manager'],
          status: SessionRegistrationStatus.CONFIRMED,
          slotNumber: 3,
        }),
      ],
    });

    const result = await service.updateRegistrationManagers(
      'session-1',
      'registration-1',
      {
        leaderDiscordUserId: 'old-manager',
        managerDiscordUserIds: [' old-manager ', 'new-manager', 'new-manager'],
      },
      createActor(),
    );

    expect(result.leaderDiscordUserId).toBe('old-manager');
    expect(result.managerDiscordUserIds).toEqual([
      'old-manager',
      'new-manager',
    ]);
    expect(result.status).toBe(SessionRegistrationStatus.CONFIRMED);
    expect(result.slotNumber).toBe(3);
    expect(prisma.__state.registrations[0].managerDiscordUserIds).toEqual([
      'old-manager',
      'new-manager',
    ]);
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.SLOT_SET,
        entityType: 'SESSION_REGISTRATION',
        entityId: 'registration-1',
      }),
    );
  });

  it('registers a team directly into the next configured VIP slot', async () => {
    const { service } = buildService({
      sessions: [makeSession({ slotCount: 25 })],
      teams: [teamA],
      discordConfigs: [
        makeDiscordConfig({
          startSlot: 3,
          normalSlots: 20,
          vipSlots: 3,
        }),
      ],
    });

    const result = await service.registerTeam(
      'session-1',
      { teamId: teamA.id, placement: RegisterSessionTeamPlacement.VIP },
      createActor(),
    );

    expect(result).toMatchObject({
      teamId: teamA.id,
      status: SessionRegistrationStatus.CONFIRMED,
      slotNumber: 23,
      waitlistPosition: null,
    });
  });

  it('moves an already waitlisted team into the next configured VIP slot', async () => {
    const { service, prisma } = buildService({
      sessions: [makeSession({ slotCount: 25 })],
      teams: [teamA],
      discordConfigs: [
        makeDiscordConfig({
          startSlot: 3,
          normalSlots: 20,
          vipSlots: 3,
        }),
      ],
      registrations: [
        makeRegistration({
          id: 'wait-a',
          teamId: teamA.id,
          status: SessionRegistrationStatus.WAITLIST,
          slotNumber: null,
          waitlistPosition: 1,
          confirmedAt: null,
        }),
      ],
    });

    const result = await service.registerTeam(
      'session-1',
      { teamId: teamA.id, placement: RegisterSessionTeamPlacement.VIP },
      createActor(),
    );

    expect(result).toMatchObject({
      id: 'wait-a',
      teamId: teamA.id,
      status: SessionRegistrationStatus.CONFIRMED,
      slotNumber: 23,
      waitlistPosition: null,
    });
    const updated = prisma.__state.registrations.find(
      (item) => item.id === 'wait-a',
    );
    expect(updated?.slotNumber).toBe(23);
    expect(updated?.waitlistPosition).toBeNull();
  });

  it('rejects direct VIP registration when no VIP slots are configured', async () => {
    const { service } = buildService({
      sessions: [makeSession({ slotCount: 25 })],
      teams: [teamA],
      discordConfigs: [
        makeDiscordConfig({
          startSlot: 3,
          normalSlots: 23,
          vipSlots: 0,
        }),
      ],
    });

    await expect(
      service.registerTeam(
        'session-1',
        { teamId: teamA.id, placement: RegisterSessionTeamPlacement.VIP },
        createActor(),
      ),
    ).rejects.toThrow('No VIP slots are configured');
  });

  it('rejects registration before the configured registration open time', async () => {
    const { service } = buildService({
      sessions: [
        makeSession({
          registrationOpenAt: new Date('2099-01-01T00:00:00.000Z'),
          registrationCloseAt: new Date('2099-01-02T00:00:00.000Z'),
        }),
      ],
      teams: [teamA],
    });

    await expect(
      service.registerTeam('session-1', { teamId: teamA.id }, createActor()),
    ).rejects.toThrow('Registration is not open yet');
  });

  it('rejects registration after the configured registration close time', async () => {
    const { service } = buildService({
      sessions: [
        makeSession({
          registrationOpenAt: new Date('2000-01-01T00:00:00.000Z'),
          registrationCloseAt: new Date('2000-01-02T00:00:00.000Z'),
        }),
      ],
      teams: [teamA],
    });

    await expect(
      service.registerTeam('session-1', { teamId: teamA.id }, createActor()),
    ).rejects.toThrow('Registration is closed');
  });

  it('rejects registration outside the configured weekly registration window', async () => {
    const tomorrow = [
      'sunday',
      'monday',
      'tuesday',
      'wednesday',
      'thursday',
      'friday',
      'saturday',
    ][(new Date().getUTCDay() + 1) % 7];
    const { service } = buildService({
      sessions: [makeSession()],
      teams: [teamA],
      discordConfigs: [
        makeDiscordConfig({
          emojis: {
            registrationTimeZone: 'UTC',
            registrationWeeklySchedule: JSON.stringify({
              [tomorrow]: { enabled: true, open: '00:00', close: '00:00' },
            }),
          },
        }),
      ],
    });

    await expect(
      service.registerTeam('session-1', { teamId: teamA.id }, createActor()),
    ).rejects.toThrow('Registration is closed');
  });

  it('allows registration inside the configured weekly registration window', async () => {
    const { service } = buildService({
      sessions: [makeSession()],
      teams: [teamA],
      discordConfigs: [
        makeDiscordConfig({
          emojis: {
            registrationTimeZone: 'UTC',
            registrationWeeklySchedule: JSON.stringify({
              sunday: { enabled: true, open: '00:00', close: '00:00' },
              monday: { enabled: true, open: '00:00', close: '00:00' },
              tuesday: { enabled: true, open: '00:00', close: '00:00' },
              wednesday: { enabled: true, open: '00:00', close: '00:00' },
              thursday: { enabled: true, open: '00:00', close: '00:00' },
              friday: { enabled: true, open: '00:00', close: '00:00' },
              saturday: { enabled: true, open: '00:00', close: '00:00' },
            }),
          },
        }),
      ],
    });

    const result = await service.registerTeam(
      'session-1',
      { teamId: teamA.id },
      createActor(),
    );

    expect(result.status).toBe(SessionRegistrationStatus.CONFIRMED);
  });

  it('allows weekly registration even when an old close timestamp remains on the session', async () => {
    const { service } = buildService({
      sessions: [
        makeSession({
          registrationCloseAt: new Date('2000-01-02T00:00:00.000Z'),
        }),
      ],
      teams: [teamA],
      discordConfigs: [
        makeDiscordConfig({
          emojis: {
            registrationTimeZone: 'UTC',
            registrationWeeklySchedule: JSON.stringify({
              sunday: { enabled: true, open: '00:00', close: '00:00' },
              monday: { enabled: true, open: '00:00', close: '00:00' },
              tuesday: { enabled: true, open: '00:00', close: '00:00' },
              wednesday: { enabled: true, open: '00:00', close: '00:00' },
              thursday: { enabled: true, open: '00:00', close: '00:00' },
              friday: { enabled: true, open: '00:00', close: '00:00' },
              saturday: { enabled: true, open: '00:00', close: '00:00' },
            }),
          },
        }),
      ],
    });

    const result = await service.registerTeam(
      'session-1',
      { teamId: teamA.id },
      createActor(),
    );

    expect(result.status).toBe(SessionRegistrationStatus.CONFIRMED);
  });

  it('honors weekly registration schedule over manual registration state', async () => {
    const tomorrow = [
      'sunday',
      'monday',
      'tuesday',
      'wednesday',
      'thursday',
      'friday',
      'saturday',
    ][(new Date().getUTCDay() + 1) % 7];
    const closedSchedule = JSON.stringify({
      [tomorrow]: { enabled: true, open: '00:00', close: '00:00' },
    });
    const openService = buildService({
      sessions: [makeSession()],
      teams: [teamA],
      discordConfigs: [
        makeDiscordConfig({
          emojis: {
            registrationTimeZone: 'UTC',
            registrationWeeklySchedule: closedSchedule,
            registrationManualState: 'open',
          },
        }),
      ],
    }).service;

    await expect(
      openService.registerTeam(
        'session-1',
        { teamId: teamA.id },
        createActor(),
      ),
    ).rejects.toThrow('Registration is closed');

    const scheduleOpenService = buildService({
      sessions: [makeSession()],
      teams: [teamA],
      discordConfigs: [
        makeDiscordConfig({
          emojis: {
            registrationTimeZone: 'UTC',
            registrationWeeklySchedule: JSON.stringify({
              sunday: { enabled: true, open: '00:00', close: '00:00' },
              monday: { enabled: true, open: '00:00', close: '00:00' },
              tuesday: { enabled: true, open: '00:00', close: '00:00' },
              wednesday: { enabled: true, open: '00:00', close: '00:00' },
              thursday: { enabled: true, open: '00:00', close: '00:00' },
              friday: { enabled: true, open: '00:00', close: '00:00' },
              saturday: { enabled: true, open: '00:00', close: '00:00' },
            }),
            registrationManualState: 'closed',
          },
        }),
      ],
    }).service;

    await expect(
      scheduleOpenService.registerTeam(
        'session-1',
        { teamId: teamA.id },
        createActor(),
      ),
    ).resolves.toMatchObject({
      status: SessionRegistrationStatus.CONFIRMED,
    });

    const closedService = buildService({
      sessions: [makeSession()],
      teams: [teamA],
      discordConfigs: [
        makeDiscordConfig({
          emojis: {
            registrationManualState: 'closed',
          },
        }),
      ],
    }).service;

    await expect(
      closedService.registerTeam(
        'session-1',
        { teamId: teamA.id },
        createActor(),
      ),
    ).rejects.toThrow('Registration is closed');
  });

  it('honors staff registration schedule overrides over weekly registration schedule', async () => {
    const now = new Date('2026-05-04T15:00:00.000Z');
    const closedSchedule = JSON.stringify({
      monday: { enabled: true, open: '10:00', close: '12:00' },
    });
    const { service } = buildService({
      sessions: [makeSession()],
      teams: [teamA],
    });
    const registrationWindowOpen = (
      emojis: Record<string, string>,
    ): Promise<void> =>
      (
        service as unknown as {
          assertRegistrationWindowOpen(
            session: {
              id: string;
              registrationOpenAt: Date | null;
              registrationCloseAt: Date | null;
            },
            client: {
              sessionDiscordConfig: {
                findUnique(): Promise<{ emojis: Record<string, string> }>;
              };
            },
            now: Date,
          ): Promise<void>;
        }
      ).assertRegistrationWindowOpen(
        {
          id: 'session-1',
          registrationOpenAt: null,
          registrationCloseAt: null,
        },
        {
          sessionDiscordConfig: {
            findUnique: async () => ({ emojis }),
          },
        },
        now,
      );

    await expect(
      registrationWindowOpen({
        registrationTimeZone: 'UTC',
        registrationWeeklySchedule: closedSchedule,
        registrationScheduleOverrideState: 'open',
      }),
    ).resolves.toBeUndefined();

    await expect(
      registrationWindowOpen({
        registrationTimeZone: 'UTC',
        registrationWeeklySchedule: JSON.stringify({
          monday: { enabled: true, open: '10:00', close: '20:00' },
        }),
        registrationScheduleOverrideState: 'closed',
      }),
    ).rejects.toThrow('Registration is closed');
  });

  it('rejects registration when the team has an active ban', async () => {
    const { service } = buildService({
      sessions: [makeSession()],
      discordConfigs: [makeDiscordConfig()],
      teams: [teamA],
      teamBans: [makeTeamBan({ reason: 'No-show abuse' })],
    });

    await expect(
      service.registerTeam('session-1', { teamId: teamA.id }, createActor()),
    ).rejects.toThrow('Team is banned: No-show abuse');
  });

  it('does not apply Discord team bans to sessions without Discord config', async () => {
    const { service } = buildService({
      sessions: [makeSession()],
      teams: [teamA],
      teamBans: [makeTeamBan({ reason: 'No-show abuse' })],
    });

    const result = await service.registerTeam(
      'session-1',
      { teamId: teamA.id },
      createActor(),
    );

    expect(result.status).toBe(SessionRegistrationStatus.CONFIRMED);
  });

  it('puts a team on the waitlist when confirmed slots are full', async () => {
    const { service } = buildService({
      sessions: [makeSession({ slotCount: 3 })],
      teams: [teamA, teamB],
      registrations: [
        makeRegistration({ id: 'registration-1', teamId: teamA.id }),
      ],
    });

    const result = await service.registerTeam(
      'session-1',
      { teamId: teamB.id },
      createActor(),
    );

    expect(result).toMatchObject({
      teamId: teamB.id,
      status: SessionRegistrationStatus.WAITLIST,
      slotNumber: null,
      waitlistPosition: 1,
    });
  });

  it('honors session Discord slot range before using waitlist', async () => {
    const { service } = buildService({
      sessions: [makeSession({ slotCount: 25 })],
      teams: [teamA, teamB, teamC],
      discordConfigs: [
        makeDiscordConfig({
          startSlot: 5,
          normalSlots: 2,
        }),
      ],
      registrations: [
        makeRegistration({
          id: 'confirmed-a',
          teamId: teamA.id,
          slotNumber: 5,
        }),
        makeRegistration({
          id: 'confirmed-b',
          teamId: teamB.id,
          slotNumber: 6,
        }),
      ],
    });

    const result = await service.registerTeam(
      'session-1',
      { teamId: teamC.id },
      createActor(),
    );

    expect(result).toMatchObject({
      teamId: teamC.id,
      status: SessionRegistrationStatus.WAITLIST,
      slotNumber: null,
      waitlistPosition: 1,
    });
  });

  it('moves a waitlisted team into the next configured VIP slot', async () => {
    const { service, prisma } = buildService({
      sessions: [makeSession({ slotCount: 25 })],
      teams: [teamA, teamB],
      discordConfigs: [
        makeDiscordConfig({
          startSlot: 3,
          normalSlots: 20,
          vipSlots: 3,
        }),
      ],
      registrations: [
        makeRegistration({
          id: 'confirmed-a',
          teamId: teamA.id,
          slotNumber: 3,
        }),
        makeRegistration({
          id: 'wait-b',
          teamId: teamB.id,
          status: SessionRegistrationStatus.WAITLIST,
          slotNumber: null,
          waitlistPosition: 1,
          confirmedAt: null,
        }),
      ],
    });

    const result = await service.updateRegistrationPlacement(
      'session-1',
      'wait-b',
      { action: SessionRegistrationPlacementAction.VIP },
      createActor(),
    );

    expect(result).toMatchObject({
      id: 'wait-b',
      teamId: teamB.id,
      status: SessionRegistrationStatus.CONFIRMED,
      slotNumber: 23,
      waitlistPosition: null,
    });
    const updated = prisma.__state.registrations.find(
      (item) => item.id === 'wait-b',
    );
    expect(updated?.slotNumber).toBe(23);
  });

  it('keeps waitlist teams waiting when a confirmed registration is removed', async () => {
    const { service, prisma } = buildService({
      sessions: [makeSession({ slotCount: 3 })],
      teams: [teamA, teamB],
      registrations: [
        makeRegistration({
          id: 'confirmed-a',
          teamId: teamA.id,
          slotNumber: 3,
        }),
        makeRegistration({
          id: 'wait-b',
          teamId: teamB.id,
          status: SessionRegistrationStatus.WAITLIST,
          slotNumber: null,
          waitlistPosition: 1,
          confirmedAt: null,
        }),
      ],
    });

    const result = await service.removeRegistration(
      'session-1',
      'confirmed-a',
      { removalReason: 'No show' },
      createActor(),
    );

    expect(result.removedRegistration).toMatchObject({
      id: 'confirmed-a',
      status: SessionRegistrationStatus.REMOVED,
    });
    expect(result.promotedRegistration).toBeNull();
    const waitlisted = prisma.__state.registrations.find(
      (item) => item.id === 'wait-b',
    );
    expect(waitlisted?.status).toBe(SessionRegistrationStatus.WAITLIST);
    expect(waitlisted?.slotNumber).toBeNull();
    expect(waitlisted?.waitlistPosition).toBe(1);
    expect(prisma.$queryRaw).toHaveBeenCalled();
    expect(prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      }),
    );
  });

  it('compacts remaining waitlist positions when a waitlist registration is removed', async () => {
    const { service, prisma } = buildService({
      sessions: [makeSession({ slotCount: 3 })],
      teams: [teamA, teamB, teamC],
      registrations: [
        makeRegistration({
          id: 'confirmed-a',
          teamId: teamA.id,
          slotNumber: 3,
        }),
        makeRegistration({
          id: 'wait-b',
          teamId: teamB.id,
          status: SessionRegistrationStatus.WAITLIST,
          slotNumber: null,
          waitlistPosition: 1,
          confirmedAt: null,
        }),
        makeRegistration({
          id: 'wait-c',
          teamId: teamC.id,
          status: SessionRegistrationStatus.WAITLIST,
          slotNumber: null,
          waitlistPosition: 2,
          confirmedAt: null,
        }),
      ],
    });

    const result = await service.removeRegistration(
      'session-1',
      'wait-b',
      { removalReason: 'Dropped' },
      createActor(),
    );

    expect(result.promotedRegistration).toBeNull();
    const remainingWait = prisma.__state.registrations.find(
      (item) => item.id === 'wait-c',
    );
    expect(remainingWait?.waitlistPosition).toBe(1);
  });

  it('does not allow cross-org access to a session', async () => {
    const { service } = buildService({
      sessions: [makeSession()],
      teams: [teamA],
    });

    await expect(
      service.registerTeam(
        'session-1',
        { teamId: teamA.id },
        createActor('org-2'),
      ),
    ).rejects.toThrow(NotFoundException);
  });

  it('reuses a removed registration record when the team re-registers', async () => {
    const { service, prisma } = buildService({
      sessions: [makeSession({ slotCount: 3 })],
      teams: [teamA],
      registrations: [
        makeRegistration({
          id: 'registration-removed',
          teamId: teamA.id,
          status: SessionRegistrationStatus.REMOVED,
          slotNumber: null,
          waitlistPosition: null,
          confirmedAt: null,
          removedAt: new Date('2026-03-25T10:10:00.000Z'),
          removalReason: 'Dropped',
          deletedAt: new Date('2026-03-25T10:10:00.000Z'),
        }),
      ],
    });

    const result = await service.registerTeam(
      'session-1',
      { teamId: teamA.id, note: 'Back in' },
      createActor(),
    );

    expect(result).toMatchObject({
      id: 'registration-removed',
      teamId: teamA.id,
      status: SessionRegistrationStatus.CONFIRMED,
      slotNumber: 3,
      waitlistPosition: null,
      removedAt: null,
      removalReason: null,
      note: 'Back in',
    });
    expect(
      prisma.__state.registrations.filter((item) => item.teamId === teamA.id),
    ).toHaveLength(1);
  });

  it('rejects duplicate active slot assignments before registering more teams', async () => {
    const { service } = buildService({
      sessions: [makeSession({ slotCount: 25 })],
      teams: [teamA, teamB, teamC],
      registrations: [
        makeRegistration({
          id: 'confirmed-a',
          teamId: teamA.id,
          slotNumber: 3,
        }),
        makeRegistration({
          id: 'confirmed-b',
          teamId: teamB.id,
          slotNumber: 3,
        }),
      ],
    });

    await expect(
      service.registerTeam('session-1', { teamId: teamC.id }, createActor()),
    ).rejects.toThrow('Duplicate active session slot assignment detected');
  });

  it('rejects duplicate active waitlist positions before registering more teams', async () => {
    const { service } = buildService({
      sessions: [makeSession({ slotCount: 3 })],
      teams: [
        teamA,
        teamB,
        teamC,
        { ...teamA, id: 'team-d', name: 'Delta', tag: 'DLT' },
      ],
      registrations: [
        makeRegistration({
          id: 'confirmed-a',
          teamId: teamA.id,
          slotNumber: 3,
        }),
        makeRegistration({
          id: 'wait-b',
          teamId: teamB.id,
          status: SessionRegistrationStatus.WAITLIST,
          slotNumber: null,
          waitlistPosition: 1,
          confirmedAt: null,
        }),
        makeRegistration({
          id: 'wait-c',
          teamId: teamC.id,
          status: SessionRegistrationStatus.WAITLIST,
          slotNumber: null,
          waitlistPosition: 1,
          confirmedAt: null,
        }),
      ],
    });

    await expect(
      service.registerTeam('session-1', { teamId: 'team-d' }, createActor()),
    ).rejects.toThrow('Duplicate active session waitlist position detected');
  });

  it('creates a session-linked match through the matches service', async () => {
    const { service, matches } = buildService({
      sessions: [makeSession()],
    });
    matches.createForSession.mockResolvedValue({
      id: 'match-session-1',
      sessionId: 'session-1',
      name: 'Scrim Lobby 1',
    });

    const result = await service.createMatch(
      'session-1',
      { name: 'Scrim Lobby 1', slotCount: 16 },
      createActor(),
    );

    expect(result).toMatchObject({
      id: 'match-session-1',
      sessionId: 'session-1',
    });
    expect(matches.createForSession).toHaveBeenCalledWith(
      expect.objectContaining({ actingOrgId: 'org-1' }),
      'session-1',
      expect.objectContaining({ name: 'Scrim Lobby 1' }),
    );
  });

  it('syncs event match slots from confirmed registrations after creation', async () => {
    const { service, matches } = buildService({
      sessions: [makeSession({ type: SessionType.EVENT })],
    });
    matches.createForSession.mockResolvedValue({
      id: 'match-event-1',
      sessionId: 'session-1',
      name: 'Event Match 1',
    });
    const syncSpy = jest
      .spyOn(service, 'syncMatchSlotsFromRegistrations')
      .mockResolvedValue({
        matchId: 'match-event-1',
        teams: 12,
        slots: 12,
        updatedSlots: 12,
        clearedSlots: 0,
        resetResults: 0,
      });

    const actor = createActor();
    await service.createMatch(
      'session-1',
      { name: 'Event Match 1', slotCount: 25 },
      actor,
    );

    expect(syncSpy).toHaveBeenCalledWith('session-1', 'match-event-1', actor);
  });
});
