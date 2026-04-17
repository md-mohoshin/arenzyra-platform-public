export type PubgRulePlayerInput = {
  id: string;
  teamId: string;
  kills?: number | null;
  alive?: boolean | null;
  knocked?: boolean | null;
};

export type PubgRuleTeamInput<TEliminationMarker = Date | number> = {
  teamId: string;
  sortKey?: string | null;
  players: PubgRulePlayerInput[];
  totalPlayers?: number | null;
  eliminatedOrder?: number | null;
  eliminatedAt?: TEliminationMarker | null;
  manualTotalKills?: boolean | null;
  totalKillsOverride?: number | null;
};

export type PubgRulePlayerState = {
  id: string;
  teamId: string;
  kills: number;
  alive: boolean;
  knocked: boolean;
};

export type PubgRuleTeamState<TEliminationMarker = Date | number> = {
  teamId: string;
  sortKey: string;
  players: PubgRulePlayerState[];
  aliveCount: number;
  standingCount: number;
  totalPlayers: number;
  teamKills: number;
  eliminated: boolean;
  eliminatedOrder: number | null;
  placement: number | null;
  eliminatedAt: TEliminationMarker | null;
};

export type PubgRuleMatchState<TEliminationMarker = Date | number> = {
  totalTeams: number;
  aliveTeams: number;
  teams: PubgRuleTeamState<TEliminationMarker>[];
};

function clampKills(value?: number | null): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.trunc(value));
}

function placementFromEliminatedOrder(
  totalTeams: number,
  eliminatedOrder: number | null,
): number | null {
  if (eliminatedOrder === null) {
    return null;
  }
  return Math.max(totalTeams - eliminatedOrder + 1, 1);
}

function normalizeTeamPlayers(
  players: PubgRulePlayerInput[],
): PubgRulePlayerState[] {
  const sanitized = (players ?? []).map((player) => {
    const alive = player.alive === true;
    const knockedRequested = player.knocked === true;
    const nextAlive = knockedRequested ? true : alive;
    return {
      id: player.id,
      teamId: player.teamId,
      kills: clampKills(player.kills),
      alive: nextAlive,
      knocked: nextAlive ? knockedRequested : false,
    };
  });

  const aliveCount = sanitized.filter((player) => player.alive).length;
  if (aliveCount === 0) {
    return sanitized.map((player) => ({
      ...player,
      alive: false,
      knocked: false,
    }));
  }

  let knockedCount = sanitized.filter(
    (player) => player.alive && player.knocked,
  ).length;
  // PUBG results editing expects at least one surviving player to remain
  // not knocked. A fully knocked team is treated as effectively out.
  const maxKnocked = Math.max(aliveCount - 1, 0);

  if (knockedCount > maxKnocked) {
    const next = sanitized.map((player) => ({ ...player }));
    for (const player of next) {
      if (knockedCount <= maxKnocked) {
        break;
      }
      if (!player.alive || !player.knocked) {
        continue;
      }
      player.knocked = false;
      knockedCount -= 1;
    }
    return next;
  }

  return sanitized;
}

export function derivePubgMatchState<TEliminationMarker>(params: {
  teams: PubgRuleTeamInput<TEliminationMarker>[];
  eliminationMarker: TEliminationMarker;
}): PubgRuleMatchState<TEliminationMarker> {
  const workingTeams = (params.teams ?? []).map((team) => {
    const normalizedPlayers = normalizeTeamPlayers(team.players ?? []);
    const aliveCount = normalizedPlayers.filter(
      (player) => player.alive,
    ).length;
    const standingCount = normalizedPlayers.filter(
      (player) => player.alive && !player.knocked,
    ).length;
    const aggregateKills = normalizedPlayers.reduce(
      (sum, player) => sum + player.kills,
      0,
    );
    const teamKills =
      team.manualTotalKills === true
        ? clampKills(team.totalKillsOverride)
        : aggregateKills;

    return {
      teamId: team.teamId,
      sortKey: team.sortKey?.trim() || team.teamId,
      players: normalizedPlayers,
      aliveCount,
      standingCount,
      totalPlayers: Math.max(team.totalPlayers ?? 0, normalizedPlayers.length),
      teamKills,
      eliminatedOrder: aliveCount > 0 ? null : (team.eliminatedOrder ?? null),
      eliminatedAt:
        aliveCount > 0 ? null : (team.eliminatedAt ?? params.eliminationMarker),
    };
  });

  const eliminatedTeams = workingTeams
    .filter((team) => team.aliveCount === 0)
    .sort((left, right) => {
      const leftOrder = left.eliminatedOrder ?? Number.POSITIVE_INFINITY;
      const rightOrder = right.eliminatedOrder ?? Number.POSITIVE_INFINITY;
      if (leftOrder === rightOrder) {
        return left.sortKey.localeCompare(right.sortKey);
      }
      return leftOrder - rightOrder;
    });

  let normalizedOrder = 1;
  for (const team of eliminatedTeams) {
    team.eliminatedOrder = normalizedOrder;
    normalizedOrder += 1;
  }

  const aliveTeams = workingTeams.reduce(
    (count, team) => (team.aliveCount > 0 ? count + 1 : count),
    0,
  );
  const totalTeams = workingTeams.length;

  const teams = workingTeams.map((team) => {
    const eliminated = team.aliveCount === 0;
    const placement = eliminated
      ? placementFromEliminatedOrder(totalTeams, team.eliminatedOrder)
      : aliveTeams === 1
        ? 1
        : null;

    return {
      ...team,
      eliminated,
      placement,
      eliminatedAt: eliminated ? team.eliminatedAt : null,
    };
  });

  return {
    totalTeams,
    aliveTeams,
    teams,
  };
}

export function derivePubgTeamState<TEliminationMarker>(params: {
  team: PubgRuleTeamInput<TEliminationMarker>;
  eliminationMarker: TEliminationMarker;
}): PubgRuleTeamState<TEliminationMarker> {
  return derivePubgMatchState({
    teams: [params.team],
    eliminationMarker: params.eliminationMarker,
  }).teams[0];
}
