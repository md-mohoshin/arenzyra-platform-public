import { Controller, Get, Param, Query, Req } from '@nestjs/common';
import { ResultsService } from './results.service';
import { Public } from '../../common/auth/public.decorator';
import { PrismaService } from '../../db/prisma.service';
import type { Request } from 'express';
import { requireMatchOrganization } from '../../common/org/org.util';
import { MatchControlService } from '../match-control/match-control.service';

@Controller('public/matches/:matchId')
@Public()
export class WidgetsPublicController {
  constructor(
    private readonly results: ResultsService,
    private readonly prisma: PrismaService,
    private readonly matchControl: MatchControlService,
  ) {}

  @Get('control')
  async control(
    @Param('matchId') matchId: string,
    @Query('organizationId') organizationId?: string,
    @Req() req?: Request,
  ) {
    await requireMatchOrganization(this.prisma, matchId, {
      organizationId: organizationId ?? null,
      actor: (req as Request & { user?: unknown })?.user ?? null,
    });
    const lifecycle = await this.matchControl.getLifecycleState(matchId);
    return {
      matchId: lifecycle.matchId,
      status: lifecycle.controlStatus,
      matchStatus: lifecycle.status,
      lifecycleStatus: lifecycle.lifecycleStatus,
      controlStatus: lifecycle.controlStatus,
      liveState: lifecycle.liveState,
      updatedAt: lifecycle.updatedAt,
      startedAt: lifecycle.startedAt,
      endedAt: lifecycle.endedAt,
      isLocked: lifecycle.isLocked,
      isFinalizing: lifecycle.isFinalizing,
      resultFinalized: lifecycle.resultFinalized,
      resultNeedsConfirmation: lifecycle.resultNeedsConfirmation,
      resultAmbiguities: lifecycle.resultAmbiguities,
      finalizationStartedAt: lifecycle.finalizationStartedAt,
      finalizationDurationMs: lifecycle.finalizationDurationMs,
      telemetry: lifecycle.telemetry,
      binding: lifecycle.binding,
      locks: lifecycle.locks,
    };
  }

  @Get('results/slots')
  async listSlotResults(
    @Param('matchId') matchId: string,
    @Query('organizationId') organizationId?: string,
    @Req() req?: Request,
  ) {
    await requireMatchOrganization(this.prisma, matchId, {
      organizationId: organizationId ?? null,
      actor: (req as Request & { user?: unknown })?.user ?? null,
    });
    const slots = await this.results.listSlotResultsPublic(matchId);
    return { slots };
  }

  @Get('widgets/state')
  async widgetState(
    @Param('matchId') matchId: string,
    @Query('organizationId') organizationId?: string,
    @Req() req?: Request,
  ) {
    await requireMatchOrganization(this.prisma, matchId, {
      organizationId: organizationId ?? null,
      actor: (req as Request & { user?: unknown })?.user ?? null,
    });
    const state = await this.results.getWidgetStatePublic(matchId);
    return state;
  }
}
