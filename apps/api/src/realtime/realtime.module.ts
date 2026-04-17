import 'dotenv/config';
import { Module, forwardRef } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { RealtimeGateway } from './realtime.gateway';
import { PcobNamespaceGateway } from './pcob-namespace.gateway';
import { MatchStateBroadcaster } from './match-state-broadcaster.service';
import { MatchControlStateStore } from '../modules/match-control/state.store';
import { RedisService } from '../redis/redis.service';
import { OverlayGateway } from '../modules/realtime/overlay.gateway';
import { OverlayBroadcaster } from '../modules/realtime/overlay-broadcaster.service';
import { RankingEmitterService } from './ranking-emitter.service';
import { MatchLiveStateController } from '../modules/realtime/match-live-state.controller';
import { ResultsModule } from '../modules/results/results.module';
import { ScoringModule } from '../modules/scoring/scoring.module';
import { MatchStreamService } from '../modules/realtime/match-stream.service';
import { MatchPhaseController } from '../modules/realtime/match-phase.controller';
import { MatchesModule } from '../modules/matches/matches.module';
import { MatchControlModule } from '../modules/match-control/match-control.module';
import { CanonicalControlReadService } from '../modules/realtime/canonical-control-read.service';
import { env } from '../config/env.validation';

const secret = env.JWT_SECRET;

@Module({
  imports: [
    forwardRef(() => ResultsModule),
    forwardRef(() => ScoringModule),
    forwardRef(() => MatchesModule),
    forwardRef(() => MatchControlModule),
    JwtModule.register({
      secret,
      signOptions: { expiresIn: '12h' },
    }),
  ],
  controllers: [MatchLiveStateController, MatchPhaseController],
  providers: [
    RealtimeGateway,
    PcobNamespaceGateway,
    MatchStateBroadcaster,
    OverlayGateway,
    OverlayBroadcaster,
    MatchControlStateStore,
    RedisService,
    RankingEmitterService,
    MatchStreamService,
    CanonicalControlReadService,
  ],
  exports: [
    RealtimeGateway,
    PcobNamespaceGateway,
    MatchStateBroadcaster,
    OverlayGateway,
    OverlayBroadcaster,
    MatchControlStateStore,
    RankingEmitterService,
    MatchStreamService,
    CanonicalControlReadService,
  ],
})
export class RealtimeModule {}
