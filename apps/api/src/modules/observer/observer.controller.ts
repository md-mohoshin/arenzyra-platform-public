import {
  Body,
  Controller,
  Get,
  Logger,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  LiveState,
  MatchDataSource,
  MatchStatus,
  Prisma,
  TelemetrySource,
} from '@prisma/client';
import { ObserverService } from './observer.service';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { Public } from '../../common/auth/public.decorator';
import { ShadowBrandingService } from './shadow-branding.service';
import { ObserverWidgetStateService } from './observer-widget-state.service';
import { ObserverAchievementService } from './observer-achievement.service';
import { ObserverTeamEliminationService } from './observer-team-elimination.service';
import { MatchStateService } from './match-state.service';
import { ObserverAiService } from './observer-ai.service';
import { PrismaService } from '../../db/prisma.service';
import { MatchControlService } from '../match-control/match-control.service';
import {
  canAcceptTelemetryForMatch,
  deriveControlStateFromMatchStatus,
  isMatchFinalizingStatus,
  isMatchFinishedStatus,
} from '../../common/match-status.util';
import {
  buildApiObserverBindingData,
  hasLegacyPcobControlSignal,
  hasPcobAdapterBindingSignal,
  PCOB_ADAPTER_KEY,
} from '../../common/pcob-binding.util';
import { resolveMatchDataSource } from '../matches/match-datasource.util';
import { GameAdapterTelemetryService } from '../game-adapters/game-adapter-telemetry.service';
import { writeTelemetryRuntimeMeta } from '../../common/telemetry-runtime-contract.util';
import {
  findForbiddenObserverTelemetryFields,
  sanitizeObserverTelemetryPayload,
} from '../../common/observer-telemetry-contract.util';
import {
  enforceTelemetrySourceAllowed,
  normalizeTelemetrySource,
} from '../../common/telemetry-source.util';

const observerTelemetryMatchSelect = {
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
  dataMode: true,
  dataSource: true,
  controlState: {
    select: { state: true, metaJson: true, organizationId: true },
  },
  tournament: {
    select: { organizationId: true },
  },
} satisfies Prisma.MatchSelect;

type ObserverTelemetryMatch = Prisma.MatchGetPayload<{
  select: typeof observerTelemetryMatchSelect;
}>;

type ObserverTelemetryPayload = {
  matchId: string;
  sessionId?: string;
  sequence?: number | null;
  timestamp?: number | string | null;
  ts?: number | string | null;
  zonePhase?: number | string | null;
  players?: unknown[];
  kills?: unknown[];
  teams?: unknown[];
  backpacks?: unknown[];
  teamBackpackInfo?: unknown[];
  circle?: unknown;
  circleInfo?: unknown;
  CircleInfo?: unknown;
  allInfo?: unknown;
  routePayloads?: unknown;
  rawRoutePayloads?: unknown;
  observerSnapshot?: unknown;
  raw?: unknown;
  playerInfoList?: unknown[];
  killInfoList?: unknown[];
  teamInfoList?: unknown[];
  observer?: unknown;
  observingPlayer?: unknown;
  phase?: string | null;
  aliveTeams?: number | null;
};

@Controller('api')
export class ObserverController {
  private readonly logger = new Logger(ObserverController.name);

  constructor(
    private readonly observer: ObserverService,
    private readonly shadowBranding: ShadowBrandingService,
    private readonly observerWidgetState: ObserverWidgetStateService,
    private readonly observerAchievement: ObserverAchievementService,
    private readonly observerTeamElimination: ObserverTeamEliminationService,
    private readonly matchState: MatchStateService,
    private readonly observerAi: ObserverAiService,
    private readonly prisma: PrismaService,
    private readonly matchControl: MatchControlService,
    private readonly adapterTelemetry?: GameAdapterTelemetryService,
  ) {}

  private logAdapterPathDecision(
    rejectionReason: string | null,
    match: ObserverTelemetryMatch | null,
    incomingMatchId: string,
    incomingSessionId: string,
    extra: Record<string, unknown> = {},
  ) {
    const payload = {
      stage: 'observer-telemetry',
      action: rejectionReason
        ? 'adapter-path-rejected'
        : 'adapter-path-forwarded',
      incomingMatchId,
      incomingSessionId,
      expectedMatchId: match?.id ?? null,
      expectedSessionId: match?.pcobSessionId ?? null,
      adapterKey: match?.adapterKey ?? null,
      matchStatus: match?.status ?? null,
      controlStateStatus: match?.controlState?.state ?? null,
      rejectionReason,
      ...extra,
    };
    const serialized = JSON.stringify(payload);
    if (rejectionReason) {
      this.logger.warn(serialized);
      return;
    }
    this.logger.debug(serialized);
  }

  private buildAdapterEnvelope(body: ObserverTelemetryPayload) {
    const players = Array.isArray(body?.players)
      ? body.players
      : Array.isArray(body?.playerInfoList)
        ? body.playerInfoList
        : [];
    const teams = Array.isArray(body?.teams)
      ? body.teams
      : Array.isArray(body?.teamInfoList)
        ? body.teamInfoList
        : [];
    const kills = Array.isArray(body?.kills)
      ? body.kills
      : Array.isArray(body?.killInfoList)
        ? body.killInfoList
        : [];
    const backpacks = Array.isArray(body?.backpacks)
      ? body.backpacks
      : Array.isArray(body?.teamBackpackInfo)
        ? body.teamBackpackInfo
        : [];
    const zonePhase = this.numberValue(
      body?.zonePhase ??
        (body?.circle as Record<string, unknown> | null | undefined)
          ?.zonePhaseIndex ??
        (body?.circle as Record<string, unknown> | null | undefined)?.phase ??
        (body?.circle as Record<string, unknown> | null | undefined)
          ?.circleIndex ??
        (body?.circleInfo as Record<string, unknown> | null | undefined)
          ?.zonePhaseIndex ??
        (body?.circleInfo as Record<string, unknown> | null | undefined)
          ?.phase ??
        (body?.circleInfo as Record<string, unknown> | null | undefined)
          ?.circleIndex ??
        (body?.CircleInfo as Record<string, unknown> | null | undefined)
          ?.zonePhaseIndex ??
        (body?.CircleInfo as Record<string, unknown> | null | undefined)
          ?.phase ??
        (body?.CircleInfo as Record<string, unknown> | null | undefined)
          ?.circleIndex,
    );

    const envelope: Record<string, unknown> = {
      matchId: body.matchId,
      sessionId: body.sessionId,
      sequence: body.sequence ?? null,
      timestamp: body.timestamp ?? body.ts ?? null,
      players,
      teams,
      zone: zonePhase === null ? null : { phase: zonePhase },
      events: [],
    };
    const circle = body.circle ?? body.circleInfo ?? body.CircleInfo ?? null;
    const circleInfo =
      body.circleInfo ?? body.circle ?? body.CircleInfo ?? null;
    const observer = body.observer ?? body.observingPlayer ?? null;
    const raw = body.raw ?? body.observerSnapshot ?? null;

    if (kills.length > 0) {
      envelope.kills = kills;
    }
    if (backpacks.length > 0) {
      envelope.backpacks = backpacks;
      envelope.teamBackpackInfo = backpacks;
    }
    if (circle !== null && circle !== undefined) {
      envelope.circle = circle;
    }
    if (circleInfo !== null && circleInfo !== undefined) {
      envelope.circleInfo = circleInfo;
    }
    if (observer !== null && observer !== undefined) {
      envelope.observer = observer;
    }
    if (body.allInfo !== null && body.allInfo !== undefined) {
      envelope.allInfo = body.allInfo;
    }
    if (body.routePayloads !== null && body.routePayloads !== undefined) {
      envelope.routePayloads = body.routePayloads;
    }
    if (body.rawRoutePayloads !== null && body.rawRoutePayloads !== undefined) {
      envelope.rawRoutePayloads = body.rawRoutePayloads;
    }
    if (body.observerSnapshot !== null && body.observerSnapshot !== undefined) {
      envelope.observerSnapshot = body.observerSnapshot;
    }
    if (raw !== null && raw !== undefined) {
      envelope.raw = raw;
    }

    return envelope;
  }

  private async touchTelemetryTransport(
    match: Pick<
      ObserverTelemetryMatch,
      'id' | 'organizationId' | 'status' | 'controlState'
    >,
    source: string | null,
    receivedAt: Date,
  ) {
    const currentState =
      match.controlState?.state ??
      deriveControlStateFromMatchStatus(match.status);
    const organizationId =
      match.organizationId ?? match.controlState?.organizationId ?? null;
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

  private logPipelineObserverDecision(params: {
    accepted: boolean;
    matchId: string | null;
    sessionId: string | null;
    reason?: string | null;
    queued?: boolean;
    playerCount?: number;
    teamCount?: number;
    killCount?: number;
    extra?: Record<string, unknown>;
  }) {
    this.logger.log(
      JSON.stringify({
        tag: '[PIPELINE][OBSERVER ACCEPT]',
        stage: 'observer-controller',
        outcome: params.accepted ? 'accepted' : 'rejected',
        matchId: params.matchId,
        sessionId: params.sessionId,
        reason: params.reason ?? null,
        queued: params.queued === true,
        players: params.playerCount ?? null,
        teams: params.teamCount ?? null,
        kills: params.killCount ?? null,
        ...(params.extra ?? {}),
      }),
    );
  }

  private isAdapterPcobMatch(match: ObserverTelemetryMatch): boolean {
    const dataSource = resolveMatchDataSource(match);
    return (
      hasLegacyPcobControlSignal(match) ||
      (dataSource === MatchDataSource.API && hasPcobAdapterBindingSignal(match))
    );
  }

  @Get('matches/:matchId/observer-suggestions')
  @Public()
  suggestions(@Param('matchId') matchId: string) {
    return this.observer.getSuggestions(matchId);
  }

  @Get('observer/match/:matchId/slots')
  @Public()
  async matchSlots(@Param('matchId') matchId: string) {
    const slots = await this.observer.getMatchSlots(matchId);
    return { slots };
  }

  @Post('observer/match/:matchId/shadow-branding')
  @UseGuards(JwtAuthGuard)
  async generateShadowBranding(@Param('matchId') matchId: string) {
    return this.shadowBranding.generateShadowBranding(matchId);
  }

  @Post('observer/telemetry')
  @UseGuards(JwtAuthGuard)
  async ingestTelemetry(@Body() body: ObserverTelemetryPayload) {
    const matchId = String(body?.matchId || '').trim();
    const sessionId = String(body?.sessionId || '').trim();
    const playerCount = Array.isArray(body?.players)
      ? body.players.length
      : Array.isArray(body?.playerInfoList)
        ? body.playerInfoList.length
        : 0;
    const teamCount = Array.isArray(body?.teams)
      ? body.teams.length
      : Array.isArray(body?.teamInfoList)
        ? body.teamInfoList.length
        : 0;
    const killCount = Array.isArray(body?.kills)
      ? body.kills.length
      : Array.isArray(body?.killInfoList)
        ? body.killInfoList.length
        : 0;

    this.logger.log(
      JSON.stringify({
        tag: '[PIPELINE][POST RECEIVED]',
        stage: 'observer-controller',
        matchId: matchId || null,
        sessionId: sessionId || null,
        players: playerCount,
        teams: teamCount,
        kills: killCount,
      }),
    );

    this.logger.log(
      `[observer-controller] telemetry received match=${matchId || 'missing'} session=${sessionId || 'missing'} players=${playerCount} teams=${teamCount} kills=${killCount}`,
    );

    if (!matchId) {
      this.logPipelineObserverDecision({
        accepted: false,
        matchId: null,
        sessionId: sessionId || null,
        reason: 'MATCH_ID_REQUIRED',
        playerCount,
        teamCount,
        killCount,
      });
      this.logger.debug(
        '[observer-controller] telemetry ignored reason=MATCH_ID_REQUIRED',
      );
      return { ok: true, ignored: true, reason: 'MATCH_ID_REQUIRED' };
    }

    const { sanitizedPayload, strippedFields } =
      sanitizeObserverTelemetryPayload(body);
    if (strippedFields.length > 0) {
      this.logger.warn(
        JSON.stringify({
          stage: 'observer-telemetry',
          action: 'observer-telemetry.sanitized-fields',
          matchId,
          sessionId: sessionId || null,
          strippedFields,
        }),
      );
    }

    const sanitizedBody = sanitizedPayload;
    const forbiddenFields = findForbiddenObserverTelemetryFields(sanitizedBody);
    if (forbiddenFields.length > 0) {
      this.logPipelineObserverDecision({
        accepted: false,
        matchId,
        sessionId: sessionId || null,
        reason: 'FORBIDDEN_FIELDS',
        playerCount,
        teamCount,
        killCount,
        extra: {
          forbiddenFields,
        },
      });
      this.logger.warn(
        JSON.stringify({
          stage: 'observer-telemetry',
          action: 'observer-telemetry.forbidden-fields',
          matchId,
          sessionId: sessionId || null,
          forbiddenFields,
        }),
      );
      return {
        ok: true,
        ignored: true,
        reason: 'FORBIDDEN_FIELDS',
        matchId,
      };
    }

    const match = await this.prisma.match.findUnique({
      where: { id: matchId },
      select: observerTelemetryMatchSelect,
    });

    if (!match || match.deletedAt) {
      this.logPipelineObserverDecision({
        accepted: false,
        matchId,
        sessionId: sessionId || null,
        reason: 'MATCH_NOT_FOUND',
        playerCount,
        teamCount,
        killCount,
      });
      this.logger.debug(
        `[observer-controller] telemetry ignored match=${matchId} session=${sessionId || 'missing'} reason=MATCH_NOT_FOUND`,
      );
      return { ok: true, ignored: true, reason: 'MATCH_NOT_FOUND', matchId };
    }
    const controlStateStatus = match.controlState?.state ?? null;
    const isControlLive = controlStateStatus === MatchStatus.LIVE;
    if (
      (!canAcceptTelemetryForMatch(match.status) && !isControlLive) ||
      match.liveState === LiveState.ENDED
    ) {
      const lifecycle = await this.matchControl.getLifecycleState(matchId);
      const reason = isMatchFinishedStatus(match.status)
        ? 'MATCH_ENDED'
        : isMatchFinalizingStatus(match.status)
          ? 'MATCH_FINALIZING'
          : 'MATCH_NOT_LIVE';
      this.logPipelineObserverDecision({
        accepted: false,
        matchId,
        sessionId: sessionId || null,
        reason,
        playerCount,
        teamCount,
        killCount,
      });
      this.logger.debug(
        `[observer-controller] telemetry ignored match=${matchId} session=${sessionId || 'missing'} reason=${reason}`,
      );
      return {
        ok: true,
        ignored: true,
        reason,
        matchId,
        matchStatus: lifecycle.status,
        isLocked: lifecycle.isLocked,
        isFinalizing: lifecycle.isFinalizing,
        finalizationStartedAt: lifecycle.finalizationStartedAt,
        finalizationDurationMs: lifecycle.finalizationDurationMs,
      };
    }
    if (!sessionId) {
      this.logPipelineObserverDecision({
        accepted: false,
        matchId,
        sessionId: null,
        reason: 'SESSION_ID_REQUIRED',
        playerCount,
        teamCount,
        killCount,
      });
      this.logger.debug(
        `[observer-controller] telemetry ignored match=${matchId} reason=SESSION_ID_REQUIRED`,
      );
      return {
        ok: true,
        ignored: true,
        reason: 'SESSION_ID_REQUIRED',
        matchId,
      };
    }

    let resolvedMatch = match;
    let expectedSessionId =
      typeof resolvedMatch.pcobSessionId === 'string'
        ? resolvedMatch.pcobSessionId.trim()
        : '';

    if (!expectedSessionId) {
      const bound = await this.prisma.match.updateMany({
        where: {
          id: matchId,
          deletedAt: null,
          OR: [{ pcobSessionId: null }, { pcobSessionId: '' }],
        },
        data: buildApiObserverBindingData(sessionId),
      });

      if (bound.count > 0) {
        expectedSessionId = sessionId;
        resolvedMatch = {
          ...resolvedMatch,
          ...buildApiObserverBindingData(sessionId),
        } as ObserverTelemetryMatch;
        this.logger.debug(
          `[observer-controller] telemetry bound missing session match=${matchId} session=${sessionId}`,
        );
      } else {
        const rebound = await this.prisma.match.findUnique({
          where: { id: matchId },
          select: observerTelemetryMatchSelect,
        });
        if (rebound) {
          resolvedMatch = rebound;
          expectedSessionId =
            typeof rebound.pcobSessionId === 'string'
              ? rebound.pcobSessionId.trim()
              : '';
        }
      }
    }

    if (sessionId !== expectedSessionId) {
      this.logPipelineObserverDecision({
        accepted: false,
        matchId,
        sessionId,
        reason: 'SESSION_MISMATCH',
        playerCount,
        teamCount,
        killCount,
        extra: {
          expectedSessionId: expectedSessionId || null,
        },
      });
      this.logAdapterPathDecision(
        'SESSION_MISMATCH',
        resolvedMatch,
        matchId,
        sessionId,
      );
      this.logger.debug(
        `[observer-controller] telemetry ignored match=${matchId} session=${sessionId} expected=${expectedSessionId || 'missing'} reason=SESSION_MISMATCH`,
      );
      return { ok: true, ignored: true, reason: 'SESSION_MISMATCH', matchId };
    }

    const receivedAt = new Date();
    if (this.isAdapterPcobMatch(resolvedMatch)) {
      if (resolvedMatch.adapterKey !== PCOB_ADAPTER_KEY) {
        this.logPipelineObserverDecision({
          accepted: false,
          matchId,
          sessionId,
          reason: 'MATCH_NOT_ADAPTER_BOUND',
          playerCount,
          teamCount,
          killCount,
          extra: {
            adapterKey: resolvedMatch.adapterKey ?? null,
          },
        });
        this.logAdapterPathDecision(
          'MATCH_NOT_ADAPTER_BOUND',
          resolvedMatch,
          matchId,
          sessionId,
          {
            expectedAdapterKey: PCOB_ADAPTER_KEY,
            receivedAdapterKey: resolvedMatch.adapterKey ?? null,
          },
        );
        return {
          ok: true,
          ignored: true,
          reason: 'MATCH_NOT_ADAPTER_BOUND',
          matchId,
        };
      }

      if (!this.adapterTelemetry) {
        this.logPipelineObserverDecision({
          accepted: false,
          matchId,
          sessionId,
          reason: 'ADAPTER_TELEMETRY_UNAVAILABLE',
          playerCount,
          teamCount,
          killCount,
        });
        this.logAdapterPathDecision(
          'ADAPTER_TELEMETRY_UNAVAILABLE',
          resolvedMatch,
          matchId,
          sessionId,
        );
        return {
          ok: true,
          ignored: true,
          reason: 'ADAPTER_TELEMETRY_UNAVAILABLE',
          matchId,
        };
      }

      const activeTelemetrySource = normalizeTelemetrySource(
        resolvedMatch.telemetrySource,
      );
      if (
        activeTelemetrySource !== null &&
        activeTelemetrySource !== TelemetrySource.AUTO &&
        activeTelemetrySource !== TelemetrySource.API
      ) {
        this.logPipelineObserverDecision({
          accepted: false,
          matchId,
          sessionId,
          reason: 'SOURCE_MISMATCH',
          playerCount,
          teamCount,
          killCount,
          extra: {
            activeTelemetrySource,
          },
        });
        this.logger.debug(
          `[observer-controller] api telemetry ignored match=${matchId} session=${sessionId} activeSource=${activeTelemetrySource} reason=SOURCE_MISMATCH`,
        );
        return {
          ok: true,
          ignored: true,
          reason: 'SOURCE_MISMATCH',
          matchId,
        };
      }

      const { match: sourceLockedMatch } = await enforceTelemetrySourceAllowed({
        prisma: this.prisma,
        logger: this.logger,
        match: resolvedMatch,
        incomingSource: 'API',
      });

      await this.touchTelemetryTransport(sourceLockedMatch, 'API', receivedAt);

      this.logAdapterPathDecision(null, resolvedMatch, matchId, sessionId, {
        eventCount: Array.isArray(sanitizedBody?.kills)
          ? sanitizedBody.kills.length
          : Array.isArray(sanitizedBody?.killInfoList)
            ? sanitizedBody.killInfoList.length
            : 0,
      });
      const result = await this.adapterTelemetry.ingestEnvelope(
        matchId,
        this.buildAdapterEnvelope(sanitizedBody),
        {
          sourceOverride: 'API',
        },
      );
      if (result?.handled === false) {
        this.logPipelineObserverDecision({
          accepted: false,
          matchId,
          sessionId,
          reason: 'ADAPTER_NOT_ENVELOPE_CAPABLE',
          playerCount,
          teamCount,
          killCount,
        });
        return {
          ok: true,
          ignored: true,
          reason: 'ADAPTER_NOT_ENVELOPE_CAPABLE',
          matchId,
        };
      }
      const adapterReason =
        result && 'reason' in result ? (result.reason ?? null) : null;
      this.logPipelineObserverDecision({
        accepted: true,
        matchId,
        sessionId,
        queued: true,
        reason: adapterReason,
        playerCount,
        teamCount,
        killCount,
      });
      return {
        ok: true,
        queued: true,
        matchId,
        receivedAt: receivedAt.toISOString(),
      };
    }

    this.logger.warn(
      '[observer-telemetry] legacy observer authority remains disabled because it is not match-boundary safe',
    );
    return {
      ok: true,
      ignored: true,
      reason: 'LEGACY_OBSERVER_TELEMETRY_DISABLED',
      matchId,
    };
  }

  private numberValue(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return Math.trunc(value);
    }
    if (typeof value === 'string' && value.trim().length > 0) {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
    }
    return null;
  }

  @Get('observer/match-state/:matchId')
  @Public()
  cachedMatchState(@Param('matchId') matchId: string) {
    return this.matchState.get(matchId);
  }

  @Get('observer/match/:matchId/achievements')
  @Public()
  listAchievements(@Param('matchId') matchId: string) {
    return this.observerAchievement.list(matchId);
  }

  @Get('observer/match/:matchId/team-eliminations')
  @Public()
  listTeamEliminations(@Param('matchId') matchId: string) {
    return this.observerTeamElimination.list(matchId);
  }

  @Post('observer/match/:matchId/finish-detected')
  @UseGuards(JwtAuthGuard)
  async finishDetected(
    @Param('matchId') matchId: string,
    @Body() body?: { sessionId?: string | null },
  ) {
    return this.matchControl.detectMatchFinish(
      matchId,
      body?.sessionId ?? null,
    );
  }

  @Get('observer/match/:matchId/next')
  @Public()
  async nextMatch(
    @Param('matchId') matchId: string,
    @Query('suggestedMatchId') suggestedMatchId?: string,
  ) {
    return this.matchControl.resolveNextEligibleMatch(matchId, {
      suggestedMatchId: suggestedMatchId ?? null,
    });
  }

  @Get('observer/match/:matchId/camera-suggestions')
  @Public()
  cameraSuggestions(@Param('matchId') matchId: string) {
    return {
      suggestions: this.observerAi.getSuggestions(matchId),
    };
  }

  @Get('observer/match/:matchId/widget-state')
  @Public()
  async widgetState(@Param('matchId') matchId: string) {
    return this.observerWidgetState.getMatchUpdate(matchId);
  }
}
