import { Module, forwardRef } from '@nestjs/common';
import { BroadcastController } from './broadcast.controller';
import { OrgBroadcastController } from './org-broadcast.controller';
import { BroadcastService } from './broadcast.service';
import { WidgetBroadcastGateway } from './broadcast.gateway';
import { BroadcastOrganizationsController } from './broadcast-organizations.controller';
import { LiveBattleRankingService } from '../widgets/live-battle-ranking.service';
import { OverlayModule } from '../overlay/overlay.module';
import { RealtimeModule } from '../../realtime/realtime.module';
import { PcobModule } from '../pcob/pcob.module';
import { OrganizationBrandingModule } from '../organization-branding/organization-branding.module';

@Module({
  imports: [
    forwardRef(() => OverlayModule),
    forwardRef(() => RealtimeModule),
    forwardRef(() => PcobModule),
    forwardRef(() => OrganizationBrandingModule),
  ],
  controllers: [
    BroadcastController,
    OrgBroadcastController,
    BroadcastOrganizationsController,
  ],
  providers: [
    BroadcastService,
    WidgetBroadcastGateway,
    LiveBattleRankingService,
  ],
  exports: [BroadcastService, WidgetBroadcastGateway, LiveBattleRankingService],
})
export class BroadcastModule {}
