import { DataMode, MatchDataSource } from '@prisma/client';
import { PCOB_ADAPTER_KEY } from './pcob-binding.util';

export const DS_AUTO = 'AUTO' as unknown as MatchDataSource;

export const TELEMETRY_PROVIDERS = [
  MatchDataSource.MANUAL,
  MatchDataSource.API,
  MatchDataSource.SHADOW,
  MatchDataSource.PCOB,
] as const;

export type TelemetryProvider = (typeof TELEMETRY_PROVIDERS)[number];
export type DerivedSourceMode = 'MANUAL' | 'AUTO';

type MatchTelemetryProviderLike = {
  dataSource?: unknown;
  dataMode?: unknown;
  pcobSessionId?: string | null;
  pcobMode?: boolean | null;
  pcobBoundAt?: unknown;
  pcobLastSeenAt?: unknown;
  adapterKey?: string | null;
};

const normalizeString = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.toUpperCase() : null;
};

export const normalizeTelemetryProvider = (
  value: unknown,
): TelemetryProvider | null => {
  const normalized = normalizeString(value);
  if (!normalized) return null;
  if (
    normalized === MatchDataSource.MANUAL ||
    normalized === MatchDataSource.API ||
    normalized === MatchDataSource.SHADOW ||
    normalized === MatchDataSource.PCOB
  ) {
    return normalized;
  }
  return null;
};

export const resolveCanonicalTelemetryProvider = (
  match: MatchTelemetryProviderLike,
): TelemetryProvider => {
  const dataSource = normalizeString(match.dataSource);
  const canonicalSource = normalizeTelemetryProvider(dataSource);
  if (canonicalSource) {
    return canonicalSource;
  }

  const dataMode = normalizeString(match.dataMode);
  const hasPcobSession =
    typeof match.pcobSessionId === 'string' &&
    match.pcobSessionId.trim().length > 0;
  const adapterKey = normalizeString(match.adapterKey);

  if (dataSource === 'AUTO') {
    if (dataMode === DataMode.PCOB || match.pcobMode === true) {
      return hasPcobSession || adapterKey === PCOB_ADAPTER_KEY.toUpperCase()
        ? MatchDataSource.PCOB
        : MatchDataSource.SHADOW;
    }
    return MatchDataSource.API;
  }

  if (dataMode === DataMode.PCOB) {
    return hasPcobSession || adapterKey === PCOB_ADAPTER_KEY.toUpperCase()
      ? MatchDataSource.PCOB
      : MatchDataSource.SHADOW;
  }

  return MatchDataSource.MANUAL;
};

export const deriveSourceMode = (
  provider: TelemetryProvider,
): DerivedSourceMode =>
  provider === MatchDataSource.MANUAL ? 'MANUAL' : 'AUTO';

export const resolveTelemetryProviderInput = (params: {
  dataSource?: unknown;
  dataMode?: unknown;
  currentProvider?: TelemetryProvider | null;
  defaultAutoProvider?: TelemetryProvider;
}): TelemetryProvider | null => {
  const defaultAutoProvider = params.defaultAutoProvider ?? MatchDataSource.API;
  const currentProvider = params.currentProvider ?? null;
  const dataSource = normalizeString(params.dataSource);
  if (dataSource === 'SIMULATOR') {
    return MatchDataSource.SHADOW;
  }
  if (dataSource === 'AUTO') {
    return currentProvider && currentProvider !== MatchDataSource.MANUAL
      ? currentProvider
      : defaultAutoProvider;
  }

  const explicitProvider = normalizeTelemetryProvider(dataSource);
  if (explicitProvider) {
    return explicitProvider;
  }

  const dataMode = normalizeString(params.dataMode);
  if (dataMode === DataMode.PCOB) {
    return MatchDataSource.PCOB;
  }
  if (dataMode === DataMode.MANUAL) {
    return currentProvider ?? MatchDataSource.MANUAL;
  }

  return currentProvider;
};

export const derivePcobBindingFlags = (
  match: MatchTelemetryProviderLike,
  options: { lifecycleStatus?: string | null } = {},
) => {
  const telemetryProvider = resolveCanonicalTelemetryProvider(match);
  const sourceMode = deriveSourceMode(telemetryProvider);
  const adapterKey =
    typeof match.adapterKey === 'string' && match.adapterKey.trim()
      ? match.adapterKey.trim()
      : null;
  const pcobSessionId =
    typeof match.pcobSessionId === 'string' && match.pcobSessionId.trim()
      ? match.pcobSessionId.trim()
      : null;
  const pcobConfigured =
    telemetryProvider === MatchDataSource.PCOB &&
    adapterKey === PCOB_ADAPTER_KEY &&
    !!pcobSessionId;
  const pcobBound = pcobConfigured && !!match.pcobBoundAt;
  const lifecycleStatus = normalizeString(options.lifecycleStatus);
  const pcobReady = pcobBound && lifecycleStatus === 'LIVE';

  return {
    telemetryProvider,
    sourceMode,
    adapterKey,
    pcobSessionId,
    pcobConfigured,
    pcobBound,
    pcobReady,
  };
};
