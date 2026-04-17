import { Logger, OnModuleDestroy } from '@nestjs/common';
import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { PcobEventsService } from '../pcob/pcob-events.service';
import type { PcobTelemetryPayload } from '../pcob/pcob.types';

type OverlayJoinPayload = { matchId: string };

type ClientToServerEvents = {
  'overlay:join': (payload: OverlayJoinPayload | string) => void;
};

type OverlayRoomEmitter = {
  emit: (event: string, payload: any) => void;
};

type OverlayServer = {
  to: (room: string) => OverlayRoomEmitter;
};

type OverlaySocket = {
  id: string;
  join: (room: string) => Promise<void> | void;
  emit: (event: string, payload: any) => void;
  on<K extends keyof ClientToServerEvents>(
    event: K,
    handler: ClientToServerEvents[K],
  ): void;
};

@WebSocketGateway({
  namespace: '/overlay',
  cors: { origin: true, credentials: false },
  transports: ['websocket'],
  path: '/overlay/socket.io',
})
export class OverlayGateway implements OnModuleDestroy {
  @WebSocketServer()
  private io!: OverlayServer;

  private readonly logger = new Logger('OverlayGateway');
  private unsubscribeTelemetry: (() => void) | null = null;

  constructor(private readonly events: PcobEventsService) {
    this.unsubscribeTelemetry = this.events.onTelemetry((evt) =>
      this.forwardTelemetry(evt.matchId, evt.payload),
    );
  }

  onModuleDestroy() {
    if (this.unsubscribeTelemetry) {
      this.unsubscribeTelemetry();
      this.unsubscribeTelemetry = null;
    }
  }

  handleConnection(client: OverlaySocket) {
    this.logger.log(`Overlay client connected id=${client.id ?? 'unknown'}`);
    this.registerHandlers(client);
  }

  handleDisconnect(client: OverlaySocket) {
    this.logger.log(`Overlay client disconnected id=${client.id ?? 'unknown'}`);
  }

  private room(matchId: string) {
    return `overlay:${matchId}`;
  }

  private registerHandlers(socket: OverlaySocket) {
    socket.on('overlay:join', (payload) => {
      const matchId = typeof payload === 'string' ? payload : payload?.matchId;
      if (!matchId) return;
      void socket.join(this.room(matchId));
      this.logger.log(
        `Overlay client ${socket.id ?? 'unknown'} joined match ${matchId}`,
      );
    });
  }

  private forwardTelemetry(matchId: string, payload: PcobTelemetryPayload) {
    if (!this.io || !matchId) return;
    this.io.to(this.room(matchId)).emit('overlay:telemetry', payload as any);
    this.logger.log(`Forwarded telemetry to overlay room match=${matchId}`);
  }

  emitResults(matchId: string, payload: unknown) {
    if (!this.io || !matchId) return;
    this.io.to(this.room(matchId)).emit('overlay.results', payload as any);
    this.logger.log(`Emitted overlay.results for match=${matchId}`);
  }

  emitScoreboard(matchId: string, payload: unknown) {
    if (!this.io || !matchId) return;
    this.io.to(this.room(matchId)).emit('overlay.scoreboard', payload as any);
    this.logger.log(`Emitted overlay.scoreboard for match=${matchId}`);
  }
}
