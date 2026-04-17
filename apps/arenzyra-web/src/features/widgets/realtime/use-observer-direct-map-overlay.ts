import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

const OBSERVER_MAP_OVERLAY_URL = "/api/widgets/observer-direct/map-overlay";

export type ObserverDirectMapOverlayPayload = {
  matchId: string;
  updatedAt: string;
  debug?: {
    producer?: "observer-map-overlay" | "observer-leaderboard-derived-fallback" | null;
    totalPlayers?: number | null;
    positionedPlayers?: number | null;
    playerMarkers?: number | null;
    teamMarkers?: number | null;
    worldSize?: number | null;
    bounds?: {
      minX?: number | null;
      maxX?: number | null;
      minY?: number | null;
      maxY?: number | null;
    } | null;
  } | null;
  map: {
    mapName: string;
    worldSize: number;
    coordinateSystem?: "WORLD" | "WORLD_BOTTOM_LEFT" | null;
  } | null;
  circle: {
    safeZone: { x: number; y: number; r: number } | null;
    nextZone: { x: number; y: number; r: number } | null;
    phaseIndex: number | null;
    status: string | null;
    counterSeconds: number | null;
    maxTimeSeconds: number | null;
    nextShrinkAt: string | null;
    timerRemaining: number | null;
    timeRemainingToNextPhase: number | null;
    phaseLabel: string | null;
  } | null;
  flightPath: {
    start: { x: number; y: number };
    end: { x: number; y: number };
    coordinateSystem?: "WORLD" | "WORLD_BOTTOM_LEFT" | null;
  } | null;
  teamMarkers: Array<{
    teamId: string | null;
    x: number;
    y: number;
    alive?: boolean;
    playerCount: number;
    alivePlayers: number;
  }>;
  playerMarkers: Array<{
    playerId?: string | null;
    teamId?: string | null;
    x: number;
    y: number;
    alive?: boolean;
    knocked?: boolean;
  }>;
};

type UseObserverDirectMapOverlayOptions = {
  enabled?: boolean;
  pollMs?: number;
};

type UseObserverDirectMapOverlayResult = {
  data: ObserverDirectMapOverlayPayload | null;
  error: string | null;
  isLoading: boolean;
  lastEventAt: string | null;
};

function directMapOverlayQueryKey(matchId: string | null) {
  return ["observer-direct-map-overlay", matchId] as const;
}

function errorMessage(error: unknown): string | null {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }
  return null;
}

async function fetchObserverDirectMapOverlay(
  matchId: string,
): Promise<ObserverDirectMapOverlayPayload> {
  const params = new URLSearchParams({ matchId });
  const response = await fetch(`${OBSERVER_MAP_OVERLAY_URL}?${params.toString()}`, {
    cache: "no-store",
  });
  if (!response.ok) {
    const message = (await response.text()).trim();
    throw new Error(
      message || `Failed to load direct observer map overlay (${response.status})`,
    );
  }

  return (await response.json()) as ObserverDirectMapOverlayPayload;
}

export function useObserverDirectMapOverlay(
  matchId: string | null,
  options?: UseObserverDirectMapOverlayOptions,
): UseObserverDirectMapOverlayResult {
  const enabled = options?.enabled ?? true;
  const pollMs = options?.pollMs ?? 800;
  const query = useQuery({
    queryKey: directMapOverlayQueryKey(matchId),
    queryFn: () => fetchObserverDirectMapOverlay(matchId!),
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
