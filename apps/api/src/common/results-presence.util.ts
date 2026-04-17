export type PresenceStatus = 'ACTIVE' | 'NO_SHOW' | 'UNRESOLVED';

export function isPresentInMatch(value?: boolean | null): boolean {
  return value === true;
}

export function isCompetitiveResultsTeam(value?: boolean | null): boolean {
  return value !== false;
}

export function derivePresenceStatus(value?: boolean | null): PresenceStatus {
  if (value === true) {
    return 'ACTIVE';
  }
  if (value === false) {
    return 'NO_SHOW';
  }
  return 'UNRESOLVED';
}

export function comparePresenceStatus(
  left?: boolean | null,
  right?: boolean | null,
): number {
  const order = (value?: boolean | null): number => {
    if (value === true) {
      return 0;
    }
    if (value === null || value === undefined) {
      return 1;
    }
    return 2;
  };

  return order(left) - order(right);
}
