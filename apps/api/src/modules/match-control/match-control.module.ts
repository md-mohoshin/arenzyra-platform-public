import { Module, forwardRef } from '@nestjs/common';
import { RedisService } from '../../redis/redis.service';
import { AuthModule } from '../../auth/auth.module';
import { AuditModule } from '../audit/audit.module';
import { MatchesModule } from '../matches/matches.module';
import { ScoringModule } from '../scoring/scoring.module';
import { ScoreboardModule } from '../scoreboard/scoreboard.module';
import {
  MatchControlController,
  MatchControlSummariesController,
} from './match-control.controller';
import { MatchAdminControlController } from './match-admin.controller';
import { MatchControlGateway } from './match-control.gateway';
import { LiveStateMirrorService } from './live-state-mirror.service';
import { MatchControlService } from './match-control.service';
import { MatchStateService } from './match-state.service';
import { MatchControlStateStore } from './state.store';
import { OrgMatchControlController } from './org-match-control.controller';
import { MatchLifecycleAdminController } from './match-lifecycle-admin.controller';
import { ResultsModule } from '../results/results.module';
import { GameAdaptersModule } from '../game-adapters/game-adapters.module';
import { RealtimeModule } from '../../realtime/realtime.module';
import { BroadcastModule } from '../broadcast/broadcast.module';
import { StandingsModule } from '../standings/standings.module';
import { ProductionModule } from '../production/production.module';
import { PcobModule } from '../pcob/pcob.module';
import { TopFraggerModule } from '../widgets/top-fragger/top-fragger.module';
import { MvpModule } from '../widgets/mvp/mvp.module';

@Module({
  imports: [
    AuthModule,
    forwardRef(() => MatchesModule),
    ScoringModule,
    AuditModule,
    ScoreboardModule,
    forwardRef(() => ResultsModule),
    forwardRef(() => GameAdaptersModule),
    forwardRef(() => RealtimeModule),
    BroadcastModule,
    StandingsModule,
    forwardRef(() => ProductionModule),
    forwardRef(() => PcobModule),
    TopFraggerModule,
    MvpModule,
  ],
  controllers: [
    MatchControlSummariesController,
    MatchControlController,
    MatchAdminControlController,
    OrgMatchControlController,
    MatchLifecycleAdminController,
  ],
  providers: [
    MatchControlService,
    MatchStateService,
    MatchControlGateway,
    LiveStateMirrorService,
    MatchControlStateStore,
    RedisService,
  ],
  exports: [
    LiveStateMirrorService,
    MatchStateService,
    MatchControlService,
    MatchControlStateStore,
  ],
})
export class MatchControlModule {}
