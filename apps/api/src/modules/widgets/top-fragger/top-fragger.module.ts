import { Module } from '@nestjs/common';
import { TopFraggerService } from './top-fragger.service';
import { TopFraggerController } from './top-fragger.controller';
import { AuditModule } from '../../audit/audit.module';

@Module({
  imports: [AuditModule],
  controllers: [TopFraggerController],
  providers: [TopFraggerService],
  exports: [TopFraggerService],
})
export class TopFraggerModule {}
