import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import type { AuthRequest } from '../../common/auth/auth.types';
import { Roles } from '../../common/auth/roles.decorator';
import { TournamentTeamsService } from './tournament-teams.service';
import type {
  AddTournamentTeamDto,
  UpdateTournamentTeamDto,
} from './dto/tournament-team.dto';

@Controller('tournaments/:tournamentId/teams')
@UseGuards(JwtAuthGuard)
@Roles(Role.ORGANIZER, Role.ADMIN)
export class TournamentTeamsApiController {
  constructor(private readonly svc: TournamentTeamsService) {}

  @Get()
  list(@Param('tournamentId') tournamentId: string, @Req() req: AuthRequest) {
    return this.svc.list(tournamentId, req.user);
  }

  @Post()
  add(
    @Param('tournamentId') tournamentId: string,
    @Body() body: AddTournamentTeamDto,
    @Req() req: AuthRequest,
  ) {
    return this.svc.addTeam(tournamentId, body, req.user);
  }

  @Patch(':tournamentTeamId')
  update(
    @Param('tournamentId') tournamentId: string,
    @Param('tournamentTeamId') tournamentTeamId: string,
    @Body() body: UpdateTournamentTeamDto,
    @Req() req: AuthRequest,
  ) {
    return this.svc.updateMapping(
      tournamentId,
      tournamentTeamId,
      req.user,
      body,
    );
  }

  @Delete(':tournamentTeamId')
  remove(
    @Param('tournamentId') tournamentId: string,
    @Param('tournamentTeamId') tournamentTeamId: string,
    @Req() req: AuthRequest,
  ) {
    return this.svc.removeTeam(tournamentId, tournamentTeamId, req.user);
  }
}
