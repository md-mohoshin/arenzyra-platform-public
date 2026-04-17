import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import type { AuthenticatedRequest } from '../../common/auth/auth.types';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { MatchesService } from './matches.service';

@Controller('organizer')
@UseGuards(JwtAuthGuard)
@Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.ORGANIZER)
export class OrganizerLiveRadarController {
  constructor(private readonly matches: MatchesService) {}

  @Get('live-radar')
  liveRadar(@Req() req: AuthenticatedRequest) {
    return this.matches.liveRadar(req.user);
  }
}
