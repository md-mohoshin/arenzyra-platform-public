import { Injectable, Optional } from '@nestjs/common';
import { PrismaService } from '../../../db/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { AuditAction, MatchEventType, MatchStatus } from '@prisma/client';
import { MvpPlayer, MvpState } from './mvp.types';
import { resolvePlayerPhotoUrl, resolveTeamLogoUrl } from '../widgets.snapshot';
import { isMatchFinishedStatus } from '../../../common/match-status.util';

type AuditLogAction =
  | AuditAction
  | 'MVP_FINALIZE'
  | 'MVP_OVERRIDE'
  | 'MVP_SHOW'
  | 'MVP_HIDE'
  | 'MVP_REPLAY';

type SurvivalContext = {
  matchDurationSeconds: number | null;
  deathsByName: Map<string, number>;
};

@Injectable()
export class MvpService {
  private store = new Map<string, MvpState>();

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly audit?: AuditService,
  ) {}

  private async getMatchStatus(matchId: string): Promise<MatchStatus> {
    const match = await this.prisma.match.findUnique({
      where: { id: matchId },
      select: { status: true },
    });
    return match?.status ?? 'DRAFT';
  }

  private scorePlayer(opts: {
    kills: number;
    assists: number;
    isAlive?: boolean | null;
    survivalTime?: number | null;
    placement?: number | null;
  }) {
    const { kills, assists, isAlive, survivalTime, placement } = opts;
    const placementBonus = placement ? Math.max(0, 21 - placement) : 0;
    const survivalScore = survivalTime
      ? Math.min(10, Math.round(survivalTime / 180))
      : 0;
    const aliveBonus = isAlive === true ? 2 : 0;
    return (
      kills * 6 + assists * 4 + placementBonus + survivalScore + aliveBonus
    );
  }

  private normalizeName(value: string | null | undefined): string | null {
    const normalized = value?.trim().toLowerCase();
    return normalized ? normalized : null;
  }

  private asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  }

  private stringValue(value: unknown): string | null {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : null;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }
    return null;
  }

  private numberValue(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string' && value.trim().length > 0) {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  }

  private async buildSurvivalContext(
    matchId: string,
  ): Promise<SurvivalContext> {
    const killEvents = await this.prisma.matchEvent.findMany({
      where: { matchId, type: MatchEventType.KILL },
      select: { payload: true, rawPayload: true },
    });
    const deathsByName = new Map<string, number>();
    let maxGameTime: number | null = null;

    for (const event of killEvents) {
      const payload = this.asRecord(event.payload);
      const raw = this.asRecord(event.rawPayload);
      const gameTime =
        this.numberValue(raw?.CurGameTime) ??
        this.numberValue(raw?.curGameTime) ??
        this.numberValue(raw?.GameTime) ??
        this.numberValue(raw?.gameTime) ??
        this.numberValue(payload?.CurGameTime) ??
        this.numberValue(payload?.curGameTime);

      if (gameTime !== null) {
        maxGameTime =
          maxGameTime === null ? gameTime : Math.max(maxGameTime, gameTime);
      }

      const victimName = this.normalizeName(
        this.stringValue(raw?.VictimName) ??
          this.stringValue(raw?.victimName) ??
          this.stringValue(payload?.victimName) ??
          this.stringValue(payload?.victim),
      );
      if (!victimName || gameTime === null) {
        continue;
      }

      const previous = deathsByName.get(victimName);
      deathsByName.set(
        victimName,
        previous === undefined ? gameTime : Math.min(previous, gameTime),
      );
    }

    return {
      matchDurationSeconds:
        maxGameTime !== null ? Math.max(0, Math.round(maxGameTime)) : null,
      deathsByName,
    };
  }

  private resolveSurvivalTime(opts: {
    playerName: string;
    placement: number | null;
    isAlive: boolean | null;
    context: SurvivalContext;
  }): number | null {
    const playerKey = this.normalizeName(opts.playerName);
    const deathTime = playerKey
      ? opts.context.deathsByName.get(playerKey)
      : null;
    if (deathTime !== null && deathTime !== undefined) {
      return Math.max(0, Math.round(deathTime));
    }
    if (opts.isAlive === true || opts.placement === 1) {
      return opts.context.matchDurationSeconds;
    }
    return null;
  }

  private async computeAuto(matchId: string): Promise<MvpPlayer | null> {
    const [players, survivalContext] = await Promise.all([
      this.prisma.matchSlotPlayerResult.findMany({
        where: { slotResult: { matchId } },
        include: {
          player: {
            select: {
              id: true,
              ign: true,
              realName: true,
              photoUrl: true,
              updatedAt: true,
            },
          },
          slotResult: {
            select: {
              placement: true,
              team: {
                select: {
                  id: true,
                  name: true,
                  tag: true,
                  logoUrl: true,
                  updatedAt: true,
                },
              },
            },
          },
        },
      }),
      this.buildSurvivalContext(matchId),
    ]);

    if (!players.length) return null;

    const rows: Array<MvpPlayer & { isAlive: boolean | null }> = players.map(
      (p) => {
        const kills = p.kills ?? 0;
        const assists = Math.max(0, p.assists ?? 0);
        const placement = p.slotResult?.placement ?? null;
        const ign =
          p.player?.ign ?? p.playerName ?? p.player?.realName ?? 'Unknown';
        const isAlive = p.isAlive ?? p.alive ?? null;
        const survivalTime = this.resolveSurvivalTime({
          playerName: ign,
          placement,
          isAlive,
          context: survivalContext,
        });
        const score = this.scorePlayer({
          kills,
          assists,
          isAlive,
          survivalTime,
          placement,
        });
        return {
          playerId: p.playerId ?? p.id,
          ign,
          photoUrl:
            resolvePlayerPhotoUrl({
              photoUrl: p.player?.photoUrl ?? null,
              photoUpdatedAt: p.player?.updatedAt ?? null,
              updatedAt: p.player?.updatedAt ?? null,
            }) ?? null,
          teamId: p.slotResult?.team?.id ?? null,
          teamName:
            p.slotResult?.team?.name ??
            p.slotResult?.team?.tag ??
            (p.slotResult?.team ? 'Team' : null),
          teamLogo: resolveTeamLogoUrl(p.slotResult?.team ?? null),
          kills,
          assists,
          placement,
          isAlive,
          survivalTime,
          mvpScore: score,
        };
      },
    );

    const sorted = rows.sort((a, b) => {
      if (b.mvpScore !== a.mvpScore) return b.mvpScore - a.mvpScore;
      if (b.kills !== a.kills) return b.kills - a.kills;
      if (b.assists !== a.assists) return b.assists - a.assists;
      const aPlacement = a.placement ?? Number.MAX_SAFE_INTEGER;
      const bPlacement = b.placement ?? Number.MAX_SAFE_INTEGER;
      if (aPlacement !== bPlacement) return aPlacement - bPlacement;
      if ((b.survivalTime ?? 0) !== (a.survivalTime ?? 0))
        return (b.survivalTime ?? 0) - (a.survivalTime ?? 0);
      if ((b.isAlive === true) !== (a.isAlive === true))
        return b.isAlive === true ? 1 : -1;
      return a.ign.localeCompare(b.ign);
    });

    const winner = sorted[0];
    if (!winner) return null;
    return {
      playerId: winner.playerId,
      ign: winner.ign,
      photoUrl: winner.photoUrl,
      teamId: winner.teamId,
      teamName: winner.teamName,
      teamLogo: winner.teamLogo,
      kills: winner.kills,
      assists: winner.assists,
      placement: winner.placement,
      survivalTime: winner.survivalTime,
      mvpScore: winner.mvpScore,
    };
  }

  private getState(matchId: string): MvpState {
    const existing = this.store.get(matchId);
    if (existing) return existing;
    const state: MvpState = {
      matchId,
      finalized: false,
      player: null,
      overridePlayerId: null,
      version: Date.now(),
      show: false,
    };
    this.store.set(matchId, state);
    return state;
  }

  async finalize(matchId: string, overridePlayerId?: string | null) {
    const status = await this.getMatchStatus(matchId);
    if (!isMatchFinishedStatus(status)) {
      throw new Error('MATCH_NOT_ENDED');
    }
    const state = this.getState(matchId);
    const player =
      overridePlayerId && state.player?.playerId === overridePlayerId
        ? state.player
        : overridePlayerId
          ? await this.loadPlayerFromId(matchId, overridePlayerId)
          : await this.computeAuto(matchId);
    if (!player) throw new Error('MVP_NOT_AVAILABLE');
    state.player = player;
    state.finalized = true;
    state.overridePlayerId = overridePlayerId ?? null;
    state.show = false;
    state.version = Date.now();
    await this.log(matchId, 'MVP_FINALIZE', { playerId: player.playerId });
    return state;
  }

  async override(matchId: string, playerId: string) {
    const player = await this.loadPlayerFromId(matchId, playerId);
    if (!player) throw new Error('PLAYER_NOT_FOUND');
    const state = this.getState(matchId);
    state.player = player;
    state.overridePlayerId = playerId;
    state.finalized = false;
    state.show = false;
    state.version = Date.now();
    await this.log(matchId, 'MVP_OVERRIDE', { playerId });
    return state;
  }

  async autoDetect(matchId: string) {
    const player = await this.computeAuto(matchId);
    const state = this.getState(matchId);
    state.player = player;
    state.finalized = false;
    state.version = Date.now();
    return state;
  }

  async show(matchId: string) {
    const state = this.getState(matchId);
    if (!state.finalized) throw new Error('MVP_NOT_FINALIZED');
    state.show = true;
    state.version = Date.now();
    await this.log(matchId, 'MVP_SHOW', {
      playerId: state.player?.playerId ?? null,
    });
    return state;
  }

  async hide(matchId: string) {
    const state = this.getState(matchId);
    state.show = false;
    state.version = Date.now();
    await this.log(matchId, 'MVP_HIDE', {
      playerId: state.player?.playerId ?? null,
    });
    return state;
  }

  async replay(matchId: string) {
    const state = this.getState(matchId);
    if (!state.finalized) throw new Error('MVP_NOT_FINALIZED');
    state.show = true;
    state.version = Date.now();
    await this.log(matchId, 'MVP_REPLAY', {
      playerId: state.player?.playerId ?? null,
    });
    return state;
  }

  async state(matchId: string) {
    const status = await this.getMatchStatus(matchId);
    const state = this.getState(matchId);
    if (!state.finalized && isMatchFinishedStatus(status)) {
      try {
        await this.finalize(matchId, state.overridePlayerId ?? null);
      } catch {
        // Preserve the best-effort auto candidate even if finalization cannot complete.
      }
    }
    if (!state.player) {
      state.player = await this.computeAuto(matchId);
      state.version = Date.now();
    }
    return {
      matchStatus: status,
      ...state,
    };
  }

  private async loadPlayerFromId(
    matchId: string,
    playerId: string,
  ): Promise<MvpPlayer | null> {
    const rec = await this.prisma.matchSlotPlayerResult.findFirst({
      where: {
        slotResult: { matchId },
        OR: [{ playerId }, { player: { id: playerId } }],
      },
      include: {
        player: {
          select: {
            id: true,
            ign: true,
            realName: true,
            photoUrl: true,
            updatedAt: true,
          },
        },
        slotResult: {
          select: {
            placement: true,
            team: {
              select: {
                id: true,
                name: true,
                tag: true,
                logoUrl: true,
                updatedAt: true,
              },
            },
          },
        },
      },
    });
    if (!rec) return null;
    const kills = rec.kills ?? 0;
    const assists = Math.max(0, rec.assists ?? 0);
    const placement = rec.slotResult?.placement ?? null;
    const ign =
      rec.player?.ign ?? rec.playerName ?? rec.player?.realName ?? 'Unknown';
    const isAlive = rec.isAlive ?? rec.alive ?? null;
    const survivalContext = await this.buildSurvivalContext(matchId);
    const survivalTime = this.resolveSurvivalTime({
      playerName: ign,
      placement,
      isAlive,
      context: survivalContext,
    });
    return {
      playerId: rec.playerId ?? rec.id,
      ign,
      photoUrl:
        resolvePlayerPhotoUrl({
          photoUrl: rec.player?.photoUrl ?? null,
          photoUpdatedAt: rec.player?.updatedAt ?? null,
          updatedAt: rec.player?.updatedAt ?? null,
        }) ?? null,
      teamId: rec.slotResult?.team?.id ?? null,
      teamName:
        rec.slotResult?.team?.name ??
        rec.slotResult?.team?.tag ??
        (rec.slotResult?.team ? 'Team' : null),
      teamLogo: resolveTeamLogoUrl(rec.slotResult?.team ?? null),
      kills,
      assists,
      placement,
      survivalTime,
      mvpScore: this.scorePlayer({
        kills,
        assists,
        placement,
        isAlive,
        survivalTime,
      }),
    };
  }

  private async log(
    matchId: string,
    _action: AuditLogAction,
    _meta: Record<string, unknown>,
  ): Promise<void> {
    // Audit service requires org/user context; ignore failures and keep non-blocking.
    if (!this.audit) return;
    const match = await this.prisma.match.findUnique({
      where: { id: matchId },
      select: {
        organizationId: true,
        tournament: { select: { organizationId: true } },
      },
    });
    try {
      await this.audit.log({
        organizationId:
          match?.organizationId ?? match?.tournament?.organizationId ?? null,
        userId: 'system',
        action: AuditAction.MATCH_CONTROL_STATE_CHANGED,
        entityType: 'MATCH_MVP',
        entityId: matchId,
        before: null,
        after: _meta as unknown as Record<string, unknown>,
        source: 'SYSTEM',
        reason: typeof _action === 'string' ? _action : undefined,
      });
    } catch {
      // keep non-blocking
    }
  }
}
