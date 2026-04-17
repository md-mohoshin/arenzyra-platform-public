import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';

import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/db/prisma.service';
import { Role } from '@prisma/client';
import { requireEnv } from '../src/common/config/require-env';

const seed = randomUUID().slice(0, 8);
const orgA = `e2e-imp-org-a-${seed}`;
const orgB = `e2e-imp-org-b-${seed}`;
const tourA = `e2e-imp-tour-a-${seed}`;
const userId = `user-super-${seed}`;

const jwtSecret = requireEnv('JWT_SECRET');

describe('Me tournaments impersonation isolation (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let token: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    prisma = app.get(PrismaService);

    await prisma.organization.createMany({
      data: [
        { id: orgA, name: `Org A ${seed}`, slug: `e2e-imp-org-a-${seed}` },
        { id: orgB, name: `Org B ${seed}`, slug: `e2e-imp-org-b-${seed}` },
      ],
      skipDuplicates: true,
    });

    await prisma.user.upsert({
      where: { id: userId },
      update: {
        role: Role.SUPER_ADMIN,
        organizationId: orgA,
        email: `super-${seed}@arenzyra.com`,
      },
      create: {
        id: userId,
        email: `super-${seed}@arenzyra.com`,
        name: 'Super',
        role: Role.SUPER_ADMIN,
        organizationId: orgA,
        password: 'test',
      },
    });

    await prisma.tournament.upsert({
      where: { id: tourA },
      update: {},
      create: {
        id: tourA,
        name: `OrgA Tournament ${seed}`,
        organizationId: orgA,
        game: 'PUBG_MOBILE',
        ownerUserId: userId,
        ruleset: {},
      },
    });

    token = jwt.sign(
      {
        sub: userId,
        role: Role.SUPER_ADMIN,
        actorRole: Role.SUPER_ADMIN,
        organizationId: orgA,
        actingOrgId: orgB,
        actingRole: Role.ORGANIZER,
        actingOrgName: 'Org B',
        isImpersonating: true,
        impersonated: true,
      },
      jwtSecret,
      { expiresIn: '15m' },
    );
  });

  afterAll(async () => {
    await prisma.tournament.deleteMany({ where: { id: tourA } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.organization.deleteMany({
      where: { id: { in: [orgA, orgB] } },
    });
    await app.close();
  });

  it('returns no tournaments when impersonating another org', async () => {
    const res = await request(app.getHttpServer())
      .get('/me/tournaments')
      .set('authorization', `Bearer ${token}`)
      .expect(200);

    const body = res.body as unknown;
    const list = Array.isArray(body)
      ? body
      : ((body as { data?: any[] }).data ?? []);
    expect(list).toHaveLength(0);
  });
});
