import {
  BadRequestException,
  Injectable,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  AuditAction,
  GameKey,
  OrganizerAccessMode,
  OrganizationApplicationStatus,
  OrganizationStatus,
  OrganizationSubscriptionStatus,
  Prisma,
  Role,
  User,
  UserStatus,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'crypto';
import { AuditService } from '../modules/audit/audit.service';
import { PrismaService } from '../db/prisma.service';
import { effectiveOrganizationId } from '../common/org/org.util';
import type { AuthUser } from '../common/auth/auth.types';
import type { Actor, JwtPayload } from '../common/auth/jwt.strategy';
import { env } from '../config/env.validation';
import { ApplicationNotificationService } from './application-notification.service';
import { normalizeGameKeys } from '../common/org/organization-plan.util';

export const REFRESH_TTL_SECONDS =
  Number(process.env.REFRESH_MAX_AGE ?? process.env.REFRESH_MAX_AGE_SECONDS) ||
  15 * 24 * 60 * 60; // 15 days

const DEFAULT_SERVICE_USER_EMAIL = 'discord-bot@arenzyra.local';
const SERVICE_USER_NAME = 'Arenzyra Discord Bot';

const AUTH_ORGANIZATION_SELECT = {
  id: true,
  name: true,
  accessMode: true,
  status: true,
  isActive: true,
  subscriptionStatus: true,
  trialStartedAt: true,
  trialEndsAt: true,
  paidUntil: true,
  planId: true,
  enabledGames: true,
  enabledAddOns: true,
} satisfies Prisma.OrganizationSelect;

type AuthBundle = {
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: Date;
  user: SafeUser;
  organization: AuthOrganization | null;
};

type AuthOrganization = Prisma.OrganizationGetPayload<{
  select: typeof AUTH_ORGANIZATION_SELECT;
}>;

export type SafeUser = {
  id: string;
  email: string | null;
  name: string | null;
  role: Role;
  organizationId: string | null;
  organizationName?: string | null;
  organizerAccessMode?: OrganizerAccessMode | null;
  organizationAccessMode?: OrganizerAccessMode | null;
  accessMode?: OrganizerAccessMode | null;
  organizationPlanId?: string | null;
  planId?: string | null;
  enabledGames?: GameKey[] | null;
  enabledAddOns?: string[] | null;
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
  country?: string | null;
  whatsappNumber?: string | null;
  discordUsername?: string | null;
  websiteUrl?: string | null;
  contactMessage?: string | null;
  requestedPlan?: string | null;
  requestedPlanId?: string | null;
  requestedGameKey?: GameKey | null;
  requestedGameKeys?: GameKey[] | null;
  requestedAddOns?: string | null;
  requestedAddOnIds?: string[] | null;
  paymentMethod?: string | null;
  status: OrganizationApplicationStatus;
  createdAt: Date;
  updatedAt: Date;
};

type SafeUserContext = Partial<{
  actingOrgId: string | null;
  actingOrgName: string | null;
  actingRole: Role | null;
  actingAsUserId: string | null;
  actorId: string | null;
  actorRole: Role | null;
  realRole: Role | null;
  organizerAccessMode: OrganizerAccessMode | null;
  organizationAccessMode: OrganizerAccessMode | null;
  accessMode: OrganizerAccessMode | null;
  organizationPlanId: string | null;
  planId: string | null;
  enabledGames: GameKey[] | null;
  enabledAddOns: string[] | null;
  isImpersonating: boolean | null;
  impersonated: boolean | null;
  impersonatedBy: string | null;
  impersonationExpiresAt: string | number | Date | null;
}>;

@Injectable()
export class AuthService {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Optional()
    private readonly applicationNotifications?: ApplicationNotificationService,
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

  private tokenHashMatches(candidateHash: string, expectedHash: string) {
    const left = Buffer.from(candidateHash.toLowerCase(), 'hex');
    const right = Buffer.from(expectedHash.toLowerCase(), 'hex');
    return left.length === right.length && timingSafeEqual(left, right);
  }

  private serviceTokenHashes(): string[] {
    const hashes = [
      process.env.ARENZYRA_API_SERVICE_TOKEN_SHA256,
      process.env.ARENZYRA_API_SERVICE_TOKEN_HASH,
      process.env.STUDIO_QA_SERVICE_TOKEN_SHA256,
    ]
      .map((value) => value?.trim())
      .filter((value): value is string => Boolean(value))
      .filter((value) => /^[a-f0-9]{64}$/i.test(value))
      .map((value) => value.toLowerCase());

    const plainHashes = [
      process.env.ARENZYRA_API_SERVICE_TOKEN,
      process.env.STUDIO_QA_SERVICE_TOKEN,
    ]
      .map((value) => value?.trim())
      .filter((value): value is string => Boolean(value))
      .map((value) => this.hashToken(value));

    return Array.from(new Set([...hashes, ...plainHashes]));
  }

  private assertServiceToken(token: string) {
    const configuredHashes = this.serviceTokenHashes();
    if (!configuredHashes.length) {
      throw new UnauthorizedException('Service token auth is not configured');
    }

    const candidateHash = this.hashToken(token.trim());
    if (
      !configuredHashes.some((configuredHash) =>
        this.tokenHashMatches(candidateHash, configuredHash),
      )
    ) {
      throw new UnauthorizedException('Invalid service token');
    }
  }

  private resolveServiceOrganizationId(requestedOrgId?: string | null) {
    const configuredOrgId =
      process.env.ARENZYRA_API_SERVICE_ORGANIZATION_ID?.trim() ||
      process.env.ARENZYRA_API_ORGANIZATION_ID?.trim() ||
      null;
    const cleanRequested = requestedOrgId?.trim() || null;
    const organizationId = cleanRequested ?? configuredOrgId;
    if (!organizationId) {
      throw new UnauthorizedException(
        'Service token organization is not configured',
      );
    }
    return organizationId;
  }

  private async ensureServiceUser(
    organization: AuthOrganization,
  ): Promise<User> {
    const email =
      process.env.ARENZYRA_API_SERVICE_USER_EMAIL?.trim() ||
      DEFAULT_SERVICE_USER_EMAIL;
    const configuredId = process.env.ARENZYRA_API_SERVICE_USER_ID?.trim();

    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      return this.prisma.user.update({
        where: { id: existing.id },
        data: {
          name: SERVICE_USER_NAME,
          role: Role.ORGANIZER,
          organizerAccessMode: OrganizerAccessMode.FULL_PRODUCTION,
          organizationId: organization.id,
          status: UserStatus.ACTIVE,
          deletedAt: null,
          deletedBy: null,
          bannedUntil: null,
        },
      });
    }

    const disabledPasswordHash = await bcrypt.hash(randomUUID(), 12);
    return this.prisma.user.create({
      data: {
        id: configuredId || undefined,
        email,
        password: disabledPasswordHash,
        name: SERVICE_USER_NAME,
        role: Role.ORGANIZER,
        organizerAccessMode: OrganizerAccessMode.FULL_PRODUCTION,
        organizationId: organization.id,
        status: UserStatus.ACTIVE,
      },
    });
  }

  private resolveOrganizerAccessMode(
    userMode?: OrganizerAccessMode | null,
    orgMode?: OrganizerAccessMode | null,
  ): OrganizerAccessMode {
    if (
      userMode === OrganizerAccessMode.DISCORD_ONLY ||
      orgMode === OrganizerAccessMode.DISCORD_ONLY
    ) {
      return OrganizerAccessMode.DISCORD_ONLY;
    }
    return OrganizerAccessMode.FULL_PRODUCTION;
  }

  private refreshExpiry() {
    return new Date(Date.now() + REFRESH_TTL_SECONDS * 1000);
  }

  private sanitizeUser(user: User, payload?: SafeUserContext): SafeUser {
    const resolvedOrgId = payload?.actingOrgId ?? user.organizationId ?? null;
    const resolvedOrgName = payload?.actingOrgName ?? null;
    const userAccessMode =
      payload?.organizerAccessMode ??
      user.organizerAccessMode ??
      OrganizerAccessMode.FULL_PRODUCTION;
    const organizationAccessMode = payload?.organizationAccessMode ?? null;
    const organizationPlanId =
      payload?.organizationPlanId ?? payload?.planId ?? null;
    const accessMode =
      payload?.accessMode ??
      this.resolveOrganizerAccessMode(userAccessMode, organizationAccessMode);
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      organizationId: resolvedOrgId,
      organizationName: resolvedOrgName,
      organizerAccessMode: userAccessMode,
      organizationAccessMode,
      accessMode,
      organizationPlanId,
      planId: organizationPlanId,
      enabledGames: payload?.enabledGames ?? null,
      enabledAddOns: payload?.enabledAddOns ?? null,
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
      organizerAccessMode: user.organizerAccessMode ?? null,
      organizationAccessMode: user.organizationAccessMode ?? null,
      accessMode: user.accessMode ?? null,
      organizationPlanId: user.organizationPlanId ?? user.planId ?? null,
      planId: user.planId ?? user.organizationPlanId ?? null,
      enabledGames: user.enabledGames ?? null,
      enabledAddOns: user.enabledAddOns ?? null,
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
      organizerAccessMode: user.organizerAccessMode ?? null,
      organizationAccessMode: user.organizationAccessMode ?? null,
      accessMode: user.accessMode ?? null,
      organizationPlanId: user.organizationPlanId ?? user.planId ?? null,
      planId: user.planId ?? user.organizationPlanId ?? null,
      enabledGames: user.enabledGames ?? null,
      enabledAddOns: user.enabledAddOns ?? null,
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
    organization?: AuthOrganization | null,
  ): AuthUser {
    return {
      ...this.toActor(user),
      organizationId: user.actingOrgId ?? user.organizationId ?? null,
      actorId: user.actorId ?? null,
      actorRole: user.actorRole ?? null,
      actingOrgId: user.actingOrgId ?? user.organizationId ?? null,
      actingRole: user.actingRole ?? null,
      actingOrgName: user.actingOrgName ?? user.organizationName ?? null,
      organizerAccessMode: user.organizerAccessMode ?? null,
      organizationAccessMode:
        user.organizationAccessMode ?? organization?.accessMode ?? null,
      accessMode:
        user.accessMode ??
        this.resolveOrganizerAccessMode(
          user.organizerAccessMode,
          user.organizationAccessMode ?? organization?.accessMode,
        ),
      organizationPlanId:
        user.organizationPlanId ?? user.planId ?? organization?.planId ?? null,
      planId:
        user.planId ?? user.organizationPlanId ?? organization?.planId ?? null,
      enabledGames: user.enabledGames ?? organization?.enabledGames ?? null,
      enabledAddOns: user.enabledAddOns ?? organization?.enabledAddOns ?? null,
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
      select: AUTH_ORGANIZATION_SELECT,
    });
  }

  private assertOrganizationBillingAccess(
    organization: AuthOrganization | null,
    role?: Role | null,
  ) {
    if (!organization || role === Role.SUPER_ADMIN) {
      return;
    }

    if (
      !organization.isActive ||
      organization.status !== OrganizationStatus.APPROVED
    ) {
      throw new UnauthorizedException('Organization is not active');
    }

    const now = Date.now();
    const hasPaidAccess =
      !!organization.paidUntil && organization.paidUntil.getTime() > now;

    if (
      organization.subscriptionStatus === OrganizationSubscriptionStatus.ACTIVE
    ) {
      return;
    }

    if (
      organization.subscriptionStatus ===
        OrganizationSubscriptionStatus.TRIALING &&
      ((!!organization.trialEndsAt &&
        organization.trialEndsAt.getTime() > now) ||
        hasPaidAccess)
    ) {
      return;
    }

    throw new UnauthorizedException(
      'Free trial expired. Please contact Arenzyra to activate billing.',
    );
  }

  private async listUserOrganizations(
    user: Pick<User, 'id' | 'role' | 'organizationId'>,
  ): Promise<AuthOrganization[]> {
    const organizations: AuthOrganization[] = [];
    const seen = new Set<string>();
    const append = (organization?: AuthOrganization | null) => {
      if (!organization || seen.has(organization.id)) {
        return;
      }
      seen.add(organization.id);
      organizations.push(organization);
    };

    if (user.organizationId) {
      append(await this.fetchOrganization(user.organizationId));
    }

    if (user.role === Role.ADMIN) {
      const links = await this.prisma.adminOrganizationLink.findMany({
        where: { adminId: user.id },
        include: {
          organization: {
            select: {
              ...AUTH_ORGANIZATION_SELECT,
              deletedAt: true,
            },
          },
        },
        orderBy: { createdAt: 'asc' },
      });

      links.forEach((link) => {
        if (!link.organization?.deletedAt) {
          const { deletedAt: _deletedAt, ...organization } = link.organization;
          void _deletedAt;
          append({
            ...organization,
            name: organization.name ?? null,
          });
        }
      });
    }

    const ownedOrganizations = await this.prisma.organization.findMany({
      where: {
        ownerUserId: user.id,
        deletedAt: null,
      },
      select: AUTH_ORGANIZATION_SELECT,
      orderBy: { createdAt: 'asc' },
    });

    ownedOrganizations.forEach((organization) => {
      append({
        ...organization,
        name: organization.name ?? null,
      });
    });

    return organizations;
  }

  private async resolvePrimaryOrganization(
    user: Pick<User, 'id' | 'role' | 'organizationId'>,
  ): Promise<AuthOrganization> {
    const organizations = await this.listUserOrganizations(user);
    if (organizations.length === 0) {
      throw new UnauthorizedException(
        'User is not assigned to an organization',
      );
    }

    return organizations[0];
  }

  private async resolveScopedUser(
    userRecord: User,
    payload?: SafeUserContext,
  ): Promise<SafeUser> {
    const organization = await this.resolvePrimaryOrganization(userRecord);
    return this.sanitizeUser(
      { ...userRecord, organizationId: organization.id } as User,
      {
        ...payload,
        actingOrgName: payload?.actingOrgName ?? organization.name,
        organizationAccessMode:
          payload?.organizationAccessMode ?? organization.accessMode,
        organizationPlanId:
          payload?.organizationPlanId ?? payload?.planId ?? organization.planId,
        planId:
          payload?.planId ?? payload?.organizationPlanId ?? organization.planId,
        enabledGames: payload?.enabledGames ?? organization.enabledGames,
        enabledAddOns: payload?.enabledAddOns ?? organization.enabledAddOns,
      },
    );
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
      organizationAccessMode:
        organization?.accessMode ?? user.organizationAccessMode ?? null,
      organizationPlanId:
        organization?.planId ?? user.organizationPlanId ?? user.planId ?? null,
      planId:
        organization?.planId ?? user.planId ?? user.organizationPlanId ?? null,
      enabledGames: organization?.enabledGames ?? user.enabledGames ?? null,
      enabledAddOns: organization?.enabledAddOns ?? user.enabledAddOns ?? null,
      accessMode: this.resolveOrganizerAccessMode(
        user.organizerAccessMode,
        organization?.accessMode ?? user.organizationAccessMode,
      ),
    };
    this.assertOrganizationBillingAccess(organization, enrichedUser.role);
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
      country: application.country ?? null,
      whatsappNumber: application.whatsappNumber ?? null,
      discordUsername: application.discordUsername ?? null,
      websiteUrl: application.websiteUrl ?? null,
      contactMessage: application.contactMessage ?? null,
      requestedPlan: application.requestedPlan ?? null,
      requestedPlanId: application.requestedPlanId ?? null,
      requestedGameKey: application.requestedGameKey ?? null,
      requestedGameKeys: application.requestedGameKeys ?? [],
      requestedAddOns: application.requestedAddOns ?? null,
      requestedAddOnIds: application.requestedAddOnIds ?? [],
      paymentMethod: application.paymentMethod ?? null,
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
    country?: string | null;
    whatsappNumber?: string | null;
    discordUsername?: string | null;
    websiteUrl?: string | null;
    contactMessage?: string | null;
    requestedPlan?: string | null;
    requestedPlanId?: string | null;
    requestedGameKey?: string | null;
    requestedGameKeys?: string[] | null;
    requestedAddOns?: string | null;
    requestedAddOnIds?: string[] | null;
    paymentMethod?: string | null;
  }) {
    const duplicateApplicationMessage =
      'Application already exists or account already registered';
    const name = params.name.trim();
    const email = params.email.trim();
    const applicantName = params.applicantName.trim();
    const country = params.country?.trim() || null;
    const whatsappNumber = params.whatsappNumber?.trim() || null;
    const discordUsername = params.discordUsername?.trim() || null;
    const websiteUrl = params.websiteUrl?.trim() || null;
    const contactMessage = params.contactMessage?.trim() || null;
    const requestedPlan = params.requestedPlan?.trim() || null;
    const requestedPlanId = params.requestedPlanId?.trim() || null;
    const requestedGameKeys = normalizeGameKeys([
      params.requestedGameKey,
      ...(params.requestedGameKeys ?? []),
    ]);
    const requestedGameKey = requestedGameKeys[0] ?? null;
    const requestedAddOns = params.requestedAddOns?.trim() || null;
    const requestedAddOnIds = (params.requestedAddOnIds ?? [])
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
    const paymentMethod = params.paymentMethod?.trim() || null;

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
          country,
          whatsappNumber,
          discordUsername,
          websiteUrl,
          contactMessage,
          requestedPlan,
          requestedPlanId,
          requestedGameKey,
          requestedGameKeys,
          requestedAddOns,
          requestedAddOnIds,
          paymentMethod,
          status: OrganizationApplicationStatus.PENDING,
        },
        select: {
          id: true,
          name: true,
          email: true,
          applicantName: true,
          country: true,
          whatsappNumber: true,
          discordUsername: true,
          websiteUrl: true,
          contactMessage: true,
          requestedPlan: true,
          requestedPlanId: true,
          requestedGameKey: true,
          requestedGameKeys: true,
          requestedAddOns: true,
          requestedAddOnIds: true,
          paymentMethod: true,
          status: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      const application = this.mapOrganizationApplication(created);
      void this.applicationNotifications
        ?.notifyNewApplication(application)
        .catch(() => undefined);

      return application;
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
    const user = await this.resolveScopedUser(record.user);
    return { record, user };
  }

  async login(params: {
    email: string;
    password: string;
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

    const user = await this.resolveScopedUser(userRecord);

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
    organization: AuthOrganization | null;
  }> {
    const userRecord = await this.prisma.user.findFirst({
      where: { id: payload.sub, deletedAt: null },
    });

    if (!userRecord) {
      throw new UnauthorizedException('User not found');
    }

    this.ensureUserActive(userRecord);

    const user = await this.resolveScopedUser(userRecord, {
      actingOrgId: payload.actingOrgId ?? null,
      actingOrgName: payload.actingOrgName ?? null,
      actingRole: payload.actingRole ?? null,
      actingAsUserId: payload.actingAsUserId ?? null,
      actorId: payload.actorId ?? null,
      actorRole: payload.actorRole ?? null,
      realRole: payload.realRole ?? null,
      organizerAccessMode: payload.organizerAccessMode ?? null,
      organizationAccessMode: payload.organizationAccessMode ?? null,
      organizationPlanId: payload.organizationPlanId ?? payload.planId ?? null,
      planId: payload.planId ?? payload.organizationPlanId ?? null,
      enabledGames: payload.enabledGames ?? null,
      enabledAddOns: payload.enabledAddOns ?? null,
      accessMode: payload.accessMode ?? null,
      isImpersonating: payload.isImpersonating ?? null,
      impersonated: payload.impersonated ?? null,
      impersonatedBy: payload.impersonatedBy ?? null,
      impersonationExpiresAt: payload.impersonationExpiresAt ?? null,
    });
    const orgId = effectiveOrganizationId(this.toActor(user));
    const organization = await this.fetchOrganization(orgId);
    this.assertOrganizationBillingAccess(organization, user.role);

    if (organization && !user.organizationName) {
      user.organizationName = organization.name;
    }
    if (organization) {
      user.organizationAccessMode = organization.accessMode;
      user.organizationPlanId = organization.planId;
      user.planId = organization.planId;
      user.enabledGames = organization.enabledGames;
      user.enabledAddOns = organization.enabledAddOns;
      user.accessMode = this.resolveOrganizerAccessMode(
        user.organizerAccessMode,
        organization.accessMode,
      );
    }

    return { user, organization };
  }

  async validateAccessTokenPayload(payload: JwtPayload): Promise<AuthUser> {
    const { user, organization } = await this.resolveAccessContext(payload);
    return this.toAuthUser(user, organization);
  }

  async validateServiceToken(params: {
    token: string;
    organizationId?: string | null;
  }): Promise<AuthUser> {
    const { user, organization } = await this.serviceSession(params);

    return {
      ...this.toAuthUser(user, organization),
      serviceToken: true,
    };
  }

  async serviceSession(params: {
    token: string;
    organizationId?: string | null;
  }): Promise<{
    user: SafeUser;
    organization: AuthOrganization | null;
  }> {
    this.assertServiceToken(params.token);

    const organizationId = this.resolveServiceOrganizationId(
      params.organizationId,
    );
    const organization = await this.fetchOrganization(organizationId);
    if (!organization) {
      throw new UnauthorizedException('Service token organization not found');
    }
    this.assertOrganizationBillingAccess(organization, Role.ORGANIZER);

    const serviceUser = await this.ensureServiceUser(organization);
    const user = this.sanitizeUser(serviceUser, {
      actingOrgName: organization.name,
      actorId: serviceUser.id,
      actorRole: Role.ORGANIZER,
      organizationAccessMode: organization.accessMode,
      accessMode: this.resolveOrganizerAccessMode(
        serviceUser.organizerAccessMode,
        organization.accessMode,
      ),
    });

    return { user, organization };
  }

  async me(token?: string | null): Promise<{
    user: SafeUser;
    organization: AuthOrganization | null;
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
