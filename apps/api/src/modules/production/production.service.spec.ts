import { Logger } from '@nestjs/common';
import {
  DataMode,
  MatchDataSource,
  MatchStatus,
  PcobStatus,
  Role,
} from '@prisma/client';
import { ProductionService } from './production.service';

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
    );
    expect(scoring.recomputeMatchAndTournament).toHaveBeenCalledWith('match-1');
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        'Post-start scoring refresh failed for match match-1',
      ),
    );
  });

  it('binds PCOB atomically with adapterKey and mode fields', async () => {
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
