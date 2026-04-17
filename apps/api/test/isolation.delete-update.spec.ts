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
const orgA = `iso-delete-org-a-${seed}`;
const orgB = `iso-delete-org-b-${seed}`;
const organizerAUserId = `iso-delete-user-a-${seed}`;
const organizerBUserId = `iso-delete-user-b-${seed}`;
const tournamentAId = `iso-delete-tour-a-${seed}`;
const tournamentBId = `iso-delete-tour-b-${seed}`;
const matchForbiddenId = `iso-delete-match-forbidden-${seed}`;
const matchOwnedId = `iso-delete-match-owned-${seed}`;

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

// Cross-org delete/update isolation tests

describe('Isolation deletes/updates', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let organizerAToken: string;
  let organizerBToken: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);

    await prisma.organization.createMany({
      data: [
        { id: orgA, name: `Org A ${seed}`, slug: `iso-delete-orga-${seed}` },
        { id: orgB, name: `Org B ${seed}`, slug: `iso-delete-orgb-${seed}` },
      ],
    });
    await prisma.user.createMany({
      data: [
        {
          id: organizerAUserId,
          email: `iso-delete-a-${seed}@arenzyra.com`,
          password: 'test',
          name: 'Organizer A',
          role: Role.ORGANIZER,
          organizationId: orgA,
        },
        {
          id: organizerBUserId,
          email: `iso-delete-b-${seed}@arenzyra.com`,
          password: 'test',
          name: 'Organizer B',
          role: Role.ORGANIZER,
          organizationId: orgB,
        },
      ],
    });
    await prisma.tournament.createMany({
      data: [
        {
          id: tournamentAId,
          name: 'T A',
          organizationId: orgA,
          ownerUserId: organizerAUserId,
          game: 'PUBG_MOBILE',
          ruleset: {},
        },
        {
          id: tournamentBId,
          name: 'T B',
          organizationId: orgB,
          ownerUserId: organizerBUserId,
          game: 'PUBG_MOBILE',
          ruleset: {},
        },
      ],
    });
    await prisma.match.createMany({
      data: [
        {
          id: matchForbiddenId,
          tournamentId: tournamentBId,
          organizationId: orgB,
          status: 'DRAFT',
        },
        {
          id: matchOwnedId,
          tournamentId: tournamentBId,
          organizationId: orgB,
          status: 'DRAFT',
        },
      ],
    });

    organizerAToken = signAccessToken({
      sub: organizerAUserId,
      role: Role.ORGANIZER,
      organizationId: orgA,
    });
    organizerBToken = signAccessToken({
      sub: organizerBUserId,
      role: Role.ORGANIZER,
      organizationId: orgB,
    });
  });

  afterAll(async () => {
    await prisma.match.deleteMany({
      where: { id: { in: [matchForbiddenId, matchOwnedId] } },
    });
    await prisma.tournament.deleteMany({
      where: { id: { in: [tournamentAId, tournamentBId] } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: [organizerAUserId, organizerBUserId] } },
    });
    await prisma.organization.deleteMany({
      where: { id: { in: [orgA, orgB] } },
    });
    await app.close();
  });

  it('organizer A cannot delete org B match', async () => {
    await request(app.getHttpServer() as unknown as import('http').Server)
      .delete(`/me/matches/${matchForbiddenId}`)
      .set('authorization', `Bearer ${organizerAToken}`)
      .expect(403);
  });

  it('organizer B can delete org B match through the canonical me route', async () => {
    await request(app.getHttpServer() as unknown as import('http').Server)
      .delete(`/me/matches/${matchOwnedId}`)
      .set('authorization', `Bearer ${organizerBToken}`)
      .expect(200);

    const deleted = await prisma.match.findUnique({
      where: { id: matchOwnedId },
      select: { deletedAt: true },
    });
    expect(deleted?.deletedAt).toBeInstanceOf(Date);
  });
});
