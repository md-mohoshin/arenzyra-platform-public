import { Module } from '@nestjs/common';
import { OrgFeaturesController } from './org-features.controller';
import { OrgFeaturesService } from './org-features.service';

@Module({
  controllers: [OrgFeaturesController],
  providers: [OrgFeaturesService],
})
export class OrgFeaturesModule {}
