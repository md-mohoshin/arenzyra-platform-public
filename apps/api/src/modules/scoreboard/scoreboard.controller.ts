import {
  Controller,
  ForbiddenException,
  Get,
  Param,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { ScoreboardService } from './scoreboard.service';
import { effectiveOrganizationId } from '../../common/org/org.util';
import type { Request } from 'express';
import type { Actor } from '../../common/auth/jwt.strategy';

@Controller('scoreboard')
@UseGuards(JwtAuthGuard)
export class ScoreboardController {
  constructor(private readonly scoreboard: ScoreboardService) {}

  @Get(':matchId')
  get(@Param('matchId') matchId: string, @Req() req: Request) {
    const actor = (req as Request & { user?: Actor }).user ?? null;
    const orgId = actor ? effectiveOrganizationId(actor) : null;
    if (!orgId) {
      throw new ForbiddenException(
        'Organization context required to view scoreboard',
      );
    }
    return this.scoreboard.buildScoreboard(matchId, orgId);
  }
}
