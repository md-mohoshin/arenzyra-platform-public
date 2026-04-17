import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Put,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { OrgScopeGuard } from '../../common/org/org-scope.guard';
import { CreateStageDto } from './dto/create-stage.dto';
import { UpdateStageDto } from './dto/update-stage.dto';
import { UpdateStageTeamsDto } from './dto/update-stage-teams.dto';
import { StagesService } from './stages.service';
import type { AuthenticatedRequest } from '../../common/auth/auth.types';

@Controller('org/:orgId/tournaments/:tournamentId/stages')
@UseGuards(JwtAuthGuard, OrgScopeGuard)
@Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.ORGANIZER)
export class StagesController {
  constructor(private stages: StagesService) {}

  @Get()
  list(
    @Param('orgId') orgId: string,
    @Param('tournamentId') tournamentId: string,
  ) {
    return this.stages.list(orgId, tournamentId);
  }

  @Post()
  create(
    @Param('orgId') orgId: string,
    @Param('tournamentId') tournamentId: string,
    @Body() body: CreateStageDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.stages.create(orgId, tournamentId, body, req.user);
  }

  @Patch(':stageId')
  update(
    @Param('orgId') orgId: string,
    @Param('tournamentId') tournamentId: string,
    @Param('stageId') stageId: string,
    @Body() body: UpdateStageDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.stages.update(orgId, tournamentId, stageId, body, req.user);
  }

  @Delete(':stageId')
  remove(
    @Param('orgId') orgId: string,
    @Param('tournamentId') tournamentId: string,
    @Param('stageId') stageId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.stages.softDelete(
      orgId,
      tournamentId,
      stageId,
      req.user?.actorId ?? req.user?.id ?? 'system',
    );
  }
}

@Controller('tournaments/:tournamentId/stages')
@UseGuards(JwtAuthGuard)
@Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.ORGANIZER)
export class TournamentStagesController {
  constructor(private stages: StagesService) {}

  @Get()
  list(@Param('tournamentId') tournamentId: string) {
    return this.stages.list(null, tournamentId);
  }

  @Post()
  create(
    @Param('tournamentId') tournamentId: string,
    @Body() body: CreateStageDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.stages.create(null, tournamentId, body, req.user);
  }

  @Patch(':stageId')
  update(
    @Param('tournamentId') tournamentId: string,
    @Param('stageId') stageId: string,
    @Body() body: UpdateStageDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.stages.update(null, tournamentId, stageId, body, req.user);
  }

  @Delete(':stageId')
  remove(
    @Param('tournamentId') tournamentId: string,
    @Param('stageId') stageId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.stages.softDelete(
      null,
      tournamentId,
      stageId,
      req.user?.actorId ?? req.user?.id ?? 'system',
    );
  }
}

@Controller('org/:orgId/stages')
@UseGuards(JwtAuthGuard, OrgScopeGuard)
@Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.ORGANIZER)
export class OrgStagesController {
  constructor(private stages: StagesService) {}

  @Patch(':stageId')
  update(
    @Param('orgId') orgId: string,
    @Param('stageId') stageId: string,
    @Body() body: UpdateStageDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.stages.update(orgId, null, stageId, body, req.user);
  }

  @Delete(':stageId')
  remove(
    @Param('orgId') orgId: string,
    @Param('stageId') stageId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.stages.softDelete(
      orgId,
      null,
      stageId,
      req.user?.actorId ?? req.user?.id ?? 'system',
    );
  }
}

@Controller('org/:orgId/stages')
@UseGuards(JwtAuthGuard, OrgScopeGuard)
@Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.ORGANIZER)
export class OrgStageTeamsController {
  constructor(private stages: StagesService) {}

  @Get(':stageId/teams')
  listTeams(@Param('orgId') orgId: string, @Param('stageId') stageId: string) {
    return this.stages.listTeams(stageId, orgId);
  }

  @Put(':stageId/teams')
  setTeams(
    @Param('orgId') orgId: string,
    @Param('stageId') stageId: string,
    @Body() body: UpdateStageTeamsDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.stages.setTeams(
      stageId,
      orgId,
      body?.tournamentTeamIds ?? [],
      req.user?.actorId ?? req.user?.id ?? 'system',
    );
  }
}
