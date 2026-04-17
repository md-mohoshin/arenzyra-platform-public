import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { io, Socket } from 'socket.io-client';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { LiveState, MatchStatus, Role } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { requireEnv } from '../src/common/config/require-env';
import { PrismaService } from '../src/db/prisma.service';
import {
  MatchControlStateStore,
  type LiveMatchState,
} from '../src/modules/match-control/state.store';

const jwtSecret = requireEnv('JWT_SECRET');

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

describe('Socket contract - overlay', () => {
  const seed = randomUUID().slice(0, 8);
  const organizationId = `socket-ov-org-${seed}`;
  const userId = `socket-ov-user-${seed}`;
  const tournamentId = randomUUID();
  const matchId = randomUUID();
  const startedAt = new Date().toISOString();

  let app: INestApplication;
  let prisma: PrismaService;
  let store: MatchControlStateStore;
  let http: ReturnType<typeof request>;
  let url: string;
  let token: string;
  let sockets: Socket[] = [];
  let timers: NodeJS.Timeout[] = [];

  const trackSocket = (socket: Socket) => {
    sockets.push(socket);
    return socket;
  };

  const sleep = (ms: number) =>
    new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        timers = timers.filter((entry) => entry !== timer);
        resolve();
      }, ms);
      timers.push(timer);
    });

  const waitForEvent = <T>(socket: Socket, event: string, timeoutMs = 1500) =>
    new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.off(event, onEvent);
        timers = timers.filter((entry) => entry !== timer);
        reject(new Error(`Timed out waiting for ${event}`));
      }, timeoutMs);
      timers.push(timer);

      const onEvent = (payload: T) => {
        clearTimeout(timer);
        timers = timers.filter((entry) => entry !== timer);
        socket.off(event, onEvent);
        resolve(payload);
      };

      socket.on(event, onEvent);
    });

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    await app.listen(0);

    url = await app.getUrl();
    prisma = app.get(PrismaService);
    store = app.get(MatchControlStateStore);
    http = request(
      app.getHttpServer() as unknown as Parameters<typeof request>[0],
    );

    await prisma.organization.create({
      data: {
        id: organizationId,
        name: `Overlay Org ${seed}`,
        slug: `socket-ov-${seed}`,
      },
    });
    await prisma.user.create({
      data: {
        id: userId,
        email: `socket-ov-${seed}@arenzyra.com`,
        password: 'test',
        name: 'Overlay Organizer',
        role: Role.ORGANIZER,
        organizationId,
      },
    });
    await prisma.tournament.create({
      data: {
        id: tournamentId,
        name: `Overlay Tournament ${seed}`,
        organizationId,
        ownerUserId: userId,
        game: 'PUBG_MOBILE',
        ruleset: {},
      },
    });
    await prisma.match.create({
      data: {
        id: matchId,
        tournamentId,
        organizationId,
        status: MatchStatus.LIVE,
        liveState: LiveState.LIVE,
        startedAt: new Date(startedAt),
      },
    });
    await prisma.matchControlState.create({
      data: {
        matchId,
        organizationId,
        state: 'LIVE',
        metaJson: { resultFinalized: false },
      },
    });

    const initialState: LiveMatchState = {
      matchId,
      status: 'LIVE',
      startedAt,
      endedAt: null,
      version: 0,
      updatedAt: startedAt,
      summary: {
        totalTeams: 1,
        aliveTeams: 1,
        totalPlayers: 4,
        alivePlayers: 4,
        winnerTeamId: null,
        winnerSlot: null,
      },
      teams: [],
    };
    await store.save(matchId, initialState);

    token = signAccessToken({
      sub: userId,
      role: Role.ORGANIZER,
      organizationId,
    });
  });

  afterEach(() => {
    timers.forEach((timer) => clearTimeout(timer));
    timers = [];

    sockets.forEach((socket) => {
      socket.removeAllListeners();
      socket.disconnect();
      socket.close();
    });
    sockets = [];
  });

  afterAll(async () => {
    await store.evictMatches([matchId]);
    await prisma.matchControlState.deleteMany({ where: { matchId } });
    await prisma.match.deleteMany({ where: { id: matchId } });
    await prisma.tournament.deleteMany({ where: { id: tournamentId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await app.close();
  });

  it('uses overlay join as a refetch trigger and ignores client-side state mutation attempts', async () => {
    const controlBefore = await http
      .get(`/me/matches/${matchId}/control`)
      .set('authorization', `Bearer ${token}`)
      .expect(200);

    expect(controlBefore.body.matchId).toBe(matchId);
    expect(controlBefore.body.status).toBe('LIVE');
    expect(controlBefore.body.controlStatus).toBe('LIVE');
    expect(controlBefore.body.lifecycleStatus).toBe('LIVE');
    expect(controlBefore.body.resultFinalized).toBe(false);

    const socket = trackSocket(
      io(`${url}/overlay`, {
        transports: ['websocket'],
      }),
    );

    let overlayStateCount = 0;
    socket.on('overlay:state', () => {
      overlayStateCount += 1;
    });

    const overlayStatePromise = waitForEvent<{
      matchId: string;
      status: string;
      version: number;
      teams: unknown[];
    }>(socket, 'overlay:state');

    socket.emit('overlay:join', { matchId, organizationId });
    const overlayState = await overlayStatePromise;

    expect(overlayState).toMatchObject({
      matchId,
      status: controlBefore.body.status,
      version: controlBefore.body.version,
      teams: controlBefore.body.teams,
    });
    expect(overlayStateCount).toBe(1);

    socket.emit('overlay:state', {
      matchId,
      status: 'ENDED',
      version: 999,
      teams: [{ teamId: 'fake-team' }],
    });

    await sleep(150);

    expect(overlayStateCount).toBe(1);

    const controlAfter = await http
      .get(`/me/matches/${matchId}/control`)
      .set('authorization', `Bearer ${token}`)
      .expect(200);

    expect(controlAfter.body.matchId).toBe(matchId);
    expect(controlAfter.body.status).toBe('LIVE');
    expect(controlAfter.body.controlStatus).toBe('LIVE');
    expect(controlAfter.body.lifecycleStatus).toBe('LIVE');
    expect(controlAfter.body.resultFinalized).toBe(false);
    expect(controlAfter.body.version).toBe(controlBefore.body.version);
    expect(controlAfter.body.teams).toEqual(controlBefore.body.teams);
  });
});
