import type { PrismaService } from '../../db/prisma.service';
import type { MatchControlService } from '../match-control/match-control.service';
import { TelemetryEngineService } from './telemetry-engine.service';
import { TelemetryMappingService } from './telemetry-mapping.service';
import { TelemetryValidatorService } from './telemetry-validator.service';
import type { TelemetryPersistenceService } from './telemetry-persistence.service';
import type { TelemetryBroadcastService } from './telemetry-broadcast.service';

describe('TelemetryEngineService', () => {
  it('rejects unsupported last-alive knock control commands', async () => {
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

    await expect(
      service.applyCommand({
        type: 'SET_PLAYER_KNOCKED',
        matchId: 'match-1',
        playerId: 'player-1',
        knocked: true,
      } as any),
    ).rejects.toThrow('Unsupported control command');
    expect((matchControl as any).endMatch).not.toHaveBeenCalled();
  });

  it('deduplicates adapter players that appear in both root and team sources', () => {
    const service = new TelemetryEngineService(
      {} as PrismaService,
      {} as MatchControlService,
      new TelemetryValidatorService(),
      {
        persistState: jest.fn(),
      } as unknown as TelemetryPersistenceService,
      {
        broadcastState: jest.fn(),
      } as unknown as TelemetryBroadcastService,
    );

    const players = (service as any).collectAdapterPlayers({
      matchId: 'match-1',
      sessionId: 'session-1',
      sequence: 1,
      timestamp: 100,
      players: [
        {
          playerId: 'player-1',
          teamId: 'team-1',
          alive: false,
        },
      ],
      teams: [
        {
          teamId: 'team-1',
          players: [
            {
              playerId: 'player-1',
              alive: true,
            },
          ],
        },
      ],
      zone: null,
      events: [],
      source: 'PCOB_PUSH',
      raw: null,
    });

    expect(players).toHaveLength(1);
    expect(players[0]).toMatchObject({
      player: {
        playerId: 'player-1',
        teamId: 'team-1',
        alive: true,
      },
      parentTeam: {
        teamId: 'team-1',
      },
    });
  });

  it('stores the real PUBG UID as inGameId instead of the OpenID', () => {
    const service = new TelemetryEngineService(
      {} as PrismaService,
      {} as MatchControlService,
      new TelemetryValidatorService(),
      {
        persistState: jest.fn(),
      } as unknown as TelemetryPersistenceService,
      {
        broadcastState: jest.fn(),
      } as unknown as TelemetryBroadcastService,
    );

    const state = {
      matchId: 'match-1',
      status: 'LIVE',
      mode: 'AUTO',
      version: 1,
      sequence: 1,
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
          placement: null,
          totalKills: 0,
          totalPlayers: 1,
          eliminatedAt: null,
        },
      },
      players: {},
      circle: null,
      killFeed: [],
      events: [],
    } as any;

    (service as any).materializeMappedStatePlayer(
      state,
      {
        player: {
          playerId: 'player-uuid-1',
          externalPlayerId: '5381251581',
          pubgPlayerId: '5381251581',
          pubgAccountId: '23439696441247016',
          ign: 'Alpha',
          alive: true,
        },
        parentTeam: null,
        playerIndex: null,
      },
      'team-1',
      {
        externalPlayerId: '5381251581',
        slotPlayerId: 'slot-player-1',
        locked: true,
        confidence: 1,
        lastSeenAt: 100,
        slotPlayerResultId: 'slot-player-1',
        playerKey: 'player-uuid-1',
        playerId: 'player-uuid-1',
        teamId: 'team-1',
        slotNumber: 1,
      },
    );

    expect(state.players['player-uuid-1'].metadata).toMatchObject({
      externalPlayerId: '5381251581',
      playerOpenId: '23439696441247016',
      inGameId: '5381251581',
    });
  });

  it('treats observed-player changes as a real runtime transition for adapter telemetry', async () => {
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
      sequence: 4,
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
          placement: null,
          totalKills: 0,
          totalPlayers: 1,
          eliminatedAt: null,
          metadata: {
            slot: 1,
            teamName: 'Team One',
            teamTag: 'ONE',
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
            externalPlayerId: 'ext-1',
            inGameId: 'pubg-1',
          },
        },
      },
      observedPlayer: null,
      circle: null,
      killFeed: [],
      events: [],
    });

    const result = await service.applyAdapterTelemetryEnvelope({
      matchId: 'match-1',
      sessionId: 'session-1',
      sequence: 5,
      timestamp: 150,
      players: [],
      teams: [],
      zone: null,
      events: [],
      observedPlayer: {
        playerId: 'player-1',
        externalPlayerId: 'ext-1',
        pubgPlayerId: 'pubg-1',
        playerName: 'Volt',
        teamId: 'team-1',
      },
      source: 'LAUNCHER',
      raw: null,
    });

    expect(result.ignored).not.toBe(true);
    expect(result.state.observedPlayer).toMatchObject({
      playerId: 'player-1',
      externalPlayerId: 'ext-1',
      pubgPlayerId: 'pubg-1',
      playerName: 'Volt',
      playerIgn: 'Volt',
      teamId: 'team-1',
      teamName: 'Team One',
      teamTag: 'ONE',
    });
    expect((persistence as any).persistState).toHaveBeenCalled();
    expect((broadcast as any).broadcastState).toHaveBeenCalledWith(
      expect.objectContaining({
        matchId: 'match-1',
        observedPlayer: expect.objectContaining({
          playerId: 'player-1',
        }),
      }),
    );
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
    expect((broadcast as any).broadcastState).toHaveBeenCalledWith(
      expect.objectContaining({
        matchId: 'match-1',
        status: 'LIVE',
      }),
    );
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

  it('uses fresh team aggregates when player mapping state disagrees', async () => {
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
      alivePlayers: 0,
      eliminated: true,
      placement: 2,
      totalKills: 2,
    });
    expect(result.state.teams['team-2']).toMatchObject({
      alivePlayers: 1,
      eliminated: false,
      placement: 1,
    });
    expect((matchControl as any).endMatch).not.toHaveBeenCalled();
  });

  it('restores a pruned canonical team when fresh team telemetry returns', async () => {
    const prisma = {
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
            wasPresentInMatch: true,
            totalKills: 0,
            manualTotalKills: false,
            eliminatedOrder: null,
            eliminatedAt: null,
            team: {
              id: 'team-1',
              name: 'Team 1',
              tag: 'T1',
              logoUrl: null,
            },
            players: [],
          },
          {
            id: 'slot-result-2',
            slotNumber: 2,
            teamId: 'team-2',
            wasPresentInMatch: true,
            totalKills: 0,
            manualTotalKills: false,
            eliminatedOrder: null,
            eliminatedAt: null,
            team: {
              id: 'team-2',
              name: 'Team 2',
              tag: 'T2',
              logoUrl: null,
            },
            players: [],
          },
        ]),
      },
    } as unknown as PrismaService;
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
      prisma,
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
          metadata: { slot: 1, teamName: 'Team 1', canonicalSeed: true },
        },
      },
      players: {},
      killFeed: [],
      events: [],
    });

    const result = await service.applyAdapterTelemetryEnvelope({
      matchId: 'match-1',
      sessionId: 'session-1',
      sequence: 5,
      timestamp: 250,
      players: [],
      teams: [
        {
          teamId: '2',
          alivePlayers: 0,
          totalPlayers: 4,
          eliminated: true,
          kills: 1,
          name: 'Team2',
        },
      ],
      zone: null,
      events: [],
      source: 'PCOB_PUSH',
      raw: null,
    });

    expect(result.ignored).not.toBe(true);
    expect(result.state.teams['team-2']).toMatchObject({
      alivePlayers: 0,
      eliminated: true,
      totalKills: 1,
    });
    expect(result.state.teams['team-2'].metadata).toMatchObject({
      slot: 2,
      canonicalSeed: true,
      observedInTelemetry: true,
      telemetryKills: 1,
    });
    expect(result.state.teamsAlive).toBe(0);
  });

  it('ignores team-scoped players when adapter telemetry has no canonical player match', async () => {
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

    expect(result.ignored).toBe(true);
    expect(result.reason).toBe('NO_STATE_CHANGE');
    expect(result.state.telemetryAcceptedAt).toBeNull();
    expect(result.state.teamsAlive).toBe(0);
    expect(result.state.teams['team-1']).toMatchObject({
      alivePlayers: 0,
      totalKills: 0,
      totalPlayers: 0,
    });
    expect(
      result.state.players['provisional:team-1:external:provider-player-404'],
    ).toBeUndefined();
    expect((persistence as any).persistState).not.toHaveBeenCalled();
  });

  it('materializes missing telemetry players for canonical slot teams when roster mapping is incomplete', async () => {
    const prisma = {
      matchSlotResult: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      matchSlot: {
        findMany: jest.fn().mockResolvedValue([
          {
            slotNumber: 1,
            team: {
              id: 'team-1',
              name: 'Team One',
              tag: 'T1',
              logoUrl: null,
              players: [],
            },
          },
        ]),
      },
      match: {
        findUnique: jest.fn().mockResolvedValue({
          matchSlots: [
            {
              slotNumber: 1,
              team: {
                id: 'team-1',
                players: [],
              },
            },
          ],
        }),
      },
    } as unknown as PrismaService;
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
    const mapping = new TelemetryMappingService(prisma);
    const service = new TelemetryEngineService(
      prisma,
      matchControl,
      new TelemetryValidatorService(),
      persistence,
      broadcast,
      null as never,
      mapping,
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
          metadata: {
            slot: 1,
            canonicalSeed: true,
            provisional: false,
          },
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
          externalPlayerId: 'provider-player-1',
          ign: 'Alpha One',
          alive: true,
          kills: 2,
        },
      ],
      teams: [],
      zone: null,
      events: [],
      source: 'API',
      raw: null,
    });

    expect(result.ignored).not.toBe(true);
    expect(result.state.telemetryAcceptedAt).toBe(150);
    expect(result.state.players['provider-player-1']).toMatchObject({
      playerId: 'provider-player-1',
      teamId: 'team-1',
      alive: true,
      kills: 2,
      metadata: expect.objectContaining({
        playerName: 'Alpha One',
      }),
    });
    expect(result.state.teams['team-1']).toMatchObject({
      totalPlayers: 1,
      alivePlayers: 1,
    });
    expect((persistence as any).persistState).toHaveBeenCalled();
  });

  it('does not fall back to stale provisional player identities when canonical mapping is enforced', async () => {
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
    const mapping = {
      resolve: jest.fn().mockResolvedValue(null),
      confirmMapping: jest.fn(),
      getStability: jest.fn().mockReturnValue({
        stability: 0,
        locked: 0,
        expected: 1,
      }),
      logStability: jest.fn(),
    };
    const service = new TelemetryEngineService(
      {} as PrismaService,
      matchControl,
      new TelemetryValidatorService(),
      persistence,
      broadcast,
      null as any,
      mapping as any,
    );

    (service as any).runtimes.set('match-1', {
      matchId: 'match-1',
      status: 'LIVE',
      mode: 'AUTO',
      version: 3,
      sequence: 4,
      updatedAt: 100,
      telemetryAcceptedAt: 100,
      telemetryAcceptedSource: 'LAUNCHER',
      startedAt: 90,
      endedAt: null,
      teamsAlive: 1,
      teams: {
        'team-1': {
          teamId: 'team-1',
          alivePlayers: 1,
          eliminated: false,
          placement: null,
          totalKills: 2,
          totalPlayers: 2,
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
            slotPlayerResultId: 'player-result-1',
            externalPlayerId: 'provider-player-1',
            playerName: 'Alpha',
            observedInTelemetry: true,
          },
        },
        'provider-player-1': {
          playerId: 'provider-player-1',
          teamId: 'team-1',
          alive: true,
          knocked: false,
          kills: 0,
          metadata: {
            externalPlayerId: 'provider-player-1',
            playerName: 'Alpha',
            provisional: true,
          },
        },
      },
      killFeed: [],
      events: [],
    });

    const result = await service.applyAdapterTelemetryEnvelope({
      matchId: 'match-1',
      sessionId: 'session-1',
      sequence: 5,
      timestamp: 150,
      players: [
        {
          teamId: 'team-1',
          externalPlayerId: 'provider-player-1',
          ign: 'Alpha',
          alive: true,
          kills: 3,
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
    expect(result.state.telemetryAcceptedSource).toBe('API');
    expect(Object.keys(result.state.players).sort()).toEqual(['player-1']);
    expect(result.state.players['player-1']).toMatchObject({
      kills: 2,
      metadata: expect.objectContaining({
        slotPlayerResultId: 'player-result-1',
        externalPlayerId: 'provider-player-1',
      }),
    });
    expect(
      result.state.players[
        'provider-player-1' as keyof typeof result.state.players
      ],
    ).toBeUndefined();
  });

  it('records fresh team telemetry aggregates even when player mapping is partial', async () => {
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
      matchControl,
      new TelemetryValidatorService(),
      persistence,
      broadcast,
    );

    (service as any).runtimes.set('match-team-telemetry', {
      matchId: 'match-team-telemetry',
      status: 'LIVE',
      mode: 'AUTO',
      version: 1,
      sequence: 10,
      updatedAt: 100,
      telemetryAcceptedAt: null,
      telemetryAcceptedSource: null,
      startedAt: 90,
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
          },
        },
        'team-2': {
          teamId: 'team-2',
          alivePlayers: 4,
          eliminated: false,
          placement: null,
          totalKills: 0,
          totalPlayers: 4,
          eliminatedAt: null,
          metadata: {
            slot: 2,
            teamName: 'Team Two',
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
      circle: null,
    });

    const result = await service.applyAdapterTelemetryEnvelope({
      matchId: 'match-team-telemetry',
      sessionId: 'session-1',
      sequence: 11,
      timestamp: 150,
      players: [],
      teams: [
        {
          teamId: 'team-1',
          alivePlayers: 4,
          totalPlayers: 4,
          kills: 0,
          placement: 1,
        },
        {
          teamId: 'team-2',
          alivePlayers: 3,
          totalPlayers: 4,
          kills: 1,
          placement: 2,
        },
      ],
      zone: null,
      events: [],
      source: 'LAUNCHER',
      raw: null,
    });

    expect(result.ignored).not.toBe(true);
    expect(result.state.telemetryAcceptedAt).toBe(150);
    expect(result.state.teamsAlive).toBe(2);
    expect(result.state.teams['team-1']).toMatchObject({
      alivePlayers: 4,
      totalPlayers: 4,
      totalKills: 0,
      placement: 1,
      eliminated: false,
    });
    expect(result.state.teams['team-2']).toMatchObject({
      alivePlayers: 3,
      totalPlayers: 4,
      totalKills: 1,
      placement: 2,
      eliminated: false,
    });
    expect(result.state.teams['team-1'].metadata).toEqual(
      expect.objectContaining({
        telemetryAlivePlayers: 4,
        telemetryTotalPlayers: 4,
        telemetryKills: 0,
        telemetryPlacement: 1,
        telemetryLastSeenAt: 150,
      }),
    );
    expect(result.state.teams['team-2'].metadata).toEqual(
      expect.objectContaining({
        telemetryAlivePlayers: 3,
        telemetryTotalPlayers: 4,
        telemetryKills: 1,
        telemetryPlacement: 2,
        telemetryLastSeenAt: 150,
      }),
    );
  });

  it('drops never-observed canonical placeholders once strong live team telemetry takes over', async () => {
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
    const mapping = {
      resolve: jest.fn().mockResolvedValue(null),
      confirmMapping: jest.fn(),
      getStability: jest.fn().mockReturnValue({
        stability: 0,
        locked: 0,
        expected: 0,
      }),
      logStability: jest.fn(),
    };
    const service = new TelemetryEngineService(
      {} as PrismaService,
      matchControl,
      new TelemetryValidatorService(),
      persistence,
      broadcast,
      null as any,
      mapping as any,
    );

    const makePlaceholderPlayer = (teamId: string, id: string) => ({
      playerId: id,
      teamId,
      alive: true,
      knocked: false,
      kills: 0,
      metadata: {
        playerName: id,
        slotPlayerResultId: id,
        canonicalSeed: true,
      },
    });

    (service as any).runtimes.set('match-telemetry-cleanup', {
      matchId: 'match-telemetry-cleanup',
      status: 'LIVE',
      mode: 'AUTO',
      version: 1,
      sequence: 10,
      updatedAt: 100,
      telemetryAcceptedAt: null,
      telemetryAcceptedSource: null,
      startedAt: 90,
      endedAt: null,
      teamsAlive: 4,
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
            canonicalSeed: true,
          },
        },
        'team-2': {
          teamId: 'team-2',
          alivePlayers: 4,
          eliminated: false,
          placement: null,
          totalKills: 0,
          totalPlayers: 4,
          eliminatedAt: null,
          metadata: {
            slot: 2,
            teamName: 'Team Two',
            canonicalSeed: true,
          },
        },
        'team-3': {
          teamId: 'team-3',
          alivePlayers: 4,
          eliminated: false,
          placement: null,
          totalKills: 0,
          totalPlayers: 4,
          eliminatedAt: null,
          metadata: {
            slot: 3,
            teamName: 'Team Three',
            canonicalSeed: true,
          },
        },
        'team-4': {
          teamId: 'team-4',
          alivePlayers: 4,
          eliminated: false,
          placement: null,
          totalKills: 0,
          totalPlayers: 4,
          eliminatedAt: null,
          metadata: {
            slot: 4,
            teamName: 'Team Four',
            canonicalSeed: true,
          },
        },
      },
      players: {
        'team-1-player': makePlaceholderPlayer('team-1', 'team-1-player'),
        'team-2-player': makePlaceholderPlayer('team-2', 'team-2-player'),
        'team-3-player': makePlaceholderPlayer('team-3', 'team-3-player'),
        'team-4-player': makePlaceholderPlayer('team-4', 'team-4-player'),
      },
      killFeed: [],
      events: [],
      circle: { phase: 3 },
    });

    const result = await service.applyAdapterTelemetryEnvelope({
      matchId: 'match-telemetry-cleanup',
      sessionId: 'session-1',
      sequence: 11,
      timestamp: 150,
      players: [],
      teams: [
        {
          teamId: 'team-1',
          alivePlayers: 4,
          totalPlayers: 4,
          kills: 1,
          placement: 1,
        },
        {
          teamId: 'team-2',
          alivePlayers: 3,
          totalPlayers: 4,
          kills: 2,
          placement: 2,
        },
        {
          teamId: 'team-3',
          alivePlayers: 2,
          totalPlayers: 4,
          kills: 0,
          placement: 3,
        },
      ],
      zone: { phase: 3 },
      events: [],
      source: 'LAUNCHER',
      raw: null,
    });

    expect(result.ignored).not.toBe(true);
    expect(Object.keys(result.state.players)).toEqual([]);
    expect(Object.keys(result.state.teams).sort()).toEqual([
      'team-1',
      'team-2',
      'team-3',
    ]);
    expect(result.state.teamsAlive).toBe(3);
    expect(result.state.teams['team-2']).toMatchObject({
      alivePlayers: 3,
      totalPlayers: 4,
      totalKills: 2,
      placement: 2,
    });
    expect(result.state.teams['team-4']).toBeUndefined();
  });

  it('only applies position updates while a telemetry player mapping is unlocked', async () => {
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
    const mappingResult = {
      externalPlayerId: 'provider-player-1',
      slotPlayerId: 'slot-player-1',
      slotPlayerResultId: 'slot-player-1',
      playerKey: 'player-1',
      playerId: 'player-1',
      teamId: 'team-1',
      slotNumber: 1,
      locked: false,
      confidence: 0.6,
      lastSeenAt: 150,
    };
    const mapping = {
      resolve: jest.fn().mockResolvedValue(mappingResult),
      confirmMapping: jest.fn().mockReturnValue(mappingResult),
      getStability: jest.fn().mockReturnValue({
        stability: 0,
        locked: 0,
        expected: 1,
      }),
      logStability: jest.fn(),
    };
    const service = new TelemetryEngineService(
      {} as PrismaService,
      matchControl,
      new TelemetryValidatorService(),
      persistence,
      broadcast,
      null as any,
      mapping as any,
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
          metadata: { slot: 1, teamName: 'Team One' },
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
            slotPlayerResultId: 'slot-player-1',
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
      sequence: 1,
      timestamp: 150,
      players: [
        {
          externalPlayerId: 'provider-player-1',
          teamId: 'team-1',
          alive: false,
          knocked: true,
          kills: 4,
          position: { x: 10, y: 20 },
        },
      ],
      teams: [],
      zone: null,
      events: [],
      source: 'PCOB_PUSH',
      raw: null,
    });

    expect(result.ignored).not.toBe(true);
    expect(result.state.players['player-1']).toMatchObject({
      alive: true,
      knocked: false,
      kills: 0,
      metadata: expect.objectContaining({
        position: { x: 10, y: 20 },
      }),
    });
    expect(
      result.state.players['player-1'].metadata?.observedInTelemetry,
    ).not.toBe(true);
    expect(mapping.confirmMapping).toHaveBeenCalledWith(
      'match-1',
      'provider-player-1',
      'slot-player-1',
    );
    expect(mapping.logStability).toHaveBeenCalledWith('match-1', 1);
  });

  it('throws when telemetry tries to move a canonical player to another team', async () => {
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
      },
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
          playerId: 'player-1',
          teamId: 'team-2',
          alive: true,
        },
      ],
      teams: [],
      zone: null,
      events: [],
      source: 'PCOB_PUSH',
      raw: null,
    });

    expect(result).toMatchObject({
      ignored: true,
      reason: 'NO_STATE_CHANGE',
      state: {
        matchId: 'match-1',
        status: 'LIVE',
      },
    });
    expect((persistence as any).persistState).not.toHaveBeenCalled();
    expect((broadcast as any).broadcastState).toHaveBeenCalledWith(
      expect.objectContaining({
        matchId: 'match-1',
        players: expect.objectContaining({
          'player-1': expect.objectContaining({
            teamId: 'team-1',
            alive: true,
          }),
        }),
      }),
    );
  });

  it('keeps non-terminal runtime updates when a match-end guardrail blocks completion', async () => {
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
      sequence: 5,
      updatedAt: 100,
      telemetryAcceptedAt: 100,
      telemetryAcceptedSource: 'PCOB_PUSH',
      startedAt: 90,
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
      circle: { phase: 4 },
    });

    const result = await service.applyAdapterTelemetryEnvelope({
      matchId: 'match-1',
      sessionId: 'session-1',
      sequence: 6,
      timestamp: 150,
      players: [
        {
          playerId: 'player-1',
          teamId: 'team-1',
          alive: true,
        },
        {
          playerId: 'player-2',
          teamId: 'team-2',
          alive: false,
        },
      ],
      teams: [],
      zone: { phase: 4 },
      events: [],
      source: 'PCOB_PUSH',
      raw: null,
    });

    expect(result.ignored).not.toBe(true);
    expect(result.state.status).toBe('LIVE');
    expect(result.state.endedAt).toBeNull();
    expect(result.state.players['player-2']).toMatchObject({
      alive: false,
      teamId: 'team-2',
    });
    expect(result.state.teams['team-2']).toMatchObject({
      alivePlayers: 0,
      eliminated: true,
    });
    expect((matchControl as any).endMatch).not.toHaveBeenCalled();
    expect((persistence as any).persistState).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'LIVE',
        players: expect.objectContaining({
          'player-2': expect.objectContaining({ alive: false }),
        }),
      }),
    );
    expect((broadcast as any).broadcastState).toHaveBeenCalledWith(
      expect.objectContaining({
        matchId: 'match-1',
        status: 'LIVE',
      }),
    );
  });

  it('ignores a stale ended snapshot when the match row is live again', async () => {
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

  it('ignores an empty live snapshot and rebuilds from canonical roster state', async () => {
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
              status: 'LIVE',
              mode: 'AUTO',
              version: 12,
              sequence: 40,
              updatedAt: 200,
              telemetryAcceptedAt: 200,
              telemetryAcceptedSource: 'LAUNCHER',
              startedAt: 100,
              endedAt: null,
              teamsAlive: 0,
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
            wasPresentInMatch: null,
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
                {
                  id: 'player-a',
                  ign: 'Alpha',
                  realName: null,
                  photoUrl: null,
                  externalPlayerId: 'ext-a',
                  playerOpenId: null,
                  inGameId: null,
                  pubgPlayerId: null,
                },
              ],
            },
          },
        ]),
      },
    } as unknown as PrismaService;

    const service = new TelemetryEngineService(
      prisma,
      matchControl,
      new TelemetryValidatorService(),
      persistence,
      broadcast,
    );

    const state = await service.getState('match-1');

    expect(state.teams['team-1']).toMatchObject({
      teamId: 'team-1',
      metadata: {
        slot: 1,
      },
    });
    expect(Object.keys(state.players)).toContain('player-a');
    expect(state.telemetryAcceptedAt).toBeNull();
  });

  it('refreshes an in-memory ended runtime when the persisted match has started a new live run', async () => {
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

  it('mirrors the control-owned slot roster when slot result player rows are empty', async () => {
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
      totalPlayers: 4,
      alivePlayers: 4,
    });
    expect(Object.keys(republishedState?.players ?? {})).toEqual([
      'p-1',
      'p-2',
      'p-3',
      'p-4',
    ]);
  });

  const createParachuteHarness = () => {
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
      matchControl,
      new TelemetryValidatorService(),
      persistence,
      broadcast,
    );
    return { service, matchControl, persistence, broadcast };
  };

  const seedParachuteRuntime = (
    service: TelemetryEngineService,
    status: 'PENDING' | 'LIVE' = 'PENDING',
  ) => {
    (service as any).runtimes.set('match-1', {
      matchId: 'match-1',
      status,
      mode: 'AUTO',
      version: 12,
      sequence: 20,
      updatedAt: 1_000,
      telemetryAcceptedAt: 1_000,
      telemetryAcceptedSource: 'PCOB_PUSH',
      startedAt: status === 'LIVE' ? 900 : null,
      endedAt: null,
      teamsAlive: 2,
      circle: { phase: 0 },
      teams: {
        'team-1': {
          teamId: 'team-1',
          alivePlayers: 4,
          eliminated: false,
          placement: null,
          totalKills: 0,
          totalPlayers: 4,
          eliminatedAt: null,
          metadata: { slot: 1, observedInTelemetry: true },
        },
        'team-2': {
          teamId: 'team-2',
          alivePlayers: 4,
          eliminated: false,
          placement: null,
          totalKills: 0,
          totalPlayers: 4,
          eliminatedAt: null,
          metadata: { slot: 2, observedInTelemetry: true },
        },
      },
      players: Object.fromEntries(
        Array.from({ length: 8 }, (_, index) => {
          const playerNumber = index + 1;
          const teamId = playerNumber <= 4 ? 'team-1' : 'team-2';
          const playerId = `player-${playerNumber}`;
          return [
            playerId,
            {
              playerId,
              teamId,
              alive: true,
              knocked: false,
              kills: 0,
              metadata: {
                playerName: `Player ${playerNumber}`,
                externalPlayerId: `external-${playerNumber}`,
                inGameId: `open-${playerNumber}`,
                observedInTelemetry: true,
              },
            },
          ];
        }),
      ),
      killFeed: [],
      events: [],
    });
  };

  const seedLargeAirRuntime = (
    service: TelemetryEngineService,
    options: { teams?: number; players?: number } = {},
  ) => {
    const teamCount = options.teams ?? 19;
    const playerCount = options.players ?? 75;
    const teams: Record<string, any> = {};
    const players: Record<string, any> = {};

    for (let teamIndex = 1; teamIndex <= teamCount; teamIndex += 1) {
      teams[`team-${teamIndex}`] = {
        teamId: `team-${teamIndex}`,
        alivePlayers: 0,
        eliminated: false,
        placement: null,
        totalKills: 0,
        totalPlayers: 0,
        eliminatedAt: null,
        metadata: {
          slot: teamIndex,
          teamName: `Team ${teamIndex}`,
          observedInTelemetry: true,
        },
      };
    }

    for (let playerIndex = 1; playerIndex <= playerCount; playerIndex += 1) {
      const teamNumber = Math.min(
        teamCount,
        Math.floor((playerIndex - 1) / 4) + 1,
      );
      const playerId = `player-${playerIndex}`;
      const teamId = `team-${teamNumber}`;
      teams[teamId].alivePlayers += 1;
      teams[teamId].totalPlayers += 1;
      players[playerId] = {
        playerId,
        teamId,
        alive: true,
        knocked: false,
        kills: 0,
        metadata: {
          playerName: `Player ${playerIndex}`,
          externalPlayerId: `external-${playerIndex}`,
          inGameId: `open-${playerIndex}`,
          observedInTelemetry: true,
        },
      };
    }

    (service as any).runtimes.set('match-75', {
      matchId: 'match-75',
      status: 'LIVE',
      mode: 'AUTO',
      version: 12,
      sequence: 20,
      updatedAt: 1_000,
      telemetryAcceptedAt: 1_000,
      telemetryAcceptedSource: 'PCOB_PUSH',
      startedAt: 900,
      endedAt: null,
      teamsAlive: teamCount,
      circle: { phase: 0 },
      teams,
      players,
      killFeed: [],
      events: [],
    });
  };

  const buildFullParachutePlayers = (
    options: {
      idShape?: 'canonical' | 'teamNameOnly';
      deadPlayer?: string;
    } = {},
  ) =>
    Array.from({ length: 8 }, (_, index) => {
      const playerNumber = index + 1;
      const teamNo = playerNumber <= 4 ? '1' : '2';
      const canonical = `player-${playerNumber}`;
      return options.idShape === 'teamNameOnly'
        ? {
            ign: `Player ${playerNumber}`,
            teamId: teamNo,
            alive: canonical !== options.deadPlayer,
            position: { x: 100 + playerNumber, y: 200 + playerNumber },
            raw: {
              playerName: `Player ${playerNumber}`,
              teamNo,
              state: 'PARACHUTING',
            },
          }
        : {
            playerId: canonical,
            externalPlayerId: `external-${playerNumber}`,
            pubgAccountId: `open-${playerNumber}`,
            teamId: playerNumber <= 4 ? 'team-1' : 'team-2',
            alive: canonical !== options.deadPlayer,
            position: { x: 100 + playerNumber, y: 200 + playerNumber },
            raw: { state: 'PARACHUTING' },
          };
    });

  it('preserves pre-plane runtime state when the first parachuting packet is partial', async () => {
    const { service, matchControl, persistence } = createParachuteHarness();
    const warnSpy = jest.spyOn((service as any).logger, 'warn');
    const logSpy = jest.spyOn((service as any).logger, 'log');
    const debugSpy = jest.spyOn((service as any).logger, 'debug');

    seedParachuteRuntime(service);

    const result = await service.applyAdapterTelemetryEnvelope({
      matchId: 'match-1',
      sessionId: 'session-live',
      sequence: 21,
      timestamp: 1_100,
      players: [
        {
          playerId: 'player-1',
          teamId: 'team-1',
          alive: false,
        },
        {
          playerId: 'player-2',
          teamId: 'team-1',
          alive: true,
        },
      ],
      teams: [],
      zone: { phase: 1 },
      events: [],
      source: 'PCOB_PUSH',
      raw: { state: 'PARACHUTING' },
    });

    expect(result.state.status).toBe('LIVE');
    expect(result.state.startedAt).toBe(1_100);
    expect(Object.keys(result.state.players)).toHaveLength(8);
    expect(result.state.players['player-3']).toMatchObject({
      alive: true,
      teamId: 'team-1',
    });
    expect(result.state.teams['team-1']).toMatchObject({
      alivePlayers: 4,
      eliminated: false,
    });
    expect(result.state.teamsAlive).toBe(2);
    expect(result.state.circle).toMatchObject({ phase: 1 });
    expect((persistence as any).persistState).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'LIVE',
        players: expect.objectContaining({
          'player-8': expect.objectContaining({ alive: true }),
        }),
      }),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('pending-live-signal-runtime-reset-blocked'),
    );
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('[PHASE TRANSITION][BEFORE]'),
    );
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('[PHASE TRANSITION][AFTER]'),
    );
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('[PARACHUTE][TICK]'),
    );
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('[PARACHUTE][COUNT CHANGE]'),
    );
    expect(debugSpy).toHaveBeenCalledWith(
      expect.stringContaining('[PARACHUTE][IDS]'),
    );
    expect(debugSpy).toHaveBeenCalledWith(
      expect.stringContaining('[PARACHUTE][FIELD SHAPE]'),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[PARACHUTE][PARTIAL SNAPSHOT BLOCKED]'),
    );
    expect((matchControl as any).startMatch).not.toHaveBeenCalled();
  });

  it('preserves stable 75/75 alive counts when a parachuting packet reports every player dead', async () => {
    const { service, persistence, broadcast } = createParachuteHarness();
    const warnSpy = jest.spyOn((service as any).logger, 'warn');
    const logSpy = jest.spyOn((service as any).logger, 'log');
    seedLargeAirRuntime(service);

    const result = await service.applyAdapterTelemetryEnvelope({
      matchId: 'match-75',
      sessionId: 'session-live',
      sequence: 21,
      timestamp: 1_100,
      players: Array.from({ length: 75 }, (_, index) => {
        const playerNumber = index + 1;
        const teamNumber = Math.min(19, Math.floor(index / 4) + 1);
        return {
          playerId: `player-${playerNumber}`,
          externalPlayerId: `external-${playerNumber}`,
          pubgAccountId: `open-${playerNumber}`,
          teamId: `team-${teamNumber}`,
          alive: false,
          knocked: false,
          raw: {
            playerName: `Player ${playerNumber}`,
            teamNo: teamNumber,
            liveState: 1,
            state: 'PARACHUTING',
          },
        };
      }),
      teams: [],
      zone: { phase: 1 },
      events: [],
      source: 'PCOB_PUSH',
      raw: { state: 'PARACHUTING' },
    });

    const alivePlayers = Object.values(result.state.teams).reduce(
      (sum, team) => sum + team.alivePlayers,
      0,
    );
    expect(Object.keys(result.state.players)).toHaveLength(75);
    expect(alivePlayers).toBe(75);
    expect(result.state.teamsAlive).toBe(19);
    expect(Object.values(result.state.teams)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          teamId: 'team-1',
          alivePlayers: 4,
          eliminated: false,
          placement: null,
        }),
        expect.objectContaining({
          teamId: 'team-19',
          alivePlayers: 3,
          eliminated: false,
          placement: null,
        }),
      ]),
    );
    expect((persistence as any).persistState).toHaveBeenCalledWith(
      expect.objectContaining({
        teamsAlive: 19,
        teams: expect.objectContaining({
          'team-1': expect.objectContaining({
            alivePlayers: 4,
            eliminated: false,
          }),
        }),
      }),
    );
    expect((broadcast as any).broadcastState).toHaveBeenCalledWith(
      expect.objectContaining({
        teamsAlive: 19,
      }),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[ELIMINATION][BLOCKED]'),
    );
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('[ELIMINATION][PHASE]'),
    );
  });

  it('preserves team aggregates when early-air packets report a sharp alive-team drop', async () => {
    const { service, persistence, broadcast } = createParachuteHarness();
    const warnSpy = jest.spyOn((service as any).logger, 'warn');
    seedLargeAirRuntime(service, { teams: 21, players: 84 });

    const result = await service.applyAdapterTelemetryEnvelope({
      matchId: 'match-75',
      sessionId: 'session-live',
      sequence: 21,
      timestamp: 1_100,
      players: Array.from({ length: 84 }, (_, index) => {
        const playerNumber = index + 1;
        const teamNumber = Math.floor(index / 4) + 1;
        const alive = playerNumber <= 32;
        return {
          playerId: `player-${playerNumber}`,
          externalPlayerId: `external-${playerNumber}`,
          pubgAccountId: `open-${playerNumber}`,
          teamId: `team-${teamNumber}`,
          alive,
          knocked: false,
          raw: {
            playerName: `Player ${playerNumber}`,
            teamNo: teamNumber,
            liveState: alive ? 0 : 1,
            state: 'PARACHUTING',
          },
        };
      }),
      teams: Array.from({ length: 21 }, (_, index) => {
        const teamNumber = index + 1;
        return {
          teamId: `team-${teamNumber}`,
          slot: teamNumber,
          alivePlayers: teamNumber <= 8 ? 4 : 0,
          totalPlayers: 4,
          kills: 0,
        };
      }),
      zone: { phase: 1 },
      events: [],
      source: 'PCOB_PUSH',
      raw: { state: 'PARACHUTING' },
    });

    const teams = Object.values(result.state.teams);
    expect(teams).toHaveLength(21);
    expect(result.state.teamsAlive).toBe(21);
    expect(teams.every((team) => team.alivePlayers === 4)).toBe(true);
    expect(teams.every((team) => team.eliminated === false)).toBe(true);
    expect(result.state.teams['team-9'].metadata).toMatchObject({
      slot: 9,
      observedInTelemetry: true,
    });
    expect(result.state.teams['team-9'].metadata).not.toHaveProperty(
      'telemetryAlivePlayers',
    );
    expect(result.state.teams['team-9'].metadata).not.toHaveProperty(
      'telemetryLastSeenAt',
    );
    expect((persistence as any).persistState).toHaveBeenCalledWith(
      expect.objectContaining({
        teamsAlive: 21,
        teams: expect.objectContaining({
          'team-9': expect.objectContaining({
            alivePlayers: 4,
            eliminated: false,
          }),
        }),
      }),
    );
    expect((broadcast as any).broadcastState).toHaveBeenCalledWith(
      expect.objectContaining({
        teamsAlive: 21,
      }),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('fresh-team-telemetry-aggregate-blocked'),
    );
  });

  it('blocks phase-1 eliminations before the early-air grace window expires', async () => {
    const { service } = createParachuteHarness();
    seedLargeAirRuntime(service, { teams: 2, players: 8 });
    const runtime = (service as any).runtimes.get('match-75');
    runtime.startedAt = 0;
    runtime.circle = { phase: 1 };

    const result = await service.applyAdapterTelemetryEnvelope({
      matchId: 'match-75',
      sessionId: 'session-live',
      sequence: 21,
      timestamp: 120_000,
      players: Array.from({ length: 8 }, (_, index) => {
        const playerNumber = index + 1;
        const teamNumber = playerNumber <= 4 ? 1 : 2;
        return {
          playerId: `player-${playerNumber}`,
          externalPlayerId: `external-${playerNumber}`,
          pubgAccountId: `open-${playerNumber}`,
          teamId: `team-${teamNumber}`,
          alive: playerNumber <= 3,
          knocked: false,
          position: { x: 100 + playerNumber, y: 200 + playerNumber },
          raw: { state: 'LIVE' },
        };
      }),
      teams: [],
      zone: { phase: 1 },
      events: [],
      source: 'PCOB_PUSH',
      raw: { state: 'LIVE' },
    });

    expect(result.state.players['player-1']).toMatchObject({ alive: true });
    expect(result.state.players['player-4']).toMatchObject({ alive: true });
    expect(result.state.players['player-8']).toMatchObject({ alive: true });
    expect(result.state.teams['team-1']).toMatchObject({
      alivePlayers: 4,
      eliminated: false,
    });
    expect(result.state.teams['team-2']).toMatchObject({
      alivePlayers: 4,
      eliminated: false,
    });
    expect(result.state.teamsAlive).toBe(2);
  });

  it('continues blocking phase-1 death-only snapshots after the early-air grace window expires', async () => {
    const { service } = createParachuteHarness();
    seedLargeAirRuntime(service, { teams: 2, players: 8 });
    const runtime = (service as any).runtimes.get('match-75');
    runtime.startedAt = 0;
    runtime.circle = { phase: 1 };

    const result = await service.applyAdapterTelemetryEnvelope({
      matchId: 'match-75',
      sessionId: 'session-live',
      sequence: 21,
      timestamp: 240_001,
      players: Array.from({ length: 8 }, (_, index) => {
        const playerNumber = index + 1;
        const teamNumber = playerNumber <= 4 ? 1 : 2;
        return {
          playerId: `player-${playerNumber}`,
          externalPlayerId: `external-${playerNumber}`,
          pubgAccountId: `open-${playerNumber}`,
          teamId: `team-${teamNumber}`,
          alive: playerNumber <= 3,
          knocked: false,
          position: { x: 100 + playerNumber, y: 200 + playerNumber },
          raw: { state: 'LIVE' },
        };
      }),
      teams: [],
      zone: { phase: 1 },
      events: [],
      source: 'PCOB_PUSH',
      raw: { state: 'LIVE' },
    });

    expect(result.state.players['player-1']).toMatchObject({ alive: true });
    expect(result.state.players['player-4']).toMatchObject({ alive: true });
    expect(result.state.players['player-8']).toMatchObject({ alive: true });
    expect(result.state.teams['team-1']).toMatchObject({
      alivePlayers: 4,
      eliminated: false,
    });
    expect(result.state.teams['team-2']).toMatchObject({
      alivePlayers: 4,
      eliminated: false,
    });
    expect(result.state.teamsAlive).toBe(2);
  });

  it('accepts phase-1 eliminations after the early-air grace window expires when the packet carries kill evidence', async () => {
    const { service } = createParachuteHarness();
    seedLargeAirRuntime(service, { teams: 2, players: 8 });
    const runtime = (service as any).runtimes.get('match-75');
    runtime.startedAt = 0;
    runtime.circle = { phase: 1 };

    const result = await service.applyAdapterTelemetryEnvelope({
      matchId: 'match-75',
      sessionId: 'session-live',
      sequence: 21,
      timestamp: 240_001,
      players: Array.from({ length: 8 }, (_, index) => {
        const playerNumber = index + 1;
        const teamNumber = playerNumber <= 4 ? 1 : 2;
        return {
          playerId: `player-${playerNumber}`,
          externalPlayerId: `external-${playerNumber}`,
          pubgAccountId: `open-${playerNumber}`,
          teamId: `team-${teamNumber}`,
          alive: playerNumber <= 3,
          knocked: false,
          kills: playerNumber === 1 ? 1 : 0,
          position: { x: 100 + playerNumber, y: 200 + playerNumber },
          raw: { state: 'LIVE' },
        };
      }),
      teams: [],
      zone: { phase: 1 },
      events: [],
      source: 'PCOB_PUSH',
      raw: { state: 'LIVE' },
    });

    expect(result.state.players['player-1']).toMatchObject({
      alive: true,
      kills: 1,
    });
    expect(result.state.players['player-4']).toMatchObject({ alive: false });
    expect(result.state.players['player-8']).toMatchObject({ alive: false });
    expect(result.state.teams['team-1']).toMatchObject({
      alivePlayers: 3,
      eliminated: false,
    });
    expect(result.state.teams['team-2']).toMatchObject({
      alivePlayers: 0,
      eliminated: true,
    });
    expect(result.state.teamsAlive).toBe(1);
  });

  it('merges duplicate adapter player rows in the same tick and preserves the alive runtime state', async () => {
    const { service } = createParachuteHarness();
    const errorSpy = jest.spyOn((service as any).logger, 'error');
    seedParachuteRuntime(service, 'LIVE');

    const result = await service.applyAdapterTelemetryEnvelope({
      matchId: 'match-1',
      sessionId: 'session-live',
      sequence: 21,
      timestamp: 1_100,
      players: buildFullParachutePlayers({ deadPlayer: 'player-1' }),
      teams: [
        {
          teamId: 'team-1',
          slot: 1,
          players: [
            {
              playerId: 'player-1',
              teamId: 'team-1',
              alive: true,
              knocked: false,
              raw: {
                playerName: 'Player 1',
                teamNo: 1,
                state: 'PARACHUTING',
              },
            },
          ],
        },
      ],
      zone: { phase: 1 },
      events: [],
      source: 'PCOB_PUSH',
      raw: { state: 'PARACHUTING' },
    });

    expect(result.state.players['player-1']).toMatchObject({
      alive: true,
      teamId: 'team-1',
    });
    expect(result.state.teams['team-1']).toMatchObject({
      alivePlayers: 4,
      eliminated: false,
    });
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('[CRITICAL][PLAYER STATE CONFLICT]'),
    );
  });

  it('preserves mapping when parachuting packets drop player IDs but keep team number and name', async () => {
    const { service } = createParachuteHarness();
    const debugSpy = jest.spyOn((service as any).logger, 'debug');
    seedParachuteRuntime(service);

    const result = await service.applyAdapterTelemetryEnvelope({
      matchId: 'match-1',
      sessionId: 'session-live',
      sequence: 21,
      timestamp: 1_100,
      players: buildFullParachutePlayers({ idShape: 'teamNameOnly' }),
      teams: [],
      zone: { phase: 1 },
      events: [],
      source: 'PCOB_PUSH',
      raw: { state: 'PARACHUTING' },
    });

    expect(Object.keys(result.state.players)).toHaveLength(8);
    expect(result.state.players['player-1'].metadata?.position).toEqual({
      x: 101,
      y: 201,
    });
    expect(result.state.players['player-8'].metadata?.position).toEqual({
      x: 108,
      y: 208,
    });
    expect(result.state.teamsAlive).toBe(2);
    expect(debugSpy).toHaveBeenCalledWith(
      expect.stringContaining('adapter-player-team-name-mapped'),
    );
  });

  it('does not block late-combat eliminations for a full-roster packet with id churn only', () => {
    const { service } = createParachuteHarness();
    seedParachuteRuntime(service, 'LIVE');
    const runtime = (service as any).runtimes.get('match-1');
    runtime.startedAt = 0;
    runtime.circle = { phase: 4 };

    const incomingPlayers = buildFullParachutePlayers({
      deadPlayer: 'player-8',
    }).map(({ raw, ...player }) => ({
      player: {
        ...player,
        raw: { ...(raw ?? {}), state: 'COMBAT' },
      },
      parentTeam: null,
    }));
    const eliminationSafety = (service as any).buildEliminationSafetyContext(
      runtime,
      {
        matchId: 'match-1',
        source: 'PCOB_PUSH',
        sessionId: 'session-live',
        sequence: 21,
        timestamp: 360_000,
        players: [],
        teams: [],
        events: [],
        zone: { phase: 5 },
        raw: { state: 'COMBAT' },
      },
      incomingPlayers,
      {
        nextPhase: 5,
        packetState: 'state:COMBAT|phase:5',
        incomingPlayers: 8,
        currentPlayers: 8,
        overlapRatio: 0.25,
        sharpPlayerDrop: false,
        partialTransitionSnapshot: false,
        transitionLike: false,
        parachuteSignal: false,
      },
    );

    expect(eliminationSafety.airPhase).toBe(false);
    expect(eliminationSafety.unstableTransitionPacket).toBe(false);
    expect(eliminationSafety.blockPlayerLifeUpdates).toBe(false);
    expect(eliminationSafety.reason).toBeNull();
  });

  it('blocks parachuting eliminations from partial and full air packets, then accepts combat confirmation', async () => {
    const { service } = createParachuteHarness();
    const warnSpy = jest.spyOn((service as any).logger, 'warn');
    seedParachuteRuntime(service, 'LIVE');

    const partial = await service.applyAdapterTelemetryEnvelope({
      matchId: 'match-1',
      sessionId: 'session-live',
      sequence: 21,
      timestamp: 1_100,
      players: buildFullParachutePlayers().slice(0, 2),
      teams: [],
      zone: { phase: 1 },
      events: [],
      source: 'PCOB_PUSH',
      raw: { state: 'PARACHUTING' },
    });

    expect(Object.keys(partial.state.players)).toHaveLength(8);
    expect(partial.state.teams['team-1']).toMatchObject({
      alivePlayers: 4,
      eliminated: false,
    });
    expect(partial.state.teamsAlive).toBe(2);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[PARACHUTE][PARTIAL SNAPSHOT BLOCKED]'),
    );

    const full = await service.applyAdapterTelemetryEnvelope({
      matchId: 'match-1',
      sessionId: 'session-live',
      sequence: 22,
      timestamp: 1_200,
      players: buildFullParachutePlayers({ deadPlayer: 'player-8' }),
      teams: [],
      zone: { phase: 1 },
      events: [],
      source: 'PCOB_PUSH',
      raw: { state: 'PARACHUTING' },
    });

    expect(Object.keys(full.state.players)).toHaveLength(8);
    expect(full.state.players['player-8']).toMatchObject({
      alive: true,
      teamId: 'team-2',
    });
    expect(full.state.teams['team-2']).toMatchObject({
      alivePlayers: 4,
      eliminated: false,
    });
    expect(full.state.teamsAlive).toBe(2);

    const combat = await service.applyAdapterTelemetryEnvelope({
      matchId: 'match-1',
      sessionId: 'session-live',
      sequence: 23,
      timestamp: 1_300,
      players: buildFullParachutePlayers({ deadPlayer: 'player-8' }).map(
        (player) => ({
          ...player,
          raw: { state: 'COMBAT' },
        }),
      ),
      teams: [],
      zone: { phase: 2 },
      events: [],
      source: 'PCOB_PUSH',
      raw: { state: 'COMBAT' },
    });

    expect(combat.state.players['player-8']).toMatchObject({
      alive: false,
      teamId: 'team-2',
    });
    expect(combat.state.teams['team-2']).toMatchObject({
      alivePlayers: 3,
      eliminated: false,
    });
    expect(combat.state.teamsAlive).toBe(2);
  });

  it('blocks kill-event elimination during plane/parachuting', async () => {
    const { service } = createParachuteHarness();
    const warnSpy = jest.spyOn((service as any).logger, 'warn');
    seedParachuteRuntime(service, 'LIVE');

    const result = await service.applyAdapterTelemetryEnvelope({
      matchId: 'match-1',
      sessionId: 'session-live',
      sequence: 21,
      timestamp: 1_100,
      players: buildFullParachutePlayers(),
      teams: [],
      zone: { phase: 1 },
      events: [
        {
          type: 'KILL',
          timestamp: 1_100,
          killerId: 'player-1',
          killerTeamId: 'team-1',
          victimId: 'player-8',
          victimTeamId: 'team-2',
          payload: { weapon: 'test' },
        },
      ],
      source: 'PCOB_PUSH',
      raw: { state: 'PARACHUTING' },
    });

    expect(result.state.players['player-8']).toMatchObject({
      alive: true,
      teamId: 'team-2',
    });
    expect(result.state.teams['team-2']).toMatchObject({
      alivePlayers: 4,
      eliminated: false,
    });
    expect(result.state.killFeed ?? []).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('kill-event-blocked-during-air-transition'),
    );
  });

  it('blocks phase-one cumulative updates without resetting established combat stats', async () => {
    const { service } = createParachuteHarness();
    const warnSpy = jest.spyOn((service as any).logger, 'warn');
    seedParachuteRuntime(service, 'LIVE');

    const runtime = (service as any).runtimes.get('match-1');
    runtime.startedAt = 900;
    runtime.circle = { phase: 1 };
    runtime.players['player-1'].kills = 1;
    runtime.players['player-8'].alive = false;
    runtime.players['player-8'].health = 0;
    runtime.teams['team-1'].totalKills = 1;
    runtime.teams['team-2'].alivePlayers = 3;

    const result = await service.applyAdapterTelemetryEnvelope({
      matchId: 'match-1',
      sessionId: 'session-live',
      sequence: 21,
      timestamp: 10_000,
      players: buildFullParachutePlayers({ deadPlayer: 'player-8' }).map(
        (player, index) => ({
          ...player,
          kills: index === 0 ? 2 : 0,
          raw: { state: 'IN_GAME' },
        }),
      ),
      teams: [],
      zone: { phase: 1 },
      events: [],
      source: 'PCOB_PUSH',
      raw: { state: 'IN_GAME' },
    });

    expect(result.state.players['player-1']).toMatchObject({
      alive: true,
      kills: 1,
    });
    expect(result.state.players['player-8']).toMatchObject({
      alive: false,
      knocked: false,
      kills: 0,
      health: 0,
    });
    expect(result.state.teams['team-1']).toMatchObject({
      alivePlayers: 4,
      eliminated: false,
      totalKills: 1,
    });
    expect(result.state.teams['team-2']).toMatchObject({
      alivePlayers: 3,
      eliminated: false,
      placement: null,
    });
    expect(result.state.teamsAlive).toBe(2);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('precombat-critical-runtime-state-reset-skipped'),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('precombat-player-kill-update-blocked'),
    );
  });

  it('does not infer placements for empty roster teams in null-phase roster snapshots', async () => {
    const { service } = createParachuteHarness();
    seedLargeAirRuntime(service, { teams: 4, players: 8 });

    const runtime = (service as any).runtimes.get('match-75');
    runtime.circle = null;

    const result = await service.applyAdapterTelemetryEnvelope({
      matchId: 'match-75',
      sessionId: 'session-live',
      sequence: 21,
      timestamp: 1_100,
      players: Array.from({ length: 8 }, (_, index) => {
        const playerNumber = index + 1;
        return {
          playerId: `player-${playerNumber}`,
          externalPlayerId: `external-${playerNumber}`,
          pubgAccountId: `open-${playerNumber}`,
          teamId: playerNumber <= 4 ? 'team-1' : 'team-2',
          alive: true,
          knocked: false,
          position: { x: 100 + playerNumber, y: 200 + playerNumber },
          raw: { state: 'LIVE' },
        };
      }),
      teams: [],
      zone: null,
      events: [],
      source: 'PCOB_PUSH',
      raw: null,
    });

    expect(result.state.teamsAlive).toBe(2);
    expect(result.state.teams['team-3']).toMatchObject({
      alivePlayers: 0,
      totalPlayers: 0,
      eliminated: false,
      placement: null,
      eliminatedAt: null,
    });
    expect(result.state.teams['team-4']).toMatchObject({
      alivePlayers: 0,
      totalPlayers: 0,
      eliminated: false,
      placement: null,
      eliminatedAt: null,
    });
  });

  it('restores persisted canonical slots omitted from a phase-one partial packet', async () => {
    const { service } = createParachuteHarness();
    seedParachuteRuntime(service, 'LIVE');

    const runtime = (service as any).runtimes.get('match-1');
    runtime.circle = { phase: 1 };

    const persistedTeams = new Map<string, any>();
    const persistedPlayers = new Map<string, any>();
    const addPersistedTeam = (
      teamNumber: number,
      overrides: Partial<{
        alivePlayers: number;
        eliminated: boolean;
        placement: number | null;
        totalKills: number;
        eliminatedAt: number | null;
      }> = {},
    ) => {
      const teamId = `team-${teamNumber}`;
      persistedTeams.set(teamId, {
        teamId,
        alivePlayers: overrides.alivePlayers ?? 4,
        eliminated: overrides.eliminated ?? false,
        placement: overrides.placement ?? null,
        totalKills: overrides.totalKills ?? 0,
        totalPlayers: 4,
        eliminatedAt: overrides.eliminatedAt ?? null,
        metadata: {
          slot: teamNumber,
          teamName: `Team ${teamNumber}`,
          slotResultId: `slot-result-${teamNumber}`,
          wasPresentInMatch: null,
        },
      });
      for (let index = 1; index <= 4; index += 1) {
        const playerId = `team-${teamNumber}-player-${index}`;
        persistedPlayers.set(playerId, {
          playerId,
          teamId,
          alive: !(overrides.eliminated && index === 1),
          knocked: false,
          kills: overrides.totalKills && index === 1 ? overrides.totalKills : 0,
          assists: 0,
          health: overrides.eliminated && index === 1 ? 0 : null,
          metadata: {
            playerName: `Team ${teamNumber} Player ${index}`,
            slotPlayerResultId: `slot-player-${teamNumber}-${index}`,
          },
        });
      }
    };

    addPersistedTeam(1);
    addPersistedTeam(2);
    addPersistedTeam(3, {
      alivePlayers: 3,
      eliminated: true,
      placement: 16,
      totalKills: 2,
      eliminatedAt: 1_050,
    });
    addPersistedTeam(4);

    (service as any).loadPersistedOverrideSnapshot = jest
      .fn()
      .mockResolvedValue({
        mode: 'API',
        version: 12,
        teams: persistedTeams,
        players: persistedPlayers,
      });

    const result = await service.applyAdapterTelemetryEnvelope({
      matchId: 'match-1',
      sessionId: 'session-live',
      sequence: 21,
      timestamp: 1_100,
      players: buildFullParachutePlayers(),
      teams: [
        { teamId: 'team-1', alivePlayers: 4, totalPlayers: 4, kills: 0 },
        { teamId: 'team-2', alivePlayers: 4, totalPlayers: 4, kills: 0 },
      ],
      zone: { phase: 1 },
      events: [],
      source: 'PCOB_PUSH',
      raw: { state: 'IN_GAME' },
    });

    expect(Object.keys(result.state.teams).sort()).toEqual([
      'team-1',
      'team-2',
      'team-3',
      'team-4',
    ]);
    expect(Object.keys(result.state.players)).toHaveLength(16);
    expect(result.state.teams['team-3']).toMatchObject({
      alivePlayers: 4,
      eliminated: false,
      placement: null,
      totalKills: 0,
      totalPlayers: 4,
      eliminatedAt: null,
      metadata: {
        canonicalSeed: true,
        provisional: false,
        slotResultId: 'slot-result-3',
      },
    });
    expect(result.state.players['team-3-player-1']).toMatchObject({
      alive: true,
      knocked: false,
      kills: 0,
      health: null,
    });
    expect(result.state.teamsAlive).toBe(4);
  });

  it('does not trigger lifecycle or results reinitialization during parachuting transition packets', async () => {
    const { service, matchControl } = createParachuteHarness();
    const warnSpy = jest.spyOn((service as any).logger, 'warn');
    seedParachuteRuntime(service);

    await service.applyAdapterTelemetryEnvelope({
      matchId: 'match-1',
      sessionId: 'session-live',
      sequence: 21,
      timestamp: 1_100,
      players: buildFullParachutePlayers().slice(0, 2),
      teams: [],
      zone: { phase: 1 },
      events: [{ type: 'MATCH_START', timestamp: 1_100 }],
      source: 'PCOB_PUSH',
      raw: { state: 'PARACHUTING' },
    });

    expect((matchControl as any).startMatch).not.toHaveBeenCalled();
    expect((matchControl as any).endMatch).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('pending-live-signal-runtime-reset-blocked'),
    );
  });

  it('seeds canonical teams and fallback players from match slots before slot results exist', async () => {
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
        findMany: jest.fn().mockResolvedValue([
          {
            slotNumber: 1,
            team: {
              id: 'team-1',
              name: 'Team One',
              tag: 'ONE',
              logoUrl: null,
              players: [
                {
                  id: 'player-a',
                  ign: 'Alpha',
                  realName: null,
                  photoUrl: null,
                  externalPlayerId: 'ext-a',
                  playerOpenId: null,
                  inGameId: null,
                  pubgPlayerId: null,
                },
                {
                  id: 'player-b',
                  ign: 'Bravo',
                  realName: null,
                  photoUrl: null,
                  externalPlayerId: 'ext-b',
                  playerOpenId: null,
                  inGameId: null,
                  pubgPlayerId: null,
                },
                {
                  id: 'player-c',
                  ign: 'Charlie',
                  realName: null,
                  photoUrl: null,
                  externalPlayerId: 'ext-c',
                  playerOpenId: null,
                  inGameId: null,
                  pubgPlayerId: null,
                },
                {
                  id: 'player-d',
                  ign: 'Delta',
                  realName: null,
                  photoUrl: null,
                  externalPlayerId: 'ext-d',
                  playerOpenId: null,
                  inGameId: null,
                  pubgPlayerId: null,
                },
              ],
            },
          },
        ]),
      },
    } as unknown as PrismaService;

    const service = new TelemetryEngineService(
      prisma,
      matchControl,
      new TelemetryValidatorService(),
      persistence,
      broadcast,
    );

    const state = await service.getState('match-1');

    expect(state.teams['team-1']).toMatchObject({
      teamId: 'team-1',
      totalPlayers: 4,
      metadata: {
        slot: 1,
        slotResultId: null,
        canonicalSeed: true,
        provisional: false,
      },
    });
    expect(Object.keys(state.players)).toHaveLength(4);
    expect(state.players['player-a']).toMatchObject({
      playerId: 'player-a',
      teamId: 'team-1',
      alive: true,
      metadata: {
        playerName: 'Alpha',
        slotPlayerResultId: 'player-a',
        externalPlayerId: 'ext-a',
        canonicalSeed: true,
        provisional: false,
      },
    });
  });

  it('does not seed arbitrary players from oversized team rosters when slot-result players are missing', async () => {
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
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'slot-result-1',
            teamId: 'team-1',
            slotNumber: 1,
            wasPresentInMatch: null,
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
                {
                  id: 'player-a',
                  ign: 'Alpha',
                  realName: null,
                  photoUrl: null,
                  externalPlayerId: 'ext-a',
                  playerOpenId: null,
                  inGameId: null,
                  pubgPlayerId: null,
                },
                {
                  id: 'player-b',
                  ign: 'Bravo',
                  realName: null,
                  photoUrl: null,
                  externalPlayerId: 'ext-b',
                  playerOpenId: null,
                  inGameId: null,
                  pubgPlayerId: null,
                },
                {
                  id: 'player-c',
                  ign: 'Charlie',
                  realName: null,
                  photoUrl: null,
                  externalPlayerId: 'ext-c',
                  playerOpenId: null,
                  inGameId: null,
                  pubgPlayerId: null,
                },
                {
                  id: 'player-d',
                  ign: 'Delta',
                  realName: null,
                  photoUrl: null,
                  externalPlayerId: 'ext-d',
                  playerOpenId: null,
                  inGameId: null,
                  pubgPlayerId: null,
                },
                {
                  id: 'player-e',
                  ign: 'Echo',
                  realName: null,
                  photoUrl: null,
                  externalPlayerId: 'ext-e',
                  playerOpenId: null,
                  inGameId: null,
                  pubgPlayerId: null,
                },
                {
                  id: 'player-f',
                  ign: 'Foxtrot',
                  realName: null,
                  photoUrl: null,
                  externalPlayerId: 'ext-f',
                  playerOpenId: null,
                  inGameId: null,
                  pubgPlayerId: null,
                },
                {
                  id: 'player-g',
                  ign: 'Golf',
                  realName: null,
                  photoUrl: null,
                  externalPlayerId: 'ext-g',
                  playerOpenId: null,
                  inGameId: null,
                  pubgPlayerId: null,
                },
                {
                  id: 'player-h',
                  ign: 'Hotel',
                  realName: null,
                  photoUrl: null,
                  externalPlayerId: 'ext-h',
                  playerOpenId: null,
                  inGameId: null,
                  pubgPlayerId: null,
                },
                {
                  id: 'player-i',
                  ign: 'India',
                  realName: null,
                  photoUrl: null,
                  externalPlayerId: 'ext-i',
                  playerOpenId: null,
                  inGameId: null,
                  pubgPlayerId: null,
                },
              ],
            },
          },
        ]),
      },
    } as unknown as PrismaService;

    const service = new TelemetryEngineService(
      prisma,
      matchControl,
      new TelemetryValidatorService(),
      persistence,
      broadcast,
    );

    const state = await service.getState('match-1');

    expect(state.players).toEqual({});
    expect(state.teams['team-1']).toMatchObject({
      totalPlayers: 0,
      alivePlayers: 0,
      metadata: {
        canonicalSeed: true,
        provisional: false,
        slot: 1,
      },
    });
  });

  it('does not prune canonical seeded teams during getState cleanup after telemetry has been accepted', async () => {
    const service = new TelemetryEngineService(
      {} as PrismaService,
      {} as MatchControlService,
      new TelemetryValidatorService(),
      {
        persistState: jest.fn(),
      } as unknown as TelemetryPersistenceService,
      {
        broadcastState: jest.fn(),
      } as unknown as TelemetryBroadcastService,
    );

    (service as any).runtimes.set('match-1', {
      matchId: 'match-1',
      status: 'LIVE',
      mode: 'AUTO',
      version: 1,
      sequence: 0,
      updatedAt: 200,
      telemetryAcceptedAt: 180,
      telemetryAcceptedSource: 'LAUNCHER',
      startedAt: 100,
      endedAt: null,
      teamsAlive: 1,
      circle: null,
      killFeed: [],
      events: [],
      teams: {
        'team-1': {
          teamId: 'team-1',
          alivePlayers: 0,
          eliminated: false,
          placement: null,
          totalKills: 0,
          totalPlayers: 0,
          eliminatedAt: null,
          metadata: {
            slot: 1,
            slotResultId: 'slot-result-1',
            canonicalSeed: true,
            provisional: true,
          },
        },
      },
      players: {},
    });

    const state = await service.getState('match-1');

    expect(state.teams['team-1']).toMatchObject({
      teamId: 'team-1',
      metadata: expect.objectContaining({
        slot: 1,
        slotResultId: 'slot-result-1',
        canonicalSeed: true,
      }),
    });
  });

  it('replaces placeholder fallback players with live telemetry players for the active team', async () => {
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
      startedAt: 100,
      endedAt: null,
      teamsAlive: 1,
      circle: null,
      killFeed: [],
      events: [],
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
          },
        },
      },
      players: {
        'placeholder-1': {
          playerId: 'placeholder-1',
          teamId: 'team-1',
          alive: true,
          knocked: false,
          kills: 0,
          metadata: {
            playerName: 'Old One',
            slotPlayerResultId: null,
          },
        },
        'placeholder-2': {
          playerId: 'placeholder-2',
          teamId: 'team-1',
          alive: true,
          knocked: false,
          kills: 0,
          metadata: {
            playerName: 'Old Two',
            slotPlayerResultId: null,
          },
        },
        'placeholder-3': {
          playerId: 'placeholder-3',
          teamId: 'team-1',
          alive: true,
          knocked: false,
          kills: 0,
          metadata: {
            playerName: 'Old Three',
            slotPlayerResultId: null,
          },
        },
        'placeholder-4': {
          playerId: 'placeholder-4',
          teamId: 'team-1',
          alive: true,
          knocked: false,
          kills: 0,
          metadata: {
            playerName: 'Old Four',
            slotPlayerResultId: null,
          },
        },
      },
    });

    const result = await service.applyAdapterTelemetryEnvelope({
      matchId: 'match-1',
      sessionId: 'session-live',
      sequence: 7,
      timestamp: 200,
      players: [],
      teams: [
        {
          teamId: 'team-1',
          slot: 1,
          players: [
            {
              externalPlayerId: 'live-1',
              ign: 'Live One',
              alive: true,
              knocked: false,
              kills: 1,
            },
            {
              externalPlayerId: 'live-2',
              ign: 'Live Two',
              alive: true,
              knocked: false,
              kills: 0,
            },
            {
              externalPlayerId: 'live-3',
              ign: 'Live Three',
              alive: true,
              knocked: false,
              kills: 0,
            },
            {
              externalPlayerId: 'live-4',
              ign: 'Live Four',
              alive: true,
              knocked: false,
              kills: 0,
            },
          ],
        },
      ],
      zone: { phase: 3 },
      events: [],
      source: 'LAUNCHER',
      raw: { state: 'LIVE' },
    });

    expect(Object.keys(result.state.players).sort()).toEqual([
      'live-1',
      'live-2',
      'live-3',
      'live-4',
    ]);
    expect(result.state.players['live-1']).toMatchObject({
      teamId: 'team-1',
      kills: 1,
      alive: true,
      metadata: {
        playerName: 'Live One',
        provisional: true,
        observedInTelemetry: true,
      },
    });
    expect(result.state.teams['team-1']).toMatchObject({
      alivePlayers: 4,
      totalPlayers: 4,
      metadata: {
        observedInTelemetry: true,
      },
    });
  });

  it('prunes never-observed seeded teams and players once real telemetry arrives', async () => {
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
      startedAt: 100,
      endedAt: null,
      teamsAlive: 2,
      circle: null,
      killFeed: [],
      events: [],
      teams: {
        'team-1': {
          teamId: 'team-1',
          alivePlayers: 4,
          eliminated: false,
          placement: null,
          totalKills: 0,
          totalPlayers: 4,
          eliminatedAt: null,
          metadata: { slot: 1 },
        },
        'team-2': {
          teamId: 'team-2',
          alivePlayers: 0,
          eliminated: false,
          placement: null,
          totalKills: 0,
          totalPlayers: 0,
          eliminatedAt: null,
          metadata: { slot: 2, provisional: true },
        },
      },
      players: {
        'placeholder-1': {
          playerId: 'placeholder-1',
          teamId: 'team-1',
          alive: true,
          knocked: false,
          kills: 0,
          metadata: { playerName: 'Old One', slotPlayerResultId: null },
        },
        'placeholder-2': {
          playerId: 'placeholder-2',
          teamId: 'team-1',
          alive: true,
          knocked: false,
          kills: 0,
          metadata: { playerName: 'Old Two', slotPlayerResultId: null },
        },
        'placeholder-3': {
          playerId: 'placeholder-3',
          teamId: 'team-1',
          alive: true,
          knocked: false,
          kills: 0,
          metadata: { playerName: 'Old Three', slotPlayerResultId: null },
        },
        'placeholder-4': {
          playerId: 'placeholder-4',
          teamId: 'team-1',
          alive: true,
          knocked: false,
          kills: 0,
          metadata: { playerName: 'Old Four', slotPlayerResultId: null },
        },
      },
    });

    const result = await service.applyAdapterTelemetryEnvelope({
      matchId: 'match-1',
      sessionId: 'session-live',
      sequence: 8,
      timestamp: 250,
      players: [
        {
          teamId: 'team-1',
          externalPlayerId: 'live-1',
          ign: 'Live One',
          alive: true,
          knocked: false,
          kills: 1,
        },
        {
          teamId: 'team-1',
          externalPlayerId: 'live-2',
          ign: 'Live Two',
          alive: true,
          knocked: false,
          kills: 0,
        },
        {
          teamId: 'team-1',
          externalPlayerId: 'live-3',
          ign: 'Live Three',
          alive: true,
          knocked: false,
          kills: 0,
        },
        {
          teamId: 'team-1',
          externalPlayerId: 'live-4',
          ign: 'Live Four',
          alive: true,
          knocked: false,
          kills: 0,
        },
      ],
      teams: [],
      zone: null,
      events: [],
      source: 'PCOB_PUSH',
      raw: null,
    });

    expect(Object.keys(result.state.players).sort()).toEqual([
      'live-1',
      'live-2',
      'live-3',
      'live-4',
    ]);
    expect(Object.keys(result.state.teams)).toEqual(['team-1']);
    expect(result.state.teamsAlive).toBe(1);
    expect(result.state.teams['team-1']).toMatchObject({
      alivePlayers: 4,
      totalPlayers: 4,
    });
  });

  it('derives live placements from confirmed telemetry teams, not empty roster rows', () => {
    const service = new TelemetryEngineService(
      {} as PrismaService,
      {} as MatchControlService,
      new TelemetryValidatorService(),
      {
        persistState: jest.fn(),
      } as unknown as TelemetryPersistenceService,
      {
        broadcastState: jest.fn(),
      } as unknown as TelemetryBroadcastService,
    );
    const teams: Record<string, any> = {};
    const players: Record<string, any> = {};

    for (let teamIndex = 1; teamIndex <= 20; teamIndex += 1) {
      const teamId = `team-${teamIndex}`;
      const participated = teamIndex <= 17;
      const eliminated = teamIndex <= 3;
      teams[teamId] = {
        teamId,
        alivePlayers: participated && !eliminated ? 4 : 0,
        eliminated: participated && eliminated,
        placement:
          teamIndex === 1
            ? 20
            : teamIndex === 2
              ? 19
              : teamIndex === 3
                ? 18
                : null,
        totalKills: 0,
        totalPlayers: participated ? 4 : 0,
        eliminatedAt: eliminated ? 1_500 + teamIndex : null,
        metadata: {
          slot: teamIndex,
          teamName: `Team ${teamIndex}`,
          canonicalSeed: true,
          wasPresentInMatch: participated ? true : null,
          observedInTelemetry: participated ? true : null,
        },
      };

      if (!participated) {
        continue;
      }

      for (let playerIndex = 1; playerIndex <= 4; playerIndex += 1) {
        const playerId = `${teamId}-player-${playerIndex}`;
        players[playerId] = {
          playerId,
          teamId,
          alive: !eliminated,
          knocked: false,
          kills: 0,
          assists: 0,
          metadata: {
            playerName: `Player ${teamIndex}-${playerIndex}`,
            observedInTelemetry: true,
          },
        };
      }
    }

    const state = {
      matchId: 'match-17-of-20',
      status: 'LIVE',
      mode: 'AUTO',
      version: 1,
      sequence: 10,
      updatedAt: 2_000,
      telemetryAcceptedAt: 2_000,
      telemetryAcceptedSource: 'API',
      startedAt: 1_000,
      endedAt: null,
      teamsAlive: 14,
      circle: { phase: 2 },
      killFeed: [],
      events: [],
      players,
      teams,
    };

    (service as any).recomputeDerivedState(state, 2_000);

    expect(state.teamsAlive).toBe(14);
    expect(state.teams['team-1']).toMatchObject({
      placement: 17,
      eliminated: true,
    });
    expect(state.teams['team-2']).toMatchObject({
      placement: 16,
      eliminated: true,
    });
    expect(state.teams['team-3']).toMatchObject({
      placement: 15,
      eliminated: true,
    });
    expect(state.teams['team-18']).toMatchObject({
      placement: null,
      eliminated: false,
      alivePlayers: 0,
      totalPlayers: 0,
    });
  });
});
