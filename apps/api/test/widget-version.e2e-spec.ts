import request from 'supertest';
import jwt from 'jsonwebtoken';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import {
  type Prisma,
  Role,
  type WidgetVersion,
  WidgetVersionStatus,
} from '@prisma/client';
import { AuthService } from '../src/auth/auth.service';
import { JwtAuthGuard } from '../src/common/auth/jwt-auth.guard';
import { env } from '../src/config/env.validation';
import { WidgetVersionModule } from '../src/modules/widget-version/widget-version.module';
import { PrismaService } from '../src/db/prisma.service';
import { RealtimeGateway } from '../src/realtime/realtime.gateway';
import { WidgetVersionService } from '../src/modules/widget-version/widget-version.service';

// In-memory Prisma substitute covering only widgetVersion operations
class PrismaMock {
  public widgetVersionData: WidgetVersion[] = [];

  widgetVersion = {
    findMany: (args: Prisma.WidgetVersionFindManyArgs) => {
      const where = args.where ?? {};
      const filtered = this.widgetVersionData.filter((w) => {
        return (
          (where.organizationId
            ? w.organizationId === where.organizationId
            : true) &&
          (where.widgetKey ? w.widgetKey === where.widgetKey : true) &&
          (where.status ? w.status === where.status : true) &&
          (where.version ? w.version === where.version : true)
        );
      });
      if (args.orderBy) {
        // only supports publishedAt desc or status desc for this test
        filtered.sort((a, b) => {
          const pa = a.publishedAt?.getTime() ?? 0;
          const pb = b.publishedAt?.getTime() ?? 0;
          return pb - pa;
        });
      }
      return Promise.resolve(filtered);
    },
    findFirst: (args: Prisma.WidgetVersionFindFirstArgs) => {
      const where = args.where ?? {};
      const orderBy = args.orderBy;
      return this.widgetVersion
        .findMany({ where, orderBy } as Prisma.WidgetVersionFindManyArgs)
        .then((list) => list[0] ?? null);
    },
    findUnique: (args: Prisma.WidgetVersionFindUniqueArgs) => {
      const id = (args.where as { id: string }).id;
      return Promise.resolve(
        this.widgetVersionData.find((w) => w.id === id) ?? null,
      );
    },
    create: (args: Prisma.WidgetVersionCreateArgs) => {
      const data = args.data as Prisma.WidgetVersionUncheckedCreateInput;
      const row: WidgetVersion = {
        id: data.id ?? `widget-version-${this.widgetVersionData.length + 1}`,
        organizationId: String(data.organizationId),
        widgetKey: String(data.widgetKey),
        version: String(data.version),
        status: data.status ?? WidgetVersionStatus.DRAFT,
        configSchema: data.configSchema ?? null,
        createdAt: new Date(),
        publishedAt: (data.publishedAt as Date | null | undefined) ?? null,
      };
      this.widgetVersionData.push(row);
      return Promise.resolve(row);
    },
    updateMany: (args: Prisma.WidgetVersionUpdateManyArgs) => {
      const where = args.where ?? {};
      let count = 0;
      this.widgetVersionData = this.widgetVersionData.map((w) => {
        const match =
          (where.organizationId
            ? w.organizationId === where.organizationId
            : true) &&
          (where.widgetKey ? w.widgetKey === where.widgetKey : true) &&
          (where.status ? w.status === where.status : true);
        if (match) {
          count += 1;
          return {
            ...w,
            ...(args.data as Record<string, unknown>),
          } as WidgetVersion;
        }
        return w;
      });
      return Promise.resolve({ count });
    },
    update: (args: Prisma.WidgetVersionUpdateArgs) => {
      const id = (args.where as { id: string }).id;
      const idx = this.widgetVersionData.findIndex((w) => w.id === id);
      if (idx === -1) throw new Error('not found');
      const updated: WidgetVersion = {
        ...this.widgetVersionData[idx],
        ...(args.data as Record<string, unknown>),
      };
      this.widgetVersionData[idx] = updated;
      return Promise.resolve(updated);
    },
    deleteMany: (args: Prisma.WidgetVersionDeleteManyArgs) => {
      const before = this.widgetVersionData.length;
      this.widgetVersionData = this.widgetVersionData.filter(
        (w) => w.organizationId !== args.where?.organizationId,
      );
      return Promise.resolve({ count: before - this.widgetVersionData.length });
    },
  };
}

class RealtimeMock implements Partial<RealtimeGateway> {
  events: Array<{
    organizationId: string | null | undefined;
    widgetKey: string;
    version: string;
    status: string;
    action: string;
  }> = [];

  emitWidgetVersion(
    organizationId: string | null | undefined,
    payload: {
      widgetKey: string;
      version: string;
      status: string;
      action: 'promoted' | 'rolledback' | 'schema-updated';
    },
  ) {
    this.events.push({ organizationId, ...payload });
  }
}

describe('Widget version routes (isolated)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let prisma: PrismaMock;
  let realtime: RealtimeMock;
  let service: WidgetVersionService;
  let accessToken: string;

  const orgId = 'org-e2e';
  const widgetKey = 'live-ranking';
  const authUser = {
    id: 'user-1',
    role: Role.ADMIN,
    actorId: 'user-1',
    actorRole: Role.ADMIN,
    organizationId: orgId,
    actingOrgId: orgId,
  };
  const auth = <T extends { set: (name: string, value: string) => T }>(
    req: T,
  ) => req.set('authorization', `Bearer ${accessToken}`);

  beforeAll(async () => {
    prisma = new PrismaMock();
    realtime = new RealtimeMock();

    const moduleRef = await Test.createTestingModule({
      imports: [WidgetVersionModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prisma as unknown as PrismaService)
      .overrideProvider(RealtimeGateway)
      .useValue(realtime)
      .overrideProvider(AuthService)
      .useValue({
        me: jest.fn().mockResolvedValue({
          user: authUser,
          organization: { id: orgId, name: 'Org E2E' },
        }),
        validateAccessTokenPayload: jest.fn().mockResolvedValue(authUser),
      })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: any) => {
          const req = context.switchToHttp().getRequest();
          req.user = authUser;
          return true;
        },
      })
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
    service = app.get(WidgetVersionService);
    const server = app.getHttpServer() as unknown as Parameters<
      typeof request
    >[0];
    http = request(server);
    accessToken = jwt.sign(
      {
        sub: authUser.id,
        role: authUser.role,
        actorId: authUser.actorId,
        actorRole: authUser.actorRole,
        organizationId: authUser.organizationId,
        actingOrgId: authUser.actingOrgId,
      },
      env.JWT_SECRET,
      { expiresIn: '15m' },
    );

    await prisma.widgetVersion.create({
      data: {
        id: 'v1',
        organizationId: orgId,
        widgetKey,
        version: '1.0.0',
        status: WidgetVersionStatus.STABLE,
        configSchema: {},
      },
    });
    await prisma.widgetVersion.create({
      data: {
        id: 'v2',
        organizationId: orgId,
        widgetKey,
        version: '2.0.0',
        status: WidgetVersionStatus.DRAFT,
        configSchema: { type: 'object' },
      },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('lists versions', async () => {
    const res = await auth(http.get(`/org/widgets/${widgetKey}/versions`))
      .query({ organizationId: orgId })
      .expect(200);
    expect((res.body as WidgetVersion[]).length).toBe(2);
  });

  it('resolves default stable when no version', async () => {
    const stable = await service.resolve(orgId, widgetKey, null);
    expect(stable?.version).toBe('1.0.0');
  });

  it('promotes new stable and emits event', async () => {
    await auth(http.patch('/org/widgets/versions/v2/promote')).expect(200);
    const stable = await service.resolve(orgId, widgetKey, null);
    expect(stable?.version).toBe('2.0.0');
    expect(realtime.events.some((e) => e.action === 'promoted')).toBe(true);
  });

  it('updates schema via PATCH and emits event', async () => {
    await auth(http.patch('/org/widgets/versions/v2'))
      .query({ organizationId: orgId })
      .send({
        configSchema: {
          type: 'object',
          properties: { foo: { type: 'string' } },
        },
      })
      .expect(200);
    const v2 = await prisma.widgetVersion.findUnique({
      where: { id: 'v2' },
    } as Prisma.WidgetVersionFindUniqueArgs);
    expect(v2?.configSchema).toEqual({
      type: 'object',
      properties: { foo: { type: 'string' } },
    });
    expect(realtime.events.some((e) => e.action === 'schema-updated')).toBe(
      true,
    );
  });
});
