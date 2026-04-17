import { Module } from '@nestjs/common';
import { OrganizationFeatureService } from './organization-feature.service';
import { OrganizationFeatureController } from './organization-feature.controller';
import { RealtimeModule } from '../../realtime/realtime.module';

@Module({
  imports: [RealtimeModule],
  providers: [OrganizationFeatureService],
  controllers: [OrganizationFeatureController],
  exports: [OrganizationFeatureService],
})
export class OrganizationFeatureModule {}
