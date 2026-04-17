import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { MatchControlStateStore, type LiveMatchState } from './state.store';

const TERMINAL_STATUSES = new Set<LiveMatchState['status']>(['ENDED', 'CONFIRMED']);

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

const countStatePlayerRows = (state: LiveMatchState | null | undefined): number =>
  Array.isArray(state?.teams)
    ? state.teams.reduce((sum, team) => sum + countTeamPlayerRows(team), 0)
    : 0;

const countStatePlayers = (state: LiveMatchState | null | undefined): number =>
  Array.isArray(state?.teams)
    ? state.teams.reduce((sum, team) => sum + countTeamPlayers(team), 0)
    : 0;

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
        ? state.teams.reduce((sum, team) => sum + countTeamAlivePlayers(team), 0)
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

@Injectable()
export class LiveStateMirrorService {
  private readonly logger = new Logger(LiveStateMirrorService.name);

  constructor(private readonly stateStore: MatchControlStateStore) {}

  async publish(state: LiveMatchState): Promise<LiveMatchState> {
    const baseVersion = typeof state.version === 'number' ? state.version : 0;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const current = await this.stateStore.get(state.matchId);
      const merged = this.mergeState(current, state);
      const currentVersion =
        typeof current?.version === 'number' ? current.version : null;
      const nextVersion =
        currentVersion === null
          ? Math.max(baseVersion, 0)
          : Math.max(baseVersion, currentVersion + 1);

      const nextState: LiveMatchState = {
        ...merged.state,
        version: nextVersion,
      };

      this.logger.debug(
        JSON.stringify({
          tag: '[telemetry][state-before]',
          matchId: state.matchId,
          current: summarizeState(current),
          incoming: summarizeState(state),
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
            matchId: state.matchId,
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
          matchId: state.matchId,
          next: summarizeState(nextState),
          rosterPreserved: merged.rosterPreserved,
        }),
      );

      try {
        return await this.stateStore.save(
          state.matchId,
          nextState,
          currentVersion ?? undefined,
        );
      } catch (error) {
        if (!(error instanceof ConflictException) || attempt === 2) {
          throw error;
        }
      }
    }

    throw new ConflictException('Failed to publish live match state');
  }

  private mergeState(
    current: LiveMatchState | null,
    incoming: LiveMatchState,
  ): { state: LiveMatchState; rosterPreserved: boolean } {
    if (!current || TERMINAL_STATUSES.has(incoming.status)) {
      return { state: incoming, rosterPreserved: false };
    }

    const currentPlayerRows = countStatePlayerRows(current);
    const incomingPlayerRows = countStatePlayerRows(incoming);
    const shouldPreserveRoster =
      currentPlayerRows > 0 && incomingPlayerRows === 0;

    if (!shouldPreserveRoster) {
      return { state: incoming, rosterPreserved: false };
    }

    const currentTeams = new Map(
      current.teams.map((team) => [team.teamId, team] as const),
    );
    const mergedTeams = incoming.teams.map((team) => {
      const previous = currentTeams.get(team.teamId) ?? null;
      if (!previous || countTeamPlayerRows(previous) === 0) {
        return team;
      }

      const alivePlayers =
        typeof team.alivePlayers === 'number' && Number.isFinite(team.alivePlayers)
          ? Math.max(0, Math.floor(team.alivePlayers))
          : countTeamAlivePlayers(previous);
      const totalPlayers = Math.max(
        countTeamPlayers(team),
        countTeamPlayers(previous),
      );

      return {
        ...team,
        totalPlayers,
        alivePlayers,
        alive:
          typeof team.alive === 'boolean' ? team.alive : alivePlayers > 0,
        eliminated:
          typeof team.eliminated === 'boolean'
            ? team.eliminated
            : alivePlayers <= 0,
        players: previous.players ?? [],
      };
    });

    const incomingTeamIds = new Set(mergedTeams.map((team) => team.teamId));
    for (const team of current.teams) {
      if (!incomingTeamIds.has(team.teamId)) {
        mergedTeams.push(team);
      }
    }

    const winner =
      mergedTeams.find((team) => team.placement === 1) ??
      (mergedTeams.filter((team) => countTeamAlivePlayers(team) > 0).length === 1
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
        observedPlayer: incoming.observedPlayer ?? current.observedPlayer ?? null,
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
}
