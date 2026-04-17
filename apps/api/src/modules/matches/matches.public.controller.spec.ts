import { LiveState, MatchStatus } from '@prisma/client';
import { MatchesPublicController } from './matches.public.controller';

describe('MatchesPublicController', () => {
  it('queries only active live matches for the public live-match endpoint', async () => {
    const prisma = {
      match: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'match-live',
          status: MatchStatus.LIVE,
        }),
      },
    } as any;

    const controller = new MatchesPublicController(prisma);

    await expect(controller.getLiveMatch()).resolves.toEqual({
      matchId: 'match-live',
      status: MatchStatus.LIVE,
    });

    expect(prisma.match.findFirst).toHaveBeenCalledWith({
      where: {
        status: MatchStatus.LIVE,
        deletedAt: null,
        endedAt: null,
        liveState: { not: LiveState.ENDED },
      },
      orderBy: [
        { liveAt: 'desc' },
        { startedAt: 'desc' },
        { updatedAt: 'desc' },
      ],
      select: { id: true, status: true },
    });
  });

  it('returns an empty payload when no active live match exists', async () => {
    const prisma = {
      match: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
    } as any;

    const controller = new MatchesPublicController(prisma);

    await expect(controller.getLiveMatch()).resolves.toEqual({
      matchId: null,
      status: null,
    });
  });
});
