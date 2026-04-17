import {
  WidgetVersionStatus,
  type Prisma,
  type WidgetVersion,
} from '@prisma/client';
import { RealtimeGateway } from '../../realtime/realtime.gateway';
import type { PrismaService } from '../../db/prisma.service';
import { WidgetVersionService } from './widget-version.service';

const orgId = 'org-1';
const widgetKey = 'scoreboard';
const baseVersion: WidgetVersion = {
  id: 'base',
  organizationId: orgId,
  widgetKey,
  version: '0.0.0',
  status: WidgetVersionStatus.DRAFT,
  configSchema: null,
  createdAt: new Date('2025-01-01'),
  publishedAt: null,
};
const buildVersion = (overrides: Partial<WidgetVersion>): WidgetVersion => ({
  ...baseVersion,
  ...overrides,
});

type WidgetVersionDelegateMock = {
  findMany: jest.Mock<
    Promise<WidgetVersion[]>,
    [Prisma.WidgetVersionFindManyArgs?]
  >;
  findFirst: jest.Mock<
    Promise<WidgetVersion | null>,
    [Prisma.WidgetVersionFindFirstArgs?]
  >;
  findUnique: jest.Mock<
    Promise<WidgetVersion | null>,
    [Prisma.WidgetVersionFindUniqueArgs]
  >;
  create: jest.Mock<Promise<WidgetVersion>, [Prisma.WidgetVersionCreateArgs]>;
  updateMany: jest.Mock<
    Promise<Prisma.BatchPayload>,
    [Prisma.WidgetVersionUpdateManyArgs]
  >;
  update: jest.Mock<Promise<WidgetVersion>, [Prisma.WidgetVersionUpdateArgs]>;
};

describe('WidgetVersionService', () => {
  const prisma = {
    widgetVersion: {
      findMany: jest.fn<
        Promise<WidgetVersion[]>,
        [Prisma.WidgetVersionFindManyArgs?]
      >(),
      findFirst: jest.fn<
        Promise<WidgetVersion | null>,
        [Prisma.WidgetVersionFindFirstArgs?]
      >(),
      findUnique: jest.fn<
        Promise<WidgetVersion | null>,
        [Prisma.WidgetVersionFindUniqueArgs]
      >(),
      create: jest.fn<
        Promise<WidgetVersion>,
        [Prisma.WidgetVersionCreateArgs]
      >(),
      updateMany: jest.fn<
        Promise<Prisma.BatchPayload>,
        [Prisma.WidgetVersionUpdateManyArgs]
      >(),
      update: jest.fn<
        Promise<WidgetVersion>,
        [Prisma.WidgetVersionUpdateArgs]
      >(),
    },
  } as { widgetVersion: WidgetVersionDelegateMock };
  const realtimeMock = {
    emitWidgetVersion: jest.fn(),
  };
  const svc = new WidgetVersionService(
    prisma as unknown as PrismaService,
    realtimeMock as unknown as RealtimeGateway,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('promotes a version and demotes previous stable', async () => {
    prisma.widgetVersion.findUnique.mockResolvedValue({
      ...buildVersion({
        id: 'v2',
        organizationId: orgId,
        widgetKey,
        version: '2.0.0',
        status: WidgetVersionStatus.DRAFT,
      }),
    });
    prisma.widgetVersion.updateMany.mockResolvedValue({ count: 1 });
    prisma.widgetVersion.update.mockResolvedValue({
      ...buildVersion({
        id: 'v2',
        version: '2.0.0',
        status: WidgetVersionStatus.STABLE,
      }),
    });

    const res = await svc.promote('v2');

    expect(prisma.widgetVersion.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          widgetKey,
          organizationId: orgId,
          status: WidgetVersionStatus.STABLE,
        },
      }),
    );
    expect(res.status).toBe(WidgetVersionStatus.STABLE);
  });

  it('rolls back to previous deprecated', async () => {
    prisma.widgetVersion.findFirst
      .mockResolvedValueOnce({
        ...buildVersion({
          id: 'stable',
          status: WidgetVersionStatus.STABLE,
        }),
      })
      .mockResolvedValueOnce({
        ...buildVersion({
          id: 'deprecated',
          status: WidgetVersionStatus.DEPRECATED,
        }),
      });
    prisma.widgetVersion.update.mockResolvedValue({
      ...buildVersion({
        id: 'deprecated',
        status: WidgetVersionStatus.STABLE,
      }),
    });

    const res = await svc.rollback(orgId, widgetKey);
    expect(prisma.widgetVersion.update).toHaveBeenCalledTimes(2);
    expect(res.status).toBe(WidgetVersionStatus.STABLE);
  });

  it('resolves explicit deprecated version while default uses stable', async () => {
    const oldVersion = {
      id: 'v1',
      organizationId: orgId,
      widgetKey,
      version: '1.0.0',
      status: WidgetVersionStatus.DEPRECATED,
      publishedAt: new Date('2025-01-01'),
      createdAt: new Date('2025-01-01'),
      configSchema: null,
    } as WidgetVersion;
    const newStable = {
      id: 'v2',
      organizationId: orgId,
      widgetKey,
      version: '2.0.0',
      status: WidgetVersionStatus.STABLE,
      publishedAt: new Date('2025-02-01'),
      createdAt: new Date('2025-01-15'),
      configSchema: null,
    } as WidgetVersion;

    prisma.widgetVersion.findFirst.mockImplementation(
      (args?: Prisma.WidgetVersionFindFirstArgs) => {
        if (args?.where && 'version' in args.where && args.where.version) {
          return Promise.resolve(oldVersion);
        }
        if (
          args?.where &&
          'status' in args.where &&
          args.where.status === WidgetVersionStatus.STABLE
        ) {
          return Promise.resolve(newStable);
        }
        return Promise.resolve(null);
      },
    );

    const explicit = await svc.resolve(orgId, widgetKey, '1.0.0');
    const fallback = await svc.resolve(orgId, widgetKey, null);

    expect(explicit?.version).toBe('1.0.0');
    expect(fallback?.version).toBe('2.0.0');
  });

  it('updates config schema and emits', async () => {
    prisma.widgetVersion.findUnique.mockResolvedValue(
      buildVersion({
        id: 'v1',
        organizationId: orgId,
        widgetKey,
        version: '1.0.0',
        status: WidgetVersionStatus.DRAFT,
      }),
    );
    prisma.widgetVersion.update.mockResolvedValue(
      buildVersion({
        id: 'v1',
        organizationId: orgId,
        widgetKey,
        version: '1.0.0',
        status: WidgetVersionStatus.DRAFT,
        configSchema: { type: 'object' } as unknown as Prisma.JsonValue,
      }),
    );

    const res = await svc.updateConfigSchema({
      id: 'v1',
      organizationId: orgId,
      configSchema: { type: 'object' },
    });

    expect(res.configSchema).toEqual({ type: 'object' });
    expect(realtimeMock.emitWidgetVersion).toHaveBeenCalledWith(
      orgId,
      expect.any(Object),
    );
  });
});
