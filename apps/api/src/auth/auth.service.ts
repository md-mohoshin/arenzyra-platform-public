import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  AuditAction,
  OrganizationApplicationStatus,
  Prisma,
  Role,
  User,
  UserStatus,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { AuditService } from '../modules/audit/audit.service';
import { PrismaService } from '../db/prisma.service';
import { effectiveOrganizationId } from '../common/org/org.util';
import type { AuthUser } from '../common/auth/auth.types';
import type { Actor, JwtPayload } from '../common/auth/jwt.strategy';
import { env } from '../config/env.validation';

export const REFRESH_TTL_SECONDS =
  Number(process.env.REFRESH_MAX_AGE ?? process.env.REFRESH_MAX_AGE_SECONDS) ||
  15 * 24 * 60 * 60; // 15 days

type AuthBundle = {
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: Date;
  user: SafeUser;
  organization: { id: string; name: string | null } | null;
};

export type SafeUser = {
  id: string;
  email: string | null;
  name: string | null;
  role: Role;
  organizationId: string | null;
  organizationName?: string | null;
  actingOrgId?: string | null;
  actingOrgName?: string | null;
  actingRole?: Role | null;
  actingAsUserId?: string | null;
  actorId?: string | null;
  actorRole?: Role | null;
  realRole?: Role | null;
  isImpersonating?: boolean;
  impersonated?: boolean;
  impersonatedBy?: string | null;
  impersonationExpiresAt?: string | number | Date | null;
};

type OrganizationApplicationSummary = {
  id: string;
  name: string;
  email: string;
  applicantName: string;
  status: OrganizationApplicationStatus;
  createdAt: Date;
  updatedAt: Date;
};

@Injectable()
export class AuthService {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private get refreshTokens(): Prisma.RefreshTokenDelegate {
    return (
      this.prisma as unknown as {
        refreshToken: Prisma.RefreshTokenDelegate;
      }
    ).refreshToken;
  }

  private hashToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  private refreshExpiry() {
    return new Date(Date.now() + REFRESH_TTL_SECONDS * 1000);
  }

  private sanitizeUser(
    user: User,
    payload?: Partial<{
      organizationName?: string | null;
      actingOrgId?: string | null;
      actingOrgName?: string | null;
      actingRole?: Role | null;
      actingAsUserId?: string | null;
      actorId?: string | null;
      actorRole?: Role | null;
      realRole?: Role | null;
      isImpersonating?: boolean | null;
      impersonated?: boolean | null;
      impersonatedBy?: string | null;
      impersonationExpiresAt?: string | number | Date | null;
    }>,
  ): SafeUser {
    const resolvedOrgId =
      payload?.actingOrgId ??
      (payload as { organizationId?: string | null | undefined })
        ?.organizationId ??
      user.organizationId ??
      null;
    const resolvedOrgName =
      payload?.actingOrgName ?? payload?.organizationName ?? null;
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      organizationId: resolvedOrgId,
      organizationName: resolvedOrgName,
      actingOrgId: payload?.actingOrgId ?? null,
      actingOrgName: payload?.actingOrgName ?? null,
      actingRole: payload?.actingRole ?? null,
      actingAsUserId: payload?.actingAsUserId ?? null,
      actorId: payload?.actorId ?? null,
      actorRole: payload?.actorRole ?? null,
      realRole:
        payload?.realRole ??
        payload?.actorRole ??
        payload?.actingRole ??
        user.role ??
        null,
      isImpersonating:
        (payload?.isImpersonating ?? payload?.impersonated ?? null) === true,
      impersonated:
        (payload?.impersonated ?? payload?.isImpersonating ?? null) === true,
      impersonatedBy: payload?.impersonatedBy ?? null,
      impersonationExpiresAt: payload?.impersonationExpiresAt ?? null,
    };
  }

  private toActor(user: SafeUser): Actor {
    return {
      id: user.id,
      role: user.role ?? null,
      organizationId: user.organizationId ?? null,
      orgId: user.organizationId ?? null,
      actorId: user.actorId ?? null,
      actorRole: user.actorRole ?? user.role ?? null,
      actingOrgId: user.actingOrgId ?? null,
      actingRole: user.actingRole ?? null,
      actingOrgName: user.actingOrgName ?? null,
      actingAsUserId: user.actingAsUserId ?? null,
      isImpersonating: user.isImpersonating ?? false,
      impersonated: user.impersonated ?? user.isImpersonating ?? false,
      impersonatedBy: user.impersonatedBy ?? null,
      impersonationExpiresAt: user.impersonationExpiresAt ?? null,
      realRole: user.realRole ?? user.actorRole ?? user.role ?? null,
    };
  }

  private toJwtPayload(user: SafeUser): JwtPayload {
    return {
      sub: user.id,
      role: user.role ?? null,
      organizationId: user.organizationId ?? null,
      organizationName: user.organizationName ?? null,
      email: user.email ?? null,
      name: user.name ?? null,
      actorId: user.actorId ?? null,
      actorRole: user.actorRole ?? user.role ?? null,
      actingOrgId: user.actingOrgId ?? null,
      actingRole: user.actingRole ?? null,
      actingOrgName: user.actingOrgName ?? null,
      actingAsUserId: user.actingAsUserId ?? null,
      isImpersonating: user.isImpersonating ?? false,
      impersonated: user.impersonated ?? user.isImpersonating ?? false,
      impersonatedBy: user.impersonatedBy ?? null,
      impersonationExpiresAt: user.impersonationExpiresAt ?? null,
      realRole: user.realRole ?? user.actorRole ?? user.role ?? null,
    };
  }

  private async createAccessToken(user: SafeUser) {
    return this.jwt.signAsync(this.toJwtPayload(user));
  }

  private toAuthUser(
    user: SafeUser,
    organization?: { id: string; name: string | null } | null,
  ): AuthUser {
    return {
      ...this.toActor(user),
      organizationId: user.actingOrgId ?? user.organizationId ?? null,
      actorId: user.actorId ?? null,
      actorRole: user.actorRole ?? null,
      actingOrgId: user.actingOrgId ?? user.organizationId ?? null,
      actingRole: user.actingRole ?? null,
      actingOrgName: user.actingOrgName ?? user.organizationName ?? null,
      actingAsUserId: user.actingAsUserId ?? null,
      impersonationExpiresAt: user.impersonationExpiresAt ?? null,
      impersonatedBy: user.impersonatedBy ?? null,
      isImpersonating: user.isImpersonating ?? false,
      impersonated: user.impersonated ?? user.isImpersonating ?? false,
      orgId:
        user.actingOrgId ?? user.organizationId ?? organization?.id ?? null,
      email: user.email ?? null,
      realRole: user.realRole ?? user.role ?? null,
    };
  }

  private async fetchOrganization(orgId?: string | null) {
    if (!orgId) return null;
    return this.prisma.organization.findFirst({
      where: { id: orgId, deletedAt: null },
      select: { id: true, name: true },
    });
  }

  private ensureUserActive(user: User) {
    if (user.deletedAt) {
      throw new UnauthorizedException('Account not active');
    }
    if (
      user.status === UserStatus.BANNED &&
      (!user.bannedUntil || user.bannedUntil > new Date())
    ) {
      throw new UnauthorizedException('Account is banned');
    }
  }

  private async createTokenRecord(params: {
    userId: string;
    userAgent?: string | null;
    ip?: string | null;
  }) {
    const token = randomBytes(64).toString('hex');
    const tokenHash = this.hashToken(token);
    const expiresAt = this.refreshExpiry();
    await this.refreshTokens.create({
      data: {
        userId: params.userId,
        tokenHash,
        expiresAt,
        persistent: true,
        userAgent: params.userAgent ?? undefined,
        ip: params.ip ?? undefined,
      },
    });

    return { token, expiresAt };
  }

  private async buildSession(
    user: SafeUser,
    opts: {
      userAgent?: string | null;
      ip?: string | null;
    },
  ): Promise<AuthBundle> {
    const [refresh, organization] = await Promise.all([
      this.createTokenRecord({
        userId: user.id,
        userAgent: opts.userAgent,
        ip: opts.ip,
      }),
      this.fetchOrganization(user.organizationId),
    ]);

    const enrichedUser: SafeUser = {
      ...user,
      organizationName:
        organization?.name ??
        user.organizationName ??
        user.actingOrgName ??
        null,
    };
    const accessToken = await this.createAccessToken(enrichedUser);

    return {
      accessToken,
      refreshToken: refresh.token,
      refreshExpiresAt: refresh.expiresAt,
      user: enrichedUser,
      organization,
    };
  }

  private async logAuthEvent(user: SafeUser, event: 'LOGIN' | 'LOGOUT') {
    if (!user.organizationId) return;
    try {
      await this.audit.log({
        organizationId: user.organizationId,
        userId: user.id,
        action: AuditAction.SYSTEM_FLAG_UPDATE,
        entityType: 'AUTH_SESSION',
        entityId: user.id,
        after: { event },
        source: 'MANUAL',
        reason: event.toLowerCase(),
      });
    } catch (err) {
      void err;
    }
  }

  private async validatePassword(user: User, password: string) {
    if (!user.password) return false;
    return bcrypt.compare(password, user.password);
  }

  private async findUserByEmail(email: string) {
    return this.prisma.user.findFirst({
      where: { email, deletedAt: null },
    });
  }

  private mapOrganizationApplication(
    application: OrganizationApplicationSummary,
  ) {
    return {
      id: application.id,
      name: application.name,
      email: application.email,
      applicantName: application.applicantName,
      status: application.status,
      createdAt: application.createdAt,
      updatedAt: application.updatedAt,
    };
  }

  private async ensureDevUser(email: string, password: string, role: Role) {
    const hashed = await bcrypt.hash(password, 10);
    const name =
      role === Role.SUPER_ADMIN ? 'Super Admin' : 'Operator Dev Account';
    const id = randomUUID();

    return this.prisma.user.upsert({
      where: { email },
      update: {
        password: hashed,
        role,
        name,
      },
      create: {
        id,
        email,
        password: hashed,
        role,
        name,
      },
    });
  }

  private async resolveUserForLogin(email: string, password: string) {
    const isDev = process.env.NODE_ENV !== 'production';
    const devSuperEmail = isDev ? env.SUPERADMIN_EMAIL : null;
    const devSuperPass = isDev ? env.SUPERADMIN_PASSWORD : null;
    const devSuperPassAlt = process.env.SUPERADMIN_PASSWORD_ALT;
    const devOpEmail = isDev ? env.OP_EMAIL : null;
    const devOpPass = isDev ? env.OP_PASSWORD : null;
    const devOpPassAlt = process.env.OP_PASSWORD_ALT;

    const matchesDevSuper =
      isDev &&
      email === devSuperEmail &&
      (password === devSuperPass ||
        (devSuperPassAlt && password === devSuperPassAlt));

    if (matchesDevSuper) {
      return this.ensureDevUser(devSuperEmail, password, Role.SUPER_ADMIN);
    }

    const matchesDevOp =
      isDev &&
      email === devOpEmail &&
      (password === devOpPass || (devOpPassAlt && password === devOpPassAlt));

    if (matchesDevOp) {
      return this.ensureDevUser(devOpEmail, password, Role.ORGANIZER);
    }

    const dbUser = await this.findUserByEmail(email);
    if (dbUser) return dbUser;

    return null;
  }

  async applyForOrganization(params: {
    name: string;
    email: string;
    password: string;
    applicantName: string;
  }) {
    const duplicateApplicationMessage =
      'Application already exists or account already registered';
    const name = params.name.trim();
    const email = params.email.trim();
    const applicantName = params.applicantName.trim();

    const [
      existingUser,
      existingOrganization,
      emailApplication,
      nameApplication,
    ] = await Promise.all([
      this.prisma.user.findFirst({
        where: {
          email: { equals: email, mode: 'insensitive' },
          deletedAt: null,
        },
        select: { id: true },
      }),
      this.prisma.organization.findFirst({
        where: { name, deletedAt: null },
        select: { id: true },
      }),
      this.prisma.organizationApplication.findFirst({
        where: {
          email: { equals: email, mode: 'insensitive' },
          status: OrganizationApplicationStatus.PENDING,
        },
        select: { id: true },
      }),
      this.prisma.organizationApplication.findFirst({
        where: {
          name,
          status: OrganizationApplicationStatus.PENDING,
        },
        select: { id: true },
      }),
    ]);

    if (
      existingUser ||
      emailApplication ||
      existingOrganization ||
      nameApplication
    ) {
      throw new BadRequestException(duplicateApplicationMessage);
    }

    const passwordHash = await bcrypt.hash(params.password, 12);

    try {
      const created = await this.prisma.organizationApplication.create({
        data: {
          name,
          email,
          passwordHash,
          applicantName,
          status: OrganizationApplicationStatus.PENDING,
        },
        select: {
          id: true,
          name: true,
          email: true,
          applicantName: true,
          status: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      return this.mapOrganizationApplication(created);
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new BadRequestException(duplicateApplicationMessage);
      }
      throw err;
    }
  }

  private async lookupRefreshToken(token: string | null | undefined): Promise<{
    record: Prisma.RefreshTokenGetPayload<{ include: { user: true } }>;
    user: SafeUser;
  }> {
    const clean = token?.trim();
    if (!clean) {
      throw new UnauthorizedException('Missing token');
    }
    const tokenHash = this.hashToken(clean);
    const record = await this.refreshTokens.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (
      !record ||
      record.revokedAt ||
      record.expiresAt.getTime() < Date.now() ||
      record.persistent !== true
    ) {
      throw new UnauthorizedException('Invalid or expired token');
    }

    if (!record.user || record.user.deletedAt) {
      throw new UnauthorizedException('User not found');
    }

    this.ensureUserActive(record.user);
    const user = this.sanitizeUser(record.user);
    return { record, user };
  }

  async login(params: {
    email: string;
    password: string;
    organizationId?: string;
    userAgent?: string | null;
    ip?: string | null;
  }): Promise<AuthBundle> {
    const userRecord = await this.resolveUserForLogin(
      params.email,
      params.password,
    );

    if (!userRecord) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const valid = await this.validatePassword(userRecord, params.password);
    if (!valid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    this.ensureUserActive(userRecord);

    const user: SafeUser = this.sanitizeUser({
      ...userRecord,
      organizationId:
        params.organizationId ?? userRecord.organizationId ?? null,
    } as User);

    const bundle = await this.buildSession(user, {
      userAgent: params.userAgent,
      ip: params.ip,
    });

    await this.logAuthEvent(user, 'LOGIN');
    return bundle;
  }

  async refresh(params: {
    refreshToken?: string | null;
    userAgent?: string | null;
    ip?: string | null;
  }): Promise<AuthBundle> {
    const { record, user } = await this.lookupRefreshToken(params.refreshToken);

    await this.refreshTokens.update({
      where: { tokenHash: record.tokenHash },
      data: { revokedAt: new Date() },
    });

    return this.buildSession(user, {
      userAgent: params.userAgent,
      ip: params.ip,
    });
  }

  async revoke(refreshToken?: string | null): Promise<SafeUser | null> {
    const clean = refreshToken?.trim();
    if (!clean) return null;
    const tokenHash = this.hashToken(clean);
    const record = await this.refreshTokens.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    await this.refreshTokens.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    if (record?.user && !record.user.deletedAt) {
      const user = this.sanitizeUser(record.user);
      await this.logAuthEvent(user, 'LOGOUT');
      return user;
    }

    return null;
  }

  private async resolveAccessContext(payload: JwtPayload): Promise<{
    user: SafeUser;
    organization: { id: string; name: string | null } | null;
  }> {
    const userRecord = await this.prisma.user.findFirst({
      where: { id: payload.sub, deletedAt: null },
    });

    if (!userRecord) {
      throw new UnauthorizedException('User not found');
    }

    this.ensureUserActive(userRecord);

    const user = this.sanitizeUser(userRecord, payload);
    const orgId = effectiveOrganizationId(this.toActor(user));
    const organization = await this.fetchOrganization(orgId);

    if (organization && !user.organizationName) {
      user.organizationName = organization.name;
    }

    return { user, organization };
  }

  async validateAccessTokenPayload(payload: JwtPayload): Promise<AuthUser> {
    const { user, organization } = await this.resolveAccessContext(payload);
    return this.toAuthUser(user, organization);
  }

  async me(token?: string | null): Promise<{
    user: SafeUser;
    organization: { id: string; name: string | null } | null;
  }> {
    const clean = token?.trim();
    if (!clean) {
      throw new UnauthorizedException('Missing token');
    }

    try {
      const payload = await this.jwt.verifyAsync<JwtPayload>(clean);
      return this.resolveAccessContext(payload);
    } catch (err) {
      throw err instanceof UnauthorizedException
        ? err
        : new UnauthorizedException('Invalid session');
    }
  }
}
