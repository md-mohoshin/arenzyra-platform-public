import { LiveState, MatchStatus } from '@prisma/client';
import type { PrismaService } from '../db/prisma.service';

type LiveMatchConflictPrisma = Pick<
  PrismaService,
  'match' | 'matchControlState' | '$transaction'
>;

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
};

const toResolutionTimestamp = (match: LiveMatchConflictCandidate): number =>
  match.liveAt?.valueOf() ??
  match.startedAt?.valueOf() ??
  match.updatedAt?.valueOf() ??
  match.createdAt?.valueOf() ??
  0;

export async function resolveOrganizationLiveMatchConflicts(
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
        { controlState: { state: { in: ['LIVE', 'PAUSED'] } } },
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
    };
  }

  const sorted = liveMatches
    .slice()
    .sort(
      (left, right) =>
        toResolutionTimestamp(right) - toResolutionTimestamp(left),
    );
  const keptId = sorted[0]?.id ?? null;
  const endedIds = sorted.slice(1).map((match) => match.id);

  if (!keptId || endedIds.length === 0) {
    return {
      keptId,
      endedIds: [],
    };
  }

  const now = new Date();
  await prisma.$transaction([
    prisma.match.updateMany({
      where: { id: { in: endedIds } },
      data: {
        status: MatchStatus.ENDED,
        liveState: LiveState.ENDED,
        endedAt: now,
        endedReason: 'LIVE_CONFLICT_RESOLUTION',
      },
    }),
    prisma.matchControlState.updateMany({
      where: { matchId: { in: endedIds } },
      data: {
        state: 'ENDED',
        reason: 'LIVE_CONFLICT_RESOLUTION',
        updatedAt: now,
        version: { increment: 1 },
      },
    }),
  ]);

  return {
    keptId,
    endedIds,
  };
}
