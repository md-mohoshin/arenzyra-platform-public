import { OrganizationSubscriptionStatus, Role } from '@prisma/client';
import type { PrismaService } from '../../db/prisma.service';
import type { Actor } from '../../common/auth/jwt.strategy';
import { OrganizationDiscordService } from './organization-discord.service';

type DiscordConfigRecord = Record<string, unknown> & {
  organizationId: string;
  updatedBy?: { id: string; name: string; email: string } | null;
};
type DiscordGuildRecord = Record<string, unknown> & {
  id: string;
  organizationId: string;
  guildId: string;
  guildName?: string | null;
  enabled: boolean;
  isPrimary: boolean;
};

class MockOrganizationDiscordConfigDelegate {
  private readonly store = new Map<string, DiscordConfigRecord>();

  upsert(params: {
    where: { organizationId: string };
    create: DiscordConfigRecord;
    update: DiscordConfigRecord;
  }) {
    const existing = this.store.get(params.where.organizationId);
    const next = existing
      ? { ...existing, ...params.update }
      : { ...params.create };
    this.store.set(params.where.organizationId, next);
    return Promise.resolve(next);
  }

  findFirst(params: {
    where: {
      guildId?: string | null;
      organizationId?: { not?: string };
      enabled?: boolean;
      organization?: { deletedAt?: null };
    };
  }) {
    const guildId = params.where.guildId;
    const excludedOrganizationId = params.where.organizationId?.not ?? null;
    const enabled = params.where.enabled ?? null;
    for (const record of this.store.values()) {
      if (
        guildId &&
        record.guildId === guildId &&
        record.organizationId !== excludedOrganizationId &&
        (enabled === null || record.enabled === enabled)
      ) {
        return Promise.resolve({ organizationId: record.organizationId });
      }
    }
    return Promise.resolve(null);
  }

  updateMany(params: {
    where: {
      organizationId?: string;
      guildId?: string | null;
      enabled?: boolean;
    };
    data: Partial<DiscordConfigRecord>;
  }) {
    let count = 0;
    for (const [organizationId, existing] of this.store.entries()) {
      if (
        params.where.organizationId &&
        organizationId !== params.where.organizationId
      ) {
        continue;
      }
      if (params.where.guildId && existing.guildId !== params.where.guildId) {
        continue;
      }
      if (
        params.where.enabled !== undefined &&
        existing.enabled !== params.where.enabled
      ) {
        continue;
      }
      this.store.set(organizationId, {
        ...existing,
        ...params.data,
      });
      count += 1;
    }
    return Promise.resolve({ count });
  }

  set(organizationId: string, value: DiscordConfigRecord) {
    this.store.set(organizationId, value);
  }

  get(organizationId: string) {
    return this.store.get(organizationId) ?? null;
  }
}

class MockOrganizationDiscordGuildDelegate {
  private readonly store = new Map<string, DiscordGuildRecord>();
  private seq = 0;

  findFirst(params: {
    where: {
      organizationId?: string | { not?: string };
      guildId?: string;
      enabled?: true;
    };
  }) {
    const organizationId = params.where.organizationId;
    const excludedOrganizationId =
      typeof organizationId === 'object' ? organizationId.not : null;
    const requiredOrganizationId =
      typeof organizationId === 'string' ? organizationId : null;
    const guildId = params.where.guildId ?? null;
    const enabled = params.where.enabled ?? null;

    const records = Array.from(this.store.values())
      .filter((record) => {
        if (
          requiredOrganizationId &&
          record.organizationId !== requiredOrganizationId
        ) {
          return false;
        }
        if (
          excludedOrganizationId &&
          record.organizationId === excludedOrganizationId
        ) {
          return false;
        }
        if (guildId && record.guildId !== guildId) return false;
        if (enabled && record.enabled !== true) return false;
        return true;
      })
      .sort((left, right) => {
        if (left.isPrimary !== right.isPrimary) return left.isPrimary ? -1 : 1;
        return (left.guildName ?? left.guildId).localeCompare(
          right.guildName ?? right.guildId,
        );
      });
    return Promise.resolve(records[0] ?? null);
  }

  count(params: { where: { organizationId: string; enabled?: boolean } }) {
    return Promise.resolve(
      Array.from(this.store.values()).filter(
        (record) =>
          record.organizationId === params.where.organizationId &&
          (params.where.enabled === undefined ||
            record.enabled === params.where.enabled),
      ).length,
    );
  }

  upsert(params: {
    where: { guildId: string };
    create: Partial<DiscordGuildRecord> & {
      organizationId: string;
      guildId: string;
    };
    update: Partial<DiscordGuildRecord>;
  }) {
    const existing = this.store.get(params.where.guildId);
    const next: DiscordGuildRecord = {
      id: existing?.id ?? `discord-guild-${++this.seq}`,
      organizationId:
        params.update.organizationId ??
        existing?.organizationId ??
        params.create.organizationId,
      guildId: existing?.guildId ?? params.create.guildId,
      guildName:
        params.update.guildName !== undefined
          ? params.update.guildName
          : (existing?.guildName ?? params.create.guildName ?? null),
      enabled:
        params.update.enabled !== undefined
          ? Boolean(params.update.enabled)
          : (existing?.enabled ?? params.create.enabled ?? true),
      isPrimary:
        params.update.isPrimary !== undefined
          ? Boolean(params.update.isPrimary)
          : (existing?.isPrimary ?? params.create.isPrimary ?? false),
      ...existing,
      ...params.update,
    };
    this.store.set(next.guildId, next);
    return Promise.resolve(next);
  }

  updateMany(params: {
    where: {
      organizationId?: string;
      guildId?: string | { in: string[] };
      enabled?: boolean;
    };
    data: Partial<DiscordGuildRecord>;
  }) {
    let count = 0;
    const guildIds =
      typeof params.where.guildId === 'string'
        ? [params.where.guildId]
        : (params.where.guildId?.in ?? null);
    for (const record of this.store.values()) {
      if (
        params.where.organizationId &&
        record.organizationId !== params.where.organizationId
      ) {
        continue;
      }
      if (guildIds && !guildIds.includes(record.guildId)) continue;
      if (
        params.where.enabled !== undefined &&
        record.enabled !== params.where.enabled
      ) {
        continue;
      }
      Object.assign(record, params.data);
      count += 1;
    }
    return Promise.resolve({ count });
  }

  listForOrganization(organizationId: string) {
    return Array.from(this.store.values())
      .filter((record) => record.organizationId === organizationId)
      .sort((left, right) => {
        if (left.isPrimary !== right.isPrimary) return left.isPrimary ? -1 : 1;
        return (left.guildName ?? left.guildId).localeCompare(
          right.guildName ?? right.guildId,
        );
      });
  }
}

class MockOrganizationDelegate {
  constructor(
    private readonly config: MockOrganizationDiscordConfigDelegate,
    private readonly guilds: MockOrganizationDiscordGuildDelegate,
  ) {}

  findUnique(params: { where: { id: string } }) {
    const organizationId = params.where.id;
    if (!organizationId.startsWith('org')) {
      return Promise.resolve(null);
    }

    const discordConfig = this.config.get(organizationId);
    return Promise.resolve({
      id: organizationId,
      name: organizationId === 'org-a' ? 'Alpha Org' : 'Beta Org',
      slug: organizationId,
      status: 'APPROVED',
      subscriptionStatus: OrganizationSubscriptionStatus.ACTIVE,
      trialEndsAt: null,
      paidUntil: null,
      deletedAt: null,
      discordConfig,
      discordGuilds: this.guilds.listForOrganization(organizationId),
    });
  }

  findMany() {
    return Promise.resolve([
      {
        id: 'org-a',
        name: 'Alpha Org',
        slug: 'org-a',
        status: 'APPROVED',
        subscriptionStatus: OrganizationSubscriptionStatus.ACTIVE,
        trialEndsAt: null,
        paidUntil: null,
        deletedAt: null,
        discordConfig: this.config.get('org-a'),
        discordGuilds: this.guilds.listForOrganization('org-a'),
      },
      {
        id: 'org-b',
        name: 'Beta Org',
        slug: 'org-b',
        status: 'APPROVED',
        subscriptionStatus: OrganizationSubscriptionStatus.ACTIVE,
        trialEndsAt: null,
        paidUntil: null,
        deletedAt: null,
        discordConfig: this.config.get('org-b'),
        discordGuilds: this.guilds.listForOrganization('org-b'),
      },
    ]);
  }
}

const organizerActor = (organizationId: string): Actor =>
  ({
    id: `user-${organizationId}`,
    organizationId,
    actingOrgId: null,
    actorRole: Role.ORGANIZER,
    role: Role.ORGANIZER,
  }) as unknown as Actor;

const superAdminActor = (): Actor =>
  ({
    id: 'super-user',
    organizationId: null,
    actingOrgId: null,
    actorRole: Role.SUPER_ADMIN,
    role: Role.SUPER_ADMIN,
  }) as unknown as Actor;

const serviceTokenActor = (): Actor =>
  ({
    id: 'bot-user',
    organizationId: 'org-a',
    actingOrgId: null,
    actorRole: Role.ORGANIZER,
    role: Role.ORGANIZER,
    serviceToken: true,
  }) as unknown as Actor;

const makeService = () => {
  const config = new MockOrganizationDiscordConfigDelegate();
  const guilds = new MockOrganizationDiscordGuildDelegate();
  const prisma = {
    organizationDiscordConfig: config,
    organizationDiscordGuild: guilds,
    organization: new MockOrganizationDelegate(config, guilds),
  } as unknown as PrismaService;
  return {
    service: new OrganizationDiscordService(prisma),
    config,
    guilds,
  };
};

const restoreEnv = (name: string, value: string | undefined) => {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
};

describe('OrganizationDiscordService', () => {
  const originalDiscordClientId = process.env.DISCORD_CLIENT_ID;
  const originalDiscordStateSecret = process.env.DISCORD_INSTALL_STATE_SECRET;
  const originalJwtSecret = process.env.JWT_SECRET;
  const originalWebOrigin = process.env.WEB_APP_ORIGIN;
  const originalDiscordBotToken = process.env.DISCORD_BOT_TOKEN;

  afterEach(() => {
    jest.restoreAllMocks();
    restoreEnv('DISCORD_CLIENT_ID', originalDiscordClientId);
    restoreEnv('DISCORD_INSTALL_STATE_SECRET', originalDiscordStateSecret);
    restoreEnv('JWT_SECRET', originalJwtSecret);
    restoreEnv('WEB_APP_ORIGIN', originalWebOrigin);
    restoreEnv('DISCORD_BOT_TOKEN', originalDiscordBotToken);
  });

  it('returns a default view when no config exists yet', async () => {
    const { service } = makeService();

    const result = await service.getForActor(organizerActor('org-a'));

    expect(result.exists).toBe(false);
    expect(result.guildId).toBeNull();
    expect(result.summary.configuredChannelCount).toBe(0);
  });

  it('updates the caller organization and computes summary counts', async () => {
    const { service } = makeService();

    const result = await service.updateForActor(organizerActor('org-a'), {
      enabled: true,
      resultsChannelId: '2222',
      standingsChannelId: '3333',
      captainRoleId: '4444',
      participantRoleId: '5555',
      autoSyncRoles: true,
    });

    expect(result.exists).toBe(true);
    expect(result.enabled).toBe(true);
    expect(result.summary.hasGuildConnection).toBe(false);
    expect(result.summary.configuredChannelCount).toBe(2);
    expect(result.summary.configuredRoleCount).toBe(2);
    expect(result.summary.automationEnabled).toBe(true);
  });

  it('stores staff role defaults for Discord sessions', async () => {
    const { service } = makeService();

    const result = await service.updateForActor(organizerActor('org-a'), {
      staffRoleIds: ['1111', '1111', ' 2222 '],
    });

    expect(result.staffRoleIds).toEqual(['1111', '2222']);
    expect(result.summary.configuredRoleCount).toBe(2);
  });

  it('returns subscription-owned Discord access state in the view', async () => {
    const { service, config } = makeService();
    const accessExpiresAt = new Date('2030-01-01T00:00:00.000Z');
    config.set('org-a', {
      organizationId: 'org-a',
      enabled: true,
      maxSessionCount: 2,
      accessExpiresAt,
    });

    const result = await service.getForActor(organizerActor('org-a'));

    expect(result.maxSessionCount).toBe(2);
    expect(result.discordAccessActive).toBe(true);
    expect(result.subscriptionExpiresAt).toBeNull();
    expect(result.accessExpiresAt).toBeNull();
    expect(result.storedAccessExpiresAt).toBe(accessExpiresAt.toISOString());
  });

  it('does not write Discord access expiry from config updates', async () => {
    const { service, config } = makeService();

    const result = await service.updateForOrganization(
      superAdminActor(),
      'org-a',
      {
        maxSessionCount: 2,
        accessExpiresAt: '2030-01-01T00:00:00.000Z',
      },
    );

    expect(result.maxSessionCount).toBe(2);
    expect(result.accessExpiresAt).toBeNull();
    expect(config.get('org-a')?.accessExpiresAt).toBeUndefined();
  });

  it('allows organizer Discord changes with active subscription despite configured access expiry', async () => {
    const { service, config } = makeService();
    config.set('org-a', {
      organizationId: 'org-a',
      enabled: true,
      maxSessionCount: 1,
      accessExpiresAt: new Date('2020-01-01T00:00:00.000Z'),
    });

    const result = await service.updateForActor(organizerActor('org-a'), {
      resultsChannelId: '2222',
    });

    expect(result.resultsChannelId).toBe('2222');
  });

  it('blocks organizer access to another organization', async () => {
    const { service } = makeService();

    await expect(
      service.updateForOrganization(organizerActor('org-a'), 'org-b', {
        guildId: '1234567890',
      }),
    ).rejects.toThrow('Not allowed to manage this organization');
  });

  it('lets super admins list all organizations including unconfigured ones', async () => {
    const { service, config } = makeService();
    config.set('org-a', {
      organizationId: 'org-a',
      enabled: true,
      guildId: '1111',
      resultsChannelId: '2222',
      autoCreateSessionChannels: true,
    });

    const result = await service.listForSuperAdmin(superAdminActor());

    expect(result).toHaveLength(2);
    expect(result[0].organization.id).toBe('org-a');
    expect(result[1].exists).toBe(false);
  });

  it('allows super admins to update any organization directly', async () => {
    const { service } = makeService();

    const result = await service.updateForOrganization(
      superAdminActor(),
      'org-b',
      {
        guildId: '9999',
        guildName: 'Fix Esports',
      },
    );

    expect(result.organization.id).toBe('org-b');
    expect(result.guildName).toBe('Fix Esports');
  });

  it('lets super admins update entitlements without reconnecting an unchanged guild', async () => {
    process.env.DISCORD_BOT_TOKEN = 'bot-token';
    const fetchMock = jest.spyOn(global, 'fetch');
    const { service, config, guilds } = makeService();
    const avatar =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMB/6XcUu0AAAAASUVORK5CYII=';
    config.set('org-a', {
      organizationId: 'org-a',
      enabled: false,
      guildId: '1111',
      guildName: 'Removed Guild',
      botAvatarDataUri: avatar,
      maxSessionCount: 1,
      maxGuildCount: 1,
    });
    await guilds.upsert({
      where: { guildId: '1111' },
      create: {
        organizationId: 'org-a',
        guildId: '1111',
        guildName: 'Removed Guild',
        enabled: false,
        isPrimary: true,
      },
      update: {},
    });

    const result = await service.updateForOrganization(
      superAdminActor(),
      'org-a',
      {
        guildId: '1111',
        botAvatarDataUri: avatar,
        maxSessionCount: 2,
        maxGuildCount: 3,
      },
    );

    expect(result.maxSessionCount).toBe(2);
    expect(result.maxGuildCount).toBe(3);
    expect(guilds.listForOrganization('org-a')[0]?.enabled).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('blocks assigning a Discord server that is already connected elsewhere', async () => {
    const { service, config } = makeService();
    config.set('org-a', {
      organizationId: 'org-a',
      enabled: true,
      guildId: '1111',
    });

    await expect(
      service.updateForOrganization(superAdminActor(), 'org-b', {
        guildId: '1111',
      }),
    ).rejects.toThrow(
      'This Discord server is already connected to another organization',
    );
  });

  it('keeps server and organizer role fields managed by super admins', async () => {
    const { service, config } = makeService();
    config.set('org-a', {
      organizationId: 'org-a',
      enabled: true,
      guildId: '1111',
      guildName: 'Super Guild',
      organizerRoleId: '2222',
      organizerRoleName: 'Scrim Admin',
    });

    const result = await service.updateForActor(organizerActor('org-a'), {
      guildId: '9999',
      guildName: 'Organizer Guild',
      organizerRoleId: '8888',
      organizerRoleName: 'Organizer Role',
      supportChannelId: '7777',
    });

    expect(result.guildId).toBe('1111');
    expect(result.guildName).toBe('Super Guild');
    expect(result.organizerRoleId).toBe('2222');
    expect(result.organizerRoleName).toBe('Scrim Admin');
    expect(result.supportChannelId).toBe('7777');
  });

  it('syncs a custom bot avatar to the linked Discord server', async () => {
    process.env.DISCORD_BOT_TOKEN = 'bot-token';
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
    } as Response);
    const { service, config } = makeService();
    const avatar =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMB/6XcUu0AAAAASUVORK5CYII=';
    config.set('org-a', {
      organizationId: 'org-a',
      enabled: true,
      guildId: '1111',
    });

    const result = await service.updateForActor(organizerActor('org-a'), {
      botAvatarDataUri: avatar,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://discord.com/api/v10/guilds/1111/members/@me',
      expect.objectContaining({
        method: 'PATCH',
        headers: expect.objectContaining({
          Authorization: 'Bot bot-token',
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({ avatar }),
      }),
    );
    expect(result.botAvatarDataUri).toBe(avatar);
    expect(result.botAvatarSyncedAt).toBeTruthy();
  });

  it('requires a linked Discord server before changing the bot avatar', async () => {
    process.env.DISCORD_BOT_TOKEN = 'bot-token';
    const { service } = makeService();

    await expect(
      service.updateForActor(organizerActor('org-a'), {
        botAvatarDataUri:
          'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMB/6XcUu0AAAAASUVORK5CYII=',
      }),
    ).rejects.toThrow(
      'Connect a Discord server before changing the bot avatar',
    );
  });

  it('marks a removed primary Discord server inactive in both config records', async () => {
    process.env.DISCORD_BOT_TOKEN = 'bot-token';
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ message: 'Unknown Guild', code: 10004 }),
    } as Response);
    const { service, config, guilds } = makeService();
    config.set('org-a', {
      organizationId: 'org-a',
      enabled: true,
      guildId: '111111111111111111',
      guildName: 'Guarded Server',
    });
    await guilds.upsert({
      where: { guildId: '111111111111111111' },
      update: {},
      create: {
        organizationId: 'org-a',
        guildId: '111111111111111111',
        guildName: 'Guarded Server',
        enabled: true,
        isPrimary: true,
      },
    });

    const result = await service.validateForActor(organizerActor('org-a'));

    expect(result.enabled).toBe(false);
    expect(result.summary.hasGuildConnection).toBe(false);
    expect(result.summary.connectedGuildCount).toBe(0);
    expect(result.connectedGuilds).toHaveLength(0);
    expect(config.get('org-a')?.enabled).toBe(false);
  });

  it('marks a guild removed by the bot as disabled and hides it from organizer views', async () => {
    const { service, config, guilds } = makeService();
    config.set('org-a', {
      organizationId: 'org-a',
      enabled: true,
      guildId: '111111111111111111',
      guildName: 'Removed Guild',
    });
    await guilds.upsert({
      where: { guildId: '111111111111111111' },
      update: {},
      create: {
        organizationId: 'org-a',
        guildId: '111111111111111111',
        guildName: 'Removed Guild',
        enabled: true,
        isPrimary: true,
      },
    });

    const result = await service.markGuildRemovedByBot(serviceTokenActor(), {
      guildId: '111111111111111111',
      guildName: 'Removed Guild',
    });
    const view = await service.getForActor(organizerActor('org-a'));

    expect(result.disabledGuildLinks).toBe(1);
    expect(result.disabledPrimaryConfigs).toBe(1);
    expect(guilds.listForOrganization('org-a')[0]?.enabled).toBe(false);
    expect(config.get('org-a')?.enabled).toBe(false);
    expect(view.enabled).toBe(false);
    expect(view.guildId).toBeNull();
    expect(view.connectedGuilds).toHaveLength(0);
  });

  it('rejects guild removal reports from normal organizer sessions', async () => {
    const { service } = makeService();

    await expect(
      service.markGuildRemovedByBot(organizerActor('org-a'), {
        guildId: '111111111111111111',
      }),
    ).rejects.toThrow('Bot service token required');
  });

  it('creates a Discord install URL for the caller organization', async () => {
    process.env.DISCORD_CLIENT_ID = '1486450479994241035';
    process.env.DISCORD_INSTALL_STATE_SECRET = 'test-install-secret';
    process.env.WEB_APP_ORIGIN = 'http://localhost:3001';

    const { service } = makeService();
    const result = await service.createInstallUrl(organizerActor('org-a'));
    const url = new URL(result.url);

    expect(url.origin).toBe('https://discord.com');
    expect(url.searchParams.get('client_id')).toBe('1486450479994241035');
    expect(url.searchParams.get('scope')).toBe('bot applications.commands');
    expect(url.searchParams.get('redirect_uri')).toBe(
      'http://localhost:3001/organizer/discord/callback',
    );
    expect(url.searchParams.get('state')).toBeTruthy();
  });

  it('completes an organization-scoped Discord install and stores the linked guild', async () => {
    process.env.DISCORD_CLIENT_ID = '1486450479994241035';
    process.env.DISCORD_INSTALL_STATE_SECRET = 'test-install-secret';
    process.env.WEB_APP_ORIGIN = 'http://localhost:3001';
    delete process.env.DISCORD_BOT_TOKEN;

    const { service } = makeService();
    const install = await service.createInstallUrl(organizerActor('org-a'));
    const state = new URL(install.url).searchParams.get('state');

    const result = await service.completeInstall(organizerActor('org-a'), {
      state: state ?? '',
      guildId: '775509232354983967',
    });

    expect(result.enabled).toBe(true);
    expect(result.guildId).toBe('775509232354983967');
    expect(result.guildName).toBe('Discord Server 775509232354983967');
    expect(result.lastValidatedAt).toBeTruthy();
  });

  it('allows connecting multiple Discord servers up to the approved limit', async () => {
    process.env.DISCORD_CLIENT_ID = '1486450479994241035';
    process.env.DISCORD_INSTALL_STATE_SECRET = 'test-install-secret';
    process.env.WEB_APP_ORIGIN = 'http://localhost:3001';
    delete process.env.DISCORD_BOT_TOKEN;

    const { service, config } = makeService();
    config.set('org-a', {
      organizationId: 'org-a',
      enabled: true,
      maxSessionCount: 1,
      maxGuildCount: 2,
    });

    const firstInstall = await service.createInstallUrl(
      organizerActor('org-a'),
    );
    const firstState = new URL(firstInstall.url).searchParams.get('state');
    await service.completeInstall(organizerActor('org-a'), {
      state: firstState ?? '',
      guildId: '111111111111111111',
    });

    const secondInstall = await service.createInstallUrl(
      organizerActor('org-a'),
    );
    const secondState = new URL(secondInstall.url).searchParams.get('state');
    const result = await service.completeInstall(organizerActor('org-a'), {
      state: secondState ?? '',
      guildId: '222222222222222222',
    });

    expect(result.maxGuildCount).toBe(2);
    expect(result.connectedGuilds).toHaveLength(2);
    expect(result.guildId).toBe('111111111111111111');
    expect(result.connectedGuilds.map((guild) => guild.guildId)).toEqual([
      '111111111111111111',
      '222222222222222222',
    ]);
  });

  it('blocks connecting another Discord server after the approved limit', async () => {
    process.env.DISCORD_CLIENT_ID = '1486450479994241035';
    process.env.DISCORD_INSTALL_STATE_SECRET = 'test-install-secret';
    process.env.WEB_APP_ORIGIN = 'http://localhost:3001';
    delete process.env.DISCORD_BOT_TOKEN;

    const { service, config } = makeService();
    config.set('org-a', {
      organizationId: 'org-a',
      enabled: true,
      maxSessionCount: 1,
      maxGuildCount: 1,
    });

    const firstInstall = await service.createInstallUrl(
      organizerActor('org-a'),
    );
    const firstState = new URL(firstInstall.url).searchParams.get('state');
    await service.completeInstall(organizerActor('org-a'), {
      state: firstState ?? '',
      guildId: '111111111111111111',
    });

    const secondInstall = await service.createInstallUrl(
      organizerActor('org-a'),
    );
    const secondState = new URL(secondInstall.url).searchParams.get('state');

    await expect(
      service.completeInstall(organizerActor('org-a'), {
        state: secondState ?? '',
        guildId: '222222222222222222',
      }),
    ).rejects.toThrow('Discord server limit reached (1/1)');
  });

  it('allows replacing a Discord server after bot removal disables the old link', async () => {
    process.env.DISCORD_CLIENT_ID = '1486450479994241035';
    process.env.DISCORD_INSTALL_STATE_SECRET = 'test-install-secret';
    process.env.WEB_APP_ORIGIN = 'http://localhost:3001';
    delete process.env.DISCORD_BOT_TOKEN;

    const { service, config, guilds } = makeService();
    config.set('org-a', {
      organizationId: 'org-a',
      enabled: true,
      maxSessionCount: 1,
      maxGuildCount: 1,
    });

    const firstInstall = await service.createInstallUrl(
      organizerActor('org-a'),
    );
    const firstState = new URL(firstInstall.url).searchParams.get('state');
    await service.completeInstall(organizerActor('org-a'), {
      state: firstState ?? '',
      guildId: '111111111111111111',
    });

    await service.markGuildRemovedByBot(serviceTokenActor(), {
      guildId: '111111111111111111',
      guildName: 'Old Server',
    });

    const secondInstall = await service.createInstallUrl(
      organizerActor('org-a'),
    );
    const secondState = new URL(secondInstall.url).searchParams.get('state');
    const result = await service.completeInstall(organizerActor('org-a'), {
      state: secondState ?? '',
      guildId: '222222222222222222',
    });

    expect(result.enabled).toBe(true);
    expect(result.guildId).toBe('222222222222222222');
    expect(result.connectedGuilds.map((guild) => guild.guildId)).toEqual([
      '222222222222222222',
    ]);
    expect(config.get('org-a')?.guildId).toBe('222222222222222222');
    expect(
      guilds
        .listForOrganization('org-a')
        .find((guild) => guild.guildId === '111111111111111111')?.enabled,
    ).toBe(false);
  });

  it('allows connecting a Discord server that only has a disabled stale link elsewhere', async () => {
    process.env.DISCORD_CLIENT_ID = '1486450479994241035';
    process.env.DISCORD_INSTALL_STATE_SECRET = 'test-install-secret';
    process.env.WEB_APP_ORIGIN = 'http://localhost:3001';
    delete process.env.DISCORD_BOT_TOKEN;

    const { service, config, guilds } = makeService();
    config.set('org-b', {
      organizationId: 'org-b',
      enabled: false,
      guildId: '333333333333333333',
    });
    await guilds.upsert({
      where: { guildId: '333333333333333333' },
      create: {
        organizationId: 'org-b',
        guildId: '333333333333333333',
        guildName: 'Old Stale Server',
        enabled: false,
        isPrimary: true,
      },
      update: {},
    });

    const install = await service.createInstallUrl(organizerActor('org-a'));
    const state = new URL(install.url).searchParams.get('state');
    const result = await service.completeInstall(organizerActor('org-a'), {
      state: state ?? '',
      guildId: '333333333333333333',
    });

    expect(result.enabled).toBe(true);
    expect(result.guildId).toBe('333333333333333333');
    expect(guilds.listForOrganization('org-b')).toHaveLength(0);
    expect(guilds.listForOrganization('org-a')[0]?.enabled).toBe(true);
  });

  it('blocks Discord install when the returned server is linked to another organization', async () => {
    process.env.DISCORD_CLIENT_ID = '1486450479994241035';
    process.env.DISCORD_INSTALL_STATE_SECRET = 'test-install-secret';
    process.env.WEB_APP_ORIGIN = 'http://localhost:3001';
    delete process.env.DISCORD_BOT_TOKEN;

    const { service, config } = makeService();
    config.set('org-b', {
      organizationId: 'org-b',
      enabled: true,
      guildId: '775509232354983967',
    });
    const install = await service.createInstallUrl(organizerActor('org-a'));
    const state = new URL(install.url).searchParams.get('state');

    await expect(
      service.completeInstall(organizerActor('org-a'), {
        state: state ?? '',
        guildId: '775509232354983967',
      }),
    ).rejects.toThrow(
      'This Discord server is already connected to another organization',
    );
  });
});
