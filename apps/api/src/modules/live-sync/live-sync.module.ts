import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { LiveSyncService } from './live-sync.service';
import { OverlayGateway } from './overlay.gateway';
import { OverlayController } from './overlay.controller';
import { ResultsModule } from '../results/results.module';

@Module({
  imports: [AuthModule, ResultsModule],
  providers: [LiveSyncService, OverlayGateway],
  controllers: [OverlayController],
})
export class LiveSyncModule {}
