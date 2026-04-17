/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */

/* eslint-disable @typescript-eslint/no-unsafe-argument */
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { GameKey, MatchEventType } from '@prisma/client';
import { PrismaService } from '../../db/prisma.service';
import { PubgmScoring } from './pubgm.scoring';
import { StandingsSnapshotPayload } from './scoring.plugin';
import { LiveService } from '../live/live.service';
import type { Actor } from '../matches/matches.service';
import { ScoreboardService } from '../scoreboard/scoreboard.service';
import { ResultsService } from '../results/results.service';

const GK = GameKey as unknown as Record<string, GameKey>;

@Injectable()
export class ScoringService {
  private pubgm: PubgmScoring;

  constructor(
    private prisma: PrismaService,
    private live: LiveService,
    private scoreboard: ScoreboardService,
    @Inject(forwardRef(() => ResultsService))
    private results: ResultsService,
  ) {
    this.pubgm = new PubgmScoring(this.prisma);
  }

  private pluginFor(game: GameKey) {
    if (game === GameKey.PUBG_MOBILE) return this.pubgm;
    return this.pubgm;
  }

  async recomputeMatchAndTournament(
    matchId: string,
  ): Promise<StandingsSnapshotPayload | null> {
    const match = await this.prisma.match.findUnique({
      where: { id: matchId },
      select: { tournamentId: true, deletedAt: true, status: true },
    });
    if (!match || match.deletedAt) return null;
    if (!match.tournamentId) return null;

    const tournament = await this.prisma.tournament.findUnique({
      where: { id: match.tournamentId },
      select: { game: true, deletedAt: true },
    });
    if (!tournament || tournament.deletedAt) return null;

    const plugin = this.pluginFor(tournament.game);
    const terminalMatch =
      match.status === 'ENDED' || match.status === 'FINISHED';

    await plugin.recomputeMatch(matchId);
    if (terminalMatch) {
      await this.results.assertMatchStateConsistency(matchId);
    }
    const snapshot = await plugin.recomputeTournament(match.tournamentId);
    await this.live.setLatestStandings(match.tournamentId, snapshot);
    if (!terminalMatch) {
      await this.results.assertMatchStateConsistency(matchId);
    }
    return snapshot;
  }

  private defaultRulesetConfig(game: GameKey) {
    if (game === GK.VALORANT || game === GK.CS2) {
      return { type: 'ROUND_WINS', roundWinPoints: 1, winBonus: 0 };
    }
    if (game === GK.MLBB) {
      return {
        type: 'ROUND_WINS',
        roundWinPoints: 1,
        winBonus: 0,
        lossPoints: 0,
        drawPoints: 0,
        maxTeams: 2,
      };
    }
    if (game === GK.FREE_FIRE) {
      return {
        type: 'BR_POINTS',
        placementPoints: { 1: 10, 2: 6, 3: 5, 4: 4, 5: 3, 6: 2, 7: 1, 8: 1 },
        killPoints: 1,
        maxTeams: 25,
      };
    }
    return {
      type: 'BR_POINTS',
      placementPoints: { 1: 10, 2: 6, 3: 5, 4: 4, 5: 3, 6: 2, 7: 1, 8: 1 },
      killPoints: 1,
      maxTeams: 25,
    };
  }

  private isSuper(actor: Actor | null | undefined) {
    return (actor?.actorRole ?? actor?.role) === 'SUPER_ADMIN';
  }

  private ensureAccess(ownerUserId: string, actor: Actor | null | undefined) {
    if (this.isSuper(actor)) return;
    const actorId = actor?.actorId ?? actor?.id;
    if (!actorId || actorId !== ownerUserId) {
      throw new ForbiddenException('Not allowed to recalculate this match');
    }
  }

  private countKills(
    events: Array<{
      teamId: string | null;
      playerId: string | null;
      type: string;
    }>,
  ) {
    const teamKills = new Map<string, number>();
    const playerKills = new Map<string, number>();
    events.forEach((evt) => {
      if (evt.type === MatchEventType.KILL || evt.type === 'KILL') {
        if (evt.teamId)
          teamKills.set(evt.teamId, (teamKills.get(evt.teamId) ?? 0) + 1);
        if (evt.playerId)
          playerKills.set(
            evt.playerId,
            (playerKills.get(evt.playerId) ?? 0) + 1,
          );
      }
    });
    return { teamKills, playerKills };
  }

  private buildTeamList(match: {
    matchTeams?: Array<{ teamId: string; team: { id: string } | null }>;
    matchSlots?: Array<{ teamId: string | null; team: { id: string } | null }>;
  }) {
    const ids = new Set<string>();
    (match.matchTeams ?? []).forEach((mt) => {
      if (mt.teamId) ids.add(mt.teamId);
      if (mt.team?.id) ids.add(mt.team.id);
    });
    (match.matchSlots ?? []).forEach((ms) => {
      if (ms.teamId) ids.add(ms.teamId);
      if (ms.team?.id) ids.add(ms.team.id);
    });
    return Array.from(ids.values());
  }

  private computeBr(config: any, teams: string[], events: any[]) {
    const placementPoints = config?.placementPoints ?? {};
    const killPoints =
      typeof config?.killPoints === 'number' ? config.killPoints : 1;
    const placements = new Map<string, number>();
    events.forEach((evt) => {
      if (
        (evt.type === MatchEventType.TEAM_PLACEMENT ||
          evt.type === 'TEAM_PLACEMENT') &&
        evt.teamId &&
        typeof evt.payload?.placement === 'number'
      ) {
        placements.set(evt.teamId, evt.payload.placement);
      }
    });
    const { teamKills, playerKills } = this.countKills(events);
    const teamResults = teams.map((teamId) => {
      const placement = placements.get(teamId) ?? null;
      const placementScore =
        placement !== null && placement !== undefined
          ? Number(
              placementPoints?.[placement as keyof typeof placementPoints] ?? 0,
            )
          : 0;
      const kills = teamKills.get(teamId) ?? 0;
      const killScore = kills * killPoints;
      return {
        teamId,
        score: placementScore + killScore,
        placement,
        kills,
        stats: { kills },
      };
    });
    return { teamResults, playerKills };
  }

  private computeRoundWins(config: any, teams: string[], events: any[]) {
    const roundWinPoints =
      typeof config?.roundWinPoints === 'number' ? config.roundWinPoints : 1;
    const winBonus = typeof config?.winBonus === 'number' ? config.winBonus : 0;
    const wins = new Map<string, number>();
    events.forEach((evt) => {
      const type = evt?.type as string;
      if (type === 'ROUND_END' || type === 'ROUND_WIN') {
        const winner =
          evt.payload?.winnerTeamId ??
          evt.payload?.teamId ??
          evt.teamId ??
          null;
        if (winner) wins.set(winner, (wins.get(winner) ?? 0) + 1);
      }
    });
    const { teamKills, playerKills } = this.countKills(events);
    const teamResults = teams.map((teamId) => {
      const won = wins.get(teamId) ?? 0;
      const score = won * roundWinPoints + (won > 0 ? winBonus : 0);
      const kills = teamKills.get(teamId) ?? 0;
      return {
        teamId,
        score,
        placement: null,
        kills,
        roundsWon: won,
        stats: { kills, roundsWon: won },
      };
    });
    return { teamResults, playerKills };
  }

  private computeSeries(config: any, teams: string[], events: any[]) {
    const mapWinPoints =
      typeof config?.mapWinPoints === 'number' ? config.mapWinPoints : 1;
    const seriesWinBonus =
      typeof config?.seriesWinBonus === 'number' ? config.seriesWinBonus : 0;
    const mapWins = new Map<string, number>();
    events.forEach((evt) => {
      const type = evt?.type as string;
      if (type === 'MAP_WIN' || type === MatchEventType.MATCH_END) {
        const winner =
          evt.payload?.winnerTeamId ??
          evt.payload?.mapWinnerTeamId ??
          evt.teamId ??
          null;
        if (winner) mapWins.set(winner, (mapWins.get(winner) ?? 0) + 1);
      }
    });
    const { teamKills, playerKills } = this.countKills(events);
    const teamResults = teams.map((teamId) => {
      const wins = mapWins.get(teamId) ?? 0;
      const score = wins * mapWinPoints + (wins > 1 ? seriesWinBonus : 0);
      const kills = teamKills.get(teamId) ?? 0;
      return {
        teamId,
        score,
        placement: null,
        kills,
        mapsWon: wins,
        stats: { kills, mapsWon: wins },
      };
    });
    return { teamResults, playerKills };
  }

  private selectRuleset = async (match: {
    rulesetId?: string | null;
    tournament: {
      rulesetId?: string | null;
      game: GameKey;
      ownerUserId: string;
    };
  }) => {
    if (match.rulesetId) {
      const rs = await this.prisma.ruleset.findUnique({
        where: { id: match.rulesetId },
      });
      if (rs) return rs;
    }
    if (match.tournament?.rulesetId) {
      const rs = await this.prisma.ruleset.findUnique({
        where: { id: match.tournament.rulesetId },
      });
      if (rs) return rs;
    }
    const rs = await this.prisma.ruleset.findFirst({
      where: { gameKey: match.tournament.game, isDefault: true },
      orderBy: { updatedAt: 'desc' },
    });
    if (rs) return rs;
    return {
      id: null,
      gameKey: match.tournament.game,
      config: this.defaultRulesetConfig(match.tournament.game),
      name: 'Default',
      orgId: null,
      isDefault: true,
    };
  };

  async recalculateMatch(matchId: string, actor: Actor): Promise<any> {
    const match = await this.prisma.match.findFirst({
      where: { id: matchId, deletedAt: null },
      select: {
        id: true,
        rulesetId: true,
        tournament: {
          select: { ownerUserId: true, game: true, rulesetId: true },
        },
        matchTeams: {
          where: { deletedAt: null },
          select: { teamId: true, team: { select: { id: true } } },
        },
        matchSlots: {
          select: { teamId: true, team: { select: { id: true } } },
        },
      },
    });
    if (!match) throw new NotFoundException('Match not found');
    if (!match.tournament) {
      throw new BadRequestException(
        'Session matches are not supported by scoring recalculation',
      );
    }
    const tournamentMatch = {
      ...match,
      tournament: match.tournament,
    };
    this.ensureAccess(tournamentMatch.tournament.ownerUserId, actor);
    const ruleset = await this.selectRuleset(tournamentMatch);

    const teams = this.buildTeamList({
      matchTeams: match.matchTeams,
      matchSlots: match.matchSlots,
    });
    const events = await this.prisma.matchEvent.findMany({
      where: { matchId },
      orderBy: { seq: 'asc' },
      select: {
        type: true,
        teamId: true,
        playerId: true,
        payload: true,
      },
    });

    const configValue = ruleset?.config;
    const configObject =
      configValue &&
      typeof configValue === 'object' &&
      !Array.isArray(configValue)
        ? (configValue as { type?: string })
        : {};
    const type = configObject.type ?? 'BR_POINTS';
    let computed:
      | { teamResults: any[]; playerKills: Map<string, number> }
      | undefined;
    if (type === 'ROUND_WINS') {
      computed = this.computeRoundWins(ruleset.config, teams, events);
    } else if (type === 'SERIES_BO3') {
      computed = this.computeSeries(ruleset.config, teams, events);
    } else {
      computed = this.computeBr(ruleset.config, teams, events);
    }

    const playerStats = Array.from(computed.playerKills.entries()).map(
      ([playerId, kills]) => ({
        playerId,
        stats: { kills },
      }),
    );

    const payload = {
      matchId,
      rulesetId: ruleset?.id ?? null,
      rulesetConfig:
        ruleset?.config ??
        this.defaultRulesetConfig(tournamentMatch.tournament.game),
      teams: computed.teamResults,
      players: playerStats,
      computedAt: new Date().toISOString(),
    };

    const prismaAny = this.prisma as any;
    const saved = await prismaAny.matchScore.upsert({
      where: { matchId },
      update: {
        data: payload,
        computedAt: new Date(),
        rulesetId: ruleset?.id ?? null,
      },
      create: {
        matchId,
        rulesetId: ruleset?.id ?? null,
        data: payload,
      },
    });

    // Fire scoreboard update using existing builder for compatibility.
    void this.scoreboard.broadcast(matchId);

    return saved;
  }

  getMatchScore(matchId: string): Promise<unknown> {
    const prismaAny = this.prisma as any;
    return prismaAny.matchScore.findUnique({
      where: { matchId },
    }) as Promise<unknown>;
  }
}
