import { GameKey, MatchEventType } from '@prisma/client';
import { PrismaService } from '../../db/prisma.service';
import { compareRankingRows } from '../../common/ranking-tiebreakers.util';
import {
  aggregatePointDeltaForScope,
  applyMatchScoreAdjustments,
  type ScoreAdjustmentMatchContext,
  type ScoreAdjustmentRecord,
} from '../../common/admin-adjustments.util';
import { isPresentInMatch } from '../../common/results-presence.util';
import {
  defaultKillPointsForGame,
  defaultPlacementPointsForGame,
  resolvePlacementPointsForGame,
} from '../../common/game-rules.util';
import { ScoringPlugin, StandingsSnapshotPayload } from './scoring.plugin';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function placementPoints(place: number): number {
  if (place === 1) return 10;
  if (place === 2) return 6;
  if (place === 3) return 5;
  if (place === 4) return 4;
  if (place === 5) return 3;
  if (place === 6) return 2;
  if (place === 7 || place === 8) return 1;
  return 0; // 9–25 = 0
}

export class PubgmScoring implements ScoringPlugin {
  game = GameKey.PUBG_MOBILE;

  constructor(private prisma: PrismaService) {}

  private isManualSource(match: {
    dataSource?: string | null;
    dataMode?: string | null;
  }): boolean {
    const source = (match.dataSource ?? match.dataMode ?? '')
      .toString()
      .trim()
      .toUpperCase();
    return source === 'MANUAL';
  }

  private isTerminalMatch(match: { status?: string | null }): boolean {
    const status = (match.status ?? '').toString().trim().toUpperCase();
    return status === 'ENDED' || status === 'FINISHED';
  }

  private async rulesetConfig(match: {
    rulesetId?: string | null;
    game?: { key?: GameKey | null } | null;
    tournament?: { rulesetId?: string | null; game?: GameKey | null } | null;
  }): Promise<{
    placementTable: Record<number, number>;
    killPoints: number;
    gameKey: GameKey;
  }> {
    const gameKey =
      match.game?.key ?? match.tournament?.game ?? GameKey.PUBG_MOBILE;

    const loadRuleset = async (id?: string | null) =>
      id
        ? await this.prisma.ruleset.findUnique({
            where: { id },
            select: { config: true },
          })
        : null;

    const ruleset =
      (await loadRuleset(match.rulesetId)) ??
      (await loadRuleset(match.tournament?.rulesetId)) ??
      (await this.prisma.ruleset.findFirst({
        where: { gameKey, isDefault: true },
        orderBy: { updatedAt: 'desc' },
        select: { config: true },
      }));

    const config =
      ruleset?.config && typeof ruleset.config === 'object'
        ? (ruleset.config as Record<string, unknown>)
        : {};
    const placementTable =
      config.placementPoints && typeof config.placementPoints === 'object'
        ? (config.placementPoints as Record<number, number>)
        : defaultPlacementPointsForGame(gameKey);
    const killPoints =
      typeof config.killPoints === 'number'
        ? config.killPoints
        : defaultKillPointsForGame(gameKey);

    return { placementTable, killPoints, gameKey };
  }

  private resolveKillTotal(params: {
    match: {
      status?: string | null;
      dataSource?: string | null;
      dataMode?: string | null;
    };
    isActiveTeam: boolean;
    manualTotalKills: boolean;
    existingKills: number;
    finalKills: number | null;
    playerKills: number;
    eventKills: number;
    hasPlayerRows: boolean;
  }): number {
    const {
      match,
      isActiveTeam,
      manualTotalKills,
      existingKills,
      finalKills,
      playerKills,
      eventKills,
      hasPlayerRows,
    } = params;

    if (!isActiveTeam) {
      return 0;
    }
    if (manualTotalKills) {
      return existingKills;
    }
    if (this.isTerminalMatch(match) && finalKills !== null) {
      return finalKills;
    }
    if (this.isManualSource(match)) {
      return eventKills;
    }
    if (hasPlayerRows) {
      return playerKills;
    }
    if (existingKills > 0) {
      return existingKills;
    }
    return eventKills;
  }

  async recomputeMatch(matchId: string): Promise<void> {
    const match = await this.prisma.match.findUnique({
      where: { id: matchId },
      select: {
        id: true,
        tournamentId: true,
        status: true,
        endedAt: true,
        deletedAt: true,
        organizationId: true,
        rulesetId: true,
        dataSource: true,
        dataMode: true,
        game: { select: { key: true } },
        tournament: { select: { rulesetId: true, game: true } },
      },
    });
    if (!match || match.deletedAt) return;
    if (!match.tournamentId) return;
    const organizationId = match.organizationId;
    if (!organizationId) return;
    const ruleset = await this.rulesetConfig(match);

    const tteams = await this.prisma.tournamentTeam.findMany({
      where: { tournamentId: match.tournamentId, deletedAt: null },
      select: { teamId: true },
    });
    const teamIds = tteams.map((t) => t.teamId);

    const events = await this.prisma.matchEvent.findMany({
      where: { matchId },
      orderBy: { seq: 'asc' },
      select: { type: true, teamId: true, payload: true },
    });

    const kills = new Map<string, number>();
    for (const tid of teamIds) kills.set(tid, 0);

    const placement = new Map<string, number>();
    let hasMatchEnd = false;

    for (const e of events) {
      if (e.type === MatchEventType.KILL && e.teamId && kills.has(e.teamId)) {
        kills.set(e.teamId, (kills.get(e.teamId) ?? 0) + 1);
      }

      if (
        e.type === MatchEventType.TEAM_PLACEMENT &&
        e.teamId &&
        kills.has(e.teamId)
      ) {
        const placementValue = (
          e.payload as Record<string, unknown> | null | undefined
        )?.placement;
        const p =
          typeof placementValue === 'number'
            ? placementValue
            : Number(placementValue);
        if (Number.isFinite(p)) placement.set(e.teamId, p);
      }

      if (e.type === MatchEventType.MATCH_END) hasMatchEnd = true;
    }

    const slotResults = await this.prisma.matchSlotResult.findMany({
      where: { matchId },
      select: {
        id: true,
        teamId: true,
        wasPresentInMatch: true,
        placement: true,
        finalPlacement: true,
        totalKills: true,
        finalKills: true,
        manualTotalKills: true,
        players: {
          select: {
            kills: true,
          },
        },
      },
    });
    const slotByTeam = new Map(
      slotResults
        .filter((sr) => sr.teamId)
        .map((sr) => [sr.teamId as string, sr.id]),
    );

    for (const teamId of teamIds) {
      const slotId = slotByTeam.get(teamId);
      if (!slotId) continue;
      const slot = slotResults.find((row) => row.id === slotId) ?? null;
      const isActiveTeam = isPresentInMatch(slot?.wasPresentInMatch);
      const eventKills = kills.get(teamId) ?? 0;
      const playerKills =
        slot?.players?.reduce((sum, player) => sum + (player.kills ?? 0), 0) ??
        0;
      const existingKills = Math.max(0, slot?.totalKills ?? 0);
      const manualTotalKills = slot?.manualTotalKills === true;
      const k = this.resolveKillTotal({
        match,
        isActiveTeam,
        manualTotalKills,
        existingKills,
        finalKills:
          typeof slot?.finalKills === 'number'
            ? Math.max(0, slot.finalKills)
            : null,
        playerKills: Math.max(0, playerKills),
        eventKills: Math.max(0, eventKills),
        hasPlayerRows: (slot?.players?.length ?? 0) > 0,
      });
      const pl = isActiveTeam
        ? ((this.isTerminalMatch(match) ? slot?.finalPlacement : null) ??
          slot?.placement ??
          placement.get(teamId) ??
          null)
        : null;
      const pPts = pl
        ? Number(
            ruleset.placementTable[pl] ??
              resolvePlacementPointsForGame(pl, ruleset.gameKey),
          )
        : 0;
      const total = pPts + k * ruleset.killPoints;

      await this.prisma.matchSlotResult.update({
        where: { id: slotId },
        data: {
          placement: pl,
          finalPlacement: isActiveTeam ? (slot?.finalPlacement ?? null) : null,
          placementPoints: pPts,
          totalKills: k,
          finalKills: isActiveTeam ? (slot?.finalKills ?? null) : 0,
          points: total,
          totalPoints: total,
          manualTotalKills: isActiveTeam ? manualTotalKills : false,
        },
      });
    }

    if (hasMatchEnd) {
      const shouldUpdateEndedAt = match.status !== 'ENDED' || !match.endedAt;
      if (shouldUpdateEndedAt) {
        await this.prisma.match
          .update({
            where: { id: matchId },
            data: { status: 'ENDED', endedAt: match.endedAt ?? new Date() },
          })
          .catch(() => {});
      }
    }
  }

  async recomputeTournament(
    tournamentId: string,
  ): Promise<StandingsSnapshotPayload> {
    const tournament = await this.prisma.tournament.findUnique({
      where: { id: tournamentId },
      select: {
        id: true,
        game: true,
        deletedAt: true,
        name: true,
        bannerUrl: true,
      },
    });
    if (!tournament || tournament.deletedAt) {
      return {
        tournamentId,
        game: GameKey.PUBG_MOBILE,
        updatedAt: new Date().toISOString(),
        meta: {
          tournamentName: tournament?.name ?? null,
          bannerUrl: tournament?.bannerUrl ?? null,
        },
        rows: [],
      };
    }

    const tteams = await this.prisma.tournamentTeam.findMany({
      where: { tournamentId, deletedAt: null },
      select: {
        teamId: true,
        team: { select: { tag: true, name: true, logoUrl: true } },
      },
    });
    const teamIds = tteams.map((t) => t.teamId);
    const teamMeta = new Map<
      string,
      { tag: string | null; name: string | null; logoUrl: string | null }
    >();
    for (const t of tteams) {
      teamMeta.set(t.teamId, {
        tag: t.team?.tag ?? null,
        name: t.team?.name ?? null,
        logoUrl: t.team?.logoUrl ?? null,
      });
    }

    const matches = await this.prisma.match.findMany({
      where: { tournamentId, deletedAt: null },
      select: {
        id: true,
        tournamentId: true,
        stageId: true,
        groupId: true,
        sessionId: true,
      },
    });
    const matchIds = matches.map((m) => m.id);
    const stageIds = [
      ...new Set(
        matches
          .map((match) => match.stageId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const groupIds = [
      ...new Set(
        matches
          .map((match) => match.groupId)
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
    const matchContexts = new Map<string, ScoreAdjustmentMatchContext>(
      matches.map((match) => [
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

    const stats = await this.prisma.matchSlotResult.findMany({
      where: {
        matchId: { in: matchIds },
        teamId: { not: null },
        wasPresentInMatch: true,
      },
      select: {
        matchId: true,
        teamId: true,
        totalPoints: true,
        placementPoints: true,
        totalKills: true,
        placement: true,
      },
    });

    const adjustments = await this.prisma.adminAdjustment.findMany({
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
    adjustments.forEach((adjustment) => {
      const list = adjustmentsByTeam.get(adjustment.teamId) ?? [];
      list.push(adjustment);
      adjustmentsByTeam.set(adjustment.teamId, list);
    });

    type Row = {
      teamId: string;
      teamTag: string | null;
      teamName: string | null;
      logoUrl: string | null;
      total: number;
      wwcd: number;
      placementPoints: number;
      kills: number;
      bestPlacement: number;
      bestKills: number;
    };

    const rows = new Map<string, Row>();
    for (const teamId of teamIds) {
      const meta = teamMeta.get(teamId);
      rows.set(teamId, {
        teamId,
        teamTag: meta?.tag ?? null,
        teamName: meta?.name ?? null,
        logoUrl: meta?.logoUrl ?? null,
        total: 0,
        wwcd: 0,
        placementPoints: 0,
        kills: 0,
        bestPlacement: 999,
        bestKills: 0,
      });
    }

    for (const s of stats) {
      if (!s.teamId) continue;
      const r = rows.get(s.teamId);
      if (!r) continue;

      const placementPointsValue = s.placementPoints ?? 0;
      const killsValue = s.totalKills ?? 0;
      const totalPointsValue = applyMatchScoreAdjustments(
        placementPointsValue + killsValue,
        adjustmentsByTeam.get(s.teamId) ?? [],
        matchContexts.get(s.matchId) ?? { id: s.matchId, tournamentId },
      ).totalPoints;

      r.total += totalPointsValue;
      r.placementPoints += placementPointsValue;
      r.kills += killsValue;
      if (s.placement === 1) r.wwcd += 1;

      if (s.placement && s.placement < r.bestPlacement)
        r.bestPlacement = s.placement;
      if (killsValue > r.bestKills) r.bestKills = killsValue;
    }

    rows.forEach((row, teamId) => {
      row.total += aggregatePointDeltaForScope(
        adjustmentsByTeam.get(teamId) ?? [],
        'TOURNAMENT',
        tournamentId,
        {
          TOURNAMENT: [tournamentId],
          STAGE: stageIds,
          GROUP: groupIds,
        },
      );
    });

    const sorted = [...rows.values()].sort((a, b) => {
      const rankingOrder = compareRankingRows(a, b);
      if (rankingOrder !== 0) return rankingOrder;
      if (a.bestPlacement !== b.bestPlacement)
        return a.bestPlacement - b.bestPlacement;
      return b.bestKills - a.bestKills;
    });

    const payload: StandingsSnapshotPayload = {
      tournamentId,
      game: tournament.game,
      updatedAt: new Date().toISOString(),
      meta: {
        tournamentName: tournament.name ?? null,
        bannerUrl: tournament.bannerUrl ?? null,
      },
      rows: sorted.map((r, idx) => ({ ...r, rank: idx + 1 })),
    };

    return payload;
  }
}
