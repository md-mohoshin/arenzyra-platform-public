import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { LauncherController } from './launcher.controller';
import { LauncherService } from './launcher.service';

@Module({
  imports: [AuthModule],
  controllers: [LauncherController],
  providers: [LauncherService],
  exports: [LauncherService],
})
export class LauncherModule {}
