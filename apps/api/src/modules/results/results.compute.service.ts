import { Injectable } from '@nestjs/common';
import type { TeamRoundResult } from '@prisma/client';

@Injectable()
export class ResultsComputeService {
  private readonly killPointValue: number;

  constructor() {
    const killValue = Number(process.env.RESULTS_KILL_POINT_VALUE ?? 1);
    this.killPointValue = Number.isFinite(killValue) ? killValue : 1;
  }

  private placementPoints(placement?: number | null): number {
    if (!placement || placement <= 0) return 0;
    if (placement === 1) return 10;
    if (placement === 2) return 6;
    if (placement === 3) return 5;
    if (placement === 4) return 4;
    if (placement === 5) return 3;
    if (placement === 6) return 2;
    if (placement === 7 || placement === 8) return 1;
    return 0;
  }

  computeAutoPoints(
    placement: number | null | undefined,
    kills: number | null | undefined,
  ): number {
    const placementScore = this.placementPoints(placement);
    const killScore = (kills ?? 0) * this.killPointValue;
    return placementScore + killScore;
  }

  applyFinals(result: TeamRoundResult): TeamRoundResult {
    const pointsAuto =
      result.pointsAuto ??
      this.computeAutoPoints(result.placementAuto, result.killsAuto);

    const manualPlacementProvided =
      result.placementManual !== null &&
      result.placementManual !== undefined &&
      result.isManualOverride;
    const manualKillsProvided =
      result.killsManual !== null &&
      result.killsManual !== undefined &&
      result.isManualOverride;
    const manualPointsProvided =
      result.pointsManual !== null &&
      result.pointsManual !== undefined &&
      result.isManualOverride;

    const finalPlacement = manualPlacementProvided
      ? result.placementManual
      : (result.placementAuto ?? null);
    const finalKills = manualKillsProvided
      ? result.killsManual
      : (result.killsAuto ?? null);

    let basePoints = pointsAuto;
    if (result.isManualOverride) {
      if (manualPointsProvided) {
        basePoints = result.pointsManual ?? basePoints;
      } else if (manualPlacementProvided || manualKillsProvided) {
        basePoints = this.computeAutoPoints(
          manualPlacementProvided
            ? result.placementManual
            : result.placementAuto,
          manualKillsProvided ? result.killsManual : result.killsAuto,
        );
      }
    }

    const penalty = result.penaltyPoints ?? 0;
    const finalPoints = (basePoints ?? 0) + penalty;

    return {
      ...result,
      pointsAuto,
      finalPlacement,
      finalKills,
      finalPoints,
    };
  }
}
