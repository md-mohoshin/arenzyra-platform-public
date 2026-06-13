import { Logger } from '@nestjs/common';
import { GameKey } from '@prisma/client';
import { GameAdapterTelemetryService } from './game-adapter-telemetry.service';

class ManualAdapterMock {
  readonly key = 'pubgm-manual';
  readonly gameKey = GameKey.PUBG_MOBILE;

  async getSnapshot() {
    return {
      match: { matchId: 'match-1' },
      teams: [],
      players: [],
    };
  }
}

const originalPollEnabled = process.env.GAME_ADAPTER_TELEMETRY_POLL_ENABLED;
const originalLegacyPcobIngest = process.env.ALLOW_LEGACY_PCOB_INGEST;

const restorePollingEnv = () => {
  if (originalPollEnabled === undefined) {
    delete process.env.GAME_ADAPTER_TELEMETRY_POLL_ENABLED;
  } else {
    process.env.GAME_ADAPTER_TELEMETRY_POLL_ENABLED = originalPollEnabled;
  }
  if (originalLegacyPcobIngest === undefined) {
    delete process.env.ALLOW_LEGACY_PCOB_INGEST;
  } else {
    process.env.ALLOW_LEGACY_PCOB_INGEST = originalLegacyPcobIngest;
  }
};

describe('GameAdapterTelemetryService', () => {
  afterEach(() => {
    restorePollingEnv();
    jest.restoreAllMocks();
  });

  it('leaves legacy adapter polling disabled by default', () => {
    delete process.env.GAME_ADAPTER_TELEMETRY_POLL_ENABLED;
    delete process.env.ALLOW_LEGACY_PCOB_INGEST;
    const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    const setIntervalSpy = jest.spyOn(global, 'setInterval');
    const service = new GameAdapterTelemetryService(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

    service.onModuleInit();

    expect(setIntervalSpy).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(
      'Legacy game-adapter telemetry polling disabled; API push telemetry remains enabled',
    );
  });

  it('starts legacy adapter polling only when explicitly enabled', () => {
    process.env.GAME_ADAPTER_TELEMETRY_POLL_ENABLED = '1';
    delete process.env.ALLOW_LEGACY_PCOB_INGEST;
    const setIntervalSpy = jest
      .spyOn(global, 'setInterval')
      .mockImplementation(() => ({}) as NodeJS.Timeout);
    const clearIntervalSpy = jest
      .spyOn(global, 'clearInterval')
      .mockImplementation(() => undefined as any);
    const service = new GameAdapterTelemetryService(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

    service.onModuleInit();
    service.onModuleDestroy();

    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 1500);
    expect(clearIntervalSpy).toHaveBeenCalled();
  });

  it('logs when pushed telemetry resolves to a non-envelope adapter', async () => {
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const prisma = {
      match: {
        findUnique: jest.fn().mockResolvedValue({ adapterKey: 'pubgm-manual' }),
      },
    } as any;
    const service = new GameAdapterTelemetryService(
      prisma,
      { getClient: jest.fn().mockReturnValue(null) } as any,
      {
        resolve: jest.fn().mockResolvedValue(new ManualAdapterMock()),
      } as any,
      {} as any,
    );

    await expect(
      service.ingestEnvelope('match-1', {
        sessionId: 'session-1',
        payload: { eventType: 'KILL' },
      }),
    ).resolves.toEqual({ ok: true, handled: false });

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('"action":"push-envelope-ignored"'),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('"adapterKey":"pubgm-manual"'),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('"resolvedAdapterName":"ManualAdapterMock"'),
    );

    warnSpy.mockRestore();
  });

  it('forwards pushed telemetry to ingress and propagates session rejections from the canonical gate', async () => {
    const telemetryIngress = {
      ingestAdapterTelemetryEnvelope: jest.fn().mockResolvedValue({
        ok: true,
        ignored: true,
        reason: 'SESSION_MISMATCH',
        matchId: 'match-1',
      }),
    };
    const prisma = {
      match: {
        findUnique: jest.fn(),
      },
      matchTelemetry: {
        upsert: jest.fn(),
      },
    };
    const service = new GameAdapterTelemetryService(
      prisma as any,
      { getClient: jest.fn().mockReturnValue(null) } as any,
      {
        resolve: jest.fn().mockResolvedValue({
          key: 'pubgm-pcob',
          gameKey: GameKey.PUBG_MOBILE,
          normalizeTelemetryEnvelope: jest.fn().mockResolvedValue({
            matchId: 'match-1',
            sessionId: 'session-stale',
            sequence: 11,
            timestamp: 100,
            players: [],
            teams: [],
            zone: null,
            events: [],
            source: 'PCOB_PUSH',
          }),
        }),
      } as any,
      telemetryIngress as any,
    );

    await expect(
      service.ingestEnvelope('match-1', {
        sessionId: 'session-stale',
      }),
    ).resolves.toEqual({
      ok: true,
      handled: true,
      ignored: true,
      reason: 'SESSION_MISMATCH',
    });

    expect(
      telemetryIngress.ingestAdapterTelemetryEnvelope,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        matchId: 'match-1',
        sessionId: 'session-stale',
        sequence: 11,
      }),
      {
        boundMatchId: 'match-1',
        source: 'PCOB_PUSH',
      },
    );
    expect(prisma.match.findUnique).not.toHaveBeenCalled();
    expect(prisma.matchTelemetry.upsert).not.toHaveBeenCalled();
  });

  it('forwards pushed telemetry to ingress and propagates sequence rejections from the canonical gate', async () => {
    const telemetryIngress = {
      ingestAdapterTelemetryEnvelope: jest.fn().mockResolvedValue({
        ok: true,
        ignored: true,
        reason: 'SEQUENCE_MISMATCH',
        matchId: 'match-1',
      }),
    };
    const prisma = {
      match: {
        findUnique: jest.fn(),
      },
      matchTelemetry: {
        upsert: jest.fn(),
      },
    };
    const service = new GameAdapterTelemetryService(
      prisma as any,
      { getClient: jest.fn().mockReturnValue(null) } as any,
      {
        resolve: jest.fn().mockResolvedValue({
          key: 'pubgm-pcob',
          gameKey: GameKey.PUBG_MOBILE,
          normalizeTelemetryEnvelope: jest.fn().mockResolvedValue({
            matchId: 'match-1',
            sessionId: 'session-live',
            sequence: 14,
            timestamp: 100,
            players: [],
            teams: [],
            zone: null,
            events: [],
            source: 'PCOB_PUSH',
          }),
        }),
      } as any,
      telemetryIngress as any,
    );

    await expect(
      service.ingestEnvelope('match-1', {
        sessionId: 'session-live',
        sequence: 14,
      }),
    ).resolves.toEqual({
      ok: true,
      handled: true,
      ignored: true,
      reason: 'SEQUENCE_MISMATCH',
    });

    expect(
      telemetryIngress.ingestAdapterTelemetryEnvelope,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        matchId: 'match-1',
        sessionId: 'session-live',
        sequence: 14,
      }),
      {
        boundMatchId: 'match-1',
        source: 'PCOB_PUSH',
      },
    );
    expect(prisma.match.findUnique).not.toHaveBeenCalled();
    expect(prisma.matchTelemetry.upsert).not.toHaveBeenCalled();
  });

  it('honors an explicit source override when forwarding pushed telemetry to ingress', async () => {
    const telemetryIngress = {
      ingestAdapterTelemetryEnvelope: jest.fn().mockResolvedValue({
        ok: true,
        ignored: true,
        reason: 'SESSION_MISMATCH',
        matchId: 'match-1',
      }),
    };
    const prisma = {
      match: {
        findUnique: jest.fn(),
      },
      matchTelemetry: {
        upsert: jest.fn(),
      },
    };
    const service = new GameAdapterTelemetryService(
      prisma as any,
      { getClient: jest.fn().mockReturnValue(null) } as any,
      {
        resolve: jest.fn().mockResolvedValue({
          key: 'pubgm-pcob',
          gameKey: GameKey.PUBG_MOBILE,
          normalizeTelemetryEnvelope: jest.fn().mockResolvedValue({
            matchId: 'match-1',
            sessionId: 'session-live',
            sequence: 17,
            timestamp: 100,
            players: [],
            teams: [],
            zone: null,
            events: [],
            source: 'PCOB_PUSH',
          }),
        }),
      } as any,
      telemetryIngress as any,
    );

    await expect(
      service.ingestEnvelope(
        'match-1',
        {
          sessionId: 'session-live',
          sequence: 17,
        },
        {
          sourceOverride: 'LAUNCHER',
        },
      ),
    ).resolves.toEqual({
      ok: true,
      handled: true,
      ignored: true,
      reason: 'SESSION_MISMATCH',
    });

    expect(
      telemetryIngress.ingestAdapterTelemetryEnvelope,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        matchId: 'match-1',
        sessionId: 'session-live',
        sequence: 17,
        source: 'PCOB_PUSH',
      }),
      {
        boundMatchId: 'match-1',
        source: 'LAUNCHER',
      },
    );
    expect(prisma.match.findUnique).not.toHaveBeenCalled();
    expect(prisma.matchTelemetry.upsert).not.toHaveBeenCalled();
  });

  it('persists compatibility mirrors only after ingress accepts the canonical envelope', async () => {
    const telemetryIngress = {
      ingestAdapterTelemetryEnvelope: jest.fn().mockResolvedValue({
        ok: true,
        ignored: false,
        reason: null,
        matchId: 'match-1',
      }),
    };
    const transactionClient = {
      matchEvent: {
        aggregate: jest.fn().mockResolvedValue({ _max: { seq: 0 } }),
        createMany: jest.fn().mockResolvedValue(undefined),
      },
    };
    const prisma = {
      match: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'match-1',
          organizationId: 'org-1',
          controlState: {
            organizationId: 'org-1',
          },
          tournament: {
            organizationId: 'org-1',
          },
        }),
        update: jest.fn().mockResolvedValue(undefined),
      },
      matchTelemetry: {
        upsert: jest.fn().mockResolvedValue(undefined),
      },
      $transaction: jest
        .fn()
        .mockImplementation(async (callback: any) =>
          callback(transactionClient),
        ),
    };
    const service = new GameAdapterTelemetryService(
      prisma as any,
      { getClient: jest.fn().mockReturnValue(null) } as any,
      {
        resolve: jest.fn().mockResolvedValue({
          key: 'pubgm-pcob',
          gameKey: GameKey.PUBG_MOBILE,
          normalizeTelemetryEnvelope: jest.fn().mockResolvedValue({
            matchId: 'match-1',
            sessionId: 'session-live',
            sequence: 16,
            timestamp: 100,
            players: [
              {
                playerId: 'external-player-1',
                teamId: 'team-1',
                alive: true,
              },
            ],
            teams: [
              {
                teamId: 'team-1',
                players: [{ playerId: 'external-player-1' }],
              },
            ],
            zone: null,
            events: [],
            source: 'PCOB_PUSH',
          }),
        }),
      } as any,
      telemetryIngress as any,
    );

    await expect(
      service.ingestEnvelope('match-1', {
        sessionId: 'session-live',
        sequence: 16,
      }),
    ).resolves.toEqual({
      ok: true,
      handled: true,
      ignored: false,
    });

    expect(telemetryIngress.ingestAdapterTelemetryEnvelope).toHaveBeenCalled();
    expect(prisma.match.findUnique).toHaveBeenCalledWith({
      where: { id: 'match-1' },
      select: {
        id: true,
        organizationId: true,
        controlState: {
          select: {
            organizationId: true,
          },
        },
        tournament: { select: { organizationId: true } },
      },
    });
    expect(prisma.matchTelemetry.upsert).toHaveBeenCalled();
    const mirrorPayload =
      prisma.matchTelemetry.upsert.mock.calls[0][0].create.payload;
    expect(mirrorPayload).toEqual(
      expect.objectContaining({
        players: [],
        teams: [],
        structuralMirrorDisabled: true,
        raw: expect.objectContaining({
          players: expect.arrayContaining([
            expect.objectContaining({ playerId: 'external-player-1' }),
          ]),
          teams: expect.arrayContaining([
            expect.objectContaining({ teamId: 'team-1' }),
          ]),
        }),
      }),
    );
    expect(prisma.match.update).toHaveBeenCalledWith({
      where: { id: 'match-1' },
      data: { pcobLastSeenAt: new Date(100) },
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('filters elimination compatibility events from plane/parachuting packets', async () => {
    const telemetryIngress = {
      ingestAdapterTelemetryEnvelope: jest.fn().mockResolvedValue({
        ok: true,
        ignored: false,
        reason: null,
        matchId: 'match-1',
      }),
    };
    const prisma = {
      match: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'match-1',
          organizationId: 'org-1',
          controlState: {
            organizationId: 'org-1',
          },
          tournament: {
            organizationId: 'org-1',
          },
        }),
        update: jest.fn().mockResolvedValue(undefined),
      },
      matchTelemetry: {
        upsert: jest.fn().mockResolvedValue(undefined),
      },
      $transaction: jest.fn(),
    };
    const service = new GameAdapterTelemetryService(
      prisma as any,
      { getClient: jest.fn().mockReturnValue(null) } as any,
      {
        resolve: jest.fn().mockResolvedValue({
          key: 'pubgm-pcob',
          gameKey: GameKey.PUBG_MOBILE,
          normalizeTelemetryEnvelope: jest.fn().mockResolvedValue({
            matchId: 'match-1',
            sessionId: 'session-live',
            sequence: 16,
            timestamp: 100,
            players: [],
            teams: [],
            zone: { phase: 1 },
            events: [
              {
                type: 'TEAM_ELIMINATED',
                timestamp: 100,
                teamId: 'team-1',
                payload: {},
              },
              {
                type: 'KILL',
                timestamp: 100,
                killerId: 'player-1',
                victimId: 'player-2',
                payload: {},
              },
            ],
            source: 'PCOB_PUSH',
            raw: { state: 'PARACHUTING' },
          }),
        }),
      } as any,
      telemetryIngress as any,
    );

    await expect(
      service.ingestEnvelope('match-1', {
        sessionId: 'session-live',
        sequence: 16,
      }),
    ).resolves.toEqual({
      ok: true,
      handled: true,
      ignored: false,
    });

    const mirrorPayload =
      prisma.matchTelemetry.upsert.mock.calls[0][0].create.payload;
    expect(mirrorPayload.events).toEqual([]);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
