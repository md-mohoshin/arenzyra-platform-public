import { MatchDataSource } from '@prisma/client';
import type { PrismaService } from '../../db/prisma.service';
import type { AuditService } from '../audit/audit.service';
import type { ResultsEventsService } from './results-events.service';
import type { ResultsService } from './results.service';
import { ResultsIngestService } from './results-ingest.service';

describe('ResultsIngestService session compatibility', () => {
  it('ingests API results for a session match without requiring tournament context', async () => {
    const tx = {
      matchSlotResult: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'slot-result-1',
            slotNumber: 1,
            placement: null,
            totalKills: 0,
            placementPoints: 0,
            players: [],
          },
        ]),
        update: jest.fn().mockResolvedValue(undefined),
      },
      matchSlotPlayerResult: {
        update: jest.fn().mockResolvedValue(undefined),
      },
    };

    const prisma = {
      match: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'match-session-1',
          organizationId: 'org-session',
          sessionId: 'session-1',
          map: null,
          game: { key: 'PUBG_MOBILE' },
          status: 'LIVE',
          liveState: 'LIVE',
          dataSource: MatchDataSource.API,
          dataMode: 'AUTO',
          pcobSessionId: null,
          controlState: { state: 'LIVE' },
          tournamentId: null,
          tournament: null,
        }),
      },
      matchSlotResult: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      teamMapping: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      $transaction: jest.fn(
        async (callback: (client: typeof tx) => Promise<void>) => callback(tx),
      ),
    } as unknown as PrismaService;

    const events = {
      emitResultsUpdated: jest.fn(),
      emitLeaderboardUpdated: jest.fn(),
      emitOverlayPayload: jest.fn(),
      emitMatchUpdate: jest.fn(),
    } as unknown as ResultsEventsService;
    const audit = {
      log: jest.fn().mockResolvedValue(undefined),
    } as unknown as AuditService;
    const resultsService = {
      ensureResultsFromSlots: jest.fn().mockResolvedValue(undefined),
      syncMatchPlayers: jest.fn().mockResolvedValue(undefined),
      recalculateMatchResults: jest.fn().mockResolvedValue(undefined),
    } as unknown as ResultsService;

    const service = new ResultsIngestService(
      prisma,
      events,
      audit,
      resultsService,
    );

    await service.ingestApiMatchResults('match-session-1', {
      slots: [
        {
          slotNumber: 1,
          placement: 1,
          teamKills: 6,
        },
      ],
      meta: { source: 'API' },
    });

    expect(
      (resultsService as any).recalculateMatchResults,
    ).toHaveBeenCalledWith('match-session-1');
    expect((audit as any).log).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org-session',
      }),
    );
  });
});
