/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */

/* eslint-disable @typescript-eslint/no-unsafe-argument */
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { GameKey, MatchEventType, MatchStatus } from '@prisma/client';
import { PrismaService } from '../../db/prisma.service';
import {
  ScoreboardEvent,
  ScoreboardPlayer,
  ScoreboardTeam,
  ScoreboardView,
} from '../../common/scoreboard/scoreboard.types';
import {
  derivePresenceStatus,
  isPresentInMatch,
} from '../../common/results-presence.util';
import { MatchControlStateStore } from '../match-control/state.store';
import type { ControlState } from '../match-control/dto/control.dto';
import { OverlayBroadcaster } from '../realtime/overlay-broadcaster.service';
import { BroadcastService } from '../broadcast/broadcast.service';
import {
  computeKillPoints,
  resolvePlacementPoints,
} from '../scoring/points-core';
import { isMatchFinishedStatus } from '../../common/match-status.util';

@Injectable()
export class ScoreboardService {
  private readonly logger = new Logger('ScoreboardService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly stateStore: MatchControlStateStore,
    private readonly overlay: OverlayBroadcaster,
    private readonly broadcastService: BroadcastService,
  ) {}

  private extractNumber(input: unknown): number | null {
    return typeof input === 'number' && Number.isFinite(input) ? input : null;
  }

  private mapStatus(
    matchStatus: MatchStatus,
    controlStatus?: ControlState | null,
  ): ScoreboardView['status'] {
    if (controlStatus) {
      const normalized = controlStatus.toUpperCase();
      if (normalized === 'LIVE') return 'LIVE';
      if (normalized === 'PAUSED') return 'PAUSED';
      if (normalized === 'ENDED' || normalized === 'CONFIRMED') return 'ENDED';
      return 'WAITING';
    }
    if (matchStatus === MatchStatus.LIVE) return 'LIVE';
    if (isMatchFinishedStatus(matchStatus)) return 'ENDED';
    return 'SETUP';
  }

  private formatEvent(
    evt: {
      seq: number;
      type: MatchEventType;
      timestamp: Date;
      payload: Record<string, unknown> | null;
      teamId: string | null;
      playerId: string | null;
    },
    teamName?: string | null,
    playerName?: string | null,
  ): ScoreboardEvent {
    const ts = evt.timestamp.toISOString();
    const payload = evt.payload ?? {};
    let text: string = evt.type;
    if (evt.type === MatchEventType.KILL) {
      text = `${playerName ?? teamName ?? 'Unknown'} secured a kill`;
    } else if (evt.type === MatchEventType.TEAM_PLACEMENT) {
      const placement = this.extractNumber(
        (payload as { placement?: unknown })?.placement,
      );
      text = `${teamName ?? 'Team'} placed #${placement ?? '?'}`;
    }
    return {
      seq: evt.seq,
      ts,
      type: evt.type,
      text,
      teamId: evt.teamId ?? undefined,
      playerId: evt.playerId ?? undefined,
      payload: evt.payload ?? undefined,
    };
  }

  private buildTeamList(match: {
    matchTeams?: Array<{
      teamId: string;
      team: {
        id: string;
        name: string | null;
        logoUrl: string | null;
        players: { id: string; ign: string; realName: string | null }[];
      } | null;
    }>;
    matchSlots?: Array<{
      teamId: string | null;
      team: {
        id: string;
        name: string | null;
        logoUrl: string | null;
        players: { id: string; ign: string; realName: string | null }[];
      } | null;
    }>;
  }) {
    const map = new Map<
      string,
      {
        id: string;
        name: string | null;
        logoUrl: string | null;
        players: { id: string; ign: string; realName: string | null }[];
      }
    >();
    [...(match.matchTeams ?? []), ...(match.matchSlots ?? [])].forEach(
      (item) => {
        const team = item.team;
        if (team?.id && !map.has(team.id)) {
          map.set(team.id, {
            id: team.id,
            name: team.name ?? 'Team',
            logoUrl: team.logoUrl,
            players: team.players ?? [],
          });
        }
      },
    );
    return Array.from(map.values());
  }

  private mergeTeamStats(options: {
    teams: ReturnType<ScoreboardService['buildTeamList']>;
    teamStats: Array<{
      teamId: string;
      kills: number;
      placement: number | null;
      totalPoints: number;
      placementPoints?: number | null;
      wasPresentInMatch?: boolean | null;
    }>;
    killCounts: Map<string, number>;
    placementFromEvents: Map<string, number>;
    liveState?: {
      teams?: Array<{
        teamId: string;
        alivePlayers?: number | null;
        totalPlayers?: number | null;
      }>;
    } | null;
  }): ScoreboardTeam[] {
    const statMap = new Map(options.teamStats.map((s) => [s.teamId, s]));
    const liveMap = new Map(
      (options.liveState?.teams ?? []).map((t) => [t.teamId, t]),
    );
    return options.teams.flatMap<ScoreboardTeam>((t) => {
      const stat = statMap.get(t.id);
      if (!isPresentInMatch(stat?.wasPresentInMatch)) {
        return [];
      }
      const live = liveMap.get(t.id);
      const kills = stat?.kills ?? options.killCounts.get(t.id) ?? 0;
      const placement =
        stat?.placement ?? options.placementFromEvents.get(t.id) ?? null;
      const score = stat?.totalPoints ?? 0;
      const stats: Record<string, number> = {};
      if (kills) stats.kills = kills;
      return [
        {
          teamId: t.id,
          name: t.name ?? 'Team',
          logoUrl: t.logoUrl ?? null,
          score,
          placement,
          aliveCount: live?.alivePlayers ?? null,
          wasPresentInMatch: stat?.wasPresentInMatch ?? null,
          presenceStatus: derivePresenceStatus(stat?.wasPresentInMatch ?? null),
          stats,
        },
      ];
    });
  }

  private mergePlayerStats(options: {
    teams: ReturnType<ScoreboardService['buildTeamList']>;
    playerKills: Map<string, number>;
  }): ScoreboardPlayer[] {
    const players: ScoreboardPlayer[] = [];
    options.teams.forEach((team) => {
      (team.players ?? []).forEach((p) => {
        const kills = options.playerKills.get(p.id) ?? 0;
        const stats: Record<string, number> = {};
        if (kills) stats.kills = kills;
        players.push({
          playerId: p.id,
          name: p.realName ?? p.ign ?? 'Player',
          teamId: team.id,
          stats,
          isAlive: null,
        });
      });
    });
    return players;
  }

  async buildScoreboard(
    matchId: string,
    organizationId?: string | null,
  ): Promise<ScoreboardView> {
    type MatchContext = {
      id: string;
      status: MatchStatus;
      startedAt: Date | null;
      endedAt: Date | null;
      adapterKey?: string | null;
      map?: string | null;
      game?: { key: GameKey | null } | null;
      tournament?: { game: GameKey | null } | null;
      matchTeams?: Array<{
        teamId: string;
        team: {
          id: string;
          name: string | null;
          logoUrl: string | null;
          players: { id: string; ign: string; realName: string | null }[];
        } | null;
      }>;
      matchSlots?: Array<{
        teamId: string | null;
        team: {
          id: string;
          name: string | null;
          logoUrl: string | null;
          players: { id: string; ign: string; realName: string | null }[];
        } | null;
      }>;
    };

    const matchSelect: Record<string, unknown> = {
      id: true,
      status: true,
      startedAt: true,
      endedAt: true,
      adapterKey: true,
      map: true,
      game: { select: { key: true } },
      tournament: { select: { game: true } },
      matchTeams: {
        where: { deletedAt: null },
        select: {
          teamId: true,
          team: {
            select: {
              id: true,
              name: true,
              logoUrl: true,
              players: {
                select: { id: true, ign: true, realName: true },
              },
            },
          },
        },
      },
      matchSlots: {
        include: {
          team: {
            select: {
              id: true,
              name: true,
              logoUrl: true,
              players: {
                select: { id: true, ign: true, realName: true },
              },
            },
          },
        },
      },
    };
    const fields =
      (
        (this.prisma as any)?._dmmf?.modelMap?.Match?.fields as
          | Array<{ name: string }>
          | undefined
      )?.map((f) => f.name) ?? [];
    const supported = new Set(fields);
    if (!supported.has('adapterKey')) delete (matchSelect as any).adapterKey;
    if (!supported.has('game')) delete (matchSelect as any).game;

    const match = (await this.prisma.match.findFirst({
      where: {
        id: matchId,
        deletedAt: null,
        ...(organizationId ? { organizationId } : {}),
      },
      select: matchSelect as any,
    })) as MatchContext | null;
    if (!match) throw new NotFoundException('Match not found');

    const [events, teamStats, liveState] = await Promise.all([
      this.prisma.matchEvent.findMany({
        where: { matchId },
        orderBy: { seq: 'desc' },
        take: 50,
        select: {
          seq: true,
          type: true,
          teamId: true,
          playerId: true,
          timestamp: true,
          payload: true,
        },
      }),
      this.prisma.matchSlotResult.findMany({
        where: { matchId, wasPresentInMatch: true },
        select: {
          teamId: true,
          wasPresentInMatch: true,
          placement: true,
          totalKills: true,
          placementPoints: true,
          totalPoints: true,
        },
      }),
      this.stateStore.get(matchId),
    ]);

    const teams = this.buildTeamList(match);
    const teamNameById = new Map(teams.map((t) => [t.id, t.name ?? 'Team']));
    const playerNameById = new Map<string, string>();
    teams.forEach((t) =>
      t.players?.forEach((p) =>
        playerNameById.set(p.id, p.realName ?? p.ign ?? 'Player'),
      ),
    );

    const teamKills = new Map<string, number>();
    const playerKills = new Map<string, number>();
    const placementEvents = new Map<string, number>();

    events.forEach((evt) => {
      if (evt.type === MatchEventType.KILL) {
        if (evt.teamId) {
          teamKills.set(evt.teamId, (teamKills.get(evt.teamId) ?? 0) + 1);
        }
        if (evt.playerId) {
          playerKills.set(
            evt.playerId,
            (playerKills.get(evt.playerId) ?? 0) + 1,
          );
        }
      }
      if (evt.type === MatchEventType.TEAM_PLACEMENT && evt.teamId) {
        const placement = this.extractNumber(
          (evt.payload as { placement?: unknown })?.placement,
        );
        if (placement !== null) {
          placementEvents.set(evt.teamId, placement);
        }
      }
    });

    const scoreboardTeams = this.mergeTeamStats({
      teams,
      teamStats: teamStats
        .filter((s): s is typeof s & { teamId: string } => !!s.teamId)
        .map((s) => {
          const placement = s.placement ?? null;
          const placementPoints =
            s.placementPoints ??
            resolvePlacementPoints(placement, {
              ...(placement ? { [placement]: s.placementPoints ?? 0 } : {}),
            });
          const kills = s.totalKills ?? 0;
          const totalPoints = Number.isFinite(s.totalPoints)
            ? Number(s.totalPoints)
            : placementPoints + computeKillPoints(kills, 1);
          return {
            teamId: s.teamId,
            wasPresentInMatch: s.wasPresentInMatch ?? null,
            kills,
            placement,
            totalPoints,
            placementPoints,
          };
        }),
      killCounts: teamKills,
      placementFromEvents: placementEvents,
      liveState,
    });

    const scoreboardPlayers = this.mergePlayerStats({
      teams,
      playerKills,
    });

    const recentEvents: ScoreboardEvent[] = events
      .slice()
      .reverse()
      .map((evt) =>
        this.formatEvent(
          evt as unknown as {
            seq: number;
            type: MatchEventType;
            timestamp: Date;
            payload: Record<string, unknown> | null;
            teamId: string | null;
            playerId: string | null;
          },
          evt.teamId ? teamNameById.get(evt.teamId) : undefined,
          evt.playerId ? playerNameById.get(evt.playerId) : undefined,
        ),
      );

    const controlStatus = (liveState as any)?.status ?? null;
    const gameKey =
      match.game?.key ?? match.tournament?.game ?? (GameKey as any).PUBG_MOBILE;
    const view: ScoreboardView = {
      matchId,
      gameKey,
      adapterKey: match.adapterKey ?? null,
      status: this.mapStatus(match.status, controlStatus),
      startedAt: match.startedAt ? match.startedAt.toISOString() : null,
      endedAt: match.endedAt ? match.endedAt.toISOString() : null,
      teams: scoreboardTeams,
      players: scoreboardPlayers,
      recentEvents,
      meta: {
        map: match.map ?? null,
        round: null,
        totalRounds: null,
        mode: null,
      },
      updatedAt: new Date().toISOString(),
    };

    return view;
  }

  private async resolveOrg(matchId: string): Promise<string | null> {
    const row = (await this.prisma.match.findFirst({
      where: { id: matchId, deletedAt: null },
      select: {
        tournament: { select: { organizationId: true } },
      },
    })) as {
      tournament: { organizationId: string | null } | null;
    } | null;
    return row?.tournament?.organizationId ?? null;
  }

  async broadcast(
    matchId: string,
    organizationId?: string | null,
  ): Promise<ScoreboardView | null> {
    try {
      const orgId = organizationId ?? (await this.resolveOrg(matchId));
      const view = await this.buildScoreboard(matchId, orgId ?? undefined);
      this.overlay.broadcastScoreboard(view, orgId ?? null);
      if (orgId) {
        void this.broadcastService
          .emitForMatch(matchId, 'scoreboard')
          .catch(() => {
            /* non-blocking */
          });
      }
      return view;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`[Scoreboard] broadcast skipped for ${matchId}: ${msg}`);
      return null;
    }
  }
}
