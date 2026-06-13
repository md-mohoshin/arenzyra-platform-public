import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import type { AuthenticatedRequest } from '../../common/auth/auth.types';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { CreateManagerBanDto } from './dto/create-manager-ban.dto';
import { CreateTeamBanDto } from './dto/create-team-ban.dto';
import { ListManagerBansDto } from './dto/list-manager-bans.dto';
import { ListTeamBansDto } from './dto/list-team-bans.dto';
import { NoShowTeamBansDto } from './dto/no-show-team-bans.dto';
import { RevokeTeamBanDto } from './dto/revoke-team-ban.dto';
import { TeamBansService } from './team-bans.service';

@Controller('organizer/team-bans')
@UseGuards(JwtAuthGuard)
@Roles(Role.SUPER_ADMIN, Role.ORGANIZER)
export class TeamBansController {
  constructor(private readonly teamBans: TeamBansService) {}

  @Get()
  list(@Query() query: ListTeamBansDto, @Req() req: AuthenticatedRequest) {
    return this.teamBans.list(query, req.user);
  }

  @Post()
  create(@Body() dto: CreateTeamBanDto, @Req() req: AuthenticatedRequest) {
    return this.teamBans.create(dto, req.user);
  }

  @Post('no-shows/preview')
  previewNoShows(
    @Body() dto: NoShowTeamBansDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.teamBans.previewNoShowBans(dto, req.user);
  }

  @Post('no-shows')
  createNoShows(
    @Body() dto: NoShowTeamBansDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.teamBans.createNoShowBans(dto, req.user);
  }

  @Get('managers')
  listManagerBans(
    @Query() query: ListManagerBansDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.teamBans.listManagerBans(query, req.user);
  }

  @Post('managers')
  createManagerBan(
    @Body() dto: CreateManagerBanDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.teamBans.createManagerBan(dto, req.user);
  }

  @Post('managers/:id/revoke')
  revokeManagerBan(
    @Param('id') id: string,
    @Body() dto: RevokeTeamBanDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.teamBans.revokeManagerBan(id, dto, req.user);
  }

  @Post(':id/revoke')
  revoke(
    @Param('id') id: string,
    @Body() dto: RevokeTeamBanDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.teamBans.revoke(id, dto, req.user);
  }
}
