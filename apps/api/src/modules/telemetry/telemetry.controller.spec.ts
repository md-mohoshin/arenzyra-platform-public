jest.mock('../../common/org/org.util', () => ({
  requireMatchOrganization: jest.fn().mockResolvedValue(undefined),
}));

import { TelemetryController } from './telemetry.controller';

describe('TelemetryController', () => {
  function buildController() {
    const prisma = {
      matchControlState: {
        findUnique: jest.fn().mockResolvedValue({
          metaJson: {
            liveSync: {
              version: 10,
            },
          },
        }),
      },
    } as any;
    const stateStore = {
      get: jest.fn(),
    } as any;
    const engine = {
      getState: jest.fn(),
    } as any;
    const broadcast = {
      toLiveMatchState: jest.fn(),
    } as any;

    return {
      controller: new TelemetryController(
        prisma,
        stateStore,
        engine,
        broadcast,
      ),
      prisma,
      stateStore,
      engine,
      broadcast,
    };
  }

  it('prefers stored finished control state over newer stale engine runtime', async () => {
    const { controller, stateStore, engine, broadcast } = buildController();
    stateStore.get.mockResolvedValue({
      matchId: 'match-1',
      status: 'CONFIRMED',
      startedAt: null,
      endedAt: '2026-04-19T22:10:04.000Z',
      version: 20,
      updatedAt: '2026-04-19T22:10:04.000Z',
      summary: {
        totalTeams: 17,
        aliveTeams: 0,
        totalPlayers: 66,
        alivePlayers: 0,
        winnerTeamId: 'team-1',
        winnerSlot: 1,
      },
      teams: [],
    });

    const response = await controller.getMatchState('match-1');

    expect(engine.getState).not.toHaveBeenCalled();
    expect(broadcast.toLiveMatchState).not.toHaveBeenCalled();
    expect(response).toMatchObject({
      matchId: 'match-1',
      status: 'CONFIRMED',
      summary: {
        totalTeams: 17,
        aliveTeams: 0,
        alivePlayers: 0,
      },
    });
  });

  it('falls back to the engine for live stored states without fresh player telemetry', async () => {
    const { controller, stateStore, engine, broadcast } = buildController();
    stateStore.get.mockResolvedValue({
      matchId: 'match-1',
      status: 'LIVE',
      startedAt: null,
      endedAt: null,
      version: 20,
      updatedAt: '2026-04-19T22:02:29.000Z',
      summary: {
        totalTeams: 17,
        aliveTeams: 2,
        totalPlayers: 66,
        alivePlayers: 5,
        winnerTeamId: null,
        winnerSlot: null,
      },
      teams: [
        {
          teamId: 'team-1',
          alivePlayers: 2,
          players: [],
        },
      ],
    });
    engine.getState.mockResolvedValue({
      matchId: 'match-1',
      status: 'LIVE',
      mode: 'AUTO',
      version: 21,
      sequence: 99,
      updatedAt: 1_776_636_029_000,
      startedAt: 1_776_632_044_000,
      endedAt: null,
      teamsAlive: 1,
      teams: {},
      players: {},
      killFeed: [],
      events: [],
      circle: null,
    });
    broadcast.toLiveMatchState.mockReturnValue({
      matchId: 'match-1',
      status: 'LIVE',
      startedAt: null,
      endedAt: null,
      version: 21,
      updatedAt: '2026-04-19T22:02:29.000Z',
      summary: {
        totalTeams: 17,
        aliveTeams: 1,
        totalPlayers: 66,
        alivePlayers: 4,
        winnerTeamId: null,
        winnerSlot: null,
      },
      teams: [],
    });

    const response = await controller.getMatchState('match-1');

    expect(engine.getState).toHaveBeenCalledWith('match-1');
    expect(broadcast.toLiveMatchState).toHaveBeenCalledTimes(1);
    expect(response).toMatchObject({
      matchId: 'match-1',
      status: 'LIVE',
      summary: {
        aliveTeams: 1,
        alivePlayers: 4,
      },
    });
  });

  it('does not reuse newer finish-pending cache without fresh player telemetry', async () => {
    const { controller, stateStore, engine, broadcast } = buildController();
    stateStore.get.mockResolvedValue({
      matchId: 'match-1',
      status: 'FINISH_PENDING',
      startedAt: '2026-04-19T22:02:29.000Z',
      endedAt: null,
      version: 30,
      updatedAt: '2026-04-19T22:10:00.000Z',
      summary: {
        totalTeams: 20,
        aliveTeams: 19,
        totalPlayers: 75,
        alivePlayers: 75,
        winnerTeamId: null,
        winnerSlot: null,
      },
      teams: [
        {
          teamId: 'team-1',
          alivePlayers: 4,
          players: [],
        },
      ],
    });
    engine.getState.mockResolvedValue({
      matchId: 'match-1',
      status: 'ENDED',
      mode: 'API',
      version: 21,
      sequence: 99,
      updatedAt: 1_776_636_029_000,
      startedAt: 1_776_632_044_000,
      endedAt: null,
      teamsAlive: 0,
      teams: {},
      players: {},
      killFeed: [],
      events: [],
      circle: null,
    });
    broadcast.toLiveMatchState.mockReturnValue({
      matchId: 'match-1',
      status: 'FINISH_PENDING',
      startedAt: '2026-04-19T22:02:29.000Z',
      endedAt: null,
      version: 21,
      updatedAt: '2026-04-19T22:10:00.000Z',
      summary: {
        totalTeams: 20,
        aliveTeams: 0,
        totalPlayers: 0,
        alivePlayers: 0,
        winnerTeamId: null,
        winnerSlot: null,
      },
      teams: [],
    });

    const response = await controller.getMatchState('match-1');

    expect(engine.getState).toHaveBeenCalledWith('match-1');
    expect(response).toMatchObject({
      matchId: 'match-1',
      status: 'FINISH_PENDING',
      summary: {
        aliveTeams: 0,
        alivePlayers: 0,
      },
    });
  });

  it('sanitizes stored promotion diagnostics before returning telemetry diagnostics', async () => {
    const { controller, prisma, engine, broadcast } = buildController();
    prisma.matchControlState.findUnique.mockResolvedValue({
      metaJson: {
        telemetryPromotionDiagnostics: {
          computedAt: '2026-04-24T08:15:00.000Z',
          rawOnlyTeams: [
            {
              rawSlot: 15,
              rawTeamName: 'Team8',
              rawPlayerNames: ['Raw Alpha'],
              rawPlayerIdentifiers: ['raw-open-1'],
              rosterPlayerNames: ['Roster Alpha'],
              matchedRosterIdentityCount: 0,
              matchedRosterNameCount: 0,
              reasonCodes: ['RAW_TEAM_PRESENT_BUT_ABSENT_FROM_CANONICAL'],
            },
          ],
        },
      },
    });
    engine.getState.mockResolvedValue({
      matchId: 'match-1',
      status: 'ENDED',
      mode: 'AUTO',
      version: 21,
      sequence: 99,
      updatedAt: 1_776_636_029_000,
      startedAt: 1_776_632_044_000,
      endedAt: 1_776_636_129_000,
      teamsAlive: 0,
      teams: {},
      players: {},
      killFeed: [],
      events: [],
      circle: null,
    });
    broadcast.toLiveMatchState.mockReturnValue({
      matchId: 'match-1',
      status: 'ENDED',
      startedAt: '2026-04-24T08:14:00.000Z',
      endedAt: '2026-04-24T08:15:01.000Z',
      version: 21,
      updatedAt: '2026-04-24T08:15:00.000Z',
      summary: {
        totalTeams: 17,
        aliveTeams: 0,
        totalPlayers: 68,
        alivePlayers: 0,
        winnerTeamId: 'team-1',
        winnerSlot: 1,
      },
      teams: [],
    });

    const response = await controller.getTelemetryDiagnostics('match-1', {
      user: {
        id: 'user-1',
        role: 'ORGANIZER',
        organizationId: 'org-1',
      },
    } as any);

    expect(response.promotionDiagnostics).toEqual({
      computedAt: '2026-04-24T08:15:00.000Z',
      rawOnlyTeams: [
        {
          rawSlot: 15,
          rawTeamName: 'Team8',
          matchedRosterIdentityCount: 0,
          matchedRosterNameCount: 0,
          reasonCodes: ['RAW_TEAM_PRESENT_BUT_ABSENT_FROM_CANONICAL'],
        },
      ],
    });
  });
});
