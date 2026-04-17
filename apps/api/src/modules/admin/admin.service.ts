import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditAction,
  AuditLog,
  DisciplineType,
  OrganizationStatus,
  ReportStatus,
  Role,
  UserStatus,
  Organization,
  Player,
  PlayerDiscipline,
  Report,
  Tournament,
} from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../db/prisma.service';
import { KycReviewDto } from './dto/kyc-review.dto';
import { WarnPlayerDto } from './dto/warn-player.dto';
import { BanPlayerDto } from './dto/ban-player.dto';
import { ResolveReportDto } from './dto/resolve-report.dto';
import { FlagAbuseDto } from './dto/flag-abuse.dto';
import type { AuthUser } from '../../common/auth/auth.types';
import { Prisma } from '@prisma/client';

type ActorLike = Partial<AuthUser>;

@Injectable()
export class AdminService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
  ) {}

  private async log(
    action: AuditAction,
    actor: ActorLike | string,
    entityType: string,
    entityId: string,
    before: unknown,
    after: unknown,
    orgId?: string | null,
  ): Promise<void> {
    const actorId =
      typeof actor === 'string'
        ? actor
        : (actor?.actorId ?? actor?.id ?? 'unknown');
    const actorOrg =
      typeof actor === 'string'
        ? undefined
        : (actor?.actingOrgId ?? actor?.organizationId ?? null);
    const actedAsOrgId =
      typeof actor === 'string'
        ? null
        : (actor?.actingOrgId ?? actor?.organizationId ?? null);
    const afterPayload =
      after === undefined
        ? { actedAsOrgId }
        : after !== null && typeof after === 'object'
          ? { ...(after as Record<string, unknown>), actedAsOrgId }
          : { value: after, actedAsOrgId };
    await this.prisma.auditLog.create({
      data: {
        action,
        entityType,
        entityId,
        userId: actorId,
        organizationId: orgId ?? actorOrg ?? actorId,
        before: before as Prisma.InputJsonValue,
        after: afterPayload as Prisma.InputJsonValue,
        source: 'MANUAL',
      },
    });
  }

  private requireOrg(actor: ActorLike) {
    const orgId = actor?.actingOrgId ?? actor?.organizationId;
    if (!orgId) {
      throw new BadRequestException('Admin is not assigned to an organization');
    }
    return orgId;
  }

  private requireReason(reason: string | undefined, action: string) {
    if (!reason?.trim()) {
      throw new BadRequestException(`Reason is required to ${action}`);
    }
    return reason.trim();
  }

  private actorId(actor: ActorLike): string {
    return actor?.actorId ?? actor?.id ?? 'unknown';
  }

  async listOrganizers(actor: ActorLike): Promise<
    Prisma.OrganizationGetPayload<{
      include: {
        _count: { select: { players: true; teams: true; tournaments: true } };
      };
    }>[]
  > {
    const orgId = this.requireOrg(actor);
    const orgs = await this.prisma.organization.findMany({
      where: { deletedAt: null, id: orgId },
      orderBy: { createdAt: 'desc' },
      include: {
        _count: {
          select: { players: true, teams: true, tournaments: true },
        },
      },
    });
    return orgs;
  }

  async listUsers(
    params: {
      q?: string;
      role?: Role;
      status?: UserStatus;
      orgId?: string;
      page?: number;
      pageSize?: number;
    },
    actor: ActorLike,
  ): Promise<{
    data: Array<
      Pick<
        Prisma.UserGetPayload<{
          select: {
            id: true;
            email: true;
            name: true;
            role: true;
            status: true;
            bannedUntil: true;
            organizationId: true;
            createdAt: true;
          };
        }>,
        | 'id'
        | 'email'
        | 'name'
        | 'role'
        | 'status'
        | 'bannedUntil'
        | 'organizationId'
        | 'createdAt'
      >
    >;
    page: number;
    pageSize: number;
    total: number;
  }> {
    const pageSize = Math.min(100, Math.max(params.pageSize ?? 20, 1));
    const page = Math.max(params.page ?? 1, 1);
    const where: Prisma.UserWhereInput = {
      deletedAt: null,
      ...(params.role ? { role: params.role } : {}),
      ...(params.status ? { status: params.status } : {}),
      ...(params.orgId ? { organizationId: params.orgId } : {}),
    };
    if (actor?.role === Role.ADMIN) {
      const orgId = this.requireOrg(actor);
      where.organizationId = orgId;
    }
    if (params.q?.trim()) {
      const term = params.q.trim();
      where.OR = [
        { email: { contains: term, mode: 'insensitive' } },
        { name: { contains: term, mode: 'insensitive' } },
      ];
    }
    const total = await this.prisma.user.count({ where });
    const data = await this.prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        status: true,
        bannedUntil: true,
        organizationId: true,
        createdAt: true,
      },
    });
    return { data, page, pageSize, total };
  }

  async getUser(
    userId: string,
    actor: ActorLike,
  ): Promise<
    Prisma.UserGetPayload<{ include: { organization: true } }> & {
      teams: [];
      tournaments: [];
      reports: [];
    }
  > {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      include: {
        organization: true,
      },
    });
    if (!user) throw new NotFoundException('User not found');
    if (actor?.role === Role.ADMIN) {
      const orgId = this.requireOrg(actor);
      if (user.organizationId && user.organizationId !== orgId) {
        throw new BadRequestException(
          'Cannot view users outside your organization',
        );
      }
    }
    return {
      ...user,
      teams: [],
      tournaments: [],
      reports: [],
    };
  }

  async approveOrganizer(
    id: string,
    dto: { reason: string },
    actor: ActorLike,
  ): Promise<Organization> {
    const orgId = this.requireOrg(actor);
    const reason = this.requireReason(dto.reason, 'approve organizer');
    const org = await this.prisma.organization.findUnique({ where: { id } });
    if (!org) throw new NotFoundException('Organization not found');
    if (org.id !== orgId) {
      throw new BadRequestException(
        'Admins may only approve their assigned organization',
      );
    }
    const updated = await this.prisma.organization.update({
      where: { id },
      data: { status: OrganizationStatus.APPROVED },
    });
    await this.log(
      AuditAction.ORGANIZER_APPROVE,
      this.actorId(actor),
      'ORGANIZATION',
      id,
      org,
      { ...updated, reason },
      org.id,
    );
    return updated;
  }

  async suspendOrganizer(
    id: string,
    dto: { reason: string },
    actor: ActorLike,
  ): Promise<Organization> {
    const orgId = this.requireOrg(actor);
    const reason = this.requireReason(dto.reason, 'suspend organizer');
    const org = await this.prisma.organization.findUnique({ where: { id } });
    if (!org) throw new NotFoundException('Organization not found');
    if (org.id !== orgId) {
      throw new BadRequestException(
        'Admins may only suspend their assigned organization',
      );
    }
    const updated = await this.prisma.organization.update({
      where: { id },
      data: { status: OrganizationStatus.SUSPENDED },
    });
    await this.log(
      AuditAction.ORGANIZER_SUSPEND,
      this.actorId(actor),
      'ORGANIZATION',
      id,
      org,
      { ...updated, reason },
      org.id,
    );
    return updated;
  }

  async reviewKyc(
    id: string,
    dto: KycReviewDto,
    actor: ActorLike,
  ): Promise<Organization> {
    const orgId = this.requireOrg(actor);
    if (!dto.note?.trim()) {
      throw new BadRequestException(
        'Reason/note is required for KYC decisions',
      );
    }
    const org = await this.prisma.organization.findUnique({ where: { id } });
    if (!org) throw new NotFoundException('Organization not found');
    if (org.id !== orgId) {
      throw new BadRequestException(
        'Admins may only review their assigned organization',
      );
    }
    const updated = await this.prisma.organization.update({
      where: { id },
      data: {
        kycStatus: dto.status,
        kycNote: dto.note,
        kycReviewedBy: this.actorId(actor),
        kycReviewedAt: new Date(),
      },
    });
    await this.log(
      AuditAction.ORGANIZER_KYC,
      this.actorId(actor),
      'ORGANIZATION',
      id,
      org,
      updated,
      org.id,
    );
    return updated;
  }

  async listPlayers(
    search: string | undefined,
    actor: ActorLike,
  ): Promise<Prisma.PlayerGetPayload<{ include: { organization: true } }>[]> {
    const orgId = this.requireOrg(actor);
    return this.prisma.player.findMany({
      where: {
        deletedAt: null,
        organizationId: orgId,
        OR: search
          ? [
              { ign: { contains: search, mode: 'insensitive' } },
              { realName: { contains: search, mode: 'insensitive' } },
            ]
          : undefined,
      },
      include: { organization: true },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  async listTeams(
    params: {
      q?: string;
      orgId?: string;
      status?: 'ACTIVE' | 'SUSPENDED';
      page?: number;
      pageSize?: number;
    },
    actor: ActorLike,
  ): Promise<{
    data: Array<{
      id: string;
      name: string;
      tag: string | null;
      status: 'ACTIVE' | 'SUSPENDED';
      organization?:
        | { id: string; name: string; displayName: string | null }
        | undefined;
      playersCount: number;
      tournamentsCount: number;
    }>;
    page: number;
    pageSize: number;
    total: number;
  }> {
    const orgId = this.requireOrg(actor);
    const pageSize = Math.min(100, Math.max(params.pageSize ?? 20, 1));
    const page = Math.max(params.page ?? 1, 1);

    const where: Prisma.TeamWhereInput = {
      deletedAt: null,
      organizationId: orgId,
    };
    if (params.q?.trim()) {
      const term = params.q.trim();
      where.OR = [
        { name: { contains: term, mode: 'insensitive' } },
        { tag: { contains: term, mode: 'insensitive' } },
      ];
    }
    if (params.status === 'SUSPENDED') {
      where.organization = { status: 'SUSPENDED' };
    } else if (params.status === 'ACTIVE') {
      where.organization = { status: { not: 'SUSPENDED' } };
    }

    const total = await this.prisma.team.count({ where });
    const data = await this.prisma.team.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        organization: {
          select: { id: true, name: true, status: true },
        },
        _count: { select: { players: true, tournamentTeams: true } },
      },
    });

    return {
      data: data.map((t) => ({
        id: t.id,
        name: t.name,
        tag: t.tag,
        status: t.organization?.status === 'SUSPENDED' ? 'SUSPENDED' : 'ACTIVE',
        organization: t.organization
          ? {
              id: t.organization.id,
              name: t.organization.name,
              displayName: null,
            }
          : undefined,
        playersCount: t._count?.players ?? 0,
        tournamentsCount: t._count?.tournamentTeams ?? 0,
      })),
      page,
      pageSize,
      total,
    };
  }

  async getTeam(
    teamId: string,
    actor: ActorLike,
  ): Promise<{
    id: string;
    name: string;
    tag: string | null;
    status: 'SUSPENDED' | 'ACTIVE';
    organization?:
      | { id: string; name: string; displayName: string | null }
      | undefined;
    playersCount: number;
    tournamentsCount: number;
    players:
      | Array<{
          id: string;
          name: string | null;
          ign: string;
          email: string | null;
        }>
      | undefined;
    tournaments: Array<{
      id: string;
      name: string | null;
      status: Prisma.TournamentUncheckedCreateInput['status'];
    }>;
  }> {
    const orgId = this.requireOrg(actor);
    const team = await this.prisma.team.findUnique({
      where: { id: teamId, deletedAt: null },
      include: {
        organization: {
          select: { id: true, name: true, status: true },
        },
        _count: { select: { players: true, tournamentTeams: true } },
        players: {
          where: { deletedAt: null },
          select: { id: true, realName: true, ign: true },
        },
        tournamentTeams: {
          include: {
            tournament: { select: { id: true, name: true, status: true } },
          },
        },
      },
    });
    if (!team) throw new NotFoundException('Team not found');
    if (team.organizationId && team.organizationId !== orgId) {
      throw new BadRequestException(
        'Cannot view teams outside your organization',
      );
    }

    return {
      id: team.id,
      name: team.name,
      tag: team.tag,
      status:
        team.organization?.status === 'SUSPENDED' ? 'SUSPENDED' : 'ACTIVE',
      organization: team.organization
        ? {
            id: team.organization.id,
            name: team.organization.name,
            displayName: null,
          }
        : undefined,
      playersCount: team._count?.players ?? 0,
      tournamentsCount: team._count?.tournamentTeams ?? 0,
      players:
        team.players?.map((p) => ({
          id: p.id,
          name: p.realName,
          ign: p.ign,
          email: null,
        })) ?? [],
      tournaments:
        team.tournamentTeams?.map((tt) => ({
          id: tt.tournamentId,
          name: tt.tournament?.name,
          status: tt.tournament?.status,
        })) ?? [],
    };
  }

  async warnPlayer(
    playerId: string,
    dto: WarnPlayerDto,
    actor: ActorLike,
  ): Promise<PlayerDiscipline> {
    const orgId = this.requireOrg(actor);
    const reason = this.requireReason(dto.reason, 'warn player');
    const player = await this.prisma.player.findUnique({
      where: { id: playerId },
    });
    if (!player) throw new NotFoundException('Player not found');
    if (player.organizationId !== orgId) {
      throw new BadRequestException(
        'Cannot warn players outside your organization',
      );
    }
    const discipline = await this.prisma.playerDiscipline.create({
      data: {
        playerId,
        type: DisciplineType.WARN,
        reason,
        createdBy: this.actorId(actor),
      },
    });
    await this.log(
      AuditAction.PLAYER_WARN,
      this.actorId(actor),
      'PLAYER',
      playerId,
      null,
      { warningId: discipline.id, reason: dto.reason },
      player.organizationId,
    );
    return discipline;
  }

  async banPlayer(
    playerId: string,
    dto: BanPlayerDto,
    actor: ActorLike,
  ): Promise<{ updated: Player; discipline: PlayerDiscipline }> {
    const orgId = this.requireOrg(actor);
    const reason = this.requireReason(dto.reason, 'ban player');
    const player = await this.prisma.player.findUnique({
      where: { id: playerId },
    });
    if (!player) throw new NotFoundException('Player not found');
    if (player.organizationId !== orgId) {
      throw new BadRequestException(
        'Cannot ban players outside your organization',
      );
    }
    const expiresAt = new Date(
      Date.now() + (dto.durationDays ?? 7) * 24 * 60 * 60 * 1000,
    );

    const updated = await this.prisma.player.update({
      where: { id: playerId },
      data: { isActive: false, bannedUntil: expiresAt },
    });
    const discipline = await this.prisma.playerDiscipline.create({
      data: {
        playerId,
        type: DisciplineType.TEMP_BAN,
        reason,
        expiresAt,
        createdBy: this.actorId(actor),
      },
    });
    await this.log(
      AuditAction.PLAYER_TEMP_BAN,
      this.actorId(actor),
      'PLAYER',
      playerId,
      player,
      updated,
      player.organizationId,
    );
    return { updated, discipline };
  }

  async unbanPlayer(
    playerId: string,
    dto: { reason: string },
    actor: ActorLike,
  ): Promise<Player> {
    const orgId = this.requireOrg(actor);
    const reason = this.requireReason(dto.reason, 'unban player');
    const player = await this.prisma.player.findUnique({
      where: { id: playerId },
    });
    if (!player) throw new NotFoundException('Player not found');
    if (player.organizationId !== orgId) {
      throw new BadRequestException(
        'Cannot unban players outside your organization',
      );
    }
    const updated = await this.prisma.player.update({
      where: { id: playerId },
      data: { isActive: true, bannedUntil: null },
    });
    await this.log(
      AuditAction.PLAYER_TEMP_BAN,
      this.actorId(actor),
      'PLAYER',
      playerId,
      player,
      { ...updated, reason },
      player.organizationId,
    );
    return updated;
  }

  async forceLogout(
    playerId: string,
    dto: { reason: string },
    actor: ActorLike,
  ): Promise<{ ok: true }> {
    const orgId = this.requireOrg(actor);
    const reason = this.requireReason(dto.reason, 'force logout');
    const player = await this.prisma.player.findUnique({
      where: { id: playerId },
    });
    if (!player) throw new NotFoundException('Player not found');
    if (player.organizationId !== orgId) {
      throw new BadRequestException(
        'Cannot force logout players outside your organization',
      );
    }
    await this.log(
      AuditAction.PLAYER_FORCE_LOGOUT,
      this.actorId(actor),
      'PLAYER',
      playerId,
      null,
      { forced: true, reason },
      player.organizationId,
    );
    return { ok: true };
  }

  async listReports(
    status: ReportStatus | undefined,
    actor: ActorLike,
  ): Promise<
    Prisma.ReportGetPayload<{
      include: { reporter: true; targetPlayer: true; targetTeam: true };
    }>[]
  > {
    const orgId = this.requireOrg(actor);
    return this.prisma.report.findMany({
      where: {
        ...(status ? { status } : {}),
        OR: [
          { targetPlayer: { organizationId: orgId } },
          { targetTeam: { organizationId: orgId } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      include: { reporter: true, targetPlayer: true, targetTeam: true },
      take: 200,
    });
  }

  async resolveReport(
    reportId: string,
    dto: ResolveReportDto,
    actor: ActorLike,
  ): Promise<Report> {
    const orgId = this.requireOrg(actor);
    const reason = this.requireReason(dto.reason, 'resolve report');
    const report = await this.prisma.report.findUnique({
      where: { id: reportId },
      include: { targetPlayer: true, targetTeam: true },
    });
    if (!report) throw new NotFoundException('Report not found');
    const reportOrg =
      (report as { organizationId?: string | null })?.organizationId ??
      report.targetPlayer?.organizationId ??
      report.targetTeam?.organizationId;
    if (reportOrg && reportOrg !== orgId) {
      throw new BadRequestException(
        'Cannot resolve reports outside your organization',
      );
    }
    const updated = await this.prisma.report.update({
      where: { id: reportId },
      data: {
        status: dto.status ?? ReportStatus.REVIEWED,
        resolutionNote: dto.note ?? reason,
        resolvedBy: this.actorId(actor),
      },
    });
    await this.log(
      AuditAction.REPORT_RESOLVE,
      this.actorId(actor),
      'REPORT',
      reportId,
      report,
      { ...updated, reason },
      reportOrg ?? orgId,
    );
    return updated;
  }

  async escalateReport(
    reportId: string,
    dto: { reason: string },
    actor: ActorLike,
  ): Promise<{ ok: true }> {
    const orgId = this.requireOrg(actor);
    const reason = this.requireReason(dto.reason, 'escalate report');
    const report = await this.prisma.report.findUnique({
      where: { id: reportId },
      include: { targetPlayer: true, targetTeam: true },
    });
    if (!report) throw new NotFoundException('Report not found');
    const reportOrg =
      (report as { organizationId?: string | null })?.organizationId ??
      report.targetPlayer?.organizationId ??
      report.targetTeam?.organizationId;
    if (reportOrg && reportOrg !== orgId) {
      throw new BadRequestException(
        'Cannot escalate reports outside your organization',
      );
    }
    await this.log(
      AuditAction.REPORT_ESCALATE,
      this.actorId(actor),
      'REPORT',
      reportId,
      report,
      { escalated: true, reason },
      reportOrg ?? orgId,
    );
    return { ok: true };
  }

  async listTournaments(
    actor: ActorLike,
  ): Promise<
    Prisma.TournamentGetPayload<{ include: { organization: true } }>[]
  > {
    const orgId = this.requireOrg(actor);
    return this.prisma.tournament.findMany({
      where: { deletedAt: null, organizationId: orgId },
      orderBy: { createdAt: 'desc' },
      include: { organization: true },
      take: 100,
    });
  }

  async pauseTournament(
    tournamentId: string,
    dto: { reason: string },
    actor: ActorLike,
  ): Promise<Tournament> {
    const orgId = this.requireOrg(actor);
    const reason = this.requireReason(dto.reason, 'pause tournament');
    const t = await this.prisma.tournament.findUnique({
      where: { id: tournamentId },
    });
    if (!t) throw new NotFoundException('Tournament not found');
    if (t.organizationId !== orgId) {
      throw new BadRequestException(
        'Cannot pause tournaments outside your organization',
      );
    }
    const updated = await this.prisma.tournament.update({
      where: { id: tournamentId },
      data: { registrationPaused: true },
    });
    await this.log(
      AuditAction.TOURNAMENT_PAUSE,
      this.actorId(actor),
      'TOURNAMENT',
      tournamentId,
      t,
      { ...updated, reason },
      t.organizationId,
    );
    return updated;
  }

  async removeTeamFromTournament(
    tournamentId: string,
    teamId: string,
    actor: ActorLike,
  ): Promise<{ ok: true }> {
    const orgId = this.requireOrg(actor);
    const link = await this.prisma.tournamentTeam.findUnique({
      where: { tournamentId_teamId: { tournamentId, teamId } },
      include: { tournament: { select: { organizationId: true } } },
    });
    if (!link) throw new NotFoundException('Team not in tournament');
    if (
      link.tournament?.organizationId &&
      link.tournament.organizationId !== orgId
    ) {
      throw new BadRequestException(
        'Cannot remove teams from tournaments outside your organization',
      );
    }
    await this.prisma.tournamentTeam.update({
      where: { id: link.id },
      data: { deletedAt: new Date() },
    });
    await this.log(
      AuditAction.TOURNAMENT_REMOVE_TEAM,
      this.actorId(actor),
      'TOURNAMENT',
      tournamentId,
      link,
      null,
      undefined,
    );
    return { ok: true };
  }

  async flagAbuse(
    tournamentId: string,
    dto: FlagAbuseDto,
    actor: ActorLike,
  ): Promise<Tournament> {
    const orgId = this.requireOrg(actor);
    const reason = this.requireReason(dto.reason, 'flag abuse');
    const t = await this.prisma.tournament.findUnique({
      where: { id: tournamentId },
    });
    if (!t) throw new NotFoundException('Tournament not found');
    if (t.organizationId !== orgId) {
      throw new BadRequestException(
        'Cannot flag tournaments outside your organization',
      );
    }
    const updated = await this.prisma.tournament.update({
      where: { id: tournamentId },
      data: { abuseFlagged: true },
    });
    await this.log(
      AuditAction.CONTENT_MODERATE,
      this.actorId(actor),
      'TOURNAMENT',
      tournamentId,
      t,
      { ...updated, abuseReason: reason },
      t.organizationId,
    );
    return updated;
  }

  async impersonateOrg(
    orgId: string,
    actor: ActorLike,
  ): Promise<{ impersonationToken: string; expiresAt: Date }> {
    const realActorId = actor?.actorId ?? actor?.id;
    const realActorRole = actor?.actorRole ?? actor?.role;
    if (realActorRole !== Role.SUPER_ADMIN) {
      throw new BadRequestException(
        'Only SUPER_ADMIN may impersonate an organization',
      );
    }
    const org = await this.prisma.organization.findFirst({
      where: { id: orgId, deletedAt: null },
    });
    if (!org) {
      throw new NotFoundException('Organization not found');
    }
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const impersonationToken = await this.jwt.signAsync(
      {
        sub: realActorId,
        role: Role.ORGANIZER,
        organizationId: orgId,
        actorId: realActorId,
        actorRole: realActorRole,
        actingOrgId: orgId,
        actingRole: Role.ORGANIZER,
        actingOrgName: org.name,
        isImpersonating: true,
        impersonationExpiresAt: expiresAt.toISOString(),
      },
      { expiresIn: '7d' },
    );
    const auditUserId =
      realActorId &&
      (
        await this.prisma.user.findUnique({
          where: { id: realActorId },
          select: { id: true },
        })
      )?.id;
    await this.prisma.auditLog.create({
      data: {
        action: AuditAction.IMPERSONATION,
        entityType: 'ORGANIZATION',
        entityId: orgId,
        userId: auditUserId ?? 'unknown',
        organizationId: orgId,
        before: { action: 'start' },
        after: {
          action: 'start',
          actingOrgId: orgId,
          actingRole: Role.ORGANIZER,
          expiresAt,
        },
        source: 'MANUAL',
      },
    });
    return { impersonationToken, expiresAt };
  }

  async endOrgImpersonation(actor: ActorLike): Promise<{
    ok: true;
    actorId: string | undefined;
    actingOrgId: string | null | undefined;
  }> {
    const realActorId = actor?.actorId ?? actor?.id;
    const orgId = actor?.actingOrgId ?? actor?.organizationId;
    if (!orgId) {
      throw new BadRequestException(
        'Not currently impersonating an organization',
      );
    }
    const auditUserId =
      realActorId &&
      (
        await this.prisma.user.findUnique({
          where: { id: realActorId },
          select: { id: true },
        })
      )?.id;
    const auditUserIdFinal =
      auditUserId ??
      (
        await this.prisma.user.findUnique({
          where: { id: realActorId },
          select: { id: true },
        })
      )?.id ??
      (
        await this.prisma.user.findFirst({
          where: { role: Role.SUPER_ADMIN, deletedAt: null },
          select: { id: true },
        })
      )?.id;
    const auditOrgIdFinal =
      orgId ??
      (
        await this.prisma.organization.findFirst({
          where: { deletedAt: null },
          select: { id: true },
        })
      )?.id ??
      orgId;
    try {
      if (!auditUserIdFinal) {
        throw new Error('No audit user available for impersonation end');
      }
      await this.prisma.auditLog.create({
        data: {
          action: AuditAction.IMPERSONATION,
          entityType: 'ORGANIZATION',
          entityId: orgId ?? 'unknown',
          before: { action: 'stop' },
          after: { action: 'stop', actingOrgId: orgId },
          source: 'MANUAL',
          organization: {
            connect: { id: auditOrgIdFinal ?? orgId },
          },
          user: {
            connect: { id: auditUserIdFinal },
          },
        },
      });
    } catch (err) {
      // Do not block exit on audit failure

      console.error('[ADMIN] audit log failed for endOrgImpersonation', err);
    }
    return { ok: true, actorId: realActorId, actingOrgId: orgId };
  }

  async actionLogs(actor: ActorLike): Promise<AuditLog[]> {
    const orgId = this.requireOrg(actor);
    return this.prisma.auditLog.findMany({
      where: {
        organizationId: orgId,
        action: {
          in: [
            AuditAction.ORGANIZER_APPROVE,
            AuditAction.ORGANIZER_SUSPEND,
            AuditAction.ORGANIZER_KYC,
            AuditAction.PLAYER_WARN,
            AuditAction.PLAYER_TEMP_BAN,
            AuditAction.PLAYER_FORCE_LOGOUT,
            AuditAction.REPORT_RESOLVE,
            AuditAction.REPORT_ESCALATE,
            AuditAction.TOURNAMENT_PAUSE,
            AuditAction.TOURNAMENT_REMOVE_TEAM,
            AuditAction.CONTENT_MODERATE,
          ],
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }
}
