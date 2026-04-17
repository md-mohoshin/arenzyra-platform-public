import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { randomUUID } from 'crypto';
import { Server, Socket } from 'socket.io';
import { LiveFeedService } from './live-feed.service';
import type { LiveSnapshot } from './live-feed.types';

@WebSocketGateway({
  namespace: '/ws/live',
  cors: { origin: '*' },
})
export class LiveFeedGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server!: Server;

  private readonly subscriptions = new Map<string, () => void>();

  private readonly getHandshake = (
    client: Socket,
  ): {
    auth?: { clientId?: unknown };
    headers?: Record<string, string | string[] | undefined>;
  } | null => {
    const raw = (client as unknown as { handshake?: unknown }).handshake;
    if (!raw || typeof raw !== 'object') return null;
    const { auth, headers } = raw as {
      auth?: { clientId?: unknown };
      headers?: Record<string, string | string[] | undefined>;
    };
    return { auth, headers };
  };

  private readonly makeClientId = (client: Socket): string => {
    const socketId = (client as { id?: unknown }).id;
    if (typeof socketId === 'string') return socketId;

    const handshake = this.getHandshake(client);
    const authClientId = handshake?.auth?.clientId;
    if (typeof authClientId === 'string') return authClientId;

    const headerKey = handshake?.headers?.['sec-websocket-key'];
    if (typeof headerKey === 'string') return headerKey;
    if (Array.isArray(headerKey) && headerKey[0]) return headerKey[0];

    return `client-${randomUUID()}`;
  };

  constructor(private readonly feed: LiveFeedService) {}

  handleConnection(client: Socket) {
    const snapshot = this.feed.getSnapshot();
    client.emit('message', { type: 'snapshot', data: snapshot });

    const listener = (data: LiveSnapshot) => {
      client.emit('message', { type: 'update', data });
    };

    const unsubscribe = this.feed.onUpdate(listener);
    const clientId = this.makeClientId(client);
    this.subscriptions.set(clientId, unsubscribe);
  }

  handleDisconnect(client: Socket) {
    const clientId = this.makeClientId(client);
    const unsubscribe = this.subscriptions.get(clientId);
    if (unsubscribe) unsubscribe();
    this.subscriptions.delete(clientId);
  }
}
