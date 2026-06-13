import { BadRequestException } from '@nestjs/common';
import {
  KycStatus,
  OrganizerAccessMode,
  OrganizationApplicationStatus,
  OrganizationStatus,
  OrganizationSubscriptionStatus,
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
        count: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        updateMany: jest.fn(),
        update: jest.fn(),
      },
      user: {
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      organization: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
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
      subscriptionStatus: OrganizationSubscriptionStatus.TRIALING,
      trialStartedAt: new Date('2026-03-24T10:02:00.000Z'),
      trialEndsAt: new Date('2026-03-31T10:02:00.000Z'),
      paidUntil: null,
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
          subscriptionStatus: OrganizationSubscriptionStatus.TRIALING,
          trialStartedAt: expect.any(Date),
          trialEndsAt: expect.any(Date),
          paidUntil: null,
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
    expect(result.organization.subscriptionStatus).toBe(
      OrganizationSubscriptionStatus.TRIALING,
    );
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

  it('creates an organization with selected status, kyc, and access mode', async () => {
    const prisma = mockPrisma();
    const assets = mockAssets();
    const orgFeatures = mockOrgFeatures();

    prisma.organization.findFirst.mockResolvedValue(null);
    prisma.organization.create.mockResolvedValue({
      id: 'org-1',
      name: 'Discord League',
      slug: 'discord-league',
      status: OrganizationStatus.SUSPENDED,
      kycStatus: KycStatus.REJECTED,
      accessMode: OrganizerAccessMode.DISCORD_ONLY,
      widgetApprovalEnforced: false,
      ownerUserId: null,
      createdAt: new Date('2026-05-07T10:00:00.000Z'),
      updatedAt: new Date('2026-05-07T10:00:00.000Z'),
    });
    prisma.organization.findUnique.mockResolvedValue({
      id: 'org-1',
      name: 'Discord League',
      slug: 'discord-league',
      status: OrganizationStatus.SUSPENDED,
      kycStatus: KycStatus.REJECTED,
      accessMode: OrganizerAccessMode.DISCORD_ONLY,
      widgetApprovalEnforced: false,
      ownerUserId: null,
      owner: null,
      createdAt: new Date('2026-05-07T10:00:00.000Z'),
      updatedAt: new Date('2026-05-07T10:00:00.000Z'),
    });

    const service = new SuperService(
      prisma as unknown as PrismaService,
      assets as unknown as VisualAssetsService,
      orgFeatures as unknown as OrganizationFeatureService,
    );

    const result = await service.createOrganization(
      {
        name: 'Discord League',
        accessMode: 'DISCORD_ONLY',
        status: OrganizationStatus.SUSPENDED,
        kycStatus: KycStatus.REJECTED,
      },
      actor,
    );

    expect(prisma.organization.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: OrganizationStatus.SUSPENDED,
          kycStatus: KycStatus.REJECTED,
          accessMode: OrganizerAccessMode.DISCORD_ONLY,
        }),
      }),
    );
    expect(result.accessMode).toBe(OrganizerAccessMode.DISCORD_ONLY);
    expect(result.status).toBe(OrganizationStatus.SUSPENDED);
    expect(result.kycStatus).toBe(KycStatus.REJECTED);
  });

  it('updates organization access mode and assigned user access mode together', async () => {
    const prisma = mockPrisma();
    prisma.organization.findFirst.mockResolvedValue({
      id: 'org-1',
      name: 'Fix Esports',
      accessMode: OrganizerAccessMode.FULL_PRODUCTION,
      deletedAt: null,
    });
    prisma.organization.update.mockResolvedValue({
      id: 'org-1',
      name: 'Fix Esports',
      slug: 'fix-esports',
      status: OrganizationStatus.APPROVED,
      kycStatus: KycStatus.APPROVED,
      accessMode: OrganizerAccessMode.DISCORD_ONLY,
      widgetApprovalEnforced: false,
      ownerUserId: null,
      owner: null,
      createdAt: new Date('2026-05-07T10:00:00.000Z'),
      updatedAt: new Date('2026-05-07T10:10:00.000Z'),
    });
    prisma.user.updateMany.mockResolvedValue({ count: 2 });

    const service = new SuperService(
      prisma as unknown as PrismaService,
      mockAssets() as unknown as VisualAssetsService,
      mockOrgFeatures() as unknown as OrganizationFeatureService,
    );

    const result = await service.updateOrganizationAccessMode(
      'org-1',
      { accessMode: OrganizerAccessMode.DISCORD_ONLY },
      actor,
    );

    expect(prisma.organization.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'org-1' },
        data: { accessMode: OrganizerAccessMode.DISCORD_ONLY },
      }),
    );
    expect(prisma.user.updateMany).toHaveBeenCalledWith({
      where: {
        organizationId: 'org-1',
        deletedAt: null,
        role: { in: [Role.ADMIN, Role.ORGANIZER] },
      },
      data: { organizerAccessMode: OrganizerAccessMode.DISCORD_ONLY },
    });
    expect(result.accessMode).toBe(OrganizerAccessMode.DISCORD_ONLY);
  });

  it('activates an organization subscription after payment', async () => {
    const prisma = mockPrisma();
    const existing = {
      id: 'org-1',
      name: 'Fix Esports',
      slug: 'fix-esports',
      status: OrganizationStatus.APPROVED,
      isActive: true,
      subscriptionStatus: OrganizationSubscriptionStatus.TRIALING,
      trialStartedAt: new Date('2026-05-01T10:00:00.000Z'),
      trialEndsAt: new Date('2026-05-08T10:00:00.000Z'),
      paidUntil: null,
      deletedAt: null,
    };

    prisma.organization.findFirst.mockResolvedValue(existing);
    prisma.organization.update.mockResolvedValue({
      ...existing,
      subscriptionStatus: OrganizationSubscriptionStatus.ACTIVE,
      paidUntil: new Date('2026-06-16T00:00:00.000Z'),
      owner: null,
      kycStatus: KycStatus.PENDING,
      accessMode: OrganizerAccessMode.FULL_PRODUCTION,
      widgetApprovalEnforced: false,
      ownerUserId: null,
      createdAt: new Date('2026-05-01T10:00:00.000Z'),
      updatedAt: new Date('2026-05-16T00:00:00.000Z'),
    });

    const service = new SuperService(
      prisma as unknown as PrismaService,
      mockAssets() as unknown as VisualAssetsService,
      mockOrgFeatures() as unknown as OrganizationFeatureService,
    );

    const result = await service.updateOrganizationSubscription(
      'org-1',
      {
        subscriptionStatus: OrganizationSubscriptionStatus.ACTIVE,
        paidUntil: '2026-06-16T00:00:00.000Z',
      },
      actor,
    );

    expect(prisma.organization.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'org-1' },
        data: expect.objectContaining({
          subscriptionStatus: OrganizationSubscriptionStatus.ACTIVE,
          status: OrganizationStatus.APPROVED,
          isActive: true,
          paidUntil: new Date('2026-06-16T00:00:00.000Z'),
        }),
      }),
    );
    expect(result.subscriptionStatus).toBe(
      OrganizationSubscriptionStatus.ACTIVE,
    );
  });

  it('marks an organization subscription as expired', async () => {
    const prisma = mockPrisma();
    const existing = {
      id: 'org-1',
      name: 'Fix Esports',
      slug: 'fix-esports',
      status: OrganizationStatus.APPROVED,
      isActive: true,
      subscriptionStatus: OrganizationSubscriptionStatus.TRIALING,
      trialStartedAt: new Date('2026-05-01T10:00:00.000Z'),
      trialEndsAt: new Date('2026-05-08T10:00:00.000Z'),
      paidUntil: null,
      deletedAt: null,
    };

    prisma.organization.findFirst.mockResolvedValue(existing);
    prisma.organization.update.mockResolvedValue({
      ...existing,
      subscriptionStatus: OrganizationSubscriptionStatus.EXPIRED,
      paidUntil: null,
      owner: null,
      kycStatus: KycStatus.PENDING,
      accessMode: OrganizerAccessMode.FULL_PRODUCTION,
      widgetApprovalEnforced: false,
      ownerUserId: null,
      createdAt: new Date('2026-05-01T10:00:00.000Z'),
      updatedAt: new Date('2026-05-16T00:00:00.000Z'),
    });

    const service = new SuperService(
      prisma as unknown as PrismaService,
      mockAssets() as unknown as VisualAssetsService,
      mockOrgFeatures() as unknown as OrganizationFeatureService,
    );

    const result = await service.updateOrganizationSubscription(
      'org-1',
      { subscriptionStatus: OrganizationSubscriptionStatus.EXPIRED },
      actor,
    );

    expect(prisma.organization.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'org-1' },
        data: expect.objectContaining({
          subscriptionStatus: OrganizationSubscriptionStatus.EXPIRED,
          paidUntil: null,
        }),
      }),
    );
    expect(result.subscriptionStatus).toBe(
      OrganizationSubscriptionStatus.EXPIRED,
    );
  });
});
