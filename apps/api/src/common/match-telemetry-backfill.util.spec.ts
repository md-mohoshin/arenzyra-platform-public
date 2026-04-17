import { DataMode, MatchDataSource } from '@prisma/client';
import {
  analyzeMatchTelemetryBackfill,
  type MatchTelemetryBackfillRow,
} from './match-telemetry-backfill.util';

describe('match telemetry backfill normalization', () => {
  const buildRow = (
    overrides: Partial<MatchTelemetryBackfillRow> = {},
  ): MatchTelemetryBackfillRow => ({
    id: 'match-1',
    deletedAt: null,
    dataSource: MatchDataSource.MANUAL,
    dataMode: DataMode.MANUAL,
    pcobMode: false,
    pcobSessionId: null,
    pcobBoundAt: null,
    pcobLastSeenAt: null,
    pcobKillSyncEnabled: false,
    adapterKey: 'pubgm-manual',
    ...overrides,
  });

  it('rewrites legacy AUTO rows without competing PCOB truth to API', () => {
    const result = analyzeMatchTelemetryBackfill(
      buildRow({
        dataSource: MatchDataSource.AUTO,
        dataMode: DataMode.MANUAL,
        pcobMode: false,
      }),
    );

    expect(result).toEqual(
      expect.objectContaining({
        action: 'normalize',
        currentProvider: MatchDataSource.API,
        targetProvider: MatchDataSource.API,
        fixCategories: ['legacy_auto_to_api'],
        data: expect.objectContaining({
          dataSource: MatchDataSource.API,
        }),
      }),
    );
  });

  it('rewrites legacy AUTO rows with a valid PCOB binding to canonical PCOB', () => {
    const result = analyzeMatchTelemetryBackfill(
      buildRow({
        dataSource: MatchDataSource.AUTO,
        dataMode: DataMode.PCOB,
        pcobMode: true,
        pcobSessionId: 'session-1',
        pcobBoundAt: new Date('2026-04-01T10:00:00.000Z'),
        pcobLastSeenAt: new Date('2026-04-01T10:01:00.000Z'),
        adapterKey: 'pubgm-pcob',
      }),
    );

    expect(result.action).toBe('normalize');
    if (result.action !== 'normalize') {
      throw new Error('expected normalize action');
    }
    expect(result.currentProvider).toBe(MatchDataSource.PCOB);
    expect(result.targetProvider).toBe(MatchDataSource.PCOB);
    expect(result.fixCategories).toEqual([
      'legacy_auto_to_pcob',
      'sync_pcob_compatibility_fields',
    ]);
    expect(result.data).toEqual(
      expect.objectContaining({
        dataSource: MatchDataSource.PCOB,
      }),
    );
    expect(result.data).not.toHaveProperty('pcobBoundAt');
    expect(result.data).not.toHaveProperty('pcobLastSeenAt');
  });

  it('clears stale PCOB residue on explicit non-PCOB rows', () => {
    const result = analyzeMatchTelemetryBackfill(
      buildRow({
        dataSource: MatchDataSource.API,
        dataMode: DataMode.MANUAL,
        pcobMode: false,
        pcobSessionId: 'stale-session',
        pcobBoundAt: new Date('2026-04-01T10:00:00.000Z'),
        pcobLastSeenAt: new Date('2026-04-01T10:01:00.000Z'),
        pcobKillSyncEnabled: true,
        adapterKey: 'pubgm-pcob',
      }),
    );

    expect(result.action).toBe('normalize');
    if (result.action !== 'normalize') {
      throw new Error('expected normalize action');
    }
    expect(result.currentProvider).toBe(MatchDataSource.API);
    expect(result.targetProvider).toBe(MatchDataSource.API);
    expect(result.fixCategories).toEqual(['clear_stale_pcob_fields']);
    expect(result.data).toEqual(
      expect.objectContaining({
        adapterKey: null,
        pcobBoundAt: null,
        pcobKillSyncEnabled: false,
        pcobLastSeenAt: null,
        pcobSessionId: null,
      }),
    );
  });

  it('flags explicit PCOB rows missing binding requirements for manual review', () => {
    const result = analyzeMatchTelemetryBackfill(
      buildRow({
        dataSource: MatchDataSource.PCOB,
        dataMode: DataMode.PCOB,
        pcobMode: true,
        pcobSessionId: null,
        adapterKey: 'pubgm-pcob',
      }),
    );

    expect(result).toEqual(
      expect.objectContaining({
        action: 'manual-review',
        currentProvider: MatchDataSource.PCOB,
        reviewCategories: ['pcob_provider_missing_session'],
      }),
    );
  });

  it('flags conflicting explicit provider and PCOB mode rows for manual review', () => {
    const result = analyzeMatchTelemetryBackfill(
      buildRow({
        dataSource: MatchDataSource.MANUAL,
        dataMode: DataMode.PCOB,
        pcobMode: true,
        pcobSessionId: 'session-1',
        adapterKey: 'pubgm-pcob',
      }),
    );

    expect(result).toEqual(
      expect.objectContaining({
        action: 'manual-review',
        currentProvider: MatchDataSource.MANUAL,
        reviewCategories: ['conflicting_data_source_and_pcob_mode'],
      }),
    );
  });
});
