import { TelemetryBroadcastService } from './telemetry-broadcast.service';
import { EVENT_BUS_TOPICS } from '../event-bus/event-bus.types';

describe('TelemetryBroadcastService', () => {
  it('publishes telemetry snapshots for downstream match-state consumers', async () => {
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

    const service = new TelemetryBroadcastService(
      liveStateMirror,
      broadcaster,
      observerState,
      prisma,
      eventBus,
    );

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
});
