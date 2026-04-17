import { Module, forwardRef } from '@nestjs/common';
import { AdaptersModule } from '../adapters/adapters.module';
import { RedisService } from '../../redis/redis.service';
import { GameAdapterTelemetryService } from './game-adapter-telemetry.service';
import {
  GameAdaptersResolver,
  GAME_ADAPTERS_TOKEN,
} from './game-adapters.resolver';
import { NullAdapter } from './null.adapter';
import { PcobAdapter } from './pubgm/pcob.adapter';
import { PubgmAdapter } from './pubgm/pubgm.adapter';
import { MatchControlModule } from '../match-control/match-control.module';
import { TelemetryModule } from '../telemetry/telemetry.module';

@Module({
  imports: [
    AdaptersModule,
    forwardRef(() => MatchControlModule),
    forwardRef(() => TelemetryModule),
  ],
  providers: [
    RedisService,
    NullAdapter,
    PubgmAdapter,
    PcobAdapter,
    {
      provide: GAME_ADAPTERS_TOKEN,
      useFactory: (
        nullAdapter: NullAdapter,
        pubgm: PubgmAdapter,
        pcob: PcobAdapter,
      ) => [pubgm, pcob, nullAdapter],
      inject: [NullAdapter, PubgmAdapter, PcobAdapter],
    },
    GameAdaptersResolver,
    GameAdapterTelemetryService,
  ],
  exports: [GameAdaptersResolver, GameAdapterTelemetryService],
})
export class GameAdaptersModule {}
