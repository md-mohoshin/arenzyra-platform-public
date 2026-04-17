import { Module, forwardRef } from '@nestjs/common';
import { RealtimeModule } from '../../realtime/realtime.module';
import { ScoreboardController } from './scoreboard.controller';
import { ScoreboardService } from './scoreboard.service';
import { BroadcastModule } from '../broadcast/broadcast.module';
import { AuthModule } from '../../auth/auth.module';

@Module({
  imports: [
    AuthModule,
    forwardRef(() => RealtimeModule),
    forwardRef(() => BroadcastModule),
  ],
  controllers: [ScoreboardController],
  providers: [ScoreboardService],
  exports: [ScoreboardService],
})
export class ScoreboardModule {}
