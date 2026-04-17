import { Module, forwardRef } from '@nestjs/common';
import { RealtimeModule } from '../../realtime/realtime.module';
import { ResultsModule } from '../results/results.module';
import { ShadowApiService } from './shadow-api.service';
import { ShadowPushService } from './shadow-push.service';
import { MatchControlModule } from '../match-control/match-control.module';
import { KillEventEngine } from '../telemetry/kill-event.engine';
import { FightDetectionEngine } from '../telemetry/fight-detection.engine';
import { MatchStateModule } from '../match-state/match-state.module';
import { BroadcastEventEngine } from '../broadcast/broadcast-event.engine';
import { StorylineEngine } from '../storyline/storyline.engine';
import { ObserverAiService } from '../observer/observer-ai.service';

@Module({
  imports: [
    forwardRef(() => RealtimeModule),
    forwardRef(() => ResultsModule),
    forwardRef(() => MatchControlModule),
    MatchStateModule,
  ],
  providers: [
    ShadowApiService,
    KillEventEngine,
    FightDetectionEngine,
    BroadcastEventEngine,
    StorylineEngine,
    ObserverAiService,
    ShadowPushService,
  ],
  exports: [ShadowPushService, ShadowApiService],
})
export class ShadowModule {}
