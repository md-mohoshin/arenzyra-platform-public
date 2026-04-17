import { Module } from '@nestjs/common';
import { SuperApplicationsController } from './super-applications.controller';
import { SuperOrganizationsController } from './super-organizations.controller';
import { SuperService } from './super.service';
import { SuperUsersController } from './super-users.controller';
import { AuthModule } from '../../auth/auth.module';
import { VisualAssetsModule } from '../visual-assets/visual-assets.module';
import { OrganizationFeatureModule } from '../organization-feature/organization-feature.module';
import { SuperAdminModule } from '../super-admin/super-admin.module';
import { SuperAdminGuard } from '../../common/auth/super-admin.guard';

@Module({
  imports: [
    AuthModule,
    VisualAssetsModule,
    OrganizationFeatureModule,
    // Import the legacy super-admin module so its endpoints remain available.
    SuperAdminModule,
  ],
  controllers: [
    SuperApplicationsController,
    SuperOrganizationsController,
    SuperUsersController,
  ],
  providers: [SuperService, SuperAdminGuard],
})
export class SuperModule {}
