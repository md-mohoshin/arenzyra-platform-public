import type { PrismaService } from '../../db/prisma.service';
import { MatchesService } from './matches.service';
import type { ScoringService } from '../scoring/scoring.service';
import type { PcobGateway } from '../pcob/pcob.gateway';
import type { AdaptersService } from '../adapters/adapters.service';
import type { ScoreboardService } from '../scoreboard/scoreboard.service';
import type { ResultsService } from '../results/results.service';
import type { ResultsEventsService } from '../results/results-events.service';
import type { StandingsService } from '../standings/standings.service';
import type { AuditService } from '../audit/audit.service';
import type { BroadcastService } from '../broadcast/broadcast.service';
import type { MatchControlService } from '../match-control/match-control.service';

describe('MatchesService.getResults', () => {
  it('excludes unassigned slot results from the organizer payload', async () => {
    const prisma = {
      _dmmf: { modelMap: { Match: { fields: [] } } },
      matchSlotResult: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'slot-result-1',
            matchId: 'match-1',
            teamId: 'team-1',
            slotNumber: 1,
            wasPresentInMatch: true,
            placement: null,
            totalPoints: 0,
            points: 0,
            players: [
              {
                id: 'player-result-1',
                playerId: 'player-1',
                playerName: 'Alpha',
                kills: 2,
                knocks: 1,
                isKnocked: false,
                isAlive: true,
                player: {
                  externalPlayerId: null,
                  id: 'player-1',
                  ign: 'Alpha',
                  photoUrl: null,
                  realName: null,
                },
              },
            ],
            team: { id: 'team-1', name: 'Team One', tag: 'ONE', logoUrl: null },
          },
          {
            id: 'slot-result-empty',
            matchId: 'match-1',
            teamId: null,
            slotNumber: 2,
            placement: null,
            totalPoints: 0,
            points: 0,
            players: [],
            team: null,
          },
          {
            id: 'slot-result-2',
            matchId: 'match-1',
            teamId: 'team-2',
            slotNumber: 3,
            wasPresentInMatch: true,
            placement: null,
            totalPoints: 0,
            points: 0,
            players: [
              {
                id: 'player-result-2',
                playerId: 'player-2',
                playerName: 'Bravo',
                kills: 0,
                knocks: 0,
                isKnocked: false,
                isAlive: false,
                player: {
                  externalPlayerId: null,
                  id: 'player-2',
                  ign: 'Bravo',
                  photoUrl: null,
                  realName: null,
                },
              },
            ],
            team: { id: 'team-2', name: 'Team Two', tag: 'TWO', logoUrl: null },
          },
        ]),
      },
    } as unknown as PrismaService;

    const results = {
      ensureResultsFromSlots: jest.fn().mockResolvedValue(undefined),
    } as unknown as ResultsService;
    const controlStateStore = {
      get: jest.fn().mockResolvedValue({ version: 6 }),
    };

    const service = new MatchesService(
      prisma,
      {} as unknown as ScoringService,
      {} as unknown as PcobGateway,
      {} as unknown as AdaptersService,
      {} as unknown as ScoreboardService,
      results,
      {} as unknown as ResultsEventsService,
      {} as unknown as StandingsService,
      {} as unknown as BroadcastService,
      {} as unknown as AuditService,
      {} as unknown as MatchControlService,
      controlStateStore as any,
    );

    jest.spyOn(service as any, 'ensureMatchOrg').mockResolvedValue({
      id: 'match-1',
      dataSource: 'MANUAL',
      dataMode: 'MANUAL',
      status: null,
      liveState: null,
      controlState: {
        metaJson: {
          liveSync: {
            version: 4,
            updatedAt: 1710000000000,
            overrides: {
              players: {
                'player-1': {
                  kills: {
                    owner: 'MANUAL',
                    override: true,
                    updatedAt: 1710000000000,
                    source: 'MANUAL_RESULTS',
                  },
                },
              },
              teams: {
                'team-1': {
                  placement: {
                    owner: 'MANUAL',
                    override: true,
                    updatedAt: 1710000000000,
                    source: 'MANUAL_RESULTS',
                  },
                },
              },
            },
            auditTrail: [
              {
                action: 'OVERRIDE',
                timestamp: 1710000000000,
                actorId: 'ref-admin',
                source: 'MANUAL_RESULTS',
                scope: {
                  level: 'TEAM',
                  teamId: 'team-1',
                  fields: ['placement'],
                },
              },
              {
                action: 'RELEASE',
                timestamp: 1710003600000,
                actorId: 'observer-2',
                source: 'MANUAL_OVERRIDE_RELEASE_TEAM',
                scope: {
                  level: 'PLAYER',
                  playerId: 'player-1',
                  fields: ['kills'],
                },
              },
            ],
          },
        },
      },
    });

    const response = await service.getResults(
      { id: 'user-1' } as any,
      'match-1',
    );

    expect(response.results).toHaveLength(2);
    expect(response.results.map((row) => row.teamId)).toEqual([
      'team-1',
      'team-2',
    ]);
    expect(response.totalTeamsCount).toBe(2);
    expect(response.results.some((row) => row.teamId === '')).toBe(false);
    expect(controlStateStore.get).toHaveBeenCalledWith('match-1');
    expect(response.liveMirrorVersion).toBe(6);
    expect(response.liveSyncVersion).toBe(4);
    expect(response.overrideReleaseAllowed).toBe(true);
    expect(response.overrideReleaseReason).toBeNull();
    expect(response.overrideAudit?.[0]).toMatchObject({
      action: 'RELEASE',
      actorId: 'observer-2',
    });
    expect(response.results[0]).toMatchObject({
      teamId: 'team-1',
      ownership: {
        placement: {
          owner: 'MANUAL',
          override: true,
        },
      },
      audit: {
        lastOverride: {
          action: 'OVERRIDE',
          actorId: 'ref-admin',
        },
      },
    });
    const firstTeam = response.results[0] as unknown as
      | { players: unknown[] }
      | undefined;
    expect(firstTeam?.players[0]).toMatchObject({
      playerId: 'player-1',
      ownership: {
        kills: {
          owner: 'MANUAL',
          override: true,
        },
      },
      audit: {
        lastRelease: {
          action: 'RELEASE',
          actorId: 'observer-2',
        },
      },
    });
  });

  it('returns canonical anonymous player keys in organizer results payloads', async () => {
    const prisma = {
      _dmmf: { modelMap: { Match: { fields: [] } } },
      matchSlotResult: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'slot-result-1',
            matchId: 'match-1',
            teamId: 'team-1',
            slotNumber: 1,
            wasPresentInMatch: true,
            placement: null,
            totalPoints: 0,
            points: 0,
            players: [
              {
                id: 'player-result-anon',
                playerId: null,
                playerName: 'Anonymous',
                kills: 1,
                knocks: 0,
                isKnocked: false,
                isAlive: true,
                player: null,
              },
            ],
            team: { id: 'team-1', name: 'Team One', tag: 'ONE', logoUrl: null },
          },
        ]),
      },
    } as unknown as PrismaService;

    const results = {
      ensureResultsFromSlots: jest.fn().mockResolvedValue(undefined),
    } as unknown as ResultsService;

    const service = new MatchesService(
      prisma,
      {} as unknown as ScoringService,
      {} as unknown as PcobGateway,
      {} as unknown as AdaptersService,
      {} as unknown as ScoreboardService,
      results,
      {} as unknown as ResultsEventsService,
      {} as unknown as StandingsService,
      {} as unknown as BroadcastService,
      {} as unknown as AuditService,
      {} as unknown as MatchControlService,
    );

    jest.spyOn(service as any, 'ensureMatchOrg').mockResolvedValue({
      id: 'match-1',
      dataSource: 'MANUAL',
      dataMode: 'MANUAL',
      status: null,
      liveState: null,
      controlState: null,
    });

    const response = await service.getResults(
      { id: 'user-1' } as any,
      'match-1',
    );

    expect(response.results).toHaveLength(1);
    const anonymousTeam = response.results[0] as unknown as
      | { players: unknown[] }
      | undefined;
    expect(anonymousTeam?.players[0]).toMatchObject({
      id: 'player-result-anon',
      playerId: 'slot-player:player-result-anon',
    });
  });

  it('ranks only present teams and partitions NO_SHOW teams after ranked results', async () => {
    const slotResults = Array.from({ length: 25 }, (_, index) => {
      const slotNumber = index + 1;
      const active = slotNumber <= 18;
      const rankingScore = 100 - slotNumber;
      return {
        id: `slot-result-${slotNumber}`,
        matchId: 'match-1',
        teamId: `team-${slotNumber}`,
        slotNumber,
        wasPresentInMatch: active,
        placement: slotNumber,
        totalKills: rankingScore,
        totalPoints: rankingScore,
        points: rankingScore,
        players: [
          {
            id: `player-result-${slotNumber}`,
            playerId: `player-${slotNumber}`,
            playerName: `Player ${slotNumber}`,
            kills: rankingScore,
            knocks: 0,
            isKnocked: false,
            isAlive: active,
            player: {
              externalPlayerId: null,
              id: `player-${slotNumber}`,
              ign: `Player ${slotNumber}`,
              photoUrl: null,
              realName: null,
            },
          },
        ],
        team: {
          id: `team-${slotNumber}`,
          name: `Team ${slotNumber}`,
          tag: `T${slotNumber}`,
          logoUrl: null,
        },
      };
    });

    const prisma = {
      _dmmf: { modelMap: { Match: { fields: [] } } },
      matchSlotResult: {
        findMany: jest.fn().mockResolvedValue(slotResults),
      },
    } as unknown as PrismaService;

    const service = new MatchesService(
      prisma,
      {} as unknown as ScoringService,
      {} as unknown as PcobGateway,
      {} as unknown as AdaptersService,
      {} as unknown as ScoreboardService,
      {
        ensureResultsFromSlots: jest.fn().mockResolvedValue(undefined),
      } as unknown as ResultsService,
      {} as unknown as ResultsEventsService,
      {} as unknown as StandingsService,
      {} as unknown as BroadcastService,
      {} as unknown as AuditService,
      {} as unknown as MatchControlService,
      {
        get: jest.fn().mockResolvedValue({ version: 1 }),
      } as any,
    );

    jest.spyOn(service as any, 'ensureMatchOrg').mockResolvedValue({
      id: 'match-1',
      dataSource: 'MANUAL',
      dataMode: 'MANUAL',
      status: null,
      liveState: null,
      controlState: null,
    });

    const response = await service.getResults(
      { id: 'user-1' } as any,
      'match-1',
    );

    const activeRows = response.results.filter(
      (row) => row.presenceStatus === 'ACTIVE',
    );
    const noShowRows = response.results.filter(
      (row) => row.presenceStatus === 'NO_SHOW',
    );

    expect(response.totalTeamsCount).toBe(18);
    expect(response.noShowCount).toBe(7);
    expect(activeRows).toHaveLength(18);
    expect(noShowRows).toHaveLength(7);
    expect(activeRows.map((row) => row.placement)).toEqual(
      Array.from({ length: 18 }, (_, index) => index + 1),
    );
    expect(noShowRows.every((row) => row.placement === null)).toBe(true);
    expect(noShowRows.every((row) => row.kills === 0)).toBe(true);
    expect(noShowRows.every((row) => row.hasTelemetryPresence === false)).toBe(
      true,
    );
    expect(
      response.results
        .slice(0, 18)
        .every((row) => row.presenceStatus === 'ACTIVE'),
    ).toBe(true);
    expect(
      response.results
        .slice(18)
        .every((row) => row.presenceStatus === 'NO_SHOW'),
    ).toBe(true);
  });
});

describe('MatchesService manual presence recovery', () => {
  const actor = {
    id: 'admin-1',
    actorId: 'admin-1',
    role: 'SUPER_ADMIN',
    actorRole: 'SUPER_ADMIN',
    organizationId: 'org-1',
    actingOrgId: 'org-1',
  } as any;

  it('allows manual placement edits to promote a missing team back into manual control', async () => {
    const prisma = {
      _dmmf: { modelMap: { Match: { fields: [] } } },
      match: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'match-1',
          liveState: 'READY',
          organizationId: 'org-1',
          tournament: { ownerUserId: null, organizationId: 'org-1' },
        }),
      },
      matchEvent: {
        findFirst: jest.fn().mockResolvedValue({ seq: 2 }),
        deleteMany: jest.fn(),
        create: jest.fn(),
      },
      matchSlotResult: {
        updateMany: jest.fn(),
      },
    } as unknown as PrismaService;

    const scoring = {
      recomputeMatchAndTournament: jest.fn(),
    } as unknown as ScoringService;
    const service = new MatchesService(
      prisma,
      scoring,
      { emitPlacement: jest.fn() } as unknown as PcobGateway,
      {} as unknown as AdaptersService,
      {} as unknown as ScoreboardService,
      {
        assertSlotPresentForMutation: jest.fn().mockResolvedValue(undefined),
      } as unknown as ResultsService,
      {} as unknown as ResultsEventsService,
      {} as unknown as StandingsService,
      {} as unknown as BroadcastService,
      {} as unknown as AuditService,
      {} as unknown as MatchControlService,
    );

    jest
      .spyOn(service as any, 'ensureTeamAssigned')
      .mockResolvedValue(undefined);
    jest
      .spyOn(service as any, 'broadcastScoreboardSafe')
      .mockResolvedValue(undefined);

    await expect(
      service.manualPlacement(actor, 'match-1', {
        teamId: 'team-1',
        placement: 5,
      }),
    ).resolves.toMatchObject({ ok: true, placement: 5 });
    expect(
      (service as any).results.assertSlotPresentForMutation,
    ).toHaveBeenCalledWith(
      { matchId: 'match-1', teamId: 'team-1' },
      { allowManualPromote: true },
    );
    expect((prisma as any).matchEvent.create).toHaveBeenCalled();
    expect((prisma as any).matchSlotResult.updateMany).toHaveBeenCalled();
    expect((scoring as any).recomputeMatchAndTournament).toHaveBeenCalled();
  });

  it('allows manual kill edits to promote a missing team back into manual control', async () => {
    const prisma = {
      _dmmf: { modelMap: { Match: { fields: [] } } },
      matchEvent: {
        findFirst: jest.fn().mockResolvedValue({ seq: 4 }),
        count: jest.fn().mockResolvedValue(0),
        deleteMany: jest.fn(),
        createMany: jest.fn(),
      },
    } as unknown as PrismaService;

    const scoring = {
      recomputeMatchAndTournament: jest.fn(),
    } as unknown as ScoringService;
    const service = new MatchesService(
      prisma,
      scoring,
      { emitKill: jest.fn() } as unknown as PcobGateway,
      {} as unknown as AdaptersService,
      {} as unknown as ScoreboardService,
      {
        assertSlotPresentForMutation: jest.fn().mockResolvedValue(undefined),
      } as unknown as ResultsService,
      {} as unknown as ResultsEventsService,
      {} as unknown as StandingsService,
      {} as unknown as BroadcastService,
      {} as unknown as AuditService,
      {} as unknown as MatchControlService,
    );

    jest.spyOn(service as any, 'requireManualLiveMatch').mockResolvedValue({
      organizationId: 'org-1',
      tournament: { organizationId: 'org-1' },
    });
    jest
      .spyOn(service as any, 'ensureTeamAssigned')
      .mockResolvedValue(undefined);
    jest
      .spyOn(service as any, 'autoEndIfLastTeamAlive')
      .mockResolvedValue(undefined);
    jest
      .spyOn(service as any, 'broadcastScoreboardSafe')
      .mockResolvedValue(undefined);

    await expect(
      service.manualKill(actor, 'match-1', {
        teamId: 'team-1',
        count: 1,
      }),
    ).resolves.toMatchObject({ ok: true, kills: 1 });
    expect(
      (service as any).results.assertSlotPresentForMutation,
    ).toHaveBeenCalledWith(
      { matchId: 'match-1', teamId: 'team-1' },
      { allowManualPromote: true },
    );
    expect((prisma as any).matchEvent.deleteMany).toHaveBeenCalled();
    expect((prisma as any).matchEvent.createMany).toHaveBeenCalled();
    expect((scoring as any).recomputeMatchAndTournament).toHaveBeenCalled();
  });
});
