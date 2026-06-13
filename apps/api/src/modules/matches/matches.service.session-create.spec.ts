import {
  DataMode,
  MatchDataSource,
  SessionRegistrationStatus,
  TeamBanScope,
} from '@prisma/client';
import { MatchesService } from './matches.service';

describe('MatchesService session creation compatibility', () => {
  const actor = {
    id: 'user-1',
    actorId: 'user-1',
    role: null,
    actorRole: null,
    organizationId: 'org-1',
    actingOrgId: 'org-1',
  };

  const buildService = () => {
    const tx = {
      match: {
        aggregate: jest.fn().mockResolvedValue({ _max: { matchNumber: 2 } }),
        create: jest.fn().mockResolvedValue({
          id: 'match-session-1',
          name: 'Session Match',
          sessionId: 'session-1',
        }),
      },
      sessionRegistration: {
        findMany: jest.fn().mockResolvedValue([
          { teamId: 'team-a', slotNumber: 1 },
          { teamId: 'team-b', slotNumber: 2 },
        ]),
      },
      matchTeam: {
        createMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
      matchSlot: {
        createMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
      teamBan: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };

    const prisma = {
      _dmmf: { modelMap: { Match: { fields: [] } } },
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) =>
        callback(tx),
      ),
    } as any;

    const noop = () => {};
    const service = new MatchesService(
      prisma,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      { emitResultsLockState: jest.fn() } as any,
      {} as any,
      { emitForMatch: noop } as any,
      {} as any,
      {} as any,
      {} as any,
    );

    return { service, prisma, tx };
  };

  it('creates a session-linked match and seeds confirmed registrations', async () => {
    const { service, tx } = buildService();

    jest.spyOn(service as any, 'resolveSessionContext').mockResolvedValue({
      sessionId: 'session-1',
      organizationId: 'org-1',
      slotCount: 2,
    });
    jest
      .spyOn(service as any, 'buildSessionMatchCreateInput')
      .mockResolvedValue({
        id: 'match-session-1',
        name: 'Session Match',
        organizationId: 'org-1',
        sessionId: 'session-1',
        tournamentId: null,
        stageId: null,
        groupId: null,
        slotCount: 2,
        dataMode: DataMode.MANUAL,
        dataSource: MatchDataSource.MANUAL,
      });
    jest
      .spyOn(service as any, 'pruneUnsupportedMatchFields')
      .mockImplementation((value: unknown) => value);
    jest.spyOn(service as any, 'seedControlState').mockResolvedValue(undefined);

    const result = await service.createForSession(actor as any, 'session-1', {
      name: 'Session Match',
    });

    expect(result).toMatchObject({
      id: 'match-session-1',
      sessionId: 'session-1',
    });
    expect(tx.match.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          sessionId: 'session-1',
          tournamentId: null,
          stageId: null,
          groupId: null,
          ownerUserId: 'user-1',
        }),
      }),
    );
    expect(tx.sessionRegistration.findMany).toHaveBeenCalledWith({
      where: {
        sessionId: 'session-1',
        deletedAt: null,
        status: {
          in: [
            SessionRegistrationStatus.CONFIRMED,
            SessionRegistrationStatus.CHECKED_IN,
          ],
        },
      },
      select: {
        teamId: true,
        slotNumber: true,
      },
      orderBy: { slotNumber: 'asc' },
    });
    expect(tx.sessionRegistration.findMany).toHaveBeenCalledTimes(1);
    expect(tx.teamBan.findMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        organizationId: 'org-1',
        teamId: { in: ['team-a', 'team-b'] },
        revokedAt: null,
        AND: [
          {
            OR: [
              { scope: TeamBanScope.TEAM },
              { scope: TeamBanScope.SESSION, sessionId: 'session-1' },
            ],
          },
        ],
      }),
      select: { teamId: true },
    });
    expect(tx.matchTeam.createMany).toHaveBeenCalledWith({
      data: [
        { matchId: 'match-session-1', teamId: 'team-a', slot: null },
        { matchId: 'match-session-1', teamId: 'team-b', slot: null },
      ],
      skipDuplicates: true,
    });
    expect(tx.matchSlot.createMany).not.toHaveBeenCalled();
  });

  it('does not seed teams that are actively banned from the scrim', async () => {
    const { service, tx } = buildService();

    tx.teamBan.findMany.mockResolvedValue([{ teamId: 'team-b' }]);

    jest.spyOn(service as any, 'resolveSessionContext').mockResolvedValue({
      sessionId: 'session-1',
      organizationId: 'org-1',
      slotCount: 2,
    });
    jest
      .spyOn(service as any, 'buildSessionMatchCreateInput')
      .mockResolvedValue({
        id: 'match-session-1',
        name: 'Session Match',
        organizationId: 'org-1',
        sessionId: 'session-1',
        tournamentId: null,
        stageId: null,
        groupId: null,
        slotCount: 2,
        dataMode: DataMode.MANUAL,
        dataSource: MatchDataSource.MANUAL,
      });
    jest
      .spyOn(service as any, 'pruneUnsupportedMatchFields')
      .mockImplementation((value: unknown) => value);
    jest.spyOn(service as any, 'seedControlState').mockResolvedValue(undefined);

    await service.createForSession(actor as any, 'session-1', {
      name: 'Session Match',
    });

    expect(tx.matchTeam.createMany).toHaveBeenCalledWith({
      data: [{ matchId: 'match-session-1', teamId: 'team-a', slot: null }],
      skipDuplicates: true,
    });
    expect(tx.matchSlot.createMany).not.toHaveBeenCalled();
  });

  it('treats the seeded lobby as a snapshot and does not re-read registrations after creation', async () => {
    const { service, tx } = buildService();

    jest.spyOn(service as any, 'resolveSessionContext').mockResolvedValue({
      sessionId: 'session-1',
      organizationId: 'org-1',
      slotCount: 2,
    });
    jest
      .spyOn(service as any, 'buildSessionMatchCreateInput')
      .mockResolvedValue({
        id: 'match-session-2',
        name: 'Snapshot Match',
        organizationId: 'org-1',
        sessionId: 'session-1',
        tournamentId: null,
        stageId: null,
        groupId: null,
        slotCount: 2,
        dataMode: DataMode.MANUAL,
        dataSource: MatchDataSource.MANUAL,
      });
    jest
      .spyOn(service as any, 'pruneUnsupportedMatchFields')
      .mockImplementation((value: unknown) => value);
    jest.spyOn(service as any, 'seedControlState').mockResolvedValue(undefined);

    await service.createForSession(actor as any, 'session-1', {
      name: 'Snapshot Match',
    });

    expect(tx.sessionRegistration.findMany).toHaveBeenCalledTimes(1);
    expect(tx.matchTeam.createMany).toHaveBeenCalledTimes(1);
    expect(tx.matchSlot.createMany).not.toHaveBeenCalled();
  });

  it('loads event teams as candidates without pre-assigning session slot numbers', async () => {
    const { service, tx } = buildService();

    tx.sessionRegistration.findMany.mockResolvedValue([
      { teamId: 'team-a', slotNumber: 3 },
      { teamId: 'team-b', slotNumber: 5 },
    ]);

    jest.spyOn(service as any, 'resolveSessionContext').mockResolvedValue({
      sessionId: 'session-1',
      organizationId: 'org-1',
      slotCount: 25,
    });
    jest
      .spyOn(service as any, 'buildSessionMatchCreateInput')
      .mockResolvedValue({
        id: 'match-session-3',
        name: 'Slot Snapshot Match',
        organizationId: 'org-1',
        sessionId: 'session-1',
        tournamentId: null,
        stageId: null,
        groupId: null,
        slotCount: 25,
        dataMode: DataMode.MANUAL,
        dataSource: MatchDataSource.MANUAL,
      });
    jest
      .spyOn(service as any, 'pruneUnsupportedMatchFields')
      .mockImplementation((value: unknown) => value);
    jest.spyOn(service as any, 'seedControlState').mockResolvedValue(undefined);

    await service.createForSession(actor as any, 'session-1', {
      name: 'Slot Snapshot Match',
    });

    expect(tx.matchTeam.createMany).toHaveBeenCalledWith({
      data: [
        { matchId: 'match-session-1', teamId: 'team-a', slot: null },
        { matchId: 'match-session-1', teamId: 'team-b', slot: null },
      ],
      skipDuplicates: true,
    });
    expect(tx.matchSlot.createMany).not.toHaveBeenCalled();
  });

  it('keeps the existing tournament create flow delegating through group context', async () => {
    const { service } = buildService();
    const ctx = { groupId: 'group-1', tournamentId: 'tournament-1' };

    jest.spyOn(service as any, 'resolveGroupContext').mockResolvedValue(ctx);
    jest.spyOn(service as any, 'buildMatchCreateInput').mockResolvedValue({
      id: 'match-1',
      groupId: 'group-1',
      tournamentId: 'tournament-1',
    });
    jest
      .spyOn(service as any, 'createMatchWithTeams')
      .mockResolvedValue({ id: 'match-1' });

    const result = await service.create(
      'tournament-1',
      { groupId: 'group-1', name: 'Tournament Match' },
      actor as any,
    );

    expect(result).toEqual(
      expect.objectContaining({
        id: 'match-1',
      }),
    );
    expect((service as any).resolveGroupContext).toHaveBeenCalledWith(
      actor,
      'group-1',
      'tournament-1',
    );
    expect((service as any).buildMatchCreateInput).toHaveBeenCalledWith(
      expect.objectContaining({ groupId: 'group-1' }),
      ctx,
    );
    expect((service as any).createMatchWithTeams).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({ tournamentId: 'tournament-1' }),
    );
  });
});
