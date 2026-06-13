import { StandingsService } from './standings.service';
import { LiveState } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../../db/prisma.service';

class PrismaMock {
  matchData: any = {
    id: 'match-1',
    organizationId: 'org-1',
    tournamentId: 'tour-1',
    status: 'DRAFT',
    liveState: null,
    dataSource: 'MANUAL',
    dataMode: 'MANUAL',
    tournament: {
      organizationId: 'org-1',
      ownerUserId: 'owner-1',
      rulesetId: null,
      ruleset: null,
      game: 'PUBG_MOBILE',
    },
    ruleset: null,
    controlState: null,
  };

  match = {
    findFirst: (args: Prisma.MatchFindFirstArgs) => {
      if (args.where?.id !== 'match-1') return Promise.resolve(null);
      return Promise.resolve(this.matchData);
    },
  };

  ruleset = {
    findUnique: () => Promise.resolve(null),
    findFirst: () => Promise.resolve(null),
  };

  adminAdjustment = {
    findMany: () => Promise.resolve([]),
  };

  matchSlotResultData = [
    {
      id: 'slot-a',
      matchId: 'match-1',
      teamId: 'team-a',
      slotNumber: 1,
      placement: 1,
      placementPoints: 10,
      totalKills: 5,
      totalPoints: 15,
      isLocked: false,
      team: {
        id: 'team-a',
        name: 'Alpha',
        tag: 'A',
        logoUrl: null,
        logoLightUrl: null,
        logoDarkUrl: null,
      },
    },
    {
      id: 'slot-b',
      matchId: 'match-1',
      teamId: 'team-b',
      slotNumber: 2,
      placement: 2,
      placementPoints: 6,
      totalKills: 5,
      totalPoints: 11,
      isLocked: false,
      team: {
        id: 'team-b',
        name: 'Beta',
        tag: 'B',
        logoUrl: null,
        logoLightUrl: null,
        logoDarkUrl: null,
      },
    },
  ];

  matchSlotResult = {
    findMany: (args: Prisma.MatchSlotResultFindManyArgs) => {
      const filtered = this.matchSlotResultData.filter(
        (row) => row.matchId === (args.where as { matchId?: string }).matchId,
      );
      return Promise.resolve(filtered);
    },
    findFirst: (args: Prisma.MatchSlotResultFindFirstArgs) => {
      const locked = (args.where as { isLocked?: boolean })?.isLocked;
      if (locked) {
        return Promise.resolve(
          this.matchSlotResultData.find((r) => r.isLocked) ?? null,
        );
      }
      return Promise.resolve(null);
    },
    updateMany: () => Promise.resolve({ count: 0 }),
  };

  matchStateSnapshotData: { stateJson: Record<string, unknown> | null } | null =
    null;
  matchStateSnapshot = {
    findUnique: () => Promise.resolve(this.matchStateSnapshotData),
  };

  matchSlotPlayerResultData: Array<{
    isAlive: boolean;
    slotResult: { teamId: string | null };
  }> = [];
  matchSlotPlayerResult = {
    findMany: () => Promise.resolve(this.matchSlotPlayerResultData),
  };

  pcobState = {
    findUnique: () => Promise.resolve(null),
  };
}

describe('StandingsService (slot results)', () => {
  it('ranks teams by slot results without round tables', async () => {
    const prisma = new PrismaMock();
    const service = new StandingsService(prisma as unknown as PrismaService);

    const result = await service.computeMatchStandings('match-1');

    expect(result.standings.map((r) => r.teamId)).toEqual(['team-a', 'team-b']);
    expect(result.standings[0].totalPoints).toBe(15);
    expect(result.isLocked).toBe(false);
    expect(result.aliveTeams).toBeNull();
  });

  it('ignores stale snapshot alive-team state when the current live match has no telemetry freshness proof', async () => {
    const prisma = new PrismaMock();
    prisma.matchData = {
      ...prisma.matchData,
      status: 'LIVE',
      liveState: LiveState.LIVE,
      dataSource: 'API',
      dataMode: 'MANUAL',
      controlState: {
        state: 'LIVE',
        metaJson: null,
        resultsManualLock: false,
        resultsForceUnlock: false,
      },
    };
    prisma.matchStateSnapshotData = {
      stateJson: {
        status: 'LIVE',
        updatedAt: 200,
        teamsAlive: 1,
      },
    };
    const service = new StandingsService(prisma as unknown as PrismaService);

    const result = await service.canEditResults('match-1');

    expect(result.aliveTeams).toBeNull();
    expect(result.isLocked).toBe(false);
  });

  it('uses snapshot alive-team state once the current run has telemetry freshness proof', async () => {
    const prisma = new PrismaMock();
    prisma.matchData = {
      ...prisma.matchData,
      status: 'LIVE',
      liveState: LiveState.LIVE,
      dataSource: 'API',
      dataMode: 'MANUAL',
      controlState: {
        state: 'LIVE',
        metaJson: {
          telemetryUpdatedAt: 200,
        },
        resultsManualLock: false,
        resultsForceUnlock: false,
      },
    };
    prisma.matchStateSnapshotData = {
      stateJson: {
        status: 'LIVE',
        updatedAt: 200,
        teamsAlive: 1,
        telemetryAcceptedAt: 200,
      },
    };
    const service = new StandingsService(prisma as unknown as PrismaService);

    const result = await service.canEditResults('match-1');

    expect(result.aliveTeams).toBe(1);
    expect(result.isLocked).toBe(true);
  });
});
