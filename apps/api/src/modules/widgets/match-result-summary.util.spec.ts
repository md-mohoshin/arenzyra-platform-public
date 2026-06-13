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

  it('reads raw observer mirror players when compatibility payload players are blank', () => {
    const stats = extractMatchResultSummaryTelemetryStats({
      players: [],
      raw: {
        players: [
          {
            knockouts: 2,
            assists: 1,
            damage: 350,
            killNumByGrenade: 0,
            killNumInVehicle: 1,
          },
          {
            knockouts: 0,
            assists: 3,
            damage: 720,
            killNumByGrenade: 2,
            killNumInVehicle: 0,
          },
        ],
      },
      structuralMirrorDisabled: true,
    });

    expect(stats).toEqual({
      totalKnocks: 2,
      totalDamage: 1070,
      totalAssists: 4,
      grenadeKills: 2,
      vehicleKills: 1,
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
