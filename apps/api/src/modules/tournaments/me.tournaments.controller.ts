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
import { ForbiddenException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { Roles } from '../../common/auth/roles.decorator';
import type { AuthRequest } from '../../common/auth/auth.types';
import { TournamentsService } from './tournaments.service';
import type {
  TournamentCreateDto,
  TournamentDeleteDto,
  TournamentUpdateDto,
} from './dto/tournament.dto';

@Controller('me/tournaments')
@UseGuards(JwtAuthGuard)
@Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.ORGANIZER)
export class MeTournamentsController {
  constructor(private svc: TournamentsService) {}

  @Get()
  list(@Req() req: AuthRequest) {
    if (!req.orgId) {
      throw new ForbiddenException('Organization context missing');
    }
    return this.svc.listForActor(req.orgId, req.user);
  }

  @Post()
  create(@Body() body: TournamentCreateDto, @Req() req: AuthRequest) {
    if (!req.orgId) {
      throw new ForbiddenException('Organization context missing');
    }
    return this.svc.create(req.orgId, body, req.user);
  }

  @Get(':tournamentId')
  get(@Param('tournamentId') tournamentId: string, @Req() req: AuthRequest) {
    if (!req.orgId) {
      throw new ForbiddenException('Organization context missing');
    }
    return this.svc.findByActor(tournamentId, req.user);
  }

  @Patch(':tournamentId')
  update(
    @Param('tournamentId') id: string,
    @Body() body: TournamentUpdateDto,
    @Req() req: AuthRequest,
  ) {
    if (!req.orgId) {
      throw new ForbiddenException('Organization context missing');
    }
    return this.svc.update(id, body, req.user);
  }

  @Delete(':tournamentId')
  remove(
    @Param('tournamentId') id: string,
    @Body() body: TournamentDeleteDto,
    @Req() req: AuthRequest,
  ) {
    if (!req.orgId) {
      throw new ForbiddenException('Organization context missing');
    }
    return this.svc.deleteTournament(id, req.user, body);
  }
}
