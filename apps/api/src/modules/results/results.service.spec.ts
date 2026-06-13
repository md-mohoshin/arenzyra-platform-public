import { ForbiddenException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../../db/prisma.service';
import type { ResultsEventsService } from './results-events.service';
import type { StandingsService } from '../standings/standings.service';
import type { AuditService } from '../audit/audit.service';
import { ResultsService } from './results.service';
import { Role, TeamBanScope, TeamMemberRole } from '@prisma/client';

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

function createResultsService(prisma: unknown) {
  return new ResultsService(
    prisma as PrismaService,
    dummyEvents as ResultsEventsService,
    dummyStandings as StandingsService,
    dummyAudit as AuditService,
    dummyMatchControl,
  );
}

function discordJsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function createNoShowAutoBanClient() {
  return {
    match: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'match-1',
        name: 'Game 1',
        matchNumber: 1,
        organizationId: 'org-1',
        sessionId: 'session-1',
        session: {
          id: 'session-1',
          name: 'Daily Scrim',
          discordConfig: {
            guildId: 'guild-1',
            manageRoleIds: ['staff-role'],
            emojis: {
              staffRoleId: 'staff-role',
              staffRoleName: 'Arenzyra Staff',
              noShowBanRules: JSON.stringify([
                {
                  enabled: true,
                  misses: 1,
                  durationDays: 3,
                  scope: 'SESSION',
                  reason: 'Missed {misses} match(es) in {session}',
                },
              ]),
            },
          },
        },
      }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    matchSlotResult: {
      findMany: jest.fn().mockResolvedValue([
        {
          teamId: 'team-1',
          matchId: 'match-1',
          match: { matchNumber: 1, name: 'Game 1' },
        },
      ]),
    },
    noShowBanSnapshot: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    team: {
      findMany: jest
        .fn()
        .mockResolvedValue([{ id: 'team-1', name: 'Team One', tag: 'ONE' }]),
    },
    teamMember: {
      findMany: jest.fn().mockResolvedValue([
        {
          discordUserId: 'leader-1',
          discordUsername: 'leader',
          role: TeamMemberRole.LEADER,
        },
      ]),
    },
    teamBan: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'ban-1' }),
    },
    session: {
      findMany: jest.fn().mockResolvedValue([{ id: 'session-1' }]),
    },
    sessionRegistration: {
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    matchTeam: {
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    matchSlot: {
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
  };
}

describe('ResultsService no-show auto-bans', () => {
  const originalFetch = global.fetch;
  const originalDiscordToken = process.env.DISCORD_BOT_TOKEN;

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalDiscordToken === undefined) {
      delete process.env.DISCORD_BOT_TOKEN;
    } else {
      process.env.DISCORD_BOT_TOKEN = originalDiscordToken;
    }
    jest.clearAllMocks();
  });

  function mockDiscordRoleLookups(memberRoles: string[]) {
    process.env.DISCORD_BOT_TOKEN = 'bot-token';
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      if (url.endsWith('/guilds/guild-1/roles')) {
        return discordJsonResponse([
          { id: 'staff-role', name: 'Arenzyra Staff', permissions: '0' },
          { id: 'admin-role', name: 'Admin', permissions: '8' },
          { id: 'player-role', name: 'Player', permissions: '0' },
        ]);
      }
      if (url.endsWith('/guilds/guild-1/members/leader-1')) {
        return discordJsonResponse({ roles: memberRoles });
      }
      return discordJsonResponse({}, 404);
    }) as typeof fetch;
  }

  it('keeps total-miss no-show rules when matchNumber is null', () => {
    const service = createResultsService(createNoShowAutoBanClient());
    const rules = (service as any).parseNoShowAutoBanRules(
      JSON.stringify([
        {
          enabled: true,
          type: 'TOTAL_MISSES',
          misses: 2,
          matchNumber: null,
          durationDays: null,
          scope: 'SESSION',
          reason: 'Missed {misses} match(es) in {session}',
        },
      ]),
    );

    expect(rules).toEqual([
      {
        enabled: true,
        type: 'TOTAL_MISSES',
        misses: 2,
        matchNumber: null,
        durationDays: null,
        scope: TeamBanScope.SESSION,
        reason: 'Missed {misses} match(es) in {session}',
      },
    ]);
  });

  it('skips automatic no-show bans when the team manager has a staff role', async () => {
    mockDiscordRoleLookups(['staff-role']);
    const client = createNoShowAutoBanClient();
    const service = createResultsService(client);

    await (service as any).applyNoShowAutoBans(
      client,
      'match-1',
      new Set(['team-1']),
    );

    expect(client.teamBan.create).not.toHaveBeenCalled();
    expect(client.sessionRegistration.updateMany).not.toHaveBeenCalled();
  });

  it('creates automatic no-show bans for normal team managers', async () => {
    mockDiscordRoleLookups(['player-role']);
    const client = createNoShowAutoBanClient();
    const service = createResultsService(client);

    await (service as any).applyNoShowAutoBans(
      client,
      'match-1',
      new Set(['team-1']),
    );

    expect(client.teamBan.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          teamId: 'team-1',
          scope: TeamBanScope.SESSION,
          sessionId: 'session-1',
          reason: 'Missed 1 match(es) in Daily Scrim - Missed G1',
        }),
      }),
    );
    expect(client.sessionRegistration.updateMany).toHaveBeenCalled();
  });

  it('counts stored final-result no-show snapshots when selecting the auto-ban rule', async () => {
    mockDiscordRoleLookups(['player-role']);
    const client = createNoShowAutoBanClient();
    client.match.findFirst.mockResolvedValue({
      id: 'match-2',
      name: 'Game 2',
      matchNumber: 2,
      organizationId: 'org-1',
      sessionId: 'session-1',
      session: {
        id: 'session-1',
        name: 'Daily Scrim',
        discordConfig: {
          guildId: 'guild-1',
          manageRoleIds: ['staff-role'],
          emojis: {
            staffRoleId: 'staff-role',
            staffRoleName: 'Arenzyra Staff',
            noShowBanRules: JSON.stringify([
              {
                enabled: true,
                misses: 2,
                durationDays: 3,
                scope: 'SESSION',
                reason: 'Missed {misses} match(es) in {session}',
              },
            ]),
          },
        },
      },
    });
    client.matchSlotResult.findMany.mockResolvedValue([
      {
        teamId: 'team-1',
        matchId: 'match-2',
        match: { matchNumber: 2, name: 'Game 2' },
      },
    ]);
    client.noShowBanSnapshot.findMany.mockResolvedValue([
      {
        teamId: 'team-1',
        sourceMatchId: 'match-1',
        matchNumber: 1,
        matchName: 'Game 1',
      },
    ]);
    const service = createResultsService(client);

    await (service as any).applyNoShowAutoBans(
      client,
      'match-2',
      new Set(['team-1']),
    );

    expect(client.teamBan.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          teamId: 'team-1',
          reason: 'Missed 2 match(es) in Daily Scrim - Missed G2, G1',
        }),
      }),
    );
  });

  it('prefers the highest total-miss no-show rule over lower thresholds and per-match rules', async () => {
    mockDiscordRoleLookups(['player-role']);
    const client = createNoShowAutoBanClient();
    client.match.findFirst.mockResolvedValue({
      id: 'match-4',
      name: 'Game 4',
      matchNumber: 4,
      organizationId: 'org-1',
      sessionId: 'session-1',
      session: {
        id: 'session-1',
        name: 'Daily Scrim',
        discordConfig: {
          guildId: 'guild-1',
          manageRoleIds: ['staff-role'],
          emojis: {
            staffRoleId: 'staff-role',
            staffRoleName: 'Arenzyra Staff',
            noShowBanRules: JSON.stringify([
              {
                enabled: true,
                type: 'TOTAL_MISSES',
                misses: 2,
                durationDays: 12,
                scope: 'TEAM',
                reason: 'Two misses {misses}',
              },
              {
                enabled: true,
                type: 'TOTAL_MISSES',
                misses: 3,
                durationDays: 1,
                scope: 'TEAM',
                reason: 'Three misses {misses}',
              },
              {
                enabled: true,
                type: 'MATCH_MISSED',
                matchNumber: 4,
                durationDays: 10,
                scope: 'TEAM',
                reason: 'Missed {match}',
              },
            ]),
          },
        },
      },
    });
    client.matchSlotResult.findMany.mockResolvedValue([
      {
        teamId: 'team-1',
        matchId: 'match-1',
        match: { matchNumber: 1, name: 'Game 1' },
      },
      {
        teamId: 'team-1',
        matchId: 'match-2',
        match: { matchNumber: 2, name: 'Game 2' },
      },
      {
        teamId: 'team-1',
        matchId: 'match-4',
        match: { matchNumber: 4, name: 'Game 4' },
      },
    ]);
    const service = createResultsService(client);

    const result = await (service as any).applyNoShowAutoBans(
      client,
      'match-4',
      new Set(['team-1']),
    );

    expect(client.teamBan.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          teamId: 'team-1',
          scope: TeamBanScope.TEAM,
          sessionId: null,
          expiresAt: expect.any(Date),
          reason: 'Three misses 3 - Missed G1, G2, G4',
        }),
      }),
    );
    expect(result.createdBans[0]).toEqual(
      expect.objectContaining({
        durationDays: 1,
        missedMatches: ['G1', 'G2', 'G4'],
        reason: 'Three misses 3 - Missed G1, G2, G4',
        scope: TeamBanScope.TEAM,
      }),
    );
  });

  it('supports permanent specific-match no-show rules', async () => {
    mockDiscordRoleLookups(['player-role']);
    const client = createNoShowAutoBanClient();
    client.match.findFirst.mockResolvedValue({
      id: 'match-2',
      name: 'Game 2',
      matchNumber: 2,
      organizationId: 'org-1',
      sessionId: 'session-1',
      session: {
        id: 'session-1',
        name: 'Daily Scrim',
        discordConfig: {
          guildId: 'guild-1',
          manageRoleIds: ['staff-role'],
          emojis: {
            staffRoleId: 'staff-role',
            staffRoleName: 'Arenzyra Staff',
            noShowBanRules: JSON.stringify([
              {
                enabled: true,
                type: 'TOTAL_MISSES',
                misses: 1,
                durationDays: 3,
                scope: 'SESSION',
                reason: 'Missed {misses} match(es) in {session}',
              },
              {
                enabled: true,
                type: 'MATCH_MISSED',
                matchNumber: 2,
                duration: 'PERMANENT',
                scope: 'TEAM',
                reason: 'Missed {match} in {session}',
              },
            ]),
          },
        },
      },
    });
    client.matchSlotResult.findMany.mockResolvedValue([
      {
        teamId: 'team-1',
        matchId: 'match-2',
        match: { matchNumber: 2, name: 'Game 2' },
      },
    ]);
    const service = createResultsService(client);

    const result = await (service as any).applyNoShowAutoBans(
      client,
      'match-2',
      new Set(['team-1']),
    );

    expect(client.teamBan.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          teamId: 'team-1',
          scope: TeamBanScope.TEAM,
          sessionId: null,
          expiresAt: null,
          reason: 'Missed G2 in Daily Scrim',
        }),
      }),
    );
    expect(result.createdBans[0]).toEqual(
      expect.objectContaining({
        durationDays: null,
        expiresAt: null,
        scope: TeamBanScope.TEAM,
      }),
    );
  });

  it('uses saved session no-show snapshots as final auto-ban candidates', async () => {
    mockDiscordRoleLookups(['player-role']);
    const client = createNoShowAutoBanClient();
    client.matchSlotResult.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          teamId: 'team-1',
          matchId: 'match-1',
          match: { matchNumber: 1, name: 'Game 1' },
        },
      ]);
    client.noShowBanSnapshot.findMany
      .mockResolvedValueOnce([{ teamId: 'team-1' }])
      .mockResolvedValueOnce([
        {
          teamId: 'team-1',
          sourceMatchId: 'match-1',
          matchNumber: 1,
          matchName: 'Game 1',
        },
      ]);
    const service = createResultsService(client);
    jest.spyOn(service, 'ensureMatch').mockResolvedValue({
      id: 'match-final',
      organizationId: 'org-1',
      sessionId: 'session-1',
      tournament: null,
    } as any);

    const result = await service.applyCurrentNoShowAutoBans(
      {
        id: 'user-1',
        actorId: 'user-1',
        role: Role.ORGANIZER,
        actorRole: Role.ORGANIZER,
        organizationId: 'org-1',
      } as any,
      'match-final',
    );

    expect(result.candidateTeamCount).toBe(1);
    expect(client.teamBan.create).toHaveBeenCalled();
    expect(result.createdBans).toEqual([
      expect.objectContaining({
        teamId: 'team-1',
        teamName: 'Team One',
        teamTag: 'ONE',
        reason: 'Missed 1 match(es) in Daily Scrim - Missed G1',
        missedMatches: ['G1'],
      }),
    ]);
  });
});

describe('ResultsService.ensureResultsFromSlots no-show preservation', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it('preserves an explicit manual no-show flag for the same team and slot', async () => {
    const prisma = {
      matchSlot: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'slot-5',
            slotNumber: 5,
            teamId: 'team-1',
            team: { id: 'team-1', players: [] },
          },
        ]),
      },
      match: {
        findFirst: jest.fn().mockResolvedValue({
          organizationId: 'org-1',
          dataSource: 'MANUAL',
          dataMode: 'MANUAL',
          tournament: null,
          telemetry: null,
        }),
      },
      matchSlotResult: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([
            {
              slotNumber: 5,
              teamId: 'team-1',
              wasPresentInMatch: false,
            },
          ]),
        upsert: jest.fn().mockResolvedValue({
          id: 'result-5',
          players: [],
          team: { id: 'team-1' },
        }),
        findUnique: jest.fn().mockResolvedValue({
          id: 'result-5',
          players: [],
          team: { id: 'team-1' },
        }),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      matchSlotPlayerResult: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        update: jest.fn(),
        create: jest.fn(),
      },
    } as unknown as PrismaService;
    const service = createResultsService(prisma);
    jest.spyOn(service, 'syncMatchPlayers').mockResolvedValue(undefined);

    await service.ensureResultsFromSlots('match-1');

    expect((prisma as any).matchSlotResult.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          teamId: 'team-1',
          wasPresentInMatch: false,
        }),
      }),
    );
  });
});

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

  it('rejects direct result edits while a manual-source match is LIVE', async () => {
    const prisma = {
      match: {
        findUnique: jest.fn().mockResolvedValue({
          sessionId: null,
          status: 'LIVE',
          dataSource: 'MANUAL',
          dataMode: 'MANUAL',
          liveState: 'LIVE',
          tournament: { status: 'ACTIVE', organizationId: 'org-1' },
          controlState: {
            metaJson: null,
            state: 'LIVE',
            resultsManualLock: false,
            resultsForceUnlock: false,
          },
        }),
      },
      matchSlotResult: {
        findFirst: jest.fn(),
      },
    } as unknown as PrismaService;
    const liveService = createResultsService(prisma);

    await expect(
      liveService.ensureResultsEditableByMatchId('m-live', {
        id: 'ref-1',
        actorId: 'ref-1',
        role: Role.REFEREE,
        actorRole: Role.REFEREE,
        organizationId: 'org-1',
      } as any),
    ).rejects.toThrow('Results cannot be edited while the match is LIVE.');

    expect((prisma as any).matchSlotResult.findFirst).not.toHaveBeenCalled();
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
      match: {
        findFirst: jest.fn().mockResolvedValue({
          organizationId: 'org-1',
          tournament: null,
        }),
      },
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

    const rows = await service.listSlotResultsPublic('match-1', {
      organizationId: 'org-1',
    });

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
      match: {
        findFirst: jest.fn().mockResolvedValue({
          organizationId: 'org-1',
          tournament: null,
        }),
      },
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

    const rows = await service.listSlotResultsPublic('match-1', {
      organizationId: 'org-1',
    });

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

describe('ResultsService.listSlotResultsPublic organization validation', () => {
  it('rejects cross-org slot reads before querying slot results', async () => {
    const prisma = {
      match: {
        findFirst: jest.fn().mockResolvedValue({
          organizationId: 'org-2',
          tournament: null,
        }),
      },
      matchSlotResult: {
        findMany: jest.fn(),
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
      service.listSlotResultsPublic('match-1', { organizationId: 'org-1' }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(prisma.matchSlotResult.findMany as jest.Mock).not.toHaveBeenCalled();
  });

  it('returns slot results for the same organization', async () => {
    const prisma = {
      match: {
        findFirst: jest.fn().mockResolvedValue({
          organizationId: 'org-1',
          tournament: null,
        }),
      },
      matchSlotResult: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'slot-1',
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
              name: 'Alpha',
              tag: 'ALP',
              logoUrl: null,
              updatedAt: null,
            },
            players: [],
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

    await expect(
      service.listSlotResultsPublic('match-1', { organizationId: 'org-1' }),
    ).resolves.toEqual([
      expect.objectContaining({
        id: 'slot-1',
        slotNumber: 1,
        totalKills: 5,
        totalPoints: 15,
      }),
    ]);
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

  it('updates finalized placement fields and winner metadata during manual review', async () => {
    const slotUpdates: Array<{ id: string; data: Record<string, unknown> }> =
      [];
    const controlUpsert = jest.fn().mockResolvedValue({});
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
      matchControlState: {
        findUnique: jest.fn().mockResolvedValue({
          organizationId: 'org-1',
          state: 'ENDED',
          metaJson: {
            resultFinalized: true,
            resultNeedsConfirmation: true,
            winnerTeamId: 'team-1',
          },
        }),
        upsert: controlUpsert,
      },
    };

    const prisma = {
      matchSlotResult: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'slot-one',
            matchId: 'm-1',
            slotNumber: 1,
            teamId: 'team-1',
            organizationId: 'org-1',
            wasPresentInMatch: true,
            placement: 1,
            finalPlacement: 1,
            totalKills: 8,
            totalPoints: 18,
            points: 18,
            isLocked: true,
            players: [],
          },
          {
            id: 'slot-two',
            matchId: 'm-1',
            slotNumber: 2,
            teamId: 'team-2',
            organizationId: 'org-1',
            wasPresentInMatch: true,
            placement: 2,
            finalPlacement: 2,
            totalKills: 4,
            totalPoints: 10,
            points: 10,
            isLocked: true,
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

    const service = new ResultsService(
      prisma,
      dummyEvents as ResultsEventsService,
      dummyStandings as StandingsService,
      dummyAudit as AuditService,
      dummyMatchControl,
    );

    jest.spyOn(service as any, 'ensureMatch').mockResolvedValue({
      id: 'm-1',
      status: 'FINISHED',
      tournamentId: null,
      organizationId: 'org-1',
      sessionId: 'session-1',
      controlState: {
        state: 'ENDED',
        metaJson: {
          resultFinalized: true,
          resultNeedsConfirmation: true,
          winnerTeamId: 'team-1',
        },
        resultsManualLock: false,
        resultsForceUnlock: true,
      },
      tournament: null,
    });
    jest
      .spyOn(service, 'ensureResultsEditable')
      .mockResolvedValue(undefined as any);
    jest.spyOn(service as any, 'rulesetConfig').mockResolvedValue({
      placementPoints: { 1: 10, 2: 6 },
      killPoints: 1,
      rulesetId: null,
      gameKey: 'PUBG_MOBILE',
    });
    jest
      .spyOn(service as any, 'persistManualSyncOverrides')
      .mockResolvedValue({ version: 2 });
    jest.spyOn(service, 'recalculateMatchResults').mockResolvedValue(undefined);

    await expect(
      service.setPlacements(
        { id: 'admin', actorId: 'admin', role: Role.SUPER_ADMIN } as any,
        'm-1',
        [
          { teamId: 'team-1', placement: 2 },
          { teamId: 'team-2', placement: 1 },
        ],
      ),
    ).resolves.toMatchObject({ ok: true, version: 2 });

    expect(slotUpdates).toEqual([
      expect.objectContaining({
        id: 'slot-one',
        data: expect.objectContaining({ placement: 2, finalPlacement: 2 }),
      }),
      expect.objectContaining({
        id: 'slot-two',
        data: expect.objectContaining({ placement: 1, finalPlacement: 1 }),
      }),
    ]);
    expect(controlUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          metaJson: expect.objectContaining({
            winnerTeamId: 'team-2',
            resultNeedsConfirmation: false,
          }),
        }),
      }),
    );
  });
});

describe('ResultsService.setManualMatchResults', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('saves a complete manual result from active slot teams', async () => {
    const slotUpdates: Array<{ id: string; data: Record<string, unknown> }> =
      [];
    const playerUpdates: Array<{ id: string; data: Record<string, unknown> }> =
      [];
    const slots = [
      {
        id: 'slot-one',
        matchId: 'm-1',
        slotNumber: 1,
        teamId: 'team-1',
        organizationId: 'org-1',
        wasPresentInMatch: true,
        placement: null,
        totalKills: 0,
        manualTotalKills: false,
        eliminatedAt: null,
        players: [
          {
            id: 'player-one',
            playerId: null,
            kills: 0,
            isAlive: true,
            alive: true,
            isKnocked: false,
          },
        ],
      },
      {
        id: 'slot-two',
        matchId: 'm-1',
        slotNumber: 2,
        teamId: 'team-2',
        organizationId: 'org-1',
        wasPresentInMatch: true,
        placement: null,
        totalKills: 0,
        manualTotalKills: false,
        eliminatedAt: null,
        players: [
          {
            id: 'player-two',
            playerId: null,
            kills: 0,
            isAlive: true,
            alive: true,
            isKnocked: false,
          },
        ],
      },
    ];
    const tx = {
      matchSlotResult: {
        findMany: jest.fn().mockResolvedValue(slots),
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
      matchSlotPlayerResult: {
        update: jest
          .fn()
          .mockImplementation(
            async (args: Prisma.MatchSlotPlayerResultUpdateArgs) => {
              playerUpdates.push({
                id: String(args.where?.id),
                data: args.data as Record<string, unknown>,
              });
              return { id: args.where?.id, ...(args.data as object) };
            },
          ),
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

    jest.spyOn(service as any, 'ensureMatch').mockResolvedValue({
      id: 'm-1',
      status: 'FINISHED',
      sessionId: 'session-1',
      organizationId: 'org-1',
      dataSource: 'MANUAL',
      dataMode: 'MANUAL',
      controlState: null,
      tournament: null,
      game: { key: 'PUBG_MOBILE' },
    });
    jest
      .spyOn(service as any, 'ensureResultsEditable')
      .mockResolvedValue(undefined);
    jest
      .spyOn(service as any, 'ensureResultsFromSlots')
      .mockResolvedValue(slots as any);
    jest.spyOn(service as any, 'rulesetConfig').mockResolvedValue({
      placementPoints: { 1: 10, 2: 6 },
      killPoints: 1,
    });
    jest
      .spyOn(service as any, 'persistManualSyncOverrides')
      .mockResolvedValue({ version: 9 });
    jest.spyOn(service, 'recalculateMatchResults').mockResolvedValue(undefined);
    jest
      .spyOn(service as any, 'publishManualMirrorFromResults')
      .mockResolvedValue(undefined);

    await expect(
      service.setManualMatchResults(
        {
          id: 'admin',
          actorId: 'admin',
          role: Role.ORGANIZER,
          actorRole: Role.ORGANIZER,
          organizationId: 'org-1',
        } as any,
        'm-1',
        [
          { teamId: 'team-1', placement: 1, kills: 7 },
          { teamId: 'team-2', placement: 2, kills: 3 },
        ],
      ),
    ).resolves.toMatchObject({ ok: true, version: 9, updatedCount: 2 });

    expect(slotUpdates).toEqual([
      expect.objectContaining({
        id: 'slot-one',
        data: expect.objectContaining({
          placement: 1,
          totalKills: 7,
          manualTotalKills: true,
          placementAuto: false,
          isLocked: false,
          placementPoints: 10,
          totalPoints: 17,
        }),
      }),
      expect.objectContaining({
        id: 'slot-two',
        data: expect.objectContaining({
          placement: 2,
          totalKills: 3,
          manualTotalKills: true,
          placementAuto: false,
          eliminatedOrder: 1,
          isLocked: true,
          placementPoints: 6,
          totalPoints: 9,
        }),
      }),
    ]);
    expect(playerUpdates).toEqual([
      expect.objectContaining({
        id: 'player-one',
        data: expect.objectContaining({ isAlive: true, alive: true }),
      }),
      expect.objectContaining({
        id: 'player-two',
        data: expect.objectContaining({ isAlive: false, alive: false }),
      }),
    ]);
  });
});

describe('ResultsService.updateTeamPlayers anonymous identity', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('preserves saved placement when player result edits are saved', async () => {
    let playerState = {
      id: 'player-result-1',
      slotResultId: 'slot-result-1',
      playerId: null,
      playerName: 'Winner',
      kills: 0,
      isKnocked: false,
      isAlive: true,
      alive: true,
      assists: 0,
      organizationId: 'org-1',
      player: null,
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
    const otherSlot = {
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
      players: [
        {
          id: 'player-result-2',
          slotResultId: 'slot-result-2',
          playerId: null,
          playerName: 'Alive',
          kills: 0,
          isKnocked: false,
          isAlive: true,
          alive: true,
          assists: 0,
        },
      ],
      team: { id: 'team-2', name: 'Team Two', tag: 'TWO', logoUrl: null },
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
        findMany: jest.fn().mockResolvedValue([{ ...slotState }, otherSlot]),
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
      status: 'FINISHED',
      liveState: 'FINISHED',
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
    jest
      .spyOn(service as any, 'ensureResultsFromSlots')
      .mockResolvedValue([{ ...slotState }, otherSlot] as any);
    jest.spyOn(service as any, 'rulesetConfig').mockResolvedValue({
      placementPoints: { 1: 10, 2: 6 },
      killPoints: 1,
    });
    jest.spyOn(service as any, 'syncMatchPlayers').mockResolvedValue(undefined);
    jest.spyOn(service as any, 'auditEdit').mockResolvedValue(undefined);

    await service.updateTeamPlayers(
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
            kills: 2,
            alive: true,
            knocked: false,
          },
        ],
      },
    );

    expect(tx.matchSlotResult.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'slot-result-1' },
        data: expect.objectContaining({
          placement: 1,
        }),
      }),
    );
    expect(slotState.placement).toBe(1);
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
    expect(result.sourceMode).toBe('MANUAL');
  });

  it('reuses an existing roster player when telemetry first arrives with a new external id', async () => {
    const playerClient = {
      findUnique: jest
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null),
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'player-1',
          ign: 'Alpha One',
          photoUrl: null,
          externalId: null,
          externalPlayerId: null,
          playerOpenId: null,
        },
      ]),
      update: jest.fn().mockResolvedValue({
        id: 'player-1',
        ign: 'Alpha One',
        photoUrl: null,
        externalPlayerId: 'ext-alpha-1',
        playerOpenId: null,
      }),
      upsert: jest.fn(),
    };

    const prisma = {
      player: playerClient,
    } as unknown as PrismaService;

    const service = new ResultsService(
      prisma,
      dummyEvents as ResultsEventsService,
      dummyStandings as StandingsService,
      dummyAudit as AuditService,
      dummyMatchControl,
    );

    const result = await (
      service as unknown as {
        materializeTelemetryPlayer: (
          client: typeof prisma,
          params: {
            organizationId: string;
            teamId: string | null;
            player: {
              name: string;
              externalPlayerId: string;
              pubgAccountId: null;
            };
          },
        ) => Promise<{
          id: string;
          ign: string;
          photoUrl: string | null;
          externalPlayerId: string | null;
          playerOpenId: string | null;
        } | null>;
      }
    ).materializeTelemetryPlayer(prisma, {
      organizationId: 'org-1',
      teamId: 'team-1',
      player: {
        name: 'Alpha One',
        externalPlayerId: 'ext-alpha-1',
        pubgAccountId: null,
      },
    });

    expect(playerClient.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: 'org-1',
          teamId: 'team-1',
        }),
      }),
    );
    expect(playerClient.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'player-1' },
        data: expect.objectContaining({
          teamId: 'team-1',
          ign: 'Alpha One',
          externalId: 'ext-alpha-1',
          externalPlayerId: 'ext-alpha-1',
          externalSource: 'PUBG_TELEMETRY',
        }),
      }),
    );
    expect(playerClient.upsert).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      id: 'player-1',
      externalPlayerId: 'ext-alpha-1',
    });
  });
});

describe('ResultsService.updateTeamPlayers live sync', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects manual player edits while a manual-source match is LIVE', async () => {
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

    await expect(
      service.updateTeamPlayers(
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
      ),
    ).rejects.toThrow('Results cannot be edited while the match is LIVE.');

    expect(tx.matchControlState.upsert).not.toHaveBeenCalled();
    expect(liveStateMirror.publish).not.toHaveBeenCalled();
  });

  it('blocks live manual-source player corrections before touching persisted slots', async () => {
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

    await expect(
      service.updateTeamPlayers(
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
      ),
    ).rejects.toThrow('Results cannot be edited while the match is LIVE.');

    expect(tx.matchSlotResult.update).not.toHaveBeenCalled();
    expect(tx.matchSlotPlayerResult.update).not.toHaveBeenCalled();
    expect(slotB).toMatchObject({
      placement: null,
      totalKills: 0,
      points: 0,
      totalPoints: 0,
      isLocked: false,
    });
    expect(liveStateMirror.publish).not.toHaveBeenCalled();
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

describe('ResultsService canonical mirror publishing', () => {
  it('routes telemetry-owned live player republishes back through the telemetry engine', async () => {
    const prisma = {
      match: {
        findUnique: jest.fn().mockResolvedValue({
          status: 'LIVE',
          startedAt: null,
          endedAt: null,
          dataSource: 'PCOB',
          dataMode: 'AUTO',
          controlState: {
            state: 'LIVE',
            authorityMode: 'AUTO',
            metaJson: {},
          },
        }),
      },
      matchSlotResult: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    } as unknown as PrismaService;
    const liveStateMirror = {
      publish: jest.fn(),
    };
    const matchControlStateStore = {
      get: jest.fn().mockResolvedValue({
        matchId: 'm-1',
        status: 'LIVE',
        sourceMode: 'AUTO',
        teams: [],
      }),
    };
    const telemetryEngine = {
      republishMirror: jest.fn().mockResolvedValue(undefined),
    };
    const service = new ResultsService(
      prisma,
      dummyEvents as ResultsEventsService,
      dummyStandings as StandingsService,
      dummyAudit as AuditService,
      dummyMatchControl,
      liveStateMirror as any,
      matchControlStateStore as any,
      telemetryEngine as any,
    );

    await (service as any).publishManualMirrorFromResults('m-1', 4);

    expect(telemetryEngine.republishMirror).toHaveBeenCalledWith('m-1');
    expect(liveStateMirror.publish).not.toHaveBeenCalled();
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
        findUnique: jest.fn().mockResolvedValue({
          id: 'm-1',
          tournamentId: 't-1',
          stageId: 'stage-1',
          groupId: 'group-1',
          sessionId: null,
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
        findMany: jest.fn().mockResolvedValue(
          adjustmentDelta
            ? [
                {
                  teamId: 'team-1',
                  pointsDelta: adjustmentDelta,
                  scope: 'MATCH',
                  type: 'POINT_DELTA',
                  matchId: 'm-1',
                  groupId: null,
                  stageId: null,
                  tournamentId: 't-1',
                  sessionId: null,
                  deletedAt: null,
                  revokedAt: null,
                },
              ]
            : [],
        ),
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

  it('clears stale player rows when explicit telemetry marks a slot absent from the match', async () => {
    const initialSlotResults = [
      {
        id: 'slot-14',
        slotNumber: 14,
        teamId: 'team-14',
        manualTotalKills: false,
        wasPresentInMatch: null,
        organizationId: 'org-1',
        team: {
          players: [],
        },
        players: [
          {
            id: 'slot-player-14-a',
            playerId: 'player-14-a',
            playerName: 'Ghost One',
            pubgAccountId: null,
            externalPlayerId: null,
            kills: 0,
            isAlive: true,
            alive: true,
            isKnocked: false,
          },
        ],
      },
      {
        id: 'slot-15',
        slotNumber: 15,
        teamId: 'team-15',
        manualTotalKills: false,
        wasPresentInMatch: null,
        organizationId: 'org-1',
        team: {
          players: [],
        },
        players: [],
      },
    ];

    const prisma = {
      matchSlotResult: {
        findMany: jest.fn().mockResolvedValue(initialSlotResults),
        update: jest.fn().mockResolvedValue(undefined),
      },
      matchSlotPlayerResult: {
        update: jest.fn().mockResolvedValue(undefined),
        create: jest.fn().mockResolvedValue({ id: 'slot-player-15-a' }),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
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
      state: {
        matchId: 'm-1',
        status: 'LIVE',
        mode: 'AUTO',
        version: 4,
        sequence: 10,
        updatedAt: 6_000,
        startedAt: 1_000,
        endedAt: null,
        telemetryAcceptedAt: 6_000,
        telemetryAcceptedSource: 'API',
        teamsAlive: 1,
        teams: {
          'team-15': {
            teamId: 'team-15',
            alivePlayers: 1,
            eliminated: false,
            placement: null,
            totalKills: 0,
            totalPlayers: 1,
            eliminatedAt: null,
            metadata: {
              slot: 15,
              wasPresentInMatch: true,
              observedInTelemetry: true,
            },
          },
        },
        players: {
          'player-15-a': {
            playerId: 'player-15-a',
            teamId: 'team-15',
            alive: true,
            knocked: false,
            kills: 0,
            metadata: {
              playerName: 'Live One',
              observedInTelemetry: true,
              slotPlayerResultId: 'slot-player-15-a',
            },
          },
        },
        circle: { phase: 2 },
      } as any,
    });

    expect(prisma.matchSlotPlayerResult.deleteMany).toHaveBeenCalledWith({
      where: { slotResultId: 'slot-14' },
    });
    expect(prisma.matchSlotResult.update).toHaveBeenCalledWith({
      where: { id: 'slot-14' },
      data: expect.objectContaining({
        wasPresentInMatch: false,
        totalKills: 0,
      }),
    });
  });
});

describe('ResultsService live telemetry sync on fetch', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('syncs slot results from telemetry before returning live automatic results', async () => {
    const prisma = {
      match: {
        findFirst: jest.fn().mockResolvedValue({
          organizationId: 'org-1',
          tournament: null,
          status: 'LIVE',
          liveState: 'LIVE',
          dataSource: null,
          dataMode: 'AUTO',
          controlState: {
            state: 'LIVE',
            metaJson: null,
            resultsManualLock: false,
            resultsForceUnlock: false,
          },
        }),
      },
      matchSlotResult: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'slot-result-1',
            matchId: 'm-live',
            slotNumber: 1,
            teamId: 'team-1',
            wasPresentInMatch: true,
            placement: 1,
            totalKills: 4,
            points: 14,
            totalPoints: 14,
            finalPlacement: null,
            finalKills: null,
            team: {
              id: 'team-1',
              name: 'Alpha',
              tag: 'ALP',
              logoUrl: null,
              updatedAt: null,
            },
            players: [],
          },
        ]),
      },
    } as unknown as PrismaService;

    const telemetryEngine = {
      getState: jest.fn().mockResolvedValue({
        matchId: 'm-live',
        status: 'LIVE',
        mode: 'AUTO',
        version: 1,
        sequence: 1,
        updatedAt: 2_000,
        telemetryAcceptedAt: 2_000,
        telemetryAcceptedSource: 'LAUNCHER',
        startedAt: 1_000,
        endedAt: null,
        teamsAlive: 1,
        circle: null,
        killFeed: [],
        events: [],
        teams: {
          'team-1': {
            teamId: 'team-1',
            alivePlayers: 4,
            eliminated: false,
            placement: 1,
            totalKills: 4,
            totalPlayers: 4,
            eliminatedAt: null,
            metadata: {
              slot: 1,
              wasPresentInMatch: true,
              observedInTelemetry: true,
            },
          },
        },
        players: {
          'player-1': {
            playerId: 'player-1',
            teamId: 'team-1',
            alive: true,
            knocked: false,
            kills: 2,
            metadata: {
              playerName: 'Alpha 1',
              observedInTelemetry: true,
            },
          },
        },
      }),
    };

    const service = new ResultsService(
      prisma,
      dummyEvents as ResultsEventsService,
      dummyStandings as StandingsService,
      dummyAudit as AuditService,
      dummyMatchControl,
      undefined as any,
      undefined as any,
      telemetryEngine as any,
    );

    const applySpy = jest
      .spyOn(service, 'applyTelemetryStateToResults')
      .mockResolvedValue(undefined);
    const recalcSpy = jest
      .spyOn(service, 'recalculateMatchResults')
      .mockResolvedValue(undefined);

    const results = await service.listSlotResultsPublic('m-live', {
      organizationId: 'org-1',
    });

    expect(applySpy).toHaveBeenCalledWith(
      'm-live',
      expect.objectContaining({
        state: expect.objectContaining({
          matchId: 'm-live',
          telemetryAcceptedSource: 'LAUNCHER',
        }),
      }),
    );
    expect(recalcSpy).toHaveBeenCalledWith('m-live');
    expect(results).toHaveLength(1);
    expect(prisma.matchSlotResult.findMany as jest.Mock).toHaveBeenCalled();
  });

  it('skips telemetry sync during the early air phase', async () => {
    const prisma = {
      match: {
        findFirst: jest.fn().mockResolvedValue({
          organizationId: 'org-1',
          tournament: null,
          status: 'LIVE',
          liveState: 'LIVE',
          dataSource: null,
          dataMode: 'AUTO',
          controlState: {
            state: 'LIVE',
            metaJson: null,
            resultsManualLock: false,
            resultsForceUnlock: false,
          },
        }),
      },
      matchSlotResult: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'slot-result-1',
            matchId: 'm-live',
            slotNumber: 1,
            teamId: 'team-1',
            wasPresentInMatch: true,
            placement: null,
            totalKills: 0,
            points: 0,
            totalPoints: 0,
            finalPlacement: null,
            finalKills: null,
            team: {
              id: 'team-1',
              name: 'Alpha',
              tag: 'ALP',
              logoUrl: null,
              updatedAt: null,
            },
            players: [],
          },
        ]),
      },
    } as unknown as PrismaService;

    const telemetryEngine = {
      getState: jest.fn().mockResolvedValue({
        matchId: 'm-live',
        status: 'LIVE',
        mode: 'AUTO',
        version: 1,
        sequence: 1,
        updatedAt: 2_000,
        telemetryAcceptedAt: 2_000,
        telemetryAcceptedSource: 'LAUNCHER',
        startedAt: 1_000,
        endedAt: null,
        teamsAlive: 16,
        circle: { phase: 1 },
        killFeed: [],
        events: [],
        teams: {
          'team-1': {
            teamId: 'team-1',
            alivePlayers: 4,
            eliminated: false,
            placement: null,
            totalKills: 0,
            totalPlayers: 4,
            eliminatedAt: null,
            metadata: {
              slot: 1,
              wasPresentInMatch: true,
              observedInTelemetry: true,
            },
          },
        },
        players: {
          'player-1': {
            playerId: 'player-1',
            teamId: 'team-1',
            alive: true,
            knocked: false,
            kills: 0,
            metadata: {
              playerName: 'Alpha 1',
              observedInTelemetry: true,
            },
          },
        },
      }),
    };

    const service = new ResultsService(
      prisma,
      dummyEvents as ResultsEventsService,
      dummyStandings as StandingsService,
      dummyAudit as AuditService,
      dummyMatchControl,
      undefined as any,
      undefined as any,
      telemetryEngine as any,
    );

    const applySpy = jest
      .spyOn(service, 'applyTelemetryStateToResults')
      .mockResolvedValue(undefined);
    const recalcSpy = jest
      .spyOn(service, 'recalculateMatchResults')
      .mockResolvedValue(undefined);

    const results = await service.listSlotResultsPublic('m-live', {
      organizationId: 'org-1',
    });

    expect(applySpy).not.toHaveBeenCalled();
    expect(recalcSpy).not.toHaveBeenCalled();
    expect(results).toHaveLength(1);
    expect(prisma.matchSlotResult.findMany as jest.Mock).toHaveBeenCalled();
  });

  it('suppresses stale persisted player rows for live API matches until telemetry is accepted', async () => {
    const prisma = {
      match: {
        findFirst: jest.fn().mockResolvedValue({
          organizationId: 'org-1',
          tournament: null,
          status: 'LIVE',
          liveState: 'LIVE',
          dataSource: 'API',
          dataMode: 'MANUAL',
          controlState: {
            state: 'LIVE',
            metaJson: null,
            resultsManualLock: false,
            resultsForceUnlock: false,
          },
        }),
      },
      matchSlotResult: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'slot-result-1',
            matchId: 'm-live',
            slotNumber: 1,
            teamId: 'team-1',
            wasPresentInMatch: null,
            placement: null,
            totalKills: 0,
            points: 0,
            totalPoints: 0,
            finalPlacement: null,
            finalKills: null,
            team: {
              id: 'team-1',
              name: 'Alpha',
              tag: 'ALP',
              logoUrl: null,
              updatedAt: null,
            },
            players: [
              {
                id: 'slot-player-1',
                slotResultId: 'slot-result-1',
                createdAt: new Date('2026-04-20T17:09:32.197Z'),
                playerId: 'player-1',
                playerName: 'Alpha 1',
                kills: 0,
                knocks: 0,
                isKnocked: false,
                isAlive: true,
                alive: true,
                isAutoFilled: false,
                updatedAt: new Date('2026-04-20T17:12:45.703Z'),
                organizationId: 'org-1',
                player: {
                  externalPlayerId: null,
                  ign: 'Alpha 1',
                  inGameId: 'Alpha 1',
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

    const telemetryEngine = {
      getState: jest.fn().mockResolvedValue(null),
    };

    const service = new ResultsService(
      prisma,
      dummyEvents as ResultsEventsService,
      dummyStandings as StandingsService,
      dummyAudit as AuditService,
      dummyMatchControl,
      undefined as any,
      undefined as any,
      telemetryEngine as any,
    );

    const applySpy = jest
      .spyOn(service, 'applyTelemetryStateToResults')
      .mockResolvedValue(undefined);

    const results = await service.listSlotResultsPublic('m-live', {
      organizationId: 'org-1',
    });

    expect(applySpy).not.toHaveBeenCalled();
    expect(results).toHaveLength(1);
    expect(results[0]?.players).toEqual([]);
  });

  it('keeps explicitly present player rows visible for live API matches before telemetry is accepted', async () => {
    const prisma = {
      match: {
        findFirst: jest.fn().mockResolvedValue({
          organizationId: 'org-1',
          tournament: null,
          status: 'LIVE',
          liveState: 'LIVE',
          dataSource: 'API',
          dataMode: 'MANUAL',
          controlState: {
            state: 'LIVE',
            metaJson: null,
            resultsManualLock: false,
            resultsForceUnlock: false,
          },
        }),
      },
      matchSlotResult: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'slot-result-1',
            matchId: 'm-live',
            slotNumber: 1,
            teamId: 'team-1',
            wasPresentInMatch: true,
            placement: null,
            totalKills: 0,
            points: 0,
            totalPoints: 0,
            finalPlacement: null,
            finalKills: null,
            team: {
              id: 'team-1',
              name: 'Alpha',
              tag: 'ALP',
              logoUrl: null,
              updatedAt: null,
            },
            players: [
              {
                id: 'slot-player-1',
                slotResultId: 'slot-result-1',
                createdAt: new Date('2026-04-20T17:09:32.197Z'),
                playerId: 'player-1',
                playerName: 'Alpha 1',
                kills: 0,
                knocks: 0,
                isKnocked: false,
                isAlive: true,
                alive: true,
                isAutoFilled: false,
                updatedAt: new Date('2026-04-20T17:12:45.703Z'),
                organizationId: 'org-1',
                player: {
                  externalPlayerId: null,
                  ign: 'Alpha 1',
                  inGameId: 'Alpha 1',
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

    const telemetryEngine = {
      getState: jest.fn().mockResolvedValue(null),
    };

    const service = new ResultsService(
      prisma,
      dummyEvents as ResultsEventsService,
      dummyStandings as StandingsService,
      dummyAudit as AuditService,
      dummyMatchControl,
      undefined as any,
      undefined as any,
      telemetryEngine as any,
    );

    const results = await service.listSlotResultsPublic('m-live', {
      organizationId: 'org-1',
    });

    expect(results).toHaveLength(1);
    expect(results[0]?.players).toHaveLength(1);
    expect(results[0]?.players[0]).toMatchObject({
      playerId: 'player-1',
      name: 'Alpha 1',
    });
  });
});

describe('ResultsService.resetLiveProjection', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('clears carried-over API player rows and stale finalization snapshots', async () => {
    const prisma = {
      match: {
        findFirst: jest.fn().mockResolvedValue({
          dataSource: 'API',
          dataMode: 'MANUAL',
        }),
      },
      matchSlotResult: {
        findMany: jest.fn().mockResolvedValue([{ id: 'slot-result-1' }]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      matchSlotPlayerResult: {
        deleteMany: jest.fn().mockResolvedValue({ count: 4 }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      matchControlState: {
        findUnique: jest.fn().mockResolvedValue({
          organizationId: 'org-1',
          state: 'LIVE',
          metaJson: {
            resultFinalized: true,
            lastPlayerSnapshot: { players: [{ playerName: 'Alpha 1' }] },
            lastScoreboardSnapshot: { rows: [{ teamName: 'Alpha' }] },
            liveSync: { version: 3 },
          },
        }),
        upsert: jest.fn().mockResolvedValue(undefined),
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

    jest.spyOn(service, 'ensureResultsFromSlots').mockResolvedValue([] as any);
    jest.spyOn(service, 'syncMatchPlayers').mockResolvedValue(undefined);

    await service.resetLiveProjection('m-live');

    expect(prisma.matchSlotPlayerResult.deleteMany).toHaveBeenCalledWith({
      where: {
        slotResultId: { in: ['slot-result-1'] },
      },
    });
    expect(prisma.matchSlotPlayerResult.updateMany).not.toHaveBeenCalled();
    expect(prisma.matchControlState.upsert).toHaveBeenCalledWith({
      where: { matchId: 'm-live' },
      update: {
        metaJson: {},
      },
      create: {
        matchId: 'm-live',
        organizationId: 'org-1',
        state: 'LIVE',
        metaJson: {},
      },
    });
  });
});

describe('ResultsService.syncAcceptedLiveTelemetryProjection', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('syncs accepted live telemetry projections into slot results', async () => {
    const prisma = {} as PrismaService;
    const service = new ResultsService(
      prisma,
      dummyEvents as ResultsEventsService,
      dummyStandings as StandingsService,
      dummyAudit as AuditService,
      dummyMatchControl,
    );
    const state = {
      matchId: 'm-live',
      status: 'LIVE',
      mode: 'AUTO',
      version: 12,
      updatedAt: 1_710_000_200_000,
      telemetryAcceptedAt: 1_710_000_200_000,
      telemetryAcceptedSource: 'API',
      circle: { phase: 2 },
      players: {
        'player-1': {
          playerId: 'player-1',
          teamId: 'team-1',
          alive: true,
          knocked: false,
          kills: 0,
          metadata: {
            observedInTelemetry: true,
            slotPlayerResultId: 'slot-player-1',
          },
        },
      },
      teams: {
        'team-1': {
          teamId: 'team-1',
          alivePlayers: 1,
          eliminated: false,
          placement: null,
          totalKills: 0,
          totalPlayers: 1,
          eliminatedAt: null,
          metadata: {
            wasPresentInMatch: true,
          },
        },
      },
    } as any;
    const context = {
      lifecycleStatus: 'LIVE',
      isManualSource: false,
      resultsManualLock: false,
      resultsForceUnlock: false,
      telemetryState: state,
      hasAcceptedTelemetry: true,
      isEarlyAirPhase: false,
    };

    const applySpy = jest
      .spyOn(service, 'applyTelemetryStateToResults')
      .mockResolvedValue(undefined);
    const recalcSpy = jest
      .spyOn(service, 'recalculateMatchResults')
      .mockResolvedValue(undefined);

    const synced = await service.syncAcceptedLiveTelemetryProjection(state, {
      source: 'TELEMETRY_PIPELINE',
      context,
    });

    expect(synced).toBe(true);
    expect(applySpy).toHaveBeenCalledWith('m-live', { state });
    expect(recalcSpy).toHaveBeenCalledWith('m-live');
  });

  it('throttles repeated live telemetry projection syncs for the same match', async () => {
    const prisma = {} as PrismaService;
    const service = new ResultsService(
      prisma,
      dummyEvents as ResultsEventsService,
      dummyStandings as StandingsService,
      dummyAudit as AuditService,
      dummyMatchControl,
    );
    const state = {
      matchId: 'm-live',
      status: 'LIVE',
      mode: 'AUTO',
      version: 12,
      updatedAt: 1_710_000_200_000,
      telemetryAcceptedAt: 1_710_000_200_000,
      telemetryAcceptedSource: 'API',
      circle: { phase: 2 },
      players: {
        'player-1': {
          playerId: 'player-1',
          teamId: 'team-1',
          alive: true,
          knocked: false,
          kills: 0,
          metadata: {
            observedInTelemetry: true,
            slotPlayerResultId: 'slot-player-1',
          },
        },
      },
      teams: {
        'team-1': {
          teamId: 'team-1',
          alivePlayers: 1,
          eliminated: false,
          placement: null,
          totalKills: 0,
          totalPlayers: 1,
          eliminatedAt: null,
          metadata: {
            wasPresentInMatch: true,
          },
        },
      },
    } as any;
    const context = {
      lifecycleStatus: 'LIVE',
      isManualSource: false,
      resultsManualLock: false,
      resultsForceUnlock: false,
      telemetryState: state,
      hasAcceptedTelemetry: true,
      isEarlyAirPhase: false,
    };

    const applySpy = jest
      .spyOn(service, 'applyTelemetryStateToResults')
      .mockResolvedValue(undefined);
    const recalcSpy = jest
      .spyOn(service, 'recalculateMatchResults')
      .mockResolvedValue(undefined);

    const first = await service.syncAcceptedLiveTelemetryProjection(state, {
      source: 'TELEMETRY_PIPELINE',
      context,
    });
    const second = await service.syncAcceptedLiveTelemetryProjection(state, {
      source: 'TELEMETRY_PIPELINE',
      context,
    });

    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(applySpy).toHaveBeenCalledTimes(1);
    expect(recalcSpy).toHaveBeenCalledTimes(1);
  });
});
