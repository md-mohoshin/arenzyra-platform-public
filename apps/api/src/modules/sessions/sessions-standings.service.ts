import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MatchStatus } from '@prisma/client';
import type { AuthUser } from '../../common/auth/auth.types';
import { effectiveOrganizationId } from '../../common/org/org.util';
import { isPresentInMatch } from '../../common/results-presence.util';
import { PrismaService } from '../../db/prisma.service';

type StandingAggregate = {
  teamId: string;
  tag: string | null;
  totalPoints: number;
  totalKills: number;
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

    // MatchStatus has no OFFICIAL variant; concluded matches currently land in
    // FINISHED and may later advance to ENDED through existing backend flows.
    const matches = await this.prisma.match.findMany({
      where: {
        sessionId: session.id,
        organizationId,
        deletedAt: null,
        status: {
          in: [MatchStatus.FINISHED, MatchStatus.ENDED],
        },
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
        totalKills: true,
        totalPoints: true,
        points: true,
        team: {
          select: {
            id: true,
            tag: true,
          },
        },
      },
    });

    const aggregates = new Map<string, StandingAggregate>();
    for (const slotResult of slotResults) {
      if (!isPresentInMatch(slotResult.wasPresentInMatch ?? null)) {
        continue;
      }
      const teamId = slotResult.teamId;
      if (!teamId) {
        continue;
      }

      const current = aggregates.get(teamId) ?? {
        teamId,
        tag: slotResult.team?.tag ?? null,
        totalPoints: 0,
        totalKills: 0,
        matchesPlayed: 0,
        placementSum: 0,
        placementCount: 0,
      };

      current.totalPoints += slotResult.totalPoints ?? slotResult.points ?? 0;
      current.totalKills += slotResult.totalKills ?? 0;
      current.matchesPlayed += 1;
      if (typeof slotResult.placement === 'number') {
        current.placementSum += slotResult.placement;
        current.placementCount += 1;
      }
      if (!current.tag && slotResult.team?.tag) {
        current.tag = slotResult.team.tag;
      }

      aggregates.set(teamId, current);
    }

    const teams = Array.from(aggregates.values())
      .sort((left, right) => {
        if (right.totalPoints !== left.totalPoints) {
          return right.totalPoints - left.totalPoints;
        }
        if (right.totalKills !== left.totalKills) {
          return right.totalKills - left.totalKills;
        }
        return left.teamId.localeCompare(right.teamId);
      })
      .map((team, index) => ({
        teamId: team.teamId,
        tag: team.tag,
        totalPoints: team.totalPoints,
        totalKills: team.totalKills,
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
