import { Module, forwardRef } from '@nestjs/common';
import { ExportService } from './export.service';
import { ExportController } from './export.controller';
import { PcobModule } from '../pcob/pcob.module';
import { ObserverModule } from '../observer/observer.module';
import { WebhookModule } from '../webhook/webhook.module';

@Module({
  imports: [PcobModule, forwardRef(() => ObserverModule), WebhookModule],
  providers: [ExportService],
  controllers: [ExportController],
})
export class ExportModule {}
