import { MatchEventType } from '@prisma/client';
import { PubgmScoring } from './pubgm.scoring';

type MockMatchEvent = {
  matchId: string;
  seq: number;
  type: MatchEventType;
  teamId: string | null;
  payload: Record<string, unknown>;
};

type MockSlotResult = {
  id: string;
  matchId: string;
  teamId: string;
  wasPresentInMatch: boolean;
  placement: number | null;
  finalPlacement?: number | null;
  placementPoints: number;
  totalKills: number;
  finalKills?: number | null;
  points: number;
  totalPoints: number;
  manualTotalKills: boolean;
  players?: Array<{ kills?: number | null }>;
};

class MockPrisma {
  match = {
    data: {
      id: 'm-2',
      tournamentId: 'tour-2',
      organizationId: 'org-2',
      status: 'LIVE',
      rulesetId: null as string | null,
      dataSource: null as string | null,
      dataMode: null as string | null,
      game: { key: 'PUBG_MOBILE' },
      tournament: {
        rulesetId: null as string | null,
        game: 'PUBG_MOBILE',
      },
      deletedAt: null as Date | null,
      endedAt: null as Date | null,
    },
    findUnique: ({ where }: any) => {
      if (where?.id === 'm-2') return Promise.resolve({ ...this.match.data });
      return Promise.resolve(null);
    },
    update: ({ where, data }: any) => {
      if (where?.id === 'm-2') {
        this.match.data = { ...this.match.data, ...data };
        return Promise.resolve({ ...this.match.data });
      }
      return Promise.resolve(null);
    },
  };

  tournamentTeam = {
    data: ['a', 'b', 'c'],
    findMany: ({ where }: any) => {
      if (where?.tournamentId === 'tour-2') {
        return Promise.resolve(
          this.tournamentTeam.data.map((teamId) => ({ teamId })),
        );
      }
      return Promise.resolve([]);
    },
  };

  matchEvent = {
    data: [
      {
        matchId: 'm-2',
        seq: 1,
        type: MatchEventType.TEAM_PLACEMENT,
        teamId: 'c',
        payload: { placement: 3 },
      },
      {
        matchId: 'm-2',
        seq: 2,
        type: MatchEventType.MATCH_END,
        teamId: null,
        payload: {},
      },
    ] as MockMatchEvent[],
    findMany: ({ where }: any) => {
      if (where?.matchId === 'm-2') {
        return Promise.resolve(
          [...this.matchEvent.data].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0)),
        );
      }
      return Promise.resolve([]);
    },
  };

  matchSlotResult = {
    data: [
      {
        id: 'sr-a',
        matchId: 'm-2',
        teamId: 'a',
        wasPresentInMatch: true,
        placement: null as number | null,
        placementPoints: 0,
        totalKills: 0,
        points: 0,
        totalPoints: 0,
        manualTotalKills: false,
      },
      {
        id: 'sr-b',
        matchId: 'm-2',
        teamId: 'b',
        wasPresentInMatch: true,
        placement: null as number | null,
        placementPoints: 0,
        totalKills: 0,
        points: 0,
        totalPoints: 0,
        manualTotalKills: false,
      },
      {
        id: 'sr-c',
        matchId: 'm-2',
        teamId: 'c',
        wasPresentInMatch: true,
        placement: null as number | null,
        placementPoints: 0,
        totalKills: 0,
        points: 0,
        totalPoints: 0,
        manualTotalKills: false,
      },
    ] as MockSlotResult[],
    findMany: ({ where }: any) => {
      if (where?.matchId === 'm-2') {
        return Promise.resolve(
          this.matchSlotResult.data.map((r) => ({ ...r })),
        );
      }
      return Promise.resolve([]);
    },
    update: ({ where, data }: any) => {
      const idx = this.matchSlotResult.data.findIndex((r) => r.id === where.id);
      if (idx >= 0) {
        this.matchSlotResult.data[idx] = {
          ...this.matchSlotResult.data[idx],
          ...data,
        };
        return Promise.resolve({ ...this.matchSlotResult.data[idx] });
      }
      return Promise.resolve(null);
    },
  };

  adminAdjustment = {
    findMany: () => Promise.resolve([]),
  };

  ruleset = {
    findUnique: jest.fn().mockResolvedValue(null),
    findFirst: jest.fn().mockResolvedValue(null),
  };
}

describe('PubgmScoring placement idempotency', () => {
  it('does not change placement on repeated TEAM_PLACEMENT events', async () => {
    const prisma = new MockPrisma();
    const scoring = new PubgmScoring(prisma as any);

    await scoring.recomputeMatch('m-2');
    const first = prisma.matchSlotResult.data.find((r) => r.teamId === 'c');
    expect(first?.placement).toBe(3);

    await scoring.recomputeMatch('m-2');
    const second = prisma.matchSlotResult.data.find((r) => r.teamId === 'c');
    expect(second?.placement).toBe(3);
    expect(second).toEqual(first);
  });

  it('preserves canonical terminal placement and kills when events are incomplete', async () => {
    const prisma = new MockPrisma();
    prisma.tournamentTeam.data = ['a'];
    prisma.matchEvent.data = [
      {
        matchId: 'm-2',
        seq: 1,
        type: MatchEventType.MATCH_END,
        teamId: null,
        payload: {},
      },
    ];
    prisma.matchSlotResult.data = [
      {
        id: 'sr-a',
        matchId: 'm-2',
        teamId: 'a',
        wasPresentInMatch: true,
        placement: 1,
        placementPoints: 0,
        totalKills: 10,
        points: 0,
        totalPoints: 0,
        manualTotalKills: false,
      },
    ];
    const scoring = new PubgmScoring(prisma as any);

    await scoring.recomputeMatch('m-2');

    expect(prisma.matchSlotResult.data[0]).toMatchObject({
      placement: 1,
      placementPoints: 10,
      totalKills: 10,
      points: 20,
      totalPoints: 20,
      manualTotalKills: false,
    });
  });

  it('zeroes NO_SHOW slot totals during recompute', async () => {
    const prisma = new MockPrisma();
    prisma.tournamentTeam.data = ['a'];
    prisma.matchEvent.data = [
      {
        matchId: 'm-2',
        seq: 1,
        type: MatchEventType.KILL,
        teamId: 'a',
        payload: {},
      },
      {
        matchId: 'm-2',
        seq: 2,
        type: MatchEventType.TEAM_PLACEMENT,
        teamId: 'a',
        payload: { placement: 2 },
      },
    ];
    prisma.matchSlotResult.data = [
      {
        id: 'sr-a',
        matchId: 'm-2',
        teamId: 'a',
        wasPresentInMatch: false,
        placement: 2,
        finalPlacement: 2,
        placementPoints: 6,
        totalKills: 5,
        finalKills: 5,
        points: 11,
        totalPoints: 11,
        manualTotalKills: true,
        players: [{ kills: 5 }],
      },
    ];
    const scoring = new PubgmScoring(prisma as any);

    await scoring.recomputeMatch('m-2');

    expect(prisma.matchSlotResult.data[0]).toMatchObject({
      wasPresentInMatch: false,
      placement: null,
      finalPlacement: null,
      placementPoints: 0,
      totalKills: 0,
      finalKills: 0,
      points: 0,
      totalPoints: 0,
      manualTotalKills: false,
    });
  });

  it('uses the configured ruleset for placement and kill points', async () => {
    const prisma = new MockPrisma();
    prisma.match.data.rulesetId = 'ruleset-1';
    prisma.tournamentTeam.data = ['a'];
    prisma.matchEvent.data = [];
    prisma.matchSlotResult.data = [
      {
        id: 'sr-a',
        matchId: 'm-2',
        teamId: 'a',
        wasPresentInMatch: true,
        placement: 2,
        finalPlacement: null,
        placementPoints: 0,
        totalKills: 3,
        finalKills: null,
        points: 0,
        totalPoints: 0,
        manualTotalKills: false,
        players: [{ kills: 3 }],
      },
    ];
    prisma.ruleset.findUnique.mockResolvedValue({
      config: {
        placementPoints: { 1: 15, 2: 9 },
        killPoints: 2,
      },
    });

    const scoring = new PubgmScoring(prisma as any);

    await scoring.recomputeMatch('m-2');

    expect(prisma.matchSlotResult.data[0]).toMatchObject({
      placementPoints: 9,
      totalKills: 3,
      points: 15,
      totalPoints: 15,
    });
  });

  it('corrects stale kill totals downward for manual matches', async () => {
    const prisma = new MockPrisma();
    prisma.match.data.dataSource = 'MANUAL';
    prisma.tournamentTeam.data = ['a'];
    prisma.matchEvent.data = [
      {
        matchId: 'm-2',
        seq: 1,
        type: MatchEventType.KILL,
        teamId: 'a',
        payload: {},
      },
    ];
    prisma.matchSlotResult.data = [
      {
        id: 'sr-a',
        matchId: 'm-2',
        teamId: 'a',
        wasPresentInMatch: true,
        placement: null,
        finalPlacement: null,
        placementPoints: 0,
        totalKills: 6,
        finalKills: null,
        points: 6,
        totalPoints: 6,
        manualTotalKills: false,
        players: [{ kills: 0 }],
      },
    ];

    const scoring = new PubgmScoring(prisma as any);

    await scoring.recomputeMatch('m-2');

    expect(prisma.matchSlotResult.data[0]).toMatchObject({
      totalKills: 1,
      points: 1,
      totalPoints: 1,
    });
  });
});
