import type { PrismaService } from '../../db/prisma.service';
import { TelemetryMappingService } from './telemetry-mapping.service';

describe('TelemetryMappingService', () => {
  type SlotResultRecord = {
    teamId: string;
    slotNumber: number;
    players: Array<{
      id: string;
      playerId: string | null;
      playerName: string | null;
      externalPlayerId: string | null;
      pubgAccountId: string | null;
      player: {
        ign: string | null;
        externalPlayerId: string | null;
        playerOpenId: string | null;
        inGameId: string | null;
        pubgPlayerId: string | null;
      } | null;
    }>;
  };

  type MatchRecord = {
    matchSlots: Array<{
      slotNumber: number;
      team: {
        id: string;
        players: Array<{
          id: string;
          ign: string | null;
          realName: string | null;
          externalPlayerId: string | null;
          playerOpenId: string | null;
          inGameId: string | null;
          pubgPlayerId: string | null;
        }>;
      } | null;
    }>;
  } | null;

  const createService = (options?: {
    slotResults?: SlotResultRecord[];
    match?: MatchRecord;
  }) => {
    const prisma = {
      matchSlotResult: {
        findMany: jest.fn().mockResolvedValue(
          options?.slotResults ?? [
            {
              teamId: 'team-1',
              slotNumber: 1,
              players: [
                {
                  id: 'slot-player-1',
                  playerId: 'player-1',
                  playerName: 'Alpha',
                  externalPlayerId: null,
                  pubgAccountId: null,
                  player: {
                    ign: 'Alpha',
                    externalPlayerId: null,
                    playerOpenId: null,
                    inGameId: null,
                    pubgPlayerId: null,
                  },
                },
                {
                  id: 'slot-player-2',
                  playerId: 'player-2',
                  playerName: 'Bravo',
                  externalPlayerId: null,
                  pubgAccountId: null,
                  player: {
                    ign: 'Bravo',
                    externalPlayerId: null,
                    playerOpenId: null,
                    inGameId: null,
                    pubgPlayerId: null,
                  },
                },
              ],
            },
          ],
        ),
      },
      match: {
        findUnique: jest.fn().mockResolvedValue(options?.match ?? null),
      },
    } as unknown as PrismaService;

    return {
      prisma,
      service: new TelemetryMappingService(prisma),
    };
  };

  it('keeps the first resolved slot stable and locks after repeated confirmations', async () => {
    const { service } = createService();

    const first = await service.resolve('match-1', {
      externalPlayerId: 'provider-1',
      teamId: 'team-1',
      playerIndex: 0,
    });

    expect(first).toMatchObject({
      externalPlayerId: 'provider-1',
      slotPlayerId: 'slot-player-1',
      locked: false,
      confidence: 0.5,
    });

    const driftAttempt = await service.resolve('match-1', {
      externalPlayerId: 'provider-1',
      teamId: 'team-1',
      playerIndex: 1,
    });

    expect(driftAttempt).toMatchObject({
      slotPlayerId: 'slot-player-1',
      locked: false,
    });

    let confirmed = driftAttempt;
    for (let index = 0; index < 5; index += 1) {
      confirmed = service.confirmMapping(
        'match-1',
        'provider-1',
        driftAttempt?.slotPlayerId,
      );
    }

    expect(confirmed).toMatchObject({
      slotPlayerId: 'slot-player-1',
      locked: true,
      confidence: 1,
    });
    expect(service.getStability('match-1', 2)).toEqual({
      stability: 0.5,
      locked: 1,
      expected: 2,
    });

    const lockedDriftAttempt = await service.resolve('match-1', {
      externalPlayerId: 'provider-1',
      teamId: 'team-1',
      playerIndex: 1,
    });

    expect(lockedDriftAttempt).toMatchObject({
      slotPlayerId: 'slot-player-1',
      locked: true,
    });
  });

  it('clears locked state only when the match mapping is reset', async () => {
    const { service } = createService();

    await service.resolve('match-1', {
      externalPlayerId: 'provider-1',
      teamId: 'team-1',
      playerIndex: 0,
    });
    for (let index = 0; index < 5; index += 1) {
      service.confirmMapping('match-1', 'provider-1', 'slot-player-1');
    }

    expect(service.getStability('match-1', 1)).toMatchObject({
      locked: 1,
      expected: 1,
      stability: 1,
    });

    service.reset('match-1');

    expect(service.getStability('match-1', 1)).toMatchObject({
      locked: 0,
      expected: 1,
      stability: 0,
    });
  });

  it('resolves players from match slots when slot-result players are not materialized yet', async () => {
    const { service } = createService({
      slotResults: [
        {
          teamId: 'team-17',
          slotNumber: 17,
          players: [],
        },
      ],
      match: {
        matchSlots: [
          {
            slotNumber: 17,
            team: {
              id: 'team-17',
              players: [
                {
                  id: 'player-17-a',
                  ign: 'LxAIMGOAT',
                  realName: 'Aim Goat',
                  externalPlayerId: 'provider-player-17-a',
                  playerOpenId: 'open-player-17-a',
                  inGameId: 'ig-player-17-a',
                  pubgPlayerId: 'pubg-player-17-a',
                },
              ],
            },
          },
        ],
      },
    });

    const resolved = await service.resolve('match-1', {
      externalPlayerId: 'provider-player-17-a',
      teamId: 'team-17',
    });

    expect(resolved).toMatchObject({
      externalPlayerId: 'provider-player-17-a',
      slotPlayerId: 'player-17-a',
      slotPlayerResultId: 'player-17-a',
      playerId: 'player-17-a',
      playerKey: 'player-17-a',
      teamId: 'team-17',
      slotNumber: 17,
      locked: false,
      confidence: 0.5,
    });
  });

  it('merges team roster identifiers into slot-result players for stable canonical mapping', async () => {
    const { service } = createService({
      slotResults: [
        {
          teamId: 'team-1',
          slotNumber: 1,
          players: [
            {
              id: 'slot-player-1',
              playerId: 'player-1',
              playerName: 'Alpha',
              externalPlayerId: null,
              pubgAccountId: null,
              player: {
                ign: 'Alpha',
                externalPlayerId: null,
                playerOpenId: null,
                inGameId: null,
                pubgPlayerId: null,
              },
            },
          ],
        },
      ],
      match: {
        matchSlots: [
          {
            slotNumber: 1,
            team: {
              id: 'team-1',
              players: [
                {
                  id: 'player-1',
                  ign: 'Alpha',
                  realName: 'Alpha One',
                  externalPlayerId: 'provider-player-1',
                  playerOpenId: 'open-player-1',
                  inGameId: 'ig-player-1',
                  pubgPlayerId: 'pubg-player-1',
                },
              ],
            },
          },
        ],
      },
    });

    const resolved = await service.resolve('match-1', {
      externalPlayerId: 'provider-player-1',
      teamId: 'team-1',
    });

    expect(resolved).toMatchObject({
      externalPlayerId: 'provider-player-1',
      slotPlayerId: 'slot-player-1',
      slotPlayerResultId: 'slot-player-1',
      playerId: 'player-1',
      playerKey: 'player-1',
      teamId: 'team-1',
      slotNumber: 1,
      locked: false,
      confidence: 0.5,
    });
  });
});
