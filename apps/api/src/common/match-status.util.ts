import { MatchStatus } from '@prisma/client';

export type MatchLifecycleStatus =
  | 'READY'
  | 'COUNTDOWN'
  | 'LIVE'
  | 'FINISH_PENDING'
  | 'FINISHED';

export type MatchStatusLike = string | null | undefined;

export type MatchLifecycleContext = {
  status?: MatchStatusLike;
  liveState?: string | null;
  controlState?: string | null;
  metaJson?: unknown;
  dataSource?: string | null;
  dataMode?: string | null;
  manualLock?: boolean | null;
  forceUnlock?: boolean | null;
};

export type MatchLockContract = {
  lifecycleStatus: MatchLifecycleStatus;
  lifecycleLocked: boolean;
  resultsLocked: boolean;
  slotLocked: boolean;
  resultLockState: 'LOCKED' | 'UNLOCKED';
  reason: string | null;
};

export type PublicControlStatus =
  | 'READY'
  | 'COUNTDOWN'
  | 'LIVE'
  | 'FINISH_PENDING'
  | 'FINISHED';

const normalize = (value: MatchStatusLike): string =>
  (value ?? '').toString().trim().toUpperCase();

const normalizeControlState = (value?: string | null): string =>
  (value ?? '').toString().trim().toUpperCase();

const asJsonRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
};

const hasFinalizedMeta = (value: unknown): boolean => {
  const meta = asJsonRecord(value);
  return meta?.resultFinalized === true;
};

export function isManualResultsAuthority(
  ctx:
    | Pick<MatchLifecycleContext, 'dataSource' | 'dataMode'>
    | null
    | undefined,
): boolean {
  const dataSource = normalizeControlState(ctx?.dataSource);
  const dataMode = normalizeControlState(ctx?.dataMode);
  if (dataSource) {
    return dataSource === 'MANUAL';
  }
  return dataMode === 'MANUAL' || dataMode === '';
}

export const MATCH_FINISHED_STATUSES: MatchStatus[] = [
  MatchStatus.FINISHED,
  MatchStatus.ENDED,
];

export const MATCH_ACTIVE_OR_FINISHED_STATUSES: MatchStatus[] = [
  MatchStatus.LIVE,
  ...MATCH_FINISHED_STATUSES,
];

function normalizeLifecycleFromMatchStatus(
  status: MatchStatusLike,
): MatchLifecycleStatus | null {
  const normalized = normalize(status);
  if (!normalized) {
    return null;
  }
  if (normalized === MatchStatus.DRAFT) {
    return 'READY';
  }
  if (normalized === MatchStatus.LIVE) {
    return 'LIVE';
  }
  if (normalized === MatchStatus.FINISH_PENDING) {
    return 'FINISH_PENDING';
  }
  if (normalized === MatchStatus.ENDED) {
    return 'FINISH_PENDING';
  }
  if (normalized === MatchStatus.FINISHED) {
    return 'FINISHED';
  }
  return null;
}

function normalizeLifecycleFromLiveState(
  liveState?: string | null,
): MatchLifecycleStatus | null {
  const normalized = normalizeControlState(liveState);
  if (!normalized) {
    return null;
  }
  if (normalized === 'LIVE') {
    return 'LIVE';
  }
  if (normalized === 'ENDED') {
    return 'FINISH_PENDING';
  }
  return null;
}

function normalizeLifecycleFromControlState(
  controlState?: string | null,
): MatchLifecycleStatus | null {
  const normalized = normalizeControlState(controlState);
  if (!normalized) {
    return null;
  }
  if (
    normalized === 'READY' ||
    normalized === 'COUNTDOWN' ||
    normalized === 'LIVE' ||
    normalized === 'FINISH_PENDING'
  ) {
    return normalized as MatchLifecycleStatus;
  }
  if (normalized === 'PAUSED') {
    return 'LIVE';
  }
  if (normalized === 'ENDED') {
    return 'FINISH_PENDING';
  }
  if (normalized === 'CONFIRMED') {
    return 'FINISHED';
  }
  return null;
}

export function normalizeMatchLifecycleStatus(
  status: MatchStatusLike,
): MatchLifecycleStatus | null {
  return normalizeLifecycleFromMatchStatus(status);
}

export function deriveControlStateFromMatchStatus(
  status: MatchStatusLike,
): 'READY' | 'LIVE' | 'FINISH_PENDING' {
  if (isMatchLiveStatus(status)) {
    return 'LIVE';
  }
  if (isMatchFinalizingStatus(status)) {
    return 'FINISH_PENDING';
  }
  return 'READY';
}

export function deriveCanonicalMatchLifecycleStatus(
  ctx: MatchLifecycleContext | null | undefined,
): MatchLifecycleStatus {
  const controlLifecycle = normalizeLifecycleFromControlState(
    ctx?.controlState,
  );
  const matchLifecycle = normalizeLifecycleFromMatchStatus(ctx?.status);
  const liveLifecycle = normalizeLifecycleFromLiveState(ctx?.liveState);
  const finalized = hasFinalizedMeta(ctx?.metaJson);

  if (matchLifecycle === 'FINISHED') {
    return 'FINISHED';
  }
  if (
    matchLifecycle === 'FINISH_PENDING' ||
    isMatchFinalizingStatus(ctx?.status)
  ) {
    return 'FINISH_PENDING';
  }
  if (controlLifecycle === 'FINISHED') {
    return 'FINISHED';
  }
  if (controlLifecycle === 'FINISH_PENDING' && finalized) {
    return 'FINISHED';
  }
  if (controlLifecycle === 'FINISH_PENDING') {
    return 'FINISH_PENDING';
  }
  if (controlLifecycle && controlLifecycle !== 'READY') {
    return controlLifecycle;
  }
  if (finalized) {
    return 'FINISHED';
  }
  if (controlLifecycle === 'READY') {
    return matchLifecycle && matchLifecycle !== 'READY'
      ? matchLifecycle
      : 'READY';
  }
  return matchLifecycle ?? liveLifecycle ?? 'READY';
}

export function derivePublicControlStatus(
  ctx: MatchLifecycleContext | null | undefined,
): PublicControlStatus {
  const lifecycleStatus = deriveCanonicalMatchLifecycleStatus(ctx);
  return lifecycleStatus;
}

export function deriveMatchLockContract(
  ctx: MatchLifecycleContext | null | undefined,
): MatchLockContract {
  const lifecycleStatus = deriveCanonicalMatchLifecycleStatus(ctx);
  const finalizing = isMatchFinalizingStatus(ctx?.status);
  const manualLock = ctx?.manualLock === true;
  const forceUnlock = ctx?.forceUnlock === true;
  const finalized = hasFinalizedMeta(ctx?.metaJson);
  const manual = isManualResultsAuthority(ctx);

  let resultsLocked = false;
  let reason: string | null = null;

  if (manualLock) {
    resultsLocked = true;
    reason = 'Results are locked by match control.';
  } else if (manual) {
    resultsLocked = false;
    reason = null;
  } else if (finalized || lifecycleStatus === 'FINISHED') {
    if (forceUnlock) {
      resultsLocked = false;
      reason = 'Results are reopened for manual editing.';
    } else {
      resultsLocked = true;
      reason = 'Results are finalized for this match.';
    }
  } else if (finalizing || lifecycleStatus === 'FINISH_PENDING') {
    resultsLocked = true;
    reason = 'Results remain locked until match finalization completes.';
  } else if (
    lifecycleStatus === 'READY' ||
    lifecycleStatus === 'COUNTDOWN' ||
    lifecycleStatus === 'LIVE'
  ) {
    resultsLocked = true;
    reason = 'Results are locked until match finalization begins.';
  } else if (forceUnlock) {
    resultsLocked = true;
    reason = 'Results remain locked until match finalization completes.';
  }

  return {
    lifecycleStatus,
    lifecycleLocked:
      lifecycleStatus === 'FINISH_PENDING' || lifecycleStatus === 'FINISHED',
    resultsLocked,
    slotLocked:
      finalizing ||
      lifecycleStatus === 'FINISH_PENDING' ||
      lifecycleStatus === 'FINISHED',
    resultLockState: resultsLocked ? 'LOCKED' : 'UNLOCKED',
    reason,
  };
}

export function isMatchReadyStatus(status: MatchStatusLike): boolean {
  return normalizeMatchLifecycleStatus(status) === 'READY';
}

export function isMatchLiveStatus(status: MatchStatusLike): boolean {
  return normalize(status) === MatchStatus.LIVE;
}

export function isMatchFinalizingStatus(status: MatchStatusLike): boolean {
  return normalize(status) === MatchStatus.FINISH_PENDING;
}

export function isMatchFinishedStatus(status: MatchStatusLike): boolean {
  const normalized = normalize(status);
  return (
    normalized === MatchStatus.FINISHED || normalized === MatchStatus.ENDED
  );
}

export function isMatchLockedStatus(status: MatchStatusLike): boolean {
  return isMatchFinishedStatus(status);
}

export function canAcceptTelemetryForMatch(status: MatchStatusLike): boolean {
  return isMatchLiveStatus(status);
}

export function isMatchStartableStatus(status: MatchStatusLike): boolean {
  return (
    !isMatchLiveStatus(status) &&
    !isMatchFinalizingStatus(status) &&
    !isMatchLockedStatus(status)
  );
}

export function canStartMatchForLifecycle(status: MatchStatusLike): boolean {
  return isMatchStartableStatus(status);
}
