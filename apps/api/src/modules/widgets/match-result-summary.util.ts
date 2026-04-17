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

const sumMetric = (
  players: unknown[],
  keys: readonly string[],
): SummaryMetric => {
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

  return hasValue ? total : null;
};

export function extractMatchResultSummaryTelemetryStats(
  telemetryPayload: unknown,
): MatchResultSummaryTelemetryStats {
  const telemetry = asRecord(telemetryPayload);
  const players = Array.isArray(telemetry?.players) ? telemetry.players : [];

  return {
    totalKnocks: sumMetric(players, [
      'knockouts',
      'Knockouts',
      'knocks',
      'Knocks',
      'knockNum',
      'KnockNum',
    ]),
    totalDamage: sumMetric(players, [
      'damage',
      'Damage',
      'damageDealt',
      'DamageDealt',
      'totalDamage',
      'TotalDamage',
    ]),
    totalAssists: sumMetric(players, [
      'assists',
      'Assists',
      'assistNum',
      'AssistNum',
    ]),
    grenadeKills: sumMetric(players, [
      'killNumByGrenade',
      'KillNumByGrenade',
      'grenadeKills',
      'GrenadeKills',
    ]),
    vehicleKills: sumMetric(players, [
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
