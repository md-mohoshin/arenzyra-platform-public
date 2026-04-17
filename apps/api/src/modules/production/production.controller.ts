import {
  Body,
  Controller,
  Delete,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import type { AuthRequest } from '../../common/auth/auth.types';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { OrgScopeGuard } from '../../common/org/org-scope.guard';
import type { AdminAdjustmentDto, PcobBindDto } from './dto/adjustment.dto';
import { ProductionService } from './production.service';

@Controller('org/:orgId/production')
@UseGuards(JwtAuthGuard, OrgScopeGuard)
@Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.ORGANIZER)
export class ProductionController {
  constructor(private svc: ProductionService) {}

  @Post('matches/:matchId/start')
  startMatch(
    @Param('orgId') orgId: string,
    @Param('matchId') matchId: string,
    @Req() req: AuthRequest,
  ) {
    return this.svc.startMatch(orgId, matchId, req.user);
  }

  @Post('matches/:matchId/end')
  endMatch(
    @Param('orgId') orgId: string,
    @Param('matchId') matchId: string,
    @Req() req: AuthRequest,
  ) {
    return this.svc.endMatch(orgId, matchId, req.user);
  }

  @Post('matches/:matchId/publish-official')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  publishOfficial(
    @Param('orgId') orgId: string,
    @Param('matchId') matchId: string,
    @Req() req: AuthRequest,
  ) {
    return this.svc.publishOfficial(orgId, matchId, req.user.id, req.user);
  }

  @Post('matches/:matchId/reset')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  resetMatch(
    @Param('orgId') orgId: string,
    @Param('matchId') matchId: string,
    @Req() req: AuthRequest,
  ) {
    return this.svc.resetMatch(orgId, matchId, req.user);
  }

  @Post('tournaments/:tournamentId/adjustments')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  createAdjustment(
    @Param('orgId') orgId: string,
    @Param('tournamentId') tournamentId: string,
    @Body() body: AdminAdjustmentDto,
  ) {
    return this.svc.createAdjustment(orgId, tournamentId, body);
  }

  @Delete('adjustments/:adjustmentId')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  deleteAdjustment(
    @Param('orgId') orgId: string,
    @Param('adjustmentId') adjustmentId: string,
  ) {
    return this.svc.softDeleteAdjustment(orgId, adjustmentId);
  }

  @Post('adjustments/:adjustmentId/restore')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  restoreAdjustment(
    @Param('orgId') orgId: string,
    @Param('adjustmentId') adjustmentId: string,
  ) {
    return this.svc.restoreAdjustment(orgId, adjustmentId);
  }

  @Post('matches/:matchId/pcob/bind')
  bindPcob(
    @Param('orgId') orgId: string,
    @Param('matchId') matchId: string,
    @Body() { pcobSessionId }: PcobBindDto,
    @Req() req: AuthRequest,
  ) {
    return this.svc.bindPcob(orgId, matchId, pcobSessionId, req.user);
  }

  @Post('matches/:matchId/pcob/unbind')
  unbindPcob(
    @Param('orgId') orgId: string,
    @Param('matchId') matchId: string,
    @Req() req: AuthRequest,
  ) {
    return this.svc.unbindPcob(orgId, matchId, req.user);
  }
}
