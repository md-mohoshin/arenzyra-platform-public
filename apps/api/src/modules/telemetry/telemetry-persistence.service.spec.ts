import type { PrismaService } from '../../db/prisma.service';
import { TelemetryPersistenceService } from './telemetry-persistence.service';

describe('TelemetryPersistenceService', () => {
  it('writes match control state and a passive compatibility snapshot from engine state', async () => {
    const tx = {
      match: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'match-1',
          organizationId: 'org-1',
          status: 'LIVE',
          controlState: {
            state: 'LIVE',
            metaJson: null,
          },
        }),
      },
      matchControlState: {
        upsert: jest.fn().mockResolvedValue(undefined),
      },
      matchStateSnapshot: {
        upsert: jest.fn().mockResolvedValue(undefined),
      },
    };
    const prisma = {
      $transaction: jest
        .fn()
        .mockImplementation(async (callback: any) => callback(tx)),
    } as unknown as PrismaService;
    const service = new TelemetryPersistenceService(prisma);

    await service.persistState({
      matchId: 'match-1',
      status: 'LIVE',
      mode: 'AUTO',
      version: 4,
      sequence: 12,
      updatedAt: 1_000,
      telemetryAcceptedAt: 1_000,
      telemetryAcceptedSource: 'PCOB_PUSH',
      startedAt: 900,
      endedAt: null,
      teamsAlive: 1,
      circle: null,
      killFeed: [],
      events: [],
      players: {
        'player-1': {
          playerId: 'player-1',
          teamId: 'team-1',
          alive: true,
          knocked: false,
          kills: 0,
        },
      },
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
    });

    expect(tx.matchControlState.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { matchId: 'match-1' },
      }),
    );
    expect(tx.matchStateSnapshot.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { matchId: 'match-1' },
      }),
    );
  });
});
