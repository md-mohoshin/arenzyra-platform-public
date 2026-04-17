import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

const OBSERVER_LEADERBOARD_URL = "/api/widgets/observer-direct/leaderboard";

export type ObserverLeaderboardPlayer = {
  playerId: string | null;
  playerName: string;
  avatarUrl: string | null;
  kills: number;
  alive: boolean;
  knocked: boolean;
  health: number | null;
  outsideBlueCircle?: boolean | null;
  x?: number | null;
  y?: number | null;
  hasDied: boolean | null;
  lifeTelemetryFresh?: boolean;
};

export type ObserverLeaderboardRow = {
  rank: number;
  teamId: string | null;
  slot: number | null;
  teamName: string;
  teamTag: string | null;
  logoUrl: string | null;
  color: string | null;
  kills: number;
  alivePlayers: number;
  totalPlayers: number | null;
  placement: number | null;
  isEliminated: boolean;
  players?: ObserverLeaderboardPlayer[];
};

export type ObserverLeaderboardPayload = {
  matchId: string;
  updatedAt: string;
  mapName?: string | null;
  teamsAlive: number;
  leaderboard: ObserverLeaderboardRow[];
  killFeed: [];
  playerCard: {
    playerId: string | null;
    name: string | null;
    avatarUrl: string | null;
    teamId: string | null;
    teamName: string | null;
    teamTag: string | null;
    logoUrl: string | null;
    color: string | null;
    kills: number;
    alive: boolean;
    damage: number | null;
  } | null;
  circle: {
    phase: number | null;
    status: string | null;
    counterSeconds: number | null;
    maxTimeSeconds: number | null;
    nextShrinkAt: string | null;
    safeZone: { x: number; y: number; r: number } | null;
    nextZone: { x: number; y: number; r: number } | null;
  } | null;
  flightPath: {
    start: { x: number; y: number };
    end: { x: number; y: number };
    coordinateSystem?: "WORLD" | "WORLD_BOTTOM_LEFT" | null;
  } | null;
  winner: {
    teamId: string | null;
    slot: number | null;
    teamName: string;
    teamTag: string | null;
    logoUrl: string | null;
    color: string | null;
    kills: number;
    alivePlayers: number;
    placement: number | null;
  } | null;
};

type UseObserverDirectLeaderboardOptions = {
  enabled?: boolean;
  pollMs?: number;
  launcherOnly?: boolean;
};

type UseObserverDirectLeaderboardResult = {
  data: ObserverLeaderboardPayload | null;
  error: string | null;
  isLoading: boolean;
  lastEventAt: string | null;
};

function directLeaderboardQueryKey(
  matchId: string | null,
  launcherOnly: boolean,
) {
  return [
    "observer-direct-leaderboard",
    matchId,
    launcherOnly ? "launcher-only" : "default",
  ] as const;
}

function errorMessage(error: unknown): string | null {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }
  return null;
}

async function fetchObserverDirectLeaderboard(
  matchId: string,
  launcherOnly: boolean,
): Promise<ObserverLeaderboardPayload> {
  const params = new URLSearchParams({ matchId });
  if (launcherOnly) {
    params.set("launcherOnly", "1");
  }
  const response = await fetch(`${OBSERVER_LEADERBOARD_URL}?${params.toString()}`, {
    cache: "no-store",
  });
  if (!response.ok) {
    const message = (await response.text()).trim();
    throw new Error(
      message || `Failed to load direct observer leaderboard (${response.status})`,
    );
  }

  return (await response.json()) as ObserverLeaderboardPayload;
}

export function useObserverDirectLeaderboard(
  matchId: string | null,
  options?: UseObserverDirectLeaderboardOptions,
): UseObserverDirectLeaderboardResult {
  const enabled = options?.enabled ?? true;
  const pollMs = options?.pollMs ?? 800;
  const launcherOnly = options?.launcherOnly ?? false;
  const query = useQuery({
    queryKey: directLeaderboardQueryKey(matchId, launcherOnly),
    queryFn: () => fetchObserverDirectLeaderboard(matchId!, launcherOnly),
    enabled: enabled && Boolean(matchId),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 10 * 60_000,
    refetchOnMount: true,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
    refetchInterval: enabled && Boolean(matchId) ? pollMs : false,
    refetchIntervalInBackground: true,
    retry: 1,
  });

  return useMemo(
    () => ({
      data: query.data ?? null,
      error: errorMessage(query.error),
      isLoading: enabled && Boolean(matchId) && query.isPending && !query.data,
      lastEventAt: query.data?.updatedAt ?? null,
    }),
    [enabled, matchId, query.data, query.error, query.isPending],
  );
}
