import { ConflictException } from '@nestjs/common';
import { GameKey, MatchStatus } from '@prisma/client';
import { MatchesService } from './matches.service';

const actor = {
  id: 'u-1',
  actorId: 'u-1',
  role: null,
  actorRole: null,
  organizationId: 'org-1',
  actingOrgId: 'org-1',
};

describe('MatchesService.moveSlot', () => {
  const buildService = () => {
    const matchControl = {
      refreshLiveContractState: jest.fn().mockResolvedValue(null),
    };
    const tx = {
      matchSlot: {
        findFirst: jest.fn(),
      },
    };
    const prisma = {
      _dmmf: { modelMap: { Match: { fields: [] } } },
      $transaction: jest
        .fn()
        .mockImplementation(
          async (callback: (client: typeof tx) => Promise<void> | void) =>
            callback(tx),
        ),
    } as any;

    const resultsEvents = {
      emitControlContractUpdated: jest.fn(),
      emitResultsLockState: jest.fn(),
    } as any;

    const service = new MatchesService(
      prisma,
      {} as any,
      {} as any,
      {
        getAdapterByKey: jest.fn().mockReturnValue(null),
      } as any,
      {} as any,
      {
        ensureResultsFromSlots: jest.fn(),
        recomputeAllSlots: jest.fn(),
      } as any,
      resultsEvents,
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
      status: MatchStatus.LIVE,
      slotCount: 25,
      liveState: null,
      dataSource: 'MANUAL',
      dataMode: 'MANUAL',
      controlState: { state: 'LIVE' },
      game: { key: GameKey.PUBG_MOBILE },
      tournament: {
        ownerUserId: 'u-1',
        organizationId: 'org-1',
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
    jest
      .spyOn(service as any, 'ensureTeamAllowedForMatch')
      .mockResolvedValue(undefined);
    jest
      .spyOn(service as any, 'applySlotAssignmentInTransaction')
      .mockResolvedValue(undefined);
    jest.spyOn(service as any, 'logSlotAudit').mockResolvedValue(undefined);
    jest.spyOn(service, 'listSlots').mockResolvedValue([]);

    return {
      service,
      prisma,
      tx,
      resultsEvents,
      matchControl,
      match,
      applySlotAssignmentInTransaction: (service as any)
        .applySlotAssignmentInTransaction as jest.Mock,
    };
  };

  it('swaps occupied source and target slots inside one transaction', async () => {
    const {
      service,
      prisma,
      tx,
      resultsEvents,
      matchControl,
      match,
      applySlotAssignmentInTransaction,
    } = buildService();

    tx.matchSlot.findFirst
      .mockResolvedValueOnce({ slotNumber: 2 })
      .mockResolvedValueOnce({ teamId: 'team-2' });

    await service.moveSlot(
      'm-1',
      {
        teamId: 'team-1',
        sourceSlotNumber: 2,
        targetSlotNumber: 5,
      },
      actor,
    );

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(applySlotAssignmentInTransaction).toHaveBeenNthCalledWith(
      1,
      tx,
      match,
      5,
      'team-1',
    );
    expect(applySlotAssignmentInTransaction).toHaveBeenNthCalledWith(
      2,
      tx,
      match,
      2,
      'team-2',
    );
    expect(resultsEvents.emitControlContractUpdated).toHaveBeenCalledWith(
      'm-1',
      'SLOTS_CHANGED',
    );
    expect(matchControl.refreshLiveContractState).toHaveBeenCalledWith('m-1');
  });

  it('moves an unassigned team into an occupied slot with one atomic assignment', async () => {
    const {
      service,
      prisma,
      tx,
      resultsEvents,
      matchControl,
      match,
      applySlotAssignmentInTransaction,
    } = buildService();

    tx.matchSlot.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ teamId: 'team-2' });

    await service.moveSlot(
      'm-1',
      {
        teamId: 'team-1',
        targetSlotNumber: 5,
      },
      actor,
    );

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(applySlotAssignmentInTransaction).toHaveBeenCalledTimes(1);
    expect(applySlotAssignmentInTransaction).toHaveBeenCalledWith(
      tx,
      match,
      5,
      'team-1',
    );
    expect(resultsEvents.emitControlContractUpdated).toHaveBeenCalledWith(
      'm-1',
      'SLOTS_CHANGED',
    );
    expect(matchControl.refreshLiveContractState).toHaveBeenCalledWith('m-1');
  });

  it('rejects stale source slot moves before mutating state', async () => {
    const { service, prisma, tx, applySlotAssignmentInTransaction } =
      buildService();

    tx.matchSlot.findFirst.mockResolvedValueOnce({ slotNumber: 4 });

    await expect(
      service.moveSlot(
        'm-1',
        {
          teamId: 'team-1',
          sourceSlotNumber: 2,
          targetSlotNumber: 5,
        },
        actor,
      ),
    ).rejects.toThrow(
      new ConflictException(
        'Slot assignment changed. Reload slots and try again.',
      ),
    );
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(applySlotAssignmentInTransaction).not.toHaveBeenCalled();
  });
});
