import { TelemetryBroadcastService } from './telemetry-broadcast.service';
import { EVENT_BUS_TOPICS } from '../event-bus/event-bus.types';

describe('TelemetryBroadcastService', () => {
  function buildService() {
    const liveStateMirror = {
      publish: jest.fn().mockImplementation(async (state) => state),
    } as any;
    const broadcaster = {
      broadcastUpdate: jest.fn().mockResolvedValue(undefined),
      broadcastEnd: jest.fn().mockResolvedValue(undefined),
    } as any;
    const observerState = {
      update: jest.fn(),
    } as any;
    const prisma = {
      match: {
        findFirst: jest.fn().mockResolvedValue({
          organizationId: 'org-1',
          controlState: null,
          tournament: null,
        }),
      },
    } as any;
    const eventBus = {
      publish: jest.fn().mockResolvedValue(undefined),
    } as any;
    const results = {
      syncAcceptedLiveTelemetryProjection: jest.fn().mockResolvedValue(true),
    } as any;

    return {
      service: new TelemetryBroadcastService(
        liveStateMirror,
        broadcaster,
        observerState,
        prisma,
        eventBus,
        results,
      ),
      eventBus,
      results,
    };
  }

  it('keeps assigned slot teams in live output while merging telemetry runtime', () => {
    const { service } = buildService();

    const live = service.toLiveMatchState({
      matchId: 'match-1',
      status: 'LIVE',
      mode: 'AUTO',
      version: 3,
      sequence: 12,
      updatedAt: 1_710_000_000_000,
      startedAt: 1_709_999_900_000,
      endedAt: null,
      teamsAlive: 1,
      teams: {
        'slot-team-1': {
          teamId: 'slot-team-1',
          alivePlayers: 2,
          eliminated: false,
          placement: null,
          totalKills: 3,
          totalPlayers: 4,
          eliminatedAt: null,
          metadata: {
            slot: 1,
            teamName: 'Observer Team',
            observedInTelemetry: true,
          },
        },
        'slot-team-2': {
          teamId: 'slot-team-2',
          alivePlayers: 0,
          eliminated: true,
          placement: 2,
          totalKills: 1,
          totalPlayers: 4,
          eliminatedAt: 1_710_000_000_000,
          metadata: {
            slot: 2,
            teamName: 'Eliminated Observer Team',
            observedInTelemetry: true,
          },
        },
        'assigned-only': {
          teamId: 'assigned-only',
          alivePlayers: 4,
          eliminated: false,
          placement: null,
          totalKills: 0,
          totalPlayers: 4,
          eliminatedAt: null,
          metadata: {
            slot: 3,
            teamName: 'Assigned Only',
          },
        },
      },
      players: {},
      killFeed: [],
      events: [],
      circle: null,
    });

    expect(live.teams.map((team) => team.teamId)).toEqual([
      'slot-team-1',
      'assigned-only',
      'slot-team-2',
    ]);
    expect(live.summary).toMatchObject({
      totalTeams: 3,
      aliveTeams: 2,
      totalPlayers: 12,
      alivePlayers: 6,
    });
  });

  it('does not count unconfirmed canonical roster seeds as live teams', () => {
    const { service } = buildService();

    const live = service.toLiveMatchState({
      matchId: 'match-unconfirmed-roster',
      status: 'LIVE',
      mode: 'API',
      version: 4,
      sequence: 12,
      updatedAt: 1_710_000_000_000,
      startedAt: 1_709_999_900_000,
      endedAt: null,
      teamsAlive: 2,
      telemetryAcceptedAt: null,
      telemetryAcceptedSource: null,
      teams: {
        'team-unconfirmed': {
          teamId: 'team-unconfirmed',
          alivePlayers: 4,
          eliminated: false,
          placement: null,
          totalKills: 0,
          totalPlayers: 4,
          eliminatedAt: null,
          metadata: {
            slot: 1,
            teamName: 'Unconfirmed Team',
            slotResultId: 'slot-result-1',
            wasPresentInMatch: null,
            canonicalSeed: true,
          },
        },
        'team-present': {
          teamId: 'team-present',
          alivePlayers: 4,
          eliminated: false,
          placement: null,
          totalKills: 0,
          totalPlayers: 4,
          eliminatedAt: null,
          metadata: {
            slot: 2,
            teamName: 'Present Team',
            slotResultId: 'slot-result-2',
            wasPresentInMatch: true,
            canonicalSeed: true,
          },
        },
      },
      players: {
        'unconfirmed-1': {
          playerId: 'unconfirmed-1',
          teamId: 'team-unconfirmed',
          alive: true,
          knocked: false,
          kills: 0,
          metadata: {
            playerName: 'Unconfirmed One',
            slotPlayerResultId: 'slot-player-1',
            canonicalSeed: true,
          },
        },
        'present-1': {
          playerId: 'present-1',
          teamId: 'team-present',
          alive: true,
          knocked: false,
          kills: 0,
          metadata: {
            playerName: 'Present One',
            slotPlayerResultId: 'slot-player-2',
            canonicalSeed: true,
          },
        },
      },
      killFeed: [],
      events: [],
      circle: null,
    });

    expect(live.summary).toMatchObject({
      totalTeams: 2,
      aliveTeams: 1,
      totalPlayers: 4,
      alivePlayers: 4,
    });
    expect(
      live.teams.find((team) => team.teamId === 'team-unconfirmed'),
    ).toMatchObject({
      alivePlayers: 0,
      totalPlayers: 0,
      alive: false,
      eliminated: true,
      hasTelemetryPresence: false,
      wasPresentInMatch: null,
      presenceStatus: 'UNRESOLVED',
      players: [],
    });
    expect(
      live.teams.find((team) => team.teamId === 'team-present'),
    ).toMatchObject({
      alivePlayers: 4,
      totalPlayers: 4,
      hasTelemetryPresence: true,
      wasPresentInMatch: true,
      presenceStatus: 'ACTIVE',
    });
  });

  it('prefers fresh team telemetry aggregates for the live summary when mapping is partial', () => {
    const { service } = buildService();

    const live = service.toLiveMatchState({
      matchId: 'match-telemetry-summary',
      status: 'LIVE',
      mode: 'AUTO',
      version: 5,
      sequence: 20,
      updatedAt: 1_710_000_200_000,
      startedAt: 1_710_000_100_000,
      endedAt: null,
      teamsAlive: 2,
      teams: {
        'team-1': {
          teamId: 'team-1',
          alivePlayers: 1,
          eliminated: false,
          placement: null,
          totalKills: 0,
          totalPlayers: 1,
          eliminatedAt: null,
          metadata: {
            slot: 1,
            teamName: 'Team One',
            telemetryAlivePlayers: 4,
            telemetryTotalPlayers: 4,
            telemetryKills: 0,
            telemetryPlacement: 1,
            telemetryLastSeenAt: 1_710_000_200_000,
          },
        },
        'team-2': {
          teamId: 'team-2',
          alivePlayers: 0,
          eliminated: true,
          placement: null,
          totalKills: 0,
          totalPlayers: 0,
          eliminatedAt: null,
          metadata: {
            slot: 2,
            teamName: 'Team Two',
            telemetryAlivePlayers: 3,
            telemetryTotalPlayers: 4,
            telemetryKills: 1,
            telemetryPlacement: 2,
            telemetryLastSeenAt: 1_710_000_200_000,
          },
        },
        'assigned-only': {
          teamId: 'assigned-only',
          alivePlayers: 4,
          eliminated: false,
          placement: null,
          totalKills: 0,
          totalPlayers: 4,
          eliminatedAt: null,
          metadata: {
            slot: 3,
            teamName: 'Assigned Only',
          },
        },
      },
      players: {
        'player-1': {
          playerId: 'player-1',
          teamId: 'team-1',
          alive: true,
          knocked: false,
          kills: 0,
          metadata: {
            playerName: 'Volt',
            observedInTelemetry: true,
          },
        },
      },
      killFeed: [],
      events: [],
      circle: null,
    });

    expect(live.summary).toMatchObject({
      totalTeams: 2,
      aliveTeams: 2,
      totalPlayers: 8,
      alivePlayers: 7,
      winnerTeamId: null,
    });
    expect(live.teams.map((team) => team.teamId)).toEqual([
      'team-1',
      'team-2',
      'assigned-only',
    ]);
    expect(live.teams[1]).toMatchObject({
      teamId: 'team-2',
      alivePlayers: 3,
      totalPlayers: 4,
      kills: 1,
      placement: 2,
    });
  });

  it('keeps persisted canonical slot count in the live summary when telemetry omits teams', () => {
    const { service } = buildService();

    const live = service.toLiveMatchState({
      matchId: 'match-canonical-summary',
      status: 'LIVE',
      mode: 'AUTO',
      version: 6,
      sequence: 21,
      updatedAt: 1_710_000_250_000,
      startedAt: 1_710_000_100_000,
      endedAt: null,
      teamsAlive: 2,
      teams: {
        'team-1': {
          teamId: 'team-1',
          alivePlayers: 4,
          eliminated: false,
          placement: null,
          totalKills: 0,
          totalPlayers: 4,
          eliminatedAt: null,
          metadata: {
            slot: 1,
            teamName: 'Team One',
            slotResultId: 'slot-result-1',
            telemetryAlivePlayers: 4,
            telemetryTotalPlayers: 4,
            telemetryLastSeenAt: 1_710_000_250_000,
          },
        },
        'team-2': {
          teamId: 'team-2',
          alivePlayers: 3,
          eliminated: false,
          placement: null,
          totalKills: 1,
          totalPlayers: 4,
          eliminatedAt: null,
          metadata: {
            slot: 2,
            teamName: 'Team Two',
            slotResultId: 'slot-result-2',
            telemetryAlivePlayers: 3,
            telemetryTotalPlayers: 4,
            telemetryKills: 1,
            telemetryLastSeenAt: 1_710_000_250_000,
          },
        },
        'team-3': {
          teamId: 'team-3',
          alivePlayers: 0,
          eliminated: false,
          placement: null,
          totalKills: 0,
          totalPlayers: 0,
          eliminatedAt: null,
          metadata: {
            slot: 3,
            teamName: 'Team Three',
            slotResultId: 'slot-result-3',
          },
        },
      },
      players: {},
      killFeed: [],
      events: [],
      circle: { phase: 6 },
    });

    expect(live.teams).toHaveLength(3);
    expect(live.summary).toMatchObject({
      totalTeams: 3,
      aliveTeams: 2,
      totalPlayers: 8,
      alivePlayers: 7,
    });
  });

  it('drops stale canonical roster teams during early live telemetry phases', () => {
    const { service } = buildService();

    const live = service.toLiveMatchState({
      matchId: 'match-early-telemetry',
      status: 'LIVE',
      mode: 'AUTO',
      version: 7,
      sequence: 21,
      updatedAt: 1_710_000_300_000,
      startedAt: 1_710_000_200_000,
      endedAt: null,
      teamsAlive: 14,
      circle: {
        phase: 0,
      },
      teams: {
        'team-1': {
          teamId: 'team-1',
          alivePlayers: 1,
          eliminated: false,
          placement: null,
          totalKills: 0,
          totalPlayers: 1,
          eliminatedAt: null,
          metadata: {
            slot: 1,
            teamName: 'Team One',
            telemetryAlivePlayers: 4,
            telemetryTotalPlayers: 4,
            telemetryKills: 0,
            telemetryPlacement: null,
            telemetryLastSeenAt: 1_710_000_300_000,
          },
        },
        'team-2': {
          teamId: 'team-2',
          alivePlayers: 1,
          eliminated: false,
          placement: null,
          totalKills: 0,
          totalPlayers: 1,
          eliminatedAt: null,
          metadata: {
            slot: 2,
            teamName: 'Team Two',
            telemetryAlivePlayers: 3,
            telemetryTotalPlayers: 4,
            telemetryKills: 1,
            telemetryPlacement: null,
            telemetryLastSeenAt: 1_710_000_300_000,
          },
        },
        'assigned-only': {
          teamId: 'assigned-only',
          alivePlayers: 4,
          eliminated: false,
          placement: 23,
          totalKills: 5,
          totalPlayers: 4,
          eliminatedAt: null,
          metadata: {
            slot: 3,
            teamName: 'Assigned Only',
            totalPlayers: 4,
          },
        },
      },
      players: {},
      killFeed: [],
      events: [],
    });

    expect(live.summary).toMatchObject({
      totalTeams: 2,
      aliveTeams: 2,
      totalPlayers: 8,
      alivePlayers: 7,
    });
    expect(
      live.teams.find((team) => team.teamId === 'assigned-only'),
    ).toMatchObject({
      teamId: 'assigned-only',
      alivePlayers: 0,
      totalPlayers: 0,
      alive: false,
      eliminated: true,
      kills: 0,
      placement: null,
      players: [],
    });
  });

  it('trusts explicit team alive aggregates over stale duplicate player rows', () => {
    const { service } = buildService();

    const live = service.toLiveMatchState({
      matchId: 'match-duplicate-life',
      status: 'LIVE',
      mode: 'AUTO',
      version: 8,
      sequence: 44,
      updatedAt: 1_710_000_400_000,
      startedAt: 1_710_000_200_000,
      endedAt: null,
      teamsAlive: 1,
      teams: {
        'team-1': {
          teamId: 'team-1',
          alivePlayers: 1,
          eliminated: false,
          placement: 1,
          totalKills: 4,
          totalPlayers: 4,
          eliminatedAt: null,
          metadata: {
            slot: 1,
            teamName: 'Team One',
            observedInTelemetry: true,
          },
        },
      },
      players: {
        'player-1': {
          playerId: 'player-1',
          teamId: 'team-1',
          alive: true,
          knocked: false,
          kills: 2,
          metadata: {
            slotPlayerResultId: 'slot-1',
            externalPlayerId: 'ext-1',
            playerName: 'Alpha',
            observedInTelemetry: true,
          },
        },
        'player-2-stale-alive': {
          playerId: 'player-2-stale-alive',
          teamId: 'team-1',
          alive: true,
          knocked: false,
          kills: 1,
          metadata: {
            slotPlayerResultId: 'slot-2',
            externalPlayerId: 'ext-2',
            playerName: 'Bravo',
            observedInTelemetry: true,
          },
        },
        'player-2-dead': {
          playerId: 'player-2-dead',
          teamId: 'team-1',
          alive: false,
          knocked: false,
          kills: 1,
          metadata: {
            slotPlayerResultId: 'slot-2',
            externalPlayerId: 'ext-2',
            playerName: 'Bravo',
            observedInTelemetry: true,
          },
        },
        'player-3': {
          playerId: 'player-3',
          teamId: 'team-1',
          alive: false,
          knocked: false,
          kills: 1,
          metadata: {
            slotPlayerResultId: 'slot-3',
            externalPlayerId: 'ext-3',
            playerName: 'Charlie',
            observedInTelemetry: true,
          },
        },
        'player-4': {
          playerId: 'player-4',
          teamId: 'team-1',
          alive: false,
          knocked: false,
          kills: 0,
          metadata: {
            slotPlayerResultId: 'slot-4',
            externalPlayerId: 'ext-4',
            playerName: 'Delta',
            observedInTelemetry: true,
          },
        },
      },
      killFeed: [],
      events: [],
      circle: {
        phase: 3,
      },
    });

    expect(live.summary).toMatchObject({
      totalTeams: 1,
      aliveTeams: 1,
      totalPlayers: 4,
      alivePlayers: 1,
    });
    expect(live.teams[0]).toMatchObject({
      teamId: 'team-1',
      alivePlayers: 1,
      totalPlayers: 4,
    });
    expect(live.teams[0]?.players).toHaveLength(4);
    expect(
      live.teams[0]?.players?.filter((player) => player.alive === true).length,
    ).toBe(1);
  });

  it('publishes telemetry snapshots for downstream match-state consumers', async () => {
    const { service, eventBus } = buildService();

    await service.broadcastState({
      matchId: 'match-1',
      status: 'LIVE',
      mode: 'AUTO',
      version: 3,
      sequence: 12,
      updatedAt: 1_710_000_000_000,
      startedAt: 1_709_999_900_000,
      endedAt: null,
      teamsAlive: 2,
      teams: {
        'team-1': {
          teamId: 'team-1',
          alivePlayers: 1,
          eliminated: false,
          placement: 1,
          totalKills: 3,
          totalPlayers: 1,
          eliminatedAt: null,
          metadata: {
            slot: 1,
            teamName: 'Team One',
            teamTag: 'ONE',
            logoUrl: 'https://cdn.example.com/team-one.png',
          },
        },
        'team-2': {
          teamId: 'team-2',
          alivePlayers: 1,
          eliminated: false,
          placement: 2,
          totalKills: 0,
          totalPlayers: 1,
          eliminatedAt: null,
          metadata: {
            slot: 2,
            teamName: 'Team Two',
            teamTag: 'TWO',
            logoUrl: 'https://cdn.example.com/team-two.png',
          },
        },
      },
      players: {
        killer: {
          playerId: 'killer',
          teamId: 'team-1',
          alive: true,
          knocked: false,
          kills: 3,
          metadata: {
            playerName: 'Volt',
            externalPlayerId: 'killer',
            avatarUrl: 'https://cdn.example.com/volt.png',
          },
        },
        victim: {
          playerId: 'victim',
          teamId: 'team-2',
          alive: false,
          knocked: false,
          kills: 0,
          metadata: {
            playerName: 'Shade',
            externalPlayerId: 'victim',
            avatarUrl: 'https://cdn.example.com/shade.png',
          },
        },
      },
      killFeed: [],
      events: [
        {
          id: 'kill-1',
          type: 'PLAYER_KILL',
          ts: 1_710_000_000_000,
          teamId: 'team-1',
          playerId: 'killer',
          payload: {
            killerPlayerId: 'killer',
            victimPlayerId: 'victim',
            killerTeamId: 'team-1',
            victimTeamId: 'team-2',
            killerName: 'Volt',
            victimName: 'Shade',
            weapon: 'M416',
          },
        },
      ],
      circle: null,
    });

    expect(eventBus.publish).toHaveBeenCalledWith(
      EVENT_BUS_TOPICS.MATCH,
      'telemetry.snapshot',
      expect.objectContaining({
        matchId: 'match-1',
        organizationId: 'org-1',
        killEvents: [
          expect.objectContaining({
            type: 'PLAYER_KILL',
            matchId: 'match-1',
            killerPlayerExternalId: 'killer',
            victimPlayerExternalId: 'victim',
            killerTeamId: 'team-1',
            victimTeamId: 'team-2',
          }),
        ],
        totalPlayerList: {
          players: expect.arrayContaining([
            expect.objectContaining({
              teamId: 'team-1',
              externalPlayerId: 'killer',
              playerName: 'Volt',
            }),
          ]),
        },
      }),
      expect.objectContaining({
        timestamp: 1_710_000_000_000,
      }),
    );
  });

  it('exposes the observed player in live output and telemetry snapshots', async () => {
    const { service, eventBus } = buildService();

    const dto = await service.broadcastState({
      matchId: 'match-1',
      status: 'LIVE',
      mode: 'AUTO',
      version: 4,
      sequence: 13,
      updatedAt: 1_710_000_100_000,
      startedAt: 1_709_999_900_000,
      endedAt: null,
      teamsAlive: 1,
      teams: {
        'team-1': {
          teamId: 'team-1',
          alivePlayers: 1,
          eliminated: false,
          placement: 1,
          totalKills: 2,
          totalPlayers: 1,
          eliminatedAt: null,
          metadata: {
            slot: 1,
            teamName: 'Team One',
            teamTag: 'ONE',
            logoUrl: 'https://cdn.example.com/team-one.png',
          },
        },
      },
      players: {
        'player-1': {
          playerId: 'player-1',
          teamId: 'team-1',
          alive: true,
          knocked: false,
          kills: 2,
          metadata: {
            playerName: 'Volt',
            externalPlayerId: 'ext-1',
            inGameId: 'pubg-1',
          },
        },
      },
      observedPlayer: {
        playerId: 'player-1',
        externalPlayerId: 'ext-1',
        pubgPlayerId: 'pubg-1',
        teamId: 'team-1',
      },
      killFeed: [],
      events: [],
      circle: null,
    });

    expect(dto.observedPlayer).toMatchObject({
      playerId: 'player-1',
      externalPlayerId: 'ext-1',
      pubgPlayerId: 'pubg-1',
      playerName: 'Volt',
      playerIgn: 'Volt',
      teamId: 'team-1',
      teamName: 'Team One',
      teamTag: 'ONE',
      teamLogoUrl: 'https://cdn.example.com/team-one.png',
    });
    expect(eventBus.publish).toHaveBeenCalledWith(
      EVENT_BUS_TOPICS.MATCH,
      'telemetry.snapshot',
      expect.objectContaining({
        observedPlayer: expect.objectContaining({
          playerId: 'player-1',
          teamId: 'team-1',
        }),
      }),
      expect.any(Object),
    );
  });

  it('falls back to runtime state when mirror publish fails and still emits realtime updates', async () => {
    const liveStateMirror = {
      publish: jest.fn().mockRejectedValue(new Error('mirror failed')),
    } as any;
    const broadcaster = {
      broadcastUpdate: jest.fn().mockResolvedValue(undefined),
      broadcastEnd: jest.fn().mockResolvedValue(undefined),
    } as any;
    const observerState = {
      update: jest.fn(),
    } as any;
    const prisma = {
      match: {
        findFirst: jest.fn().mockResolvedValue({
          organizationId: 'org-1',
          controlState: null,
          tournament: null,
        }),
      },
    } as any;
    const eventBus = {
      publish: jest.fn().mockResolvedValue(undefined),
    } as any;
    const results = {
      syncAcceptedLiveTelemetryProjection: jest.fn().mockResolvedValue(true),
    } as any;
    const service = new TelemetryBroadcastService(
      liveStateMirror,
      broadcaster,
      observerState,
      prisma,
      eventBus,
      results,
    );

    const dto = await service.broadcastState({
      matchId: 'match-1',
      status: 'LIVE',
      mode: 'AUTO',
      version: 3,
      sequence: 12,
      updatedAt: 1_710_000_000_000,
      startedAt: 1_709_999_900_000,
      endedAt: null,
      teamsAlive: 1,
      teams: {
        'team-1': {
          teamId: 'team-1',
          alivePlayers: 1,
          eliminated: false,
          placement: 1,
          totalKills: 3,
          totalPlayers: 1,
          eliminatedAt: null,
          metadata: {
            slot: 1,
            teamName: 'Team One',
          },
        },
      },
      players: {
        killer: {
          playerId: 'killer',
          teamId: 'team-1',
          alive: true,
          knocked: false,
          kills: 3,
          metadata: {
            playerName: 'Volt',
            externalPlayerId: 'killer',
          },
        },
      },
      killFeed: [],
      events: [],
      circle: null,
    });

    expect(liveStateMirror.publish).toHaveBeenCalledTimes(1);
    expect(observerState.update).toHaveBeenCalledWith(
      'match-1',
      expect.objectContaining({
        matchId: 'match-1',
        teamsAlive: 1,
        leaderboard: expect.arrayContaining([
          expect.objectContaining({
            teamId: 'team-1',
          }),
        ]),
      }),
    );
    expect(broadcaster.broadcastUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        matchId: 'match-1',
        teams: expect.arrayContaining([
          expect.objectContaining({
            teamId: 'team-1',
          }),
        ]),
      }),
      'org-1',
    );
    expect(dto).toMatchObject({
      matchId: 'match-1',
      status: 'LIVE',
    });
  });

  it('pushes accepted live telemetry into results projection sync', async () => {
    const { service, results } = buildService();

    await service.broadcastState({
      matchId: 'match-1',
      status: 'LIVE',
      mode: 'AUTO',
      version: 3,
      sequence: 12,
      updatedAt: 1_710_000_000_000,
      startedAt: 1_709_999_900_000,
      endedAt: null,
      teamsAlive: 1,
      telemetryAcceptedAt: 1_710_000_000_000,
      telemetryAcceptedSource: 'API',
      teams: {
        'team-1': {
          teamId: 'team-1',
          alivePlayers: 1,
          eliminated: false,
          placement: 1,
          totalKills: 3,
          totalPlayers: 1,
          eliminatedAt: null,
          metadata: {
            slot: 1,
            teamName: 'Team One',
            wasPresentInMatch: true,
            observedInTelemetry: true,
          },
        },
      },
      players: {
        killer: {
          playerId: 'killer',
          teamId: 'team-1',
          alive: true,
          knocked: false,
          kills: 3,
          metadata: {
            playerName: 'Volt',
            externalPlayerId: 'killer',
            observedInTelemetry: true,
            slotPlayerResultId: 'slot-player-1',
          },
        },
      },
      killFeed: [],
      events: [],
      circle: { phase: 2 },
    } as any);

    expect(results.syncAcceptedLiveTelemetryProjection).toHaveBeenCalledWith(
      expect.objectContaining({
        matchId: 'match-1',
      }),
      {
        source: 'TELEMETRY_PIPELINE',
      },
    );
  });
});
