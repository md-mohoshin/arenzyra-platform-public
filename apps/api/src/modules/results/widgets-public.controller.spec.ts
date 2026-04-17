import { WidgetsPublicController } from './widgets-public.controller';

jest.mock('../../common/org/org.util', () => ({
  requireMatchOrganization: jest.fn().mockResolvedValue(undefined),
}));

describe('WidgetsPublicController', () => {
  it('returns the canonical public control snapshot for widgets', async () => {
    const results = {
      listSlotResultsPublic: jest.fn(),
      getWidgetStatePublic: jest.fn(),
    } as any;
    const prisma = {} as any;
    const matchControl = {
      getLifecycleState: jest.fn().mockResolvedValue({
        matchId: 'match-1',
        status: 'ENDED',
        lifecycleStatus: 'ENDED',
        controlStatus: 'ENDED',
        liveState: 'ENDED',
        updatedAt: '2026-04-01T10:00:00.000Z',
        startedAt: '2026-04-01T09:30:00.000Z',
        endedAt: '2026-04-01T09:58:00.000Z',
        isLocked: true,
        isFinalizing: true,
        resultFinalized: false,
        resultNeedsConfirmation: true,
        resultAmbiguities: [
          {
            code: 'SIMULTANEOUS_ELIMINATION',
            teamIds: ['team-2', 'team-3'],
            placementFrom: 2,
            placementTo: 3,
            detectedAt: '2026-04-01T09:57:58.000Z',
            message: 'Placements 2-3 require review.',
          },
        ],
        finalizationStartedAt: '2026-04-01T09:58:05.000Z',
        finalizationDurationMs: 25_000,
        telemetry: {
          transportConnected: true,
          packetsReceiving: false,
          telemetryAccepted: true,
          telemetryActive: false,
        },
        binding: {
          sessionId: 'session-1',
          adapterKey: 'pubgm-pcob',
          dataSource: 'PCOB',
          dataMode: 'AUTO',
          telemetryProvider: 'PCOB',
          sourceMode: 'AUTO',
          boundAt: '2026-04-01T09:29:00.000Z',
          lastSeenAt: '2026-04-01T09:58:00.000Z',
          isConfigured: true,
          isBound: true,
          isReady: false,
          pcobConfigured: true,
          pcobBound: true,
          pcobReady: false,
        },
        locks: {
          lifecycleLocked: true,
          slotsLocked: true,
          resultsLocked: true,
        },
      }),
    } as any;

    const controller = new WidgetsPublicController(
      results,
      prisma,
      matchControl,
    );

    await expect(
      controller.control('match-1', 'org-1', { user: null } as any),
    ).resolves.toEqual({
      matchId: 'match-1',
      status: 'ENDED',
      matchStatus: 'ENDED',
      lifecycleStatus: 'ENDED',
      controlStatus: 'ENDED',
      liveState: 'ENDED',
      updatedAt: '2026-04-01T10:00:00.000Z',
      startedAt: '2026-04-01T09:30:00.000Z',
      endedAt: '2026-04-01T09:58:00.000Z',
      isLocked: true,
      isFinalizing: true,
      resultFinalized: false,
      resultNeedsConfirmation: true,
      resultAmbiguities: [
        {
          code: 'SIMULTANEOUS_ELIMINATION',
          teamIds: ['team-2', 'team-3'],
          placementFrom: 2,
          placementTo: 3,
          detectedAt: '2026-04-01T09:57:58.000Z',
          message: 'Placements 2-3 require review.',
        },
      ],
      finalizationStartedAt: '2026-04-01T09:58:05.000Z',
      finalizationDurationMs: 25_000,
      telemetry: {
        transportConnected: true,
        packetsReceiving: false,
        telemetryAccepted: true,
        telemetryActive: false,
      },
      binding: {
        sessionId: 'session-1',
        adapterKey: 'pubgm-pcob',
        dataSource: 'PCOB',
        dataMode: 'AUTO',
        telemetryProvider: 'PCOB',
        sourceMode: 'AUTO',
        boundAt: '2026-04-01T09:29:00.000Z',
        lastSeenAt: '2026-04-01T09:58:00.000Z',
        isConfigured: true,
        isBound: true,
        isReady: false,
        pcobConfigured: true,
        pcobBound: true,
        pcobReady: false,
      },
      locks: {
        lifecycleLocked: true,
        slotsLocked: true,
        resultsLocked: true,
      },
    });
  });
});
