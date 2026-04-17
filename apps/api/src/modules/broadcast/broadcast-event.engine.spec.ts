import { BroadcastEventEngine } from './broadcast-event.engine';

describe('BroadcastEventEngine', () => {
  const baseTeams = () => [
    {
      teamId: 'team-a',
      name: 'Alpha',
      tag: 'ALP',
      slot: 1,
      kills: 0,
      placement: null,
      points: null,
      logoUrl: null,
      alivePlayers: 2,
      totalPlayers: 2,
    },
    {
      teamId: 'team-b',
      name: 'Bravo',
      tag: 'BRV',
      slot: 2,
      kills: 0,
      placement: null,
      points: null,
      logoUrl: null,
      alivePlayers: 2,
      totalPlayers: 2,
    },
  ];

  it('emits first blood, triple, and quadra kills inside the 8 second window', () => {
    const engine = new BroadcastEventEngine();

    const result = engine.processMatch({
      matchId: 'match-1',
      sourceMode: 'AUTO',
      updatedAt: 7_000,
      status: 'LIVE',
      finished: false,
      teams: baseTeams(),
      summary: null,
      fightEvents: [],
      matchEvents: [
        {
          id: 'kill-1',
          type: 'PLAYER_KILL',
          ts: 1_000,
          teamId: 'team-a',
          playerId: 'player-a',
          payload: {
            killerTeamId: 'team-a',
            victimTeamId: 'team-b',
            killerPlayerId: 'player-a',
            killerName: 'Ace',
            timestamp: 1_000,
          },
        },
        {
          id: 'kill-2',
          type: 'PLAYER_KILL',
          ts: 3_000,
          teamId: 'team-a',
          playerId: 'player-a',
          payload: {
            killerTeamId: 'team-a',
            victimTeamId: 'team-b',
            killerPlayerId: 'player-a',
            killerName: 'Ace',
            timestamp: 3_000,
          },
        },
        {
          id: 'kill-3',
          type: 'PLAYER_KILL',
          ts: 5_000,
          teamId: 'team-a',
          playerId: 'player-a',
          payload: {
            killerTeamId: 'team-a',
            victimTeamId: 'team-b',
            killerPlayerId: 'player-a',
            killerName: 'Ace',
            timestamp: 5_000,
          },
        },
        {
          id: 'kill-4',
          type: 'PLAYER_KILL',
          ts: 7_000,
          teamId: 'team-a',
          playerId: 'player-a',
          payload: {
            killerTeamId: 'team-a',
            victimTeamId: 'team-b',
            killerPlayerId: 'player-a',
            killerName: 'Ace',
            timestamp: 7_000,
          },
        },
      ],
    });

    expect(result.map((event) => event.type)).toEqual([
      'FIRST_BLOOD',
      'TRIPLE_KILL',
      'QUADRA_KILL',
    ]);
    expect(result[0]?.playerId).toBe('player-a');
  });

  it('emits TEAM_WIPE and CLUTCH from team wipe fight events', () => {
    const engine = new BroadcastEventEngine();

    const result = engine.processMatch({
      matchId: 'match-2',
      sourceMode: 'AUTO',
      updatedAt: 2_000,
      status: 'LIVE',
      finished: false,
      teams: [
        {
          ...baseTeams()[0],
          alivePlayers: 1,
        },
        {
          ...baseTeams()[1],
          alivePlayers: 0,
        },
      ],
      summary: null,
      matchEvents: [
        {
          id: 'kill-1',
          type: 'PLAYER_KILL',
          ts: 1_500,
          teamId: 'team-a',
          playerId: 'player-a',
          payload: {
            killerTeamId: 'team-a',
            victimTeamId: 'team-b',
            killerPlayerId: 'player-a',
            killerName: 'Ace',
            timestamp: 1_500,
          },
        },
      ],
      fightEvents: [
        {
          type: 'TEAM_WIPED',
          fightId: 'fight-1',
          matchId: 'match-2',
          teamIds: ['team-a', 'team-b'],
          timestamp: 2_000,
          startedAt: 1_000,
          lastEventAt: 2_000,
          durationMs: 1_000,
          killsByTeam: { 'team-a': 1 },
          knocksByTeam: {},
          teamId: 'team-b',
          opponentTeamIds: ['team-a'],
        },
      ],
    });

    expect(result.map((event) => event.type)).toEqual([
      'FIRST_BLOOD',
      'TEAM_WIPE',
      'CLUTCH',
    ]);
    expect(result[2]?.playerId).toBe('player-a');
  });

  it('emits MATCH_WINNER once when a match finishes', () => {
    const engine = new BroadcastEventEngine();

    const first = engine.processMatch({
      matchId: 'match-3',
      sourceMode: 'AUTO',
      updatedAt: 10_000,
      status: 'ENDED',
      finished: true,
      teams: [
        {
          ...baseTeams()[0],
          placement: 1,
        },
        baseTeams()[1],
      ],
      summary: {
        totalTeams: 2,
        aliveTeams: 1,
        totalPlayers: 4,
        alivePlayers: 1,
        winnerTeamId: 'team-a',
        winnerSlot: 1,
      },
      matchEvents: [],
      fightEvents: [],
    });

    const second = engine.processMatch({
      matchId: 'match-3',
      sourceMode: 'AUTO',
      updatedAt: 11_000,
      status: 'ENDED',
      finished: true,
      teams: [
        {
          ...baseTeams()[0],
          placement: 1,
        },
        baseTeams()[1],
      ],
      summary: {
        totalTeams: 2,
        aliveTeams: 1,
        totalPlayers: 4,
        alivePlayers: 1,
        winnerTeamId: 'team-a',
        winnerSlot: 1,
      },
      matchEvents: [],
      fightEvents: [],
    });

    expect(first.map((event) => event.type)).toEqual(['MATCH_WINNER']);
    expect(second).toEqual([]);
  });
});
