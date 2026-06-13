import { ForbiddenException } from '@nestjs/common';
import { WidgetsPublicController } from './widgets-public.controller';
import { requireMatchOrganization } from '../../common/org/org.util';

jest.mock('../../common/org/org.util', () => ({
  requireMatchOrganization: jest.fn().mockResolvedValue(undefined),
}));

describe('WidgetsPublicController', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (requireMatchOrganization as jest.Mock).mockResolvedValue(undefined);
  });

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
          dataSource: 'API',
          dataMode: 'AUTO',
          telemetryProvider: 'API',
          sourceMode: 'API',
          boundAt: '2026-04-01T09:29:00.000Z',
          lastSeenAt: '2026-04-01T09:58:00.000Z',
          isConfigured: true,
          isBound: true,
          isReady: false,
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
        dataSource: 'API',
        dataMode: 'AUTO',
        telemetryProvider: 'API',
        sourceMode: 'API',
        boundAt: '2026-04-01T09:29:00.000Z',
        lastSeenAt: '2026-04-01T09:58:00.000Z',
        isConfigured: true,
        isBound: true,
        isReady: false,
      },
      locks: {
        lifecycleLocked: true,
        slotsLocked: true,
        resultsLocked: true,
      },
    });
  });

  it('returns scoped public slot results using the safe projection service', async () => {
    const results = {
      listSlotResultsPublic: jest.fn().mockResolvedValue([
        {
          id: 'slot-1',
          slotNumber: 1,
          totalKills: 3,
          players: [],
        },
      ]),
      getWidgetStatePublic: jest.fn(),
    } as any;
    const controller = new WidgetsPublicController(
      results,
      {} as any,
      {
        getLifecycleState: jest.fn(),
      } as any,
    );

    await expect(
      controller.listSlotResults('match-1', 'org-1', { user: null } as any),
    ).resolves.toEqual({
      slots: [
        {
          id: 'slot-1',
          slotNumber: 1,
          totalKills: 3,
          players: [],
        },
      ],
    });

    expect(results.listSlotResultsPublic).toHaveBeenCalledWith('match-1', {
      organizationId: 'org-1',
      actor: null,
    });
  });

  it('rejects public slot reads for a different organization', async () => {
    const results = {
      listSlotResultsPublic: jest.fn(),
      getWidgetStatePublic: jest.fn(),
    } as any;
    const controller = new WidgetsPublicController(
      results,
      {} as any,
      {
        getLifecycleState: jest.fn(),
      } as any,
    );
    (requireMatchOrganization as jest.Mock).mockRejectedValue(
      new ForbiddenException('Cross-organization access is forbidden'),
    );

    await expect(
      controller.listSlotResults('match-1', 'org-1', { user: null } as any),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(results.listSlotResultsPublic).not.toHaveBeenCalled();
  });
});
