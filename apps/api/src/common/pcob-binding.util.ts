import { DataMode, MatchDataSource } from '@prisma/client';

export const PCOB_ADAPTER_KEY = 'pubgm-pcob' as const;

const normalizeRawString = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

export const buildPcobConfigurationData = (sessionId: string) => ({
  pcobSessionId: sessionId.trim(),
  pcobMode: true,
  dataMode: DataMode.PCOB,
  dataSource: MatchDataSource.PCOB,
  adapterKey: PCOB_ADAPTER_KEY,
});

export const buildApiObserverBindingData = (
  sessionId: string,
  boundAt: Date = new Date(),
) => ({
  pcobSessionId: sessionId.trim(),
  pcobBoundAt: boundAt,
  pcobMode: false,
  dataMode: DataMode.MANUAL,
  dataSource: MatchDataSource.API,
  adapterKey: PCOB_ADAPTER_KEY,
});

export const buildPcobBindingData = (
  sessionId: string,
  boundAt: Date = new Date(),
) => ({
  ...buildPcobConfigurationData(sessionId),
  pcobBoundAt: boundAt,
});

export const hasPcobAdapterBindingSignal = (match: {
  pcobSessionId?: unknown;
  adapterKey?: unknown;
}): boolean =>
  normalizeRawString(match.pcobSessionId) !== null &&
  normalizeRawString(match.adapterKey)?.toLowerCase() === PCOB_ADAPTER_KEY;

export const hasLegacyPcobControlSignal = (match: {
  dataSource?: unknown;
  dataMode?: unknown;
  pcobMode?: boolean | null;
}): boolean =>
  normalizeRawString(match.dataSource)?.toUpperCase() ===
    MatchDataSource.PCOB ||
  normalizeRawString(match.dataMode)?.toUpperCase() === DataMode.PCOB ||
  match.pcobMode === true;

export const buildPcobUnbindingData = () => ({
  pcobSessionId: null,
  pcobBoundAt: null,
  pcobLastSeenAt: null,
  pcobMode: false,
  pcobKillSyncEnabled: false,
  dataMode: DataMode.MANUAL,
  dataSource: MatchDataSource.MANUAL,
  adapterKey: null,
});
