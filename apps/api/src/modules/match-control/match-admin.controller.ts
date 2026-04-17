import {
  Body,
  Controller,
  Inject,
  forwardRef,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Role, AuditAction } from '@prisma/client';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { Roles } from '../../common/auth/roles.decorator';
import type { AuthenticatedRequest } from '../../common/auth/auth.types';
import type { ControlState } from './dto/control.dto';
import { MatchStateService } from './match-state.service';
import { AuditService } from '../audit/audit.service';
import { MatchControlGateway } from './match-control.gateway';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ProductionService } from '../production/production.service';

class OptionalReasonDto {
  @IsOptional()
  @IsString()
  reason?: string;
}

class ReasonDto {
  @IsString()
  @IsNotEmpty()
  reason!: string;
}

class RefereeBaseDto {
  @IsString()
  @IsNotEmpty()
  reason!: string;
}

class TeamTargetDto extends RefereeBaseDto {
  @IsString()
  @IsNotEmpty()
  teamId!: string;
}

class KillAdjustDto extends TeamTargetDto {
  @IsOptional()
  delta?: number;
}

class PlacementAdjustDto extends TeamTargetDto {
  @IsOptional()
  placement?: number;
}

@Controller(['api/matches/:matchId/control', 'matches/:matchId/control'])
@UseGuards(JwtAuthGuard)
@Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.ORGANIZER, Role.REFEREE)
export class MatchAdminControlController {
  constructor(
    private readonly state: MatchStateService,
    private readonly audit: AuditService,
    private readonly gateway: MatchControlGateway,
    @Inject(forwardRef(() => ProductionService))
    private readonly production: ProductionService,
  ) {}

  @Get('snapshot')
  snapshot(@Param('matchId') matchId: string) {
    return this.state.snapshot(matchId);
  }

  private transition(
    matchId: string,
    next: ControlState,
    req: AuthenticatedRequest,
    action: string,
    reason?: string | null,
  ) {
    return this.state.transition(matchId, next, req.user, reason ?? action);
  }

  @Post('start')
  start(
    @Param('matchId') matchId: string,
    @Req() req: AuthenticatedRequest,
    @Body() body?: OptionalReasonDto,
  ) {
    return this.transition(matchId, 'COUNTDOWN', req, 'start', body?.reason);
  }

  @Post('mark-live')
  markLive(
    @Param('matchId') matchId: string,
    @Req() req: AuthenticatedRequest,
    @Body() body?: OptionalReasonDto,
  ) {
    return this.transition(matchId, 'LIVE', req, 'mark-live', body?.reason);
  }

  @Post('pause')
  pause(
    @Param('matchId') matchId: string,
    @Req() req: AuthenticatedRequest,
    @Body() body?: OptionalReasonDto,
  ) {
    return this.transition(matchId, 'PAUSED', req, 'pause', body?.reason);
  }

  @Post('resume')
  resume(
    @Param('matchId') matchId: string,
    @Req() req: AuthenticatedRequest,
    @Body() body?: OptionalReasonDto,
  ) {
    return this.transition(matchId, 'LIVE', req, 'resume', body?.reason);
  }

  @Post('set-pending')
  setPending(
    @Param('matchId') matchId: string,
    @Req() req: AuthenticatedRequest,
    @Body() body?: OptionalReasonDto,
  ) {
    return this.transition(matchId, 'PAUSED', req, 'set-pending', body?.reason);
  }

  @Post('end')
  end(
    @Param('matchId') matchId: string,
    @Req() req: AuthenticatedRequest,
    @Body() body?: OptionalReasonDto,
  ) {
    return this.transition(matchId, 'ENDED', req, 'end', body?.reason);
  }

  @Post('force-end')
  forceEnd(
    @Param('matchId') matchId: string,
    @Req() req: AuthenticatedRequest,
    @Body() body: ReasonDto,
  ) {
    return this.transition(matchId, 'ENDED', req, 'force-end', body.reason);
  }

  @Post('reset')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.ORGANIZER)
  reset(@Param('matchId') matchId: string, @Req() req: AuthenticatedRequest) {
    return this.production.resetMatch(null, matchId, req.user);
  }

  @Post('lock')
  lock(
    @Param('matchId') matchId: string,
    @Req() req: AuthenticatedRequest,
    @Body() body?: OptionalReasonDto,
  ) {
    return this.transition(matchId, 'ENDED', req, 'lock', body?.reason);
  }

  @Post('confirm')
  confirm(
    @Param('matchId') matchId: string,
    @Req() req: AuthenticatedRequest,
    @Body() body?: OptionalReasonDto,
  ) {
    return this.transition(matchId, 'CONFIRMED', req, 'confirm', body?.reason);
  }

  @Post('reconnect')
  reconnect(
    @Param('matchId') matchId: string,
    @Req() req: AuthenticatedRequest,
    @Body() body?: OptionalReasonDto,
  ) {
    return this.transition(matchId, 'PAUSED', req, 'reconnect', body?.reason);
  }

  @Post('sync-overlay')
  async syncOverlay(
    @Param('matchId') matchId: string,
    @Req() req: AuthenticatedRequest,
    @Body() body?: OptionalReasonDto,
  ) {
    const snapshot = await this.state.getState(matchId);
    return this.transition(
      matchId,
      snapshot.state,
      req,
      'sync-overlay',
      body?.reason,
    );
  }

  @Post('referee/penalty')
  async applyPenalty(
    @Param('matchId') matchId: string,
    @Body() body: TeamTargetDto,
    @Req() req: AuthenticatedRequest,
  ) {
    await this.logRefereeAction(
      matchId,
      req.user.id,
      'REFEREE_PENALTY',
      body.reason,
      {
        teamId: body.teamId,
      },
    );
    this.gateway.emitAuditAppend(matchId, {
      action: 'REFEREE_PENALTY',
      byUser: req.user.id,
      matchId,
      reason: body.reason,
      at: new Date().toISOString(),
    });
    return { ok: true };
  }

  @Post('referee/disqualify')
  async disqualify(
    @Param('matchId') matchId: string,
    @Body() body: TeamTargetDto,
    @Req() req: AuthenticatedRequest,
  ) {
    await this.logRefereeAction(
      matchId,
      req.user.id,
      'REFEREE_DISQUALIFY',
      body.reason,
      {
        teamId: body.teamId,
      },
    );
    this.gateway.emitAuditAppend(matchId, {
      action: 'REFEREE_DISQUALIFY',
      byUser: req.user.id,
      matchId,
      reason: body.reason,
      at: new Date().toISOString(),
    });
    return { ok: true };
  }

  @Post('referee/add-kill')
  async addKill(
    @Param('matchId') matchId: string,
    @Body() body: KillAdjustDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const delta = body.delta ?? 1;
    await this.logRefereeAction(
      matchId,
      req.user.id,
      'REFEREE_ADD_KILL',
      body.reason,
      {
        teamId: body.teamId,
        delta,
      },
    );
    this.gateway.emitAuditAppend(matchId, {
      action: 'REFEREE_ADD_KILL',
      byUser: req.user.id,
      matchId,
      reason: body.reason,
      at: new Date().toISOString(),
    });
    return { ok: true };
  }

  @Post('referee/edit-placement')
  async editPlacement(
    @Param('matchId') matchId: string,
    @Body() body: PlacementAdjustDto,
    @Req() req: AuthenticatedRequest,
  ) {
    await this.logRefereeAction(
      matchId,
      req.user.id,
      'REFEREE_EDIT_PLACEMENT',
      body.reason,
      {
        teamId: body.teamId,
        placement: body.placement ?? null,
      },
    );
    this.gateway.emitAuditAppend(matchId, {
      action: 'REFEREE_EDIT_PLACEMENT',
      byUser: req.user.id,
      matchId,
      reason: body.reason,
      at: new Date().toISOString(),
    });
    return { ok: true };
  }

  private async logRefereeAction(
    matchId: string,
    userId: string,
    action: string,
    reason: string,
    details: Record<string, unknown>,
  ) {
    await this.audit.log({
      organizationId: null,
      userId,
      action: AuditAction.MATCH_RESULT_EDIT,
      entityType: 'MATCH_REFEREE_ACTION',
      entityId: matchId,
      before: null,
      after: { action, ...details },
      source: 'SYSTEM',
      reason,
    });
  }
}
