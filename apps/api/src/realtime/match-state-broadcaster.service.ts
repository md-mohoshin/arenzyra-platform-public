import { Injectable, Logger } from '@nestjs/common';
import type { LiveMatchState } from '../modules/match-control/state.store';
import { MatchControlStateStore } from '../modules/match-control/state.store';
import { RealtimeGateway } from './realtime.gateway';
import { mapStateToDto, type LiveMatchStateDto } from './live-match-state.dto';
import { OverlayBroadcaster } from '../modules/realtime/overlay-broadcaster.service';
import { PrismaService } from '../db/prisma.service';

type KillFeedPayload = {
  matchId: string;
  teamId: string;
  delta: number;
  totalKills: number;
  ts: number;
};

type FightEventPayload = {
  matchId: string;
  type: string;
  [key: string]: unknown;
};

type BroadcastEventPayload = {
  matchId: string;
  type: string;
  [key: string]: unknown;
};

type StorylineEventPayload = {
  matchId: string;
  type: string;
  [key: string]: unknown;
};

type ObserverSuggestionPayload = {
  matchId: string;
  reason: string;
  [key: string]: unknown;
};

@Injectable()
export class MatchStateBroadcaster {
  private readonly logger = new Logger(MatchStateBroadcaster.name);
  private readonly matchOrgCache = new Map<string, string | null>();

  constructor(
    private readonly realtime: RealtimeGateway,
    private readonly stateStore: MatchControlStateStore,
    private readonly overlay: OverlayBroadcaster,
    private readonly prisma: PrismaService,
  ) {}

  private eliminatedByMatch = new Map<string, Set<string>>();

  private room(matchId: string, orgId?: string | null): string {
    return orgId ? `match:${orgId}:${matchId}` : `match:${matchId}`;
  }

  private emit<T>(
    matchId: string,
    event: string,
    payload: T,
    orgId?: string | null,
  ): void {
    if (!this.realtime.io) return;
    this.realtime.io
      .to(`match:${matchId}`)
      .emit(event as never, payload as never);
    if (orgId) {
      this.realtime.io
        .to(this.room(matchId, orgId))
        .emit(event as never, payload as never);
    }
  }

  private async resolveOrganizationId(
    matchId: string,
    organizationId?: string | null,
  ): Promise<string | null> {
    if (organizationId) {
      this.matchOrgCache.set(matchId, organizationId);
      return organizationId;
    }

    if (this.matchOrgCache.has(matchId)) {
      return this.matchOrgCache.get(matchId) ?? null;
    }

    try {
      const match = await this.prisma.match.findFirst({
        where: { id: matchId, deletedAt: null },
        select: {
          organizationId: true,
          controlState: { select: { organizationId: true } },
          tournament: { select: { organizationId: true } },
        },
      });
      const orgId =
        match?.organizationId ??
        match?.controlState?.organizationId ??
        match?.tournament?.organizationId ??
        null;
      this.matchOrgCache.set(matchId, orgId ?? null);
      if (!orgId) {
        this.logger.warn(
          `[Realtime] missing organizationId for match=${matchId} while emitting live state`,
        );
      }
      return orgId ?? null;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `[Realtime] failed to resolve organizationId for match=${matchId}: ${message}`,
      );
      return null;
    }
  }

  async broadcastFull(
    matchId: string,
    organizationId?: string | null,
  ): Promise<LiveMatchStateDto | null> {
    const state = await this.stateStore.get(matchId);
    if (!state) return null;
    const dto = mapStateToDto(state);
    const orgId = await this.resolveOrganizationId(matchId, organizationId);
    this.emit(matchId, 'match:state', dto, orgId);
    this.overlay.broadcastState(matchId, dto, orgId);
    return dto;
  }

  async broadcastUpdate(
    state: LiveMatchState,
    organizationId?: string | null,
  ): Promise<void> {
    const dto = mapStateToDto(state);
    const orgId = await this.resolveOrganizationId(
      state.matchId,
      organizationId,
    );
    this.emit(state.matchId, 'match:state', dto, orgId);
    this.emit(state.matchId, 'match:update', dto, orgId);
    this.emit(state.matchId, 'match_state_updated', dto, orgId);
    this.overlay.broadcastUpdate(state.matchId, dto, orgId);

    // Detect newly eliminated teams and broadcast banner event
    const tracked =
      this.eliminatedByMatch.get(state.matchId) ?? new Set<string>();
    dto.teams.forEach((team) => {
      const isEliminated = (team.alivePlayers ?? 0) === 0;
      if (isEliminated && !tracked.has(team.teamId)) {
        tracked.add(team.teamId);
        this.overlay.broadcastTeamEliminated(
          {
            matchId: state.matchId,
            teamId: team.teamId,
            teamTag: team.tag ?? team.name ?? team.teamId,
            teamLogo: team.logoUrl ?? null,
            position: 'top',
          },
          orgId ?? null,
        );
      }
    });
    this.eliminatedByMatch.set(state.matchId, tracked);
  }

  async broadcastEnd(
    state: LiveMatchState,
    organizationId?: string | null,
  ): Promise<void> {
    const dto = mapStateToDto(state);
    const orgId = await this.resolveOrganizationId(
      state.matchId,
      organizationId,
    );
    this.emit(state.matchId, 'match:end', dto, orgId);
    this.overlay.broadcastEnd(state.matchId, dto, orgId);
    this.eliminatedByMatch.delete(state.matchId);
  }

  async broadcastKillFeed(
    payload: KillFeedPayload,
    organizationId?: string | null,
  ): Promise<void> {
    const orgId = await this.resolveOrganizationId(
      payload.matchId,
      organizationId,
    );
    this.emit(payload.matchId, 'kill:feed', payload, orgId ?? null);
    this.overlay.broadcastKillFeed(payload, orgId ?? null);
  }

  async broadcastFightEvent(
    payload: FightEventPayload,
    organizationId?: string | null,
  ): Promise<void> {
    const orgId = await this.resolveOrganizationId(
      payload.matchId,
      organizationId,
    );
    this.emit(payload.matchId, 'fight:event', payload, orgId ?? null);
  }

  async broadcastBroadcastEvent(
    payload: BroadcastEventPayload,
    organizationId?: string | null,
  ): Promise<void> {
    const orgId = await this.resolveOrganizationId(
      payload.matchId,
      organizationId,
    );
    this.emit(payload.matchId, 'broadcast:event', payload, orgId ?? null);
  }

  async broadcastStorylineEvent(
    payload: StorylineEventPayload,
    organizationId?: string | null,
  ): Promise<void> {
    const orgId = await this.resolveOrganizationId(
      payload.matchId,
      organizationId,
    );
    this.emit(payload.matchId, 'storyline:event', payload, orgId ?? null);
  }

  async broadcastObserverSuggestion(
    payload: ObserverSuggestionPayload,
    organizationId?: string | null,
  ): Promise<void> {
    const orgId = await this.resolveOrganizationId(
      payload.matchId,
      organizationId,
    );
    this.emit(payload.matchId, 'camera:suggest', payload, orgId ?? null);
    this.emit(payload.matchId, 'observer:suggestion', payload, orgId ?? null);
  }
}
