import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import type { AuthenticatedRequest } from '../../common/auth/auth.types';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { MatchControlService } from './match-control.service';
import { SetStatusDto, UpdateScoreDto } from './dto/control.dto';

type MatchControlLiveState = Awaited<
  ReturnType<MatchControlService['getState']>
>;
type MatchControlLifecycleSnapshot = Awaited<
  ReturnType<MatchControlService['getLifecycleState']>
>;

function shouldExposeLiveTelemetry(
  lifecycle: MatchControlLifecycleSnapshot,
): boolean {
  // Keep the last accepted live snapshot visible during short packet gaps.
  const telemetryVisibleDuringLive =
    lifecycle.lifecycleStatus === 'LIVE' &&
    lifecycle.telemetry?.telemetryAccepted === true;
  return Boolean(
    lifecycle.resultFinalized ||
    lifecycle.isFinalizing ||
    lifecycle.telemetry?.telemetryActive ||
    telemetryVisibleDuringLive,
  );
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
      alive: undefined,
      eliminated: undefined,
      players: [],
    })),
  };
}

@Controller('me/matches/:matchId/control')
@UseGuards(JwtAuthGuard)
@Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.ORGANIZER)
export class MatchControlController {
  constructor(private readonly service: MatchControlService) {}

  @Get()
  getState(
    @Param('matchId') matchId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return Promise.all([
      this.service.getState(req.user, matchId),
      this.service.getLifecycleState(matchId),
    ]).then(([state, lifecycle]) => {
      const controlState = shouldExposeLiveTelemetry(lifecycle)
        ? state
        : stripStaleLiveTelemetry(state);

      return {
        ...controlState,
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
        finalizationStartedAt: lifecycle.finalizationStartedAt,
        finalizationDurationMs: lifecycle.finalizationDurationMs,
        liveState: lifecycle.liveState,
        controlStatus: lifecycle.controlStatus,
        locks: lifecycle.locks,
        telemetry: lifecycle.telemetry,
        binding: lifecycle.binding,
      };
    });
  }

  @Post('start')
  start(
    @Param('matchId') matchId: string,
    @Body() body: { sessionId?: string | null },
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.startMatch(req.user, matchId, body?.sessionId ?? null);
  }

  @Post('end')
  end(@Param('matchId') matchId: string, @Req() req: AuthenticatedRequest) {
    return this.service.endMatch(req.user, matchId);
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
