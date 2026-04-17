import { ConflictException } from '@nestjs/common';
import { LiveState, TournamentStatus } from '@prisma/client';
import { PrismaService } from '../db/prisma.service';

type TournamentLifecycleRecord = {
  id: string;
  name: string;
  status: TournamentStatus;
  liveState: LiveState;
  endedAt: Date | null;
};

export type TeamTournamentRosterPolicy = {
  restricted: boolean;
  tournaments: TournamentLifecycleRecord[];
};

export function isTournamentRosterRestricted(
  tournament: Pick<
    TournamentLifecycleRecord,
    'status' | 'liveState' | 'endedAt'
  >,
): boolean {
  if (tournament.endedAt) {
    return false;
  }

  if (
    tournament.status === TournamentStatus.COMPLETED ||
    tournament.status === TournamentStatus.ARCHIVED ||
    tournament.liveState === LiveState.ENDED
  ) {
    return false;
  }

  return (
    tournament.status === TournamentStatus.ACTIVE ||
    tournament.liveState === LiveState.LIVE
  );
}

export async function getTeamTournamentRosterPolicy(
  prisma: PrismaService,
  teamId: string,
): Promise<TeamTournamentRosterPolicy> {
  const links = await prisma.tournamentTeam.findMany({
    where: {
      teamId,
      deletedAt: null,
      tournament: { deletedAt: null },
    },
    select: {
      tournament: {
        select: {
          id: true,
          name: true,
          status: true,
          liveState: true,
          endedAt: true,
        },
      },
    },
  });

  const tournaments = links
    .map((link) => link.tournament)
    .filter(
      (tournament): tournament is TournamentLifecycleRecord =>
        Boolean(tournament) && isTournamentRosterRestricted(tournament),
    );

  return {
    restricted: tournaments.length > 0,
    tournaments,
  };
}

export async function assertTournamentRosterWriteAllowed(
  prisma: PrismaService,
  tournamentTeamId: string,
): Promise<void> {
  const tournamentTeam = await prisma.tournamentTeam.findFirst({
    where: { id: tournamentTeamId, deletedAt: null },
    select: {
      tournament: {
        select: {
          id: true,
          name: true,
          status: true,
          liveState: true,
          endedAt: true,
        },
      },
    },
  });

  if (!tournamentTeam?.tournament) {
    return;
  }

  if (isTournamentRosterRestricted(tournamentTeam.tournament)) {
    throw new ConflictException(
      'Tournament roster is locked while the tournament is active',
    );
  }
}

export async function assertTeamRosterWriteAllowed(
  prisma: PrismaService,
  teamId: string,
): Promise<void> {
  const policy = await getTeamTournamentRosterPolicy(prisma, teamId);

  if (policy.restricted) {
    throw new ConflictException(
      'Team roster is locked while an active tournament is using this team',
    );
  }
}
