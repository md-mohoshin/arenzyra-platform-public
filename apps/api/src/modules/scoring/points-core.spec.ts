import {
  computeSlotTotals,
  resolvePlacementPoints,
  sumPlayerKills,
  computeKillPoints,
} from './points-core';

type LegacyParams = {
  placement: number | null;
  players: { kills?: number | null }[];
  manualTotalKills?: boolean;
  slotTotalKills?: number | null;
  placementTable: Record<number, number>;
  killPoints: number;
};

const legacyCompute = (params: LegacyParams) => {
  const placement = params.placement ?? null;
  const placementPoints =
    placement !== null && placement !== undefined
      ? (params.placementTable[placement] ?? 0)
      : 0;
  const killsFromPlayers =
    params.players?.reduce((sum, p) => sum + (p.kills ?? 0), 0) ?? 0;
  const totalKills = params.manualTotalKills
    ? (params.slotTotalKills ?? killsFromPlayers)
    : killsFromPlayers;
  const killPoints = totalKills * (params.killPoints ?? 1);
  const points = killPoints;
  const totalPoints = placementPoints + points;
  return { placementPoints, totalKills, killPoints, points, totalPoints };
};

describe('points-core', () => {
  const placementTable = { 1: 10, 2: 6, 3: 5 };
  const players = [{ kills: 2 }, { kills: 1 }];

  const cases: Array<{
    name: string;
    placement: number | null;
    manualTotalKills?: boolean;
    slotTotalKills?: number | null;
    killPoints: number;
  }> = [
    {
      name: 'placement null, manual off, killPoints x1',
      placement: null,
      manualTotalKills: false,
      slotTotalKills: null,
      killPoints: 1,
    },
    {
      name: 'placement 1, manual off, killPoints x1',
      placement: 1,
      manualTotalKills: false,
      slotTotalKills: null,
      killPoints: 1,
    },
    {
      name: 'placement 1, manual on, killPoints x1',
      placement: 1,
      manualTotalKills: true,
      slotTotalKills: 5,
      killPoints: 1,
    },
    {
      name: 'placement 1, manual on, killPoints x2',
      placement: 1,
      manualTotalKills: true,
      slotTotalKills: 4,
      killPoints: 2,
    },
  ];

  it('resolvePlacementPoints matches legacy behaviour', () => {
    expect(resolvePlacementPoints(1, placementTable)).toBe(10);
    expect(resolvePlacementPoints(null, placementTable)).toBe(0);
    expect(resolvePlacementPoints(0, placementTable)).toBe(0);
  });

  it('sumPlayerKills matches reduce behaviour', () => {
    expect(sumPlayerKills(players)).toBe(3);
    expect(sumPlayerKills([])).toBe(0);
  });

  it('computeKillPoints multiplies correctly', () => {
    expect(computeKillPoints(3, 1)).toBe(3);
    expect(computeKillPoints(3, 2)).toBe(6);
  });

  it.each(cases)('computeSlotTotals parity - %s', (c) => {
    const expected = legacyCompute({
      placement: c.placement,
      players,
      manualTotalKills: c.manualTotalKills,
      slotTotalKills: c.slotTotalKills,
      placementTable,
      killPoints: c.killPoints,
    });

    const actual = computeSlotTotals({
      placement: c.placement,
      players,
      manualTotalKills: c.manualTotalKills,
      slotTotalKills: c.slotTotalKills,
      placementTable,
      killPointsMultiplier: c.killPoints,
    });

    expect(actual).toEqual(expected);
  });
});
