import { ForbiddenException } from '@nestjs/common';
import { MatchDataSource } from '@prisma/client';
import { MatchControlController } from './match-control.controller';
import { requireMatchOrganization } from '../../common/org/org.util';

jest.mock('../../common/org/org.util', () => ({
  requireMatchOrganization: jest.fn().mockResolvedValue('org-1'),
}));

describe('MatchControlController', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (requireMatchOrganization as jest.Mock).mockResolvedValue('org-1');
  });

  const buildLiveState = () => ({
    matchId: 'match-1',
    status: 'LIVE',
    startedAt: '2026-04-13T10:00:00.000Z',
    endedAt: null,
    version: 7,
    updatedAt: '2026-04-13T10:05:00.000Z',
    summary: {
      totalTeams: 1,
      aliveTeams: 1,
      totalPlayers: 4,
      alivePlayers: 4,
      winnerTeamId: null,
      winnerSlot: null,
    },
    circle: {
      phase: 1,
      nextShrinkAt: null,
      safeZone: null,
      nextZone: null,
    },
    observedPlayer: null,
    killFeed: [],
    events: [],
    teams: [
      {
        teamId: 'team-1',
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
        players: [
          {
            id: 'player-1',
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
  });

  const buildRosterOnlyState = () => ({
    matchId: 'match-1',
    status: 'LIVE',
    startedAt: '2026-04-13T10:00:00.000Z',
    endedAt: null,
    version: 0,
    updatedAt: '2026-04-13T10:05:00.000Z',
    sourceMode: 'AUTO',
    summary: {
      totalTeams: 1,
      aliveTeams: 1,
      totalPlayers: 0,
      alivePlayers: 0,
      winnerTeamId: null,
      winnerSlot: null,
    },
    circle: null,
    observedPlayer: null,
    killFeed: [],
    events: [],
    teams: [
      {
        teamId: 'team-1',
        name: 'Alpha',
        tag: 'A',
        slot: 1,
        kills: 0,
        placement: null,
        points: null,
        logoUrl: null,
        alivePlayers: null,
        totalPlayers: null,
        alive: undefined,
        eliminated: undefined,
        sourceMode: 'AUTO',
        updatedAt: '2026-04-13T10:05:00.000Z',
        players: [],
      },
    ],
  });

  const buildLifecycle = (overrides: Record<string, unknown> = {}) => ({
    matchId: 'match-1',
    status: 'LIVE',
    lifecycleStatus: 'LIVE',
    controlStatus: 'LIVE',
    liveState: 'LIVE',
    updatedAt: '2026-04-13T10:05:00.000Z',
    startedAt: '2026-04-13T10:00:00.000Z',
    endedAt: null,
    isLocked: false,
    isFinalizing: false,
    resultFinalized: false,
    resultNeedsConfirmation: false,
    resultAmbiguities: [],
    postMatchWidgets: [],
    finalizationStartedAt: null,
    finalizationDurationMs: null,
    telemetry: {
      transportConnected: true,
      packetsReceiving: false,
      telemetryAccepted: false,
      telemetryActive: false,
    },
    binding: null,
    locks: {
      lifecycleLocked: false,
      resultsLocked: false,
      slotLocked: false,
      resultLockState: 'UNLOCKED',
      reason: null,
    },
    ...overrides,
  });

  it('preserves the last accepted live snapshot when packet freshness briefly drops', async () => {
    const service = {
      getState: jest.fn().mockResolvedValue(buildLiveState()),
      getLifecycleState: jest.fn().mockResolvedValue(
        buildLifecycle({
          telemetry: {
            transportConnected: true,
            packetsReceiving: false,
            telemetryAccepted: true,
            telemetryActive: false,
          },
        }),
      ),
    } as any;

    const controller = new MatchControlController(service, {} as any);

    await expect(
      controller.getState('match-1', { user: {} } as any),
    ).resolves.toMatchObject({
      matchId: 'match-1',
      status: 'LIVE',
      summary: expect.objectContaining({
        totalPlayers: 4,
        alivePlayers: 4,
      }),
      teams: [
        expect.objectContaining({
          teamId: 'team-1',
          alivePlayers: 4,
          totalPlayers: 4,
          players: [expect.objectContaining({ playerId: 'player-1' })],
        }),
      ],
      telemetry: expect.objectContaining({
        packetsReceiving: false,
        telemetryAccepted: true,
        telemetryActive: false,
      }),
    });
  });

  it('continues to strip live telemetry before the first accepted packet', async () => {
    const service = {
      getState: jest.fn().mockResolvedValue(buildRosterOnlyState()),
      getLifecycleState: jest.fn().mockResolvedValue(buildLifecycle()),
    } as any;

    const controller = new MatchControlController(service, {} as any);

    await expect(
      controller.getState('match-1', { user: {} } as any),
    ).resolves.toMatchObject({
      matchId: 'match-1',
      status: 'LIVE',
      sourceMode: MatchDataSource.API,
      summary: null,
      circle: null,
      observedPlayer: null,
      killFeed: [],
      events: [],
      teams: [
        expect.objectContaining({
          teamId: 'team-1',
          sourceMode: MatchDataSource.API,
          alivePlayers: null,
          totalPlayers: null,
          players: [],
        }),
      ],
      telemetry: expect.objectContaining({
        telemetryAccepted: false,
        telemetryActive: false,
      }),
    });
  });

  it('continues to strip seeded roster state while telemetry transport is active but unaccepted', async () => {
    const service = {
      getState: jest.fn().mockResolvedValue(buildRosterOnlyState()),
      getLifecycleState: jest.fn().mockResolvedValue(
        buildLifecycle({
          telemetry: {
            transportConnected: true,
            packetsReceiving: true,
            telemetryAccepted: false,
            telemetryActive: true,
          },
        }),
      ),
    } as any;

    const controller = new MatchControlController(service, {} as any);

    await expect(
      controller.getState('match-1', { user: {} } as any),
    ).resolves.toMatchObject({
      matchId: 'match-1',
      status: 'LIVE',
      summary: null,
      circle: null,
      observedPlayer: null,
      teams: [
        expect.objectContaining({
          teamId: 'team-1',
          alivePlayers: null,
          totalPlayers: null,
          players: [],
        }),
      ],
      telemetry: expect.objectContaining({
        packetsReceiving: true,
        telemetryAccepted: false,
        telemetryActive: true,
      }),
    });
  });

  it('preserves the last best-known live mirror even after freshness drops to transport-only', async () => {
    const service = {
      getState: jest.fn().mockResolvedValue(buildLiveState()),
      getLifecycleState: jest.fn().mockResolvedValue(buildLifecycle()),
    } as any;

    const controller = new MatchControlController(service, {} as any);

    await expect(
      controller.getState('match-1', { user: {} } as any),
    ).resolves.toMatchObject({
      matchId: 'match-1',
      status: 'LIVE',
      summary: expect.objectContaining({
        totalPlayers: 4,
        alivePlayers: 4,
      }),
      teams: [
        expect.objectContaining({
          teamId: 'team-1',
          alivePlayers: 4,
          totalPlayers: 4,
          players: [expect.objectContaining({ playerId: 'player-1' })],
        }),
      ],
      telemetry: expect.objectContaining({
        transportConnected: true,
        packetsReceiving: false,
        telemetryAccepted: false,
        telemetryActive: false,
      }),
    });
  });

  it('strips best-known live telemetry once the match is finalizing', async () => {
    const service = {
      getState: jest.fn().mockResolvedValue(buildLiveState()),
      getLifecycleState: jest.fn().mockResolvedValue(
        buildLifecycle({
          status: 'FINISH_PENDING',
          lifecycleStatus: 'FINISH_PENDING',
          controlStatus: 'FINISH_PENDING',
          isFinalizing: true,
          telemetry: {
            transportConnected: true,
            packetsReceiving: false,
            telemetryAccepted: true,
            telemetryActive: false,
          },
        }),
      ),
    } as any;

    const controller = new MatchControlController(service, {} as any);

    await expect(
      controller.getState('match-1', { user: {} } as any),
    ).resolves.toMatchObject({
      matchId: 'match-1',
      status: 'FINISH_PENDING',
      summary: null,
      circle: null,
      observedPlayer: null,
      killFeed: [],
      events: [],
      teams: [
        expect.objectContaining({
          teamId: 'team-1',
          alivePlayers: null,
          totalPlayers: null,
          players: [],
        }),
      ],
      telemetry: expect.objectContaining({
        telemetryAccepted: true,
        telemetryActive: false,
      }),
    });
  });

  it('rejects cross-org setup reads before loading lifecycle data', async () => {
    const service = {
      authorize: jest.fn(),
      getLifecycleState: jest.fn(),
    } as any;
    const prisma = {} as any;
    const controller = new MatchControlController(service, prisma);
    (requireMatchOrganization as jest.Mock).mockRejectedValue(
      new ForbiddenException('Cross-organization access is forbidden'),
    );

    await expect(
      controller.getSetupState('match-1', {
        user: { organizationId: 'org-1' },
      } as any),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(service.authorize).not.toHaveBeenCalled();
    expect(service.getLifecycleState).not.toHaveBeenCalled();
  });

  it('returns results metadata for authorized readers in the same organization', async () => {
    const lifecycle = buildLifecycle({
      resultFinalized: true,
      resultNeedsConfirmation: false,
      postMatchWidgets: [
        {
          name: 'Match Results',
          obsUrl: '/widgets/test-org/match-results?matchId=match-1',
        },
      ],
    });
    const service = {
      authorize: jest.fn().mockResolvedValue({ id: 'match-1' }),
      getLifecycleState: jest.fn().mockResolvedValue(lifecycle),
    } as any;
    const prisma = {} as any;
    const controller = new MatchControlController(service, prisma);

    await expect(
      controller.getResultsState('match-1', {
        user: {
          id: 'user-1',
          organizationId: 'org-1',
          actorId: 'user-1',
          actorRole: 'ORGANIZER',
          role: 'ORGANIZER',
        },
      } as any),
    ).resolves.toEqual({
      matchId: 'match-1',
      lifecycleStatus: lifecycle.lifecycleStatus,
      resultFinalized: true,
      resultNeedsConfirmation: false,
      resultAmbiguities: lifecycle.resultAmbiguities,
      postMatchWidgets: lifecycle.postMatchWidgets,
      finalizationStartedAt: lifecycle.finalizationStartedAt,
      finalizationDurationMs: lifecycle.finalizationDurationMs,
      locks: lifecycle.locks,
    });

    expect(requireMatchOrganization).toHaveBeenCalledWith(
      prisma,
      'match-1',
      expect.objectContaining({
        actor: expect.objectContaining({
          organizationId: 'org-1',
        }),
      }),
    );
    expect(service.authorize).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org-1',
      }),
      'match-1',
    );
  });
});
