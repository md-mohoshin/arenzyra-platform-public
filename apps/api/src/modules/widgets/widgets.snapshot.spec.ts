import { MatchStatus } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import {
  buildWidgetScoreboardSnapshot,
  resolveTeamLogoUrl,
} from './widgets.snapshot';

const buildMatch = (
  metaJson: Record<string, unknown> | null = null,
  slotResults: Array<Record<string, unknown>> | null = null,
) => ({
  id: 'match-1',
  organizationId: 'org-1',
  tournamentId: 'tour-1',
  game: { key: 'PUBG_MOBILE' },
  dataSource: 'API',
  dataMode: 'MANUAL',
  status: MatchStatus.LIVE,
  liveState: 'LIVE',
  updatedAt: new Date('2026-03-18T10:05:00.000Z'),
  controlState: {
    state: 'LIVE',
    metaJson,
  },
  matchSlots: [
    {
      slotNumber: 1,
      team: {
        id: 'team-1',
        name: 'Team One',
        tag: 'ONE',
        logoUrl: null,
        logoLightUrl: null,
        logoDarkUrl: null,
        accentLight: null,
        textOnLight: null,
        accentDark: null,
        textOnDark: null,
        updatedAt: null,
      },
    },
  ],
  slotResults: slotResults ?? [
    {
      slotNumber: 1,
      wasPresentInMatch: true,
      placement: null,
      placementPoints: 0,
      totalKills: 0,
      totalPoints: 0,
      isLocked: false,
      team: {
        id: 'team-1',
        name: 'Team One',
        tag: 'ONE',
        logoUrl: null,
        logoLightUrl: null,
        logoDarkUrl: null,
        accentLight: null,
        textOnLight: null,
        accentDark: null,
        textOnDark: null,
        updatedAt: null,
      },
    },
  ],
});

describe('buildWidgetScoreboardSnapshot', () => {
  it('normalizes localhost team logo urls before versioning', () => {
    expect(
      resolveTeamLogoUrl({
        logoUrl: 'http://localhost:3000/uploads/teams/team-one.png',
        updatedAt: new Date('2026-04-01T10:00:00.000Z'),
      }),
    ).toBe('/uploads/teams/team-one.png?v=1775037600000');
  });

  it('ignores stale snapshot alive-team state when the live match has no telemetry freshness proof', async () => {
    const prisma = {
      match: {
        findFirst: jest.fn().mockResolvedValue(buildMatch(null)),
      },
      matchStateSnapshot: {
        findUnique: jest.fn().mockResolvedValue({
          stateJson: {
            status: 'LIVE',
            updatedAt: 200,
            teamsAlive: 1,
          },
        }),
      },
      matchSlotPlayerResult: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    } as unknown as PrismaClient;

    const payload = await buildWidgetScoreboardSnapshot(prisma, 'match-1');

    expect(payload.state.aliveTeams).toBeNull();
    expect(payload.state.resultsLocked).toBe(false);
  });

  it('uses snapshot alive-team state when the current run has telemetry freshness proof', async () => {
    const prisma = {
      match: {
        findFirst: jest.fn().mockResolvedValue(
          buildMatch({
            telemetryUpdatedAt: 200,
          }),
        ),
      },
      matchStateSnapshot: {
        findUnique: jest.fn().mockResolvedValue({
          stateJson: {
            status: 'LIVE',
            updatedAt: 200,
            telemetryAcceptedAt: 200,
            teamsAlive: 1,
          },
        }),
      },
      matchSlotPlayerResult: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    } as unknown as PrismaClient;

    const payload = await buildWidgetScoreboardSnapshot(prisma, 'match-1');

    expect(payload.state.aliveTeams).toBe(1);
    expect(payload.state.resultsLocked).toBe(true);
  });

  it('excludes NO_SHOW teams from widget rows', async () => {
    const prisma = {
      match: {
        findFirst: jest.fn().mockResolvedValue(
          buildMatch(null, [
            {
              slotNumber: 1,
              wasPresentInMatch: true,
              placement: 1,
              placementPoints: 10,
              totalKills: 5,
              totalPoints: 15,
              isLocked: false,
              team: {
                id: 'team-1',
                name: 'Team One',
                tag: 'ONE',
                logoUrl: null,
                logoLightUrl: null,
                logoDarkUrl: null,
                accentLight: null,
                textOnLight: null,
                accentDark: null,
                textOnDark: null,
                updatedAt: null,
              },
            },
            {
              slotNumber: 2,
              wasPresentInMatch: false,
              placement: 25,
              placementPoints: 0,
              totalKills: 9,
              totalPoints: 9,
              isLocked: false,
              team: {
                id: 'team-2',
                name: 'Team Two',
                tag: 'TWO',
                logoUrl: null,
                logoLightUrl: null,
                logoDarkUrl: null,
                accentLight: null,
                textOnLight: null,
                accentDark: null,
                textOnDark: null,
                updatedAt: null,
              },
            },
          ]),
        ),
      },
      matchStateSnapshot: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      matchSlotPlayerResult: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    } as unknown as PrismaClient;

    const payload = await buildWidgetScoreboardSnapshot(prisma, 'match-1');

    expect(payload.rows).toHaveLength(1);
    expect(payload.rows[0]).toMatchObject({
      teamId: 'team-1',
      wasPresentInMatch: true,
      presenceStatus: 'ACTIVE',
      placement: 1,
      totalKills: 5,
      totalPoints: 15,
    });
  });

  it('uses the organization default team logo when a logo snapshot has no team logo', async () => {
    const prisma = {
      match: {
        findFirst: jest.fn().mockResolvedValue(buildMatch(null)),
      },
      organizationBranding: {
        findUnique: jest.fn().mockResolvedValue({
          defaultTeamLogoUrl:
            'http://localhost:3000/uploads/defaults/server-logo.png',
        }),
      },
      matchStateSnapshot: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      matchSlotPlayerResult: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    } as unknown as PrismaClient;

    const payload = await buildWidgetScoreboardSnapshot(prisma, 'match-1', {
      includeLogos: true,
    });

    expect(payload.rows[0].teamLogoUrl).toMatch(
      /^\/uploads\/defaults\/server-logo\.png\?v=\d+$/,
    );
  });
});
