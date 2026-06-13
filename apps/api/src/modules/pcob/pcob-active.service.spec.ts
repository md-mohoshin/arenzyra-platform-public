import { MatchDataSource, MatchStatus } from '@prisma/client';
import { PcobActiveService } from './pcob-active.service';

describe('PcobActiveService', () => {
  it('surfaces API-bound adapter matches as active compatibility matches', async () => {
    const prisma = {
      match: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'match-1',
            pcobSessionId: 'session-1',
            dataMode: 'MANUAL',
            dataSource: MatchDataSource.API,
            pcobMode: false,
            adapterKey: 'pubgm-pcob',
          },
        ]),
      },
    } as any;

    const service = new PcobActiveService(prisma);

    await expect(
      service.getActiveMatch({
        id: 'user-1',
        role: 'ORGANIZER',
        organizationId: 'org-1',
        actingOrgId: 'org-1',
        actorRole: 'ORGANIZER',
      }),
    ).resolves.toEqual({
      active: true,
      matchId: 'match-1',
      pcobSessionId: 'session-1',
      mode: 'API',
    });

    expect(prisma.match.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: MatchStatus.LIVE,
          deletedAt: null,
        }),
      }),
    );
  });

  it('surfaces explicit legacy PCOB matches as API compatibility matches', async () => {
    const prisma = {
      match: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'match-1',
            pcobSessionId: 'session-1',
            dataMode: 'PCOB',
            dataSource: MatchDataSource.PCOB,
            pcobMode: true,
            adapterKey: 'pubgm-pcob',
          },
        ]),
      },
    } as any;

    const service = new PcobActiveService(prisma);

    await expect(service.getActiveMatch()).resolves.toEqual({
      active: true,
      matchId: 'match-1',
      pcobSessionId: 'session-1',
      mode: 'API',
    });
  });
});
