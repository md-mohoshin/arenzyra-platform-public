import { Module } from '@nestjs/common';
import { WidgetVersionService } from './widget-version.service';
import { WidgetVersionController } from './widget-version.controller';
import { RealtimeModule } from '../../realtime/realtime.module';

@Module({
  imports: [RealtimeModule],
  providers: [WidgetVersionService],
  controllers: [WidgetVersionController],
  exports: [WidgetVersionService],
})
export class WidgetVersionModule {}
