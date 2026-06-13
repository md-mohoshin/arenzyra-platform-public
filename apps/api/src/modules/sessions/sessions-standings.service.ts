import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthUser } from '../../common/auth/auth.types';
import { effectiveOrganizationId } from '../../common/org/org.util';
import { compareRankingRows } from '../../common/ranking-tiebreakers.util';
import { isPresentInMatch } from '../../common/results-presence.util';
import { PrismaService } from '../../db/prisma.service';

type StandingAggregate = {
  teamId: string;
  teamName: string | null;
  tag: string | null;
  totalPoints: number;
  totalKills: number;
  placementPoints: number;
  wwcd: number;
  matchesPlayed: number;
  placementSum: number;
  placementCount: number;
};

@Injectable()
export class SessionsStandingsService {
  constructor(private readonly prisma: PrismaService) {}

  private requireOrg(actor: AuthUser | null | undefined): string {
    const organizationId = effectiveOrganizationId(actor);
    if (!organizationId) {
      throw new ForbiddenException('organizationId is required');
    }
    return organizationId;
  }

  private hasAppliedResultRow(row: {
    placement?: number | null;
    totalKills?: number | null;
    totalPoints?: number | null;
    points?: number | null;
    placementPoints?: number | null;
  }): boolean {
    return (
      (row.placement !== null && row.placement !== undefined) ||
      Math.max(0, row.totalKills ?? 0) > 0 ||
      Math.max(0, row.totalPoints ?? row.points ?? 0) > 0 ||
      Math.max(0, row.placementPoints ?? 0) > 0
    );
  }

  async getStandings(sessionId: string, actor: AuthUser) {
    const organizationId = this.requireOrg(actor);
    const session = await this.prisma.session.findFirst({
      where: {
        id: sessionId,
        organizationId,
        deletedAt: null,
      },
      select: { id: true },
    });

    if (!session) {
      throw new NotFoundException('Session not found');
    }

    const matches = await this.prisma.match.findMany({
      where: {
        sessionId: session.id,
        organizationId,
        deletedAt: null,
      },
      select: {
        id: true,
      },
    });

    if (matches.length === 0) {
      return {
        sessionId: session.id,
        teams: [],
      };
    }

    const slotResults = await this.prisma.matchSlotResult.findMany({
      where: {
        matchId: {
          in: matches.map((match) => match.id),
        },
        organizationId,
        teamId: { not: null },
        wasPresentInMatch: true,
      },
      select: {
        matchId: true,
        teamId: true,
        wasPresentInMatch: true,
        placement: true,
        placementPoints: true,
        totalKills: true,
        totalPoints: true,
        points: true,
        team: {
          select: {
            id: true,
            name: true,
            tag: true,
          },
        },
      },
    });

    const aggregates = new Map<string, StandingAggregate>();
    for (const slotResult of slotResults) {
      if (
        !isPresentInMatch(slotResult.wasPresentInMatch ?? null) ||
        !this.hasAppliedResultRow(slotResult)
      ) {
        continue;
      }
      const teamId = slotResult.teamId;
      if (!teamId) {
        continue;
      }

      const current = aggregates.get(teamId) ?? {
        teamId,
        teamName: slotResult.team?.name ?? null,
        tag: slotResult.team?.tag ?? null,
        totalPoints: 0,
        totalKills: 0,
        placementPoints: 0,
        wwcd: 0,
        matchesPlayed: 0,
        placementSum: 0,
        placementCount: 0,
      };

      current.totalPoints += slotResult.totalPoints ?? slotResult.points ?? 0;
      current.totalKills += slotResult.totalKills ?? 0;
      current.placementPoints += slotResult.placementPoints ?? 0;
      if (slotResult.placement === 1) {
        current.wwcd += 1;
      }
      current.matchesPlayed += 1;
      if (typeof slotResult.placement === 'number') {
        current.placementSum += slotResult.placement;
        current.placementCount += 1;
      }
      if (!current.tag && slotResult.team?.tag) {
        current.tag = slotResult.team.tag;
      }
      if (!current.teamName && slotResult.team?.name) {
        current.teamName = slotResult.team.name;
      }

      aggregates.set(teamId, current);
    }

    const teams = Array.from(aggregates.values())
      .sort((left, right) => {
        const rankingOrder = compareRankingRows(left, right);
        if (rankingOrder !== 0) return rankingOrder;
        return left.teamId.localeCompare(right.teamId);
      })
      .map((team, index) => ({
        teamId: team.teamId,
        teamName: team.teamName,
        tag: team.tag,
        totalPoints: team.totalPoints,
        totalKills: team.totalKills,
        placementPoints: team.placementPoints,
        wwcd: team.wwcd,
        matchesPlayed: team.matchesPlayed,
        avgPlacement:
          team.placementCount > 0
            ? Number((team.placementSum / team.placementCount).toFixed(2))
            : null,
        rank: index + 1,
      }));

    return {
      sessionId: session.id,
      teams,
    };
  }
}
