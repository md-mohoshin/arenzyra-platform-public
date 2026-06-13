import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { compareRankingRows } from '../../common/ranking-tiebreakers.util';
import { PrismaService } from '../../db/prisma.service';
import { isPresentInMatch } from '../../common/results-presence.util';
import {
  aggregatePointDeltaForScope,
  applyMatchScoreAdjustments,
  type AdminAdjustmentScopeValue,
  type ScoreAdjustmentMatchContext,
  type ScoreAdjustmentRecord,
} from '../../common/admin-adjustments.util';

export type Scope = 'TOURNAMENT' | 'STAGE' | 'GROUP' | 'SESSION' | 'MATCH';

type StandingRow = {
  teamId: string;
  teamName: string | null;
  teamTag: string | null;
  teamLogo: string | null;
  teamLogoUpdatedAt?: Date | null;
  teamUpdatedAt?: Date | null;
  matchesPlayed: number;
  totalKills: number;
  totalPlacementPoints: number;
  wwcd: number;
  adjustmentPoints: number;
  totalPoints: number;
  bestPlacement: number | null;
  lastMatchPlacement: number | null;
  rank?: number;
  perMatch: Array<{
    matchId: string;
    matchNumber: number | null;
    mapName: string | null;
    placement: number | null;
    kills: number | null;
    placementPoints: number;
    totalPoints: number;
    adjustmentPoints: number;
    disqualified: boolean;
    playedAt: Date;
  }>;
};

@Injectable()
export class StandingsService {
  constructor(private readonly prisma: PrismaService) {}

  private placementPoints(placement?: number | null): number {
    if (!placement) return 0;
    switch (placement) {
      case 1:
        return 10;
      case 2:
        return 6;
      case 3:
        return 5;
      case 4:
        return 4;
      case 5:
        return 3;
      case 6:
        return 2;
      case 7:
      case 8:
        return 1;
      default:
        return 0;
    }
  }

  async computeStandings(params: { scope: Scope; scopeId: string }): Promise<{
    scope: Scope;
    scopeId: string;
    computedAt: string;
    matchCountUsed: number;
    rows: StandingRow[];
  }> {
    const { scope, scopeId } = params;
    type MatchWithSlots = {
      id: string;
      matchNumber: number | null;
      map: string | null;
      tournamentId: string | null;
      stageId: string | null;
      groupId: string | null;
      sessionId: string | null;
      createdAt: Date;
      scheduledAt: Date | null;
      slotResults: Array<{
        teamId: string;
        placement: number | null;
        placementPoints: number | null;
        totalKills: number | null;
        totalPoints: number | null;
        points: number | null;
        team: {
          id: string;
          name: string | null;
          tag: string | null;
          logoUrl: string | null;
          updatedAt: Date | null;
        } | null;
      }>;
    };

    const where =
      scope === 'TOURNAMENT'
        ? { tournamentId: scopeId }
        : scope === 'STAGE'
          ? { stageId: scopeId }
          : scope === 'GROUP'
            ? { groupId: scopeId }
            : scope === 'SESSION'
              ? { sessionId: scopeId }
              : { id: scopeId };

    const matchesRaw = await this.prisma.match.findMany({
      where: { ...where, deletedAt: null },
      orderBy: [{ scheduledAt: 'asc' }, { createdAt: 'asc' }],
      include: {
        slotResults: {
          where: { teamId: { not: null }, wasPresentInMatch: true },
          include: {
            team: {
              select: {
                id: true,
                name: true,
                tag: true,
                logoUrl: true,
                updatedAt: true,
              },
            },
          },
        },
      },
    });

    const matches: MatchWithSlots[] = matchesRaw.map((m) => ({
      id: m.id,
      matchNumber: m.matchNumber ?? null,
      map: (m as unknown as { map?: string | null })?.map ?? null,
      tournamentId: m.tournamentId ?? null,
      stageId: m.stageId ?? null,
      groupId: m.groupId ?? null,
      sessionId: m.sessionId ?? null,
      createdAt: m.createdAt,
      scheduledAt: m.scheduledAt ?? null,
      slotResults: (m.slotResults ?? [])
        .filter((sr) => sr.teamId && isPresentInMatch(sr.wasPresentInMatch))
        .map((sr) => ({
          teamId: sr.teamId as string,
          placement: sr.placement ?? null,
          placementPoints: sr.placementPoints ?? null,
          totalKills: sr.totalKills ?? null,
          totalPoints: sr.totalPoints ?? null,
          points: sr.points ?? null,
          team: sr.team ?? null,
        })),
    }));

    const matchIds = matches.map((match) => match.id);
    const groupIds = [
      ...new Set(
        matches
          .map((match) => match.groupId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const stageIds = [
      ...new Set(
        matches
          .map((match) => match.stageId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const tournamentIds = [
      ...new Set(
        matches
          .map((match) => match.tournamentId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const sessionIds = [
      ...new Set(
        matches
          .map((match) => match.sessionId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const adjustmentFilters: Prisma.AdminAdjustmentWhereInput[] = [];
    if (matchIds.length) adjustmentFilters.push({ matchId: { in: matchIds } });
    if (groupIds.length) adjustmentFilters.push({ groupId: { in: groupIds } });
    if (stageIds.length) adjustmentFilters.push({ stageId: { in: stageIds } });
    if (tournamentIds.length) {
      adjustmentFilters.push({ tournamentId: { in: tournamentIds } });
    }
    if (sessionIds.length) {
      adjustmentFilters.push({ sessionId: { in: sessionIds } });
    }
    const adjustments: ScoreAdjustmentRecord[] = adjustmentFilters.length
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
    for (const adjustment of adjustments) {
      const list = adjustmentsByTeam.get(adjustment.teamId) ?? [];
      list.push(adjustment);
      adjustmentsByTeam.set(adjustment.teamId, list);
    }

    const rows = new Map<string, StandingRow>();

    for (const match of matches) {
      const playedAt = match.scheduledAt ?? match.createdAt;
      const matchContext: ScoreAdjustmentMatchContext = {
        id: match.id,
        tournamentId: match.tournamentId,
        stageId: match.stageId,
        groupId: match.groupId,
        sessionId: match.sessionId,
      };
      for (const sr of match.slotResults) {
        if (!sr.teamId) continue;
        const placementPts =
          sr.placementPoints ?? this.placementPoints(sr.placement);
        const kills = sr.totalKills ?? 0;
        const killPoints = sr.points ?? kills;
        const baseTotalPoints = placementPts + killPoints;
        const adjusted = applyMatchScoreAdjustments(
          baseTotalPoints,
          adjustmentsByTeam.get(sr.teamId) ?? [],
          matchContext,
        );
        const totalPoints = adjusted.totalPoints;
        const adjustmentPoints = totalPoints - baseTotalPoints;

        const current = rows.get(sr.teamId) ?? {
          teamId: sr.teamId,
          teamName: sr.team?.name ?? null,
          teamTag: sr.team?.tag ?? null,
          teamLogo: sr.team?.logoUrl ?? null,
          teamLogoUpdatedAt: sr.team?.updatedAt ?? null,
          teamUpdatedAt: sr.team?.updatedAt ?? null,
          matchesPlayed: 0,
          totalKills: 0,
          totalPlacementPoints: 0,
          wwcd: 0,
          adjustmentPoints: 0,
          totalPoints: 0,
          bestPlacement: null as number | null,
          lastMatchPlacement: null as number | null,
          perMatch: [] as StandingRow['perMatch'],
        };

        current.matchesPlayed += 1;
        current.totalKills += kills;
        current.totalPlacementPoints += placementPts;
        if (sr.placement === 1) current.wwcd += 1;
        current.adjustmentPoints += adjustmentPoints;
        current.totalPoints += totalPoints;
        if (sr.placement) {
          current.bestPlacement =
            current.bestPlacement === null
              ? sr.placement
              : Math.min(current.bestPlacement, sr.placement);
        }

        current.perMatch.push({
          matchId: match.id,
          matchNumber: match.matchNumber ?? null,
          mapName: match.map ?? null,
          placement: sr.placement ?? null,
          kills,
          placementPoints: placementPts,
          totalPoints,
          adjustmentPoints,
          disqualified: adjusted.disqualified,
          playedAt,
        });

        if (sr.team?.updatedAt) {
          const ts = sr.team.updatedAt;
          current.teamLogoUpdatedAt =
            current.teamLogoUpdatedAt && current.teamLogoUpdatedAt > ts
              ? current.teamLogoUpdatedAt
              : ts;
          current.teamUpdatedAt =
            current.teamUpdatedAt && current.teamUpdatedAt > ts
              ? current.teamUpdatedAt
              : ts;
        }

        rows.set(sr.teamId, current);
      }
    }

    const aggregateScope = scope as AdminAdjustmentScopeValue;
    const aggregateScopeIds =
      scope === 'TOURNAMENT'
        ? {
            TOURNAMENT: [scopeId],
            STAGE: stageIds,
            GROUP: groupIds,
          }
        : scope === 'STAGE'
          ? {
              STAGE: [scopeId],
              GROUP: groupIds,
            }
          : scope === 'GROUP'
            ? { GROUP: [scopeId] }
            : scope === 'SESSION'
              ? { SESSION: [scopeId] }
              : { MATCH: [scopeId] };
    rows.forEach((row) => {
      const delta = aggregatePointDeltaForScope(
        adjustmentsByTeam.get(row.teamId) ?? [],
        aggregateScope,
        scopeId,
        aggregateScopeIds,
      );
      if (!delta) return;
      row.adjustmentPoints += delta;
      row.totalPoints += delta;
    });

    const sorted = [...rows.values()].map((row) => {
      // lastMatchPlacement based on most recent playedAt
      const latest = row.perMatch
        .slice()
        .sort((a, b) => b.playedAt.getTime() - a.playedAt.getTime())[0];
      return {
        ...row,
        lastMatchPlacement: latest?.placement ?? null,
      };
    });

    sorted.sort((a, b) => {
      const rankingOrder = compareRankingRows(a, b);
      if (rankingOrder !== 0) return rankingOrder;
      if ((a.bestPlacement ?? Infinity) !== (b.bestPlacement ?? Infinity))
        return (a.bestPlacement ?? Infinity) - (b.bestPlacement ?? Infinity);
      if (
        (a.lastMatchPlacement ?? Infinity) !==
        (b.lastMatchPlacement ?? Infinity)
      )
        return (
          (a.lastMatchPlacement ?? Infinity) -
          (b.lastMatchPlacement ?? Infinity)
        );
      return (a.teamName ?? '').localeCompare(b.teamName ?? '');
    });

    const ranked = sorted.map((row, idx) => ({
      rank: idx + 1,
      ...row,
    }));

    return {
      scope,
      scopeId,
      computedAt: new Date().toISOString(),
      matchCountUsed: matches.length,
      rows: ranked,
    };
  }
}
