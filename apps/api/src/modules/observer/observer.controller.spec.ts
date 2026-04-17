import {
  DataMode,
  LiveState,
  MatchDataSource,
  MatchStatus,
} from '@prisma/client';
import { ObserverController } from './observer.controller';

describe('ObserverController', () => {
  it('returns the next eligible match suggestion', async () => {
    const matchControl = {
      getLifecycleState: jest.fn(),
      detectMatchFinish: jest.fn(),
      resolveNextEligibleMatch: jest.fn().mockResolvedValue({
        currentMatchId: 'match-1',
        currentStatus: 'FINISHED',
        currentIsFinished: true,
        isAfterFinished: true,
        nextMatch: {
          id: 'match-2',
          name: 'Match 2',
          matchNumber: 2,
          status: 'READY',
          tournamentId: 't-1',
          stageId: 's-1',
          groupId: 'g-1',
        },
      }),
    } as any;
    const controller = new ObserverController(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      matchControl,
    );

    await expect(controller.nextMatch('match-1')).resolves.toEqual({
      currentMatchId: 'match-1',
      currentStatus: 'FINISHED',
      currentIsFinished: true,
      isAfterFinished: true,
      nextMatch: {
        id: 'match-2',
        name: 'Match 2',
        matchNumber: 2,
        status: 'READY',
        tournamentId: 't-1',
        stageId: 's-1',
        groupId: 'g-1',
      },
    });
    expect(matchControl.resolveNextEligibleMatch).toHaveBeenCalledWith(
      'match-1',
      {
        suggestedMatchId: null,
      },
    );
  });

  it('binds the first telemetry session when a live match has no pcobSessionId', async () => {
    const adapterTelemetry = {
      ingestEnvelope: jest.fn().mockResolvedValue({
        ok: true,
        handled: true,
      }),
    } as any;
    const prisma = {
      match: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'match-1',
          organizationId: 'org-1',
          deletedAt: null,
          status: MatchStatus.LIVE,
          liveState: LiveState.LIVE,
          telemetrySource: 'AUTO',
          telemetrySourceLockedAt: null,
          pcobSessionId: null,
          adapterKey: null,
          pcobMode: false,
          dataMode: DataMode.MANUAL,
          dataSource: MatchDataSource.MANUAL,
          controlState: {
            state: 'LIVE',
            metaJson: null,
            organizationId: 'org-1',
          },
          tournament: { organizationId: 'org-1' },
        }),
        updateMany: jest
          .fn()
          .mockResolvedValueOnce({ count: 1 })
          .mockResolvedValueOnce({ count: 1 }),
      },
      matchControlState: {
        upsert: jest.fn().mockResolvedValue(undefined),
      },
    } as any;

    const controller = new ObserverController(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      prisma,
      {
        getLifecycleState: jest.fn().mockResolvedValue({
          matchId: 'match-1',
          status: 'LIVE',
          controlStatus: 'LIVE',
          liveState: LiveState.LIVE,
          startedAt: null,
          endedAt: null,
          updatedAt: new Date().toISOString(),
          isLocked: false,
          isFinalizing: false,
          finalizationStartedAt: null,
          finalizationDurationMs: null,
        }),
        detectMatchFinish: jest.fn(),
      } as any,
      adapterTelemetry,
    );

    const payload = {
      matchId: 'match-1',
      sessionId: 'session-1',
      players: [{ playerName: 'Player 1' }],
      teams: [{ teamNo: 1 }],
      kills: [],
    } as any;

    await expect(controller.ingestTelemetry(payload)).resolves.toEqual({
      ok: true,
      queued: true,
      matchId: 'match-1',
      receivedAt: expect.any(String),
    });

    expect(prisma.match.updateMany).toHaveBeenNthCalledWith(1, {
      where: {
        id: 'match-1',
        deletedAt: null,
        OR: [{ pcobSessionId: null }, { pcobSessionId: '' }],
      },
      data: {
        pcobSessionId: 'session-1',
        pcobBoundAt: expect.any(Date),
        pcobMode: true,
        dataMode: DataMode.PCOB,
        dataSource: MatchDataSource.PCOB,
        adapterKey: 'pubgm-pcob',
      },
    });
    expect(prisma.match.updateMany).toHaveBeenNthCalledWith(2, {
      where: {
        id: 'match-1',
        deletedAt: null,
        telemetrySource: 'AUTO',
      },
      data: {
        telemetrySource: 'LAUNCHER',
        telemetrySourceLockedAt: expect.any(Date),
      },
    });
    expect(prisma.matchControlState.upsert).toHaveBeenCalledWith({
      where: { matchId: 'match-1' },
      update: {
        metaJson: expect.objectContaining({
          telemetrySource: 'LAUNCHER',
        }),
      },
      create: expect.objectContaining({
        matchId: 'match-1',
        organizationId: 'org-1',
        metaJson: expect.objectContaining({
          telemetrySource: 'LAUNCHER',
        }),
      }),
    });
    expect(adapterTelemetry.ingestEnvelope).toHaveBeenCalledWith(
      'match-1',
      {
        matchId: 'match-1',
        sessionId: 'session-1',
        sequence: null,
        timestamp: null,
        players: [{ playerName: 'Player 1' }],
        teams: [{ teamNo: 1 }],
        zone: null,
        events: [],
      },
      {
        sourceOverride: 'LAUNCHER',
      },
    );
  });

  it('drops telemetry payloads with forbidden lifecycle fields before adapter ingestion', async () => {
    const adapterTelemetry = {
      ingestEnvelope: jest.fn(),
    } as any;
    const controller = new ObserverController(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {
        match: {
          findUnique: jest.fn(),
        },
      } as any,
      {
        getLifecycleState: jest.fn(),
        detectMatchFinish: jest.fn(),
      } as any,
      adapterTelemetry,
    );

    await expect(
      controller.ingestTelemetry({
        matchId: 'match-1',
        sessionId: 'session-1',
        isFinished: true,
        players: [],
        teams: [],
      } as any),
    ).resolves.toEqual({
      ok: true,
      ignored: true,
      reason: 'FORBIDDEN_FIELDS',
      matchId: 'match-1',
    });

    expect(adapterTelemetry.ingestEnvelope).not.toHaveBeenCalled();
  });

  it('sanitizes stale derived observer fields before adapter ingestion', async () => {
    const adapterTelemetry = {
      ingestEnvelope: jest.fn().mockResolvedValue({
        ok: true,
        handled: true,
      }),
    } as any;
    const prisma = {
      match: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'match-7',
          organizationId: null,
          deletedAt: null,
          status: MatchStatus.LIVE,
          liveState: LiveState.LIVE,
          telemetrySource: 'LAUNCHER',
          telemetrySourceLockedAt: new Date('2026-04-04T18:00:00.000Z'),
          pcobSessionId: 'session-7',
          adapterKey: 'pubgm-pcob',
          pcobMode: true,
          dataMode: DataMode.PCOB,
          dataSource: MatchDataSource.PCOB,
          controlState: {
            state: 'LIVE',
            metaJson: { telemetrySource: 'LAUNCHER' },
            organizationId: 'org-1',
          },
          tournament: { organizationId: 'org-1' },
        }),
      },
    } as any;

    const controller = new ObserverController(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      prisma,
      {
        getLifecycleState: jest.fn(),
        detectMatchFinish: jest.fn(),
      } as any,
      adapterTelemetry,
    );

    await expect(
      controller.ingestTelemetry({
        matchId: 'match-7',
        sessionId: 'session-7',
        aliveTeams: 18,
        players: [{ playerName: 'Player 1', rank: 12, kills: 3 }],
        teams: [{ teamNo: 1 }],
        kills: [],
      } as any),
    ).resolves.toEqual({
      ok: true,
      queued: true,
      matchId: 'match-7',
      receivedAt: expect.any(String),
    });

    expect(adapterTelemetry.ingestEnvelope).toHaveBeenCalledWith(
      'match-7',
      {
        matchId: 'match-7',
        sessionId: 'session-7',
        sequence: null,
        timestamp: null,
        players: [{ playerName: 'Player 1', kills: 3 }],
        teams: [{ teamNo: 1 }],
        zone: null,
        events: [],
      },
      {
        sourceOverride: 'LAUNCHER',
      },
    );
  });

  it('still drops telemetry payloads with nested placement fields before adapter ingestion', async () => {
    const adapterTelemetry = {
      ingestEnvelope: jest.fn(),
    } as any;
    const controller = new ObserverController(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {
        match: {
          findUnique: jest.fn(),
        },
      } as any,
      {
        getLifecycleState: jest.fn(),
        detectMatchFinish: jest.fn(),
      } as any,
      adapterTelemetry,
    );

    await expect(
      controller.ingestTelemetry({
        matchId: 'match-1',
        sessionId: 'session-1',
        players: [{ playerName: 'Player 1', placement: 1 }],
        teams: [],
      } as any),
    ).resolves.toEqual({
      ok: true,
      ignored: true,
      reason: 'FORBIDDEN_FIELDS',
      matchId: 'match-1',
    });

    expect(adapterTelemetry.ingestEnvelope).not.toHaveBeenCalled();
  });

  it('returns finalization timing when telemetry is ignored for a finalizing match', async () => {
    const finalizationStartedAt = '2026-03-18T10:00:00.000Z';
    const prisma = {
      match: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'match-2',
          deletedAt: null,
          status: MatchStatus.FINISH_PENDING,
          liveState: LiveState.LIVE,
          pcobSessionId: 'session-2',
        }),
      },
    } as any;

    const controller = new ObserverController(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      prisma,
      {
        getLifecycleState: jest.fn().mockResolvedValue({
          matchId: 'match-2',
          status: 'FINISH_PENDING',
          controlStatus: 'LIVE',
          liveState: LiveState.LIVE,
          startedAt: null,
          endedAt: null,
          updatedAt: new Date().toISOString(),
          isLocked: false,
          isFinalizing: true,
          finalizationStartedAt,
          finalizationDurationMs: 12_000,
        }),
        detectMatchFinish: jest.fn(),
      } as any,
    );

    await expect(
      controller.ingestTelemetry({
        matchId: 'match-2',
        sessionId: 'session-2',
        players: [],
        teams: [],
        kills: [],
      } as any),
    ).resolves.toEqual({
      ok: true,
      ignored: true,
      reason: 'MATCH_FINALIZING',
      matchId: 'match-2',
      matchStatus: 'FINISH_PENDING',
      isLocked: false,
      isFinalizing: true,
      finalizationStartedAt,
      finalizationDurationMs: 12_000,
    });
  });

  it('still rejects telemetry for truly finished matches', async () => {
    const prisma = {
      match: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'match-4',
          deletedAt: null,
          status: MatchStatus.FINISHED,
          liveState: LiveState.ENDED,
          pcobSessionId: 'session-4',
        }),
      },
    } as any;

    const controller = new ObserverController(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      prisma,
      {
        getLifecycleState: jest.fn().mockResolvedValue({
          matchId: 'match-4',
          status: 'FINISHED',
          controlStatus: 'CONFIRMED',
          liveState: LiveState.ENDED,
          startedAt: null,
          endedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          isLocked: true,
          isFinalizing: false,
          finalizationStartedAt: null,
          finalizationDurationMs: null,
        }),
        detectMatchFinish: jest.fn(),
      } as any,
    );

    await expect(
      controller.ingestTelemetry({
        matchId: 'match-4',
        sessionId: 'session-4',
        players: [],
        teams: [],
        kills: [],
      } as any),
    ).resolves.toEqual({
      ok: true,
      ignored: true,
      reason: 'MATCH_ENDED',
      matchId: 'match-4',
      matchStatus: 'FINISHED',
      isLocked: true,
      isFinalizing: false,
      finalizationStartedAt: null,
      finalizationDurationMs: null,
    });
  });

  it('accepts the first telemetry packet immediately after the match is live', async () => {
    const adapterTelemetry = {
      ingestEnvelope: jest.fn().mockResolvedValue({
        ok: true,
        handled: true,
      }),
    } as any;
    const prisma = {
      match: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'match-3',
          organizationId: 'org-1',
          deletedAt: null,
          status: MatchStatus.LIVE,
          liveState: LiveState.LIVE,
          telemetrySource: 'LAUNCHER',
          telemetrySourceLockedAt: new Date('2026-04-04T18:00:00.000Z'),
          pcobSessionId: 'session-3',
          adapterKey: 'pubgm-pcob',
          pcobMode: true,
          dataMode: DataMode.PCOB,
          dataSource: MatchDataSource.PCOB,
          controlState: {
            state: 'LIVE',
            metaJson: { telemetrySource: 'LAUNCHER' },
            organizationId: 'org-1',
          },
          tournament: { organizationId: 'org-1' },
        }),
      },
    } as any;

    const controller = new ObserverController(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      prisma,
      {
        getLifecycleState: jest.fn(),
        detectMatchFinish: jest.fn(),
      } as any,
      adapterTelemetry,
    );

    await expect(
      controller.ingestTelemetry({
        matchId: 'match-3',
        sessionId: 'session-3',
        players: [],
        teams: [],
        kills: [{ killerId: 'killer-1', victimId: 'victim-1' }],
        circle: { circleIndex: 1 },
      } as any),
    ).resolves.toEqual({
      ok: true,
      queued: true,
      matchId: 'match-3',
      receivedAt: expect.any(String),
    });

    expect(adapterTelemetry.ingestEnvelope).toHaveBeenCalledWith(
      'match-3',
      {
        matchId: 'match-3',
        sessionId: 'session-3',
        sequence: null,
        timestamp: null,
        players: [],
        teams: [],
        kills: [{ killerId: 'killer-1', victimId: 'victim-1' }],
        circle: { circleIndex: 1 },
        circleInfo: { circleIndex: 1 },
        zone: { phase: 1 },
        events: [],
      },
      {
        sourceOverride: 'LAUNCHER',
      },
    );
  });

  it('rejects adapter-forwarded telemetry when the match is not bound to pubgm-pcob', async () => {
    const adapterTelemetry = {
      ingestEnvelope: jest.fn(),
    } as any;
    const prisma = {
      match: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'match-5',
          organizationId: 'org-1',
          deletedAt: null,
          status: MatchStatus.LIVE,
          liveState: LiveState.LIVE,
          telemetrySource: 'LAUNCHER',
          telemetrySourceLockedAt: new Date('2026-04-04T18:00:00.000Z'),
          pcobSessionId: 'session-5',
          adapterKey: 'pubgm-manual',
          pcobMode: true,
          dataMode: DataMode.PCOB,
          dataSource: MatchDataSource.PCOB,
          controlState: {
            state: 'LIVE',
            metaJson: { telemetrySource: 'LAUNCHER' },
            organizationId: 'org-1',
          },
          tournament: { organizationId: 'org-1' },
        }),
      },
    } as any;

    const controller = new ObserverController(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      prisma,
      {
        getLifecycleState: jest.fn(),
        detectMatchFinish: jest.fn(),
      } as any,
      adapterTelemetry,
    );

    await expect(
      controller.ingestTelemetry({
        matchId: 'match-5',
        sessionId: 'session-5',
        players: [],
        teams: [],
        kills: [],
      } as any),
    ).resolves.toEqual({
      ok: true,
      ignored: true,
      reason: 'MATCH_NOT_ADAPTER_BOUND',
      matchId: 'match-5',
    });

    expect(adapterTelemetry.ingestEnvelope).not.toHaveBeenCalled();
  });

  it('ignores launcher telemetry when another telemetry source is already locked', async () => {
    const adapterTelemetry = {
      ingestEnvelope: jest.fn(),
    } as any;
    const prisma = {
      match: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'match-8',
          organizationId: 'org-1',
          deletedAt: null,
          status: MatchStatus.LIVE,
          liveState: LiveState.LIVE,
          telemetrySource: 'PCOB',
          telemetrySourceLockedAt: new Date('2026-04-04T18:00:00.000Z'),
          pcobSessionId: 'session-8',
          adapterKey: 'pubgm-pcob',
          pcobMode: true,
          dataMode: DataMode.PCOB,
          dataSource: MatchDataSource.PCOB,
          controlState: {
            state: 'LIVE',
            metaJson: { telemetrySource: 'PCOB' },
            organizationId: 'org-1',
          },
          tournament: { organizationId: 'org-1' },
        }),
      },
    } as any;

    const controller = new ObserverController(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      prisma,
      {
        getLifecycleState: jest.fn(),
        detectMatchFinish: jest.fn(),
      } as any,
      adapterTelemetry,
    );

    await expect(
      controller.ingestTelemetry({
        matchId: 'match-8',
        sessionId: 'session-8',
        players: [],
        teams: [],
        kills: [],
      } as any),
    ).resolves.toEqual({
      ok: true,
      ignored: true,
      reason: 'SOURCE_MISMATCH',
      matchId: 'match-8',
    });

    expect(adapterTelemetry.ingestEnvelope).not.toHaveBeenCalled();
  });

  it('returns the legacy-disabled response for non-adapter observer telemetry', async () => {
    const prisma = {
      match: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'match-6',
          deletedAt: null,
          status: MatchStatus.LIVE,
          liveState: LiveState.LIVE,
          telemetrySource: 'AUTO',
          telemetrySourceLockedAt: null,
          pcobSessionId: 'session-6',
          adapterKey: null,
          pcobMode: false,
          dataMode: DataMode.MANUAL,
          dataSource: MatchDataSource.MANUAL,
          controlState: {
            state: 'LIVE',
            metaJson: null,
            organizationId: 'org-1',
          },
          tournament: { organizationId: 'org-1' },
        }),
      },
    } as any;

    const controller = new ObserverController(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      prisma,
      {
        getLifecycleState: jest.fn(),
        detectMatchFinish: jest.fn(),
      } as any,
      undefined,
    );

    await expect(
      controller.ingestTelemetry({
        matchId: 'match-6',
        sessionId: 'session-6',
        players: [],
        teams: [],
        kills: [],
      } as any),
    ).resolves.toEqual({
      ok: true,
      ignored: true,
      reason: 'LEGACY_OBSERVER_TELEMETRY_DISABLED',
      matchId: 'match-6',
    });
  });
});
