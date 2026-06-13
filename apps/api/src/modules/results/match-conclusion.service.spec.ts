import { LiveState, MatchStatus } from '@prisma/client';
import type { PrismaService } from '../../db/prisma.service';
import {
  MatchConclusionService,
  type MatchConclusionComputeResult,
  type MatchConclusionPlan,
} from './match-conclusion.service';
import type { TelemetryEngineService } from '../telemetry/telemetry-engine.service';

const expectPlan = (
  result: MatchConclusionComputeResult,
): MatchConclusionPlan => {
  if (!result.ok) {
    throw new Error(`Expected conclusion plan, got ${result.reason}`);
  }
  return result.plan;
};

const createService = (options?: {
  match?: Record<string, unknown> | null;
  telemetryPayload?: Record<string, unknown> | null;
  telemetryState?: Record<string, unknown> | null;
}) => {
  const matchId =
    typeof (options?.match as { id?: unknown } | undefined)?.id === 'string'
      ? ((options?.match as { id: string }).id ?? 'match-1')
      : 'match-1';
  const prisma = {
    match: {
      findFirst: jest.fn().mockResolvedValue(
        options?.match === undefined
          ? {
              id: 'match-1',
              organizationId: 'org-1',
              tournamentId: 'tournament-1',
              sessionId: null,
              status: MatchStatus.LIVE,
              liveState: LiveState.LIVE,
              endedAt: null,
              endedReason: null,
              pcobSessionId: null,
              tournament: { organizationId: 'org-1' },
              controlState: { metaJson: null },
            }
          : options.match,
      ),
    },
    matchTelemetry: {
      findUnique: jest.fn().mockResolvedValue({
        payload: options?.telemetryPayload ?? null,
      }),
    },
    matchSlot: {
      findMany: jest.fn().mockResolvedValue([
        {
          slotNumber: 1,
          teamId: 'team-1',
          team: { players: [] },
        },
      ]),
    },
    matchSlotResult: {
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn(),
      create: jest.fn(),
    },
    matchSlotPlayerResult: {
      update: jest.fn(),
      create: jest.fn(),
    },
    matchStanding: {
      update: jest.fn(),
      create: jest.fn(),
      upsert: jest.fn(),
    },
    $transaction: jest.fn(),
  } as unknown as PrismaService;

  const telemetryEngine = {
    getState: jest.fn().mockResolvedValue(
      options?.telemetryState ?? {
        matchId,
        status: 'ENDED',
        mode: 'AUTO',
        version: 1,
        sequence: 1,
        updatedAt: Date.now(),
        startedAt: Date.now() - 10_000,
        endedAt: Date.now(),
        teamsAlive: 1,
        teams: {
          'team-1': {
            teamId: 'team-1',
            alivePlayers: 1,
            eliminated: false,
            placement: 1,
            totalKills: 4,
            totalPlayers: 1,
            eliminatedAt: null,
            metadata: { slot: 1 },
          },
        },
        players: {
          'player-1': {
            playerId: 'player-1',
            teamId: 'team-1',
            alive: true,
            knocked: false,
            kills: 4,
            metadata: { playerName: 'Alpha' },
          },
        },
      },
    ),
  } as unknown as TelemetryEngineService;

  return {
    prisma,
    telemetryEngine,
    service: new MatchConclusionService(prisma, telemetryEngine),
  };
};

describe('MatchConclusionService', () => {
  it('ignores SHADOW_TELEMETRY conclusion for a session-bound PCOB match', async () => {
    const { prisma, service } = createService({
      match: {
        id: 'match-1',
        sessionId: null,
        status: MatchStatus.LIVE,
        liveState: LiveState.LIVE,
        endedAt: null,
        endedReason: null,
        pcobSessionId: 'session-1',
        tournament: { organizationId: 'org-1' },
        controlState: { metaJson: null },
      },
    });

    await expect(
      service.conclude('match-1', {
        winnerTeamId: 'team-1',
        aliveTeams: 1,
        source: 'SHADOW_TELEMETRY',
      }),
    ).resolves.toBe(false);

    expect((prisma as any).matchTelemetry.findUnique).not.toHaveBeenCalled();
    expect((prisma as any).$transaction).not.toHaveBeenCalled();
  });

  it('ignores SHADOW_TELEMETRY conclusion when recent observer telemetry is active', async () => {
    const { prisma, service } = createService({
      telemetryPayload: {
        observerTelemetry: {
          receivedAt: new Date().toISOString(),
        },
      },
    });

    await expect(
      service.conclude('match-1', {
        winnerTeamId: 'team-1',
        aliveTeams: 1,
        source: 'SHADOW_TELEMETRY',
      }),
    ).resolves.toBe(false);

    expect((prisma as any).matchTelemetry.findUnique).toHaveBeenCalledWith({
      where: { matchId: 'match-1' },
      select: { payload: true },
    });
    expect((prisma as any).$transaction).not.toHaveBeenCalled();
  });

  it('uses the direct match organization when computing a session-linked conclusion', async () => {
    const { prisma, service } = createService({
      match: {
        id: 'match-session-1',
        organizationId: 'org-session',
        sessionId: 'session-1',
        status: MatchStatus.LIVE,
        liveState: LiveState.LIVE,
        endedAt: null,
        endedReason: null,
        pcobSessionId: null,
        tournament: null,
        controlState: { metaJson: null },
      },
    });

    const plan = expectPlan(
      await service.computeConclusion('match-session-1', {
        winnerTeamId: 'team-1',
        aliveTeams: 1,
        source: 'API_MATCH_CONCLUDED',
      }),
    );

    expect(plan.organizationId).toBe('org-session');
    expect(plan.isSessionMatch).toBe(true);
    expect((prisma as any).$transaction).not.toHaveBeenCalled();
  });

  it('computes a session match conclusion without writing results or scoring state', async () => {
    const { prisma, service } = createService({
      match: {
        id: 'match-session-1',
        organizationId: 'org-session',
        sessionId: 'session-1',
        status: MatchStatus.LIVE,
        liveState: LiveState.LIVE,
        endedAt: null,
        endedReason: null,
        pcobSessionId: null,
        tournament: null,
        controlState: { metaJson: null },
      },
    });

    const plan = expectPlan(
      await service.computeConclusion('match-session-1', {
        winnerTeamId: 'team-1',
        aliveTeams: 1,
        source: 'API_MATCH_CONCLUDED',
      }),
    );

    expect(plan.isSessionMatch).toBe(true);
    expect(plan.nextMeta).toEqual(
      expect.objectContaining({
        resultFinalized: true,
        winnerTeamId: 'team-1',
        aliveTeamsAtEnd: 1,
      }),
    );
    expect((prisma as any).$transaction).not.toHaveBeenCalled();
  });

  it('computes final result rows without performing writes', async () => {
    const { prisma, service } = createService();

    const results = await service.computeFinalResults('match-1', {
      source: 'API_MATCH_CONCLUDED',
    });

    expect(results.teamResults).toEqual([
      expect.objectContaining({
        matchId: 'match-1',
        slotNumber: 1,
        teamId: 'team-1',
        placement: 1,
        totalKills: 4,
        finalPlacement: 1,
        finalKills: 4,
      }),
    ]);
    expect(results.playerResults).toEqual([
      expect.objectContaining({
        slotNumber: 1,
        teamId: 'team-1',
        playerName: 'Alpha',
        kills: 4,
        isAlive: false,
      }),
    ]);
    expect(results.standings).toEqual([
      expect.objectContaining({
        matchId: 'match-1',
        tournamentId: 'tournament-1',
        teamId: 'team-1',
        rank: 1,
        totalPoints: 14,
      }),
    ]);
    expect((prisma as any).matchSlotResult.update).not.toHaveBeenCalled();
    expect((prisma as any).matchSlotResult.create).not.toHaveBeenCalled();
    expect((prisma as any).matchSlotPlayerResult.update).not.toHaveBeenCalled();
    expect((prisma as any).matchSlotPlayerResult.create).not.toHaveBeenCalled();
    expect((prisma as any).matchStanding.upsert).not.toHaveBeenCalled();
    expect((prisma as any).$transaction).not.toHaveBeenCalled();
  });

  it('captures raw-only team diagnostics when compatibility telemetry shows a team missing from canonical results', async () => {
    const { prisma, telemetryEngine, service } = createService({
      telemetryPayload: {
        structuralMirrorDisabled: true,
        sequence: 444,
        timestamp: 1_776_985_757_545,
        raw: {
          teams: [
            {
              teamId: 15,
              teamName: 'Team8',
              killNum: 1,
              liveMemberNum: 0,
            },
          ],
          players: [
            {
              teamId: 15,
              teamName: 'Team8',
              playerName: 'Raw Alpha',
              playerOpenId: 'raw-open-1',
            },
            {
              teamId: 15,
              teamName: 'Team8',
              playerName: 'Raw Bravo',
              playerOpenId: 'raw-open-2',
            },
            {
              teamId: 15,
              teamName: 'Team8',
              playerName: 'Raw Charlie',
              playerOpenId: 'raw-open-3',
            },
            {
              teamId: 15,
              teamName: 'Team8',
              playerName: 'Raw Delta',
              playerOpenId: 'raw-open-4',
            },
          ],
        },
      },
      telemetryState: {
        matchId: 'match-1',
        status: 'ENDED',
        mode: 'AUTO',
        version: 11,
        sequence: 493,
        updatedAt: 1_776_985_764_278,
        startedAt: 1_776_983_140_949,
        endedAt: 1_776_985_764_452,
        teamsAlive: 1,
        teams: {
          'team-1': {
            teamId: 'team-1',
            alivePlayers: 1,
            eliminated: false,
            placement: 1,
            totalKills: 7,
            totalPlayers: 4,
            eliminatedAt: null,
            metadata: {
              slot: 10,
              teamName: 'Team 6',
              teamTag: 'T6',
            },
          },
        },
        players: {},
      },
    });

    (prisma as any).matchSlotResult.findMany.mockResolvedValue([
      {
        slotNumber: 15,
        teamId: 'team-8',
        wasPresentInMatch: false,
        team: {
          name: 'Team 8',
          tag: 'T8',
        },
        players: [
          {
            playerName: 'Roster Alpha',
            externalPlayerId: 'roster-ext-1',
            pubgAccountId: 'roster-open-1',
            player: {
              ign: 'Roster Alpha',
              externalPlayerId: 'roster-ext-1',
              playerOpenId: 'roster-open-1',
              inGameId: null,
              pubgPlayerId: null,
            },
          },
          {
            playerName: 'Roster Bravo',
            externalPlayerId: 'roster-ext-2',
            pubgAccountId: 'roster-open-2',
            player: {
              ign: 'Roster Bravo',
              externalPlayerId: 'roster-ext-2',
              playerOpenId: 'roster-open-2',
              inGameId: null,
              pubgPlayerId: null,
            },
          },
          {
            playerName: 'Roster Charlie',
            externalPlayerId: 'roster-ext-3',
            pubgAccountId: 'roster-open-3',
            player: {
              ign: 'Roster Charlie',
              externalPlayerId: 'roster-ext-3',
              playerOpenId: 'roster-open-3',
              inGameId: null,
              pubgPlayerId: null,
            },
          },
          {
            playerName: 'Roster Delta',
            externalPlayerId: 'roster-ext-4',
            pubgAccountId: 'roster-open-4',
            player: {
              ign: 'Roster Delta',
              externalPlayerId: 'roster-ext-4',
              playerOpenId: 'roster-open-4',
              inGameId: null,
              pubgPlayerId: null,
            },
          },
        ],
      },
    ]);
    (prisma as any).matchSlot.findMany.mockResolvedValue([
      {
        slotNumber: 15,
        teamId: 'team-8',
        team: {
          name: 'Team 8',
          tag: 'T8',
          players: [],
        },
      },
    ]);

    const diagnostics =
      await service.buildTelemetryPromotionDiagnostics('match-1');

    expect(telemetryEngine.getState).toHaveBeenCalledWith('match-1');
    expect(diagnostics).toEqual(
      expect.objectContaining({
        source: 'MATCH_TELEMETRY_COMPATIBILITY_RAW',
        structuralMirrorDisabled: true,
        rawSnapshot: expect.objectContaining({
          sequence: 444,
          teamCount: 1,
          playerCount: 4,
        }),
        canonicalSnapshot: expect.objectContaining({
          sequence: 493,
          teamCount: 1,
        }),
        rawOnlyTeams: [
          expect.objectContaining({
            rawSlot: 15,
            rawTeamName: 'Team8',
            canonicalTeamId: 'team-8',
            canonicalTeamName: 'Team 8',
            finalResultWasPresentInMatch: false,
            presentInCanonicalAcceptedState: false,
            rawPlayerCount: 4,
            rawPlayerNameCount: 4,
            rawPlayerIdentifierCount: 4,
            rosterPlayerCount: 4,
            rosterPlayerNameCount: 4,
            rosterPlayerIdentifierCount: 8,
            matchedRosterIdentityCount: 0,
            matchedRosterNameCount: 0,
            reasonCodes: expect.arrayContaining([
              'RAW_TEAM_PRESENT_BUT_ABSENT_FROM_CANONICAL',
              'FINAL_RESULT_MARKED_ABSENT',
              'RAW_PLAYER_IDENTITIES_DO_NOT_MATCH_SLOT_ROSTER',
              'RAW_PLAYER_NAMES_DO_NOT_MATCH_SLOT_ROSTER',
            ]),
          }),
        ],
      }),
    );
    expect(diagnostics?.rawOnlyTeams[0]).not.toHaveProperty('rawPlayerNames');
    expect(diagnostics?.rawOnlyTeams[0]).not.toHaveProperty(
      'rawPlayerIdentifiers',
    );
    expect(diagnostics?.rawOnlyTeams[0]).not.toHaveProperty(
      'rosterPlayerNames',
    );
  });

  it('computes final metadata for a finalizing match without promoting it directly', async () => {
    const { prisma, service } = createService({
      match: {
        id: 'match-finalizing-1',
        organizationId: 'org-1',
        sessionId: null,
        status: MatchStatus.FINISH_PENDING,
        liveState: LiveState.ENDED,
        endedAt: new Date('2026-03-18T12:00:00.000Z'),
        endedReason: 'OBSERVER_FINISH_DETECTED',
        pcobSessionId: null,
        tournament: { organizationId: 'org-1' },
        controlState: {
          metaJson: {
            finalizationStartedAt: '2026-03-18T11:59:40.000Z',
          },
        },
      },
    });

    const plan = expectPlan(
      await service.computeConclusion('match-finalizing-1', {
        source: 'API_MATCH_CONCLUDED',
      }),
    );

    expect(plan.endedAt.toISOString()).toBe('2026-03-18T12:00:00.000Z');
    expect(plan.endedReason).toBe('OBSERVER_FINISH_DETECTED');
    expect(plan.nextMeta).toEqual(
      expect.objectContaining({
        finalizationStartedAt: '2026-03-18T11:59:40.000Z',
        resultFinalized: true,
        finalizedAt: '2026-03-18T12:00:00.000Z',
      }),
    );
    expect((prisma as any).$transaction).not.toHaveBeenCalled();
  });

  it('flags multiple surviving teams as requiring confirmation when auto-finalized by kills', async () => {
    const { prisma, service } = createService({
      telemetryState: {
        matchId: 'match-1',
        status: 'ENDED',
        mode: 'AUTO',
        version: 7,
        sequence: 19,
        updatedAt: 5_000,
        startedAt: 1_000,
        endedAt: 5_000,
        teamsAlive: 2,
        teams: {
          'team-1': {
            teamId: 'team-1',
            alivePlayers: 1,
            eliminated: false,
            placement: null,
            totalKills: 4,
            totalPlayers: 1,
            eliminatedAt: null,
            metadata: { slot: 1 },
          },
          'team-2': {
            teamId: 'team-2',
            alivePlayers: 2,
            eliminated: false,
            placement: null,
            totalKills: 7,
            totalPlayers: 2,
            eliminatedAt: null,
            metadata: { slot: 2 },
          },
          'team-3': {
            teamId: 'team-3',
            alivePlayers: 0,
            eliminated: true,
            placement: 3,
            totalKills: 2,
            totalPlayers: 1,
            eliminatedAt: 3_000,
            metadata: { slot: 3 },
          },
        },
        players: {
          'player-1': {
            playerId: 'player-1',
            teamId: 'team-1',
            alive: true,
            knocked: false,
            kills: 4,
            metadata: { playerName: 'Alpha' },
          },
          'player-2': {
            playerId: 'player-2',
            teamId: 'team-2',
            alive: true,
            knocked: false,
            kills: 5,
            metadata: { playerName: 'Bravo' },
          },
          'player-3': {
            playerId: 'player-3',
            teamId: 'team-2',
            alive: true,
            knocked: false,
            kills: 2,
            metadata: { playerName: 'Charlie' },
          },
          'player-4': {
            playerId: 'player-4',
            teamId: 'team-3',
            alive: false,
            knocked: false,
            kills: 2,
            metadata: { playerName: 'Delta' },
          },
        },
      },
    });

    const plan = expectPlan(
      await service.computeConclusion('match-1', {
        source: 'API_MATCH_CONCLUDED',
      }),
    );

    expect(plan.finalProjection).toMatchObject({
      totalTeams: 3,
      placementsAssigned: 3,
      winnerTeamId: 'team-2',
      needsConfirmation: true,
      teams: {
        'team-1': { placement: 2 },
        'team-2': { placement: 1 },
        'team-3': { placement: 3 },
      },
    });
    expect(plan.finalProjection.ambiguities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'MULTIPLE_TEAMS_ALIVE_AT_END',
          teamIds: ['team-2', 'team-1'],
          placementFrom: 1,
          placementTo: 2,
        }),
      ]),
    );
    expect(plan.nextMeta).toEqual(
      expect.objectContaining({
        resultNeedsConfirmation: true,
        resultAmbiguities: expect.arrayContaining([
          expect.objectContaining({
            code: 'MULTIPLE_TEAMS_ALIVE_AT_END',
          }),
        ]),
      }),
    );
    expect((prisma as any).$transaction).not.toHaveBeenCalled();
  });

  it('flags simultaneous elimination timestamps as requiring confirmation', async () => {
    const { prisma, service } = createService({
      telemetryState: {
        matchId: 'match-1',
        status: 'ENDED',
        mode: 'AUTO',
        version: 8,
        sequence: 22,
        updatedAt: 10_000,
        startedAt: 1_000,
        endedAt: 10_000,
        teamsAlive: 1,
        teams: {
          'team-1': {
            teamId: 'team-1',
            alivePlayers: 1,
            eliminated: false,
            placement: 1,
            totalKills: 6,
            totalPlayers: 1,
            eliminatedAt: null,
            metadata: { slot: 1 },
          },
          'team-2': {
            teamId: 'team-2',
            alivePlayers: 0,
            eliminated: true,
            placement: 2,
            totalKills: 2,
            totalPlayers: 1,
            eliminatedAt: 9_000,
            metadata: { slot: 2 },
          },
          'team-3': {
            teamId: 'team-3',
            alivePlayers: 0,
            eliminated: true,
            placement: 3,
            totalKills: 1,
            totalPlayers: 1,
            eliminatedAt: 9_000,
            metadata: { slot: 3 },
          },
        },
        players: {
          'player-1': {
            playerId: 'player-1',
            teamId: 'team-1',
            alive: true,
            knocked: false,
            kills: 6,
            metadata: { playerName: 'Alpha' },
          },
          'player-2': {
            playerId: 'player-2',
            teamId: 'team-2',
            alive: false,
            knocked: false,
            kills: 2,
            metadata: { playerName: 'Bravo' },
          },
          'player-3': {
            playerId: 'player-3',
            teamId: 'team-3',
            alive: false,
            knocked: false,
            kills: 1,
            metadata: { playerName: 'Charlie' },
          },
        },
      },
    });

    const plan = expectPlan(
      await service.computeConclusion('match-1', {
        source: 'API_MATCH_CONCLUDED',
      }),
    );

    expect(plan.finalProjection.needsConfirmation).toBe(true);
    expect(plan.finalProjection.ambiguities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'SIMULTANEOUS_ELIMINATION',
          teamIds: ['team-2', 'team-3'],
          placementFrom: 2,
          placementTo: 3,
        }),
      ]),
    );
    expect(plan.nextMeta).toEqual(
      expect.objectContaining({
        resultNeedsConfirmation: true,
      }),
    );
    expect((prisma as any).$transaction).not.toHaveBeenCalled();
  });

  it('uses complete API team placements to resolve simultaneous eliminations automatically', async () => {
    const { prisma, service } = createService({
      telemetryState: {
        matchId: 'match-1',
        status: 'ENDED',
        mode: 'AUTO',
        version: 9,
        sequence: 23,
        updatedAt: 10_000,
        startedAt: 1_000,
        endedAt: 10_000,
        teamsAlive: 1,
        teams: {
          'team-1': {
            teamId: 'team-1',
            alivePlayers: 1,
            eliminated: false,
            placement: 1,
            totalKills: 6,
            totalPlayers: 1,
            eliminatedAt: null,
            metadata: { slot: 1, telemetryPlacement: 1 },
          },
          'team-2': {
            teamId: 'team-2',
            alivePlayers: 0,
            eliminated: true,
            placement: 3,
            totalKills: 2,
            totalPlayers: 1,
            eliminatedAt: 9_000,
            metadata: { slot: 2, telemetryPlacement: 2 },
          },
          'team-3': {
            teamId: 'team-3',
            alivePlayers: 0,
            eliminated: true,
            placement: 2,
            totalKills: 1,
            totalPlayers: 1,
            eliminatedAt: 9_000,
            metadata: { slot: 3, telemetryPlacement: 3 },
          },
        },
        players: {
          'player-1': {
            playerId: 'player-1',
            teamId: 'team-1',
            alive: true,
            knocked: false,
            kills: 6,
            metadata: { playerName: 'Alpha' },
          },
          'player-2': {
            playerId: 'player-2',
            teamId: 'team-2',
            alive: false,
            knocked: false,
            kills: 2,
            metadata: { playerName: 'Bravo' },
          },
          'player-3': {
            playerId: 'player-3',
            teamId: 'team-3',
            alive: false,
            knocked: false,
            kills: 1,
            metadata: { playerName: 'Charlie' },
          },
        },
      },
    });

    const plan = expectPlan(
      await service.computeConclusion('match-1', {
        source: 'API_MATCH_CONCLUDED',
      }),
    );

    expect(plan.finalProjection).toMatchObject({
      totalTeams: 3,
      placementsAssigned: 3,
      winnerTeamId: 'team-1',
      needsConfirmation: false,
      ambiguities: [],
      teams: {
        'team-1': { placement: 1 },
        'team-2': { placement: 2 },
        'team-3': { placement: 3 },
      },
    });
    expect((prisma as any).$transaction).not.toHaveBeenCalled();
  });

  it('uses final projection over stale live placements when computing placement points', async () => {
    const { prisma, service } = createService({
      telemetryState: {
        matchId: 'match-1',
        status: 'ENDED',
        mode: 'AUTO',
        version: 9,
        sequence: 23,
        updatedAt: 10_000,
        startedAt: 1_000,
        endedAt: 10_000,
        teamsAlive: 1,
        teams: {
          'team-1': {
            teamId: 'team-1',
            alivePlayers: 1,
            eliminated: false,
            placement: 1,
            totalKills: 6,
            totalPlayers: 1,
            eliminatedAt: null,
            metadata: { slot: 1, telemetryPlacement: 1 },
          },
          'team-2': {
            teamId: 'team-2',
            alivePlayers: 0,
            eliminated: true,
            placement: 3,
            totalKills: 2,
            totalPlayers: 1,
            eliminatedAt: 9_000,
            metadata: { slot: 2, telemetryPlacement: 2 },
          },
          'team-3': {
            teamId: 'team-3',
            alivePlayers: 0,
            eliminated: true,
            placement: 2,
            totalKills: 1,
            totalPlayers: 1,
            eliminatedAt: 9_000,
            metadata: { slot: 3, telemetryPlacement: 3 },
          },
        },
        players: {
          'player-1': {
            playerId: 'player-1',
            teamId: 'team-1',
            alive: true,
            knocked: false,
            kills: 6,
            metadata: { playerName: 'Alpha' },
          },
          'player-2': {
            playerId: 'player-2',
            teamId: 'team-2',
            alive: false,
            knocked: false,
            kills: 2,
            metadata: { playerName: 'Bravo' },
          },
          'player-3': {
            playerId: 'player-3',
            teamId: 'team-3',
            alive: false,
            knocked: false,
            kills: 1,
            metadata: { playerName: 'Charlie' },
          },
        },
      },
    });

    (prisma as any).matchSlot.findMany.mockResolvedValue([
      { slotNumber: 1, teamId: 'team-1', team: { players: [] } },
      { slotNumber: 2, teamId: 'team-2', team: { players: [] } },
      { slotNumber: 3, teamId: 'team-3', team: { players: [] } },
    ]);
    (prisma as any).matchSlotResult.findMany.mockResolvedValue([
      { slotNumber: 1, teamId: 'team-1', placement: 1, players: [] },
      { slotNumber: 2, teamId: 'team-2', placement: 3, players: [] },
      { slotNumber: 3, teamId: 'team-3', placement: 2, players: [] },
    ]);

    const results = await service.computeFinalResults('match-1', {
      source: 'API_MATCH_CONCLUDED',
    });
    const byTeam = new Map(
      results.teamResults.map((team) => [team.teamId, team] as const),
    );

    expect(byTeam.get('team-2')).toMatchObject({
      placement: 2,
      placementPoints: 6,
      totalKills: 2,
      totalPoints: 8,
    });
    expect(byTeam.get('team-3')).toMatchObject({
      placement: 3,
      placementPoints: 5,
      totalKills: 1,
      totalPoints: 6,
    });
  });

  it('excludes no-show teams from the final projection when telemetry presence is explicit', async () => {
    const { prisma, service } = createService({
      telemetryState: {
        matchId: 'match-1',
        status: 'ENDED',
        mode: 'AUTO',
        version: 4,
        sequence: 10,
        updatedAt: 5_000,
        startedAt: 1_000,
        endedAt: 5_000,
        teamsAlive: 1,
        teams: {
          'team-1': {
            teamId: 'team-1',
            alivePlayers: 0,
            eliminated: true,
            placement: 2,
            totalKills: 3,
            totalPlayers: 1,
            eliminatedAt: 4_000,
            metadata: { slot: 1, wasPresentInMatch: true },
          },
          'team-2': {
            teamId: 'team-2',
            alivePlayers: 1,
            eliminated: false,
            placement: 1,
            totalKills: 5,
            totalPlayers: 1,
            eliminatedAt: null,
            metadata: { slot: 2, wasPresentInMatch: true },
          },
          'team-3': {
            teamId: 'team-3',
            alivePlayers: 4,
            eliminated: false,
            placement: null,
            totalKills: 0,
            totalPlayers: 4,
            eliminatedAt: null,
            metadata: { slot: 3 },
          },
        },
        players: {
          'player-1': {
            playerId: 'player-1',
            teamId: 'team-1',
            alive: false,
            knocked: false,
            kills: 3,
            metadata: {
              playerName: 'Alpha',
              observedInTelemetry: true,
            },
          },
          'player-2': {
            playerId: 'player-2',
            teamId: 'team-2',
            alive: true,
            knocked: false,
            kills: 5,
            metadata: {
              playerName: 'Bravo',
              observedInTelemetry: true,
            },
          },
          'player-3': {
            playerId: 'player-3',
            teamId: 'team-3',
            alive: true,
            knocked: false,
            kills: 0,
            metadata: {
              playerName: 'Charlie',
            },
          },
        },
      },
    });

    const plan = expectPlan(
      await service.computeConclusion('match-1', {
        source: 'API_MATCH_CONCLUDED',
      }),
    );

    expect(plan.finalProjection).toMatchObject({
      totalTeams: 2,
      placementsAssigned: 2,
      winnerTeamId: 'team-2',
      teams: {
        'team-1': { placement: 2 },
        'team-2': { placement: 1 },
      },
    });
    expect(plan.finalProjection.teams['team-3']).toBeUndefined();
    expect((prisma as any).$transaction).not.toHaveBeenCalled();
  });
});
