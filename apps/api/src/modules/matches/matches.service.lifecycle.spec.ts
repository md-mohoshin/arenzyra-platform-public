import { BadRequestException } from '@nestjs/common';
import { MatchStatus, TournamentStatus } from '@prisma/client';
import { MatchesService } from './matches.service';

describe('MatchesService lifecycle guards', () => {
  const buildService = (opts: {
    tournamentStatus: TournamentStatus;
    matchStatus?: MatchStatus;
  }) => {
    const prisma = {
      _dmmf: { modelMap: { Match: { fields: [] } } },
      match: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'm-1',
          status: opts.matchStatus ?? MatchStatus.DRAFT,
          liveState: null,
          dataSource: null,
          dataMode: null,
          matchSlots: [],
          matchTeams: [],
          tournamentId: 't-1',
          tournament: {
            ownerUserId: 'u-1',
            organizationId: 'org-1',
            status: opts.tournamentStatus,
          },
          controlState: { state: null },
        }),
        update: jest.fn().mockResolvedValue({ id: 'm-1' }),
      },
      matchSlotResult: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      matchSlot: { deleteMany: jest.fn() },
      matchTeam: { deleteMany: jest.fn() },
    } as any;

    const noop = () => {};

    const scoring = {} as any;
    const pcob = {} as any;
    const adapters = {} as any;
    const scoreboard = {} as any;
    const results = {
      ensureResultsFromSlots: jest.fn().mockResolvedValue(undefined),
      recomputeAllSlots: jest.fn().mockResolvedValue(undefined),
    } as any;
    const resultsEvents = {} as any;
    resultsEvents.emitResultsLockState = jest.fn();
    const standings = {} as any;
    const broadcast = { emitForMatch: noop } as any;
    const audit = {} as any;
    const matchControl = {
      startMatch: jest.fn(),
      stopMatch: jest.fn(),
      setStatus: jest.fn().mockResolvedValue(undefined),
    } as any;

    const service = new MatchesService(
      prisma,
      scoring,
      pcob,
      adapters,
      scoreboard,
      results,
      resultsEvents,
      standings,
      broadcast,
      audit,
      matchControl,
    );

    return { service, prisma, matchControl };
  };

  it('blocks LIVE transition when tournament not ACTIVE', async () => {
    const { service } = buildService({
      tournamentStatus: TournamentStatus.DRAFT,
    });

    await expect(
      service.setStatus('m-1', MatchStatus.LIVE, {
        id: 'u-1',
        actorId: 'u-1',
        role: null,
        actorRole: null,
        organizationId: 'org-1',
        actingOrgId: 'org-1',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('allows LIVE transition when tournament ACTIVE', async () => {
    const { service } = buildService({
      tournamentStatus: TournamentStatus.ACTIVE,
      matchStatus: MatchStatus.DRAFT,
    });

    await expect(
      service.setStatus('m-1', MatchStatus.LIVE, {
        id: 'u-1',
        actorId: 'u-1',
        role: null,
        actorRole: null,
        organizationId: 'org-1',
        actingOrgId: 'org-1',
      }),
    ).resolves.toBeDefined();
  });

  it('routes DRAFT reset through match-control to clear prior run state', async () => {
    const { service, prisma, matchControl } = buildService({
      tournamentStatus: TournamentStatus.ACTIVE,
      matchStatus: MatchStatus.ENDED,
    });

    await expect(
      service.setStatus('m-1', MatchStatus.DRAFT, {
        id: 'u-1',
        actorId: 'u-1',
        role: null,
        actorRole: null,
        organizationId: 'org-1',
        actingOrgId: 'org-1',
      }),
    ).resolves.toBeDefined();

    expect(prisma.matchSlotResult.updateMany).toHaveBeenCalledWith({
      where: { matchId: 'm-1' },
      data: {
        wasPresentInMatch: null,
        placement: null,
        eliminatedAt: null,
        placementAuto: true,
      },
    });
    expect(matchControl.setStatus).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: 'u-1' }),
      'm-1',
      { status: 'READY' },
    );
  });

  it('refuses to finalize placements when multiple teams are still alive', async () => {
    const prisma = {
      _dmmf: { modelMap: { Match: { fields: [] } } },
      matchSlotResult: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'slot-1',
            matchId: 'm-1',
            slotNumber: 1,
            teamId: 'team-1',
            wasPresentInMatch: true,
            placement: null,
            placementAuto: true,
            eliminatedAt: null,
          },
          {
            id: 'slot-2',
            matchId: 'm-1',
            slotNumber: 2,
            teamId: 'team-2',
            wasPresentInMatch: true,
            placement: null,
            placementAuto: true,
            eliminatedAt: null,
          },
        ]),
      },
      matchSlotPlayerResult: {
        groupBy: jest.fn().mockResolvedValue([
          { slotResultId: 'slot-1', _count: { slotResultId: 1 } },
          { slotResultId: 'slot-2', _count: { slotResultId: 1 } },
        ]),
      },
      matchEvent: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      $transaction: jest.fn(),
    } as any;

    const service = new MatchesService(
      prisma,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

    await expect(
      (service as any).finalizePlacementsOnEnd('m-1', null),
    ).rejects.toThrow('multiple teams are still alive');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
