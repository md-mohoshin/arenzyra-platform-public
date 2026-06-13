import { MatchControlService } from './match-control.service';
import { MatchDataSource, MatchStatus, LiveState } from '@prisma/client';
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
import type { MatchStateBroadcaster } from '../../realtime/match-state-broadcaster.service';

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
    telemetrySource?: string | null;
    telemetrySourceLockedAt?: Date | null;
    updatedAt: Date;
    createdAt?: Date;
    scheduledAt?: Date | null;
    matchNumber?: number | null;
    tournament: { ownerUserId: string; organizationId: string };
    organization?: { slug: string | null } | null;
    liveState?: LiveState;
    liveAt?: Date | null;
    controlState?: {
      state: string;
      version?: number;
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
      findUnique: jest.Mock<Promise<unknown>, [unknown?]>;
      create: jest.Mock<Promise<unknown>, [unknown?]>;
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
        Promise<
          Array<{
            teamId: string | null;
            slotNumber: number;
            team?: {
              name?: string | null;
              tag?: string | null;
              logoUrl?: string | null;
              players?: Array<{
                id: string;
                ign?: string | null;
                photoUrl?: string | null;
                externalPlayerId?: string | null;
                playerOpenId?: string | null;
                inGameId?: string | null;
                pubgPlayerId?: string | null;
              }>;
            } | null;
          }>
        >,
        [unknown?]
      >;
    };
    matchSlotResult: {
      findFirst: jest.Mock<Promise<unknown>, [unknown?]>;
      findMany: jest.Mock<
        Promise<
          Array<{
            teamId: string;
            wasPresentInMatch?: boolean | null;
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
      upsert: jest.Mock<Promise<unknown>, [unknown?]>;
      deleteMany: jest.Mock<Promise<{ count: number }>, [unknown?]>;
    };
    matchSlotPlayerResult: {
      deleteMany: jest.Mock<Promise<{ count: number }>, [unknown?]>;
      upsert: jest.Mock<Promise<unknown>, [unknown?]>;
    };
    matchStanding: {
      deleteMany: jest.Mock<Promise<{ count: number }>, [unknown?]>;
      upsert: jest.Mock<Promise<unknown>, [unknown?]>;
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
      findUnique: jest.fn<Promise<unknown>, [unknown?]>(),
      create: jest.fn<Promise<unknown>, [unknown?]>(),
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
        Promise<
          Array<{
            teamId: string | null;
            slotNumber: number;
            team?: {
              name?: string | null;
              tag?: string | null;
              logoUrl?: string | null;
              players?: Array<{
                id: string;
                ign?: string | null;
                photoUrl?: string | null;
                externalPlayerId?: string | null;
                playerOpenId?: string | null;
                inGameId?: string | null;
                pubgPlayerId?: string | null;
              }>;
            } | null;
          }>
        >,
        [unknown?]
      >(),
    },
    matchSlotResult: {
      findFirst: jest.fn<Promise<unknown>, [unknown?]>(),
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
      upsert: jest.fn<Promise<unknown>, [unknown?]>(),
      deleteMany: jest.fn<Promise<{ count: number }>, [unknown?]>(),
    },
    matchSlotPlayerResult: {
      deleteMany: jest.fn<Promise<{ count: number }>, [unknown?]>(),
      upsert: jest.fn<Promise<unknown>, [unknown?]>(),
    },
    matchStanding: {
      deleteMany: jest.fn<Promise<{ count: number }>, [unknown?]>(),
      upsert: jest.fn<Promise<unknown>, [unknown?]>(),
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
    lockCanonicalRoster: jest.fn(),
  };
  const matchStateBroadcaster = {
    broadcastUpdate: jest.fn(() => Promise.resolve(undefined)),
  } as unknown as MatchStateBroadcaster;
  const conclusion = {
    conclude: jest.fn(() => Promise.resolve(undefined)),
    computeFinalResults: jest.fn(),
    buildObserverMatchFinishedPayload: jest.fn(() => Promise.resolve(null)),
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
    organization: { slug: 'test-org' },
  };

  const resetMockGroup = (group: Record<string, unknown>) => {
    for (const value of Object.values(group)) {
      if (
        value &&
        typeof value === 'function' &&
        'mockReset' in value &&
        typeof (value as { mockReset?: () => void }).mockReset === 'function'
      ) {
        (value as { mockReset: () => void }).mockReset();
      }
    }
  };

  beforeEach(() => {
    jest.clearAllMocks();
    resetMockGroup(prisma.match);
    resetMockGroup(prisma.matchControlState);
    resetMockGroup(prisma.matchStateSnapshot);
    resetMockGroup(prisma.matchTelemetry);
    resetMockGroup(prisma.telemetryEventLog);
    resetMockGroup(prisma.matchTeam);
    resetMockGroup(prisma.matchSlot);
    resetMockGroup(prisma.matchSlotResult);
    resetMockGroup(prisma.matchSlotPlayerResult);
    resetMockGroup(prisma.matchStanding);
    prisma.$transaction.mockReset();
    resetMockGroup(store as Record<string, unknown>);
    resetMockGroup(gateway as Record<string, unknown>);
    resetMockGroup(scoreboard as Record<string, unknown>);
    resetMockGroup(scoring as Record<string, unknown>);
    resetMockGroup(matchState as Record<string, unknown>);
    resetMockGroup(matchesService as Record<string, unknown>);
    resetMockGroup(audit as Record<string, unknown>);
    resetMockGroup(realtime as Record<string, unknown>);
    resetMockGroup(rankingEmitter as Record<string, unknown>);
    resetMockGroup(resultsService as Record<string, unknown>);
    resetMockGroup(liveStateMirror as Record<string, unknown>);
    resetMockGroup(matchStateBroadcaster as Record<string, unknown>);
    resetMockGroup(conclusion as Record<string, unknown>);

    prisma.$transaction.mockImplementation((arg) =>
      Array.isArray(arg) ? Promise.all(arg) : arg(prisma),
    );
    store.save.mockImplementation(
      (_, state: LiveMatchState, expectedVersion?: number) =>
        Promise.resolve({
          ...state,
          version: (expectedVersion ?? state.version ?? 0) + 1,
          updatedAt: new Date().toISOString(),
        }),
    );
    store.get.mockResolvedValue(null);
    store.evictMatches.mockResolvedValue();
    scoreboard.broadcast.mockResolvedValue(undefined);
    scoring.recomputeTournament.mockResolvedValue(undefined);
    scoring.recomputeMatchAndTournament.mockResolvedValue(undefined);
    matchState.mapControlToBusinessStatus.mockImplementation(
      (value: string) => {
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
      },
    );
    matchesService.validatePubgSlots.mockResolvedValue(undefined);
    matchesService.syncLiveHierarchy.mockResolvedValue([]);
    matchesService.assignSlotsIfMissing.mockResolvedValue([]);
    audit.log.mockResolvedValue(undefined);
    resultsService.ensureResultsFromSlots.mockResolvedValue(undefined);
    resultsService.resetLiveProjection.mockResolvedValue(undefined);
    resultsService.recalculateMatchResults.mockResolvedValue(undefined);
    liveStateMirror.publish.mockImplementation(
      async (state: LiveMatchState) => state,
    );
    matchStateBroadcaster.broadcastUpdate.mockResolvedValue(undefined);
    conclusion.conclude.mockResolvedValue(undefined);
    prisma.match.groupBy.mockResolvedValue([]);
    prisma.matchControlState.findUnique.mockResolvedValue({
      matchId: 'A',
      state: 'READY',
      version: 0,
      metaJson: null,
    });
    prisma.matchControlState.create.mockResolvedValue({
      matchId: 'A',
      state: 'READY',
      version: 1,
      metaJson: null,
    });
    prisma.matchControlState.updateMany.mockResolvedValue({ count: 1 });
    prisma.matchSlotResult.findFirst.mockResolvedValue(null);
    prisma.matchSlotResult.findMany.mockResolvedValue([]);
    prisma.matchSlotResult.upsert.mockImplementation((args: any) =>
      Promise.resolve({
        id: `slot-result-${args?.where?.matchId_slotNumber?.slotNumber ?? 1}`,
        slotNumber: args?.where?.matchId_slotNumber?.slotNumber ?? 1,
      }),
    );
    prisma.matchSlotResult.deleteMany.mockResolvedValue({ count: 0 });
    prisma.matchSlotPlayerResult.deleteMany.mockResolvedValue({ count: 0 });
    prisma.matchSlotPlayerResult.upsert.mockResolvedValue({});
    prisma.matchStanding.deleteMany.mockResolvedValue({ count: 0 });
    prisma.matchStanding.upsert.mockResolvedValue({});
    conclusion.computeFinalResults.mockReset();
    conclusion.buildObserverMatchFinishedPayload.mockResolvedValue(null);
    const resultsEvents: ResultsEventsService = {
      emitResultsLockState: jest.fn(),
      emitResultsUpdated: jest.fn(),
      emitLeaderboardUpdated: jest.fn(),
      emitOverlayPayload: jest.fn(),
      emitMatchUpdate: jest.fn(),
      emitControlContractUpdated: jest.fn(),
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
      undefined,
      undefined,
      undefined,
      matchStateBroadcaster,
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

  const buildComputedFinalResults = () =>
    ({
      matchId: 'A',
      plan: {
        matchId: 'A',
        organizationId: 'org1',
        tournamentId: 'T',
        sessionId: null,
        isSessionMatch: false,
        status: MatchStatus.FINISH_PENDING,
        liveState: LiveState.ENDED,
        endedAt: new Date('2026-03-18T10:10:00.000Z'),
        endedReason: 'OBSERVER_FINISH_DETECTED',
        finalizedAt: '2026-03-18T10:10:00.000Z',
        source: 'CONFIRM_MATCH_FINISHED',
        winnerTeamId: 'team-a',
        aliveTeamsAtEnd: 1,
        resultNeedsConfirmation: false,
        resultAmbiguities: [],
        totalTeams: 1,
        placementsAssigned: 1,
        previousMeta: null,
        nextMeta: {
          resultFinalized: true,
          finalizedAt: '2026-03-18T10:10:00.000Z',
          winnerTeamId: 'team-a',
          aliveTeamsAtEnd: 1,
          resultNeedsConfirmation: false,
          resultAmbiguities: null,
        },
        finalState: {} as any,
        finalProjection: {
          totalTeams: 1,
          aliveTeamsAtEnd: 1,
          placementsAssigned: 1,
          winnerTeamId: 'team-a',
          teams: {},
        },
      },
      teamResults: [
        {
          matchId: 'A',
          organizationId: 'org1',
          slotNumber: 1,
          teamId: 'team-a',
          wasPresentInMatch: true,
          placement: 1,
          eliminatedOrder: null,
          eliminatedAt: null,
          totalKills: 7,
          manualTotalKills: false,
          finalPlacement: 1,
          finalKills: 7,
          finalizedAt: new Date('2026-03-18T10:10:00.000Z'),
          placementPoints: 10,
          points: 7,
          totalPoints: 17,
          isLocked: true,
          aliveAtEnd: true,
        },
      ],
      playerResults: [
        {
          matchId: 'A',
          organizationId: 'org1',
          slotNumber: 1,
          teamId: 'team-a',
          playerId: 'player-a',
          pubgAccountId: 'pubg-a',
          externalPlayerId: 'ext-a',
          playerName: 'Alpha',
          kills: 7,
          knocks: 0,
          isKnocked: false,
          isAlive: false,
          alive: false,
          isAutoFilled: false,
          aliveAtEnd: true,
          knockedAtEnd: false,
        },
      ],
      standings: [
        {
          matchId: 'A',
          organizationId: 'org1',
          tournamentId: 'T',
          teamId: 'team-a',
          rank: 1,
          totalKills: 7,
          placementPoints: 10,
          bonusPoints: 0,
          penaltyPoints: 0,
          totalPoints: 17,
          isLocked: true,
          isFinal: true,
          computedAt: new Date('2026-03-18T10:10:00.000Z'),
        },
      ],
    }) as any;

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

  it('uses DB compare-and-swap so concurrent lifecycle writes conflict', async () => {
    prisma.match.findFirst.mockResolvedValue({
      ...baseMatch,
      controlState: { state: 'READY', version: 0, metaJson: null },
    });
    prisma.matchControlState.findUnique.mockResolvedValue({
      matchId: 'A',
      state: 'READY',
      version: 0,
      metaJson: null,
    });
    prisma.matchControlState.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    prisma.matchTeam.findMany.mockResolvedValue([]);
    prisma.matchSlot.findMany.mockResolvedValue([]);
    prisma.matchSlotResult.findMany.mockResolvedValue([]);

    await expect(
      service.setStatus(actor, 'A', { status: 'LIVE', version: 0 }),
    ).resolves.toMatchObject({ matchId: 'A', status: 'LIVE' });

    await expect(
      service.setStatus(actor, 'A', { status: 'READY', version: 0 }),
    ).rejects.toThrow(ConflictException);
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
    expect(prisma.matchControlState.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          state: 'FINISH_PENDING',
          reason: 'OBSERVER_FINISH_DETECTED',
        }),
      }),
    );
    lifecycleSpy.mockRestore();
  });

  it('enters finalization for session matches using the match organization context', async () => {
    const nowMs = Date.parse('2026-03-18T10:10:00.000Z');
    const dateNowSpy = jest.spyOn(Date, 'now').mockReturnValue(nowMs);
    const lifecycleSpy = jest
      .spyOn(service, 'getLifecycleState')
      .mockResolvedValue({ matchId: 'A', status: 'ENDED' } as any);
    prisma.match.findFirst.mockResolvedValue({
      ...baseMatch,
      tournamentId: null,
      tournament: null,
      organizationId: 'org-session',
      status: MatchStatus.LIVE,
      liveAt: new Date('2026-03-18T09:59:00.000Z'),
      startedAt: new Date('2026-03-18T09:59:00.000Z'),
      pcobSessionId: 'telemetry-session',
      controlState: { state: 'LIVE', metaJson: null },
    } as any);
    prisma.matchControlState.findUnique.mockResolvedValue(null);
    prisma.matchControlState.create.mockResolvedValue({});
    (store.get as jest.Mock).mockResolvedValueOnce(
      buildInitializedLiveState(1, {
        firstValidAt: Date.parse('2026-03-18T09:59:30.000Z'),
        lastAliveTeams: 1,
        lastAliveTeamsAt: Date.parse('2026-03-18T10:09:00.000Z'),
      }),
    );
    jest
      .spyOn(service, 'confirmFinishedIfEligible')
      .mockResolvedValue({ matchId: 'A', status: 'ENDED' } as any);

    try {
      await expect(
        service.detectMatchFinish('A', 'telemetry-session'),
      ).resolves.toEqual({
        matchId: 'A',
        status: 'ENDED',
      });
    } finally {
      dateNowSpy.mockRestore();
      lifecycleSpy.mockRestore();
    }

    expect(prisma.match.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          organizationId: true,
          tournament: { select: { organizationId: true } },
        }),
      }),
    );
    expect(prisma.matchControlState.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          matchId: 'A',
          organizationId: 'org-session',
          state: 'FINISH_PENDING',
          reason: 'OBSERVER_FINISH_DETECTED',
        }),
      }),
    );
  });

  it('finalizes a pending match atomically through MatchControlService', async () => {
    const publishSpy = jest
      .spyOn(service as any, 'publishFinalizationSideEffects')
      .mockResolvedValue(undefined);
    prisma.match.findFirst.mockResolvedValue({
      ...baseMatch,
      status: MatchStatus.FINISH_PENDING,
      liveState: LiveState.ENDED,
      endedAt: new Date('2026-03-18T10:10:00.000Z'),
      endedReason: 'OBSERVER_FINISH_DETECTED',
      controlState: { state: 'FINISH_PENDING', version: 2, metaJson: null },
    });
    prisma.matchControlState.findUnique
      .mockResolvedValueOnce({
        matchId: 'A',
        state: 'FINISH_PENDING',
        version: 2,
        metaJson: null,
      })
      .mockResolvedValueOnce({
        matchId: 'A',
        state: 'FINISH_PENDING',
        version: 2,
        metaJson: null,
      });
    prisma.matchSlotResult.findMany.mockResolvedValue([]);
    conclusion.computeFinalResults.mockResolvedValue(
      buildComputedFinalResults(),
    );

    await expect(
      service.finalizeMatch('A', 2, 'CONFIRM_MATCH_FINISHED'),
    ).resolves.toBe(true);

    expect(conclusion.computeFinalResults).toHaveBeenCalledWith(
      'A',
      expect.objectContaining({ source: 'CONFIRM_MATCH_FINISHED' }),
      prisma,
    );
    expect(prisma.matchSlotResult.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          matchId: 'A',
          slotNumber: 1,
          finalPlacement: 1,
          finalKills: 7,
        }),
      }),
    );
    expect(prisma.matchSlotPlayerResult.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          slotResultId: 'slot-result-1',
          playerName: 'Alpha',
          kills: 7,
          isAlive: false,
        }),
      }),
    );
    expect(prisma.matchStanding.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          matchId: 'A',
          teamId: 'team-a',
          rank: 1,
          totalPoints: 17,
        }),
      }),
    );
    expect(prisma.match.update).toHaveBeenCalledWith({
      where: { id: 'A' },
      data: expect.objectContaining({
        status: MatchStatus.FINISHED,
        liveState: LiveState.ENDED,
      }),
    });
    expect(prisma.matchControlState.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { matchId: 'A', version: 2 },
        data: expect.objectContaining({
          state: 'ENDED',
          reason: 'CONFIRM_MATCH_FINISHED',
          metaJson: expect.objectContaining({
            resultFinalized: true,
            postMatchWidgets: expect.arrayContaining([
              expect.objectContaining({
                name: 'Match Results',
                obsUrl: '/widgets/test-org/match-results?matchId=A',
              }),
            ]),
          }),
          version: { increment: 1 },
        }),
      }),
    );
    publishSpy.mockRestore();
  });

  it('rolls back lifecycle promotion when a final result write fails', async () => {
    prisma.match.findFirst.mockResolvedValue({
      ...baseMatch,
      status: MatchStatus.FINISH_PENDING,
      liveState: LiveState.ENDED,
      endedAt: new Date('2026-03-18T10:10:00.000Z'),
      endedReason: 'OBSERVER_FINISH_DETECTED',
      controlState: { state: 'FINISH_PENDING', version: 2, metaJson: null },
    });
    prisma.matchControlState.findUnique.mockResolvedValue({
      matchId: 'A',
      state: 'FINISH_PENDING',
      version: 2,
      metaJson: null,
    });
    prisma.matchSlotResult.findMany.mockResolvedValue([]);
    prisma.matchSlotResult.upsert.mockRejectedValueOnce(
      new Error('write failed'),
    );
    conclusion.computeFinalResults.mockResolvedValue(
      buildComputedFinalResults(),
    );

    await expect(service.finalizeMatch('A', 2)).rejects.toThrow('write failed');

    expect(prisma.match.update).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: MatchStatus.FINISHED }),
      }),
    );
    expect(prisma.matchControlState.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ state: 'ENDED' }),
      }),
    );
  });

  it('rejects concurrent finalization when the control version changed', async () => {
    prisma.match.findFirst.mockResolvedValue({
      ...baseMatch,
      status: MatchStatus.FINISH_PENDING,
      liveState: LiveState.ENDED,
      controlState: { state: 'FINISH_PENDING', version: 3, metaJson: null },
    });
    prisma.matchControlState.findUnique.mockResolvedValue({
      matchId: 'A',
      state: 'FINISH_PENDING',
      version: 3,
      metaJson: null,
    });

    await expect(service.finalizeMatch('A', 2)).rejects.toThrow(
      ConflictException,
    );

    expect(conclusion.computeFinalResults).not.toHaveBeenCalled();
    expect(prisma.matchSlotResult.upsert).not.toHaveBeenCalled();
    expect(prisma.match.update).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: MatchStatus.FINISHED }),
      }),
    );
  });

  it('treats double finalization of an already finished match as a no-op', async () => {
    prisma.match.findFirst.mockResolvedValueOnce({
      id: 'A',
      status: MatchStatus.FINISHED,
      controlState: {
        metaJson: {
          resultFinalized: true,
          finalizedAt: '2026-03-18T10:10:00.000Z',
        },
      },
    } as any);

    await expect(service.finalizeMatch('A', 2)).resolves.toBe(true);

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(conclusion.computeFinalResults).not.toHaveBeenCalled();
    expect(prisma.matchSlotResult.upsert).not.toHaveBeenCalled();
  });

  it('uses validated finish metadata to finalize a pending match when slot results lag', async () => {
    const confirmSpy = jest
      .spyOn(service, 'confirmFinished')
      .mockResolvedValue({ matchId: 'A', status: 'FINISHED' } as any);
    const lifecycleSpy = jest
      .spyOn(service, 'getLifecycleState')
      .mockResolvedValue({ matchId: 'A', status: 'FINISHED' } as any);
    prisma.match.findFirst.mockResolvedValue({
      ...baseMatch,
      status: MatchStatus.FINISH_PENDING,
      controlState: {
        state: 'FINISH_PENDING',
        metaJson: {
          finishEligibilityVerifiedAt: '2026-03-18T10:10:00.000Z',
          finishEligibilitySource: 'OBSERVER_FINISH_DETECTED',
          finishEligibilityAliveTeams: 1,
        },
      },
    });
    prisma.matchSlotResult.findMany.mockResolvedValue([]);

    await expect(
      service.confirmFinishedIfEligible('A', 'MATCH_FINISH_ELIGIBILITY_CHECK'),
    ).resolves.toMatchObject({
      matchId: 'A',
      status: 'FINISHED',
    });

    expect(confirmSpy).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'SUPER_ADMIN' }),
      'A',
      'OBSERVER_FINISH_DETECTED',
    );

    confirmSpy.mockRestore();
    lifecycleSpy.mockRestore();
  });

  it('treats external finish signals as eligibility checks instead of direct match ends', async () => {
    prisma.match.findFirst.mockResolvedValue({
      ...baseMatch,
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

  it('auto-ends another live match in scope when starting a new match', async () => {
    const finalizeSpy = jest
      .spyOn(service, 'confirmFinished')
      .mockResolvedValue({} as any);
    prisma.match.findFirst
      .mockResolvedValueOnce(baseMatch)
      .mockResolvedValueOnce({
        id: 'B',
        groupId: 'G',
        tournamentId: 'T',
        status: MatchStatus.LIVE,
        startedAt: new Date('2026-03-18T09:50:00.000Z'),
        endedAt: null,
        updatedAt: new Date('2026-03-18T10:00:00.000Z'),
        organizationId: 'org1',
        tournament: { ownerUserId: 'user1', organizationId: 'org1' },
        controlState: { version: 4, state: 'LIVE', metaJson: null },
      } as any)
      .mockResolvedValueOnce({
        ...baseMatch,
        id: 'B',
        name: 'Match B',
        status: MatchStatus.ENDED,
        liveState: LiveState.ENDED,
        startedAt: new Date('2026-03-18T09:50:00.000Z'),
        endedAt: new Date('2026-03-18T10:05:00.000Z'),
        endedReason: 'AUTO_ENDED_BY_NEW_LIVE_MATCH',
        controlState: { state: 'ENDED', version: 5, metaJson: null },
      })
      .mockResolvedValueOnce({
        ...baseMatch,
        status: MatchStatus.LIVE,
        liveState: LiveState.LIVE,
        startedAt: new Date('2026-03-18T10:05:00.000Z'),
        endedAt: null,
        endedReason: null,
        controlState: { state: 'LIVE', version: 1, metaJson: null },
      });
    prisma.match.findMany
      .mockResolvedValueOnce([{ id: 'B' }] as any)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    prisma.matchControlState.findUnique
      .mockResolvedValueOnce({
        matchId: 'B',
        state: 'LIVE',
        version: 4,
        metaJson: null,
      })
      .mockResolvedValue({
        matchId: 'A',
        state: 'READY',
        version: 0,
        metaJson: null,
      });
    prisma.match.updateMany.mockResolvedValueOnce({ count: 1 });
    prisma.match.update.mockResolvedValue({});
    prisma.matchTeam.findMany.mockResolvedValue([]);
    prisma.matchSlot.findMany.mockResolvedValue([]);
    prisma.matchSlotResult.findMany.mockResolvedValue([]);

    await expect(service.startMatch(actor, 'A')).resolves.toMatchObject({
      matchId: 'A',
      status: 'LIVE',
    });

    expect(prisma.match.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'B' }),
        data: expect.objectContaining({
          status: MatchStatus.ENDED,
          liveState: LiveState.ENDED,
          endedReason: 'AUTO_ENDED_BY_NEW_LIVE_MATCH',
        }),
      }),
    );
    expect(gateway.emitMatchAutoEnd).toHaveBeenCalledWith(
      'B',
      expect.objectContaining({
        matchId: 'B',
        endedAt: expect.any(String),
      }),
      'org1',
    );
    expect(finalizeSpy).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: 'system', role: 'SUPER_ADMIN' }),
      'B',
      'AUTO_ENDED_BY_NEW_LIVE_MATCH',
    );
    expect(gateway.emitLiveStateUpdates).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'B',
          liveState: LiveState.ENDED,
        }),
        expect.objectContaining({
          id: 'A',
          liveState: LiveState.LIVE,
        }),
      ]),
    );
  });

  it('auto-ends the current live match even when multiple teams are still alive', async () => {
    const finalizeSpy = jest
      .spyOn(service, 'confirmFinished')
      .mockResolvedValue({} as any);
    prisma.match.findFirst
      .mockResolvedValueOnce(baseMatch)
      .mockResolvedValueOnce({
        id: 'B',
        groupId: 'G',
        tournamentId: 'T',
        status: MatchStatus.LIVE,
        startedAt: new Date('2026-03-18T09:50:00.000Z'),
        endedAt: null,
        updatedAt: new Date('2026-03-18T10:00:00.000Z'),
        organizationId: 'org1',
        tournament: { ownerUserId: 'user1', organizationId: 'org1' },
        controlState: { version: 4, state: 'LIVE', metaJson: null },
      } as any)
      .mockResolvedValueOnce({
        ...baseMatch,
        id: 'B',
        name: 'Match B',
        status: MatchStatus.ENDED,
        liveState: LiveState.ENDED,
        startedAt: new Date('2026-03-18T09:50:00.000Z'),
        endedAt: new Date('2026-03-18T10:05:00.000Z'),
        endedReason: 'AUTO_ENDED_BY_NEW_LIVE_MATCH',
        controlState: { state: 'ENDED', version: 5, metaJson: null },
      })
      .mockResolvedValueOnce({
        ...baseMatch,
        status: MatchStatus.LIVE,
        liveState: LiveState.LIVE,
        startedAt: new Date('2026-03-18T10:05:00.000Z'),
        endedAt: null,
        endedReason: null,
        controlState: { state: 'LIVE', version: 1, metaJson: null },
      });
    prisma.match.findMany
      .mockResolvedValueOnce([{ id: 'B' }] as any)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    prisma.matchControlState.findUnique
      .mockResolvedValueOnce({
        matchId: 'B',
        state: 'LIVE',
        version: 4,
        metaJson: null,
      })
      .mockResolvedValue({
        matchId: 'A',
        state: 'READY',
        version: 0,
        metaJson: null,
      });
    prisma.match.updateMany.mockResolvedValueOnce({ count: 1 });
    prisma.match.update.mockResolvedValue({});
    prisma.matchTeam.findMany.mockResolvedValue([]);
    prisma.matchSlot.findMany.mockResolvedValue([]);
    prisma.matchSlotResult.findMany
      .mockResolvedValueOnce([
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
      ] as any)
      .mockResolvedValue([]);

    await expect(service.startMatch(actor, 'A')).resolves.toMatchObject({
      matchId: 'A',
      status: 'LIVE',
    });

    expect(gateway.emitMatchAutoEnd).toHaveBeenCalledWith(
      'B',
      expect.objectContaining({
        matchId: 'B',
        endedAt: expect.any(String),
      }),
      'org1',
    );
    expect(finalizeSpy).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: 'system', role: 'SUPER_ADMIN' }),
      'B',
      'AUTO_ENDED_BY_NEW_LIVE_MATCH',
    );
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
    prisma.matchControlState.findUnique.mockResolvedValueOnce({
      matchId: 'A',
      state: 'LIVE',
      version: 0,
      metaJson: {
        telemetryIngress: {
          sessionId: 'session-live',
          lastAdapterSequence: 15,
        },
      },
    });

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

  it('treats a repeated same-session LIVE start as idempotent', async () => {
    const startedAt = new Date('2026-03-18T10:00:00.000Z');
    prisma.match.findFirst.mockResolvedValueOnce({
      ...baseMatch,
      status: MatchStatus.LIVE,
      liveState: LiveState.LIVE,
      liveAt: startedAt,
      startedAt,
      endedAt: null,
      endedReason: null,
      pcobSessionId: 'session-live',
      pcobMode: true,
      pcobBoundAt: startedAt,
      pcobLastSeenAt: new Date('2026-03-18T10:01:00.000Z'),
      adapterKey: 'pubgm-pcob',
      dataSource: 'PCOB',
      dataMode: 'PCOB',
      controlState: {
        state: 'LIVE',
        metaJson: {
          telemetryIngress: {
            sessionId: 'session-live',
            lastAdapterSequence: 15,
          },
        },
      },
    });
    prisma.matchTeam.findMany.mockResolvedValue([]);
    prisma.matchSlot.findMany.mockResolvedValue([]);
    prisma.matchSlotResult.findMany.mockResolvedValue([]);
    prisma.matchControlState.findUnique.mockResolvedValueOnce({
      matchId: 'A',
      state: 'LIVE',
      version: 0,
      metaJson: {
        telemetryIngress: {
          sessionId: 'session-live',
          lastAdapterSequence: 15,
        },
      },
    });

    const state = await service.startMatch(actor, 'A', 'session-live', {
      source: 'desktop-launcher',
    });

    expect(state.status).toBe('LIVE');
    expect(matchesService.validatePubgSlots).not.toHaveBeenCalled();
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.match.update).toHaveBeenCalledWith({
      where: { id: 'A' },
      data: expect.objectContaining({
        telemetrySource: 'API',
        telemetrySourceLockedAt: expect.any(Date),
      }),
    });
    expect(prisma.matchControlState.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { matchId: 'A', version: 0 },
        data: expect.objectContaining({
          metaJson: expect.objectContaining({
            telemetryIngress: {
              sessionId: 'session-live',
              lastAdapterSequence: 15,
            },
            telemetrySource: 'API',
          }),
        }),
      }),
    );
    expect(resultsService.resetLiveProjection).not.toHaveBeenCalled();
    expect(prisma.matchStateSnapshot.deleteMany).not.toHaveBeenCalled();
    expect(prisma.matchTelemetry.deleteMany).not.toHaveBeenCalled();
    expect(prisma.telemetryEventLog.deleteMany).not.toHaveBeenCalled();
    expect(store.evictMatches).not.toHaveBeenCalled();
    expect(gateway.emitMatchState).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('rebinds a LIVE match telemetry session without resetting the match run', async () => {
    const startedAt = new Date('2026-03-18T10:00:00.000Z');
    const liveMatch = {
      ...baseMatch,
      status: MatchStatus.LIVE,
      liveState: LiveState.LIVE,
      liveAt: startedAt,
      startedAt,
      endedAt: null,
      endedReason: null,
      pcobSessionId: 'session-old',
      pcobMode: true,
      pcobBoundAt: startedAt,
      pcobLastSeenAt: new Date('2026-03-18T10:01:00.000Z'),
      adapterKey: 'pubgm-pcob',
      dataSource: 'PCOB',
      dataMode: 'PCOB',
      controlState: {
        state: 'LIVE',
        metaJson: {
          telemetryIngress: {
            sessionId: 'session-old',
            lastAdapterSequence: 15,
          },
          telemetryRuntime: {
            lastAcceptedAt: '2026-03-18T10:01:00.000Z',
          },
        },
      },
    };
    prisma.match.findFirst.mockResolvedValueOnce(liveMatch);
    prisma.match.findFirst.mockResolvedValueOnce({
      ...liveMatch,
      pcobSessionId: 'session-new',
      pcobBoundAt: new Date('2026-03-18T10:02:00.000Z'),
      pcobLastSeenAt: null,
      controlState: {
        state: 'LIVE',
        metaJson: {
          telemetryRuntime: {
            lastAcceptedAt: '2026-03-18T10:01:00.000Z',
          },
        },
      },
    });
    prisma.matchTeam.findMany.mockResolvedValue([]);
    prisma.matchSlot.findMany.mockResolvedValue([]);
    prisma.matchSlotResult.findMany.mockResolvedValue([]);
    prisma.matchControlState.findUnique.mockResolvedValueOnce({
      matchId: 'A',
      state: 'LIVE',
      version: 0,
      metaJson: {
        telemetryIngress: {
          sessionId: 'session-live',
          lastAdapterSequence: 15,
        },
        telemetryRuntime: {
          lastPacketAt: '2026-03-18T10:00:00.000Z',
        },
      },
    });

    await service.startMatch(actor, 'A', 'session-new', {
      source: 'desktop-launcher',
      clientId: 'host:123',
    });

    const updateArg = prisma.match.update.mock.calls[0][0] as any;
    expect(updateArg.where).toEqual({ id: 'A' });
    expect(updateArg.data).toEqual(
      expect.objectContaining({
        pcobSessionId: 'session-new',
        pcobMode: false,
        dataMode: 'MANUAL',
        dataSource: 'API',
        adapterKey: 'pubgm-pcob',
        pcobBoundAt: expect.any(Date),
        pcobLastSeenAt: null,
        telemetrySource: 'API',
        telemetrySourceLockedAt: expect.any(Date),
      }),
    );
    expect(updateArg.data).not.toHaveProperty('startedAt');
    expect(updateArg.data).not.toHaveProperty('liveAt');
    expect(updateArg.data).not.toHaveProperty('endedAt');
    expect(updateArg.data).not.toHaveProperty('endedReason');
    const updateArgControl = prisma.matchControlState.updateMany.mock
      .calls[0][0] as any;
    expect(JSON.stringify(updateArgControl.data.metaJson)).not.toContain(
      'telemetryIngress',
    );
    expect(JSON.stringify(updateArgControl.data.metaJson)).toContain(
      'telemetryRuntime',
    );
    expect(JSON.stringify(updateArgControl.data.metaJson)).toContain(
      '"telemetrySource":"API"',
    );
    expect(matchesService.validatePubgSlots).not.toHaveBeenCalled();
    expect(resultsService.resetLiveProjection).not.toHaveBeenCalled();
    expect(prisma.matchStateSnapshot.deleteMany).not.toHaveBeenCalled();
    expect(prisma.matchTelemetry.deleteMany).not.toHaveBeenCalled();
    expect(prisma.telemetryEventLog.deleteMany).not.toHaveBeenCalled();
    expect(store.evictMatches).toHaveBeenCalledWith(['A']);
    expect(gateway.emitMatchState).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('locks a desktop-launched fresh live start to the launcher telemetry source', async () => {
    prisma.match.findFirst.mockResolvedValueOnce(baseMatch);
    prisma.match.findMany.mockResolvedValueOnce([]);
    prisma.match.findMany.mockResolvedValueOnce([]);
    prisma.match.findMany.mockResolvedValueOnce([]);
    prisma.match.update.mockResolvedValue({});
    prisma.match.findFirst.mockResolvedValueOnce({
      ...baseMatch,
      status: MatchStatus.LIVE,
      liveState: LiveState.LIVE,
      startedAt: new Date('2026-03-18T10:00:00.000Z'),
      liveAt: new Date('2026-03-18T10:00:00.000Z'),
      telemetrySource: 'API',
      telemetrySourceLockedAt: new Date('2026-03-18T10:00:00.000Z'),
      controlState: {
        state: 'LIVE',
        metaJson: {
          telemetrySource: 'API',
        },
      },
    });
    prisma.matchTeam.findMany.mockResolvedValue([]);
    prisma.matchSlot.findMany.mockResolvedValue([]);
    prisma.matchSlotResult.findMany.mockResolvedValue([]);
    prisma.matchControlState.findUnique.mockResolvedValueOnce({
      matchId: 'A',
      state: 'READY',
      version: 0,
      metaJson: {
        telemetrySource: 'API',
      },
    });

    await service.startMatch(actor, 'A', null, {
      source: 'desktop-launcher',
      clientId: 'host:123',
    });

    const updateArg = prisma.match.update.mock.calls[0][0] as any;
    expect(updateArg.where).toEqual({ id: 'A' });
    expect(updateArg.data).toEqual(
      expect.objectContaining({
        status: MatchStatus.LIVE,
        liveState: LiveState.LIVE,
        telemetrySource: 'API',
        telemetrySourceLockedAt: expect.any(Date),
      }),
    );
    const updateArgControl = prisma.matchControlState.updateMany.mock
      .calls[0][0] as any;
    expect(JSON.stringify(updateArgControl.data.metaJson)).toContain(
      '"telemetrySource":"API"',
    );
  });

  it('preserves the active launcher telemetry run during a fresh live transition', async () => {
    const preLiveMatch = {
      ...baseMatch,
      status: MatchStatus.DRAFT,
      liveState: LiveState.UPCOMING,
      startedAt: null,
      endedAt: null,
      pcobSessionId: 'session-live',
      pcobMode: true,
      pcobBoundAt: new Date('2026-03-18T09:58:00.000Z'),
      pcobLastSeenAt: new Date('2026-03-18T10:01:00.000Z'),
      adapterKey: 'pubgm-pcob',
      dataSource: 'PCOB',
      dataMode: 'PCOB',
      controlState: {
        state: 'READY',
        metaJson: {
          telemetryRuntime: {
            lastAcceptedAt: '2026-03-18T10:01:00.000Z',
          },
          telemetryIngress: {
            sessionId: 'session-live',
            lastAdapterSequence: 15,
          },
        },
      },
    };
    const cachedLiveState = buildInitializedLiveState(8);

    prisma.match.findFirst.mockResolvedValueOnce(preLiveMatch);
    prisma.match.findMany.mockResolvedValueOnce([]);
    prisma.match.findMany.mockResolvedValueOnce([]);
    prisma.match.findMany.mockResolvedValueOnce([]);
    prisma.match.update.mockResolvedValue({});
    prisma.match.findFirst.mockResolvedValueOnce({
      ...preLiveMatch,
      status: MatchStatus.LIVE,
      liveState: LiveState.LIVE,
      startedAt: new Date('2026-03-18T10:02:00.000Z'),
      liveAt: new Date('2026-03-18T10:02:00.000Z'),
      telemetrySource: 'API',
      telemetrySourceLockedAt: new Date('2026-03-18T10:02:00.000Z'),
      controlState: {
        state: 'LIVE',
        metaJson: {
          telemetryRuntime: {
            lastAcceptedAt: '2026-03-18T10:01:00.000Z',
          },
          telemetrySource: 'API',
        },
      },
    });
    prisma.matchTeam.findMany.mockResolvedValue([]);
    prisma.matchSlot.findMany.mockResolvedValue([]);
    prisma.matchSlotResult.findMany.mockResolvedValue([]);
    prisma.matchControlState.findUnique.mockResolvedValueOnce({
      matchId: 'A',
      state: 'READY',
      version: 0,
      metaJson: {
        telemetryRuntime: {
          lastAcceptedAt: '2026-03-18T10:01:00.000Z',
        },
        telemetryIngress: {
          sessionId: 'session-live',
          lastAdapterSequence: 15,
        },
      },
    });
    (store.get as jest.Mock).mockResolvedValueOnce(cachedLiveState);

    await service.startMatch(actor, 'A', null, {
      source: 'desktop-launcher',
      clientId: 'host:123',
    });

    expect(resultsService.resetLiveProjection).not.toHaveBeenCalled();
    expect(prisma.matchStateSnapshot.deleteMany).not.toHaveBeenCalled();
    expect(prisma.matchTelemetry.deleteMany).not.toHaveBeenCalled();
    expect(prisma.telemetryEventLog.deleteMany).not.toHaveBeenCalled();
    expect(store.get).toHaveBeenCalledWith('A');
    expect(gateway.emitMatchState).toHaveBeenCalledWith(
      'A',
      expect.objectContaining({
        matchId: 'A',
        status: 'LIVE',
      }),
      'org1',
    );
  });

  it('rotates the PCOB session and start timestamps when starting a reset prior run', async () => {
    const priorRunMatch = {
      ...baseMatch,
      status: MatchStatus.DRAFT,
      liveState: LiveState.UPCOMING,
      startedAt: new Date('2026-03-18T10:00:00.000Z'),
      endedAt: new Date('2026-03-18T10:20:00.000Z'),
      endedReason: null,
      pcobSessionId: 'session-old',
      pcobMode: true,
      pcobBoundAt: new Date('2026-03-18T09:55:00.000Z'),
      pcobLastSeenAt: new Date('2026-03-18T10:19:30.000Z'),
      adapterKey: 'pubgm-pcob',
      dataSource: 'PCOB',
      dataMode: 'PCOB',
      controlState: {
        state: 'READY',
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
    prisma.matchControlState.findUnique.mockResolvedValueOnce({
      matchId: 'A',
      state: 'LIVE',
      version: 0,
      metaJson: {
        telemetryIngress: { sessionId: 'old' },
        liveSync: {
          version: 4,
          updatedAt: 400,
          overrides: { players: {}, teams: {} },
          auditTrail: [],
        },
      },
    });

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
    const updateArgControl = prisma.matchControlState.updateMany.mock
      .calls[0][0] as any;
    expect(JSON.stringify(updateArgControl.data.metaJson)).not.toContain(
      'liveSync',
    );
    expect(JSON.stringify(updateArgControl.data.metaJson)).not.toContain(
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
    expect(liveStateMirror.publish).not.toHaveBeenCalled();
  });

  it('skips match-control rehydrate publish when the live mirror is already telemetry-owned', async () => {
    const currentTelemetryState: LiveMatchState = {
      matchId: 'A',
      status: 'LIVE',
      startedAt: new Date('2026-03-18T09:59:00.000Z').toISOString(),
      endedAt: null,
      version: 9,
      updatedAt: new Date('2026-03-18T10:02:00.000Z').toISOString(),
      sourceMode: 'AUTO',
      summary: {
        totalTeams: 1,
        aliveTeams: 1,
        totalPlayers: 1,
        alivePlayers: 0,
        winnerTeamId: null,
        winnerSlot: null,
      },
      circle: {
        phase: 4,
        nextShrinkAt: 1234,
        safeZone: null,
        nextZone: null,
      },
      killFeed: [],
      events: [],
      teams: [
        {
          teamId: 'team-a',
          name: 'Telemetry Alpha',
          tag: 'TA',
          slot: 1,
          kills: 4,
          placement: null,
          points: null,
          logoUrl: null,
          hasTelemetryPresence: true,
          alivePlayers: 0,
          totalPlayers: 1,
          alive: false,
          eliminated: true,
          players: [
            {
              playerId: 'player-1',
              name: 'Live Alpha',
              ign: 'Live Alpha',
              teamId: 'team-a',
              alive: false,
              knocked: false,
              eliminated: true,
              kills: 4,
              lifeTelemetryFresh: true,
            },
          ],
        },
      ],
    };

    prisma.match.findMany.mockResolvedValueOnce([
      {
        ...baseMatch,
        status: MatchStatus.LIVE,
        liveState: LiveState.LIVE,
        startedAt: new Date('2026-03-18T09:59:00.000Z'),
        controlState: {
          state: 'LIVE',
          version: 2,
          metaJson: null,
        },
      },
    ]);
    (store.get as jest.Mock).mockResolvedValueOnce(currentTelemetryState);
    prisma.matchTeam.findMany.mockResolvedValue([
      {
        teamId: 'team-a',
        team: { name: 'Canonical Alpha', tag: 'CA', logoUrl: null },
      },
    ]);
    prisma.matchSlot.findMany.mockResolvedValue([
      {
        teamId: 'team-a',
        slotNumber: 7,
        team: {
          name: 'Canonical Alpha',
          tag: 'CA',
          logoUrl: null,
          players: [],
        },
      },
    ] as any);
    prisma.matchSlotResult.findMany.mockResolvedValue([
      {
        teamId: 'team-a',
        wasPresentInMatch: true,
        totalKills: 0,
        placement: null,
        totalPoints: 0,
        slotNumber: 7,
        players: [
          {
            id: 'slot-player-1',
            playerId: 'player-1',
            playerName: 'Canonical Alpha',
            kills: 0,
            isAlive: true,
            isKnocked: false,
            player: {
              ign: 'Canonical Alpha',
              photoUrl: null,
              externalPlayerId: 'ext-1',
              inGameId: 'pubg-1',
              pubgPlayerId: 'pubg-1',
            },
          },
        ],
      },
    ] as any);

    await service.onModuleInit();

    expect(liveStateMirror.lockCanonicalRoster).toHaveBeenCalledWith(
      'A',
      expect.objectContaining({
        matchId: 'A',
        status: 'LIVE',
        teams: [
          expect.objectContaining({
            teamId: 'team-a',
            slot: 7,
            players: [
              expect.objectContaining({
                playerId: 'player-1',
                alive: true,
              }),
            ],
          }),
        ],
      }),
    );
    expect(liveStateMirror.publish).not.toHaveBeenCalled();
    expect(gateway.emitMatchState).toHaveBeenCalledWith(
      'A',
      currentTelemetryState,
      'org1',
    );
  });

  it('uses assigned slots, not the full group roster, when a match starts', async () => {
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
        ]),
      }),
      expect.anything(),
    );
    expect(gateway.emitMatchState).toHaveBeenCalledWith(
      'A',
      expect.objectContaining({
        teams: expect.not.arrayContaining([
          expect.objectContaining({ teamId: 'team-x' }),
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
    expect(liveStateMirror.publish).not.toHaveBeenCalled();
    expect(gateway.emitMatchState).not.toHaveBeenCalled();
  });

  it('serves GET control state without publishing, mutating, or broadcasting', async () => {
    (store.get as jest.Mock).mockResolvedValueOnce(null);
    prisma.match.findFirst.mockResolvedValueOnce({
      ...baseMatch,
      controlState: { state: 'READY', version: 0, metaJson: null },
    });
    prisma.matchTeam.findMany.mockResolvedValue([]);
    prisma.matchSlot.findMany.mockResolvedValue([]);
    prisma.matchSlotResult.findMany.mockResolvedValue([]);

    await expect(service.getState(actor, 'A')).resolves.toMatchObject({
      matchId: 'A',
      status: 'READY',
    });

    expect(liveStateMirror.publish).not.toHaveBeenCalled();
    expect(gateway.emitMatchState).not.toHaveBeenCalled();
    expect(prisma.matchControlState.updateMany).not.toHaveBeenCalled();
    expect(prisma.match.update).not.toHaveBeenCalled();
  });

  it('refreshes and republishes the live slot contract for realtime consumers', async () => {
    prisma.match.findFirst.mockResolvedValueOnce({
      ...baseMatch,
      status: MatchStatus.LIVE,
      organizationId: 'org1',
      controlState: { state: 'LIVE', version: 3, metaJson: null },
    });
    prisma.matchTeam.findMany.mockResolvedValue([
      { teamId: 'team-a', team: { name: 'Alpha', tag: 'ALP', logoUrl: null } },
      { teamId: 'team-b', team: { name: 'Bravo', tag: 'BRV', logoUrl: null } },
    ]);
    prisma.matchSlot.findMany.mockResolvedValue([
      { teamId: 'team-a', slotNumber: 1 },
      { teamId: 'team-b', slotNumber: 4 },
    ]);
    prisma.matchSlotResult.findMany.mockResolvedValue([
      {
        teamId: 'team-a',
        totalKills: 0,
        placement: null,
        totalPoints: 0,
        slotNumber: 1,
      },
      {
        teamId: 'team-b',
        totalKills: 0,
        placement: null,
        totalPoints: 0,
        slotNumber: 4,
      },
    ]);
    liveStateMirror.publish.mockImplementation(
      async (state: LiveMatchState) => ({
        ...state,
        version: 4,
      }),
    );

    const refreshed = await service.refreshLiveContractState('A');

    expect(refreshed).toMatchObject({
      matchId: 'A',
      status: 'LIVE',
      version: 4,
    });
    expect(liveStateMirror.publish).toHaveBeenCalledTimes(1);
    expect(gateway.emitMatchState).toHaveBeenCalledWith(
      'A',
      expect.objectContaining({
        matchId: 'A',
        status: 'LIVE',
      }),
      null,
    );
    expect(matchStateBroadcaster.broadcastUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        matchId: 'A',
        status: 'LIVE',
      }),
      'org1',
    );
  });

  it('auto-ends tournament-scope live conflicts when no group matches', async () => {
    const matchNoGroup = { ...baseMatch, groupId: null };
    const finalizeSpy = jest
      .spyOn(service, 'confirmFinished')
      .mockResolvedValue({} as any);
    prisma.match.findFirst
      .mockResolvedValueOnce(matchNoGroup)
      .mockResolvedValueOnce({
        id: 'C',
        groupId: null,
        tournamentId: 'T',
        status: MatchStatus.LIVE,
        startedAt: new Date('2026-03-18T09:50:00.000Z'),
        endedAt: null,
        updatedAt: new Date('2026-03-18T10:00:00.000Z'),
        organizationId: 'org1',
        tournament: { ownerUserId: 'user1', organizationId: 'org1' },
        controlState: { version: 4, state: 'LIVE', metaJson: null },
      } as any)
      .mockResolvedValueOnce({
        ...matchNoGroup,
        id: 'C',
        name: 'Match C',
        status: MatchStatus.ENDED,
        liveState: LiveState.ENDED,
        startedAt: new Date('2026-03-18T09:50:00.000Z'),
        endedAt: new Date('2026-03-18T10:05:00.000Z'),
        endedReason: 'AUTO_ENDED_BY_NEW_LIVE_MATCH',
        controlState: { state: 'ENDED', version: 5, metaJson: null },
      })
      .mockResolvedValueOnce({
        ...matchNoGroup,
        status: MatchStatus.LIVE,
        liveState: LiveState.LIVE,
        startedAt: new Date('2026-03-18T10:05:00.000Z'),
        endedAt: null,
        endedReason: null,
        controlState: { state: 'LIVE', version: 1, metaJson: null },
      });
    prisma.match.findMany
      .mockResolvedValueOnce([{ id: 'C' }] as any)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    prisma.matchControlState.findUnique
      .mockResolvedValueOnce({
        matchId: 'C',
        state: 'LIVE',
        version: 4,
        metaJson: null,
      })
      .mockResolvedValue({
        matchId: 'A',
        state: 'READY',
        version: 0,
        metaJson: null,
      });
    prisma.match.updateMany.mockResolvedValueOnce({ count: 1 });
    prisma.match.update.mockResolvedValue({});
    prisma.matchTeam.findMany.mockResolvedValue([]);
    prisma.matchSlot.findMany.mockResolvedValue([]);
    prisma.matchSlotResult.findMany.mockResolvedValue([]);

    await expect(service.startMatch(actor, 'A')).resolves.toMatchObject({
      matchId: 'A',
      status: 'LIVE',
    });

    expect(prisma.match.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'C' }),
        data: expect.objectContaining({
          status: MatchStatus.ENDED,
          liveState: LiveState.ENDED,
          endedReason: 'AUTO_ENDED_BY_NEW_LIVE_MATCH',
        }),
      }),
    );
    expect(gateway.emitMatchAutoEnd).toHaveBeenCalledWith(
      'C',
      expect.objectContaining({
        matchId: 'C',
        endedAt: expect.any(String),
      }),
      'org1',
    );
    expect(finalizeSpy).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: 'system', role: 'SUPER_ADMIN' }),
      'C',
      'AUTO_ENDED_BY_NEW_LIVE_MATCH',
    );
  });

  it('does not restart a match auto-ended by a newer live match through automatic start', async () => {
    const autoEndedMatch = {
      ...baseMatch,
      status: MatchStatus.ENDED,
      liveState: LiveState.ENDED,
      endedAt: new Date(),
      endedReason: 'AUTO_ENDED_BY_NEW_LIVE_MATCH',
    };

    prisma.match.findFirst.mockResolvedValueOnce(autoEndedMatch);
    await expect(service.startMatch(actor, 'A')).rejects.toThrow(
      'Match has already finished',
    );
    expect(prisma.match.update).not.toHaveBeenCalled();
    expect(gateway.emitMatchState).not.toHaveBeenCalled();
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
    const recoverySpy = jest
      .spyOn(service, 'confirmFinishedIfEligible')
      .mockResolvedValue({ matchId: 'A', status: 'FINISH_PENDING' } as any);
    prisma.match.findFirst.mockResolvedValue({
      ...baseMatch,
      status: MatchStatus.FINISH_PENDING,
      liveState: LiveState.LIVE,
      pcobSessionId: 'session-1',
      pcobMode: true,
      pcobBoundAt: new Date('2026-03-18T09:59:00.000Z'),
      pcobLastSeenAt: new Date('2026-03-18T10:01:03.000Z'),
      adapterKey: 'pubgm-pcob',
      dataSource: MatchDataSource.API,
      dataMode: 'MANUAL',
      controlState: {
        state: 'FINISH_PENDING',
        metaJson: {
          finalizationStartedAt: startedAt,
          telemetryRuntime: {
            lastTransportAt: '2026-03-18T10:01:02.000Z',
            lastPacketAt: '2026-03-18T10:01:03.000Z',
            lastAcceptedAt: '2026-03-18T10:01:04.000Z',
            lastAcceptedSource: 'API',
            lastAcceptedSequence: 27,
          },
        },
      },
    });

    try {
      await expect(service.getLifecycleState('A')).resolves.toMatchObject({
        matchId: 'A',
        status: 'FINISH_PENDING',
        lifecycleStatus: 'FINISH_PENDING',
        controlStatus: 'FINISH_PENDING',
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
          lastAcceptedSource: 'API',
          lastAcceptedSequence: 27,
        }),
        binding: expect.objectContaining({
          sessionId: 'session-1',
          sourceMode: MatchDataSource.API,
          isConfigured: true,
          isBound: true,
          isReady: true,
        }),
      });
      await new Promise((resolve) => setImmediate(resolve));
      expect(recoverySpy).toHaveBeenCalledWith('A', 'FINALIZATION_RECOVERY');
    } finally {
      recoverySpy.mockRestore();
      dateNowSpy.mockRestore();
    }
  });

  it('backfills saved post-match widgets for finalized matches missing them', async () => {
    prisma.match.findFirst.mockResolvedValue({
      ...baseMatch,
      status: MatchStatus.FINISHED,
      liveState: LiveState.ENDED,
      controlState: {
        state: 'ENDED',
        version: 4,
        metaJson: {
          resultFinalized: true,
          finalizedAt: '2026-03-18T10:10:00.000Z',
        },
      },
    });
    prisma.matchControlState.updateMany.mockResolvedValue({ count: 1 });

    await expect(service.getLifecycleState('A')).resolves.toMatchObject({
      matchId: 'A',
      resultFinalized: true,
      postMatchWidgets: expect.arrayContaining([
        expect.objectContaining({
          name: 'Match Results',
          obsUrl: '/widgets/test-org/match-results?matchId=A',
        }),
        expect.objectContaining({
          name: 'Overall Standings',
          obsUrl: '/widgets/test-org/overall-standings?matchId=A',
        }),
      ]),
    });

    expect(prisma.matchControlState.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { matchId: 'A', version: 4 },
        data: expect.objectContaining({
          metaJson: expect.objectContaining({
            resultFinalized: true,
            finalizedAt: '2026-03-18T10:10:00.000Z',
            postMatchWidgets: expect.arrayContaining([
              expect.objectContaining({
                name: 'Match Results',
                obsUrl: '/widgets/test-org/match-results?matchId=A',
              }),
            ]),
          }),
          updatedAt: expect.any(Date),
        }),
      }),
    );
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
        matchSlots: [{ id: 'slot-c', teamId: 'team-c' }],
      },
      {
        ...baseMatch,
        id: 'B',
        name: 'Match 3',
        matchNumber: 3,
        scheduledAt: new Date('2026-03-18T11:00:00.000Z'),
        createdAt: new Date('2026-03-18T08:00:00.000Z'),
        matchSlots: [{ id: 'slot-b', teamId: 'team-b' }],
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
        matchSlots: [{ id: 'slot-c', teamId: 'team-c' }],
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
    expect(liveStateMirror.publish).not.toHaveBeenCalled();
  });

  it('dedupes persisted telemetry players before rebuilding live control state', async () => {
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
          kills: 3,
          metadata: {
            playerName: 'Alpha 1',
            slotPlayerResultId: 'player-result-1',
            externalPlayerId: 'provider-player-1',
            observedInTelemetry: true,
          },
        },
        'provider-player-1': {
          playerId: 'provider-player-1',
          teamId: 'team-a',
          alive: true,
          knocked: false,
          kills: 0,
          metadata: {
            playerName: 'Alpha 1',
            externalPlayerId: 'provider-player-1',
            provisional: true,
          },
        },
      },
      teams: {
        'team-a': {
          teamId: 'team-a',
          alivePlayers: 2,
          eliminated: false,
          placement: 1,
          totalKills: 0,
          totalPlayers: 2,
          eliminatedAt: null,
          metadata: {
            teamName: 'Alpha',
            teamTag: 'A',
            slot: 1,
            totalPlayers: 1,
            observedInTelemetry: true,
            wasPresentInMatch: true,
          },
        },
      },
      circle: null,
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
      summary: {
        totalTeams: 1,
        aliveTeams: 1,
        totalPlayers: 1,
        alivePlayers: 1,
      },
      teams: [
        expect.objectContaining({
          teamId: 'team-a',
          kills: 3,
          alivePlayers: 1,
          totalPlayers: 1,
          hasTelemetryPresence: true,
          players: [
            expect.objectContaining({
              playerId: 'player-1',
              kills: 3,
              lifeTelemetryFresh: true,
            }),
          ],
        }),
      ],
    });
  });

  it('preserves persisted telemetry summary for live control when cached mirror rows are broader than the live packet', async () => {
    (store.get as jest.Mock).mockResolvedValueOnce({
      matchId: 'A',
      status: 'LIVE',
      startedAt: '2026-04-01T00:10:00.000Z',
      endedAt: null,
      version: 1,
      updatedAt: '2026-04-01T00:11:00.000Z',
      summary: {
        totalTeams: 3,
        aliveTeams: 3,
        totalPlayers: 12,
        alivePlayers: 12,
        winnerTeamId: null,
        winnerSlot: null,
      },
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
          alivePlayers: 4,
          totalPlayers: 4,
          alive: true,
          eliminated: false,
          players: [],
          hasTelemetryPresence: true,
        },
        {
          teamId: 'team-b',
          name: 'Bravo',
          tag: 'B',
          slot: 2,
          kills: 0,
          placement: null,
          points: null,
          logoUrl: null,
          alivePlayers: 4,
          totalPlayers: 4,
          alive: true,
          eliminated: false,
          players: [],
          hasTelemetryPresence: true,
        },
        {
          teamId: 'team-c',
          name: 'Charlie',
          tag: 'C',
          slot: 3,
          kills: 0,
          placement: null,
          points: null,
          logoUrl: null,
          alivePlayers: 4,
          totalPlayers: 4,
          alive: true,
          eliminated: false,
          players: [],
          hasTelemetryPresence: false,
        },
      ],
      circle: {
        phase: 0,
      },
      killFeed: [],
      events: [],
    } satisfies LiveMatchState);

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
      teamsAlive: 2,
      players: {},
      teams: {
        'team-a': {
          teamId: 'team-a',
          alivePlayers: 1,
          eliminated: false,
          placement: null,
          totalKills: 0,
          totalPlayers: 1,
          eliminatedAt: null,
          metadata: {
            teamName: 'Alpha',
            teamTag: 'A',
            slot: 1,
            totalPlayers: 4,
            observedInTelemetry: true,
            telemetryAlivePlayers: 4,
            telemetryTotalPlayers: 4,
            telemetryLastSeenAt: Date.parse('2026-04-01T00:20:00.000Z'),
          },
        },
        'team-b': {
          teamId: 'team-b',
          alivePlayers: 1,
          eliminated: false,
          placement: null,
          totalKills: 1,
          totalPlayers: 1,
          eliminatedAt: null,
          metadata: {
            teamName: 'Bravo',
            teamTag: 'B',
            slot: 2,
            totalPlayers: 4,
            observedInTelemetry: true,
            telemetryAlivePlayers: 3,
            telemetryTotalPlayers: 4,
            telemetryKills: 1,
            telemetryLastSeenAt: Date.parse('2026-04-01T00:20:00.000Z'),
          },
        },
        'team-c': {
          teamId: 'team-c',
          alivePlayers: 4,
          eliminated: false,
          placement: null,
          totalKills: 0,
          totalPlayers: 4,
          eliminatedAt: null,
          metadata: {
            teamName: 'Charlie',
            teamTag: 'C',
            slot: 3,
            totalPlayers: 4,
          },
        },
      },
      circle: {
        phase: 0,
      },
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
      { teamId: 'team-b', team: { name: 'Bravo', tag: 'B', logoUrl: null } },
      { teamId: 'team-c', team: { name: 'Charlie', tag: 'C', logoUrl: null } },
    ]);
    prisma.matchSlot.findMany.mockResolvedValue([
      { teamId: 'team-a', slotNumber: 1 },
      { teamId: 'team-b', slotNumber: 2 },
      { teamId: 'team-c', slotNumber: 3 },
    ]);
    prisma.matchSlotResult.findMany.mockResolvedValue([
      {
        teamId: 'team-a',
        totalKills: 0,
        placement: null,
        totalPoints: 0,
        slotNumber: 1,
      },
      {
        teamId: 'team-b',
        totalKills: 1,
        placement: null,
        totalPoints: 0,
        slotNumber: 2,
      },
      {
        teamId: 'team-c',
        totalKills: 0,
        placement: null,
        totalPoints: 0,
        slotNumber: 3,
      },
    ]);

    await expect(service.getState(actor, 'A')).resolves.toMatchObject({
      summary: {
        totalTeams: 2,
        aliveTeams: 2,
        totalPlayers: 8,
        alivePlayers: 7,
      },
      teams: expect.arrayContaining([
        expect.objectContaining({
          teamId: 'team-c',
          alivePlayers: 0,
          totalPlayers: 0,
        }),
      ]),
    });
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
    expect(liveStateMirror.publish).not.toHaveBeenCalled();
  });

  it('rehydrates persisted telemetry team aggregates even when player rows are missing', async () => {
    const persistedTelemetry = {
      matchId: 'A',
      status: 'LIVE',
      mode: 'AUTO',
      version: 8,
      sequence: 11,
      updatedAt: Date.parse('2026-04-01T00:25:00.000Z'),
      telemetryAcceptedAt: Date.parse('2026-04-01T00:25:00.000Z'),
      startedAt: Date.parse('2026-04-01T00:10:00.000Z'),
      endedAt: null,
      teamsAlive: 1,
      players: {},
      teams: {
        'team-a': {
          teamId: 'team-a',
          alivePlayers: 3,
          eliminated: false,
          placement: null,
          totalKills: 4,
          totalPlayers: 4,
          eliminatedAt: null,
          metadata: {
            teamName: 'Alpha',
            teamTag: 'A',
            slot: 1,
            observedInTelemetry: true,
          },
        },
        'team-b': {
          teamId: 'team-b',
          alivePlayers: 0,
          eliminated: true,
          placement: 2,
          totalKills: 1,
          totalPlayers: 4,
          eliminatedAt: Date.parse('2026-04-01T00:24:30.000Z'),
          metadata: {
            teamName: 'Bravo',
            teamTag: 'B',
            slot: 2,
            observedInTelemetry: true,
          },
        },
      },
      circle: { phase: 2 },
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
      { teamId: 'team-b', team: { name: 'Bravo', tag: 'B', logoUrl: null } },
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
      {
        teamId: 'team-b',
        totalKills: 0,
        placement: null,
        totalPoints: 0,
        slotNumber: 2,
      },
    ]);

    await expect(service.getState(actor, 'A')).resolves.toMatchObject({
      matchId: 'A',
      status: 'LIVE',
      summary: {
        totalTeams: 2,
        aliveTeams: 1,
        totalPlayers: 8,
        alivePlayers: 3,
      },
      teams: [
        expect.objectContaining({
          teamId: 'team-a',
          alivePlayers: 3,
          totalPlayers: 4,
          kills: 4,
          hasTelemetryPresence: true,
          players: [],
        }),
        expect.objectContaining({
          teamId: 'team-b',
          alivePlayers: 0,
          totalPlayers: 4,
          kills: 1,
          hasTelemetryPresence: true,
          players: [],
        }),
      ],
      circle: expect.objectContaining({ phase: 2 }),
    });
    expect(liveStateMirror.publish).not.toHaveBeenCalled();
  });

  it('rehydrates persisted telemetry when cached live state only contains roster players', async () => {
    (store.get as jest.Mock).mockResolvedValueOnce({
      matchId: 'A',
      status: 'LIVE',
      startedAt: '2026-04-01T00:10:00.000Z',
      endedAt: null,
      version: 2,
      updatedAt: '2026-04-01T00:12:00.000Z',
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
          name: 'Alpha',
          tag: 'A',
          slot: 1,
          kills: 0,
          placement: null,
          points: null,
          logoUrl: null,
          alivePlayers: 4,
          totalPlayers: 4,
          players: [
            {
              id: 'slot-player-1',
              playerId: 'player-1',
              name: 'Alpha 1',
              ign: 'Alpha 1',
              alive: true,
              knocked: false,
              kills: 0,
            },
          ],
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
            telemetryUpdatedAt: Date.parse('2026-04-01T00:22:00.000Z'),
          },
        },
      })
      .mockResolvedValueOnce({
        status: MatchStatus.LIVE,
        controlState: {
          state: 'LIVE',
          metaJson: {
            telemetryUpdatedAt: Date.parse('2026-04-01T00:22:00.000Z'),
          },
        },
        stateSnapshot: {
          stateJson: {
            matchId: 'A',
            status: 'LIVE',
            mode: 'AUTO',
            version: 9,
            sequence: 13,
            updatedAt: Date.parse('2026-04-01T00:22:00.000Z'),
            telemetryAcceptedAt: Date.parse('2026-04-01T00:22:00.000Z'),
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
            circle: { phase: 3 },
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
        alivePlayers: 1,
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
              kills: 3,
            }),
          ],
        }),
      ],
      circle: expect.objectContaining({ phase: 3 }),
    });
    expect(liveStateMirror.publish).not.toHaveBeenCalled();
  });

  it('preserves telemetry-observed team counts when refreshing cached live state metadata', async () => {
    (store.get as jest.Mock).mockResolvedValueOnce({
      matchId: 'A',
      status: 'LIVE',
      sourceMode: 'TELEMETRY',
      startedAt: '2026-04-01T00:10:00.000Z',
      endedAt: null,
      version: 5,
      updatedAt: '2026-04-01T00:21:00.000Z',
      summary: {
        totalTeams: 2,
        aliveTeams: 2,
        totalPlayers: 6,
        alivePlayers: 3,
        winnerTeamId: null,
        winnerSlot: null,
      },
      teams: [
        {
          teamId: 'team-a',
          name: 'Alpha',
          tag: 'A',
          slot: 1,
          kills: 2,
          placement: null,
          points: null,
          logoUrl: null,
          hasTelemetryPresence: true,
          alivePlayers: 2,
          totalPlayers: 4,
          alive: true,
          eliminated: false,
          players: [
            {
              playerId: 'player-a1',
              teamId: 'team-a',
              alive: true,
              knocked: false,
              kills: 1,
            },
          ],
        },
        {
          teamId: 'provisional:team:shadow',
          name: 'Shadow',
          tag: 'S',
          slot: 22,
          kills: 3,
          placement: null,
          points: null,
          logoUrl: null,
          hasTelemetryPresence: true,
          alivePlayers: 1,
          totalPlayers: 2,
          alive: true,
          eliminated: false,
          players: [
            {
              playerId: 'player-s1',
              teamId: 'provisional:team:shadow',
              alive: true,
              knocked: false,
              kills: 2,
            },
          ],
        },
      ],
    } satisfies LiveMatchState);

    prisma.match.findFirst.mockResolvedValue({
      ...baseMatch,
      status: MatchStatus.LIVE,
      startedAt: new Date('2026-04-01T00:10:00.000Z'),
      liveAt: new Date('2026-04-01T00:10:00.000Z'),
      controlState: { state: 'LIVE', metaJson: null },
    });
    prisma.matchTeam.findMany.mockResolvedValue([
      {
        teamId: 'team-a',
        team: { name: 'Alpha', tag: 'A', logoUrl: '/logo-a.png' },
      },
      { teamId: 'team-b', team: { name: 'Bravo', tag: 'B', logoUrl: null } },
      { teamId: 'team-c', team: { name: 'Charlie', tag: 'C', logoUrl: null } },
    ]);
    prisma.matchSlot.findMany.mockResolvedValue([
      {
        teamId: 'team-a',
        slotNumber: 1,
        team: { name: 'Alpha', tag: 'A', logoUrl: '/logo-a.png', players: [] },
      },
      {
        teamId: 'team-b',
        slotNumber: 2,
        team: { name: 'Bravo', tag: 'B', logoUrl: null, players: [] },
      },
      {
        teamId: 'team-c',
        slotNumber: 3,
        team: { name: 'Charlie', tag: 'C', logoUrl: null, players: [] },
      },
    ]);
    prisma.matchSlotResult.findMany.mockResolvedValue([
      {
        teamId: 'team-a',
        slotNumber: 1,
        totalKills: 0,
        placement: null,
        totalPoints: 0,
      },
      {
        teamId: 'team-b',
        slotNumber: 2,
        totalKills: 0,
        placement: null,
        totalPoints: 0,
      },
      {
        teamId: 'team-c',
        slotNumber: 3,
        totalKills: 0,
        placement: null,
        totalPoints: 0,
      },
    ]);

    await expect(service.getState(actor, 'A')).resolves.toMatchObject({
      summary: {
        totalTeams: 2,
        aliveTeams: 2,
        totalPlayers: 6,
        alivePlayers: 3,
      },
      teams: [
        expect.objectContaining({
          teamId: 'team-a',
          logoUrl: '/logo-a.png',
        }),
        expect.objectContaining({
          teamId: 'provisional:team:shadow',
        }),
      ],
    });

    expect(liveStateMirror.publish).not.toHaveBeenCalled();
  });
});
