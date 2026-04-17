import { NotFoundException } from '@nestjs/common';
import { MatchStatus, Role } from '@prisma/client';
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

  it('aggregates session standings from ended session matches only', async () => {
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
      ],
    });

    const result = await service.getStandings('session-1', actor as any);

    expect(result).toEqual({
      sessionId: 'session-1',
      teams: [
        {
          teamId: 'team-a',
          tag: 'ALP',
          totalPoints: 28,
          totalKills: 13,
          matchesPlayed: 2,
          avgPlacement: 2,
          rank: 1,
        },
        {
          teamId: 'team-b',
          tag: 'BRV',
          totalPoints: 27,
          totalKills: 16,
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
        status: {
          in: [MatchStatus.FINISHED, MatchStatus.ENDED],
        },
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
        tag: 'ALP',
        totalPoints: 14,
        totalKills: 4,
        matchesPlayed: 1,
        avgPlacement: 1,
        rank: 1,
      },
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
        tag: 'ALP',
        totalPoints: 16,
        totalKills: 6,
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
        totalKills: true,
        totalPoints: true,
        points: true,
        team: {
          select: {
            id: true,
            tag: true,
          },
        },
      },
    });
  });
});
