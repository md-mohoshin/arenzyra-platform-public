import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import type { ControlStatus } from '../match-control/dto/control.dto';
import {
  isAutomaticMatchStateSourceMode,
  type MatchStateCircle,
  type MatchStateEvent,
  type MatchStateKillFeedItem,
  type MatchStateObservedPlayer,
  type MatchStatePlayer,
  type MatchStateSourceMode,
  type MatchStateSummary,
  type TeamScoreState,
} from '../match-control/state.store';
import { EventBusService } from '../event-bus/event-bus.service';
import {
  EVENT_BUS_TOPICS,
  type MatchStateUpdatedEventPayload,
  type MatchTelemetrySnapshotEventPayload,
} from '../event-bus/event-bus.types';
import type { TelemetryPlayerKillEvent } from '../telemetry/telemetry.types';

type TeamState = {
  teamId: string;
  name: string | null;
  tag: string | null;
  slot: number | null;
  logoUrl: string | null;
  points: number | null;
  kills: number;
  hasTelemetryPresence: boolean;
  alivePlayers: number | null;
  totalPlayers: number | null;
  alive: boolean;
  eliminated: boolean;
  eliminationTimestamp: number | null;
  placement: number | null;
  updatedAt: number;
  playerKeys: Set<string>;
};

type PlayerState = {
  key: string;
  playerExternalId: string;
  teamId: string;
  name: string | null;
  ign: string | null;
  avatarUrl: string | null;
  slot: number | null;
  kills: number;
  alive: boolean;
  knocked: boolean;
  eliminated: boolean;
  deathTimestamp: number | null;
  updatedAt: number;
};

type MatchState = {
  matchId: string;
  startedAt: number;
  updatedAt: number;
  endedAt: number | null;
  status: ControlStatus;
  sourceMode: MatchStateSourceMode;
  teams: Map<string, TeamState>;
  players: Map<string, PlayerState>;
  processedEventKeys: Set<string>;
  aliveTeams: number;
  finished: boolean;
  circle: MatchStateCircle | null;
  observedPlayer: MatchStateObservedPlayer | null;
  events: MatchStateEvent[];
  killFeed: MatchStateKillFeedItem[];
};

export type MatchStateSyncInput = {
  matchId: string;
  sourceMode?: MatchStateSourceMode | null;
  status?: ControlStatus | null;
  startedAt?: string | number | null;
  teams: TeamScoreState[];
  totalPlayerList?: unknown;
  circle?: MatchStateCircle | null;
  observedPlayer?: MatchStateObservedPlayer | null;
  killEvents?: TelemetryPlayerKillEvent[];
};

export type MatchStateSyncResult = {
  matchId: string;
  status: ControlStatus;
  startedAt: string;
  endedAt: string | null;
  updatedAt: string;
  sourceMode: MatchStateSourceMode;
  teams: TeamScoreState[];
  summary: MatchStateSummary;
  circle: MatchStateCircle | null;
  observedPlayer: MatchStateObservedPlayer | null;
  events: MatchStateEvent[];
  killFeed: MatchStateKillFeedItem[];
  finished: boolean;
};

type TelemetryPlayerSnapshot = {
  teamId: string | null;
  slot: number | null;
  externalPlayerId: string | null;
  name: string | null;
  avatarUrl: string | null;
  alive: boolean | null;
  knocked: boolean | null;
};

type PublishedMatchStateOutput = {
  organizationId: string | null;
  projection: MatchStateSyncResult;
};

const SHADOW_TELEMETRY_WRAPPER_KEYS = [
  'totalmessage',
  'setcircleinfo',
  'setobservingplayer',
  'setteambackpackinfo',
  'setteaminfo',
  'setteaminfolist',
] as const;

const SHADOW_TELEMETRY_PLAYER_LIST_KEYS = [
  'TotalPlayerList',
  'totalPlayerList',
  'PlayerList',
  'playerList',
  'PlayerInfoList',
  'playerInfoList',
  'players',
] as const;

const SHADOW_TELEMETRY_TEAM_LIST_KEYS = [
  'teams',
  'teamInfoList',
  'TeamInfoList',
  'teamList',
  'TeamList',
  'data',
] as const;

@Injectable()
export class MatchStateEngine implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MatchStateEngine.name);
  private readonly states = new Map<string, MatchState>();
  private readonly maxProcessedEventKeys = 4096;
  private readonly maxEvents = 200;
  private readonly maxKillFeed = 50;
  private readonly publishedOutputs = new Map<
    string,
    PublishedMatchStateOutput
  >();
  private unsubscribeFromBus: (() => void) | null = null;

  constructor(@Optional() private readonly eventBus?: EventBusService) {}

  onModuleInit(): void {
    if (!this.eventBus) {
      return;
    }

    this.unsubscribeFromBus = this.eventBus.subscribe(
      EVENT_BUS_TOPICS.MATCH,
      'match-state-engine',
      async (envelope) => {
        const payload = envelope.payload as MatchTelemetrySnapshotEventPayload;
        const projection = this.syncAutoMatch({
          matchId: payload.matchId,
          sourceMode: 'API',
          status: payload.status ?? 'LIVE',
          startedAt: payload.startedAt ?? payload.updatedAt ?? Date.now(),
          teams: payload.teams,
          totalPlayerList: payload.totalPlayerList,
          circle: payload.circle ?? null,
          observedPlayer: payload.observedPlayer ?? null,
          killEvents: payload.killEvents ?? [],
        });
        if (!projection) {
          return;
        }

        this.publishedOutputs.set(payload.matchId, {
          organizationId: payload.organizationId ?? null,
          projection,
        });

        await this.eventBus?.publish<MatchStateUpdatedEventPayload>(
          EVENT_BUS_TOPICS.MATCH,
          'state.updated',
          {
            matchId: payload.matchId,
            organizationId: payload.organizationId ?? null,
            projection,
          },
          {
            timestamp: this.toTimestamp(projection.updatedAt) ?? Date.now(),
          },
        );
      },
      { types: ['telemetry.snapshot'] },
    );
  }

  onModuleDestroy(): void {
    this.unsubscribeFromBus?.();
    this.unsubscribeFromBus = null;
  }

  syncAutoMatch(input: MatchStateSyncInput): MatchStateSyncResult | null {
    if (!isAutomaticMatchStateSourceMode(input.sourceMode)) {
      this.states.delete(input.matchId);
      return null;
    }

    const now = Date.now();
    const state =
      this.states.get(input.matchId) ??
      this.createState(
        input.matchId,
        this.toTimestamp(input.startedAt) ?? now,
        input.status ?? 'LIVE',
      );
    const deltaEvents: MatchStateEvent[] = [];
    const deltaKillFeed: MatchStateKillFeedItem[] = [];
    let eventSequence = 0;
    let killFeedSequence = 0;

    const createEvent = (
      type: MatchStateEvent['type'],
      ts: number,
      options: {
        teamId?: string | null;
        playerId?: string | null;
        payload?: Record<string, unknown> | null;
      } = {},
    ) => {
      const event: MatchStateEvent = {
        id: `${type}:${options.teamId ?? 'none'}:${options.playerId ?? 'none'}:${ts}:${eventSequence}`,
        type,
        ts,
        teamId: options.teamId ?? null,
        playerId: options.playerId ?? null,
        payload: options.payload ?? null,
      };
      eventSequence += 1;
      deltaEvents.push(event);
      state.events.push(event);
      if (state.events.length > this.maxEvents) {
        state.events = state.events.slice(-this.maxEvents);
      }
      return event;
    };

    const createKillFeedItem = (
      event: TelemetryPlayerKillEvent,
      totalKills: number,
    ) => {
      const item: MatchStateKillFeedItem = {
        id: `kill:${event.killerTeamId ?? 'none'}:${event.victimPlayerExternalId}:${event.timestamp}:${killFeedSequence}`,
        type: 'PLAYER_KILL',
        ts: event.timestamp,
        killerTeamId: event.killerTeamId ?? null,
        killerPlayerId: event.killerPlayerExternalId,
        killerName: event.killerPlayerName ?? null,
        victimTeamId: event.victimTeamId ?? null,
        victimPlayerId: event.victimPlayerExternalId,
        victimName: event.victimPlayerName ?? null,
        delta: 1,
        totalKills,
        weapon: event.weapon ?? null,
      };
      killFeedSequence += 1;
      deltaKillFeed.push(item);
      state.killFeed.push(item);
      if (state.killFeed.length > this.maxKillFeed) {
        state.killFeed = state.killFeed.slice(-this.maxKillFeed);
      }
    };

    if (!this.states.has(input.matchId)) {
      createEvent('MATCH_STARTED', state.startedAt);
    }

    state.updatedAt = now;
    const incomingStatus = input.status ?? state.status ?? 'LIVE';
    state.status = state.finished
      ? incomingStatus === 'FINISHED' || state.status === 'FINISHED'
        ? 'FINISHED'
        : 'FINISH_PENDING'
      : incomingStatus;
    const nextCircle = this.normalizeCircle(input.circle ?? state.circle);
    if (
      this.circleSignature(state.circle) !== this.circleSignature(nextCircle)
    ) {
      createEvent('CIRCLE_UPDATED', now, {
        payload: {
          phase: nextCircle?.phase ?? null,
          nextShrinkAt: nextCircle?.nextShrinkAt ?? null,
        },
      });
    }
    state.circle = nextCircle;
    const eliminationBlocked = this.shouldBlockEliminationForPhase(state);

    const observedPlayer = this.normalizeObservedPlayer(
      input.observedPlayer ?? state.observedPlayer,
      now,
    );
    if (
      this.observedSignature(state.observedPlayer) !==
      this.observedSignature(observedPlayer)
    ) {
      createEvent('OBSERVED_PLAYER_CHANGED', now, {
        teamId: observedPlayer?.teamId ?? null,
        playerId:
          observedPlayer?.playerId ??
          observedPlayer?.externalPlayerId ??
          observedPlayer?.pubgPlayerId ??
          null,
      });
    }
    state.observedPlayer = observedPlayer;

    const normalizedTeams = this.normalizeTeams(input.teams, now);
    this.applyTeams(state, normalizedTeams, now);
    this.syncPlayersFromTelemetry(
      state,
      input.totalPlayerList,
      now,
      createEvent,
      eliminationBlocked,
    );
    this.applyKillEvents(
      state,
      [...(input.killEvents ?? [])].sort(
        (left, right) => left.timestamp - right.timestamp,
      ),
      createEvent,
      createKillFeedItem,
      eliminationBlocked,
    );
    this.refreshTeamMetrics(state, now, createEvent, eliminationBlocked);
    this.assignPlacements(state);

    if (
      !eliminationBlocked &&
      !state.finished &&
      state.status === 'LIVE' &&
      state.teams.size > 0 &&
      this.hasTelemetryPresence(state) &&
      state.aliveTeams <= 1
    ) {
      state.finished = true;
      state.status = 'FINISH_PENDING';
      state.endedAt = state.endedAt ?? now;
      createEvent('MATCH_ENDED', state.endedAt);
    } else if (
      (input.status === 'FINISH_PENDING' || input.status === 'FINISHED') &&
      !state.finished
    ) {
      state.finished = true;
      state.status = input.status;
      state.endedAt = state.endedAt ?? now;
      createEvent('MATCH_ENDED', state.endedAt);
    }

    this.states.set(input.matchId, state);

    return {
      matchId: input.matchId,
      status: state.status,
      startedAt: new Date(state.startedAt).toISOString(),
      endedAt: state.endedAt ? new Date(state.endedAt).toISOString() : null,
      updatedAt: new Date(state.updatedAt).toISOString(),
      sourceMode: state.sourceMode,
      teams: this.toPublicTeams(state),
      summary: this.buildSummary(state),
      circle: state.circle,
      observedPlayer: state.observedPlayer,
      events: deltaEvents,
      killFeed: deltaKillFeed,
      finished: state.finished,
    };
  }

  pruneMatches(activeMatchIds: string[]): void {
    const active = new Set(activeMatchIds);
    for (const matchId of this.states.keys()) {
      if (!active.has(matchId)) {
        this.states.delete(matchId);
      }
    }
    for (const matchId of this.publishedOutputs.keys()) {
      if (!active.has(matchId)) {
        this.publishedOutputs.delete(matchId);
      }
    }
  }

  drainPublishedOutput(matchId: string): PublishedMatchStateOutput | null {
    const next = this.publishedOutputs.get(matchId) ?? null;
    this.publishedOutputs.delete(matchId);
    return next;
  }

  private createState(
    matchId: string,
    startedAt: number,
    status: ControlStatus,
  ): MatchState {
    return {
      matchId,
      startedAt,
      updatedAt: startedAt,
      endedAt: null,
      status,
      sourceMode: 'API',
      teams: new Map<string, TeamState>(),
      players: new Map<string, PlayerState>(),
      processedEventKeys: new Set<string>(),
      aliveTeams: 0,
      finished: status === 'FINISH_PENDING' || status === 'FINISHED',
      circle: null,
      observedPlayer: null,
      events: [],
      killFeed: [],
    };
  }

  private applyTeams(
    state: MatchState,
    teams: TeamScoreState[],
    now: number,
  ): void {
    const seen = new Set<string>();
    for (const team of teams) {
      seen.add(team.teamId);
      const current =
        state.teams.get(team.teamId) ??
        ({
          teamId: team.teamId,
          name: team.name ?? null,
          tag: team.tag ?? null,
          slot: team.slot ?? null,
          logoUrl: team.logoUrl ?? null,
          points: team.points ?? null,
          kills: 0,
          hasTelemetryPresence: false,
          alivePlayers: null,
          totalPlayers: null,
          alive: true,
          eliminated: false,
          eliminationTimestamp: null,
          placement: null,
          updatedAt: now,
          playerKeys: new Set<string>(),
        } satisfies TeamState);

      current.name = team.name ?? current.name;
      current.tag = team.tag ?? current.tag;
      current.slot = team.slot ?? current.slot;
      current.logoUrl = team.logoUrl ?? current.logoUrl;
      current.points = team.points ?? current.points;
      current.kills = Math.max(team.kills ?? 0, current.kills);
      current.totalPlayers =
        team.totalPlayers ?? current.totalPlayers ?? current.playerKeys.size;
      current.alivePlayers =
        team.alivePlayers ?? current.alivePlayers ?? current.playerKeys.size;
      current.updatedAt = now;

      if (Array.isArray(team.players) && team.players.length > 0) {
        for (const player of team.players) {
          const key = this.playerKey(
            player.externalPlayerId ??
              player.pubgPlayerId ??
              player.playerId ??
              player.id ??
              null,
            player.name ?? player.ign ?? null,
          );
          if (!key) continue;
          current.playerKeys.add(key);
        }
      }

      state.teams.set(team.teamId, current);
    }

    for (const [teamId, team] of state.teams.entries()) {
      if (!seen.has(teamId) && team.playerKeys.size === 0) {
        state.teams.delete(teamId);
      }
    }
  }

  private syncPlayersFromTelemetry(
    state: MatchState,
    payload: unknown,
    now: number,
    createEvent: (
      type: MatchStateEvent['type'],
      ts: number,
      options?: {
        teamId?: string | null;
        playerId?: string | null;
        payload?: Record<string, unknown> | null;
      },
    ) => MatchStateEvent,
    eliminationBlocked: boolean,
  ): void {
    const snapshots = this.extractTelemetryPlayers(payload, state);
    for (const snapshot of snapshots) {
      if (!snapshot.teamId) {
        continue;
      }
      const team = state.teams.get(snapshot.teamId);
      if (!team) {
        continue;
      }

      const key = this.playerKey(snapshot.externalPlayerId, snapshot.name);
      if (!key) {
        continue;
      }

      const existing = state.players.get(key);
      const player: PlayerState =
        existing ??
        ({
          key,
          playerExternalId: snapshot.externalPlayerId ?? key,
          teamId: snapshot.teamId,
          name: snapshot.name,
          ign: snapshot.name,
          avatarUrl: snapshot.avatarUrl,
          slot: team.slot,
          kills: 0,
          alive: snapshot.alive ?? true,
          knocked: snapshot.knocked ?? false,
          eliminated: false,
          deathTimestamp: null,
          updatedAt: now,
        } satisfies PlayerState);

      if (!existing) {
        createEvent('PLAYER_SEEN', now, {
          teamId: snapshot.teamId,
          playerId: player.playerExternalId,
        });
      }

      if (player.teamId !== snapshot.teamId) {
        const previousTeam = state.teams.get(player.teamId);
        previousTeam?.playerKeys.delete(key);
        player.teamId = snapshot.teamId;
      }

      const previousAlive = player.alive;
      const previousKnocked = player.knocked;

      player.name = snapshot.name ?? player.name;
      player.ign = snapshot.name ?? player.ign;
      player.avatarUrl = snapshot.avatarUrl ?? player.avatarUrl;
      player.slot = snapshot.slot ?? team.slot;
      player.updatedAt = now;
      player.playerExternalId =
        snapshot.externalPlayerId ?? player.playerExternalId ?? key;

      if (player.deathTimestamp === null) {
        if (snapshot.alive !== null) {
          if (snapshot.alive === false && eliminationBlocked) {
            this.logger.warn(
              JSON.stringify({
                tag: '[ELIMINATION][BLOCKED]',
                stage: 'match-state-engine',
                action: 'player-death-snapshot-blocked-during-air-phase',
                matchId: state.matchId,
                phase: state.circle?.phase ?? null,
                playerId: player.playerExternalId,
                teamId: player.teamId,
                reason: 'EARLY_PHASE_MATCH_STATE_PLAYER_DEATH_BLOCKED',
              }),
            );
          } else {
            player.alive = snapshot.alive;
          }
        }
        if (snapshot.knocked !== null) {
          if (eliminationBlocked && snapshot.knocked !== player.knocked) {
            this.logger.warn(
              JSON.stringify({
                tag: '[ELIMINATION][BLOCKED]',
                stage: 'match-state-engine',
                action: 'player-knock-snapshot-blocked-during-air-phase',
                matchId: state.matchId,
                phase: state.circle?.phase ?? null,
                playerId: player.playerExternalId,
                teamId: player.teamId,
                reason: 'EARLY_PHASE_MATCH_STATE_KNOCK_BLOCKED',
              }),
            );
          } else {
            player.knocked = snapshot.knocked;
          }
        }
      } else {
        player.alive = false;
        player.knocked = false;
      }
      player.eliminated = !player.alive;
      const markedDead = !player.alive && this.markPlayerDead(player, now);

      if ((previousAlive && markedDead) || (!existing && markedDead)) {
        createEvent('PLAYER_DIED', now, {
          teamId: player.teamId,
          playerId: player.playerExternalId,
        });
      } else if (!previousKnocked && player.knocked && player.alive) {
        createEvent('PLAYER_KNOCKED', now, {
          teamId: player.teamId,
          playerId: player.playerExternalId,
        });
      } else if (previousKnocked && !player.knocked && player.alive) {
        createEvent('PLAYER_REVIVED', now, {
          teamId: player.teamId,
          playerId: player.playerExternalId,
        });
      }

      team.playerKeys.add(key);
      team.hasTelemetryPresence = true;
      state.players.set(key, player);
    }
  }

  private applyKillEvents(
    state: MatchState,
    killEvents: TelemetryPlayerKillEvent[],
    createEvent: (
      type: MatchStateEvent['type'],
      ts: number,
      options?: {
        teamId?: string | null;
        playerId?: string | null;
        payload?: Record<string, unknown> | null;
      },
    ) => MatchStateEvent,
    createKillFeedItem: (
      event: TelemetryPlayerKillEvent,
      totalKills: number,
    ) => void,
    eliminationBlocked: boolean,
  ): void {
    for (const event of killEvents) {
      if (eliminationBlocked) {
        this.logger.warn(
          JSON.stringify({
            tag: '[ELIMINATION][BLOCKED]',
            stage: 'match-state-engine',
            action: 'kill-event-blocked-during-air-phase',
            matchId: state.matchId,
            phase: state.circle?.phase ?? null,
            killerId: event.killerPlayerExternalId,
            victimId: event.victimPlayerExternalId,
            reason: 'EARLY_PHASE_MATCH_STATE_KILL_BLOCKED',
          }),
        );
        continue;
      }
      const eventKey = [
        'PLAYER_KILL',
        event.matchId,
        event.killerPlayerExternalId,
        event.victimPlayerExternalId,
        String(event.timestamp),
      ].join('|');

      if (state.processedEventKeys.has(eventKey)) {
        continue;
      }

      const killer = this.ensureEventPlayer(
        state,
        event.killerTeamId ?? null,
        event.killerPlayerExternalId,
        event.killerPlayerName ?? null,
        event.timestamp,
      );
      const victim = this.ensureEventPlayer(
        state,
        event.victimTeamId ?? null,
        event.victimPlayerExternalId,
        event.victimPlayerName ?? null,
        event.timestamp,
      );

      if (killer) {
        killer.kills += 1;
        killer.updatedAt = event.timestamp;
      }
      if (victim) {
        victim.alive = false;
        victim.knocked = false;
        victim.eliminated = true;
        victim.updatedAt = event.timestamp;
        this.markPlayerDead(victim, event.timestamp);
      }

      if (killer?.teamId) {
        const team = state.teams.get(killer.teamId);
        if (team) {
          team.kills = Math.max(
            team.kills,
            this.sumTeamKills(state, killer.teamId),
          );
          this.logger.debug(
            `[MatchState] team kills recomputed teamId=${killer.teamId} kills=${team.kills}`,
          );
          createKillFeedItem(event, team.kills);
        }
      }

      createEvent('PLAYER_KILL', event.timestamp, {
        teamId: killer?.teamId ?? event.killerTeamId ?? null,
        playerId: killer?.playerExternalId ?? event.killerPlayerExternalId,
        payload: {
          killerTeamId: killer?.teamId ?? event.killerTeamId ?? null,
          victimTeamId: victim?.teamId ?? event.victimTeamId ?? null,
          killerId: event.killerPlayerExternalId,
          victimId: event.victimPlayerExternalId,
          killerPlayerId: event.killerPlayerExternalId,
          victimPlayerId: event.victimPlayerExternalId,
          killerName: killer?.name ?? event.killerPlayerName ?? null,
          killerIgn: killer?.ign ?? event.killerPlayerName ?? null,
          victimName: victim?.name ?? event.victimPlayerName ?? null,
          victimIgn: victim?.ign ?? event.victimPlayerName ?? null,
          weapon: event.weapon ?? null,
          delta: 1,
          timestamp: event.timestamp,
          raw: event.raw ?? null,
        },
      });
      createEvent('PLAYER_DIED', event.timestamp, {
        teamId: victim?.teamId ?? event.victimTeamId ?? null,
        playerId: victim?.playerExternalId ?? event.victimPlayerExternalId,
      });

      this.logger.debug(
        `[MatchState] player killed killer=${event.killerPlayerExternalId} victim=${event.victimPlayerExternalId}`,
      );

      state.processedEventKeys.add(eventKey);
      this.trimProcessedEventKeys(state);
    }
  }

  private ensureEventPlayer(
    state: MatchState,
    teamId: string | null,
    externalPlayerId: string,
    playerName: string | null,
    timestamp: number,
  ): PlayerState | null {
    const key = this.playerKey(externalPlayerId, playerName);
    if (!key) {
      return null;
    }

    const existing = state.players.get(key);
    if (existing) {
      if (teamId && existing.teamId !== teamId) {
        const previousTeam = state.teams.get(existing.teamId);
        previousTeam?.playerKeys.delete(key);
        existing.teamId = teamId;
      }
      if (playerName) {
        existing.name = playerName;
        existing.ign = playerName;
      }
      existing.updatedAt = timestamp;
      if (teamId) {
        const team = state.teams.get(teamId);
        if (team) {
          team.playerKeys.add(key);
          team.hasTelemetryPresence = true;
          if (existing.slot === null) {
            existing.slot = team.slot;
          }
        }
      }
      return existing;
    }

    if (!teamId) {
      return null;
    }

    const team = state.teams.get(teamId);
    if (!team) {
      return null;
    }

    const player: PlayerState = {
      key,
      playerExternalId: externalPlayerId,
      teamId,
      name: playerName,
      ign: playerName,
      avatarUrl: null,
      slot: team.slot,
      kills: 0,
      alive: true,
      knocked: false,
      eliminated: false,
      deathTimestamp: null,
      updatedAt: timestamp,
    };
    team.playerKeys.add(key);
    team.hasTelemetryPresence = true;
    state.players.set(key, player);
    return player;
  }

  private refreshTeamMetrics(
    state: MatchState,
    now: number,
    createEvent: (
      type: MatchStateEvent['type'],
      ts: number,
      options?: {
        teamId?: string | null;
        playerId?: string | null;
        payload?: Record<string, unknown> | null;
      },
    ) => MatchStateEvent,
    eliminationBlocked: boolean,
  ): void {
    let aliveTeams = 0;
    for (const team of state.teams.values()) {
      const wasEliminated = team.eliminated;
      const previousEliminationTimestamp = team.eliminationTimestamp;
      const waitingForTelemetry =
        isAutomaticMatchStateSourceMode(state.sourceMode) &&
        !team.hasTelemetryPresence;

      if (waitingForTelemetry) {
        team.kills = 0;
        team.alive = true;
        team.eliminated = false;
        team.eliminationTimestamp = null;
        team.placement = null;
        team.alivePlayers = null;
        team.updatedAt = now;
        aliveTeams += 1;
        continue;
      }

      const players = [...team.playerKeys]
        .map((key) => state.players.get(key))
        .filter((player): player is PlayerState => Boolean(player));

      team.kills = Math.max(
        team.kills,
        players.reduce((sum, player) => sum + player.kills, 0),
      );
      if (players.length > 0) {
        team.totalPlayers = players.length;
        team.alivePlayers = players.filter((player) => player.alive).length;
        team.alive = team.alivePlayers > 0;
      } else {
        team.totalPlayers = team.totalPlayers ?? null;
        team.alivePlayers = team.alivePlayers ?? null;
        team.alive =
          team.alivePlayers !== null ? team.alivePlayers > 0 : team.alive;
      }
      team.updatedAt = now;

      if (
        eliminationBlocked &&
        team.hasTelemetryPresence &&
        !team.alive &&
        players.length > 0
      ) {
        team.alive = true;
        team.eliminated = false;
        team.eliminationTimestamp = null;
        team.placement = null;
        team.alivePlayers = Math.max(1, team.totalPlayers ?? players.length);
        this.logger.warn(
          JSON.stringify({
            tag: '[ELIMINATION][BLOCKED]',
            stage: 'match-state-engine',
            action: 'team-elimination-blocked-during-air-phase',
            matchId: state.matchId,
            teamId: team.teamId,
            phase: state.circle?.phase ?? null,
            inferredTeamElimination: true,
            reason: 'EARLY_PHASE_MATCH_STATE_TEAM_ELIMINATION_BLOCKED',
          }),
        );
      }

      if (team.hasTelemetryPresence && !team.alive && players.length > 0) {
        const lastDeath = Math.max(
          0,
          ...players.map((player) => player.deathTimestamp ?? 0),
        );
        team.eliminated = true;
        team.eliminationTimestamp =
          lastDeath > 0 ? lastDeath : (team.eliminationTimestamp ?? now);
        if (!wasEliminated) {
          createEvent('TEAM_ELIMINATED', team.eliminationTimestamp, {
            teamId: team.teamId,
          });
        }
        if (
          !wasEliminated ||
          previousEliminationTimestamp !== team.eliminationTimestamp
        ) {
          this.logger.debug(
            `[EliminationEngine] team eliminated teamId=${team.teamId} ts=${team.eliminationTimestamp}`,
          );
        }
      }

      if (team.eliminated) {
        team.alive = false;
        team.alivePlayers = 0;
      }

      if (team.alive) {
        aliveTeams += 1;
      }
    }
    state.aliveTeams = aliveTeams;
  }

  private shouldBlockEliminationForPhase(state: MatchState): boolean {
    const phase =
      typeof state.circle?.phase === 'number' &&
      Number.isFinite(state.circle.phase)
        ? Math.trunc(state.circle.phase)
        : null;
    return phase !== null && phase < 2 && state.status === 'LIVE';
  }

  private hasTelemetryPresence(state: MatchState): boolean {
    for (const team of state.teams.values()) {
      if (team.hasTelemetryPresence) {
        return true;
      }
    }
    return false;
  }

  private assignPlacements(state: MatchState): void {
    const teams = [...state.teams.values()];
    const eliminated = teams
      .filter((team) => team.eliminationTimestamp !== null)
      .sort((left, right) => {
        if (left.eliminationTimestamp !== right.eliminationTimestamp) {
          return (
            (left.eliminationTimestamp ?? Number.MAX_SAFE_INTEGER) -
            (right.eliminationTimestamp ?? Number.MAX_SAFE_INTEGER)
          );
        }
        if (left.kills !== right.kills) {
          return right.kills - left.kills;
        }
        const leftSlot = left.slot ?? Number.MAX_SAFE_INTEGER;
        const rightSlot = right.slot ?? Number.MAX_SAFE_INTEGER;
        if (leftSlot !== rightSlot) {
          return leftSlot - rightSlot;
        }
        return left.teamId.localeCompare(right.teamId);
      });

    for (const [index, team] of eliminated.entries()) {
      const nextPlacement = teams.length - index;
      if (team.placement !== nextPlacement) {
        team.placement = nextPlacement;
        this.logger.debug(
          `[EliminationEngine] placement assigned teamId=${team.teamId} place=${nextPlacement}`,
        );
      }
    }

    const surviving = teams
      .filter((team) => !team.eliminated)
      .sort((left, right) => {
        const leftSlot = left.slot ?? Number.MAX_SAFE_INTEGER;
        const rightSlot = right.slot ?? Number.MAX_SAFE_INTEGER;
        if (leftSlot !== rightSlot) {
          return leftSlot - rightSlot;
        }
        return left.teamId.localeCompare(right.teamId);
      });

    if (surviving.length === 1 && surviving[0].placement !== 1) {
      surviving[0].placement = 1;
      this.logger.debug(
        `[EliminationEngine] placement assigned teamId=${surviving[0].teamId} place=1`,
      );
    }
  }

  private buildSummary(state: MatchState): MatchStateSummary {
    const teams = [...state.teams.values()];
    const totalPlayers = teams.reduce(
      (sum, team) => sum + (team.totalPlayers ?? team.playerKeys.size),
      0,
    );
    const alivePlayers = teams.reduce(
      (sum, team) => sum + (team.alivePlayers ?? 0),
      0,
    );
    const winner =
      teams.find((team) => team.placement === 1) ??
      teams.find((team) => team.alive);

    return {
      totalTeams: teams.length,
      aliveTeams: state.aliveTeams,
      totalPlayers,
      alivePlayers,
      winnerTeamId: winner?.teamId ?? null,
      winnerSlot: winner?.slot ?? null,
    };
  }

  private toPublicTeams(state: MatchState): TeamScoreState[] {
    return [...state.teams.values()]
      .map((team) => ({
        teamId: team.teamId,
        name: team.name,
        tag: team.tag,
        slot: team.slot,
        kills: team.kills,
        placement: team.placement,
        points: team.points,
        logoUrl: team.logoUrl,
        hasTelemetryPresence: team.hasTelemetryPresence,
        alivePlayers: team.alivePlayers,
        totalPlayers: team.totalPlayers,
        alive: team.alive,
        eliminated: team.eliminated,
        updatedAt: new Date(team.updatedAt).toISOString(),
        sourceMode: 'API' as const,
        players: [...team.playerKeys]
          .map((key) => state.players.get(key))
          .filter((player): player is PlayerState => Boolean(player))
          .sort((left, right) =>
            (left.name ?? left.playerExternalId).localeCompare(
              right.name ?? right.playerExternalId,
            ),
          )
          .map(
            (player): MatchStatePlayer => ({
              externalPlayerId: player.playerExternalId,
              pubgPlayerId: player.playerExternalId,
              playerId: player.playerExternalId,
              name: player.name,
              ign: player.ign,
              avatarUrl: player.avatarUrl,
              teamId: player.teamId,
              slot: player.slot,
              alive: player.alive,
              knocked: player.knocked,
              eliminated: player.eliminated,
              kills: player.kills,
              updatedAt: new Date(player.updatedAt).toISOString(),
            }),
          ),
      }))
      .sort((left, right) => {
        const leftSlot = left.slot ?? Number.MAX_SAFE_INTEGER;
        const rightSlot = right.slot ?? Number.MAX_SAFE_INTEGER;
        if (leftSlot !== rightSlot) {
          return leftSlot - rightSlot;
        }
        return (left.name ?? left.teamId).localeCompare(
          right.name ?? right.teamId,
        );
      });
  }

  private normalizeTeams(
    teams: TeamScoreState[],
    now: number,
  ): TeamScoreState[] {
    return teams.map((team) => ({
      ...team,
      updatedAt: team.updatedAt ?? new Date(now).toISOString(),
      sourceMode: 'API',
      players: Array.isArray(team.players)
        ? team.players.map((player) => ({
            ...player,
            updatedAt: player.updatedAt ?? new Date(now).toISOString(),
          }))
        : [],
    }));
  }

  private extractTelemetryPlayers(
    payload: unknown,
    state: MatchState,
  ): TelemetryPlayerSnapshot[] {
    const root = this.toRecord(payload);
    if (!root) {
      return [];
    }

    this.logger.debug(
      `[TelemetryParser] payload keys=${this.formatTelemetryKeys(root)}`,
    );

    const snapshots: TelemetryPlayerSnapshot[] = [];
    const slotByTeamId = new Map<string, number | null>();
    const teamIdBySlot = new Map<number, string>();
    for (const team of state.teams.values()) {
      slotByTeamId.set(team.teamId, team.slot);
      if (team.slot !== null) {
        teamIdBySlot.set(team.slot, team.teamId);
      }
    }

    const addSnapshot = (entry: Record<string, unknown>) => {
      const directTeamId = this.telemetryTeamId(entry);
      const slot =
        this.telemetrySlotNumber(entry) ??
        (directTeamId ? (slotByTeamId.get(directTeamId) ?? null) : null);
      const teamId =
        directTeamId ??
        (slot !== null ? (teamIdBySlot.get(slot) ?? null) : null);

      snapshots.push({
        teamId,
        slot,
        externalPlayerId: this.telemetryPlayerId(entry),
        name: this.telemetryPlayerName(entry),
        avatarUrl: this.telemetryPlayerAvatar(entry),
        alive: this.telemetryAlive(entry),
        knocked: this.telemetryKnocked(entry),
      });
    };

    for (const batch of this.collectTelemetryEntryBatches(
      payload,
      SHADOW_TELEMETRY_TEAM_LIST_KEYS,
    )) {
      this.logger.debug(
        `[TelemetryParser] using team list from ${batch.source}`,
      );
      for (const teamEntry of batch.entries) {
        const entryPlayers = this.extractTelemetryArray(teamEntry.players);
        if (entryPlayers.length > 0) {
          for (const playerEntry of entryPlayers) {
            addSnapshot({
              ...teamEntry,
              ...playerEntry,
            });
          }
        }
      }
    }

    for (const batch of this.collectTelemetryEntryBatches(
      payload,
      SHADOW_TELEMETRY_PLAYER_LIST_KEYS,
    )) {
      this.logger.debug(
        `[TelemetryParser] using player list from ${batch.source}`,
      );
      for (const entry of batch.entries) {
        addSnapshot(entry);
      }
    }

    const filtered = snapshots.filter(
      (entry) =>
        Boolean(entry.teamId) &&
        Boolean(entry.externalPlayerId ?? entry.name ?? null),
    );
    this.logger.debug(
      `[TelemetryParser] extracted players count=${filtered.length}`,
    );
    return filtered;
  }

  private telemetryPlayerId(entry: Record<string, unknown>): string | null {
    return (
      this.toString(entry.playerOpenId) ??
      this.toString(entry.playerOpenID) ??
      this.toString(entry.PlayerOpenId) ??
      this.toString(entry.PlayerOpenID) ??
      this.toString(entry.externalPlayerId) ??
      this.toString(entry.externalId) ??
      this.toString(entry.playerId) ??
      this.toString(entry.pubgPlayerId) ??
      this.toString(entry.inGameId) ??
      this.toString(entry.accountId) ??
      this.toString(entry.id) ??
      null
    );
  }

  private telemetryPlayerName(entry: Record<string, unknown>): string | null {
    return (
      this.toString(entry.playerName) ??
      this.toString(entry.ign) ??
      this.toString(entry.name) ??
      this.toString(entry.nickname) ??
      this.toString(entry.player) ??
      this.telemetryPlayerId(entry)
    );
  }

  private telemetryPlayerAvatar(entry: Record<string, unknown>): string | null {
    return (
      this.toString(entry.photoUrl) ??
      this.toString(entry.avatarUrl) ??
      this.toString(entry.avatar) ??
      this.toString(entry.imageUrl) ??
      this.toString(entry.image) ??
      null
    );
  }

  private telemetryTeamId(entry: Record<string, unknown>): string | null {
    const team = this.toRecord(entry.team);
    return (
      this.toString(entry.teamId) ??
      this.toString(entry.teamID) ??
      this.toString(entry.TeamId) ??
      this.toString(entry.TeamID) ??
      this.toString(entry.team_id) ??
      this.toString(team?.id) ??
      null
    );
  }

  private telemetrySlotNumber(entry: Record<string, unknown>): number | null {
    const team = this.toRecord(entry.team);
    const slot = this.toNumber(
      entry.slot ??
        entry.slotNumber ??
        entry.Slot ??
        entry.SlotNumber ??
        entry.teamSlot ??
        team?.slot ??
        team?.slotNumber ??
        null,
    );
    return slot && slot > 0 ? slot : null;
  }

  private telemetryAlive(entry: Record<string, unknown>): boolean | null {
    for (const candidate of [
      entry.isAlive,
      entry.alive,
      entry.liveState,
      entry.LiveState,
      entry.live_state,
      entry.status,
      entry.Status,
      entry.state,
    ]) {
      if (typeof candidate === 'boolean') {
        return candidate;
      }
      if (typeof candidate === 'number') {
        return candidate > 0;
      }
      if (typeof candidate === 'string') {
        const normalized = candidate.trim().toLowerCase();
        if (['alive', 'live', 'active'].includes(normalized)) return true;
        if (['dead', 'down', 'killed', 'offline'].includes(normalized))
          return false;
      }
    }
    return null;
  }

  private telemetryKnocked(entry: Record<string, unknown>): boolean | null {
    for (const candidate of [
      entry.isKnocked,
      entry.knocked,
      entry.dbno,
      entry.isDown,
      entry.downed,
      entry.down,
      entry.status,
      entry.Status,
    ]) {
      if (typeof candidate === 'boolean') {
        return candidate;
      }
      if (typeof candidate === 'number') {
        return candidate > 0;
      }
      if (typeof candidate === 'string') {
        const normalized = candidate.trim().toLowerCase();
        if (['knocked', 'dbno', 'down'].includes(normalized)) return true;
        if (['alive', 'live', 'dead'].includes(normalized)) return false;
      }
    }
    return null;
  }

  private extractTelemetryArray(
    value: unknown,
  ): Array<Record<string, unknown>> {
    const direct = this.toRecordArray(value);
    if (direct.length > 0) {
      return direct;
    }

    for (const batch of this.collectTelemetryEntryBatches(value, [
      ...SHADOW_TELEMETRY_PLAYER_LIST_KEYS,
      ...SHADOW_TELEMETRY_TEAM_LIST_KEYS,
    ])) {
      if (batch.entries.length > 0) {
        return batch.entries;
      }
    }

    return [];
  }

  private collectTelemetryEntryBatches(
    payload: unknown,
    keys: readonly string[],
  ): Array<{
    source: string;
    entries: Array<Record<string, unknown>>;
  }> {
    const batches: Array<{
      source: string;
      entries: Array<Record<string, unknown>>;
    }> = [];

    const direct = this.toRecordArray(payload);
    if (direct.length > 0) {
      batches.push({
        source: 'array',
        entries: direct,
      });
    }

    for (const candidate of this.collectTelemetryRecords(payload)) {
      for (const key of keys) {
        const entries = this.toRecordArray(candidate.record[key]);
        if (entries.length === 0) {
          continue;
        }
        batches.push({
          source: candidate.path === 'root' ? key : `${candidate.path}.${key}`,
          entries,
        });
      }
    }

    return batches;
  }

  private collectTelemetryRecords(
    payload: unknown,
    path = 'root',
  ): Array<{ path: string; record: Record<string, unknown> }> {
    const root = this.toRecord(payload);
    if (!root) {
      return [];
    }

    const queue: Array<{ path: string; record: Record<string, unknown> }> = [
      { path, record: root },
    ];
    const records: Array<{ path: string; record: Record<string, unknown> }> =
      [];
    const seen = new Set<Record<string, unknown>>();

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current || seen.has(current.record)) {
        continue;
      }
      seen.add(current.record);
      records.push(current);

      for (const key of SHADOW_TELEMETRY_WRAPPER_KEYS) {
        const nested = this.toRecord(current.record[key]);
        if (!nested || seen.has(nested)) {
          continue;
        }
        queue.push({
          path: current.path === 'root' ? key : `${current.path}.${key}`,
          record: nested,
        });
      }
    }

    return records;
  }

  private toRecordArray(value: unknown): Array<Record<string, unknown>> {
    if (!Array.isArray(value)) {
      return [];
    }
    return value
      .map((item) => this.toRecord(item))
      .filter((item): item is Record<string, unknown> => Boolean(item));
  }

  private formatTelemetryKeys(record: Record<string, unknown>): string {
    const keys = Object.keys(record);
    return keys.length > 0 ? keys.join(',') : 'none';
  }

  private normalizeCircle(
    circle: MatchStateCircle | null | undefined,
  ): MatchStateCircle | null {
    if (!circle) {
      return null;
    }
    return {
      phase:
        typeof circle.phase === 'number' || circle.phase === null
          ? circle.phase
          : null,
      nextShrinkAt:
        typeof circle.nextShrinkAt === 'number' || circle.nextShrinkAt === null
          ? circle.nextShrinkAt
          : null,
      safeZone: circle.safeZone ?? null,
      nextZone: circle.nextZone ?? null,
    };
  }

  private normalizeObservedPlayer(
    player: MatchStateObservedPlayer | null | undefined,
    updatedAt: number,
  ): MatchStateObservedPlayer | null {
    if (!player) {
      return null;
    }
    return {
      playerId: player.playerId ?? null,
      externalPlayerId: player.externalPlayerId ?? null,
      pubgPlayerId: player.pubgPlayerId ?? null,
      playerName: player.playerName ?? null,
      playerIgn: player.playerIgn ?? null,
      teamId: player.teamId ?? null,
      teamName: player.teamName ?? null,
      teamTag: player.teamTag ?? null,
      teamLogoUrl: player.teamLogoUrl ?? null,
      updatedAt: player.updatedAt ?? new Date(updatedAt).toISOString(),
    };
  }

  private observedSignature(player: MatchStateObservedPlayer | null): string {
    if (!player) {
      return '';
    }
    return [
      player.teamId ?? '',
      player.playerId ?? '',
      player.externalPlayerId ?? '',
      player.playerName ?? '',
    ].join('|');
  }

  private circleSignature(circle: MatchStateCircle | null): string {
    if (!circle) {
      return '';
    }
    return JSON.stringify(circle);
  }

  private sumTeamKills(state: MatchState, teamId: string): number {
    const team = state.teams.get(teamId);
    if (!team) {
      return 0;
    }
    return [...team.playerKeys].reduce((sum, key) => {
      const player = state.players.get(key);
      return sum + (player?.kills ?? 0);
    }, 0);
  }

  private markPlayerDead(player: PlayerState, timestamp: number): boolean {
    if (player.deathTimestamp !== null) {
      return false;
    }
    player.deathTimestamp = timestamp;
    return true;
  }

  private trimProcessedEventKeys(state: MatchState): void {
    while (state.processedEventKeys.size > this.maxProcessedEventKeys) {
      const nextValue = state.processedEventKeys.values().next();
      const first =
        typeof nextValue.value === 'string' ? nextValue.value : null;
      if (!first) break;
      state.processedEventKeys.delete(first);
    }
  }

  private playerKey(
    externalPlayerId: string | null | undefined,
    name: string | null | undefined,
  ): string | null {
    const normalizedExternal = this.normalizeValue(externalPlayerId);
    if (normalizedExternal) {
      return `id:${normalizedExternal}`;
    }
    const normalizedName = this.normalizeValue(name);
    if (normalizedName) {
      return `name:${normalizedName}`;
    }
    return null;
  }

  private normalizeValue(value: string | null | undefined): string | null {
    if (!value) {
      return null;
    }
    const normalized = value.trim().toLowerCase();
    return normalized.length > 0 ? normalized : null;
  }

  private toRecord(value: unknown): Record<string, unknown> | null {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return null;
  }

  private toString(value: unknown): string | null {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : null;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
    return null;
  }

  private toNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return Math.trunc(value);
    }
    if (typeof value === 'string' && value.trim().length > 0) {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
    }
    return null;
  }

  private toTimestamp(
    value: string | number | null | undefined,
  ): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string' && value.trim().length > 0) {
      const asNumber = Number(value);
      if (Number.isFinite(asNumber)) {
        return asNumber;
      }
      const asDate = Date.parse(value);
      return Number.isFinite(asDate) ? asDate : null;
    }
    return null;
  }
}
