import { ResultsEventsService } from './results-events.service';
import type { PcobGateway } from '../pcob/pcob.gateway';
import type { PrismaService } from '../../db/prisma.service';
import type { WidgetBroadcastGateway } from '../broadcast/broadcast.gateway';
import type { RankingEmitterService } from '../../realtime/ranking-emitter.service';
import type { RealtimeGateway } from '../../realtime/realtime.gateway';

describe('ResultsEventsService', () => {
  it('emits results to org-scoped room', async () => {
    const emitted: Array<{ event: string; org: string | null }> = [];
    const gateway = {
      emitResultsUpdated: jest.fn(
        (
          _matchId: string,
          _roundIndex: number,
          _payload: unknown,
          orgId?: string | null,
        ) => emitted.push({ event: 'results.updated', org: orgId ?? null }),
      ),
      emitLeaderboardUpdated: jest.fn(),
      emitOverlayPayload: jest.fn(),
    } as unknown as PcobGateway;

    const prisma = {
      match: {
        findFirst: jest.fn().mockResolvedValue({
          tournament: { organizationId: 'org-123' },
        }),
      },
    } as unknown as PrismaService;

    const widgetGateway = {
      emitLiveRankingForMatch: jest.fn().mockResolvedValue(null),
    } as unknown as WidgetBroadcastGateway;
    const rankingEmitter = {
      emitLiveRanking: jest.fn(),
      emitOverallRanking: jest.fn(),
    } as unknown as RankingEmitterService;
    const realtime = {
      emitMatchControlUpdate: jest.fn().mockResolvedValue(undefined),
    } as unknown as RealtimeGateway;

    const svc = new ResultsEventsService(
      gateway,
      prisma,
      widgetGateway,
      rankingEmitter,
      realtime,
    );
    svc.emitResultsUpdated('match-1', 0, { foo: 'bar' });
    await new Promise((resolve) => setImmediate(resolve));

    expect(emitted).toEqual([{ event: 'results.updated', org: 'org-123' }]);
    expect(realtime.emitMatchControlUpdate).toHaveBeenCalledWith(
      'match-1',
      'RESULTS_CHANGED',
      { orgId: 'org-123' },
    );

    const findFirstMock = prisma.match.findFirst as jest.Mock;
    expect(findFirstMock).toHaveBeenCalled();
  });

  it('refreshes live ranking streams when slots change', async () => {
    const gateway = {
      emitResultsUpdated: jest.fn(),
      emitLeaderboardUpdated: jest.fn(),
      emitOverlayPayload: jest.fn(),
      emitMatchUpdate: jest.fn(),
      emitResultsLockState: jest.fn(),
    } as unknown as PcobGateway;

    const prisma = {
      match: {
        findFirst: jest.fn().mockResolvedValue({
          tournamentId: 'tournament-1',
          tournament: { organizationId: 'org-123' },
        }),
      },
    } as unknown as PrismaService;

    const widgetGateway = {
      emitLiveRankingForMatch: jest.fn().mockResolvedValue(null),
      emitLiveBattleRankingForMatch: jest.fn().mockResolvedValue(null),
    } as unknown as WidgetBroadcastGateway;
    const rankingEmitter = {
      emitLiveRanking: jest.fn(),
      emitOverallRanking: jest.fn(),
    } as unknown as RankingEmitterService;
    const realtime = {
      emitMatchControlUpdate: jest.fn().mockResolvedValue(undefined),
    } as unknown as RealtimeGateway;

    const svc = new ResultsEventsService(
      gateway,
      prisma,
      widgetGateway,
      rankingEmitter,
      realtime,
    );

    svc.emitControlContractUpdated('match-1', 'SLOTS_CHANGED');
    await new Promise((resolve) => setImmediate(resolve));

    expect(realtime.emitMatchControlUpdate).toHaveBeenCalledWith(
      'match-1',
      'SLOTS_CHANGED',
      { orgId: 'org-123' },
    );
    expect(widgetGateway.emitLiveRankingForMatch).toHaveBeenCalledWith(
      'match-1',
    );
    expect(widgetGateway.emitLiveBattleRankingForMatch).toHaveBeenCalledWith(
      'match-1',
    );
    expect(rankingEmitter.emitLiveRanking).toHaveBeenCalledWith('match-1', {
      force: true,
    });
    expect(rankingEmitter.emitOverallRanking).toHaveBeenCalledWith(
      'tournament-1',
      { force: true },
    );
  });
});
