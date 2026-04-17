import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { LiveSyncService } from './live-sync.service';
import { Body, Post, BadRequestException } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { Public } from '../../common/auth/public.decorator';

@Controller('api/matches/:matchId/overlay')
export class OverlayController {
  constructor(private readonly liveSync: LiveSyncService) {}

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
    @Body('liveTeamId') liveTeamId: string,
    @Body('managedTeamId') managedTeamId: string,
  ) {
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
    @Body('livePlayerId') livePlayerId: string,
    @Body('managedPlayerId') managedPlayerId: string,
  ) {
    if (!livePlayerId || !managedPlayerId) {
      throw new BadRequestException(
        'livePlayerId and managedPlayerId are required',
      );
    }
    await this.liveSync.mapPlayer(matchId, livePlayerId, managedPlayerId);
    return { ok: true };
  }
}
