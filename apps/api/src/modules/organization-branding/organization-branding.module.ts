import { Module, forwardRef } from '@nestjs/common';
import { OrganizationBrandingController } from './organization-branding.controller';
import { OrganizationBrandingService } from './organization-branding.service';
import { RealtimeModule } from '../../realtime/realtime.module';

@Module({
  imports: [forwardRef(() => RealtimeModule)],
  controllers: [OrganizationBrandingController],
  providers: [OrganizationBrandingService],
  exports: [OrganizationBrandingService],
})
export class OrganizationBrandingModule {}
