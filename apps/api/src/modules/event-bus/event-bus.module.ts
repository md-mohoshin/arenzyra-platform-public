import { Global, Module } from '@nestjs/common';
import { RedisService } from '../../redis/redis.service';
import { EventBusService } from './event-bus.service';

@Global()
@Module({
  providers: [RedisService, EventBusService],
  exports: [EventBusService],
})
export class EventBusModule {}
