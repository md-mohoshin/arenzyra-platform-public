import { TeamBanScope } from '@prisma/client';
import { TeamBansService } from './team-bans.service';

const actor = {
  id: 'user-1',
  actorId: 'user-1',
  organizationId: 'org-1',
} as any;

function teamBanRecord(teamId: string) {
  return {
    id: `ban-${teamId}`,
    organizationId: 'org-1',
    teamId,
    scope: TeamBanScope.SESSION,
    sessionId: 'session-1',
    matchId: null,
    reason: 'No-show',
    note: 'Created from test',
    expiresAt: null,
    revokedAt: null,
    revokeReason: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    team: {
      id: teamId,
      name: teamId === 'team-a' ? 'DXB' : 'NXT',
      tag: teamId === 'team-a' ? 'DXB' : 'NXT',
      logoUrl: null,
    },
    session: { id: 'session-1', name: 'Scrim', status: 'LIVE' },
    match: null,
    createdBy: { id: 'user-1', name: 'User', email: 'user@example.com' },
    revokedBy: null,
  };
}

function createPrismaMock() {
  const teamA = { id: 'team-a', name: 'DXB', tag: 'DXB', logoUrl: null };
  const teamB = { id: 'team-b', name: 'NXT', tag: 'NXT', logoUrl: null };
  return {
    session: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'session-1',
        name: 'Scrim',
        status: 'LIVE',
        discordConfig: { id: 'discord-config-1' },
      }),
    },
    matchSlotResult: {
      findMany: jest.fn().mockResolvedValue([
        {
          teamId: 'team-a',
          slotNumber: 3,
          team: teamA,
          match: { id: 'match-1', matchNumber: 1, name: 'Game 1' },
        },
        {
          teamId: 'team-a',
          slotNumber: 3,
          team: teamA,
          match: { id: 'match-2', matchNumber: 2, name: 'Game 2' },
        },
        {
          teamId: 'team-b',
          slotNumber: 4,
          team: teamB,
          match: { id: 'match-2', matchNumber: 2, name: 'Game 2' },
        },
      ]),
    },
    noShowBanSnapshot: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
    },
    team: {
      findFirst: jest
        .fn()
        .mockImplementation(({ where }) =>
          Promise.resolve(
            where.id === 'team-a'
              ? { id: 'team-a' }
              : where.id === 'team-b'
                ? { id: 'team-b' }
                : null,
          ),
        ),
      findMany: jest.fn().mockResolvedValue([]),
    },
    teamMember: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    sessionRegistration: {
      findFirst: jest.fn().mockImplementation(({ where }) =>
        Promise.resolve(
          where.teamId === 'team-a'
            ? {
                leaderDiscordUserId: '111111111111111111',
                managerDiscordUserIds: ['222222222222222222'],
              }
            : {
                leaderDiscordUserId: '333333333333333333',
                managerDiscordUserIds: ['444444444444444444'],
              },
        ),
      ),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({}),
    },
    teamBan: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest
        .fn()
        .mockImplementation(({ data }) =>
          Promise.resolve(teamBanRecord(data.teamId)),
        ),
    },
    managerBan: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
    },
    matchTeam: {
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    matchSlot: {
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
  };
}

describe('TeamBansService no-show bans', () => {
  it('aggregates session no-shows and filters selected teams and managers', async () => {
    const prisma = createPrismaMock();
    const service = new TeamBansService(prisma as any);

    const response = await service.previewNoShowBans(
      {
        sessionId: 'session-1',
        scope: TeamBanScope.SESSION,
        teamIds: ['team-a'],
        managerDiscordUserIds: ['222222222222222222'],
      },
      actor,
    );

    expect(response.match.id).toBe('session:session-1:no-shows');
    expect(response.noShowCount).toBe(1);
    expect(response.creatableCount).toBe(1);
    expect(response.teams[0].teamId).toBe('team-a');
    expect(response.teams[0].missedMatches).toEqual([
      {
        matchId: 'match-1',
        matchNumber: 1,
        matchName: 'Game 1',
        slotNumber: 3,
      },
      {
        matchId: 'match-2',
        matchNumber: 2,
        matchName: 'Game 2',
        slotNumber: 3,
      },
    ]);
    expect(response.teams[0].managers).toEqual([
      {
        discordUserId: '222222222222222222',
        discordUsername: null,
        displayName: null,
      },
    ]);
  });

  it('creates bans only for selected no-show teams and selected managers', async () => {
    const prisma = createPrismaMock();
    const service = new TeamBansService(prisma as any);

    const response = await service.createNoShowBans(
      {
        sessionId: 'session-1',
        scope: TeamBanScope.SESSION,
        reason: 'No-show',
        note: 'Created from test',
        teamIds: ['team-a'],
        managerDiscordUserIds: ['222222222222222222'],
      },
      actor,
    );

    expect(response.createdCount).toBe(1);
    expect(response.createdManagerBans).toBe(1);
    expect(prisma.teamBan.create).toHaveBeenCalledTimes(1);
    expect(prisma.teamBan.create.mock.calls[0][0].data.teamId).toBe('team-a');
    expect(prisma.managerBan.create).toHaveBeenCalledTimes(1);
    expect(prisma.managerBan.create.mock.calls[0][0].data.discordUserId).toBe(
      '222222222222222222',
    );
    expect(prisma.sessionRegistration.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          sessionId: 'session-1',
          teamId: 'team-a',
        }),
      }),
    );
  });
});
