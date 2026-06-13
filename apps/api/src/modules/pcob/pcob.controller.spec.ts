import { DataMode, MatchDataSource, MatchStatus } from '@prisma/client';
import { PcobTelemetryIngestController } from './pcob.controller';

describe('PcobTelemetryIngestController', () => {
  it('delegates pubgm-pcob telemetry to the adapter pipeline without requiring clientId', async () => {
    const prisma = {
      match: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'match-1',
          organizationId: 'org-1',
          status: MatchStatus.LIVE,
          telemetrySource: 'API',
          telemetrySourceLockedAt: new Date('2026-04-04T18:00:00.000Z'),
          pcobSessionId: 'session-1',
          adapterKey: 'pubgm-pcob',
          pcobMode: false,
          pcobKillSyncEnabled: false,
          dataMode: DataMode.MANUAL,
          dataSource: MatchDataSource.API,
          pcobBoundAt: null,
          controlState: {
            state: 'LIVE',
            metaJson: { telemetrySource: 'API' },
            organizationId: 'org-1',
          },
          tournament: { organizationId: 'org-1' },
        }),
      },
      matchControlState: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn(),
      },
      feedLock: {
        findUnique: jest.fn(),
      },
    } as any;
    const scoring = {
      recomputeMatchAndTournament: jest.fn(),
    } as any;
    const adapterTelemetry = {
      ingestEnvelope: jest.fn().mockResolvedValue({
        ok: true,
        handled: true,
        ignored: false,
      }),
    } as any;
    const health = {
      onTelemetryWithContext: jest.fn(),
    } as any;

    const controller = new PcobTelemetryIngestController(
      prisma,
      scoring,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      health,
      {} as any,
      {} as any,
      adapterTelemetry,
    );

    await expect(
      controller.ingest({
        sessionId: 'session-1',
        matchId: 'match-1',
        payload: { eventType: 'KILL' },
      }),
    ).resolves.toEqual({
      ok: true,
      handled: true,
      ignored: false,
    });

    expect(adapterTelemetry.ingestEnvelope).toHaveBeenCalledWith('match-1', {
      sessionId: 'session-1',
      matchId: 'match-1',
      payload: { eventType: 'KILL' },
    });
    expect(health.onTelemetryWithContext).toHaveBeenCalledWith(
      'match-1',
      null,
      expect.objectContaining({
        authoritative: true,
        authoritySource: 'API_AUTHORITATIVE',
      }),
    );
    expect(prisma.feedLock.findUnique).not.toHaveBeenCalled();
    expect(scoring.recomputeMatchAndTournament).not.toHaveBeenCalled();
  });

  it('accepts authoritative pubgm-pcob start telemetry before the match is live', async () => {
    const prisma = {
      match: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'match-1',
          organizationId: 'org-1',
          status: MatchStatus.DRAFT,
          telemetrySource: 'API',
          telemetrySourceLockedAt: new Date('2026-04-04T18:00:00.000Z'),
          pcobSessionId: 'session-1',
          adapterKey: 'pubgm-pcob',
          pcobMode: false,
          pcobKillSyncEnabled: false,
          dataMode: DataMode.MANUAL,
          dataSource: MatchDataSource.API,
          pcobBoundAt: null,
          controlState: {
            state: 'LIVE',
            metaJson: { telemetrySource: 'API' },
            organizationId: 'org-1',
          },
          tournament: { organizationId: 'org-1' },
        }),
      },
      matchControlState: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn(),
      },
      feedLock: {
        findUnique: jest.fn(),
      },
    } as any;
    const adapterTelemetry = {
      ingestEnvelope: jest.fn().mockResolvedValue({
        ok: true,
        handled: true,
        ignored: false,
      }),
    } as any;

    const controller = new PcobTelemetryIngestController(
      prisma,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      { onTelemetryWithContext: jest.fn() } as any,
      {} as any,
      {} as any,
      adapterTelemetry,
    );

    await expect(
      controller.ingest({
        sessionId: 'session-1',
        matchId: 'match-1',
        payload: {
          eventType: 'MATCH_STATE_UPDATE',
          state: 'LIVE',
        },
      }),
    ).resolves.toEqual({
      ok: true,
      handled: true,
      ignored: false,
    });

    expect(adapterTelemetry.ingestEnvelope).toHaveBeenCalledWith(
      'match-1',
      expect.objectContaining({
        sessionId: 'session-1',
        matchId: 'match-1',
      }),
    );
    expect(prisma.feedLock.findUnique).not.toHaveBeenCalled();
  });

  it('rejects adapter-path ingest when the match is not bound to pubgm-pcob', async () => {
    const prisma = {
      match: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'match-1',
          organizationId: 'org-1',
          status: MatchStatus.LIVE,
          telemetrySource: 'API',
          telemetrySourceLockedAt: new Date('2026-04-04T18:00:00.000Z'),
          pcobSessionId: 'session-1',
          adapterKey: 'pubgm-manual',
          pcobMode: false,
          pcobKillSyncEnabled: false,
          dataMode: DataMode.MANUAL,
          dataSource: MatchDataSource.API,
          pcobBoundAt: null,
          controlState: {
            state: 'LIVE',
            metaJson: { telemetrySource: 'API' },
            organizationId: 'org-1',
          },
          tournament: { organizationId: 'org-1' },
        }),
      },
      matchControlState: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn(),
      },
      feedLock: {
        findUnique: jest.fn(),
      },
    } as any;
    const adapterTelemetry = {
      ingestEnvelope: jest.fn(),
    } as any;

    const controller = new PcobTelemetryIngestController(
      prisma,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      { onTelemetryWithContext: jest.fn() } as any,
      {} as any,
      {} as any,
      adapterTelemetry,
    );

    await expect(
      controller.ingest({
        sessionId: 'session-1',
        matchId: 'match-1',
        payload: { eventType: 'MATCH_STATE_UPDATE', state: 'LIVE' },
      }),
    ).rejects.toThrow('Match is not adapter-bound to pubgm-pcob');

    expect(adapterTelemetry.ingestEnvelope).not.toHaveBeenCalled();
    expect(prisma.feedLock.findUnique).not.toHaveBeenCalled();
  });
});
