import { Injectable } from '@nestjs/common';
import type { Socket } from 'socket.io';
import {
  mapStateToDto,
  type LiveMatchStateDto,
} from '../../realtime/live-match-state.dto';
import { MatchControlStateStore } from '../match-control/state.store';
import {
  mapOverlayState,
  type OverlayFocusDto,
  type OverlayKillFeedDto,
  type OverlayMatchStateDto,
} from './dto/overlay.dto';
import type { ScoreboardView } from '../../common/scoreboard/scoreboard.types';
import type { OverlayGateway } from './overlay.gateway';

type OverlayServer = {
  to: (room: string) => {
    emit: <E extends string>(event: E, payload: unknown) => void;
  };
};

@Injectable()
export class OverlayBroadcaster {
  private server: OverlayServer | null = null;
  private readonly killFeedHistory = new Map<string, OverlayKillFeedDto[]>();
  private readonly focusByMatch = new Map<string, OverlayFocusDto | null>();
  private readonly maxKillFeed = 50;
  private readonly eliminatedByMatch = new Map<string, Set<string>>();

  constructor(private readonly stateStore: MatchControlStateStore) {}

  attachGateway(gateway: OverlayGateway) {
    // called by gateway once the server is ready
    this.server = (gateway as unknown as { io?: OverlayServer }).io ?? null;
  }

  async sendInitial(matchId: string, socket: Socket | null) {
    const snapshot = await this.snapshot(matchId);
    if (snapshot && socket) {
      socket.emit('overlay:state', snapshot);
    }
    const live = await this.stateStore.get(matchId);
    const focus =
      this.focusByMatch.get(matchId) ?? this.focusFromLiveState(live ?? null);
    if (focus && socket) {
      socket.emit('overlay:focus', focus);
    }
    const history =
      this.killFeedHistory.get(matchId) ??
      this.killFeedFromLiveState(live ?? null);
    history.forEach((event) => {
      socket?.emit('overlay:killfeed', event);
    });
  }

  async snapshot(matchId: string): Promise<OverlayMatchStateDto | null> {
    const live = await this.stateStore.get(matchId);
    if (!live) return null;
    const dto = mapStateToDto(live);
    const focus =
      this.focusByMatch.get(matchId) ?? this.focusFromLiveState(live);
    return mapOverlayState(dto, focus);
  }

  broadcastState(
    matchId: string,
    state: LiveMatchStateDto,
    organizationId?: string | null,
  ) {
    const overlay = mapOverlayState(
      state,
      this.focusByMatch.get(matchId) ?? this.focusFromLiveState(state) ?? null,
    );
    this.emit(matchId, 'overlay:state', overlay, organizationId);
  }

  broadcastUpdate(
    matchId: string,
    state: LiveMatchStateDto,
    organizationId?: string | null,
  ) {
    const overlay = mapOverlayState(
      state,
      this.focusByMatch.get(matchId) ?? this.focusFromLiveState(state) ?? null,
    );
    this.emit(matchId, 'overlay:update', overlay, organizationId);
  }

  broadcastEnd(
    matchId: string,
    state: LiveMatchStateDto,
    organizationId?: string | null,
  ) {
    const overlay = mapOverlayState(
      state,
      this.focusByMatch.get(matchId) ?? this.focusFromLiveState(state) ?? null,
    );
    this.emit(matchId, 'overlay:end', overlay, organizationId);
  }

  broadcastKillFeed(
    payload: OverlayKillFeedDto,
    organizationId?: string | null,
  ) {
    this.pushKillFeed(payload);
    this.emit(payload.matchId, 'overlay:killfeed', payload, organizationId);
  }

  broadcastFocus(
    matchId: string,
    focus: OverlayFocusDto | null,
    organizationId?: string | null,
  ) {
    this.focusByMatch.set(matchId, focus ?? null);
    this.emit(matchId, 'overlay:focus', focus ?? null, organizationId);
  }

  broadcastScoreboard(view: ScoreboardView, organizationId?: string | null) {
    this.emit(view.matchId, 'scoreboard:update', view, organizationId);
  }

  broadcastTeamEliminated(
    payload: {
      matchId: string;
      teamId: string;
      teamTag: string | null;
      teamLogo?: string | null;
      position?: 'top' | 'bottom';
    },
    organizationId?: string | null,
  ) {
    this.emit(
      payload.matchId,
      'overlay:teamEliminated',
      payload,
      organizationId,
    );
    const set =
      this.eliminatedByMatch.get(payload.matchId) ?? new Set<string>();
    set.add(payload.teamId);
    this.eliminatedByMatch.set(payload.matchId, set);
  }

  broadcastControlStateChanged(payload: {
    matchId: string;
    previousState: string;
    state: string;
    updatedAt: string;
    reason?: string | null;
    meta?: unknown;
  }) {
    this.emit(payload.matchId, 'match.control_state.changed', payload);
  }

  async forceSync(matchId: string, organizationId?: string | null) {
    const snapshot = await this.snapshot(matchId);
    if (!snapshot) return;
    this.emit(matchId, 'overlay:state', snapshot, organizationId ?? null);
  }

  evictMatches(matchIds: string[], organizationId?: string | null) {
    const unique = Array.from(new Set(matchIds));
    for (const matchId of unique) {
      this.killFeedHistory.delete(matchId);
      this.focusByMatch.delete(matchId);
      this.eliminatedByMatch.delete(matchId);
      this.emit(matchId, 'overlay:end', {}, organizationId);
    }
  }

  private emit(
    matchId: string,
    event: string,
    payload: unknown,
    organizationId?: string | null,
  ) {
    if (!this.server) return;
    this.server.to(this.room(matchId, organizationId)).emit(event, payload);
  }

  private room(matchId: string, organizationId?: string | null): string {
    return organizationId
      ? `overlay:${organizationId}:${matchId}`
      : `overlay:${matchId}`;
  }

  private pushKillFeed(payload: OverlayKillFeedDto) {
    const list = this.killFeedHistory.get(payload.matchId) ?? [];
    list.push(payload);
    if (list.length > this.maxKillFeed) {
      list.splice(0, list.length - this.maxKillFeed);
    }
    this.killFeedHistory.set(payload.matchId, list);
  }

  private focusFromLiveState(
    live: {
      observedPlayer?: LiveMatchStateDto['observedPlayer'];
    } | null,
  ): OverlayFocusDto | null {
    const observed = live?.observedPlayer ?? null;
    if (!observed) return null;
    return {
      teamId: observed.teamId ?? null,
      playerId: observed.playerId ?? null,
      teamName: observed.teamName ?? null,
      teamTag: observed.teamTag ?? null,
      teamLogoUrl: observed.teamLogoUrl ?? null,
      playerName: observed.playerName ?? null,
      playerIgn: observed.playerIgn ?? null,
    };
  }

  private killFeedFromLiveState(
    live: {
      killFeed?: LiveMatchStateDto['killFeed'];
      matchId?: string;
    } | null,
  ): OverlayKillFeedDto[] {
    const items: OverlayKillFeedDto[] = [];
    for (const item of live?.killFeed ?? []) {
      if (
        typeof item.killerTeamId !== 'string' ||
        typeof item.totalKills !== 'number'
      ) {
        continue;
      }
      items.push({
        matchId: live?.matchId ?? '',
        teamId: item.killerTeamId,
        delta: item.delta ?? 1,
        totalKills: item.totalKills,
        ts: item.ts,
      });
    }
    return items;
  }
}
