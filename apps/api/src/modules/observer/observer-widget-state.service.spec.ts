import { MatchStateService } from './match-state.service';
import { ObserverWidgetStateService } from './observer-widget-state.service';
import { CanonicalControlReadService } from '../realtime/canonical-control-read.service';
import { TelemetryBroadcastService } from '../telemetry/telemetry-broadcast.service';
import { TelemetryEngineService } from '../telemetry/telemetry-engine.service';
import type { PrismaService } from '../../db/prisma.service';

describe('ObserverWidgetStateService', () => {
  it('returns cached match state', async () => {
    const matchState = {
      get: jest.fn().mockReturnValue({
        matchId: 'match-1',
        updatedAt: '2026-03-09T10:00:00.000Z',
        teamsAlive: 3,
        leaderboard: [],
        killFeed: [],
        playerCard: null,
        circle: null,
        winner: null,
      }),
      emitMatchUpdate: jest.fn(),
    } as unknown as MatchStateService;
    const canonicalRead = {
      getStateSnapshot: jest.fn().mockResolvedValue(null),
    } as unknown as CanonicalControlReadService;

    const service = new ObserverWidgetStateService(matchState, canonicalRead);
    await expect(service.getMatchUpdate('match-1')).resolves.toEqual({
      matchId: 'match-1',
      updatedAt: '2026-03-09T10:00:00.000Z',
      teamsAlive: 3,
      leaderboard: [],
      killFeed: [],
      playerCard: null,
      circle: null,
      winner: null,
    });
    expect((matchState.get as jest.Mock).mock.calls).toEqual([['match-1']]);
    expect((canonicalRead.getStateSnapshot as jest.Mock).mock.calls).toEqual([
      ['match-1'],
    ]);
  });

  it('delegates websocket emission to the cache service', () => {
    const matchState = {
      get: jest.fn(),
      emitMatchUpdate: jest.fn(),
    } as unknown as MatchStateService;

    const payload = {
      matchId: 'match-1',
      updatedAt: '2026-03-09T10:00:00.000Z',
      teamsAlive: 1,
      leaderboard: [],
      killFeed: [],
      playerCard: null,
      circle: null,
      winner: null,
    };
    const canonicalRead = {
      getStateSnapshot: jest.fn().mockResolvedValue(null),
    } as unknown as CanonicalControlReadService;

    const service = new ObserverWidgetStateService(matchState, canonicalRead);
    service.emitMatchUpdate(payload);

    expect((matchState.emitMatchUpdate as jest.Mock).mock.calls).toEqual([
      [payload],
    ]);
  });

  it('merges live match cache fields into observer widget state', async () => {
    const matchState = {
      get: jest.fn().mockReturnValue({
        matchId: 'match-1',
        updatedAt: '2026-03-09T10:00:00.000Z',
        teamsAlive: 3,
        leaderboard: [],
        killFeed: [],
        playerCard: null,
        circle: null,
        winner: null,
      }),
      emitMatchUpdate: jest.fn(),
    } as unknown as MatchStateService;
    const canonicalRead = {
      getStateSnapshot: jest.fn().mockResolvedValue({
        matchId: 'match-1',
        updatedAt: '2026-03-09T10:00:05.000Z',
        summary: { aliveTeams: 2 },
        circle: {
          phase: 4,
          nextShrinkAt: Date.parse('2026-03-09T10:00:25.000Z'),
          safeZone: null,
          nextZone: null,
        },
        observedPlayer: {
          playerId: 'player-1',
          playerName: 'Alpha',
          teamId: 'team-1',
          teamName: 'Team One',
          teamTag: 'T1',
          teamLogoUrl: '/logo.png',
        },
        killFeed: [],
        teams: [
          {
            teamId: 'team-1',
            slot: 1,
            name: 'Team One',
            tag: 'T1',
            logoUrl: '/logo.png',
            kills: 2,
            placement: 1,
            points: null,
            alivePlayers: 2,
            totalPlayers: 4,
            alive: true,
            eliminated: false,
            players: [
              {
                id: 'player-1',
                playerId: 'player-1',
                name: 'Alpha',
                ign: 'Alpha',
                avatarUrl: '/alpha.png',
                alive: true,
                knocked: false,
                kills: 2,
              },
            ],
          },
        ],
      }),
    } as unknown as CanonicalControlReadService;

    const service = new ObserverWidgetStateService(matchState, canonicalRead);
    const result = await service.getMatchUpdate('match-1');

    expect(result.teamsAlive).toBe(2);
    expect(result.circle).toEqual({
      phase: 4,
      nextShrinkAt: '2026-03-09T10:00:25.000Z',
      safeZone: null,
      nextZone: null,
    });
    expect(result.playerCard).toEqual({
      playerId: 'player-1',
      name: 'Alpha',
      avatarUrl: '/alpha.png',
      teamId: 'team-1',
      teamName: 'Team One',
      teamTag: 'T1',
      logoUrl: '/logo.png',
      color: null,
      kills: 2,
      alive: true,
      damage: null,
    });
    expect(result.leaderboard[0]).toMatchObject({
      teamId: 'team-1',
      teamName: 'Team One',
      teamTag: 'T1',
      kills: 2,
      alivePlayers: 2,
    });
    expect(result.winner).toBeNull();
  });

  it('hydrates missing live player photos from saved player records', async () => {
    const matchState = {
      get: jest.fn().mockReturnValue({
        matchId: 'match-1',
        updatedAt: '2026-03-09T10:00:00.000Z',
        teamsAlive: 0,
        leaderboard: [],
        killFeed: [],
        playerCard: null,
        circle: null,
        winner: null,
      }),
      emitMatchUpdate: jest.fn(),
    } as unknown as MatchStateService;
    const canonicalRead = {
      getStateSnapshot: jest.fn().mockResolvedValue({
        matchId: 'match-1',
        updatedAt: '2026-03-09T10:00:05.000Z',
        summary: { aliveTeams: 1 },
        circle: null,
        observedPlayer: {
          playerId: 'player-1',
          playerName: 'Alpha',
          teamId: 'team-1',
          teamName: 'Team One',
          teamTag: 'T1',
          teamLogoUrl: null,
        },
        killFeed: [],
        teams: [
          {
            teamId: 'team-1',
            slot: 1,
            name: 'Team One',
            tag: 'T1',
            logoUrl: null,
            kills: 0,
            placement: null,
            points: null,
            alivePlayers: 2,
            totalPlayers: 2,
            alive: true,
            eliminated: false,
            players: [
              {
                id: 'player-1',
                playerId: 'player-1',
                name: 'Alpha',
                ign: 'Alpha',
                avatarUrl: null,
                alive: true,
                knocked: false,
                kills: 0,
              },
              {
                id: 'slot-player:team-1:2',
                playerId: 'slot-player:team-1:2',
                externalPlayerId: 'pubg-beta',
                pubgPlayerId: 'pubg-beta',
                name: 'Beta',
                ign: 'Beta',
                avatarUrl: null,
                alive: true,
                knocked: false,
                kills: 0,
              },
            ],
          },
        ],
      }),
    } as unknown as CanonicalControlReadService;
    const prisma = {
      player: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'player-1',
            ign: 'Alpha',
            teamId: 'team-1',
            photoUrl: '/media/players/player-1/photo?v=100',
          },
          {
            id: 'player-2',
            ign: 'Beta from roster',
            teamId: 'team-1',
            externalPlayerId: 'pubg-beta',
            pubgPlayerId: 'pubg-beta',
            photoUrl:
              'https://api.arenzyra.com/media/players/player-2/photo?v=200',
          },
        ]),
      },
    };

    const service = new ObserverWidgetStateService(
      matchState,
      canonicalRead,
      undefined,
      undefined,
      prisma as unknown as PrismaService,
    );
    const result = await service.getMatchUpdate('match-1');

    expect(result.playerCard?.avatarUrl).toBe(
      '/media/players/player-1/photo?v=100',
    );
    expect(
      result.leaderboard[0]?.players?.map((player) => player.avatarUrl),
    ).toEqual([
      '/media/players/player-1/photo?v=100',
      'https://api.arenzyra.com/media/players/player-2/photo?v=200',
    ]);
    expect(prisma.player.findMany).toHaveBeenCalledTimes(1);
  });

  it('uses the latest raw observer uid for the player photo card', async () => {
    const matchState = {
      get: jest.fn().mockReturnValue({
        matchId: 'match-1',
        updatedAt: '2026-03-09T10:00:00.000Z',
        teamsAlive: 2,
        leaderboard: [],
        killFeed: [],
        playerCard: {
          playerId: 'player-silent',
          name: 'ATSilentxxx',
          avatarUrl: null,
          teamId: 'team-3',
          teamName: 'Team 3',
          teamTag: 'T3',
          logoUrl: null,
          color: null,
          kills: 3,
          alive: true,
          damage: null,
        },
        circle: null,
        winner: null,
      }),
      emitMatchUpdate: jest.fn(),
    } as unknown as MatchStateService;
    const canonicalRead = {
      getStateSnapshot: jest.fn().mockResolvedValue({
        matchId: 'match-1',
        updatedAt: '2026-03-09T10:00:05.000Z',
        summary: { aliveTeams: 2 },
        circle: null,
        observedPlayer: null,
        killFeed: [],
        teams: [
          {
            teamId: 'team-7sins',
            slot: 3,
            name: '7sins',
            tag: '7SINS',
            logoUrl: null,
            kills: 0,
            placement: null,
            points: null,
            alivePlayers: 1,
            totalPlayers: 1,
            alive: true,
            eliminated: false,
            players: [
              {
                id: 'player-chicky-duplicate',
                playerId: 'player-chicky-duplicate',
                name: 'iChickyX',
                ign: 'iChickyX',
                avatarUrl: '/assets/defaults/default-player.png',
                alive: true,
                knocked: false,
                kills: 0,
              },
            ],
          },
          {
            teamId: 'team-3',
            slot: 15,
            name: 'Team 3',
            tag: 'T3',
            logoUrl: null,
            kills: 3,
            placement: null,
            points: null,
            alivePlayers: 1,
            totalPlayers: 1,
            alive: true,
            eliminated: false,
            players: [
              {
                id: 'player-silent',
                playerId: 'player-silent',
                externalPlayerId: '5124121303',
                pubgPlayerId: '5124121303',
                name: 'ATSilentxxx',
                ign: 'ATSilentxxx',
                avatarUrl: null,
                alive: true,
                knocked: false,
                kills: 3,
              },
            ],
          },
          {
            teamId: 'team-7sins',
            slot: 3,
            name: '7sins',
            tag: '7SINS',
            logoUrl: null,
            kills: 1,
            placement: null,
            points: null,
            alivePlayers: 1,
            totalPlayers: 1,
            alive: true,
            eliminated: false,
            players: [
              {
                id: 'player-chicky',
                playerId: 'player-chicky',
                externalPlayerId: '5679403465',
                pubgPlayerId: '5679403465',
                name: 'iChickyX',
                ign: 'iChickyX',
                avatarUrl: null,
                alive: true,
                knocked: false,
                kills: 0,
              },
            ],
          },
        ],
      }),
    } as unknown as CanonicalControlReadService;
    const prisma = {
      matchTelemetry: {
        findUnique: jest.fn().mockResolvedValue({
          payload: {
            raw: {
              observer: {
                0: '5679403465',
                GunADS: 'false',
              },
            },
          },
        }),
      },
      player: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'player-chicky',
            ign: 'iChickyX',
            teamId: 'team-7sins',
            externalPlayerId: '5679403465',
            pubgPlayerId: '5679403465',
            photoUrl: '/media/players/player-chicky/photo?v=123',
          },
        ]),
      },
    };

    const service = new ObserverWidgetStateService(
      matchState,
      canonicalRead,
      undefined,
      undefined,
      prisma as unknown as PrismaService,
    );
    const result = await service.getMatchUpdate('match-1');

    expect(result.playerCard).toMatchObject({
      playerId: 'player-chicky',
      name: 'iChickyX',
      avatarUrl: '/media/players/player-chicky/photo?v=123',
      teamId: 'team-7sins',
      teamName: '7sins',
      teamTag: '7SINS',
      kills: 0,
      alive: true,
    });
    expect(prisma.matchTelemetry.findUnique).toHaveBeenCalledWith({
      where: { matchId: 'match-1' },
      select: { payload: true },
    });
  });

  it('filters empty canonical placeholder teams from observer widgets', async () => {
    const matchState = {
      get: jest.fn().mockReturnValue({
        matchId: 'match-1',
        updatedAt: '2026-03-09T10:00:00.000Z',
        teamsAlive: 0,
        leaderboard: [],
        killFeed: [],
        playerCard: null,
        circle: null,
        winner: null,
      }),
      emitMatchUpdate: jest.fn(),
    } as unknown as MatchStateService;
    const canonicalRead = {
      getStateSnapshot: jest.fn().mockResolvedValue({
        matchId: 'match-1',
        updatedAt: '2026-03-09T10:00:05.000Z',
        summary: { aliveTeams: 0 },
        circle: null,
        observedPlayer: null,
        killFeed: [],
        teams: [
          {
            teamId: 'team-real',
            slot: 7,
            name: 'Real Team',
            tag: 'RT',
            logoUrl: null,
            kills: 1,
            placement: 12,
            points: 0,
            alivePlayers: 0,
            totalPlayers: 4,
            alive: false,
            eliminated: true,
            players: [
              {
                id: 'player-1',
                playerId: 'player-1',
                name: 'Alpha',
                ign: 'Alpha',
                avatarUrl: null,
                alive: false,
                knocked: false,
                kills: 1,
              },
            ],
          },
          {
            teamId: 'team-placeholder',
            slot: null,
            name: 'Team 22',
            tag: 'T22',
            logoUrl: null,
            kills: 0,
            placement: null,
            points: null,
            alivePlayers: null,
            totalPlayers: null,
            players: [],
          },
        ],
      }),
    } as unknown as CanonicalControlReadService;

    const service = new ObserverWidgetStateService(matchState, canonicalRead);
    const result = await service.getMatchUpdate('match-1');

    expect(result.leaderboard).toHaveLength(1);
    expect(result.leaderboard[0]).toMatchObject({
      rank: 1,
      teamId: 'team-real',
      teamName: 'Real Team',
      kills: 1,
      placement: 12,
    });
    expect(result.leaderboard.some((row) => row.teamName === 'Team 22')).toBe(
      false,
    );
  });

  it('uses telemetry live state when canonical cache has no alive teams', async () => {
    const matchState = {
      get: jest.fn().mockReturnValue({
        matchId: 'match-1',
        updatedAt: '2026-03-09T10:00:00.000Z',
        teamsAlive: 1,
        leaderboard: [],
        killFeed: [],
        playerCard: null,
        circle: null,
        winner: null,
      }),
      emitMatchUpdate: jest.fn(),
    } as unknown as MatchStateService;
    const canonicalRead = {
      getStateSnapshot: jest.fn().mockResolvedValue({
        matchId: 'match-1',
        updatedAt: '2026-03-09T10:00:05.000Z',
        summary: { aliveTeams: 1 },
        circle: null,
        observedPlayer: null,
        killFeed: [],
        teams: [
          {
            teamId: 'team-eliminated',
            slot: 1,
            name: 'Eliminated',
            tag: 'EL',
            logoUrl: null,
            kills: 1,
            placement: 2,
            points: 0,
            alivePlayers: 0,
            totalPlayers: 4,
            alive: false,
            eliminated: true,
            players: [],
          },
        ],
      }),
    } as unknown as CanonicalControlReadService;
    const telemetryEngine = {
      getState: jest.fn().mockResolvedValue({ matchId: 'match-1' }),
    } as unknown as TelemetryEngineService;
    const telemetryBroadcast = {
      toLiveMatchState: jest.fn().mockReturnValue({
        matchId: 'match-1',
        updatedAt: '2026-03-09T10:00:06.000Z',
        summary: { aliveTeams: 1 },
        circle: null,
        observedPlayer: null,
        killFeed: [],
        teams: [
          {
            teamId: 'team-alive',
            slot: 2,
            name: 'Alive Team',
            tag: 'AT',
            logoUrl: null,
            kills: 0,
            placement: null,
            points: 0,
            alivePlayers: 4,
            totalPlayers: 4,
            alive: true,
            eliminated: false,
            players: [],
          },
          {
            teamId: 'team-eliminated',
            slot: 1,
            name: 'Eliminated',
            tag: 'EL',
            logoUrl: null,
            kills: 1,
            placement: 2,
            points: 0,
            alivePlayers: 0,
            totalPlayers: 4,
            alive: false,
            eliminated: true,
            players: [],
          },
        ],
      }),
    } as unknown as TelemetryBroadcastService;

    const service = new ObserverWidgetStateService(
      matchState,
      canonicalRead,
      telemetryEngine,
      telemetryBroadcast,
    );
    const result = await service.getMatchUpdate('match-1');

    expect((telemetryEngine.getState as jest.Mock).mock.calls).toEqual([
      ['match-1'],
    ]);
    expect(result.leaderboard.map((row) => row.teamId)).toEqual([
      'team-alive',
      'team-eliminated',
    ]);
    expect(result.teamsAlive).toBe(1);
  });

  it('does not let empty observer rows consume canonical playing rows', async () => {
    const matchState = {
      get: jest.fn().mockReturnValue({
        matchId: 'match-1',
        updatedAt: '2026-03-09T10:00:00.000Z',
        teamsAlive: 1,
        leaderboard: [
          {
            rank: 1,
            teamId: 'team-alive',
            slot: 4,
            teamName: 'Team 16',
            teamTag: 'T16',
            logoUrl: null,
            color: null,
            kills: 0,
            alivePlayers: 0,
            totalPlayers: 0,
            placement: null,
            isEliminated: true,
            players: [],
          },
        ],
        killFeed: [],
        playerCard: null,
        circle: null,
        winner: null,
      }),
      emitMatchUpdate: jest.fn(),
    } as unknown as MatchStateService;
    const canonicalRead = {
      getStateSnapshot: jest.fn().mockResolvedValue({
        matchId: 'match-1',
        updatedAt: '2026-03-09T10:00:05.000Z',
        summary: { aliveTeams: 1 },
        circle: null,
        observedPlayer: null,
        killFeed: [],
        teams: [
          {
            teamId: 'team-alive',
            slot: 4,
            name: 'Team 16',
            tag: 'T16',
            logoUrl: null,
            kills: 0,
            placement: null,
            points: 0,
            alivePlayers: 4,
            totalPlayers: 4,
            alive: true,
            eliminated: false,
            players: [],
          },
        ],
      }),
    } as unknown as CanonicalControlReadService;

    const service = new ObserverWidgetStateService(matchState, canonicalRead);
    const result = await service.getMatchUpdate('match-1');

    expect(result.leaderboard).toHaveLength(1);
    expect(result.leaderboard[0]).toMatchObject({
      teamId: 'team-alive',
      alivePlayers: 4,
      totalPlayers: 4,
      isEliminated: false,
    });
  });

  it('prefers observer teams-alive when observer leaderboard is already active', async () => {
    const matchState = {
      get: jest.fn().mockReturnValue({
        matchId: 'match-1',
        updatedAt: '2026-03-09T10:00:00.000Z',
        teamsAlive: 3,
        leaderboard: [
          {
            rank: 1,
            teamId: 'team-1',
            slot: 1,
            teamName: 'Team One',
            teamTag: 'T1',
            logoUrl: null,
            color: null,
            kills: 0,
            alivePlayers: 2,
            totalPlayers: 4,
            placement: null,
            isEliminated: false,
            players: [],
          },
          {
            rank: 2,
            teamId: 'team-2',
            slot: 2,
            teamName: 'Team Two',
            teamTag: 'T2',
            logoUrl: null,
            color: null,
            kills: 0,
            alivePlayers: 1,
            totalPlayers: 4,
            placement: null,
            isEliminated: false,
            players: [],
          },
        ],
        killFeed: [],
        playerCard: null,
        circle: null,
        winner: null,
      }),
      emitMatchUpdate: jest.fn(),
    } as unknown as MatchStateService;
    const canonicalRead = {
      getStateSnapshot: jest.fn().mockResolvedValue({
        matchId: 'match-1',
        updatedAt: '2026-03-09T10:00:05.000Z',
        summary: { aliveTeams: 0 },
        circle: null,
        observedPlayer: null,
        killFeed: [],
        teams: [
          {
            teamId: 'team-1',
            slot: 1,
            name: 'Team One',
            tag: 'T1',
            logoUrl: null,
            kills: 2,
            placement: null,
            points: null,
            alivePlayers: 2,
            totalPlayers: 4,
            alive: true,
            eliminated: false,
            players: [],
          },
          {
            teamId: 'team-2',
            slot: 2,
            name: 'Team Two',
            tag: 'T2',
            logoUrl: null,
            kills: 1,
            placement: null,
            points: null,
            alivePlayers: 1,
            totalPlayers: 4,
            alive: true,
            eliminated: false,
            players: [],
          },
        ],
      }),
    } as unknown as CanonicalControlReadService;

    const service = new ObserverWidgetStateService(matchState, canonicalRead);
    const result = await service.getMatchUpdate('match-1');

    expect(result.teamsAlive).toBe(3);
  });

  it('prefers observer leaderboard when live cache has no alive rows during an unresolved match', async () => {
    const matchState = {
      get: jest.fn().mockReturnValue({
        matchId: 'match-1',
        updatedAt: '2026-03-09T10:00:06.000Z',
        teamsAlive: 1,
        leaderboard: [
          {
            rank: 1,
            teamId: 'team-2',
            slot: 2,
            teamName: '[live] Team 2',
            teamTag: null,
            logoUrl: null,
            color: null,
            kills: 6,
            alivePlayers: 3,
            totalPlayers: 4,
            placement: null,
            isEliminated: false,
            players: [],
          },
        ],
        killFeed: [],
        playerCard: null,
        circle: null,
        winner: null,
      }),
      emitMatchUpdate: jest.fn(),
    } as unknown as MatchStateService;
    const canonicalRead = {
      getStateSnapshot: jest.fn().mockResolvedValue({
        matchId: 'match-1',
        updatedAt: '2026-03-09T10:00:05.000Z',
        summary: { aliveTeams: 18 },
        circle: null,
        observedPlayer: null,
        killFeed: [],
        teams: [
          {
            teamId: 'team-2',
            slot: 2,
            name: 'Team Two',
            tag: 'T2',
            logoUrl: '/team-two.png',
            kills: 6,
            placement: 5,
            points: null,
            alivePlayers: 0,
            totalPlayers: 4,
            alive: false,
            eliminated: true,
            players: [],
          },
        ],
      }),
    } as unknown as CanonicalControlReadService;

    const service = new ObserverWidgetStateService(matchState, canonicalRead);
    const result = await service.getMatchUpdate('match-1');

    expect(result.teamsAlive).toBe(1);
    expect(result.leaderboard[0]).toMatchObject({
      teamId: 'team-2',
      teamName: 'Team Two',
      teamTag: 'T2',
      logoUrl: '/team-two.png',
      alivePlayers: 3,
      isEliminated: false,
    });
  });

  it('prefers observer player-card stats while backfilling canonical team metadata', async () => {
    const matchState = {
      get: jest.fn().mockReturnValue({
        matchId: 'match-1',
        updatedAt: '2026-03-09T10:00:06.000Z',
        teamsAlive: 1,
        leaderboard: [],
        killFeed: [],
        playerCard: {
          playerId: 'player-1',
          name: 'Alpha',
          avatarUrl: null,
          teamId: 'team-1',
          teamName: '[live] Team 1',
          teamTag: null,
          logoUrl: null,
          color: null,
          kills: 5,
          alive: false,
          damage: 250,
        },
        circle: null,
        winner: null,
      }),
      emitMatchUpdate: jest.fn(),
    } as unknown as MatchStateService;
    const canonicalRead = {
      getStateSnapshot: jest.fn().mockResolvedValue({
        matchId: 'match-1',
        updatedAt: '2026-03-09T10:00:05.000Z',
        summary: { aliveTeams: 2 },
        circle: null,
        observedPlayer: {
          playerId: 'player-1',
          playerName: 'Alpha',
          teamId: 'team-1',
          teamName: 'Team One',
          teamTag: 'T1',
          teamLogoUrl: '/logo.png',
        },
        killFeed: [],
        teams: [
          {
            teamId: 'team-1',
            slot: 1,
            name: 'Team One',
            tag: 'T1',
            logoUrl: '/logo.png',
            kills: 2,
            placement: null,
            points: null,
            alivePlayers: 2,
            totalPlayers: 4,
            alive: true,
            eliminated: false,
            players: [
              {
                id: 'player-1',
                playerId: 'player-1',
                name: 'Alpha',
                ign: 'Alpha',
                avatarUrl: '/alpha.png',
                alive: true,
                knocked: false,
                kills: 2,
              },
            ],
          },
        ],
      }),
    } as unknown as CanonicalControlReadService;

    const service = new ObserverWidgetStateService(matchState, canonicalRead);
    const result = await service.getMatchUpdate('match-1');

    expect(result.playerCard).toEqual({
      playerId: 'player-1',
      name: 'Alpha',
      avatarUrl: '/alpha.png',
      teamId: 'team-1',
      teamName: 'Team One',
      teamTag: 'T1',
      logoUrl: '/logo.png',
      color: null,
      kills: 5,
      alive: false,
      damage: 250,
    });
  });
});
