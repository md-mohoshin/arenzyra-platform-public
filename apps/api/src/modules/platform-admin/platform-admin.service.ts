import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditAction, OrganizationStatus, Prisma, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../db/prisma.service';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { CreateUserDto } from './dto/create-user.dto';
import type { AuthUser } from '../../common/auth/auth.types';
import { UpdateOrganizationDto } from './dto/update-organization.dto';
import { DEFAULT_ORGANIZATION_BRANDING } from '../organization-branding/organization-branding.constants';
import { VisualAssetsService } from '../visual-assets/visual-assets.service';
import { OrganizationFeatureService } from '../organization-feature/organization-feature.service';
import { generateBroadcastKey } from '../../common/crypto/broadcast-key.util';

@Injectable()
export class PlatformAdminService {
  constructor(
    private prisma: PrismaService,
    private assets: VisualAssetsService,
    private readonly orgFeatures: OrganizationFeatureService,
  ) {}

  private slugify(input: string): string {
    return input
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)+/g, '')
      .replace(/-{2,}/g, '-');
  }

  // ---------- ORGS ----------
  async createOrg(dto: CreateOrganizationDto) {
    return this.createOrgInternal(dto);
  }

  private async createOrgInternal(dto: CreateOrganizationDto) {
    const slug =
      dto.slug?.trim() && dto.slug.length > 0
        ? dto.slug.trim()
        : this.slugify(dto.name);

    const ownerUserId = dto.ownerUserId ?? null;
    if (ownerUserId) {
      const owner = await this.prisma.user.findFirst({
        where: { id: ownerUserId, deletedAt: null },
        select: { id: true },
      });
      if (!owner) {
        throw new BadRequestException('ownerUserId is invalid');
      }
    }

    try {
      const organization = await this.prisma.$transaction(async (tx) => {
        const organization = await tx.organization.create({
          data: {
            name: dto.name,
            slug,
            isActive: true,
            broadcastKey: generateBroadcastKey(),
            ...(ownerUserId ? { owner: { connect: { id: ownerUserId } } } : {}),
          },
        });

        const { organizationId: _ignore, ...defaults } =
          DEFAULT_ORGANIZATION_BRANDING;
        void _ignore;
        await tx.organizationBranding.create({
          data: {
            organizationId: organization.id,
            ...defaults,
          },
        });

        return organization;
      });
      await this.assets.bootstrapDefaults(organization.id);
      await this.orgFeatures.seedDefaults(organization.id);
      return organization;
    } catch (err: unknown) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new BadRequestException('Organization name/slug must be unique');
      }
      throw err;
    }
  }

  async recreateOrg(dto: CreateOrganizationDto) {
    const slug =
      dto.slug?.trim() && dto.slug.length > 0
        ? dto.slug.trim()
        : this.slugify(dto.name);

    const existing = await this.prisma.organization.findFirst({
      where: { OR: [{ slug }, { name: dto.name }] },
    });

    if (existing) {
      const suffix = Date.now();
      await this.prisma.$transaction(async (tx) => {
        await tx.organization.update({
          where: { id: existing.id },
          data: {
            deletedAt: new Date(),
            isActive: false,
            slug: `${existing.slug}__replaced__${suffix}`,
            name: `${existing.name} (replaced ${suffix})`,
          },
        });
        await tx.user.updateMany({
          where: { organizationId: existing.id, deletedAt: null },
          data: { deletedAt: new Date() },
        });
      });
    }

    return this.createOrgInternal({ ...dto, slug });
  }

  async listOrgs(): Promise<
    Array<{
      id: string;
      name: string;
      slug: string;
      isActive: boolean;
      deletedAt: Date | null;
      ownerUserId: string | null;
      ownerEmail: string | null;
      adminsAssignedCount: number;
      adminIds: string[];
      createdAt: Date;
      updatedAt: Date;
    }>
  > {
    const orgs = await this.prisma.organization.findMany({
      where: {},
      orderBy: { createdAt: 'desc' },
      include: {
        adminLinks: { select: { adminId: true } },
        owner: { select: { id: true, email: true } },
      },
    });

    return orgs.map((o) => ({
      id: o.id,
      name: o.name,
      slug: o.slug,
      isActive: Boolean(o.isActive),
      deletedAt: o.deletedAt ?? null,
      ownerUserId: o.ownerUserId ? String(o.ownerUserId) : null,
      ownerEmail: o.owner?.email ?? null,
      adminsAssignedCount: o.adminLinks.length,
      adminIds: o.adminLinks.map((a) => a.adminId),
      createdAt: o.createdAt,
      updatedAt: o.updatedAt,
    }));
  }

  async updateOrg(orgId: string, dto: UpdateOrganizationDto) {
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
    });
    if (!org) throw new NotFoundException('Organization not found');

    const data: Prisma.OrganizationUpdateInput = {};
    if (dto.name) data.name = dto.name;
    if (dto.slug) data.slug = dto.slug;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (dto.ownerUserId !== undefined) {
      if (dto.ownerUserId === null) {
        data.owner = { disconnect: true };
      } else {
        const owner = await this.prisma.user.findFirst({
          where: { id: dto.ownerUserId, deletedAt: null },
          select: { id: true },
        });
        if (!owner) throw new BadRequestException('ownerUserId is invalid');
        data.owner = { connect: { id: dto.ownerUserId } };
      }
    }
    if (dto.slug === undefined && dto.name && !org.slug) {
      data.slug = this.slugify(dto.name);
    }

    try {
      return await this.prisma.organization.update({
        where: { id: orgId },
        data,
      });
    } catch (err: unknown) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new BadRequestException('Organization name/slug must be unique');
      }
      throw err;
    }
  }

  async softDeleteOrg(orgId: string) {
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
    });
    if (!org || org.deletedAt)
      throw new NotFoundException('Organization not found');

    // Soft delete org
    await this.prisma.organization.update({
      where: { id: orgId },
      data: { deletedAt: new Date(), isActive: false },
    });

    // Also soft delete its users (optional best practice)
    await this.prisma.user.updateMany({
      where: { organizationId: orgId, deletedAt: null },
      data: { deletedAt: new Date() },
    });

    return { ok: true };
  }

  async hardDeleteOrg(orgId: string) {
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
    });
    if (!org) throw new NotFoundException('Organization not found');

    // Instead of failing on FK constraints, free the slug and hide the org by marking deleted + renaming.
    const suffix = Date.now();
    await this.prisma.organization.update({
      where: { id: orgId },
      data: {
        slug: `${org.slug}__deleted__${suffix}`,
        name: `${org.name} (deleted ${suffix})`,
        deletedAt: new Date(),
        isActive: false,
      },
    });

    return { ok: true, deleted: true };
  }

  async restoreOrg(orgId: string) {
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
    });
    if (!org) throw new NotFoundException('Organization not found');

    await this.prisma.organization.update({
      where: { id: orgId },
      data: { deletedAt: null, deletedBy: null, isActive: true },
    });

    return { ok: true };
  }

  // ---------- USERS ----------
  async createUser(
    dto: CreateUserDto,
    actor?: Partial<AuthUser>,
  ): Promise<
    Prisma.UserGetPayload<{
      select: {
        id: true;
        email: true;
        name: true;
        role: true;
        organizationId: true;
        createdAt: true;
      };
    }>
  > {
    const organizationId = dto.organizationId ?? null;

    const attemptCreate = async () => {
      const hashed = await bcrypt.hash(dto.password, 12);

      const created = await this.prisma.user.create({
        data: {
          email: dto.email,
          password: hashed,
          name: dto.name,
          role: dto.role,
          organizationId: organizationId ?? null,
        },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          organizationId: true,
          createdAt: true,
        },
      });
      const auditOrgId =
        organizationId ?? actor?.organizationId ?? actor?.id ?? 'SYSTEM';
      if (dto.reason && actor?.id) {
        await this.prisma.auditLog.create({
          data: {
            action: AuditAction.USER_ROLE_CHANGE,
            entityType: 'USER',
            entityId: created.id,
            userId: actor.id,
            organizationId: auditOrgId,
            before: Prisma.JsonNull,
            after: {
              created: true,
              role: dto.role,
              organizationId,
              reason: dto.reason,
            },
            source: 'MANUAL',
          },
        });
      }
      return created;
    };

    try {
      return await attemptCreate();
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        const target = (err.meta as { target?: string[] })?.target;
        if (target?.includes('email')) {
          const existingDeleted = await this.prisma.user.findFirst({
            where: { email: dto.email, deletedAt: { not: null } },
            select: { id: true },
          });
          if (existingDeleted) {
            await this.prisma.user.update({
              where: { id: existingDeleted.id },
              data: { email: `${dto.email}__deleted__${Date.now()}` },
            });
            return await attemptCreate();
          }
          throw new BadRequestException('Email already in use');
        }
        if (target?.includes('Organization_slug_key')) {
          throw new BadRequestException(
            'Organization slug/name must be unique',
          );
        }
        throw new BadRequestException('Duplicate value');
      }
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2003'
      ) {
        throw new BadRequestException('Organization invalid');
      }

      throw new BadRequestException(
        err instanceof Error ? err.message : 'Failed to create user',
      );
    }
  }

  async listUsers() {
    return this.prisma.user.findMany({
      where: { deletedAt: null },
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
      orderBy: { createdAt: 'desc' },
    });
  }

  async softDeleteUser(userId: string) {
    const u = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!u || u.deletedAt) throw new NotFoundException('User not found');

    // Prevent deleting last SUPER_ADMIN (best practice)
    if (u.role === Role.SUPER_ADMIN) {
      const count = await this.prisma.user.count({
        where: { role: Role.SUPER_ADMIN, deletedAt: null },
      });
      if (count <= 1)
        throw new BadRequestException('Cannot delete the last SUPER_ADMIN');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { deletedAt: new Date() },
    });
    if (u.organizationId) {
      const adminCount = await this.prisma.user.count({
        where: {
          organizationId: u.organizationId,
          role: Role.ADMIN,
          deletedAt: null,
          id: { not: userId },
        },
      });
      if (adminCount === 0) {
        await this.prisma.organization.update({
          where: { id: u.organizationId },
          data: { status: OrganizationStatus.SUSPENDED },
        });
      }
    }
    return { ok: true };
  }

  async restoreUser(userId: string) {
    const u = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!u) throw new NotFoundException('User not found');
    await this.prisma.user.update({
      where: { id: userId },
      data: { deletedAt: null, deletedBy: null },
    });
    return { ok: true };
  }

  // ---------- ADMIN ASSIGNMENTS ----------
  async assignAdminToOrg(adminId: string, orgId: string) {
    const admin = await this.prisma.user.findUnique({ where: { id: adminId } });
    if (!admin || admin.deletedAt)
      throw new BadRequestException('User not found');
    if (admin.role !== Role.ADMIN && admin.role !== Role.ORGANIZER)
      throw new BadRequestException('User must be ADMIN or ORGANIZER');

    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
    });
    if (!org || org.deletedAt) throw new BadRequestException('Org not found');

    const link = await this.prisma.adminOrganizationLink.upsert({
      where: { adminId_organizationId: { adminId, organizationId: orgId } },
      update: {},
      create: { adminId, organizationId: orgId },
    });

    // Ensure organizers carry the assigned org on their user record for downstream auth/context.
    if (admin.role === Role.ORGANIZER && admin.organizationId !== orgId) {
      await this.prisma.user.update({
        where: { id: adminId },
        data: { organizationId: orgId },
      });
    }

    return link;
  }

  async unassignAdminFromOrg(adminId: string, orgId: string) {
    await this.prisma.adminOrganizationLink.delete({
      where: { adminId_organizationId: { adminId, organizationId: orgId } },
    });
    return { ok: true };
  }
}
