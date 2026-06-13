import { GroupsService } from './groups.service';

describe('GroupsService unlimited team assignment', () => {
  it('allows replacing group teams with more teams than group.maxTeams', async () => {
    const group = {
      id: 'group-1',
      stageId: 'stage-1',
      maxTeams: 1,
      deletedAt: null,
      stage: {
        id: 'stage-1',
        tournamentId: 'tournament-1',
        tournament: { id: 'tournament-1', organizationId: 'org-1' },
      },
    };
    const prisma = {
      tournament: { update: jest.fn() },
      group: {
        findFirst: jest.fn().mockResolvedValue(group),
      },
      tournamentTeam: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: 'team-1' }, { id: 'team-2' }]),
      },
      stageTeam: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { tournamentTeamId: 'team-1' },
            { tournamentTeamId: 'team-2' },
          ]),
      },
      groupTeam: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([
            { id: 'group-team-1', tournamentTeamId: 'team-1' },
            { id: 'group-team-2', tournamentTeamId: 'team-2' },
          ]),
      },
      $transaction: jest.fn(async (callback) =>
        callback({
          groupTeam: {
            updateMany: jest.fn().mockResolvedValue({ count: 0 }),
            create: jest.fn(),
          },
        }),
      ),
    };
    const audit = { log: jest.fn() };
    const service = new GroupsService(prisma as never, audit as never);

    await expect(
      service.replaceTeams('org-1', 'group-1', ['team-1', 'team-2'], 'user-1'),
    ).resolves.toEqual([
      { id: 'group-team-1', tournamentTeamId: 'team-1' },
      { id: 'group-team-2', tournamentTeamId: 'team-2' },
    ]);

    expect(prisma.tournamentTeam.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { in: ['team-1', 'team-2'] },
        }),
      }),
    );
  });
});
