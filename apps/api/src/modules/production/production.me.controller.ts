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
import type { AdminAdjustmentDto, PcobBindDto } from './dto/adjustment.dto';
import { ProductionService } from './production.service';

@Controller('me/production')
@UseGuards(JwtAuthGuard)
@Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.ORGANIZER)
export class MeProductionController {
  constructor(private svc: ProductionService) {}

  @Post('matches/:matchId/start')
  startMatch(@Param('matchId') matchId: string, @Req() req: AuthRequest) {
    return this.svc.startMatch(null, matchId, req.user);
  }

  @Post('matches/:matchId/end')
  endMatch(@Param('matchId') matchId: string, @Req() req: AuthRequest) {
    return this.svc.endMatch(null, matchId, req.user);
  }

  @Post('matches/:matchId/publish-official')
  publishOfficial(@Param('matchId') matchId: string, @Req() req: AuthRequest) {
    return this.svc.publishOfficial(null, matchId, req.user.id, req.user);
  }

  @Post('matches/:matchId/reset')
  resetMatch(@Param('matchId') matchId: string, @Req() req: AuthRequest) {
    return this.svc.resetMatch(null, matchId, req.user);
  }

  @Post('tournaments/:tournamentId/adjustments')
  createAdjustment(
    @Param('tournamentId') tournamentId: string,
    @Body() body: AdminAdjustmentDto,
  ) {
    return this.svc.createAdjustment(null, tournamentId, body);
  }

  @Delete('adjustments/:adjustmentId')
  deleteAdjustment(@Param('adjustmentId') adjustmentId: string) {
    return this.svc.softDeleteAdjustment(null, adjustmentId);
  }

  @Post('adjustments/:adjustmentId/restore')
  restoreAdjustment(@Param('adjustmentId') adjustmentId: string) {
    return this.svc.restoreAdjustment(null, adjustmentId);
  }

  @Post('matches/:matchId/pcob/bind')
  bindPcob(
    @Param('matchId') matchId: string,
    @Body() { pcobSessionId }: PcobBindDto,
    @Req() req: AuthRequest,
  ) {
    return this.svc.bindPcob(null, matchId, pcobSessionId, req.user);
  }

  @Post('matches/:matchId/pcob/unbind')
  unbindPcob(@Param('matchId') matchId: string, @Req() req: AuthRequest) {
    return this.svc.unbindPcob(null, matchId, req.user);
  }
}

@Controller('org/me/production')
@UseGuards(JwtAuthGuard)
@Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.ORGANIZER)
export class OrgMeProductionController {
  constructor(private svc: ProductionService) {}

  @Post('matches/:matchId/start')
  startMatch(@Param('matchId') matchId: string, @Req() req: AuthRequest) {
    return this.svc.startMatch(null, matchId, req.user);
  }

  @Post('matches/:matchId/end')
  endMatch(@Param('matchId') matchId: string, @Req() req: AuthRequest) {
    return this.svc.endMatch(null, matchId, req.user);
  }

  @Post('matches/:matchId/publish-official')
  publishOfficial(@Param('matchId') matchId: string, @Req() req: AuthRequest) {
    return this.svc.publishOfficial(null, matchId, req.user.id, req.user);
  }

  @Post('matches/:matchId/reset')
  resetMatch(@Param('matchId') matchId: string, @Req() req: AuthRequest) {
    return this.svc.resetMatch(null, matchId, req.user);
  }

  @Post('tournaments/:tournamentId/adjustments')
  createAdjustment(
    @Param('tournamentId') tournamentId: string,
    @Body() body: AdminAdjustmentDto,
  ) {
    return this.svc.createAdjustment(null, tournamentId, body);
  }

  @Delete('adjustments/:adjustmentId')
  deleteAdjustment(@Param('adjustmentId') adjustmentId: string) {
    return this.svc.softDeleteAdjustment(null, adjustmentId);
  }

  @Post('adjustments/:adjustmentId/restore')
  restoreAdjustment(@Param('adjustmentId') adjustmentId: string) {
    return this.svc.restoreAdjustment(null, adjustmentId);
  }

  @Post('matches/:matchId/pcob/bind')
  bindPcob(
    @Param('matchId') matchId: string,
    @Body() { pcobSessionId }: PcobBindDto,
    @Req() req: AuthRequest,
  ) {
    return this.svc.bindPcob(null, matchId, pcobSessionId, req.user);
  }

  @Post('matches/:matchId/pcob/unbind')
  unbindPcob(@Param('matchId') matchId: string, @Req() req: AuthRequest) {
    return this.svc.unbindPcob(null, matchId, req.user);
  }
}
