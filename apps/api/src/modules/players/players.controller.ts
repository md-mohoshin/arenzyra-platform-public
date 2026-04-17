import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
  Req,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { OrgScopeGuard } from '../../common/org/org-scope.guard';
import { PlayersService } from './players.service';
import type { PlayerBody } from './players.service';
import type { AuthRequest } from '../../common/auth/auth.types';

@Controller('org/:orgId/players')
@UseGuards(JwtAuthGuard, OrgScopeGuard)
@Roles(Role.ADMIN, Role.ORGANIZER, Role.SUPER_ADMIN)
export class PlayersController {
  constructor(private players: PlayersService) {}

  @Get()
  list(@Param('orgId') orgId: string, @Req() req: AuthRequest) {
    return this.players.list(orgId, req.user);
  }

  @Post()
  create(
    @Param('orgId') orgId: string,
    @Body() body: PlayerBody,
    @Req() req: AuthRequest,
  ) {
    return this.players.create(orgId, body, req.user);
  }

  @Patch(':playerId')
  update(
    @Param('orgId') orgId: string,
    @Param('playerId') playerId: string,
    @Body() body: PlayerBody,
    @Req() req: AuthRequest,
  ) {
    return this.players.update(orgId, playerId, body, req.user);
  }

  @Delete(':playerId')
  delete(
    @Param('orgId') orgId: string,
    @Param('playerId') playerId: string,
    @Req() req: AuthRequest,
  ) {
    return this.players.softDelete(orgId, playerId, req.user);
  }

  @Post(':playerId/restore')
  restore(
    @Param('orgId') orgId: string,
    @Param('playerId') playerId: string,
    @Req() req: AuthRequest,
  ) {
    return this.players.restore(orgId, playerId, req.user);
  }
}
