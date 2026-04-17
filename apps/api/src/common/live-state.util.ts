import type { ControlState } from '@prisma/client';

export type DerivedState = 'LIVE' | 'ENDED' | 'UPCOMING';

export type ControlLike = {
  controlState?: { state?: ControlState | null } | null;
};

export type GroupLike = {
  state?: DerivedState | null;
  matches?: Array<ControlLike> | null;
};

export function deriveControlLiveState(
  controlState?: ControlState | null,
): DerivedState {
  const normalized = controlState ?? null;
  if (normalized === 'LIVE' || normalized === 'PAUSED') return 'LIVE';
  if (normalized === 'ENDED' || normalized === 'CONFIRMED') return 'ENDED';
  return 'UPCOMING';
}

export function anyMatchLive(matches: Array<ControlLike>): boolean {
  return matches.some(
    (m) => deriveControlLiveState(m?.controlState?.state) === 'LIVE',
  );
}

/**
 * Derive the lifecycle state of a group from its matches' control states.
 *
 * LIVE  -> any match is LIVE/PAUSED
 * ENDED -> all matches (if any) are ENDED/CONFIRMED
 * UPCOMING -> otherwise (no matches or still pending)
 */
export function deriveGroupStateFromMatches(
  matches: Array<ControlLike>,
): DerivedState {
  const derived = matches.map((m) =>
    deriveControlLiveState(m?.controlState?.state),
  );
  if (derived.some((s) => s === 'LIVE')) return 'LIVE';
  if (derived.length > 0 && derived.every((s) => s === 'ENDED')) return 'ENDED';
  return 'UPCOMING';
}

/**
 * Backwards-compatible helper (previously returned LIVE/UPCOMING only).
 * Now returns LIVE/ENDED/UPCOMING per group derivation rules.
 */
export function aggregateLiveState(matches: Array<ControlLike>): DerivedState {
  return deriveGroupStateFromMatches(matches);
}

/**
 * Derive the lifecycle state of a stage from its groups.
 *
 * LIVE  -> any group is LIVE
 * ENDED -> all groups (if any) are ENDED
 * UPCOMING -> otherwise (no groups or still pending)
 */
export function deriveStageStateFromGroups(
  groups: Array<GroupLike>,
): DerivedState {
  const groupStates = groups.map(
    (g) => g.state ?? deriveGroupStateFromMatches(g.matches ?? []),
  );
  if (groupStates.some((s) => s === 'LIVE')) return 'LIVE';
  if (groupStates.length > 0 && groupStates.every((s) => s === 'ENDED')) {
    return 'ENDED';
  }
  return 'UPCOMING';
}

/**
 * Derive tournament state directly from its matches' control states.
 */
export function deriveTournamentStateFromMatches(
  matches: Array<ControlLike>,
): DerivedState {
  const derived = matches.map((m) =>
    deriveControlLiveState(m?.controlState?.state),
  );
  if (derived.some((s) => s === 'LIVE')) return 'LIVE';
  if (derived.length > 0 && derived.every((s) => s === 'ENDED')) return 'ENDED';
  return 'UPCOMING';
}
