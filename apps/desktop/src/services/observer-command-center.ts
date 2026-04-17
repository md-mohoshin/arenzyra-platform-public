import type { ObserverCommandCenterSnapshot } from "../types";

export const COMMAND_CENTER_POLL_INTERVAL_MS = 1250;

const emptyArray = <T,>(): T[] => [];

export const emptyObserverCommandCenterSnapshot: ObserverCommandCenterSnapshot = {
  telemetry: {
    connected: false,
    lastUpdateAt: null,
    mapKey: null,
    playerCount: null,
    phase: null,
    connectionStatus: "stopped",
    matchId: null,
    packetsPerSecond: 0,
    aliveTeams: null,
    gameTime: null,
    circleIndex: null,
    circleStatus: null,
    lastError: null,
    totalPackets: 0,
  },
  widgetServer: {
    running: false,
    port: null,
    host: null,
    path: null,
    clientCount: 0,
    lastBroadcastAt: null,
  },
  mapContext: null,
  mapKey: null,
  recommendation: null,
  cameraAssistPayload: null,
  observerControlSuggestion: null,
  observerOperatorSuggestion: null,
  watchTargets: emptyArray(),
  alerts: emptyArray(),
  replayCandidates: emptyArray(),
  operatorState: null,
  operatorDetails: null,
  operatorWorkflowState: null,
  operatorWorkflowConfig: null,
  pinState: null,
  updatedAt: 0,
};

function buildActionPath(
  pathname: string,
  params: Record<string, string | null | undefined>,
) {
  const url = new URL(pathname, "http://127.0.0.1");
  Object.entries(params).forEach(([key, value]) => {
    const normalized = typeof value === "string" ? value.trim() : value;
    if (normalized) {
      url.searchParams.set(key, normalized);
    }
  });
  const query = url.searchParams.toString();
  return `${url.pathname}${query ? `?${query}` : ""}`;
}

export const observerCommandRoutes = {
  acceptRecommendation(mapKey?: string | null) {
    return buildActionPath("/debug/operator/accept-recommendation", {
      map: mapKey ?? null,
    });
  },
  centerAlert(id: string, mapKey?: string | null) {
    return buildActionPath("/debug/operator/center-alert", { id, map: mapKey ?? null });
  },
  centerReplay(id: string, mapKey?: string | null) {
    return buildActionPath("/debug/operator/center-replay", { id, map: mapKey ?? null });
  },
  centerTarget(id: string, mapKey?: string | null) {
    return buildActionPath("/debug/operator/center-target", { id, map: mapKey ?? null });
  },
  dismissAlert(id: string, mapKey?: string | null) {
    return buildActionPath("/debug/operator/dismiss-alert", { id, map: mapKey ?? null });
  },
  markReplay(id: string, mapKey?: string | null) {
    return buildActionPath("/debug/operator/mark-replay", { id, map: mapKey ?? null });
  },
  pinTarget(id: string, mapKey?: string | null) {
    return buildActionPath("/debug/operator/pin-target", { id, map: mapKey ?? null });
  },
  pinTeam(teamId: string, mapKey?: string | null) {
    return buildActionPath("/debug/observer/pin-team", {
      teamId,
      map: mapKey ?? null,
    });
  },
  removeReplay(id: string, mapKey?: string | null) {
    return buildActionPath("/debug/operator/remove-replay", { id, map: mapKey ?? null });
  },
  resetCameraAssistHistory(mapKey?: string | null) {
    return buildActionPath("/debug/camera-assist/reset-history", {
      map: mapKey ?? null,
    });
  },
  selectAlert(id: string, mapKey?: string | null) {
    return buildActionPath("/debug/operator/select-alert", { id, map: mapKey ?? null });
  },
  selectTarget(id: string, mapKey?: string | null) {
    return buildActionPath("/debug/operator/select-target", { id, map: mapKey ?? null });
  },
  suppressTarget(id: string, mapKey?: string | null) {
    return buildActionPath("/debug/operator/suppress-target", { id, map: mapKey ?? null });
  },
  undismissAlert(id: string, mapKey?: string | null) {
    return buildActionPath("/debug/operator/undismiss-alert", { id, map: mapKey ?? null });
  },
  unmarkReplay(id: string, mapKey?: string | null) {
    return buildActionPath("/debug/operator/unmark-replay", { id, map: mapKey ?? null });
  },
  unpinTarget(id: string, mapKey?: string | null) {
    return buildActionPath("/debug/operator/unpin-target", { id, map: mapKey ?? null });
  },
  unpinTeam(teamId: string, mapKey?: string | null) {
    return buildActionPath("/debug/observer/unpin-team", {
      teamId,
      map: mapKey ?? null,
    });
  },
  unsuppressTarget(id: string, mapKey?: string | null) {
    return buildActionPath("/debug/operator/unsuppress-target", { id, map: mapKey ?? null });
  },
  watchNow(id: string, mapKey?: string | null) {
    return buildActionPath("/debug/operator/watch-now", { id, map: mapKey ?? null });
  },
};
