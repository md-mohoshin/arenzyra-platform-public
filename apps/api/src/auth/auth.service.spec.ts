import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Role, UserStatus } from '@prisma/client';
import type { User } from '@prisma/client';
import * as bcrypt from 'bcrypt';
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

const mockPrisma = () => ({
  refreshToken: {
    create: jest.fn().mockResolvedValue(null),
    findUnique: jest.fn(),
    update: jest.fn().mockResolvedValue(null),
    updateMany: jest.fn().mockResolvedValue(null),
  },
  user: {
    findFirst: jest.fn(),
    upsert: jest.fn(),
  },
  organization: {
    findFirst: jest.fn(),
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
    jest
      .spyOn(svcPrivates, 'fetchOrganization')
      .mockResolvedValue({ id: 'org-1', name: 'Org' });

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
    jest
      .spyOn(svcPrivates, 'fetchOrganization')
      .mockResolvedValue({ id: 'org-1', name: 'Org' });

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
    prisma.organization.findFirst.mockResolvedValue({
      id: 'org-1',
      name: 'Org',
    });

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
    });

    const createArgs = prisma.organizationApplication.create.mock.calls[0]?.[0];
    expect(createArgs.data.status).toBe('PENDING');
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
