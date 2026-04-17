import { ResultsComputeService } from './results.compute.service';

const baseResult = (
  overrides: Partial<Parameters<ResultsComputeService['applyFinals']>[0]> = {},
) => ({
  id: 'res-1',
  matchRoundId: 'round-1',
  teamId: 'team-1',
  placementAuto: null,
  killsAuto: null,
  pointsAuto: null,
  placementManual: null,
  killsManual: null,
  pointsManual: null,
  penaltyPoints: 0,
  isManualOverride: false,
  finalPlacement: null,
  finalKills: null,
  finalPoints: null,
  notes: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

describe('ResultsComputeService', () => {
  const service = new ResultsComputeService();

  it('uses auto values when manual override is false', () => {
    const computed = service.applyFinals(
      baseResult({ placementAuto: 2, killsAuto: 5 }),
    );
    expect(computed.finalPlacement).toBe(2);
    expect(computed.finalKills).toBe(5);
    expect(computed.finalPoints).toBe(service.computeAutoPoints(2, 5));
  });

  it('prefers manual values when override is enabled', () => {
    const computed = service.applyFinals(
      baseResult({
        placementAuto: 4,
        killsAuto: 1,
        placementManual: 1,
        killsManual: 7,
        pointsManual: 30,
        penaltyPoints: -2,
        isManualOverride: true,
      }),
    );
    expect(computed.finalPlacement).toBe(1);
    expect(computed.finalKills).toBe(7);
    expect(computed.finalPoints).toBe(28); // manual points (30) + penalty (-2)
  });

  it('computes manual points when manual placement/kills provided without manual points', () => {
    const computed = service.applyFinals(
      baseResult({
        placementAuto: 5,
        killsAuto: 0,
        placementManual: 3,
        killsManual: 4,
        isManualOverride: true,
        penaltyPoints: -1,
      }),
    );
    const expected = service.computeAutoPoints(3, 4) - 1;
    expect(computed.finalPlacement).toBe(3);
    expect(computed.finalKills).toBe(4);
    expect(computed.finalPoints).toBe(expected);
  });
});
