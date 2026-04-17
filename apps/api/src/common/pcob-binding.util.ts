import { DataMode, MatchDataSource } from '@prisma/client';

export const PCOB_ADAPTER_KEY = 'pubgm-pcob' as const;

export const buildPcobConfigurationData = (sessionId: string) => ({
  pcobSessionId: sessionId.trim(),
  pcobMode: true,
  dataMode: DataMode.PCOB,
  dataSource: MatchDataSource.PCOB,
  adapterKey: PCOB_ADAPTER_KEY,
});

export const buildPcobBindingData = (
  sessionId: string,
  boundAt: Date = new Date(),
) => ({
  ...buildPcobConfigurationData(sessionId),
  pcobBoundAt: boundAt,
});

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
