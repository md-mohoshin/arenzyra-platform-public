import { Module } from '@nestjs/common';
import { MvpService } from './mvp.service';
import { MvpController } from './mvp.controller';
import { AuditModule } from '../../audit/audit.module';

@Module({
  imports: [AuditModule],
  controllers: [MvpController],
  providers: [MvpService],
  exports: [MvpService],
})
export class MvpModule {}
