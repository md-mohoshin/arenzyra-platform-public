export function resolvePlacementPoints(
  placement: number | null,
  placementTable: Record<number, number>,
): number {
  if (placement === null || placement === undefined) return 0;
  if (placement <= 0) return 0;
  return placementTable[placement] ?? 0;
}

export function sumPlayerKills(players: { kills?: number | null }[]): number {
  return players.reduce((sum, p) => sum + (p.kills ?? 0), 0);
}

export function computeKillPoints(
  totalKills: number,
  killPointsMultiplier: number,
): number {
  return totalKills * (killPointsMultiplier ?? 1);
}

type ComputeSlotTotalsParams = {
  placement: number | null;
  players: { kills?: number | null }[];
  manualTotalKills?: boolean;
  slotTotalKills?: number | null;
  placementTable: Record<number, number>;
  killPointsMultiplier: number;
};

type ComputeSlotTotalsResult = {
  placementPoints: number;
  totalKills: number;
  killPoints: number;
  points: number;
  totalPoints: number;
};

export function computeSlotTotals(
  params: ComputeSlotTotalsParams,
): ComputeSlotTotalsResult {
  const placementPoints = resolvePlacementPoints(
    params.placement,
    params.placementTable,
  );

  const killsFromPlayers = sumPlayerKills(params.players);
  const totalKills = params.manualTotalKills
    ? (params.slotTotalKills ?? killsFromPlayers)
    : killsFromPlayers;

  const killPoints = computeKillPoints(totalKills, params.killPointsMultiplier);
  const points = killPoints;
  const totalPoints = placementPoints + points;

  return { placementPoints, totalKills, killPoints, points, totalPoints };
}

export type { ComputeSlotTotalsParams, ComputeSlotTotalsResult };
