import { Prisma } from '@prisma/client';
import type { PrismaService } from '../../db/prisma.service';
import { VisualAssetsService } from './visual-assets.service';

type MockPrisma = {
  widget: {
    findFirst: jest.Mock<
      Promise<{ id: string } | null>,
      [Prisma.WidgetFindFirstArgs?]
    >;
  };
  widgetPreset: {
    create: jest.Mock<
      Promise<Prisma.WidgetPresetCreateInput & { id: string }>,
      [{ data: Prisma.WidgetPresetCreateInput }]
    >;
    updateMany: jest.Mock<
      Promise<Prisma.BatchPayload>,
      [Prisma.WidgetPresetUpdateManyArgs]
    >;
    findMany: jest.Mock<
      Promise<Prisma.WidgetPresetGetPayload<{ select: { id: true } }>[]> | null,
      [Prisma.WidgetPresetFindManyArgs?]
    >;
    findFirst: jest.Mock<
      Promise<Prisma.WidgetPresetGetPayload<{ select: { id: true } }> | null>,
      [Prisma.WidgetPresetFindFirstArgs?]
    >;
  };
  organization: {
    findFirst: jest.Mock<
      Promise<Prisma.OrganizationGetPayload<{ select: { id: true } }> | null>,
      [Prisma.OrganizationFindFirstArgs?]
    >;
  };
  oBSTemplate: Record<string, unknown>;
};

const makePrisma = (): {
  prisma: MockPrisma;
  created: Prisma.WidgetPresetCreateInput[];
} => {
  const created: Prisma.WidgetPresetCreateInput[] = [];
  const prisma: MockPrisma = {
    widget: {
      findFirst: jest.fn(() => Promise.resolve({ id: 'wid-1' })),
    },
    widgetPreset: {
      create: jest.fn(({ data }: { data: Prisma.WidgetPresetCreateInput }) => {
        created.push(data);
        return Promise.resolve({ id: 'preset-1', ...data });
      }),
      updateMany: jest.fn<
        Promise<Prisma.BatchPayload>,
        [Prisma.WidgetPresetUpdateManyArgs]
      >(() => Promise.resolve({ count: 0 } as Prisma.BatchPayload)),
      findMany: jest.fn<
        Promise<
          Prisma.WidgetPresetGetPayload<{ select: { id: true } }>[]
        > | null,
        [Prisma.WidgetPresetFindManyArgs?]
      >(() => Promise.resolve([])),
      findFirst: jest.fn<
        Promise<Prisma.WidgetPresetGetPayload<{ select: { id: true } }> | null>,
        [Prisma.WidgetPresetFindFirstArgs?]
      >(() => Promise.resolve(null)),
    },
    organization: {
      findFirst: jest.fn<
        Promise<Prisma.OrganizationGetPayload<{ select: { id: true } }> | null>,
        [Prisma.OrganizationFindFirstArgs?]
      >(() => Promise.resolve(null)),
    },
    oBSTemplate: {},
  };
  return { prisma, created };
};

describe('VisualAssetsService presets', () => {
  it('sanitizes preset config and enforces single default', async () => {
    const { prisma, created } = makePrisma();
    const svc = new VisualAssetsService(prisma as unknown as PrismaService);

    await svc.createWidgetPreset({
      widgetKey: 'scoreboard',
      actor: null,
      organizationId: 'org-1',
      data: {
        name: 'Compact',
        isDefault: true,
        config: {
          layout: 'compact',
          showKills: true,
          color: '#ff0000',
          fonts: ['A'],
        },
      },
    });

    expect(created[0].config).toEqual({ layout: 'compact', showKills: true });
    expect(prisma.widgetPreset.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          widgetKey: 'scoreboard',
          organizationId: 'org-1',
        },
      }),
    );
  });
});
