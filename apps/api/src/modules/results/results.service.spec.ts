import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../../db/prisma.service';
import type { ResultsEventsService } from './results-events.service';
import type { StandingsService } from '../standings/standings.service';
import type { AuditService } from '../audit/audit.service';
import { ResultsService } from './results.service';
import { Role } from '@prisma/client';

const readJsonLogPayload = (value: unknown): Record<string, unknown> => {
  if (typeof value !== 'string') {
    return {};
  }
  return JSON.parse(value) as Record<string, unknown>;
};

class PrismaMock {
  slot: {
    id: string;
    matchId: string;
    slotNumber: number;
    placement: number | null;
    placementPoints: number;
    totalKills: number;
    totalPoints: number;
    teamId: string;
    organizationId: string;
    manualTotalKills: boolean;
    wasPresentInMatch: boolean | null;
    players: Array<Record<string, unknown>>;
  } = {
    id: 'sr-1',
    matchId: 'm-1',
    slotNumber: 1,
    placement: 2,
    placementPoints: 0,
    totalKills: 3,
    totalPoints: 0,
    teamId: 'team-1',
    organizationId: 'org-1',
    manualTotalKills: true,
    wasPresentInMatch: true,
    players: [],
  };

  matchSlotResult = {
    findUnique: (args: Prisma.MatchSlotResultFindUniqueArgs) => {
      if (args.where?.matchId_slotNumber) {
        const { matchId, slotNumber } = args.where.matchId_slotNumber as {
          matchId: string;
          slotNumber: number;
        };
        if (
          matchId === this.slot.matchId &&
          slotNumber === this.slot.slotNumber
        )
          return Promise.resolve({ ...this.slot });
      }
      if (args.where?.id === this.slot.id) {
        return Promise.resolve({ ...this.slot });
      }
      return Promise.resolve(null);
    },
    update: (args: Prisma.MatchSlotResultUpdateArgs) => {
      if (args.where?.id === this.slot.id) {
        this.slot = {
          ...this.slot,
          ...(args.data as unknown as Partial<typeof this.slot>),
        };
        return Promise.resolve({ ...this.slot });
      }
      return Promise.resolve(null);
    },
    findMany: (args?: Prisma.MatchSlotResultFindManyArgs) => {
      const matchId =
        args?.where && 'matchId' in args.where
          ? (args.where as { matchId?: string }).matchId
          : undefined;
      if (matchId === this.slot.matchId) {
        return Promise.resolve([{ ...this.slot }]);
      }
      return Promise.resolve([]);
    },
    deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
  };

  matchSlotPlayerResult = {
    deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
  };

  matchPlayer = {
    upsert: jest.fn().mockResolvedValue(undefined),
    deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
  };

  match = {
    findFirst: () =>
      Promise.resolve({
        rulesetId: null,
        game: { key: 'PUBG_MOBILE' },
        tournament: {
          rulesetId: null,
          game: 'PUBG_MOBILE',
          organizationId: 'org-1',
        },
      }),
    findUnique: (args: Prisma.MatchFindUniqueArgs) =>
      Promise.resolve(
        args.where?.id === 'm-1'
          ? {
              id: 'm-1',
              tournamentId: 'tour-1',
              tournament: { organizationId: 'org-1' },
              slotCount: 25,
              adapterKey: null,
            }
          : null,
      ),
  };

  ruleset = {
    findUnique: () => Promise.resolve(null),
    findFirst: () => Promise.resolve(null),
  };

  matchSlot = {
    findMany: () => Promise.resolve([]),
  };
}

const dummyEvents = {
  emitResultsUpdated: jest.fn(),
  emitLeaderboardUpdated: jest.fn(),
} as Pick<
  ResultsEventsService,
  'emitResultsUpdated' | 'emitLeaderboardUpdated'
>;
const dummyStandings = {
  canEditResults: jest.fn().mockResolvedValue({ canEdit: true }),
} as Pick<StandingsService, 'canEditResults'>;
const dummyAudit = { log: jest.fn() } as Pick<AuditService, 'log'>;
const dummyMatchControl = {
  detectMatchFinish: jest.fn().mockResolvedValue(undefined),
} as any;

describe('ResultsService match status handling', () => {
  const prisma = {
    matchSlotResult: { findFirst: jest.fn().mockResolvedValue(null) },
  } as unknown as PrismaService;

  const service = new ResultsService(
    prisma,
    dummyEvents as ResultsEventsService,
    dummyStandings as StandingsService,
    dummyAudit as AuditService,
    dummyMatchControl,
  );

  const endedMatch = {
    id: 'm-1',
    status: 'ENDED',
    controlState: null,
    tournament: { organizationId: 'org-1', ownerUserId: 'owner-1' },
  } as any;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('allows organizer editing ENDED match', async () => {
    await expect(
      service.ensureResultsEditable(endedMatch, {
        id: 'user-1',
        actorId: 'user-1',
        role: Role.ORGANIZER,
        actorRole: Role.ORGANIZER,
      } as any),
    ).resolves.not.toThrow();
    expect(dummyAudit.log).not.toHaveBeenCalled();
  });

  it('allows manual-source editing even after results are finalized', async () => {
    const manualFinishedMatch = {
      id: 'm-1',
      status: 'FINISHED',
      liveState: 'ENDED',
      dataSource: 'MANUAL',
      dataMode: 'MANUAL',
      controlState: {
        state: 'CONFIRMED',
        resultsManualLock: false,
        resultsForceUnlock: false,
        metaJson: {
          resultFinalized: true,
        },
      },
      tournament: { organizationId: 'org-1', ownerUserId: 'owner-1' },
    } as any;

    await expect(
      service.ensureResultsEditable(manualFinishedMatch, {
        id: 'user-1',
        actorId: 'user-1',
        role: Role.ORGANIZER,
        actorRole: Role.ORGANIZER,
      } as any),
    ).resolves.not.toThrow();
  });

  it('allows finalized automatic results after explicit reopen', async () => {
    const reopenedAutomaticMatch = {
      id: 'm-1',
      status: 'FINISHED',
      liveState: 'ENDED',
      dataSource: 'PCOB',
      dataMode: 'MANUAL',
      controlState: {
        state: 'CONFIRMED',
        resultsManualLock: false,
        resultsForceUnlock: true,
        metaJson: {
          resultFinalized: true,
        },
      },
      tournament: { organizationId: 'org-1', ownerUserId: 'owner-1' },
    } as any;

    await expect(
      service.ensureResultsEditable(reopenedAutomaticMatch, {
        id: 'user-1',
        actorId: 'user-1',
        role: Role.ORGANIZER,
        actorRole: Role.ORGANIZER,
      } as any),
    ).resolves.not.toThrow();
  });
});

describe('ResultsService.ensureMatch access', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('allows an organizer in the tournament organization to edit match results', async () => {
    const prisma = {
      match: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'm-1',
          organizationId: null,
          sessionId: null,
          map: 'erangel',
          status: 'LIVE',
          dataSource: 'MANUAL',
          dataMode: 'MANUAL',
          liveState: 'LIVE',
          endedAt: null,
          game: { key: 'PUBG_MOBILE' },
          controlState: { state: 'LIVE' },
          tournamentId: 'tour-1',
          tournament: {
            ownerUserId: 'owner-1',
            organizationId: 'org-1',
            status: 'ACTIVE',
          },
        }),
      },
    } as unknown as PrismaService;

    const service = new ResultsService(
      prisma,
      dummyEvents as ResultsEventsService,
      dummyStandings as StandingsService,
      dummyAudit as AuditService,
      dummyMatchControl,
    );

    await expect(
      (service as any).ensureMatch(
        {
          id: 'user-1',
          actorId: 'user-1',
          role: Role.ORGANIZER,
          actorRole: Role.ORGANIZER,
          organizationId: 'org-1',
        },
        'm-1',
      ),
    ).resolves.toMatchObject({
      id: 'm-1',
      tournamentId: 'tour-1',
      tournament: {
        ownerUserId: 'owner-1',
        organizationId: 'org-1',
      },
    });
  });

  it('rejects an organizer from a different organization', async () => {
    const prisma = {
      match: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'm-1',
          organizationId: null,
          sessionId: null,
          map: 'erangel',
          status: 'LIVE',
          dataSource: 'MANUAL',
          dataMode: 'MANUAL',
          liveState: 'LIVE',
          endedAt: null,
          game: { key: 'PUBG_MOBILE' },
          controlState: { state: 'LIVE' },
          tournamentId: 'tour-1',
          tournament: {
            ownerUserId: 'owner-1',
            organizationId: 'org-1',
            status: 'ACTIVE',
          },
        }),
      },
    } as unknown as PrismaService;

    const service = new ResultsService(
      prisma,
      dummyEvents as ResultsEventsService,
      dummyStandings as StandingsService,
      dummyAudit as AuditService,
      dummyMatchControl,
    );

    await expect(
      (service as any).ensureMatch(
        {
          id: 'user-2',
          actorId: 'user-2',
          role: Role.ORGANIZER,
          actorRole: Role.ORGANIZER,
          organizationId: 'org-2',
        },
        'm-1',
      ),
    ).rejects.toThrow('Not allowed to access this organization');
  });
});

describe('ResultsService.assertMatchStateConsistency placement safety', () => {
  it('rejects duplicate terminal placements', async () => {
    const prisma = {
      matchSlotResult: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'slot-1',
            matchId: 'm-1',
            slotNumber: 1,
            wasPresentInMatch: true,
            placement: 2,
            totalKills: 0,
            manualTotalKills: false,
            players: [{ kills: 0, isAlive: false }],
          },
          {
            id: 'slot-2',
            matchId: 'm-1',
            slotNumber: 2,
            wasPresentInMatch: true,
            placement: 2,
            totalKills: 0,
            manualTotalKills: false,
            players: [{ kills: 0, isAlive: false }],
          },
        ]),
      },
    } as unknown as PrismaService;

    const service = new ResultsService(
      prisma,
      dummyEvents as ResultsEventsService,
      dummyStandings as StandingsService,
      dummyAudit as AuditService,
      dummyMatchControl,
    );

    await expect(service.assertMatchStateConsistency('m-1')).rejects.toThrow(
      'Duplicate placement 2',
    );
  });

  it('rejects terminal states with missing placements', async () => {
    const prisma = {
      matchSlotResult: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'slot-1',
            matchId: 'm-1',
            slotNumber: 1,
            wasPresentInMatch: true,
            placement: 1,
            totalKills: 1,
            manualTotalKills: false,
            players: [{ kills: 1, isAlive: true }],
          },
          {
            id: 'slot-2',
            matchId: 'm-1',
            slotNumber: 2,
            wasPresentInMatch: true,
            placement: null,
            totalKills: 0,
            manualTotalKills: false,
            players: [{ kills: 0, isAlive: false }],
          },
        ]),
      },
    } as unknown as PrismaService;

    const service = new ResultsService(
      prisma,
      dummyEvents as ResultsEventsService,
      dummyStandings as StandingsService,
      dummyAudit as AuditService,
      dummyMatchControl,
    );

    await expect(service.assertMatchStateConsistency('m-1')).rejects.toThrow(
      'Terminal match state is missing placements',
    );
  });
});

describe('ResultsService.listSlotResultsPublic NO_SHOW projection', () => {
  it('returns explicit NO_SHOW presence status with zeroed competitive fields', async () => {
    const prisma = {
      matchSlotResult: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'slot-active',
            matchId: 'match-1',
            slotNumber: 1,
            teamId: 'team-1',
            wasPresentInMatch: true,
            placement: 1,
            finalPlacement: 1,
            totalKills: 5,
            finalKills: 5,
            points: 15,
            totalPoints: 15,
            team: {
              id: 'team-1',
              name: 'Active Team',
              tag: 'ACT',
              logoUrl: null,
              updatedAt: null,
            },
            players: [],
          },
          {
            id: 'slot-noshow',
            matchId: 'match-1',
            slotNumber: 2,
            teamId: 'team-2',
            wasPresentInMatch: false,
            placement: 20,
            finalPlacement: 20,
            totalKills: 9,
            finalKills: 9,
            points: 29,
            totalPoints: 29,
            team: {
              id: 'team-2',
              name: 'No Show Team',
              tag: 'NS',
              logoUrl: null,
              updatedAt: null,
            },
            players: [
              {
                id: 'player-noshow',
                slotResultId: 'slot-noshow',
                createdAt: new Date(),
                updatedAt: new Date(),
                organizationId: 'org-1',
                playerId: 'player-2',
                playerName: 'Ghost',
                kills: 4,
                knocks: 1,
                isKnocked: true,
                isAlive: true,
                alive: true,
                isAutoFilled: false,
                player: {
                  externalPlayerId: null,
                  ign: 'Ghost',
                  inGameId: null,
                  photoUrl: null,
                  realName: null,
                  updatedAt: null,
                },
              },
            ],
          },
        ]),
      },
    } as unknown as PrismaService;

    const service = new ResultsService(
      prisma,
      dummyEvents as ResultsEventsService,
      dummyStandings as StandingsService,
      dummyAudit as AuditService,
      dummyMatchControl,
    );

    const rows = await service.listSlotResultsPublic('match-1');

    expect(rows.map((row) => row.id)).toEqual(['slot-active', 'slot-noshow']);
    expect(rows[1]).toMatchObject({
      id: 'slot-noshow',
      wasPresentInMatch: false,
      presenceStatus: 'NO_SHOW',
      placement: null,
      finalPlacement: null,
      totalKills: 0,
      finalKills: 0,
      points: 0,
      totalPoints: 0,
    });
    expect(rows[1].players[0]).toMatchObject({
      kills: 0,
      isAlive: null,
      alive: null,
      isKnocked: null,
    });
  });

  it('preserves placement fields for unresolved teams so manual placements remain visible', async () => {
    const prisma = {
      matchSlotResult: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'slot-unresolved',
            matchId: 'match-1',
            slotNumber: 3,
            teamId: 'team-3',
            wasPresentInMatch: null,
            placement: 2,
            finalPlacement: 2,
            totalKills: 7,
            finalKills: 7,
            points: 13,
            totalPoints: 13,
            team: {
              id: 'team-3',
              name: 'Unresolved Team',
              tag: 'UNR',
              logoUrl: null,
              updatedAt: null,
            },
            players: [
              {
                id: 'player-unresolved',
                slotResultId: 'slot-unresolved',
                createdAt: new Date(),
                updatedAt: new Date(),
                organizationId: 'org-1',
                playerId: 'player-3',
                playerName: 'Bravo',
                kills: 3,
                knocks: 1,
                isKnocked: false,
                isAlive: false,
                alive: false,
                isAutoFilled: false,
                player: {
                  externalPlayerId: null,
                  ign: 'Bravo',
                  inGameId: null,
                  photoUrl: null,
                  realName: null,
                  updatedAt: null,
                },
              },
            ],
          },
        ]),
      },
    } as unknown as PrismaService;

    const service = new ResultsService(
      prisma,
      dummyEvents as ResultsEventsService,
      dummyStandings as StandingsService,
      dummyAudit as AuditService,
      dummyMatchControl,
    );

    const rows = await service.listSlotResultsPublic('match-1');

    expect(rows[0]).toMatchObject({
      id: 'slot-unresolved',
      wasPresentInMatch: null,
      presenceStatus: 'UNRESOLVED',
      placement: 2,
      finalPlacement: 2,
      totalKills: 7,
      finalKills: 7,
      totalPoints: 13,
    });
    expect(rows[0].players[0]).toMatchObject({
      kills: 3,
      isAlive: false,
      alive: false,
      isKnocked: false,
    });
  });
});

describe('ResultsService.setPlacements eligibility', () => {
  it('accepts unresolved teams while excluding explicit NO_SHOW slots', async () => {
    const slotUpdates: Array<{ id: string; data: Record<string, unknown> }> =
      [];
    const tx = {
      matchSlotResult: {
        update: jest
          .fn()
          .mockImplementation(
            async (args: Prisma.MatchSlotResultUpdateArgs) => {
              slotUpdates.push({
                id: String(args.where?.id),
                data: args.data as Record<string, unknown>,
              });
              return {
                id: args.where?.id,
                ...(args.data as Record<string, unknown>),
              };
            },
          ),
      },
    };

    const prisma = {
      matchSlotResult: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'slot-active',
            matchId: 'm-1',
            slotNumber: 1,
            teamId: 'team-1',
            organizationId: 'org-1',
            wasPresentInMatch: true,
            placement: null,
            totalKills: 4,
            totalPoints: 0,
            points: 0,
            isLocked: false,
            players: [],
          },
          {
            id: 'slot-unresolved',
            matchId: 'm-1',
            slotNumber: 2,
            teamId: 'team-2',
            organizationId: 'org-1',
            wasPresentInMatch: null,
            placement: null,
            totalKills: 1,
            totalPoints: 0,
            points: 0,
            isLocked: false,
            players: [],
          },
          {
            id: 'slot-noshow',
            matchId: 'm-1',
            slotNumber: 3,
            teamId: 'team-3',
            organizationId: 'org-1',
            wasPresentInMatch: false,
            placement: null,
            totalKills: 0,
            totalPoints: 0,
            points: 0,
            isLocked: false,
            players: [],
          },
        ]),
      },
      $transaction: jest
        .fn()
        .mockImplementation(
          async (callback: (client: typeof tx) => Promise<unknown>) =>
            callback(tx),
        ),
    } as unknown as PrismaService;

    const standings = {
      ...dummyStandings,
      computeMatchStandings: jest.fn().mockResolvedValue(undefined),
    } as unknown as StandingsService;

    const service = new ResultsService(
      prisma,
      dummyEvents as ResultsEventsService,
      standings,
      dummyAudit as AuditService,
      dummyMatchControl,
    );

    jest.spyOn(service as any, 'ensureMatch').mockResolvedValue({
      id: 'm-1',
      status: 'FINISHED',
      tournamentId: 'tour-1',
      organizationId: 'org-1',
      tournament: { organizationId: 'org-1' },
    });
    jest
      .spyOn(service, 'ensureResultsEditable')
      .mockResolvedValue(undefined as any);
    jest.spyOn(service as any, 'rulesetConfig').mockResolvedValue({
      placementPoints: { 1: 10, 2: 6, 3: 5 },
      killPoints: 1,
      rulesetId: null,
      gameKey: 'PUBG_MOBILE',
    });
    jest
      .spyOn(service as any, 'persistManualSyncOverrides')
      .mockResolvedValue({ version: 1 });
    jest.spyOn(service, 'recalculateMatchResults').mockResolvedValue(undefined);

    await expect(
      service.setPlacements(
        { id: 'admin', actorId: 'admin', role: Role.SUPER_ADMIN } as any,
        'm-1',
        [
          { teamId: 'team-1', placement: 1 },
          { teamId: 'team-2', placement: 2 },
        ],
      ),
    ).resolves.toMatchObject({ ok: true });

    expect(slotUpdates).toEqual([
      expect.objectContaining({
        id: 'slot-active',
        data: expect.objectContaining({ placement: 1 }),
      }),
      expect.objectContaining({
        id: 'slot-unresolved',
        data: expect.objectContaining({ placement: 2 }),
      }),
    ]);
    expect(slotUpdates.some((update) => update.id === 'slot-noshow')).toBe(
      false,
    );
  });
});

describe('ResultsService.updateTeamPlayers anonymous identity', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('accepts canonical anonymous player keys and returns the same key after save', async () => {
    let playerState = {
      id: 'player-result-1',
      slotResultId: 'slot-result-1',
      playerId: null,
      playerName: 'Anonymous',
      kills: 0,
      knocks: 0,
      isKnocked: false,
      isAlive: true,
      alive: true,
      isAutoFilled: false,
      updatedAt: null,
      organizationId: 'org-1',
      player: null,
    };

    let slotState = {
      id: 'slot-result-1',
      matchId: 'm-1',
      slotNumber: 1,
      wasPresentInMatch: true,
      placement: null,
      placementPoints: 0,
      totalKills: 0,
      points: 0,
      totalPoints: 0,
      teamId: 'team-1',
      organizationId: 'org-1',
      manualTotalKills: false,
      eliminatedOrder: null,
      eliminatedAt: null,
      isLocked: false,
      players: [{ ...playerState }],
      team: { id: 'team-1', name: 'Team One', tag: 'ONE', logoUrl: null },
    };

    const tx = {
      matchSlotPlayerResult: {
        update: jest
          .fn()
          .mockImplementation(
            async (args: Prisma.MatchSlotPlayerResultUpdateArgs) => {
              if (args.where?.id === playerState.id) {
                playerState = {
                  ...playerState,
                  ...(args.data as Record<string, unknown>),
                };
              }
              return { ...playerState };
            },
          ),
      },
      matchSlotResult: {
        update: jest
          .fn()
          .mockImplementation(
            async (args: Prisma.MatchSlotResultUpdateArgs) => {
              if (args.where?.id === slotState.id) {
                slotState = {
                  ...slotState,
                  ...(args.data as Record<string, unknown>),
                  players: [{ ...playerState }],
                };
              }
              return { ...slotState };
            },
          ),
        findUnique: jest.fn().mockImplementation(async () => ({
          ...slotState,
          players: [{ ...playerState }],
          team: { id: 'team-1', name: 'Team One', tag: 'ONE', logoUrl: null },
        })),
      },
    };

    const prisma = {
      matchSlotResult: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([{ ...slotState }]),
      },
      $transaction: jest
        .fn()
        .mockImplementation(async (callback: any) => callback(tx)),
    } as unknown as PrismaService;

    const service = new ResultsService(
      prisma,
      dummyEvents as ResultsEventsService,
      dummyStandings as StandingsService,
      dummyAudit as AuditService,
      dummyMatchControl,
    );

    jest.spyOn(service as any, 'ensureMatch').mockResolvedValue({
      id: 'm-1',
      status: 'LIVE',
      liveState: 'LIVE',
      dataSource: 'MANUAL',
      dataMode: 'MANUAL',
      controlState: null,
      tournament: { organizationId: 'org-1' },
      game: { key: 'PUBG_MOBILE' },
    });
    jest.spyOn(service as any, 'shouldFullMatchLock').mockReturnValue(false);
    jest
      .spyOn(service as any, 'ensureResultsEditable')
      .mockResolvedValue(undefined);
    const ensureResultsFromSlots = jest
      .spyOn(service as any, 'ensureResultsFromSlots')
      .mockResolvedValue([{ ...slotState }] as any);
    jest.spyOn(service as any, 'rulesetConfig').mockResolvedValue({
      placementPoints: { 1: 10, 2: 6, 3: 5 },
      killPoints: 1,
    });
    jest
      .spyOn(service as any, 'ensureResultsFromSlots')
      .mockResolvedValue([{ ...slotState }] as any);
    jest.spyOn(service as any, 'syncMatchPlayers').mockResolvedValue(undefined);
    jest.spyOn(service as any, 'auditEdit').mockResolvedValue(undefined);

    const result = await service.updateTeamPlayers(
      {
        id: 'user-1',
        actorId: 'user-1',
        role: Role.ORGANIZER,
        actorRole: Role.ORGANIZER,
      } as any,
      'm-1',
      'team-1',
      {
        players: [
          {
            playerId: 'slot-player:player-result-1',
            kills: 4,
            alive: true,
            knocked: false,
          },
        ],
      },
    );

    expect(ensureResultsFromSlots).toHaveBeenCalledWith('m-1');
    expect(tx.matchSlotPlayerResult.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'player-result-1' },
        data: expect.objectContaining({
          kills: 4,
          isAlive: true,
          alive: true,
          isKnocked: false,
        }),
      }),
    );
    expect(result.team?.players[0]).toMatchObject({
      id: 'player-result-1',
      playerId: 'slot-player:player-result-1',
      kills: 4,
      alive: true,
      isAlive: true,
      knocked: false,
      isKnocked: false,
    });
  });

  it('hydrates slot player rows before resolving incoming roster player ids', async () => {
    let playerState = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      slotResultId: 'slot-result-1',
      playerId: 'player-1',
      playerName: 'Alpha',
      kills: 0,
      knocks: 0,
      isKnocked: false,
      isAlive: true,
      alive: true,
      isAutoFilled: false,
      updatedAt: null,
      organizationId: 'org-1',
      player: {
        externalPlayerId: null,
        photoUrl: null,
        inGameId: null,
        ign: 'Alpha',
      },
    };

    let slotState = {
      id: 'slot-result-1',
      matchId: 'm-1',
      slotNumber: 1,
      wasPresentInMatch: true,
      placement: null,
      placementPoints: 0,
      totalKills: 0,
      points: 0,
      totalPoints: 0,
      teamId: 'team-1',
      organizationId: 'org-1',
      manualTotalKills: false,
      eliminatedOrder: null,
      eliminatedAt: null,
      isLocked: false,
      players: [] as any[],
      team: { id: 'team-1', name: 'Team One', tag: 'ONE', logoUrl: null },
    };

    const tx = {
      matchSlotPlayerResult: {
        update: jest
          .fn()
          .mockImplementation(
            async (args: Prisma.MatchSlotPlayerResultUpdateArgs) => {
              if (args.where?.id === playerState.id) {
                playerState = {
                  ...playerState,
                  ...(args.data as Record<string, unknown>),
                };
              }
              return { ...playerState };
            },
          ),
      },
      matchSlotResult: {
        update: jest
          .fn()
          .mockImplementation(
            async (args: Prisma.MatchSlotResultUpdateArgs) => {
              if (args.where?.id === slotState.id) {
                slotState = {
                  ...slotState,
                  ...(args.data as Record<string, unknown>),
                  players: [{ ...playerState }],
                };
              }
              return { ...slotState };
            },
          ),
        findUnique: jest.fn().mockImplementation(async () => ({
          ...slotState,
          players: [{ ...playerState }],
          team: { id: 'team-1', name: 'Team One', tag: 'ONE', logoUrl: null },
        })),
      },
    };

    const prisma = {
      matchSlotResult: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockImplementation(async () => [{ ...slotState }]),
      },
      $transaction: jest
        .fn()
        .mockImplementation(async (callback: any) => callback(tx)),
    } as unknown as PrismaService;

    const service = new ResultsService(
      prisma,
      dummyEvents as ResultsEventsService,
      dummyStandings as StandingsService,
      dummyAudit as AuditService,
      dummyMatchControl,
    );

    jest.spyOn(service as any, 'ensureMatch').mockResolvedValue({
      id: 'm-1',
      status: 'LIVE',
      liveState: 'LIVE',
      dataSource: 'MANUAL',
      dataMode: 'MANUAL',
      controlState: null,
      tournament: { organizationId: 'org-1' },
      game: { key: 'PUBG_MOBILE' },
    });
    jest.spyOn(service as any, 'shouldFullMatchLock').mockReturnValue(false);
    jest
      .spyOn(service as any, 'ensureResultsEditable')
      .mockResolvedValue(undefined);
    const ensureResultsFromSlots = jest
      .spyOn(service as any, 'ensureResultsFromSlots')
      .mockImplementation(async () => {
        slotState = {
          ...slotState,
          players: [{ ...playerState }],
        };
        return [{ ...slotState }] as any;
      });
    jest.spyOn(service as any, 'rulesetConfig').mockResolvedValue({
      placementPoints: { 1: 10, 2: 6, 3: 5 },
      killPoints: 1,
    });
    jest.spyOn(service as any, 'syncMatchPlayers').mockResolvedValue(undefined);
    jest.spyOn(service as any, 'auditEdit').mockResolvedValue(undefined);

    const result = await service.updateTeamPlayers(
      {
        id: 'user-1',
        actorId: 'user-1',
        role: Role.ORGANIZER,
        actorRole: Role.ORGANIZER,
      } as any,
      'm-1',
      'team-1',
      {
        players: [
          {
            playerId: 'player-1',
            kills: 2,
            alive: true,
            knocked: false,
          },
        ],
      },
    );

    expect(ensureResultsFromSlots).toHaveBeenCalledWith('m-1');
    expect(tx.matchSlotPlayerResult.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: '550e8400-e29b-41d4-a716-446655440000' },
        data: expect.objectContaining({
          kills: 2,
          isAlive: true,
          alive: true,
          isKnocked: false,
        }),
      }),
    );
    expect(result.team?.players[0]).toMatchObject({
      id: '550e8400-e29b-41d4-a716-446655440000',
      playerId: 'player-1',
      kills: 2,
      alive: true,
      isAlive: true,
      knocked: false,
      isKnocked: false,
    });
  });
});

describe('ResultsService.updateTeamPlayers live sync', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('increments the live sync version and republishes the persisted mirror', async () => {
    let playerState = {
      id: 'player-result-1',
      slotResultId: 'slot-result-1',
      playerId: 'player-1',
      playerName: 'Alpha',
      kills: 0,
      knocks: 0,
      isKnocked: false,
      isAlive: true,
      alive: true,
      isAutoFilled: false,
      updatedAt: null,
      organizationId: 'org-1',
      player: {
        externalPlayerId: null,
        photoUrl: null,
        inGameId: null,
        ign: 'Alpha',
      },
    };

    let slotState = {
      id: 'slot-result-1',
      matchId: 'm-1',
      slotNumber: 1,
      wasPresentInMatch: true,
      placement: 1,
      placementPoints: 10,
      totalKills: 0,
      points: 10,
      totalPoints: 10,
      teamId: 'team-1',
      organizationId: 'org-1',
      manualTotalKills: false,
      eliminatedOrder: null,
      eliminatedAt: null,
      isLocked: false,
      players: [{ ...playerState }],
      team: { id: 'team-1', name: 'Team One', tag: 'ONE', logoUrl: null },
    };

    const tx = {
      matchControlState: {
        findUnique: jest.fn().mockResolvedValue({
          organizationId: 'org-1',
          state: 'LIVE',
          metaJson: null,
        }),
        upsert: jest.fn().mockResolvedValue(undefined),
      },
      matchSlotPlayerResult: {
        update: jest
          .fn()
          .mockImplementation(
            async (args: Prisma.MatchSlotPlayerResultUpdateArgs) => {
              if (args.where?.id === playerState.id) {
                playerState = {
                  ...playerState,
                  ...(args.data as Record<string, unknown>),
                };
              }
              return { ...playerState };
            },
          ),
      },
      matchSlotResult: {
        update: jest
          .fn()
          .mockImplementation(
            async (args: Prisma.MatchSlotResultUpdateArgs) => {
              if (args.where?.id === slotState.id) {
                slotState = {
                  ...slotState,
                  ...(args.data as Record<string, unknown>),
                  players: [{ ...playerState }],
                };
              }
              return { ...slotState };
            },
          ),
        findUnique: jest.fn().mockImplementation(async () => ({
          ...slotState,
          players: [{ ...playerState }],
          team: { id: 'team-1', name: 'Team One', tag: 'ONE', logoUrl: null },
        })),
      },
    };

    const liveStateMirror = {
      publish: jest.fn().mockImplementation(async (state) => state),
    };
    const matchControlStateStore = {
      get: jest.fn().mockResolvedValue(null),
    };

    const prisma = {
      matchSlotResult: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockImplementation(async () => [{ ...slotState }]),
      },
      match: {
        findUnique: jest.fn().mockResolvedValue({
          status: 'LIVE',
          startedAt: null,
          endedAt: null,
          dataSource: 'MANUAL',
          dataMode: 'MANUAL',
          controlState: {
            state: 'LIVE',
            authorityMode: 'MANUAL',
            metaJson: {
              liveSync: {
                version: 1,
                updatedAt: 100,
                overrides: {
                  players: {},
                  teams: {},
                },
              },
            },
          },
        }),
      },
      $transaction: jest
        .fn()
        .mockImplementation(async (callback: any) => callback(tx)),
    } as unknown as PrismaService;

    const service = new ResultsService(
      prisma,
      dummyEvents as ResultsEventsService,
      dummyStandings as StandingsService,
      dummyAudit as AuditService,
      dummyMatchControl,
      liveStateMirror as any,
      matchControlStateStore as any,
    );

    jest.spyOn(service as any, 'ensureMatch').mockResolvedValue({
      id: 'm-1',
      status: 'LIVE',
      liveState: 'LIVE',
      dataSource: 'MANUAL',
      dataMode: 'MANUAL',
      controlState: { state: 'LIVE', metaJson: null },
      tournament: { organizationId: 'org-1' },
      game: { key: 'PUBG_MOBILE' },
    });
    jest.spyOn(service as any, 'rulesetConfig').mockResolvedValue({
      placementPoints: { 1: 10, 2: 6, 3: 5 },
      killPoints: 1,
    });
    jest
      .spyOn(service as any, 'ensureResultsFromSlots')
      .mockResolvedValue([{ ...slotState }] as any);
    jest.spyOn(service as any, 'syncMatchPlayers').mockResolvedValue(undefined);
    jest.spyOn(service as any, 'auditEdit').mockResolvedValue(undefined);

    await service.updateTeamPlayers(
      {
        id: 'user-1',
        actorId: 'user-1',
        role: Role.ORGANIZER,
        actorRole: Role.ORGANIZER,
        organizationId: 'org-1',
      } as any,
      'm-1',
      'team-1',
      {
        players: [
          {
            playerResultId: 'player-result-1',
            kills: 2,
            alive: true,
            knocked: false,
          },
        ],
      },
    );

    expect(tx.matchControlState.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          metaJson: expect.objectContaining({
            liveSync: expect.objectContaining({
              version: 1,
            }),
          }),
        }),
      }),
    );
    expect(liveStateMirror.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        version: 1,
        teams: [
          expect.objectContaining({
            teamId: 'team-1',
          }),
        ],
      }),
    );
  });

  it('does not invoke legacy live-state finalization or rewrite non-target slots for live manual-source corrections', async () => {
    let teamAPlayer = {
      id: 'player-result-1',
      slotResultId: 'slot-result-1',
      playerId: 'player-1',
      playerName: 'Alpha',
      kills: 1,
      knocks: 0,
      isKnocked: false,
      isAlive: true,
      alive: true,
      isAutoFilled: false,
      updatedAt: null,
      organizationId: 'org-1',
      player: {
        externalPlayerId: null,
        photoUrl: null,
        inGameId: null,
        ign: 'Alpha',
      },
    };
    const teamBPlayer = {
      id: 'player-result-2',
      slotResultId: 'slot-result-2',
      playerId: 'player-2',
      playerName: 'Bravo',
      kills: 0,
      knocks: 0,
      isKnocked: false,
      isAlive: true,
      alive: true,
      isAutoFilled: false,
      updatedAt: null,
      organizationId: 'org-1',
      player: {
        externalPlayerId: null,
        photoUrl: null,
        inGameId: null,
        ign: 'Bravo',
      },
    };

    let slotA = {
      id: 'slot-result-1',
      matchId: 'm-1',
      slotNumber: 1,
      wasPresentInMatch: true,
      placement: null,
      placementPoints: 0,
      totalKills: 1,
      points: 1,
      totalPoints: 1,
      teamId: 'team-1',
      organizationId: 'org-1',
      manualTotalKills: false,
      eliminatedOrder: null,
      eliminatedAt: null,
      isLocked: false,
      players: [{ ...teamAPlayer }],
      team: { id: 'team-1', name: 'Team One', tag: 'ONE', logoUrl: null },
    };
    let slotB = {
      id: 'slot-result-2',
      matchId: 'm-1',
      slotNumber: 2,
      wasPresentInMatch: true,
      placement: null,
      placementPoints: 0,
      totalKills: 0,
      points: 0,
      totalPoints: 0,
      teamId: 'team-2',
      organizationId: 'org-1',
      manualTotalKills: false,
      eliminatedOrder: null,
      eliminatedAt: null,
      isLocked: false,
      players: [{ ...teamBPlayer }],
      team: { id: 'team-2', name: 'Team Two', tag: 'TWO', logoUrl: null },
    };

    const tx = {
      matchControlState: {
        findUnique: jest.fn().mockResolvedValue({
          organizationId: 'org-1',
          state: 'LIVE',
          metaJson: null,
        }),
        upsert: jest.fn().mockResolvedValue(undefined),
      },
      matchSlotPlayerResult: {
        update: jest
          .fn()
          .mockImplementation(
            async (args: Prisma.MatchSlotPlayerResultUpdateArgs) => {
              if (args.where?.id === teamAPlayer.id) {
                teamAPlayer = {
                  ...teamAPlayer,
                  ...(args.data as Record<string, unknown>),
                };
                slotA = { ...slotA, players: [{ ...teamAPlayer }] };
                return { ...teamAPlayer };
              }
              return { ...teamBPlayer };
            },
          ),
      },
      matchSlotResult: {
        update: jest
          .fn()
          .mockImplementation(
            async (args: Prisma.MatchSlotResultUpdateArgs) => {
              if (args.where?.id === slotA.id) {
                slotA = {
                  ...slotA,
                  ...(args.data as Record<string, unknown>),
                  players: [{ ...teamAPlayer }],
                };
                return { ...slotA };
              }
              if (args.where?.id === slotB.id) {
                slotB = {
                  ...slotB,
                  ...(args.data as Record<string, unknown>),
                  players: [{ ...teamBPlayer }],
                };
                return { ...slotB };
              }
              return null;
            },
          ),
        findUnique: jest
          .fn()
          .mockImplementation(
            async (args: Prisma.MatchSlotResultFindUniqueArgs) => {
              if (args.where?.id === slotA.id) {
                return {
                  ...slotA,
                  players: [{ ...teamAPlayer }],
                  team: {
                    id: 'team-1',
                    name: 'Team One',
                    tag: 'ONE',
                    logoUrl: null,
                  },
                };
              }
              if (args.where?.id === slotB.id) {
                return {
                  ...slotB,
                  players: [{ ...teamBPlayer }],
                  team: {
                    id: 'team-2',
                    name: 'Team Two',
                    tag: 'TWO',
                    logoUrl: null,
                  },
                };
              }
              return null;
            },
          ),
      },
    };

    const liveStateMirror = {
      publish: jest.fn().mockImplementation(async (state) => state),
    };
    const matchControlStateStore = {
      get: jest.fn().mockResolvedValue(null),
    };
    const prisma = {
      matchSlotResult: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest
          .fn()
          .mockImplementation(async () => [{ ...slotA }, { ...slotB }]),
      },
      match: {
        findUnique: jest.fn().mockResolvedValue({
          status: 'LIVE',
          startedAt: null,
          endedAt: null,
          dataSource: 'MANUAL',
          dataMode: 'MANUAL',
          controlState: {
            state: 'LIVE',
            authorityMode: 'MANUAL',
            resultsManualLock: false,
            resultsForceUnlock: false,
            metaJson: {
              liveSync: {
                version: 2,
                updatedAt: 100,
                overrides: {
                  players: {},
                  teams: {},
                },
              },
            },
          },
        }),
      },
      $transaction: jest
        .fn()
        .mockImplementation(async (callback: any) => callback(tx)),
    } as unknown as PrismaService;

    const service = new ResultsService(
      prisma,
      dummyEvents as ResultsEventsService,
      dummyStandings as StandingsService,
      dummyAudit as AuditService,
      dummyMatchControl,
      liveStateMirror as any,
      matchControlStateStore as any,
    );

    jest.spyOn(service as any, 'ensureMatch').mockResolvedValue({
      id: 'm-1',
      status: 'LIVE',
      liveState: 'LIVE',
      dataSource: 'MANUAL',
      dataMode: 'MANUAL',
      controlState: {
        state: 'LIVE',
        metaJson: null,
        resultsManualLock: false,
        resultsForceUnlock: false,
      },
      tournament: { organizationId: 'org-1' },
      game: { key: 'PUBG_MOBILE' },
    });
    jest.spyOn(service as any, 'rulesetConfig').mockResolvedValue({
      placementPoints: { 1: 10, 2: 6, 3: 5 },
      killPoints: 1,
    });
    jest
      .spyOn(service as any, 'ensureResultsFromSlots')
      .mockResolvedValue([{ ...slotA }, { ...slotB }] as any);
    jest.spyOn(service as any, 'syncMatchPlayers').mockResolvedValue(undefined);
    jest.spyOn(service as any, 'auditEdit').mockResolvedValue(undefined);

    await service.updateTeamPlayers(
      {
        id: 'user-1',
        actorId: 'user-1',
        role: Role.ORGANIZER,
        actorRole: Role.ORGANIZER,
        organizationId: 'org-1',
      } as any,
      'm-1',
      'team-1',
      {
        players: [
          {
            playerResultId: 'player-result-1',
            kills: 3,
            alive: true,
            knocked: false,
          },
        ],
      },
    );

    expect(tx.matchSlotResult.update).toHaveBeenCalledTimes(1);
    expect(tx.matchSlotResult.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'slot-result-1' },
      }),
    );
    expect(tx.matchSlotResult.update).not.toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'slot-result-2' },
      }),
    );
    expect(slotB).toMatchObject({
      placement: null,
      totalKills: 0,
      points: 0,
      totalPoints: 0,
      isLocked: false,
    });
    expect(liveStateMirror.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        version: 1,
        teams: expect.arrayContaining([
          expect.objectContaining({
            teamId: 'team-1',
          }),
        ]),
      }),
    );
  });
});

describe('ResultsService override release', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('releases team-scoped overrides, appends audit metadata, increments version, and republishes the telemetry mirror', async () => {
    const tx = {
      matchControlState: {
        findUnique: jest.fn().mockResolvedValue({
          organizationId: 'org-1',
          state: 'LIVE',
          metaJson: {
            liveSync: {
              version: 5,
              updatedAt: 1710000000000,
              overrides: {
                players: {
                  'slot-player:player-result-1': {
                    alive: {
                      owner: 'MANUAL',
                      override: true,
                      updatedAt: 1710000000000,
                      actorId: 'admin-1',
                      source: 'MANUAL_RESULTS',
                    },
                  },
                },
                teams: {
                  'team-1': {
                    placement: {
                      owner: 'MANUAL',
                      override: true,
                      updatedAt: 1710000000000,
                      actorId: 'admin-1',
                      source: 'MANUAL_RESULTS',
                    },
                  },
                },
              },
              auditTrail: [],
            },
          },
        }),
        upsert: jest.fn().mockResolvedValue(undefined),
      },
    };

    const prisma = {
      matchSlotResult: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'slot-result-1',
          teamId: 'team-1',
          organizationId: 'org-1',
          players: [{ id: 'player-result-1', playerId: null }],
        }),
      },
      $transaction: jest
        .fn()
        .mockImplementation(
          async (callback: (client: typeof tx) => Promise<unknown>) =>
            callback(tx),
        ),
    } as unknown as PrismaService;

    const telemetryEngine = {
      republishMirror: jest.fn().mockResolvedValue(undefined),
    };

    const service = new ResultsService(
      prisma,
      dummyEvents as ResultsEventsService,
      dummyStandings as StandingsService,
      dummyAudit as AuditService,
      dummyMatchControl,
      null as never,
      null as never,
      telemetryEngine as any,
    );

    jest.spyOn(service as any, 'ensureMatch').mockResolvedValue({
      id: 'm-1',
      status: 'LIVE',
      liveState: 'LIVE',
      dataSource: 'PCOB',
      dataMode: 'AUTO',
      controlState: {
        state: 'LIVE',
        authorityMode: 'AUTO',
        metaJson: {
          liveSync: {
            version: 5,
            updatedAt: 1710000000000,
            overrides: {
              players: {
                'slot-player:player-result-1': {
                  alive: {
                    owner: 'MANUAL',
                    override: true,
                    updatedAt: 1710000000000,
                    actorId: 'admin-1',
                    source: 'MANUAL_RESULTS',
                  },
                },
              },
              teams: {
                'team-1': {
                  placement: {
                    owner: 'MANUAL',
                    override: true,
                    updatedAt: 1710000000000,
                    actorId: 'admin-1',
                    source: 'MANUAL_RESULTS',
                  },
                },
              },
            },
            auditTrail: [],
          },
        },
        resultsManualLock: false,
        resultsForceUnlock: false,
      },
      tournament: { organizationId: 'org-1' },
    });

    const result = await service.releaseTeamOverrides(
      {
        id: 'user-1',
        actorId: 'user-1',
        role: Role.ORGANIZER,
        actorRole: Role.ORGANIZER,
        organizationId: 'org-1',
      } as any,
      'm-1',
      'team-1',
    );

    expect(result).toMatchObject({
      ok: true,
      released: true,
      releasedPlayers: 1,
      releasedTeams: 1,
      version: 6,
    });
    expect(tx.matchControlState.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          metaJson: expect.objectContaining({
            liveSync: expect.objectContaining({
              version: 6,
              overrides: {
                players: {},
                teams: {},
              },
              auditTrail: expect.arrayContaining([
                expect.objectContaining({
                  action: 'RELEASE',
                  actorId: 'user-1',
                  scope: expect.objectContaining({
                    level: 'PLAYER',
                    playerId: 'slot-player:player-result-1',
                  }),
                }),
                expect.objectContaining({
                  action: 'RELEASE',
                  actorId: 'user-1',
                  scope: expect.objectContaining({
                    level: 'TEAM',
                    teamId: 'team-1',
                  }),
                }),
              ]),
            }),
          }),
        }),
      }),
    );
    expect(telemetryEngine.republishMirror).toHaveBeenCalledWith('m-1');
  });

  it('returns 409 for team override release after results are finalized', async () => {
    const telemetryEngine = {
      republishMirror: jest.fn().mockResolvedValue(undefined),
    };

    const service = new ResultsService(
      {} as PrismaService,
      dummyEvents as ResultsEventsService,
      dummyStandings as StandingsService,
      dummyAudit as AuditService,
      dummyMatchControl,
      null as never,
      null as never,
      telemetryEngine as any,
    );

    jest.spyOn(service as any, 'ensureMatch').mockResolvedValue({
      id: 'm-1',
      status: 'FINISHED',
      liveState: 'CONFIRMED',
      dataSource: 'PCOB',
      dataMode: 'AUTO',
      controlState: {
        state: 'CONFIRMED',
        authorityMode: 'AUTO',
        metaJson: {
          resultFinalized: true,
          liveSync: {
            version: 6,
            updatedAt: 1710000000000,
            overrides: {
              players: {
                'slot-player:player-result-1': {
                  alive: {
                    owner: 'MANUAL',
                    override: true,
                    updatedAt: 1710000000000,
                  },
                },
              },
              teams: {},
            },
            auditTrail: [],
          },
        },
        resultsManualLock: false,
        resultsForceUnlock: false,
      },
      tournament: { organizationId: 'org-1' },
    });

    await expect(
      service.releaseTeamOverrides(
        {
          id: 'user-1',
          actorId: 'user-1',
          role: Role.ORGANIZER,
          actorRole: Role.ORGANIZER,
          organizationId: 'org-1',
        } as any,
        'm-1',
        'team-1',
      ),
    ).rejects.toThrow(
      'Overrides cannot be released after results are finalized.',
    );

    expect(telemetryEngine.republishMirror).not.toHaveBeenCalled();
  });

  it('releases all overrides and republishes the manual mirror through the canonical path', async () => {
    const tx = {
      matchControlState: {
        findUnique: jest.fn().mockResolvedValue({
          organizationId: 'org-1',
          state: 'LIVE',
          metaJson: {
            liveSync: {
              version: 2,
              updatedAt: 1710000000000,
              overrides: {
                players: {
                  'player-1': {
                    kills: {
                      owner: 'MANUAL',
                      override: true,
                      updatedAt: 1710000000000,
                      actorId: 'admin-1',
                      source: 'MANUAL_RESULTS',
                    },
                  },
                },
                teams: {
                  'team-1': {
                    eliminated: {
                      owner: 'MANUAL',
                      override: true,
                      updatedAt: 1710000000000,
                      actorId: 'admin-1',
                      source: 'MANUAL_RESULTS',
                    },
                  },
                },
              },
              auditTrail: [],
            },
          },
        }),
        upsert: jest.fn().mockResolvedValue(undefined),
      },
    };

    const prisma = {
      $transaction: jest
        .fn()
        .mockImplementation(
          async (callback: (client: typeof tx) => Promise<unknown>) =>
            callback(tx),
        ),
    } as unknown as PrismaService;

    const service = new ResultsService(
      prisma,
      dummyEvents as ResultsEventsService,
      dummyStandings as StandingsService,
      dummyAudit as AuditService,
      dummyMatchControl,
    );

    const publishManualMirrorFromResults = jest
      .spyOn(service as any, 'publishManualMirrorFromResults')
      .mockResolvedValue(undefined);

    jest.spyOn(service as any, 'ensureMatch').mockResolvedValue({
      id: 'm-1',
      status: 'LIVE',
      liveState: 'LIVE',
      dataSource: 'MANUAL',
      dataMode: 'MANUAL',
      controlState: {
        state: 'LIVE',
        authorityMode: 'MANUAL',
        metaJson: {
          liveSync: {
            version: 2,
            updatedAt: 1710000000000,
            overrides: {
              players: {
                'player-1': {
                  kills: {
                    owner: 'MANUAL',
                    override: true,
                    updatedAt: 1710000000000,
                    actorId: 'admin-1',
                    source: 'MANUAL_RESULTS',
                  },
                },
              },
              teams: {
                'team-1': {
                  eliminated: {
                    owner: 'MANUAL',
                    override: true,
                    updatedAt: 1710000000000,
                    actorId: 'admin-1',
                    source: 'MANUAL_RESULTS',
                  },
                },
              },
            },
            auditTrail: [],
          },
        },
        resultsManualLock: false,
        resultsForceUnlock: false,
      },
      tournament: { organizationId: 'org-1' },
    });

    const result = await service.releaseMatchOverrides(
      {
        id: 'user-1',
        actorId: 'user-1',
        role: Role.ORGANIZER,
        actorRole: Role.ORGANIZER,
        organizationId: 'org-1',
      } as any,
      'm-1',
    );

    expect(result).toMatchObject({
      ok: true,
      released: true,
      releasedPlayers: 1,
      releasedTeams: 1,
      version: 3,
    });
    expect(tx.matchControlState.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          metaJson: expect.objectContaining({
            liveSync: expect.objectContaining({
              version: 3,
              overrides: {
                players: {},
                teams: {},
              },
              auditTrail: expect.arrayContaining([
                expect.objectContaining({
                  action: 'RELEASE',
                  actorId: 'user-1',
                  scope: expect.objectContaining({
                    level: 'MATCH',
                  }),
                }),
              ]),
            }),
          }),
        }),
      }),
    );
    expect(publishManualMirrorFromResults).toHaveBeenCalledWith('m-1', 3);
  });
});

describe('ResultsService.recomputeSlotResult', () => {
  it('recomputes placement and kill points from slot results only', async () => {
    const prisma = new PrismaMock();
    const service = new ResultsService(
      prisma as unknown as PrismaService,
      dummyEvents as ResultsEventsService,
      dummyStandings as StandingsService,
      dummyAudit as AuditService,
      dummyMatchControl,
    );

    const updated = await service.recomputeSlotResult('m-1', 1);

    expect(updated.placementPoints).toBe(6); // placement 2 => 6 points
    expect(updated.totalKills).toBe(3);
    expect(updated.totalPoints).toBe(9); // 6 + 3 kills
  });
});

describe('ResultsService elimination placement mapping', () => {
  it('maps reverse elimination order to battle royale placements', () => {
    const service = new ResultsService(
      {} as unknown as PrismaService,
      dummyEvents as ResultsEventsService,
      dummyStandings as StandingsService,
      dummyAudit as AuditService,
      dummyMatchControl,
    );

    expect((service as any).derivePlacement(3, 1, false, 0)).toBe(3);
    expect((service as any).derivePlacement(3, 2, false, 0)).toBe(2);
    expect((service as any).derivePlacement(3, null, true, 1)).toBe(1);
  });
});

describe('ResultsService.refereeEditSlot and adjustments', () => {
  const placementPoints = { 1: 10, 2: 6, 3: 5 };

  const baseSlot = () => ({
    id: 'sr-1',
    matchId: 'm-1',
    slotNumber: 1,
    wasPresentInMatch: true,
    placement: 2,
    placementPoints: 0,
    totalKills: 3,
    totalPoints: 0,
    points: 0,
    teamId: 'team-1',
    organizationId: 'org-1',
    manualTotalKills: true,
    players: [],
  });

  const prismaFactory = (killPoints: number, adjustmentDelta = 0) => {
    let slot = baseSlot();
    return {
      matchSlotResult: {
        findFirst: jest.fn().mockResolvedValue(slot),
        findMany: jest.fn().mockResolvedValue([slot]),
        update: jest
          .fn()
          .mockImplementation((args: Prisma.MatchSlotResultUpdateArgs) => {
            slot = { ...slot, ...(args.data as Record<string, unknown>) };
            return Promise.resolve({ ...slot });
          }),
      },
      match: {
        findFirst: jest.fn().mockResolvedValue({
          rulesetId: null,
          game: { key: 'PUBG_MOBILE' },
          tournament: { rulesetId: null, game: 'PUBG_MOBILE' },
        }),
      },
      matchSlot: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      ruleset: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue({
          id: 'rs-1',
          config: { placementPoints, killPoints },
        }),
      },
      adminAdjustment: {
        aggregate: jest.fn().mockResolvedValue({
          _sum: { pointsDelta: adjustmentDelta },
        }),
      },
      matchPlayer: {
        upsert: jest.fn().mockResolvedValue(undefined),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    } as unknown as PrismaService;
  };

  const makeService = (killPoints: number, adjustmentDelta = 0) => {
    const prisma = prismaFactory(killPoints, adjustmentDelta);
    const service = new ResultsService(
      prisma,
      dummyEvents as ResultsEventsService,
      dummyStandings as StandingsService,
      dummyAudit as AuditService,
      dummyMatchControl,
    );
    jest
      .spyOn(service, 'ensureResultsEditableByMatchId')
      .mockResolvedValue(undefined);
    return { service, prisma };
  };

  it('applies kill multiplier from ruleset', async () => {
    const { service } = makeService(2);

    const { after } = await service.refereeEditSlot('m-1', 'team-1', {
      kills: 3,
    });

    expect(after.points).toBe(6); // 3 kills * 2
    expect(after.totalPoints).toBe(12); // placement(6) + 6
    expect(after.manualTotalKills).toBe(true);
  });

  it('sets manualTotalKills when kills are overridden', async () => {
    const { service } = makeService(1);

    const { after } = await service.refereeEditSlot('m-1', 'team-1', {
      kills: 4,
    });

    expect(after.totalKills).toBe(4);
    expect(after.manualTotalKills).toBe(true);
  });

  it('applies penalty via adjustments without changing base points', async () => {
    const { service } = makeService(1, -2);

    const { after, pointsDelta } = await service.recomputeSlotAfterAdjustment(
      'm-1',
      'team-1',
    );

    expect(pointsDelta).toBe(-2);
    expect(after.points).toBe(3); // base kills 3 * killPoints 1
    expect(after.totalPoints).toBe(7); // base 9 minus 2 penalty
  });

  it('keeps totalKills and totalPoints stable after removing manual flag', async () => {
    const prisma = new PrismaMock();
    prisma.slot = {
      ...prisma.slot,
      placement: 2,
      placementPoints: 0,
      totalKills: 3,
      totalPoints: 0,
      manualTotalKills: true,
      players: [
        { id: 'p1', kills: 2, isAlive: true },
        { id: 'p2', kills: 1, isAlive: true },
        { id: 'p3', kills: 0, isAlive: true },
        { id: 'p4', kills: 0, isAlive: true },
      ] as any,
    };

    const service = new ResultsService(
      prisma as unknown as PrismaService,
      dummyEvents as ResultsEventsService,
      dummyStandings as StandingsService,
      dummyAudit as AuditService,
      dummyMatchControl,
    );

    const first = await service.recomputeSlotResult('m-1', 1);
    expect(first.totalKills).toBe(3);
    expect(first.totalPoints).toBe(9); // placement(6) + kills(3)

    // Remove manual flag and recompute; totals should remain derived from players
    prisma.slot = { ...prisma.slot, manualTotalKills: false };
    const second = await service.recomputeSlotResult('m-1', 1);

    expect(second.totalKills).toBe(3);
    expect(second.totalPoints).toBe(9);
  });
});

describe('ResultsService.validatePlayerStateTransition', () => {
  it('keeps the last alive player alive and clears the knock state', () => {
    const service = new ResultsService(
      {} as unknown as PrismaService,
      dummyEvents as ResultsEventsService,
      dummyStandings as StandingsService,
      dummyAudit as AuditService,
      dummyMatchControl,
    );

    expect(
      service.validatePlayerStateTransition({
        playerId: 'p-1',
        incomingAlive: true,
        incomingKnocked: true,
        current: { isAlive: true, isKnocked: false },
        teammates: [{ id: 'p-1', isAlive: true, isKnocked: false }],
      }),
    ).toMatchObject({
      nextIsAlive: true,
      nextIsKnocked: false,
      aliveAfterUpdate: 1,
    });
  });
});

describe('ResultsService.updatePlayerResult invariants', () => {
  it('clears a last-alive knock without eliminating the team', async () => {
    const updatedPlayers: Array<Record<string, unknown>> = [];
    const slotState = {
      id: 'slot-1',
      matchId: 'm-1',
      slotNumber: 1,
      wasPresentInMatch: true,
      teamId: 'team-1',
      organizationId: 'org-1',
      placement: null,
      placementPoints: 0,
      totalKills: 0,
      totalPoints: 0,
      points: 0,
      eliminatedOrder: null,
      eliminatedAt: null,
      isLocked: false,
      manualTotalKills: false,
      team: { id: 'team-1', name: 'Team 1', tag: 'T1', logoUrl: null },
      players: [
        {
          id: 'p-1',
          slotResultId: 'slot-1',
          organizationId: 'org-1',
          playerId: 'player-1',
          playerName: 'Player 1',
          kills: 0,
          isAlive: true,
          alive: true,
          isKnocked: false,
          player: { photoUrl: null, updatedAt: null, inGameId: 'Player 1' },
        },
      ],
    };
    const prisma = {
      match: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'm-1',
          tournamentId: 't-1',
          tournament: {
            ownerUserId: 'owner',
            organizationId: 'org-1',
            status: 'ACTIVE',
          },
          map: null,
          status: 'DRAFT',
          liveState: null,
          dataSource: null,
          dataMode: null,
          endedAt: null,
          game: { key: 'PUBG_MOBILE' },
          controlState: null,
          rulesetId: null,
        }),
      },
      matchSlotResult: {
        findUnique: jest.fn().mockImplementation(
          (args: {
            where?: {
              id?: string;
              matchId_slotNumber?: { matchId: string; slotNumber: number };
            };
          }) => {
            if (args.where?.matchId_slotNumber) {
              return Promise.resolve({
                id: 'slot-1',
                teamId: 'team-1',
                organizationId: 'org-1',
              });
            }
            if (args.where?.id === 'slot-1') {
              return Promise.resolve({
                ...slotState,
                players: [...slotState.players],
              });
            }
            return Promise.resolve(null);
          },
        ),
        findMany: jest.fn().mockResolvedValue([
          {
            ...slotState,
            players: [...slotState.players],
          },
        ]),
        findFirst: jest.fn().mockResolvedValue(null), // no locked slots
        update: jest
          .fn()
          .mockImplementation(
            (args: {
              where: { id: string };
              data: Record<string, unknown>;
            }) => {
              if (args.where.id === 'slot-1') {
                Object.assign(slotState, args.data);
              }
              return Promise.resolve({ ...slotState });
            },
          ),
      },
      matchSlotPlayerResult: {
        update: jest
          .fn()
          .mockImplementation(
            (args: {
              where: { id: string };
              data: Record<string, unknown>;
            }) => {
              const player = slotState.players.find(
                (entry) => entry.id === args.where.id,
              );
              if (player) {
                Object.assign(player, args.data);
                updatedPlayers.push({ ...player });
              }
              return Promise.resolve(player ?? null);
            },
          ),
      },
      ruleset: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      $transaction: jest
        .fn()
        .mockImplementation(
          async (callback: (tx: PrismaService) => Promise<unknown>) =>
            callback(prisma),
        ),
      matchEvent: {
        create: jest.fn().mockResolvedValue(undefined),
      },
      matchPlayer: {
        upsert: jest.fn().mockResolvedValue(undefined),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    } as unknown as PrismaService;

    const service = new ResultsService(
      prisma,
      dummyEvents as ResultsEventsService,
      dummyStandings as StandingsService,
      dummyAudit as AuditService,
      dummyMatchControl,
    );
    jest
      .spyOn(service, 'ensureResultsEditable')
      .mockResolvedValue(undefined as any);
    jest
      .spyOn(service as any, 'ensureResultsFromSlots')
      .mockResolvedValue([{ ...slotState }] as any);
    jest
      .spyOn(service as any, 'assertSlotUnlocked')
      .mockResolvedValue(undefined);

    const result = await service.updatePlayerResult(
      { id: 'admin', role: Role.SUPER_ADMIN } as any,
      'm-1',
      1,
      'p-1',
      { isKnocked: true, isAlive: true },
    );

    expect(
      (prisma as any).matchSlotPlayerResult.update as jest.Mock,
    ).toHaveBeenCalled();
    expect(updatedPlayers[0]?.isKnocked).toBe(false);
    expect(updatedPlayers[0]?.isAlive).toBe(true);
    expect(result.team?.players?.[0]?.isKnocked).toBe(false);
    expect(result.team?.players?.[0]?.isAlive).toBe(true);
    expect(result.team?.eliminated).toBe(false);
  });
});

describe('ResultsService finalize verification logging', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  const canonicalFinalState = {
    matchId: 'm-1',
    status: 'ENDED',
    mode: 'AUTO',
    version: 3,
    sequence: 12,
    updatedAt: 5_000,
    startedAt: 1_000,
    endedAt: 5_000,
    teamsAlive: 1,
    teams: {
      'team-1': {
        teamId: 'team-1',
        alivePlayers: 1,
        eliminated: false,
        placement: 1,
        totalKills: 4,
        totalPlayers: 1,
        eliminatedAt: null,
      },
    },
    players: {
      'player-1': {
        playerId: 'player-1',
        teamId: 'team-1',
        alive: true,
        knocked: false,
        kills: 4,
        metadata: { playerName: 'Alpha' },
      },
    },
  };

  const createFinalizeLoggingService = (
    verificationPlayers: Array<Record<string, unknown>>,
  ) => {
    const initialSlotResults = [
      {
        id: 'slot-1',
        slotNumber: 1,
        teamId: 'team-1',
        organizationId: 'org-1',
        players: [
          {
            id: 'slot-player-1',
            playerId: 'player-1',
            playerName: 'Alpha',
          },
        ],
      },
    ];

    const prisma = {
      matchSlotResult: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce(initialSlotResults)
          .mockResolvedValueOnce([{ players: verificationPlayers }]),
        update: jest.fn().mockResolvedValue(undefined),
      },
      matchSlotPlayerResult: {
        update: jest.fn().mockResolvedValue(undefined),
        create: jest.fn().mockResolvedValue({ id: 'slot-player-1' }),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      matchPlayer: {
        upsert: jest.fn().mockResolvedValue(undefined),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    } as unknown as PrismaService;

    const service = new ResultsService(
      prisma,
      dummyEvents as ResultsEventsService,
      dummyStandings as StandingsService,
      dummyAudit as AuditService,
      dummyMatchControl,
    );

    jest
      .spyOn(service, 'ensureResultsFromSlots')
      .mockResolvedValue(initialSlotResults as any);
    jest.spyOn(service, 'syncMatchPlayers').mockResolvedValue(undefined);

    const logSpy = jest
      .spyOn((service as any).logger, 'log')
      .mockImplementation(() => undefined);
    const warnSpy = jest
      .spyOn((service as any).logger, 'warn')
      .mockImplementation(() => undefined);

    return { service, logSpy, warnSpy };
  };

  it('logs final-results-written with zero alive and knocked postconditions after finalize', async () => {
    const { service, logSpy, warnSpy } = createFinalizeLoggingService([
      { isAlive: false, alive: false, isKnocked: false },
    ]);

    await service.applyTelemetryStateToResults('m-1', {
      finalize: true,
      state: canonicalFinalState as any,
    });

    const payload = readJsonLogPayload(logSpy.mock.calls.at(-1)?.[0]);
    expect(payload).toMatchObject({
      action: 'final-results-written',
      matchId: 'm-1',
      finalized: true,
      totalTeams: 1,
      teamsMarkedAliveAfterFinalize: 0,
      playersMarkedAliveAfterFinalize: 0,
      playersMarkedKnockedAfterFinalize: 0,
    });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('warns when finalized results still contain alive or knocked players', async () => {
    const { service, warnSpy } = createFinalizeLoggingService([
      { isAlive: true, alive: true, isKnocked: true },
    ]);

    await service.applyTelemetryStateToResults('m-1', {
      finalize: true,
      state: canonicalFinalState as any,
    });

    const payload = readJsonLogPayload(warnSpy.mock.calls.at(-1)?.[0]);
    expect(payload).toMatchObject({
      action: 'final-results-postcondition-failed',
      matchId: 'm-1',
      finalized: true,
      totalTeams: 1,
      teamsMarkedAliveAfterFinalize: 1,
      playersMarkedAliveAfterFinalize: 1,
      playersMarkedKnockedAfterFinalize: 1,
    });
  });
});

describe('ResultsService no-show finalization', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('marks slots without observed telemetry as no-show and leaves them unplaced', async () => {
    const slotUpdates: Array<Record<string, unknown>> = [];
    const initialSlotResults = [
      {
        id: 'slot-1',
        slotNumber: 1,
        teamId: 'team-1',
        wasPresentInMatch: null,
        organizationId: 'org-1',
        players: [
          {
            id: 'slot-player-1',
            playerId: 'player-1',
            playerName: 'Alpha',
          },
        ],
      },
      {
        id: 'slot-2',
        slotNumber: 2,
        teamId: 'team-2',
        wasPresentInMatch: null,
        organizationId: 'org-1',
        players: [
          {
            id: 'slot-player-2',
            playerId: 'player-2',
            playerName: 'Bravo',
          },
        ],
      },
    ];

    const prisma = {
      matchSlotResult: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce(initialSlotResults)
          .mockResolvedValueOnce([{ players: [] }]),
        update: jest.fn().mockImplementation(async (args) => {
          slotUpdates.push(args as Record<string, unknown>);
          return undefined;
        }),
      },
      matchSlotPlayerResult: {
        update: jest.fn().mockResolvedValue(undefined),
        create: jest.fn().mockResolvedValue({ id: 'slot-player-1' }),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      matchPlayer: {
        upsert: jest.fn().mockResolvedValue(undefined),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    } as unknown as PrismaService;

    const service = new ResultsService(
      prisma,
      dummyEvents as ResultsEventsService,
      dummyStandings as StandingsService,
      dummyAudit as AuditService,
      dummyMatchControl,
    );

    jest
      .spyOn(service, 'ensureResultsFromSlots')
      .mockResolvedValue(initialSlotResults as any);
    jest.spyOn(service, 'syncMatchPlayers').mockResolvedValue(undefined);

    await service.applyTelemetryStateToResults('m-1', {
      finalize: true,
      state: {
        matchId: 'm-1',
        status: 'ENDED',
        mode: 'AUTO',
        version: 3,
        sequence: 9,
        updatedAt: 5_000,
        startedAt: 1_000,
        endedAt: 5_000,
        teamsAlive: 1,
        teams: {
          'team-1': {
            teamId: 'team-1',
            alivePlayers: 1,
            eliminated: false,
            placement: 1,
            totalKills: 3,
            totalPlayers: 1,
            eliminatedAt: null,
            metadata: {
              slot: 1,
              wasPresentInMatch: true,
            },
          },
          'team-2': {
            teamId: 'team-2',
            alivePlayers: 0,
            eliminated: true,
            placement: 2,
            totalKills: 0,
            totalPlayers: 1,
            eliminatedAt: 4_000,
            metadata: {
              slot: 2,
            },
          },
        },
        players: {
          'player-1': {
            playerId: 'player-1',
            teamId: 'team-1',
            alive: true,
            knocked: false,
            kills: 3,
            metadata: {
              playerName: 'Alpha',
              observedInTelemetry: true,
            },
          },
          'player-2': {
            playerId: 'player-2',
            teamId: 'team-2',
            alive: true,
            knocked: false,
            kills: 0,
            metadata: {
              playerName: 'Bravo',
            },
          },
        },
      } as any,
    });

    expect(slotUpdates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          where: { id: 'slot-1' },
          data: expect.objectContaining({
            wasPresentInMatch: true,
            placement: 1,
            finalPlacement: 1,
            totalKills: 3,
          }),
        }),
        expect.objectContaining({
          where: { id: 'slot-2' },
          data: expect.objectContaining({
            wasPresentInMatch: false,
            placement: null,
            finalPlacement: null,
            totalKills: 0,
            finalKills: 0,
          }),
        }),
      ]),
    );
  });

  it('keeps finalized player rows available when telemetry ends with only team aggregates', async () => {
    const slotUpdates: Array<Record<string, unknown>> = [];
    const initialSlotResults = [
      {
        id: 'slot-1',
        slotNumber: 1,
        teamId: 'team-1',
        manualTotalKills: false,
        wasPresentInMatch: null,
        organizationId: 'org-1',
        team: {
          players: [
            {
              id: 'roster-player-1',
              ign: 'Alpha',
              realName: null,
              externalPlayerId: 'ext-1',
              playerOpenId: 'open-1',
            },
            {
              id: 'roster-player-2',
              ign: 'Bravo',
              realName: null,
              externalPlayerId: 'ext-2',
              playerOpenId: 'open-2',
            },
          ],
        },
        players: [],
      },
    ];

    const prisma = {
      matchSlotResult: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce(initialSlotResults)
          .mockResolvedValueOnce([
            {
              players: [
                { isAlive: false, alive: false, isKnocked: false },
                { isAlive: false, alive: false, isKnocked: false },
              ],
            },
          ]),
        update: jest.fn().mockImplementation(async (args) => {
          slotUpdates.push(args as Record<string, unknown>);
          return undefined;
        }),
      },
      matchSlotPlayerResult: {
        update: jest.fn().mockResolvedValue(undefined),
        create: jest
          .fn()
          .mockResolvedValueOnce({ id: 'slot-player-1' })
          .mockResolvedValueOnce({ id: 'slot-player-2' }),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      matchPlayer: {
        upsert: jest.fn().mockResolvedValue(undefined),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    } as unknown as PrismaService;

    const service = new ResultsService(
      prisma,
      dummyEvents as ResultsEventsService,
      dummyStandings as StandingsService,
      dummyAudit as AuditService,
      dummyMatchControl,
    );

    jest
      .spyOn(service, 'ensureResultsFromSlots')
      .mockResolvedValue(initialSlotResults as any);
    jest.spyOn(service, 'syncMatchPlayers').mockResolvedValue(undefined);

    await service.applyTelemetryStateToResults('m-1', {
      finalize: true,
      state: {
        matchId: 'm-1',
        status: 'ENDED',
        mode: 'AUTO',
        version: 3,
        sequence: 9,
        updatedAt: 5_000,
        startedAt: 1_000,
        endedAt: 5_000,
        teamsAlive: 1,
        teams: {
          'team-1': {
            teamId: 'team-1',
            alivePlayers: 0,
            eliminated: false,
            placement: 1,
            totalKills: 7,
            totalPlayers: 2,
            eliminatedAt: null,
            metadata: {
              slot: 1,
            },
          },
        },
        players: {},
      } as any,
    });

    expect(slotUpdates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          where: { id: 'slot-1' },
          data: expect.objectContaining({
            placement: 1,
            finalPlacement: 1,
            totalKills: 7,
            finalKills: 7,
            manualTotalKills: true,
          }),
        }),
      ]),
    );
    expect(prisma.matchSlotPlayerResult.create).toHaveBeenCalledTimes(2);
    expect(prisma.matchSlotPlayerResult.create).toHaveBeenNthCalledWith(1, {
      data: expect.objectContaining({
        slotResultId: 'slot-1',
        organizationId: 'org-1',
        playerId: 'roster-player-1',
        playerName: 'Alpha',
        pubgAccountId: 'open-1',
        externalPlayerId: 'ext-1',
        kills: 0,
        isAlive: false,
        alive: false,
        isKnocked: false,
        isAutoFilled: false,
      }),
      select: { id: true },
    });
    expect(prisma.matchSlotPlayerResult.create).toHaveBeenNthCalledWith(2, {
      data: expect.objectContaining({
        slotResultId: 'slot-1',
        organizationId: 'org-1',
        playerId: 'roster-player-2',
        playerName: 'Bravo',
        pubgAccountId: 'open-2',
        externalPlayerId: 'ext-2',
        kills: 0,
        isAlive: false,
        alive: false,
        isKnocked: false,
        isAutoFilled: false,
      }),
      select: { id: true },
    });
  });

  it('matches finalized telemetry players by external id before ambiguous lowercase name fallback', async () => {
    const initialSlotResults = [
      {
        id: 'slot-10',
        slotNumber: 10,
        teamId: 'team-8',
        manualTotalKills: false,
        wasPresentInMatch: null,
        organizationId: 'org-1',
        team: {
          players: [],
        },
        players: [
          {
            id: 'slot-player-1',
            playerId: 'player-db-1',
            playerName: '¹peaceNatriXX',
            pubgAccountId: null,
            externalPlayerId: '41339893515158824',
            kills: 0,
            isAlive: false,
            alive: false,
            isKnocked: false,
          },
          {
            id: 'slot-player-2',
            playerId: 'player-db-2',
            playerName: '¹peaceNatrixx',
            pubgAccountId: null,
            externalPlayerId: '118448644776396072',
            kills: 0,
            isAlive: false,
            alive: false,
            isKnocked: false,
          },
        ],
      },
    ];

    const playerUpdates: Array<Record<string, unknown>> = [];
    const prisma = {
      matchSlotResult: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce(initialSlotResults)
          .mockResolvedValueOnce([
            {
              players: [
                { isAlive: false, alive: false, isKnocked: false },
                { isAlive: false, alive: false, isKnocked: false },
              ],
            },
          ]),
        update: jest.fn().mockResolvedValue(undefined),
      },
      matchSlotPlayerResult: {
        update: jest.fn().mockImplementation(async (args) => {
          playerUpdates.push(args as Record<string, unknown>);
          return undefined;
        }),
        create: jest.fn().mockResolvedValue({ id: 'unexpected-create' }),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      matchPlayer: {
        upsert: jest.fn().mockResolvedValue(undefined),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    } as unknown as PrismaService;

    const service = new ResultsService(
      prisma,
      dummyEvents as ResultsEventsService,
      dummyStandings as StandingsService,
      dummyAudit as AuditService,
      dummyMatchControl,
    );

    jest
      .spyOn(service, 'ensureResultsFromSlots')
      .mockResolvedValue(initialSlotResults as any);
    jest.spyOn(service, 'syncMatchPlayers').mockResolvedValue(undefined);

    await service.applyTelemetryStateToResults('m-1', {
      finalize: true,
      state: {
        matchId: 'm-1',
        status: 'ENDED',
        mode: 'AUTO',
        version: 3,
        sequence: 9,
        updatedAt: 5_000,
        startedAt: 1_000,
        endedAt: 5_000,
        teamsAlive: 0,
        teams: {
          'team-8': {
            teamId: 'team-8',
            alivePlayers: 0,
            eliminated: true,
            placement: 13,
            totalKills: 0,
            totalPlayers: 2,
            eliminatedAt: 4_000,
            metadata: {
              slot: 10,
              wasPresentInMatch: true,
            },
          },
        },
        players: {
          'provisional:team-8:external:41339893515158824': {
            playerId: 'provisional:team-8:external:41339893515158824',
            teamId: 'team-8',
            alive: false,
            knocked: false,
            kills: 0,
            metadata: {
              playerName: '¹peaceNatriXX',
              externalPlayerId: '41339893515158824',
              observedInTelemetry: true,
              provisional: true,
            },
          },
          'provisional:team-8:external:118448644776396072': {
            playerId: 'provisional:team-8:external:118448644776396072',
            teamId: 'team-8',
            alive: false,
            knocked: false,
            kills: 0,
            metadata: {
              playerName: '¹peaceNatrixx',
              externalPlayerId: '118448644776396072',
              observedInTelemetry: true,
              provisional: true,
            },
          },
        },
      } as any,
    });

    expect(prisma.matchSlotPlayerResult.create).not.toHaveBeenCalled();
    expect(playerUpdates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          where: { id: 'slot-player-1' },
          data: expect.objectContaining({
            playerName: '¹peaceNatriXX',
            externalPlayerId: '41339893515158824',
          }),
        }),
        expect.objectContaining({
          where: { id: 'slot-player-2' },
          data: expect.objectContaining({
            playerName: '¹peaceNatrixx',
            externalPlayerId: '118448644776396072',
          }),
        }),
      ]),
    );
  });
});
