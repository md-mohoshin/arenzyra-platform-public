import { LiveState } from '@prisma/client';
import type { PrismaService } from '../../db/prisma.service';
import { LiveStateRepairService } from './live-state-repair.service';

describe('LiveStateRepairService', () => {
  const originalEnabled = process.env.LIVE_STATE_REPAIR_ENABLED;

  afterEach(() => {
    if (originalEnabled === undefined) {
      delete process.env.LIVE_STATE_REPAIR_ENABLED;
    } else {
      process.env.LIVE_STATE_REPAIR_ENABLED = originalEnabled;
    }
    jest.clearAllMocks();
  });

  it('repairs stale group, stage, and tournament live states from match control state', async () => {
    const prisma = {
      group: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'group-1',
            stageId: 'stage-1',
            liveState: LiveState.LIVE,
            liveAt: new Date('2026-04-17T17:14:10.505Z'),
            endedAt: null,
            matches: [
              { controlState: { state: 'CONFIRMED' } },
              { controlState: { state: 'ENDED' } },
            ],
          },
        ]),
        update: jest.fn().mockResolvedValue(undefined),
      },
      stage: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'stage-1',
            tournamentId: 'tournament-1',
            liveState: LiveState.LIVE,
            liveAt: new Date('2026-04-17T17:14:10.505Z'),
            endedAt: null,
            matches: [],
          },
        ]),
        update: jest.fn().mockResolvedValue(undefined),
      },
      tournament: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'tournament-1',
            liveState: LiveState.LIVE,
            liveAt: new Date('2026-04-17T17:14:10.505Z'),
            endedAt: null,
            matches: [
              { controlState: { state: 'CONFIRMED' } },
              { controlState: { state: 'ENDED' } },
            ],
          },
        ]),
        update: jest.fn().mockResolvedValue(undefined),
      },
    } as unknown as PrismaService;

    const service = new LiveStateRepairService(prisma);

    const result = await service.reconcile('manual');

    expect(result).toMatchObject({
      groups: 1,
      stages: 1,
      tournaments: 1,
      skipped: false,
    });
    expect((prisma.group.update as jest.Mock).mock.calls[0][0]).toMatchObject({
      where: { id: 'group-1' },
      data: {
        liveState: LiveState.ENDED,
      },
    });
    expect((prisma.stage.update as jest.Mock).mock.calls[0][0]).toMatchObject({
      where: { id: 'stage-1' },
      data: {
        liveState: LiveState.ENDED,
      },
    });
    expect(
      (prisma.tournament.update as jest.Mock).mock.calls[0][0],
    ).toMatchObject({
      where: { id: 'tournament-1' },
      data: {
        liveState: LiveState.ENDED,
      },
    });
  });
});
