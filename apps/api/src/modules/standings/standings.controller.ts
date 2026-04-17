import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import type { AuthenticatedRequest } from '../../common/auth/auth.types';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { StandingsService } from './standings.service';

@Controller('matches/:matchId/standings')
@UseGuards(JwtAuthGuard)
export class StandingsController {
  constructor(private readonly standings: StandingsService) {}

  @Get()
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.ORGANIZER, Role.REFEREE)
  async get(
    @Param('matchId') matchId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.standings.getStandings(matchId, req.user);
  }

  @Post('recompute')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.ORGANIZER, Role.REFEREE)
  async recompute(@Param('matchId') matchId: string) {
    return this.standings.computeMatchStandings(matchId);
  }

  @Post('lock')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.ORGANIZER, Role.REFEREE)
  async lock(
    @Param('matchId') matchId: string,
    @Body() body: { locked: boolean },
  ) {
    const locked = body?.locked === true;
    return this.standings.lockStandings(matchId, locked);
  }

  @Post('finalize')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.ORGANIZER, Role.REFEREE)
  async finalize(@Param('matchId') matchId: string) {
    return this.standings.finalizeStandings(matchId);
  }
}
