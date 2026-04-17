import { LiveStateMirrorService } from './live-state-mirror.service';

describe('LiveStateMirrorService', () => {
  it('preserves the current live roster when the incoming live state is incomplete', async () => {
    const current = {
      matchId: 'match-1',
      status: 'LIVE',
      startedAt: '2026-04-10T00:00:00.000Z',
      endedAt: null,
      version: 2,
      updatedAt: '2026-04-10T00:00:10.000Z',
      summary: {
        totalTeams: 1,
        aliveTeams: 1,
        totalPlayers: 2,
        alivePlayers: 2,
        winnerTeamId: null,
        winnerSlot: null,
      },
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
          alivePlayers: 2,
          totalPlayers: 2,
          alive: true,
          eliminated: false,
          players: [
            {
              playerId: 'player-1',
              name: 'Alpha 1',
              ign: 'Alpha 1',
              teamId: 'team-1',
              alive: true,
              knocked: false,
              kills: 0,
            },
            {
              playerId: 'player-2',
              name: 'Alpha 2',
              ign: 'Alpha 2',
              teamId: 'team-1',
              alive: true,
              knocked: false,
              kills: 0,
            },
          ],
        },
      ],
      killFeed: [],
      events: [],
      circle: null,
    };
    const stateStore = {
      get: jest.fn().mockResolvedValue(current),
      save: jest.fn().mockImplementation(async (_matchId, state) => state),
    };
    const service = new LiveStateMirrorService(stateStore as any);

    const saved = await service.publish({
      matchId: 'match-1',
      status: 'LIVE',
      startedAt: '2026-04-10T00:00:00.000Z',
      endedAt: null,
      version: 0,
      updatedAt: '2026-04-10T00:00:20.000Z',
      summary: {
        totalTeams: 1,
        aliveTeams: 0,
        totalPlayers: 0,
        alivePlayers: 0,
        winnerTeamId: null,
        winnerSlot: null,
      },
      teams: [
        {
          teamId: 'team-1',
          name: 'Alpha',
          tag: 'A',
          slot: 1,
          kills: 1,
          placement: null,
          points: null,
          logoUrl: null,
          alivePlayers: 0,
          totalPlayers: 0,
          alive: false,
          eliminated: true,
          players: [],
        },
      ],
      killFeed: [],
      events: [],
      circle: {
        phase: 1,
        nextShrinkAt: null,
        safeZone: null,
        nextZone: null,
      },
    } as any);

    expect(saved.summary).toMatchObject({
      totalPlayers: 2,
      totalTeams: 1,
    });
    expect(saved.teams[0]?.players).toHaveLength(2);
    expect(saved.teams[0]?.kills).toBe(1);
    expect(saved.teams[0]?.alivePlayers).toBe(0);
  });

  it('preserves roster rows when a team-only plane packet reports total players', async () => {
    const current = {
      matchId: 'match-1',
      status: 'LIVE',
      startedAt: '2026-04-10T00:00:00.000Z',
      endedAt: null,
      version: 2,
      updatedAt: '2026-04-10T00:00:10.000Z',
      summary: {
        totalTeams: 1,
        aliveTeams: 1,
        totalPlayers: 2,
        alivePlayers: 2,
        winnerTeamId: null,
        winnerSlot: null,
      },
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
          alivePlayers: 2,
          totalPlayers: 2,
          alive: true,
          eliminated: false,
          players: [
            {
              playerId: 'player-1',
              name: 'Alpha 1',
              ign: 'Alpha 1',
              teamId: 'team-1',
              alive: true,
              knocked: false,
              kills: 0,
            },
            {
              playerId: 'player-2',
              name: 'Alpha 2',
              ign: 'Alpha 2',
              teamId: 'team-1',
              alive: true,
              knocked: false,
              kills: 0,
            },
          ],
        },
      ],
      killFeed: [],
      events: [],
      circle: null,
    };
    const stateStore = {
      get: jest.fn().mockResolvedValue(current),
      save: jest.fn().mockImplementation(async (_matchId, state) => state),
    };
    const service = new LiveStateMirrorService(stateStore as any);

    const saved = await service.publish({
      matchId: 'match-1',
      status: 'LIVE',
      startedAt: '2026-04-10T00:00:00.000Z',
      endedAt: null,
      version: 0,
      updatedAt: '2026-04-10T00:00:20.000Z',
      summary: {
        totalTeams: 1,
        aliveTeams: 1,
        totalPlayers: 2,
        alivePlayers: 2,
        winnerTeamId: null,
        winnerSlot: null,
      },
      teams: [
        {
          teamId: 'team-1',
          name: 'Alpha',
          tag: 'A',
          slot: 1,
          kills: 1,
          placement: null,
          points: null,
          logoUrl: null,
          alivePlayers: 2,
          totalPlayers: 2,
          alive: true,
          eliminated: false,
          players: [],
        },
      ],
      killFeed: [],
      events: [],
      circle: {
        phase: 1,
        nextShrinkAt: null,
        safeZone: null,
        nextZone: null,
      },
    } as any);

    expect(saved.summary).toMatchObject({
      alivePlayers: 2,
      totalPlayers: 2,
      totalTeams: 1,
    });
    expect(saved.teams[0]?.players).toHaveLength(2);
    expect(saved.teams[0]?.kills).toBe(1);
    expect(saved.teams[0]?.alivePlayers).toBe(2);
  });
});
