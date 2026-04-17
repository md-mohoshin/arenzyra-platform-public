export type RealtimeEnvelope<TPayload = unknown> = {
  type: string;
  source?: string;
  matchId?: string;
  timestamp?: number;
  sequence?: number;
  payload?: TPayload;
};

export interface TelemetryBindPayload {
  matchId?: string;
  sessionId?: string;
  orgSlug?: string;
  metadata?: Record<string, unknown>;
}

export interface WidgetSubscribePayload {
  orgSlug: string;
  widgetKey: string;
  matchId?: string | null;
}

export interface WidgetSubscriptionKey {
  orgSlug: string;
  widgetKey: string;
  matchId?: string | null;
}

export interface RealtimeClientHandle {
  send: (message: unknown) => void;
}

export interface RealtimeClientLifecycle {
  connectedAt: number;
  lastHeartbeatAt: number | null;
  lastMessageAt: number | null;
  isStale: boolean;
}

export interface TelemetryClientSession extends RealtimeClientLifecycle {
  clientId: string;
  kind: 'telemetry';
  client: RealtimeClientHandle;
  source: string | null;
  matchId: string | null;
  orgSlug: string | null;
  sessionId: string | null;
  remoteAddress: string | null;
  metadata: Record<string, unknown>;
}

export interface WidgetClientSession extends RealtimeClientLifecycle {
  clientId: string;
  kind: 'widget';
  client: RealtimeClientHandle;
  remoteAddress: string | null;
  subscription: WidgetSubscriptionKey | null;
}

export interface WidgetRealtimeEvent<TPayload = unknown> {
  type: 'widget_realtime_event';
  topic: 'telemetry.raw';
  matchId: string | null;
  payload: TPayload;
  timestamp: number;
  sequence?: number;
  source?: string | null;
}

export interface HeartbeatSweepResult {
  staleTelemetryClientIds: string[];
  staleWidgetClientIds: string[];
  recoveredTelemetryClientIds: string[];
  recoveredWidgetClientIds: string[];
}

export const REALTIME_TELEMETRY_PATH = '/ws/telemetry';

export const REALTIME_WIDGET_PATH = '/ws/widgets';

export const REALTIME_HEARTBEAT_STALE_MS = 30_000;

export const REALTIME_HEARTBEAT_SWEEP_MS = 5_000;
