import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import type { AuthenticatedRequest } from '../../common/auth/auth.types';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { ResultBackupsService } from './result-backups.service';

@Controller('organizer/result-backups')
@UseGuards(JwtAuthGuard)
@Roles(Role.SUPER_ADMIN, Role.ORGANIZER)
export class ResultBackupsController {
  constructor(private readonly resultBackups: ResultBackupsService) {}

  @Get()
  list(
    @Query('sessionId') sessionId: string | undefined,
    @Query('kind') kind: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.resultBackups.list(req.user, { sessionId, kind });
  }

  @Get(':id')
  get(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.resultBackups.get(id, req.user);
  }

  @Patch(':id/rows')
  updateRows(
    @Param('id') id: string,
    @Body() body: { rows?: unknown[] },
    @Req() req: AuthenticatedRequest,
  ) {
    return this.resultBackups.updateRows(id, body, req.user);
  }

  @Post(':id/repost')
  repost(
    @Param('id') id: string,
    @Body() body: { channelId?: string },
    @Req() req: AuthenticatedRequest,
  ) {
    return this.resultBackups.repost(id, body, req.user);
  }
}
