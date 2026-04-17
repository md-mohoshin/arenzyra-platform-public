import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { CollectorGuard } from '../../common/auth/collector.guard';
import { ScoringModule } from '../scoring/scoring.module';
import { ResultsModule } from '../results/results.module';
import { IngestController } from './ingest.controller';
import { IngestService } from './ingest.service';
import { ScreenshotIngestController } from './screenshot-ingest.controller';
import { ScreenshotIngestService } from './screenshot-ingest.service';
import { ScreenshotParserService } from './screenshot-parser.service';

@Module({
  imports: [AuthModule, ScoringModule, ResultsModule],
  controllers: [IngestController, ScreenshotIngestController],
  providers: [
    IngestService,
    ScreenshotIngestService,
    ScreenshotParserService,
    CollectorGuard,
  ],
})
export class IngestModule {}
