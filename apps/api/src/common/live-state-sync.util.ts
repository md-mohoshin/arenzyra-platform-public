import { LiveState, Prisma } from '@prisma/client';
import { PrismaService } from '../db/prisma.service';
import {
  deriveGroupStateFromMatches,
  deriveStageStateFromGroups,
  deriveTournamentStateFromMatches,
} from './live-state.util';

type LiveStateClient = Prisma.TransactionClient | PrismaService;

export async function recalcStageLiveState(
  client: LiveStateClient,
  stageId: string | null | undefined,
): Promise<{
  state: LiveState;
  tournamentId: string;
  stageId: string;
} | null> {
  if (!stageId) return null;

  const stage = await client.stage.findFirst({
    where: { id: stageId, deletedAt: null },
    select: {
      id: true,
      tournamentId: true,
      liveState: true,
      liveAt: true,
      endedAt: true,
      groups: {
        where: { deletedAt: null },
        select: {
          matches: {
            where: { deletedAt: null },
            select: { controlState: { select: { state: true } } },
          },
        },
      },
      matches: {
        where: { deletedAt: null },
        select: { controlState: { select: { state: true } } },
      },
    },
  });

  if (!stage) return null;

  const hasGroups = (stage.groups?.length ?? 0) > 0;
  const next = hasGroups
    ? deriveStageStateFromGroups(
        (stage.groups ?? []).map((group) => ({
          state: deriveGroupStateFromMatches(group.matches ?? []),
          matches: group.matches ?? [],
        })),
      )
    : deriveGroupStateFromMatches(stage.matches ?? []);

  const now = new Date();
  const shouldUpdate =
    stage.liveState !== next ||
    (next === 'LIVE' && !stage.liveAt) ||
    (next === 'ENDED' && !stage.endedAt);

  if (shouldUpdate) {
    const data: Prisma.StageUpdateInput & Record<string, unknown> = {
      liveState: next,
    };

    if (next === 'LIVE') {
      data.liveAt = stage.liveAt ?? now;
    } else if (next === 'ENDED') {
      data.endedAt = stage.endedAt ?? now;
    }

    await client.stage.update({
      where: { id: stageId },
      data,
    });
  }

  return {
    state: next,
    tournamentId: stage.tournamentId,
    stageId: stage.id,
  };
}

export async function recalcTournamentLiveState(
  client: LiveStateClient,
  tournamentId: string | null | undefined,
): Promise<LiveState | null> {
  if (!tournamentId) return null;

  const tournament = await client.tournament.findFirst({
    where: { id: tournamentId, deletedAt: null },
    select: {
      id: true,
      liveState: true,
      liveAt: true,
      endedAt: true,
      matches: {
        where: { deletedAt: null },
        select: { controlState: { select: { state: true } } },
      },
    },
  });

  if (!tournament) return null;

  const next = deriveTournamentStateFromMatches(tournament.matches ?? []);
  const now = new Date();
  const shouldUpdate =
    tournament.liveState !== next ||
    (next === 'LIVE' && !tournament.liveAt) ||
    (next === 'ENDED' && !tournament.endedAt);

  if (shouldUpdate) {
    const data: Prisma.TournamentUpdateInput & Record<string, unknown> = {
      liveState: next,
    };

    if (next === 'LIVE') {
      data.liveAt = tournament.liveAt ?? now;
    } else if (next === 'ENDED') {
      data.endedAt = tournament.endedAt ?? now;
    }

    await client.tournament.update({
      where: { id: tournamentId },
      data,
    });
  }

  return next;
}
