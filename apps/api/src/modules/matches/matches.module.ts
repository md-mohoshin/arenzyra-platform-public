import { Module, forwardRef } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { OrgScopeGuard } from '../../common/org/org-scope.guard';
import { LiveService } from '../live/live.service';
import { ScoringService } from '../scoring/scoring.service';
import { PcobModule } from '../pcob/pcob.module';
import { AdaptersModule } from '../adapters/adapters.module';
import { ScoreboardModule } from '../scoreboard/scoreboard.module';
import { MatchControlModule } from '../match-control/match-control.module';
import { ResultsModule } from '../results/results.module';
import { StandingsModule } from '../standings/standings.module';
import { MatchesController } from './matches.controller';
import { MatchesContextController } from './matches.context.controller';
import {
  MeMatchesController,
  OrgMeMatchesController,
} from './matches.me.controller';
import { MatchesPublicController } from './matches.public.controller';
import { MatchesService } from './matches.service';
import { OrganizerLiveRadarController } from './live-radar.controller';
import { OrganizerMatchesController } from './organizer-matches.controller';
import { BroadcastModule } from '../broadcast/broadcast.module';
import { RealtimeModule } from '../../realtime/realtime.module';
import { LiveStateRepairService } from './live-state-repair.service';

@Module({
  imports: [
    forwardRef(() => PcobModule),
    AdaptersModule,
    ScoreboardModule,
    forwardRef(() => ResultsModule),
    forwardRef(() => MatchControlModule),
    StandingsModule,
    BroadcastModule,
    forwardRef(() => RealtimeModule),
  ],
  controllers: [
    MatchesController,
    MatchesContextController,
    MeMatchesController,
    OrgMeMatchesController,
    MatchesPublicController,
    OrganizerLiveRadarController,
    OrganizerMatchesController,
  ],
  providers: [
    MatchesService,
    LiveStateRepairService,
    AuditService,
    ScoringService,
    LiveService,
    OrgScopeGuard,
  ],
  exports: [MatchesService],
})
export class MatchesModule {}
