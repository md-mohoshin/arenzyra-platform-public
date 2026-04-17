import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Patch,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import type { AuthRequest } from '../../common/auth/auth.types';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateOrganizationDto } from './dto/update-organization.dto';
import { PlatformAdminService } from './platform-admin.service';

@Controller('platform')
@UseGuards(JwtAuthGuard)
@Roles(Role.SUPER_ADMIN)
export class PlatformAdminController {
  constructor(private svc: PlatformAdminService) {}

  // ---- ORGS ----
  @Post('orgs')
  createOrg(@Body() dto: CreateOrganizationDto) {
    return this.svc.createOrg(dto);
  }

  @Get('orgs')
  listOrgs() {
    return this.svc.listOrgs();
  }

  @Patch('orgs/:orgId')
  updateOrg(@Param('orgId') orgId: string, @Body() dto: UpdateOrganizationDto) {
    return this.svc.updateOrg(orgId, dto);
  }

  @Delete('orgs/:orgId')
  deleteOrg(@Param('orgId') orgId: string) {
    return this.svc.softDeleteOrg(orgId);
  }

  @Delete('orgs/:orgId/hard-delete')
  hardDeleteOrg(@Param('orgId') orgId: string) {
    return this.svc.hardDeleteOrg(orgId);
  }

  @Post('orgs/:orgId/restore')
  restoreOrg(@Param('orgId') orgId: string) {
    return this.svc.restoreOrg(orgId);
  }

  @Post('orgs/recreate')
  recreateOrg(@Body() dto: CreateOrganizationDto) {
    return this.svc.recreateOrg(dto);
  }

  // ---- USERS ----
  @Post('users')
  createUser(@Body() dto: CreateUserDto, @Req() req: AuthRequest) {
    return this.svc.createUser(dto, req.user);
  }

  @Get('users')
  listUsers() {
    return this.svc.listUsers();
  }

  @Delete('users/:userId')
  deleteUser(@Param('userId') userId: string) {
    return this.svc.softDeleteUser(userId);
  }

  @Post('users/:userId/restore')
  restoreUser(@Param('userId') userId: string) {
    return this.svc.restoreUser(userId);
  }

  // ---- ADMIN ORG ASSIGNMENT ----
  @Post('admins/:adminId/assign/:orgId')
  assignAdmin(
    @Param('adminId') adminId: string,
    @Param('orgId') orgId: string,
  ) {
    return this.svc.assignAdminToOrg(adminId, orgId);
  }

  @Post('admins/:adminId/unassign/:orgId')
  unassignAdmin(
    @Param('adminId') adminId: string,
    @Param('orgId') orgId: string,
  ) {
    return this.svc.unassignAdminFromOrg(adminId, orgId);
  }
}
