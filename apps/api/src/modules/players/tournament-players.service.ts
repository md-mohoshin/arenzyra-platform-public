import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { TournamentRosterLineupType } from '@prisma/client';
import { assertTournamentRosterWriteAllowed } from '../../common/tournament-roster-policy';
import { PrismaService } from '../../db/prisma.service';

export type TournamentPlayerBody = {
  playerId: string;
  ignOverride?: string | null;
  jerseyNumber?: number | null;
  role?: string | null;
  lineupType?: TournamentRosterLineupType | null;
};

@Injectable()
export class TournamentPlayersService {
  constructor(private prisma: PrismaService) {}

  async list(tournamentTeamId: string) {
    return this.prisma.tournamentPlayer.findMany({
      where: { tournamentTeamId, deletedAt: null },
      include: {
        player: {
          select: { id: true, ign: true, country: true, teamId: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async create(tournamentTeamId: string, body: TournamentPlayerBody) {
    if (!body?.playerId) throw new BadRequestException('playerId is required');

    await assertTournamentRosterWriteAllowed(this.prisma, tournamentTeamId);

    const [tt, player] = await Promise.all([
      this.prisma.tournamentTeam.findFirst({
        where: { id: tournamentTeamId, deletedAt: null },
        select: { id: true },
      }),
      this.prisma.globalPlayer.findFirst({
        where: { id: body.playerId, deletedAt: null },
        select: { id: true },
      }),
    ]);

    if (!tt) throw new NotFoundException('Tournament team not found');
    if (!player) throw new NotFoundException('Player not found');

    return this.prisma.tournamentPlayer.create({
      data: {
        tournamentTeamId: tt.id,
        playerId: player.id,
        ignOverride: body.ignOverride ?? null,
        jerseyNumber: body.jerseyNumber ?? null,
        role: body.role ?? null,
        lineupType: body.lineupType ?? TournamentRosterLineupType.MAIN,
      },
    });
  }

  async softDelete(tournamentTeamId: string, tournamentPlayerId: string) {
    await assertTournamentRosterWriteAllowed(this.prisma, tournamentTeamId);

    const existing = await this.prisma.tournamentPlayer.findFirst({
      where: { id: tournamentPlayerId, tournamentTeamId },
      select: { id: true, deletedAt: true },
    });
    if (!existing) throw new NotFoundException('Tournament player not found');

    if (existing.deletedAt) return existing;

    return this.prisma.tournamentPlayer.update({
      where: { id: tournamentPlayerId },
      data: { deletedAt: new Date() },
    });
  }
}
