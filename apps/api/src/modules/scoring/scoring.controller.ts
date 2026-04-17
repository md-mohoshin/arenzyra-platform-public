import { Controller, Param, Post, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { OrgScopeGuard } from '../../common/org/org-scope.guard';
import { ScoringService } from './scoring.service';

@Controller('org/:orgId/scoring')
@UseGuards(JwtAuthGuard, OrgScopeGuard)
@Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.ORGANIZER)
export class ScoringController {
  constructor(private scoring: ScoringService) {}

  @Post('match/:matchId/recompute')
  recompute(@Param('matchId') matchId: string) {
    return this.scoring.recomputeMatchAndTournament(matchId);
  }
}
