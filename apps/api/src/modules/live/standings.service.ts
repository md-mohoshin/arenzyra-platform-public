import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../db/prisma.service';
import { isPresentInMatch } from '../../common/results-presence.util';

export type Scope = 'TOURNAMENT' | 'STAGE' | 'GROUP';

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
      createdAt: Date;
      scheduledAt: Date | null;
      slotResults: Array<{
        teamId: string;
        placement: number | null;
        totalKills: number | null;
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
          : { groupId: scopeId };

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
      createdAt: m.createdAt,
      scheduledAt: m.scheduledAt ?? null,
      slotResults: (m.slotResults ?? [])
        .filter((sr) => sr.teamId && isPresentInMatch(sr.wasPresentInMatch))
        .map((sr) => ({
          teamId: sr.teamId as string,
          placement: sr.placement ?? null,
          totalKills: sr.totalKills ?? null,
          points: sr.points ?? null,
          team: sr.team ?? null,
        })),
    }));

    const rows = new Map<string, StandingRow>();

    for (const match of matches) {
      const playedAt = match.scheduledAt ?? match.createdAt;
      for (const sr of match.slotResults) {
        if (!sr.teamId) continue;
        const placementPts = this.placementPoints(sr.placement);
        const kills = sr.totalKills ?? 0;
        const totalPoints = sr.points ?? placementPts + kills; // fallback if points not set

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
          totalPoints: 0,
          bestPlacement: null as number | null,
          lastMatchPlacement: null as number | null,
          perMatch: [] as StandingRow['perMatch'],
        };

        current.matchesPlayed += 1;
        current.totalKills += kills;
        current.totalPlacementPoints += placementPts;
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
      if (b.totalPoints !== a.totalPoints) return b.totalPoints - a.totalPoints;
      if (b.totalKills !== a.totalKills) return b.totalKills - a.totalKills;
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
