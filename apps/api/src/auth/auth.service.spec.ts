import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  OrganizerAccessMode,
  OrganizationStatus,
  OrganizationSubscriptionStatus,
  Role,
  UserStatus,
} from '@prisma/client';
import type { User } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { createHash } from 'crypto';
import type { PrismaService } from '../db/prisma.service';
import type { AuditService } from '../modules/audit/audit.service';
import { AuthService } from './auth.service';

const jwt = new JwtService({ secret: 'test-secret' });

const baseUser: User = {
  id: 'user-1',
  email: 'test@example.com',
  password: 'hashed',
  name: 'Test User',
  role: Role.ORGANIZER,
  organizationId: 'org-1',
  createdAt: new Date(),
  updatedAt: new Date(),
  status: UserStatus.ACTIVE,
  deletedAt: null,
  deletedBy: null,
  bannedUntil: null,
};

const activeOrg = (
  overrides: Partial<{
    id: string;
    name: string | null;
    accessMode: OrganizerAccessMode;
    isActive: boolean;
    status: OrganizationStatus;
    subscriptionStatus: OrganizationSubscriptionStatus;
    trialStartedAt: Date | null;
    trialEndsAt: Date | null;
    paidUntil: Date | null;
  }> = {},
) => ({
  id: 'org-1',
  name: 'Org',
  accessMode: OrganizerAccessMode.FULL_PRODUCTION,
  isActive: true,
  status: OrganizationStatus.APPROVED,
  subscriptionStatus: OrganizationSubscriptionStatus.ACTIVE,
  trialStartedAt: null,
  trialEndsAt: null,
  paidUntil: null,
  ...overrides,
});

const mockPrisma = () => ({
  refreshToken: {
    create: jest.fn().mockResolvedValue(null),
    findUnique: jest.fn(),
    update: jest.fn().mockResolvedValue(null),
    updateMany: jest.fn().mockResolvedValue(null),
  },
  adminOrganizationLink: {
    findMany: jest.fn().mockResolvedValue([]),
  },
  user: {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    create: jest.fn(),
    upsert: jest.fn(),
  },
  organization: {
    findFirst: jest.fn(),
    findMany: jest.fn().mockResolvedValue([]),
  },
  organizationApplication: {
    findFirst: jest.fn(),
    create: jest.fn(),
  },
});

const mockAudit: Pick<AuditService, 'log'> = {
  log: jest.fn().mockResolvedValue(undefined),
};

describe('AuthService (JWT bearer)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('login success issues a JWT access token and a refresh token', async () => {
    const prisma = mockPrisma();
    const svc = new AuthService(
      jwt,
      prisma as unknown as PrismaService,
      mockAudit as unknown as AuditService,
    );
    const svcPrivates = svc as unknown as {
      resolveUserForLogin: AuthService['resolveUserForLogin'];
      validatePassword: AuthService['validatePassword'];
      fetchOrganization: AuthService['fetchOrganization'];
    };
    jest.spyOn(svcPrivates, 'resolveUserForLogin').mockResolvedValue(baseUser);
    jest.spyOn(svcPrivates, 'validatePassword').mockResolvedValue(true);
    jest.spyOn(svcPrivates, 'fetchOrganization').mockResolvedValue(activeOrg());

    const result = await svc.login({
      email: baseUser.email,
      password: 'password',
      userAgent: 'jest',
      ip: '127.0.0.1',
    });

    expect(result.user.id).toBe(baseUser.id);
    expect(result.accessToken).toBeDefined();
    expect(result.refreshToken).toBeDefined();
    expect(prisma.refreshToken.create).toHaveBeenCalledTimes(1);

    const payload = await jwt.verifyAsync<{ sub: string }>(result.accessToken, {
      secret: 'test-secret',
    });
    expect(payload.sub).toBe(baseUser.id);
  });

  it('login resolves the session organization from DB membership only', async () => {
    const prisma = mockPrisma();
    const adminUser = {
      ...baseUser,
      role: Role.ADMIN,
      organizationId: null,
    };
    prisma.adminOrganizationLink.findMany.mockResolvedValue([
      {
        organization: {
          ...activeOrg({ id: 'org-2', name: 'Linked Org' }),
          deletedAt: null,
        },
      },
    ]);
    const svc = new AuthService(
      jwt,
      prisma as unknown as PrismaService,
      mockAudit as unknown as AuditService,
    );
    const svcPrivates = svc as unknown as {
      resolveUserForLogin: AuthService['resolveUserForLogin'];
      validatePassword: AuthService['validatePassword'];
      fetchOrganization: AuthService['fetchOrganization'];
    };
    jest.spyOn(svcPrivates, 'resolveUserForLogin').mockResolvedValue(adminUser);
    jest.spyOn(svcPrivates, 'validatePassword').mockResolvedValue(true);
    jest
      .spyOn(svcPrivates, 'fetchOrganization')
      .mockResolvedValue(activeOrg({ id: 'org-2', name: 'Linked Org' }));

    const result = await svc.login({
      email: adminUser.email,
      password: 'password',
    });

    expect(result.user.organizationId).toBe('org-2');
    expect(result.organization).toEqual(
      expect.objectContaining({ id: 'org-2', name: 'Linked Org' }),
    );
  });

  it('login rejects users without any organization membership', async () => {
    const prisma = mockPrisma();
    const userWithoutOrg = {
      ...baseUser,
      organizationId: null,
    };
    const svc = new AuthService(
      jwt,
      prisma as unknown as PrismaService,
      mockAudit as unknown as AuditService,
    );
    const svcPrivates = svc as unknown as {
      resolveUserForLogin: AuthService['resolveUserForLogin'];
      validatePassword: AuthService['validatePassword'];
    };
    jest
      .spyOn(svcPrivates, 'resolveUserForLogin')
      .mockResolvedValue(userWithoutOrg);
    jest.spyOn(svcPrivates, 'validatePassword').mockResolvedValue(true);

    await expect(
      svc.login({
        email: userWithoutOrg.email,
        password: 'password',
      }),
    ).rejects.toEqual(
      new UnauthorizedException('User is not assigned to an organization'),
    );
  });

  it('login with wrong password throws 401', async () => {
    const prisma = mockPrisma();
    const svc = new AuthService(
      jwt,
      prisma as unknown as PrismaService,
      mockAudit as unknown as AuditService,
    );
    const svcPrivates = svc as unknown as {
      resolveUserForLogin: AuthService['resolveUserForLogin'];
      validatePassword: AuthService['validatePassword'];
    };
    jest.spyOn(svcPrivates, 'resolveUserForLogin').mockResolvedValue(baseUser);
    jest.spyOn(svcPrivates, 'validatePassword').mockResolvedValue(false);

    await expect(
      svc.login({
        email: baseUser.email,
        password: 'bad',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('refresh success rotates the refresh token and issues a new JWT', async () => {
    const prisma = mockPrisma();
    const token = 'refresh-token';
    const svc = new AuthService(
      jwt,
      prisma as unknown as PrismaService,
      mockAudit as unknown as AuditService,
    );
    const svcPrivates = svc as unknown as {
      hashToken: AuthService['hashToken'];
      fetchOrganization: AuthService['fetchOrganization'];
    };
    const now = Date.now() + 1000;
    prisma.refreshToken.findUnique.mockResolvedValue({
      tokenHash: svcPrivates.hashToken(token),
      userId: baseUser.id,
      expiresAt: new Date(now),
      revokedAt: null,
      persistent: true,
      user: baseUser,
    });
    jest.spyOn(svcPrivates, 'fetchOrganization').mockResolvedValue(activeOrg());

    const result = await svc.refresh({ refreshToken: token });

    expect(result.user.id).toBe(baseUser.id);
    expect(prisma.refreshToken.update).toHaveBeenCalled();
    expect(prisma.refreshToken.create).toHaveBeenCalledTimes(1);

    const payload = await jwt.verifyAsync<{ sub: string }>(result.accessToken, {
      secret: 'test-secret',
    });
    expect(payload.sub).toBe(baseUser.id);
  });

  it('refresh with expired token throws 401', async () => {
    const prisma = mockPrisma();
    const token = 'expired-refresh';
    const svc = new AuthService(
      jwt,
      prisma as unknown as PrismaService,
      mockAudit as unknown as AuditService,
    );
    const svcPrivates = svc as unknown as {
      hashToken: AuthService['hashToken'];
    };
    prisma.refreshToken.findUnique.mockResolvedValue({
      tokenHash: svcPrivates.hashToken(token),
      userId: baseUser.id,
      expiresAt: new Date(Date.now() - 1000),
      revokedAt: null,
      persistent: true,
      user: baseUser,
    });

    await expect(svc.refresh({ refreshToken: token })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('me resolves a JWT access token to a user', async () => {
    const prisma = mockPrisma();
    prisma.user.findFirst.mockResolvedValue(baseUser);
    prisma.organization.findFirst.mockResolvedValue(activeOrg());

    const svc = new AuthService(
      jwt,
      prisma as unknown as PrismaService,
      mockAudit as unknown as AuditService,
    );
    const accessToken = await jwt.signAsync(
      {
        sub: baseUser.id,
        role: baseUser.role,
        organizationId: baseUser.organizationId,
      },
      { secret: 'test-secret' },
    );

    const result = await svc.me(accessToken);
    expect(result.user.id).toBe(baseUser.id);
    expect(result.organization?.id).toBe('org-1');
  });

  it('does not mark normal JWT access tokens as service tokens', async () => {
    const prisma = mockPrisma();
    prisma.user.findFirst.mockResolvedValue(baseUser);
    prisma.organization.findFirst.mockResolvedValue(activeOrg());

    const svc = new AuthService(
      jwt,
      prisma as unknown as PrismaService,
      mockAudit as unknown as AuditService,
    );

    const result = await svc.validateAccessTokenPayload({
      sub: baseUser.id,
      role: baseUser.role,
      organizationId: baseUser.organizationId,
    });

    expect(result.serviceToken).not.toBe(true);
    expect(result.organizationId).toBe('org-1');
  });

  it('rejects access when an organization trial has expired', async () => {
    const prisma = mockPrisma();
    prisma.user.findFirst.mockResolvedValue(baseUser);
    prisma.organization.findFirst.mockResolvedValue(
      activeOrg({
        subscriptionStatus: OrganizationSubscriptionStatus.TRIALING,
        trialEndsAt: new Date(Date.now() - 60_000),
      }),
    );

    const svc = new AuthService(
      jwt,
      prisma as unknown as PrismaService,
      mockAudit as unknown as AuditService,
    );

    await expect(
      svc.validateAccessTokenPayload({
        sub: baseUser.id,
        role: baseUser.role,
        organizationId: baseUser.organizationId,
      }),
    ).rejects.toEqual(
      new UnauthorizedException(
        'Free trial expired. Please contact Arenzyra to activate billing.',
      ),
    );
  });

  it('validates service tokens without user password login', async () => {
    const previousEnv = {
      tokenHash: process.env.ARENZYRA_API_SERVICE_TOKEN_SHA256,
      orgId: process.env.ARENZYRA_API_SERVICE_ORGANIZATION_ID,
      userEmail: process.env.ARENZYRA_API_SERVICE_USER_EMAIL,
    };
    const token = 'service-token-for-jest';
    process.env.ARENZYRA_API_SERVICE_TOKEN_SHA256 = createHash('sha256')
      .update(token)
      .digest('hex');
    process.env.ARENZYRA_API_SERVICE_ORGANIZATION_ID = 'org-1';
    process.env.ARENZYRA_API_SERVICE_USER_EMAIL = 'discord-bot@arenzyra.local';

    try {
      const prisma = mockPrisma();
      prisma.organization.findFirst.mockResolvedValue(activeOrg());
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockImplementation(async (args) => ({
        ...baseUser,
        ...args.data,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
        deletedBy: null,
        bannedUntil: null,
      }));

      const svc = new AuthService(
        jwt,
        prisma as unknown as PrismaService,
        mockAudit as unknown as AuditService,
      );

      const result = await svc.validateServiceToken({
        token,
        organizationId: 'org-1',
      });

      expect(result.email).toBe('discord-bot@arenzyra.local');
      expect(result.organizationId).toBe('org-1');
      expect(result.role).toBe(Role.ORGANIZER);
      expect(result.serviceToken).toBe(true);
      expect(prisma.user.create).toHaveBeenCalledTimes(1);
      expect(prisma.refreshToken.create).not.toHaveBeenCalled();
    } finally {
      if (previousEnv.tokenHash === undefined) {
        delete process.env.ARENZYRA_API_SERVICE_TOKEN_SHA256;
      } else {
        process.env.ARENZYRA_API_SERVICE_TOKEN_SHA256 = previousEnv.tokenHash;
      }
      if (previousEnv.orgId === undefined) {
        delete process.env.ARENZYRA_API_SERVICE_ORGANIZATION_ID;
      } else {
        process.env.ARENZYRA_API_SERVICE_ORGANIZATION_ID = previousEnv.orgId;
      }
      if (previousEnv.userEmail === undefined) {
        delete process.env.ARENZYRA_API_SERVICE_USER_EMAIL;
      } else {
        process.env.ARENZYRA_API_SERVICE_USER_EMAIL = previousEnv.userEmail;
      }
    }
  });

  it('validates the separate Studio QA service token hash', async () => {
    const previousEnv = {
      tokenHash: process.env.ARENZYRA_API_SERVICE_TOKEN_SHA256,
      qaTokenHash: process.env.STUDIO_QA_SERVICE_TOKEN_SHA256,
      orgId: process.env.ARENZYRA_API_SERVICE_ORGANIZATION_ID,
      userEmail: process.env.ARENZYRA_API_SERVICE_USER_EMAIL,
    };
    const token = 'studio-qa-token-for-jest';
    delete process.env.ARENZYRA_API_SERVICE_TOKEN_SHA256;
    process.env.STUDIO_QA_SERVICE_TOKEN_SHA256 = createHash('sha256')
      .update(token)
      .digest('hex');
    process.env.ARENZYRA_API_SERVICE_ORGANIZATION_ID = 'org-1';
    process.env.ARENZYRA_API_SERVICE_USER_EMAIL = 'studio-qa@arenzyra.local';

    try {
      const prisma = mockPrisma();
      prisma.organization.findFirst.mockResolvedValue(activeOrg());
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockImplementation(async (args) => ({
        ...baseUser,
        ...args.data,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
        deletedBy: null,
        bannedUntil: null,
      }));

      const svc = new AuthService(
        jwt,
        prisma as unknown as PrismaService,
        mockAudit as unknown as AuditService,
      );

      const result = await svc.validateServiceToken({
        token,
        organizationId: 'org-1',
      });

      expect(result.email).toBe('studio-qa@arenzyra.local');
      expect(result.organizationId).toBe('org-1');
      expect(result.serviceToken).toBe(true);
    } finally {
      if (previousEnv.tokenHash === undefined) {
        delete process.env.ARENZYRA_API_SERVICE_TOKEN_SHA256;
      } else {
        process.env.ARENZYRA_API_SERVICE_TOKEN_SHA256 = previousEnv.tokenHash;
      }
      if (previousEnv.qaTokenHash === undefined) {
        delete process.env.STUDIO_QA_SERVICE_TOKEN_SHA256;
      } else {
        process.env.STUDIO_QA_SERVICE_TOKEN_SHA256 = previousEnv.qaTokenHash;
      }
      if (previousEnv.orgId === undefined) {
        delete process.env.ARENZYRA_API_SERVICE_ORGANIZATION_ID;
      } else {
        process.env.ARENZYRA_API_SERVICE_ORGANIZATION_ID = previousEnv.orgId;
      }
      if (previousEnv.userEmail === undefined) {
        delete process.env.ARENZYRA_API_SERVICE_USER_EMAIL;
      } else {
        process.env.ARENZYRA_API_SERVICE_USER_EMAIL = previousEnv.userEmail;
      }
    }
  });

  it('applyForOrganization stores a pending application with a hashed password', async () => {
    const prisma = mockPrisma();
    prisma.user.findFirst.mockResolvedValue(null);
    prisma.organization.findFirst.mockResolvedValue(null);
    prisma.organizationApplication.findFirst.mockResolvedValue(null);
    prisma.organizationApplication.create.mockImplementation(async (args) => ({
      id: 'app-1',
      name: args.data.name,
      email: args.data.email,
      applicantName: args.data.applicantName,
      country: args.data.country,
      whatsappNumber: args.data.whatsappNumber,
      discordUsername: args.data.discordUsername,
      websiteUrl: args.data.websiteUrl,
      contactMessage: args.data.contactMessage,
      requestedPlan: args.data.requestedPlan,
      requestedAddOns: args.data.requestedAddOns,
      paymentMethod: args.data.paymentMethod,
      status: args.data.status,
      createdAt: new Date('2026-03-24T10:00:00.000Z'),
      updatedAt: new Date('2026-03-24T10:00:00.000Z'),
    }));

    const svc = new AuthService(
      jwt,
      prisma as unknown as PrismaService,
      mockAudit as unknown as AuditService,
    );

    const result = await svc.applyForOrganization({
      name: 'Acme Events',
      email: 'owner@example.com',
      password: 'secret123',
      applicantName: 'Owner',
      country: 'Bangladesh',
      whatsappNumber: '+8801700000000',
      discordUsername: 'owner.gg',
      websiteUrl: 'https://example.com',
      contactMessage: 'We run weekly tournaments.',
      requestedPlan: 'Production - Single Game - PUBG Mobile ($29.99/mo)',
      requestedAddOns: 'Live Map Module (+$9.99/mo)',
      paymentMethod: 'Manual invoice - Wise',
    });

    const createArgs = prisma.organizationApplication.create.mock.calls[0]?.[0];
    expect(createArgs.data.status).toBe('PENDING');
    expect(createArgs.data.requestedPlan).toBe(
      'Production - Single Game - PUBG Mobile ($29.99/mo)',
    );
    expect(createArgs.data.requestedAddOns).toBe('Live Map Module (+$9.99/mo)');
    expect(createArgs.data.paymentMethod).toBe('Manual invoice - Wise');
    expect(createArgs.data.country).toBe('Bangladesh');
    expect(createArgs.data.whatsappNumber).toBe('+8801700000000');
    expect(createArgs.data.discordUsername).toBe('owner.gg');
    expect(createArgs.data.websiteUrl).toBe('https://example.com');
    expect(createArgs.data.contactMessage).toBe('We run weekly tournaments.');
    expect(createArgs.data.passwordHash).not.toBe('secret123');
    await expect(
      bcrypt.compare('secret123', createArgs.data.passwordHash),
    ).resolves.toBe(true);
    expect(result).toEqual(
      expect.objectContaining({
        id: 'app-1',
        status: 'PENDING',
      }),
    );
  });

  it('applyForOrganization rejects when the email is already registered', async () => {
    const prisma = mockPrisma();
    prisma.user.findFirst.mockResolvedValue({ id: 'existing-user' });
    prisma.organization.findFirst.mockResolvedValue(null);
    prisma.organizationApplication.findFirst.mockResolvedValue(null);

    const svc = new AuthService(
      jwt,
      prisma as unknown as PrismaService,
      mockAudit as unknown as AuditService,
    );

    await expect(
      svc.applyForOrganization({
        name: 'Acme Events',
        email: 'owner@example.com',
        password: 'secret123',
        applicantName: 'Owner',
      }),
    ).rejects.toEqual(
      new BadRequestException(
        'Application already exists or account already registered',
      ),
    );

    expect(prisma.organizationApplication.create).not.toHaveBeenCalled();
  });

  it('applyForOrganization rejects when a pending application already exists for the email', async () => {
    const prisma = mockPrisma();
    prisma.user.findFirst.mockResolvedValue(null);
    prisma.organization.findFirst.mockResolvedValue(null);
    prisma.organizationApplication.findFirst
      .mockResolvedValueOnce({ id: 'pending-app' })
      .mockResolvedValueOnce(null);

    const svc = new AuthService(
      jwt,
      prisma as unknown as PrismaService,
      mockAudit as unknown as AuditService,
    );

    await expect(
      svc.applyForOrganization({
        name: 'Acme Events',
        email: 'owner@example.com',
        password: 'secret123',
        applicantName: 'Owner',
      }),
    ).rejects.toEqual(
      new BadRequestException(
        'Application already exists or account already registered',
      ),
    );

    expect(prisma.organizationApplication.create).not.toHaveBeenCalled();
  });
});
