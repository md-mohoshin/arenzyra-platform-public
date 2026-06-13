import { requireMatchOrganization } from '../../common/org/org.util';
import { ControlAutoV2ResultsService } from './control-auto-v2-results.service';

jest.mock('../../common/org/org.util', () => ({
  requireMatchOrganization: jest.fn().mockResolvedValue('org-1'),
}));

describe('ControlAutoV2ResultsService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (requireMatchOrganization as jest.Mock).mockResolvedValue('org-1');
  });

  it('returns results data only from final result tables', async () => {
    const prisma = {
      matchSlotResult: {
        findMany: jest.fn().mockResolvedValue([
          {
            teamId: 'team-1',
            placement: 2,
            totalKills: 8,
            totalPoints: 14,
            points: 14,
            slotNumber: 2,
            wasPresentInMatch: true,
            players: [
              {
                playerId: 'player-1',
                playerName: 'Alpha 1',
                kills: 5,
              },
            ],
          },
          {
            teamId: 'team-2',
            placement: 1,
            totalKills: 6,
            totalPoints: 16,
            points: 16,
            slotNumber: 1,
            wasPresentInMatch: true,
            players: [
              {
                playerId: 'player-2',
                playerName: 'Bravo 1',
                kills: 6,
              },
            ],
          },
        ]),
      },
    } as any;

    const service = new ControlAutoV2ResultsService(prisma);

    await expect(
      service.getResults({ organizationId: 'org-1' } as any, 'match-1'),
    ).resolves.toEqual({
      placements: [
        {
          teamId: 'team-1',
          placement: 2,
        },
        {
          teamId: 'team-2',
          placement: 1,
        },
      ],
      kills: [
        {
          teamId: 'team-1',
          kills: 8,
          players: [
            {
              playerId: 'player-1',
              playerName: 'Alpha 1',
              kills: 5,
            },
          ],
        },
        {
          teamId: 'team-2',
          kills: 6,
          players: [
            {
              playerId: 'player-2',
              playerName: 'Bravo 1',
              kills: 6,
            },
          ],
        },
      ],
      standings: [
        {
          rank: 1,
          teamId: 'team-2',
          placement: 1,
          kills: 6,
          points: 16,
        },
        {
          rank: 2,
          teamId: 'team-1',
          placement: 2,
          kills: 8,
          points: 14,
        },
      ],
    });
  });
});
