import { Module, forwardRef } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { RealtimeModule } from '../../realtime/realtime.module';
import { MatchControlModule } from '../match-control/match-control.module';
import { ObserverModule } from '../observer/observer.module';
import { ResultsModule } from '../results/results.module';
import { TelemetryGateway } from './telemetry.gateway';
import { TelemetryController } from './telemetry.controller';
import { TelemetrySessionService } from './telemetry-session.service';
import { TelemetryValidatorService } from './telemetry-validator.service';
import { TelemetryPersistenceService } from './telemetry-persistence.service';
import { TelemetryBroadcastService } from './telemetry-broadcast.service';
import { TelemetryEngineService } from './telemetry-engine.service';
import { TelemetryIngressService } from './telemetry-ingress.service';
import { TelemetryMappingService } from './telemetry-mapping.service';

@Module({
  imports: [
    AuthModule,
    forwardRef(() => MatchControlModule),
    forwardRef(() => RealtimeModule),
    forwardRef(() => ObserverModule),
    forwardRef(() => ResultsModule),
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
    TelemetryMappingService,
  ],
  exports: [
    TelemetrySessionService,
    TelemetryValidatorService,
    TelemetryPersistenceService,
    TelemetryBroadcastService,
    TelemetryEngineService,
    TelemetryIngressService,
    TelemetryMappingService,
  ],
})
export class TelemetryModule {}
