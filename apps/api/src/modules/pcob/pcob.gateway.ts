import { Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Role } from '@prisma/client';
import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import type { Actor } from '../../common/auth/jwt.strategy';
import { PrismaService } from '../../db/prisma.service';
import { PcobEventsService } from './pcob-events.service';
import { PcobTelemetryPayload } from './pcob.types';
import { ScaleService } from './scale.service';
import { effectiveOrganizationId } from '../../common/org/org.util';
import { env } from '../../config/env.validation';
import {
  TelemetrySourceRejectedException,
  enforceTelemetrySourceAllowed,
} from '../../common/telemetry-source.util';
import { resolvePcobCompatibilityMode } from '../../common/match-telemetry-provider.util';

const jwtSecret = env.JWT_SECRET;

type JwtPayload = {
  sub: string;
  role?: Role | null;
  actorRole?: Role | null;
  actorId?: string | null;
  id?: string | null;
  clientId?: string | null;
  organizationId?: string | null;
  actingOrgId?: string | null;
  actingRole?: Role | null;
  actingOrgName?: string | null;
  actingAsUserId?: string | null;
  isImpersonating?: boolean | null;
  impersonationExpiresAt?: string | number | Date | null;
};

type PcobUser = Actor & { clientId?: string | null; sub?: string | null };

type BindPayload = {
  matchId: string;
  source?: string;
  nodeId?: string;
  priority?: number;
  capabilities?: Record<string, unknown>;
};

type BindAck = { ok: boolean; reason?: string; matchId?: string };

type ClientToServerEvents = {
  'pcob:bind': (payload: BindPayload, ack?: (resp: BindAck) => void) => void;
  'join-match': (matchId: string, ack?: (resp: BindAck) => void) => void;
  'leave-match': (matchId: string) => void;
  'pcob:telemetry': (payload: PcobTelemetryPayload) => void;
};

type ServerToClientEvents = {
  'match:error': { matchId?: string; reason: string };
  'match:joined': { matchId: string };
  'match:update': { matchId: string; reason?: string | null };
  'pcob:telemetry:live': PcobTelemetryPayload;
  'pcob:map_state': unknown;
  'pcob:map_update': unknown;
  'pcob:status': unknown;
  'match.killfeed.append': unknown;
  'match.telemetry.updated': unknown;
  'results.updated': {
    matchId: string;
    roundIndex: number;
    payload?: unknown;
  };
  'results.locked': {
    matchId: string;
    lockState: 'LOCKED';
    status?: string | null;
    dataSource?: string | null;
  };
  'results.unlocked': {
    matchId: string;
    lockState: 'UNLOCKED';
    status?: string | null;
    dataSource?: string | null;
  };
  'match.results.updated': {
    matchId: string;
    roundIndex: number;
    payload?: unknown;
  };
  'leaderboard.updated': { matchId: string; payload?: unknown };
  'overlay.payload.updated': {
    matchId: string;
    roundIndex: number;
    payload?: unknown;
  };
  'overlay.results': { matchId: string; roundIndex: number; payload?: unknown };
  'overlay.scoreboard': {
    matchId: string;
    roundIndex: number;
    payload?: unknown;
  };
  'match.last_team_standing': {
    matchId: string;
    winnerTeamId?: string | null;
    finalizedAt: string;
  };
  'match.concluded': {
    matchId: string;
    winnerTeamId?: string | null;
    concludedAt: string;
    reason?: string | null;
  };
};

type SocketData = {
  user?: PcobUser;
  matchId?: string;
  organizationId?: string | null;
};

type PcobRoomEmitter = {
  emit<E extends keyof ServerToClientEvents>(
    event: E,
    payload: ServerToClientEvents[E],
  ): void;
};

type PcobServer = {
  use: (fn: (socket: PcobSocket, next: (err?: Error) => void) => void) => void;
  on: (event: 'connection', handler: (socket: PcobSocket) => void) => void;
  emit<E extends keyof ServerToClientEvents>(
    event: E,
    payload: ServerToClientEvents[E],
  ): void;
  to: (room: string) => PcobRoomEmitter;
};

type PcobSocket = {
  id: string;
  data: SocketData;
  handshake: {
    query?: Record<string, unknown>;
    auth?:
      | {
          token?: unknown;
          matchId?: unknown;
          match_id?: unknown;
          match?: unknown;
        }
      | Record<string, unknown>;
    headers: { authorization?: string | string[] | undefined };
  };
  join: (room: string) => Promise<void> | void;
  leave: (room: string) => Promise<void> | void;
  disconnect: (close?: boolean) => void;
  emit<E extends keyof ServerToClientEvents>(
    event: E,
    payload: ServerToClientEvents[E],
  ): void;
  on: <K extends keyof ClientToServerEvents>(
    event: K,
    handler: ClientToServerEvents[K],
  ) => void;
};

@WebSocketGateway({
  namespace: '/pcob',
  cors: { origin: true, credentials: true },
  transports: ['websocket', 'polling'],
  allowEIO3: true,
  path: '/pcob/socket.io',
})
export class PcobGateway {
  @WebSocketServer()
  private io!: PcobServer;

  private readonly logger = new Logger('PcobGateway');
  private telemetryCount = 0;
  private bindings = new Map<
    string,
    {
      matchId: string;
      source?: string;
      nodeId?: string;
      priority?: number;
      capabilities?: Record<string, unknown>;
    }
  >();
  private matchOrgCache = new Map<string, string | null>();

  constructor(
    private jwt: JwtService,
    private events: PcobEventsService,
    private scale: ScaleService,
    private prisma: PrismaService,
  ) {}

  emitMapState(matchId: string, state: unknown, orgId?: string | null): void {
    void this.emitToMatch(matchId, 'pcob:map_state', state, orgId);
  }

  emitMapUpdate(matchId: string, state: unknown, orgId?: string | null): void {
    void this.emitToMatch(matchId, 'pcob:map_update', state, orgId);
  }

  emitResultsUpdate(
    matchId: string,
    payload: unknown,
    orgId?: string | null,
  ): void {
    void this.emitToMatch(
      matchId,
      'results.updated',
      { matchId, roundIndex: 0, payload },
      orgId,
    );
  }

  emitMatchUpdate(
    matchId: string,
    payload?: { reason?: string | null },
    orgId?: string | null,
  ): void {
    void this.emitToMatch(
      matchId,
      'match:update',
      { matchId, ...(payload ?? {}) },
      orgId,
    );
  }

  emitStatus(matchId: string, payload: unknown, orgId?: string | null): void {
    void this.emitToMatch(matchId, 'pcob:status', payload, orgId);
  }

  emitMatchState(matchId: string, state: unknown, orgId?: string | null): void {
    this.emitMapState(matchId, state, orgId);
  }

  emitLastTeamStanding(
    matchId: string,
    payload: {
      matchId: string;
      winnerTeamId?: string | null;
      finalizedAt: string;
    },
  ): void {
    void this.emitToMatch(matchId, 'match.last_team_standing', payload);
  }

  emitMatchConcluded(
    matchId: string,
    payload: {
      matchId: string;
      winnerTeamId?: string | null;
      concludedAt: string;
      reason?: string | null;
    },
  ): void {
    void this.emitToMatch(matchId, 'match.concluded', payload);
  }

  emitResultsLockState(
    matchId: string,
    lockState: 'LOCKED' | 'UNLOCKED',
    ctx?: { status?: string | null; dataSource?: string | null },
    orgId?: string | null,
  ): void {
    const event =
      lockState === 'LOCKED'
        ? ('results.locked' as const)
        : ('results.unlocked' as const);
    void this.emitToMatch(
      matchId,
      event,
      {
        matchId,
        lockState: lockState === 'LOCKED' ? 'LOCKED' : 'UNLOCKED',
        status: ctx?.status ?? null,
        dataSource: ctx?.dataSource ?? null,
      },
      orgId,
    );
  }

  broadcastTelemetry(
    matchId: string,
    payload: PcobTelemetryPayload,
    orgId?: string | null,
  ): void {
    void (async () => {
      if (!(await this.assertTelemetryRelayAllowed(matchId))) {
        return;
      }
      await this.emitToMatch(matchId, 'pcob:telemetry:live', payload, orgId);
    })();
  }

  broadcastTest(message: string): void {
    this.io.emit('pcob:telemetry:live', {
      type: 'TEST',
      matchId: 'test',
      ts: Date.now(),
      payload: { message },
      meta: { nodeId: 'test' },
    } as PcobTelemetryPayload);
  }

  emitKill(
    matchId: string,
    payload: {
      source?: string | null;
      teamId: string;
      delta: number;
      playerId?: string | null;
    },
    orgId?: string | null,
  ): void {
    void this.emitToMatch(
      matchId,
      'pcob:telemetry:live',
      {
        type: 'MANUAL_KILL',
        matchId,
        ts: Date.now(),
        payload,
        meta: { nodeId: 'manual' },
      } as PcobTelemetryPayload,
      orgId,
    );
  }

  emitPlacement(
    matchId: string,
    payload: { teamId: string; placement: number },
    orgId?: string | null,
  ): void {
    void this.emitToMatch(
      matchId,
      'pcob:telemetry:live',
      {
        type: 'MANUAL_PLACEMENT',
        matchId,
        ts: Date.now(),
        payload,
        meta: { nodeId: 'manual' },
      } as PcobTelemetryPayload,
      orgId,
    );
  }

  emitResultsUpdated(
    matchId: string,
    roundIndex: number,
    payload?: unknown,
    orgId?: string | null,
  ): void {
    void this.emitToMatch(
      matchId,
      'results.updated',
      { matchId, roundIndex, payload },
      orgId,
    );
    void this.emitToMatch(
      matchId,
      'match.results.updated',
      { matchId, roundIndex, payload },
      orgId,
    );
    void this.emitToMatch(
      matchId,
      'overlay.results',
      { matchId, roundIndex, payload },
      orgId,
    );
    void this.emitToMatch(
      matchId,
      'overlay.scoreboard',
      { matchId, roundIndex, payload },
      orgId,
    );
  }

  emitLeaderboardUpdated(
    matchId: string,
    payload?: unknown,
    orgId?: string | null,
  ): void {
    void this.emitToMatch(
      matchId,
      'leaderboard.updated',
      { matchId, payload },
      orgId,
    );
  }

  emitOverlayPayload(
    matchId: string,
    roundIndex: number,
    payload?: unknown,
    orgId?: string | null,
  ): void {
    void this.emitToMatch(
      matchId,
      'overlay.payload.updated',
      { matchId, roundIndex, payload },
      orgId,
    );
  }

  private room(matchId: string, orgId?: string | null) {
    return orgId ? `match:${orgId}:${matchId}` : `match:${matchId}`;
  }

  private async isAuthorizedForMatch(
    matchId: string,
    user: PcobUser | undefined,
  ): Promise<{ allowed: boolean; organizationId: string | null }> {
    if (!matchId || !user) return { allowed: false, organizationId: null };
    const role = user.role ?? user.actorRole;
    const effectiveOrg = effectiveOrganizationId(user);
    const match = (await this.prisma.match.findFirst({
      where: { id: matchId, deletedAt: null },
      select: {
        organizationId: true,
        controlState: { select: { organizationId: true } },
        tournament: { select: { ownerUserId: true, organizationId: true } },
      },
    })) as {
      organizationId: string | null;
      controlState: { organizationId: string | null } | null;
      tournament: {
        ownerUserId: string | null;
        organizationId: string | null;
      } | null;
    } | null;
    if (!match)
      return {
        allowed: false,
        organizationId: null,
      };
    const matchOrgId =
      match.organizationId ??
      match.controlState?.organizationId ??
      match.tournament?.organizationId ??
      null;
    this.matchOrgCache.set(matchId, matchOrgId ?? null);
    if (!matchOrgId) {
      this.logger.warn(
        `[PCOB] authorization missing organizationId for match=${matchId}`,
      );
    }

    if (role === Role.SUPER_ADMIN) {
      return {
        allowed: !!effectiveOrg && effectiveOrg === matchOrgId,
        organizationId: matchOrgId ?? null,
      };
    }

    const actorId = user.actorId ?? user.id ?? user.sub ?? user.clientId;
    const ownerOk = !!actorId && match.tournament?.ownerUserId === actorId;
    const orgOk = !!effectiveOrg && !!matchOrgId && effectiveOrg === matchOrgId;
    return { allowed: orgOk && ownerOk, organizationId: matchOrgId ?? null };
  }

  afterInit() {
    this.io.use((socket, next) => {
      try {
        const token = this.extractToken(socket);
        if (!token) {
          this.logger.warn(
            'Unauthorized socket connection rejected: missing token',
          );
          throw new UnauthorizedException('Missing token');
        }
        socket.data.user = this.toActor(
          this.jwt.verify<JwtPayload>(token, {
            secret: jwtSecret,
          }),
        );
        return next();
      } catch (err) {
        this.logger.warn(
          `Unauthorized socket connection rejected: ${
            err instanceof Error ? err.message : 'unknown'
          }`,
        );
        return next(new UnauthorizedException('Unauthorized'));
      }
    });

    this.io.on('connection', (socket) => {
      const user = socket.data.user;
      const handshakeMatchId =
        socket.handshake.query?.matchId ??
        socket.handshake.auth?.matchId ??
        socket.handshake.auth?.match_id ??
        socket.handshake.auth?.match;

      this.logger.log(
        `Client connected id=${socket.id} role=${user?.role ?? 'unknown'} clientId=${user?.clientId ?? 'unknown'}`,
      );

      if (typeof handshakeMatchId === 'string' && handshakeMatchId) {
        void this.isAuthorizedForMatch(handshakeMatchId, user)
          .then((auth) => {
            if (!auth.allowed) {
              this.logger.warn(
                `[PCOB] connection rejected: forbidden matchId=${handshakeMatchId} user=${user?.id ?? user?.clientId ?? 'unknown'}`,
              );
              socket.emit('match:error', {
                matchId: handshakeMatchId,
                reason: 'forbidden',
              });
              socket.disconnect(true);
              return;
            }
            socket.data.matchId = handshakeMatchId;
            socket.data.organizationId = auth.organizationId;
            void socket.join(this.room(handshakeMatchId, auth.organizationId));
          })
          .catch((err) => {
            this.logger.warn(
              `[PCOB] connection rejected: ${err instanceof Error ? err.message : 'unknown error'} matchId=${handshakeMatchId}`,
            );
            socket.emit('match:error', {
              matchId: handshakeMatchId,
              reason: 'match_not_found',
            });
            socket.disconnect(true);
          });
      }

      socket.on('pcob:bind', (payload, ack) => {
        void (async () => {
          const matchId = payload?.matchId;
          if (!matchId) {
            ack?.({ ok: false, reason: 'matchId required' });
            return;
          }
          const auth = await this.isAuthorizedForMatch(matchId, user);
          if (!auth.allowed) {
            ack?.({ ok: false, reason: 'forbidden' });
            return;
          }
          const match = await this.prisma.match.findUnique({
            where: { id: matchId },
            select: {
              dataSource: true,
              dataMode: true,
              pcobMode: true,
              pcobSessionId: true,
              adapterKey: true,
            },
          });
          if (!match || resolvePcobCompatibilityMode(match) !== 'PCOB') {
            ack?.({ ok: false, reason: 'legacy_pcob_disabled' });
            return;
          }
          this.bindings.set(socket.id, {
            matchId,
            source: payload?.source,
            nodeId: payload?.nodeId,
            priority: payload?.priority,
            capabilities: payload?.capabilities,
          });
          socket.data.organizationId = auth.organizationId;
          await socket.join(this.room(matchId, auth.organizationId));
          ack?.({ ok: true, matchId });
        })();
      });

      socket.on('join-match', (matchId, ack) => {
        void (async () => {
          if (!matchId) return;
          const auth = await this.isAuthorizedForMatch(matchId, user);
          if (!auth.allowed) {
            ack?.({ ok: false, reason: 'forbidden' });
            socket.emit('match:error', { matchId, reason: 'forbidden' });
            return;
          }
          socket.data.matchId = matchId;
          socket.data.organizationId = auth.organizationId;
          await socket.join(this.room(matchId, auth.organizationId));
          socket.emit('match:joined', { matchId });
          ack?.({ ok: true, matchId });
        })();
      });

      socket.on('leave-match', (matchId) => {
        if (!matchId) return;
        void socket.leave(this.room(matchId));
      });

      socket.on('pcob:telemetry', (payload: PcobTelemetryPayload) => {
        void (async () => {
          const binding = this.bindings.get(socket.id);
          const missing: string[] = [];
          if (!payload?.type) missing.push('type');
          if (!payload?.matchId) missing.push('matchId');
          if (payload?.ts === undefined) missing.push('ts');
          if (payload?.payload === undefined) missing.push('payload');
          if (!payload?.meta?.nodeId) missing.push('meta.nodeId');
          if (missing.length) {
            this.logger.warn(
              `[PCOB] telemetry ignored: missing ${missing.join(', ')} socket=${socket.id}`,
            );
            return;
          }

          const matchId = payload.matchId;
          const nodeId = payload.meta?.nodeId ?? binding?.nodeId ?? 'unknown';
          const userId = user?.clientId ?? user?.sub ?? 'unknown';
          const isHeartbeat = payload.type === 'NODE_HEARTBEAT';

          if (!isHeartbeat) {
            if (!binding) {
              this.logger.warn(
                `[PCOB] telemetry ignored: not bound socket=${socket.id} matchId=${matchId} type=${payload.type}`,
              );
              return;
            }
            if (binding.matchId && matchId !== binding.matchId) {
              this.logger.warn(
                `[PCOB] telemetry rejected due to mismatched matchId socket=${socket.id} bound=${binding.matchId} got=${matchId}`,
              );
              return;
            }
            if (payload.type === 'TEAM_MINIMAP_PRESENCE') {
              const hasTeamId =
                payload?.payload?.teamId !== undefined &&
                payload?.payload?.teamId !== null;
              const hasCoords =
                payload?.payload?.x !== undefined &&
                payload?.payload?.x !== null &&
                payload?.payload?.y !== undefined &&
                payload?.payload?.y !== null;
              if (!hasTeamId || !hasCoords) {
                const reason = !hasTeamId
                  ? 'missing_teamId'
                  : 'missing_coordinates';
                this.logger.warn(
                  `[PCOB][REJECTED] reason=${reason} type=${payload.type} socket=${socket.id}`,
                );
                return;
              }
            }
          }

          if (!(await this.assertTelemetryRelayAllowed(matchId, socket))) {
            return;
          }

          if (!this.scale.filter(matchId, payload)) {
            return;
          }

          this.telemetryCount += 1;
          this.logger.log(
            `[PCOB] telemetry ok type=${payload.type} match=${matchId} node=${nodeId} user=${userId} socket=${socket.id} #${this.telemetryCount}`,
          );
          const orgId = socket.data.organizationId;
          await this.emitToMatch(
            matchId,
            'pcob:telemetry:live',
            payload,
            orgId,
          );
        })();
      });
    });
  }

  private async assertTelemetryRelayAllowed(
    matchId: string,
    socket?: PcobSocket,
  ): Promise<boolean> {
    try {
      const match = await this.prisma.match.findUnique({
        where: { id: matchId },
        select: {
          id: true,
          deletedAt: true,
          organizationId: true,
          status: true,
          liveState: true,
          telemetrySource: true,
          telemetrySourceLockedAt: true,
          dataSource: true,
          dataMode: true,
          pcobMode: true,
          pcobSessionId: true,
          adapterKey: true,
          controlState: {
            select: {
              state: true,
              metaJson: true,
              organizationId: true,
            },
          },
          tournament: {
            select: {
              organizationId: true,
            },
          },
        },
      });
      const compatibilityMode = match
        ? resolvePcobCompatibilityMode(match)
        : 'MANUAL';
      if (compatibilityMode === 'MANUAL') {
        socket?.emit('match:error', {
          matchId,
          reason: 'telemetry_source_guard_failed',
        });
        return false;
      }
      await enforceTelemetrySourceAllowed({
        prisma: this.prisma,
        logger: this.logger,
        match,
        incomingSource: compatibilityMode === 'API' ? 'API' : 'PCOB',
      });
    } catch (error) {
      if (error instanceof TelemetrySourceRejectedException) {
        socket?.emit('match:error', {
          matchId,
          reason: 'telemetry_source_mismatch',
        });
        return false;
      }
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `[PCOB] telemetry relay rejected match=${matchId} reason=${message}`,
      );
      socket?.emit('match:error', {
        matchId,
        reason: 'telemetry_source_guard_failed',
      });
      return false;
    }
    return true;
  }

  private extractToken(socket: PcobSocket): string | null {
    const authToken = socket.handshake?.auth?.token;
    if (typeof authToken === 'string' && authToken.trim().length > 0) {
      return this.stripBearer(authToken);
    }
    const header = socket.handshake?.headers?.authorization;
    if (typeof header === 'string' && header.length > 0) {
      return this.stripBearer(header);
    }
    return null;
  }

  private stripBearer(value: string): string {
    if (!value) return value;
    return value.toLowerCase().startsWith('bearer ') ? value.slice(7) : value;
  }

  private toActor(payload: JwtPayload): PcobUser {
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

  emitKillfeed(
    matchId: string,
    payload: unknown,
    organizationId?: string | null,
  ): void {
    void this.emitToMatch(
      matchId,
      'match.killfeed.append',
      payload,
      organizationId,
    );
  }

  emitTelemetry(
    matchId: string,
    payload: unknown,
    organizationId?: string | null,
  ): void {
    void this.emitToMatch(
      matchId,
      'match.telemetry.updated',
      payload,
      organizationId,
    );
  }

  private async emitToMatch(
    matchId: string,
    event: keyof ServerToClientEvents,
    payload: ServerToClientEvents[keyof ServerToClientEvents],
    organizationId?: string | null,
  ) {
    if (!this.io) return;
    const orgId =
      (organizationId
        ? (this.matchOrgCache.set(matchId, organizationId), organizationId)
        : null) ??
      this.matchOrgCache.get(matchId) ??
      (await this.lookupOrg(matchId));
    if (!orgId) {
      this.logger.warn(
        `[PCOB] emit skipped event=${String(event)} match=${matchId}: organizationId missing on match, tournament, and MatchControlState`,
      );
      return;
    }
    this.io
      .to(this.room(matchId, orgId))
      .emit(event as never, payload as never);
  }

  private async lookupOrg(matchId: string): Promise<string | null> {
    const found = (await this.prisma.match.findFirst({
      where: { id: matchId, deletedAt: null },
      select: {
        organizationId: true,
        controlState: { select: { organizationId: true } },
        tournament: { select: { organizationId: true } },
      },
    })) as {
      organizationId: string | null;
      controlState: { organizationId: string | null } | null;
      tournament: { organizationId: string | null } | null;
    } | null;
    const orgId =
      found?.organizationId ??
      found?.controlState?.organizationId ??
      found?.tournament?.organizationId ??
      null;
    this.matchOrgCache.set(matchId, orgId ?? null);
    if (!orgId) {
      this.logger.warn(
        `[PCOB] organizationId lookup failed for match=${matchId}`,
      );
    }
    return orgId ?? null;
  }
}
