import type { ControlState, MatchStatus, Prisma } from '@prisma/client';
import type { ResultLockState } from './results.lock';

export type MatchSummary = {
  id: string;
  organizationId: string | null;
  sessionId?: string | null;
  map: string | null;
  status: MatchStatus;
  liveState?: string | null;
  endedAt?: Date | null;
  gameKey?: string | null;
  dataSource?: string | null;
  dataMode?: string | null;
  controlState?: {
    state?: ControlState | null;
    authorityMode?: string | null;
    resultsManualLock?: boolean | null;
    resultsForceUnlock?: boolean | null;
    metaJson?: Prisma.JsonValue | null;
  } | null;
  resultLockState: ResultLockState;
  tournamentId?: string | null;
  stageId?: string | null;
  groupId?: string | null;
  tournament?: {
    ownerUserId: string | null;
    organizationId: string | null;
  } | null;
};
