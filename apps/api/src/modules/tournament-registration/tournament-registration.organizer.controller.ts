import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { Roles } from '../../common/auth/roles.decorator';
import type { AuthenticatedRequest } from '../../common/auth/auth.types';
import { CreateTournamentInviteDto } from './dto/create-tournament-invite.dto';
import { RejectTournamentRegistrationDto } from './dto/reject-tournament-registration.dto';
import { TournamentRegistrationService } from './tournament-registration.service';

@Controller('organizer')
@UseGuards(JwtAuthGuard)
@Roles(Role.SUPER_ADMIN, Role.ORGANIZER)
export class TournamentRegistrationOrganizerController {
  constructor(private readonly registrations: TournamentRegistrationService) {}

  private requireScopedOrg(req: AuthenticatedRequest): string {
    const orgId = req.orgId ?? null;
    if (!orgId) {
      throw new ForbiddenException('Organization context missing');
    }
    return orgId;
  }

  @Get('tournaments/:tournamentId/registrations')
  list(
    @Param('tournamentId') tournamentId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const orgId = this.requireScopedOrg(req);
    return this.registrations.listForOrganizer(tournamentId, orgId, req.user);
  }

  @Get('tournaments/:tournamentId/invites')
  listInvites(
    @Param('tournamentId') tournamentId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const orgId = this.requireScopedOrg(req);
    return this.registrations.listInvites(tournamentId, orgId, req.user);
  }

  @Post('tournaments/:tournamentId/invites')
  createInvite(
    @Param('tournamentId') tournamentId: string,
    @Body() dto: CreateTournamentInviteDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const orgId = this.requireScopedOrg(req);
    return this.registrations.createInvite(tournamentId, orgId, dto, req.user);
  }

  @Post('registrations/:registrationId/approve')
  approve(
    @Param('registrationId') registrationId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const orgId = this.requireScopedOrg(req);
    return this.registrations.approve(registrationId, orgId, req.user);
  }

  @Post('registrations/:registrationId/reject')
  reject(
    @Param('registrationId') registrationId: string,
    @Body() dto: RejectTournamentRegistrationDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const orgId = this.requireScopedOrg(req);
    return this.registrations.reject(registrationId, orgId, dto, req.user);
  }
}
