import {
  computeSlotTotals,
  resolvePlacementPoints,
  computeKillPoints,
} from './points-core';

const placementTable = { 1: 10, 2: 6, 3: 5 };

// Mimic slices of services without side effects
const resultsCompute = (
  slot: {
    placement?: number | null;
    totalKills?: number | null;
    players?: { kills?: number | null }[];
  },
  ruleset: { placementPoints: Record<number, number>; killPoints: number },
) => {
  return computeSlotTotals({
    placement: slot.placement ?? null,
    players: slot.players ?? [],
    manualTotalKills: (slot as { manualTotalKills?: boolean }).manualTotalKills,
    slotTotalKills: slot.totalKills ?? null,
    placementTable: ruleset.placementPoints,
    killPointsMultiplier: ruleset.killPoints,
  });
};

const rankingCompute = (
  slot: { placement?: number | null; totalKills?: number | null },
  killPointsMultiplier: number,
  table: Record<number, number>,
) => {
  const placement = slot.placement ?? null;
  const placementPoints = resolvePlacementPoints(placement, table);
  const kills = slot.totalKills ?? 0;
  const killPoints = computeKillPoints(kills, killPointsMultiplier);
  return {
    placementPoints,
    killPoints,
    totalPoints: placementPoints + killPoints,
  };
};

const scoreboardCompute = (slot: {
  placement?: number | null;
  placementPoints?: number | null;
  totalKills?: number | null;
}) => {
  const placement = slot.placement ?? null;
  const placementPoints =
    slot.placementPoints ??
    resolvePlacementPoints(placement, {
      ...(placement ? { [placement]: slot.placementPoints ?? 0 } : {}),
    });
  const kills = slot.totalKills ?? 0;
  const totalPoints = placementPoints + computeKillPoints(kills, 1);
  return {
    placementPoints,
    killPoints: computeKillPoints(kills, 1),
    totalPoints,
  };
};

describe('Scoring contract parity', () => {
  const slot = {
    placement: 2,
    players: [{ kills: 2 }, { kills: 1 }],
    totalKills: 3,
    placementPoints: 6,
  } as {
    placement?: number | null;
    players?: { kills?: number | null }[];
    totalKills?: number | null;
    placementPoints?: number | null;
  };
  const ruleset = { placementPoints: placementTable, killPoints: 1 };

  it('results, ranking, and scoreboard totals match', () => {
    const resTotals = resultsCompute(slot, ruleset);
    const rankTotals = rankingCompute(slot, 1, placementTable);
    const boardTotals = scoreboardCompute(slot);

    expect(rankTotals.totalPoints).toBe(resTotals.totalPoints);
    expect(boardTotals.totalPoints).toBe(resTotals.totalPoints);
    expect(rankTotals.placementPoints).toBe(resTotals.placementPoints);
    expect(boardTotals.placementPoints).toBe(resTotals.placementPoints);
    expect(rankTotals.killPoints).toBe(resTotals.killPoints);
    expect(boardTotals.killPoints).toBe(resTotals.killPoints);
  });
});
