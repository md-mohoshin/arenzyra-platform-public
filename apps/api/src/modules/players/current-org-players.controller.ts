import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { Roles } from '../../common/auth/roles.decorator';
import type { AuthenticatedRequest } from '../../common/auth/auth.types';
import { PlayersService, type PlayerBody } from './players.service';

@Controller('players')
@UseGuards(JwtAuthGuard)
@Roles(Role.SUPER_ADMIN, Role.ORGANIZER)
export class CurrentOrgPlayersController {
  constructor(private readonly players: PlayersService) {}

  private requireOrg(req: AuthenticatedRequest): string {
    const orgId = req.orgId ?? null;
    if (!orgId) {
      throw new BadRequestException('Organization context missing');
    }
    return orgId;
  }

  @Post()
  create(@Body() body: PlayerBody, @Req() req: AuthenticatedRequest) {
    const orgId = this.requireOrg(req);
    return this.players.create(orgId, body, req.user);
  }

  @Patch(':playerId')
  update(
    @Param('playerId') playerId: string,
    @Body() body: PlayerBody,
    @Req() req: AuthenticatedRequest,
  ) {
    const orgId = this.requireOrg(req);
    return this.players.update(orgId, playerId, body, req.user);
  }

  @Delete(':playerId')
  remove(
    @Param('playerId') playerId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const orgId = this.requireOrg(req);
    return this.players.softDelete(orgId, playerId, req.user);
  }
}
