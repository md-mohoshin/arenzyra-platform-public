import { Controller, Get } from '@nestjs/common';
import { Public } from '../../common/auth/public.decorator';
import { LiveFeedService } from './live-feed.service';

@Controller()
export class LiveFeedController {
  constructor(private readonly feed: LiveFeedService) {}

  @Public()
  @Get('match/live')
  getMatch() {
    const snap = this.feed.getSnapshot();
    return {
      match: snap.match,
      updatedAt: snap.lastUpdate,
      status: snap.shadowStatus,
    };
  }

  @Public()
  @Get('match/teams')
  getTeams() {
    return this.feed.getSnapshot().teams;
  }

  @Public()
  @Get('match/players')
  getPlayers() {
    return this.feed.getSnapshot().players;
  }

  @Public()
  @Get('match/kills')
  getKills() {
    return this.feed.getSnapshot().kills;
  }

  @Public()
  @Get('match/circle')
  getCircle() {
    return this.feed.getSnapshot().circle;
  }

  @Public()
  @Get('match/observer')
  getObserver() {
    return this.feed.getSnapshot().observer;
  }

  @Public()
  @Get('match/backpack')
  getBackpack() {
    return this.feed.getSnapshot().backpack;
  }

  @Public()
  @Get('health')
  getHealth() {
    const snap = this.feed.getSnapshot();
    return {
      shadowStatus: snap.shadowStatus,
      lastUpdate: snap.lastUpdate,
      lastPollAt: snap.lastPollAt,
      error: snap.lastError ?? null,
    };
  }
}
