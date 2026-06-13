import { NotFoundException } from '@nestjs/common';
import { MatchStateService } from './match-state.service';

describe('MatchStateService', () => {
  it('stores and returns live match state from memory', () => {
    const realtime = { io: null } as any;
    const service = new MatchStateService(realtime);

    const state = service.update('match-1', {
      matchId: 'match-1',
      updatedAt: '2026-03-09T10:00:00.000Z',
      teamsAlive: 12,
      leaderboard: [
        {
          rank: 1,
          teamId: 'team-1',
          slot: 1,
          teamName: 'Alpha 7',
          teamTag: 'A7',
          logoUrl: null,
          color: null,
          kills: 9,
          alivePlayers: 4,
          totalPlayers: 4,
          placement: null,
          isEliminated: false,
        },
      ],
      killFeed: [],
      playerCard: null,
      circle: null,
      winner: null,
    });

    expect(state).toEqual(service.get('match-1'));
  });

  it('normalizes localhost media urls before caching match state', () => {
    const realtime = { io: null } as any;
    const service = new MatchStateService(realtime);

    const state = service.update('match-1', {
      matchId: 'match-1',
      updatedAt: '2026-03-09T10:00:00.000Z',
      teamsAlive: 1,
      leaderboard: [
        {
          rank: 1,
          teamId: 'team-1',
          slot: 1,
          teamName: 'Alpha 7',
          teamTag: 'A7',
          logoUrl: 'http://localhost:3000/media/teams/team-1/logo?v=123',
          color: null,
          kills: 9,
          alivePlayers: 4,
          totalPlayers: 4,
          placement: null,
          isEliminated: false,
          players: [
            {
              playerId: 'player-1',
              playerName: 'Alpha',
              avatarUrl:
                'http://localhost:3000/media/players/player-1/photo?v=123',
              kills: 1,
              alive: true,
              knocked: false,
              health: null,
              hasDied: false,
            },
          ],
        },
      ],
      killFeed: [],
      playerCard: {
        playerId: 'player-1',
        name: 'Alpha',
        avatarUrl: 'http://localhost:3000/media/players/player-1/photo?v=123',
        teamId: 'team-1',
        teamName: 'Alpha 7',
        teamTag: 'A7',
        logoUrl: 'http://localhost:3000/media/teams/team-1/logo?v=123',
        color: null,
        kills: 1,
        alive: true,
        damage: null,
      },
      circle: null,
      winner: {
        teamId: 'team-1',
        slot: 1,
        teamName: 'Alpha 7',
        teamTag: 'A7',
        logoUrl: 'http://localhost:3000/media/teams/team-1/logo?v=123',
        color: null,
        kills: 9,
        alivePlayers: 4,
        placement: 1,
      },
    });

    expect(state.leaderboard[0].logoUrl).toBe('/media/teams/team-1/logo?v=123');
    expect(state.leaderboard[0].players?.[0].avatarUrl).toBe(
      '/media/players/player-1/photo?v=123',
    );
    expect(state.playerCard?.logoUrl).toBe('/media/teams/team-1/logo?v=123');
    expect(state.playerCard?.avatarUrl).toBe(
      '/media/players/player-1/photo?v=123',
    );
    expect(state.winner?.logoUrl).toBe('/media/teams/team-1/logo?v=123');
  });

  it('returns an empty state when the cache is cold', () => {
    const realtime = { io: null } as any;
    const service = new MatchStateService(realtime);

    expect(service.get('match-1')).toMatchObject({
      matchId: 'match-1',
      teamsAlive: 0,
      leaderboard: [],
      killFeed: [],
      playerCard: null,
      winner: null,
    });
  });

  it('emits websocket match updates', () => {
    const realtime = {
      emitMatchScopedEvent: jest.fn(),
    } as any;
    const service = new MatchStateService(realtime);
    const payload = service.createEmptyState(
      'match-1',
      '2026-03-09T10:00:00.000Z',
    );

    service.emitMatchUpdate(payload);

    expect(realtime.emitMatchScopedEvent).toHaveBeenCalledWith(
      'match-1',
      'match:update',
      payload,
    );
  });

  it('emits websocket observer state updates with the clean leaderboard contract', () => {
    const realtime = {
      emitMatchScopedEvent: jest.fn(),
    } as any;
    const service = new MatchStateService(realtime);
    const payload = service.update('match-1', {
      matchId: 'match-1',
      updatedAt: '2026-03-09T10:00:00.000Z',
      teamsAlive: 12,
      leaderboard: [
        {
          rank: 1,
          teamId: 'team-1',
          slot: 1,
          teamName: 'Alpha 7',
          teamTag: 'A7',
          logoUrl: null,
          color: null,
          kills: 9,
          alivePlayers: 4,
          totalPlayers: 4,
          placement: null,
          isEliminated: false,
        },
      ],
      killFeed: [],
      playerCard: null,
      circle: null,
      winner: null,
    });

    service.emitObserverStateUpdate(payload);

    expect(realtime.emitMatchScopedEvent).toHaveBeenCalledWith(
      'match-1',
      'observer:state:update',
      {
        matchId: 'match-1',
        leaderboard: payload.leaderboard,
        teamsAlive: 12,
        timestamp: '2026-03-09T10:00:00.000Z',
      },
    );
  });

  it('emits websocket kill feed updates with a dedicated sequence payload', () => {
    const realtime = {
      emitMatchScopedEvent: jest.fn(),
    } as any;
    const service = new MatchStateService(realtime);
    const payload = service.update('match-1', {
      matchId: 'match-1',
      updatedAt: '2026-03-09T10:00:00.000Z',
      teamsAlive: 12,
      leaderboard: [],
      killFeed: [
        {
          id: 'kill-1',
          killerPlayerId: 'player-1',
          killerName: 'Alpha',
          killerTeamId: 'team-1',
          killerTeam: 'A7',
          victimPlayerId: 'player-2',
          victimName: 'Bravo',
          victimTeamId: 'team-2',
          victimTeam: 'B8',
          weapon: 'M416',
          tsIso: '2026-03-09T10:00:00.000Z',
          isKnock: false,
          isThirst: true,
          isSelf: false,
          isZone: false,
          isReviveRelated: false,
        },
      ],
      playerCard: null,
      circle: null,
      winner: null,
    });

    service.emitObserverKillFeedUpdate(payload);

    expect(realtime.emitMatchScopedEvent).toHaveBeenCalledWith(
      'match-1',
      'observer:killfeed:update',
      {
        matchId: 'match-1',
        entries: [
          {
            id: 'kill-1',
            timestamp: '2026-03-09T10:00:00.000Z',
            killerPlayerId: 'player-1',
            killerName: 'Alpha',
            killerTeamId: 'team-1',
            killerTeamName: 'A7',
            victimPlayerId: 'player-2',
            victimName: 'Bravo',
            victimTeamId: 'team-2',
            victimTeamName: 'B8',
            weapon: 'M416',
            isKnock: false,
            isThirst: true,
            isSelf: false,
            isZone: false,
            isReviveRelated: false,
          },
        ],
        sequence: 1,
        emittedAt: '2026-03-09T10:00:00.000Z',
      },
    );
  });

  it('emits websocket match winners', () => {
    const emitMatchWinner = jest.fn();
    const realtime = {
      io: null,
      emitMatchWinner,
    } as any;
    const service = new MatchStateService(realtime);

    service.emitMatchWinner({
      matchId: 'match-1',
      teamId: 'team-1',
      teamName: 'Alpha 7',
      teamTag: 'A7',
      logoUrl: 'https://cdn.example.com/a7.png',
    });

    expect(emitMatchWinner).toHaveBeenCalledWith({
      matchId: 'match-1',
      teamId: 'team-1',
      teamName: 'Alpha 7',
      teamTag: 'A7',
      logoUrl: 'https://cdn.example.com/a7.png',
    });
  });

  it('rejects blank match ids', () => {
    const realtime = { io: null } as any;
    const service = new MatchStateService(realtime);

    expect(() => service.get('')).toThrow(NotFoundException);
  });
});
