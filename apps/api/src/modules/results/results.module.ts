import { Module, forwardRef } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { AuditService } from '../audit/audit.service';
import { PcobModule } from '../pcob/pcob.module';
import { ScoringModule } from '../scoring/scoring.module';
import { ResultsApprovalService } from './results-approval.service';
import { ResultsComputeService } from './results.compute.service';
import { ResultsController } from './results.controller';
import { ResultsManualService } from './results-manual.service';
import { ResultsEventsService } from './results-events.service';
import { ResultsIngestService } from './results-ingest.service';
import { ResultsService } from './results.service';
import { RefereeResultsController } from './referee-results.controller';
import { WidgetsPublicController } from './widgets-public.controller';
import { ResultsInitService } from './results-init.service';
import { MatchConclusionService } from './match-conclusion.service';
import { TopFraggerModule } from '../widgets/top-fragger/top-fragger.module';
import { MvpModule } from '../widgets/mvp/mvp.module';
import { StandingsModule } from '../standings/standings.module';
import { BroadcastModule } from '../broadcast/broadcast.module';
import { RealtimeModule } from '../../realtime/realtime.module';
import { MatchControlModule } from '../match-control/match-control.module';
import { TelemetryModule } from '../telemetry/telemetry.module';

@Module({
  imports: [
    forwardRef(() => PcobModule),
    forwardRef(() => ScoringModule),
    AuthModule,
    TopFraggerModule,
    MvpModule,
    StandingsModule,
    forwardRef(() => MatchControlModule),
    forwardRef(() => BroadcastModule),
    forwardRef(() => RealtimeModule),
    forwardRef(() => TelemetryModule),
  ],
  controllers: [
    ResultsController,
    RefereeResultsController,
    WidgetsPublicController,
  ],
  providers: [
    ResultsService,
    ResultsInitService,
    ResultsManualService,
    ResultsApprovalService,
    ResultsComputeService,
    ResultsEventsService,
    ResultsIngestService,
    MatchConclusionService,
    AuditService,
  ],
  exports: [
    ResultsService,
    ResultsInitService,
    ResultsIngestService,
    ResultsEventsService,
    MatchConclusionService,
  ],
})
export class ResultsModule {}
