import { BadRequestException } from '@nestjs/common';
import {
  KycStatus,
  OrganizationApplicationStatus,
  OrganizationStatus,
  Role,
  UserStatus,
} from '@prisma/client';
import type { PrismaService } from '../../db/prisma.service';
import type { VisualAssetsService } from '../visual-assets/visual-assets.service';
import type { OrganizationFeatureService } from '../organization-feature/organization-feature.service';
import { SuperService } from './super.service';

describe('SuperService', () => {
  const actor = {
    id: 'super-1',
    role: Role.SUPER_ADMIN,
    organizationId: null,
    orgId: null,
    actorId: null,
    actorRole: Role.SUPER_ADMIN,
    actingOrgId: null,
    actingRole: null,
    actingOrgName: null,
    actingAsUserId: null,
    realRole: Role.SUPER_ADMIN,
  };

  const mockPrisma = () => {
    const prisma = {
      $transaction: jest.fn(),
      organizationApplication: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        updateMany: jest.fn(),
        update: jest.fn(),
      },
      user: {
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      organization: {
        findFirst: jest.fn(),
        create: jest.fn(),
      },
      organizationBranding: {
        create: jest.fn(),
      },
      auditLog: {
        create: jest.fn(),
      },
    };

    prisma.$transaction.mockImplementation(async (callback) =>
      callback(prisma),
    );

    return prisma;
  };

  const mockAssets = () =>
    ({
      bootstrapDefaults: jest.fn().mockResolvedValue(undefined),
    }) satisfies Pick<VisualAssetsService, 'bootstrapDefaults'>;

  const mockOrgFeatures = () =>
    ({
      seedDefaults: jest.fn().mockResolvedValue(undefined),
    }) satisfies Pick<OrganizationFeatureService, 'seedDefaults'>;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('approves a pending application by provisioning the user and organization', async () => {
    const prisma = mockPrisma();
    const assets = mockAssets();
    const orgFeatures = mockOrgFeatures();

    prisma.organizationApplication.findUnique.mockResolvedValue({
      id: 'app-1',
      name: 'Acme Events',
      email: 'owner@example.com',
      applicantName: 'Owner',
      rejectionReason: null,
      passwordHash: 'hashed-pass',
      status: OrganizationApplicationStatus.APPROVED,
      createdAt: new Date('2026-03-24T10:00:00.000Z'),
      updatedAt: new Date('2026-03-24T10:00:00.000Z'),
    });
    prisma.organizationApplication.updateMany.mockResolvedValue({ count: 1 });
    prisma.user.findFirst.mockResolvedValue(null);
    prisma.organization.findFirst.mockImplementation(async (args) => {
      if (args.where?.name === 'Acme Events') {
        return null;
      }
      if (args.where?.slug === 'acme-events') {
        return null;
      }
      return null;
    });
    prisma.user.create.mockResolvedValue({
      id: 'user-1',
      email: 'owner@example.com',
      name: 'Owner',
      role: Role.ORGANIZER,
      organizationId: null,
      createdAt: new Date('2026-03-24T10:01:00.000Z'),
    });
    prisma.organization.create.mockResolvedValue({
      id: 'org-1',
      name: 'Acme Events',
      slug: 'acme-events',
      status: OrganizationStatus.APPROVED,
      kycStatus: KycStatus.PENDING,
      widgetApprovalEnforced: false,
      ownerUserId: 'user-1',
      createdAt: new Date('2026-03-24T10:02:00.000Z'),
      updatedAt: new Date('2026-03-24T10:02:00.000Z'),
    });

    const service = new SuperService(
      prisma as unknown as PrismaService,
      assets as unknown as VisualAssetsService,
      orgFeatures as unknown as OrganizationFeatureService,
    );

    const result = await service.approveApplication('app-1', actor);

    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          email: 'owner@example.com',
          password: 'hashed-pass',
          role: Role.ORGANIZER,
          status: UserStatus.ACTIVE,
        }),
      }),
    );
    expect(prisma.organization.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: 'Acme Events',
        }),
      }),
    );
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { organizationId: 'org-1' },
    });
    expect(prisma.organizationApplication.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'app-1',
          status: OrganizationApplicationStatus.PENDING,
        },
        data: {
          status: OrganizationApplicationStatus.APPROVED,
          rejectionReason: null,
        },
      }),
    );
    expect(assets.bootstrapDefaults).toHaveBeenCalledWith('org-1');
    expect(orgFeatures.seedDefaults).toHaveBeenCalledWith('org-1');
    expect(result.application.status).toBe(
      OrganizationApplicationStatus.APPROVED,
    );
    expect(result.organization.ownerUserId).toBe('user-1');
    expect(result.user.organizationId).toBe('org-1');
  });

  it('rejects approval when the application is no longer pending', async () => {
    const prisma = mockPrisma();
    prisma.organizationApplication.updateMany.mockResolvedValue({ count: 0 });
    prisma.organizationApplication.findUnique.mockResolvedValue({
      id: 'app-1',
      status: OrganizationApplicationStatus.APPROVED,
    });

    const service = new SuperService(
      prisma as unknown as PrismaService,
      mockAssets() as unknown as VisualAssetsService,
      mockOrgFeatures() as unknown as OrganizationFeatureService,
    );

    try {
      await service.approveApplication('app-1', actor);
      throw new Error('Expected approveApplication to reject');
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).message).toBe(
        'Only pending applications can be approved',
      );
    }

    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(prisma.organization.create).not.toHaveBeenCalled();
  });

  it('rejects a pending application', async () => {
    const prisma = mockPrisma();
    const service = new SuperService(
      prisma as unknown as PrismaService,
      mockAssets() as unknown as VisualAssetsService,
      mockOrgFeatures() as unknown as OrganizationFeatureService,
    );

    prisma.organizationApplication.findUnique.mockResolvedValue({
      id: 'app-1',
      name: 'Acme Events',
      email: 'owner@example.com',
      applicantName: 'Owner',
      rejectionReason: null,
      status: OrganizationApplicationStatus.PENDING,
      createdAt: new Date('2026-03-24T10:00:00.000Z'),
      updatedAt: new Date('2026-03-24T10:00:00.000Z'),
    });
    prisma.organizationApplication.update.mockResolvedValue({
      id: 'app-1',
      name: 'Acme Events',
      email: 'owner@example.com',
      applicantName: 'Owner',
      rejectionReason: 'Missing verification details',
      status: OrganizationApplicationStatus.REJECTED,
      createdAt: new Date('2026-03-24T10:00:00.000Z'),
      updatedAt: new Date('2026-03-24T10:05:00.000Z'),
    });

    const result = await service.rejectApplication(
      'app-1',
      'Missing verification details',
    );

    expect(prisma.organizationApplication.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'app-1' },
        data: {
          status: OrganizationApplicationStatus.REJECTED,
          rejectionReason: 'Missing verification details',
        },
      }),
    );
    expect(result.status).toBe(OrganizationApplicationStatus.REJECTED);
    expect(result.rejectionReason).toBe('Missing verification details');
  });
});
