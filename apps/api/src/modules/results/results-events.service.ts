import { Injectable } from '@nestjs/common';
import { PcobGateway } from '../pcob/pcob.gateway';
import { PrismaService } from '../../db/prisma.service';
import { deriveResultLockState, type ResultLockContext } from './results.lock';
import { WidgetBroadcastGateway } from '../broadcast/broadcast.gateway';
import { RankingEmitterService } from '../../realtime/ranking-emitter.service';

@Injectable()
export class ResultsEventsService {
  constructor(
    private readonly pcobGateway: PcobGateway,
    private readonly prisma: PrismaService,
    private readonly widgetGateway: WidgetBroadcastGateway,
    private readonly rankingEmitter: RankingEmitterService,
  ) {}

  private matchEmitCache = new Map<string, number>();
  private readonly throttleMs = 350;

  private async resolveContext(
    matchId: string,
  ): Promise<{ orgId: string | null; tournamentId: string | null }> {
    const match = await this.prisma.match.findFirst({
      where: { id: matchId, deletedAt: null },
      select: {
        tournamentId: true,
        tournament: { select: { organizationId: true } },
      },
    });
    return {
      orgId: match?.tournament?.organizationId ?? null,
      tournamentId: match?.tournamentId ?? null,
    };
  }

  emitResultsUpdated<T = unknown>(
    matchId: string,
    roundIndex: number,
    payload?: T,
  ): void {
    void this.resolveContext(matchId).then(({ orgId, tournamentId }) => {
      this.pcobGateway.emitResultsUpdated(matchId, roundIndex, payload, orgId);
      // Push live-ranking snapshot to broadcast listeners
      void this.widgetGateway.emitLiveRankingForMatch(matchId).catch(() => {});
      void this.rankingEmitter.emitLiveRanking(matchId, { force: true });
      if (tournamentId) {
        void this.rankingEmitter.emitOverallRanking(tournamentId, {
          force: true,
        });
      }
    });
  }

  emitLeaderboardUpdated<T = unknown>(matchId: string, payload?: T): void {
    void this.resolveContext(matchId).then(({ orgId, tournamentId }) => {
      this.pcobGateway.emitLeaderboardUpdated(matchId, payload, orgId);
      void this.rankingEmitter.emitLiveRanking(matchId, { force: true });
      if (tournamentId) {
        void this.rankingEmitter.emitOverallRanking(tournamentId, {
          force: true,
        });
      }
    });
  }

  emitOverlayPayload<T = unknown>(
    matchId: string,
    roundIndex: number,
    payload?: T,
  ): void {
    void this.resolveContext(matchId).then(({ orgId }) =>
      this.pcobGateway.emitOverlayPayload(matchId, roundIndex, payload, orgId),
    );
  }

  async emitResultsLockState(
    matchId: string,
    ctx?: ResultLockContext | null,
  ): Promise<void> {
    const match =
      ctx ??
      (await this.prisma.match.findFirst({
        where: { id: matchId, deletedAt: null },
        select: {
          status: true,
          dataSource: true,
          dataMode: true,
          liveState: true,
          controlState: {
            select: {
              state: true,
              resultsManualLock: true,
              resultsForceUnlock: true,
            },
          },
        },
      }));
    const { orgId } = await this.resolveContext(matchId);
    const lockState = deriveResultLockState({
      liveState:
        (match as ResultLockContext | undefined)?.liveState ??
        (match as { controlState?: { state?: string | null } | null })
          ?.controlState?.state ??
        null,
      status: (match as ResultLockContext | undefined)?.status ?? null,
      dataSource: (match as ResultLockContext | undefined)?.dataSource ?? null,
      dataMode: (match as ResultLockContext | undefined)?.dataMode ?? null,
      manualLock:
        (match as { controlState?: { resultsManualLock?: boolean | null } })
          ?.controlState?.resultsManualLock ?? null,
      forceUnlock:
        (match as { controlState?: { resultsForceUnlock?: boolean | null } })
          ?.controlState?.resultsForceUnlock ?? null,
    });
    this.pcobGateway.emitResultsLockState(
      matchId,
      lockState,
      {
        status: (match as ResultLockContext | undefined)?.status ?? null,
        dataSource:
          (match as ResultLockContext | undefined)?.dataSource ??
          (match as ResultLockContext | undefined)?.dataMode ??
          null,
      },
      orgId,
    );
  }

  emitMatchUpdate(matchId: string, payload?: { reason?: string | null }) {
    const now = Date.now();
    const last = this.matchEmitCache.get(matchId) ?? 0;
    const force = (payload?.reason ?? '').toString().toLowerCase() === 'final';
    if (!force && now - last < this.throttleMs) return;
    this.matchEmitCache.set(matchId, now);
    void this.resolveContext(matchId).then(({ orgId }) =>
      this.pcobGateway.emitMatchUpdate(matchId, payload, orgId),
    );
  }
}
