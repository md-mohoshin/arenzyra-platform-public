import { Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import type { AuthenticatedRequest } from '../../common/auth/auth.types';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { PrismaService } from '../../db/prisma.service';
import { requireMatchOrganization } from '../../common/org/org.util';
import { CanonicalControlReadService } from './canonical-control-read.service';
import type { MatchLiveStatePayload } from './match-live-state.types';

@Controller('api/matches/:matchId/live-state')
@UseGuards(JwtAuthGuard)
export class MatchLiveStateController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly canonicalRead: CanonicalControlReadService,
  ) {}

  private async ensureAccess(req: AuthenticatedRequest, matchId: string) {
    await requireMatchOrganization(this.prisma, matchId, { actor: req.user });
  }

  @Post('init')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.ORGANIZER, Role.REFEREE)
  async init(
    @Param('matchId') matchId: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<MatchLiveStatePayload> {
    await this.ensureAccess(req, matchId);
    return this.canonicalRead.getMatchState(matchId, {
      actor: req.user,
      preferCached: false,
    });
  }

  @Get()
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.ORGANIZER, Role.REFEREE)
  async getState(
    @Param('matchId') matchId: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<MatchLiveStatePayload> {
    await this.ensureAccess(req, matchId);
    return this.canonicalRead.getMatchState(matchId, {
      actor: req.user,
      preferCached: false,
    });
  }
}
