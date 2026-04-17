import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { Roles } from '../../common/auth/roles.decorator';
import {
  TournamentPlayersService,
  type TournamentPlayerBody,
} from './tournament-players.service';

@Controller('tournament-teams/:tournamentTeamId/players')
@UseGuards(JwtAuthGuard)
@Roles(Role.ADMIN, Role.ORGANIZER, Role.SUPER_ADMIN)
export class TournamentPlayersController {
  constructor(private tournamentPlayers: TournamentPlayersService) {}

  @Get()
  list(@Param('tournamentTeamId') tournamentTeamId: string) {
    return this.tournamentPlayers.list(tournamentTeamId);
  }

  @Post()
  create(
    @Param('tournamentTeamId') tournamentTeamId: string,
    @Body() body: TournamentPlayerBody,
  ) {
    return this.tournamentPlayers.create(tournamentTeamId, body);
  }

  @Delete(':tournamentPlayerId')
  delete(
    @Param('tournamentTeamId') tournamentTeamId: string,
    @Param('tournamentPlayerId') tournamentPlayerId: string,
  ) {
    return this.tournamentPlayers.softDelete(
      tournamentTeamId,
      tournamentPlayerId,
    );
  }
}
