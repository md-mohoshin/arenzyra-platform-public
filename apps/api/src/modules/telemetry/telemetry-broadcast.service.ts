import {
  Inject,
  Injectable,
  Logger,
  Optional,
  forwardRef,
} from '@nestjs/common';
import {
  type LiveMatchState,
  type MatchStateEventType,
  type MatchStateObservedPlayer,
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
import { hasManualOverride } from '../../common/live-sync-contract.util';
import {
  EVENT_BUS_TOPICS,
  type MatchTelemetrySnapshotEventPayload,
} from '../event-bus/event-bus.types';
import { ResultsService } from '../results/results.service';
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
    @Optional()
    @Inject(forwardRef(() => ResultsService))
    private readonly results?: ResultsService,
  ) {}

  async broadcastState(state: TelemetryMatchState) {
    const organizationId = await this.resolveOrganizationId(state.matchId);
    const liveState = this.toLiveMatchState(state);
    this.logger.debug(
      JSON.stringify({
        tag: '[TELEMETRY][MERGE]',
        stage: 'telemetry-broadcast',
        action: 'publish-runtime-onto-live-mirror',
        matchId: state.matchId,
        teams: Object.keys(state.teams ?? {}).length,
        players: Object.keys(state.players ?? {}).length,
        sourceMode: state.mode,
      }),
    );
    let publishedState = liveState;
    let mirrorPublished = false;
    try {
      publishedState = await this.liveStateMirror.publish(liveState, {
        writer: 'telemetry-engine',
      });
      mirrorPublished = true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        JSON.stringify({
          tag: '[TELEMETRY][BLOCKED]',
          stage: 'telemetry-broadcast',
          action: 'live-state-mirror-publish-failed-using-runtime-fallback',
          matchId: state.matchId,
          status: state.status,
          version: state.version,
          sequence: state.sequence,
          message,
        }),
      );
    }

    try {
      this.observerState.update(
        state.matchId,
        this.toObserverState(publishedState),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        JSON.stringify({
          tag: '[TELEMETRY][BLOCKED]',
          stage: 'telemetry-broadcast',
          action: 'observer-state-update-failed',
          matchId: state.matchId,
          status: publishedState.status,
          version: publishedState.version,
          message,
        }),
      );
    }

    try {
      await this.publishTelemetrySnapshot(
        state,
        publishedState,
        organizationId,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        JSON.stringify({
          tag: '[TELEMETRY][BLOCKED]',
          stage: 'telemetry-broadcast',
          action: 'telemetry-snapshot-publish-failed',
          matchId: state.matchId,
          status: publishedState.status,
          version: publishedState.version,
          message,
        }),
      );
    }

    try {
      await this.results?.syncAcceptedLiveTelemetryProjection(state, {
        source: 'TELEMETRY_PIPELINE',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        JSON.stringify({
          tag: '[TELEMETRY][BLOCKED]',
          stage: 'telemetry-broadcast',
          action: 'live-results-sync-failed',
          matchId: state.matchId,
          status: publishedState.status,
          version: publishedState.version,
          message,
        }),
      );
    }

    let realtimePublished = false;
    let endPublished = false;
    try {
      await this.broadcaster.broadcastUpdate(publishedState, organizationId);
      realtimePublished = true;
      if (
        publishedState.status === 'FINISH_PENDING' ||
        publishedState.status === 'FINISHED'
      ) {
        await this.broadcaster.broadcastEnd(publishedState, organizationId);
        endPublished = true;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        JSON.stringify({
          tag: '[TELEMETRY][TICK DROPPED]',
          stage: 'telemetry-broadcast',
          action: 'realtime-broadcast-failed',
          matchId: state.matchId,
          organizationId,
          status: publishedState.status,
          version: publishedState.version,
          sequence: state.sequence,
          message,
        }),
      );
    }

    this.logger.log(
      JSON.stringify({
        tag: '[TICK PUBLISHED]',
        stage: 'telemetry-broadcast',
        action: 'live-state-emitted',
        matchId: publishedState.matchId,
        organizationId,
        status: publishedState.status,
        version: publishedState.version,
        teams: publishedState.teams.length,
        aliveTeams: publishedState.summary?.aliveTeams ?? 0,
        players: publishedState.summary?.totalPlayers ?? 0,
        killFeedCount: publishedState.killFeed?.length ?? 0,
        eventCount: publishedState.events?.length ?? 0,
        mirrorPublished,
        realtimePublished,
        endPublished,
        fallbackUsed: !mirrorPublished,
        hasCircle: Boolean(
          publishedState.circle?.safeZone ||
          publishedState.circle?.nextZone ||
          publishedState.circle?.phase !== null ||
          publishedState.circle?.nextShrinkAt !== null,
        ),
      }),
    );

    return mapStateToDto(publishedState);
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
    const phase =
      typeof state.circle?.phase === 'number' &&
      Number.isFinite(state.circle.phase)
        ? Math.trunc(state.circle.phase)
        : null;
    const earlyTelemetryPhase = phase !== null && phase < 2;
    const computedTeamInputs = Object.values(state.teams).map((team) => {
      const freshTelemetry = this.readFreshTeamTelemetry(team, state.updatedAt);
      const teamPlayers = this.playersForTeam(state, team.teamId);
      return {
        team,
        freshTelemetry,
        teamPlayers,
      };
    });
    const hasFreshTelemetryTeams = computedTeamInputs.some(
      (entry) => entry.freshTelemetry !== null,
    );

    const computedTeams = computedTeamInputs.map(
      ({ team, freshTelemetry, teamPlayers }) => {
        const hasObservedTelemetryPresence =
          freshTelemetry !== null ||
          team.metadata?.observedInTelemetry === true ||
          teamPlayers.some(
            (player) => player.metadata?.observedInTelemetry === true,
          );
        const hasManualOwnership =
          this.hasManualTeamOwnership(team) ||
          teamPlayers.some((player) => this.hasManualPlayerOwnership(player));
        const suppressUnconfirmedCanonicalRoster =
          (state.status === 'LIVE' || state.status === 'ENDED') &&
          team.metadata?.canonicalSeed === true &&
          team.metadata?.wasPresentInMatch !== true &&
          !hasObservedTelemetryPresence &&
          !hasManualOwnership;
        const suppressStaleCanonicalRoster =
          (earlyTelemetryPhase &&
            hasFreshTelemetryTeams &&
            freshTelemetry === null) ||
          suppressUnconfirmedCanonicalRoster;
        const observedAlivePlayers = teamPlayers.filter(
          (player) => player.alive === true,
        ).length;
        const canonicalTotalPlayers =
          typeof team.metadata?.totalPlayers === 'number' &&
          Number.isFinite(team.metadata.totalPlayers)
            ? Math.max(0, Math.trunc(team.metadata.totalPlayers))
            : null;
        const explicitStateTotalPlayers =
          typeof team.totalPlayers === 'number' &&
          Number.isFinite(team.totalPlayers)
            ? Math.max(0, Math.trunc(team.totalPlayers))
            : null;
        const explicitAlivePlayers =
          typeof team.alivePlayers === 'number' &&
          Number.isFinite(team.alivePlayers)
            ? Math.max(0, Math.trunc(team.alivePlayers))
            : null;
        const preferredAggregateAlivePlayers =
          freshTelemetry?.alivePlayers ?? explicitAlivePlayers;
        const totalPlayers = suppressStaleCanonicalRoster
          ? 0
          : (freshTelemetry?.totalPlayers ??
            (canonicalTotalPlayers !== null
              ? Math.max(teamPlayers.length, canonicalTotalPlayers)
              : Math.max(teamPlayers.length, explicitStateTotalPlayers ?? 0)));
        const alivePlayers = suppressStaleCanonicalRoster
          ? 0
          : Math.min(
              totalPlayers,
              Math.max(
                0,
                preferredAggregateAlivePlayers ?? observedAlivePlayers,
              ),
            );
        const playerKills = teamPlayers.reduce(
          (sum, player) => sum + Math.max(0, player.kills ?? 0),
          0,
        );
        const wasPresentInMatch = hasObservedTelemetryPresence
          ? true
          : (team.metadata?.wasPresentInMatch ?? null);
        const presenceStatus: NonNullable<
          LiveMatchState['teams'][number]['presenceStatus']
        > =
          wasPresentInMatch === true
            ? 'ACTIVE'
            : wasPresentInMatch === false
              ? 'NO_SHOW'
              : 'UNRESOLVED';
        const hasTelemetryPresence =
          hasObservedTelemetryPresence || wasPresentInMatch === true;
        const liveTeam = {
          teamId: team.teamId,
          name: team.metadata?.teamName ?? null,
          tag: team.metadata?.teamTag ?? null,
          slot: team.metadata?.slot ?? null,
          wasPresentInMatch,
          presenceStatus,
          kills: Math.max(
            suppressStaleCanonicalRoster ? 0 : (freshTelemetry?.kills ?? 0),
            suppressStaleCanonicalRoster ? 0 : team.totalKills,
            suppressStaleCanonicalRoster ? 0 : playerKills,
          ),
          placement: suppressStaleCanonicalRoster
            ? null
            : (freshTelemetry?.placement ?? team.placement),
          points: null,
          logoUrl: team.metadata?.logoUrl ?? null,
          alivePlayers,
          totalPlayers,
          alive: alivePlayers > 0,
          eliminated: alivePlayers === 0,
          backpack: team.metadata?.telemetryBackpack ?? null,
          equipment:
            team.metadata?.telemetryEquipment ??
            team.metadata?.telemetryBackpack ??
            null,
          hasTelemetryPresence,
          sourceMode: state.mode,
          updatedAt: new Date(state.updatedAt).toISOString(),
          ownership: team.ownership,
          players: suppressStaleCanonicalRoster
            ? []
            : teamPlayers.map((player) => ({
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
                health: player.health ?? null,
                kills: player.kills,
                assists: player.assists,
                position: player.metadata?.position ?? null,
                updatedAt: new Date(state.updatedAt).toISOString(),
                lifeTelemetryFresh:
                  player.metadata?.observedInTelemetry === true,
                ownership: player.ownership,
              })),
        };

        return {
          freshTelemetry,
          team: liveTeam,
          canonicalMatchTeam:
            typeof team.metadata?.slotResultId === 'string' &&
            team.metadata.slotResultId.trim().length > 0,
        };
      },
    );

    const teams = computedTeams
      .sort((left, right) => this.sortLiveTeams(left.team, right.team))
      .map((entry) => entry.team);

    const freshTelemetryTeams = computedTeams
      .filter((entry) => entry.freshTelemetry !== null)
      .map((entry) => entry.team);

    const summarySourceTeams =
      freshTelemetryTeams.length > 0 ? freshTelemetryTeams : teams;
    const canonicalMatchTeamCount = computedTeams.reduce(
      (count, entry) => (entry.canonicalMatchTeam ? count + 1 : count),
      0,
    );
    const totalPlayers = summarySourceTeams.reduce(
      (sum, team) => sum + (team.totalPlayers ?? team.players?.length ?? 0),
      0,
    );
    const alivePlayers = summarySourceTeams.reduce(
      (sum, team) => sum + (team.alivePlayers ?? 0),
      0,
    );
    const aliveTeams = summarySourceTeams.reduce(
      (sum, team) =>
        team.alivePlayers && team.alivePlayers > 0 ? sum + 1 : sum,
      0,
    );
    const winnerEligible =
      state.status === 'ENDED' || state.status === 'LOCKED' || aliveTeams === 1;
    const winnerTeam = winnerEligible
      ? ((freshTelemetryTeams.length > 0 ? freshTelemetryTeams : teams).find(
          (team) => team.placement === 1,
        ) ?? null)
      : null;
    const observedPlayer = this.toLiveObservedPlayer(state, teams);

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
        totalTeams: Math.max(
          summarySourceTeams.length,
          canonicalMatchTeamCount,
        ),
        aliveTeams,
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
      observedPlayer,
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

  private toLiveObservedPlayer(
    state: TelemetryMatchState,
    teams: LiveMatchState['teams'],
  ): MatchStateObservedPlayer | null {
    const observedPlayer = state.observedPlayer ?? null;
    if (!observedPlayer) {
      return null;
    }

    const normalizedIds = new Set(
      [
        observedPlayer.playerId,
        observedPlayer.externalPlayerId,
        observedPlayer.pubgPlayerId,
      ]
        .map((value) => this.normalizeLookup(value))
        .filter((value) => value.length > 0),
    );
    const normalizedNames = new Set(
      [observedPlayer.playerIgn, observedPlayer.playerName]
        .map((value) => this.normalizeLookup(value))
        .filter((value) => value.length > 0),
    );

    let matchedTeam =
      teams.find((team) => team.teamId === observedPlayer.teamId) ?? null;
    let matchedPlayer: MatchStatePlayer | null = null;
    for (const team of teams) {
      const candidate = (team.players ?? []).find((player) => {
        const candidateIds = [
          player.playerId,
          player.externalPlayerId,
          player.pubgPlayerId,
          player.id,
        ]
          .map((value) => this.normalizeLookup(value))
          .filter((value) => value.length > 0);
        if (candidateIds.some((value) => normalizedIds.has(value))) {
          return true;
        }
        if (
          observedPlayer.teamId &&
          team.teamId !== observedPlayer.teamId &&
          this.normalizeLookup(team.teamId) !==
            this.normalizeLookup(observedPlayer.teamId)
        ) {
          return false;
        }
        const candidateNames = [player.name, player.ign]
          .map((value) => this.normalizeLookup(value))
          .filter((value) => value.length > 0);
        return candidateNames.some((value) => normalizedNames.has(value));
      });
      if (candidate) {
        matchedPlayer = candidate;
        matchedTeam = team;
        break;
      }
    }

    return {
      playerId:
        observedPlayer.playerId ??
        matchedPlayer?.playerId ??
        matchedPlayer?.id ??
        null,
      externalPlayerId:
        observedPlayer.externalPlayerId ??
        matchedPlayer?.externalPlayerId ??
        null,
      pubgPlayerId:
        observedPlayer.pubgPlayerId ?? matchedPlayer?.pubgPlayerId ?? null,
      playerName: observedPlayer.playerName ?? matchedPlayer?.name ?? null,
      playerIgn:
        observedPlayer.playerIgn ??
        matchedPlayer?.ign ??
        matchedPlayer?.name ??
        null,
      teamId: observedPlayer.teamId ?? matchedTeam?.teamId ?? null,
      teamName: observedPlayer.teamName ?? matchedTeam?.name ?? null,
      teamTag: observedPlayer.teamTag ?? matchedTeam?.tag ?? null,
      teamLogoUrl: observedPlayer.teamLogoUrl ?? matchedTeam?.logoUrl ?? null,
      updatedAt:
        observedPlayer.updatedAt ?? new Date(state.updatedAt).toISOString(),
    };
  }

  private normalizeLookup(value: unknown): string {
    if (typeof value === 'string') {
      return value.trim().toLowerCase();
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value).trim().toLowerCase();
    }
    return '';
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
          health: player.health ?? null,
          hasDied: player.alive === false,
          lifeTelemetryFresh: player.lifeTelemetryFresh === true,
        })) ?? [],
    }));

    const teamsAlive = state.summary?.aliveTeams ?? 0;
    const winnerEligible =
      state.status === 'FINISH_PENDING' ||
      state.status === 'FINISHED' ||
      teamsAlive === 1;
    const winnerTeam = winnerEligible
      ? (leaderboard.find((team) => team.placement === 1) ??
        leaderboard.find((team) => team.alivePlayers > 0) ??
        null)
      : null;

    return {
      matchId: state.matchId,
      updatedAt: state.updatedAt,
      teamsAlive,
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
    const normalizeAlias = (value: unknown): string =>
      typeof value === 'string' ? value.trim().toLowerCase() : '';
    const aliasList = (player: TelemetryMatchState['players'][string]) =>
      Array.from(
        new Set(
          [
            player.metadata?.slotPlayerResultId,
            player.metadata?.externalPlayerId,
            player.metadata?.inGameId,
            player.metadata?.playerName,
          ]
            .map((value) => normalizeAlias(value))
            .filter((value) => value.length > 0),
        ),
      );

    const canonical = new Map<string, TelemetryMatchState['players'][string]>();
    const aliasesToCanonical = new Map<string, string>();
    const teamPlayers = Object.values(state.players)
      .filter((player) => player.teamId === teamId)
      .sort((left, right) => {
        const leftScore =
          (normalizeAlias(left.metadata?.slotPlayerResultId).length > 0
            ? 0
            : 10) +
          (left.metadata?.observedInTelemetry === true ? 0 : 5) +
          (left.metadata?.provisional === true ? 5 : 0);
        const rightScore =
          (normalizeAlias(right.metadata?.slotPlayerResultId).length > 0
            ? 0
            : 10) +
          (right.metadata?.observedInTelemetry === true ? 0 : 5) +
          (right.metadata?.provisional === true ? 5 : 0);
        if (leftScore !== rightScore) {
          return leftScore - rightScore;
        }
        return left.playerId.localeCompare(right.playerId);
      });

    for (const player of teamPlayers) {
      const aliases = aliasList(player);
      const canonicalKey =
        aliases.map((alias) => aliasesToCanonical.get(alias)).find(Boolean) ??
        player.playerId;
      const existing = canonical.get(canonicalKey);
      if (!existing) {
        canonical.set(canonicalKey, player);
        for (const alias of aliases) {
          aliasesToCanonical.set(alias, canonicalKey);
        }
        continue;
      }

      const preferredLifeSource = this.pickPreferredProjectedPlayerLifeSource(
        existing,
        player,
      );
      canonical.set(canonicalKey, {
        ...existing,
        alive: preferredLifeSource.alive,
        knocked: preferredLifeSource.knocked,
        health:
          preferredLifeSource.health ??
          existing.health ??
          player.health ??
          null,
        kills: Math.max(existing.kills, player.kills),
        metadata: {
          ...(player.metadata ?? {}),
          ...(existing.metadata ?? {}),
          playerName:
            existing.metadata?.playerName ??
            player.metadata?.playerName ??
            existing.playerId,
          slotPlayerResultId:
            existing.metadata?.slotPlayerResultId ??
            player.metadata?.slotPlayerResultId ??
            null,
          externalPlayerId:
            existing.metadata?.externalPlayerId ??
            player.metadata?.externalPlayerId ??
            null,
          inGameId:
            existing.metadata?.inGameId ?? player.metadata?.inGameId ?? null,
          position:
            existing.metadata?.position ?? player.metadata?.position ?? null,
          observedInTelemetry:
            existing.metadata?.observedInTelemetry === true ||
            player.metadata?.observedInTelemetry === true,
          canonicalSeed:
            existing.metadata?.canonicalSeed === true ||
            player.metadata?.canonicalSeed === true,
          provisional:
            existing.metadata?.provisional === true &&
            player.metadata?.provisional === true,
        },
      });
      for (const alias of aliases) {
        aliasesToCanonical.set(alias, canonicalKey);
      }
    }

    return Array.from(canonical.values()).sort((left, right) =>
      left.playerId.localeCompare(right.playerId),
    );
  }

  private hasManualTeamOwnership(team: TelemetryTeamState): boolean {
    return (
      hasManualOverride(team.ownership?.eliminated) ||
      hasManualOverride(team.ownership?.placement) ||
      hasManualOverride(team.ownership?.totalKills)
    );
  }

  private hasManualPlayerOwnership(
    player: TelemetryMatchState['players'][string],
  ): boolean {
    return (
      hasManualOverride(player.ownership?.alive) ||
      hasManualOverride(player.ownership?.knocked) ||
      hasManualOverride(player.ownership?.kills)
    );
  }

  private pickPreferredProjectedPlayerLifeSource(
    existing: TelemetryMatchState['players'][string],
    candidate: TelemetryMatchState['players'][string],
  ) {
    const existingObserved = existing.metadata?.observedInTelemetry === true;
    const candidateObserved = candidate.metadata?.observedInTelemetry === true;
    if (candidateObserved && !existingObserved) {
      return candidate;
    }
    if (existingObserved && !candidateObserved) {
      return existing;
    }

    // When canonical duplicates disagree, an eliminated state is safer to keep
    // than a stale alive row because eliminated players do not revive.
    if (existing.alive !== candidate.alive) {
      return candidate.alive === false ? candidate : existing;
    }

    if (existing.knocked !== candidate.knocked) {
      return candidate.knocked === true ? candidate : existing;
    }

    return existing;
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
      health: player.health ?? null,
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
          killerTeamId: this.stringValue(payload.killerTeamId ?? event.teamId),
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

  private readFreshTeamTelemetry(
    team: TelemetryTeamState,
    updatedAt: number,
  ): {
    alivePlayers: number | null;
    totalPlayers: number | null;
    kills: number | null;
    placement: number | null;
  } | null {
    const lastSeenAt =
      typeof team.metadata?.telemetryLastSeenAt === 'number' &&
      Number.isFinite(team.metadata.telemetryLastSeenAt)
        ? Math.trunc(team.metadata.telemetryLastSeenAt)
        : null;
    if (lastSeenAt === null || lastSeenAt !== Math.trunc(updatedAt)) {
      return null;
    }

    const alivePlayers =
      typeof team.metadata?.telemetryAlivePlayers === 'number' &&
      Number.isFinite(team.metadata.telemetryAlivePlayers)
        ? Math.max(0, Math.trunc(team.metadata.telemetryAlivePlayers))
        : null;
    const totalPlayers =
      typeof team.metadata?.telemetryTotalPlayers === 'number' &&
      Number.isFinite(team.metadata.telemetryTotalPlayers)
        ? Math.max(
            alivePlayers ?? 0,
            Math.trunc(team.metadata.telemetryTotalPlayers),
          )
        : alivePlayers;
    const kills =
      typeof team.metadata?.telemetryKills === 'number' &&
      Number.isFinite(team.metadata.telemetryKills)
        ? Math.max(0, Math.trunc(team.metadata.telemetryKills))
        : null;
    const placement =
      typeof team.metadata?.telemetryPlacement === 'number' &&
      Number.isFinite(team.metadata.telemetryPlacement)
        ? Math.max(1, Math.trunc(team.metadata.telemetryPlacement))
        : null;

    return {
      alivePlayers,
      totalPlayers,
      kills,
      placement,
    };
  }

  private sortLiveTeams(
    left: LiveMatchState['teams'][number],
    right: LiveMatchState['teams'][number],
  ) {
    const leftAlivePlayers = left.alivePlayers ?? 0;
    const rightAlivePlayers = right.alivePlayers ?? 0;
    if (leftAlivePlayers > 0 && rightAlivePlayers === 0) return -1;
    if (leftAlivePlayers === 0 && rightAlivePlayers > 0) return 1;
    const leftPlacement = left.placement ?? Number.MAX_SAFE_INTEGER;
    const rightPlacement = right.placement ?? Number.MAX_SAFE_INTEGER;
    if (leftPlacement !== rightPlacement) {
      return leftPlacement - rightPlacement;
    }
    if ((right.kills ?? 0) !== (left.kills ?? 0)) {
      return (right.kills ?? 0) - (left.kills ?? 0);
    }
    return (
      (left.slot ?? Number.MAX_SAFE_INTEGER) -
      (right.slot ?? Number.MAX_SAFE_INTEGER)
    );
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
    if (status === 'LOCKED') return 'FINISHED';
    if (status === 'ENDED') return 'FINISH_PENDING';
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
