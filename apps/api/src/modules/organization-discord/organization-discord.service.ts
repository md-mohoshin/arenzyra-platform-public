import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { OrganizationSubscriptionStatus, Prisma, Role } from '@prisma/client';
import type { Actor } from '../../common/auth/jwt.strategy';
import { organizationHasActiveSubscription } from '../../common/org/launcher-license-state.util';
import { effectiveOrganizationId } from '../../common/org/org.util';
import { env } from '../../config/env.validation';
import { PrismaService } from '../../db/prisma.service';
import { CompleteDiscordInstallDto } from './dto/complete-discord-install.dto';
import { MarkDiscordGuildRemovedDto } from './dto/mark-discord-guild-removed.dto';
import { UpdateOrganizationDiscordConfigDto } from './dto/update-organization-discord-config.dto';

const DISCORD_OAUTH_AUTHORIZE_URL = 'https://discord.com/oauth2/authorize';
const DISCORD_API_BASE_URL = 'https://discord.com/api/v10';
const DISCORD_ADMINISTRATOR_PERMISSION = '8';
const DISCORD_INSTALL_STATE_TTL_MS = 10 * 60 * 1000;
const DISCORD_BOT_AVATAR_MAX_BYTES = 2 * 1024 * 1024;
const DISCORD_BOT_AVATAR_DATA_URI =
  /^data:image\/(png|jpe?g|gif|webp);base64,([A-Za-z0-9+/]+={0,2})$/i;
const DISCORD_GUILD_TEXT_CHANNEL = 0;
const DISCORD_GUILD_CATEGORY_CHANNEL = 4;
const DISCORD_EVENT_SERVER_ACCESS_MODES = [
  'PRIMARY',
  'CONNECTED',
  'ALL_BOT',
] as const;

type DiscordEventServerAccessMode =
  (typeof DISCORD_EVENT_SERVER_ACCESS_MODES)[number];

type DiscordSelectableGuild = {
  organizationId: string;
  guildId: string;
  guildName: string | null;
  enabled: boolean;
  isPrimary: boolean;
};

type DiscordInstallStatePayload = {
  organizationId: string;
  actorId: string | null;
  nonce: string;
  exp: number;
};

const organizationSelect = {
  id: true,
  name: true,
  slug: true,
  status: true,
  subscriptionStatus: true,
  trialEndsAt: true,
  paidUntil: true,
  deletedAt: true,
  discordConfig: {
    select: {
      id: true,
      organizationId: true,
      enabled: true,
      guildId: true,
      guildName: true,
      hubCategoryId: true,
      hubCategoryName: true,
      registrationsChannelId: true,
      registrationsChannelName: true,
      slotsChannelId: true,
      slotsChannelName: true,
      resultsChannelId: true,
      resultsChannelName: true,
      standingsChannelId: true,
      standingsChannelName: true,
      supportChannelId: true,
      supportChannelName: true,
      logoChannelIds: true,
      organizerRoleId: true,
      organizerRoleName: true,
      captainRoleId: true,
      captainRoleName: true,
      participantRoleId: true,
      participantRoleName: true,
      earlyAccessRoleId: true,
      earlyAccessRoleName: true,
      vipAccessRoleId: true,
      vipAccessRoleName: true,
      staffRoleIds: true,
      botAvatarDataUri: true,
      botAvatarSyncedAt: true,
      maxSessionCount: true,
      maxGuildCount: true,
      eventServerAccessMode: true,
      accessExpiresAt: true,
      autoCreateSessionCategories: true,
      autoCreateSessionChannels: true,
      autoSyncRoles: true,
      sessionCategoryPrefix: true,
      sessionChannelPrefix: true,
      notes: true,
      lastValidatedAt: true,
      createdAt: true,
      updatedAt: true,
      updatedBy: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
    },
  },
  discordGuilds: {
    orderBy: [
      { isPrimary: 'desc' },
      { guildName: 'asc' },
      { createdAt: 'asc' },
    ],
    select: {
      id: true,
      organizationId: true,
      guildId: true,
      guildName: true,
      enabled: true,
      isPrimary: true,
      lastValidatedAt: true,
      botAvatarSyncedAt: true,
      createdAt: true,
      updatedAt: true,
    },
  },
} satisfies Prisma.OrganizationSelect;

type OrganizationWithDiscordConfig = Prisma.OrganizationGetPayload<{
  select: typeof organizationSelect;
}>;

type DiscordGuildChannel = {
  id: string;
  name: string;
  type: number;
  parent_id?: string | null;
  position?: number;
};

type DiscordGuildRole = {
  id: string;
  name: string;
  position?: number;
  permissions?: string;
  managed?: boolean;
};

@Injectable()
export class OrganizationDiscordService {
  constructor(private readonly prisma: PrismaService) {}

  private getActorRole(actor: Actor | null | undefined): Role | null {
    return actor?.actorRole ?? actor?.role ?? null;
  }

  private assertSuperAdmin(actor: Actor | null | undefined) {
    if (this.getActorRole(actor) !== Role.SUPER_ADMIN) {
      throw new ForbiddenException(
        'Only super admins can access Discord config',
      );
    }
  }

  private assertOrgScopedManager(
    actor: Actor | null | undefined,
    organizationId: string,
  ) {
    const role = this.getActorRole(actor);
    if (role === Role.SUPER_ADMIN) {
      return;
    }

    if (role !== Role.ADMIN && role !== Role.ORGANIZER) {
      throw new ForbiddenException('Not allowed to manage Discord config');
    }

    const actorOrgId = effectiveOrganizationId(actor ?? null);
    if (!actorOrgId || actorOrgId !== organizationId) {
      throw new ForbiddenException('Not allowed to manage this organization');
    }
  }

  private resolveActorOrganizationId(actor: Actor | null | undefined): string {
    const organizationId = effectiveOrganizationId(actor ?? null);
    if (!organizationId) {
      throw new ForbiddenException('Organization context missing');
    }
    return organizationId;
  }

  private async requireOrganization(
    organizationId: string,
  ): Promise<OrganizationWithDiscordConfig> {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: organizationSelect,
    });

    if (!organization || organization.deletedAt) {
      throw new NotFoundException('Organization not found');
    }

    return organization;
  }

  private subscriptionExpiresAt(
    organization: Pick<
      OrganizationWithDiscordConfig,
      'subscriptionStatus' | 'trialEndsAt' | 'paidUntil'
    >,
  ): Date | null {
    if (
      organization.subscriptionStatus === OrganizationSubscriptionStatus.ACTIVE
    ) {
      return organization.paidUntil ?? null;
    }

    const dates = [organization.trialEndsAt, organization.paidUntil].filter(
      (date): date is Date => Boolean(date),
    );
    if (dates.length === 0) return null;
    return dates.reduce((latest, date) =>
      date.getTime() > latest.getTime() ? date : latest,
    );
  }

  private discordAccessActive(organization: OrganizationWithDiscordConfig) {
    const config = organization.discordConfig;
    if ((config?.maxSessionCount ?? 1) <= 0) {
      return false;
    }
    return organizationHasActiveSubscription(organization);
  }

  private assertDiscordEntitlementActive(
    organization: OrganizationWithDiscordConfig,
  ) {
    const config = organization.discordConfig;
    if ((config?.maxSessionCount ?? 1) <= 0) {
      throw new ForbiddenException(
        'Discord session access is disabled for this organization',
      );
    }
    if (!this.discordAccessActive(organization)) {
      throw new ForbiddenException(
        'Discord session access has expired for this organization',
      );
    }
  }

  private normalizeOptionalString(
    value: string | null | undefined,
  ): string | null | undefined {
    if (value === undefined) return undefined;
    if (value === null) return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private normalizeDiscordSnowflake(
    value: string | null | undefined,
  ): string | null | undefined {
    if (value === undefined) return undefined;
    if (value === null) return null;
    const normalized = value.replace(/\s+/g, '');
    return normalized.length > 0 ? normalized : null;
  }

  private normalizeDiscordSnowflakeList(
    value: string[] | null | undefined,
  ): string[] | null | undefined {
    if (value === undefined) return undefined;
    if (value === null) return null;
    const normalized = value
      .map((item) => this.normalizeDiscordSnowflake(item))
      .filter((item): item is string => Boolean(item));
    return Array.from(new Set(normalized));
  }

  private normalizeDiscordSnowflakeText(
    value: string | null | undefined,
  ): string | null | undefined {
    if (value === undefined) return undefined;
    const ids = value?.match(/\d{15,25}/g) ?? [];
    const normalized = ids.filter((id, index) => ids.indexOf(id) === index);
    return normalized.length > 0 ? normalized.join('\n') : null;
  }

  private normalizeBotAvatarDataUri(
    value: string | null | undefined,
  ): string | null | undefined {
    if (value === undefined) return undefined;
    if (value === null) return null;

    const trimmed = value.trim();
    if (!trimmed) return null;

    const match = trimmed.match(DISCORD_BOT_AVATAR_DATA_URI);
    if (!match) {
      throw new BadRequestException(
        'botAvatarDataUri must be a PNG, JPG, GIF, or WEBP data URI',
      );
    }

    const bytes = Buffer.byteLength(match[2], 'base64');
    if (bytes <= 0) {
      throw new BadRequestException('botAvatarDataUri is empty');
    }
    if (bytes > DISCORD_BOT_AVATAR_MAX_BYTES) {
      throw new BadRequestException('Bot avatar must be 2 MB or smaller');
    }

    return trimmed;
  }

  private discordGuildAlreadyLinkedError() {
    return new BadRequestException(
      'This Discord server is already connected to another organization',
    );
  }

  private isDiscordGuildUniqueConflict(error: unknown): boolean {
    const candidate = error as {
      code?: unknown;
      meta?: { target?: unknown };
    };
    if (candidate?.code !== 'P2002') {
      return false;
    }

    const target = candidate.meta?.target;
    if (Array.isArray(target)) {
      return target.includes('guildId');
    }

    return typeof target === 'string' && target.includes('guildId');
  }

  private rethrowDiscordGuildConflict(error: unknown): never {
    if (this.isDiscordGuildUniqueConflict(error)) {
      throw this.discordGuildAlreadyLinkedError();
    }
    throw error;
  }

  private async assertDiscordGuildAvailableForOrganization(
    guildId: string | null | undefined,
    organizationId: string,
  ) {
    const normalizedGuildId = this.normalizeDiscordSnowflake(guildId);
    if (!normalizedGuildId) {
      return;
    }

    const existing = await this.prisma.organizationDiscordConfig.findFirst({
      where: {
        guildId: normalizedGuildId,
        organizationId: { not: organizationId },
        enabled: true,
        organization: { deletedAt: null },
      },
      select: { organizationId: true },
    });

    if (existing) {
      throw this.discordGuildAlreadyLinkedError();
    }

    const guildDelegate = (
      this.prisma as unknown as {
        organizationDiscordGuild?: {
          findFirst?: (args: {
            where: {
              guildId: string;
              organizationId: { not: string };
              enabled: true;
              organization: { deletedAt: null };
            };
            select: { organizationId: true };
          }) => Promise<{ organizationId: string } | null>;
        };
      }
    ).organizationDiscordGuild;
    const linkedGuild = guildDelegate?.findFirst
      ? await guildDelegate.findFirst({
          where: {
            guildId: normalizedGuildId,
            organizationId: { not: organizationId },
            enabled: true,
            organization: { deletedAt: null },
          },
          select: { organizationId: true },
        })
      : null;

    if (linkedGuild) {
      throw this.discordGuildAlreadyLinkedError();
    }
  }

  private connectedGuilds(organization: OrganizationWithDiscordConfig) {
    const byGuildId = new Map<
      string,
      {
        id: string | null;
        organizationId: string;
        guildId: string;
        guildName: string | null;
        enabled: boolean;
        isPrimary: boolean;
        lastValidatedAt: Date | null;
        botAvatarSyncedAt: Date | null;
        createdAt: Date | null;
        updatedAt: Date | null;
      }
    >();

    for (const guild of organization.discordGuilds ?? []) {
      const guildId = guild.guildId?.trim();
      if (!guildId) continue;
      byGuildId.set(guildId, {
        id: guild.id,
        organizationId: guild.organizationId,
        guildId,
        guildName: guild.guildName ?? null,
        enabled: guild.enabled,
        isPrimary: guild.isPrimary,
        lastValidatedAt: guild.lastValidatedAt ?? null,
        botAvatarSyncedAt: guild.botAvatarSyncedAt ?? null,
        createdAt: guild.createdAt ?? null,
        updatedAt: guild.updatedAt ?? null,
      });
    }

    const legacyGuildId = organization.discordConfig?.guildId?.trim();
    if (legacyGuildId && !byGuildId.has(legacyGuildId)) {
      byGuildId.set(legacyGuildId, {
        id: null,
        organizationId: organization.id,
        guildId: legacyGuildId,
        guildName: organization.discordConfig?.guildName ?? null,
        enabled: organization.discordConfig?.enabled ?? true,
        isPrimary: true,
        lastValidatedAt: organization.discordConfig?.lastValidatedAt ?? null,
        botAvatarSyncedAt:
          organization.discordConfig?.botAvatarSyncedAt ?? null,
        createdAt: organization.discordConfig?.createdAt ?? null,
        updatedAt: organization.discordConfig?.updatedAt ?? null,
      });
    }

    return Array.from(byGuildId.values()).sort((left, right) => {
      if (left.isPrimary !== right.isPrimary) {
        return left.isPrimary ? -1 : 1;
      }
      return (left.guildName || left.guildId).localeCompare(
        right.guildName || right.guildId,
      );
    });
  }

  private primaryGuild(organization: OrganizationWithDiscordConfig) {
    return this.connectedGuilds(organization)[0] ?? null;
  }

  private eventServerAccessMode(
    organization: OrganizationWithDiscordConfig,
  ): DiscordEventServerAccessMode {
    const mode = organization.discordConfig?.eventServerAccessMode;
    return DISCORD_EVENT_SERVER_ACCESS_MODES.includes(
      mode as DiscordEventServerAccessMode,
    )
      ? (mode as DiscordEventServerAccessMode)
      : 'PRIMARY';
  }

  private async selectableEventGuilds(
    organization: OrganizationWithDiscordConfig,
  ): Promise<DiscordSelectableGuild[]> {
    const connectedGuilds = this.connectedGuilds(organization)
      .filter((guild) => guild.enabled)
      .map((guild) => ({
        organizationId: guild.organizationId,
        guildId: guild.guildId,
        guildName: guild.guildName,
        enabled: guild.enabled,
        isPrimary: guild.isPrimary,
      }));
    const mode = this.eventServerAccessMode(organization);

    if (mode === 'ALL_BOT') {
      const allGuilds = await this.prisma.organizationDiscordGuild.findMany({
        where: {
          enabled: true,
          organization: { deletedAt: null },
        },
        orderBy: [{ guildName: 'asc' }, { createdAt: 'asc' }],
        select: {
          organizationId: true,
          guildId: true,
          guildName: true,
          enabled: true,
          isPrimary: true,
        },
      });
      const byGuildId = new Map<string, DiscordSelectableGuild>();
      for (const guild of [...connectedGuilds, ...allGuilds]) {
        const guildId = guild.guildId?.trim();
        if (!guildId || byGuildId.has(guildId)) continue;
        byGuildId.set(guildId, {
          organizationId: guild.organizationId,
          guildId,
          guildName: guild.guildName ?? null,
          enabled: guild.enabled,
          isPrimary: guild.isPrimary,
        });
      }
      return Array.from(byGuildId.values()).sort((left, right) =>
        (left.guildName || left.guildId).localeCompare(
          right.guildName || right.guildId,
        ),
      );
    }

    if (mode === 'CONNECTED') {
      return connectedGuilds;
    }

    return connectedGuilds.slice(0, 1);
  }

  private async findOrganizationGuild(organizationId: string, guildId: string) {
    return (
      this.prisma.organizationDiscordGuild?.findFirst?.({
        where: {
          organizationId,
          guildId,
          organization: { deletedAt: null },
        },
        select: {
          id: true,
          organizationId: true,
          guildId: true,
          guildName: true,
          enabled: true,
          isPrimary: true,
        },
      }) ?? null
    );
  }

  private async assertGuildLimitAllowsConnect(
    organization: OrganizationWithDiscordConfig,
    guildId: string,
  ) {
    const existing = await this.findOrganizationGuild(organization.id, guildId);
    if (existing) {
      return;
    }

    const maxGuildCount = organization.discordConfig?.maxGuildCount ?? 1;
    if (maxGuildCount <= 0) {
      throw new ForbiddenException(
        'Discord server access is disabled for this organization',
      );
    }

    const connectedCount =
      (await this.prisma.organizationDiscordGuild?.count?.({
        where: { organizationId: organization.id, enabled: true },
      })) ??
      this.connectedGuilds(organization).filter((guild) => guild.enabled)
        .length;
    if (connectedCount >= maxGuildCount) {
      throw new ForbiddenException(
        `Discord server limit reached (${connectedCount}/${maxGuildCount})`,
      );
    }
  }

  private async upsertConnectedGuild(params: {
    organization: OrganizationWithDiscordConfig;
    guildId: string;
    guildName: string | null;
    actor: Actor | null | undefined;
    botAvatarSyncedAt?: Date | null;
  }) {
    const existingGuilds = this.connectedGuilds(params.organization);
    const hasOtherActivePrimary = existingGuilds.some(
      (guild) =>
        guild.guildId !== params.guildId && guild.enabled && guild.isPrimary,
    );
    const shouldBePrimary = !hasOtherActivePrimary;
    const now = new Date();

    await this.prisma.organizationDiscordGuild?.upsert?.({
      where: { guildId: params.guildId },
      update: {
        organizationId: params.organization.id,
        guildName: params.guildName,
        enabled: true,
        isPrimary: shouldBePrimary,
        lastValidatedAt: now,
        botAvatarSyncedAt: params.botAvatarSyncedAt ?? undefined,
      },
      create: {
        organizationId: params.organization.id,
        guildId: params.guildId,
        guildName: params.guildName,
        enabled: true,
        isPrimary: shouldBePrimary,
        lastValidatedAt: now,
        botAvatarSyncedAt: params.botAvatarSyncedAt ?? undefined,
      },
    });

    const updateLegacyPrimary =
      shouldBePrimary ||
      !params.organization.discordConfig?.guildId ||
      params.organization.discordConfig?.enabled === false;

    const configData: Prisma.OrganizationDiscordConfigUncheckedUpdateInput = {
      enabled: true,
      lastValidatedAt: now,
    };
    if (updateLegacyPrimary) {
      configData.guildId = params.guildId;
      configData.guildName = params.guildName;
    }
    if (params.botAvatarSyncedAt) {
      configData.botAvatarSyncedAt = params.botAvatarSyncedAt;
    }
    if (params.actor?.id) {
      configData.updatedById = params.actor.id;
    }

    await this.prisma.organizationDiscordConfig.upsert({
      where: { organizationId: params.organization.id },
      update: configData,
      create: Object.assign({}, configData, {
        organizationId: params.organization.id,
      }) as Prisma.OrganizationDiscordConfigUncheckedCreateInput,
    });
  }

  private optionalEnvValue(...names: string[]): string | null {
    for (const name of names) {
      const value = process.env[name]?.trim();
      if (value) {
        return value;
      }
    }
    return null;
  }

  private discordBotToken(): string {
    const token = this.optionalEnvValue('DISCORD_BOT_TOKEN', 'DISCORD_TOKEN');
    if (!token) {
      throw new ServiceUnavailableException(
        'Discord bot token is not configured',
      );
    }
    return token;
  }

  private async fetchDiscordJson<T>(path: string): Promise<T> {
    const response = await fetch(`${DISCORD_API_BASE_URL}${path}`, {
      headers: {
        Authorization: `Bot ${this.discordBotToken()}`,
      },
    });

    if (response.ok) {
      return (await response.json()) as T;
    }

    let detail = '';
    try {
      const payload = (await response.json()) as { message?: unknown };
      if (typeof payload.message === 'string') {
        detail = `: ${payload.message}`;
      }
    } catch {
      detail = '';
    }

    throw new BadRequestException(
      `Discord request failed (${response.status})${detail}`,
    );
  }

  private discordClientId(): string {
    const clientId = this.optionalEnvValue(
      'DISCORD_CLIENT_ID',
      'ARENZYRA_DISCORD_CLIENT_ID',
    );
    if (!clientId) {
      throw new ServiceUnavailableException(
        'Discord client ID is not configured',
      );
    }
    return clientId;
  }

  private discordRedirectUri(): string {
    const configured = this.optionalEnvValue(
      'DISCORD_REDIRECT_URI',
      'ARENZYRA_DISCORD_REDIRECT_URI',
    );
    if (configured) {
      return configured;
    }

    const webOrigin =
      this.optionalEnvValue(
        'WEB_APP_ORIGIN',
        'FRONTEND_ORIGIN',
        'NEXT_PUBLIC_SITE_URL',
        'APP_URL',
      ) ?? 'http://localhost:3001';

    return `${webOrigin.replace(/\/+$/, '')}/organizer/discord/callback`;
  }

  private discordInstallStateSecret(): string {
    return (
      this.optionalEnvValue(
        'DISCORD_INSTALL_STATE_SECRET',
        'ARENZYRA_DISCORD_INSTALL_STATE_SECRET',
      ) ??
      this.optionalEnvValue('JWT_SECRET') ??
      env.JWT_SECRET
    );
  }

  private signInstallState(encodedPayload: string): string {
    return createHmac('sha256', this.discordInstallStateSecret())
      .update(encodedPayload)
      .digest('base64url');
  }

  private createInstallState(
    actor: Actor | null | undefined,
    organizationId: string,
  ): {
    state: string;
    expiresAt: Date;
  } {
    const expiresAt = new Date(Date.now() + DISCORD_INSTALL_STATE_TTL_MS);
    const payload: DiscordInstallStatePayload = {
      organizationId,
      actorId: actor?.id ?? null,
      nonce: randomBytes(16).toString('base64url'),
      exp: expiresAt.getTime(),
    };
    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString(
      'base64url',
    );
    const signature = this.signInstallState(encodedPayload);

    return {
      state: `${encodedPayload}.${signature}`,
      expiresAt,
    };
  }

  private verifyInstallState(state: string): DiscordInstallStatePayload {
    const [encodedPayload, signature, extra] = state.split('.');
    if (!encodedPayload || !signature || extra !== undefined) {
      throw new BadRequestException('Invalid Discord install state');
    }

    const expectedSignature = this.signInstallState(encodedPayload);
    const received = Buffer.from(signature, 'base64url');
    const expected = Buffer.from(expectedSignature, 'base64url');
    if (
      received.length !== expected.length ||
      !timingSafeEqual(received, expected)
    ) {
      throw new BadRequestException('Invalid Discord install state');
    }

    let payload: DiscordInstallStatePayload;
    try {
      payload = JSON.parse(
        Buffer.from(encodedPayload, 'base64url').toString('utf8'),
      ) as DiscordInstallStatePayload;
    } catch {
      throw new BadRequestException('Invalid Discord install state');
    }

    if (
      !payload ||
      typeof payload.organizationId !== 'string' ||
      (payload.actorId !== null && typeof payload.actorId !== 'string') ||
      typeof payload.nonce !== 'string' ||
      typeof payload.exp !== 'number'
    ) {
      throw new BadRequestException('Invalid Discord install state');
    }

    if (!Number.isFinite(payload.exp) || payload.exp < Date.now()) {
      throw new BadRequestException('Discord install state expired');
    }

    return payload;
  }

  private async fetchDiscordGuildName(guildId: string): Promise<string | null> {
    const token = this.optionalEnvValue('DISCORD_BOT_TOKEN', 'DISCORD_TOKEN');
    if (!token) {
      return null;
    }

    try {
      const response = await fetch(
        `${DISCORD_API_BASE_URL}/guilds/${guildId}`,
        {
          headers: {
            Authorization: `Bot ${token}`,
          },
        },
      );

      if (!response.ok) {
        return null;
      }

      const payload = (await response.json()) as { name?: unknown };
      return typeof payload.name === 'string' && payload.name.trim()
        ? payload.name.trim()
        : null;
    } catch {
      return null;
    }
  }

  private async validateDiscordGuildAccess(guildId: string): Promise<{
    ok: boolean;
    guildName: string | null;
    status: number;
  }> {
    let response: Response;
    try {
      response = await fetch(`${DISCORD_API_BASE_URL}/guilds/${guildId}`, {
        headers: {
          Authorization: `Bot ${this.discordBotToken()}`,
        },
      });
    } catch {
      throw new ServiceUnavailableException(
        'Unable to reach Discord while refreshing the server connection',
      );
    }

    let guildName: string | null = null;
    let detail = '';
    try {
      const payload = (await response.json()) as {
        name?: unknown;
        message?: unknown;
      };
      if (typeof payload.name === 'string' && payload.name.trim()) {
        guildName = payload.name.trim();
      }
      if (typeof payload.message === 'string' && payload.message.trim()) {
        detail = `: ${payload.message.trim()}`;
      }
    } catch {
      detail = '';
    }

    if (response.ok) {
      return { ok: true, guildName, status: response.status };
    }

    if (response.status === 403 || response.status === 404) {
      return { ok: false, guildName: null, status: response.status };
    }

    throw new BadRequestException(
      `Discord request failed (${response.status})${detail}`,
    );
  }

  private async syncBotAvatar(
    guildId: string,
    avatarDataUri: string | null,
  ): Promise<void> {
    const response = await fetch(
      `${DISCORD_API_BASE_URL}/guilds/${guildId}/members/@me`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bot ${this.discordBotToken()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ avatar: avatarDataUri }),
      },
    );

    if (response.ok) return;

    let detail = '';
    try {
      const body = (await response.json()) as {
        message?: unknown;
        code?: unknown;
      };
      if (typeof body.message === 'string') {
        detail = `: ${body.message}`;
      }
    } catch {
      detail = '';
    }

    throw new BadRequestException(
      `Discord rejected the bot avatar update (${response.status})${detail}`,
    );
  }

  private buildPatchData(
    actor: Actor | null | undefined,
    dto: UpdateOrganizationDiscordConfigDto,
    options: { allowSuperAdminManagedFields: boolean },
  ): Prisma.OrganizationDiscordConfigUncheckedUpdateInput {
    const data: Prisma.OrganizationDiscordConfigUncheckedUpdateInput = {};

    if (dto.enabled !== undefined) data.enabled = dto.enabled;
    const assignString = (
      key: keyof Prisma.OrganizationDiscordConfigUncheckedUpdateInput,
      value: string | undefined,
    ) => {
      const normalized = this.normalizeOptionalString(value);
      if (normalized !== undefined) {
        (data as Record<string, string | null | boolean | undefined>)[
          key as string
        ] = normalized;
      }
    };
    const assignSnowflake = (
      key: keyof Prisma.OrganizationDiscordConfigUncheckedUpdateInput,
      value: string | undefined,
    ) => {
      const normalized = this.normalizeDiscordSnowflake(value);
      if (normalized !== undefined) {
        (data as Record<string, string | null | boolean | undefined>)[
          key as string
        ] = normalized;
      }
    };

    if (options.allowSuperAdminManagedFields) {
      assignString('guildName', dto.guildName);
      if (dto.maxSessionCount !== undefined) {
        data.maxSessionCount = dto.maxSessionCount;
      }
      if (dto.maxGuildCount !== undefined) {
        data.maxGuildCount = dto.maxGuildCount;
      }
      if (dto.eventServerAccessMode !== undefined) {
        data.eventServerAccessMode = dto.eventServerAccessMode;
      }
      // Discord access expiry is derived from the organization subscription.
      // The legacy per-Discord expiry field is intentionally no longer written.
    }
    assignString('hubCategoryName', dto.hubCategoryName);
    assignString('registrationsChannelName', dto.registrationsChannelName);
    assignString('slotsChannelName', dto.slotsChannelName);
    assignString('resultsChannelName', dto.resultsChannelName);
    assignString('standingsChannelName', dto.standingsChannelName);
    assignString('supportChannelName', dto.supportChannelName);
    const logoChannelIds = this.normalizeDiscordSnowflakeText(
      dto.logoChannelIds,
    );
    if (logoChannelIds !== undefined) {
      data.logoChannelIds = logoChannelIds;
    }
    if (options.allowSuperAdminManagedFields) {
      assignString('organizerRoleName', dto.organizerRoleName);
    }
    assignString('captainRoleName', dto.captainRoleName);
    assignString('participantRoleName', dto.participantRoleName);
    assignString('earlyAccessRoleName', dto.earlyAccessRoleName);
    assignString('vipAccessRoleName', dto.vipAccessRoleName);
    const botAvatarDataUri = this.normalizeBotAvatarDataUri(
      dto.botAvatarDataUri,
    );
    if (botAvatarDataUri !== undefined) {
      data.botAvatarDataUri = botAvatarDataUri;
    }
    assignString('sessionCategoryPrefix', dto.sessionCategoryPrefix);
    assignString('sessionChannelPrefix', dto.sessionChannelPrefix);
    assignString('notes', dto.notes);

    if (options.allowSuperAdminManagedFields) {
      assignSnowflake('guildId', dto.guildId);
    }
    assignSnowflake('hubCategoryId', dto.hubCategoryId);
    assignSnowflake('registrationsChannelId', dto.registrationsChannelId);
    assignSnowflake('slotsChannelId', dto.slotsChannelId);
    assignSnowflake('resultsChannelId', dto.resultsChannelId);
    assignSnowflake('standingsChannelId', dto.standingsChannelId);
    assignSnowflake('supportChannelId', dto.supportChannelId);
    if (options.allowSuperAdminManagedFields) {
      assignSnowflake('organizerRoleId', dto.organizerRoleId);
    }
    assignSnowflake('captainRoleId', dto.captainRoleId);
    assignSnowflake('participantRoleId', dto.participantRoleId);
    assignSnowflake('earlyAccessRoleId', dto.earlyAccessRoleId);
    assignSnowflake('vipAccessRoleId', dto.vipAccessRoleId);
    const staffRoleIds = this.normalizeDiscordSnowflakeList(dto.staffRoleIds);
    if (staffRoleIds !== undefined) {
      data.staffRoleIds = staffRoleIds === null ? Prisma.DbNull : staffRoleIds;
    }

    if (dto.autoCreateSessionCategories !== undefined) {
      data.autoCreateSessionCategories = dto.autoCreateSessionCategories;
    }
    if (dto.autoCreateSessionChannels !== undefined) {
      data.autoCreateSessionChannels = dto.autoCreateSessionChannels;
    }
    if (dto.autoSyncRoles !== undefined) {
      data.autoSyncRoles = dto.autoSyncRoles;
    }

    if (actor?.id) {
      data.updatedById = actor.id;
    }

    return data;
  }

  private toView(organization: OrganizationWithDiscordConfig) {
    const config = organization.discordConfig ?? null;
    const subscriptionExpiresAt = this.subscriptionExpiresAt(organization);
    const discordAccessActive = this.discordAccessActive(organization);
    const connectedGuilds = this.connectedGuilds(organization);
    const activeGuilds = connectedGuilds.filter((guild) => guild.enabled);
    const primaryGuild = activeGuilds[0] ?? null;
    const configuredChannelCount = [
      config?.registrationsChannelId,
      config?.slotsChannelId,
      config?.resultsChannelId,
      config?.standingsChannelId,
      config?.supportChannelId,
      config?.logoChannelIds,
    ].filter(Boolean).length;
    const configuredRoleCount = [
      config?.organizerRoleId,
      config?.captainRoleId,
      config?.participantRoleId,
      config?.earlyAccessRoleId,
      config?.vipAccessRoleId,
      ...(Array.isArray(config?.staffRoleIds)
        ? (config?.staffRoleIds as unknown[])
        : []),
    ].filter(Boolean).length;
    const summary = {
      hasGuildConnection: activeGuilds.length > 0,
      hasHubCategory: Boolean(config?.hubCategoryId),
      configuredChannelCount,
      configuredRoleCount,
      connectedGuildCount: activeGuilds.length,
      maxGuildCount: config?.maxGuildCount ?? 1,
      eventServerAccessMode: this.eventServerAccessMode(organization),
      automationEnabled: Boolean(
        config?.autoCreateSessionCategories ||
        config?.autoCreateSessionChannels ||
        config?.autoSyncRoles,
      ),
    };

    return {
      organization: {
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
        status: organization.status,
      },
      subscriptionStatus: organization.subscriptionStatus,
      subscriptionExpiresAt: subscriptionExpiresAt?.toISOString() ?? null,
      discordAccessActive,
      exists: Boolean(config),
      enabled: Boolean(config?.enabled && (primaryGuild?.enabled ?? true)),
      guildId: primaryGuild?.guildId ?? null,
      guildName: primaryGuild?.guildName ?? null,
      connectedGuilds: activeGuilds.map((guild) => ({
        id: guild.id,
        organizationId: guild.organizationId,
        guildId: guild.guildId,
        guildName: guild.guildName,
        enabled: guild.enabled,
        isPrimary: guild.isPrimary,
        lastValidatedAt: guild.lastValidatedAt?.toISOString() ?? null,
        botAvatarSyncedAt: guild.botAvatarSyncedAt?.toISOString() ?? null,
        createdAt: guild.createdAt?.toISOString() ?? null,
        updatedAt: guild.updatedAt?.toISOString() ?? null,
      })),
      hubCategoryId: config?.hubCategoryId ?? null,
      hubCategoryName: config?.hubCategoryName ?? null,
      registrationsChannelId: config?.registrationsChannelId ?? null,
      registrationsChannelName: config?.registrationsChannelName ?? null,
      slotsChannelId: config?.slotsChannelId ?? null,
      slotsChannelName: config?.slotsChannelName ?? null,
      resultsChannelId: config?.resultsChannelId ?? null,
      resultsChannelName: config?.resultsChannelName ?? null,
      standingsChannelId: config?.standingsChannelId ?? null,
      standingsChannelName: config?.standingsChannelName ?? null,
      supportChannelId: config?.supportChannelId ?? null,
      supportChannelName: config?.supportChannelName ?? null,
      logoChannelIds: config?.logoChannelIds ?? null,
      organizerRoleId: config?.organizerRoleId ?? null,
      organizerRoleName: config?.organizerRoleName ?? null,
      captainRoleId: config?.captainRoleId ?? null,
      captainRoleName: config?.captainRoleName ?? null,
      participantRoleId: config?.participantRoleId ?? null,
      participantRoleName: config?.participantRoleName ?? null,
      earlyAccessRoleId: config?.earlyAccessRoleId ?? null,
      earlyAccessRoleName: config?.earlyAccessRoleName ?? null,
      vipAccessRoleId: config?.vipAccessRoleId ?? null,
      vipAccessRoleName: config?.vipAccessRoleName ?? null,
      staffRoleIds: Array.isArray(config?.staffRoleIds)
        ? config.staffRoleIds
            .map((roleId) =>
              typeof roleId === 'string' || typeof roleId === 'number'
                ? String(roleId).trim()
                : '',
            )
            .filter((roleId) => roleId.length > 0)
        : [],
      botAvatarDataUri: config?.botAvatarDataUri ?? null,
      botAvatarSyncedAt: config?.botAvatarSyncedAt ?? null,
      maxSessionCount: config?.maxSessionCount ?? 1,
      maxGuildCount: config?.maxGuildCount ?? 1,
      eventServerAccessMode: this.eventServerAccessMode(organization),
      accessExpiresAt: subscriptionExpiresAt?.toISOString() ?? null,
      storedAccessExpiresAt: config?.accessExpiresAt?.toISOString() ?? null,
      autoCreateSessionCategories: config?.autoCreateSessionCategories ?? false,
      autoCreateSessionChannels: config?.autoCreateSessionChannels ?? false,
      autoSyncRoles: config?.autoSyncRoles ?? false,
      sessionCategoryPrefix: config?.sessionCategoryPrefix ?? null,
      sessionChannelPrefix: config?.sessionChannelPrefix ?? null,
      notes: config?.notes ?? null,
      createdAt: config?.createdAt ?? null,
      updatedAt: config?.updatedAt ?? null,
      lastValidatedAt: config?.lastValidatedAt ?? null,
      updatedBy: config?.updatedBy ?? null,
      summary,
    };
  }

  async getForActor(actor: Actor | null | undefined) {
    const organizationId = this.resolveActorOrganizationId(actor);
    this.assertOrgScopedManager(actor, organizationId);
    const updatedOrganization = await this.requireOrganization(organizationId);
    return this.toView(updatedOrganization);
  }

  async validateForActor(actor: Actor | null | undefined) {
    const organizationId = this.resolveActorOrganizationId(actor);
    this.assertOrgScopedManager(actor, organizationId);
    const organization = await this.requireOrganization(organizationId);
    this.assertDiscordEntitlementActive(organization);

    const connectedGuilds = this.connectedGuilds(organization);
    if (connectedGuilds.length === 0) {
      return this.toView(organization);
    }

    const validatedAt = new Date();
    for (const guild of connectedGuilds) {
      const validation = await this.validateDiscordGuildAccess(guild.guildId);
      const guildName = validation.ok
        ? (validation.guildName ?? guild.guildName)
        : guild.guildName;

      if (guild.id) {
        await this.prisma.organizationDiscordGuild.updateMany({
          where: {
            organizationId,
            guildId: guild.guildId,
          },
          data: {
            enabled: validation.ok,
            guildName,
            lastValidatedAt: validatedAt,
          },
        });
      }

      if (guild.isPrimary || !guild.id) {
        await this.prisma.organizationDiscordConfig.updateMany({
          where: { organizationId },
          data: {
            enabled: validation.ok,
            guildName,
            lastValidatedAt: validatedAt,
          },
        });
      }
    }

    const updatedOrganization = await this.requireOrganization(organizationId);
    return this.toView(updatedOrganization);
  }

  async markGuildRemovedByBot(
    actor: Actor | null | undefined,
    dto: MarkDiscordGuildRemovedDto,
  ) {
    if (!actor?.serviceToken) {
      throw new ForbiddenException('Bot service token required');
    }

    const guildId = this.normalizeDiscordSnowflake(dto.guildId);
    if (!guildId) {
      throw new BadRequestException('guildId is required');
    }

    const disabledAt = new Date();
    const guildLinks = await this.prisma.organizationDiscordGuild.updateMany({
      where: {
        guildId,
        enabled: true,
        organization: { deletedAt: null },
      },
      data: {
        enabled: false,
        lastValidatedAt: disabledAt,
      },
    });
    const primaryConfigs =
      await this.prisma.organizationDiscordConfig.updateMany({
        where: {
          guildId,
          enabled: true,
          organization: { deletedAt: null },
        },
        data: {
          enabled: false,
          lastValidatedAt: disabledAt,
        },
      });

    return {
      guildId,
      guildName: dto.guildName?.trim() || null,
      disabledGuildLinks: guildLinks.count,
      disabledPrimaryConfigs: primaryConfigs.count,
      disabledAt: disabledAt.toISOString(),
    };
  }

  async listGuildChannelsForActor(
    actor: Actor | null | undefined,
    requestedGuildId?: string | null,
  ) {
    const organizationId = this.resolveActorOrganizationId(actor);
    this.assertOrgScopedManager(actor, organizationId);
    const organization = await this.requireOrganization(organizationId);
    this.assertDiscordEntitlementActive(organization);

    const selectableGuilds = await this.selectableEventGuilds(organization);
    const mode = this.eventServerAccessMode(organization);
    const normalizedRequestedGuildId =
      this.normalizeDiscordSnowflake(requestedGuildId);
    const selectedGuild = normalizedRequestedGuildId
      ? selectableGuilds.find(
          (guild) => guild.guildId === normalizedRequestedGuildId,
        )
      : (selectableGuilds[0] ?? null);

    if (normalizedRequestedGuildId && !selectedGuild) {
      throw new ForbiddenException(
        mode === 'ALL_BOT'
          ? 'Discord server is not available to this organization'
          : 'Discord server is not connected to this organization',
      );
    }

    const guildId = selectedGuild?.guildId ?? null;
    if (!guildId) {
      return {
        guildId: null,
        guildName: null,
        categories: [],
        textChannels: [],
        roles: [],
        eventServerAccessMode: mode,
        canSelectEventServer: false,
        availableGuilds: [],
      };
    }

    const [guild, channels, roles] = await Promise.all([
      this.fetchDiscordJson<{ id: string; name?: string }>(
        `/guilds/${guildId}`,
      ),
      this.fetchDiscordJson<DiscordGuildChannel[]>(
        `/guilds/${guildId}/channels`,
      ),
      this.fetchDiscordJson<DiscordGuildRole[]>(`/guilds/${guildId}/roles`),
    ]);
    const categories = channels
      .filter((channel) => channel.type === DISCORD_GUILD_CATEGORY_CHANNEL)
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
      .map((channel) => ({
        id: channel.id,
        name: channel.name,
      }));
    const categoryNames = new Map(
      categories.map((category) => [category.id, category.name]),
    );
    const textChannels = channels
      .filter((channel) => channel.type === DISCORD_GUILD_TEXT_CHANNEL)
      .sort((a, b) => {
        const parentCompare = (a.parent_id ?? '').localeCompare(
          b.parent_id ?? '',
        );
        if (parentCompare !== 0) return parentCompare;
        return (a.position ?? 0) - (b.position ?? 0);
      })
      .map((channel) => ({
        id: channel.id,
        name: channel.name,
        parentId: channel.parent_id ?? null,
        parentName: channel.parent_id
          ? (categoryNames.get(channel.parent_id) ?? null)
          : null,
      }));

    return {
      guildId,
      guildName:
        typeof guild.name === 'string' && guild.name.trim()
          ? guild.name.trim()
          : (selectedGuild?.guildName ?? null),
      eventServerAccessMode: mode,
      canSelectEventServer: mode !== 'PRIMARY' && selectableGuilds.length > 1,
      availableGuilds: selectableGuilds.map((guild) => ({
        organizationId: guild.organizationId,
        guildId: guild.guildId,
        guildName: guild.guildName,
        isPrimary: guild.isPrimary,
      })),
      categories,
      textChannels,
      roles: roles
        .filter((role) => role.id !== guildId && role.managed !== true)
        .sort((a, b) => (b.position ?? 0) - (a.position ?? 0))
        .map((role) => ({
          id: role.id,
          name: role.name,
          permissions: role.permissions ?? '0',
        })),
    };
  }

  private buildInstallUrl(
    actor: Actor | null | undefined,
    organizationId: string,
  ) {
    const clientId = this.discordClientId();
    const redirectUri = this.discordRedirectUri();
    const { state, expiresAt } = this.createInstallState(actor, organizationId);
    const url = new URL(DISCORD_OAUTH_AUTHORIZE_URL);

    url.searchParams.set('client_id', clientId);
    url.searchParams.set('permissions', DISCORD_ADMINISTRATOR_PERMISSION);
    url.searchParams.set('scope', 'bot applications.commands');
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('disable_guild_select', 'false');
    url.searchParams.set('state', state);

    return {
      url: url.toString(),
      expiresAt: expiresAt.toISOString(),
      redirectUri,
    };
  }

  async createInstallUrlForSuperAdmin(
    actor: Actor | null | undefined,
    organizationId: string,
  ) {
    this.assertSuperAdmin(actor);
    await this.requireOrganization(organizationId);
    return this.buildInstallUrl(actor, organizationId);
  }

  async createInstallUrl(actor: Actor | null | undefined) {
    const organizationId = this.resolveActorOrganizationId(actor);
    this.assertOrgScopedManager(actor, organizationId);
    this.assertDiscordEntitlementActive(
      await this.requireOrganization(organizationId),
    );
    return this.buildInstallUrl(actor, organizationId);
  }

  private async persistCompletedInstall(
    actor: Actor | null | undefined,
    dto: CompleteDiscordInstallDto,
    organizationId: string,
  ) {
    const payload = this.verifyInstallState(dto.state);

    if (payload.organizationId !== organizationId) {
      throw new BadRequestException(
        'Discord install state does not match this organization',
      );
    }
    if (payload.actorId && actor?.id && payload.actorId !== actor.id) {
      throw new BadRequestException(
        'Discord install state does not match this user',
      );
    }

    const guildId = this.normalizeDiscordSnowflake(dto.guildId ?? dto.guild_id);
    if (!guildId) {
      throw new BadRequestException(
        'Discord did not return a server ID. Please try connecting again.',
      );
    }

    const existingOrganization = await this.requireOrganization(organizationId);
    await this.assertDiscordGuildAvailableForOrganization(
      guildId,
      organizationId,
    );
    await this.assertGuildLimitAllowsConnect(existingOrganization, guildId);

    const guildName =
      (await this.fetchDiscordGuildName(guildId)) ??
      this.connectedGuilds(existingOrganization).find(
        (guild) => guild.guildId === guildId,
      )?.guildName ??
      `Discord Server ${guildId}`;
    let botAvatarSyncedAt: Date | null = null;
    if (existingOrganization.discordConfig?.botAvatarDataUri) {
      await this.syncBotAvatar(
        guildId,
        existingOrganization.discordConfig.botAvatarDataUri,
      );
      botAvatarSyncedAt = new Date();
    }

    try {
      await this.upsertConnectedGuild({
        organization: existingOrganization,
        guildId,
        guildName,
        actor,
        botAvatarSyncedAt,
      });
    } catch (error) {
      this.rethrowDiscordGuildConflict(error);
    }

    const updatedOrganization = await this.requireOrganization(organizationId);
    return this.toView(updatedOrganization);
  }

  async completeInstallForSuperAdmin(
    actor: Actor | null | undefined,
    dto: CompleteDiscordInstallDto,
  ) {
    this.assertSuperAdmin(actor);
    const payload = this.verifyInstallState(dto.state);

    if (payload.actorId && actor?.id && payload.actorId !== actor.id) {
      throw new BadRequestException(
        'Discord install state does not match this user',
      );
    }

    return this.persistCompletedInstall(actor, dto, payload.organizationId);
  }

  async completeInstall(
    actor: Actor | null | undefined,
    dto: CompleteDiscordInstallDto,
  ) {
    const organizationId = this.resolveActorOrganizationId(actor);
    this.assertOrgScopedManager(actor, organizationId);
    this.assertDiscordEntitlementActive(
      await this.requireOrganization(organizationId),
    );
    return this.persistCompletedInstall(actor, dto, organizationId);
  }

  private async applyBotAvatarUpdateIfNeeded(
    data: Prisma.OrganizationDiscordConfigUncheckedUpdateInput,
    organization: OrganizationWithDiscordConfig,
  ) {
    if (!Object.prototype.hasOwnProperty.call(data, 'botAvatarDataUri')) {
      return;
    }

    const avatarDataUri =
      typeof data.botAvatarDataUri === 'string' ? data.botAvatarDataUri : null;
    const currentAvatarDataUri =
      organization.discordConfig?.botAvatarDataUri ?? null;
    if (avatarDataUri === currentAvatarDataUri) {
      return;
    }

    const connectedGuilds = this.connectedGuilds(organization);
    const explicitGuildId =
      typeof data.guildId === 'string' && data.guildId ? data.guildId : null;
    const explicitGuild = explicitGuildId
      ? connectedGuilds.find((guild) => guild.guildId === explicitGuildId)
      : null;
    const targetGuildIds = explicitGuildId
      ? explicitGuild?.enabled === false
        ? []
        : [explicitGuildId]
      : connectedGuilds
          .filter((guild) => guild.enabled)
          .map((guild) => guild.guildId);

    if (targetGuildIds.length === 0) {
      throw new BadRequestException(
        'Connect a Discord server before changing the bot avatar',
      );
    }

    const syncedAt = new Date();
    for (const guildId of targetGuildIds) {
      await this.syncBotAvatar(guildId, avatarDataUri);
    }
    await this.prisma.organizationDiscordGuild?.updateMany?.({
      where: {
        organizationId: organization.id,
        guildId: { in: targetGuildIds },
      },
      data: { botAvatarSyncedAt: syncedAt },
    });
    data.botAvatarSyncedAt = syncedAt;
  }

  async updateForActor(
    actor: Actor | null | undefined,
    dto: UpdateOrganizationDiscordConfigDto,
  ) {
    const organizationId = this.resolveActorOrganizationId(actor);
    this.assertOrgScopedManager(actor, organizationId);
    const organization = await this.requireOrganization(organizationId);
    this.assertDiscordEntitlementActive(organization);

    const data = this.buildPatchData(actor, dto, {
      allowSuperAdminManagedFields: false,
    });
    await this.applyBotAvatarUpdateIfNeeded(data, organization);

    try {
      await this.prisma.organizationDiscordConfig.upsert({
        where: { organizationId },
        update: data,
        create: Object.assign({}, data, {
          organizationId,
        }) as Prisma.OrganizationDiscordConfigUncheckedCreateInput,
      });
    } catch (error) {
      this.rethrowDiscordGuildConflict(error);
    }

    const updatedOrganization = await this.requireOrganization(organizationId);
    return this.toView(updatedOrganization);
  }

  async getForSuperAdmin(
    actor: Actor | null | undefined,
    organizationId: string,
  ) {
    this.assertSuperAdmin(actor);
    const updatedOrganization = await this.requireOrganization(organizationId);
    return this.toView(updatedOrganization);
  }

  async listForSuperAdmin(actor: Actor | null | undefined) {
    this.assertSuperAdmin(actor);
    const organizations = await this.prisma.organization.findMany({
      where: { deletedAt: null },
      orderBy: { name: 'asc' },
      select: organizationSelect,
    });

    return organizations.map((organization) => this.toView(organization));
  }

  async updateForOrganization(
    actor: Actor | null | undefined,
    organizationId: string,
    dto: UpdateOrganizationDiscordConfigDto,
  ) {
    this.assertOrgScopedManager(actor, organizationId);
    const organization = await this.requireOrganization(organizationId);

    const data = this.buildPatchData(actor, dto, {
      allowSuperAdminManagedFields:
        this.getActorRole(actor) === Role.SUPER_ADMIN,
    });
    const guildIdPatched = 'guildId' in data;
    const patchedGuildId =
      guildIdPatched && typeof data.guildId === 'string' ? data.guildId : null;
    const currentGuildId = organization.discordConfig?.guildId ?? null;
    const guildIdChanged =
      patchedGuildId !== null && patchedGuildId !== currentGuildId;
    if (guildIdChanged && patchedGuildId) {
      await this.assertDiscordGuildAvailableForOrganization(
        patchedGuildId,
        organizationId,
      );
      await this.assertGuildLimitAllowsConnect(organization, patchedGuildId);
    }
    await this.applyBotAvatarUpdateIfNeeded(data, organization);

    try {
      await this.prisma.organizationDiscordConfig.upsert({
        where: { organizationId },
        update: data,
        create: Object.assign({}, data, {
          organizationId,
        }) as Prisma.OrganizationDiscordConfigUncheckedCreateInput,
      });
      if (guildIdChanged && patchedGuildId) {
        await this.prisma.organizationDiscordGuild?.updateMany?.({
          where: { organizationId },
          data: { isPrimary: false },
        });
        await this.prisma.organizationDiscordGuild?.upsert?.({
          where: { guildId: patchedGuildId },
          update: {
            organizationId,
            guildName:
              typeof data.guildName === 'string'
                ? data.guildName
                : organization.discordConfig?.guildName,
            enabled: true,
            isPrimary: true,
            lastValidatedAt: new Date(),
          },
          create: {
            organizationId,
            guildId: patchedGuildId,
            guildName:
              typeof data.guildName === 'string'
                ? data.guildName
                : organization.discordConfig?.guildName,
            enabled: true,
            isPrimary: true,
            lastValidatedAt: new Date(),
          },
        });
      }
    } catch (error) {
      this.rethrowDiscordGuildConflict(error);
    }

    const updatedOrganization = await this.requireOrganization(organizationId);
    return this.toView(updatedOrganization);
  }
}
