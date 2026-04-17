import { Module } from '@nestjs/common';
import { VisualAssetsService } from './visual-assets.service';
import { WidgetAssetsController } from './widget-assets.controller';
import { ObsTemplatesController } from './obs-templates.controller';
import { WidgetPresetsController } from './widget-presets.controller';

@Module({
  controllers: [
    WidgetAssetsController,
    ObsTemplatesController,
    WidgetPresetsController,
  ],
  providers: [VisualAssetsService],
  exports: [VisualAssetsService],
})
export class VisualAssetsModule {}
