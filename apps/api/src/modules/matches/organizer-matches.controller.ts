import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { ForbiddenException } from '@nestjs/common';
import { Role } from '@prisma/client';
import type { AuthenticatedRequest } from '../../common/auth/auth.types';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { MatchesService } from './matches.service';

@Controller('organizer')
@UseGuards(JwtAuthGuard)
@Roles(Role.SUPER_ADMIN, Role.ORGANIZER)
export class OrganizerMatchesController {
  constructor(private readonly matches: MatchesService) {}

  @Get('matches')
  list(
    @Req() req: AuthenticatedRequest,
    @Query('status') status?: string,
    @Query('orgId') orgId?: string,
  ) {
    const scopedOrgId = req.orgId ?? orgId ?? null;
    if (!scopedOrgId) {
      throw new ForbiddenException('Organization context missing');
    }
    return this.matches.listOrganizerMatches(req.user, status, scopedOrgId);
  }
}
