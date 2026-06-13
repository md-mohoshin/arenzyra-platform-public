import {
  Body,
  Controller,
  Get,
  Logger,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { MatchDataSource, Role } from '@prisma/client';
import type { AuthenticatedRequest } from '../../common/auth/auth.types';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { requireMatchOrganization } from '../../common/org/org.util';
import { PrismaService } from '../../db/prisma.service';
import { MatchControlService } from './match-control.service';
import { SetStatusDto, UpdateScoreDto } from './dto/control.dto';
import { toCanonicalMatchStateSourceMode } from './state.store';

type MatchControlLiveState = Awaited<
  ReturnType<MatchControlService['getState']>
>;
type MatchControlLifecycleSnapshot = Awaited<
  ReturnType<MatchControlService['getLifecycleState']>
>;
type StartMatchBody = {
  sessionId?: string | null;
  source?: string | null;
  clientId?: string | null;
  requestedMatchId?: string | null;
  version?: number | null;
};

type EndMatchBody = {
  reason?: string | null;
  version?: number | null;
};

const MAX_BATCH_CONTROL_SUMMARY_IDS = 250;

function parseControlSummaryIds(value: string | string[] | undefined) {
  const rawValues = Array.isArray(value) ? value : value ? [value] : [];
  return Array.from(
    new Set(
      rawValues
        .flatMap((item) => item.split(','))
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ).slice(0, MAX_BATCH_CONTROL_SUMMARY_IDS);
}

function canReadControlSummaryForOrg(
  req: AuthenticatedRequest,
  organizationId: string | null,
) {
  const actorRole = req.user.actorRole ?? req.user.role;
  if (actorRole === Role.SUPER_ADMIN) {
    return true;
  }

  const actorOrg =
    req.user.actingOrgId ?? req.user.organizationId ?? req.user.orgId ?? null;
  return Boolean(organizationId && actorOrg && actorOrg === organizationId);
}

function exposeLiveSourceMode(
  value: string | null | undefined,
): 'MANUAL' | 'API' | null {
  const normalized = toCanonicalMatchStateSourceMode(value);
  if (!normalized) {
    return null;
  }
  if (normalized === 'MANUAL') {
    return MatchDataSource.MANUAL;
  }
  return MatchDataSource.API;
}

function shouldExposeLiveTelemetry(
  lifecycle: MatchControlLifecycleSnapshot,
  state: MatchControlLiveState,
): boolean {
  // Keep the last accepted live snapshot visible during short packet gaps.
  const telemetryVisibleDuringLive =
    lifecycle.lifecycleStatus === 'LIVE' &&
    (lifecycle.telemetry?.telemetryAccepted === true ||
      hasBestKnownLiveTelemetry(state));
  return Boolean(lifecycle.resultFinalized || telemetryVisibleDuringLive);
}

function hasBestKnownLiveTelemetry(state: MatchControlLiveState): boolean {
  if (state.circle || state.observedPlayer) {
    return true;
  }
  if ((state.killFeed?.length ?? 0) > 0 || (state.events?.length ?? 0) > 0) {
    return true;
  }

  return state.teams.some((team) => {
    if (team.hasTelemetryPresence === true) {
      return true;
    }
    return (team.players ?? []).some((player) => {
      if (player.lifeTelemetryFresh === true) {
        return true;
      }
      return Boolean(player.position);
    });
  });
}

function stripStaleLiveTelemetry(
  state: MatchControlLiveState,
): MatchControlLiveState {
  return {
    ...state,
    summary: null,
    circle: null,
    observedPlayer: null,
    killFeed: [],
    events: [],
    teams: state.teams.map((team) => ({
      ...team,
      alivePlayers: null,
      totalPlayers: null,
      alive: undefined,
      eliminated: undefined,
      players: [],
    })),
  };
}

@Controller('me/match-control-summaries')
@UseGuards(JwtAuthGuard)
@Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.ORGANIZER)
export class MatchControlSummariesController {
  constructor(
    private readonly service: MatchControlService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  async list(
    @Query('ids') ids: string | string[] | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    const matchIds = parseControlSummaryIds(ids);
    if (!matchIds.length) {
      return { snapshots: {} };
    }

    const matches = await this.prisma.match.findMany({
      where: {
        id: { in: matchIds },
        deletedAt: null,
      },
      select: {
        id: true,
        organizationId: true,
        tournament: { select: { organizationId: true } },
      },
    });

    const accessibleIds = matches
      .filter((match) =>
        canReadControlSummaryForOrg(
          req,
          match.organizationId ?? match.tournament?.organizationId ?? null,
        ),
      )
      .map((match) => match.id);

    const results = await Promise.allSettled(
      accessibleIds.map(async (matchId) => {
        const snapshot = await this.service.getLifecycleState(matchId);
        return [matchId, snapshot] as const;
      }),
    );

    const snapshots: Record<string, MatchControlLifecycleSnapshot> = {};
    for (const result of results) {
      if (result.status !== 'fulfilled') {
        continue;
      }

      const [matchId, snapshot] = result.value;
      snapshots[matchId] = snapshot;
    }

    return { snapshots };
  }
}

@Controller('me/matches/:matchId/control')
@UseGuards(JwtAuthGuard)
@Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.ORGANIZER)
export class MatchControlController {
  private readonly logger = new Logger(MatchControlController.name);

  constructor(
    private readonly service: MatchControlService,
    private readonly prisma: PrismaService,
  ) {}

  private async authorizeLifecycleRead(
    matchId: string,
    req: AuthenticatedRequest,
  ) {
    await requireMatchOrganization(this.prisma, matchId, {
      actor: req.user,
    });
    await this.service.authorize(req.user, matchId);
  }

  private async buildLiveControlResponse(
    matchId: string,
    req: AuthenticatedRequest,
  ) {
    return Promise.all([
      this.service.getState(req.user, matchId),
      this.service.getLifecycleState(matchId),
    ]).then(([state, lifecycle]) => {
      const bestKnownLiveTelemetry = hasBestKnownLiveTelemetry(state);
      const exposeLiveTelemetry = shouldExposeLiveTelemetry(lifecycle, state);
      const controlState = exposeLiveTelemetry
        ? state
        : stripStaleLiveTelemetry(state);
      this.logger.log(
        JSON.stringify({
          tag: '[PIPELINE][CONTROL RESPONSE]',
          stage: 'match-control-controller',
          matchId,
          liveTelemetryIncluded: exposeLiveTelemetry,
          lifecycleStatus: lifecycle.lifecycleStatus,
          controlStatus: lifecycle.controlStatus,
          telemetryActive: lifecycle.telemetry?.telemetryActive ?? false,
          telemetryAccepted: lifecycle.telemetry?.telemetryAccepted ?? false,
          bestKnownLiveTelemetry,
          sourceMode: exposeLiveSourceMode(controlState.sourceMode),
          teamCount: controlState.teams.length,
          playerCount: controlState.teams.reduce(
            (count, team) => count + (team.players?.length ?? 0),
            0,
          ),
          stripped:
            controlState.summary === null &&
            controlState.circle === null &&
            (controlState.killFeed?.length ?? 0) === 0 &&
            controlState.teams.every(
              (team) => (team.players?.length ?? 0) === 0,
            ),
        }),
      );

      return {
        ...controlState,
        sourceMode: exposeLiveSourceMode(controlState.sourceMode),
        teams: controlState.teams.map((team) => ({
          ...team,
          sourceMode: exposeLiveSourceMode(team.sourceMode),
        })),
        status: lifecycle.controlStatus,
        matchStatus: lifecycle.status,
        lifecycleStatus: lifecycle.lifecycleStatus,
        updatedAt: lifecycle.updatedAt ?? controlState.updatedAt,
        startedAt: lifecycle.startedAt ?? controlState.startedAt,
        endedAt: lifecycle.endedAt ?? controlState.endedAt,
        isLocked: lifecycle.isLocked,
        isFinalizing: lifecycle.isFinalizing,
        resultFinalized: lifecycle.resultFinalized,
        resultNeedsConfirmation: lifecycle.resultNeedsConfirmation,
        resultAmbiguities: lifecycle.resultAmbiguities,
        organizationSlug: lifecycle.organizationSlug,
        postMatchWidgets: lifecycle.postMatchWidgets,
        finalizationStartedAt: lifecycle.finalizationStartedAt,
        finalizationDurationMs: lifecycle.finalizationDurationMs,
        liveState: lifecycle.liveState,
        controlStatus: lifecycle.controlStatus,
        controlVersion: lifecycle.controlVersion,
        locks: lifecycle.locks,
        telemetry: lifecycle.telemetry,
        binding: lifecycle.binding,
      };
    });
  }

  @Get()
  getState(
    @Param('matchId') matchId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.buildLiveControlResponse(matchId, req);
  }

  @Get('live')
  getLiveState(
    @Param('matchId') matchId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.buildLiveControlResponse(matchId, req);
  }

  @Get('setup')
  async getSetupState(
    @Param('matchId') matchId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    await this.authorizeLifecycleRead(matchId, req);
    const lifecycle = await this.service.getLifecycleState(matchId);
    return {
      matchId,
      lifecycleStatus: lifecycle.lifecycleStatus,
      controlStatus: lifecycle.controlStatus,
      updatedAt: lifecycle.updatedAt,
      binding: lifecycle.binding,
      locks: lifecycle.locks,
    };
  }

  @Get('results')
  async getResultsState(
    @Param('matchId') matchId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    await this.authorizeLifecycleRead(matchId, req);
    const lifecycle = await this.service.getLifecycleState(matchId);
    return {
      matchId,
      lifecycleStatus: lifecycle.lifecycleStatus,
      resultFinalized: lifecycle.resultFinalized,
      resultNeedsConfirmation: lifecycle.resultNeedsConfirmation,
      resultAmbiguities: lifecycle.resultAmbiguities,
      organizationSlug: lifecycle.organizationSlug,
      postMatchWidgets: lifecycle.postMatchWidgets,
      finalizationStartedAt: lifecycle.finalizationStartedAt,
      finalizationDurationMs: lifecycle.finalizationDurationMs,
      locks: lifecycle.locks,
    };
  }

  @Post('start')
  start(
    @Param('matchId') matchId: string,
    @Body() body: StartMatchBody,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.startMatch(req.user, matchId, body?.sessionId ?? null, {
      source: body?.source ?? 'match-control-api',
      clientId: body?.clientId ?? null,
      requestedMatchId: body?.requestedMatchId ?? matchId,
      expectedVersion: body?.version ?? null,
    });
  }

  @Post('end')
  end(
    @Param('matchId') matchId: string,
    @Body() body: EndMatchBody | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.endMatch(
      req.user,
      matchId,
      body?.reason ?? 'MANUAL_END',
      { expectedVersion: body?.version ?? null },
    );
  }

  @Post('live/start')
  startLive(
    @Param('matchId') matchId: string,
    @Body() body: StartMatchBody,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.start(matchId, body, req);
  }

  @Post('live/end')
  endLive(
    @Param('matchId') matchId: string,
    @Body() body: EndMatchBody | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.end(matchId, body, req);
  }

  @Post('results/finalize')
  finalizeResults(
    @Param('matchId') matchId: string,
    @Body() body: EndMatchBody | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.confirmFinished(
      req.user,
      matchId,
      body?.reason ?? 'FINALIZE_RESULTS',
      { expectedVersion: body?.version ?? null },
    );
  }

  @Post('status')
  setStatus(
    @Param('matchId') matchId: string,
    @Body() dto: SetStatusDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.setStatus(req.user, matchId, dto);
  }

  @Post('score')
  updateScore(
    @Param('matchId') matchId: string,
    @Body() dto: UpdateScoreDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.updateScore(req.user, matchId, dto);
  }
}
