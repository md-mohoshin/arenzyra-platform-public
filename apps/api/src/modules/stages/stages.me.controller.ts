import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Put,
  Post,
  UseGuards,
  Req,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { Roles } from '../../common/auth/roles.decorator';
import type { CreateStageDto } from './dto/create-stage.dto';
import type { UpdateStageDto } from './dto/update-stage.dto';
import type { UpdateStageTeamsDto } from './dto/update-stage-teams.dto';
import { StagesService } from './stages.service';
import type { AuthenticatedRequest } from '../../common/auth/auth.types';

@Controller('me/tournaments/:tournamentId/stages')
@UseGuards(JwtAuthGuard)
@Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.ORGANIZER)
export class MeStagesController {
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

  @Post(':stageId/restore')
  restore(
    @Param('tournamentId') tournamentId: string,
    @Param('stageId') stageId: string,
  ) {
    return this.stages.restore(null, tournamentId, stageId);
  }
}

@Controller('org/me/tournaments/:tournamentId/stages')
@UseGuards(JwtAuthGuard)
@Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.ORGANIZER)
export class OrgMeStagesController {
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

  @Post(':stageId/restore')
  restore(
    @Param('tournamentId') tournamentId: string,
    @Param('stageId') stageId: string,
  ) {
    return this.stages.restore(null, tournamentId, stageId);
  }
}

@Controller('org/me/stages')
@UseGuards(JwtAuthGuard)
@Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.ORGANIZER)
export class OrgMeStageTeamsController {
  constructor(private stages: StagesService) {}

  @Get(':stageId/teams')
  listTeams(
    @Param('stageId') stageId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const orgId =
      req.user?.actingOrgId ??
      req.user?.organizationId ??
      req.user?.orgId ??
      null;
    return this.stages.listTeams(stageId, orgId);
  }

  @Put(':stageId/teams')
  setTeams(
    @Param('stageId') stageId: string,
    @Body() body: UpdateStageTeamsDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const orgId =
      req.user?.actingOrgId ??
      req.user?.organizationId ??
      req.user?.orgId ??
      null;
    const actorId = req.user?.actorId ?? req.user?.id ?? 'system';
    return this.stages.setTeams(
      stageId,
      orgId,
      body?.tournamentTeamIds ?? [],
      actorId,
    );
  }
}
