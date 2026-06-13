import { randomUUID } from 'crypto';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditAction,
  GameKey,
  LiveState,
  MatchStatus,
  Prisma,
  StageType,
  TournamentStatus,
  Role,
} from '@prisma/client';
import type { AuthenticatedRequest } from '../../common/auth/auth.types';
import { PrismaService } from '../../db/prisma.service';
import { CreateOrganizerTournamentDto } from './dto/create-tournament.dto';
import { CreateOrganizerStageDto } from './dto/create-stage.dto';
import { CreateOrganizerGroupDto } from './dto/create-group.dto';
import { GenerateMatchesDto } from './dto/generate-matches.dto';
import { effectiveOrganizationId } from '../../common/org/org.util';
import { defaultTournamentRulesetForGame } from '../../common/game-rules.util';
import { assertOrganizationGameAccess } from '../../common/org/organization-plan.util';
import { buildQualificationSettingsData } from '../../common/qualification-settings.util';

@Injectable()
export class OrganizerTournamentsService {
  constructor(private prisma: PrismaService) {}

  requireOrganizerRole(actor: AuthenticatedRequest['user']) {
    const role = actor?.actorRole ?? actor?.role ?? null;
    const actingOrg = actor?.actingOrgId ?? null;
    if (role === Role.SUPER_ADMIN) {
      if (!actingOrg) {
        throw new ForbiddenException(
          'Organization context missing for SUPER_ADMIN; impersonation required',
        );
      }
      return;
    }
    if (role !== Role.ORGANIZER) {
      throw new ForbiddenException('Organizer role required');
    }
  }

  private requireOrg(actor: AuthenticatedRequest['user']) {
    this.requireOrganizerRole(actor);
    const orgId = effectiveOrganizationId(actor);
    if (!orgId) {
      throw new ForbiddenException('organizationId is required');
    }
    return orgId;
  }

  private coerceStageType(raw?: string | null): StageType {
    if (!raw) return StageType.GROUP;
    const match = Object.values(StageType).find(
      (value) => value.toLowerCase() === raw.toLowerCase(),
    );
    return (match as StageType | undefined) ?? StageType.GROUP;
  }

  private coerceGameKey(raw?: string | null): GameKey | undefined {
    if (!raw) return undefined;
    const match = Object.values(GameKey).find(
      (value) => value.toLowerCase() === raw.toLowerCase(),
    );
    return match as GameKey | undefined;
  }

  private coerceStatus(raw?: string | null): TournamentStatus | undefined {
    if (!raw) return undefined;
    const match = Object.values(TournamentStatus).find(
      (value) => value.toLowerCase() === raw.toLowerCase(),
    );
    return match as TournamentStatus | undefined;
  }

  async listStages(tournamentId: string, actor: AuthenticatedRequest['user']) {
    const orgId = this.requireOrg(actor);

    const tournament = await this.prisma.tournament.findFirst({
      where: { id: tournamentId, organizationId: orgId, deletedAt: null },
      select: { id: true },
    });
    if (!tournament) {
      throw new NotFoundException('Tournament not found');
    }

    return this.prisma.stage.findMany({
      where: { tournamentId, deletedAt: null },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        name: true,
        order: true,
        liveState: true,
        qualifiedTeamsCount: true,
        qualificationBubbleCount: true,
        qualificationLabel: true,
        createdAt: true,
        tournamentId: true,
        groups: {
          where: { deletedAt: null },
          orderBy: [{ createdAt: 'asc' }],
          select: {
            id: true,
            name: true,
            qualifiedTeamsCount: true,
            qualificationBubbleCount: true,
            qualificationLabel: true,
            createdAt: true,
            _count: {
              select: { matches: { where: { deletedAt: null } } },
            },
          },
        },
      },
    });
  }

  async createTournament(
    dto: CreateOrganizerTournamentDto,
    actor: AuthenticatedRequest['user'],
  ) {
    const orgId = this.requireOrg(actor);

    if (!dto.name?.trim()) {
      throw new BadRequestException('name is required');
    }

    if (!dto.startDate) {
      throw new BadRequestException('startDate is required');
    }
    if (!dto.endDate) {
      throw new BadRequestException('endDate is required');
    }

    const start = new Date(dto.startDate);
    const end = new Date(dto.endDate);
    if (Number.isNaN(start.getTime())) {
      throw new BadRequestException('Invalid startDate');
    }
    if (Number.isNaN(end.getTime())) {
      throw new BadRequestException('Invalid endDate');
    }
    if (start > end) {
      throw new BadRequestException(
        'endDate must be after or equal to startDate',
      );
    }

    const game = this.coerceGameKey(dto.game ?? null) ?? GameKey.PUBG_MOBILE;
    await assertOrganizationGameAccess(this.prisma, orgId, game);

    return this.prisma.$transaction(async (tx) => {
      const tournament = await tx.tournament.create({
        data: {
          name: dto.name.trim(),
          shortName: dto.shortName?.trim() || dto.name.trim(),
          timezone: dto.timezone ?? 'UTC',
          game,
          description: dto.description ?? null,
          region: dto.region ?? null,
          startDate: start,
          endDate: end,
          bannerUrl: dto.bannerUrl ?? null,
          logoUrl: dto.logoUrl ?? dto.bannerUrl ?? null,
          organizationId: orgId,
          ownerUserId: actor.id,
          status: TournamentStatus.DRAFT,
          registrationPaused: dto.registrationPaused ?? false,
          liveState: LiveState.UPCOMING,
          ...buildQualificationSettingsData(dto),
          ruleset: defaultTournamentRulesetForGame(game),
        },
      });

      const existingStage = await tx.stage.findFirst({
        where: { tournamentId: tournament.id, deletedAt: null },
        orderBy: { createdAt: 'asc' },
      });

      const stage =
        existingStage ??
        (await tx.stage.create({
          data: {
            name: 'Stage 1',
            order: 1,
            type: StageType.GROUP,
            maxTeams: null,
            tournamentId: tournament.id,
            organizationId: orgId,
          },
        }));

      await tx.tournament.update({
        where: { id: tournament.id },
        data: {
          defaultRegistrationStageId: stage.id,
        },
      });

      const existingGroup = await tx.group.findFirst({
        where: { stageId: stage.id, deletedAt: null },
        orderBy: { createdAt: 'asc' },
      });

      if (!existingGroup) {
        await tx.group.create({
          data: {
            name: 'Group A',
            stageId: stage.id,
            organizationId: orgId,
            maxTeams: null,
          },
        });
      }

      await tx.auditLog.create({
        data: {
          action: AuditAction.USER_ROLE_CHANGE,
          entityType: 'TOURNAMENT',
          entityId: tournament.id,
          organizationId: orgId,
          userId: actor.id,
          after: { name: tournament.name },
          source: 'ORGANIZER',
          reason: 'Organizer create tournament',
        },
      });

      return tournament;
    });
  }

  async list(
    actor: AuthenticatedRequest['user'],
    orgIdOverride?: string | null,
    includeDeleted = false,
  ) {
    const isSuper =
      actor?.role === Role.SUPER_ADMIN || actor?.actorRole === Role.SUPER_ADMIN;

    let orgId = orgIdOverride ?? effectiveOrganizationId(actor);

    if (orgIdOverride && !isSuper) {
      if (orgId && orgId !== orgIdOverride) {
        throw new ForbiddenException('Cannot list another organization');
      }
      orgId = orgIdOverride;
    }

    if (!orgId && isSuper) {
      const firstOrg = await this.prisma.organization.findFirst({
        where: { deletedAt: null },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      });
      orgId = firstOrg?.id ?? null;
    }

    if (!orgId) {
      throw new Error('Scoped organizationId missing in organizer context');
    }

    // TEMP DEBUG: verify effective org scoping for tournament list

    const tournaments = await this.prisma.tournament.findMany({
      where: {
        organizationId: orgId,
        deletedAt: includeDeleted ? { not: null } : null,
      },
      orderBy: includeDeleted ? { deletedAt: 'desc' } : { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        shortName: true,
        status: true,
        liveState: true,
        createdAt: true,
        deletedAt: true,
        logoUrl: true,
        bannerUrl: true,
        game: true,
        qualifiedTeamsCount: true,
        qualificationBubbleCount: true,
        qualificationLabel: true,
        _count: {
          select: {
            tournamentTeams: { where: { deletedAt: null } },
          },
        },
      },
    });

    if (tournaments.length === 0) {
      return [];
    }

    const hierarchyCounts = await this.prisma.$queryRaw<
      Array<{
        tournamentId: string;
        stagesCount: bigint | number | null;
        groupsCount: bigint | number | null;
        matchesCount: bigint | number | null;
      }>
    >(Prisma.sql`
        SELECT
          t.id AS "tournamentId",
          COUNT(DISTINCT s.id) AS "stagesCount",
          COUNT(DISTINCT g.id) AS "groupsCount",
          COUNT(m.id) AS "matchesCount"
        FROM "Tournament" t
        LEFT JOIN "Stage" s
          ON s."tournamentId" = t.id AND s."deletedAt" IS NULL
        LEFT JOIN "Group" g
          ON g."stageId" = s.id AND g."deletedAt" IS NULL
        LEFT JOIN "Match" m
          ON m."groupId" = g.id AND m."deletedAt" IS NULL
        WHERE t."organizationId" = ${orgId}
          AND ${
            includeDeleted
              ? Prisma.sql`t."deletedAt" IS NOT NULL`
              : Prisma.sql`t."deletedAt" IS NULL`
          }
        GROUP BY t.id
      `);
    const hierarchyMap = Object.fromEntries(
      hierarchyCounts.map((row) => [
        row.tournamentId,
        {
          stages: Number(row.stagesCount ?? 0),
          groups: Number(row.groupsCount ?? 0),
          matches: Number(row.matchesCount ?? 0),
        },
      ]),
    );

    const liveMatchCounts = await this.prisma.match.groupBy({
      by: ['tournamentId'],
      where: {
        tournamentId: { in: tournaments.map((t) => t.id) },
        organizationId: orgId,
        deletedAt: null,
        OR: [{ liveState: LiveState.LIVE }, { status: MatchStatus.LIVE }],
      },
      _count: { _all: true },
    });
    const liveMap = new Map(
      liveMatchCounts.map((m) => [m.tournamentId, m._count._all] as const),
    );

    return tournaments.map((t) => ({
      ...t,
      stagesCount: hierarchyMap[t.id]?.stages ?? 0,
      groupsCount: hierarchyMap[t.id]?.groups ?? 0,
      matchesCount: hierarchyMap[t.id]?.matches ?? 0,
      teamsCount: t._count.tournamentTeams,
      liveMatchCount: liveMap.get(t.id) ?? 0,
    }));
  }

  async restoreTournament(
    tournamentId: string,
    actor: AuthenticatedRequest['user'],
  ) {
    const orgId = this.requireOrg(actor);
    const tournament = await this.prisma.tournament.findFirst({
      where: {
        id: tournamentId,
        organizationId: orgId,
        deletedAt: { not: null },
      },
      select: {
        id: true,
        name: true,
        status: true,
        deletedAt: true,
      },
    });

    if (!tournament) {
      throw new NotFoundException('Deleted tournament not found');
    }

    await this.prisma.tournament.update({
      where: { id: tournamentId },
      data: { deletedAt: null },
    });

    await this.prisma.auditLog.create({
      data: {
        action: AuditAction.ADMIN_ADJUSTMENT,
        entityType: 'TOURNAMENT',
        entityId: tournamentId,
        organizationId: orgId,
        userId: actor.id,
        before: {
          deletedAt: tournament.deletedAt?.toISOString() ?? null,
          status: tournament.status,
        },
        after: {
          deletedAt: null,
          status: tournament.status,
          restored: true,
        },
        source: 'ORGANIZER',
        reason: `Organizer restored tournament ${tournament.name}`,
      },
    });

    return { ok: true };
  }

  async get(tournamentId: string, actor: AuthenticatedRequest['user']) {
    const orgId = this.requireOrg(actor);
    const tournament = await this.prisma.tournament.findFirst({
      where: { id: tournamentId, organizationId: orgId, deletedAt: null },
      include: {
        defaultRegistrationStage: {
          select: {
            id: true,
            name: true,
          },
        },
        stages: {
          where: { deletedAt: null },
          orderBy: { order: 'asc' },
          include: {
            groups: {
              where: { deletedAt: null },
              orderBy: { createdAt: 'asc' },
            },
          },
        },
        matches: {
          where: { deletedAt: null },
          orderBy: [{ createdAt: 'desc' }],
          take: 20,
          select: {
            id: true,
            name: true,
            matchNumber: true,
            status: true,
            liveState: true,
            controlState: { select: { state: true } },
            scheduledAt: true,
            startedAt: true,
            endedAt: true,
            groupId: true,
          },
        },
      },
    });
    if (!tournament) throw new NotFoundException('Tournament not found');
    return tournament;
  }

  async updateTournament(
    tournamentId: string,
    body: Partial<{
      name: string;
      shortName: string | null;
      description: string | null;
      region: string | null;
      timezone: string | null;
      bannerUrl: string | null;
      logoUrl: string | null;
      status: TournamentStatus | null;
      registrationPaused: boolean;
      defaultRegistrationStageId: string | null;
      game: string | null;
      startDate: string | number | Date | null;
      endDate: string | number | Date | null;
      qualifiedTeamsCount: number | string | null;
      qualificationBubbleCount: number | string | null;
      qualificationLabel: string | null;
    }>,
    actor: AuthenticatedRequest['user'],
  ) {
    const orgId = this.requireOrg(actor);
    await this.assertTournamentOrg(tournamentId, orgId);

    const data: Prisma.TournamentUpdateInput = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.shortName !== undefined) data.shortName = body.shortName ?? null;
    if (body.description !== undefined)
      data.description = body.description ?? null;
    if (body.region !== undefined) data.region = body.region ?? null;
    if (body.timezone !== undefined) data.timezone = body.timezone ?? null;
    if (body.bannerUrl !== undefined) data.bannerUrl = body.bannerUrl ?? null;
    if (body.logoUrl !== undefined) data.logoUrl = body.logoUrl ?? null;
    if (body.status !== undefined) data.status = body.status ?? undefined;
    if (body.registrationPaused !== undefined)
      (data as { registrationPaused?: boolean }).registrationPaused =
        body.registrationPaused;
    Object.assign(data, buildQualificationSettingsData(body));
    if (body.defaultRegistrationStageId !== undefined) {
      const stageId =
        typeof body.defaultRegistrationStageId === 'string'
          ? body.defaultRegistrationStageId.trim()
          : body.defaultRegistrationStageId;

      if (!stageId) {
        data.defaultRegistrationStage = { disconnect: true };
      } else {
        const stage = await this.prisma.stage.findFirst({
          where: {
            id: stageId,
            tournamentId,
            organizationId: orgId,
            deletedAt: null,
          },
          select: { id: true },
        });

        if (!stage) {
          throw new BadRequestException(
            'defaultRegistrationStageId must reference a stage in this tournament',
          );
        }

        data.defaultRegistrationStage = {
          connect: { id: stage.id },
        };
      }
    }
    if (body.game !== undefined) {
      const nextGame = this.coerceGameKey(body.game);
      if (nextGame) {
        await assertOrganizationGameAccess(this.prisma, orgId, nextGame);
      }
      data.game = nextGame;
    }

    if (body.startDate !== undefined) {
      const start = body.startDate ? new Date(body.startDate) : null;
      if (start && Number.isNaN(start.getTime())) {
        throw new BadRequestException('Invalid startDate');
      }
      data.startDate = start;
    }
    if (body.endDate !== undefined) {
      const end = body.endDate ? new Date(body.endDate) : null;
      if (end && Number.isNaN(end.getTime())) {
        throw new BadRequestException('Invalid endDate');
      }
      data.endDate = end;
    }

    const tournament = await this.prisma.tournament.findUnique({
      where: { id: tournamentId },
      select: { startDate: true, endDate: true },
    });
    const nextStart =
      (data.startDate as Date | null | undefined) ??
      tournament?.startDate ??
      null;
    const nextEnd =
      (data.endDate as Date | null | undefined) ?? tournament?.endDate ?? null;
    if (nextStart && nextEnd && nextStart > nextEnd) {
      throw new BadRequestException('startDate must be before endDate');
    }

    if (!Object.keys(data).length) {
      const current = await this.get(tournamentId, actor);
      return current;
    }

    await this.prisma.tournament.update({
      where: { id: tournamentId },
      data,
    });
    return this.get(tournamentId, actor);
  }

  private async assertTournamentOrg(
    tournamentId: string,
    orgId: string,
    tx: PrismaService | Prisma.TransactionClient = this.prisma,
  ) {
    const t = await tx.tournament.findFirst({
      where: { id: tournamentId, organizationId: orgId, deletedAt: null },
      select: { id: true },
    });
    if (!t) throw new ForbiddenException('Tournament not in your organization');
    return t;
  }

  async createStage(
    dto: CreateOrganizerStageDto,
    actor: AuthenticatedRequest['user'],
  ) {
    const orgId = this.requireOrg(actor);
    await this.assertTournamentOrg(dto.tournamentId, orgId);
    return this.prisma.stage.create({
      data: {
        name: dto.name,
        order: dto.order ?? 1,
        type: this.coerceStageType(dto.type ?? null),
        ...buildQualificationSettingsData(dto),
        tournamentId: dto.tournamentId,
        organizationId: orgId,
      },
    });
  }

  private async loadGroupWithStage(groupId: string, orgId: string) {
    const group = await this.prisma.group.findFirst({
      where: { id: groupId, organizationId: orgId, deletedAt: null },
      include: {
        stage: {
          select: { id: true, tournamentId: true, organizationId: true },
        },
      },
    });
    if (!group || group.stage.organizationId !== orgId) {
      throw new ForbiddenException('Group not in your organization');
    }
    return group;
  }

  async createGroup(
    dto: CreateOrganizerGroupDto,
    actor: AuthenticatedRequest['user'],
  ) {
    const orgId = this.requireOrg(actor);
    const stage = await this.prisma.stage.findFirst({
      where: { id: dto.stageId, organizationId: orgId, deletedAt: null },
      select: { id: true, tournamentId: true, organizationId: true },
    });
    if (!stage) throw new ForbiddenException('Stage not in your organization');
    return this.prisma.group.create({
      data: {
        name: dto.name,
        maxTeams: dto.maxTeams ?? null,
        ...buildQualificationSettingsData(dto),
        stageId: stage.id,
        organizationId: orgId,
      },
    });
  }

  async generateMatches(
    groupId: string,
    dto: GenerateMatchesDto,
    actor: AuthenticatedRequest['user'],
  ) {
    const orgId = this.requireOrg(actor);
    const group = await this.loadGroupWithStage(groupId, orgId);
    const tournamentId = group.stage.tournamentId;
    const stageId = group.stage.id;

    const startNumber = dto.startFromMatchNumber ?? 1;
    const interval = dto.intervalMinutes ?? 30;
    const startTime = dto.scheduleStartAt
      ? new Date(dto.scheduleStartAt)
      : null;
    if (startTime && Number.isNaN(startTime.getTime())) {
      throw new BadRequestException('scheduleStartAt must be a valid date');
    }

    const data: Prisma.MatchCreateManyInput[] = [];
    let currentTime = startTime;
    for (let i = 0; i < dto.count; i += 1) {
      const matchNumber = startNumber + i;
      data.push({
        id: randomUUID(),
        name: `Match ${matchNumber}`,
        matchNumber,
        tournamentId,
        stageId,
        groupId,
        organizationId: orgId,
        status: MatchStatus.DRAFT,
        liveState: LiveState.UPCOMING,
        scheduledAt: currentTime ?? undefined,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      if (currentTime) {
        currentTime = new Date(currentTime.getTime() + interval * 60 * 1000);
      }
    }

    const matches = await this.prisma.$transaction(async (tx) => {
      await tx.match.createMany({ data });
      const created = await tx.match.findMany({
        where: { id: { in: data.map((d) => d.id as string) } },
        orderBy: { matchNumber: 'asc' },
        select: {
          id: true,
          name: true,
          matchNumber: true,
          status: true,
          liveState: true,
          scheduledAt: true,
          startedAt: true,
          endedAt: true,
          controlState: { select: { state: true } },
        },
      });
      await tx.auditLog.create({
        data: {
          action: AuditAction.MATCH_STATUS_CHANGE,
          entityType: 'MATCH',
          entityId: created[0]?.id ?? 'BULK',
          organizationId: orgId,
          userId: actor.id,
          after: { count: created.length, groupId },
          source: 'ORGANIZER',
          reason: 'Bulk match generation',
        },
      });
      return created;
    });

    return matches;
  }
}
