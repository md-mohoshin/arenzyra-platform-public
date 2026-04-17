import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server } from 'socket.io';

@WebSocketGateway({
  namespace: '/ws/overlay',
  cors: { origin: '*' },
})
export class OverlayGateway {
  @WebSocketServer()
  server!: Server;

  broadcast(snapshot: unknown) {
    if (!this.server) return;
    this.server.emit('overlay:update', snapshot);
  }
}
