import {
  DataMode,
  GameKey,
  LobbyStatus,
  MatchDataSource,
  MatchStatus,
  MatchTeamStatus,
} from '@prisma/client';
import { MatchesService } from './matches.service';

const actor = {
  id: 'u-1',
  actorId: 'u-1',
  role: null,
  actorRole: null,
  organizationId: 'org-1',
  actingOrgId: 'org-1',
};

describe('MatchesService event match slots', () => {
  const buildService = () => {
    const tx = {};
    const prisma = {
      _dmmf: { modelMap: { Match: { fields: [] } } },
      matchTeam: {
        findFirst: jest.fn(),
      },
      matchSlot: {
        findFirst: jest.fn(),
      },
      sessionRegistration: {
        findFirst: jest.fn(),
      },
      $transaction: jest
        .fn()
        .mockImplementation(
          async (callback: (client: typeof tx) => Promise<void> | void) =>
            callback(tx),
        ),
    } as any;

    const service = new MatchesService(
      prisma,
      {} as any,
      {} as any,
      {
        getAdapterByKey: jest.fn().mockReturnValue(null),
      } as any,
      {} as any,
      {
        ensureResultsFromSlots: jest.fn(),
        recomputeAllSlots: jest.fn(),
      } as any,
      {
        emitResultsLockState: jest.fn(),
      } as any,
      {} as any,
      {
        emitForMatch: jest.fn(),
      } as any,
      {} as any,
      {} as any,
      {} as any,
    );

    const match: any = {
      id: 'm-session-1',
      organizationId: 'org-1',
      ownerUserId: 'u-1',
      tournamentId: null,
      sessionId: 'session-1',
      stageId: null,
      groupId: null,
      matchNumber: 1,
      adapterKey: null,
      status: MatchStatus.DRAFT,
      slotCount: 25,
      liveState: null,
      dataSource: MatchDataSource.MANUAL,
      dataMode: DataMode.MANUAL,
      controlState: { state: null },
      game: { key: GameKey.PUBG_MOBILE },
      tournament: null,
    };
    const capability = {
      usesSlots: true,
      maxSlots: 25,
      adapterKey: null,
      gameKey: GameKey.PUBG_MOBILE,
    };

    jest
      .spyOn(service as any, 'getSlotContext')
      .mockResolvedValue({ match, capability });
    jest
      .spyOn(service as any, 'applySlotAssignmentInTransaction')
      .mockResolvedValue(undefined);
    jest.spyOn(service as any, 'logSlotAudit').mockResolvedValue(undefined);
    jest
      .spyOn(service as any, 'notifyLobbyContractChanged')
      .mockResolvedValue(undefined);
    jest.spyOn(service, 'listSlots').mockResolvedValue([] as any);

    return {
      service,
      prisma,
      match,
      applySlotAssignmentInTransaction: (service as any)
        .applySlotAssignmentInTransaction as jest.Mock,
    };
  };

  it('allows assigned event teams to be placed without a tournament group', async () => {
    const { service, prisma, match, applySlotAssignmentInTransaction } =
      buildService();
    prisma.matchTeam.findFirst.mockResolvedValue({ id: 'match-team-1' });

    await expect(
      service.setSlot('m-session-1', 1, 'team-1', actor),
    ).resolves.toEqual([]);

    expect(prisma.matchTeam.findFirst).toHaveBeenCalledWith({
      where: { matchId: 'm-session-1', teamId: 'team-1', deletedAt: null },
      select: { id: true },
    });
    expect(prisma.matchSlot.findFirst).not.toHaveBeenCalled();
    expect(prisma.sessionRegistration.findFirst).not.toHaveBeenCalled();
    expect(applySlotAssignmentInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      match,
      1,
      'team-1',
    );
  });

  it('allows event teams that only exist in the current slot snapshot', async () => {
    const { service, prisma, applySlotAssignmentInTransaction } =
      buildService();
    prisma.matchTeam.findFirst.mockResolvedValue(null);
    prisma.matchSlot.findFirst.mockResolvedValue({ id: 'slot-1' });

    await service.setSlot('m-session-1', 2, 'team-2', actor);

    expect(prisma.matchSlot.findFirst).toHaveBeenCalledWith({
      where: { matchId: 'm-session-1', teamId: 'team-2', deletedAt: null },
      select: { id: true },
    });
    expect(applySlotAssignmentInTransaction).toHaveBeenCalled();
  });

  it('allows confirmed event registration teams before they are assigned to a match slot', async () => {
    const { service, prisma, applySlotAssignmentInTransaction } =
      buildService();
    prisma.matchTeam.findFirst.mockResolvedValue(null);
    prisma.matchSlot.findFirst.mockResolvedValue(null);
    prisma.sessionRegistration.findFirst.mockResolvedValue({
      id: 'registration-1',
    });

    await service.setSlot('m-session-1', 3, 'team-registered', actor);

    expect(prisma.sessionRegistration.findFirst).toHaveBeenCalledWith({
      where: {
        sessionId: 'session-1',
        organizationId: 'org-1',
        teamId: 'team-registered',
        deletedAt: null,
        status: {
          in: ['CONFIRMED', 'CHECKED_IN'],
        },
      },
      select: { id: true },
    });
    expect(applySlotAssignmentInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: 'm-session-1' }),
      3,
      'team-registered',
    );
  });

  it('creates a match-team slot mirror for late event teams', async () => {
    const { service } = buildService();
    const tx = {
      matchTeam: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        upsert: jest.fn().mockResolvedValue({ id: 'match-team-late' }),
      },
    } as any;

    await (service as any).setMatchTeamSlotMirrorInTransaction(
      tx,
      'm-session-1',
      'team-late',
      21,
    );

    expect(tx.matchTeam.updateMany).toHaveBeenCalledWith({
      where: {
        matchId: 'm-session-1',
        OR: [{ teamId: 'team-late' }, { slot: 21 }],
      },
      data: { slot: null },
    });
    expect(tx.matchTeam.upsert).toHaveBeenCalledWith({
      where: {
        matchId_teamId: {
          matchId: 'm-session-1',
          teamId: 'team-late',
        },
      },
      update: {
        slot: 21,
        status: MatchTeamStatus.ACTIVE,
        deletedAt: null,
      },
      create: {
        matchId: 'm-session-1',
        teamId: 'team-late',
        slot: 21,
        status: MatchTeamStatus.ACTIVE,
      },
    });
  });

  it('creates match-team mirrors when rebuilding from match slots', async () => {
    const { service } = buildService();
    const tx = {
      matchSlot: {
        findMany: jest.fn().mockResolvedValue([
          { teamId: 'team-late', slotNumber: 21 },
          { teamId: 'team-other', slotNumber: 22 },
        ]),
      },
      matchTeam: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        upsert: jest.fn().mockResolvedValue({ id: 'match-team-late' }),
      },
    } as any;

    await (service as any).syncMatchTeamSlotMirrorFromSlotsInTransaction(
      tx,
      'm-session-1',
    );

    expect(tx.matchTeam.updateMany).toHaveBeenCalledWith({
      where: { matchId: 'm-session-1', slot: { not: null } },
      data: { slot: null },
    });
    expect(tx.matchTeam.upsert).toHaveBeenCalledWith({
      where: {
        matchId_teamId: {
          matchId: 'm-session-1',
          teamId: 'team-late',
        },
      },
      update: {
        slot: 21,
        status: MatchTeamStatus.ACTIVE,
        deletedAt: null,
      },
      create: {
        matchId: 'm-session-1',
        teamId: 'team-late',
        slot: 21,
        status: MatchTeamStatus.ACTIVE,
      },
    });
    expect(tx.matchTeam.upsert).toHaveBeenCalledWith({
      where: {
        matchId_teamId: {
          matchId: 'm-session-1',
          teamId: 'team-other',
        },
      },
      update: {
        slot: 22,
        status: MatchTeamStatus.ACTIVE,
        deletedAt: null,
      },
      create: {
        matchId: 'm-session-1',
        teamId: 'team-other',
        slot: 22,
        status: MatchTeamStatus.ACTIVE,
      },
    });
  });

  it('rejects event teams that are not assigned to the match', async () => {
    const { service, prisma } = buildService();
    prisma.matchTeam.findFirst.mockResolvedValue(null);
    prisma.matchSlot.findFirst.mockResolvedValue(null);
    prisma.sessionRegistration.findFirst.mockResolvedValue(null);

    await expect(
      service.setSlot('m-session-1', 1, 'team-3', actor),
    ).rejects.toThrow('Team must be assigned to this event match first');

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('keeps tournament slot assignment tied to a group', async () => {
    const { service, match } = buildService();
    match.tournamentId = 'tournament-1';
    match.sessionId = null;
    match.tournament = {
      ownerUserId: 'u-1',
      organizationId: 'org-1',
      game: GameKey.PUBG_MOBILE,
    };

    await expect(
      service.setSlot('m-session-1', 1, 'team-1', actor),
    ).rejects.toThrow('Match must belong to a group to assign slots');
  });

  it('lists confirmed event registrations as unassigned match teams', async () => {
    const prisma = {
      _dmmf: { modelMap: { Match: { fields: [] } } },
      match: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'm-session-1',
          organizationId: 'org-1',
          ownerUserId: 'u-1',
          tournamentId: null,
          sessionId: 'session-1',
          groupId: null,
          tournament: null,
          matchSlots: [],
        }),
      },
      sessionRegistration: {
        findMany: jest.fn().mockResolvedValue([
          {
            teamId: 'team-registered',
            slotNumber: 7,
            team: {
              id: 'team-registered',
              name: 'Registered Team',
              tag: 'REG',
              logoUrl: null,
            },
          },
        ]),
      },
      matchTeam: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      matchSlot: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      matchSlotResult: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    } as any;
    const service = new MatchesService(
      prisma,
      {} as any,
      {} as any,
      {
        getAdapterByKey: jest.fn().mockReturnValue(null),
      } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

    const teams = await service.listTeams(actor, 'm-session-1');

    expect(prisma.sessionRegistration.findMany).toHaveBeenCalledWith({
      where: {
        sessionId: 'session-1',
        organizationId: 'org-1',
        deletedAt: null,
        status: {
          in: ['CONFIRMED', 'CHECKED_IN'],
        },
      },
      include: {
        team: {
          select: { id: true, name: true, tag: true, logoUrl: true },
        },
      },
      orderBy: [{ slotNumber: 'asc' }, { createdAt: 'asc' }],
    });
    expect(teams).toEqual([
      expect.objectContaining({
        slot: null,
        teamId: 'team-registered',
        teamName: 'Registered Team',
        teamTag: 'REG',
      }),
    ]);
  });

  it('returns empty placeholders for every slot in the match layout', async () => {
    const prisma = {
      _dmmf: { modelMap: { Match: { fields: [] } } },
      matchSlot: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'slot-3',
            matchId: 'm-session-1',
            slotNumber: 3,
            teamId: 'team-1',
            lobbyStatus: LobbyStatus.OFFLINE,
            playersInLobby: 0,
            team: {
              id: 'team-1',
              name: 'Team One',
              tag: 'ONE',
              logoUrl: null,
            },
          },
        ]),
      },
    } as any;
    const service = new MatchesService(
      prisma,
      {} as any,
      {} as any,
      {
        getAdapterByKey: jest.fn().mockReturnValue(null),
      } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    jest.spyOn(service as any, 'getSlotContext').mockResolvedValue({
      match: {
        id: 'm-session-1',
        slotCount: 5,
        dataSource: MatchDataSource.MANUAL,
        dataMode: DataMode.MANUAL,
      },
      capability: {
        usesSlots: true,
        maxSlots: 25,
        gameKey: GameKey.PUBG_MOBILE,
      },
    });

    const slots = await service.listSlots(actor, 'm-session-1');

    expect(slots.map((slot) => slot.slotNumber)).toEqual([1, 2, 3, 4, 5]);
    expect(slots[0]).toMatchObject({
      id: null,
      matchId: 'm-session-1',
      slotNumber: 1,
      teamId: null,
      lobbyStatus: LobbyStatus.EMPTY,
      team: null,
    });
    expect(slots[2]).toMatchObject({
      id: 'slot-3',
      slotNumber: 3,
      teamId: 'team-1',
    });
  });
});
