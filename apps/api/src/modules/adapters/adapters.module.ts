import { Module } from '@nestjs/common';
import { AdaptersController } from './adapters.controller';
import { AdaptersService } from './adapters.service';
import { AuthModule } from '../../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [AdaptersController],
  providers: [AdaptersService],
  exports: [AdaptersService],
})
export class AdaptersModule {}
