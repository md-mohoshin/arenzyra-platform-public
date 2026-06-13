import { Injectable, Logger } from '@nestjs/common';
import type {
  MatchStateEvent,
  MatchStateSourceMode,
  TeamScoreState,
} from '../match-control/state.store';
import { isAutomaticMatchStateSourceMode } from '../match-control/state.store';
import type { FightEvent } from '../telemetry/fight-detection.engine';
import type { BroadcastEvent } from '../broadcast/broadcast-event.engine';
import type { StorylineEvent } from '../storyline/storyline.engine';

export type ObserverSuggestion = {
  matchId: string;
  playerId?: string | null;
  playerName?: string | null;
  teamId?: string | null;
  teamName?: string | null;
  teamTag?: string | null;
  reason: string;
  timestamp: number;
};

type ObserverDecisionInput = {
  matchId: string;
  sourceMode?: MatchStateSourceMode | null;
  updatedAt?: string | number | null;
  teams: TeamScoreState[];
  matchEvents: MatchStateEvent[];
  fightEvents: FightEvent[];
  broadcastEvents: BroadcastEvent[];
  storylineEvents: StorylineEvent[];
};

type ObserverMatchState = {
  processedMatchEventIds: Set<string>;
  processedFightKeys: Set<string>;
  processedBroadcastKeys: Set<string>;
  processedStorylineKeys: Set<string>;
};

type ObserverTarget = {
  playerId: string | null;
  playerName: string | null;
  teamId: string | null;
  teamName: string | null;
  teamTag: string | null;
};

@Injectable()
export class ObserverDecisionEngine {
  private readonly logger = new Logger(ObserverDecisionEngine.name);
  private readonly stateByMatch = new Map<string, ObserverMatchState>();
  private readonly maxProcessedIds = 4096;

  processMatch(input: ObserverDecisionInput): ObserverSuggestion[] {
    if (!isAutomaticMatchStateSourceMode(input.sourceMode)) {
      this.stateByMatch.delete(input.matchId);
      return [];
    }

    const matchState =
      this.stateByMatch.get(input.matchId) ?? this.createMatchState();
    this.stateByMatch.set(input.matchId, matchState);

    const suggestions: ObserverSuggestion[] = [];
    const teamsById = new Map(input.teams.map((team) => [team.teamId, team]));
    const fallbackTimestamp = this.toTimestamp(input.updatedAt) ?? Date.now();

    for (const event of [...input.matchEvents].sort((left, right) => {
      if (left.ts !== right.ts) {
        return left.ts - right.ts;
      }
      return left.id.localeCompare(right.id);
    })) {
      if (event.type !== 'PLAYER_KILL') {
        continue;
      }
      if (matchState.processedMatchEventIds.has(event.id)) {
        continue;
      }
      matchState.processedMatchEventIds.add(event.id);
      this.trimSet(matchState.processedMatchEventIds);

      const payload = event.payload ?? {};
      const playerId =
        this.stringValue(payload.killerPlayerId) ??
        this.stringValue(payload.killerId) ??
        event.playerId ??
        null;
      const teamId =
        this.stringValue(payload.killerTeamId) ?? event.teamId ?? null;
      const playerName =
        this.stringValue(payload.killerName) ??
        this.stringValue(payload.killerIgn);
      const timestamp =
        this.numberValue(payload.timestamp) ?? event.ts ?? fallbackTimestamp;
      const target = this.resolveTarget(
        teamsById,
        teamId,
        playerId,
        playerName,
      );
      const suggestion = this.toSuggestion(
        input.matchId,
        target,
        'PLAYER_KILL',
        timestamp,
      );
      if (!suggestion) {
        continue;
      }
      suggestions.push(suggestion);
      this.logSuggestion(suggestion);
    }

    for (const fightEvent of [...input.fightEvents].sort((left, right) => {
      if (left.timestamp !== right.timestamp) {
        return left.timestamp - right.timestamp;
      }
      return left.fightId.localeCompare(right.fightId);
    })) {
      if (fightEvent.type !== 'FIGHT_STARTED') {
        continue;
      }
      const fightKey = `${fightEvent.type}:${fightEvent.fightId}:${fightEvent.timestamp}`;
      if (matchState.processedFightKeys.has(fightKey)) {
        continue;
      }
      matchState.processedFightKeys.add(fightKey);
      this.trimSet(matchState.processedFightKeys);

      const team = this.pickPriorityTeam(fightEvent.teamIds, teamsById);
      const target = this.resolveTarget(
        teamsById,
        team?.teamId ?? null,
        null,
        null,
      );
      const suggestion = this.toSuggestion(
        input.matchId,
        target,
        'FIGHT_STARTED',
        fightEvent.timestamp,
      );
      if (!suggestion) {
        continue;
      }
      suggestions.push(suggestion);
      this.logSuggestion(suggestion);
    }

    for (const broadcastEvent of [...input.broadcastEvents].sort(
      (left, right) => left.timestamp - right.timestamp,
    )) {
      if (broadcastEvent.type !== 'TEAM_WIPE') {
        continue;
      }
      const broadcastKey = `${broadcastEvent.type}:${broadcastEvent.fightId ?? 'none'}:${broadcastEvent.timestamp}`;
      if (matchState.processedBroadcastKeys.has(broadcastKey)) {
        continue;
      }
      matchState.processedBroadcastKeys.add(broadcastKey);
      this.trimSet(matchState.processedBroadcastKeys);

      const preferredTeamIds = broadcastEvent.opponentTeamIds?.length
        ? broadcastEvent.opponentTeamIds
        : broadcastEvent.teamId
          ? [broadcastEvent.teamId]
          : [];
      const team = this.pickPriorityTeam(preferredTeamIds, teamsById);
      const target = this.resolveTarget(
        teamsById,
        team?.teamId ?? null,
        broadcastEvent.playerId ?? null,
        broadcastEvent.playerName ?? null,
      );
      const suggestion = this.toSuggestion(
        input.matchId,
        target,
        'TEAM_WIPE',
        broadcastEvent.timestamp,
      );
      if (!suggestion) {
        continue;
      }
      suggestions.push(suggestion);
      this.logSuggestion(suggestion);
    }

    for (const storylineEvent of [...input.storylineEvents].sort(
      (left, right) => left.timestamp - right.timestamp,
    )) {
      if (storylineEvent.type !== 'FINAL_CIRCLE') {
        continue;
      }
      const storylineKey = `${storylineEvent.type}:${storylineEvent.timestamp}:${storylineEvent.teamIds?.join('|') ?? 'none'}`;
      if (matchState.processedStorylineKeys.has(storylineKey)) {
        continue;
      }
      matchState.processedStorylineKeys.add(storylineKey);
      this.trimSet(matchState.processedStorylineKeys);

      const aliveTeamIds = storylineEvent.teamIds?.length
        ? storylineEvent.teamIds
        : input.teams
            .filter((team) => this.isTeamAlive(team))
            .map((team) => team.teamId);
      const team = this.pickPriorityTeam(aliveTeamIds, teamsById);
      const target = this.resolveTarget(
        teamsById,
        team?.teamId ?? null,
        null,
        null,
      );
      const suggestion = this.toSuggestion(
        input.matchId,
        target,
        'FINAL_CIRCLE',
        storylineEvent.timestamp,
      );
      if (!suggestion) {
        continue;
      }
      suggestions.push(suggestion);
      this.logSuggestion(suggestion);
    }

    return suggestions;
  }

  pruneMatches(activeMatchIds: string[]): void {
    const active = new Set(activeMatchIds);
    for (const matchId of this.stateByMatch.keys()) {
      if (!active.has(matchId)) {
        this.stateByMatch.delete(matchId);
      }
    }
  }

  private createMatchState(): ObserverMatchState {
    return {
      processedMatchEventIds: new Set<string>(),
      processedFightKeys: new Set<string>(),
      processedBroadcastKeys: new Set<string>(),
      processedStorylineKeys: new Set<string>(),
    };
  }

  private resolveTarget(
    teamsById: Map<string, TeamScoreState>,
    teamId: string | null,
    playerId: string | null,
    playerName: string | null,
  ): ObserverTarget | null {
    const team = teamId ? (teamsById.get(teamId) ?? null) : null;
    const player = team ? this.pickPriorityPlayer(team, playerId) : null;
    if (!team && !playerId && !playerName) {
      return null;
    }
    return {
      playerId:
        player?.externalPlayerId ??
        player?.playerId ??
        player?.pubgPlayerId ??
        playerId ??
        null,
      playerName: player?.name ?? player?.ign ?? playerName ?? null,
      teamId: team?.teamId ?? teamId,
      teamName: team?.name ?? null,
      teamTag: team?.tag ?? null,
    };
  }

  private toSuggestion(
    matchId: string,
    target: ObserverTarget | null,
    reason: string,
    timestamp: number,
  ): ObserverSuggestion | null {
    if (!target?.teamId && !target?.playerId) {
      return null;
    }
    return {
      matchId,
      playerId: target.playerId ?? null,
      playerName: target.playerName ?? null,
      teamId: target.teamId ?? null,
      teamName: target.teamName ?? null,
      teamTag: target.teamTag ?? null,
      reason,
      timestamp,
    };
  }

  private pickPriorityTeam(
    teamIds: string[],
    teamsById: Map<string, TeamScoreState>,
  ): TeamScoreState | null {
    return (
      teamIds
        .map((teamId) => teamsById.get(teamId))
        .filter((team): team is TeamScoreState => Boolean(team))
        .sort((left, right) => {
          const leftAlive = this.isTeamAlive(left) ? 1 : 0;
          const rightAlive = this.isTeamAlive(right) ? 1 : 0;
          if (leftAlive !== rightAlive) {
            return rightAlive - leftAlive;
          }
          if ((left.kills ?? 0) !== (right.kills ?? 0)) {
            return (right.kills ?? 0) - (left.kills ?? 0);
          }
          if ((left.alivePlayers ?? 0) !== (right.alivePlayers ?? 0)) {
            return (right.alivePlayers ?? 0) - (left.alivePlayers ?? 0);
          }
          const leftSlot = left.slot ?? Number.MAX_SAFE_INTEGER;
          const rightSlot = right.slot ?? Number.MAX_SAFE_INTEGER;
          if (leftSlot !== rightSlot) {
            return leftSlot - rightSlot;
          }
          return left.teamId.localeCompare(right.teamId);
        })[0] ?? null
    );
  }

  private pickPriorityPlayer(
    team: TeamScoreState,
    preferredPlayerId: string | null,
  ) {
    const players = Array.isArray(team.players) ? [...team.players] : [];
    if (players.length === 0) {
      return null;
    }
    if (preferredPlayerId) {
      const preferred = players.find((player) => {
        return (
          player.externalPlayerId === preferredPlayerId ||
          player.playerId === preferredPlayerId ||
          player.pubgPlayerId === preferredPlayerId
        );
      });
      if (preferred) {
        return preferred;
      }
    }
    return (
      players.sort((left, right) => {
        const leftAlive = left.alive ? 1 : 0;
        const rightAlive = right.alive ? 1 : 0;
        if (leftAlive !== rightAlive) {
          return rightAlive - leftAlive;
        }
        if ((left.kills ?? 0) !== (right.kills ?? 0)) {
          return (right.kills ?? 0) - (left.kills ?? 0);
        }
        return (left.name ?? left.ign ?? left.playerId ?? '').localeCompare(
          right.name ?? right.ign ?? right.playerId ?? '',
        );
      })[0] ?? null
    );
  }

  private isTeamAlive(team: TeamScoreState): boolean {
    if (typeof team.alive === 'boolean') {
      return team.alive;
    }
    if (typeof team.alivePlayers === 'number') {
      return team.alivePlayers > 0;
    }
    return false;
  }

  private logSuggestion(suggestion: ObserverSuggestion): void {
    this.logger.debug(
      `[ObserverEngine] switching focus to player=${suggestion.playerId ?? 'none'} team=${suggestion.teamId ?? 'none'} reason=${suggestion.reason}`,
    );
  }

  private trimSet(values: Set<string>): void {
    while (values.size > this.maxProcessedIds) {
      const next = values.values().next();
      const first = typeof next.value === 'string' ? next.value : null;
      if (!first) {
        break;
      }
      values.delete(first);
    }
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
}
