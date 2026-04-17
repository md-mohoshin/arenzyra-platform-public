import { MatchStatus, Role } from '@prisma/client';
import { ScreenshotIngestService } from './screenshot-ingest.service';
import { SessionsStandingsService } from '../sessions/sessions-standings.service';
import { ScreenshotPreviewStatusDto } from './dto/apply-screenshot-results.dto';

type TeamRecord = {
  id: string;
  organizationId: string;
  tag: string | null;
  deletedAt: Date | null;
};

type MatchRecord = {
  id: string;
  organizationId: string;
  sessionId: string | null;
  deletedAt: Date | null;
  status: MatchStatus;
};

type MatchSlotRecord = {
  id: string;
  matchId: string;
  teamId: string | null;
  slotNumber: number;
  deletedAt: Date | null;
};

type MatchSlotResultRecord = {
  id: string;
  matchId: string;
  organizationId: string;
  teamId: string | null;
  slotNumber: number;
  wasPresentInMatch?: boolean | null;
  placement: number | null;
  totalKills: number;
  manualTotalKills: boolean;
  points: number;
  totalPoints: number;
};

type SessionRecord = {
  id: string;
  organizationId: string;
  deletedAt: Date | null;
};

const placementPoints = (placement: number | null | undefined) => {
  if (!placement || placement <= 0) return 0;
  if (placement === 1) return 10;
  if (placement === 2) return 6;
  if (placement === 3) return 5;
  if (placement === 4) return 4;
  if (placement === 5) return 3;
  if (placement === 6) return 2;
  if (placement === 7 || placement === 8) return 1;
  return 0;
};

const actor = {
  id: 'organizer-1',
  actorId: 'organizer-1',
  role: Role.ORGANIZER,
  actorRole: Role.ORGANIZER,
  organizationId: 'org-1',
  actingOrgId: 'org-1',
};

function createPrismaMock(seed?: {
  teams?: TeamRecord[];
  matches?: MatchRecord[];
  matchSlots?: MatchSlotRecord[];
  matchSlotResults?: MatchSlotResultRecord[];
  sessions?: SessionRecord[];
}) {
  const state = {
    teams: [...(seed?.teams ?? [])],
    matches: [...(seed?.matches ?? [])],
    matchSlots: [...(seed?.matchSlots ?? [])],
    matchSlotResults: [...(seed?.matchSlotResults ?? [])],
    sessions: [...(seed?.sessions ?? [])],
  };

  const prisma = {
    __state: state,
    team: {
      findMany: jest.fn(async ({ where }: { where: Record<string, any> }) =>
        state.teams.filter((team) => {
          if (
            where.organizationId &&
            team.organizationId !== where.organizationId
          )
            return false;
          if (where.deletedAt === null && team.deletedAt !== null) return false;
          if (where.tag?.in && !where.tag.in.includes(team.tag)) return false;
          return true;
        }),
      ),
    },
    matchSlot: {
      findMany: jest.fn(async ({ where }: { where: Record<string, any> }) =>
        state.matchSlots.filter((slot) => {
          if (where.matchId && slot.matchId !== where.matchId) return false;
          if (where.deletedAt === null && slot.deletedAt !== null) return false;
          if (where.teamId?.in && !where.teamId.in.includes(slot.teamId))
            return false;
          if (where.id?.in && !where.id.in.includes(slot.id)) return false;
          return true;
        }),
      ),
    },
    matchSlotResult: {
      findUnique: jest.fn(
        async ({
          where,
        }: {
          where: {
            matchId_slotNumber: { matchId: string; slotNumber: number };
          };
        }) =>
          state.matchSlotResults.find(
            (item) =>
              item.matchId === where.matchId_slotNumber.matchId &&
              item.slotNumber === where.matchId_slotNumber.slotNumber,
          )
            ? {
                ...state.matchSlotResults.find(
                  (item) =>
                    item.matchId === where.matchId_slotNumber.matchId &&
                    item.slotNumber === where.matchId_slotNumber.slotNumber,
                )!,
                wasPresentInMatch: true,
              }
            : null,
      ),
      update: jest.fn(
        async ({
          where,
          data,
        }: {
          where: {
            matchId_slotNumber: { matchId: string; slotNumber: number };
          };
          data: Partial<MatchSlotResultRecord>;
        }) => {
          const row = state.matchSlotResults.find(
            (item) =>
              item.matchId === where.matchId_slotNumber.matchId &&
              item.slotNumber === where.matchId_slotNumber.slotNumber,
          );
          if (!row) {
            throw new Error('Slot result not found');
          }
          Object.assign(row, data);
          return row;
        },
      ),
      findMany: jest.fn(async ({ where }: { where: Record<string, any> }) => {
        const allowedMatchIds = new Set(where.matchId?.in ?? []);
        return state.matchSlotResults
          .filter((row) => {
            if (
              where.organizationId &&
              row.organizationId !== where.organizationId
            ) {
              return false;
            }
            if (where.teamId?.not === null && row.teamId === null) return false;
            if (allowedMatchIds.size > 0 && !allowedMatchIds.has(row.matchId)) {
              return false;
            }
            return true;
          })
          .map((row) => ({
            ...row,
            team: state.teams.find((team) => team.id === row.teamId) ?? null,
          }));
      }),
    },
    session: {
      findFirst: jest.fn(
        async ({ where }: { where: Record<string, any> }) =>
          state.sessions.find((session) => {
            if (where.id && session.id !== where.id) return false;
            if (
              where.organizationId &&
              session.organizationId !== where.organizationId
            ) {
              return false;
            }
            if (where.deletedAt === null && session.deletedAt !== null)
              return false;
            return true;
          }) ?? null,
      ),
    },
    match: {
      findMany: jest.fn(async ({ where }: { where: Record<string, any> }) =>
        state.matches.filter((match) => {
          if (where.sessionId && match.sessionId !== where.sessionId)
            return false;
          if (
            where.organizationId &&
            match.organizationId !== where.organizationId
          )
            return false;
          if (where.deletedAt === null && match.deletedAt !== null)
            return false;
          if (where.status?.in && !where.status.in.includes(match.status))
            return false;
          return true;
        }),
      ),
    },
    $transaction: jest.fn(async (callback: (tx: any) => unknown) =>
      callback(prisma),
    ),
  };

  return prisma;
}

describe('ScreenshotIngestService', () => {
  const makeMatchSummary = (overrides: Record<string, unknown> = {}) => ({
    id: 'match-1',
    organizationId: 'org-1',
    sessionId: 'session-1',
    map: null,
    status: MatchStatus.LIVE,
    liveState: 'LIVE',
    endedAt: null,
    gameKey: 'PUBG_MOBILE',
    dataSource: null,
    dataMode: null,
    controlState: null,
    resultLockState: 'UNLOCKED',
    tournamentId: null,
    tournament: null,
    ...overrides,
  });

  const buildService = (seed?: {
    teams?: TeamRecord[];
    matches?: MatchRecord[];
    matchSlots?: MatchSlotRecord[];
    matchSlotResults?: MatchSlotResultRecord[];
    sessions?: SessionRecord[];
  }) => {
    const prisma = createPrismaMock(seed);
    const parser = {
      parseScreenshot: jest.fn(),
    };
    const results = {
      ensureMatch: jest.fn().mockResolvedValue(makeMatchSummary()),
      isManualSource: jest.fn().mockReturnValue(false),
      ensureResultsEditableByMatchId: jest.fn().mockResolvedValue(undefined),
      ensureResultsFromSlots: jest.fn().mockResolvedValue(undefined),
      assertSlotPresentForMutation: jest.fn().mockResolvedValue(undefined),
      recalculateMatchResults: jest.fn(async (matchId: string) => {
        void matchId;
        for (const row of prisma.__state.matchSlotResults) {
          const points =
            placementPoints(row.placement) + Math.max(0, row.totalKills ?? 0);
          row.points = points;
          row.totalPoints = points;
        }
      }),
    };
    const service = new ScreenshotIngestService(
      prisma,
      parser as any,
      results as any,
    );

    return { prisma, parser, results, service };
  };

  it('maps parsed screenshot rows to teams and match slots', async () => {
    const { service, parser } = buildService({
      teams: [
        { id: 'team-a', organizationId: 'org-1', tag: 'DXB', deletedAt: null },
        { id: 'team-b', organizationId: 'org-1', tag: 'NXT', deletedAt: null },
      ],
      matchSlots: [
        {
          id: 'slot-1',
          matchId: 'match-1',
          teamId: 'team-a',
          slotNumber: 1,
          deletedAt: null,
        },
        {
          id: 'slot-2',
          matchId: 'match-1',
          teamId: 'team-b',
          slotNumber: 2,
          deletedAt: null,
        },
      ],
    });
    parser.parseScreenshot.mockResolvedValue([
      { position: 1, tag: 'DXB', kills: 12 },
      { position: 2, tag: 'NXT', kills: 7 },
    ]);

    const result = await service.previewScreenshot(actor as any, {
      matchId: 'match-1',
      imageUrl: 'https://example.com/result.png',
    });

    expect(result.preview).toEqual([
      {
        position: 1,
        tag: 'DXB',
        kills: 12,
        teamId: 'team-a',
        slotId: 'slot-1',
        slotNumber: 1,
        status: 'OK',
      },
      {
        position: 2,
        tag: 'NXT',
        kills: 7,
        teamId: 'team-b',
        slotId: 'slot-2',
        slotNumber: 2,
        status: 'OK',
      },
    ]);
    expect(result.resolved).toHaveLength(2);
    expect(result.unresolved).toHaveLength(0);
    expect(result.ambiguous).toHaveLength(0);
  });

  it('marks missing and duplicate tag mappings without applying them', async () => {
    const { service, parser } = buildService({
      teams: [
        { id: 'team-a', organizationId: 'org-1', tag: 'DXB', deletedAt: null },
        { id: 'team-b', organizationId: 'org-1', tag: 'DUP', deletedAt: null },
        { id: 'team-c', organizationId: 'org-1', tag: 'DUP', deletedAt: null },
      ],
      matchSlots: [
        {
          id: 'slot-1',
          matchId: 'match-1',
          teamId: 'team-a',
          slotNumber: 1,
          deletedAt: null,
        },
      ],
    });
    parser.parseScreenshot.mockResolvedValue([
      { position: 1, tag: 'DXB', kills: 12 },
      { position: 2, tag: 'MISS', kills: 5 },
      { position: 3, tag: 'DUP', kills: 4 },
    ]);

    const result = await service.previewScreenshot(actor as any, {
      matchId: 'match-1',
      imageUrl: 'https://example.com/result.png',
    });

    expect(result.preview).toEqual([
      {
        position: 1,
        tag: 'DXB',
        kills: 12,
        teamId: 'team-a',
        slotId: 'slot-1',
        slotNumber: 1,
        status: 'OK',
      },
      {
        position: 2,
        tag: 'MISS',
        kills: 5,
        teamId: null,
        slotId: null,
        slotNumber: null,
        status: 'UNRESOLVED',
        reason: 'TEAM_TAG_NOT_FOUND',
      },
      {
        position: 3,
        tag: 'DUP',
        kills: 4,
        teamId: null,
        slotId: null,
        slotNumber: null,
        status: 'AMBIGUOUS',
        reason: 'MULTIPLE_TEAMS_FOR_TAG',
        candidateTeamIds: ['team-b', 'team-c'],
      },
    ]);
  });

  it('applies screenshot results to slot results and session standings read the recomputed totals', async () => {
    const { prisma, results, service } = buildService({
      teams: [
        { id: 'team-a', organizationId: 'org-1', tag: 'DXB', deletedAt: null },
        { id: 'team-b', organizationId: 'org-1', tag: 'NXT', deletedAt: null },
      ],
      sessions: [{ id: 'session-1', organizationId: 'org-1', deletedAt: null }],
      matches: [
        {
          id: 'match-1',
          organizationId: 'org-1',
          sessionId: 'session-1',
          deletedAt: null,
          status: MatchStatus.FINISHED,
        },
      ],
      matchSlots: [
        {
          id: 'slot-1',
          matchId: 'match-1',
          teamId: 'team-a',
          slotNumber: 1,
          deletedAt: null,
        },
        {
          id: 'slot-2',
          matchId: 'match-1',
          teamId: 'team-b',
          slotNumber: 2,
          deletedAt: null,
        },
      ],
      matchSlotResults: [
        {
          id: 'result-1',
          matchId: 'match-1',
          organizationId: 'org-1',
          teamId: 'team-a',
          slotNumber: 1,
          wasPresentInMatch: true,
          placement: null,
          totalKills: 0,
          manualTotalKills: false,
          points: 0,
          totalPoints: 0,
        },
        {
          id: 'result-2',
          matchId: 'match-1',
          organizationId: 'org-1',
          teamId: 'team-b',
          slotNumber: 2,
          wasPresentInMatch: true,
          placement: null,
          totalKills: 0,
          manualTotalKills: false,
          points: 0,
          totalPoints: 0,
        },
      ],
    });
    results.ensureMatch.mockResolvedValue(
      makeMatchSummary({ status: MatchStatus.FINISHED }),
    );

    await expect(
      service.applyScreenshotResults(actor as any, {
        matchId: 'match-1',
        results: [
          {
            position: 1,
            tag: 'DXB',
            kills: 12,
            teamId: 'team-a',
            slotId: 'slot-1',
            status: ScreenshotPreviewStatusDto.OK,
          },
          {
            position: 2,
            tag: 'NXT',
            kills: 8,
            teamId: 'team-b',
            slotId: 'slot-2',
            status: ScreenshotPreviewStatusDto.OK,
          },
        ],
      }),
    ).resolves.toEqual({
      ok: true,
      matchId: 'match-1',
      updatedCount: 2,
    });

    expect(prisma.__state.matchSlotResults).toEqual([
      expect.objectContaining({
        teamId: 'team-a',
        slotNumber: 1,
        placement: 1,
        totalKills: 12,
        manualTotalKills: true,
        points: 22,
        totalPoints: 22,
      }),
      expect.objectContaining({
        teamId: 'team-b',
        slotNumber: 2,
        placement: 2,
        totalKills: 8,
        manualTotalKills: true,
        points: 14,
        totalPoints: 14,
      }),
    ]);

    const standings = new SessionsStandingsService(prisma);
    await expect(
      standings.getStandings('session-1', actor as any),
    ).resolves.toEqual({
      sessionId: 'session-1',
      teams: [
        {
          teamId: 'team-a',
          tag: 'DXB',
          totalPoints: 22,
          totalKills: 12,
          matchesPlayed: 1,
          avgPlacement: 1,
          rank: 1,
        },
        {
          teamId: 'team-b',
          tag: 'NXT',
          totalPoints: 14,
          totalKills: 8,
          matchesPlayed: 1,
          avgPlacement: 2,
          rank: 2,
        },
      ],
    });
    expect(results.ensureResultsEditableByMatchId).toHaveBeenCalled();
    expect(results.ensureResultsFromSlots).toHaveBeenCalled();
    expect(results.recalculateMatchResults).toHaveBeenCalledWith('match-1');
  });

  it('rejects apply when unresolved entries are submitted', async () => {
    const { service, results } = buildService();

    await expect(
      service.applyScreenshotResults(actor as any, {
        matchId: 'match-1',
        results: [
          {
            position: 1,
            tag: 'MISS',
            kills: 4,
            teamId: undefined,
            slotId: undefined,
            status: ScreenshotPreviewStatusDto.UNRESOLVED,
          },
        ],
      }),
    ).rejects.toThrow(
      'Cannot apply screenshot results with unresolved or ambiguous entries',
    );

    expect(results.ensureResultsEditableByMatchId).not.toHaveBeenCalled();
  });
});
