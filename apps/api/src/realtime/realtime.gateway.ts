import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import { Role } from '@prisma/client';
import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import type { Actor } from '../common/auth/jwt.strategy';
import { PrismaService } from '../db/prisma.service';
import { effectiveOrganizationId } from '../common/org/org.util';
import type { OrganizationBrandingDto } from '../modules/organization-branding/organization-branding.constants';
import type {
  ObserverKillFeedUpdatePayload,
  ObserverMatchFinishedPayload,
  ObserverStateUpdatePayload,
} from '../modules/observer/match-state.service';
import type { ObserverAchievementPayload } from '../modules/observer/observer-achievement.service';
import type { ObserverTeamEliminationPayload } from '../modules/observer/observer-team-elimination.service';
import type {
  LiveRankingPayload,
  OverallRankingPayload,
} from './ranking.types';
import { RankingEmitterService } from './ranking-emitter.service';
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
  clientId?: string | null;
};

type BindMatchPayload = { matchId: string };
type BindTournamentPayload = { tournamentId: string };
type TelemetryPayload = Record<string, unknown>;
type ServerToClientEvents = {
  'auth:ok': (payload: { clientId: string | null; role: Role | null }) => void;
  'match:error': (payload: { reason: string }) => void;
  'match:bound': (payload: { matchId: string; status: 'bound' }) => void;
  'match:state': (payload: unknown) => void;
  'match:update': (payload: unknown) => void;
  'observer:state:update': (payload: ObserverStateUpdatePayload) => void;
  'observer:killfeed:update': (payload: ObserverKillFeedUpdatePayload) => void;
  'observer:match:finished': (payload: ObserverMatchFinishedPayload) => void;
  'observer:achievement': (payload: ObserverAchievementPayload) => void;
  'observer:team:eliminated': (payload: ObserverTeamEliminationPayload) => void;
  match_state_updated: (payload: unknown) => void;
  'fight:detected': (payload: {
    matchId: string;
    fightId: string;
    teams: {
      teamId: string | null;
      teamName: string;
      teamTag: string | null;
      logoUrl: string | null;
      slot: number | null;
    }[];
    eventCount: number;
    startedAt: string;
    lastEventAt: string;
  }) => void;
  'match:winner': (payload: {
    matchId: string;
    teamId: string | null;
    teamName: string;
    teamTag: string | null;
    logoUrl: string | null;
  }) => void;
  'match:status-updated': (payload: {
    matchId: string;
    status: 'UPCOMING' | 'LIVE' | 'ENDED' | 'PAUSED' | 'CANCELLED';
    updatedAt: string;
  }) => void;
  'match:live-ranking': (payload: LiveRankingPayload) => void;
  'tournament:overall-ranking': (payload: OverallRankingPayload) => void;
  'broadcast:event': (payload: Record<string, unknown>) => void;
  'storyline:event': (payload: Record<string, unknown>) => void;
  'observer:suggestion': (payload: Record<string, unknown>) => void;
  'camera:suggest': (payload: Record<string, unknown>) => void;
  'pcob:telemetry': (payload: TelemetryPayload) => void;
  'tournament:deleted': (payload: { tournamentId: string }) => void;
  'organization:branding-updated': (payload: {
    organizationId: string;
    branding: OrganizationBrandingDto;
  }) => void;
  'organization:theme-updated': (payload: {
    organizationId: string;
    branding: OrganizationBrandingDto;
  }) => void;
  'organization:features-updated': (payload: {
    organizationId: string;
    features: Record<string, { enabled: boolean; config?: unknown }>;
  }) => void;
  'organization:widget-version-updated': (payload: {
    organizationId: string;
    widgetKey: string;
    version: string;
    status: string;
    action: 'promoted' | 'rolledback' | 'schema-updated';
  }) => void;
  'broadcast-phase': (payload: {
    phase: 'LIVE' | 'POST_MATCH';
    winner: {
      slotResultId: string;
      teamId: string;
      teamName: string | null;
      teamTag: string | null;
      logoUrl: string | null;
      slot: number | null;
      placement?: number | null;
      totalKills?: number | null;
      points?: number | null;
      alivePlayers?: number | null;
      totalPlayers?: number | null;
      players: {
        playerId: string;
        ign: string | null;
        alive: boolean;
        knocked: boolean;
        kills: number;
      }[];
    } | null;
  }) => void;
  'match-ended': (payload: { matchId: string }) => void;
};

type SocketData = {
  user?: Actor & { clientId?: string | null };
  matchId?: string;
  organizationId?: string | null;
  tournamentId?: string | null;
};

type RTRoomEmitter = {
  emit<E extends keyof ServerToClientEvents>(
    event: E,
    payload: Parameters<ServerToClientEvents[E]>[0],
  ): void;
};

type RTServer = {
  use: (fn: (socket: RTSocket, next: (err?: Error) => void) => void) => void;
  to: (room: string) => RTRoomEmitter;
};

type RTSocket = {
  data: SocketData;
  handshake: {
    query: Record<string, unknown>;
    auth?: { token?: unknown } | Record<string, unknown>;
    headers: { authorization?: string | string[] | undefined };
  };
  id: string;
  join: (room: string) => Promise<void> | void;
  leave: (room: string) => Promise<void> | void;
  emit<E extends keyof ServerToClientEvents>(
    event: E,
    payload: Parameters<ServerToClientEvents[E]>[0],
  ): void;
};

// Client overlay example:
// const socket = io('/realtime', { auth: { token }, query: { matchId } });
// socket.on('match:live-ranking', ({ teams }) => render(teams));

@WebSocketGateway({
  cors: { origin: true, credentials: true },
  namespace: '/realtime',
})
@Injectable()
export class RealtimeGateway {
  @WebSocketServer()
  io!: RTServer;

  private readonly logger = new Logger('RealtimeGateway');

  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => RankingEmitterService))
    private readonly rankingEmitter: RankingEmitterService,
  ) {}

  afterInit(server: RTServer) {
    this.io = server;
    server.use((socket, next) => {
      const token = this.extractToken(socket);
      if (token) {
        try {
          socket.data.user = this.toActor(this.jwt.verify<JwtPayload>(token));
          socket.data.organizationId = effectiveOrganizationId(
            socket.data.user,
          );
          if (socket.data.organizationId) {
            void socket.join(`org:${socket.data.organizationId}`);
          }
        } catch {
          next(new Error('Unauthorized'));
          return;
        }
      }
      const matchId = this.extractMatchId(socket);
      if (matchId) {
        socket.data.matchId = matchId;
        void socket.join(`match:${matchId}`);
      }
      const orgFromQuery = this.extractOrgId(socket);
      if (orgFromQuery) {
        socket.data.organizationId = socket.data.organizationId ?? orgFromQuery;
        void socket.join(`org:${orgFromQuery}`);
      }
      next();
    });
  }

  handleConnection(socket: RTSocket) {
    const user = socket.data.user;
    socket.emit('auth:ok', {
      clientId: user?.clientId ?? null,
      role: user?.role ?? null,
    });
  }

  @SubscribeMessage('bind_match')
  async handleBindMatch(
    @ConnectedSocket() socket: RTSocket,
    @MessageBody() data: BindMatchPayload,
  ) {
    const matchId = data?.matchId;
    const user = socket.data.user;
    const orgId =
      socket.data.organizationId ??
      (user ? effectiveOrganizationId(user) : null);

    if (!user) {
      socket.emit('match:error', { reason: 'unauthenticated' });
      return;
    }
    if (!matchId) {
      socket.emit('match:error', { reason: 'missing_match_id' });
      return;
    }
    const exists = await this.prisma.match.findFirst({
      where: {
        id: matchId,
        deletedAt: null,
        ...(orgId ? { organizationId: orgId } : {}),
      },
      select: { id: true },
    });
    if (!exists) {
      socket.emit('match:error', { reason: 'match_not_found' });
      return;
    }

    socket.data.matchId = matchId;
    await socket.join(`match:${matchId}`);
    if (orgId) await socket.join(`org:${orgId}`);

    socket.emit('match:bound', { matchId, status: 'bound' });
  }

  @SubscribeMessage('pcob:telemetry:push')
  async handleTelemetry(
    @ConnectedSocket() socket: RTSocket,
    @MessageBody() payload: TelemetryPayload,
  ) {
    const matchId = socket.data.matchId;
    if (!matchId) return;
    try {
      await enforceTelemetrySourceAllowed({
        prisma: this.prisma,
        logger: this.logger,
        matchId,
        incomingSource: 'PCOB',
      });
    } catch (error) {
      if (error instanceof TelemetrySourceRejectedException) {
        socket.emit('match:error', { reason: 'telemetry_source_mismatch' });
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `[realtime] telemetry relay rejected match=${matchId} reason=${message}`,
      );
      socket.emit('match:error', { reason: 'telemetry_source_guard_failed' });
      return;
    }
    this.io.to(`match:${matchId}`).emit('pcob:telemetry', payload);
    void this.rankingEmitter.emitLiveRanking(matchId, { requester: socket });
  }

  @SubscribeMessage('bind_tournament')
  async handleBindTournament(
    @ConnectedSocket() socket: RTSocket,
    @MessageBody() data: BindTournamentPayload,
  ) {
    const tournamentId = data?.tournamentId;
    const user = socket.data.user;
    const orgId =
      socket.data.organizationId ??
      (user ? effectiveOrganizationId(user) : null);
    if (!user) {
      socket.emit('match:error', { reason: 'unauthenticated' });
      return;
    }
    if (!tournamentId) {
      socket.emit('match:error', { reason: 'missing_tournament_id' });
      return;
    }
    const tournament = await this.prisma.tournament.findFirst({
      where: {
        id: tournamentId,
        deletedAt: null,
        ...(orgId ? { organizationId: orgId } : {}),
      },
      select: { id: true, organizationId: true },
    });
    if (!tournament) {
      socket.emit('match:error', { reason: 'tournament_not_found' });
      return;
    }

    socket.data.tournamentId = tournamentId;
    socket.data.organizationId =
      tournament.organizationId ?? socket.data.organizationId ?? null;

    await socket.join(`tournament:${tournamentId}`);
    if (socket.data.organizationId) {
      await socket.join(`org:${socket.data.organizationId}`);
    }
    void this.rankingEmitter.emitOverallRanking(tournamentId, { force: true });
  }

  emitBrandingUpdated(
    organizationId: string | null | undefined,
    branding: OrganizationBrandingDto,
  ) {
    if (!organizationId) return;
    this.io?.to(`org:${organizationId}`).emit('organization:branding-updated', {
      organizationId,
      branding,
    });
  }

  emitThemeUpdated(
    organizationId: string | null | undefined,
    branding: OrganizationBrandingDto,
  ) {
    if (!organizationId) return;
    this.io?.to(`org:${organizationId}`).emit('organization:theme-updated', {
      organizationId,
      branding,
    });
  }

  emitFeaturesUpdated(
    organizationId: string | null | undefined,
    features: Record<string, { enabled: boolean; config?: unknown }>,
  ) {
    if (!organizationId) return;
    this.io?.to(`org:${organizationId}`).emit('organization:features-updated', {
      organizationId,
      features,
    });
  }

  emitWidgetVersion(
    organizationId: string | null | undefined,
    payload: {
      widgetKey: string;
      version: string;
      status: string;
      action: 'promoted' | 'rolledback' | 'schema-updated';
    },
  ) {
    if (!organizationId) return;
    this.io
      ?.to(`org:${organizationId}`)
      .emit('organization:widget-version-updated', {
        organizationId,
        ...payload,
      });
  }

  emitTournamentDeleted(
    organizationId: string | null | undefined,
    tournamentId: string,
  ) {
    if (!organizationId) return;
    this.io?.to(`org:${organizationId}`).emit('tournament:deleted', {
      tournamentId,
    });
  }

  emitMatchStatusUpdated(
    organizationId: string | null | undefined,
    payload: {
      matchId: string;
      status: 'UPCOMING' | 'LIVE' | 'ENDED' | 'PAUSED' | 'CANCELLED';
      updatedAt: string;
    },
  ) {
    this.io
      ?.to(`match:${payload.matchId}`)
      .emit('match:status-updated', payload);
    if (organizationId) {
      this.io
        ?.to(`org:${organizationId}`)
        .emit('match:status-updated', payload);
    }
  }

  emitMatchWinner(payload: {
    matchId: string;
    teamId: string | null;
    teamName: string;
    teamTag: string | null;
    logoUrl: string | null;
  }) {
    if (!payload?.matchId) return;
    this.io?.to(`match:${payload.matchId}`).emit('match:winner', payload);
  }

  emitObserverMatchFinished(payload: ObserverMatchFinishedPayload) {
    if (!payload?.matchId) return;
    this.io
      ?.to(`match:${payload.matchId}`)
      .emit('observer:match:finished', payload);
  }

  emitObserverAchievement(payload: ObserverAchievementPayload) {
    if (!payload?.matchId) return;
    this.io
      ?.to(`match:${payload.matchId}`)
      .emit('observer:achievement', payload);
  }

  emitObserverTeamEliminated(payload: ObserverTeamEliminationPayload) {
    if (!payload?.matchId) return;
    this.io
      ?.to(`match:${payload.matchId}`)
      .emit('observer:team:eliminated', payload);
  }

  emitFightDetected(payload: {
    matchId: string;
    fightId: string;
    teams: {
      teamId: string | null;
      teamName: string;
      teamTag: string | null;
      logoUrl: string | null;
      slot: number | null;
    }[];
    eventCount: number;
    startedAt: string;
    lastEventAt: string;
  }) {
    if (!payload?.matchId) return;
    this.io?.to(`match:${payload.matchId}`).emit('fight:detected', payload);
  }

  private extractMatchId(socket: RTSocket): string | null {
    const queryMatchId = socket.handshake.query.matchId;
    if (typeof queryMatchId === 'string' && queryMatchId.length > 0) {
      return queryMatchId;
    }
    return null;
  }

  private extractOrgId(socket: RTSocket): string | null {
    const queryOrgId = socket.handshake.query.organizationId;
    if (typeof queryOrgId === 'string' && queryOrgId.length > 0) {
      return queryOrgId;
    }
    return null;
  }

  private extractToken(socket: RTSocket): string | null {
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

  private toActor(payload: JwtPayload): Actor & { clientId?: string | null } {
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
      clientId: payload.clientId ?? null,
    };
  }
}
