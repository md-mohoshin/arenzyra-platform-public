import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import { Role } from '@prisma/client';
import { Injectable, Logger } from '@nestjs/common';
import type { Actor } from '../common/auth/jwt.strategy';
import { PrismaService } from '../db/prisma.service';
import { effectiveOrganizationId } from '../common/org/org.util';
import {
  TelemetrySourceRejectedException,
  enforceTelemetrySourceAllowed,
} from '../common/telemetry-source.util';

type JwtPayload = {
  sub: string;
  role?: Role | null;
  organizationId?: string | null;
  actorId?: string | null;
  actorRole?: Role | null;
  actingOrgId?: string | null;
  actingRole?: Role | null;
  actingOrgName?: string | null;
  actingAsUserId?: string | null;
  isImpersonating?: boolean | null;
  impersonationExpiresAt?: string | number | Date | null;
};

type JoinPayload = { matchId: string };
type TelemetryPayload = Record<string, unknown>;

type ServerToClientEvents = {
  'pcob:error': (payload: { reason: string }) => void;
  'pcob:connected': (payload: { matchId: string }) => void;
  'pcob:left': (payload: Record<string, never>) => void;
  'pcob:telemetry': (payload: TelemetryPayload) => void;
};

type SocketData = {
  user?: Actor;
  matchId?: string;
  organizationId?: string | null;
};

type PcobRoomEmitter = {
  emit<E extends keyof ServerToClientEvents>(
    event: E,
    payload: Parameters<ServerToClientEvents[E]>[0],
  ): void;
};

type PcobServer = {
  use: (fn: (socket: PcobSocket, next: (err?: Error) => void) => void) => void;
  to: (room: string) => PcobRoomEmitter;
};

type PcobSocket = {
  id: string;
  data: SocketData;
  handshake: {
    auth?: { token?: unknown } | Record<string, unknown>;
    headers: { authorization?: string | string[] | undefined };
  };
  join: (room: string) => Promise<void> | void;
  leave: (room: string) => Promise<void> | void;
  emit<E extends keyof ServerToClientEvents>(
    event: E,
    payload: Parameters<ServerToClientEvents[E]>[0],
  ): void;
};

@WebSocketGateway({ cors: true, namespace: '/pcob' })
@Injectable()
export class PcobNamespaceGateway {
  @WebSocketServer()
  io!: PcobServer;
  private readonly logger = new Logger(PcobNamespaceGateway.name);

  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  afterInit(server: PcobServer) {
    this.io = server;
    server.use((socket, next) => {
      const token = this.extractToken(socket);
      if (!token) {
        return next(new Error('Unauthorized'));
      }
      try {
        socket.data.user = this.toActor(this.jwt.verify<JwtPayload>(token));
        socket.data.organizationId = effectiveOrganizationId(socket.data.user);
        return next();
      } catch {
        return next(new Error('Unauthorized'));
      }
    });
  }

  handleConnection(socket: PcobSocket) {
    // Keep logging to aid operations

    console.log(
      `[pcob] connected socket=${socket.id} user=${JSON.stringify(
        socket.data.user ?? {},
      )}`,
    );
  }

  @SubscribeMessage('pcob:join')
  async handleJoin(
    @ConnectedSocket() socket: PcobSocket,
    @MessageBody() data: JoinPayload,
  ) {
    const matchId = data?.matchId;
    const orgId = socket.data.organizationId;
    if (!socket.data.user) {
      socket.emit('pcob:error', { reason: 'unauthenticated' });
      return;
    }
    if (!matchId || typeof matchId !== 'string') {
      socket.emit('pcob:error', { reason: 'missing_match_id' });
      return;
    }
    const match = await this.prisma.match.findFirst({
      where: {
        id: matchId,
        deletedAt: null,
        ...(orgId ? { organizationId: orgId } : {}),
      },
      select: { id: true },
    });
    if (!match) {
      socket.emit('pcob:error', { reason: 'match_not_found' });
      return;
    }
    socket.data.matchId = matchId;
    await socket.join(this.room(matchId, orgId));
    socket.emit('pcob:connected', { matchId });
  }

  @SubscribeMessage('pcob:leave')
  async handleLeave(@ConnectedSocket() socket: PcobSocket) {
    const matchId = socket.data.matchId;
    const orgId = socket.data.organizationId;
    if (matchId) {
      await socket.leave(this.room(matchId, orgId));
      socket.data.matchId = undefined;
    }
    socket.emit('pcob:left', {});
  }

  @SubscribeMessage('pcob:telemetry')
  async handleTelemetry(
    @ConnectedSocket() socket: PcobSocket,
    @MessageBody() payload: TelemetryPayload,
  ) {
    const matchId = socket.data.matchId;
    const orgId = socket.data.organizationId;
    if (!matchId) {
      socket.emit('pcob:error', { reason: 'not_bound' });
      return;
    }
    try {
      await enforceTelemetrySourceAllowed({
        prisma: this.prisma,
        logger: this.logger,
        matchId,
        incomingSource: 'PCOB',
      });
    } catch (error) {
      if (error instanceof TelemetrySourceRejectedException) {
        socket.emit('pcob:error', { reason: 'source_mismatch' });
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `[pcob] source enforcement failed match=${matchId} reason=${message}`,
      );
      socket.emit('pcob:error', { reason: 'source_guard_failed' });
      return;
    }
    this.io.to(this.room(matchId, orgId)).emit('pcob:telemetry', payload);
  }

  disconnectTournamentMatches(matchIds: string[], orgId?: string | null) {
    if (!this.io) return;
    const unique = Array.from(new Set(matchIds));
    for (const matchId of unique) {
      const room = this.room(matchId, orgId);
      this.io.to(room).emit('pcob:error', { reason: 'tournament_deleted' });
      this.io.to(room).emit('pcob:left', {});
    }
  }

  private room(matchId: string, orgId?: string | null) {
    return orgId ? `match:${orgId}:${matchId}` : `match:${matchId}`;
  }

  private extractToken(socket: PcobSocket): string | null {
    const authToken = socket.handshake.auth?.token;
    if (typeof authToken === 'string' && authToken.trim().length > 0) {
      return this.stripBearer(authToken);
    }
    const header = socket.handshake.headers.authorization;
    if (typeof header === 'string' && header.length > 0) {
      return this.stripBearer(header);
    }
    return null;
  }

  private stripBearer(value: string): string {
    if (!value) return value;
    return value.toLowerCase().startsWith('bearer ') ? value.slice(7) : value;
  }

  private toActor(payload: JwtPayload): Actor {
    return {
      id: payload.sub,
      role: payload.role ?? null,
      organizationId: payload.organizationId ?? null,
      actorId: payload.actorId ?? null,
      actorRole: payload.actorRole ?? null,
      actingOrgId: payload.actingOrgId ?? null,
      actingRole: payload.actingRole ?? null,
      actingOrgName: payload.actingOrgName ?? null,
      actingAsUserId: payload.actingAsUserId ?? null,
      isImpersonating: !!payload.isImpersonating,
      impersonationExpiresAt: payload.impersonationExpiresAt ?? null,
      realRole: payload.actorRole ?? payload.role ?? null,
    };
  }
}
