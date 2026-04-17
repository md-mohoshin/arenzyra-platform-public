import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  GameKey,
  OrganizationStatus,
  Role,
  Prisma,
  AuditAction,
  MediaAssetType,
  LiveState,
} from '@prisma/client';
import type { Response } from 'express';
import * as path from 'path';
import * as fs from 'fs/promises';
import { PrismaService } from '../../db/prisma.service';
import type { AuthUser } from '../../common/auth/auth.types';
import type { Tournament } from '@prisma/client';
import type {
  TournamentCreateDto,
  TournamentDeleteDto,
  TournamentUpdateDto,
  TournamentHardDeleteDto,
} from './dto/tournament.dto';
import { deriveControlLiveState } from '../../common/live-state.util';
import { effectiveOrganizationId } from '../../common/org/org.util';
import { LiveService } from '../live/live.service';
import { RealtimeGateway } from '../../realtime/realtime.gateway';
import { PcobNamespaceGateway } from '../../realtime/pcob-namespace.gateway';
import { MatchControlStateStore } from '../match-control/state.store';
import { OverlayBroadcaster } from '../realtime/overlay-broadcaster.service';
import { MatchStateCache } from '../pcob/match-state-cache.service';
import {
  isMatchFinishedStatus,
  MATCH_FINISHED_STATUSES,
} from '../../common/match-status.util';

const DEFAULT_RULESET = {
  version: 'pubgm-v2',
  kill: 1,
  placement: {
    '1': 10,
    '2': 6,
    '3': 5,
    '4': 4,
    '5': 3,
    '6': 2,
    '7': 1,
    '8': 1,
    '9': 0,
    '10': 0,
    '11': 0,
    '12': 0,
    '13': 0,
    '14': 0,
    '15': 0,
    '16': 0,
    '17': 0,
    '18': 0,
    '19': 0,
    '20': 0,
    '21': 0,
    '22': 0,
    '23': 0,
    '24': 0,
    '25': 0,
  },
};

@Injectable()
export class TournamentsService {
  private readonly logger = new Logger('TournamentsService');
  private schemaChecked = false;
  private schemaValid = true;

  constructor(
    private prisma: PrismaService,
    private readonly live: LiveService,
    private readonly realtime: RealtimeGateway,
    private readonly pcobGateway: PcobNamespaceGateway,
    private readonly matchControlStore: MatchControlStateStore,
    private readonly overlayBroadcaster: OverlayBroadcaster,
    private readonly matchStateCache: MatchStateCache,
  ) {}

  private actorOrg(actor: AuthUser | null | undefined): string | null {
    return actor?.actingOrgId ?? actor?.organizationId ?? actor?.orgId ?? null;
  }

  private async auditTournament(params: {
    action: AuditAction;
    tournamentId: string;
    actor: AuthUser;
    before?: unknown;
    after?: unknown;
    organizationId?: string | null;
  }) {
    const actorId = params.actor?.actorId ?? params.actor?.id ?? 'unknown';
    const actedAsOrgId = this.actorOrg(params.actor);
    const beforeOrgId =
      params.before && typeof params.before === 'object'
        ? ((params.before as { organizationId?: string | null })
            ?.organizationId ??
          (params.before as { orgId?: string | null })?.orgId ??
          null)
        : null;
    const orgId =
      params.organizationId ??
      beforeOrgId ??
      actedAsOrgId ??
      (await this.getDefaultOrgId()) ??
      actorId;
    const afterPayload =
      params.after !== null && typeof params.after === 'object'
        ? {
            ...(params.after as Record<string, unknown>),
            actedAsOrgId,
          }
        : { value: params.after, actedAsOrgId };
    try {
      await this.prisma.auditLog.create({
        data: {
          action: params.action,
          entityType: 'TOURNAMENT',
          entityId: params.tournamentId,
          userId: actorId,
          organizationId: orgId,
          before: params.before as Prisma.InputJsonValue,
          after: afterPayload as Prisma.InputJsonValue,
          source: 'ADMIN',
        },
      });
    } catch (err) {
      // Do not block core flows if audit logging fails
      console.warn('[TournamentsService] audit log skipped', err);
    }
  }

  private async ensureSchema(): Promise<boolean> {
    if (this.schemaChecked) return this.schemaValid;
    this.schemaChecked = true;
    try {
      const rows = await this.prisma.$queryRaw<Array<{ column_name: string }>>`
          select lower(column_name) as column_name
          from information_schema.columns
          where lower(table_name) = 'tournament'
            and lower(column_name) in ('owneruserid', 'deletedat')
        `;
      const cols = new Set(rows.map((r) => r.column_name.toLowerCase()));
      const valid = cols.has('owneruserid') && cols.has('deletedat');
      if (!valid) {
        console.warn(
          '[TournamentsService] Database schema missing expected columns (ownerUserId/deletedAt). Run migrations to fix. Continuing without schema guard.',
        );
      }
      this.schemaValid = true; // never block core flows
    } catch (err) {
      console.warn('[TournamentsService] Schema check failed', err);
      this.schemaValid = true; // do not block core flows if check fails
    }
    return this.schemaValid;
  }

  private async getDefaultOrgId(): Promise<string | null> {
    const existing = await this.prisma.organization.findFirst({
      where: { deletedAt: null },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (existing?.id) return existing.id;

    const created = await this.prisma.organization.upsert({
      where: { slug: 'global-control' },
      update: { deletedAt: null },
      create: {
        name: 'Global Control',
        slug: 'global-control',
        status: OrganizationStatus.APPROVED,
      },
      select: { id: true },
    });
    return created.id;
  }

  private canEdit(actor: AuthUser | null | undefined, ownerUserId: string) {
    if (!actor) return false;
    if (actor.role === Role.SUPER_ADMIN || actor.actorRole === Role.SUPER_ADMIN)
      return true;
    const actorId = actor.actorId ?? actor.id;
    return actorId === ownerUserId;
  }

  async listForActor(
    orgId: string | null,
    actor: AuthUser,
  ): Promise<
    Array<
      Tournament & {
        liveState: 'LIVE' | 'ENDED' | 'UPCOMING';
        stageCount: number;
        matchCount: number;
      }
    >
  > {
    void this.ensureSchema(); // log-only; don't block if schema differs
    const effectiveOrgId = effectiveOrganizationId(actor);
    const actorOrgId = orgId ?? effectiveOrgId ?? actor?.orgId ?? null;
    if (!actorOrgId) {
      throw new ForbiddenException('Organization context missing');
    }

    try {
      const tournaments = await this.prisma.tournament.findMany({
        where: {
          deletedAt: null,
          organizationId: actorOrgId,
        },
        orderBy: { createdAt: 'desc' },
      });

      const ids = tournaments.map((t) => t.id);

      const [stageCounts, matchCounts, teamCounts] = await Promise.all([
        this.prisma.stage.groupBy({
          by: ['tournamentId'],
          where: { tournamentId: { in: ids }, deletedAt: null },
          _count: { _all: true },
        }),
        this.prisma.match.groupBy({
          by: ['tournamentId'],
          where: { tournamentId: { in: ids }, deletedAt: null },
          _count: { _all: true },
        }),
        this.prisma.tournamentTeam.groupBy({
          by: ['tournamentId'],
          where: { tournamentId: { in: ids }, deletedAt: null },
          _count: { _all: true },
        }),
      ]);
      const stageCountMap = new Map(
        stageCounts.map((c) => [c.tournamentId, c._count._all] as const),
      );
      const matchCountMap = new Map(
        matchCounts.map((c) => [c.tournamentId, c._count._all] as const),
      );
      const teamCountMap = new Map(
        teamCounts.map((c) => [c.tournamentId, c._count._all] as const),
      );

      const matchStates = await this.prisma.match.findMany({
        where: {
          deletedAt: null,
          tournamentId: { in: tournaments.map((t) => t.id) },
        },
        select: {
          tournamentId: true,
          controlState: { select: { state: true } },
        },
      });
      const byTournament = new Map<string, string[]>();
      for (const m of matchStates) {
        if (!m.tournamentId) {
          continue;
        }
        const list = byTournament.get(m.tournamentId) ?? [];
        list.push(deriveControlLiveState(m.controlState?.state ?? null));
        byTournament.set(m.tournamentId, list);
      }
      const deriveState = (states: string[]): 'LIVE' | 'ENDED' | 'UPCOMING' => {
        if (states.some((s) => s === 'LIVE')) return 'LIVE';
        if (states.length > 0 && states.every((s) => s === 'ENDED'))
          return 'ENDED';
        return 'UPCOMING';
      };
      return tournaments.map((t) => ({
        ...t,
        liveState: deriveState(byTournament.get(t.id) ?? []),
        stageCount: stageCountMap.get(t.id) ?? 0,
        matchCount: matchCountMap.get(t.id) ?? 0,
        teamsCount: teamCountMap.get(t.id) ?? 0,
      }));
    } catch (err) {
      console.warn(
        '[TournamentsService] listForActor fallback due to schema mismatch',
        err,
      );
      const tournaments = await this.prisma.tournament.findMany({});
      return tournaments.map((t) => ({
        ...t,
        liveState: 'UPCOMING' as const,
        stageCount: 0,
        matchCount: 0,
      }));
    }
  }

  async findByActor(
    tournamentId: string,
    actor: AuthUser,
  ): Promise<
    Tournament & {
      liveState: 'LIVE' | 'UPCOMING';
      stageCount: number;
      matchCount: number;
      sponsorsCount: number;
      teamsCount: number;
    }
  > {
    const actorOrgId = effectiveOrganizationId(actor) ?? actor?.orgId ?? null;
    if (!actorOrgId) {
      throw new ForbiddenException('Organization context missing');
    }

    const t = await this.prisma.tournament.findFirst({
      where: {
        id: tournamentId,
        deletedAt: null,
        organizationId: actorOrgId ?? undefined,
      },
    });
    if (!t) throw new NotFoundException('Tournament not found');
    if (!actorOrgId || t.organizationId !== actorOrgId) {
      throw new ForbiddenException('Not allowed to access this tournament');
    }

    const [stageCount, matchCount, sponsorsCount, teamsCount] =
      await Promise.all([
        this.prisma.stage.count({
          where: { tournamentId, deletedAt: null },
        }),
        this.prisma.match.count({
          where: { tournamentId, deletedAt: null },
        }),
        this.prisma.tournamentSponsor.count({
          where: { tournamentId },
        }),
        this.prisma.tournamentTeam.count({
          where: { tournamentId, deletedAt: null },
        }),
      ]);

    const liveMatch = await this.prisma.match.findFirst({
      where: {
        deletedAt: null,
        tournamentId,
        controlState: { state: 'LIVE' },
      },
      select: { id: true },
    });
    return {
      ...t,
      liveState: liveMatch ? ('LIVE' as const) : ('UPCOMING' as const),
      stageCount,
      matchCount,
      sponsorsCount,
      teamsCount,
    };
  }

  async create(
    orgId: string | null,
    body: TournamentCreateDto,
    actor: AuthUser,
  ): Promise<Tournament> {
    const required = [
      'name',
      'shortName',
      'region',
      'timezone',
      'startDate',
      'endDate',
    ];
    const missing = required.filter((f) => !body?.[f]);
    if (missing.length) {
      throw new BadRequestException(
        `Missing required fields: ${missing.join(', ')}`,
      );
    }
    if (!body.bannerUrl) {
      throw new BadRequestException('Tournament logo is required');
    }

    const startDate = new Date(body.startDate);
    const endDate = new Date(body.endDate);
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
      throw new BadRequestException('Invalid start/end date');
    }
    if (startDate > endDate) {
      throw new BadRequestException('Start date must be before end date');
    }

    const ownerUserId = actor?.actorId ?? actor?.id;
    if (!ownerUserId) {
      throw new ForbiddenException('Missing actor context for ownership');
    }
    // Determine effective organization (route > body > actor effective org)
    const organizationId =
      body.organizationId ?? orgId ?? effectiveOrganizationId(actor) ?? null;
    if (!organizationId) {
      throw new ForbiddenException('Organization context missing');
    }

    const created = await this.prisma.tournament.create({
      data: {
        organizationId,
        ownerUserId,
        name: body.name,
        shortName: body.shortName,
        description: body.description ?? null,
        region: body.region,
        bannerUrl: body.bannerUrl, // primary hero/banner
        logoUrl: body.logoUrl ?? body.bannerUrl ?? null,
        startDate,
        endDate,
        timezone: body.timezone,
        status: body.status ?? undefined,
        game: body.game ?? GameKey.PUBG_MOBILE,
        ruleset: (body.ruleset ?? DEFAULT_RULESET) as Prisma.InputJsonValue,
      },
    });

    await this.auditTournament({
      action: AuditAction.ADMIN_ADJUSTMENT,
      tournamentId: created.id,
      actor,
      before: null,
      after: { ...created, createdAt: created.createdAt, organizationId },
      organizationId,
    });

    return created;
  }

  async update(
    id: string,
    body: TournamentUpdateDto,
    actor: AuthUser,
  ): Promise<Tournament> {
    const t = await this.prisma.tournament.findFirst({
      where: { id, deletedAt: null },
    });
    if (!t) throw new NotFoundException('Tournament not found');

    const actorRole = actor?.actorRole ?? actor?.role;
    if (!this.canEdit(actor, t.ownerUserId)) {
      throw new ForbiddenException('Not allowed to update this tournament');
    }

    if (body?.ruleset !== undefined && actorRole !== Role.SUPER_ADMIN) {
      throw new ForbiddenException('Only SUPER_ADMIN can update ruleset');
    }

    const data: Prisma.TournamentUpdateInput = {};

    if (body?.name !== undefined) data.name = body.name;
    if (body?.shortName !== undefined) data.shortName = body.shortName ?? null;
    if (body?.description !== undefined)
      data.description = body.description ?? null;
    if (body?.region !== undefined) data.region = body.region ?? null;
    if (body?.timezone !== undefined) data.timezone = body.timezone ?? null;
    if (body?.bannerUrl !== undefined) data.bannerUrl = body.bannerUrl ?? null;
    if (body?.logoUrl !== undefined) data.logoUrl = body.logoUrl ?? null;
    if (body?.status !== undefined) data.status = body.status ?? undefined;

    if (body?.status === 'COMPLETED') {
      const nonOfficial = await this.prisma.match.count({
        where: {
          tournamentId: id,
          deletedAt: null,
          status: { notIn: MATCH_FINISHED_STATUSES },
        },
      });
      if (nonOfficial > 0) {
        throw new BadRequestException(
          'All matches must be ENDED before completing tournament',
        );
      }
    }
    if (body?.ruleset !== undefined) {
      data.ruleset =
        body.ruleset === null
          ? Prisma.JsonNull
          : (body.ruleset as Prisma.InputJsonValue);
    }

    if (body?.startDate !== undefined) {
      const startDate = body.startDate ? new Date(body.startDate) : null;
      if (startDate && Number.isNaN(startDate.getTime()))
        throw new BadRequestException('Invalid start date');
      data.startDate = startDate;
    }

    if (body?.endDate !== undefined) {
      const endDate = body.endDate ? new Date(body.endDate) : null;
      if (endDate && Number.isNaN(endDate.getTime()))
        throw new BadRequestException('Invalid end date');
      data.endDate = endDate;
    }

    const nextStart = data.startDate ?? t.startDate;
    const nextEnd = data.endDate ?? t.endDate;
    if (nextStart && nextEnd && nextStart > nextEnd) {
      throw new BadRequestException('Start date must be before end date');
    }

    if (!Object.keys(data).length) return t;

    const updated = await this.prisma.tournament.update({
      where: { id },
      data,
    });

    await this.auditTournament({
      action: AuditAction.ADMIN_ADJUSTMENT,
      tournamentId: id,
      actor,
      before: t,
      after: updated,
      organizationId:
        updated.organizationId ?? t.organizationId ?? this.actorOrg(actor),
    });

    return updated;
  }

  async deleteTournament(
    tournamentId: string,
    actor: AuthUser,
    input: TournamentDeleteDto,
    orgId?: string | null,
  ): Promise<{ ok: true }> {
    const confirmation = input?.confirm?.trim().toUpperCase() ?? '';
    if (confirmation !== 'DELETE TOURNAMENT') {
      throw new BadRequestException(
        'Confirmation required: type "DELETE TOURNAMENT". This will permanently delete all matches and results.',
      );
    }

    const isSuper =
      actor?.role === Role.SUPER_ADMIN || actor?.actorRole === Role.SUPER_ADMIN;
    const tournament = await this.prisma.tournament.findFirst({
      where: { id: tournamentId },
      select: {
        id: true,
        name: true,
        organizationId: true,
        ownerUserId: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (!tournament) throw new NotFoundException('Tournament not found');

    const effectiveOrg =
      input?.organizationId ?? orgId ?? effectiveOrganizationId(actor);

    if (!isSuper && !this.canEdit(actor, tournament.ownerUserId)) {
      throw new ForbiddenException('Not allowed to delete this tournament');
    }

    if (!isSuper) {
      if (!effectiveOrg || tournament.organizationId !== effectiveOrg) {
        throw new ForbiddenException('Not allowed to delete this tournament');
      }
    } else if (
      effectiveOrg &&
      tournament.organizationId &&
      tournament.organizationId !== effectiveOrg
    ) {
      throw new ForbiddenException(
        'Tournament does not belong to the acting organization',
      );
    }

    const stages = await this.prisma.stage.findMany({
      where: { tournamentId },
      select: { id: true, groups: { select: { id: true } } },
    });
    const stageIds = stages.map((s) => s.id);
    const groupIds = stages.flatMap((s) => s.groups.map((g) => g.id));
    const matchIds = (
      await this.prisma.match.findMany({
        where: { tournamentId },
        select: { id: true },
      })
    ).map((m) => m.id);

    const tx: Prisma.PrismaPromise<unknown>[] = [
      this.prisma.auditLog.deleteMany({
        where: {
          entityType: { in: ['MATCH', 'TOURNAMENT', 'STAGE', 'GROUP'] },
          entityId: {
            in: [tournamentId, ...stageIds, ...groupIds, ...matchIds],
          },
        },
      }),
      this.prisma.tournament.update({
        where: { id: tournamentId },
        data: { deletedAt: new Date() },
      }),
    ].filter(Boolean) as Prisma.PrismaPromise<unknown>[];

    await this.prisma.$transaction(tx);

    await this.auditTournament({
      action: AuditAction.ADMIN_ADJUSTMENT,
      tournamentId,
      actor,
      before: tournament,
      after: { deleted: true, deletedAt: new Date().toISOString() },
      organizationId: tournament.organizationId ?? effectiveOrg,
    });

    await this.clearTournamentCaches({
      tournamentId,
      matchIds,
      organizationId: tournament.organizationId ?? effectiveOrg ?? null,
    });

    return { ok: true };
  }

  async hardDeleteTournament(
    tournamentId: string,
    actor: AuthUser,
    input?: TournamentHardDeleteDto,
  ): Promise<{ ok: true }> {
    const tournament = await this.prisma.tournament.findFirst({
      where: { id: tournamentId },
    });

    if (!tournament) {
      throw new NotFoundException('Tournament not found');
    }

    if (tournament.liveState === LiveState.LIVE) {
      throw new BadRequestException('Cannot delete live tournament');
    }

    const realRole =
      actor?.realRole ?? actor?.role ?? actor?.actorRole ?? actor?.actingRole;
    const activeRole =
      actor?.actorRole ?? actor?.actingRole ?? actor?.role ?? actor?.realRole;
    const actorOrgId =
      actor?.organizationId ?? actor?.actingOrgId ?? actor?.orgId ?? null;

    const isSuperAdmin =
      realRole === Role.SUPER_ADMIN && !actor?.isImpersonating;
    const isOrgAdmin =
      activeRole === Role.ADMIN || activeRole === Role.ORGANIZER;

    if (!isSuperAdmin) {
      if (!isOrgAdmin) {
        throw new ForbiddenException('Not allowed to delete this tournament');
      }
      if (!actorOrgId || actorOrgId !== tournament.organizationId) {
        throw new ForbiddenException('Not allowed to delete this tournament');
      }
    }

    const confirmation = input?.confirmName?.trim();
    if (!confirmation) {
      throw new BadRequestException(
        'Confirmation required: type the tournament short name or DELETE',
      );
    }
    const normalizedConfirm = confirmation.toUpperCase();
    const nameMatch = tournament.name.trim().toUpperCase();
    const shortMatch = tournament.shortName
      ? tournament.shortName.trim().toUpperCase()
      : null;
    if (
      normalizedConfirm !== nameMatch &&
      normalizedConfirm !== shortMatch &&
      normalizedConfirm !== 'DELETE'
    ) {
      throw new BadRequestException(
        'Confirmation must match the tournament name, short name, or DELETE',
      );
    }

    const actorId = actor?.id ?? actor?.actorId ?? null;
    if (!actorId) {
      throw new ForbiddenException('Missing user context');
    }

    const matchIds = (
      await this.prisma.match.findMany({
        where: { tournamentId, deletedAt: null },
        select: { id: true },
      })
    ).map((m) => m.id);

    const beforeSnapshot = JSON.parse(
      JSON.stringify(tournament),
    ) as Prisma.InputJsonValue;

    await this.prisma.$transaction(async (tx) => {
      await tx.mediaAsset.deleteMany({ where: { tournamentId } });
      await tx.widgetInstance.deleteMany({ where: { tournamentId } });
      await tx.tournamentSponsor.deleteMany({ where: { tournamentId } });
      await tx.tournamentTeam.deleteMany({ where: { tournamentId } });
      await tx.payout.deleteMany({ where: { tournamentId } });
      await tx.adminAdjustment.deleteMany({ where: { tournamentId } });
      await tx.match.deleteMany({ where: { tournamentId } });
      await tx.stage.deleteMany({ where: { tournamentId } });

      await tx.auditLog.create({
        data: {
          action: AuditAction.TOURNAMENT_HARD_DELETE,
          organizationId: tournament.organizationId,
          userId: actorId,
          entityType: 'Tournament',
          entityId: tournament.id,
          before: beforeSnapshot,
          after: Prisma.DbNull,
          source: 'api',
        },
      });

      await tx.tournament.update({
        where: { id: tournamentId },
        data: { deletedAt: new Date() },
      });
    });

    await this.clearTournamentCaches({
      tournamentId,
      matchIds,
      organizationId: tournament.organizationId,
    });

    return { ok: true };
  }

  private async clearTournamentCaches(params: {
    tournamentId: string;
    matchIds: string[];
    organizationId: string | null;
  }) {
    try {
      await this.live.clearTournament(params.tournamentId);
    } catch (err) {
      this.logger.warn(
        `[TournamentsService] failed to clear live cache for tournament ${params.tournamentId}: ${String(err)}`,
      );
    }

    try {
      this.realtime.emitTournamentDeleted(
        params.organizationId,
        params.tournamentId,
      );
    } catch (err) {
      this.logger.warn(
        `[TournamentsService] failed to emit tournament deletion event: ${String(
          err,
        )}`,
      );
    }

    try {
      await this.matchControlStore.evictMatches(params.matchIds);
    } catch (err) {
      this.logger.warn(
        `[TournamentsService] failed to evict match control state: ${String(
          err,
        )}`,
      );
    }

    try {
      this.matchStateCache.evict(params.matchIds);
    } catch (err) {
      this.logger.warn(
        `[TournamentsService] failed to clear match telemetry cache: ${String(
          err,
        )}`,
      );
    }

    try {
      this.overlayBroadcaster.evictMatches(
        params.matchIds,
        params.organizationId,
      );
    } catch (err) {
      this.logger.warn(
        `[TournamentsService] failed to clear overlay cache: ${String(err)}`,
      );
    }

    try {
      this.pcobGateway.disconnectTournamentMatches(
        params.matchIds,
        params.organizationId,
      );
    } catch (err) {
      this.logger.warn(
        `[TournamentsService] failed to disconnect PCOB/OBS rooms: ${String(
          err,
        )}`,
      );
    }
  }

  private formatDate(d: Date | null): string | null {
    return d ? d.toISOString().split('T')[0] : null;
  }

  private async getTournament(tournamentId: string) {
    const tournament = await this.prisma.tournament.findFirst({
      where: { id: tournamentId, deletedAt: null },
      include: { organization: { select: { name: true } } },
    });
    if (!tournament) throw new NotFoundException('Tournament not found');
    return tournament;
  }

  private async getStagesWithGroupsAndMatches(tournamentId: string) {
    return this.prisma.stage.findMany({
      where: { tournamentId, deletedAt: null },
      orderBy: { order: 'asc' },
      select: {
        id: true,
        name: true,
        groups: {
          where: { deletedAt: null },
          orderBy: { name: 'asc' },
          select: {
            id: true,
            name: true,
            matches: {
              where: {
                deletedAt: null,
                status: { in: MATCH_FINISHED_STATUSES },
              },
              orderBy: [{ matchNumber: 'asc' }, { createdAt: 'asc' }],
              select: {
                matchNumber: true,
                map: true,
                status: true,
                slotResults: {
                  where: { wasPresentInMatch: true },
                  orderBy: [
                    { placement: 'asc' },
                    { totalPoints: 'desc' },
                    { createdAt: 'asc' },
                  ],
                  select: {
                    placement: true,
                    totalKills: true,
                    totalPoints: true,
                    team: { select: { name: true, tag: true } },
                  },
                },
              },
            },
          },
        },
      },
    });
  }

  async uploadLogo(
    tournamentId: string,
    file: Express.Multer.File,
    actor: AuthUser,
  ) {
    const tournament = await this.prisma.tournament.findFirst({
      where: { id: tournamentId, deletedAt: null },
      select: { id: true, organizationId: true },
    });
    if (!tournament) {
      throw new NotFoundException('Tournament not found');
    }

    const actorOrg = this.actorOrg(actor);
    if (
      actor?.role !== Role.SUPER_ADMIN &&
      (!actorOrg || actorOrg !== tournament.organizationId)
    ) {
      throw new ForbiddenException('Not allowed to modify this tournament');
    }

    if (!file?.mimetype?.startsWith('image/')) {
      throw new BadRequestException('Only image uploads are allowed');
    }
    if (file.size > 5 * 1024 * 1024) {
      throw new BadRequestException('File too large (max 5MB)');
    }

    const ext =
      file.originalname?.split('.').pop()?.toLowerCase() ??
      file.mimetype?.split('/')[1]?.toLowerCase() ??
      'png';
    const dir = path.join(
      process.cwd(),
      'uploads',
      'tournaments',
      tournamentId,
    );
    await fs.mkdir(dir, { recursive: true });
    const filename = `logo-${Date.now()}.${ext}`;
    const filePath = path.join(dir, filename);
    await fs.writeFile(filePath, file.buffer);
    const publicUrl = `/uploads/tournaments/${tournamentId}/${filename}`;

    await this.prisma.$transaction([
      this.prisma.tournament.update({
        where: { id: tournamentId },
        data: { logoUrl: publicUrl },
      }),
      this.prisma.mediaAsset.create({
        data: {
          tournamentId: tournament.id,
          organizationId: tournament.organizationId,
          type: MediaAssetType.TOURNAMENT_LOGO,
          url: publicUrl,
          ownerType: 'tournament',
          ownerId: tournament.id,
        },
      }),
    ]);

    return { logoUrl: publicUrl };
  }

  async buildLiquipediaExport(orgId: string, tournamentId: string) {
    const tournament = await this.getTournament(tournamentId);
    const stages = await this.getStagesWithGroupsAndMatches(tournamentId);

    return {
      tournament: {
        name: tournament.name,
        game: 'PUBG Mobile',
        organizer: tournament.organization?.name ?? 'N/A',
        start_date: this.formatDate(tournament.startDate ?? null),
        end_date: this.formatDate(tournament.endDate ?? null),
      },
      scoring: tournament.ruleset ?? DEFAULT_RULESET,
      stages: stages.map((stage) => ({
        name: stage.name,
        groups: stage.groups.map((group) => ({
          name: group.name,
          matches: group.matches
            .filter((m) => isMatchFinishedStatus(m.status))
            .map((match) => ({
              match_number: match.matchNumber,
              map: match.map,
              results: match.slotResults.map((ts) => ({
                team: ts.team?.name ?? null,
                tag: ts.team?.tag ?? null,
                placement: ts.placement,
                kills: ts.totalKills,
                points: ts.totalPoints,
              })),
            })),
        })),
      })),
    };
  }

  async toLiquipediaCsv(orgId: string, tournamentId: string): Promise<string> {
    await this.getTournament(tournamentId);
    const stages = await this.getStagesWithGroupsAndMatches(tournamentId);

    const header = [
      'stage',
      'group',
      'match',
      'map',
      'team',
      'tag',
      'placement',
      'kills',
      'points',
    ];
    const lines = [header.join(',')];

    stages.forEach((stage) => {
      stage.groups.forEach((group) => {
        group.matches.forEach((match) => {
          match.slotResults.forEach((ts) => {
            const line = [
              stage.name ?? '',
              group.name ?? '',
              match.matchNumber ?? '',
              match.map ?? '',
              ts.team?.name ?? '',
              ts.team?.tag ?? '',
              ts.placement ?? '',
              ts.totalKills ?? 0,
              ts.totalPoints ?? 0,
            ]
              .map((v) => `${v}`.replace(/"/g, ''))
              .join(',');
            lines.push(line);
          });
        });
      });
    });

    return lines.join('\n');
  }
}
