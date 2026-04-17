import { Injectable, Optional } from '@nestjs/common';
import { PrismaService } from '../../../db/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { AuditAction, MatchStatus } from '@prisma/client';
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
    survivalTime?: number | null;
    placement?: number | null;
  }) {
    const { kills, assists, survivalTime, placement } = opts;
    const placementBonus = placement ? Math.max(0, 20 - placement) : 0;
    const survivalScore = survivalTime ? Math.round(survivalTime / 60) : 0;
    return kills * 4 + assists * 2 + placementBonus + survivalScore;
  }

  private async computeAuto(matchId: string): Promise<MvpPlayer | null> {
    const players = await this.prisma.matchSlotPlayerResult.findMany({
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
    });

    if (!players.length) return null;

    const rows: MvpPlayer[] = players.map((p) => {
      const kills = p.kills ?? 0;
      const assists = (p.knocks ?? 0) > 0 ? (p.knocks ?? 0) : 0;
      const placement = p.slotResult?.placement ?? null;
      const score = this.scorePlayer({
        kills,
        assists,
        survivalTime: null,
        placement,
      });
      return {
        playerId: p.playerId ?? p.id,
        ign: p.player?.ign ?? p.playerName ?? p.player?.realName ?? 'Unknown',
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
        survivalTime: null,
        mvpScore: score,
      };
    });

    const sorted = rows.sort((a, b) => {
      if (b.mvpScore !== a.mvpScore) return b.mvpScore - a.mvpScore;
      if (b.kills !== a.kills) return b.kills - a.kills;
      if ((b.survivalTime ?? 0) !== (a.survivalTime ?? 0))
        return (b.survivalTime ?? 0) - (a.survivalTime ?? 0);
      return a.ign.localeCompare(b.ign);
    });

    return sorted[0] ?? null;
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
    const assists = (rec.knocks ?? 0) > 0 ? (rec.knocks ?? 0) : 0;
    const placement = rec.slotResult?.placement ?? null;
    return {
      playerId: rec.playerId ?? rec.id,
      ign:
        rec.player?.ign ?? rec.playerName ?? rec.player?.realName ?? 'Unknown',
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
      survivalTime: null,
      mvpScore: this.scorePlayer({
        kills,
        assists,
        placement,
        survivalTime: null,
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
