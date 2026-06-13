import { BadRequestException } from '@nestjs/common';
import type { PrismaService } from '../../db/prisma.service';
import { MatchStateService } from '../observer/match-state.service';
import { MatchEngineService } from './match-engine.service';
import type { FightDetectionEngine } from './fight-detection.engine';

describe('MatchEngineService legacy telemetry contract', () => {
  it('rejects telemetry packets without a match id', async () => {
    const service = new MatchEngineService(
      {} as PrismaService,
      {} as MatchStateService,
    );

    await expect(
      service.processTelemetryPacket({
        matchId: '',
        players: [],
        kills: [],
        teams: [],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('keeps the disabled legacy authority path read/write silent', async () => {
    const prisma = {
      match: {
        findFirst: jest.fn(),
      },
    } as unknown as PrismaService;
    const matchState = {
      update: jest.fn(),
      emitMatchUpdate: jest.fn(),
      emitObserverStateUpdate: jest.fn(),
      emitObserverKillFeedUpdate: jest.fn(),
    } as unknown as MatchStateService;
    const fightDetection = {
      processTelemetryPacket: jest.fn(),
    } as unknown as FightDetectionEngine;

    const service = new MatchEngineService(prisma, matchState, fightDetection);

    await expect(
      service.processTelemetryPacket({
        matchId: 'match-1',
        players: [{ playerId: 'player-1', teamId: 'team-1' }],
        kills: [],
        teams: [],
      }),
    ).resolves.toEqual({
      matchId: 'match-1',
      updatedTeamCount: 0,
      updatedPlayerCount: 0,
      eliminatedTeamIds: [],
      winnerTeamId: null,
    });

    expect((prisma as any).match.findFirst).not.toHaveBeenCalled();
    expect(matchState.update).not.toHaveBeenCalled();
    expect(fightDetection.processTelemetryPacket).not.toHaveBeenCalled();
  });
});
