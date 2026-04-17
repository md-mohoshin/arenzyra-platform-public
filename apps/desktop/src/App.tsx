"use client";

import { useEffect, useRef, useState } from "react";
import {
  LauncherAccessDeniedError,
  getErrorMessage,
  isAccessDeniedError,
  isUnauthorizedError,
  launcherConfig,
  launcherApi,
} from "./api/api-client";
import { authService } from "./auth/auth-service";
import {
  DesktopSidebar,
  type DesktopPage,
} from "./components/desktop-sidebar";
import { DashboardScreen } from "./screens/dashboard-screen";
import { LicenseExpiredScreen } from "./screens/license-expired-screen";
import { LicenseSuspendedScreen } from "./screens/license-suspended-screen";
import { LoginScreen } from "./screens/login-screen";
import { ObserverLimitScreen } from "./screens/observer-limit-screen";
import { WidgetsScreen } from "./screens/widgets-screen";
import {
  createEmptyDashboardState,
  hasAuthenticatedSession,
} from "./session/session-manager";
import packageJson from "../package.json";
import { DEFAULT_RENDERER_API_BASE } from "./default-api-base";
import type {
  FileFilter,
  GenerateBrandingResult,
  ConnectorSetupStatus,
  LauncherAccessReason,
  LauncherAccessState,
  LauncherBootstrap,
  LauncherConfig,
  LauncherDefaults,
  LauncherLiveMatch,
  LauncherSession,
  LauncherSlot,
  LauncherSyncCommand,
  LauncherWorkflowState,
  MatchControlSnapshot,
  MatchSummary,
  NextMatchSuggestion,
  ObserverFeedStatus,
  ProductionModeResult,
  StageSummary,
  StatusMessage,
  SyncTeamsResult,
  TelemetryBridgeStatus,
  TelemetrySourceStatus,
  TournamentSummary,
} from "./types";

const LEGACY_STORAGE_KEYS = {
  apiBase: "observer_launcher_api_base",
  email: "observer_launcher_email",
  shadowTrackerPath: "observer_launcher_shadowtracker_path",
};

const LAUNCHER_VERSION = packageJson.version || "0.0.0";

const CURRENT_PCOB_ROOT =
  "C:\\PCOB\\Win64_Release4.3.0_No14_4.3.0.20920_Shipping_OB_Shelled";
const OLDER_SHADOWTRACKER_EXECUTABLE =
  "C:\\PCOB 401\\WindowsNoEditor\\ShadowTrackerExtra\\Binaries\\Win64\\ShadowTrackerExtra.exe";
const LEGACY_SHADOWTRACKER_EXECUTABLE =
  "C:\\PCOB 402\\WindowsNoEditor\\ShadowTrackerExtra\\Binaries\\Win64\\ShadowTrackerExtra.exe";
const CURRENT_SHADOWTRACKER_EXECUTABLE =
  `${CURRENT_PCOB_ROOT}\\WindowsNoEditor\\ShadowTrackerExtra\\Binaries\\Win64\\ShadowTrackerExtra.exe`;
const OLDER_SHADOWTRACKER_PREFIX = "C:\\PCOB 401\\";
const LEGACY_SHADOWTRACKER_PREFIX = "C:\\PCOB 402\\";
const CURRENT_SHADOWTRACKER_PREFIX = `${CURRENT_PCOB_ROOT}\\`;

const FALLBACKS: LauncherDefaults = {
  apiBase: DEFAULT_RENDERER_API_BASE,
  teamAssetsDir: "C:\\ArenzyraObserver\\assets\\teams",
  brandingConfigPath:
    "C:\\Users\\%USERNAME%\\AppData\\Local\\ShadowTrackerExtra\\Saved\\TeamLogoAndColor.ini",
  shadowTrackerPath: "",
};

const DEFAULT_TELEMETRY_STATUS: TelemetryBridgeStatus = {
  running: false,
  matchId: null,
  sessionId: null,
  packetsPerSecond: 0,
  lastPacketTime: null,
  connectionStatus: "stopped",
  phase: null,
  gameTime: null,
  aliveTeams: null,
  circleIndex: null,
  circleStatus: null,
  totalPackets: 0,
  lastError: null,
  connectedToBackend: false,
  queueSize: 0,
  lastSuccessAt: null,
  matchStatus: null,
  isLocked: false,
  isFinalizing: false,
  resultFinalized: false,
  finalizationStartedAt: null,
  finalizationDurationMs: null,
  transportConnected: false,
  packetsReceiving: false,
  telemetryAccepted: false,
  telemetryActive: false,
  lastTransportAt: null,
  lastAcceptedAt: null,
  lastIgnoredAt: null,
  lastIgnoredReason: null,
};

const DEFAULT_OBSERVER_FEED_STATUS: ObserverFeedStatus = {
  enabled: false,
  running: false,
  mode: "off",
  managed: false,
  matchId: null,
  sessionId: null,
  pid: null,
  scriptPath: null,
  ready: false,
  lastError: null,
  lastStartedAt: null,
  lastStoppedAt: null,
};

const DEFAULT_STATUS: StatusMessage = {
  tone: "neutral",
  title: "Authentication required",
  detail:
    "Sign in with your organizer account to load production tournaments and matches.",
};

const LIVE_MATCH_REFRESH_MS = 15_000;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const normalizeStateKey = (value: string | null | undefined) =>
  String(value || "")
    .trim()
    .toUpperCase();

const normalizeMatchLifecycleStatus = (value: string | null | undefined) => {
  const normalized = normalizeStateKey(value);
  if (!normalized) {
    return null;
  }
  if (normalized === "DRAFT") {
    return "READY";
  }
  return normalized;
};

const isMatchLockedStatus = (value: string | null | undefined) =>
  normalizeMatchLifecycleStatus(value) === "FINISHED";

const isMatchFinalizingStatus = (value: string | null | undefined) =>
  ["ENDED", "FINISH_PENDING"].includes(
    normalizeMatchLifecycleStatus(value) ?? "",
  );

const getSelectedTelemetryLifecycleStatus = (
  telemetryStatus: Pick<
    TelemetryBridgeStatus,
    "running" | "matchId" | "matchStatus"
  >,
  selectedMatchId: string,
) =>
  telemetryStatus.running && telemetryStatus.matchId === selectedMatchId
    ? normalizeMatchLifecycleStatus(telemetryStatus.matchStatus)
    : null;

const isMatchStartableLifecycleStatus = (value: string | null | undefined) => {
  const normalized = normalizeMatchLifecycleStatus(value);
  return Boolean(
    normalized &&
      normalized !== "LIVE" &&
      normalized !== "ENDED" &&
      normalized !== "FINISH_PENDING" &&
      normalized !== "FINISHED",
  );
};

const isProductionEligibleLifecycleStatus = (
  value: string | null | undefined,
) => {
  const normalized = normalizeMatchLifecycleStatus(value);
  return Boolean(
    normalized &&
      normalized !== "ENDED" &&
      normalized !== "FINISH_PENDING" &&
      normalized !== "FINISHED",
  );
};

const getControlLifecycleStatus = (
  control: Pick<
    MatchControlSnapshot,
    "lifecycleStatus" | "matchStatus" | "status"
  > | null | undefined,
) =>
  normalizeMatchLifecycleStatus(
    control?.lifecycleStatus ?? control?.matchStatus ?? control?.status ?? null,
  );

const getControlSnapshotTimestamp = (
  control: Pick<MatchControlSnapshot, "updatedAt"> | null | undefined,
) => {
  if (!control?.updatedAt) {
    return null;
  }

  const timestamp = Date.parse(control.updatedAt);
  return Number.isFinite(timestamp) ? timestamp : null;
};

const getActiveSelectedMatchControl = (
  selectedMatchId: string,
  selectedMatchControl: MatchControlSnapshot | null,
  matchControlIndex: Record<string, MatchControlSnapshot>,
) => {
  if (!selectedMatchId) {
    return null;
  }

  const directControl =
    selectedMatchControl?.matchId === selectedMatchId
      ? selectedMatchControl
      : null;
  const indexedControl = matchControlIndex[selectedMatchId] ?? null;

  if (!directControl) {
    return indexedControl;
  }

  if (!indexedControl) {
    return directControl;
  }

  const directTimestamp = getControlSnapshotTimestamp(directControl);
  const indexedTimestamp = getControlSnapshotTimestamp(indexedControl);

  if (
    directTimestamp !== null &&
    indexedTimestamp !== null &&
    indexedTimestamp > directTimestamp
  ) {
    return indexedControl;
  }

  return directControl;
};

const isProductionReadyStatus = (value: string | null | undefined) =>
  value === "READY" || value === "READY_WITH_WARNINGS";

const getMatchLifecycleActionError = (value: string | null | undefined) => {
  if (isMatchFinalizingStatus(value)) {
    return "Match is finalizing. Wait for backend confirmation before changing observer controls.";
  }
  if (isMatchLockedStatus(value)) {
    return "Match is completed and locked. Ask an admin to unlock it before making changes.";
  }
  return null;
};

const isLiveState = (value: string | null | undefined) =>
  normalizeStateKey(value) === "LIVE";

const isLiveTournament = (
  tournament: Pick<TournamentSummary, "liveState" | "status"> | null | undefined,
) => isLiveState(tournament?.liveState) || isLiveState(tournament?.status);

const isLiveStage = (
  stage: Pick<StageSummary, "liveState"> | null | undefined,
) => isLiveState(stage?.liveState);

const isLiveMatch = (
  match: Pick<MatchSummary, "liveState" | "status"> | null | undefined,
) => isLiveState(match?.liveState) || isLiveState(match?.status);

const joinDetailParts = (...parts: Array<string | null | undefined>) =>
  parts
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join(" ");

const formatTelemetrySourceDetail = (
  source: TelemetrySourceStatus | null | undefined,
  sourceError: string | null | undefined,
) => {
  if (sourceError) {
    return `ob.js auto-start skipped: ${sourceError}`;
  }

  if (!source) {
    return "";
  }

  const pidSuffix = source.pid ? ` with PID ${source.pid}` : "";
  const connectorDetail = formatConnectorSetupDetail(source.connector);
  if (source.started) {
    const sourceDetail = source.ready
      ? `ob.js started${pidSuffix}.`
      : `ob.js started${pidSuffix} and is warming up.`;
    return joinDetailParts(connectorDetail, sourceDetail);
  }

  if (source.alreadyRunning) {
    const sourceDetail = source.ready
      ? "ob.js already running."
      : "ob.js already running and is warming up.";
    return joinDetailParts(connectorDetail, sourceDetail);
  }

  return connectorDetail;
};

const formatConnectorSetupDetail = (
  connector: ConnectorSetupStatus | null | undefined,
) => {
  if (!connector) {
    return "";
  }

  if (!connector.ok) {
    return connector.error
      ? `Arenzyra connector setup failed: ${connector.error}`
      : "Arenzyra connector setup failed.";
  }

  if (connector.installed) {
    return connector.repaired
      ? "Arenzyra ob.js connector repaired and backed up the previous file."
      : "Arenzyra ob.js connector installed.";
  }

  if (connector.upToDate) {
    return "Arenzyra ob.js connector is already up to date.";
  }

  return "Arenzyra ob.js connector is ready.";
};

const formatObserverFeedDetail = (
  feed: ObserverFeedStatus | null | undefined,
) => {
  if (!feed) {
    return "";
  }

  const parts = [];
  if (feed.matchId) {
    parts.push(`match ${feed.matchId}`);
  }
  if (feed.pid) {
    parts.push(`PID ${feed.pid}`);
  }
  if (feed.ready) {
    parts.push("endpoint ready");
  } else if (feed.running) {
    parts.push("warming up");
  }

  return parts.join(", ");
};

const getPreferredSelectionId = <T extends { id: string }>(
  items: T[],
  currentId: string,
  preferredId?: string | null,
) => {
  if (items.some((item) => item.id === currentId)) {
    return currentId;
  }

  const normalizedPreferredId = String(preferredId || "").trim();
  if (normalizedPreferredId && items.some((item) => item.id === normalizedPreferredId)) {
    return normalizedPreferredId;
  }

  return items[0]?.id ?? "";
};

const findPreferredLiveMatch = (
  matches: MatchSummary[],
  matchControls: Record<string, MatchControlSnapshot>,
  resolvedLiveMatchId?: string | null,
) => {
  const normalizedResolvedLiveMatchId = String(resolvedLiveMatchId || "").trim();
  if (normalizedResolvedLiveMatchId) {
    const resolvedLiveMatch =
      matches.find((match) => match.id === normalizedResolvedLiveMatchId) || null;
    if (resolvedLiveMatch) {
      return resolvedLiveMatch;
    }
  }

  return (
    matches.find(
      (match) =>
        getControlLifecycleStatus(matchControls[match.id] ?? null) === "LIVE",
    ) ||
    matches.find((match) => isLiveMatch(match)) ||
    null
  );
};

const shouldPreferLiveMatchSelection = (
  currentMatch: MatchSummary | null,
  matchControls: Record<string, MatchControlSnapshot>,
  preferredLiveMatchId?: string | null,
) => {
  const normalizedPreferredLiveMatchId = String(preferredLiveMatchId || "").trim();
  if (!normalizedPreferredLiveMatchId) {
    return false;
  }

  if (!currentMatch) {
    return true;
  }

  if (currentMatch.id === normalizedPreferredLiveMatchId) {
    return false;
  }

  const currentControl = matchControls[currentMatch.id] ?? null;
  const currentLifecycleStatus = getControlLifecycleStatus(currentControl);
  const currentIsLive =
    currentLifecycleStatus === "LIVE" || isLiveMatch(currentMatch);

  return (
    !currentIsLive ||
    currentControl?.isFinalizing === true ||
    currentControl?.isLocked === true ||
    isMatchLockedStatus(currentLifecycleStatus)
  );
};

const findPreferredStageId = (
  stages: StageSummary[],
  matches: MatchSummary[],
  matchControls: Record<string, MatchControlSnapshot>,
  resolvedLiveMatchId?: string | null,
) => {
  const liveMatch = findPreferredLiveMatch(
    matches,
    matchControls,
    resolvedLiveMatchId,
  );
  if (
    liveMatch?.stageId &&
    stages.some((stage) => stage.id === liveMatch.stageId)
  ) {
    return liveMatch.stageId;
  }

  return stages[0]?.id ?? "";
};

const findPreferredTournamentId = (tournaments: TournamentSummary[]) =>
  tournaments.find((tournament) => isLiveTournament(tournament))?.id ?? "";

const normalizeOptionalApiBase = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  try {
    return new URL(
      trimmed.includes("://") ? trimmed : `http://${trimmed}`,
    )
      .toString()
      .replace(/\/$/, "");
  } catch {
    return "";
  }
};

const normalizeApiBase = (value: string) =>
  normalizeOptionalApiBase(value) || FALLBACKS.apiBase;

const getRememberedEmailFromConfig = (
  config: Pick<LauncherConfig, "settings"> | null | undefined,
) =>
  String(config?.settings?.rememberedEmail || "")
    .trim()
    .toLowerCase();

const getKeepSignedInFromConfig = (
  config: Pick<LauncherConfig, "settings"> | null | undefined,
) => config?.settings?.keepSignedIn !== false;

const pathExistsOnDisk = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }

  return launcherConfig.pathExists(trimmed);
};

const fileExistsOnDisk = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }

  return launcherConfig.isFile(trimmed);
};

const getShadowTrackerCandidatesForInput = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) {
    return [];
  }

  return Array.from(
    new Set([
      trimmed,
      `${trimmed}.exe`,
      `${trimmed}\\ShadowTrackerExtra.exe`,
      `${trimmed}\\Binaries\\Win64\\ShadowTrackerExtra.exe`,
      `${trimmed}\\ShadowTrackerExtra\\Binaries\\Win64\\ShadowTrackerExtra.exe`,
      `${trimmed}\\WindowsNoEditor\\ShadowTrackerExtra\\Binaries\\Win64\\ShadowTrackerExtra.exe`,
    ]),
  );
};

const migrateLegacyShadowTrackerPrefix = (value: string) => {
  if (value.startsWith(OLDER_SHADOWTRACKER_PREFIX)) {
    return value.replace(
      OLDER_SHADOWTRACKER_PREFIX,
      CURRENT_SHADOWTRACKER_PREFIX,
    );
  }
  if (value.startsWith(LEGACY_SHADOWTRACKER_PREFIX)) {
    return value.replace(
      LEGACY_SHADOWTRACKER_PREFIX,
      CURRENT_SHADOWTRACKER_PREFIX,
    );
  }
  return value;
};

const migrateShadowTrackerPath = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  if (
    trimmed === OLDER_SHADOWTRACKER_EXECUTABLE ||
    trimmed === LEGACY_SHADOWTRACKER_EXECUTABLE
  ) {
    return CURRENT_SHADOWTRACKER_EXECUTABLE;
  }
  const migratedPath = migrateLegacyShadowTrackerPrefix(trimmed);
  if (migratedPath !== trimmed) {
    return migratedPath;
  }

  return (
    getShadowTrackerCandidatesForInput(trimmed).find(fileExistsOnDisk) || trimmed
  );
};

const hasAllowedLauncherAccess = (access: LauncherAccessState | null) =>
  access?.allowed === true;

const getBlockedStatus = (
  access: LauncherAccessState | null,
): StatusMessage => {
  switch (access?.reason) {
    case "LICENSE_SUSPENDED":
      return {
        tone: "error",
        title: "License suspended",
        detail:
          "Launcher access is blocked for this organization. Contact Arenzyra support.",
      };
    case "OBSERVER_LIMIT_REACHED":
      return {
        tone: "error",
        title: "Observer limit reached",
        detail: `Active observers: ${access.activeSessions ?? "--"} / ${
          access.maxObservers ?? access.license?.maxObservers ?? "--"
        }. End another launcher session before retrying.`,
      };
    case "LICENSE_MISSING":
      return {
        tone: "error",
        title: "License required",
        detail:
          "No active Arenzyra production license is assigned to this organization.",
      };
    case "LICENSE_EXPIRED":
    default:
      return {
        tone: "error",
        title: "License expired",
        detail:
          "The Arenzyra production license for this organization is no longer valid.",
      };
  }
};

export default function App() {
  const [booting, setBooting] = useState(true);
  const [configLoaded, setConfigLoaded] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [apiBase, setApiBase] = useState(FALLBACKS.apiBase);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [keepSignedIn, setKeepSignedIn] = useState(true);
  const [session, setSession] = useState<LauncherSession | null>(null);
  const [access, setAccess] = useState<LauncherAccessState | null>(null);
  const [shadowTrackerPath, setShadowTrackerPath] = useState("");
  const [teamAssetsDir, setTeamAssetsDir] = useState(FALLBACKS.teamAssetsDir);
  const [brandingConfigPath, setBrandingConfigPath] = useState(
    FALLBACKS.brandingConfigPath,
  );
  const [telemetryBridgeAvailable, setTelemetryBridgeAvailable] = useState(false);
  const [telemetryStatus, setTelemetryStatus] = useState<TelemetryBridgeStatus>(
    DEFAULT_TELEMETRY_STATUS,
  );
  const [observerFeedStatus, setObserverFeedStatus] =
    useState<ObserverFeedStatus>(DEFAULT_OBSERVER_FEED_STATUS);
  const [selectedMatchControl, setSelectedMatchControl] =
    useState<MatchControlSnapshot | null>(null);
  const [matchControlIndex, setMatchControlIndex] = useState<
    Record<string, MatchControlSnapshot>
  >({});
  const [status, setStatus] = useState<StatusMessage>(DEFAULT_STATUS);
  const [slots, setSlots] = useState<LauncherSlot[]>([]);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [loadingMatch, setLoadingMatch] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState<string | null>(null);
  const [liveMatch, setLiveMatch] = useState<LauncherLiveMatch | null>(null);
  const [dashboard, setDashboard] = useState(createEmptyDashboardState());
  const [activePage, setActivePage] = useState<DesktopPage>("launcher");
  const [finishedMatchId, setFinishedMatchId] = useState<string | null>(null);
  const [nextMatchSuggestion, setNextMatchSuggestion] =
    useState<NextMatchSuggestion | null>(null);
  const [nextMatchLoading, setNextMatchLoading] = useState(false);
  const [nextMatchError, setNextMatchError] = useState<string | null>(null);
  const [workflowState, setWorkflowState] =
    useState<LauncherWorkflowState>("NO_MATCH");
  const [nextMatchSuggestedId, setNextMatchSuggestedId] = useState<string | null>(
    null,
  );
  const [preparedMatchId, setPreparedMatchId] = useState<string | null>(null);
  const [productionModeResult, setProductionModeResult] =
    useState<ProductionModeResult | null>(null);
  const lastFinishedLogRef = useRef<string | null>(null);
  const lastSuggestedLogRef = useRef<string | null>(null);

  const resetDashboard = () => {
    const emptyState = createEmptyDashboardState();
    setDashboard(emptyState);
    setSelectedMatchControl(null);
    setMatchControlIndex({});
    setSlots([]);
    setLastSyncTime(null);
    setFinishedMatchId(null);
    setNextMatchSuggestion(null);
    setNextMatchLoading(false);
    setNextMatchError(null);
    setWorkflowState("NO_MATCH");
    setNextMatchSuggestedId(null);
    setPreparedMatchId(null);
    setProductionModeResult(null);
    lastFinishedLogRef.current = null;
    lastSuggestedLogRef.current = null;
  };

  const applyConfigSnapshot = (config: LauncherConfig) => {
    setApiBase(normalizeApiBase(config.apiBase || FALLBACKS.apiBase));
    setKeepSignedIn(getKeepSignedInFromConfig(config));
    setShadowTrackerPath(
      migrateShadowTrackerPath(config.shadowTrackerPath || ""),
    );
    setEmail((current) => {
      const rememberedEmail = getRememberedEmailFromConfig(config);
      if (!rememberedEmail) {
        return current;
      }
      if (
        hasAuthenticatedSession(session) &&
        typeof session.user?.email === "string" &&
        session.user.email.trim()
      ) {
        return current;
      }
      return current || rememberedEmail;
    });
  };

  const applyBootstrapPayload = (
    bootstrap: LauncherBootstrap,
    preferredShadowTrackerPath = "",
  ) => {
    const resolvedApiBase = normalizeApiBase(bootstrap.apiBase || apiBase);
    setApiBase(resolvedApiBase);
    setTeamAssetsDir(bootstrap.teamAssetsDir || FALLBACKS.teamAssetsDir);
    setBrandingConfigPath(
      bootstrap.brandingConfigPath || FALLBACKS.brandingConfigPath,
    );
    setTelemetryBridgeAvailable(bootstrap.telemetryBridgeAvailable === true);

    const resolvedShadowTrackerPath =
      preferredShadowTrackerPath ||
      shadowTrackerPath ||
      migrateShadowTrackerPath(bootstrap.shadowTrackerPath || "");
    if (resolvedShadowTrackerPath) {
      setShadowTrackerPath(resolvedShadowTrackerPath);
    }

    const rememberedEmail =
      typeof bootstrap.session?.user?.email === "string"
        ? bootstrap.session.user.email.trim()
        : "";
    if (rememberedEmail) {
      setEmail(rememberedEmail);
    }

    setSession(bootstrap.session);
    setAccess(bootstrap.access);
    setAuthError(null);

    if (!bootstrap.session) {
      setLiveMatch(null);
      setStatus(DEFAULT_STATUS);
      return;
    }

    if (bootstrap.access?.allowed) {
      setStatus({
        tone: "success",
        title: "Authenticated",
        detail:
          "Organizer login succeeded. Loading production matches.",
      });
      return;
    }

    setStatus(getBlockedStatus(bootstrap.access));
  };

  const handleUnauthorized = (message = "Session expired. Please log in again.") => {
    setAuthBusy(false);
    setSession(null);
    setAccess(null);
    setPassword("");
    setLiveMatch(null);
    setAuthError(message);
    setBusyAction(null);
    setLoadingMatch(false);
    setTelemetryStatus(DEFAULT_TELEMETRY_STATUS);
    setObserverFeedStatus(DEFAULT_OBSERVER_FEED_STATUS);
    resetDashboard();
    setStatus({
      tone: "error",
      title: "Authentication required",
      detail: message,
    });
  };

  const handleAccessDenied = (error: unknown) => {
    const deniedError =
      error instanceof LauncherAccessDeniedError ? error : null;
    const nextReason: LauncherAccessReason =
      deniedError?.reason || access?.reason || "LICENSE_INVALID";
    const nextAccess: LauncherAccessState = access
      ? {
          ...access,
          allowed: false,
          reason: nextReason,
        }
      : {
          allowed: false,
          reason: nextReason,
          license: null,
          machineId: "",
          activeSessions: null,
          maxObservers: null,
        };

    setAccess(nextAccess);
    setLiveMatch(null);
    setBusyAction(null);
    setLoadingMatch(false);
    setTelemetryStatus(DEFAULT_TELEMETRY_STATUS);
    setObserverFeedStatus(DEFAULT_OBSERVER_FEED_STATUS);
    resetDashboard();
    setStatus(getBlockedStatus(nextAccess));
  };

  const refreshLiveMatchWithBase = async (nextApiBase?: string | null) => {
    if (!hasAuthenticatedSession(session) || !hasAllowedLauncherAccess(access)) {
      return;
    }

    try {
      const nextLiveMatch = await launcherApi.getLiveMatch(
        normalizeApiBase(nextApiBase || apiBase),
      );
      setLiveMatch(nextLiveMatch);
    } catch {
      // background polling handles transient failures
    }
  };

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        let config = await launcherConfig.getConfig();
        const legacyApiBase =
          window.localStorage.getItem(LEGACY_STORAGE_KEYS.apiBase) ?? "";
        const legacyEmail =
          window.localStorage.getItem(LEGACY_STORAGE_KEYS.email) ?? "";
        let legacyShadowTrackerPath = migrateShadowTrackerPath(
          window.localStorage.getItem(LEGACY_STORAGE_KEYS.shadowTrackerPath) ?? "",
        );
        let migrated = false;

        const shouldMigrateApiBase =
          !config.apiBaseOverride &&
          (() => {
            const normalizedLegacyApiBase = normalizeOptionalApiBase(legacyApiBase);
            if (!normalizedLegacyApiBase) {
              return false;
            }
            if (normalizedLegacyApiBase !== FALLBACKS.apiBase) {
              return true;
            }
            return config.apiBaseSource === "fallback";
          })();

        if (shouldMigrateApiBase) {
          config = await launcherConfig.setConfig(
            "apiBase",
            normalizeOptionalApiBase(legacyApiBase),
          );
          migrated = true;
        }
        if (legacyApiBase) {
          window.localStorage.removeItem(LEGACY_STORAGE_KEYS.apiBase);
        }

        if (legacyShadowTrackerPath && !pathExistsOnDisk(legacyShadowTrackerPath)) {
          legacyShadowTrackerPath = "";
        }
        if (legacyShadowTrackerPath && !config.shadowTrackerPath) {
          config = await launcherConfig.setConfig(
            "shadowTrackerPath",
            legacyShadowTrackerPath,
          );
          migrated = true;
        }
        if (window.localStorage.getItem(LEGACY_STORAGE_KEYS.shadowTrackerPath) !== null) {
          window.localStorage.removeItem(LEGACY_STORAGE_KEYS.shadowTrackerPath);
        }

        const normalizedLegacyEmail = legacyEmail.trim().toLowerCase();
        if (normalizedLegacyEmail && !getRememberedEmailFromConfig(config)) {
          config = await launcherConfig.setConfig("settings", {
            rememberedEmail: normalizedLegacyEmail,
          });
          migrated = true;
        }
        if (legacyEmail) {
          window.localStorage.removeItem(LEGACY_STORAGE_KEYS.email);
        }

        if (migrated) {
          console.log("[Migration] Moved localStorage config â†’ configManager");
        }

        if (cancelled) {
          return;
        }

        applyConfigSnapshot(config);
        const bootstrap = await authService.bootstrap(
          config.apiBase || FALLBACKS.apiBase,
        );
        if (cancelled) {
          return;
        }

        applyBootstrapPayload(
          bootstrap,
          migrateShadowTrackerPath(config.shadowTrackerPath || ""),
        );
      } catch (error) {
        if (cancelled) {
          return;
        }

        setTelemetryBridgeAvailable(false);
        setAuthError(getErrorMessage(error));
        setStatus({
          tone: "error",
          title: "Launcher unavailable",
          detail: getErrorMessage(error),
        });
      } finally {
        if (!cancelled) {
          setConfigLoaded(true);
          setBooting(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return launcherConfig.subscribeConfig((nextConfig) => {
      applyConfigSnapshot(nextConfig);
    });
  }, [session]);

  useEffect(() => {
    if (!configLoaded) {
      return;
    }

    const timer = window.setTimeout(() => {
      const normalizedApiBase = normalizeOptionalApiBase(apiBase);
      if (!apiBase.trim()) {
        void launcherConfig.setConfig("apiBase", "");
        return;
      }
      if (!normalizedApiBase) {
        return;
      }
      void launcherConfig.setConfig("apiBase", normalizedApiBase);
    }, 250);

    return () => {
      window.clearTimeout(timer);
    };
  }, [apiBase, configLoaded]);

  useEffect(() => {
    if (!configLoaded) {
      return;
    }

    void launcherConfig.setConfig(
      "shadowTrackerPath",
      migrateShadowTrackerPath(shadowTrackerPath),
    );
  }, [configLoaded, shadowTrackerPath]);

  useEffect(() => {
    if (hasAllowedLauncherAccess(access)) {
      return;
    }

    setLiveMatch(null);
    setTelemetryStatus(DEFAULT_TELEMETRY_STATUS);
  }, [access]);

  useEffect(() => {
    if (!hasAuthenticatedSession(session) || !hasAllowedLauncherAccess(access)) {
      setLiveMatch(null);
      return;
    }

    let cancelled = false;

    const refreshLiveMatch = async () => {
      try {
        const nextLiveMatch = await launcherApi.getLiveMatch(apiBase);
        if (!cancelled) {
          setLiveMatch(nextLiveMatch);
        }
      } catch (error) {
        if (cancelled) {
          return;
        }
        if (isUnauthorizedError(error)) {
          handleUnauthorized();
          return;
        }
        if (isAccessDeniedError(error)) {
          handleAccessDenied(error);
          return;
        }
        setLiveMatch(null);
      }
    };

    void refreshLiveMatch();
    const timer = window.setInterval(() => {
      void refreshLiveMatch();
    }, LIVE_MATCH_REFRESH_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [session, access, apiBase]);

  useEffect(() => {
    let cancelled = false;

    const applyCommand = async (command: LauncherSyncCommand | null) => {
      if (!command?.matchId || cancelled) {
        return;
      }

      setStatus({
        tone: "neutral",
        title: "Launcher syncing",
        detail: `Loading match ${command.matchId} from the control panel.`,
      });

      if (!hasAuthenticatedSession(session) || !hasAllowedLauncherAccess(access)) {
        return;
      }

      const nextApiBase = normalizeApiBase(command.apiBase || apiBase);
      if (nextApiBase !== apiBase) {
        setApiBase(nextApiBase);
      }

      try {
        const tournaments = await launcherApi.listTournaments();
        if (cancelled) return;

        if (command.tournamentId) {
          const [stages, matches] = await Promise.all([
            launcherApi.listStages(command.tournamentId),
            launcherApi.listMatches(command.tournamentId),
          ]);
          if (cancelled) return;

          const targetMatch = matches.find((match) => match.id === command.matchId) || null;
          setDashboard((current) => ({
            ...current,
            tournaments,
            stages,
            matches,
            selectedTournamentId: command.tournamentId || current.selectedTournamentId,
            selectedStageId: targetMatch?.stageId ?? current.selectedStageId,
            selectedMatchId: command.matchId,
          }));
        } else {
          setDashboard((current) => ({
            ...current,
            tournaments,
            selectedMatchId: command.matchId,
          }));
        }

        await refreshLiveMatchWithBase(nextApiBase);
      } catch (error) {
        if (cancelled) return;
        if (isUnauthorizedError(error)) {
          handleUnauthorized();
          return;
        }
        if (isAccessDeniedError(error)) {
          handleAccessDenied(error);
          return;
        }
        setStatus({
          tone: "error",
          title: "Launcher sync failed",
          detail: getErrorMessage(error),
        });
      }
    };

    const consumePending = async () => {
      try {
        const command = await launcherApi.consumePendingSyncCommand();
        await applyCommand(command);
      } catch {
        // launcher bootstraps normally if sync consumption fails
      }
    };

    void consumePending();
    const unsubscribe = launcherApi.onSyncPending(() => {
      void consumePending();
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [session, access, apiBase]);

  useEffect(() => {
    if (
      !hasAuthenticatedSession(session) ||
      !hasAllowedLauncherAccess(access) ||
      !telemetryBridgeAvailable
    ) {
      setTelemetryStatus(DEFAULT_TELEMETRY_STATUS);
      return;
    }

    let cancelled = false;

    const refreshTelemetryStatus = async () => {
      try {
        const nextStatus = await launcherApi.getTelemetryStatus();
        if (!cancelled) {
          setTelemetryStatus(nextStatus || DEFAULT_TELEMETRY_STATUS);
        }
      } catch (error) {
        if (!cancelled) {
          setTelemetryStatus(DEFAULT_TELEMETRY_STATUS);
          if (isUnauthorizedError(error)) {
            handleUnauthorized();
            return;
          }
          if (isAccessDeniedError(error)) {
            handleAccessDenied(error);
            return;
          }
          setStatus({
            tone: "error",
            title: "Telemetry unavailable",
            detail: getErrorMessage(error),
          });
        }
      }
    };

    void refreshTelemetryStatus();
    const timer = window.setInterval(() => {
      void refreshTelemetryStatus();
    }, 1000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [session, access, telemetryBridgeAvailable]);

  useEffect(() => {
    if (
      !hasAuthenticatedSession(session) ||
      !hasAllowedLauncherAccess(access) ||
      !telemetryBridgeAvailable
    ) {
      setObserverFeedStatus(DEFAULT_OBSERVER_FEED_STATUS);
      return;
    }

    let cancelled = false;

    const refreshObserverFeedStatus = async () => {
      try {
        const nextStatus = await launcherApi.getObserverFeedStatus();
        if (!cancelled) {
          setObserverFeedStatus(nextStatus || DEFAULT_OBSERVER_FEED_STATUS);
        }
      } catch (error) {
        if (!cancelled) {
          setObserverFeedStatus(DEFAULT_OBSERVER_FEED_STATUS);
          if (isUnauthorizedError(error)) {
            handleUnauthorized();
            return;
          }
          if (isAccessDeniedError(error)) {
            handleAccessDenied(error);
          }
        }
      }
    };

    void refreshObserverFeedStatus();
    const timer = window.setInterval(() => {
      void refreshObserverFeedStatus();
    }, 1000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [session, access, telemetryBridgeAvailable]);

  useEffect(() => {
    if (
      !hasAuthenticatedSession(session) ||
      !hasAllowedLauncherAccess(access) ||
      !dashboard.selectedMatchId
    ) {
      setSelectedMatchControl(null);
      return;
    }

    let cancelled = false;
    const selectedMatchId = dashboard.selectedMatchId;

    const refreshSelectedMatchControl = async () => {
      try {
        const nextControl = await launcherApi.getMatchControl(selectedMatchId);
        if (!cancelled && dashboard.selectedMatchId === selectedMatchId) {
          setSelectedMatchControl(nextControl);
        }
      } catch {
        // Keep the last successful /control snapshot during transient polling failures.
      }
    };

    void refreshSelectedMatchControl();
    const timer = window.setInterval(() => {
      void refreshSelectedMatchControl();
    }, 3000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [session, access, dashboard.selectedMatchId]);

  useEffect(() => {
    if (!selectedMatchControl?.matchId) {
      return;
    }

    setMatchControlIndex((current) => ({
      ...current,
      [selectedMatchControl.matchId]: selectedMatchControl,
    }));
  }, [selectedMatchControl]);

  useEffect(() => {
    if (
      !hasAuthenticatedSession(session) ||
      !hasAllowedLauncherAccess(access) ||
      !dashboard.matches.length
    ) {
      setMatchControlIndex({});
      return;
    }

    let cancelled = false;
    const matchIds = dashboard.matches.map((match) => match.id);

    const refreshMatchControls = async () => {
      const results = await Promise.all(
        matchIds.map(async (matchId) => {
          try {
            return [matchId, await launcherApi.getMatchControl(matchId)] as const;
          } catch {
            return null;
          }
        }),
      );

      if (cancelled) {
        return;
      }

      const nextControls: Record<string, MatchControlSnapshot> = {};
      for (const result of results) {
        if (!result) {
          continue;
        }

        nextControls[result[0]] = result[1];
      }

      setMatchControlIndex(nextControls);
    };

    void refreshMatchControls();
    const timer = window.setInterval(() => {
      void refreshMatchControls();
    }, LIVE_MATCH_REFRESH_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [session, access, dashboard.matches]);

  const selectedMatch =
    dashboard.matches.find((match) => match.id === dashboard.selectedMatchId) || null;
  const activeSelectedMatchControl = getActiveSelectedMatchControl(
    dashboard.selectedMatchId,
    selectedMatchControl,
    matchControlIndex,
  );
  const selectedMatchLifecycleStatus =
    getControlLifecycleStatus(activeSelectedMatchControl) ||
    getSelectedTelemetryLifecycleStatus(
      telemetryStatus,
      dashboard.selectedMatchId,
    );
  const selectedMatchLocked =
    activeSelectedMatchControl?.isLocked === true ||
    isMatchLockedStatus(selectedMatchLifecycleStatus);
  const selectedMatchFinalizing =
    activeSelectedMatchControl?.isFinalizing === true ||
    isMatchFinalizingStatus(selectedMatchLifecycleStatus);

  useEffect(() => {
    if (!dashboard.selectedMatchId) {
      return;
    }

    if (selectedMatchFinalizing) {
      setStatus({
        tone: "neutral",
        title: "Finalizing match...",
        detail:
          "Backend detected match end and is confirming the result. Observer controls stay read-only until the match is finished or unlocked.",
      });
      return;
    }

    if (selectedMatchLocked) {
      setStatus({
        tone: "neutral",
        title: "Match Locked",
        detail:
          "Backend locked this match. Telemetry cannot restart until an admin unlocks it.",
      });
    }
  }, [
    dashboard.selectedMatchId,
    selectedMatchFinalizing,
    selectedMatchLocked,
  ]);

  useEffect(() => {
    if (
      !hasAuthenticatedSession(session) ||
      !hasAllowedLauncherAccess(access) ||
      !dashboard.selectedMatchId
    ) {
      setFinishedMatchId(null);
      setNextMatchSuggestion(null);
      setNextMatchLoading(false);
      setNextMatchError(null);
      setNextMatchSuggestedId(null);
      return;
    }

    if (!selectedMatchLocked) {
      setFinishedMatchId(null);
      setNextMatchSuggestion(null);
      setNextMatchLoading(false);
      setNextMatchError(null);
      setNextMatchSuggestedId(null);
      lastSuggestedLogRef.current = null;
      return;
    }

    let cancelled = false;
    const currentFinishedMatchId = dashboard.selectedMatchId;
    setFinishedMatchId(currentFinishedMatchId);

    const refreshNextMatchSuggestion = async (showLoading: boolean) => {
      if (showLoading) {
        setNextMatchLoading(true);
      }
      setNextMatchError(null);

      try {
        const suggestion =
          await launcherApi.getNextMatchSuggestion(currentFinishedMatchId);
        if (cancelled) {
          return;
        }
        setFinishedMatchId(currentFinishedMatchId);
        setNextMatchSuggestion(suggestion);
        setNextMatchSuggestedId(suggestion.nextMatch?.id ?? null);
        if (suggestion.nextMatch?.id) {
          setWorkflowState("NEXT_MATCH_AVAILABLE");
          const logKey = [
            currentFinishedMatchId,
            suggestion.nextMatch.id,
          ].join(":");
          if (lastSuggestedLogRef.current !== logKey) {
            lastSuggestedLogRef.current = logKey;
            console.info(
              `[Flow] Next match suggested: currentMatchId=${currentFinishedMatchId} nextMatchId=${suggestion.nextMatch.id}`,
            );
          }
        } else {
          lastSuggestedLogRef.current = null;
        }
      } catch (error) {
        if (cancelled) {
          return;
        }
        if (isUnauthorizedError(error)) {
          handleUnauthorized();
          return;
        }
        if (isAccessDeniedError(error)) {
          handleAccessDenied(error);
          return;
        }
        setNextMatchSuggestion(null);
        setNextMatchError(getErrorMessage(error));
        setNextMatchSuggestedId(null);
        lastSuggestedLogRef.current = null;
      } finally {
        if (!cancelled) {
          setNextMatchLoading(false);
        }
      }
    };

    void refreshNextMatchSuggestion(true);
    const timer = window.setInterval(() => {
      void refreshNextMatchSuggestion(false);
    }, LIVE_MATCH_REFRESH_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [
    session,
    access,
    dashboard.selectedMatchId,
    selectedMatchLifecycleStatus,
  ]);

  useEffect(() => {
    if (!hasAuthenticatedSession(session) || !hasAllowedLauncherAccess(access)) {
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const tournaments = await launcherApi.listTournaments();
        if (cancelled) {
          return;
        }
        setDashboard((current) => ({
          ...current,
          tournaments,
        }));
        if (!tournaments.length) {
          setStatus({
            tone: "neutral",
            title: "No tournaments",
            detail:
              "Your organizer account is authenticated, but no tournaments were found for this organization.",
          });
        }
      } catch (error) {
        if (cancelled) {
          return;
        }
        if (isUnauthorizedError(error)) {
          handleUnauthorized();
          return;
        }
        if (isAccessDeniedError(error)) {
          handleAccessDenied(error);
          return;
        }
        setStatus({
          tone: "error",
          title: "Tournaments unavailable",
          detail: getErrorMessage(error),
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [session, access]);

  useEffect(() => {
    if (!dashboard.tournaments.length) {
      if (dashboard.selectedTournamentId) {
        setDashboard((current) => ({
          ...current,
          selectedTournamentId: "",
        }));
      }
      return;
    }

    const nextTournamentId = getPreferredSelectionId(
      dashboard.tournaments,
      dashboard.selectedTournamentId,
      findPreferredTournamentId(dashboard.tournaments),
    );

    if (nextTournamentId !== dashboard.selectedTournamentId) {
      setDashboard((current) => ({
        ...current,
        selectedTournamentId: nextTournamentId,
      }));
    }
  }, [dashboard.tournaments, dashboard.selectedTournamentId]);

  useEffect(() => {
    if (
      !hasAuthenticatedSession(session) ||
      !hasAllowedLauncherAccess(access) ||
      !dashboard.selectedTournamentId
    ) {
      setDashboard((current) => ({
        ...current,
        stages: [],
        matches: [],
        selectedStageId: "",
        selectedMatchId: "",
      }));
      setSlots([]);
      return;
    }

    let cancelled = false;
    let initialized = false;
    const selectedTournamentId = dashboard.selectedTournamentId;

    setDashboard((current) => ({
      ...current,
      stages: [],
      matches: [],
      selectedStageId: "",
      selectedMatchId: "",
    }));
    setSlots([]);

    const refreshTournamentData = async () => {
      try {
        const [stages, matches] = await Promise.all([
          launcherApi.listStages(selectedTournamentId),
          launcherApi.listMatches(selectedTournamentId),
        ]);
        if (cancelled) {
          return;
        }

        setDashboard((current) =>
          current.selectedTournamentId !== selectedTournamentId
            ? current
            : {
                ...current,
                stages,
                matches,
              },
        );
        if (!initialized) {
          initialized = true;
          setStatus({
            tone: "neutral",
            title: "Tournament loaded",
            detail:
              "Live production matches are auto-detected when available. You can still change the selection manually.",
          });
        }
      } catch (error) {
        if (cancelled) {
          return;
        }
        if (isUnauthorizedError(error)) {
          handleUnauthorized();
          return;
        }
        if (isAccessDeniedError(error)) {
          handleAccessDenied(error);
          return;
        }
        setStatus({
          tone: "error",
          title: "Tournament data unavailable",
          detail: getErrorMessage(error),
        });
      }
    };

    void refreshTournamentData();
    const timer = window.setInterval(() => {
      void refreshTournamentData();
    }, LIVE_MATCH_REFRESH_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [session, access, dashboard.selectedTournamentId]);

  useEffect(() => {
    if (!dashboard.stages.length) {
      if (dashboard.selectedStageId) {
        setDashboard((current) => ({
          ...current,
          selectedStageId: "",
        }));
      }
      return;
    }

    const currentSelectedMatch =
      dashboard.matches.find((match) => match.id === dashboard.selectedMatchId) || null;
    const preferredLiveMatch = findPreferredLiveMatch(
      dashboard.matches,
      matchControlIndex,
      liveMatch?.matchId,
    );
    const preferredStageId =
      shouldPreferLiveMatchSelection(
        currentSelectedMatch,
        matchControlIndex,
        preferredLiveMatch?.id,
      )
        ? preferredLiveMatch?.stageId || ""
        : findPreferredStageId(
            dashboard.stages,
            dashboard.matches,
            matchControlIndex,
            liveMatch?.matchId,
          );
    const nextStageId = getPreferredSelectionId(
      dashboard.stages,
      dashboard.selectedStageId,
      preferredStageId,
    );

    if (nextStageId !== dashboard.selectedStageId) {
      setDashboard((current) => ({
        ...current,
        selectedStageId: nextStageId,
      }));
    }
  }, [
    dashboard.stages,
    dashboard.matches,
    matchControlIndex,
    liveMatch?.matchId,
    dashboard.selectedStageId,
    dashboard.selectedMatchId,
  ]);

  useEffect(() => {
    const filteredMatches = dashboard.selectedStageId
      ? dashboard.matches.filter(
          (match) => match.stageId === dashboard.selectedStageId,
        )
      : dashboard.matches;

    if (!filteredMatches.length) {
      if (dashboard.selectedMatchId) {
        setDashboard((current) => ({
          ...current,
          selectedMatchId: "",
        }));
      }
      setSlots([]);
      return;
    }

    const currentSelectedMatch =
      filteredMatches.find((match) => match.id === dashboard.selectedMatchId) || null;
    const preferredLiveMatchId = findPreferredLiveMatch(
      filteredMatches,
      matchControlIndex,
      liveMatch?.matchId,
    )?.id;
    const nextMatchId = getPreferredSelectionId(
      filteredMatches,
      shouldPreferLiveMatchSelection(
        currentSelectedMatch,
        matchControlIndex,
        preferredLiveMatchId,
      )
        ? ""
        : dashboard.selectedMatchId,
      preferredLiveMatchId ?? "",
    );

    if (nextMatchId !== dashboard.selectedMatchId) {
      setDashboard((current) => ({
        ...current,
        selectedMatchId: nextMatchId,
      }));
    }
  }, [
    dashboard.matches,
    matchControlIndex,
    liveMatch?.matchId,
    dashboard.selectedStageId,
    dashboard.selectedMatchId,
  ]);

  const applySyncResult = (
    result: SyncTeamsResult,
    nextTitle: string,
    nextDetail: string,
  ) => {
    setSlots(result.slots || []);
    setTeamAssetsDir(result.teamAssetsDir || FALLBACKS.teamAssetsDir);
    setLastSyncTime(new Date().toISOString());
    setStatus({
      tone: "success",
      title: nextTitle,
      detail: nextDetail,
    });
  };

  const formatSyncDetail = (result: SyncTeamsResult, baseDetail: string) => {
    const photoSync = result.playerPhotoSync;
    const photoDetail = photoSync
      ? ` Player photos cached: ${photoSync.syncedCount}/${photoSync.totalPlayers} in ${photoSync.playerAssetsDir}.`
      : "";
    const recovery = result.slotRecovery;
    if (!recovery?.applied) {
      return `${baseDetail}${photoDetail}`;
    }

    const recoveredFrom =
      typeof recovery.previousMatchNumber === "number"
        ? `Recovered slot assignments from Match ${recovery.previousMatchNumber}.`
        : recovery.previousMatchId
          ? `Recovered slot assignments from match ${recovery.previousMatchId}.`
          : "Recovered slot assignments from the nearest populated previous match.";

    return `${baseDetail}${photoDetail} ${recoveredFrom}`;
  };

  const applyProductionArtifacts = (result: ProductionModeResult) => {
    const teamsCheck = result.checks.find((check) => check.key === "teams");
    const brandingCheck = result.checks.find((check) => check.key === "branding");

    const teamsSlots = Array.isArray(teamsCheck?.meta?.slots)
      ? (teamsCheck.meta.slots as LauncherSlot[])
      : null;
    if (teamsSlots) {
      setSlots(teamsSlots);
    }
    if (typeof teamsCheck?.meta?.teamAssetsDir === "string" && teamsCheck.meta.teamAssetsDir) {
      setTeamAssetsDir(teamsCheck.meta.teamAssetsDir);
    }

    const brandingSlots = Array.isArray(brandingCheck?.meta?.slots)
      ? (brandingCheck.meta.slots as LauncherSlot[])
      : null;
    if (brandingSlots) {
      setSlots(brandingSlots);
    }
    if (
      typeof brandingCheck?.meta?.teamAssetsDir === "string" &&
      brandingCheck.meta.teamAssetsDir
    ) {
      setTeamAssetsDir(brandingCheck.meta.teamAssetsDir);
    }
    if (
      typeof brandingCheck?.meta?.brandingConfigPath === "string" &&
      brandingCheck.meta.brandingConfigPath
    ) {
      setBrandingConfigPath(brandingCheck.meta.brandingConfigPath);
    }

    if (
      teamsCheck?.status === "pass" ||
      brandingCheck?.status === "pass"
    ) {
      setLastSyncTime(result.checkedAt);
    }
  };

  useEffect(() => {
    if (
      !hasAuthenticatedSession(session) ||
      !hasAllowedLauncherAccess(access) ||
      !dashboard.selectedMatchId
    ) {
      return;
    }

    if (getMatchLifecycleActionError(selectedMatchLifecycleStatus)) {
      setSlots([]);
      setLoadingMatch(false);
      return;
    }

    let cancelled = false;
    setLoadingMatch(true);

    void (async () => {
      try {
        const result = await launcherApi.syncTeams(dashboard.selectedMatchId);
        if (cancelled) {
          return;
        }

        applySyncResult(
          result,
          "Match loaded",
          formatSyncDetail(
            result,
            `Loaded ${result.syncedCount} assigned teams from ${result.slotCount} slots for match ${result.matchId}.`,
          ),
        );
      } catch (error) {
        if (cancelled) {
          return;
        }
        if (isUnauthorizedError(error)) {
          handleUnauthorized();
          return;
        }
        if (isAccessDeniedError(error)) {
          handleAccessDenied(error);
          return;
        }
        setStatus({
          tone: "error",
          title: "Match load failed",
          detail: getErrorMessage(error),
        });
      } finally {
        if (!cancelled) {
          setLoadingMatch(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    session,
    access,
    dashboard.selectedMatchId,
    selectedMatchLifecycleStatus,
  ]);

  const chooseFile = async (
    title: string,
    filters: FileFilter[],
    defaultPath: string,
  ) => {
    const selected = await launcherApi.chooseFile(title, filters, defaultPath);
    return selected || "";
  };

  const runAction = async (
    key: string,
    title: string,
    action: () => Promise<void>,
  ) => {
    setBusyAction(key);
    setStatus({
      tone: "neutral",
      title,
      detail: "Working...",
    });

    try {
      await action();
    } catch (error) {
      if (isUnauthorizedError(error)) {
        handleUnauthorized();
        return;
      }
      if (isAccessDeniedError(error)) {
        handleAccessDenied(error);
        return;
      }
      setStatus({
        tone: "error",
        title: `${title} failed`,
        detail: getErrorMessage(error),
      });
    } finally {
      setBusyAction(null);
    }
  };

  const refreshLiveMatchNow = async () => {
    await refreshLiveMatchWithBase(apiBase);
  };

  const requireSelectedMatchId = () => {
    if (!dashboard.selectedMatchId) {
      throw new Error("Select a match before running this action.");
    }
    return dashboard.selectedMatchId;
  };

  const requireActionableMatchId = () => {
    const matchId = requireSelectedMatchId();
    const lifecycleError = getMatchLifecycleActionError(
      selectedMatchLifecycleStatus,
    );

    if (lifecycleError) {
      throw new Error(lifecycleError);
    }

    return matchId;
  };

  const handleLogin = async () => {
    const normalizedEmail = email.trim().toLowerCase();
    if (!EMAIL_PATTERN.test(normalizedEmail)) {
      setAuthError("Enter a valid email address.");
      return;
    }

    if (!password.trim()) {
      setAuthError("Enter your password.");
      return;
    }

    setAuthBusy(true);
    setAuthError(null);
    resetDashboard();

    try {
      const result = await authService.login(
        normalizedEmail,
        password,
        apiBase,
        keepSignedIn,
      );
      await launcherConfig.setConfig("settings", {
        rememberedEmail: normalizedEmail,
        keepSignedIn,
      });
      setEmail(normalizedEmail);
      setApiBase(normalizeApiBase(result.apiBase));
      setSession(result.session);
      setAccess(result.access);
      setPassword("");
      setStatus(
        result.access?.allowed
          ? {
              tone: "success",
              title: "Authenticated",
              detail: "Organizer login succeeded. Loading production matches.",
            }
          : getBlockedStatus(result.access),
      );
    } catch (error) {
      setAuthError(getErrorMessage(error));
    } finally {
      setAuthBusy(false);
    }
  };

  const handleRetryAccess = async () => {
    setAuthBusy(true);
    setAuthError(null);
    resetDashboard();

    try {
      const bootstrap = await authService.bootstrap(apiBase);
      applyBootstrapPayload(bootstrap, shadowTrackerPath);
    } catch (error) {
      if (isUnauthorizedError(error)) {
        handleUnauthorized();
        return;
      }
      setAuthError(getErrorMessage(error));
      setStatus({
        tone: "error",
        title: "Access check failed",
        detail: getErrorMessage(error),
      });
    } finally {
      setAuthBusy(false);
    }
  };

  const handleLogout = async () => {
    setAuthBusy(true);

    try {
      await authService.logout();
    } catch (error) {
      if (!isUnauthorizedError(error)) {
        setAuthError(getErrorMessage(error));
      }
    } finally {
      setAuthBusy(false);
      setAuthError(null);
      setSession(null);
      setAccess(null);
      setPassword("");
      setTelemetryStatus(DEFAULT_TELEMETRY_STATUS);
      setObserverFeedStatus(DEFAULT_OBSERVER_FEED_STATUS);
      resetDashboard();
      setStatus(DEFAULT_STATUS);
    }
  };

  const syncTeams = async () =>
    runAction("sync", "Syncing teams", async () => {
      const matchId = requireActionableMatchId();
      const result = await launcherApi.syncTeams(matchId);
      applySyncResult(
        result,
        "Teams synced",
        formatSyncDetail(
          result,
          `Prepared ${result.syncedCount} assigned teams from ${result.slotCount} slots for match ${result.matchId}. Logos are stored in ${result.teamAssetsDir}.`,
        ),
      );
    });

  const generateBranding = async () =>
    runAction("branding", "Generating branding", async () => {
      const matchId = requireActionableMatchId();
      const result: GenerateBrandingResult = await launcherApi.generateBranding(
        matchId,
      );
      setSlots(result.slots || []);
      setTeamAssetsDir(result.teamAssetsDir || FALLBACKS.teamAssetsDir);
      setBrandingConfigPath(
        result.brandingConfigPath || FALLBACKS.brandingConfigPath,
      );
      setLastSyncTime(new Date().toISOString());
      setStatus({
        tone: "success",
        title: "Branding file generated",
        detail: `Wrote ${result.teamCount} team branding entries for match ${result.matchId} to ${result.brandingConfigPath}.`,
      });
    });

  const launchShadowTracker = async () =>
    runAction("shadowtracker", "Launching ShadowTracker", async () => {
      const matchId = requireActionableMatchId();
      const result = await launcherApi.launchShadowTracker(
        shadowTrackerPath,
        matchId,
      );

      if (result.executablePath) {
        setShadowTrackerPath(result.executablePath);
      }
      if (result.telemetry) {
        setTelemetryStatus(result.telemetry);
      }

      const launchDetail = result.pid
        ? `Started ShadowTrackerExtra.exe with PID ${result.pid}.`
        : "Started ShadowTrackerExtra.exe.";
      const telemetrySourceDetail = formatTelemetrySourceDetail(
        result.telemetrySource,
        result.telemetrySourceError,
      );

      setStatus({
        tone: result.telemetrySourceError ? "neutral" : "success",
        title: "ShadowTracker launched",
        detail: joinDetailParts(
          launchDetail,
          telemetrySourceDetail,
          `Telemetry remains stopped for match ${matchId} until Production Mode passes and you start it manually.`,
        ),
      });
    });

  const enterProductionMode = async () =>
    runAction("production-mode", "Entering production mode", async () => {
      const matchId = requireSelectedMatchId();
      const selectedMatch =
        dashboard.matches.find((match) => match.id === matchId) || null;

      if (!selectedMatch) {
        throw new Error("Select a match before entering production mode.");
      }

      setWorkflowState("PRODUCTION_CHECKING");
      const result = await launcherApi.enterProductionMode({
        matchId,
        shadowTrackerPath,
        selectedMatch: {
          id: selectedMatch.id,
          name: selectedMatch.name || null,
          map: selectedMatch.map || null,
          status: selectedMatch.status || null,
          liveState: selectedMatch.liveState || null,
          matchNumber:
            typeof selectedMatch.matchNumber === "number"
              ? selectedMatch.matchNumber
              : null,
        },
      });

      setProductionModeResult(result);
      applyProductionArtifacts(result);

      if (result.status === "BLOCKED") {
        setWorkflowState("PRODUCTION_BLOCKED");
        setStatus({
          tone: "error",
          title: "Production blocked",
          detail:
            result.blockingIssues[0] ||
            "Resolve the blocking preflight issues before starting telemetry.",
        });
        return;
      }

      setWorkflowState("PRODUCTION_READY");
      setStatus({
        tone: result.status === "READY_WITH_WARNINGS" ? "neutral" : "success",
        title:
          result.status === "READY_WITH_WARNINGS"
            ? "Production ready with warnings"
            : "Production Ready",
        detail:
          result.warnings[0] ||
          "Preflight passed. Telemetry can be started manually for the selected match.",
      });
    });

  const startTelemetryBridge = async () =>
    runAction("telemetry", "Starting telemetry bridge", async () => {
      if (!telemetryBridgeAvailable) {
        throw new Error(
          "Telemetry bridge IPC is unavailable. Restart the Electron launcher to load the latest main process.",
        );
      }

      const matchId = requireSelectedMatchId();
      const selectedProductionModeResult =
        productionModeResult?.matchId === matchId ? productionModeResult : null;

      if (observerFeedStatus.running) {
        throw new Error(
          "Stop the direct Observer Feed before starting the Telemetry Bridge.",
        );
      }

      if (
        !selectedProductionModeResult ||
        !isProductionReadyStatus(selectedProductionModeResult.status) ||
        workflowState === "PRODUCTION_BLOCKED"
      ) {
        console.warn(
          `[Production] Telemetry start refused: production mode not ready matchId=${matchId} workflowState=${workflowState} productionStatus=${
            selectedProductionModeResult?.status || "none"
          }`,
        );
        throw new Error(
          "Enter Production Mode and resolve any blocking issues before starting telemetry.",
        );
      }

      if (!isProductionEligibleLifecycleStatus(selectedMatchLifecycleStatus)) {
        console.warn(
          `[Production] Telemetry start refused: lifecycle not eligible matchId=${matchId} lifecycleStatus=${selectedMatchLifecycleStatus || "unknown"}`,
        );
        throw new Error(
          "Current match is not eligible for telemetry start. Refresh the match state and retry.",
        );
      }

      let result;
      try {
        result = await launcherApi.startTelemetryBridge(requireActionableMatchId());
      } catch (error) {
        if (dashboard.selectedTournamentId) {
          try {
            const [stages, matches] = await Promise.all([
              launcherApi.listStages(dashboard.selectedTournamentId),
              launcherApi.listMatches(dashboard.selectedTournamentId),
            ]);
            setDashboard((current) =>
              current.selectedTournamentId !== dashboard.selectedTournamentId
                ? current
                : {
                    ...current,
                    stages,
                    matches,
                  },
            );
          } catch (refreshError) {
            console.warn(
              `[Production] Match refresh failed after telemetry start rejection: ${getErrorMessage(refreshError)}`,
            );
          }
        }

        try {
          await refreshLiveMatchNow();
        } catch (refreshError) {
          console.warn(
            `[Production] Live match refresh failed after telemetry start rejection: ${getErrorMessage(refreshError)}`,
          );
        }

        try {
          const nextTelemetryStatus = await launcherApi.getTelemetryStatus();
          setTelemetryStatus(nextTelemetryStatus || DEFAULT_TELEMETRY_STATUS);
        } catch (statusError) {
          console.warn(
            `[Production] Telemetry status refresh failed after start rejection: ${getErrorMessage(statusError)}`,
          );
          setTelemetryStatus(DEFAULT_TELEMETRY_STATUS);
        }

        throw error;
      }

      if (result.matchId && result.matchId !== dashboard.selectedMatchId) {
        const resolvedMatch =
          dashboard.matches.find((match) => match.id === result.matchId) || null;
        setDashboard((current) => ({
          ...current,
          selectedStageId: resolvedMatch?.stageId ?? current.selectedStageId,
          selectedMatchId: result.matchId || current.selectedMatchId,
        }));
      }
      setTelemetryStatus(result);
      setWorkflowState("PRODUCTION_LIVE");
      await refreshLiveMatchNow();
      const telemetrySourceDetail = formatTelemetrySourceDetail(
        result.telemetrySource,
        result.telemetrySourceError,
      );
      setStatus({
        tone: result.telemetrySourceError ? "neutral" : "success",
        title: result.alreadyRunning
          ? "Telemetry bridge already running"
          : "Telemetry bridge started",
        detail: joinDetailParts(
          telemetrySourceDetail,
          `Sending authenticated ShadowTracker telemetry for match ${
            result.matchId || dashboard.selectedMatchId
          }. Bridge transport: ${result.connectionStatus.toUpperCase()}. Backend telemetry acceptance is shown in Runtime Status.`,
        ),
      });
    });

  const stopTelemetryBridge = async () =>
    runAction("telemetry-stop", "Stopping telemetry bridge", async () => {
      const result = await launcherApi.stopTelemetryBridge();
      setTelemetryStatus(result || DEFAULT_TELEMETRY_STATUS);
      setStatus({
        tone: "neutral",
        title: "Telemetry bridge stopped",
        detail: `Bridge transport: ${(
          result?.connectionStatus || DEFAULT_TELEMETRY_STATUS.connectionStatus
        ).toUpperCase()}.`,
      });
    });

  const startObserverFeed = async () =>
    runAction("observer-feed", "Starting observer feed", async () => {
      if (!telemetryBridgeAvailable) {
        throw new Error(
          "Launcher IPC is unavailable. Restart the Electron launcher and retry.",
        );
      }

      const matchId = requireSelectedMatchId();
      const selectedProductionModeResult =
        productionModeResult?.matchId === matchId ? productionModeResult : null;

      if (telemetryStatus.running) {
        throw new Error(
          "Stop the Telemetry Bridge before enabling the direct Observer Feed.",
        );
      }

      if (
        !selectedProductionModeResult ||
        !isProductionReadyStatus(selectedProductionModeResult.status) ||
        workflowState === "PRODUCTION_BLOCKED"
      ) {
        throw new Error(
          "Enter Production Mode and resolve any blocking issues before enabling the direct Observer Feed.",
        );
      }

      if (!isProductionEligibleLifecycleStatus(selectedMatchLifecycleStatus)) {
        throw new Error(
          "Current match is not eligible for direct Observer Feed start. Refresh the match state and retry.",
        );
      }

      const result = await launcherApi.startObserverFeed(requireActionableMatchId());
      setObserverFeedStatus(result);
      setWorkflowState("PRODUCTION_LIVE");
      await refreshLiveMatchNow();
      setStatus({
        tone: "success",
        title: result.alreadyRunning
          ? "Observer feed already running"
          : "Observer feed started",
        detail: joinDetailParts(
          "ob.js is now forwarding ShadowTracker telemetry directly to Arenzyra.",
          formatConnectorSetupDetail(result.connector),
          formatObserverFeedDetail(result),
        ),
      });
    });

  const stopObserverFeed = async () =>
    runAction("observer-feed-stop", "Stopping observer feed", async () => {
      const result = await launcherApi.stopObserverFeed();
      setObserverFeedStatus(result || DEFAULT_OBSERVER_FEED_STATUS);
      setStatus({
        tone: "neutral",
        title: "Observer feed stopped",
        detail: "Direct ob.js forwarding has been disabled.",
      });
    });

  const prepareNextMatch = async () =>
    runAction("prepare-next-match", "Preparing next match", async () => {
      const currentMatchId =
        finishedMatchId || dashboard.selectedMatchId || "";
      if (!currentMatchId) {
        throw new Error("Select a finished match before preparing the next one.");
      }

      console.info(
        `[Flow] Preparing next match: currentMatchId=${currentMatchId} suggestedMatchId=${nextMatchSuggestedId || "none"}`,
      );
      const suggestion = await launcherApi.getNextMatchSuggestion(
        currentMatchId,
        nextMatchSuggestedId,
      );
      setNextMatchSuggestion(suggestion);
      setNextMatchError(null);
      setNextMatchSuggestedId(suggestion.nextMatch?.id ?? null);

      if (suggestion.isAfterFinished !== true || suggestion.currentIsFinished !== true) {
        throw new Error(
          "Current match is no longer FINISHED. Refresh the match list before preparing the next match.",
        );
      }

      if (!suggestion.nextMatch) {
        throw new Error("No next match is currently available.");
      }

      const nextMatchLifecycleStatus = normalizeMatchLifecycleStatus(
        suggestion.nextMatch.status,
      );
      if (!isMatchStartableLifecycleStatus(nextMatchLifecycleStatus)) {
        throw new Error(
          "Backend returned a next match that is not startable. The launcher will not switch context.",
        );
      }
      if (getMatchLifecycleActionError(nextMatchLifecycleStatus)) {
        throw new Error(
          "Backend returned a non-actionable next match. The launcher will not switch context.",
        );
      }

      const resetTelemetry =
        await launcherApi.resetTelemetryForMatchSwitch();
      setTelemetryStatus(resetTelemetry || DEFAULT_TELEMETRY_STATUS);
      setObserverFeedStatus(DEFAULT_OBSERVER_FEED_STATUS);
      setSlots([]);
      setLastSyncTime(null);
      setFinishedMatchId(null);
      setNextMatchSuggestion(null);
      setNextMatchLoading(false);
      setNextMatchError(null);
      setNextMatchSuggestedId(null);
      setPreparedMatchId(suggestion.nextMatch.id);
      setProductionModeResult(null);
      setWorkflowState("NEXT_MATCH_PREPARED");
      lastFinishedLogRef.current = null;
      lastSuggestedLogRef.current = null;
      setDashboard((current) => ({
        ...current,
        selectedTournamentId: suggestion.nextMatch?.tournamentId || current.selectedTournamentId,
        selectedStageId: suggestion.nextMatch?.stageId || "",
        selectedMatchId: suggestion.nextMatch?.id || "",
      }));
      setStatus({
        tone: "neutral",
        title: "Next match prepared",
        detail: `Switched launcher context to ${
          suggestion.nextMatch.name ||
          (typeof suggestion.nextMatch.matchNumber === "number"
            ? `Match ${suggestion.nextMatch.matchNumber}`
            : suggestion.nextMatch.id)
        }. Telemetry remains stopped until you start it manually.`,
      });
      console.info(
        `[Flow] Next match prepared and ready: matchId=${suggestion.nextMatch.id}`,
      );
    });

  useEffect(() => {
    if (!hasAuthenticatedSession(session) || !hasAllowedLauncherAccess(access)) {
      setActivePage("launcher");
    }
  }, [session, access]);

  const filteredMatches = dashboard.selectedStageId
    ? dashboard.matches.filter((match) => match.stageId === dashboard.selectedStageId)
    : dashboard.matches;
  const selectedProductionModeResult =
    productionModeResult?.matchId === dashboard.selectedMatchId
      ? productionModeResult
      : null;
  const productionModeReady =
    selectedProductionModeResult !== null &&
    isProductionReadyStatus(selectedProductionModeResult.status);
  const productionModeBlocked =
    selectedProductionModeResult?.status === "BLOCKED";

  useEffect(() => {
    if (!productionModeResult) {
      return;
    }

    if (
      !dashboard.selectedMatchId ||
      productionModeResult.matchId !== dashboard.selectedMatchId ||
      selectedMatchLocked ||
      selectedMatchFinalizing
    ) {
      setProductionModeResult(null);
    }
  }, [
    dashboard.selectedMatchId,
    productionModeResult,
    selectedMatchFinalizing,
    selectedMatchLocked,
  ]);

  useEffect(() => {
    if (!dashboard.selectedMatchId) {
      if (workflowState !== "NO_MATCH") {
        setWorkflowState("NO_MATCH");
      }
      setPreparedMatchId(null);
      return;
    }

    if (
      (telemetryStatus.running &&
        telemetryStatus.matchId === dashboard.selectedMatchId) ||
      (observerFeedStatus.running &&
        observerFeedStatus.matchId === dashboard.selectedMatchId)
    ) {
      const nextLiveState = productionModeReady
        ? "PRODUCTION_LIVE"
        : "MATCH_LIVE";
      if (workflowState !== nextLiveState) {
        setWorkflowState(nextLiveState);
      }
      return;
    }

    if (selectedMatchLocked) {
      if (lastFinishedLogRef.current !== dashboard.selectedMatchId) {
        lastFinishedLogRef.current = dashboard.selectedMatchId;
        console.info(
          `[Flow] Current match finished: matchId=${dashboard.selectedMatchId}`,
        );
      }
      if (!nextMatchSuggestedId && workflowState !== "MATCH_FINISHED") {
        setWorkflowState("MATCH_FINISHED");
      }
      return;
    }

    lastFinishedLogRef.current = null;

    if (selectedMatchFinalizing) {
      if (workflowState !== "MATCH_LIVE") {
        setWorkflowState("MATCH_LIVE");
      }
      return;
    }

    if (busyAction === "production-mode" && workflowState === "PRODUCTION_CHECKING") {
      return;
    }

    if (productionModeBlocked) {
      if (workflowState !== "PRODUCTION_BLOCKED") {
        setWorkflowState("PRODUCTION_BLOCKED");
      }
      return;
    }

    if (productionModeReady) {
      if (workflowState !== "PRODUCTION_READY") {
        setWorkflowState("PRODUCTION_READY");
      }
      return;
    }

    if (
      preparedMatchId &&
      preparedMatchId === dashboard.selectedMatchId &&
      workflowState !== "NEXT_MATCH_PREPARED"
    ) {
      setWorkflowState("NEXT_MATCH_PREPARED");
      return;
    }

    if (workflowState !== "MATCH_READY") {
      setWorkflowState("MATCH_READY");
    }
  }, [
    dashboard.selectedMatchId,
    nextMatchSuggestedId,
    preparedMatchId,
    busyAction,
    productionModeBlocked,
    productionModeReady,
    observerFeedStatus.matchId,
    observerFeedStatus.running,
    selectedMatchFinalizing,
    selectedMatchLocked,
    telemetryStatus.matchId,
    telemetryStatus.running,
    workflowState,
  ]);

  useEffect(() => {
    void launcherApi
      .updateMatchFlowState({
        currentMatchId: dashboard.selectedMatchId || null,
        currentStatus: selectedMatchLifecycleStatus || null,
        nextMatchSuggestedId,
        nextMatchAvailable: Boolean(nextMatchSuggestedId),
        workflowState,
      })
      .catch(() => {});
  }, [
    dashboard.selectedMatchId,
    nextMatchSuggestedId,
    selectedMatchLifecycleStatus,
    workflowState,
  ]);

  if (!hasAuthenticatedSession(session)) {
    return (
      <LoginScreen
        email={email}
        password={password}
        keepSignedIn={keepSignedIn}
        appVersion={LAUNCHER_VERSION}
        busy={authBusy}
        booting={booting}
        error={authError}
        onEmailChange={setEmail}
        onPasswordChange={setPassword}
        onKeepSignedInChange={setKeepSignedIn}
        onSubmit={() => void handleLogin()}
      />
    );
  }

  if (!hasAllowedLauncherAccess(access)) {
    if (access?.reason === "LICENSE_SUSPENDED") {
      return (
        <LicenseSuspendedScreen
          session={session}
          access={access}
          busy={authBusy}
          onRetry={() => void handleRetryAccess()}
          onLogout={() => void handleLogout()}
        />
      );
    }

    if (access?.reason === "OBSERVER_LIMIT_REACHED") {
      return (
        <ObserverLimitScreen
          session={session}
          access={access}
          busy={authBusy}
          onRetry={() => void handleRetryAccess()}
          onLogout={() => void handleLogout()}
        />
      );
    }

    return (
      <LicenseExpiredScreen
        session={session}
        access={access}
        busy={authBusy}
        onRetry={() => void handleRetryAccess()}
        onLogout={() => void handleLogout()}
      />
    );
  }

  return (
    <div className="desktop-shell">
      <DesktopSidebar
        activePage={activePage}
        session={session}
        onPageChange={setActivePage}
        onLogout={() => void handleLogout()}
      />

      <main className="desktop-main">
        {activePage === "widgets" ? (
          <WidgetsScreen
            organizationId={session.organization?.id || session.user.organizationId || null}
          />
        ) : (
          <DashboardScreen
            apiBase={apiBase}
            session={session}
            access={access}
            license={access.license}
            tournaments={dashboard.tournaments}
            stages={dashboard.stages}
            matches={filteredMatches}
            selectedTournamentId={dashboard.selectedTournamentId}
            selectedStageId={dashboard.selectedStageId}
            selectedMatchId={dashboard.selectedMatchId}
            teamAssetsDir={teamAssetsDir}
            brandingConfigPath={brandingConfigPath}
            shadowTrackerPath={shadowTrackerPath}
            telemetryBridgeAvailable={telemetryBridgeAvailable}
            telemetryStatus={telemetryStatus}
            matchControl={activeSelectedMatchControl}
            matchLifecycleStatus={selectedMatchLifecycleStatus}
            matchLocked={selectedMatchLocked}
            matchFinalizing={selectedMatchFinalizing}
            nextMatchSuggestion={nextMatchSuggestion?.nextMatch ?? null}
            nextMatchLoading={nextMatchLoading}
            nextMatchError={nextMatchError}
            preparingNextMatch={busyAction === "prepare-next-match"}
            productionModeResult={selectedProductionModeResult}
            enteringProductionMode={busyAction === "production-mode"}
            canStartTelemetry={
              telemetryStatus.running ||
              (productionModeReady &&
                !observerFeedStatus.running &&
                !productionModeBlocked &&
                isProductionEligibleLifecycleStatus(selectedMatchLifecycleStatus) &&
                !selectedMatchFinalizing &&
                !selectedMatchLocked)
            }
            observerFeedStatus={observerFeedStatus}
            canStartObserverFeed={
              observerFeedStatus.running ||
              (productionModeReady &&
                !telemetryStatus.running &&
                !productionModeBlocked &&
                isProductionEligibleLifecycleStatus(selectedMatchLifecycleStatus) &&
                !selectedMatchFinalizing &&
                !selectedMatchLocked)
            }
            status={status}
            slots={slots}
            lastSyncTime={lastSyncTime}
            busyAction={busyAction}
            loadingMatch={loadingMatch}
            onTournamentChange={(value) =>
              setDashboard((current) => ({
                ...current,
                selectedTournamentId: value,
              }))
            }
            onStageChange={(value) =>
              setDashboard((current) => ({
                ...current,
                selectedStageId: value,
              }))
            }
            onMatchChange={(value) =>
              setDashboard((current) => ({
                ...current,
                selectedMatchId: value,
              }))
            }
            onShadowTrackerPathChange={setShadowTrackerPath}
            onBrowseShadowTracker={() =>
              void chooseFile(
                "Select ShadowTrackerExtra.exe",
                [{ name: "Executable", extensions: ["exe"] }],
                shadowTrackerPath,
              ).then((selected) => {
                if (selected) {
                  setShadowTrackerPath(selected);
                }
              })
            }
            onSyncTeams={() => void syncTeams()}
            onGenerateBranding={() => void generateBranding()}
            onLaunchShadowTracker={() => void launchShadowTracker()}
            onEnterProductionMode={() => void enterProductionMode()}
            onToggleTelemetry={() =>
              void (
                telemetryStatus.running ? stopTelemetryBridge() : startTelemetryBridge()
              )
            }
            onToggleObserverFeed={() =>
              void (
                observerFeedStatus.running
                  ? stopObserverFeed()
                  : startObserverFeed()
              )
            }
            onPrepareNextMatch={() => void prepareNextMatch()}
            onLogout={() => void handleLogout()}
          />
        )}
      </main>
    </div>
  );
}
