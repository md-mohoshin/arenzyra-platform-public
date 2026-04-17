import { Logger, OnModuleDestroy } from '@nestjs/common';
import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import type { NormalizedMatchState } from '../../types/normalized-match-state';
import { PcobEventsService } from '../pcob/pcob-events.service';
import { PcobHealthService, HealthSnapshot } from '../pcob/pcob-health.service';
import { BroadcastStateService } from './broadcast-state.service';

type BroadcastPayload = { matchId: string };

type ClientToServerEvents = {
  'broadcast:join': (payload: BroadcastPayload | string) => void;
  'broadcast:leave': (payload: BroadcastPayload | string) => void;
  WWCD_PLAY: (payload: WwcdPlayPayload) => void;
  WWCD_HIDE: (payload: WwcdHidePayload) => void;
  MVP_PLAY: (payload: MvpPlayPayload) => void;
  MVP_HIDE: (payload: MvpHidePayload) => void;
  PLAYER_ACHIEVEMENT_PLAY: (payload: PlayerAchievementPlayPayload) => void;
  PLAYER_ACHIEVEMENT_HIDE: (payload: PlayerAchievementHidePayload) => void;
};

type ServerToClientEvents = {
  'broadcast:joined': (payload: { matchId: string }) => void;
  'broadcast:state': (payload: OverlayPacket) => void;
  WWCD_PLAY: (payload: WwcdPlayPayload) => void;
  WWCD_HIDE: (payload: WwcdHidePayload) => void;
  MVP_PLAY: (payload: MvpPlayPayload) => void;
  MVP_HIDE: (payload: MvpHidePayload) => void;
  PLAYER_ACHIEVEMENT_PLAY: (payload: PlayerAchievementPlayPayload) => void;
  PLAYER_ACHIEVEMENT_HIDE: (payload: PlayerAchievementHidePayload) => void;
  TEAM_ASSET_UPDATED: (payload: {
    teamId: string;
    version: number;
    logoUrl?: string | null;
  }) => void;
  PLAYER_ASSET_UPDATED: (payload: {
    playerId: string;
    version: number;
    photoUrl?: string | null;
  }) => void;
  TEAM_BRAND_UPDATED: (payload: TeamBrandUpdatedPayload) => void;
};

type BroadcastRoomEmitter = {
  emit<E extends keyof ServerToClientEvents>(
    event: E,
    ...args: Parameters<ServerToClientEvents[E]>
  ): void;
};

type BroadcastServer = {
  to: (room: string) => BroadcastRoomEmitter;
  emit<E extends keyof ServerToClientEvents>(
    event: E,
    ...args: Parameters<ServerToClientEvents[E]>
  ): void;
};

type BroadcastSocket = {
  id: string;
  handshake: { query?: Record<string, unknown> };
  join: (room: string) => Promise<void> | void;
  leave: (room: string) => Promise<void> | void;
  emit<E extends keyof ServerToClientEvents>(
    event: E,
    ...args: Parameters<ServerToClientEvents[E]>
  ): void;
  on<K extends keyof ClientToServerEvents>(
    event: K,
    handler: ClientToServerEvents[K],
  ): void;
};

type OverlayTeam = {
  teamId: string | null;
  name: string | null;
  logoUrl: string | null;
  alive: boolean;
  kills: number;
};

type TeamBrandPresetPayload = {
  logoUrl?: string | null;
  accent?: string | null;
  text?: string | null;
};

type TeamBrandUpdatedPayload = {
  teamId: string;
  version?: number;
  light?: TeamBrandPresetPayload;
  dark?: TeamBrandPresetPayload;
};

type OverlayPacket = {
  type: 'MATCH_STATE';
  matchId: string;
  sessionId: string | null;
  updatedAt: number;
  teams: OverlayTeam[];
  focus: unknown;
  health: unknown;
};

type WwcdPlayPayload = {
  matchId: string;
  organizationId?: string | null;
  teamId?: string | null;
  teamTag?: string | null;
  teamName?: string | null;
  teamLogo?: string | null;
  branding?: unknown;
};

type WwcdHidePayload = {
  matchId: string;
};

type MvpPlayPayload = {
  matchId: string;
  organizationId?: string | null;
  playerId?: string | null;
  playerName?: string | null;
  playerIgn?: string | null;
  playerPhoto?: string | null;
  teamId?: string | null;
  teamTag?: string | null;
  teamName?: string | null;
  teamLogo?: string | null;
  stats?: unknown;
  branding?: unknown;
};

type MvpHidePayload = {
  matchId: string;
};

type PlayerAchievementPlayPayload = {
  matchId: string;
  organizationId?: string | null;
  playerId?: string | null;
  playerName?: string | null;
  playerPhotoUrl?: string | null;
  teamId?: string | null;
  teamName?: string | null;
  teamTag?: string | null;
  teamLogoUrl?: string | null;
  achievementType?: string | null;
  branding?: unknown;
};

type PlayerAchievementHidePayload = {
  matchId: string;
};

@WebSocketGateway({
  namespace: '/broadcast',
  cors: { origin: true, credentials: false },
  transports: ['websocket'],
  path: '/broadcast/socket.io',
})
export class BroadcastGateway implements OnModuleDestroy {
  @WebSocketServer()
  private io!: BroadcastServer;

  private readonly logger = new Logger('BroadcastGateway');
  private readonly lastHash = new Map<string, string>();
  private readonly lastEmitAt = new Map<string, number>();
  private unsubscribeTelemetry: (() => void) | null = null;
  private readonly minEmitIntervalMs = 100; // 10 emits/sec
  private readonly broadcastDelayMs = Number(
    process.env.BROADCAST_DELAY_MS ?? 1000,
  );
  private pending = new Map<
    string,
    { state: OverlayPacket; timer: NodeJS.Timeout }
  >();

  constructor(
    private readonly events: PcobEventsService,
    private readonly state: BroadcastStateService,
    private readonly health: PcobHealthService,
  ) {
    this.unsubscribeTelemetry = this.events.onTelemetry((evt) => {
      void this.processTelemetry(evt.matchId, evt.payload);
    });
  }

  onModuleDestroy() {
    if (this.unsubscribeTelemetry) {
      this.unsubscribeTelemetry();
      this.unsubscribeTelemetry = null;
    }
    this.pending.forEach((entry) => clearTimeout(entry.timer));
    this.pending.clear();
  }

  handleConnection(client: BroadcastSocket) {
    const matchId = this.extractMatchId(client);
    this.logger.log(
      `Broadcast client connected id=${client.id ?? 'unknown'} match=${matchId ?? 'none'}`,
    );
    if (matchId) {
      void client.join(this.room(matchId));
      void this.sendLatest(matchId, client);
    }
    this.registerHandlers(client);
  }

  handleDisconnect(client: BroadcastSocket) {
    this.logger.log(
      `Broadcast client disconnected id=${client.id ?? 'unknown'}`,
    );
  }

  private registerHandlers(socket: BroadcastSocket) {
    socket.on('broadcast:join', (payload) => {
      const matchId = this.normalizeMatchId(payload);
      if (!matchId) return;
      void socket.join(this.room(matchId));
      socket.emit('broadcast:joined', { matchId });
      void this.sendLatest(matchId, socket);
    });

    socket.on('broadcast:leave', (payload) => {
      const matchId = this.normalizeMatchId(payload);
      if (!matchId) return;
      void socket.leave(this.room(matchId));
    });

    socket.on('WWCD_PLAY', (payload: WwcdPlayPayload) => {
      const payloadMatch =
        payload &&
        typeof payload === 'object' &&
        'matchId' in payload &&
        typeof (payload as { matchId?: unknown }).matchId === 'string'
          ? (payload as { matchId: string }).matchId
          : null;
      const payloadTeam =
        payload &&
        typeof payload === 'object' &&
        'teamId' in payload &&
        typeof (payload as { teamId?: unknown }).teamId === 'string'
          ? (payload as { teamId: string }).teamId
          : null;

      this.logger.log(
        `[BroadcastGateway] WWCD_PLAY recv match=${payloadMatch ?? 'none'} team=${payloadTeam ?? 'none'}`,
      );
      if (!payload || typeof payload !== 'object') return;
      const matchId = this.normalizeMatchId(
        (payload as { matchId?: string }).matchId ?? null,
      );
      if (!matchId) return;
      this.io
        ?.to(this.room(matchId))
        .emit('WWCD_PLAY', { ...payload, matchId });
    });

    socket.on('WWCD_HIDE', (payload: WwcdHidePayload) => {
      const payloadMatch =
        payload &&
        typeof payload === 'object' &&
        'matchId' in payload &&
        typeof (payload as { matchId?: unknown }).matchId === 'string'
          ? (payload as { matchId: string }).matchId
          : null;

      this.logger.log(
        `[BroadcastGateway] WWCD_HIDE recv match=${payloadMatch ?? 'none'}`,
      );
      const matchId = this.normalizeMatchId(payloadMatch);
      if (!matchId) return;
      this.io?.to(this.room(matchId)).emit('WWCD_HIDE', { matchId });
    });

    socket.on('MVP_PLAY', (payload: MvpPlayPayload) => {
      const payloadMatch =
        payload &&
        typeof payload === 'object' &&
        'matchId' in payload &&
        typeof (payload as { matchId?: unknown }).matchId === 'string'
          ? (payload as { matchId: string }).matchId
          : null;
      this.logger.log(
        `[BroadcastGateway] MVP_PLAY recv match=${payloadMatch ?? 'none'} player=${
          (payload as { playerId?: string })?.playerId ?? 'none'
        }`,
      );
      const matchId = this.normalizeMatchId(payloadMatch);
      if (!matchId) return;
      this.io?.to(this.room(matchId)).emit('MVP_PLAY', { ...payload, matchId });
    });

    socket.on('MVP_HIDE', (payload: MvpHidePayload) => {
      const payloadMatch =
        payload &&
        typeof payload === 'object' &&
        'matchId' in payload &&
        typeof (payload as { matchId?: unknown }).matchId === 'string'
          ? (payload as { matchId: string }).matchId
          : null;
      this.logger.log(
        `[BroadcastGateway] MVP_HIDE recv match=${payloadMatch ?? 'none'}`,
      );
      const matchId = this.normalizeMatchId(payloadMatch);
      if (!matchId) return;
      this.io?.to(this.room(matchId)).emit('MVP_HIDE', { matchId });
    });

    socket.on(
      'PLAYER_ACHIEVEMENT_PLAY',
      (payload: PlayerAchievementPlayPayload) => {
        const payloadMatch =
          payload &&
          typeof payload === 'object' &&
          'matchId' in payload &&
          typeof (payload as { matchId?: unknown }).matchId === 'string'
            ? (payload as { matchId: string }).matchId
            : null;
        const payloadPlayer =
          payload &&
          typeof payload === 'object' &&
          'playerId' in payload &&
          typeof (payload as { playerId?: unknown }).playerId === 'string'
            ? (payload as { playerId: string }).playerId
            : null;

        this.logger.log(
          `[BroadcastGateway] PLAYER_ACHIEVEMENT_PLAY recv match=${payloadMatch ?? 'none'} player=${payloadPlayer ?? 'none'}`,
        );
        const matchId = this.normalizeMatchId(payloadMatch);
        if (!matchId) return;
        this.emitPlayerAchievement({ ...payload, matchId });
      },
    );

    socket.on(
      'PLAYER_ACHIEVEMENT_HIDE',
      (payload: PlayerAchievementHidePayload) => {
        const payloadMatch =
          payload &&
          typeof payload === 'object' &&
          'matchId' in payload &&
          typeof (payload as { matchId?: unknown }).matchId === 'string'
            ? (payload as { matchId: string }).matchId
            : null;
        this.logger.log(
          `[BroadcastGateway] PLAYER_ACHIEVEMENT_HIDE recv match=${payloadMatch ?? 'none'}`,
        );
        const matchId = this.normalizeMatchId(payloadMatch);
        if (!matchId) return;
        this.hidePlayerAchievement({ matchId });
      },
    );
  }

  emitPlayerAchievement(payload: PlayerAchievementPlayPayload): void {
    const matchId = this.normalizeMatchId(payload?.matchId ?? null);
    if (!matchId) {
      return;
    }

    this.io
      ?.to(this.room(matchId))
      .emit('PLAYER_ACHIEVEMENT_PLAY', { ...payload, matchId });
  }

  hidePlayerAchievement(payload: PlayerAchievementHidePayload): void {
    const matchId = this.normalizeMatchId(payload?.matchId ?? null);
    if (!matchId) {
      return;
    }

    this.io
      ?.to(this.room(matchId))
      .emit('PLAYER_ACHIEVEMENT_HIDE', { matchId });
  }

  private async processTelemetry(matchId: string, payload: unknown) {
    try {
      const enriched = await this.state.ingest(
        matchId,
        payload as Record<string, unknown>,
      );
      if (enriched) {
        const packet = this.toOverlayState(enriched, matchId);
        if (packet) {
          this.emitState(matchId, packet);
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Failed to handle telemetry for match=${matchId}: ${message}`,
      );
    }
  }

  private normalizeMatchId(
    input: BroadcastPayload | string | null,
  ): string | null {
    if (!input) return null;
    if (typeof input === 'string') return input;
    if (typeof input.matchId === 'string') return input.matchId;
    return null;
  }

  private extractMatchId(socket: BroadcastSocket): string | null {
    const query = socket.handshake?.query ?? {};
    const matchId = typeof query.matchId === 'string' ? query.matchId : null;
    return matchId;
  }

  private room(matchId: string) {
    return `broadcast:${matchId}`;
  }

  private async sendLatest(matchId: string, socket?: BroadcastSocket) {
    const state = await this.state.latest(matchId);
    if (!state) return;
    const packet = this.toOverlayState(state, matchId);
    if (!packet) return;
    if (socket) {
      socket.emit('broadcast:state', packet);
      return;
    }
    this.emitState(matchId, packet);
  }

  private emitState(matchId: string, packet: OverlayPacket) {
    if (!packet || !this.io) return;
    if (this.broadcastDelayMs > 0) {
      const existing = this.pending.get(matchId);
      if (existing?.timer) {
        clearTimeout(existing.timer);
      }
      const timer = setTimeout(() => {
        const entry = this.pending.get(matchId);
        if (!entry) return;
        this.emitImmediate(matchId, entry.state);
        this.pending.delete(matchId);
      }, this.broadcastDelayMs);
      this.pending.set(matchId, { state: packet, timer });
      return;
    }
    this.emitImmediate(matchId, packet);
  }

  private emitImmediate(matchId: string, packet: OverlayPacket) {
    const serialized = JSON.stringify(packet);
    const prev = this.lastHash.get(matchId);
    const now = Date.now();
    const last = this.lastEmitAt.get(matchId) ?? 0;
    if (prev === serialized) return;
    if (now - last < this.minEmitIntervalMs) return;
    this.lastHash.set(matchId, serialized);
    this.lastEmitAt.set(matchId, now);
    this.io.to(this.room(matchId)).emit('broadcast:state', packet);
    this.logger.log(`Broadcasted normalized state match=${matchId}`);
  }

  emitTeamAssetUpdated(payload: {
    teamId: string;
    version: number;
    logoUrl?: string | null;
  }) {
    if (!this.io) return;
    this.io.emit('TEAM_ASSET_UPDATED', payload);
  }

  emitPlayerAssetUpdated(payload: {
    playerId: string;
    version: number;
    photoUrl?: string | null;
  }) {
    if (!this.io) return;
    this.io.emit('PLAYER_ASSET_UPDATED', payload);
  }

  emitTeamBrandUpdated(payload: TeamBrandUpdatedPayload) {
    if (!this.io) return;
    this.io.emit('TEAM_BRAND_UPDATED', payload);
  }

  private toOverlayState(
    state: NormalizedMatchState,
    matchId: string,
  ): OverlayPacket | null {
    if (!state) return null;
    const meta = state.meta ?? {};
    const teams: OverlayTeam[] = Array.isArray(state.teams)
      ? state.teams.map((t) => ({
          teamId: t.teamId ?? null,
          name: t.name ?? t.tag ?? null,
          logoUrl: t.logoUrl ?? null,
          alive: !t.eliminated && (t.aliveCount ?? 0) > 0,
          kills: t.kills ?? 0,
        }))
      : [];
    const focus = state.focus ?? null;
    const health: HealthSnapshot | null =
      this.health?.get(state.matchId ?? matchId) ?? null;
    const sessionMeta = meta as Record<string, unknown>;
    const sessionIdCandidate: string | null =
      typeof sessionMeta?.sessionId === 'string' ? sessionMeta.sessionId : null;
    return {
      type: 'MATCH_STATE',
      matchId: state.matchId ?? matchId,
      sessionId: sessionIdCandidate ?? null,
      updatedAt: Date.now(),
      teams,
      focus,
      health,
    };
  }
}
