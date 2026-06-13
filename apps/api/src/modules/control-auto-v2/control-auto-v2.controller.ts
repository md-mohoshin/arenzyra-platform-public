import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import type { AuthenticatedRequest } from '../../common/auth/auth.types';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { ControlAutoV2Service } from './control-auto-v2.service';

type StartMatchBody = {
  sessionId?: string | null;
  source?: string | null;
  clientId?: string | null;
  requestedMatchId?: string | null;
  version?: number | null;
};

type EndMatchBody = {
  reason?: string | null;
  version?: number | null;
};

@Controller('me/matches/:matchId/control-auto-v2')
@UseGuards(JwtAuthGuard)
@Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.ORGANIZER)
export class ControlAutoV2Controller {
  constructor(private readonly service: ControlAutoV2Service) {}

  @Get('setup')
  getSetup(
    @Param('matchId') matchId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.getSetup(req.user, matchId);
  }

  @Get('live')
  getLive(@Param('matchId') matchId: string, @Req() req: AuthenticatedRequest) {
    return this.service.getLive(req.user, matchId);
  }

  @Get('results')
  getResults(
    @Param('matchId') matchId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.getResults(req.user, matchId);
  }

  @Post('actions/start')
  startMatch(
    @Param('matchId') matchId: string,
    @Body() body: StartMatchBody | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.startMatch(req.user, matchId, body ?? {});
  }

  @Post('actions/end')
  endMatch(
    @Param('matchId') matchId: string,
    @Body() body: EndMatchBody | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.endMatch(req.user, matchId, body ?? {});
  }
}
