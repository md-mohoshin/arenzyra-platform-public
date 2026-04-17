import { LiveState, MatchStatus } from '@prisma/client';
import type { PrismaService } from '../../db/prisma.service';
import { MatchConclusionService } from './match-conclusion.service';
import type { ResultsService } from './results.service';
import type { ResultsEventsService } from './results-events.service';
import type { ScoringService } from '../scoring/scoring.service';
import type { PcobGateway } from '../pcob/pcob.gateway';
import type { TopFraggerService } from '../widgets/top-fragger/top-fragger.service';
import type { MvpService } from '../widgets/mvp/mvp.service';
import type { RealtimeGateway } from '../../realtime/realtime.gateway';
import type { TelemetryEngineService } from '../telemetry/telemetry-engine.service';

const createService = (options?: {
  match?: Record<string, unknown> | null;
  telemetryPayload?: Record<string, unknown> | null;
  telemetryState?: Record<string, unknown> | null;
}) => {
  const matchId =
    typeof (options?.match as { id?: unknown } | undefined)?.id === 'string'
      ? ((options?.match as { id: string }).id ?? 'match-1')
      : 'match-1';
  const tx = {
    matchControlState: {
      upsert: jest.fn().mockResolvedValue(undefined),
    },
    match: {
      update: jest.fn().mockResolvedValue(undefined),
    },
  };
  const prisma = {
    match: {
      findFirst: jest.fn().mockResolvedValue(
        options?.match === undefined
          ? {
              id: 'match-1',
              organizationId: 'org-1',
              sessionId: null,
              status: MatchStatus.LIVE,
              liveState: LiveState.LIVE,
              endedAt: null,
              endedReason: null,
              pcobSessionId: null,
              tournament: { organizationId: 'org-1' },
              controlState: { metaJson: null },
            }
          : options.match,
      ),
    },
    matchTelemetry: {
      findUnique: jest.fn().mockResolvedValue({
        payload: options?.telemetryPayload ?? null,
      }),
    },
    $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) =>
      callback(tx),
    ),
  } as unknown as PrismaService;

  const results = {
    ensureResultsFromSlots: jest.fn().mockResolvedValue(undefined),
    applyTelemetryStateToResults: jest.fn().mockResolvedValue(undefined),
    recalculateMatchResults: jest.fn().mockResolvedValue(undefined),
    finalizeMatchResults: jest.fn().mockResolvedValue(undefined),
    assertMatchStateConsistency: jest.fn().mockResolvedValue(undefined),
  } as unknown as ResultsService;
  const resultEvents = {
    emitResultsUpdated: jest.fn(),
    emitLeaderboardUpdated: jest.fn(),
  } as unknown as ResultsEventsService;
  const scoring = {
    recomputeMatchAndTournament: jest.fn(),
  } as unknown as ScoringService;
  const realtime = {
    emitObserverMatchFinished: jest.fn(),
  } as unknown as RealtimeGateway;
  const pcobGateway = {
    emitLastTeamStanding: jest.fn(),
    emitMatchConcluded: jest.fn(),
  } as unknown as PcobGateway;
  const topFragger = {
    finalize: jest.fn().mockResolvedValue(undefined),
  } as unknown as TopFraggerService;
  const mvp = {
    finalize: jest.fn().mockResolvedValue(undefined),
  } as unknown as MvpService;
  const telemetryEngine = {
    getState: jest.fn().mockResolvedValue(
      options?.telemetryState ?? {
        matchId,
        status: 'ENDED',
        mode: 'AUTO',
        version: 1,
        sequence: 1,
        updatedAt: Date.now(),
        startedAt: Date.now() - 10_000,
        endedAt: Date.now(),
        teamsAlive: 1,
        teams: {
          'team-1': {
            teamId: 'team-1',
            alivePlayers: 1,
            eliminated: false,
            placement: 1,
            totalKills: 4,
            totalPlayers: 1,
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
            kills: 4,
            metadata: { playerName: 'Alpha' },
          },
        },
      },
    ),
  } as unknown as TelemetryEngineService;

  return {
    prisma,
    tx,
    results,
    telemetryEngine,
    service: new MatchConclusionService(
      prisma,
      results,
      resultEvents,
      scoring,
      realtime,
      pcobGateway,
      topFragger,
      mvp,
      telemetryEngine,
    ),
    topFragger,
    mvp,
  };
};

describe('MatchConclusionService', () => {
  it('ignores SHADOW_TELEMETRY conclusion for a session-bound PCOB match', async () => {
    const { prisma, service } = createService({
      match: {
        id: 'match-1',
        sessionId: null,
        status: MatchStatus.LIVE,
        liveState: LiveState.LIVE,
        endedAt: null,
        endedReason: null,
        pcobSessionId: 'session-1',
        tournament: { organizationId: 'org-1' },
        controlState: { metaJson: null },
      },
    });

    await expect(
      service.conclude('match-1', {
        winnerTeamId: 'team-1',
        aliveTeams: 1,
        source: 'SHADOW_TELEMETRY',
      }),
    ).resolves.toBe(false);

    expect((prisma as any).matchTelemetry.findUnique).not.toHaveBeenCalled();
    expect((prisma as any).$transaction).not.toHaveBeenCalled();
  });

  it('ignores SHADOW_TELEMETRY conclusion when recent observer telemetry is active', async () => {
    const { prisma, service } = createService({
      telemetryPayload: {
        observerTelemetry: {
          receivedAt: new Date().toISOString(),
        },
      },
    });

    await expect(
      service.conclude('match-1', {
        winnerTeamId: 'team-1',
        aliveTeams: 1,
        source: 'SHADOW_TELEMETRY',
      }),
    ).resolves.toBe(false);

    expect((prisma as any).matchTelemetry.findUnique).toHaveBeenCalledWith({
      where: { matchId: 'match-1' },
      select: { payload: true },
    });
    expect((prisma as any).$transaction).not.toHaveBeenCalled();
  });

  it('uses the direct match organization when concluding a session-linked match', async () => {
    const { service, tx } = createService({
      match: {
        id: 'match-session-1',
        organizationId: 'org-session',
        sessionId: 'session-1',
        status: MatchStatus.LIVE,
        liveState: LiveState.LIVE,
        endedAt: null,
        endedReason: null,
        pcobSessionId: null,
        tournament: null,
        controlState: { metaJson: null },
      },
    });

    jest.spyOn(service as any, 'captureSnapshots').mockResolvedValue(undefined);
    jest
      .spyOn(service as any, 'buildObserverMatchFinishedPayload')
      .mockResolvedValue(null);

    await expect(
      service.conclude('match-session-1', {
        winnerTeamId: 'team-1',
        aliveTeams: 1,
        source: 'AUTO_MATCH_CONCLUDED',
      }),
    ).resolves.toBe(true);

    expect(tx.matchControlState.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          organizationId: 'org-session',
        }),
      }),
    );
  });

  it('concludes a session match without triggering tournament scoring recompute', async () => {
    const { service, tx, results, topFragger, mvp } = createService({
      match: {
        id: 'match-session-1',
        organizationId: 'org-session',
        sessionId: 'session-1',
        status: MatchStatus.LIVE,
        liveState: LiveState.LIVE,
        endedAt: null,
        endedReason: null,
        pcobSessionId: null,
        tournament: null,
        controlState: { metaJson: null },
      },
    });

    jest.spyOn(service as any, 'captureSnapshots').mockResolvedValue(undefined);
    jest
      .spyOn(service as any, 'buildObserverMatchFinishedPayload')
      .mockResolvedValue(null);

    await expect(
      service.conclude('match-session-1', {
        winnerTeamId: 'team-1',
        aliveTeams: 1,
        source: 'AUTO_MATCH_CONCLUDED',
      }),
    ).resolves.toBe(true);

    expect(tx.match.update.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          status: MatchStatus.FINISHED,
          liveState: LiveState.ENDED,
        }),
      }),
    );
    expect(
      (service as any).scoring.recomputeMatchAndTournament as jest.Mock,
    ).not.toHaveBeenCalled();
    expect(
      (service as any).results.ensureResultsFromSlots as jest.Mock,
    ).toHaveBeenCalledWith('match-session-1');
    expect(
      (results as any).applyTelemetryStateToResults as jest.Mock,
    ).toHaveBeenCalledWith(
      'match-session-1',
      expect.objectContaining({
        finalize: true,
      }),
    );
    expect(
      (service as any).results.recalculateMatchResults as jest.Mock,
    ).toHaveBeenCalledWith('match-session-1');
    expect(
      (service as any).results.finalizeMatchResults as jest.Mock,
    ).toHaveBeenCalledWith('match-session-1');
    expect((topFragger as any).finalize as jest.Mock).toHaveBeenCalledWith(
      'match-session-1',
    );
    expect((mvp as any).finalize as jest.Mock).toHaveBeenCalledWith(
      'match-session-1',
    );
  });

  it('promotes a finalizing match to finalized through the canonical conclusion path', async () => {
    const { service, tx } = createService({
      match: {
        id: 'match-finalizing-1',
        organizationId: 'org-1',
        sessionId: null,
        status: MatchStatus.FINISH_PENDING,
        liveState: LiveState.ENDED,
        endedAt: new Date('2026-03-18T12:00:00.000Z'),
        endedReason: 'OBSERVER_FINISH_DETECTED',
        pcobSessionId: null,
        tournament: { organizationId: 'org-1' },
        controlState: {
          metaJson: {
            finalizationStartedAt: '2026-03-18T11:59:40.000Z',
          },
        },
      },
    });

    jest.spyOn(service as any, 'captureSnapshots').mockResolvedValue(undefined);
    jest
      .spyOn(service as any, 'buildObserverMatchFinishedPayload')
      .mockResolvedValue(null);

    await expect(
      service.conclude('match-finalizing-1', {
        source: 'AUTO_MATCH_CONCLUDED',
      }),
    ).resolves.toBe(true);

    expect(tx.matchControlState.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          state: 'CONFIRMED',
          metaJson: expect.objectContaining({
            resultFinalized: true,
            finalizedAt: '2026-03-18T12:00:00.000Z',
          }),
        }),
      }),
    );
    expect(tx.match.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'match-finalizing-1' },
        data: expect.objectContaining({
          status: MatchStatus.FINISHED,
          liveState: LiveState.ENDED,
          endedReason: 'OBSERVER_FINISH_DETECTED',
        }),
      }),
    );
  });

  it('flags multiple surviving teams as requiring confirmation when auto-finalized by kills', async () => {
    const { service, results, tx } = createService({
      telemetryState: {
        matchId: 'match-1',
        status: 'ENDED',
        mode: 'AUTO',
        version: 7,
        sequence: 19,
        updatedAt: 5_000,
        startedAt: 1_000,
        endedAt: 5_000,
        teamsAlive: 2,
        teams: {
          'team-1': {
            teamId: 'team-1',
            alivePlayers: 1,
            eliminated: false,
            placement: null,
            totalKills: 4,
            totalPlayers: 1,
            eliminatedAt: null,
            metadata: { slot: 1 },
          },
          'team-2': {
            teamId: 'team-2',
            alivePlayers: 2,
            eliminated: false,
            placement: null,
            totalKills: 7,
            totalPlayers: 2,
            eliminatedAt: null,
            metadata: { slot: 2 },
          },
          'team-3': {
            teamId: 'team-3',
            alivePlayers: 0,
            eliminated: true,
            placement: 3,
            totalKills: 2,
            totalPlayers: 1,
            eliminatedAt: 3_000,
            metadata: { slot: 3 },
          },
        },
        players: {
          'player-1': {
            playerId: 'player-1',
            teamId: 'team-1',
            alive: true,
            knocked: false,
            kills: 4,
            metadata: { playerName: 'Alpha' },
          },
          'player-2': {
            playerId: 'player-2',
            teamId: 'team-2',
            alive: true,
            knocked: false,
            kills: 5,
            metadata: { playerName: 'Bravo' },
          },
          'player-3': {
            playerId: 'player-3',
            teamId: 'team-2',
            alive: true,
            knocked: false,
            kills: 2,
            metadata: { playerName: 'Charlie' },
          },
          'player-4': {
            playerId: 'player-4',
            teamId: 'team-3',
            alive: false,
            knocked: false,
            kills: 2,
            metadata: { playerName: 'Delta' },
          },
        },
      },
    });

    jest.spyOn(service as any, 'captureSnapshots').mockResolvedValue(undefined);
    jest
      .spyOn(service as any, 'buildObserverMatchFinishedPayload')
      .mockResolvedValue(null);

    await expect(
      service.conclude('match-1', {
        source: 'AUTO_MATCH_CONCLUDED',
      }),
    ).resolves.toBe(true);

    const projection = (
      (results as any).applyTelemetryStateToResults as jest.Mock
    ).mock.calls[0][1].finalProjection;
    expect(projection).toMatchObject({
      totalTeams: 3,
      placementsAssigned: 3,
      winnerTeamId: 'team-2',
      needsConfirmation: true,
      teams: {
        'team-1': { placement: 2 },
        'team-2': { placement: 1 },
        'team-3': { placement: 3 },
      },
    });
    expect(projection.ambiguities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'MULTIPLE_TEAMS_ALIVE_AT_END',
          teamIds: ['team-2', 'team-1'],
          placementFrom: 1,
          placementTo: 2,
        }),
      ]),
    );
    expect(tx.matchControlState.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          metaJson: expect.objectContaining({
            resultNeedsConfirmation: true,
            resultAmbiguities: expect.arrayContaining([
              expect.objectContaining({
                code: 'MULTIPLE_TEAMS_ALIVE_AT_END',
              }),
            ]),
          }),
        }),
      }),
    );
  });

  it('flags simultaneous elimination timestamps as requiring confirmation', async () => {
    const { service, results, tx } = createService({
      telemetryState: {
        matchId: 'match-1',
        status: 'ENDED',
        mode: 'AUTO',
        version: 8,
        sequence: 22,
        updatedAt: 10_000,
        startedAt: 1_000,
        endedAt: 10_000,
        teamsAlive: 1,
        teams: {
          'team-1': {
            teamId: 'team-1',
            alivePlayers: 1,
            eliminated: false,
            placement: 1,
            totalKills: 6,
            totalPlayers: 1,
            eliminatedAt: null,
            metadata: { slot: 1 },
          },
          'team-2': {
            teamId: 'team-2',
            alivePlayers: 0,
            eliminated: true,
            placement: 2,
            totalKills: 2,
            totalPlayers: 1,
            eliminatedAt: 9_000,
            metadata: { slot: 2 },
          },
          'team-3': {
            teamId: 'team-3',
            alivePlayers: 0,
            eliminated: true,
            placement: 3,
            totalKills: 1,
            totalPlayers: 1,
            eliminatedAt: 9_000,
            metadata: { slot: 3 },
          },
        },
        players: {
          'player-1': {
            playerId: 'player-1',
            teamId: 'team-1',
            alive: true,
            knocked: false,
            kills: 6,
            metadata: { playerName: 'Alpha' },
          },
          'player-2': {
            playerId: 'player-2',
            teamId: 'team-2',
            alive: false,
            knocked: false,
            kills: 2,
            metadata: { playerName: 'Bravo' },
          },
          'player-3': {
            playerId: 'player-3',
            teamId: 'team-3',
            alive: false,
            knocked: false,
            kills: 1,
            metadata: { playerName: 'Charlie' },
          },
        },
      },
    });

    jest.spyOn(service as any, 'captureSnapshots').mockResolvedValue(undefined);
    jest
      .spyOn(service as any, 'buildObserverMatchFinishedPayload')
      .mockResolvedValue(null);

    await expect(
      service.conclude('match-1', {
        source: 'AUTO_MATCH_CONCLUDED',
      }),
    ).resolves.toBe(true);

    const projection = (
      (results as any).applyTelemetryStateToResults as jest.Mock
    ).mock.calls[0][1].finalProjection;
    expect(projection.needsConfirmation).toBe(true);
    expect(projection.ambiguities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'SIMULTANEOUS_ELIMINATION',
          teamIds: ['team-2', 'team-3'],
          placementFrom: 2,
          placementTo: 3,
        }),
      ]),
    );
    expect(tx.matchControlState.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          metaJson: expect.objectContaining({
            resultNeedsConfirmation: true,
          }),
        }),
      }),
    );
  });

  it('excludes no-show teams from the final projection when telemetry presence is explicit', async () => {
    const { results, service } = createService({
      telemetryState: {
        matchId: 'match-1',
        status: 'ENDED',
        mode: 'AUTO',
        version: 4,
        sequence: 10,
        updatedAt: 5_000,
        startedAt: 1_000,
        endedAt: 5_000,
        teamsAlive: 1,
        teams: {
          'team-1': {
            teamId: 'team-1',
            alivePlayers: 0,
            eliminated: true,
            placement: 2,
            totalKills: 3,
            totalPlayers: 1,
            eliminatedAt: 4_000,
            metadata: { slot: 1, wasPresentInMatch: true },
          },
          'team-2': {
            teamId: 'team-2',
            alivePlayers: 1,
            eliminated: false,
            placement: 1,
            totalKills: 5,
            totalPlayers: 1,
            eliminatedAt: null,
            metadata: { slot: 2, wasPresentInMatch: true },
          },
          'team-3': {
            teamId: 'team-3',
            alivePlayers: 4,
            eliminated: false,
            placement: null,
            totalKills: 0,
            totalPlayers: 4,
            eliminatedAt: null,
            metadata: { slot: 3 },
          },
        },
        players: {
          'player-1': {
            playerId: 'player-1',
            teamId: 'team-1',
            alive: false,
            knocked: false,
            kills: 3,
            metadata: {
              playerName: 'Alpha',
              observedInTelemetry: true,
            },
          },
          'player-2': {
            playerId: 'player-2',
            teamId: 'team-2',
            alive: true,
            knocked: false,
            kills: 5,
            metadata: {
              playerName: 'Bravo',
              observedInTelemetry: true,
            },
          },
          'player-3': {
            playerId: 'player-3',
            teamId: 'team-3',
            alive: true,
            knocked: false,
            kills: 0,
            metadata: {
              playerName: 'Charlie',
            },
          },
        },
      },
    });

    jest.spyOn(service as any, 'captureSnapshots').mockResolvedValue(undefined);
    jest
      .spyOn(service as any, 'buildObserverMatchFinishedPayload')
      .mockResolvedValue(null);

    await expect(
      service.conclude('match-1', {
        source: 'AUTO_MATCH_CONCLUDED',
      }),
    ).resolves.toBe(true);

    const projection = (
      (results as any).applyTelemetryStateToResults as jest.Mock
    ).mock.calls[0][1].finalProjection;
    expect(projection).toMatchObject({
      totalTeams: 2,
      placementsAssigned: 2,
      winnerTeamId: 'team-2',
      teams: {
        'team-1': { placement: 2 },
        'team-2': { placement: 1 },
      },
    });
    expect(projection.teams['team-3']).toBeUndefined();
  });
});
