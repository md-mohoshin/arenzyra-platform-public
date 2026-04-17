import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Role } from '@prisma/client';
import type { AuthenticatedRequest } from '../../common/auth/auth.types';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { LauncherSessionDto } from './dto/launcher-session.dto';
import { LauncherService } from './launcher.service';

@Controller('launcher')
@UseGuards(JwtAuthGuard)
@Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.ORGANIZER)
export class LauncherController {
  constructor(
    private readonly launcherService: LauncherService,
    private readonly jwt: JwtService,
  ) {}

  private buildObserverFeedTokenPayload(req: AuthenticatedRequest) {
    const user = req.user;
    return {
      sub: user.id,
      role: user.role ?? null,
      organizationId: user.organizationId ?? user.orgId ?? null,
      email: user.email ?? null,
      actorId: user.actorId ?? null,
      actorRole: user.actorRole ?? null,
      actingOrgId: user.actingOrgId ?? null,
      actingRole: user.actingRole ?? null,
      actingOrgName: user.actingOrgName ?? null,
      actingAsUserId: user.actingAsUserId ?? null,
      isImpersonating: user.isImpersonating ?? false,
      impersonated: user.impersonated ?? user.isImpersonating ?? false,
      impersonatedBy: user.impersonatedBy ?? null,
      impersonationExpiresAt: user.impersonationExpiresAt ?? null,
      realRole: user.realRole ?? user.role ?? null,
    };
  }

  @Get('license')
  getLicense(@Req() req: AuthenticatedRequest) {
    return this.launcherService.getLicense(req.user);
  }

  @Post('session/start')
  startSession(
    @Body() body: LauncherSessionDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.launcherService.startSession(req.user, body.machineId);
  }

  @Post('session/end')
  endSession(
    @Body() body: LauncherSessionDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.launcherService.endSession(req.user, body.machineId);
  }

  @Post('observer-feed-token')
  async createObserverFeedToken(@Req() req: AuthenticatedRequest) {
    const accessToken = await this.jwt.signAsync(
      this.buildObserverFeedTokenPayload(req),
      {
        expiresIn: '12h',
      },
    );

    return {
      accessToken,
      expiresIn: '12h',
    };
  }
}
