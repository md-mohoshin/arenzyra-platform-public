import { Module } from '@nestjs/common';
import { FeedBusService } from './feed-bus.service';
import { FeedAuditService } from './feed-audit.service';

@Module({
  providers: [FeedBusService, FeedAuditService],
  exports: [FeedBusService, FeedAuditService],
})
export class FeedModule {}
