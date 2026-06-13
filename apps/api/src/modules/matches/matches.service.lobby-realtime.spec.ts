import { GameKey, MatchStatus, TournamentStatus } from '@prisma/client';
import { MatchesService } from './matches.service';

const actor = {
  id: 'u-1',
  actorId: 'u-1',
  role: null,
  actorRole: null,
  organizationId: 'org-1',
  actingOrgId: 'org-1',
};

describe('MatchesService lobby realtime notifications', () => {
  const buildService = (status: MatchStatus = MatchStatus.LIVE) => {
    const matchControl = {
      refreshLiveContractState: jest.fn().mockResolvedValue(null),
    };
    const resultsEvents = {
      emitControlContractUpdated: jest.fn(),
      emitResultsLockState: jest.fn(),
    };
    const tx = {
      matchTeam: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        upsert: jest.fn().mockResolvedValue({}),
      },
      matchSlot: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        findMany: jest
          .fn()
          .mockResolvedValue([{ teamId: 'team-a', slotNumber: 1 }]),
      },
    };
    const results = {
      ensureResultsFromSlots: jest.fn().mockResolvedValue([]),
      recomputeAllSlots: jest.fn(),
    };
    const prisma = {
      _dmmf: { modelMap: { Match: { fields: [] } } },
      matchTeam: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      matchSlot: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: 'slot-3', teamId: 'team-3' }),
        update: jest.fn().mockResolvedValue({}),
      },
      $transaction: jest
        .fn()
        .mockImplementation(
          async (callback: (client: typeof tx) => Promise<void> | void) =>
            callback(tx),
        ),
    } as any;

    const service = new MatchesService(
      prisma,
      {} as any,
      {} as any,
      {
        getAdapterByKey: jest.fn().mockReturnValue(null),
      } as any,
      {} as any,
      results as any,
      resultsEvents as any,
      {} as any,
      {
        emitForMatch: jest.fn(),
      } as any,
      {} as any,
      matchControl as any,
      {} as any,
    );

    const match = {
      id: 'm-1',
      tournamentId: 't-1',
      stageId: 's-1',
      groupId: 'g-1',
      matchNumber: 1,
      adapterKey: null,
      status,
      slotCount: 25,
      liveState: null,
      dataSource: 'MANUAL',
      dataMode: 'MANUAL',
      controlState: { state: status === MatchStatus.LIVE ? 'LIVE' : null },
      game: { key: GameKey.PUBG_MOBILE },
      tournament: {
        ownerUserId: 'u-1',
        organizationId: 'org-1',
        status: TournamentStatus.ACTIVE,
        game: GameKey.PUBG_MOBILE,
      },
    };
    const capability = {
      usesSlots: true,
      maxSlots: 25,
      adapterKey: null,
      gameKey: GameKey.PUBG_MOBILE,
    };

    jest
      .spyOn(service as any, 'getSlotContext')
      .mockResolvedValue({ match, capability });
    jest.spyOn(service as any, 'getMatch').mockResolvedValue(match);
    jest
      .spyOn(service as any, 'ensureTeamAllowedForMatch')
      .mockResolvedValue(undefined);
    jest
      .spyOn(service as any, 'applySlotAssignmentInTransaction')
      .mockResolvedValue(undefined);
    jest.spyOn(service as any, 'logSlotAudit').mockResolvedValue(undefined);
    jest
      .spyOn(service as any, 'autoEndIfLastTeamAlive')
      .mockResolvedValue(undefined);
    jest.spyOn(service, 'listSlots').mockResolvedValue([]);
    jest.spyOn(service, 'listTeams').mockResolvedValue([]);

    return { service, prisma, tx, results, matchControl, resultsEvents };
  };

  it('refreshes the live contract after setting a live slot', async () => {
    const { service, matchControl, resultsEvents } = buildService();

    await service.setSlot('m-1', 3, 'team-3', actor);

    expect(matchControl.refreshLiveContractState).toHaveBeenCalledWith('m-1');
    expect(resultsEvents.emitControlContractUpdated).toHaveBeenCalledWith(
      'm-1',
      'SLOTS_CHANGED',
    );
  });

  it('emits slot updates immediately after lobby readiness changes', async () => {
    const { service, prisma, matchControl, resultsEvents } = buildService();

    await service.updateSlotLobbyStatus(actor, 'm-1', 3, 'READY');

    expect(prisma.matchSlot.update).toHaveBeenCalledWith({
      where: { id: 'slot-3' },
      data: {
        lobbyStatus: 'READY',
        playersInLobby: 0,
      },
    });
    expect(matchControl.refreshLiveContractState).not.toHaveBeenCalled();
    expect(resultsEvents.emitControlContractUpdated).toHaveBeenCalledWith(
      'm-1',
      'SLOTS_CHANGED',
    );
  });

  it('refreshes the live contract after replacing the match team roster', async () => {
    const { service, prisma, tx, results, matchControl, resultsEvents } =
      buildService();

    await service.addTeams('m-1', ['team-a', 'team-b'], actor);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.matchTeam.deleteMany).toHaveBeenCalledWith({
      where: { matchId: 'm-1', deletedAt: null },
    });
    expect(tx.matchTeam.createMany).toHaveBeenCalledWith({
      data: [
        { matchId: 'm-1', teamId: 'team-a' },
        { matchId: 'm-1', teamId: 'team-b' },
      ],
      skipDuplicates: true,
    });
    expect(tx.matchSlot.deleteMany).toHaveBeenCalledWith({
      where: {
        matchId: 'm-1',
        OR: [{ teamId: null }, { teamId: { notIn: ['team-a', 'team-b'] } }],
      },
    });
    expect(results.ensureResultsFromSlots).toHaveBeenCalledWith('m-1', { tx });
    expect(tx.matchTeam.updateMany).toHaveBeenCalledWith({
      where: { matchId: 'm-1', slot: { not: null } },
      data: { slot: null },
    });
    expect(tx.matchTeam.upsert).toHaveBeenCalledWith({
      where: {
        matchId_teamId: {
          matchId: 'm-1',
          teamId: 'team-a',
        },
      },
      update: {
        slot: 1,
        status: 'ACTIVE',
        deletedAt: null,
      },
      create: {
        matchId: 'm-1',
        teamId: 'team-a',
        slot: 1,
        status: 'ACTIVE',
      },
    });
    expect(matchControl.refreshLiveContractState).toHaveBeenCalledWith('m-1');
    expect(resultsEvents.emitControlContractUpdated).toHaveBeenCalledWith(
      'm-1',
      'SLOTS_CHANGED',
    );
  });

  it('clears live slot data after removing a team from the match', async () => {
    const { service, tx, results, matchControl, resultsEvents } =
      buildService();

    await service.removeTeam('m-1', 'team-a', actor);

    expect(tx.matchTeam.deleteMany).toHaveBeenCalledWith({
      where: { matchId: 'm-1', teamId: 'team-a' },
    });
    expect(tx.matchSlot.deleteMany).toHaveBeenCalledWith({
      where: { matchId: 'm-1', teamId: 'team-a' },
    });
    expect(results.ensureResultsFromSlots).toHaveBeenCalledWith('m-1', { tx });
    expect(tx.matchTeam.updateMany).toHaveBeenCalledWith({
      where: { matchId: 'm-1', OR: [{ teamId: 'team-a' }] },
      data: { slot: null },
    });
    expect(matchControl.refreshLiveContractState).toHaveBeenCalledWith('m-1');
    expect(resultsEvents.emitControlContractUpdated).toHaveBeenCalledWith(
      'm-1',
      'SLOTS_CHANGED',
    );
  });
});
