import { Module } from '@nestjs/common';
import { OrgScopeGuard } from '../../common/org/org-scope.guard';
import { LiveModule } from '../live/live.module';
import { RealtimeModule } from '../../realtime/realtime.module';
import { PcobModule } from '../pcob/pcob.module';
import { TournamentsController } from './tournaments.controller';
import { MeTournamentsController } from './me.tournaments.controller';
import { TournamentsLogoController } from './tournaments.logo.controller';
import { TournamentsService } from './tournaments.service';
import { AuthModule } from '../../auth/auth.module';

@Module({
  imports: [LiveModule, RealtimeModule, PcobModule, AuthModule],
  controllers: [
    TournamentsController,
    MeTournamentsController,
    TournamentsLogoController,
  ],
  providers: [TournamentsService, OrgScopeGuard],
})
export class TournamentsModule {}
