import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ForbiddenException } from '@nestjs/common';
import { Role } from '@prisma/client';
import type { Response } from 'express';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { Roles } from '../../common/auth/roles.decorator';
import type { AuthRequest } from '../../common/auth/auth.types';
import { OrgScopeGuard } from '../../common/org/org-scope.guard';
import { TournamentsService } from './tournaments.service';
import type {
  TournamentCreateDto,
  TournamentDeleteDto,
  TournamentHardDeleteDto,
  TournamentUpdateDto,
} from './dto/tournament.dto';

@Controller('org/:orgId/tournaments')
@UseGuards(JwtAuthGuard, OrgScopeGuard)
@Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.ORGANIZER)
export class TournamentsController {
  constructor(private svc: TournamentsService) {}

  @Get()
  list(@Req() req: AuthRequest) {
    const orgIdParam = req.params?.orgId;
    const routeOrgId = Array.isArray(orgIdParam)
      ? orgIdParam[0]
      : (orgIdParam ?? null);
    const orgId = req.orgId ?? routeOrgId ?? null;
    if (!orgId) {
      throw new ForbiddenException('Organization context missing');
    }
    return this.svc.listForActor(orgId, req.user);
  }

  @Get(':tournamentId')
  get(@Param('tournamentId') tournamentId: string, @Req() req: AuthRequest) {
    return this.svc.findByActor(tournamentId, req.user);
  }

  @Post()
  create(
    @Param('orgId') orgId: string,
    @Body() body: TournamentCreateDto,
    @Req() req: AuthRequest,
  ) {
    const scopedOrgId = req.orgId ?? orgId ?? null;
    if (!scopedOrgId) {
      throw new ForbiddenException('Organization context missing');
    }
    return this.svc.create(scopedOrgId, body, req.user);
  }

  @Patch(':tournamentId')
  update(
    @Param('tournamentId') id: string,
    @Body() body: TournamentUpdateDto,
    @Req() req: AuthRequest,
  ) {
    return this.svc.update(id, body, req.user);
  }

  @Delete(':tournamentId')
  remove(
    @Param('orgId') orgId: string,
    @Param('tournamentId') id: string,
    @Body() body: TournamentDeleteDto,
    @Req() req: AuthRequest,
  ) {
    return this.svc.deleteTournament(id, req.user, body, orgId);
  }

  @Delete(':tournamentId/hard')
  @Delete(':tournamentId/hard-delete')
  hardDelete(
    @Param('tournamentId') id: string,
    @Body() body: TournamentHardDeleteDto,
    @Req() req: AuthRequest,
  ) {
    return this.svc.hardDeleteTournament(id, req.user, body);
  }

  @Get(':tournamentId/liquipedia')
  async exportLiquipedia(
    @Param('tournamentId') tournamentId: string,
    @Query('format') format: string | string[] = 'json',
    @Res() res: Response,
  ) {
    const fmt = Array.isArray(format) ? format[0] : (format ?? 'json');
    const data = await this.svc.buildLiquipediaExport('', tournamentId);

    if (fmt === 'csv') {
      const csv = await this.svc.toLiquipediaCsv('', tournamentId);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader(
        'Content-Disposition',
        'attachment; filename=liquipedia.csv',
      );
      return res.send(csv);
    }

    return res.json(data);
  }
}
