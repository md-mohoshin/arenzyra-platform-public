import { Module } from '@nestjs/common';
import { OrganizerTournamentsController } from './organizer-tournaments.controller';
import { OrganizerTournamentsService } from './organizer-tournaments.service';
import { AuthModule } from '../../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [OrganizerTournamentsController],
  providers: [OrganizerTournamentsService],
  exports: [OrganizerTournamentsService],
})
export class OrganizerTournamentsModule {}
