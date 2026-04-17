export type UniqueSlotPlayerNameInput = {
  playerName?: string | null;
  stableId?: string | null;
};

function normalizePlayerName(playerName?: string | null): string {
  const trimmed = playerName?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : 'Player';
}

function compareStableIds(
  left: string | null | undefined,
  right: string | null | undefined,
): number {
  if (left && right) {
    return left.localeCompare(right);
  }
  if (left) return -1;
  if (right) return 1;
  return 0;
}

export function uniqueSlotPlayerNames(
  inputs: readonly UniqueSlotPlayerNameInput[],
): string[] {
  const normalized = inputs.map((input, index) => ({
    index,
    baseName: normalizePlayerName(input.playerName),
    stableId: input.stableId?.trim() || null,
  }));

  const occupied = new Set(normalized.map((entry) => entry.baseName));
  const groups = new Map<string, typeof normalized>();

  for (const entry of normalized) {
    const existing = groups.get(entry.baseName);
    if (existing) {
      existing.push(entry);
      continue;
    }
    groups.set(entry.baseName, [entry]);
  }

  const result = new Array<string>(inputs.length);

  for (const entries of groups.values()) {
    const ordered = entries
      .slice()
      .sort(
        (left, right) =>
          compareStableIds(left.stableId, right.stableId) ||
          left.index - right.index,
      );

    ordered.forEach((entry, duplicateIndex) => {
      if (duplicateIndex === 0) {
        result[entry.index] = entry.baseName;
        return;
      }

      let suffix = 2;
      let candidate = `${entry.baseName} (${suffix})`;
      while (occupied.has(candidate)) {
        suffix += 1;
        candidate = `${entry.baseName} (${suffix})`;
      }

      occupied.add(candidate);
      result[entry.index] = candidate;
    });
  }

  return result;
}
