import { resolveOrganizationLiveMatchConflicts } from './live-match-conflict.util';

describe('resolveOrganizationLiveMatchConflicts', () => {
  it('keeps the most recent live match and ends older live matches in the same organization', async () => {
    const matchUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
    const controlUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      match: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'match-old',
            liveAt: new Date('2026-03-16T00:10:00.000Z'),
            startedAt: new Date('2026-03-16T00:05:00.000Z'),
            updatedAt: new Date('2026-03-16T00:11:00.000Z'),
            createdAt: new Date('2026-03-16T00:00:00.000Z'),
          },
          {
            id: 'match-new',
            liveAt: new Date('2026-03-16T00:20:00.000Z'),
            startedAt: new Date('2026-03-16T00:18:00.000Z'),
            updatedAt: new Date('2026-03-16T00:21:00.000Z'),
            createdAt: new Date('2026-03-16T00:15:00.000Z'),
          },
        ]),
        updateMany: matchUpdateMany,
      },
      matchControlState: {
        updateMany: controlUpdateMany,
      },
      $transaction: jest
        .fn()
        .mockImplementation(async (ops) => Promise.all(ops)),
    } as any;

    const result = await resolveOrganizationLiveMatchConflicts(prisma, 'org-1');

    expect(result).toEqual({
      keptId: 'match-new',
      endedIds: ['match-old'],
    });
    expect(matchUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: ['match-old'] } },
      data: expect.objectContaining({
        status: 'ENDED',
        liveState: 'ENDED',
        endedReason: 'LIVE_CONFLICT_RESOLUTION',
      }),
    });
    expect(controlUpdateMany).toHaveBeenCalledWith({
      where: { matchId: { in: ['match-old'] } },
      data: expect.objectContaining({
        state: 'ENDED',
        reason: 'LIVE_CONFLICT_RESOLUTION',
      }),
    });
  });

  it('does nothing when the organization already has a single live match', async () => {
    const prisma = {
      match: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'match-1',
            liveAt: new Date('2026-03-16T00:20:00.000Z'),
            startedAt: new Date('2026-03-16T00:18:00.000Z'),
            updatedAt: new Date('2026-03-16T00:21:00.000Z'),
            createdAt: new Date('2026-03-16T00:15:00.000Z'),
          },
        ]),
        updateMany: jest.fn(),
      },
      matchControlState: {
        updateMany: jest.fn(),
      },
      $transaction: jest.fn(),
    } as any;

    const result = await resolveOrganizationLiveMatchConflicts(prisma, 'org-1');

    expect(result).toEqual({
      keptId: 'match-1',
      endedIds: [],
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.match.updateMany).not.toHaveBeenCalled();
    expect(prisma.matchControlState.updateMany).not.toHaveBeenCalled();
  });
});
