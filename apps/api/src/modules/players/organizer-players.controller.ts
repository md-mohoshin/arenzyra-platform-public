import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { Role } from '@prisma/client';
import type { AuthenticatedRequest } from '../../common/auth/auth.types';
import { PlayersService, type PlayerBody } from './players.service';
import { FileInterceptor } from '@nestjs/platform-express';
import { storePlayerPhoto } from '../teams/asset.util';

@Controller('organizer')
@UseGuards(JwtAuthGuard)
@Roles(Role.SUPER_ADMIN, Role.ORGANIZER)
export class OrganizerPlayersController {
  constructor(private readonly players: PlayersService) {}

  private requireOrg(req: AuthenticatedRequest): string {
    const orgId = req.orgId ?? null;
    if (!orgId) {
      throw new BadRequestException('Organization context missing');
    }
    return orgId;
  }

  @Get('teams/:teamId/players')
  listForTeam(
    @Param('teamId') teamId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const orgId = this.requireOrg(req);
    return this.players.listByTeam(orgId, teamId, req.user);
  }

  @Post('teams/:teamId/players')
  createForTeam(
    @Param('teamId') teamId: string,
    @Body() body: PlayerBody,
    @Req() req: AuthenticatedRequest,
  ) {
    const orgId = this.requireOrg(req);
    return this.players.create(orgId, { ...body, teamId }, req.user);
  }

  @Patch('players/:playerId')
  updatePlayer(
    @Param('playerId') playerId: string,
    @Body() body: PlayerBody,
    @Req() req: AuthenticatedRequest,
  ) {
    const orgId = this.requireOrg(req);
    return this.players.update(orgId, playerId, body, req.user);
  }

  @Delete('players/:playerId')
  deletePlayer(
    @Param('playerId') playerId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const orgId = this.requireOrg(req);
    return this.players.softDelete(orgId, playerId, req.user);
  }

  @Post('players/:playerId/photo')
  @UseInterceptors(FileInterceptor('file'))
  async uploadPhoto(
    @Param('playerId') playerId: string,
    @UploadedFile() file: { mimetype?: string; buffer: Buffer },
    @Req() req: AuthenticatedRequest,
  ) {
    this.requireOrg(req);
    if (!file) throw new BadRequestException('File is required');
    const allowed = ['image/png', 'image/jpeg', 'image/webp'];
    const mimetype = file.mimetype;
    if (!mimetype || !allowed.includes(mimetype)) {
      throw new BadRequestException('Invalid file type');
    }
    const { url, version } = storePlayerPhoto(playerId, file);
    await this.players.update(
      req.orgId ?? '',
      playerId,
      { photoUrl: url },
      req.user,
    );
    return { ok: true, photoUrl: url, version };
  }
}
