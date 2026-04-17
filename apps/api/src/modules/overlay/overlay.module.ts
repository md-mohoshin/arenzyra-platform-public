import { Module, forwardRef } from '@nestjs/common';
import { EventBusModule } from '../event-bus/event-bus.module';
import { PcobModule } from '../pcob/pcob.module';
import { BroadcastGateway } from './broadcast.gateway';
import { BroadcastStateService } from './broadcast-state.service';
import { PlayerAchievementMomentBridgeService } from './player-achievement-moment-bridge.service';

@Module({
  imports: [EventBusModule, forwardRef(() => PcobModule)],
  providers: [
    BroadcastGateway,
    BroadcastStateService,
    PlayerAchievementMomentBridgeService,
  ],
  exports: [
    BroadcastGateway,
    BroadcastStateService,
    PlayerAchievementMomentBridgeService,
  ],
})
export class OverlayModule {}
