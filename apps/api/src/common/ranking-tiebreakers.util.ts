export type RankingTieBreakRow = object;

const readNumber = (row: RankingTieBreakRow, keys: string[]): number | null => {
  const values = row as Record<string, unknown>;
  for (const key of keys) {
    const value = values[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
  }
  return null;
};

const readWwcd = (row: RankingTieBreakRow): number => {
  const explicit = readNumber(row, ['wwcd']);
  if (explicit !== null) {
    return explicit;
  }

  const placement = readNumber(row, ['placement']);
  return placement === 1 ? 1 : 0;
};

export const compareRankingRows = (
  left: RankingTieBreakRow,
  right: RankingTieBreakRow,
): number => {
  const leftTotal = readNumber(left, ['totalPoints', 'total']) ?? 0;
  const rightTotal = readNumber(right, ['totalPoints', 'total']) ?? 0;
  if (rightTotal !== leftTotal) {
    return rightTotal - leftTotal;
  }

  const leftWwcd = readWwcd(left);
  const rightWwcd = readWwcd(right);
  if (rightWwcd !== leftWwcd) {
    return rightWwcd - leftWwcd;
  }

  const leftPlacementPoints =
    readNumber(left, ['placementPoints', 'totalPlacementPoints']) ?? 0;
  const rightPlacementPoints =
    readNumber(right, ['placementPoints', 'totalPlacementPoints']) ?? 0;
  if (rightPlacementPoints !== leftPlacementPoints) {
    return rightPlacementPoints - leftPlacementPoints;
  }

  const leftKills = readNumber(left, ['kills', 'totalKills']) ?? 0;
  const rightKills = readNumber(right, ['kills', 'totalKills']) ?? 0;
  if (rightKills !== leftKills) {
    return rightKills - leftKills;
  }

  return 0;
};
