import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { ScoringService } from './scoring.service';

@Controller('matches')
@UseGuards(JwtAuthGuard)
@Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.ORGANIZER)
export class ScoringScoreController {
  constructor(private readonly scoring: ScoringService) {}

  @Get(':matchId/score')
  getScore(@Param('matchId') matchId: string) {
    return this.scoring.getMatchScore(matchId);
  }
}
