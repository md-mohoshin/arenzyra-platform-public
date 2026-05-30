export type LauncherSlot = {
  id: string;
  slotNumber: number;
  teamId: string | null;
  lobbyStatus: string | null;
  attendanceStatus?: string | null;
  playersInLobby: number | null;
  resolvedColor?: string | null;
  localLogoPath?: string | null;
  team: {
    id: string;
    name: string | null;
    tag: string | null;
    logoUrl: string | null;
    accentLight?: string | null;
    accentDark?: string | null;
  } | null;
};

export type ActionTone = "neutral" | "success" | "error";

export type StatusMessage = {
  tone: ActionTone;
  title: string;
  detail: string;
};

export type LauncherDefaults = {
  apiBase: string;
  teamAssetsDir: string;
  brandingConfigPath: string;
  shadowTrackerPath: string;
  telemetryBridgeAvailable?: boolean;
  sessionPath?: string;
};

export type LauncherSettings = {
  rememberedEmail?: string;
  keepSignedIn?: boolean;
  [key: string]: unknown;
};

export type LauncherConfig = {
  apiBase: string;
  apiBaseSource: "config" | "environment" | "fallback" | "explicit";
  apiBaseOverride: string | null;
  apiEnvironment: "auto" | "dev" | "lan" | "staging" | "production";
  shadowTrackerPath: string;
  settings: LauncherSettings;
};

export type LauncherUser = {
  id: string;
  email: string | null;
  name?: string | null;
  role: string | null;
  organizationId: string | null;
};

export type LauncherOrganization = {
  id: string;
  name: string | null;
} | null;

export type LauncherSession = {
  user: LauncherUser;
  organization: LauncherOrganization;
};

export type LauncherAccessReason =
  | "LICENSE_EXPIRED"
  | "LICENSE_MISSING"
  | "LICENSE_REVOKED"
  | "LICENSE_SUSPENDED"
  | "LICENSE_INVALID"
  | "LAUNCHER_PLAN_REQUIRED"
  | "SUBSCRIPTION_EXPIRED"
  | "OBSERVER_LIMIT_REACHED";

export type LauncherLicense = {
  id: string;
  type: string;
  status: string;
  expiresAt: string;
  maxObservers: number;
};

export type LauncherAccessState = {
  allowed: boolean;
  reason: LauncherAccessReason | null;
  license: LauncherLicense | null;
  machineId: string;
  activeSessions: number | null;
  maxObservers: number | null;
};

export type LauncherBootstrapStage =
  | "APP_INIT"
  | "CONFIG_LOAD"
  | "SESSION_RESTORE"
  | "AUTH_VALIDATION"
  | "LICENSE_CHECK"
  | "SEAT_ACQUIRE"
  | "START_WIDGET_SERVER"
  | "ASSET_VALIDATION"
  | "INITIAL_HEALTH_SNAPSHOT"
  | "READY_STATE";

export type LauncherBootstrapStageState = {
  status: "pending" | "in_progress" | "completed" | "failed";
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
  meta?: unknown;
};

export type LauncherBootstrapStatus = {
  stage: LauncherBootstrapStage | null;
  completedStages: LauncherBootstrapStage[];
  failedStages: LauncherBootstrapStage[];
  ready: boolean;
  startedAt: string | null;
  completedAt: string | null;
  stages: Record<LauncherBootstrapStage, LauncherBootstrapStageState>;
};

export type LauncherBootstrap = LauncherDefaults & {
  session: LauncherSession | null;
  access: LauncherAccessState | null;
};

export type LauncherLiveMatch = {
  apiBase: string;
  matchId: string | null;
  status: string | null;
  source: string | null;
  tournamentId: string | null;
  sessionId?: string | null;
  sessionName?: string | null;
  stageId: string | null;
  matchName?: string | null;
  matchNumber?: number | null;
  map?: string | null;
};

export type LauncherSyncCommand = {
  apiBase: string | null;
  tournamentId: string | null;
  matchId: string;
};

export type TournamentSummary = {
  id: string;
  name: string | null;
  status?: string | null;
  liveState?: string | null;
  stageCount?: number;
  matchCount?: number;
};

export type StageSummary = {
  id: string;
  name: string;
  order: number;
  maxTeams: number | null;
  liveState: string | null;
  liveAt?: string | null;
  endedAt?: string | null;
  groupCount: number;
  matchCount: number;
  groups: Array<{
    id: string;
    name: string | null;
    matchCount: number;
  }>;
};

export type MatchSummary = {
  id: string;
  name?: string | null;
  stageId?: string | null;
  groupId?: string | null;
  map?: string | null;
  status?: string | null;
  liveState?: string | null;
  dataMode?: string | null;
  matchNumber?: number | null;
  group?: {
    id: string;
    name: string | null;
  } | null;
};

export type MatchControlTelemetry = {
  transportConnected: boolean;
  packetsReceiving: boolean;
  telemetryAccepted: boolean;
  telemetryActive: boolean;
  lastTransportAt?: string | null;
  lastPacketAt?: string | null;
  lastTransportSource?: string | null;
  lastAcceptedAt?: string | null;
  lastAcceptedSource?: string | null;
  lastAcceptedSequence?: number | null;
  lastIgnoredAt?: string | null;
  lastIgnoredReason?: string | null;
};

export type MatchControlBinding = {
  sessionId: string | null;
  adapterKey: string | null;
  dataSource: string | null;
  dataMode: string | null;
  telemetryProvider?: string | null;
  sourceMode?: "MANUAL" | "API" | null;
  boundAt: string | null;
  lastSeenAt: string | null;
  isConfigured: boolean;
  isBound: boolean;
  isReady: boolean;
};

export type MatchControlSnapshot = {
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
  finalizationStartedAt?: string | null;
  finalizationDurationMs?: number | null;
  sourceMode?: string | null;
  telemetry: MatchControlTelemetry;
  binding: MatchControlBinding;
  locks?: {
    lifecycleLocked: boolean;
    resultsLocked: boolean;
    slotLocked: boolean;
    resultLockState?: "LOCKED" | "UNLOCKED";
    reason: string | null;
  };
};

export type NextMatchSuggestion = {
  currentMatchId: string;
  currentStatus: string | null;
  currentIsFinished: boolean;
  isAfterFinished: boolean;
  nextMatch: {
    id: string;
    name: string | null;
    matchNumber: number | null;
    status: string | null;
    tournamentId: string;
    stageId: string;
    groupId: string;
  } | null;
};

export type LauncherWorkflowState =
  | "NO_MATCH"
  | "MATCH_READY"
  | "MATCH_LIVE"
  | "PRODUCTION_CHECKING"
  | "PRODUCTION_READY"
  | "PRODUCTION_BLOCKED"
  | "PRODUCTION_LIVE"
  | "MATCH_FINISHED"
  | "NEXT_MATCH_AVAILABLE"
  | "NEXT_MATCH_PREPARED";

export type ProductionModeStatus = "READY" | "READY_WITH_WARNINGS" | "BLOCKED";

export type ProductionModeCheckKey =
  | "match"
  | "backend"
  | "widgets"
  | "assets"
  | "connector"
  | "shadow"
  | "telemetry"
  | "teams"
  | "player-assets"
  | "branding";

export type ProductionModeCheckResult = {
  key: ProductionModeCheckKey;
  label: string;
  status: "pass" | "warning" | "fail";
  blocking: boolean;
  message: string;
  meta?: Record<string, unknown>;
};

export type ProductionModeResult = {
  status: ProductionModeStatus;
  checkedAt: string;
  durationMs?: number;
  matchId: string;
  checks: ProductionModeCheckResult[];
  blockingIssues: string[];
  warnings: string[];
};

export type MatchPhase =
  | "plane"
  | "parachuting"
  | "combat"
  | "endgame"
  | "finished"
  | null;

export type TelemetryBridgeStatus = {
  running: boolean;
  matchId: string | null;
  sessionId?: string | null;
  packetsPerSecond: number;
  lastPacketTime: string | null;
  connectionStatus: string;
  phase: MatchPhase;
  gameTime: number | null;
  aliveTeams: number | null;
  alivePlayers: number | null;
  circleIndex: number | null;
  circleStatus: string | null;
  totalPackets: number;
  lastError: string | null;
  connectedToBackend: boolean;
  queueSize: number;
  lastSuccessAt: string | null;
  matchStatus?: string | null;
  isLocked?: boolean;
  isFinalizing?: boolean;
  resultFinalized?: boolean;
  finalizationStartedAt?: string | null;
  finalizationDurationMs?: number | null;
  transportConnected?: boolean;
  packetsReceiving?: boolean;
  telemetryAccepted?: boolean;
  telemetryActive?: boolean;
  lastTransportAt?: string | null;
  lastAcceptedAt?: string | null;
  lastIgnoredAt?: string | null;
  lastIgnoredReason?: string | null;
  shadowBaseUrl?: string | null;
};

export type FileFilter = {
  name: string;
  extensions: string[];
};

export type SyncTeamsResult = {
  matchId: string;
  matchSource: string;
  slotCount: number;
  syncedCount: number;
  teamAssetsDir: string;
  baseUrl?: string;
  playerAssetsDir?: string;
  slots: LauncherSlot[];
  playerPhotoSync?: {
    playerAssetsDir: string;
    totalPlayers: number;
    syncedCount: number;
    missingPhotoCount: number;
    skippedCount: number;
    failedCount: number;
  } | null;
  playerPhotoSyncSkipped?: boolean;
  slotRecovery?: {
    applied: boolean;
    attempted: boolean;
    currentAssignedCount: number;
    sourceAssignedCount: number;
    previousMatchId: string | null;
    previousMatchNumber: number | null;
    needsSync: boolean;
    message: string;
  } | null;
};

export type GenerateBrandingResult = {
  matchId: string;
  matchSource: string;
  teamCount: number;
  brandingConfigPath: string;
  teamAssetsDir: string;
  slots: LauncherSlot[];
  cacheHitCount?: number;
  renderedCount?: number;
  cachePath?: string | null;
  reusedSyncedSlots?: boolean;
};

export type ConnectorSetupStatus = {
  ok: boolean;
  status: string;
  sourcePath: string | null;
  targetPath: string | null;
  targetStrategy?: string | null;
  targetExisting?: boolean;
  shadowTrackerPath: string | null;
  manifestPath: string | null;
  backupPath: string | null;
  sourceHash: string | null;
  targetHash: string | null;
  installed: boolean;
  repaired: boolean;
  upToDate: boolean;
  requiresAdmin: boolean;
  error: string | null;
  checkedAt: string;
};

export type TelemetrySourceStatus = {
  pid: number | null;
  scriptPath: string | null;
  started: boolean;
  alreadyRunning: boolean;
  ready: boolean;
  baseUrl?: string | null;
  connector?: ConnectorSetupStatus | null;
};

export type ObserverFeedStatus = {
  enabled: boolean;
  running: boolean;
  mode: "off" | "local" | "direct";
  managed: boolean;
  matchId: string | null;
  sessionId: string | null;
  pid: number | null;
  scriptPath: string | null;
  ready: boolean;
  lastError: string | null;
  lastStartedAt: string | null;
  lastStoppedAt: string | null;
};

export type VisualModeRegionKey = "killFeed" | "teamPanel" | "scoreboard";
export type VisualGamePresetKey =
  | "pubgMobile"
  | "freeFire"
  | "valorant"
  | "codMobile";

export type VisualModeRegion = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type VisualModeRegions = Record<
  VisualModeRegionKey,
  VisualModeRegion | null
>;

export type VisualModeConfig = {
  gamePresetKey: VisualGamePresetKey;
  sourceId: string | null;
  sourceName: string | null;
  captureFps: number;
  region: VisualModeRegion | null;
  regions: VisualModeRegions;
  activeRegionKey: VisualModeRegionKey;
  coordinateMode: "percent";
  reviewBeforePublish: true;
  autoPublish: false;
  ocrEnabled: false;
  aiEnabled: false;
};

export type VisualCaptureSource = {
  id: string;
  name: string;
  displayId: string | null;
};

export type VisualModeStatus = VisualModeConfig & {
  available: boolean;
  running: boolean;
  matchId: string | null;
  sessionId: string | null;
  connectionStatus: string;
  framesSeen: number;
  changesDetected: number;
  lastFrameAt: string | null;
  lastChangeAt: string | null;
  lastError: string | null;
  startedAt: string | null;
  stoppedAt: string | null;
  pipeline: "screen-monitor";
  calibrationReady: boolean;
  reviewQueueSize: number;
  lastReviewCandidateAt: string | null;
};

export type StartVisualModeResult = VisualModeStatus & {
  alreadyRunning: boolean;
};

export type VisualReviewItemStatus = "pending" | "reviewed" | "ignored";
export type VisualReviewItemOcrStatus =
  | "not_started"
  | "processing"
  | "ready"
  | "needs_review"
  | "failed";

export type VisualReviewItem = {
  id: string;
  matchId: string | null;
  sessionId: string | null;
  gamePresetKey: VisualGamePresetKey;
  sourceId: string | null;
  sourceName: string | null;
  regionKey: VisualModeRegionKey;
  region: VisualModeRegion | null;
  capturedAt: string;
  status: VisualReviewItemStatus;
  confidence: number;
  rawText: string;
  rows: Array<Record<string, unknown>>;
  warnings: string[];
  reason: string;
  frameHash: string;
  imagePath: string | null;
  imageUrl: string | null;
  ocrStatus: VisualReviewItemOcrStatus;
  ocrError: string | null;
  ocrPreview: Record<string, unknown> | null;
  okCount: number;
  unresolvedCount: number;
  ambiguousCount: number;
  applyReady: boolean;
  reviewedAt?: string | null;
};

export type VisualReviewQueueState = {
  items: VisualReviewItem[];
  pendingCount: number;
  maxItems: number;
  reviewBeforePublish: true;
  autoPublish: false;
};

export type VisualReviewCaptureResult = {
  item: VisualReviewItem | null;
  queue: VisualReviewQueueState;
  status: VisualModeStatus;
};

export type StartObserverFeedResult = ObserverFeedStatus & {
  alreadyRunning: boolean;
  expiresIn?: string | null;
  connector?: ConnectorSetupStatus | null;
};

export type LaunchShadowTrackerResult = {
  pid: number | null;
  executablePath: string;
  telemetry:
    | (TelemetryBridgeStatus & {
        alreadyRunning?: boolean;
      })
    | null;
  telemetryError: string | null;
  telemetrySource: TelemetrySourceStatus | null;
  telemetrySourceError: string | null;
  connector?: ConnectorSetupStatus | null;
};

export type StartTelemetryBridgeResult = TelemetryBridgeStatus & {
  alreadyRunning: boolean;
  telemetrySource: TelemetrySourceStatus | null;
  telemetrySourceError: string | null;
  connector?: ConnectorSetupStatus | null;
};

export type WidgetServerStatus = {
  running: boolean;
  host: string | null;
  port: number | null;
  path: string | null;
  clientCount: number;
  lastBroadcastAt: number | null;
  startedAt?: number | null;
  baseUrl: string | null;
  localBaseUrl?: string | null;
  networkBaseUrl?: string | null;
};

export type LauncherMapAssetStatus = {
  key: string;
  label: string;
  required: boolean;
  preferredImagePath: string;
  resolvedImagePath: string | null;
  imageUrl: string;
  fallbackImageUrl: string;
  assetAbsolutePath: string | null;
  fallbackAssetPath: string | null;
  assetAvailable: boolean;
};

export type LauncherAssetStatus = {
  checkedAt: number | null;
  assetsRoot: string | null;
  routePrefix: string;
  fallbackAssetUrl: string;
  fallbackAssetPath: string | null;
  total: number;
  available: number;
  missing: number;
  availableKeys: string[];
  missingKeys: string[];
  requiredTotal: number;
  requiredAvailable: number;
  requiredMissing: number;
  requiredAvailableKeys: string[];
  requiredMissingKeys: string[];
  maps: Record<string, LauncherMapAssetStatus>;
};

export type LauncherHealthLevel = "healthy" | "warning" | "critical";

export type LauncherBackendHealth = {
  apiBase: string;
  reachable: boolean;
  statusCode: number | null;
  lastSuccessAt: string | null;
  lastCheckedAt: string | null;
  lastError: string | null;
};

export type LauncherAuthHealth = {
  authenticated: boolean;
  tokenValid: boolean;
  hasRefreshToken: boolean;
  userId: string | null;
  organizationId: string | null;
  lastCheckedAt: string | null;
  lastError: string | null;
};

export type LauncherLicenseHealth = {
  licenseValid: boolean;
  seatActive: boolean;
  reason: LauncherAccessReason | null;
  machineId: string | null;
  activeSessions: number | null;
  maxObservers: number | null;
  license: LauncherLicense | null;
};

export type LauncherWidgetHealth = {
  running: boolean;
  reachable: boolean;
  port: number | null;
  baseUrl: string | null;
  lastSuccessAt: string | null;
  lastCheckedAt: string | null;
  lastError: string | null;
};

export type LauncherAssetsHealth = {
  requiredTotal: number;
  requiredAvailable: number;
  requiredMissingKeys: string[];
  checkedAt: string | null;
};

export type LauncherShadowHealth = {
  reachable: boolean;
  baseUrl: string | null;
  lastResponseAt: string | null;
  lastCheckedAt: string | null;
  lastError: string | null;
};

export type LauncherMatchStateHealth = {
  status: string | null;
  isLocked: boolean;
  isFinalizing: boolean;
  finalizationStartedAt: string | null;
  finalizationDurationMs: number | null;
};

export type LauncherMatchFlowHealth = {
  currentMatchId: string | null;
  currentStatus: string | null;
  nextMatchSuggestedId: string | null;
  nextMatchAvailable: boolean;
  workflowState: LauncherWorkflowState;
};

export type LauncherHealthStatus = {
  checkedAt: string | null;
  backend: LauncherBackendHealth;
  auth: LauncherAuthHealth;
  license: LauncherLicenseHealth;
  telemetry: TelemetryBridgeStatus;
  matchState: LauncherMatchStateHealth;
  matchFlow: LauncherMatchFlowHealth;
  productionMode: LauncherProductionModeHealth;
  widgets: LauncherWidgetHealth;
  assets: LauncherAssetsHealth;
  shadow: LauncherShadowHealth;
  overallStatus: LauncherHealthLevel;
  issues: string[];
};

export type LauncherProductionModeHealth = {
  workflowState: LauncherWorkflowState;
  status: ProductionModeStatus | null;
  matchId: string | null;
  blockingIssueCount: number;
  warningCount: number;
  lastCheckedAt: string | null;
};

export type LauncherLogEntry = {
  timestamp: string;
  level: "info" | "warn" | "error";
  scope: string;
  message: string;
  meta?: unknown;
  target?: string;
};

export type WidgetCatalogItemState = {
  widgetKey: string;
  widgetInstanceId: string | null;
  widgetInstanceKey: string | null;
  organizationSlug: string | null;
  matchId: string | null;
  tournamentId: string | null;
  approved: boolean | null;
  message: string | null;
};

export type WidgetCatalogState = {
  organizationId: string | null;
  organizationSlug: string | null;
  enforced: boolean;
  items: Record<string, WidgetCatalogItemState>;
};

export type WidgetHotkeyDirection = "auto" | "left" | "right" | "up" | "down";

export type WidgetHotkeyControlSelection = {
  id: string;
  widgetKey: string;
  label: string;
  enabled: boolean;
  direction: WidgetHotkeyDirection;
};

export type WidgetHotkeyControlConfig = {
  enabled: boolean;
  key: string;
  transitionMs: number;
  widgets: WidgetHotkeyControlSelection[];
};

export type WidgetHotkeyControlStatus = {
  featureKey: "feature.widget-hotkey-control";
  approved: boolean;
  canUse: boolean;
  registered: boolean;
  active: boolean;
  key: string;
  keyCode: number | null;
  error: string | null;
  reason: string | null;
  config: WidgetHotkeyControlConfig;
};

export type AiCasterSettings = {
  enabled: boolean;
  muted: boolean;
  mode: "professional" | "hype";
  voiceMode: "single" | "dual";
  primaryVoice: string;
  secondaryVoice: string;
  language: string;
  talkFrequency: "low" | "balanced" | "high";
  minGapMs: number;
  maxLineWords: number;
  speakingSpeed: "slow" | "normal" | "fast";
  expression: "neutral" | "professional" | "energetic" | "dramatic";
  priority: "high-value" | "balanced" | "all";
  profanityFilter: boolean;
  logLines: boolean;
  allowedRoles: Array<"ADMIN" | "ORGANIZER">;
};

export type AiCasterAccessState = {
  featureKey: "ai-caster";
  widgetKey: "ai-caster";
  organization: {
    id: string;
    slug: string;
    name: string | null;
  } | null;
  approved: boolean;
  approval: {
    widgetKey: string;
    isApproved: boolean;
    approvedAt: string | null;
    approvedBy: string | null;
  } | null;
  canConfigure: boolean;
  canUse: boolean;
  reason: string | null;
  settings: AiCasterSettings;
};

export type AiCasterVoicePreviewPayload = {
  organizationId?: string | null;
  voice?: string;
  role?: "play-by-play" | "analyst";
  text?: string;
  mode?: AiCasterSettings["mode"];
  speakingSpeed?: AiCasterSettings["speakingSpeed"];
  expression?: AiCasterSettings["expression"];
};

export type AiCasterVoicePreviewResponse = {
  audioBase64: string;
  mimeType: string;
  model: string;
  voice: string;
  role: "play-by-play" | "analyst";
  text: string;
};

export type AiCasterLine = {
  id: string;
  text: string;
  voice: string;
  role: "play-by-play" | "analyst" | "system";
  style: string;
  priority: string;
  createdAt: number;
  source: string;
  speakingSpeed?: string;
  expression?: string;
  language?: string;
};

export type AiCasterRuntimeState = {
  ok: boolean;
  status: "locked" | "standby" | "live" | "error";
  reason: string | null;
  settings: AiCasterSettings;
  currentLine: AiCasterLine | null;
  history: AiCasterLine[];
};

export type MapFocusCenter = {
  x: number;
  y: number;
};

export type WatchTarget = {
  id: string;
  label: string;
  score: number;
  centerX?: number;
  centerY?: number;
  category: string | null;
  involvedTeamIds: string[];
  reason: string[];
  updatedAt: number;
  priority: number;
  operatorWatchingNow: boolean;
  operatorPinned: boolean;
  operatorSuppressed: boolean;
  operatorReplayCandidate: boolean;
  mapKey?: string | null;
};

export type ProductionAlert = {
  id: string;
  type: string;
  severity: string;
  label: string;
  centerX?: number;
  centerY?: number;
  involvedTeamIds: string[];
  createdAt: number;
  expiresAt?: number | null;
  operatorReplayCandidate: boolean;
};

export type ReplayCandidate = {
  id: string;
  sourceType: "watch_target" | "alert" | "manual";
  sourceId: string;
  label: string;
  centerX?: number;
  centerY?: number;
  involvedTeamIds: string[];
  createdAt: number;
  expiresAt?: number | null;
};

export type OperatorState = {
  watchingNowTargetId?: string | null;
  primaryPinnedTeamIds: string[];
  primaryPinnedTargetIds: string[];
  replayCandidateIds: string[];
  dismissedAlertIds: string[];
  suppressedTargetIds: string[];
  updatedAt: number;
};

export type OperatorDetails = {
  watchingNowTarget: WatchTarget | null;
  suppressedTargets: WatchTarget[];
  dismissedAlerts: ProductionAlert[];
  updatedAt: number;
};

export type OperatorWorkflowState = {
  selectedTargetId?: string | null;
  selectedAlertId?: string | null;
  highlightedTargetId?: string | null;
  mapFocusCenter?: MapFocusCenter | null;
  mapFocusUntil?: number | null;
  lastAction?: string | null;
  updatedAt: number;
};

export type OperatorWorkflowConfig = {
  mapFocusHighlightMs?: number | null;
  operatorActionStatusMs?: number | null;
  maxSelectableWatchTargets?: number | null;
};

export type CameraAssistRecommendation = {
  action: "stay" | "switch" | "prepare";
  currentTargetId?: string | null;
  recommendedTargetId?: string | null;
  backupTargetIds: string[];
  confidence: number;
  reasons: string[];
  scoreDelta?: number | null;
  generatedAt: number;
};

export type CameraAssistHistoryEntry = {
  action: string;
  currentTargetId?: string | null;
  recommendedTargetId?: string | null;
  generatedAt: number;
};

export type CameraAssistDebugState = {
  currentTargetScore?: number | null;
  recommendedTargetScore?: number | null;
  scoreDelta?: number | null;
  dwellRemainingMs?: number | null;
  switchCooldownRemainingMs?: number | null;
  emergencySwitchEligible?: boolean;
  flapGuardActive?: boolean;
  lastAction?: string | null;
  lastSwitchAt?: number | null;
  recentRecommendationHistory?: CameraAssistHistoryEntry[];
};

export type CameraAssistPayload = {
  recommendation: CameraAssistRecommendation;
  currentWatchedTargetId?: string | null;
  topWatchTargets: WatchTarget[];
  activeAlerts: ProductionAlert[];
  observerState: {
    watchingNowTargetId?: string | null;
    primaryPinnedTeamIds: string[];
    primaryPinnedTargetIds: string[];
  };
  history: {
    lastSwitchAt?: number | null;
    previousTargetId?: string | null;
    lastAction?: string | null;
    recentRecommendationHistory: CameraAssistHistoryEntry[];
  };
  debug?: CameraAssistDebugState | null;
  updatedAt: number;
};

export type PinState = {
  pinnedTeams: string[];
  pinnedTargetIds: string[];
  pinnedTargets: WatchTarget[];
};

export type ObserverCommandCenterTelemetry = {
  connected: boolean;
  lastUpdateAt?: number | null;
  mapKey?: string | null;
  playerCount?: number | null;
  phase?: string | null;
  connectionStatus?: string | null;
  matchId?: string | null;
  packetsPerSecond?: number | null;
  aliveTeams?: number | null;
  alivePlayers?: number | null;
  gameTime?: number | null;
  circleIndex?: number | null;
  circleStatus?: string | null;
  lastError?: string | null;
  totalPackets?: number | null;
};

export type ObserverCommandCenterWidgetServer = {
  running: boolean;
  port?: number | null;
  host?: string | null;
  path?: string | null;
  clientCount?: number | null;
  lastBroadcastAt?: number | null;
};

export type ObserverCommandCenterSnapshot = {
  telemetry: ObserverCommandCenterTelemetry;
  widgetServer: ObserverCommandCenterWidgetServer;
  mapContext: {
    mapKey?: string | null;
    sourceMapName?: string | null;
    definition?: Record<string, unknown> | null;
    timestamp?: number | null;
  } | null;
  mapKey?: string | null;
  recommendation: CameraAssistRecommendation | null;
  cameraAssistPayload: CameraAssistPayload | null;
  observerControlSuggestion: Record<string, unknown> | null;
  observerOperatorSuggestion: Record<string, unknown> | null;
  watchTargets: WatchTarget[];
  alerts: ProductionAlert[];
  replayCandidates: ReplayCandidate[];
  operatorState: OperatorState | null;
  operatorDetails: OperatorDetails | null;
  operatorWorkflowState: OperatorWorkflowState | null;
  operatorWorkflowConfig: OperatorWorkflowConfig | null;
  pinState: PinState | null;
  updatedAt: number;
};

export type ObserverCommandActionResponse = {
  ok: boolean;
  path: string;
  actionResult: Record<string, unknown> | null;
  snapshot: ObserverCommandCenterSnapshot;
};
