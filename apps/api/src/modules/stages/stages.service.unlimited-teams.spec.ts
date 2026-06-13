import { StagesService } from './stages.service';

describe('StagesService unlimited team assignment', () => {
  it('allows assigning more teams than stage.maxTeams', async () => {
    const prisma = {
      stage: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'stage-1',
          tournamentId: 'tournament-1',
          organizationId: 'org-1',
          maxTeams: 1,
        }),
      },
      tournamentTeam: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: 'team-1' }, { id: 'team-2' }]),
      },
      stageTeam: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'stage-team-1', tournamentTeamId: 'team-1' },
          { id: 'stage-team-2', tournamentTeamId: 'team-2' },
        ]),
      },
      $transaction: jest.fn(async (callback) =>
        callback({
          stageTeam: {
            deleteMany: jest.fn(),
            createMany: jest.fn(),
          },
        }),
      ),
    };
    const audit = { log: jest.fn() };
    const service = new StagesService(prisma as never, audit as never);

    await expect(
      service.setTeams('stage-1', 'org-1', ['team-1', 'team-2'], 'user-1'),
    ).resolves.toEqual({
      stageTeams: [
        { id: 'stage-team-1', tournamentTeamId: 'team-1', team: null },
        { id: 'stage-team-2', tournamentTeamId: 'team-2', team: null },
      ],
    });

    expect(prisma.tournamentTeam.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { in: ['team-1', 'team-2'] },
        }),
      }),
    );
  });
});
