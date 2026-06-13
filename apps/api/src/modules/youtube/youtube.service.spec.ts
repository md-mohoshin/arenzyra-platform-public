import { Role } from '@prisma/client';
import type { PrismaService } from '../../db/prisma.service';
import { YoutubeService } from './youtube.service';

const actor = {
  id: 'user-1',
  role: Role.ORGANIZER,
  actorRole: null,
  organizationId: 'org-1',
  actingOrgId: null,
  actorId: null,
  actingRole: null,
  actingOrgName: null,
  actingAsUserId: null,
  realRole: Role.ORGANIZER,
};

function createPrismaMock() {
  return {
    organization: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    youtubeChannel: {
      count: jest.fn(),
      findFirst: jest.fn(),
    },
    youtubeLiveChatSession: {
      count: jest.fn().mockResolvedValue(0),
    },
    youtubeAutomationRule: {
      create: jest.fn(),
    },
    youtubeAuditLog: {
      create: jest.fn().mockResolvedValue({ id: 'audit-1' }),
    },
  };
}

describe('YoutubeService', () => {
  it('returns basic plan limits from organization add-ons', async () => {
    const prisma = createPrismaMock();
    prisma.organization.findUnique.mockResolvedValue({
      id: 'org-1',
      name: 'Org',
      slug: 'org',
      deletedAt: null,
      enabledAddOns: ['youtube.basic'],
    });
    prisma.youtubeChannel.count.mockResolvedValue(0);

    const service = new YoutubeService(prisma as unknown as PrismaService);

    await expect(service.getLimitsForActor(actor)).resolves.toMatchObject({
      plan: 'basic',
      priceUsd: 10.99,
      channelLimit: 1,
      availableChannelSlots: 1,
      safeAutomation: false,
      liveChat: true,
      maxLiveSessions: 1,
      liveRepliesPerHour: 10,
    });
  });

  it('keeps basic automation approval-only and rate-limited', async () => {
    const prisma = createPrismaMock();
    prisma.organization.findUnique.mockResolvedValue({
      id: 'org-1',
      name: 'Org',
      slug: 'org',
      deletedAt: null,
      enabledAddOns: ['youtube.basic'],
    });
    prisma.youtubeAutomationRule.create.mockResolvedValue({
      id: 'rule-1',
      organizationId: 'org-1',
      channelId: null,
      name: 'Welcome',
      enabled: true,
      matchMode: 'KEYWORD',
      keywords: ['join'],
      responseTemplate: 'Welcome',
      requireApproval: true,
      cooldownSeconds: 300,
      maxRepliesPerHour: 0,
      blockedWords: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    });

    const service = new YoutubeService(prisma as unknown as PrismaService);
    await service.createAutomationRule(actor, {
      name: 'Welcome',
      enabled: true,
      keywords: ['join'],
      responseTemplate: 'Welcome',
      requireApproval: false,
      maxRepliesPerHour: 50,
    });

    expect(prisma.youtubeAutomationRule.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          requireApproval: true,
          maxRepliesPerHour: 0,
        }),
      }),
    );
  });
});
