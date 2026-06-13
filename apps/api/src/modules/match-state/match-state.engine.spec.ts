import { MatchStateEngine } from './match-state.engine';

describe('MatchStateEngine', () => {
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
      alivePlayers: 1,
      totalPlayers: 1,
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
      alivePlayers: 1,
      totalPlayers: 1,
    },
  ];

  it('keeps AUTO matches live when teams exist but telemetry players have not appeared yet', () => {
    const engine = new MatchStateEngine();

    const result = engine.syncAutoMatch({
      matchId: 'match-live',
      sourceMode: 'AUTO',
      status: 'LIVE',
      startedAt: '2026-03-08T00:00:00.000Z',
      teams: [
        {
          ...baseTeams()[0],
          alivePlayers: 4,
          totalPlayers: 4,
        },
        {
          ...baseTeams()[1],
          alivePlayers: 4,
          totalPlayers: 4,
        },
      ],
      totalPlayerList: null,
      killEvents: [],
    });

    expect(result).not.toBeNull();
    expect(result?.finished).toBe(false);
    expect(result?.status).toBe('LIVE');
    expect(result?.summary.aliveTeams).toBe(2);
    expect(result?.teams.map((team) => team.placement)).toEqual([null, null]);
    expect(result?.teams.map((team) => team.hasTelemetryPresence)).toEqual([
      false,
      false,
    ]);
  });

  it('does not eliminate or auto-end AUTO matches when telemetry has not started yet', () => {
    const engine = new MatchStateEngine();

    const result = engine.syncAutoMatch({
      matchId: 'match-waiting',
      sourceMode: 'AUTO',
      status: 'LIVE',
      startedAt: '2026-03-08T00:00:00.000Z',
      teams: [
        {
          ...baseTeams()[0],
          alivePlayers: 0,
          totalPlayers: 0,
        },
        {
          ...baseTeams()[1],
          alivePlayers: 0,
          totalPlayers: 0,
        },
      ],
      totalPlayerList: null,
      killEvents: [],
    });

    expect(result).not.toBeNull();
    expect(result?.finished).toBe(false);
    expect(result?.status).toBe('LIVE');
    expect(result?.summary.aliveTeams).toBe(2);
    expect(
      result?.teams.every((team) => team.hasTelemetryPresence === false),
    ).toBe(true);
    expect(result?.events.map((event) => event.type)).not.toEqual(
      expect.arrayContaining(['TEAM_ELIMINATED', 'MATCH_ENDED']),
    );
  });

  it('does not eliminate or auto-end from plane/parachuting death snapshots', () => {
    const engine = new MatchStateEngine();

    engine.syncAutoMatch({
      matchId: 'match-air',
      sourceMode: 'AUTO',
      status: 'LIVE',
      startedAt: '2026-03-08T00:00:00.000Z',
      teams: [
        {
          ...baseTeams()[0],
          alivePlayers: 1,
          totalPlayers: 1,
        },
        {
          ...baseTeams()[1],
          alivePlayers: 1,
          totalPlayers: 1,
        },
      ],
      totalPlayerList: {
        players: [
          {
            teamId: 'team-1',
            externalPlayerId: 'player-1',
            name: 'Ace',
            isAlive: true,
          },
          {
            teamId: 'team-2',
            externalPlayerId: 'player-2',
            name: 'Brick',
            isAlive: true,
          },
        ],
      },
      circle: { phase: 0 },
      killEvents: [],
    });

    const result = engine.syncAutoMatch({
      matchId: 'match-air',
      sourceMode: 'AUTO',
      status: 'LIVE',
      startedAt: '2026-03-08T00:00:00.000Z',
      teams: [
        {
          ...baseTeams()[0],
          alivePlayers: 0,
          totalPlayers: 1,
        },
        {
          ...baseTeams()[1],
          alivePlayers: 0,
          totalPlayers: 1,
        },
      ],
      totalPlayerList: {
        players: [
          {
            teamId: 'team-1',
            externalPlayerId: 'player-1',
            name: 'Ace',
            isAlive: false,
          },
          {
            teamId: 'team-2',
            externalPlayerId: 'player-2',
            name: 'Brick',
            isAlive: false,
          },
        ],
      },
      circle: { phase: 1 },
      killEvents: [
        {
          type: 'PLAYER_KILL',
          matchId: 'match-air',
          killerPlayerExternalId: 'player-1',
          victimPlayerExternalId: 'player-2',
          killerTeamId: 'team-1',
          victimTeamId: 'team-2',
          timestamp: Date.now(),
        },
      ],
    });

    expect(result?.finished).toBe(false);
    expect(result?.status).toBe('LIVE');
    expect(result?.summary.aliveTeams).toBe(2);
    expect(result?.summary.alivePlayers).toBe(2);
    expect(result?.events.map((event) => event.type)).not.toEqual(
      expect.arrayContaining(['PLAYER_DIED', 'TEAM_ELIMINATED', 'MATCH_ENDED']),
    );
  });

  it('extracts telemetry players from wrapped totalmessage payloads', () => {
    const engine = new MatchStateEngine();

    const result = engine.syncAutoMatch({
      matchId: 'match-wrapped-totalmessage',
      sourceMode: 'AUTO',
      status: 'LIVE',
      startedAt: '2026-03-08T00:00:00.000Z',
      teams: [
        {
          ...baseTeams()[0],
          alivePlayers: 4,
          totalPlayers: 4,
        },
        {
          ...baseTeams()[1],
          alivePlayers: 4,
          totalPlayers: 4,
        },
      ],
      totalPlayerList: {
        totalmessage: {
          TotalPlayerList: [
            {
              teamId: 'team-1',
              externalPlayerId: 'player-1',
              name: 'Ace',
              isAlive: true,
            },
            {
              teamId: 'team-2',
              externalPlayerId: 'player-2',
              name: 'Brick',
              isAlive: true,
            },
          ],
        },
      },
      killEvents: [],
    });

    expect(result).not.toBeNull();
    expect(result?.summary.aliveTeams).toBe(2);
    expect(
      result?.teams.find((team) => team.teamId === 'team-1')?.players,
    ).toHaveLength(1);
    expect(
      result?.teams.find((team) => team.teamId === 'team-1')
        ?.hasTelemetryPresence,
    ).toBe(true);
    expect(
      result?.teams.find((team) => team.teamId === 'team-2')
        ?.hasTelemetryPresence,
    ).toBe(true);
  });

  it('extracts telemetry players from playerInfoList payloads', () => {
    const engine = new MatchStateEngine();

    const result = engine.syncAutoMatch({
      matchId: 'match-player-info-list',
      sourceMode: 'AUTO',
      status: 'LIVE',
      startedAt: '2026-03-08T00:00:00.000Z',
      teams: [
        {
          ...baseTeams()[0],
          alivePlayers: 4,
          totalPlayers: 4,
        },
        {
          ...baseTeams()[1],
          alivePlayers: 4,
          totalPlayers: 4,
        },
      ],
      totalPlayerList: {
        playerInfoList: [
          {
            teamId: 'team-1',
            externalPlayerId: 'player-1',
            name: 'Ace',
            isAlive: true,
          },
          {
            teamId: 'team-2',
            externalPlayerId: 'player-2',
            name: 'Brick',
            isAlive: true,
          },
        ],
      },
      killEvents: [],
    });

    expect(result).not.toBeNull();
    expect(result?.summary.aliveTeams).toBe(2);
    expect(
      result?.teams.find((team) => team.teamId === 'team-1')?.players,
    ).toHaveLength(1);
    expect(
      result?.teams.find((team) => team.teamId === 'team-2')?.players,
    ).toHaveLength(1);
  });

  it('preserves higher team kill totals from telemetry when tracked player kills lag behind', () => {
    const engine = new MatchStateEngine();

    engine.syncAutoMatch({
      matchId: 'match-team-kills',
      sourceMode: 'AUTO',
      status: 'LIVE',
      startedAt: '2026-03-08T00:00:00.000Z',
      teams: baseTeams(),
      totalPlayerList: null,
      killEvents: [
        {
          type: 'PLAYER_KILL',
          matchId: 'match-team-kills',
          killerPlayerExternalId: 'player-1',
          victimPlayerExternalId: 'player-2',
          killerTeamId: 'team-1',
          victimTeamId: 'team-2',
          timestamp: 1000,
        },
      ],
    });

    const result = engine.syncAutoMatch({
      matchId: 'match-team-kills',
      sourceMode: 'AUTO',
      status: 'LIVE',
      startedAt: '2026-03-08T00:00:00.000Z',
      teams: [
        {
          ...baseTeams()[0],
          kills: 4,
        },
        {
          ...baseTeams()[1],
          kills: 0,
        },
      ],
      totalPlayerList: null,
      killEvents: [],
    });

    expect(result).not.toBeNull();
    expect(result?.teams.find((team) => team.teamId === 'team-1')?.kills).toBe(
      4,
    );
  });

  it('applies kill events once, eliminates teams, and assigns placements deterministically', () => {
    const engine = new MatchStateEngine();

    const first = engine.syncAutoMatch({
      matchId: 'match-ended',
      sourceMode: 'AUTO',
      status: 'LIVE',
      startedAt: '2026-03-08T00:00:00.000Z',
      teams: baseTeams(),
      totalPlayerList: {
        TotalPlayerList: [
          {
            teamId: 'team-1',
            externalPlayerId: 'player-1',
            name: 'Ace',
            isAlive: true,
          },
          {
            teamId: 'team-2',
            externalPlayerId: 'player-2',
            name: 'Brick',
            isAlive: true,
          },
        ],
      },
      killEvents: [
        {
          type: 'PLAYER_KILL',
          matchId: 'match-ended',
          killerPlayerExternalId: 'player-1',
          victimPlayerExternalId: 'player-2',
          killerTeamId: 'team-1',
          victimTeamId: 'team-2',
          killerPlayerName: 'Ace',
          victimPlayerName: 'Brick',
          timestamp: 1_000,
        },
      ],
    });

    expect(first).not.toBeNull();
    expect(first?.finished).toBe(true);
    expect(first?.status).toBe('FINISH_PENDING');
    expect(first?.summary.aliveTeams).toBe(1);
    expect(
      first?.teams.find((team) => team.teamId === 'team-1')
        ?.hasTelemetryPresence,
    ).toBe(true);
    expect(
      first?.teams.find((team) => team.teamId === 'team-2')
        ?.hasTelemetryPresence,
    ).toBe(true);
    expect(first?.teams.find((team) => team.teamId === 'team-1')?.kills).toBe(
      1,
    );
    expect(
      first?.teams.find((team) => team.teamId === 'team-1')?.placement,
    ).toBe(1);
    expect(
      first?.teams.find((team) => team.teamId === 'team-2')?.placement,
    ).toBe(2);
    expect(first?.events.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        'MATCH_STARTED',
        'PLAYER_SEEN',
        'PLAYER_KILL',
        'PLAYER_DIED',
        'TEAM_ELIMINATED',
        'MATCH_ENDED',
      ]),
    );
    expect(first?.killFeed).toHaveLength(1);

    const second = engine.syncAutoMatch({
      matchId: 'match-ended',
      sourceMode: 'AUTO',
      status: 'LIVE',
      startedAt: '2026-03-08T00:00:00.000Z',
      teams: baseTeams(),
      totalPlayerList: {
        TotalPlayerList: [
          {
            teamId: 'team-1',
            externalPlayerId: 'player-1',
            name: 'Ace',
            isAlive: true,
          },
          {
            teamId: 'team-2',
            externalPlayerId: 'player-2',
            name: 'Brick',
            isAlive: true,
          },
        ],
      },
      killEvents: [
        {
          type: 'PLAYER_KILL',
          matchId: 'match-ended',
          killerPlayerExternalId: 'player-1',
          victimPlayerExternalId: 'player-2',
          killerTeamId: 'team-1',
          victimTeamId: 'team-2',
          killerPlayerName: 'Ace',
          victimPlayerName: 'Brick',
          timestamp: 1_000,
        },
      ],
    });

    expect(second).not.toBeNull();
    expect(second?.teams.find((team) => team.teamId === 'team-1')?.kills).toBe(
      1,
    );
    expect(second?.killFeed).toHaveLength(0);
    expect(
      second?.events.filter((event) => event.type === 'PLAYER_KILL'),
    ).toHaveLength(0);
    expect(second?.status).toBe('FINISH_PENDING');
  });

  it('ignores non-AUTO sources', () => {
    const engine = new MatchStateEngine();

    const result = engine.syncAutoMatch({
      matchId: 'manual-match',
      sourceMode: 'MANUAL',
      status: 'LIVE',
      teams: baseTeams(),
      killEvents: [],
    });

    expect(result).toBeNull();
  });

  it('uses the last player death timestamp and deterministic tie-breakers for placements', () => {
    const engine = new MatchStateEngine();

    const result = engine.syncAutoMatch({
      matchId: 'match-tiebreak',
      sourceMode: 'AUTO',
      status: 'LIVE',
      startedAt: '2026-03-08T00:00:00.000Z',
      teams: [
        {
          teamId: 'team-1',
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
          teamId: 'team-2',
          name: 'Bravo',
          tag: 'BRV',
          slot: 2,
          kills: 0,
          placement: null,
          points: null,
          logoUrl: null,
          alivePlayers: 1,
          totalPlayers: 1,
        },
        {
          teamId: 'team-3',
          name: 'Charlie',
          tag: 'CHR',
          slot: 3,
          kills: 0,
          placement: null,
          points: null,
          logoUrl: null,
          alivePlayers: 1,
          totalPlayers: 1,
        },
        {
          teamId: 'team-4',
          name: 'Delta',
          tag: 'DLT',
          slot: 4,
          kills: 0,
          placement: null,
          points: null,
          logoUrl: null,
          alivePlayers: 1,
          totalPlayers: 1,
        },
        {
          teamId: 'team-5',
          name: 'Echo',
          tag: 'ECH',
          slot: 5,
          kills: 0,
          placement: null,
          points: null,
          logoUrl: null,
          alivePlayers: 1,
          totalPlayers: 1,
        },
      ],
      totalPlayerList: {
        TotalPlayerList: [
          {
            teamId: 'team-1',
            externalPlayerId: 'player-1a',
            name: 'Alpha One',
            isAlive: true,
          },
          {
            teamId: 'team-1',
            externalPlayerId: 'player-1b',
            name: 'Alpha Two',
            isAlive: true,
          },
          {
            teamId: 'team-2',
            externalPlayerId: 'player-2',
            name: 'Bravo One',
            isAlive: true,
          },
          {
            teamId: 'team-3',
            externalPlayerId: 'player-3',
            name: 'Charlie One',
            isAlive: true,
          },
          {
            teamId: 'team-4',
            externalPlayerId: 'player-4',
            name: 'Delta One',
            isAlive: true,
          },
          {
            teamId: 'team-5',
            externalPlayerId: 'player-5',
            name: 'Echo One',
            isAlive: true,
          },
        ],
      },
      killEvents: [
        {
          type: 'PLAYER_KILL',
          matchId: 'match-tiebreak',
          killerPlayerExternalId: 'player-1a',
          victimPlayerExternalId: 'player-4',
          killerTeamId: 'team-1',
          victimTeamId: 'team-4',
          killerPlayerName: 'Alpha One',
          victimPlayerName: 'Delta One',
          timestamp: 800,
        },
        {
          type: 'PLAYER_KILL',
          matchId: 'match-tiebreak',
          killerPlayerExternalId: 'player-3',
          victimPlayerExternalId: 'player-5',
          killerTeamId: 'team-3',
          victimTeamId: 'team-5',
          killerPlayerName: 'Charlie One',
          victimPlayerName: 'Echo One',
          timestamp: 850,
        },
        {
          type: 'PLAYER_KILL',
          matchId: 'match-tiebreak',
          killerPlayerExternalId: 'player-3',
          victimPlayerExternalId: 'player-1a',
          killerTeamId: 'team-3',
          victimTeamId: 'team-1',
          killerPlayerName: 'Charlie One',
          victimPlayerName: 'Alpha One',
          timestamp: 1000,
        },
        {
          type: 'PLAYER_KILL',
          matchId: 'match-tiebreak',
          killerPlayerExternalId: 'player-3',
          victimPlayerExternalId: 'player-2',
          killerTeamId: 'team-3',
          victimTeamId: 'team-2',
          killerPlayerName: 'Charlie One',
          victimPlayerName: 'Bravo One',
          timestamp: 1000,
        },
        {
          type: 'PLAYER_KILL',
          matchId: 'match-tiebreak',
          killerPlayerExternalId: 'player-3',
          victimPlayerExternalId: 'player-1b',
          killerTeamId: 'team-3',
          victimTeamId: 'team-1',
          killerPlayerName: 'Charlie One',
          victimPlayerName: 'Alpha Two',
          timestamp: 1200,
        },
      ],
    });

    expect(result).not.toBeNull();
    expect(result?.status).toBe('FINISH_PENDING');
    expect(
      result?.teams.find((team) => team.teamId === 'team-4')?.placement,
    ).toBe(5);
    expect(
      result?.teams.find((team) => team.teamId === 'team-5')?.placement,
    ).toBe(4);
    expect(
      result?.teams.find((team) => team.teamId === 'team-2')?.placement,
    ).toBe(3);
    expect(
      result?.teams.find((team) => team.teamId === 'team-1')?.placement,
    ).toBe(2);
    expect(
      result?.teams.find((team) => team.teamId === 'team-3')?.placement,
    ).toBe(1);
    expect(result?.teams.find((team) => team.teamId === 'team-1')?.kills).toBe(
      1,
    );
  });
});
