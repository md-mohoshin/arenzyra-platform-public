import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import type { ControlStatus } from '../match-control/dto/control.dto';
import type {
  MatchStateEvent,
  MatchStateSourceMode,
  MatchStateSummary,
  TeamScoreState,
} from '../match-control/state.store';
import { isAutomaticMatchStateSourceMode } from '../match-control/state.store';
import { EventBusService } from '../event-bus/event-bus.service';
import {
  EVENT_BUS_TOPICS,
  type BroadcastMomentEventPayload,
  type FightDetectedEventPayload,
  type MatchStateUpdatedEventPayload,
} from '../event-bus/event-bus.types';
import type { FightEvent } from '../telemetry/fight-detection.engine';

export type BroadcastEventType =
  | 'TEAM_WIPE'
  | 'FIRST_BLOOD'
  | 'DOUBLE_KILL'
  | 'TRIPLE_KILL'
  | 'QUADRA_KILL'
  | 'CLUTCH'
  | 'MATCH_WINNER';

export type BroadcastEvent = {
  type: BroadcastEventType;
  matchId: string;
  timestamp: number;
  teamId?: string | null;
  teamName?: string | null;
  teamTag?: string | null;
  teamLogoUrl?: string | null;
  playerId?: string | null;
  playerName?: string | null;
  playerPhotoUrl?: string | null;
  fightId?: string | null;
  opponentTeamIds?: string[];
  streakCount?: number | null;
  durationMs?: number | null;
};

type KillMarker = {
  eventId: string;
  timestamp: number;
};

type KillPairMarker = {
  playerId: string | null;
  playerName: string | null;
  timestamp: number;
};

type BroadcastMatchState = {
  processedMatchEventIds: Set<string>;
  processedFightEventKeys: Set<string>;
  killStreaksByPlayer: Map<string, KillMarker[]>;
  lastKillByPair: Map<string, KillPairMarker>;
  lastKnownKillsByPlayer: Map<string, number>;
  emittedKeys: Set<string>;
  firstBloodEmitted: boolean;
  winnerEmitted: boolean;
};

type BroadcastMatchContext = Omit<
  BroadcastEventEngineInput,
  'matchEvents' | 'fightEvents'
> & {
  organizationId: string | null;
};

export type BroadcastEventEngineInput = {
  matchId: string;
  sourceMode?: MatchStateSourceMode | null;
  updatedAt?: string | number | null;
  status?: ControlStatus | null;
  finished?: boolean;
  teams: TeamScoreState[];
  summary?: MatchStateSummary | null;
  matchEvents: MatchStateEvent[];
  fightEvents: FightEvent[];
};

@Injectable()
export class BroadcastEventEngine implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BroadcastEventEngine.name);
  private readonly stateByMatch = new Map<string, BroadcastMatchState>();
  private readonly streakWindowMs = 8_000;
  private readonly maxProcessedIds = 4096;
  private readonly publishedEvents = new Map<string, BroadcastEvent[]>();
  private readonly latestContexts = new Map<string, BroadcastMatchContext>();
  private unsubscribeFromStateBus: (() => void) | null = null;
  private unsubscribeFromFightBus: (() => void) | null = null;

  constructor(@Optional() private readonly eventBus?: EventBusService) {}

  onModuleInit(): void {
    if (!this.eventBus) {
      return;
    }

    this.unsubscribeFromStateBus = this.eventBus.subscribe(
      EVENT_BUS_TOPICS.MATCH,
      'broadcast-event-engine-state',
      async (envelope) => {
        const payload = envelope.payload as MatchStateUpdatedEventPayload;
        this.latestContexts.set(payload.matchId, {
          matchId: payload.projection.matchId,
          organizationId: payload.organizationId ?? null,
          sourceMode: payload.projection.sourceMode,
          updatedAt: payload.projection.updatedAt,
          status: payload.projection.status,
          finished: payload.projection.finished,
          teams: payload.projection.teams,
          summary: payload.projection.summary,
        });

        const broadcastEvents = this.processMatch({
          matchId: payload.projection.matchId,
          sourceMode: payload.projection.sourceMode,
          updatedAt: payload.projection.updatedAt,
          status: payload.projection.status,
          finished: payload.projection.finished,
          teams: payload.projection.teams,
          summary: payload.projection.summary,
          matchEvents: payload.projection.events,
          fightEvents: [],
        });
        await this.publishMoments(
          payload.matchId,
          payload.organizationId ?? null,
          broadcastEvents,
        );
      },
      { types: ['state.updated'] },
    );

    this.unsubscribeFromFightBus = this.eventBus.subscribe(
      EVENT_BUS_TOPICS.FIGHT,
      'broadcast-event-engine-fight',
      async (envelope) => {
        const payload = envelope.payload as FightDetectedEventPayload;
        const context = this.latestContexts.get(payload.matchId);
        if (!context) {
          return;
        }

        const broadcastEvents = this.processMatch({
          matchId: context.matchId,
          sourceMode: context.sourceMode,
          updatedAt: payload.fightEvent.timestamp,
          status: context.status,
          finished: context.finished,
          teams: context.teams,
          summary: context.summary,
          matchEvents: [],
          fightEvents: [payload.fightEvent],
        });
        await this.publishMoments(
          payload.matchId,
          context.organizationId,
          broadcastEvents,
        );
      },
      { types: ['fight.detected'] },
    );
  }

  onModuleDestroy(): void {
    this.unsubscribeFromStateBus?.();
    this.unsubscribeFromFightBus?.();
    this.unsubscribeFromStateBus = null;
    this.unsubscribeFromFightBus = null;
  }

  processMatch(input: BroadcastEventEngineInput): BroadcastEvent[] {
    if (!isAutomaticMatchStateSourceMode(input.sourceMode)) {
      this.stateByMatch.delete(input.matchId);
      return [];
    }

    const matchState =
      this.stateByMatch.get(input.matchId) ?? this.createMatchState();
    this.stateByMatch.set(input.matchId, matchState);

    const broadcastEvents: BroadcastEvent[] = [];
    const teamsById = new Map(input.teams.map((team) => [team.teamId, team]));
    const playersById = new Map<
      string,
      {
        avatarUrl: string | null;
        name: string | null;
      }
    >();

    for (const team of input.teams) {
      for (const player of team.players ?? []) {
        const playerId =
          this.stringValue(player.playerId) ?? this.stringValue(player.id);
        if (!playerId) {
          continue;
        }

        playersById.set(playerId, {
          avatarUrl: this.stringValue(player.avatarUrl),
          name: this.stringValue(player.ign) ?? this.stringValue(player.name),
        });
      }
    }

    const explicitKillCountsByPlayer = new Map<string, number>();
    for (const event of input.matchEvents) {
      if (event.type !== 'PLAYER_KILL') {
        continue;
      }
      const payload = event.payload ?? {};
      const killerPlayerId =
        this.stringValue(payload.killerPlayerId) ??
        this.stringValue(payload.killerId) ??
        event.playerId ??
        null;
      if (!killerPlayerId) {
        continue;
      }
      explicitKillCountsByPlayer.set(
        killerPlayerId,
        (explicitKillCountsByPlayer.get(killerPlayerId) ?? 0) + 1,
      );
    }

    const syntheticKillEvents = this.buildSyntheticKillEvents(
      input,
      matchState,
      explicitKillCountsByPlayer,
    );
    const orderedMatchEvents = [
      ...input.matchEvents,
      ...syntheticKillEvents,
    ].sort((left, right) => {
      if (left.ts !== right.ts) return left.ts - right.ts;
      return left.id.localeCompare(right.id);
    });

    for (const event of orderedMatchEvents) {
      if (matchState.processedMatchEventIds.has(event.id)) {
        continue;
      }
      matchState.processedMatchEventIds.add(event.id);
      this.trimSet(matchState.processedMatchEventIds);

      if (event.type !== 'PLAYER_KILL') {
        continue;
      }

      const payload = event.payload ?? {};
      const killerPlayerId =
        this.stringValue(payload.killerPlayerId) ??
        this.stringValue(payload.killerId) ??
        event.playerId ??
        null;
      const killerTeamId =
        this.stringValue(payload.killerTeamId) ?? event.teamId ?? null;
      const killerName =
        this.stringValue(payload.killerName) ??
        this.stringValue(payload.killerIgn);
      const victimTeamId = this.stringValue(payload.victimTeamId);
      const timestamp =
        this.numberValue(payload.timestamp) ?? event.ts ?? Date.now();

      if (!killerPlayerId || !killerTeamId) {
        continue;
      }

      if (!matchState.firstBloodEmitted) {
        matchState.firstBloodEmitted = true;
        const team = teamsById.get(killerTeamId);
        const player = playersById.get(killerPlayerId);
        broadcastEvents.push({
          type: 'FIRST_BLOOD',
          matchId: input.matchId,
          timestamp,
          teamId: killerTeamId,
          teamName: team?.name ?? null,
          teamTag: team?.tag ?? null,
          teamLogoUrl: team?.logoUrl ?? null,
          playerId: killerPlayerId,
          playerName: killerName ?? player?.name ?? null,
          playerPhotoUrl: player?.avatarUrl ?? null,
        });
        this.logger.debug(
          `[BroadcastEngine] first blood playerId=${killerPlayerId}`,
        );
      }

      if (victimTeamId) {
        matchState.lastKillByPair.set(
          this.pairKey(killerTeamId, victimTeamId),
          {
            playerId: killerPlayerId,
            playerName: killerName,
            timestamp,
          },
        );
      }

      const streak = (
        matchState.killStreaksByPlayer.get(killerPlayerId) ?? []
      ).filter((marker) => timestamp - marker.timestamp <= this.streakWindowMs);
      streak.push({ eventId: event.id, timestamp });
      matchState.killStreaksByPlayer.set(killerPlayerId, streak);

      const streakEventType =
        streak.length === 3
          ? 'TRIPLE_KILL'
          : streak.length === 4
            ? 'QUADRA_KILL'
            : null;
      if (!streakEventType) {
        continue;
      }

      const dedupeKey = `${streakEventType}:${killerPlayerId}:${event.id}`;
      if (matchState.emittedKeys.has(dedupeKey)) {
        continue;
      }
      matchState.emittedKeys.add(dedupeKey);

      const team = teamsById.get(killerTeamId);
      const player = playersById.get(killerPlayerId);
      const eventPayload: BroadcastEvent = {
        type: streakEventType,
        matchId: input.matchId,
        timestamp,
        teamId: killerTeamId,
        teamName: team?.name ?? null,
        teamTag: team?.tag ?? null,
        teamLogoUrl: team?.logoUrl ?? null,
        playerId: killerPlayerId,
        playerName: killerName ?? player?.name ?? null,
        playerPhotoUrl: player?.avatarUrl ?? null,
        streakCount: streak.length,
      };
      broadcastEvents.push(eventPayload);
      this.logStreak(streakEventType, killerPlayerId);
    }

    for (const fightEvent of input.fightEvents) {
      const fightKey = `${fightEvent.type}:${fightEvent.fightId}:${fightEvent.teamId ?? 'none'}:${fightEvent.timestamp}`;
      if (matchState.processedFightEventKeys.has(fightKey)) {
        continue;
      }
      matchState.processedFightEventKeys.add(fightKey);
      this.trimSet(matchState.processedFightEventKeys);

      if (fightEvent.type !== 'TEAM_WIPED') {
        continue;
      }

      const wipedTeam = fightEvent.teamId ?? null;
      const opponentTeamIds = fightEvent.opponentTeamIds ?? [];
      const dedupeKey = `TEAM_WIPE:${fightEvent.fightId}:${wipedTeam ?? 'none'}`;
      if (!matchState.emittedKeys.has(dedupeKey)) {
        matchState.emittedKeys.add(dedupeKey);
        const team = wipedTeam ? teamsById.get(wipedTeam) : null;
        broadcastEvents.push({
          type: 'TEAM_WIPE',
          matchId: input.matchId,
          timestamp: fightEvent.timestamp,
          teamId: wipedTeam,
          teamName: team?.name ?? null,
          teamTag: team?.tag ?? null,
          teamLogoUrl: team?.logoUrl ?? null,
          fightId: fightEvent.fightId,
          opponentTeamIds,
          durationMs: fightEvent.durationMs,
        });
        this.logger.debug(
          `[BroadcastEngine] team wipe teamId=${wipedTeam ?? 'unknown'}`,
        );
      }

      if (opponentTeamIds.length !== 1) {
        continue;
      }

      const clutchTeam = teamsById.get(opponentTeamIds[0]);
      if (!clutchTeam || (clutchTeam.alivePlayers ?? 0) !== 1) {
        continue;
      }

      const lastKill = matchState.lastKillByPair.get(
        this.pairKey(opponentTeamIds[0], wipedTeam ?? ''),
      );
      const clutchPlayer = lastKill?.playerId
        ? playersById.get(lastKill.playerId)
        : null;
      const clutchKey = `CLUTCH:${fightEvent.fightId}:${opponentTeamIds[0]}`;
      if (matchState.emittedKeys.has(clutchKey)) {
        continue;
      }
      matchState.emittedKeys.add(clutchKey);

      broadcastEvents.push({
        type: 'CLUTCH',
        matchId: input.matchId,
        timestamp: lastKill?.timestamp ?? fightEvent.timestamp,
        teamId: clutchTeam.teamId,
        teamName: clutchTeam.name,
        teamTag: clutchTeam.tag,
        teamLogoUrl: clutchTeam.logoUrl ?? null,
        playerId: lastKill?.playerId ?? null,
        playerName: lastKill?.playerName ?? clutchPlayer?.name ?? null,
        playerPhotoUrl: clutchPlayer?.avatarUrl ?? null,
        fightId: fightEvent.fightId,
        opponentTeamIds,
        durationMs: fightEvent.durationMs,
      });
    }

    const finished =
      input.finished === true ||
      input.status === 'FINISH_PENDING' ||
      input.status === 'FINISHED';
    const winnerTeamId =
      input.summary?.winnerTeamId ??
      input.teams.find((team) => team.placement === 1)?.teamId ??
      null;
    if (finished && winnerTeamId && !matchState.winnerEmitted) {
      matchState.winnerEmitted = true;
      const team = teamsById.get(winnerTeamId);
      broadcastEvents.push({
        type: 'MATCH_WINNER',
        matchId: input.matchId,
        timestamp: this.toTimestamp(input.updatedAt) ?? Date.now(),
        teamId: winnerTeamId,
        teamName: team?.name ?? null,
        teamTag: team?.tag ?? null,
        teamLogoUrl: team?.logoUrl ?? null,
      });
      this.logger.debug(
        `[BroadcastEngine] match winner teamId=${winnerTeamId}`,
      );
    }

    return broadcastEvents;
  }

  pruneMatches(activeMatchIds: string[]): void {
    const active = new Set(activeMatchIds);
    for (const matchId of this.stateByMatch.keys()) {
      if (!active.has(matchId)) {
        this.stateByMatch.delete(matchId);
      }
    }
    for (const matchId of this.publishedEvents.keys()) {
      if (!active.has(matchId)) {
        this.publishedEvents.delete(matchId);
      }
    }
    for (const matchId of this.latestContexts.keys()) {
      if (!active.has(matchId)) {
        this.latestContexts.delete(matchId);
      }
    }
  }

  drainPublishedEvents(matchId: string): BroadcastEvent[] {
    const next = this.publishedEvents.get(matchId) ?? [];
    this.publishedEvents.delete(matchId);
    return next;
  }

  private createMatchState(): BroadcastMatchState {
    return {
      processedMatchEventIds: new Set<string>(),
      processedFightEventKeys: new Set<string>(),
      killStreaksByPlayer: new Map<string, KillMarker[]>(),
      lastKillByPair: new Map<string, KillPairMarker>(),
      lastKnownKillsByPlayer: new Map<string, number>(),
      emittedKeys: new Set<string>(),
      firstBloodEmitted: false,
      winnerEmitted: false,
    };
  }

  private buildSyntheticKillEvents(
    input: BroadcastEventEngineInput,
    matchState: BroadcastMatchState,
    explicitKillCountsByPlayer: Map<string, number>,
  ): MatchStateEvent[] {
    const syntheticEvents: MatchStateEvent[] = [];
    const nextKnownKills = new Map<string, number>();
    const snapshotTimestamp = this.toTimestamp(input.updatedAt) ?? Date.now();
    const firstSnapshotForMatch = matchState.lastKnownKillsByPlayer.size === 0;

    for (const team of input.teams) {
      for (const player of team.players ?? []) {
        const playerId =
          this.stringValue(player.playerId) ?? this.stringValue(player.id);
        if (!playerId) {
          continue;
        }

        const currentKills = Math.max(
          0,
          typeof player.kills === 'number' && Number.isFinite(player.kills)
            ? Math.trunc(player.kills)
            : 0,
        );
        nextKnownKills.set(playerId, currentKills);

        const previousKills = matchState.lastKnownKillsByPlayer.get(playerId);
        if (firstSnapshotForMatch || previousKills === undefined) {
          continue;
        }

        const explicitKills = explicitKillCountsByPlayer.get(playerId) ?? 0;
        const delta = currentKills - previousKills - explicitKills;
        if (delta <= 0) {
          continue;
        }

        const playerName =
          this.stringValue(player.ign) ?? this.stringValue(player.name);
        const eventTimestamp =
          this.toTimestamp(player.updatedAt) ?? snapshotTimestamp;
        for (let index = 0; index < delta; index += 1) {
          const totalKills = previousKills + explicitKills + index + 1;
          syntheticEvents.push({
            id: `synthetic-kill:${playerId}:${eventTimestamp}:${totalKills}`,
            type: 'PLAYER_KILL',
            ts: eventTimestamp + index,
            teamId: team.teamId,
            playerId,
            payload: {
              killerPlayerId: playerId,
              killerId: playerId,
              killerTeamId: team.teamId,
              killerName: playerName,
              killerIgn: playerName,
              timestamp: eventTimestamp + index,
              synthetic: true,
              syntheticSource: 'kill-delta',
            },
          });
        }
      }
    }

    matchState.lastKnownKillsByPlayer = nextKnownKills;
    return syntheticEvents;
  }

  private logStreak(type: BroadcastEventType, playerId: string): void {
    if (type === 'DOUBLE_KILL') {
      this.logger.debug(`[BroadcastEngine] double kill playerId=${playerId}`);
      return;
    }
    if (type === 'TRIPLE_KILL') {
      this.logger.debug(`[BroadcastEngine] triple kill playerId=${playerId}`);
      return;
    }
    if (type === 'QUADRA_KILL') {
      this.logger.debug(`[BroadcastEngine] quadra kill playerId=${playerId}`);
    }
  }

  private trimSet(values: Set<string>): void {
    while (values.size > this.maxProcessedIds) {
      const next = values.values().next();
      const first = typeof next.value === 'string' ? next.value : null;
      if (!first) break;
      values.delete(first);
    }
  }

  private pairKey(left: string, right: string): string {
    return [left, right].sort().join('|');
  }

  private stringValue(value: unknown): string | null {
    if (typeof value !== 'string') {
      return null;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private numberValue(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string' && value.trim().length > 0) {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  }

  private toTimestamp(
    value: number | string | null | undefined,
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

  private async publishMoments(
    matchId: string,
    organizationId: string | null,
    broadcastEvents: BroadcastEvent[],
  ): Promise<void> {
    if (broadcastEvents.length === 0) {
      return;
    }

    const queue = this.publishedEvents.get(matchId) ?? [];
    queue.push(...broadcastEvents);
    this.publishedEvents.set(matchId, queue);

    for (const broadcastEvent of broadcastEvents) {
      await this.eventBus?.publish<BroadcastMomentEventPayload>(
        EVENT_BUS_TOPICS.BROADCAST,
        'broadcast.moment',
        {
          matchId,
          organizationId,
          broadcastEvent,
        },
        { timestamp: broadcastEvent.timestamp },
      );
    }
  }
}
