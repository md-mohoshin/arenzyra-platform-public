import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { MatchStatus } from '@prisma/client';
import { EventEmitter } from 'events';
import { PrismaService } from '../../db/prisma.service';
import {
  CircleInfo,
  KillEvent,
  LivePlayer,
  LiveSnapshot,
  LiveTeam,
  ObserverInfo,
} from './live-feed.types';
import {
  MatchControlStateStore,
  type LiveMatchState,
} from '../match-control/state.store';

@Injectable()
export class LiveFeedService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('LiveFeed');
  private readonly intervalMs = Math.max(
    500,
    Number(process.env.LIVE_FEED_POLL_INTERVAL_MS ?? 1_000),
  );
  private timer: NodeJS.Timeout | null = null;
  private failureCount = 0;
  private readonly emitter = new EventEmitter();
  private snapshot: LiveSnapshot = {
    match: null,
    teams: [],
    players: [],
    kills: [],
    circle: null,
    observer: null,
    backpack: null,
    shadowStatus: 'error',
    lastUpdate: null,
    lastPollAt: null,
    lastError: null,
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly stateStore: MatchControlStateStore,
  ) {}

  onModuleInit() {
    this.scheduleNext(0);
  }

  onModuleDestroy() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  getSnapshot(): LiveSnapshot {
    return {
      ...this.snapshot,
      teams: [...this.snapshot.teams],
      players: [...this.snapshot.players],
      kills: [...this.snapshot.kills],
    };
  }

  onUpdate(handler: (snapshot: LiveSnapshot) => void) {
    this.emitter.on('update', handler);
    return () => this.emitter.off('update', handler);
  }

  private scheduleNext(delayMs: number) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      void this.poll().catch((err) => this.logger.warn(err));
    }, delayMs);
  }

  private async poll() {
    const started = Date.now();
    try {
      const match = await this.prisma.match.findFirst({
        where: {
          status: MatchStatus.LIVE,
          deletedAt: null,
        },
        select: {
          id: true,
          startedAt: true,
          updatedAt: true,
        },
        orderBy: [{ startedAt: 'desc' }, { updatedAt: 'desc' }],
      });

      if (!match) {
        this.snapshot = {
          match: null,
          teams: [],
          players: [],
          kills: [],
          circle: null,
          observer: null,
          backpack: null,
          shadowStatus: 'ok',
          lastUpdate: started,
          lastPollAt: started,
          lastError: null,
        };
        this.failureCount = 0;
        this.emitter.emit('update', this.getSnapshot());
        return;
      }

      const liveState = await this.stateStore.get(match.id);
      const teams = this.mapTeamsFromState(liveState);
      const players = this.mapPlayersFromState(liveState);
      const kills = this.mapKillsFromState(liveState);
      const circle = this.mapCircleFromState(liveState);
      const observer = this.mapObserverFromState(liveState);

      this.snapshot = {
        match: {
          matchId: match.id,
          status: liveState?.status ?? 'LIVE',
          startedAt: match.startedAt?.toISOString() ?? null,
          updatedAt:
            liveState?.updatedAt ?? match.updatedAt?.toISOString() ?? null,
        },
        teams,
        players,
        kills,
        circle,
        observer,
        backpack: null,
        shadowStatus: 'ok',
        lastUpdate: Date.now(),
        lastPollAt: started,
        lastError: null,
      };
      this.failureCount = 0;
      this.emitter.emit('update', this.getSnapshot());
    } catch (err) {
      this.failureCount += 1;
      const message = err instanceof Error ? err.message : String(err);
      this.snapshot = {
        ...this.snapshot,
        shadowStatus: 'error',
        lastPollAt: started,
        lastError: message,
      };
      this.logger.warn(`Live feed poll failed: ${message}`);
    } finally {
      const backoffFactor = Math.min(this.failureCount + 1, 5);
      this.scheduleNext(this.intervalMs * backoffFactor);
    }
  }

  private mapTeamsFromState(state: LiveMatchState | null): LiveTeam[] {
    return (state?.teams ?? []).map((team, index) => ({
      id: team.teamId ?? `team-${index + 1}`,
      name: team.name ?? null,
      tag: team.tag ?? null,
      slot: team.slot ?? null,
      logoUrl: team.logoUrl ?? null,
      kills: Math.max(0, team.kills ?? 0),
      placement: team.placement ?? null,
      points: team.points ?? null,
      alivePlayers: team.alivePlayers ?? null,
      totalPlayers: team.totalPlayers ?? team.players?.length ?? null,
      alive:
        typeof team.alive === 'boolean'
          ? team.alive
          : (team.alivePlayers ?? 0) > 0,
    }));
  }

  private mapPlayersFromState(state: LiveMatchState | null): LivePlayer[] {
    return (state?.teams ?? []).flatMap((team) =>
      (team.players ?? []).map((player, index) => ({
        id:
          player.playerId ??
          player.id ??
          player.externalPlayerId ??
          player.pubgPlayerId ??
          `player-${team.teamId ?? 'unknown'}-${index + 1}`,
        ign: player.ign ?? player.name ?? null,
        name: player.name ?? player.ign ?? null,
        teamId: team.teamId ?? null,
        photoUrl: player.avatarUrl ?? null,
      })),
    );
  }

  private mapKillsFromState(state: LiveMatchState | null): KillEvent[] {
    return (state?.killFeed ?? []).map((item) => ({
      ts: item.ts,
      killerTeamId: item.killerTeamId ?? null,
      killerName: item.killerName ?? null,
      victimTeamId: item.victimTeamId ?? null,
      victimName: item.victimName ?? null,
      weapon: item.weapon ?? null,
    }));
  }

  private mapCircleFromState(state: LiveMatchState | null): CircleInfo | null {
    if (!state?.circle) {
      return null;
    }
    return {
      phase: state.circle.phase ?? null,
      radius: state.circle.safeZone?.r ?? null,
      shrinking:
        state.circle.nextShrinkAt !== null &&
        state.circle.nextShrinkAt !== undefined
          ? state.circle.nextShrinkAt <= Date.now()
          : undefined,
      nextShrinkAt: state.circle.nextShrinkAt ?? null,
    };
  }

  private mapObserverFromState(
    state: LiveMatchState | null,
  ): ObserverInfo | null {
    if (!state?.observedPlayer) {
      return null;
    }
    return {
      playerName:
        state.observedPlayer.playerIgn ??
        state.observedPlayer.playerName ??
        null,
      playerId:
        state.observedPlayer.playerId ??
        state.observedPlayer.externalPlayerId ??
        state.observedPlayer.pubgPlayerId ??
        null,
      teamId: state.observedPlayer.teamId ?? null,
    };
  }
}
