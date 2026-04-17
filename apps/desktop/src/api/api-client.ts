import type {
  LauncherAccessReason,
  LauncherAssetStatus,
  FileFilter,
  GenerateBrandingResult,
  LauncherBootstrap,
  LauncherBootstrapStatus,
  LauncherConfig,
  ConnectorSetupStatus,
  LauncherHealthStatus,
  LauncherLogEntry,
  ObserverCommandActionResponse,
  ObserverCommandCenterSnapshot,
  LauncherLiveMatch,
  MatchControlSnapshot,
  ObserverFeedStatus,
  LauncherSession,
  LauncherSyncCommand,
  LauncherWorkflowState,
  LaunchShadowTrackerResult,
  MatchSummary,
  NextMatchSuggestion,
  ProductionModeResult,
  StartObserverFeedResult,
  StageSummary,
  StartTelemetryBridgeResult,
  SyncTeamsResult,
  TelemetryBridgeStatus,
  TournamentSummary,
  WidgetCatalogState,
  WidgetServerStatus,
} from "../types";

type LauncherBridge = {
  invoke: (channel: string, payload?: unknown) => Promise<unknown>;
  onSyncPending: (handler: () => void) => (() => void) | void;
};

type ConfigBridge = {
  get?: () => Promise<LauncherConfig>;
  getConfig?: () => Promise<LauncherConfig>;
  set?: (key: string, value: unknown) => Promise<LauncherConfig>;
  setConfig?: (key: string, value: unknown) => Promise<LauncherConfig>;
  subscribe?: (callback: (config: LauncherConfig) => void) => (() => void) | void;
  subscribeConfig?: (
    callback: (config: LauncherConfig) => void,
  ) => (() => void) | void;
};

type AssetsBridge = {
  getStatus?: () => Promise<LauncherAssetStatus>;
};

type TelemetryBridge = {
  getStatus?: () => Promise<TelemetryBridgeStatus>;
};

type ObserverFeedBridge = {
  getStatus?: () => Promise<ObserverFeedStatus>;
};

type HealthBridge = {
  getStatus?: () => Promise<LauncherHealthStatus>;
};

type BootstrapBridge = {
  getStatus?: () => Promise<LauncherBootstrapStatus>;
};

type LogsBridge = {
  getRecent?: (scope?: string, limit?: number) => Promise<LauncherLogEntry[]>;
};

type SystemBridge = {
  pathExists?: (targetPath: string) => boolean;
  isFile?: (targetPath: string) => boolean;
};

type ArenzyraBridge = {
  launcher?: LauncherBridge;
  config?: ConfigBridge;
  assets?: AssetsBridge;
  telemetry?: TelemetryBridge;
  observerFeed?: ObserverFeedBridge;
  health?: HealthBridge;
  bootstrap?: BootstrapBridge;
  logs?: LogsBridge;
  system?: SystemBridge;
};

const UNAUTHORIZED_MESSAGE = "ARENZYRA_AUTH_UNAUTHORIZED";
const ACCESS_DENIED_MESSAGE = "ARENZYRA_LAUNCHER_ACCESS_DENIED";

export class LauncherUnauthorizedError extends Error {
  constructor(message = "Session expired. Please log in again.") {
    super(message);
    this.name = "LauncherUnauthorizedError";
  }
}

export class LauncherAccessDeniedError extends Error {
  reason: LauncherAccessReason | null;

  constructor(reason: LauncherAccessReason | null) {
    super("Launcher access is blocked.");
    this.name = "LauncherAccessDeniedError";
    this.reason = reason;
  }
}

const getBridge = (): ArenzyraBridge => {
  const bridge = (
    window as Window &
      typeof globalThis & {
        arenzyra?: ArenzyraBridge;
      }
  ).arenzyra;

  if (!bridge?.launcher) {
    throw new Error("Arenzyra preload bridge is unavailable. Start this UI inside Electron.");
  }

  return bridge;
};

const getOptionalBridge = (): ArenzyraBridge | null => {
  const bridge = (
    window as Window &
      typeof globalThis & {
        arenzyra?: ArenzyraBridge;
      }
  ).arenzyra;

  return bridge?.launcher ? bridge : null;
};

const getConfigBridge = (): ConfigBridge => {
  const configBridge = getBridge().config;
  if (!configBridge) {
    throw new Error("Arenzyra config bridge is unavailable.");
  }
  return configBridge;
};

const getAssetsBridge = (): AssetsBridge => getBridge().assets || {};

const getTelemetryBridge = (): TelemetryBridge => getBridge().telemetry || {};

const getObserverFeedBridge = (): ObserverFeedBridge =>
  getBridge().observerFeed || {};

const getHealthBridge = (): HealthBridge => getBridge().health || {};

const getBootstrapBridge = (): BootstrapBridge => getBridge().bootstrap || {};

const getLogsBridge = (): LogsBridge => getBridge().logs || {};

const getSystemBridge = (): SystemBridge => getBridge().system || {};

export const getErrorMessage = (error: unknown) => {
  if (error instanceof LauncherUnauthorizedError) {
    return error.message;
  }
  if (error instanceof LauncherAccessDeniedError) {
    return error.message;
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return "Action failed.";
};

export const isUnauthorizedError = (error: unknown) =>
  error instanceof LauncherUnauthorizedError ||
  getErrorMessage(error).includes(UNAUTHORIZED_MESSAGE);

export const isAccessDeniedError = (error: unknown) =>
  error instanceof LauncherAccessDeniedError ||
  getErrorMessage(error).includes(ACCESS_DENIED_MESSAGE);

const parseAccessDeniedReason = (
  message: string,
): LauncherAccessReason | null => {
  const match = message.match(
    /ARENZYRA_LAUNCHER_ACCESS_DENIED::([A-Z_]+)/,
  );
  return match ? (match[1] as LauncherAccessReason) : null;
};

const invoke = async <T,>(channel: string, payload?: unknown): Promise<T> => {
  try {
    return (await getBridge().launcher!.invoke(channel, payload)) as T;
  } catch (error) {
    const message = getErrorMessage(error);
    if (message.includes(ACCESS_DENIED_MESSAGE)) {
      throw new LauncherAccessDeniedError(parseAccessDeniedReason(message));
    }
    if (message.includes(UNAUTHORIZED_MESSAGE)) {
      throw new LauncherUnauthorizedError();
    }
    throw new Error(message);
  }
};

export const launcherApi = {
  bootstrap(apiBase?: string) {
    return invoke<LauncherBootstrap>("launcher:bootstrap", { apiBase });
  },

  login(
    email: string,
    password: string,
    apiBase: string,
    keepSignedIn = true,
  ) {
    return invoke<{
      apiBase: string;
      session: LauncherSession;
      access: LauncherBootstrap["access"];
    }>("launcher:login", {
      email,
      password,
      apiBase,
      keepSignedIn,
    });
  },

  logout() {
    return invoke<{ ok: boolean }>("launcher:logout");
  },

  getLiveMatch(apiBase?: string) {
    return invoke<LauncherLiveMatch>("launcher:getLiveMatch", { apiBase });
  },

  getNextMatchSuggestion(matchId: string, suggestedMatchId?: string | null) {
    return invoke<NextMatchSuggestion>("launcher:getNextMatchSuggestion", {
      matchId,
      suggestedMatchId,
    });
  },

  listTournaments() {
    return invoke<TournamentSummary[]>("launcher:listTournaments");
  },

  listStages(tournamentId: string) {
    return invoke<StageSummary[]>("launcher:listStages", { tournamentId });
  },

  listMatches(tournamentId: string) {
    return invoke<MatchSummary[]>("launcher:listMatches", { tournamentId });
  },

  getMatchControl(matchId: string) {
    return invoke<MatchControlSnapshot>("launcher:getMatchControl", {
      matchId,
    });
  },

  syncTeams(matchId: string) {
    return invoke<SyncTeamsResult>("launcher:syncTeams", { matchId });
  },

  generateBranding(matchId: string) {
    return invoke<GenerateBrandingResult>("launcher:generateBranding", {
      matchId,
    });
  },

  chooseFile(title: string, filters: FileFilter[], defaultPath: string) {
    return invoke<string | null>("launcher:chooseFile", {
      title,
      filters,
      defaultPath,
    });
  },

  copyText(text: string) {
    return invoke<{ ok: boolean }>("launcher:copyText", {
      text,
    });
  },

  openExternal(url: string) {
    return invoke<{ ok: boolean }>("launcher:openExternal", {
      url,
    });
  },

  getTelemetryStatus() {
    return invoke<TelemetryBridgeStatus>("launcher:getTelemetryStatus");
  },

  getObserverFeedStatus() {
    const bridge = getObserverFeedBridge();
    if (!bridge.getStatus) {
      return invoke<ObserverFeedStatus>("launcher:getObserverFeedStatus");
    }
    return bridge.getStatus();
  },

  getConnectorStatus() {
    return invoke<ConnectorSetupStatus>("launcher:getConnectorStatus");
  },

  repairConnector(shadowTrackerPath?: string | null) {
    return invoke<ConnectorSetupStatus>("launcher:repairConnector", {
      shadowTrackerPath,
    });
  },

  getWidgetServerStatus() {
    return invoke<WidgetServerStatus>("launcher:getWidgetServerStatus");
  },

  getWidgetCatalogState(organizationId: string | null, widgetKeys: string[]) {
    return invoke<WidgetCatalogState>("launcher:getWidgetCatalogState", {
      organizationId,
      widgetKeys,
    });
  },

  getObserverCommandCenterSnapshot(mapKey?: string | null) {
    return invoke<ObserverCommandCenterSnapshot>(
      "launcher:getObserverCommandCenterSnapshot",
      { mapKey },
    );
  },

  runObserverCommandAction(path: string, mapKey?: string | null) {
    return invoke<ObserverCommandActionResponse>("launcher:runObserverCommandAction", {
      path,
      mapKey,
    });
  },

  launchShadowTracker(shadowTrackerPath: string, matchId: string) {
    return invoke<LaunchShadowTrackerResult>("launcher:launchShadowTracker", {
      shadowTrackerPath,
      matchId,
    });
  },

  startTelemetryBridge(matchId: string) {
    return invoke<StartTelemetryBridgeResult>("launcher:startTelemetryBridge", {
      matchId,
    });
  },

  enterProductionMode(payload: {
    matchId: string;
    shadowTrackerPath?: string | null;
    selectedMatch?: Pick<
      MatchSummary,
      "id" | "name" | "map" | "status" | "liveState" | "matchNumber"
    > | null;
  }) {
    return invoke<ProductionModeResult>("launcher:enterProductionMode", payload);
  },

  stopTelemetryBridge() {
    return invoke<TelemetryBridgeStatus>("launcher:stopTelemetryBridge");
  },

  startObserverFeed(matchId: string) {
    return invoke<StartObserverFeedResult>("launcher:startObserverFeed", {
      matchId,
    });
  },

  stopObserverFeed() {
    return invoke<ObserverFeedStatus>("launcher:stopObserverFeed");
  },

  resetTelemetryForMatchSwitch() {
    return invoke<TelemetryBridgeStatus>("launcher:resetTelemetryForMatchSwitch");
  },

  updateMatchFlowState(payload: {
    currentMatchId: string | null;
    currentStatus: string | null;
    nextMatchSuggestedId: string | null;
    nextMatchAvailable: boolean;
    workflowState: LauncherWorkflowState;
  }) {
    return invoke<void>("launcher:updateMatchFlowState", payload);
  },

  consumePendingSyncCommand() {
    return invoke<LauncherSyncCommand | null>("launcher:consumePendingSyncCommand");
  },

  onSyncPending(handler: () => void) {
    const bridge = getOptionalBridge();
    if (!bridge?.launcher?.onSyncPending) {
      return () => {};
    }

    const unsubscribe = bridge.launcher.onSyncPending(handler);
    return typeof unsubscribe === "function" ? unsubscribe : () => {};
  },
};

export const launcherConfig = {
  async getConfig() {
    const configBridge = getConfigBridge();
    const getter = configBridge.getConfig || configBridge.get;
    if (!getter) {
      throw new Error("Arenzyra config getter is unavailable.");
    }
    return getter();
  },

  async setConfig(key: string, value: unknown) {
    const configBridge = getConfigBridge();
    const setter = configBridge.setConfig || configBridge.set;
    if (!setter) {
      throw new Error("Arenzyra config setter is unavailable.");
    }
    return setter(key, value);
  },

  subscribeConfig(callback: (config: LauncherConfig) => void) {
    const bridge = getOptionalBridge();
    if (!bridge?.config) {
      return () => {};
    }

    const configBridge = bridge.config;
    const subscribe = configBridge.subscribeConfig || configBridge.subscribe;
    if (!subscribe) {
      return () => {};
    }
    const unsubscribe = subscribe(callback);
    return typeof unsubscribe === "function" ? unsubscribe : () => {};
  },

  pathExists(targetPath: string) {
    return getSystemBridge().pathExists?.(targetPath) === true;
  },

  isFile(targetPath: string) {
    return getSystemBridge().isFile?.(targetPath) === true;
  },
};

export const launcherAssets = {
  async getStatus() {
    const assetsBridge = getAssetsBridge();
    if (!assetsBridge.getStatus) {
      throw new Error("Arenzyra assets bridge is unavailable.");
    }
    return assetsBridge.getStatus();
  },
};

export const launcherTelemetry = {
  async getStatus() {
    const telemetryBridge = getTelemetryBridge();
    if (telemetryBridge.getStatus) {
      return telemetryBridge.getStatus();
    }
    return launcherApi.getTelemetryStatus();
  },
};

export const launcherHealth = {
  async getStatus() {
    const healthBridge = getHealthBridge();
    if (!healthBridge.getStatus) {
      throw new Error("Arenzyra health bridge is unavailable.");
    }
    return healthBridge.getStatus();
  },
};

export const launcherBootstrapStatus = {
  async getStatus() {
    const bootstrapBridge = getBootstrapBridge();
    if (!bootstrapBridge.getStatus) {
      throw new Error("Arenzyra bootstrap bridge is unavailable.");
    }
    return bootstrapBridge.getStatus();
  },
};

export const launcherLogs = {
  async getRecent(scope?: string, limit?: number) {
    const logsBridge = getLogsBridge();
    if (!logsBridge.getRecent) {
      throw new Error("Arenzyra logs bridge is unavailable.");
    }
    return logsBridge.getRecent(scope, limit);
  },
};
