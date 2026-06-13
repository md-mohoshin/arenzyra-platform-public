type SummaryMetric = number | null;

export type MatchResultSummaryTelemetryStats = {
  totalKnocks: SummaryMetric;
  totalDamage: SummaryMetric;
  totalAssists: SummaryMetric;
  grenadeKills: SummaryMetric;
  vehicleKills: SummaryMetric;
};

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
};

const toNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const pickNumber = (
  record: Record<string, unknown> | null,
  keys: readonly string[],
): number | null => {
  if (!record) {
    return null;
  }
  for (const key of keys) {
    const value = toNumber(record[key]);
    if (value !== null) {
      return value;
    }
  }
  return null;
};

const PLAYER_LIST_KEYS = [
  'players',
  'Players',
  'playerInfoList',
  'PlayerInfoList',
  'TotalPlayerList',
  'totalPlayerList',
  'teamPlayerList',
  'TeamPlayerList',
] as const;

const PLAYER_CONTAINER_KEYS = [
  'raw',
  'payload',
  'data',
  'game',
  'match',
] as const;

const pushPlayerList = (lists: unknown[][], value: unknown) => {
  if (!Array.isArray(value) || value.length === 0) {
    return;
  }
  lists.push(value);
};

const collectPlayerListsFromRecord = (
  record: Record<string, unknown> | null,
  lists: unknown[][],
  seen: Set<Record<string, unknown>>,
) => {
  if (!record || seen.has(record)) {
    return;
  }
  seen.add(record);

  for (const key of PLAYER_LIST_KEYS) {
    pushPlayerList(lists, record[key]);
  }

  for (const key of PLAYER_CONTAINER_KEYS) {
    collectPlayerListsFromRecord(asRecord(record[key]), lists, seen);
  }
};

const extractPlayerLists = (telemetryPayload: unknown): unknown[][] => {
  const lists: unknown[][] = [];
  const telemetry = asRecord(telemetryPayload);
  collectPlayerListsFromRecord(telemetry, lists, new Set());
  return lists;
};

const sumMetric = (
  playerLists: unknown[][],
  keys: readonly string[],
): SummaryMetric => {
  for (const players of playerLists) {
    let total = 0;
    let hasValue = false;

    for (const player of players) {
      const playerRecord = asRecord(player);
      const source = asRecord(playerRecord?.raw) ?? playerRecord;
      const value = pickNumber(source, keys);
      if (value === null) {
        continue;
      }
      total += value;
      hasValue = true;
    }

    if (hasValue) {
      return total;
    }
  }

  return null;
};

export function extractMatchResultSummaryTelemetryStats(
  telemetryPayload: unknown,
): MatchResultSummaryTelemetryStats {
  const playerLists = extractPlayerLists(telemetryPayload);

  return {
    totalKnocks: sumMetric(playerLists, [
      'knockouts',
      'Knockouts',
      'knocks',
      'Knocks',
      'knockNum',
      'KnockNum',
      'knockCount',
      'KnockCount',
    ]),
    totalDamage: sumMetric(playerLists, [
      'damage',
      'Damage',
      'damageDealt',
      'DamageDealt',
      'totalDamage',
      'TotalDamage',
      'damageValue',
      'DamageValue',
    ]),
    totalAssists: sumMetric(playerLists, [
      'assists',
      'Assists',
      'assistNum',
      'AssistNum',
      'assistCount',
      'AssistCount',
    ]),
    grenadeKills: sumMetric(playerLists, [
      'killNumByGrenade',
      'KillNumByGrenade',
      'grenadeKills',
      'GrenadeKills',
    ]),
    vehicleKills: sumMetric(playerLists, [
      'killNumInVehicle',
      'KillNumInVehicle',
      'vehicleKills',
      'VehicleKills',
    ]),
  };
}

export function normalizeFallbackSummaryMetric(
  value: SummaryMetric,
  opts: {
    totalKills: number;
    totalDamage: SummaryMetric;
    relatedMetric?: SummaryMetric;
  },
): SummaryMetric {
  if (
    opts.totalKills > 0 &&
    opts.totalDamage === null &&
    (opts.relatedMetric ?? 0) === 0 &&
    value === 0
  ) {
    return null;
  }
  return value;
}
