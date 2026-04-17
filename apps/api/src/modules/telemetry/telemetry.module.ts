import { Module, forwardRef } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { RealtimeModule } from '../../realtime/realtime.module';
import { MatchControlModule } from '../match-control/match-control.module';
import { ObserverModule } from '../observer/observer.module';
import { ResultsModule } from '../results/results.module';
import { ScoringModule } from '../scoring/scoring.module';
import { TelemetryGateway } from './telemetry.gateway';
import { TelemetryController } from './telemetry.controller';
import { TelemetrySessionService } from './telemetry-session.service';
import { TelemetryValidatorService } from './telemetry-validator.service';
import { TelemetryPersistenceService } from './telemetry-persistence.service';
import { TelemetryBroadcastService } from './telemetry-broadcast.service';
import { TelemetryEngineService } from './telemetry-engine.service';
import { TelemetryIngressService } from './telemetry-ingress.service';

@Module({
  imports: [
    AuthModule,
    forwardRef(() => MatchControlModule),
    forwardRef(() => RealtimeModule),
    forwardRef(() => ResultsModule),
    forwardRef(() => ScoringModule),
    forwardRef(() => ObserverModule),
  ],
  controllers: [TelemetryController],
  providers: [
    TelemetryGateway,
    TelemetrySessionService,
    TelemetryValidatorService,
    TelemetryPersistenceService,
    TelemetryBroadcastService,
    TelemetryEngineService,
    TelemetryIngressService,
  ],
  exports: [
    TelemetrySessionService,
    TelemetryValidatorService,
    TelemetryPersistenceService,
    TelemetryBroadcastService,
    TelemetryEngineService,
    TelemetryIngressService,
  ],
})
export class TelemetryModule {}
