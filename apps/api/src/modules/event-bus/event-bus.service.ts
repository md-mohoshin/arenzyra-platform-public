import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { randomUUID } from 'crypto';
import { RedisService } from '../../redis/redis.service';
import type { EventBusEnvelope, EventBusTopic } from './event-bus.types';

type PublishOptions = {
  timestamp?: number;
  retryCount?: number;
};

type SubscribeOptions = {
  types?: string[];
  maxRetries?: number;
  retryDelayMs?: number;
  fromStart?: boolean;
};

type Subscription = {
  id: string;
  topic: EventBusTopic;
  subscriberName: string;
  types: Set<string> | null;
  handler: (envelope: EventBusEnvelope) => Promise<void> | void;
  maxRetries: number;
  retryDelayMs: number;
  active: boolean;
  lastId: string;
  reader: Redis | null;
};

@Injectable()
export class EventBusService implements OnModuleDestroy {
  private readonly logger = new Logger(EventBusService.name);
  private readonly instanceId = randomUUID();
  private readonly subscriptions = new Map<string, Subscription>();
  private readonly subscriptionsByTopic = new Map<string, Set<string>>();

  constructor(private readonly redis: RedisService) {}

  async publish<T>(
    topic: EventBusTopic,
    type: string,
    payload: T,
    options: PublishOptions = {},
  ): Promise<EventBusEnvelope<T>> {
    const envelope: EventBusEnvelope<T> = {
      topic,
      type,
      payload,
      timestamp: options.timestamp ?? Date.now(),
      retryCount: options.retryCount ?? 0,
      publisherId: this.instanceId,
    };

    const client = this.redis.getClient();
    if (client) {
      try {
        const streamId = await client.xadd(
          topic,
          'MAXLEN',
          '~',
          10_000,
          '*',
          'type',
          envelope.type,
          'timestamp',
          String(envelope.timestamp),
          'retryCount',
          String(envelope.retryCount),
          'publisherId',
          envelope.publisherId,
          'payload',
          JSON.stringify(envelope.payload ?? {}),
        );
        envelope.id = typeof streamId === 'string' ? streamId : undefined;
      } catch (err) {
        this.logger.warn(
          `Failed to append stream event topic=${topic} type=${type}: ${this.message(err)}`,
        );
      }
    }

    await this.dispatchLocal(envelope);
    return envelope;
  }

  subscribe(
    topic: EventBusTopic,
    subscriberName: string,
    handler: (envelope: EventBusEnvelope) => Promise<void> | void,
    options: SubscribeOptions = {},
  ): () => void {
    const id = `${subscriberName}:${topic}:${randomUUID()}`;
    const subscription: Subscription = {
      id,
      topic,
      subscriberName,
      handler,
      types: options.types?.length ? new Set(options.types) : null,
      maxRetries: Math.max(0, options.maxRetries ?? 3),
      retryDelayMs: Math.max(100, options.retryDelayMs ?? 250),
      active: true,
      lastId: options.fromStart ? '0-0' : '$',
      reader: null,
    };

    this.subscriptions.set(id, subscription);
    const topicSet = this.subscriptionsByTopic.get(topic) ?? new Set<string>();
    topicSet.add(id);
    this.subscriptionsByTopic.set(topic, topicSet);

    this.startRedisReader(subscription);

    return () => {
      subscription.active = false;
      this.subscriptions.delete(id);
      const currentSet = this.subscriptionsByTopic.get(topic);
      currentSet?.delete(id);
      if (currentSet && currentSet.size === 0) {
        this.subscriptionsByTopic.delete(topic);
      }
      try {
        subscription.reader?.disconnect();
      } catch {
        /* ignore */
      }
    };
  }

  onModuleDestroy(): void {
    for (const subscription of this.subscriptions.values()) {
      subscription.active = false;
      try {
        subscription.reader?.disconnect();
      } catch {
        /* ignore */
      }
    }
    this.subscriptions.clear();
    this.subscriptionsByTopic.clear();
  }

  private async dispatchLocal<T>(envelope: EventBusEnvelope<T>): Promise<void> {
    const subscriptionIds = this.subscriptionsByTopic.get(envelope.topic);
    if (!subscriptionIds || subscriptionIds.size === 0) {
      return;
    }
    for (const subscriptionId of subscriptionIds) {
      const subscription = this.subscriptions.get(subscriptionId);
      if (!subscription || !subscription.active) {
        continue;
      }
      await this.invokeHandler(subscription, envelope);
    }
  }

  private startRedisReader(subscription: Subscription): void {
    const publisher = this.redis.getClient();
    if (!publisher) {
      return;
    }

    try {
      subscription.reader = publisher.duplicate();
      void this.readerLoop(subscription);
    } catch (err) {
      this.logger.warn(
        `Failed to start Redis stream reader topic=${subscription.topic} subscriber=${subscription.subscriberName}: ${this.message(err)}`,
      );
      try {
        subscription.reader?.disconnect();
      } catch {
        /* ignore */
      }
      subscription.reader = null;
    }
  }

  private async readerLoop(subscription: Subscription): Promise<void> {
    while (subscription.active && subscription.reader) {
      try {
        const response = await subscription.reader.xread(
          'COUNT',
          25,
          'BLOCK',
          1000,
          'STREAMS',
          subscription.topic,
          subscription.lastId,
        );
        if (!response) {
          continue;
        }

        for (const streamEntry of response as Array<
          [string, Array<[string, string[]]>]
        >) {
          const entries = Array.isArray(streamEntry?.[1]) ? streamEntry[1] : [];
          for (const [id, fields] of entries) {
            subscription.lastId = id;
            const envelope = this.parseEnvelope(subscription.topic, id, fields);
            if (!envelope) {
              continue;
            }
            if (envelope.publisherId === this.instanceId) {
              continue;
            }
            await this.invokeHandler(subscription, envelope);
          }
        }
      } catch (err) {
        if (!subscription.active) {
          return;
        }
        this.logger.warn(
          `Redis stream reader failed topic=${subscription.topic} subscriber=${subscription.subscriberName}: ${this.message(err)}`,
        );
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  }

  private parseEnvelope(
    topic: EventBusTopic,
    id: string,
    fields: string[],
  ): EventBusEnvelope | null {
    const map = new Map<string, string>();
    for (let index = 0; index < fields.length; index += 2) {
      const key = fields[index];
      const value = fields[index + 1];
      if (typeof key === 'string' && typeof value === 'string') {
        map.set(key, value);
      }
    }

    const type = map.get('type');
    const payloadRaw = map.get('payload');
    if (!type || !payloadRaw) {
      return null;
    }

    let payload: unknown = {};
    try {
      payload = JSON.parse(payloadRaw);
    } catch {
      payload = payloadRaw;
    }

    return {
      id,
      topic,
      type,
      timestamp: Number(map.get('timestamp') ?? Date.now()),
      retryCount: Number(map.get('retryCount') ?? 0),
      publisherId: map.get('publisherId') ?? 'unknown',
      payload,
    };
  }

  private async invokeHandler(
    subscription: Subscription,
    envelope: EventBusEnvelope,
  ): Promise<void> {
    if (subscription.types && !subscription.types.has(envelope.type)) {
      return;
    }

    try {
      await subscription.handler(envelope);
    } catch (err) {
      this.logger.warn(
        `Event handler failed topic=${subscription.topic} type=${envelope.type} subscriber=${subscription.subscriberName} retry=${envelope.retryCount}: ${this.message(err)}`,
      );
      if (envelope.retryCount >= subscription.maxRetries) {
        return;
      }

      const delay =
        subscription.retryDelayMs *
        Math.max(1, 2 ** Math.max(0, envelope.retryCount));
      setTimeout(() => {
        void this.publish(subscription.topic, envelope.type, envelope.payload, {
          retryCount: envelope.retryCount + 1,
        });
      }, delay);
    }
  }

  private message(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}
