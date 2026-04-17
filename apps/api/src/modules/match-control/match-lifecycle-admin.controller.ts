import { Body, Controller, Param, Post, Req, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { IsIn, IsOptional, IsString } from 'class-validator';
import type { AuthenticatedRequest } from '../../common/auth/auth.types';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { MatchControlService } from './match-control.service';

class UnlockMatchDto {
  @IsOptional()
  @IsString()
  @IsIn(['READY', 'LIVE'])
  targetStatus?: 'READY' | 'LIVE';

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsString()
  sessionId?: string;
}

@Controller(['admin/match/:matchId', 'api/admin/match/:matchId'])
@UseGuards(JwtAuthGuard)
@Roles(Role.SUPER_ADMIN, Role.ADMIN)
export class MatchLifecycleAdminController {
  constructor(private readonly service: MatchControlService) {}

  @Post('unlock')
  unlock(
    @Param('matchId') matchId: string,
    @Body() body: UnlockMatchDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.unlockMatch(req.user, matchId, {
      targetStatus: body?.targetStatus ?? 'READY',
      reason: body?.reason ?? 'ADMIN_UNLOCK',
      sessionId: body?.sessionId ?? null,
    });
  }
}
