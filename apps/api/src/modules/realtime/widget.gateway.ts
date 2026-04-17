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
import type {
  RealtimeEnvelope,
  WidgetSubscribePayload,
} from './realtime-types';
import { REALTIME_WIDGET_PATH } from './realtime-types';

type WidgetSocket = WebSocket & { __arenzyraClientId?: string };

@WebSocketGateway({
  path: REALTIME_WIDGET_PATH,
})
export class WidgetGateway {
  private readonly logger = new Logger(WidgetGateway.name);

  constructor(private readonly relay: RealtimeRelayService) {}

  handleConnection(client: WidgetSocket, request: IncomingMessage) {
    const session = this.relay.registerWidgetClient({
      send: (message) => this.sendJson(client, message),
      remoteAddress: request.socket.remoteAddress ?? null,
    });

    client.__arenzyraClientId = session.clientId;

    this.logger.log(
      `widget connected clientId=${session.clientId} ip=${session.remoteAddress ?? 'unknown'}`,
    );

    this.sendJson(client, {
      type: 'widget_connected',
      clientId: session.clientId,
      timestamp: Date.now(),
    });
  }

  handleDisconnect(client: WidgetSocket) {
    const clientId = client.__arenzyraClientId;
    if (!clientId) {
      return;
    }

    const session = this.relay.getWidgetSession(clientId);
    this.relay.unregisterWidgetClient(clientId);

    this.logger.log(
      `widget disconnected clientId=${clientId} subscription=${session?.subscription?.orgSlug ?? 'unsubscribed'}/${session?.subscription?.widgetKey ?? 'n/a'} matchId=${session?.subscription?.matchId ?? 'n/a'}`,
    );
  }

  @SubscribeMessage('subscribe_widget')
  handleSubscribe(
    @ConnectedSocket() client: WidgetSocket,
    @MessageBody() envelope: RealtimeEnvelope<WidgetSubscribePayload>,
  ) {
    const clientId = client.__arenzyraClientId;
    if (!clientId) {
      this.sendError(client, 'widget_session_missing');
      return;
    }

    const session = this.relay.subscribeWidgetClient(clientId, envelope);
    if (!session?.subscription) {
      this.sendError(client, 'widget_subscription_invalid');
      return;
    }

    this.logger.log(
      `widget subscribed clientId=${clientId} orgSlug=${session.subscription.orgSlug} widgetKey=${session.subscription.widgetKey} matchId=${session.subscription.matchId ?? 'none'}`,
    );

    this.sendJson(client, {
      type: 'subscribe_widget_ack',
      clientId,
      subscription: session.subscription,
      timestamp: Date.now(),
    });
  }

  @SubscribeMessage('heartbeat')
  handleHeartbeat(
    @ConnectedSocket() client: WidgetSocket,
    @MessageBody() envelope: RealtimeEnvelope,
  ) {
    const clientId = client.__arenzyraClientId;
    if (!clientId) {
      this.sendError(client, 'widget_session_missing');
      return;
    }

    const session = this.relay.recordWidgetHeartbeat(clientId, envelope);
    if (!session) {
      this.sendError(client, 'widget_session_missing');
      return;
    }
  }

  private sendError(client: WidgetSocket, reason: string) {
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
}
