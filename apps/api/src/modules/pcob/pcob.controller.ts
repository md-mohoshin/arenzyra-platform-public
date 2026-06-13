import {
  BadRequestException,
  ConflictException,
  Body,
  Controller,
  Inject,
  Logger,
  Post,
  Req,
  ForbiddenException,
  UseGuards,
  Delete,
  forwardRef,
} from '@nestjs/common';
import {
  MatchDataSource,
  MatchEventType,
  MatchStatus,
  Prisma,
} from '@prisma/client';
import type { AuthRequest } from '../../common/auth/auth.types';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { Public } from '../../common/auth/public.decorator';
import { PcobService } from './pcob.service';
import { Get } from '@nestjs/common';
import { Param } from '@nestjs/common';
import { Query } from '@nestjs/common';
import { PrismaService } from '../../db/prisma.service';
import { ScoringService } from '../scoring/scoring.service';
import { PcobGateway } from './pcob.gateway';
import { MapStateService } from '../maps/map-state.service';
import * as crypto from 'crypto';
import { PcobEventsService } from './pcob-events.service';
import { PcobActiveService } from './pcob-active.service';
import { PcobDedupeService } from './pcob-dedupe.service';
import { PcobDedupeStore } from './pcob-dedupe.store';
import { PcobFocusService } from './pcob-focus.service';
import { PcobHealthService } from './pcob-health.service';
import { PcobTelemetryPayload } from './pcob.types';
import { Roles } from '../../common/auth/roles.decorator';
import { Role } from '@prisma/client';
import { FeedBusService } from '../feed/feed-bus.service';
import { ScaleService } from './scale.service';
import { effectiveOrganizationId } from '../../common/org/org.util';
import { PcobSecretGuard } from './pcob-secret.guard';
import { GameAdapterTelemetryService } from '../game-adapters/game-adapter-telemetry.service';
import { PCOB_ADAPTER_KEY } from '../../common/pcob-binding.util';
import { deriveControlStateFromMatchStatus } from '../../common/match-status.util';
import { writeTelemetryRuntimeMeta } from '../../common/telemetry-runtime-contract.util';
import { CanonicalControlReadService } from '../realtime/canonical-control-read.service';
import { enforceTelemetrySourceAllowed } from '../../common/telemetry-source.util';
import {
  isPcobCompatibilityMatch,
  resolvePcobCompatibilityMode,
} from '../../common/match-telemetry-provider.util';

type SyncPayload = { matchId?: string };
type PcobBindPayload = { matchId?: string; pcobSessionId?: string };
type PcobFeedStartPayload = { matchId?: string };

type TelemetryEnvelope = {
  payload?: unknown;
  eventType?: string;
  sessionId?: string;
  matchSessionId?: string;
  matchId?: string;
  match_id?: string;
  clientId?: string;
  client_id?: string;
  sentAt?: string | number | Date | null;
  sent_at?: string | number | Date | null;
  [key: string]: unknown;
};

const isRecord = (val: unknown): val is Record<string, unknown> =>
  !!val && typeof val === 'object';
const stringFromUnknown = (value: unknown): string | undefined =>
  typeof value === 'string'
    ? value
    : typeof value === 'number'
      ? String(value)
      : undefined;
const firstHeaderValue = (
  value: string | string[] | undefined,
): string | null =>
  Array.isArray(value)
    ? (value.find((entry) => Boolean(entry?.trim()))?.trim() ?? null)
    : typeof value === 'string' && value.trim().length > 0
      ? value.trim()
      : null;

type KillMatch = Prisma.MatchGetPayload<{
  select: {
    id: true;
    status: true;
    pcobMode: true;
    pcobKillSyncEnabled: true;
    tournament: { select: { organizationId: true } };
  };
}>;

// In-memory telemetry counters per match (log-only, non-persistent)
const telemetryCount = new Map<string, number>();

const telemetryMatchSelect = {
  id: true,
  organizationId: true,
  deletedAt: true,
  status: true,
  liveState: true,
  telemetrySource: true,
  telemetrySourceLockedAt: true,
  pcobSessionId: true,
  adapterKey: true,
  pcobMode: true,
  pcobKillSyncEnabled: true,
  dataMode: true,
  dataSource: true,
  pcobBoundAt: true,
  controlState: {
    select: { state: true, metaJson: true, organizationId: true },
  },
  tournament: { select: { organizationId: true } },
} satisfies Prisma.MatchSelect;

type TelemetryIngestMatch = Prisma.MatchGetPayload<{
  select: typeof telemetryMatchSelect;
}>;

@Controller('pcob')
@UseGuards(JwtAuthGuard)
export class PcobController {
  private readonly logger = new Logger('PcobController');
  private readonly legacyAuthorityDisabled = true;

  constructor(
    private pcob: PcobService,
    private gateway: PcobGateway,
    private prisma: PrismaService,
    private active: PcobActiveService,
    private dedupe: PcobDedupeService,
    private dedupeStore: PcobDedupeStore,
    private focusSvc: PcobFocusService,
    private healthSvc: PcobHealthService,
    private feedBus: FeedBusService,
    private scale: ScaleService,
    @Inject(forwardRef(() => CanonicalControlReadService))
    private readonly canonicalRead: CanonicalControlReadService,
  ) {}

  private getClientId(req: AuthRequest) {
    const clientHeader = req.headers['x-client-id'];
    if (Array.isArray(clientHeader)) return clientHeader[0];
    return clientHeader || req.user?.id || 'unknown-client';
  }

  private requireOrgId(req: AuthRequest): string {
    const orgId = effectiveOrganizationId(req.user);
    if (!orgId) {
      throw new BadRequestException('organizationId is required for PCOB');
    }
    return orgId;
  }

  @Post('feed/start')
  start(@Req() req: AuthRequest, @Body() body: PcobFeedStartPayload) {
    const clientId = this.getClientId(req);
    const orgId = this.requireOrgId(req);
    const matchId = body?.matchId;
    if (!matchId) {
      throw new BadRequestException('matchId is required');
    }
    return this.pcob.startFeed(orgId, matchId, clientId);
  }

  @Post('bind')
  bind(@Req() req: AuthRequest, @Body() body: PcobBindPayload) {
    const clientId = this.getClientId(req);
    const orgId = this.requireOrgId(req);
    const matchId = body?.matchId;
    const sessionId = body?.pcobSessionId;
    if (!matchId) throw new BadRequestException('matchId is required');
    if (!sessionId) throw new BadRequestException('pcobSessionId is required');
    return this.pcob.bind(orgId, matchId, clientId, sessionId);
  }

  @Post('feed/stop')
  stop(@Req() req: AuthRequest) {
    const clientId = this.getClientId(req);
    return this.pcob.stopFeed(clientId);
  }

  @Post('sync/players')
  syncPlayers(@Req() req: AuthRequest, @Body() body: SyncPayload) {
    const orgId = this.requireOrgId(req);
    const matchId = body?.matchId;
    if (!matchId) {
      throw new BadRequestException('matchId is required');
    }
    return this.pcob.syncPlayers(orgId, matchId, body);
  }

  @Post('sync/teams')
  syncTeams(@Req() req: AuthRequest, @Body() body: SyncPayload) {
    const orgId = this.requireOrgId(req);
    const matchId = body?.matchId;
    if (!matchId) {
      throw new BadRequestException('matchId is required');
    }
    return this.pcob.syncTeams(orgId, matchId, body);
  }

  @Get('telemetry/:matchId')
  latest(@Req() req: AuthRequest, @Param('matchId') matchId: string) {
    const orgId = this.requireOrgId(req);
    return this.pcob.latest(orgId, matchId, telemetryCount.get(matchId) ?? 0);
  }

  @Get('active-match')
  async activeMatch(@Req() req: AuthRequest) {
    return this.active.getActiveMatch(req.user);
  }

  @Get('state/:matchId')
  async stateForMatch(
    @Req() req: AuthRequest,
    @Param('matchId') matchId: string,
    @Query('force') force?: string,
  ) {
    const orgId = effectiveOrganizationId(req.user);
    const match = await this.prisma.match.findFirst({
      where: {
        id: matchId,
        tournament: { organizationId: orgId ?? undefined },
        deletedAt: null,
      },
      select: { id: true },
    });
    if (!match) throw new BadRequestException('Match not found');
    void force;
    const data = await this.canonicalRead.getPcobMirror(matchId);
    return { matchId, ...data };
  }

  @Post('ws-test')
  wsTest(@Body('message') message: string) {
    this.gateway.broadcastTest(message || 'ping');
    return { ok: true };
  }

  @Get('ws-info')
  wsInfo(@Req() req: AuthRequest) {
    const configuredBase =
      process.env.API_PUBLIC_URL ?? process.env.API_BASE_URL ?? null;
    let socketIoUrl = 'http://localhost:3000';
    let websocketUrl = 'ws://localhost:3000';

    try {
      if (configuredBase) {
        const publicUrl = new URL(configuredBase);
        socketIoUrl = publicUrl.origin;
        websocketUrl = `${publicUrl.protocol === 'https:' ? 'wss:' : 'ws:'}//${publicUrl.host}`;
      } else {
        const forwardedProto =
          firstHeaderValue(req.headers['x-forwarded-proto']) ??
          (req.protocol === 'https' ? 'https' : 'http');
        const forwardedHost =
          firstHeaderValue(req.headers['x-forwarded-host']) ??
          firstHeaderValue(req.headers.host) ??
          'localhost:3000';
        socketIoUrl = `${forwardedProto}://${forwardedHost}`;
        websocketUrl = `${forwardedProto === 'https' ? 'wss' : 'ws'}://${forwardedHost}`;
      }
    } catch {
      // Fall back to localhost-shaped URLs when configured values are invalid.
    }

    return {
      websocketUrl,
      socketIoUrl,
      socketIoPath: '/pcob/socket.io',
      socketIoRooms: {
        joinEvent: 'join-match',
        leaveEvent: 'leave-match',
        roomFormat: 'match:{matchId}',
      },
      events: ['telemetry', 'telemetry:all', 'test'],
    };
  }

  @Get('health')
  async health(@Req() req: AuthRequest, @Query('matchId') matchId?: string) {
    const orgId = req.user?.organizationId;
    const targetMatch =
      matchId ??
      (await this.prisma.match
        .findFirst({
          where: {
            status: MatchStatus.LIVE,
            tournament: { organizationId: orgId ?? undefined },
          },
          select: { id: true },
        })
        .then((m) => m?.id));
    const redisStatus = await this.dedupeStore.health();
    const dedupeMode = redisStatus.redis === 'up' ? 'redis' : 'memory';
    const feed = targetMatch
      ? this.healthSvc.get(targetMatch)
      : { status: 'down' };
    return {
      redis: redisStatus.redis,
      dedupeMode,
      matchId: targetMatch ?? null,
      feed,
      metrics: {
        telemetryEventsProcessed: this.dedupe.telemetryEventsProcessed,
        telemetryEventsDeduped: this.dedupe.telemetryEventsDeduped,
      },
    };
  }
}

@Controller('matches')
@UseGuards(JwtAuthGuard)
export class PcobFocusController {
  constructor(private readonly focus: PcobFocusService) {}

  private requireOrgId(req: AuthRequest): string {
    const orgId = req.user?.organizationId ?? req.user?.actingOrgId;
    if (!orgId) {
      throw new BadRequestException('organizationId is required for focus');
    }
    return orgId;
  }

  @Post(':matchId/focus-player')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN, Role.ORGANIZER)
  async setFocus(
    @Req() req: AuthRequest,
    @Param('matchId') matchId: string,
    @Body('playerId') playerId: string,
  ) {
    const orgId = this.requireOrgId(req);
    const role = req.user?.role ?? Role.ORGANIZER;
    return this.focus.setFocus(orgId, role, matchId, playerId);
  }

  @Delete(':matchId/focus-player')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN, Role.ORGANIZER)
  async clearFocus(@Req() req: AuthRequest, @Param('matchId') matchId: string) {
    const orgId = this.requireOrgId(req);
    const role = req.user?.role ?? Role.ORGANIZER;
    return this.focus.clearFocus(orgId, role, matchId);
  }
}
@Controller('pcob/telemetry')
@Public()
@UseGuards(PcobSecretGuard)
export class PcobTelemetryIngestController {
  private readonly maxBytes = 1_000_000; // ~1MB
  private readonly logger = new Logger('PcobTelemetry');
  private readonly legacyAuthorityDisabled = true;

  constructor(
    private prisma: PrismaService,
    private scoring: ScoringService,
    private gateway: PcobGateway,
    private mapState: MapStateService,
    private events: PcobEventsService,
    private dedupe: PcobDedupeService,
    private dedupeStore: PcobDedupeStore,
    private health: PcobHealthService,
    private feedBus: FeedBusService,
    private scale: ScaleService,
    private adapterTelemetry: GameAdapterTelemetryService,
  ) {}

  private logReject(reason: string, details: Record<string, unknown>): void {
    this.logger.warn(
      JSON.stringify({
        stage: 'pcob-telemetry-ingest',
        action: 'payload-rejected',
        reason,
        rejectionReason: reason,
        ...details,
      }),
    );
  }

  private buildMatchComparison(
    match: TelemetryIngestMatch | null,
    incomingMatchId: string | null,
    incomingSessionId: string | null,
  ) {
    return {
      incomingMatchId,
      incomingSessionId,
      expectedMatchId: match?.id ?? null,
      expectedSessionId: match?.pcobSessionId ?? null,
      adapterKey: match?.adapterKey ?? null,
      matchStatus: match?.status ?? null,
      controlStateStatus: match?.controlState?.state ?? null,
    };
  }

  private logMatchComparison(details: Record<string, unknown>) {
    this.logger.debug(
      JSON.stringify({
        stage: 'pcob-telemetry-ingest',
        action: 'match-identity-compared',
        rejectionReason: null,
        ...details,
      }),
    );
  }

  private async touchTelemetryTransport(
    match: Pick<
      TelemetryIngestMatch,
      'id' | 'organizationId' | 'status' | 'controlState' | 'tournament'
    >,
    source: string | null,
    receivedAt: Date,
  ) {
    const currentState =
      match.controlState?.state ??
      deriveControlStateFromMatchStatus(match.status);
    const organizationId =
      match.organizationId ??
      match.controlState?.organizationId ??
      match.tournament?.organizationId ??
      null;
    if (!organizationId || !this.prisma.matchControlState?.upsert) {
      return;
    }

    const currentMeta =
      (await this.prisma.matchControlState?.findUnique?.({
        where: { matchId: match.id },
        select: { metaJson: true, state: true, organizationId: true },
      })) ?? match.controlState;
    const nextMeta = writeTelemetryRuntimeMeta(currentMeta?.metaJson ?? null, {
      lastTransportAt: receivedAt.toISOString(),
      lastPacketAt: receivedAt.toISOString(),
      lastTransportSource: source ?? null,
    });

    await this.prisma.matchControlState.upsert({
      where: { matchId: match.id },
      update: {
        metaJson: nextMeta as Prisma.JsonObject,
      },
      create: {
        matchId: match.id,
        organizationId: currentMeta?.organizationId ?? organizationId,
        state: (currentMeta?.state ?? currentState) as never,
        reason: 'TELEMETRY_RUNTIME_TRANSPORT',
        metaJson: nextMeta as Prisma.JsonObject,
      },
    });
  }

  private isZoneEvent(payload: unknown) {
    if (!payload) return false;
    const payloadRecord = isRecord(payload) ? payload : {};
    const type = (
      stringFromUnknown(payloadRecord.eventType) ?? ''
    ).toUpperCase();
    return (
      type === 'ZONE' ||
      type === 'ZONE_UPDATE' ||
      type === 'BLUEZONE' ||
      type === 'ZONEUPDATE'
    );
  }

  private extractZone(payload: unknown) {
    const source = isRecord(payload) ? payload : {};
    const zone = isRecord(source.zone) ? source.zone : source;
    const center = isRecord(zone.center)
      ? zone.center
      : isRecord(zone.zoneCenter)
        ? zone.zoneCenter
        : null;
    const radius = zone?.radius ?? zone?.zoneRadius ?? null;
    const phaseIndex = zone?.phase ?? zone?.phaseIndex ?? null;
    const nextShrinkRaw =
      zone?.nextShrinkTime ?? zone?.nextShrink ?? zone?.next ?? null;
    const nextShrinkTime =
      typeof nextShrinkRaw === 'string' ||
      typeof nextShrinkRaw === 'number' ||
      nextShrinkRaw instanceof Date
        ? nextShrinkRaw
        : null;
    return {
      zoneCenter: center
        ? {
            x: Number(center?.x ?? center?.X ?? center?.lon ?? 0),
            y: Number(center?.y ?? center?.Y ?? center?.lat ?? 0),
          }
        : null,
      zoneRadius:
        radius !== undefined && radius !== null ? Number(radius) : null,
      zonePhaseIndex:
        phaseIndex !== undefined && phaseIndex !== null
          ? Number(phaseIndex)
          : null,
      zoneNextShrinkAt: nextShrinkTime ? new Date(nextShrinkTime) : null,
    };
  }

  private normalizeEvents(body: unknown): Array<{
    eventType: unknown;
    timestamp: unknown;
    payload: Record<string, unknown>;
  }> {
    const payload = isRecord(body) ? body : {};
    return [
      {
        eventType: payload?.eventType ?? 'UNKNOWN',
        timestamp:
          payload?.timestamp ??
          payload?.ts ??
          payload?.time ??
          payload?.eventTime ??
          Date.now(),
        payload,
      },
    ];
  }

  private killerFromPayload(payload: unknown) {
    const killer =
      isRecord(payload) && isRecord(payload.killer) ? payload.killer : {};
    const pubgAccountIdRaw =
      killer?.pubgAccountId ?? killer?.pubgPlayerId ?? null;
    const ignRaw = killer?.ign ?? null;
    const pubgAccountId =
      typeof pubgAccountIdRaw === 'string' ? pubgAccountIdRaw : null;
    const ign = typeof ignRaw === 'string' ? ignRaw : null;
    return { pubgAccountId, ign };
  }

  private victimFromPayload(payload: unknown) {
    const victim =
      isRecord(payload) && isRecord(payload.victim) ? payload.victim : {};
    const pubgAccountId = victim?.pubgAccountId ?? victim?.pubgPlayerId ?? null;
    const ign = victim?.ign ?? null;
    if (typeof pubgAccountId === 'string') return pubgAccountId;
    if (typeof ign === 'string') return ign;
    return '';
  }

  private buildEventHash(sessionId: string, payload: unknown) {
    const payloadRecord = isRecord(payload) ? payload : {};
    const timestampRaw =
      payloadRecord.timestamp ??
      payloadRecord.ts ??
      payloadRecord.time ??
      payloadRecord.eventTime ??
      Date.now();
    const timestamp =
      typeof timestampRaw === 'string' || typeof timestampRaw === 'number'
        ? String(timestampRaw)
        : String(Date.now());
    const { pubgAccountId, ign } = this.killerFromPayload(payload);
    const victimId = this.victimFromPayload(payload);
    const key = `${sessionId}|${timestamp}|${pubgAccountId || ign || 'unknown-killer'}|${victimId || 'unknown-victim'}`;
    return crypto.createHash('sha256').update(key).digest('hex');
  }

  private async recordUnmatchedKill(
    matchId: string,
    sessionId: string,
    payload: Prisma.InputJsonValue,
  ) {
    const { pubgAccountId, ign } = this.killerFromPayload(payload);
    await this.prisma.pcobUnmatchedKill.create({
      data: {
        matchId,
        sessionId,
        pubgAccountId: pubgAccountId ?? null,
        ign: ign ?? null,
        rawPayload: payload ?? {},
      },
    });
  }

  private async applyKillEvent(
    match: KillMatch,
    sessionId: string,
    payload: Prisma.InputJsonValue,
  ) {
    if (this.legacyAuthorityDisabled) {
      void match;
      void sessionId;
      void payload;
      return;
    }
    const payloadObj: Prisma.InputJsonObject = isRecord(payload)
      ? (payload as Prisma.InputJsonObject)
      : {};
    if (payloadObj?.eventType !== 'KILL') return;
    if (
      !match.pcobMode ||
      !match.pcobKillSyncEnabled ||
      match.status !== MatchStatus.LIVE
    )
      return;

    const eventHash = this.buildEventHash(sessionId, payloadObj);
    const orgId = match?.tournament?.organizationId;
    if (!orgId) return;

    const killerIds = this.killerFromPayload(payloadObj);
    if (!killerIds.pubgAccountId && !killerIds.ign) {
      await this.recordUnmatchedKill(match.id, sessionId, payloadObj);
      return;
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.pcobAppliedEvent.findUnique({
        where: { eventHash },
      });
      if (existing) return 'duplicate';

      const player = await tx.player.findFirst({
        where: {
          organizationId: orgId,
          deletedAt: null,
          OR: [
            ...(killerIds.pubgAccountId
              ? [{ pubgPlayerId: killerIds.pubgAccountId }]
              : []),
            ...(killerIds.ign ? [{ ign: killerIds.ign }] : []),
          ],
        },
      });

      if (!player || !player.teamId) {
        await tx.pcobUnmatchedKill.create({
          data: {
            matchId: match.id,
            sessionId,
            pubgAccountId: killerIds.pubgAccountId ?? null,
            ign: killerIds.ign ?? null,
            rawPayload: payloadObj ?? {},
          },
        });
        return 'unmatched';
      }

      const assigned = await tx.matchSlot.findFirst({
        where: { matchId: match.id, teamId: player.teamId },
      });
      if (!assigned) {
        await tx.pcobUnmatchedKill.create({
          data: {
            matchId: match.id,
            sessionId,
            pubgAccountId: killerIds.pubgAccountId ?? null,
            ign: killerIds.ign ?? null,
            rawPayload: payloadObj ?? {},
          },
        });
        return 'unmatched';
      }

      const lastSeq = await tx.matchEvent.findFirst({
        where: { matchId: match.id },
        select: { seq: true },
        orderBy: { seq: 'desc' },
      });
      const nextSeq = (lastSeq?.seq ?? 0) + 1;

      await tx.matchEvent.create({
        data: {
          eventId: `pcob-kill-${eventHash.slice(0, 12)}`,
          matchId: match.id,
          teamId: player.teamId,
          type: MatchEventType.KILL,
          seq: nextSeq,
          timestamp: new Date(),
          payload: {
            source: 'PCOB',
            sessionId,
            killerPlayerId: player.id,
            killerIgn: player.ign,
            killerPubgId: killerIds.pubgAccountId ?? null,
            victim: this.victimFromPayload(payload) || null,
          },
          rawPayload: payload ?? {},
          organizationId: orgId,
        },
      });

      await tx.pcobAppliedEvent.create({
        data: {
          matchId: match.id,
          eventHash,
          eventType: 'KILL',
        },
      });

      return { result: 'applied', teamId: player.teamId, playerId: player.id };
    });

    if (typeof result === 'object' && result.result === 'applied') {
      await this.scoring.recomputeMatchAndTournament(match.id);
      this.gateway.emitKill(match.id, {
        source: 'PCOB',
        teamId: result.teamId,
        playerId: result.playerId,
        delta: 1,
      });
    }
  }

  @Post()
  async ingest(@Body() body: TelemetryEnvelope) {
    let payloadString = '';
    try {
      payloadString = JSON.stringify(body) ?? '';
    } catch {
      payloadString = '[unserializable payload]';
    }

    if (payloadString.length > this.maxBytes) {
      throw new BadRequestException('Payload too large');
    }

    const timestamp = new Date().toISOString();
    const telemetryPayload = isRecord(body.payload)
      ? body.payload
      : isRecord(body)
        ? body
        : {};
    const eventTypeRaw = telemetryPayload?.eventType ?? body?.eventType;
    const eventType = stringFromUnknown(eventTypeRaw) ?? 'UNKNOWN';
    const sessionId =
      (typeof body?.sessionId === 'string' && body.sessionId) ||
      (typeof body?.matchSessionId === 'string' && body.matchSessionId) ||
      'UNKNOWN';
    const clientId =
      (typeof body?.clientId === 'string' && body.clientId) ||
      (typeof body?.client_id === 'string' && body.client_id) ||
      null;
    const matchIdFromWrapper =
      (typeof body?.matchId === 'string' && body.matchId) ||
      (typeof body?.match_id === 'string' && body.match_id) ||
      null;
    const sentAt = body?.sentAt ?? body?.sent_at ?? null;
    const truncated =
      payloadString.length > 5000
        ? `${payloadString.slice(0, 5000)}... [truncated]`
        : payloadString;

    if (!sessionId || sessionId === 'UNKNOWN') {
      this.logReject('MISSING_SESSION_ID', {
        ...this.buildMatchComparison(null, matchIdFromWrapper, null),
        clientId,
        eventType,
      });
      throw new BadRequestException('Missing sessionId');
    }

    const match = await this.prisma.match.findFirst({
      where: {
        id: matchIdFromWrapper ?? undefined,
        pcobSessionId: sessionId,
        deletedAt: null,
      },
      select: telemetryMatchSelect,
    });

    const comparisonMatch =
      match ??
      (matchIdFromWrapper
        ? await this.prisma.match.findUnique({
            where: { id: matchIdFromWrapper },
            select: telemetryMatchSelect,
          })
        : null);

    if (!match || match.pcobSessionId !== sessionId) {
      this.logReject('MATCH_SESSION_MISMATCH', {
        ...this.buildMatchComparison(
          comparisonMatch,
          matchIdFromWrapper,
          sessionId,
        ),
        eventType,
      });
      throw new ConflictException('Session mismatch');
    }
    this.logMatchComparison(
      this.buildMatchComparison(match, matchIdFromWrapper, sessionId),
    );
    const compatibilityMode = resolvePcobCompatibilityMode(match);
    const isPcobModeCandidate =
      isPcobCompatibilityMatch(match) ||
      match.dataSource === MatchDataSource.API;
    if (!isPcobModeCandidate) {
      this.logReject('MATCH_NOT_PCOB_MODE', {
        ...this.buildMatchComparison(match, matchIdFromWrapper, sessionId),
        eventType,
        dataSource: match.dataSource ?? null,
        dataMode: match.dataMode ?? null,
        compatibilityMode,
      });
      throw new ConflictException('Match is not in PCOB mode');
    }
    const useAdapterIngest =
      this.legacyAuthorityDisabled || match.adapterKey === PCOB_ADAPTER_KEY;
    if (useAdapterIngest && match.adapterKey !== PCOB_ADAPTER_KEY) {
      this.logReject('MATCH_NOT_ADAPTER_BOUND', {
        ...this.buildMatchComparison(match, matchIdFromWrapper, sessionId),
        eventType,
        expectedAdapterKey: PCOB_ADAPTER_KEY,
        receivedAdapterKey: match.adapterKey ?? null,
      });
      throw new ConflictException(
        `Match is not adapter-bound to ${PCOB_ADAPTER_KEY}`,
      );
    }
    if (useAdapterIngest) {
      const now = new Date();
      const incomingSource = compatibilityMode === 'API' ? 'API' : 'PCOB';
      const authoritySource =
        compatibilityMode === 'API'
          ? 'API_AUTHORITATIVE'
          : 'PCOB_AUTHORITATIVE';
      const { match: sourceLockedMatch } = await enforceTelemetrySourceAllowed({
        prisma: this.prisma,
        logger: this.logger,
        match,
        incomingSource,
      });
      await this.touchTelemetryTransport(
        sourceLockedMatch,
        incomingSource,
        now,
      );
      this.health.onTelemetryWithContext(match.id, clientId, {
        sentAt:
          typeof sentAt === 'number'
            ? sentAt
            : sentAt instanceof Date
              ? sentAt.getTime()
              : typeof sentAt === 'string'
                ? sentAt
                : null,
        status: match.status,
        dataSource: match.dataSource,
        adapterKey: match.adapterKey ?? null,
        gameplay: true,
        authoritative: true,
        authoritySource,
        scoringMode: 'AUTO_LOCKED',
      });
      return this.adapterTelemetry.ingestEnvelope(match.id, body);
    }
    if (match.status !== MatchStatus.LIVE) {
      this.logReject('MATCH_NOT_LIVE', {
        ...this.buildMatchComparison(match, matchIdFromWrapper, sessionId),
        eventType,
      });
      throw new ConflictException('Match is not live');
    }
    if (!clientId) {
      this.logReject('MISSING_CLIENT_ID', {
        ...this.buildMatchComparison(match, matchIdFromWrapper, sessionId),
        eventType,
      });
      throw new BadRequestException('Missing clientId');
    }

    const lock = await this.prisma.feedLock.findUnique({
      where: { id: 'singleton' },
    });
    if (lock) {
      if (lock.matchId !== match.id) {
        this.logReject('FEED_LOCK_MATCH_MISMATCH', {
          ...this.buildMatchComparison(match, matchIdFromWrapper, sessionId),
          clientId,
          lockMatchId: lock.matchId,
        });
        throw new ConflictException('Feed lock mismatch for this match');
      }
      if (lock.clientId !== clientId) {
        this.logReject('FEED_LOCK_CLIENT_MISMATCH', {
          ...this.buildMatchComparison(match, matchIdFromWrapper, sessionId),
          clientId,
          lockClientId: lock.clientId,
        });
        throw new ForbiddenException('Client mismatch');
      }
    } else if (!match.pcobBoundAt) {
      this.logReject('MATCH_NOT_BOUND', {
        ...this.buildMatchComparison(match, matchIdFromWrapper, sessionId),
        clientId,
      });
      throw new ConflictException('Match is not bound');
    }

    await enforceTelemetrySourceAllowed({
      prisma: this.prisma,
      logger: this.logger,
      match,
      incomingSource: compatibilityMode === 'API' ? 'API' : 'PCOB',
    });

    const now = new Date();
    const [evt] = this.normalizeEvents(telemetryPayload);
    const normalizedType = (eventType ?? 'UNKNOWN').toUpperCase();
    const authoritative = [
      'PLAYER_ELIMINATED',
      'TEAM_ELIMINATED',
      'MATCH_STATE_UPDATE',
    ].includes(normalizedType);
    const authoritySource =
      authoritative && compatibilityMode === 'API'
        ? 'API_AUTHORITATIVE'
        : authoritative
          ? 'PCOB_AUTHORITATIVE'
          : undefined;
    const gameplay =
      normalizedType !== 'UNKNOWN' ||
      this.isZoneEvent(telemetryPayload) ||
      evt?.eventType === 'KILL';
    this.health.onTelemetryWithContext(match.id, lock?.clientId ?? null, {
      sentAt:
        typeof sentAt === 'number'
          ? sentAt
          : sentAt instanceof Date
            ? sentAt.getTime()
            : typeof sentAt === 'string'
              ? sentAt
              : null,
      status: match.status,
      dataSource: match.dataSource,
      adapterKey: match.adapterKey ?? null,
      gameplay,
      authoritative,
      authoritySource,
      scoringMode: authoritative ? 'AUTO_LOCKED' : undefined,
    });
    const eventId = this.dedupe.computeEventId(match.id, sessionId, evt);
    let isDuplicate = false;
    if (eventId) {
      const dedupeResult = await this.dedupeStore.trySet(
        match.id,
        sessionId,
        eventId,
      );
      if (dedupeResult === 'duplicate') {
        this.dedupe.telemetryEventsDeduped += 1;
        this.logger.debug(
          `Deduped (redis) match=${match.id} session=${sessionId} id=${eventId}`,
        );
        return { ok: true };
      }
      if (dedupeResult === 'redis') {
        this.dedupe.telemetryEventsProcessed += 1;
      } else {
        isDuplicate = this.dedupe.checkAndRemember(
          match.id,
          sessionId,
          eventId,
        );
      }
    }

    const eventTimestamp =
      typeof evt?.timestamp === 'number' || typeof evt?.timestamp === 'string'
        ? evt.timestamp
        : Date.now();
    await this.prisma.pcobRawEvent.create({
      data: {
        matchId: match.id,
        sessionId,
        eventType,
        timestamp: new Date(eventTimestamp),
        payload:
          (evt?.payload as Prisma.InputJsonValue | null | undefined) ??
          Prisma.JsonNull,
        rawPayload:
          (evt as unknown as Prisma.InputJsonValue) ?? Prisma.JsonNull,
        receivedAt: now,
      },
    });

    if (isDuplicate) {
      return { ok: true };
    }

    telemetryCount.set(match.id, (telemetryCount.get(match.id) ?? 0) + 1);
    await this.prisma.match.update({
      where: { id: match.id },
      data: { pcobLastSeenAt: now },
    });
    console.log(`[PCOB] heartbeat for match ${match.id}`);

    const health = this.health.get(match.id);
    const telemetryWithMeta = {
      ...telemetryPayload,
      matchId: match.id,
      serverTime: now.getTime(),
      telemetryPhase: health?.phase,
      lastHeartbeatAt: health?.lastTelemetryAt ?? now.getTime(),
      feedState: health?.feedState,
      rawEventCount: health?.rawEventCount ?? telemetryCount.get(match.id) ?? 0,
    };
    // Scale filter (accept if disabled or passes)
    const accept = this.scale.filter(match.id, telemetryWithMeta);
    if (accept) {
      const telemetryTypeRaw = telemetryPayload?.type;
      const telemetryTsRaw = telemetryPayload?.ts;
      const telemetryEvent: PcobTelemetryPayload = {
        type:
          telemetryTypeRaw === undefined
            ? 'pcob:telemetry'
            : (stringFromUnknown(telemetryTypeRaw) ?? 'pcob:telemetry'),
        matchId: match.id,
        ts: typeof telemetryTsRaw === 'number' ? telemetryTsRaw : now.getTime(),
        payload: telemetryWithMeta as Record<string, unknown>,
      };
      this.events.emitTelemetry({
        matchId: match.id,
        payload: telemetryEvent,
      });
    }

    try {
      await this.applyKillEvent(
        match,
        sessionId,
        telemetryPayload as Prisma.InputJsonValue,
      );
    } catch {
      // keep ingest alive if kill sync fails
    }
    if (this.isZoneEvent(telemetryPayload)) {
      try {
        const zone = this.extractZone(telemetryPayload);
        await this.prisma.matchTelemetry.upsert({
          where: { matchId: match.id },
          create: {
            matchId: match.id,
            payload: {},
            zoneCenter: zone.zoneCenter ?? Prisma.JsonNull,
            zoneRadius: zone.zoneRadius,
            zonePhaseIndex: zone.zonePhaseIndex,
            zoneNextShrinkAt: zone.zoneNextShrinkAt,
          },
          update: {
            zoneCenter: zone.zoneCenter ?? Prisma.JsonNull,
            zoneRadius: zone.zoneRadius,
            zonePhaseIndex: zone.zonePhaseIndex,
            zoneNextShrinkAt: zone.zoneNextShrinkAt,
          },
        });
      } catch {
        // ignore zone persistence errors
      }
    }
    try {
      await this.mapState.emitIfChanged(match.id);
    } catch {
      // ignore map emit errors
    }

    console.log(
      '[PCOB TELEMETRY]',
      JSON.stringify({
        timestamp,
        eventType,
        sessionId,
        payload: truncated,
      }),
    );

    return { ok: true };
  }
}
