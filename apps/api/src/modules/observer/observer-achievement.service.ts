import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { createHash } from 'crypto';
import type { BroadcastEvent } from '../broadcast/broadcast-event.engine';
import { EventBusService } from '../event-bus/event-bus.service';
import {
  EVENT_BUS_TOPICS,
  type BroadcastMomentEventPayload,
} from '../event-bus/event-bus.types';
import { RealtimeGateway } from '../../realtime/realtime.gateway';
import { normalizePublicAssetUrl } from '../../common/public-asset-url.util';

export type ObserverAchievementPlayer = {
  id: string | null;
  name: string | null;
  photoUrl: string | null;
};

export type ObserverAchievementTeam = {
  id: string | null;
  name: string | null;
  tag: string | null;
  logoUrl: string | null;
};

export type ObserverAchievementPayload = {
  matchId: string;
  eventId: string;
  type: string;
  player: ObserverAchievementPlayer;
  team: ObserverAchievementTeam;
  timestamp: string;
};

@Injectable()
export class ObserverAchievementService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(ObserverAchievementService.name);
  private readonly achievementBuffer = new Map<
    string,
    ObserverAchievementPayload[]
  >();
  private readonly maxEventsPerMatch = 50;
  private unsubscribe: (() => void) | null = null;

  constructor(
    private readonly eventBus: EventBusService,
    private readonly realtime: RealtimeGateway,
  ) {}

  onModuleInit(): void {
    this.unsubscribe = this.eventBus.subscribe(
      EVENT_BUS_TOPICS.BROADCAST,
      'observer-achievement-stream',
      (envelope) => {
        const payload = this.toObserverAchievementPayload(
          envelope.id,
          envelope.payload as BroadcastMomentEventPayload,
        );
        if (!payload) {
          return;
        }

        if (this.store(payload)) {
          this.realtime.emitObserverAchievement(payload);
        }
      },
      { types: ['broadcast.moment'] },
    );
  }

  onModuleDestroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  list(matchId: string): ObserverAchievementPayload[] {
    const normalizedMatchId = String(matchId || '').trim();
    if (!normalizedMatchId) {
      return [];
    }

    return [...(this.achievementBuffer.get(normalizedMatchId) ?? [])].sort(
      (left, right) => {
        const leftTimestamp = Date.parse(left.timestamp);
        const rightTimestamp = Date.parse(right.timestamp);
        if (leftTimestamp !== rightTimestamp) {
          return leftTimestamp - rightTimestamp;
        }
        return left.eventId.localeCompare(right.eventId);
      },
    );
  }

  private store(payload: ObserverAchievementPayload): boolean {
    const buffer = this.achievementBuffer.get(payload.matchId) ?? [];
    if (buffer.some((event) => event.eventId === payload.eventId)) {
      return false;
    }

    buffer.push(payload);
    while (buffer.length > this.maxEventsPerMatch) {
      buffer.shift();
    }

    this.achievementBuffer.set(payload.matchId, buffer);
    return true;
  }

  private toObserverAchievementPayload(
    envelopeId: string | undefined,
    payload: BroadcastMomentEventPayload,
  ): ObserverAchievementPayload | null {
    const matchId = String(payload?.matchId || '').trim();
    const event = payload?.broadcastEvent;
    if (!matchId || !this.supportsAchievement(event)) {
      return null;
    }

    const playerName = this.stringValue(event.playerName);
    const playerId = this.stringValue(event.playerId);
    const teamName = this.stringValue(event.teamName);
    const teamTag = this.stringValue(event.teamTag);
    const teamId = this.stringValue(event.teamId);

    if (!playerId && !playerName && !teamId && !teamName && !teamTag) {
      return null;
    }

    const timestamp = this.toIsoTimestamp(event.timestamp);
    const eventId = envelopeId ?? this.buildFallbackEventId(matchId, event);

    this.logger.debug(
      `[ObserverAchievement] match=${matchId} type=${event.type} eventId=${eventId}`,
    );

    return {
      matchId,
      eventId,
      type: event.type,
      player: {
        id: playerId,
        name: playerName,
        photoUrl: normalizePublicAssetUrl(
          this.stringValue(event.playerPhotoUrl),
        ),
      },
      team: {
        id: teamId,
        name: teamName,
        tag: teamTag,
        logoUrl: normalizePublicAssetUrl(this.stringValue(event.teamLogoUrl)),
      },
      timestamp,
    };
  }

  private supportsAchievement(
    event: BroadcastEvent | null | undefined,
  ): event is BroadcastEvent {
    return (
      event?.type === 'FIRST_BLOOD' ||
      event?.type === 'TRIPLE_KILL' ||
      event?.type === 'QUADRA_KILL' ||
      event?.type === 'CLUTCH' ||
      event?.type === 'TEAM_WIPE'
    );
  }

  private buildFallbackEventId(matchId: string, event: BroadcastEvent): string {
    const raw = [
      matchId,
      event.type,
      this.stringValue(event.playerId),
      this.stringValue(event.playerName),
      this.stringValue(event.teamId),
      this.stringValue(event.teamName),
      this.stringValue(event.teamTag),
      this.stringValue(event.fightId),
      event.streakCount ?? '',
      event.durationMs ?? '',
      this.toIsoTimestamp(event.timestamp),
    ].join('|');

    return createHash('sha1').update(raw).digest('hex');
  }

  private toIsoTimestamp(value: number | string | null | undefined): string {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return new Date(value).toISOString();
    }
    if (typeof value === 'string' && value.trim().length > 0) {
      const parsed = Date.parse(value);
      if (Number.isFinite(parsed)) {
        return new Date(parsed).toISOString();
      }
    }
    return new Date().toISOString();
  }

  private stringValue(value: unknown): string | null {
    if (typeof value !== 'string') {
      return null;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
}
