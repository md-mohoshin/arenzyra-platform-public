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
      alivePlayers: 2,
      totalPlayers: 2,
      totalTeams: 1,
    });
    expect(saved.teams[0]?.players).toHaveLength(2);
    expect(saved.teams[0]?.kills).toBe(1);
    expect(saved.teams[0]?.alivePlayers).toBe(2);
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

  it('preserves seeded teams when early telemetry only reports a partial roster', async () => {
    const current = {
      matchId: 'match-1',
      status: 'LIVE',
      startedAt: '2026-04-10T00:00:00.000Z',
      endedAt: null,
      version: 2,
      updatedAt: '2026-04-10T00:00:10.000Z',
      summary: {
        totalTeams: 2,
        aliveTeams: 2,
        totalPlayers: 4,
        alivePlayers: 4,
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
        {
          teamId: 'team-2',
          name: 'Bravo',
          tag: 'B',
          slot: 2,
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
              playerId: 'player-3',
              name: 'Bravo 1',
              ign: 'Bravo 1',
              teamId: 'team-2',
              alive: true,
              knocked: false,
              kills: 0,
            },
            {
              playerId: 'player-4',
              name: 'Bravo 2',
              ign: 'Bravo 2',
              teamId: 'team-2',
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
        totalPlayers: 1,
        alivePlayers: 1,
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
          alivePlayers: 1,
          totalPlayers: 1,
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
              kills: 1,
            },
          ],
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
      totalTeams: 2,
      totalPlayers: 4,
      alivePlayers: 4,
    });
    expect(saved.teams).toHaveLength(2);
    expect(
      saved.teams.find((team) => team.teamId === 'team-2')?.players,
    ).toHaveLength(2);
    expect(saved.teams.find((team) => team.teamId === 'team-1')?.kills).toBe(1);
  });

  it('keeps unseen seeded teams alive while early plane telemetry is incomplete', async () => {
    const current = {
      matchId: 'match-1',
      status: 'LIVE',
      startedAt: '2026-04-10T00:00:00.000Z',
      endedAt: null,
      version: 2,
      updatedAt: '2026-04-10T00:00:10.000Z',
      summary: {
        totalTeams: 3,
        aliveTeams: 3,
        totalPlayers: 12,
        alivePlayers: 12,
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
          totalPlayers: 4,
          players: [],
        },
        {
          teamId: 'team-2',
          name: 'Bravo',
          tag: 'B',
          slot: 2,
          kills: 0,
          placement: null,
          points: null,
          logoUrl: null,
          totalPlayers: 4,
          players: [],
        },
        {
          teamId: 'team-3',
          name: 'Charlie',
          tag: 'C',
          slot: 3,
          kills: 0,
          placement: null,
          points: null,
          logoUrl: null,
          totalPlayers: 4,
          players: [],
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
        totalPlayers: 1,
        alivePlayers: 1,
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
          alivePlayers: 1,
          totalPlayers: 1,
          alive: true,
          eliminated: false,
          players: [],
        },
      ],
      killFeed: [],
      events: [],
      circle: {
        phase: 0,
        nextShrinkAt: null,
        safeZone: null,
        nextZone: null,
      },
    } as any);

    expect(saved.summary).toMatchObject({
      totalTeams: 3,
      aliveTeams: 3,
      totalPlayers: 12,
      alivePlayers: 12,
    });
    expect(
      saved.teams.find((team) => team.teamId === 'team-1')?.alivePlayers,
    ).toBe(4);
    expect(
      saved.teams.find((team) => team.teamId === 'team-2')?.alivePlayers,
    ).toBe(4);
    expect(
      saved.teams.find((team) => team.teamId === 'team-3')?.alivePlayers,
    ).toBe(4);
  });

  it('recovers a cached partial plane state that already undercounted alive players', async () => {
    const current = {
      matchId: 'match-1',
      status: 'LIVE',
      startedAt: '2026-04-10T00:00:00.000Z',
      endedAt: null,
      version: 2,
      updatedAt: '2026-04-10T00:00:10.000Z',
      summary: {
        totalTeams: 2,
        aliveTeams: 1,
        totalPlayers: 8,
        alivePlayers: 1,
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
          alivePlayers: 1,
          totalPlayers: 4,
          alive: true,
          eliminated: false,
          players: [],
        },
        {
          teamId: 'team-2',
          name: 'Bravo',
          tag: 'B',
          slot: 2,
          kills: 0,
          placement: null,
          points: null,
          logoUrl: null,
          alivePlayers: 0,
          totalPlayers: 4,
          alive: false,
          eliminated: true,
          players: [],
        },
      ],
      killFeed: [],
      events: [],
      circle: {
        phase: 0,
        nextShrinkAt: null,
        safeZone: null,
        nextZone: null,
      },
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
        totalPlayers: 1,
        alivePlayers: 1,
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
          alivePlayers: 1,
          totalPlayers: 1,
          alive: true,
          eliminated: false,
          players: [],
        },
      ],
      killFeed: [],
      events: [],
      circle: {
        phase: 0,
        nextShrinkAt: null,
        safeZone: null,
        nextZone: null,
      },
    } as any);

    expect(saved.summary).toMatchObject({
      totalTeams: 2,
      aliveTeams: 2,
      totalPlayers: 8,
      alivePlayers: 8,
    });
    expect(
      saved.teams.find((team) => team.teamId === 'team-1')?.alivePlayers,
    ).toBe(4);
    expect(
      saved.teams.find((team) => team.teamId === 'team-2')?.alivePlayers,
    ).toBe(4);
  });

  it('deduplicates duplicate players in the same telemetry-owned team before merge', async () => {
    const stateStore = {
      get: jest.fn().mockResolvedValue(null),
      save: jest.fn().mockImplementation(async (_matchId, state) => state),
    };
    const service = new LiveStateMirrorService(stateStore as any);
    const errorSpy = jest.spyOn((service as any).logger, 'error');

    const saved = await service.publish(
      {
        matchId: 'match-1',
        status: 'LIVE',
        startedAt: '2026-04-10T00:00:00.000Z',
        endedAt: null,
        version: 0,
        updatedAt: '2026-04-10T00:00:20.000Z',
        sourceMode: 'AUTO',
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
                alive: false,
                knocked: false,
                kills: 0,
              },
              {
                playerId: 'player-1',
                name: 'Alpha 1 Duplicate',
                ign: 'Alpha 1 Duplicate',
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
      } as any,
      { writer: 'telemetry-engine' },
    );

    expect(saved.summary).toMatchObject({
      totalPlayers: 1,
      alivePlayers: 1,
    });
    expect(saved.teams[0]?.players).toHaveLength(1);
    expect(saved.teams[0]?.players?.[0]).toMatchObject({
      playerId: 'player-1',
      alive: true,
      eliminated: false,
    });
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('[CRITICAL][PLAYER STATE CONFLICT]'),
    );
  });

  it('publishes telemetry-engine live state without rebuilding canonical roster rows', async () => {
    const current = {
      matchId: 'match-1',
      status: 'LIVE',
      startedAt: '2026-04-10T00:00:00.000Z',
      endedAt: null,
      version: 2,
      updatedAt: '2026-04-10T00:00:10.000Z',
      sourceMode: 'AUTO',
      summary: {
        totalTeams: 2,
        aliveTeams: 2,
        totalPlayers: 8,
        alivePlayers: 8,
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
          alivePlayers: 4,
          totalPlayers: 4,
          alive: true,
          eliminated: false,
          players: Array.from({ length: 4 }, (_, index) => ({
            playerId: `team-1-player-${index + 1}`,
            teamId: 'team-1',
            alive: true,
            knocked: false,
            kills: 0,
          })),
        },
        {
          teamId: 'team-2',
          name: 'Bravo',
          tag: 'B',
          slot: 2,
          kills: 0,
          placement: null,
          points: null,
          logoUrl: null,
          alivePlayers: 4,
          totalPlayers: 4,
          alive: true,
          eliminated: false,
          players: Array.from({ length: 4 }, (_, index) => ({
            playerId: `team-2-player-${index + 1}`,
            teamId: 'team-2',
            alive: true,
            knocked: false,
            kills: 0,
          })),
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

    const saved = await service.publish(
      {
        matchId: 'match-1',
        status: 'LIVE',
        startedAt: '2026-04-10T00:00:00.000Z',
        endedAt: null,
        version: 0,
        updatedAt: '2026-04-10T00:00:20.000Z',
        sourceMode: 'AUTO',
        summary: {
          totalTeams: 1,
          aliveTeams: 1,
          totalPlayers: 1,
          alivePlayers: 1,
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
            alivePlayers: 1,
            totalPlayers: 1,
            alive: true,
            eliminated: false,
            players: [
              {
                playerId: 'team-1-player-1',
                teamId: 'team-1',
                alive: true,
                knocked: false,
                kills: 1,
              },
            ],
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
      } as any,
      { writer: 'telemetry-engine' },
    );

    expect(saved.summary).toMatchObject({
      totalTeams: 1,
      aliveTeams: 1,
      totalPlayers: 1,
      alivePlayers: 1,
    });
    expect(saved.teams).toHaveLength(1);
    expect(saved.teams[0]).toMatchObject({
      teamId: 'team-1',
      alivePlayers: 1,
      totalPlayers: 1,
      kills: 1,
    });
  });

  it('preserves telemetry utility snapshots when a later tick omits utility data', async () => {
    const current = {
      matchId: 'match-1',
      status: 'LIVE',
      startedAt: '2026-04-10T00:00:00.000Z',
      endedAt: null,
      version: 2,
      updatedAt: '2026-04-10T00:00:10.000Z',
      sourceMode: 'AUTO',
      summary: {
        totalTeams: 1,
        aliveTeams: 1,
        totalPlayers: 4,
        alivePlayers: 4,
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
          alivePlayers: 4,
          totalPlayers: 4,
          alive: true,
          eliminated: false,
          backpack: {
            teamId: 'team-1',
            slot: 1,
            itemCount: 7,
            items: [{ name: 'Smoke Grenade', count: 4 }],
            equipment: [{ name: 'Frag Grenade', count: 3 }],
          },
          equipment: {
            teamId: 'team-1',
            slot: 1,
            itemCount: 7,
            items: [{ name: 'Smoke Grenade', count: 4 }],
            equipment: [{ name: 'Frag Grenade', count: 3 }],
          },
          players: [],
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

    const saved = await service.publish(
      {
        matchId: 'match-1',
        status: 'LIVE',
        startedAt: '2026-04-10T00:00:00.000Z',
        endedAt: null,
        version: 0,
        updatedAt: '2026-04-10T00:00:20.000Z',
        sourceMode: 'AUTO',
        summary: {
          totalTeams: 1,
          aliveTeams: 1,
          totalPlayers: 4,
          alivePlayers: 3,
          winnerTeamId: null,
          winnerSlot: null,
        },
        teams: [
          {
            teamId: 'team-1',
            name: 'Alpha',
            tag: 'A',
            slot: 1,
            kills: 2,
            placement: null,
            points: null,
            logoUrl: null,
            alivePlayers: 3,
            totalPlayers: 4,
            alive: true,
            eliminated: false,
            players: [],
          },
        ],
        killFeed: [],
        events: [],
        circle: null,
      } as any,
      { writer: 'telemetry-engine' },
    );

    expect(saved.teams[0]).toMatchObject({
      teamId: 'team-1',
      kills: 2,
      alivePlayers: 3,
      backpack: expect.objectContaining({
        itemCount: 7,
        items: [expect.objectContaining({ name: 'Smoke Grenade', count: 4 })],
      }),
      equipment: expect.objectContaining({
        itemCount: 7,
      }),
    });
  });

  it('allows safe match-control bootstrap when no active telemetry owner exists', async () => {
    const incoming = {
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
          name: 'Canonical Alpha',
          tag: 'CA',
          slot: 7,
          kills: 0,
          placement: null,
          points: null,
          logoUrl: 'https://example.com/logo.png',
          alivePlayers: 2,
          totalPlayers: 2,
          alive: true,
          eliminated: false,
          players: [
            {
              playerId: 'player-1',
              name: 'Roster One',
              ign: 'Roster One',
              teamId: 'team-1',
              alive: true,
              knocked: false,
              kills: 0,
            },
            {
              playerId: 'player-2',
              name: 'Roster Two',
              ign: 'Roster Two',
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
      get: jest.fn().mockResolvedValue(null),
      save: jest.fn().mockImplementation(async (_matchId, state) => state),
    };
    const service = new LiveStateMirrorService(stateStore as any);

    const saved = await service.publish(incoming as any, {
      writer: 'match-control',
    });

    expect(saved).toMatchObject({
      summary: incoming.summary,
      teams: [
        expect.objectContaining({
          teamId: 'team-1',
          name: 'Canonical Alpha',
          slot: 7,
          alivePlayers: 2,
          totalPlayers: 2,
        }),
      ],
    });
    expect(saved.teams[0]?.players).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ playerId: 'player-1', alive: true }),
        expect.objectContaining({ playerId: 'player-2', alive: true }),
      ]),
    );
  });

  it('preserves active telemetry runtime when match-control publishes an equal-sized live roster snapshot', async () => {
    const current = {
      matchId: 'match-1',
      status: 'LIVE',
      startedAt: '2026-04-10T00:00:00.000Z',
      endedAt: null,
      version: 8,
      updatedAt: '2026-04-10T00:00:15.000Z',
      sourceMode: 'AUTO',
      summary: {
        totalTeams: 1,
        aliveTeams: 1,
        totalPlayers: 2,
        alivePlayers: 1,
        winnerTeamId: null,
        winnerSlot: null,
      },
      teams: [
        {
          teamId: 'team-1',
          name: 'Telemetry Alpha',
          tag: 'TA',
          slot: 1,
          kills: 3,
          placement: null,
          points: null,
          logoUrl: null,
          hasTelemetryPresence: true,
          alivePlayers: 1,
          totalPlayers: 2,
          alive: true,
          eliminated: false,
          players: [
            {
              playerId: 'player-1',
              name: 'Live One',
              ign: 'Live One',
              teamId: 'team-1',
              alive: false,
              knocked: false,
              eliminated: true,
              kills: 2,
              lifeTelemetryFresh: true,
            },
            {
              playerId: 'player-2',
              name: 'Live Two',
              ign: 'Live Two',
              teamId: 'team-1',
              alive: true,
              knocked: false,
              eliminated: false,
              kills: 1,
              lifeTelemetryFresh: true,
            },
          ],
        },
      ],
      killFeed: [
        {
          id: 'kill-1',
          type: 'PLAYER_KILL',
          ts: 1,
        },
      ],
      events: [],
      circle: {
        phase: 4,
        nextShrinkAt: 1234,
        safeZone: null,
        nextZone: null,
      },
    };
    const stateStore = {
      get: jest.fn().mockResolvedValue(current),
      save: jest.fn().mockImplementation(async (_matchId, state) => state),
    };
    const service = new LiveStateMirrorService(stateStore as any);

    const saved = await service.publish(
      {
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
            name: 'Canonical Alpha',
            tag: 'CA',
            slot: 9,
            kills: 0,
            placement: null,
            points: null,
            logoUrl: 'https://example.com/canonical.png',
            alivePlayers: 2,
            totalPlayers: 2,
            alive: true,
            eliminated: false,
            players: [
              {
                playerId: 'player-1',
                name: 'Roster One',
                ign: 'Roster One',
                teamId: 'team-1',
                alive: true,
                knocked: false,
                kills: 0,
              },
              {
                playerId: 'player-2',
                name: 'Roster Two',
                ign: 'Roster Two',
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
      } as any,
      { writer: 'match-control' },
    );

    expect(saved.sourceMode).toBe('API');
    expect(saved.circle).toMatchObject({
      phase: 4,
      nextShrinkAt: 1234,
    });
    expect(saved.killFeed).toHaveLength(1);
    expect(saved.summary).toMatchObject({
      totalTeams: 1,
      totalPlayers: 2,
      alivePlayers: 1,
      aliveTeams: 1,
    });
    expect(saved.teams[0]).toMatchObject({
      teamId: 'team-1',
      name: 'Canonical Alpha',
      tag: 'CA',
      slot: 9,
      kills: 3,
      alivePlayers: 1,
      totalPlayers: 2,
    });
    expect(saved.teams[0]?.players).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          playerId: 'player-1',
          alive: false,
          kills: 2,
        }),
        expect.objectContaining({
          playerId: 'player-2',
          alive: true,
          kills: 1,
        }),
      ]),
    );
  });

  it('blocks results-service from publishing telemetry-owned live player rows', async () => {
    const stateStore = {
      get: jest.fn().mockResolvedValue(null),
      save: jest.fn().mockImplementation(async (_matchId, state) => state),
    };
    const service = new LiveStateMirrorService(stateStore as any);

    await expect(
      service.publish(
        {
          matchId: 'match-1',
          status: 'LIVE',
          startedAt: '2026-04-10T00:00:00.000Z',
          endedAt: null,
          version: 0,
          updatedAt: '2026-04-10T00:00:20.000Z',
          sourceMode: 'AUTO',
          summary: {
            totalTeams: 1,
            aliveTeams: 1,
            totalPlayers: 1,
            alivePlayers: 1,
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
              alivePlayers: 1,
              totalPlayers: 1,
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
              ],
            },
          ],
          killFeed: [],
          events: [],
          circle: null,
        } as any,
        { writer: 'results-service' },
      ),
    ).rejects.toThrow('CRITICAL DUPLICATE SOURCE');
    expect(stateStore.save).not.toHaveBeenCalled();
  });
});
