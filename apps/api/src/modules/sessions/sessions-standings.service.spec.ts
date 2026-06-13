import { NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { SessionsStandingsService } from './sessions-standings.service';

describe('SessionsStandingsService', () => {
  const actor = {
    id: 'organizer-1',
    actorId: 'organizer-1',
    role: Role.ORGANIZER,
    actorRole: Role.ORGANIZER,
    organizationId: 'org-1',
    actingOrgId: 'org-1',
  };

  const buildService = (opts?: {
    sessionExists?: boolean;
    matches?: Array<{ id: string }>;
    slotResults?: Array<Record<string, unknown>>;
  }) => {
    const prisma = {
      session: {
        findFirst: jest
          .fn()
          .mockResolvedValue(
            opts?.sessionExists === false ? null : { id: 'session-1' },
          ),
      },
      match: {
        findMany: jest.fn().mockResolvedValue(opts?.matches ?? []),
      },
      matchSlotResult: {
        findMany: jest.fn().mockImplementation(
          async ({
            where,
          }: {
            where: {
              matchId?: { in?: string[] };
              wasPresentInMatch?: boolean;
            };
          }) => {
            const allowed = new Set(where.matchId?.in ?? []);
            return (opts?.slotResults ?? []).filter((row) => {
              if (!allowed.has((row as { matchId: string }).matchId)) {
                return false;
              }
              if (where.wasPresentInMatch !== undefined) {
                return (
                  (row as { wasPresentInMatch?: boolean | null })
                    .wasPresentInMatch === where.wasPresentInMatch
                );
              }
              return true;
            });
          },
        ),
      },
    };

    return {
      prisma,
      service: new SessionsStandingsService(prisma as any),
    };
  };

  it('aggregates session standings from applied session result rows', async () => {
    const { prisma, service } = buildService({
      matches: [{ id: 'match-session-1' }, { id: 'match-session-2' }],
      slotResults: [
        {
          matchId: 'match-session-1',
          teamId: 'team-a',
          wasPresentInMatch: true,
          placement: 1,
          totalKills: 8,
          totalPoints: 18,
          points: 18,
          team: { id: 'team-a', tag: 'ALP' },
        },
        {
          matchId: 'match-session-2',
          teamId: 'team-a',
          wasPresentInMatch: true,
          placement: 3,
          totalKills: 5,
          totalPoints: 10,
          points: 10,
          team: { id: 'team-a', tag: 'ALP' },
        },
        {
          matchId: 'match-session-1',
          teamId: 'team-b',
          wasPresentInMatch: true,
          placement: 2,
          totalKills: 9,
          totalPoints: 15,
          points: 15,
          team: { id: 'team-b', tag: 'BRV' },
        },
        {
          matchId: 'match-session-2',
          teamId: 'team-b',
          wasPresentInMatch: true,
          placement: 2,
          totalKills: 7,
          totalPoints: 12,
          points: 12,
          team: { id: 'team-b', tag: 'BRV' },
        },
        {
          matchId: 'match-session-2',
          teamId: 'team-empty',
          wasPresentInMatch: true,
          placement: null,
          totalKills: 0,
          totalPoints: 0,
          points: 0,
          placementPoints: 0,
          team: { id: 'team-empty', tag: 'EMP' },
        },
      ],
    });

    const result = await service.getStandings('session-1', actor as any);

    expect(result).toEqual({
      sessionId: 'session-1',
      teams: [
        {
          teamId: 'team-a',
          teamName: null,
          tag: 'ALP',
          totalPoints: 28,
          totalKills: 13,
          placementPoints: 0,
          wwcd: 1,
          matchesPlayed: 2,
          avgPlacement: 2,
          rank: 1,
        },
        {
          teamId: 'team-b',
          teamName: null,
          tag: 'BRV',
          totalPoints: 27,
          totalKills: 16,
          placementPoints: 0,
          wwcd: 0,
          matchesPlayed: 2,
          avgPlacement: 2,
          rank: 2,
        },
      ],
    });
    expect((prisma as any).match.findMany).toHaveBeenCalledWith({
      where: {
        sessionId: 'session-1',
        organizationId: 'org-1',
        deletedAt: null,
      },
      select: {
        id: true,
      },
    });
  });

  it('ignores tournament data when computing session standings', async () => {
    const { service } = buildService({
      matches: [{ id: 'match-session-1' }],
      slotResults: [
        {
          matchId: 'match-session-1',
          teamId: 'team-a',
          wasPresentInMatch: true,
          placement: 1,
          totalKills: 4,
          totalPoints: 14,
          points: 14,
          team: { id: 'team-a', tag: 'ALP' },
        },
        {
          matchId: 'match-tournament-1',
          teamId: 'team-a',
          wasPresentInMatch: true,
          placement: 1,
          totalKills: 30,
          totalPoints: 40,
          points: 40,
          team: { id: 'team-a', tag: 'ALP' },
        },
      ],
    });

    const result = await service.getStandings('session-1', actor as any);

    expect(result.teams).toEqual([
      {
        teamId: 'team-a',
        teamName: null,
        tag: 'ALP',
        totalPoints: 14,
        totalKills: 4,
        placementPoints: 0,
        wwcd: 1,
        matchesPlayed: 1,
        avgPlacement: 1,
        rank: 1,
      },
    ]);
  });

  it('breaks equal points by WWCD, placement points, then kills', async () => {
    const { service } = buildService({
      matches: [{ id: 'match-session-1' }],
      slotResults: [
        {
          matchId: 'match-session-1',
          teamId: 'team-kills',
          wasPresentInMatch: true,
          placement: 4,
          placementPoints: 4,
          totalKills: 16,
          totalPoints: 20,
          points: 20,
          team: { id: 'team-kills', tag: 'KIL' },
        },
        {
          matchId: 'match-session-1',
          teamId: 'team-place',
          wasPresentInMatch: true,
          placement: 2,
          placementPoints: 8,
          totalKills: 12,
          totalPoints: 20,
          points: 20,
          team: { id: 'team-place', tag: 'PLC' },
        },
        {
          matchId: 'match-session-1',
          teamId: 'team-wwcd',
          wasPresentInMatch: true,
          placement: 1,
          placementPoints: 6,
          totalKills: 14,
          totalPoints: 20,
          points: 20,
          team: { id: 'team-wwcd', tag: 'WIN' },
        },
      ],
    });

    const result = await service.getStandings('session-1', actor as any);

    expect(result.teams.map((team) => team.teamId)).toEqual([
      'team-wwcd',
      'team-place',
      'team-kills',
    ]);
  });

  it('enforces org isolation', async () => {
    const { service } = buildService({ sessionExists: false });

    await expect(
      service.getStandings('session-1', {
        ...actor,
        organizationId: 'org-2',
        actingOrgId: 'org-2',
      } as any),
    ).rejects.toThrow(NotFoundException);
  });

  it('does not count NO_SHOW slot results as played matches', async () => {
    const { prisma, service } = buildService({
      matches: [{ id: 'match-session-1' }, { id: 'match-session-2' }],
      slotResults: [
        {
          matchId: 'match-session-1',
          teamId: 'team-a',
          wasPresentInMatch: true,
          placement: 1,
          totalKills: 6,
          totalPoints: 16,
          points: 16,
          team: { id: 'team-a', tag: 'ALP' },
        },
        {
          matchId: 'match-session-2',
          teamId: 'team-a',
          wasPresentInMatch: false,
          placement: 25,
          totalKills: 12,
          totalPoints: 37,
          points: 37,
          team: { id: 'team-a', tag: 'ALP' },
        },
      ],
    });

    const result = await service.getStandings('session-1', actor as any);

    expect(result.teams).toEqual([
      {
        teamId: 'team-a',
        teamName: null,
        tag: 'ALP',
        totalPoints: 16,
        totalKills: 6,
        placementPoints: 0,
        wwcd: 1,
        matchesPlayed: 1,
        avgPlacement: 1,
        rank: 1,
      },
    ]);
    expect((prisma as any).matchSlotResult.findMany).toHaveBeenCalledWith({
      where: {
        matchId: { in: ['match-session-1', 'match-session-2'] },
        organizationId: 'org-1',
        teamId: { not: null },
        wasPresentInMatch: true,
      },
      select: {
        matchId: true,
        teamId: true,
        wasPresentInMatch: true,
        placement: true,
        placementPoints: true,
        totalKills: true,
        totalPoints: true,
        points: true,
        team: {
          select: {
            id: true,
            name: true,
            tag: true,
          },
        },
      },
    });
  });
});
