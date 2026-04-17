import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Socket } from 'socket.io';
import { OverlayBroadcaster } from './overlay-broadcaster.service';
import { PrismaService } from '../../db/prisma.service';

type OverlayJoinPayload = { matchId: string; organizationId?: string | null };

type ServerToClientEvents = {
  'overlay:state': (payload: unknown) => void;
  'overlay:update': (payload: unknown) => void;
  'overlay:end': (payload: unknown) => void;
  'overlay:killfeed': (payload: unknown) => void;
  'overlay:focus': (payload: unknown) => void;
  'overlay:teamEliminated': (payload: {
    teamId: string;
    teamTag: string | null;
    teamLogo?: string | null;
    position?: 'top' | 'bottom';
  }) => void;
  'scoreboard:update': (payload: unknown) => void;
  'widget:trigger': (payload: {
    widgetInstanceId: string;
    action: 'PLAY';
  }) => void;
};

type OverlayNamespace = {
  emit: <E extends keyof ServerToClientEvents>(
    event: E,
    payload: Parameters<ServerToClientEvents[E]>[0],
  ) => void;
  to: (room: string) => {
    emit: <E extends keyof ServerToClientEvents>(
      event: E,
      payload: Parameters<ServerToClientEvents[E]>[0],
    ) => void;
  };
};

@WebSocketGateway({
  namespace: '/overlay',
  cors: { origin: true, credentials: false },
})
export class OverlayGateway {
  @WebSocketServer()
  io!: OverlayNamespace;

  constructor(
    private readonly broadcaster: OverlayBroadcaster,
    private readonly prisma: PrismaService,
  ) {}

  afterInit() {
    this.broadcaster.attachGateway(this);
  }

  private room(matchId: string, orgId?: string | null): string {
    return orgId ? `overlay:${orgId}:${matchId}` : `overlay:${matchId}`;
  }

  private leaveOverlayRooms(socket: Socket, except?: string) {
    const socketData =
      (socket as unknown as { data?: { overlayRoom?: string } }).data ??
      ((socket as unknown as { data?: { overlayRoom?: string } }).data = {});
    const current = socketData.overlayRoom;
    if (current && current !== except) {
      socket.leave(current);
      socketData.overlayRoom = undefined;
    }
  }

  emitWidgetTrigger(payload: { widgetInstanceId: string; action: 'PLAY' }) {
    // broadcast to all overlay listeners (OBS widgets)
    this.io.emit('widget:trigger', payload);
  }

  @SubscribeMessage('overlay:join')
  async handleJoin(
    @MessageBody() payload: OverlayJoinPayload,
    @ConnectedSocket() socket: Socket,
  ) {
    const matchId = payload?.matchId;
    if (!matchId) return;
    const orgId = payload?.organizationId ?? null;
    if (!orgId) return;
    const match = await this.prisma.match.findFirst({
      where: {
        id: matchId,
        deletedAt: null,
        tournament: { organizationId: orgId },
      },
      select: { id: true },
    });
    if (!match) {
      this.leaveOverlayRooms(socket);
      return;
    }
    const orgRoom = this.room(matchId, orgId);
    this.leaveOverlayRooms(socket, orgRoom);
    const socketData =
      (socket as unknown as { data?: { overlayRoom?: string } }).data ??
      ((socket as unknown as { data?: { overlayRoom?: string } }).data = {});
    socketData.overlayRoom = orgRoom;
    socket.join(orgRoom);
    await this.broadcaster.sendInitial(matchId, socket);
  }
}
