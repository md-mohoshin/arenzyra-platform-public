import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { Prisma, Role, TournamentTeamStatus } from '@prisma/client';
import { PrismaService } from '../../db/prisma.service';
import type { AuthUser } from '../../common/auth/auth.types';
import type {
  AddTournamentTeamDto,
  TournamentTeamResponse,
  UpdateTournamentTeamDto,
} from './dto/tournament-team.dto';
import { MATCH_ACTIVE_OR_FINISHED_STATUSES } from '../../common/match-status.util';

type Actor = AuthUser;

@Injectable()
export class TournamentTeamsService {
  constructor(private prisma: PrismaService) {}

  private isUuid(id: string | null | undefined) {
    return typeof id === 'string' && /^[0-9a-fA-F-]{36}$/.test(id);
  }

  private assertUuid(id: string, label = 'id') {
    if (!this.isUuid(id)) throw new BadRequestException(`Invalid ${label}`);
  }

  private canEdit(
    actor: Actor | null | undefined,
    ownerUserId: string,
    organizationId?: string | null,
  ) {
    if (!actor) return false;
    if (actor.role === Role.SUPER_ADMIN || actor.actorRole === Role.SUPER_ADMIN)
      return true;
    const actorOrg =
      actor.actingOrgId ?? actor.organizationId ?? actor.orgId ?? null;
    if (organizationId && actorOrg && actorOrg === organizationId) return true;
    const actorId = actor.actorId ?? actor.id;
    return actorId === ownerUserId;
  }

  private getActorOrg(actor: Actor | null | undefined) {
    return (
      actor?.actingOrgId ??
      actor?.organizationId ??
      (actor as { orgId?: string | null })?.orgId ??
      null
    );
  }

  async list(
    tournamentId: string,
    actor: Actor,
  ): Promise<TournamentTeamResponse[]> {
    this.assertUuid(tournamentId, 'tournamentId');
    const tournament = await this.prisma.tournament.findFirst({
      where: { id: tournamentId, deletedAt: null },
      select: { id: true, ownerUserId: true, organizationId: true },
    });
    if (!tournament) throw new NotFoundException('Tournament not found');
    if (
      !this.canEdit(actor, tournament.ownerUserId, tournament.organizationId)
    ) {
      throw new ForbiddenException('Not allowed to access tournament teams');
    }

    return this.prisma.tournamentTeam.findMany({
      where: { tournamentId, deletedAt: null },
      include: { team: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  async assignTeams(
    tournamentId: string,
    teamIds: string[],
    actor: Actor,
  ): Promise<{ ok: true; count: number }> {
    this.assertUuid(tournamentId, 'tournamentId');
    const tournament = await this.prisma.tournament.findFirst({
      where: { id: tournamentId, deletedAt: null },
      select: { id: true, ownerUserId: true, organizationId: true },
    });
    if (!tournament) throw new NotFoundException('Tournament not found');
    if (
      !this.canEdit(
        actor,
        tournament.ownerUserId,
        tournament.organizationId ?? null,
      )
    ) {
      throw new ForbiddenException('Not allowed to assign teams');
    }

    const actorOrg = this.getActorOrg(actor);
    const targetOrg = tournament.organizationId ?? actorOrg ?? null;
    if (!targetOrg) {
      throw new ForbiddenException(
        'organizationId is required to assign teams',
      );
    }
    if (tournament.organizationId && tournament.organizationId !== targetOrg) {
      throw new ForbiddenException('Tournament not in your organization');
    }

    const uniqueIds = Array.from(
      new Set(teamIds.filter((id) => this.isUuid(id))),
    );
    if (!uniqueIds.length) {
      throw new BadRequestException('teamIds must contain at least one team');
    }

    const teams = await this.prisma.team.findMany({
      where: { id: { in: uniqueIds }, deletedAt: null },
      select: { id: true, ownerUserId: true, organizationId: true },
    });

    if (teams.length !== uniqueIds.length) {
      throw new NotFoundException('One or more teams not found');
    }

    const invalidOrg = teams.find(
      (t) => (t.organizationId ?? null) !== targetOrg,
    );
    if (invalidOrg) {
      throw new ForbiddenException('Teams must belong to your organization');
    }

    await this.prisma.$transaction(async (tx) => {
      if (!tournament.organizationId) {
        await tx.tournament.update({
          where: { id: tournamentId },
          data: { organizationId: targetOrg },
        });
      }
      await tx.tournamentTeam.deleteMany({ where: { tournamentId } });
      await tx.tournamentTeam.createMany({
        data: uniqueIds.map((teamId) => ({
          tournamentId,
          teamId,
          status: TournamentTeamStatus.ACTIVE,
          deletedAt: null,
        })),
        skipDuplicates: true,
      });
    });

    return { ok: true, count: uniqueIds.length };
  }

  async addTeam(
    tournamentId: string,
    dto: AddTournamentTeamDto,
    actor: Actor,
  ): Promise<TournamentTeamResponse> {
    this.assertUuid(tournamentId, 'tournamentId');
    this.assertUuid(dto.teamId, 'teamId');
    const tournament = await this.prisma.tournament.findFirst({
      where: { id: tournamentId, deletedAt: null },
      select: { id: true, ownerUserId: true, organizationId: true },
    });
    if (!tournament) throw new NotFoundException('Tournament not found');
    if (
      !this.canEdit(
        actor,
        tournament.ownerUserId,
        tournament.organizationId ?? null,
      )
    ) {
      throw new ForbiddenException('Not allowed to add teams');
    }

    const team = await this.prisma.team.findFirst({
      where: { id: dto.teamId, deletedAt: null },
    });
    if (!team) throw new NotFoundException('Team not found');
    const actorOrg = this.getActorOrg(actor);
    let targetOrg = tournament.organizationId ?? actorOrg ?? null;
    if (!targetOrg) {
      // Fallback: if the tournament isn't scoped yet, super-admins can infer from the team.
      targetOrg = team.organizationId ?? null;
    }
    if (!targetOrg) {
      throw new ForbiddenException('organizationId is required to add teams');
    }
    if (tournament.organizationId && tournament.organizationId !== targetOrg) {
      throw new ForbiddenException('Tournament not in your organization');
    }
    if ((team.organizationId ?? null) !== targetOrg) {
      throw new ForbiddenException('Team must belong to your organization');
    }
    if (!tournament.organizationId && targetOrg) {
      await this.prisma.tournament.update({
        where: { id: tournamentId },
        data: { organizationId: targetOrg },
      });
    }
    if (
      !this.canEdit(actor, team.ownerUserId) &&
      team.ownerUserId !== tournament.ownerUserId
    ) {
      throw new ForbiddenException('Not allowed to add this team');
    }

    const existing = await this.prisma.tournamentTeam.findUnique({
      where: { tournamentId_teamId: { tournamentId, teamId: dto.teamId } },
    });
    if (existing && !existing.deletedAt)
      throw new ConflictException('Team already mapped');

    const data: Prisma.TournamentTeamCreateInput = {
      tournament: { connect: { id: tournamentId } },
      team: { connect: { id: dto.teamId } },
      seed: dto.seed ?? null,
      slot: dto.slot ?? null,
      status: dto.status ?? TournamentTeamStatus.ACTIVE,
      notes: dto.notes ?? null,
      deletedAt: null,
    };

    if (existing?.deletedAt) {
      return this.prisma.tournamentTeam.update({
        where: { tournamentId_teamId: { tournamentId, teamId: dto.teamId } },
        data: {
          ...data,
          tournament: undefined,
          team: undefined,
          deletedAt: null,
          updatedAt: new Date(),
        },
        include: {
          team: {
            select: {
              id: true,
              name: true,
              tag: true,
              region: true,
              logoUrl: true,
            },
          },
        },
      });
    }

    return this.prisma.tournamentTeam.create({
      data,
      include: {
        team: {
          select: {
            id: true,
            name: true,
            tag: true,
            region: true,
            logoUrl: true,
          },
        },
      },
    });
  }

  async removeTeam(
    tournamentId: string,
    teamOrMappingId: string,
    actor: Actor,
  ): Promise<{ ok: true }> {
    this.assertUuid(tournamentId, 'tournamentId');
    this.assertUuid(teamOrMappingId, 'teamId');
    const tournament = await this.prisma.tournament.findFirst({
      where: { id: tournamentId, deletedAt: null },
      select: { id: true, ownerUserId: true, organizationId: true },
    });
    if (!tournament) throw new NotFoundException('Tournament not found');
    if (
      !this.canEdit(
        actor,
        tournament.ownerUserId,
        tournament.organizationId ?? null,
      )
    ) {
      throw new ForbiddenException('Not allowed to remove teams');
    }

    const membership =
      (await this.prisma.tournamentTeam.findFirst({
        where: { id: teamOrMappingId, tournamentId },
      })) ??
      (await this.prisma.tournamentTeam.findUnique({
        where: {
          tournamentId_teamId: { tournamentId, teamId: teamOrMappingId },
        },
      }));
    if (!membership || membership.deletedAt)
      throw new NotFoundException('Team not in tournament');

    await this.prisma.tournamentTeam.update({
      where: { id: membership.id },
      data: { deletedAt: new Date() },
    });

    return { ok: true };
  }

  async updateMapping(
    tournamentId: string,
    tournamentTeamId: string,
    actor: Actor,
    dto: UpdateTournamentTeamDto,
  ): Promise<TournamentTeamResponse> {
    this.assertUuid(tournamentId, 'tournamentId');
    this.assertUuid(tournamentTeamId, 'tournamentTeamId');
    const tournament = await this.prisma.tournament.findFirst({
      where: { id: tournamentId, deletedAt: null },
      select: { id: true, ownerUserId: true, organizationId: true },
    });
    if (!tournament) throw new NotFoundException('Tournament not found');
    if (
      !this.canEdit(
        actor,
        tournament.ownerUserId,
        tournament.organizationId ?? null,
      )
    ) {
      throw new ForbiddenException('Not allowed to edit teams');
    }

    const mapping = await this.prisma.tournamentTeam.findFirst({
      where: { id: tournamentTeamId, tournamentId, deletedAt: null },
    });
    if (!mapping) throw new NotFoundException('Tournament team not found');

    const data: Prisma.TournamentTeamUpdateInput = {};
    if (dto.seed !== undefined) data.seed = dto.seed;
    if (dto.slot !== undefined) data.slot = dto.slot;
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.notes !== undefined) data.notes = dto.notes;

    return this.prisma.tournamentTeam.update({
      where: { id: tournamentTeamId },
      data: { ...data, updatedAt: new Date() },
      include: {
        team: {
          select: {
            id: true,
            name: true,
            tag: true,
            region: true,
            logoUrl: true,
          },
        },
      },
    });
  }

  private async tournamentMatchesStarted(tournamentId: string) {
    const count = await this.prisma.match.count({
      where: {
        tournamentId,
        status: {
          in: MATCH_ACTIVE_OR_FINISHED_STATUSES,
        },
      } satisfies Prisma.MatchWhereInput,
    });
    return count > 0;
  }
}
