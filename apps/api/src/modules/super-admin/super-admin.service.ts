import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import {
  AuditAction,
  Prisma,
  NotificationAudience,
  OrganizationStatus,
  KycStatus,
  PayoutStatus,
  ReportStatus,
  WalletTransactionType,
  FeatureKey,
  Role,
  UserStatus,
  Role as PrismaRole,
  SystemFlag,
  Organization,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../db/prisma.service';
import type { AuthUser } from '../../common/auth/auth.types';
import { UpdateFlagsDto } from './dto/update-flags.dto';
import { AdjustWalletDto } from './dto/adjust-wallet.dto';
import { ChangeRoleDto } from './dto/change-role.dto';
import { BanUserDto } from './dto/ban-user.dto';
import { ResolveReportDto } from './dto/resolve-report.dto';
import { BroadcastDto } from './dto/broadcast.dto';
import type { UpdateOrgConfigDto } from './dto/update-org-config.dto';
import type { ReasonDto } from './dto/reason.dto';
import type { CreateManagedUserDto } from './dto/create-managed-user.dto';
import type { UpdateManagedUserDto } from './dto/update-managed-user.dto';
import { env } from '../../config/env.validation';

type Actor = AuthUser;
type SystemFlagWithReason = SystemFlag & { superAdminRequiresReason: boolean };
type OrganizerWithCounts = Prisma.OrganizationGetPayload<{
  include: {
    _count: {
      select: {
        tournaments: true;
        players: true;
        teams: true;
        users: { where: { role: Role; deletedAt: null } };
      };
    };
  };
}>;
type TeamWithCounts = Prisma.TeamGetPayload<{
  include: {
    organization: true;
    _count: { select: { players: true; tournamentTeams: true } };
  };
}>;
type ListedUser = Prisma.UserGetPayload<{
  select: {
    id: true;
    email: true;
    name: true;
    role: true;
    status: true;
    bannedUntil: true;
    organizationId: true;
    createdAt: true;
    deletedAt: true;
  };
}>;

interface ListTeamsParams {
  q?: string;
  orgId?: string;
  status?: 'ACTIVE' | 'SUSPENDED';
  page?: number;
  pageSize?: number;
}

interface ListUsersParams {
  q?: string;
  role?: PrismaRole;
  status?: UserStatus | 'DELETED';
  orgId?: string;
  page?: number;
  pageSize?: number;
}

interface MoveUserOrgDto {
  orgId: string;
  reason?: string;
}

interface ResetPasswordDto {
  reason?: string;
  newPassword?: string | null;
}

interface UpdateTeamStatusDto {
  status: string;
  reason?: string;
}

interface RemovePlayerDto {
  playerId: string;
  reason?: string;
}

interface ForceLeaveTournamentDto {
  tournamentId: string;
  reason?: string;
}

interface LogUserActionDto {
  action: string;
  userEmail?: string;
  role?: string;
  organizationId?: string;
  adminId?: string;
  reason?: string;
  timestamp?: string;
}

@Injectable()
export class SuperAdminService implements OnModuleInit {
  private readonly logger = new Logger('SuperAdminService');
  private defaultOrgId: string | null = null;

  private requireSuper(actor: Actor) {
    const role = actor?.actorRole ?? actor?.role;
    if (role !== Role.SUPER_ADMIN) {
      throw new UnauthorizedException('Only SUPER_ADMIN is allowed');
    }
  }

  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      const ready = await this.prismaReady();
      if (!ready) {
        this.logger.warn(
          'Prisma unavailable on bootstrap; skipping ensureFlags',
        );
        return;
      }
      await this.ensureFlags();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `[SuperAdminService] ensureFlags on bootstrap failed: ${msg}`,
      );
    }
  }

  private async prismaReady(): Promise<boolean> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return true;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Prisma unavailable: ${msg}`);
      return false;
    }
  }

  private getOptionalStringField(
    source: unknown,
    key: string,
  ): string | null | undefined {
    if (source && typeof source === 'object' && key in source) {
      const value = (source as Record<string, unknown>)[key];
      if (typeof value === 'string') return value;
      if (value === null) return null;
    }
    return undefined;
  }

  private normalizeSystemFlag(flags: SystemFlag): SystemFlagWithReason {
    const extended = flags as SystemFlag & Record<string, unknown>;
    const requiresReason =
      typeof extended.superAdminRequiresReason === 'boolean'
        ? extended.superAdminRequiresReason
        : false;
    return { ...flags, superAdminRequiresReason: requiresReason };
  }

  private requireOrgId(user: Actor | null | undefined): string {
    // Prefer a real orgId for auditing, fall back to a known default org when absent.
    return (
      user?.organizationId ?? user?.actingOrgId ?? this.defaultOrgId ?? 'SYSTEM'
    );
  }

  private async resolveAuditUserId(userId?: string): Promise<string | null> {
    if (!userId) return null;
    const existing = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (existing?.id) return existing.id;

    const fallback = await this.prisma.user.findFirst({
      where: { role: Role.SUPER_ADMIN, deletedAt: null },
      select: { id: true },
    });
    return fallback?.id ?? null;
  }

  private async ensureFlags(): Promise<SystemFlagWithReason> {
    const ready = await this.prismaReady();
    if (!ready) {
      const fallback = {
        id: 'singleton',
        maintenanceMode: false,
        lockRegistrations: false,
        freezePayouts: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as unknown as SystemFlag;
      return this.normalizeSystemFlag(fallback);
    }
    const createData: Prisma.SystemFlagCreateInput = {
      id: 'singleton',
      maintenanceMode: false,
      lockRegistrations: false,
      freezePayouts: false,
    };
    const flags = await this.prisma.systemFlag.upsert({
      where: { id: 'singleton' },
      update: {},
      create: createData,
    });
    await this.ensurePrimarySuperAdmin();
    return this.normalizeSystemFlag(flags);
  }

  private async ensurePrimarySuperAdmin() {
    const email = env.SUPERADMIN_EMAIL;
    const existing = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, organizationId: true },
    });

    const defaultOrg = await this.prisma.organization.upsert({
      where: { slug: 'global-control' },
      update: { deletedAt: null, status: OrganizationStatus.APPROVED },
      create: {
        name: 'Global Control',
        slug: 'global-control',
        status: OrganizationStatus.APPROVED,
      },
      select: { id: true },
    });
    this.defaultOrgId = defaultOrg.id ?? this.defaultOrgId;

    if (existing) {
      if (existing.organizationId && !this.defaultOrgId) {
        this.defaultOrgId = existing.organizationId;
      }
      return existing;
    }

    const hashed = await bcrypt.hash(env.SUPERADMIN_PASSWORD, 12);
    const created = await this.prisma.user.create({
      data: {
        email,
        password: hashed,
        name: 'Primary Super Admin',
        role: Role.SUPER_ADMIN,
        status: UserStatus.ACTIVE,
        organizationId: defaultOrg.id,
      },
      select: { id: true, organizationId: true },
    });
    this.defaultOrgId = created.organizationId ?? this.defaultOrgId;
    return created;
  }

  async summary() {
    const [tournaments, players, organizers, revenue] = await Promise.all([
      this.prisma.tournament.count({ where: { deletedAt: null } }),
      this.prisma.player.count({ where: { deletedAt: null } }),
      this.prisma.organization.count({ where: { deletedAt: null } }),
      this.prisma.payout.aggregate({
        where: { status: PayoutStatus.APPROVED },
        _sum: { amount: true },
      }),
    ]);

    return {
      tournaments,
      players,
      organizers,
      revenue: Number(revenue._sum.amount ?? 0),
    };
  }

  async getFlags(): Promise<SystemFlagWithReason> {
    return this.ensureFlags();
  }

  async updateFlags(dto: UpdateFlagsDto, actor: Actor): Promise<SystemFlag> {
    const before = await this.ensureFlags();
    const updatedBy = actor?.role === Role.SUPER_ADMIN ? undefined : actor?.id;
    const { reason, ...flagUpdates } = dto;
    const updateData = {
      ...flagUpdates,
      updatedBy: updatedBy ?? null,
      updatedAt: new Date(),
    };
    const updated = await this.prisma.systemFlag.update({
      where: { id: before.id },
      data: updateData,
    });

    if (actor?.id && actor?.organizationId) {
      await this.prisma.auditLog.create({
        data: {
          action: AuditAction.SYSTEM_FLAG_UPDATE,
          entityType: 'SYSTEM',
          entityId: 'FLAGS',
          userId: actor.id,
          organizationId: this.requireOrgId(actor),
          before,
          after: { ...updated, reason },
          source: 'MANUAL',
        },
      });
    }

    return updated;
  }

  async listOrganizers(): Promise<
    Array<{
      id: string;
      name: string;
      slug: string;
      displayName: string | null | undefined;
      status: OrganizationStatus;
      adminCount: number;
      tournamentsActive: number;
      _count: OrganizerWithCounts['_count'];
    }>
  > {
    const orgs: OrganizerWithCounts[] = await this.prisma.organization.findMany(
      {
        where: { deletedAt: null },
        orderBy: { createdAt: 'desc' },
        include: {
          _count: {
            select: {
              tournaments: true,
              players: true,
              teams: true,
              users: { where: { role: Role.ADMIN, deletedAt: null } },
            },
          },
        },
      },
    );
    return orgs.map((o) => ({
      id: o.id,
      name: o.name,
      slug: o.slug,
      displayName: this.getOptionalStringField(o, 'displayName'),
      status: o.status,
      adminCount: o._count?.users ?? 0,
      tournamentsActive: o._count?.tournaments ?? 0,
      _count: o._count,
    }));
  }

  async approveOrganization(
    orgId: string,
    dto: ReasonDto,
    actor: Actor,
  ): Promise<Organization> {
    const reason = await this.requireReason(
      dto.reason,
      'approve organization',
      actor,
    );
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
    });
    if (!org) throw new NotFoundException('Organization not found');

    const updated = await this.prisma.organization.update({
      where: { id: orgId },
      data: {
        status: OrganizationStatus.APPROVED,
        kycStatus: KycStatus.APPROVED,
        kycReviewedBy: actor?.id,
        kycReviewedAt: new Date(),
      },
    });

    await this.prisma.auditLog.create({
      data: {
        action: AuditAction.ORGANIZER_APPROVE,
        entityType: 'ORGANIZATION',
        entityId: orgId,
        userId: actor?.id,
        organizationId: orgId,
        before: { status: org.status, kycStatus: org.kycStatus },
        after: {
          status: updated.status,
          kycStatus: updated.kycStatus,
          reason,
          actorRole: actor?.role,
        },
        source: 'MANUAL',
      },
    });

    return updated;
  }

  async revertOrganizationApproval(
    orgId: string,
    dto: ReasonDto,
    actor: Actor,
  ): Promise<Organization> {
    const reason = await this.requireReason(
      dto.reason,
      'revert approval',
      actor,
    );
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
    });
    if (!org) throw new NotFoundException('Organization not found');

    const updated = await this.prisma.organization.update({
      where: { id: orgId },
      data: {
        status: OrganizationStatus.PENDING,
        kycStatus: KycStatus.PENDING,
      },
    });

    await this.prisma.auditLog.create({
      data: {
        action: AuditAction.ADMIN_ADJUSTMENT,
        entityType: 'ORGANIZATION',
        entityId: orgId,
        userId: actor?.id,
        organizationId: orgId,
        before: { status: org.status, kycStatus: org.kycStatus },
        after: {
          status: updated.status,
          kycStatus: updated.kycStatus,
          reason,
          actorRole: actor?.role,
        },
        source: 'MANUAL',
      },
    });

    return updated;
  }

  async updateOrganizationConfig(
    orgId: string,
    dto: UpdateOrgConfigDto,
    actor: Actor,
  ): Promise<Organization> {
    const reason = await this.requireReason(
      dto.reason,
      'update organization config',
      actor,
    );
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
    });
    if (!org) throw new NotFoundException('Organization not found');

    const name = dto.name?.trim();
    const slug = dto.slug?.trim();
    const kycStatus = dto.kycStatus;
    const kycNote = dto.kycNote?.trim();
    const updates: Prisma.OrganizationUpdateInput = {};
    if (name) updates.name = name;
    if (slug) updates.slug = slug;
    if (kycStatus) updates.kycStatus = kycStatus;
    if (kycNote) updates.kycNote = kycNote;
    if (Object.keys(updates).length === 0) {
      throw new BadRequestException('No configuration changes provided');
    }

    try {
      const updated = await this.prisma.organization.update({
        where: { id: orgId },
        data: updates,
      });

      await this.prisma.auditLog.create({
        data: {
          action: AuditAction.ADMIN_ADJUSTMENT,
          entityType: 'ORGANIZATION',
          entityId: orgId,
          userId: actor?.id,
          organizationId: orgId,
          before: {
            name: org.name,
            slug: org.slug,
            kycStatus: org.kycStatus,
            kycNote: org.kycNote,
          },
          after: {
            name: updated.name,
            slug: updated.slug,
            kycStatus: updated.kycStatus,
            kycNote: updated.kycNote,
            reason,
            actorRole: actor?.role,
          },
          source: 'MANUAL',
        },
      });

      return updated;
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new BadRequestException('Organization name/slug must be unique');
      }
      throw new BadRequestException(
        err instanceof Error ? err.message : 'Failed to update organization',
      );
    }
  }

  async listTeams(params: ListTeamsParams) {
    const pageSize = Math.min(100, Math.max(params.pageSize ?? 20, 1));
    const page = Math.max(params.page ?? 1, 1);

    const where: Prisma.TeamWhereInput = { deletedAt: null };
    if (params.orgId) where.organizationId = params.orgId;
    if (params.q?.trim()) {
      const term = params.q.trim();
      where.OR = [
        { name: { contains: term, mode: 'insensitive' } },
        { tag: { contains: term, mode: 'insensitive' } },
      ];
    }
    if (params.status === 'SUSPENDED') {
      where.organization = { status: OrganizationStatus.SUSPENDED };
    } else if (params.status === 'ACTIVE') {
      where.organization = { status: { not: OrganizationStatus.SUSPENDED } };
    }

    const total = await this.prisma.team.count({ where });
    const data: TeamWithCounts[] = await this.prisma.team.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        organization: true,
        _count: { select: { players: true, tournamentTeams: true } },
      },
    });

    return {
      data: data.map((t) => ({
        id: t.id,
        name: t.name,
        tag: t.tag,
        status:
          t.organization?.status === OrganizationStatus.SUSPENDED
            ? 'SUSPENDED'
            : 'ACTIVE',
        organization: t.organization
          ? {
              id: t.organization.id,
              name: t.organization.name,
              displayName: this.getOptionalStringField(
                t.organization,
                'displayName',
              ),
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

  async listUsers(params: ListUsersParams) {
    const pageSize = Math.min(100, Math.max(params.pageSize ?? 20, 1));
    const page = Math.max(params.page ?? 1, 1);
    const where: Prisma.UserWhereInput = {
      ...(params.role ? { role: params.role } : {}),
      ...(params.status && params.status !== 'DELETED'
        ? { status: params.status }
        : {}),
      ...(params.orgId ? { organizationId: params.orgId } : {}),
    };
    if (params.status === 'DELETED') {
      where.deletedAt = { not: null };
    } else {
      where.deletedAt = null;
    }
    if (params.q?.trim()) {
      const term = params.q.trim();
      where.OR = [
        { email: { contains: term, mode: 'insensitive' } },
        { name: { contains: term, mode: 'insensitive' } },
      ];
    }
    const total = await this.prisma.user.count({ where });
    const data: ListedUser[] = await this.prisma.user.findMany({
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
        deletedAt: true,
      },
    });
    const mapped = data.map((u) =>
      u.deletedAt ? { ...u, status: 'DELETED' as const } : u,
    );
    return { data: mapped, page, pageSize, total };
  }

  private normalizeManagedRole(role: string | null | undefined): Role {
    const normalized = role?.toUpperCase?.() ?? '';
    if (normalized === 'ADMIN') return Role.ADMIN;
    if (normalized === 'ORGANIZER') return Role.ORGANIZER;
    throw new BadRequestException('role must be ADMIN or ORGANIZER');
  }

  private normalizeManagedStatus(
    status: string | null | undefined,
  ): UserStatus {
    if (!status) return UserStatus.ACTIVE;
    const normalized = status.toUpperCase();
    if (normalized === 'ACTIVE') return UserStatus.ACTIVE;
    if (normalized === 'SUSPENDED') return UserStatus.INACTIVE;
    throw new BadRequestException('status must be ACTIVE or SUSPENDED');
  }

  async createManagedUser(dto: CreateManagedUserDto, actor: Actor) {
    this.requireSuper(actor);
    if (!dto?.email || !dto?.password) {
      throw new BadRequestException('email and password are required');
    }
    // Default all managed users to ORGANIZER role until explicitly changed.
    const role = Role.ORGANIZER;
    const email = dto.email.toLowerCase();
    const hashed = await bcrypt.hash(dto.password, 12);

    const existing = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, role: true, deletedAt: true },
    });
    if (existing) {
      if (existing.role === Role.SUPER_ADMIN) {
        throw new BadRequestException('Cannot replace a SUPER_ADMIN account');
      }
      const suffix = Date.now();
      await this.prisma.$transaction(async (tx) => {
        // Soft delete existing user and free the unique email constraint
        await tx.user.update({
          where: { id: existing.id },
          data: { deletedAt: new Date() },
        });
        await tx.user.update({
          where: { id: existing.id },
          data: { email: `${email}__replaced__${suffix}` },
        });
      });
    }

    const organizationId =
      actor?.organizationId ?? actor?.actingOrgId ?? actor?.orgId ?? null;
    const created = await this.prisma.user.create({
      data: {
        email,
        password: hashed,
        name: email,
        role,
        status: UserStatus.ACTIVE,
        organizationId: organizationId ?? null,
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        status: true,
        organizationId: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    const auditOrgId = organizationId ?? this.defaultOrgId;
    const auditUserId = actor?.actorId ?? actor?.id ?? null;
    if (auditOrgId && auditUserId) {
      try {
        await this.prisma.auditLog.create({
          data: {
            organizationId: auditOrgId,
            userId: auditUserId,
            action: AuditAction.USER_ROLE_CHANGE,
            entityType: 'User',
            entityId: created.id,
            before: undefined,
            after: { role, status: created.status },
            source: 'SYSTEM',
            reason: 'SUPER_ADMIN create user',
          },
        });
      } catch (err) {
        this.logger.warn(
          `[SUPER_ADMIN] audit log failed for createManagedUser: ${String(
            err,
          )}`,
        );
      }
    }

    return created;
  }

  async listManagedUsers(
    role: 'ADMIN' | 'ORGANIZER' | 'ALL',
    actor: Actor,
  ): Promise<ListedUser[]> {
    this.requireSuper(actor);
    const where: Prisma.UserWhereInput =
      role && role !== 'ALL'
        ? { role: this.normalizeManagedRole(role), deletedAt: null }
        : { role: { in: [Role.ADMIN, Role.ORGANIZER] }, deletedAt: null };
    return this.prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        status: true,
        organizationId: true,
        createdAt: true,
        deletedAt: true,
        bannedUntil: true,
      },
    });
  }

  async updateManagedUser(
    userId: string,
    dto: UpdateManagedUserDto,
    actor: Actor,
  ) {
    this.requireSuper(actor);
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: {
        id: true,
        role: true,
        status: true,
        organizationId: true,
      },
    });
    if (!user) throw new NotFoundException('User not found');
    if (user.role === Role.SUPER_ADMIN) {
      throw new BadRequestException('Cannot update SUPER_ADMIN user');
    }
    const data: Prisma.UserUpdateInput = {};
    if (dto.role) data.role = this.normalizeManagedRole(dto.role);
    if (dto.status) data.status = this.normalizeManagedStatus(dto.status);
    if (!Object.keys(data).length) return user;

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        status: true,
        organizationId: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    const auditOrgId = updated.organizationId ?? this.defaultOrgId;
    const auditUserId = actor?.actorId ?? actor?.id ?? null;
    if (auditOrgId && auditUserId) {
      try {
        await this.prisma.auditLog.create({
          data: {
            organizationId: auditOrgId,
            userId: auditUserId,
            action: AuditAction.USER_ROLE_CHANGE,
            entityType: 'User',
            entityId: updated.id,
            before: { role: user.role, status: user.status },
            after: { role: updated.role, status: updated.status },
            source: 'SYSTEM',
            reason: 'SUPER_ADMIN update user',
          },
        });
      } catch (err) {
        this.logger.warn(
          `[SUPER_ADMIN] audit log failed for updateManagedUser: ${String(
            err,
          )}`,
        );
      }
    }

    return updated;
  }

  async deleteManagedUser(userId: string, actor: Actor) {
    this.requireSuper(actor);
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { id: true, role: true, organizationId: true },
    });
    if (!user) throw new NotFoundException('User not found');
    if (user.role === Role.SUPER_ADMIN) {
      throw new BadRequestException('Cannot delete SUPER_ADMIN user');
    }
    const deletedAt = new Date();
    const suffix = Date.now();
    await this.prisma.user.update({
      where: { id: userId },
      data: { deletedAt, email: `${userId}__deleted__${suffix}` },
    });

    const auditOrgId = user.organizationId ?? this.defaultOrgId;
    const auditUserId = actor?.actorId ?? actor?.id ?? null;
    if (auditOrgId && auditUserId) {
      try {
        await this.prisma.auditLog.create({
          data: {
            organizationId: auditOrgId,
            userId: auditUserId,
            action: AuditAction.SYSTEM_FLAG_UPDATE,
            entityType: 'User',
            entityId: user.id,
            before: { role: user.role },
            after: { deletedAt },
            source: 'SYSTEM',
            reason: 'SUPER_ADMIN soft delete user',
          },
        });
      } catch (err) {
        this.logger.warn(
          `[SUPER_ADMIN] audit log failed for deleteManagedUser: ${String(
            err,
          )}`,
        );
      }
    }

    return { ok: true };
  }

  async getUser(userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId },
      include: { organization: true },
    });
    if (!user) throw new NotFoundException('User not found');
    return { ...user, teams: [], tournaments: [], reports: [] };
  }

  async moveUserOrg(userId: string, dto: MoveUserOrgDto, actor: Actor) {
    const reason = await this.requireReason(
      dto.reason,
      'move user organization',
      actor,
    );
    if (dto.orgId === undefined || dto.orgId === '') {
      throw new BadRequestException('orgId is required');
    }
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
    });
    if (!user) throw new NotFoundException('User not found');
    const beforeOrgId = user.organizationId ?? null;
    if (dto.orgId !== null) {
      const org = await this.prisma.organization.findFirst({
        where: { id: dto.orgId, deletedAt: null },
      });
      if (!org) throw new NotFoundException('Organization not found');
    }
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { organizationId: dto.orgId },
    });
    const auditOrgId = dto.orgId ?? beforeOrgId;
    if (!auditOrgId) {
      throw new BadRequestException(
        'Cannot write audit log without organizationId. Provide orgId or ensure user had previous organizationId.',
      );
    }
    await this.prisma.auditLog.create({
      data: {
        action: AuditAction.USER_ROLE_CHANGE,
        entityType: 'USER',
        entityId: userId,
        userId: actor?.id,
        organizationId: auditOrgId,
        before: { organizationId: beforeOrgId },
        after: { organizationId: dto.orgId, reason },
        source: 'MANUAL',
      },
    });
    return updated;
  }

  async resetPassword(userId: string, dto: ResetPasswordDto, actor: Actor) {
    const reason = await this.requireReason(
      dto.reason,
      'reset password',
      actor,
    );
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
    });
    if (!user) throw new NotFoundException('User not found');
    const auditUserId =
      actor?.id &&
      (
        await this.prisma.user.findUnique({
          where: { id: actor.id },
          select: { id: true },
        })
      )?.id;

    const providedPassword = dto.newPassword?.trim();
    const nextPassword =
      providedPassword && providedPassword.length > 0
        ? providedPassword
        : `Temp-${randomBytes(4).toString('hex')}`;
    const hashed = await bcrypt.hash(nextPassword, 12);
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { password: hashed },
    });
    const orgId =
      user.organizationId ?? actor?.organizationId ?? this.requireOrgId(actor);
    if (auditUserId && orgId) {
      await this.prisma.auditLog.create({
        data: {
          action: AuditAction.USER_ROLE_CHANGE,
          entityType: 'USER',
          entityId: userId,
          userId: auditUserId,
          organizationId: orgId,
          before: { password: 'REDACTED' },
          after: {
            passwordReset: true,
            reason,
            passwordProvided: !!providedPassword,
          },
          source: 'MANUAL',
        },
      });
    }
    return {
      ok: true,
      tempPassword: providedPassword ? undefined : nextPassword,
      userId: updated.id,
    };
  }

  async softDeleteUser(userId: string, dto: ReasonDto, actor: Actor) {
    const reason = await this.requireReason(dto.reason, 'delete user', actor);
    const actorUserId = actor?.actorId ?? actor?.id;
    if (!actorUserId)
      throw new UnauthorizedException('Actor must have an id for auditing');
    const user = await this.prisma.user.findFirst({ where: { id: userId } });
    if (user?.email === env.SUPERADMIN_EMAIL) {
      throw new BadRequestException(
        'Primary super admin account cannot be deleted',
      );
    }
    if (!user || user.deletedAt) {
      // already deleted or missing should be treated as success for idempotency
      return { ok: true };
    }
    const orgId =
      user.organizationId ??
      actor?.organizationId ??
      actor?.actingOrgId ??
      this.requireOrgId(actor);
    const auditUserId = await this.resolveAuditUserId(actorUserId);
    const archivedEmail =
      user.email && user.email.length > 0
        ? `${user.email}__deleted__${Date.now()}`
        : undefined;
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        deletedAt: new Date(),
        deletedBy: actorUserId,
        email: archivedEmail ?? user.email,
      },
    });
    if (auditUserId) {
      try {
        await this.prisma.auditLog.create({
          data: {
            action: AuditAction.USER_UNBAN,
            entityType: 'USER',
            entityId: userId,
            userId: auditUserId,
            organizationId: orgId,
            before: { deletedAt: null, status: user.status, email: user.email },
            after: {
              deletedAt: updated.deletedAt,
              status: 'DELETED',
              emailArchivedAs: archivedEmail,
              reason,
            },
            source: 'MANUAL',
          },
        });
      } catch (err) {
        // Do not block deletion on audit log failures
        console.error('[SUPER_ADMIN] audit log failed for softDeleteUser', err);
      }
    } else {
      console.warn(
        '[SUPER_ADMIN] skipping audit log for softDeleteUser: actor user not found',
      );
    }
    if (user.organizationId) {
      await this.lockOrgIfNoAdmins(
        user.organizationId,
        reason,
        auditUserId ?? undefined,
      );
    }
    return { ok: true };
  }

  async restoreUser(userId: string, dto: ReasonDto, actor: Actor) {
    const reason = await this.requireReason(dto.reason, 'restore user', actor);
    const actorUserId = actor?.actorId ?? actor?.id;
    if (!actorUserId)
      throw new UnauthorizedException('Actor must have an id for auditing');
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: { not: null } },
    });
    if (!user) throw new NotFoundException('User not found or not deleted');
    const orgId =
      user.organizationId ??
      actor?.organizationId ??
      actor?.actingOrgId ??
      this.requireOrgId(actor);
    const restored = await this.prisma.user.update({
      where: { id: userId },
      data: {
        deletedAt: null,
        deletedBy: null,
        status: UserStatus.ACTIVE,
      },
    });
    await this.prisma.auditLog.create({
      data: {
        action: AuditAction.USER_UNBAN,
        entityType: 'USER',
        entityId: userId,
        userId: actorUserId,
        organizationId: orgId,
        before: {
          deletedAt: user.deletedAt,
          status: user.status,
        },
        after: { deletedAt: null, status: UserStatus.ACTIVE, reason },
        source: 'MANUAL',
      },
    });
    return restored;
  }

  async logUserAction(dto: LogUserActionDto, actor: Actor) {
    const ts = dto.timestamp ? new Date(dto.timestamp) : new Date();
    const auditUserId = actor?.id ?? dto.adminId;
    const orgId = dto.organizationId ?? actor?.organizationId;
    if (!auditUserId || !orgId) {
      // avoid FK violations if context is missing; this is best-effort logging
      return { ok: true };
    }
    try {
      await this.prisma.auditLog.create({
        data: {
          action: AuditAction.ADMIN_ADJUSTMENT,
          entityType: 'USER',
          entityId: dto.userEmail ?? 'unknown',
          userId: auditUserId,
          organizationId: orgId,
          before: {},
          after: {
            ...dto,
            loggedAt: ts,
          },
          source: 'MANUAL',
        },
      });
    } catch (err) {
      console.error('[SUPER_ADMIN] audit log failed for logUserAction', err);
    }
    return { ok: true };
  }

  private async lockOrgIfNoAdmins(
    orgId: string,
    reason: string | null,
    actorId?: string,
  ) {
    const adminCount = await this.prisma.user.count({
      where: { organizationId: orgId, role: Role.ADMIN, deletedAt: null },
    });
    if (adminCount > 0) return;
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
    });
    if (!org) return;
    const updated = await this.prisma.organization.update({
      where: { id: orgId },
      data: { status: OrganizationStatus.SUSPENDED },
    });
    const auditUserId = await this.resolveAuditUserId(actorId);
    if (auditUserId) {
      try {
        await this.prisma.auditLog.create({
          data: {
            action: AuditAction.ORGANIZER_SUSPEND,
            entityType: 'ORGANIZATION',
            entityId: orgId,
            userId: auditUserId,
            organizationId: orgId,
            before: { status: org.status },
            after: {
              status: updated.status,
              note: 'Locked due to no active admins',
              reason,
            },
            source: 'MANUAL',
          },
        });
      } catch (err) {
        console.error(
          '[SUPER_ADMIN] audit log failed for lockOrgIfNoAdmins',
          err,
        );
      }
    } else if (actorId) {
      console.warn(
        `[SUPER_ADMIN] skipping audit log for lockOrgIfNoAdmins: actor user ${actorId} not found`,
      );
    }
  }

  async impersonate(
    targetUserId: string,
    reason: string | undefined,
    actor: Actor,
  ) {
    const realActorId = actor?.actorId ?? actor?.id;
    const realActorRole = actor?.actorRole ?? actor?.role;
    const actorOrgId = actor?.actingOrgId ?? actor?.organizationId;
    const normalizedReason = await this.requireReason(
      reason,
      'impersonate user',
      {
        ...actor,
        role: realActorRole,
      },
    );
    const target = await this.prisma.user.findFirst({
      where: {
        id: targetUserId,
        deletedAt: null,
        status: UserStatus.ACTIVE,
      },
      select: {
        id: true,
        role: true,
        organizationId: true,
        email: true,
        name: true,
      },
    });
    if (!target) throw new NotFoundException('Target user not found');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    // Tenant safety: only impersonate into the target user's org.
    const actingOrgId = target.organizationId ?? null;
    if (!actingOrgId) {
      throw new BadRequestException(
        'Target user is not assigned to an organization; assign an org before impersonating',
      );
    }
    const impersonationToken = await this.jwt.signAsync(
      {
        sub: target.id,
        role: target.role,
        organizationId: target.organizationId,
        actorId: realActorId,
        actorRole: realActorRole,
        actingOrgId,
        actingRole: target.role,
        actingAsUserId: target.id,
        isImpersonating: true,
        impersonated: true,
        impersonatedBy: actor?.id ?? null,
        impersonationExpiresAt: expiresAt.toISOString(),
        email: target.email,
        name: target.name,
      },
      { expiresIn: '7d' },
    );
    const auditOrgId =
      actingOrgId ??
      actor.actingOrgId ??
      (
        await this.prisma.organization.findFirst({
          where: { deletedAt: null },
          select: { id: true },
        })
      )?.id;
    const auditUserId =
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
      )?.id ??
      target.id;
    const orgForAudit =
      auditOrgId ?? target.organizationId ?? actorOrgId ?? undefined;
    if (auditUserId && orgForAudit) {
      try {
        await this.prisma.auditLog.create({
          data: {
            action: AuditAction.IMPERSONATION,
            entityType: 'USER',
            entityId: target.id,
            userId: auditUserId,
            organizationId: orgForAudit,
            before: { action: 'start' },
            after: {
              action: 'start',
              targetUserId,
              reason: normalizedReason,
              expiresAt,
              impersonatedBy: realActorId,
              orgId: orgForAudit,
            },
            source: 'MANUAL',
          },
        });
      } catch (err) {
        // Do not block impersonation if audit logging fails due to missing org context.

        console.error('[SUPER_ADMIN] audit log failed for impersonate', err);
      }
    }
    return {
      token: impersonationToken,
      impersonation: {
        by: realActorId ?? actor.id,
        targetUserId,
        orgId: actingOrgId,
      },
    };
  }

  async endImpersonation(actor: Actor) {
    if (!actor?.isImpersonating) {
      throw new BadRequestException('Not currently impersonating');
    }
    const actorId = actor?.actorId ?? actor?.id;
    const targetId = actor?.actingAsUserId ?? actor?.id;
    const orgId = actor?.organizationId ?? actor?.actingOrgId ?? actorId;
    const auditUserId =
      actorId &&
      (
        await this.prisma.user.findUnique({
          where: { id: actorId },
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
    if (auditUserId && auditOrgIdFinal) {
      try {
        await this.prisma.auditLog.create({
          data: {
            action: AuditAction.IMPERSONATION,
            entityType: 'USER',
            entityId: targetId,
            userId: auditUserId,
            organizationId: auditOrgIdFinal,
            before: { action: 'stop' },
            after: { action: 'stop', targetUserId: targetId },
            source: 'MANUAL',
          },
        });
      } catch (err) {
        // Do not block exit on audit failure

        console.error(
          '[SUPER_ADMIN] audit log failed for endImpersonation',
          err,
        );
      }
    }
    return { ok: true, actorId, targetId };
  }

  async getTeam(teamId: string) {
    const team = await this.prisma.team.findUnique({
      where: { id: teamId, deletedAt: null },
      include: {
        organization: true,
        _count: { select: { players: true, tournamentTeams: true } },
        players: { where: { deletedAt: null } },
        tournamentTeams: { include: { tournament: true } },
      },
    });
    if (!team) throw new NotFoundException('Team not found');

    return {
      id: team.id,
      name: team.name,
      tag: team.tag,
      status:
        team.organization?.status === OrganizationStatus.SUSPENDED
          ? 'SUSPENDED'
          : 'ACTIVE',
      organization: team.organization
        ? {
            id: team.organization.id,
            name: team.organization.name,
            displayName: this.getOptionalStringField(
              team.organization,
              'displayName',
            ),
          }
        : undefined,
      playersCount: team._count?.players ?? 0,
      tournamentsCount: team._count?.tournamentTeams ?? 0,
      players: team.players?.map((p) => ({
        id: p.id,
        name: p.realName,
        ign: p.ign,
        email: this.getOptionalStringField(p, 'email'),
      })),
      tournaments:
        team.tournamentTeams?.map((tt) => ({
          id: tt.tournamentId,
          name: tt.tournament?.name,
          status: tt.tournament?.status,
        })) ?? [],
    };
  }

  async updateTeamStatus(
    teamId: string,
    dto: UpdateTeamStatusDto,
    actor: Actor,
  ) {
    const reason = await this.requireReason(
      dto.reason,
      'update team status',
      actor,
    );
    const team = await this.prisma.team.findUnique({
      where: { id: teamId, deletedAt: null },
      include: { organization: true },
    });
    if (!team) throw new NotFoundException('Team not found');
    await this.prisma.auditLog.create({
      data: {
        action: AuditAction.CONTENT_MODERATE,
        entityType: 'TEAM',
        entityId: teamId,
        userId: actor?.id,
        organizationId:
          team.organizationId ?? actor?.organizationId ?? actor?.id,
        before: {
          status:
            team.organization?.status === OrganizationStatus.SUSPENDED
              ? 'SUSPENDED'
              : 'ACTIVE',
        },
        after: { status: dto.status, reason },
        source: 'MANUAL',
      },
    });
    return { id: teamId, status: dto.status };
  }

  async removePlayerFromTeam(
    teamId: string,
    dto: RemovePlayerDto,
    actor: Actor,
  ) {
    const reason = await this.requireReason(
      dto.reason,
      'remove player from team',
      actor,
    );
    const player = await this.prisma.player.findUnique({
      where: { id: dto.playerId, deletedAt: null },
    });
    if (!player || player.teamId !== teamId) {
      throw new NotFoundException('Player not found on team');
    }
    const updated = await this.prisma.player.update({
      where: { id: dto.playerId },
      data: { teamId: null },
    });
    await this.prisma.auditLog.create({
      data: {
        action: AuditAction.CONTENT_MODERATE,
        entityType: 'TEAM',
        entityId: teamId,
        userId: actor?.id,
        organizationId: updated.organizationId,
        before: { playerId: dto.playerId },
        after: { playerIdRemoved: dto.playerId, reason },
        source: 'MANUAL',
      },
    });
    return { ok: true };
  }

  async forceLeaveTournament(
    teamId: string,
    dto: ForceLeaveTournamentDto,
    actor: Actor,
  ) {
    const reason = await this.requireReason(
      dto.reason,
      'remove team from tournament',
      actor,
    );
    const link = await this.prisma.tournamentTeam.findUnique({
      where: {
        tournamentId_teamId: { tournamentId: dto.tournamentId, teamId },
      },
      include: { tournament: true },
    });
    if (!link) throw new NotFoundException('Team not in tournament');
    const orgId =
      link.tournament?.organizationId ?? this.requireOrgId(actor ?? null);
    await this.prisma.tournamentTeam.update({
      where: { id: link.id },
      data: { deletedAt: new Date() },
    });
    if (actor?.id) {
      await this.prisma.auditLog.create({
        data: {
          action: AuditAction.TOURNAMENT_REMOVE_TEAM,
          entityType: 'TOURNAMENT',
          entityId: dto.tournamentId,
          userId: actor.id,
          organizationId: orgId,
          before: { linkId: link.id },
          after: { removed: true, reason },
          source: 'MANUAL',
        },
      });
    }
    return { ok: true };
  }

  private async shouldRequireReason(actor: Actor | null | undefined) {
    // Allow SUPER_ADMIN to proceed without a reason to avoid blocking critical actions
    if (actor?.role === Role.SUPER_ADMIN) return false;
    const flags = await this.ensureFlags();
    return !!flags.superAdminRequiresReason;
  }

  private async requireReason(
    reason: string | undefined,
    action: string,
    actor: Actor,
  ) {
    const needReason = await this.shouldRequireReason(actor);
    const trimmed = reason?.trim();
    if (!needReason) {
      return trimmed || null;
    }
    if (!trimmed) {
      throw new BadRequestException(`Reason is required to ${action}`);
    }
    return trimmed;
  }

  async suspendOrganizer(orgId: string, dto: ReasonDto, actor: Actor) {
    const reason = await this.requireReason(
      dto.reason,
      'suspend organizer',
      actor,
    );
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
    });
    if (!org) throw new NotFoundException('Organization not found');
    const updated = await this.prisma.organization.update({
      where: { id: orgId },
      data: { status: OrganizationStatus.SUSPENDED },
    });
    await this.prisma.auditLog.create({
      data: {
        action: AuditAction.ORGANIZER_SUSPEND,
        entityType: 'ORGANIZATION',
        entityId: orgId,
        userId: actor?.id,
        organizationId: orgId,
        before: org,
        after: { ...updated, reason },
        source: 'MANUAL',
      },
    });
    return updated;
  }

  async deleteOrganization(orgId: string, dto: ReasonDto, actor: Actor) {
    const reason = await this.requireReason(
      dto.reason,
      'delete organization',
      actor,
    );
    const actorUserId = actor?.actorId ?? actor?.id;
    if (!actorUserId) {
      throw new UnauthorizedException('Actor must have an id for auditing');
    }
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
    });
    if (!org || org.deletedAt) {
      return { ok: true };
    }

    const deleted = await this.prisma.organization.update({
      where: { id: orgId },
      data: {
        deletedAt: new Date(),
        deletedBy: actorUserId,
        status: OrganizationStatus.SUSPENDED,
      },
    });

    try {
      await this.prisma.auditLog.create({
        data: {
          action: AuditAction.ADMIN_ADJUSTMENT,
          entityType: 'ORGANIZATION',
          entityId: orgId,
          userId: actorUserId,
          organizationId: orgId,
          before: org,
          after: { ...deleted, reason, actorRole: actor?.role },
          source: 'MANUAL',
        },
      });
    } catch (err) {
      // Avoid blocking delete if audit logging fails (e.g., FK issues on actor)

      console.error('[SuperAdmin] audit log failed on deleteOrganization', err);
    }

    return { ok: true };
  }

  async listPayouts(status?: PayoutStatus) {
    return this.prisma.payout.findMany({
      where: status ? { status } : {},
      orderBy: { createdAt: 'desc' },
      include: {
        tournament: true,
        team: true,
        player: true,
        wallet: true,
      },
    });
  }

  async approvePayout(payoutId: string, actor: Actor) {
    const flags = await this.ensureFlags();
    if (flags.freezePayouts)
      throw new BadRequestException('Payouts are frozen');

    const payout = await this.prisma.payout.findUnique({
      where: { id: payoutId },
      include: { wallet: true },
    });
    if (!payout) throw new NotFoundException('Payout not found');
    if (payout.status !== PayoutStatus.PENDING) {
      throw new BadRequestException('Payout already processed');
    }

    const orgId = this.requireOrgId(actor);
    await this.prisma.$transaction(async (tx) => {
      await tx.payout.update({
        where: { id: payout.id },
        data: {
          status: PayoutStatus.APPROVED,
          approvedBy: actor.id,
          approvedAt: new Date(),
        },
      });

      if (payout.walletId) {
        await tx.wallet.update({
          where: { id: payout.walletId },
          data: { balance: { increment: payout.amount } },
        });
        await tx.walletTransaction.create({
          data: {
            walletId: payout.walletId,
            type: WalletTransactionType.CREDIT,
            amount: payout.amount,
            reason: `Payout ${payout.id} approved`,
            createdBy: actor.id,
          },
        });
      }

      await tx.auditLog.create({
        data: {
          action: AuditAction.PAYOUT_APPROVE,
          entityType: 'PAYOUT',
          entityId: payout.id,
          userId: actor.id,
          organizationId: orgId,
          before: payout,
          after: { ...payout, status: PayoutStatus.APPROVED },
          source: 'MANUAL',
        },
      });
    });

    return { id: payoutId, status: PayoutStatus.APPROVED };
  }

  async rejectPayout(payoutId: string, actor: Actor) {
    const payout = await this.prisma.payout.findUnique({
      where: { id: payoutId },
    });
    if (!payout) throw new NotFoundException('Payout not found');
    if (payout.status !== PayoutStatus.PENDING) {
      throw new BadRequestException('Payout already processed');
    }

    const orgId = this.requireOrgId(actor);
    await this.prisma.$transaction([
      this.prisma.payout.update({
        where: { id: payout.id },
        data: {
          status: PayoutStatus.REJECTED,
          approvedBy: actor.id,
          approvedAt: new Date(),
        },
      }),
      this.prisma.auditLog.create({
        data: {
          action: AuditAction.PAYOUT_REJECT,
          entityType: 'PAYOUT',
          entityId: payout.id,
          userId: actor.id,
          organizationId: orgId,
          before: payout,
          after: { ...payout, status: PayoutStatus.REJECTED },
          source: 'MANUAL',
        },
      }),
    ]);

    return { id: payoutId, status: PayoutStatus.REJECTED };
  }

  async adjustWallet(walletId: string, dto: AdjustWalletDto, actor: Actor) {
    const wallet = await this.prisma.wallet.findUnique({
      where: { id: walletId },
    });
    if (!wallet) throw new NotFoundException('Wallet not found');

    const orgId = this.requireOrgId(actor);
    const delta = dto.amount;
    const newBalance = Number(wallet.balance) + delta;

    await this.prisma.$transaction([
      this.prisma.wallet.update({
        where: { id: walletId },
        data: { balance: { increment: delta } },
      }),
      this.prisma.walletTransaction.create({
        data: {
          walletId,
          type: WalletTransactionType.ADJUSTMENT,
          amount: delta,
          reason: dto.reason,
          createdBy: actor.id,
        },
      }),
      this.prisma.auditLog.create({
        data: {
          action: AuditAction.WALLET_ADJUST,
          entityType: 'WALLET',
          entityId: walletId,
          userId: actor.id,
          organizationId: orgId,
          before: wallet,
          after: { ...wallet, balance: newBalance },
          source: 'MANUAL',
        },
      }),
    ]);

    return { id: walletId, delta };
  }

  async changeRole(userId: string, dto: ChangeRoleDto, actor: Actor) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    if (user.role === dto.role) return user;

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { role: dto.role },
    });

    await this.prisma.auditLog.create({
      data: {
        action: AuditAction.USER_ROLE_CHANGE,
        entityType: 'USER',
        entityId: userId,
        userId: actor.id,
        organizationId: this.requireOrgId(actor),
        before: user,
        after: updated,
        source: 'MANUAL',
      },
    });

    return updated;
  }

  async banUser(userId: string, dto: BanUserDto, actor: Actor) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const reason = await this.requireReason(dto.reason, 'ban user', actor);
    const bannedUntil = dto.durationDays
      ? new Date(Date.now() + dto.durationDays * 24 * 60 * 60 * 1000)
      : null;

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { status: UserStatus.BANNED, bannedUntil },
    });

    await this.prisma.ban.create({
      data: {
        targetUserId: userId,
        reason: reason ?? 'super-admin action',
        expiresAt: bannedUntil ?? undefined,
        createdBy: actor.id,
      },
    });

    const orgId =
      user.organizationId ??
      actor?.organizationId ??
      actor?.actingOrgId ??
      this.defaultOrgId ??
      null;
    if (orgId) {
      try {
        await this.prisma.auditLog.create({
          data: {
            action: AuditAction.USER_BAN,
            entityType: 'USER',
            entityId: userId,
            userId: actor.id,
            organizationId: orgId,
            before: user,
            after: { ...updated, reason },
            source: 'MANUAL',
          },
        });
      } catch (err) {
        this.logger.warn(
          `[SuperAdminService] auditLog USER_BAN skipped: ${err}`,
        );
      }
    }

    return updated;
  }

  async unbanUser(userId: string, actor: Actor) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { status: UserStatus.ACTIVE, bannedUntil: null },
    });

    const orgId =
      user.organizationId ??
      actor?.organizationId ??
      actor?.actingOrgId ??
      this.defaultOrgId ??
      null;
    if (orgId) {
      try {
        await this.prisma.auditLog.create({
          data: {
            action: AuditAction.USER_UNBAN,
            entityType: 'USER',
            entityId: userId,
            userId: actor.id,
            organizationId: orgId,
            before: user,
            after: updated,
            source: 'MANUAL',
          },
        });
      } catch (err) {
        this.logger.warn(
          `[SuperAdminService] auditLog USER_UNBAN skipped: ${err}`,
        );
      }
    }

    return updated;
  }

  async listReports(status?: ReportStatus) {
    return this.prisma.report.findMany({
      where: status ? { status } : {},
      orderBy: { createdAt: 'desc' },
      include: {
        reporter: true,
        targetPlayer: true,
        targetTeam: true,
      },
    });
  }

  async resolveReport(reportId: string, dto: ResolveReportDto, actor: Actor) {
    const report = await this.prisma.report.findUnique({
      where: { id: reportId },
    });
    if (!report) throw new NotFoundException('Report not found');

    const updated = await this.prisma.report.update({
      where: { id: reportId },
      data: {
        status: dto.status ?? ReportStatus.REVIEWED,
        resolutionNote: dto.note,
        resolvedBy: actor.id,
      },
    });

    await this.prisma.auditLog.create({
      data: {
        action: AuditAction.ADMIN_ADJUSTMENT,
        entityType: 'REPORT',
        entityId: reportId,
        userId: actor.id,
        organizationId: this.requireOrgId(actor),
        before: report,
        after: updated,
        source: 'MANUAL',
      },
    });

    return updated;
  }

  async broadcast(dto: BroadcastDto, actor: Actor) {
    const saved = await this.prisma.notification.create({
      data: {
        title: dto.title,
        body: dto.body,
        audience: dto.audience ?? NotificationAudience.ALL,
        sentBy: actor.id,
      },
    });

    await this.prisma.auditLog.create({
      data: {
        action: AuditAction.BROADCAST_SEND,
        entityType: 'NOTIFICATION',
        entityId: saved.id,
        userId: actor.id,
        organizationId: this.requireOrgId(actor),
        after: saved,
        source: 'MANUAL',
      },
    });

    return saved;
  }

  async audit(limit = 100) {
    const clamped = Math.min(Math.max(limit, 10), 500);
    return this.prisma.auditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: clamped,
    });
  }

  async getOrganizerFeatures(orgId: string) {
    const existing = await this.prisma.organizerFeature.findMany({
      where: { organizationId: orgId },
    });
    const map = new Map(existing.map((f) => [f.key, f.enabled]));
    return Object.values(FeatureKey).map((key) => ({
      key,
      enabled: map.get(key) ?? false,
    }));
  }

  async setOrganizerFeatures(
    orgId: string,
    features: { key: FeatureKey; enabled: boolean }[],
    actor: Actor,
  ) {
    const updatedBy = actor?.role === Role.SUPER_ADMIN ? undefined : actor?.id;

    await Promise.all(
      features.map((f) =>
        this.prisma.organizerFeature.upsert({
          where: { organizationId_key: { organizationId: orgId, key: f.key } },
          update: { enabled: f.enabled, updatedBy },
          create: {
            organizationId: orgId,
            key: f.key,
            enabled: f.enabled,
            updatedBy,
          },
        }),
      ),
    );

    if (actor?.id && actor?.organizationId) {
      await this.prisma.auditLog.create({
        data: {
          action: AuditAction.ADMIN_ADJUSTMENT,
          entityType: 'ORGANIZER_FEATURE',
          entityId: orgId,
          userId: actor.id,
          organizationId: this.requireOrgId(actor),
          before: undefined,
          after: { features },
          source: 'MANUAL',
        },
      });
    }

    return this.getOrganizerFeatures(orgId);
  }

  async applyPreset(orgId: string, preset: 'full' | 'minimal', actor: Actor) {
    const enableAll = preset === 'full';
    const features = Object.values(FeatureKey).map((key) => ({
      key,
      enabled: enableAll,
    }));
    return this.setOrganizerFeatures(orgId, features, actor);
  }
}
