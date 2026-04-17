import { DataMode, MatchDataSource, Prisma } from '@prisma/client';
import {
  resolveCanonicalTelemetryProvider,
  type TelemetryProvider,
} from './match-telemetry-provider.util';
import { PCOB_ADAPTER_KEY } from './pcob-binding.util';

export const MATCH_TELEMETRY_BACKFILL_SELECT = {
  id: true,
  deletedAt: true,
  dataSource: true,
  dataMode: true,
  pcobMode: true,
  pcobSessionId: true,
  pcobBoundAt: true,
  pcobLastSeenAt: true,
  pcobKillSyncEnabled: true,
  adapterKey: true,
} as const satisfies Prisma.MatchSelect;

export type MatchTelemetryBackfillRow = Prisma.MatchGetPayload<{
  select: typeof MATCH_TELEMETRY_BACKFILL_SELECT;
}>;

export type MatchTelemetryBackfillFixCategory =
  | 'legacy_auto_to_api'
  | 'legacy_auto_to_pcob'
  | 'sync_pcob_compatibility_fields'
  | 'clear_stale_pcob_fields';

export type MatchTelemetryBackfillReviewCategory =
  | 'unsupported_data_source'
  | 'legacy_auto_with_partial_pcob_binding'
  | 'pcob_provider_missing_adapter'
  | 'pcob_provider_missing_session'
  | 'conflicting_data_source_and_pcob_mode';

export type MatchTelemetryBackfillResult =
  | {
      action: 'unchanged';
      currentProvider: TelemetryProvider;
      targetProvider: TelemetryProvider;
      fixCategories: MatchTelemetryBackfillFixCategory[];
      reviewCategories: MatchTelemetryBackfillReviewCategory[];
      notes: string[];
      data: null;
    }
  | {
      action: 'normalize';
      currentProvider: TelemetryProvider;
      targetProvider: TelemetryProvider;
      fixCategories: MatchTelemetryBackfillFixCategory[];
      reviewCategories: MatchTelemetryBackfillReviewCategory[];
      notes: string[];
      data: Prisma.MatchUncheckedUpdateInput;
    }
  | {
      action: 'manual-review';
      currentProvider: TelemetryProvider;
      targetProvider: null;
      fixCategories: MatchTelemetryBackfillFixCategory[];
      reviewCategories: MatchTelemetryBackfillReviewCategory[];
      notes: string[];
      data: null;
    };

type UpdateDraft = Partial<
  Pick<
    MatchTelemetryBackfillRow,
    | 'dataSource'
    | 'dataMode'
    | 'pcobMode'
    | 'pcobSessionId'
    | 'pcobBoundAt'
    | 'pcobLastSeenAt'
    | 'pcobKillSyncEnabled'
    | 'adapterKey'
  >
>;

const normalizeString = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const normalizeUpper = (value: unknown): string | null => {
  const normalized = normalizeString(value);
  return normalized ? normalized.toUpperCase() : null;
};

const normalizePcobSessionId = (value: unknown): string | null => {
  const normalized = normalizeString(value);
  return normalized ? normalized : null;
};

const normalizeAdapterKey = (value: unknown): string | null => {
  const normalized = normalizeString(value);
  return normalized ? normalized.toLowerCase() : null;
};

const isPcobModeSignal = (row: MatchTelemetryBackfillRow): boolean =>
  normalizeUpper(row.dataMode) === DataMode.PCOB || row.pcobMode === true;

const hasPcobTransportResidue = (row: MatchTelemetryBackfillRow): boolean =>
  !!row.pcobBoundAt || !!row.pcobLastSeenAt || row.pcobKillSyncEnabled === true;

const buildUpdateData = (
  row: MatchTelemetryBackfillRow,
  target: UpdateDraft,
): Prisma.MatchUncheckedUpdateInput | null => {
  const data: Prisma.MatchUncheckedUpdateInput = {};

  const maybeSet = <K extends keyof UpdateDraft>(key: K) => {
    if (!(key in target)) return;
    const nextValue = target[key];
    const currentValue = row[key];
    if (currentValue !== nextValue) {
      data[key] = nextValue as never;
    }
  };

  maybeSet('dataSource');
  maybeSet('dataMode');
  maybeSet('pcobMode');
  maybeSet('pcobSessionId');
  maybeSet('pcobBoundAt');
  maybeSet('pcobLastSeenAt');
  maybeSet('pcobKillSyncEnabled');
  maybeSet('adapterKey');

  return Object.keys(data).length ? data : null;
};

const unchanged = (
  currentProvider: TelemetryProvider,
  targetProvider: TelemetryProvider,
  fixCategories: MatchTelemetryBackfillFixCategory[] = [],
  notes: string[] = [],
): MatchTelemetryBackfillResult => ({
  action: 'unchanged',
  currentProvider,
  targetProvider,
  fixCategories,
  reviewCategories: [],
  notes,
  data: null,
});

const normalize = (
  row: MatchTelemetryBackfillRow,
  currentProvider: TelemetryProvider,
  targetProvider: TelemetryProvider,
  target: UpdateDraft,
  fixCategories: MatchTelemetryBackfillFixCategory[],
  notes: string[] = [],
): MatchTelemetryBackfillResult => {
  const data = buildUpdateData(row, target);
  if (!data) {
    return unchanged(currentProvider, targetProvider);
  }
  return {
    action: 'normalize',
    currentProvider,
    targetProvider,
    fixCategories,
    reviewCategories: [],
    notes,
    data,
  };
};

const manualReview = (
  currentProvider: TelemetryProvider,
  reviewCategories: MatchTelemetryBackfillReviewCategory[],
  notes: string[],
): MatchTelemetryBackfillResult => ({
  action: 'manual-review',
  currentProvider,
  targetProvider: null,
  fixCategories: [],
  reviewCategories,
  notes,
  data: null,
});

export const analyzeMatchTelemetryBackfill = (
  row: MatchTelemetryBackfillRow,
): MatchTelemetryBackfillResult => {
  const currentProvider = resolveCanonicalTelemetryProvider(row);
  const rawDataSource = normalizeUpper(row.dataSource);
  const explicitProvider =
    rawDataSource === MatchDataSource.MANUAL ||
    rawDataSource === MatchDataSource.API ||
    rawDataSource === MatchDataSource.SHADOW ||
    rawDataSource === MatchDataSource.PCOB
      ? rawDataSource
      : null;
  const legacyAuto = rawDataSource === 'AUTO';
  const pcobModeSignal = isPcobModeSignal(row);
  const pcobSessionId = normalizePcobSessionId(row.pcobSessionId);
  const adapterKey = normalizeAdapterKey(row.adapterKey);
  const hasPcobAdapter = adapterKey === PCOB_ADAPTER_KEY;
  const hasPcobBindingResidue =
    hasPcobAdapter || !!pcobSessionId || hasPcobTransportResidue(row);
  const validPcobConfig = hasPcobAdapter && !!pcobSessionId;

  if (!explicitProvider && !legacyAuto) {
    return manualReview(
      currentProvider,
      ['unsupported_data_source'],
      [`Unsupported dataSource value: ${String(row.dataSource ?? 'null')}`],
    );
  }

  if (explicitProvider === MatchDataSource.PCOB) {
    const reviewCategories: MatchTelemetryBackfillReviewCategory[] = [];
    const notes: string[] = [];
    if (!hasPcobAdapter) {
      reviewCategories.push('pcob_provider_missing_adapter');
      notes.push('PCOB provider rows require adapterKey pubgm-pcob.');
    }
    if (!pcobSessionId) {
      reviewCategories.push('pcob_provider_missing_session');
      notes.push('PCOB provider rows require pcobSessionId.');
    }
    if (reviewCategories.length) {
      return manualReview(currentProvider, reviewCategories, notes);
    }
    return normalize(
      row,
      currentProvider,
      MatchDataSource.PCOB,
      {
        dataSource: MatchDataSource.PCOB,
        dataMode: DataMode.PCOB,
        pcobMode: true,
        pcobSessionId,
        adapterKey: PCOB_ADAPTER_KEY,
      },
      ['sync_pcob_compatibility_fields'],
      ['Valid PCOB rows keep bound state but sync compatibility columns.'],
    );
  }

  if (legacyAuto) {
    if (pcobModeSignal) {
      if (!validPcobConfig) {
        return manualReview(
          currentProvider,
          ['legacy_auto_with_partial_pcob_binding'],
          [
            'AUTO rows with PCOB mode signals but missing adapter/session are ambiguous and require manual review.',
          ],
        );
      }
      return normalize(
        row,
        currentProvider,
        MatchDataSource.PCOB,
        {
          dataSource: MatchDataSource.PCOB,
          dataMode: DataMode.PCOB,
          pcobMode: true,
          pcobSessionId,
          adapterKey: PCOB_ADAPTER_KEY,
        },
        ['legacy_auto_to_pcob', 'sync_pcob_compatibility_fields'],
        [
          'Legacy AUTO rows with a valid PCOB binding are rewritten to canonical PCOB.',
        ],
      );
    }

    if (hasPcobAdapter || !!pcobSessionId) {
      return manualReview(
        currentProvider,
        ['legacy_auto_with_partial_pcob_binding'],
        [
          'AUTO rows with adapter/session binding traces but no valid PCOB mode signal are ambiguous and require manual review.',
        ],
      );
    }

    return normalize(
      row,
      currentProvider,
      MatchDataSource.API,
      {
        dataSource: MatchDataSource.API,
        dataMode: DataMode.MANUAL,
        pcobMode: false,
        pcobSessionId: null,
        pcobBoundAt: null,
        pcobLastSeenAt: null,
        pcobKillSyncEnabled: false,
      },
      [
        'legacy_auto_to_api',
        ...(hasPcobTransportResidue(row)
          ? (['clear_stale_pcob_fields'] as const)
          : []),
      ],
      ['Legacy AUTO rows without competing PCOB truth normalize to API.'],
    );
  }

  if (pcobModeSignal) {
    return manualReview(
      currentProvider,
      ['conflicting_data_source_and_pcob_mode'],
      [
        `Explicit provider ${explicitProvider} conflicts with dataMode/pcobMode PCOB state.`,
      ],
    );
  }

  return normalize(
    row,
    currentProvider,
    explicitProvider as TelemetryProvider,
    {
      dataSource: explicitProvider as TelemetryProvider,
      dataMode: DataMode.MANUAL,
      pcobMode: false,
      pcobSessionId: null,
      pcobBoundAt: null,
      pcobLastSeenAt: null,
      pcobKillSyncEnabled: false,
      ...(hasPcobAdapter ? { adapterKey: null } : {}),
    },
    hasPcobBindingResidue ? ['clear_stale_pcob_fields'] : [],
    hasPcobBindingResidue
      ? ['Explicit non-PCOB providers clear stale PCOB binding residue.']
      : [],
  );
};
