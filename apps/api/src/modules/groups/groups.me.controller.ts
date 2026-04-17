import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
  Req,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { GroupsService } from './groups.service';
import { CreateGroupDto } from './dto/create-group.dto';
import { UpdateGroupDto } from './dto/update-group.dto';
import type { AuthenticatedRequest } from '../../common/auth/auth.types';

@Controller('me/stages/:stageId/groups')
@UseGuards(JwtAuthGuard)
@Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.ORGANIZER)
export class MeStageGroupsController {
  constructor(private groups: GroupsService) {}

  @Get()
  list(@Param('stageId') stageId: string) {
    return this.groups.list(null, stageId);
  }

  @Post()
  create(
    @Param('stageId') stageId: string,
    @Body() body: CreateGroupDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.groups.create(
      null,
      stageId,
      body,
      req.user?.actorId ?? req.user?.id ?? 'system',
    );
  }

  @Patch(':groupId')
  update(
    @Param('stageId') stageId: string,
    @Param('groupId') groupId: string,
    @Body() body: UpdateGroupDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.groups.update(
      null,
      stageId,
      groupId,
      body,
      req.user?.actorId ?? req.user?.id ?? 'system',
    );
  }

  @Delete(':groupId')
  remove(
    @Param('stageId') stageId: string,
    @Param('groupId') groupId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.groups.softDelete(
      null,
      stageId,
      groupId,
      req.user?.actorId ?? req.user?.id ?? 'system',
    );
  }

  @Post(':groupId/restore')
  restore(
    @Param('stageId') stageId: string,
    @Param('groupId') groupId: string,
  ) {
    return this.groups.restore(null, stageId, groupId);
  }
}

@Controller('me/groups/:groupId')
@UseGuards(JwtAuthGuard)
@Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.ORGANIZER)
export class MeGroupsContextController {
  constructor(private groups: GroupsService) {}

  @Get()
  get(@Param('groupId') groupId: string) {
    return this.groups.getOneByGroupId(null, groupId);
  }

  @Post('teams')
  addTeam(
    @Param('groupId') groupId: string,
    @Body('tournamentTeamId') tournamentTeamId: string,
  ) {
    return this.groups.addTournamentTeam(null, groupId, tournamentTeamId);
  }

  @Get('teams')
  listTeams(@Param('groupId') groupId: string) {
    return this.groups.listTeams(null, groupId);
  }

  @Delete('teams/:groupTeamId')
  removeGroupTeam(
    @Param('groupId') groupId: string,
    @Param('groupTeamId') groupTeamId: string,
  ) {
    return this.groups.removeTeam(null, groupId, groupTeamId);
  }
}

@Controller('org/me/stages/:stageId/groups')
@UseGuards(JwtAuthGuard)
@Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.ORGANIZER)
export class OrgMeStageGroupsController {
  constructor(private groups: GroupsService) {}

  @Get()
  list(@Param('stageId') stageId: string) {
    return this.groups.list(null, stageId);
  }

  @Post()
  create(
    @Param('stageId') stageId: string,
    @Body() body: CreateGroupDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.groups.create(
      null,
      stageId,
      body,
      req.user?.actorId ?? req.user?.id ?? 'system',
    );
  }

  @Patch(':groupId')
  update(
    @Param('stageId') stageId: string,
    @Param('groupId') groupId: string,
    @Body() body: UpdateGroupDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.groups.update(
      null,
      stageId,
      groupId,
      body,
      req.user?.actorId ?? req.user?.id ?? 'system',
    );
  }

  @Delete(':groupId')
  remove(
    @Param('stageId') stageId: string,
    @Param('groupId') groupId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.groups.softDelete(
      null,
      stageId,
      groupId,
      req.user?.actorId ?? req.user?.id ?? 'system',
    );
  }

  @Post(':groupId/restore')
  restore(
    @Param('stageId') stageId: string,
    @Param('groupId') groupId: string,
  ) {
    return this.groups.restore(null, stageId, groupId);
  }
}

@Controller('org/me/groups/:groupId')
@UseGuards(JwtAuthGuard)
@Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.ORGANIZER)
export class OrgMeGroupsContextController {
  constructor(private groups: GroupsService) {}

  @Get()
  get(@Param('groupId') groupId: string) {
    return this.groups.getOneByGroupId(null, groupId);
  }

  @Post('teams')
  addTeam(
    @Param('groupId') groupId: string,
    @Body('tournamentTeamId') tournamentTeamId: string,
  ) {
    return this.groups.addTournamentTeam(null, groupId, tournamentTeamId);
  }

  @Get('teams')
  listTeams(@Param('groupId') groupId: string) {
    return this.groups.listTeams(null, groupId);
  }

  @Delete('teams/:groupTeamId')
  removeGroupTeam(
    @Param('groupId') groupId: string,
    @Param('groupTeamId') groupTeamId: string,
  ) {
    return this.groups.removeTeam(null, groupId, groupTeamId);
  }
}
