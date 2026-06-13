/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument */
import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { PrismaService } from '../../db/prisma.service';
import { Public } from '../../common/auth/public.decorator';
import { MatchEventType, MatchStatus, type Prisma } from '@prisma/client';
import {
  buildWidgetScoreboardSnapshot,
  type BrandMode,
  resolveTeamLogoUrl,
  resolvePlayerPhotoUrl,
  TEAM_LOGO_PLACEHOLDER,
} from './widgets.snapshot';
import { ResultsInitService } from '../results/results-init.service';
import { ResultsService } from '../results/results.service';
import { StandingsService, type Scope } from '../live/standings.service';
import { StandingsSnapshotsService } from '../live/standings-snapshots.service';
import { LiveService } from '../live/live.service';
import {
  makeWidgetState,
  type WidgetTeamSlotRow,
  type WidgetTeamBrandPreset,
  type WidgetEliminationPayload,
  type WidgetPlayerListPayload,
  type WidgetStageWinnersPayload,
  type WidgetTeamListPayload,
  type WidgetWwcdPayload,
} from './widgets.contract';
import { computeWidgetVersion } from './widgets.version';
import { OrganizationBrandingService } from '../organization-branding/organization-branding.service';
import {
  DEFAULT_ORGANIZATION_BRANDING,
  type OrganizationBrandingDto,
} from '../organization-branding/organization-branding.constants';
import {
  generateThemeColors,
  type ThemeColors,
} from '../organization-branding/theme-colors.util';
import { MatchControlStateStore } from '../match-control/state.store';
import { WidgetsService } from './widgets.service';
import { TopFraggerService } from './top-fragger/top-fragger.service';
import {
  extractMatchResultSummaryTelemetryStats,
  normalizeFallbackSummaryMetric,
} from './match-result-summary.util';
import { normalizePublicAssetUrl } from '../../common/public-asset-url.util';
import { requireMatchOrganization } from '../../common/org/org.util';
import {
  MATCH_ACTIVE_OR_FINISHED_STATUSES,
  MATCH_FINISHED_STATUSES,
} from '../../common/match-status.util';
import { compareRankingRows } from '../../common/ranking-tiebreakers.util';

const DEFAULT_WIDGET_TEAM_NAME = 'Arenzyra';
const DEFAULT_WIDGET_TEAM_TAG = 'AZ';
const MATCH_SCHEDULE_STATUSES: MatchStatus[] = [
  MatchStatus.DRAFT,
  MatchStatus.LIVE,
  MatchStatus.FINISH_PENDING,
  MatchStatus.FINISHED,
  MatchStatus.ENDED,
];
const MATCH_SCHEDULE_ACTIVE_STATUSES: MatchStatus[] = [
  MatchStatus.LIVE,
  MatchStatus.FINISH_PENDING,
];
const DEFAULT_MATCH_SCHEDULE_CUTOFF_HOUR_UTC = 5;
const MATCH_SCHEDULE_RECENT_FINISHED_WINDOW_MS = 12 * 60 * 60 * 1000;

function isUsableTeamLogoUrl(value?: string | null): value is string {
  const normalized = value?.trim();
  return Boolean(normalized && normalized !== TEAM_LOGO_PLACEHOLDER);
}

function pickTeamLogoSource(
  ...candidates: Array<string | null | undefined>
): string {
  return (
    candidates.find((candidate) => isUsableTeamLogoUrl(candidate)) ??
    TEAM_LOGO_PLACEHOLDER
  );
}

function validateMatchId(matchId?: string): string {
  if (!matchId) throw new BadRequestException({ error: 'INVALID_MATCH_ID' });
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(matchId)) {
    throw new BadRequestException({ error: 'INVALID_MATCH_ID' });
  }
  return matchId;
}

function validateTournamentId(tournamentId?: string): string {
  if (!tournamentId)
    throw new BadRequestException({ error: 'INVALID_TOURNAMENT_ID' });
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(tournamentId)) {
    throw new BadRequestException({ error: 'INVALID_TOURNAMENT_ID' });
  }
  return tournamentId;
}

type LiveRankingRow = {
  rank: number;
  slot: number;
  teamId: string;
  teamTag: string;
  teamName: string;
  logoUrl?: string | null;
  teamPrimaryColor?: string | null;
  brandLight?: WidgetTeamBrandPreset | null;
  brandDark?: WidgetTeamBrandPreset | null;
  aliveCount: number;
  knockedCount: number;
  kills: number;
  isEliminated: boolean;
  isLeader: boolean;
};

type LiveRankingResponse = {
  meta: {
    tournamentName?: string | null;
    stageName?: string | null;
    matchLabel?: string | null;
    updatedAt: string;
    branding?: BrandingContext | null;
  };
  rows: LiveRankingRow[];
};

type BooleanLookup = Record<string, boolean>;
type NumberLookup = Record<string, number>;
type StandingsPayload = Awaited<
  ReturnType<StandingsService['computeStandings']>
>;

type MatchResultSummaryStats = {
  totalKills: number | null;
  totalKnocks: number | null;
  totalDamage: number | null;
  totalAssists: number | null;
  grenadeKills: number | null;
  vehicleKills: number | null;
  matchDurationSeconds: number | null;
  totalTeams: number | null;
};

type MatchResultSummaryHighlight = {
  title:
    | 'Most Aggressive Team'
    | 'Deadliest Player'
    | 'Grenade King'
    | 'Road Rage';
  name: string;
  value: number;
  kind: 'team' | 'player' | 'event';
  detail?: string | null;
};

type PostMatchOverallRow = {
  rank: number;
  previousRank: number | null;
  trend: 'UP' | 'DOWN' | 'SAME' | null;
  teamId: string;
  teamTag: string;
  teamName: string | null;
  teamLogoUrl: string | null;
  brandLight?: WidgetTeamBrandPreset | null;
  brandDark?: WidgetTeamBrandPreset | null;
  slot?: number | null;
  matchKills: number;
  matchPoints: number;
  overallKills: number;
  placementPoints: number;
  totalPoints: number;
  totalKills: number;
  matchesPlayed: number;
  wwcd: number;
};

type PostMatchOverallPayload = {
  version: 'v1';
  state: {
    matchId: string;
    tournamentId?: string | null;
    scope: Scope;
    scopeId: string;
    status: string | null;
    lastUpdateIso?: string | null;
    reasons: string[];
    resultFinalized?: boolean | null;
    finalizedAt?: string | null;
  };
  header: {
    tournament?: string | null;
    stage?: string | null;
    group?: string | null;
    matchLabel?: string | null;
    map?: string | null;
  };
  qualification?: {
    source: Scope;
    sourceId: string;
    qualifiedTeamsCount: number;
    qualificationBubbleCount: number | null;
    qualificationLabel: string | null;
  } | null;
  rows: PostMatchOverallRow[];
};

type PostMatchQualificationPayload = NonNullable<
  PostMatchOverallPayload['qualification']
>;

type PostMatchPointsBreakdownRow = {
  rank: number;
  placement: number | null;
  teamId: string;
  teamTag: string | null;
  teamName: string | null;
  teamLogoUrl: string | null;
  brandLight?: WidgetTeamBrandPreset | null;
  brandDark?: WidgetTeamBrandPreset | null;
  slot?: number | null;
  kills: number;
  placementPoints: number;
  killPoints: number;
  adjustmentPoints: number;
  totalPoints: number;
};

type PostMatchPointsBreakdownPayload = {
  version: 'v1';
  state: {
    matchId: string;
    tournamentId?: string | null;
    status: string | null;
    lastUpdateIso?: string | null;
    reasons: string[];
    resultFinalized?: boolean | null;
    finalizedAt?: string | null;
  };
  header: {
    tournament?: string | null;
    stage?: string | null;
    group?: string | null;
    matchLabel?: string | null;
    map?: string | null;
  };
  summary: {
    teams: number;
    placementPointsTotal: number;
    killPointsTotal: number;
    adjustmentPointsTotal: number;
    totalPointsTotal: number;
  };
  rows: PostMatchPointsBreakdownRow[];
};

type MatchScheduleResultRow = {
  matchId: string;
  matchLabel: string | null;
  matchNumber: number | null;
  map: string | null;
  scheduledAt: string | null;
  startedAt: string | null;
  endedAt: string | null;
  status: string | null;
  winnerTeamId: string | null;
  winnerTeamName: string | null;
  winnerTeamTag: string | null;
  winnerTeamLogoUrl: string | null;
  winnerKills: number;
  winnerTotalPoints: number;
};

type MatchScheduleResultsPayload = {
  version: 'v1';
  state: {
    organizationSlug: string | null;
    organizationId: string | null;
    anchorMatchId: string | null;
    tournamentId?: string | null;
    scope: Scope | 'MATCH';
    scopeId: string;
    status: string | null;
    lastUpdateIso: string;
    reasons: string[];
  };
  header: {
    tournament?: string | null;
    stage?: string | null;
    group?: string | null;
    matchLabel?: string | null;
  };
  rows: MatchScheduleResultRow[];
};

type BrandingContext = {
  branding: OrganizationBrandingDto;
  theme: ThemeColors;
  mode: BrandMode;
};

const isStandingsPayload = (value: unknown): value is StandingsPayload => {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<StandingsPayload>;
  if (!Array.isArray(candidate.rows)) return false;
  if (
    candidate.computedAt !== undefined &&
    typeof candidate.computedAt !== 'string'
  ) {
    return false;
  }
  return candidate.rows.every((row) => {
    if (typeof row !== 'object' || row === null) return false;
    return typeof (row as { teamId?: unknown }).teamId === 'string';
  });
};

const parseStandingsPayload = (raw: string): StandingsPayload | null => {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return isStandingsPayload(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const formatMapLabel = (map?: string | null): string | null => {
  if (!map) return null;
  const cleaned = String(map).replace(/_/g, ' ').trim();
  if (!cleaned.length) return null;
  return cleaned
    .split(/\s+/)
    .map((word) =>
      word.length > 0
        ? word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
        : '',
    )
    .join(' ');
};

const normalizeMatchLabel = (match?: {
  matchNumber?: number | null;
  name?: string | null;
}): string | null => {
  if (!match) return null;
  const name =
    typeof match.name === 'string' && match.name.trim().length
      ? match.name.trim()
      : null;
  const matchNumber =
    typeof match.matchNumber === 'number' && Number.isFinite(match.matchNumber)
      ? match.matchNumber
      : null;

  if (name && matchNumber !== null) {
    const pattern = new RegExp(`\\bmatch\\s*0*${matchNumber}\\b`, 'i');
    if (pattern.test(name)) {
      return name;
    }
  }

  if (matchNumber !== null) {
    const padded = matchNumber.toString().padStart(2, '0');
    return `Match ${padded}`;
  }

  return name;
};

const pickMatchScheduleDate = (match?: {
  scheduledAt?: Date | null;
  startedAt?: Date | null;
  endedAt?: Date | null;
  createdAt?: Date | null;
}): Date | null =>
  match?.scheduledAt ??
  match?.startedAt ??
  match?.endedAt ??
  match?.createdAt ??
  null;

const buildUtcDayRange = (
  value?: Date | null,
): { start: Date; end: Date } | null => {
  if (!value || Number.isNaN(value.getTime())) return null;
  const start = new Date(value);
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end };
};

const parseMatchScheduleDateRange = (
  value?: string | null,
): { start: Date; end: Date } | null => {
  const normalized = value?.trim();
  if (!normalized || !/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return null;
  }

  const [year, month, day] = normalized.split('-').map(Number);
  const start = new Date(Date.UTC(year, month - 1, day));
  if (
    start.getUTCFullYear() !== year ||
    start.getUTCMonth() !== month - 1 ||
    start.getUTCDate() !== day
  ) {
    return null;
  }

  return buildUtcDayRange(start);
};

const parseMatchScheduleCutoffHour = (value?: string | null): number => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 23
    ? parsed
    : DEFAULT_MATCH_SCHEDULE_CUTOFF_HOUR_UTC;
};

const buildCurrentMatchScheduleRange = (
  now: Date,
  cutoffHourUtc: number,
): { start: Date; end: Date } | null => {
  const anchor = new Date(now);
  if (anchor.getUTCHours() < cutoffHourUtc) {
    anchor.setUTCDate(anchor.getUTCDate() - 1);
  }
  return buildUtcDayRange(anchor);
};

type MatchScheduleMode = 'auto' | 'today' | 'upcoming' | 'finished';

const normalizeMatchScheduleMode = (
  value?: string | null,
): MatchScheduleMode => {
  const normalized = value?.trim().toLowerCase();
  if (
    normalized === 'today' ||
    normalized === 'upcoming' ||
    normalized === 'finished'
  ) {
    return normalized;
  }
  return 'auto';
};

const buildMatchScheduleDayWhere = (
  range: { start: Date; end: Date } | null,
): Prisma.MatchWhereInput => {
  if (!range) return {};
  return {
    OR: [
      { scheduledAt: { gte: range.start, lt: range.end } },
      {
        scheduledAt: null,
        startedAt: { gte: range.start, lt: range.end },
      },
      {
        scheduledAt: null,
        startedAt: null,
        endedAt: { gte: range.start, lt: range.end },
      },
      {
        scheduledAt: null,
        startedAt: null,
        endedAt: null,
        createdAt: { gte: range.start, lt: range.end },
      },
    ],
  };
};

const POST_MATCH_STATES = new Set([
  'ENDED',
  'FINISHED',
  'COMPLETED',
  'CONFIRMED',
  'POST_MATCH',
]);

function isPostMatchState(value?: string | null) {
  return POST_MATCH_STATES.has((value ?? '').toString().trim().toUpperCase());
}

function isPostMatchConfirmed(params: {
  aliveTeams?: number | null;
  controlState?: string | null;
  matchStatus?: string | null;
  resultFinalized?: boolean | null;
}) {
  if (params.resultFinalized === true) return true;
  if (isPostMatchState(params.controlState)) return true;
  if (isPostMatchState(params.matchStatus)) return true;
  return params.aliveTeams === 1;
}

const PUBLIC_ASSET_FIELDS = new Set([
  'logo',
  'teamLogo',
  'playerPhoto',
  'photo',
  'avatar',
  'image',
]);

function isPublicAssetField(key: string): boolean {
  return (
    PUBLIC_ASSET_FIELDS.has(key) ||
    /(?:logo|banner|photo|avatar|image).*url$/i.test(key)
  );
}

function normalizeWidgetAssetUrls<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeWidgetAssetUrls(item)) as T;
  }
  if (!value || typeof value !== 'object' || value instanceof Date) {
    return value;
  }

  const normalized: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (isPublicAssetField(key) && typeof entry === 'string') {
      normalized[key] = entry.startsWith('data:')
        ? entry
        : normalizePublicAssetUrl(entry);
      continue;
    }
    normalized[key] = normalizeWidgetAssetUrls(entry);
  }
  return normalized as T;
}

@Controller('widgets')
@Public()
export class WidgetsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly resultsInit: ResultsInitService,
    private readonly resultsService: ResultsService,
    private readonly standings: StandingsService,
    private readonly standingsSnapshots: StandingsSnapshotsService,
    private readonly live: LiveService,
    private readonly branding: OrganizationBrandingService,
    private readonly matchStateStore: MatchControlStateStore,
    private readonly widgetInstances: WidgetsService,
    private readonly topFraggers: TopFraggerService,
  ) {}

  private setNoCache(res: Response) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }

  private wrapWidgetResponse<T extends Record<string, any>>(
    res: Response,
    payload: T,
    meta: {
      updatedAt?: string | null;
      matchId?: string | null;
      tournamentId?: string | null;
      organizationId?: string | null;
      dataSource?: string | null;
      controlState?: string | null;
      aliveTeams?: number | null;
      resultFinalized?: boolean | null;
      finalizedAt?: string | null;
      winnerTeamId?: string | null;
      branding?: BrandingContext | null;
    },
  ) {
    this.setNoCache(res);
    const sanitizedPayload = normalizeWidgetAssetUrls(payload);
    const sanitizedBranding = normalizeWidgetAssetUrls(meta.branding ?? null);
    const version = computeWidgetVersion(sanitizedPayload);
    return {
      meta: {
        version,
        updatedAt: meta.updatedAt ?? new Date().toISOString(),
        matchId: meta.matchId ?? null,
        tournamentId: meta.tournamentId ?? null,
        organizationId:
          meta.organizationId ?? meta.branding?.branding.organizationId ?? null,
        dataSource: meta.dataSource ?? null,
        controlState: meta.controlState ?? null,
        aliveTeams: meta.aliveTeams ?? null,
        resultFinalized: meta.resultFinalized ?? null,
        finalizedAt: meta.finalizedAt ?? null,
        winnerTeamId: meta.winnerTeamId ?? null,
        branding: sanitizedBranding,
      },
      data: sanitizedPayload,
    };
  }

  private ensureMatchFresh(matchId: string): Promise<void> {
    // GET handlers must stay read-only. Result materialization/recalculation
    // happens on explicit write and ingest paths instead.
    void matchId;
    return Promise.resolve();
  }

  private async ensureMatchExists(matchId: string) {
    const exists = await this.prisma.match.findFirst({
      where: { id: matchId, deletedAt: null },
      select: { id: true },
    });
    if (!exists) {
      throw new NotFoundException({ error: 'MATCH_NOT_FOUND' });
    }
  }

  private async resolveMatchOrganizationId(matchId: string): Promise<string> {
    const match = await this.prisma.match.findFirst({
      where: { id: matchId, deletedAt: null },
      select: {
        organizationId: true,
        tournament: { select: { organizationId: true } },
      },
    });
    const organizationId =
      match?.organizationId ?? match?.tournament?.organizationId ?? null;
    if (!organizationId) {
      throw new NotFoundException({ error: 'MATCH_NOT_FOUND' });
    }
    return organizationId;
  }

  private scoreMvpPerformance(opts: {
    kills: number;
    assists: number;
    placement?: number | null;
    isAlive?: boolean | null;
    survivalTime?: number | null;
  }) {
    const placementBonus = opts.placement
      ? Math.max(0, 21 - opts.placement)
      : 0;
    const survivalScore = opts.survivalTime
      ? Math.min(10, Math.round(opts.survivalTime / 180))
      : 0;
    const aliveBonus = opts.isAlive === true ? 2 : 0;
    return (
      opts.kills * 6 +
      opts.assists * 4 +
      placementBonus +
      survivalScore +
      aliveBonus
    );
  }

  private async resolveBrandingForMatch(
    matchId: string,
  ): Promise<BrandingContext> {
    const branding = await this.branding.getEffectiveBranding({
      matchId,
    });
    const normalized = {
      ...DEFAULT_ORGANIZATION_BRANDING,
      ...(branding ?? {}),
    };
    let theme: ThemeColors;
    try {
      theme = generateThemeColors(normalized);
    } catch {
      theme = generateThemeColors(DEFAULT_ORGANIZATION_BRANDING);
    }
    const mode: BrandMode =
      theme.textPrimary?.toLowerCase() === '#ffffff' ? 'dark' : 'light';
    return { branding: normalized, theme, mode };
  }

  @Get('team-list')
  async teamList(
    @Query('matchId') matchId?: string,
    @Res({ passthrough: true }) res?: Response,
  ) {
    const id = validateMatchId(matchId);
    await this.ensureMatchFresh(id);
    const branding = await this.resolveBrandingForMatch(id);
    const brandMode = branding.mode;
    const snapshot = await buildWidgetScoreboardSnapshot(this.prisma, id, {
      includeLogos: true,
      brandMode,
    });

    const rows = (snapshot.rows ?? []).map((r) => ({
      slot: r.slot,
      teamId: r.teamId,
      teamName: r.teamName,
      teamTag: r.teamTag,
      teamLogoUrl: r.teamLogoUrl ?? TEAM_LOGO_PLACEHOLDER,
      teamPrimaryColor: r.teamPrimaryColor ?? null,
      brandLight: r.brandLight ?? null,
      brandDark: r.brandDark ?? null,
      wasPresentInMatch: r.wasPresentInMatch ?? null,
      presenceStatus: r.presenceStatus ?? null,
    }));

    const payload: WidgetTeamListPayload = {
      version: 'v1',
      state: snapshot.state,
      rows,
    };

    return this.wrapWidgetResponse(res!, payload, {
      updatedAt: snapshot.state.lastUpdateIso,
      matchId: snapshot.state.matchId,
      tournamentId: snapshot.state.tournamentId,
      dataSource: snapshot.state.dataSource,
      controlState: snapshot.state.controlState,
      branding,
    });
  }

  @Get('player-list')
  async playerList(
    @Query('matchId') matchId?: string,
    @Res({ passthrough: true }) res?: Response,
  ) {
    const id = validateMatchId(matchId);
    await this.ensureMatchFresh(id);
    const branding = await this.resolveBrandingForMatch(id);
    const organizationId = await this.resolveMatchOrganizationId(id);
    const brandMode = branding.mode;
    const snapshot = await buildWidgetScoreboardSnapshot(this.prisma, id, {
      includeLogos: true,
      brandMode,
    });
    const liveState = await this.matchStateStore.get(id);
    const playerKnockedMap = (liveState?.teams ?? []).reduce<BooleanLookup>(
      (acc, team) => {
        for (const player of team.players ?? []) {
          const keys = [
            player.playerId,
            player.id,
            player.externalPlayerId,
            player.pubgPlayerId,
          ].filter((value): value is string => typeof value === 'string');
          for (const key of keys) {
            acc[key] = player.knocked === true;
          }
        }
        return acc;
      },
      {},
    );
    const slotResults = (await this.resultsService.listSlotResultsPublic(id, {
      organizationId,
    })) as any[];
    const brandLookup = new Map<string, WidgetTeamSlotRow>();
    (snapshot.rows ?? []).forEach((r) => {
      const key = r.teamId ?? `slot-${r.slot}`;
      brandLookup.set(key, r);
    });
    const rows = (slotResults ?? []).map((sr) => {
      const key = sr.team?.id ?? `slot-${sr.slotNumber}`;
      const brandSource = brandLookup.get(key);
      const teamLogoUrl = brandSource?.teamLogoUrl ?? TEAM_LOGO_PLACEHOLDER;

      return {
        slot: sr.slotNumber,
        teamId: sr.team?.id ?? null,
        teamName: sr.team?.name ?? DEFAULT_WIDGET_TEAM_NAME,
        teamTag: sr.team?.tag ?? DEFAULT_WIDGET_TEAM_TAG,
        teamLogoUrl: teamLogoUrl ?? TEAM_LOGO_PLACEHOLDER,
        teamPrimaryColor: brandSource?.teamPrimaryColor ?? null,
        brandLight: brandSource?.brandLight ?? null,
        brandDark: brandSource?.brandDark ?? null,
        wasPresentInMatch: sr.wasPresentInMatch ?? null,
        presenceStatus: sr.presenceStatus ?? null,
        players:
          sr.players?.map((p) => {
            const playerPhoto =
              resolvePlayerPhotoUrl({
                photoUrl: p.photoUrl ?? null,
                photoUpdatedAt:
                  (p as { photoUpdatedAt?: Date | string | number | null })
                    ?.photoUpdatedAt ?? null,
                updatedAt: p.updatedAt ?? null,
              }) ?? null;

            return {
              id: p.id,
              playerId: p.playerId,
              name: p.playerName ?? null,
              ign: p.playerName ?? null,
              photoUrl: playerPhoto,
              playerPhotoUrl: playerPhoto,
              alive: p.isAlive ?? null,
              knocks: p.knocks ?? null,
              assists: (p as { assists?: number | null }).assists ?? null,
              knocked:
                (p.playerId ? playerKnockedMap[p.playerId] : undefined) ??
                (p.knocks ?? 0) > 0,
            };
          }) ?? [],
      };
    });

    const payload: WidgetPlayerListPayload = {
      version: 'v1',
      state: snapshot.state,
      rows,
    };

    return this.wrapWidgetResponse(res!, payload, {
      updatedAt: snapshot.state.lastUpdateIso,
      matchId: snapshot.state.matchId,
      tournamentId: snapshot.state.tournamentId,
      dataSource: snapshot.state.dataSource,
      controlState: snapshot.state.controlState,
      branding,
    });
  }

  @Get('wwcd')
  async wwcd(
    @Query('matchId') matchId?: string,
    @Res({ passthrough: true }) res?: Response,
  ) {
    const id = validateMatchId(matchId);
    await this.ensureMatchFresh(id);
    const branding = await this.resolveBrandingForMatch(id);
    const brandMode = branding.mode;
    const snapshot = await buildWidgetScoreboardSnapshot(this.prisma, id, {
      includeLogos: true,
      brandMode,
    });
    const winnerRow =
      snapshot.rows?.find((r) => r.placement === 1) ??
      snapshot.rows?.find((r) => r.slot === 1) ??
      null;

    const payload: WidgetWwcdPayload = {
      version: 'v1',
      state: snapshot.state,
      winner: winnerRow
        ? {
            slot: winnerRow.slot,
            teamId: winnerRow.teamId,
            teamName: winnerRow.teamName,
            teamTag: winnerRow.teamTag,
            teamLogoUrl: winnerRow.teamLogoUrl ?? TEAM_LOGO_PLACEHOLDER,
            teamPrimaryColor: winnerRow.teamPrimaryColor ?? null,
            brandLight: winnerRow.brandLight ?? null,
            brandDark: winnerRow.brandDark ?? null,
            wasPresentInMatch: winnerRow.wasPresentInMatch ?? null,
            presenceStatus: winnerRow.presenceStatus ?? null,
          }
        : null,
    };

    return this.wrapWidgetResponse(res!, payload, {
      updatedAt: snapshot.state.lastUpdateIso,
      matchId: snapshot.state.matchId,
      tournamentId: snapshot.state.tournamentId,
      dataSource: snapshot.state.dataSource,
      controlState: snapshot.state.controlState,
      branding,
    });
  }

  @Get('elimination')
  async elimination(
    @Query('matchId') matchId?: string,
    @Res({ passthrough: true }) res?: Response,
  ) {
    const id = validateMatchId(matchId);
    await this.ensureMatchExists(id);
    await this.ensureMatchFresh(id);
    const branding = await this.resolveBrandingForMatch(id);
    const brandMode = branding.mode;
    const snapshot = await buildWidgetScoreboardSnapshot(this.prisma, id, {
      includeLogos: false,
      brandMode,
    });
    const stateWithReason = {
      ...snapshot.state,
      reasons: [
        ...(snapshot.state.reasons ?? []),
        'ELIMINATION_DATA_NOT_AVAILABLE',
      ],
    };

    const payload: WidgetEliminationPayload = {
      version: 'v1',
      state: stateWithReason,
      entries: [],
    };

    return this.wrapWidgetResponse(res!, payload, {
      updatedAt: stateWithReason.lastUpdateIso,
      matchId: stateWithReason.matchId,
      tournamentId: stateWithReason.tournamentId,
      dataSource: stateWithReason.dataSource,
      controlState: stateWithReason.controlState,
      branding,
    });
  }

  @Get('stage-winners')
  async stageWinners(
    @Query('stageId') stageId?: string,
    @Res({ passthrough: true }) res?: Response,
  ) {
    if (!stageId) {
      throw new BadRequestException({ error: 'INVALID_STAGE_ID' });
    }
    const stage = await this.prisma.stage.findFirst({
      where: { id: stageId, deletedAt: null },
      select: {
        id: true,
        tournamentId: true,
        updatedAt: true,
      },
    });
    if (!stage) {
      throw new NotFoundException({ error: 'STAGE_NOT_FOUND' });
    }

    const state = makeWidgetState({
      matchId: stage.id,
      tournamentId: stage.tournamentId,
      game: null,
      resultsLocked: false,
      hasSlots: false,
      hasSlotResults: false,
      hasPlayerResults: false,
      lastUpdateIso: stage.updatedAt?.toISOString?.() ?? null,
      reasons: ['STAGE_STANDINGS_NOT_AVAILABLE'],
    });

    const payload: WidgetStageWinnersPayload = {
      version: 'v1',
      state,
      rows: [],
    };

    return this.wrapWidgetResponse(res!, payload, {
      updatedAt: state.lastUpdateIso,
      matchId: state.matchId,
      tournamentId: state.tournamentId,
      dataSource: state.dataSource,
      controlState: state.controlState,
    });
  }

  @Get('match-live-ranking')
  async matchLiveRanking(
    @Query('matchId') matchId?: string,
    @Res({ passthrough: true }) res?: Response,
  ): Promise<LiveRankingResponse> {
    const id = validateMatchId(matchId);
    await this.ensureMatchExists(id);
    await this.ensureMatchFresh(id);
    const organizationId = await this.resolveMatchOrganizationId(id);

    const branding = await this.resolveBrandingForMatch(id);
    const brandMode = branding.mode;
    const [match, snapshot, slotResults, liveState] = await Promise.all([
      this.prisma.match.findFirst({
        where: { id, deletedAt: null },
        select: {
          id: true,
          name: true,
          matchNumber: true,
          updatedAt: true,
          tournament: { select: { name: true, shortName: true } },
          stage: { select: { name: true } },
        },
      }),
      buildWidgetScoreboardSnapshot(this.prisma, id, {
        includeLogos: true,
        brandMode,
      }),
      this.resultsService.listSlotResultsPublic(id, { organizationId }),
      this.matchStateStore.get(id),
    ]);

    if (!match) {
      throw new NotFoundException({ error: 'MATCH_NOT_FOUND' });
    }

    const playerKnocked = (liveState?.teams ?? []).reduce<BooleanLookup>(
      (acc, team) => {
        for (const player of team.players ?? []) {
          const keys = [
            player.playerId,
            player.id,
            player.externalPlayerId,
            player.pubgPlayerId,
          ].filter((value): value is string => typeof value === 'string');
          for (const key of keys) {
            acc[key] = player.knocked === true;
          }
        }
        return acc;
      },
      {},
    );
    const playerAlive = (liveState?.teams ?? []).reduce<BooleanLookup>(
      (acc, team) => {
        for (const player of team.players ?? []) {
          const keys = [
            player.playerId,
            player.id,
            player.externalPlayerId,
            player.pubgPlayerId,
          ].filter((value): value is string => typeof value === 'string');
          for (const key of keys) {
            acc[key] = player.alive === true;
          }
        }
        return acc;
      },
      {},
    );
    const teamAlive = (liveState?.teams ?? []).reduce<NumberLookup>(
      (acc, team) => {
        if (team.teamId) {
          acc[team.teamId] = Math.max(0, team.alivePlayers ?? 0);
        }
        return acc;
      },
      {},
    );
    const slotResultsArr = (slotResults ?? []) as any[];

    const slotMeta = new Map<
      string,
      {
        logoUrl: string;
        teamTag: string | null;
        teamName: string | null;
        teamPrimaryColor?: string | null;
        brandLight?: WidgetTeamBrandPreset | null;
        brandDark?: WidgetTeamBrandPreset | null;
      }
    >();
    for (const r of snapshot.rows ?? []) {
      const key = r.teamId ?? `slot-${r.slot}`;
      slotMeta.set(key, {
        logoUrl: r.teamLogoUrl ?? TEAM_LOGO_PLACEHOLDER,
        teamTag: r.teamTag ?? DEFAULT_WIDGET_TEAM_TAG,
        teamName: r.teamName ?? DEFAULT_WIDGET_TEAM_NAME,
        teamPrimaryColor: r.teamPrimaryColor ?? null,
        brandLight: r.brandLight ?? null,
        brandDark: r.brandDark ?? null,
      });
    }

    const slotAliveMap = new Map<
      string,
      { alive: number; knocked: number; kills: number }
    >();
    for (const sr of slotResultsArr) {
      const key = sr.team?.id ?? `slot-${sr.slotNumber}`;
      const players = sr.players ?? [];
      const aliveFromPlayers = players.reduce(
        (count, p) => {
          const knocked =
            (p.playerId ? playerKnocked[p.playerId] : undefined) ??
            (p.knocks ?? 0) > 0;
          const aliveFlag =
            (p.playerId ? playerAlive[p.playerId] : undefined) ??
            p.isAlive ??
            null;
          if (knocked) count.knocked += 1;
          if (aliveFlag === false || knocked) return count;
          count.alive += 1;
          return count;
        },
        { alive: 0, knocked: 0 },
      );
      const killsFromPlayers = players.reduce(
        (sum, p) => sum + (p.kills ?? 0),
        0,
      );
      slotAliveMap.set(key, {
        alive: aliveFromPlayers.alive,
        knocked: aliveFromPlayers.knocked,
        kills: killsFromPlayers,
      });
    }

    const rows: LiveRankingRow[] = (snapshot.rows ?? []).map((row, idx) => {
      const key = row.teamId ?? `slot-${row.slot}`;
      const aliveFromShadow =
        row.teamId && teamAlive[row.teamId] !== undefined
          ? Number(teamAlive[row.teamId] ?? 0)
          : undefined;
      const aliveFromPlayers = slotAliveMap.get(key)?.alive;
      const knockedFromPlayers = slotAliveMap.get(key)?.knocked ?? 0;
      const aliveCount = Number.isFinite(aliveFromShadow)
        ? Math.max(0, Number(aliveFromShadow))
        : Math.max(0, aliveFromPlayers ?? 0);
      const kills =
        Number.isFinite(row.totalKills) && row.totalKills !== null
          ? Number(row.totalKills)
          : (slotAliveMap.get(key)?.kills ?? 0);
      const meta = slotMeta.get(key);
      return {
        rank: idx + 1,
        slot: row.slot,
        teamId: row.teamId ?? `slot-${row.slot}`,
        teamTag:
          row.teamTag ??
          meta?.teamTag ??
          row.teamName ??
          meta?.teamName ??
          DEFAULT_WIDGET_TEAM_TAG,
        teamName:
          row.teamName ??
          meta?.teamName ??
          row.teamTag ??
          meta?.teamTag ??
          DEFAULT_WIDGET_TEAM_NAME,
        logoUrl: row.teamLogoUrl ?? meta?.logoUrl ?? TEAM_LOGO_PLACEHOLDER,
        teamPrimaryColor:
          row.teamPrimaryColor ?? meta?.teamPrimaryColor ?? null,
        brandLight: row.brandLight ?? meta?.brandLight ?? null,
        brandDark: row.brandDark ?? meta?.brandDark ?? null,
        aliveCount,
        knockedCount: Math.max(0, knockedFromPlayers),
        kills,
        isEliminated: aliveCount <= 0,
        isLeader: idx === 0,
      };
    });

    this.setNoCache(res!);
    const tournamentName =
      match.tournament?.shortName ?? match.tournament?.name ?? null;
    const stageName = match.stage?.name ?? null;
    const matchLabel =
      (match.matchNumber ? `Match ${match.matchNumber}` : null) ??
      match.name ??
      null;
    const updatedAt =
      snapshot.state.lastUpdateIso ??
      match.updatedAt?.toISOString?.() ??
      new Date().toISOString();

    return {
      meta: {
        tournamentName,
        stageName,
        matchLabel,
        updatedAt,
        branding,
      },
      rows,
    };
  }

  @Get('match-result-summary')
  async matchResultSummary(
    @Query('matchId') matchId?: string,
    @Res({ passthrough: true }) res?: Response,
  ) {
    const id = validateMatchId(matchId);
    await this.ensureMatchExists(id);
    await this.ensureMatchFresh(id);
    const organizationId = await this.resolveMatchOrganizationId(id);

    const branding = await this.resolveBrandingForMatch(id);
    const brandMode = branding.mode;
    const [match, snapshot, slotResults, liveState, latestTelemetry] =
      await Promise.all([
        this.prisma.match.findFirst({
          where: { id, deletedAt: null },
          select: {
            id: true,
            name: true,
            matchNumber: true,
            map: true,
            status: true,
            organizationId: true,
            startedAt: true,
            endedAt: true,
            controlState: { select: { state: true } },
            tournament: { select: { id: true, name: true, shortName: true } },
          },
        }),
        buildWidgetScoreboardSnapshot(this.prisma, id, {
          includeLogos: true,
          brandMode,
        }),
        this.resultsService.listSlotResultsPublic(id, { organizationId }),
        this.matchStateStore.get(id),
        this.prisma.matchTelemetry.findUnique({
          where: { matchId: id },
          select: { payload: true },
        }),
      ]);

    if (!match) {
      throw new NotFoundException({ error: 'MATCH_NOT_FOUND' });
    }

    const playerAlive = (liveState?.teams ?? []).reduce<BooleanLookup>(
      (acc, team) => {
        for (const player of team.players ?? []) {
          const keys = [
            player.playerId,
            player.id,
            player.externalPlayerId,
            player.pubgPlayerId,
          ].filter((value): value is string => typeof value === 'string');
          for (const key of keys) {
            acc[key] = player.alive === true;
          }
        }
        return acc;
      },
      {},
    );
    const playerKnocked = (liveState?.teams ?? []).reduce<BooleanLookup>(
      (acc, team) => {
        for (const player of team.players ?? []) {
          const keys = [
            player.playerId,
            player.id,
            player.externalPlayerId,
            player.pubgPlayerId,
          ].filter((value): value is string => typeof value === 'string');
          for (const key of keys) {
            acc[key] = player.knocked === true;
          }
        }
        return acc;
      },
      {},
    );
    const slotResultsArr2 = (slotResults ?? []) as any[];

    const aliveFromStateStore =
      liveState?.teams?.filter((t) => (t.alivePlayers ?? 0) > 0).length ?? null;

    const aliveFromSlots = (() => {
      if (!slotResultsArr2.length) return null;
      let count = 0;
      slotResultsArr2.forEach((sr) => {
        const players = sr.players ?? [];
        const alive = players.some((p) => {
          const knocked =
            (p.playerId ? playerKnocked[p.playerId] : undefined) ??
            (p.isKnocked ?? p.knocks ?? 0) > 0;
          const aliveFlag =
            (p.playerId ? playerAlive[p.playerId] : undefined) ??
            p.isAlive ??
            null;
          return knocked ? false : aliveFlag !== false;
        });
        if (alive) count += 1;
      });
      return count;
    })();

    const aliveTeams = aliveFromStateStore ?? aliveFromSlots ?? null;

    const triggerMet = isPostMatchConfirmed({
      aliveTeams,
      controlState: snapshot.state.controlState ?? match.controlState?.state,
      matchStatus: match.status ?? null,
      resultFinalized: snapshot.state.resultFinalized ?? null,
    });

    const header = {
      tournament: match.tournament?.name ?? match.tournament?.shortName ?? null,
      match:
        match.name ??
        (typeof match.matchNumber === 'number' &&
        Number.isFinite(match.matchNumber)
          ? `Match ${match.matchNumber.toString().padStart(2, '0')}`
          : null),
      map: formatMapLabel(match.map),
    };

    const reasons = Array.from(
      new Set([
        ...(snapshot.state.reasons ?? []),
        ...(triggerMet ? [] : ['TRIGGER_NOT_MET']),
        ...(aliveTeams && aliveTeams > 1 ? ['ALIVE_TEAMS_GT_ONE'] : []),
      ]),
    );

    let stats: MatchResultSummaryStats | null = null;
    let highlights: MatchResultSummaryHighlight[] = [];

    if (triggerMet) {
      const summary = await this.buildMatchSummaryAggregate({
        matchId: id,
        startedAt: match.startedAt ?? null,
        endedAt: match.endedAt ?? null,
        snapshot,
        slotResults,
        liveState,
        telemetryPayload: latestTelemetry?.payload ?? null,
      });
      stats = summary.stats;
      highlights = summary.highlights;
    }

    const payload = {
      version: 'v2' as const,
      state: { ...snapshot.state, status: match.status ?? null, reasons },
      header,
      stats,
      highlights,
    };

    return this.wrapWidgetResponse(res!, payload, {
      updatedAt: snapshot.state.lastUpdateIso,
      matchId: snapshot.state.matchId,
      tournamentId: snapshot.state.tournamentId,
      organizationId: match.organizationId ?? match.tournament?.id ?? null,
      dataSource: snapshot.state.dataSource,
      controlState: snapshot.state.controlState,
      aliveTeams: aliveTeams ?? null,
      resultFinalized: snapshot.state.resultFinalized ?? null,
      finalizedAt: snapshot.state.finalizedAt ?? null,
      winnerTeamId: snapshot.state.winnerTeamId ?? null,
      branding,
    });
  }

  @Get('post-match-overall-ranking')
  async postMatchOverallRanking(
    @Query('matchId') matchId?: string,
    @Query('organizationId') organizationId?: string,
    @Res({ passthrough: true }) res?: Response,
  ) {
    const id = validateMatchId(matchId);

    const match = await this.prisma.match.findFirst({
      where: {
        id,
        deletedAt: null,
        ...(organizationId ? { organizationId } : {}),
      },
      select: {
        id: true,
        status: true,
        tournamentId: true,
        sessionId: true,
        organizationId: true,
        stageId: true,
        groupId: true,
        name: true,
        matchNumber: true,
        map: true,
        dataSource: true,
        dataMode: true,
        updatedAt: true,
        controlState: { select: { state: true, metaJson: true } },
        tournament: {
          select: {
            id: true,
            name: true,
            shortName: true,
            organizationId: true,
            qualifiedTeamsCount: true,
            qualificationBubbleCount: true,
            qualificationLabel: true,
          },
        },
        session: {
          select: {
            id: true,
            name: true,
            organizationId: true,
            qualifiedTeamsCount: true,
            qualificationBubbleCount: true,
            qualificationLabel: true,
          },
        },
        stage: {
          select: {
            id: true,
            name: true,
            qualifiedTeamsCount: true,
            qualificationBubbleCount: true,
            qualificationLabel: true,
          },
        },
        group: {
          select: {
            id: true,
            name: true,
            qualifiedTeamsCount: true,
            qualificationBubbleCount: true,
            qualificationLabel: true,
          },
        },
        matchSlots: { select: { slotNumber: true, teamId: true } },
      },
    });
    const branding = await this.resolveBrandingForMatch(id);

    if (!match) {
      const placeholder: PostMatchOverallPayload = {
        version: 'v1',
        state: {
          matchId: id,
          tournamentId: null,
          scope: 'TOURNAMENT',
          scopeId: 'PLACEHOLDER',
          status: null,
          lastUpdateIso: new Date().toISOString(),
          reasons: ['MATCH_NOT_FOUND'],
        },
        header: {
          tournament: null,
          stage: null,
          group: null,
          matchLabel: 'Post Match Overall Ranking � Waiting for data',
          map: null,
        },
        qualification: null,
        rows: [],
      };
      return this.wrapWidgetResponse(res!, placeholder, {
        updatedAt: placeholder.state.lastUpdateIso,
        matchId: id,
        tournamentId: null,
        organizationId: organizationId ?? null,
        dataSource: null,
        controlState: null,
        aliveTeams: null,
        branding,
      });
    }

    const reasons: string[] = [];
    const controlMeta =
      (match.controlState?.metaJson as {
        resultFinalized?: boolean;
        finalizedAt?: string;
        winnerTeamId?: string | null;
      } | null) ?? null;

    const scope: Scope = match.groupId
      ? 'GROUP'
      : match.stageId
        ? 'STAGE'
        : match.tournamentId
          ? 'TOURNAMENT'
          : match.sessionId
            ? 'SESSION'
            : 'MATCH';
    const scopeId =
      match.groupId ??
      match.stageId ??
      match.tournamentId ??
      match.sessionId ??
      match.id;
    const qualificationSources: Array<PostMatchQualificationPayload | null> = [
      match.groupId && typeof match.group?.qualifiedTeamsCount === 'number'
        ? {
            source: 'GROUP' as const,
            sourceId: match.groupId,
            qualifiedTeamsCount: match.group.qualifiedTeamsCount,
            qualificationBubbleCount: match.group.qualificationBubbleCount,
            qualificationLabel: match.group.qualificationLabel,
          }
        : null,
      match.stageId && typeof match.stage?.qualifiedTeamsCount === 'number'
        ? {
            source: 'STAGE' as const,
            sourceId: match.stageId,
            qualifiedTeamsCount: match.stage.qualifiedTeamsCount,
            qualificationBubbleCount: match.stage.qualificationBubbleCount,
            qualificationLabel: match.stage.qualificationLabel,
          }
        : null,
      match.tournamentId &&
      typeof match.tournament?.qualifiedTeamsCount === 'number'
        ? {
            source: 'TOURNAMENT' as const,
            sourceId: match.tournamentId,
            qualifiedTeamsCount: match.tournament.qualifiedTeamsCount,
            qualificationBubbleCount: match.tournament.qualificationBubbleCount,
            qualificationLabel: match.tournament.qualificationLabel,
          }
        : null,
      match.sessionId && typeof match.session?.qualifiedTeamsCount === 'number'
        ? {
            source: 'SESSION' as const,
            sourceId: match.sessionId,
            qualifiedTeamsCount: match.session.qualifiedTeamsCount,
            qualificationBubbleCount: match.session.qualificationBubbleCount,
            qualificationLabel: match.session.qualificationLabel,
          }
        : null,
    ];
    const qualificationSource = qualificationSources.find(
      (setting): setting is PostMatchQualificationPayload => setting !== null,
    );
    const hasStandingsScope = Boolean(
      match.groupId ?? match.stageId ?? match.tournamentId ?? match.sessionId,
    );

    const brandMode = branding.mode;
    const [activeSnapshot, scoreboardSnapshot, liveState] = await Promise.all([
      hasStandingsScope
        ? this.standingsSnapshots.getLatestSnapshot(scope, scopeId)
        : Promise.resolve(null),
      buildWidgetScoreboardSnapshot(this.prisma, id, {
        includeLogos: true,
        brandMode,
      }),
      this.matchStateStore.get(id),
    ]);

    let standings: StandingsPayload | null =
      activeSnapshot && isStandingsPayload(activeSnapshot.data)
        ? activeSnapshot.data
        : null;
    if (!standings && hasStandingsScope) {
      standings = await this.standings.computeStandings({ scope, scopeId });
    }
    if (!hasStandingsScope) {
      reasons.push('STANDINGS_SCOPE_UNAVAILABLE');
    }

    if (!standings?.rows?.length) {
      reasons.push('STANDINGS_MISSING');
    }

    const slotResults = (scoreboardSnapshot.rows ?? []).filter(
      (row) => row.wasPresentInMatch === true,
    );
    if (!slotResults.length) {
      reasons.push('SLOT_RESULTS_MISSING');
    }

    const aliveFromStateStore =
      liveState?.teams?.filter((t) => (t.alivePlayers ?? 0) > 0).length ?? null;

    const aliveTeams =
      scoreboardSnapshot.state.aliveTeams ?? aliveFromStateStore ?? null;
    const triggerMet = isPostMatchConfirmed({
      aliveTeams,
      controlState: match.controlState?.state ?? null,
      matchStatus: match.status ?? null,
      resultFinalized: controlMeta?.resultFinalized ?? null,
    });
    if (!triggerMet) {
      reasons.push('TRIGGER_NOT_MET');
    }
    if (aliveTeams && aliveTeams > 1) {
      reasons.push('ALIVE_TEAMS_GT_ONE');
    }

    const matchSlotMap = new Map(
      (match.matchSlots ?? [])
        .filter((slot) => Boolean(slot.teamId))
        .map((slot) => [slot.teamId, slot.slotNumber]),
    );

    const slotStatMap = new Map<
      string,
      {
        slot: number | null;
        matchKills: number;
        matchPoints: number;
        placementPoints: number | null;
        placement: number | null;
        teamTag: string | null;
        teamName: string | null;
        teamLogoUrl: string | null;
        logoUpdatedAt: Date | string | number | null;
        brandLight: WidgetTeamBrandPreset | null;
        brandDark: WidgetTeamBrandPreset | null;
      }
    >();

    slotResults.forEach((sr) => {
      const entry = {
        slot:
          sr.slot ?? (sr.teamId ? (matchSlotMap.get(sr.teamId) ?? null) : null),
        matchKills: sr.totalKills ?? 0,
        matchPoints:
          sr.totalPoints ?? (sr.placementPoints ?? 0) + (sr.totalKills ?? 0),
        placementPoints: sr.placementPoints ?? null,
        placement: sr.placement ?? null,
        teamTag: sr.teamTag ?? sr.teamName ?? DEFAULT_WIDGET_TEAM_TAG,
        teamName: sr.teamName ?? sr.teamTag ?? DEFAULT_WIDGET_TEAM_NAME,
        teamLogoUrl: sr.teamLogoUrl ?? null,
        logoUpdatedAt: null,
        brandLight: sr.brandLight ?? null,
        brandDark: sr.brandDark ?? null,
      };

      const key = sr.teamId ?? `slot-${sr.slot}`;
      slotStatMap.set(key, entry);
      if (sr.teamId) {
        slotStatMap.set(sr.teamId, entry);
      }
      if (sr.slot !== null && sr.slot !== undefined) {
        slotStatMap.set(`slot-${sr.slot}`, entry);
      }
    });

    const previousRankMap = new Map<string, number>();
    if (standings?.rows?.length) {
      const prevRows = standings.rows.map((row) => {
        const others = (row.perMatch ?? []).filter((pm) => pm.matchId !== id);
        const totalPoints = others.reduce(
          (sum, pm) => sum + (pm.totalPoints ?? 0),
          0,
        );
        const totalKills = others.reduce((sum, pm) => sum + (pm.kills ?? 0), 0);
        const totalPlacementPoints = others.reduce(
          (sum, pm) => sum + (pm.placementPoints ?? 0),
          0,
        );
        const wwcd = others.reduce(
          (sum, pm) => sum + (pm.placement === 1 ? 1 : 0),
          0,
        );
        const bestPlacementRaw = others.reduce((best, pm) => {
          if (pm.placement && pm.placement > 0) {
            return Math.min(best, pm.placement);
          }
          return best;
        }, Number.POSITIVE_INFINITY);
        const bestPlacement =
          Number.isFinite(bestPlacementRaw) && bestPlacementRaw !== Infinity
            ? bestPlacementRaw
            : null;

        const lastMatchPlacement =
          others.slice().sort((a, b) => {
            const aTs =
              a.playedAt instanceof Date
                ? a.playedAt.getTime()
                : new Date(a.playedAt ?? 0).getTime();
            const bTs =
              b.playedAt instanceof Date
                ? b.playedAt.getTime()
                : new Date(b.playedAt ?? 0).getTime();
            return bTs - aTs;
          })[0]?.placement ?? null;

        return {
          teamId: row.teamId,
          teamName: row.teamName ?? DEFAULT_WIDGET_TEAM_NAME,
          totalPoints,
          totalKills,
          totalPlacementPoints,
          wwcd,
          bestPlacement,
          lastMatchPlacement,
        };
      });

      prevRows
        .sort((a, b) => {
          const rankingOrder = compareRankingRows(a, b);
          if (rankingOrder !== 0) return rankingOrder;
          const aBest = a.bestPlacement ?? Infinity;
          const bBest = b.bestPlacement ?? Infinity;
          if (aBest !== bBest) return aBest - bBest;
          const aLast = a.lastMatchPlacement ?? Infinity;
          const bLast = b.lastMatchPlacement ?? Infinity;
          if (aLast !== bLast) return aLast - bLast;
          return (a.teamName ?? '').localeCompare(b.teamName ?? '');
        })
        .forEach((row, idx) => previousRankMap.set(row.teamId, idx + 1));
    }

    const canRender =
      triggerMet &&
      !reasons.includes('STANDINGS_MISSING') &&
      !reasons.includes('SLOT_RESULTS_MISSING');

    const rows: PostMatchOverallRow[] = canRender
      ? (standings?.rows ?? [])
          .slice()
          .sort((a, b) => {
            const rankingOrder = compareRankingRows(a, b);
            if (rankingOrder !== 0) return rankingOrder;
            const aRank = a.rank ?? Number.MAX_SAFE_INTEGER;
            const bRank = b.rank ?? Number.MAX_SAFE_INTEGER;
            if (aRank !== bRank) return aRank - bRank;
            const aName = (a.teamName ?? '').toString();
            const bName = (b.teamName ?? '').toString();
            return aName.localeCompare(bName);
          })
          .map((row, idx) => {
            const matchEntry = (row.perMatch ?? []).find(
              (pm) => pm.matchId === id,
            );
            const slotEntry =
              slotStatMap.get(row.teamId) ??
              (row.teamId && matchSlotMap.has(row.teamId)
                ? slotStatMap.get(`slot-${matchSlotMap.get(row.teamId)}`)
                : null);

            const logoSource = pickTeamLogoSource(
              row.teamLogo,
              slotEntry?.teamLogoUrl,
            );
            const logoUrl = resolveTeamLogoUrl({
              logoUrl: logoSource,
              logoUpdatedAt:
                (row as { teamLogoUpdatedAt?: Date | string | number })
                  .teamLogoUpdatedAt ??
                (row as { teamUpdatedAt?: Date | string | number })
                  .teamUpdatedAt ??
                slotEntry?.logoUpdatedAt ??
                null,
              updatedAt:
                (row as { teamUpdatedAt?: Date | string | number })
                  .teamUpdatedAt ??
                slotEntry?.logoUpdatedAt ??
                null,
            });

            const rank = row.rank ?? idx + 1;
            const previousRank = previousRankMap.get(row.teamId) ?? null;
            const trend: PostMatchOverallRow['trend'] =
              previousRank === null
                ? null
                : previousRank > rank
                  ? 'UP'
                  : previousRank < rank
                    ? 'DOWN'
                    : 'SAME';

            const overallKills = this.toNumber(row.totalKills, 0) ?? 0;
            const totalPoints = this.toNumber(row.totalPoints, 0) ?? 0;
            const cumulativePlacementPoints =
              this.toNumber(
                (row as { totalPlacementPoints?: number | null })
                  .totalPlacementPoints,
                totalPoints - overallKills,
              ) ?? Math.max(0, totalPoints - overallKills);
            const matchPlacementPoints =
              this.toNumber(
                matchEntry?.placementPoints ??
                  slotEntry?.placementPoints ??
                  null,
                0,
              ) ?? 0;
            const matchKills =
              this.toNumber(
                matchEntry?.kills ?? slotEntry?.matchKills ?? null,
                0,
              ) ?? 0;
            const matchPoints =
              this.toNumber(
                matchEntry?.totalPoints ?? slotEntry?.matchPoints ?? null,
                matchPlacementPoints + matchKills,
              ) ?? matchPlacementPoints + matchKills;
            const hasCurrentMatchEntry = (row.perMatch ?? []).some(
              (pm) => pm.matchId === id,
            );
            const wwcd =
              (row.perMatch ?? []).reduce(
                (sum, pm) => sum + (pm.placement === 1 ? 1 : 0),
                0,
              ) + (!hasCurrentMatchEntry && slotEntry?.placement === 1 ? 1 : 0);

            return {
              rank,
              previousRank,
              trend,
              teamId: row.teamId,
              teamTag:
                row.teamTag ??
                slotEntry?.teamTag ??
                row.teamName ??
                DEFAULT_WIDGET_TEAM_TAG,
              teamName:
                row.teamName ??
                slotEntry?.teamName ??
                row.teamTag ??
                DEFAULT_WIDGET_TEAM_NAME,
              teamLogoUrl: logoUrl,
              brandLight: slotEntry?.brandLight ?? null,
              brandDark: slotEntry?.brandDark ?? null,
              slot: slotEntry?.slot ?? matchSlotMap.get(row.teamId) ?? null,
              matchKills,
              matchPoints,
              overallKills,
              placementPoints: cumulativePlacementPoints,
              totalPoints,
              totalKills: overallKills,
              matchesPlayed:
                this.toNumber(row.matchesPlayed, row.perMatch?.length ?? 0) ??
                0,
              wwcd,
            };
          })
          .slice(0, 25)
      : [];

    const lastUpdateIso =
      standings?.computedAt ??
      (activeSnapshot?.createdAt instanceof Date
        ? activeSnapshot.createdAt.toISOString()
        : null) ??
      match.updatedAt?.toISOString?.() ??
      new Date().toISOString();

    const payload: PostMatchOverallPayload = {
      version: 'v1',
      state: {
        matchId: id,
        tournamentId: match.tournamentId,
        scope,
        scopeId,
        status: match.status ?? null,
        lastUpdateIso,
        reasons,
        resultFinalized: controlMeta?.resultFinalized ?? null,
        finalizedAt: controlMeta?.finalizedAt ?? null,
      },
      header: {
        tournament:
          match.tournament?.name ??
          match.tournament?.shortName ??
          match.session?.name ??
          null,
        stage: match.stage?.name ?? null,
        group: match.group?.name ?? null,
        matchLabel: normalizeMatchLabel(match),
        map: formatMapLabel(match.map),
      },
      qualification: qualificationSource ?? null,
      rows,
    };

    return this.wrapWidgetResponse(res!, payload, {
      updatedAt: lastUpdateIso,
      matchId: id,
      tournamentId: match.tournamentId,
      organizationId: match.tournament?.organizationId ?? null,
      dataSource: match.dataSource ?? match.dataMode ?? null,
      controlState: match.controlState?.state ?? match.status ?? null,
      aliveTeams: aliveTeams ?? null,
      resultFinalized: controlMeta?.resultFinalized ?? null,
      finalizedAt: controlMeta?.finalizedAt ?? null,
      winnerTeamId: controlMeta?.winnerTeamId ?? null,
      branding,
    });
  }

  @Get('match-schedule-results')
  async matchScheduleResults(
    @Query('organizationSlug') organizationSlug?: string,
    @Query('matchId') matchId?: string,
    @Query('organizationId') organizationId?: string,
    @Query('scheduleDate') scheduleDate?: string,
    @Query('eventDate') eventDate?: string,
    @Query('scheduleMode') scheduleMode?: string,
    @Query('eventDayCutoffHour') eventDayCutoffHour?: string,
    @Res({ passthrough: true }) res?: Response,
  ) {
    const requestedMatchId = matchId?.trim() ? validateMatchId(matchId) : null;
    const requestedOrganizationSlug = organizationSlug?.trim() || null;
    const requestedOrganizationId = organizationId?.trim() || null;
    const requestedScheduleDate =
      scheduleDate?.trim() || eventDate?.trim() || null;
    const requestedScheduleRange = parseMatchScheduleDateRange(
      requestedScheduleDate,
    );
    const resolvedScheduleMode = normalizeMatchScheduleMode(scheduleMode);
    const cutoffHourUtc = parseMatchScheduleCutoffHour(eventDayCutoffHour);
    const reasons: string[] = [];

    if (
      !requestedMatchId &&
      !requestedOrganizationSlug &&
      !requestedOrganizationId
    ) {
      throw new BadRequestException({
        error: 'MATCH_OR_ORGANIZATION_REQUIRED',
      });
    }

    const organization = requestedOrganizationSlug
      ? await this.prisma.organization.findFirst({
          where: { slug: requestedOrganizationSlug, deletedAt: null },
          select: { id: true, slug: true, name: true },
        })
      : null;
    const resolvedOrganizationId =
      requestedOrganizationId ?? organization?.id ?? null;

    if (requestedOrganizationSlug && !organization) {
      reasons.push('ORGANIZATION_NOT_FOUND');
    }
    if (requestedScheduleDate && !requestedScheduleRange) {
      reasons.push('INVALID_SCHEDULE_DATE');
    }

    const anchorMatchSelect = {
      id: true,
      status: true,
      tournamentId: true,
      sessionId: true,
      organizationId: true,
      stageId: true,
      groupId: true,
      name: true,
      matchNumber: true,
      map: true,
      scheduledAt: true,
      startedAt: true,
      endedAt: true,
      createdAt: true,
      updatedAt: true,
      dataSource: true,
      dataMode: true,
      controlState: { select: { state: true, metaJson: true } },
      tournament: {
        select: { name: true, shortName: true, organizationId: true },
      },
      session: { select: { name: true, organizationId: true } },
      stage: { select: { name: true } },
      group: { select: { name: true } },
      organization: { select: { slug: true, name: true } },
    } satisfies Prisma.MatchSelect;
    type MatchScheduleAnchorMatch = Prisma.MatchGetPayload<{
      select: typeof anchorMatchSelect;
    }>;
    const now = new Date();
    const todayRange = buildCurrentMatchScheduleRange(now, cutoffHourUtc);
    const anchorOrderBy: Prisma.MatchOrderByWithRelationInput[] = [
      { matchNumber: 'asc' },
      { scheduledAt: 'asc' },
      { startedAt: 'asc' },
      { createdAt: 'asc' },
    ];
    const latestMatchOrderBy: Prisma.MatchOrderByWithRelationInput[] = [
      { scheduledAt: 'desc' },
      { startedAt: 'desc' },
      { endedAt: 'desc' },
      { updatedAt: 'desc' },
      { matchNumber: 'desc' },
    ];
    const latestFinishedOrderBy: Prisma.MatchOrderByWithRelationInput[] = [
      { endedAt: 'desc' },
      { updatedAt: 'desc' },
      { scheduledAt: 'desc' },
      { startedAt: 'desc' },
      { matchNumber: 'desc' },
    ];
    let anchorMatch: MatchScheduleAnchorMatch | null = null;

    if (requestedMatchId) {
      anchorMatch = await this.prisma.match.findFirst({
        where: {
          id: requestedMatchId,
          deletedAt: null,
          ...(resolvedOrganizationId
            ? { organizationId: resolvedOrganizationId }
            : {}),
        },
        select: anchorMatchSelect,
      });
    } else if (resolvedOrganizationId) {
      const organizationScheduleWhere: Prisma.MatchWhereInput = {
        organizationId: resolvedOrganizationId,
        deletedAt: null,
        status: { in: MATCH_SCHEDULE_STATUSES },
      };
      const findScheduleAnchor = (
        where: Prisma.MatchWhereInput,
        orderBy: Prisma.MatchOrderByWithRelationInput[] = anchorOrderBy,
      ) =>
        this.prisma.match.findFirst({
          where: { ...organizationScheduleWhere, ...where },
          orderBy,
          select: anchorMatchSelect,
        });
      const effectiveScheduleRange = requestedScheduleRange ?? todayRange;
      const upcomingWhere: Prisma.MatchWhereInput = {
        OR: [
          { scheduledAt: { gte: effectiveScheduleRange?.end ?? now } },
          {
            scheduledAt: null,
            startedAt: { gte: effectiveScheduleRange?.end ?? now },
          },
        ],
      };
      const recentFinishedCutoff = new Date(
        now.getTime() - MATCH_SCHEDULE_RECENT_FINISHED_WINDOW_MS,
      );
      const recentFinishedWhere: Prisma.MatchWhereInput = {
        status: { in: MATCH_FINISHED_STATUSES },
        OR: [
          { endedAt: { gte: recentFinishedCutoff } },
          { updatedAt: { gte: recentFinishedCutoff } },
        ],
      };

      if (requestedScheduleRange) {
        anchorMatch = await findScheduleAnchor(
          buildMatchScheduleDayWhere(requestedScheduleRange),
        );
      } else if (resolvedScheduleMode === 'finished') {
        anchorMatch = await findScheduleAnchor(
          { status: { in: MATCH_FINISHED_STATUSES } },
          latestFinishedOrderBy,
        );
      } else if (resolvedScheduleMode === 'upcoming') {
        anchorMatch =
          (await findScheduleAnchor(upcomingWhere)) ??
          (await findScheduleAnchor(buildMatchScheduleDayWhere(todayRange))) ??
          (await findScheduleAnchor(
            { status: { in: MATCH_FINISHED_STATUSES } },
            latestFinishedOrderBy,
          ));
      } else if (resolvedScheduleMode === 'today') {
        anchorMatch =
          (await findScheduleAnchor(buildMatchScheduleDayWhere(todayRange))) ??
          (await findScheduleAnchor(upcomingWhere)) ??
          (await findScheduleAnchor(
            { status: { in: MATCH_FINISHED_STATUSES } },
            latestFinishedOrderBy,
          ));
      } else {
        anchorMatch =
          (await findScheduleAnchor({
            ...buildMatchScheduleDayWhere(todayRange),
            status: { in: MATCH_SCHEDULE_ACTIVE_STATUSES },
          })) ??
          (await findScheduleAnchor(
            recentFinishedWhere,
            latestFinishedOrderBy,
          )) ??
          (await findScheduleAnchor(buildMatchScheduleDayWhere(todayRange))) ??
          (await findScheduleAnchor(upcomingWhere)) ??
          (await findScheduleAnchor(
            { status: { in: MATCH_FINISHED_STATUSES } },
            latestFinishedOrderBy,
          )) ??
          (await findScheduleAnchor({}, latestMatchOrderBy));
      }
    }

    if (!anchorMatch) {
      const now = new Date().toISOString();
      const placeholder: MatchScheduleResultsPayload = {
        version: 'v1',
        state: {
          organizationSlug: requestedOrganizationSlug,
          organizationId: resolvedOrganizationId,
          anchorMatchId: requestedMatchId,
          tournamentId: null,
          scope: 'MATCH',
          scopeId: requestedMatchId ?? 'PLACEHOLDER',
          status: null,
          lastUpdateIso: now,
          reasons: Array.from(
            new Set([
              ...reasons,
              requestedMatchId ? 'MATCH_NOT_FOUND' : 'SCHEDULE_MATCH_NOT_FOUND',
            ]),
          ),
        },
        header: {
          tournament: null,
          stage: null,
          group: null,
          matchLabel: 'Match Schedule - Waiting for data',
        },
        rows: [],
      };

      return this.wrapWidgetResponse(res!, placeholder, {
        updatedAt: now,
        matchId: requestedMatchId,
        tournamentId: null,
        organizationId: resolvedOrganizationId,
        dataSource: null,
        controlState: null,
        aliveTeams: null,
        branding: null,
      });
    }

    const scope: Scope | 'MATCH' = anchorMatch.groupId
      ? 'GROUP'
      : anchorMatch.stageId
        ? 'STAGE'
        : anchorMatch.tournamentId
          ? 'TOURNAMENT'
          : anchorMatch.sessionId
            ? 'SESSION'
            : 'MATCH';
    const scopeId =
      anchorMatch.groupId ??
      anchorMatch.stageId ??
      anchorMatch.tournamentId ??
      anchorMatch.sessionId ??
      anchorMatch.id;
    const scopeWhere: Prisma.MatchWhereInput =
      scope === 'GROUP'
        ? { groupId: scopeId }
        : scope === 'STAGE'
          ? { stageId: scopeId }
          : scope === 'TOURNAMENT'
            ? { tournamentId: scopeId }
            : scope === 'SESSION'
              ? { sessionId: scopeId }
              : { id: scopeId };
    const scheduleDayWhere = buildMatchScheduleDayWhere(
      requestedScheduleRange ??
        buildUtcDayRange(pickMatchScheduleDate(anchorMatch)),
    );

    const matches = await this.prisma.match.findMany({
      where: {
        ...scopeWhere,
        ...scheduleDayWhere,
        organizationId: anchorMatch.organizationId,
        deletedAt: null,
        status: { in: MATCH_SCHEDULE_STATUSES },
      },
      orderBy: [
        { matchNumber: 'asc' },
        { scheduledAt: 'asc' },
        { startedAt: 'asc' },
        { createdAt: 'asc' },
      ],
      select: {
        id: true,
        status: true,
        name: true,
        matchNumber: true,
        map: true,
        scheduledAt: true,
        startedAt: true,
        endedAt: true,
        createdAt: true,
        updatedAt: true,
        controlState: { select: { state: true, metaJson: true } },
        slotResults: {
          where: { teamId: { not: null }, wasPresentInMatch: true },
          orderBy: [
            { placement: 'asc' },
            { finalPlacement: 'asc' },
            { totalPoints: 'desc' },
            { totalKills: 'desc' },
            { slotNumber: 'asc' },
          ],
          select: {
            slotNumber: true,
            teamId: true,
            placement: true,
            finalPlacement: true,
            totalKills: true,
            totalPoints: true,
            placementPoints: true,
            team: {
              select: {
                id: true,
                name: true,
                tag: true,
                logoUrl: true,
                logoLightUrl: true,
                logoDarkUrl: true,
                updatedAt: true,
              },
            },
          },
        },
      },
    });

    if (!matches.length) {
      reasons.push('MATCH_SCHEDULE_EMPTY');
    }

    const rows: MatchScheduleResultRow[] = matches.map((match) => {
      const matchHasResult = MATCH_FINISHED_STATUSES.includes(match.status);
      const controlMeta =
        (match.controlState?.metaJson as {
          winnerTeamId?: string | null;
        } | null) ?? null;
      const winner = matchHasResult
        ? ((controlMeta?.winnerTeamId
            ? match.slotResults.find(
                (slotResult) => slotResult.teamId === controlMeta.winnerTeamId,
              )
            : null) ??
          match.slotResults.find(
            (slotResult) =>
              slotResult.placement === 1 || slotResult.finalPlacement === 1,
          ) ??
          match.slotResults[0] ??
          null)
        : null;
      const winnerLogoUrl = winner?.team
        ? resolveTeamLogoUrl({
            logoUrl: pickTeamLogoSource(
              winner.team.logoUrl,
              winner.team.logoLightUrl,
              winner.team.logoDarkUrl,
            ),
            logoUpdatedAt: winner.team.updatedAt,
            updatedAt: winner.team.updatedAt,
          })
        : null;
      const winnerTotalPoints =
        winner !== null
          ? (this.toNumber(
              winner.totalPoints,
              (winner.placementPoints ?? 0) + (winner.totalKills ?? 0),
            ) ?? 0)
          : 0;

      return {
        matchId: match.id,
        matchLabel: normalizeMatchLabel(match),
        matchNumber:
          typeof match.matchNumber === 'number' &&
          Number.isFinite(match.matchNumber)
            ? match.matchNumber
            : null,
        map: formatMapLabel(match.map),
        scheduledAt: match.scheduledAt?.toISOString?.() ?? null,
        startedAt: match.startedAt?.toISOString?.() ?? null,
        endedAt: match.endedAt?.toISOString?.() ?? null,
        status: match.status ?? null,
        winnerTeamId: winner?.teamId ?? null,
        winnerTeamName: winner?.team?.name ?? null,
        winnerTeamTag: winner?.team?.tag ?? null,
        winnerTeamLogoUrl: winnerLogoUrl,
        winnerKills: winner?.totalKills ?? 0,
        winnerTotalPoints,
      };
    });

    if (
      rows.some(
        (row) =>
          MATCH_FINISHED_STATUSES.includes(row.status as MatchStatus) &&
          !row.winnerTeamId,
      )
    ) {
      reasons.push('SOME_WINNERS_MISSING');
    }

    const lastUpdateMs = matches.reduce(
      (latest, match) =>
        Math.max(
          latest,
          match.updatedAt?.getTime?.() ?? 0,
          match.endedAt?.getTime?.() ?? 0,
          match.startedAt?.getTime?.() ?? 0,
          match.scheduledAt?.getTime?.() ?? 0,
          match.createdAt?.getTime?.() ?? 0,
        ),
      anchorMatch.updatedAt?.getTime?.() ?? Date.now(),
    );
    const lastUpdateIso = new Date(lastUpdateMs).toISOString();
    const controlMeta =
      (anchorMatch.controlState?.metaJson as {
        resultFinalized?: boolean;
        finalizedAt?: string;
        winnerTeamId?: string | null;
      } | null) ?? null;
    const branding = await this.resolveBrandingForMatch(anchorMatch.id);
    const payload: MatchScheduleResultsPayload = {
      version: 'v1',
      state: {
        organizationSlug:
          requestedOrganizationSlug ?? anchorMatch.organization?.slug ?? null,
        organizationId: anchorMatch.organizationId,
        anchorMatchId: anchorMatch.id,
        tournamentId: anchorMatch.tournamentId,
        scope,
        scopeId,
        status: anchorMatch.status ?? null,
        lastUpdateIso,
        reasons: Array.from(new Set(reasons)),
      },
      header: {
        tournament:
          anchorMatch.tournament?.name ??
          anchorMatch.tournament?.shortName ??
          anchorMatch.session?.name ??
          null,
        stage: anchorMatch.stage?.name ?? null,
        group: anchorMatch.group?.name ?? null,
        matchLabel: normalizeMatchLabel(anchorMatch),
      },
      rows,
    };

    return this.wrapWidgetResponse(res!, payload, {
      updatedAt: lastUpdateIso,
      matchId: anchorMatch.id,
      tournamentId: anchorMatch.tournamentId,
      organizationId:
        anchorMatch.tournament?.organizationId ??
        anchorMatch.session?.organizationId ??
        anchorMatch.organizationId,
      dataSource: anchorMatch.dataSource ?? anchorMatch.dataMode ?? null,
      controlState:
        anchorMatch.controlState?.state ?? anchorMatch.status ?? null,
      aliveTeams: null,
      resultFinalized: controlMeta?.resultFinalized ?? null,
      finalizedAt: controlMeta?.finalizedAt ?? null,
      winnerTeamId: controlMeta?.winnerTeamId ?? null,
      branding,
    });
  }

  @Get('post-match-points-breakdown')
  async postMatchPointsBreakdown(
    @Query('matchId') matchId?: string,
    @Query('organizationId') organizationId?: string,
    @Res({ passthrough: true }) res?: Response,
  ) {
    const id = validateMatchId(matchId);

    const match = await this.prisma.match.findFirst({
      where: {
        id,
        deletedAt: null,
        ...(organizationId ? { organizationId } : {}),
      },
      select: {
        id: true,
        status: true,
        tournamentId: true,
        name: true,
        matchNumber: true,
        map: true,
        updatedAt: true,
        controlState: { select: { state: true, metaJson: true } },
        tournament: {
          select: { name: true, shortName: true, organizationId: true },
        },
        stage: { select: { name: true } },
        group: { select: { name: true } },
        slotResults: {
          where: { teamId: { not: null }, wasPresentInMatch: true },
          orderBy: [
            { placement: 'asc' },
            { totalPoints: 'desc' },
            { totalKills: 'desc' },
          ],
          select: {
            slotNumber: true,
            teamId: true,
            placement: true,
            placementPoints: true,
            totalKills: true,
            points: true,
            totalPoints: true,
          },
        },
      },
    });
    const branding = await this.resolveBrandingForMatch(id);

    if (!match) {
      const placeholder: PostMatchPointsBreakdownPayload = {
        version: 'v1',
        state: {
          matchId: id,
          tournamentId: null,
          status: null,
          lastUpdateIso: new Date().toISOString(),
          reasons: ['MATCH_NOT_FOUND'],
        },
        header: {
          tournament: null,
          stage: null,
          group: null,
          matchLabel: 'Post Match Points Breakdown - Waiting for data',
          map: null,
        },
        summary: {
          teams: 0,
          placementPointsTotal: 0,
          killPointsTotal: 0,
          adjustmentPointsTotal: 0,
          totalPointsTotal: 0,
        },
        rows: [],
      };

      return this.wrapWidgetResponse(res!, placeholder, {
        updatedAt: placeholder.state.lastUpdateIso,
        matchId: id,
        tournamentId: null,
        organizationId: organizationId ?? null,
        dataSource: null,
        controlState: null,
        aliveTeams: null,
        branding,
      });
    }

    const snapshot = await buildWidgetScoreboardSnapshot(this.prisma, id, {
      includeLogos: true,
      brandMode: branding.mode,
    });

    const controlMeta =
      (match.controlState?.metaJson as {
        resultFinalized?: boolean;
        finalizedAt?: string;
      } | null) ?? null;

    const reasons = Array.from(new Set(snapshot.state.reasons ?? []));
    const aliveTeams = snapshot.state.aliveTeams ?? null;
    const isPostMatch = isPostMatchConfirmed({
      aliveTeams,
      controlState: snapshot.state.controlState ?? match.controlState?.state,
      matchStatus: match.status ?? null,
      resultFinalized: controlMeta?.resultFinalized ?? null,
    });

    if (!isPostMatch) {
      reasons.push('TRIGGER_NOT_MET');
      if (aliveTeams && aliveTeams > 1) {
        reasons.push('ALIVE_TEAMS_GT_ONE');
      }
    }

    const slotBreakdownMap = new Map<
      string,
      {
        slot: number | null;
        placement: number | null;
        placementPoints: number;
        kills: number;
        killPoints: number;
        adjustmentPoints: number;
        totalPoints: number;
      }
    >();

    match.slotResults.forEach((slotResult) => {
      const placementPoints = slotResult.placementPoints ?? 0;
      const kills = slotResult.totalKills ?? 0;
      const killPoints = slotResult.points ?? 0;
      const totalPoints =
        slotResult.totalPoints ?? placementPoints + killPoints;
      const adjustmentPoints = totalPoints - placementPoints - killPoints;
      const detail = {
        slot: slotResult.slotNumber ?? null,
        placement: slotResult.placement ?? null,
        placementPoints,
        kills,
        killPoints,
        adjustmentPoints,
        totalPoints,
      };

      if (slotResult.teamId) {
        slotBreakdownMap.set(slotResult.teamId, detail);
      }
      if (
        slotResult.slotNumber !== null &&
        slotResult.slotNumber !== undefined
      ) {
        slotBreakdownMap.set(`slot-${slotResult.slotNumber}`, detail);
      }
    });

    const rowsBase = (snapshot.rows ?? [])
      .filter((row) => row.wasPresentInMatch === true)
      .map((row) => {
        const detail =
          (row.teamId ? slotBreakdownMap.get(row.teamId) : null) ??
          (row.slot !== null && row.slot !== undefined
            ? slotBreakdownMap.get(`slot-${row.slot}`)
            : null) ??
          null;
        const placementPoints =
          detail?.placementPoints ?? this.toNumber(row.placementPoints, 0) ?? 0;
        const kills = detail?.kills ?? this.toNumber(row.totalKills, 0) ?? 0;
        const killPoints =
          detail?.killPoints ??
          Math.max(
            0,
            (this.toNumber(row.totalPoints, placementPoints) ??
              placementPoints) - placementPoints,
          );
        const totalPoints =
          detail?.totalPoints ??
          this.toNumber(row.totalPoints, placementPoints + killPoints) ??
          placementPoints + killPoints;

        return {
          rank: 0,
          placement: detail?.placement ?? this.toNumber(row.placement) ?? null,
          teamId: row.teamId ?? `slot-${row.slot ?? 'unknown'}`,
          teamTag: row.teamTag ?? row.teamName ?? DEFAULT_WIDGET_TEAM_TAG,
          teamName: row.teamName ?? row.teamTag ?? DEFAULT_WIDGET_TEAM_NAME,
          teamLogoUrl: row.teamLogoUrl ?? null,
          brandLight: row.brandLight ?? null,
          brandDark: row.brandDark ?? null,
          slot: row.slot ?? detail?.slot ?? null,
          kills,
          placementPoints,
          killPoints,
          adjustmentPoints: detail?.adjustmentPoints ?? 0,
          totalPoints,
        } satisfies PostMatchPointsBreakdownRow;
      })
      .filter((row) => typeof row.teamId === 'string' && row.teamId.length > 0);

    if (!rowsBase.length) {
      reasons.push('SLOT_RESULTS_MISSING');
    }

    const rows = isPostMatch
      ? rowsBase
          .sort((a, b) => {
            const rankingOrder = compareRankingRows(a, b);
            if (rankingOrder !== 0) return rankingOrder;
            const aPlacement = a.placement ?? Number.MAX_SAFE_INTEGER;
            const bPlacement = b.placement ?? Number.MAX_SAFE_INTEGER;
            if (aPlacement !== bPlacement) return aPlacement - bPlacement;
            return (a.teamName ?? a.teamTag ?? '').localeCompare(
              b.teamName ?? b.teamTag ?? '',
            );
          })
          .map((row, index) => ({
            ...row,
            rank: index + 1,
          }))
          .slice(0, 25)
      : [];

    const summary = rows.reduce(
      (acc, row) => {
        acc.placementPointsTotal += row.placementPoints;
        acc.killPointsTotal += row.killPoints;
        acc.adjustmentPointsTotal += row.adjustmentPoints;
        acc.totalPointsTotal += row.totalPoints;
        return acc;
      },
      {
        teams: rows.length,
        placementPointsTotal: 0,
        killPointsTotal: 0,
        adjustmentPointsTotal: 0,
        totalPointsTotal: 0,
      },
    );

    const lastUpdateIso =
      snapshot.state.lastUpdateIso ??
      match.updatedAt?.toISOString?.() ??
      new Date().toISOString();

    const payload: PostMatchPointsBreakdownPayload = {
      version: 'v1',
      state: {
        matchId: id,
        tournamentId: match.tournamentId,
        status: match.status ?? null,
        lastUpdateIso,
        reasons,
        resultFinalized: controlMeta?.resultFinalized ?? null,
        finalizedAt: controlMeta?.finalizedAt ?? null,
      },
      header: {
        tournament:
          match.tournament?.name ?? match.tournament?.shortName ?? null,
        stage: match.stage?.name ?? null,
        group: match.group?.name ?? null,
        matchLabel: normalizeMatchLabel(match),
        map: formatMapLabel(match.map),
      },
      summary,
      rows,
    };

    return this.wrapWidgetResponse(res!, payload, {
      updatedAt: lastUpdateIso,
      matchId: id,
      tournamentId: match.tournamentId,
      organizationId:
        match.tournament?.organizationId ?? organizationId ?? null,
      dataSource: snapshot.state.dataSource,
      controlState: snapshot.state.controlState,
      aliveTeams,
      resultFinalized: payload.state.resultFinalized ?? null,
      finalizedAt: payload.state.finalizedAt ?? null,
      branding,
    });
  }

  @Get('overall-ranking')
  async overallRanking(
    @Query('matchId') matchId?: string,
    @Query('tournamentId') tournamentId?: string,
    @Query('organizationId') organizationId?: string,
    @Res({ passthrough: true }) res?: Response,
  ) {
    const safeMatchId = matchId?.trim() ? validateMatchId(matchId) : null;

    if (safeMatchId) {
      const match = await this.prisma.match.findFirst({
        where: {
          id: safeMatchId,
          deletedAt: null,
          ...(organizationId ? { organizationId } : {}),
        },
        select: {
          id: true,
          tournamentId: true,
          sessionId: true,
          stageId: true,
          groupId: true,
          organizationId: true,
          tournament: {
            select: {
              name: true,
              shortName: true,
              organizationId: true,
            },
          },
          session: {
            select: {
              name: true,
              organizationId: true,
            },
          },
          stage: { select: { name: true } },
          group: { select: { name: true } },
        },
      });

      if (!match) {
        throw new NotFoundException('Match not found for overall ranking');
      }

      const scope: Scope = match.groupId
        ? 'GROUP'
        : match.stageId
          ? 'STAGE'
          : match.tournamentId
            ? 'TOURNAMENT'
            : match.sessionId
              ? 'SESSION'
              : 'MATCH';
      const scopeId =
        match.groupId ??
        match.stageId ??
        match.tournamentId ??
        match.sessionId ??
        match.id;
      const standings = await this.standings.computeStandings({
        scope,
        scopeId,
      });
      const versionHash = computeWidgetVersion(standings);
      const versionRaw = Number.parseInt(versionHash.slice(0, 12), 16);
      const versionNumber = Number.isFinite(versionRaw)
        ? versionRaw
        : Date.now();

      const rows =
        standings.rows?.slice(0, 16).map((row, idx) => {
          const teamLogoUrl = resolveTeamLogoUrl({
            logoUrl: pickTeamLogoSource(row.teamLogo),
            logoUpdatedAt: (row as { teamLogoUpdatedAt?: unknown })
              ?.teamLogoUpdatedAt as Date | string | number | undefined,
            updatedAt: (row as { teamUpdatedAt?: unknown })?.teamUpdatedAt as
              | Date
              | string
              | number
              | undefined,
          });
          return {
            rank: row.rank ?? idx + 1,
            teamId: row.teamId,
            teamTag: row.teamTag ?? row.teamName ?? DEFAULT_WIDGET_TEAM_TAG,
            teamName: row.teamName ?? row.teamTag ?? DEFAULT_WIDGET_TEAM_NAME,
            teamLogo: teamLogoUrl,
            teamLogoUrl,
            logoUrl: teamLogoUrl,
            totalPoints: row.totalPoints ?? 0,
            totalKills: row.totalKills ?? 0,
            placementPoints: row.totalPlacementPoints ?? 0,
            totalPlacementPoints: row.totalPlacementPoints ?? 0,
            adjustmentPoints:
              (row as { adjustmentPoints?: number | null }).adjustmentPoints ??
              0,
            wwcd: row.wwcd ?? 0,
            matchesPlayed: row.matchesPlayed ?? 0,
            isLeader: (row.rank ?? idx + 1) === 1,
          };
        }) ?? [];

      this.setNoCache(res!);
      return {
        meta: {
          tournamentName:
            match.session?.name ??
            match.tournament?.name ??
            match.tournament?.shortName ??
            'OVERALL',
          stageName: match.group?.name ?? match.stage?.name ?? undefined,
          ruleset: 'PUBG_MOBILE',
          scope,
          scopeId,
          updatedAt: standings.computedAt ?? new Date().toISOString(),
          version: versionNumber,
        },
        rows,
      };
    }

    const tid = validateTournamentId(tournamentId);

    const [tournament, stage, latestSlotResult] = await Promise.all([
      this.prisma.tournament.findFirst({
        where: { id: tid, deletedAt: null },
        select: { name: true, shortName: true },
      }),
      this.prisma.stage.findFirst({
        where: { tournamentId: tid, deletedAt: null },
        orderBy: [{ startDate: 'desc' }, { createdAt: 'desc' }],
        select: { name: true },
      }),
      this.prisma.matchSlotResult.findFirst({
        where: { match: { tournamentId: tid, deletedAt: null } },
        select: { updatedAt: true },
        orderBy: { updatedAt: 'desc' },
      }),
    ]);

    const cached = await this.live.getLatestStandings(tid);
    let standings: StandingsPayload | null =
      cached !== null ? parseStandingsPayload(cached) : null;

    const latestUpdatedAt = latestSlotResult?.updatedAt?.getTime?.() ?? null;
    const computedAt =
      standings?.computedAt && Number.isFinite(Date.parse(standings.computedAt))
        ? Date.parse(standings.computedAt)
        : null;
    const isStale =
      latestUpdatedAt !== null &&
      (computedAt === null || computedAt < latestUpdatedAt);

    if (!standings || isStale) {
      standings = await this.standings.computeStandings({
        scope: 'TOURNAMENT',
        scopeId: tid,
      });
      void this.live.setLatestStandings(tid, standings);
    }

    const versionHash = computeWidgetVersion(standings);
    const versionRaw = Number.parseInt(versionHash.slice(0, 12), 16);
    const versionNumber = Number.isFinite(versionRaw) ? versionRaw : Date.now();

    const rows =
      standings?.rows?.slice(0, 16).map((row, idx) => {
        const teamLogoUrl = resolveTeamLogoUrl({
          logoUrl: row.teamLogo ?? null,
          logoUpdatedAt: (row as { teamLogoUpdatedAt?: unknown })
            ?.teamLogoUpdatedAt as Date | string | number | undefined,
          updatedAt: (row as { teamUpdatedAt?: unknown })?.teamUpdatedAt as
            | Date
            | string
            | number
            | undefined,
        });
        return {
          rank: row.rank ?? idx + 1,
          teamId: row.teamId,
          teamTag: row.teamTag ?? row.teamName ?? DEFAULT_WIDGET_TEAM_TAG,
          teamName: row.teamName ?? row.teamTag ?? DEFAULT_WIDGET_TEAM_NAME,
          teamLogo: teamLogoUrl,
          teamLogoUrl,
          logoUrl: teamLogoUrl,
          totalPoints: row.totalPoints ?? 0,
          totalKills: row.totalKills ?? 0,
          placementPoints: row.totalPlacementPoints ?? 0,
          totalPlacementPoints: row.totalPlacementPoints ?? 0,
          adjustmentPoints:
            (row as { adjustmentPoints?: number | null }).adjustmentPoints ?? 0,
          wwcd: row.wwcd ?? 0,
          matchesPlayed: row.matchesPlayed ?? 0,
          isLeader: (row.rank ?? idx + 1) === 1,
        };
      }) ?? [];

    this.setNoCache(res!);
    return {
      meta: {
        tournamentName:
          tournament?.name ?? tournament?.shortName ?? 'TOURNAMENT',
        stageName: stage?.name ?? undefined,
        ruleset: 'PUBG_MOBILE',
        updatedAt: standings?.computedAt ?? new Date().toISOString(),
        version: versionNumber,
      },
      rows,
    };
  }

  @Get('top-fragger-overall')
  async topFraggerOverall(
    @Query('matchId') matchId?: string,
    @Query('tournamentId') tournamentId?: string,
    @Query('organizationId') organizationId?: string,
    @Res({ passthrough: true }) res?: Response,
  ) {
    const safeMatchId = matchId?.trim() ? validateMatchId(matchId) : null;
    const scopedMatch = safeMatchId
      ? await this.prisma.match.findFirst({
          where: {
            id: safeMatchId,
            deletedAt: null,
            ...(organizationId ? { organizationId } : {}),
          },
          select: {
            id: true,
            tournamentId: true,
            sessionId: true,
            stageId: true,
            groupId: true,
            organizationId: true,
            tournament: {
              select: {
                id: true,
                name: true,
                shortName: true,
                organizationId: true,
              },
            },
            session: {
              select: {
                id: true,
                name: true,
                organizationId: true,
              },
            },
            stage: { select: { name: true } },
            group: { select: { name: true } },
          },
        })
      : null;

    if (safeMatchId && !scopedMatch) {
      this.setNoCache(res!);
      return {
        data: null,
        players: [],
        meta: {
          matchId: safeMatchId,
          tournamentId: null,
          organizationId: organizationId ?? null,
          tournamentName: null,
          stageName: null,
          groupName: null,
          scope: 'TOURNAMENT' as Scope,
          scopeId: null,
          matchesCount: 0,
          updatedAt: new Date().toISOString(),
          version: Date.now(),
          reasons: ['MATCH_NOT_FOUND'],
        },
      };
    }

    const tid =
      scopedMatch?.tournamentId ??
      (tournamentId?.trim() ? validateTournamentId(tournamentId) : null);
    if (!tid && !scopedMatch?.sessionId && !scopedMatch?.id) {
      throw new BadRequestException({ error: 'INVALID_TOURNAMENT_ID' });
    }
    const scope: Scope = scopedMatch?.groupId
      ? 'GROUP'
      : scopedMatch?.stageId
        ? 'STAGE'
        : tid
          ? 'TOURNAMENT'
          : scopedMatch?.sessionId
            ? 'SESSION'
            : 'MATCH';
    const scopeId =
      scopedMatch?.groupId ??
      scopedMatch?.stageId ??
      tid ??
      scopedMatch?.sessionId ??
      scopedMatch?.id;
    const matchScopeWhere: Prisma.MatchWhereInput = {
      ...(scope === 'TOURNAMENT'
        ? { tournamentId: tid }
        : scope === 'SESSION'
          ? {
              sessionId: scopedMatch?.sessionId ?? null,
              organizationId: scopedMatch?.organizationId ?? organizationId,
            }
          : scope === 'MATCH'
            ? { id: scopedMatch?.id }
            : { tournamentId: tid }),
      deletedAt: null,
      status: { in: MATCH_ACTIVE_OR_FINISHED_STATUSES },
      ...(scopedMatch?.groupId
        ? { groupId: scopedMatch.groupId }
        : scopedMatch?.stageId
          ? { stageId: scopedMatch.stageId }
          : {}),
    };

    const [tournament, session, stage, finishedMatches] = await Promise.all([
      tid
        ? this.prisma.tournament.findFirst({
            where: { id: tid, deletedAt: null },
            select: {
              id: true,
              name: true,
              shortName: true,
              organizationId: true,
            },
          })
        : Promise.resolve(null),
      scopedMatch?.sessionId
        ? this.prisma.session.findFirst({
            where: { id: scopedMatch.sessionId, deletedAt: null },
            select: { id: true, name: true, organizationId: true },
          })
        : Promise.resolve(null),
      tid
        ? this.prisma.stage.findFirst({
            where: { tournamentId: tid, deletedAt: null },
            orderBy: [{ startDate: 'desc' }, { createdAt: 'desc' }],
            select: { name: true },
          })
        : Promise.resolve(null),
      this.prisma.match.findMany({
        where: matchScopeWhere,
        select: { id: true },
      }),
    ]);

    const baseMeta = {
      matchId: safeMatchId,
      tournamentId: tid,
      organizationId:
        tournament?.organizationId ??
        session?.organizationId ??
        scopedMatch?.organizationId ??
        organizationId ??
        null,
      tournamentName:
        tournament?.name ??
        tournament?.shortName ??
        session?.name ??
        scopedMatch?.session?.name ??
        null,
      stageName: scopedMatch?.stage?.name ?? stage?.name ?? null,
      groupName: scopedMatch?.group?.name ?? null,
      scope,
      scopeId,
      matchesCount: finishedMatches.length,
      updatedAt: new Date().toISOString(),
      version: Date.now(),
    };

    if (tid && !tournament) {
      this.setNoCache(res!);
      return {
        data: null,
        meta: { ...baseMeta, reasons: ['TOURNAMENT_NOT_FOUND'] },
      };
    }

    if (!tid && scopedMatch?.sessionId && !session) {
      this.setNoCache(res!);
      return {
        data: null,
        meta: { ...baseMeta, reasons: ['SESSION_NOT_FOUND'] },
      };
    }

    if (
      organizationId &&
      baseMeta.organizationId &&
      baseMeta.organizationId !== organizationId
    ) {
      throw new BadRequestException({ error: 'ORGANIZATION_MISMATCH' });
    }

    if (!finishedMatches.length) {
      this.setNoCache(res!);
      return {
        data: null,
        meta: { ...baseMeta, reasons: ['NO_MATCHES_FINISHED'] },
      };
    }

    const playerRows = await this.prisma.matchSlotPlayerResult.findMany({
      where: {
        slotResult: { match: matchScopeWhere },
      },
      select: {
        playerId: true,
        playerName: true,
        kills: true,
        slotResult: {
          select: {
            matchId: true,
            team: {
              select: {
                id: true,
                tag: true,
                name: true,
                logoUrl: true,
                logoLightUrl: true,
                logoDarkUrl: true,
                accentLight: true,
                accentDark: true,
                textOnLight: true,
                textOnDark: true,
                updatedAt: true,
              },
            },
          },
        },
        player: {
          select: {
            id: true,
            ign: true,
            realName: true,
            photoUrl: true,
            updatedAt: true,
          },
        },
      },
    });

    type Agg = {
      playerId: string | null;
      playerIgn: string;
      photoUrl: string | null;
      teamId: string | null;
      teamTag: string | null;
      teamName: string | null;
      teamLogo: string | null;
      teamColor: string | null;
      kills: number;
      damage: number | null;
      survivalSum: number | null;
      matches: Set<string>;
    };

    const agg = new Map<string, Agg>();

    playerRows.forEach((row, idx) => {
      const key =
        row.playerId ??
        row.player?.id ??
        row.player?.ign ??
        row.playerName ??
        `player-${idx + 1}`;
      const kills = this.toNumber(row.kills, 0) ?? 0;
      const damage = this.toNumber(
        (row as unknown as { damage?: unknown }).damage,
        null,
      );
      const survival = this.toNumber(
        (row as unknown as { survivalTime?: unknown }).survivalTime ??
          (row as unknown as { timeSurvived?: unknown }).timeSurvived ??
          (row as unknown as { time_survived?: unknown }).time_survived,
        null,
      );

      const existing = agg.get(key) ?? {
        playerId: row.playerId ?? row.player?.id ?? null,
        playerIgn: row.player?.ign ?? row.playerName ?? 'Unknown',
        photoUrl:
          resolvePlayerPhotoUrl({
            photoUrl: row.player?.photoUrl ?? null,
            photoUpdatedAt: row.player?.updatedAt ?? null,
            updatedAt: row.player?.updatedAt ?? null,
          }) ?? null,
        teamId: row.slotResult.team?.id ?? null,
        teamTag:
          row.slotResult.team?.tag ??
          row.slotResult.team?.name ??
          DEFAULT_WIDGET_TEAM_TAG,
        teamName:
          row.slotResult.team?.name ??
          row.slotResult.team?.tag ??
          DEFAULT_WIDGET_TEAM_NAME,
        teamLogo: resolveTeamLogoUrl(row.slotResult.team ?? null),
        teamColor:
          row.slotResult.team?.accentDark ??
          row.slotResult.team?.accentLight ??
          null,
        kills: 0,
        damage: null,
        survivalSum: null,
        matches: new Set<string>(),
      };

      existing.kills += kills;
      if (damage !== null) existing.damage = (existing.damage ?? 0) + damage;
      if (survival !== null)
        existing.survivalSum = (existing.survivalSum ?? 0) + survival;
      if (row.slotResult.matchId) existing.matches.add(row.slotResult.matchId);
      agg.set(key, existing);
    });

    const candidates = Array.from(agg.values()).map((p) => {
      const matchesPlayed = p.matches.size;
      const avgKills = matchesPlayed > 0 ? p.kills / matchesPlayed : 0;
      const avgSurvival =
        matchesPlayed > 0 && p.survivalSum !== null
          ? p.survivalSum / matchesPlayed
          : null;
      return {
        playerId: p.playerId,
        playerIgn: p.playerIgn,
        playerPhoto: p.photoUrl,
        teamId: p.teamId,
        teamTag: p.teamTag,
        teamName: p.teamName,
        teamLogo: p.teamLogo,
        teamColor: p.teamColor,
        totalKills: p.kills,
        totalDamage: p.damage,
        matchesPlayed,
        avgKills,
        avgSurvival,
      };
    });

    if (!candidates.length) {
      this.setNoCache(res!);
      return {
        data: null,
        meta: { ...baseMeta, reasons: ['NO_PLAYER_RESULTS'] },
      };
    }

    candidates.sort((a, b) => {
      if (b.totalKills !== a.totalKills) return b.totalKills - a.totalKills;
      const dmgA = a.totalDamage ?? -1;
      const dmgB = b.totalDamage ?? -1;
      if (dmgB !== dmgA) return dmgB - dmgA;
      const survA = a.avgSurvival ?? -1;
      const survB = b.avgSurvival ?? -1;
      if (survB !== survA) return survB - survA;
      return (a.playerIgn ?? '').localeCompare(b.playerIgn ?? '');
    });

    const players = candidates.map((player, index) => ({
      rank: index + 1,
      ...player,
    }));
    const top = players[0] ?? null;

    this.setNoCache(res!);
    return {
      data: top,
      players: players.slice(0, 5),
      meta: { ...baseMeta },
    };
  }

  @Get('group-mvp')
  async groupMvp(
    @Query('matchId') matchId?: string,
    @Query('tournamentId') tournamentId?: string,
    @Query('organizationId') organizationId?: string,
    @Res({ passthrough: true }) res?: Response,
  ) {
    const safeMatchId = matchId?.trim() ? validateMatchId(matchId) : null;
    const scopedMatch = safeMatchId
      ? await this.prisma.match.findFirst({
          where: {
            id: safeMatchId,
            deletedAt: null,
            ...(organizationId ? { organizationId } : {}),
          },
          select: {
            id: true,
            tournamentId: true,
            sessionId: true,
            stageId: true,
            groupId: true,
            organizationId: true,
            status: true,
            tournament: {
              select: {
                id: true,
                name: true,
                shortName: true,
                organizationId: true,
              },
            },
            session: {
              select: {
                id: true,
                name: true,
                organizationId: true,
              },
            },
            stage: { select: { name: true } },
            group: { select: { name: true } },
          },
        })
      : null;

    if (safeMatchId && !scopedMatch) {
      this.setNoCache(res!);
      return {
        finalized: false,
        player: null,
        players: [],
        version: Date.now(),
        show: false,
        matchStatus: null,
        meta: {
          matchId: safeMatchId,
          tournamentId: null,
          organizationId: organizationId ?? null,
          tournamentName: null,
          stageName: null,
          groupName: null,
          scope: 'TOURNAMENT' as Scope,
          scopeId: null,
          matchesCount: 0,
          updatedAt: new Date().toISOString(),
          reasons: ['MATCH_NOT_FOUND'],
        },
      };
    }

    const tid =
      scopedMatch?.tournamentId ??
      (tournamentId?.trim() ? validateTournamentId(tournamentId) : null);
    if (!tid && !scopedMatch?.sessionId && !scopedMatch?.id) {
      throw new BadRequestException({ error: 'INVALID_TOURNAMENT_ID' });
    }
    const scope: Scope = scopedMatch?.groupId
      ? 'GROUP'
      : scopedMatch?.stageId
        ? 'STAGE'
        : tid
          ? 'TOURNAMENT'
          : scopedMatch?.sessionId
            ? 'SESSION'
            : 'MATCH';
    const scopeId =
      scopedMatch?.groupId ??
      scopedMatch?.stageId ??
      tid ??
      scopedMatch?.sessionId ??
      scopedMatch?.id;
    const matchScopeWhere: Prisma.MatchWhereInput = {
      ...(scope === 'TOURNAMENT'
        ? { tournamentId: tid }
        : scope === 'SESSION'
          ? {
              sessionId: scopedMatch?.sessionId ?? null,
              organizationId: scopedMatch?.organizationId ?? organizationId,
            }
          : scope === 'MATCH'
            ? { id: scopedMatch?.id }
            : { tournamentId: tid }),
      deletedAt: null,
      status: { in: MATCH_ACTIVE_OR_FINISHED_STATUSES },
      ...(scopedMatch?.groupId
        ? { groupId: scopedMatch.groupId }
        : scopedMatch?.stageId
          ? { stageId: scopedMatch.stageId }
          : {}),
    };

    const [tournament, session, stage, scopedMatches] = await Promise.all([
      tid
        ? this.prisma.tournament.findFirst({
            where: { id: tid, deletedAt: null },
            select: {
              id: true,
              name: true,
              shortName: true,
              organizationId: true,
            },
          })
        : Promise.resolve(null),
      scopedMatch?.sessionId
        ? this.prisma.session.findFirst({
            where: { id: scopedMatch.sessionId, deletedAt: null },
            select: { id: true, name: true, organizationId: true },
          })
        : Promise.resolve(null),
      tid
        ? this.prisma.stage.findFirst({
            where: { tournamentId: tid, deletedAt: null },
            orderBy: [{ startDate: 'desc' }, { createdAt: 'desc' }],
            select: { name: true },
          })
        : Promise.resolve(null),
      this.prisma.match.findMany({
        where: matchScopeWhere,
        select: { id: true },
      }),
    ]);

    const baseMeta = {
      matchId: safeMatchId,
      tournamentId: tid,
      organizationId:
        tournament?.organizationId ??
        session?.organizationId ??
        scopedMatch?.organizationId ??
        organizationId ??
        null,
      tournamentName:
        tournament?.name ??
        tournament?.shortName ??
        session?.name ??
        scopedMatch?.session?.name ??
        null,
      stageName: scopedMatch?.stage?.name ?? stage?.name ?? null,
      groupName: scopedMatch?.group?.name ?? null,
      scope,
      scopeId,
      matchesCount: scopedMatches.length,
      updatedAt: new Date().toISOString(),
    };

    if (tid && !tournament) {
      this.setNoCache(res!);
      return {
        finalized: false,
        player: null,
        players: [],
        version: Date.now(),
        show: false,
        matchStatus: scopedMatch?.status ?? null,
        meta: { ...baseMeta, reasons: ['TOURNAMENT_NOT_FOUND'] },
      };
    }

    if (!tid && scopedMatch?.sessionId && !session) {
      this.setNoCache(res!);
      return {
        finalized: false,
        player: null,
        players: [],
        version: Date.now(),
        show: false,
        matchStatus: scopedMatch?.status ?? null,
        meta: { ...baseMeta, reasons: ['SESSION_NOT_FOUND'] },
      };
    }

    if (
      organizationId &&
      baseMeta.organizationId &&
      baseMeta.organizationId !== organizationId
    ) {
      throw new BadRequestException({ error: 'ORGANIZATION_MISMATCH' });
    }

    if (!scopedMatches.length) {
      this.setNoCache(res!);
      return {
        finalized: false,
        player: null,
        players: [],
        version: Date.now(),
        show: false,
        matchStatus: scopedMatch?.status ?? null,
        meta: { ...baseMeta, reasons: ['NO_MATCHES_FINISHED'] },
      };
    }

    const playerRows = await this.prisma.matchSlotPlayerResult.findMany({
      where: {
        slotResult: { match: matchScopeWhere },
      },
      select: {
        playerId: true,
        pubgAccountId: true,
        externalPlayerId: true,
        playerName: true,
        kills: true,
        knocks: true,
        assists: true,
        isAlive: true,
        alive: true,
        slotResult: {
          select: {
            matchId: true,
            placement: true,
            team: {
              select: {
                id: true,
                tag: true,
                name: true,
                logoUrl: true,
                logoLightUrl: true,
                logoDarkUrl: true,
                accentLight: true,
                accentDark: true,
                textOnLight: true,
                textOnDark: true,
                updatedAt: true,
              },
            },
          },
        },
        player: {
          select: {
            id: true,
            ign: true,
            realName: true,
            photoUrl: true,
            updatedAt: true,
          },
        },
      },
    });

    type GroupMvpAgg = {
      playerId: string | null;
      ign: string;
      photoUrl: string | null;
      teamId: string | null;
      teamName: string | null;
      teamTag: string | null;
      teamLogo: string | null;
      teamColor: string | null;
      kills: number;
      assists: number;
      activityScore: number;
      bestPlacement: number | null;
      matches: Set<string>;
    };

    const agg = new Map<string, GroupMvpAgg>();

    playerRows.forEach((row, idx) => {
      const key =
        row.playerId ??
        row.player?.id ??
        row.pubgAccountId ??
        row.externalPlayerId ??
        row.player?.ign ??
        row.playerName ??
        `player-${idx + 1}`;
      const kills = row.kills ?? 0;
      const assists = Math.max(0, row.assists ?? 0);
      const placement = row.slotResult.placement ?? null;
      const activityScore = this.scoreMvpPerformance({
        kills,
        assists,
        placement,
        isAlive: row.isAlive ?? row.alive ?? null,
        survivalTime: null,
      });
      const existing = agg.get(key) ?? {
        playerId: row.playerId ?? row.player?.id ?? null,
        ign: row.player?.ign ?? row.playerName ?? 'Unknown',
        photoUrl:
          resolvePlayerPhotoUrl({
            photoUrl: row.player?.photoUrl ?? null,
            photoUpdatedAt: row.player?.updatedAt ?? null,
            updatedAt: row.player?.updatedAt ?? null,
          }) ?? null,
        teamId: row.slotResult.team?.id ?? null,
        teamName:
          row.slotResult.team?.name ??
          row.slotResult.team?.tag ??
          DEFAULT_WIDGET_TEAM_NAME,
        teamTag:
          row.slotResult.team?.tag ??
          row.slotResult.team?.name ??
          DEFAULT_WIDGET_TEAM_TAG,
        teamLogo: resolveTeamLogoUrl(row.slotResult.team ?? null),
        teamColor:
          row.slotResult.team?.accentDark ??
          row.slotResult.team?.accentLight ??
          null,
        kills: 0,
        assists: 0,
        activityScore: 0,
        bestPlacement: null,
        matches: new Set<string>(),
      };

      existing.kills += kills;
      existing.assists += assists;
      existing.activityScore += activityScore;
      if (
        placement !== null &&
        (existing.bestPlacement === null || placement < existing.bestPlacement)
      ) {
        existing.bestPlacement = placement;
      }
      if (row.slotResult.matchId) existing.matches.add(row.slotResult.matchId);
      agg.set(key, existing);
    });

    const candidates = Array.from(agg.values()).map((player) => {
      const matchesPlayed = player.matches.size;
      const avgKills = matchesPlayed > 0 ? player.kills / matchesPlayed : 0;
      const mvpScore = player.activityScore;
      return {
        playerId: player.playerId,
        ign: player.ign,
        photoUrl: player.photoUrl,
        teamId: player.teamId,
        teamName: player.teamName,
        teamTag: player.teamTag,
        teamLogo: player.teamLogo,
        teamColor: player.teamColor,
        kills: player.kills,
        assists: player.assists,
        placement: player.bestPlacement,
        survivalTime: null,
        mvpScore,
        matchesPlayed,
        avgKills,
      };
    });

    if (!candidates.length) {
      this.setNoCache(res!);
      return {
        finalized: false,
        player: null,
        players: [],
        version: Date.now(),
        show: false,
        matchStatus: scopedMatch?.status ?? null,
        meta: { ...baseMeta, reasons: ['NO_PLAYER_RESULTS'] },
      };
    }

    candidates.sort((a, b) => {
      if (b.mvpScore !== a.mvpScore) return b.mvpScore - a.mvpScore;
      if (b.kills !== a.kills) return b.kills - a.kills;
      if (b.assists !== a.assists) return b.assists - a.assists;
      const aPlacement = a.placement ?? Number.MAX_SAFE_INTEGER;
      const bPlacement = b.placement ?? Number.MAX_SAFE_INTEGER;
      if (aPlacement !== bPlacement) return aPlacement - bPlacement;
      return a.ign.localeCompare(b.ign);
    });

    const players = candidates.map((player, index) => ({
      rank: index + 1,
      ...player,
    }));

    this.setNoCache(res!);
    return {
      finalized: true,
      player: players[0] ?? null,
      players: players.slice(0, 5),
      version: Date.now(),
      show: true,
      matchStatus: scopedMatch?.status ?? null,
      meta: { ...baseMeta },
    };
  }

  @Get('top-fragger-top-5')
  async topFraggerTopFive(
    @Query('matchId') matchId?: string,
    @Query('organizationId') organizationId?: string,
  ) {
    const safeMatchId = validateMatchId(matchId);
    await requireMatchOrganization(this.prisma, safeMatchId, {
      organizationId: organizationId ?? null,
    });
    const players = await this.topFraggers.topFive(safeMatchId);

    return {
      version: 'v1',
      matchId: safeMatchId,
      players,
      updatedAt: new Date().toISOString(),
    };
  }

  @Get('current')
  async current(@Res({ passthrough: true }) res?: Response) {
    this.setNoCache(res!);
    const envMatch = process.env.ACTIVE_MATCH_ID;
    if (envMatch) {
      const envRecord = await this.prisma.match.findFirst({
        where: { id: envMatch, deletedAt: null },
        select: {
          id: true,
          tournamentId: true,
          status: true,
          dataSource: true,
          dataMode: true,
        },
      });
      if (envRecord) {
        return this.wrapWidgetResponse(
          res!,
          {
            matchId: envRecord.id,
            tournamentId: envRecord.tournamentId,
            status: envRecord.status,
          },
          {
            updatedAt: new Date().toISOString(),
            matchId: envRecord.id,
            tournamentId: envRecord.tournamentId,
            dataSource: envRecord.dataSource ?? envRecord.dataMode ?? null,
            controlState: envRecord.status ?? null,
          },
        );
      }
    }

    const live = await this.prisma.match.findFirst({
      where: { status: 'LIVE', deletedAt: null },
      orderBy: { startedAt: 'desc' },
      select: {
        id: true,
        tournamentId: true,
        status: true,
        dataSource: true,
        dataMode: true,
      },
    });

    if (!live) {
      throw new NotFoundException({ error: 'NO_LIVE_MATCH' });
    }

    return this.wrapWidgetResponse(
      res!,
      {
        matchId: live.id,
        tournamentId: live.tournamentId,
        status: live.status,
      },
      {
        updatedAt: new Date().toISOString(),
        matchId: live.id,
        tournamentId: live.tournamentId,
        dataSource: live.dataSource ?? live.dataMode ?? null,
        controlState: live.status ?? null,
      },
    );
  }

  @Get('scoreboard')
  async scoreboard(
    @Query('matchId') matchId?: string,
    @Query('autoInit') autoInit?: string,
    @Res({ passthrough: true }) res?: Response,
  ) {
    const id = validateMatchId(matchId);
    await this.ensureMatchExists(id);
    await this.ensureMatchFresh(id);

    const branding = await this.resolveBrandingForMatch(id);
    const brandMode = branding.mode;

    const snapshot = await buildWidgetScoreboardSnapshot(this.prisma, id, {
      includeLogos: true,
      brandMode,
    });

    void autoInit;

    return this.wrapWidgetResponse(res!, snapshot, {
      updatedAt: snapshot.state.lastUpdateIso,
      matchId: snapshot.state.matchId,
      tournamentId: snapshot.state.tournamentId,
      dataSource: snapshot.state.dataSource,
      controlState: snapshot.state.controlState,
      aliveTeams: snapshot.state.aliveTeams ?? null,
      resultFinalized: snapshot.state.resultFinalized ?? null,
      finalizedAt: snapshot.state.finalizedAt ?? null,
      winnerTeamId: snapshot.state.winnerTeamId ?? null,
      branding,
    });
  }

  @Get('diagnostics')
  async diagnostics(
    @Query('matchId') matchId?: string,
    @Res({ passthrough: true }) res?: Response,
  ) {
    const id = validateMatchId(matchId);
    await this.ensureMatchExists(id);
    await this.ensureMatchFresh(id);

    const branding = await this.resolveBrandingForMatch(id);
    const brandMode = branding.mode;
    const snapshot = await buildWidgetScoreboardSnapshot(this.prisma, id, {
      includeLogos: false,
      brandMode,
    });

    const hasSlots = snapshot.state.hasSlots;
    const hasSlotResults = snapshot.state.hasSlotResults;
    const hasPlayerResults = snapshot.state.hasPlayerResults;
    const resultsLockOk = !snapshot.state.resultsLocked;

    const checks = [
      { key: 'MATCH_FOUND', ok: true, detail: 'Match exists' },
      {
        key: 'HAS_SLOTS',
        ok: hasSlots,
        detail: hasSlots ? 'Slots present' : 'No slots found',
      },
      {
        key: 'HAS_SLOT_RESULTS',
        ok: hasSlotResults,
        detail: hasSlotResults
          ? 'Slot results present'
          : 'Slot results missing',
      },
      {
        key: 'HAS_PLAYER_RESULTS',
        ok: hasPlayerResults,
        detail: hasPlayerResults
          ? 'Player results present'
          : 'Player results missing',
      },
      {
        key: 'RESULTS_LOCK_OK',
        ok: resultsLockOk,
        detail: resultsLockOk ? 'Not locked' : 'Results locked',
      },
    ];

    const derivedReasons: string[] = [];
    if (!hasSlots) derivedReasons.push('NO_SLOTS');
    if (!hasSlotResults) derivedReasons.push('NO_SLOT_RESULTS');
    if (!hasPlayerResults) derivedReasons.push('NO_PLAYER_RESULTS');
    if (!resultsLockOk) derivedReasons.push('RESULTS_LOCKED');

    const payload = {
      version: 'v1',
      matchId: id,
      ok: hasSlots && hasSlotResults,
      checks,
      reasons: [...(snapshot.state.reasons ?? []), ...derivedReasons],
    };

    return this.wrapWidgetResponse(res!, payload, {
      updatedAt: snapshot.state.lastUpdateIso,
      matchId: snapshot.state.matchId,
      tournamentId: snapshot.state.tournamentId,
      dataSource: snapshot.state.dataSource,
      controlState: snapshot.state.controlState,
      branding,
    });
  }

  @Get('state')
  async state(
    @Query('matchId') matchId?: string,
    @Query('tournamentId') tournamentId?: string,
    @Res({ passthrough: true }) res?: Response,
  ) {
    if (tournamentId) {
      const tid = validateTournamentId(tournamentId);
      const standings = await this.standings.computeStandings({
        scope: 'TOURNAMENT',
        scopeId: tid,
      });
      void this.live.setLatestStandings(tid, standings);
      this.setNoCache(res!);
      const versionHash = computeWidgetVersion(standings);
      const versionRaw = Number.parseInt(versionHash.slice(0, 12), 16);
      const version = Number.isFinite(versionRaw) ? versionRaw : Date.now();
      const updatedAt = standings?.computedAt ?? new Date().toISOString();
      return {
        tournamentId: tid,
        version,
        updatedAt,
      };
    }

    if (!matchId) {
      throw new BadRequestException({
        error: 'matchId or tournamentId is required',
      });
    }

    const id = validateMatchId(matchId);
    this.setNoCache(res!);
    try {
      await this.ensureMatchFresh(id);
      const state = await this.resultsService.getWidgetStatePublic(id);
      const updatedAt = state.lastUpdateIso ?? new Date().toISOString();
      const version = state.lastUpdateIso
        ? Date.parse(state.lastUpdateIso)
        : Date.now();
      return {
        matchId: id,
        version,
        updatedAt,
        lockState: {
          locked: state.resultsLocked,
          reason: state.reasons?.[0] ?? null,
        },
      };
    } catch (err: unknown) {
      const reason =
        err instanceof Error ? err.message : 'STATE_REFRESH_FAILED';
      const updatedAt = new Date().toISOString();
      return {
        matchId: id,
        version: Date.now(),
        updatedAt,
        lockState: {
          locked: false,
          reason,
        },
      };
    }
  }

  @Get('lower-third/tournament')
  async lowerThirdTournament(
    @Query('matchId') matchId?: string,
    @Res({ passthrough: true }) res?: Response,
  ) {
    const id = validateMatchId(matchId);
    const match = await this.prisma.match.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        name: true,
        matchNumber: true,
        map: true,
        status: true,
        controlState: true,
        tournament: {
          select: {
            id: true,
            name: true,
            shortName: true,
            bannerUrl: true,
          },
        },
        session: {
          select: {
            id: true,
            name: true,
            logoUrl: true,
            bannerUrl: true,
          },
        },
      },
    });

    if (!match) {
      throw new NotFoundException({ error: 'MATCH_NOT_FOUND' });
    }

    const matchLabel = (() => {
      const number =
        typeof match.matchNumber === 'number' &&
        Number.isFinite(match.matchNumber)
          ? `MATCH ${match.matchNumber.toString().padStart(2, '0')}`
          : null;
      const map = match.map ? String(match.map).replace(/_/g, ' ') : null;
      if (number && map) return `${number} · ${map}`;
      return number ?? map ?? match.name ?? 'MATCH';
    })();

    const sponsors = match.session?.id
      ? await this.prisma.sessionSponsor.findMany({
          where: {
            sessionId: match.session.id,
            isActive: true,
            deletedAt: null,
          },
          orderBy: [
            { tier: 'asc' },
            { displayOrder: 'asc' },
            { createdAt: 'asc' },
          ],
          select: { name: true, logoUrl: true, tier: true, displayOrder: true },
        })
      : await this.prisma.tournamentSponsor.findMany({
          where: {
            tournamentId: match.tournament?.id,
            isActive: true,
            deletedAt: null,
          },
          orderBy: [
            { tier: 'asc' },
            { displayOrder: 'asc' },
            { createdAt: 'asc' },
          ],
          select: { name: true, logoUrl: true, tier: true, displayOrder: true },
        });

    const payload = {
      tournament: {
        name: match.session?.name ?? match.tournament?.name ?? 'TOURNAMENT',
        logoUrl:
          match.session?.bannerUrl ??
          match.session?.logoUrl ??
          match.tournament?.bannerUrl ??
          null,
      },
      match: {
        id: match.id,
        label: matchLabel,
        name: matchLabel,
      },
      sponsor: null as { name: string; logoUrl: string | null } | null,
      sponsors,
    };

    if (sponsors[0]) {
      payload.sponsor = {
        name: sponsors[0].name,
        logoUrl: sponsors[0].logoUrl,
      };
    }

    this.setNoCache(res!);
    return payload;
  }

  // Alias used by OBS widget: supports either matchId or tournamentId alone
  @Get('tournament-lower-third')
  async tournamentLowerThird(
    @Query('matchId') matchId?: string,
    @Query('tournamentId') tournamentId?: string,
    @Res({ passthrough: true }) res?: Response,
  ) {
    if (matchId) {
      return this.lowerThirdTournament(matchId, res);
    }

    if (!tournamentId) {
      throw new BadRequestException({
        error: 'INVALID_MATCH_OR_TOURNAMENT_ID',
      });
    }

    const tid = validateTournamentId(tournamentId);
    const tournament = await this.prisma.tournament.findFirst({
      where: { id: tid, deletedAt: null },
      select: { id: true, name: true, shortName: true, bannerUrl: true },
    });
    if (!tournament) {
      throw new NotFoundException({ error: 'TOURNAMENT_NOT_FOUND' });
    }

    // try to find a LIVE match for this tournament, otherwise latest
    const match =
      (await this.prisma.match.findFirst({
        where: { tournamentId: tid, deletedAt: null, status: 'LIVE' },
        orderBy: [{ startedAt: 'desc' }, { createdAt: 'desc' }],
        select: {
          id: true,
          name: true,
          matchNumber: true,
          map: true,
        },
      })) ??
      (await this.prisma.match.findFirst({
        where: { tournamentId: tid, deletedAt: null },
        orderBy: [{ startedAt: 'desc' }, { createdAt: 'desc' }],
        select: {
          id: true,
          name: true,
          matchNumber: true,
          map: true,
        },
      }));

    const matchLabel = (() => {
      if (!match) return 'MATCH';
      const number =
        typeof match.matchNumber === 'number' &&
        Number.isFinite(match.matchNumber)
          ? `MATCH ${match.matchNumber.toString().padStart(2, '0')}`
          : null;
      const map = match.map ? String(match.map).replace(/_/g, ' ') : null;
      if (number && map) return `${number} · ${map}`;
      return number ?? map ?? match.name ?? 'MATCH';
    })();

    const sponsors = await this.prisma.tournamentSponsor.findMany({
      where: {
        tournamentId: tid,
        isActive: true,
        deletedAt: null,
      },
      orderBy: [{ tier: 'asc' }, { displayOrder: 'asc' }, { createdAt: 'asc' }],
      select: { name: true, logoUrl: true, tier: true, displayOrder: true },
    });

    const payload = {
      tournament: {
        name: tournament.shortName ?? tournament.name ?? 'TOURNAMENT',
        logoUrl: tournament.bannerUrl ?? null,
      },
      match: {
        id: match?.id ?? null,
        label: matchLabel,
        name: matchLabel,
      },
      sponsor: null as { name: string; logoUrl: string | null } | null,
      sponsors,
    };

    if (sponsors[0]) {
      payload.sponsor = {
        name: sponsors[0].name,
        logoUrl: sponsors[0].logoUrl,
      };
    }

    this.setNoCache(res!);
    return payload;
  }

  @Get(':organizationSlug/:widgetKey')
  async permanentWidget(
    @Param('organizationSlug') organizationSlug: string,
    @Param('widgetKey') widgetKey: string,
  ) {
    return this.widgetInstances.resolveInstanceByOrganizationSlug(
      organizationSlug,
      widgetKey,
    );
  }

  private classifyKillCause(
    payload: unknown,
    rawPayload?: unknown,
  ): 'grenade' | 'vehicle' | null {
    const records = [payload, rawPayload].filter(
      (value): value is Record<string, unknown> =>
        Boolean(value) && typeof value === 'object' && !Array.isArray(value),
    );
    if (!records.length) return null;

    const itemIds = records
      .flatMap((rec) => [
        rec.itemId,
        rec.ItemId,
        rec.itemID,
        rec.ItemID,
        rec.weaponId,
        rec.WeaponId,
        rec.damageCauserItemId,
        rec.DamageCauserItemId,
      ])
      .map((v) =>
        typeof v === 'string' || typeof v === 'number' ? String(v).trim() : '',
      )
      .filter(Boolean);

    if (itemIds.some((itemId) => /^190\d+$/i.test(itemId))) {
      return 'vehicle';
    }
    if (itemIds.some((itemId) => itemId === '602004' || itemId === '602003')) {
      return 'grenade';
    }

    const raw = records
      .flatMap((rec) => [
        rec.damageCauserName,
        rec.DamageCauserName,
        rec.damageCauser,
        rec.DamageCauser,
        rec.damageTypeCategory,
        rec.DamageTypeCategory,
        rec.damageReason,
        rec.DamageReason,
        rec.weapon,
        rec.Weapon,
        rec.cause,
        rec.Cause,
        rec.killCause,
        rec.KillCause,
        rec.killType,
        rec.KillType,
      ])
      .map((v) => (typeof v === 'string' ? v.toLowerCase() : ''))
      .filter(Boolean)
      .join(' ');
    const isGrenadeFlag =
      records.some(
        (rec) => rec.isGrenadeKill === true || rec.grenade === true,
      ) ||
      raw.includes('grenade') ||
      raw.includes('molotov') ||
      raw.includes('frag') ||
      raw.includes('bomb') ||
      raw.includes('c4');
    const isVehicleFlag =
      records.some(
        (rec) => rec.isVehicleKill === true || rec.vehicle === true,
      ) ||
      raw.includes('vehicle') ||
      raw.includes('buggy') ||
      raw.includes('bike') ||
      raw.includes('car') ||
      raw.includes('truck') ||
      raw.includes('bus') ||
      raw.includes('uaz');
    if (isGrenadeFlag) return 'grenade';
    if (isVehicleFlag) return 'vehicle';
    return null;
  }

  private extractKiller(
    payload: unknown,
    rawPayload?: unknown,
  ): {
    player?: string | null;
    team?: string | null;
  } {
    const rec =
      (payload && typeof payload === 'object'
        ? (payload as Record<string, unknown>)
        : null) ??
      (rawPayload && typeof rawPayload === 'object'
        ? (rawPayload as Record<string, unknown>)
        : null);
    if (!rec) return {};
    const killer = (rec.killer ?? rec.Killer) as Record<string, unknown> | null;
    const player =
      this.asString(
        rec.killerName ??
          rec.KillerName ??
          killer?.playerName ??
          killer?.name ??
          killer?.player ??
          killer?.CharacterName,
      ) ?? null;
    const team =
      this.asString(
        rec.killerTeamId ??
          rec.KillerTeamId ??
          rec.killerTeamID ??
          rec.teamId ??
          rec.TeamId ??
          killer?.teamId ??
          killer?.TeamId,
      ) ?? null;
    return { player, team };
  }

  private tallyKillCauses(
    events: Array<{ payload: unknown; rawPayload?: unknown }>,
  ): {
    grenadeTotal: number | null;
    vehicleTotal: number | null;
    grenadeLeaders: Map<string, number>;
    vehicleLeaders: Map<string, number>;
  } {
    const grenadeLeaders = new Map<string, number>();
    const vehicleLeaders = new Map<string, number>();
    let grenadeTotal = 0;
    let vehicleTotal = 0;

    events.forEach((evt) => {
      const cause = this.classifyKillCause(evt.payload, evt.rawPayload);
      if (!cause) return;
      const killer = this.extractKiller(evt.payload, evt.rawPayload);
      const key = killer.player ?? killer.team ?? 'Unknown';
      const target = cause === 'grenade' ? grenadeLeaders : vehicleLeaders;
      target.set(key, (target.get(key) ?? 0) + 1);
      if (cause === 'grenade') grenadeTotal += 1;
      if (cause === 'vehicle') vehicleTotal += 1;
    });

    return {
      grenadeTotal: events.length > 0 ? grenadeTotal : null,
      vehicleTotal: events.length > 0 ? vehicleTotal : null,
      grenadeLeaders,
      vehicleLeaders,
    };
  }

  private async buildMatchSummaryAggregate(params: {
    matchId: string;
    startedAt: Date | null;
    endedAt: Date | null;
    snapshot: Awaited<ReturnType<typeof buildWidgetScoreboardSnapshot>>;
    slotResults: Awaited<ReturnType<ResultsService['listSlotResultsPublic']>>;
    liveState: Awaited<ReturnType<MatchControlStateStore['get']>> | null;
    telemetryPayload: unknown;
  }): Promise<{
    stats: MatchResultSummaryStats;
    highlights: MatchResultSummaryHighlight[];
  }> {
    const {
      matchId,
      startedAt,
      endedAt,
      snapshot,
      slotResults,
      liveState,
      telemetryPayload,
    } = params;

    type TeamForStats = {
      slot: number | null;
      kills: number;
      tag?: string | null;
      name?: string | null;
    };

    const scoreboardTeams: TeamForStats[] =
      snapshot.rows?.map((row, idx) => ({
        tag: row.teamTag ?? DEFAULT_WIDGET_TEAM_TAG,
        name: row.teamName ?? DEFAULT_WIDGET_TEAM_NAME,
        slot: row.slot ?? idx + 1,
        kills: row.totalKills ?? 0,
      })) ?? [];

    const liveTeams: TeamForStats[] | null =
      liveState?.teams?.map((team) => ({
        tag: team.tag,
        name: team.name,
        slot: team.slot,
        kills: this.toNumber((team as { kills?: unknown }).kills, 0) ?? 0,
      })) ?? null;

    const teamsForStats: TeamForStats[] =
      liveTeams && liveTeams.length > 0 ? liveTeams : scoreboardTeams;

    const totalTeams =
      liveTeams?.length ??
      snapshot.rows?.length ??
      slotResults?.length ??
      (scoreboardTeams.length || null);

    const totalKills = teamsForStats.reduce((sum, t) => sum + t.kills, 0);
    const telemetryStats =
      extractMatchResultSummaryTelemetryStats(telemetryPayload);

    let totalKnocks: number | null = null;
    let totalAssists: number | null = null;
    let totalDamage: number | null = null;

    if (slotResults?.length) {
      let knocksSum = 0;
      let assistsSum = 0;
      let damageSum = 0;
      let hasKnocks = false;
      let hasAssists = false;
      let hasDamage = false;
      slotResults.forEach((sr) => {
        (sr.players ?? []).forEach((p) => {
          const knocksVal = this.toNumber((p as { knocks?: unknown }).knocks);
          if (knocksVal !== null && knocksVal !== undefined) {
            knocksSum += knocksVal;
            hasKnocks = true;
          }
          const assistsVal = this.toNumber(
            (p as { assists?: unknown }).assists,
          );
          if (assistsVal !== null && assistsVal !== undefined) {
            assistsSum += assistsVal;
            hasAssists = true;
          }
          const dmg =
            this.toNumber((p as { damage?: unknown }).damage) ??
            this.toNumber((p as { dmg?: unknown }).dmg) ??
            this.toNumber((p as { totalDamage?: unknown }).totalDamage) ??
            this.toNumber((p as { damageDealt?: unknown }).damageDealt);
          if (dmg !== null && dmg !== undefined) {
            damageSum += dmg;
            hasDamage = true;
          }
        });
      });
      totalKnocks = hasKnocks ? knocksSum : null;
      totalAssists = hasAssists ? assistsSum : null;
      totalDamage = hasDamage ? damageSum : null;
      totalKnocks = normalizeFallbackSummaryMetric(totalKnocks, {
        totalKills,
        totalDamage,
        relatedMetric: totalAssists,
      });
      totalAssists = normalizeFallbackSummaryMetric(totalAssists, {
        totalKills,
        totalDamage,
        relatedMetric: totalKnocks,
      });
    }

    const matchDurationSeconds =
      startedAt instanceof Date
        ? Math.max(
            0,
            Math.round(
              ((endedAt ?? new Date()).getTime() - startedAt.getTime()) / 1000,
            ),
          )
        : null;

    const killEvents = await this.prisma.matchEvent.findMany({
      where: { matchId, type: MatchEventType.KILL },
      select: { payload: true, rawPayload: true },
    });

    const { grenadeTotal, vehicleTotal, grenadeLeaders, vehicleLeaders } =
      this.tallyKillCauses(killEvents);

    const stats: MatchResultSummaryStats = {
      totalKills,
      totalKnocks: telemetryStats.totalKnocks ?? totalKnocks,
      totalDamage: telemetryStats.totalDamage ?? totalDamage,
      totalAssists: telemetryStats.totalAssists ?? totalAssists,
      grenadeKills: telemetryStats.grenadeKills ?? grenadeTotal,
      vehicleKills: telemetryStats.vehicleKills ?? vehicleTotal,
      matchDurationSeconds,
      totalTeams: this.toNumber(totalTeams) ?? null,
    };

    const highlights: MatchResultSummaryHighlight[] = [];
    const push = (h: MatchResultSummaryHighlight | null) => {
      if (h && highlights.length < 3) highlights.push(h);
    };

    const topTeam =
      teamsForStats
        .map((t) => ({
          name: t.tag ?? t.name ?? DEFAULT_WIDGET_TEAM_NAME,
          kills: t.kills,
        }))
        .filter((t) => t.kills > 0)
        .sort((a, b) => b.kills - a.kills)[0] ?? null;

    push(
      topTeam
        ? {
            title: 'Most Aggressive Team',
            name: topTeam.name,
            value: topTeam.kills,
            kind: 'team',
            detail: 'Kills',
          }
        : null,
    );

    const topPlayer =
      (slotResults ?? [])
        .flatMap((sr) => sr.players ?? [])
        .map((p) => ({
          name:
            (p as { playerName?: string | null }).playerName ??
            (p as { name?: string | null }).name ??
            (p as { playerId?: string | null }).playerId ??
            'Player',
          kills: this.toNumber((p as { kills?: unknown }).kills, 0) ?? 0,
        }))
        .filter((p) => p.kills > 0)
        .sort((a, b) => b.kills - a.kills)[0] ?? null;

    push(
      topPlayer
        ? {
            title: 'Deadliest Player',
            name: topPlayer.name,
            value: topPlayer.kills,
            kind: 'player',
            detail: 'Kills',
          }
        : null,
    );

    const topGrenade =
      Array.from(grenadeLeaders.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([name, value]) => ({ name, value }))
        .find((g) => g.value > 0) ?? null;

    push(
      topGrenade
        ? {
            title: 'Grenade King',
            name: topGrenade.name,
            value: topGrenade.value,
            kind: 'player',
            detail: 'Grenade Kills',
          }
        : null,
    );

    const topVehicle =
      Array.from(vehicleLeaders.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([name, value]) => ({ name, value }))
        .find((v) => v.value > 0) ?? null;

    push(
      topVehicle
        ? {
            title: 'Road Rage',
            name: topVehicle.name,
            value: topVehicle.value,
            kind: 'player',
            detail: 'Vehicle Kills',
          }
        : null,
    );

    return { stats, highlights };
  }

  private asString(val: unknown): string | null {
    if (typeof val === 'string') return val;
    if (typeof val === 'number' || typeof val === 'boolean') return String(val);
    return null;
  }

  private toNumber(val: unknown, fallback?: number | null): number | null {
    if (typeof val === 'number' && Number.isFinite(val)) return val;
    if (typeof val === 'string') {
      const parsed = Number(val);
      return Number.isFinite(parsed) ? parsed : (fallback ?? null);
    }
    if (fallback !== undefined) return fallback;
    return null;
  }
}
