import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { CollectorGuard } from '../../common/auth/collector.guard';
import { Public } from '../../common/auth/public.decorator';
import { IngestBatchDto } from './dto/ingest-batch.dto';
import { IngestService } from './ingest.service';

@Controller('ingest')
@UseGuards(CollectorGuard)
@Public()
export class IngestController {
  constructor(private svc: IngestService) {}

  @Post('batch')
  async batch(@Body() dto: IngestBatchDto) {
    return this.svc.ingestBatch(dto.events);
  }

  @Post('heartbeat')
  heartbeat() {
    return { ok: true, at: new Date().toISOString() };
  }
}
