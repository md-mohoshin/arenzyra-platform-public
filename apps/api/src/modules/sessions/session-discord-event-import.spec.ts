import { SessionDiscordSyncService } from './session-discord-sync.service';
import {
  parseDiscordEventSlotRows,
  type DiscordMessage,
} from './session-discord-sync.service';
import {
  OrganizationSubscriptionStatus,
  Role,
  SessionRegistrationStatus,
} from '@prisma/client';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import * as teamAssetUtil from '../teams/asset.util';

function teamLogoEmojiName(teamId: string, logoUrl: string) {
  const hash = (value: string, length: number) =>
    createHash('sha1').update(value).digest('hex').slice(0, length);
  return `azt_v1_${hash(teamId, 10)}_${hash(logoUrl, 6)}`;
}

function createServiceWithConfig() {
  const service = new SessionDiscordSyncService({} as never);
  const emojis = (
    service as never as {
      defaultEmojis(): Record<string, unknown>;
    }
  ).defaultEmojis();
  return {
    service,
    config: {
      enabled: true,
      startSlot: 3,
      normalSlots: 3,
      vipSlots: 0,
      registrationMode: 'TOURNAMENT',
      emojis,
    },
  };
}

describe('Discord event slot import parsing', () => {
  it('parses plain team-per-line lists only when explicitly enabled', () => {
    const message: DiscordMessage = {
      id: 'plain-production-list',
      content: ['Alpha Team', 'Bravo Esports', 'Charlie Club'].join('\n'),
      embeds: [],
    };

    expect(parseDiscordEventSlotRows([message])).toEqual([]);
    expect(
      parseDiscordEventSlotRows([message], { allowPlainTeamList: true }),
    ).toEqual([
      { slotNumber: 1, teamName: 'Alpha Team', teamTag: 'AT' },
      { slotNumber: 2, teamName: 'Bravo Esports', teamTag: 'BE' },
      { slotNumber: 3, teamName: 'Charlie Club', teamTag: 'CC' },
    ]);
  });

  it('preserves source order for plain pipe lists with short team names', () => {
    const message: DiscordMessage = {
      id: 'plain-pipe-production-list',
      content: [
        'AVALANCHE TEAM | AVA |',
        'BAZA TEAM | BAZA |',
        'VOX | VOX |',
        'EVOLUTION ESPORT | EV |',
      ].join('\n'),
      embeds: [],
    };

    expect(
      parseDiscordEventSlotRows([message], {
        allowPlainTeamList: true,
        startSlot: 3,
        normalSlots: 16,
      }),
    ).toEqual([
      { slotNumber: 3, teamName: 'AVALANCHE TEAM', teamTag: 'AVA' },
      { slotNumber: 4, teamName: 'BAZA TEAM', teamTag: 'BAZA' },
      { slotNumber: 5, teamName: 'VOX', teamTag: 'VOX' },
      { slotNumber: 6, teamName: 'EVOLUTION ESPORT', teamTag: 'EV' },
    ]);
  });

  it('cleans production fix-prefixed team rows and ignores placeholders', () => {
    const message: DiscordMessage = {
      id: 'production-fix-list',
      content: [
        '## GOLDEN SERIES - 16:00 :pmft34:',
        'fix03: [ANK] ANKARA ESPORTS',
        'fix04: [zinc] ZIN esports',
        'fix05: [RC] Riba City',
        'fix06: -',
        'fix07: -',
        'fixVIP: -',
      ].join('\n'),
      embeds: [],
    };

    expect(
      parseDiscordEventSlotRows([message], { allowPlainTeamList: true }),
    ).toEqual([
      { slotNumber: 3, teamName: 'ANKARA ESPORTS', teamTag: 'ANK' },
      { slotNumber: 4, teamName: 'ZIN esports', teamTag: 'ZINC' },
      { slotNumber: 5, teamName: 'Riba City', teamTag: 'RC' },
    ]);
  });

  it('parses emoji slot rows with team-name then tag pipe format', () => {
    const message: DiscordMessage = {
      id: 'production-emoji-pipe-list',
      content: [
        '## :belila: FINALS:belila:',
        '`03.06.2026`',
        ':BE03: *INVITED* : ***ENVY US | ENVY |*** <@1090652706919678052>',
        ':BE04: *INVITED*: ***BigBaby Esports | Bby |*** <@518222353730371611>',
        ':BE05: *INVITED* ***BigBaby | Bby |*** <@723128298561077250>',
        ':BE06: *INVITED* ***OZAROX ESPORTS | ozo |***<@466479906268905484>',
        ':BE07: *INVITED* ***Team HUNGARY | hun |*** <@792779398742147113>',
        ':BE08: *SPONSOR* ***KROVARI | kr |*** <@1217248922011963475>',
        ':BE09: ***QRX Esports | qrx |*** <@717368622896644167>',
        ':BE15:',
        ':BEVIP:',
      ].join('\n'),
      embeds: [],
    };

    expect(
      parseDiscordEventSlotRows([message], { allowPlainTeamList: true }),
    ).toEqual([
      { slotNumber: 3, teamName: 'ENVY US', teamTag: 'ENVY' },
      { slotNumber: 4, teamName: 'BigBaby Esports', teamTag: 'BBY' },
      { slotNumber: 5, teamName: 'BigBaby', teamTag: 'BBY' },
      { slotNumber: 6, teamName: 'OZAROX ESPORTS', teamTag: 'OZO' },
      { slotNumber: 7, teamName: 'Team HUNGARY', teamTag: 'HUN' },
      { slotNumber: 8, teamName: 'KROVARI', teamTag: 'KR' },
      { slotNumber: 9, teamName: 'QRX Esports', teamTag: 'QRX' },
    ]);
  });

  it('does not parse date-only lines as slot rows', () => {
    const message: DiscordMessage = {
      id: 'production-date-header',
      content: '`03.06.2026`',
      embeds: [],
    };

    expect(
      parseDiscordEventSlotRows([message], { allowPlainTeamList: true }),
    ).toEqual([]);
  });

  it('renders pinned registration, slot-list, and waitlist messages as plain text', () => {
    const { service, config } = createServiceWithConfig();
    const plainConfig = {
      ...config,
      emojis: {
        ...config.emojis,
        registrationMessageDisplayMode: 'plain',
        slotListMessageMode: 'plain',
        waitlistMessageMode: 'plain',
      },
    };
    const payloads = [
      (
        service as never as {
          registrationPanelPayload(params: unknown): {
            content: string;
            embeds: unknown[];
          };
        }
      ).registrationPanelPayload({
        session: {
          id: 'session-1',
          name: 'Daily Scrim',
          status: 'OPEN',
          registrationOpenAt: null,
          registrationCloseAt: null,
        },
        config: plainConfig,
      }),
      (
        service as never as {
          slotListPayload(params: unknown): {
            content: string;
            embeds: unknown[];
          };
        }
      ).slotListPayload({
        session: { id: 'session-1', slotCount: 5 },
        config: plainConfig,
        registrations: [],
      }),
      (
        service as never as {
          waitlistPayload(params: unknown): {
            content: string;
            embeds: unknown[];
          };
        }
      ).waitlistPayload({
        sessionId: 'session-1',
        config: plainConfig,
        registrations: [],
      }),
    ];

    for (const payload of payloads) {
      expect(payload.content).toBeTruthy();
      expect(payload.content.length).toBeLessThanOrEqual(2000);
      expect(payload.embeds).toEqual([]);
    }
  });

  it('uses saved manager snapshots when rendering synced slot lists', () => {
    const { service, config } = createServiceWithConfig();
    const payload = (
      service as never as {
        slotListPayload(params: unknown): {
          content: string;
          allowed_mentions: { users?: string[] };
        };
      }
    ).slotListPayload({
      session: { id: 'session-1', slotCount: 5 },
      config,
      validGuildMemberIds: new Set([
        '111111111111111111',
        '222222222222222222',
      ]),
      registrations: [
        {
          id: 'registration-1',
          teamId: 'team-1',
          leaderDiscordUserId: '111111111111111111',
          managerDiscordUserIds: ['111111111111111111'],
          status: 'CONFIRMED',
          slotNumber: 3,
          waitlistPosition: null,
          note: null,
          team: {
            id: 'team-1',
            name: 'Snapshot Team',
            tag: 'SNP',
            logoUrl: null,
            members: [
              {
                discordUserId: '222222222222222222',
                discordUsername: 'old-manager',
                displayName: 'Old Manager',
                role: 'LEADER',
              },
            ],
          },
        },
      ],
    });

    expect(payload.content).toContain('<@111111111111111111>');
    expect(payload.content).not.toContain('<@222222222222222222>');
    expect(payload.allowed_mentions.users).toEqual(['111111111111111111']);
  });

  it('mirrors waitlist embed manager mentions in content for Discord parsing', () => {
    const { service, config } = createServiceWithConfig();
    const payload = (
      service as never as {
        waitlistPayload(params: unknown): {
          content: string | null;
          embeds: Array<{ description?: string }>;
          allowed_mentions: { users?: string[] };
        };
      }
    ).waitlistPayload({
      sessionId: 'session-1',
      config,
      validGuildMemberIds: new Set(['333333333333333333']),
      registrations: [
        {
          id: 'registration-1',
          teamId: 'team-1',
          leaderDiscordUserId: '333333333333333333',
          managerDiscordUserIds: ['333333333333333333'],
          status: 'WAITLIST',
          slotNumber: null,
          waitlistPosition: 1,
          note: null,
          team: {
            id: 'team-1',
            name: 'Waitlist Team',
            tag: 'WAIT',
            logoUrl: null,
            members: [],
          },
        },
      ],
    });

    expect(payload.embeds[0]?.description).toContain('<@333333333333333333>');
    expect(payload.content).toBe('Managers: <@333333333333333333>');
    expect(payload.allowed_mentions.users).toEqual(['333333333333333333']);
  });

  it('reuses and pins an existing plain slot-list message when the saved id is stale', async () => {
    const { service } = createServiceWithConfig();
    const requests: Array<{ method: string; path: string }> = [];
    (
      service as never as {
        discordRequest(
          method: string,
          path: string,
          payload?: unknown,
          opts?: unknown,
        ): Promise<unknown>;
      }
    ).discordRequest = async (method, path) => {
      requests.push({ method, path });
      if (method === 'GET' && path.endsWith('/messages/deleted-message')) {
        return null;
      }
      if (method === 'GET' && path.endsWith('/messages?limit=100')) {
        return [
          {
            id: 'existing-slot-list',
            content: '**Slot List (1/20)**\n#1 Team',
            author: { bot: true },
            pinned: false,
            embeds: [],
          },
        ];
      }
      if (method === 'PATCH') {
        return {
          id: 'existing-slot-list',
          content: '**Slot List (1/20)**\n#1 Updated',
          author: { bot: true },
          pinned: false,
          embeds: [],
        };
      }
      if (method === 'PUT') {
        return {};
      }
      throw new Error(`unexpected Discord request ${method} ${path}`);
    };

    const typedService = service as never as {
      upsertMarkedMessage(params: unknown): Promise<DiscordMessage>;
      matchesSlotListMessage(message: DiscordMessage): boolean;
    };
    const message = await typedService.upsertMarkedMessage({
      channelId: 'slot-list-channel',
      messageId: 'deleted-message',
      footerMarker: 'arenzyra:session-1:slots',
      payload: { content: '**Slot List (1/20)**\n#1 Updated', embeds: [] },
      matchExisting: (candidate: DiscordMessage) =>
        typedService.matchesSlotListMessage(candidate),
    });

    expect(message.id).toBe('existing-slot-list');
    expect(requests.some((request) => request.method === 'POST')).toBe(false);
    expect(requests).toContainEqual({
      method: 'PUT',
      path: '/channels/slot-list-channel/pins/existing-slot-list',
    });
  });

  it('allows explicit organiser mentions in custom Discord messages', () => {
    const { service, config } = createServiceWithConfig();
    const customConfig = {
      ...config,
      emojis: {
        ...config.emojis,
        registrationMessageText:
          '@everyone Register <@&123456789012345678> <@111111111111111111>',
        playConfirmationMessageText:
          '@here Confirm <@&123456789012345678> <@222222222222222222>',
      },
    };

    const registrationPayload = (
      service as never as {
        registrationPanelPayload(params: unknown): {
          allowed_mentions: Record<string, unknown>;
        };
      }
    ).registrationPanelPayload({
      session: {
        id: 'session-1',
        name: 'Daily Scrim',
        status: 'OPEN',
        registrationOpenAt: null,
        registrationCloseAt: null,
      },
      config: customConfig,
    });
    const confirmationPayload = (
      service as never as {
        playConfirmationMessagePayload(params: unknown): {
          allowed_mentions: Record<string, unknown>;
        };
      }
    ).playConfirmationMessagePayload({
      session: { id: 'session-1' },
      config: customConfig,
    });

    expect(registrationPayload.allowed_mentions).toEqual({
      parse: ['everyone'],
      users: ['111111111111111111'],
      roles: ['123456789012345678'],
    });
    expect(confirmationPayload.allowed_mentions).toEqual({
      parse: ['everyone'],
      users: ['222222222222222222'],
      roles: ['123456789012345678'],
    });
  });

  it('syncs access roles only to saved manager snapshots', async () => {
    const managerDiscordUserId = '111111111111111111';
    const submitterDiscordUserId = '222222222222222222';
    const prisma = {
      teamMember: {
        findMany: jest.fn().mockResolvedValue([
          {
            teamId: 'team-1',
            discordUserId: managerDiscordUserId,
            role: 'LEADER',
          },
          {
            teamId: 'team-1',
            discordUserId: submitterDiscordUserId,
            role: 'LEADER',
          },
        ]),
      },
    };
    const service = new SessionDiscordSyncService(prisma as never);
    const discordRequest = jest.fn().mockResolvedValue(null);
    (service as never as { discordRequest: jest.Mock }).discordRequest =
      discordRequest;

    const result = await (
      service as never as {
        syncAccessRoles(params: unknown): Promise<{
          attempted: number;
          failed: number;
        }>;
      }
    ).syncAccessRoles({
      guildId: 'guild-1',
      organizationId: 'org-1',
      setup: {
        slotRole: { id: '444444444444444444' },
        idpRole: { id: '555555555555555555' },
        waitlistRole: { id: '666666666666666666' },
        legacyIdpRole: { id: '777777777777777777' },
      },
      registrations: [
        {
          id: 'registration-1',
          teamId: 'team-1',
          leaderDiscordUserId: submitterDiscordUserId,
          managerDiscordUserIds: [managerDiscordUserId],
          status: 'CONFIRMED',
          slotNumber: 10,
          waitlistPosition: null,
          note: null,
          team: null,
        },
      ],
    });

    expect(result).toEqual({ attempted: 8, failed: 0 });
    expect(discordRequest.mock.calls.map((call) => [call[0], call[1]])).toEqual(
      [
        [
          'DELETE',
          `/guilds/guild-1/members/${managerDiscordUserId}/roles/666666666666666666`,
        ],
        [
          'DELETE',
          `/guilds/guild-1/members/${managerDiscordUserId}/roles/777777777777777777`,
        ],
        [
          'PUT',
          `/guilds/guild-1/members/${managerDiscordUserId}/roles/444444444444444444`,
        ],
        [
          'PUT',
          `/guilds/guild-1/members/${managerDiscordUserId}/roles/555555555555555555`,
        ],
        [
          'DELETE',
          `/guilds/guild-1/members/${submitterDiscordUserId}/roles/444444444444444444`,
        ],
        [
          'DELETE',
          `/guilds/guild-1/members/${submitterDiscordUserId}/roles/555555555555555555`,
        ],
        [
          'DELETE',
          `/guilds/guild-1/members/${submitterDiscordUserId}/roles/666666666666666666`,
        ],
        [
          'DELETE',
          `/guilds/guild-1/members/${submitterDiscordUserId}/roles/777777777777777777`,
        ],
      ],
    );
  });

  it('does not create missing Discord roles unless explicitly enabled', async () => {
    const service = new SessionDiscordSyncService({} as never);
    const discordRequest = jest.fn().mockResolvedValue({
      id: 'created-role',
      name: 'Arenzyra Slot sessio',
      permissions: '0',
    });
    (service as never as { discordRequest: jest.Mock }).discordRequest =
      discordRequest;
    const typedService = service as never as {
      ensureRole(params: unknown): Promise<unknown>;
    };

    await expect(
      typedService.ensureRole({
        guildId: 'guild-1',
        roles: [],
        sessionId: 'session-1',
        sessionName: 'Daily Scrim',
        kind: 'Slot',
        color: 0x2563eb,
        configuredId: null,
        configuredName: null,
        allowCreate: false,
      }),
    ).resolves.toBeNull();
    expect(discordRequest).not.toHaveBeenCalled();

    await expect(
      typedService.ensureRole({
        guildId: 'guild-1',
        roles: [],
        sessionId: 'session-1',
        sessionName: 'Daily Scrim',
        kind: 'Slot',
        color: 0x2563eb,
        configuredId: null,
        configuredName: null,
        allowCreate: true,
      }),
    ).resolves.toMatchObject({ id: 'created-role' });
    expect(discordRequest).toHaveBeenCalledWith(
      'POST',
      '/guilds/guild-1/roles',
      expect.objectContaining({ mentionable: false }),
      expect.objectContaining({
        auditReason: 'Arenzyra Slot role sync for Daily Scrim',
      }),
    );
  });

  it('does not rename or recolor Discord roles configured by id', async () => {
    const service = new SessionDiscordSyncService({} as never);
    const discordRequest = jest.fn();
    (service as never as { discordRequest: jest.Mock }).discordRequest =
      discordRequest;
    const typedService = service as never as {
      ensureRole(params: unknown): Promise<unknown>;
    };
    const configuredRole = {
      id: 'configured-ban-role',
      name: 'NORMAL BAN',
      permissions: '0',
    };

    await expect(
      typedService.ensureRole({
        guildId: 'guild-1',
        roles: [configuredRole],
        sessionId: 'session-1',
        sessionName: 'Daily Scrim',
        kind: 'Banned',
        color: 0xdc2626,
        configuredId: configuredRole.id,
        configuredName: null,
        allowCreate: false,
      }),
    ).resolves.toBe(configuredRole);

    expect(discordRequest).not.toHaveBeenCalled();
  });

  it('skips access role sync when no managed roles are available', async () => {
    const prisma = {
      teamMember: {
        findMany: jest.fn().mockResolvedValue([
          {
            teamId: 'team-1',
            discordUserId: '111111111111111111',
            role: 'LEADER',
          },
        ]),
      },
    };
    const service = new SessionDiscordSyncService(prisma as never);
    const discordRequest = jest.fn().mockResolvedValue(null);
    (service as never as { discordRequest: jest.Mock }).discordRequest =
      discordRequest;

    const result = await (
      service as never as {
        syncAccessRoles(params: unknown): Promise<{
          attempted: number;
          failed: number;
        }>;
      }
    ).syncAccessRoles({
      guildId: 'guild-1',
      organizationId: 'org-1',
      setup: {
        slotRole: null,
        idpRole: null,
        waitlistRole: null,
        legacyIdpRole: null,
      },
      registrations: [
        {
          id: 'registration-1',
          teamId: 'team-1',
          leaderDiscordUserId: '111111111111111111',
          managerDiscordUserIds: [],
          status: 'CONFIRMED',
          slotNumber: 10,
          waitlistPosition: null,
          note: null,
          team: null,
        },
      ],
    });

    expect(result).toEqual({ attempted: 0, failed: 0 });
    expect(discordRequest).not.toHaveBeenCalled();
  });

  it('resizes oversized team logos for Discord emoji payloads', async () => {
    const service = new SessionDiscordSyncService({} as never);
    const pixels = Buffer.alloc(1024 * 1024 * 3);
    let seed = 17;
    for (let index = 0; index < pixels.length; index += 1) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      pixels[index] = seed >>> 24;
    }
    const source = await sharp(pixels, {
      raw: { width: 1024, height: 1024, channels: 3 },
    })
      .png()
      .toBuffer();
    expect(source.length).toBeGreaterThan(256 * 1024);

    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      headers: {
        get: (name: string) =>
          name.toLowerCase() === 'content-length'
            ? String(source.length)
            : 'image/png',
      },
      arrayBuffer: async () =>
        source.buffer.slice(
          source.byteOffset,
          source.byteOffset + source.byteLength,
        ),
    } as never);

    try {
      const dataUri = await (
        service as never as {
          fetchDiscordImageDataUri(url: string): Promise<string>;
        }
      ).fetchDiscordImageDataUri('https://example.test/logo.png');
      const [, encoded] = dataUri.split(',');
      const resized = Buffer.from(encoded, 'base64');
      const metadata = await sharp(resized).metadata();

      expect(dataUri.startsWith('data:image/png;base64,')).toBe(true);
      expect(resized.length).toBeLessThanOrEqual(256 * 1024);
      expect(metadata.width).toBeLessThanOrEqual(128);
      expect(metadata.height).toBeLessThanOrEqual(128);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('deletes removed team logo emojis without deleting active team emojis', async () => {
    const removedLogoUrl = 'https://api.arenzyra.test/teams/removed/logo.png';
    const activeLogoUrl = 'https://api.arenzyra.test/teams/active/logo.png';
    const removedEmojiName = teamLogoEmojiName('removed-team', removedLogoUrl);
    const activeEmojiName = teamLogoEmojiName('active-team', activeLogoUrl);
    const prisma = {
      sessionDiscordConfig: {
        findUnique: jest.fn().mockResolvedValue({
          sessionId: 'session-1',
          organizationId: 'org-1',
          enabled: true,
          guildId: 'guild-1',
        }),
        findMany: jest.fn().mockResolvedValue([{ sessionId: 'session-2' }]),
      },
      sessionRegistration: {
        findMany: jest.fn().mockResolvedValue([
          {
            teamId: 'active-team',
            team: {
              id: 'active-team',
              logoUrl: activeLogoUrl,
            },
          },
        ]),
      },
    };
    const service = new SessionDiscordSyncService(prisma as never);
    const discordRequest = jest.fn(
      async (method: string, path: string): Promise<unknown> => {
        if (method === 'GET' && path === '/guilds/guild-1/emojis') {
          return [
            {
              id: 'emoji-removed',
              name: removedEmojiName,
              animated: false,
            },
            {
              id: 'emoji-active',
              name: activeEmojiName,
              animated: false,
            },
          ];
        }
        return null;
      },
    );
    (service as never as { discordRequest: jest.Mock }).discordRequest =
      discordRequest;

    const result = await service.cleanupTeamLogoEmojisForRemovedRegistrations(
      'session-1',
      [
        {
          teamId: 'removed-team',
          team: {
            id: 'removed-team',
            logoUrl: removedLogoUrl,
          },
        },
      ],
      {
        id: 'user-1',
        role: Role.ORGANIZER,
        actorRole: Role.ORGANIZER,
        organizationId: 'org-1',
      } as never,
    );

    expect(result).toEqual({
      ok: true,
      sessionId: 'session-1',
      deleted: 1,
    });
    expect(discordRequest.mock.calls.map((call) => [call[0], call[1]])).toEqual(
      [
        ['GET', '/guilds/guild-1/emojis'],
        ['DELETE', '/guilds/guild-1/emojis/emoji-removed'],
      ],
    );
  });

  it('syncs old logo channel messages into pending team logos', async () => {
    const originalFetch = globalThis.fetch;
    const image = Buffer.from([1, 2, 3]);
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      headers: {
        get: (name: string) =>
          name.toLowerCase() === 'content-type'
            ? 'image/png'
            : name.toLowerCase() === 'content-length'
              ? String(image.length)
              : null,
      },
      arrayBuffer: async () =>
        image.buffer.slice(image.byteOffset, image.byteOffset + image.length),
    } as never);

    const prisma = {
      session: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'session-1',
          organizationId: 'org-1',
          discordConfig: {
            id: 'config-1',
            sessionId: 'session-1',
            organizationId: 'org-1',
            enabled: true,
            guildId: 'guild-1',
            emojis: {
              discordLogoChannelIds: '111111111111111111',
            },
          },
          organization: {
            subscriptionStatus: OrganizationSubscriptionStatus.ACTIVE,
            trialEndsAt: null,
            paidUntil: null,
            discordConfig: {
              guildId: 'guild-1',
              maxSessionCount: 1,
            },
          },
        }),
      },
      team: {
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
      },
      sessionDiscordConfig: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'config-1',
            sessionId: 'session-1',
            emojis: {
              discordLogoChannelIds: '111111111111111111',
            },
          },
          {
            id: 'config-2',
            sessionId: 'session-2',
            emojis: {
              discordLogoChannelIds: '222222222222222222',
            },
          },
        ]),
        update: jest.fn().mockResolvedValue({}),
      },
      sessionRegistration: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const service = new SessionDiscordSyncService(prisma as never);
    const discordRequest = jest.fn().mockResolvedValue([
      {
        id: '1500000000000000000',
        content: '%logo\nTeam DXB',
        author: {
          id: '222222222222222222',
          username: 'manager',
        },
        attachments: [
          {
            id: '333333333333333333',
            url: 'https://cdn.discordapp.com/team-dxb.png',
            filename: 'team-dxb.png',
            content_type: 'image/png',
            size: image.length,
          },
        ],
      },
    ]);
    (service as never as { discordRequest: jest.Mock }).discordRequest =
      discordRequest;

    try {
      const result = await service.syncOldLogoMessages(
        'session-1',
        { limit: 500, channelId: '111111111111111111' },
        {
          id: 'user-1',
          role: Role.ORGANIZER,
          actorRole: Role.ORGANIZER,
          organizationId: 'org-1',
        } as never,
      );

      expect(result).toMatchObject({
        ok: true,
        scanned: 1,
        matched: 1,
        saved: 0,
        pending: 1,
        skipped: 0,
        failed: 0,
        backfilled: 0,
      });
      expect(prisma.sessionDiscordConfig.update).toHaveBeenCalledTimes(2);
      const update = prisma.sessionDiscordConfig.update.mock.calls[0][0];
      const pending = JSON.parse(update.data.emojis.pendingTeamLogos);
      expect(pending['team dxb']).toMatchObject({
        teamName: 'Team DXB',
        channelId: '111111111111111111',
        messageId: '1500000000000000000',
        attachmentId: '333333333333333333',
      });
      const secondUpdate = prisma.sessionDiscordConfig.update.mock.calls[1][0];
      expect(secondUpdate.where.id).toBe('config-2');
      const secondPending = JSON.parse(
        secondUpdate.data.emojis.pendingTeamLogos,
      );
      expect(secondPending['team dxb']).toMatchObject({
        teamName: 'Team DXB',
        channelId: '111111111111111111',
      });
      expect(prisma.team.update).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('backfills active team logos from saved pending server logos', async () => {
    const originalFetch = globalThis.fetch;
    const image = Buffer.from([1, 2, 3]);
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      headers: {
        get: (name: string) =>
          name.toLowerCase() === 'content-type'
            ? 'image/png'
            : name.toLowerCase() === 'content-length'
              ? String(image.length)
              : null,
      },
      arrayBuffer: async () =>
        image.buffer.slice(image.byteOffset, image.byteOffset + image.length),
    } as never);
    const storeSpy = jest
      .spyOn(teamAssetUtil, 'storeTeamLogoProcessed')
      .mockResolvedValue({
        filePath: '/tmp/team-1-logo.png',
        url: 'https://api.arenzyra.com/media/teams/team-1/logo?v=1',
        version: 1,
      });

    const pendingLogo = {
      key: 'team dxb',
      tagKey: 'dxb',
      teamName: 'Team DXB',
      tag: 'DXB',
      channelId: '111111111111111111',
      messageId: '1500000000000000000',
      attachmentId: '333333333333333333',
      url: 'https://cdn.discordapp.com/team-dxb.png',
      filename: 'team-dxb.png',
      contentType: 'image/png',
      savedByDiscordId: null,
      savedByDiscordUsername: null,
      savedAt: '2026-06-10T00:00:00.000Z',
    };
    const prisma = {
      session: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'session-1',
          organizationId: 'org-1',
          discordConfig: {
            id: 'config-1',
            sessionId: 'session-1',
            organizationId: 'org-1',
            enabled: true,
            guildId: 'guild-1',
            emojis: {
              discordLogoChannelIds: '111111111111111111',
            },
          },
          organization: {
            subscriptionStatus: OrganizationSubscriptionStatus.ACTIVE,
            trialEndsAt: null,
            paidUntil: null,
            discordConfig: {
              guildId: 'guild-1',
              maxSessionCount: 1,
            },
          },
        }),
      },
      team: {
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      sessionDiscordConfig: {
        findMany: jest.fn().mockResolvedValue([
          {
            sessionId: 'session-1',
            emojis: {
              pendingTeamLogos: JSON.stringify({ 'team dxb': pendingLogo }),
            },
          },
        ]),
        update: jest.fn().mockResolvedValue({}),
      },
      sessionRegistration: {
        findMany: jest.fn().mockResolvedValue([
          {
            team: {
              id: 'team-1',
              name: 'Team DXB',
              tag: 'DXB',
            },
          },
        ]),
      },
    };
    const service = new SessionDiscordSyncService(prisma as never);
    (service as never as { discordRequest: jest.Mock }).discordRequest = jest
      .fn()
      .mockResolvedValue([]);

    try {
      const result = await service.syncOldLogoMessages(
        'session-1',
        { limit: 500, channelId: '111111111111111111' },
        {
          id: 'user-1',
          role: Role.ORGANIZER,
          actorRole: Role.ORGANIZER,
          organizationId: 'org-1',
        } as never,
      );

      expect(result).toMatchObject({
        ok: true,
        scanned: 0,
        matched: 0,
        saved: 0,
        pending: 0,
        backfilled: 1,
        failed: 0,
      });
      expect(storeSpy).toHaveBeenCalledWith('team-1', {
        buffer: image,
        mimetype: 'image/png',
      });
      expect(prisma.team.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'team-1',
          OR: [{ logoUrl: null }, { logoUrl: '' }],
        },
        data: {
          logoUrl: 'https://api.arenzyra.com/media/teams/team-1/logo?v=1',
        },
      });
    } finally {
      storeSpy.mockRestore();
      globalThis.fetch = originalFetch;
    }
  });

  it('parses emoji-prefixed event slot rows and ignores empty slots', () => {
    const messages: DiscordMessage[] = [
      {
        id: 'message-1',
        content: [
          '📋 Slot List (4/23)',
          '👑 4. [AZ] arenzyra team',
          '✅ 5. [AZ] arenzyra team 5',
          '6. [AZ] arenzyra team 6',
          '▫ 7. EMPTY',
        ].join('\n'),
      },
    ];

    expect(parseDiscordEventSlotRows(messages)).toEqual([
      { slotNumber: 4, teamName: 'arenzyra team', teamTag: 'AZ' },
      { slotNumber: 5, teamName: 'arenzyra team 5', teamTag: 'AZ' },
      { slotNumber: 6, teamName: 'arenzyra team 6', teamTag: 'AZ' },
    ]);
  });

  it('strips leading Discord snowflake ids before bracketed team tags', () => {
    const messages: DiscordMessage[] = [
      {
        id: 'message-1',
        content: [
          '3. 1507358028607918160 [SVG] Savage Esport',
          '4. 1507358317360582707 [W¹] WHITE HOUSE',
        ].join('\n'),
      },
    ];

    expect(parseDiscordEventSlotRows(messages)).toEqual([
      { slotNumber: 3, teamName: 'Savage Esport', teamTag: 'SVG' },
      { slotNumber: 4, teamName: 'WHITE HOUSE', teamTag: 'W¹' },
    ]);
  });

  it('ignores raw Discord emoji id empty slot rows', () => {
    const messages: DiscordMessage[] = [
      {
        id: 'message-1',
        content: [
          '15. [7Q] 7Q ESPORT',
          '16. 1507358485816414279 | EMPTY',
          '17. 1507358505131311205 | EMPTY',
          '18. 1507358528560431124 | EMPTY',
        ].join('\n'),
      },
    ];

    expect(parseDiscordEventSlotRows(messages)).toEqual([
      { slotNumber: 15, teamName: '7Q ESPORT', teamTag: '7Q' },
    ]);
  });

  it('parses slot numbers from Discord custom slot emoji names', () => {
    const messages: DiscordMessage[] = [
      {
        id: 'message-1',
        content: [
          '**Slot List (19/20)**',
          '__<:sl03:1507345237725675560> [GETO] GETO ESPORTS <@1391853445132062770>__',
          '__<:sl04:1507345274635288596> [721STE] 721 stalwarte <@1170721790339846205>__',
          '__<:sl09:1507345411780776018> [NE] Next ECO E-SPORTS <@607703672738021386>__',
          '<:sl22:1507346252491259944> | EMPTY',
          '<a:yellow_star:1507346328928124928> | EMPTY',
        ].join('\n'),
      },
    ];

    expect(parseDiscordEventSlotRows(messages)).toEqual([
      { slotNumber: 3, teamName: 'GETO ESPORTS', teamTag: 'GETO' },
      { slotNumber: 4, teamName: '721 stalwarte', teamTag: '721STE' },
      { slotNumber: 9, teamName: 'Next ECO E-SPORTS', teamTag: 'NE' },
    ]);
  });

  it('maps unknown custom emoji slot rows sequentially from the source layout', () => {
    const messages: DiscordMessage[] = [
      {
        id: 'message-1',
        content: [
          '**GOLDEN SERIES - 16:00 Slot List (9/20) | VIP 0/3**',
          '__<:fix03:1351568093289123914> [MASKMVP] MASKESPORT <@1501163351290417286>__',
          '<:fix04:1351565311840747520> [ANK] ANKARA ESPORTS <@945220247881920512>',
          '<:fix05:1351565348176138302> [VSM] VSM ESPORT <@609263769922568192> <@696023861157691442>',
          '<:fix06:1351565404513898577> [BKB] BLACKBELT TEAM <@1015635204720828529>',
          '<:fix07:1351565435883225269> [ZEN] Zenin <@1267659111089176638>',
          '<:fix08:1351565467894153308> [RC] Riba City <@1259822028240719944>',
          '__<:fix09:1351565497820381185> [MASKICE] MASKice <@1487900685919059990>__',
          '__<:fix10:1351565536265371699> [XFIREESPORT] Fire ESPORT <@1391474890648846387>__',
          '<:fix11:1351565569400373280> [HE] Hell esports <@1510940060441247846>',
          '<:fix12:1351565601838989403> | EMPTY',
        ].join('\n'),
      },
    ];

    expect(
      parseDiscordEventSlotRows(messages, {
        startSlot: 3,
        normalSlots: 20,
        vipSlots: 3,
      }),
    ).toEqual([
      { slotNumber: 3, teamName: 'MASKESPORT', teamTag: 'MASKMVP' },
      { slotNumber: 4, teamName: 'ANKARA ESPORTS', teamTag: 'ANK' },
      { slotNumber: 5, teamName: 'VSM ESPORT', teamTag: 'VSM' },
      { slotNumber: 6, teamName: 'BLACKBELT TEAM', teamTag: 'BKB' },
      { slotNumber: 7, teamName: 'Zenin', teamTag: 'ZEN' },
      { slotNumber: 8, teamName: 'Riba City', teamTag: 'RC' },
      { slotNumber: 9, teamName: 'MASKice', teamTag: 'MASKICE' },
      { slotNumber: 10, teamName: 'Fire ESPORT', teamTag: 'XFIREESPORT' },
      { slotNumber: 11, teamName: 'Hell esports', teamTag: 'HE' },
    ]);
  });

  it('maps VIP slot-list rows without numeric markers after normal slots', () => {
    const messages: DiscordMessage[] = [
      {
        id: 'message-1',
        content: [
          '**Slot List (20/20) | <:vip:1507367056687763476> VIP 1/3**',
          '__22. [HTR] Blood hunters <@1461845112932794480>__',
          '<:vip:1507367056687763476> [MRT] MrThoko <@764878981744820244>',
        ].join('\n'),
      },
    ];

    expect(
      parseDiscordEventSlotRows(messages, {
        startSlot: 3,
        normalSlots: 20,
        vipSlots: 3,
      }),
    ).toEqual([
      { slotNumber: 22, teamName: 'Blood hunters', teamTag: 'HTR' },
      { slotNumber: 23, teamName: 'MrThoko', teamTag: 'MRT' },
    ]);
  });

  it('maps unnumbered filled rows with any custom emoji after normal slots', () => {
    const messages: DiscordMessage[] = [
      {
        id: 'message-1',
        content: [
          '**Slot List (18/20) | <:VIPslot:1507321935531348049> VIP 2/3**',
          '__<:sl21:1507345936655974450> [ZG] Zero Gravity <@698955044439195748>__',
          '__<:sl22:1507346252491259944> [SS1] SWATEsport <@1405882281553301574>__',
          '__<a:yellow_star:1507346328928124928> [33] Team 33 <@1404514664540278884>__',
          '__<a:custom_badge:1507346328928124929> [333] 333 ESPORTS <@1060948736949362809>__',
          '<a:anything_else:1507346328928130000> | EMPTY',
        ].join('\n'),
      },
    ];

    expect(
      parseDiscordEventSlotRows(messages, {
        startSlot: 3,
        normalSlots: 20,
        vipSlots: 3,
      }),
    ).toEqual([
      { slotNumber: 21, teamName: 'Zero Gravity', teamTag: 'ZG' },
      { slotNumber: 22, teamName: 'SWATEsport', teamTag: 'SS1' },
      { slotNumber: 23, teamName: 'Team 33', teamTag: '33' },
      { slotNumber: 24, teamName: '333 ESPORTS', teamTag: '333' },
    ]);
  });

  it('does not import announcement-only messages as unnumbered VIP slots', () => {
    const messages: DiscordMessage[] = [
      {
        id: 'announcement',
        content: [
          '<:4bs:1402931426319536138> **BASTARDS ESPORTS**',
          '- __CONFIRMATIONS ARE NOW OPEN FOR TODAY 20 CEST!__',
          '*Confirm or cancel your slot til 19:00 CEST or your slot will be removed !*',
        ].join('\n'),
      },
      {
        id: 'slot-list',
        content: [
          '**Slot List (20/20) | <:VIPslot:1507321935531348049> VIP 0/3**',
          '<:sl21:1507345936655974450> [SICK] Sick Industries <@842102600631451679>',
          '__<:sl22:1507346252491259944> [RB] RedBlood <@842453742947401758>__',
          '<a:yellow_star:1507346328928124928> | EMPTY',
          '<a:yellow_star:1507346328928124928> | EMPTY',
          '<a:yellow_star:1507346328928124928> | EMPTY',
        ].join('\n'),
      },
    ];

    expect(
      parseDiscordEventSlotRows(messages, {
        startSlot: 3,
        normalSlots: 20,
        vipSlots: 3,
      }),
    ).toEqual([
      { slotNumber: 21, teamName: 'Sick Industries', teamTag: 'SICK' },
      { slotNumber: 22, teamName: 'RedBlood', teamTag: 'RB' },
    ]);
  });

  it('maps plain unnumbered filled rows after the highest numbered row', () => {
    const messages: DiscordMessage[] = [
      {
        id: 'message-1',
        content: [
          '20. [7S] 7Seas',
          '[ZG] Zero Gravity',
          'SS1 | SWATEsport',
          'Organizer note: use room 4',
        ].join('\n'),
      },
    ];

    expect(parseDiscordEventSlotRows(messages)).toEqual([
      { slotNumber: 20, teamName: '7Seas', teamTag: '7S' },
      { slotNumber: 21, teamName: 'Zero Gravity', teamTag: 'ZG' },
      { slotNumber: 22, teamName: 'SWATEsport', teamTag: 'SS1' },
    ]);
  });

  it('does not collapse different event teams that share the same tag', async () => {
    const service = new SessionDiscordSyncService({} as never);
    const tx = {
      team: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'created-team' }),
      },
    };

    await (
      service as never as {
        findOrCreateImportedDiscordTeam(params: unknown): Promise<string>;
      }
    ).findOrCreateImportedDiscordTeam({
      tx,
      organizationId: 'org-1',
      ownerUserId: 'user-1',
      row: {
        slotNumber: 5,
        teamName: 'arenzyra team 5',
        teamTag: 'AZ',
      },
    });

    expect(tx.team.findFirst).toHaveBeenCalledWith({
      where: {
        organizationId: 'org-1',
        deletedAt: null,
        name: { equals: 'arenzyra team 5', mode: 'insensitive' },
      },
      select: { id: true, logoUrl: true },
    });
    expect(tx.team.create).toHaveBeenCalledWith({
      data: {
        organizationId: 'org-1',
        ownerUserId: 'user-1',
        name: 'arenzyra team 5',
        tag: 'AZ',
      },
      select: { id: true },
    });
  });

  it('fills missing copied foreign team logos from the source organization', async () => {
    const service = new SessionDiscordSyncService({} as never);
    const tx = {
      team: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce({
            logoUrl:
              'https://api.arenzyra.com/media/teams/source-team/logo?v=1',
          })
          .mockResolvedValueOnce({ id: 'copied-team', logoUrl: null }),
        update: jest.fn().mockResolvedValue({ id: 'copied-team' }),
        create: jest.fn(),
      },
    };

    const teamId = await (
      service as never as {
        findOrCreateImportedDiscordTeam(params: unknown): Promise<string>;
      }
    ).findOrCreateImportedDiscordTeam({
      tx,
      organizationId: 'global-org',
      sourceOrganizationId: 'bastards-org',
      ownerUserId: 'user-1',
      row: {
        slotNumber: 17,
        teamName: 'MrThoko',
        teamTag: 'MT',
      },
    });

    expect(teamId).toBe('copied-team');
    expect(tx.team.update).toHaveBeenCalledWith({
      where: { id: 'copied-team' },
      data: {
        logoUrl: 'https://api.arenzyra.com/media/teams/source-team/logo?v=1',
      },
    });
  });

  it('does not copy a foreign logo from a different team sharing the same tag', async () => {
    const service = new SessionDiscordSyncService({} as never);
    const tx = {
      team: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({ id: 'meeting-titans', logoUrl: null }),
        update: jest.fn(),
        create: jest.fn(),
      },
    };

    await (
      service as never as {
        findOrCreateImportedDiscordTeam(params: unknown): Promise<string>;
      }
    ).findOrCreateImportedDiscordTeam({
      tx,
      organizationId: 'global-org',
      sourceOrganizationId: 'bastards-org',
      ownerUserId: 'user-1',
      row: {
        slotNumber: 4,
        teamName: 'MEETING TITANS',
        teamTag: 'MT',
      },
    });

    expect(tx.team.findFirst).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: 'bastards-org',
          name: { equals: 'MEETING TITANS', mode: 'insensitive' },
        }),
      }),
    );
    expect(tx.team.update).not.toHaveBeenCalled();
  });

  it('reuses an imported slot row when the source changes the team in that slot', async () => {
    const service = new SessionDiscordSyncService({} as never);
    const tx = {
      team: {
        findFirst: jest.fn().mockResolvedValue({ id: 'new-team' }),
        create: jest.fn(),
      },
      sessionRegistration: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'registration-slot-5',
            teamId: 'old-team',
            leaderDiscordUserId: null,
            managerDiscordUserIds: [],
            status: SessionRegistrationStatus.CONFIRMED,
            slotNumber: 5,
            note: 'DISCORD_EVENT_IMPORT:category=source-category;channel=source-slot-list;slot=5',
          },
        ]),
        update: jest.fn().mockResolvedValue({ id: 'registration-slot-5' }),
        create: jest.fn(),
      },
    };

    const result = await (
      service as never as {
        applyDiscordEventSlotRows(params: unknown): Promise<{
          importedTeams: number;
          skipped: unknown[];
        }>;
      }
    ).applyDiscordEventSlotRows({
      tx,
      organizationId: 'global-org',
      sessionId: 'event-1',
      categoryId: 'source-category',
      slotListChannelId: 'source-slot-list',
      ownerUserId: 'user-1',
      rows: [{ slotNumber: 5, teamName: 'From mars', teamTag: 'MARS' }],
    });

    expect(tx.sessionRegistration.create).not.toHaveBeenCalled();
    expect(tx.sessionRegistration.update).toHaveBeenCalledTimes(1);
    expect(tx.sessionRegistration.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'registration-slot-5' },
        data: expect.objectContaining({
          teamId: 'new-team',
          status: SessionRegistrationStatus.CONFIRMED,
          slotNumber: 5,
          removedAt: null,
          removalReason: null,
        }),
      }),
    );
    expect(result).toEqual({ importedTeams: 1, skipped: [] });
  });
});

describe('read-only foreign Discord event sources', () => {
  const actor = {
    id: 'user-1',
    actorId: 'user-1',
    role: Role.SUPER_ADMIN,
    actorRole: Role.SUPER_ADMIN,
    organizationId: 'global-org',
    orgId: 'global-org',
    actingOrgId: 'global-org',
    actingRole: Role.ORGANIZER,
    actingOrgName: 'Global Control',
    actingAsUserId: 'user-1',
    realRole: Role.SUPER_ADMIN,
  };

  function importHarness(
    selectedGuild: {
      organizationId: string;
      guildId: string;
      guildName: string | null;
      isForeignSource: boolean;
    },
    options: {
      slotListChannelName?: string;
      slotRows?: Array<{
        slotNumber: number;
        teamName: string;
        teamTag: string | null;
      }>;
    } = {},
  ) {
    const tx = {
      session: {
        create: jest.fn().mockResolvedValue({
          id: 'event-1',
          name: 'Foreign Event',
          status: 'OPEN',
          slotCount: 25,
          gameId: null,
          game: null,
          createdAt: new Date('2026-05-25T00:00:00.000Z'),
        }),
        update: jest.fn(),
      },
      sessionDiscordConfig: {
        upsert: jest.fn().mockResolvedValue({ id: 'config-1' }),
      },
    };
    const prisma = {
      session: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      sessionDiscordConfig: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      $transaction: jest.fn(async (callback: (transaction: any) => unknown) =>
        callback(tx),
      ),
    };
    const service = new SessionDiscordSyncService(prisma as never);
    const harness = service as never as {
      requireOrganizationDiscordGuild: jest.Mock;
      fetchGuildChannels: jest.Mock;
      readDiscordSlotRows: jest.Mock;
      resolveGameIdentity: jest.Mock;
      applyDiscordEventSlotRows: jest.Mock;
      importEventWithDiscordRows(params: unknown): Promise<unknown>;
    };
    harness.requireOrganizationDiscordGuild = jest
      .fn()
      .mockResolvedValue(selectedGuild);
    harness.fetchGuildChannels = jest.fn().mockResolvedValue([
      { id: 'source-category', name: 'Foreign Event', type: 4 },
      {
        id: 'source-slot-list',
        name: options.slotListChannelName ?? 'slot-list',
        type: 0,
        parent_id: 'source-category',
      },
    ]);
    harness.readDiscordSlotRows = jest
      .fn()
      .mockResolvedValue(options.slotRows ?? []);
    harness.resolveGameIdentity = jest.fn().mockResolvedValue(null);
    harness.applyDiscordEventSlotRows = jest
      .fn()
      .mockResolvedValue({ importedTeams: 0, skipped: [] });
    return { service, tx, prisma };
  }

  it('stores foreign imports as read-only sources without active Discord ownership', async () => {
    const { service, tx } = importHarness({
      organizationId: 'bastards-org',
      guildId: 'foreign-guild',
      guildName: 'Bastards',
      isForeignSource: true,
    });

    const result = await (
      service as never as {
        importEventWithDiscordRows(params: unknown): Promise<{
          discord: { readOnlySource: boolean };
        }>;
      }
    ).importEventWithDiscordRows({
      organizationId: 'global-org',
      actor,
      guildId: 'foreign-guild',
      categoryId: 'source-category',
      slotListChannelId: 'source-slot-list',
      importTeams: true,
    });

    const upsert = tx.sessionDiscordConfig.upsert.mock.calls[0][0];
    expect(upsert.create).toMatchObject({
      organizationId: 'global-org',
      sessionId: 'event-1',
      enabled: false,
      guildId: null,
      categoryId: null,
      slotListChannelId: null,
      importSourceOrganizationId: 'bastards-org',
      importSourceGuildId: 'foreign-guild',
      importSourceGuildName: 'Bastards',
      importSourceCategoryId: 'source-category',
      importSourceCategoryName: 'Foreign Event',
      importSourceSlotListChannelId: 'source-slot-list',
      importSourceSlotListChannelName: 'slot-list',
      importSourceSyncEnabled: true,
      importSourceLastError: null,
    });
    expect(result.discord.readOnlySource).toBe(true);
  });

  it('keeps PUBG slot layout while numeric slot-list channel names set playable capacity', async () => {
    const { service, tx } = importHarness(
      {
        organizationId: 'bastards-org',
        guildId: 'foreign-guild',
        guildName: 'Bastards',
        isForeignSource: true,
      },
      {
        slotListChannelName: '23-slots',
        slotRows: [{ slotNumber: 15, teamName: '7Q ESPORT', teamTag: '7Q' }],
      },
    );

    await (
      service as never as {
        importEventWithDiscordRows(params: unknown): Promise<unknown>;
      }
    ).importEventWithDiscordRows({
      organizationId: 'global-org',
      actor,
      guildId: 'foreign-guild',
      categoryId: 'source-category',
      slotListChannelId: 'source-slot-list',
      importTeams: true,
    });

    expect(tx.session.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          slotCount: 25,
          maxTeams: 25,
        }),
      }),
    );
    expect(tx.sessionDiscordConfig.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          startSlot: 3,
          normalSlots: 23,
        }),
      }),
    );
  });

  it('keeps same-organization imports as active Discord links', async () => {
    const { service, tx } = importHarness({
      organizationId: 'global-org',
      guildId: 'own-guild',
      guildName: 'Global Control',
      isForeignSource: false,
    });

    const result = await (
      service as never as {
        importEventWithDiscordRows(params: unknown): Promise<{
          discord: { readOnlySource: boolean };
        }>;
      }
    ).importEventWithDiscordRows({
      organizationId: 'global-org',
      actor,
      guildId: 'own-guild',
      categoryId: 'source-category',
      slotListChannelId: 'source-slot-list',
      importTeams: true,
    });

    const upsert = tx.sessionDiscordConfig.upsert.mock.calls[0][0];
    expect(upsert.create).toMatchObject({
      enabled: true,
      guildId: 'own-guild',
      categoryId: 'source-category',
      slotListChannelId: 'source-slot-list',
      importSourceGuildId: null,
      importSourceCategoryId: null,
      importSourceSyncEnabled: false,
    });
    expect(result.discord.readOnlySource).toBe(false);
  });

  it('refreshes copied foreign events from source fields', async () => {
    const prisma = {
      session: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'event-1',
          discordConfig: {
            guildId: null,
            categoryId: null,
            slotListChannelId: null,
            importSourceGuildId: 'foreign-guild',
            importSourceCategoryId: 'source-category',
            importSourceSlotListChannelId: 'source-slot-list',
            importSourceSyncEnabled: true,
          },
        }),
      },
    };
    const service = new SessionDiscordSyncService(prisma as never);
    const harness = service as never as {
      importEventWithDiscordRows: jest.Mock;
      syncDraftEventMatchesFromRegistrations: jest.Mock;
    };
    harness.importEventWithDiscordRows = jest.fn().mockResolvedValue({
      id: 'event-1',
      discord: { readOnlySource: true },
    });
    harness.syncDraftEventMatchesFromRegistrations = jest
      .fn()
      .mockResolvedValue({ created: 0, updated: 0 });

    await service.refreshEventFromDiscord('event-1', actor as never);

    expect(harness.importEventWithDiscordRows).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'global-org',
        guildId: 'foreign-guild',
        categoryId: 'source-category',
        slotListChannelId: 'source-slot-list',
        existingSessionId: 'event-1',
      }),
    );
  });

  it('resizes draft matches to the refreshed event capacity', async () => {
    const prisma = {
      session: {
        findFirst: jest.fn().mockResolvedValue({ slotCount: 23 }),
      },
      match: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'match-1',
            slotCount: 25,
            dataMode: 'AUTO',
            dataSource: 'AUTO',
          },
        ]),
        update: jest.fn().mockResolvedValue({ id: 'match-1' }),
      },
      sessionRegistration: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const service = new SessionDiscordSyncService(prisma as never);

    await (
      service as never as {
        syncDraftEventMatchesFromRegistrations(
          sessionId: string,
          organizationId: string,
        ): Promise<unknown>;
      }
    ).syncDraftEventMatchesFromRegistrations('event-1', 'global-org');

    expect(prisma.match.update).toHaveBeenCalledWith({
      where: { id: 'match-1' },
      data: { slotCount: 23 },
    });
  });

  it('automatic source sync refreshes due foreign events only through source fields', async () => {
    const prisma = {
      sessionDiscordConfig: {
        findMany: jest.fn().mockResolvedValue([
          {
            sessionId: 'event-1',
            organizationId: 'global-org',
            importSourceGuildId: 'foreign-guild',
            importSourceCategoryId: 'source-category',
            importSourceSlotListChannelId: 'source-slot-list',
            session: {
              id: 'event-1',
              createdById: 'creator-1',
              updatedById: null,
            },
            organization: {
              name: 'Global Control',
              ownerUserId: null,
            },
          },
        ]),
        update: jest.fn(),
      },
    };
    const service = new SessionDiscordSyncService(prisma as never);
    const harness = service as never as {
      importEventWithDiscordRows: jest.Mock;
      syncDraftEventMatchesFromRegistrations: jest.Mock;
    };
    harness.importEventWithDiscordRows = jest.fn().mockResolvedValue({
      id: 'event-1',
    });
    harness.syncDraftEventMatchesFromRegistrations = jest
      .fn()
      .mockResolvedValue({ created: 0, updated: 0 });

    const result = await service.refreshForeignEventSources();

    expect(result).toEqual({ refreshed: 1, skipped: false });
    expect(harness.importEventWithDiscordRows).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'global-org',
        guildId: 'foreign-guild',
        categoryId: 'source-category',
        slotListChannelId: 'source-slot-list',
        existingSessionId: 'event-1',
      }),
    );
  });

  it('refreshes copied foreign events immediately from a synced source session', async () => {
    const prisma = {
      session: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'source-session',
          discordConfig: {
            enabled: true,
            guildId: 'foreign-guild',
            categoryId: 'source-category',
            slotListChannelId: 'source-slot-list',
          },
        }),
      },
      sessionDiscordConfig: {
        findMany: jest.fn().mockResolvedValue([
          {
            sessionId: 'event-1',
            organizationId: 'global-org',
            importSourceGuildId: 'foreign-guild',
            importSourceCategoryId: 'source-category',
            importSourceSlotListChannelId: 'source-slot-list',
            session: {
              id: 'event-1',
              createdById: 'creator-1',
              updatedById: null,
            },
            organization: {
              name: 'Global Control',
              ownerUserId: null,
            },
          },
        ]),
        update: jest.fn(),
      },
    };
    const service = new SessionDiscordSyncService(prisma as never);
    const harness = service as never as {
      importEventWithDiscordRows: jest.Mock;
      syncDraftEventMatchesFromRegistrations: jest.Mock;
    };
    harness.importEventWithDiscordRows = jest.fn().mockResolvedValue({
      id: 'event-1',
    });
    harness.syncDraftEventMatchesFromRegistrations = jest
      .fn()
      .mockResolvedValue({ created: 0, updated: 0 });

    const result = await service.refreshForeignEventSourcesForSourceSession(
      'source-session',
      {
        ...actor,
        organizationId: 'source-org',
        orgId: 'source-org',
        actingOrgId: 'source-org',
        actingOrgName: 'Source Org',
      } as never,
    );

    expect(result).toEqual({ refreshed: 1, skipped: false });
    expect(prisma.sessionDiscordConfig.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          importSourceSyncEnabled: true,
          importSourceGuildId: 'foreign-guild',
          importSourceCategoryId: 'source-category',
          importSourceSlotListChannelId: 'source-slot-list',
        }),
      }),
    );
    expect(harness.importEventWithDiscordRows).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'global-org',
        guildId: 'foreign-guild',
        categoryId: 'source-category',
        slotListChannelId: 'source-slot-list',
        existingSessionId: 'event-1',
      }),
    );
  });
});

describe('production slot event import', () => {
  const actor = {
    id: 'user-1',
    actorId: 'user-1',
    role: Role.ORGANIZER,
    actorRole: Role.ORGANIZER,
    organizationId: 'global-org',
    orgId: 'global-org',
  };

  it('creates an event from saved production slots', async () => {
    const tx = {
      session: {
        create: jest.fn().mockResolvedValue({
          id: 'event-1',
          name: 'Production Event',
          status: 'OPEN',
          slotCount: 25,
          gameId: 'game-pubg',
          game: { id: 'game-pubg', key: 'PUBG_MOBILE', name: 'PUBG Mobile' },
          createdAt: new Date('2026-06-02T00:00:00.000Z'),
        }),
      },
    };
    const prisma = {
      organizationFeature: {
        findUnique: jest.fn().mockResolvedValue({
          isEnabled: true,
          config: {
            categoryId: '775509232354983967',
            categoryName: 'Production',
            slotsChannelId: '775509232354983968',
            slotsChannelName: 'slots',
            slots: [
              {
                slotNumber: 4,
                teamName: 'Mad Kings',
                teamTag: 'MAD',
              },
              {
                slotNumber: 3,
                teamName: 'Prime',
                teamTag: 'PRM',
              },
            ],
          },
        }),
      },
      game: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'game-pubg',
          key: 'PUBG_MOBILE',
        }),
      },
      $transaction: jest.fn(async (callback: (transaction: any) => unknown) =>
        callback(tx),
      ),
    };
    const service = new SessionDiscordSyncService(prisma as never);
    const harness = service as never as {
      applyDiscordEventSlotRows: jest.Mock;
      syncDraftEventMatchesFromRegistrations: jest.Mock;
    };
    harness.applyDiscordEventSlotRows = jest
      .fn()
      .mockResolvedValue({ importedTeams: 2, skipped: [] });
    harness.syncDraftEventMatchesFromRegistrations = jest
      .fn()
      .mockResolvedValue({ created: 0, updated: 0 });

    const result = await service.importEventFromProductionSlots(
      {
        eventName: ' Production Event ',
        gameKey: 'PUBG_MOBILE',
      },
      actor as never,
    );

    expect(tx.session.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: 'global-org',
          name: 'Production Event',
          type: 'EVENT',
          status: 'OPEN',
          slotCount: 25,
          maxTeams: 25,
          gameId: 'game-pubg',
        }),
      }),
    );
    expect(harness.applyDiscordEventSlotRows).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'global-org',
        sessionId: 'event-1',
        categoryId: '775509232354983967',
        slotListChannelId: '775509232354983968',
        importNotePrefix: 'PRODUCTION_EVENT_IMPORT:',
        importSourceLabel: 'Production slot-list',
        rows: [
          { slotNumber: 3, teamName: 'Prime', teamTag: 'PRM' },
          { slotNumber: 4, teamName: 'Mad Kings', teamTag: 'MAD' },
        ],
      }),
    );
    expect(harness.syncDraftEventMatchesFromRegistrations).toHaveBeenCalledWith(
      'event-1',
      'global-org',
    );
    expect(result).toMatchObject({
      id: 'event-1',
      importedTeams: 2,
      production: {
        parsedSlotRows: 2,
        categoryName: 'Production',
        slotListChannelName: 'slots',
      },
    });
  });
});

describe('existing Discord channel sync', () => {
  it('does not rewrite existing channel permission overwrites by default', async () => {
    const service = new SessionDiscordSyncService({} as never);
    const discordRequest = jest.fn().mockResolvedValue({
      id: 'registration-1',
      name: 'registration',
      type: 0,
      parent_id: 'category-1',
      topic: 'arenzyra-session=session-1;kind=registration',
    });
    const harness = service as never as {
      discordRequest: jest.Mock;
      ensureTextChannel(params: unknown): Promise<unknown>;
    };
    harness.discordRequest = discordRequest;

    await harness.ensureTextChannel({
      guildId: 'guild-1',
      channels: [
        {
          id: 'registration-1',
          name: 'old-registration',
          type: 0,
          parent_id: 'category-1',
          topic: 'old topic',
        },
      ],
      categoryId: 'category-1',
      sessionId: 'session-1',
      kind: 'registration',
      name: 'registration',
      configuredId: 'registration-1',
      overwrites: [{ id: 'guild-1', type: 0, allow: '1024', deny: '0' }],
    });

    expect(discordRequest).toHaveBeenCalledTimes(2);
    const payload = discordRequest.mock.calls[0][2];
    expect(payload).toEqual({
      name: 'registration',
      parent_id: 'category-1',
      topic: 'arenzyra-session=session-1;kind=registration',
    });
    expect(payload).not.toHaveProperty('permission_overwrites');
    expect(discordRequest.mock.calls[1][0]).toBe('PUT');
    expect(discordRequest.mock.calls[1][1]).toBe(
      '/channels/registration-1/permissions/guild-1',
    );
    expect(discordRequest.mock.calls[1][2]).toEqual({
      type: 0,
      allow: '0',
      deny: '326417516608',
    });
  });

  it('can explicitly rewrite existing channel permission overwrites', async () => {
    const service = new SessionDiscordSyncService({} as never);
    const discordRequest = jest.fn().mockResolvedValue({
      id: 'registration-1',
      name: 'registration',
      type: 0,
      parent_id: 'category-1',
      topic: 'arenzyra-session=session-1;kind=registration',
    });
    const harness = service as never as {
      discordRequest: jest.Mock;
      ensureTextChannel(params: unknown): Promise<unknown>;
    };
    harness.discordRequest = discordRequest;
    const overwrites = [{ id: 'guild-1', type: 0, allow: '1024', deny: '0' }];

    await harness.ensureTextChannel({
      guildId: 'guild-1',
      channels: [
        {
          id: 'registration-1',
          name: 'old-registration',
          type: 0,
          parent_id: 'category-1',
          topic: 'old topic',
        },
      ],
      categoryId: 'category-1',
      sessionId: 'session-1',
      kind: 'registration',
      name: 'registration',
      configuredId: 'registration-1',
      overwrites,
      manageExistingPermissions: true,
    });

    expect(discordRequest).toHaveBeenCalledTimes(1);
    expect(discordRequest.mock.calls[0][2]).toEqual(
      expect.objectContaining({ permission_overwrites: overwrites }),
    );
  });

  it('preserved bot-controlled channels only patch reaction and thread permission bits', async () => {
    const service = new SessionDiscordSyncService({} as never);
    const discordRequest = jest.fn().mockResolvedValue({
      id: 'slot-list-1',
      name: 'custom-slot-list',
      type: 0,
      parent_id: 'category-1',
      topic: 'old topic',
    });
    const harness = service as never as {
      discordRequest: jest.Mock;
      ensureTextChannel(params: unknown): Promise<unknown>;
    };
    harness.discordRequest = discordRequest;

    const result = await harness.ensureTextChannel({
      guildId: 'guild-1',
      channels: [
        {
          id: 'slot-list-1',
          name: 'custom-slot-list',
          type: 0,
          parent_id: 'category-1',
          topic: 'old topic',
          permission_overwrites: [
            { id: 'guild-1', type: 0, allow: '1024', deny: '0' },
            { id: 'slot-role', type: 0, allow: '0', deny: '0' },
            { id: 'extra-role', type: 0, allow: '64', deny: '0' },
            { id: 'staff-role', type: 0, allow: '8192', deny: '0' },
          ],
        },
      ],
      categoryId: 'category-2',
      sessionId: 'session-1',
      kind: 'slot-list',
      name: 'slot-list',
      configuredId: 'slot-list-1',
      preserveConfigured: true,
      botUserId: 'bot-user',
      overwrites: [
        { id: 'guild-1', type: 0, allow: '0', deny: '1024' },
        { id: 'slot-role', type: 0, allow: '1024', deny: '2048' },
        { id: 'staff-role', type: 0, allow: '8192', deny: '0' },
        { id: 'bot-user', type: 1, allow: '0', deny: '0' },
      ],
    });

    expect(result).toMatchObject({ id: 'slot-list-1' });
    expect(discordRequest).toHaveBeenCalledTimes(5);
    expect(discordRequest.mock.calls.map((call) => call[0])).toEqual([
      'PUT',
      'PUT',
      'PUT',
      'PUT',
      'PUT',
    ]);
    expect(discordRequest.mock.calls.map((call) => call[1]).sort()).toEqual([
      '/channels/slot-list-1/permissions/bot-user',
      '/channels/slot-list-1/permissions/extra-role',
      '/channels/slot-list-1/permissions/guild-1',
      '/channels/slot-list-1/permissions/slot-role',
      '/channels/slot-list-1/permissions/staff-role',
    ]);
    expect(discordRequest).toHaveBeenCalledWith(
      'PUT',
      '/channels/slot-list-1/permissions/guild-1',
      { type: 0, allow: '1024', deny: '326417514560' },
      expect.objectContaining({
        auditReason: 'Arenzyra slot-list reaction/thread permission lock',
      }),
    );
    expect(discordRequest).toHaveBeenCalledWith(
      'PUT',
      '/channels/slot-list-1/permissions/extra-role',
      { type: 0, allow: '0', deny: '326417514560' },
      expect.anything(),
    );
    expect(discordRequest).toHaveBeenCalledWith(
      'PUT',
      '/channels/slot-list-1/permissions/staff-role',
      { type: 0, allow: '326417522752', deny: '0' },
      expect.anything(),
    );
    expect(discordRequest).toHaveBeenCalledWith(
      'PUT',
      '/channels/slot-list-1/permissions/bot-user',
      { type: 1, allow: '326417514560', deny: '0' },
      expect.anything(),
    );
  });

  it('preserved registration channels patch send access from the desired registration state', async () => {
    const service = new SessionDiscordSyncService({} as never);
    const discordRequest = jest.fn().mockResolvedValue({
      id: 'registration-1',
      name: 'custom-registration',
      type: 0,
      parent_id: 'category-1',
      topic: 'old topic',
    });
    const harness = service as never as {
      discordRequest: jest.Mock;
      ensureTextChannel(params: unknown): Promise<unknown>;
    };
    harness.discordRequest = discordRequest;

    const result = await harness.ensureTextChannel({
      guildId: 'guild-1',
      channels: [
        {
          id: 'registration-1',
          name: 'custom-registration',
          type: 0,
          parent_id: 'category-1',
          topic: 'old topic',
          permission_overwrites: [
            { id: 'guild-1', type: 0, allow: '2048', deny: '0' },
            { id: 'registration-role', type: 0, allow: '2048', deny: '0' },
            { id: 'extra-role', type: 0, allow: '2048', deny: '0' },
            { id: 'staff-role', type: 0, allow: '8192', deny: '0' },
          ],
        },
      ],
      categoryId: 'category-2',
      sessionId: 'session-1',
      kind: 'registration',
      name: 'registration',
      configuredId: 'registration-1',
      preserveConfigured: true,
      botUserId: 'bot-user',
      overwrites: [
        { id: 'guild-1', type: 0, allow: '0', deny: '2048' },
        { id: 'registration-role', type: 0, allow: '2048', deny: '0' },
        { id: 'staff-role', type: 0, allow: '10240', deny: '0' },
      ],
    });

    expect(result).toMatchObject({ id: 'registration-1' });
    expect(discordRequest).toHaveBeenCalledTimes(5);
    expect(discordRequest.mock.calls.map((call) => call[0])).toEqual([
      'PUT',
      'PUT',
      'PUT',
      'PUT',
      'PUT',
    ]);
    expect(discordRequest.mock.calls.map((call) => call[1]).sort()).toEqual([
      '/channels/registration-1/permissions/bot-user',
      '/channels/registration-1/permissions/extra-role',
      '/channels/registration-1/permissions/guild-1',
      '/channels/registration-1/permissions/registration-role',
      '/channels/registration-1/permissions/staff-role',
    ]);
    expect(discordRequest).toHaveBeenCalledWith(
      'PUT',
      '/channels/registration-1/permissions/guild-1',
      { type: 0, allow: '0', deny: '326417516608' },
      expect.objectContaining({
        auditReason: 'Arenzyra registration access permission lock',
      }),
    );
    expect(discordRequest).toHaveBeenCalledWith(
      'PUT',
      '/channels/registration-1/permissions/registration-role',
      { type: 0, allow: '2048', deny: '326417514560' },
      expect.anything(),
    );
    expect(discordRequest).toHaveBeenCalledWith(
      'PUT',
      '/channels/registration-1/permissions/extra-role',
      { type: 0, allow: '0', deny: '326417516608' },
      expect.anything(),
    );
    expect(discordRequest).toHaveBeenCalledWith(
      'PUT',
      '/channels/registration-1/permissions/staff-role',
      { type: 0, allow: '326417524800', deny: '0' },
      expect.anything(),
    );
    expect(discordRequest).toHaveBeenCalledWith(
      'PUT',
      '/channels/registration-1/permissions/bot-user',
      { type: 1, allow: '326417516608', deny: '0' },
      expect.anything(),
    );
  });

  it('opens only the active early access role when public registration is closed', () => {
    const service = new SessionDiscordSyncService({} as never);
    const harness = service as never as {
      registrationOverwrites(
        guildId: string,
        staffRoles: Array<{ id: string; name: string; permissions: string }>,
        roles: Array<{ id: string; name: string; permissions: string }>,
        session: {
          status: string;
          registrationOpenAt: Date | string | null;
          registrationCloseAt: Date | string | null;
        },
        config: unknown,
        organizationAccessRoles: {
          earlyAccessRoleId: string | null;
          vipAccessRoleId: string | null;
        },
      ): Array<{ id: string; allow: string; deny: string }>;
    };

    const overwrites = harness.registrationOverwrites(
      'guild-1',
      [{ id: 'staff-role', name: 'Staff', permissions: '0' }],
      [
        { id: 'normal-role', name: '20 Scrim', permissions: '0' },
        { id: 'early-role', name: 'Fast Track', permissions: '0' },
        { id: 'vip-role', name: 'VIP', permissions: '0' },
        { id: 'staff-role', name: 'Staff', permissions: '0' },
      ],
      {
        status: 'OPEN',
        registrationOpenAt: '2999-01-01T00:00:00.000Z',
        registrationCloseAt: null,
      },
      {
        registrationRoleIds: ['normal-role'],
        specialRegistrationRoleIds: [],
        vipRoleIds: [],
        emojis: {
          earlyAccessEnabled: 'true',
          earlyAccessOpensAt: '2000-01-01T00:00:00.000Z',
          earlyAccessClosesAt: '2999-01-01T00:00:00.000Z',
          vipAccessEnabled: 'true',
          vipAccessOpensAt: '2000-01-01T00:00:00.000Z',
          vipAccessClosesAt: '2000-01-02T00:00:00.000Z',
        },
      },
      { earlyAccessRoleId: 'early-role', vipAccessRoleId: 'vip-role' },
    );

    const byId = new Map(
      overwrites.map((overwrite) => [overwrite.id, overwrite]),
    );
    expect(byId.get('guild-1')).toMatchObject({
      allow: '66560',
      deny: '326417516608',
    });
    expect(byId.get('normal-role')).toMatchObject({
      allow: '66560',
      deny: '326417516608',
    });
    expect(byId.get('early-role')).toMatchObject({
      allow: '68608',
      deny: '326417514560',
    });
    expect(byId.get('vip-role')).toMatchObject({
      allow: '66560',
      deny: '326417516608',
    });
    expect(byId.get('staff-role')).toMatchObject({
      allow: '326417591360',
      deny: '0',
    });
  });

  it('keeps public registration open when only organization VIP access role exists', () => {
    const service = new SessionDiscordSyncService({} as never);
    const harness = service as never as {
      registrationOverwrites(
        guildId: string,
        staffRoles: Array<{ id: string; name: string; permissions: string }>,
        roles: Array<{ id: string; name: string; permissions: string }>,
        session: {
          status: string;
          registrationOpenAt: Date | string | null;
          registrationCloseAt: Date | string | null;
        },
        config: unknown,
        organizationAccessRoles: {
          earlyAccessRoleId: string | null;
          vipAccessRoleId: string | null;
        },
      ): Array<{ id: string; allow: string; deny: string }>;
    };

    const overwrites = harness.registrationOverwrites(
      'guild-1',
      [{ id: 'staff-role', name: 'Staff', permissions: '0' }],
      [
        { id: 'vip-role', name: 'VIP', permissions: '0' },
        { id: 'staff-role', name: 'Staff', permissions: '0' },
      ],
      {
        status: 'OPEN',
        registrationOpenAt: null,
        registrationCloseAt: null,
      },
      {
        registrationRoleIds: [],
        specialRegistrationRoleIds: [],
        vipRoleIds: [],
        emojis: {
          vipAccessEnabled: 'false',
        },
      },
      { earlyAccessRoleId: null, vipAccessRoleId: 'vip-role' },
    );

    const byId = new Map(
      overwrites.map((overwrite) => [overwrite.id, overwrite]),
    );
    expect(byId.get('guild-1')).toMatchObject({
      allow: '68608',
      deny: '326417514560',
    });
    expect(byId.get('vip-role')).toMatchObject({
      allow: '68608',
      deny: '326417514560',
    });
  });

  it('uses explicit manage roles for staff access without broad permission fallback', () => {
    const service = new SessionDiscordSyncService({} as never);
    const harness = service as never as {
      staffRoles(
        roles: Array<{ id: string; name: string; permissions: string }>,
        config: { manageRoleIds: string[] },
        ensuredStaffRole?: { id: string; name: string; permissions: string },
      ): Array<{ id: string }>;
    };

    const staffRoles = harness.staffRoles(
      [
        {
          id: 'manage-role',
          name: 'Configured Manager',
          permissions: '0',
        },
        {
          id: 'admin-role',
          name: 'Broad Admin',
          permissions: '8',
        },
        {
          id: 'named-staff-role',
          name: 'Arenzyra Staff',
          permissions: '0',
        },
      ],
      { manageRoleIds: ['manage-role'] },
    );

    expect(staffRoles.map((role) => role.id)).toEqual(['manage-role']);
  });

  it('preserves mapped existing channel metadata even when legacy repair flag is true', async () => {
    const service = new SessionDiscordSyncService({} as never);
    const discordRequest = jest.fn();
    const existingChannels = [
      {
        id: 'category-1',
        name: '╭ Existing Category ╮',
        type: 4,
      },
      {
        id: 'registration-1',
        name: '20丨registration',
        type: 0,
        parent_id: 'category-1',
      },
      {
        id: 'slot-list-1',
        name: '20丨slotlist',
        type: 0,
        parent_id: 'category-1',
      },
      {
        id: 'waitlist-1',
        name: '20丨𝘄𝗮𝗶𝘁𝗹𝗶𝘀𝘁',
        type: 0,
        parent_id: 'category-1',
      },
      { id: 'idp-1', name: '20丨𝗶𝗱-𝗽w', type: 0, parent_id: 'category-1' },
      {
        id: 'manager-1',
        name: '20丨𝗺𝗮𝗻𝗮𝗴𝗲𝗿-𝗰𝗵𝗮𝘁',
        type: 0,
        parent_id: 'category-1',
      },
      {
        id: 'transfer-1',
        name: '20丨transfer',
        type: 0,
        parent_id: 'category-1',
      },
      {
        id: 'manage-1',
        name: '20丨𝗺𝗮𝗻𝗮𝗴𝗲𝗺𝗲𝗻𝘁',
        type: 0,
        parent_id: 'category-1',
      },
      {
        id: 'results-1',
        name: '20丨results丨🏆',
        type: 0,
        parent_id: 'category-1',
      },
      {
        id: 'screenshots-1',
        name: '20丨screenshot',
        type: 0,
        parent_id: 'category-1',
      },
      {
        id: 'bans-1',
        name: '⛔丨20-ban',
        type: 0,
        parent_id: 'category-1',
      },
      { id: 'log-1', name: '20丨log', type: 0, parent_id: 'category-1' },
    ];
    const slotRole = { id: 'slot-role', name: 'Slot', permissions: '0' };
    const waitlistRole = {
      id: 'waitlist-role',
      name: 'Waitlist',
      permissions: '0',
    };
    const bannedRole = { id: 'banned-role', name: 'Banned', permissions: '0' };
    const staffRole = { id: 'staff-role', name: 'Staff', permissions: '0' };
    const harness = service as never as {
      discordRequest: jest.Mock;
      getChannels: jest.Mock;
      getRoles: jest.Mock;
      getBotUserId: jest.Mock;
      applyBotControlledPermissionPatch: jest.Mock;
      ensureStaffRole: jest.Mock;
      ensureRole: jest.Mock;
      ensureSetup(params: unknown): Promise<{
        category: { name: string };
        registrationChannel: { name: string };
        slotListChannel: { name: string };
        waitlistChannel: { name: string };
        idpChannel: { name: string };
        managerChannel: { name: string };
        manageChannel: { name: string };
        resultsChannel: { name: string };
        screenshotsChannel: { name: string };
        bansChannel: { name: string };
        logChannel: { name: string };
      }>;
    };
    harness.discordRequest = discordRequest;
    harness.getBotUserId = jest.fn().mockResolvedValue(null);
    harness.applyBotControlledPermissionPatch = jest
      .fn()
      .mockResolvedValue(undefined);
    harness.getChannels = jest.fn().mockResolvedValue(existingChannels);
    harness.getRoles = jest
      .fn()
      .mockResolvedValue([slotRole, waitlistRole, bannedRole, staffRole]);
    harness.ensureStaffRole = jest.fn().mockResolvedValue(staffRole);
    harness.ensureRole = jest.fn(async (params: { kind: string }) => {
      if (params.kind === 'Slot') return slotRole;
      if (params.kind === 'Waitlist') return waitlistRole;
      if (params.kind === 'Banned') return bannedRole;
      return slotRole;
    });

    const setup = await harness.ensureSetup({
      guildId: 'guild-1',
      sessionId: 'session-1',
      sessionName: '20 CET PRO',
      sessionStatus: 'OPEN',
      registrationOpenAt: null,
      registrationCloseAt: null,
      config: {
        categoryId: 'category-1',
        categoryName: 'SCRIM session-1 20 CET PRO',
        registrationChannelId: 'registration-1',
        registrationChannelName: 'registration',
        slotListChannelId: 'slot-list-1',
        slotListChannelName: 'slot-list',
        waitlistChannelId: 'waitlist-1',
        waitlistChannelName: 'waitlist',
        idpChannelId: 'idp-1',
        idpChannelName: 'idp',
        managerChannelId: 'manager-1',
        managerChannelName: 'manager',
        transferChannelId: 'transfer-1',
        transferChannelName: 'transfer-roles',
        manageChannelId: 'manage-1',
        manageChannelName: 'manage',
        resultsChannelId: 'results-1',
        resultsChannelName: 'results',
        screenshotsChannelId: 'screenshots-1',
        screenshotsChannelName: 'screenshots',
        bansChannelId: 'bans-1',
        bansChannelName: 'bans',
        logChannelId: 'log-1',
        logChannelName: 'log',
        idpRoleId: null,
        idpRoleName: null,
        manageRoleIds: [],
        emojis: {
          discordUseExistingChannels: 'true',
          discordManageExistingChannels: 'true',
        },
      },
    });

    expect(discordRequest).not.toHaveBeenCalled();
    expect(setup.category.name).toBe('╭ Existing Category ╮');
    expect(setup.registrationChannel.name).toBe('20丨registration');
    expect(setup.slotListChannel.name).toBe('20丨slotlist');
    expect(setup.waitlistChannel.name).toBe('20丨𝘄𝗮𝗶𝘁𝗹𝗶𝘀𝘁');
    expect(setup.idpChannel.name).toBe('20丨𝗶𝗱-𝗽w');
    expect(setup.managerChannel.name).toBe('20丨𝗺𝗮𝗻𝗮𝗴𝗲𝗿-𝗰𝗵𝗮𝘁');
    expect(setup.manageChannel.name).toBe('20丨𝗺𝗮𝗻𝗮𝗴𝗲𝗺𝗲𝗻𝘁');
    expect(setup.resultsChannel.name).toBe('20丨results丨🏆');
    expect(setup.screenshotsChannel.name).toBe('20丨screenshot');
    expect(setup.bansChannel.name).toBe('⛔丨20-ban');
    expect(setup.logChannel.name).toBe('20丨log');
  });
});

describe('removed registration Discord role cleanup', () => {
  it('removes managed roles from removed managers while protecting active managers', async () => {
    const removedLeaderId = '111111111111111111';
    const protectedManagerId = '222222222222222222';
    const activeMemberId = '333333333333333333';
    const prisma = {
      sessionDiscordConfig: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'config-1',
          organizationId: 'org-1',
          sessionId: 'session-1',
          enabled: true,
          guildId: 'guild-1',
          slotRoleId: '444444444444444444',
          slotRoleName: 'Slot',
          waitlistRoleId: '555555555555555555',
          waitlistRoleName: 'Waitlist',
          idpRoleId: '444444444444444444',
          idpRoleName: 'Slot',
        }),
      },
      teamMember: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([
            { discordUserId: removedLeaderId },
            { discordUserId: protectedManagerId },
          ])
          .mockResolvedValueOnce([{ discordUserId: activeMemberId }]),
      },
      sessionRegistration: {
        findMany: jest.fn().mockResolvedValue([
          {
            teamId: 'active-team',
            status: 'CONFIRMED',
            slotNumber: 3,
            waitlistPosition: null,
            leaderDiscordUserId: protectedManagerId,
            managerDiscordUserIds: [activeMemberId],
          },
        ]),
      },
    };
    const service = new SessionDiscordSyncService(prisma as never);
    const discordRequest = jest.fn().mockResolvedValue(null);
    (service as never as { discordRequest: jest.Mock }).discordRequest =
      discordRequest;
    (service as never as { getRoles: jest.Mock }).getRoles = jest
      .fn()
      .mockResolvedValue([
        {
          id: '444444444444444444',
          name: 'Slot',
          permissions: '0',
        },
        {
          id: '555555555555555555',
          name: 'Waitlist',
          permissions: '0',
        },
        {
          id: '666666666666666666',
          name: 'Arenzyra IDP session-',
          permissions: '0',
        },
      ]);

    const result = await service.cleanupManagedRolesForRemovedRegistrations(
      'session-1',
      [
        {
          teamId: 'removed-team',
          leaderDiscordUserId: removedLeaderId,
          managerDiscordUserIds: [protectedManagerId],
        },
      ],
      {
        id: 'user-1',
        role: Role.ORGANIZER,
        actorRole: Role.ORGANIZER,
        organizationId: 'org-1',
      } as never,
    );

    expect(result).toMatchObject({
      ok: true,
      users: 1,
      protectedUsers: 2,
      roles: 3,
      failed: 0,
    });
    expect(
      prisma.sessionRegistration.findMany.mock.calls[0]?.[0]?.where?.OR,
    ).toEqual([
      {
        status: {
          in: ['CONFIRMED', 'CHECKED_IN'],
        },
        slotNumber: { not: null },
      },
      {
        status: 'WAITLIST',
        waitlistPosition: { not: null },
      },
    ]);
    expect(
      discordRequest.mock.calls
        .filter((call) => call[0] === 'DELETE')
        .map((call) => call[1]),
    ).toEqual([
      `/guilds/guild-1/members/${removedLeaderId}/roles/444444444444444444`,
      `/guilds/guild-1/members/${removedLeaderId}/roles/555555555555555555`,
      `/guilds/guild-1/members/${removedLeaderId}/roles/666666666666666666`,
    ]);
    expect(
      discordRequest.mock.calls
        .filter((call) => call[0] === 'GET')
        .map((call) => call[1]),
    ).toContain(`/guilds/guild-1/members/${removedLeaderId}`);
  });

  it('retries removed manager role cleanup when verification still sees the role', async () => {
    const removedLeaderId = '111111111111111111';
    const prisma = {
      sessionDiscordConfig: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'config-1',
          organizationId: 'org-1',
          sessionId: 'session-1',
          enabled: true,
          guildId: 'guild-1',
          slotRoleId: '444444444444444444',
          slotRoleName: 'Slot',
          waitlistRoleId: null,
          waitlistRoleName: null,
          idpRoleId: null,
          idpRoleName: null,
        }),
      },
      teamMember: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      sessionRegistration: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const service = new SessionDiscordSyncService(prisma as never);
    const discordRequest = jest
      .fn()
      .mockImplementation((method: string) =>
        method === 'GET'
          ? Promise.resolve({ roles: ['444444444444444444'] })
          : Promise.resolve(null),
      );
    discordRequest
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        roles: ['444444444444444444'],
      })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ roles: [] });
    (service as never as { discordRequest: jest.Mock }).discordRequest =
      discordRequest;
    (service as never as { getRoles: jest.Mock }).getRoles = jest
      .fn()
      .mockResolvedValue([]);

    const result = await service.cleanupManagedRolesForRemovedRegistrations(
      'session-1',
      [
        {
          teamId: 'removed-team',
          leaderDiscordUserId: removedLeaderId,
          managerDiscordUserIds: [],
        },
      ],
      {
        id: 'user-1',
        role: Role.ORGANIZER,
        actorRole: Role.ORGANIZER,
        organizationId: 'org-1',
      } as never,
    );

    expect(result).toMatchObject({
      ok: true,
      users: 1,
      roles: 1,
      attempted: 2,
      failed: 0,
    });
    expect(
      discordRequest.mock.calls.filter((call) => call[0] === 'DELETE'),
    ).toHaveLength(2);
    expect(
      discordRequest.mock.calls.filter((call) => call[0] === 'GET'),
    ).toHaveLength(2);
  });
});
