import { GameKey, MatchStatus } from '@prisma/client';
import { RankingEmitterService } from './ranking-emitter.service';

describe('RankingEmitterService', () => {
  it('computes live ranking for a session match without a tournament relation', async () => {
    const io = {
      to: jest.fn().mockReturnThis(),
      emit: jest.fn(),
    };
    const prisma = {
      match: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'match-session-1',
          tournamentId: null,
          organizationId: 'org-1',
          status: MatchStatus.LIVE,
          game: { key: GameKey.PUBG_MOBILE },
          ruleset: null,
          tournament: null,
          matchSlots: [
            {
              slotNumber: 1,
              teamId: 'team-a',
              team: {
                id: 'team-a',
                name: 'Alpha',
                tag: 'ALP',
                logoUrl: null,
              },
            },
          ],
          matchTeams: [],
        }),
      },
      matchSlotResult: {
        findMany: jest.fn().mockResolvedValue([
          {
            teamId: 'team-a',
            slotNumber: 1,
            wasPresentInMatch: true,
            placement: 1,
            totalKills: 5,
            placementPoints: 10,
            totalPoints: 15,
            team: {
              id: 'team-a',
              name: 'Alpha',
              tag: 'ALP',
              logoUrl: null,
            },
          },
        ]),
      },
      adminAdjustment: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      ruleset: {
        findUnique: jest.fn(),
      },
    } as any;

    const service = new RankingEmitterService(prisma, { io } as any);

    const payload = await service.emitLiveRanking('match-session-1', {
      force: true,
    });

    expect(payload).toMatchObject({
      matchId: 'match-session-1',
      teams: [
        {
          teamId: 'team-a',
          rank: 1,
          placement: 1,
          kills: 5,
          totalPoints: 15,
        },
      ],
    });
    expect(prisma.adminAdjustment.findMany).not.toHaveBeenCalled();
    expect(prisma.ruleset.findUnique).not.toHaveBeenCalled();
  });

  it('omits NO_SHOW teams from live ranking payloads', async () => {
    const io = {
      to: jest.fn().mockReturnThis(),
      emit: jest.fn(),
    };
    const prisma = {
      match: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'match-session-1',
          tournamentId: null,
          organizationId: 'org-1',
          status: MatchStatus.LIVE,
          game: { key: GameKey.PUBG_MOBILE },
          ruleset: null,
          tournament: null,
          matchSlots: [
            {
              slotNumber: 1,
              teamId: 'team-a',
              team: {
                id: 'team-a',
                name: 'Alpha',
                tag: 'ALP',
                logoUrl: null,
              },
            },
            {
              slotNumber: 2,
              teamId: 'team-b',
              team: {
                id: 'team-b',
                name: 'Bravo',
                tag: 'BRV',
                logoUrl: null,
              },
            },
          ],
          matchTeams: [],
        }),
      },
      matchSlotResult: {
        findMany: jest.fn().mockResolvedValue([
          {
            teamId: 'team-a',
            slotNumber: 1,
            wasPresentInMatch: true,
            placement: 1,
            totalKills: 5,
            placementPoints: 10,
            totalPoints: 15,
            team: {
              id: 'team-a',
              name: 'Alpha',
              tag: 'ALP',
              logoUrl: null,
            },
          },
        ]),
      },
      adminAdjustment: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      ruleset: {
        findUnique: jest.fn(),
      },
    } as any;

    const service = new RankingEmitterService(prisma, { io } as any);

    const payload = await service.emitLiveRanking('match-session-1', {
      force: true,
    });

    expect(payload?.teams).toEqual([
      expect.objectContaining({
        teamId: 'team-a',
        wasPresentInMatch: true,
        presenceStatus: 'ACTIVE',
      }),
    ]);
    expect(payload?.teams.some((team) => team.teamId === 'team-b')).toBe(false);
    expect(prisma.matchSlotResult.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          matchId: 'match-session-1',
          wasPresentInMatch: true,
        }),
      }),
    );
  });
});
