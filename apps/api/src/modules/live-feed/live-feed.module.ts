import { Module } from '@nestjs/common';
import { LiveFeedController } from './live-feed.controller';
import { LiveFeedGateway } from './live-feed.gateway';
import { LiveFeedService } from './live-feed.service';
import { MatchControlModule } from '../match-control/match-control.module';

@Module({
  imports: [MatchControlModule],
  controllers: [LiveFeedController],
  providers: [LiveFeedService, LiveFeedGateway],
})
export class LiveFeedModule {}
