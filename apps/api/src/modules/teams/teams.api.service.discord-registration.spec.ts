import {
  Role,
  SessionRegistrationStatus,
  TeamMemberRole,
} from '@prisma/client';
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

type SessionRecord = {
  id: string;
  organizationId: string;
  deletedAt: Date | null;
  discordConfig?: {
    maxTeamsPerManager: number;
  } | null;
};

type SessionRegistrationRecord = {
  id: string;
  organizationId: string;
  sessionId: string;
  teamId: string;
  status: SessionRegistrationStatus;
  deletedAt: Date | null;
};

type TournamentTeamRecord = {
  id: string;
  tournamentId: string;
  teamId: string;
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

  private matchesWhere(entry: TeamRecord, where: Record<string, unknown>) {
    if (where.id && entry.id !== where.id) return false;
    if (where.organizationId && entry.organizationId !== where.organizationId) {
      return false;
    }
    if (where.name) {
      const expectedValue =
        typeof where.name === 'object' &&
        where.name !== null &&
        'equals' in where.name
          ? (where.name as { equals?: unknown }).equals
          : where.name;
      if (typeof expectedValue !== 'string') return false;
      const insensitive =
        typeof where.name === 'object' &&
        where.name !== null &&
        'mode' in where.name &&
        (where.name as { mode?: string }).mode === 'insensitive';
      if (
        insensitive
          ? entry.name.toLowerCase() !== expectedValue.toLowerCase()
          : entry.name !== expectedValue
      ) {
        return false;
      }
    }
    if (where.tag) {
      const expectedValue =
        typeof where.tag === 'object' &&
        where.tag !== null &&
        'equals' in where.tag
          ? (where.tag as { equals?: unknown }).equals
          : where.tag;
      if (typeof expectedValue !== 'string') return false;
      const expected = expectedValue;
      const insensitive =
        typeof where.tag === 'object' &&
        where.tag !== null &&
        'mode' in where.tag &&
        (where.tag as { mode?: string }).mode === 'insensitive';
      const actual = entry.tag ?? '';
      if (
        insensitive
          ? actual.toLowerCase() !== expected.toLowerCase()
          : actual !== expected
      ) {
        return false;
      }
    }
    if (Object.prototype.hasOwnProperty.call(where, 'deletedAt')) {
      if (where.deletedAt === null && entry.deletedAt !== null) return false;
    }
    return true;
  }

  findFirst(params: { where: Record<string, unknown> }) {
    const where = params.where;
    const team =
      this.teams.find((entry) => this.matchesWhere(entry, where)) ?? null;

    return Promise.resolve(team);
  }

  findMany(params: { where: Record<string, unknown> }) {
    return Promise.resolve(
      this.teams.filter((entry) => this.matchesWhere(entry, params.where)),
    );
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
      logoUrl: (params.data.logoUrl as string | null | undefined) ?? null,
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

  update(params: { where: { id: string }; data: Partial<TeamRecord> }) {
    const index = this.teams.findIndex((entry) => entry.id === params.where.id);
    if (index < 0) {
      return Promise.resolve(null);
    }
    const updated = {
      ...this.teams[index],
      ...params.data,
      updatedAt: new Date(),
    };
    this.teams[index] = updated;
    return Promise.resolve(updated);
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
      if (typeof where.teamId === 'string' && entry.teamId !== where.teamId)
        return false;
      if (
        where.teamId &&
        typeof where.teamId === 'object' &&
        where.teamId !== null &&
        'in' in where.teamId
      ) {
        const values = (where.teamId as { in: string[] }).in;
        if (!values.includes(entry.teamId)) return false;
      }
      if (
        where.teamId &&
        typeof where.teamId === 'object' &&
        where.teamId !== null &&
        'notIn' in where.teamId
      ) {
        const values = (where.teamId as { notIn: string[] }).notIn;
        if (values.includes(entry.teamId)) return false;
      }
      if (where.organizationId && entry.organizationId !== where.organizationId)
        return false;
      if (
        where.team &&
        typeof where.team === 'object' &&
        where.team !== null &&
        'deletedAt' in where.team
      ) {
        const team = this.teams.find(
          (candidate) => candidate.id === entry.teamId,
        );
        if (!team) return false;
        if ((where.team as { deletedAt?: null }).deletedAt === null) {
          if (team.deletedAt !== null) return false;
        }
      }
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
      leftAt: null,
      deletedAt: null,
      ...params.create,
    };
    this.members.push(created);
    return Promise.resolve(created);
  }

  updateMany(params: {
    where: Record<string, unknown>;
    data: Partial<TeamMemberRecord>;
  }) {
    const where = params.where;
    let count = 0;
    for (const [index, entry] of this.members.entries()) {
      if (typeof where.teamId === 'string' && entry.teamId !== where.teamId)
        continue;
      if (
        where.teamId &&
        typeof where.teamId === 'object' &&
        where.teamId !== null &&
        'in' in where.teamId
      ) {
        const values = (where.teamId as { in: string[] }).in;
        if (!values.includes(entry.teamId)) continue;
      }
      if (
        where.teamId &&
        typeof where.teamId === 'object' &&
        where.teamId !== null &&
        'notIn' in where.teamId
      ) {
        const values = (where.teamId as { notIn: string[] }).notIn;
        if (values.includes(entry.teamId)) continue;
      }
      if (where.organizationId && entry.organizationId !== where.organizationId)
        continue;
      if (where.role && entry.role !== where.role) continue;
      if (Object.prototype.hasOwnProperty.call(where, 'deletedAt')) {
        if (where.deletedAt === null && entry.deletedAt !== null) continue;
      }
      if (Object.prototype.hasOwnProperty.call(where, 'leftAt')) {
        if (where.leftAt === null && entry.leftAt !== null) continue;
      }
      if (
        where.discordUserId &&
        typeof where.discordUserId === 'object' &&
        where.discordUserId !== null &&
        'in' in where.discordUserId
      ) {
        const values = (where.discordUserId as { in: string[] }).in;
        if (!values.includes(entry.discordUserId)) continue;
      }
      if (
        where.discordUserId &&
        typeof where.discordUserId === 'object' &&
        where.discordUserId !== null &&
        'notIn' in where.discordUserId
      ) {
        const values = (where.discordUserId as { notIn: string[] }).notIn;
        if (values.includes(entry.discordUserId)) continue;
      }
      if (
        where.NOT &&
        typeof where.NOT === 'object' &&
        where.NOT !== null &&
        'teamId' in where.NOT &&
        entry.teamId === (where.NOT as { teamId: string }).teamId
      ) {
        continue;
      }
      this.members[index] = {
        ...entry,
        ...params.data,
        updatedAt: new Date(),
      };
      count += 1;
    }
    return Promise.resolve({ count });
  }
}

class MockSessionDelegate {
  constructor(private readonly sessions: SessionRecord[]) {}

  findFirst(params: { where: Record<string, unknown> }) {
    const where = params.where;
    const session =
      this.sessions.find((entry) => {
        if (where.id && entry.id !== where.id) return false;
        if (
          where.organizationId &&
          entry.organizationId !== where.organizationId
        )
          return false;
        if (Object.prototype.hasOwnProperty.call(where, 'deletedAt')) {
          if (where.deletedAt === null && entry.deletedAt !== null)
            return false;
        }
        return true;
      }) ?? null;
    return Promise.resolve(session);
  }
}

class MockSessionRegistrationDelegate {
  constructor(
    private readonly registrations: SessionRegistrationRecord[],
    private readonly teams: TeamRecord[],
  ) {}

  private matchesWhere(
    entry: SessionRegistrationRecord,
    where: Record<string, unknown>,
  ) {
    if (where.organizationId && entry.organizationId !== where.organizationId)
      return false;
    if (where.sessionId && entry.sessionId !== where.sessionId) return false;
    if (where.teamId) {
      if (typeof where.teamId === 'string' && entry.teamId !== where.teamId) {
        return false;
      }
      if (
        typeof where.teamId === 'object' &&
        where.teamId !== null &&
        'in' in where.teamId
      ) {
        const values = (where.teamId as { in: string[] }).in;
        if (!values.includes(entry.teamId)) return false;
      }
    }
    if (Object.prototype.hasOwnProperty.call(where, 'deletedAt')) {
      if (where.deletedAt === null && entry.deletedAt !== null) return false;
    }
    if (
      where.team &&
      typeof where.team === 'object' &&
      where.team !== null &&
      'deletedAt' in where.team
    ) {
      const team = this.teams.find(
        (candidate) => candidate.id === entry.teamId,
      );
      if (!team) return false;
      if ((where.team as { deletedAt?: null }).deletedAt === null) {
        if (team.deletedAt !== null) return false;
      }
    }
    if (
      where.status &&
      typeof where.status === 'object' &&
      where.status !== null &&
      'notIn' in where.status
    ) {
      const values = (where.status as { notIn: SessionRegistrationStatus[] })
        .notIn;
      if (values.includes(entry.status)) return false;
    }
    return true;
  }

  findFirst(params: { where: Record<string, unknown> }) {
    return Promise.resolve(
      this.registrations.find((entry) =>
        this.matchesWhere(entry, params.where),
      ) ?? null,
    );
  }

  findMany(params: { where: Record<string, unknown> }) {
    const result = this.registrations.filter((entry) =>
      this.matchesWhere(entry, params.where),
    );
    return Promise.resolve(result);
  }
}

class MockTournamentTeamDelegate {
  constructor(private readonly tournamentTeams: TournamentTeamRecord[]) {}

  findMany(params: { where: Record<string, unknown> }) {
    const where = params.where;
    const result = this.tournamentTeams.filter((entry) => {
      if (
        where.teamId &&
        typeof where.teamId === 'object' &&
        where.teamId !== null &&
        'in' in where.teamId
      ) {
        const values = (where.teamId as { in: string[] }).in;
        if (!values.includes(entry.teamId)) return false;
      }
      if (Object.prototype.hasOwnProperty.call(where, 'deletedAt')) {
        if (where.deletedAt === null && entry.deletedAt !== null) return false;
      }
      return true;
    });
    return Promise.resolve(result);
  }
}

const makeService = (
  initial: {
    teams?: TeamRecord[];
    members?: TeamMemberRecord[];
    sessions?: SessionRecord[];
    registrations?: SessionRegistrationRecord[];
    tournamentTeams?: TournamentTeamRecord[];
  } = {},
) => {
  const teams = initial.teams ? [...initial.teams] : [];
  const members = initial.members ? [...initial.members] : [];
  const sessions = initial.sessions ? [...initial.sessions] : [];
  const registrations = initial.registrations ? [...initial.registrations] : [];
  const tournamentTeams = initial.tournamentTeams
    ? [...initial.tournamentTeams]
    : [];
  const teamDelegate = new MockTeamDelegate(teams);
  const teamMemberDelegate = new MockTeamMemberDelegate(members, teams);
  const prisma = {
    team: teamDelegate,
    teamMember: teamMemberDelegate,
    session: new MockSessionDelegate(sessions),
    sessionRegistration: new MockSessionRegistrationDelegate(
      registrations,
      teams,
    ),
    tournamentTeam: new MockTournamentTeamDelegate(tournamentTeams),
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
    sessions,
    registrations,
    tournamentTeams,
  };
};

describe('TeamsApiService discord registration', () => {
  it('creates a new team with leader and players', async () => {
    const { service, teams, members } = makeService();

    const result = await service.registerDiscordTeam(organizer('org-1'), {
      name: 'DXB Esports',
      tag: ' dxb ',
      logoUrl: 'https://cdn.discordapp.com/team-dxb.png',
      leaderDiscordUserId: '1001',
      leaderDiscordUsername: 'captain',
      members: [
        { discordUserId: '1002', discordUsername: 'player-1' },
        { discordUserId: '1003', discordUsername: 'player-2' },
      ],
    });

    expect(result.created).toBe(true);
    expect(result.team.tag?.toLowerCase()).toBe('dxb');
    expect(result.team.logoUrl).toBe('https://cdn.discordapp.com/team-dxb.png');
    expect(teams).toHaveLength(1);
    expect(teams[0].logoUrl).toBe('https://cdn.discordapp.com/team-dxb.png');
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
      logoUrl: 'https://cdn.discordapp.com/updated-dxb.png',
      leaderDiscordUserId: '1001',
      members: [{ discordUserId: '1005', discordUsername: 'new-player' }],
    });

    expect(result.created).toBe(false);
    expect(teams).toHaveLength(1);
    expect(teams[0].logoUrl).toBe('https://cdn.discordapp.com/updated-dxb.png');
    expect(members).toHaveLength(2);
    expect(
      members.find((member) => member.discordUserId === '1005')?.role,
    ).toBe(TeamMemberRole.PLAYER);
  });

  it('creates a different team when another team already uses the same tag', async () => {
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

    const result = await service.registerDiscordTeam(organizer('org-1'), {
      name: 'DXB Academy',
      tag: 'DXB',
      leaderDiscordUserId: '1001',
    });

    expect(result.created).toBe(true);
    expect(result.team.name).toBe('DXB Academy');
    expect(result.team.tag).toBe('DXB');
    expect(result.team.id).not.toBe('11111111-1111-1111-1111-111111111111');
    expect(teams).toHaveLength(2);
    expect(
      members.find(
        (member) =>
          member.teamId === result.team.id &&
          member.discordUserId === '1001' &&
          member.role === TeamMemberRole.LEADER,
      ),
    ).toBeTruthy();
  });

  it('creates a different team when the same manager uses the same name with a different tag below the session limit', async () => {
    const now = new Date();
    const baseTeam = (id: string, name: string, tag: string): TeamRecord => ({
      id,
      name,
      tag,
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
    });
    const { service, teams, members } = makeService({
      teams: [baseTeam('old-team', 'DXB Esports', 'DXB')],
      members: [
        {
          id: 'member-1',
          teamId: 'old-team',
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
      sessions: [
        {
          id: 'session-1',
          organizationId: 'org-1',
          deletedAt: null,
          discordConfig: { maxTeamsPerManager: 2 },
        },
      ],
      registrations: [
        {
          id: 'registration-1',
          organizationId: 'org-1',
          sessionId: 'session-1',
          teamId: 'old-team',
          status: SessionRegistrationStatus.CONFIRMED,
          deletedAt: null,
        },
      ],
    });

    const result = await service.registerDiscordTeam(organizer('org-1'), {
      name: 'DXB Esports',
      tag: 'DX2',
      leaderDiscordUserId: '1001',
      leaderDiscordUsername: 'captain',
      allowDiscordMemberTransfer: true,
      contextSessionId: 'session-1',
    });

    expect(result.created).toBe(true);
    expect(result.team.name).toBe('DXB Esports');
    expect(result.team.tag).toBe('DX2');
    expect(result.team.id).not.toBe('old-team');
    expect(teams).toHaveLength(2);
    expect(
      members.find((member) => member.id === 'member-1')?.leftAt,
    ).toBeNull();
    expect(
      members.find(
        (member) =>
          member.teamId === result.team.id &&
          member.discordUserId === '1001' &&
          member.role === TeamMemberRole.LEADER &&
          member.leftAt === null,
      ),
    ).toBeTruthy();
  });

  it('reuses an existing team when a different leader registers it again', async () => {
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

    const result = await service.registerDiscordTeam(organizer('org-1'), {
      name: 'DXB Esports',
      tag: 'DXB',
      leaderDiscordUserId: '1001',
      leaderDiscordUsername: 'new-leader',
    });

    expect(result.created).toBe(false);
    expect(result.team.id).toBe('11111111-1111-1111-1111-111111111111');
    expect(teams).toHaveLength(1);
    expect(
      members.find(
        (member) =>
          member.teamId === result.team.id &&
          member.discordUserId === '9999' &&
          member.role === TeamMemberRole.LEADER &&
          member.leftAt === null,
      ),
    ).toBeTruthy();
    expect(
      members.find(
        (member) =>
          member.teamId === result.team.id &&
          member.discordUserId === '1001' &&
          member.discordUsername === 'new-leader' &&
          member.role === TeamMemberRole.LEADER &&
          member.leftAt === null,
      ),
    ).toBeTruthy();
  });

  it('replaces active managers with mentioned managers for a new scrim registration context', async () => {
    const now = new Date();
    const { service, members } = makeService({
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
          discordUsername: 'old-leader',
          displayName: null,
          role: TeamMemberRole.LEADER,
          createdAt: now,
          updatedAt: now,
          leftAt: null,
          deletedAt: null,
        },
      ],
      sessions: [{ id: 'session-1', organizationId: 'org-1', deletedAt: null }],
    });

    const result = await service.registerDiscordTeam(organizer('org-1'), {
      name: 'DXB Esports',
      tag: 'DXB',
      leaderDiscordUserId: '1001',
      leaderDiscordUsername: 'requester',
      allowDiscordMemberTransfer: true,
      contextSessionId: 'session-1',
      members: [
        {
          discordUserId: '1002',
          discordUsername: 'mentioned-manager',
          role: TeamMemberRole.LEADER,
        },
      ],
    });

    expect(result.created).toBe(false);
    expect(
      members.find((member) => member.discordUserId === '9999')?.leftAt,
    ).toBeInstanceOf(Date);
    expect(
      members.find(
        (member) =>
          member.teamId === result.team.id &&
          member.discordUserId === '1001' &&
          member.leftAt === null,
      ),
    ).toBeFalsy();
    expect(
      members.find(
        (member) =>
          member.teamId === result.team.id &&
          member.discordUserId === '1002' &&
          member.discordUsername === 'mentioned-manager' &&
          member.role === TeamMemberRole.LEADER &&
          member.leftAt === null,
      ),
    ).toBeTruthy();
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

  it('transfers a Discord member from an inactive team for a scrim context', async () => {
    const now = new Date();
    const { service, members } = makeService({
      teams: [
        {
          id: 'old-team',
          name: 'Old Team',
          tag: 'OLD',
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
          teamId: 'old-team',
          organizationId: 'org-1',
          discordUserId: '1002',
          discordUsername: 'player-1',
          displayName: null,
          role: TeamMemberRole.LEADER,
          createdAt: now,
          updatedAt: now,
          leftAt: null,
          deletedAt: null,
        },
      ],
      sessions: [{ id: 'session-1', organizationId: 'org-1', deletedAt: null }],
    });

    const result = await service.registerDiscordTeam(organizer('org-1'), {
      name: 'DXB Esports',
      tag: 'DXB',
      leaderDiscordUserId: '1002',
      allowDiscordMemberTransfer: true,
      contextSessionId: 'session-1',
    });

    expect(result.team.tag?.toLowerCase()).toBe('dxb');
    expect(
      members.find((member) => member.id === 'member-1')?.leftAt,
    ).toBeInstanceOf(Date);
    expect(
      members.find(
        (member) =>
          member.teamId === result.team.id &&
          member.discordUserId === '1002' &&
          member.leftAt === null,
      ),
    ).toBeTruthy();
  });

  it('preserves a Discord member on a team registered in another session', async () => {
    const now = new Date();
    const { service, members } = makeService({
      teams: [
        {
          id: 'tournament-team',
          name: 'Tournament Team',
          tag: 'TT',
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
          teamId: 'tournament-team',
          organizationId: 'org-1',
          discordUserId: '1002',
          discordUsername: 'manager-1',
          displayName: null,
          role: TeamMemberRole.LEADER,
          createdAt: now,
          updatedAt: now,
          leftAt: null,
          deletedAt: null,
        },
      ],
      sessions: [
        {
          id: 'scrim-session',
          organizationId: 'org-1',
          deletedAt: null,
          discordConfig: { maxTeamsPerManager: 1 },
        },
      ],
      registrations: [
        {
          id: 'registration-1',
          organizationId: 'org-1',
          sessionId: 'tournament-session',
          teamId: 'tournament-team',
          status: SessionRegistrationStatus.CONFIRMED,
          deletedAt: null,
        },
      ],
    });

    const result = await service.registerDiscordTeam(organizer('org-1'), {
      name: 'Scrim Team',
      tag: 'TT',
      leaderDiscordUserId: '1002',
      leaderDiscordUsername: 'manager-1',
      allowDiscordMemberTransfer: true,
      contextSessionId: 'scrim-session',
    });

    expect(result.team.name).toBe('Scrim Team');
    expect(
      members.find((member) => member.id === 'member-1')?.leftAt,
    ).toBeNull();
    expect(
      members.find(
        (member) =>
          member.teamId === result.team.id &&
          member.discordUserId === '1002' &&
          member.leftAt === null,
      ),
    ).toBeTruthy();
  });

  it('preserves a Discord member on an assigned tournament team', async () => {
    const now = new Date();
    const { service, members } = makeService({
      teams: [
        {
          id: 'tournament-team',
          name: 'Tournament Team',
          tag: 'TT',
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
          teamId: 'tournament-team',
          organizationId: 'org-1',
          discordUserId: '1002',
          discordUsername: 'manager-1',
          displayName: null,
          role: TeamMemberRole.LEADER,
          createdAt: now,
          updatedAt: now,
          leftAt: null,
          deletedAt: null,
        },
      ],
      sessions: [
        {
          id: 'scrim-session',
          organizationId: 'org-1',
          deletedAt: null,
          discordConfig: { maxTeamsPerManager: 1 },
        },
      ],
      tournamentTeams: [
        {
          id: 'tournament-team-row',
          tournamentId: 'tournament-1',
          teamId: 'tournament-team',
          deletedAt: null,
        },
      ],
    });

    const result = await service.registerDiscordTeam(organizer('org-1'), {
      name: 'Scrim Team',
      tag: 'TT',
      leaderDiscordUserId: '1002',
      leaderDiscordUsername: 'manager-1',
      allowDiscordMemberTransfer: true,
      contextSessionId: 'scrim-session',
    });

    expect(result.team.name).toBe('Scrim Team');
    expect(
      members.find((member) => member.id === 'member-1')?.leftAt,
    ).toBeNull();
    expect(
      members.find(
        (member) =>
          member.teamId === result.team.id &&
          member.discordUserId === '1002' &&
          member.leftAt === null,
      ),
    ).toBeTruthy();
  });

  it('does not transfer a Discord member whose old team is active in the same scrim', async () => {
    const now = new Date();
    const { service, members } = makeService({
      teams: [
        {
          id: 'old-team',
          name: 'Old Team',
          tag: 'OLD',
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
          teamId: 'old-team',
          organizationId: 'org-1',
          discordUserId: '1002',
          discordUsername: 'player-1',
          displayName: null,
          role: TeamMemberRole.LEADER,
          createdAt: now,
          updatedAt: now,
          leftAt: null,
          deletedAt: null,
        },
      ],
      sessions: [{ id: 'session-1', organizationId: 'org-1', deletedAt: null }],
      registrations: [
        {
          id: 'registration-1',
          organizationId: 'org-1',
          sessionId: 'session-1',
          teamId: 'old-team',
          status: SessionRegistrationStatus.CONFIRMED,
          deletedAt: null,
        },
      ],
    });

    await expect(
      service.registerDiscordTeam(organizer('org-1'), {
        name: 'DXB Esports',
        tag: 'DXB',
        leaderDiscordUserId: '1002',
        allowDiscordMemberTransfer: true,
        contextSessionId: 'session-1',
      }),
    ).rejects.toThrow('already belongs to');
    expect(
      members.find((member) => member.id === 'member-1')?.leftAt,
    ).toBeNull();
  });

  it('ignores deleted teams when checking same-session manager conflicts', async () => {
    const now = new Date();
    const { service, members } = makeService({
      teams: [
        {
          id: 'deleted-team',
          name: 'Deleted Team',
          tag: 'DEL',
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
          deletedAt: now,
        },
      ],
      members: [
        {
          id: 'member-1',
          teamId: 'deleted-team',
          organizationId: 'org-1',
          discordUserId: '1002',
          discordUsername: 'manager-1',
          displayName: null,
          role: TeamMemberRole.LEADER,
          createdAt: now,
          updatedAt: now,
          leftAt: null,
          deletedAt: null,
        },
      ],
      sessions: [
        {
          id: 'session-1',
          organizationId: 'org-1',
          deletedAt: null,
          discordConfig: { maxTeamsPerManager: 1 },
        },
      ],
      registrations: [
        {
          id: 'registration-1',
          organizationId: 'org-1',
          sessionId: 'session-1',
          teamId: 'deleted-team',
          status: SessionRegistrationStatus.CONFIRMED,
          deletedAt: null,
        },
      ],
    });

    const result = await service.registerDiscordTeam(organizer('org-1'), {
      name: 'New Team',
      tag: 'NEW',
      leaderDiscordUserId: '1002',
      leaderDiscordUsername: 'manager-1',
      allowDiscordMemberTransfer: true,
      contextSessionId: 'session-1',
    });

    expect(result.team.name).toBe('New Team');
    expect(
      members.find(
        (member) =>
          member.teamId === result.team.id &&
          member.discordUserId === '1002' &&
          member.leftAt === null,
      ),
    ).toBeTruthy();
  });

  it('allows a Discord manager on multiple active teams when the session config permits it', async () => {
    const now = new Date();
    const baseTeam = (id: string, name: string, tag: string): TeamRecord => ({
      id,
      name,
      tag,
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
    });
    const { service, members } = makeService({
      teams: [baseTeam('old-team', 'Old Team', 'OLD')],
      members: [
        {
          id: 'member-1',
          teamId: 'old-team',
          organizationId: 'org-1',
          discordUserId: '1002',
          discordUsername: 'manager-1',
          displayName: null,
          role: TeamMemberRole.LEADER,
          createdAt: now,
          updatedAt: now,
          leftAt: null,
          deletedAt: null,
        },
      ],
      sessions: [
        {
          id: 'session-1',
          organizationId: 'org-1',
          deletedAt: null,
          discordConfig: { maxTeamsPerManager: 2 },
        },
      ],
      registrations: [
        {
          id: 'registration-1',
          organizationId: 'org-1',
          sessionId: 'session-1',
          teamId: 'old-team',
          status: SessionRegistrationStatus.CONFIRMED,
          deletedAt: null,
        },
      ],
    });

    const result = await service.registerDiscordTeam(organizer('org-1'), {
      name: 'DXB Esports',
      tag: 'DXB',
      leaderDiscordUserId: '1002',
      leaderDiscordUsername: 'manager-1',
      allowDiscordMemberTransfer: true,
      contextSessionId: 'session-1',
    });

    expect(result.team.tag?.toLowerCase()).toBe('dxb');
    expect(
      members.find((member) => member.id === 'member-1')?.leftAt,
    ).toBeNull();
    expect(
      members.find(
        (member) =>
          member.teamId === result.team.id &&
          member.discordUserId === '1002' &&
          member.leftAt === null,
      ),
    ).toBeTruthy();
  });

  it('rejects a Discord manager once the configured team limit is reached', async () => {
    const now = new Date();
    const baseTeam = (id: string, name: string, tag: string): TeamRecord => ({
      id,
      name,
      tag,
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
    });
    const { service } = makeService({
      teams: [
        baseTeam('old-team-1', 'Old Team One', 'OLD1'),
        baseTeam('old-team-2', 'Old Team Two', 'OLD2'),
      ],
      members: [
        {
          id: 'member-1',
          teamId: 'old-team-1',
          organizationId: 'org-1',
          discordUserId: '1002',
          discordUsername: 'manager-1',
          displayName: null,
          role: TeamMemberRole.LEADER,
          createdAt: now,
          updatedAt: now,
          leftAt: null,
          deletedAt: null,
        },
        {
          id: 'member-2',
          teamId: 'old-team-2',
          organizationId: 'org-1',
          discordUserId: '1002',
          discordUsername: 'manager-1',
          displayName: null,
          role: TeamMemberRole.LEADER,
          createdAt: now,
          updatedAt: now,
          leftAt: null,
          deletedAt: null,
        },
      ],
      sessions: [
        {
          id: 'session-1',
          organizationId: 'org-1',
          deletedAt: null,
          discordConfig: { maxTeamsPerManager: 2 },
        },
      ],
      registrations: [
        {
          id: 'registration-1',
          organizationId: 'org-1',
          sessionId: 'session-1',
          teamId: 'old-team-1',
          status: SessionRegistrationStatus.CONFIRMED,
          deletedAt: null,
        },
        {
          id: 'registration-2',
          organizationId: 'org-1',
          sessionId: 'session-1',
          teamId: 'old-team-2',
          status: SessionRegistrationStatus.CONFIRMED,
          deletedAt: null,
        },
      ],
    });

    await expect(
      service.registerDiscordTeam(organizer('org-1'), {
        name: 'DXB Esports',
        tag: 'DXB',
        leaderDiscordUserId: '1002',
        leaderDiscordUsername: 'manager-1',
        allowDiscordMemberTransfer: true,
        contextSessionId: 'session-1',
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

    const team = await service.getByTag(organizer('org-1'), ' dxb ');
    const listedMembers = await service.listMembers(
      organizer('org-1'),
      team.id,
    );

    expect(team.id).toBe('11111111-1111-1111-1111-111111111111');
    expect(listedMembers).toHaveLength(1);
    expect(listedMembers[0].role).toBe(TeamMemberRole.LEADER);
  });

  it('rejects tag-only lookup when multiple teams share the tag', async () => {
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
          id: '22222222-2222-2222-2222-222222222222',
          name: 'DXB Academy',
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
    });

    await expect(service.getByTag(organizer('org-1'), 'dxb')).rejects.toThrow(
      'Multiple teams share this tag',
    );
  });

  it('releases Discord team members so a cleaned team can register again', async () => {
    const now = new Date();
    const teamId = '11111111-1111-1111-1111-111111111111';
    const { service, teams, members } = makeService({
      teams: [
        {
          id: teamId,
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
          teamId,
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

    const cleanup = await service.cleanupDiscordTeam(
      organizer('org-1'),
      teamId,
      'org-1',
    );
    const result = await service.registerDiscordTeam(organizer('org-1'), {
      name: 'DXB Esports',
      tag: 'DXB',
      leaderDiscordUserId: '1001',
    });

    expect(cleanup).toEqual({ ok: true, teamId, releasedMembers: 1 });
    expect(teams[0].deletedAt).toBeInstanceOf(Date);
    expect(members[0].leftAt).toBeInstanceOf(Date);
    expect(members[0].deletedAt).toBeInstanceOf(Date);
    expect(result.created).toBe(true);
    expect(result.team.id).not.toBe(teamId);
    expect(teams).toHaveLength(2);
  });
});
