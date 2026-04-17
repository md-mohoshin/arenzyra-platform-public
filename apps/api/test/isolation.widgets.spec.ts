import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { LiveState, MatchStatus, Role, WidgetKind } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { requireEnv } from '../src/common/config/require-env';
import { PrismaService } from '../src/db/prisma.service';

const jwtSecret = requireEnv('JWT_SECRET');
const seed = randomUUID().slice(0, 8);
const orgA = `widget-org-a-${seed}`;
const orgB = `widget-org-b-${seed}`;
const organizerAUserId = `widget-user-a-${seed}`;
const organizerBUserId = `widget-user-b-${seed}`;
const superAdminUserId = `widget-super-${seed}`;
const tournamentAId = randomUUID();
const matchAId = randomUUID();

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

// Organization isolation tests for widgets and control-backed public widget state

describe('Widget/OBS organization isolation', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: ReturnType<typeof request>;
  let organizerAToken: string;
  let organizerBToken: string;
  let superAdminToken: string;
  let widgetAId: string;
  let widgetBId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    const server = app.getHttpServer() as unknown as Parameters<
      typeof request
    >[0];
    http = request(server);
    prisma = app.get(PrismaService);

    await prisma.organization.createMany({
      data: [
        { id: orgA, name: `Org A ${seed}`, slug: `widget-orga-${seed}` },
        { id: orgB, name: `Org B ${seed}`, slug: `widget-orgb-${seed}` },
      ],
    });
    await prisma.user.createMany({
      data: [
        {
          id: organizerAUserId,
          email: `widget-a-${seed}@arenzyra.com`,
          password: 'test',
          name: 'Organizer A',
          role: Role.ORGANIZER,
          organizationId: orgA,
        },
        {
          id: organizerBUserId,
          email: `widget-b-${seed}@arenzyra.com`,
          password: 'test',
          name: 'Organizer B',
          role: Role.ORGANIZER,
          organizationId: orgB,
        },
        {
          id: superAdminUserId,
          email: `widget-super-${seed}@arenzyra.com`,
          password: 'test',
          name: 'Super Admin',
          role: Role.SUPER_ADMIN,
          organizationId: orgA,
        },
      ],
    });

    await prisma.tournament.create({
      data: {
        id: tournamentAId,
        name: `Tournament A ${seed}`,
        organizationId: orgA,
        ownerUserId: organizerAUserId,
        game: 'PUBG_MOBILE',
        ruleset: {},
      },
    });

    await prisma.match.create({
      data: {
        id: matchAId,
        tournamentId: tournamentAId,
        organizationId: orgA,
        status: MatchStatus.LIVE,
        liveState: LiveState.LIVE,
        startedAt: new Date(),
      },
    });

    await prisma.matchControlState.create({
      data: {
        matchId: matchAId,
        organizationId: orgA,
        state: 'LIVE',
        metaJson: { resultFinalized: false },
      },
    });

    const widgetA = await prisma.widget.create({
      data: {
        organizationId: orgA,
        key: `custom-live-ranking-a-${seed}`,
        name: 'Live Ranking A',
        kind: WidgetKind.LIVE_RANKING,
      },
    });
    widgetAId = widgetA.id;

    const widgetB = await prisma.widget.create({
      data: {
        organizationId: orgB,
        key: `custom-live-ranking-b-${seed}`,
        name: 'Live Ranking B',
        kind: WidgetKind.LIVE_RANKING,
      },
    });
    widgetBId = widgetB.id;

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
    superAdminToken = signAccessToken({
      sub: superAdminUserId,
      role: Role.SUPER_ADMIN,
      organizationId: orgA,
    });
  });

  afterAll(async () => {
    await prisma.organizationBranding.deleteMany({
      where: { organizationId: { in: [orgA, orgB] } },
    });
    await prisma.widgetPreset.deleteMany({
      where: { organizationId: { in: [orgA, orgB] } },
    });
    await prisma.widget.deleteMany({
      where: { organizationId: { in: [orgA, orgB] } },
    });
    await prisma.oBSScene.deleteMany({
      where: { organizationId: { in: [orgA, orgB] } },
    });
    await prisma.oBSTemplate.deleteMany({
      where: { organizationId: { in: [orgA, orgB] } },
    });
    await prisma.matchControlState.deleteMany({
      where: { matchId: matchAId },
    });
    await prisma.match.deleteMany({
      where: { id: matchAId },
    });
    await prisma.tournament.deleteMany({
      where: { id: tournamentAId },
    });
    await prisma.user.deleteMany({
      where: {
        id: { in: [organizerAUserId, organizerBUserId, superAdminUserId] },
      },
    });
    await prisma.organization.deleteMany({
      where: { id: { in: [orgA, orgB] } },
    });
    await app.close();
  });

  it('widget admin routes stay organization-scoped under current auth guards', async () => {
    const resA = await http
      .get('/org/widgets')
      .set('authorization', `Bearer ${organizerAToken}`)
      .expect(200);

    const idsA = (resA.body as Array<{ id: string }>).map((w) => w.id);
    expect(idsA).toContain(widgetAId);

    const resB = await http
      .get('/org/widgets')
      .set('authorization', `Bearer ${organizerBToken}`)
      .expect(200);

    const idsB = (resB.body as Array<{ id: string }>).map((w) => w.id);
    expect(idsB).toContain(widgetBId);
    expect(idsB).not.toContain(widgetAId);
  });

  it('public scoreboard follows canonical control lifecycle and only finalizes after resultFinalized', async () => {
    const liveControl = await http
      .get(`/me/matches/${matchAId}/control`)
      .set('authorization', `Bearer ${organizerAToken}`)
      .expect(200);

    expect(liveControl.body.status).toBe('LIVE');
    expect(liveControl.body.controlStatus).toBe('LIVE');
    expect(liveControl.body.lifecycleStatus).toBe('LIVE');
    expect(liveControl.body.isFinalizing).toBe(false);
    expect(liveControl.body.resultFinalized).toBe(false);

    const liveScoreboard = await http
      .get('/widgets/scoreboard')
      .query({ matchId: matchAId })
      .expect(200);

    expect(liveScoreboard.body.meta.matchId).toBe(matchAId);
    expect(liveScoreboard.body.meta.controlState).toBe('LIVE');
    expect(liveScoreboard.body.meta.resultFinalized).toBe(false);
    expect(liveScoreboard.body.data.state.controlState).toBe('LIVE');
    expect(liveScoreboard.body.data.state.resultFinalized).toBe(false);

    const finalizationStartedAt = new Date().toISOString();
    await prisma.match.update({
      where: { id: matchAId },
      data: { status: MatchStatus.FINISH_PENDING, liveState: LiveState.LIVE },
    });
    await prisma.matchControlState.update({
      where: { matchId: matchAId },
      data: {
        state: 'ENDED',
        metaJson: {
          resultFinalized: false,
          finalizationStartedAt,
        },
      },
    });

    const finalizingControl = await http
      .get(`/me/matches/${matchAId}/control`)
      .set('authorization', `Bearer ${organizerAToken}`)
      .expect(200);

    expect(finalizingControl.body.status).toBe('ENDED');
    expect(finalizingControl.body.controlStatus).toBe('ENDED');
    expect(finalizingControl.body.lifecycleStatus).toBe('ENDED');
    expect(finalizingControl.body.isFinalizing).toBe(true);
    expect(finalizingControl.body.resultFinalized).toBe(false);

    const finalizingScoreboard = await http
      .get('/widgets/scoreboard')
      .query({ matchId: matchAId })
      .expect(200);

    expect(finalizingScoreboard.body.meta.controlState).toBe('ENDED');
    expect(finalizingScoreboard.body.meta.resultFinalized).toBe(false);
    expect(finalizingScoreboard.body.data.state.controlState).toBe('ENDED');
    expect(finalizingScoreboard.body.data.state.resultFinalized).toBe(false);

    const finalizedAt = new Date().toISOString();
    await prisma.match.update({
      where: { id: matchAId },
      data: { status: MatchStatus.FINISHED, liveState: LiveState.ENDED },
    });
    await prisma.matchControlState.update({
      where: { matchId: matchAId },
      data: {
        state: 'CONFIRMED',
        metaJson: {
          resultFinalized: true,
          finalizedAt,
        },
      },
    });

    const finalizedControl = await http
      .get(`/me/matches/${matchAId}/control`)
      .set('authorization', `Bearer ${organizerAToken}`)
      .expect(200);

    expect(finalizedControl.body.status).toBe('CONFIRMED');
    expect(finalizedControl.body.controlStatus).toBe('CONFIRMED');
    expect(finalizedControl.body.lifecycleStatus).toBe('FINISHED');
    expect(finalizedControl.body.isFinalizing).toBe(false);
    expect(finalizedControl.body.resultFinalized).toBe(true);

    const finalizedScoreboard = await http
      .get('/widgets/scoreboard')
      .query({ matchId: matchAId })
      .expect(200);

    expect(finalizedScoreboard.body.meta.controlState).toBe('CONFIRMED');
    expect(finalizedScoreboard.body.meta.resultFinalized).toBe(true);
    expect(finalizedScoreboard.body.meta.finalizedAt).toBe(finalizedAt);
    expect(finalizedScoreboard.body.data.state.controlState).toBe('CONFIRMED');
    expect(finalizedScoreboard.body.data.state.resultFinalized).toBe(true);
    expect(finalizedScoreboard.body.data.state.finalizedAt).toBe(finalizedAt);
  });

  it('SUPER_ADMIN copy creates an independent widget in the target organization', async () => {
    const copyRes = await http
      .post(`/org/widgets/${widgetAId}/copy`)
      .set('authorization', `Bearer ${superAdminToken}`)
      .send({ targetOrgId: orgB })
      .expect(201);

    const copiedId = (copyRes.body as { id: string }).id;
    expect(copiedId).toBeDefined();
    expect(copiedId).not.toEqual(widgetAId);
    expect((copyRes.body as { organizationId: string }).organizationId).toBe(
      orgB,
    );

    const widgetsB = await http
      .get('/org/widgets')
      .set('authorization', `Bearer ${organizerBToken}`)
      .expect(200);
    const idsB = (widgetsB.body as Array<{ id: string }>).map((w) => w.id);
    expect(idsB).toContain(copiedId);
  });
});
