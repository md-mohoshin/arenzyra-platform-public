import { KillEventEngine } from './kill-event.engine';

describe('KillEventEngine', () => {
  const baseTeams = () => [
    {
      teamId: 'team-1',
      name: 'Alpha',
      tag: 'ALP',
      slot: 1,
      kills: 0,
      placement: null,
      points: null,
      logoUrl: null,
    },
    {
      teamId: 'team-2',
      name: 'Bravo',
      tag: 'BRV',
      slot: 2,
      kills: 0,
      placement: null,
      points: null,
      logoUrl: null,
    },
  ];

  it('emits only newly added kill events and recomputes team kills from player totals', () => {
    const engine = new KillEventEngine();

    const first = engine.processKillSnapshot({
      consumerKey: 'shadow-live',
      matchId: 'match-1',
      sourceMode: 'AUTO',
      teams: baseTeams(),
      currentTeams: [],
      killInfo: {
        KillList: [
          {
            killerTeamId: 'team-1',
            killerId: 'player-1',
            killerName: 'Ace',
            victimTeamId: 'team-2',
            victimId: 'player-2',
            victimName: 'Brick',
            timestamp: 1000,
          },
          {
            killerTeamId: 'team-1',
            killerId: 'player-1',
            killerName: 'Ace',
            victimTeamId: 'team-2',
            victimId: 'player-3',
            victimName: 'Cliff',
            timestamp: 2000,
          },
        ],
      },
    });

    expect(first.events).toHaveLength(2);
    expect(first.teams.find((team) => team.teamId === 'team-1')?.kills).toBe(2);
    expect(
      first.teams
        .find((team) => team.teamId === 'team-1')
        ?.players?.find((player) => player.externalPlayerId === 'player-1')
        ?.kills,
    ).toBe(2);

    const second = engine.processKillSnapshot({
      consumerKey: 'shadow-live',
      matchId: 'match-1',
      sourceMode: 'AUTO',
      teams: baseTeams(),
      currentTeams: first.teams,
      killInfo: {
        KillList: [
          {
            killerTeamId: 'team-1',
            killerId: 'player-1',
            killerName: 'Ace',
            victimTeamId: 'team-2',
            victimId: 'player-2',
            victimName: 'Brick',
            timestamp: 1000,
          },
          {
            killerTeamId: 'team-1',
            killerId: 'player-1',
            killerName: 'Ace',
            victimTeamId: 'team-2',
            victimId: 'player-3',
            victimName: 'Cliff',
            timestamp: 2000,
          },
        ],
      },
    });

    expect(second.events).toHaveLength(0);
    expect(second.teams.find((team) => team.teamId === 'team-1')?.kills).toBe(
      2,
    );
  });

  it('deduplicates repeated entries inside the same snapshot', () => {
    const engine = new KillEventEngine();

    const result = engine.processKillSnapshot({
      consumerKey: 'shadow-live',
      matchId: 'match-2',
      sourceMode: 'AUTO',
      teams: baseTeams(),
      currentTeams: [],
      killInfo: {
        killList: [
          {
            killerTeamId: 'team-1',
            killerId: 'player-1',
            victimId: 'player-2',
            timestamp: 1000,
          },
          {
            killerTeamId: 'team-1',
            killerId: 'player-1',
            victimId: 'player-2',
            timestamp: 1000,
          },
        ],
      },
    });

    expect(result.events).toHaveLength(1);
    expect(result.teams.find((team) => team.teamId === 'team-1')?.kills).toBe(
      1,
    );
  });

  it('keeps consumer dedupe state isolated so live sync and persistence can process the same snapshot independently', () => {
    const engine = new KillEventEngine();
    const killInfo = {
      killList: [
        {
          killerTeamId: 'team-1',
          killerId: 'player-1',
          victimId: 'player-2',
          timestamp: 1000,
        },
      ],
    };

    const live = engine.processKillSnapshot({
      consumerKey: 'shadow-live',
      matchId: 'match-3',
      sourceMode: 'AUTO',
      teams: baseTeams(),
      currentTeams: [],
      killInfo,
    });
    const persist = engine.processKillSnapshot({
      consumerKey: 'shadow-persist',
      matchId: 'match-3',
      sourceMode: 'AUTO',
      teams: baseTeams(),
      currentTeams: [],
      killInfo,
    });

    expect(live.events).toHaveLength(1);
    expect(persist.events).toHaveLength(1);
  });

  it('preserves higher incoming team kill totals when tracked player kills are partial', () => {
    const engine = new KillEventEngine();

    const result = engine.processKillSnapshot({
      consumerKey: 'shadow-live',
      matchId: 'match-4',
      sourceMode: 'AUTO',
      teams: [
        {
          ...baseTeams()[0],
          kills: 24,
        },
        {
          ...baseTeams()[1],
          kills: 5,
        },
      ],
      currentTeams: [
        {
          ...baseTeams()[0],
          kills: 6,
          players: [
            {
              externalPlayerId: 'player-1',
              playerId: 'player-1',
              pubgPlayerId: 'player-1',
              teamId: 'team-1',
              name: 'Ace',
              ign: 'Ace',
              kills: 6,
              alive: true,
              knocked: false,
              updatedAt: '2026-03-16T20:00:00.000Z',
            },
          ],
        },
      ],
      killInfo: null,
    });

    expect(result.events).toHaveLength(0);
    expect(result.teams.find((team) => team.teamId === 'team-1')?.kills).toBe(
      24,
    );
    expect(result.teams.find((team) => team.teamId === 'team-2')?.kills).toBe(
      5,
    );
  });
});
