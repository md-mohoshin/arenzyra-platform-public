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

describe('GameAdapterTelemetryService', () => {
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
    expect(prisma.match.update).toHaveBeenCalledWith({
      where: { id: 'match-1' },
      data: { pcobLastSeenAt: new Date(100) },
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('skips adapter polling when the match is locked to a different telemetry source', async () => {
    const pullTelemetry = jest.fn().mockResolvedValue({
      matchId: 'match-1',
      sessionId: 'session-live',
      sequence: 18,
      timestamp: 100,
      players: [],
      teams: [],
      zone: null,
      events: [],
      source: 'PCOB_API',
    });
    const prisma = {
      match: {
        findUnique: jest.fn().mockResolvedValue({
          telemetrySource: 'LAUNCHER',
          controlState: {
            metaJson: null,
          },
        }),
      },
      matchTelemetry: {
        upsert: jest.fn(),
      },
    };
    const telemetryIngress = {
      ingestAdapterTelemetryEnvelope: jest.fn(),
    };
    const service = new GameAdapterTelemetryService(
      prisma as any,
      { getClient: jest.fn().mockReturnValue(null) } as any,
      {
        resolve: jest.fn().mockResolvedValue({
          key: 'pubgm-pcob',
          gameKey: GameKey.PUBG_MOBILE,
          pullTelemetry,
        }),
      } as any,
      telemetryIngress as any,
    );

    await (service as any).pollMatch('match-1');

    expect(pullTelemetry).not.toHaveBeenCalled();
    expect(
      telemetryIngress.ingestAdapterTelemetryEnvelope,
    ).not.toHaveBeenCalled();
  });
});
