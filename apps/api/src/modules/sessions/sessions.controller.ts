import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Role, SessionStatus, SessionType } from '@prisma/client';
import type { AuthenticatedRequest } from '../../common/auth/auth.types';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { CreateSessionDto } from './dto/create-session.dto';
import { UpdateSessionDto } from './dto/update-session.dto';
import { RegisterSessionTeamDto } from './dto/register-session-team.dto';
import { RemoveSessionRegistrationDto } from './dto/remove-session-registration.dto';
import { ListSessionRegistrationsDto } from './dto/list-session-registrations.dto';
import { CreateSessionMatchDto } from './dto/create-session-match.dto';
import { SessionsService } from './sessions.service';
import { SessionsStandingsService } from './sessions-standings.service';

@Controller('sessions')
@UseGuards(JwtAuthGuard)
@Roles(Role.SUPER_ADMIN, Role.ORGANIZER)
export class SessionsController {
  constructor(
    private readonly sessions: SessionsService,
    private readonly standings: SessionsStandingsService,
  ) {}

  private requireScopedOrg(req: AuthenticatedRequest): string {
    const orgId = req.orgId ?? null;
    if (!orgId) {
      throw new ForbiddenException('Organization context missing');
    }
    return orgId;
  }

  @Post()
  create(@Body() dto: CreateSessionDto, @Req() req: AuthenticatedRequest) {
    this.requireScopedOrg(req);
    return this.sessions.create(dto, req.user);
  }

  @Get()
  list(
    @Req() req: AuthenticatedRequest,
    @Query('status') status?: SessionStatus,
    @Query('type') type?: SessionType,
  ) {
    this.requireScopedOrg(req);
    return this.sessions.list(req.user, { status, type });
  }

  @Get(':id')
  get(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    this.requireScopedOrg(req);
    return this.sessions.get(id, req.user);
  }

  @Get(':id/standings')
  getStandings(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    this.requireScopedOrg(req);
    return this.standings.getStandings(id, req.user);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateSessionDto,
    @Req() req: AuthenticatedRequest,
  ) {
    this.requireScopedOrg(req);
    return this.sessions.update(id, dto, req.user);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    this.requireScopedOrg(req);
    return this.sessions.softDelete(id, req.user);
  }

  @Post(':id/register-team')
  registerTeam(
    @Param('id') id: string,
    @Body() dto: RegisterSessionTeamDto,
    @Req() req: AuthenticatedRequest,
  ) {
    this.requireScopedOrg(req);
    return this.sessions.registerTeam(id, dto, req.user);
  }

  @Get(':id/registrations')
  listRegistrations(
    @Param('id') id: string,
    @Query() query: ListSessionRegistrationsDto,
    @Req() req: AuthenticatedRequest,
  ) {
    this.requireScopedOrg(req);
    return this.sessions.listRegistrations(id, query, req.user);
  }

  @Delete(':id/registrations/:registrationId')
  removeRegistration(
    @Param('id') id: string,
    @Param('registrationId') registrationId: string,
    @Body() dto: RemoveSessionRegistrationDto,
    @Req() req: AuthenticatedRequest,
  ) {
    this.requireScopedOrg(req);
    return this.sessions.removeRegistration(id, registrationId, dto, req.user);
  }

  @Post(':id/matches')
  createMatch(
    @Param('id') id: string,
    @Body() dto: CreateSessionMatchDto,
    @Req() req: AuthenticatedRequest,
  ) {
    this.requireScopedOrg(req);
    return this.sessions.createMatch(id, dto, req.user);
  }

  @Get(':id/matches')
  listMatches(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    this.requireScopedOrg(req);
    return this.sessions.listMatches(id, req.user);
  }
}
