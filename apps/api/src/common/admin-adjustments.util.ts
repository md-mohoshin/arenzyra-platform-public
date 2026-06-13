export const ADMIN_ADJUSTMENT_SCOPES = [
  'MATCH',
  'GROUP',
  'STAGE',
  'TOURNAMENT',
  'SESSION',
] as const;

export const ADMIN_ADJUSTMENT_TYPES = [
  'POINT_DELTA',
  'ZERO_MATCH_POINTS',
  'DISQUALIFY_MATCH',
  'DISQUALIFY_GROUP',
  'DISQUALIFY_STAGE',
  'DISQUALIFY_TOURNAMENT',
  'DISQUALIFY_SESSION',
] as const;

export type AdminAdjustmentScopeValue =
  (typeof ADMIN_ADJUSTMENT_SCOPES)[number];
export type AdminAdjustmentTypeValue = (typeof ADMIN_ADJUSTMENT_TYPES)[number];

export type ScoreAdjustmentRecord = {
  teamId: string;
  pointsDelta?: number | null;
  scope?: string | null;
  type?: string | null;
  matchId?: string | null;
  groupId?: string | null;
  stageId?: string | null;
  tournamentId?: string | null;
  sessionId?: string | null;
  deletedAt?: Date | string | null;
  revokedAt?: Date | string | null;
};

export type ScoreAdjustmentMatchContext = {
  id: string;
  groupId?: string | null;
  stageId?: string | null;
  tournamentId?: string | null;
  sessionId?: string | null;
};

export type ScoreAdjustmentScopeIds = Partial<
  Record<AdminAdjustmentScopeValue, Iterable<string>>
>;

export function normalizeAdminAdjustmentScope(
  adjustment: Pick<ScoreAdjustmentRecord, 'scope' | 'matchId'>,
): AdminAdjustmentScopeValue {
  const normalized = adjustment.scope?.toString().trim().toUpperCase();
  if (
    normalized === 'MATCH' ||
    normalized === 'GROUP' ||
    normalized === 'STAGE' ||
    normalized === 'TOURNAMENT' ||
    normalized === 'SESSION'
  ) {
    return normalized;
  }
  return adjustment.matchId ? 'MATCH' : 'TOURNAMENT';
}

export function normalizeAdminAdjustmentType(
  adjustment: Pick<ScoreAdjustmentRecord, 'type'>,
): AdminAdjustmentTypeValue {
  const normalized = adjustment.type?.toString().trim().toUpperCase();
  if (
    normalized === 'POINT_DELTA' ||
    normalized === 'ZERO_MATCH_POINTS' ||
    normalized === 'DISQUALIFY_MATCH' ||
    normalized === 'DISQUALIFY_GROUP' ||
    normalized === 'DISQUALIFY_STAGE' ||
    normalized === 'DISQUALIFY_TOURNAMENT' ||
    normalized === 'DISQUALIFY_SESSION'
  ) {
    return normalized;
  }
  return 'POINT_DELTA';
}

export function isActiveAdminAdjustment(
  adjustment: Pick<ScoreAdjustmentRecord, 'deletedAt' | 'revokedAt'>,
): boolean {
  return !adjustment.deletedAt && !adjustment.revokedAt;
}

function scopeId(
  adjustment: ScoreAdjustmentRecord,
  scope: AdminAdjustmentScopeValue,
): string | null {
  switch (scope) {
    case 'MATCH':
      return adjustment.matchId ?? null;
    case 'GROUP':
      return adjustment.groupId ?? null;
    case 'STAGE':
      return adjustment.stageId ?? null;
    case 'TOURNAMENT':
      return adjustment.tournamentId ?? null;
    case 'SESSION':
      return adjustment.sessionId ?? null;
  }
}

function contextId(
  context: ScoreAdjustmentMatchContext,
  scope: AdminAdjustmentScopeValue,
): string | null {
  switch (scope) {
    case 'MATCH':
      return context.id;
    case 'GROUP':
      return context.groupId ?? null;
    case 'STAGE':
      return context.stageId ?? null;
    case 'TOURNAMENT':
      return context.tournamentId ?? null;
    case 'SESSION':
      return context.sessionId ?? null;
  }
}

export function adjustmentDisqualifiesMatch(
  adjustment: ScoreAdjustmentRecord,
  context: ScoreAdjustmentMatchContext,
): boolean {
  if (!isActiveAdminAdjustment(adjustment)) return false;
  const type = normalizeAdminAdjustmentType(adjustment);
  if (type === 'ZERO_MATCH_POINTS' || type === 'DISQUALIFY_MATCH') {
    return adjustment.matchId === context.id;
  }
  if (type === 'DISQUALIFY_GROUP') {
    return Boolean(
      adjustment.groupId && adjustment.groupId === context.groupId,
    );
  }
  if (type === 'DISQUALIFY_STAGE') {
    return Boolean(
      adjustment.stageId && adjustment.stageId === context.stageId,
    );
  }
  if (type === 'DISQUALIFY_TOURNAMENT') {
    return Boolean(
      adjustment.tournamentId &&
      adjustment.tournamentId === context.tournamentId,
    );
  }
  if (type === 'DISQUALIFY_SESSION') {
    return Boolean(
      adjustment.sessionId && adjustment.sessionId === context.sessionId,
    );
  }
  return false;
}

export function adjustmentIsMatchPointDelta(
  adjustment: ScoreAdjustmentRecord,
  context: ScoreAdjustmentMatchContext,
): boolean {
  if (!isActiveAdminAdjustment(adjustment)) return false;
  if (normalizeAdminAdjustmentType(adjustment) !== 'POINT_DELTA') return false;
  const scope = normalizeAdminAdjustmentScope(adjustment);
  return scope === 'MATCH' && adjustment.matchId === context.id;
}

export function applyMatchScoreAdjustments(
  baseTotalPoints: number,
  adjustments: ScoreAdjustmentRecord[],
  context: ScoreAdjustmentMatchContext,
): {
  totalPoints: number;
  pointsDelta: number;
  zeroed: boolean;
  disqualified: boolean;
} {
  let pointsDelta = 0;
  let zeroed = false;
  for (const adjustment of adjustments) {
    if (adjustmentDisqualifiesMatch(adjustment, context)) {
      zeroed = true;
      continue;
    }
    if (adjustmentIsMatchPointDelta(adjustment, context)) {
      pointsDelta += adjustment.pointsDelta ?? 0;
    }
  }
  return {
    totalPoints: zeroed ? 0 : baseTotalPoints + pointsDelta,
    pointsDelta,
    zeroed,
    disqualified: zeroed,
  };
}

export function aggregatePointDeltaForScope(
  adjustments: ScoreAdjustmentRecord[],
  scope: AdminAdjustmentScopeValue,
  id: string,
  scopeIds: ScoreAdjustmentScopeIds = { [scope]: [id] },
): number {
  const idSets = Object.entries(scopeIds).reduce(
    (acc, [entryScope, values]) => {
      acc[entryScope as AdminAdjustmentScopeValue] = new Set(values);
      return acc;
    },
    {} as Partial<Record<AdminAdjustmentScopeValue, Set<string>>>,
  );
  idSets[scope] = new Set([...(idSets[scope] ?? []), id]);
  return adjustments.reduce((sum, adjustment) => {
    if (!isActiveAdminAdjustment(adjustment)) return sum;
    if (normalizeAdminAdjustmentType(adjustment) !== 'POINT_DELTA') return sum;
    const adjustmentScope = normalizeAdminAdjustmentScope(adjustment);
    if (adjustmentScope === 'MATCH') return sum;
    const adjustmentScopeId = scopeId(adjustment, adjustmentScope);
    if (!adjustmentScopeId) return sum;
    return idSets[adjustmentScope]?.has(adjustmentScopeId)
      ? sum + (adjustment.pointsDelta ?? 0)
      : sum;
  }, 0);
}

export function adjustmentTouchesMatch(
  adjustment: ScoreAdjustmentRecord,
  context: ScoreAdjustmentMatchContext,
): boolean {
  if (!isActiveAdminAdjustment(adjustment)) return false;
  if (adjustmentIsMatchPointDelta(adjustment, context)) return true;
  if (adjustmentDisqualifiesMatch(adjustment, context)) return true;
  const scope = normalizeAdminAdjustmentScope(adjustment);
  const id = scopeId(adjustment, scope);
  return Boolean(id && id === contextId(context, scope));
}
