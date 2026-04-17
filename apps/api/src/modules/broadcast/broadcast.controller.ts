import { Controller, Get, Param, Query } from '@nestjs/common';
import { Public } from '../../common/auth/public.decorator';
import { BroadcastService } from './broadcast.service';
import { LiveBattleRankingService } from '../widgets/live-battle-ranking.service';

@Controller('api/broadcast')
export class BroadcastController {
  constructor(
    private readonly broadcast: BroadcastService,
    private readonly liveBattleRanking: LiveBattleRankingService,
  ) {}

  @Get(':broadcastKey')
  @Public()
  async resolveOrganization(@Param('broadcastKey') broadcastKey: string) {
    const { organizationId, organization } =
      await this.broadcast.resolveOrganizationByBroadcastKey(broadcastKey);
    const active = await this.broadcast
      .resolveActiveMatchForBroadcastKey(broadcastKey)
      .catch(() => null);

    return {
      organizationId,
      organization,
      match: active
        ? {
            id: active.matchId ?? null,
            groupId: (active as { groupId?: string | null }).groupId ?? null,
            groupName:
              (active as { groupName?: string | null }).groupName ?? null,
            tournamentId: active.tournamentId ?? null,
            stageName: active.stageName ?? null,
            name: active.matchName ?? null,
            status: active.status ?? null,
          }
        : null,
      branding: (active as { branding?: unknown })?.branding ?? null,
    };
  }

  @Get(':broadcastKey/live-ranking')
  @Public()
  getLiveRanking(
    @Param('broadcastKey') broadcastKey: string,
    @Query('debug') debug?: string,
  ) {
    return this.broadcast.fetchLiveRanking(
      broadcastKey,
      debug === '1' || debug === 'true',
    );
  }

  @Get(':broadcastKey/live-state')
  @Public()
  getLiveState(@Param('broadcastKey') broadcastKey: string) {
    return this.broadcast.resolveLiveStateForBroadcastKey(broadcastKey);
  }

  @Get(':broadcastKey/live-battle-ranking')
  @Public()
  async getLiveBattleRanking(@Param('broadcastKey') broadcastKey: string) {
    const { snapshot } = await this.liveBattleRanking.computeSnapshot(
      broadcastKey,
      {
        strict: true,
      },
    );
    return snapshot;
  }

  @Get(':broadcastKey/match/active')
  @Public()
  getActiveMatch(@Param('broadcastKey') broadcastKey: string) {
    return this.broadcast.resolveActiveMatchForBroadcastKey(broadcastKey);
  }

  @Get(':broadcastKey/:widgetKey')
  @Public()
  getSnapshot(
    @Param('broadcastKey') broadcastKey: string,
    @Param('widgetKey') widgetKey: string,
  ) {
    return this.broadcast.fetchSnapshot(broadcastKey, widgetKey);
  }
}
