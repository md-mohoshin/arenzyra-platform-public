import { ConflictException } from '@nestjs/common';
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

describe('MatchesService.syncSlotsFromPreviousMatch', () => {
  const buildService = (options?: {
    currentAssignedCount?: number;
    currentMatchNumber?: number;
    previousCandidates?: Array<{ id: string; matchNumber: number }>;
    slotsByMatchId?: Record<
      string,
      Array<{ slotNumber: number; teamId: string }>
    >;
  }) => {
    const currentAssignedCount = options?.currentAssignedCount ?? 0;
    const currentMatchNumber = options?.currentMatchNumber ?? 2;
    const currentMatch = {
      id: 'm-2',
      tournamentId: 't-1',
      stageId: 's-1',
      groupId: 'g-1',
      matchNumber: currentMatchNumber,
      adapterKey: null,
      status: MatchStatus.DRAFT,
      slotCount: 25,
      liveState: null,
      controlState: { state: null },
      game: { key: GameKey.PUBG_MOBILE },
      tournament: {
        ownerUserId: 'u-1',
        organizationId: 'org-1',
        status: TournamentStatus.ACTIVE,
        game: GameKey.PUBG_MOBILE,
      },
    };
    const previousMatch = {
      id: 'm-1',
      matchNumber: currentMatchNumber - 1,
    };
    const previousSlots = options?.slotsByMatchId?.[previousMatch.id] ?? [
      { slotNumber: 1, teamId: 'team-1' },
      { slotNumber: 2, teamId: 'team-2' },
    ];
    const previousCandidates = options?.previousCandidates ?? [previousMatch];

    const findFirst = jest.fn().mockImplementation(({ where }) => {
      if (where?.id === 'm-2') {
        return Promise.resolve(currentMatch);
      }
      return Promise.resolve(null);
    });
    const findManyMatches = jest.fn().mockImplementation(({ where }) => {
      if (where?.tournamentId === 't-1' && where?.groupId === 'g-1') {
        return Promise.resolve(previousCandidates);
      }
      return Promise.resolve([]);
    });

    const tx = {
      matchSlotResult: {
        findMany: jest.fn().mockResolvedValue([{ id: 'sr-1' }, { id: 'sr-2' }]),
        deleteMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
      matchSlotPlayerResult: {
        deleteMany: jest.fn().mockResolvedValue({ count: 8 }),
      },
      matchSlot: {
        deleteMany: jest.fn().mockResolvedValue({ count: 2 }),
        createMany: jest
          .fn()
          .mockResolvedValue({ count: previousSlots.length }),
      },
    };

    const prisma = {
      _dmmf: { modelMap: { Match: { fields: [] } } },
      match: {
        findFirst,
        findMany: findManyMatches,
      },
      matchSlot: {
        findMany: jest.fn().mockImplementation(({ where }) => {
          if (where?.matchId === 'm-2') {
            return Promise.resolve(
              currentAssignedCount > 0
                ? previousSlots.slice(0, currentAssignedCount)
                : [],
            );
          }
          if (where?.matchId && options?.slotsByMatchId?.[where.matchId]) {
            return Promise.resolve(options.slotsByMatchId[where.matchId]);
          }
          if (where?.matchId === previousMatch.id) {
            return Promise.resolve(previousSlots);
          }
          return Promise.resolve([]);
        }),
        count: jest.fn().mockResolvedValue(currentAssignedCount),
      },
      $transaction: jest
        .fn()
        .mockImplementation(
          (callback: (client: typeof tx) => Promise<void> | void) =>
            Promise.resolve(callback(tx)),
        ),
    } as any;

    const results = {
      ensureResultsFromSlots: jest.fn().mockResolvedValue([]),
      recomputeAllSlots: jest.fn().mockResolvedValue(undefined),
    } as any;

    const service = new MatchesService(
      prisma,
      {} as any,
      {} as any,
      {
        getAdapterByKey: jest.fn().mockReturnValue(null),
      } as any,
      {} as any,
      results,
      {
        emitResultsLockState: jest.fn(),
      } as any,
      {} as any,
      {
        emitForMatch: jest.fn(),
      } as any,
      {} as any,
      {} as any,
      {} as any,
    );

    return { service, prisma, tx, results, previousSlots };
  };

  it('copies slot assignments from the previous match', async () => {
    const { service, tx, results, previousSlots } = buildService({
      currentAssignedCount: 0,
    });

    const synced = await service.syncSlotsFromPreviousMatch('m-2', actor, {});

    expect(tx.matchSlot.deleteMany).toHaveBeenCalledWith({
      where: { matchId: 'm-2' },
    });
    expect(tx.matchSlot.createMany).toHaveBeenCalledWith({
      data: previousSlots.map((slot) => ({
        matchId: 'm-2',
        slotNumber: slot.slotNumber,
        teamId: slot.teamId,
        lobbyStatus: 'WAITING',
        playersInLobby: 0,
      })),
    });
    expect(results.ensureResultsFromSlots).toHaveBeenCalledWith('m-2', { tx });
    expect(synced).toMatchObject({
      ok: true,
      previousMatchId: 'm-1',
      previousMatchNumber: 1,
      syncedSlots: 2,
      replaced: false,
      message: 'Teams synced from the nearest populated previous match.',
    });
  });

  it('requires overwrite confirmation when the current match already has slots', async () => {
    const { service, prisma } = buildService({
      currentAssignedCount: 1,
    });

    await expect(
      service.syncSlotsFromPreviousMatch('m-2', actor, {}),
    ).rejects.toThrow(
      new ConflictException(
        'This match already has slot assignments. Replace them with previous match slots?',
      ),
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('falls back to the nearest earlier populated match when the immediate previous match is empty', async () => {
    const { service } = buildService({
      currentMatchNumber: 3,
      previousCandidates: [
        { id: 'm-2-empty', matchNumber: 2 },
        { id: 'm-1', matchNumber: 1 },
      ],
      slotsByMatchId: {
        'm-2-empty': [],
        'm-1': [
          { slotNumber: 3, teamId: 'team-3' },
          { slotNumber: 4, teamId: 'team-4' },
        ],
      },
    });

    const synced = await service.syncSlotsFromPreviousMatch('m-2', actor, {});

    expect(synced).toMatchObject({
      ok: true,
      previousMatchId: 'm-1',
      previousMatchNumber: 1,
      syncedSlots: 2,
      message: 'Teams synced from the nearest populated previous match.',
    });
  });

  it('supports dry-run diagnostics without mutating slots', async () => {
    const { service, prisma } = buildService({
      currentAssignedCount: 1,
    });

    const plan = await service.syncSlotsFromPreviousMatch('m-2', actor, {
      dryRun: true,
    });

    expect(plan).toMatchObject({
      ok: true,
      dryRun: true,
      previousMatchId: 'm-1',
      previousMatchNumber: 1,
      syncedSlots: 2,
      currentAssignedCount: 1,
      needsSync: true,
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
