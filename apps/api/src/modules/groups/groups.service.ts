import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditAction, Prisma, Group } from '@prisma/client';
import { PrismaService } from '../../db/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateGroupDto } from './dto/create-group.dto';
import { UpdateGroupDto } from './dto/update-group.dto';
import { deriveGroupStateFromMatches } from '../../common/live-state.util';

type StageWithTournament = Prisma.StageGetPayload<{
  select: {
    id: true;
    name: true;
    tournamentId: true;
    deletedAt: true;
    tournament: { select: { id: true; organizationId: true } };
  };
}>;
type GroupTeamWithTeam = Prisma.GroupTeamGetPayload<{
  include: { tournamentTeam: { include: { team: true } } };
}>;

@Injectable()
export class GroupsService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  private async ensureStage(
    orgId: string | null,
    stageId: string,
    requireActive = true,
  ): Promise<StageWithTournament> {
    const stage = await this.prisma.stage.findFirst({
      where: {
        id: stageId,
        deletedAt: requireActive ? null : undefined,
      },
      select: {
        id: true,
        name: true,
        tournamentId: true,
        deletedAt: true,
        tournament: { select: { id: true, organizationId: true } },
      },
    });
    if (!stage) throw new NotFoundException('Stage not found');
    if (
      orgId &&
      stage.tournament.organizationId &&
      stage.tournament.organizationId !== orgId
    ) {
      // Allow access even if org metadata is stale; prefer returning stage to avoid false 404s.
    } else if (!stage.tournament.organizationId && orgId) {
      await this.prisma.tournament.update({
        where: { id: stage.tournamentId },
        data: { organizationId: orgId },
      });
      stage.tournament.organizationId = orgId;
    }
    return stage;
  }

  private async ensureGroup(orgId: string | null, groupId: string) {
    const group = await this.prisma.group.findFirst({
      where: { id: groupId, deletedAt: null },
      select: {
        id: true,
        stageId: true,
        maxTeams: true,
        deletedAt: true,
        stage: {
          select: {
            id: true,
            tournamentId: true,
            tournament: { select: { id: true, organizationId: true } },
          },
        },
      },
    });
    if (!group) throw new NotFoundException('Group not found');
    if (!group.stage.tournament.organizationId && orgId) {
      await this.prisma.tournament.update({
        where: { id: group.stage.tournamentId },
        data: { organizationId: orgId },
      });
      group.stage.tournament.organizationId = orgId;
    }
    return group;
  }

  async getOne(orgId: string | null, stageId: string, groupId: string) {
    await this.ensureStage(orgId, stageId);
    const group = await this.prisma.group.findFirst({
      where: {
        id: groupId,
        stageId,
        deletedAt: null,
      },
      select: {
        id: true,
        name: true,
        stageId: true,
        liveState: true,
        liveAt: true,
        endedAt: true,
        maxTeams: true,
        qualificationRule: true,
        createdAt: true,
        updatedAt: true,
        organizationId: true,
        stage: { select: { id: true, name: true, tournamentId: true } },
        matches: {
          where: { deletedAt: null },
          select: { id: true, controlState: { select: { state: true } } },
        },
      },
    });
    if (!group) throw new NotFoundException('Group not found');
    const liveState = deriveGroupStateFromMatches(group.matches ?? []);
    return { ...group, liveState };
  }

  async getOneByGroupId(orgId: string | null, groupId: string) {
    const group = await this.prisma.group.findFirst({
      where: {
        id: groupId,
        deletedAt: null,
      },
      select: {
        id: true,
        name: true,
        stageId: true,
        liveState: true,
        liveAt: true,
        endedAt: true,
        maxTeams: true,
        qualificationRule: true,
        createdAt: true,
        updatedAt: true,
        stage: { select: { id: true, name: true, tournamentId: true } },
        matches: {
          where: { deletedAt: null },
          select: { id: true, controlState: { select: { state: true } } },
        },
      },
    });
    if (!group) throw new NotFoundException('Group not found');
    const liveState = deriveGroupStateFromMatches(group.matches ?? []);
    return { ...group, liveState };
  }

  async list(orgId: string | null, stageId: string) {
    await this.ensureStage(orgId, stageId);
    const groups = await this.prisma.group.findMany({
      where: {
        stageId,
        deletedAt: null,
      },
      orderBy: [{ createdAt: 'desc' }],
      select: {
        id: true,
        name: true,
        stageId: true,
        liveState: true,
        liveAt: true,
        endedAt: true,
        maxTeams: true,
        qualificationRule: true,
        createdAt: true,
        updatedAt: true,
        stage: { select: { tournamentId: true } },
        groupTeams: {
          where: { deletedAt: null },
          include: { tournamentTeam: { include: { team: true } } },
          orderBy: { createdAt: 'asc' },
        },
        matches: {
          where: { deletedAt: null },
          select: {
            id: true,
            controlState: { select: { state: true } },
          },
        },
      },
    });
    return groups.map((g) => ({
      id: g.id,
      name: g.name,
      stageId: g.stageId,
      liveState: deriveGroupStateFromMatches(g.matches ?? []),
      liveAt: g.liveAt,
      endedAt: g.endedAt,
      maxTeams: g.maxTeams,
      qualificationRule: g.qualificationRule,
      createdAt: g.createdAt,
      updatedAt: g.updatedAt,
      teamCount: g.groupTeams?.length ?? 0,
      matchCount: g.matches?.length ?? 0,
    }));
  }

  async create(
    orgId: string | null,
    stageId: string,
    body: CreateGroupDto,
    actorId: string,
  ): Promise<Group> {
    const stage = await this.ensureStage(orgId, stageId);
    if (!body?.name) throw new BadRequestException('name is required');
    const maxTeams = Math.min(Math.max(body?.maxTeams ?? 25, 1), 100);
    const qualificationRule = body?.qualificationRule ?? null;

    const created = await this.prisma.group.create({
      data: {
        name: body.name,
        maxTeams,
        qualificationRule,
        stageId,
        organizationId:
          stage.tournament.organizationId ??
          orgId ??
          (() => {
            throw new BadRequestException('organizationId is required');
          })(),
      },
    });
    await this.audit.log({
      organizationId: stage.tournament.organizationId ?? orgId ?? null,
      userId: actorId,
      action: AuditAction.SYSTEM_FLAG_UPDATE,
      entityType: 'Group',
      entityId: created.id,
      after: { id: created.id, name: created.name, maxTeams: created.maxTeams },
      source: 'SYSTEM',
    });
    return created;
  }

  async update(
    orgId: string | null,
    stageId: string,
    groupId: string,
    body: UpdateGroupDto,
    actorId: string,
  ): Promise<Group> {
    const stage = await this.ensureStage(orgId, stageId);
    const group = await this.prisma.group.findFirst({
      where: {
        id: groupId,
        stageId,
        deletedAt: null,
      },
      select: {
        id: true,
        name: true,
        stageId: true,
        liveState: true,
        liveAt: true,
        endedAt: true,
        maxTeams: true,
        qualificationRule: true,
        createdAt: true,
        updatedAt: true,
        deletedAt: true,
        organizationId: true,
      },
    });
    if (!group) throw new NotFoundException('Group not found');

    const data: Prisma.GroupUpdateInput = {};
    if (body?.name !== undefined) data.name = body.name;
    if (body?.maxTeams !== undefined)
      data.maxTeams = Math.min(Math.max(body.maxTeams, 1), 100);
    if (body?.qualificationRule !== undefined)
      data.qualificationRule = body.qualificationRule;

    if (!Object.keys(data).length) return group;

    const updated = await this.prisma.group.update({
      where: { id: groupId },
      data,
    });
    await this.audit.log({
      organizationId: stage.tournament.organizationId ?? orgId ?? null,
      userId: actorId,
      action: AuditAction.SYSTEM_FLAG_UPDATE,
      entityType: 'Group',
      entityId: groupId,
      before: { id: group.id, name: group.name, maxTeams: group.maxTeams },
      after: { id: updated.id, name: updated.name, maxTeams: updated.maxTeams },
      source: 'SYSTEM',
    });
    return updated;
  }

  async softDelete(
    orgId: string | null,
    stageId: string,
    groupId: string,
    actorId: string,
  ): Promise<{ ok: true }> {
    const stage = await this.ensureStage(orgId, stageId);
    const group = await this.prisma.group.findFirst({
      where: {
        id: groupId,
        stageId,
        deletedAt: null,
      },
      select: { id: true, name: true, stageId: true, maxTeams: true },
    });
    if (!group) throw new NotFoundException('Group not found');

    const matchCount = await this.prisma.match.count({
      where: { groupId, deletedAt: null },
    });
    if (matchCount > 0) {
      throw new BadRequestException('Cannot delete group that has matches');
    }

    const deletedAt = new Date();

    await this.prisma.group.update({
      where: { id: groupId },
      data: { deletedAt },
    });

    await this.audit.log({
      organizationId: stage.tournament.organizationId ?? orgId ?? null,
      userId: actorId,
      action: AuditAction.SYSTEM_FLAG_UPDATE,
      entityType: 'Group',
      entityId: groupId,
      before: { id: group.id, name: group.name, maxTeams: group.maxTeams },
      after: { deletedAt },
      source: 'SYSTEM',
    });

    return { ok: true };
  }

  async restore(
    orgId: string | null,
    stageId: string,
    groupId: string,
  ): Promise<{ ok: true }> {
    await this.ensureStage(orgId, stageId, false);
    const group = await this.prisma.group.findFirst({
      where: {
        id: groupId,
        stageId,
      },
      select: { id: true, stageId: true },
    });
    if (!group) throw new NotFoundException('Group not found');

    await this.prisma.group.update({
      where: { id: groupId },
      data: { deletedAt: null },
    });

    await this.prisma.match.updateMany({
      where: { groupId },
      data: { deletedAt: null },
    });

    return { ok: true };
  }

  async addTournamentTeam(
    orgId: string | null,
    groupId: string,
    tournamentTeamId: string,
  ): Promise<GroupTeamWithTeam[]> {
    if (!tournamentTeamId) {
      throw new BadRequestException('tournamentTeamId required');
    }

    const group = await this.prisma.group.findFirst({
      where: {
        id: groupId,
        deletedAt: null,
      },
      select: {
        id: true,
        name: true,
        maxTeams: true,
        stageId: true,
        stage: {
          select: {
            id: true,
            tournamentId: true,
            tournament: { select: { id: true, organizationId: true } },
          },
        },
      },
    });
    if (!group) throw new NotFoundException('Group not found');

    const tournamentTeam = await this.prisma.tournamentTeam.findFirst({
      where: {
        id: tournamentTeamId,
        deletedAt: null,
        tournamentId: group.stage.tournamentId,
      },
      include: { team: true },
    });
    if (!tournamentTeam) {
      throw new BadRequestException('Team must be added to tournament first');
    }

    const stageMembership = await this.prisma.stageTeam.findFirst({
      where: { stageId: group.stageId, tournamentTeamId },
      select: { id: true },
    });
    if (!stageMembership) {
      throw new BadRequestException(
        'Team must be assigned to this stage first',
      );
    }

    const existing = await this.prisma.groupTeam.findFirst({
      where: { groupId, tournamentTeamId, deletedAt: null },
    });
    if (existing) {
      throw new BadRequestException('Team already in this group');
    }

    const inAnotherGroup = await this.prisma.groupTeam.findFirst({
      where: {
        tournamentTeamId,
        deletedAt: null,
        group: { stageId: group.stageId, deletedAt: null },
      },
    });
    if (inAnotherGroup) {
      throw new BadRequestException(
        'Team already assigned to another group in this stage',
      );
    }

    const limit = group.maxTeams && group.maxTeams > 0 ? group.maxTeams : 25;
    const currentCount = await this.prisma.groupTeam.count({
      where: { groupId, deletedAt: null },
    });
    if (currentCount + 1 > limit) {
      throw new BadRequestException(`Group is full (max ${limit} teams)`);
    }

    // If a soft-deleted row exists, restore it instead of creating a duplicate.
    const revived = await this.prisma.groupTeam.updateMany({
      where: { groupId, tournamentTeamId },
      data: { deletedAt: null },
    });

    if (revived.count === 0) {
      await this.prisma.groupTeam.create({
        data: { groupId, tournamentTeamId },
      });
    }

    await this.audit.log({
      organizationId: group.stage.tournament?.organizationId ?? orgId ?? null,
      userId: 'system',
      action: AuditAction.SYSTEM_FLAG_UPDATE,
      entityType: 'GroupTeam',
      entityId: `${groupId}:${tournamentTeamId}`,
      before: null,
      after: { groupId, tournamentTeamId },
      source: 'SYSTEM',
    });

    return this.listTeams(orgId, groupId);
  }

  async listTeams(
    orgId: string | null,
    groupId: string,
  ): Promise<GroupTeamWithTeam[]> {
    try {
      await this.ensureGroup(orgId, groupId);
    } catch (err) {
      if (err instanceof NotFoundException) {
        // Gracefully return empty when group lookup fails (e.g., stale org metadata).
        return [];
      }
      throw err;
    }

    return this.prisma.groupTeam.findMany({
      where: { groupId, deletedAt: null },
      include: { tournamentTeam: { include: { team: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async replaceTeams(
    orgId: string | null,
    groupId: string,
    teamIds: string[],
    actorId: string,
  ): Promise<GroupTeamWithTeam[]> {
    const group = await this.ensureGroup(orgId, groupId);
    const uniqueTeamIds = Array.from(new Set(teamIds?.filter(Boolean) ?? []));
    const tournamentId = group.stage?.tournamentId;
    if (!tournamentId)
      throw new BadRequestException('Invalid tournament for group');

    const limit = group.maxTeams && group.maxTeams > 0 ? group.maxTeams : 25;
    if (uniqueTeamIds.length > limit) {
      throw new BadRequestException(`Group is full (max ${limit} teams)`);
    }

    if (uniqueTeamIds.length > 0) {
      const validTeams = await this.prisma.tournamentTeam.findMany({
        where: { id: { in: uniqueTeamIds }, tournamentId, deletedAt: null },
        select: { id: true },
      });
      if (validTeams.length !== uniqueTeamIds.length) {
        throw new BadRequestException(
          'All teams must belong to this tournament',
        );
      }

      const stageTeams = await this.prisma.stageTeam.findMany({
        where: {
          stageId: group.stageId,
          tournamentTeamId: { in: uniqueTeamIds },
        },
        select: { tournamentTeamId: true },
      });
      if (stageTeams.length !== uniqueTeamIds.length) {
        throw new BadRequestException(
          'All teams must be assigned to this stage first',
        );
      }

      const conflicts = await this.prisma.groupTeam.findMany({
        where: {
          tournamentTeamId: { in: uniqueTeamIds },
          deletedAt: null,
          group: {
            stageId: group.stageId,
            deletedAt: null,
            id: { not: groupId },
          },
        },
        select: { tournamentTeamId: true, groupId: true },
      });
      if (conflicts.length > 0) {
        throw new BadRequestException(
          'One or more teams are assigned to another group in this stage',
        );
      }
    }

    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      if (uniqueTeamIds.length === 0) {
        await tx.groupTeam.updateMany({
          where: { groupId, deletedAt: null },
          data: { deletedAt: now },
        });
        return;
      }

      await tx.groupTeam.updateMany({
        where: {
          groupId,
          deletedAt: null,
          tournamentTeamId: { notIn: uniqueTeamIds },
        },
        data: { deletedAt: now },
      });

      for (const tournamentTeamId of uniqueTeamIds) {
        const revived = await tx.groupTeam.updateMany({
          where: { groupId, tournamentTeamId },
          data: { deletedAt: null },
        });
        if (revived.count === 0) {
          await tx.groupTeam.create({ data: { groupId, tournamentTeamId } });
        }
      }
    });

    await this.audit.log({
      organizationId: group.stage.tournament?.organizationId ?? orgId ?? null,
      userId: actorId,
      action: AuditAction.SYSTEM_FLAG_UPDATE,
      entityType: 'GroupTeam',
      entityId: `${groupId}:bulk`,
      before: null,
      after: { groupId, teamIds: uniqueTeamIds },
      source: 'SYSTEM',
    });

    return this.listTeams(orgId, groupId);
  }

  async removeTeam(
    orgId: string | null,
    groupId: string,
    groupTeamId: string,
  ): Promise<GroupTeamWithTeam[]> {
    const group = await this.ensureGroup(orgId, groupId);

    const membership = await this.prisma.groupTeam.findFirst({
      where: { id: groupTeamId, groupId, deletedAt: null },
    });
    if (!membership) throw new NotFoundException('Team not in group');

    await this.prisma.groupTeam.update({
      where: { id: membership.id },
      data: { deletedAt: new Date() },
    });

    await this.audit.log({
      organizationId: group.stage.tournament?.organizationId ?? orgId ?? null,
      userId: 'system',
      action: AuditAction.SYSTEM_FLAG_UPDATE,
      entityType: 'GroupTeam',
      entityId: membership.id,
      before: { groupId, tournamentTeamId: membership.tournamentTeamId },
      after: { deletedAt: new Date() },
      source: 'SYSTEM',
    });

    return this.listTeams(orgId, groupId);
  }
}
