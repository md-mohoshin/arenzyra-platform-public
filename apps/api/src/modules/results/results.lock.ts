import { HttpException, HttpStatus } from '@nestjs/common';
import { deriveMatchLockContract } from '../../common/match-status.util';

export type ResultLockState = 'LOCKED' | 'UNLOCKED';

export type ResultLockContext = {
  status?: string | null;
  dataSource?: string | null;
  dataMode?: string | null;
  liveState?: string | null;
  controlState?: string | null;
  manualLock?: boolean | null;
  forceUnlock?: boolean | null;
};

export function deriveResultLockState(
  ctx: ResultLockContext | null | undefined,
): ResultLockState {
  return deriveMatchLockContract({
    status: ctx?.status ?? null,
    liveState: ctx?.liveState ?? null,
    controlState: ctx?.controlState ?? null,
    dataSource: ctx?.dataSource ?? null,
    dataMode: ctx?.dataMode ?? null,
    manualLock: ctx?.manualLock ?? null,
    forceUnlock: ctx?.forceUnlock ?? null,
  }).resultLockState;
}

export function ensureResultsUnlocked(ctx: ResultLockContext) {
  if (deriveResultLockState(ctx) === 'LOCKED') {
    throw new HttpException(
      'Results are locked for the current match state.',
      HttpStatus.CONFLICT,
    );
  }
}
