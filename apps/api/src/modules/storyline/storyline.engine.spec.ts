import { StorylineEngine } from './storyline.engine';

describe('StorylineEngine', () => {
  const baseTeams = () => [
    {
      teamId: 'team-a',
      name: 'Alpha',
      tag: 'ALP',
      slot: 1,
      kills: 2,
      placement: null,
      points: null,
      logoUrl: null,
      alivePlayers: 3,
      totalPlayers: 4,
      alive: true,
    },
    {
      teamId: 'team-b',
      name: 'Bravo',
      tag: 'BRV',
      slot: 6,
      kills: 1,
      placement: null,
      points: null,
      logoUrl: null,
      alivePlayers: 2,
      totalPlayers: 4,
      alive: true,
    },
    {
      teamId: 'team-c',
      name: 'Charlie',
      tag: 'CHR',
      slot: 8,
      kills: 0,
      placement: null,
      points: null,
      logoUrl: null,
      alivePlayers: 2,
      totalPlayers: 4,
      alive: true,
    },
  ];

  it('emits kill leader changes when a unique leader changes', () => {
    const engine = new StorylineEngine();

    const first = engine.processMatch({
      matchId: 'match-1',
      sourceMode: 'AUTO',
      updatedAt: 2_000,
      status: 'LIVE',
      finished: false,
      teams: baseTeams(),
      summary: {
        totalTeams: 6,
        aliveTeams: 5,
        totalPlayers: 12,
        alivePlayers: 7,
      },
      matchEvents: [],
      fightEvents: [],
    });

    const second = engine.processMatch({
      matchId: 'match-1',
      sourceMode: 'AUTO',
      updatedAt: 4_000,
      status: 'LIVE',
      finished: false,
      teams: [
        {
          ...baseTeams()[0],
          kills: 2,
        },
        {
          ...baseTeams()[1],
          kills: 4,
        },
        baseTeams()[2],
      ],
      summary: {
        totalTeams: 6,
        aliveTeams: 5,
        totalPlayers: 12,
        alivePlayers: 7,
      },
      matchEvents: [],
      fightEvents: [],
    });

    expect(first.map((event) => event.type)).toEqual(['TEAM_KILL_LEADER']);
    expect(first[0]?.teamId).toBe('team-a');
    expect(second.map((event) => event.type)).toEqual(['TEAM_KILL_LEADER']);
    expect(second[0]?.teamId).toBe('team-b');
  });

  it('emits a hot streak when a player reaches three kills in the window', () => {
    const engine = new StorylineEngine();

    const result = engine.processMatch({
      matchId: 'match-2',
      sourceMode: 'AUTO',
      updatedAt: 9_000,
      status: 'LIVE',
      finished: false,
      teams: baseTeams(),
      summary: {
        totalTeams: 3,
        aliveTeams: 3,
        totalPlayers: 12,
        alivePlayers: 7,
      },
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
            killerPlayerId: 'player-a',
            killerName: 'Ace',
            timestamp: 1_000,
          },
        },
        {
          id: 'kill-2',
          type: 'PLAYER_KILL',
          ts: 5_000,
          teamId: 'team-a',
          playerId: 'player-a',
          payload: {
            killerTeamId: 'team-a',
            killerPlayerId: 'player-a',
            killerName: 'Ace',
            timestamp: 5_000,
          },
        },
        {
          id: 'kill-3',
          type: 'PLAYER_KILL',
          ts: 9_000,
          teamId: 'team-a',
          playerId: 'player-a',
          payload: {
            killerTeamId: 'team-a',
            killerPlayerId: 'player-a',
            killerName: 'Ace',
            timestamp: 9_000,
          },
        },
      ],
    });

    expect(result.map((event) => event.type)).toContain('PLAYER_HOT_STREAK');
    expect(
      result.find((event) => event.type === 'PLAYER_HOT_STREAK')?.playerId,
    ).toBe('player-a');
  });

  it('emits a major fight when connected fights involve three teams', () => {
    const engine = new StorylineEngine();

    const result = engine.processMatch({
      matchId: 'match-3',
      sourceMode: 'AUTO',
      updatedAt: 8_000,
      status: 'LIVE',
      finished: false,
      teams: baseTeams(),
      summary: {
        totalTeams: 3,
        aliveTeams: 3,
        totalPlayers: 12,
        alivePlayers: 7,
      },
      matchEvents: [],
      fightEvents: [
        {
          type: 'FIGHT_STARTED',
          fightId: 'fight-1',
          matchId: 'match-3',
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
          fightId: 'fight-2',
          matchId: 'match-3',
          teamIds: ['team-a', 'team-c'],
          timestamp: 8_000,
          startedAt: 7_000,
          lastEventAt: 8_000,
          durationMs: 1_000,
          killsByTeam: {},
          knocksByTeam: {},
        },
      ],
    });

    expect(result.map((event) => event.type)).toContain('MAJOR_FIGHT');
    expect(
      result.find((event) => event.type === 'MAJOR_FIGHT')?.teamIds,
    ).toEqual(['team-a', 'team-b', 'team-c']);
  });

  it('emits final circle and underdog win storylines', () => {
    const engine = new StorylineEngine();

    const first = engine.processMatch({
      matchId: 'match-4',
      sourceMode: 'AUTO',
      updatedAt: 12_000,
      status: 'LIVE',
      finished: false,
      teams: [
        {
          ...baseTeams()[0],
          alivePlayers: 1,
        },
        {
          ...baseTeams()[1],
          alivePlayers: 1,
        },
        {
          ...baseTeams()[2],
          alivePlayers: 1,
        },
      ],
      summary: {
        totalTeams: 8,
        aliveTeams: 3,
        totalPlayers: 32,
        alivePlayers: 3,
      },
      matchEvents: [],
      fightEvents: [],
    });

    const second = engine.processMatch({
      matchId: 'match-4',
      sourceMode: 'AUTO',
      updatedAt: 20_000,
      status: 'ENDED',
      finished: true,
      teams: [
        {
          ...baseTeams()[0],
          placement: 2,
          alivePlayers: 0,
          alive: false,
        },
        {
          ...baseTeams()[1],
          placement: 1,
          alivePlayers: 1,
          alive: true,
        },
        {
          ...baseTeams()[2],
          placement: 3,
          alivePlayers: 0,
          alive: false,
        },
      ],
      summary: {
        totalTeams: 8,
        aliveTeams: 1,
        totalPlayers: 32,
        alivePlayers: 1,
        winnerTeamId: 'team-b',
        winnerSlot: 6,
      },
      matchEvents: [],
      fightEvents: [],
    });

    expect(first.map((event) => event.type)).toContain('FINAL_CIRCLE');
    expect(second.map((event) => event.type)).toContain('UNDERDOG_WIN');
    expect(second.find((event) => event.type === 'UNDERDOG_WIN')?.teamId).toBe(
      'team-b',
    );
  });
});
