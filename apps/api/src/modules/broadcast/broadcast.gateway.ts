import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Inject, Logger, OnModuleDestroy, forwardRef } from '@nestjs/common';
import type {
  Server as SocketIOServer,
  Socket as SocketIOSocket,
} from 'socket.io';
import { PrismaService } from '../../db/prisma.service';
import { MatchStatus } from '@prisma/client';
import {
  buildWidgetScoreboardSnapshot,
  TEAM_LOGO_PLACEHOLDER,
} from '../widgets/widgets.snapshot';
import type { WidgetTeamSlotRow } from '../widgets/widgets.contract';
import type {
  BroadcastPayload,
  MatchLowerThirdEventPayload,
} from './broadcast.service';
import { LiveBattleRankingService } from '../widgets/live-battle-ranking.service';
import type { MatchLiveStatePayload } from '../realtime/match-live-state.types';
import { resolveTeamBranding } from '../../common/team-branding.util';
import { CanonicalControlReadService } from '../realtime/canonical-control-read.service';
import { buildAllowedCorsOrigins } from '../../common/cors.util';

const DEFAULT_WIDGET_TEAM_NAME = 'Arenzyra';
const DEFAULT_WIDGET_TEAM_TAG = 'AZ';

const widgetBroadcastAllowedOrigins = buildAllowedCorsOrigins();

@WebSocketGateway({
  namespace: '/widget-broadcast',
  cors: {
    origin: widgetBroadcastAllowedOrigins,
    methods: ['GET', 'POST'],
    credentials: true,
  },
})
export class WidgetBroadcastGateway implements OnModuleDestroy {
  @WebSocketServer()
  private io!: SocketIOServer;

  private readonly logger = new Logger('WidgetBroadcastGateway');
  private readonly widgetDebug = process.env.WIDGET_DEBUG === 'true';
  private readonly tickIntervalMs = 1000;
  private ticker: NodeJS.Timeout | null = null;
  private readonly lastMatchByBroadcast = new Map<string, string | null>();
  private readonly lastErrorTs = new Map<string, number>();
  private readonly liveStateCache = new Map<
    string,
    { signature: string; matchId: string | null }
  >();
  private readonly errorThrottleMs = 10_000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly liveBattleRanking: LiveBattleRankingService,
    @Inject(forwardRef(() => CanonicalControlReadService))
    private readonly canonicalRead: CanonicalControlReadService,
  ) {}

  afterInit(server: SocketIOServer) {
    this.io = server;
    this.startTicker();
  }

  onModuleDestroy() {
    if (this.ticker) clearInterval(this.ticker);
    this.ticker = null;
  }

  handleConnection(client: SocketIOSocket) {
    const socketWithId = client as SocketIOSocket & { id?: string };
    this.logger.debug(`Client ${socketWithId.id ?? 'unknown'} connected`);
    const socket = client as SocketIOSocket & {
      id?: string;
      handshake?: { query?: Record<string, unknown> };
    };
    const key = this.extractBroadcastKey(socket);
    if (key) {
      void this.joinRoom(socket, key);
    }
  }

  @SubscribeMessage('broadcast:join')
  async handleJoin(
    @ConnectedSocket() client: SocketIOSocket,
    @MessageBody() payload: { broadcastKey?: string | null },
  ) {
    const key =
      typeof payload?.broadcastKey === 'string' &&
      payload.broadcastKey.trim().length > 0
        ? payload.broadcastKey.trim()
        : null;
    if (!key) return;
    await this.joinRoom(client, key);
  }

  @SubscribeMessage('join')
  async handleJoinAlias(
    @ConnectedSocket() client: SocketIOSocket,
    @MessageBody() payload: { broadcastKey?: string | null },
  ) {
    await this.handleJoin(client, payload);
  }

  emitToBroadcast(broadcastKey: string, payload: BroadcastPayload) {
    if (!broadcastKey || !this.io) return;
    this.io.to(this.room(broadcastKey)).emit('widget:update', payload);
  }

  emitMatchLowerThirdShow(
    broadcastKey: string,
    payload: MatchLowerThirdEventPayload,
  ) {
    if (!broadcastKey || !this.io) return;
    this.io.to(this.room(broadcastKey)).emit('lower-third:match:show', payload);
  }

  emitMatchLowerThirdHide(broadcastKey: string, reason?: string | null) {
    if (!broadcastKey || !this.io) return;
    this.io
      .to(this.room(broadcastKey))
      .emit('lower-third:match:hide', { reason: reason ?? null });
  }

  private async joinRoom(client: SocketIOSocket, broadcastKey: string) {
    const exists = await this.prisma.organization.findFirst({
      where: { broadcastKey, deletedAt: null },
      select: { id: true },
    });
    if (!exists) {
      client.emit('broadcast:error', { message: 'invalid_broadcast_key' });
      return;
    }
    client.join(this.room(broadcastKey));
    client.emit('broadcast:joined', { ok: true });
    const socket = client as SocketIOSocket & { id?: string };
    this.logger.debug(
      `Client ${socket.id ?? 'unknown'} joined broadcast room for org key ${broadcastKey}`,
    );

    // Send a live-ranking snapshot once on join (non-spam)
    void this.emitLiveRankingSnapshot(broadcastKey);
    // Send live-state snapshot on join
    void this.pushLiveState(broadcastKey, { force: true });
    // Send live battle ranking snapshot if available
    const cachedBattle =
      this.liveBattleRanking.getCachedSnapshot(broadcastKey) ?? null;
    if (cachedBattle) {
      this.io
        .to(this.room(broadcastKey))
        .emit('live-battle-ranking:update', cachedBattle);
    } else {
      void this.pushLiveBattleRanking(broadcastKey, true);
    }
  }

  private extractBroadcastKey(client: SocketIOSocket): string | null {
    const socket = client as SocketIOSocket & {
      handshake?: { query?: Record<string, unknown> };
    };
    const queryKey = socket.handshake?.query?.broadcastKey;
    if (typeof queryKey === 'string' && queryKey.trim().length > 0) {
      return queryKey.trim();
    }
    return null;
  }

  private room(key: string): string {
    return `broadcast:${key}`;
  }

  private startTicker() {
    if (this.ticker) return;
    this.ticker = setInterval(() => {
      void this.tickRooms().catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`[WidgetBroadcastGateway] tick failed: ${msg}`);
      });
    }, this.tickIntervalMs);
  }

  private async tickRooms() {
    const adapter = (
      this.io as unknown as {
        sockets?: { adapter?: { rooms?: Map<string, Set<string>> } };
      }
    )?.sockets?.adapter;
    if (!adapter?.rooms) return;
    const keys = this.activeBroadcastKeys();
    await Promise.all(
      keys.map((key) =>
        Promise.all([this.pushLiveBattleRanking(key), this.pushLiveState(key)]),
      ),
    );
  }

  private activeBroadcastKeys(): string[] {
    const adapter = (
      this.io as unknown as {
        sockets?: { adapter?: { rooms?: Map<string, Set<string>> } };
      }
    )?.sockets?.adapter;
    if (!adapter?.rooms) return [];
    const entries = Array.from(adapter.rooms.entries());
    return entries
      .filter(
        ([roomId, clients]) =>
          roomId.startsWith('broadcast:') && (clients?.size ?? 0) > 0,
      )
      .map(([roomId]) => roomId.replace(/^broadcast:/, ''));
  }

  async emitLiveRankingForMatch(matchId: string) {
    const match = await this.prisma.match.findFirst({
      where: { id: matchId, deletedAt: null },
      select: {
        organizationId: true,
        organization: { select: { broadcastKey: true } },
      },
    });
    const broadcastKey =
      match?.organization?.broadcastKey ??
      (
        await this.prisma.organization.findFirst({
          where: { id: match?.organizationId ?? '' },
          select: { broadcastKey: true },
        })
      )?.broadcastKey ??
      null;
    if (!broadcastKey) return;
    await this.emitLiveRankingSnapshot(broadcastKey);
  }

  async emitLiveBattleRankingForMatch(matchId: string) {
    const match = await this.prisma.match.findFirst({
      where: { id: matchId, deletedAt: null },
      select: {
        organizationId: true,
        organization: { select: { broadcastKey: true } },
      },
    });
    const broadcastKey =
      match?.organization?.broadcastKey ??
      (
        await this.prisma.organization.findFirst({
          where: { id: match?.organizationId ?? '' },
          select: { broadcastKey: true },
        })
      )?.broadcastKey ??
      null;
    if (!broadcastKey) return;
    this.liveBattleRanking.invalidateMatch(matchId);
    await this.pushLiveBattleRanking(broadcastKey, true);
    await this.pushLiveState(broadcastKey, { force: true });
  }

  private async emitLiveRankingSnapshot(broadcastKey: string) {
    try {
      const payload = await this.fetchLiveRankingSnapshot(broadcastKey);
      if (!payload) return;
      this.io.to(this.room(broadcastKey)).emit('live-ranking:update', payload);
    } catch (err) {
      this.logger.warn(
        `[WidgetBroadcastGateway] live-ranking snapshot failed for key ${broadcastKey}: ${
          (err as Error)?.message ?? err
        }`,
      );
    }
  }

  private computeLiveStateSignature(payload: MatchLiveStatePayload): string {
    return JSON.stringify({
      matchId: payload.matchId ?? null,
      teams: (payload.teams ?? []).map((team) => ({
        teamId: team.teamId,
        slot: team.slot ?? null,
        players: (team.players ?? []).map((p) => ({
          id: p.playerId,
          a: p.isAlive,
          k: p.knocked,
          ks: p.kills,
        })),
      })),
    });
  }

  private async pushLiveState(
    broadcastKey: string,
    opts: { force?: boolean } = {},
  ): Promise<void> {
    if (!this.io) return;
    try {
      const organization = await this.prisma.organization.findFirst({
        where: { broadcastKey, deletedAt: null },
        select: { id: true },
      });
      if (!organization) return;

      const liveMatch = await this.canonicalRead.resolveLiveMatchForOrg(
        organization.id,
      );

      let payload: MatchLiveStatePayload = {
        matchId: null,
        tournamentId: null,
        groupId: null,
        teams: [],
      };

      if (liveMatch) {
        const state = await this.canonicalRead.getMatchState(liveMatch.id);
        payload = {
          matchId: state.matchId ?? liveMatch.id,
          tournamentId: liveMatch.tournamentId ?? state.tournamentId ?? null,
          groupId: liveMatch.groupId ?? state.groupId ?? null,
          teams: state.teams,
        };
      }

      const signature = this.computeLiveStateSignature(payload);
      const cache = this.liveStateCache.get(broadcastKey);
      const changed = opts.force || !cache || cache.signature !== signature;

      if (changed) {
        this.liveStateCache.set(broadcastKey, {
          signature,
          matchId: payload.matchId,
        });
        this.io.to(this.room(broadcastKey)).emit('live_state', payload);
      }

      const previousMatch = this.lastMatchByBroadcast.get(broadcastKey) ?? null;
      if (previousMatch !== payload.matchId) {
        this.lastMatchByBroadcast.set(broadcastKey, payload.matchId ?? null);
        this.logger.log(
          `[WidgetBroadcastGateway] live-state match=${payload.matchId ?? 'none'} key=${broadcastKey}`,
        );
      }
    } catch (err) {
      this.logErrorOnce(broadcastKey, err);
    }
  }

  private async pushLiveBattleRanking(
    broadcastKey: string,
    force = false,
  ): Promise<void> {
    if (!this.io) return;
    try {
      const { snapshot, changed } =
        await this.liveBattleRanking.computeSnapshot(broadcastKey, { force });
      if (!snapshot) return;

      const previousMatch = this.lastMatchByBroadcast.get(broadcastKey);
      if (previousMatch !== snapshot.matchId) {
        this.lastMatchByBroadcast.set(broadcastKey, snapshot.matchId ?? null);
        this.logger.log(
          `[WidgetBroadcastGateway] live-battle-ranking match=${snapshot.matchId ?? 'none'} key=${broadcastKey}`,
        );
      }

      if (changed || force || this.widgetDebug) {
        this.io
          .to(this.room(broadcastKey))
          .emit('live-battle-ranking:update', snapshot);
      }
    } catch (err) {
      this.logErrorOnce(broadcastKey, err);
    }
  }

  private logErrorOnce(broadcastKey: string, err: unknown) {
    const now = Date.now();
    const last = this.lastErrorTs.get(broadcastKey) ?? 0;
    if (!this.widgetDebug && now - last < this.errorThrottleMs) return;
    this.lastErrorTs.set(broadcastKey, now);
    this.logger.warn(
      `[WidgetBroadcastGateway] live-battle-ranking snapshot failed for key ${broadcastKey}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  private async fetchLiveRankingSnapshot(broadcastKey: string) {
    const organization = await this.prisma.organization.findFirst({
      where: { broadcastKey, deletedAt: null },
      select: { id: true },
    });
    if (!organization) return null;

    const liveMatch = await this.prisma.match.findFirst({
      where: {
        organizationId: organization.id,
        deletedAt: null,
        status: MatchStatus.LIVE,
      },
      orderBy: [
        { liveAt: 'desc' },
        { startedAt: 'desc' },
        { updatedAt: 'desc' },
      ],
      select: { id: true, updatedAt: true },
    });

    if (!liveMatch) return null;

    const snapshot = await buildWidgetScoreboardSnapshot(
      this.prisma,
      liveMatch.id,
      { includeLogos: true, brandMode: 'dark' },
    );

    const canonicalLiveState = await this.canonicalRead
      .getMatchState(liveMatch.id)
      .catch(() => null);
    const aliveLookup = (canonicalLiveState?.teams ?? []).reduce(
      (acc, team) => {
        if (team.teamId) {
          acc[team.teamId] = Math.max(0, team.alivePlayers ?? 0);
        }
        return acc;
      },
      {} as Record<string, number>,
    );

    const fromSnapshot =
      (snapshot.rows ?? [])
        .filter((row: WidgetTeamSlotRow) => row.wasPresentInMatch === true)
        .map((row: WidgetTeamSlotRow) => {
          const teamId = row.teamId ?? `slot-${row.slot}`;
          const kills = Number(row.totalKills ?? 0);
          const placementPoints = Number(row.placementPoints ?? 0);
          const basePoints = Number.isFinite(placementPoints)
            ? placementPoints
            : 0;
          const matchPoints =
            Number.isFinite(row.totalPoints ?? NaN) && row.totalPoints !== null
              ? Number(row.totalPoints)
              : basePoints + kills;
          const aliveCount = aliveLookup[teamId];

          return {
            teamId,
            teamName: row.teamName ?? row.teamTag ?? DEFAULT_WIDGET_TEAM_NAME,
            teamTag: row.teamTag ?? DEFAULT_WIDGET_TEAM_TAG,
            teamLogo: row.teamLogoUrl ?? TEAM_LOGO_PLACEHOLDER,
            placement: row.placement ?? null,
            kills,
            placementPoints,
            matchPoints,
            alive: aliveCount === undefined ? false : aliveCount > 0,
          };
        }) ?? [];

    let teams = fromSnapshot;

    const slotResults = await this.prisma.matchSlotResult.findMany({
      where: { matchId: liveMatch.id, wasPresentInMatch: true },
      include: {
        team: { select: { id: true, name: true, tag: true, logoUrl: true } },
      },
      orderBy: [
        { placement: 'asc' },
        { totalPoints: 'desc' },
        { totalKills: 'desc' },
      ],
    });

    if (!teams.length && slotResults.length) {
      teams = slotResults.map((sr, idx) => {
        const teamId = sr.teamId ?? `slot-${sr.slotNumber ?? idx + 1}`;
        const branding = resolveTeamBranding(teamId, [
          { teamId: sr.teamId, team: sr.team ?? null, slot: sr.slotNumber },
        ]);
        const kills = Number(sr.totalKills ?? 0);
        const placementPoints = Number(sr.placementPoints ?? 0);
        const matchPoints =
          Number.isFinite(sr.totalPoints ?? NaN) && sr.totalPoints !== null
            ? Number(sr.totalPoints)
            : placementPoints + kills;
        const aliveCount = aliveLookup[teamId];
        return {
          teamId,
          teamName: sr.team?.name ?? sr.team?.tag ?? branding.name,
          teamTag: sr.team?.tag ?? branding.tag,
          teamLogo:
            sr.team?.logoUrl ?? branding.logoUrl ?? TEAM_LOGO_PLACEHOLDER,
          placement: sr.placement ?? null,
          kills,
          placementPoints,
          matchPoints,
          alive: aliveCount === undefined ? false : aliveCount > 0,
        };
      });
    }

    if (!teams.length) {
      this.logger.debug(
        `[WidgetBroadcastGateway] live-ranking has no teams for match ${liveMatch.id}. snapshotRows=${snapshot.rows?.length ?? 0} slotResults=${slotResults.length}`,
      );
    }

    const updatedAt =
      snapshot.state.lastUpdateIso ??
      liveMatch.updatedAt?.toISOString?.() ??
      new Date().toISOString();

    return { matchId: liveMatch.id, updatedAt, teams };
  }
}
