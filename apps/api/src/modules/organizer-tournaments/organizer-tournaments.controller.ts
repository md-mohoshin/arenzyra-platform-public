import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Patch,
  Req,
  UseGuards,
  Query,
} from '@nestjs/common';
import { ForbiddenException } from '@nestjs/common';
import { Role } from '@prisma/client';
import type { AuthenticatedRequest } from '../../common/auth/auth.types';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { OrganizerTournamentsService } from './organizer-tournaments.service';
import { CreateOrganizerTournamentDto } from './dto/create-tournament.dto';
import { CreateOrganizerStageDto } from './dto/create-stage.dto';
import { CreateOrganizerGroupDto } from './dto/create-group.dto';
import { GenerateMatchesDto } from './dto/generate-matches.dto';

@Controller('organizer')
@UseGuards(JwtAuthGuard)
@Roles(Role.SUPER_ADMIN, Role.ORGANIZER)
export class OrganizerTournamentsController {
  constructor(private readonly svc: OrganizerTournamentsService) {}

  private requireScopedOrg(req: AuthenticatedRequest): string {
    const orgId = req.orgId ?? null;
    if (!orgId) {
      throw new ForbiddenException('Organization context missing');
    }
    return orgId;
  }

  @Post('tournaments')
  createTournament(
    @Body() dto: CreateOrganizerTournamentDto,
    @Req() req: AuthenticatedRequest,
  ) {
    this.requireScopedOrg(req);
    this.svc.requireOrganizerRole(req.user);
    return this.svc.createTournament(dto, req.user);
  }

  @Get('tournaments')
  list(
    @Req() req: AuthenticatedRequest,
    @Query('orgId') orgId?: string,
    @Query('deleted') deleted?: string,
  ) {
    this.requireScopedOrg(req);
    this.svc.requireOrganizerRole(req.user);
    return this.svc.list(req.user, orgId ?? null, deleted === 'true');
  }

  @Get('tournaments/:id')
  get(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    this.requireScopedOrg(req);
    this.svc.requireOrganizerRole(req.user);
    return this.svc.get(id, req.user);
  }

  @Get('tournaments/:id/stages')
  listStages(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    this.requireScopedOrg(req);
    this.svc.requireOrganizerRole(req.user);
    return this.svc.listStages(id, req.user);
  }

  @Patch('tournaments/:id')
  update(
    @Param('id') id: string,
    @Body() body: Record<string, any>,
    @Req() req: AuthenticatedRequest,
  ) {
    this.requireScopedOrg(req);
    this.svc.requireOrganizerRole(req.user);
    return this.svc.updateTournament(id, body, req.user);
  }

  @Post('tournaments/:id/restore')
  restore(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    this.requireScopedOrg(req);
    this.svc.requireOrganizerRole(req.user);
    return this.svc.restoreTournament(id, req.user);
  }

  @Post('stages')
  createStage(
    @Body() dto: CreateOrganizerStageDto,
    @Req() req: AuthenticatedRequest,
  ) {
    this.requireScopedOrg(req);
    this.svc.requireOrganizerRole(req.user);
    return this.svc.createStage(dto, req.user);
  }

  @Post('groups')
  createGroup(
    @Body() dto: CreateOrganizerGroupDto,
    @Req() req: AuthenticatedRequest,
  ) {
    this.requireScopedOrg(req);
    this.svc.requireOrganizerRole(req.user);
    return this.svc.createGroup(dto, req.user);
  }

  @Post('groups/:groupId/generate-matches')
  generateMatches(
    @Param('groupId') groupId: string,
    @Body() dto: GenerateMatchesDto,
    @Req() req: AuthenticatedRequest,
  ) {
    this.requireScopedOrg(req);
    this.svc.requireOrganizerRole(req.user);
    return this.svc.generateMatches(groupId, dto, req.user);
  }
}
