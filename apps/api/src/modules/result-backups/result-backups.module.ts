import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { RenderModule } from '../render/render.module';
import { ResultBackupsController } from './result-backups.controller';
import { ResultBackupsService } from './result-backups.service';

@Module({
  imports: [AuthModule, RenderModule],
  controllers: [ResultBackupsController],
  providers: [ResultBackupsService],
  exports: [ResultBackupsService],
})
export class ResultBackupsModule {}
