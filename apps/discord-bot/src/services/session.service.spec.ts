import assert from 'node:assert/strict';
import test from 'node:test';
import type { Guild } from 'discord.js';
import type {
  DiscordConfigResponse,
  RegisterDiscordTeamResponse,
  SessionRegistrationResponse,
  TeamMemberSummary,
  TeamSummary,
} from '../api/api-client';
import { DiscordSessionService } from './session.service';

function createSessionRegistration(
  overrides: Partial<SessionRegistrationResponse> = {},
): SessionRegistrationResponse {
  return {
    id: 'registration-1',
    teamId: 'team-1',
    status: 'CONFIRMED',
    slotNumber: 3,
    waitlistPosition: null,
    checkedInAt: null,
    confirmedAt: null,
    removedAt: null,
    removalReason: null,
    note: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    team: {
      id: 'team-1',
      name: 'Team DXB',
      tag: 'DXB',
      logoUrl: null,
      countryCode: null,
      region: null,
    },
    ...overrides,
  };
}

function createTeamMember(
  overrides: Partial<TeamMemberSummary> = {},
): TeamMemberSummary {
  return {
    id: 'member-1',
    teamId: 'team-1',
    organizationId: 'org-1',
    discordUserId: 'leader-1',
    discordUsername: 'leader',
    displayName: 'Leader',
    role: 'LEADER',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    leftAt: null,
    deletedAt: null,
    ...overrides,
  };
}

function createRegistrationResponse(
  overrides: Partial<RegisterDiscordTeamResponse> = {},
): RegisterDiscordTeamResponse {
  return {
    created: true,
    team: {
      id: 'team-1',
      name: 'Team DXB',
      tag: 'DXB',
      organizationId: 'org-1',
    },
    members: [
      createTeamMember(),
      createTeamMember({
        id: 'member-2',
        discordUserId: 'player-1',
        discordUsername: 'player',
        displayName: 'Player',
        role: 'PLAYER',
      }),
    ],
    ...overrides,
  };
}

function createApi(partial: Record<string, unknown>) {
  const unexpected = async () => {
    throw new Error('Unexpected API call');
  };

  return {
    applyScreenshotResults: unexpected,
    createSession: unexpected,
    createSessionMatch: unexpected,
    getDiscordConfig: unexpected,
    getMatchRenderImage: unexpected,
    getSession: unexpected,
    getSessionStandings: unexpected,
    getTeamByTag: unexpected,
    listRegistrations: unexpected,
    listTeamMembers: unexpected,
    previewScreenshotResults: unexpected,
    registerDiscordTeam: unexpected,
    registerTeam: unexpected,
    removeRegistration: unexpected,
    ...partial,
  };
}

test('joinScrim allows the registered leader to claim a slot', async () => {
  const team: TeamSummary = { id: 'team-1', name: 'Team DXB', tag: 'DXB' };
  const api = createApi({
    getTeamByTag: async () => team,
    listTeamMembers: async () => [createTeamMember()],
    registerTeam: async () => createSessionRegistration(),
  });

  const service = new DiscordSessionService(api as any);
  const result = await service.joinScrim('leader-1', 'session-1', ' dxb ');

  assert.equal(result, '\u2705 Joined (Slot #3)');
});

test('joinScrim rejects callers who are not the registered leader', async () => {
  const team: TeamSummary = { id: 'team-1', name: 'Team DXB', tag: 'DXB' };
  const api = createApi({
    getTeamByTag: async () => team,
    listTeamMembers: async () => [createTeamMember()],
  });

  const service = new DiscordSessionService(api as any);

  await assert.rejects(
    () => service.joinScrim('player-9', 'session-1', 'DXB'),
    /Only the registered team leader can use this command/,
  );
});

test('leaveScrim rejects callers who are not the registered leader', async () => {
  const team: TeamSummary = { id: 'team-1', name: 'Team DXB', tag: 'DXB' };
  const api = createApi({
    getTeamByTag: async () => team,
    listTeamMembers: async () => [createTeamMember()],
  });

  const service = new DiscordSessionService(api as any);

  await assert.rejects(
    () => service.leaveScrim('player-9', 'session-1', 'DXB'),
    /Only the registered team leader can use this command/,
  );
});

test('registerTeam syncs configured Discord roles after backend registration', async () => {
  const registration = createRegistrationResponse();
  const appliedRoles = new Map<string, string[]>();
  const config: DiscordConfigResponse = {
    enabled: true,
    guildId: 'guild-1',
    captainRoleId: 'captain-role',
    participantRoleId: 'participant-role',
    autoSyncRoles: true,
  };

  const api = createApi({
    registerDiscordTeam: async () => registration,
    getDiscordConfig: async () => config,
  });

  const guild = {
    id: 'guild-1',
    roles: {
      fetch: async (roleId: string) => ({ id: roleId }),
    },
    members: {
      fetch: async (userId: string) => ({
        roles: {
          add: async (roleIds: string[]) => {
            appliedRoles.set(userId, [...roleIds]);
          },
        },
      }),
    },
  } as unknown as Guild;

  const service = new DiscordSessionService(api as any);
  const result = await service.registerTeam(
    'leader-1',
    'leader',
    'Leader',
    ' dxb ',
    'Team DXB',
    [
      {
        discordUserId: 'player-1',
        discordUsername: 'player',
        displayName: 'Player',
      },
    ],
    guild,
  );

  assert.match(result, /Discord roles synced for 2 member\(s\)\./);
  assert.deepEqual(appliedRoles.get('leader-1'), [
    'participant-role',
    'captain-role',
  ]);
  assert.deepEqual(appliedRoles.get('player-1'), ['participant-role']);
});
