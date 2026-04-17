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
import { MatchStateBroadcaster } from '../src/realtime/match-state-broadcaster.service';

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

describe('Socket contract - realtime', () => {
  const seed = randomUUID().slice(0, 8);
  const organizationId = `socket-rt-org-${seed}`;
  const userId = `socket-rt-user-${seed}`;
  const tournamentId = randomUUID();
  const matchId = randomUUID();
  const startedAt = new Date().toISOString();

  let app: INestApplication;
  let prisma: PrismaService;
  let store: MatchControlStateStore;
  let broadcaster: MatchStateBroadcaster;
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
    broadcaster = app.get(MatchStateBroadcaster);
    http = request(
      app.getHttpServer() as unknown as Parameters<typeof request>[0],
    );

    await prisma.organization.create({
      data: {
        id: organizationId,
        name: `Realtime Org ${seed}`,
        slug: `socket-rt-${seed}`,
      },
    });
    await prisma.user.create({
      data: {
        id: userId,
        email: `socket-rt-${seed}@arenzyra.com`,
        password: 'test',
        name: 'Realtime Organizer',
        role: Role.ORGANIZER,
        organizationId,
      },
    });
    await prisma.tournament.create({
      data: {
        id: tournamentId,
        name: `Realtime Tournament ${seed}`,
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

  it('broadcasts canonical realtime state from the backend and keeps lifecycle unchanged when clients push telemetry', async () => {
    const controlBefore = await http
      .get(`/me/matches/${matchId}/control`)
      .set('authorization', `Bearer ${token}`)
      .expect(200);

    expect(controlBefore.body.matchId).toBe(matchId);
    expect(controlBefore.body.status).toBe('LIVE');
    expect(controlBefore.body.controlStatus).toBe('LIVE');
    expect(controlBefore.body.lifecycleStatus).toBe('LIVE');
    expect(controlBefore.body.resultFinalized).toBe(false);
    expect(controlBefore.body.summary).toMatchObject({
      totalTeams: 1,
      aliveTeams: 1,
      totalPlayers: 4,
      alivePlayers: 4,
    });

    const socket = trackSocket(
      io(`${url}/realtime`, {
        transports: ['websocket'],
        auth: { token: `Bearer ${token}` },
      }),
    );

    const authOk = await waitForEvent<{
      clientId: string | null;
      role: Role | null;
    }>(socket, 'auth:ok');
    expect(authOk.role).toBe(Role.ORGANIZER);

    const boundPromise = waitForEvent<{ matchId: string; status: string }>(
      socket,
      'match:bound',
    );
    socket.emit('bind_match', { matchId });
    const bound = await boundPromise;
    expect(bound).toEqual({ matchId, status: 'bound' });

    const fullStatePromise = waitForEvent<{
      matchId: string;
      status: string;
      version: number;
      summary?: { aliveTeams?: number; totalPlayers?: number };
    }>(socket, 'match:state');
    await broadcaster.broadcastFull(matchId, organizationId);
    const fullState = await fullStatePromise;

    expect(fullState).toMatchObject({
      matchId,
      status: controlBefore.body.status,
      version: controlBefore.body.version,
      summary: {
        aliveTeams: controlBefore.body.summary.aliveTeams,
        totalPlayers: controlBefore.body.summary.totalPlayers,
      },
    });

    const currentState = await store.get(matchId);
    expect(currentState).not.toBeNull();

    const updatedState = await store.save(
      matchId,
      {
        ...currentState!,
        summary: {
          totalTeams: 1,
          aliveTeams: 1,
          totalPlayers: 4,
          alivePlayers: 3,
          winnerTeamId: null,
          winnerSlot: null,
        },
      },
      currentState!.version,
    );

    const updatePromise = waitForEvent<{
      matchId: string;
      status: string;
      version: number;
      summary?: { alivePlayers?: number };
    }>(socket, 'match:update');
    await broadcaster.broadcastUpdate(updatedState, organizationId);
    const update = await updatePromise;

    expect(update).toMatchObject({
      matchId,
      status: 'LIVE',
      version: updatedState.version,
      summary: { alivePlayers: 3 },
    });

    const controlAfterBroadcast = await http
      .get(`/me/matches/${matchId}/control`)
      .set('authorization', `Bearer ${token}`)
      .expect(200);

    expect(controlAfterBroadcast.body.version).toBe(updatedState.version);
    expect(controlAfterBroadcast.body.summary).toMatchObject({
      alivePlayers: 3,
      aliveTeams: 1,
    });

    let winnerEvent: unknown = null;
    let directUpdateCount = 0;
    socket.on('match:winner', (payload) => {
      winnerEvent = payload;
    });
    socket.on('match:update', () => {
      directUpdateCount += 1;
    });

    const telemetryPromise = waitForEvent<{
      type: string;
      matchId: string;
      payload: { source: string };
    }>(socket, 'pcob:telemetry');

    socket.emit('pcob:telemetry:push', {
      type: 'TEST',
      matchId,
      ts: Date.now(),
      payload: { source: 'realtime-spec' },
    });

    const telemetry = await telemetryPromise;
    expect(telemetry).toMatchObject({
      type: 'TEST',
      matchId,
      payload: { source: 'realtime-spec' },
    });

    await sleep(150);

    expect(directUpdateCount).toBe(0);
    expect(winnerEvent).toBeNull();

    const controlAfterTelemetry = await http
      .get(`/me/matches/${matchId}/control`)
      .set('authorization', `Bearer ${token}`)
      .expect(200);

    expect(controlAfterTelemetry.body.status).toBe('LIVE');
    expect(controlAfterTelemetry.body.controlStatus).toBe('LIVE');
    expect(controlAfterTelemetry.body.lifecycleStatus).toBe('LIVE');
    expect(controlAfterTelemetry.body.resultFinalized).toBe(false);
    expect(controlAfterTelemetry.body.version).toBe(updatedState.version);
    expect(controlAfterTelemetry.body.summary).toMatchObject({
      alivePlayers: 3,
      aliveTeams: 1,
    });
  });
});
