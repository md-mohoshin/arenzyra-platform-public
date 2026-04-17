import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import jwt from 'jsonwebtoken';

import request from 'supertest';
import { Role } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/db/prisma.service';
import { requireEnv } from '../src/common/config/require-env';

const seed = randomUUID().slice(0, 8);
const orgA = `iso-org-a-${seed}`;
const orgB = `iso-org-b-${seed}`;
const tourA = `iso-tour-a-${seed}`;
const tourB = `iso-tour-b-${seed}`;
const userId = `iso-super-user-${seed}`;

const jwtSecret = requireEnv('JWT_SECRET');

describe('Organizer tournaments isolation while impersonating (e2e)', () => {
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
        { id: orgA, name: `Org A ${seed}`, slug: `iso-org-a-${seed}` },
        { id: orgB, name: `Org B ${seed}`, slug: `iso-org-b-${seed}` },
      ],
      skipDuplicates: true,
    });

    await prisma.user.upsert({
      where: { id: userId },
      update: {
        role: Role.SUPER_ADMIN,
        organizationId: orgA,
        email: `iso-super-${seed}@arenzyra.com`,
      },
      create: {
        id: userId,
        email: `iso-super-${seed}@arenzyra.com`,
        name: 'Super',
        role: Role.SUPER_ADMIN,
        organizationId: orgA,
        password: 'test',
      },
    });

    await prisma.tournament.createMany({
      data: [
        {
          id: tourA,
          name: 'OrgA Tournament',
          organizationId: orgA,
          game: 'PUBG_MOBILE',
          ownerUserId: userId,
          ruleset: {},
        },
        {
          id: tourB,
          name: 'OrgB Tournament',
          organizationId: orgB,
          game: 'PUBG_MOBILE',
          ownerUserId: userId,
          ruleset: {},
        },
      ],
      skipDuplicates: true,
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
    await prisma.tournament.deleteMany({
      where: { id: { in: [tourA, tourB] } },
    });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.organization.deleteMany({
      where: { id: { in: [orgA, orgB] } },
    });
    await app.close();
  });

  it('auth/me exposes actingOrgId and impersonation flag', async () => {
    const res = await request(app.getHttpServer())
      .get('/auth/me')
      .set('authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body?.user?.actingOrgId).toBe(orgB);
    expect(res.body?.user?.isImpersonating).toBe(true);
    expect(res.body?.organization?.id).toBe(orgB);
  });

  it('organizer tournaments are scoped to impersonated org', async () => {
    const res = await request(app.getHttpServer())
      .get('/organizer/tournaments')
      .set('authorization', `Bearer ${token}`)
      .expect(200);

    const list: Array<{ id: string }> = Array.isArray(res.body)
      ? (res.body as Array<{ id: string }>)
      : Array.isArray((res.body as { data?: unknown }).data)
        ? (res.body as { data: Array<{ id: string }> }).data
        : [];

    expect(list.map((t) => t.id)).toEqual([tourB]);
  });
});
