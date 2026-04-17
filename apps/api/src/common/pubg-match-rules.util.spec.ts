import {
  derivePubgMatchState,
  derivePubgTeamState,
} from './pubg-match-rules.util';

describe('pubg-match-rules', () => {
  it('prevents the last alive player from remaining knocked', () => {
    const team = derivePubgTeamState({
      eliminationMarker: new Date('2026-03-19T10:00:00.000Z'),
      team: {
        teamId: 'team-1',
        players: [
          {
            id: 'player-1',
            teamId: 'team-1',
            kills: 2,
            alive: true,
            knocked: true,
          },
        ],
      },
    });

    expect(team.aliveCount).toBe(1);
    expect(team.standingCount).toBe(1);
    expect(team.eliminated).toBe(false);
    expect(team.players[0]).toMatchObject({
      id: 'player-1',
      alive: true,
      knocked: false,
    });
  });

  it('derives placements from normalized elimination order once per match', () => {
    const match = derivePubgMatchState({
      eliminationMarker: new Date('2026-03-19T10:00:00.000Z'),
      teams: [
        {
          teamId: 'team-1',
          sortKey: '0001',
          eliminatedOrder: 2,
          players: [
            { id: 'p1', teamId: 'team-1', alive: false, knocked: false },
          ],
        },
        {
          teamId: 'team-2',
          sortKey: '0002',
          eliminatedOrder: 1,
          players: [
            { id: 'p2', teamId: 'team-2', alive: false, knocked: false },
          ],
        },
        {
          teamId: 'team-3',
          sortKey: '0003',
          players: [
            { id: 'p3', teamId: 'team-3', alive: true, knocked: false },
          ],
        },
      ],
    });

    expect(match.aliveTeams).toBe(1);
    expect(
      match.teams.find((team) => team.teamId === 'team-3')?.placement,
    ).toBe(1);
    expect(
      match.teams.find((team) => team.teamId === 'team-1')?.placement,
    ).toBe(2);
    expect(
      match.teams.find((team) => team.teamId === 'team-2')?.placement,
    ).toBe(3);
  });

  it('uses explicit team kill override only when manualTotalKills is enabled', () => {
    const match = derivePubgMatchState({
      eliminationMarker: new Date('2026-03-19T10:00:00.000Z'),
      teams: [
        {
          teamId: 'team-1',
          manualTotalKills: false,
          totalKillsOverride: 99,
          players: [
            {
              id: 'p1',
              teamId: 'team-1',
              kills: 2,
              alive: true,
              knocked: false,
            },
            {
              id: 'p2',
              teamId: 'team-1',
              kills: 1,
              alive: true,
              knocked: false,
            },
          ],
        },
        {
          teamId: 'team-2',
          manualTotalKills: true,
          totalKillsOverride: 7,
          players: [
            {
              id: 'p3',
              teamId: 'team-2',
              kills: 0,
              alive: true,
              knocked: false,
            },
          ],
        },
      ],
    });

    expect(
      match.teams.find((team) => team.teamId === 'team-1')?.teamKills,
    ).toBe(3);
    expect(
      match.teams.find((team) => team.teamId === 'team-2')?.teamKills,
    ).toBe(7);
  });
});
