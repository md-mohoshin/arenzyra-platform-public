import type { LiveMatchState } from '../match-control/state.store';
import type {
  MatchState,
  MatchStateLeaderboardRow,
} from './match-state.service';
import {
  chooseLiveState,
  mergeLeaderboardRows,
  needsTelemetryFallback,
  rankPlayingLeaderboardRows,
} from './observer-live-widget-rules.util';

const liveState = (
  teams: Array<Partial<LiveMatchState['teams'][number]> & { teamId: string }>,
  aliveTeams = teams.filter((team) => (team.alivePlayers ?? 0) > 0).length,
): LiveMatchState =>
  ({
    matchId: 'match-1',
    status: 'LIVE',
    startedAt: null,
    endedAt: null,
    version: 1,
    updatedAt: '2026-05-31T00:00:00.000Z',
    summary: { aliveTeams },
    teams: teams as LiveMatchState['teams'],
  }) as LiveMatchState;

const row = (
  patch: Partial<MatchStateLeaderboardRow> & Record<string, unknown>,
): MatchStateLeaderboardRow => ({
  rank: 1,
  teamId: patch.teamId ?? null,
  slot: patch.slot ?? null,
  teamName: patch.teamName ?? 'Team',
  teamTag: patch.teamTag ?? null,
  logoUrl: patch.logoUrl ?? null,
  color: patch.color ?? null,
  kills: patch.kills ?? 0,
  alivePlayers: patch.alivePlayers ?? 0,
  totalPlayers: patch.totalPlayers ?? null,
  placement: patch.placement ?? null,
  isEliminated: patch.isEliminated ?? false,
  players: patch.players,
  ...patch,
});

describe('observer live widget rules', () => {
  it('chooses the live state with the fuller alive-team signal', () => {
    const sparse = liveState([
      {
        teamId: 'team-1',
        name: 'Team One',
        tag: null,
        slot: 1,
        kills: 0,
        placement: null,
        points: null,
        logoUrl: null,
        alivePlayers: 0,
        totalPlayers: 0,
        alive: false,
        eliminated: true,
        players: [],
      },
    ]);
    const fuller = liveState([
      {
        teamId: 'team-1',
        name: 'Team One',
        tag: null,
        slot: 1,
        kills: 0,
        placement: null,
        points: null,
        logoUrl: null,
        alivePlayers: 4,
        totalPlayers: 4,
        alive: true,
        eliminated: false,
        players: [],
      },
      {
        teamId: 'team-2',
        name: 'Team Two',
        tag: null,
        slot: 2,
        kills: 0,
        placement: null,
        points: null,
        logoUrl: null,
        alivePlayers: 3,
        totalPlayers: 4,
        alive: true,
        eliminated: false,
        players: [],
      },
    ]);

    expect(chooseLiveState(sparse, fuller)).toBe(fuller);
  });

  it('requests telemetry fallback when observer teams-alive exceeds live rows', () => {
    const observer = {
      matchId: 'match-1',
      updatedAt: '2026-05-31T00:00:00.000Z',
      teamsAlive: 2,
      leaderboard: [],
      killFeed: [],
      playerCard: null,
      circle: null,
      winner: null,
    } satisfies MatchState;
    const sparseLive = liveState([
      {
        teamId: 'team-1',
        name: 'Team One',
        tag: null,
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
    ]);

    expect(needsTelemetryFallback(observer, sparseLive)).toBe(true);
  });

  it('merges live rows with observer identity while trusting fresh life telemetry', () => {
    const result = mergeLeaderboardRows(
      [
        row({
          teamId: 'team-1',
          slot: 1,
          teamName: '[live] slot 1',
          alivePlayers: 4,
          totalPlayers: 4,
          players: [
            {
              playerId: 'p1',
              playerName: 'Alpha',
              avatarUrl: null,
              kills: 1,
              alive: true,
              knocked: false,
              health: 100,
              hasDied: false,
              lifeTelemetryFresh: true,
            },
            {
              playerId: 'p2',
              playerName: 'Beta',
              avatarUrl: null,
              kills: 0,
              alive: false,
              knocked: false,
              health: 0,
              hasDied: true,
              lifeTelemetryFresh: true,
            },
          ],
        }),
      ],
      [
        row({
          teamId: 'team-1',
          slot: 1,
          teamName: 'Real Team Name',
          teamTag: 'RTN',
          logoUrl: '/media/teams/team-1/logo',
          alivePlayers: 4,
          totalPlayers: 4,
        }),
      ],
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      rank: 1,
      teamName: 'Real Team Name',
      teamTag: 'RTN',
      alivePlayers: 1,
      isEliminated: false,
    });
  });

  it('filters explicit no-show leaderboard rows before ranking', () => {
    const result = rankPlayingLeaderboardRows([
      row({
        teamId: 'team-no-show',
        teamName: 'No Show',
        alivePlayers: 0,
        wasPresentInMatch: false,
      }),
      row({
        teamId: 'team-active',
        teamName: 'Active Team',
        alivePlayers: 4,
        totalPlayers: 4,
      }),
    ]);

    expect(result.map((entry) => entry.teamId)).toEqual(['team-active']);
    expect(result[0]?.rank).toBe(1);
  });
});
