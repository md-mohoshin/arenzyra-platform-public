import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import { GameKey, MatchStatus, type Prisma } from '@prisma/client';
import { PrismaService } from '../db/prisma.service';
import { RealtimeGateway } from './realtime.gateway';
import { compareRankingRows } from '../common/ranking-tiebreakers.util';
import { derivePresenceStatus } from '../common/results-presence.util';
import {
  aggregatePointDeltaForScope,
  applyMatchScoreAdjustments,
  type ScoreAdjustmentMatchContext,
  type ScoreAdjustmentRecord,
} from '../common/admin-adjustments.util';
import {
  LiveRankingPayload,
  LiveRankingTeam,
  OverallRankingPayload,
  OverallRankingTeam,
} from './ranking.types';
import {
  resolvePlacementPoints,
  computeKillPoints,
} from '../modules/scoring/points-core';
import { MATCH_ACTIVE_OR_FINISHED_STATUSES } from '../common/match-status.util';
import {
  defaultKillPointsForGame,
  defaultPlacementPointsForGame,
} from '../common/game-rules.util';

const DEFAULT_WIDGET_TEAM_NAME = 'Arenzyra';
const DEFAULT_WIDGET_TEAM_TAG = 'AZ';

type RuleConfig = {
  placementPoints: Record<number, number>;
  killPoints: number;
};

type MatchContext = {
  id: string;
  tournamentId: string | null;
  organizationId: string | null;
  status: MatchStatus;
  game?: { key: GameKey } | null;
  ruleset?: { config: unknown; gameKey?: GameKey | null } | null;
  tournament?: {
    organizationId: string | null;
    rulesetId: string | null;
    ruleset: unknown;
    game: GameKey;
  } | null;
  matchSlots: Array<{
    slotNumber: number;
    teamId: string | null;
    team: {
      id: string;
      name: string | null;
      tag: string | null;
      logoUrl: string | null;
    } | null;
  }>;
  matchTeams: Array<{
    slot: number | null;
    teamId: string;
    team: {
      id: string;
      name: string | null;
      tag: string | null;
      logoUrl: string | null;
    } | null;
  }>;
};

@Injectable()
export class RankingEmitterService {
  private readonly logger = new Logger('RankingEmitterService');
  private readonly minIntervalMs = 500; // 2 emits / sec
  private readonly maxTeams = 25;
  private liveThrottle = new Map<string, number>();
  private overallThrottle = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => RealtimeGateway))
    private readonly realtime: RealtimeGateway,
  ) {}

  private shouldThrottle(map: Map<string, number>, key: string, force = false) {
    if (force) return false;
    const now = Date.now();
    const last = map.get(key) ?? 0;
    if (now - last < this.minIntervalMs) return true;
    map.set(key, now);
    return false;
  }

  private defaultRules(game?: GameKey | null): RuleConfig {
    return {
      placementPoints: defaultPlacementPointsForGame(game),
      killPoints: defaultKillPointsForGame(game),
    };
  }

  private normalizePlacementTable(
    value: unknown,
    fallback: Record<number, number>,
  ): Record<number, number> {
    if (!value || typeof value !== 'object') return fallback;
    return Object.entries(value as Record<string, unknown>).reduce(
      (acc, [k, v]) => {
        const numKey = Number(k);
        if (Number.isInteger(numKey) && typeof v === 'number') {
          acc[numKey] = v;
        }
        return acc;
      },
      {} as Record<number, number>,
    );
  }

  private placementPoints(
    placement: number | null | undefined,
    table: Record<number, number>,
  ): number {
    return resolvePlacementPoints(
      placement ?? null,
      table ?? ({} as Record<number, number>),
    );
  }

  private normalizeKillPoints(value: unknown, fallback: number): number {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    return fallback;
  }

  private resolveMatchGameKey(match: MatchContext): GameKey | null {
    return (
      match.ruleset?.gameKey ??
      match.game?.key ??
      match.tournament?.game ??
      null
    );
  }

  private async resolveRuleConfig(match: MatchContext): Promise<RuleConfig> {
    const base = this.defaultRules(this.resolveMatchGameKey(match));
    const fromMatch = match.ruleset?.config as
      | Partial<RuleConfig>
      | undefined
      | null;
    if (fromMatch) {
      return {
        placementPoints: this.normalizePlacementTable(
          (fromMatch as Record<string, unknown>)?.placementPoints,
          base.placementPoints,
        ),
        killPoints: this.normalizeKillPoints(
          (fromMatch as Record<string, unknown>)?.killPoints,
          base.killPoints,
        ),
      };
    }

    if (match.tournament?.rulesetId) {
      const rs = await this.prisma.ruleset.findUnique({
        where: { id: match.tournament.rulesetId },
        select: { config: true, gameKey: true },
      });
      if (rs?.config) {
        return {
          placementPoints: this.normalizePlacementTable(
            (rs.config as Record<string, unknown>)?.placementPoints,
            base.placementPoints,
          ),
          killPoints: this.normalizeKillPoints(
            (rs.config as Record<string, unknown>)?.killPoints,
            base.killPoints,
          ),
        };
      }
    }

    if (match.tournament?.ruleset) {
      const cfg = match.tournament.ruleset as Record<string, unknown>;
      return {
        placementPoints: this.normalizePlacementTable(
          cfg?.placementPoints,
          base.placementPoints,
        ),
        killPoints: this.normalizeKillPoints(cfg?.killPoints, base.killPoints),
      };
    }

    return base;
  }

  private firstNonNull<T>(...values: Array<T | null | undefined>): T | null {
    for (const v of values) {
      if (v !== null && v !== undefined) return v;
    }
    return null;
  }

  private toTeamName(
    team: { name: string | null; tag: string | null } | null | undefined,
    fallback: string,
  ): string {
    return team?.name ?? team?.tag ?? fallback;
  }

  async emitLiveRanking(
    matchId: string,
    opts: {
      force?: boolean;
      requester?: { emit: (event: string, payload: any) => void } | null;
    } = {},
  ): Promise<LiveRankingPayload | null> {
    if (this.shouldThrottle(this.liveThrottle, matchId, opts.force ?? false)) {
      return null;
    }
    try {
      const match = await this.prisma.match.findFirst({
        where: { id: matchId, deletedAt: null },
        select: {
          id: true,
          tournamentId: true,
          stageId: true,
          groupId: true,
          sessionId: true,
          organizationId: true,
          status: true,
          game: { select: { key: true } },
          ruleset: { select: { config: true, gameKey: true } },
          tournament: {
            select: {
              organizationId: true,
              rulesetId: true,
              ruleset: true,
              game: true,
            },
          },
          matchSlots: {
            where: { deletedAt: null, teamId: { not: null } },
            select: {
              slotNumber: true,
              teamId: true,
              team: {
                select: { id: true, name: true, tag: true, logoUrl: true },
              },
            },
          },
          matchTeams: {
            where: { deletedAt: null },
            select: {
              slot: true,
              teamId: true,
              team: {
                select: { id: true, name: true, tag: true, logoUrl: true },
              },
            },
          },
        },
      });
      if (!match) return null;

      const orgId =
        match.organizationId ?? match.tournament?.organizationId ?? null;
      const ruleConfig = await this.resolveRuleConfig(match as MatchContext);
      const placementTable = ruleConfig.placementPoints ?? {};
      const killPointValue =
        typeof ruleConfig.killPoints === 'number' ? ruleConfig.killPoints : 1;

      const teamMeta = new Map<
        string,
        {
          name: string;
          tag: string | null;
          logoUrl: string | null;
          slot: number | null;
        }
      >();
      match.matchSlots.forEach((slot) => {
        if (!slot.teamId) return;
        teamMeta.set(slot.teamId, {
          name: this.toTeamName(slot.team, DEFAULT_WIDGET_TEAM_NAME),
          tag: slot.team?.tag ?? DEFAULT_WIDGET_TEAM_TAG,
          logoUrl: slot.team?.logoUrl ?? null,
          slot: slot.slotNumber ?? null,
        });
      });
      match.matchTeams.forEach((mt) => {
        if (!mt.teamId) return;
        if (teamMeta.has(mt.teamId)) return;
        teamMeta.set(mt.teamId, {
          name: this.toTeamName(mt.team, DEFAULT_WIDGET_TEAM_NAME),
          tag: mt.team?.tag ?? DEFAULT_WIDGET_TEAM_TAG,
          logoUrl: mt.team?.logoUrl ?? null,
          slot: mt.slot ?? null,
        });
      });

      const slotResults = await this.prisma.matchSlotResult.findMany({
        where: {
          matchId,
          wasPresentInMatch: true,
          ...(orgId ? { organizationId: orgId } : {}),
        },
        select: {
          teamId: true,
          slotNumber: true,
          placement: true,
          totalKills: true,
          placementPoints: true,
          totalPoints: true,
          team: { select: { id: true, name: true, tag: true, logoUrl: true } },
        },
      });
      const slotResultMap = new Map(
        slotResults
          .filter((sr) => sr.teamId)
          .map((sr) => [sr.teamId as string, sr]),
      );
      slotResults.forEach((sr) => {
        if (!sr.teamId || teamMeta.has(sr.teamId)) return;
        teamMeta.set(sr.teamId, {
          name: this.toTeamName(sr.team, DEFAULT_WIDGET_TEAM_NAME),
          tag: sr.team?.tag ?? DEFAULT_WIDGET_TEAM_TAG,
          logoUrl: sr.team?.logoUrl ?? null,
          slot: sr.slotNumber ?? null,
        });
      });

      const adjustmentFilters: Prisma.AdminAdjustmentWhereInput[] = [
        { matchId },
      ];
      if (match.groupId) adjustmentFilters.push({ groupId: match.groupId });
      if (match.stageId) adjustmentFilters.push({ stageId: match.stageId });
      if (match.tournamentId) {
        adjustmentFilters.push({ tournamentId: match.tournamentId });
      }
      if (match.sessionId) {
        adjustmentFilters.push({ sessionId: match.sessionId });
      }
      const adjustmentsRaw: ScoreAdjustmentRecord[] = adjustmentFilters.length
        ? await this.prisma.adminAdjustment.findMany({
            where: {
              deletedAt: null,
              revokedAt: null,
              OR: adjustmentFilters,
            },
            select: {
              teamId: true,
              pointsDelta: true,
              scope: true,
              type: true,
              matchId: true,
              groupId: true,
              stageId: true,
              tournamentId: true,
              sessionId: true,
              deletedAt: true,
              revokedAt: true,
            },
          })
        : [];
      const adjustmentsByTeam = new Map<string, ScoreAdjustmentRecord[]>();
      adjustmentsRaw.forEach((adj) => {
        const list = adjustmentsByTeam.get(adj.teamId) ?? [];
        list.push(adj);
        adjustmentsByTeam.set(adj.teamId, list);
      });
      const matchContext: ScoreAdjustmentMatchContext = {
        id: matchId,
        tournamentId: match.tournamentId ?? null,
        stageId: match.stageId ?? null,
        groupId: match.groupId ?? null,
        sessionId: match.sessionId ?? null,
      };

      const ensureTeamMeta = (teamId: string) => {
        if (teamMeta.has(teamId)) return;
        teamMeta.set(teamId, {
          name: 'Team',
          tag: null,
          logoUrl: null,
          slot: null,
        });
      };
      slotResultMap.forEach((_, teamId) => ensureTeamMeta(teamId));

      const teams: LiveRankingTeam[] = [];
      for (const [teamId, slot] of slotResultMap.entries()) {
        const meta = teamMeta.get(teamId) ?? {
          name: 'Team',
          tag: null,
          logoUrl: null,
          slot: null,
        };
        const kills = this.firstNonNull(slot?.totalKills ?? null) ?? 0;
        const placement = this.firstNonNull(slot?.placement ?? null);
        const placementPoints =
          slot?.placementPoints ??
          resolvePlacementPoints(placement, placementTable);
        const killPoints = computeKillPoints(kills, killPointValue);
        const adjusted = applyMatchScoreAdjustments(
          placementPoints + killPoints,
          adjustmentsByTeam.get(teamId) ?? [],
          matchContext,
        );
        const totalPoints = adjusted.totalPoints;
        teams.push({
          teamId,
          rank: 0,
          name: meta.name,
          tag: meta.tag ?? DEFAULT_WIDGET_TEAM_TAG,
          logoUrl: meta.logoUrl ?? null,
          kills,
          placement: placement ?? null,
          wwcd: placement === 1 ? 1 : 0,
          placementPoints,
          killPoints,
          totalPoints,
          wasPresentInMatch: true,
          presenceStatus: derivePresenceStatus(true),
        });
      }

      teams.sort((a, b) => {
        const rankingOrder = compareRankingRows(a, b);
        if (rankingOrder !== 0) return rankingOrder;
        return a.name.localeCompare(b.name);
      });

      const ranked = teams.slice(0, this.maxTeams).map((team, idx) => ({
        ...team,
        rank: idx + 1,
      }));

      const payload: LiveRankingPayload = {
        matchId,
        computedAt: new Date().toISOString(),
        teams: ranked,
      };

      this.realtime.emitMatchScopedEvent(
        matchId,
        'match:live-ranking',
        payload,
        orgId,
      );
      return payload;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`live-ranking failed for match=${matchId}: ${msg}`);
      if (opts.requester) {
        opts.requester.emit('match:error', {
          reason: 'ranking_compute_failed',
        });
      }
      return null;
    }
  }

  async emitOverallRanking(
    tournamentId: string,
    opts: { force?: boolean } = {},
  ): Promise<OverallRankingPayload | null> {
    if (
      this.shouldThrottle(
        this.overallThrottle,
        tournamentId,
        opts.force ?? false,
      )
    ) {
      return null;
    }
    try {
      const tournament = await this.prisma.tournament.findFirst({
        where: { id: tournamentId, deletedAt: null },
        select: {
          id: true,
          organizationId: true,
          rulesetId: true,
          ruleset: true,
          game: true,
          matches: {
            where: {
              deletedAt: null,
              status: {
                in: MATCH_ACTIVE_OR_FINISHED_STATUSES,
              },
            },
            select: {
              id: true,
              tournamentId: true,
              stageId: true,
              groupId: true,
              sessionId: true,
            },
          },
          tournamentTeams: {
            where: { deletedAt: null },
            select: {
              teamId: true,
              team: { select: { name: true, tag: true, logoUrl: true } },
            },
          },
        },
      });
      if (!tournament) return null;

      const ruleConfig = await this.resolveRuleConfig({
        id: '',
        tournamentId,
        organizationId: tournament.organizationId,
        status: MatchStatus.LIVE,
        ruleset: null,
        tournament,
        matchSlots: [],
        matchTeams: [],
      } as MatchContext);
      const placementTable = ruleConfig.placementPoints ?? {};
      const killPointValue =
        typeof ruleConfig.killPoints === 'number' ? ruleConfig.killPoints : 1;

      const matchIds = tournament.matches.map((m) => m.id);
      if (!matchIds.length) return null;
      const stageIds = [
        ...new Set(
          tournament.matches
            .map((match) => match.stageId)
            .filter((id): id is string => Boolean(id)),
        ),
      ];
      const groupIds = [
        ...new Set(
          tournament.matches
            .map((match) => match.groupId)
            .filter((id): id is string => Boolean(id)),
        ),
      ];
      const sessionIds = [
        ...new Set(
          tournament.matches
            .map((match) => match.sessionId)
            .filter((id): id is string => Boolean(id)),
        ),
      ];
      const matchContexts = new Map<string, ScoreAdjustmentMatchContext>(
        tournament.matches.map((match) => [
          match.id,
          {
            id: match.id,
            tournamentId: match.tournamentId ?? tournamentId,
            stageId: match.stageId ?? null,
            groupId: match.groupId ?? null,
            sessionId: match.sessionId ?? null,
          },
        ]),
      );

      const teamMeta = new Map<
        string,
        { name: string; tag: string | null; logoUrl: string | null }
      >();
      tournament.tournamentTeams.forEach((tt) => {
        if (!tt.teamId) return;
        teamMeta.set(tt.teamId, {
          name: this.toTeamName(tt.team, DEFAULT_WIDGET_TEAM_NAME),
          tag: tt.team?.tag ?? DEFAULT_WIDGET_TEAM_TAG,
          logoUrl: tt.team?.logoUrl ?? null,
        });
      });

      const slotResults = await this.prisma.matchSlotResult.findMany({
        where: { matchId: { in: matchIds }, wasPresentInMatch: true },
        select: {
          matchId: true,
          teamId: true,
          slotNumber: true,
          placement: true,
          totalKills: true,
          placementPoints: true,
          totalPoints: true,
          team: { select: { name: true, tag: true, logoUrl: true } },
        },
      });
      const adjustmentsRaw: ScoreAdjustmentRecord[] =
        await this.prisma.adminAdjustment.findMany({
          where: {
            deletedAt: null,
            revokedAt: null,
            OR: [
              { tournamentId },
              { matchId: { in: matchIds } },
              ...(stageIds.length ? [{ stageId: { in: stageIds } }] : []),
              ...(groupIds.length ? [{ groupId: { in: groupIds } }] : []),
              ...(sessionIds.length ? [{ sessionId: { in: sessionIds } }] : []),
            ],
          },
          select: {
            teamId: true,
            pointsDelta: true,
            scope: true,
            type: true,
            matchId: true,
            groupId: true,
            stageId: true,
            tournamentId: true,
            sessionId: true,
            deletedAt: true,
            revokedAt: true,
          },
        });
      const adjustmentsByTeam = new Map<string, ScoreAdjustmentRecord[]>();
      adjustmentsRaw.forEach((adj) => {
        const list = adjustmentsByTeam.get(adj.teamId) ?? [];
        list.push(adj);
        adjustmentsByTeam.set(adj.teamId, list);
      });
      const seenKeys = new Set<string>();
      const aggregates = new Map<
        string,
        {
          matchesPlayed: number;
          kills: number;
          wwcd: number;
          placementPoints: number;
          killPoints: number;
          totalPoints: number;
        }
      >();

      const upsertAgg = (teamId: string) => {
        const current = aggregates.get(teamId) ?? {
          matchesPlayed: 0,
          kills: 0,
          wwcd: 0,
          placementPoints: 0,
          killPoints: 0,
          totalPoints: 0,
        };
        aggregates.set(teamId, { ...current });
        return aggregates.get(teamId)!;
      };

      slotResults.forEach((sr) => {
        if (!sr.teamId) return;
        const key = `${sr.matchId}:${sr.teamId}`;
        if (seenKeys.has(key)) return;
        seenKeys.add(key);
        const placementPoints =
          sr.placementPoints ??
          this.placementPoints(sr.placement ?? null, placementTable);
        const kills = sr.totalKills ?? 0;
        const killPoints = kills * killPointValue;
        const adjusted = applyMatchScoreAdjustments(
          placementPoints + killPoints,
          adjustmentsByTeam.get(sr.teamId) ?? [],
          matchContexts.get(sr.matchId) ?? {
            id: sr.matchId,
            tournamentId,
          },
        );
        const agg = upsertAgg(sr.teamId);
        agg.matchesPlayed += 1;
        agg.kills += kills;
        if (sr.placement === 1) agg.wwcd += 1;
        agg.placementPoints += placementPoints;
        agg.killPoints += killPoints;
        agg.totalPoints += adjusted.totalPoints;
        if (!teamMeta.has(sr.teamId)) {
          teamMeta.set(sr.teamId, {
            name: this.toTeamName(sr.team, DEFAULT_WIDGET_TEAM_NAME),
            tag: sr.team?.tag ?? DEFAULT_WIDGET_TEAM_TAG,
            logoUrl: sr.team?.logoUrl ?? null,
          });
        }
      });

      const teams: OverallRankingTeam[] = [];
      aggregates.forEach((agg, teamId) => {
        const meta = teamMeta.get(teamId) ?? {
          name: 'Team',
          tag: null,
          logoUrl: null,
        };
        const totalPoints =
          agg.totalPoints +
          aggregatePointDeltaForScope(
            adjustmentsByTeam.get(teamId) ?? [],
            'TOURNAMENT',
            tournamentId,
            {
              TOURNAMENT: [tournamentId],
              STAGE: stageIds,
              GROUP: groupIds,
            },
          );
        teams.push({
          teamId,
          rank: 0,
          name: meta.name,
          tag: meta.tag ?? DEFAULT_WIDGET_TEAM_TAG,
          logoUrl: meta.logoUrl ?? null,
          matchesPlayed: agg.matchesPlayed,
          wwcd: agg.wwcd,
          kills: agg.kills,
          placementPoints: agg.placementPoints,
          killPoints: agg.killPoints,
          totalPoints,
          wasPresentInMatch: true,
          presenceStatus: derivePresenceStatus(true),
        });
      });

      teams.sort((a, b) => {
        const rankingOrder = compareRankingRows(a, b);
        if (rankingOrder !== 0) return rankingOrder;
        return a.name.localeCompare(b.name);
      });

      const ranked = teams.slice(0, this.maxTeams).map((t, idx) => ({
        ...t,
        rank: idx + 1,
      }));

      const payload: OverallRankingPayload = {
        tournamentId,
        computedAt: new Date().toISOString(),
        teams: ranked,
      };

      this.realtime.emitTournamentScopedEvent(
        tournamentId,
        'tournament:overall-ranking',
        payload,
        tournament.organizationId,
      );

      return payload;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `overall-ranking failed for tournament=${tournamentId}: ${msg}`,
      );
      return null;
    }
  }
}
