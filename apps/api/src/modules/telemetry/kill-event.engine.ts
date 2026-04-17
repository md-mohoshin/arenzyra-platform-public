import { Injectable, Logger } from '@nestjs/common';
import type {
  MatchStatePlayer,
  MatchStateSourceMode,
  TeamScoreState,
} from '../match-control/state.store';
import type { TelemetryPlayerKillEvent } from './telemetry.types';

type KillEventEngineInput = {
  consumerKey?: string;
  matchId: string;
  sourceMode?: MatchStateSourceMode | null;
  teams: TeamScoreState[];
  currentTeams?: TeamScoreState[] | null;
  killInfo: unknown;
};

type KillEventEngineResult = {
  teams: TeamScoreState[];
  events: TelemetryPlayerKillEvent[];
};

type NormalizedKillEvent = TelemetryPlayerKillEvent & {
  dedupeKey: string;
};

@Injectable()
export class KillEventEngine {
  private readonly logger = new Logger(KillEventEngine.name);
  private readonly processedKeys = new Map<string, Map<string, number>>();
  private readonly previousSnapshotKeys = new Map<string, Set<string>>();
  private readonly maxProcessedKeys = 4096;
  private readonly maxSnapshotKeys = 2048;

  processKillSnapshot(input: KillEventEngineInput): KillEventEngineResult {
    const scope = this.scopeKey(input.consumerKey ?? 'default', input.matchId);
    const teams = this.mergeTeams(input.currentTeams ?? [], input.teams);
    this.recomputeTrackedTeamKills(teams);

    if (input.sourceMode !== 'AUTO') {
      this.previousSnapshotKeys.delete(scope);
      return { teams: this.sortTeams(teams), events: [] };
    }

    const previousSnapshot = this.previousSnapshotKeys.get(scope) ?? new Set();
    const processed =
      this.processedKeys.get(scope) ?? new Map<string, number>();
    const currentSnapshot = new Set<string>();
    const nextEvents: TelemetryPlayerKillEvent[] = [];

    for (const event of this.normalizeKillEvents(
      input.matchId,
      input.killInfo,
      teams,
    )) {
      if (currentSnapshot.has(event.dedupeKey)) {
        this.logger.debug(
          `[KillEventEngine] duplicate ignored key=${event.dedupeKey}`,
        );
        continue;
      }

      currentSnapshot.add(event.dedupeKey);
      if (previousSnapshot.has(event.dedupeKey)) {
        continue;
      }
      if (processed.has(event.dedupeKey)) {
        this.logger.debug(
          `[KillEventEngine] duplicate ignored key=${event.dedupeKey}`,
        );
        continue;
      }

      processed.set(event.dedupeKey, event.timestamp);
      this.logger.debug(
        `[KillEventEngine] new kill event match=${event.matchId} killer=${event.killerPlayerExternalId} victim=${event.victimPlayerExternalId}`,
      );
      this.applyKillEvent(teams, event);
      nextEvents.push(this.toPublicEvent(event));
    }

    this.previousSnapshotKeys.set(
      scope,
      this.trimSnapshotKeys(currentSnapshot),
    );
    this.processedKeys.set(scope, this.trimProcessedKeys(processed));
    this.recomputeTrackedTeamKills(teams);

    return {
      teams: this.sortTeams(teams),
      events: nextEvents.sort(
        (left, right) => left.timestamp - right.timestamp,
      ),
    };
  }

  pruneConsumerMatches(consumerKey: string, activeMatchIds: string[]): void {
    const activeScopes = new Set(
      activeMatchIds.map((matchId) => this.scopeKey(consumerKey, matchId)),
    );
    for (const key of this.processedKeys.keys()) {
      if (key.startsWith(`${consumerKey}:`) && !activeScopes.has(key)) {
        this.processedKeys.delete(key);
      }
    }
    for (const key of this.previousSnapshotKeys.keys()) {
      if (key.startsWith(`${consumerKey}:`) && !activeScopes.has(key)) {
        this.previousSnapshotKeys.delete(key);
      }
    }
  }

  private scopeKey(consumerKey: string, matchId: string): string {
    return `${consumerKey}:${matchId}`;
  }

  private mergeTeams(
    currentTeams: TeamScoreState[],
    incomingTeams: TeamScoreState[],
  ): TeamScoreState[] {
    const merged = new Map<string, TeamScoreState>();

    for (const team of currentTeams) {
      merged.set(team.teamId, this.cloneTeam(team));
    }

    for (const team of incomingTeams) {
      const existing = merged.get(team.teamId);
      merged.set(team.teamId, {
        ...(existing ?? this.emptyTeam(team.teamId)),
        ...team,
        players:
          team.players && team.players.length > 0
            ? team.players.map((player) => this.clonePlayer(player))
            : (existing?.players ?? []).map((player) =>
                this.clonePlayer(player),
              ),
      });
    }

    return Array.from(merged.values());
  }

  private normalizeKillEvents(
    matchId: string,
    killInfo: unknown,
    teams: TeamScoreState[],
  ): NormalizedKillEvent[] {
    return this.extractKillEntries(killInfo)
      .map((entry) => this.normalizeKillEvent(matchId, entry, teams))
      .filter((event): event is NormalizedKillEvent => Boolean(event));
  }

  private normalizeKillEvent(
    matchId: string,
    entry: unknown,
    teams: TeamScoreState[],
  ): NormalizedKillEvent | null {
    const record = this.toRecord(entry);
    if (!record) {
      return null;
    }

    const killer = this.toRecord(record.killer);
    const victim = this.toRecord(record.victim);

    const killerName =
      this.pickString(
        record.killerName,
        record.KillerName,
        record.killerPlayer,
        this.stringFromUnknown(record.killer),
        killer?.playerName,
        killer?.PlayerName,
        killer?.name,
        killer?.Name,
        killer?.ign,
        killer?.IGN,
      ) ?? null;
    const victimName =
      this.pickString(
        record.victimName,
        record.VictimName,
        this.stringFromUnknown(record.victim),
        victim?.playerName,
        victim?.PlayerName,
        victim?.name,
        victim?.Name,
        victim?.ign,
        victim?.IGN,
      ) ?? null;

    const killerExternalIdRaw = this.pickString(
      record.killerPlayerExternalId,
      record.killerExternalPlayerId,
      record.killerExternalId,
      record.killerPubgPlayerId,
      record.killerPubgId,
      record.killerPlayerId,
      record.killerId,
      record.KillerId,
      killer?.externalPlayerId,
      killer?.pubgPlayerId,
      killer?.playerId,
      killer?.id,
    );
    const victimExternalIdRaw = this.pickString(
      record.victimPlayerExternalId,
      record.victimExternalPlayerId,
      record.victimExternalId,
      record.victimPubgPlayerId,
      record.victimPubgId,
      record.victimPlayerId,
      record.victimId,
      record.VictimId,
      record.targetPlayerId,
      victim?.externalPlayerId,
      victim?.pubgPlayerId,
      victim?.playerId,
      victim?.id,
    );

    const killerTeamId =
      this.pickString(
        record.killerTeamId,
        record.killerTeamID,
        record.KillerTeamId,
        record.killerTeam,
        record.teamId,
        record.teamID,
        killer?.teamId,
        killer?.teamID,
      ) ?? this.resolveTeamIdByPlayer(teams, killerExternalIdRaw, killerName);
    const victimTeamId =
      this.pickString(
        record.victimTeamId,
        record.victimTeamID,
        record.VictimTeamId,
        record.victimTeam,
        record.targetTeamId,
        victim?.teamId,
        victim?.teamID,
      ) ?? this.resolveTeamIdByPlayer(teams, victimExternalIdRaw, victimName);

    const weapon =
      this.pickString(
        record.weapon,
        record.weaponName,
        record.WeaponName,
        record.damageCauserName,
      ) ?? null;

    const identitySeed =
      this.pickString(
        record.killId,
        record.KillId,
        record.eventId,
        record.EventId,
        record.id,
        record.Id,
      ) ??
      [
        killerExternalIdRaw ?? killerName ?? 'unknown-killer',
        victimExternalIdRaw ?? victimName ?? 'unknown-victim',
        killerTeamId ?? 'no-killer-team',
        victimTeamId ?? 'no-victim-team',
        weapon ?? 'no-weapon',
      ].join('|');

    const timestamp =
      this.pickTimestamp(
        record.timestamp,
        record.ts,
        record.time,
        record.eventTime,
        record.killTime,
        record.occurredAt,
        record.createdAt,
      ) ?? this.hashToTimestamp(identitySeed);

    const killerPlayerExternalId = this.toStablePlayerId(
      'killer',
      killerExternalIdRaw,
      killerName,
      identitySeed,
    );
    const victimPlayerExternalId = this.toStablePlayerId(
      'victim',
      victimExternalIdRaw,
      victimName,
      identitySeed,
    );
    const dedupeKey = [
      matchId,
      'PLAYER_KILL',
      killerPlayerExternalId,
      victimPlayerExternalId,
      String(timestamp),
    ].join('|');

    return {
      type: 'PLAYER_KILL',
      matchId,
      killerPlayerExternalId,
      victimPlayerExternalId,
      killerTeamId,
      victimTeamId,
      killerPlayerName: killerName,
      victimPlayerName: victimName,
      weapon,
      timestamp,
      raw: entry,
      dedupeKey,
    };
  }

  private applyKillEvent(
    teams: TeamScoreState[],
    event: NormalizedKillEvent,
  ): void {
    const updatedAt = new Date(event.timestamp).toISOString();
    const killerTeamId =
      event.killerTeamId ??
      this.resolveTeamIdByPlayer(
        teams,
        event.killerPlayerExternalId,
        event.killerPlayerName ?? null,
      );

    if (!killerTeamId) {
      return;
    }

    const killerTeam = teams.find((team) => team.teamId === killerTeamId);
    if (!killerTeam) {
      return;
    }

    killerTeam.players = Array.isArray(killerTeam.players)
      ? killerTeam.players
      : [];

    const killerPlayer = this.findOrCreatePlayer(
      killerTeam.players,
      killerTeamId,
      event.killerPlayerExternalId,
      event.killerPlayerName ?? null,
      updatedAt,
    );

    killerPlayer.kills = Math.max(0, killerPlayer.kills ?? 0) + 1;
    killerPlayer.updatedAt = updatedAt;
    killerPlayer.teamId = killerTeamId;
    if (event.killerPlayerName) {
      killerPlayer.name = event.killerPlayerName;
      killerPlayer.ign = event.killerPlayerName;
    }

    if (event.victimTeamId) {
      const victimTeam = teams.find(
        (team) => team.teamId === event.victimTeamId,
      );
      if (victimTeam) {
        victimTeam.players = Array.isArray(victimTeam.players)
          ? victimTeam.players
          : [];
        this.findOrCreatePlayer(
          victimTeam.players,
          event.victimTeamId,
          event.victimPlayerExternalId,
          event.victimPlayerName ?? null,
          updatedAt,
        );
      }
    }

    const teamKills = this.sumPlayerKills(killerTeam.players);
    killerTeam.kills = Math.max(killerTeam.kills ?? 0, teamKills);
    killerTeam.updatedAt = updatedAt;
    this.logger.debug(
      `[KillEventEngine] team kills recomputed teamId=${killerTeamId} kills=${killerTeam.kills}`,
    );
  }

  private recomputeTrackedTeamKills(teams: TeamScoreState[]): void {
    for (const team of teams) {
      if (!team.players || team.players.length === 0) {
        continue;
      }
      team.kills = Math.max(team.kills ?? 0, this.sumPlayerKills(team.players));
    }
  }

  private sumPlayerKills(players: MatchStatePlayer[] | undefined): number {
    return (players ?? []).reduce(
      (sum, player) => sum + Math.max(0, player.kills ?? 0),
      0,
    );
  }

  private findOrCreatePlayer(
    players: MatchStatePlayer[],
    teamId: string,
    externalPlayerId: string,
    playerName: string | null,
    updatedAt: string,
  ): MatchStatePlayer {
    const existing = players.find((player) =>
      this.playerMatches(player, externalPlayerId, playerName),
    );
    if (existing) {
      if (!existing.externalPlayerId) {
        existing.externalPlayerId = externalPlayerId;
      }
      if (playerName) {
        existing.name = playerName;
        existing.ign = playerName;
      }
      existing.teamId = teamId;
      existing.updatedAt = updatedAt;
      return existing;
    }

    const next: MatchStatePlayer = {
      externalPlayerId,
      name: playerName,
      ign: playerName,
      teamId,
      alive: true,
      knocked: false,
      kills: 0,
      updatedAt,
    };
    players.push(next);
    return next;
  }

  private resolveTeamIdByPlayer(
    teams: TeamScoreState[],
    externalPlayerId: string | null,
    playerName: string | null,
  ): string | null {
    for (const team of teams) {
      for (const player of team.players ?? []) {
        if (this.playerMatches(player, externalPlayerId, playerName)) {
          return team.teamId;
        }
      }
    }
    return null;
  }

  private playerMatches(
    player: MatchStatePlayer,
    externalPlayerId: string | null,
    playerName: string | null,
  ): boolean {
    const normalizedExternal = this.normalizeValue(externalPlayerId);
    const normalizedName = this.normalizeValue(playerName);

    if (normalizedExternal) {
      const candidateIds = [
        player.externalPlayerId,
        player.pubgPlayerId,
        player.playerId,
        player.id,
      ]
        .map((value) => this.normalizeValue(value))
        .filter((value): value is string => Boolean(value));
      if (candidateIds.includes(normalizedExternal)) {
        return true;
      }
    }

    if (!normalizedName) {
      return false;
    }

    const candidateNames = [player.name, player.ign]
      .map((value) => this.normalizeValue(value))
      .filter((value): value is string => Boolean(value));
    return candidateNames.includes(normalizedName);
  }

  private extractKillEntries(payload: unknown): unknown[] {
    if (!payload) {
      return [];
    }
    if (Array.isArray(payload)) {
      return payload;
    }
    if (typeof payload !== 'object') {
      return [];
    }

    const record = payload as Record<string, unknown>;
    const candidates = [
      record.KillList,
      record.killList,
      record.kills,
      record.data,
    ];

    for (const candidate of candidates) {
      if (Array.isArray(candidate)) {
        return candidate;
      }
    }

    return [];
  }

  private toPublicEvent(event: NormalizedKillEvent): TelemetryPlayerKillEvent {
    return {
      type: event.type,
      matchId: event.matchId,
      killerPlayerExternalId: event.killerPlayerExternalId,
      victimPlayerExternalId: event.victimPlayerExternalId,
      killerTeamId: event.killerTeamId,
      victimTeamId: event.victimTeamId,
      killerPlayerName: event.killerPlayerName,
      victimPlayerName: event.victimPlayerName,
      weapon: event.weapon,
      timestamp: event.timestamp,
      raw: event.raw,
    };
  }

  private cloneTeam(team: TeamScoreState): TeamScoreState {
    return {
      ...team,
      players: (team.players ?? []).map((player) => this.clonePlayer(player)),
    };
  }

  private clonePlayer(player: MatchStatePlayer): MatchStatePlayer {
    return { ...player };
  }

  private emptyTeam(teamId: string): TeamScoreState {
    return {
      teamId,
      name: null,
      tag: null,
      slot: null,
      kills: 0,
      placement: null,
      points: null,
      logoUrl: null,
      players: [],
    };
  }

  private sortTeams(teams: TeamScoreState[]): TeamScoreState[] {
    return [...teams].sort((left, right) => {
      const slotDelta =
        (left.slot ?? Number.MAX_SAFE_INTEGER) -
        (right.slot ?? Number.MAX_SAFE_INTEGER);
      if (slotDelta !== 0) {
        return slotDelta;
      }
      return (left.name ?? left.teamId).localeCompare(
        right.name ?? right.teamId,
      );
    });
  }

  private trimSnapshotKeys(keys: Set<string>): Set<string> {
    const values = Array.from(keys);
    if (values.length <= this.maxSnapshotKeys) {
      return keys;
    }
    return new Set(values.slice(-this.maxSnapshotKeys));
  }

  private trimProcessedKeys(keys: Map<string, number>): Map<string, number> {
    while (keys.size > this.maxProcessedKeys) {
      const first = keys.keys().next().value as string | undefined;
      if (!first) {
        break;
      }
      keys.delete(first);
    }
    return keys;
  }

  private toStablePlayerId(
    role: 'killer' | 'victim',
    externalPlayerId: string | null,
    playerName: string | null,
    identitySeed: string,
  ): string {
    if (externalPlayerId) {
      return externalPlayerId;
    }
    if (playerName) {
      return `name:${this.normalizeValue(playerName)}`;
    }
    return `${role}:${this.hashString(identitySeed)}`;
  }

  private hashToTimestamp(seed: string): number {
    return Math.abs(this.hashNumber(seed));
  }

  private hashString(seed: string): string {
    return Math.abs(this.hashNumber(seed)).toString(36);
  }

  private hashNumber(seed: string): number {
    let hash = 0;
    for (let index = 0; index < seed.length; index += 1) {
      hash = (hash * 31 + seed.charCodeAt(index)) | 0;
    }
    return hash;
  }

  private pickTimestamp(...values: unknown[]): number | null {
    for (const value of values) {
      if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
      }
      if (typeof value === 'string') {
        const asNumber = Number(value);
        if (Number.isFinite(asNumber)) {
          return asNumber;
        }
        const asDate = Date.parse(value);
        if (Number.isFinite(asDate)) {
          return asDate;
        }
      }
    }
    return null;
  }

  private pickString(...values: unknown[]): string | null {
    for (const value of values) {
      const next = this.stringFromUnknown(value);
      if (next) {
        return next;
      }
    }
    return null;
  }

  private stringFromUnknown(value: unknown): string | null {
    if (typeof value === 'string') {
      const normalized = value.trim();
      return normalized.length > 0 ? normalized : null;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
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
}
