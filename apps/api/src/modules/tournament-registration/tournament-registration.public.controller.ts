import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { Public } from '../../common/auth/public.decorator';
import { AcceptTournamentInviteDto } from './dto/accept-tournament-invite.dto';
import { SubmitTournamentRegistrationDto } from './dto/submit-tournament-registration.dto';
import { TournamentRegistrationService } from './tournament-registration.service';

@Controller('registration')
export class TournamentRegistrationPublicController {
  constructor(private readonly registrations: TournamentRegistrationService) {}

  @Public()
  @Get('invite/:token')
  inviteInfo(@Param('token') token: string) {
    return this.registrations.getInviteInfo(token);
  }

  @Public()
  @Post('invite/:token')
  acceptInvite(
    @Param('token') token: string,
    @Body() dto: AcceptTournamentInviteDto,
  ) {
    return this.registrations.acceptInvite(token, dto);
  }

  @Public()
  @Post(':tournamentId')
  submit(
    @Param('tournamentId') tournamentId: string,
    @Body() dto: SubmitTournamentRegistrationDto,
  ) {
    return this.registrations.submit(tournamentId, dto);
  }
}
