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
import { readLiveSyncContract } from '../common/live-sync-contract.util';
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
export type MatchControlUpdateEventType =
  | 'CONTROL_STATE_CHANGED'
  | 'RESULTS_CHANGED'
  | 'RESULTS_LOCK_CHANGED'
  | 'SLOTS_CHANGED';

export type MatchControlUpdatePayload = {
  matchId: string;
  orgId: string | null;
  controlVersion: number | null;
  resultsVersion: number | null;
  sequence: number;
  eventType: MatchControlUpdateEventType;
};

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
  'match:control:update': (payload: MatchControlUpdatePayload) => void;
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
  private readonly controlEventSequence = new Map<string, number>();
  private readonly publicRealtimeEvents = new Set<string>([
    'match:state',
    'match:update',
    'match_state_updated',
    'observer:state:update',
    'observer:killfeed:update',
    'observer:match:finished',
    'observer:achievement',
    'observer:team:eliminated',
    'fight:detected',
    'match:winner',
    'match:status-updated',
    'match:live-ranking',
    'kill:feed',
    'match:end',
    'broadcast-phase',
    'match-ended',
    'tournament:overall-ranking',
    'organization:branding-updated',
    'organization:theme-updated',
  ]);
  private readonly publicStripFieldPattern =
    /(token|secret|jwt|auth|authorization|cookie|signature|credential|control|internal|private|write|writable|mutable|editable|permission|capability|override|actor|impersonat|clientid|role)/i;

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
        } catch {
          next(new Error('Unauthorized'));
          return;
        }
      }
      const authenticated = this.isAuthenticated(socket);
      const orgFromQuery = this.extractOrgId(socket);
      const resolvedOrgId = authenticated
        ? (socket.data.organizationId ?? orgFromQuery)
        : orgFromQuery;
      if (resolvedOrgId) {
        socket.data.organizationId = resolvedOrgId;
        void this.joinRoom(
          socket,
          authenticated
            ? this.orgRoom(resolvedOrgId)
            : this.publicOrgRoom(resolvedOrgId),
        );
      }
      const matchId = this.extractMatchId(socket);
      if (matchId) {
        socket.data.matchId = matchId;
        void this.joinRoom(
          socket,
          authenticated
            ? this.matchRoom(matchId)
            : this.publicMatchRoom(matchId),
        );
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

    await this.joinRoom(socket, this.tournamentRoom(tournamentId));
    if (socket.data.organizationId) {
      await this.joinRoom(socket, this.orgRoom(socket.data.organizationId));
    }
    void this.rankingEmitter.emitOverallRanking(tournamentId, { force: true });
  }

  emitBrandingUpdated(
    organizationId: string | null | undefined,
    branding: OrganizationBrandingDto,
  ) {
    if (!organizationId) return;
    this.emitOrganizationEvent(
      organizationId,
      'organization:branding-updated',
      {
        organizationId,
        branding,
      },
    );
  }

  emitThemeUpdated(
    organizationId: string | null | undefined,
    branding: OrganizationBrandingDto,
  ) {
    if (!organizationId) return;
    this.emitOrganizationEvent(organizationId, 'organization:theme-updated', {
      organizationId,
      branding,
    });
  }

  emitFeaturesUpdated(
    organizationId: string | null | undefined,
    features: Record<string, { enabled: boolean; config?: unknown }>,
  ) {
    if (!organizationId) return;
    this.emitOrganizationEvent(
      organizationId,
      'organization:features-updated',
      {
        organizationId,
        features,
      },
    );
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
    this.emitOrganizationEvent(
      organizationId,
      'organization:widget-version-updated',
      {
        organizationId,
        ...payload,
      },
    );
  }

  emitTournamentDeleted(
    organizationId: string | null | undefined,
    tournamentId: string,
  ) {
    if (!organizationId) return;
    this.emitOrganizationEvent(organizationId, 'tournament:deleted', {
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
    this.emitMatchScopedEvent(
      payload.matchId,
      'match:status-updated',
      payload,
      organizationId,
    );
  }

  async emitMatchControlUpdate(
    matchId: string,
    eventType: MatchControlUpdateEventType,
    overrides: {
      orgId?: string | null;
      controlVersion?: number | null;
      resultsVersion?: number | null;
    } = {},
  ): Promise<MatchControlUpdatePayload | null> {
    if (!this.io || !matchId) {
      return null;
    }

    const snapshot =
      overrides.orgId !== undefined &&
      overrides.controlVersion !== undefined &&
      overrides.resultsVersion !== undefined
        ? null
        : await this.prisma.match.findFirst({
            where: { id: matchId, deletedAt: null },
            select: {
              organizationId: true,
              tournament: { select: { organizationId: true } },
              controlState: {
                select: {
                  organizationId: true,
                  version: true,
                  metaJson: true,
                },
              },
            },
          });

    if (!snapshot && overrides.orgId === undefined) {
      return null;
    }

    const orgId =
      overrides.orgId ??
      snapshot?.organizationId ??
      snapshot?.controlState?.organizationId ??
      snapshot?.tournament?.organizationId ??
      null;
    const controlVersion =
      overrides.controlVersion ?? snapshot?.controlState?.version ?? null;
    const resultsVersion =
      overrides.resultsVersion ??
      (snapshot
        ? readLiveSyncContract(snapshot.controlState?.metaJson ?? null).version
        : null);
    const sequence = this.nextControlEventSequence(matchId, orgId);
    const payload: MatchControlUpdatePayload = {
      matchId,
      orgId,
      controlVersion,
      resultsVersion,
      sequence,
      eventType,
    };

    this.emitMatchScopedEvent(matchId, 'match:control:update', payload, orgId);
    return payload;
  }

  emitMatchWinner(payload: {
    matchId: string;
    teamId: string | null;
    teamName: string;
    teamTag: string | null;
    logoUrl: string | null;
  }) {
    if (!payload?.matchId) return;
    this.emitMatchScopedEvent(payload.matchId, 'match:winner', payload, null);
  }

  emitObserverMatchFinished(payload: ObserverMatchFinishedPayload) {
    if (!payload?.matchId) return;
    this.emitMatchScopedEvent(
      payload.matchId,
      'observer:match:finished',
      payload,
      null,
    );
  }

  emitObserverAchievement(payload: ObserverAchievementPayload) {
    if (!payload?.matchId) return;
    this.emitMatchScopedEvent(
      payload.matchId,
      'observer:achievement',
      payload,
      null,
    );
  }

  emitObserverTeamEliminated(payload: ObserverTeamEliminationPayload) {
    if (!payload?.matchId) return;
    this.emitMatchScopedEvent(
      payload.matchId,
      'observer:team:eliminated',
      payload,
      null,
    );
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
    this.emitMatchScopedEvent(payload.matchId, 'fight:detected', payload, null);
  }

  emitMatchScopedEvent(
    matchId: string,
    event: string,
    payload: unknown,
    organizationId?: string | null,
  ) {
    if (!this.io || !matchId) return;

    this.emitRoom(this.matchRoom(matchId), event, payload);
    if (organizationId) {
      this.emitRoom(this.orgRoom(organizationId), event, payload);
    }

    const publicPayload = this.buildPublicPayload(event, payload);
    if (publicPayload === null) {
      return;
    }

    this.emitRoom(this.publicMatchRoom(matchId), event, publicPayload);
    if (organizationId) {
      this.emitRoom(this.publicOrgRoom(organizationId), event, publicPayload);
    }
  }

  emitTournamentScopedEvent(
    tournamentId: string,
    event: string,
    payload: unknown,
    organizationId?: string | null,
  ) {
    if (!this.io || !tournamentId) return;

    this.emitRoom(this.tournamentRoom(tournamentId), event, payload);
    if (organizationId) {
      this.emitRoom(this.orgRoom(organizationId), event, payload);
    }

    if (!organizationId) {
      return;
    }

    const publicPayload = this.buildPublicPayload(event, payload);
    if (publicPayload === null) {
      return;
    }

    this.emitRoom(this.publicOrgRoom(organizationId), event, publicPayload);
  }

  emitOrganizationEvent(
    organizationId: string,
    event: string,
    payload: unknown,
  ) {
    if (!this.io || !organizationId) return;

    this.emitRoom(this.orgRoom(organizationId), event, payload);
    const publicPayload = this.buildPublicPayload(event, payload);
    if (publicPayload === null) {
      return;
    }
    this.emitRoom(this.publicOrgRoom(organizationId), event, publicPayload);
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

  private isAuthenticated(socket: RTSocket): boolean {
    return Boolean(socket.data.user);
  }

  private isPublicJoin(room: string): boolean {
    return room.startsWith('public:match:') || room.startsWith('public:org:');
  }

  private joinRoom(socket: RTSocket, room: string): Promise<void> | void {
    if (!room) return;
    if (!this.isAuthenticated(socket) && !this.isPublicJoin(room)) {
      return;
    }
    return socket.join(room);
  }

  private emitRoom(room: string, event: string, payload: unknown) {
    this.io?.to(room).emit(event as never, payload as never);
  }

  private buildPublicPayload(event: string, payload: unknown): unknown {
    if (!this.publicRealtimeEvents.has(String(event))) {
      return null;
    }
    return this.sanitizePublicPayload(payload);
  }

  private sanitizePublicPayload(payload: unknown): unknown {
    if (Array.isArray(payload)) {
      return payload.map((item) => this.sanitizePublicPayload(item));
    }
    if (payload instanceof Date) {
      return payload.toISOString();
    }
    if (!payload || typeof payload !== 'object') {
      return payload;
    }

    return Object.entries(payload as Record<string, unknown>).reduce<
      Record<string, unknown>
    >((acc, [key, value]) => {
      if (this.publicStripFieldPattern.test(key)) {
        return acc;
      }
      acc[key] = this.sanitizePublicPayload(value);
      return acc;
    }, {});
  }

  private matchRoom(matchId: string): string {
    return `match:${matchId}`;
  }

  private orgRoom(organizationId: string): string {
    return `org:${organizationId}`;
  }

  private tournamentRoom(tournamentId: string): string {
    return `tournament:${tournamentId}`;
  }

  private publicMatchRoom(matchId: string): string {
    return `public:match:${matchId}`;
  }

  private publicOrgRoom(organizationId: string): string {
    return `public:org:${organizationId}`;
  }

  private nextControlEventSequence(
    matchId: string,
    orgId: string | null,
  ): number {
    const key = `${orgId ?? 'none'}:${matchId}`;
    const previous = this.controlEventSequence.get(key) ?? 0;
    const next = Math.max(Date.now(), previous + 1);
    this.controlEventSequence.set(key, next);
    return next;
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
