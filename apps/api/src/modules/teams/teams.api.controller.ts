import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import type { AuthRequest } from '../../common/auth/auth.types';
import { Roles } from '../../common/auth/roles.decorator';
import { TeamsApiService } from './teams.api.service';
import type {
  TeamCreateDto,
  TeamListFilters,
  TeamUpdateDto,
} from './dto/team.api.dto';

@Controller('teams')
@UseGuards(JwtAuthGuard)
@Roles(Role.ORGANIZER, Role.ADMIN)
export class TeamsApiController {
  constructor(private readonly svc: TeamsApiService) {}

  @Get()
  list(@Query() query: TeamListFilters, @Req() req: AuthRequest) {
    return this.svc.list(req.user, query);
  }

  @Post()
  create(@Body() body: TeamCreateDto, @Req() req: AuthRequest) {
    return this.svc.create(req.user, body);
  }

  @Patch(':teamId')
  update(
    @Param('teamId') teamId: string,
    @Body() body: TeamUpdateDto,
    @Req() req: AuthRequest,
  ) {
    return this.svc.update(req.user, teamId, body);
  }

  @Delete(':teamId')
  remove(@Param('teamId') teamId: string, @Req() req: AuthRequest) {
    return this.svc.softDelete(req.user, teamId);
  }
}
