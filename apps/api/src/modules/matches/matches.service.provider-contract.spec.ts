import {
  DataMode,
  GameKey,
  LiveState,
  MatchDataSource,
  MatchResultSource,
  MatchStatus,
} from '@prisma/client';
import { MatchesService } from './matches.service';

describe('MatchesService provider contract', () => {
  const actor = {
    id: 'user-1',
    actorId: 'user-1',
    role: 'ORGANIZER',
    actorRole: 'ORGANIZER',
    organizationId: 'org-1',
    actingOrgId: 'org-1',
  } as any;

  const buildMatch = (overrides: Record<string, unknown> = {}) => ({
    id: 'match-1',
    name: 'Match 1',
    organizationId: 'org-1',
    tournamentId: 'tournament-1',
    stageId: 'stage-1',
    groupId: 'group-1',
    sessionId: null,
    gameId: 'game-pubgm',
    map: 'ERANGEL',
    recallEnabled: false,
    dataMode: DataMode.MANUAL,
    dataSource: MatchDataSource.MANUAL,
    resultSource: MatchResultSource.MANUAL,
    pcobSessionId: null,
    pcobMode: false,
    pcobBoundAt: null,
    pcobLastSeenAt: null,
    pcobStatus: 'PENDING',
    matchNumber: 1,
    adapterKey: 'pubgm-manual',
    status: MatchStatus.LIVE,
    scheduledAt: null,
    startedAt: new Date('2026-04-01T10:00:00.000Z'),
    endedAt: null,
    liveState: LiveState.LIVE,
    liveAt: new Date('2026-04-01T10:00:00.000Z'),
    createdAt: new Date('2026-04-01T09:00:00.000Z'),
    updatedAt: new Date('2026-04-01T10:05:00.000Z'),
    tournament: {
      ownerUserId: 'user-1',
      organizationId: 'org-1',
      name: 'Tournament 1',
      game: GameKey.PUBG_MOBILE,
      id: 'tournament-1',
    },
    stage: { id: 'stage-1', name: 'Stage 1' },
    group: { id: 'group-1', name: 'Group 1' },
    controlState: {
      state: 'LIVE',
      metaJson: null,
    },
    game: { key: GameKey.PUBG_MOBILE },
    ...overrides,
  });

  const buildService = () => {
    const prisma = {
      _dmmf: { modelMap: { Match: { fields: [] } } },
      game: {
        findUnique: jest.fn(
          async ({ where }: { where: Record<string, unknown> }) => {
            if (
              where.id === 'game-pubgm' ||
              where.key === GameKey.PUBG_MOBILE
            ) {
              return { id: 'game-pubgm', key: GameKey.PUBG_MOBILE };
            }
            return null;
          },
        ),
      },
      organization: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'org-1',
          planId: 'multi-game-production',
          accessMode: null,
          enabledGames: [GameKey.PUBG_MOBILE, GameKey.FREE_FIRE],
        }),
      },
      match: {
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      matchSlot: {
        aggregate: jest.fn().mockResolvedValue({ _max: { slotNumber: 0 } }),
      },
    } as any;

    const adapters = {
      getAdapterByKey: jest.fn((key: string | null | undefined) => {
        const normalized = `${key ?? ''}`.trim().toLowerCase();
        if (normalized === 'pubgm-manual') {
          return { key: 'pubgm-manual', gameKey: GameKey.PUBG_MOBILE };
        }
        if (normalized === 'pubgm-pcob') {
          return { key: 'pubgm-pcob', gameKey: GameKey.PUBG_MOBILE };
        }
        return null;
      }),
    } as any;

    const service = new MatchesService(
      prisma,
      {} as any,
      {} as any,
      adapters,
      { broadcast: jest.fn() } as any,
      {} as any,
      { emitResultsLockState: jest.fn() } as any,
      {} as any,
      { emitForMatch: jest.fn() } as any,
      {} as any,
      {} as any,
      {} as any,
    );

    return { service, prisma };
  };

  const groupContext = {
    groupId: 'group-1',
    stageId: 'stage-1',
    tournamentId: 'tournament-1',
    organizationId: 'org-1',
    tournamentGameKey: GameKey.PUBG_MOBILE,
  };

  const sessionContext = {
    sessionId: 'session-1',
    organizationId: 'org-1',
    slotCount: 16,
    gameId: null,
    rulesetId: null,
    adapterKey: null,
    sessionGameKey: GameKey.PUBG_MOBILE,
  };

  it('resolves the active live match in the actor organization', async () => {
    const { service, prisma } = buildService();
    prisma.match.findFirst.mockResolvedValue(
      buildMatch({
        id: 'match-live',
        name: 'Live Match',
        status: MatchStatus.LIVE,
        liveState: LiveState.LIVE,
        liveAt: new Date('2026-04-01T10:02:00.000Z'),
        startedAt: new Date('2026-04-01T10:00:00.000Z'),
        updatedAt: new Date('2026-04-01T10:05:00.000Z'),
      }),
    );

    await expect(service.getActiveMatch(actor)).resolves.toEqual({
      id: 'match-live',
      matchId: 'match-live',
      status: 'LIVE',
      liveState: LiveState.LIVE,
      tournamentId: 'tournament-1',
      stageId: 'stage-1',
      groupId: 'group-1',
      matchNumber: 1,
      matchName: 'Live Match',
      map: 'ERANGEL',
      startsAt: '2026-04-01T10:02:00.000Z',
      sessionId: null,
      sessionName: null,
    });
    expect(prisma.match.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: 'org-1',
          deletedAt: null,
          endedAt: null,
          status: MatchStatus.LIVE,
          liveState: { not: LiveState.ENDED },
        }),
      }),
    );
  });

  it('rejects explicit PCOB provider create from the generic match setup flow', async () => {
    const { service } = buildService();

    await expect(
      (service as any).buildMatchCreateInput(
        {
          name: 'PCOB Match',
          gameKey: GameKey.PUBG_MOBILE,
          map: 'ERANGEL',
          dataSource: MatchDataSource.PCOB,
        },
        groupContext,
      ),
    ).rejects.toThrow('dataSource must be one of MANUAL, API');
  });

  it('allows API match create when pcobSessionId is omitted entirely', async () => {
    const { service } = buildService();

    await expect(
      (service as any).buildMatchCreateInput(
        {
          name: 'API Match',
          gameKey: GameKey.PUBG_MOBILE,
          map: 'ERANGEL',
          dataSource: MatchDataSource.API,
        },
        groupContext,
      ),
    ).resolves.toEqual(
      expect.objectContaining({
        dataSource: MatchDataSource.API,
        dataMode: DataMode.MANUAL,
        resultSource: MatchResultSource.TELEMETRY,
        pcobSessionId: null,
        pcobMode: false,
        adapterKey: null,
      }),
    );
  });

  it('creates OCR matches as manual telemetry with an OCR result source', async () => {
    const { service } = buildService();

    await expect(
      (service as any).buildMatchCreateInput(
        {
          name: 'OCR Match',
          gameKey: GameKey.PUBG_MOBILE,
          map: 'ERANGEL',
          dataSource: MatchDataSource.MANUAL,
          resultSource: MatchResultSource.OCR,
        },
        groupContext,
      ),
    ).resolves.toEqual(
      expect.objectContaining({
        dataSource: MatchDataSource.MANUAL,
        dataMode: DataMode.MANUAL,
        resultSource: MatchResultSource.OCR,
        pcobSessionId: null,
        pcobMode: false,
        adapterKey: null,
      }),
    );
  });

  it('rejects OCR result source when telemetry is selected', async () => {
    const { service } = buildService();

    await expect(
      (service as any).buildMatchCreateInput(
        {
          name: 'Conflicting OCR Match',
          gameKey: GameKey.PUBG_MOBILE,
          map: 'ERANGEL',
          dataSource: MatchDataSource.API,
          resultSource: MatchResultSource.OCR,
        },
        groupContext,
      ),
    ).rejects.toThrow('OCR result source requires a MANUAL dataSource');
  });

  it('allows API session match create when pcobSessionId is omitted entirely', async () => {
    const { service } = buildService();

    await expect(
      (service as any).buildSessionMatchCreateInput(
        {
          name: 'Session API Match',
          map: 'ERANGEL',
          dataSource: MatchDataSource.API,
        },
        sessionContext,
      ),
    ).resolves.toEqual(
      expect.objectContaining({
        sessionId: 'session-1',
        dataSource: MatchDataSource.API,
        dataMode: DataMode.MANUAL,
        pcobSessionId: null,
        pcobMode: false,
        adapterKey: null,
      }),
    );
  });

  it('switching from PCOB to a non-PCOB provider clears stale binding fields', async () => {
    const { service, prisma } = buildService();
    const currentMatch = buildMatch({
      dataMode: DataMode.PCOB,
      dataSource: MatchDataSource.PCOB,
      pcobSessionId: 'session-1',
      pcobMode: true,
      pcobBoundAt: new Date('2026-04-01T09:58:00.000Z'),
      pcobLastSeenAt: new Date('2026-04-01T10:04:00.000Z'),
      adapterKey: 'pubgm-pcob',
    });
    const updatedMatch = buildMatch({
      dataMode: DataMode.MANUAL,
      dataSource: MatchDataSource.MANUAL,
      pcobSessionId: null,
      pcobMode: false,
      pcobBoundAt: null,
      pcobLastSeenAt: null,
      adapterKey: null,
    });

    prisma.match.findFirst.mockResolvedValue(currentMatch);
    prisma.match.update.mockResolvedValue(updatedMatch);

    await service.setDataSource(actor, 'match-1', MatchDataSource.MANUAL);

    expect(prisma.match.update).toHaveBeenCalledWith({
      where: { id: 'match-1' },
      data: expect.objectContaining({
        dataSource: MatchDataSource.MANUAL,
        dataMode: DataMode.MANUAL,
        pcobSessionId: null,
        pcobBoundAt: null,
        pcobLastSeenAt: null,
        pcobMode: false,
        pcobKillSyncEnabled: false,
        adapterKey: null,
      }),
      select: expect.any(Object),
    });
  });

  it('rejects generic PCOB session linking for API/manual matches', async () => {
    const { service, prisma } = buildService();
    jest.spyOn(service, 'validatePubgSlots').mockResolvedValue(undefined);
    prisma.match.findFirst.mockResolvedValue(buildMatch());

    await expect(
      service.linkPcobSession(actor, 'match-1', 'session-1'),
    ).rejects.toThrow('Legacy PCOB session linking is disabled');

    expect(service.validatePubgSlots).not.toHaveBeenCalled();
    expect(prisma.match.update).not.toHaveBeenCalled();
  });

  it('rejects generic PCOB session unlinking for API/manual matches', async () => {
    const { service, prisma } = buildService();
    prisma.match.findFirst.mockResolvedValue(
      buildMatch({
        dataSource: MatchDataSource.API,
        dataMode: DataMode.MANUAL,
        pcobSessionId: 'session-1',
        adapterKey: 'pubgm-pcob',
      }),
    );

    await expect(service.unlinkPcobSession(actor, 'match-1')).rejects.toThrow(
      'Legacy PCOB session linking is disabled',
    );

    expect(prisma.match.update).not.toHaveBeenCalled();
  });

  it('generic updates normalize a legacy PCOB match when AUTO is used as a compatibility alias', async () => {
    const { service, prisma } = buildService();
    const currentMatch = buildMatch({
      dataMode: DataMode.PCOB,
      dataSource: MatchDataSource.PCOB,
      pcobSessionId: 'session-1',
      pcobMode: true,
      pcobBoundAt: new Date('2026-04-01T09:58:00.000Z'),
      pcobLastSeenAt: new Date('2026-04-01T10:04:00.000Z'),
      adapterKey: 'pubgm-pcob',
    });
    const updatedMatch = buildMatch({
      name: 'Renamed Match',
      dataMode: DataMode.PCOB,
      dataSource: MatchDataSource.PCOB,
      pcobSessionId: 'session-1',
      pcobMode: true,
      pcobBoundAt: new Date('2026-04-01T09:58:00.000Z'),
      pcobLastSeenAt: new Date('2026-04-01T10:04:00.000Z'),
      adapterKey: 'pubgm-pcob',
    });

    prisma.match.findFirst
      .mockResolvedValueOnce(currentMatch)
      .mockResolvedValueOnce(updatedMatch);
    prisma.match.update.mockResolvedValue({ id: 'match-1' });

    const result = await service.update(
      'match-1',
      { name: 'Renamed Match', dataSource: 'AUTO' },
      actor,
    );

    const updateCall = prisma.match.update.mock.calls[0][0];
    expect(updateCall.data).toEqual(
      expect.objectContaining({
        name: 'Renamed Match',
        dataSource: MatchDataSource.API,
        dataMode: DataMode.MANUAL,
        pcobSessionId: null,
        pcobMode: false,
        adapterKey: null,
      }),
    );
    expect(updateCall.data.pcobBoundAt).toBeNull();
    expect(updateCall.data.pcobLastSeenAt).toBeNull();
    expect(result).toEqual(
      expect.objectContaining({
        telemetryProvider: MatchDataSource.API,
        sourceMode: MatchDataSource.API,
      }),
    );
    expect(result).not.toHaveProperty('pcobSessionId');
    expect(result).not.toHaveProperty('pcobMode');
    expect(result).not.toHaveProperty('pcobBoundAt');
    expect(result).not.toHaveProperty('pcobLastSeenAt');
    expect(result).not.toHaveProperty('adapterKey');
    expect(result).not.toHaveProperty('pcobConfigured');
    expect(result).not.toHaveProperty('pcobBound');
    expect(result).not.toHaveProperty('pcobReady');
  });

  it('canonical match reads expose provider and source mode without treating AUTO as authoritative', async () => {
    const { service, prisma } = buildService();
    prisma.match.findFirst.mockResolvedValue(
      buildMatch({
        dataSource: MatchDataSource.AUTO,
        dataMode: DataMode.MANUAL,
        pcobSessionId: null,
        pcobMode: false,
        adapterKey: 'pubgm-manual',
      }),
    );

    const result = await service.get(actor, 'match-1');

    expect(result).toEqual(
      expect.objectContaining({
        dataSource: MatchDataSource.API,
        telemetryProvider: MatchDataSource.API,
        sourceMode: MatchDataSource.API,
      }),
    );
    expect(result).not.toHaveProperty('pcobSessionId');
    expect(result).not.toHaveProperty('pcobMode');
    expect(result).not.toHaveProperty('pcobBoundAt');
    expect(result).not.toHaveProperty('pcobLastSeenAt');
    expect(result).not.toHaveProperty('adapterKey');
  });
});
