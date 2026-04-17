import { Role, TeamMemberRole } from '@prisma/client';
import type { PrismaService } from '../../db/prisma.service';
import type { AuthUser } from '../../common/auth/auth.types';
import { TeamsApiService } from './teams.api.service';
import { BroadcastGateway } from '../overlay/broadcast.gateway';

type TeamRecord = {
  id: string;
  name: string;
  tag: string | null;
  gameId: string | null;
  region: string | null;
  countryCode: string | null;
  logoUrl: string | null;
  logoLightUrl: string | null;
  accentLight: string | null;
  textOnLight: string | null;
  logoDarkUrl: string | null;
  accentDark: string | null;
  textOnDark: string | null;
  organizationId: string;
  ownerUserId: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
};

type TeamMemberRecord = {
  id: string;
  teamId: string;
  organizationId: string;
  discordUserId: string;
  discordUsername: string | null;
  displayName: string | null;
  role: TeamMemberRole;
  createdAt: Date;
  updatedAt: Date;
  leftAt: Date | null;
  deletedAt: Date | null;
};

const organizer = (organizationId: string): AuthUser =>
  ({
    id: `user-${organizationId}`,
    actorId: `user-${organizationId}`,
    role: Role.ORGANIZER,
    actorRole: Role.ORGANIZER,
    organizationId,
    orgId: organizationId,
    actingOrgId: null,
  }) as AuthUser;

class MockTeamDelegate {
  constructor(private readonly teams: TeamRecord[]) {}

  findFirst(params: { where: Record<string, unknown> }) {
    const where = params.where;
    const team =
      this.teams.find((entry) => {
        if (where.id && entry.id !== where.id) return false;
        if (
          where.organizationId &&
          entry.organizationId !== where.organizationId
        )
          return false;
        if (where.tag && entry.tag !== where.tag) return false;
        if (Object.prototype.hasOwnProperty.call(where, 'deletedAt')) {
          if (where.deletedAt === null && entry.deletedAt !== null)
            return false;
        }
        return true;
      }) ?? null;

    return Promise.resolve(team);
  }

  create(params: { data: Record<string, unknown> }) {
    const now = new Date();
    const record: TeamRecord = {
      id: `team-${this.teams.length + 1}`,
      name: String(params.data.name),
      tag: (params.data.tag as string | null | undefined) ?? null,
      gameId: null,
      region: null,
      countryCode: null,
      logoUrl: null,
      logoLightUrl: null,
      accentLight: null,
      textOnLight: null,
      logoDarkUrl: null,
      accentDark: null,
      textOnDark: null,
      organizationId: String(params.data.organizationId),
      ownerUserId: String(params.data.ownerUserId),
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    this.teams.push(record);
    return Promise.resolve(record);
  }
}

class MockTeamMemberDelegate {
  constructor(
    private readonly members: TeamMemberRecord[],
    private readonly teams: TeamRecord[],
  ) {}

  findFirst(params: { where: Record<string, unknown> }) {
    const where = params.where;
    const member =
      this.members.find((entry) => {
        if (where.teamId && entry.teamId !== where.teamId) return false;
        if (where.role && entry.role !== where.role) return false;
        if (Object.prototype.hasOwnProperty.call(where, 'deletedAt')) {
          if (where.deletedAt === null && entry.deletedAt !== null)
            return false;
        }
        if (Object.prototype.hasOwnProperty.call(where, 'leftAt')) {
          if (where.leftAt === null && entry.leftAt !== null) return false;
        }
        return true;
      }) ?? null;

    return Promise.resolve(member);
  }

  findMany(params: {
    where: Record<string, unknown>;
    orderBy?: Array<Record<string, 'asc' | 'desc'>>;
  }) {
    const where = params.where;
    let result = this.members.filter((entry) => {
      if (where.teamId && entry.teamId !== where.teamId) return false;
      if (where.organizationId && entry.organizationId !== where.organizationId)
        return false;
      if (Object.prototype.hasOwnProperty.call(where, 'deletedAt')) {
        if (where.deletedAt === null && entry.deletedAt !== null) return false;
      }
      if (Object.prototype.hasOwnProperty.call(where, 'leftAt')) {
        if (where.leftAt === null && entry.leftAt !== null) return false;
      }
      if (
        where.discordUserId &&
        typeof where.discordUserId === 'object' &&
        where.discordUserId !== null &&
        'in' in where.discordUserId
      ) {
        const values = (where.discordUserId as { in: string[] }).in;
        if (!values.includes(entry.discordUserId)) return false;
      }
      if (
        where.NOT &&
        typeof where.NOT === 'object' &&
        where.NOT !== null &&
        'teamId' in where.NOT &&
        entry.teamId === (where.NOT as { teamId: string }).teamId
      ) {
        return false;
      }
      return true;
    });

    if (params.orderBy?.length) {
      result = result.slice().sort((left, right) => {
        if (left.role !== right.role) {
          return left.role.localeCompare(right.role);
        }
        return left.createdAt.getTime() - right.createdAt.getTime();
      });
    }

    if (
      where.NOT &&
      typeof where.NOT === 'object' &&
      where.NOT !== null &&
      'teamId' in where.NOT
    ) {
      return Promise.resolve(
        result.map((entry) => ({
          discordUserId: entry.discordUserId,
          team: this.teams.find((team) => team.id === entry.teamId) ?? {
            id: entry.teamId,
            tag: null,
            name: 'Unknown',
          },
        })),
      );
    }

    return Promise.resolve(result);
  }

  upsert(params: {
    where: { teamId_discordUserId: { teamId: string; discordUserId: string } };
    update: Partial<TeamMemberRecord>;
    create: Omit<TeamMemberRecord, 'id' | 'createdAt' | 'updatedAt'>;
  }) {
    const { teamId, discordUserId } = params.where.teamId_discordUserId;
    const existingIndex = this.members.findIndex(
      (entry) =>
        entry.teamId === teamId && entry.discordUserId === discordUserId,
    );
    const now = new Date();

    if (existingIndex >= 0) {
      const updated = {
        ...this.members[existingIndex],
        ...params.update,
        updatedAt: now,
      };
      this.members[existingIndex] = updated;
      return Promise.resolve(updated);
    }

    const created: TeamMemberRecord = {
      id: `member-${this.members.length + 1}`,
      createdAt: now,
      updatedAt: now,
      ...params.create,
    };
    this.members.push(created);
    return Promise.resolve(created);
  }
}

const makeService = (
  initial: {
    teams?: TeamRecord[];
    members?: TeamMemberRecord[];
  } = {},
) => {
  const teams = initial.teams ? [...initial.teams] : [];
  const members = initial.members ? [...initial.members] : [];
  const teamDelegate = new MockTeamDelegate(teams);
  const teamMemberDelegate = new MockTeamMemberDelegate(members, teams);
  const prisma = {
    team: teamDelegate,
    teamMember: teamMemberDelegate,
    $transaction: async <T>(callback: (tx: PrismaService) => Promise<T>) =>
      callback(prisma as unknown as PrismaService),
  } as unknown as PrismaService;
  const broadcast = {
    emitTeamBrandUpdated: jest.fn(),
  } as unknown as BroadcastGateway;
  return {
    service: new TeamsApiService(prisma, broadcast),
    teams,
    members,
  };
};

describe('TeamsApiService discord registration', () => {
  it('creates a new team with leader and players', async () => {
    const { service, teams, members } = makeService();

    const result = await service.registerDiscordTeam(organizer('org-1'), {
      name: 'DXB Esports',
      tag: ' dxb ',
      leaderDiscordUserId: '1001',
      leaderDiscordUsername: 'captain',
      members: [
        { discordUserId: '1002', discordUsername: 'player-1' },
        { discordUserId: '1003', discordUsername: 'player-2' },
      ],
    });

    expect(result.created).toBe(true);
    expect(result.team.tag).toBe('DXB');
    expect(teams).toHaveLength(1);
    expect(members).toHaveLength(3);
    expect(
      members.find((member) => member.discordUserId === '1001')?.role,
    ).toBe(TeamMemberRole.LEADER);
  });

  it('reuses an existing team with the same leader and adds new players', async () => {
    const now = new Date();
    const { service, teams, members } = makeService({
      teams: [
        {
          id: '11111111-1111-1111-1111-111111111111',
          name: 'DXB Esports',
          tag: 'DXB',
          gameId: null,
          region: null,
          countryCode: null,
          logoUrl: null,
          logoLightUrl: null,
          accentLight: null,
          textOnLight: null,
          logoDarkUrl: null,
          accentDark: null,
          textOnDark: null,
          organizationId: 'org-1',
          ownerUserId: 'user-org-1',
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        },
      ],
      members: [
        {
          id: 'member-1',
          teamId: '11111111-1111-1111-1111-111111111111',
          organizationId: 'org-1',
          discordUserId: '1001',
          discordUsername: 'captain',
          displayName: null,
          role: TeamMemberRole.LEADER,
          createdAt: now,
          updatedAt: now,
          leftAt: null,
          deletedAt: null,
        },
      ],
    });

    const result = await service.registerDiscordTeam(organizer('org-1'), {
      name: 'DXB Esports',
      tag: 'DXB',
      leaderDiscordUserId: '1001',
      members: [{ discordUserId: '1005', discordUsername: 'new-player' }],
    });

    expect(result.created).toBe(false);
    expect(teams).toHaveLength(1);
    expect(members).toHaveLength(2);
    expect(
      members.find((member) => member.discordUserId === '1005')?.role,
    ).toBe(TeamMemberRole.PLAYER);
  });

  it('rejects taking over a tag with another active leader', async () => {
    const now = new Date();
    const { service } = makeService({
      teams: [
        {
          id: '11111111-1111-1111-1111-111111111111',
          name: 'DXB Esports',
          tag: 'DXB',
          gameId: null,
          region: null,
          countryCode: null,
          logoUrl: null,
          logoLightUrl: null,
          accentLight: null,
          textOnLight: null,
          logoDarkUrl: null,
          accentDark: null,
          textOnDark: null,
          organizationId: 'org-1',
          ownerUserId: 'user-org-1',
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        },
      ],
      members: [
        {
          id: 'member-1',
          teamId: '11111111-1111-1111-1111-111111111111',
          organizationId: 'org-1',
          discordUserId: '9999',
          discordUsername: 'other-leader',
          displayName: null,
          role: TeamMemberRole.LEADER,
          createdAt: now,
          updatedAt: now,
          leftAt: null,
          deletedAt: null,
        },
      ],
    });

    await expect(
      service.registerDiscordTeam(organizer('org-1'), {
        name: 'DXB Esports',
        tag: 'DXB',
        leaderDiscordUserId: '1001',
      }),
    ).rejects.toThrow('already registered to another leader');
  });

  it('rejects when a mentioned Discord user already belongs to another team in the same org', async () => {
    const now = new Date();
    const { service } = makeService({
      teams: [
        {
          id: '11111111-1111-1111-1111-111111111111',
          name: 'DXB Esports',
          tag: 'DXB',
          gameId: null,
          region: null,
          countryCode: null,
          logoUrl: null,
          logoLightUrl: null,
          accentLight: null,
          textOnLight: null,
          logoDarkUrl: null,
          accentDark: null,
          textOnDark: null,
          organizationId: 'org-1',
          ownerUserId: 'user-org-1',
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        },
        {
          id: 'team-2',
          name: 'NXT Esports',
          tag: 'NXT',
          gameId: null,
          region: null,
          countryCode: null,
          logoUrl: null,
          logoLightUrl: null,
          accentLight: null,
          textOnLight: null,
          logoDarkUrl: null,
          accentDark: null,
          textOnDark: null,
          organizationId: 'org-1',
          ownerUserId: 'user-org-1',
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        },
      ],
      members: [
        {
          id: 'member-1',
          teamId: 'team-2',
          organizationId: 'org-1',
          discordUserId: '1002',
          discordUsername: 'player-1',
          displayName: null,
          role: TeamMemberRole.PLAYER,
          createdAt: now,
          updatedAt: now,
          leftAt: null,
          deletedAt: null,
        },
      ],
    });

    await expect(
      service.registerDiscordTeam(organizer('org-1'), {
        name: 'DXB Esports',
        tag: 'DXB',
        leaderDiscordUserId: '1001',
        members: [{ discordUserId: '1002', discordUsername: 'player-1' }],
      }),
    ).rejects.toThrow('already belongs to');
  });

  it('gets a team by normalized tag and lists members', async () => {
    const now = new Date();
    const { service } = makeService({
      teams: [
        {
          id: '11111111-1111-1111-1111-111111111111',
          name: 'DXB Esports',
          tag: 'DXB',
          gameId: null,
          region: null,
          countryCode: null,
          logoUrl: null,
          logoLightUrl: null,
          accentLight: null,
          textOnLight: null,
          logoDarkUrl: null,
          accentDark: null,
          textOnDark: null,
          organizationId: 'org-1',
          ownerUserId: 'user-org-1',
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        },
      ],
      members: [
        {
          id: 'member-1',
          teamId: '11111111-1111-1111-1111-111111111111',
          organizationId: 'org-1',
          discordUserId: '1001',
          discordUsername: 'captain',
          displayName: null,
          role: TeamMemberRole.LEADER,
          createdAt: now,
          updatedAt: now,
          leftAt: null,
          deletedAt: null,
        },
      ],
    });

    const team = await service.getByTag(organizer('org-1'), ' d x b ');
    const listedMembers = await service.listMembers(
      organizer('org-1'),
      team.id,
    );

    expect(team.id).toBe('11111111-1111-1111-1111-111111111111');
    expect(listedMembers).toHaveLength(1);
    expect(listedMembers[0].role).toBe(TeamMemberRole.LEADER);
  });
});
