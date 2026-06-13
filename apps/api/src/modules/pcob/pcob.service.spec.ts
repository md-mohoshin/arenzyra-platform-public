import { MatchDataSource, MatchStatus } from '@prisma/client';
import { PcobService } from './pcob.service';

describe('PcobService', () => {
  const createService = (prisma: any, health: any = { setClient: jest.fn() }) =>
    new PcobService(
      prisma,
      {} as any,
      { subscribe: jest.fn(), publish: jest.fn() } as any,
      health,
    );

  it('rejects legacy bind for an API-bound pubgm-pcob match', async () => {
    const prisma = {
      match: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'match-1',
          status: MatchStatus.LIVE,
          groupId: 'group-1',
          dataSource: MatchDataSource.API,
          dataMode: 'MANUAL',
          pcobMode: false,
          pcobSessionId: 'session-1',
          adapterKey: 'pubgm-pcob',
          matchSlots: [],
          group: { id: 'group-1' },
          tournament: { organizationId: 'org-1' },
          controlState: { state: 'LIVE' },
        }),
        update: jest.fn(),
      },
      feedLock: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn(),
      },
    } as any;
    const health = { setClient: jest.fn() } as any;
    const service = createService(prisma, health);

    await expect(
      service.bind('org-1', 'match-1', 'client-1', 'session-1'),
    ).rejects.toThrow(
      'Legacy PCOB control is disabled for API and MANUAL matches',
    );

    expect(prisma.feedLock.upsert).not.toHaveBeenCalled();
    expect(prisma.match.update).not.toHaveBeenCalled();
    expect(health.setClient).not.toHaveBeenCalled();
  });

  it('allows legacy bind for an explicit PCOB match', async () => {
    const prisma = {
      match: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'match-1',
          status: MatchStatus.LIVE,
          groupId: 'group-1',
          dataSource: MatchDataSource.PCOB,
          dataMode: 'PCOB',
          pcobMode: true,
          pcobSessionId: 'session-1',
          adapterKey: 'pubgm-pcob',
          matchSlots: [],
          group: { id: 'group-1' },
          tournament: { organizationId: 'org-1' },
          controlState: { state: 'LIVE' },
        }),
        update: jest.fn(),
      },
      feedLock: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn(),
      },
    } as any;
    const health = { setClient: jest.fn() } as any;
    const service = createService(prisma, health);

    await expect(
      service.bind('org-1', 'match-1', 'client-1', 'session-1'),
    ).resolves.toEqual(
      expect.objectContaining({
        ok: true,
        matchId: 'match-1',
        pcobSessionId: 'session-1',
      }),
    );

    expect(prisma.feedLock.upsert).toHaveBeenCalled();
    expect(prisma.match.update).toHaveBeenCalledWith({
      where: { id: 'match-1' },
      data: { pcobBoundAt: expect.any(Date) },
    });
    expect(health.setClient).toHaveBeenCalledWith('match-1', 'client-1');
  });

  it('rejects legacy feed start for an API-bound pubgm-pcob match', async () => {
    const prisma = {
      match: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'match-1',
          status: MatchStatus.LIVE,
          groupId: 'group-1',
          dataSource: MatchDataSource.API,
          dataMode: 'MANUAL',
          pcobMode: false,
          pcobSessionId: 'session-1',
          adapterKey: 'pubgm-pcob',
          matchSlots: [],
          group: { id: 'group-1' },
          tournament: { organizationId: 'org-1' },
          controlState: { state: 'LIVE' },
        }),
      },
      feedLock: {
        findUnique: jest.fn(),
        upsert: jest.fn(),
      },
    } as any;
    const service = createService(prisma);

    await expect(
      service.startFeed('org-1', 'match-1', 'client-1'),
    ).rejects.toThrow(
      'Legacy PCOB control is disabled for API and MANUAL matches',
    );

    expect(prisma.feedLock.findUnique).not.toHaveBeenCalled();
    expect(prisma.feedLock.upsert).not.toHaveBeenCalled();
  });
});
