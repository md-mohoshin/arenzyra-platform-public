import { Injectable, Logger } from '@nestjs/common';
import type {
  MatchStateEvent,
  MatchStatePlayer,
  MatchStateSourceMode,
  TeamScoreState,
} from '../match-control/state.store';
import type { FightEvent } from '../telemetry/fight-detection.engine';

export type ObserverCameraSuggestion = {
  matchId: string;
  teamId: string | null;
  playerId: string | null;
  reason: string;
  priority: number;
};

export type ObserverCameraSuggestionRecord = ObserverCameraSuggestion & {
  key: string;
  timestamp: number;
  reasonCode: SuggestionReasonCode;
};

export type ObserverAiInput = {
  matchId: string;
  sourceMode?: MatchStateSourceMode | null;
  updatedAt?: string | number | null;
  teams: TeamScoreState[];
  fightEvents: FightEvent[];
  killEvents: MatchStateEvent[];
};

type SuggestionReasonCode =
  | 'MULTI_TEAM_FIGHT'
  | 'CLUTCH_SITUATION'
  | 'TEAM_WIPE_IN_PROGRESS';

type CombatWindowEntry = {
  key: string;
  timestamp: number;
  teamIds: string[];
  focusTeamId: string | null;
  focusPlayerId: string | null;
};

type ObserverAiMatchState = {
  recentCombat: CombatWindowEntry[];
  lastAliveCounts: Map<string, number>;
  emittedAtByKey: Map<string, number>;
  suggestions: ObserverCameraSuggestionRecord[];
};

type SuggestionCandidate = {
  key: string;
  timestamp: number;
  reasonCode: SuggestionReasonCode;
  reason: string;
  priority: number;
  teamId: string | null;
  playerId: string | null;
};

@Injectable()
export class ObserverAiService {
  private static readonly stateByMatch = new Map<
    string,
    ObserverAiMatchState
  >();

  private readonly logger = new Logger(ObserverAiService.name);
  private readonly combatWindowMs = 15_000;
  private readonly suggestionCooldownMs = 8_000;
  private readonly suggestionHistoryLimit = 8;
  private readonly suggestionStateLimit = 128;

  processMatch(input: ObserverAiInput): ObserverCameraSuggestionRecord[] {
    if (input.sourceMode !== 'AUTO') {
      ObserverAiService.stateByMatch.delete(input.matchId);
      return [];
    }

    const state = this.getOrCreateState(input.matchId);
    const now = this.toTimestamp(input.updatedAt) ?? Date.now();
    const teamsById = new Map(input.teams.map((team) => [team.teamId, team]));

    this.recordFightEvents(state, input.fightEvents, teamsById);
    this.recordKillEvents(state, input.killEvents);
    this.pruneCombatWindow(state, now);
    this.pruneSuggestionState(state, now);

    const recentCombat = state.recentCombat.filter(
      (entry) => now - entry.timestamp <= this.combatWindowMs,
    );
    const involvementCounts = this.buildInvolvementCounts(recentCombat);
    const aliveTeams = input.teams.filter((team) => this.aliveCount(team) > 0);

    const candidates = [
      this.buildMultiTeamFightCandidate(
        now,
        teamsById,
        recentCombat,
        involvementCounts,
      ),
      this.buildTeamWipeInProgressCandidate(teamsById, input.killEvents),
      this.buildClutchCandidate(
        now,
        input.teams,
        involvementCounts,
        aliveTeams.length,
        state.lastAliveCounts,
      ),
    ]
      .filter((candidate): candidate is SuggestionCandidate =>
        Boolean(candidate),
      )
      .sort((left, right) => {
        if (left.priority !== right.priority) {
          return right.priority - left.priority;
        }
        return right.timestamp - left.timestamp;
      });

    const emitted: ObserverCameraSuggestionRecord[] = [];
    for (const candidate of candidates) {
      const lastEmittedAt = state.emittedAtByKey.get(candidate.key);
      if (
        typeof lastEmittedAt === 'number' &&
        candidate.timestamp - lastEmittedAt < this.suggestionCooldownMs
      ) {
        continue;
      }

      const record: ObserverCameraSuggestionRecord = {
        matchId: input.matchId,
        teamId: candidate.teamId ?? null,
        playerId: candidate.playerId ?? null,
        reason: candidate.reason,
        priority: candidate.priority,
        key: candidate.key,
        timestamp: candidate.timestamp,
        reasonCode: candidate.reasonCode,
      };

      state.emittedAtByKey.set(record.key, record.timestamp);
      state.suggestions = [
        record,
        ...state.suggestions.filter((item) => item.key !== record.key),
      ].slice(0, this.suggestionHistoryLimit);
      emitted.push(record);
      this.logger.debug(
        `[ObserverAI] match=${record.matchId} reason=${record.reasonCode} team=${record.teamId ?? 'none'} player=${record.playerId ?? 'none'} priority=${record.priority}`,
      );
    }

    this.updateAliveCounts(state, input.teams);
    return emitted;
  }

  getSuggestions(matchId: string): ObserverCameraSuggestion[] {
    const state = ObserverAiService.stateByMatch.get(matchId);
    if (!state) {
      return [];
    }
    return state.suggestions.map((item) => this.toPublicSuggestion(item));
  }

  toPublicSuggestion(
    suggestion: ObserverCameraSuggestionRecord,
  ): ObserverCameraSuggestion {
    return {
      matchId: suggestion.matchId,
      teamId: suggestion.teamId ?? null,
      playerId: suggestion.playerId ?? null,
      reason: suggestion.reason,
      priority: suggestion.priority,
    };
  }

  pruneMatches(activeMatchIds: string[]): void {
    const active = new Set(activeMatchIds);
    for (const matchId of ObserverAiService.stateByMatch.keys()) {
      if (!active.has(matchId)) {
        ObserverAiService.stateByMatch.delete(matchId);
      }
    }
  }

  private getOrCreateState(matchId: string): ObserverAiMatchState {
    const existing = ObserverAiService.stateByMatch.get(matchId);
    if (existing) {
      return existing;
    }
    const next: ObserverAiMatchState = {
      recentCombat: [],
      lastAliveCounts: new Map<string, number>(),
      emittedAtByKey: new Map<string, number>(),
      suggestions: [],
    };
    ObserverAiService.stateByMatch.set(matchId, next);
    return next;
  }

  private recordFightEvents(
    state: ObserverAiMatchState,
    fightEvents: FightEvent[],
    teamsById: Map<string, TeamScoreState>,
  ): void {
    for (const fightEvent of fightEvents) {
      if (
        fightEvent.type !== 'FIGHT_STARTED' &&
        fightEvent.type !== 'FIGHT_UPDATED' &&
        fightEvent.type !== 'TEAM_WIPED'
      ) {
        continue;
      }

      const teamIds = [...new Set(fightEvent.teamIds.filter(Boolean))];
      if (teamIds.length === 0) {
        continue;
      }

      const focusTeam = this.pickPriorityTeam(teamIds, teamsById, new Map());
      const focusPlayer = focusTeam ? this.pickPriorityPlayer(focusTeam) : null;

      state.recentCombat.push({
        key: `fight:${fightEvent.fightId}:${fightEvent.type}:${fightEvent.timestamp}`,
        timestamp: fightEvent.timestamp,
        teamIds,
        focusTeamId: focusTeam?.teamId ?? null,
        focusPlayerId: this.playerStableId(focusPlayer),
      });
    }
  }

  private recordKillEvents(
    state: ObserverAiMatchState,
    killEvents: MatchStateEvent[],
  ): void {
    for (const killEvent of killEvents) {
      if (killEvent.type !== 'PLAYER_KILL') {
        continue;
      }

      const payload = killEvent.payload ?? {};
      const killerTeamId =
        this.stringValue(payload.killerTeamId) ?? killEvent.teamId ?? null;
      const victimTeamId = this.stringValue(payload.victimTeamId);
      const teamIds = [killerTeamId, victimTeamId].filter(
        (value): value is string => Boolean(value),
      );
      if (teamIds.length === 0) {
        continue;
      }

      state.recentCombat.push({
        key: `kill:${killEvent.id}`,
        timestamp: this.eventTimestamp(killEvent),
        teamIds: [...new Set(teamIds)],
        focusTeamId: killerTeamId,
        focusPlayerId:
          this.stringValue(payload.killerPlayerId) ??
          this.stringValue(payload.killerId) ??
          killEvent.playerId ??
          null,
      });
    }
  }

  private buildMultiTeamFightCandidate(
    now: number,
    teamsById: Map<string, TeamScoreState>,
    recentCombat: CombatWindowEntry[],
    involvementCounts: Map<string, number>,
  ): SuggestionCandidate | null {
    const involvedTeamIds = [
      ...new Set(recentCombat.flatMap((entry) => entry.teamIds)),
    ];
    if (involvedTeamIds.length < 3) {
      return null;
    }

    const focusTeam = this.pickPriorityTeam(
      involvedTeamIds,
      teamsById,
      involvementCounts,
    );
    if (!focusTeam) {
      return null;
    }

    const preferredPlayerId =
      [...recentCombat]
        .reverse()
        .find((entry) => entry.focusTeamId === focusTeam.teamId)
        ?.focusPlayerId ?? null;
    const focusPlayer = this.pickPriorityPlayer(focusTeam, preferredPlayerId);
    if (!focusPlayer) {
      return null;
    }

    const aliveInvolvedTeams = involvedTeamIds.filter((teamId) => {
      const team = teamsById.get(teamId);
      return team ? this.aliveCount(team) > 0 : false;
    });
    const priorityBoost = Math.min(
      10,
      Math.max(0, aliveInvolvedTeams.length - 3) * 3,
    );

    return {
      key: `MULTI_TEAM_FIGHT:${involvedTeamIds.sort().join('|')}:${focusTeam.teamId}:${this.playerStableId(focusPlayer) ?? 'none'}`,
      timestamp:
        [...recentCombat]
          .map((entry) => entry.timestamp)
          .sort((left, right) => right - left)[0] ?? now,
      reasonCode: 'MULTI_TEAM_FIGHT',
      reason: 'Multi-team fight',
      priority: 100 + priorityBoost,
      teamId: focusTeam.teamId,
      playerId: this.playerStableId(focusPlayer),
    };
  }

  private buildTeamWipeInProgressCandidate(
    teamsById: Map<string, TeamScoreState>,
    killEvents: MatchStateEvent[],
  ): SuggestionCandidate | null {
    const orderedKills = [...killEvents]
      .filter((event) => event.type === 'PLAYER_KILL')
      .sort(
        (left, right) => this.eventTimestamp(right) - this.eventTimestamp(left),
      );

    for (const killEvent of orderedKills) {
      const payload = killEvent.payload ?? {};
      const victimTeamId = this.stringValue(payload.victimTeamId);
      if (!victimTeamId) {
        continue;
      }

      const victimTeam = teamsById.get(victimTeamId);
      if (!victimTeam) {
        continue;
      }

      if (this.aliveCount(victimTeam) !== 1) {
        continue;
      }

      const lastAlive = this.pickPriorityPlayer(victimTeam);
      if (!lastAlive) {
        continue;
      }

      return {
        key: `TEAM_WIPE_IN_PROGRESS:${victimTeamId}:${this.playerStableId(lastAlive) ?? 'none'}`,
        timestamp: this.eventTimestamp(killEvent),
        reasonCode: 'TEAM_WIPE_IN_PROGRESS',
        reason: 'Team wipe in progress',
        priority: 95,
        teamId: victimTeam.teamId,
        playerId: this.playerStableId(lastAlive),
      };
    }
    return null;
  }

  private buildClutchCandidate(
    now: number,
    teams: TeamScoreState[],
    involvementCounts: Map<string, number>,
    aliveTeamCount: number,
    lastAliveCounts: Map<string, number>,
  ): SuggestionCandidate | null {
    if (aliveTeamCount <= 1) {
      return null;
    }

    const clutchTeams = teams
      .filter((team) => this.aliveCount(team) === 1)
      .filter((team) => {
        const previousAliveCount = lastAliveCounts.get(team.teamId);
        return (
          previousAliveCount !== 1 ||
          (involvementCounts.get(team.teamId) ?? 0) > 0
        );
      })
      .sort((left, right) => {
        const leftInvolvement = involvementCounts.get(left.teamId) ?? 0;
        const rightInvolvement = involvementCounts.get(right.teamId) ?? 0;
        if (leftInvolvement !== rightInvolvement) {
          return rightInvolvement - leftInvolvement;
        }
        if ((left.kills ?? 0) !== (right.kills ?? 0)) {
          return (right.kills ?? 0) - (left.kills ?? 0);
        }
        return (
          (left.slot ?? Number.MAX_SAFE_INTEGER) -
          (right.slot ?? Number.MAX_SAFE_INTEGER)
        );
      });

    const clutchTeam = clutchTeams[0] ?? null;
    if (!clutchTeam) {
      return null;
    }

    const clutchPlayer = this.pickPriorityPlayer(clutchTeam);
    if (!clutchPlayer) {
      return null;
    }

    return {
      key: `CLUTCH_SITUATION:${clutchTeam.teamId}:${this.playerStableId(clutchPlayer) ?? 'none'}`,
      timestamp: now,
      reasonCode: 'CLUTCH_SITUATION',
      reason: 'Clutch situation',
      priority: 90 + Math.min(5, involvementCounts.get(clutchTeam.teamId) ?? 0),
      teamId: clutchTeam.teamId,
      playerId: this.playerStableId(clutchPlayer),
    };
  }

  private pickPriorityTeam(
    teamIds: string[],
    teamsById: Map<string, TeamScoreState>,
    involvementCounts: Map<string, number>,
  ): TeamScoreState | null {
    return (
      teamIds
        .map((teamId) => teamsById.get(teamId))
        .filter((team): team is TeamScoreState => Boolean(team))
        .sort((left, right) => {
          const leftInvolvement = involvementCounts.get(left.teamId) ?? 0;
          const rightInvolvement = involvementCounts.get(right.teamId) ?? 0;
          if (leftInvolvement !== rightInvolvement) {
            return rightInvolvement - leftInvolvement;
          }
          if ((left.kills ?? 0) !== (right.kills ?? 0)) {
            return (right.kills ?? 0) - (left.kills ?? 0);
          }
          if (this.aliveCount(left) !== this.aliveCount(right)) {
            return this.aliveCount(right) - this.aliveCount(left);
          }
          return (
            (left.slot ?? Number.MAX_SAFE_INTEGER) -
            (right.slot ?? Number.MAX_SAFE_INTEGER)
          );
        })[0] ?? null
    );
  }

  private pickPriorityPlayer(
    team: TeamScoreState,
    preferredPlayerId?: string | null,
  ): MatchStatePlayer | null {
    const players = Array.isArray(team.players) ? [...team.players] : [];
    if (players.length === 0) {
      return null;
    }

    const normalizedPreferred = this.normalizeValue(preferredPlayerId);
    if (normalizedPreferred) {
      const preferred = players.find((player) => {
        return (
          this.normalizeValue(player.playerId) === normalizedPreferred ||
          this.normalizeValue(player.externalPlayerId) ===
            normalizedPreferred ||
          this.normalizeValue(player.pubgPlayerId) === normalizedPreferred ||
          this.normalizeValue(player.id) === normalizedPreferred
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

  private buildInvolvementCounts(
    recentCombat: CombatWindowEntry[],
  ): Map<string, number> {
    const counts = new Map<string, number>();
    for (const entry of recentCombat) {
      for (const teamId of entry.teamIds) {
        counts.set(teamId, (counts.get(teamId) ?? 0) + 1);
      }
    }
    return counts;
  }

  private pruneCombatWindow(state: ObserverAiMatchState, now: number): void {
    state.recentCombat = state.recentCombat
      .filter((entry) => now - entry.timestamp <= this.combatWindowMs)
      .slice(-this.suggestionStateLimit);
  }

  private pruneSuggestionState(state: ObserverAiMatchState, now: number): void {
    for (const [key, timestamp] of state.emittedAtByKey.entries()) {
      if (now - timestamp > this.combatWindowMs * 4) {
        state.emittedAtByKey.delete(key);
      }
    }
    if (state.suggestions.length > this.suggestionHistoryLimit) {
      state.suggestions = state.suggestions.slice(
        0,
        this.suggestionHistoryLimit,
      );
    }
  }

  private updateAliveCounts(
    state: ObserverAiMatchState,
    teams: TeamScoreState[],
  ): void {
    state.lastAliveCounts = new Map(
      teams.map((team) => [team.teamId, this.aliveCount(team)]),
    );
  }

  private aliveCount(team: TeamScoreState): number {
    if (
      typeof team.alivePlayers === 'number' &&
      Number.isFinite(team.alivePlayers)
    ) {
      return Math.max(0, team.alivePlayers);
    }
    return (team.players ?? []).reduce(
      (count, player) => count + (player.alive ? 1 : 0),
      0,
    );
  }

  private playerStableId(player: MatchStatePlayer | null): string | null {
    if (!player) {
      return null;
    }
    return (
      player.externalPlayerId ??
      player.playerId ??
      player.pubgPlayerId ??
      player.id ??
      null
    );
  }

  private eventTimestamp(event: MatchStateEvent): number {
    const payload = event.payload ?? {};
    return (
      this.toTimestamp(payload.timestamp) ??
      this.toTimestamp(payload.ts) ??
      event.ts ??
      Date.now()
    );
  }

  private stringValue(value: unknown): string | null {
    if (typeof value !== 'string') {
      return null;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private normalizeValue(value: string | null | undefined): string | null {
    if (!value) {
      return null;
    }
    const normalized = value.trim().toLowerCase();
    return normalized.length > 0 ? normalized : null;
  }

  private toTimestamp(value: unknown): number | null {
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
