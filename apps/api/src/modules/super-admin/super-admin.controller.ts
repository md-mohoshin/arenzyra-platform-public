import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Delete,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  FeatureKey,
  PayoutStatus,
  ReportStatus,
  Role,
  UserStatus,
  Role as PrismaRole,
} from '@prisma/client';
import type { AuthRequest } from '../../common/auth/auth.types';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { SuperAdminService } from './super-admin.service';
import { UpdateFlagsDto } from './dto/update-flags.dto';
import { AdjustWalletDto } from './dto/adjust-wallet.dto';
import { ChangeRoleDto } from './dto/change-role.dto';
import { BanUserDto } from './dto/ban-user.dto';
import { ResolveReportDto } from './dto/resolve-report.dto';
import { BroadcastDto } from './dto/broadcast.dto';
import { ReasonDto } from './dto/reason.dto';
import { UpdateOrgConfigDto } from './dto/update-org-config.dto';
import { CreateManagedUserDto } from './dto/create-managed-user.dto';
import { UpdateManagedUserDto } from './dto/update-managed-user.dto';

@Controller('super')
@UseGuards(JwtAuthGuard)
@Roles(Role.SUPER_ADMIN)
export class SuperAdminController {
  constructor(private svc: SuperAdminService) {}

  @Get('metrics/summary')
  summary() {
    return this.svc.summary();
  }

  @Get('system/flags')
  flags() {
    return this.svc.getFlags();
  }

  @Patch('system/flags')
  updateFlags(@Body() dto: UpdateFlagsDto, @Req() req: AuthRequest) {
    return this.svc.updateFlags(dto, req.user);
  }

  @Post('users')
  createManagedUser(
    @Body() dto: CreateManagedUserDto,
    @Req() req: AuthRequest,
  ) {
    return this.svc.createManagedUser(dto, req.user);
  }

  @Get('managed-users')
  listManagedUsers(
    @Query('role') role: 'ADMIN' | 'ORGANIZER' | 'ALL',
    @Req() req: AuthRequest,
  ) {
    return this.svc.listManagedUsers(role, req.user);
  }

  @Patch('users/:userId')
  updateManagedUser(
    @Param('userId') userId: string,
    @Body() dto: UpdateManagedUserDto,
    @Req() req: AuthRequest,
  ) {
    return this.svc.updateManagedUser(userId, dto, req.user);
  }

  @Delete('users/:userId')
  deleteManagedUser(@Param('userId') userId: string, @Req() req: AuthRequest) {
    return this.svc.deleteManagedUser(userId, req.user);
  }

  @Get('organizers')
  organizers() {
    return this.svc.listOrganizers();
  }

  @Post('organizers/:orgId/suspend')
  suspendOrganizer(
    @Param('orgId') orgId: string,
    @Body() dto: ReasonDto,
    @Req() req: AuthRequest,
  ) {
    return this.svc.suspendOrganizer(orgId, dto, req.user);
  }

  @Post('organizers/:orgId/approve')
  approveOrganizer(
    @Param('orgId') orgId: string,
    @Body() dto: ReasonDto,
    @Req() req: AuthRequest,
  ) {
    return this.svc.approveOrganization(orgId, dto, req.user);
  }

  @Post('organizers/:orgId/revert-approval')
  revertOrganizerApproval(
    @Param('orgId') orgId: string,
    @Body() dto: ReasonDto,
    @Req() req: AuthRequest,
  ) {
    return this.svc.revertOrganizationApproval(orgId, dto, req.user);
  }

  @Patch('organizers/:orgId/config')
  updateOrganizerConfig(
    @Param('orgId') orgId: string,
    @Body() dto: UpdateOrgConfigDto,
    @Req() req: AuthRequest,
  ) {
    return this.svc.updateOrganizationConfig(orgId, dto, req.user);
  }

  @Delete('organizers/:orgId')
  deleteOrganizer(
    @Param('orgId') orgId: string,
    @Body() dto: ReasonDto,
    @Req() req: AuthRequest,
  ) {
    return this.svc.deleteOrganization(orgId, dto, req.user);
  }

  @Get('teams')
  teams(
    @Query('q') q?: string,
    @Query('orgId') orgId?: string,
    @Query('status') status?: 'ACTIVE' | 'SUSPENDED',
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.svc.listTeams({
      q,
      orgId,
      status,
      page: page ? parseInt(page, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
    });
  }

  @Get('teams/:teamId')
  team(@Param('teamId') teamId: string) {
    return this.svc.getTeam(teamId);
  }

  @Patch('teams/:teamId/status')
  updateTeamStatus(
    @Param('teamId') teamId: string,
    @Body() body: { status: string; reason: string },
    @Req() req: AuthRequest,
  ) {
    return this.svc.updateTeamStatus(teamId, body, req.user);
  }

  @Post('teams/:teamId/remove-player')
  removePlayer(
    @Param('teamId') teamId: string,
    @Body() body: { playerId: string; reason: string },
    @Req() req: AuthRequest,
  ) {
    return this.svc.removePlayerFromTeam(teamId, body, req.user);
  }

  @Post('teams/:teamId/force-leave-tournament')
  forceLeaveTournament(
    @Param('teamId') teamId: string,
    @Body() body: { tournamentId: string; reason: string },
    @Req() req: AuthRequest,
  ) {
    return this.svc.forceLeaveTournament(teamId, body, req.user);
  }

  @Get('payouts')
  payouts(@Query('status') status?: PayoutStatus) {
    return this.svc.listPayouts(status);
  }

  @Get('users')
  users(
    @Query('q') q?: string,
    @Query('role') role?: PrismaRole,
    @Query('status') status?: UserStatus,
    @Query('orgId') orgId?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.svc.listUsers({
      q,
      role,
      status,
      orgId,
      page: page ? parseInt(page, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
    });
  }

  @Get('users/:userId')
  user(@Param('userId') userId: string) {
    return this.svc.getUser(userId);
  }

  @Patch('users/:userId/org')
  moveUserOrg(
    @Param('userId') userId: string,
    @Body() body: { orgId: string; reason: string },
    @Req() req: AuthRequest,
  ) {
    return this.svc.moveUserOrg(userId, body, req.user);
  }

  @Post('users/:userId/reset-password')
  resetPassword(
    @Param('userId') userId: string,
    @Body() body: { reason?: string; newPassword?: string },
    @Req() req: AuthRequest,
  ) {
    return this.svc.resetPassword(userId, body, req.user);
  }

  @Delete('users/:userId')
  async deleteUser(
    @Param('userId') userId: string,
    @Body() body: { reason?: string },
    @Req() req: AuthRequest,
  ) {
    try {
      return await this.svc.softDeleteUser(userId, body, req.user);
    } catch (err) {
      // If already gone, treat as success to keep UI flows smooth.
      const status = (err as { status?: number })?.status;
      if (status === 404) {
        return { ok: true };
      }
      throw err;
    }
  }

  @Post('users/:userId/restore')
  restoreUser(
    @Param('userId') userId: string,
    @Body() body: { reason?: string },
    @Req() req: AuthRequest,
  ) {
    return this.svc.restoreUser(userId, body, req.user);
  }

  @Post('users/actions/log')
  logUserAction(
    @Body()
    body: {
      action: string;
      userEmail?: string;
      role?: string;
      organizationId?: string;
      adminId?: string;
      reason?: string;
      timestamp?: string;
    },
    @Req() req: AuthRequest,
  ) {
    return this.svc.logUserAction(body, req.user);
  }

  // Compatibility endpoint for frontend audit log helper
  @Post('audit/logs')
  logAudit(
    @Body()
    body: {
      action: string;
      entityType?: string;
      entityId?: string;
      userEmail?: string;
      role?: string;
      organizationId?: string;
      adminId?: string;
      reason?: string;
      timestamp?: string;
    },
    @Req() req: AuthRequest,
  ) {
    return this.svc.logUserAction(body, req.user);
  }

  @Post('impersonate')
  async impersonate(
    @Body() body: { targetUserId: string; reason: string },
    @Req() req: AuthRequest,
  ) {
    const result = await this.svc.impersonate(
      body.targetUserId,
      body.reason,
      req.user,
    );
    return {
      ...result,
      access_token: result.token,
      accessToken: result.token,
    };
  }

  @Post('impersonate/exit')
  exitImpersonation(@Req() req: AuthRequest) {
    return this.svc.endImpersonation(req.user);
  }

  @Post('payouts/:payoutId/approve')
  approvePayout(@Param('payoutId') payoutId: string, @Req() req: AuthRequest) {
    return this.svc.approvePayout(payoutId, req.user);
  }

  @Post('payouts/:payoutId/reject')
  rejectPayout(@Param('payoutId') payoutId: string, @Req() req: AuthRequest) {
    return this.svc.rejectPayout(payoutId, req.user);
  }

  @Post('wallets/:walletId/adjust')
  adjustWallet(
    @Param('walletId') walletId: string,
    @Body() dto: AdjustWalletDto,
    @Req() req: AuthRequest,
  ) {
    return this.svc.adjustWallet(walletId, dto, req.user);
  }

  @Patch('users/:userId/role')
  changeRole(
    @Param('userId') userId: string,
    @Body() dto: ChangeRoleDto,
    @Req() req: AuthRequest,
  ) {
    return this.svc.changeRole(userId, dto, req.user);
  }

  @Post('users/:userId/ban')
  banUser(
    @Param('userId') userId: string,
    @Body() dto: BanUserDto,
    @Req() req: AuthRequest,
  ) {
    return this.svc.banUser(userId, dto, req.user);
  }

  @Post('users/:userId/unban')
  unbanUser(@Param('userId') userId: string, @Req() req: AuthRequest) {
    return this.svc.unbanUser(userId, req.user);
  }

  @Get('reports')
  reports(@Query('status') status?: ReportStatus) {
    return this.svc.listReports(status);
  }

  @Post('reports/:reportId/resolve')
  resolveReport(
    @Param('reportId') reportId: string,
    @Body() dto: ResolveReportDto,
    @Req() req: AuthRequest,
  ) {
    return this.svc.resolveReport(reportId, dto, req.user);
  }

  @Post('broadcast')
  broadcast(@Body() dto: BroadcastDto, @Req() req: AuthRequest) {
    return this.svc.broadcast(dto, req.user);
  }

  @Get('audit')
  audit(@Query('limit') limit?: string) {
    const parsed = limit ? parseInt(limit, 10) : undefined;
    return this.svc.audit(parsed);
  }

  @Get('organizers/:orgId/features')
  orgFeatures(@Param('orgId') orgId: string) {
    return this.svc.getOrganizerFeatures(orgId);
  }

  @Post('organizers/:orgId/features')
  setOrgFeatures(
    @Param('orgId') orgId: string,
    @Body()
    dto: {
      features: { key: FeatureKey; enabled: boolean }[];
    },
    @Req() req: AuthRequest,
  ) {
    return this.svc.setOrganizerFeatures(orgId, dto.features ?? [], req.user);
  }

  @Post('organizers/:orgId/features/preset')
  preset(
    @Param('orgId') orgId: string,
    @Body('preset') preset: 'full' | 'minimal' = 'full',
    @Req() req: AuthRequest,
  ) {
    return this.svc.applyPreset(orgId, preset, req.user);
  }
}
