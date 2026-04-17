import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import type { BroadcastEvent } from '../broadcast/broadcast-event.engine';
import { EventBusService } from '../event-bus/event-bus.service';
import {
  EVENT_BUS_TOPICS,
  type BroadcastMomentEventPayload,
} from '../event-bus/event-bus.types';
import { BroadcastGateway } from './broadcast.gateway';

@Injectable()
export class PlayerAchievementMomentBridgeService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(
    PlayerAchievementMomentBridgeService.name,
  );
  private unsubscribe: (() => void) | null = null;

  constructor(
    private readonly eventBus: EventBusService,
    private readonly broadcastGateway: BroadcastGateway,
  ) {}

  onModuleInit(): void {
    this.unsubscribe = this.eventBus.subscribe(
      EVENT_BUS_TOPICS.BROADCAST,
      'overlay-player-achievement-bridge',
      (envelope) => {
        const payload = envelope.payload as BroadcastMomentEventPayload;
        const overlayPayload = this.toOverlayPayload(payload);
        if (!overlayPayload) {
          return;
        }

        this.broadcastGateway.emitPlayerAchievement(overlayPayload);
      },
      { types: ['broadcast.moment'] },
    );
  }

  onModuleDestroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  private toOverlayPayload(payload: BroadcastMomentEventPayload) {
    const event = payload.broadcastEvent;
    if (!this.supportsAchievement(event)) {
      return null;
    }
    if (
      !event.playerId &&
      !event.playerName &&
      !event.teamTag &&
      !event.teamName
    ) {
      return null;
    }

    this.logger.debug(
      `[AchievementBridge] match=${payload.matchId} type=${event.type} player=${event.playerId ?? 'none'}`,
    );

    return {
      matchId: payload.matchId,
      organizationId: payload.organizationId ?? null,
      playerId: event.playerId ?? null,
      playerName: event.playerName ?? null,
      playerPhotoUrl: event.playerPhotoUrl ?? null,
      teamId: event.teamId ?? null,
      teamName: event.teamName ?? null,
      teamTag: event.teamTag ?? null,
      teamLogoUrl: event.teamLogoUrl ?? null,
      achievementType: event.type,
    };
  }

  private supportsAchievement(event: BroadcastEvent): boolean {
    return (
      event.type === 'FIRST_BLOOD' ||
      event.type === 'TRIPLE_KILL' ||
      event.type === 'QUADRA_KILL' ||
      event.type === 'CLUTCH' ||
      event.type === 'TEAM_WIPE'
    );
  }
}
