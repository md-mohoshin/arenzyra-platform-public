import { Injectable } from '@nestjs/common';
import type { AuthUser } from '../../common/auth/auth.types';
import { requireMatchOrganization } from '../../common/org/org.util';
import { compareRankingRows } from '../../common/ranking-tiebreakers.util';
import { isPresentInMatch } from '../../common/results-presence.util';
import { PrismaService } from '../../db/prisma.service';
import type { ControlAutoV2ResultsResponseDto } from './control-auto-v2.dto';

type ResultRow = {
  teamId: string;
  placement: number | null;
  kills: number;
  placementPoints: number;
  points: number;
  slotNumber: number;
  players: Array<{
    playerId: string | null;
    playerName: string | null;
    kills: number;
  }>;
};

@Injectable()
export class ControlAutoV2ResultsService {
  constructor(private readonly prisma: PrismaService) {}

  async getResults(
    actor: AuthUser,
    matchId: string,
  ): Promise<ControlAutoV2ResultsResponseDto> {
    await requireMatchOrganization(this.prisma, matchId, { actor });

    const slotResults = await this.prisma.matchSlotResult.findMany({
      where: { matchId, teamId: { not: null } },
      orderBy: { slotNumber: 'asc' },
      select: {
        teamId: true,
        placement: true,
        placementPoints: true,
        totalKills: true,
        totalPoints: true,
        points: true,
        slotNumber: true,
        wasPresentInMatch: true,
        players: {
          orderBy: { playerName: 'asc' },
          select: {
            playerId: true,
            playerName: true,
            kills: true,
          },
        },
      },
    });

    const rows: ResultRow[] = slotResults
      .filter(
        (
          slotResult,
        ): slotResult is typeof slotResult & {
          teamId: string;
        } =>
          typeof slotResult.teamId === 'string' &&
          slotResult.teamId.length > 0 &&
          isPresentInMatch(slotResult.wasPresentInMatch),
      )
      .map((slotResult) => ({
        teamId: slotResult.teamId,
        placement: slotResult.placement ?? null,
        kills: Math.max(0, slotResult.totalKills ?? 0),
        placementPoints: Math.max(0, slotResult.placementPoints ?? 0),
        points: Math.max(
          0,
          slotResult.totalPoints ??
            slotResult.points ??
            slotResult.totalKills ??
            0,
        ),
        slotNumber: slotResult.slotNumber,
        players: (slotResult.players ?? []).map((player) => ({
          playerId: player.playerId ?? null,
          playerName: player.playerName ?? null,
          kills: Math.max(0, player.kills ?? 0),
        })),
      }));

    const standings = [...rows]
      .sort((left, right) => {
        const rankingOrder = compareRankingRows(
          {
            ...left,
            totalPoints: left.points,
          },
          {
            ...right,
            totalPoints: right.points,
          },
        );
        if (rankingOrder !== 0) return rankingOrder;
        if (left.placement !== null && right.placement !== null) {
          return left.placement - right.placement;
        }
        if (left.placement !== null) {
          return -1;
        }
        if (right.placement !== null) {
          return 1;
        }
        return left.slotNumber - right.slotNumber;
      })
      .map((row, index) => ({
        rank: index + 1,
        teamId: row.teamId,
        placement: row.placement,
        kills: row.kills,
        points: row.points,
      }));

    return {
      placements: rows.map((row) => ({
        teamId: row.teamId,
        placement: row.placement,
      })),
      kills: rows.map((row) => ({
        teamId: row.teamId,
        kills: row.kills,
        players: row.players,
      })),
      standings,
    };
  }
}
