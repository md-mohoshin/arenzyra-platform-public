import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { TournamentRegistrationOrganizerController } from './tournament-registration.organizer.controller';
import { TournamentRegistrationPublicController } from './tournament-registration.public.controller';
import { TournamentRegistrationService } from './tournament-registration.service';

@Module({
  imports: [AuthModule],
  controllers: [
    TournamentRegistrationPublicController,
    TournamentRegistrationOrganizerController,
  ],
  providers: [TournamentRegistrationService],
})
export class TournamentRegistrationModule {}
