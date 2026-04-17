import { Role } from '@prisma/client';
import type { PrismaService } from '../../db/prisma.service';
import type { Actor } from '../../common/auth/jwt.strategy';
import { OrganizationDiscordService } from './organization-discord.service';

type DiscordConfigRecord = Record<string, unknown> & {
  organizationId: string;
  updatedBy?: { id: string; name: string; email: string } | null;
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

  set(organizationId: string, value: DiscordConfigRecord) {
    this.store.set(organizationId, value);
  }

  get(organizationId: string) {
    return this.store.get(organizationId) ?? null;
  }
}

class MockOrganizationDelegate {
  constructor(private readonly config: MockOrganizationDiscordConfigDelegate) {}

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
      deletedAt: null,
      discordConfig,
    });
  }

  findMany() {
    return Promise.resolve([
      {
        id: 'org-a',
        name: 'Alpha Org',
        slug: 'org-a',
        status: 'APPROVED',
        deletedAt: null,
        discordConfig: this.config.get('org-a'),
      },
      {
        id: 'org-b',
        name: 'Beta Org',
        slug: 'org-b',
        status: 'APPROVED',
        deletedAt: null,
        discordConfig: this.config.get('org-b'),
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

const makeService = () => {
  const config = new MockOrganizationDiscordConfigDelegate();
  const prisma = {
    organizationDiscordConfig: config,
    organization: new MockOrganizationDelegate(config),
  } as unknown as PrismaService;
  return {
    service: new OrganizationDiscordService(prisma),
    config,
  };
};

describe('OrganizationDiscordService', () => {
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
      guildId: '1234567890',
      resultsChannelId: '2222',
      standingsChannelId: '3333',
      organizerRoleId: '4444',
      participantRoleId: '5555',
      autoSyncRoles: true,
    });

    expect(result.exists).toBe(true);
    expect(result.enabled).toBe(true);
    expect(result.summary.hasGuildConnection).toBe(true);
    expect(result.summary.configuredChannelCount).toBe(2);
    expect(result.summary.configuredRoleCount).toBe(2);
    expect(result.summary.automationEnabled).toBe(true);
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
});
