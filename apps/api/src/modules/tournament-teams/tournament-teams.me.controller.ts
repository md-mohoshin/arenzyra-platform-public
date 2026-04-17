import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { Roles } from '../../common/auth/roles.decorator';
import type { AuthRequest } from '../../common/auth/auth.types';
import { TournamentTeamsService } from './tournament-teams.service';

@Controller('me/tournaments/:tournamentId/teams')
@UseGuards(JwtAuthGuard)
@Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.ORGANIZER)
export class MeTournamentTeamsController {
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

  @Post('assign-teams')
  assign(
    @Param('tournamentId') tournamentId: string,
    @Body('teamIds') teamIds: string[],
    @Req() req: AuthRequest,
  ) {
    return this.svc.assignTeams(tournamentId, teamIds ?? [], req.user);
  }
}

@Controller('org/me/tournaments/:tournamentId/teams')
@UseGuards(JwtAuthGuard)
@Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.ORGANIZER)
export class OrgMeTournamentTeamsController {
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

  @Post('assign-teams')
  assign(
    @Param('tournamentId') tournamentId: string,
    @Body('teamIds') teamIds: string[],
    @Req() req: AuthRequest,
  ) {
    return this.svc.assignTeams(tournamentId, teamIds ?? [], req.user);
  }
}
