import {
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
  Req,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { OrgScopeGuard } from '../../common/org/org-scope.guard';
import type { AuthRequest } from '../../common/auth/auth.types';
import { TournamentTeamsService } from './tournament-teams.service';

@Controller('org/:orgId/tournaments/:tournamentId/teams')
@UseGuards(JwtAuthGuard, OrgScopeGuard)
@Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.ORGANIZER)
export class TournamentTeamsController {
  constructor(private svc: TournamentTeamsService) {}

  @Get()
  list(@Param('tournamentId') tournamentId: string, @Req() req: AuthRequest) {
    return this.svc.list(tournamentId, req.user);
  }

  @Post(':teamId')
  add(
    @Param('tournamentId') tournamentId: string,
    @Param('teamId') teamId: string,
    @Req() req: AuthRequest,
  ) {
    return this.svc.addTeam(tournamentId, { teamId }, req.user);
  }

  @Delete(':teamId')
  remove(
    @Param('tournamentId') tournamentId: string,
    @Param('teamId') teamId: string,
    @Req() req: AuthRequest,
  ) {
    return this.svc.removeTeam(tournamentId, teamId, req.user);
  }
}
