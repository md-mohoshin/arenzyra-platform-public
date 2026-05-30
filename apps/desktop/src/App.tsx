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
import { DesktopSidebar } from "./components/desktop-sidebar";
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
  TournamentSummary,
  VisualCaptureSource,
  VisualGamePresetKey,
  VisualModeRegion,
  VisualModeRegionKey,
  VisualModeStatus,
  VisualReviewQueueState,
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

const ACTIVE_EVENT_TOURNAMENT_ID = "__active_event__";
const ACTIVE_EVENT_STAGE_ID = "__active_event_stage__";

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
  alivePlayers: null,
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

const VISUAL_REGION_LABELS: Record<VisualModeRegionKey, string> = {
  killFeed: "Kill feed",
  teamPanel: "Team panel",
  scoreboard: "Scoreboard",
};

const DEFAULT_VISUAL_GAME_PRESET_KEY: VisualGamePresetKey = "pubgMobile";

const VISUAL_GAME_PRESET_LABELS: Record<VisualGamePresetKey, string> = {
  pubgMobile: "PUBG Mobile",
  freeFire: "Free Fire",
  valorant: "VALORANT",
  codMobile: "COD Mobile",
};

const VISUAL_GAME_REGION_PRESETS: Record<
  VisualGamePresetKey,
  Record<VisualModeRegionKey, VisualModeRegion>
> = {
  pubgMobile: {
    killFeed: { x: 66, y: 8, width: 32, height: 30 },
    teamPanel: { x: 0, y: 12, width: 24, height: 76 },
    scoreboard: { x: 18, y: 10, width: 64, height: 76 },
  },
  freeFire: {
    killFeed: { x: 61, y: 9, width: 37, height: 34 },
    teamPanel: { x: 0, y: 14, width: 26, height: 72 },
    scoreboard: { x: 16, y: 12, width: 68, height: 74 },
  },
  valorant: {
    killFeed: { x: 71, y: 9, width: 27, height: 32 },
    teamPanel: { x: 0, y: 5, width: 100, height: 13 },
    scoreboard: { x: 20, y: 12, width: 60, height: 70 },
  },
  codMobile: {
    killFeed: { x: 64, y: 8, width: 34, height: 34 },
    teamPanel: { x: 0, y: 10, width: 26, height: 78 },
    scoreboard: { x: 18, y: 10, width: 64, height: 76 },
  },
};

const normalizeVisualGamePresetKey = (
  value: string | null | undefined,
): VisualGamePresetKey =>
  value === "freeFire" || value === "valorant" || value === "codMobile"
    ? value
    : DEFAULT_VISUAL_GAME_PRESET_KEY;

const getVisualRegionPreset = (
  gamePresetKey: string | null | undefined,
  regionKey: VisualModeRegionKey,
): VisualModeRegion =>
  VISUAL_GAME_REGION_PRESETS[normalizeVisualGamePresetKey(gamePresetKey)][
    regionKey
  ];

const createVisualPresetRegions = (gamePresetKey: string | null | undefined) => {
  const preset =
    VISUAL_GAME_REGION_PRESETS[normalizeVisualGamePresetKey(gamePresetKey)];
  return {
    killFeed: { ...preset.killFeed },
    teamPanel: { ...preset.teamPanel },
    scoreboard: { ...preset.scoreboard },
  };
};

const mergeVisualRegionsWithPreset = (
  gamePresetKey: string | null | undefined,
  regions: VisualModeStatus["regions"] | null | undefined,
  overrideKey?: VisualModeRegionKey,
  overrideRegion?: VisualModeRegion,
) => {
  const presetRegions = createVisualPresetRegions(gamePresetKey);
  const nextRegions = {
    killFeed: regions?.killFeed ?? presetRegions.killFeed,
    teamPanel: regions?.teamPanel ?? presetRegions.teamPanel,
    scoreboard: regions?.scoreboard ?? presetRegions.scoreboard,
  };
  if (overrideKey && overrideRegion) {
    nextRegions[overrideKey] = overrideRegion;
  }
  return nextRegions;
};

const normalizeVisualRegionKey = (
  value: string | null | undefined,
): VisualModeRegionKey =>
  value === "teamPanel" || value === "scoreboard" ? value : "killFeed";

const clampVisualRegionNumber = (
  value: number,
  min: number,
  max: number,
  fallback: number,
) => {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.round(value * 100) / 100));
};

const normalizeVisualRegion = (
  value: Partial<VisualModeRegion> | null | undefined,
  fallback: VisualModeRegion,
): VisualModeRegion => {
  const x = clampVisualRegionNumber(Number(value?.x), 0, 99, fallback.x);
  const y = clampVisualRegionNumber(Number(value?.y), 0, 99, fallback.y);
  return {
    x,
    y,
    width: clampVisualRegionNumber(
      Number(value?.width),
      1,
      Math.max(1, 100 - x),
      fallback.width,
    ),
    height: clampVisualRegionNumber(
      Number(value?.height),
      1,
      Math.max(1, 100 - y),
      fallback.height,
    ),
  };
};

const resolveVisualRegionDraft = (
  status: VisualModeStatus,
  key: VisualModeRegionKey,
) =>
  normalizeVisualRegion(
    status.regions?.[key] ?? (status.activeRegionKey === key ? status.region : null),
    getVisualRegionPreset(status.gamePresetKey, key),
  );

const createDefaultVisualRegions = () => ({
  killFeed: null,
  teamPanel: null,
  scoreboard: null,
});

const DEFAULT_VISUAL_MODE_STATUS: VisualModeStatus = {
  available: false,
  running: false,
  matchId: null,
  sessionId: null,
  gamePresetKey: DEFAULT_VISUAL_GAME_PRESET_KEY,
  sourceId: null,
  sourceName: null,
  captureFps: 2,
  region: null,
  regions: createDefaultVisualRegions(),
  activeRegionKey: "killFeed",
  coordinateMode: "percent",
  calibrationReady: false,
  reviewBeforePublish: true,
  autoPublish: false,
  ocrEnabled: false,
  aiEnabled: false,
  connectionStatus: "stopped",
  framesSeen: 0,
  changesDetected: 0,
  lastFrameAt: null,
  lastChangeAt: null,
  lastError: null,
  startedAt: null,
  stoppedAt: null,
  pipeline: "screen-monitor",
  reviewQueueSize: 0,
  lastReviewCandidateAt: null,
};

const DEFAULT_VISUAL_REVIEW_QUEUE: VisualReviewQueueState = {
  items: [],
  pendingCount: 0,
  maxItems: 20,
  reviewBeforePublish: true,
  autoPublish: false,
};

const DEFAULT_STATUS: StatusMessage = {
  tone: "neutral",
  title: "Authentication required",
  detail:
    "Sign in with your organizer account to load production tournaments and matches.",
};

const LIVE_MATCH_REFRESH_MS = 15_000;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
type DesktopRoute = "desk" | "widgets";

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

const isLiveMatch = (
  match: Pick<MatchSummary, "liveState" | "status"> | null | undefined,
) => isLiveState(match?.liveState) || isLiveState(match?.status);

const joinDetailParts = (...parts: Array<string | null | undefined>) =>
  parts
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join(" ");

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
  const normalizedPreferredId = String(preferredId || "").trim();
  if (normalizedPreferredId && items.some((item) => item.id === normalizedPreferredId)) {
    return normalizedPreferredId;
  }

  if (items.some((item) => item.id === currentId)) {
    return currentId;
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

const findPreferredStageId = (
  stages: StageSummary[],
  matches: MatchSummary[],
  matchControls: Record<string, MatchControlSnapshot>,
  resolvedLiveStageId?: string | null,
  resolvedLiveMatchId?: string | null,
) => {
  const normalizedResolvedLiveStageId = String(resolvedLiveStageId || "").trim();
  if (
    normalizedResolvedLiveStageId &&
    stages.some((stage) => stage.id === normalizedResolvedLiveStageId)
  ) {
    return normalizedResolvedLiveStageId;
  }

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

const findPreferredTournamentId = (
  tournaments: TournamentSummary[],
  resolvedLiveTournamentId?: string | null,
) => {
  const normalizedResolvedLiveTournamentId = String(
    resolvedLiveTournamentId || "",
  ).trim();
  if (
    normalizedResolvedLiveTournamentId &&
    tournaments.some((tournament) => tournament.id === normalizedResolvedLiveTournamentId)
  ) {
    return normalizedResolvedLiveTournamentId;
  }

  return tournaments.find((tournament) => isLiveTournament(tournament))?.id ?? "";
};

const isActiveEventLiveMatch = (
  match: LauncherLiveMatch | null | undefined,
) => Boolean(match?.matchId && !match.tournamentId);

const formatActiveEventMatchName = (match: LauncherLiveMatch) => {
  const namedMatch = String(match.matchName || "").trim();
  if (namedMatch) {
    return namedMatch;
  }

  if (typeof match.matchNumber === "number") {
    return `Match ${match.matchNumber}`;
  }

  return "Active Match";
};

const buildActiveEventTournament = (
  match: LauncherLiveMatch,
  organizationName?: string | null,
): TournamentSummary => {
  const sessionName = String(match.sessionName || "").trim();
  return {
    id: ACTIVE_EVENT_TOURNAMENT_ID,
    name: sessionName
      ? `${sessionName} (Event)`
      : `${organizationName || "Active"} Event`,
    status: match.status,
    liveState: match.status,
    stageCount: 1,
    matchCount: 1,
  };
};

const buildActiveEventStage = (match: LauncherLiveMatch): StageSummary => ({
  id: ACTIVE_EVENT_STAGE_ID,
  name: String(match.sessionName || "").trim() || "Event Session",
  order: 0,
  maxTeams: null,
  liveState: match.status,
  groupCount: 0,
  matchCount: 1,
  groups: [],
});

const buildActiveEventMatch = (match: LauncherLiveMatch): MatchSummary => ({
  id: match.matchId || "",
  name: formatActiveEventMatchName(match),
  stageId: ACTIVE_EVENT_STAGE_ID,
  groupId: null,
  map: match.map ?? null,
  status: match.status,
  liveState: match.status,
  dataMode: null,
  matchNumber: match.matchNumber ?? null,
  group: null,
});

const removeActiveEventTournament = (tournaments: TournamentSummary[]) =>
  tournaments.filter((tournament) => tournament.id !== ACTIVE_EVENT_TOURNAMENT_ID);

const withActiveEventTournament = (
  tournaments: TournamentSummary[],
  match: LauncherLiveMatch,
  organizationName?: string | null,
) => [
  buildActiveEventTournament(match, organizationName),
  ...removeActiveEventTournament(tournaments),
];

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
    case "LAUNCHER_PLAN_REQUIRED":
      return {
        tone: "error",
        title: "Launcher plan required",
        detail:
          "This organization is not on the launcher plan. Contact Arenzyra support before starting production.",
      };
    case "SUBSCRIPTION_EXPIRED":
      return {
        tone: "error",
        title: "Subscription expired",
        detail:
          "Launcher access is blocked until this organization's subscription or trial is active again.",
      };
    case "LICENSE_REVOKED":
    case "LICENSE_SUSPENDED":
      return {
        tone: "error",
        title:
          access.reason === "LICENSE_REVOKED"
            ? "Launcher access revoked"
            : "Launcher access suspended",
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
        title: "Launcher access blocked",
        detail:
          "Launcher access is not available for this organization. Contact Arenzyra support.",
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
  const [, setTeamAssetsDir] = useState(FALLBACKS.teamAssetsDir);
  const [, setBrandingConfigPath] = useState(
    FALLBACKS.brandingConfigPath,
  );
  const [telemetryBridgeAvailable, setTelemetryBridgeAvailable] = useState(false);
  const [telemetryStatus, setTelemetryStatus] = useState<TelemetryBridgeStatus>(
    DEFAULT_TELEMETRY_STATUS,
  );
  const [observerFeedStatus, setObserverFeedStatus] =
    useState<ObserverFeedStatus>(DEFAULT_OBSERVER_FEED_STATUS);
  const [visualModeStatus, setVisualModeStatus] = useState<VisualModeStatus>(
    DEFAULT_VISUAL_MODE_STATUS,
  );
  const [visualSources, setVisualSources] = useState<VisualCaptureSource[]>([]);
  const [visualSourcesLoading, setVisualSourcesLoading] = useState(false);
  const [visualModeError, setVisualModeError] = useState<string | null>(null);
  const [selectedVisualSourceId, setSelectedVisualSourceId] = useState("");
  const [visualCaptureFps, setVisualCaptureFps] = useState(
    DEFAULT_VISUAL_MODE_STATUS.captureFps,
  );
  const [visualActiveRegionKey, setVisualActiveRegionKey] =
    useState<VisualModeRegionKey>(DEFAULT_VISUAL_MODE_STATUS.activeRegionKey);
  const [visualRegionDraft, setVisualRegionDraft] = useState<VisualModeRegion>(
    getVisualRegionPreset(DEFAULT_VISUAL_GAME_PRESET_KEY, "killFeed"),
  );
  const [visualRegionDirty, setVisualRegionDirty] = useState(false);
  const [visualReviewQueue, setVisualReviewQueue] =
    useState<VisualReviewQueueState>(DEFAULT_VISUAL_REVIEW_QUEUE);
  const [selectedMatchControl, setSelectedMatchControl] =
    useState<MatchControlSnapshot | null>(null);
  const [matchControlIndex, setMatchControlIndex] = useState<
    Record<string, MatchControlSnapshot>
  >({});
  const [status, setStatus] = useState<StatusMessage>(DEFAULT_STATUS);
  const [, setSlots] = useState<LauncherSlot[]>([]);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [loadingMatch, setLoadingMatch] = useState(false);
  const [, setLastSyncTime] = useState<string | null>(null);
  const [liveMatch, setLiveMatch] = useState<LauncherLiveMatch | null>(null);
  const [dashboard, setDashboard] = useState(createEmptyDashboardState());
  const [currentRoute, setCurrentRoute] = useState<DesktopRoute>("desk");
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
  const lastAppliedActiveEventMatchIdRef = useRef<string | null>(null);
  const visualRegionDirtyRef = useRef(false);

  const updateVisualRegionDirty = (dirty: boolean) => {
    visualRegionDirtyRef.current = dirty;
    setVisualRegionDirty(dirty);
  };

  const resetVisualModeUiState = () => {
    setVisualModeStatus(DEFAULT_VISUAL_MODE_STATUS);
    setVisualSources([]);
    setVisualModeError(null);
    setSelectedVisualSourceId("");
    setVisualCaptureFps(DEFAULT_VISUAL_MODE_STATUS.captureFps);
    setVisualActiveRegionKey(DEFAULT_VISUAL_MODE_STATUS.activeRegionKey);
    setVisualRegionDraft(
      getVisualRegionPreset(DEFAULT_VISUAL_GAME_PRESET_KEY, "killFeed"),
    );
    updateVisualRegionDirty(false);
    setVisualReviewQueue(DEFAULT_VISUAL_REVIEW_QUEUE);
  };

  const resetDashboard = () => {
    const emptyState = createEmptyDashboardState();
    setDashboard(emptyState);
    setCurrentRoute("desk");
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
    lastAppliedActiveEventMatchIdRef.current = null;
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
    resetVisualModeUiState();
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
    resetVisualModeUiState();
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
    resetVisualModeUiState();
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

  const applyVisualModeStatus = (nextStatus: VisualModeStatus | null) => {
    const normalizedStatus = {
      ...DEFAULT_VISUAL_MODE_STATUS,
      ...(nextStatus || {}),
      gamePresetKey: normalizeVisualGamePresetKey(nextStatus?.gamePresetKey),
    };
    const nextRegionKey = normalizeVisualRegionKey(
      normalizedStatus.activeRegionKey,
    );
    setVisualModeStatus(normalizedStatus);
    setSelectedVisualSourceId(normalizedStatus.sourceId || "");
    setVisualCaptureFps(
      normalizedStatus.captureFps || DEFAULT_VISUAL_MODE_STATUS.captureFps,
    );
    setVisualActiveRegionKey(nextRegionKey);
    if (!visualRegionDirtyRef.current) {
      setVisualRegionDraft(resolveVisualRegionDraft(normalizedStatus, nextRegionKey));
    }
    setVisualModeError(normalizedStatus.lastError || null);
  };

  const applyVisualReviewQueue = (
    nextQueue: VisualReviewQueueState | null,
  ) => {
    setVisualReviewQueue(nextQueue || DEFAULT_VISUAL_REVIEW_QUEUE);
  };

  const refreshVisualReviewQueue = async () => {
    try {
      const queue = await launcherApi.getVisualReviewQueue();
      applyVisualReviewQueue(queue);
      return queue;
    } catch (error) {
      if (isUnauthorizedError(error)) {
        handleUnauthorized();
        return DEFAULT_VISUAL_REVIEW_QUEUE;
      }
      if (isAccessDeniedError(error)) {
        handleAccessDenied(error);
        return DEFAULT_VISUAL_REVIEW_QUEUE;
      }
      setVisualModeError(getErrorMessage(error));
      return DEFAULT_VISUAL_REVIEW_QUEUE;
    }
  };

  const refreshVisualSources = async () => {
    setVisualSourcesLoading(true);
    try {
      const sources = await launcherApi.listVisualSources();
      setVisualSources(sources);
      setVisualModeError(null);
      return sources;
    } catch (error) {
      if (isUnauthorizedError(error)) {
        handleUnauthorized();
        return [];
      }
      if (isAccessDeniedError(error)) {
        handleAccessDenied(error);
        return [];
      }
      setVisualModeError(getErrorMessage(error));
      return [];
    } finally {
      setVisualSourcesLoading(false);
    }
  };

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
    if (!hasAuthenticatedSession(session) || !hasAllowedLauncherAccess(access)) {
      resetVisualModeUiState();
      return;
    }

    let cancelled = false;

    const refreshVisualStatus = async () => {
      try {
        const [nextStatus, nextQueue] = await Promise.all([
          launcherApi.getVisualModeStatus(),
          launcherApi.getVisualReviewQueue(),
        ]);
        if (!cancelled) {
          applyVisualModeStatus(nextStatus || DEFAULT_VISUAL_MODE_STATUS);
          applyVisualReviewQueue(nextQueue || DEFAULT_VISUAL_REVIEW_QUEUE);
        }
      } catch (error) {
        if (cancelled) {
          return;
        }
        applyVisualModeStatus(DEFAULT_VISUAL_MODE_STATUS);
        if (isUnauthorizedError(error)) {
          handleUnauthorized();
          return;
        }
        if (isAccessDeniedError(error)) {
          handleAccessDenied(error);
          return;
        }
        setVisualModeError(getErrorMessage(error));
      }
    };

    void refreshVisualStatus();
    void refreshVisualSources();
    const timer = window.setInterval(() => {
      void refreshVisualStatus();
    }, 1000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [session, access]);

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
          "Backend locked this match. Observer controls stay unavailable until an admin unlocks it.",
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
          tournaments: current.tournaments.some(
            (tournament) => tournament.id === ACTIVE_EVENT_TOURNAMENT_ID,
          )
            ? [
                current.tournaments.find(
                  (tournament) => tournament.id === ACTIVE_EVENT_TOURNAMENT_ID,
                ) as TournamentSummary,
                ...removeActiveEventTournament(tournaments),
              ]
            : tournaments,
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
    const activeEventMatch = isActiveEventLiveMatch(liveMatch)
      ? liveMatch
      : null;

    if (!activeEventMatch) {
      lastAppliedActiveEventMatchIdRef.current = null;
      setDashboard((current) => {
        if (
          !current.tournaments.some(
            (tournament) => tournament.id === ACTIVE_EVENT_TOURNAMENT_ID,
          )
        ) {
          return current;
        }

        const activeEventSelected =
          current.selectedTournamentId === ACTIVE_EVENT_TOURNAMENT_ID;
        return {
          ...current,
          tournaments: removeActiveEventTournament(current.tournaments),
          selectedTournamentId: activeEventSelected
            ? ""
            : current.selectedTournamentId,
          selectedStageId: activeEventSelected ? "" : current.selectedStageId,
          selectedMatchId: activeEventSelected ? "" : current.selectedMatchId,
          stages: activeEventSelected ? [] : current.stages,
          matches: activeEventSelected ? [] : current.matches,
        };
      });
      return;
    }

    const activeMatchId = activeEventMatch.matchId;
    if (!activeMatchId) {
      return;
    }

    const shouldForceSelect =
      lastAppliedActiveEventMatchIdRef.current !== activeMatchId;
    lastAppliedActiveEventMatchIdRef.current = activeMatchId;

    setDashboard((current) => {
      const eventTournaments = withActiveEventTournament(
        current.tournaments,
        activeEventMatch,
        session?.organization?.name ?? null,
      );
      const eventStage = buildActiveEventStage(activeEventMatch);
      const eventMatch = buildActiveEventMatch(activeEventMatch);
      const forceSelect =
        shouldForceSelect ||
        current.selectedTournamentId === ACTIVE_EVENT_TOURNAMENT_ID ||
        !current.selectedMatchId;

      return {
        ...current,
        tournaments: eventTournaments,
        ...(forceSelect
          ? {
              selectedTournamentId: ACTIVE_EVENT_TOURNAMENT_ID,
              selectedStageId: eventStage.id,
              selectedMatchId: eventMatch.id,
              stages: [eventStage],
              matches: [eventMatch],
            }
          : {}),
      };
    });
  }, [
    liveMatch?.matchId,
    liveMatch?.tournamentId,
    liveMatch?.sessionName,
    liveMatch?.matchName,
    liveMatch?.matchNumber,
    liveMatch?.map,
    liveMatch?.status,
    session?.organization?.name,
  ]);

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
      findPreferredTournamentId(dashboard.tournaments, liveMatch?.tournamentId),
    );

    if (nextTournamentId !== dashboard.selectedTournamentId) {
      setDashboard((current) => ({
        ...current,
        selectedTournamentId: nextTournamentId,
      }));
    }
  }, [dashboard.tournaments, dashboard.selectedTournamentId, liveMatch?.tournamentId]);

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

    const activeEventMatch = isActiveEventLiveMatch(liveMatch)
      ? liveMatch
      : null;
    if (
      dashboard.selectedTournamentId === ACTIVE_EVENT_TOURNAMENT_ID &&
      activeEventMatch
    ) {
      const eventStage = buildActiveEventStage(activeEventMatch);
      const eventMatch = buildActiveEventMatch(activeEventMatch);
      setDashboard((current) =>
        current.selectedTournamentId !== ACTIVE_EVENT_TOURNAMENT_ID
          ? current
          : {
              ...current,
              stages: [eventStage],
              matches: [eventMatch],
              selectedStageId: eventStage.id,
              selectedMatchId: eventMatch.id,
            },
      );
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
              "Live production matches are auto-detected and selected automatically when available.",
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
  }, [
    session,
    access,
    dashboard.selectedTournamentId,
    liveMatch?.matchId,
    liveMatch?.tournamentId,
    liveMatch?.sessionName,
    liveMatch?.matchName,
    liveMatch?.matchNumber,
    liveMatch?.map,
    liveMatch?.status,
  ]);

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

    const preferredStageId = findPreferredStageId(
      dashboard.stages,
      dashboard.matches,
      matchControlIndex,
      liveMatch?.stageId,
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
    liveMatch?.stageId,
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
      currentSelectedMatch?.id || dashboard.selectedMatchId,
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

  const handleVisualSourceChange = (sourceId: string) => {
    const selectedSource =
      visualSources.find((source) => source.id === sourceId) || null;
    setSelectedVisualSourceId(sourceId);
    setVisualModeError(null);
    void launcherApi
      .setVisualModeConfig({
        sourceId: sourceId || null,
        sourceName: selectedSource?.name ?? null,
        captureFps: visualCaptureFps,
      })
      .then((config) => {
        setVisualCaptureFps(config.captureFps);
      })
      .catch((error) => {
        setVisualModeError(getErrorMessage(error));
      });
  };

  const handleVisualFpsChange = (captureFps: number) => {
    const nextFps = Number.isFinite(captureFps)
      ? Math.min(6, Math.max(1, Math.round(captureFps)))
      : DEFAULT_VISUAL_MODE_STATUS.captureFps;
    const selectedSource =
      visualSources.find((source) => source.id === selectedVisualSourceId) ||
      null;
    setVisualCaptureFps(nextFps);
    setVisualModeError(null);
    void launcherApi
      .setVisualModeConfig({
        sourceId: selectedVisualSourceId || null,
        sourceName: selectedSource?.name ?? visualModeStatus.sourceName,
        captureFps: nextFps,
      })
      .catch((error) => {
        setVisualModeError(getErrorMessage(error));
      });
  };

  const handleVisualGamePresetChange = (value: string) => {
    const nextGamePresetKey = normalizeVisualGamePresetKey(value);
    const nextRegions = createVisualPresetRegions(nextGamePresetKey);
    const nextRegion = nextRegions[visualActiveRegionKey];
    setVisualRegionDraft(nextRegion);
    updateVisualRegionDirty(false);
    setVisualModeError(null);
    void launcherApi
      .setVisualModeConfig({
        gamePresetKey: nextGamePresetKey,
        activeRegionKey: visualActiveRegionKey,
        region: nextRegion,
        regions: nextRegions,
      })
      .then((config) => {
        setVisualModeStatus((current) => ({
          ...current,
          ...config,
          calibrationReady: Boolean(config.region),
          reviewQueueSize: current.reviewQueueSize,
          lastReviewCandidateAt: current.lastReviewCandidateAt,
        }));
      })
      .catch((error) => {
        setVisualModeError(getErrorMessage(error));
      });
  };

  const handleVisualRegionKeyChange = (value: string) => {
    const nextKey = normalizeVisualRegionKey(value);
    setVisualActiveRegionKey(nextKey);
    setVisualRegionDraft(resolveVisualRegionDraft(visualModeStatus, nextKey));
    updateVisualRegionDirty(false);
    setVisualModeError(null);
    void launcherApi
      .setVisualModeConfig({
        activeRegionKey: nextKey,
      })
      .catch((error) => {
        setVisualModeError(getErrorMessage(error));
      });
  };

  const handleVisualRegionDraftChange = (
    field: keyof VisualModeRegion,
    value: number,
  ) => {
    setVisualRegionDraft((current) => {
      const next = normalizeVisualRegion(
        {
          ...current,
          [field]: value,
        },
        getVisualRegionPreset(visualModeStatus.gamePresetKey, visualActiveRegionKey),
      );
      return next;
    });
    updateVisualRegionDirty(true);
  };

  const saveVisualCalibration = async () =>
    runAction("save-visual-calibration", "Saving calibration", async () => {
      const nextRegion = normalizeVisualRegion(
        visualRegionDraft,
        getVisualRegionPreset(visualModeStatus.gamePresetKey, visualActiveRegionKey),
      );
      const nextRegions = mergeVisualRegionsWithPreset(
        visualModeStatus.gamePresetKey,
        visualModeStatus.regions,
        visualActiveRegionKey,
        nextRegion,
      );
      const config = await launcherApi.setVisualModeConfig({
        gamePresetKey: normalizeVisualGamePresetKey(visualModeStatus.gamePresetKey),
        activeRegionKey: visualActiveRegionKey,
        region: nextRegion,
        regions: nextRegions,
      });
      updateVisualRegionDirty(false);
      setVisualModeStatus((current) => ({
        ...current,
        ...config,
        calibrationReady: Boolean(config.region),
        reviewQueueSize: current.reviewQueueSize,
        lastReviewCandidateAt: current.lastReviewCandidateAt,
      }));
      setVisualRegionDraft(resolveVisualRegionDraft(
        {
          ...visualModeStatus,
          ...config,
          calibrationReady: Boolean(config.region),
          reviewQueueSize: visualModeStatus.reviewQueueSize,
          lastReviewCandidateAt: visualModeStatus.lastReviewCandidateAt,
        },
        visualActiveRegionKey,
      ));
      setStatus({
        tone: "success",
        title: "Calibration saved",
        detail: `${VISUAL_REGION_LABELS[visualActiveRegionKey]} capture area is ready for review-only Visual Mode.`,
      });
    });

  const captureVisualReviewCandidate = async () =>
    runAction("capture-visual-review", "Capturing visual review", async () => {
      const result = await launcherApi.captureVisualReviewCandidate();
      applyVisualModeStatus(result.status || DEFAULT_VISUAL_MODE_STATUS);
      applyVisualReviewQueue(result.queue || DEFAULT_VISUAL_REVIEW_QUEUE);
      setStatus({
        tone: "neutral",
        title: "Capture queued",
        detail:
          "Visual candidate was added to the local review queue. Publishing is still blocked.",
      });
    });

  const runVisualReviewOcr = async (id: string) =>
    runAction("run-visual-review-ocr", "Running visual OCR", async () => {
      const queue = await launcherApi.runVisualReviewOcr(id);
      applyVisualReviewQueue(queue);
      const item = queue.items.find((entry) => entry.id === id);
      setStatus({
        tone: item?.ocrStatus === "failed" ? "error" : "success",
        title:
          item?.ocrStatus === "failed"
            ? "OCR preview failed"
            : "OCR preview ready",
        detail:
          item?.ocrError ||
          "Captured frame was sent to the existing OCR review parser.",
      });
    });

  const clearVisualReviewQueue = async () =>
    runAction("clear-visual-review", "Clearing visual queue", async () => {
      const queue = await launcherApi.clearVisualReviewQueue();
      applyVisualReviewQueue(queue);
      setStatus({
        tone: "neutral",
        title: "Review queue cleared",
        detail: "Visual Mode review candidates were removed locally.",
      });
    });

  const ignoreVisualReviewItem = async (id: string) => {
    try {
      const queue = await launcherApi.ignoreVisualReviewItem(id);
      applyVisualReviewQueue(queue);
    } catch (error) {
      setVisualModeError(getErrorMessage(error));
    }
  };

  const markVisualReviewItemReviewed = async (id: string) => {
    try {
      const queue = await launcherApi.markVisualReviewItemReviewed(id);
      applyVisualReviewQueue(queue);
    } catch (error) {
      setVisualModeError(getErrorMessage(error));
    }
  };

  const toggleVisualMode = async () =>
    runAction(
      visualModeStatus.running ? "stop-visual-mode" : "start-visual-mode",
      visualModeStatus.running ? "Stopping visual mode" : "Starting visual mode",
      async () => {
        if (visualModeStatus.running) {
          const nextStatus = await launcherApi.stopVisualMode();
          applyVisualModeStatus(nextStatus || DEFAULT_VISUAL_MODE_STATUS);
          setStatus({
            tone: "neutral",
            title: "Visual mode stopped",
            detail: "Screen monitoring is no longer running.",
          });
          return;
        }

        if (telemetryStatus.running || observerFeedStatus.running) {
          throw new Error(
            "Stop Telemetry Bridge or Observer Feed before starting Visual Mode.",
          );
        }

        const matchId = requireActionableMatchId();
        if (!selectedVisualSourceId) {
          throw new Error("Select a screen or window source first.");
        }

        const selectedSource =
          visualSources.find((source) => source.id === selectedVisualSourceId) ||
          null;
        const nextRegion = normalizeVisualRegion(
          visualRegionDraft,
          getVisualRegionPreset(visualModeStatus.gamePresetKey, visualActiveRegionKey),
        );
        const nextRegions = mergeVisualRegionsWithPreset(
          visualModeStatus.gamePresetKey,
          visualModeStatus.regions,
          visualActiveRegionKey,
          nextRegion,
        );
        const nextStatus = await launcherApi.startVisualMode({
          matchId,
          config: {
            gamePresetKey: normalizeVisualGamePresetKey(visualModeStatus.gamePresetKey),
            sourceId: selectedVisualSourceId,
            sourceName: selectedSource?.name ?? null,
            captureFps: visualCaptureFps,
            activeRegionKey: visualActiveRegionKey,
            region: nextRegion,
            regions: nextRegions,
          },
        });
        updateVisualRegionDirty(false);
        applyVisualModeStatus(nextStatus || DEFAULT_VISUAL_MODE_STATUS);
        void refreshVisualReviewQueue();
        setStatus({
          tone: "success",
          title: nextStatus.alreadyRunning ? "Visual mode ready" : "Visual mode started",
          detail:
            "Screen monitoring is active in review-only mode. OCR and AI publishing stay blocked until manual review.",
        });
      },
    );

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
      resetVisualModeUiState();
      resetDashboard();
      setStatus(DEFAULT_STATUS);
    }
  };

  const runProductionPreflight = async (
    matchId: string,
    selectedMatch: MatchSummary,
  ) => {
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
          "Resolve the blocking preflight issues before starting the observer desk.",
      });
      return result;
    }

    setWorkflowState("PRODUCTION_READY");
    return result;
  };

  const startObserverFeedRuntime = async () => {
    if (!telemetryBridgeAvailable) {
      throw new Error("Launcher IPC is unavailable.");
    }

    if (!isProductionEligibleLifecycleStatus(selectedMatchLifecycleStatus)) {
      throw new Error("Current match is not eligible for observer feed start.");
    }

    const result = await launcherApi.startObserverFeed(
      requireActionableMatchId(),
    );
    setObserverFeedStatus(result || DEFAULT_OBSERVER_FEED_STATUS);
    setStatus({
      tone: "success",
      title: result.alreadyRunning
        ? "Observer feed ready"
        : "Observer feed started",
      detail:
        joinDetailParts(
          formatConnectorSetupDetail(result.connector),
          formatObserverFeedDetail(result),
          result.expiresIn ? `Lease expires in ${result.expiresIn}.` : null,
        ) || "Observer feed started.",
    });
    void refreshLiveMatchNow();
  };

  const stopObserverFeedRuntime = async () => {
    const result = await launcherApi.stopObserverFeed();
    setObserverFeedStatus(result || DEFAULT_OBSERVER_FEED_STATUS);
    setStatus({
      tone: "neutral",
      title: "Observer feed stopped",
      detail: "Observer feed runtime is no longer running.",
    });
  };

  const getReusableProductionModeResult = (matchId: string) => {
    if (
      productionModeResult?.matchId === matchId &&
      (productionModeResult.status === "READY" ||
        productionModeResult.status === "READY_WITH_WARNINGS")
    ) {
      return productionModeResult;
    }
    return null;
  };

  const toggleLiveDesk = async () =>
    runAction(
      observerFeedStatus.running ? "stop-observer-feed" : "start-live-desk",
      observerFeedStatus.running ? "Stopping observer feed" : "Starting live desk",
      async () => {
        if (observerFeedStatus.running) {
          await stopObserverFeedRuntime();
          return;
        }

        const matchId = requireSelectedMatchId();
        const selectedMatch =
          dashboard.matches.find((match) => match.id === matchId) || null;

        if (!selectedMatch) {
          throw new Error("No match selected.");
        }

        const result =
          getReusableProductionModeResult(matchId) ??
          (await runProductionPreflight(matchId, selectedMatch));
        if (result.status === "BLOCKED") {
          return;
        }

        await startObserverFeedRuntime();
      },
    );

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
      resetVisualModeUiState();
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
        }. Observer stays idle until you start it manually.`,
      });
      console.info(
        `[Flow] Next match prepared and ready: matchId=${suggestion.nextMatch.id}`,
      );
    });

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
      (visualModeStatus.running &&
        visualModeStatus.matchId === dashboard.selectedMatchId) ||
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

    if (
      (busyAction === "production-mode" || busyAction === "start-live-desk") &&
      workflowState === "PRODUCTION_CHECKING"
    ) {
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
    visualModeStatus.matchId,
    visualModeStatus.running,
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
        appVersion={LAUNCHER_VERSION}
        busy={authBusy}
        booting={booting}
        error={authError}
        onEmailChange={setEmail}
        onPasswordChange={setPassword}
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

  const lifecycleActionError = getMatchLifecycleActionError(
    selectedMatchLifecycleStatus,
  );
  const organizationId =
    session.organization?.id ?? session.user.organizationId ?? null;
  const organizationName = session.organization?.name ?? null;
  const observerRunningForSelectedMatch =
    observerFeedStatus.running &&
    observerFeedStatus.matchId === dashboard.selectedMatchId;
  const canStartObserverFeed =
    telemetryBridgeAvailable &&
    Boolean(dashboard.selectedMatchId) &&
    !observerFeedStatus.running &&
    !lifecycleActionError;
  const canStartVisualMode =
    visualModeStatus.available &&
    Boolean(dashboard.selectedMatchId) &&
    !visualModeStatus.running &&
    !telemetryStatus.running &&
    !observerFeedStatus.running &&
    !lifecycleActionError;

  return (
    <div className="desktop-shell">
      <DesktopSidebar
        session={session}
        workflowState={workflowState}
        observerRunning={observerRunningForSelectedMatch}
        currentRoute={currentRoute}
        onNavigate={setCurrentRoute}
        onLogout={() => void handleLogout()}
      />
      {currentRoute === "widgets" ? (
        <main className="desktop-main desktop-main--widgets">
          <WidgetsScreen
            organizationId={organizationId}
          />
        </main>
      ) : (
        <DashboardScreen
          organizationName={organizationName}
          liveMatch={liveMatch}
          workflowState={workflowState}
          productionStatus={selectedProductionModeResult?.status ?? null}
          tournaments={dashboard.tournaments}
          stages={dashboard.stages}
          matches={filteredMatches}
          selectedTournamentId={dashboard.selectedTournamentId}
          selectedStageId={dashboard.selectedStageId}
          selectedMatchId={dashboard.selectedMatchId}
          matchLifecycleStatus={selectedMatchLifecycleStatus}
          matchLocked={selectedMatchLocked}
          matchFinalizing={selectedMatchFinalizing}
          nextMatchSuggestion={nextMatchSuggestion}
          nextMatchLoading={nextMatchLoading}
          nextMatchError={nextMatchError}
          preparingNextMatch={busyAction === "prepare-next-match"}
          observerFeedStatus={observerFeedStatus}
          visualModeStatus={visualModeStatus}
          visualGamePresetLabels={VISUAL_GAME_PRESET_LABELS}
          visualSources={visualSources}
          selectedVisualSourceId={selectedVisualSourceId}
          visualCaptureFps={visualCaptureFps}
          visualActiveRegionKey={visualActiveRegionKey}
          visualRegionDraft={visualRegionDraft}
          visualRegionDirty={visualRegionDirty}
          visualReviewQueue={visualReviewQueue}
          visualSourcesLoading={visualSourcesLoading}
          visualModeError={visualModeError}
          canStartObserverFeed={canStartObserverFeed}
          canStartVisualMode={canStartVisualMode}
          status={status}
          busyAction={busyAction}
          loadingMatch={loadingMatch}
          onTournamentChange={(tournamentId) =>
            setDashboard((current) => ({
              ...current,
              selectedTournamentId: tournamentId,
            }))
          }
          onStageChange={(stageId) =>
            setDashboard((current) => ({
              ...current,
              selectedStageId: stageId,
            }))
          }
          onMatchChange={(matchId) =>
            setDashboard((current) => ({
              ...current,
              selectedMatchId: matchId,
            }))
          }
          onToggleLiveDesk={() => void toggleLiveDesk()}
          onVisualGamePresetChange={handleVisualGamePresetChange}
          onVisualSourceChange={handleVisualSourceChange}
          onVisualFpsChange={handleVisualFpsChange}
          onVisualRegionKeyChange={handleVisualRegionKeyChange}
          onVisualRegionDraftChange={handleVisualRegionDraftChange}
          onSaveVisualCalibration={() => void saveVisualCalibration()}
          onCaptureVisualReviewCandidate={() =>
            void captureVisualReviewCandidate()
          }
          onRunVisualReviewOcr={(id) => void runVisualReviewOcr(id)}
          onClearVisualReviewQueue={() => void clearVisualReviewQueue()}
          onIgnoreVisualReviewItem={(id) => void ignoreVisualReviewItem(id)}
          onMarkVisualReviewItemReviewed={(id) =>
            void markVisualReviewItemReviewed(id)
          }
          onRefreshVisualSources={() => void refreshVisualSources()}
          onToggleVisualMode={() => void toggleVisualMode()}
          onPrepareNextMatch={() => void prepareNextMatch()}
        />
      )}
    </div>
  );
}
