import { Controller, Param, Post, Req, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import type { AuthenticatedRequest } from '../../common/auth/auth.types';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { ScoringService } from './scoring.service';

@Controller('matches')
@UseGuards(JwtAuthGuard)
@Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.ORGANIZER)
export class ScoringRecalcController {
  constructor(private readonly scoring: ScoringService) {}

  @Post(':matchId/recalculate')
  recalc(@Param('matchId') matchId: string, @Req() req: AuthenticatedRequest) {
    return this.scoring.recalculateMatch(matchId, req.user);
  }
}
