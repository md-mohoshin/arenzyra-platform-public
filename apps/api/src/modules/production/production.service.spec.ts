import { Logger } from '@nestjs/common';
import {
  DataMode,
  MatchDataSource,
  MatchStatus,
  PcobStatus,
  Role,
  SessionRegistrationStatus,
} from '@prisma/client';
import { syncMatchSlotsWithSessionRegistrations } from '../sessions/session-match-slot-sync';
import { ProductionService } from './production.service';

jest.mock('../sessions/session-match-slot-sync', () => ({
  syncMatchSlotsWithSessionRegistrations: jest.fn(),
}));

describe('ProductionService.startMatch', () => {
  const prisma = {
    match: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    matchSlotResult: {
      updateMany: jest.fn(),
    },
    tournament: {
      findFirst: jest.fn(),
      update: jest.fn(),
    },
  };
  const scoring = {
    recomputeMatchAndTournament: jest.fn(),
  };
  const auditService = {
    log: jest.fn(),
  };
  const pcobGateway = {
    bindSession: jest.fn(),
    unbindSession: jest.fn(),
    emitStatus: jest.fn(),
  };
  const matchControl = {
    startMatch: jest.fn(),
    endMatch: jest.fn(),
    setStatus: jest.fn(),
  };
  const realtime = {
    emitMatchStatusUpdated: jest.fn(),
  };
  const rankingEmitter = {
    emitLiveRanking: jest.fn(),
    emitOverallRanking: jest.fn(),
  };

  let service: ProductionService;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    service = new ProductionService(
      prisma as any,
      scoring as any,
      auditService as any,
      pcobGateway as any,
      matchControl as any,
      realtime as any,
      rankingEmitter as any,
    );
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('returns success even if the post-start scoring refresh fails', async () => {
    prisma.match.findUnique.mockResolvedValue({
      id: 'match-1',
      status: MatchStatus.DRAFT,
      liveState: null,
      dataMode: DataMode.MANUAL,
      dataSource: MatchDataSource.MANUAL,
      pcobMode: false,
      pcobSessionId: null,
      pcobStatus: PcobStatus.PENDING,
      deletedAt: null,
      tournamentId: 'tournament-1',
      tournament: {
        id: 'tournament-1',
        deletedAt: null,
        ownerUserId: 'owner-1',
        organizationId: 'org-1',
      },
    });
    prisma.match.update.mockResolvedValue({});
    matchControl.startMatch.mockResolvedValue({ ok: true });
    scoring.recomputeMatchAndTournament.mockRejectedValue(
      new Error('Slot 3 is eliminated but placement is missing'),
    );

    await expect(
      service.startMatch(null, 'match-1', {
        id: 'owner-1',
        actorId: 'owner-1',
        role: Role.ORGANIZER,
        actorRole: Role.ORGANIZER,
      }),
    ).resolves.toEqual({
      ok: true,
      dataMode: DataMode.MANUAL,
      notice: undefined,
    });

    await Promise.resolve();

    expect(matchControl.startMatch).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'owner-1',
        actorId: 'owner-1',
        role: Role.ORGANIZER,
        actorRole: Role.ORGANIZER,
      }),
      'match-1',
      null,
      expect.objectContaining({
        source: 'production-service',
        requestedMatchId: 'match-1',
      }),
    );
    expect(scoring.recomputeMatchAndTournament).toHaveBeenCalledWith('match-1');
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        'Post-start scoring refresh failed for match match-1',
      ),
    );
  });

  it('rejects legacy PCOB binding for non-PCOB matches', async () => {
    prisma.match.findUnique.mockResolvedValue({
      id: 'match-1',
      status: MatchStatus.DRAFT,
      liveState: null,
      dataMode: DataMode.MANUAL,
      dataSource: MatchDataSource.MANUAL,
      pcobMode: false,
      pcobSessionId: null,
      pcobStatus: PcobStatus.PENDING,
      deletedAt: null,
      tournamentId: 'tournament-1',
      tournament: {
        id: 'tournament-1',
        deletedAt: null,
        ownerUserId: 'owner-1',
        organizationId: 'org-1',
      },
    });

    await expect(
      service.bindPcob(null, 'match-1', ' session-1 ', {
        id: 'owner-1',
        actorId: 'owner-1',
        role: Role.ORGANIZER,
        actorRole: Role.ORGANIZER,
      }),
    ).rejects.toThrow(
      'Legacy PCOB binding is disabled for API and MANUAL matches',
    );

    expect(prisma.match.update).not.toHaveBeenCalled();
    expect(pcobGateway.emitStatus).not.toHaveBeenCalled();
  });

  it('binds legacy PCOB matches atomically with adapterKey and mode fields', async () => {
    prisma.match.findUnique.mockResolvedValue({
      id: 'match-1',
      status: MatchStatus.DRAFT,
      liveState: null,
      dataMode: DataMode.PCOB,
      dataSource: MatchDataSource.PCOB,
      pcobMode: true,
      pcobSessionId: null,
      pcobStatus: PcobStatus.PENDING,
      deletedAt: null,
      tournamentId: 'tournament-1',
      tournament: {
        id: 'tournament-1',
        deletedAt: null,
        ownerUserId: 'owner-1',
        organizationId: 'org-1',
      },
    });
    prisma.match.update.mockResolvedValue({ id: 'match-1' });

    await expect(
      service.bindPcob(null, 'match-1', ' session-1 ', {
        id: 'owner-1',
        actorId: 'owner-1',
        role: Role.ORGANIZER,
        actorRole: Role.ORGANIZER,
      }),
    ).resolves.toEqual({ id: 'match-1' });

    expect(prisma.match.update).toHaveBeenCalledWith({
      where: { id: 'match-1' },
      data: {
        pcobSessionId: 'session-1',
        pcobBoundAt: expect.any(Date),
        pcobMode: true,
        dataMode: DataMode.PCOB,
        dataSource: MatchDataSource.PCOB,
        adapterKey: 'pubgm-pcob',
      },
    });
    expect(pcobGateway.emitStatus).toHaveBeenCalledWith('match-1', {
      type: 'pcob:match:bound',
      pcobSessionId: 'session-1',
    });
  });

  it('rejects legacy PCOB unbind for non-PCOB matches', async () => {
    prisma.match.findUnique.mockResolvedValue({
      id: 'match-1',
      status: MatchStatus.DRAFT,
      liveState: null,
      dataMode: DataMode.MANUAL,
      dataSource: MatchDataSource.API,
      pcobMode: false,
      pcobSessionId: 'session-1',
      adapterKey: 'pubgm-pcob',
      pcobStatus: PcobStatus.PENDING,
      deletedAt: null,
      tournamentId: 'tournament-1',
      tournament: {
        id: 'tournament-1',
        deletedAt: null,
        ownerUserId: 'owner-1',
        organizationId: 'org-1',
      },
    });

    await expect(
      service.unbindPcob(null, 'match-1', {
        id: 'owner-1',
        actorId: 'owner-1',
        role: Role.ORGANIZER,
        actorRole: Role.ORGANIZER,
      }),
    ).rejects.toThrow(
      'Legacy PCOB binding is disabled for API and MANUAL matches',
    );

    expect(prisma.match.update).not.toHaveBeenCalled();
    expect(pcobGateway.emitStatus).not.toHaveBeenCalled();
  });

  it('routes reset through match-control so run-boundary state is cleared centrally', async () => {
    prisma.match.findUnique.mockResolvedValue({
      id: 'match-1',
      status: MatchStatus.ENDED,
      liveState: 'ENDED',
      dataMode: DataMode.PCOB,
      dataSource: MatchDataSource.PCOB,
      pcobMode: true,
      pcobSessionId: 'session-old',
      pcobStatus: PcobStatus.PENDING,
      deletedAt: null,
      tournamentId: 'tournament-1',
      tournament: {
        id: 'tournament-1',
        deletedAt: null,
        ownerUserId: 'owner-1',
        organizationId: 'org-1',
      },
    });
    prisma.matchSlotResult.updateMany.mockResolvedValue({ count: 4 });
    matchControl.setStatus.mockResolvedValue({ ok: true });
    scoring.recomputeMatchAndTournament.mockResolvedValue(undefined);

    await expect(
      service.resetMatch(null, 'match-1', {
        id: 'owner-1',
        actorId: 'owner-1',
        role: Role.ORGANIZER,
        actorRole: Role.ORGANIZER,
      }),
    ).resolves.toEqual({ ok: true });

    expect(prisma.matchSlotResult.updateMany).toHaveBeenCalledWith({
      where: { matchId: 'match-1' },
      data: {
        wasPresentInMatch: null,
        placement: null,
        placementPoints: 0,
        totalKills: 0,
        points: 0,
        totalPoints: 0,
        manualTotalKills: false,
      },
    });
    expect(matchControl.setStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'owner-1',
        actorId: 'owner-1',
      }),
      'match-1',
      { status: 'READY' },
    );
  });
});

describe('ProductionService production teams', () => {
  const service = new ProductionService(
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );

  it('creates a separate production team when only the tag matches', async () => {
    const tx = {
      team: {
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn(),
        create: jest.fn().mockResolvedValue({
          id: 'team-new',
          name: 'BigBaby',
          tag: 'BBY',
          logoUrl: null,
        }),
      },
    };

    const result = await (
      service as never as {
        findOrCreateProductionTeam(params: unknown): Promise<unknown>;
      }
    ).findOrCreateProductionTeam({
      tx,
      organizationId: 'org-1',
      ownerUserId: 'owner-1',
      name: 'BigBaby',
      tag: 'BBY',
    });

    expect(tx.team.findFirst).toHaveBeenCalledTimes(1);
    expect(tx.team.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          name: { equals: 'BigBaby', mode: 'insensitive' },
        }),
      }),
    );
    expect(tx.team.update).not.toHaveBeenCalled();
    expect(tx.team.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: 'BigBaby',
          tag: 'BBY',
        }),
      }),
    );
    expect(result).toEqual({
      id: 'team-new',
      name: 'BigBaby',
      tag: 'BBY',
      logoUrl: null,
    });
  });
});

describe('ProductionService production discord sets', () => {
  const actor = {
    id: 'organizer-1',
    actorId: 'organizer-1',
    role: Role.ORGANIZER,
    actorRole: Role.ORGANIZER,
  };

  let storedConfig: any;
  let prisma: any;
  let service: ProductionService;

  beforeEach(() => {
    storedConfig = {
      enabled: true,
      guildId: null,
      guildName: null,
      sets: [
        {
          key: 'production-1',
          index: 1,
          setName: 'set-1',
          categoryId: 'category-1',
          slotsChannelId: 'slots-1',
          productionRoleId: 'role-1',
        },
      ],
    };
    prisma = {
      organizationFeature: {
        findUnique: jest.fn().mockImplementation(() =>
          Promise.resolve({
            organizationId: 'org-1',
            featureKey: 'production.discord.enabled',
            isEnabled: true,
            config: storedConfig,
          }),
        ),
        upsert: jest.fn().mockImplementation(({ update, create }) => {
          storedConfig = update?.config ?? create?.config;
          return Promise.resolve({
            organizationId: 'org-1',
            featureKey: 'production.discord.enabled',
            isEnabled: true,
            config: storedConfig,
          });
        }),
      },
      organizationDiscordGuild: {
        findFirst: jest.fn(),
      },
      organizationDiscordConfig: {
        findFirst: jest.fn(),
      },
      session: {
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    service = new ProductionService(
      prisma,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
  });

  it('creates the next production set and links the selected event', async () => {
    prisma.session.findFirst.mockResolvedValue({
      id: 'event-2',
      name: 'Grand Final',
    });
    prisma.session.findMany.mockResolvedValue([
      { id: 'event-2', name: 'Grand Final' },
    ]);

    const result = await service.createProductionDiscordSet(
      'org-1',
      { eventId: 'event-2' },
      actor,
    );

    expect(result.setKey).toBe('production-2');
    expect(prisma.organizationFeature.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          config: expect.objectContaining({
            sets: expect.arrayContaining([
              expect.objectContaining({
                key: 'production-2',
                index: 2,
                setName: 'set-2',
                eventId: 'event-2',
                eventName: 'Grand Final',
              }),
            ]),
          }),
        }),
      }),
    );
  });

  it('deletes only the requested production set', async () => {
    storedConfig.sets.push({
      key: 'production-2',
      index: 2,
      setName: 'set-2',
      eventId: 'event-2',
      eventName: 'Grand Final',
      categoryId: 'category-2',
      slotsChannelId: 'slots-2',
      productionRoleId: 'role-2',
    });

    const result = await service.deleteProductionDiscordSet(
      'org-1',
      'set-1',
      actor,
    );

    expect(result.deletedSetKey).toBe('production-1');
    expect(prisma.organizationFeature.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          config: expect.objectContaining({
            sets: [
              expect.objectContaining({
                key: 'production-2',
                setName: 'set-2',
              }),
            ],
          }),
        }),
      }),
    );
  });
});

describe('ProductionService production slot auto-sync', () => {
  const syncedMatchResult = {
    matchId: 'match-1',
    teams: 1,
    slots: 1,
    updatedSlots: 1,
    clearedSlots: 1,
    resetResults: 0,
  };

  let prisma: any;
  let service: ProductionService;

  beforeEach(() => {
    jest.clearAllMocks();
    (
      syncMatchSlotsWithSessionRegistrations as jest.MockedFunction<
        typeof syncMatchSlotsWithSessionRegistrations
      >
    ).mockResolvedValue(syncedMatchResult);

    prisma = {
      $transaction: jest.fn((fn: (tx: unknown) => unknown) => fn(prisma)),
      sessionRegistration: {
        findMany: jest.fn(),
        update: jest
          .fn()
          .mockImplementation(({ where }: { where: { id: string } }) =>
            Promise.resolve({ id: where.id }),
          ),
        create: jest.fn(),
      },
      session: {
        update: jest.fn().mockResolvedValue({ id: 'event-1' }),
        findFirst: jest.fn().mockResolvedValue({ slotCount: 25 }),
      },
      match: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'match-1',
            slotCount: 25,
            dataMode: DataMode.MANUAL,
            dataSource: MatchDataSource.MANUAL,
          },
        ]),
        update: jest.fn(),
      },
    };
    service = new ProductionService(
      prisma,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
  });

  it('refreshes the linked production event and removes stale production slots', async () => {
    prisma.session.findFirst
      .mockResolvedValueOnce({
        id: 'event-1',
        name: 'Production Event',
        slotCount: 25,
        maxTeams: 25,
      })
      .mockResolvedValueOnce({ slotCount: 25 });
    prisma.sessionRegistration.findMany.mockResolvedValueOnce([
      {
        id: 'reg-current',
        teamId: 'team-current',
        status: SessionRegistrationStatus.CONFIRMED,
        slotNumber: 3,
        note: 'PRODUCTION_EVENT_IMPORT:category=cat;channel=slots;message=old-message;slot=3',
      },
      {
        id: 'reg-stale',
        teamId: 'team-stale',
        status: SessionRegistrationStatus.CONFIRMED,
        slotNumber: 4,
        note: 'PRODUCTION_EVENT_IMPORT:category=cat;channel=slots;message=old-message;slot=4',
      },
    ]);

    const result = await (
      service as never as {
        syncLinkedProductionEventFromSlots(params: unknown): Promise<unknown>;
      }
    ).syncLinkedProductionEventFromSlots({
      organizationId: 'org-1',
      productionSet: {
        key: 'production-1',
        index: 1,
        setName: null,
        eventId: 'event-1',
        eventName: 'Production Event',
        categoryId: 'cat',
        categoryName: 'Production',
        slotsChannelId: 'slots',
        slotsChannelName: 'slots',
        logosChannelId: null,
        logosChannelName: null,
        playerPhotosChannelId: null,
        playerPhotosChannelName: null,
        idpChannelId: null,
        idpChannelName: null,
        logsChannelId: null,
        logsChannelName: null,
        productionRoleId: null,
        productionRoleName: 'Production',
        startSlot: 3,
        normalSlots: 23,
        vipSlots: 0,
        slots: [
          {
            slotNumber: 3,
            teamId: 'team-current',
            teamName: 'ENVY US',
            teamTag: 'ENVY',
            sourceChannelId: 'slots',
            sourceMessageId: 'new-message',
            importedAt: '2026-06-02T16:52:24.433Z',
          },
        ],
        lastSlotImport: {
          sourceChannelId: 'slots',
          sourceMessageId: 'new-message',
          importedAt: '2026-06-02T16:52:24.433Z',
          parsedSlotRows: 1,
          importedTeams: 1,
        },
      },
    });

    expect(prisma.sessionRegistration.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'reg-current' },
        data: expect.objectContaining({
          status: SessionRegistrationStatus.CONFIRMED,
          slotNumber: 3,
          note: 'PRODUCTION_EVENT_IMPORT:category=cat;channel=slots;set=production-1;message=new-message;slot=3',
        }),
      }),
    );
    expect(prisma.sessionRegistration.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'reg-stale' },
        data: expect.objectContaining({
          status: SessionRegistrationStatus.REMOVED,
          slotNumber: null,
          removalReason: 'Removed from production slot-list import',
        }),
      }),
    );
    expect(syncMatchSlotsWithSessionRegistrations).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        sessionId: 'event-1',
        organizationId: 'org-1',
        matchId: 'match-1',
      }),
    );
    expect(result).toEqual({
      sessionId: 'event-1',
      sessionName: 'Production Event',
      importedTeams: 1,
      removedTeams: 1,
      skipped: [],
      syncedMatches: [syncedMatchResult],
    });
  });
});
