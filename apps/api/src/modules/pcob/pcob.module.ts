import { Module, forwardRef } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { PcobService } from './pcob.service';
import {
  PcobController,
  PcobFocusController,
  PcobTelemetryIngestController,
} from './pcob.controller';
import { PcobGateway } from './pcob.gateway';
import { RedisService } from '../../redis/redis.service';
import { ScoringService } from '../scoring/scoring.service';
import { LiveService } from '../live/live.service';
import { MapStateService } from '../maps/map-state.service';
import { PcobNormalizerService } from './pcob-normalizer.service';
import { MatchStateCache } from './match-state-cache.service';
import { PcobEventsService } from './pcob-events.service';
import { PcobActiveService } from './pcob-active.service';
import { PcobDedupeService } from './pcob-dedupe.service';
import { PcobDedupeStore } from './pcob-dedupe.store';
import { PcobFocusService } from './pcob-focus.service';
import { PcobHealthService } from './pcob-health.service';
import { FeedModule } from '../feed/feed.module';
import { ScaleService } from './scale.service';
import { ResultsModule } from '../results/results.module';
import { ScoreboardModule } from '../scoreboard/scoreboard.module';
import { MatchesModule } from '../matches/matches.module';
import { MatchControlModule } from '../match-control/match-control.module';
import { PcobSecretGuard } from './pcob-secret.guard';
import { GameAdaptersModule } from '../game-adapters/game-adapters.module';
import { RealtimeModule } from '../../realtime/realtime.module';

@Module({
  imports: [
    AuthModule,
    FeedModule,
    GameAdaptersModule,
    forwardRef(() => ResultsModule),
    forwardRef(() => ScoreboardModule),
    forwardRef(() => MatchesModule),
    forwardRef(() => MatchControlModule),
    forwardRef(() => RealtimeModule),
  ],
  providers: [
    PcobService,
    PcobGateway,
    RedisService,
    ScoringService,
    LiveService,
    MapStateService,
    PcobNormalizerService,
    MatchStateCache,
    PcobEventsService,
    PcobActiveService,
    PcobDedupeService,
    PcobDedupeStore,
    PcobFocusService,
    PcobHealthService,
    ScaleService,
    PcobSecretGuard,
  ],
  controllers: [
    PcobController,
    PcobTelemetryIngestController,
    PcobFocusController,
  ],
  exports: [
    PcobService,
    PcobGateway,
    MapStateService,
    PcobNormalizerService,
    MatchStateCache,
    PcobEventsService,
    PcobActiveService,
    PcobDedupeService,
    PcobDedupeStore,
    PcobFocusService,
    PcobHealthService,
    ScaleService,
  ],
})
export class PcobModule {}
