import { Module } from '@nestjs/common';
import { TournamentSponsorsController } from './tournament-sponsors.controller';
import { TournamentSponsorsService } from './tournament-sponsors.service';
import { AuthModule } from '../../auth/auth.module';
import { BroadcastModule } from '../broadcast/broadcast.module';

@Module({
  imports: [AuthModule, BroadcastModule],
  controllers: [TournamentSponsorsController],
  providers: [TournamentSponsorsService],
})
export class TournamentSponsorsModule {}
