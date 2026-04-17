import { MatchControlController } from './match-control.controller';

describe('MatchControlController', () => {
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

    const controller = new MatchControlController(service);

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
      getState: jest.fn().mockResolvedValue(buildLiveState()),
      getLifecycleState: jest.fn().mockResolvedValue(buildLifecycle()),
    } as any;

    const controller = new MatchControlController(service);

    await expect(
      controller.getState('match-1', { user: {} } as any),
    ).resolves.toMatchObject({
      matchId: 'match-1',
      status: 'LIVE',
      summary: null,
      circle: null,
      observedPlayer: null,
      killFeed: [],
      events: [],
      teams: [
        expect.objectContaining({
          teamId: 'team-1',
          alivePlayers: null,
          players: [],
        }),
      ],
      telemetry: expect.objectContaining({
        telemetryAccepted: false,
        telemetryActive: false,
      }),
    });
  });
});
