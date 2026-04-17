import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

const OBSERVER_ACHIEVEMENTS_URL = "/api/widgets/observer-direct/achievements";

export type ObserverAchievementPayload = {
  matchId: string;
  eventId: string;
  type: string;
  player: {
    id: string | null;
    name: string | null;
    photoUrl: string | null;
  };
  team: {
    id: string | null;
    name: string | null;
    tag: string | null;
    logoUrl: string | null;
  };
  timestamp: string;
};

export type ObserverDirectAchievementResponse = {
  matchId: string;
  updatedAt: string;
  events: ObserverAchievementPayload[];
};

type UseObserverDirectAchievementsOptions = {
  enabled?: boolean;
  pollMs?: number;
  preferCanonical?: boolean;
};

type UseObserverDirectAchievementsResult = {
  data: ObserverDirectAchievementResponse | null;
  error: string | null;
  isLoading: boolean;
  lastEventAt: string | null;
};

function directAchievementsQueryKey(
  matchId: string | null,
  preferCanonical: boolean,
) {
  return ["observer-direct-achievements", matchId, preferCanonical] as const;
}

function errorMessage(error: unknown): string | null {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }
  return null;
}

async function fetchObserverDirectAchievements(
  matchId: string,
  preferCanonical = false,
): Promise<ObserverDirectAchievementResponse> {
  const params = new URLSearchParams({ matchId });
  if (preferCanonical) {
    params.set("preferCanonical", "true");
  }
  const response = await fetch(`${OBSERVER_ACHIEVEMENTS_URL}?${params.toString()}`, {
    cache: "no-store",
  });
  if (!response.ok) {
    const message = (await response.text()).trim();
    throw new Error(
      message || `Failed to load direct observer achievements (${response.status})`,
    );
  }

  return (await response.json()) as ObserverDirectAchievementResponse;
}

export function useObserverDirectAchievements(
  matchId: string | null,
  options?: UseObserverDirectAchievementsOptions,
): UseObserverDirectAchievementsResult {
  const enabled = options?.enabled ?? true;
  const pollMs = options?.pollMs ?? 800;
  const preferCanonical = options?.preferCanonical === true;
  const query = useQuery({
    queryKey: directAchievementsQueryKey(matchId, preferCanonical),
    queryFn: () => fetchObserverDirectAchievements(matchId!, preferCanonical),
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
