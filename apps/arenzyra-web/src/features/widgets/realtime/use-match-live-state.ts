"use client";

import { API_URL } from "@/lib/api";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { io } from "socket.io-client";

const MATCH_LIVE_STATE_SOCKET_URL = new URL("/realtime", API_URL).toString();

export type LiveMatchStatePlayerSnapshot = {
  id?: string | null;
  playerId?: string | null;
  externalPlayerId?: string | null;
  pubgPlayerId?: string | null;
  name?: string | null;
  ign?: string | null;
  avatarUrl?: string | null;
  teamId?: string | null;
  slot?: number | null;
  alive: boolean;
  knocked: boolean;
  eliminated?: boolean;
  kills: number;
  updatedAt?: string | null;
};

export type LiveMatchStateTeamSnapshot = {
  teamId: string;
  name: string | null;
  tag: string | null;
  slot: number | null;
  wasPresentInMatch?: boolean | null;
  presenceStatus?: "ACTIVE" | "NO_SHOW" | "UNRESOLVED" | null;
  kills: number;
  placement: number | null;
  points: number | null;
  logoUrl: string | null;
  alivePlayers?: number | null;
  totalPlayers?: number | null;
  alive?: boolean;
  eliminated?: boolean;
  players?: LiveMatchStatePlayerSnapshot[];
};

export type LiveMatchStateSnapshot = {
  matchId: string;
  status: string | null;
  startedAt: string | null;
  endedAt: string | null;
  version: number;
  updatedAt: string;
  sourceMode?: string | null;
  summary?: {
    totalTeams?: number | null;
    aliveTeams?: number | null;
    totalPlayers?: number | null;
    alivePlayers?: number | null;
    winnerTeamId?: string | null;
    winnerSlot?: number | null;
  } | null;
  circle?: {
    phase?: number | null;
    nextShrinkAt?: number | string | null;
    safeZone?: { x: number; y: number; r: number } | null;
    nextZone?: { x: number; y: number; r: number } | null;
  } | null;
  observedPlayer?: {
    playerId?: string | null;
    externalPlayerId?: string | null;
    pubgPlayerId?: string | null;
    playerName?: string | null;
    playerIgn?: string | null;
    teamId?: string | null;
    teamName?: string | null;
    teamTag?: string | null;
    teamLogoUrl?: string | null;
  } | null;
  teams: LiveMatchStateTeamSnapshot[];
};

type UseMatchLiveStateOptions = {
  enabled?: boolean;
  pollMs?: number;
};

type UseMatchLiveStateResult = {
  data: LiveMatchStateSnapshot | null;
  error: string | null;
  isConnected: boolean;
  isLoading: boolean;
  lastEventAt: string | null;
  version: number | null;
};

function matchLiveStateQueryKey(matchId: string | null) {
  return ["widget-match-live-state", matchId] as const;
}

async function fetchMatchLiveState(matchId: string): Promise<LiveMatchStateSnapshot> {
  const response = await fetch(
    `${API_URL}/api/matches/${encodeURIComponent(matchId)}/state`,
    {
      cache: "no-store",
    },
  );

  if (!response.ok) {
    const message = (await response.text()).trim();
    throw new Error(message || `Failed to load live state (${response.status})`);
  }

  return (await response.json()) as LiveMatchStateSnapshot;
}

function getErrorMessage(error: unknown): string | null {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }

  return null;
}

export function useMatchLiveState(
  matchId: string | null,
  options?: UseMatchLiveStateOptions,
): UseMatchLiveStateResult {
  const enabled = options?.enabled ?? true;
  const pollMs = options?.pollMs ?? 4_000;
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => matchLiveStateQueryKey(matchId), [matchId]);
  const [connectedMatchId, setConnectedMatchId] = useState<string | null>(null);
  const [socketErrorState, setSocketErrorState] = useState<{
    matchId: string;
    message: string;
  } | null>(null);

  const query = useQuery({
    queryKey,
    queryFn: () => fetchMatchLiveState(matchId!),
    enabled: enabled && Boolean(matchId),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 30 * 60_000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchInterval: enabled && Boolean(matchId) ? pollMs : false,
    refetchIntervalInBackground: true,
    retry: 1,
  });

  useEffect(() => {
    if (!enabled || !matchId) {
      return;
    }

    let cancelled = false;
    let hasConnectedBefore = false;
    const socket = io(MATCH_LIVE_STATE_SOCKET_URL, {
      transports: ["websocket"],
      query: { matchId },
      forceNew: true,
    });

    const handleRealtimeState = (payload: unknown) => {
      if (cancelled) {
        return;
      }

      const payloadMatchId =
        payload && typeof payload === "object" && "matchId" in payload
          ? String((payload as { matchId?: unknown }).matchId ?? "").trim()
          : null;
      if (payloadMatchId && payloadMatchId !== matchId) {
        return;
      }

      setSocketErrorState((current) =>
        current?.matchId === matchId ? null : current,
      );
      void queryClient.invalidateQueries({ queryKey });
    };

    socket.on("connect", () => {
      if (cancelled) {
        return;
      }

      if (hasConnectedBefore) {
        void queryClient.invalidateQueries({ queryKey });
      } else {
        hasConnectedBefore = true;
      }

      setConnectedMatchId(matchId);
      setSocketErrorState((current) =>
        current?.matchId === matchId ? null : current,
      );
    });

    socket.on("disconnect", () => {
      if (cancelled) {
        return;
      }

      setConnectedMatchId((current) => (current === matchId ? null : current));
    });

    socket.on("connect_error", (error: Error) => {
      if (cancelled) {
        return;
      }

      setConnectedMatchId((current) => (current === matchId ? null : current));
      setSocketErrorState({
        matchId,
        message: error.message || "Realtime connection failed.",
      });
    });

    socket.on("match_state_updated", handleRealtimeState);
    socket.on("match:update", handleRealtimeState);

    return () => {
      cancelled = true;
      socket.off("match_state_updated", handleRealtimeState);
      socket.off("match:update", handleRealtimeState);
      socket.disconnect();
    };
  }, [enabled, matchId, queryClient, queryKey]);

  const isConnected =
    enabled && Boolean(matchId) && connectedMatchId === matchId;
  const queryError = getErrorMessage(query.error);
  const socketError =
    socketErrorState?.matchId === matchId ? socketErrorState.message : null;
  const error = query.data ? null : queryError ?? socketError;

  return useMemo(
    () => ({
      data: query.data ?? null,
      error,
      isConnected,
      isLoading: enabled && Boolean(matchId) && query.isPending && !query.data,
      lastEventAt: query.data?.updatedAt ?? null,
      version:
        typeof query.data?.version === "number" ? query.data.version : null,
    }),
    [
      enabled,
      error,
      isConnected,
      matchId,
      query.data,
      query.isPending,
    ],
  );
}
