import { Module } from '@nestjs/common';
import { PlatformAdminController } from './platform-admin.controller';
import { MeOrganizationsController } from './me.organizations.controller';
import { PlatformAdminService } from './platform-admin.service';
import { VisualAssetsModule } from '../visual-assets/visual-assets.module';
import { OrganizationFeatureModule } from '../organization-feature/organization-feature.module';

@Module({
  imports: [VisualAssetsModule, OrganizationFeatureModule],
  controllers: [PlatformAdminController, MeOrganizationsController],
  providers: [PlatformAdminService],
})
export class PlatformAdminModule {}
