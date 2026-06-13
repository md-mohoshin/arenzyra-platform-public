import {
  LobbyStatus,
  MatchTeamStatus,
  SessionRegistrationStatus,
  TeamBanScope,
  TeamMemberRole,
} from '@prisma/client';
import { syncMatchSlotsWithSessionRegistrations } from './session-match-slot-sync';

type RegistrationRow = {
  organizationId: string;
  sessionId: string;
  teamId: string;
  status: SessionRegistrationStatus;
  slotNumber: number | null;
  deletedAt: Date | null;
};

type MatchSlotRow = {
  id: string;
  matchId: string;
  slotNumber: number;
  teamId: string | null;
  lobbyStatus: LobbyStatus;
  playersInLobby: number;
  deletedAt: Date | null;
};

type MatchTeamRow = {
  id: string;
  matchId: string;
  teamId: string;
  slot: number | null;
  status: MatchTeamStatus;
  deletedAt: Date | null;
};

type MatchSlotResultRow = {
  id: string;
  matchId: string;
  slotNumber: number;
  teamId: string | null;
  isLocked: boolean;
  placement: number | null;
  totalKills: number;
  manualTotalKills: boolean;
  placementPoints: number;
  totalPoints: number;
  points: number;
};

type PlayerResultRow = {
  id: string;
  slotResultId: string;
};

type TeamBanRow = {
  organizationId: string;
  teamId: string;
  scope: TeamBanScope;
  sessionId: string | null;
  matchId: string | null;
  revokedAt: Date | null;
  expiresAt: Date | null;
};

type TeamMemberRow = {
  organizationId: string;
  teamId: string;
  discordUserId: string;
  role: TeamMemberRole;
  createdAt: Date;
  deletedAt: Date | null;
  leftAt: Date | null;
};

type ManagerBanRow = {
  organizationId: string;
  discordUserId: string;
  scope: TeamBanScope;
  sessionId: string | null;
  matchId: string | null;
  revokedAt: Date | null;
  expiresAt: Date | null;
};

function createPrismaMock(seed: {
  registrations: RegistrationRow[];
  matchSlots: MatchSlotRow[];
  matchTeams: MatchTeamRow[];
  matchSlotResults: MatchSlotResultRow[];
  playerResults?: PlayerResultRow[];
  teamBans?: TeamBanRow[];
  teamMembers?: TeamMemberRow[];
  managerBans?: ManagerBanRow[];
}) {
  const state = {
    registrations: [...seed.registrations],
    matchSlots: [...seed.matchSlots],
    matchTeams: [...seed.matchTeams],
    matchSlotResults: [...seed.matchSlotResults],
    playerResults: [...(seed.playerResults ?? [])],
    teamBans: [...(seed.teamBans ?? [])],
    teamMembers: [...(seed.teamMembers ?? [])],
    managerBans: [...(seed.managerBans ?? [])],
  };

  const prisma = {
    __state: state,
    sessionRegistration: {
      findMany: jest.fn(async ({ where }: { where: Record<string, any> }) =>
        state.registrations.filter((row) => {
          if (where.sessionId && row.sessionId !== where.sessionId)
            return false;
          if (
            where.organizationId &&
            row.organizationId !== where.organizationId
          ) {
            return false;
          }
          if (where.deletedAt === null && row.deletedAt !== null) return false;
          if (where.status?.in && !where.status.in.includes(row.status)) {
            return false;
          }
          if (where.slotNumber?.not === null && row.slotNumber === null) {
            return false;
          }
          return true;
        }),
      ),
    },
    teamBan: {
      findMany: jest.fn(async ({ where }: { where: Record<string, any> }) =>
        state.teamBans
          .filter((row) => {
            if (
              where.organizationId &&
              row.organizationId !== where.organizationId
            ) {
              return false;
            }
            if (where.teamId?.in && !where.teamId.in.includes(row.teamId)) {
              return false;
            }
            if (where.revokedAt === null && row.revokedAt !== null) {
              return false;
            }
            if (where.OR) {
              const now = new Date();
              const active = where.OR.some((clause: Record<string, any>) => {
                if (clause.expiresAt === null && row.expiresAt === null) {
                  return true;
                }
                if (clause.expiresAt?.gt) {
                  return row.expiresAt !== null && row.expiresAt > now;
                }
                return false;
              });
              if (!active) {
                return false;
              }
            }
            if (where.AND?.[0]?.OR) {
              return where.AND[0].OR.some((clause: Record<string, any>) => {
                if (clause.scope !== row.scope) {
                  return false;
                }
                if (clause.sessionId && clause.sessionId !== row.sessionId) {
                  return false;
                }
                if (clause.matchId && clause.matchId !== row.matchId) {
                  return false;
                }
                return true;
              });
            }
            return true;
          })
          .map((row) => ({ teamId: row.teamId })),
      ),
    },
    teamMember: {
      findMany: jest.fn(async ({ where }: { where: Record<string, any> }) =>
        state.teamMembers.filter((row) => {
          if (
            where.organizationId &&
            row.organizationId !== where.organizationId
          )
            return false;
          if (where.teamId?.in && !where.teamId.in.includes(row.teamId)) {
            return false;
          }
          if (where.deletedAt === null && row.deletedAt !== null) return false;
          if (where.leftAt === null && row.leftAt !== null) return false;
          return true;
        }),
      ),
    },
    managerBan: {
      findMany: jest.fn(async ({ where }: { where: Record<string, any> }) =>
        state.managerBans
          .filter((row) => {
            if (
              where.organizationId &&
              row.organizationId !== where.organizationId
            ) {
              return false;
            }
            if (
              where.discordUserId?.in &&
              !where.discordUserId.in.includes(row.discordUserId)
            ) {
              return false;
            }
            if (where.revokedAt === null && row.revokedAt !== null) {
              return false;
            }
            if (where.OR) {
              const now = new Date();
              const active = where.OR.some((clause: Record<string, any>) => {
                if (clause.expiresAt === null && row.expiresAt === null) {
                  return true;
                }
                if (clause.expiresAt?.gt) {
                  return row.expiresAt !== null && row.expiresAt > now;
                }
                return false;
              });
              if (!active) {
                return false;
              }
            }
            if (where.AND?.[0]?.OR) {
              return where.AND[0].OR.some((clause: Record<string, any>) => {
                if (clause.scope !== row.scope) {
                  return false;
                }
                if (clause.sessionId && clause.sessionId !== row.sessionId) {
                  return false;
                }
                if (clause.matchId && clause.matchId !== row.matchId) {
                  return false;
                }
                return true;
              });
            }
            return true;
          })
          .map((row) => ({ discordUserId: row.discordUserId })),
      ),
    },
    matchSlot: {
      findMany: jest.fn(async ({ where }: { where: Record<string, any> }) =>
        state.matchSlots.filter((row) => {
          if (where.matchId && row.matchId !== where.matchId) return false;
          if (where.OR) {
            return where.OR.some((clause: Record<string, any>) => {
              if (clause.deletedAt === null && row.deletedAt === null)
                return true;
              if (clause.slotNumber?.in?.includes(row.slotNumber)) return true;
              if (clause.teamId?.in?.includes(row.teamId)) return true;
              return false;
            });
          }
          return true;
        }),
      ),
      updateMany: jest.fn(
        async ({ where, data }: { where: any; data: any }) => {
          const ids = new Set(where.id?.in ?? []);
          let count = 0;
          for (const row of state.matchSlots) {
            if (ids.size && !ids.has(row.id)) continue;
            Object.assign(row, data);
            count += 1;
          }
          return { count };
        },
      ),
      upsert: jest.fn(async ({ where, update, create }: any) => {
        const key = where.matchId_slotNumber;
        const existing = state.matchSlots.find(
          (row) =>
            row.matchId === key.matchId && row.slotNumber === key.slotNumber,
        );
        if (existing) {
          Object.assign(existing, update);
          return existing;
        }
        const created = {
          id: `slot-${state.matchSlots.length + 1}`,
          deletedAt: null,
          ...create,
        };
        state.matchSlots.push(created);
        return created;
      }),
    },
    matchTeam: {
      findMany: jest.fn(async ({ where }: { where: Record<string, any> }) =>
        state.matchTeams.filter((row) => {
          if (where.matchId && row.matchId !== where.matchId) return false;
          if (where.OR) {
            return where.OR.some((clause: Record<string, any>) => {
              if (clause.deletedAt === null && row.deletedAt === null)
                return true;
              if (clause.slot?.in?.includes(row.slot)) return true;
              if (clause.teamId?.in?.includes(row.teamId)) return true;
              return false;
            });
          }
          return true;
        }),
      ),
      updateMany: jest.fn(
        async ({ where, data }: { where: any; data: any }) => {
          const ids = new Set(where.id?.in ?? []);
          let count = 0;
          for (const row of state.matchTeams) {
            if (ids.size && !ids.has(row.id)) continue;
            Object.assign(row, data);
            count += 1;
          }
          return { count };
        },
      ),
      upsert: jest.fn(async ({ where, update, create }: any) => {
        const key = where.matchId_teamId;
        const existing = state.matchTeams.find(
          (row) => row.matchId === key.matchId && row.teamId === key.teamId,
        );
        if (existing) {
          Object.assign(existing, update);
          return existing;
        }
        const created = {
          id: `match-team-${state.matchTeams.length + 1}`,
          deletedAt: null,
          ...create,
        };
        state.matchTeams.push(created);
        return created;
      }),
    },
    matchSlotResult: {
      findMany: jest.fn(async ({ where }: { where: Record<string, any> }) =>
        state.matchSlotResults.filter((row) => {
          if (where.matchId && row.matchId !== where.matchId) return false;
          if (
            where.slotNumber?.in &&
            !where.slotNumber.in.includes(row.slotNumber)
          ) {
            return false;
          }
          return true;
        }),
      ),
      update: jest.fn(async ({ where, data }: any) => {
        const row = state.matchSlotResults.find((item) => item.id === where.id);
        if (!row) throw new Error('slot result not found');
        Object.assign(row, data);
        return row;
      }),
    },
    matchSlotPlayerResult: {
      deleteMany: jest.fn(async ({ where }: { where: Record<string, any> }) => {
        const before = state.playerResults.length;
        state.playerResults = state.playerResults.filter(
          (row) => row.slotResultId !== where.slotResultId,
        );
        return { count: before - state.playerResults.length };
      }),
    },
    $transaction: jest.fn(async (callback: (tx: any) => unknown) =>
      callback(prisma),
    ),
  };
  return prisma;
}

test('syncMatchSlotsWithSessionRegistrations replaces stale slots and resets only changed result rows', async () => {
  const prisma = createPrismaMock({
    registrations: [
      {
        organizationId: 'org-1',
        sessionId: 'session-1',
        teamId: 'team-pst',
        status: SessionRegistrationStatus.CONFIRMED,
        slotNumber: 3,
        deletedAt: null,
      },
      {
        organizationId: 'org-1',
        sessionId: 'session-1',
        teamId: 'team-2w',
        status: SessionRegistrationStatus.CONFIRMED,
        slotNumber: 4,
        deletedAt: null,
      },
    ],
    matchSlots: [
      {
        id: 'slot-3',
        matchId: 'match-1',
        slotNumber: 3,
        teamId: 'team-tmt',
        lobbyStatus: LobbyStatus.OFFLINE,
        playersInLobby: 0,
        deletedAt: null,
      },
      {
        id: 'slot-4',
        matchId: 'match-1',
        slotNumber: 4,
        teamId: 'team-2w',
        lobbyStatus: LobbyStatus.OFFLINE,
        playersInLobby: 0,
        deletedAt: null,
      },
    ],
    matchTeams: [
      {
        id: 'mt-tmt',
        matchId: 'match-1',
        teamId: 'team-tmt',
        slot: 3,
        status: MatchTeamStatus.ACTIVE,
        deletedAt: null,
      },
      {
        id: 'mt-2w',
        matchId: 'match-1',
        teamId: 'team-2w',
        slot: 4,
        status: MatchTeamStatus.ACTIVE,
        deletedAt: null,
      },
    ],
    matchSlotResults: [
      {
        id: 'result-3',
        matchId: 'match-1',
        slotNumber: 3,
        teamId: 'team-tmt',
        isLocked: false,
        placement: 3,
        totalKills: 9,
        manualTotalKills: true,
        placementPoints: 5,
        totalPoints: 14,
        points: 14,
      },
      {
        id: 'result-4',
        matchId: 'match-1',
        slotNumber: 4,
        teamId: 'team-2w',
        isLocked: false,
        placement: 2,
        totalKills: 13,
        manualTotalKills: true,
        placementPoints: 6,
        totalPoints: 19,
        points: 19,
      },
    ],
    playerResults: [{ id: 'player-1', slotResultId: 'result-3' }],
  });

  const result = await syncMatchSlotsWithSessionRegistrations(prisma, {
    sessionId: 'session-1',
    organizationId: 'org-1',
    matchId: 'match-1',
    dataSource: null,
    dataMode: null,
  });

  expect(result.resetResults).toBe(1);
  expect(
    prisma.__state.matchSlots.find((slot) => slot.slotNumber === 3),
  ).toMatchObject({
    teamId: 'team-pst',
  });
  expect(
    prisma.__state.matchTeams.find((row) => row.teamId === 'team-tmt'),
  ).toMatchObject({
    slot: null,
    deletedAt: expect.any(Date),
  });
  expect(
    prisma.__state.matchTeams.find((row) => row.teamId === 'team-pst'),
  ).toMatchObject({
    slot: 3,
    deletedAt: null,
  });
  expect(
    prisma.__state.matchSlotResults.find((row) => row.id === 'result-3'),
  ).toMatchObject({
    teamId: 'team-pst',
    placement: null,
    totalKills: 0,
    totalPoints: 0,
  });
  expect(
    prisma.__state.matchSlotResults.find((row) => row.id === 'result-4'),
  ).toMatchObject({
    teamId: 'team-2w',
    placement: 2,
    totalKills: 13,
    totalPoints: 19,
  });
  expect(prisma.__state.playerResults).toHaveLength(0);
});

test('syncMatchSlotsWithSessionRegistrations excludes teams banned for the target match', async () => {
  const prisma = createPrismaMock({
    registrations: [
      {
        organizationId: 'org-1',
        sessionId: 'session-1',
        teamId: 'team-banned',
        status: SessionRegistrationStatus.CONFIRMED,
        slotNumber: 3,
        deletedAt: null,
      },
      {
        organizationId: 'org-1',
        sessionId: 'session-1',
        teamId: 'team-active',
        status: SessionRegistrationStatus.CONFIRMED,
        slotNumber: 4,
        deletedAt: null,
      },
    ],
    matchSlots: [
      {
        id: 'slot-3',
        matchId: 'match-1',
        slotNumber: 3,
        teamId: 'team-banned',
        lobbyStatus: LobbyStatus.ONLINE,
        playersInLobby: 4,
        deletedAt: null,
      },
      {
        id: 'slot-4',
        matchId: 'match-1',
        slotNumber: 4,
        teamId: 'team-active',
        lobbyStatus: LobbyStatus.OFFLINE,
        playersInLobby: 0,
        deletedAt: null,
      },
    ],
    matchTeams: [
      {
        id: 'mt-banned',
        matchId: 'match-1',
        teamId: 'team-banned',
        slot: 3,
        status: MatchTeamStatus.ACTIVE,
        deletedAt: null,
      },
      {
        id: 'mt-active',
        matchId: 'match-1',
        teamId: 'team-active',
        slot: 4,
        status: MatchTeamStatus.ACTIVE,
        deletedAt: null,
      },
    ],
    matchSlotResults: [],
    teamBans: [
      {
        organizationId: 'org-1',
        teamId: 'team-banned',
        scope: TeamBanScope.MATCH,
        sessionId: null,
        matchId: 'match-1',
        revokedAt: null,
        expiresAt: null,
      },
    ],
  });

  const result = await syncMatchSlotsWithSessionRegistrations(prisma, {
    sessionId: 'session-1',
    organizationId: 'org-1',
    matchId: 'match-1',
    dataSource: null,
    dataMode: null,
  });

  expect(result.clearedSlots).toBe(1);
  expect(
    prisma.__state.matchSlots.find((slot) => slot.slotNumber === 3),
  ).toMatchObject({
    teamId: null,
    lobbyStatus: LobbyStatus.EMPTY,
    playersInLobby: 0,
  });
  expect(
    prisma.__state.matchTeams.find((row) => row.teamId === 'team-banned'),
  ).toMatchObject({
    slot: null,
    deletedAt: expect.any(Date),
  });
  expect(
    prisma.__state.matchTeams.find((row) => row.teamId === 'team-active'),
  ).toMatchObject({
    slot: 4,
    deletedAt: null,
  });
});

test('syncMatchSlotsWithSessionRegistrations excludes teams whose manager is banned for the target match', async () => {
  const prisma = createPrismaMock({
    registrations: [
      {
        organizationId: 'org-1',
        sessionId: 'session-1',
        teamId: 'team-banned-manager',
        status: SessionRegistrationStatus.CONFIRMED,
        slotNumber: 3,
        deletedAt: null,
      },
      {
        organizationId: 'org-1',
        sessionId: 'session-1',
        teamId: 'team-active',
        status: SessionRegistrationStatus.CONFIRMED,
        slotNumber: 4,
        deletedAt: null,
      },
    ],
    teamMembers: [
      {
        organizationId: 'org-1',
        teamId: 'team-banned-manager',
        discordUserId: '111111111111111111',
        role: TeamMemberRole.LEADER,
        createdAt: new Date('2026-01-01T00:00:00Z'),
        deletedAt: null,
        leftAt: null,
      },
      {
        organizationId: 'org-1',
        teamId: 'team-active',
        discordUserId: '222222222222222222',
        role: TeamMemberRole.LEADER,
        createdAt: new Date('2026-01-01T00:00:00Z'),
        deletedAt: null,
        leftAt: null,
      },
    ],
    managerBans: [
      {
        organizationId: 'org-1',
        discordUserId: '111111111111111111',
        scope: TeamBanScope.MATCH,
        sessionId: null,
        matchId: 'match-1',
        revokedAt: null,
        expiresAt: null,
      },
    ],
    matchSlots: [
      {
        id: 'slot-3',
        matchId: 'match-1',
        slotNumber: 3,
        teamId: 'team-banned-manager',
        lobbyStatus: LobbyStatus.ONLINE,
        playersInLobby: 4,
        deletedAt: null,
      },
      {
        id: 'slot-4',
        matchId: 'match-1',
        slotNumber: 4,
        teamId: 'team-active',
        lobbyStatus: LobbyStatus.OFFLINE,
        playersInLobby: 0,
        deletedAt: null,
      },
    ],
    matchTeams: [
      {
        id: 'mt-banned-manager',
        matchId: 'match-1',
        teamId: 'team-banned-manager',
        slot: 3,
        status: MatchTeamStatus.ACTIVE,
        deletedAt: null,
      },
      {
        id: 'mt-active',
        matchId: 'match-1',
        teamId: 'team-active',
        slot: 4,
        status: MatchTeamStatus.ACTIVE,
        deletedAt: null,
      },
    ],
    matchSlotResults: [],
  });

  const result = await syncMatchSlotsWithSessionRegistrations(prisma, {
    sessionId: 'session-1',
    organizationId: 'org-1',
    matchId: 'match-1',
    dataSource: null,
    dataMode: null,
  });

  expect(result.clearedSlots).toBe(1);
  expect(
    prisma.__state.matchSlots.find((slot) => slot.slotNumber === 3),
  ).toMatchObject({
    teamId: null,
  });
  expect(
    prisma.__state.matchTeams.find(
      (row) => row.teamId === 'team-banned-manager',
    ),
  ).toMatchObject({
    slot: null,
    deletedAt: expect.any(Date),
  });
});
