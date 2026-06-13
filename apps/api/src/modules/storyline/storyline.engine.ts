import { Injectable, Logger } from '@nestjs/common';
import type { ControlStatus } from '../match-control/dto/control.dto';
import type {
  MatchStateEvent,
  MatchStateSourceMode,
  MatchStateSummary,
  TeamScoreState,
} from '../match-control/state.store';
import { isAutomaticMatchStateSourceMode } from '../match-control/state.store';
import type { FightEvent } from '../telemetry/fight-detection.engine';

export type StorylineEventType =
  | 'TEAM_KILL_LEADER'
  | 'PLAYER_HOT_STREAK'
  | 'MAJOR_FIGHT'
  | 'FINAL_CIRCLE'
  | 'UNDERDOG_WIN';

export type StorylineEvent = {
  type: StorylineEventType;
  matchId: string;
  timestamp: number;
  teamId?: string | null;
  teamName?: string | null;
  teamTag?: string | null;
  playerId?: string | null;
  playerName?: string | null;
  teamIds?: string[];
  aliveTeams?: number | null;
  streakCount?: number | null;
  totalKills?: number | null;
  fightId?: string | null;
  durationMs?: number | null;
  slot?: number | null;
};

type KillMarker = {
  eventId: string;
  timestamp: number;
};

type RecentFight = {
  fightId: string;
  teamIds: string[];
  startedAt: number;
  lastEventAt: number;
};

type StorylineMatchState = {
  processedMatchEventIds: Set<string>;
  processedFightKeys: Set<string>;
  killWindowsByPlayer: Map<string, KillMarker[]>;
  hotStreakActivePlayers: Set<string>;
  recentFightsById: Map<string, RecentFight>;
  emittedKeys: Set<string>;
  lastKillLeaderTeamId: string | null;
  finalCircleEmitted: boolean;
};

export type StorylineEngineInput = {
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
export class StorylineEngine {
  private readonly logger = new Logger(StorylineEngine.name);
  private readonly stateByMatch = new Map<string, StorylineMatchState>();
  private readonly hotStreakWindowMs = 20_000;
  private readonly fightClusterWindowMs = 15_000;
  private readonly maxProcessedIds = 4096;

  processMatch(input: StorylineEngineInput): StorylineEvent[] {
    if (!isAutomaticMatchStateSourceMode(input.sourceMode)) {
      this.stateByMatch.delete(input.matchId);
      return [];
    }

    const matchState =
      this.stateByMatch.get(input.matchId) ?? this.createMatchState();
    this.stateByMatch.set(input.matchId, matchState);

    const storylines: StorylineEvent[] = [];
    const teamsById = new Map(input.teams.map((team) => [team.teamId, team]));
    const eventTimestamp = this.toTimestamp(input.updatedAt) ?? Date.now();

    const orderedMatchEvents = [...input.matchEvents].sort((left, right) => {
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
      const timestamp =
        this.numberValue(payload.timestamp) ?? event.ts ?? eventTimestamp;

      if (!killerPlayerId || !killerTeamId) {
        continue;
      }

      const priorWindow =
        matchState.killWindowsByPlayer.get(killerPlayerId) ?? [];
      const killWindow = priorWindow.filter(
        (marker) => timestamp - marker.timestamp <= this.hotStreakWindowMs,
      );
      if (killWindow.length < 3) {
        matchState.hotStreakActivePlayers.delete(killerPlayerId);
      }
      killWindow.push({ eventId: event.id, timestamp });
      matchState.killWindowsByPlayer.set(killerPlayerId, killWindow);

      if (
        killWindow.length >= 3 &&
        !matchState.hotStreakActivePlayers.has(killerPlayerId)
      ) {
        matchState.hotStreakActivePlayers.add(killerPlayerId);
        const team = teamsById.get(killerTeamId);
        storylines.push({
          type: 'PLAYER_HOT_STREAK',
          matchId: input.matchId,
          timestamp,
          teamId: killerTeamId,
          teamName: team?.name ?? null,
          teamTag: team?.tag ?? null,
          playerId: killerPlayerId,
          playerName: killerName,
          streakCount: killWindow.length,
          totalKills: team?.kills ?? null,
        });
        this.logger.debug(
          `[StorylineEngine] hot streak player=${killerPlayerId}`,
        );
      }
    }

    for (const fightEvent of [...input.fightEvents].sort((left, right) => {
      if (left.timestamp !== right.timestamp) {
        return left.timestamp - right.timestamp;
      }
      return left.fightId.localeCompare(right.fightId);
    })) {
      const fightKey = `${fightEvent.type}:${fightEvent.fightId}:${fightEvent.timestamp}`;
      if (matchState.processedFightKeys.has(fightKey)) {
        continue;
      }
      matchState.processedFightKeys.add(fightKey);
      this.trimSet(matchState.processedFightKeys);

      this.updateRecentFight(matchState, fightEvent);
      const cluster = this.buildFightCluster(matchState, fightEvent);
      if (cluster.teamIds.length < 3) {
        continue;
      }

      const bucket = Math.floor(
        fightEvent.timestamp / this.fightClusterWindowMs,
      );
      const dedupeKey = `MAJOR_FIGHT:${cluster.teamIds.join('|')}:${bucket}`;
      if (matchState.emittedKeys.has(dedupeKey)) {
        continue;
      }
      matchState.emittedKeys.add(dedupeKey);

      storylines.push({
        type: 'MAJOR_FIGHT',
        matchId: input.matchId,
        timestamp: fightEvent.timestamp,
        teamIds: cluster.teamIds,
        fightId: fightEvent.fightId,
        durationMs: cluster.durationMs,
      });
      this.logger.debug(
        `[StorylineEngine] major fight teams=${cluster.teamIds.join(',')}`,
      );
    }

    const killLeader = this.resolveKillLeader(input.teams);
    if (killLeader) {
      const dedupeKey = `TEAM_KILL_LEADER:${killLeader.teamId}:${killLeader.kills}`;
      if (
        matchState.lastKillLeaderTeamId !== killLeader.teamId &&
        !matchState.emittedKeys.has(dedupeKey)
      ) {
        matchState.emittedKeys.add(dedupeKey);
        matchState.lastKillLeaderTeamId = killLeader.teamId;
        storylines.push({
          type: 'TEAM_KILL_LEADER',
          matchId: input.matchId,
          timestamp: eventTimestamp,
          teamId: killLeader.teamId,
          teamName: killLeader.name ?? null,
          teamTag: killLeader.tag ?? null,
          totalKills: killLeader.kills,
          slot: killLeader.slot ?? null,
        });
        this.logger.debug(
          `[StorylineEngine] kill leader team=${killLeader.teamId}`,
        );
      } else {
        matchState.lastKillLeaderTeamId = killLeader.teamId;
      }
    } else {
      matchState.lastKillLeaderTeamId = null;
    }

    const aliveTeams =
      input.summary?.aliveTeams ?? this.countAliveTeams(input.teams);
    if (aliveTeams <= 4 && !matchState.finalCircleEmitted) {
      matchState.finalCircleEmitted = true;
      const aliveTeamIds = input.teams
        .filter((team) => this.isTeamAlive(team))
        .map((team) => team.teamId);
      storylines.push({
        type: 'FINAL_CIRCLE',
        matchId: input.matchId,
        timestamp: eventTimestamp,
        teamIds: aliveTeamIds,
        aliveTeams,
      });
      this.logger.debug(
        `[StorylineEngine] final circle teams=${aliveTeamIds.join(',')}`,
      );
    }

    const finished =
      input.finished === true ||
      input.status === 'FINISH_PENDING' ||
      input.status === 'FINISHED';
    const winnerTeam = input.summary?.winnerTeamId
      ? teamsById.get(input.summary.winnerTeamId)
      : (input.teams.find((team) => team.placement === 1) ?? null);
    if (
      finished &&
      winnerTeam &&
      this.isUnderdogWinner(
        winnerTeam,
        input.summary?.totalTeams ?? input.teams.length,
      )
    ) {
      const dedupeKey = `UNDERDOG_WIN:${winnerTeam.teamId}`;
      if (!matchState.emittedKeys.has(dedupeKey)) {
        matchState.emittedKeys.add(dedupeKey);
        storylines.push({
          type: 'UNDERDOG_WIN',
          matchId: input.matchId,
          timestamp: eventTimestamp,
          teamId: winnerTeam.teamId,
          teamName: winnerTeam.name ?? null,
          teamTag: winnerTeam.tag ?? null,
          totalKills: winnerTeam.kills,
          slot: winnerTeam.slot ?? null,
        });
        this.logger.debug(
          `[StorylineEngine] underdog win team=${winnerTeam.teamId}`,
        );
      }
    }

    return storylines;
  }

  pruneMatches(activeMatchIds: string[]): void {
    const active = new Set(activeMatchIds);
    for (const matchId of this.stateByMatch.keys()) {
      if (!active.has(matchId)) {
        this.stateByMatch.delete(matchId);
      }
    }
  }

  private createMatchState(): StorylineMatchState {
    return {
      processedMatchEventIds: new Set<string>(),
      processedFightKeys: new Set<string>(),
      killWindowsByPlayer: new Map<string, KillMarker[]>(),
      hotStreakActivePlayers: new Set<string>(),
      recentFightsById: new Map<string, RecentFight>(),
      emittedKeys: new Set<string>(),
      lastKillLeaderTeamId: null,
      finalCircleEmitted: false,
    };
  }

  private resolveKillLeader(teams: TeamScoreState[]): TeamScoreState | null {
    const maxKills = Math.max(0, ...teams.map((team) => team.kills ?? 0));
    if (maxKills <= 0) {
      return null;
    }
    const leaders = teams.filter((team) => (team.kills ?? 0) === maxKills);
    if (leaders.length !== 1) {
      return null;
    }
    return leaders[0] ?? null;
  }

  private countAliveTeams(teams: TeamScoreState[]): number {
    return teams.filter((team) => this.isTeamAlive(team)).length;
  }

  private isTeamAlive(team: TeamScoreState): boolean {
    if (typeof team.alive === 'boolean') {
      return team.alive;
    }
    if (typeof team.alivePlayers === 'number') {
      return team.alivePlayers > 0;
    }
    return team.placement !== 1;
  }

  private isUnderdogWinner(team: TeamScoreState, totalTeams: number): boolean {
    const slot = team.slot ?? null;
    if (!slot || totalTeams <= 1) {
      return false;
    }
    return slot > Math.ceil(totalTeams / 2);
  }

  private updateRecentFight(
    matchState: StorylineMatchState,
    fightEvent: FightEvent,
  ): void {
    const fight: RecentFight = {
      fightId: fightEvent.fightId,
      teamIds: [...new Set(fightEvent.teamIds)].sort(),
      startedAt: fightEvent.startedAt,
      lastEventAt: fightEvent.lastEventAt,
    };
    matchState.recentFightsById.set(fightEvent.fightId, fight);

    for (const [
      fightId,
      recentFight,
    ] of matchState.recentFightsById.entries()) {
      if (
        fight.lastEventAt - recentFight.lastEventAt >
        this.fightClusterWindowMs
      ) {
        matchState.recentFightsById.delete(fightId);
      }
    }
  }

  private buildFightCluster(
    matchState: StorylineMatchState,
    fightEvent: FightEvent,
  ): { teamIds: string[]; durationMs: number } {
    const current = matchState.recentFightsById.get(fightEvent.fightId);
    if (!current) {
      return { teamIds: [], durationMs: 0 };
    }

    const queue: RecentFight[] = [current];
    const visitedFightIds = new Set<string>();
    const teamIds = new Set<string>();
    let minStartedAt = current.startedAt;
    let maxLastEventAt = current.lastEventAt;

    while (queue.length > 0) {
      const fight = queue.shift();
      if (!fight || visitedFightIds.has(fight.fightId)) {
        continue;
      }
      visitedFightIds.add(fight.fightId);
      fight.teamIds.forEach((teamId) => teamIds.add(teamId));
      minStartedAt = Math.min(minStartedAt, fight.startedAt);
      maxLastEventAt = Math.max(maxLastEventAt, fight.lastEventAt);

      for (const candidate of matchState.recentFightsById.values()) {
        if (visitedFightIds.has(candidate.fightId)) {
          continue;
        }
        if (
          Math.abs(maxLastEventAt - candidate.lastEventAt) >
          this.fightClusterWindowMs
        ) {
          continue;
        }
        if (!candidate.teamIds.some((teamId) => teamIds.has(teamId))) {
          continue;
        }
        queue.push(candidate);
      }
    }

    return {
      teamIds: [...teamIds].sort(),
      durationMs: Math.max(0, maxLastEventAt - minStartedAt),
    };
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
