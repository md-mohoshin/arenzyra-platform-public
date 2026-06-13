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
import { AppModule } from '../src/app.module';
import { RolesGuard } from '../src/common/auth/roles.guard';
import { PrismaService } from '../src/db/prisma.service';

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
  casMatchId: string;
  resultMatchId: string;
  finishedMatchId: string;
  sessionId: string;
  teamA: TeamFixture;
  teamB: TeamFixture;
};

type ResultPlayer = {
  id: string;
  playerId: string | null;
  name: string | null;
  kills: number;
  alive: boolean;
  knocked: boolean;
};

type ResultTeam = {
  teamId: string | null;
  players: ResultPlayer[];
};

type ResultsResponse = {
  liveMirrorVersion?: number;
  liveSyncVersion?: number;
  results: ResultTeam[];
};

const responseCode = (body: Record<string, unknown>) =>
  body.code ?? (body.response as { code?: string } | undefined)?.code;

const liveSyncMeta = (
  version: number,
  extras: Record<string, unknown> = {},
) => ({
  ...extras,
  liveSync: {
    version,
    updatedAt: Date.now(),
    overrides: {
      players: {},
      teams: {},
    },
    auditTrail: [],
  },
});

const resolveResultsVersion = (body: ResultsResponse) =>
  typeof body.liveMirrorVersion === 'number'
    ? body.liveMirrorVersion
    : typeof body.liveSyncVersion === 'number'
      ? body.liveSyncVersion
      : -1;

describe('Match control validation contracts (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let fixture: Fixture;
  let accessToken: string;

  const api = () => request(app.getHttpServer());
  const auth = (req: SupertestRequest) =>
    req.set('authorization', `Bearer ${accessToken}`);

  const seedSlotResults = async (matchId: string) => {
    for (const team of [fixture.teamA, fixture.teamB]) {
      await prisma.matchSlotResult.create({
        data: {
          matchId,
          organizationId: fixture.orgId,
          slotNumber: team.slot,
          teamId: team.id,
          wasPresentInMatch: true,
          players: {
            create: team.players.map((player) => ({
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
          },
        },
      });
    }
  };

  const seedMatch = async (
    matchId: string,
    params: {
      matchNumber: number;
      status?: MatchStatus;
      liveState?: LiveState;
      dataSource?: MatchDataSource;
      dataMode?: DataMode;
      controlState?: string;
      controlVersion?: number;
      metaJson?: Record<string, unknown>;
      resultsManualLock?: boolean;
      pcobSessionId?: string | null;
    },
  ) => {
    await prisma.match.create({
      data: {
        id: matchId,
        name: `Validation Match ${params.matchNumber}`,
        tournamentId: fixture.tournamentId,
        organizationId: fixture.orgId,
        ownerUserId: fixture.userId,
        stageId: fixture.stageId,
        groupId: fixture.groupId,
        status: params.status ?? MatchStatus.DRAFT,
        liveState: params.liveState ?? LiveState.UPCOMING,
        dataMode: params.dataMode ?? DataMode.MANUAL,
        dataSource: params.dataSource ?? MatchDataSource.MANUAL,
        slotCount: 25,
        matchNumber: params.matchNumber,
        pcobSessionId: params.pcobSessionId ?? fixture.sessionId,
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
            state: (params.controlState ?? 'READY') as never,
            version: params.controlVersion ?? 0,
            metaJson: params.metaJson,
            resultsManualLock: params.resultsManualLock ?? false,
          },
        },
      },
    });
    await seedSlotResults(matchId);
  };

  const getResults = async (matchId: string): Promise<ResultsResponse> => {
    const response = await auth(
      api().get(`/me/matches/${matchId}/results`),
    ).expect(200);
    return response.body as ResultsResponse;
  };

  const findTeamResult = (results: ResultsResponse, teamId: string) => {
    const team = results.results.find((entry) => entry.teamId === teamId);
    if (!team) {
      throw new Error(`Missing result row for teamId=${teamId}`);
    }
    return team;
  };

  const playerPayload = (team: ResultTeam, kills: number) =>
    team.players.map((player, index) => ({
      playerResultId: player.id,
      kills: kills + index,
      alive: true,
      knocked: false,
    }));

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

    prisma = app.get(PrismaService);

    const suffix = `${Date.now()}`;
    const password = 'Validation!Pass123';
    const passwordHash = await bcrypt.hash(password, 10);

    fixture = {
      orgId: `validation-org-${suffix}`,
      orgSlug: `validation-org-${suffix}`,
      userId: `validation-user-${suffix}`,
      email: `validation+${suffix}@arenzyra.com`,
      password,
      tournamentId: `validation-tour-${suffix}`,
      stageId: `validation-stage-${suffix}`,
      groupId: `validation-group-${suffix}`,
      casMatchId: `validation-cas-${suffix}`,
      resultMatchId: `validation-results-${suffix}`,
      finishedMatchId: `validation-finished-${suffix}`,
      sessionId: `validation-session-${suffix}`,
      teamA: {
        id: `validation-team-a-${suffix}`,
        tournamentTeamId: `validation-tt-a-${suffix}`,
        name: 'Validation Alpha',
        tag: 'VLA',
        slot: 1,
        players: [
          {
            id: `validation-player-a1-${suffix}`,
            externalId: `validation-a1-${suffix}`,
            name: 'Alpha One',
          },
          {
            id: `validation-player-a2-${suffix}`,
            externalId: `validation-a2-${suffix}`,
            name: 'Alpha Two',
          },
        ],
      },
      teamB: {
        id: `validation-team-b-${suffix}`,
        tournamentTeamId: `validation-tt-b-${suffix}`,
        name: 'Validation Bravo',
        tag: 'VLB',
        slot: 2,
        players: [
          {
            id: `validation-player-b1-${suffix}`,
            externalId: `validation-b1-${suffix}`,
            name: 'Bravo One',
          },
          {
            id: `validation-player-b2-${suffix}`,
            externalId: `validation-b2-${suffix}`,
            name: 'Bravo Two',
          },
        ],
      },
    };

    await prisma.organization.create({
      data: {
        id: fixture.orgId,
        name: `Validation Org ${suffix}`,
        slug: fixture.orgSlug,
        status: OrganizationStatus.APPROVED,
      },
    });
    await prisma.user.create({
      data: {
        id: fixture.userId,
        email: fixture.email,
        name: 'Validation Organizer',
        password: passwordHash,
        role: Role.ORGANIZER,
        organizationId: fixture.orgId,
      },
    });
    await prisma.tournament.create({
      data: {
        id: fixture.tournamentId,
        name: `Validation Tournament ${suffix}`,
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
        name: 'Validation Stage',
        tournamentId: fixture.tournamentId,
        organizationId: fixture.orgId,
      },
    });
    await prisma.group.create({
      data: {
        id: fixture.groupId,
        name: 'Validation Group',
        stageId: fixture.stageId,
        organizationId: fixture.orgId,
      },
    });
    await prisma.team.createMany({
      data: [fixture.teamA, fixture.teamB].map((team) => ({
        id: team.id,
        name: team.name,
        tag: team.tag,
        organizationId: fixture.orgId,
        ownerUserId: fixture.userId,
      })),
    });
    await prisma.player.createMany({
      data: [fixture.teamA, fixture.teamB].flatMap((team) =>
        team.players.map((player) => ({
          id: player.id,
          organizationId: fixture.orgId,
          teamId: team.id,
          ign: player.name,
          realName: player.name,
        })),
      ),
    });
    await prisma.rosterEntry.createMany({
      data: [fixture.teamA, fixture.teamB].flatMap((team) =>
        team.players.map((player) => ({
          teamId: team.id,
          playerId: player.id,
        })),
      ),
    });
    await prisma.tournamentTeam.createMany({
      data: [fixture.teamA, fixture.teamB].map((team) => ({
        id: team.tournamentTeamId,
        tournamentId: fixture.tournamentId,
        teamId: team.id,
      })),
    });
    await prisma.stageTeam.createMany({
      data: [fixture.teamA, fixture.teamB].map((team) => ({
        stageId: fixture.stageId,
        tournamentTeamId: team.tournamentTeamId,
      })),
    });
    await prisma.groupTeam.createMany({
      data: [fixture.teamA, fixture.teamB].map((team) => ({
        groupId: fixture.groupId,
        tournamentTeamId: team.tournamentTeamId,
      })),
    });

    await seedMatch(fixture.casMatchId, {
      matchNumber: 1,
      dataSource: MatchDataSource.PCOB,
      dataMode: DataMode.MANUAL,
      controlVersion: 0,
      pcobSessionId: fixture.sessionId,
    });
    await seedMatch(fixture.resultMatchId, {
      matchNumber: 2,
      dataSource: MatchDataSource.MANUAL,
      dataMode: DataMode.MANUAL,
      controlVersion: 0,
      metaJson: liveSyncMeta(1),
      pcobSessionId: null,
    });
    await seedMatch(fixture.finishedMatchId, {
      matchNumber: 3,
      status: MatchStatus.FINISHED,
      liveState: LiveState.ENDED,
      dataSource: MatchDataSource.PCOB,
      dataMode: DataMode.MANUAL,
      controlState: 'CONFIRMED',
      controlVersion: 4,
      metaJson: liveSyncMeta(4, {
        resultFinalized: true,
        resultNeedsConfirmation: false,
      }),
      resultsManualLock: true,
      pcobSessionId: `${fixture.sessionId}-finished`,
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
        where: {
          id: {
            in: [
              fixture.casMatchId,
              fixture.resultMatchId,
              fixture.finishedMatchId,
            ],
          },
        },
      });
      await prisma.rosterEntry.deleteMany({
        where: { teamId: { in: [fixture.teamA.id, fixture.teamB.id] } },
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
      await prisma.group.deleteMany({ where: { id: fixture.groupId } });
      await prisma.stage.deleteMany({ where: { id: fixture.stageId } });
      await prisma.tournament.deleteMany({
        where: { id: fixture.tournamentId },
      });
      await prisma.user.deleteMany({ where: { id: fixture.userId } });
      await prisma.player.deleteMany({
        where: { organizationId: fixture.orgId },
      });
      await prisma.organizationBranding.deleteMany({
        where: { organizationId: fixture.orgId },
      });
      await prisma.organization.deleteMany({ where: { id: fixture.orgId } });
    }

    if (app) {
      await app.close();
    }
  });

  it('rejects stale control start commands without mutating control state', async () => {
    const before = await prisma.matchControlState.findUniqueOrThrow({
      where: { matchId: fixture.casMatchId },
      select: { state: true, version: true },
    });

    const response = await auth(
      api()
        .post(`/me/matches/${fixture.casMatchId}/control/start`)
        .send({
          sessionId: fixture.sessionId,
          version: before.version + 1,
        }),
    ).expect(409);

    expect(response.body.statusCode).toBe(409);

    const after = await prisma.matchControlState.findUniqueOrThrow({
      where: { matchId: fixture.casMatchId },
      select: { state: true, version: true },
    });
    expect(after).toEqual(before);
  });

  it('rejects results writes with a stale expectedVersion', async () => {
    const initialResults = await getResults(fixture.resultMatchId);
    expect(resolveResultsVersion(initialResults)).toBe(1);

    const team = findTeamResult(initialResults, fixture.teamA.id);
    const firstSave = await auth(
      api()
        .patch(
          `/me/matches/${fixture.resultMatchId}/results/team/${fixture.teamA.id}/players`,
        )
        .send({
          expectedVersion: 1,
          players: playerPayload(team, 1),
        }),
    ).expect(200);
    expect(firstSave.body.version).toBeGreaterThan(1);

    const conflict = await auth(
      api()
        .patch(
          `/me/matches/${fixture.resultMatchId}/results/team/${fixture.teamA.id}/players`,
        )
        .send({
          expectedVersion: 1,
          players: playerPayload(team, 3),
        }),
    ).expect(409);

    expect(responseCode(conflict.body)).toBe('RESULT_VERSION_MISMATCH');
    expect(conflict.body.currentVersion).toBe(firstSave.body.version);
  });

  it('rejects post-finish mutations across control, results, slots, telemetry, and overrides', async () => {
    const finishedResults = await getResults(fixture.finishedMatchId);
    const team = findTeamResult(finishedResults, fixture.teamB.id);

    await auth(
      api()
        .patch(
          `/me/matches/${fixture.finishedMatchId}/results/team/${fixture.teamB.id}/players`,
        )
        .send({ players: playerPayload(team, 2) }),
    ).expect(409);

    await auth(
      api()
        .post(
          `/me/matches/${fixture.finishedMatchId}/results/overrides/release`,
        )
        .send({}),
    ).expect(409);

    await auth(
      api().delete(`/me/matches/${fixture.finishedMatchId}/slots/2`),
    ).expect(403);

    await auth(
      api()
        .post(`/me/matches/${fixture.finishedMatchId}/control/start`)
        .send({
          sessionId: `${fixture.sessionId}-restart`,
          version: 4,
        }),
    ).expect(400);

    const telemetry = await auth(
      api()
        .post('/api/observer/telemetry')
        .send({
          matchId: fixture.finishedMatchId,
          sessionId: `${fixture.sessionId}-finished`,
          sequence: 1,
          teams: [],
          players: [],
        }),
    ).expect(201);
    expect(telemetry.body.ignored).toBe(true);
    expect(telemetry.body.reason).toBe('MATCH_ENDED');

    const after = await prisma.matchControlState.findUniqueOrThrow({
      where: { matchId: fixture.finishedMatchId },
      select: { state: true, version: true },
    });
    expect(after.state).toBe('CONFIRMED');
    expect(after.version).toBe(4);
  });

  it('rejects legacy observer producer lifecycle/result authority fields', async () => {
    const response = await auth(
      api()
        .post('/api/observer/telemetry')
        .send({
          matchId: fixture.casMatchId,
          sessionId: fixture.sessionId,
          sequence: 1,
          matchStatus: 'FINISHED',
          placement: 1,
          teams: [
            {
              teamId: fixture.teamA.id,
              slot: 1,
              winner: true,
            },
          ],
          players: [],
        }),
    ).expect(201);

    expect(response.body.ignored).toBe(true);
    expect(response.body.reason).toBe('FORBIDDEN_FIELDS');
  });
});
