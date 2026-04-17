import { NotFoundException } from '@nestjs/common';
import {
  AuditAction,
  GameKey,
  Prisma,
  Role,
  SessionRegistrationStatus,
  SessionStatus,
  SessionType,
} from '@prisma/client';
import type { AuthUser } from '../../common/auth/auth.types';
import type { PrismaService } from '../../db/prisma.service';
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
  status: SessionRegistrationStatus;
  slotNumber: number | null;
  waitlistPosition: number | null;
  checkedInAt: Date | null;
  confirmedAt: Date | null;
  removedAt: Date | null;
  removalReason: string | null;
  note: string | null;
  registeredById: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
};

type GameRecord = {
  id: string;
  key: GameKey;
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
  games?: GameRecord[];
}) {
  const state = {
    sessions: [...(seed?.sessions ?? [])],
    teams: [...(seed?.teams ?? [])],
    registrations: [...(seed?.registrations ?? [])],
    games: [
      ...(seed?.games ?? [
        { id: 'game-pubgm', key: GameKey.PUBG_MOBILE },
        { id: 'game-ff', key: GameKey.FREE_FIRE },
      ]),
    ],
    sessionSeq: 0,
    registrationSeq: 0,
  };

  const withTeam = (registration: RegistrationRecord) => ({
    ...registration,
    team: state.teams.find((team) => team.id === registration.teamId) ?? null,
  });

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
          status: data.status,
          slotNumber: data.slotNumber ?? null,
          waitlistPosition: data.waitlistPosition ?? null,
          checkedInAt: data.checkedInAt ?? null,
          confirmedAt: data.confirmedAt ?? null,
          removedAt: data.removedAt ?? null,
          removalReason: data.removalReason ?? null,
          note: data.note ?? null,
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
    slotCount: 2,
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
    status: SessionRegistrationStatus.CONFIRMED,
    slotNumber: 1,
    waitlistPosition: null,
    checkedInAt: null,
    confirmedAt: new Date('2026-03-25T10:05:00.000Z'),
    removedAt: null,
    removalReason: null,
    note: null,
    registeredById: 'user-org-1',
    createdAt: new Date('2026-03-25T10:05:00.000Z'),
    updatedAt: new Date('2026-03-25T10:05:00.000Z'),
    deletedAt: null,
    ...overrides,
  });

  const buildService = (seed?: {
    sessions?: SessionRecord[];
    teams?: TeamRecord[];
    registrations?: RegistrationRecord[];
    games?: GameRecord[];
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

  it('registers a team into the next open slot and confirms it', async () => {
    const { service, prisma } = buildService({
      sessions: [makeSession({ slotCount: 2 })],
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
      slotNumber: 1,
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

  it('puts a team on the waitlist when confirmed slots are full', async () => {
    const { service } = buildService({
      sessions: [makeSession({ slotCount: 1 })],
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

  it('promotes the next waitlist team when a confirmed registration is removed', async () => {
    const { service, prisma } = buildService({
      sessions: [makeSession({ slotCount: 1 })],
      teams: [teamA, teamB],
      registrations: [
        makeRegistration({
          id: 'confirmed-a',
          teamId: teamA.id,
          slotNumber: 1,
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
    expect(result.promotedRegistration).toMatchObject({
      id: 'wait-b',
      status: SessionRegistrationStatus.CONFIRMED,
      slotNumber: 1,
      waitlistPosition: null,
    });
    const promoted = prisma.__state.registrations.find(
      (item) => item.id === 'wait-b',
    );
    expect(promoted?.slotNumber).toBe(1);
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
      sessions: [makeSession({ slotCount: 1 })],
      teams: [teamA, teamB, teamC],
      registrations: [
        makeRegistration({
          id: 'confirmed-a',
          teamId: teamA.id,
          slotNumber: 1,
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
      sessions: [makeSession({ slotCount: 1 })],
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
      slotNumber: 1,
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
      sessions: [makeSession({ slotCount: 2 })],
      teams: [teamA, teamB, teamC],
      registrations: [
        makeRegistration({
          id: 'confirmed-a',
          teamId: teamA.id,
          slotNumber: 1,
        }),
        makeRegistration({
          id: 'confirmed-b',
          teamId: teamB.id,
          slotNumber: 1,
        }),
      ],
    });

    await expect(
      service.registerTeam('session-1', { teamId: teamC.id }, createActor()),
    ).rejects.toThrow('Duplicate active session slot assignment detected');
  });

  it('rejects duplicate active waitlist positions before registering more teams', async () => {
    const { service } = buildService({
      sessions: [makeSession({ slotCount: 1 })],
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
          slotNumber: 1,
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
});
