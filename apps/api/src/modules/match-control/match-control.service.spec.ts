import { MatchControlService } from './match-control.service';
import { MatchStatus, LiveState } from '@prisma/client';
import { ConflictException } from '@nestjs/common';
import { LiveMatchState, MatchControlStateStore } from './state.store';
import { MatchControlGateway } from './match-control.gateway';
import { MatchStateService } from './match-state.service';
import { ScoreboardService } from '../scoreboard/scoreboard.service';
import { MatchesService } from '../matches/matches.service';
import { ScoringService } from '../scoring/scoring.service';
import { AuditService } from '../audit/audit.service';
import type { ResultsEventsService } from '../results/results-events.service';
import type { ResultsService } from '../results/results.service';
import type { LiveStateUpdatePayload } from '../matches/matches.service';
import type { PrismaService } from '../../db/prisma.service';
import type { Actor } from '../matches/matches.service';
import type { RealtimeGateway } from '../../realtime/realtime.gateway';
import type { RankingEmitterService } from '../../realtime/ranking-emitter.service';
import type { BroadcastService } from '../broadcast/broadcast.service';

describe('MatchControlService live exclusivity', () => {
  const actor: Actor = {
    id: 'user1',
    actorId: 'user1',
    role: 'SUPER_ADMIN',
    actorRole: 'SUPER_ADMIN',
    organizationId: null,
    actingOrgId: null,
  };

  type MatchShape = {
    id: string;
    name?: string | null;
    groupId: string | null;
    stageId?: string | null;
    tournamentId: string;
    status: MatchStatus;
    startedAt: Date | null;
    endedAt: Date | null;
    endedReason?: string | null;
    pcobSessionId?: string | null;
    pcobMode?: boolean | null;
    pcobBoundAt?: Date | null;
    pcobLastSeenAt?: Date | null;
    adapterKey?: string | null;
    dataSource?: string | null;
    dataMode?: string | null;
    updatedAt: Date;
    createdAt?: Date;
    scheduledAt?: Date | null;
    matchNumber?: number | null;
    tournament: { ownerUserId: string; organizationId: string };
    liveState?: LiveState;
    liveAt?: Date | null;
    controlState?: {
      state: string;
      metaJson?: Record<string, unknown> | null;
    } | null;
    matchSlots?: Array<{ id: string }>;
  };

  type PrismaMock = {
    match: {
      findFirst: jest.Mock<Promise<MatchShape | null>, [unknown?]>;
      findMany: jest.Mock<Promise<MatchShape[]>, [unknown?]>;
      updateMany: jest.Mock<Promise<{ count: number }>, [unknown?]>;
      update: jest.Mock<Promise<unknown>, [unknown?]>;
      groupBy: jest.Mock<Promise<Array<Record<string, unknown>>>, [unknown?]>;
    };
    matchControlState: {
      updateMany: jest.Mock<Promise<{ count: number }>, [unknown?]>;
      upsert: jest.Mock<Promise<unknown>, [unknown?]>;
    };
    matchStateSnapshot: {
      deleteMany: jest.Mock<Promise<{ count: number }>, [unknown?]>;
    };
    matchTelemetry: {
      deleteMany: jest.Mock<Promise<{ count: number }>, [unknown?]>;
    };
    telemetryEventLog: {
      deleteMany: jest.Mock<Promise<{ count: number }>, [unknown?]>;
    };
    matchTeam: {
      findMany: jest.Mock<
        Promise<
          Array<{
            teamId: string;
            team?: {
              name?: string | null;
              tag?: string | null;
              logoUrl?: string | null;
            } | null;
          }>
        >,
        [unknown?]
      >;
    };
    matchSlot: {
      findMany: jest.Mock<
        Promise<Array<{ teamId: string | null; slotNumber: number }>>,
        [unknown?]
      >;
    };
    matchSlotResult: {
      findMany: jest.Mock<
        Promise<
          Array<{
            teamId: string;
            totalKills?: number | null;
            placement?: number | null;
            totalPoints?: number | null;
            slotNumber?: number | null;
            players?: Array<{
              isAlive?: boolean | null;
              alive?: boolean | null;
            }>;
          }>
        >,
        [unknown?]
      >;
    };
    $transaction: jest.Mock<
      Promise<unknown>,
      [((tx: PrismaMock) => Promise<unknown>) | unknown[]]
    >;
  };

  const prisma: PrismaMock = {
    match: {
      findFirst: jest.fn<Promise<MatchShape | null>, [unknown?]>(),
      findMany: jest.fn<Promise<MatchShape[]>, [unknown?]>(),
      updateMany: jest.fn<Promise<{ count: number }>, [unknown?]>(),
      update: jest.fn<Promise<unknown>, [unknown?]>(),
      groupBy: jest.fn<Promise<Array<Record<string, unknown>>>, [unknown?]>(),
    },
    matchControlState: {
      updateMany: jest.fn<Promise<{ count: number }>, [unknown?]>(),
      upsert: jest.fn<Promise<unknown>, [unknown?]>(),
    },
    matchStateSnapshot: {
      deleteMany: jest.fn<Promise<{ count: number }>, [unknown?]>(() =>
        Promise.resolve({ count: 0 }),
      ),
    },
    matchTelemetry: {
      deleteMany: jest.fn<Promise<{ count: number }>, [unknown?]>(() =>
        Promise.resolve({ count: 0 }),
      ),
    },
    telemetryEventLog: {
      deleteMany: jest.fn<Promise<{ count: number }>, [unknown?]>(() =>
        Promise.resolve({ count: 0 }),
      ),
    },
    matchTeam: {
      findMany: jest.fn<
        Promise<
          Array<{
            teamId: string;
            team?: {
              name?: string | null;
              tag?: string | null;
              logoUrl?: string | null;
            } | null;
          }>
        >,
        [unknown?]
      >(),
    },
    matchSlot: {
      findMany: jest.fn<
        Promise<Array<{ teamId: string | null; slotNumber: number }>>,
        [unknown?]
      >(),
    },
    matchSlotResult: {
      findMany: jest.fn<
        Promise<
          Array<{
            teamId: string;
            totalKills?: number | null;
            placement?: number | null;
            totalPoints?: number | null;
          }>
        >,
        [unknown?]
      >(),
    },
    $transaction: jest.fn<
      Promise<unknown>,
      [((tx: PrismaMock) => Promise<unknown>) | unknown[]]
    >((arg) => (Array.isArray(arg) ? Promise.all(arg) : arg(prisma))),
  };

  const store: Pick<MatchControlStateStore, 'save' | 'get' | 'evictMatches'> = {
    save: jest.fn((_, state: LiveMatchState, expectedVersion?: number) =>
      Promise.resolve({
        ...state,
        version: (expectedVersion ?? state.version ?? 0) + 1,
        updatedAt: new Date().toISOString(),
      }),
    ),
    get: jest.fn(() => Promise.resolve(null)),
    evictMatches: jest.fn(() => Promise.resolve()),
  };

  const gateway: {
    emitMatchState: jest.Mock<void, [string, LiveMatchState]>;
    emitMatchEnd: jest.Mock<void, [string, LiveMatchState]>;
    emitMatchAutoEnd: jest.Mock<void, [string, LiveMatchState]>;
    emitMatchStateChanged: jest.Mock<void, [string, string, string, string?]>;
    emitLiveStateUpdates?: jest.Mock<void, [LiveStateUpdatePayload[]]>;
    emitSlotsAssigned: jest.Mock<
      void,
      [string, Array<{ teamId: string; slotNumber: number }>]
    >;
  } = {
    emitMatchState: jest.fn<void, [string, LiveMatchState]>(),
    emitMatchEnd: jest.fn<void, [string, LiveMatchState]>(),
    emitMatchAutoEnd: jest.fn<void, [string, LiveMatchState]>(),
    emitMatchStateChanged: jest.fn<void, [string, string, string, string?]>(),
    emitLiveStateUpdates: jest.fn<void, [LiveStateUpdatePayload[]]>(),
    emitSlotsAssigned: jest.fn<
      void,
      [string, Array<{ teamId: string; slotNumber: number }>]
    >(),
  };

  const scoreboard = { broadcast: jest.fn(() => Promise.resolve()) };
  const scoring = {
    recomputeTournament: jest.fn(),
    recomputeMatchAndTournament: jest.fn(() => Promise.resolve(undefined)),
  };
  const matchState = {
    mapControlToBusinessStatus: jest.fn((value: string) => {
      if (value === 'READY' || value === 'COUNTDOWN') {
        return MatchStatus.DRAFT;
      }
      if (value === 'LIVE' || value === 'PAUSED') {
        return MatchStatus.LIVE;
      }
      if (value === 'ENDED') {
        return MatchStatus.ENDED;
      }
      if (value === 'CONFIRMED') {
        return MatchStatus.FINISHED;
      }
      return value as MatchStatus;
    }),
  };
  const matchesService = {
    validatePubgSlots: jest.fn(() => Promise.resolve()),
    syncLiveHierarchy: jest.fn(() =>
      Promise.resolve([] as LiveStateUpdatePayload[]),
    ),
    assignSlotsIfMissing: jest.fn<
      Promise<Array<{ teamId: string; slotNumber: number }>>,
      [string, unknown?]
    >(() => Promise.resolve([])),
  };
  const audit = { log: jest.fn(() => Promise.resolve()) };
  const realtime = {
    emitMatchStatusUpdated: jest.fn(),
  } as unknown as RealtimeGateway;
  const rankingEmitter = {
    emitLiveRanking: jest.fn(),
    emitOverallRanking: jest.fn(),
  } as unknown as RankingEmitterService;
  const resultsService = {
    ensureResultsFromSlots: jest.fn(() => Promise.resolve(undefined)),
    resetLiveProjection: jest.fn(() => Promise.resolve(undefined)),
    recalculateMatchResults: jest.fn(() => Promise.resolve(undefined)),
  } as unknown as ResultsService;
  const broadcast = { emitForMatch: jest.fn() } as unknown as BroadcastService;
  const liveStateMirror = {
    publish: jest
      .fn()
      .mockImplementation(async (state: LiveMatchState) => state),
  };
  const conclusion = {
    conclude: jest.fn(() => Promise.resolve(undefined)),
  };

  let service: MatchControlService;

  const baseMatch: MatchShape = {
    id: 'A',
    name: 'Match A',
    groupId: 'G',
    stageId: 'S',
    tournamentId: 'T',
    status: MatchStatus.DRAFT,
    startedAt: null,
    endedAt: null,
    updatedAt: new Date(),
    createdAt: new Date('2026-03-18T10:00:00.000Z'),
    scheduledAt: null,
    matchNumber: 1,
    tournament: { ownerUserId: 'user1', organizationId: 'org1' },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.match.groupBy.mockResolvedValue([]);
    prisma.matchControlState.updateMany.mockResolvedValue({ count: 0 });
    prisma.matchControlState.upsert.mockResolvedValue({});
    const resultsEvents: ResultsEventsService = {
      emitResultsLockState: jest.fn(),
      emitResultsUpdated: jest.fn(),
      emitLeaderboardUpdated: jest.fn(),
      emitOverlayPayload: jest.fn(),
      emitMatchUpdate: jest.fn(),
    } as unknown as ResultsEventsService;
    service = new MatchControlService(
      prisma as unknown as PrismaService,
      scoring as unknown as ScoringService,
      store as unknown as MatchControlStateStore,
      gateway as unknown as MatchControlGateway,
      matchState as unknown as MatchStateService,
      scoreboard as unknown as ScoreboardService,
      matchesService as unknown as MatchesService,
      audit as unknown as AuditService,
      resultsService,
      resultsEvents,
      broadcast,
      realtime,
      rankingEmitter,
      conclusion as any,
      liveStateMirror as any,
    );
  });

  const buildInitializedLiveState = (
    aliveTeams: number,
    options?: {
      totalTeams?: number;
      totalPlayersPerTeam?: number;
      initialized?: boolean;
      lastAliveTeams?: number;
      lastAliveTeamsAt?: number | null;
      firstValidAt?: number | null;
      circlePhase?: number | null;
    },
  ): LiveMatchState => {
    const totalTeams = options?.totalTeams ?? 10;
    const totalPlayersPerTeam = options?.totalPlayersPerTeam ?? 1;
    return {
      matchId: 'A',
      status: 'LIVE',
      startedAt: new Date('2026-03-18T09:59:00.000Z').toISOString(),
      endedAt: null,
      version: 1,
      updatedAt: new Date('2026-03-18T10:00:00.000Z').toISOString(),
      initialized: options?.initialized ?? true,
      firstValidAt:
        options?.firstValidAt === undefined
          ? Date.parse('2026-03-18T10:00:00.000Z')
          : options.firstValidAt,
      lastAliveTeams: options?.lastAliveTeams,
      lastAliveTeamsAt: options?.lastAliveTeamsAt,
      ...(options?.circlePhase !== undefined
        ? {
            circle:
              options.circlePhase === null
                ? null
                : { phase: options.circlePhase },
          }
        : {}),
      teams: Array.from({ length: totalTeams }, (_, index) => ({
        teamId: `team-${index + 1}`,
        name: `Team ${index + 1}`,
        tag: null,
        slot: index + 1,
        kills: 0,
        placement: null,
        points: null,
        logoUrl: null,
        alivePlayers: index < aliveTeams ? totalPlayersPerTeam : 0,
        totalPlayers: totalPlayersPerTeam,
        alive: index < aliveTeams,
        eliminated: index >= aliveTeams,
      })),
      summary: {
        totalTeams,
        aliveTeams,
        totalPlayers: totalTeams * totalPlayersPerTeam,
        alivePlayers: aliveTeams * totalPlayersPerTeam,
        winnerTeamId: aliveTeams === 1 ? 'team-1' : null,
        winnerSlot: aliveTeams === 1 ? 1 : null,
      },
    };
  };

  it('ignores finish detection while telemetry has not initialized', async () => {
    const nowMs = Date.parse('2026-03-18T10:01:00.000Z');
    const dateNowSpy = jest.spyOn(Date, 'now').mockReturnValue(nowMs);
    const lifecycleSpy = jest
      .spyOn(service, 'getLifecycleState')
      .mockResolvedValue({ matchId: 'A' } as any);
    prisma.match.findFirst.mockResolvedValue({
      ...baseMatch,
      status: MatchStatus.LIVE,
      liveAt: new Date('2026-03-18T10:00:00.000Z'),
      startedAt: new Date('2026-03-18T10:00:00.000Z'),
      controlState: { state: 'LIVE', metaJson: null },
    });
    (store.get as jest.Mock).mockResolvedValueOnce(
      buildInitializedLiveState(1, { initialized: false }),
    );

    try {
      await expect(service.detectMatchFinish('A')).resolves.toEqual({
        matchId: 'A',
      });
    } finally {
      dateNowSpy.mockRestore();
    }

    expect(prisma.$transaction).not.toHaveBeenCalled();
    lifecycleSpy.mockRestore();
  });

  it('ignores finish detection during the live stabilization window', async () => {
    const nowMs = Date.parse('2026-03-18T10:00:20.000Z');
    const dateNowSpy = jest.spyOn(Date, 'now').mockReturnValue(nowMs);
    const lifecycleSpy = jest
      .spyOn(service, 'getLifecycleState')
      .mockResolvedValue({ matchId: 'A' } as any);
    prisma.match.findFirst.mockResolvedValue({
      ...baseMatch,
      status: MatchStatus.LIVE,
      liveAt: new Date('2026-03-18T10:00:00.000Z'),
      startedAt: new Date('2026-03-18T10:00:00.000Z'),
      controlState: { state: 'LIVE', metaJson: null },
    });
    (store.get as jest.Mock).mockResolvedValueOnce(
      buildInitializedLiveState(1),
    );

    try {
      await expect(service.detectMatchFinish('A')).resolves.toEqual({
        matchId: 'A',
      });
    } finally {
      dateNowSpy.mockRestore();
      lifecycleSpy.mockRestore();
    }

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('falls back to initialization after the max init timeout', async () => {
    const nowMs = Date.parse('2026-03-18T10:02:05.000Z');
    const dateNowSpy = jest.spyOn(Date, 'now').mockReturnValue(nowMs);
    const lifecycleSpy = jest
      .spyOn(service, 'getLifecycleState')
      .mockResolvedValue({ matchId: 'A' } as any);
    prisma.match.findFirst.mockResolvedValue({
      ...baseMatch,
      status: MatchStatus.LIVE,
      liveAt: new Date('2026-03-18T10:00:00.000Z'),
      startedAt: new Date('2026-03-18T10:00:00.000Z'),
      controlState: { state: 'LIVE', metaJson: null },
    });
    (store.get as jest.Mock).mockResolvedValueOnce(
      buildInitializedLiveState(1, {
        initialized: false,
        firstValidAt: null,
        lastAliveTeams: 2,
        lastAliveTeamsAt: Date.parse('2026-03-18T10:01:55.000Z'),
      }),
    );

    try {
      await expect(service.detectMatchFinish('A')).resolves.toEqual({
        matchId: 'A',
      });
    } finally {
      dateNowSpy.mockRestore();
      lifecycleSpy.mockRestore();
    }

    expect(store.save).toHaveBeenCalledWith(
      'A',
      expect.objectContaining({
        initialized: true,
        firstValidAt: nowMs,
      }),
      1,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('ignores finish detection when telemetry reports zero alive teams', async () => {
    const lifecycleSpy = jest
      .spyOn(service, 'getLifecycleState')
      .mockResolvedValue({ matchId: 'A' } as any);
    prisma.match.findFirst.mockResolvedValue({
      ...baseMatch,
      status: MatchStatus.LIVE,
      liveAt: new Date('2026-03-18T09:59:00.000Z'),
      startedAt: new Date('2026-03-18T09:59:00.000Z'),
      controlState: { state: 'LIVE', metaJson: null },
    });
    (store.get as jest.Mock).mockResolvedValueOnce(
      buildInitializedLiveState(0),
    );

    await expect(service.detectMatchFinish('A')).resolves.toEqual({
      matchId: 'A',
    });

    expect(prisma.$transaction).not.toHaveBeenCalled();
    lifecycleSpy.mockRestore();
  });

  it('ignores finish detection when single alive team is not yet stable', async () => {
    const nowMs = Date.parse('2026-03-18T10:00:02.000Z');
    const dateNowSpy = jest.spyOn(Date, 'now').mockReturnValue(nowMs);
    const lifecycleSpy = jest
      .spyOn(service, 'getLifecycleState')
      .mockResolvedValue({ matchId: 'A' } as any);
    prisma.match.findFirst.mockResolvedValue({
      ...baseMatch,
      status: MatchStatus.LIVE,
      liveAt: new Date('2026-03-18T09:59:00.000Z'),
      startedAt: new Date('2026-03-18T09:59:00.000Z'),
      controlState: { state: 'LIVE', metaJson: null },
    });
    (store.get as jest.Mock).mockResolvedValueOnce(
      buildInitializedLiveState(1, {
        lastAliveTeams: 1,
        lastAliveTeamsAt: Date.parse('2026-03-18T10:00:00.500Z'),
      }),
    );

    try {
      await expect(service.detectMatchFinish('A')).resolves.toEqual({
        matchId: 'A',
      });
    } finally {
      dateNowSpy.mockRestore();
      lifecycleSpy.mockRestore();
    }

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('seeds stability tracking when single alive team is first observed after a fluctuation', async () => {
    const nowMs = Date.parse('2026-03-18T10:00:05.000Z');
    const dateNowSpy = jest.spyOn(Date, 'now').mockReturnValue(nowMs);
    const lifecycleSpy = jest
      .spyOn(service, 'getLifecycleState')
      .mockResolvedValue({ matchId: 'A' } as any);
    prisma.match.findFirst.mockResolvedValue({
      ...baseMatch,
      status: MatchStatus.LIVE,
      liveAt: new Date('2026-03-18T09:59:00.000Z'),
      startedAt: new Date('2026-03-18T09:59:00.000Z'),
      controlState: { state: 'LIVE', metaJson: null },
    });
    (store.get as jest.Mock).mockResolvedValueOnce(
      buildInitializedLiveState(1, {
        firstValidAt: Date.parse('2026-03-18T09:50:00.000Z'),
        lastAliveTeams: 2,
        lastAliveTeamsAt: Date.parse('2026-03-18T10:00:04.000Z'),
      }),
    );

    try {
      await expect(service.detectMatchFinish('A')).resolves.toEqual({
        matchId: 'A',
      });
    } finally {
      dateNowSpy.mockRestore();
      lifecycleSpy.mockRestore();
    }

    expect(store.save).toHaveBeenCalledWith(
      'A',
      expect.objectContaining({
        lastAliveTeams: 1,
        lastAliveTeamsAt: nowMs,
      }),
      1,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('ignores finish detection while first valid telemetry is still new', async () => {
    const nowMs = Date.parse('2026-03-18T10:03:00.000Z');
    const dateNowSpy = jest.spyOn(Date, 'now').mockReturnValue(nowMs);
    const lifecycleSpy = jest
      .spyOn(service, 'getLifecycleState')
      .mockResolvedValue({ matchId: 'A' } as any);
    prisma.match.findFirst.mockResolvedValue({
      ...baseMatch,
      status: MatchStatus.LIVE,
      liveAt: new Date('2026-03-18T09:50:00.000Z'),
      startedAt: new Date('2026-03-18T09:50:00.000Z'),
      controlState: { state: 'LIVE', metaJson: null },
    });
    (store.get as jest.Mock).mockResolvedValueOnce(
      buildInitializedLiveState(1, {
        firstValidAt: Date.parse('2026-03-18T10:00:30.000Z'),
        lastAliveTeams: 1,
        lastAliveTeamsAt: Date.parse('2026-03-18T10:00:45.000Z'),
        circlePhase: 4,
      }),
    );

    try {
      await expect(service.detectMatchFinish('A')).resolves.toEqual({
        matchId: 'A',
      });
    } finally {
      dateNowSpy.mockRestore();
      lifecycleSpy.mockRestore();
    }

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('ignores finish detection during the first circle phase', async () => {
    const nowMs = Date.parse('2026-03-18T10:10:00.000Z');
    const dateNowSpy = jest.spyOn(Date, 'now').mockReturnValue(nowMs);
    const lifecycleSpy = jest
      .spyOn(service, 'getLifecycleState')
      .mockResolvedValue({ matchId: 'A' } as any);
    prisma.match.findFirst.mockResolvedValue({
      ...baseMatch,
      status: MatchStatus.LIVE,
      liveAt: new Date('2026-03-18T09:50:00.000Z'),
      startedAt: new Date('2026-03-18T09:50:00.000Z'),
      controlState: { state: 'LIVE', metaJson: null },
    });
    (store.get as jest.Mock).mockResolvedValueOnce(
      buildInitializedLiveState(1, {
        firstValidAt: Date.parse('2026-03-18T09:52:00.000Z'),
        lastAliveTeams: 1,
        lastAliveTeamsAt: Date.parse('2026-03-18T10:09:30.000Z'),
        circlePhase: 1,
      }),
    );

    try {
      await expect(service.detectMatchFinish('A')).resolves.toEqual({
        matchId: 'A',
      });
    } finally {
      dateNowSpy.mockRestore();
      lifecycleSpy.mockRestore();
    }

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('enters finalization only when validated telemetry has exactly one alive team', async () => {
    const lifecycleSpy = jest
      .spyOn(service, 'getLifecycleState')
      .mockResolvedValue({ matchId: 'A', status: 'ENDED' } as any);
    prisma.match.findFirst.mockResolvedValue({
      ...baseMatch,
      status: MatchStatus.LIVE,
      liveAt: new Date('2026-03-18T09:59:00.000Z'),
      startedAt: new Date('2026-03-18T09:59:00.000Z'),
      controlState: { state: 'LIVE', metaJson: null },
    });
    prisma.match.update.mockResolvedValue({});
    prisma.matchControlState.upsert.mockResolvedValue({});
    (store.get as jest.Mock).mockResolvedValueOnce(
      buildInitializedLiveState(1, {
        lastAliveTeams: 1,
        lastAliveTeamsAt: Date.parse('2026-03-18T09:59:55.000Z'),
      }),
    );
    jest
      .spyOn(service, 'confirmFinishedIfEligible')
      .mockResolvedValue({ matchId: 'A', status: 'ENDED' } as any);

    await expect(service.detectMatchFinish('A')).resolves.toEqual({
      matchId: 'A',
      status: 'ENDED',
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.match.update).toHaveBeenCalledWith({
      where: { id: 'A' },
      data: { status: MatchStatus.FINISH_PENDING },
    });
    expect(prisma.matchControlState.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          state: 'ENDED',
          reason: 'OBSERVER_FINISH_DETECTED',
        }),
      }),
    );
    lifecycleSpy.mockRestore();
  });

  it('treats external finish signals as eligibility checks instead of direct match ends', async () => {
    prisma.match.findFirst.mockResolvedValue({
      id: 'A',
      status: MatchStatus.LIVE,
      pcobSessionId: 'session-live',
    });
    const detectSpy = jest
      .spyOn(service, 'detectMatchFinish')
      .mockResolvedValue({ matchId: 'A', status: 'LIVE' } as any);
    const endSpy = jest
      .spyOn(service, 'endMatch')
      .mockResolvedValue({ matchId: 'A' } as any);

    await expect(
      service.applyAuthoritativeMatchEnd('A', {
        sessionId: 'session-live',
        source: 'CLIENT_IS_FINISHED',
      }),
    ).resolves.toEqual({
      matchId: 'A',
      status: 'LIVE',
    });

    expect(detectSpy).toHaveBeenCalledWith('A', 'session-live');
    expect(endSpy).not.toHaveBeenCalled();
  });

  it('auto-ends other live matches in scope when a match goes live', async () => {
    // target match
    prisma.match.findFirst.mockResolvedValueOnce(baseMatch);
    // other live matches in scope
    prisma.match.findMany.mockResolvedValueOnce([
      {
        id: 'B',
        groupId: 'G',
        tournamentId: 'T',
        status: MatchStatus.LIVE,
        startedAt: new Date(),
        endedAt: null,
        updatedAt: new Date(),
        tournament: { ownerUserId: 'user1', organizationId: 'org1' },
      },
    ]);
    prisma.match.updateMany.mockResolvedValueOnce({ count: 1 });
    prisma.match.update.mockResolvedValue({}); // target update
    // load B after update
    prisma.match.findFirst.mockResolvedValueOnce({
      id: 'B',
      groupId: 'G',
      tournamentId: 'T',
      status: MatchStatus.ENDED,
      startedAt: new Date(),
      endedAt: new Date(),
      updatedAt: new Date(),
      tournament: { ownerUserId: 'user1', organizationId: 'org1' },
    });
    // load A after update
    prisma.match.findFirst.mockResolvedValueOnce({
      ...baseMatch,
      status: MatchStatus.LIVE,
      startedAt: new Date(),
    });
    prisma.matchTeam.findMany.mockResolvedValue([]);
    prisma.matchSlot.findMany.mockResolvedValue([]);
    prisma.matchSlotResult.findMany.mockResolvedValue([]);

    await service.startMatch(actor, 'A');

    expect(prisma.match.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['B'] } },
      data: expect.objectContaining({ status: MatchStatus.ENDED }),
    });

    expect(gateway.emitMatchAutoEnd).toHaveBeenCalled();
    expect(gateway.emitMatchState).toHaveBeenCalledWith(
      'A',
      expect.objectContaining({ status: 'LIVE' }),
      expect.anything(),
    );
  });

  it('blocks auto-ending a live match that still has multiple alive teams', async () => {
    prisma.match.findFirst.mockResolvedValueOnce(baseMatch);
    prisma.match.findMany.mockResolvedValueOnce([
      {
        id: 'B',
        groupId: 'G',
        tournamentId: 'T',
        status: MatchStatus.LIVE,
        startedAt: new Date(),
        endedAt: null,
        updatedAt: new Date(),
        tournament: { ownerUserId: 'user1', organizationId: 'org1' },
      },
    ]);
    prisma.match.findMany.mockResolvedValueOnce([]);
    prisma.matchSlotResult.findMany.mockResolvedValueOnce([
      {
        teamId: 'team-1',
        wasPresentInMatch: true,
        players: [{ isAlive: true }],
      },
      {
        teamId: 'team-2',
        wasPresentInMatch: true,
        players: [{ isAlive: true }],
      },
      {
        teamId: 'team-3',
        wasPresentInMatch: true,
        players: [{ isAlive: true }],
      },
    ]);

    await expect(service.startMatch(actor, 'A')).rejects.toThrow(
      new ConflictException(
        'Cannot start match A while match B still has 3 teams alive. Resume or finish the existing match first.',
      ),
    );

    expect(prisma.match.updateMany).not.toHaveBeenCalled();
    expect(prisma.match.update).not.toHaveBeenCalled();
    expect(gateway.emitMatchAutoEnd).not.toHaveBeenCalled();
  });

  it('does not auto-assign missing slots on LIVE start', async () => {
    prisma.match.findFirst.mockResolvedValueOnce(baseMatch);
    prisma.match.findMany.mockResolvedValueOnce([]);
    prisma.match.updateMany.mockResolvedValueOnce({ count: 0 });
    prisma.match.update.mockResolvedValue({});
    prisma.match.findFirst.mockResolvedValueOnce({
      ...baseMatch,
      status: MatchStatus.LIVE,
      startedAt: new Date(),
    });
    prisma.matchTeam.findMany.mockResolvedValue([]);
    prisma.matchSlot.findMany.mockResolvedValue([]);
    prisma.matchSlotResult.findMany.mockResolvedValue([]);

    await service.startMatch(actor, 'A');

    expect(matchesService.assignSlotsIfMissing).not.toHaveBeenCalled();
    expect(gateway.emitSlotsAssigned).not.toHaveBeenCalled();
    expect(resultsService.resetLiveProjection).toHaveBeenCalledWith('A', {
      tx: expect.anything(),
    });
  });

  it('clears persisted telemetry state when a match starts', async () => {
    prisma.match.findFirst.mockResolvedValueOnce(baseMatch);
    prisma.match.findMany.mockResolvedValueOnce([]);
    prisma.match.updateMany.mockResolvedValueOnce({ count: 0 });
    prisma.match.update.mockResolvedValue({});
    prisma.match.findFirst.mockResolvedValueOnce({
      ...baseMatch,
      status: MatchStatus.LIVE,
      liveState: LiveState.LIVE,
      startedAt: new Date(),
      endedAt: null,
      endedReason: null,
    });
    prisma.matchTeam.findMany.mockResolvedValue([]);
    prisma.matchSlot.findMany.mockResolvedValue([]);
    prisma.matchSlotResult.findMany.mockResolvedValue([]);

    await service.startMatch(actor, 'A');

    expect(prisma.match.update).toHaveBeenCalledWith({
      where: { id: 'A' },
      data: expect.objectContaining({
        status: MatchStatus.LIVE,
        liveState: LiveState.LIVE,
        endedAt: null,
        endedReason: null,
        pcobLastSeenAt: null,
      }),
    });
    expect(prisma.matchStateSnapshot.deleteMany).toHaveBeenCalledWith({
      where: { matchId: 'A' },
    });
    expect(prisma.matchTelemetry.deleteMany).toHaveBeenCalledWith({
      where: { matchId: 'A' },
    });
    expect(prisma.telemetryEventLog.deleteMany).toHaveBeenCalledWith({
      where: { matchId: 'A' },
    });
    expect(store.evictMatches).toHaveBeenCalledWith(['A']);
    expect(
      (store.evictMatches as jest.Mock).mock.invocationCallOrder[0],
    ).toBeLessThan(liveStateMirror.publish.mock.invocationCallOrder[0]);
  });

  it('rotates the PCOB session and start timestamps when restarting a prior run', async () => {
    const priorRunMatch = {
      ...baseMatch,
      status: MatchStatus.ENDED,
      liveState: LiveState.ENDED,
      startedAt: new Date('2026-03-18T10:00:00.000Z'),
      endedAt: new Date('2026-03-18T10:20:00.000Z'),
      endedReason: 'AUTO_ENDED_BY_NEW_LIVE_MATCH',
      pcobSessionId: 'session-old',
      pcobMode: true,
      pcobBoundAt: new Date('2026-03-18T09:55:00.000Z'),
      pcobLastSeenAt: new Date('2026-03-18T10:19:30.000Z'),
      adapterKey: 'pubgm-pcob',
      dataSource: 'PCOB',
      dataMode: 'PCOB',
      controlState: {
        state: 'ENDED',
        metaJson: {
          liveSync: {
            version: 2,
            updatedAt: 200,
            overrides: { players: {}, teams: {} },
            auditTrail: [],
          },
        },
      },
    };

    prisma.match.findFirst.mockResolvedValueOnce(priorRunMatch);
    prisma.match.findMany.mockResolvedValueOnce([]);
    prisma.match.findMany.mockResolvedValueOnce([]);
    prisma.match.findMany.mockResolvedValueOnce([]);
    prisma.match.update.mockResolvedValue({});
    prisma.match.findFirst.mockResolvedValueOnce({
      ...priorRunMatch,
      status: MatchStatus.LIVE,
      liveState: LiveState.LIVE,
      startedAt: new Date('2026-03-18T10:30:00.000Z'),
      endedAt: null,
      endedReason: null,
      pcobSessionId: 'session-rotated',
      pcobLastSeenAt: null,
      controlState: {
        state: 'LIVE',
        metaJson: null,
      },
    });
    prisma.matchTeam.findMany.mockResolvedValue([]);
    prisma.matchSlot.findMany.mockResolvedValue([]);
    prisma.matchSlotResult.findMany.mockResolvedValue([]);

    await service.startMatch(actor, 'A');

    const updateArg = prisma.match.update.mock.calls[0][0] as any;
    expect(updateArg.where).toEqual({ id: 'A' });
    expect(updateArg.data).toEqual(
      expect.objectContaining({
        status: MatchStatus.LIVE,
        liveState: LiveState.LIVE,
        startedAt: expect.any(Date),
        liveAt: expect.any(Date),
        endedAt: null,
        endedReason: null,
        pcobSessionId: expect.stringMatching(/^sess_/),
        pcobBoundAt: expect.any(Date),
      }),
    );
    expect(updateArg.data.pcobSessionId).not.toBe('session-old');
  });

  it('clears liveSync and invalidates the bound session when resetting to READY', async () => {
    prisma.match.findFirst.mockResolvedValueOnce({
      ...baseMatch,
      status: MatchStatus.LIVE,
      liveState: LiveState.LIVE,
      startedAt: new Date('2026-03-18T10:00:00.000Z'),
      pcobSessionId: 'session-old',
      pcobMode: true,
      pcobBoundAt: new Date('2026-03-18T09:55:00.000Z'),
      pcobLastSeenAt: new Date('2026-03-18T10:05:00.000Z'),
      adapterKey: 'pubgm-pcob',
      dataSource: 'PCOB',
      dataMode: 'PCOB',
      controlState: {
        state: 'LIVE',
        metaJson: {
          telemetryRuntime: {
            lastAcceptedAt: '2026-03-18T10:04:59.000Z',
          },
          telemetryIngress: {
            sessionId: 'session-old',
            lastAdapterSequence: 12,
          },
          liveSync: {
            version: 4,
            updatedAt: 400,
            overrides: { players: {}, teams: {} },
            auditTrail: [],
          },
        },
      },
    });
    prisma.match.update.mockResolvedValue({});
    prisma.matchTeam.findMany.mockResolvedValue([]);
    prisma.matchSlot.findMany.mockResolvedValue([]);
    prisma.matchSlotResult.findMany.mockResolvedValue([]);

    await service.setStatus(actor, 'A', { status: 'READY' });

    expect(prisma.match.update).toHaveBeenCalledWith({
      where: { id: 'A' },
      data: expect.objectContaining({
        status: MatchStatus.DRAFT,
        liveState: LiveState.UPCOMING,
        liveAt: null,
        startedAt: null,
        endedAt: null,
        endedReason: null,
        pcobSessionId: null,
        pcobBoundAt: null,
        pcobLastSeenAt: null,
      }),
    });
    const upsertArg = prisma.matchControlState.upsert.mock.calls[0][0] as any;
    expect(JSON.stringify(upsertArg.update.metaJson)).not.toContain('liveSync');
    expect(JSON.stringify(upsertArg.update.metaJson)).not.toContain(
      'telemetryIngress',
    );
    expect(store.evictMatches).toHaveBeenCalledWith(['A']);
    expect(
      (store.evictMatches as jest.Mock).mock.invocationCallOrder[0],
    ).toBeLessThan(liveStateMirror.publish.mock.invocationCallOrder[0]);
  });

  it('skips mirror hydration for roster-only snapshots without current telemetry freshness proof', async () => {
    liveStateMirror.publish.mockClear();
    prisma.match.findFirst.mockResolvedValueOnce({
      status: MatchStatus.LIVE,
      controlState: {
        state: 'LIVE',
        metaJson: null,
      },
      stateSnapshot: {
        stateJson: {
          matchId: 'A',
          status: 'LIVE',
          mode: 'AUTO',
          version: 3,
          sequence: 0,
          updatedAt: 200,
          telemetryAcceptedAt: null,
          telemetryAcceptedSource: null,
          startedAt: 100,
          endedAt: null,
          teamsAlive: 0,
          teams: {
            'team-1': {
              teamId: 'team-1',
              alivePlayers: 4,
              eliminated: false,
              placement: null,
              totalKills: 0,
              totalPlayers: 4,
              eliminatedAt: null,
              metadata: { slot: 1 },
            },
          },
          players: {
            'player-1': {
              playerId: 'player-1',
              teamId: 'team-1',
              alive: true,
              knocked: false,
              kills: 0,
            },
          },
          killFeed: [],
          events: [],
          circle: null,
        },
      },
    } as any);

    await expect(
      (service as any).hydrateMirrorFromPersistedTelemetry('A'),
    ).resolves.toBeNull();
    expect(liveStateMirror.publish).not.toHaveBeenCalled();
  });

  it('rehydrates the live mirror when the persisted telemetry snapshot has current freshness proof', async () => {
    liveStateMirror.publish.mockClear();
    prisma.match.findFirst.mockResolvedValueOnce({
      status: MatchStatus.LIVE,
      controlState: {
        state: 'LIVE',
        metaJson: {
          telemetryUpdatedAt: 200,
        },
      },
      stateSnapshot: {
        stateJson: {
          matchId: 'A',
          status: 'LIVE',
          mode: 'AUTO',
          version: 4,
          sequence: 7,
          updatedAt: 200,
          telemetryAcceptedAt: 200,
          telemetryAcceptedSource: 'PCOB_PUSH',
          startedAt: 100,
          endedAt: null,
          teamsAlive: 1,
          teams: {
            'team-1': {
              teamId: 'team-1',
              alivePlayers: 1,
              eliminated: false,
              placement: 1,
              totalKills: 6,
              totalPlayers: 4,
              eliminatedAt: null,
              metadata: { slot: 1, teamName: 'Team One' },
            },
          },
          players: {},
          killFeed: [],
          events: [],
          circle: null,
        },
      },
    } as any);

    await expect(
      (service as any).hydrateMirrorFromPersistedTelemetry('A'),
    ).resolves.toMatchObject({
      status: 'LIVE',
      summary: expect.objectContaining({
        aliveTeams: 1,
      }),
    });
    expect(liveStateMirror.publish).toHaveBeenCalled();
  });

  it('preserves empty slots and unassigned teams when a match starts', async () => {
    prisma.match.findFirst.mockResolvedValueOnce(baseMatch);
    prisma.match.findMany.mockResolvedValueOnce([]);
    prisma.match.updateMany.mockResolvedValueOnce({ count: 0 });
    prisma.match.update.mockResolvedValue({});
    prisma.match.findFirst.mockResolvedValueOnce({
      ...baseMatch,
      status: MatchStatus.LIVE,
      startedAt: new Date(),
    });
    prisma.matchTeam.findMany.mockResolvedValue([
      { teamId: 'team-a', team: { name: 'Assigned', tag: 'A', logoUrl: null } },
      {
        teamId: 'team-x',
        team: { name: 'Unassigned', tag: 'X', logoUrl: null },
      },
    ]);
    prisma.matchSlot.findMany.mockResolvedValue([
      { teamId: 'team-a', slotNumber: 1 },
      { teamId: null, slotNumber: 5 },
    ]);
    prisma.matchSlotResult.findMany.mockResolvedValue([
      {
        teamId: 'team-a',
        totalKills: 0,
        placement: null,
        totalPoints: 0,
        slotNumber: 1,
      },
    ]);

    await service.startMatch(actor, 'A');

    expect(matchesService.assignSlotsIfMissing).not.toHaveBeenCalled();
    expect(gateway.emitSlotsAssigned).not.toHaveBeenCalled();
    expect(gateway.emitMatchState).toHaveBeenCalledWith(
      'A',
      expect.objectContaining({
        status: 'LIVE',
        summary: expect.objectContaining({
          totalTeams: 1,
          aliveTeams: 1,
        }),
        teams: expect.arrayContaining([
          expect.objectContaining({
            teamId: 'team-a',
            slot: 1,
          }),
          expect.objectContaining({
            teamId: 'team-x',
            slot: null,
          }),
        ]),
      }),
      expect.anything(),
    );
  });

  it('keeps seeded player rows in the live mirror when a match starts', async () => {
    prisma.match.findFirst.mockResolvedValueOnce(baseMatch);
    prisma.match.findMany.mockResolvedValueOnce([]);
    prisma.match.updateMany.mockResolvedValueOnce({ count: 0 });
    prisma.match.update.mockResolvedValue({});
    prisma.match.findFirst.mockResolvedValueOnce({
      ...baseMatch,
      status: MatchStatus.LIVE,
      startedAt: new Date(),
    });
    prisma.matchTeam.findMany.mockResolvedValue([
      { teamId: 'team-a', team: { name: 'Assigned', tag: 'A', logoUrl: null } },
    ]);
    prisma.matchSlot.findMany.mockResolvedValue([
      {
        teamId: 'team-a',
        slotNumber: 1,
        team: {
          players: [],
        },
      },
    ] as any);
    prisma.matchSlotResult.findMany.mockResolvedValue([
      {
        teamId: 'team-a',
        totalKills: 0,
        placement: null,
        totalPoints: 0,
        slotNumber: 1,
        players: [
          {
            id: 'slot-player-1',
            playerId: 'player-1',
            playerName: 'Alpha 1',
            kills: 0,
            isAlive: true,
            isKnocked: false,
            player: {
              ign: 'Alpha 1',
              photoUrl: null,
              externalPlayerId: 'ext-1',
              inGameId: 'pubg-1',
              pubgPlayerId: 'pubg-1',
            },
          },
        ],
      },
    ] as any);

    await service.startMatch(actor, 'A');

    expect(gateway.emitMatchState).toHaveBeenCalledWith(
      'A',
      expect.objectContaining({
        status: 'LIVE',
        summary: expect.objectContaining({
          totalPlayers: 1,
          alivePlayers: 1,
        }),
        teams: expect.arrayContaining([
          expect.objectContaining({
            teamId: 'team-a',
            totalPlayers: 1,
            alivePlayers: 1,
            players: [
              expect.objectContaining({
                playerId: 'player-1',
                alive: true,
              }),
            ],
          }),
        ]),
      }),
      expect.anything(),
    );
  });

  it('recomputes the live summary when a new team is assigned after match start', async () => {
    prisma.match.findFirst.mockResolvedValueOnce({
      ...baseMatch,
      status: MatchStatus.LIVE,
      liveState: LiveState.LIVE,
      startedAt: new Date(),
      controlState: {
        state: 'LIVE',
        metaJson: null,
      },
    });
    (store.get as jest.Mock).mockResolvedValueOnce({
      matchId: 'A',
      status: 'LIVE',
      startedAt: new Date('2026-03-18T09:59:00.000Z').toISOString(),
      endedAt: null,
      version: 4,
      updatedAt: new Date('2026-03-18T10:00:00.000Z').toISOString(),
      summary: {
        totalTeams: 1,
        aliveTeams: 1,
        totalPlayers: 4,
        alivePlayers: 4,
        winnerTeamId: null,
        winnerSlot: null,
      },
      teams: [
        {
          teamId: 'team-a',
          name: 'Assigned',
          tag: 'A',
          slot: 1,
          kills: 0,
          placement: null,
          points: null,
          logoUrl: null,
          alivePlayers: 4,
          totalPlayers: 4,
          alive: true,
          eliminated: false,
          players: [],
        },
        {
          teamId: 'team-b',
          name: 'Late Join',
          tag: 'B',
          slot: null,
          kills: 0,
          placement: null,
          points: null,
          logoUrl: null,
          alivePlayers: null,
          totalPlayers: null,
          alive: undefined,
          eliminated: undefined,
          players: [],
        },
      ],
    } satisfies LiveMatchState);
    prisma.matchTeam.findMany.mockResolvedValue([
      { teamId: 'team-a', team: { name: 'Assigned', tag: 'A', logoUrl: null } },
      {
        teamId: 'team-b',
        team: { name: 'Late Join', tag: 'B', logoUrl: null },
      },
    ]);
    prisma.matchSlot.findMany.mockResolvedValue([
      { teamId: 'team-a', slotNumber: 1 },
      { teamId: 'team-b', slotNumber: 2 },
    ]);
    prisma.matchSlotResult.findMany.mockResolvedValue([
      {
        teamId: 'team-a',
        totalKills: 0,
        placement: null,
        totalPoints: 0,
        slotNumber: 1,
      },
    ]);

    const state = await service.getState(actor, 'A');

    expect(state.summary).toMatchObject({
      totalTeams: 2,
      aliveTeams: 1,
    });
    expect(state.teams).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          teamId: 'team-a',
          slot: 1,
        }),
        expect.objectContaining({
          teamId: 'team-b',
          slot: 2,
        }),
      ]),
    );
    expect(gateway.emitMatchState).toHaveBeenCalledWith(
      'A',
      expect.objectContaining({
        summary: expect.objectContaining({
          totalTeams: 2,
        }),
      }),
      null,
    );
  });

  it('falls back to tournament scope when no group matches', async () => {
    const matchNoGroup = { ...baseMatch, groupId: null };
    prisma.match.findFirst.mockResolvedValueOnce(matchNoGroup);
    // no group matches, so look at tournament
    prisma.match.findMany.mockResolvedValueOnce([
      {
        id: 'C',
        groupId: null,
        tournamentId: 'T',
        status: MatchStatus.LIVE,
        startedAt: new Date(),
        endedAt: null,
        updatedAt: new Date(),
        tournament: { ownerUserId: 'user1', organizationId: 'org1' },
      },
    ]);
    prisma.match.updateMany.mockResolvedValueOnce({ count: 1 });
    prisma.match.update.mockResolvedValue({});
    prisma.match.findFirst.mockResolvedValueOnce({
      id: 'C',
      groupId: null,
      tournamentId: 'T',
      status: MatchStatus.ENDED,
      startedAt: new Date(),
      endedAt: new Date(),
      updatedAt: new Date(),
      tournament: { ownerUserId: 'user1', organizationId: 'org1' },
    });
    prisma.match.findFirst.mockResolvedValueOnce({
      ...matchNoGroup,
      status: MatchStatus.LIVE,
      startedAt: new Date(),
    });
    prisma.matchTeam.findMany.mockResolvedValue([]);
    prisma.matchSlot.findMany.mockResolvedValue([]);
    prisma.matchSlotResult.findMany.mockResolvedValue([]);

    await service.startMatch(actor, 'A');
  });

  it('allows restarting a match auto-ended by a newer live match', async () => {
    const autoEndedMatch = {
      ...baseMatch,
      status: MatchStatus.ENDED,
      liveState: LiveState.ENDED,
      endedAt: new Date(),
      endedReason: 'AUTO_ENDED_BY_NEW_LIVE_MATCH',
    };

    prisma.match.findFirst.mockResolvedValueOnce(autoEndedMatch);
    prisma.match.findMany.mockResolvedValueOnce([]);
    prisma.match.findMany.mockResolvedValueOnce([]);
    prisma.match.update.mockResolvedValue({});
    prisma.match.findFirst.mockResolvedValueOnce({
      ...autoEndedMatch,
      status: MatchStatus.LIVE,
      liveState: LiveState.LIVE,
      startedAt: new Date(),
      endedAt: null,
      endedReason: null,
    });
    prisma.matchTeam.findMany.mockResolvedValue([]);
    prisma.matchSlot.findMany.mockResolvedValue([]);
    prisma.matchSlotResult.findMany.mockResolvedValue([]);

    await service.startMatch(actor, 'A');

    expect(prisma.match.update).toHaveBeenCalledWith({
      where: { id: 'A' },
      data: expect.objectContaining({
        status: MatchStatus.LIVE,
        liveState: LiveState.LIVE,
        endedAt: null,
        endedReason: null,
      }),
    });
    expect(gateway.emitMatchState).toHaveBeenCalledWith(
      'A',
      expect.objectContaining({ status: 'LIVE' }),
      expect.anything(),
    );
  });

  it('allows an organizer in the same organization to start the match', async () => {
    const organizerActor: Actor = {
      id: 'organizer-user',
      actorId: 'organizer-user',
      role: 'ORGANIZER',
      actorRole: 'ORGANIZER',
      organizationId: 'org1',
      actingOrgId: 'org1',
    };

    prisma.match.findFirst.mockResolvedValueOnce(baseMatch);
    prisma.match.findMany.mockResolvedValueOnce([]);
    prisma.match.findMany.mockResolvedValueOnce([]);
    prisma.match.findMany.mockResolvedValueOnce([]);
    prisma.match.update.mockResolvedValue({});
    prisma.match.findFirst.mockResolvedValueOnce({
      ...baseMatch,
      status: MatchStatus.LIVE,
      liveState: LiveState.LIVE,
      startedAt: new Date(),
      endedAt: null,
      endedReason: null,
    });
    prisma.matchTeam.findMany.mockResolvedValue([]);
    prisma.matchSlot.findMany.mockResolvedValue([]);
    prisma.matchSlotResult.findMany.mockResolvedValue([]);

    await service.startMatch(organizerActor, 'A');

    expect(prisma.match.update).toHaveBeenCalledWith({
      where: { id: 'A' },
      data: expect.objectContaining({
        status: MatchStatus.LIVE,
        liveState: LiveState.LIVE,
      }),
    });
  });

  it('exposes finalization timing while a match is pending finalization', async () => {
    const startedAt = '2026-03-18T10:00:00.000Z';
    const nowMs = Date.parse('2026-03-18T10:01:05.000Z');
    const dateNowSpy = jest.spyOn(Date, 'now').mockReturnValue(nowMs);
    prisma.match.findFirst.mockResolvedValue({
      ...baseMatch,
      status: MatchStatus.FINISH_PENDING,
      liveState: LiveState.LIVE,
      pcobSessionId: 'session-1',
      pcobMode: true,
      pcobBoundAt: new Date('2026-03-18T09:59:00.000Z'),
      pcobLastSeenAt: new Date('2026-03-18T10:01:03.000Z'),
      adapterKey: 'pubgm-pcob',
      dataSource: 'PCOB',
      dataMode: 'PCOB',
      controlState: {
        state: 'LIVE',
        metaJson: {
          finalizationStartedAt: startedAt,
          telemetryRuntime: {
            lastTransportAt: '2026-03-18T10:01:02.000Z',
            lastPacketAt: '2026-03-18T10:01:03.000Z',
            lastAcceptedAt: '2026-03-18T10:01:04.000Z',
            lastAcceptedSource: 'PCOB',
            lastAcceptedSequence: 27,
          },
        },
      },
    });

    try {
      await expect(service.getLifecycleState('A')).resolves.toMatchObject({
        matchId: 'A',
        status: 'ENDED',
        lifecycleStatus: 'ENDED',
        controlStatus: 'ENDED',
        isFinalizing: true,
        isLocked: true,
        resultFinalized: false,
        locks: expect.objectContaining({
          resultsLocked: true,
          slotLocked: true,
        }),
        finalizationStartedAt: startedAt,
        finalizationDurationMs: 65_000,
        telemetry: expect.objectContaining({
          transportConnected: true,
          packetsReceiving: true,
          telemetryAccepted: true,
          telemetryActive: false,
          lastAcceptedSource: 'PCOB',
          lastAcceptedSequence: 27,
        }),
        binding: expect.objectContaining({
          sessionId: 'session-1',
          adapterKey: 'pubgm-pcob',
          isConfigured: true,
          isBound: true,
          isReady: false,
        }),
      });
    } finally {
      dateNowSpy.mockRestore();
    }
  });

  it('resolves the next startable match from the closest context', async () => {
    prisma.match.findFirst.mockResolvedValue({
      ...baseMatch,
      status: MatchStatus.FINISHED,
      matchNumber: 2,
      scheduledAt: new Date('2026-03-18T10:00:00.000Z'),
    });
    prisma.match.findMany.mockResolvedValue([
      {
        ...baseMatch,
        id: 'C',
        name: 'Match 4',
        status: MatchStatus.FINISH_PENDING,
        matchNumber: 4,
        scheduledAt: new Date('2026-03-18T12:00:00.000Z'),
        createdAt: new Date('2026-03-18T09:00:00.000Z'),
        matchSlots: [{ id: 'slot-c' }],
      },
      {
        ...baseMatch,
        id: 'B',
        name: 'Match 3',
        matchNumber: 3,
        scheduledAt: new Date('2026-03-18T11:00:00.000Z'),
        createdAt: new Date('2026-03-18T08:00:00.000Z'),
        matchSlots: [{ id: 'slot-b' }],
      },
      {
        ...baseMatch,
        id: 'D',
        stageId: 'S-2',
        groupId: 'G-2',
        name: 'Match 5',
        status: MatchStatus.FINISHED,
        matchNumber: 5,
        scheduledAt: new Date('2026-03-18T10:30:00.000Z'),
        createdAt: new Date('2026-03-18T07:00:00.000Z'),
        matchSlots: [{ id: 'slot-d' }],
      },
    ]);

    await expect(service.resolveNextEligibleMatch('A')).resolves.toEqual({
      currentMatchId: 'A',
      currentStatus: 'FINISHED',
      currentIsFinished: true,
      isAfterFinished: true,
      nextMatch: {
        id: 'B',
        name: 'Match 3',
        matchNumber: 3,
        status: 'READY',
        tournamentId: 'T',
        stageId: 'S',
        groupId: 'G',
      },
    });
  });

  it('marks next-match lookup as pre-finish when the current match is not finished', async () => {
    prisma.match.findFirst.mockResolvedValue({
      ...baseMatch,
      status: MatchStatus.LIVE,
      matchNumber: 2,
      scheduledAt: new Date('2026-03-18T10:00:00.000Z'),
    });
    prisma.match.findMany.mockResolvedValue([
      {
        ...baseMatch,
        id: 'B',
        name: 'Match 3',
        matchNumber: 3,
        scheduledAt: new Date('2026-03-18T11:00:00.000Z'),
        createdAt: new Date('2026-03-18T08:00:00.000Z'),
        matchSlots: [{ id: 'slot-b' }],
      },
    ]);

    await expect(service.resolveNextEligibleMatch('A')).resolves.toMatchObject({
      currentMatchId: 'A',
      currentStatus: 'LIVE',
      currentIsFinished: false,
      isAfterFinished: false,
      nextMatch: expect.objectContaining({
        id: 'B',
        status: 'READY',
      }),
    });
  });

  it('does not suggest a next match that has no assigned team slots', async () => {
    prisma.match.findFirst.mockResolvedValue({
      ...baseMatch,
      status: MatchStatus.FINISHED,
      matchNumber: 2,
      scheduledAt: new Date('2026-03-18T10:00:00.000Z'),
    });
    prisma.match.findMany.mockResolvedValue([
      {
        ...baseMatch,
        id: 'B',
        name: 'Match 3',
        matchNumber: 3,
        scheduledAt: new Date('2026-03-18T11:00:00.000Z'),
        createdAt: new Date('2026-03-18T08:00:00.000Z'),
        matchSlots: [],
      },
      {
        ...baseMatch,
        id: 'C',
        name: 'Match 4',
        matchNumber: 4,
        scheduledAt: new Date('2026-03-18T12:00:00.000Z'),
        createdAt: new Date('2026-03-18T09:00:00.000Z'),
        matchSlots: [{ id: 'slot-c' }],
      },
    ]);

    await expect(service.resolveNextEligibleMatch('A')).resolves.toMatchObject({
      nextMatch: expect.objectContaining({
        id: 'C',
        status: 'READY',
      }),
    });
  });

  it('rehydrates live control state from persisted telemetry when the mirror cache is empty', async () => {
    const persistedTelemetry = {
      matchId: 'A',
      status: 'LIVE',
      mode: 'AUTO',
      version: 7,
      sequence: 9,
      updatedAt: Date.parse('2026-04-01T00:20:00.000Z'),
      telemetryAcceptedAt: Date.parse('2026-04-01T00:20:00.000Z'),
      startedAt: Date.parse('2026-04-01T00:10:00.000Z'),
      endedAt: null,
      teamsAlive: 1,
      players: {
        'player-1': {
          playerId: 'player-1',
          teamId: 'team-a',
          alive: true,
          knocked: false,
          kills: 2,
          metadata: { playerName: 'Alpha 1' },
        },
      },
      teams: {
        'team-a': {
          teamId: 'team-a',
          alivePlayers: 1,
          eliminated: false,
          placement: 1,
          totalKills: 2,
          totalPlayers: 1,
          eliminatedAt: null,
          metadata: { teamName: 'Alpha', teamTag: 'A', slot: 1 },
        },
      },
      circle: { phase: 3 },
      killFeed: [],
      events: [],
    } as any;

    prisma.match.findFirst
      .mockResolvedValueOnce({
        ...baseMatch,
        status: MatchStatus.LIVE,
        controlState: {
          state: 'LIVE',
          metaJson: { telemetryUpdatedAt: persistedTelemetry.updatedAt },
        },
      })
      .mockResolvedValueOnce({
        status: MatchStatus.LIVE,
        controlState: {
          state: 'LIVE',
          metaJson: { telemetryUpdatedAt: persistedTelemetry.updatedAt },
        },
        stateSnapshot: {
          stateJson: persistedTelemetry,
        },
      } as any);
    prisma.matchTeam.findMany.mockResolvedValue([
      { teamId: 'team-a', team: { name: 'Alpha', tag: 'A', logoUrl: null } },
    ]);
    prisma.matchSlot.findMany.mockResolvedValue([
      { teamId: 'team-a', slotNumber: 1 },
    ]);
    prisma.matchSlotResult.findMany.mockResolvedValue([
      {
        teamId: 'team-a',
        totalKills: 0,
        placement: null,
        totalPoints: 0,
        slotNumber: 1,
      },
    ]);

    await expect(service.getState(actor, 'A')).resolves.toMatchObject({
      matchId: 'A',
      status: 'LIVE',
      summary: {
        aliveTeams: 1,
        totalTeams: 1,
        alivePlayers: 1,
        totalPlayers: 1,
      },
      teams: [
        expect.objectContaining({
          teamId: 'team-a',
          alivePlayers: 1,
          totalPlayers: 1,
          players: [
            expect.objectContaining({
              playerId: 'player-1',
              alive: true,
            }),
          ],
        }),
      ],
      circle: expect.objectContaining({ phase: 3 }),
    });
    expect(liveStateMirror.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        matchId: 'A',
        summary: expect.objectContaining({
          aliveTeams: 1,
          totalPlayers: 1,
        }),
      }),
    );
  });

  it('repairs a cached zeroed live control state from persisted telemetry', async () => {
    (store.get as jest.Mock).mockResolvedValueOnce({
      matchId: 'A',
      status: 'LIVE',
      startedAt: '2026-04-01T00:10:00.000Z',
      endedAt: null,
      version: 1,
      updatedAt: '2026-04-01T00:11:00.000Z',
      teams: [
        {
          teamId: 'team-a',
          name: 'Alpha',
          tag: 'A',
          slot: 1,
          kills: 0,
          placement: null,
          points: null,
          logoUrl: null,
          alivePlayers: null,
          totalPlayers: null,
          players: [],
        },
      ],
    } satisfies LiveMatchState);

    prisma.match.findFirst
      .mockResolvedValueOnce({
        ...baseMatch,
        status: MatchStatus.LIVE,
        controlState: {
          state: 'LIVE',
          metaJson: {
            telemetryUpdatedAt: Date.parse('2026-04-01T00:21:00.000Z'),
          },
        },
      })
      .mockResolvedValueOnce({
        status: MatchStatus.LIVE,
        controlState: {
          state: 'LIVE',
          metaJson: {
            telemetryUpdatedAt: Date.parse('2026-04-01T00:21:00.000Z'),
          },
        },
        stateSnapshot: {
          stateJson: {
            matchId: 'A',
            status: 'LIVE',
            mode: 'AUTO',
            version: 8,
            sequence: 12,
            updatedAt: Date.parse('2026-04-01T00:21:00.000Z'),
            telemetryAcceptedAt: Date.parse('2026-04-01T00:21:00.000Z'),
            startedAt: Date.parse('2026-04-01T00:10:00.000Z'),
            endedAt: null,
            teamsAlive: 1,
            players: {
              'player-1': {
                playerId: 'player-1',
                teamId: 'team-a',
                alive: true,
                knocked: false,
                kills: 3,
                metadata: { playerName: 'Alpha 1' },
              },
            },
            teams: {
              'team-a': {
                teamId: 'team-a',
                alivePlayers: 1,
                eliminated: false,
                placement: 1,
                totalKills: 3,
                totalPlayers: 1,
                eliminatedAt: null,
                metadata: { teamName: 'Alpha', teamTag: 'A', slot: 1 },
              },
            },
            circle: null,
            killFeed: [],
            events: [],
          },
        },
      } as any);
    prisma.matchTeam.findMany.mockResolvedValue([
      { teamId: 'team-a', team: { name: 'Alpha', tag: 'A', logoUrl: null } },
    ]);
    prisma.matchSlot.findMany.mockResolvedValue([
      { teamId: 'team-a', slotNumber: 1 },
    ]);
    prisma.matchSlotResult.findMany.mockResolvedValue([
      {
        teamId: 'team-a',
        totalKills: 0,
        placement: null,
        totalPoints: 0,
        slotNumber: 1,
      },
    ]);

    await expect(service.getState(actor, 'A')).resolves.toMatchObject({
      summary: {
        aliveTeams: 1,
        totalPlayers: 1,
      },
      teams: [
        expect.objectContaining({
          teamId: 'team-a',
          alivePlayers: 1,
          totalPlayers: 1,
        }),
      ],
    });
    expect(liveStateMirror.publish).toHaveBeenCalledTimes(1);
  });
});
