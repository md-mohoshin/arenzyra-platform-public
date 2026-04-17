import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  forwardRef,
} from '@nestjs/common';
import { LiveState, MatchStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../db/prisma.service';
import { buildWidgetScoreboardSnapshot } from '../widgets/widgets.snapshot';
import {
  ResultsService,
  type TelemetryFinalPlacementProjection,
} from './results.service';
import { ResultsEventsService } from './results-events.service';
import { ScoringService } from '../scoring/scoring.service';
import { PcobGateway } from '../pcob/pcob.gateway';
import { TopFraggerService } from '../widgets/top-fragger/top-fragger.service';
import { MvpService } from '../widgets/mvp/mvp.service';
import { isMatchFinishedStatus } from '../../common/match-status.util';
import { RealtimeGateway } from '../../realtime/realtime.gateway';
import { isSessionMatch } from '../../common/match-context.util';
import { TelemetryEngineService } from '../telemetry/telemetry-engine.service';
import type {
  MatchStateLeaderboardRow,
  ObserverMatchFinishedPayload,
} from '../observer/match-state.service';
import type { TelemetryMatchState } from '../telemetry/telemetry.types';

type ControlMeta = {
  resultFinalized?: boolean;
  finalizedAt?: string | null;
  winnerTeamId?: string | null;
  aliveTeamsAtEnd?: number | null;
  resultNeedsConfirmation?: boolean;
  resultAmbiguities?: Array<{
    code: string;
    teamIds: string[];
    placementFrom: number;
    placementTo: number;
    detectedAt: string | null;
    message: string;
  }> | null;
} | null;

const DEFAULT_WIDGET_TEAM_NAME = 'Arenzyra';
const DEFAULT_WIDGET_TEAM_TAG = 'AZ';

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
};

const parseTimestampMs = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 1_000_000_000_000 ? value : value * 1000;
  }
  if (value instanceof Date) {
    return value.getTime();
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
};

@Injectable()
export class MatchConclusionService {
  private readonly logger = new Logger('MatchConclusion');
  private readonly observerTelemetryWindowMs = Math.max(
    1_000,
    Number(process.env.OBSERVER_TELEMETRY_ACTIVE_WINDOW_MS ?? 5_000),
  );
  private readonly placementAmbiguityWindowMs = Math.max(
    0,
    Number(process.env.RESULT_PLACEMENT_AMBIGUITY_WINDOW_MS ?? 1_000),
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly results: ResultsService,
    private readonly resultEvents: ResultsEventsService,
    private readonly scoring: ScoringService,
    private readonly realtime: RealtimeGateway,
    @Inject(forwardRef(() => PcobGateway))
    private readonly pcobGateway: PcobGateway,
    private readonly topFragger: TopFraggerService,
    private readonly mvp: MvpService,
    @Inject(forwardRef(() => TelemetryEngineService))
    private readonly telemetryEngine: TelemetryEngineService,
  ) {}

  private requireOrganizationId(match: {
    organizationId?: string | null;
    tournament?: { organizationId?: string | null } | null;
  }): string {
    const organizationId =
      match.organizationId ?? match.tournament?.organizationId ?? null;
    if (!organizationId) {
      throw new BadRequestException(
        'organizationId is required for match conclusion',
      );
    }
    return organizationId;
  }

  async isConcluded(matchId: string): Promise<boolean> {
    const match = await this.prisma.match.findFirst({
      where: { id: matchId, deletedAt: null },
      select: {
        status: true,
        controlState: { select: { metaJson: true } },
      },
    });
    if (!match) return false;
    const meta = (match.controlState?.metaJson as ControlMeta) ?? null;
    if (meta?.resultFinalized) return true;
    if (isMatchFinishedStatus(match.status)) return true;
    return false;
  }

  async conclude(
    matchId: string,
    opts: {
      winnerTeamId?: string | null;
      aliveTeams?: number | null;
      source?: string;
    } = {},
  ): Promise<boolean> {
    const now = new Date();
    const match = await this.prisma.match.findFirst({
      where: { id: matchId, deletedAt: null },
      select: {
        id: true,
        organizationId: true,
        sessionId: true,
        status: true,
        liveState: true,
        endedAt: true,
        endedReason: true,
        pcobSessionId: true,
        tournament: { select: { organizationId: true } },
        controlState: { select: { metaJson: true } },
      },
    });
    if (!match) return false;

    if (opts.source === 'SHADOW_TELEMETRY') {
      const hasBoundPcobSession =
        typeof match.pcobSessionId === 'string' &&
        match.pcobSessionId.trim().length > 0;
      if (
        hasBoundPcobSession ||
        (await this.hasRecentObserverTelemetry(matchId))
      ) {
        this.logger.warn(
          `Ignoring shadow telemetry conclusion for observer-managed match=${matchId}`,
        );
        return false;
      }
    }

    const meta = (match.controlState?.metaJson as ControlMeta) ?? null;
    if (meta?.resultFinalized) {
      // Already finalized; ensure snapshots exist but avoid double work.
      await this.captureSnapshots(matchId);
      return true;
    }

    const finalState = await this.telemetryEngine.getState(matchId);
    const finalProjection = this.buildCanonicalFinalProjection(finalState);
    const endedAt =
      match.endedAt ?? new Date(finalState.endedAt ?? now.getTime());
    const finalizedAt = meta?.finalizedAt ?? endedAt.toISOString();
    const winnerTeamId = finalProjection.winnerTeamId;
    const resultAmbiguities = finalProjection.ambiguities ?? [];
    const nextMeta: ControlMeta = {
      ...(meta ?? {}),
      resultFinalized: true,
      finalizedAt,
      winnerTeamId,
      aliveTeamsAtEnd: finalProjection.aliveTeamsAtEnd,
      resultNeedsConfirmation: resultAmbiguities.length > 0,
      resultAmbiguities:
        resultAmbiguities.length > 0 ? resultAmbiguities : null,
    };

    try {
      await this.results.ensureResultsFromSlots(matchId);
      await this.results.applyTelemetryStateToResults(matchId, {
        finalize: true,
        state: finalState,
        finalProjection,
      });
      await this.results.recalculateMatchResults(matchId);
      await this.results.finalizeMatchResults(matchId);
      await this.results.assertMatchStateConsistency(matchId);
      if (!isSessionMatch(match)) {
        await this.scoring.recomputeMatchAndTournament(matchId);
      }
      await this.prisma.$transaction(async (tx) => {
        const orgId = this.requireOrganizationId(match);
        await tx.matchControlState.upsert({
          where: { matchId },
          update: {
            state: 'CONFIRMED',
            reason: opts.source ?? 'AUTO_MATCH_CONCLUDED',
            metaJson: nextMeta as Prisma.JsonObject,
            version: { increment: 1 },
            updatedAt: now,
          },
          create: {
            matchId,
            state: 'CONFIRMED',
            reason: opts.source ?? 'AUTO_MATCH_CONCLUDED',
            organizationId: orgId,
            metaJson: nextMeta as Prisma.JsonObject,
            updatedAt: now,
          },
        });

        await tx.match.update({
          where: { id: matchId },
          data: {
            status: MatchStatus.FINISHED,
            liveState: LiveState.ENDED,
            endedAt,
            endedReason:
              match.endedReason ?? opts.source ?? 'AUTO_MATCH_CONCLUDED',
          },
        });
      });
      this.logger.log(
        JSON.stringify({
          action: 'match-conclusion-finalized',
          matchId,
          previousLifecycleStatus: 'ENDED',
          nextLifecycleStatus: 'FINISHED',
          resultFinalized: true,
          resultNeedsConfirmation: resultAmbiguities.length > 0,
          ambiguityCount: resultAmbiguities.length,
          totalTeams: finalProjection.totalTeams,
          placementsAssigned: finalProjection.placementsAssigned,
        }),
      );
      if (resultAmbiguities.length > 0) {
        this.logger.warn(
          JSON.stringify({
            action: 'match-conclusion-ambiguity',
            matchId,
            ambiguityCount: resultAmbiguities.length,
            ambiguities: resultAmbiguities,
          }),
        );
      }
      await this.captureSnapshots(matchId);
      this.resultEvents.emitResultsUpdated(matchId, 0, {
        source: 'MATCH_CONCLUDED',
      });
      this.resultEvents.emitLeaderboardUpdated(matchId, {
        source: 'MATCH_CONCLUDED',
      });
      await this.topFragger.finalize(matchId).catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Top fragger finalize skipped for ${matchId}: ${msg}`);
      });
      await this.mvp.finalize(matchId).catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`MVP finalize skipped for ${matchId}: ${msg}`);
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Post-conclusion pipeline failed for ${matchId}: ${msg}`,
      );
      return false;
    }

    try {
      const observerFinishedPayload =
        await this.buildObserverMatchFinishedPayload(
          matchId,
          winnerTeamId,
          finalizedAt,
        );
      if (observerFinishedPayload) {
        this.realtime.emitObserverMatchFinished(observerFinishedPayload);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Observer match finished emit failed for ${matchId}: ${msg}`,
      );
    }

    try {
      this.pcobGateway.emitLastTeamStanding(matchId, {
        matchId,
        winnerTeamId,
        finalizedAt,
      });
      this.pcobGateway.emitMatchConcluded(matchId, {
        matchId,
        winnerTeamId,
        concludedAt: finalizedAt,
        reason: opts.source ?? 'AUTO_MATCH_CONCLUDED',
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Match concluded broadcast failed for ${matchId}: ${msg}`,
      );
    }

    return true;
  }

  private async hasRecentObserverTelemetry(matchId: string): Promise<boolean> {
    const row = await this.prisma.matchTelemetry.findUnique({
      where: { matchId },
      select: { payload: true },
    });
    const payload = asRecord(row?.payload ?? null);
    const observerTelemetry = asRecord(payload?.observerTelemetry);
    if (!observerTelemetry) {
      return false;
    }

    const sessionId =
      typeof observerTelemetry.sessionId === 'string'
        ? observerTelemetry.sessionId.trim()
        : '';
    if (sessionId.length > 0) {
      return true;
    }

    const receivedAtMs = parseTimestampMs(observerTelemetry.receivedAt);
    return (
      receivedAtMs !== null &&
      Date.now() - receivedAtMs <= this.observerTelemetryWindowMs
    );
  }

  private hasExplicitTelemetryPresence(state: TelemetryMatchState): boolean {
    return (
      Object.values(state.teams ?? {}).some(
        (team) => team.metadata?.wasPresentInMatch === true,
      ) ||
      Object.values(state.players ?? {}).some(
        (player) => player.metadata?.observedInTelemetry === true,
      )
    );
  }

  private collectActiveTelemetryTeamIds(
    state: TelemetryMatchState,
  ): Set<string> {
    const activeTeamIds = new Set<string>();

    for (const [teamId, team] of Object.entries(state.teams ?? {})) {
      if (team.metadata?.wasPresentInMatch === true) {
        activeTeamIds.add(teamId);
      }
    }

    for (const player of Object.values(state.players ?? {})) {
      if (player.metadata?.observedInTelemetry === true) {
        activeTeamIds.add(player.teamId);
      }
    }

    return activeTeamIds;
  }

  private describeTeamIds(teamIds: string[]): string {
    if (teamIds.length <= 3) {
      return teamIds.join(', ');
    }
    return `${teamIds.slice(0, 3).join(', ')} +${teamIds.length - 3} more`;
  }

  private detectPlacementAmbiguities(params: {
    totalTeams: number;
    endedAt: number;
    aliveTeams: Array<{
      teamId: string;
      totalKills: number;
      slot: number;
    }>;
    eliminatedTeams: Array<{
      teamId: string;
      eliminatedAt: number | null;
    }>;
  }): NonNullable<TelemetryFinalPlacementProjection['ambiguities']> {
    const { totalTeams, endedAt, aliveTeams, eliminatedTeams } = params;
    const ambiguities: NonNullable<
      TelemetryFinalPlacementProjection['ambiguities']
    > = [];

    if (aliveTeams.length > 1) {
      ambiguities.push({
        code: 'MULTIPLE_TEAMS_ALIVE_AT_END',
        teamIds: aliveTeams.map((team) => team.teamId),
        placementFrom: 1,
        placementTo: aliveTeams.length,
        detectedAt: new Date(endedAt).toISOString(),
        message: `Telemetry ended with multiple teams still alive (${this.describeTeamIds(
          aliveTeams.map((team) => team.teamId),
        )}); placements were auto-ordered by kills, then slot.`,
      });
    }

    let groupStart = 0;
    while (groupStart < eliminatedTeams.length) {
      const firstTime = eliminatedTeams[groupStart].eliminatedAt ?? endedAt;
      let groupEnd = groupStart;
      while (groupEnd + 1 < eliminatedTeams.length) {
        const nextTime = eliminatedTeams[groupEnd + 1].eliminatedAt ?? endedAt;
        if (nextTime - firstTime > this.placementAmbiguityWindowMs) {
          break;
        }
        groupEnd += 1;
      }

      if (groupEnd > groupStart) {
        const group = eliminatedTeams.slice(groupStart, groupEnd + 1);
        ambiguities.push({
          code: 'SIMULTANEOUS_ELIMINATION',
          teamIds: group.map((team) => team.teamId),
          placementFrom: totalTeams - groupEnd,
          placementTo: totalTeams - groupStart,
          detectedAt: new Date(firstTime).toISOString(),
          message: `Teams ${this.describeTeamIds(
            group.map((team) => team.teamId),
          )} were eliminated within ${this.placementAmbiguityWindowMs}ms; placements were auto-ordered by slot fallback.`,
        });
      }

      groupStart = groupEnd + 1;
    }

    return ambiguities;
  }

  private buildCanonicalFinalProjection(
    state: TelemetryMatchState,
  ): TelemetryFinalPlacementProjection {
    const playersByTeam = new Map<
      string,
      Array<TelemetryMatchState['players'][string]>
    >();
    const activeTeamIds = this.hasExplicitTelemetryPresence(state)
      ? this.collectActiveTelemetryTeamIds(state)
      : null;

    for (const player of Object.values(state.players)) {
      if (activeTeamIds && player.metadata?.observedInTelemetry !== true) {
        continue;
      }
      const bucket = playersByTeam.get(player.teamId) ?? [];
      bucket.push(player);
      playersByTeam.set(player.teamId, bucket);
    }

    const teams = Object.entries(state.teams)
      .filter(([teamId]) => !activeTeamIds || activeTeamIds.has(teamId))
      .map(([teamId, team]) => {
        const players = playersByTeam.get(teamId) ?? [];
        const alivePlayers = players.filter(
          (player) => player.alive === true,
        ).length;
        const totalKills =
          typeof team.totalKills === 'number' &&
          Number.isFinite(team.totalKills)
            ? team.totalKills
            : players.reduce(
                (sum, player) => sum + Math.max(0, player.kills ?? 0),
                0,
              );
        const slot =
          typeof team.metadata?.slot === 'number' &&
          Number.isFinite(team.metadata.slot)
            ? Math.trunc(team.metadata.slot)
            : Number.MAX_SAFE_INTEGER;
        return {
          teamId,
          slot,
          aliveAtEnd:
            alivePlayers > 0 ||
            (team.eliminated !== true && team.placement === 1),
          totalKills,
          eliminatedAt:
            typeof team.eliminatedAt === 'number' &&
            Number.isFinite(team.eliminatedAt)
              ? team.eliminatedAt
              : null,
        };
      });

    const endedAt = state.endedAt ?? state.updatedAt;
    const aliveTeams = teams
      .filter((team) => team.aliveAtEnd)
      .sort((left, right) => {
        if (right.totalKills !== left.totalKills) {
          return right.totalKills - left.totalKills;
        }
        if (left.slot !== right.slot) {
          return left.slot - right.slot;
        }
        return left.teamId.localeCompare(right.teamId);
      });
    const eliminatedTeams = teams
      .filter((team) => !team.aliveAtEnd)
      .sort((left, right) => {
        const leftEndedAt = left.eliminatedAt ?? endedAt;
        const rightEndedAt = right.eliminatedAt ?? endedAt;
        if (leftEndedAt !== rightEndedAt) {
          return leftEndedAt - rightEndedAt;
        }
        if (left.slot !== right.slot) {
          return left.slot - right.slot;
        }
        return left.teamId.localeCompare(right.teamId);
      });
    const ambiguities = this.detectPlacementAmbiguities({
      totalTeams: teams.length,
      endedAt,
      aliveTeams,
      eliminatedTeams,
    });

    const placements = new Map<string, number>();
    let placementCursor = teams.length;
    for (const team of eliminatedTeams) {
      placements.set(team.teamId, placementCursor);
      placementCursor -= 1;
    }
    aliveTeams.forEach((team, index) => {
      placements.set(team.teamId, index + 1);
    });

    const projectionTeams: TelemetryFinalPlacementProjection['teams'] = {};
    for (const team of teams) {
      const placement = placements.get(team.teamId);
      if (!placement) {
        continue;
      }
      projectionTeams[team.teamId] = {
        placement,
        eliminatedOrder:
          placement === 1 ? null : Math.max(teams.length - placement + 1, 1),
        eliminatedAt:
          team.aliveAtEnd && placement === 1
            ? null
            : team.aliveAtEnd
              ? endedAt
              : (team.eliminatedAt ?? endedAt),
        totalKills: team.totalKills,
        aliveAtEnd: team.aliveAtEnd,
      };
    }

    const winnerTeamId =
      Object.entries(projectionTeams).find(
        ([, team]) => team.placement === 1,
      )?.[0] ?? null;

    return {
      totalTeams: teams.length,
      aliveTeamsAtEnd: aliveTeams.length,
      placementsAssigned: Object.keys(projectionTeams).length,
      winnerTeamId,
      needsConfirmation: ambiguities.length > 0,
      ambiguities,
      teams: projectionTeams,
    };
  }

  private async captureSnapshots(matchId: string): Promise<void> {
    // Store team scoreboard snapshot
    const scoreboard = await buildWidgetScoreboardSnapshot(
      this.prisma,
      matchId,
      {
        includeLogos: true,
        brandMode: 'dark',
      },
    );

    // Store player stats snapshot
    const players = await this.prisma.matchSlotPlayerResult.findMany({
      where: { slotResult: { matchId } },
      select: {
        playerId: true,
        playerName: true,
        slotResult: { select: { teamId: true, slotNumber: true } },
        kills: true,
        knocks: true,
        isAlive: true,
        organizationId: true,
      },
    });

    const payload = {
      matchId,
      players: players.map((p) => ({
        playerId: p.playerId ?? null,
        playerName: p.playerName ?? null,
        teamId: p.slotResult?.teamId ?? null,
        slot: p.slotResult?.slotNumber ?? null,
        kills: p.kills ?? 0,
        assists: p.knocks ?? 0,
        survivalTime: null,
        damage: null,
        alive: p.isAlive ?? null,
      })),
    };

    const ctrl = await this.prisma.matchControlState.findUnique({
      where: { matchId },
      select: { metaJson: true, organizationId: true },
    });
    const orgLookup = await this.prisma.match.findUnique({
      where: { id: matchId },
      select: {
        organizationId: true,
        tournament: { select: { organizationId: true } },
      },
    });
    const base =
      (ctrl?.metaJson as Record<string, unknown> | null | undefined) ?? {};
    const organizationId =
      ctrl?.organizationId ??
      orgLookup?.organizationId ??
      orgLookup?.tournament?.organizationId ??
      (() => {
        throw new BadRequestException(
          'organizationId is required for match snapshots',
        );
      })();
    await this.prisma.matchControlState.upsert({
      where: { matchId },
      update: {
        metaJson: {
          ...base,
          lastScoreboardSnapshot: scoreboard,
          lastPlayerSnapshot: payload,
        } as Prisma.JsonObject,
      },
      create: {
        matchId,
        organizationId,
        metaJson: {
          ...base,
          lastScoreboardSnapshot: scoreboard,
          lastPlayerSnapshot: payload,
        } as Prisma.JsonObject,
      },
    });
  }

  private async buildObserverMatchFinishedPayload(
    matchId: string,
    winnerTeamId: string | null,
    finishedAt: string,
  ): Promise<ObserverMatchFinishedPayload | null> {
    const slotResults = await this.prisma.matchSlotResult.findMany({
      where: { matchId, teamId: { not: null }, wasPresentInMatch: true },
      select: {
        slotNumber: true,
        teamId: true,
        placement: true,
        totalKills: true,
        team: {
          select: {
            id: true,
            name: true,
            tag: true,
            logoUrl: true,
            accentLight: true,
            accentDark: true,
          },
        },
        players: {
          select: {
            playerId: true,
            playerName: true,
            kills: true,
            isAlive: true,
            alive: true,
            isKnocked: true,
            player: {
              select: {
                photoUrl: true,
              },
            },
          },
        },
      },
    });

    if (!slotResults.length) {
      return null;
    }

    const finalLeaderboard = slotResults
      .map<MatchStateLeaderboardRow>((slotResult) => {
        const teamName =
          slotResult.team?.name?.trim() || DEFAULT_WIDGET_TEAM_NAME;
        const alivePlayers = (slotResult.players ?? []).reduce(
          (count, player) =>
            player.isAlive === true || player.alive === true
              ? count + 1
              : count,
          0,
        );

        return {
          rank: 0,
          teamId: slotResult.teamId ?? slotResult.team?.id ?? null,
          slot: slotResult.slotNumber,
          teamName,
          teamTag: slotResult.team?.tag ?? DEFAULT_WIDGET_TEAM_TAG,
          logoUrl: slotResult.team?.logoUrl ?? null,
          color:
            slotResult.team?.accentLight ?? slotResult.team?.accentDark ?? null,
          kills: Math.max(0, slotResult.totalKills ?? 0),
          alivePlayers,
          totalPlayers:
            slotResult.players.length > 0 ? slotResult.players.length : null,
          placement: slotResult.placement ?? null,
          isEliminated: slotResult.placement === 1 ? false : true,
          players: slotResult.players.map((player) => ({
            playerId: player.playerId ?? null,
            playerName: player.playerName,
            avatarUrl: player.player?.photoUrl ?? null,
            kills: Math.max(0, player.kills ?? 0),
            alive: player.isAlive === true || player.alive === true,
            knocked: player.isKnocked === true,
            health: null,
            hasDied:
              player.isAlive === true || player.alive === true ? false : true,
          })),
        };
      })
      .sort((left, right) => {
        const leftPlacement =
          typeof left.placement === 'number'
            ? left.placement
            : Number.MAX_SAFE_INTEGER;
        const rightPlacement =
          typeof right.placement === 'number'
            ? right.placement
            : Number.MAX_SAFE_INTEGER;
        if (leftPlacement !== rightPlacement) {
          return leftPlacement - rightPlacement;
        }
        if (right.kills !== left.kills) {
          return right.kills - left.kills;
        }
        return (
          (left.slot ?? Number.MAX_SAFE_INTEGER) -
          (right.slot ?? Number.MAX_SAFE_INTEGER)
        );
      })
      .map((row, index) => ({
        ...row,
        rank: index + 1,
        placement: row.placement ?? null,
      }));

    const winnerRow =
      finalLeaderboard.find((row) => row.teamId === winnerTeamId) ??
      finalLeaderboard.find((row) => row.placement === 1) ??
      finalLeaderboard[0] ??
      null;

    return {
      matchId,
      winnerTeamId: winnerRow?.teamId ?? winnerTeamId ?? null,
      winnerTeamName: winnerRow?.teamName ?? null,
      finalLeaderboard,
      finishedAt,
    };
  }
}
