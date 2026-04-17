import type { PrismaService } from '../../db/prisma.service';
import { TelemetryIngressService } from './telemetry-ingress.service';

const createEnvelope = (overrides: Record<string, unknown> = {}) => ({
  matchId: 'match-1',
  sessionId: 'session-live',
  sequence: 16,
  timestamp: 1_000,
  players: [],
  teams: [],
  zone: null,
  events: [],
  source: 'PCOB_PUSH',
  raw: null,
  ...overrides,
});

const createEngineState = () => ({
  matchId: 'match-1',
  status: 'LIVE',
  mode: 'AUTO',
  version: 4,
  sequence: 22,
  updatedAt: 1_000,
  telemetryAcceptedAt: 1_000,
  telemetryAcceptedSource: 'PCOB_PUSH',
  startedAt: 900,
  endedAt: null,
  teamsAlive: 0,
  teams: {},
  players: {},
  circle: null,
  killFeed: [],
  events: [],
});

const createLiveMatchState = (matchId = 'match-1') => ({
  matchId,
  status: 'LIVE',
  startedAt: null,
  endedAt: null,
  version: 4,
  updatedAt: new Date(1_000).toISOString(),
  teams: [],
  summary: null,
  circle: null,
  observedPlayer: null,
  killFeed: [],
  events: [],
});

const createMatchRecord = (overrides: Record<string, unknown> = {}) => ({
  id: 'match-1',
  deletedAt: null,
  status: 'LIVE',
  telemetrySource: 'PCOB',
  telemetrySourceLockedAt: new Date('2026-04-04T18:00:00.000Z'),
  pcobSessionId: 'session-live',
  organizationId: 'org-1',
  controlState: {
    state: 'LIVE',
    organizationId: 'org-1',
    metaJson: {
      telemetrySource: 'PCOB',
      telemetryIngress: {
        sessionId: 'session-live',
        lastAdapterSequence: 15,
      },
    },
  },
  tournament: {
    organizationId: 'org-1',
  },
  ...overrides,
});

describe('TelemetryIngressService', () => {
  const createService = (matchRecord = createMatchRecord()) => {
    const prisma = {
      match: {
        findUnique: jest.fn().mockResolvedValue(matchRecord),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      matchControlState: {
        findUnique: jest.fn().mockResolvedValue({
          state: 'LIVE',
          organizationId: 'org-1',
          metaJson: {
            telemetrySource: 'PCOB',
            telemetryIngress: {
              sessionId: 'session-live',
              lastAdapterSequence: 15,
            },
          },
        }),
        upsert: jest.fn().mockResolvedValue(undefined),
      },
    } as unknown as PrismaService;
    const engine = {
      applyAdapterTelemetryEnvelope: jest
        .fn()
        .mockResolvedValue({ state: createEngineState() }),
    };
    const persistence = {
      markTelemetryAccepted: jest.fn().mockResolvedValue(undefined),
    };
    const broadcast = {
      toLiveMatchState: jest
        .fn()
        .mockReturnValue(createLiveMatchState(matchRecord?.id ?? 'match-1')),
    };
    const matchControl = {
      applyAuthoritativeMatchEnd: jest.fn().mockResolvedValue(undefined),
    };
    const service = new TelemetryIngressService(
      prisma,
      engine as any,
      persistence as any,
      broadcast as any,
      matchControl as any,
    );

    return {
      service,
      prisma,
      engine,
      persistence,
      broadcast,
      matchControl,
    };
  };

  it('accepts valid session and monotonic sequence metadata', async () => {
    const { service, prisma, engine, persistence, matchControl } =
      createService();

    const result = await service.ingestAdapterTelemetryEnvelope(
      createEnvelope(),
      { source: 'PCOB_PUSH' },
    );

    expect(result).toMatchObject({
      ok: true,
      ignored: false,
      reason: null,
      matchId: 'match-1',
    });
    expect(engine.applyAdapterTelemetryEnvelope).toHaveBeenCalledWith(
      expect.objectContaining({
        matchId: 'match-1',
        sessionId: 'session-live',
        sequence: 16,
      }),
      'PCOB_PUSH',
    );
    expect((prisma as any).matchControlState.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { matchId: 'match-1' },
        update: expect.objectContaining({
          metaJson: expect.objectContaining({
            telemetryIngress: expect.objectContaining({
              sessionId: 'session-live',
              lastAdapterSequence: 16,
            }),
          }),
        }),
      }),
    );
    expect(persistence.markTelemetryAccepted).toHaveBeenCalledWith('match-1', {
      source: 'PCOB_PUSH',
      sequence: 22,
    });
    expect(matchControl.applyAuthoritativeMatchEnd).not.toHaveBeenCalled();
  });

  it('locks AUTO telemetry source on the first accepted packet', async () => {
    const matchRecord = createMatchRecord({
      telemetrySource: 'AUTO',
      telemetrySourceLockedAt: null,
      controlState: {
        state: 'LIVE',
        organizationId: 'org-1',
        metaJson: {
          telemetryIngress: {
            sessionId: 'session-live',
            lastAdapterSequence: 15,
          },
        },
      },
    });
    const { service, prisma } = createService(matchRecord);

    await expect(
      service.ingestAdapterTelemetryEnvelope(createEnvelope(), {
        source: 'PCOB_PUSH',
      }),
    ).resolves.toMatchObject({
      ok: true,
      ignored: false,
      matchId: 'match-1',
    });

    expect((prisma as any).match.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'match-1',
        deletedAt: null,
        telemetrySource: 'AUTO',
      },
      data: {
        telemetrySource: 'PCOB',
        telemetrySourceLockedAt: expect.any(Date),
      },
    });
    expect((prisma as any).matchControlState.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { matchId: 'match-1' },
        update: expect.objectContaining({
          metaJson: expect.objectContaining({
            telemetrySource: 'PCOB',
          }),
        }),
      }),
    );
  });

  it('rejects missing session ids before touching match state', async () => {
    const { service, prisma, engine, persistence } = createService();

    await expect(
      service.ingestAdapterTelemetryEnvelope(
        createEnvelope({ sessionId: null }),
      ),
    ).resolves.toEqual({
      ok: true,
      ignored: true,
      reason: 'SESSION_ID_REQUIRED',
      matchId: 'match-1',
    });

    expect((prisma as any).match.findUnique).not.toHaveBeenCalled();
    expect(engine.applyAdapterTelemetryEnvelope).not.toHaveBeenCalled();
    expect(persistence.markTelemetryAccepted).not.toHaveBeenCalled();
  });

  it('drops envelopes with forbidden lifecycle or result root fields', async () => {
    const { service, engine, persistence } = createService();

    await expect(
      service.ingestAdapterTelemetryEnvelope(
        createEnvelope({ isFinished: true }) as any,
      ),
    ).resolves.toEqual({
      ok: true,
      ignored: true,
      reason: 'FORBIDDEN_FIELDS',
      matchId: 'match-1',
    });

    expect(engine.applyAdapterTelemetryEnvelope).not.toHaveBeenCalled();
    expect(persistence.markTelemetryAccepted).not.toHaveBeenCalled();
  });

  it('rejects envelopes with the wrong session id', async () => {
    const { service, engine, persistence } = createService();

    await expect(
      service.ingestAdapterTelemetryEnvelope(
        createEnvelope({ sessionId: 'session-stale' }),
      ),
    ).resolves.toEqual({
      ok: true,
      ignored: true,
      reason: 'SESSION_MISMATCH',
      matchId: 'match-1',
    });

    expect(engine.applyAdapterTelemetryEnvelope).not.toHaveBeenCalled();
    expect(persistence.markTelemetryAccepted).not.toHaveBeenCalled();
  });

  it('drops stale or non-monotonic adapter sequences with a debug log', async () => {
    const { service, engine, persistence } = createService();
    const debugSpy = jest.spyOn((service as any).logger, 'debug');

    await expect(
      service.ingestAdapterTelemetryEnvelope(createEnvelope({ sequence: 15 })),
    ).resolves.toEqual({
      ok: true,
      ignored: true,
      reason: 'SEQUENCE_MISMATCH',
      matchId: 'match-1',
    });

    expect(debugSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        '"message":"[Telemetry] Dropped out-of-order packet"',
      ),
    );
    expect(engine.applyAdapterTelemetryEnvelope).not.toHaveBeenCalled();
    expect(persistence.markTelemetryAccepted).not.toHaveBeenCalled();
  });

  it('rejects packets from a different locked telemetry source without touching state', async () => {
    const lockedMatch = createMatchRecord({
      telemetrySource: 'LAUNCHER',
      telemetrySourceLockedAt: new Date('2026-04-04T18:00:00.000Z'),
      controlState: {
        state: 'LIVE',
        organizationId: 'org-1',
        metaJson: {
          telemetrySource: 'LAUNCHER',
          telemetryIngress: {
            sessionId: 'session-live',
            lastAdapterSequence: 15,
          },
        },
      },
    });
    const { service, prisma, engine, persistence } = createService(lockedMatch);

    await expect(
      service.ingestAdapterTelemetryEnvelope(createEnvelope(), {
        source: 'PCOB_PUSH',
      }),
    ).rejects.toThrow('Telemetry source mismatch');

    expect((prisma as any).match.updateMany).not.toHaveBeenCalled();
    expect((prisma as any).matchControlState.upsert).not.toHaveBeenCalled();
    expect(engine.applyAdapterTelemetryEnvelope).not.toHaveBeenCalled();
    expect(persistence.markTelemetryAccepted).not.toHaveBeenCalled();
  });

  it('rejects telemetry when the canonical match lifecycle is not LIVE', async () => {
    const { service, engine, persistence } = createService(
      createMatchRecord({
        status: 'FINISH_PENDING',
        controlState: {
          state: 'ENDED',
          organizationId: 'org-1',
          metaJson: {
            telemetryIngress: {
              sessionId: 'session-live',
              lastAdapterSequence: 15,
            },
          },
        },
      }),
    );

    await expect(
      service.ingestAdapterTelemetryEnvelope(createEnvelope()),
    ).resolves.toEqual({
      ok: true,
      ignored: true,
      reason: 'MATCH_NOT_LIVE',
      matchId: 'match-1',
    });

    expect(engine.applyAdapterTelemetryEnvelope).not.toHaveBeenCalled();
    expect(persistence.markTelemetryAccepted).not.toHaveBeenCalled();
  });

  it('forwards accepted envelopes to the engine with the bound canonical match id', async () => {
    const { service, engine, broadcast } = createService(
      createMatchRecord({ id: 'bound-match' }),
    );

    await expect(
      service.ingestAdapterTelemetryEnvelope(
        createEnvelope({ matchId: 'payload-match', sequence: 17 }),
        {
          boundMatchId: 'bound-match',
          source: 'PCOB_PUSH',
        },
      ),
    ).resolves.toMatchObject({
      ok: true,
      matchId: 'bound-match',
      state: expect.objectContaining({ matchId: 'bound-match' }),
    });

    expect(engine.applyAdapterTelemetryEnvelope).toHaveBeenCalledWith(
      expect.objectContaining({
        matchId: 'bound-match',
        sessionId: 'session-live',
        sequence: 17,
      }),
      'PCOB_PUSH',
    );
    expect(broadcast.toLiveMatchState).toHaveBeenCalled();
  });

  it('routes one-team-alive live telemetry through canonical finish detection', async () => {
    const { service, matchControl } = createService();
    const state = createEngineState();
    state.teamsAlive = 1;
    state.status = 'LIVE';
    (
      (service as any).engine.applyAdapterTelemetryEnvelope as jest.Mock
    ).mockResolvedValueOnce({
      state,
    });

    await expect(
      service.ingestAdapterTelemetryEnvelope(createEnvelope(), {
        source: 'PCOB_PUSH',
      }),
    ).resolves.toMatchObject({
      ok: true,
      ignored: false,
      matchId: 'match-1',
    });

    expect(matchControl.applyAuthoritativeMatchEnd).toHaveBeenCalledWith(
      'match-1',
      expect.objectContaining({
        sessionId: 'session-live',
        source: 'PCOB_PUSH',
      }),
    );
  });

  it('does not auto-finish when live telemetry still has multiple teams alive', async () => {
    const { service, matchControl } = createService();
    const state = createEngineState();
    state.teamsAlive = 2;
    (
      (service as any).engine.applyAdapterTelemetryEnvelope as jest.Mock
    ).mockResolvedValueOnce({
      state,
    });

    await expect(
      service.ingestAdapterTelemetryEnvelope(createEnvelope(), {
        source: 'PCOB_PUSH',
      }),
    ).resolves.toMatchObject({
      ok: true,
      ignored: false,
      matchId: 'match-1',
    });

    expect(matchControl.applyAuthoritativeMatchEnd).not.toHaveBeenCalled();
  });
});
