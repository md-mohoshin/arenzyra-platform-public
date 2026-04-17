import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  UseGuards,
  Req,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { OrgScopeGuard } from '../../common/org/org-scope.guard';
import { GroupsService } from './groups.service';
import { CreateGroupDto } from './dto/create-group.dto';
import { UpdateGroupDto } from './dto/update-group.dto';
import type { AuthenticatedRequest } from '../../common/auth/auth.types';

@Controller('org/:orgId/stages/:stageId/groups')
@UseGuards(JwtAuthGuard, OrgScopeGuard)
@Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.ORGANIZER)
export class GroupsController {
  constructor(private groups: GroupsService) {}

  @Get()
  list(@Param('orgId') orgId: string, @Param('stageId') stageId: string) {
    return this.groups.list(orgId, stageId);
  }

  @Get(':groupId')
  getOne(
    @Param('orgId') orgId: string,
    @Param('stageId') stageId: string,
    @Param('groupId') groupId: string,
  ) {
    return this.groups.getOne(orgId, stageId, groupId);
  }

  @Post()
  create(
    @Param('orgId') orgId: string,
    @Param('stageId') stageId: string,
    @Body() body: CreateGroupDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.groups.create(
      orgId,
      stageId,
      body,
      req.user?.actorId ?? req.user?.id ?? 'system',
    );
  }

  @Patch(':groupId')
  update(
    @Param('orgId') orgId: string,
    @Param('stageId') stageId: string,
    @Param('groupId') groupId: string,
    @Body() body: UpdateGroupDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.groups.update(
      orgId,
      stageId,
      groupId,
      body,
      req.user?.actorId ?? req.user?.id ?? 'system',
    );
  }

  @Delete(':groupId')
  remove(
    @Param('orgId') orgId: string,
    @Param('stageId') stageId: string,
    @Param('groupId') groupId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.groups.softDelete(
      orgId,
      stageId,
      groupId,
      req.user?.actorId ?? req.user?.id ?? 'system',
    );
  }

  @Post(':groupId/restore')
  restore(
    @Param('orgId') orgId: string,
    @Param('stageId') stageId: string,
    @Param('groupId') groupId: string,
  ) {
    return this.groups.restore(orgId, stageId, groupId);
  }
}

@Controller('org/:orgId/groups')
@UseGuards(JwtAuthGuard, OrgScopeGuard)
@Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.ORGANIZER)
export class GroupTeamsController {
  constructor(private groups: GroupsService) {}

  @Get(':groupId')
  getGroup(@Param('orgId') orgId: string, @Param('groupId') groupId: string) {
    return this.groups.getOneByGroupId(orgId, groupId);
  }

  @Get(':groupId/teams')
  listTeams(@Param('orgId') orgId: string, @Param('groupId') groupId: string) {
    return this.groups.listTeams(orgId, groupId);
  }

  @Post(':groupId/teams')
  addTeams(
    @Param('orgId') orgId: string,
    @Param('groupId') groupId: string,
    @Body('tournamentTeamId') tournamentTeamId: string,
  ) {
    return this.groups.addTournamentTeam(orgId, groupId, tournamentTeamId);
  }

  @Delete(':groupId/teams/:groupTeamId')
  removeTeam(
    @Param('orgId') orgId: string,
    @Param('groupId') groupId: string,
    @Param('groupTeamId') groupTeamId: string,
  ) {
    return this.groups.removeTeam(orgId, groupId, groupTeamId);
  }

  @Put(':groupId/teams')
  replaceTeams(
    @Param('orgId') orgId: string,
    @Param('groupId') groupId: string,
    @Body('teamIds') teamIds: string[],
    @Req() req: AuthenticatedRequest,
  ) {
    return this.groups.replaceTeams(
      orgId,
      groupId,
      Array.isArray(teamIds) ? teamIds : [],
      req.user?.actorId ?? req.user?.id ?? 'system',
    );
  }
}
