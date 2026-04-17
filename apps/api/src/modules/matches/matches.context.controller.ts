import { Controller, Get, Param, Req, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import type { AuthRequest } from '../../common/auth/auth.types';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { MatchesService } from './matches.service';

@Controller('api/matches')
@UseGuards(JwtAuthGuard)
@Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.ORGANIZER)
export class MatchesContextController {
  constructor(private matches: MatchesService) {}

  @Get(':matchId/context')
  getContext(@Param('matchId') matchId: string, @Req() req: AuthRequest) {
    return this.matches.getMatchContext(req.user, matchId);
  }

  @Get(':matchId/context-state')
  getState(@Param('matchId') matchId: string, @Req() req: AuthRequest) {
    return this.matches.getMatchState(req.user, matchId);
  }
}
