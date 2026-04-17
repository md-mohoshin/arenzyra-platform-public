/// <reference types="vite/client" />

import type {
  LauncherAssetStatus,
  LauncherBootstrapStatus,
  LauncherConfig,
  LauncherHealthStatus,
  LauncherLogEntry,
  TelemetryBridgeStatus,
} from "./types";

type ArenzyraBridge = {
  launcher?: {
    invoke: (channel: string, payload?: unknown) => Promise<unknown>;
    onSyncPending: (handler: () => void) => (() => void) | void;
  };
  config?: {
    get?: () => Promise<LauncherConfig>;
    getConfig?: () => Promise<LauncherConfig>;
    set?: (key: string, value: unknown) => Promise<LauncherConfig>;
    setConfig?: (key: string, value: unknown) => Promise<LauncherConfig>;
    subscribe?: (
      callback: (config: LauncherConfig) => void,
    ) => (() => void) | void;
    subscribeConfig?: (
      callback: (config: LauncherConfig) => void,
    ) => (() => void) | void;
  };
  assets?: {
    getStatus?: () => Promise<LauncherAssetStatus>;
  };
  telemetry?: {
    getStatus?: () => Promise<TelemetryBridgeStatus>;
  };
  health?: {
    getStatus?: () => Promise<LauncherHealthStatus>;
  };
  bootstrap?: {
    getStatus?: () => Promise<LauncherBootstrapStatus>;
  };
  logs?: {
    getRecent?: (scope?: string, limit?: number) => Promise<LauncherLogEntry[]>;
  };
  system?: {
    pathExists?: (targetPath: string) => boolean;
    isFile?: (targetPath: string) => boolean;
  };
};

declare global {
  interface Window {
    arenzyra?: ArenzyraBridge;
  }
}
