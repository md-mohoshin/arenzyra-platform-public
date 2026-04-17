import { GameKey, MatchEventType } from '@prisma/client';
import { ScoringService } from './scoring.service';
import { PubgmScoring } from './pubgm.scoring';

class MockPrisma {
  match = {
    data: {
      id: 'm-1',
      tournamentId: 'tour-1',
      organizationId: 'org-1',
      status: 'LIVE',
      rulesetId: null as string | null,
      dataSource: null as string | null,
      dataMode: null as string | null,
      game: { key: GameKey.PUBG_MOBILE },
      tournament: {
        rulesetId: null as string | null,
        game: GameKey.PUBG_MOBILE,
      },
      endedAt: null as Date | null,
      deletedAt: null as Date | null,
    },
    findUnique: ({ where }: any) => {
      if (where?.id === 'm-1') return Promise.resolve({ ...this.match.data });
      return Promise.resolve(null);
    },
    findMany: ({ where }: any) => {
      if (where?.tournamentId === 'tour-1') {
        return Promise.resolve([{ id: 'm-1' }]);
      }
      return Promise.resolve([]);
    },
    update: ({ where, data }: any) => {
      if (where?.id === 'm-1') {
        this.match.data = { ...this.match.data, ...data };
        return Promise.resolve({ ...this.match.data });
      }
      return Promise.resolve(null);
    },
  };

  tournament = {
    data: {
      id: 'tour-1',
      game: GameKey.PUBG_MOBILE,
      name: 'Determinism Cup',
      bannerUrl: null,
      deletedAt: null as Date | null,
    },
    findUnique: ({ where }: any) => {
      if (where?.id === 'tour-1')
        return Promise.resolve({ ...this.tournament.data });
      return Promise.resolve(null);
    },
  };

  tournamentTeam = {
    data: ['t1', 't2', 't3', 't4'],
    findMany: ({ where }: any) => {
      if (where?.tournamentId === 'tour-1') {
        return Promise.resolve(
          this.tournamentTeam.data.map((teamId) => ({
            teamId,
            team: { tag: teamId.toUpperCase(), name: teamId, logoUrl: null },
          })),
        );
      }
      return Promise.resolve([]);
    },
  };

  matchEvent = {
    data: [
      {
        matchId: 'm-1',
        seq: 1,
        type: MatchEventType.KILL,
        teamId: 't1',
        payload: {},
      },
      {
        matchId: 'm-1',
        seq: 2,
        type: MatchEventType.KILL,
        teamId: 't1',
        payload: {},
      },
      {
        matchId: 'm-1',
        seq: 3,
        type: MatchEventType.KILL,
        teamId: 't2',
        payload: {},
      },
      {
        matchId: 'm-1',
        seq: 4,
        type: MatchEventType.TEAM_PLACEMENT,
        teamId: 't4',
        payload: { placement: 4 },
      },
      {
        matchId: 'm-1',
        seq: 5,
        type: MatchEventType.TEAM_PLACEMENT,
        teamId: 't3',
        payload: { placement: 3 },
      },
      {
        matchId: 'm-1',
        seq: 6,
        type: MatchEventType.TEAM_PLACEMENT,
        teamId: 't2',
        payload: { placement: 2 },
      },
      {
        matchId: 'm-1',
        seq: 7,
        type: MatchEventType.TEAM_PLACEMENT,
        teamId: 't1',
        payload: { placement: 1 },
      },
      {
        matchId: 'm-1',
        seq: 8,
        type: MatchEventType.MATCH_END,
        teamId: null,
        payload: {},
      },
    ],
    findMany: ({ where }: any) => {
      if (where?.matchId === 'm-1') {
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
        id: 'sr-1',
        matchId: 'm-1',
        slotNumber: 1,
        teamId: 't1',
        wasPresentInMatch: true,
        placement: null as number | null,
        placementPoints: 0,
        totalKills: 0,
        points: 0,
        totalPoints: 0,
        manualTotalKills: false,
        players: [{ id: 'p1', isAlive: true, isKnocked: false }],
      },
      {
        id: 'sr-2',
        matchId: 'm-1',
        slotNumber: 2,
        teamId: 't2',
        wasPresentInMatch: true,
        placement: null as number | null,
        placementPoints: 0,
        totalKills: 0,
        points: 0,
        totalPoints: 0,
        manualTotalKills: false,
        players: [{ id: 'p2', isAlive: true, isKnocked: false }],
      },
      {
        id: 'sr-3',
        matchId: 'm-1',
        slotNumber: 3,
        teamId: 't3',
        wasPresentInMatch: true,
        placement: null as number | null,
        placementPoints: 0,
        totalKills: 0,
        points: 0,
        totalPoints: 0,
        manualTotalKills: false,
        players: [{ id: 'p3', isAlive: true, isKnocked: false }],
      },
      {
        id: 'sr-4',
        matchId: 'm-1',
        slotNumber: 4,
        teamId: 't4',
        wasPresentInMatch: true,
        placement: null as number | null,
        placementPoints: 0,
        totalKills: 0,
        points: 0,
        totalPoints: 0,
        manualTotalKills: false,
        players: [{ id: 'p4', isAlive: true, isKnocked: false }],
      },
    ],
    findMany: ({ where, select }: any = {}) => {
      const rows = this.matchSlotResult.data.filter(
        (r) =>
          (!where?.matchId || r.matchId === where.matchId) &&
          (!where?.teamId || r.teamId === where.teamId) &&
          (!where?.teamId?.not || r.teamId !== where.teamId.not) &&
          (!where?.matchId?.in || where.matchId.in.includes(r.matchId)),
      );
      if (select) {
        return Promise.resolve(
          rows.map((r) => {
            const selected: Record<string, unknown> = {};
            for (const key of Object.keys(select)) {
              if (select[key]) selected[key] = (r as any)[key];
            }
            return selected;
          }),
        );
      }
      return Promise.resolve(rows.map((r) => ({ ...r })));
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

const liveStub = { setLatestStandings: jest.fn().mockResolvedValue(undefined) };
const scoreboardStub = {} as unknown;
const resultsStub = {
  assertMatchStateConsistency: jest.fn().mockResolvedValue(undefined),
} as unknown;

const deepClone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

describe('ScoringService recomputeMatchAndTournament determinism', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (resultsStub.assertMatchStateConsistency as jest.Mock).mockResolvedValue(
      undefined,
    );
  });

  it('produces identical state on repeated recompute', async () => {
    const prisma = new MockPrisma();
    const scoring = new ScoringService(
      prisma as any,
      liveStub as any,
      scoreboardStub as any,
      resultsStub as any,
    );
    // Force plugin to use our mock Prisma
    (scoring as any).pubgm = new PubgmScoring(prisma as any);

    await scoring.recomputeMatchAndTournament('m-1');
    const snapshot = {
      match: deepClone(prisma.match.data),
      slots: deepClone(prisma.matchSlotResult.data),
    };

    await scoring.recomputeMatchAndTournament('m-1');
    const after = {
      match: deepClone(prisma.match.data),
      slots: deepClone(prisma.matchSlotResult.data),
    };

    expect(after.match).toEqual(snapshot.match);
    expect(after.slots).toEqual(snapshot.slots);
  });

  it('does not publish tournament standings when terminal match validation fails', async () => {
    const prisma = new MockPrisma();
    prisma.match.data.status = 'ENDED';
    const scoring = new ScoringService(
      prisma as any,
      liveStub as any,
      scoreboardStub as any,
      resultsStub as any,
    );
    (scoring as any).pubgm = new PubgmScoring(prisma as any);
    (
      resultsStub.assertMatchStateConsistency as jest.Mock
    ).mockRejectedValueOnce(new Error('terminal mismatch'));

    await expect(scoring.recomputeMatchAndTournament('m-1')).rejects.toThrow(
      'terminal mismatch',
    );
    expect(liveStub.setLatestStandings).not.toHaveBeenCalled();
  });
});
