import { NotFoundException } from '@nestjs/common';
import { requireMatchOrganization } from '../../common/org/org.util';
import { ControlAutoV2SetupService } from './control-auto-v2-setup.service';

jest.mock('../../common/org/org.util', () => ({
  requireMatchOrganization: jest.fn().mockResolvedValue('org-1'),
}));

describe('ControlAutoV2SetupService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (requireMatchOrganization as jest.Mock).mockResolvedValue('org-1');
  });

  it('returns DB setup data only', async () => {
    const prisma = {
      match: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'match-1',
          name: 'Match 1',
          status: 'DRAFT',
          matchNumber: 3,
          map: 'Erangel',
        }),
      },
      matchSlot: {
        findMany: jest.fn().mockResolvedValue([
          {
            slotNumber: 1,
            team: {
              id: 'team-1',
              name: 'Alpha',
              tag: 'ALP',
              logoUrl: null,
              players: [
                {
                  id: 'player-1',
                  ign: 'Alpha 1',
                  realName: 'A One',
                  externalPlayerId: 'ext-1',
                  inGameId: 'ingame-1',
                },
              ],
            },
          },
        ]),
      },
    } as any;

    const service = new ControlAutoV2SetupService(prisma);

    await expect(
      service.getSetup({ organizationId: 'org-1' } as any, 'match-1'),
    ).resolves.toEqual({
      match: {
        id: 'match-1',
        name: 'Match 1',
        status: 'DRAFT',
        matchNumber: 3,
        map: 'Erangel',
      },
      slots: [
        {
          slotNumber: 1,
          team: {
            id: 'team-1',
            name: 'Alpha',
            tag: 'ALP',
            logoUrl: null,
            players: [
              {
                id: 'player-1',
                ign: 'Alpha 1',
                realName: 'A One',
                externalPlayerId: 'ext-1',
                inGameId: 'ingame-1',
              },
            ],
          },
        },
      ],
      assignedTeams: [
        {
          id: 'team-1',
          name: 'Alpha',
          tag: 'ALP',
          logoUrl: null,
          players: [
            {
              id: 'player-1',
              ign: 'Alpha 1',
              realName: 'A One',
              externalPlayerId: 'ext-1',
              inGameId: 'ingame-1',
            },
          ],
        },
      ],
      assignedPlayers: [
        {
          id: 'player-1',
          ign: 'Alpha 1',
          realName: 'A One',
          externalPlayerId: 'ext-1',
          inGameId: 'ingame-1',
        },
      ],
    });

    expect(prisma.match.findFirst).toHaveBeenCalledTimes(1);
    expect(prisma.matchSlot.findMany).toHaveBeenCalledTimes(1);
  });

  it('throws when the match does not exist', async () => {
    const prisma = {
      match: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      matchSlot: {
        findMany: jest.fn(),
      },
    } as any;

    const service = new ControlAutoV2SetupService(prisma);

    await expect(
      service.getSetup({ organizationId: 'org-1' } as any, 'match-1'),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(prisma.matchSlot.findMany).not.toHaveBeenCalled();
  });
});
