import { ConflictException, Injectable, Logger } from '@nestjs/common';
import {
  MatchControlStateStore,
  type LiveMatchState,
  type MatchStatePlayer,
  isAutomaticMatchStateSourceMode,
  toCanonicalMatchStateSourceMode,
} from './state.store';

const TERMINAL_STATUSES = new Set<LiveMatchState['status']>([
  'FINISH_PENDING',
  'FINISHED',
]);

type CanonicalRoster = {
  teams: LiveMatchState['teams'];
  summary: LiveMatchState['summary'] | null;
  lockedAt: number;
};

type LiveStateMirrorWriter =
  | 'telemetry-engine'
  | 'results-service'
  | 'match-control'
  | 'unknown';

type PublishOptions = {
  writer?: LiveStateMirrorWriter;
};

const countTeamPlayerRows = (
  team: LiveMatchState['teams'][number] | null | undefined,
): number => (Array.isArray(team?.players) ? team.players.length : 0);

const countTeamPlayers = (
  team: LiveMatchState['teams'][number] | null | undefined,
): number => {
  if (
    typeof team?.totalPlayers === 'number' &&
    Number.isFinite(team.totalPlayers)
  ) {
    return Math.max(0, Math.floor(team.totalPlayers));
  }
  return countTeamPlayerRows(team);
};

const countTeamAlivePlayers = (
  team: LiveMatchState['teams'][number] | null | undefined,
): number => {
  if (
    typeof team?.alivePlayers === 'number' &&
    Number.isFinite(team.alivePlayers)
  ) {
    return Math.max(0, Math.floor(team.alivePlayers));
  }
  if (Array.isArray(team?.players) && team.players.length > 0) {
    return team.players.filter((player) => player.alive === true).length;
  }
  if (team?.alive === true) {
    return 1;
  }
  return 0;
};

const countTeamAlivePlayersWithRosterFallback = (
  team: LiveMatchState['teams'][number] | null | undefined,
): number => {
  const totalPlayers = countTeamPlayers(team);
  const playerRows = countTeamPlayerRows(team);
  const hasPartialRoster =
    totalPlayers > 0 && playerRows >= 0 && playerRows < totalPlayers;

  if (hasPartialRoster && team?.placement == null) {
    return totalPlayers;
  }

  const alivePlayers = countTeamAlivePlayers(team);
  if (alivePlayers > 0) {
    return alivePlayers;
  }
  if (team?.eliminated === true || team?.alive === false) {
    return 0;
  }
  return totalPlayers;
};

const countStatePlayerRows = (
  state: LiveMatchState | null | undefined,
): number =>
  Array.isArray(state?.teams)
    ? state.teams.reduce((sum, team) => sum + countTeamPlayerRows(team), 0)
    : 0;

const countStatePlayers = (state: LiveMatchState | null | undefined): number =>
  Array.isArray(state?.teams)
    ? state.teams.reduce((sum, team) => sum + countTeamPlayers(team), 0)
    : 0;

const isTeamPartialAgainstRoster = (
  incoming: LiveMatchState['teams'][number],
  previous: LiveMatchState['teams'][number],
): boolean => {
  const previousTotal = countTeamPlayers(previous);
  const incomingTotal = countTeamPlayers(incoming);
  const previousRows = countTeamPlayerRows(previous);
  const incomingRows = countTeamPlayerRows(incoming);

  return (
    (previousTotal > 0 && incomingTotal < previousTotal) ||
    (previousRows > 0 && incomingRows < previousRows) ||
    (previousTotal > 0 && incomingRows > 0 && incomingRows < previousTotal)
  );
};

const preserveAliveBaseline = (
  team: LiveMatchState['teams'][number],
): LiveMatchState['teams'][number] => {
  const alivePlayers = countTeamAlivePlayersWithRosterFallback(team);
  const totalPlayers = Math.max(countTeamPlayers(team), alivePlayers);

  return {
    ...team,
    totalPlayers,
    alivePlayers,
    alive: alivePlayers > 0,
    eliminated: alivePlayers <= 0,
  };
};

const summarizeState = (
  state: Pick<LiveMatchState, 'status' | 'teams' | 'summary' | 'circle'> | null,
) => {
  if (!state) {
    return null;
  }
  return {
    status: state.status,
    teams: state.teams.length,
    playerRows: countStatePlayerRows(state as LiveMatchState),
    totalPlayers: countStatePlayers(state as LiveMatchState),
    alivePlayers:
      Array.isArray(state.teams) && state.teams.length > 0
        ? state.teams.reduce(
            (sum, team) => sum + countTeamAlivePlayers(team),
            0,
          )
        : (state.summary?.alivePlayers ?? 0),
    aliveTeams:
      Array.isArray(state.teams) && state.teams.length > 0
        ? state.teams.reduce(
            (sum, team) => (countTeamAlivePlayers(team) > 0 ? sum + 1 : sum),
            0,
          )
        : (state.summary?.aliveTeams ?? 0),
    phase: state.circle?.phase ?? null,
  };
};

const cloneLiveState = <T>(value: T): T =>
  JSON.parse(JSON.stringify(value ?? null)) as T;

type LiveStateTeamState = LiveMatchState['teams'][number];

const hasUtilitySnapshot = (
  value: LiveStateTeamState['backpack'] | null | undefined,
): boolean => value !== null && value !== undefined;

const buildTeamUtilityLookup = (
  teams: LiveMatchState['teams'] | null | undefined,
): {
  byTeamId: Map<string, LiveStateTeamState>;
  bySlot: Map<number, LiveStateTeamState>;
} => {
  const byTeamId = new Map<string, LiveStateTeamState>();
  const bySlot = new Map<number, LiveStateTeamState>();

  for (const team of teams ?? []) {
    if (team.teamId) {
      byTeamId.set(team.teamId, team);
    }
    if (typeof team.slot === 'number' && Number.isFinite(team.slot)) {
      bySlot.set(Math.trunc(team.slot), team);
    }
  }

  return { byTeamId, bySlot };
};

const resolveUtilityFallbackTeam = (
  team: LiveStateTeamState,
  lookup: ReturnType<typeof buildTeamUtilityLookup>,
): LiveStateTeamState | null =>
  (team.teamId ? (lookup.byTeamId.get(team.teamId) ?? null) : null) ??
  (typeof team.slot === 'number' && Number.isFinite(team.slot)
    ? (lookup.bySlot.get(Math.trunc(team.slot)) ?? null)
    : null);

const mergeTeamUtilitySnapshots = (
  incoming: LiveStateTeamState,
  fallback: LiveStateTeamState | null,
): LiveStateTeamState => {
  const backpack = hasUtilitySnapshot(incoming.backpack)
    ? incoming.backpack
    : (fallback?.backpack ?? null);
  const equipment = hasUtilitySnapshot(incoming.equipment)
    ? incoming.equipment
    : hasUtilitySnapshot(incoming.backpack)
      ? incoming.backpack
      : (fallback?.equipment ?? fallback?.backpack ?? null);

  return {
    ...incoming,
    backpack: backpack ?? null,
    equipment: equipment ?? backpack ?? null,
  };
};

const canonicalizeSourceMode = (
  value: string | null | undefined,
): LiveMatchState['sourceMode'] | undefined =>
  toCanonicalMatchStateSourceMode(value) ?? undefined;

const canonicalizeLiveStateSourceModes = (
  state: LiveMatchState,
): LiveMatchState => {
  const sourceMode = canonicalizeSourceMode(state.sourceMode);
  const teams = state.teams.map((team) => ({
    ...team,
    sourceMode: canonicalizeSourceMode(team.sourceMode ?? sourceMode),
  }));

  return {
    ...state,
    sourceMode,
    teams,
  };
};

const normalizeLookup = (value: unknown): string =>
  typeof value === 'string' ? value.trim().toLowerCase() : '';

const playerIdentity = (player: MatchStatePlayer): string | null =>
  player.playerId ??
  player.id ??
  player.externalPlayerId ??
  player.pubgPlayerId ??
  (player.teamId && normalizeLookup(player.name ?? player.ign)
    ? `team:${player.teamId}:name:${normalizeLookup(player.name ?? player.ign)}`
    : null);

const isEarlyAirPhase = (state: Pick<LiveMatchState, 'circle'>): boolean => {
  const phase =
    typeof state.circle?.phase === 'number' &&
    Number.isFinite(state.circle.phase)
      ? Math.trunc(state.circle.phase)
      : null;
  return phase !== null && phase < 2;
};

@Injectable()
export class LiveStateMirrorService {
  private readonly logger = new Logger(LiveStateMirrorService.name);
  private readonly canonicalRosters = new Map<string, CanonicalRoster>();

  constructor(private readonly stateStore: MatchControlStateStore) {}

  lockCanonicalRoster(matchId: string, state: LiveMatchState): void {
    const roster = this.extractCanonicalRoster(state);
    this.canonicalRosters.set(matchId, roster);
    this.logger.log(
      JSON.stringify({
        tag: '[TELEMETRY][MERGE]',
        stage: 'live-state-mirror',
        action: 'canonical-roster-locked',
        matchId,
        teams: roster.teams.length,
        players: roster.teams.reduce(
          (sum, team) => sum + countTeamPlayerRows(team),
          0,
        ),
      }),
    );
  }

  async publish(
    state: LiveMatchState,
    options: PublishOptions = {},
  ): Promise<LiveMatchState> {
    const writer = options.writer ?? 'unknown';
    const sanitized = this.sanitizeIncomingState(state, writer);
    this.assertCanonicalPlayerWriter(sanitized.state, writer);
    const baseVersion = typeof state.version === 'number' ? state.version : 0;
    const telemetryRuntimeState = this.isTelemetryRuntimeState(sanitized.state);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const current = await this.stateStore.get(sanitized.state.matchId);
      const protectedRuntime = this.protectActiveTelemetryRuntime(
        current,
        sanitized.state,
        writer,
      );
      if (
        !telemetryRuntimeState &&
        sanitized.state.status === 'LIVE' &&
        !this.canonicalRosters.has(sanitized.state.matchId)
      ) {
        this.lockCanonicalRoster(sanitized.state.matchId, sanitized.state);
      }
      const merged =
        protectedRuntime ??
        this.mergeState(
          current,
          sanitized.state,
          telemetryRuntimeState,
          writer,
        );
      const currentVersion =
        typeof current?.version === 'number' ? current.version : null;
      const nextVersion =
        currentVersion === null
          ? Math.max(baseVersion, 0)
          : Math.max(baseVersion, currentVersion + 1);

      const nextState = canonicalizeLiveStateSourceModes({
        ...merged.state,
        version: nextVersion,
      });

      this.logger.debug(
        JSON.stringify({
          tag: '[telemetry][state-before]',
          matchId: sanitized.state.matchId,
          current: summarizeState(current),
          incoming: summarizeState(sanitized.state),
        }),
      );
      if (
        current &&
        (current.status !== nextState.status ||
          (current.circle?.phase ?? null) !== (nextState.circle?.phase ?? null))
      ) {
        this.logger.log(
          JSON.stringify({
            tag: '[telemetry][phase-transition]',
            matchId: sanitized.state.matchId,
            from: {
              status: current.status,
              phase: current.circle?.phase ?? null,
            },
            to: {
              status: nextState.status,
              phase: nextState.circle?.phase ?? null,
            },
            rosterPreserved: merged.rosterPreserved,
          }),
        );
      }
      this.logger.debug(
        JSON.stringify({
          tag: '[telemetry][state-after]',
          matchId: sanitized.state.matchId,
          next: summarizeState(nextState),
          rosterPreserved: merged.rosterPreserved,
        }),
      );
      this.logger.debug(
        JSON.stringify({
          tag: '[TELEMETRY][MERGE]',
          stage: 'live-state-mirror',
          action: telemetryRuntimeState
            ? writer === 'telemetry-engine'
              ? 'telemetry-runtime-publish'
              : 'canonical-roster-runtime-merge'
            : 'control-state-publish',
          matchId: sanitized.state.matchId,
          writer,
          rosterPreserved: merged.rosterPreserved,
          canonicalRosterLocked: this.canonicalRosters.has(state.matchId),
        }),
      );

      try {
        const saved = await this.stateStore.save(
          sanitized.state.matchId,
          nextState,
          currentVersion ?? undefined,
        );
        this.logger.log(
          JSON.stringify({
            tag: '[TICK PUBLISHED]',
            stage: 'live-state-mirror',
            action: 'mirror-state-saved',
            matchId: sanitized.state.matchId,
            writer,
            version: saved.version,
            status: saved.status,
            teams: saved.teams.length,
            players: countStatePlayerRows(saved),
            aliveTeams: saved.summary?.aliveTeams ?? 0,
            alivePlayers: saved.summary?.alivePlayers ?? 0,
            rosterPreserved: merged.rosterPreserved,
            attempt: attempt + 1,
          }),
        );
        this.logger.log(
          JSON.stringify({
            tag: '[PIPELINE][MIRROR PUBLISHED]',
            stage: 'live-state-mirror',
            matchId: sanitized.state.matchId,
            writer,
            version: saved.version,
            status: saved.status,
            sourceMode: saved.sourceMode ?? null,
            teams: saved.teams.length,
            players: countStatePlayerRows(saved),
            aliveTeams: saved.summary?.aliveTeams ?? null,
            alivePlayers: saved.summary?.alivePlayers ?? null,
            rosterPreserved: merged.rosterPreserved,
            attempt: attempt + 1,
          }),
        );
        return saved;
      } catch (error) {
        if (error instanceof ConflictException) {
          this.logger.warn(
            JSON.stringify({
              tag: '[TELEMETRY][BLOCKED]',
              stage: 'live-state-mirror',
              action: 'mirror-save-conflict-retrying',
              matchId: sanitized.state.matchId,
              writer,
              attempt: attempt + 1,
              remainingAttempts: Math.max(2 - attempt, 0),
            }),
          );
        }
        if (!(error instanceof ConflictException) || attempt === 2) {
          const message =
            error instanceof Error ? error.message : String(error);
          this.logger.warn(
            JSON.stringify({
              tag: '[TELEMETRY][BLOCKED]',
              stage: 'live-state-mirror',
              action: 'mirror-save-failed',
              matchId: sanitized.state.matchId,
              writer,
              attempt: attempt + 1,
              message,
            }),
          );
          throw error;
        }
      }
    }

    this.logger.warn(
      JSON.stringify({
        tag: '[TELEMETRY][BLOCKED]',
        stage: 'live-state-mirror',
        action: 'mirror-publish-conflict-exhausted',
        matchId: sanitized.state.matchId,
        writer,
      }),
    );
    throw new ConflictException('Failed to publish live match state');
  }

  private sanitizeIncomingState(
    state: LiveMatchState,
    writer: LiveStateMirrorWriter,
  ): {
    state: LiveMatchState;
    teamsBefore: number;
    teamsAfter: number;
    playersBefore: number;
    playersAfter: number;
  } {
    const canonicalState = canonicalizeLiveStateSourceModes(state);
    const teamsBefore = canonicalState.teams.length;
    const playersBefore = countStatePlayerRows(canonicalState);
    const teamsById = new Map<string, LiveMatchState['teams'][number]>();

    for (const team of canonicalState.teams) {
      const existing = teamsById.get(team.teamId) ?? null;
      if (!existing) {
        teamsById.set(team.teamId, team);
        continue;
      }

      this.logger.warn(
        JSON.stringify({
          tag: '[TELEMETRY][DUPLICATE PLAYER DETECTED]',
          stage: 'live-state-mirror',
          action: 'duplicate-team-dropped',
          matchId: canonicalState.matchId,
          writer,
          teamId: team.teamId,
        }),
      );
      teamsById.set(team.teamId, {
        ...existing,
        ...team,
        kills: Math.max(existing.kills ?? 0, team.kills ?? 0),
        totalPlayers: Math.max(
          countTeamPlayers(existing),
          countTeamPlayers(team),
        ),
        alivePlayers: Math.max(
          countTeamAlivePlayers(existing),
          countTeamAlivePlayers(team),
        ),
        players: [...(existing.players ?? []), ...(team.players ?? [])],
      });
    }

    const teams = Array.from(teamsById.values()).map((team) =>
      this.dedupeTeamPlayers(canonicalState.matchId, writer, team),
    );
    const teamsAfter = teams.length;
    const playersAfter = teams.reduce(
      (count, team) => count + countTeamPlayerRows(team),
      0,
    );

    this.logger.debug(
      JSON.stringify({
        tag: '[TELEMETRY][MERGE COUNT BEFORE/AFTER]',
        stage: 'live-state-mirror',
        action: 'sanitize-incoming-state',
        matchId: canonicalState.matchId,
        writer,
        teamsBefore,
        teamsAfter,
        playersBefore,
        playersAfter,
      }),
    );

    if (teamsBefore === teamsAfter && playersBefore === playersAfter) {
      return {
        state: canonicalState,
        teamsBefore,
        teamsAfter,
        playersBefore,
        playersAfter,
      };
    }

    const aliveTeams = teams.reduce(
      (count, team) => (countTeamAlivePlayers(team) > 0 ? count + 1 : count),
      0,
    );
    const totalPlayers = teams.reduce(
      (count, team) => count + countTeamPlayers(team),
      0,
    );
    const alivePlayers = teams.reduce(
      (count, team) => count + countTeamAlivePlayers(team),
      0,
    );
    const winner =
      teams.find((team) => team.placement === 1) ??
      (aliveTeams === 1
        ? (teams.find((team) => countTeamAlivePlayers(team) > 0) ?? null)
        : null);

    return {
      state: {
        ...canonicalState,
        teams,
        summary: {
          totalTeams: teams.length,
          aliveTeams,
          totalPlayers,
          alivePlayers,
          winnerTeamId: winner?.teamId ?? null,
          winnerSlot: winner?.slot ?? null,
        },
      },
      teamsBefore,
      teamsAfter,
      playersBefore,
      playersAfter,
    };
  }

  private logPlayerWrite(params: {
    source: 'mirror' | 'adapter' | 'derived' | 'results';
    action: string;
    matchId: string;
    teamId: string | null;
    playerId: string | null;
    phase: number | null;
    timestamp: string | null;
    alive: boolean | null;
    eliminated: boolean | null;
    blocked?: boolean;
    reason?: string | null;
    metadata?: Record<string, unknown>;
  }): void {
    this.logger.debug(
      JSON.stringify({
        tag: '[PLAYER WRITE]',
        stage: 'live-state-mirror',
        source: params.source,
        action: params.action,
        matchId: params.matchId,
        teamId: params.teamId,
        playerId: params.playerId,
        phase: params.phase,
        timestamp: params.timestamp,
        alive: params.alive,
        eliminated: params.eliminated,
        blocked: params.blocked ?? false,
        reason: params.reason ?? null,
        ...(params.metadata ?? {}),
      }),
    );
  }

  private logCriticalPlayerStateConflict(params: {
    matchId: string;
    teamId: string | null;
    playerId: string | null;
    phase: number | null;
    timestamp: string | null;
    field: 'alive' | 'eliminated';
    previousValue: boolean | null;
    incomingValue: boolean | null;
    resolvedValue: boolean | null;
    writer: LiveStateMirrorWriter;
  }): void {
    this.logger.error(
      JSON.stringify({
        tag: '[CRITICAL][PLAYER STATE CONFLICT]',
        stage: 'live-state-mirror',
        source: 'mirror',
        action: 'duplicate-team-player-conflict',
        matchId: params.matchId,
        teamId: params.teamId,
        playerId: params.playerId,
        phase: params.phase,
        timestamp: params.timestamp,
        field: params.field,
        previousValue: params.previousValue,
        incomingValue: params.incomingValue,
        resolvedValue: params.resolvedValue,
        writer: params.writer,
        reason: 'DUPLICATE_TEAM_PLAYER_CONFLICTING_LIFE_FIELDS',
      }),
    );
  }

  private mergeDuplicateTeamPlayer(
    matchId: string,
    writer: LiveStateMirrorWriter,
    team: LiveMatchState['teams'][number],
    existing: MatchStatePlayer,
    incoming: MatchStatePlayer,
  ): MatchStatePlayer {
    const mergedAlive =
      existing.alive === incoming.alive
        ? existing.alive
        : existing.alive === true || incoming.alive === true;
    if (existing.alive !== incoming.alive) {
      this.logCriticalPlayerStateConflict({
        matchId,
        teamId: team.teamId,
        playerId:
          playerIdentity(existing) ??
          playerIdentity(incoming) ??
          existing.playerId ??
          incoming.playerId ??
          null,
        phase: null,
        timestamp: team.updatedAt ?? null,
        field: 'alive',
        previousValue: existing.alive,
        incomingValue: incoming.alive,
        resolvedValue: mergedAlive,
        writer,
      });
    }
    const existingEliminated =
      typeof existing.eliminated === 'boolean'
        ? existing.eliminated
        : existing.alive === false;
    const incomingEliminated =
      typeof incoming.eliminated === 'boolean'
        ? incoming.eliminated
        : incoming.alive === false;
    const mergedEliminated =
      mergedAlive === true ? false : existingEliminated && incomingEliminated;
    if (existingEliminated !== incomingEliminated) {
      this.logCriticalPlayerStateConflict({
        matchId,
        teamId: team.teamId,
        playerId:
          playerIdentity(existing) ??
          playerIdentity(incoming) ??
          existing.playerId ??
          incoming.playerId ??
          null,
        phase: null,
        timestamp: team.updatedAt ?? null,
        field: 'eliminated',
        previousValue: existingEliminated,
        incomingValue: incomingEliminated,
        resolvedValue: mergedEliminated,
        writer,
      });
    }
    this.logPlayerWrite({
      source: 'mirror',
      action: 'duplicate-team-player-merged',
      matchId,
      teamId: team.teamId,
      playerId:
        playerIdentity(existing) ??
        playerIdentity(incoming) ??
        existing.playerId ??
        incoming.playerId ??
        null,
      phase: null,
      timestamp: team.updatedAt ?? null,
      alive: mergedAlive,
      eliminated: mergedEliminated,
      metadata: {
        writer,
      },
    });

    return {
      ...existing,
      ...incoming,
      id: existing.id ?? incoming.id ?? null,
      playerId:
        existing.playerId ??
        incoming.playerId ??
        existing.id ??
        incoming.id ??
        null,
      externalPlayerId:
        existing.externalPlayerId ?? incoming.externalPlayerId ?? null,
      pubgPlayerId: existing.pubgPlayerId ?? incoming.pubgPlayerId ?? null,
      name: incoming.name ?? existing.name ?? null,
      ign: incoming.ign ?? existing.ign ?? null,
      avatarUrl: incoming.avatarUrl ?? existing.avatarUrl ?? null,
      teamId: existing.teamId ?? incoming.teamId ?? team.teamId,
      slot: existing.slot ?? incoming.slot ?? team.slot ?? null,
      alive: mergedAlive,
      knocked:
        mergedAlive === false ? false : existing.knocked || incoming.knocked,
      eliminated: mergedEliminated,
      health: incoming.health ?? existing.health ?? null,
      kills: Math.max(existing.kills ?? 0, incoming.kills ?? 0),
      position: incoming.position ?? existing.position ?? null,
      updatedAt: incoming.updatedAt ?? existing.updatedAt ?? null,
      lifeTelemetryFresh:
        existing.lifeTelemetryFresh === true ||
        incoming.lifeTelemetryFresh === true,
      ownership: existing.ownership ?? incoming.ownership,
    };
  }

  private dedupeTeamPlayers(
    matchId: string,
    writer: LiveStateMirrorWriter,
    team: LiveMatchState['teams'][number],
  ): LiveMatchState['teams'][number] {
    const players = Array.isArray(team.players) ? team.players : [];
    const dedupedPlayers = new Map<string, MatchStatePlayer>();
    let droppedPlayers = 0;

    for (const player of players) {
      const key = playerIdentity(player);
      if (!key) {
        dedupedPlayers.set(`anonymous:${dedupedPlayers.size}`, player);
        continue;
      }

      if (dedupedPlayers.has(key)) {
        droppedPlayers += 1;
        dedupedPlayers.set(
          key,
          this.mergeDuplicateTeamPlayer(
            matchId,
            writer,
            team,
            dedupedPlayers.get(key)!,
            player,
          ),
        );
        continue;
      }

      dedupedPlayers.set(key, player);
    }

    if (droppedPlayers === 0) {
      return team;
    }

    const nextPlayers = Array.from(dedupedPlayers.values());
    const originalAliveRows = players.filter(
      (player) => player.alive === true,
    ).length;
    const dedupedAliveRows = nextPlayers.filter(
      (player) => player.alive === true,
    ).length;
    const explicitTotalPlayers =
      typeof team.totalPlayers === 'number' &&
      Number.isFinite(team.totalPlayers)
        ? Math.max(0, Math.floor(team.totalPlayers))
        : null;
    const explicitAlivePlayers =
      typeof team.alivePlayers === 'number' &&
      Number.isFinite(team.alivePlayers)
        ? Math.max(0, Math.floor(team.alivePlayers))
        : null;
    const totalPlayers =
      explicitTotalPlayers !== null && explicitTotalPlayers > players.length
        ? explicitTotalPlayers
        : nextPlayers.length;
    const alivePlayers =
      explicitAlivePlayers !== null && explicitAlivePlayers > originalAliveRows
        ? Math.min(explicitAlivePlayers, nextPlayers.length)
        : dedupedAliveRows;

    return {
      ...team,
      players: nextPlayers,
      totalPlayers,
      alivePlayers,
      alive: alivePlayers > 0,
      eliminated: alivePlayers <= 0,
    };
  }

  private assertCanonicalPlayerWriter(
    state: LiveMatchState,
    writer: LiveStateMirrorWriter,
  ) {
    const playerRows = countStatePlayerRows(state);
    const telemetryOwnedState =
      playerRows > 0 && this.hasActiveTelemetryOwnership(state);

    if (!telemetryOwnedState || writer === 'telemetry-engine') {
      return;
    }

    this.logger.error(
      JSON.stringify({
        tag: '[CRITICAL DUPLICATE SOURCE]',
        stage: 'live-state-mirror',
        action: 'non-canonical-player-writer',
        matchId: state.matchId,
        writer,
        status: state.status,
        sourceMode: state.sourceMode ?? null,
        playerRows,
      }),
    );
    throw new ConflictException(
      `[CRITICAL DUPLICATE SOURCE] Non-canonical player writer ${writer} attempted to publish live telemetry state`,
    );
  }

  private isTelemetryRuntimeState(state: LiveMatchState): boolean {
    return isAutomaticMatchStateSourceMode(state.sourceMode);
  }

  private hasActiveTelemetryOwnership(
    state: LiveMatchState | null | undefined,
  ): boolean {
    if (!state || state.status !== 'LIVE') {
      return false;
    }

    if (isAutomaticMatchStateSourceMode(state.sourceMode)) {
      return true;
    }

    return state.teams.some((team) => {
      if (
        isAutomaticMatchStateSourceMode(team.sourceMode) ||
        team.hasTelemetryPresence === true
      ) {
        return true;
      }

      return (team.players ?? []).some(
        (player) =>
          player.lifeTelemetryFresh === true || Boolean(player.position),
      );
    });
  }

  private isPlayerBearingLiveState(
    state: LiveMatchState | null | undefined,
  ): boolean {
    return Boolean(
      state && state.status === 'LIVE' && countStatePlayers(state) > 0,
    );
  }

  private extractCanonicalRoster(state: LiveMatchState): CanonicalRoster {
    return {
      teams: cloneLiveState(state.teams ?? []),
      summary: cloneLiveState(state.summary ?? null),
      lockedAt: Date.now(),
    };
  }

  private preserveCurrentUtilitySnapshots(
    current: LiveMatchState | null,
    incoming: LiveMatchState,
  ): LiveMatchState {
    if (!current || (current.teams?.length ?? 0) === 0) {
      return incoming;
    }

    const lookup = buildTeamUtilityLookup(current.teams);
    return {
      ...incoming,
      teams: incoming.teams.map((team) =>
        mergeTeamUtilitySnapshots(
          team,
          resolveUtilityFallbackTeam(team, lookup),
        ),
      ),
    };
  }

  private mergeRuntimeIntoCanonicalRoster(
    current: LiveMatchState | null,
    incoming: LiveMatchState,
    canonical: CanonicalRoster,
  ): { state: LiveMatchState; rosterPreserved: boolean } {
    const earlyAirPhase = isEarlyAirPhase(incoming);
    const incomingTeams = new Map(
      incoming.teams.map((team) => [team.teamId, team] as const),
    );
    const currentTeams = new Map(
      (current?.teams ?? []).map((team) => [team.teamId, team] as const),
    );
    const mergedTeams = canonical.teams.map((canonicalTeam) => {
      const currentTeam = currentTeams.get(canonicalTeam.teamId) ?? null;
      const runtimeTeam =
        incomingTeams.get(canonicalTeam.teamId) ?? currentTeam ?? null;
      const runtimePlayers = new Map<string, MatchStatePlayer>();
      for (const player of runtimeTeam?.players ?? []) {
        const key = playerIdentity(player);
        if (key) {
          runtimePlayers.set(key, player);
        }
      }

      const players: MatchStatePlayer[] = [];
      const mergedPlayerKeys = new Set<string>();
      for (const canonicalPlayer of canonicalTeam.players ?? []) {
        const key = playerIdentity(canonicalPlayer);
        const runtimePlayer = key ? runtimePlayers.get(key) : null;
        const dropStaleCanonicalPlayer =
          !runtimePlayer &&
          runtimePlayers.size > 0 &&
          canonicalPlayer.lifeTelemetryFresh !== true;
        if (dropStaleCanonicalPlayer) {
          continue;
        }
        const runtimeAlive = runtimePlayer?.alive;
        const alive =
          earlyAirPhase &&
          canonicalPlayer.alive === true &&
          runtimeAlive === false
            ? true
            : (runtimeAlive ?? canonicalPlayer.alive);
        const knocked = runtimePlayer?.knocked ?? canonicalPlayer.knocked;
        players.push({
          ...canonicalPlayer,
          alive,
          knocked,
          eliminated:
            earlyAirPhase && alive === true
              ? false
              : (runtimePlayer?.eliminated ?? (alive === false ? true : false)),
          health: runtimePlayer?.health ?? canonicalPlayer.health ?? null,
          kills: runtimePlayer?.kills ?? canonicalPlayer.kills,
          position: runtimePlayer?.position ?? canonicalPlayer.position ?? null,
          updatedAt: runtimePlayer?.updatedAt ?? incoming.updatedAt,
          lifeTelemetryFresh:
            runtimePlayer?.lifeTelemetryFresh ??
            canonicalPlayer.lifeTelemetryFresh,
          ownership: runtimePlayer?.ownership ?? canonicalPlayer.ownership,
        });
        if (key) {
          mergedPlayerKeys.add(key);
        }
      }

      for (const [key, runtimePlayer] of runtimePlayers) {
        if (mergedPlayerKeys.has(key)) {
          continue;
        }
        players.push({
          ...runtimePlayer,
          updatedAt: runtimePlayer.updatedAt ?? incoming.updatedAt,
        });
      }

      const alivePlayersFromRows =
        players.length > 0
          ? players.filter((player) => player.alive === true).length
          : null;
      const runtimeAlivePlayers =
        typeof runtimeTeam?.alivePlayers === 'number' &&
        Number.isFinite(runtimeTeam.alivePlayers)
          ? Math.max(0, Math.floor(runtimeTeam.alivePlayers))
          : null;
      const previousAlivePlayers = countTeamAlivePlayersWithRosterFallback(
        currentTeam ?? canonicalTeam,
      );
      const blockedZeroAliveCollapse =
        earlyAirPhase && previousAlivePlayers > 0 && runtimeAlivePlayers === 0;
      if (blockedZeroAliveCollapse) {
        this.logger.warn(
          JSON.stringify({
            tag: '[ELIMINATION][BLOCKED]',
            stage: 'live-state-mirror',
            action: 'runtime-zero-alive-collapse-blocked',
            matchId: incoming.matchId,
            teamId: canonicalTeam.teamId,
            phase: incoming.circle?.phase ?? null,
            previousAlivePlayers,
            incomingAlivePlayers: runtimeAlivePlayers,
            reason: 'EARLY_AIR_PHASE_ZERO_ALIVE_PUBLISH_BLOCKED',
          }),
        );
      }
      const alivePlayers =
        (blockedZeroAliveCollapse
          ? previousAlivePlayers
          : runtimeAlivePlayers) ??
        alivePlayersFromRows ??
        countTeamAlivePlayers(canonicalTeam);
      const runtimeTotalPlayers =
        typeof runtimeTeam?.totalPlayers === 'number' &&
        Number.isFinite(runtimeTeam.totalPlayers)
          ? Math.max(0, Math.floor(runtimeTeam.totalPlayers))
          : 0;
      const totalPlayers = Math.max(players.length, runtimeTotalPlayers);

      return {
        ...canonicalTeam,
        kills: runtimeTeam?.kills ?? canonicalTeam.kills,
        placement: blockedZeroAliveCollapse
          ? canonicalTeam.placement
          : (runtimeTeam?.placement ?? canonicalTeam.placement),
        points: runtimeTeam?.points ?? canonicalTeam.points,
        backpack:
          runtimeTeam?.backpack ??
          currentTeam?.backpack ??
          canonicalTeam.backpack ??
          null,
        equipment:
          runtimeTeam?.equipment ??
          runtimeTeam?.backpack ??
          currentTeam?.equipment ??
          currentTeam?.backpack ??
          canonicalTeam.equipment ??
          canonicalTeam.backpack ??
          null,
        alivePlayers,
        totalPlayers,
        alive: alivePlayers > 0,
        eliminated: alivePlayers <= 0,
        updatedAt: runtimeTeam?.updatedAt ?? incoming.updatedAt,
        sourceMode: runtimeTeam?.sourceMode ?? incoming.sourceMode,
        ownership: runtimeTeam?.ownership ?? canonicalTeam.ownership,
        players,
      };
    });

    const totalPlayers = mergedTeams.reduce(
      (sum, team) => sum + countTeamPlayers(team),
      0,
    );
    const alivePlayers = mergedTeams.reduce(
      (sum, team) => sum + countTeamAlivePlayers(team),
      0,
    );
    const aliveTeams = mergedTeams.reduce(
      (sum, team) => (countTeamAlivePlayers(team) > 0 ? sum + 1 : sum),
      0,
    );
    const winner =
      mergedTeams.find((team) => team.placement === 1) ??
      (aliveTeams === 1
        ? (mergedTeams.find((team) => countTeamAlivePlayers(team) > 0) ?? null)
        : null);

    return {
      rosterPreserved: true,
      state: {
        ...incoming,
        observedPlayer:
          incoming.observedPlayer ?? current?.observedPlayer ?? null,
        teams: mergedTeams,
        summary: {
          totalTeams: mergedTeams.length,
          aliveTeams,
          totalPlayers,
          alivePlayers,
          winnerTeamId: winner?.teamId ?? null,
          winnerSlot: winner?.slot ?? null,
        },
      },
    };
  }

  private mergeState(
    current: LiveMatchState | null,
    incoming: LiveMatchState,
    telemetryRuntimeState: boolean,
    writer: LiveStateMirrorWriter,
  ): { state: LiveMatchState; rosterPreserved: boolean } {
    if (telemetryRuntimeState && writer === 'telemetry-engine') {
      const state = this.preserveCurrentUtilitySnapshots(current, incoming);
      return {
        state: {
          ...state,
          observedPlayer:
            state.observedPlayer ?? current?.observedPlayer ?? null,
        },
        rosterPreserved: false,
      };
    }

    if (telemetryRuntimeState) {
      const canonical =
        this.canonicalRosters.get(incoming.matchId) ??
        (current ? this.extractCanonicalRoster(current) : null);
      if (canonical) {
        if (!this.canonicalRosters.has(incoming.matchId)) {
          this.canonicalRosters.set(incoming.matchId, canonical);
        }
        return this.mergeRuntimeIntoCanonicalRoster(
          current,
          incoming,
          canonical,
        );
      }
    }

    if (!current || TERMINAL_STATUSES.has(incoming.status)) {
      return { state: incoming, rosterPreserved: false };
    }

    const currentPlayerRows = countStatePlayerRows(current);
    const incomingPlayerRows = countStatePlayerRows(incoming);
    const currentTeamCount = current.teams.length;
    const incomingTeamCount = incoming.teams.length;
    const currentPlayers = countStatePlayers(current);
    const incomingPlayers = countStatePlayers(incoming);
    const earlyAirPhase = isEarlyAirPhase(incoming);
    const currentAlivePlayers = current.teams.reduce(
      (sum, team) => sum + countTeamAlivePlayersWithRosterFallback(team),
      0,
    );
    const incomingAlivePlayers = incoming.teams.reduce(
      (sum, team) => sum + countTeamAlivePlayers(team),
      0,
    );
    const zeroAliveCollapse =
      earlyAirPhase && currentAlivePlayers > 0 && incomingAlivePlayers === 0;
    const shouldPreserveRoster =
      (currentPlayerRows > 0 && incomingPlayerRows < currentPlayerRows) ||
      (currentTeamCount > 0 && incomingTeamCount < currentTeamCount) ||
      (currentPlayers > 0 && incomingPlayers < currentPlayers) ||
      zeroAliveCollapse;

    if (!shouldPreserveRoster) {
      return { state: incoming, rosterPreserved: false };
    }

    const currentTeams = new Map(
      current.teams.map((team) => [team.teamId, team] as const),
    );
    const mergedTeams = incoming.teams.map((team) => {
      const previous = currentTeams.get(team.teamId) ?? null;
      if (!previous) {
        return team;
      }

      const teamIsPartial = isTeamPartialAgainstRoster(team, previous);
      const teamZeroAliveCollapse =
        earlyAirPhase &&
        countTeamAlivePlayersWithRosterFallback(previous) > 0 &&
        countTeamAlivePlayers(team) === 0;
      if (teamZeroAliveCollapse) {
        this.logger.warn(
          JSON.stringify({
            tag: '[ELIMINATION][BLOCKED]',
            stage: 'live-state-mirror',
            action: 'incoming-zero-alive-collapse-blocked',
            matchId: incoming.matchId,
            teamId: team.teamId,
            phase: incoming.circle?.phase ?? null,
            previousAlivePlayers:
              countTeamAlivePlayersWithRosterFallback(previous),
            incomingAlivePlayers: countTeamAlivePlayers(team),
            reason: 'EARLY_AIR_PHASE_ZERO_ALIVE_PUBLISH_BLOCKED',
          }),
        );
      }
      const incomingAlivePlayers = countTeamAlivePlayers(team);
      const previousAlivePlayers =
        countTeamAlivePlayersWithRosterFallback(previous);
      const alivePlayers =
        teamIsPartial || teamZeroAliveCollapse
          ? Math.max(incomingAlivePlayers, previousAlivePlayers)
          : incomingAlivePlayers;
      const totalPlayers = Math.max(
        countTeamPlayers(team),
        countTeamPlayers(previous),
      );
      const previousPlayerRows = countTeamPlayerRows(previous);
      const incomingPlayerRows = countTeamPlayerRows(team);

      return {
        ...team,
        totalPlayers,
        alivePlayers,
        alive: alivePlayers > 0,
        eliminated: alivePlayers <= 0,
        players:
          teamZeroAliveCollapse ||
          (previousPlayerRows > 0 && incomingPlayerRows < previousPlayerRows)
            ? (previous.players ?? [])
            : (team.players ?? previous.players ?? []),
      };
    });

    const incomingTeamIds = new Set(mergedTeams.map((team) => team.teamId));
    for (const team of current.teams) {
      if (!incomingTeamIds.has(team.teamId)) {
        mergedTeams.push(preserveAliveBaseline(team));
      }
    }

    const winner =
      mergedTeams.find((team) => team.placement === 1) ??
      (mergedTeams.filter((team) => countTeamAlivePlayers(team) > 0).length ===
      1
        ? (mergedTeams.find((team) => countTeamAlivePlayers(team) > 0) ?? null)
        : null);
    const totalPlayers = mergedTeams.reduce(
      (sum, team) => sum + countTeamPlayers(team),
      0,
    );
    const alivePlayers = mergedTeams.reduce(
      (sum, team) => sum + countTeamAlivePlayers(team),
      0,
    );
    const aliveTeams = mergedTeams.reduce(
      (sum, team) => (countTeamAlivePlayers(team) > 0 ? sum + 1 : sum),
      0,
    );

    return {
      rosterPreserved: true,
      state: {
        ...incoming,
        observedPlayer:
          incoming.observedPlayer ?? current.observedPlayer ?? null,
        teams: mergedTeams,
        summary: {
          totalTeams: mergedTeams.length,
          aliveTeams,
          totalPlayers,
          alivePlayers,
          winnerTeamId: winner?.teamId ?? null,
          winnerSlot: winner?.slot ?? null,
        },
      },
    };
  }

  private protectActiveTelemetryRuntime(
    current: LiveMatchState | null,
    incoming: LiveMatchState,
    writer: LiveStateMirrorWriter,
  ): { state: LiveMatchState; rosterPreserved: boolean } | null {
    if (
      !current ||
      writer === 'telemetry-engine' ||
      !this.hasActiveTelemetryOwnership(current) ||
      !this.isPlayerBearingLiveState(incoming)
    ) {
      return null;
    }

    if (writer !== 'match-control') {
      this.logger.error(
        JSON.stringify({
          tag: '[CRITICAL DUPLICATE SOURCE]',
          stage: 'live-state-mirror',
          action: 'active-telemetry-runtime-overwrite-blocked',
          matchId: incoming.matchId,
          writer,
          status: incoming.status,
          currentSourceMode: current.sourceMode ?? null,
          incomingSourceMode: incoming.sourceMode ?? null,
          currentPlayers: countStatePlayerRows(current),
          incomingPlayers: countStatePlayerRows(incoming),
          currentTotalPlayers: countStatePlayers(current),
          incomingTotalPlayers: countStatePlayers(incoming),
        }),
      );
      throw new ConflictException(
        `[CRITICAL DUPLICATE SOURCE] Non-canonical player writer ${writer} attempted to overwrite active telemetry-owned live state`,
      );
    }

    this.lockCanonicalRoster(incoming.matchId, incoming);
    this.logger.warn(
      JSON.stringify({
        tag: '[TELEMETRY][BLOCKED]',
        stage: 'live-state-mirror',
        action: 'match-control-runtime-overwrite-blocked',
        matchId: incoming.matchId,
        writer,
        currentSourceMode: current.sourceMode ?? null,
        incomingSourceMode: incoming.sourceMode ?? null,
        currentPlayers: countStatePlayerRows(current),
        incomingPlayers: countStatePlayerRows(incoming),
        currentTotalPlayers: countStatePlayers(current),
        incomingTotalPlayers: countStatePlayers(incoming),
      }),
    );

    const canonical = this.canonicalRosters.get(incoming.matchId);
    if (!canonical) {
      return null;
    }

    return this.mergeRuntimeIntoCanonicalRoster(current, current, canonical);
  }
}
