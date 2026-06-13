import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  Logger,
  forwardRef,
} from '@nestjs/common';
import { LiveState, MatchStatus, Prisma, Role } from '@prisma/client';
import { PrismaService } from '../../db/prisma.service';
import type { AuthUser } from '../../common/auth/auth.types';
import { effectiveOrganizationId } from '../../common/org/org.util';
import { generateBroadcastKey } from '../../common/crypto/broadcast-key.util';
import { WidgetBroadcastGateway } from './broadcast.gateway';
import {
  buildWidgetScoreboardSnapshot,
  TEAM_LOGO_PLACEHOLDER,
  type BrandMode,
} from '../widgets/widgets.snapshot';
import type { MatchLiveStatePayload } from '../realtime/match-live-state.types';
import { CanonicalControlReadService } from '../realtime/canonical-control-read.service';
import { OrganizationBrandingService } from '../organization-branding/organization-branding.service';
import { detectOrganizationLiveMatchConflicts } from '../../common/live-match-conflict.util';
import { MATCH_FINISHED_STATUSES } from '../../common/match-status.util';
import { normalizePublicAssetUrl } from '../../common/public-asset-url.util';

const DEFAULT_WIDGET_TEAM_NAME = 'Arenzyra';

type BroadcastPlayerDto = {
  id: string;
  name: string;
  handle?: string | null;
  role?: string | null;
  avatarUrl?: string | null;
};

type BroadcastTeamDto = {
  id: string;
  name: string;
  tag?: string | null;
  logoUrl?: string | null;
  seed?: number | null;
  slot?: number | null;
  players: BroadcastPlayerDto[];
};

type BroadcastTournamentDto = {
  id: string;
  name: string;
  status?: string | null;
  liveState: LiveState | null;
  shortName?: string | null;
  logoUrl?: string | null;
  bannerUrl?: string | null;
};

type BroadcastMatchDto = {
  id: string;
  tournamentId: string | null;
  sessionId: string | null;
  name?: string | null;
  number?: number | null;
  map?: string | null;
  status: MatchStatus;
  liveState: LiveState | null;
  stage?: string | null;
  group?: string | null;
  startTime?: string | null;
};

type BroadcastSponsorDto = {
  id: string;
  name: string;
  logoUrl?: string | null;
  tier?: string | null;
  priority?: number | null;
  displayOrder?: number | null;
  websiteUrl?: string | null;
  rotationIntervalSeconds?: number | null;
  isActive?: boolean | null;
};

export type BroadcastPayload = {
  widgetKey: string;
  tournament: BroadcastTournamentDto | null;
  match: BroadcastMatchDto | null;
  teams: BroadcastTeamDto[];
  sponsors: BroadcastSponsorDto[];
  timestamp: string;
  branding?: Record<string, unknown> | null;
};

export type MatchLowerThirdEventPayload = {
  widgetKey: 'match-lower-third';
  tournament: BroadcastTournamentDto | null;
  match: BroadcastMatchDto | null;
  branding?: Record<string, unknown> | null;
  timestamp: string;
  durationMs?: number | null;
};

type PlayerRow = {
  id: string;
  ign: string;
  realName: string | null;
  role: string | null;
  photoUrl: string | null;
};

type MatchWithRelations = {
  id: string;
  tournamentId: string | null;
  sessionId: string | null;
  stageId: string | null;
  groupId: string | null;
  organizationId: string;
  name: string | null;
  matchNumber: number | null;
  map: string | null;
  status: MatchStatus;
  liveState: LiveState | null;
  liveAt: Date | null;
  startedAt: Date | null;
  endedAt: Date | null;
  updatedAt: Date | null;
  scheduledAt: Date | null;
  stage: { name: string | null } | null;
  group: { id?: string | null; name: string | null } | null;
  tournament: {
    id: string;
    name: string;
    status: string | null;
    liveState: LiveState | null;
    shortName: string | null;
    logoUrl: string | null;
    bannerUrl: string | null;
  } | null;
  session: {
    id: string;
    name: string;
    status: string | null;
    logoUrl: string | null;
    bannerUrl: string | null;
  } | null;
  organization: {
    id: string;
    name: string;
    broadcastKey: string | null;
  } | null;
  matchTeams: Array<{
    slot: number | null;
    tournamentTeam: { seed: number | null } | null;
    team: {
      id: string;
      name: string;
      tag: string | null;
      logoUrl: string | null;
      players: PlayerRow[];
    } | null;
  }>;
  matchSlots: Array<{
    slotNumber: number;
    team: {
      id: string;
      name: string;
      tag: string | null;
      logoUrl: string | null;
      players: PlayerRow[];
    } | null;
  }>;
};

const UPCOMING_MATCH_STALE_WINDOW_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class BroadcastService {
  private readonly logger = new Logger('BroadcastService');
  private readonly matchSelect: Prisma.MatchSelect = {
    id: true,
    tournamentId: true,
    sessionId: true,
    stageId: true,
    groupId: true,
    organizationId: true,
    name: true,
    matchNumber: true,
    map: true,
    status: true,
    liveState: true,
    liveAt: true,
    startedAt: true,
    endedAt: true,
    updatedAt: true,
    scheduledAt: true,
    stage: { select: { name: true } },
    group: { select: { name: true } },
    tournament: {
      select: {
        id: true,
        name: true,
        status: true,
        liveState: true,
        shortName: true,
        logoUrl: true,
        bannerUrl: true,
      },
    },
    session: {
      select: {
        id: true,
        name: true,
        status: true,
        logoUrl: true,
        bannerUrl: true,
      },
    },
    organization: { select: { id: true, name: true, broadcastKey: true } },
    matchTeams: {
      where: { deletedAt: null },
      orderBy: [{ slot: 'asc' }, { createdAt: 'asc' }],
      select: {
        slot: true,
        tournamentTeam: { select: { seed: true } },
        team: {
          select: {
            id: true,
            name: true,
            tag: true,
            logoUrl: true,
            players: {
              where: { deletedAt: null, isActive: true },
              orderBy: [{ createdAt: 'asc' }],
              select: {
                id: true,
                ign: true,
                realName: true,
                role: true,
                photoUrl: true,
              },
            },
          },
        },
      },
    },
    matchSlots: {
      where: { deletedAt: null },
      orderBy: [{ slotNumber: 'asc' }],
      select: {
        slotNumber: true,
        team: {
          select: {
            id: true,
            name: true,
            tag: true,
            logoUrl: true,
            players: {
              where: { deletedAt: null, isActive: true },
              orderBy: [{ createdAt: 'asc' }],
              select: {
                id: true,
                ign: true,
                realName: true,
                role: true,
                photoUrl: true,
              },
            },
          },
        },
      },
    },
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: WidgetBroadcastGateway,
    private readonly branding: OrganizationBrandingService,
    @Inject(forwardRef(() => CanonicalControlReadService))
    private readonly canonicalRead: CanonicalControlReadService,
  ) {}

  private mapPlayers(players: PlayerRow[]): BroadcastPlayerDto[] {
    return players.map((p) => ({
      id: p.id,
      name: p.realName ?? p.ign,
      handle: p.ign,
      role: p.role,
      avatarUrl: normalizePublicAssetUrl(p.photoUrl),
    }));
  }

  private mapTeams(
    match?: Pick<MatchWithRelations, 'matchTeams' | 'matchSlots'>,
  ): BroadcastTeamDto[] {
    if (!match) return [];

    const teams = new Map<string, BroadcastTeamDto>();
    const upsert = (
      team:
        | {
            id: string;
            name: string;
            tag: string | null;
            logoUrl: string | null;
            players: PlayerRow[];
          }
        | null
        | undefined,
      slot: number | null,
      seed?: number | null,
    ) => {
      if (!team) return;
      const existing = teams.get(team.id);
      const players = this.mapPlayers(team.players ?? []);
      if (!existing) {
        teams.set(team.id, {
          id: team.id,
          name: team.name,
          tag: team.tag ?? null,
          logoUrl: normalizePublicAssetUrl(team.logoUrl),
          seed: seed ?? null,
          slot: slot ?? null,
          players,
        });
        return;
      }
      if (existing.slot === undefined || existing.slot === null) {
        existing.slot = slot ?? null;
      }
      if (existing.seed === undefined || existing.seed === null) {
        existing.seed = seed ?? existing.seed ?? null;
      }
      if (!existing.players?.length && players.length) {
        existing.players = players;
      }
    };

    (match.matchSlots ?? []).forEach((row) =>
      upsert(row.team, row.slotNumber ?? null, null),
    );
    (match.matchTeams ?? []).forEach((row) =>
      upsert(row.team, row.slot ?? null, row.tournamentTeam?.seed ?? null),
    );

    return Array.from(teams.values()).sort((a, b) => {
      const aSlot = a.slot ?? Number.POSITIVE_INFINITY;
      const bSlot = b.slot ?? Number.POSITIVE_INFINITY;
      if (aSlot === bSlot) return a.name.localeCompare(b.name ?? '');
      return aSlot - bSlot;
    });
  }

  private mapMatch(match: MatchWithRelations | null): BroadcastMatchDto | null {
    if (!match) return null;
    const start = match.scheduledAt ?? match.liveAt ?? match.startedAt ?? null;
    return {
      id: match.id,
      tournamentId: match.tournamentId,
      sessionId: match.sessionId,
      name: match.name ?? null,
      number: match.matchNumber ?? null,
      map: match.map ?? null,
      status: match.status,
      liveState: match.liveState ?? null,
      stage: match.stage?.name ?? null,
      group: match.group?.name ?? null,
      startTime: start ? new Date(start).toISOString() : null,
    };
  }

  private mapTournament(
    t: MatchWithRelations['tournament'] | null,
  ): BroadcastTournamentDto | null {
    if (!t) return null;
    return {
      id: t.id,
      name: t.name,
      status: t.status ?? null,
      liveState: t.liveState ?? null,
      shortName: t.shortName ?? null,
      logoUrl: normalizePublicAssetUrl(t.logoUrl),
      bannerUrl: normalizePublicAssetUrl(t.bannerUrl),
    };
  }

  private mapSessionAsTournament(
    session: MatchWithRelations['session'] | null,
  ): BroadcastTournamentDto | null {
    if (!session) return null;
    return {
      id: session.id,
      name: session.name,
      status: session.status ?? null,
      liveState: null,
      shortName: null,
      logoUrl: normalizePublicAssetUrl(session.logoUrl),
      bannerUrl: normalizePublicAssetUrl(session.bannerUrl),
    };
  }

  private mapSeries(
    match: MatchWithRelations | null | undefined,
    fallbackTournament?: MatchWithRelations['tournament'] | null,
  ): BroadcastTournamentDto | null {
    return (
      this.mapTournament(match?.tournament ?? fallbackTournament ?? null) ??
      this.mapSessionAsTournament(match?.session ?? null)
    );
  }

  private getSeriesName(match: MatchWithRelations | null | undefined) {
    return match?.tournament?.name ?? match?.session?.name ?? null;
  }

  private getSeriesLogo(match: MatchWithRelations | null | undefined) {
    return normalizePublicAssetUrl(
      match?.tournament?.logoUrl ?? match?.session?.logoUrl ?? null,
    );
  }

  private mapSponsors(
    rows: Array<{
      id: string;
      name: string;
      logoUrl: string | null;
      tier: string | null;
      displayOrder: number | null;
      websiteUrl?: string | null;
      rotationIntervalSeconds?: number | null;
      isActive?: boolean | null;
    }>,
  ): BroadcastSponsorDto[] {
    return rows.map((s) => ({
      id: s.id,
      name: s.name,
      logoUrl: normalizePublicAssetUrl(s.logoUrl),
      tier: s.tier ?? null,
      priority: s.displayOrder ?? null,
      displayOrder: s.displayOrder ?? null,
      websiteUrl: s.websiteUrl ?? null,
      rotationIntervalSeconds: s.rotationIntervalSeconds ?? null,
      isActive: s.isActive ?? true,
    }));
  }

  private async ensureWidgetExists(orgId: string, widgetKey: string) {
    const widget = await this.prisma.widget.findFirst({
      where: {
        organizationId: orgId,
        key: widgetKey,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (!widget) {
      throw new NotFoundException('Widget not found for this broadcast key');
    }
  }

  private async ensureBroadcastKey(orgId: string): Promise<string> {
    const org = await this.prisma.organization.findFirst({
      where: { id: orgId, deletedAt: null },
      select: { id: true, broadcastKey: true },
    });
    if (!org) throw new NotFoundException('Organization not found');
    if (org.broadcastKey && org.broadcastKey.length === 64) {
      return org.broadcastKey;
    }
    const next = generateBroadcastKey();
    const updated = await this.prisma.organization.update({
      where: { id: orgId },
      data: { broadcastKey: next },
      select: { broadcastKey: true },
    });
    return updated.broadcastKey;
  }

  private async findLiveMatch(
    orgId: string,
    preferredTournamentId?: string | null,
    preferredSessionId?: string | null,
  ): Promise<MatchWithRelations | null> {
    await this.detectLiveMatchConflicts(orgId);
    const where: Prisma.MatchWhereInput = {
      organizationId: orgId,
      deletedAt: null,
      status: MatchStatus.LIVE,
      ...(preferredTournamentId ? { tournamentId: preferredTournamentId } : {}),
      ...(preferredSessionId ? { sessionId: preferredSessionId } : {}),
    };
    return (await this.prisma.match.findFirst({
      where,
      orderBy: [
        { liveAt: 'desc' },
        { startedAt: 'desc' },
        { updatedAt: 'desc' },
      ],
      select: this.matchSelect,
    })) as MatchWithRelations | null;
  }

  private async findActiveMatch(
    orgId: string,
    preferredTournamentId?: string | null,
    preferredSessionId?: string | null,
  ): Promise<MatchWithRelations | null> {
    const live = await this.findLiveMatch(
      orgId,
      preferredTournamentId,
      preferredSessionId,
    );
    if (live) return live;

    return this.findUpcomingMatch(
      orgId,
      preferredTournamentId,
      preferredSessionId,
    );
  }

  private async findUpcomingMatch(
    orgId: string,
    preferredTournamentId?: string | null,
    preferredSessionId?: string | null,
  ): Promise<MatchWithRelations | null> {
    const staleCutoff = new Date(Date.now() - UPCOMING_MATCH_STALE_WINDOW_MS);

    return (await this.prisma.match.findFirst({
      where: {
        organizationId: orgId,
        deletedAt: null,
        // Only clean draft/upcoming rows qualify as "next match".
        // Historical rows that were once ended but left in DRAFT should not
        // be surfaced as active/upcoming broadcast context.
        status: MatchStatus.DRAFT,
        liveState: LiveState.UPCOMING,
        endedAt: null,
        matchSlots: {
          some: {
            deletedAt: null,
            teamId: { not: null },
          },
        },
        OR: [
          { scheduledAt: { gte: staleCutoff } },
          {
            scheduledAt: null,
            updatedAt: { gte: staleCutoff },
          },
        ],
        ...(preferredTournamentId
          ? { tournamentId: preferredTournamentId }
          : {}),
        ...(preferredSessionId ? { sessionId: preferredSessionId } : {}),
      },
      orderBy: [
        // earliest upcoming (closest scheduled)
        { scheduledAt: { sort: 'asc', nulls: 'last' } },
        { liveAt: { sort: 'asc', nulls: 'last' } },
        { createdAt: 'asc' },
      ],
      select: this.matchSelect,
    })) as unknown as MatchWithRelations | null;
  }

  private async findLatestMatch(
    orgId: string,
    preferredTournamentId?: string | null,
    preferredSessionId?: string | null,
  ): Promise<MatchWithRelations | null> {
    return (await this.prisma.match.findFirst({
      where: {
        organizationId: orgId,
        deletedAt: null,
        ...(preferredTournamentId
          ? { tournamentId: preferredTournamentId }
          : {}),
        ...(preferredSessionId ? { sessionId: preferredSessionId } : {}),
      },
      orderBy: [
        { liveAt: 'desc' },
        { startedAt: 'desc' },
        { updatedAt: 'desc' },
      ],
      select: this.matchSelect,
    })) as MatchWithRelations | null;
  }

  private async findMatchById(
    matchId: string,
  ): Promise<MatchWithRelations | null> {
    return (await this.prisma.match.findFirst({
      where: { id: matchId, deletedAt: null },
      select: this.matchSelect,
    })) as MatchWithRelations | null;
  }

  private async findTournament(
    orgId: string,
    preferredId?: string | null,
  ): Promise<{
    id: string;
    name: string;
    status: string | null;
    liveState: LiveState | null;
    shortName: string | null;
    logoUrl: string | null;
    bannerUrl: string | null;
  } | null> {
    if (preferredId) {
      const direct = await this.prisma.tournament.findFirst({
        where: { id: preferredId, deletedAt: null },
        select: {
          id: true,
          name: true,
          status: true,
          liveState: true,
          shortName: true,
          logoUrl: true,
          bannerUrl: true,
        },
      });
      if (direct) return direct;
    }

    const live = await this.prisma.tournament.findFirst({
      where: {
        organizationId: orgId,
        deletedAt: null,
        liveState: LiveState.LIVE,
      },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        name: true,
        status: true,
        liveState: true,
        shortName: true,
        logoUrl: true,
        bannerUrl: true,
      },
    });
    if (live) return live;

    return this.prisma.tournament.findFirst({
      where: { organizationId: orgId, deletedAt: null },
      orderBy: [{ updatedAt: 'desc' }],
      select: {
        id: true,
        name: true,
        status: true,
        liveState: true,
        shortName: true,
        logoUrl: true,
        bannerUrl: true,
      },
    });
  }

  private async fetchSponsors(
    tournamentId: string | null,
    orgId: string,
    sessionId?: string | null,
  ): Promise<
    Array<{
      id: string;
      name: string;
      logoUrl: string | null;
      tier: string | null;
      displayOrder: number | null;
      websiteUrl?: string | null;
      rotationIntervalSeconds?: number | null;
      isActive?: boolean | null;
    }>
  > {
    if (sessionId) {
      return this.prisma.sessionSponsor.findMany({
        where: {
          sessionId,
          organizationId: orgId,
          isActive: true,
          deletedAt: null,
          session: { organizationId: orgId, deletedAt: null },
        },
        orderBy: [
          { tier: 'asc' },
          { displayOrder: 'asc' },
          { createdAt: 'asc' },
        ],
        select: {
          id: true,
          name: true,
          logoUrl: true,
          tier: true,
          displayOrder: true,
          websiteUrl: true,
          rotationIntervalSeconds: true,
          isActive: true,
        },
      });
    }

    if (!tournamentId) return [];
    return this.prisma.tournamentSponsor.findMany({
      where: {
        tournamentId,
        isActive: true,
        deletedAt: null,
        tournament: { organizationId: orgId, deletedAt: null },
      },
      orderBy: [{ tier: 'asc' }, { displayOrder: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        name: true,
        logoUrl: true,
        tier: true,
        displayOrder: true,
        websiteUrl: true,
        rotationIntervalSeconds: true,
        isActive: true,
      },
    });
  }

  async getBranding(
    organizationId: string,
    context?: { matchId?: string | null; sessionId?: string | null },
  ): Promise<Record<string, unknown> | null> {
    try {
      if (context?.matchId || context?.sessionId) {
        return await this.branding.getEffectiveBranding({
          organizationId,
          matchId: context.matchId ?? null,
          sessionId: context.sessionId ?? null,
        });
      }
      return await this.branding.getForOrganization(organizationId);
    } catch {
      return null;
    }
  }

  async resolveOrganizationByBroadcastKey(broadcastKey: string) {
    const organization = await this.prisma.organization.findUnique({
      where: { broadcastKey },
      select: { id: true, name: true, broadcastKey: true },
    });
    if (!organization) {
      throw new NotFoundException('Broadcast key not found');
    }
    return {
      organizationId: organization.id,
      organization,
    };
  }

  async findLiveMatchForBroadcastOrg(organizationId: string) {
    await this.detectLiveMatchConflicts(organizationId);
    const liveMatches = await this.prisma.match.findMany({
      where: {
        organizationId,
        deletedAt: null,
        status: MatchStatus.LIVE,
      },
      include: {
        group: true,
        stage: true,
        tournament: {
          include: {
            sponsors: {
              where: { isActive: true },
              orderBy: [
                { tier: 'asc' },
                { displayOrder: 'asc' },
                { createdAt: 'asc' },
              ],
            },
          },
        },
        session: {
          include: {
            sponsors: {
              where: { isActive: true },
              orderBy: [
                { tier: 'asc' },
                { displayOrder: 'asc' },
                { createdAt: 'asc' },
              ],
            },
          },
        },
      },
      orderBy: [
        { liveAt: 'desc' },
        { startedAt: 'desc' },
        { updatedAt: 'desc' },
      ],
    });
    const liveMatch = liveMatches[0] ?? null;
    const logKey = `org:${organizationId}`;
    const prev = this.liveStateLog.get(logKey) ?? null;
    if (prev !== (liveMatch?.id ?? null)) {
      this.liveStateLog.set(logKey, liveMatch?.id ?? null);
      this.logger.log(
        `[Broadcast] live match for org=${organizationId}: ${liveMatch?.id ?? 'none'}`,
      );
    }
    if (!liveMatch) {
      throw new NotFoundException('No LIVE match found for broadcast key');
    }
    return liveMatch as unknown as MatchWithRelations;
  }

  private async detectLiveMatchConflicts(organizationId: string) {
    const resolved = await detectOrganizationLiveMatchConflicts(
      this.prisma,
      organizationId,
    );
    if (resolved.wouldEndIds.length > 0) {
      this.logger.warn(
        `[Broadcast] LIVE conflict detected org=${organizationId} preferred=${resolved.keptId ?? 'none'} live=${resolved.liveIds.join(',')} blockedAutoEnd=${resolved.wouldEndIds.join(',')}`,
      );
    }
  }

  async getLiveMatchSummaryForOrganizationSlug(organizationSlug: string) {
    const organization = await this.prisma.organization.findFirst({
      where: {
        slug: organizationSlug,
        deletedAt: null,
      },
      select: {
        id: true,
      },
    });

    if (!organization) {
      throw new NotFoundException('Organization not found');
    }

    const liveMatch = await this.findLiveMatchForBroadcastOrg(organization.id);

    return {
      id: liveMatch.id,
      matchId: liveMatch.id,
      tournamentId: liveMatch.tournamentId ?? null,
      sessionId: liveMatch.sessionId ?? null,
      stageId: liveMatch.stageId ?? null,
      groupId: liveMatch.groupId ?? null,
      status: liveMatch.status,
      liveState: liveMatch.liveState ?? null,
      matchNumber: liveMatch.matchNumber ?? liveMatch.name ?? null,
      matchName: liveMatch.name ?? null,
      map: liveMatch.map ?? null,
      tournamentName: this.getSeriesName(liveMatch),
      tournamentLogo: this.getSeriesLogo(liveMatch),
      stageName: liveMatch.stage?.name ?? liveMatch.group?.name ?? null,
      startsAt:
        liveMatch.scheduledAt?.toISOString?.() ??
        liveMatch.liveAt?.toISOString?.() ??
        liveMatch.startedAt?.toISOString?.() ??
        liveMatch.updatedAt?.toISOString?.() ??
        null,
      endedAt:
        (liveMatch as { endedAt?: Date | null }).endedAt?.toISOString?.() ??
        null,
    };
  }

  async getActiveMatchSummaryForOrganizationSlug(organizationSlug: string) {
    const organization = await this.prisma.organization.findFirst({
      where: {
        slug: organizationSlug,
        deletedAt: null,
      },
      select: {
        id: true,
      },
    });

    if (!organization) {
      throw new NotFoundException('Organization not found');
    }

    const match = await this.findActiveMatch(organization.id);

    if (!match) {
      return null;
    }

    const sponsors = await this.fetchSponsors(
      match.tournamentId ?? null,
      organization.id,
      match.sessionId ?? null,
    );

    return {
      id: match.id,
      matchId: match.id,
      tournamentId: match.tournamentId ?? null,
      sessionId: match.sessionId ?? null,
      stageId: match.stageId ?? null,
      groupId: match.groupId ?? null,
      status: match.status,
      liveState: match.liveState ?? null,
      matchNumber: match.matchNumber ?? match.name ?? null,
      matchName: match.name ?? null,
      map: match.map ?? null,
      tournamentName: this.getSeriesName(match),
      tournamentLogo: this.getSeriesLogo(match),
      sponsors: this.mapSponsors(sponsors),
      stageName: match.stage?.name ?? match.group?.name ?? null,
      startsAt:
        match.scheduledAt?.toISOString?.() ??
        match.liveAt?.toISOString?.() ??
        match.startedAt?.toISOString?.() ??
        match.updatedAt?.toISOString?.() ??
        null,
      endedAt:
        (match as { endedAt?: Date | null }).endedAt?.toISOString?.() ?? null,
    };
  }

  async getMatchSummaryForOrganizationSlug(
    organizationSlug: string,
    matchId: string,
  ) {
    const organization = await this.prisma.organization.findFirst({
      where: {
        slug: organizationSlug,
        deletedAt: null,
      },
      select: {
        id: true,
      },
    });

    if (!organization) {
      throw new NotFoundException('Organization not found');
    }

    const match = await this.findMatchById(matchId);

    if (!match || match.organizationId !== organization.id) {
      throw new NotFoundException('Match not found for organization');
    }

    const sponsors = await this.fetchSponsors(
      match.tournamentId ?? null,
      organization.id,
      match.sessionId ?? null,
    );

    return {
      id: match.id,
      matchId: match.id,
      tournamentId: match.tournamentId ?? null,
      sessionId: match.sessionId ?? null,
      stageId: match.stageId ?? null,
      groupId: match.groupId ?? null,
      status: match.status,
      liveState: match.liveState ?? null,
      matchNumber: match.matchNumber ?? match.name ?? null,
      matchName: match.name ?? null,
      map: match.map ?? null,
      tournamentName: this.getSeriesName(match),
      tournamentLogo: this.getSeriesLogo(match),
      sponsors: this.mapSponsors(sponsors),
      stageName: match.stage?.name ?? match.group?.name ?? null,
      startsAt:
        match.scheduledAt?.toISOString?.() ??
        match.liveAt?.toISOString?.() ??
        match.startedAt?.toISOString?.() ??
        match.updatedAt?.toISOString?.() ??
        null,
      endedAt:
        (match as { endedAt?: Date | null }).endedAt?.toISOString?.() ?? null,
    };
  }

  async getLatestFinishedMatchSummaryForOrganizationSlug(
    organizationSlug: string,
  ) {
    const organization = await this.prisma.organization.findFirst({
      where: {
        slug: organizationSlug,
        deletedAt: null,
      },
      select: {
        id: true,
      },
    });

    if (!organization) {
      throw new NotFoundException('Organization not found');
    }

    const match = (await this.prisma.match.findFirst({
      where: {
        organizationId: organization.id,
        deletedAt: null,
        status: { in: MATCH_FINISHED_STATUSES },
      },
      orderBy: [
        { endedAt: { sort: 'desc', nulls: 'last' } },
        { updatedAt: 'desc' },
        { startedAt: 'desc' },
      ],
      select: this.matchSelect,
    })) as MatchWithRelations | null;

    if (!match) {
      throw new NotFoundException('No finished match found for organization');
    }

    const sponsors = await this.fetchSponsors(
      match.tournamentId ?? null,
      organization.id,
      match.sessionId ?? null,
    );

    return {
      id: match.id,
      matchId: match.id,
      tournamentId: match.tournamentId ?? null,
      sessionId: match.sessionId ?? null,
      stageId: match.stageId ?? null,
      groupId: match.groupId ?? null,
      status: match.status,
      liveState: match.liveState ?? null,
      matchNumber: match.matchNumber ?? match.name ?? null,
      matchName: match.name ?? null,
      map: match.map ?? null,
      tournamentName: this.getSeriesName(match),
      tournamentLogo: this.getSeriesLogo(match),
      sponsors: this.mapSponsors(sponsors),
      stageName: match.stage?.name ?? match.group?.name ?? null,
      startsAt:
        match.scheduledAt?.toISOString?.() ??
        match.liveAt?.toISOString?.() ??
        match.startedAt?.toISOString?.() ??
        match.updatedAt?.toISOString?.() ??
        null,
      endedAt:
        (match as { endedAt?: Date | null }).endedAt?.toISOString?.() ?? null,
    };
  }

  async getNextMatchSummaryForOrganizationSlug(organizationSlug: string) {
    const organization = await this.prisma.organization.findFirst({
      where: {
        slug: organizationSlug,
        deletedAt: null,
      },
      select: {
        id: true,
      },
    });

    if (!organization) {
      throw new NotFoundException('Organization not found');
    }

    const match = await this.findUpcomingMatch(organization.id);

    if (!match) {
      throw new NotFoundException('No upcoming match found for organization');
    }

    const sponsors = await this.fetchSponsors(
      match.tournamentId ?? null,
      organization.id,
      match.sessionId ?? null,
    );

    return {
      id: match.id,
      matchId: match.id,
      tournamentId: match.tournamentId ?? null,
      sessionId: match.sessionId ?? null,
      stageId: match.stageId ?? null,
      groupId: match.groupId ?? null,
      status: match.status,
      liveState: match.liveState ?? null,
      matchNumber: match.matchNumber ?? match.name ?? null,
      matchName: match.name ?? null,
      map: match.map ?? null,
      tournamentName: this.getSeriesName(match),
      tournamentLogo: this.getSeriesLogo(match),
      sponsors: this.mapSponsors(sponsors),
      stageName: match.stage?.name ?? match.group?.name ?? null,
      startsAt:
        match.scheduledAt?.toISOString?.() ??
        match.liveAt?.toISOString?.() ??
        match.startedAt?.toISOString?.() ??
        match.updatedAt?.toISOString?.() ??
        null,
      endedAt:
        (match as { endedAt?: Date | null }).endedAt?.toISOString?.() ?? null,
    };
  }

  async getWidgetContextForOrganizationSlug(organizationSlug: string) {
    const organization = await this.prisma.organization.findFirst({
      where: {
        slug: organizationSlug,
        deletedAt: null,
      },
      select: {
        id: true,
        slug: true,
      },
    });

    if (!organization) {
      throw new NotFoundException('Organization not found');
    }

    const liveMatch = await this.findLiveMatchForBroadcastOrg(
      organization.id,
    ).catch(() => null);
    const branding = await this.getBranding(organization.id, {
      matchId: liveMatch?.id ?? null,
      sessionId: liveMatch?.sessionId ?? null,
    });

    return {
      organizationId: organization.id,
      organizationSlug: organization.slug,
      branding,
      matchId: liveMatch?.id ?? null,
      liveMatchId: liveMatch?.id ?? null,
      sessionId: liveMatch?.sessionId ?? null,
      liveState: liveMatch?.liveState ?? null,
      status: liveMatch?.status ?? null,
    };
  }

  async resolveActiveMatchForBroadcastKey(broadcastKey: string) {
    const organization = await this.prisma.organization.findFirst({
      where: { broadcastKey, deletedAt: null },
      select: { id: true },
    });
    if (!organization) {
      throw new NotFoundException('Broadcast key not found');
    }

    const match = await this.findActiveMatch(organization.id);
    if (!match) {
      return null;
    }

    const branding = await this.getBranding(organization.id, {
      matchId: match.id,
      sessionId: match.sessionId,
    });
    const sponsors = await this.fetchSponsors(
      match?.tournamentId ?? null,
      organization.id,
      match?.sessionId ?? null,
    );

    return {
      organizationId: organization.id,
      matchId: match?.id ?? null,
      groupId: match?.groupId ?? null,
      tournamentId: match?.tournamentId ?? null,
      tournamentName: this.getSeriesName(match),
      tournamentLogo: this.getSeriesLogo(match),
      stageName: match?.stage?.name ?? null,
      groupName: match?.group?.name ?? null,
      matchNumber: match?.matchNumber ?? null,
      matchName: match?.name ?? null,
      map: match?.map ?? null,
      startsAt: match?.scheduledAt ?? match?.liveAt ?? match?.startedAt ?? null,
      status: match?.status ?? null,
      liveState: match?.liveState ?? null,
      branding,
      sponsors: this.mapSponsors(sponsors),
    };
  }

  async fetchSnapshot(
    broadcastKey: string,
    widgetKey: string,
  ): Promise<BroadcastPayload> {
    const organization = await this.prisma.organization.findFirst({
      where: { broadcastKey, deletedAt: null },
      select: { id: true, broadcastKey: true },
    });
    if (!organization) {
      throw new NotFoundException('Broadcast key not found');
    }

    await this.ensureWidgetExists(organization.id, widgetKey);

    const match =
      (await this.findLiveMatch(organization.id)) ??
      (await this.findLatestMatch(organization.id));
    const tournament = match
      ? match.tournament
      : await this.findTournament(organization.id, null);
    const sponsors = await this.fetchSponsors(
      tournament?.id ?? null,
      organization.id,
      match?.sessionId ?? null,
    );
    const branding = await this.getBranding(organization.id, {
      matchId: match?.id ?? null,
      sessionId: match?.sessionId ?? null,
    });

    return {
      widgetKey,
      tournament: this.mapSeries(match, tournament),
      match: this.mapMatch(match),
      teams: this.mapTeams(match ?? undefined),
      sponsors: this.mapSponsors(sponsors),
      timestamp: new Date().toISOString(),
      branding,
    };
  }

  private liveLogCache = new Map<
    string,
    { matchId: string | null; ts: number }
  >();
  private liveStateLog = new Map<string, string | null>();

  async fetchLiveRanking(broadcastKey: string, debug = false) {
    const organization = await this.prisma.organization.findFirst({
      where: { broadcastKey, deletedAt: null },
      select: { id: true, broadcastKey: true },
    });
    if (!organization) {
      throw new NotFoundException('Broadcast key not found');
    }
    const shouldLogOrg = !this.liveLogCache.has(broadcastKey);
    if (shouldLogOrg) {
      this.liveLogCache.set(broadcastKey, { matchId: null, ts: Date.now() });
    }

    let branding = await this.getBranding(organization.id);

    let liveMatch: MatchWithRelations | null = null;
    try {
      liveMatch = await this.findLiveMatch(organization.id);
    } catch (err) {
      if (err instanceof NotFoundException) {
        return {
          matchId: null,
          updatedAt: new Date().toISOString(),
          teams: [],
          branding,
        };
      }
      throw err;
    }
    if (!liveMatch) {
      return {
        matchId: null,
        updatedAt: new Date().toISOString(),
        teams: [],
        branding,
        ...(debug
          ? {
              debug: await this.fetchGlobalLiveDebug(),
            }
          : {}),
      };
    }

    branding = await this.getBranding(organization.id, {
      matchId: liveMatch.id,
      sessionId: liveMatch.sessionId,
    });

    const cache = this.liveLogCache.get(broadcastKey);
    const shouldLogMatch = !cache || cache.matchId !== liveMatch.id;
    if (shouldLogMatch) {
      this.liveLogCache.set(broadcastKey, {
        matchId: liveMatch.id,
        ts: Date.now(),
      });
    }

    const brandMode: BrandMode =
      (
        branding as { textPrimary?: string } | null
      )?.textPrimary?.toLowerCase() === '#ffffff'
        ? 'dark'
        : 'light';

    const snapshot = await buildWidgetScoreboardSnapshot(
      this.prisma,
      liveMatch.id,
      {
        includeLogos: true,
        brandMode,
      },
    );

    const canonicalLiveState = await this.canonicalRead
      .getMatchState(liveMatch.id)
      .catch(() => null);
    const aliveLookup = (canonicalLiveState?.teams ?? []).reduce(
      (acc, team) => {
        if (team.teamId) {
          acc[team.teamId] = Math.max(0, team.alivePlayers ?? 0);
        }
        return acc;
      },
      {} as Record<string, number>,
    );

    const teams =
      snapshot.rows
        ?.filter((row) => row.wasPresentInMatch === true)
        .map((row) => {
          const teamId = row.teamId ?? `slot-${row.slot}`;
          const kills = Number(row.totalKills ?? 0);
          const placementPoints = Number(row.placementPoints ?? 0);
          const matchPoints =
            row.totalPoints ??
            (Number.isFinite(placementPoints) ? placementPoints : 0) +
              (Number.isFinite(kills) ? kills : 0);
          const aliveCount = aliveLookup[teamId] ?? null;
          return {
            teamId,
            teamName: row.teamName ?? row.teamTag ?? DEFAULT_WIDGET_TEAM_NAME,
            teamLogo: row.teamLogoUrl ?? TEAM_LOGO_PLACEHOLDER,
            kills,
            placement: row.placement ?? null,
            placementPoints,
            matchPoints,
            alive: aliveCount === null ? false : aliveCount > 0,
          };
        }) ?? [];

    const updatedAt =
      snapshot.state.lastUpdateIso ??
      liveMatch.updatedAt?.toISOString?.() ??
      new Date().toISOString();

    return {
      matchId: liveMatch.id,
      updatedAt,
      teams,
      branding,
      ...(debug
        ? {
            debug: {
              orgId: organization.id,
              matchOrgId: liveMatch.organizationId,
              keyPrefix: broadcastKey.slice(0, 6),
              globalLive: await this.fetchGlobalLiveDebug(),
            },
          }
        : {}),
    };
  }

  async resolveLiveStateForBroadcastKey(
    broadcastKey: string,
  ): Promise<MatchLiveStatePayload> {
    const organization = await this.prisma.organization.findFirst({
      where: { broadcastKey, deletedAt: null },
      select: { id: true },
    });
    if (!organization) {
      throw new NotFoundException('Broadcast key not found');
    }

    const liveMatch = await this.canonicalRead.resolveLiveMatchForOrg(
      organization.id,
    );
    if (!liveMatch) {
      this.logLiveStateChange(broadcastKey, null);
      return {
        matchId: null,
        tournamentId: null,
        groupId: null,
        teams: [],
      };
    }

    const payload = await this.canonicalRead.getMatchState(liveMatch.id);
    const state: MatchLiveStatePayload = {
      matchId: payload.matchId ?? liveMatch.id,
      tournamentId: liveMatch.tournamentId ?? payload.tournamentId ?? null,
      groupId: liveMatch.groupId ?? payload.groupId ?? null,
      teams: payload.teams,
    };
    this.logLiveStateChange(broadcastKey, state.matchId);
    return state;
  }

  private logLiveStateChange(key: string, matchId: string | null) {
    const previous = this.liveStateLog.get(key);
    if (previous === matchId) return;
    this.liveStateLog.set(key, matchId ?? null);
    this.logger.log(
      `[Broadcast] live-state match=${matchId ?? 'none'} key=${key}`,
    );
  }

  private async fetchGlobalLiveDebug() {
    const anyLive = await this.prisma.match.findFirst({
      where: { status: MatchStatus.LIVE, deletedAt: null },
      select: { id: true, organizationId: true },
    });
    return anyLive ?? null;
  }

  async emitForMatch(
    matchId: string,
    widgetKey = 'broadcast',
  ): Promise<BroadcastPayload | null> {
    const match = await this.findMatchById(matchId);
    if (!match) return null;
    const orgKey =
      match.organization?.broadcastKey ??
      (await this.ensureBroadcastKey(match.organizationId));
    const sponsors = await this.fetchSponsors(
      match.tournamentId,
      match.organizationId,
      match.sessionId,
    );
    const branding = await this.getBranding(match.organizationId, {
      matchId: match.id,
      sessionId: match.sessionId,
    });

    const payload: BroadcastPayload = {
      widgetKey,
      tournament: this.mapSeries(match),
      match: this.mapMatch(match),
      teams: this.mapTeams(match),
      sponsors: this.mapSponsors(sponsors),
      timestamp: new Date().toISOString(),
      branding,
    };

    this.gateway.emitToBroadcast(orgKey, payload);
    return payload;
  }

  async emitForOrganization(
    organizationId: string,
    widgetKey = 'broadcast',
    options?: {
      matchId?: string | null;
      tournamentId?: string | null;
      sessionId?: string | null;
    },
  ): Promise<BroadcastPayload | null> {
    const match =
      (options?.matchId
        ? await this.findMatchById(options.matchId)
        : await this.findLiveMatch(
            organizationId,
            options?.tournamentId,
            options?.sessionId,
          )) ??
      (await this.findLatestMatch(
        organizationId,
        options?.tournamentId,
        options?.sessionId,
      ));

    const tournament = match
      ? match.tournament
      : await this.findTournament(
          organizationId,
          options?.tournamentId ?? null,
        );

    const sponsors = await this.fetchSponsors(
      tournament?.id ?? null,
      organizationId,
      match?.sessionId ?? options?.sessionId ?? null,
    );
    const branding = await this.getBranding(organizationId, {
      matchId: match?.id ?? null,
      sessionId: match?.sessionId ?? options?.sessionId ?? null,
    });
    const payload: BroadcastPayload = {
      widgetKey,
      tournament: this.mapSeries(match, tournament),
      match: this.mapMatch(match ?? null),
      teams: this.mapTeams(match ?? undefined),
      sponsors: this.mapSponsors(sponsors),
      timestamp: new Date().toISOString(),
      branding,
    };

    const broadcastKey =
      match?.organization?.broadcastKey ??
      (await this.ensureBroadcastKey(organizationId));
    this.gateway.emitToBroadcast(broadcastKey, payload);
    return payload;
  }

  async emitMatchLowerThirdShow(
    actor: AuthUser | null,
    params?: {
      organizationId?: string | null;
      matchId?: string | null;
      tournamentId?: string | null;
      durationMs?: number | null;
    },
  ): Promise<MatchLowerThirdEventPayload> {
    const match =
      params?.matchId && typeof params.matchId === 'string'
        ? await this.findMatchById(params.matchId)
        : null;

    const orgId =
      params?.organizationId ??
      match?.organizationId ??
      (actor ? effectiveOrganizationId(actor) : null);
    if (!orgId) {
      throw new BadRequestException('organizationId is required');
    }

    await this.ensureWidgetExists(orgId, 'match-lower-third');
    const resolvedMatch =
      match ??
      (await this.findLiveMatch(orgId, params?.tournamentId)) ??
      (await this.findLatestMatch(orgId));

    const tournament =
      resolvedMatch?.tournament ??
      (await this.findTournament(
        orgId,
        params?.tournamentId ?? resolvedMatch?.tournamentId ?? null,
      ));

    const branding = await this.getBranding(orgId, {
      matchId: resolvedMatch?.id ?? null,
      sessionId: resolvedMatch?.sessionId ?? null,
    });
    const payload: MatchLowerThirdEventPayload = {
      widgetKey: 'match-lower-third',
      tournament: this.mapTournament(tournament),
      match: this.mapMatch(resolvedMatch ?? null),
      branding,
      timestamp: new Date().toISOString(),
      durationMs:
        typeof params?.durationMs === 'number' ? params.durationMs : null,
    };

    const broadcastKey = await this.ensureBroadcastKey(orgId);
    this.gateway.emitMatchLowerThirdShow(broadcastKey, payload);
    return payload;
  }

  async emitMatchLowerThirdHide(
    actor: AuthUser | null,
    params?: { organizationId?: string | null; reason?: string | null },
  ) {
    const orgId =
      params?.organizationId ?? (actor ? effectiveOrganizationId(actor) : null);
    if (!orgId) {
      throw new BadRequestException('organizationId is required');
    }
    await this.ensureWidgetExists(orgId, 'match-lower-third');
    const broadcastKey = await this.ensureBroadcastKey(orgId);
    this.gateway.emitMatchLowerThirdHide(broadcastKey, params?.reason ?? null);
    return { ok: true };
  }

  private requireAdmin(actor: AuthUser | null) {
    const role = actor?.actorRole ?? actor?.role ?? null;
    if (role === Role.SUPER_ADMIN || role === Role.ADMIN) return;
    throw new ForbiddenException('Admin role required');
  }

  async getOrgBroadcastKey(
    actor: AuthUser | null,
    organizationId?: string | null,
  ) {
    const orgId =
      organizationId ?? (actor ? effectiveOrganizationId(actor) : null);
    if (!orgId) {
      throw new BadRequestException('organizationId is required');
    }
    const org = await this.prisma.organization.findFirst({
      where: { id: orgId, deletedAt: null },
      select: { id: true, broadcastKey: true },
    });
    if (!org) throw new NotFoundException('Organization not found');
    return org;
  }

  async rotateBroadcastKey(
    actor: AuthUser | null,
    organizationId?: string | null,
  ) {
    this.requireAdmin(actor);
    const orgId =
      organizationId ?? (actor ? effectiveOrganizationId(actor) : null);
    if (!orgId) {
      throw new BadRequestException('organizationId is required');
    }
    let attempts = 0;
    while (attempts < 3) {
      const next = generateBroadcastKey();
      try {
        const updated = await this.prisma.organization.update({
          where: { id: orgId },
          data: { broadcastKey: next },
          select: { id: true, broadcastKey: true },
        });
        return updated;
      } catch (err) {
        const isUnique =
          typeof err === 'object' &&
          err !== null &&
          'code' in err &&
          (err as { code?: string }).code === 'P2002';
        if (isUnique) {
          attempts += 1;
          continue;
        }
        throw err;
      }
    }
    throw new ConflictException(
      'Unable to generate a unique broadcast key after several attempts',
    );
  }
}
