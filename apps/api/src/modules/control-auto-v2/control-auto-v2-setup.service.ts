import { Injectable, NotFoundException } from '@nestjs/common';
import type { AuthUser } from '../../common/auth/auth.types';
import { requireMatchOrganization } from '../../common/org/org.util';
import { PrismaService } from '../../db/prisma.service';
import type { ControlAutoV2SetupResponseDto } from './control-auto-v2.dto';

@Injectable()
export class ControlAutoV2SetupService {
  constructor(private readonly prisma: PrismaService) {}

  async getSetup(
    actor: AuthUser,
    matchId: string,
  ): Promise<ControlAutoV2SetupResponseDto> {
    await requireMatchOrganization(this.prisma, matchId, { actor });

    const match = await this.prisma.match.findFirst({
      where: { id: matchId, deletedAt: null },
      select: {
        id: true,
        name: true,
        status: true,
        matchNumber: true,
        map: true,
      },
    });

    if (!match) {
      throw new NotFoundException('Match not found');
    }

    const slots = await this.prisma.matchSlot.findMany({
      where: { matchId, deletedAt: null },
      orderBy: { slotNumber: 'asc' },
      select: {
        slotNumber: true,
        team: {
          select: {
            id: true,
            name: true,
            tag: true,
            logoUrl: true,
            players: {
              where: { deletedAt: null },
              orderBy: { ign: 'asc' },
              select: {
                id: true,
                ign: true,
                realName: true,
                externalPlayerId: true,
                inGameId: true,
              },
            },
          },
        },
      },
    });

    const assignedTeams = slots
      .filter(
        (
          slot,
        ): slot is typeof slot & {
          team: NonNullable<typeof slot.team>;
        } => Boolean(slot.team),
      )
      .map((slot) => ({
        id: slot.team.id,
        name: slot.team.name,
        tag: slot.team.tag,
        logoUrl: slot.team.logoUrl,
        players: slot.team.players.map((player) => ({
          id: player.id,
          ign: player.ign,
          realName: player.realName,
          externalPlayerId: player.externalPlayerId,
          inGameId: player.inGameId,
        })),
      }));

    const assignedPlayers = Array.from(
      new Map(
        assignedTeams.flatMap((team) =>
          team.players.map((player) => [player.id, player] as const),
        ),
      ).values(),
    );

    return {
      match: {
        id: match.id,
        name: match.name,
        status: match.status,
        matchNumber:
          typeof match.matchNumber === 'number' ? match.matchNumber : null,
        map: (match as { map?: string | null }).map ?? null,
      },
      slots: slots.map((slot) => ({
        slotNumber: slot.slotNumber,
        team: slot.team
          ? {
              id: slot.team.id,
              name: slot.team.name,
              tag: slot.team.tag,
              logoUrl: slot.team.logoUrl,
              players: slot.team.players.map((player) => ({
                id: player.id,
                ign: player.ign,
                realName: player.realName,
                externalPlayerId: player.externalPlayerId,
                inGameId: player.inGameId,
              })),
            }
          : null,
      })),
      assignedTeams,
      assignedPlayers,
    };
  }
}
