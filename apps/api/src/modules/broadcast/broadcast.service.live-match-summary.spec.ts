import { LiveState, MatchStatus } from '@prisma/client';
import { PrismaService } from '../../db/prisma.service';
import { CanonicalControlReadService } from '../realtime/canonical-control-read.service';
import { OrganizationBrandingService } from '../organization-branding/organization-branding.service';
import { WidgetBroadcastGateway } from './broadcast.gateway';
import { BroadcastService } from './broadcast.service';

describe('BroadcastService live match summary', () => {
  it('returns the live match id fields required by widgets', async () => {
    const prisma = {
      organization: {
        findFirst: jest.fn().mockResolvedValue({ id: 'org-1' }),
      },
    } as unknown as PrismaService;

    const service = new BroadcastService(
      prisma,
      {} as WidgetBroadcastGateway,
      {} as OrganizationBrandingService,
      {} as CanonicalControlReadService,
    );

    jest.spyOn(service, 'findLiveMatchForBroadcastOrg').mockResolvedValue({
      id: 'match-1',
      tournamentId: 'tournament-1',
      stageId: 'stage-1',
      groupId: 'group-1',
      status: MatchStatus.LIVE,
      liveState: LiveState.LIVE,
      matchNumber: 11,
      name: 'Match 11',
      map: 'ERANGEL',
      updatedAt: new Date('2026-03-10T18:39:25.217Z'),
      tournament: { name: 'Test 1', logoUrl: '/logo.png' },
      stage: { name: 'Stage 1' },
      group: null,
      scheduledAt: new Date('2026-03-10T18:39:25.217Z'),
      liveAt: null,
      startedAt: null,
    } as never);

    await expect(
      service.getLiveMatchSummaryForOrganizationSlug('global-control'),
    ).resolves.toMatchObject({
      id: 'match-1',
      matchId: 'match-1',
      tournamentId: 'tournament-1',
      stageId: 'stage-1',
      groupId: 'group-1',
      status: MatchStatus.LIVE,
      liveState: LiveState.LIVE,
      matchNumber: 11,
      matchName: 'Match 11',
      map: 'ERANGEL',
      tournamentName: 'Test 1',
      tournamentLogo: '/logo.png',
      stageName: 'Stage 1',
      startsAt: '2026-03-10T18:39:25.217Z',
      endedAt: null,
    });
  });

  it('ignores stale draft matches that were left in ENDED liveState when resolving the active match fallback', async () => {
    const cleanUpcoming = {
      id: 'match-upcoming',
      tournamentId: 't-1',
      stageId: null,
      groupId: null,
      organizationId: 'org-1',
      name: 'Match 32',
      matchNumber: 32,
      map: 'ERANGEL',
      status: MatchStatus.DRAFT,
      liveState: LiveState.UPCOMING,
      liveAt: null,
      startedAt: null,
      updatedAt: new Date('2026-04-06T10:00:00.000Z'),
      scheduledAt: new Date('2026-04-06T11:00:00.000Z'),
      stage: { name: 'Stage 1' },
      group: null,
      tournament: { name: 'Test 1', logoUrl: null },
    };

    const prisma = {
      organization: {
        findFirst: jest.fn().mockResolvedValue({ id: 'org-1' }),
      },
      match: {
        findFirst: jest
          .fn()
          .mockImplementation(
            ({ where }: { where: Record<string, unknown> }) => {
              if (where.status === MatchStatus.LIVE) {
                return Promise.resolve(null);
              }

              if (where.status === MatchStatus.DRAFT) {
                return Promise.resolve(
                  where.liveState === LiveState.UPCOMING
                    ? cleanUpcoming
                    : {
                        id: 'match-stale',
                        name: 'Match 7',
                        matchNumber: 7,
                        map: 'MIRAMAR',
                        status: MatchStatus.DRAFT,
                        liveState: LiveState.ENDED,
                      },
                );
              }

              return Promise.resolve(null);
            },
          ),
      },
    } as unknown as PrismaService;

    const service = new BroadcastService(
      prisma,
      {} as WidgetBroadcastGateway,
      {} as OrganizationBrandingService,
      {} as CanonicalControlReadService,
    );

    jest
      .spyOn(service as never, 'detectLiveMatchConflicts' as never)
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(service as never, 'fetchSponsors' as never)
      .mockResolvedValue([] as never);

    await expect(
      service.getActiveMatchSummaryForOrganizationSlug('global-control'),
    ).resolves.toMatchObject({
      id: 'match-upcoming',
      matchId: 'match-upcoming',
      status: MatchStatus.DRAFT,
      liveState: LiveState.UPCOMING,
      matchNumber: 32,
      map: 'ERANGEL',
    });
  });

  it('does not surface ancient upcoming drafts as the next active match fallback', async () => {
    const prisma = {
      organization: {
        findFirst: jest.fn().mockResolvedValue({ id: 'org-1' }),
      },
      match: {
        findFirst: jest
          .fn()
          .mockImplementation(
            ({ where }: { where: Record<string, unknown> }) => {
              if (where.status === MatchStatus.LIVE) {
                return Promise.resolve(null);
              }

              if (where.status === MatchStatus.DRAFT) {
                const clauses = Array.isArray(where.OR) ? where.OR : [];
                const hasStaleWindowClause = clauses.length > 0;
                return Promise.resolve(
                  hasStaleWindowClause
                    ? null
                    : {
                        id: 'match-stale-upcoming',
                        name: 'Match 9',
                        matchNumber: 9,
                        map: 'ERANGEL',
                        status: MatchStatus.DRAFT,
                        liveState: LiveState.UPCOMING,
                      },
                );
              }

              return Promise.resolve(null);
            },
          ),
      },
    } as unknown as PrismaService;

    const service = new BroadcastService(
      prisma,
      {} as WidgetBroadcastGateway,
      {} as OrganizationBrandingService,
      {} as CanonicalControlReadService,
    );

    jest
      .spyOn(service as never, 'detectLiveMatchConflicts' as never)
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(service as never, 'fetchSponsors' as never)
      .mockResolvedValue([] as never);

    await expect(
      service.getActiveMatchSummaryForOrganizationSlug('global-control'),
    ).resolves.toBeNull();
  });
});
