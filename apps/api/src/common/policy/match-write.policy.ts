import { ForbiddenException } from '@nestjs/common';
import {
  deriveMatchLockContract,
  isMatchFinalizingStatus,
} from '../match-status.util';

const ALLOWED = new Set([
  'DRAFT',
  'LIVE',
  'ENDED',
  'FINISH_PENDING',
  'FINISHED',
]);

export function assertMatchWritable(
  match:
    | {
        status?: string | null | undefined;
        liveState?: string | null | undefined;
        controlState?:
          | {
              state?: string | null | undefined;
              metaJson?: unknown;
              resultsManualLock?: boolean | null | undefined;
              resultsForceUnlock?: boolean | null | undefined;
            }
          | null
          | undefined;
        dataSource?: string | null | undefined;
        dataMode?: string | null | undefined;
      }
    | string
    | null
    | undefined,
  actor: {
    role: string | null | undefined;
    override?: boolean | null | undefined;
  },
) {
  const status =
    typeof match === 'string' || match === null || match === undefined
      ? (match ?? '').toString().toUpperCase()
      : (match.status ?? '').toString().toUpperCase();
  if (!ALLOWED.has(status)) {
    throw new ForbiddenException('Match status is invalid.');
  }
  const lock = deriveMatchLockContract(
    typeof match === 'string' || match === null || match === undefined
      ? { status: match ?? null }
      : {
          status: match.status ?? null,
          liveState: match.liveState ?? null,
          controlState: match.controlState?.state ?? null,
          metaJson: match.controlState?.metaJson ?? null,
          dataSource: match.dataSource ?? null,
          dataMode: match.dataMode ?? null,
          manualLock: match.controlState?.resultsManualLock ?? null,
          forceUnlock: match.controlState?.resultsForceUnlock ?? null,
        },
  );
  const manual =
    typeof match === 'string' || match === null || match === undefined
      ? false
      : (match.dataSource ?? match.dataMode ?? '').toString().toUpperCase() ===
        'MANUAL';
  if (
    !manual &&
    (isMatchFinalizingStatus(status) ||
      (lock.lifecycleStatus === 'FINISHED' && lock.resultsLocked))
  ) {
    throw new ForbiddenException('Match is locked.');
  }
  // All allowed statuses permit edits; gameplay gating is enforced elsewhere.
  void actor;
}
