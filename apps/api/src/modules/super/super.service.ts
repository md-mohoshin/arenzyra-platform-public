import {
  AuditAction,
  LicenseStatus,
  LicenseType,
  KycStatus,
  Organization,
  OrganizationApplicationStatus,
  OrganizationStatus,
  Prisma,
  Role,
  UserStatus,
} from '@prisma/client';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthRequest } from '../../common/auth/auth.types';
import type { Actor } from '../../common/auth/jwt.strategy';
import { PrismaService } from '../../db/prisma.service';
import { DEFAULT_ORGANIZATION_BRANDING } from '../organization-branding/organization-branding.constants';
import { VisualAssetsService } from '../visual-assets/visual-assets.service';
import { OrganizationFeatureService } from '../organization-feature/organization-feature.service';
import { withOrgScope } from '../../common/org/org.util';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { UpdateOrgStatusDto } from './dto/update-org-status.dto';
import { UpdateOrgKycDto } from './dto/update-org-kyc.dto';
import { UpdateOrgOwnerDto } from './dto/update-org-owner.dto';
import { SuperBanUserDto } from './dto/ban-user.dto';
import { generateBroadcastKey } from '../../common/crypto/broadcast-key.util';
import { CreateLicenseDto } from './dto/create-license.dto';
import { UpdateLicenseDto } from './dto/update-license.dto';

type OrgWithOwner = Organization & {
  owner?: { id: string; email: string | null; name: string | null } | null;
};

type OrganizationLicense = {
  id: string;
  organizationId: string;
  licenseKey: string;
  type: LicenseType;
  status: LicenseStatus;
  maxObservers: number;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

type OrganizationWidgetApprovalRecord = {
  widgetKey: string;
  isApproved: boolean;
  approvedAt: Date | null;
  approvedBy: string | null;
  approvedByUser?: {
    id: string;
    name: string | null;
    email: string | null;
  } | null;
};

type OrganizationApplicationRecord = {
  id: string;
  name: string;
  email: string;
  applicantName: string;
  rejectionReason: string | null;
  status: OrganizationApplicationStatus;
  createdAt: Date;
  updatedAt: Date;
};

@Injectable()
export class SuperService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly assets: VisualAssetsService,
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

  private async uniqueSlug(
    name: string,
    requestedSlug: string | undefined,
    tx: Prisma.TransactionClient,
  ): Promise<string> {
    const base = this.slugify(
      (requestedSlug ?? '').trim().length > 0 ? (requestedSlug ?? '') : name,
    );
    const baseSlug = base || `org-${Date.now()}`;
    let candidate = baseSlug;
    let suffix = 2;
    // Loop until no conflict; keep suffix predictable (-2, -3, ...).
    // Prisma unique constraint includes soft-deleted rows, so check everything.
    while (
      await tx.organization.findFirst({
        where: { slug: candidate },
        select: { id: true },
      })
    ) {
      candidate = `${baseSlug}-${suffix}`;
      suffix += 1;
    }
    return candidate;
  }

  private mapOrg(org: OrgWithOwner) {
    return {
      id: org.id,
      name: org.name,
      slug: org.slug,
      status: org.status,
      kycStatus: org.kycStatus,
      widgetApprovalEnforced: org.widgetApprovalEnforced,
      ownerUserId: org.ownerUserId ?? null,
      ownerEmail: org.owner?.email ?? null,
      ownerName: org.owner?.name ?? null,
      createdAt: org.createdAt,
      updatedAt: org.updatedAt,
    };
  }

  private mapLicense(license: OrganizationLicense) {
    const now = Date.now();
    const expiresAt = license.expiresAt.getTime();

    return {
      id: license.id,
      organizationId: license.organizationId,
      licenseKey: license.licenseKey,
      type: license.type,
      status: license.status,
      maxObservers: license.maxObservers,
      expiresAt: license.expiresAt,
      createdAt: license.createdAt,
      updatedAt: license.updatedAt,
      valid: license.status === LicenseStatus.ACTIVE && expiresAt > now,
    };
  }

  private mapWidgetApproval(approval: OrganizationWidgetApprovalRecord) {
    return {
      widgetKey: approval.widgetKey,
      isApproved: approval.isApproved,
      approvedAt: approval.approvedAt?.toISOString() ?? null,
      approvedBy: approval.approvedBy ?? null,
      approvedByName: approval.approvedByUser?.name ?? null,
      approvedByEmail: approval.approvedByUser?.email ?? null,
    };
  }

  private mapApplication(application: OrganizationApplicationRecord) {
    return {
      id: application.id,
      name: application.name,
      email: application.email,
      applicantName: application.applicantName,
      rejectionReason: application.rejectionReason ?? null,
      status: application.status,
      createdAt: application.createdAt,
      updatedAt: application.updatedAt,
    };
  }

  private async createOrganizationRecord(
    params: {
      name: string;
      slug?: string;
      ownerUserId?: string | null;
      status?: OrganizationStatus;
      kycStatus?: KycStatus;
    },
    tx: Prisma.TransactionClient,
  ) {
    const created = await tx.organization.create({
      data: {
        name: params.name,
        slug: await this.uniqueSlug(params.name, params.slug, tx),
        status: params.status ?? OrganizationStatus.APPROVED,
        kycStatus: params.kycStatus ?? KycStatus.PENDING,
        isActive: true,
        broadcastKey: generateBroadcastKey(),
        ...(params.ownerUserId
          ? { owner: { connect: { id: params.ownerUserId } } }
          : {}),
      },
    });

    const { organizationId: _ignore, ...defaults } =
      DEFAULT_ORGANIZATION_BRANDING;
    void _ignore;
    await tx.organizationBranding.create({
      data: {
        organizationId: created.id,
        ...defaults,
      },
    });

    return created;
  }

  private async bootstrapOrganizationDefaults(organizationId: string) {
    await Promise.all([
      this.assets.bootstrapDefaults(organizationId),
      this.orgFeatures.seedDefaults(organizationId),
    ]);
  }

  private async requireOrganization(id: string) {
    const org = await this.prisma.organization.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, name: true },
    });
    if (!org) throw new NotFoundException('Organization not found');
    return org;
  }

  private validateOwnerCandidate(candidate: {
    role: Role;
    status: UserStatus;
  }) {
    if (candidate.status !== UserStatus.ACTIVE) {
      throw new BadRequestException(
        'ownerUserId must reference an active user',
      );
    }

    if (candidate.role === Role.SUPER_ADMIN) {
      throw new BadRequestException(
        'ownerUserId cannot reference a SUPER_ADMIN user',
      );
    }

    if (candidate.role !== Role.ADMIN && candidate.role !== Role.ORGANIZER) {
      throw new BadRequestException(
        'ownerUserId must reference an ADMIN or ORGANIZER user',
      );
    }
  }

  async listApplications() {
    const applications = await this.prisma.organizationApplication.findMany({
      orderBy: [{ createdAt: 'desc' }],
      select: {
        id: true,
        name: true,
        email: true,
        applicantName: true,
        rejectionReason: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return applications.map((application) => this.mapApplication(application));
  }

  async approveApplication(id: string, actor: Actor) {
    const result = await this.prisma
      .$transaction(async (tx) => {
        const claim = await tx.organizationApplication.updateMany({
          where: {
            id,
            status: OrganizationApplicationStatus.PENDING,
          },
          data: {
            status: OrganizationApplicationStatus.APPROVED,
            rejectionReason: null,
          },
        });

        if (claim.count === 0) {
          const existing = await tx.organizationApplication.findUnique({
            where: { id },
            select: { id: true, status: true },
          });

          if (!existing) {
            throw new NotFoundException('Application not found');
          }

          throw new BadRequestException(
            'Only pending applications can be approved',
          );
        }

        const application = await tx.organizationApplication.findUnique({
          where: { id },
          select: {
            id: true,
            name: true,
            email: true,
            applicantName: true,
            rejectionReason: true,
            passwordHash: true,
            status: true,
            createdAt: true,
            updatedAt: true,
          },
        });

        if (!application) {
          throw new NotFoundException('Application not found');
        }

        const [existingUser, existingOrganization] = await Promise.all([
          tx.user.findFirst({
            where: {
              email: { equals: application.email, mode: 'insensitive' },
              deletedAt: null,
            },
            select: { id: true },
          }),
          tx.organization.findFirst({
            where: { name: application.name, deletedAt: null },
            select: { id: true },
          }),
        ]);

        if (existingUser) {
          throw new BadRequestException('Application email is already in use');
        }
        if (existingOrganization) {
          throw new BadRequestException('Organization name is already in use');
        }

        const user = await tx.user.create({
          data: {
            email: application.email,
            password: application.passwordHash,
            name: application.applicantName,
            role: Role.ORGANIZER,
            status: UserStatus.ACTIVE,
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

        const organization = await this.createOrganizationRecord(
          {
            name: application.name,
            ownerUserId: user.id,
            status: OrganizationStatus.APPROVED,
            kycStatus: KycStatus.PENDING,
          },
          tx,
        );

        await tx.user.update({
          where: { id: user.id },
          data: { organizationId: organization.id },
        });

        await tx.auditLog.create({
          data: {
            action: AuditAction.ORGANIZATION_CREATE,
            entityType: 'ORGANIZATION',
            entityId: organization.id,
            organizationId: organization.id,
            userId: actor.id,
            before: Prisma.JsonNull,
            after: {
              name: organization.name,
              slug: organization.slug,
              ownerUserId: user.id,
              status: organization.status,
              applicationId: application.id,
            },
            source: 'SUPER',
            reason: 'organization application approved',
          },
        });

        return {
          application,
          organization,
          user: {
            ...user,
            organizationId: organization.id,
          },
        };
      })
      .catch((err) => {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002'
        ) {
          throw new BadRequestException(
            'Application cannot be approved because its email or organization is already in use',
          );
        }
        throw err;
      });

    await this.bootstrapOrganizationDefaults(result.organization.id);

    return {
      application: this.mapApplication(result.application),
      organization: this.mapOrg({
        ...result.organization,
        owner: {
          id: result.user.id,
          email: result.user.email,
          name: result.user.name,
        },
      } as OrgWithOwner),
      user: result.user,
    };
  }

  async rejectApplication(id: string, reason?: string) {
    const application = await this.prisma.organizationApplication.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        email: true,
        applicantName: true,
        rejectionReason: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!application) {
      throw new NotFoundException('Application not found');
    }
    if (application.status !== OrganizationApplicationStatus.PENDING) {
      throw new BadRequestException(
        'Only pending applications can be rejected',
      );
    }

    const rejected = await this.prisma.organizationApplication.update({
      where: { id },
      data: {
        status: OrganizationApplicationStatus.REJECTED,
        rejectionReason: reason ?? null,
      },
      select: {
        id: true,
        name: true,
        email: true,
        applicantName: true,
        rejectionReason: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return this.mapApplication(rejected);
  }

  async createOrganization(dto: CreateOrganizationDto, actor: Actor) {
    const ownerId = dto.ownerUserId ?? null;
    const owner =
      ownerId !== null
        ? await this.prisma.user.findFirst({
            where: { id: ownerId, deletedAt: null },
            select: {
              id: true,
              organizationId: true,
              status: true,
              role: true,
            },
          })
        : null;
    if (ownerId && !owner) {
      throw new BadRequestException('ownerUserId is invalid');
    }
    if (owner) {
      this.validateOwnerCandidate(owner);
    }

    const organization = await this.prisma
      .$transaction(async (tx) => {
        const created = await this.createOrganizationRecord(
          {
            name: dto.name,
            slug: dto.slug,
            ownerUserId: ownerId,
            status: OrganizationStatus.APPROVED,
            kycStatus: KycStatus.PENDING,
          },
          tx,
        );

        if (ownerId) {
          await tx.user.update({
            where: { id: ownerId },
            data: { organizationId: created.id },
          });
        }

        await tx.auditLog.create({
          data: {
            action: AuditAction.ORGANIZATION_CREATE,
            entityType: 'ORGANIZATION',
            entityId: created.id,
            organizationId: created.id,
            userId: actor.id,
            before: Prisma.JsonNull,
            after: {
              name: created.name,
              slug: created.slug,
              ownerUserId: ownerId ?? null,
              status: created.status,
            },
            source: 'SUPER',
            reason: dto.ownerUserId ? 'owner assigned on create' : undefined,
          },
        });

        return created;
      })
      .catch((err) => {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002'
        ) {
          throw new BadRequestException(
            'Organization name and slug must be unique',
          );
        }
        throw err;
      });

    // Bootstrap defaults that don't need to be inside the transaction.
    await this.bootstrapOrganizationDefaults(organization.id);

    const enriched = await this.prisma.organization.findUnique({
      where: { id: organization.id },
      include: { owner: { select: { id: true, email: true, name: true } } },
    });

    return this.mapOrg(enriched as OrgWithOwner);
  }

  async listOrganizations(
    req: AuthRequest,
    q?: string,
    page = 1,
    pageSize = 20,
  ) {
    const safePage = Math.max(1, Number(page) || 1);
    const safePageSize = Math.min(100, Math.max(1, Number(pageSize) || 20));

    const baseWhere: Prisma.OrganizationWhereInput = { deletedAt: null };
    const where = withOrgScope(baseWhere, req);
    if (q?.trim()) {
      const term = q.trim();
      where.OR = [
        { name: { contains: term, mode: 'insensitive' } },
        { slug: { contains: term, mode: 'insensitive' } },
      ];
    }

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.organization.count({ where }),
      this.prisma.organization.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (safePage - 1) * safePageSize,
        take: safePageSize,
        include: { owner: { select: { id: true, email: true, name: true } } },
      }),
    ]);

    return {
      data: rows.map((org) => this.mapOrg(org)),
      page: safePage,
      pageSize: safePageSize,
      total,
    };
  }

  async getOrganization(id: string) {
    const org = await this.prisma.organization.findFirst({
      where: { id, deletedAt: null },
      include: { owner: { select: { id: true, email: true, name: true } } },
    });
    if (!org) throw new NotFoundException('Organization not found');
    return this.mapOrg(org);
  }

  async listOrganizationLicenses(id: string) {
    await this.requireOrganization(id);
    const licenses = await this.prisma.license.findMany({
      where: { organizationId: id },
      orderBy: [{ createdAt: 'desc' }],
    });
    return licenses.map((license) => this.mapLicense(license));
  }

  async listOrganizationWidgetApprovals(id: string) {
    const org = await this.prisma.organization.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, slug: true, widgetApprovalEnforced: true },
    });
    if (!org) {
      throw new NotFoundException('Organization not found');
    }

    const approvals = await this.prisma.organizationWidgetApproval.findMany({
      where: { organizationId: id },
      orderBy: { widgetKey: 'asc' },
      select: {
        widgetKey: true,
        isApproved: true,
        approvedAt: true,
        approvedBy: true,
        approvedByUser: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    return {
      organizationId: org.id,
      organizationSlug: org.slug,
      enforced: org.widgetApprovalEnforced,
      approvals: approvals.map((approval) => this.mapWidgetApproval(approval)),
    };
  }

  async updateOrganizationWidgetApproval(
    id: string,
    widgetKey: string,
    isApproved: boolean,
    actor: Actor,
  ) {
    const org = await this.prisma.organization.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, widgetApprovalEnforced: true },
    });
    if (!org) {
      throw new NotFoundException('Organization not found');
    }

    const existing = await this.prisma.organizationWidgetApproval.findUnique({
      where: {
        organizationId_widgetKey: {
          organizationId: id,
          widgetKey,
        },
      },
      select: {
        widgetKey: true,
        isApproved: true,
        approvedAt: true,
        approvedBy: true,
      },
    });

    const updated = await this.prisma.organizationWidgetApproval.upsert({
      where: {
        organizationId_widgetKey: {
          organizationId: id,
          widgetKey,
        },
      },
      update: {
        isApproved,
        approvedAt: isApproved ? new Date() : null,
        approvedBy: isApproved ? actor.id : null,
      },
      create: {
        organizationId: id,
        widgetKey,
        isApproved,
        approvedAt: isApproved ? new Date() : null,
        approvedBy: isApproved ? actor.id : null,
      },
      select: {
        widgetKey: true,
        isApproved: true,
        approvedAt: true,
        approvedBy: true,
        approvedByUser: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    await this.prisma.auditLog.create({
      data: {
        action: AuditAction.ADMIN_ADJUSTMENT,
        entityType: 'ORGANIZATION_WIDGET_APPROVAL',
        entityId: `${id}:${widgetKey}`,
        organizationId: id,
        userId: actor.id,
        before: existing ?? Prisma.JsonNull,
        after: {
          widgetKey: updated.widgetKey,
          isApproved: updated.isApproved,
          approvedAt: updated.approvedAt,
          approvedBy: updated.approvedBy,
        },
        source: 'SUPER',
      },
    });

    return {
      organizationId: id,
      enforced: org.widgetApprovalEnforced,
      approval: this.mapWidgetApproval(updated),
    };
  }

  async updateOrganizationWidgetApprovalConfig(
    id: string,
    enforced: boolean,
    actor: Actor,
  ) {
    const org = await this.prisma.organization.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, widgetApprovalEnforced: true },
    });
    if (!org) {
      throw new NotFoundException('Organization not found');
    }

    const updated = await this.prisma.organization.update({
      where: { id },
      data: { widgetApprovalEnforced: enforced },
      select: { id: true, widgetApprovalEnforced: true },
    });

    await this.prisma.auditLog.create({
      data: {
        action: AuditAction.ADMIN_ADJUSTMENT,
        entityType: 'ORGANIZATION_WIDGET_APPROVAL_CONFIG',
        entityId: id,
        organizationId: id,
        userId: actor.id,
        before: { widgetApprovalEnforced: org.widgetApprovalEnforced },
        after: { widgetApprovalEnforced: updated.widgetApprovalEnforced },
        source: 'SUPER',
      },
    });

    return {
      organizationId: updated.id,
      enforced: updated.widgetApprovalEnforced,
    };
  }

  async createOrganizationLicense(
    id: string,
    dto: CreateLicenseDto,
    actor: Actor,
  ) {
    await this.requireOrganization(id);

    const expiresAt = new Date(dto.expiresAt);
    if (Number.isNaN(expiresAt.getTime())) {
      throw new BadRequestException('expiresAt must be a valid ISO date');
    }

    try {
      const created = await this.prisma.license.create({
        data: {
          organizationId: id,
          licenseKey: dto.licenseKey.trim(),
          type: dto.type,
          status: dto.status,
          maxObservers: dto.maxObservers,
          expiresAt,
        },
      });

      await this.prisma.auditLog.create({
        data: {
          action: AuditAction.SYSTEM_FLAG_UPDATE,
          entityType: 'LICENSE',
          entityId: created.id,
          organizationId: id,
          userId: actor.id,
          before: Prisma.JsonNull,
          after: {
            licenseKey: created.licenseKey,
            type: created.type,
            status: created.status,
            maxObservers: created.maxObservers,
            expiresAt: created.expiresAt,
          },
          source: 'SUPER',
          reason: 'license created',
        },
      });

      return this.mapLicense(created);
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new BadRequestException('licenseKey must be unique');
      }
      throw err;
    }
  }

  async updateOrganizationLicense(
    id: string,
    licenseId: string,
    dto: UpdateLicenseDto,
    actor: Actor,
  ) {
    await this.requireOrganization(id);

    const existing = await this.prisma.license.findFirst({
      where: { id: licenseId, organizationId: id },
    });
    if (!existing) {
      throw new NotFoundException('License not found');
    }

    const data: Prisma.LicenseUpdateInput = {};

    if (dto.licenseKey !== undefined) {
      data.licenseKey = dto.licenseKey.trim();
    }
    if (dto.type !== undefined) {
      data.type = dto.type;
    }
    if (dto.status !== undefined) {
      data.status = dto.status;
    }
    if (dto.maxObservers !== undefined) {
      data.maxObservers = dto.maxObservers;
    }
    if (dto.expiresAt !== undefined) {
      const expiresAt = new Date(dto.expiresAt);
      if (Number.isNaN(expiresAt.getTime())) {
        throw new BadRequestException('expiresAt must be a valid ISO date');
      }
      data.expiresAt = expiresAt;
    }

    if (!Object.keys(data).length) {
      return this.mapLicense(existing);
    }

    try {
      const updated = await this.prisma.license.update({
        where: { id: licenseId },
        data,
      });

      await this.prisma.auditLog.create({
        data: {
          action: AuditAction.SYSTEM_FLAG_UPDATE,
          entityType: 'LICENSE',
          entityId: updated.id,
          organizationId: id,
          userId: actor.id,
          before: {
            licenseKey: existing.licenseKey,
            type: existing.type,
            status: existing.status,
            maxObservers: existing.maxObservers,
            expiresAt: existing.expiresAt,
          },
          after: {
            licenseKey: updated.licenseKey,
            type: updated.type,
            status: updated.status,
            maxObservers: updated.maxObservers,
            expiresAt: updated.expiresAt,
          },
          source: 'SUPER',
          reason: 'license updated',
        },
      });

      return this.mapLicense(updated);
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new BadRequestException('licenseKey must be unique');
      }
      throw err;
    }
  }

  async updateOrganizationStatus(
    id: string,
    dto: UpdateOrgStatusDto,
    actor: Actor,
  ) {
    const org = await this.prisma.organization.findFirst({
      where: { id, deletedAt: null },
    });
    if (!org) throw new NotFoundException('Organization not found');

    const updated = await this.prisma.organization.update({
      where: { id },
      data: {
        status: dto.status,
        isActive: dto.status !== OrganizationStatus.SUSPENDED,
      },
      include: { owner: { select: { id: true, email: true, name: true } } },
    });

    await this.prisma.auditLog.create({
      data: {
        action: AuditAction.ORGANIZATION_STATUS_CHANGE,
        entityType: 'ORGANIZATION',
        entityId: id,
        organizationId: id,
        userId: actor.id,
        before: {
          status: org.status,
          isActive: org.isActive,
        },
        after: {
          status: updated.status,
          isActive: updated.isActive,
        },
        source: 'SUPER',
      },
    });

    return this.mapOrg(updated as OrgWithOwner);
  }

  async updateOrganizationKyc(id: string, dto: UpdateOrgKycDto, actor: Actor) {
    const org = await this.prisma.organization.findFirst({
      where: { id, deletedAt: null },
    });
    if (!org) throw new NotFoundException('Organization not found');

    const updated = await this.prisma.organization.update({
      where: { id },
      data: {
        kycStatus: dto.kycStatus,
        kycNote: dto.note ?? null,
        kycReviewedAt: new Date(),
        kycReviewedBy: actor.id,
      },
      include: { owner: { select: { id: true, email: true, name: true } } },
    });

    await this.prisma.auditLog.create({
      data: {
        action: AuditAction.ORGANIZATION_KYC_UPDATE,
        entityType: 'ORGANIZATION',
        entityId: id,
        organizationId: id,
        userId: actor.id,
        before: {
          kycStatus: org.kycStatus,
          kycNote: org.kycNote,
        },
        after: {
          kycStatus: updated.kycStatus,
          kycNote: updated.kycNote,
        },
        source: 'SUPER',
      },
    });

    return this.mapOrg(updated as OrgWithOwner);
  }

  async updateOrganizationOwner(
    id: string,
    dto: UpdateOrgOwnerDto,
    actor: Actor,
  ) {
    const org = await this.prisma.organization.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, ownerUserId: true },
    });
    if (!org) throw new NotFoundException('Organization not found');

    const ownerId =
      dto.ownerUserId === null
        ? null
        : dto.ownerUserId && dto.ownerUserId.trim().length > 0
          ? dto.ownerUserId.trim()
          : null;

    let ownerRecord: {
      id: string;
      organizationId: string | null;
      role: Role;
      status: UserStatus;
    } | null = null;
    if (ownerId) {
      ownerRecord = await this.prisma.user.findFirst({
        where: { id: ownerId, deletedAt: null },
        select: {
          id: true,
          organizationId: true,
          role: true,
          status: true,
        },
      });
      if (!ownerRecord) {
        throw new BadRequestException('ownerUserId is invalid');
      }
      this.validateOwnerCandidate(ownerRecord);
    }

    const updated = await this.prisma.organization.update({
      where: { id },
      data: {
        owner:
          ownerId === null
            ? { disconnect: true }
            : ownerId
              ? { connect: { id: ownerId } }
              : undefined,
      },
      include: { owner: { select: { id: true, email: true, name: true } } },
    });

    if (ownerRecord && ownerRecord.organizationId !== id) {
      await this.prisma.user.update({
        where: { id: ownerRecord.id },
        data: { organizationId: id },
      });
    }

    await this.prisma.auditLog.create({
      data: {
        action: AuditAction.ORGANIZATION_OWNER_UPDATE,
        entityType: 'ORGANIZATION',
        entityId: id,
        organizationId: id,
        userId: actor.id,
        before: { ownerUserId: org.ownerUserId ?? null },
        after: { ownerUserId: updated.ownerUserId ?? null },
        source: 'SUPER',
      },
    });

    return this.mapOrg(updated as OrgWithOwner);
  }

  async banUser(userId: string, dto: SuperBanUserDto, actor: Actor) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: {
        id: true,
        status: true,
        bannedUntil: true,
        organizationId: true,
      },
    });
    if (!user) throw new NotFoundException('User not found');

    const bannedUntil =
      dto.bannedUntil === undefined || dto.bannedUntil === null
        ? null
        : new Date(dto.bannedUntil);

    if (Number.isNaN(bannedUntil?.getTime())) {
      throw new BadRequestException('bannedUntil must be a valid ISO date');
    }

    const nextStatus =
      bannedUntil === null ? UserStatus.ACTIVE : UserStatus.BANNED;

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { bannedUntil, status: nextStatus },
      select: {
        id: true,
        status: true,
        bannedUntil: true,
        organizationId: true,
      },
    });

    await this.prisma.auditLog.create({
      data: {
        action:
          nextStatus === UserStatus.BANNED
            ? AuditAction.USER_BAN
            : AuditAction.USER_UNBAN,
        entityType: 'USER',
        entityId: userId,
        organizationId:
          updated.organizationId ?? actor.organizationId ?? 'SYSTEM',
        userId: actor.id,
        before: { status: user.status, bannedUntil: user.bannedUntil },
        after: { status: updated.status, bannedUntil: updated.bannedUntil },
        source: 'SUPER',
        reason: dto.reason ?? undefined,
      },
    });

    return {
      id: updated.id,
      status: updated.status,
      bannedUntil: updated.bannedUntil,
    };
  }
}
