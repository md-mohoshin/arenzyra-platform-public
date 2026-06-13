import { ObserverAiService } from './observer-ai.service';

describe('ObserverAiService', () => {
  const baseTeams = () => [
    {
      teamId: 'team-a',
      name: 'Alpha',
      tag: 'ALP',
      slot: 1,
      kills: 5,
      placement: null,
      points: null,
      logoUrl: null,
      alivePlayers: 3,
      totalPlayers: 4,
      alive: true,
      players: [
        {
          externalPlayerId: 'player-a1',
          playerId: 'player-a1',
          pubgPlayerId: 'player-a1',
          name: 'Ace',
          ign: 'Ace',
          teamId: 'team-a',
          alive: true,
          knocked: false,
          kills: 4,
        },
        {
          externalPlayerId: 'player-a2',
          playerId: 'player-a2',
          pubgPlayerId: 'player-a2',
          name: 'Arrow',
          ign: 'Arrow',
          teamId: 'team-a',
          alive: true,
          knocked: false,
          kills: 1,
        },
      ],
    },
    {
      teamId: 'team-b',
      name: 'Bravo',
      tag: 'BRV',
      slot: 2,
      kills: 2,
      placement: null,
      points: null,
      logoUrl: null,
      alivePlayers: 2,
      totalPlayers: 4,
      alive: true,
      players: [
        {
          externalPlayerId: 'player-b1',
          playerId: 'player-b1',
          pubgPlayerId: 'player-b1',
          name: 'Blitz',
          ign: 'Blitz',
          teamId: 'team-b',
          alive: true,
          knocked: false,
          kills: 2,
        },
        {
          externalPlayerId: 'player-b2',
          playerId: 'player-b2',
          pubgPlayerId: 'player-b2',
          name: 'Bolt',
          ign: 'Bolt',
          teamId: 'team-b',
          alive: true,
          knocked: false,
          kills: 0,
        },
      ],
    },
    {
      teamId: 'team-c',
      name: 'Charlie',
      tag: 'CHR',
      slot: 3,
      kills: 1,
      placement: null,
      points: null,
      logoUrl: null,
      alivePlayers: 2,
      totalPlayers: 4,
      alive: true,
      players: [
        {
          externalPlayerId: 'player-c1',
          playerId: 'player-c1',
          pubgPlayerId: 'player-c1',
          name: 'Cipher',
          ign: 'Cipher',
          teamId: 'team-c',
          alive: true,
          knocked: false,
          kills: 1,
        },
        {
          externalPlayerId: 'player-c2',
          playerId: 'player-c2',
          pubgPlayerId: 'player-c2',
          name: 'Crux',
          ign: 'Crux',
          teamId: 'team-c',
          alive: true,
          knocked: false,
          kills: 0,
        },
      ],
    },
  ];

  it('suggests the highest-pressure POV for a multi-team fight', () => {
    const service = new ObserverAiService();

    const result = service.processMatch({
      matchId: 'observer-ai-fight',
      sourceMode: 'AUTO',
      updatedAt: 2_000,
      teams: baseTeams(),
      killEvents: [],
      fightEvents: [
        {
          type: 'FIGHT_STARTED',
          fightId: 'fight-ab',
          matchId: 'observer-ai-fight',
          teamIds: ['team-a', 'team-b'],
          timestamp: 1_000,
          startedAt: 1_000,
          lastEventAt: 1_000,
          durationMs: 0,
          killsByTeam: {},
          knocksByTeam: {},
        },
        {
          type: 'FIGHT_UPDATED',
          fightId: 'fight-ac',
          matchId: 'observer-ai-fight',
          teamIds: ['team-a', 'team-c'],
          timestamp: 1_500,
          startedAt: 1_000,
          lastEventAt: 1_500,
          durationMs: 500,
          killsByTeam: {},
          knocksByTeam: {},
        },
      ],
    });

    expect(result).toEqual([
      expect.objectContaining({
        reason: 'Multi-team fight',
        teamId: 'team-a',
        playerId: 'player-a1',
        priority: expect.any(Number),
      }),
    ]);
  });

  it('suggests the last alive player when a team wipe is in progress', () => {
    const service = new ObserverAiService();

    const result = service.processMatch({
      matchId: 'observer-ai-wipe',
      sourceMode: 'AUTO',
      updatedAt: 3_000,
      teams: [
        baseTeams()[0],
        {
          ...baseTeams()[1],
          alivePlayers: 1,
          players: [
            {
              ...baseTeams()[1].players[0],
              alive: true,
            },
            {
              ...baseTeams()[1].players[1],
              alive: false,
            },
          ],
        },
        baseTeams()[2],
      ],
      fightEvents: [],
      killEvents: [
        {
          id: 'kill-1',
          type: 'PLAYER_KILL',
          ts: 3_000,
          teamId: 'team-a',
          playerId: 'player-a1',
          payload: {
            killerTeamId: 'team-a',
            killerPlayerId: 'player-a1',
            victimTeamId: 'team-b',
            victimPlayerId: 'player-b2',
            timestamp: 3_000,
          },
        },
      ],
    });

    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reason: 'Team wipe in progress',
          teamId: 'team-b',
          playerId: 'player-b1',
        }),
      ]),
    );
  });

  it('suggests a clutch player when a team drops to one alive', () => {
    const service = new ObserverAiService();

    service.processMatch({
      matchId: 'observer-ai-clutch',
      sourceMode: 'AUTO',
      updatedAt: 1_000,
      teams: baseTeams(),
      fightEvents: [],
      killEvents: [],
    });

    const result = service.processMatch({
      matchId: 'observer-ai-clutch',
      sourceMode: 'AUTO',
      updatedAt: 4_000,
      teams: [
        baseTeams()[0],
        {
          ...baseTeams()[1],
          alivePlayers: 1,
          players: [
            {
              ...baseTeams()[1].players[0],
              alive: true,
            },
            {
              ...baseTeams()[1].players[1],
              alive: false,
            },
          ],
        },
        baseTeams()[2],
      ],
      fightEvents: [],
      killEvents: [],
    });

    expect(result).toEqual([
      expect.objectContaining({
        reason: 'Clutch situation',
        teamId: 'team-b',
        playerId: 'player-b1',
      }),
    ]);
  });

  it('feeds live camera suggestions from event-bus match and fight events', async () => {
    const eventBus = {
      subscribe: jest.fn().mockImplementation(() => jest.fn()),
      publish: jest.fn().mockResolvedValue(undefined),
    } as any;
    const broadcaster = {
      broadcastObserverSuggestion: jest.fn().mockResolvedValue(undefined),
    } as any;
    const service = new ObserverAiService(eventBus, broadcaster);

    service.onModuleInit();

    const matchHandler = eventBus.subscribe.mock.calls.find(
      ([topic, , , options]: [string, string, unknown, { types?: string[] }]) =>
        topic === 'match.events' &&
        options?.types?.includes('state.updated') === true,
    )?.[2] as ((envelope: { payload: unknown }) => Promise<void>) | undefined;
    const fightHandler = eventBus.subscribe.mock.calls.find(
      ([topic, , , options]: [string, string, unknown, { types?: string[] }]) =>
        topic === 'fight.events' &&
        options?.types?.includes('fight.detected') === true,
    )?.[2] as ((envelope: { payload: unknown }) => Promise<void>) | undefined;

    await matchHandler?.({
      payload: {
        matchId: 'observer-ai-live',
        organizationId: 'org-1',
        projection: {
          matchId: 'observer-ai-live',
          sourceMode: 'AUTO',
          updatedAt: 2_000,
          teams: baseTeams(),
          events: [],
        },
      },
    });
    await fightHandler?.({
      payload: {
        matchId: 'observer-ai-live',
        organizationId: 'org-1',
        fightEvent: {
          type: 'FIGHT_STARTED',
          fightId: 'fight-ab',
          matchId: 'observer-ai-live',
          teamIds: ['team-a', 'team-b', 'team-c'],
          timestamp: 2_100,
          startedAt: 2_100,
          lastEventAt: 2_100,
          durationMs: 0,
          killsByTeam: {},
          knocksByTeam: {},
        },
      },
    });

    expect(service.getSuggestions('observer-ai-live')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reason: 'Multi-team fight',
          teamId: 'team-a',
          playerId: 'player-a1',
        }),
      ]),
    );
    expect(broadcaster.broadcastObserverSuggestion).toHaveBeenCalledWith(
      expect.objectContaining({
        matchId: 'observer-ai-live',
        teamId: 'team-a',
        playerId: 'player-a1',
      }),
      'org-1',
    );
  });
});
