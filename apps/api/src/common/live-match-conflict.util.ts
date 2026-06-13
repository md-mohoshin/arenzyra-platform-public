import { LiveState, MatchStatus } from '@prisma/client';
import type { PrismaService } from '../db/prisma.service';

type LiveMatchConflictPrisma = Pick<PrismaService, 'match'>;

type LiveMatchConflictCandidate = {
  id: string;
  liveAt: Date | null;
  startedAt: Date | null;
  updatedAt: Date;
  createdAt: Date;
};

export type LiveMatchConflictResolution = {
  keptId: string | null;
  endedIds: string[];
  liveIds: string[];
  wouldEndIds: string[];
};

const toResolutionTimestamp = (match: LiveMatchConflictCandidate): number =>
  match.liveAt?.valueOf() ??
  match.startedAt?.valueOf() ??
  match.updatedAt?.valueOf() ??
  match.createdAt?.valueOf() ??
  0;

export async function detectOrganizationLiveMatchConflicts(
  prisma: LiveMatchConflictPrisma,
  organizationId: string,
): Promise<LiveMatchConflictResolution> {
  const liveMatches = await prisma.match.findMany({
    where: {
      organizationId,
      deletedAt: null,
      OR: [
        { status: MatchStatus.LIVE },
        { liveState: LiveState.LIVE },
        { controlState: { state: 'LIVE' } },
      ],
    },
    select: {
      id: true,
      liveAt: true,
      startedAt: true,
      updatedAt: true,
      createdAt: true,
    },
  });

  if (liveMatches.length <= 1) {
    return {
      keptId: liveMatches[0]?.id ?? null,
      endedIds: [],
      liveIds: liveMatches.map((match) => match.id),
      wouldEndIds: [],
    };
  }

  const sorted = liveMatches
    .slice()
    .sort(
      (left, right) =>
        toResolutionTimestamp(right) - toResolutionTimestamp(left),
    );
  const keptId = sorted[0]?.id ?? null;
  const wouldEndIds = sorted.slice(1).map((match) => match.id);

  if (!keptId || wouldEndIds.length === 0) {
    return {
      keptId,
      endedIds: [],
      liveIds: sorted.map((match) => match.id),
      wouldEndIds: [],
    };
  }

  return {
    keptId,
    endedIds: [],
    liveIds: sorted.map((match) => match.id),
    wouldEndIds,
  };
}

export const resolveOrganizationLiveMatchConflicts =
  detectOrganizationLiveMatchConflicts;
