import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { OrganizationBrandingModule } from '../organization-branding/organization-branding.module';
import { ResultsModule } from '../results/results.module';
import { SessionsModule } from '../sessions/sessions.module';
import { RenderController } from './render.controller';
import { RenderService } from './render.service';

@Module({
  imports: [
    AuthModule,
    ResultsModule,
    SessionsModule,
    OrganizationBrandingModule,
  ],
  controllers: [RenderController],
  providers: [RenderService],
  exports: [RenderService],
})
export class RenderModule {}
