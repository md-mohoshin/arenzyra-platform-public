import { Controller, Get, Param } from '@nestjs/common';
import { Public } from '../../common/auth/public.decorator';
import { BroadcastService } from './broadcast.service';

@Controller('api/organizations')
export class BroadcastOrganizationsController {
  constructor(private readonly broadcast: BroadcastService) {}

  @Get(':organizationSlug/live-match')
  @Public()
  async getLiveMatchByOrganizationSlug(
    @Param('organizationSlug') organizationSlug: string,
  ) {
    return this.broadcast.getLiveMatchSummaryForOrganizationSlug(
      organizationSlug,
    );
  }

  @Get(':organizationSlug/active-match')
  @Public()
  async getActiveMatchByOrganizationSlug(
    @Param('organizationSlug') organizationSlug: string,
  ) {
    return this.broadcast.getActiveMatchSummaryForOrganizationSlug(
      organizationSlug,
    );
  }

  @Get(':organizationSlug/matches/:matchId')
  @Public()
  async getMatchByOrganizationSlug(
    @Param('organizationSlug') organizationSlug: string,
    @Param('matchId') matchId: string,
  ) {
    return this.broadcast.getMatchSummaryForOrganizationSlug(
      organizationSlug,
      matchId,
    );
  }

  @Get(':organizationSlug/latest-finished-match')
  @Public()
  async getLatestFinishedMatchByOrganizationSlug(
    @Param('organizationSlug') organizationSlug: string,
  ) {
    return this.broadcast.getLatestFinishedMatchSummaryForOrganizationSlug(
      organizationSlug,
    );
  }

  @Get(':organizationSlug/next-match')
  @Public()
  async getNextMatchByOrganizationSlug(
    @Param('organizationSlug') organizationSlug: string,
  ) {
    return this.broadcast.getNextMatchSummaryForOrganizationSlug(
      organizationSlug,
    );
  }

  @Get(':organizationSlug/widget-context')
  @Public()
  async getWidgetContextByOrganizationSlug(
    @Param('organizationSlug') organizationSlug: string,
  ) {
    return this.broadcast.getWidgetContextForOrganizationSlug(organizationSlug);
  }

  @Get(':organizationId/matches/live')
  @Public()
  async getLiveMatch(@Param('organizationId') organizationId: string) {
    const liveMatch =
      await this.broadcast.findLiveMatchForBroadcastOrg(organizationId);
    const branding = await this.broadcast.getBranding(organizationId);

    const rawSponsors =
      (liveMatch as { tournament?: { sponsors?: unknown[] } }).tournament
        ?.sponsors ?? [];

    type SponsorLike = {
      id?: unknown;
      name?: unknown;
      logoUrl?: unknown;
      tier?: unknown;
      displayOrder?: unknown;
      tournamentId?: unknown;
      websiteUrl?: unknown;
      rotationIntervalSeconds?: unknown;
    };

    const tournamentName = liveMatch.tournament?.name ?? null;
    const matchNumber = liveMatch.matchNumber ?? liveMatch.name ?? null;
    const matchName = liveMatch.name ?? null;
    const groupName = liveMatch.group?.name ?? null;
    const map = liveMatch.map ?? null;
    const tournamentLogo = liveMatch.tournament?.logoUrl ?? null;
    const sponsors = Array.isArray(rawSponsors)
      ? rawSponsors.map((sponsor) => {
          if (typeof sponsor !== 'object' || sponsor === null) {
            return {
              id: null,
              name: null,
              logoUrl: null,
              tier: null,
              displayOrder: null,
              tournamentId: null,
              websiteUrl: null,
              rotationIntervalSeconds: null,
            };
          }
          const s = sponsor as SponsorLike;
          return {
            id: typeof s.id === 'string' ? s.id : null,
            name: typeof s.name === 'string' ? s.name : null,
            logoUrl: typeof s.logoUrl === 'string' ? s.logoUrl : null,
            tier: typeof s.tier === 'string' ? s.tier : null,
            displayOrder:
              typeof s.displayOrder === 'number' ? s.displayOrder : null,
            tournamentId:
              typeof s.tournamentId === 'string' ? s.tournamentId : null,
            websiteUrl: typeof s.websiteUrl === 'string' ? s.websiteUrl : null,
            rotationIntervalSeconds:
              typeof s.rotationIntervalSeconds === 'number'
                ? s.rotationIntervalSeconds
                : null,
          };
        })
      : [];

    return {
      id: liveMatch.id,
      organizationId: liveMatch.organizationId,
      tournamentId: liveMatch.tournamentId,
      tournamentName,
      matchNumber,
      matchName,
      groupName,
      map,
      tournamentLogo,
      sponsors,
      branding,
      data: {
        tournamentName,
        matchNumber,
        matchName,
        groupName,
        map,
        tournamentLogo,
        sponsors,
        branding,
      },
    };
  }
}
