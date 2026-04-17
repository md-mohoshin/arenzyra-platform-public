import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Subject, Observable } from 'rxjs';
import { FeedEnvelope } from './feed.types';

@Injectable()
export class FeedBusService implements OnModuleInit {
  private readonly subject = new Subject<FeedEnvelope>();
  private readonly logger = new Logger('FeedBus');

  onModuleInit() {
    if (process.env.FEED_BUS_LOG === 'true') {
      this.subject.subscribe((evt) => {
        this.logger.debug(
          `feed event source=${evt.source} match=${evt.matchId} session=${evt.sessionId} type=${evt.type}`,
        );
      });
    }
  }

  publish(event: FeedEnvelope) {
    this.subject.next(event);
  }

  stream(): Observable<FeedEnvelope> {
    return this.subject.asObservable();
  }
}
