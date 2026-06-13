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

type MatchControlStateRecord = {
  matchId: string;
  organizationId: string;
  metaJson: Record<string, unknown> | null;
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
  placementPoints?: number;
  points: number;
  totalPoints: number;
};

type MatchSlotPlayerResultRecord = {
  id: string;
  slotResultId: string;
  organizationId: string;
  playerName: string;
  playerId?: string | null;
  pubgAccountId?: string | null;
  externalPlayerId?: string | null;
  kills: number;
  knocks?: number;
  assists?: number;
  isKnocked?: boolean;
  isAlive?: boolean;
  alive?: boolean | null;
  isAutoFilled?: boolean;
};

type SessionRecord = {
  id: string;
  organizationId: string;
  deletedAt: Date | null;
};

type OrganizationRecord = {
  id: string;
  planId: string;
  enabledAddOns: string[];
};

type SessionRegistrationRecord = {
  id: string;
  organizationId: string;
  sessionId: string;
  teamId: string;
  status: string;
  slotNumber: number | null;
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
  matchSlotPlayerResults?: MatchSlotPlayerResultRecord[];
  sessions?: SessionRecord[];
  sessionRegistrations?: SessionRegistrationRecord[];
  matchControlStates?: MatchControlStateRecord[];
  organizations?: OrganizationRecord[];
}) {
  const state = {
    teams: [...(seed?.teams ?? [])],
    matches: [...(seed?.matches ?? [])],
    matchSlots: [...(seed?.matchSlots ?? [])],
    matchSlotResults: [...(seed?.matchSlotResults ?? [])],
    matchSlotPlayerResults: [...(seed?.matchSlotPlayerResults ?? [])],
    sessions: [...(seed?.sessions ?? [])],
    sessionRegistrations: [...(seed?.sessionRegistrations ?? [])],
    matchControlStates: [...(seed?.matchControlStates ?? [])],
    organizations: seed?.organizations ?? [
      { id: 'org-1', planId: 'discord-ops', enabledAddOns: [] },
    ],
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
    sessionRegistration: {
      findMany: jest.fn(async ({ where }: { where: Record<string, any> }) =>
        state.sessionRegistrations.filter((registration) => {
          if (where.sessionId && registration.sessionId !== where.sessionId)
            return false;
          if (
            where.organizationId &&
            registration.organizationId !== where.organizationId
          )
            return false;
          if (where.deletedAt === null && registration.deletedAt !== null)
            return false;
          if (
            where.status?.in &&
            !where.status.in.includes(registration.status)
          )
            return false;
          if (
            where.slotNumber?.not === null &&
            registration.slotNumber === null
          )
            return false;
          return true;
        }),
      ),
    },
    teamBan: {
      findMany: jest.fn(async () => []),
    },
    organization: {
      findUnique: jest.fn(
        async ({ where }: { where: { id: string } }) =>
          state.organizations.find(
            (organization) => organization.id === where.id,
          ) ?? null,
      ),
    },
    matchSlot: {
      findMany: jest.fn(async ({ where }: { where: Record<string, any> }) =>
        state.matchSlots
          .filter((slot) => {
            if (where.matchId && slot.matchId !== where.matchId) return false;
            if (where.deletedAt === null && slot.deletedAt !== null)
              return false;
            if (where.teamId?.in && !where.teamId.in.includes(slot.teamId))
              return false;
            if (where.teamId?.not === null && slot.teamId === null)
              return false;
            if (where.id?.in && !where.id.in.includes(slot.id)) return false;
            return true;
          })
          .map((slot) => ({
            ...slot,
            team: state.teams.find((team) => team.id === slot.teamId) ?? null,
          })),
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
      updateMany: jest.fn(
        async ({
          where,
          data,
        }: {
          where: Record<string, any>;
          data: Partial<MatchSlotResultRecord>;
        }) => {
          const ids = new Set(where.id?.in ?? []);
          const allowedSlots = new Set(where.slotNumber?.in ?? []);
          const excludedSlots = new Set(where.slotNumber?.notIn ?? []);
          const placements = new Set(where.placement?.in ?? []);
          let count = 0;
          for (const row of state.matchSlotResults) {
            if (where.matchId && row.matchId !== where.matchId) {
              continue;
            }
            if (where.teamId && row.teamId !== where.teamId) {
              continue;
            }
            if (ids.size > 0 && !ids.has(row.id)) {
              continue;
            }
            if (
              typeof where.slotNumber === 'number' &&
              row.slotNumber !== where.slotNumber
            ) {
              continue;
            }
            if (allowedSlots.size > 0 && !allowedSlots.has(row.slotNumber)) {
              continue;
            }
            if (excludedSlots.size > 0 && excludedSlots.has(row.slotNumber)) {
              continue;
            }
            if (placements.size > 0 && !placements.has(row.placement ?? -1)) {
              continue;
            }
            Object.assign(row, data);
            count += 1;
          }
          return { count };
        },
      ),
      findMany: jest.fn(async ({ where }: { where: Record<string, any> }) => {
        const allowedMatchIds = new Set(where.matchId?.in ?? []);
        const allowedSlots = new Set(where.slotNumber?.in ?? []);
        const excludedSlots = new Set(where.slotNumber?.notIn ?? []);
        const placements = new Set(where.placement?.in ?? []);
        const ids = new Set(where.id?.in ?? []);
        return state.matchSlotResults
          .filter((row) => {
            if (
              where.matchId &&
              !where.matchId.in &&
              row.matchId !== where.matchId
            ) {
              return false;
            }
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
            if (allowedSlots.size > 0 && !allowedSlots.has(row.slotNumber)) {
              return false;
            }
            if (excludedSlots.size > 0 && excludedSlots.has(row.slotNumber)) {
              return false;
            }
            if (placements.size > 0 && !placements.has(row.placement ?? -1)) {
              return false;
            }
            if (ids.size > 0 && !ids.has(row.id)) {
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
    matchSlotPlayerResult: {
      findMany: jest.fn(async ({ where }: { where: Record<string, any> }) =>
        state.matchSlotPlayerResults.filter((row) => {
          if (where.slotResultId && row.slotResultId !== where.slotResultId) {
            return false;
          }
          return true;
        }),
      ),
      update: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Partial<MatchSlotPlayerResultRecord>;
        }) => {
          const row = state.matchSlotPlayerResults.find(
            (item) => item.id === where.id,
          );
          if (!row) {
            throw new Error('Slot player result not found');
          }
          Object.assign(row, data);
          return row;
        },
      ),
      create: jest.fn(
        async ({
          data,
        }: {
          data: Omit<MatchSlotPlayerResultRecord, 'id'>;
          select?: Record<string, boolean>;
        }) => {
          const created = {
            id: `player-result-${state.matchSlotPlayerResults.length + 1}`,
            ...data,
          };
          state.matchSlotPlayerResults.push(created);
          return { id: created.id };
        },
      ),
      updateMany: jest.fn(
        async ({
          where,
          data,
        }: {
          where: {
            slotResultId?: string | { in?: string[] };
            id?: { notIn?: string[] };
          };
          data: Partial<MatchSlotPlayerResultRecord>;
        }) => {
          const excluded = new Set(where.id?.notIn ?? []);
          const slotResultIds =
            typeof where.slotResultId === 'object'
              ? new Set(where.slotResultId.in ?? [])
              : null;
          let count = 0;
          for (const row of state.matchSlotPlayerResults) {
            if (
              typeof where.slotResultId === 'string' &&
              row.slotResultId !== where.slotResultId
            ) {
              continue;
            }
            if (
              slotResultIds &&
              slotResultIds.size > 0 &&
              !slotResultIds.has(row.slotResultId)
            ) {
              continue;
            }
            if (excluded.has(row.id)) {
              continue;
            }
            Object.assign(row, data);
            count += 1;
          }
          return { count };
        },
      ),
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
      findMany: jest.fn(
        async ({
          where,
          select,
        }: {
          where: Record<string, any>;
          select?: Record<string, any>;
        }) =>
          state.matches
            .filter((match) => {
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
            })
            .map((match) =>
              select?.controlState
                ? {
                    ...match,
                    controlState:
                      state.matchControlStates.find(
                        (item) => item.matchId === match.id,
                      ) ?? null,
                  }
                : match,
            ),
      ),
    },
    matchControlState: {
      findUnique: jest.fn(
        async ({ where }: { where: { matchId: string } }) =>
          state.matchControlStates.find(
            (item) => item.matchId === where.matchId,
          ) ?? null,
      ),
      upsert: jest.fn(
        async ({
          where,
          update,
          create,
        }: {
          where: { matchId: string };
          update: Partial<MatchControlStateRecord>;
          create: MatchControlStateRecord;
        }) => {
          const existing = state.matchControlStates.find(
            (item) => item.matchId === where.matchId,
          );
          if (existing) {
            Object.assign(existing, update);
            return existing;
          }
          state.matchControlStates.push(create);
          return create;
        },
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
    matchSlotPlayerResults?: MatchSlotPlayerResultRecord[];
    sessions?: SessionRecord[];
    sessionRegistrations?: SessionRegistrationRecord[];
    matchControlStates?: MatchControlStateRecord[];
    organizations?: OrganizationRecord[];
  }) => {
    const prisma = createPrismaMock(seed);
    const parser = {
      parseScreenshot: jest.fn(),
      parseSlotMapScreenshot: jest.fn(),
    } as {
      parseScreenshot: jest.Mock;
      parseScreenshots: jest.Mock;
      parseScreenshotsBasic: jest.Mock;
      parseSlotMapScreenshot: jest.Mock;
      parseSlotMapScreenshots: jest.Mock;
      parseSlotMapScreenshotsBasic: jest.Mock;
    };
    parser.parseScreenshots = jest.fn(async (imageUrls: string[]) =>
      parser.parseScreenshot(imageUrls[0]),
    );
    parser.parseScreenshotsBasic = jest.fn(async (imageUrls: string[]) =>
      parser.parseScreenshot(imageUrls[0]),
    );
    parser.parseSlotMapScreenshots = jest.fn(async (imageUrls: string[]) =>
      parser.parseSlotMapScreenshot(imageUrls[0]),
    );
    parser.parseSlotMapScreenshotsBasic = jest.fn(async (imageUrls: string[]) =>
      parser.parseSlotMapScreenshot(imageUrls[0]),
    );
    const results = {
      ensureMatch: jest.fn().mockResolvedValue(makeMatchSummary()),
      isManualSource: jest.fn().mockReturnValue(false),
      ensureResultsEditableByMatchId: jest.fn().mockResolvedValue(undefined),
      ensureResultsFromSlots: jest.fn().mockResolvedValue(undefined),
      assertSlotPresentForMutation: jest.fn().mockResolvedValue(undefined),
      applyReviewedNoShowAutoBans: jest.fn().mockResolvedValue(undefined),
      storeNoShowBanSnapshotForMatch: jest.fn().mockResolvedValue(0),
      recalculateMatchResults: jest.fn(async (matchId: string) => {
        void matchId;
        for (const row of prisma.__state.matchSlotResults) {
          const placement = placementPoints(row.placement);
          const points = placement + Math.max(0, row.totalKills ?? 0);
          row.placementPoints = placement;
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
      {
        position: 1,
        tag: 'DXB',
        kills: 12,
        playerNames: [],
        slotNumber: null,
        confidence: null,
      },
      {
        position: 2,
        tag: 'NXT',
        kills: 7,
        playerNames: [],
        slotNumber: null,
        confidence: null,
      },
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
        playerNames: [],
        confidence: null,
        matchEvidence: 'team-tag',
      },
      {
        position: 2,
        tag: 'NXT',
        kills: 7,
        teamId: 'team-b',
        slotId: 'slot-2',
        slotNumber: 2,
        status: 'OK',
        playerNames: [],
        confidence: null,
        matchEvidence: 'team-tag',
      },
    ]);
    expect(result.resolved).toHaveLength(2);
    expect(result.unresolved).toHaveLength(0);
    expect(result.ambiguous).toHaveLength(0);
  });

  it('lets an exact team tag beat weaker player-prefix candidates', async () => {
    const { service, parser } = buildService({
      teams: [
        {
          id: 'team-soul',
          organizationId: 'org-1',
          tag: 'SOUL',
          name: 'M4xSoul',
          deletedAt: null,
        },
        {
          id: 'team-hpx',
          organizationId: 'org-1',
          tag: 'HPX',
          name: 'HOP NANINA',
          deletedAt: null,
        },
      ],
      matchSlots: [
        {
          id: 'slot-22',
          matchId: 'match-1',
          teamId: 'team-soul',
          slotNumber: 22,
          deletedAt: null,
        },
        {
          id: 'slot-6',
          matchId: 'match-1',
          teamId: 'team-hpx',
          slotNumber: 6,
          deletedAt: null,
        },
      ],
    });
    parser.parseScreenshot.mockResolvedValue([
      {
        position: 1,
        tag: 'SouL',
        kills: 17,
        playerNames: [
          'SouL ViPeR',
          '1HPxJONATHAN24',
          'GodL KYROX',
          'SouL Hasu',
        ],
        players: [
          { name: 'SouL ViPeR', kills: 8 },
          { name: '1HPxJONATHAN24', kills: 2 },
          { name: 'GodL KYROX', kills: 6 },
          { name: 'SouL Hasu', kills: 1 },
        ],
        slotNumber: null,
        confidence: 1,
      },
    ]);

    const result = await service.previewScreenshot(actor as any, {
      matchId: 'match-1',
      imageUrl: 'https://example.com/result.png',
    });

    expect(result.preview[0]).toEqual(
      expect.objectContaining({
        position: 1,
        tag: 'SOUL',
        kills: 17,
        teamName: 'M4xSoul',
        teamId: 'team-soul',
        slotId: 'slot-22',
        slotNumber: 22,
        status: 'OK',
        matchEvidence: 'team-tag',
      }),
    );
    expect(result.ambiguous).toHaveLength(0);
  });

  it('resolves tag-only rows from official slots with case and stylized-letter differences', async () => {
    const { service, parser } = buildService({
      teams: [
        {
          id: 'team-sfrgs',
          organizationId: 'org-1',
          tag: 'SFRGS',
          deletedAt: null,
        },
        {
          id: 'team-ictf',
          organizationId: 'org-1',
          tag: 'ICTF',
          deletedAt: null,
        },
        {
          id: 'team-slk',
          organizationId: 'org-1',
          tag: 'S\u026dK',
          deletedAt: null,
        },
      ],
      matchSlots: [
        {
          id: 'slot-10',
          matchId: 'match-1',
          teamId: 'team-sfrgs',
          slotNumber: 10,
          deletedAt: null,
        },
        {
          id: 'slot-5',
          matchId: 'match-1',
          teamId: 'team-ictf',
          slotNumber: 5,
          deletedAt: null,
        },
        {
          id: 'slot-20',
          matchId: 'match-1',
          teamId: 'team-slk',
          slotNumber: 20,
          deletedAt: null,
        },
      ],
    });
    parser.parseScreenshot.mockResolvedValue([
      {
        position: 18,
        tag: 'Sfrgs',
        kills: 0,
        playerNames: [],
        players: [],
        slotNumber: null,
        confidence: 0.88,
      },
      {
        position: 19,
        tag: 'ICTF',
        kills: 0,
        playerNames: [],
        players: [],
        slotNumber: null,
        confidence: 0.85,
      },
      {
        position: 20,
        tag: 'SLK',
        kills: 0,
        playerNames: [],
        players: [],
        slotNumber: null,
        confidence: 0.85,
      },
    ]);

    const result = await service.previewScreenshot(actor as any, {
      matchId: 'match-1',
      imageUrl: 'https://example.com/result.png',
    });

    expect(result.preview).toEqual([
      expect.objectContaining({
        position: 18,
        tag: 'SFRGS',
        teamId: 'team-sfrgs',
        slotId: 'slot-10',
        slotNumber: 10,
        status: 'OK',
        matchEvidence: 'team-tag',
      }),
      expect.objectContaining({
        position: 19,
        tag: 'ICTF',
        teamId: 'team-ictf',
        slotId: 'slot-5',
        slotNumber: 5,
        status: 'OK',
        matchEvidence: 'team-tag',
      }),
      expect.objectContaining({
        position: 20,
        tag: 'S\u026dK',
        teamId: 'team-slk',
        slotId: 'slot-20',
        slotNumber: 20,
        status: 'OK',
        matchEvidence: 'team-tag',
      }),
    ]);
    expect(result.resolved).toHaveLength(3);
    expect(result.unresolved).toHaveLength(0);
    expect(result.ambiguous).toHaveLength(0);
  });

  it('passes every result screenshot URL to the parser', async () => {
    const { service, parser } = buildService({
      teams: [
        { id: 'team-a', organizationId: 'org-1', tag: 'DXB', deletedAt: null },
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
    parser.parseScreenshots.mockResolvedValue([
      {
        position: 1,
        tag: 'DXB',
        kills: 12,
        playerNames: [],
        players: [],
        slotNumber: null,
        confidence: null,
      },
    ]);

    await service.previewScreenshot(actor as any, {
      matchId: 'match-1',
      imageUrl: 'https://example.com/result-1.png',
      imageUrls: [
        'https://example.com/result-1.png',
        'https://example.com/result-2.png',
        'https://example.com/result-3.png',
      ],
    });

    expect(parser.parseScreenshots).toHaveBeenCalledWith([
      'https://example.com/result-1.png',
      'https://example.com/result-2.png',
      'https://example.com/result-3.png',
    ]);
  });

  it('uses basic OCR instead of AI OCR for the Discord Bot Only plan', async () => {
    const { service, parser } = buildService({
      organizations: [
        { id: 'org-1', planId: 'discord-basic', enabledAddOns: [] },
      ],
      teams: [
        { id: 'team-a', organizationId: 'org-1', tag: 'DXB', deletedAt: null },
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
    parser.parseScreenshotsBasic.mockResolvedValue([
      {
        position: 1,
        tag: 'DXB',
        kills: 9,
        playerNames: [],
        players: [],
        slotNumber: null,
        confidence: 0.62,
      },
    ]);

    const result = await service.previewScreenshot(actor as any, {
      matchId: 'match-1',
      imageUrl: 'https://example.com/result.png',
    });

    expect(parser.parseScreenshots).not.toHaveBeenCalled();
    expect(parser.parseScreenshotsBasic).toHaveBeenCalledWith([
      'https://example.com/result.png',
    ]);
    expect(result.ocrMode).toBe('BASIC');
    expect(result.resolved).toHaveLength(1);
  });

  it('creates editable manual rows when basic OCR cannot read a result screenshot', async () => {
    const { service, parser } = buildService({
      organizations: [
        { id: 'org-1', planId: 'discord-basic', enabledAddOns: [] },
      ],
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
    parser.parseScreenshotsBasic.mockResolvedValue([]);

    const result = await service.previewScreenshot(actor as any, {
      matchId: 'match-1',
      imageUrl: 'https://example.com/blurred.png',
    });

    expect(result.ocrMode).toBe('MANUAL');
    expect(result.preview).toEqual([
      expect.objectContaining({
        position: 1,
        tag: 'DXB',
        kills: 0,
        slotNumber: 1,
        status: 'UNRESOLVED',
        reason: 'BASIC_OCR_MANUAL_REVIEW',
      }),
      expect.objectContaining({
        position: 2,
        tag: 'NXT',
        kills: 0,
        slotNumber: 2,
        status: 'UNRESOLVED',
        reason: 'BASIC_OCR_MANUAL_REVIEW',
      }),
    ]);
    expect(result.resolved).toHaveLength(0);
    expect(result.unresolved).toHaveLength(2);
  });

  it('maps a unique detected base tag to an official tag with numeric suffix', async () => {
    const { service, parser } = buildService({
      teams: [
        {
          id: 'team-ing',
          organizationId: 'org-1',
          tag: 'ING333',
          deletedAt: null,
        },
      ],
      matchSlots: [
        {
          id: 'slot-3',
          matchId: 'match-1',
          teamId: 'team-ing',
          slotNumber: 3,
          deletedAt: null,
        },
      ],
    });
    parser.parseScreenshots.mockResolvedValue([
      {
        position: 2,
        tag: 'ING',
        kills: 6,
        playerNames: ['ING Night77k', 'ING WoLF', 'ING Thonder'],
        players: [],
        slotNumber: null,
        confidence: 1,
      },
    ]);

    const result = await service.previewScreenshot(actor as any, {
      matchId: 'match-1',
      imageUrls: ['https://example.com/result.png'],
    });

    expect(result.preview[0]).toEqual(
      expect.objectContaining({
        position: 2,
        tag: 'ING333',
        teamId: 'team-ing',
        slotId: 'slot-3',
        slotNumber: 3,
        status: 'OK',
      }),
    );
  });

  it('uses repeated player-name prefixes when the OCR row tag is wrong', async () => {
    const { service, parser } = buildService({
      teams: [
        {
          id: 'team-top',
          organizationId: 'org-1',
          tag: 'TOP1',
          deletedAt: null,
        },
      ],
      matchSlots: [
        {
          id: 'slot-15',
          matchId: 'match-1',
          teamId: 'team-top',
          slotNumber: 15,
          deletedAt: null,
        },
      ],
    });
    parser.parseScreenshots.mockResolvedValue([
      {
        position: 3,
        tag: 'eqTHUNDER',
        kills: 4,
        playerNames: ['eqTHUNDER', 'waRLam', 'TopILA 7Isl2k', 'TopISKIZZO bot'],
        players: [],
        slotNumber: null,
        confidence: 0.92,
      },
    ]);

    const result = await service.previewScreenshot(actor as any, {
      matchId: 'match-1',
      imageUrls: ['https://example.com/result.png'],
    });

    expect(result.preview[0]).toEqual(
      expect.objectContaining({
        position: 3,
        tag: 'TOP1',
        teamId: 'team-top',
        slotId: 'slot-15',
        slotNumber: 15,
        status: 'OK',
      }),
    );
  });

  it('resolves PUBG detail-screen player prefixes with common OCR tag confusions', async () => {
    const { service, parser } = buildService({
      teams: [
        {
          id: 'team-mercy',
          organizationId: 'org-1',
          tag: 'MERCY',
          deletedAt: null,
        },
        {
          id: 'team-hpx',
          organizationId: 'org-1',
          tag: 'HPX',
          deletedAt: null,
        },
        {
          id: 'team-aon',
          organizationId: 'org-1',
          tag: 'AØN',
          deletedAt: null,
        },
        {
          id: 'team-rsx',
          organizationId: 'org-1',
          tag: 'RSX',
          deletedAt: null,
        },
      ],
      matchSlots: [
        {
          id: 'slot-18',
          matchId: 'match-1',
          teamId: 'team-mercy',
          slotNumber: 18,
          deletedAt: null,
        },
        {
          id: 'slot-6',
          matchId: 'match-1',
          teamId: 'team-hpx',
          slotNumber: 6,
          deletedAt: null,
        },
        {
          id: 'slot-14',
          matchId: 'match-1',
          teamId: 'team-aon',
          slotNumber: 14,
          deletedAt: null,
        },
        {
          id: 'slot-15',
          matchId: 'match-1',
          teamId: 'team-rsx',
          slotNumber: 15,
          deletedAt: null,
        },
      ],
    });
    parser.parseScreenshots.mockResolvedValue([
      {
        position: 1,
        tag: null,
        kills: 9,
        playerNames: ['MerCyYash', 'MERCY Sayed', 'MerCyRex'],
        players: [],
        slotNumber: null,
        confidence: 0.9,
      },
      {
        position: 2,
        tag: 'HPxSTORM',
        kills: 8,
        playerNames: ['HPxSTORM', 'HPxFINISHER'],
        players: [],
        slotNumber: null,
        confidence: 0.9,
      },
      {
        position: 3,
        tag: 'A0N',
        kills: 7,
        playerNames: ['A0N Hakim', 'AON RUSH'],
        players: [],
        slotNumber: null,
        confidence: 0.9,
      },
      {
        position: 4,
        tag: 'AC',
        kills: 6,
        playerNames: ['rs¹Fighter', 'rs1Sniper'],
        players: [],
        slotNumber: null,
        confidence: 0.9,
      },
    ]);

    const result = await service.previewScreenshot(actor as any, {
      matchId: 'match-1',
      imageUrls: ['https://example.com/result.png'],
    });

    expect(result.preview).toEqual([
      expect.objectContaining({
        position: 1,
        tag: 'MERCY',
        teamId: 'team-mercy',
        slotNumber: 18,
        status: 'OK',
      }),
      expect.objectContaining({
        position: 2,
        tag: 'HPX',
        teamId: 'team-hpx',
        slotNumber: 6,
        status: 'OK',
      }),
      expect.objectContaining({
        position: 3,
        tag: 'AØN',
        teamId: 'team-aon',
        slotNumber: 14,
        status: 'OK',
      }),
      expect.objectContaining({
        position: 4,
        tag: 'RSX',
        teamId: 'team-rsx',
        slotNumber: 15,
        status: 'OK',
      }),
    ]);
    expect(result.resolved).toHaveLength(4);
    expect(result.unresolved).toHaveLength(0);
    expect(result.ambiguous).toHaveLength(0);
  });

  it('keeps common OCR tag confusions ambiguous when two official tags can match', async () => {
    const { service, parser } = buildService({
      teams: [
        {
          id: 'team-rsx',
          organizationId: 'org-1',
          tag: 'RSX',
          deletedAt: null,
        },
        {
          id: 'team-rsi',
          organizationId: 'org-1',
          tag: 'RSI',
          deletedAt: null,
        },
      ],
      matchSlots: [
        {
          id: 'slot-15',
          matchId: 'match-1',
          teamId: 'team-rsx',
          slotNumber: 15,
          deletedAt: null,
        },
        {
          id: 'slot-16',
          matchId: 'match-1',
          teamId: 'team-rsi',
          slotNumber: 16,
          deletedAt: null,
        },
      ],
    });
    parser.parseScreenshots.mockResolvedValue([
      {
        position: 4,
        tag: 'RS1',
        kills: 6,
        playerNames: [],
        players: [],
        slotNumber: null,
        confidence: 0.9,
      },
    ]);

    const result = await service.previewScreenshot(actor as any, {
      matchId: 'match-1',
      imageUrls: ['https://example.com/result.png'],
    });

    expect(result.preview[0]).toEqual(
      expect.objectContaining({
        position: 4,
        tag: 'RS1',
        teamId: null,
        slotId: null,
        slotNumber: null,
        status: 'AMBIGUOUS',
      }),
    );
  });

  it('resolves phi-looking OCR p to an official round tag when unique', async () => {
    const { service, parser } = buildService({
      teams: [
        {
          id: 'team-aon',
          organizationId: 'org-1',
          tag: 'AON',
          deletedAt: null,
        },
      ],
      matchSlots: [
        {
          id: 'slot-14',
          matchId: 'match-1',
          teamId: 'team-aon',
          slotNumber: 14,
          deletedAt: null,
        },
      ],
    });
    parser.parseScreenshots.mockResolvedValue([
      {
        position: 9,
        tag: 'ApN',
        kills: 3,
        playerNames: ['ApN Rusher', 'ApN Patrik', 'ApN HACY', 'ApN Boy'],
        players: [],
        slotNumber: null,
        confidence: 0.9,
      },
    ]);

    const result = await service.previewScreenshot(actor as any, {
      matchId: 'match-1',
      imageUrls: ['https://example.com/result.png'],
    });

    expect(result.preview[0]).toEqual(
      expect.objectContaining({
        position: 9,
        tag: 'AON',
        ocrTag: 'ApN',
        teamId: 'team-aon',
        slotId: 'slot-14',
        slotNumber: 14,
        status: 'OK',
      }),
    );
  });

  it('keeps round p OCR confusions ambiguous when two official tags can match', async () => {
    const { service, parser } = buildService({
      teams: [
        {
          id: 'team-aon',
          organizationId: 'org-1',
          tag: 'AON',
          deletedAt: null,
        },
        {
          id: 'team-apn',
          organizationId: 'org-1',
          tag: 'APN',
          deletedAt: null,
        },
      ],
      matchSlots: [
        {
          id: 'slot-14',
          matchId: 'match-1',
          teamId: 'team-aon',
          slotNumber: 14,
          deletedAt: null,
        },
        {
          id: 'slot-19',
          matchId: 'match-1',
          teamId: 'team-apn',
          slotNumber: 19,
          deletedAt: null,
        },
      ],
    });
    parser.parseScreenshots.mockResolvedValue([
      {
        position: 9,
        tag: 'A0N',
        kills: 3,
        playerNames: [],
        players: [],
        slotNumber: null,
        confidence: 0.9,
      },
    ]);

    const result = await service.previewScreenshot(actor as any, {
      matchId: 'match-1',
      imageUrls: ['https://example.com/result.png'],
    });

    expect(result.preview[0]).toEqual(
      expect.objectContaining({
        position: 9,
        tag: 'A0N',
        teamId: null,
        slotId: null,
        slotNumber: null,
        status: 'AMBIGUOUS',
      }),
    );
  });

  it('resolves official tags wrapped by leading in-game decoration', async () => {
    const { service, parser } = buildService({
      teams: [
        {
          id: 'team-a2k',
          organizationId: 'org-1',
          tag: 'A2K',
          deletedAt: null,
        },
      ],
      matchSlots: [
        {
          id: 'slot-21',
          matchId: 'match-1',
          teamId: 'team-a2k',
          slotNumber: 21,
          deletedAt: null,
        },
      ],
    });
    parser.parseScreenshots.mockResolvedValue([
      {
        position: 13,
        tag: '\u02b3A2K\u264f',
        kills: 4,
        playerNames: ['\u02b3A2K\u264f Rusher', '\u02b3A2K\u264f Scout'],
        players: [],
        slotNumber: null,
        confidence: 0.9,
      },
    ]);

    const result = await service.previewScreenshot(actor as any, {
      matchId: 'match-1',
      imageUrls: ['https://example.com/result.png'],
    });

    expect(result.preview[0]).toEqual(
      expect.objectContaining({
        position: 13,
        tag: 'A2K',
        ocrTag: '\u02b3A2K\u264f',
        teamId: 'team-a2k',
        slotId: 'slot-21',
        slotNumber: 21,
        status: 'OK',
      }),
    );
  });

  it('does not let OCR placement numbers override clear team tags', async () => {
    const { service, parser } = buildService({
      teams: [
        {
          id: 'team-kdm',
          organizationId: 'org-1',
          tag: 'KDM',
          deletedAt: null,
        },
        {
          id: 'team-bjk',
          organizationId: 'org-1',
          tag: 'BJK',
          deletedAt: null,
        },
      ],
      matchSlots: [
        {
          id: 'slot-12',
          matchId: 'match-1',
          teamId: 'team-kdm',
          slotNumber: 12,
          deletedAt: null,
        },
        {
          id: 'slot-9',
          matchId: 'match-1',
          teamId: 'team-bjk',
          slotNumber: 9,
          deletedAt: null,
        },
      ],
    });
    parser.parseScreenshots.mockResolvedValue([
      {
        position: 12,
        tag: 'BJK',
        kills: 2,
        playerNames: ['BJK RUSH77K', 'BJK BEST', 'BJK Suleym'],
        players: [],
        slotNumber: 12,
        confidence: 0.92,
      },
    ]);

    const result = await service.previewScreenshot(actor as any, {
      matchId: 'match-1',
      imageUrls: ['https://example.com/result.png'],
    });

    expect(result.preview[0]).toEqual(
      expect.objectContaining({
        position: 12,
        tag: 'BJK',
        teamId: 'team-bjk',
        slotId: 'slot-9',
        slotNumber: 9,
        status: 'OK',
      }),
    );
  });

  it('does not resolve a short tag when player evidence contradicts it', async () => {
    const { service, parser } = buildService({
      teams: [
        { id: 'team-ss', organizationId: 'org-1', tag: 'SS', deletedAt: null },
      ],
      matchSlots: [
        {
          id: 'slot-14',
          matchId: 'match-1',
          teamId: 'team-ss',
          slotNumber: 14,
          deletedAt: null,
        },
      ],
    });
    parser.parseScreenshots.mockResolvedValue([
      {
        position: 14,
        tag: 'SS',
        kills: 0,
        playerNames: ['madWALKER'],
        players: [],
        slotNumber: 14,
        confidence: 0.9,
      },
    ]);

    const result = await service.previewScreenshot(actor as any, {
      matchId: 'match-1',
      imageUrls: ['https://example.com/result.png'],
    });

    expect(result.preview[0]).toEqual(
      expect.objectContaining({
        position: 14,
        tag: 'SS',
        teamId: null,
        slotId: null,
        slotNumber: null,
        status: 'UNRESOLVED',
      }),
    );
  });

  it('resolves unique two-character tag OCR confusion with no player evidence', async () => {
    const { service, parser } = buildService({
      teams: [
        { id: 'team-4q', organizationId: 'org-1', tag: '4Q', deletedAt: null },
      ],
      matchSlots: [
        {
          id: 'slot-19',
          matchId: 'match-1',
          teamId: 'team-4q',
          slotNumber: 19,
          deletedAt: null,
        },
      ],
    });
    parser.parseScreenshot.mockResolvedValue([
      {
        position: 4,
        tag: '40',
        kills: 10,
        playerNames: [],
        players: [],
        slotNumber: null,
        confidence: 0.9,
      },
    ]);

    const result = await service.previewScreenshot(actor as any, {
      matchId: 'match-1',
      imageUrl: 'https://example.com/result.png',
    });

    expect(result.preview[0]).toEqual(
      expect.objectContaining({
        position: 4,
        tag: '4Q',
        ocrTag: '40',
        teamId: 'team-4q',
        slotId: 'slot-19',
        slotNumber: 19,
        status: 'OK',
      }),
    );
  });

  it('uses player prefixes to resolve two-character tag OCR confusion', async () => {
    const { service, parser } = buildService({
      teams: [
        { id: 'team-4q', organizationId: 'org-1', tag: '4Q', deletedAt: null },
      ],
      matchSlots: [
        {
          id: 'slot-19',
          matchId: 'match-1',
          teamId: 'team-4q',
          slotNumber: 19,
          deletedAt: null,
        },
      ],
    });
    parser.parseScreenshot.mockResolvedValue([
      {
        position: 4,
        tag: '4O',
        kills: 10,
        playerNames: ['40esDoraemon', '4QesPRABESH', '4Q pugalk'],
        players: [],
        slotNumber: null,
        confidence: 0.9,
      },
    ]);

    const result = await service.previewScreenshot(actor as any, {
      matchId: 'match-1',
      imageUrl: 'https://example.com/result.png',
    });

    expect(result.preview[0]).toEqual(
      expect.objectContaining({
        position: 4,
        tag: '4Q',
        ocrTag: '4O',
        teamId: 'team-4q',
        slotId: 'slot-19',
        slotNumber: 19,
        status: 'OK',
      }),
    );
  });

  it('keeps two-character tag OCR confusion unresolved when players contradict it', async () => {
    const { service, parser } = buildService({
      teams: [
        { id: 'team-ss', organizationId: 'org-1', tag: 'SS', deletedAt: null },
      ],
      matchSlots: [
        {
          id: 'slot-14',
          matchId: 'match-1',
          teamId: 'team-ss',
          slotNumber: 14,
          deletedAt: null,
        },
      ],
    });
    parser.parseScreenshot.mockResolvedValue([
      {
        position: 14,
        tag: '5S',
        kills: 0,
        playerNames: ['madWALKER'],
        players: [],
        slotNumber: null,
        confidence: 0.9,
      },
    ]);

    const result = await service.previewScreenshot(actor as any, {
      matchId: 'match-1',
      imageUrl: 'https://example.com/result.png',
    });

    expect(result.preview[0]).toEqual(
      expect.objectContaining({
        position: 14,
        tag: '5S',
        teamId: null,
        slotId: null,
        slotNumber: null,
        status: 'UNRESOLVED',
      }),
    );
  });

  it('keeps two-character OCR confusion ambiguous when multiple official tags fit', async () => {
    const { service, parser } = buildService({
      teams: [
        { id: 'team-4q', organizationId: 'org-1', tag: '4Q', deletedAt: null },
        { id: 'team-4o', organizationId: 'org-1', tag: '4O', deletedAt: null },
      ],
      matchSlots: [
        {
          id: 'slot-19',
          matchId: 'match-1',
          teamId: 'team-4q',
          slotNumber: 19,
          deletedAt: null,
        },
        {
          id: 'slot-20',
          matchId: 'match-1',
          teamId: 'team-4o',
          slotNumber: 20,
          deletedAt: null,
        },
      ],
    });
    parser.parseScreenshot.mockResolvedValue([
      {
        position: 4,
        tag: '40',
        kills: 10,
        playerNames: [],
        players: [],
        slotNumber: null,
        confidence: 0.9,
      },
    ]);

    const result = await service.previewScreenshot(actor as any, {
      matchId: 'match-1',
      imageUrl: 'https://example.com/result.png',
    });

    expect(result.preview[0]).toEqual(
      expect.objectContaining({
        position: 4,
        tag: '40',
        teamId: null,
        slotId: null,
        slotNumber: null,
        status: 'AMBIGUOUS',
        candidateTeamIds: ['team-4q', 'team-4o'],
      }),
    );
  });

  it('does not create short-tag ambiguity for a longer tag OCR typo', async () => {
    const { service, parser } = buildService({
      teams: [
        {
          id: 'team-lwn',
          organizationId: 'org-1',
          tag: 'LWN',
          deletedAt: null,
        },
        { id: 'team-wn', organizationId: 'org-1', tag: 'WN', deletedAt: null },
      ],
      matchSlots: [
        {
          id: 'slot-17',
          matchId: 'match-1',
          teamId: 'team-lwn',
          slotNumber: 17,
          deletedAt: null,
        },
        {
          id: 'slot-3',
          matchId: 'match-1',
          teamId: 'team-wn',
          slotNumber: 3,
          deletedAt: null,
        },
      ],
    });
    parser.parseScreenshot.mockResolvedValue([
      {
        position: 7,
        tag: 'Iwn',
        kills: 2,
        playerNames: ['lwnPATRON44'],
        players: [],
        slotNumber: null,
        confidence: 0.9,
      },
    ]);

    const result = await service.previewScreenshot(actor as any, {
      matchId: 'match-1',
      imageUrl: 'https://example.com/result.png',
    });

    expect(result.preview[0]).toEqual(
      expect.objectContaining({
        position: 7,
        tag: 'LWN',
        ocrTag: 'Iwn',
        teamId: 'team-lwn',
        slotId: 'slot-17',
        slotNumber: 17,
        status: 'OK',
      }),
    );
  });

  it('resolves merged two-character tag/player OCR text against official slots', async () => {
    const { service, parser } = buildService({
      teams: [
        { id: 'team-4q', organizationId: 'org-1', tag: '4Q', deletedAt: null },
      ],
      matchSlots: [
        {
          id: 'slot-19',
          matchId: 'match-1',
          teamId: 'team-4q',
          slotNumber: 19,
          deletedAt: null,
        },
      ],
    });
    parser.parseScreenshot.mockResolvedValue([
      {
        position: 4,
        tag: '4OesDoraemon',
        kills: 10,
        playerNames: [],
        players: [],
        slotNumber: null,
        confidence: 0.9,
      },
    ]);

    const result = await service.previewScreenshot(actor as any, {
      matchId: 'match-1',
      imageUrl: 'https://example.com/result.png',
    });

    expect(result.preview[0]).toEqual(
      expect.objectContaining({
        position: 4,
        tag: '4Q',
        ocrTag: '4OesDoraemon',
        teamId: 'team-4q',
        slotId: 'slot-19',
        slotNumber: 19,
        status: 'OK',
      }),
    );
  });

  it('maps one-character OCR tag typos for longer unique official tags', async () => {
    const { service, parser } = buildService({
      teams: [
        {
          id: 'team-4bro',
          organizationId: 'org-1',
          tag: '4BRO',
          deletedAt: null,
        },
      ],
      matchSlots: [
        {
          id: 'slot-22',
          matchId: 'match-1',
          teamId: 'team-4bro',
          slotNumber: 22,
          deletedAt: null,
        },
      ],
    });
    parser.parseScreenshots.mockResolvedValue([
      {
        position: 13,
        tag: '4BRD',
        kills: 0,
        playerNames: ['4BRD KiSSA', '4BRD NQ1', '4BRD TAQTO'],
        players: [],
        slotNumber: 13,
        confidence: 0.92,
      },
    ]);

    const result = await service.previewScreenshot(actor as any, {
      matchId: 'match-1',
      imageUrls: ['https://example.com/result.png'],
    });

    expect(result.preview[0]).toEqual(
      expect.objectContaining({
        position: 13,
        tag: '4BRO',
        teamId: 'team-4bro',
        slotId: 'slot-22',
        slotNumber: 22,
        status: 'OK',
      }),
    );
  });

  it('resolves common OCR tag suffix noise against official slots', async () => {
    const { service, parser } = buildService({
      teams: [
        { id: 'team-2w', organizationId: 'org-1', tag: '2W', deletedAt: null },
        {
          id: 'team-vlk',
          organizationId: 'org-1',
          tag: 'VLK',
          deletedAt: null,
        },
      ],
      matchSlots: [
        {
          id: 'slot-4',
          matchId: 'match-1',
          teamId: 'team-2w',
          slotNumber: 4,
          deletedAt: null,
        },
        {
          id: 'slot-5',
          matchId: 'match-1',
          teamId: 'team-vlk',
          slotNumber: 5,
          deletedAt: null,
        },
      ],
    });
    parser.parseScreenshot.mockResolvedValue([
      {
        position: 2,
        tag: '2Wx',
        kills: 13,
        playerNames: [],
        slotNumber: null,
        confidence: null,
      },
      {
        position: 4,
        tag: 'vlk¹',
        kills: 3,
        playerNames: [],
        slotNumber: null,
        confidence: null,
      },
    ]);

    const result = await service.previewScreenshot(actor as any, {
      matchId: 'match-1',
      imageUrl: 'https://example.com/result.png',
    });

    expect(result.preview).toEqual([
      expect.objectContaining({
        position: 2,
        tag: '2W',
        kills: 13,
        teamId: 'team-2w',
        slotId: 'slot-4',
        slotNumber: 4,
        status: 'OK',
      }),
      expect.objectContaining({
        position: 4,
        tag: 'VLK',
        kills: 3,
        teamId: 'team-vlk',
        slotId: 'slot-5',
        slotNumber: 5,
        status: 'OK',
      }),
    ]);
    expect(result.resolved).toHaveLength(2);
    expect(result.unresolved).toHaveLength(0);
    expect(result.ambiguous).toHaveLength(0);
  });

  it('resolves leading punctuation OCR noise against official slots', async () => {
    const { service, parser } = buildService({
      teams: [
        { id: 'team-cb', organizationId: 'org-1', tag: 'CB', deletedAt: null },
      ],
      matchSlots: [
        {
          id: 'slot-6',
          matchId: 'match-1',
          teamId: 'team-cb',
          slotNumber: 6,
          deletedAt: null,
        },
      ],
    });
    parser.parseScreenshot.mockResolvedValue([
      {
        position: 4,
        tag: "'CB",
        kills: 5,
        playerNames: [],
        slotNumber: null,
        confidence: null,
      },
    ]);

    const result = await service.previewScreenshot(actor as any, {
      matchId: 'match-1',
      imageUrl: 'https://example.com/result.png',
    });

    expect(result.preview).toEqual([
      expect.objectContaining({
        position: 4,
        tag: 'CB',
        kills: 5,
        teamId: 'team-cb',
        slotId: 'slot-6',
        slotNumber: 6,
        status: 'OK',
        matchEvidence: 'team-tag',
      }),
    ]);
    expect(result.resolved).toHaveLength(1);
    expect(result.unresolved).toHaveLength(0);
    expect(result.ambiguous).toHaveLength(0);
  });

  it('resolves delimiter-suffix player tag OCR text against official slots', async () => {
    const { service, parser } = buildService({
      teams: [
        { id: 'team-cb', organizationId: 'org-1', tag: 'CB', deletedAt: null },
      ],
      matchSlots: [
        {
          id: 'slot-6',
          matchId: 'match-1',
          teamId: 'team-cb',
          slotNumber: 6,
          deletedAt: null,
        },
      ],
    });
    parser.parseScreenshot.mockResolvedValue([
      {
        position: 4,
        tag: "xSkena'CB",
        kills: 5,
        playerNames: ["xSkena'CB", "x3omda'CB"],
        slotNumber: null,
        confidence: null,
      },
    ]);

    const result = await service.previewScreenshot(actor as any, {
      matchId: 'match-1',
      imageUrl: 'https://example.com/result.png',
    });

    expect(result.preview).toEqual([
      expect.objectContaining({
        position: 4,
        tag: 'CB',
        kills: 5,
        teamId: 'team-cb',
        slotId: 'slot-6',
        slotNumber: 6,
        status: 'OK',
      }),
    ]);
    expect(result.resolved).toHaveLength(1);
    expect(result.unresolved).toHaveLength(0);
    expect(result.ambiguous).toHaveLength(0);
  });

  it('resolves merged tag/player OCR text against official slots', async () => {
    const { service, parser } = buildService({
      teams: [
        {
          id: 'team-vlk',
          organizationId: 'org-1',
          tag: 'VLK',
          deletedAt: null,
        },
        {
          id: 'team-tmt',
          organizationId: 'org-1',
          tag: 'TMT',
          deletedAt: null,
        },
      ],
      matchSlots: [
        {
          id: 'slot-5',
          matchId: 'match-1',
          teamId: 'team-vlk',
          slotNumber: 5,
          deletedAt: null,
        },
        {
          id: 'slot-3',
          matchId: 'match-1',
          teamId: 'team-tmt',
          slotNumber: 3,
          deletedAt: null,
        },
      ],
    });
    parser.parseScreenshot.mockResolvedValue([
      {
        position: 5,
        tag: 'vlk¹MADARA',
        kills: 4,
        playerNames: ['vlk¹MADARA', 'vlk¹RUTHLESS', 'BL4¹RAYEN', 'vlk¹KARASU'],
        slotNumber: null,
        confidence: 0.9,
      },
    ]);

    const result = await service.previewScreenshot(actor as any, {
      matchId: 'match-1',
      imageUrl: 'https://example.com/result.png',
    });

    expect(result.preview[0]).toEqual(
      expect.objectContaining({
        position: 5,
        tag: 'VLK',
        kills: 4,
        teamId: 'team-vlk',
        slotId: 'slot-5',
        slotNumber: 5,
        status: 'OK',
      }),
    );
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
        {
          id: 'slot-2',
          matchId: 'match-1',
          teamId: 'team-b',
          slotNumber: 2,
          deletedAt: null,
        },
        {
          id: 'slot-3',
          matchId: 'match-1',
          teamId: 'team-c',
          slotNumber: 3,
          deletedAt: null,
        },
      ],
    });
    parser.parseScreenshot.mockResolvedValue([
      {
        position: 1,
        tag: 'DXB',
        kills: 12,
        playerNames: [],
        slotNumber: null,
        confidence: null,
      },
      {
        position: 2,
        tag: 'MISS',
        kills: 5,
        playerNames: [],
        slotNumber: null,
        confidence: null,
      },
      {
        position: 3,
        tag: 'DUP',
        kills: 4,
        playerNames: [],
        slotNumber: null,
        confidence: null,
      },
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
        playerNames: [],
        confidence: null,
        matchEvidence: 'team-tag',
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
        playerNames: [],
        confidence: null,
      },
      {
        position: 3,
        tag: 'DUP',
        kills: 4,
        teamId: null,
        slotId: null,
        slotNumber: null,
        status: 'AMBIGUOUS',
        reason: 'MULTIPLE_TEAMS_FOR_SCREENSHOT_ROW',
        candidateTeamIds: ['team-b', 'team-c'],
        playerNames: [],
        confidence: null,
      },
    ]);
  });

  it('prefers an exact team tag over a weak mixed player-name tag', async () => {
    const { service, parser } = buildService({
      teams: [
        { id: 'team-i', organizationId: 'org-1', tag: 'I', deletedAt: null },
        { id: 'team-2w', organizationId: 'org-1', tag: '2W', deletedAt: null },
      ],
      matchSlots: [
        {
          id: 'slot-4',
          matchId: 'match-1',
          teamId: 'team-2w',
          slotNumber: 4,
          deletedAt: null,
        },
        {
          id: 'slot-7',
          matchId: 'match-1',
          teamId: 'team-i',
          slotNumber: 7,
          deletedAt: null,
        },
      ],
    });
    parser.parseScreenshot.mockResolvedValue([
      {
        position: 2,
        tag: '2W',
        kills: 13,
        playerNames: ['I Player', '2Wx'],
        slotNumber: null,
        confidence: null,
      },
    ]);

    const result = await service.previewScreenshot(actor as any, {
      matchId: 'match-1',
      imageUrl: 'https://example.com/result.png',
    });

    expect(result.preview[0]).toEqual(
      expect.objectContaining({
        position: 2,
        tag: '2W',
        kills: 13,
        teamId: 'team-2w',
        slotId: 'slot-4',
        slotNumber: 4,
        status: 'OK',
        matchEvidence: 'team-tag',
      }),
    );
    expect(result.resolved).toHaveLength(1);
    expect(result.ambiguous).toHaveLength(0);
  });

  it('saves slot/player OCR mappings and resolves final rows by player names', async () => {
    const { prisma, service, parser } = buildService({
      teams: [
        { id: 'team-a', organizationId: 'org-1', tag: 'DXB', deletedAt: null },
        { id: 'team-b', organizationId: 'org-1', tag: 'NXT', deletedAt: null },
      ],
      matchSlots: [
        {
          id: 'slot-7',
          matchId: 'match-1',
          teamId: 'team-a',
          slotNumber: 7,
          deletedAt: null,
        },
        {
          id: 'slot-8',
          matchId: 'match-1',
          teamId: 'team-b',
          slotNumber: 8,
          deletedAt: null,
        },
      ],
      matchSlotResults: [
        {
          id: 'result-7',
          matchId: 'match-1',
          organizationId: 'org-1',
          teamId: 'team-a',
          slotNumber: 7,
          wasPresentInMatch: null,
          placement: null,
          totalKills: 0,
          manualTotalKills: false,
          points: 0,
          totalPoints: 0,
        },
      ],
    });
    parser.parseSlotMapScreenshot.mockResolvedValue([
      {
        slotNumber: 7,
        tag: 'DXB',
        playerNames: ['DXB Rafi', 'DXB Sami'],
        confidence: 0.94,
      },
    ]);

    const mapped = await service.mapSlotScreenshot(actor as any, {
      matchId: 'match-1',
      imageUrl: 'https://example.com/slots.png',
    });

    expect(mapped.mapped).toHaveLength(1);
    expect(prisma.__state.matchSlotResults[0].wasPresentInMatch).toBe(true);
    expect(prisma.__state.matchControlStates[0].metaJson).toEqual(
      expect.objectContaining({
        ocr: expect.objectContaining({
          slotMappings: [
            expect.objectContaining({
              slotNumber: 7,
              teamId: 'team-a',
              playerNames: ['DXB Rafi', 'DXB Sami'],
            }),
          ],
        }),
      }),
    );

    parser.parseScreenshot.mockResolvedValue([
      {
        position: 1,
        tag: null,
        kills: 14,
        playerNames: ['DXB Sami'],
        slotNumber: null,
        confidence: 0.88,
      },
    ]);

    const result = await service.previewScreenshot(actor as any, {
      matchId: 'match-1',
      imageUrl: 'https://example.com/result.png',
    });

    expect(result.preview[0]).toEqual(
      expect.objectContaining({
        position: 1,
        tag: 'DXB',
        kills: 14,
        teamId: 'team-a',
        slotId: 'slot-7',
        slotNumber: 7,
        status: 'OK',
      }),
    );
  });

  it('uses saved player mappings when OCR picks a wrong row tag', async () => {
    const { service, parser } = buildService({
      teams: [
        {
          id: 'team-pst',
          organizationId: 'org-1',
          tag: 'PST',
          deletedAt: null,
        },
        {
          id: 'team-tbw',
          organizationId: 'org-1',
          tag: 'TBW',
          deletedAt: null,
        },
      ],
      matchSlots: [
        {
          id: 'slot-6',
          matchId: 'match-1',
          teamId: 'team-pst',
          slotNumber: 6,
          deletedAt: null,
        },
        {
          id: 'slot-9',
          matchId: 'match-1',
          teamId: 'team-tbw',
          slotNumber: 9,
          deletedAt: null,
        },
      ],
    });
    parser.parseSlotMapScreenshot.mockResolvedValue([
      {
        slotNumber: 6,
        tag: 'PST',
        playerNames: ['pstHUNTERx7', 'pstUREC'],
        confidence: 0.92,
      },
    ]);
    await service.mapSlotScreenshot(actor as any, {
      matchId: 'match-1',
      imageUrl: 'https://example.com/slots.png',
    });

    parser.parseScreenshot.mockResolvedValue([
      {
        position: 3,
        tag: 'TBw O',
        kills: 9,
        playerNames: ['TBw O', 'pstHUNTERx7', 'pstUREC', 'qig DARWIN'],
        slotNumber: null,
        confidence: 0.9,
      },
    ]);

    const result = await service.previewScreenshot(actor as any, {
      matchId: 'match-1',
      imageUrl: 'https://example.com/result.png',
    });

    expect(result.preview[0]).toEqual(
      expect.objectContaining({
        position: 3,
        tag: 'PST',
        kills: 9,
        teamId: 'team-pst',
        slotId: 'slot-6',
        slotNumber: 6,
        status: 'OK',
      }),
    );
  });

  it('keeps OCR rows with unreadable values in review even when the team matches', async () => {
    const { service, parser } = buildService({
      teams: [
        { id: 'team-a', organizationId: 'org-1', tag: 'DXB', deletedAt: null },
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
      {
        position: 1,
        tag: 'DXB',
        kills: 0,
        playerNames: [],
        players: [],
        slotNumber: null,
        confidence: 0.35,
        ocrIssues: ['KILLS_UNREADABLE'],
      },
    ]);

    const result = await service.previewScreenshot(actor as any, {
      matchId: 'match-1',
      imageUrl: 'https://example.com/result.png',
    });

    expect(result.preview[0]).toEqual(
      expect.objectContaining({
        position: 1,
        tag: 'DXB',
        kills: 0,
        teamId: 'team-a',
        slotId: 'slot-1',
        slotNumber: 1,
        status: 'UNRESOLVED',
        reason: 'OCR_KILLS_UNREADABLE',
        matchEvidence: 'team-tag',
      }),
    );
    expect(result.resolved).toHaveLength(0);
    expect(result.unresolved).toHaveLength(1);
  });

  it('learns edited OCR aliases and reuses them across session matches', async () => {
    const { prisma, results, service, parser } = buildService({
      teams: [
        {
          id: 'team-tb1',
          organizationId: 'org-1',
          tag: 'TB1',
          deletedAt: null,
        },
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
        {
          id: 'match-2',
          organizationId: 'org-1',
          sessionId: 'session-1',
          deletedAt: null,
          status: MatchStatus.LIVE,
        },
      ],
      matchSlots: [
        {
          id: 'slot-8-match-1',
          matchId: 'match-1',
          teamId: 'team-tb1',
          slotNumber: 8,
          deletedAt: null,
        },
        {
          id: 'slot-8-match-2',
          matchId: 'match-2',
          teamId: 'team-tb1',
          slotNumber: 8,
          deletedAt: null,
        },
      ],
      matchSlotResults: [
        {
          id: 'result-8-match-1',
          matchId: 'match-1',
          organizationId: 'org-1',
          teamId: 'team-tb1',
          slotNumber: 8,
          wasPresentInMatch: null,
          placement: null,
          totalKills: 0,
          manualTotalKills: false,
          points: 0,
          totalPoints: 0,
        },
      ],
    });
    results.ensureMatch.mockImplementation(
      async (_actor: unknown, matchId: string) => ({
        id: matchId,
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
      }),
    );

    await service.applyScreenshotResults(actor as any, {
      matchId: 'match-1',
      results: [
        {
          position: 1,
          tag: 'TB1',
          ocrTag: 'dmc',
          ocrPlayerNames: ['Dmn3LAWE'],
          kills: 5,
          teamId: 'team-tb1',
          slotId: 'slot-8-match-1',
          status: ScreenshotPreviewStatusDto.OK,
        },
      ],
    });

    expect(prisma.__state.matchControlStates[0].metaJson).toEqual(
      expect.objectContaining({
        ocr: expect.objectContaining({
          slotMappings: [
            expect.objectContaining({
              slotNumber: 8,
              teamId: 'team-tb1',
              teamAliases: ['dmc'],
              playerNames: ['Dmn3LAWE'],
            }),
          ],
        }),
      }),
    );

    parser.parseScreenshot.mockResolvedValue([
      {
        position: 6,
        tag: 'dmc',
        kills: 8,
        playerNames: [],
        slotNumber: null,
        confidence: 0.9,
      },
    ]);

    const preview = await service.previewScreenshot(actor as any, {
      matchId: 'match-2',
      imageUrl: 'https://example.com/result.png',
    });

    expect(preview.preview[0]).toEqual(
      expect.objectContaining({
        position: 6,
        tag: 'TB1',
        kills: 8,
        teamId: 'team-tb1',
        slotId: 'slot-8-match-2',
        slotNumber: 8,
        status: 'OK',
        matchEvidence: 'saved-team-alias',
      }),
    );
  });

  it('does not learn an OCR alias that is another active slot official tag', async () => {
    const { prisma, service } = buildService({
      teams: [
        {
          id: 'team-kla',
          organizationId: 'org-1',
          tag: 'KLA',
          deletedAt: null,
        },
        {
          id: 'team-aim',
          organizationId: 'org-1',
          tag: 'AIM',
          deletedAt: null,
        },
      ],
      matchSlots: [
        {
          id: 'slot-kla',
          matchId: 'match-1',
          teamId: 'team-kla',
          slotNumber: 9,
          deletedAt: null,
        },
        {
          id: 'slot-aim',
          matchId: 'match-1',
          teamId: 'team-aim',
          slotNumber: 19,
          deletedAt: null,
        },
      ],
      matchSlotResults: [
        {
          id: 'result-kla',
          matchId: 'match-1',
          organizationId: 'org-1',
          teamId: 'team-kla',
          slotNumber: 9,
          wasPresentInMatch: null,
          placement: null,
          totalKills: 0,
          manualTotalKills: false,
          points: 0,
          totalPoints: 0,
        },
      ],
    });

    await service.applyScreenshotResults(actor as any, {
      matchId: 'match-1',
      results: [
        {
          position: 1,
          tag: 'KLA',
          ocrTag: 'AIM',
          ocrPlayerNames: ['Laur1'],
          kills: 5,
          teamId: 'team-kla',
          slotId: 'slot-kla',
          status: ScreenshotPreviewStatusDto.OK,
        },
      ],
    });

    expect(prisma.__state.matchControlStates[0].metaJson).toEqual(
      expect.objectContaining({
        ocr: expect.objectContaining({
          slotMappings: [
            expect.objectContaining({
              slotNumber: 9,
              teamId: 'team-kla',
              playerNames: ['Laur1'],
            }),
          ],
        }),
      }),
    );
    expect(
      (
        prisma.__state.matchControlStates[0].metaJson?.ocr as {
          slotMappings: Array<{ teamAliases?: string[] }>;
        }
      ).slotMappings[0].teamAliases,
    ).toBeUndefined();
  });

  it('ignores saved OCR aliases that collide with another active slot official tag', async () => {
    const { service, parser } = buildService({
      teams: [
        {
          id: 'team-kla',
          organizationId: 'org-1',
          tag: 'KLA',
          deletedAt: null,
        },
        {
          id: 'team-aim',
          organizationId: 'org-1',
          tag: 'AIM',
          deletedAt: null,
        },
      ],
      matchSlots: [
        {
          id: 'slot-kla',
          matchId: 'match-1',
          teamId: 'team-kla',
          slotNumber: 9,
          deletedAt: null,
        },
        {
          id: 'slot-aim',
          matchId: 'match-1',
          teamId: 'team-aim',
          slotNumber: 19,
          deletedAt: null,
        },
      ],
      matchControlStates: [
        {
          matchId: 'match-1',
          organizationId: 'org-1',
          metaJson: {
            ocr: {
              slotMappings: [
                {
                  slotNumber: 9,
                  teamId: 'team-kla',
                  teamTag: 'KLA',
                  teamAliases: ['AIM'],
                  playerNames: [],
                  sourceImageUrl: 'result-review',
                  confidence: null,
                  updatedAt: '2026-06-09T00:00:00.000Z',
                },
              ],
            },
          },
        },
      ],
    });
    parser.parseScreenshot.mockResolvedValue([
      {
        position: 4,
        tag: 'AIM',
        kills: 5,
        playerNames: ['Laur1'],
        players: [],
        slotNumber: null,
        confidence: 0.9,
      },
    ]);

    const result = await service.previewScreenshot(actor as any, {
      matchId: 'match-1',
      imageUrl: 'https://example.com/result.png',
    });

    expect(result.preview[0]).toEqual(
      expect.objectContaining({
        position: 4,
        tag: 'AIM',
        teamId: null,
        slotId: null,
        slotNumber: null,
        status: 'UNRESOLVED',
      }),
    );
    expect(result.preview[0]).not.toEqual(
      expect.objectContaining({
        teamId: 'team-kla',
        matchEvidence: 'saved-team-alias',
      }),
    );
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
      matchSlotPlayerResults: [
        {
          id: 'player-result-1',
          slotResultId: 'result-1',
          organizationId: 'org-1',
          playerName: 'DXB Rafi',
          playerId: null,
          pubgAccountId: null,
          externalPlayerId: null,
          kills: 0,
        },
        {
          id: 'player-result-old',
          slotResultId: 'result-1',
          organizationId: 'org-1',
          playerName: 'DXB Old',
          playerId: null,
          pubgAccountId: null,
          externalPlayerId: null,
          kills: 3,
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
            players: [
              { name: 'DXB Rafi', kills: 7 },
              { name: 'DXB Sami', kills: 5 },
            ],
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
      noShowCount: 0,
      summary: [
        {
          position: 1,
          teamName: null,
          tag: 'DXB',
          kills: 12,
          placementPoints: 10,
          totalPoints: 22,
          slotNumber: 1,
          teamId: 'team-a',
        },
        {
          position: 2,
          teamName: null,
          tag: 'NXT',
          kills: 8,
          placementPoints: 6,
          totalPoints: 14,
          slotNumber: 2,
          teamId: 'team-b',
        },
      ],
    });

    expect(prisma.__state.matchSlotResults).toEqual([
      expect.objectContaining({
        teamId: 'team-a',
        slotNumber: 1,
        placement: 1,
        totalKills: 12,
        manualTotalKills: false,
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
    expect(prisma.__state.matchSlotPlayerResults).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'player-result-1',
          playerName: 'DXB Rafi',
          kills: 7,
        }),
        expect.objectContaining({
          playerName: 'DXB Sami',
          kills: 5,
        }),
        expect.objectContaining({
          id: 'player-result-old',
          playerName: 'DXB Old',
          kills: 0,
        }),
      ]),
    );

    const standings = new SessionsStandingsService(prisma);
    await expect(
      standings.getStandings('session-1', actor as any),
    ).resolves.toEqual({
      sessionId: 'session-1',
      teams: [
        {
          teamId: 'team-a',
          teamName: null,
          tag: 'DXB',
          totalPoints: 22,
          totalKills: 12,
          placementPoints: 10,
          wwcd: 1,
          matchesPlayed: 1,
          avgPlacement: 1,
          rank: 1,
        },
        {
          teamId: 'team-b',
          teamName: null,
          tag: 'NXT',
          totalPoints: 14,
          totalKills: 8,
          placementPoints: 6,
          wwcd: 0,
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

  it('marks missing official slots as no-show from the official slot list', async () => {
    const { prisma, results, service } = buildService({
      teams: [
        { id: 'team-a', organizationId: 'org-1', tag: 'DXB', deletedAt: null },
        { id: 'team-b', organizationId: 'org-1', tag: 'NXT', deletedAt: null },
        { id: 'team-c', organizationId: 'org-1', tag: 'MISS', deletedAt: null },
      ],
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
        {
          id: 'slot-3',
          matchId: 'match-1',
          teamId: 'team-c',
          slotNumber: 3,
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
        {
          id: 'result-3',
          matchId: 'match-1',
          organizationId: 'org-1',
          teamId: 'team-c',
          slotNumber: 3,
          wasPresentInMatch: null,
          placement: 2,
          totalKills: 5,
          manualTotalKills: true,
          points: 11,
          totalPoints: 11,
        },
      ],
      matchSlotPlayerResults: [
        {
          id: 'player-result-3',
          slotResultId: 'result-3',
          organizationId: 'org-1',
          playerName: 'MISS Player',
          kills: 5,
        },
      ],
    });

    const applied = await service.applyScreenshotResults(actor as any, {
      matchId: 'match-1',
      markMissingSlotsNoShow: true,
      results: [
        {
          position: 1,
          tag: 'DXB',
          kills: 9,
          teamId: 'team-a',
          slotId: 'slot-1',
          status: ScreenshotPreviewStatusDto.OK,
        },
        {
          position: 2,
          tag: 'NXT',
          kills: 4,
          teamId: 'team-b',
          slotId: 'slot-2',
          status: ScreenshotPreviewStatusDto.OK,
        },
      ],
    });

    expect(applied.noShowCount).toBe(1);
    expect(prisma.__state.matchSlotResults).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'result-3',
          wasPresentInMatch: false,
          placement: null,
          totalKills: 0,
          manualTotalKills: false,
          totalPoints: 0,
        }),
      ]),
    );
    expect(prisma.__state.matchSlotPlayerResults).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'player-result-3',
          kills: 0,
        }),
      ]),
    );
    expect(results.storeNoShowBanSnapshotForMatch).toHaveBeenCalledWith(
      'match-1',
      'screenshot-apply',
    );
    expect(results.applyReviewedNoShowAutoBans).not.toHaveBeenCalled();
  });

  it('does not require slot mappings when no assigned slots are missing', async () => {
    const { prisma, service } = buildService({
      teams: [
        { id: 'team-a', organizationId: 'org-1', tag: 'DXB', deletedAt: null },
        { id: 'team-b', organizationId: 'org-1', tag: 'NXT', deletedAt: null },
      ],
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

    const applied = await service.applyScreenshotResults(actor as any, {
      matchId: 'match-1',
      markMissingSlotsNoShow: true,
      results: [
        {
          position: 1,
          tag: 'DXB',
          kills: 9,
          teamId: 'team-a',
          slotId: 'slot-1',
          status: ScreenshotPreviewStatusDto.OK,
        },
        {
          position: 2,
          tag: 'NXT',
          kills: 4,
          teamId: 'team-b',
          slotId: 'slot-2',
          status: ScreenshotPreviewStatusDto.OK,
        },
      ],
    });

    expect(applied.noShowCount).toBe(0);
    expect(prisma.__state.matchSlotResults).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'result-1',
          placement: 1,
          totalKills: 9,
        }),
        expect.objectContaining({
          id: 'result-2',
          placement: 2,
          totalKills: 4,
        }),
      ]),
    );
  });

  it('allows reviewed screenshot rows to restore stale no-show slot results', async () => {
    const { prisma, results, service } = buildService({
      teams: [
        {
          id: 'team-4q',
          organizationId: 'org-1',
          tag: '4Q',
          deletedAt: null,
        },
      ],
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
          id: 'slot-19',
          matchId: 'match-1',
          teamId: 'team-4q',
          slotNumber: 19,
          deletedAt: null,
        },
      ],
      matchSlotResults: [
        {
          id: 'result-19',
          matchId: 'match-1',
          organizationId: 'org-1',
          teamId: 'team-4q',
          slotNumber: 19,
          wasPresentInMatch: false,
          placement: null,
          totalKills: 0,
          manualTotalKills: false,
          points: 0,
          totalPoints: 0,
        },
      ],
    });

    await service.applyScreenshotResults(actor as any, {
      matchId: 'match-1',
      results: [
        {
          position: 1,
          tag: '4Q',
          kills: 3,
          teamId: 'team-4q',
          slotId: 'slot-19',
          status: ScreenshotPreviewStatusDto.OK,
        },
      ],
    });

    expect(results.assertSlotPresentForMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'result-19',
        slotNumber: 19,
        teamId: 'team-4q',
      }),
      { allowManualPromote: true },
    );
    expect(prisma.__state.matchSlotResults).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'result-19',
          wasPresentInMatch: true,
          placement: 1,
          totalKills: 3,
        }),
      ]),
    );
  });

  it('clears stale slot results that conflict with newly applied screenshot placements', async () => {
    const { prisma, service } = buildService({
      teams: [
        { id: 'team-a', organizationId: 'org-1', tag: 'DXB', deletedAt: null },
        { id: 'team-b', organizationId: 'org-1', tag: 'NXT', deletedAt: null },
        { id: 'team-c', organizationId: 'org-1', tag: 'OLD', deletedAt: null },
      ],
      matches: [
        {
          id: 'match-1',
          organizationId: 'org-1',
          sessionId: null,
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
        {
          id: 'slot-3',
          matchId: 'match-1',
          teamId: 'team-c',
          slotNumber: 3,
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
        {
          id: 'result-stale',
          matchId: 'match-1',
          organizationId: 'org-1',
          teamId: 'team-c',
          slotNumber: 3,
          wasPresentInMatch: true,
          placement: 1,
          totalKills: 4,
          manualTotalKills: true,
          points: 4,
          totalPoints: 14,
        },
      ],
      matchSlotPlayerResults: [
        {
          id: 'player-stale',
          slotResultId: 'result-stale',
          organizationId: 'org-1',
          playerName: 'OLD Player',
          kills: 4,
        },
      ],
    });

    await service.applyScreenshotResults(actor as any, {
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
    });

    expect(prisma.__state.matchSlotResults).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'result-1',
          placement: 1,
          totalKills: 12,
          manualTotalKills: true,
          totalPoints: 22,
        }),
        expect.objectContaining({
          id: 'result-stale',
          placement: null,
          totalKills: 0,
          manualTotalKills: false,
          totalPoints: 0,
        }),
      ]),
    );
    expect(prisma.__state.matchSlotPlayerResults).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'player-stale',
          kills: 0,
        }),
      ]),
    );
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

  it('rejects apply when placement rows are missing', async () => {
    const { service, results } = buildService();

    await expect(
      service.applyScreenshotResults(actor as any, {
        matchId: 'match-1',
        results: [
          {
            position: 1,
            tag: 'DXB',
            kills: 4,
            teamId: 'team-a',
            slotId: 'slot-a',
            status: ScreenshotPreviewStatusDto.OK,
          },
          {
            position: 3,
            tag: 'NXT',
            kills: 2,
            teamId: 'team-b',
            slotId: 'slot-b',
            status: ScreenshotPreviewStatusDto.OK,
          },
        ],
      }),
    ).rejects.toThrow(
      'Cannot apply screenshot results with missing placement rows: 2',
    );

    expect(results.ensureResultsEditableByMatchId).not.toHaveBeenCalled();
  });
});
