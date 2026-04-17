import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { MatchDataSource, Role } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { requireEnv } from '../src/common/config/require-env';
import { PrismaService } from '../src/db/prisma.service';

const jwtSecret = requireEnv('JWT_SECRET');
const seed = randomUUID().slice(0, 8);
const orgA = `iso-write-org-a-${seed}`;
const orgB = `iso-write-org-b-${seed}`;
const ownerUserId = `iso-write-owner-${seed}`;
const superAdminUserId = `iso-write-super-${seed}`;
const tournamentAId = `iso-write-tour-a-${seed}`;
const tournamentBId = `iso-write-tour-b-${seed}`;
const matchAId = `iso-write-match-a-${seed}`;
const matchBId = `iso-write-match-b-${seed}`;

const signAccessToken = (payload: {
  sub: string;
  role: Role;
  organizationId?: string | null;
}) =>
  jwt.sign(
    {
      sub: payload.sub,
      role: payload.role,
      actorRole: payload.role,
      organizationId: payload.organizationId ?? null,
      realRole: payload.role,
    },
    jwtSecret,
    { expiresIn: '15m' },
  );

// Cross-org write isolation tests

describe('Isolation writes', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let organizerAToken: string;
  let superAdminToken: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);

    await prisma.organization.createMany({
      data: [
        { id: orgA, name: `Org A ${seed}`, slug: `iso-write-orga-${seed}` },
        { id: orgB, name: `Org B ${seed}`, slug: `iso-write-orgb-${seed}` },
      ],
    });
    await prisma.user.createMany({
      data: [
        {
          id: ownerUserId,
          email: `iso-write-owner-${seed}@arenzyra.com`,
          password: 'test',
          name: 'Organizer A',
          role: Role.ORGANIZER,
          organizationId: orgA,
        },
        {
          id: superAdminUserId,
          email: `iso-write-super-${seed}@arenzyra.com`,
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
    await prisma.match.createMany({
      data: [
        {
          id: matchAId,
          tournamentId: tournamentAId,
          organizationId: orgA,
          status: 'DRAFT',
          dataSource: MatchDataSource.API,
        },
        {
          id: matchBId,
          tournamentId: tournamentBId,
          organizationId: orgB,
          status: 'DRAFT',
          dataSource: MatchDataSource.API,
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

  beforeEach(async () => {
    await prisma.match.update({
      where: { id: matchBId },
      data: { dataSource: MatchDataSource.API },
    });
  });

  afterAll(async () => {
    await prisma.match.deleteMany({
      where: { id: { in: [matchAId, matchBId] } },
    });
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

  it('organizer A cannot update org B match', async () => {
    await request(app.getHttpServer() as unknown as import('http').Server)
      .post(`/org/${orgB}/matches/${matchBId}/data-source`)
      .set('authorization', `Bearer ${organizerAToken}`)
      .send({ dataSource: MatchDataSource.MANUAL })
      .expect(403);
  });

  it('super-admin without impersonation can update org B match via canonical org route', async () => {
    await request(app.getHttpServer() as unknown as import('http').Server)
      .post(`/org/${orgB}/matches/${matchBId}/data-source`)
      .set('authorization', `Bearer ${superAdminToken}`)
      .send({ dataSource: MatchDataSource.MANUAL })
      .expect(201);

    const match = await prisma.match.findUnique({
      where: { id: matchBId },
      select: { dataSource: true },
    });
    expect(match?.dataSource).toBe(MatchDataSource.MANUAL);
  });

  it('super-admin can also update org B match with explicit organization override header', async () => {
    await request(app.getHttpServer() as unknown as import('http').Server)
      .post(`/org/${orgB}/matches/${matchBId}/data-source`)
      .set('authorization', `Bearer ${superAdminToken}`)
      .set('x-organization-id', orgB)
      .send({ dataSource: MatchDataSource.MANUAL })
      .expect(201);
  });
});
