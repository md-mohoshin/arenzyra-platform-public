import { apiFetch } from "@/lib/api";

export type MatchRuntimeControlSnapshot = {
  matchId: string;
  status?: string | null;
  matchStatus?: string | null;
  lifecycleStatus?: string | null;
  controlStatus?: string | null;
  liveState?: string | null;
  updatedAt?: string | null;
  startedAt?: string | null;
  endedAt?: string | null;
  isLocked?: boolean;
  isFinalizing?: boolean;
  resultFinalized?: boolean;
  resultNeedsConfirmation?: boolean;
  resultAmbiguities?: Array<{
    code?: string | null;
    teamIds?: string[] | null;
    placementFrom?: number | null;
    placementTo?: number | null;
    detectedAt?: string | null;
    message?: string | null;
  }> | null;
  finalizationStartedAt?: string | null;
  finalizationDurationMs?: number | null;
  telemetry?: {
    transportConnected?: boolean;
    packetsReceiving?: boolean;
    telemetryAccepted?: boolean;
    telemetryActive?: boolean;
    lastTransportAt?: string | null;
    lastAcceptedAt?: string | null;
    lastIgnoredAt?: string | null;
    lastIgnoredReason?: string | null;
  } | null;
  binding?: {
    sessionId?: string | null;
    adapterKey?: string | null;
    dataSource?: string | null;
    dataMode?: string | null;
    telemetryProvider?: string | null;
    sourceMode?: string | null;
    boundAt?: string | null;
    lastSeenAt?: string | null;
    isConfigured?: boolean;
    isBound?: boolean;
    isReady?: boolean;
    pcobConfigured?: boolean;
    pcobBound?: boolean;
    pcobReady?: boolean;
  } | null;
};

type MatchRuntimeLifecycleControl = Pick<
  MatchRuntimeControlSnapshot,
  "status" | "matchStatus" | "lifecycleStatus" | "isFinalizing" | "resultFinalized"
>;

function normalizeLifecycleKey(value: string | null | undefined) {
  const normalized = String(value || "").trim().toUpperCase();
  if (!normalized) {
    return null;
  }

  if (normalized === "DRAFT") {
    return "READY";
  }

  return normalized;
}

export async function fetchMatchControlSnapshot(
  matchId: string,
  signal?: AbortSignal,
): Promise<MatchRuntimeControlSnapshot> {
  const response = await apiFetch(
    `/me/matches/${encodeURIComponent(matchId)}/control`,
    {
      cache: "no-store",
      signal,
    },
  );

  if (!response.ok) {
    const message = (await response.text()).trim();
    throw new Error(message || `Failed to load control snapshot (${response.status})`);
  }

  return (await response.json()) as MatchRuntimeControlSnapshot;
}

export async function fetchPublicMatchControlSnapshot(
  matchId: string,
  organizationId: string,
  signal?: AbortSignal,
): Promise<MatchRuntimeControlSnapshot> {
  const response = await apiFetch(
    `/public/matches/${encodeURIComponent(matchId)}/control?${new URLSearchParams({
      organizationId,
    }).toString()}`,
    {
      cache: "no-store",
      signal,
      omitAuth: true,
    },
  );

  if (!response.ok) {
    const message = (await response.text()).trim();
    throw new Error(
      message || `Failed to load public control snapshot (${response.status})`,
    );
  }

  return (await response.json()) as MatchRuntimeControlSnapshot;
}

export async function fetchMatchControlSnapshotMap(
  matchIds: string[],
  signal?: AbortSignal,
): Promise<Record<string, MatchRuntimeControlSnapshot>> {
  const uniqueMatchIds = Array.from(
    new Set(
      matchIds
        .map((matchId) => String(matchId || "").trim())
        .filter(Boolean),
    ),
  );

  if (!uniqueMatchIds.length) {
    return {};
  }

  const results = await Promise.allSettled(
    uniqueMatchIds.map(async (matchId) => {
      const snapshot = await fetchMatchControlSnapshot(matchId, signal);
      return [matchId, snapshot] as const;
    }),
  );

  const snapshots: Record<string, MatchRuntimeControlSnapshot> = {};

  for (const result of results) {
    if (result.status !== "fulfilled") {
      continue;
    }

    const [matchId, snapshot] = result.value;
    snapshots[matchId] = snapshot;
  }

  return snapshots;
}

export function getControlLifecycleStatus(
  control: MatchRuntimeLifecycleControl | null | undefined,
) {
  return normalizeLifecycleKey(
    control?.lifecycleStatus ?? control?.matchStatus ?? control?.status ?? null,
  );
}

export function isControlFinalizing(
  control: MatchRuntimeLifecycleControl | null | undefined,
) {
  if (!control || isControlFinalized(control)) {
    return false;
  }

  return control.isFinalizing === true || getControlLifecycleStatus(control) === "ENDED";
}

export function isControlFinalized(
  control: MatchRuntimeLifecycleControl | null | undefined,
) {
  return (
    control?.resultFinalized === true ||
    getControlLifecycleStatus(control) === "FINISHED"
  );
}

export function isControlLive(
  control: MatchRuntimeLifecycleControl | null | undefined,
) {
  return getControlLifecycleStatus(control) === "LIVE";
}

export function getControlRuntimeBadge(
  control: MatchRuntimeLifecycleControl | null | undefined,
) {
  if (isControlFinalized(control)) {
    return "FINALIZED";
  }

  if (isControlFinalizing(control)) {
    return "FINALIZING";
  }

  const lifecycleStatus = getControlLifecycleStatus(control);
  if (!lifecycleStatus || lifecycleStatus === "READY") {
    return "UPCOMING";
  }

  return lifecycleStatus;
}
