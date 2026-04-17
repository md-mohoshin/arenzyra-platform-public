import { Module, forwardRef } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { ObserverService } from './observer.service';
import { ObserverController } from './observer.controller';
import { PcobModule } from '../pcob/pcob.module';
import { WebhookModule } from '../webhook/webhook.module';
import { ShadowBrandingService } from './shadow-branding.service';
import { ObserverWidgetStateService } from './observer-widget-state.service';
import { MatchStateService } from './match-state.service';
import { RealtimeModule } from '../../realtime/realtime.module';
import { ResultsModule } from '../results/results.module';
import { MatchEngineService } from '../telemetry/match-engine.service';
import { FightDetectionEngine } from '../telemetry/fight-detection.engine';
import { ObserverAiService } from './observer-ai.service';
import { MatchControlModule } from '../match-control/match-control.module';
import { ObserverAchievementService } from './observer-achievement.service';
import { ObserverTeamEliminationService } from './observer-team-elimination.service';
import { GameAdaptersModule } from '../game-adapters/game-adapters.module';
import { TelemetryModule } from '../telemetry/telemetry.module';

@Module({
  imports: [
    AuthModule,
    forwardRef(() => PcobModule),
    WebhookModule,
    forwardRef(() => RealtimeModule),
    forwardRef(() => ResultsModule),
    forwardRef(() => MatchControlModule),
    forwardRef(() => GameAdaptersModule),
    forwardRef(() => TelemetryModule),
  ],
  providers: [
    ObserverService,
    ShadowBrandingService,
    MatchStateService,
    ObserverAchievementService,
    ObserverTeamEliminationService,
    ObserverWidgetStateService,
    FightDetectionEngine,
    MatchEngineService,
    ObserverAiService,
  ],
  controllers: [ObserverController],
  exports: [
    ObserverService,
    ShadowBrandingService,
    MatchStateService,
    ObserverAchievementService,
    ObserverTeamEliminationService,
    ObserverWidgetStateService,
    FightDetectionEngine,
    MatchEngineService,
    ObserverAiService,
  ],
})
export class ObserverModule {}
