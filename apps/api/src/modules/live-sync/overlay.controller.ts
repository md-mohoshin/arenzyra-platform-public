import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { LiveSyncService } from './live-sync.service';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import type { AuthenticatedRequest } from '../../common/auth/auth.types';
import { Public } from '../../common/auth/public.decorator';
import { PrismaService } from '../../db/prisma.service';
import { requireMatchOrganization } from '../../common/org/org.util';

@Controller('api/matches/:matchId/overlay')
export class OverlayController {
  constructor(
    private readonly liveSync: LiveSyncService,
    private readonly prisma: PrismaService,
  ) {}

  private async authorizeOverlayMutation(
    matchId: string,
    req: AuthenticatedRequest,
  ) {
    const actor = req.user;
    const allowedRoles = new Set<Role>([
      Role.SUPER_ADMIN,
      Role.ADMIN,
      Role.ORGANIZER,
    ]);
    const candidateRoles = [
      actor?.role,
      actor?.actorRole,
      actor?.actingRole,
      actor?.realRole,
    ].filter((role): role is Role => Boolean(role));

    if (!candidateRoles.some((role) => allowedRoles.has(role))) {
      throw new ForbiddenException('Access denied');
    }

    await requireMatchOrganization(this.prisma, matchId, { actor });
  }

  @Get('teams')
  @Public()
  getTeams(@Param('matchId') matchId: string) {
    const snapshot = this.liveSync.getSnapshot(matchId);
    return {
      ok: true,
      teams: snapshot?.teams ?? [],
    };
  }

  @Get('players')
  @Public()
  getPlayers(@Param('matchId') matchId: string) {
    const snapshot = this.liveSync.getSnapshot(matchId);
    return {
      ok: true,
      players: snapshot?.players ?? [],
    };
  }

  @Get('state')
  @Public()
  getState(@Param('matchId') matchId: string) {
    const snapshot = this.liveSync.getSnapshot(matchId);
    return {
      ok: true,
      state: snapshot,
    };
  }

  @Post('map/team')
  @UseGuards(JwtAuthGuard)
  async mapTeam(
    @Param('matchId') matchId: string,
    @Req() req: AuthenticatedRequest,
    @Body('liveTeamId') liveTeamId: string,
    @Body('managedTeamId') managedTeamId: string,
  ) {
    await this.authorizeOverlayMutation(matchId, req);
    if (!liveTeamId || !managedTeamId) {
      throw new BadRequestException(
        'liveTeamId and managedTeamId are required',
      );
    }
    await this.liveSync.mapTeam(matchId, liveTeamId, managedTeamId);
    return { ok: true };
  }

  @Post('map/player')
  @UseGuards(JwtAuthGuard)
  async mapPlayer(
    @Param('matchId') matchId: string,
    @Req() req: AuthenticatedRequest,
    @Body('livePlayerId') livePlayerId: string,
    @Body('managedPlayerId') managedPlayerId: string,
  ) {
    await this.authorizeOverlayMutation(matchId, req);
    if (!livePlayerId || !managedPlayerId) {
      throw new BadRequestException(
        'livePlayerId and managedPlayerId are required',
      );
    }
    await this.liveSync.mapPlayer(matchId, livePlayerId, managedPlayerId);
    return { ok: true };
  }
}
