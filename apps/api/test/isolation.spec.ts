import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { requireEnv } from '../src/common/config/require-env';
import { PrismaService } from '../src/db/prisma.service';

const jwtSecret = requireEnv('JWT_SECRET');
const seed = randomUUID().slice(0, 8);
const orgA = `iso-org-a-${seed}`;
const orgB = `iso-org-b-${seed}`;
const ownerUserId = `iso-owner-${seed}`;
const superAdminUserId = `iso-super-${seed}`;
const tournamentAId = `iso-tour-a-${seed}`;
const tournamentBId = `iso-tour-b-${seed}`;

const signAccessToken = (payload: {
  sub: string;
  role: Role;
  actorRole?: Role;
  organizationId?: string | null;
  actingOrgId?: string | null;
  actingRole?: Role | null;
  isImpersonating?: boolean;
  impersonated?: boolean;
}) =>
  jwt.sign(
    {
      sub: payload.sub,
      role: payload.role,
      actorRole: payload.actorRole ?? payload.role,
      organizationId: payload.organizationId ?? null,
      actingOrgId: payload.actingOrgId ?? null,
      actingRole: payload.actingRole ?? null,
      isImpersonating: payload.isImpersonating ?? false,
      impersonated: payload.impersonated ?? false,
      realRole: payload.role,
    },
    jwtSecret,
    { expiresIn: '15m' },
  );

// Multi-tenant isolation smoke tests (API-level)

describe('Isolation', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let organizerAToken: string;
  let superAdminToken: string;

  const extractIds = (body: unknown): string[] => {
    if (Array.isArray(body)) return body.map((t) => (t as { id: string }).id);
    const data = (body as { data?: Array<{ id: string }> })?.data ?? [];
    return data.map((t) => t.id);
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);

    await prisma.organization.createMany({
      data: [
        { id: orgA, name: `Org A ${seed}`, slug: `iso-orga-${seed}` },
        { id: orgB, name: `Org B ${seed}`, slug: `iso-orgb-${seed}` },
      ],
    });
    await prisma.user.createMany({
      data: [
        {
          id: ownerUserId,
          email: `iso-owner-${seed}@arenzyra.com`,
          password: 'test',
          name: 'Organizer A',
          role: Role.ORGANIZER,
          organizationId: orgA,
        },
        {
          id: superAdminUserId,
          email: `iso-super-${seed}@arenzyra.com`,
          password: 'test',
          name: 'Super Admin',
          role: Role.SUPER_ADMIN,
          organizationId: orgA,
        },
      ],
    });
    await prisma.tournament.createMany({
      data: [
        {
          id: tournamentAId,
          name: 'T A',
          organizationId: orgA,
          ownerUserId,
          game: 'PUBG_MOBILE',
          ruleset: {},
        },
        {
          id: tournamentBId,
          name: 'T B',
          organizationId: orgB,
          ownerUserId,
          game: 'PUBG_MOBILE',
          ruleset: {},
        },
      ],
    });

    organizerAToken = signAccessToken({
      sub: ownerUserId,
      role: Role.ORGANIZER,
      organizationId: orgA,
    });
    superAdminToken = signAccessToken({
      sub: superAdminUserId,
      role: Role.SUPER_ADMIN,
      organizationId: orgA,
    });
  });

  afterAll(async () => {
    await prisma.tournament.deleteMany({
      where: { id: { in: [tournamentAId, tournamentBId] } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: [ownerUserId, superAdminUserId] } },
    });
    await prisma.organization.deleteMany({
      where: { id: { in: [orgA, orgB] } },
    });
    await app.close();
  });

  it('org A cannot see org B tournaments', async () => {
    const res = await request(
      app.getHttpServer() as unknown as import('http').Server,
    )
      .get('/me/tournaments')
      .set('authorization', `Bearer ${organizerAToken}`)
      .expect(200);
    const ids = extractIds(res.body);
    expect(ids).toContain(tournamentAId);
    expect(ids).not.toContain(tournamentBId);
  });

  it('super-admin without override sees their current organization tournaments', async () => {
    const res = await request(
      app.getHttpServer() as unknown as import('http').Server,
    )
      .get('/me/tournaments')
      .set('authorization', `Bearer ${superAdminToken}`)
      .expect(200);
    const ids = extractIds(res.body);
    expect(ids).toContain(tournamentAId);
    expect(ids).not.toContain(tournamentBId);
  });

  it('super-admin with organization override sees only the selected organization', async () => {
    const res = await request(
      app.getHttpServer() as unknown as import('http').Server,
    )
      .get('/me/tournaments')
      .set('authorization', `Bearer ${superAdminToken}`)
      .set('x-organization-id', orgB)
      .expect(200);
    const ids = extractIds(res.body);
    expect(ids).toContain(tournamentBId);
    expect(ids).not.toContain(tournamentAId);
  });
});
