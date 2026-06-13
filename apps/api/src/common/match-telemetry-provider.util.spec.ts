import { DataMode, MatchDataSource } from '@prisma/client';
import {
  DS_AUTO,
  derivePcobBindingFlags,
  exposeSourceMode,
  isPcobCompatibilityMatch,
  normalizeTelemetryProvider,
  resolvePcobCompatibilityMode,
  resolveCanonicalTelemetryProvider,
  resolveTelemetryProviderInput,
} from './match-telemetry-provider.util';

describe('match telemetry provider normalization', () => {
  it('treats AUTO-style legacy providers as canonical API inputs', () => {
    expect(DS_AUTO).toBe(MatchDataSource.API);
    expect(normalizeTelemetryProvider('AUTO')).toBe(MatchDataSource.API);
    expect(normalizeTelemetryProvider(MatchDataSource.API)).toBe(
      MatchDataSource.API,
    );
    expect(normalizeTelemetryProvider(MatchDataSource.SHADOW)).toBe(
      MatchDataSource.API,
    );
    expect(normalizeTelemetryProvider('SIMULATOR')).toBe(MatchDataSource.API);
  });

  it('canonicalizes explicit PCOB and legacy AUTO rows to API', () => {
    expect(
      resolveCanonicalTelemetryProvider({
        dataSource: MatchDataSource.PCOB,
        dataMode: DataMode.PCOB,
        pcobMode: true,
      }),
    ).toBe(MatchDataSource.API);

    expect(
      resolveCanonicalTelemetryProvider({
        dataSource: MatchDataSource.AUTO,
        dataMode: DataMode.MANUAL,
        pcobMode: false,
      }),
    ).toBe(MatchDataSource.API);

    expect(
      resolveCanonicalTelemetryProvider({
        dataSource: MatchDataSource.AUTO,
        dataMode: DataMode.PCOB,
        pcobMode: true,
      }),
    ).toBe(MatchDataSource.API);
  });

  it('defaults explicit API inputs to API and ignores legacy automatic update inputs', () => {
    expect(
      resolveTelemetryProviderInput({
        dataSource: MatchDataSource.API,
        currentProvider: MatchDataSource.MANUAL,
      }),
    ).toBe(MatchDataSource.API);

    expect(
      resolveTelemetryProviderInput({
        dataSource: 'AUTO',
        currentProvider: MatchDataSource.MANUAL,
      }),
    ).toBeNull();

    expect(
      resolveTelemetryProviderInput({
        dataSource: MatchDataSource.API,
        currentProvider: MatchDataSource.PCOB,
      }),
    ).toBe(MatchDataSource.API);
  });

  it('exposes automatic source mode as API on public contracts', () => {
    expect(exposeSourceMode(MatchDataSource.MANUAL)).toBe(
      MatchDataSource.MANUAL,
    );
    expect(exposeSourceMode(MatchDataSource.API)).toBe(MatchDataSource.API);
    expect(exposeSourceMode(MatchDataSource.PCOB)).toBe(MatchDataSource.API);
  });

  it('derives API as the canonical automatic source mode for compatibility providers', () => {
    expect(
      derivePcobBindingFlags({
        dataSource: MatchDataSource.API,
      }),
    ).toMatchObject({
      telemetryProvider: MatchDataSource.API,
      sourceMode: MatchDataSource.API,
      adapterKey: 'ob.js',
    });

    expect(
      derivePcobBindingFlags({
        dataSource: MatchDataSource.PCOB,
        dataMode: DataMode.PCOB,
        adapterKey: 'pubgm-pcob',
        pcobSessionId: 'session-1',
      }),
    ).toMatchObject({
      telemetryProvider: MatchDataSource.API,
      sourceMode: MatchDataSource.API,
      adapterKey: 'ob.js',
    });
  });

  it('treats launcher-bound API rows as configured ob.js bindings', () => {
    expect(
      derivePcobBindingFlags({
        dataSource: MatchDataSource.API,
        dataMode: DataMode.MANUAL,
        adapterKey: 'pubgm-pcob',
        pcobSessionId: 'session-1',
        pcobBoundAt: new Date('2026-04-20T12:00:00.000Z'),
        pcobLastSeenAt: new Date('2026-04-20T12:01:00.000Z'),
      }),
    ).toMatchObject({
      telemetryProvider: MatchDataSource.API,
      sourceMode: MatchDataSource.API,
      adapterKey: 'ob.js',
      pcobSessionId: 'session-1',
      pcobConfigured: true,
      pcobBound: true,
      pcobReady: true,
    });
  });

  it('derives PCOB compatibility mode for API-bound ob.js rows', () => {
    const match = {
      dataSource: MatchDataSource.API,
      dataMode: DataMode.MANUAL,
      adapterKey: 'pubgm-pcob',
      pcobSessionId: 'session-1',
    };

    expect(resolvePcobCompatibilityMode(match)).toBe('API');
    expect(isPcobCompatibilityMatch(match)).toBe(true);
    expect(
      resolvePcobCompatibilityMode({
        dataSource: MatchDataSource.MANUAL,
        dataMode: DataMode.MANUAL,
      }),
    ).toBe('MANUAL');
  });
});
