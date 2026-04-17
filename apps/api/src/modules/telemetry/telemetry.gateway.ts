import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { PrismaService } from '../../db/prisma.service';
import { TelemetrySessionService } from './telemetry-session.service';
import { TelemetryBindDto } from './dto/telemetry-bind.dto';

type TelemetrySocket = {
  id: string;
  handshake: {
    query: Record<string, unknown>;
  };
  emit: (event: string, payload: unknown) => void;
};

type TelemetryServer = {
  to: (room: string) => { emit: (event: string, payload: unknown) => void };
};

@WebSocketGateway({
  cors: { origin: true, credentials: true },
  namespace: '/telemetry',
})
export class TelemetryGateway {
  @WebSocketServer()
  server!: TelemetryServer;

  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: TelemetrySessionService,
  ) {}

  handleDisconnect(socket: TelemetrySocket) {
    this.sessions.unbind(socket.id);
  }

  @SubscribeMessage('bind_match')
  async handleBindMatch(
    @ConnectedSocket() socket: TelemetrySocket,
    @MessageBody() body: TelemetryBindDto,
  ) {
    const match = await this.prisma.match.findUnique({
      where: { id: body.matchId },
      select: { id: true },
    });
    if (!match) {
      socket.emit('telemetry_error', { reason: 'match_not_found' });
      return;
    }

    const source =
      body.source?.trim() ||
      (typeof socket.handshake.query.source === 'string'
        ? socket.handshake.query.source
        : null) ||
      `telemetry:${socket.id}`;
    const binding = this.sessions.bind(socket.id, body.matchId, source);
    socket.emit('telemetry_bound', {
      ok: true,
      matchId: binding.matchId,
      source: binding.source,
    });
  }
}
