import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import {
  DataMode,
  LiveState,
  LobbyStatus,
  MatchDataSource,
  MatchStatus,
  OrganizationStatus,
  Role,
  TournamentStatus,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';
import request, { type Test as SupertestRequest } from 'supertest';
import { io, type Socket } from 'socket.io-client';
import { AppModule } from '../src/app.module';
import { RolesGuard } from '../src/common/auth/roles.guard';
import { PrismaService } from '../src/db/prisma.service';

type LiveSyncFieldOwnership = {
  owner: 'TELEMETRY' | 'MANUAL' | 'SYSTEM';
  override: boolean;
  updatedAt: number;
  actorId?: string | null;
  source?: string | null;
};

type LiveSyncPlayerOwnership = {
  alive?: LiveSyncFieldOwnership;
  knocked?: LiveSyncFieldOwnership;
  kills?: LiveSyncFieldOwnership;
};

type LiveSyncTeamOwnership = {
  eliminated?: LiveSyncFieldOwnership;
  placement?: LiveSyncFieldOwnership;
  totalKills?: LiveSyncFieldOwnership;
};

type LiveSyncAuditEntry = {
  action: 'OVERRIDE' | 'RELEASE';
  timestamp: number;
  actorId?: string | null;
  source?: string | null;
  scope: {
    level: 'MATCH' | 'TEAM' | 'PLAYER';
    teamId?: string | null;
    playerId?: string | null;
    fields?: string[];
  };
};

type ResultPlayer = {
  id: string;
  playerId: string;
  name: string;
  kills: number;
  isAlive?: boolean | null;
  alive?: boolean | null;
  isKnocked?: boolean | null;
  ownership?: LiveSyncPlayerOwnership | null;
  audit?: {
    lastOverride?: LiveSyncAuditEntry | null;
    lastRelease?: LiveSyncAuditEntry | null;
  } | null;
};

type ResultTeam = {
  id: string;
  teamId: string;
  slot: number;
  kills: number;
  teamKills?: number;
  alivePlayers: number | null;
  eliminated: boolean;
  placement: number | null;
  teamLocked: boolean;
  ownership?: LiveSyncTeamOwnership | null;
  audit?: {
    lastOverride?: LiveSyncAuditEntry | null;
    lastRelease?: LiveSyncAuditEntry | null;
  } | null;
  team: {
    id: string;
    name: string;
    tag: string | null;
    logoUrl: string | null;
  };
  players: ResultPlayer[];
};

type ResultsResponse = {
  results: ResultTeam[];
  locked: boolean;
  lockState: 'LOCKED' | 'UNLOCKED';
  lockReason: string | null;
  lifecycleStatus: string;
  slotLocked: boolean;
  liveMirrorVersion?: number | null;
  liveSyncVersion?: number | null;
  overrideAudit?: LiveSyncAuditEntry[];
  overrideReleaseAllowed: boolean;
  overrideReleaseReason?: string | null;
};

type RealtimeMatchState = {
  matchId: string;
  version: number;
  status: string;
  summary?: {
    winnerTeamId: string | null;
    aliveTeams: number;
  } | null;
  teams: Array<{
    teamId: string;
    kills: number;
    placement: number | null;
    alivePlayers: number;
    players?: Array<{
      playerId: string | null;
      name: string | null;
      kills: number;
      alive: boolean;
      knocked: boolean;
    }>;
  }>;
};

type WidgetStateResponse = {
  matchId: string;
  teamsAlive: number;
  leaderboard: Array<{
    teamId: string | null;
    kills: number;
    placement: number | null;
    alivePlayers: number;
    teamName?: string | null;
  }>;
  winner?: {
    teamId: string | null;
    placement: number | null;
  } | null;
};

type TeamFixture = {
  id: string;
  tournamentTeamId: string;
  name: string;
  tag: string;
  slot: number;
  players: Array<{
    id: string;
    externalId: string;
    name: string;
  }>;
};

type Fixture = {
  orgId: string;
  orgSlug: string;
  userId: string;
  email: string;
  password: string;
  tournamentId: string;
  stageId: string;
  groupId: string;
  matchId: string;
  sessionId: string;
  teamA: TeamFixture;
  teamB: TeamFixture;
};

type PlayerTelemetryState = {
  externalId: string;
  name: string;
  kills: number;
  alive: boolean;
  knocked: boolean;
};

type TeamTelemetryState = {
  teamId: string;
  teamName: string;
  teamTag: string;
  slot: number;
  players: PlayerTelemetryState[];
};

const resolveResultsVersion = (body: ResultsResponse | null | undefined) => {
  if (typeof body?.liveMirrorVersion === 'number') {
    return body.liveMirrorVersion;
  }
  if (typeof body?.liveSyncVersion === 'number') {
    return body.liveSyncVersion;
  }
  return -1;
};

const sleep = async (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

const waitFor = async <T>(
  label: string,
  producer: () => Promise<T>,
  predicate: (value: T) => boolean,
  opts?: { timeoutMs?: number; intervalMs?: number },
): Promise<T> => {
  const timeoutMs = opts?.timeoutMs ?? 10_000;
  const intervalMs = opts?.intervalMs ?? 150;
  const startedAt = Date.now();
  let lastValue: T | null = null;

  while (Date.now() - startedAt <= timeoutMs) {
    lastValue = await producer();
    if (predicate(lastValue)) {
      return lastValue;
    }
    await sleep(intervalMs);
  }

  throw new Error(`Timed out waiting for ${label}`);
};

const connectRealtime = async (
  baseUrl: string,
  matchId: string,
  token: string,
): Promise<Socket> => {
  const socket = io(`${baseUrl}/realtime`, {
    transports: ['websocket'],
    query: { matchId },
    auth: { token: `Bearer ${token}` },
  });

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error('Timed out connecting realtime socket'));
    }, 5_000);

    socket.once('connect', () => {
      clearTimeout(timer);
      resolve();
    });
    socket.once('connect_error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off('match:bound', handleBound);
      reject(new Error('Timed out binding realtime socket to match'));
    }, 5_000);

    const handleBound = (payload: { matchId: string; status: 'bound' }) => {
      if (payload?.matchId === matchId && payload?.status === 'bound') {
        clearTimeout(timer);
        socket.off('match:bound', handleBound);
        resolve();
      }
    };

    socket.on('match:bound', handleBound);
    socket.emit('bind_match', { matchId });
  });

  return socket;
};

const waitForSocketVersion = async (
  socket: Socket,
  afterVersion: number,
  predicate: (payload: RealtimeMatchState) => boolean = () => true,
): Promise<RealtimeMatchState> =>
  new Promise<RealtimeMatchState>((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off('match_state_updated', handleUpdate);
      reject(
        new Error(
          `Timed out waiting for match_state_updated version > ${afterVersion}`,
        ),
      );
    }, 7_000);

    const handleUpdate = (payload: RealtimeMatchState) => {
      if (
        payload &&
        typeof payload.version === 'number' &&
        payload.version > afterVersion &&
        predicate(payload)
      ) {
        clearTimeout(timer);
        socket.off('match_state_updated', handleUpdate);
        resolve(payload);
      }
    };

    socket.on('match_state_updated', handleUpdate);
  });

const buildTelemetryPacket = (
  fixture: Fixture,
  teams: TeamTelemetryState[],
): Record<string, unknown> => ({
  matchId: fixture.matchId,
  sessionId: fixture.sessionId,
  phase: 'live',
  aliveTeams: teams.filter((team) =>
    team.players.some((player) => player.alive),
  ).length,
  teams: teams.map((team) => ({
    teamId: team.teamId,
    slot: team.slot,
    teamName: team.teamName,
    teamTag: team.teamTag,
    kills: team.players.reduce((sum, player) => sum + player.kills, 0),
    alivePlayers: team.players.filter((player) => player.alive).length,
    totalPlayers: team.players.length,
  })),
  players: teams.flatMap((team) =>
    team.players.map((player) => ({
      playerId: player.externalId,
      playerName: player.name,
      teamId: team.teamId,
      slot: team.slot,
      kills: player.kills,
      isAlive: player.alive,
      alive: player.alive,
      isKnocked: player.knocked,
      knocked: player.knocked,
      health: player.alive ? (player.knocked ? 35 : 100) : 0,
      hasDied: !player.alive,
    })),
  ),
  kills: [],
});

const findTeamResult = (
  results: ResultsResponse,
  teamId: string,
): ResultTeam => {
  const team = results.results.find((entry) => entry.teamId === teamId);
  if (!team) {
    throw new Error(`Team result not found for teamId=${teamId}`);
  }
  return team;
};

const findPlayerResult = (
  team: ResultTeam,
  playerName: string,
): ResultPlayer => {
  const player = team.players.find((entry) => entry.name === playerName);
  if (!player) {
    throw new Error(
      `Player result not found for teamId=${team.teamId} player=${playerName}`,
    );
  }
  return player;
};

const findRealtimeTeam = (
  state: RealtimeMatchState,
  teamId: string,
): RealtimeMatchState['teams'][number] => {
  const team = state.teams.find((entry) => entry.teamId === teamId);
  if (!team) {
    throw new Error(`Realtime team not found for teamId=${teamId}`);
  }
  return team;
};

const findWidgetTeam = (
  state: WidgetStateResponse,
  teamId: string,
): WidgetStateResponse['leaderboard'][number] => {
  const team = state.leaderboard.find((entry) => entry.teamId === teamId);
  if (!team) {
    throw new Error(`Widget team not found for teamId=${teamId}`);
  }
  return team;
};

jest.setTimeout(60_000);

describe('Match Control Phase 8 controlled workflow (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;
  let fixture: Fixture;
  let accessToken: string;
  let socket: Socket | null = null;

  const api = () => request(app.getHttpServer());

  const auth = (req: SupertestRequest) =>
    req.set('authorization', `Bearer ${accessToken}`);

  const getResults = async (): Promise<ResultsResponse> => {
    const response = await auth(
      api().get(`/me/matches/${fixture.matchId}/results`),
    ).expect(200);
    return response.body as ResultsResponse;
  };

  const getWidgetState = async (): Promise<WidgetStateResponse> => {
    const response = await api().get(
      `/api/observer/match/${fixture.matchId}/widget-state`,
    );
    expect(response.status).toBe(200);
    return response.body as WidgetStateResponse;
  };

  const getControlSummary = async (): Promise<{
    ok: true;
    control: {
      lifecycleStatus?: string | null;
      resultsLocked: boolean;
      slotLocked?: boolean;
      lifecycleLocked?: boolean;
      lockState?: 'LOCKED' | 'UNLOCKED';
      lockReason?: string | null;
      liveState?: string | null;
      locks?: {
        lifecycleStatus: string;
        lifecycleLocked: boolean;
        resultsLocked: boolean;
        slotLocked: boolean;
        resultLockState: 'LOCKED' | 'UNLOCKED';
        reason: string | null;
      };
    };
  }> => {
    const response = await auth(
      api().get(`/org/${fixture.orgId}/matches/${fixture.matchId}/control`),
    ).expect(200);
    return response.body as {
      ok: true;
      control: {
        lifecycleStatus?: string | null;
        resultsLocked: boolean;
        slotLocked?: boolean;
        lifecycleLocked?: boolean;
        lockState?: 'LOCKED' | 'UNLOCKED';
        lockReason?: string | null;
        liveState?: string | null;
        locks?: {
          lifecycleStatus: string;
          lifecycleLocked: boolean;
          resultsLocked: boolean;
          slotLocked: boolean;
          resultLockState: 'LOCKED' | 'UNLOCKED';
          reason: string | null;
        };
      };
    };
  };

  const getControlState = async (): Promise<{
    state: string;
    lifecycleStatus: string;
    locks: {
      lifecycleStatus: string;
      lifecycleLocked: boolean;
      resultsLocked: boolean;
      slotLocked: boolean;
      resultLockState: 'LOCKED' | 'UNLOCKED';
      reason: string | null;
    };
  }> => {
    const response = await auth(
      api().get(
        `/org/${fixture.orgId}/matches/${fixture.matchId}/control-state`,
      ),
    ).expect(200);
    return response.body as {
      state: string;
      lifecycleStatus: string;
      locks: {
        lifecycleStatus: string;
        lifecycleLocked: boolean;
        resultsLocked: boolean;
        slotLocked: boolean;
        resultLockState: 'LOCKED' | 'UNLOCKED';
        reason: string | null;
      };
    };
  };

  const postTelemetry = async (teams: TeamTelemetryState[]) => {
    const response = await auth(api().post('/api/observer/telemetry'))
      .send(buildTelemetryPacket(fixture, teams))
      .expect(201);

    expect(response.body).toEqual(
      expect.objectContaining({
        ok: true,
        queued: true,
        matchId: fixture.matchId,
      }),
    );
  };

  const getMatchRecord = async () =>
    prisma.match.findUnique({
      where: { id: fixture.matchId },
      select: {
        status: true,
        liveState: true,
        endedAt: true,
        endedReason: true,
        pcobSessionId: true,
        controlState: {
          select: {
            state: true,
            metaJson: true,
            resultsManualLock: true,
            resultsForceUnlock: true,
          },
        },
      },
    });

  const ensurePersistedPlayerRows = async () => {
    const slotResults = await prisma.matchSlotResult.findMany({
      where: { matchId: fixture.matchId },
      select: {
        id: true,
        teamId: true,
        players: {
          select: {
            playerId: true,
            playerName: true,
          },
        },
      },
    });

    const fixturesByTeamId = new Map([
      [fixture.teamA.id, fixture.teamA],
      [fixture.teamB.id, fixture.teamB],
    ]);

    for (const slotResult of slotResults) {
      if (!slotResult.teamId) {
        continue;
      }

      const teamFixture = fixturesByTeamId.get(slotResult.teamId);
      if (!teamFixture) {
        continue;
      }

      const existingPlayerIds = new Set(
        slotResult.players
          .map((player) => player.playerId)
          .filter((playerId): playerId is string => Boolean(playerId)),
      );

      const missingPlayers = teamFixture.players.filter(
        (player) => !existingPlayerIds.has(player.id),
      );
      if (missingPlayers.length === 0) {
        await prisma.matchSlotResult.update({
          where: { id: slotResult.id },
          data: { wasPresentInMatch: true },
        });
        continue;
      }

      await prisma.matchSlotPlayerResult.createMany({
        data: missingPlayers.map((player) => ({
          slotResultId: slotResult.id,
          organizationId: fixture.orgId,
          playerId: player.id,
          externalPlayerId: player.externalId,
          playerName: player.name,
          kills: 0,
          knocks: 0,
          isKnocked: false,
          isAlive: true,
          alive: true,
          isAutoFilled: false,
        })),
        skipDuplicates: true,
      });
      await prisma.matchSlotResult.update({
        where: { id: slotResult.id },
        data: { wasPresentInMatch: true },
      });
    }
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalGuards(new RolesGuard(app.get(Reflector)));
    await app.listen(0, '127.0.0.1');

    baseUrl = await app.getUrl();
    prisma = app.get(PrismaService);

    const suffix = `${Date.now()}`;
    const password = 'Phase8!Pass123';
    const passwordHash = await bcrypt.hash(password, 10);
    const orgId = `phase8-org-${suffix}`;
    const tournamentId = `phase8-tour-${suffix}`;
    const stageId = `phase8-stage-${suffix}`;
    const groupId = `phase8-group-${suffix}`;
    const matchId = `phase8-match-${suffix}`;
    const userId = `phase8-user-${suffix}`;
    const teamAId = `phase8-team-a-${suffix}`;
    const teamBId = `phase8-team-b-${suffix}`;
    const teamATournamentId = `phase8-tt-a-${suffix}`;
    const teamBTournamentId = `phase8-tt-b-${suffix}`;

    fixture = {
      orgId,
      orgSlug: `phase8-org-${suffix}`,
      userId,
      email: `phase8+${suffix}@arenzyra.com`,
      password,
      tournamentId,
      stageId,
      groupId,
      matchId,
      sessionId: `phase8-session-${suffix}`,
      teamA: {
        id: teamAId,
        tournamentTeamId: teamATournamentId,
        name: 'Phase 8 Alpha',
        tag: 'PHA',
        slot: 1,
        players: [
          {
            id: `phase8-player-a1-${suffix}`,
            externalId: `phase8-a1-${suffix}`,
            name: 'Alpha One',
          },
          {
            id: `phase8-player-a2-${suffix}`,
            externalId: `phase8-a2-${suffix}`,
            name: 'Alpha Two',
          },
        ],
      },
      teamB: {
        id: teamBId,
        tournamentTeamId: teamBTournamentId,
        name: 'Phase 8 Bravo',
        tag: 'PHB',
        slot: 2,
        players: [
          {
            id: `phase8-player-b1-${suffix}`,
            externalId: `phase8-b1-${suffix}`,
            name: 'Bravo One',
          },
          {
            id: `phase8-player-b2-${suffix}`,
            externalId: `phase8-b2-${suffix}`,
            name: 'Bravo Two',
          },
        ],
      },
    };

    await prisma.organization.create({
      data: {
        id: fixture.orgId,
        name: `Phase 8 Org ${suffix}`,
        slug: fixture.orgSlug,
        status: OrganizationStatus.APPROVED,
      },
    });
    await prisma.user.create({
      data: {
        id: fixture.userId,
        email: fixture.email,
        name: 'Phase 8 Organizer',
        password: passwordHash,
        role: Role.ORGANIZER,
        organizationId: fixture.orgId,
      },
    });
    await prisma.tournament.create({
      data: {
        id: fixture.tournamentId,
        name: `Phase 8 Tournament ${suffix}`,
        organizationId: fixture.orgId,
        ownerUserId: fixture.userId,
        game: 'PUBG_MOBILE',
        ruleset: {},
        status: TournamentStatus.ACTIVE,
      },
    });
    await prisma.stage.create({
      data: {
        id: fixture.stageId,
        name: 'Phase 8 Stage',
        tournamentId: fixture.tournamentId,
        organizationId: fixture.orgId,
      },
    });
    await prisma.group.create({
      data: {
        id: fixture.groupId,
        name: 'Phase 8 Group',
        stageId: fixture.stageId,
        organizationId: fixture.orgId,
      },
    });
    await prisma.team.createMany({
      data: [
        {
          id: fixture.teamA.id,
          name: fixture.teamA.name,
          tag: fixture.teamA.tag,
          organizationId: fixture.orgId,
          ownerUserId: fixture.userId,
        },
        {
          id: fixture.teamB.id,
          name: fixture.teamB.name,
          tag: fixture.teamB.tag,
          organizationId: fixture.orgId,
          ownerUserId: fixture.userId,
        },
      ],
    });
    await prisma.player.createMany({
      data: [
        ...fixture.teamA.players.map((player) => ({
          id: player.id,
          organizationId: fixture.orgId,
          teamId: fixture.teamA.id,
          ign: player.name,
          realName: player.name,
        })),
        ...fixture.teamB.players.map((player) => ({
          id: player.id,
          organizationId: fixture.orgId,
          teamId: fixture.teamB.id,
          ign: player.name,
          realName: player.name,
        })),
      ],
    });
    await prisma.rosterEntry.createMany({
      data: [
        ...fixture.teamA.players.map((player) => ({
          teamId: fixture.teamA.id,
          playerId: player.id,
        })),
        ...fixture.teamB.players.map((player) => ({
          teamId: fixture.teamB.id,
          playerId: player.id,
        })),
      ],
    });
    await prisma.tournamentTeam.createMany({
      data: [
        {
          id: fixture.teamA.tournamentTeamId,
          tournamentId: fixture.tournamentId,
          teamId: fixture.teamA.id,
        },
        {
          id: fixture.teamB.tournamentTeamId,
          tournamentId: fixture.tournamentId,
          teamId: fixture.teamB.id,
        },
      ],
    });
    await prisma.stageTeam.createMany({
      data: [
        {
          stageId: fixture.stageId,
          tournamentTeamId: fixture.teamA.tournamentTeamId,
        },
        {
          stageId: fixture.stageId,
          tournamentTeamId: fixture.teamB.tournamentTeamId,
        },
      ],
    });
    await prisma.groupTeam.createMany({
      data: [
        {
          groupId: fixture.groupId,
          tournamentTeamId: fixture.teamA.tournamentTeamId,
        },
        {
          groupId: fixture.groupId,
          tournamentTeamId: fixture.teamB.tournamentTeamId,
        },
      ],
    });
    await prisma.match.create({
      data: {
        id: fixture.matchId,
        name: 'Phase 8 Match',
        tournamentId: fixture.tournamentId,
        organizationId: fixture.orgId,
        ownerUserId: fixture.userId,
        stageId: fixture.stageId,
        groupId: fixture.groupId,
        status: MatchStatus.DRAFT,
        liveState: LiveState.UPCOMING,
        dataMode: DataMode.MANUAL,
        dataSource: MatchDataSource.PCOB,
        adapterKey: 'pubgm-pcob',
        slotCount: 25,
        matchNumber: 1,
        pcobSessionId: fixture.sessionId,
        matchTeams: {
          create: [
            {
              teamId: fixture.teamA.id,
              slot: fixture.teamA.slot,
              tournamentTeamId: fixture.teamA.tournamentTeamId,
            },
            {
              teamId: fixture.teamB.id,
              slot: fixture.teamB.slot,
              tournamentTeamId: fixture.teamB.tournamentTeamId,
            },
          ],
        },
        matchSlots: {
          create: [
            {
              slotNumber: fixture.teamA.slot,
              teamId: fixture.teamA.id,
              lobbyStatus: LobbyStatus.OFFLINE,
              playersInLobby: 0,
            },
            {
              slotNumber: fixture.teamB.slot,
              teamId: fixture.teamB.id,
              lobbyStatus: LobbyStatus.OFFLINE,
              playersInLobby: 0,
            },
          ],
        },
        controlState: {
          create: {
            organizationId: fixture.orgId,
            state: 'READY',
            version: 0,
          },
        },
      },
    });

    const loginResponse = await api()
      .post('/auth/login')
      .send({
        email: fixture.email,
        password: fixture.password,
      })
      .expect(201);
    accessToken = String(loginResponse.body.access_token || '');
    if (!accessToken) {
      throw new Error('Auth login did not return an access token');
    }
  });

  afterAll(async () => {
    if (socket) {
      const activeSocket = socket;
      socket = null;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 500);
        activeSocket.once('disconnect', () => {
          clearTimeout(timer);
          resolve();
        });
        activeSocket.close();
      });
    }

    if (prisma && fixture) {
      await prisma.auditLog.deleteMany({
        where: {
          OR: [{ organizationId: fixture.orgId }, { userId: fixture.userId }],
        },
      });
      await prisma.refreshToken.deleteMany({
        where: { userId: fixture.userId },
      });
      await prisma.match.deleteMany({
        where: { id: fixture.matchId },
      });
      await prisma.rosterEntry.deleteMany({
        where: {
          teamId: {
            in: [fixture.teamA.id, fixture.teamB.id],
          },
        },
      });
      await prisma.groupTeam.deleteMany({
        where: { groupId: fixture.groupId },
      });
      await prisma.stageTeam.deleteMany({
        where: { stageId: fixture.stageId },
      });
      await prisma.tournamentTeam.deleteMany({
        where: { tournamentId: fixture.tournamentId },
      });
      await prisma.team.deleteMany({
        where: { id: { in: [fixture.teamA.id, fixture.teamB.id] } },
      });
      await prisma.group.deleteMany({
        where: { id: fixture.groupId },
      });
      await prisma.stage.deleteMany({
        where: { id: fixture.stageId },
      });
      await prisma.tournament.deleteMany({
        where: { id: fixture.tournamentId },
      });
      await prisma.user.deleteMany({
        where: { id: fixture.userId },
      });
      await prisma.player.deleteMany({
        where: { organizationId: fixture.orgId },
      });
      await prisma.organizationBranding.deleteMany({
        where: { organizationId: fixture.orgId },
      });
      await prisma.organization.deleteMany({
        where: { id: fixture.orgId },
      });
    }

    if (app) {
      await app.close();
    }
  });

  it('executes the controlled operator workflow against the real API, persistence, and live mirror', async () => {
    socket = await connectRealtime(baseUrl, fixture.matchId, accessToken);

    const initialControlState = await getControlState();
    expect(initialControlState.state).toBe('READY');
    expect(initialControlState.lifecycleStatus).toBe('READY');
    expect(initialControlState.locks.resultLockState).toBeDefined();

    await auth(
      api()
        .post(`/api/matches/${fixture.matchId}/control/start`)
        .send({ reason: 'Phase 8 countdown start' }),
    ).expect(201);

    const countdownState = await waitFor(
      'COUNTDOWN control state',
      async () => getControlState(),
      (body) => body.state === 'COUNTDOWN',
    );
    expect(countdownState.lifecycleStatus).toBe('COUNTDOWN');

    await auth(
      api()
        .post(`/api/matches/${fixture.matchId}/control/mark-live`)
        .send({ reason: 'Phase 8 go live' }),
    ).expect(201);

    const liveControl = await waitFor(
      'LIVE control summary',
      async () => getControlSummary(),
      (body) => body.control.lifecycleStatus === 'LIVE',
    );

    const liveResultsBeforeUnlock = await waitFor(
      'LIVE results snapshot',
      async () => getResults(),
      (body) => body.lifecycleStatus === 'LIVE' && body.results.length === 2,
    );
    expect(liveResultsBeforeUnlock.locked).toBe(
      liveControl.control.resultsLocked,
    );
    expect(liveResultsBeforeUnlock.lockState).toBe(
      liveControl.control.lockState ?? 'UNLOCKED',
    );
    expect(liveResultsBeforeUnlock.overrideReleaseAllowed).toBe(true);

    const liveRecord = await getMatchRecord();
    expect(liveRecord?.status).toBe(MatchStatus.LIVE);
    expect(liveRecord?.controlState?.state).toBe('LIVE');
    expect(liveRecord?.endedAt).toBeNull();

    const baselineTelemetry: TeamTelemetryState[] = [
      {
        teamId: fixture.teamA.id,
        teamName: fixture.teamA.name,
        teamTag: fixture.teamA.tag,
        slot: fixture.teamA.slot,
        players: [
          {
            externalId: fixture.teamA.players[0].externalId,
            name: fixture.teamA.players[0].name,
            kills: 1,
            alive: true,
            knocked: false,
          },
          {
            externalId: fixture.teamA.players[1].externalId,
            name: fixture.teamA.players[1].name,
            kills: 0,
            alive: true,
            knocked: false,
          },
        ],
      },
      {
        teamId: fixture.teamB.id,
        teamName: fixture.teamB.name,
        teamTag: fixture.teamB.tag,
        slot: fixture.teamB.slot,
        players: [
          {
            externalId: fixture.teamB.players[0].externalId,
            name: fixture.teamB.players[0].name,
            kills: 0,
            alive: true,
            knocked: false,
          },
          {
            externalId: fixture.teamB.players[1].externalId,
            name: fixture.teamB.players[1].name,
            kills: 0,
            alive: true,
            knocked: false,
          },
        ],
      },
    ];

    const firstRealtimeUpdatePromise = waitForSocketVersion(
      socket,
      -1,
      (payload) =>
        payload.teams.some(
          (team) => team.teamId === fixture.teamA.id && team.kills === 1,
        ),
    );
    await postTelemetry(baselineTelemetry);
    const firstRealtimeUpdate = await firstRealtimeUpdatePromise;
    expect(firstRealtimeUpdate.matchId).toBe(fixture.matchId);
    expect(firstRealtimeUpdate.version).toBeGreaterThanOrEqual(1);
    expect(findRealtimeTeam(firstRealtimeUpdate, fixture.teamA.id).kills).toBe(
      1,
    );
    expect(findRealtimeTeam(firstRealtimeUpdate, fixture.teamB.id).kills).toBe(
      0,
    );

    const baselineWidget = await waitFor(
      'baseline live mirror',
      async () => getWidgetState(),
      (body) =>
        body.teamsAlive === 2 &&
        findWidgetTeam(body, fixture.teamA.id).kills === 1 &&
        findWidgetTeam(body, fixture.teamB.id).kills === 0,
    );
    expect(baselineWidget.teamsAlive).toBe(2);

    const firstTelemetryResults = await waitFor(
      'baseline results mirror version',
      async () => getResults(),
      (body) => resolveResultsVersion(body) >= firstRealtimeUpdate.version,
    );
    expect(
      firstTelemetryResults.liveMirrorVersion ?? -1,
    ).toBeGreaterThanOrEqual(firstRealtimeUpdate.version);

    const liveUnlockResponse = await auth(
      api()
        .post(
          `/org/${fixture.orgId}/matches/${fixture.matchId}/control/results-lock`,
        )
        .send({ locked: false }),
    ).expect(400);
    expect(liveUnlockResponse.body).toEqual(
      expect.objectContaining({
        statusCode: 400,
        message: 'Automatic results can only be reopened after finalization.',
      }),
    );

    await ensurePersistedPlayerRows();

    const teamABeforeManualSave = findTeamResult(
      await waitFor(
        'materialized persisted player rows',
        async () => getResults(),
        (body) =>
          findTeamResult(body, fixture.teamA.id).players.length === 2 &&
          findTeamResult(body, fixture.teamB.id).players.length === 2,
      ),
      fixture.teamA.id,
    );
    expect(teamABeforeManualSave.players).toHaveLength(2);

    const secondTelemetry: TeamTelemetryState[] = [
      {
        teamId: fixture.teamA.id,
        teamName: fixture.teamA.name,
        teamTag: fixture.teamA.tag,
        slot: fixture.teamA.slot,
        players: [
          {
            externalId: fixture.teamA.players[0].externalId,
            name: fixture.teamA.players[0].name,
            kills: 5,
            alive: false,
            knocked: false,
          },
          {
            externalId: fixture.teamA.players[1].externalId,
            name: fixture.teamA.players[1].name,
            kills: 2,
            alive: true,
            knocked: false,
          },
        ],
      },
      {
        teamId: fixture.teamB.id,
        teamName: fixture.teamB.name,
        teamTag: fixture.teamB.tag,
        slot: fixture.teamB.slot,
        players: [
          {
            externalId: fixture.teamB.players[0].externalId,
            name: fixture.teamB.players[0].name,
            kills: 2,
            alive: true,
            knocked: false,
          },
          {
            externalId: fixture.teamB.players[1].externalId,
            name: fixture.teamB.players[1].name,
            kills: 1,
            alive: true,
            knocked: false,
          },
        ],
      },
    ];

    const secondRealtimeUpdatePromise = waitForSocketVersion(
      socket,
      firstRealtimeUpdate.version,
      (payload) =>
        payload.teams.some(
          (team) => team.teamId === fixture.teamA.id && team.kills === 7,
        ),
    );
    await postTelemetry(secondTelemetry);
    const secondRealtime = await secondRealtimeUpdatePromise;
    expect(secondRealtime.version).toBeGreaterThan(firstRealtimeUpdate.version);
    expect(findRealtimeTeam(secondRealtime, fixture.teamA.id).kills).toBe(7);

    await waitFor(
      'second telemetry live mirror',
      async () => getWidgetState(),
      (body) =>
        body.teamsAlive === 2 &&
        findWidgetTeam(body, fixture.teamA.id).kills === 7,
    );

    socket.close();
    socket = null;

    const missedSocketTelemetry: TeamTelemetryState[] = [
      {
        teamId: fixture.teamA.id,
        teamName: fixture.teamA.name,
        teamTag: fixture.teamA.tag,
        slot: fixture.teamA.slot,
        players: [
          {
            externalId: fixture.teamA.players[0].externalId,
            name: fixture.teamA.players[0].name,
            kills: 6,
            alive: true,
            knocked: false,
          },
          {
            externalId: fixture.teamA.players[1].externalId,
            name: fixture.teamA.players[1].name,
            kills: 2,
            alive: true,
            knocked: false,
          },
        ],
      },
      {
        teamId: fixture.teamB.id,
        teamName: fixture.teamB.name,
        teamTag: fixture.teamB.tag,
        slot: fixture.teamB.slot,
        players: [
          {
            externalId: fixture.teamB.players[0].externalId,
            name: fixture.teamB.players[0].name,
            kills: 2,
            alive: true,
            knocked: false,
          },
          {
            externalId: fixture.teamB.players[1].externalId,
            name: fixture.teamB.players[1].name,
            kills: 2,
            alive: true,
            knocked: false,
          },
        ],
      },
    ];

    await postTelemetry(missedSocketTelemetry);
    await waitFor(
      'query recovery after missed socket event',
      async () => getWidgetState(),
      (body) =>
        body.teamsAlive === 2 &&
        findWidgetTeam(body, fixture.teamA.id).kills === 8,
    );

    socket = await connectRealtime(baseUrl, fixture.matchId, accessToken);

    const reconnectTelemetry: TeamTelemetryState[] = [
      {
        teamId: fixture.teamA.id,
        teamName: fixture.teamA.name,
        teamTag: fixture.teamA.tag,
        slot: fixture.teamA.slot,
        players: [
          {
            externalId: fixture.teamA.players[0].externalId,
            name: fixture.teamA.players[0].name,
            kills: 7,
            alive: true,
            knocked: false,
          },
          {
            externalId: fixture.teamA.players[1].externalId,
            name: fixture.teamA.players[1].name,
            kills: 3,
            alive: true,
            knocked: false,
          },
        ],
      },
      {
        teamId: fixture.teamB.id,
        teamName: fixture.teamB.name,
        teamTag: fixture.teamB.tag,
        slot: fixture.teamB.slot,
        players: [
          {
            externalId: fixture.teamB.players[0].externalId,
            name: fixture.teamB.players[0].name,
            kills: 2,
            alive: true,
            knocked: false,
          },
          {
            externalId: fixture.teamB.players[1].externalId,
            name: fixture.teamB.players[1].name,
            kills: 2,
            alive: true,
            knocked: false,
          },
        ],
      },
    ];

    const reconnectRealtimePromise = waitForSocketVersion(
      socket,
      secondRealtime.version,
      (payload) =>
        payload.teams.some(
          (team) => team.teamId === fixture.teamA.id && team.kills === 10,
        ),
    );
    await postTelemetry(reconnectTelemetry);
    const reconnectRealtime = await reconnectRealtimePromise;
    expect(reconnectRealtime.version).toBeGreaterThan(secondRealtime.version);

    await waitFor(
      'socket/query reconciliation after reconnect',
      async () => getWidgetState(),
      (body) =>
        body.teamsAlive === 2 &&
        findWidgetTeam(body, fixture.teamA.id).kills === 10,
    );

    const terminalTelemetry: TeamTelemetryState[] = [
      {
        teamId: fixture.teamA.id,
        teamName: fixture.teamA.name,
        teamTag: fixture.teamA.tag,
        slot: fixture.teamA.slot,
        players: [
          {
            externalId: fixture.teamA.players[0].externalId,
            name: fixture.teamA.players[0].name,
            kills: 7,
            alive: true,
            knocked: false,
          },
          {
            externalId: fixture.teamA.players[1].externalId,
            name: fixture.teamA.players[1].name,
            kills: 3,
            alive: false,
            knocked: false,
          },
        ],
      },
      {
        teamId: fixture.teamB.id,
        teamName: fixture.teamB.name,
        teamTag: fixture.teamB.tag,
        slot: fixture.teamB.slot,
        players: [
          {
            externalId: fixture.teamB.players[0].externalId,
            name: fixture.teamB.players[0].name,
            kills: 2,
            alive: false,
            knocked: false,
          },
          {
            externalId: fixture.teamB.players[1].externalId,
            name: fixture.teamB.players[1].name,
            kills: 2,
            alive: false,
            knocked: false,
          },
        ],
      },
    ];

    const winnerRealtimePromise = waitForSocketVersion(
      socket,
      reconnectRealtime.version,
      (payload) =>
        payload.summary?.winnerTeamId === fixture.teamA.id &&
        payload.teams.some(
          (team) => team.teamId === fixture.teamB.id && team.alivePlayers === 0,
        ),
    );
    await postTelemetry(terminalTelemetry);
    const winnerRealtime = await winnerRealtimePromise;
    expect(winnerRealtime.version).toBeGreaterThan(reconnectRealtime.version);
    expect(winnerRealtime.summary?.winnerTeamId).toBe(fixture.teamA.id);
    await auth(
      api()
        .post(`/org/${fixture.orgId}/matches/${fixture.matchId}/set-status`)
        .send({ status: MatchStatus.ENDED }),
    ).expect(201);

    const endedControl = await waitFor(
      'FINISH_PENDING control summary',
      async () => getControlSummary(),
      (body) => body.control.lifecycleStatus === 'FINISH_PENDING',
    );
    expect(endedControl.control.lifecycleLocked).toBe(true);
    expect(endedControl.control.slotLocked).toBe(true);
    expect(endedControl.control.resultsLocked).toBe(true);

    const postEndTeamB = findTeamResult(await getResults(), fixture.teamB.id);
    await auth(
      api()
        .patch(
          `/me/matches/${fixture.matchId}/results/team/${fixture.teamB.id}/players`,
        )
        .send({
          players: [
            {
              playerResultId: findPlayerResult(
                postEndTeamB,
                fixture.teamB.players[0].name,
              ).id,
              kills: 3,
              alive: false,
              knocked: false,
            },
            {
              playerResultId: findPlayerResult(
                postEndTeamB,
                fixture.teamB.players[1].name,
              ).id,
              kills: 2,
              alive: false,
              knocked: false,
            },
          ],
        }),
    ).expect(409);

    await auth(
      api()
        .post(`/api/matches/${fixture.matchId}/control/confirm`)
        .send({ reason: 'Phase 8 final confirm' }),
    ).expect(201);

    const confirmedControl = await waitFor(
      'FINISHED control summary',
      async () => getControlSummary(),
      (body) => body.control.lifecycleStatus === 'FINISHED',
    );
    expect(confirmedControl.control.resultsLocked).toBe(true);
    expect(confirmedControl.control.lockState).toBe('LOCKED');
    expect(confirmedControl.control.slotLocked).toBe(true);

    await auth(
      api().delete(
        `/me/matches/${fixture.matchId}/slots/${fixture.teamA.slot}`,
      ),
    ).expect(403);

    const reopenResponse = await auth(
      api()
        .post(
          `/org/${fixture.orgId}/matches/${fixture.matchId}/control/results-lock`,
        )
        .send({ locked: false }),
    ).expect(201);
    expect(reopenResponse.body).toEqual(
      expect.objectContaining({
        ok: true,
        locked: false,
        lockState: 'UNLOCKED',
      }),
    );

    const reopenedControl = await waitFor(
      'reopened control summary',
      async () => getControlSummary(),
      (body) =>
        body.control.lifecycleStatus === 'FINISHED' &&
        body.control.resultsLocked === false,
    );
    expect(reopenedControl.control.lockState).toBe('UNLOCKED');

    const reopenedTeamB = findTeamResult(await getResults(), fixture.teamB.id);
    await auth(
      api()
        .patch(
          `/me/matches/${fixture.matchId}/results/team/${fixture.teamB.id}/players`,
        )
        .send({
          players: [
            {
              playerResultId: findPlayerResult(
                reopenedTeamB,
                fixture.teamB.players[0].name,
              ).id,
              kills: 3,
              alive: false,
              knocked: false,
            },
            {
              playerResultId: findPlayerResult(
                reopenedTeamB,
                fixture.teamB.players[1].name,
              ).id,
              kills: 2,
              alive: false,
              knocked: false,
            },
          ],
        }),
    ).expect(200);

    const reopenedResults = await waitFor(
      'post-finalization manual edit results',
      async () => getResults(),
      (body) => {
        const team = findTeamResult(body, fixture.teamB.id);
        return team.kills === 5 && team.placement === 2 && team.eliminated;
      },
    );
    expect(
      findTeamResult(reopenedResults, fixture.teamB.id).audit?.lastOverride
        ?.action,
    ).toBe('OVERRIDE');

    const relockResponse = await auth(
      api()
        .post(
          `/org/${fixture.orgId}/matches/${fixture.matchId}/control/results-lock`,
        )
        .send({ locked: true }),
    ).expect(201);
    expect(relockResponse.body).toEqual(
      expect.objectContaining({
        ok: true,
        locked: true,
        lockState: 'LOCKED',
      }),
    );

    const relockedControl = await waitFor(
      'relocked control summary',
      async () => getControlSummary(),
      (body) =>
        body.control.lifecycleStatus === 'FINISHED' &&
        body.control.resultsLocked === true,
    );
    expect(relockedControl.control.lockState).toBe('LOCKED');

    const relockedTeamB = findTeamResult(await getResults(), fixture.teamB.id);
    await auth(
      api()
        .patch(
          `/me/matches/${fixture.matchId}/results/team/${fixture.teamB.id}/players`,
        )
        .send({
          players: [
            {
              playerResultId: findPlayerResult(
                relockedTeamB,
                fixture.teamB.players[0].name,
              ).id,
              kills: 4,
              alive: false,
              knocked: false,
            },
          ],
        }),
    ).expect(409);

    const finalResults = await getResults();
    expect(finalResults.lifecycleStatus).toBe('FINISHED');
    expect(finalResults.lockState).toBe('LOCKED');
    expect(finalResults.overrideReleaseAllowed).toBe(false);
    expect(finalResults.overrideReleaseReason).toBe(
      'Overrides cannot be released after results are finalized.',
    );
    expect(
      finalResults.overrideAudit?.some(
        (entry) =>
          entry.action === 'OVERRIDE' &&
          entry.actorId === fixture.userId &&
          (entry.scope.level === 'TEAM' || entry.scope.level === 'PLAYER'),
      ),
    ).toBe(true);
  });
});
