import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import type { AuthRequest } from '../../common/auth/auth.types';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { BroadcastService } from './broadcast.service';

@Controller('org/broadcast')
@UseGuards(JwtAuthGuard)
export class OrgBroadcastController {
  constructor(private readonly broadcast: BroadcastService) {}

  @Get()
  getKey(
    @Req() req: AuthRequest,
    @Query('organizationId') organizationId?: string,
  ) {
    return this.broadcast.getOrgBroadcastKey(
      req.user ?? null,
      organizationId ?? null,
    );
  }

  @Post('regenerate')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  regenerate(
    @Req() req: AuthRequest,
    @Query('organizationId') organizationId?: string,
  ) {
    return this.broadcast.rotateBroadcastKey(
      req.user ?? null,
      organizationId ?? null,
    );
  }

  @Post('match-lower-third/show')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.ORGANIZER)
  showMatchLowerThird(
    @Req() req: AuthRequest,
    @Body()
    body: {
      organizationId?: string | null;
      matchId?: string | null;
      tournamentId?: string | null;
      durationMs?: number | null;
    },
  ) {
    return this.broadcast.emitMatchLowerThirdShow(req.user ?? null, {
      organizationId: body?.organizationId ?? null,
      matchId: body?.matchId ?? null,
      tournamentId: body?.tournamentId ?? null,
      durationMs: typeof body?.durationMs === 'number' ? body.durationMs : null,
    });
  }

  @Post('match-lower-third/hide')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.ORGANIZER)
  hideMatchLowerThird(
    @Req() req: AuthRequest,
    @Body() body: { organizationId?: string | null; reason?: string | null },
  ) {
    return this.broadcast.emitMatchLowerThirdHide(req.user ?? null, {
      organizationId: body?.organizationId ?? null,
      reason: body?.reason ?? null,
    });
  }
}
