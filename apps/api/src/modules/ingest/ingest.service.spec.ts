import { BadRequestException } from '@nestjs/common';
import { MatchDataSource, MatchStatus } from '@prisma/client';
import { IngestService } from './ingest.service';

describe('IngestService legacy snapshot guard', () => {
  const createEvent = (overrides: Partial<Record<string, unknown>> = {}) => ({
    event_id: '11111111-1111-1111-1111-111111111111',
    match_id: '22222222-2222-2222-2222-222222222222',
    seq: 1,
    type: 'MATCH_START',
    timestamp: '2026-04-20T20:00:00.000Z',
    raw_payload: {},
    ...overrides,
  });

  it('rejects legacy pcob snapshot ingest for API matches', async () => {
    const prisma = {
      match: {
        findUnique: jest.fn().mockResolvedValue({
          id: '22222222-2222-2222-2222-222222222222',
          status: MatchStatus.LIVE,
          deletedAt: null,
          tournamentId: '33333333-3333-3333-3333-333333333333',
          organizationId: '44444444-4444-4444-4444-444444444444',
          dataSource: MatchDataSource.API,
          dataMode: 'MANUAL',
          pcobSessionId: null,
          pcobMode: false,
          adapterKey: null,
        }),
      },
      tournamentTeam: {
        findMany: jest.fn(),
      },
      matchEvent: {
        createMany: jest.fn(),
      },
    } as any;
    const service = new IngestService(
      prisma,
      { recomputeMatchAndTournament: jest.fn() } as any,
      { recalculateMatchResults: jest.fn() } as any,
    );

    const batch = [
      createEvent({
        raw_payload: { source: 'pcob' },
      }) as any,
    ];

    await expect(service.ingestBatch(batch)).rejects.toThrow(
      BadRequestException,
    );
    await expect(service.ingestBatch(batch)).rejects.toThrow(
      'Legacy snapshot ingest is disabled for API and MANUAL matches',
    );

    expect(prisma.tournamentTeam.findMany).not.toHaveBeenCalled();
    expect(prisma.matchEvent.createMany).not.toHaveBeenCalled();
  });

  it('allows legacy pcob snapshot ingest for explicit PCOB matches', async () => {
    const prisma = {
      match: {
        findUnique: jest.fn().mockResolvedValue({
          id: '22222222-2222-2222-2222-222222222222',
          status: MatchStatus.LIVE,
          deletedAt: null,
          tournamentId: '33333333-3333-3333-3333-333333333333',
          organizationId: '44444444-4444-4444-4444-444444444444',
          dataSource: MatchDataSource.PCOB,
          dataMode: 'PCOB',
          pcobSessionId: 'session-1',
          pcobMode: true,
          adapterKey: 'pubgm-pcob',
        }),
      },
      tournamentTeam: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      matchEvent: {
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    } as any;
    const scoring = {
      recomputeMatchAndTournament: jest.fn(),
    } as any;
    const results = {
      recalculateMatchResults: jest.fn().mockResolvedValue(undefined),
    } as any;
    const service = new IngestService(prisma, scoring, results);

    await expect(
      service.ingestBatch([
        createEvent({
          raw_payload: { source: 'pcob' },
        }) as any,
      ]),
    ).resolves.toEqual({
      ok: true,
      received: 1,
      inserted: 1,
      ignored: 0,
      rejected: 0,
      rejectedItems: [],
    });

    expect(prisma.tournamentTeam.findMany).toHaveBeenCalled();
    expect(prisma.matchEvent.createMany).toHaveBeenCalled();
    expect(scoring.recomputeMatchAndTournament).toHaveBeenCalledWith(
      '22222222-2222-2222-2222-222222222222',
    );
    expect(results.recalculateMatchResults).toHaveBeenCalledWith(
      '22222222-2222-2222-2222-222222222222',
    );
  });

  it('still allows non-legacy collector batches for API matches', async () => {
    const prisma = {
      match: {
        findUnique: jest.fn().mockResolvedValue({
          id: '22222222-2222-2222-2222-222222222222',
          status: MatchStatus.LIVE,
          deletedAt: null,
          tournamentId: '33333333-3333-3333-3333-333333333333',
          organizationId: '44444444-4444-4444-4444-444444444444',
          dataSource: MatchDataSource.API,
          dataMode: 'MANUAL',
          pcobSessionId: null,
          pcobMode: false,
          adapterKey: null,
        }),
      },
      tournamentTeam: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      matchEvent: {
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    } as any;
    const scoring = {
      recomputeMatchAndTournament: jest.fn(),
    } as any;
    const results = {
      recalculateMatchResults: jest.fn().mockResolvedValue(undefined),
    } as any;
    const service = new IngestService(prisma, scoring, results);

    await expect(
      service.ingestBatch([
        createEvent({
          raw_payload: { source: 'mock' },
        }) as any,
      ]),
    ).resolves.toEqual({
      ok: true,
      received: 1,
      inserted: 1,
      ignored: 0,
      rejected: 0,
      rejectedItems: [],
    });

    expect(prisma.matchEvent.createMany).toHaveBeenCalled();
  });
});
