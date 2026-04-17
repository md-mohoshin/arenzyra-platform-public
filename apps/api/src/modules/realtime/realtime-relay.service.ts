import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type {
  HeartbeatSweepResult,
  RealtimeEnvelope,
  TelemetryBindPayload,
  TelemetryClientSession,
  WidgetClientSession,
  WidgetRealtimeEvent,
  WidgetSubscribePayload,
  WidgetSubscriptionKey,
} from './realtime-types';
import { REALTIME_HEARTBEAT_STALE_MS } from './realtime-types';

@Injectable()
export class RealtimeRelayService {
  private readonly logger = new Logger(RealtimeRelayService.name);

  private readonly telemetrySessions = new Map<
    string,
    TelemetryClientSession
  >();

  private readonly widgetSessions = new Map<string, WidgetClientSession>();

  private readonly widgetSubscriptions = new Map<string, Set<string>>();

  registerTelemetryClient(params: {
    send: (message: unknown) => void;
    remoteAddress?: string | null;
    source?: string | null;
  }): TelemetryClientSession {
    const session: TelemetryClientSession = {
      clientId: randomUUID(),
      kind: 'telemetry',
      client: { send: params.send },
      source: params.source ?? null,
      matchId: null,
      orgSlug: null,
      sessionId: null,
      remoteAddress: params.remoteAddress ?? null,
      metadata: {},
      connectedAt: Date.now(),
      lastHeartbeatAt: null,
      lastMessageAt: null,
      isStale: false,
    };

    this.telemetrySessions.set(session.clientId, session);
    return session;
  }

  registerWidgetClient(params: {
    send: (message: unknown) => void;
    remoteAddress?: string | null;
  }): WidgetClientSession {
    const session: WidgetClientSession = {
      clientId: randomUUID(),
      kind: 'widget',
      client: { send: params.send },
      remoteAddress: params.remoteAddress ?? null,
      subscription: null,
      connectedAt: Date.now(),
      lastHeartbeatAt: null,
      lastMessageAt: null,
      isStale: false,
    };

    this.widgetSessions.set(session.clientId, session);
    return session;
  }

  unregisterTelemetryClient(clientId: string): void {
    this.telemetrySessions.delete(clientId);
  }

  unregisterWidgetClient(clientId: string): void {
    const session = this.widgetSessions.get(clientId);
    if (!session) return;

    this.detachWidgetSubscription(session);
    this.widgetSessions.delete(clientId);
  }

  getTelemetrySession(clientId: string): TelemetryClientSession | null {
    return this.telemetrySessions.get(clientId) ?? null;
  }

  getWidgetSession(clientId: string): WidgetClientSession | null {
    return this.widgetSessions.get(clientId) ?? null;
  }

  bindTelemetryClient(
    clientId: string,
    envelope: RealtimeEnvelope<TelemetryBindPayload>,
  ): TelemetryClientSession | null {
    const session = this.telemetrySessions.get(clientId);
    if (!session) return null;

    const payload = this.asRecord(envelope.payload);
    const matchId =
      this.asString(envelope.matchId) ?? this.asString(payload.matchId);
    if (!matchId) {
      return null;
    }

    session.matchId = matchId;
    session.source = this.asString(envelope.source) ?? session.source;
    session.orgSlug = this.asString(payload.orgSlug) ?? session.orgSlug;
    session.sessionId = this.asString(payload.sessionId) ?? session.sessionId;
    session.metadata = this.asPlainObject(payload.metadata) ?? session.metadata;

    this.touchMessage(session, envelope.timestamp);
    return session;
  }

  subscribeWidgetClient(
    clientId: string,
    envelope: RealtimeEnvelope<WidgetSubscribePayload>,
  ): WidgetClientSession | null {
    const session = this.widgetSessions.get(clientId);
    if (!session) return null;

    const payload = this.asRecord(envelope.payload);
    const orgSlug = this.asString(payload.orgSlug);
    const widgetKey = this.asString(payload.widgetKey);

    if (!orgSlug || !widgetKey) {
      return null;
    }

    this.detachWidgetSubscription(session);

    session.subscription = {
      orgSlug,
      widgetKey,
      matchId: this.asString(payload.matchId) ?? null,
    };

    const subscriptionKey = this.subscriptionKey(session.subscription);
    const subscribers =
      this.widgetSubscriptions.get(subscriptionKey) ?? new Set<string>();

    subscribers.add(clientId);
    this.widgetSubscriptions.set(subscriptionKey, subscribers);

    this.touchMessage(session, envelope.timestamp);
    return session;
  }

  recordTelemetryHeartbeat(
    clientId: string,
    envelope?: RealtimeEnvelope,
  ): TelemetryClientSession | null {
    const session = this.telemetrySessions.get(clientId);
    if (!session) return null;

    this.touchHeartbeat(session, envelope?.timestamp);
    return session;
  }

  recordWidgetHeartbeat(
    clientId: string,
    envelope?: RealtimeEnvelope,
  ): WidgetClientSession | null {
    const session = this.widgetSessions.get(clientId);
    if (!session) return null;

    this.touchHeartbeat(session, envelope?.timestamp);
    return session;
  }

  relayTelemetryEnvelope(
    clientId: string,
    envelope: RealtimeEnvelope,
  ): {
    deliveredCount: number;
    matchId: string;
    session: TelemetryClientSession;
  } | null {
    const session = this.telemetrySessions.get(clientId);
    if (!session) return null;

    const matchId = this.asString(envelope.matchId) ?? session.matchId;
    if (!matchId) {
      return null;
    }

    session.matchId = matchId;
    session.source = this.asString(envelope.source) ?? session.source;
    this.touchMessage(session, envelope.timestamp);

    const event: WidgetRealtimeEvent = {
      type: 'widget_realtime_event',
      topic: 'telemetry.raw',
      matchId,
      payload: envelope.payload ?? null,
      timestamp: this.normalizeTimestamp(envelope.timestamp),
      sequence:
        typeof envelope.sequence === 'number' ? envelope.sequence : undefined,
      source: session.source,
    };

    let deliveredCount = 0;
    for (const widgetSession of this.widgetSessions.values()) {
      if (!this.matchesTelemetry(widgetSession, session, matchId)) {
        continue;
      }

      if (this.safeSend(widgetSession, event)) {
        deliveredCount += 1;
      }
    }

    return { deliveredCount, matchId, session };
  }

  markStaleClients(now = Date.now()): HeartbeatSweepResult {
    const result: HeartbeatSweepResult = {
      staleTelemetryClientIds: [],
      staleWidgetClientIds: [],
      recoveredTelemetryClientIds: [],
      recoveredWidgetClientIds: [],
    };

    for (const session of this.telemetrySessions.values()) {
      this.updateStaleState(session, now, result);
    }

    for (const session of this.widgetSessions.values()) {
      this.updateStaleState(session, now, result);
    }

    return result;
  }

  private updateStaleState(
    session: TelemetryClientSession | WidgetClientSession,
    now: number,
    result: HeartbeatSweepResult,
  ) {
    const previous = session.isStale;
    const next = this.isStale(session, now);

    if (previous === next) {
      return;
    }

    session.isStale = next;
    if (session.kind === 'telemetry') {
      if (next) {
        result.staleTelemetryClientIds.push(session.clientId);
      } else {
        result.recoveredTelemetryClientIds.push(session.clientId);
      }
      return;
    }

    if (next) {
      result.staleWidgetClientIds.push(session.clientId);
    } else {
      result.recoveredWidgetClientIds.push(session.clientId);
    }
  }

  private isStale(
    session: TelemetryClientSession | WidgetClientSession,
    now: number,
  ): boolean {
    const heartbeatAt = session.lastHeartbeatAt ?? 0;
    const messageAt = session.lastMessageAt ?? session.connectedAt;
    const freshest = Math.max(heartbeatAt, messageAt, session.connectedAt);
    return now - freshest > REALTIME_HEARTBEAT_STALE_MS;
  }

  private matchesTelemetry(
    widgetSession: WidgetClientSession,
    telemetrySession: TelemetryClientSession,
    matchId: string,
  ): boolean {
    const subscription = widgetSession.subscription;
    if (!subscription) {
      return false;
    }

    if (subscription.matchId && subscription.matchId !== matchId) {
      return false;
    }

    if (telemetrySession.orgSlug) {
      return subscription.orgSlug === telemetrySession.orgSlug;
    }

    return Boolean(subscription.matchId);
  }

  private safeSend(
    session: WidgetClientSession,
    message: WidgetRealtimeEvent,
  ): boolean {
    try {
      session.client.send(message);
      return true;
    } catch (error) {
      this.logger.warn(
        `widget relay send failed clientId=${session.clientId}: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
      return false;
    }
  }

  private detachWidgetSubscription(session: WidgetClientSession): void {
    if (!session.subscription) {
      return;
    }

    const subscriptionKey = this.subscriptionKey(session.subscription);
    const subscribers = this.widgetSubscriptions.get(subscriptionKey);

    subscribers?.delete(session.clientId);
    if (subscribers && subscribers.size === 0) {
      this.widgetSubscriptions.delete(subscriptionKey);
    }

    session.subscription = null;
  }

  private subscriptionKey(subscription: WidgetSubscriptionKey): string {
    return [
      subscription.orgSlug,
      subscription.widgetKey,
      subscription.matchId ?? '*',
    ].join(':');
  }

  private touchMessage(
    session: TelemetryClientSession | WidgetClientSession,
    timestamp?: number,
  ) {
    session.lastMessageAt = this.normalizeTimestamp(timestamp);
    session.isStale = false;
  }

  private touchHeartbeat(
    session: TelemetryClientSession | WidgetClientSession,
    timestamp?: number,
  ) {
    const normalized = this.normalizeTimestamp(timestamp);
    session.lastHeartbeatAt = normalized;
    session.lastMessageAt = normalized;
    session.isStale = false;
  }

  private normalizeTimestamp(timestamp?: number): number {
    if (
      typeof timestamp === 'number' &&
      Number.isFinite(timestamp) &&
      timestamp > 0
    ) {
      return timestamp;
    }
    return Date.now();
  }

  private asRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }
    return value as Record<string, unknown>;
  }

  private asPlainObject(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }
    return value as Record<string, unknown>;
  }

  private asString(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0
      ? value.trim()
      : null;
  }
}
