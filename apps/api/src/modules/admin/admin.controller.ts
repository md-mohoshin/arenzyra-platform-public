import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ReportStatus,
  Role,
  Role as PrismaRole,
  UserStatus,
} from '@prisma/client';
import type { AuthenticatedRequest } from '../../common/auth/auth.types';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { AdminService } from './admin.service';
import { KycReviewDto } from './dto/kyc-review.dto';
import { WarnPlayerDto } from './dto/warn-player.dto';
import { BanPlayerDto } from './dto/ban-player.dto';
import { ResolveReportDto } from './dto/resolve-report.dto';
import { FlagAbuseDto } from './dto/flag-abuse.dto';
import { ReasonDto } from './dto/reason.dto';

@Controller('admin')
@UseGuards(JwtAuthGuard)
export class AdminController {
  constructor(private svc: AdminService) {}

  @Get('organizers')
  @Roles(Role.ADMIN)
  organizers(@Req() req: AuthenticatedRequest) {
    return this.svc.listOrganizers(req.user);
  }

  @Post('impersonate-org')
  @Roles(Role.SUPER_ADMIN)
  impersonateOrg(
    @Body('orgId') orgId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.svc.impersonateOrg(orgId, req.user).then((result) => {
      return {
        ...result,
        access_token: result.impersonationToken,
        accessToken: result.impersonationToken,
      };
    });
  }

  @Post('impersonate-exit')
  @Roles(Role.SUPER_ADMIN)
  impersonateExit(@Req() req: AuthenticatedRequest) {
    return this.svc.endOrgImpersonation(req.user);
  }

  @Post('organizers/:id/approve')
  @Roles(Role.ADMIN)
  approveOrganizer(
    @Param('id') id: string,
    @Body() dto: ReasonDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.svc.approveOrganizer(id, dto, req.user);
  }

  @Post('organizers/:id/suspend')
  @Roles(Role.ADMIN)
  suspendOrganizer(
    @Param('id') id: string,
    @Body() dto: ReasonDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.svc.suspendOrganizer(id, dto, req.user);
  }

  @Post('organizers/:id/kyc')
  @Roles(Role.ADMIN)
  kyc(
    @Param('id') id: string,
    @Body() dto: KycReviewDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.svc.reviewKyc(id, dto, req.user);
  }

  @Get('players')
  @Roles(Role.ADMIN)
  players(@Query('q') q: string | undefined, @Req() req: AuthenticatedRequest) {
    return this.svc.listPlayers(q, req.user);
  }

  @Post('players/:id/warn')
  @Roles(Role.ADMIN)
  warnPlayer(
    @Param('id') id: string,
    @Body() dto: WarnPlayerDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.svc.warnPlayer(id, dto, req.user);
  }

  @Post('players/:id/ban')
  @Roles(Role.ADMIN)
  banPlayer(
    @Param('id') id: string,
    @Body() dto: BanPlayerDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.svc.banPlayer(id, dto, req.user);
  }

  @Post('players/:id/unban')
  @Roles(Role.ADMIN)
  unbanPlayer(
    @Param('id') id: string,
    @Body() dto: ReasonDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.svc.unbanPlayer(id, dto, req.user);
  }

  @Post('players/:id/logout')
  @Roles(Role.ADMIN)
  logoutPlayer(
    @Param('id') id: string,
    @Body() dto: ReasonDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.svc.forceLogout(id, dto, req.user);
  }

  @Get('reports')
  @Roles(Role.ADMIN)
  reports(
    @Query('status') status: ReportStatus | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.svc.listReports(status, req.user);
  }

  @Get('teams')
  @Roles(Role.ADMIN)
  teams(
    @Req() req: AuthenticatedRequest,
    @Query('q') q?: string,
    @Query('orgId') orgId?: string,
    @Query('status') status?: 'ACTIVE' | 'SUSPENDED',
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.svc.listTeams(
      {
        q,
        orgId,
        status,
        page: page ? parseInt(page, 10) : undefined,
        pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
      },
      req.user,
    );
  }

  @Get('teams/:teamId')
  @Roles(Role.ADMIN)
  team(@Param('teamId') teamId: string, @Req() req: AuthenticatedRequest) {
    return this.svc.getTeam(teamId, req.user);
  }

  @Post('reports/:id/resolve')
  @Roles(Role.ADMIN)
  resolveReport(
    @Param('id') id: string,
    @Body() dto: ResolveReportDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.svc.resolveReport(id, dto, req.user);
  }

  @Get('users')
  @Roles(Role.ADMIN)
  users(
    @Req() req: AuthenticatedRequest,
    @Query('q') q?: string,
    @Query('role') role?: PrismaRole,
    @Query('status') status?: UserStatus,
    @Query('orgId') orgId?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.svc.listUsers(
      {
        q,
        role,
        status,
        orgId,
        page: page ? parseInt(page, 10) : undefined,
        pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
      },
      req.user,
    );
  }

  @Get('users/:userId')
  @Roles(Role.ADMIN)
  user(@Param('userId') userId: string, @Req() req: AuthenticatedRequest) {
    return this.svc.getUser(userId, req.user);
  }

  @Post('reports/:id/escalate')
  @Roles(Role.ADMIN)
  escalateReport(
    @Param('id') id: string,
    @Body() dto: ReasonDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.svc.escalateReport(id, dto, req.user);
  }

  @Get('tournaments')
  @Roles(Role.ADMIN)
  tournaments(@Req() req: AuthenticatedRequest) {
    return this.svc.listTournaments(req.user);
  }

  @Post('tournaments/:id/pause')
  @Roles(Role.ADMIN)
  pauseTournament(
    @Param('id') id: string,
    @Body() dto: ReasonDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.svc.pauseTournament(id, dto, req.user);
  }

  @Post('tournaments/:id/remove-team')
  @Roles(Role.ADMIN)
  removeTeam(
    @Param('id') id: string,
    @Body('teamId') teamId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.svc.removeTeamFromTournament(id, teamId, req.user);
  }

  @Post('tournaments/:id/flag')
  @Roles(Role.ADMIN)
  flagAbuse(
    @Param('id') id: string,
    @Body() dto: FlagAbuseDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.svc.flagAbuse(id, dto, req.user);
  }

  @Get('logs')
  @Roles(Role.ADMIN)
  logs(@Req() req: AuthenticatedRequest) {
    return this.svc.actionLogs(req.user);
  }
}
