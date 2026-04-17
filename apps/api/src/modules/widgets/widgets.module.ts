import { Module } from '@nestjs/common';
import { WidgetsController } from './widgets.controller';
import { ResultsModule } from '../results/results.module';
import { LiveModule } from '../live/live.module';
import { TopFraggerModule } from './top-fragger/top-fragger.module';
import { MvpModule } from './mvp/mvp.module';
import { OrganizationBrandingModule } from '../organization-branding/organization-branding.module';
import { OrganizationFeatureModule } from '../organization-feature/organization-feature.module';
import { WidgetVersionModule } from '../widget-version/widget-version.module';
import { ObsWidgetInstanceController } from './obs-widget-instance.controller';
import { WidgetInstanceApiController } from './widget-instance.api.controller';
import { WidgetsService } from './widgets.service';
import { RealtimeModule } from '../../realtime/realtime.module';
import { MatchControlStateStore } from '../match-control/state.store';
import { RedisService } from '../../redis/redis.service';

@Module({
  imports: [
    ResultsModule,
    LiveModule,
    TopFraggerModule,
    MvpModule,
    OrganizationBrandingModule,
    OrganizationFeatureModule,
    WidgetVersionModule,
    RealtimeModule,
  ],
  controllers: [
    WidgetsController,
    ObsWidgetInstanceController,
    WidgetInstanceApiController,
  ],
  providers: [WidgetsService, MatchControlStateStore, RedisService],
})
export class WidgetsModule {}
