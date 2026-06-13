import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import type { AuthRequest } from '../../common/auth/auth.types';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { OrgScopeGuard } from '../../common/org/org-scope.guard';
import type { AdminAdjustmentDto, PcobBindDto } from './dto/adjustment.dto';
import {
  CreateProductionDiscordSetDto,
  ImportProductionDiscordSlotsDto,
  UpdateProductionDiscordConfigDto,
  UpsertProductionDiscordTeamDto,
} from './dto/production-discord.dto';
import { ProductionService } from './production.service';

@Controller('org/:orgId/production')
@UseGuards(JwtAuthGuard, OrgScopeGuard)
@Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.ORGANIZER)
export class ProductionController {
  constructor(private svc: ProductionService) {}

  @Get('discord-config')
  getDiscordConfig(@Param('orgId') orgId: string, @Req() req: AuthRequest) {
    return this.svc.getProductionDiscordConfig(orgId, req.user);
  }

  @Patch('discord-config')
  updateDiscordConfig(
    @Param('orgId') orgId: string,
    @Body() body: UpdateProductionDiscordConfigDto,
    @Req() req: AuthRequest,
  ) {
    return this.svc.updateProductionDiscordConfig(orgId, body, req.user);
  }

  @Post('discord-config/sets')
  createDiscordSet(
    @Param('orgId') orgId: string,
    @Body() body: CreateProductionDiscordSetDto,
    @Req() req: AuthRequest,
  ) {
    return this.svc.createProductionDiscordSet(orgId, body, req.user);
  }

  @Delete('discord-config/sets/:setKey')
  deleteDiscordSet(
    @Param('orgId') orgId: string,
    @Param('setKey') setKey: string,
    @Req() req: AuthRequest,
  ) {
    return this.svc.deleteProductionDiscordSet(orgId, setKey, req.user);
  }

  @Post('discord/import-slots')
  importDiscordSlots(
    @Param('orgId') orgId: string,
    @Body() body: ImportProductionDiscordSlotsDto,
    @Req() req: AuthRequest,
  ) {
    return this.svc.importProductionDiscordSlots(orgId, body, req.user);
  }

  @Post('discord/teams')
  upsertDiscordTeam(
    @Param('orgId') orgId: string,
    @Body() body: UpsertProductionDiscordTeamDto,
    @Req() req: AuthRequest,
  ) {
    return this.svc.upsertProductionDiscordTeam(orgId, body, req.user);
  }

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

@Controller('production/discord')
@UseGuards(JwtAuthGuard)
@Roles(Role.SUPER_ADMIN, Role.ORGANIZER)
export class ProductionDiscordController {
  constructor(private svc: ProductionService) {}

  @Get('resolve-channel')
  resolveChannel(
    @Query('guildId') guildId: string,
    @Query('channelId') channelId: string,
    @Req() req: AuthRequest,
  ) {
    return this.svc.resolveProductionDiscordChannel({
      guildId,
      channelId,
      actor: {
        ...req.user,
        serviceToken: req.isServiceToken === true || req.user.serviceToken,
      },
    });
  }
}
