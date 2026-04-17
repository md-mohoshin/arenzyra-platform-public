import {
  extractMatchResultSummaryTelemetryStats,
  normalizeFallbackSummaryMetric,
} from './match-result-summary.util';

describe('extractMatchResultSummaryTelemetryStats', () => {
  it('sums saved raw telemetry player stats for post-match summary fields', () => {
    const stats = extractMatchResultSummaryTelemetryStats({
      players: [
        {
          raw: {
            knockouts: 3,
            assists: 2,
            damage: 640,
            killNumByGrenade: 1,
            killNumInVehicle: 0,
          },
        },
        {
          raw: {
            knockouts: 4,
            assists: 1,
            damage: 900,
            killNumByGrenade: 0,
            killNumInVehicle: 2,
          },
        },
      ],
    });

    expect(stats).toEqual({
      totalKnocks: 7,
      totalDamage: 1540,
      totalAssists: 3,
      grenadeKills: 1,
      vehicleKills: 2,
    });
  });

  it('returns null metrics when the telemetry payload has no usable player summary fields', () => {
    const stats = extractMatchResultSummaryTelemetryStats({
      players: [{ raw: { playerName: 'Player' } }],
    });

    expect(stats).toEqual({
      totalKnocks: null,
      totalDamage: null,
      totalAssists: null,
      grenadeKills: null,
      vehicleKills: null,
    });
  });
});

describe('normalizeFallbackSummaryMetric', () => {
  it('hides impossible zero totals when kills exist but no richer stat source was persisted', () => {
    expect(
      normalizeFallbackSummaryMetric(0, {
        totalKills: 12,
        totalDamage: null,
        relatedMetric: null,
      }),
    ).toBeNull();
  });

  it('preserves legitimate metrics when richer post-match data exists', () => {
    expect(
      normalizeFallbackSummaryMetric(0, {
        totalKills: 0,
        totalDamage: null,
        relatedMetric: null,
      }),
    ).toBe(0);
    expect(
      normalizeFallbackSummaryMetric(4, {
        totalKills: 12,
        totalDamage: 1800,
        relatedMetric: 2,
      }),
    ).toBe(4);
  });
});
