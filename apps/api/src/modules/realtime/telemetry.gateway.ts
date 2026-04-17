import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import type { IncomingMessage } from 'http';
import WebSocket from 'ws';
import { RealtimeRelayService } from './realtime-relay.service';
import type { RealtimeEnvelope, TelemetryBindPayload } from './realtime-types';
import { REALTIME_TELEMETRY_PATH } from './realtime-types';

type TelemetrySocket = WebSocket & { __arenzyraClientId?: string };

@WebSocketGateway({
  path: REALTIME_TELEMETRY_PATH,
})
export class TelemetryGateway {
  private readonly logger = new Logger(TelemetryGateway.name);

  constructor(private readonly relay: RealtimeRelayService) {}

  handleConnection(client: TelemetrySocket, request: IncomingMessage) {
    const session = this.relay.registerTelemetryClient({
      send: (message) => this.sendJson(client, message),
      remoteAddress: request.socket.remoteAddress ?? null,
      source: this.readSearchParam(request, 'source'),
    });

    client.__arenzyraClientId = session.clientId;

    this.logger.log(
      `telemetry connected clientId=${session.clientId} ip=${session.remoteAddress ?? 'unknown'} source=${session.source ?? 'unknown'}`,
    );

    this.sendJson(client, {
      type: 'telemetry_connected',
      clientId: session.clientId,
      timestamp: Date.now(),
    });
  }

  handleDisconnect(client: TelemetrySocket) {
    const clientId = client.__arenzyraClientId;
    if (!clientId) {
      return;
    }

    const session = this.relay.getTelemetrySession(clientId);
    this.relay.unregisterTelemetryClient(clientId);

    this.logger.log(
      `telemetry disconnected clientId=${clientId} matchId=${session?.matchId ?? 'unbound'} orgSlug=${session?.orgSlug ?? 'unknown'}`,
    );
  }

  @SubscribeMessage('bind_match')
  handleBindMatch(
    @ConnectedSocket() client: TelemetrySocket,
    @MessageBody() envelope: RealtimeEnvelope<TelemetryBindPayload>,
  ) {
    const clientId = client.__arenzyraClientId;
    if (!clientId) {
      this.sendError(client, 'telemetry_session_missing');
      return;
    }

    const session = this.relay.bindTelemetryClient(clientId, envelope);
    if (!session) {
      this.sendError(client, 'match_binding_invalid');
      return;
    }

    this.logger.log(
      `telemetry bound clientId=${clientId} matchId=${session.matchId} orgSlug=${session.orgSlug ?? 'unknown'} sessionId=${session.sessionId ?? 'n/a'}`,
    );

    this.sendJson(client, {
      type: 'bind_match_ack',
      clientId,
      matchId: session.matchId,
      orgSlug: session.orgSlug,
      timestamp: Date.now(),
    });
  }

  @SubscribeMessage('heartbeat')
  handleHeartbeat(
    @ConnectedSocket() client: TelemetrySocket,
    @MessageBody() envelope: RealtimeEnvelope,
  ) {
    const clientId = client.__arenzyraClientId;
    if (!clientId) {
      this.sendError(client, 'telemetry_session_missing');
      return;
    }

    const session = this.relay.recordTelemetryHeartbeat(clientId, envelope);
    if (!session) {
      this.sendError(client, 'telemetry_session_missing');
      return;
    }
  }

  @SubscribeMessage('telemetry_event')
  handleTelemetryEvent(
    @ConnectedSocket() client: TelemetrySocket,
    @MessageBody() envelope: RealtimeEnvelope,
  ) {
    const clientId = client.__arenzyraClientId;
    if (!clientId) {
      this.sendError(client, 'telemetry_session_missing');
      return;
    }

    const result = this.relay.relayTelemetryEnvelope(clientId, envelope);
    if (!result) {
      this.sendError(client, 'telemetry_match_not_bound');
      return;
    }

    if (result.deliveredCount > 0) {
      this.logger.debug(
        `telemetry relayed clientId=${clientId} matchId=${result.matchId} subscribers=${result.deliveredCount}`,
      );
    }
  }

  private sendError(client: TelemetrySocket, reason: string) {
    this.sendJson(client, {
      type: 'realtime_error',
      reason,
      timestamp: Date.now(),
    });
  }

  private sendJson(client: WebSocket, message: unknown) {
    if (client.readyState !== WebSocket.OPEN) {
      return;
    }

    client.send(JSON.stringify(message));
  }

  private readSearchParam(
    request: IncomingMessage,
    key: string,
  ): string | null {
    if (!request.url) {
      return null;
    }

    try {
      const url = new URL(request.url, 'ws://arenzyra.local');
      const value = url.searchParams.get(key);
      return value && value.trim().length > 0 ? value.trim() : null;
    } catch {
      return null;
    }
  }
}
