import {
  Controller,
  Get,
  Param,
  Req,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import type { AuthenticatedRequest } from '../../common/auth/auth.types';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { RenderService } from './render.service';

@Controller('render')
@UseGuards(JwtAuthGuard)
@Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.ORGANIZER, Role.REFEREE)
export class RenderController {
  constructor(private readonly renderService: RenderService) {}

  @Get('match/:matchId')
  async renderMatch(
    @Param('matchId') matchId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const buffer = await this.renderService.renderMatchResultImage(
      req.user,
      matchId,
    );

    return new StreamableFile(buffer, {
      type: 'image/png',
      disposition: `inline; filename="match-${matchId}.png"`,
    });
  }

  @Get('session/:sessionId/standings')
  async renderSessionStandings(
    @Param('sessionId') sessionId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const buffer = await this.renderService.renderSessionStandingsImage(
      req.user,
      sessionId,
    );

    return new StreamableFile(buffer, {
      type: 'image/png',
      disposition: `inline; filename="session-${sessionId}-standings.png"`,
    });
  }
}
