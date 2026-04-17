import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditAction, Prisma, Stage, StageType } from '@prisma/client';
import { PrismaService } from '../../db/prisma.service';
import { CreateStageDto } from './dto/create-stage.dto';
import { UpdateStageDto } from './dto/update-stage.dto';
import { UpdateStageTeamsDto } from './dto/update-stage-teams.dto';
import { AuditService } from '../audit/audit.service';
import {
  deriveGroupStateFromMatches,
  deriveStageStateFromGroups,
} from '../../common/live-state.util';
import type { AuthUser } from '../../common/auth/auth.types';
import { assertStructureChangeAllowed } from '../../common/policy/structure-policy.util';

type StageLight = {
  id: string;
  name: string;
  order: number;
  maxTeams: number | null;
  createdAt: Date;
  liveState: string | null;
  liveAt: Date | null;
  endedAt: Date | null;
  groupCount: number;
  matchCount: number;
  groups: Array<{
    id: string;
    name: string | null;
    matchCount: number;
    matches: Array<{
      id: string;
      controlState: { state: string | null } | null;
    }>;
  }>;
};

@Injectable()
export class StagesService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  private parseDateInput(input: string | Date | null | undefined): Date | null {
    if (!input) return null;
    return input instanceof Date ? input : new Date(input);
  }

  private async ensureTournament(
    orgId: string | null,
    tournamentId: string,
  ): Promise<{
    id: string;
    organizationId: string | null;
    status: string | null;
  }> {
    const tournament = await this.prisma.tournament.findFirst({
      where: { id: tournamentId, deletedAt: null },
      select: { id: true, organizationId: true, status: true },
    });
    if (!tournament) throw new NotFoundException('Tournament not found');
    // Enforce tenant match for non-super-admin callers; orgId=null is treated as super-admin / unrestricted.
    if (
      orgId &&
      tournament.organizationId &&
      tournament.organizationId !== orgId
    ) {
      throw new NotFoundException('Tournament not found');
    }
    // Backfill org if missing and caller supplied an org
    if (!tournament.organizationId && orgId) {
      await this.prisma.tournament.update({
        where: { id: tournamentId },
        data: { organizationId: orgId },
      });
      return { ...tournament, organizationId: orgId };
    }
    return tournament;
  }

  private toLight(stage: Stage): StageLight {
    // liveState will be overridden by dynamic computation where available.
    return {
      id: stage.id,
      name: stage.name,
      order: stage.order,
      maxTeams: stage.maxTeams,
      createdAt: stage.createdAt,
      liveState: stage.liveState,
      liveAt: stage.liveAt,
      endedAt: stage.endedAt,
      groupCount: 0,
      matchCount: 0,
      groups: [],
    };
  }

  async list(
    orgId: string | null,
    tournamentId: string,
  ): Promise<StageLight[]> {
    await this.ensureTournament(orgId, tournamentId);
    const stages = await this.prisma.stage.findMany({
      where: {
        tournamentId,
        deletedAt: null,
      },
      orderBy: [{ order: 'asc' }, { createdAt: 'desc' }],
      include: {
        groups: {
          where: { deletedAt: null },
          select: {
            id: true,
            name: true,
            matches: {
              where: { deletedAt: null },
              select: { id: true, controlState: { select: { state: true } } },
            },
          },
        },
      },
    });
    return stages.map((s) => {
      const groups =
        (s.groups ?? []).map((g) => ({
          id: g.id,
          name: g.name ?? null,
          matches: g.matches ?? [],
          matchCount: g.matches?.length ?? 0,
        })) ?? [];

      const matchCount = groups.reduce(
        (sum, g) => sum + (g.matchCount ?? 0),
        0,
      );

      return {
        ...this.toLight(s),
        groups,
        groupCount: groups.length,
        matchCount,
        liveState: deriveStageStateFromGroups(
          groups.map((g) => ({
            matches: g.matches ?? [],
            state: deriveGroupStateFromMatches(g.matches ?? []),
          })),
        ),
      };
    });
  }

  async create(
    orgId: string | null,
    tournamentId: string,
    body: CreateStageDto,
    actor: AuthUser,
  ): Promise<StageLight> {
    const tournament = await this.ensureTournament(orgId, tournamentId);
    assertStructureChangeAllowed({
      tournamentStatus: tournament.status,
      actorRole: (actor?.actorRole ?? actor?.role ?? '') as string,
      override:
        actor && 'override' in actor
          ? (actor as { override?: boolean }).override
          : undefined,
    });
    if (!body?.name) throw new BadRequestException('name is required');
    const currentMax = await this.prisma.stage.aggregate({
      where: { tournamentId, deletedAt: null },
      _max: { order: true },
    });
    const nextOrder = (currentMax._max.order ?? 0) + 1;
    const order = body.order ?? nextOrder;
    const type = body.type ?? StageType.GROUP;
    const maxTeams = body?.maxTeams ?? 25;

    const created = await this.prisma.stage.create({
      data: {
        name: body.name,
        order,
        type,
        maxTeams,
        description: body?.description ?? null,
        startDate: this.parseDateInput(body?.startDate),
        endDate: this.parseDateInput(body?.endDate),
        tournamentId,
        organizationId:
          tournament.organizationId ??
          orgId ??
          (() => {
            throw new BadRequestException('organizationId is required');
          })(),
      },
    });
    await this.audit.log({
      organizationId: tournament.organizationId ?? orgId ?? null,
      userId: actor?.actorId ?? actor?.id ?? 'system',
      action: AuditAction.SYSTEM_FLAG_UPDATE,
      entityType: 'Stage',
      entityId: created.id,
      after: {
        id: created.id,
        name: created.name,
        order: created.order,
        maxTeams: created.maxTeams,
      },
      source: 'SYSTEM',
    });
    return this.toLight(created);
  }

  async update(
    orgId: string | null,
    tournamentId: string | null,
    stageId: string,
    body: UpdateStageDto,
    actor: AuthUser,
  ): Promise<StageLight> {
    const stage = await this.prisma.stage.findFirst({
      where: {
        id: stageId,
        deletedAt: null,
      },
      include: {
        tournament: {
          select: { id: true, organizationId: true, status: true },
        },
      },
    });
    if (!stage) throw new NotFoundException('Stage not found');

    assertStructureChangeAllowed({
      tournamentStatus: stage.tournament?.status ?? null,
      actorRole: (actor?.actorRole ?? actor?.role ?? '') as string,
      override:
        actor && 'override' in actor
          ? (actor as { override?: boolean }).override
          : undefined,
    });

    if (
      tournamentId &&
      stage.tournament?.id &&
      stage.tournament.id !== tournamentId
    ) {
      throw new NotFoundException('Stage not found');
    }

    if (
      orgId &&
      stage.tournament?.organizationId &&
      stage.tournament.organizationId !== orgId
    ) {
      if (!tournamentId || stage.tournament.id !== tournamentId) {
        throw new NotFoundException('Stage not found');
      }
    }

    const data: Prisma.StageUpdateInput = {};
    if (body?.name !== undefined) data.name = body.name;
    if (body?.order !== undefined) data.order = body.order;
    if (body?.type !== undefined) data.type = body.type;
    if (body?.description !== undefined) data.description = body.description;
    if (body?.startDate !== undefined)
      data.startDate = this.parseDateInput(body.startDate);
    if (body?.endDate !== undefined)
      data.endDate = this.parseDateInput(body.endDate);
    if (body?.maxTeams !== undefined) data.maxTeams = body.maxTeams;

    if (!Object.keys(data).length) return this.toLight(stage);

    const updated = await this.prisma.stage.update({
      where: { id: stageId },
      data,
    });
    await this.audit.log({
      organizationId: stage.tournament?.organizationId ?? orgId ?? null,
      userId: actor?.actorId ?? actor?.id ?? 'system',
      action: AuditAction.SYSTEM_FLAG_UPDATE,
      entityType: 'Stage',
      entityId: stageId,
      before: {
        id: stage.id,
        name: stage.name,
        order: stage.order,
        maxTeams: stage.maxTeams,
      },
      after: {
        id: updated.id,
        name: updated.name,
        order: updated.order,
        maxTeams: updated.maxTeams,
      },
      source: 'SYSTEM',
    });
    return this.toLight(updated);
  }

  async softDelete(
    orgId: string | null,
    tournamentId: string | null,
    stageId: string,
    actorId: string,
  ): Promise<{ ok: true }> {
    const stage = await this.prisma.stage.findFirst({
      where: {
        id: stageId,
        deletedAt: null,
      },
      include: { tournament: { select: { id: true, organizationId: true } } },
    });
    if (!stage) throw new NotFoundException('Stage not found');

    if (
      tournamentId &&
      stage.tournament?.id &&
      stage.tournament.id !== tournamentId
    ) {
      throw new NotFoundException('Stage not found');
    }

    if (
      orgId &&
      stage.tournament?.organizationId &&
      stage.tournament.organizationId !== orgId
    ) {
      // Allow if the tournament matches but org metadata is stale/mismatched.
      if (!tournamentId || stage.tournament.id !== tournamentId) {
        throw new NotFoundException('Stage not found');
      }
    }

    const groupCount = await this.prisma.group.count({
      where: { stageId, deletedAt: null },
    });
    if (groupCount > 0) {
      throw new BadRequestException('Cannot delete stage that has groups');
    }

    const deletedAt = new Date();
    const stageTournamentId = stage.tournament?.id ?? null;

    await this.prisma.$transaction(async (tx) => {
      await tx.stage.update({
        where: { id: stageId },
        data: { deletedAt },
      });

      if (stageTournamentId) {
        await tx.tournament.updateMany({
          where: {
            id: stageTournamentId,
            defaultRegistrationStageId: stageId,
          },
          data: {
            defaultRegistrationStageId: null,
          },
        });
      }
    });

    await this.audit.log({
      organizationId: stage.tournament?.organizationId ?? orgId ?? null,
      userId: actorId,
      action: AuditAction.SYSTEM_FLAG_UPDATE,
      entityType: 'Stage',
      entityId: stageId,
      before: {
        id: stage.id,
        name: stage.name,
        order: stage.order,
        maxTeams: stage.maxTeams,
      },
      after: { deletedAt },
      source: 'SYSTEM',
    });

    return { ok: true };
  }

  async restore(orgId: string | null, tournamentId: string, stageId: string) {
    await this.ensureTournament(orgId, tournamentId);
    const stage = await this.prisma.stage.findFirst({
      where: {
        id: stageId,
        tournamentId,
      },
    });
    if (!stage) throw new NotFoundException('Stage not found');

    await this.prisma.stage.update({
      where: { id: stageId },
      data: { deletedAt: null },
    });

    await this.prisma.group.updateMany({
      where: { stageId },
      data: { deletedAt: null },
    });

    await this.prisma.match.updateMany({
      where: { stageId },
      data: { deletedAt: null },
    });

    return { ok: true };
  }

  private async ensureStage(
    stageId: string,
    orgId: string | null,
  ): Promise<{
    id: string;
    tournamentId: string;
    organizationId: string;
    maxTeams: number | null;
  }> {
    const stage = await this.prisma.stage.findFirst({
      where: { id: stageId, deletedAt: null },
      select: {
        id: true,
        tournamentId: true,
        organizationId: true,
        maxTeams: true,
      },
    });
    if (!stage) throw new NotFoundException('Stage not found');
    if (orgId && stage.organizationId && orgId !== stage.organizationId) {
      throw new NotFoundException('Stage not found');
    }
    return stage;
  }

  async listTeams(stageId: string, orgId: string | null) {
    const stage = await this.ensureStage(stageId, orgId);

    const stageTeams = await this.prisma.stageTeam.findMany({
      where: { stageId: stage.id },
      include: {
        tournamentTeam: {
          include: { team: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    return {
      stageTeams: stageTeams.map((st) => ({
        id: st.id,
        tournamentTeamId: st.tournamentTeamId,
        team: st.tournamentTeam?.team
          ? {
              id: st.tournamentTeam.team.id,
              name: st.tournamentTeam.team.name,
              tag: st.tournamentTeam.team.tag,
              logoUrl: st.tournamentTeam.team.logoUrl,
            }
          : null,
      })),
    };
  }

  async setTeams(
    stageId: string,
    orgId: string | null,
    tournamentTeamIds: UpdateStageTeamsDto['tournamentTeamIds'],
    actorId: string,
  ) {
    const stage = await this.ensureStage(stageId, orgId);
    const ids = Array.from(new Set((tournamentTeamIds ?? []).filter(Boolean)));

    if (stage.maxTeams && ids.length > stage.maxTeams) {
      throw new BadRequestException(
        `Stage maxTeams is ${stage.maxTeams}; received ${ids.length} teams`,
      );
    }

    const validTeams = await this.prisma.tournamentTeam.findMany({
      where: {
        id: { in: ids },
        tournamentId: stage.tournamentId,
        deletedAt: null,
      },
      select: { id: true },
    });

    if (validTeams.length !== ids.length) {
      throw new BadRequestException(
        'One or more teams are invalid for this tournament',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.stageTeam.deleteMany({ where: { stageId: stage.id } });

      if (ids.length) {
        await tx.stageTeam.createMany({
          data: ids.map((id) => ({
            stageId: stage.id,
            tournamentTeamId: id,
          })),
          skipDuplicates: true,
        });
      }
    });

    await this.audit.log({
      organizationId: stage.organizationId ?? orgId ?? null,
      userId: actorId,
      action: AuditAction.SYSTEM_FLAG_UPDATE,
      entityType: 'StageTeams',
      entityId: stage.id,
      source: 'SYSTEM',
      after: { stageId: stage.id, tournamentTeamIds: ids },
    });

    return this.listTeams(stageId, orgId);
  }
}
