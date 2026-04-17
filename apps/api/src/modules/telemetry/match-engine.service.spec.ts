import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../db/prisma.service';
import { MatchStateService } from '../observer/match-state.service';
import { ResultsService } from '../results/results.service';
import { MatchEngineService } from './match-engine.service';
import { FightDetectionEngine } from './fight-detection.engine';

describe.skip('MatchEngineService legacy authority suite (disabled)', () => {
  let consoleLogSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleLogSpy = jest
      .spyOn(console, 'log')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  it('projects telemetry into slot and player results', async () => {
    const tx = {
      match: {
        update: jest.fn().mockResolvedValue(undefined),
      },
      matchControlState: {
        findUnique: jest.fn().mockResolvedValue({ metaJson: null }),
        upsert: jest.fn().mockResolvedValue(undefined),
      },
      matchSlotPlayerResult: {
        upsert: jest.fn().mockResolvedValue(undefined),
        deleteMany: jest.fn().mockResolvedValue(undefined),
      },
      matchSlotResult: {
        update: jest.fn().mockResolvedValue(undefined),
      },
    };

    const prisma = {
      match: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'match-1',
          organizationId: 'org-1',
          status: 'LIVE',
          liveState: 'LIVE',
          endedAt: null,
        }),
      },
      matchSlotResult: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'slot-result-1',
            matchId: 'match-1',
            organizationId: 'org-1',
            slotNumber: 1,
            teamId: 'team-1',
            placement: null,
            eliminatedAt: null,
            totalKills: 0,
            manualTotalKills: false,
            isLocked: false,
            players: [],
            team: {
              id: 'team-1',
              name: 'Alpha 7',
              tag: 'A7',
              logoUrl: 'https://cdn.example.com/a7.png',
              accentLight: '#31D7FF',
              accentDark: '#0A5C7A',
            },
          },
          {
            id: 'slot-result-2',
            matchId: 'match-1',
            organizationId: 'org-1',
            slotNumber: 2,
            teamId: 'team-2',
            placement: null,
            eliminatedAt: null,
            totalKills: 0,
            manualTotalKills: false,
            isLocked: false,
            players: [],
            team: {
              id: 'team-2',
              name: 'Arenzyra Wolves',
              tag: 'VX',
              logoUrl: 'https://cdn.example.com/vx.png',
              accentLight: '#F97316',
              accentDark: '#7C2D12',
            },
          },
        ]),
      },
      matchSlot: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      $transaction: jest
        .fn()
        .mockImplementation(async (callback) => callback(tx)),
    } as unknown as PrismaService;

    const results = {
      ensureResultsFromSlots: jest.fn().mockResolvedValue(undefined),
      recomputeAllSlots: jest.fn().mockResolvedValue(undefined),
      syncMatchPlayers: jest.fn().mockResolvedValue(undefined),
    } as unknown as ResultsService;

    const matchState = {
      createEmptyState: jest.fn(),
      update: jest.fn().mockImplementation((_, state) => state),
      emitMatchUpdate: jest.fn(),
      emitObserverStateUpdate: jest.fn(),
      emitObserverKillFeedUpdate: jest.fn(),
      emitMatchWinner: jest.fn(),
    } as unknown as MatchStateService;
    const fightDetection = {
      processTelemetryPacket: jest.fn().mockReturnValue([]),
    } as unknown as FightDetectionEngine;

    const service = new MatchEngineService(
      prisma,
      results,
      matchState,
      fightDetection,
    );
    const receivedAt = '2026-03-09T10:00:00.000Z';

    const result = await service.processTelemetryPacket({
      matchId: 'match-1',
      receivedAt,
      observer: {
        gameTime: 180,
      },
      players: [
        {
          uid: 'u-1',
          playerName: 'Alpha',
          teamId: 1,
          liveState: 0,
          health: 100,
          bHasDied: false,
          killNum: 2,
        },
        {
          uid: 'u-2',
          playerName: 'Bravo',
          teamId: 2,
          liveState: 5,
          health: 0,
          bHasDied: true,
          killNum: 1,
        },
      ],
      kills: [
        { killerName: 'Alpha', killerTeamId: 1 },
        { killerName: 'Alpha', killerTeamId: 1 },
        { killerName: 'Bravo', killerTeamId: 2 },
      ],
      teams: [
        { teamId: 1, teamNo: 1 },
        { teamId: 2, teamNo: 2 },
      ],
    });

    expect(results.ensureResultsFromSlots).toHaveBeenCalledWith('match-1');
    expect(tx.matchSlotPlayerResult.upsert).toHaveBeenCalledWith({
      where: {
        slotResultId_playerName: {
          slotResultId: 'slot-result-1',
          playerName: 'Alpha',
        },
      },
      update: {
        kills: 2,
        isAlive: true,
        alive: true,
        isKnocked: false,
        isAutoFilled: true,
      },
      create: {
        slotResultId: 'slot-result-1',
        organizationId: 'org-1',
        playerName: 'Alpha',
        kills: 2,
        isAlive: true,
        alive: true,
        isKnocked: false,
        isAutoFilled: true,
      },
    });
    expect(tx.matchSlotPlayerResult.upsert).toHaveBeenCalledWith({
      where: {
        slotResultId_playerName: {
          slotResultId: 'slot-result-2',
          playerName: 'Bravo',
        },
      },
      update: {
        kills: 1,
        isAlive: false,
        alive: false,
        isKnocked: false,
        isAutoFilled: true,
      },
      create: {
        slotResultId: 'slot-result-2',
        organizationId: 'org-1',
        playerName: 'Bravo',
        kills: 1,
        isAlive: false,
        alive: false,
        isKnocked: false,
        isAutoFilled: true,
      },
    });
    expect(tx.matchSlotResult.update).toHaveBeenCalledWith({
      where: { id: 'slot-result-1' },
      data: {
        placement: 1,
        totalKills: 2,
        manualTotalKills: false,
        eliminatedAt: null,
        isLocked: false,
      },
    });
    expect(tx.matchSlotResult.update).toHaveBeenCalledWith({
      where: { id: 'slot-result-2' },
      data: {
        placement: 2,
        totalKills: 1,
        manualTotalKills: false,
        eliminatedAt: new Date(receivedAt),
        isLocked: true,
      },
    });
    expect(tx.match.update).not.toHaveBeenCalled();
    expect(tx.matchControlState.upsert).not.toHaveBeenCalled();
    expect(results.recomputeAllSlots).toHaveBeenCalledWith('match-1');
    expect(results.syncMatchPlayers).toHaveBeenCalledWith('match-1');
    expect(matchState.update).toHaveBeenCalledWith(
      'match-1',
      expect.objectContaining({
        matchId: 'match-1',
        teamsAlive: 1,
        leaderboard: [
          expect.objectContaining({
            teamId: 'team-1',
            teamName: 'Alpha 7',
            kills: 2,
          }),
          expect.objectContaining({
            teamId: 'team-2',
            teamName: 'Arenzyra Wolves',
            placement: 2,
          }),
        ],
      }),
    );
    expect(matchState.emitMatchUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        matchId: 'match-1',
        teamsAlive: 1,
      }),
    );
    expect(matchState.emitObserverStateUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        matchId: 'match-1',
        teamsAlive: 1,
      }),
    );
    expect(matchState.emitObserverKillFeedUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        matchId: 'match-1',
        killFeed: expect.arrayContaining([
          expect.objectContaining({
            id: expect.any(String),
            killerName: 'Alpha',
          }),
        ]),
      }),
    );
    expect(fightDetection.processTelemetryPacket).toHaveBeenCalledWith({
      matchId: 'match-1',
      updatedAt: receivedAt,
      kills: [
        { killerName: 'Alpha', killerTeamId: 1 },
        { killerName: 'Alpha', killerTeamId: 1 },
        { killerName: 'Bravo', killerTeamId: 2 },
      ],
      teams: [
        {
          teamId: 'team-1',
          teamName: 'Alpha 7',
          teamTag: 'A7',
          logoUrl: 'https://cdn.example.com/a7.png',
          slot: 1,
        },
        {
          teamId: 'team-2',
          teamName: 'Arenzyra Wolves',
          teamTag: 'VX',
          logoUrl: 'https://cdn.example.com/vx.png',
          slot: 2,
        },
      ],
    });
    expect(matchState.emitMatchWinner).not.toHaveBeenCalled();
    expect(result).toEqual({
      matchId: 'match-1',
      updatedTeamCount: 2,
      updatedPlayerCount: 2,
      eliminatedTeamIds: ['team-2'],
      winnerTeamId: 'team-1',
    });
  });

  it('preserves manual-owned player fields while allowing telemetry on unowned teams', async () => {
    const tx = {
      match: {
        update: jest.fn().mockResolvedValue(undefined),
      },
      matchControlState: {
        findUnique: jest.fn().mockResolvedValue({ metaJson: null }),
        upsert: jest.fn().mockResolvedValue(undefined),
      },
      matchSlotPlayerResult: {
        upsert: jest.fn().mockResolvedValue(undefined),
        deleteMany: jest.fn().mockResolvedValue(undefined),
      },
      matchSlotResult: {
        update: jest.fn().mockResolvedValue(undefined),
      },
    };

    const prisma = {
      match: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'match-1',
          organizationId: 'org-1',
          status: 'LIVE',
          liveState: 'LIVE',
          endedAt: null,
          controlState: {
            state: 'LIVE',
            resultsManualLock: false,
            resultsForceUnlock: false,
            metaJson: {
              liveSync: {
                version: 4,
                updatedAt: 1710000000000,
                overrides: {
                  players: {
                    'slot-player:player-result-a1': {
                      alive: {
                        owner: 'MANUAL',
                        override: true,
                        updatedAt: 1710000000000,
                      },
                      kills: {
                        owner: 'MANUAL',
                        override: true,
                        updatedAt: 1710000000000,
                      },
                    },
                    'slot-player:player-result-a2': {
                      knocked: {
                        owner: 'MANUAL',
                        override: true,
                        updatedAt: 1710000000000,
                      },
                      kills: {
                        owner: 'MANUAL',
                        override: true,
                        updatedAt: 1710000000000,
                      },
                    },
                  },
                  teams: {
                    'team-1': {
                      totalKills: {
                        owner: 'MANUAL',
                        override: true,
                        updatedAt: 1710000000000,
                      },
                    },
                  },
                },
              },
            },
          },
        }),
      },
      matchSlotResult: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'slot-result-1',
            matchId: 'match-1',
            organizationId: 'org-1',
            slotNumber: 1,
            teamId: 'team-1',
            placement: null,
            eliminatedAt: null,
            totalKills: 4,
            manualTotalKills: false,
            isLocked: false,
            players: [
              {
                id: 'player-result-a1',
                slotResultId: 'slot-result-1',
                organizationId: 'org-1',
                playerId: null,
                playerName: 'Alpha One',
                kills: 3,
                knocks: 0,
                isKnocked: false,
                isAlive: true,
                alive: true,
                isAutoFilled: false,
                player: { photoUrl: null },
              },
              {
                id: 'player-result-a2',
                slotResultId: 'slot-result-1',
                organizationId: 'org-1',
                playerId: null,
                playerName: 'Alpha Two',
                kills: 1,
                knocks: 0,
                isKnocked: true,
                isAlive: true,
                alive: true,
                isAutoFilled: false,
                player: { photoUrl: null },
              },
            ],
            team: {
              id: 'team-1',
              name: 'Alpha 7',
              tag: 'A7',
              logoUrl: 'https://cdn.example.com/a7.png',
              accentLight: '#31D7FF',
              accentDark: '#0A5C7A',
            },
          },
          {
            id: 'slot-result-2',
            matchId: 'match-1',
            organizationId: 'org-1',
            slotNumber: 2,
            teamId: 'team-2',
            placement: null,
            eliminatedAt: null,
            totalKills: 0,
            manualTotalKills: false,
            isLocked: false,
            players: [
              {
                id: 'player-result-b1',
                slotResultId: 'slot-result-2',
                organizationId: 'org-1',
                playerId: null,
                playerName: 'Bravo One',
                kills: 0,
                knocks: 0,
                isKnocked: false,
                isAlive: true,
                alive: true,
                isAutoFilled: false,
                player: { photoUrl: null },
              },
              {
                id: 'player-result-b2',
                slotResultId: 'slot-result-2',
                organizationId: 'org-1',
                playerId: null,
                playerName: 'Bravo Two',
                kills: 0,
                knocks: 0,
                isKnocked: false,
                isAlive: true,
                alive: true,
                isAutoFilled: false,
                player: { photoUrl: null },
              },
            ],
            team: {
              id: 'team-2',
              name: 'Arenzyra Wolves',
              tag: 'VX',
              logoUrl: 'https://cdn.example.com/vx.png',
              accentLight: '#F97316',
              accentDark: '#7C2D12',
            },
          },
        ]),
      },
      matchSlot: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      $transaction: jest
        .fn()
        .mockImplementation(async (callback) => callback(tx)),
    } as unknown as PrismaService;

    const results = {
      ensureResultsFromSlots: jest.fn().mockResolvedValue(undefined),
      recomputeAllSlots: jest.fn().mockResolvedValue(undefined),
      syncMatchPlayers: jest.fn().mockResolvedValue(undefined),
    } as unknown as ResultsService;

    const matchState = {
      createEmptyState: jest.fn(),
      update: jest.fn().mockImplementation((_, state) => state),
      emitMatchUpdate: jest.fn(),
      emitObserverStateUpdate: jest.fn(),
      emitObserverKillFeedUpdate: jest.fn(),
      emitMatchWinner: jest.fn(),
    } as unknown as MatchStateService;

    const service = new MatchEngineService(prisma, results, matchState);

    await service.processTelemetryPacket({
      matchId: 'match-1',
      receivedAt: '2026-03-19T18:00:00.000Z',
      observer: {
        gameTime: 240,
      },
      players: [
        {
          uid: 'telemetry-a1',
          playerName: 'Alpha One',
          teamId: 1,
          liveState: 1,
          health: 0,
          bHasDied: true,
          killNum: 0,
        },
        {
          uid: 'telemetry-a2',
          playerName: 'Alpha Two',
          teamId: 1,
          liveState: 0,
          health: 100,
          bHasDied: false,
          killNum: 0,
        },
        {
          uid: 'telemetry-b1',
          playerName: 'Bravo One',
          teamId: 2,
          liveState: 0,
          health: 100,
          bHasDied: false,
          killNum: 2,
        },
        {
          uid: 'telemetry-b2',
          playerName: 'Bravo Two',
          teamId: 2,
          liveState: 0,
          health: 100,
          bHasDied: false,
          killNum: 1,
        },
      ],
      kills: [],
      teams: [
        { teamId: 1, teamNo: 1, teamTag: 'A7' },
        { teamId: 2, teamNo: 2, teamTag: 'VX' },
      ],
    });

    expect(tx.matchSlotPlayerResult.upsert).toHaveBeenCalledWith({
      where: {
        slotResultId_playerName: {
          slotResultId: 'slot-result-1',
          playerName: 'Alpha One',
        },
      },
      update: {
        kills: 3,
        isAlive: true,
        alive: true,
        isKnocked: false,
        isAutoFilled: true,
      },
      create: {
        slotResultId: 'slot-result-1',
        organizationId: 'org-1',
        playerName: 'Alpha One',
        kills: 3,
        isAlive: true,
        alive: true,
        isKnocked: false,
        isAutoFilled: true,
      },
    });
    expect(tx.matchSlotPlayerResult.upsert).toHaveBeenCalledWith({
      where: {
        slotResultId_playerName: {
          slotResultId: 'slot-result-1',
          playerName: 'Alpha Two',
        },
      },
      update: {
        kills: 1,
        isAlive: true,
        alive: true,
        isKnocked: true,
        isAutoFilled: true,
      },
      create: {
        slotResultId: 'slot-result-1',
        organizationId: 'org-1',
        playerName: 'Alpha Two',
        kills: 1,
        isAlive: true,
        alive: true,
        isKnocked: true,
        isAutoFilled: true,
      },
    });
    expect(tx.matchSlotResult.update).toHaveBeenCalledWith({
      where: { id: 'slot-result-1' },
      data: {
        placement: null,
        totalKills: 4,
        manualTotalKills: false,
        eliminatedAt: null,
        isLocked: false,
      },
    });
    expect(tx.matchSlotResult.update).toHaveBeenCalledWith({
      where: { id: 'slot-result-2' },
      data: {
        placement: null,
        totalKills: 3,
        manualTotalKills: false,
        eliminatedAt: null,
        isLocked: false,
      },
    });
    expect(matchState.update).toHaveBeenCalledWith(
      'match-1',
      expect.objectContaining({
        leaderboard: expect.arrayContaining([
          expect.objectContaining({
            teamId: 'team-1',
            kills: 4,
            players: expect.arrayContaining([
              expect.objectContaining({
                playerName: 'Alpha One',
                kills: 3,
                alive: true,
                knocked: false,
              }),
              expect.objectContaining({
                playerName: 'Alpha Two',
                kills: 1,
                alive: true,
                knocked: true,
              }),
            ]),
          }),
          expect.objectContaining({
            teamId: 'team-2',
            kills: 3,
          }),
        ]),
      }),
    );
  });

  it('lets telemetry resume once manual ownership is released', async () => {
    const tx = {
      match: {
        update: jest.fn().mockResolvedValue(undefined),
      },
      matchControlState: {
        findUnique: jest.fn().mockResolvedValue({ metaJson: null }),
        upsert: jest.fn().mockResolvedValue(undefined),
      },
      matchSlotPlayerResult: {
        upsert: jest.fn().mockResolvedValue(undefined),
        deleteMany: jest.fn().mockResolvedValue(undefined),
      },
      matchSlotResult: {
        update: jest.fn().mockResolvedValue(undefined),
      },
    };

    const prisma = {
      match: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'match-1',
          organizationId: 'org-1',
          status: 'LIVE',
          liveState: 'LIVE',
          endedAt: null,
          controlState: {
            state: 'LIVE',
            resultsManualLock: false,
            resultsForceUnlock: false,
            metaJson: {
              liveSync: {
                version: 5,
                updatedAt: 1710000001000,
                overrides: {
                  players: {},
                  teams: {},
                },
              },
            },
          },
        }),
      },
      matchSlotResult: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'slot-result-1',
            matchId: 'match-1',
            organizationId: 'org-1',
            slotNumber: 1,
            teamId: 'team-1',
            placement: null,
            eliminatedAt: null,
            totalKills: 4,
            manualTotalKills: false,
            isLocked: false,
            players: [
              {
                id: 'player-result-a1',
                slotResultId: 'slot-result-1',
                organizationId: 'org-1',
                playerId: null,
                playerName: 'Alpha One',
                kills: 3,
                knocks: 0,
                isKnocked: false,
                isAlive: true,
                alive: true,
                isAutoFilled: false,
                player: { photoUrl: null },
              },
            ],
            team: {
              id: 'team-1',
              name: 'Alpha 7',
              tag: 'A7',
              logoUrl: 'https://cdn.example.com/a7.png',
              accentLight: '#31D7FF',
              accentDark: '#0A5C7A',
            },
          },
        ]),
      },
      matchSlot: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      $transaction: jest
        .fn()
        .mockImplementation(async (callback) => callback(tx)),
    } as unknown as PrismaService;

    const results = {
      ensureResultsFromSlots: jest.fn().mockResolvedValue(undefined),
      recomputeAllSlots: jest.fn().mockResolvedValue(undefined),
      syncMatchPlayers: jest.fn().mockResolvedValue(undefined),
    } as unknown as ResultsService;

    const matchState = {
      createEmptyState: jest.fn(),
      update: jest.fn().mockImplementation((_, state) => state),
      emitMatchUpdate: jest.fn(),
      emitObserverStateUpdate: jest.fn(),
      emitObserverKillFeedUpdate: jest.fn(),
      emitMatchWinner: jest.fn(),
    } as unknown as MatchStateService;

    const service = new MatchEngineService(prisma, results, matchState);

    await service.processTelemetryPacket({
      matchId: 'match-1',
      receivedAt: '2026-03-19T18:05:00.000Z',
      observer: {
        gameTime: 300,
      },
      players: [
        {
          uid: 'telemetry-a1',
          playerName: 'Alpha One',
          teamId: 1,
          liveState: 1,
          health: 0,
          bHasDied: true,
          killNum: 0,
        },
      ],
      kills: [],
      teams: [{ teamId: 1, teamNo: 1, teamTag: 'A7' }],
    });

    expect(tx.matchSlotPlayerResult.upsert).toHaveBeenCalledWith({
      where: {
        slotResultId_playerName: {
          slotResultId: 'slot-result-1',
          playerName: 'Alpha One',
        },
      },
      update: {
        kills: 0,
        isAlive: false,
        alive: false,
        isKnocked: false,
        isAutoFilled: true,
      },
      create: {
        slotResultId: 'slot-result-1',
        organizationId: 'org-1',
        playerName: 'Alpha One',
        kills: 0,
        isAlive: false,
        alive: false,
        isKnocked: false,
        isAutoFilled: true,
      },
    });
    expect(tx.matchSlotResult.update).toHaveBeenCalledWith({
      where: { id: 'slot-result-1' },
      data: {
        placement: 1,
        totalKills: 4,
        manualTotalKills: false,
        eliminatedAt: new Date('2026-03-19T18:05:00.000Z'),
        isLocked: true,
      },
    });
  });

  it('derives nextShrinkAt from Counter and MaxTime circle telemetry', async () => {
    const tx = {
      match: {
        update: jest.fn().mockResolvedValue(undefined),
      },
      matchControlState: {
        findUnique: jest.fn().mockResolvedValue({ metaJson: null }),
        upsert: jest.fn().mockResolvedValue(undefined),
      },
      matchSlotPlayerResult: {
        upsert: jest.fn().mockResolvedValue(undefined),
        deleteMany: jest.fn().mockResolvedValue(undefined),
      },
      matchSlotResult: {
        update: jest.fn().mockResolvedValue(undefined),
      },
    };

    const prisma = {
      match: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'match-1',
          organizationId: 'org-1',
          status: 'LIVE',
          liveState: 'LIVE',
          endedAt: null,
        }),
      },
      matchSlotResult: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'slot-result-1',
            matchId: 'match-1',
            organizationId: 'org-1',
            slotNumber: 1,
            teamId: 'team-1',
            placement: null,
            eliminatedAt: null,
            totalKills: 0,
            manualTotalKills: false,
            isLocked: false,
            players: [],
            team: {
              id: 'team-1',
              name: 'Alpha 7',
              tag: 'A7',
              logoUrl: 'https://cdn.example.com/a7.png',
              accentLight: '#31D7FF',
              accentDark: '#0A5C7A',
            },
          },
        ]),
      },
      matchSlot: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      $transaction: jest
        .fn()
        .mockImplementation(async (callback) => callback(tx)),
    } as unknown as PrismaService;

    const results = {
      ensureResultsFromSlots: jest.fn().mockResolvedValue(undefined),
      recomputeAllSlots: jest.fn().mockResolvedValue(undefined),
      syncMatchPlayers: jest.fn().mockResolvedValue(undefined),
    } as unknown as ResultsService;

    const matchState = {
      createEmptyState: jest.fn(),
      update: jest.fn().mockImplementation((_, state) => state),
      emitMatchUpdate: jest.fn(),
      emitObserverStateUpdate: jest.fn(),
      emitObserverKillFeedUpdate: jest.fn(),
      emitMatchWinner: jest.fn(),
    } as unknown as MatchStateService;
    const fightDetection = {
      processTelemetryPacket: jest.fn().mockReturnValue([]),
    } as unknown as FightDetectionEngine;

    const service = new MatchEngineService(
      prisma,
      results,
      matchState,
      fightDetection,
    );

    await service.processTelemetryPacket({
      matchId: 'match-1',
      receivedAt: '2026-03-09T10:00:00.000Z',
      players: [
        {
          uid: 'u-1',
          playerName: 'Alpha',
          teamId: 1,
          liveState: 0,
          health: 100,
          bHasDied: false,
          killNum: 0,
        },
      ],
      kills: [],
      teams: [{ teamId: 1, teamNo: 1 }],
      circle: {
        CircleIndex: '4',
        Counter: '12',
        MaxTime: '60',
      },
    });

    expect(matchState.update).toHaveBeenCalledWith(
      'match-1',
      expect.objectContaining({
        circle: {
          phase: 4,
          nextShrinkAt: '2026-03-09T10:00:48.000Z',
          safeZone: null,
          nextZone: null,
        },
      }),
    );
  });

  it('treats liveState 4 players as knocked and keeps them in leaderboard player state', async () => {
    const tx = {
      match: {
        update: jest.fn().mockResolvedValue(undefined),
      },
      matchControlState: {
        findUnique: jest.fn().mockResolvedValue({ metaJson: null }),
        upsert: jest.fn().mockResolvedValue(undefined),
      },
      matchSlotPlayerResult: {
        upsert: jest.fn().mockResolvedValue(undefined),
        deleteMany: jest.fn().mockResolvedValue(undefined),
      },
      matchSlotResult: {
        update: jest.fn().mockResolvedValue(undefined),
      },
    };

    const prisma = {
      match: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'match-1',
          organizationId: 'org-1',
          status: 'LIVE',
          liveState: 'LIVE',
          endedAt: null,
        }),
      },
      matchSlotResult: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'slot-result-1',
            matchId: 'match-1',
            organizationId: 'org-1',
            slotNumber: 1,
            teamId: 'team-1',
            placement: null,
            eliminatedAt: null,
            totalKills: 0,
            manualTotalKills: false,
            isLocked: false,
            players: [],
            team: {
              id: 'team-1',
              name: 'Alpha 7',
              tag: 'A7',
              logoUrl: 'https://cdn.example.com/a7.png',
              accentLight: '#31D7FF',
              accentDark: '#0A5C7A',
            },
          },
          {
            id: 'slot-result-2',
            matchId: 'match-1',
            organizationId: 'org-1',
            slotNumber: 2,
            teamId: 'team-2',
            placement: null,
            eliminatedAt: null,
            totalKills: 0,
            manualTotalKills: false,
            isLocked: false,
            players: [],
            team: {
              id: 'team-2',
              name: 'Arenzyra Wolves',
              tag: 'VX',
              logoUrl: 'https://cdn.example.com/vx.png',
              accentLight: '#F97316',
              accentDark: '#7C2D12',
            },
          },
        ]),
      },
      matchSlot: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      $transaction: jest
        .fn()
        .mockImplementation(async (callback) => callback(tx)),
    } as unknown as PrismaService;

    const results = {
      ensureResultsFromSlots: jest.fn().mockResolvedValue(undefined),
      recomputeAllSlots: jest.fn().mockResolvedValue(undefined),
      syncMatchPlayers: jest.fn().mockResolvedValue(undefined),
    } as unknown as ResultsService;

    const matchState = {
      createEmptyState: jest.fn(),
      update: jest.fn().mockImplementation((_, state) => state),
      emitMatchUpdate: jest.fn(),
      emitObserverStateUpdate: jest.fn(),
      emitObserverKillFeedUpdate: jest.fn(),
      emitMatchWinner: jest.fn(),
    } as unknown as MatchStateService;
    const fightDetection = {
      processTelemetryPacket: jest.fn().mockReturnValue([]),
    } as unknown as FightDetectionEngine;

    const service = new MatchEngineService(
      prisma,
      results,
      matchState,
      fightDetection,
    );

    await service.processTelemetryPacket({
      matchId: 'match-1',
      receivedAt: '2026-03-12T10:00:00.000Z',
      observer: {
        gameTime: 90,
      },
      players: [
        {
          uid: 'u-1',
          playerName: 'Alpha',
          teamId: 1,
          liveState: 4,
          health: 68,
          bHasDied: false,
          killNum: 0,
        },
        {
          uid: 'u-2',
          playerName: 'Bravo',
          teamId: 2,
          liveState: 0,
          health: 100,
          bHasDied: false,
          killNum: 0,
        },
      ],
      kills: [],
      teams: [
        { teamId: 1, teamNo: 1 },
        { teamId: 2, teamNo: 2 },
      ],
    });

    expect(tx.matchSlotPlayerResult.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          isKnocked: true,
          isAlive: true,
        }),
        create: expect.objectContaining({
          playerName: 'Alpha',
          isKnocked: true,
          isAlive: true,
        }),
      }),
    );
    expect(matchState.update).toHaveBeenCalledWith(
      'match-1',
      expect.objectContaining({
        leaderboard: expect.arrayContaining([
          expect.objectContaining({
            teamId: 'team-1',
            players: expect.arrayContaining([
              expect.objectContaining({
                playerName: 'Alpha',
                alive: true,
                knocked: true,
                health: 68,
              }),
            ]),
          }),
        ]),
      }),
    );
  });

  it('finalizes the match when telemetry explicitly marks the phase as finished', async () => {
    const tx = {
      match: {
        update: jest.fn().mockResolvedValue(undefined),
      },
      matchControlState: {
        findUnique: jest.fn().mockResolvedValue({ metaJson: null }),
        upsert: jest.fn().mockResolvedValue(undefined),
      },
      matchSlotPlayerResult: {
        upsert: jest.fn().mockResolvedValue(undefined),
        deleteMany: jest.fn().mockResolvedValue(undefined),
      },
      matchSlotResult: {
        update: jest.fn().mockResolvedValue(undefined),
      },
    };

    const prisma = {
      match: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'match-1',
          organizationId: 'org-1',
          status: 'LIVE',
          liveState: 'LIVE',
          endedAt: null,
        }),
      },
      matchSlotResult: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'slot-result-1',
            matchId: 'match-1',
            organizationId: 'org-1',
            slotNumber: 1,
            teamId: 'team-1',
            placement: null,
            eliminatedAt: null,
            totalKills: 0,
            manualTotalKills: false,
            isLocked: false,
            players: [],
            team: {
              id: 'team-1',
              name: 'Alpha 7',
              tag: 'A7',
              logoUrl: 'https://cdn.example.com/a7.png',
              accentLight: '#31D7FF',
              accentDark: '#0A5C7A',
            },
          },
          {
            id: 'slot-result-2',
            matchId: 'match-1',
            organizationId: 'org-1',
            slotNumber: 2,
            teamId: 'team-2',
            placement: null,
            eliminatedAt: null,
            totalKills: 0,
            manualTotalKills: false,
            isLocked: false,
            players: [],
            team: {
              id: 'team-2',
              name: 'Arenzyra Wolves',
              tag: 'VX',
              logoUrl: 'https://cdn.example.com/vx.png',
              accentLight: '#F97316',
              accentDark: '#7C2D12',
            },
          },
        ]),
      },
      matchSlot: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      $transaction: jest
        .fn()
        .mockImplementation(async (callback) => callback(tx)),
    } as unknown as PrismaService;

    const results = {
      ensureResultsFromSlots: jest.fn().mockResolvedValue(undefined),
      recomputeAllSlots: jest.fn().mockResolvedValue(undefined),
      syncMatchPlayers: jest.fn().mockResolvedValue(undefined),
    } as unknown as ResultsService;

    const matchState = {
      createEmptyState: jest.fn(),
      update: jest.fn().mockImplementation((_, state) => state),
      emitMatchUpdate: jest.fn(),
      emitObserverStateUpdate: jest.fn(),
      emitObserverKillFeedUpdate: jest.fn(),
      emitMatchWinner: jest.fn(),
    } as unknown as MatchStateService;

    const service = new MatchEngineService(prisma, results, matchState);
    const receivedAt = '2026-03-15T22:36:43.000Z';

    const result = await service.processTelemetryPacket({
      matchId: 'match-1',
      receivedAt,
      phase: 'finished',
      observer: {
        gameTime: 15,
      },
      players: [
        {
          uid: 'u-1',
          playerName: 'Alpha',
          teamId: 1,
          liveState: 4,
          health: 100,
          bHasDied: false,
          killNum: 4,
        },
        {
          uid: 'u-2',
          playerName: 'Bravo',
          teamId: 2,
          liveState: 1,
          health: 0,
          bHasDied: true,
          killNum: 1,
        },
      ],
      kills: [
        { killerName: 'Alpha', killerTeamId: 1 },
        { killerName: 'Alpha', killerTeamId: 1 },
        { killerName: 'Alpha', killerTeamId: 1 },
        { killerName: 'Alpha', killerTeamId: 1 },
        { killerName: 'Bravo', killerTeamId: 2 },
      ],
      teams: [
        { teamId: 1, teamNo: 1 },
        { teamId: 2, teamNo: 2 },
      ],
    });

    expect(tx.match.update).not.toHaveBeenCalled();
    expect(tx.matchControlState.upsert).not.toHaveBeenCalled();
    expect(result.winnerTeamId).toBe('team-1');
  });

  it('finalizes the match when launcher telemetry reports one alive team without phase or game time', async () => {
    const tx = {
      match: {
        update: jest.fn().mockResolvedValue(undefined),
      },
      matchControlState: {
        findUnique: jest.fn().mockResolvedValue({ metaJson: null }),
        upsert: jest.fn().mockResolvedValue(undefined),
      },
      matchSlotPlayerResult: {
        upsert: jest.fn().mockResolvedValue(undefined),
        updateMany: jest.fn().mockResolvedValue(undefined),
        deleteMany: jest.fn().mockResolvedValue(undefined),
      },
      matchSlotResult: {
        update: jest.fn().mockResolvedValue(undefined),
      },
    };

    const prisma = {
      match: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'match-1',
          organizationId: 'org-1',
          status: 'LIVE',
          liveState: 'LIVE',
          endedAt: null,
        }),
      },
      matchSlotResult: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'slot-result-1',
            matchId: 'match-1',
            organizationId: 'org-1',
            slotNumber: 1,
            teamId: 'team-1',
            placement: null,
            eliminatedAt: null,
            totalKills: 0,
            manualTotalKills: false,
            isLocked: false,
            players: [],
            team: {
              id: 'team-1',
              name: 'Alpha 7',
              tag: 'A7',
              logoUrl: 'https://cdn.example.com/a7.png',
              accentLight: '#31D7FF',
              accentDark: '#0A5C7A',
            },
          },
          {
            id: 'slot-result-2',
            matchId: 'match-1',
            organizationId: 'org-1',
            slotNumber: 2,
            teamId: 'team-2',
            placement: null,
            eliminatedAt: null,
            totalKills: 0,
            manualTotalKills: false,
            isLocked: false,
            players: [
              {
                id: 'slot-player-2',
                slotResultId: 'slot-result-2',
                organizationId: 'org-1',
                playerId: 'ghost-1',
                playerName: 'Ghost',
                kills: 0,
                isAlive: true,
                alive: true,
                isKnocked: false,
                isAutoFilled: true,
              },
            ],
            team: {
              id: 'team-2',
              name: 'Arenzyra Wolves',
              tag: 'VX',
              logoUrl: 'https://cdn.example.com/vx.png',
              accentLight: '#F97316',
              accentDark: '#7C2D12',
            },
          },
        ]),
      },
      matchSlot: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      $transaction: jest
        .fn()
        .mockImplementation(async (callback) => callback(tx)),
    } as unknown as PrismaService;

    const results = {
      ensureResultsFromSlots: jest.fn().mockResolvedValue(undefined),
      recomputeAllSlots: jest.fn().mockResolvedValue(undefined),
      syncMatchPlayers: jest.fn().mockResolvedValue(undefined),
    } as unknown as ResultsService;

    const matchState = {
      createEmptyState: jest.fn(),
      update: jest.fn().mockImplementation((_, state) => state),
      emitMatchUpdate: jest.fn(),
      emitObserverStateUpdate: jest.fn(),
      emitObserverKillFeedUpdate: jest.fn(),
      emitMatchWinner: jest.fn(),
    } as unknown as MatchStateService;

    const service = new MatchEngineService(prisma, results, matchState);
    const receivedAt = '2026-03-16T00:25:50.000Z';

    const result = await service.processTelemetryPacket({
      matchId: 'match-1',
      receivedAt,
      aliveTeams: 1,
      players: [
        {
          uid: 'u-1',
          playerName: 'Alpha',
          teamId: 1,
          liveState: 4,
          health: 100,
          bHasDied: false,
          killNum: 4,
        },
      ],
      kills: [{ killerName: 'Alpha', killerTeamId: 1 }],
      teams: [
        { teamId: 1, teamNo: 1 },
        { teamId: 2, teamNo: 2 },
      ],
    });

    expect(tx.matchSlotPlayerResult.updateMany).toHaveBeenCalledWith({
      where: { slotResultId: 'slot-result-2' },
      data: {
        isAlive: false,
        alive: false,
        isKnocked: false,
      },
    });
    expect(tx.match.update).not.toHaveBeenCalled();
    expect(result.winnerTeamId).toBe('team-1');
  });

  it('derives slot tags for live-mapping placeholder teams', async () => {
    const tx = {
      match: {
        update: jest.fn().mockResolvedValue(undefined),
      },
      matchControlState: {
        findUnique: jest.fn().mockResolvedValue({ metaJson: null }),
        upsert: jest.fn().mockResolvedValue(undefined),
      },
      matchSlotPlayerResult: {
        upsert: jest.fn().mockResolvedValue(undefined),
        deleteMany: jest.fn().mockResolvedValue(undefined),
      },
      matchSlotResult: {
        update: jest.fn().mockResolvedValue(undefined),
      },
    };

    const prisma = {
      match: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'match-1',
          organizationId: 'org-1',
          status: 'LIVE',
          liveState: 'LIVE',
          endedAt: null,
        }),
      },
      matchSlotResult: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'slot-result-6',
            matchId: 'match-1',
            organizationId: 'org-1',
            slotNumber: 6,
            teamId: 'team-placeholder',
            placement: null,
            eliminatedAt: null,
            totalKills: 0,
            manualTotalKills: false,
            isLocked: false,
            players: [],
            team: {
              id: 'team-placeholder',
              name: '[LIVE] match-1 Slot 06',
              tag: null,
              logoUrl: null,
              accentLight: null,
              accentDark: null,
            },
          },
        ]),
      },
      matchSlot: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      $transaction: jest
        .fn()
        .mockImplementation(async (callback) => callback(tx)),
    } as unknown as PrismaService;

    const results = {
      ensureResultsFromSlots: jest.fn().mockResolvedValue(undefined),
      recomputeAllSlots: jest.fn().mockResolvedValue(undefined),
      syncMatchPlayers: jest.fn().mockResolvedValue(undefined),
    } as unknown as ResultsService;

    const matchState = {
      createEmptyState: jest.fn(),
      update: jest.fn().mockImplementation((_, state) => state),
      emitMatchUpdate: jest.fn(),
      emitObserverStateUpdate: jest.fn(),
      emitObserverKillFeedUpdate: jest.fn(),
      emitMatchWinner: jest.fn(),
    } as unknown as MatchStateService;
    const fightDetection = {
      processTelemetryPacket: jest.fn().mockReturnValue([]),
    } as unknown as FightDetectionEngine;

    const service = new MatchEngineService(
      prisma,
      results,
      matchState,
      fightDetection,
    );

    await service.processTelemetryPacket({
      matchId: 'match-1',
      receivedAt: '2026-03-11T08:00:00.000Z',
      observer: {
        gameTime: 60,
      },
      players: [
        {
          uid: 'u-6',
          playerName: 'PlaceholderPlayer',
          teamId: 6,
          liveState: 4,
          health: 100,
          bHasDied: false,
          killNum: 0,
        },
      ],
      kills: [],
      teams: [{ teamId: 6, teamNo: 6 }],
    });

    expect(matchState.update).toHaveBeenCalledWith(
      'match-1',
      expect.objectContaining({
        leaderboard: expect.arrayContaining([
          expect.objectContaining({
            slot: 6,
            teamName: '[LIVE] match-1 Slot 06',
            teamTag: 'S06',
          }),
        ]),
      }),
    );
  });

  it('rejects empty match ids', async () => {
    const prisma = {} as PrismaService;
    const results = {} as ResultsService;
    const matchState = {} as MatchStateService;
    const service = new MatchEngineService(prisma, results, matchState);

    await expect(
      service.processTelemetryPacket({
        matchId: '',
        players: [],
        kills: [],
        teams: [],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects missing matches', async () => {
    const prisma = {
      match: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
    } as unknown as PrismaService;
    const results = {} as ResultsService;
    const matchState = {} as MatchStateService;
    const service = new MatchEngineService(prisma, results, matchState);

    await expect(
      service.processTelemetryPacket({
        matchId: 'missing-match',
        players: [],
        kills: [],
        teams: [],
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('ignores unmappable packets before any slot players have been materialized', async () => {
    const tx = {
      match: {
        update: jest.fn().mockResolvedValue(undefined),
      },
      matchControlState: {
        findUnique: jest.fn().mockResolvedValue({ metaJson: null }),
        upsert: jest.fn().mockResolvedValue(undefined),
      },
      matchSlotPlayerResult: {
        upsert: jest.fn().mockResolvedValue(undefined),
        deleteMany: jest.fn().mockResolvedValue(undefined),
      },
      matchSlotResult: {
        update: jest.fn().mockResolvedValue(undefined),
      },
    };

    const prisma = {
      match: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'match-1',
          organizationId: 'org-1',
          status: 'LIVE',
          liveState: 'LIVE',
          endedAt: null,
        }),
      },
      matchSlotResult: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'slot-result-1',
            matchId: 'match-1',
            organizationId: 'org-1',
            slotNumber: 1,
            teamId: 'team-1',
            placement: null,
            eliminatedAt: null,
            totalKills: 0,
            manualTotalKills: false,
            isLocked: false,
            players: [],
            team: {
              id: 'team-1',
              name: 'Alpha 7',
              tag: 'A7',
              logoUrl: 'https://cdn.example.com/a7.png',
              accentLight: '#31D7FF',
              accentDark: '#0A5C7A',
            },
          },
        ]),
      },
      matchSlot: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      $transaction: jest
        .fn()
        .mockImplementation(async (callback) => callback(tx)),
    } as unknown as PrismaService;

    const results = {
      ensureResultsFromSlots: jest.fn().mockResolvedValue(undefined),
      recomputeAllSlots: jest.fn().mockResolvedValue(undefined),
      syncMatchPlayers: jest.fn().mockResolvedValue(undefined),
    } as unknown as ResultsService;

    const matchState = {
      createEmptyState: jest.fn(),
      update: jest.fn(),
      emitMatchUpdate: jest.fn(),
      emitObserverStateUpdate: jest.fn(),
      emitObserverKillFeedUpdate: jest.fn(),
      emitMatchWinner: jest.fn(),
    } as unknown as MatchStateService;

    const service = new MatchEngineService(prisma, results, matchState);

    const result = await service.processTelemetryPacket({
      matchId: 'match-1',
      receivedAt: '2026-03-09T10:00:00.000Z',
      players: [
        {
          uid: 'u-404',
          playerName: 'Unknown',
          teamId: 999,
          liveState: 0,
        },
      ],
      kills: [],
      teams: [{ teamId: 1, teamNo: 1 }],
    });

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(results.recomputeAllSlots).not.toHaveBeenCalled();
    expect(results.syncMatchPlayers).not.toHaveBeenCalled();
    expect(matchState.update).not.toHaveBeenCalled();
    expect(result).toEqual({
      matchId: 'match-1',
      updatedTeamCount: 1,
      updatedPlayerCount: 0,
      eliminatedTeamIds: [],
      winnerTeamId: null,
    });
  });

  it('does not wipe or eliminate teams that are missing from a partial telemetry packet', async () => {
    const tx = {
      match: {
        update: jest.fn().mockResolvedValue(undefined),
      },
      matchControlState: {
        findUnique: jest.fn().mockResolvedValue({ metaJson: null }),
        upsert: jest.fn().mockResolvedValue(undefined),
      },
      matchSlotPlayerResult: {
        upsert: jest.fn().mockResolvedValue(undefined),
        deleteMany: jest.fn().mockResolvedValue(undefined),
      },
      matchSlotResult: {
        update: jest.fn().mockResolvedValue(undefined),
      },
    };

    const prisma = {
      match: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'match-1',
          organizationId: 'org-1',
          status: 'LIVE',
          liveState: 'LIVE',
          endedAt: null,
        }),
      },
      matchSlotResult: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'slot-result-1',
            matchId: 'match-1',
            organizationId: 'org-1',
            slotNumber: 1,
            teamId: 'team-1',
            placement: null,
            eliminatedAt: null,
            totalKills: 0,
            manualTotalKills: false,
            isLocked: false,
            players: [
              {
                id: 'player-result-1',
                slotResultId: 'slot-result-1',
                organizationId: 'org-1',
                playerId: null,
                playerName: 'Alpha',
                kills: 0,
                knocks: 0,
                isKnocked: false,
                isAlive: true,
                alive: true,
                isAutoFilled: true,
              },
            ],
            team: {
              id: 'team-1',
              name: 'Alpha 7',
              tag: 'A7',
              logoUrl: 'https://cdn.example.com/a7.png',
              accentLight: '#31D7FF',
              accentDark: '#0A5C7A',
            },
          },
          {
            id: 'slot-result-2',
            matchId: 'match-1',
            organizationId: 'org-1',
            slotNumber: 2,
            teamId: 'team-2',
            placement: null,
            eliminatedAt: null,
            totalKills: 0,
            manualTotalKills: false,
            isLocked: false,
            players: [
              {
                id: 'player-result-2',
                slotResultId: 'slot-result-2',
                organizationId: 'org-1',
                playerId: null,
                playerName: 'Bravo',
                kills: 0,
                knocks: 0,
                isKnocked: true,
                isAlive: true,
                alive: true,
                isAutoFilled: true,
              },
            ],
            team: {
              id: 'team-2',
              name: 'Arenzyra Wolves',
              tag: 'VX',
              logoUrl: 'https://cdn.example.com/vx.png',
              accentLight: '#F97316',
              accentDark: '#7C2D12',
            },
          },
        ]),
      },
      matchSlot: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      $transaction: jest
        .fn()
        .mockImplementation(async (callback) => callback(tx)),
    } as unknown as PrismaService;

    const results = {
      ensureResultsFromSlots: jest.fn().mockResolvedValue(undefined),
      recomputeAllSlots: jest.fn().mockResolvedValue(undefined),
      syncMatchPlayers: jest.fn().mockResolvedValue(undefined),
    } as unknown as ResultsService;

    const matchState = {
      createEmptyState: jest.fn(),
      update: jest.fn().mockImplementation((_, state) => state),
      emitMatchUpdate: jest.fn(),
      emitObserverStateUpdate: jest.fn(),
      emitObserverKillFeedUpdate: jest.fn(),
      emitMatchWinner: jest.fn(),
    } as unknown as MatchStateService;

    const service = new MatchEngineService(prisma, results, matchState);

    const result = await service.processTelemetryPacket({
      matchId: 'match-1',
      receivedAt: '2026-03-09T10:00:00.000Z',
      players: [
        {
          uid: 'u-1',
          playerName: 'Alpha',
          teamId: 1,
          liveState: 4,
          health: 100,
          bHasDied: false,
          killNum: 1,
        },
      ],
      kills: [{ killerName: 'Alpha', killerTeamId: 1 }],
      teams: [
        { teamId: 1, teamNo: 1, teamTag: 'A7' },
        { teamId: 2, teamNo: 2, teamTag: 'VX' },
      ],
    });

    expect(tx.matchSlotPlayerResult.deleteMany).toHaveBeenCalledTimes(1);
    expect(tx.matchSlotPlayerResult.deleteMany).toHaveBeenCalledWith({
      where: {
        slotResultId: 'slot-result-1',
        playerName: { notIn: ['Alpha'] },
      },
    });
    expect(tx.matchSlotResult.update).toHaveBeenCalledWith({
      where: { id: 'slot-result-2' },
      data: {
        placement: null,
        totalKills: 0,
        manualTotalKills: false,
        eliminatedAt: null,
        isLocked: false,
      },
    });
    expect(matchState.update).toHaveBeenCalledWith(
      'match-1',
      expect.objectContaining({
        leaderboard: expect.arrayContaining([
          expect.objectContaining({
            teamId: 'team-2',
            players: expect.arrayContaining([
              expect.objectContaining({
                playerName: 'Bravo',
                knocked: false,
                lifeTelemetryFresh: false,
              }),
            ]),
          }),
        ]),
      }),
    );
    expect(matchState.emitMatchWinner).not.toHaveBeenCalled();
    expect(result).toEqual({
      matchId: 'match-1',
      updatedTeamCount: 2,
      updatedPlayerCount: 2,
      eliminatedTeamIds: [],
      winnerTeamId: null,
    });
  });

  it('does not apply scoring before gameplay telemetry is confirmed', async () => {
    const tx = {
      match: {
        update: jest.fn().mockResolvedValue(undefined),
      },
      matchControlState: {
        findUnique: jest.fn().mockResolvedValue({
          metaJson: null,
          organizationId: 'org-1',
        }),
        upsert: jest.fn().mockResolvedValue(undefined),
      },
      matchSlotPlayerResult: {
        upsert: jest.fn().mockResolvedValue(undefined),
        deleteMany: jest.fn().mockResolvedValue(undefined),
      },
      matchSlotResult: {
        update: jest.fn().mockResolvedValue(undefined),
      },
    };

    const prisma = {
      match: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'match-1',
          organizationId: 'org-1',
          status: 'LIVE',
          liveState: 'LIVE',
          endedAt: null,
        }),
      },
      matchSlotResult: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'slot-result-1',
            matchId: 'match-1',
            organizationId: 'org-1',
            slotNumber: 1,
            teamId: 'team-1',
            placement: null,
            eliminatedAt: null,
            totalKills: 3,
            manualTotalKills: false,
            isLocked: false,
            players: [],
            team: {
              id: 'team-1',
              name: 'Alpha 7',
              tag: 'A7',
              logoUrl: 'https://cdn.example.com/a7.png',
              accentLight: '#31D7FF',
              accentDark: '#0A5C7A',
            },
          },
          {
            id: 'slot-result-2',
            matchId: 'match-1',
            organizationId: 'org-1',
            slotNumber: 2,
            teamId: 'team-2',
            placement: null,
            eliminatedAt: null,
            totalKills: 4,
            manualTotalKills: false,
            isLocked: false,
            players: [],
            team: {
              id: 'team-2',
              name: 'Arenzyra Wolves',
              tag: 'VX',
              logoUrl: 'https://cdn.example.com/vx.png',
              accentLight: '#F97316',
              accentDark: '#7C2D12',
            },
          },
        ]),
      },
      matchSlot: {
        findMany: jest.fn().mockResolvedValue([
          {
            slotNumber: 1,
            lobbyStatus: 'ONLINE',
            playersInLobby: 4,
          },
          {
            slotNumber: 2,
            lobbyStatus: 'WAITING',
            playersInLobby: 0,
          },
        ]),
      },
      $transaction: jest
        .fn()
        .mockImplementation(async (callback) => callback(tx)),
    } as unknown as PrismaService;

    const results = {
      ensureResultsFromSlots: jest.fn().mockResolvedValue(undefined),
      recomputeAllSlots: jest.fn().mockResolvedValue(undefined),
      syncMatchPlayers: jest.fn().mockResolvedValue(undefined),
    } as unknown as ResultsService;

    const matchState = {
      createEmptyState: jest.fn(),
      update: jest.fn().mockImplementation((_, state) => state),
      emitMatchUpdate: jest.fn(),
      emitObserverStateUpdate: jest.fn(),
      emitObserverKillFeedUpdate: jest.fn(),
      emitMatchWinner: jest.fn(),
    } as unknown as MatchStateService;

    const service = new MatchEngineService(prisma, results, matchState);

    const result = await service.processTelemetryPacket({
      matchId: 'match-1',
      receivedAt: '2026-03-09T10:00:00.000Z',
      players: [
        {
          uid: 'u-1',
          playerName: 'Alpha',
          teamId: 1,
          liveState: 0,
        },
      ],
      kills: [],
      teams: [{ teamId: 1, teamNo: 1 }],
    });

    expect(tx.matchSlotPlayerResult.upsert).toHaveBeenCalledWith({
      where: {
        slotResultId_playerName: {
          slotResultId: 'slot-result-1',
          playerName: 'Alpha',
        },
      },
      update: {
        kills: 0,
        isAlive: true,
        alive: true,
        isKnocked: false,
        isAutoFilled: true,
      },
      create: {
        slotResultId: 'slot-result-1',
        organizationId: 'org-1',
        playerName: 'Alpha',
        kills: 0,
        isAlive: true,
        alive: true,
        isKnocked: false,
        isAutoFilled: true,
      },
    });
    expect(tx.matchSlotResult.update).toHaveBeenCalledWith({
      where: { id: 'slot-result-1' },
      data: {
        placement: null,
        totalKills: 0,
        manualTotalKills: false,
        eliminatedAt: null,
        isLocked: false,
      },
    });
    expect(tx.matchSlotResult.update).toHaveBeenCalledWith({
      where: { id: 'slot-result-2' },
      data: {
        placement: null,
        totalKills: 0,
        manualTotalKills: false,
        eliminatedAt: null,
        isLocked: false,
      },
    });
    expect(tx.match.update).not.toHaveBeenCalled();
    expect(matchState.emitMatchWinner).not.toHaveBeenCalled();
    expect(matchState.update).toHaveBeenCalledWith(
      'match-1',
      expect.objectContaining({
        matchId: 'match-1',
        teamsAlive: 2,
        winner: null,
      }),
    );
    expect(result).toEqual({
      matchId: 'match-1',
      updatedTeamCount: 2,
      updatedPlayerCount: 1,
      eliminatedTeamIds: [],
      winnerTeamId: null,
    });
  });

  it('does not finalize the match before two minutes even with one alive team', async () => {
    const tx = {
      match: {
        update: jest.fn().mockResolvedValue(undefined),
      },
      matchControlState: {
        findUnique: jest.fn().mockResolvedValue({ metaJson: null }),
        upsert: jest.fn().mockResolvedValue(undefined),
      },
      matchSlotPlayerResult: {
        upsert: jest.fn().mockResolvedValue(undefined),
        deleteMany: jest.fn().mockResolvedValue(undefined),
      },
      matchSlotResult: {
        update: jest.fn().mockResolvedValue(undefined),
      },
    };

    const prisma = {
      match: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'match-1',
          organizationId: 'org-1',
          status: 'LIVE',
          liveState: 'LIVE',
          endedAt: null,
        }),
      },
      matchSlotResult: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'slot-result-1',
            matchId: 'match-1',
            organizationId: 'org-1',
            slotNumber: 1,
            teamId: 'team-1',
            placement: null,
            eliminatedAt: null,
            totalKills: 0,
            manualTotalKills: false,
            isLocked: false,
            players: [],
            team: {
              id: 'team-1',
              name: 'Alpha 7',
              tag: 'A7',
              logoUrl: 'https://cdn.example.com/a7.png',
              accentLight: '#31D7FF',
              accentDark: '#0A5C7A',
            },
          },
          {
            id: 'slot-result-2',
            matchId: 'match-1',
            organizationId: 'org-1',
            slotNumber: 2,
            teamId: 'team-2',
            placement: null,
            eliminatedAt: null,
            totalKills: 0,
            manualTotalKills: false,
            isLocked: false,
            players: [],
            team: {
              id: 'team-2',
              name: 'Arenzyra Wolves',
              tag: 'VX',
              logoUrl: 'https://cdn.example.com/vx.png',
              accentLight: '#F97316',
              accentDark: '#7C2D12',
            },
          },
        ]),
      },
      matchSlot: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      $transaction: jest
        .fn()
        .mockImplementation(async (callback) => callback(tx)),
    } as unknown as PrismaService;

    const results = {
      ensureResultsFromSlots: jest.fn().mockResolvedValue(undefined),
      recomputeAllSlots: jest.fn().mockResolvedValue(undefined),
      syncMatchPlayers: jest.fn().mockResolvedValue(undefined),
    } as unknown as ResultsService;

    const matchState = {
      createEmptyState: jest.fn(),
      update: jest.fn().mockImplementation((_, state) => state),
      emitMatchUpdate: jest.fn(),
      emitObserverStateUpdate: jest.fn(),
      emitObserverKillFeedUpdate: jest.fn(),
      emitMatchWinner: jest.fn(),
    } as unknown as MatchStateService;

    const service = new MatchEngineService(prisma, results, matchState);
    const receivedAt = '2026-03-09T10:00:00.000Z';

    const result = await service.processTelemetryPacket({
      matchId: 'match-1',
      receivedAt,
      observer: {
        gameTime: 90,
      },
      players: [
        {
          uid: 'u-1',
          playerName: 'Alpha',
          teamId: 1,
          liveState: 4,
          health: 100,
          bHasDied: false,
          killNum: 2,
        },
        {
          uid: 'u-2',
          playerName: 'Bravo',
          teamId: 2,
          liveState: 4,
          health: 0,
          bHasDied: true,
          killNum: 1,
        },
      ],
      kills: [
        { killerName: 'Alpha', killerTeamId: 1 },
        { killerName: 'Alpha', killerTeamId: 1 },
        { killerName: 'Bravo', killerTeamId: 2 },
      ],
      teams: [
        { teamId: 1, teamNo: 1 },
        { teamId: 2, teamNo: 2 },
      ],
    });

    expect(tx.match.update).not.toHaveBeenCalled();
    expect(tx.matchControlState.upsert).not.toHaveBeenCalled();
    expect(tx.matchSlotResult.update).toHaveBeenCalledWith({
      where: { id: 'slot-result-1' },
      data: {
        placement: 1,
        totalKills: 2,
        manualTotalKills: false,
        eliminatedAt: null,
        isLocked: false,
      },
    });
    expect(tx.matchSlotResult.update).toHaveBeenCalledWith({
      where: { id: 'slot-result-2' },
      data: {
        placement: 2,
        totalKills: 1,
        manualTotalKills: false,
        eliminatedAt: new Date(receivedAt),
        isLocked: true,
      },
    });
    expect(matchState.update).toHaveBeenCalledWith(
      'match-1',
      expect.objectContaining({
        matchId: 'match-1',
        teamsAlive: 1,
        winner: expect.objectContaining({
          teamId: 'team-1',
          placement: 1,
        }),
      }),
    );
    expect(matchState.emitMatchWinner).not.toHaveBeenCalled();
    expect(result).toEqual({
      matchId: 'match-1',
      updatedTeamCount: 2,
      updatedPlayerCount: 2,
      eliminatedTeamIds: ['team-2'],
      winnerTeamId: 'team-1',
    });
  });

  it('does not re-emit the winner for matches that are already ended', async () => {
    const tx = {
      match: {
        update: jest.fn().mockResolvedValue(undefined),
      },
      matchControlState: {
        findUnique: jest.fn().mockResolvedValue({ metaJson: null }),
        upsert: jest.fn().mockResolvedValue(undefined),
      },
      matchSlotPlayerResult: {
        upsert: jest.fn().mockResolvedValue(undefined),
        deleteMany: jest.fn().mockResolvedValue(undefined),
      },
      matchSlotResult: {
        update: jest.fn().mockResolvedValue(undefined),
      },
    };

    const prisma = {
      match: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'match-1',
          organizationId: 'org-1',
          status: 'ENDED',
          liveState: 'ENDED',
          endedAt: new Date('2026-03-09T10:00:00.000Z'),
        }),
      },
      matchSlotResult: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'slot-result-1',
            matchId: 'match-1',
            organizationId: 'org-1',
            slotNumber: 1,
            teamId: 'team-1',
            placement: 1,
            eliminatedAt: null,
            totalKills: 4,
            manualTotalKills: false,
            isLocked: true,
            players: [],
            team: {
              id: 'team-1',
              name: 'Alpha 7',
              tag: 'A7',
              logoUrl: 'https://cdn.example.com/a7.png',
              accentLight: '#31D7FF',
              accentDark: '#0A5C7A',
            },
          },
          {
            id: 'slot-result-2',
            matchId: 'match-1',
            organizationId: 'org-1',
            slotNumber: 2,
            teamId: 'team-2',
            placement: 2,
            eliminatedAt: new Date('2026-03-09T09:58:00.000Z'),
            totalKills: 1,
            manualTotalKills: false,
            isLocked: true,
            players: [],
            team: {
              id: 'team-2',
              name: 'Arenzyra Wolves',
              tag: 'VX',
              logoUrl: 'https://cdn.example.com/vx.png',
              accentLight: '#F97316',
              accentDark: '#7C2D12',
            },
          },
        ]),
      },
      matchSlot: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      $transaction: jest
        .fn()
        .mockImplementation(async (callback) => callback(tx)),
    } as unknown as PrismaService;

    const results = {
      ensureResultsFromSlots: jest.fn().mockResolvedValue(undefined),
      recomputeAllSlots: jest.fn().mockResolvedValue(undefined),
      syncMatchPlayers: jest.fn().mockResolvedValue(undefined),
    } as unknown as ResultsService;

    const matchState = {
      createEmptyState: jest.fn(),
      update: jest.fn().mockImplementation((_, state) => state),
      emitMatchUpdate: jest.fn(),
      emitObserverStateUpdate: jest.fn(),
      emitObserverKillFeedUpdate: jest.fn(),
      emitMatchWinner: jest.fn(),
    } as unknown as MatchStateService;

    const service = new MatchEngineService(prisma, results, matchState);

    const result = await service.processTelemetryPacket({
      matchId: 'match-1',
      receivedAt: '2026-03-09T10:01:00.000Z',
      players: [
        {
          uid: 'u-1',
          playerName: 'Alpha',
          teamId: 1,
          liveState: 4,
          health: 100,
          bHasDied: false,
          killNum: 4,
        },
      ],
      kills: [{ killerName: 'Alpha', killerTeamId: 1 }],
      teams: [
        { teamId: 1, teamNo: 1 },
        { teamId: 2, teamNo: 2 },
      ],
    });

    expect(tx.match.update).not.toHaveBeenCalled();
    expect(tx.matchControlState.upsert).not.toHaveBeenCalled();
    expect(matchState.emitMatchWinner).not.toHaveBeenCalled();
    expect(tx.matchSlotResult.update).toHaveBeenCalledWith({
      where: { id: 'slot-result-1' },
      data: {
        placement: 1,
        totalKills: 4,
        manualTotalKills: false,
        eliminatedAt: null,
        isLocked: true,
      },
    });
    expect(result.winnerTeamId).toBe('team-1');
  });

  it('revives stale eliminated teams when live telemetry shows they are alive', async () => {
    const tx = {
      match: {
        update: jest.fn().mockResolvedValue(undefined),
      },
      matchControlState: {
        findUnique: jest.fn().mockResolvedValue({ metaJson: null }),
        upsert: jest.fn().mockResolvedValue(undefined),
      },
      matchSlotPlayerResult: {
        upsert: jest.fn().mockResolvedValue(undefined),
        deleteMany: jest.fn().mockResolvedValue(undefined),
      },
      matchSlotResult: {
        update: jest.fn().mockResolvedValue(undefined),
      },
    };

    const staleEliminatedAt = new Date('2026-03-09T09:58:00.000Z');
    const prisma = {
      match: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'match-1',
          organizationId: 'org-1',
          status: 'LIVE',
          liveState: 'LIVE',
          endedAt: null,
          controlState: {
            state: 'LIVE',
            resultsManualLock: false,
            resultsForceUnlock: false,
          },
        }),
      },
      matchSlotResult: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'slot-result-1',
            matchId: 'match-1',
            organizationId: 'org-1',
            slotNumber: 1,
            teamId: 'team-1',
            placement: 1,
            eliminatedAt: staleEliminatedAt,
            totalKills: 3,
            manualTotalKills: false,
            isLocked: true,
            players: [],
            team: {
              id: 'team-1',
              name: 'Alpha 7',
              tag: 'A7',
              logoUrl: 'https://cdn.example.com/a7.png',
              accentLight: '#31D7FF',
              accentDark: '#0A5C7A',
            },
          },
          {
            id: 'slot-result-2',
            matchId: 'match-1',
            organizationId: 'org-1',
            slotNumber: 2,
            teamId: 'team-2',
            placement: 2,
            eliminatedAt: staleEliminatedAt,
            totalKills: 1,
            manualTotalKills: false,
            isLocked: true,
            players: [],
            team: {
              id: 'team-2',
              name: 'Arenzyra Wolves',
              tag: 'VX',
              logoUrl: 'https://cdn.example.com/vx.png',
              accentLight: '#F97316',
              accentDark: '#7C2D12',
            },
          },
        ]),
      },
      matchSlot: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      $transaction: jest
        .fn()
        .mockImplementation(async (callback) => callback(tx)),
    } as unknown as PrismaService;

    const results = {
      ensureResultsFromSlots: jest.fn().mockResolvedValue(undefined),
      recomputeAllSlots: jest.fn().mockResolvedValue(undefined),
      syncMatchPlayers: jest.fn().mockResolvedValue(undefined),
    } as unknown as ResultsService;

    const matchState = {
      createEmptyState: jest.fn(),
      update: jest.fn().mockImplementation((_, state) => state),
      emitMatchUpdate: jest.fn(),
      emitObserverStateUpdate: jest.fn(),
      emitObserverKillFeedUpdate: jest.fn(),
      emitMatchWinner: jest.fn(),
    } as unknown as MatchStateService;

    const service = new MatchEngineService(prisma, results, matchState);

    const result = await service.processTelemetryPacket({
      matchId: 'match-1',
      receivedAt: '2026-03-09T10:01:00.000Z',
      observer: {
        gameTime: 800,
      },
      players: [
        {
          uid: 'u-1',
          playerName: 'Alpha',
          teamId: 1,
          liveState: 4,
          health: 100,
          bHasDied: false,
          killNum: 4,
        },
        {
          uid: 'u-2',
          playerName: 'Bravo',
          teamId: 2,
          liveState: 4,
          health: 75,
          bHasDied: false,
          killNum: 2,
        },
      ],
      kills: [
        { killerName: 'Alpha', killerTeamId: 1 },
        { killerName: 'Bravo', killerTeamId: 2 },
      ],
      teams: [
        { teamId: 1, teamNo: 1 },
        { teamId: 2, teamNo: 2 },
      ],
    });

    expect(tx.match.update).not.toHaveBeenCalled();
    expect(tx.matchControlState.upsert).not.toHaveBeenCalled();
    expect(tx.matchSlotResult.update).toHaveBeenCalledWith({
      where: { id: 'slot-result-1' },
      data: {
        placement: null,
        totalKills: 4,
        manualTotalKills: false,
        eliminatedAt: null,
        isLocked: false,
      },
    });
    expect(tx.matchSlotResult.update).toHaveBeenCalledWith({
      where: { id: 'slot-result-2' },
      data: {
        placement: null,
        totalKills: 2,
        manualTotalKills: false,
        eliminatedAt: null,
        isLocked: false,
      },
    });
    expect(matchState.update).toHaveBeenCalledWith(
      'match-1',
      expect.objectContaining({
        matchId: 'match-1',
        teamsAlive: 2,
        winner: null,
      }),
    );
    expect(matchState.emitMatchWinner).not.toHaveBeenCalled();
    expect(result).toEqual({
      matchId: 'match-1',
      updatedTeamCount: 2,
      updatedPlayerCount: 2,
      eliminatedTeamIds: [],
      winnerTeamId: null,
    });
  });

  it('treats recalled players with live health as alive even when hasDied stayed true', async () => {
    const tx = {
      match: {
        update: jest.fn().mockResolvedValue(undefined),
      },
      matchControlState: {
        findUnique: jest.fn().mockResolvedValue({ metaJson: null }),
        upsert: jest.fn().mockResolvedValue(undefined),
      },
      matchSlotPlayerResult: {
        upsert: jest.fn().mockResolvedValue(undefined),
        deleteMany: jest.fn().mockResolvedValue(undefined),
      },
      matchSlotResult: {
        update: jest.fn().mockResolvedValue(undefined),
      },
    };

    const staleEliminatedAt = new Date('2026-03-09T09:58:00.000Z');
    const prisma = {
      match: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'match-1',
          organizationId: 'org-1',
          status: 'LIVE',
          liveState: 'LIVE',
          endedAt: null,
          controlState: {
            state: 'LIVE',
            resultsManualLock: false,
            resultsForceUnlock: false,
          },
        }),
      },
      matchSlotResult: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'slot-result-1',
            matchId: 'match-1',
            organizationId: 'org-1',
            slotNumber: 1,
            teamId: 'team-1',
            placement: 3,
            eliminatedAt: staleEliminatedAt,
            totalKills: 3,
            manualTotalKills: false,
            isLocked: true,
            players: [],
            team: {
              id: 'team-1',
              name: 'Alpha 7',
              tag: 'A7',
              logoUrl: 'https://cdn.example.com/a7.png',
              accentLight: '#31D7FF',
              accentDark: '#0A5C7A',
            },
          },
          {
            id: 'slot-result-2',
            matchId: 'match-1',
            organizationId: 'org-1',
            slotNumber: 2,
            teamId: 'team-2',
            placement: null,
            eliminatedAt: null,
            totalKills: 1,
            manualTotalKills: false,
            isLocked: true,
            players: [],
            team: {
              id: 'team-2',
              name: 'Arenzyra Wolves',
              tag: 'VX',
              logoUrl: 'https://cdn.example.com/vx.png',
              accentLight: '#F97316',
              accentDark: '#7C2D12',
            },
          },
        ]),
      },
      matchSlot: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      $transaction: jest
        .fn()
        .mockImplementation(async (callback) => callback(tx)),
    } as unknown as PrismaService;

    const results = {
      ensureResultsFromSlots: jest.fn().mockResolvedValue(undefined),
      recomputeAllSlots: jest.fn().mockResolvedValue(undefined),
      syncMatchPlayers: jest.fn().mockResolvedValue(undefined),
    } as unknown as ResultsService;

    const matchState = {
      createEmptyState: jest.fn(),
      update: jest.fn().mockImplementation((_, state) => state),
      emitMatchUpdate: jest.fn(),
      emitObserverStateUpdate: jest.fn(),
      emitObserverKillFeedUpdate: jest.fn(),
      emitMatchWinner: jest.fn(),
    } as unknown as MatchStateService;

    const service = new MatchEngineService(prisma, results, matchState);

    const result = await service.processTelemetryPacket({
      matchId: 'match-1',
      receivedAt: '2026-03-09T10:05:00.000Z',
      observer: {
        gameTime: 700,
      },
      players: [
        {
          uid: 'u-1',
          playerName: 'Alpha',
          teamId: 1,
          liveState: 0,
          health: 92,
          bHasDied: true,
          killNum: 3,
        },
        {
          uid: 'u-2',
          playerName: 'Bravo',
          teamId: 2,
          liveState: 4,
          health: 88,
          bHasDied: false,
          killNum: 1,
        },
      ],
      kills: [],
      teams: [
        { teamId: 1, teamNo: 1 },
        { teamId: 2, teamNo: 2 },
      ],
    });

    expect(tx.matchSlotPlayerResult.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          isAlive: true,
          isKnocked: false,
        }),
        create: expect.objectContaining({
          playerName: 'Alpha',
          isAlive: true,
          isKnocked: false,
        }),
      }),
    );
    expect(matchState.update).toHaveBeenCalledWith(
      'match-1',
      expect.objectContaining({
        leaderboard: expect.arrayContaining([
          expect.objectContaining({
            teamId: 'team-1',
            isEliminated: false,
            players: expect.arrayContaining([
              expect.objectContaining({
                playerName: 'Alpha',
                alive: true,
                knocked: false,
                health: 92,
                hasDied: true,
              }),
            ]),
          }),
        ]),
      }),
    );
    expect(result.winnerTeamId).toBeNull();
  });

  it('finalizes late-game packets when stale slot players are the only remaining non-eliminated teams', async () => {
    const tx = {
      match: {
        update: jest.fn().mockResolvedValue(undefined),
      },
      matchControlState: {
        findUnique: jest.fn().mockResolvedValue({ metaJson: null }),
        upsert: jest.fn().mockResolvedValue(undefined),
      },
      matchSlotPlayerResult: {
        upsert: jest.fn().mockResolvedValue(undefined),
        updateMany: jest.fn().mockResolvedValue(undefined),
        deleteMany: jest.fn().mockResolvedValue(undefined),
      },
      matchSlotResult: {
        update: jest.fn().mockResolvedValue(undefined),
      },
    };

    const prisma = {
      match: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'match-1',
          organizationId: 'org-1',
          status: 'LIVE',
          liveState: 'LIVE',
          endedAt: null,
          controlState: {
            state: 'LIVE',
            resultsManualLock: false,
            resultsForceUnlock: false,
          },
        }),
      },
      matchSlotResult: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'slot-result-1',
            matchId: 'match-1',
            organizationId: 'org-1',
            slotNumber: 1,
            teamId: 'team-1',
            placement: null,
            eliminatedAt: null,
            totalKills: 0,
            manualTotalKills: false,
            isLocked: false,
            players: [],
            team: {
              id: 'team-1',
              name: 'Alpha 7',
              tag: 'A7',
              logoUrl: 'https://cdn.example.com/a7.png',
              accentLight: '#31D7FF',
              accentDark: '#0A5C7A',
            },
          },
          {
            id: 'slot-result-2',
            matchId: 'match-1',
            organizationId: 'org-1',
            slotNumber: 2,
            teamId: 'team-2',
            placement: null,
            eliminatedAt: null,
            totalKills: 0,
            manualTotalKills: false,
            isLocked: false,
            players: [
              {
                id: 'slot-player-2',
                slotResultId: 'slot-result-2',
                organizationId: 'org-1',
                playerId: 'ghost-1',
                playerName: 'Ghost',
                kills: 0,
                isAlive: true,
                alive: true,
                isKnocked: false,
                isAutoFilled: true,
              },
            ],
            team: {
              id: 'team-2',
              name: 'Arenzyra Wolves',
              tag: 'VX',
              logoUrl: 'https://cdn.example.com/vx.png',
              accentLight: '#F97316',
              accentDark: '#7C2D12',
            },
          },
        ]),
      },
      matchSlot: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      $transaction: jest
        .fn()
        .mockImplementation(async (callback) => callback(tx)),
    } as unknown as PrismaService;

    const results = {
      ensureResultsFromSlots: jest.fn().mockResolvedValue(undefined),
      recomputeAllSlots: jest.fn().mockResolvedValue(undefined),
      syncMatchPlayers: jest.fn().mockResolvedValue(undefined),
    } as unknown as ResultsService;

    const matchState = {
      createEmptyState: jest.fn(),
      update: jest.fn().mockImplementation((_, state) => state),
      emitMatchUpdate: jest.fn(),
      emitObserverStateUpdate: jest.fn(),
      emitObserverKillFeedUpdate: jest.fn(),
      emitMatchWinner: jest.fn(),
    } as unknown as MatchStateService;

    const service = new MatchEngineService(prisma, results, matchState);

    const result = await service.processTelemetryPacket({
      matchId: 'match-1',
      receivedAt: '2026-03-09T10:01:00.000Z',
      observer: {
        gameTime: 800,
      },
      players: [
        {
          uid: 'u-1',
          playerName: 'Alpha',
          teamId: 1,
          liveState: 4,
          health: 100,
          bHasDied: false,
          killNum: 4,
        },
      ],
      kills: [{ killerName: 'Alpha', killerTeamId: 1 }],
      teams: [
        { teamId: 1, teamNo: 1 },
        { teamId: 2, teamNo: 2 },
      ],
    });

    expect(tx.matchSlotPlayerResult.updateMany).toHaveBeenCalledWith({
      where: { slotResultId: 'slot-result-2' },
      data: {
        isAlive: false,
        alive: false,
        isKnocked: false,
      },
    });
    expect(tx.matchSlotResult.update).toHaveBeenCalledWith({
      where: { id: 'slot-result-1' },
      data: {
        placement: 1,
        totalKills: 4,
        manualTotalKills: false,
        eliminatedAt: null,
        isLocked: false,
      },
    });
    expect(tx.matchSlotResult.update).toHaveBeenCalledWith({
      where: { id: 'slot-result-2' },
      data: {
        placement: 2,
        totalKills: 0,
        manualTotalKills: false,
        eliminatedAt: new Date('2026-03-09T10:01:00.000Z'),
        isLocked: true,
      },
    });
    expect(tx.match.update).not.toHaveBeenCalled();
    expect(matchState.update).toHaveBeenCalledWith(
      'match-1',
      expect.objectContaining({
        matchId: 'match-1',
        teamsAlive: 1,
        winner: expect.objectContaining({
          teamId: 'team-1',
          placement: 1,
        }),
        leaderboard: expect.arrayContaining([
          expect.objectContaining({
            slot: 2,
            alivePlayers: 0,
            isEliminated: true,
          }),
        ]),
      }),
    );
    expect(matchState.emitMatchWinner).not.toHaveBeenCalled();
    expect(result).toEqual({
      matchId: 'match-1',
      updatedTeamCount: 2,
      updatedPlayerCount: 2,
      eliminatedTeamIds: ['team-2'],
      winnerTeamId: 'team-1',
    });
  });

  it('finalizes a finished packet even when eliminated teams only have stale fallback players', async () => {
    const receivedAt = '2026-03-09T10:01:00.000Z';
    const tx = {
      match: {
        update: jest.fn().mockResolvedValue(undefined),
      },
      matchControlState: {
        findUnique: jest.fn().mockResolvedValue({ metaJson: null }),
        upsert: jest.fn().mockResolvedValue(undefined),
      },
      matchSlotPlayerResult: {
        upsert: jest.fn().mockResolvedValue(undefined),
        updateMany: jest.fn().mockResolvedValue(undefined),
        deleteMany: jest.fn().mockResolvedValue(undefined),
      },
      matchSlotResult: {
        update: jest.fn().mockResolvedValue(undefined),
      },
    };

    const prisma = {
      match: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'match-1',
          organizationId: 'org-1',
          status: 'LIVE',
          liveState: 'LIVE',
          endedAt: null,
          controlState: {
            state: 'LIVE',
            resultsManualLock: false,
            resultsForceUnlock: false,
          },
        }),
      },
      matchSlotResult: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'slot-result-1',
            matchId: 'match-1',
            organizationId: 'org-1',
            slotNumber: 1,
            teamId: 'team-1',
            placement: null,
            eliminatedAt: null,
            totalKills: 0,
            manualTotalKills: false,
            isLocked: false,
            players: [
              {
                id: 'slot-player-1',
                slotResultId: 'slot-result-1',
                organizationId: 'org-1',
                playerId: 'p-1',
                playerName: 'Alpha',
                kills: 0,
                isAlive: true,
                alive: true,
                isKnocked: false,
                isAutoFilled: true,
              },
            ],
            team: {
              id: 'team-1',
              name: 'Alpha 7',
              tag: 'A7',
              logoUrl: 'https://cdn.example.com/a7.png',
              accentLight: '#31D7FF',
              accentDark: '#0A5C7A',
            },
          },
          {
            id: 'slot-result-2',
            matchId: 'match-1',
            organizationId: 'org-1',
            slotNumber: 2,
            teamId: 'team-2',
            placement: null,
            eliminatedAt: null,
            totalKills: 0,
            manualTotalKills: false,
            isLocked: false,
            players: [
              {
                id: 'slot-player-2',
                slotResultId: 'slot-result-2',
                organizationId: 'org-1',
                playerId: 'ghost-1',
                playerName: 'Ghost',
                kills: 0,
                isAlive: true,
                alive: true,
                isKnocked: false,
                isAutoFilled: true,
              },
            ],
            team: {
              id: 'team-2',
              name: 'Arenzyra Wolves',
              tag: 'VX',
              logoUrl: 'https://cdn.example.com/vx.png',
              accentLight: '#F97316',
              accentDark: '#7C2D12',
            },
          },
        ]),
      },
      matchSlot: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      $transaction: jest
        .fn()
        .mockImplementation(async (callback) => callback(tx)),
    } as unknown as PrismaService;

    const results = {
      ensureResultsFromSlots: jest.fn().mockResolvedValue(undefined),
      recomputeAllSlots: jest.fn().mockResolvedValue(undefined),
      syncMatchPlayers: jest.fn().mockResolvedValue(undefined),
    } as unknown as ResultsService;

    const matchState = {
      createEmptyState: jest.fn(),
      update: jest.fn().mockImplementation((_, state) => state),
      emitMatchUpdate: jest.fn(),
      emitObserverStateUpdate: jest.fn(),
      emitObserverKillFeedUpdate: jest.fn(),
      emitMatchWinner: jest.fn(),
    } as unknown as MatchStateService;

    const service = new MatchEngineService(prisma, results, matchState);

    const result = await service.processTelemetryPacket({
      matchId: 'match-1',
      receivedAt,
      phase: 'finished',
      observer: {
        gameTime: 15,
      },
      players: [
        {
          uid: 'u-1',
          playerName: 'Alpha',
          teamId: 1,
          liveState: 4,
          health: 100,
          bHasDied: false,
          killNum: 4,
        },
      ],
      kills: [{ killerName: 'Alpha', killerTeamId: 1 }],
      teams: [
        { teamId: 1, teamNo: 1 },
        { teamId: 2, teamNo: 2 },
      ],
    });

    expect(tx.matchSlotPlayerResult.updateMany).toHaveBeenCalledWith({
      where: { slotResultId: 'slot-result-2' },
      data: {
        isAlive: false,
        alive: false,
        isKnocked: false,
      },
    });
    expect(tx.matchSlotResult.update).toHaveBeenCalledWith({
      where: { id: 'slot-result-2' },
      data: {
        placement: 2,
        totalKills: 0,
        manualTotalKills: false,
        eliminatedAt: new Date(receivedAt),
        isLocked: true,
      },
    });
    expect(tx.match.update).not.toHaveBeenCalled();
    expect(matchState.emitMatchWinner).not.toHaveBeenCalled();
    expect(result).toEqual({
      matchId: 'match-1',
      updatedTeamCount: 2,
      updatedPlayerCount: 2,
      eliminatedTeamIds: ['team-2'],
      winnerTeamId: 'team-1',
    });
  });

  it('marks assigned teams that never joined as missed after the live grace period', async () => {
    const receivedAt = '2026-03-09T10:01:00.000Z';
    const tx = {
      match: {
        update: jest.fn().mockResolvedValue(undefined),
      },
      matchControlState: {
        findUnique: jest.fn().mockResolvedValue({
          metaJson: { joinedSlotNumbers: [1] },
          organizationId: 'org-1',
        }),
        upsert: jest.fn().mockResolvedValue(undefined),
      },
      matchSlotPlayerResult: {
        upsert: jest.fn().mockResolvedValue(undefined),
        deleteMany: jest.fn().mockResolvedValue(undefined),
      },
      matchSlotResult: {
        update: jest.fn().mockResolvedValue(undefined),
      },
    };

    const prisma = {
      match: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'match-1',
          organizationId: 'org-1',
          status: 'LIVE',
          liveState: 'LIVE',
          endedAt: null,
          controlState: {
            state: 'LIVE',
            resultsManualLock: false,
            resultsForceUnlock: false,
            metaJson: {
              joinedSlotNumbers: [1],
            },
          },
        }),
      },
      matchSlotResult: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'slot-result-1',
            matchId: 'match-1',
            organizationId: 'org-1',
            slotNumber: 1,
            teamId: 'team-1',
            placement: null,
            eliminatedAt: null,
            totalKills: 0,
            manualTotalKills: false,
            isLocked: false,
            players: [],
            team: {
              id: 'team-1',
              name: 'Alpha 7',
              tag: 'A7',
              logoUrl: 'https://cdn.example.com/a7.png',
              accentLight: '#31D7FF',
              accentDark: '#0A5C7A',
            },
          },
          {
            id: 'slot-result-2',
            matchId: 'match-1',
            organizationId: 'org-1',
            slotNumber: 2,
            teamId: 'team-2',
            placement: null,
            eliminatedAt: null,
            totalKills: 0,
            manualTotalKills: false,
            isLocked: false,
            players: [],
            team: {
              id: 'team-2',
              name: 'Arenzyra Wolves',
              tag: 'VX',
              logoUrl: 'https://cdn.example.com/vx.png',
              accentLight: '#F97316',
              accentDark: '#7C2D12',
            },
          },
        ]),
      },
      matchSlot: {
        findMany: jest.fn().mockResolvedValue([
          {
            slotNumber: 1,
            lobbyStatus: 'ONLINE',
            playersInLobby: 4,
          },
          {
            slotNumber: 2,
            lobbyStatus: 'OFFLINE',
            playersInLobby: 0,
          },
        ]),
      },
      $transaction: jest
        .fn()
        .mockImplementation(async (callback) => callback(tx)),
    } as unknown as PrismaService;

    const results = {
      ensureResultsFromSlots: jest.fn().mockResolvedValue(undefined),
      recomputeAllSlots: jest.fn().mockResolvedValue(undefined),
      syncMatchPlayers: jest.fn().mockResolvedValue(undefined),
    } as unknown as ResultsService;

    const matchState = {
      createEmptyState: jest.fn(),
      update: jest.fn().mockImplementation((_, state) => state),
      emitMatchUpdate: jest.fn(),
      emitObserverStateUpdate: jest.fn(),
      emitObserverKillFeedUpdate: jest.fn(),
      emitMatchWinner: jest.fn(),
    } as unknown as MatchStateService;

    const service = new MatchEngineService(prisma, results, matchState);

    const result = await service.processTelemetryPacket({
      matchId: 'match-1',
      receivedAt,
      observer: {
        gameTime: 90,
      },
      players: [
        {
          uid: 'u-1',
          playerName: 'Alpha',
          teamId: 1,
          liveState: 4,
          health: 100,
          bHasDied: false,
          killNum: 2,
        },
      ],
      kills: [{ killerName: 'Alpha', killerTeamId: 1 }],
      teams: [{ teamId: 1, teamNo: 1 }],
    });

    expect(tx.match.update).not.toHaveBeenCalled();
    expect(tx.matchSlotResult.update).toHaveBeenCalledWith({
      where: { id: 'slot-result-1' },
      data: {
        placement: 1,
        totalKills: 2,
        manualTotalKills: false,
        eliminatedAt: null,
        isLocked: false,
      },
    });
    expect(tx.matchSlotResult.update).toHaveBeenCalledWith({
      where: { id: 'slot-result-2' },
      data: {
        placement: 2,
        totalKills: 0,
        manualTotalKills: false,
        eliminatedAt: new Date(receivedAt),
        isLocked: true,
      },
    });
    expect(tx.matchControlState.upsert).toHaveBeenCalledWith({
      where: { matchId: 'match-1' },
      update: {
        metaJson: {
          joinedSlotNumbers: [1],
          missedSlotNumbers: [2],
        },
      },
      create: {
        matchId: 'match-1',
        organizationId: 'org-1',
        state: 'LIVE',
        metaJson: {
          joinedSlotNumbers: [1],
          missedSlotNumbers: [2],
        },
      },
    });
    expect(matchState.update).toHaveBeenCalledWith(
      'match-1',
      expect.objectContaining({
        matchId: 'match-1',
        teamsAlive: 1,
        winner: expect.objectContaining({
          teamId: 'team-1',
          placement: 1,
        }),
        leaderboard: expect.arrayContaining([
          expect.objectContaining({
            slot: 2,
            placement: 2,
            isEliminated: true,
          }),
        ]),
      }),
    );
    expect(result).toEqual({
      matchId: 'match-1',
      updatedTeamCount: 2,
      updatedPlayerCount: 1,
      eliminatedTeamIds: [],
      winnerTeamId: 'team-1',
    });
  });

  it('emits a backend team elimination event only once per team elimination', async () => {
    const receivedAt = '2026-03-18T10:00:00.000Z';
    const tx = {
      matchControlState: {
        findUnique: jest.fn().mockResolvedValue({ metaJson: null }),
        upsert: jest.fn().mockResolvedValue(undefined),
      },
      matchSlotPlayerResult: {
        upsert: jest.fn().mockResolvedValue(undefined),
        deleteMany: jest.fn().mockResolvedValue(undefined),
        updateMany: jest.fn().mockResolvedValue(undefined),
      },
      matchSlotResult: {
        update: jest.fn().mockResolvedValue(undefined),
      },
    };

    const liveSlotResults = [
      {
        id: 'slot-result-1',
        matchId: 'match-1',
        organizationId: 'org-1',
        slotNumber: 1,
        teamId: 'team-1',
        placement: null,
        eliminatedAt: null,
        totalKills: 2,
        manualTotalKills: false,
        isLocked: false,
        players: [],
        team: {
          id: 'team-1',
          name: 'Alpha 7',
          tag: 'A7',
          logoUrl: null,
          accentLight: '#31D7FF',
          accentDark: '#0A5C7A',
        },
      },
      {
        id: 'slot-result-2',
        matchId: 'match-1',
        organizationId: 'org-1',
        slotNumber: 2,
        teamId: 'team-2',
        placement: null,
        eliminatedAt: null,
        totalKills: 0,
        manualTotalKills: false,
        isLocked: false,
        players: [],
        team: {
          id: 'team-2',
          name: 'Arenzyra Wolves',
          tag: 'VX',
          logoUrl: null,
          accentLight: '#F97316',
          accentDark: '#7C2D12',
        },
      },
    ];
    const storedSlotResults = [
      liveSlotResults[0],
      {
        ...liveSlotResults[1],
        placement: 2,
        eliminatedAt: new Date(receivedAt),
        isLocked: true,
      },
    ];

    const prisma = {
      match: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'match-1',
          organizationId: 'org-1',
          status: 'LIVE',
          liveState: 'LIVE',
          endedAt: null,
          controlState: {
            state: 'LIVE',
            resultsManualLock: false,
            resultsForceUnlock: false,
            metaJson: null,
          },
        }),
      },
      matchSlotResult: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce(liveSlotResults)
          .mockResolvedValueOnce(storedSlotResults),
      },
      matchSlot: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      $transaction: jest
        .fn()
        .mockImplementation(async (callback) => callback(tx)),
    } as unknown as PrismaService;

    const results = {
      ensureResultsFromSlots: jest.fn().mockResolvedValue(undefined),
      recomputeAllSlots: jest.fn().mockResolvedValue(undefined),
      syncMatchPlayers: jest.fn().mockResolvedValue(undefined),
    } as unknown as ResultsService;

    const matchState = {
      update: jest.fn().mockImplementation((_, state) => state),
      emitMatchUpdate: jest.fn(),
      emitObserverStateUpdate: jest.fn(),
      emitObserverKillFeedUpdate: jest.fn(),
      emitMatchWinner: jest.fn(),
    } as unknown as MatchStateService;
    const teamElimination = {
      publish: jest.fn().mockReturnValue(true),
    };

    const service = new MatchEngineService(
      prisma,
      results,
      matchState,
      undefined,
      teamElimination as any,
    );
    const payload = {
      matchId: 'match-1',
      receivedAt,
      observer: { gameTime: 180 },
      players: [
        {
          uid: 'u-1',
          playerName: 'Alpha',
          teamId: 1,
          liveState: 0,
          health: 100,
          bHasDied: false,
          killNum: 2,
        },
        {
          uid: 'u-2',
          playerName: 'Bravo',
          teamId: 2,
          liveState: 5,
          health: 0,
          bHasDied: true,
          killNum: 1,
        },
      ],
      kills: [
        { killerName: 'Alpha', killerTeamId: 1 },
        { killerName: 'Alpha', killerTeamId: 1 },
        { killerName: 'Bravo', killerTeamId: 2 },
      ],
      teams: [
        { teamId: 1, teamNo: 1 },
        { teamId: 2, teamNo: 2 },
      ],
    };

    await service.processTelemetryPacket(payload);
    await service.processTelemetryPacket(payload);

    expect(teamElimination.publish).toHaveBeenCalledTimes(1);
    expect(teamElimination.publish).toHaveBeenCalledWith({
      matchId: 'match-1',
      eventId: 'team-eliminated:match-1:slot-result-2',
      teamId: 'team-2',
      teamName: 'Arenzyra Wolves',
      placement: 2,
      kills: 1,
      eliminatedAt: receivedAt,
    });
  });
});

describe('MatchEngineService disabled contract', () => {
  it('still rejects empty match ids before the disabled no-op path', async () => {
    const service = new MatchEngineService(
      {} as PrismaService,
      {} as ResultsService,
      {} as MatchStateService,
    );

    await expect(
      service.processTelemetryPacket({
        matchId: '   ',
        players: [],
        teams: [],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('returns a no-op result without touching persistence or broadcasts', async () => {
    const prisma = {
      match: {
        findFirst: jest.fn(),
      },
    } as unknown as PrismaService;
    const results = {
      ensureResultsFromSlots: jest.fn(),
      recomputeAllSlots: jest.fn(),
      syncMatchPlayers: jest.fn(),
    } as unknown as ResultsService;
    const matchState = {
      update: jest.fn(),
      emitMatchUpdate: jest.fn(),
      emitObserverStateUpdate: jest.fn(),
      emitObserverKillFeedUpdate: jest.fn(),
      emitMatchWinner: jest.fn(),
    } as unknown as MatchStateService;
    const fightDetection = {
      processTelemetryPacket: jest.fn(),
    } as unknown as FightDetectionEngine;

    const service = new MatchEngineService(
      prisma,
      results,
      matchState,
      fightDetection,
    );

    await expect(
      service.processTelemetryPacket({
        matchId: 'missing-match',
        receivedAt: '2026-03-09T10:00:00.000Z',
        players: [
          {
            uid: 'u-1',
            userName: 'Alpha',
            teamId: 1,
            teamNo: 1,
            health: 100,
            liveState: 0,
          },
        ],
        teams: [{ teamId: 1, teamNo: 1 }],
      } as any),
    ).resolves.toEqual({
      matchId: 'missing-match',
      updatedTeamCount: 0,
      updatedPlayerCount: 0,
      eliminatedTeamIds: [],
      winnerTeamId: null,
    });

    expect(prisma.match.findFirst).not.toHaveBeenCalled();
    expect(results.ensureResultsFromSlots).not.toHaveBeenCalled();
    expect(results.recomputeAllSlots).not.toHaveBeenCalled();
    expect(results.syncMatchPlayers).not.toHaveBeenCalled();
    expect(matchState.update).not.toHaveBeenCalled();
    expect(matchState.emitMatchUpdate).not.toHaveBeenCalled();
    expect(matchState.emitObserverStateUpdate).not.toHaveBeenCalled();
    expect(matchState.emitObserverKillFeedUpdate).not.toHaveBeenCalled();
    expect(matchState.emitMatchWinner).not.toHaveBeenCalled();
    expect(fightDetection.processTelemetryPacket).not.toHaveBeenCalled();
  });
});
