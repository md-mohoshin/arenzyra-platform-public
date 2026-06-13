import { DataMode, MatchDataSource } from '@prisma/client';
import {
  hasPcobAdapterBindingSignal,
  PCOB_ADAPTER_KEY,
} from './pcob-binding.util';

export const DS_AUTO = MatchDataSource.API;

export const TELEMETRY_PROVIDERS = [
  MatchDataSource.MANUAL,
  MatchDataSource.API,
] as const;

export type TelemetryProvider =
  | (typeof TELEMETRY_PROVIDERS)[number]
  | (typeof MatchDataSource)['PCOB'];
export type DerivedSourceMode = 'MANUAL' | 'API';
export type ExposedTelemetryProvider = (typeof TELEMETRY_PROVIDERS)[number];
export type ExposedSourceMode = DerivedSourceMode;
export type PcobCompatibilityMode = 'MANUAL' | 'API' | 'PCOB';

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

const normalizeRawString = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

export const normalizeTelemetryProvider = (
  value: unknown,
): TelemetryProvider | null => {
  const normalized = normalizeString(value);
  if (!normalized) return null;
  if (normalized === MatchDataSource.MANUAL) {
    return MatchDataSource.MANUAL;
  }
  if (
    normalized === 'AUTO' ||
    normalized === MatchDataSource.API ||
    normalized === MatchDataSource.SHADOW ||
    normalized === MatchDataSource.PCOB ||
    normalized === 'SIMULATOR'
  ) {
    return MatchDataSource.API;
  }
  return null;
};

export const resolveCanonicalTelemetryProvider = (
  match: MatchTelemetryProviderLike,
): TelemetryProvider => {
  const dataSource = normalizeString(match.dataSource);
  const canonicalSource = normalizeTelemetryProvider(dataSource);
  const dataMode = normalizeString(match.dataMode);
  const hasPcobSignal = dataMode === DataMode.PCOB || match.pcobMode === true;

  if (canonicalSource === MatchDataSource.API) {
    return MatchDataSource.API;
  }
  if (canonicalSource === MatchDataSource.MANUAL) {
    return MatchDataSource.MANUAL;
  }

  if (hasPcobSignal) {
    return MatchDataSource.API;
  }

  return MatchDataSource.MANUAL;
};

export const deriveSourceMode = (
  provider: TelemetryProvider,
): DerivedSourceMode =>
  provider === MatchDataSource.MANUAL ? 'MANUAL' : 'API';

export const exposeTelemetryProvider = (
  provider: TelemetryProvider,
): ExposedTelemetryProvider =>
  provider === MatchDataSource.MANUAL
    ? MatchDataSource.MANUAL
    : MatchDataSource.API;

export const exposeSourceMode = (
  provider: TelemetryProvider,
): ExposedSourceMode =>
  provider === MatchDataSource.MANUAL
    ? MatchDataSource.MANUAL
    : MatchDataSource.API;

export const exposeCanonicalTelemetryProvider = (
  match: MatchTelemetryProviderLike,
): ExposedTelemetryProvider =>
  exposeTelemetryProvider(resolveCanonicalTelemetryProvider(match));

export const resolvePcobCompatibilityMode = (
  match: MatchTelemetryProviderLike,
): PcobCompatibilityMode => {
  const dataSource = normalizeString(match.dataSource);
  const dataMode = normalizeString(match.dataMode);
  const hasLegacyPcobProvider =
    dataSource === MatchDataSource.PCOB ||
    dataMode === DataMode.PCOB ||
    match.pcobMode === true;
  if (hasLegacyPcobProvider && hasPcobAdapterBindingSignal(match)) {
    return 'API';
  }
  const telemetryProvider = resolveCanonicalTelemetryProvider(match);
  if (
    telemetryProvider === MatchDataSource.API &&
    hasPcobAdapterBindingSignal(match)
  ) {
    return 'API';
  }
  return 'MANUAL';
};

export const isPcobCompatibilityMatch = (
  match: MatchTelemetryProviderLike,
): boolean => resolvePcobCompatibilityMode(match) !== 'MANUAL';

export const resolveTelemetryProviderInput = (params: {
  dataSource?: unknown;
  dataMode?: unknown;
  currentProvider?: TelemetryProvider | null;
  defaultAutoProvider?: TelemetryProvider;
}): TelemetryProvider | null => {
  const defaultAutoProvider = params.defaultAutoProvider ?? DS_AUTO;
  const currentProvider = params.currentProvider ?? null;
  const dataSource = normalizeString(params.dataSource);
  if (dataSource === MatchDataSource.API) {
    return defaultAutoProvider;
  }
  if (dataSource === MatchDataSource.MANUAL) {
    return MatchDataSource.MANUAL;
  }
  if (
    dataSource === MatchDataSource.PCOB ||
    dataSource === MatchDataSource.SHADOW ||
    dataSource === 'SIMULATOR' ||
    dataSource === 'AUTO'
  ) {
    return null;
  }

  const explicitProvider = normalizeTelemetryProvider(dataSource);
  if (explicitProvider) {
    return explicitProvider;
  }

  const dataMode = normalizeString(params.dataMode);
  if (dataMode === DataMode.PCOB) {
    return null;
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
  const lifecycleStatus = normalizeString(options.lifecycleStatus);
  const explicitAdapterKey = normalizeRawString(match.adapterKey);
  const pcobSessionId = normalizeRawString(match.pcobSessionId);
  const hasSessionBindingSignal = hasPcobAdapterBindingSignal(match);
  let adapterKey: string | null = null;
  if (sourceMode === 'API') {
    adapterKey = 'ob.js';
  }
  const hasAutomaticProvider = telemetryProvider === MatchDataSource.API;
  const isReadyLifecycle =
    lifecycleStatus === 'LIVE' ||
    lifecycleStatus === 'FINISH_PENDING' ||
    lifecycleStatus === 'FINISHED';
  const pcobConfigured =
    hasAutomaticProvider &&
    hasSessionBindingSignal &&
    explicitAdapterKey === PCOB_ADAPTER_KEY;
  const pcobBound = Boolean(pcobConfigured && match.pcobBoundAt);
  const pcobReady = Boolean(
    pcobBound && (match.pcobLastSeenAt || isReadyLifecycle),
  );

  return {
    telemetryProvider,
    sourceMode,
    adapterKey,
    pcobSessionId: pcobConfigured ? pcobSessionId : null,
    pcobConfigured,
    pcobBound,
    pcobReady,
  };
};
