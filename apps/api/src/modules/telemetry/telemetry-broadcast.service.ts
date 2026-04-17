import { Injectable, Logger, Optional } from '@nestjs/common';
import {
  type LiveMatchState,
  type MatchStateEventType,
  type MatchStatePlayer,
} from '../match-control/state.store';
import { LiveStateMirrorService } from '../match-control/live-state-mirror.service';
import { MatchStateBroadcaster } from '../../realtime/match-state-broadcaster.service';
import {
  MatchStateService as ObserverMatchStateService,
  type MatchState as ObserverMatchState,
} from '../observer/match-state.service';
import { mapStateToDto } from '../../realtime/live-match-state.dto';
import { PrismaService } from '../../db/prisma.service';
import { EventBusService } from '../event-bus/event-bus.service';
import {
  EVENT_BUS_TOPICS,
  type MatchTelemetrySnapshotEventPayload,
} from '../event-bus/event-bus.types';
import type {
  TelemetryMatchState,
  TelemetryPlayerKillEvent,
  TelemetryStateEvent,
  TelemetryTeamState,
} from './telemetry.types';

@Injectable()
export class TelemetryBroadcastService {
  private readonly logger = new Logger(TelemetryBroadcastService.name);
  private readonly matchOrgCache = new Map<string, string | null>();

  constructor(
    private readonly liveStateMirror: LiveStateMirrorService,
    private readonly broadcaster: MatchStateBroadcaster,
    private readonly observerState: ObserverMatchStateService,
    private readonly prisma: PrismaService,
    @Optional() private readonly eventBus?: EventBusService,
  ) {}

  async broadcastState(state: TelemetryMatchState) {
    const organizationId = await this.resolveOrganizationId(state.matchId);
    const liveState = this.toLiveMatchState(state);
    const saved = await this.liveStateMirror.publish(liveState);
    this.observerState.update(state.matchId, this.toObserverState(saved));
    await this.publishTelemetrySnapshot(state, saved, organizationId);
    await this.broadcaster.broadcastUpdate(saved, organizationId);
    if (saved.status === 'ENDED' || saved.status === 'CONFIRMED') {
      await this.broadcaster.broadcastEnd(saved, organizationId);
    }

    this.logger.debug(
      JSON.stringify({
        stage: 'telemetry-broadcast',
        action: 'live-state-emitted',
        matchId: saved.matchId,
        organizationId,
        status: saved.status,
        version: saved.version,
        teams: saved.teams.length,
        aliveTeams: saved.summary?.aliveTeams ?? 0,
        players: saved.summary?.totalPlayers ?? 0,
        killFeedCount: saved.killFeed?.length ?? 0,
        eventCount: saved.events?.length ?? 0,
        hasCircle: Boolean(
          saved.circle?.safeZone ||
          saved.circle?.nextZone ||
          saved.circle?.phase !== null ||
          saved.circle?.nextShrinkAt !== null,
        ),
      }),
    );

    return mapStateToDto(saved);
  }

  private async publishTelemetrySnapshot(
    state: TelemetryMatchState,
    saved: LiveMatchState,
    organizationId: string | null,
  ): Promise<void> {
    if (!this.eventBus) {
      return;
    }

    const payload: MatchTelemetrySnapshotEventPayload = {
      matchId: state.matchId,
      organizationId,
      startedAt: saved.startedAt,
      status: saved.status,
      updatedAt: saved.updatedAt,
      teams: saved.teams,
      totalPlayerList: {
        players: saved.teams.flatMap((team) =>
          (team.players ?? []).map(
            (player): Record<string, unknown> =>
              this.toTelemetryPlayerSnapshot(player, team.slot),
          ),
        ),
      },
      circle: saved.circle ?? null,
      observedPlayer: saved.observedPlayer ?? null,
      killEvents: this.toTelemetryKillEvents(state.matchId, state.events ?? []),
    };

    await this.eventBus.publish<MatchTelemetrySnapshotEventPayload>(
      EVENT_BUS_TOPICS.MATCH,
      'telemetry.snapshot',
      payload,
      {
        timestamp: state.updatedAt,
      },
    );
  }

  private async resolveOrganizationId(matchId: string): Promise<string | null> {
    if (this.matchOrgCache.has(matchId)) {
      return this.matchOrgCache.get(matchId) ?? null;
    }

    try {
      const match = await this.prisma.match.findFirst({
        where: { id: matchId, deletedAt: null },
        select: {
          organizationId: true,
          controlState: { select: { organizationId: true } },
          tournament: { select: { organizationId: true } },
        },
      });
      const orgId =
        match?.organizationId ??
        match?.controlState?.organizationId ??
        match?.tournament?.organizationId ??
        null;
      this.matchOrgCache.set(matchId, orgId ?? null);
      if (!orgId) {
        this.logger.warn(
          `[TelemetryBroadcast] missing organizationId for match=${matchId}; continuing with match-only realtime rooms`,
        );
      }
      return orgId ?? null;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `[TelemetryBroadcast] failed to resolve organizationId for match=${matchId}: ${message}`,
      );
      return null;
    }
  }

  toLiveMatchState(state: TelemetryMatchState): LiveMatchState {
    const teams = Object.values(state.teams)
      .sort((left, right) => this.sortTeams(left, right))
      .map((team) => {
        const eliminated = team.alivePlayers === 0;
        return {
          teamId: team.teamId,
          name: team.metadata?.teamName ?? null,
          tag: team.metadata?.teamTag ?? null,
          slot: team.metadata?.slot ?? null,
          kills: team.totalKills,
          placement: team.placement,
          points: null,
          logoUrl: team.metadata?.logoUrl ?? null,
          alivePlayers: team.alivePlayers,
          totalPlayers: team.totalPlayers,
          alive: team.alivePlayers > 0,
          eliminated,
          sourceMode: state.mode,
          updatedAt: new Date(state.updatedAt).toISOString(),
          ownership: team.ownership,
          players: this.playersForTeam(state, team.teamId).map((player) => ({
            id: player.playerId,
            playerId: player.playerId,
            externalPlayerId: player.metadata?.externalPlayerId ?? null,
            pubgPlayerId: player.metadata?.inGameId ?? null,
            name: player.metadata?.playerName ?? player.playerId,
            ign: player.metadata?.playerName ?? player.playerId,
            avatarUrl: player.metadata?.avatarUrl ?? null,
            teamId: player.teamId,
            slot: team.metadata?.slot ?? null,
            alive: player.alive,
            knocked: player.knocked,
            eliminated: !player.alive,
            kills: player.kills,
            position: player.metadata?.position ?? null,
            updatedAt: new Date(state.updatedAt).toISOString(),
            ownership: player.ownership,
          })),
        };
      });

    const winnerTeam = teams.find((team) => team.placement === 1) ?? null;
    const totalPlayers = teams.reduce(
      (sum, team) => sum + (team.totalPlayers ?? team.players?.length ?? 0),
      0,
    );
    const alivePlayers = teams.reduce(
      (sum, team) => sum + (team.alivePlayers ?? 0),
      0,
    );

    return {
      matchId: state.matchId,
      status: this.toControlState(state.status),
      startedAt: state.startedAt
        ? new Date(state.startedAt).toISOString()
        : null,
      endedAt: state.endedAt ? new Date(state.endedAt).toISOString() : null,
      version: state.version,
      updatedAt: new Date(state.updatedAt).toISOString(),
      sourceMode: state.mode,
      summary: {
        totalTeams: teams.length,
        aliveTeams: state.teamsAlive,
        totalPlayers,
        alivePlayers,
        winnerTeamId: winnerTeam?.teamId ?? null,
        winnerSlot: winnerTeam?.slot ?? null,
      },
      teams,
      killFeed: (state.killFeed ?? []).map((item) => ({
        id: item.id,
        type: 'PLAYER_KILL' as const,
        ts: item.ts,
        killerTeamId: item.killerTeamId ?? null,
        killerPlayerId: item.killerPlayerId ?? null,
        killerName: item.killerName ?? null,
        victimTeamId: item.victimTeamId ?? null,
        victimPlayerId: item.victimPlayerId ?? null,
        victimName: item.victimName ?? null,
        delta: item.delta,
        totalKills: item.totalKills ?? null,
        weapon: item.weapon ?? null,
      })),
      events: (state.events ?? []).map((item) => ({
        id: item.id,
        type: this.toMatchStateEventType(item),
        ts: item.ts,
        teamId: item.teamId ?? null,
        playerId: item.playerId ?? null,
        payload: item.payload ?? null,
      })),
      observedPlayer: null,
      circle: state.circle
        ? {
            phase: state.circle.phase ?? null,
            nextShrinkAt: state.circle.nextShrinkAt ?? null,
            safeZone: state.circle.safeZone ?? null,
            nextZone: state.circle.nextZone ?? null,
          }
        : null,
    };
  }

  private toObserverState(state: LiveMatchState): ObserverMatchState {
    const leaderboard = state.teams.map((team, index) => ({
      rank: index + 1,
      teamId: team.teamId,
      slot: team.slot ?? null,
      teamName: team.name ?? team.tag ?? team.teamId,
      teamTag: team.tag ?? null,
      logoUrl: team.logoUrl ?? null,
      color: null,
      kills: team.kills ?? 0,
      alivePlayers: team.alivePlayers ?? 0,
      totalPlayers: team.totalPlayers ?? null,
      placement: team.placement ?? null,
      isEliminated: (team.alivePlayers ?? 0) === 0,
      players:
        team.players?.map((player) => ({
          playerId: player.playerId ?? player.id ?? null,
          playerName: player.name ?? player.ign ?? 'Player',
          avatarUrl: player.avatarUrl ?? null,
          kills: player.kills ?? 0,
          alive: player.alive === true,
          knocked: player.knocked === true,
          health: null,
          hasDied: player.alive === false,
          lifeTelemetryFresh: false,
        })) ?? [],
    }));

    const winnerTeam =
      leaderboard.find((team) => team.placement === 1) ??
      leaderboard.find((team) => team.alivePlayers > 0) ??
      null;

    return {
      matchId: state.matchId,
      updatedAt: state.updatedAt,
      teamsAlive: state.summary?.aliveTeams ?? 0,
      leaderboard,
      killFeed: (state.killFeed ?? []).map((item) => ({
        id: item.id,
        killerTeam: item.killerTeamId ?? null,
        killerTeamId: item.killerTeamId ?? null,
        killerPlayerId: item.killerPlayerId ?? null,
        killerName: item.killerName ?? null,
        victimTeam: item.victimTeamId ?? null,
        victimTeamId: item.victimTeamId ?? null,
        victimPlayerId: item.victimPlayerId ?? null,
        victimName: item.victimName ?? null,
        weapon: item.weapon ?? null,
        tsIso: new Date(item.ts).toISOString(),
      })),
      playerCard: null,
      circle: state.circle
        ? {
            phase: state.circle.phase ?? null,
            nextShrinkAt:
              typeof state.circle.nextShrinkAt === 'number'
                ? new Date(state.circle.nextShrinkAt).toISOString()
                : null,
            safeZone: state.circle.safeZone ?? null,
            nextZone: state.circle.nextZone ?? null,
          }
        : null,
      winner: winnerTeam
        ? {
            teamId: winnerTeam.teamId,
            slot: winnerTeam.slot,
            teamName: winnerTeam.teamName,
            teamTag: winnerTeam.teamTag,
            logoUrl: winnerTeam.logoUrl,
            color: null,
            kills: winnerTeam.kills,
            alivePlayers: winnerTeam.alivePlayers,
            placement: winnerTeam.placement,
          }
        : null,
    };
  }

  private playersForTeam(state: TelemetryMatchState, teamId: string) {
    return Object.values(state.players)
      .filter((player) => player.teamId === teamId)
      .sort((left, right) => left.playerId.localeCompare(right.playerId));
  }

  private toTelemetryPlayerSnapshot(
    player: MatchStatePlayer,
    slot: number | null,
  ): Record<string, unknown> {
    return {
      teamId: player.teamId ?? null,
      slot,
      externalPlayerId:
        player.externalPlayerId ??
        player.playerId ??
        player.pubgPlayerId ??
        player.id ??
        null,
      playerId:
        player.playerId ??
        player.externalPlayerId ??
        player.pubgPlayerId ??
        player.id ??
        null,
      pubgPlayerId: player.pubgPlayerId ?? null,
      playerName: player.name ?? player.ign ?? null,
      name: player.name ?? player.ign ?? null,
      ign: player.ign ?? player.name ?? null,
      avatarUrl: player.avatarUrl ?? null,
      alive: player.alive,
      knocked: player.knocked,
    };
  }

  private toTelemetryKillEvents(
    matchId: string,
    events: TelemetryStateEvent[],
  ): TelemetryPlayerKillEvent[] {
    return events
      .filter((event) => event.type === 'PLAYER_KILL')
      .map((event): TelemetryPlayerKillEvent | null => {
        const payload = event.payload ?? {};
        const killerPlayerExternalId = this.stringValue(
          payload.killerPlayerId ?? payload.killerId ?? event.playerId,
        );
        const victimPlayerExternalId = this.stringValue(
          payload.victimPlayerId ?? payload.victimId,
        );
        if (!killerPlayerExternalId || !victimPlayerExternalId) {
          return null;
        }

        return {
          type: 'PLAYER_KILL',
          matchId,
          killerPlayerExternalId,
          victimPlayerExternalId,
          killerTeamId: this.stringValue(
            payload.killerTeamId ?? event.teamId,
          ),
          victimTeamId: this.stringValue(payload.victimTeamId),
          killerPlayerName: this.stringValue(
            payload.killerName ?? payload.killerPlayerName,
          ),
          victimPlayerName: this.stringValue(
            payload.victimName ?? payload.victimPlayerName,
          ),
          weapon: this.stringValue(payload.weapon),
          timestamp: event.ts,
          raw: payload.raw ?? payload,
        };
      })
      .filter((event): event is TelemetryPlayerKillEvent => Boolean(event));
  }

  private sortTeams(left: TelemetryTeamState, right: TelemetryTeamState) {
    if (left.alivePlayers > 0 && right.alivePlayers === 0) return -1;
    if (left.alivePlayers === 0 && right.alivePlayers > 0) return 1;
    const leftPlacement = left.placement ?? Number.MAX_SAFE_INTEGER;
    const rightPlacement = right.placement ?? Number.MAX_SAFE_INTEGER;
    if (leftPlacement !== rightPlacement) {
      return leftPlacement - rightPlacement;
    }
    if (right.totalKills !== left.totalKills) {
      return right.totalKills - left.totalKills;
    }
    return (
      (left.metadata?.slot ?? Number.MAX_SAFE_INTEGER) -
      (right.metadata?.slot ?? Number.MAX_SAFE_INTEGER)
    );
  }

  private toControlState(status: TelemetryMatchState['status']) {
    if (status === 'LIVE') return 'LIVE';
    if (status === 'LOCKED') return 'ENDED';
    if (status === 'ENDED') return 'ENDED';
    return 'READY';
  }

  private toMatchStateEventType(
    event: TelemetryStateEvent,
  ): MatchStateEventType {
    switch (event.type) {
      case 'PLAYER_ALIVE_CHANGED':
        return event.payload?.alive === false ? 'PLAYER_DIED' : 'PLAYER_SEEN';
      case 'PLAYER_KNOCKED_CHANGED':
        return event.payload?.knocked === true
          ? 'PLAYER_KNOCKED'
          : 'PLAYER_REVIVED';
      default:
        return event.type;
    }
  }

  private stringValue(value: unknown): string | null {
    if (typeof value !== 'string') {
      return null;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
}
