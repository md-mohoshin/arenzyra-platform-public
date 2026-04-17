import { Module } from '@nestjs/common';
import { AuthModule } from '../../../auth/auth.module';
import { OverlayBroadcaster } from '../../realtime/overlay-broadcaster.service';
import { MatchControlModule } from '../../match-control/match-control.module';
import { PubgmSimController } from './pubgm-sim.controller';
import { PubgmSimService } from './pubgm-sim.service';

@Module({
  imports: [AuthModule, MatchControlModule],
  controllers: [PubgmSimController],
  providers: [OverlayBroadcaster, PubgmSimService],
  exports: [PubgmSimService],
})
export class PubgmSimModule {}
