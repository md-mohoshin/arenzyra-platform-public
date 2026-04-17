import type { PrismaService } from '../../db/prisma.service';
import type { MatchControlService } from '../match-control/match-control.service';
import type { ResultsService } from '../results/results.service';
import { TelemetryEngineService } from './telemetry-engine.service';
import { TelemetryValidatorService } from './telemetry-validator.service';
import type { TelemetryPersistenceService } from './telemetry-persistence.service';
import type { TelemetryBroadcastService } from './telemetry-broadcast.service';

describe('TelemetryEngineService', () => {
  it('does not eliminate a team or end the match on a last-alive knock command', async () => {
    const matchControl = {
      endMatch: jest.fn().mockResolvedValue(undefined),
      startMatch: jest.fn().mockResolvedValue(undefined),
    } as unknown as MatchControlService;
    const persistence = {
      persistState: jest.fn().mockResolvedValue(undefined),
    } as unknown as TelemetryPersistenceService;
    const broadcast = {
      broadcastState: jest.fn().mockResolvedValue(undefined),
    } as unknown as TelemetryBroadcastService;
    const service = new TelemetryEngineService(
      {} as PrismaService,
      {} as ResultsService,
      matchControl,
      new TelemetryValidatorService(),
      persistence,
      broadcast,
    );

    (service as any).runtimes.set('match-1', {
      matchId: 'match-1',
      status: 'LIVE',
      mode: 'MANUAL',
      sequence: 3,
      updatedAt: 100,
      startedAt: 50,
      endedAt: null,
      teamsAlive: 1,
      teams: {
        'team-1': {
          teamId: 'team-1',
          alivePlayers: 1,
          eliminated: false,
          placement: null,
          totalKills: 0,
          totalPlayers: 1,
          eliminatedAt: null,
          metadata: { slot: 1 },
        },
      },
      players: {
        'player-1': {
          playerId: 'player-1',
          teamId: 'team-1',
          alive: true,
          knocked: false,
          kills: 0,
        },
      },
    });

    const result = await service.applyCommand({
      type: 'SET_PLAYER_KNOCKED',
      matchId: 'match-1',
      playerId: 'player-1',
      knocked: true,
    });

    expect(result.state.players['player-1']).toMatchObject({
      alive: true,
      knocked: false,
    });
    expect(result.state.teams['team-1']).toMatchObject({
      alivePlayers: 1,
      eliminated: false,
      placement: 1,
    });
    expect(result.state.status).toBe('LIVE');
    expect((matchControl as any).endMatch).not.toHaveBeenCalled();
  });

  it('ignores an adapter match-end packet before any live telemetry was accepted for the current match', async () => {
    const matchControl = {
      endMatch: jest.fn().mockResolvedValue(undefined),
      startMatch: jest.fn().mockResolvedValue(undefined),
    } as unknown as MatchControlService;
    const persistence = {
      persistState: jest.fn().mockResolvedValue(undefined),
    } as unknown as TelemetryPersistenceService;
    const broadcast = {
      broadcastState: jest.fn().mockResolvedValue(undefined),
    } as unknown as TelemetryBroadcastService;
    const service = new TelemetryEngineService(
      {} as PrismaService,
      {} as ResultsService,
      matchControl,
      new TelemetryValidatorService(),
      persistence,
      broadcast,
    );

    (service as any).runtimes.set('match-1', {
      matchId: 'match-1',
      status: 'LIVE',
      mode: 'AUTO',
      version: 2,
      sequence: 0,
      updatedAt: 100,
      telemetryAcceptedAt: null,
      telemetryAcceptedSource: null,
      startedAt: 90,
      endedAt: null,
      teamsAlive: 0,
      teams: {},
      players: {},
      killFeed: [],
      events: [],
    });

    const result = await service.applyAdapterTelemetryEnvelope({
      matchId: 'match-1',
      timestamp: 150,
      players: [],
      teams: [],
      zone: null,
      events: [
        {
          type: 'MATCH_END',
          timestamp: 150,
          dedupeKey: 'end-1',
        },
      ],
      source: 'PCOB_PUSH',
      raw: {
        sessionId: 'session-1',
      },
    });

    expect(result.ignored).toBe(true);
    expect(result.reason).toBe('NO_STATE_CHANGE');
    expect((persistence as any).persistState).not.toHaveBeenCalled();
    expect((matchControl as any).endMatch).not.toHaveBeenCalled();
  });

  it('ignores adapter match-end packets even after live telemetry has been accepted', async () => {
    const matchControl = {
      endMatch: jest.fn().mockResolvedValue(undefined),
      startMatch: jest.fn().mockResolvedValue(undefined),
    } as unknown as MatchControlService;
    const persistence = {
      persistState: jest.fn().mockResolvedValue(undefined),
    } as unknown as TelemetryPersistenceService;
    const broadcast = {
      broadcastState: jest.fn().mockResolvedValue(undefined),
    } as unknown as TelemetryBroadcastService;
    const service = new TelemetryEngineService(
      {} as PrismaService,
      {} as ResultsService,
      matchControl,
      new TelemetryValidatorService(),
      persistence,
      broadcast,
    );

    (service as any).runtimes.set('match-1', {
      matchId: 'match-1',
      status: 'LIVE',
      mode: 'AUTO',
      version: 2,
      sequence: 0,
      updatedAt: 100,
      telemetryAcceptedAt: null,
      telemetryAcceptedSource: null,
      startedAt: 90,
      endedAt: null,
      teamsAlive: 1,
      teams: {
        'team-1': {
          teamId: 'team-1',
          alivePlayers: 1,
          eliminated: false,
          placement: 1,
          totalKills: 0,
          totalPlayers: 1,
          eliminatedAt: null,
          metadata: { slot: 1 },
        },
      },
      players: {
        'player-1': {
          playerId: 'player-1',
          teamId: 'team-1',
          alive: true,
          knocked: false,
          kills: 0,
        },
      },
      killFeed: [],
      events: [],
    });

    const liveTelemetry = await service.applyAdapterTelemetryEnvelope({
      matchId: 'match-1',
      sessionId: 'session-1',
      sequence: 1,
      timestamp: 120,
      players: [
        {
          playerId: 'player-1',
          teamId: 'team-1',
          alive: true,
        },
      ],
      teams: [],
      zone: null,
      events: [],
      source: 'PCOB_PUSH',
      raw: null,
    });

    expect(liveTelemetry.ignored).not.toBe(true);
    expect(liveTelemetry.state.telemetryAcceptedAt).toBe(120);
    (persistence as any).persistState.mockClear();
    (matchControl as any).endMatch.mockClear();

    const endTelemetry = await service.applyAdapterTelemetryEnvelope({
      matchId: 'match-1',
      sessionId: 'session-1',
      sequence: 2,
      timestamp: 160,
      players: [],
      teams: [],
      zone: null,
      events: [
        {
          type: 'MATCH_END',
          timestamp: 160,
          dedupeKey: 'end-2',
        },
      ],
      source: 'PCOB_PUSH',
      raw: null,
    });

    expect(endTelemetry.ignored).toBe(true);
    expect(endTelemetry.reason).toBe('NO_STATE_CHANGE');
    expect(endTelemetry.state.status).toBe('LIVE');
    expect((persistence as any).persistState).not.toHaveBeenCalled();
    expect((matchControl as any).endMatch).not.toHaveBeenCalled();
  });

  it('marks a team as present only after at least one telemetry player is observed', async () => {
    const matchControl = {
      endMatch: jest.fn().mockResolvedValue(undefined),
      startMatch: jest.fn().mockResolvedValue(undefined),
    } as unknown as MatchControlService;
    const persistence = {
      persistState: jest.fn().mockResolvedValue(undefined),
    } as unknown as TelemetryPersistenceService;
    const broadcast = {
      broadcastState: jest.fn().mockResolvedValue(undefined),
    } as unknown as TelemetryBroadcastService;
    const service = new TelemetryEngineService(
      {} as PrismaService,
      {} as ResultsService,
      matchControl,
      new TelemetryValidatorService(),
      persistence,
      broadcast,
    );

    (service as any).runtimes.set('match-1', {
      matchId: 'match-1',
      status: 'LIVE',
      mode: 'AUTO',
      version: 2,
      sequence: 0,
      updatedAt: 100,
      telemetryAcceptedAt: null,
      telemetryAcceptedSource: null,
      startedAt: 90,
      endedAt: null,
      teamsAlive: 1,
      teams: {
        'team-1': {
          teamId: 'team-1',
          alivePlayers: 1,
          eliminated: false,
          placement: 1,
          totalKills: 0,
          totalPlayers: 1,
          eliminatedAt: null,
          metadata: {
            slot: 1,
            teamName: 'Team One',
            wasPresentInMatch: null,
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
            playerName: 'Alpha',
            observedInTelemetry: null,
          },
        },
      },
      killFeed: [],
      events: [],
    });

    const result = await service.applyAdapterTelemetryEnvelope({
      matchId: 'match-1',
      sessionId: 'session-1',
      sequence: 1,
      timestamp: 120,
      players: [
        {
          playerId: 'player-1',
          teamId: 'team-1',
          ign: 'Alpha',
          alive: true,
        },
      ],
      teams: [],
      zone: null,
      events: [],
      source: 'PCOB_PUSH',
      raw: null,
    });

    expect(result.state.players['player-1'].metadata?.observedInTelemetry).toBe(
      true,
    );
    expect(result.state.teams['team-1'].metadata?.wasPresentInMatch).toBe(true);
  });

  it('ignores polled PCOB match-end packets instead of treating them as authoritative', async () => {
    const matchControl = {
      endMatch: jest.fn().mockResolvedValue(undefined),
      startMatch: jest.fn().mockResolvedValue(undefined),
    } as unknown as MatchControlService;
    const persistence = {
      persistState: jest.fn().mockResolvedValue(undefined),
    } as unknown as TelemetryPersistenceService;
    const broadcast = {
      broadcastState: jest.fn().mockResolvedValue(undefined),
    } as unknown as TelemetryBroadcastService;
    const service = new TelemetryEngineService(
      {} as PrismaService,
      {} as ResultsService,
      matchControl,
      new TelemetryValidatorService(),
      persistence,
      broadcast,
    );

    (service as any).runtimes.set('match-1', {
      matchId: 'match-1',
      status: 'LIVE',
      mode: 'AUTO',
      version: 5,
      sequence: 4,
      updatedAt: 100,
      telemetryAcceptedAt: 100,
      telemetryAcceptedSource: 'PCOB_API',
      startedAt: 90,
      endedAt: null,
      teamsAlive: 0,
      teams: {},
      players: {},
      killFeed: [],
      events: [],
    });

    const result = await service.applyAdapterTelemetryEnvelope({
      matchId: 'match-1',
      timestamp: 150,
      players: [],
      teams: [],
      zone: null,
      events: [
        {
          type: 'MATCH_END',
          timestamp: 150,
          dedupeKey: 'poll-end-1',
        },
      ],
      source: 'PCOB_API',
      raw: null,
    });

    expect(result.ignored).toBe(true);
    expect(result.reason).toBe('NO_STATE_CHANGE');
    expect((persistence as any).persistState).not.toHaveBeenCalled();
    expect((matchControl as any).endMatch).not.toHaveBeenCalled();
  });

  it('does not trust team aggregates when player state disagrees', async () => {
    const matchControl = {
      endMatch: jest.fn().mockResolvedValue(undefined),
      startMatch: jest.fn().mockResolvedValue(undefined),
    } as unknown as MatchControlService;
    const persistence = {
      persistState: jest.fn().mockResolvedValue(undefined),
    } as unknown as TelemetryPersistenceService;
    const broadcast = {
      broadcastState: jest.fn().mockResolvedValue(undefined),
    } as unknown as TelemetryBroadcastService;
    const service = new TelemetryEngineService(
      {} as PrismaService,
      {} as ResultsService,
      matchControl,
      new TelemetryValidatorService(),
      persistence,
      broadcast,
    );

    (service as any).runtimes.set('match-1', {
      matchId: 'match-1',
      status: 'LIVE',
      mode: 'AUTO',
      version: 5,
      sequence: 4,
      updatedAt: 200,
      telemetryAcceptedAt: 200,
      telemetryAcceptedSource: 'PCOB_PUSH',
      startedAt: 90,
      endedAt: null,
      teamsAlive: 2,
      teams: {
        'team-1': {
          teamId: 'team-1',
          alivePlayers: 1,
          eliminated: false,
          placement: 1,
          totalKills: 0,
          totalPlayers: 1,
          eliminatedAt: null,
          metadata: { slot: 1 },
        },
        'team-2': {
          teamId: 'team-2',
          alivePlayers: 1,
          eliminated: false,
          placement: null,
          totalKills: 0,
          totalPlayers: 1,
          eliminatedAt: null,
          metadata: { slot: 2 },
        },
      },
      players: {
        'player-1': {
          playerId: 'player-1',
          teamId: 'team-1',
          alive: true,
          knocked: false,
          kills: 0,
        },
        'player-2': {
          playerId: 'player-2',
          teamId: 'team-2',
          alive: true,
          knocked: false,
          kills: 0,
        },
      },
      killFeed: [],
      events: [],
    });

    const result = await service.applyAdapterTelemetryEnvelope({
      matchId: 'match-1',
      sessionId: 'session-1',
      sequence: 5,
      timestamp: 250,
      players: [
        {
          playerId: 'player-1',
          teamId: 'team-1',
          alive: true,
          kills: 2,
        },
        {
          playerId: 'player-2',
          teamId: 'team-2',
          alive: false,
          kills: 0,
        },
      ],
      teams: [
        {
          teamId: 'team-1',
          alivePlayers: 0,
          totalPlayers: 1,
          eliminated: true,
          placement: 2,
        },
        {
          teamId: 'team-2',
          alivePlayers: 1,
          totalPlayers: 1,
          eliminated: false,
          placement: 1,
        },
      ],
      zone: null,
      events: [],
      source: 'PCOB_PUSH',
      raw: null,
    });

    expect(result.ignored).not.toBe(true);
    expect(result.state.teamsAlive).toBe(1);
    expect(result.state.teams['team-1']).toMatchObject({
      alivePlayers: 1,
      eliminated: false,
      placement: 1,
      totalKills: 2,
    });
    expect(result.state.teams['team-2']).toMatchObject({
      alivePlayers: 0,
      eliminated: true,
      placement: 2,
    });
    expect((matchControl as any).endMatch).not.toHaveBeenCalled();
  });

  it('provisions team-scoped players when adapter telemetry has no canonical player match', async () => {
    const matchControl = {
      endMatch: jest.fn().mockResolvedValue(undefined),
      startMatch: jest.fn().mockResolvedValue(undefined),
    } as unknown as MatchControlService;
    const persistence = {
      persistState: jest.fn().mockResolvedValue(undefined),
    } as unknown as TelemetryPersistenceService;
    const broadcast = {
      broadcastState: jest.fn().mockResolvedValue(undefined),
    } as unknown as TelemetryBroadcastService;
    const service = new TelemetryEngineService(
      {} as PrismaService,
      {} as ResultsService,
      matchControl,
      new TelemetryValidatorService(),
      persistence,
      broadcast,
    );

    (service as any).runtimes.set('match-1', {
      matchId: 'match-1',
      status: 'LIVE',
      mode: 'AUTO',
      version: 1,
      sequence: 0,
      updatedAt: 100,
      telemetryAcceptedAt: null,
      telemetryAcceptedSource: null,
      startedAt: 90,
      endedAt: null,
      teamsAlive: 0,
      teams: {
        'team-1': {
          teamId: 'team-1',
          alivePlayers: 0,
          eliminated: false,
          placement: null,
          totalKills: 0,
          totalPlayers: 0,
          eliminatedAt: null,
          metadata: { slot: 1, teamName: 'Team One' },
        },
      },
      players: {},
      killFeed: [],
      events: [],
    });

    const result = await service.applyAdapterTelemetryEnvelope({
      matchId: 'match-1',
      sessionId: 'session-1',
      sequence: 1,
      timestamp: 150,
      players: [
        {
          teamId: 'team-1',
          externalPlayerId: 'provider-player-404',
          ign: 'vngDAMIK',
          alive: true,
          kills: 2,
        },
      ],
      teams: [],
      zone: null,
      events: [],
      source: 'PCOB_PUSH',
      raw: null,
    });

    expect(result.ignored).not.toBe(true);
    expect(result.state.telemetryAcceptedAt).toBe(150);
    expect(result.state.teamsAlive).toBe(1);
    expect(result.state.teams['team-1']).toMatchObject({
      alivePlayers: 1,
      totalKills: 2,
      totalPlayers: 1,
    });
    expect(
      result.state.players['provisional:team-1:external:provider-player-404'],
    ).toMatchObject({
      playerId: 'provisional:team-1:external:provider-player-404',
      teamId: 'team-1',
      alive: true,
      knocked: false,
      kills: 2,
      metadata: {
        playerName: 'vngDAMIK',
        externalPlayerId: 'provider-player-404',
        provisional: true,
      },
    });
    expect((persistence as any).persistState).toHaveBeenCalled();
  });

  it('ignores a stale ended snapshot when the match row is live again', async () => {
    const matchControl = {
      endMatch: jest.fn().mockResolvedValue(undefined),
      startMatch: jest.fn().mockResolvedValue(undefined),
    } as unknown as MatchControlService;
    const results = {
      ensureResultsFromSlots: jest.fn().mockResolvedValue(undefined),
    } as unknown as ResultsService;
    const persistence = {
      persistState: jest.fn().mockResolvedValue(undefined),
    } as unknown as TelemetryPersistenceService;
    const broadcast = {
      broadcastState: jest.fn().mockResolvedValue(undefined),
    } as unknown as TelemetryBroadcastService;
    const prisma = {
      matchControlState: {
        findUnique: jest.fn().mockResolvedValue({
          authorityMode: 'AUTO',
          metaJson: {
            liveSync: {
              version: 0,
              updatedAt: 0,
              overrides: {
                players: {},
                teams: {},
              },
            },
          },
        }),
      },
      match: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'match-1',
          organizationId: 'org-1',
          tournamentId: 'tour-1',
          status: 'LIVE',
          startedAt: new Date(100),
          endedAt: null,
          controlState: {
            state: 'LIVE',
            authorityMode: 'AUTO',
            metaJson: {
              liveSync: {
                version: 0,
                updatedAt: 0,
                overrides: {
                  players: {},
                  teams: {},
                },
              },
            },
          },
          stateSnapshot: {
            stateJson: {
              matchId: 'match-1',
              status: 'ENDED',
              mode: 'AUTO',
              version: 4,
              sequence: 9,
              updatedAt: 200,
              telemetryAcceptedAt: 200,
              telemetryAcceptedSource: 'PCOB_PUSH',
              startedAt: 100,
              endedAt: 200,
              teamsAlive: 1,
              teams: {},
              players: {},
              killFeed: [],
              events: [],
            },
          },
        }),
      },
      matchSlotResult: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'slot-result-1',
            slotNumber: 1,
            teamId: 'team-1',
            totalKills: 0,
            manualTotalKills: false,
            eliminatedOrder: null,
            eliminatedAt: null,
            team: {
              id: 'team-1',
              name: 'Team One',
              tag: 'ONE',
              logoUrl: null,
            },
            players: [
              {
                id: 'player-result-1',
                playerId: 'player-1',
                playerName: 'Alpha',
                kills: 0,
                isAlive: true,
                alive: true,
                isKnocked: false,
                player: {
                  externalPlayerId: null,
                  photoUrl: null,
                  inGameId: null,
                  ign: 'Alpha',
                },
              },
            ],
          },
        ]),
      },
      matchSlot: {
        findMany: jest.fn().mockResolvedValue([
          {
            slotNumber: 1,
            team: {
              id: 'team-1',
              name: 'Team One',
              tag: 'ONE',
              logoUrl: null,
              players: [],
            },
          },
        ]),
      },
    } as unknown as PrismaService;

    const service = new TelemetryEngineService(
      prisma,
      results,
      matchControl,
      new TelemetryValidatorService(),
      persistence,
      broadcast,
    );

    const state = await service.getState('match-1');

    expect(state.status).toBe('LIVE');
    expect(state.endedAt).toBeNull();
    expect(state.telemetryAcceptedAt).toBeNull();
    expect(state.teamsAlive).toBe(1);
  });

  it('refreshes an in-memory ended runtime when the persisted match has started a new live run', async () => {
    const matchControl = {
      endMatch: jest.fn().mockResolvedValue(undefined),
      startMatch: jest.fn().mockResolvedValue(undefined),
    } as unknown as MatchControlService;
    const results = {
      ensureResultsFromSlots: jest.fn().mockResolvedValue(undefined),
    } as unknown as ResultsService;
    const persistence = {
      persistState: jest.fn().mockResolvedValue(undefined),
    } as unknown as TelemetryPersistenceService;
    const broadcast = {
      broadcastState: jest.fn().mockResolvedValue(undefined),
    } as unknown as TelemetryBroadcastService;
    const prisma = {
      match: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce({
            status: 'LIVE',
            startedAt: new Date(500),
            endedAt: null,
            controlState: {
              state: 'LIVE',
            },
          })
          .mockResolvedValueOnce({
            id: 'match-1',
            organizationId: 'org-1',
            tournamentId: 'tour-1',
            status: 'LIVE',
            startedAt: new Date(500),
            endedAt: null,
            controlState: {
              state: 'LIVE',
              authorityMode: 'AUTO',
              metaJson: null,
            },
            stateSnapshot: null,
          }),
      },
      matchControlState: {
        findUnique: jest.fn().mockResolvedValue({
          authorityMode: 'AUTO',
          metaJson: null,
        }),
      },
      matchSlotResult: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      matchSlot: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    } as unknown as PrismaService;
    const service = new TelemetryEngineService(
      prisma,
      results,
      matchControl,
      new TelemetryValidatorService(),
      persistence,
      broadcast,
    );

    (service as any).runtimes.set('match-1', {
      matchId: 'match-1',
      status: 'ENDED',
      mode: 'AUTO',
      version: 3,
      sequence: 8,
      updatedAt: 200,
      telemetryAcceptedAt: 200,
      telemetryAcceptedSource: 'PCOB_PUSH',
      startedAt: 100,
      endedAt: 200,
      teamsAlive: 1,
      teams: {},
      players: {},
      killFeed: [],
      events: [],
    });

    await expect(service.getState('match-1')).resolves.toMatchObject({
      status: 'LIVE',
      startedAt: 500,
      endedAt: null,
    });
  });

  it('refreshes an ended runtime from the persisted telemetry snapshot when the match end boundary timestamp changes', async () => {
    const matchControl = {
      endMatch: jest.fn().mockResolvedValue(undefined),
      startMatch: jest.fn().mockResolvedValue(undefined),
    } as unknown as MatchControlService;
    const results = {
      ensureResultsFromSlots: jest.fn().mockResolvedValue(undefined),
    } as unknown as ResultsService;
    const persistence = {
      persistState: jest.fn().mockResolvedValue(undefined),
    } as unknown as TelemetryPersistenceService;
    const broadcast = {
      broadcastState: jest.fn().mockResolvedValue(undefined),
    } as unknown as TelemetryBroadcastService;
    const prisma = {
      match: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce({
            status: 'ENDED',
            startedAt: new Date(100),
            endedAt: new Date(250),
            controlState: {
              state: 'ENDED',
            },
          })
          .mockResolvedValueOnce({
            id: 'match-1',
            organizationId: 'org-1',
            tournamentId: 'tour-1',
            status: 'ENDED',
            startedAt: new Date(100),
            endedAt: new Date(250),
            controlState: {
              state: 'ENDED',
              authorityMode: 'AUTO',
              metaJson: null,
            },
            stateSnapshot: {
              stateJson: {
                matchId: 'match-1',
                status: 'LIVE',
                mode: 'AUTO',
                version: 7,
                sequence: 33,
                updatedAt: 240,
                telemetryAcceptedAt: 240,
                telemetryAcceptedSource: 'LAUNCHER',
                startedAt: 100,
                endedAt: 240,
                teamsAlive: 1,
                teams: {
                  'team-1': {
                    teamId: 'team-1',
                    alivePlayers: 1,
                    eliminated: false,
                    placement: 1,
                    totalKills: 7,
                    totalPlayers: 4,
                    eliminatedAt: null,
                    metadata: {
                      slot: 1,
                      teamName: 'Team One',
                      wasPresentInMatch: true,
                    },
                  },
                },
                players: {
                  'provisional:team-1:external:player-1': {
                    playerId: 'provisional:team-1:external:player-1',
                    teamId: 'team-1',
                    alive: true,
                    knocked: false,
                    kills: 7,
                    metadata: {
                      playerName: 'Alpha',
                      observedInTelemetry: true,
                    },
                  },
                },
                killFeed: [],
                events: [],
              },
            },
          }),
      },
      matchControlState: {
        findUnique: jest.fn().mockResolvedValue({
          authorityMode: 'AUTO',
          metaJson: null,
        }),
      },
      matchSlotResult: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'slot-result-1',
            slotNumber: 1,
            teamId: 'team-1',
            wasPresentInMatch: null,
            totalKills: 0,
            manualTotalKills: false,
            eliminatedOrder: null,
            eliminatedAt: null,
            team: {
              id: 'team-1',
              name: 'Team One',
              tag: 'ONE',
              logoUrl: null,
            },
            players: [
              {
                id: 'player-result-1',
                playerId: 'player-1',
                externalPlayerId: null,
                pubgAccountId: null,
                playerName: 'Alpha',
                kills: 0,
                isAlive: true,
                alive: true,
                isKnocked: false,
                player: {
                  externalPlayerId: null,
                  photoUrl: null,
                  inGameId: null,
                  ign: 'Alpha',
                },
              },
            ],
          },
        ]),
      },
      matchSlot: {
        findMany: jest.fn().mockResolvedValue([
          {
            slotNumber: 1,
            team: {
              id: 'team-1',
              name: 'Team One',
              tag: 'ONE',
              logoUrl: null,
              players: [],
            },
          },
        ]),
      },
    } as unknown as PrismaService;

    const service = new TelemetryEngineService(
      prisma,
      results,
      matchControl,
      new TelemetryValidatorService(),
      persistence,
      broadcast,
    );

    (service as any).runtimes.set('match-1', {
      matchId: 'match-1',
      status: 'ENDED',
      mode: 'AUTO',
      version: 6,
      sequence: 30,
      updatedAt: 230,
      telemetryAcceptedAt: 230,
      telemetryAcceptedSource: 'LAUNCHER',
      startedAt: 100,
      endedAt: 200,
      teamsAlive: 1,
      teams: {
        'team-1': {
          teamId: 'team-1',
          alivePlayers: 0,
          eliminated: true,
          placement: null,
          totalKills: 0,
          totalPlayers: 4,
          eliminatedAt: 200,
          metadata: {
            slot: 1,
            teamName: 'Team One',
            wasPresentInMatch: null,
          },
        },
      },
      players: {
        'player-1': {
          playerId: 'player-1',
          teamId: 'team-1',
          alive: false,
          knocked: false,
          kills: 0,
        },
      },
      killFeed: [],
      events: [],
    });

    await expect(service.getState('match-1')).resolves.toMatchObject({
      status: 'LIVE',
      endedAt: 240,
      teamsAlive: 1,
      teams: {
        'team-1': expect.objectContaining({
          totalKills: 7,
          placement: 1,
          metadata: expect.objectContaining({
            wasPresentInMatch: true,
          }),
        }),
      },
      players: {
        'provisional:team-1:external:player-1': expect.objectContaining({
          kills: 7,
          alive: true,
          metadata: expect.objectContaining({
            observedInTelemetry: true,
          }),
        }),
      },
    });
  });

  it('keeps manual player ownership authoritative over later telemetry', async () => {
    const matchControl = {
      endMatch: jest.fn().mockResolvedValue(undefined),
      startMatch: jest.fn().mockResolvedValue(undefined),
    } as unknown as MatchControlService;
    const persistence = {
      persistState: jest.fn().mockResolvedValue(undefined),
    } as unknown as TelemetryPersistenceService;
    const broadcast = {
      broadcastState: jest.fn().mockResolvedValue(undefined),
    } as unknown as TelemetryBroadcastService;
    const prisma = {
      matchControlState: {
        findUnique: jest.fn().mockResolvedValue({
          authorityMode: 'AUTO',
          metaJson: {
            liveSync: {
              version: 4,
              updatedAt: 100,
              overrides: {
                players: {
                  'player-1': {
                    alive: {
                      owner: 'MANUAL',
                      override: true,
                      updatedAt: 90,
                    },
                  },
                },
                teams: {},
              },
            },
          },
        }),
      },
      matchSlotResult: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'slot-result-1',
            slotNumber: 1,
            teamId: 'team-1',
            totalKills: 0,
            manualTotalKills: false,
            eliminatedOrder: null,
            eliminatedAt: null,
            team: {
              id: 'team-1',
              name: 'Team One',
              tag: 'ONE',
              logoUrl: null,
            },
            players: [
              {
                id: 'player-result-1',
                playerId: 'player-1',
                playerName: 'Alpha',
                kills: 0,
                isAlive: true,
                alive: true,
                isKnocked: false,
                player: {
                  externalPlayerId: null,
                  photoUrl: null,
                  inGameId: null,
                  ign: 'Alpha',
                },
              },
            ],
          },
        ]),
      },
    } as unknown as PrismaService;

    const service = new TelemetryEngineService(
      prisma,
      {} as ResultsService,
      matchControl,
      new TelemetryValidatorService(),
      persistence,
      broadcast,
    );

    (service as any).runtimes.set('match-1', {
      matchId: 'match-1',
      status: 'LIVE',
      mode: 'AUTO',
      version: 4,
      sequence: 3,
      updatedAt: 100,
      startedAt: 50,
      endedAt: null,
      teamsAlive: 1,
      teams: {
        'team-1': {
          teamId: 'team-1',
          alivePlayers: 1,
          eliminated: false,
          placement: 1,
          totalKills: 0,
          totalPlayers: 1,
          eliminatedAt: null,
          metadata: { slot: 1 },
        },
      },
      players: {
        'player-1': {
          playerId: 'player-1',
          teamId: 'team-1',
          alive: true,
          knocked: false,
          kills: 0,
        },
      },
    });

    const result = await service.applyTelemetryEvent({
      matchId: 'match-1',
      type: 'PLAYER_ALIVE_CHANGED',
      sequence: 10,
      timestamp: 125,
      source: 'TELEMETRY',
      payload: {
        playerId: 'player-1',
        alive: false,
      },
    });

    expect(result.state.players['player-1']).toMatchObject({
      alive: true,
      knocked: false,
    });
    expect(result.state.version).toBe(5);
    expect((persistence as any).persistState).toHaveBeenCalledWith(
      expect.objectContaining({
        version: 5,
        players: {
          'player-1': expect.objectContaining({
            alive: true,
          }),
        },
      }),
    );
  });

  it('does not mutate canonical player state from name-only adapter fallback', async () => {
    const matchControl = {
      endMatch: jest.fn().mockResolvedValue(undefined),
      startMatch: jest.fn().mockResolvedValue(undefined),
    } as unknown as MatchControlService;
    const persistence = {
      persistState: jest.fn().mockResolvedValue(undefined),
    } as unknown as TelemetryPersistenceService;
    const broadcast = {
      broadcastState: jest.fn().mockResolvedValue(undefined),
    } as unknown as TelemetryBroadcastService;
    const service = new TelemetryEngineService(
      {} as PrismaService,
      {} as ResultsService,
      matchControl,
      new TelemetryValidatorService(),
      persistence,
      broadcast,
    );

    (service as any).runtimes.set('match-1', {
      matchId: 'match-1',
      status: 'LIVE',
      mode: 'AUTO',
      version: 4,
      sequence: 3,
      updatedAt: 100,
      telemetryAcceptedAt: 100,
      telemetryAcceptedSource: 'PCOB_PUSH',
      startedAt: 50,
      endedAt: null,
      teamsAlive: 1,
      teams: {
        'team-1': {
          teamId: 'team-1',
          alivePlayers: 1,
          eliminated: false,
          placement: 1,
          totalKills: 0,
          totalPlayers: 1,
          eliminatedAt: null,
          metadata: { slot: 1 },
        },
      },
      players: {
        'canonical-player-1': {
          playerId: 'canonical-player-1',
          teamId: 'team-1',
          alive: true,
          knocked: false,
          kills: 0,
          metadata: {
            playerName: 'Alpha',
          },
        },
      },
      killFeed: [],
      events: [],
    });

    const result = await service.applyAdapterTelemetryEnvelope({
      matchId: 'match-1',
      sessionId: 'session-1',
      sequence: 4,
      timestamp: 100,
      players: [
        {
          teamId: 'team-1',
          ign: 'Alpha',
          alive: false,
        },
      ],
      teams: [],
      zone: null,
      events: [],
      source: 'PCOB_PUSH',
      raw: null,
    });

    expect(result.ignored).toBe(true);
    expect(result.reason).toBe('NO_STATE_CHANGE');
    expect(result.state.players['canonical-player-1']).toMatchObject({
      alive: true,
      knocked: false,
    });
    expect((persistence as any).persistState).not.toHaveBeenCalled();
  });

  it('clears released manual ownership so telemetry can resume on the next packet', async () => {
    const matchControl = {
      endMatch: jest.fn().mockResolvedValue(undefined),
      startMatch: jest.fn().mockResolvedValue(undefined),
    } as unknown as MatchControlService;
    const results = {
      ensureResultsFromSlots: jest.fn().mockResolvedValue(undefined),
    } as unknown as ResultsService;
    const persistence = {
      persistState: jest.fn().mockResolvedValue(undefined),
    } as unknown as TelemetryPersistenceService;
    const broadcast = {
      broadcastState: jest.fn().mockResolvedValue(undefined),
    } as unknown as TelemetryBroadcastService;
    const prisma = {
      matchControlState: {
        findUnique: jest.fn().mockResolvedValue({
          authorityMode: 'AUTO',
          metaJson: {
            liveSync: {
              version: 7,
              updatedAt: 200,
              overrides: {
                players: {},
                teams: {},
              },
            },
          },
        }),
      },
      matchSlotResult: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'slot-result-1',
            slotNumber: 1,
            teamId: 'team-1',
            totalKills: 0,
            manualTotalKills: false,
            eliminatedOrder: null,
            eliminatedAt: null,
            team: {
              id: 'team-1',
              name: 'Team One',
              tag: 'ONE',
              logoUrl: null,
            },
            players: [
              {
                id: 'player-result-1',
                playerId: 'player-1',
                playerName: 'Alpha',
                kills: 0,
                isAlive: true,
                alive: true,
                isKnocked: false,
                player: {
                  externalPlayerId: null,
                  photoUrl: null,
                  inGameId: null,
                  ign: 'Alpha',
                },
              },
            ],
          },
          {
            id: 'slot-result-2',
            slotNumber: 2,
            teamId: 'team-2',
            totalKills: 0,
            manualTotalKills: false,
            eliminatedOrder: null,
            eliminatedAt: null,
            team: {
              id: 'team-2',
              name: 'Team Two',
              tag: 'TWO',
              logoUrl: null,
            },
            players: [
              {
                id: 'player-result-2',
                playerId: 'player-2',
                playerName: 'Bravo',
                kills: 0,
                isAlive: true,
                alive: true,
                isKnocked: false,
                player: {
                  externalPlayerId: null,
                  photoUrl: null,
                  inGameId: null,
                  ign: 'Bravo',
                },
              },
            ],
          },
        ]),
      },
      match: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'match-1',
          organizationId: 'org-1',
          tournamentId: 'tour-1',
          status: 'LIVE',
          startedAt: new Date(50),
          endedAt: null,
          controlState: {
            state: 'LIVE',
            authorityMode: 'AUTO',
            metaJson: {
              liveSync: {
                version: 7,
                updatedAt: 200,
                overrides: {
                  players: {},
                  teams: {},
                },
              },
            },
          },
          stateSnapshot: {
            stateJson: null,
          },
        }),
      },
      matchSlot: {
        findMany: jest.fn().mockResolvedValue([
          {
            slotNumber: 1,
            team: {
              id: 'team-1',
              name: 'Team One',
              tag: 'ONE',
              logoUrl: null,
              players: [],
            },
          },
          {
            slotNumber: 2,
            team: {
              id: 'team-2',
              name: 'Team Two',
              tag: 'TWO',
              logoUrl: null,
              players: [],
            },
          },
        ]),
      },
    } as unknown as PrismaService;
    const stateStore = {
      get: jest.fn().mockResolvedValue({
        matchId: 'match-1',
        version: 7,
      }),
    };

    const service = new TelemetryEngineService(
      prisma,
      results,
      matchControl,
      new TelemetryValidatorService(),
      persistence,
      broadcast,
      stateStore as any,
    );

    (service as any).runtimes.set('match-1', {
      matchId: 'match-1',
      status: 'ENDED',
      mode: 'AUTO',
      version: 6,
      sequence: 8,
      updatedAt: 150,
      startedAt: 50,
      endedAt: 150,
      teamsAlive: 1,
      teams: {
        'team-1': {
          teamId: 'team-1',
          alivePlayers: 1,
          eliminated: false,
          placement: 1,
          totalKills: 0,
          totalPlayers: 1,
          eliminatedAt: null,
          metadata: { slot: 1 },
        },
        'team-2': {
          teamId: 'team-2',
          alivePlayers: 0,
          eliminated: true,
          placement: 2,
          totalKills: 0,
          totalPlayers: 1,
          eliminatedAt: 150,
          metadata: { slot: 2 },
        },
      },
      players: {
        'player-1': {
          playerId: 'player-1',
          teamId: 'team-1',
          alive: true,
          knocked: false,
          kills: 0,
          ownership: {
            alive: {
              owner: 'MANUAL',
              override: true,
              updatedAt: 140,
            },
          },
        },
        'player-2': {
          playerId: 'player-2',
          teamId: 'team-2',
          alive: true,
          knocked: false,
          kills: 0,
        },
      },
    });

    await service.republishMirror('match-1');

    const republishedState = (broadcast as any).broadcastState.mock
      .calls[0]?.[0];
    expect(republishedState?.version).toBe(8);
    expect((persistence as any).persistState).toHaveBeenCalledWith(
      expect.objectContaining({
        version: 8,
      }),
    );
    expect(republishedState?.status).toBe('LIVE');
    expect(republishedState?.teamsAlive).toBe(2);
    expect(republishedState?.endedAt).toBeNull();
    expect(republishedState?.players?.['player-1']?.alive).toBe(true);
    expect(republishedState?.players?.['player-1']?.ownership).toBeUndefined();

    const result = await service.applyTelemetryEvent({
      matchId: 'match-1',
      type: 'PLAYER_ALIVE_CHANGED',
      sequence: 11,
      timestamp: 225,
      source: 'TELEMETRY',
      payload: {
        playerId: 'player-1',
        alive: false,
      },
    });

    expect(result.state.players['player-1']).toMatchObject({
      alive: false,
      knocked: false,
    });
    expect(result.state.players['player-1']?.ownership).toBeUndefined();
  });

  it('republishes the already-incremented canonical release version instead of skipping ahead', async () => {
    const matchControl = {
      endMatch: jest.fn().mockResolvedValue(undefined),
      startMatch: jest.fn().mockResolvedValue(undefined),
    } as unknown as MatchControlService;
    const results = {
      ensureResultsFromSlots: jest.fn().mockResolvedValue(undefined),
    } as unknown as ResultsService;
    const persistence = {
      persistState: jest.fn().mockResolvedValue(undefined),
    } as unknown as TelemetryPersistenceService;
    const broadcast = {
      broadcastState: jest.fn().mockResolvedValue(undefined),
    } as unknown as TelemetryBroadcastService;
    const prisma = {
      matchControlState: {
        findUnique: jest.fn().mockResolvedValue({
          authorityMode: 'AUTO',
          metaJson: {
            liveSync: {
              version: 8,
              updatedAt: 300,
              overrides: {
                players: {},
                teams: {},
              },
            },
          },
        }),
      },
      match: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'match-1',
          organizationId: 'org-1',
          tournamentId: 'tour-1',
          status: 'LIVE',
          startedAt: new Date(50),
          endedAt: null,
          controlState: {
            state: 'LIVE',
            authorityMode: 'AUTO',
            metaJson: {
              liveSync: {
                version: 8,
                updatedAt: 300,
                overrides: {
                  players: {},
                  teams: {},
                },
              },
            },
          },
          stateSnapshot: {
            stateJson: null,
          },
        }),
      },
      matchSlotResult: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'slot-result-1',
            slotNumber: 1,
            teamId: 'team-1',
            totalKills: 1,
            manualTotalKills: false,
            eliminatedOrder: null,
            eliminatedAt: null,
            team: {
              id: 'team-1',
              name: 'Team One',
              tag: 'ONE',
              logoUrl: null,
            },
            players: [
              {
                id: 'player-result-1',
                playerId: 'player-1',
                playerName: 'Alpha',
                kills: 1,
                isAlive: true,
                alive: true,
                isKnocked: false,
                player: {
                  externalPlayerId: null,
                  photoUrl: null,
                  inGameId: null,
                  ign: 'Alpha',
                },
              },
            ],
          },
        ]),
      },
      matchSlot: {
        findMany: jest.fn().mockResolvedValue([
          {
            slotNumber: 1,
            team: {
              id: 'team-1',
              name: 'Team One',
              tag: 'ONE',
              logoUrl: null,
              players: [],
            },
          },
        ]),
      },
    } as unknown as PrismaService;
    const stateStore = {
      get: jest
        .fn()
        .mockResolvedValueOnce({ matchId: 'match-1', version: 7 })
        .mockResolvedValueOnce({ matchId: 'match-1', version: 7 }),
    };

    const service = new TelemetryEngineService(
      prisma,
      results,
      matchControl,
      new TelemetryValidatorService(),
      persistence,
      broadcast,
      stateStore as any,
    );

    await service.republishMirror('match-1');

    expect((persistence as any).persistState).toHaveBeenCalledWith(
      expect.objectContaining({
        version: 8,
      }),
    );
    expect((broadcast as any).broadcastState).toHaveBeenCalledWith(
      expect.objectContaining({
        version: 8,
      }),
    );
  });

  it('publishes the next mirror version when the runtime snapshot lags behind the live mirror', async () => {
    const matchControl = {
      endMatch: jest.fn().mockResolvedValue(undefined),
      startMatch: jest.fn().mockResolvedValue(undefined),
    } as unknown as MatchControlService;
    const results = {
      ensureResultsFromSlots: jest.fn().mockResolvedValue(undefined),
    } as unknown as ResultsService;
    const persistence = {
      persistState: jest.fn().mockResolvedValue(undefined),
    } as unknown as TelemetryPersistenceService;
    const broadcast = {
      broadcastState: jest.fn().mockResolvedValue(undefined),
    } as unknown as TelemetryBroadcastService;
    const prisma = {
      matchControlState: {
        findUnique: jest.fn().mockResolvedValue({
          authorityMode: 'AUTO',
          metaJson: {
            liveSync: {
              version: 1,
              updatedAt: 300,
              overrides: {
                players: {},
                teams: {},
              },
            },
          },
        }),
      },
      match: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'match-1',
          organizationId: 'org-1',
          tournamentId: 'tour-1',
          status: 'LIVE',
          startedAt: new Date(50),
          endedAt: null,
          controlState: {
            state: 'LIVE',
            authorityMode: 'AUTO',
            metaJson: {
              liveSync: {
                version: 1,
                updatedAt: 300,
                overrides: {
                  players: {},
                  teams: {},
                },
              },
            },
          },
          stateSnapshot: {
            stateJson: null,
          },
        }),
      },
      matchSlotResult: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'slot-result-1',
            slotNumber: 1,
            teamId: 'team-1',
            totalKills: 1,
            manualTotalKills: false,
            eliminatedOrder: null,
            eliminatedAt: null,
            team: {
              id: 'team-1',
              name: 'Team One',
              tag: 'ONE',
              logoUrl: null,
            },
            players: [
              {
                id: 'player-result-1',
                playerId: 'player-1',
                playerName: 'Alpha',
                kills: 1,
                isAlive: true,
                alive: true,
                isKnocked: false,
                player: {
                  externalPlayerId: null,
                  photoUrl: null,
                  inGameId: null,
                  ign: 'Alpha',
                },
              },
            ],
          },
        ]),
      },
      matchSlot: {
        findMany: jest.fn().mockResolvedValue([
          {
            slotNumber: 1,
            team: {
              id: 'team-1',
              name: 'Team One',
              tag: 'ONE',
              logoUrl: null,
              players: [],
            },
          },
        ]),
      },
    } as unknown as PrismaService;
    const stateStore = {
      get: jest
        .fn()
        .mockResolvedValueOnce({ matchId: 'match-1', version: 4 })
        .mockResolvedValueOnce({ matchId: 'match-1', version: 4 }),
    };

    const service = new TelemetryEngineService(
      prisma,
      results,
      matchControl,
      new TelemetryValidatorService(),
      persistence,
      broadcast,
      stateStore as any,
    );

    await service.republishMirror('match-1');

    expect((persistence as any).persistState).toHaveBeenCalledWith(
      expect.objectContaining({
        version: 5,
      }),
    );
    expect((broadcast as any).broadcastState).toHaveBeenCalledWith(
      expect.objectContaining({
        version: 5,
      }),
    );
  });

  it('does not mirror full team rosters when slot result player rows are empty', async () => {
    const matchControl = {
      endMatch: jest.fn().mockResolvedValue(undefined),
      startMatch: jest.fn().mockResolvedValue(undefined),
    } as unknown as MatchControlService;
    const results = {
      ensureResultsFromSlots: jest.fn().mockResolvedValue(undefined),
    } as unknown as ResultsService;
    const persistence = {
      persistState: jest.fn().mockResolvedValue(undefined),
    } as unknown as TelemetryPersistenceService;
    const broadcast = {
      broadcastState: jest.fn().mockResolvedValue(undefined),
    } as unknown as TelemetryBroadcastService;
    const prisma = {
      matchControlState: {
        findUnique: jest.fn().mockResolvedValue({
          authorityMode: 'AUTO',
          metaJson: {
            liveSync: {
              version: 0,
              updatedAt: 300,
              overrides: {
                players: {},
                teams: {},
              },
            },
          },
        }),
      },
      match: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'match-1',
          organizationId: 'org-1',
          tournamentId: 'tour-1',
          status: 'LIVE',
          startedAt: new Date(50),
          endedAt: null,
          controlState: {
            state: 'LIVE',
            authorityMode: 'AUTO',
            metaJson: {
              liveSync: {
                version: 0,
                updatedAt: 300,
                overrides: {
                  players: {},
                  teams: {},
                },
              },
            },
          },
          stateSnapshot: {
            stateJson: null,
          },
        }),
      },
      matchSlotResult: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'slot-result-1',
            slotNumber: 1,
            teamId: 'team-1',
            totalKills: 0,
            manualTotalKills: false,
            eliminatedOrder: null,
            eliminatedAt: null,
            team: {
              id: 'team-1',
              name: 'Team One',
              tag: 'ONE',
              logoUrl: null,
            },
            players: [],
          },
        ]),
      },
      matchSlot: {
        findMany: jest.fn().mockResolvedValue([
          {
            slotNumber: 1,
            team: {
              id: 'team-1',
              name: 'Team One',
              tag: 'ONE',
              logoUrl: null,
              players: [
                { id: 'p-1', ign: 'Alpha' },
                { id: 'p-2', ign: 'Bravo' },
                { id: 'p-3', ign: 'Charlie' },
                { id: 'p-4', ign: 'Delta' },
                { id: 'p-5', ign: 'Echo' },
              ],
            },
          },
        ]),
      },
    } as unknown as PrismaService;
    const stateStore = {
      get: jest.fn().mockResolvedValue(null),
    };

    const service = new TelemetryEngineService(
      prisma,
      results,
      matchControl,
      new TelemetryValidatorService(),
      persistence,
      broadcast,
      stateStore as any,
    );

    await service.republishMirror('match-1');

    const republishedState = (broadcast as any).broadcastState.mock
      .calls[0]?.[0];
    expect(republishedState?.teams?.['team-1']).toMatchObject({
      teamId: 'team-1',
      totalPlayers: 0,
      alivePlayers: 0,
    });
    expect(Object.keys(republishedState?.players ?? {})).toHaveLength(0);
  });
});
