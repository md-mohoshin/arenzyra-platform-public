import { MatchControlService } from './match-control.service';
import { LiveState, MatchStatus } from '@prisma/client';
import type { LiveMatchState, MatchControlStateStore } from './state.store';
import type { PrismaService } from '../../db/prisma.service';
import type { MatchControlGateway } from './match-control.gateway';
import type { MatchStateService } from './match-state.service';
import type { ScoreboardService } from '../scoreboard/scoreboard.service';
import type { MatchesService, Actor } from '../matches/matches.service';
import type { ScoringService } from '../scoring/scoring.service';
import type { AuditService } from '../audit/audit.service';
import type { ResultsService } from '../results/results.service';
import type { ResultsEventsService } from '../results/results-events.service';
import type { RealtimeGateway } from '../../realtime/realtime.gateway';
import type { RankingEmitterService } from '../../realtime/ranking-emitter.service';
import type { BroadcastService } from '../broadcast/broadcast.service';

describe('MatchControlService stale live start conflicts', () => {
  const actor: Actor = {
    id: 'user-1',
    actorId: 'user-1',
    role: 'SUPER_ADMIN',
    actorRole: 'SUPER_ADMIN',
    organizationId: null,
    actingOrgId: null,
  };

  const createService = () => {
    const prisma = {
      match: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        update: jest.fn().mockResolvedValue({}),
        groupBy: jest.fn().mockResolvedValue([]),
      },
      matchControlState: {
        findUnique: jest.fn().mockResolvedValue({
          matchId: 'A',
          state: 'READY',
          version: 0,
          metaJson: null,
        }),
        create: jest.fn().mockResolvedValue({
          matchId: 'A',
          state: 'READY',
          version: 1,
          metaJson: null,
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        upsert: jest.fn().mockResolvedValue(undefined),
      },
      matchStateSnapshot: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      matchTelemetry: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      telemetryEventLog: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      matchTeam: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      matchSlot: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      matchSlotResult: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        upsert: jest.fn().mockResolvedValue({}),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      matchSlotPlayerResult: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        upsert: jest.fn().mockResolvedValue({}),
      },
      matchStanding: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        upsert: jest.fn().mockResolvedValue({}),
      },
      $transaction: jest.fn(async (arg: any) =>
        Array.isArray(arg) ? Promise.all(arg) : arg(prisma),
      ),
    };

    const store: Pick<MatchControlStateStore, 'save' | 'get' | 'evictMatches'> =
      {
        save: jest.fn(async (_matchId, state: LiveMatchState) => state),
        get: jest.fn(async () => null),
        evictMatches: jest.fn(async () => undefined),
      };

    const gateway = {
      emitMatchState: jest.fn(),
      emitMatchEnd: jest.fn(),
      emitMatchAutoEnd: jest.fn(),
      emitMatchStateChanged: jest.fn(),
      emitLiveStateUpdates: jest.fn(),
      emitSlotsAssigned: jest.fn(),
    };
    const scoring = {
      recomputeTournament: jest.fn(),
      recomputeMatchAndTournament: jest.fn(async () => undefined),
    };
    const matchState = {
      mapControlToBusinessStatus: jest.fn((value: string) => {
        if (value === 'LIVE' || value === 'PAUSED') {
          return MatchStatus.LIVE;
        }
        if (value === 'ENDED') {
          return MatchStatus.ENDED;
        }
        return MatchStatus.DRAFT;
      }),
    };
    const scoreboard = { broadcast: jest.fn(async () => undefined) };
    const matchesService = {
      validatePubgSlots: jest.fn(async () => undefined),
      syncLiveHierarchy: jest.fn(async () => []),
      assignSlotsIfMissing: jest.fn(async () => []),
    };
    const audit = { log: jest.fn(async () => undefined) };
    const resultsService = {
      ensureResultsFromSlots: jest.fn(async () => undefined),
      resetLiveProjection: jest.fn(async () => undefined),
      recalculateMatchResults: jest.fn(async () => undefined),
    };
    const resultsEvents: ResultsEventsService = {
      emitResultsLockState: jest.fn(),
      emitResultsUpdated: jest.fn(),
      emitLeaderboardUpdated: jest.fn(),
      emitOverlayPayload: jest.fn(),
      emitMatchUpdate: jest.fn(),
      emitControlContractUpdated: jest.fn(),
    } as unknown as ResultsEventsService;
    const broadcast = { emitForMatch: jest.fn() };
    const realtime = { emitMatchStatusUpdated: jest.fn() };
    const rankingEmitter = {
      emitLiveRanking: jest.fn(),
      emitOverallRanking: jest.fn(),
    };
    const conclusion = {
      conclude: jest.fn(async () => undefined),
      computeFinalResults: jest.fn(),
      buildObserverMatchFinishedPayload: jest.fn(async () => null),
    };
    const liveStateMirror = {
      publish: jest.fn(async (state: LiveMatchState) => state),
      lockCanonicalRoster: jest.fn(),
    };

    const service = new MatchControlService(
      prisma as unknown as PrismaService,
      scoring as unknown as ScoringService,
      store as unknown as MatchControlStateStore,
      gateway as unknown as MatchControlGateway,
      matchState as unknown as MatchStateService,
      scoreboard as unknown as ScoreboardService,
      matchesService as unknown as MatchesService,
      audit as unknown as AuditService,
      resultsService as unknown as ResultsService,
      resultsEvents,
      broadcast as unknown as BroadcastService,
      realtime as unknown as RealtimeGateway,
      rankingEmitter as unknown as RankingEmitterService,
      conclusion as any,
      liveStateMirror as any,
    );

    return {
      service,
      prisma,
      store,
      gateway,
      resultsService,
      resultsEvents,
    };
  };

  const baseMatch = {
    id: 'A',
    name: 'Match A',
    groupId: 'G',
    stageId: 'S',
    tournamentId: 'T',
    status: MatchStatus.DRAFT,
    liveState: LiveState.UPCOMING,
    liveAt: null,
    startedAt: null,
    endedAt: null,
    updatedAt: new Date('2026-04-18T22:00:00.000Z'),
    createdAt: new Date('2026-04-18T21:00:00.000Z'),
    tournament: { ownerUserId: 'user-1', organizationId: 'org-1' },
    controlState: { state: 'READY', version: 0, metaJson: null },
  };

  const buildLiveState = (
    matchId: string,
    aliveTeams: number,
  ): LiveMatchState => ({
    matchId,
    status: 'LIVE',
    startedAt: new Date('2026-04-18T22:00:00.000Z').toISOString(),
    endedAt: null,
    version: 1,
    updatedAt: new Date('2026-04-18T22:05:00.000Z').toISOString(),
    summary: {
      totalTeams: 16,
      aliveTeams,
      totalPlayers: 64,
      alivePlayers: aliveTeams > 0 ? aliveTeams * 4 : 0,
      winnerTeamId: null,
      winnerSlot: null,
    },
    teams: [],
  });

  it('allows start when the only scope conflict is a stale live match with zero alive teams', async () => {
    const { service, prisma, store, gateway, resultsService } = createService();

    let started = false;
    const liveMatchA = {
      ...baseMatch,
      status: MatchStatus.LIVE,
      liveState: LiveState.LIVE,
      startedAt: new Date('2026-04-18T22:10:00.000Z'),
      liveAt: new Date('2026-04-18T22:10:00.000Z'),
      controlState: { state: 'LIVE', version: 1, metaJson: null },
    };
    const liveMatchB = {
      ...baseMatch,
      id: 'B',
      name: 'Match B',
      status: MatchStatus.LIVE,
      liveState: LiveState.LIVE,
      startedAt: new Date('2026-04-18T22:00:00.000Z'),
      liveAt: new Date('2026-04-18T22:00:00.000Z'),
      controlState: { state: 'LIVE', version: 1, metaJson: null },
    };
    prisma.match.findFirst.mockImplementation(async ({ where }: any) => {
      if (where?.id === 'A') {
        return started ? liveMatchA : baseMatch;
      }
      if (where?.id === 'B') {
        return liveMatchB;
      }
      return null;
    });
    prisma.match.update.mockImplementation(async ({ where }: any) => {
      if (where?.id === 'A') {
        started = true;
      }
      return {};
    });
    prisma.match.findMany.mockResolvedValueOnce([{ id: 'B' }]);
    prisma.match.findMany.mockResolvedValueOnce([]);
    prisma.match.findMany.mockResolvedValueOnce([]);
    (store.get as jest.Mock).mockImplementation(async (matchId: string) =>
      matchId === 'B' ? buildLiveState('B', 0) : null,
    );

    await expect(service.startMatch(actor, 'A')).resolves.toMatchObject({
      matchId: 'A',
      status: 'LIVE',
    });

    expect(prisma.match.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'A' },
        data: expect.objectContaining({
          status: MatchStatus.LIVE,
          liveState: LiveState.LIVE,
        }),
      }),
    );
    expect(resultsService.resetLiveProjection).toHaveBeenCalled();
    expect(gateway.emitMatchState).toHaveBeenCalled();
  });

  it('auto-ends a conflicting live match even when alive teams are unknown', async () => {
    const { service, prisma, store } = createService();

    let started = false;
    const liveMatchA = {
      ...baseMatch,
      status: MatchStatus.LIVE,
      liveState: LiveState.LIVE,
      startedAt: new Date('2026-04-18T22:10:00.000Z'),
      liveAt: new Date('2026-04-18T22:10:00.000Z'),
      controlState: { state: 'LIVE', version: 1, metaJson: null },
    };
    const liveMatchB = {
      ...baseMatch,
      id: 'B',
      name: 'Match B',
      status: MatchStatus.LIVE,
      liveState: LiveState.LIVE,
      startedAt: new Date('2026-04-18T22:00:00.000Z'),
      liveAt: new Date('2026-04-18T22:00:00.000Z'),
      controlState: { state: 'LIVE', version: 1, metaJson: null },
    };
    prisma.match.findFirst.mockImplementation(async ({ where }: any) => {
      if (where?.id === 'A') {
        return started ? liveMatchA : baseMatch;
      }
      if (where?.id === 'B') {
        return liveMatchB;
      }
      return null;
    });
    prisma.match.update.mockImplementation(async ({ where }: any) => {
      if (where?.id === 'A') {
        started = true;
      }
      return {};
    });
    prisma.match.findMany.mockResolvedValueOnce([{ id: 'B' }]);
    prisma.match.findMany.mockResolvedValueOnce([]);
    prisma.match.findMany.mockResolvedValueOnce([]);
    prisma.matchSlotResult.findMany.mockResolvedValue([]);
    (store.get as jest.Mock).mockResolvedValue(null);

    await expect(service.startMatch(actor, 'A')).resolves.toMatchObject({
      matchId: 'A',
      status: 'LIVE',
    });
    expect(prisma.match.update).toHaveBeenCalled();
    expect(prisma.match.updateMany).toHaveBeenCalled();
  });
});
