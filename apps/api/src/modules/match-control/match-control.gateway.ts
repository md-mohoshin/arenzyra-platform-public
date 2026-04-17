import { Inject, Logger, forwardRef } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Role } from '@prisma/client';
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  WsException,
} from '@nestjs/websockets';
import type {
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import type { Actor } from '../../common/auth/jwt.strategy';
import type { LiveStateUpdatePayload } from '../matches/matches.service';
import {
  MatchControlService,
  type ControlHealth,
} from './match-control.service';
import type { ControlStatus } from './dto/control.dto';
import type { LiveMatchState, TeamScoreState } from './state.store';
import {
  EndMatchCommandDto,
  JoinMatchRoomDto,
  MatchCommandBaseDto,
  MATCH_COMMAND_TYPES,
  type MatchCommandDto,
  type MatchCommandType,
  SetFocusCommandDto,
  SetStatusCommandDto,
  StartMatchCommandDto,
} from './dto/realtime.dto';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

type MatchControlSocketData = {
  user?: Actor;
  matchId?: string;
  organizationId?: string | null;
};

type MatchRoomPayload = { matchId: string };

type SetStatusPayload = {
  matchId: string;
  status: ControlStatus;
  version?: number;
};

type UpdateScorePayload = {
  matchId: string;
  teamId: string;
  placement?: number;
  kills?: number;
  version?: number;
};

type PingPayload = {
  matchId?: string;
};

type MatchCommandResult =
  | { ok: true; type: MatchCommandType; state: LiveMatchState }
  | { ok: false; type?: MatchCommandType; error: string };

type ControlStateEvent = {
  controlState: ControlStatus;
  updatedAt: string;
  byUser: string;
};

type SystemStatusEvent = {
  dataSource: string;
  connection: string;
};

type AuditAppendEvent = {
  action: string;
  byUser: string;
  matchId: string;
  reason?: string | null;
  from?: ControlStatus;
  to?: ControlStatus;
  at: string;
};

type ServerToClientEvents = {
  'match:state': (state: LiveMatchState) => void;
  'match:update': (state: LiveMatchState) => void;
  'match:end': (state: LiveMatchState) => void;
  'match:auto-ended': (state: LiveMatchState) => void;
  'match:slots-assigned': (payload: {
    matchId: string;
    assignedSlots: Array<{ teamId: string; slotNumber: number }>;
  }) => void;
  'match:state-changed': (payload: {
    matchId: string;
    oldControlState: string;
    newControlState: string;
    previousState?: string;
    reason?: string | null;
  }) => void;
  'group:state-changed': (payload: {
    groupId: string;
    previousState: string;
    newState: string;
  }) => void;
  'stage:state-changed': (payload: {
    stageId: string;
    previousState: string;
    newState: string;
  }) => void;
  'team:update': (payload: { team: TeamScoreState; version: number }) => void;
  'control:health': (payload: ControlHealth) => void;
  'match:command:result': (payload: MatchCommandResult) => void;
  pong: (payload: { ok: boolean }) => void;
  'match.control.state': (payload: ControlStateEvent) => void;
  'match.control_state.changed': (payload: {
    matchId: string;
    previousState: ControlStatus;
    state: ControlStatus;
    updatedAt: string;
    reason?: string | null;
    meta?: unknown;
  }) => void;
  'match.system.status': (payload: SystemStatusEvent) => void;
  'match.audit.append': (payload: AuditAppendEvent) => void;
  'live-state:update': (payload: LiveStateUpdatePayload) => void;
};

type MatchRoomEmitter = {
  emit<E extends keyof ServerToClientEvents>(
    event: E,
    payload: Parameters<ServerToClientEvents[E]>[0],
  ): void;
};

type MatchServer = {
  to(room: string): MatchRoomEmitter;
  emit<E extends keyof ServerToClientEvents>(
    event: E,
    payload: Parameters<ServerToClientEvents[E]>[0],
  ): void;
};

type MatchSocket = {
  data: MatchControlSocketData;
  handshake: {
    headers: { authorization?: string | string[] | undefined };
    auth?: { token?: unknown } | Record<string, unknown>;
  };
  join: (room: string) => Promise<void> | void;
  leave: (room: string) => Promise<void> | void;
  emit<E extends keyof ServerToClientEvents>(
    event: E,
    payload: Parameters<ServerToClientEvents[E]>[0],
  ): void;
  disconnect: (close?: boolean) => void;
};

type Ack = { ok: true; state: LiveMatchState };

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

/**
 * Socket usage (client example):
 * const socket = io('/ws', { auth: { token: '<JWT>' } });
 * socket.emit('match:join', { matchId }, (ack) => console.log(ack));
 * socket.on('match:state', (state) => console.log(state));
 * socket.emit('match:command', { type: 'SET_STATUS', matchId, status: 'LIVE' });
 */
@WebSocketGateway({
  namespace: '/ws',
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
    credentials: true,
  },
  transports: ['websocket', 'polling'],
})
export class MatchControlGateway
  implements OnGatewayConnection<MatchSocket>, OnGatewayDisconnect<MatchSocket>
{
  @WebSocketServer()
  private readonly server?: MatchServer;

  private readonly logger = new Logger(MatchControlGateway.name);

  constructor(
    private readonly jwt: JwtService,
    @Inject(forwardRef(() => MatchControlService))
    private readonly service: MatchControlService,
  ) {}

  handleConnection(socket: MatchSocket) {
    try {
      socket.data.user = this.extractUser(socket);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unauthorized connection';
      this.logger.warn(`Socket rejected: ${message}`);
      socket.disconnect(true);
    }
  }

  handleDisconnect(socket: MatchSocket) {
    if (socket.data.matchId) {
      void socket.leave(this.room(socket.data.matchId));
    }
  }

  @SubscribeMessage('joinMatchRoom')
  async joinMatchRoom(
    @MessageBody() payload: MatchRoomPayload,
    @ConnectedSocket() socket: MatchSocket,
  ): Promise<Ack> {
    const actor = this.ensureUser(socket);
    this.ensureMatchId(payload.matchId);

    await this.service.authorize(actor, payload.matchId);
    const room = this.room(payload.matchId);
    await socket.join(room);
    socket.data.matchId = payload.matchId;

    const state = await this.service.getState(actor, payload.matchId);
    socket.emit('match:state', state);
    return { ok: true, state };
  }

  @SubscribeMessage('leaveMatchRoom')
  async leaveMatchRoom(
    @MessageBody() payload: MatchRoomPayload,
    @ConnectedSocket() socket: MatchSocket,
  ): Promise<{ ok: true }> {
    this.ensureMatchId(payload.matchId);
    await socket.leave(this.room(payload.matchId));
    if (socket.data.matchId === payload.matchId) {
      socket.data.matchId = undefined;
    }
    return { ok: true };
  }

  @SubscribeMessage('broadcastMatchState')
  async broadcastMatchState(
    @MessageBody() payload: MatchRoomPayload,
    @ConnectedSocket() socket: MatchSocket,
  ): Promise<Ack> {
    const actor = this.ensureUser(socket);
    this.ensureMatchId(payload.matchId);
    const state = await this.service.getState(actor, payload.matchId);
    return { ok: true, state };
  }

  @SubscribeMessage('setMatchStatus')
  async setMatchStatus(
    @MessageBody() payload: SetStatusPayload,
    @ConnectedSocket() socket: MatchSocket,
  ): Promise<Ack> {
    const actor = this.ensureUser(socket);
    this.ensureMatchId(payload.matchId);
    const state = await this.service.setStatus(actor, payload.matchId, {
      status: payload.status,
      version: payload.version,
    });
    return { ok: true, state };
  }

  @SubscribeMessage('updateTeamScore')
  async updateTeamScore(
    @MessageBody() payload: UpdateScorePayload,
    @ConnectedSocket() socket: MatchSocket,
  ): Promise<Ack> {
    const actor = this.ensureUser(socket);
    this.ensureMatchId(payload.matchId);
    const state = await this.service.updateScore(actor, payload.matchId, {
      teamId: payload.teamId,
      placement: payload.placement,
      kills: payload.kills,
      version: payload.version,
    });
    return { ok: true, state };
  }

  @SubscribeMessage('endMatch')
  async endMatch(
    @MessageBody() payload: MatchRoomPayload,
    @ConnectedSocket() socket: MatchSocket,
  ): Promise<Ack> {
    const actor = this.ensureUser(socket);
    this.ensureMatchId(payload.matchId);
    const state = await this.service.endMatch(actor, payload.matchId);
    return { ok: true, state };
  }

  emitMatchState(
    matchId: string,
    state: LiveMatchState,
    organizationId?: string | null,
  ) {
    const room = this.room(matchId, organizationId);
    this.server?.to(room).emit('match:state', state);
    this.server?.to(room).emit('match:update', state);
  }

  emitSlotsAssigned(
    matchId: string,
    assignedSlots: Array<{ teamId: string; slotNumber: number }>,
    organizationId?: string | null,
  ) {
    const room = this.room(matchId, organizationId);
    this.server?.to(room).emit('match:slots-assigned', {
      matchId,
      assignedSlots,
    });
  }

  emitMatchAutoEnd(
    matchId: string,
    state: LiveMatchState,
    organizationId?: string | null,
  ) {
    const room = this.room(matchId, organizationId);
    this.server?.to(room).emit('match:auto-ended', state);
    this.server?.to(room).emit('match:end', state);
  }

  emitMatchStateChanged(
    matchId: string,
    oldControlState: string,
    newControlState: string,
    reason?: string | null,
    organizationId?: string | null,
  ) {
    const room = this.room(matchId, organizationId);
    this.server?.to(room).emit('match:state-changed', {
      matchId,
      oldControlState,
      newControlState,
      previousState: oldControlState,
      reason,
    });
  }

  emitGroupStateChanged(
    groupId: string,
    previousState: string,
    newState: string,
    organizationId?: string | null,
  ) {
    const room = this.room(groupId, organizationId);
    this.server?.to(room).emit('group:state-changed', {
      groupId,
      previousState,
      newState,
    });
  }

  emitStageStateChanged(
    stageId: string,
    previousState: string,
    newState: string,
    organizationId?: string | null,
  ) {
    const room = this.room(stageId, organizationId);
    this.server?.to(room).emit('stage:state-changed', {
      stageId,
      previousState,
      newState,
    });
  }

  emitTeamUpdate(
    matchId: string,
    team: TeamScoreState,
    version: number,
    organizationId?: string | null,
  ) {
    const room = this.room(matchId, organizationId);
    this.server?.to(room).emit('team:update', { team, version });
  }

  emitMatchEnd(
    matchId: string,
    state: LiveMatchState,
    organizationId?: string | null,
  ) {
    const room = this.room(matchId, organizationId);
    this.server?.to(room).emit('match:end', state);
  }

  emitLiveStateUpdates(payloads: LiveStateUpdatePayload[]) {
    payloads.forEach((payload) => {
      this.server?.emit('live-state:update', payload);
    });
  }

  emitControlState(matchId: string, payload: ControlStateEvent) {
    this.server?.to(this.room(matchId)).emit('match.control.state', payload);
  }

  emitControlStateChanged(
    matchId: string,
    payload: {
      matchId: string;
      previousState: ControlStatus;
      state: ControlStatus;
      updatedAt: string;
      reason?: string | null;
      meta?: unknown;
    },
  ) {
    this.server
      ?.to(this.room(matchId))
      .emit('match.control_state.changed', payload);
  }

  emitSystemStatus(matchId: string, payload: SystemStatusEvent) {
    this.server?.to(this.room(matchId)).emit('match.system.status', payload);
  }

  emitAuditAppend(matchId: string, payload: AuditAppendEvent) {
    this.server?.to(this.room(matchId)).emit('match.audit.append', payload);
  }

  @SubscribeMessage('control:ping')
  async ping(
    @MessageBody() payload: PingPayload,
    @ConnectedSocket() socket: MatchSocket,
  ): Promise<ControlHealth> {
    const actor = this.ensureOrganizer(socket);
    const matchId =
      payload && typeof payload.matchId === 'string' ? payload.matchId : null;
    const health = await this.service.health(actor, matchId ?? undefined);
    socket.emit('control:health', health);
    return health;
  }

  @SubscribeMessage('ping')
  handlePing(@ConnectedSocket() socket: MatchSocket) {
    socket.emit('pong', { ok: true });
  }

  @SubscribeMessage('match:join')
  async joinMatch(
    @MessageBody() payload: JoinMatchRoomDto,
    @ConnectedSocket() socket: MatchSocket,
  ): Promise<Ack> {
    const actor = this.ensureOrganizer(socket);
    const dto = this.validateDto(JoinMatchRoomDto, payload);
    await this.service.authorize(actor, dto.matchId);
    const room = this.room(dto.matchId, socket.data.organizationId);
    await socket.join(room);
    socket.data.matchId = dto.matchId;
    const state = await this.service.getState(actor, dto.matchId);
    socket.emit('match:state', state);
    return { ok: true, state };
  }

  @SubscribeMessage('match:command')
  async handleCommand(
    @MessageBody() payload: unknown,
    @ConnectedSocket() socket: MatchSocket,
  ): Promise<MatchCommandResult> {
    const actor = this.ensureOrganizer(socket);
    const command = this.parseCommand(payload);
    let state: LiveMatchState | null = null;
    try {
      switch (command.type) {
        case 'START_MATCH':
          state = await this.service.startMatch(actor, command.matchId);
          break;
        case 'END_MATCH':
          state = await this.service.endMatch(actor, command.matchId);
          break;
        case 'SET_STATUS':
          state = await this.service.setStatus(actor, command.matchId, {
            status: command.status,
            version: command.version,
          });
          break;
        case 'SET_FOCUS':
          return {
            ok: false,
            type: command.type,
            error: 'UNSUPPORTED_COMMAND',
          };
        default:
          return { ok: false, error: 'UNSUPPORTED_COMMAND' };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Command failed';
      return { ok: false, type: command.type, error: message };
    }

    const result: MatchCommandResult = {
      ok: true,
      type: command.type,
      state,
    };
    const room = this.room(command.matchId);
    this.server?.to(room).emit('match:state', state);
    socket.emit('match:command:result', result);
    return result;
  }

  private room(matchId: string, orgId?: string | null): string {
    return orgId ? `match:${orgId}:${matchId}` : `match:${matchId}`;
  }

  private ensureMatchId(
    matchId: string | undefined,
  ): asserts matchId is string {
    if (!matchId || typeof matchId !== 'string') {
      throw new WsException('matchId is required');
    }
  }

  private ensureUser(socket: MatchSocket): Actor {
    if (socket.data.user) return socket.data.user;
    const user = this.extractUser(socket);
    socket.data.user = user;
    return user;
  }

  private ensureOrganizer(socket: MatchSocket): Actor {
    const actor = this.ensureUser(socket);
    const role = actor.actorRole ?? actor.role;
    if (
      role !== Role.ORGANIZER &&
      role !== Role.ADMIN &&
      role !== Role.SUPER_ADMIN
    ) {
      throw new WsException('Forbidden');
    }
    return actor;
  }

  private extractToken(socket: MatchSocket): string {
    const header = socket.handshake.headers.authorization;
    if (typeof header === 'string' && header.startsWith('Bearer ')) {
      return header.slice(7);
    }
    const auth = socket.handshake.auth as { token?: unknown } | undefined;
    if (auth && typeof auth.token === 'string') {
      return auth.token;
    }
    throw new WsException('Unauthorized');
  }

  private extractUser(socket: MatchSocket): Actor {
    const token = this.extractToken(socket);
    const payload = this.jwt.verify<JwtPayload>(token);
    return this.toActor(payload);
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

  private validateDto<T extends object>(cls: new () => T, payload: unknown): T {
    const dto = plainToInstance(cls, payload ?? {});
    const errors = validateSync(dto, {
      whitelist: true,
      forbidUnknownValues: true,
    });
    if (errors.length) {
      const first = errors[0];
      const constraints = first?.constraints
        ? Object.values(first.constraints).join(', ')
        : 'Validation failed';
      throw new WsException(constraints);
    }
    return dto;
  }

  private parseCommand(payload: unknown): MatchCommandDto {
    const base = this.validateDto(MatchCommandBaseDto, payload);
    const type = base.type;
    if (!MATCH_COMMAND_TYPES.includes(type)) {
      throw new WsException('Invalid command type');
    }
    if (type === 'START_MATCH') {
      return this.validateDto(StartMatchCommandDto, payload);
    }
    if (type === 'END_MATCH') {
      return this.validateDto(EndMatchCommandDto, payload);
    }
    if (type === 'SET_STATUS') {
      return this.validateDto(SetStatusCommandDto, payload);
    }
    if (type === 'SET_FOCUS') {
      return this.validateDto(SetFocusCommandDto, payload);
    }
    throw new WsException('Invalid command type');
  }
}
