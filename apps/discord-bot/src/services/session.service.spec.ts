import assert from "node:assert/strict";
import test from "node:test";
import { Collection, MessageType, type Guild } from "discord.js";
import type {
  DiscordConfigResponse,
  RegisterDiscordTeamResponse,
  SessionDiscordConfigResponse,
  SessionMatchResponse,
  SessionRegistrationResponse,
  SessionResponse,
  TeamMemberSummary,
  TeamSummary,
} from "../api/api-client";
import { DiscordSessionService } from "./session.service";

function createSessionRegistration(
  overrides: Partial<SessionRegistrationResponse> = {},
): SessionRegistrationResponse {
  return {
    id: "registration-1",
    teamId: "team-1",
    leaderDiscordUserId: null,
    managerDiscordUserIds: [],
    status: "CONFIRMED",
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
      id: "team-1",
      name: "Team DXB",
      tag: "DXB",
      logoUrl: null,
      countryCode: null,
      region: null,
    },
    ...overrides,
  };
}

function playStatusNote(
  status: "CONFIRM" | "NOT_PLAYING",
  discordUserId = "manager-1",
) {
  return `ARENZYRA_PLAY_STATUS:${JSON.stringify({ status, discordUserId })}`;
}

function createTeamMember(
  overrides: Partial<TeamMemberSummary> = {},
): TeamMemberSummary {
  return {
    id: "member-1",
    teamId: "team-1",
    organizationId: "org-1",
    discordUserId: "leader-1",
    discordUsername: "leader",
    displayName: "Leader",
    role: "LEADER",
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
      id: "team-1",
      name: "Team DXB",
      tag: "DXB",
      organizationId: "org-1",
    },
    members: [
      createTeamMember(),
      createTeamMember({
        id: "member-2",
        discordUserId: "player-1",
        discordUsername: "player",
        displayName: "Player",
        role: "PLAYER",
      }),
    ],
    ...overrides,
  };
}

function createSessionResponse(
  overrides: Partial<SessionResponse> = {},
): SessionResponse {
  return {
    id: "session-1",
    name: "Daily Scrim",
    slug: null,
    type: "SCRIM",
    status: "OPEN",
    createdById: null,
    slotCount: 25,
    maxTeams: 25,
    waitlistEnabled: true,
    registrationOpenAt: null,
    registrationCloseAt: null,
    startsAt: null,
    counts: {
      confirmedCount: 0,
      waitlistCount: 0,
      totalRegisteredCount: 0,
    },
    ...overrides,
  };
}

function createSessionMatchResponse(
  overrides: Partial<SessionMatchResponse> = {},
): SessionMatchResponse {
  return {
    id: "match-1",
    sessionId: "session-1",
    name: "Game 1",
    status: "FINISHED",
    matchNumber: 1,
    slotCount: 25,
    map: "ERANGEL",
    dataMode: "MANUAL",
    dataSource: "MANUAL",
    scheduledAt: null,
    startedAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    teamCount: 0,
    ...overrides,
  };
}

function createSessionDiscordConfig(
  overrides: Partial<SessionDiscordConfigResponse> = {},
): SessionDiscordConfigResponse {
  return {
    id: "session-discord-config-1",
    organizationId: "org-1",
    sessionId: "session-1",
    enabled: true,
    registrationMode: "SCRIM",
    guildId: null,
    categoryId: null,
    categoryName: null,
    registrationChannelId: null,
    registrationChannelName: null,
    slotListChannelId: null,
    slotListChannelName: null,
    waitlistChannelId: null,
    waitlistChannelName: null,
    idpChannelId: null,
    idpChannelName: null,
    managerChannelId: null,
    managerChannelName: null,
    transferChannelId: null,
    transferChannelName: null,
    manageChannelId: null,
    manageChannelName: null,
    resultsChannelId: null,
    resultsChannelName: null,
    screenshotsChannelId: null,
    screenshotsChannelName: null,
    bansChannelId: null,
    bansChannelName: null,
    logChannelId: null,
    logChannelName: null,
    slotRoleId: null,
    slotRoleName: null,
    waitlistRoleId: null,
    waitlistRoleName: null,
    idpRoleId: null,
    idpRoleName: null,
    bannedRoleId: null,
    bannedRoleName: null,
    earlyAccessRoleId: null,
    earlyAccessRoleName: null,
    vipAccessRoleId: null,
    vipAccessRoleName: null,
    registrationRoleIds: [],
    specialRegistrationRoleIds: [],
    manageRoleIds: [],
    vipRoleIds: [],
    startSlot: 3,
    normalSlots: 23,
    vipSlots: 0,
    maxManagersPerTeam: 2,
    maxTeamsPerManager: 1,
    tournamentMainPlayersRequired: 4,
    tournamentLogoRequired: false,
    registrationCommand: "%register",
    registrationFormat: "%register\nTeam Name\nTeam Tag\n@managers",
    disableSlotAndVipRegistration: false,
    slotTeamEmojiEnabled: true,
    downloadPlayerElims: true,
    spreadsheetId: null,
    emojis: {
      check: "CHECK",
      reject: "X",
      waitlist: "WAITLIST",
      ban: "BAN",
      vip: "VIP",
      slot: "SLOT",
    },
    notes: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function createScrimDiscordSetup(overrides: Record<string, unknown> = {}) {
  return {
    categoryId: "category-1",
    categoryName: "Scrim",
    registrationChannelId: "registration-channel",
    registrationChannelName: "registration",
    slotListChannelId: "slot-list-channel",
    slotListChannelName: "slot-list",
    waitlistChannelId: "waitlist-channel",
    waitlistChannelName: "waitlist",
    idpChannelId: "idp-channel",
    idpChannelName: "idp",
    managerChannelId: "manager-channel",
    managerChannelName: "manager",
    transferChannelId: "transfer-channel",
    transferChannelName: "transfer-roles",
    manageChannelId: "manage-channel",
    manageChannelName: "manage",
    resultsChannelId: "results-channel",
    resultsChannelName: "results",
    screenshotsChannelId: "screenshots-channel",
    screenshotsChannelName: "screenshots",
    bansChannelId: "bans-channel",
    bansChannelName: "bans",
    logChannelId: "log-channel",
    logChannelName: "log",
    slotRoleId: "slot-role",
    slotRoleName: "Slot",
    staffRoleId: "staff-role",
    staffRoleName: "Staff",
    waitlistRoleId: "waitlist-role",
    waitlistRoleName: "Waitlist",
    idpRoleId: "idp-role",
    idpRoleName: "IDP",
    bannedRoleId: "banned-role",
    bannedRoleName: "Banned",
    ...overrides,
  };
}

function createApi(partial: Record<string, unknown>) {
  const unexpected = async () => {
    throw new Error("Unexpected API call");
  };

  return {
    applyScreenshotResults: unexpected,
    applyNoShowAutoBansForMatch: unexpected,
    cleanupDiscordTeam: unexpected,
    createNoShowTeamBans: unexpected,
    createSession: unexpected,
    createSessionMatch: unexpected,
    getDiscordConfig: unexpected,
    getMatchRenderImage: unexpected,
    getSession: unexpected,
    getSessionDiscordConfig: unexpected,
    getSessionStandings: unexpected,
    getTeamByTag: unexpected,
    listMatchSlots: unexpected,
    listSessions: unexpected,
    listRegistrations: unexpected,
    listTeamMembers: unexpected,
    mapScreenshotSlots: unexpected,
    previewNoShowTeamBans: unexpected,
    previewScreenshotResults: unexpected,
    registerDiscordTeam: unexpected,
    registerTeam: unexpected,
    refreshDiscordSourceImports: async () => ({ refreshed: 0, skipped: false }),
    resolveDiscordChannel: unexpected,
    resolveDiscordGuild: unexpected,
    removeRegistration: unexpected,
    removeSlotRegistrations: unexpected,
    resetSessionResults: unexpected,
    syncSessionMatchSlots: unexpected,
    updateSession: unexpected,
    updateSessionDiscordConfig: unexpected,
    updateRegistrationManagers: unexpected,
    updateRegistrationPlacement: unexpected,
    updateRegistrationPlayStatus: unexpected,
    uploadDiscordPlayerPhoto: unexpected,
    uploadTeamLogo: unexpected,
    ...partial,
  };
}

test("no-show auto ban parser keeps total misses when matchNumber is null", () => {
  const service = new DiscordSessionService(createApi({}) as any) as any;
  const rules = service.parseNoShowAutoBanRulesForDiscord({
    emojis: {
      noShowBanRules: JSON.stringify([
        {
          enabled: true,
          type: "TOTAL_MISSES",
          misses: 2,
          matchNumber: null,
          durationDays: null,
          scope: "SESSION",
          reason: "Missed {misses} match(es) in {session}",
        },
      ]),
    },
  });

  assert.deepEqual(rules, [
    {
      enabled: true,
      type: "TOTAL_MISSES",
      misses: 2,
      matchNumber: null,
      durationDays: null,
      scope: "SESSION",
      reason: "Missed {misses} match(es) in {session}",
    },
  ]);
});

test("createTeamBanFromDiscord sends detailed log and simple bans channel notice", async () => {
  const config = createSessionDiscordConfig({
    guildId: "guild-1",
    bansChannelId: "bans-channel",
    logChannelId: "log-channel",
    bannedRoleId: "banned-role",
    bannedRoleName: "Banned",
    emojis: {
      ban: "BAN",
      banServerAction: "ROLE",
    },
  });
  const team = {
    id: "team-1",
    name: "Team DXB",
    tag: "DXB",
    logoUrl: null,
  };
  let capturedPayload: any = null;
  const managerId = "123456789012345678";
  const api = createApi({
    searchTeams: async () => [team],
    listTeamMembers: async () => [
      createTeamMember({
        discordUserId: managerId,
        discordUsername: "leader",
        displayName: "Leader",
      }),
    ],
    listRegistrations: async () => [
      createSessionRegistration({
        leaderDiscordUserId: managerId,
        managerDiscordUserIds: [managerId],
      }),
    ],
    getSessionDiscordConfig: async () => config,
    createManagerBan: async (payload: any) => {
      capturedPayload = payload;
      return [
        {
          id: "manager-ban-1",
          organizationId: "org-1",
          discordUserId: managerId,
          discordUsername: "leader",
          displayName: "Leader",
          scope: "SESSION",
          sessionId: "session-1",
          matchId: null,
          reason: payload.reason,
          note: payload.note ?? null,
          expiresAt: payload.expiresAt ?? null,
          revokedAt: null,
          revokeReason: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          active: true,
          session: { id: "session-1", name: "Daily Scrim", status: "OPEN" },
          match: null,
        },
      ];
    },
  });
  const roleAdds: Array<{ userId: string; roleId: string; reason: string }> =
    [];
  const sentMessages: Array<{ channelId: string; payload: any }> = [];
  const bannedRole = { id: "banned-role", name: "Banned" };
  const guild = {
    id: "guild-1",
    roles: {
      cache: {
        get: (roleId: string) =>
          roleId === bannedRole.id ? bannedRole : undefined,
        find: (predicate: (role: typeof bannedRole) => boolean) =>
          predicate(bannedRole) ? bannedRole : undefined,
      },
    },
    members: {
      fetch: async (userId: string) => ({
        user: { bot: false },
        roles: {
          add: async (role: typeof bannedRole, reason: string) => {
            roleAdds.push({ userId, roleId: role.id, reason });
          },
        },
      }),
    },
    channels: {
      fetch: async (channelId: string) => ({
        isTextBased: () => true,
        isDMBased: () => false,
        send: async (payload: any) => {
          sentMessages.push({ channelId, payload });
          return { id: `message-${channelId}` };
        },
      }),
    },
  } as unknown as Guild;

  const service = new DiscordSessionService(api as any);
  (service as any).syncDiscordScrimState = async () => undefined;

  const result = await service.createTeamBanFromDiscord(
    {
      target: { kind: "team", query: "DXB" },
      scope: "SESSION",
      sessionId: "session-1",
      reason: "Rule break",
    },
    guild,
    {
      actorDiscordId: "staff-1",
      actorLabel: "Staff",
      sourceChannelId: "bans-channel",
    },
  );

  assert.equal(capturedPayload.scope, "SESSION");
  assert.equal(capturedPayload.sessionId, "session-1");
  assert.deepEqual(roleAdds, [
    { userId: managerId, roleId: "banned-role", reason: "Rule break" },
  ]);
  assert.deepEqual(
    sentMessages.map((message) => message.channelId),
    ["log-channel", "bans-channel"],
  );
  assert.ok(sentMessages[0].payload.embeds?.length);
  assert.equal(sentMessages[1].payload.embeds, undefined);
  assert.match(sentMessages[1].payload.content, /Manager ban saved/);
  assert.match(sentMessages[1].payload.content, /Team: Team DXB \(DXB\)/);
  assert.match(sentMessages[1].payload.content, /<@123456789012345678>/);
  assert.deepEqual(sentMessages[1].payload.allowedMentions, {
    parse: [],
    users: [managerId],
  });
  assert.match(sentMessages[1].payload.content, /Duration: Permanent/);
  assert.match(sentMessages[1].payload.content, /Scope: This session/);
  assert.match(sentMessages[1].payload.content, /Reason: Rule break/);
  assert.match(result, /banned role\(s\) applied to 1\/1 linked member/);
});

test("revokeTeamBansFromDiscord sends detailed log and simple bans channel notice", async () => {
  const config = createSessionDiscordConfig({
    guildId: "guild-1",
    bansChannelId: "bans-channel",
    logChannelId: "log-channel",
    bannedRoleId: "banned-role",
    bannedRoleName: "Banned",
    emojis: {
      check: "CHECK",
      banRoleIds: "banned-role",
    },
  });
  const team = {
    id: "team-1",
    name: "Team DXB",
    tag: "DXB",
    logoUrl: null,
  };
  const activeBan = {
    id: "manager-ban-1",
    organizationId: "org-1",
    discordUserId: "leader-1",
    discordUsername: "leader",
    displayName: "Leader",
    scope: "SESSION" as const,
    sessionId: "session-1",
    matchId: null,
    reason: "Rule break",
    note: null,
    expiresAt: null,
    revokedAt: null,
    revokeReason: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    active: true,
    session: { id: "session-1", name: "Daily Scrim", status: "OPEN" },
    match: null,
  };
  let revoked = false;
  let revokeReason: string | null = null;
  const api = createApi({
    searchTeams: async () => [team],
    listTeamMembers: async () => [
      createTeamMember({
        discordUserId: "leader-1",
        discordUsername: "leader",
        displayName: "Leader",
      }),
    ],
    listRegistrations: async () => [
      createSessionRegistration({
        leaderDiscordUserId: "leader-1",
        managerDiscordUserIds: ["leader-1"],
      }),
    ],
    getSession: async () => createSessionResponse({ name: "Daily Scrim" }),
    getSessionDiscordConfig: async () => config,
    listSessionMatches: async () => [],
    listManagerBans: async (params: any) =>
      params.active === true && params.discordUserId === "leader-1" && !revoked
        ? [activeBan]
        : [],
    revokeManagerBan: async (_banId: string, payload: any) => {
      revoked = true;
      revokeReason = payload.reason;
      return {
        ...activeBan,
        active: false,
        revokedAt: new Date().toISOString(),
        revokeReason: payload.reason,
      };
    },
  });
  const roleRemovals: Array<{
    userId: string;
    roleIds: string[];
    reason: string;
  }> = [];
  const sentMessages: Array<{ channelId: string; payload: any }> = [];
  const bannedRole = { id: "banned-role", name: "Banned" };
  const guild = {
    id: "guild-1",
    roles: {
      cache: {
        get: (roleId: string) =>
          roleId === bannedRole.id ? bannedRole : undefined,
        find: () => undefined,
      },
      fetch: async () => bannedRole,
    },
    members: {
      fetch: async (input: string | { user: string }) => {
        const userId = typeof input === "string" ? input : input.user;
        return {
          roles: {
            cache: { has: (roleId: string) => roleId === bannedRole.id },
            remove: async (roleIds: string[], reason: string) => {
              roleRemovals.push({ userId, roleIds, reason });
            },
          },
        };
      },
    },
    channels: {
      fetch: async (channelId: string) => ({
        isTextBased: () => true,
        isDMBased: () => false,
        send: async (payload: any) => {
          sentMessages.push({ channelId, payload });
          return { id: `message-${channelId}` };
        },
      }),
    },
  } as unknown as Guild;

  const service = new DiscordSessionService(api as any);
  (service as any).syncDiscordScrimState = async () => undefined;
  (service as any).refreshDiscordBanListsForSessionTargets = async () =>
    undefined;

  const result = await service.revokeTeamBansFromDiscord(
    {
      target: { kind: "team", query: "DXB" },
      scope: "SESSION",
      sessionId: "session-1",
      reason: "Appeal accepted",
    },
    guild,
    {
      actorDiscordId: "staff-1",
      actorLabel: "Staff",
      sourceChannelId: "bans-channel",
    },
  );

  assert.equal(revokeReason, "Appeal accepted");
  assert.deepEqual(roleRemovals, [
    {
      userId: "leader-1",
      roleIds: ["banned-role"],
      reason: "Arenzyra manager ban revoked session-1",
    },
  ]);
  assert.deepEqual(
    sentMessages.map((message) => message.channelId),
    ["log-channel", "bans-channel"],
  );
  assert.ok(sentMessages[0].payload.embeds?.length);
  assert.equal(sentMessages[1].payload.embeds, undefined);
  assert.match(sentMessages[1].payload.content, /Manager ban revoked/);
  assert.match(sentMessages[1].payload.content, /Team: Team DXB \(DXB\)/);
  assert.match(sentMessages[1].payload.content, /Leader \(ID leader-1\)/);
  assert.match(sentMessages[1].payload.content, /Duration: Revoked now/);
  assert.match(sentMessages[1].payload.content, /Scope: This session/);
  assert.match(sentMessages[1].payload.content, /Reason: Appeal accepted/);
  assert.match(result, /Revoked 1 active manager ban/);
});

test("createTeamBanFromDiscord resolves Team Name (TAG) display labels", async () => {
  const config = createSessionDiscordConfig({
    guildId: "guild-1",
    emojis: {
      ban: "BAN",
      banServerAction: "NONE",
    },
  });
  const teams: TeamSummary[] = [
    {
      id: "team-mrthoko",
      name: "Mrthoko",
      tag: "MRTHOKO",
      logoUrl: null,
    },
    {
      id: "team-mt",
      name: "Mrthoko",
      tag: "MT",
      logoUrl: null,
    },
  ];
  let searchedFor: string | null = null;
  let capturedPayload: any = null;
  const api = createApi({
    searchTeams: async (query: string) => {
      searchedFor = query;
      return teams;
    },
    listTeamMembers: async (teamId: string) => [
      createTeamMember({
        teamId,
        discordUserId: "764878981744820244",
        discordUsername: "manager",
        displayName: "Manager",
      }),
    ],
    listRegistrations: async () => [],
    getSessionDiscordConfig: async () => config,
    createManagerBan: async (payload: any) => {
      capturedPayload = payload;
      return [
        {
          id: "manager-ban-1",
          organizationId: "org-1",
          teamId: payload.teamId,
          discordUserId: "764878981744820244",
          discordUsername: "manager",
          displayName: "Manager",
          scope: "SESSION",
          sessionId: "session-1",
          matchId: null,
          reason: payload.reason,
          note: payload.note ?? null,
          expiresAt: payload.expiresAt ?? null,
          revokedAt: null,
          revokeReason: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          active: true,
          team: teams[1],
          session: { id: "session-1", name: "Daily Scrim", status: "OPEN" },
          match: null,
        },
      ];
    },
    listManagerBans: async () => [],
    listTeamBans: async () => [],
  });
  const guild = {
    id: "guild-1",
    roles: {
      cache: {
        get: () => undefined,
        find: () => undefined,
      },
    },
    channels: {
      fetch: async () => null,
    },
  } as unknown as Guild;

  const service = new DiscordSessionService(api as any);
  (service as any).syncDiscordScrimState = async () => undefined;

  const result = await service.createTeamBanFromDiscord(
    {
      target: { kind: "team", query: "MrThoko (mt)" },
      scope: "SESSION",
      sessionId: "session-1",
      reason: "Rule break",
      serverAction: "NONE",
    },
    guild,
  );

  assert.equal(searchedFor, "MrThoko");
  assert.equal(capturedPayload.teamId, "team-mt");
  assert.match(result, /Mrthoko \(MT\)/);
});

test("createTeamBanFromDiscord uses timed and permanent ban role lists", async () => {
  const config = createSessionDiscordConfig({
    guildId: "guild-1",
    bannedRoleId: null,
    bannedRoleName: null,
    emojis: {
      ban: "BAN",
      banServerAction: "ROLE",
      banRoleIds: "111111111111111111",
      permanentBanRoleIds: "222222222222222222\n111111111111111111",
    },
  });
  const team = {
    id: "team-1",
    name: "Team DXB",
    tag: "DXB",
    logoUrl: null,
  };
  const createdPayloads: any[] = [];
  const api = createApi({
    searchTeams: async () => [team],
    listTeamMembers: async () => [
      createTeamMember({
        discordUserId: "leader-1",
        discordUsername: "leader",
        displayName: "Leader",
      }),
    ],
    listRegistrations: async () => [
      createSessionRegistration({
        leaderDiscordUserId: "leader-1",
        managerDiscordUserIds: ["leader-1"],
      }),
    ],
    getSessionDiscordConfig: async () => config,
    createManagerBan: async (payload: any) => {
      createdPayloads.push(payload);
      return [
        {
          id: `manager-ban-${createdPayloads.length}`,
          organizationId: "org-1",
          discordUserId: "leader-1",
          discordUsername: "leader",
          displayName: "Leader",
          scope: "SESSION",
          sessionId: "session-1",
          matchId: null,
          reason: payload.reason,
          note: payload.note ?? null,
          expiresAt: payload.expiresAt ?? null,
          revokedAt: null,
          revokeReason: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          active: true,
          session: { id: "session-1", name: "Daily Scrim", status: "OPEN" },
          match: null,
        },
      ];
    },
  });
  const roleAdds: Array<{ userId: string; roleId: string; reason: string }> =
    [];
  const roles = new Map([
    ["111111111111111111", { id: "111111111111111111", name: "Timed Banned" }],
    [
      "222222222222222222",
      { id: "222222222222222222", name: "Permanent Banned" },
    ],
  ]);
  const guild = {
    id: "guild-1",
    roles: {
      cache: {
        get: (roleId: string) => roles.get(roleId),
        find: (predicate: (role: { id: string; name: string }) => boolean) =>
          Array.from(roles.values()).find(predicate),
      },
    },
    members: {
      fetch: async (userId: string) => ({
        roles: {
          add: async (role: { id: string; name: string }, reason: string) => {
            roleAdds.push({ userId, roleId: role.id, reason });
          },
        },
      }),
    },
  } as unknown as Guild;

  const service = new DiscordSessionService(api as any);
  (service as any).syncDiscordScrimState = async () => undefined;
  (service as any).sendDiscordActionLog = async () => undefined;

  await service.createTeamBanFromDiscord(
    {
      target: { kind: "team", query: "DXB" },
      scope: "SESSION",
      sessionId: "session-1",
      reason: "Timed ban",
      days: 3,
    },
    guild,
  );
  await service.createTeamBanFromDiscord(
    {
      target: { kind: "team", query: "DXB" },
      scope: "SESSION",
      sessionId: "session-1",
      reason: "Permanent ban",
    },
    guild,
  );

  assert.ok(createdPayloads[0].expiresAt);
  assert.equal(createdPayloads[1].expiresAt, null);
  assert.deepEqual(roleAdds, [
    {
      userId: "leader-1",
      roleId: "111111111111111111",
      reason: "Timed ban",
    },
    {
      userId: "leader-1",
      roleId: "222222222222222222",
      reason: "Permanent ban",
    },
  ]);
});

test("createTeamBanFromDiscord falls back from missing ban role ids", async () => {
  const config = createSessionDiscordConfig({
    guildId: "guild-1",
    bannedRoleId: "333333333333333333",
    bannedRoleName: "Default Banned",
    emojis: {
      ban: "BAN",
      banServerAction: "ROLE",
      banRoleIds: "444444444444444444",
    },
  });
  const team = {
    id: "team-1",
    name: "Team DXB",
    tag: "DXB",
    logoUrl: null,
  };
  const api = createApi({
    searchTeams: async () => [team],
    listTeamMembers: async () => [
      createTeamMember({
        discordUserId: "leader-1",
        discordUsername: "leader",
        displayName: "Leader",
      }),
    ],
    listRegistrations: async () => [
      createSessionRegistration({
        leaderDiscordUserId: "leader-1",
        managerDiscordUserIds: ["leader-1"],
      }),
    ],
    getSessionDiscordConfig: async () => config,
    createManagerBan: async (payload: any) => [
      {
        id: "manager-ban-1",
        organizationId: "org-1",
        discordUserId: "leader-1",
        discordUsername: "leader",
        displayName: "Leader",
        scope: "SESSION",
        sessionId: "session-1",
        matchId: null,
        reason: payload.reason,
        note: payload.note ?? null,
        expiresAt: payload.expiresAt ?? null,
        revokedAt: null,
        revokeReason: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        active: true,
        session: { id: "session-1", name: "Daily Scrim", status: "OPEN" },
        match: null,
      },
    ],
  });
  const roleAdds: Array<{ userId: string; roleId: string; reason: string }> =
    [];
  const defaultRole = { id: "333333333333333333", name: "Default Banned" };
  const guild = {
    id: "guild-1",
    roles: {
      cache: {
        get: (roleId: string) =>
          roleId === defaultRole.id ? defaultRole : undefined,
        find: (predicate: (role: typeof defaultRole) => boolean) =>
          predicate(defaultRole) ? defaultRole : undefined,
      },
      fetch: async (roleId: string) =>
        roleId === defaultRole.id ? defaultRole : null,
    },
    members: {
      fetch: async (userId: string) => ({
        roles: {
          add: async (role: typeof defaultRole, reason: string) => {
            roleAdds.push({ userId, roleId: role.id, reason });
          },
        },
      }),
    },
  } as unknown as Guild;

  const service = new DiscordSessionService(api as any);
  (service as any).syncDiscordScrimState = async () => undefined;
  (service as any).sendDiscordActionLog = async () => undefined;

  await service.createTeamBanFromDiscord(
    {
      target: { kind: "team", query: "DXB" },
      scope: "SESSION",
      sessionId: "session-1",
      reason: "Timed ban",
      days: 3,
    },
    guild,
  );
  await service.createTeamBanFromDiscord(
    {
      target: { kind: "team", query: "DXB" },
      scope: "SESSION",
      sessionId: "session-1",
      reason: "Permanent ban",
    },
    guild,
  );

  assert.deepEqual(roleAdds, [
    {
      userId: "leader-1",
      roleId: defaultRole.id,
      reason: "Timed ban",
    },
    {
      userId: "leader-1",
      roleId: defaultRole.id,
      reason: "Permanent ban",
    },
  ]);
});

test("createTeamBanFromDiscord uses one configured ban role for all ban durations", async () => {
  const config = createSessionDiscordConfig({
    guildId: "guild-1",
    bannedRoleId: null,
    bannedRoleName: null,
    emojis: {
      ban: "BAN",
      banServerAction: "ROLE",
      banRoleIds: "111111111111111111",
    },
  });
  const team = {
    id: "team-1",
    name: "Team DXB",
    tag: "DXB",
    logoUrl: null,
  };
  const api = createApi({
    searchTeams: async () => [team],
    listTeamMembers: async () => [
      createTeamMember({
        discordUserId: "leader-1",
        discordUsername: "leader",
        displayName: "Leader",
      }),
    ],
    listRegistrations: async () => [
      createSessionRegistration({
        leaderDiscordUserId: "leader-1",
        managerDiscordUserIds: ["leader-1"],
      }),
    ],
    getSessionDiscordConfig: async () => config,
    createManagerBan: async (payload: any) => [
      {
        id: "manager-ban-1",
        organizationId: "org-1",
        discordUserId: "leader-1",
        discordUsername: "leader",
        displayName: "Leader",
        scope: "SESSION",
        sessionId: "session-1",
        matchId: null,
        reason: payload.reason,
        note: payload.note ?? null,
        expiresAt: payload.expiresAt ?? null,
        revokedAt: null,
        revokeReason: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        active: true,
        session: { id: "session-1", name: "Daily Scrim", status: "OPEN" },
        match: null,
      },
    ],
  });
  const roleAdds: Array<{ userId: string; roleId: string; reason: string }> =
    [];
  const banRole = { id: "111111111111111111", name: "Banned" };
  const guild = {
    id: "guild-1",
    roles: {
      cache: {
        get: (roleId: string) => (roleId === banRole.id ? banRole : undefined),
        find: () => undefined,
      },
    },
    members: {
      fetch: async (userId: string) => ({
        roles: {
          add: async (role: typeof banRole, reason: string) => {
            roleAdds.push({ userId, roleId: role.id, reason });
          },
        },
      }),
    },
  } as unknown as Guild;

  const service = new DiscordSessionService(api as any);
  (service as any).syncDiscordScrimState = async () => undefined;
  (service as any).sendDiscordActionLog = async () => undefined;

  await service.createTeamBanFromDiscord(
    {
      target: { kind: "team", query: "DXB" },
      scope: "SESSION",
      sessionId: "session-1",
      reason: "Timed ban",
      days: 3,
    },
    guild,
  );
  await service.createTeamBanFromDiscord(
    {
      target: { kind: "team", query: "DXB" },
      scope: "SESSION",
      sessionId: "session-1",
      reason: "Permanent ban",
    },
    guild,
  );

  assert.deepEqual(roleAdds, [
    { userId: "leader-1", roleId: banRole.id, reason: "Timed ban" },
    { userId: "leader-1", roleId: banRole.id, reason: "Permanent ban" },
  ]);
});

test("ban list renders manager names without raw Discord mentions", async () => {
  const api = createApi({
    listTeamBans: async () => [
      {
        id: "team-ban",
        organizationId: "org-1",
        teamId: "team-1",
        scope: "SESSION",
        sessionId: "session-1",
        matchId: null,
        reason: "Missed match",
        note: null,
        expiresAt: null,
        revokedAt: null,
        revokeReason: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        active: true,
        team: { id: "team-1", name: "Team DXB", tag: "DXB" },
        session: { id: "session-1", name: "Daily Scrim", status: "OPEN" },
        match: null,
      },
    ],
    listTeamMembers: async () => [
      createTeamMember({
        teamId: "team-1",
        discordUserId: "444444444444444444",
        discordUsername: "team_manager",
        displayName: "Team Manager",
      }),
    ],
    listSessionMatches: async () => [],
    listManagerBans: async () => [
      {
        id: "ban-live",
        organizationId: "org-1",
        discordUserId: "111111111111111111",
        discordUsername: "saved_live",
        displayName: "Saved Live",
        scope: "SESSION",
        sessionId: "session-1",
        matchId: null,
        reason: "Manual Discord ban",
        note: null,
        expiresAt: null,
        revokedAt: null,
        revokeReason: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        active: true,
      },
      {
        id: "ban-saved",
        organizationId: "org-1",
        discordUserId: "222222222222222222",
        discordUsername: "saved_user",
        displayName: null,
        scope: "SESSION",
        sessionId: "session-1",
        matchId: null,
        reason: "No show",
        note: null,
        expiresAt: null,
        revokedAt: null,
        revokeReason: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        active: true,
      },
      {
        id: "ban-id",
        organizationId: "org-1",
        discordUserId: "333333333333333333",
        discordUsername: null,
        displayName: null,
        scope: "SESSION",
        sessionId: "session-1",
        matchId: null,
        reason: "Rule break",
        note: null,
        expiresAt: null,
        revokedAt: null,
        revokeReason: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        active: true,
      },
    ],
  });
  const guild = {
    members: {
      fetch: async (discordUserId: string) => {
        if (discordUserId === "111111111111111111") {
          return {
            displayName: "Current Nick",
            user: { globalName: "Global Live", username: "live_user" },
          };
        }
        throw new Error("Unknown Member");
      },
    },
  } as unknown as Guild;
  const service = new DiscordSessionService(api as any);

  const [message] = await (service as any).buildDiscordBanListMessages(
    createSessionDiscordConfig(),
    "session-1",
    guild,
  );

  assert.match(
    message,
    /> \*\*`\[DXB\]` Team DXB\*\* \(Missed match\) \| Manager: Team Manager \(ID 444444444444444444\)/,
  );
  assert.match(
    message,
    /> Current Nick \(ID 111111111111111111\) \(Manual Discord ban\)/,
  );
  assert.match(
    message,
    /> saved_user \(ID 222222222222222222\) \(No show\)/,
  );
  assert.match(
    message,
    /> Discord ID 333333333333333333 \(Rule break\)/,
  );
  assert.doesNotMatch(message, /<@!?\d{15,25}>/);
});

test("action log embeds render Discord references as plain text", async () => {
  const sentPayloads: any[] = [];
  const channel = {
    isTextBased: () => true,
    isDMBased: () => false,
    send: async (payload: any) => {
      sentPayloads.push(payload);
    },
  };
  const guild = {
    channels: {
      fetch: async (channelId: string) =>
        channelId === "999999999999999999" ? channel : null,
    },
  } as unknown as Guild;
  const service = new DiscordSessionService(createApi({}) as any);

  await service.sendDiscordActionLog(
    guild,
    {
      logChannelId: "999999999999999999",
      bansChannelId: null,
      sessionId: "session-1",
      emojis: {},
    },
    {
      action: "Registration rejected",
      actorDiscordId: "111111111111111111",
      actorLabel: "Staff User",
      sourceChannelId: "222222222222222222",
      targetChannelId: "333333333333333333",
      status: "<@444444444444444444> blocked",
      details: [
        "Original: <@555555555555555555>",
        "Channel: <#666666666666666666>",
        "Role: <@&777777777777777777>",
      ],
    },
  );

  assert.equal(sentPayloads.length, 1);
  const embed = sentPayloads[0].embeds[0].toJSON();
  const rendered = JSON.stringify(embed);
  assert.match(rendered, /Staff User \(ID 111111111111111111\)/);
  assert.match(rendered, /Discord channel 222222222222222222/);
  assert.match(rendered, /Discord channel 333333333333333333/);
  assert.match(rendered, /Discord user 444444444444444444/);
  assert.match(rendered, /Discord role 777777777777777777/);
  assert.doesNotMatch(rendered, /<@!?\d{15,25}>/);
  assert.doesNotMatch(rendered, /<@&\d{15,25}>/);
  assert.doesNotMatch(rendered, /<#\d{15,25}>/);
});

test("copied event source refresh uses source organization context", async () => {
  const organizationScopes: Array<string | null | undefined> = [];
  const refreshedSessions: string[] = [];
  const api = createApi({
    withOrganization: async (
      organizationId: string | null | undefined,
      fn: () => Promise<unknown>,
    ) => {
      organizationScopes.push(organizationId);
      return fn();
    },
    refreshDiscordSourceImports: async (sessionId: string) => {
      refreshedSessions.push(sessionId);
      return { refreshed: 1, skipped: false };
    },
  });
  const service = new DiscordSessionService(api as any);

  const result = await (service as any).refreshCopiedEventSourceImportsNow(
    "source-session",
    "source-org",
  );

  assert.deepEqual(organizationScopes, ["source-org"]);
  assert.deepEqual(refreshedSessions, ["source-session"]);
  assert.deepEqual(result, { refreshed: 1, skipped: false });
});

test("createScrim uses the Discord server linked organization", async () => {
  const organizationScopes: Array<string | null | undefined> = [];
  const calls: string[] = [];
  const api = createApi({
    resolveDiscordGuild: async (guildId: string) => {
      calls.push(`resolve:${guildId}`);
      return {
        organizationId: "org-one-esports",
        organizationName: "ONE ESPORTS #1",
        organizationSlug: "one-esports-1",
        guildId,
        guildName: "ONE ESPORTS",
        source: "guild-link",
      };
    },
    withOrganization: async (
      organizationId: string | null | undefined,
      fn: () => Promise<unknown>,
    ) => {
      organizationScopes.push(organizationId);
      return fn();
    },
    createSession: async (payload: unknown) => {
      calls.push("create-session");
      assert.equal((payload as { name: string }).name, "ONE ESPORTS SCRIM");
      return createSessionResponse({
        id: "one-session",
        name: "ONE ESPORTS SCRIM",
      });
    },
  });
  const service = new DiscordSessionService(api as any);
  (service as any).syncDiscordScrimState = async () => {
    calls.push("sync-discord");
    return createScrimDiscordSetup();
  };

  const result = await service.createScrim(
    "creator-1",
    "ONE ESPORTS SCRIM",
    23,
    { id: "guild-one" } as Guild,
  );

  assert.deepEqual(organizationScopes, ["org-one-esports"]);
  assert.deepEqual(calls, [
    "resolve:guild-one",
    "create-session",
    "sync-discord",
  ]);
  assert.match(result, /ONE ESPORTS SCRIM/);
});

test("final result post renders configured winner message from standings", async () => {
  const api = createApi({
    getMatchRenderImage: async () => Buffer.from([1]),
    getSessionStandings: async () => ({
      sessionId: "session-1",
      teams: [
        {
          teamId: "team-1",
          teamName: "Alpha Team",
          tag: "ALP",
          totalPoints: 42,
          totalKills: 18,
          placementPoints: 24,
          wwcd: 2,
          matchesPlayed: 3,
          avgPlacement: 1.67,
          rank: 1,
        },
        {
          teamId: "team-2",
          teamName: "Bravo Team",
          tag: "BRV",
          totalPoints: 38,
          totalKills: 15,
          placementPoints: 23,
          wwcd: 1,
          matchesPlayed: 3,
          avgPlacement: 2.1,
          rank: 2,
        },
        {
          teamId: "team-3",
          teamName: "Charlie Team",
          tag: "CHL",
          totalPoints: 31,
          totalKills: 12,
          placementPoints: 19,
          wwcd: 0,
          matchesPlayed: 3,
          avgPlacement: 4.2,
          rank: 3,
        },
      ],
    }),
  });
  const service = new DiscordSessionService(api as any);

  const result = await service.buildFinalResultPost(
    "match-1",
    createSessionDiscordConfig({
      sessionId: "session-1",
      emojis: {
        trophy: "T",
        finalResultWinnerCount: "2",
        finalResultMessageTemplate:
          "{trophy} Final Board\nWinner: {winnerTag}\n\n{winners}",
        finalResultWinnerRowTemplate:
          "#{rank} {teamName} - {points} pts / {kills} kills / {wwcd} WWCD",
      },
    }),
  );

  assert.equal(
    result.publicContent,
    [
      "T Final Board",
      "Winner: ALP",
      "",
      "#1 Alpha Team - 42 pts / 18 kills / 2 WWCD",
      "#2 Bravo Team - 38 pts / 15 kills / 1 WWCD",
    ].join("\n"),
  );
  assert.ok(!result.publicContent?.includes("Charlie Team"));
  assert.equal(result.imageFiles?.length, 4);
});

test("final result post uses a full custom post template", async () => {
  const api = createApi({
    getMatchRenderImage: async () => Buffer.from([1]),
    getSessionStandings: async () => ({
      sessionId: "session-1",
      teams: [
        {
          teamId: "team-1",
          teamName: "Alpha Team",
          tag: "ALP",
          totalPoints: 42,
          totalKills: 18,
          placementPoints: 24,
          wwcd: 2,
          matchesPlayed: 3,
          avgPlacement: 1.67,
          rank: 1,
        },
        {
          teamId: "team-2",
          teamName: "Bravo Team",
          tag: "BRV",
          totalPoints: 38,
          totalKills: 15,
          placementPoints: 23,
          wwcd: 1,
          matchesPlayed: 3,
          avgPlacement: 2.1,
          rank: 2,
        },
      ],
    }),
  });
  const service = new DiscordSessionService(api as any);

  const result = await service.buildFinalResultPost(
    "match-1",
    createSessionDiscordConfig({
      sessionId: "session-1",
      emojis: {
        trophy: "T",
        finalResultWinnerCount: "2",
        finalResultPostTemplate:
          "**CUSTOM FINAL**\nWinner: {winnerTag} ({winnerPoints})\n\n{winners}\n\nBody:\n{message}",
        finalResultMessageTemplate: "Reusable body for {winnerName}",
        finalResultWinnerRowTemplate: "#{rank} {teamTag} {points}/{kills}",
      },
    }),
  );

  assert.equal(
    result.publicContent,
    [
      "**CUSTOM FINAL**",
      "Winner: ALP (42)",
      "",
      "#1 ALP 42/18",
      "#2 BRV 38/15",
      "",
      "Body:",
      "Reusable body for Alpha Team",
    ].join("\n"),
  );
  assert.equal(result.content, result.publicContent);
  assert.ok(!result.publicContent?.includes("T Final Result"));
});

test("final result backup post renders corrected final content after reset", async () => {
  const calls: string[] = [];
  const api = createApi({
    listResultBackups: async (params: any) => {
      calls.push(`list:${params.sessionId}:${params.kind}`);
      return [
        {
          id: "backup-overall",
          kind: "OVERALL",
          sessionId: "session-1",
        },
      ];
    },
    getResultBackup: async (backupId: string) => {
      calls.push(`get:${backupId}`);
      return {
        id: backupId,
        organizationId: "org-1",
        sessionId: "session-1",
        sourceMatchId: null,
        kind: "OVERALL",
        source: "Final result posted",
        matchNumber: null,
        matchName: null,
        sessionName: "Final Session",
        title: "Final Session Overall Ranking",
        postedChannelId: null,
        postedMessageId: null,
        repostedAt: null,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        session: { id: "session-1", name: "Final Session" },
        rows: [
          {
            id: "row-1",
            rank: 1,
            teamId: "team-1",
            teamName: "Alpha Team",
            teamTag: "ALP",
            logoUrl: null,
            slotNumber: null,
            placement: null,
            wwcd: 2,
            placementPoints: 24,
            kills: 18,
            totalPoints: 42,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          {
            id: "row-2",
            rank: 2,
            teamId: "team-2",
            teamName: "Bravo Team",
            teamTag: "BRV",
            logoUrl: null,
            slotNumber: null,
            placement: null,
            wwcd: 1,
            placementPoints: 23,
            kills: 15,
            totalPoints: 38,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
      };
    },
    getResultBackupRenderImage: async (backupId: string, kind: string) => {
      calls.push(`render:${backupId}:${kind}`);
      return Buffer.from([9]);
    },
  });
  const service = new DiscordSessionService(api as any);

  const result = await service.buildFinalResultBackupPost(
    "session-1",
    createSessionDiscordConfig({
      sessionId: "session-1",
      emojis: {
        trophy: "T",
        finalResultWinnerCount: "2",
        finalResultMessageTemplate: "{trophy} Corrected Final\n{winners}",
        finalResultWinnerRowTemplate: "#{rank} {teamTag} {points}/{kills}",
      },
    }),
  );

  assert.deepEqual(calls, [
    "list:session-1:OVERALL",
    "get:backup-overall",
    "render:backup-overall:overall-ranking",
  ]);
  assert.equal(result.backupId, "backup-overall");
  assert.equal(
    result.publicContent,
    ["T Corrected Final", "#1 ALP 42/18", "#2 BRV 38/15"].join("\n"),
  );
  assert.equal(result.imageFiles?.[0]?.name, "overall-ranking.png");
});

test("final result winner rows use custom emojis by rank", async () => {
  const api = createApi({
    getMatchRenderImage: async () => Buffer.from([1]),
    getSessionStandings: async () => ({
      sessionId: "session-1",
      teams: [
        {
          teamId: "team-1",
          teamName: "Alpha Team",
          tag: "ALP",
          totalPoints: 42,
          totalKills: 18,
          placementPoints: 24,
          wwcd: 2,
          matchesPlayed: 3,
          avgPlacement: 1.67,
          rank: 1,
        },
        {
          teamId: "team-2",
          teamName: "Bravo Team",
          tag: "BRV",
          totalPoints: 38,
          totalKills: 15,
          placementPoints: 23,
          wwcd: 1,
          matchesPlayed: 3,
          avgPlacement: 2.1,
          rank: 2,
        },
        {
          teamId: "team-3",
          teamName: "Charlie Team",
          tag: "CHL",
          totalPoints: 31,
          totalKills: 12,
          placementPoints: 19,
          wwcd: 0,
          matchesPlayed: 3,
          avgPlacement: 4.2,
          rank: 3,
        },
      ],
    }),
  });
  const service = new DiscordSessionService(api as any);

  const result = await service.buildFinalResultPost(
    "match-1",
    createSessionDiscordConfig({
      sessionId: "session-1",
      emojis: {
        finalResultWinnerCount: "3",
        finalResultRankEmojis:
          "1 = <:gold:111111111111111111>\n<:silver:222222222222222222>\n#3 <:bronze:333333333333333333>",
        finalResultMessageTemplate: "{winners}",
        finalResultWinnerRowTemplate:
          "{rankEmoji} #{rank} {teamName} - {points} pts / {kills} kills",
      },
    }),
  );

  assert.equal(
    result.publicContent,
    [
      "<:gold:111111111111111111> #1 Alpha Team - 42 pts / 18 kills",
      "<:silver:222222222222222222> #2 Bravo Team - 38 pts / 15 kills",
      "<:bronze:333333333333333333> #3 Charlie Team - 31 pts / 12 kills",
    ].join("\n"),
  );
});

test("final result post upgrades legacy default copy to champion runner-up labels", async () => {
  const api = createApi({
    getMatchRenderImage: async () => Buffer.from([1]),
    getSessionStandings: async () => ({
      sessionId: "session-1",
      teams: [
        {
          teamId: "team-1",
          teamName: "Alpha Team",
          tag: "ALP",
          totalPoints: 42,
          totalKills: 18,
          placementPoints: 24,
          wwcd: 2,
          matchesPlayed: 3,
          avgPlacement: 1.67,
          rank: 1,
        },
        {
          teamId: "team-2",
          teamName: "Bravo Team",
          tag: "BRV",
          totalPoints: 38,
          totalKills: 15,
          placementPoints: 23,
          wwcd: 1,
          matchesPlayed: 3,
          avgPlacement: 2.1,
          rank: 2,
        },
        {
          teamId: "team-3",
          teamName: "Charlie Team",
          tag: "CHL",
          totalPoints: 31,
          totalKills: 12,
          placementPoints: 19,
          wwcd: 0,
          matchesPlayed: 3,
          avgPlacement: 4.2,
          rank: 3,
        },
      ],
    }),
  });
  const service = new DiscordSessionService(api as any);

  const result = await service.buildFinalResultPost(
    "match-1",
    createSessionDiscordConfig({
      sessionId: "session-1",
      emojis: {
        trophy: "T",
        finalResultWinnerCount: "3",
        finalResultMessageTemplate:
          "{trophy} Final Results\n\nChampion: {winner}\n\nTop teams:\n{winners}",
        finalResultWinnerRowTemplate:
          "{rank}. {teamTag} - {points} pts ({kills} kills)",
      },
    }),
  );

  assert.equal(
    result.publicContent,
    [
      "T Final Results",
      "",
      "T **Champions:** Alpha Team - 42 pts (18 kills)",
      "\uD83E\uDD48 **1st Runner-up:** Bravo Team - 38 pts (15 kills)",
      "\uD83E\uDD49 **2nd Runner-up:** Charlie Team - 31 pts (12 kills)",
    ].join("\n"),
  );
  assert.ok(!result.content.includes("Match ID:"));
});

test("createScrim refuses guild creation when the server is not linked", async () => {
  const api = createApi({
    resolveDiscordGuild: async () => {
      throw new Error("Discord server is not linked to an organization");
    },
    createSession: async () => {
      throw new Error("createSession should not be called");
    },
  });
  const service = new DiscordSessionService(api as any);

  await assert.rejects(
    () =>
      service.createScrim("creator-1", "Unlinked Scrim", 23, {
        id: "guild-unlinked",
      } as Guild),
    /not linked to an Arenzyra organization/,
  );
});

test("saved separate IDP role becomes legacy cleanup while slot role opens IDP", () => {
  const service = new DiscordSessionService(createApi({}) as any);
  const setup = (service as any).setupFromConfig(
    createSessionDiscordConfig({
      categoryId: "category-1",
      registrationChannelId: "registration-channel",
      slotListChannelId: "slot-list-channel",
      waitlistChannelId: "waitlist-channel",
      slotRoleId: "slot-role",
      slotRoleName: "Slot",
      waitlistRoleId: "waitlist-role",
      waitlistRoleName: "Waitlist",
      idpRoleId: "idp-role",
      idpRoleName: "IDP",
    }),
  );

  assert.equal(setup.idpRoleId, "slot-role");
  assert.equal(setup.idpRoleName, "Slot");
  assert.equal(setup.legacyIdpRoleId, "idp-role");
  assert.deepEqual(
    (service as any).desiredScrimRoleIds(createSessionRegistration(), setup),
    ["slot-role"],
  );
  assert.deepEqual((service as any).scrimManagedRoleIds(setup), [
    "slot-role",
    "waitlist-role",
    "idp-role",
  ]);
});

test("persistManagedMessageIds merges IDs into the latest Discord config", async () => {
  const stale = createSessionDiscordConfig({
    emojis: {
      registrationManualState: "closed",
      managedRegistrationPanelMessageId: "old-panel",
    },
  });
  const latest = createSessionDiscordConfig({
    emojis: {
      registrationManualState: "open",
      managedRegistrationPanelMessageId: "old-panel",
    },
  });
  let savedPayload: any = null;
  const api = createApi({
    getSessionDiscordConfig: async () => latest,
    updateSessionDiscordConfig: async (_sessionId: string, payload: any) => {
      savedPayload = payload;
      return createSessionDiscordConfig({ emojis: payload.emojis });
    },
  });
  const service = new DiscordSessionService(api as any);

  await (service as any).persistManagedMessageIds("session-1", stale, {
    managedRegistrationPanelMessageId: "new-panel",
  });

  assert.equal(savedPayload.emojis.registrationManualState, "open");
  assert.equal(
    savedPayload.emojis.managedRegistrationPanelMessageId,
    "new-panel",
  );
});

test("freeSlotStatusMessage counts normal and VIP free slots only", async () => {
  const session = createSessionResponse({ slotCount: 6 });
  const config = createSessionDiscordConfig({
    startSlot: 3,
    normalSlots: 2,
    vipSlots: 2,
    emojis: {
      slot: "SLOT",
      vip: "VIP",
    },
  });
  const registrations = [
    createSessionRegistration({
      id: "registration-1",
      slotNumber: 3,
      status: "CONFIRMED",
    }),
    createSessionRegistration({
      id: "registration-2",
      teamId: "team-2",
      slotNumber: 5,
      status: "CHECKED_IN",
    }),
    createSessionRegistration({
      id: "registration-3",
      teamId: "team-3",
      slotNumber: 4,
      status: "REMOVED",
    }),
    createSessionRegistration({
      id: "registration-4",
      teamId: "team-4",
      slotNumber: null,
      waitlistPosition: 1,
      status: "WAITLIST",
    }),
  ];
  const service = new DiscordSessionService(
    createApi({
      getSession: async () => session,
      getSessionDiscordConfig: async () => config,
      listRegistrations: async () => registrations,
    }) as any,
  );

  const message = await service.freeSlotStatusMessage("session-1");

  assert.equal(message, "\u{1F4CB} Free slots: 1\n\u2B50 Free VIP slots: 1");
  assert(!message.includes("#"));
  assert(!/waitlist/i.test(message));
});

test("persistDiscordSetupConfig keeps the latest registration manual state", async () => {
  const stale = createSessionDiscordConfig({
    manageRoleIds: ["old-staff-role"],
    emojis: {
      registrationManualState: "closed",
      staffRoleId: "old-staff-role",
    },
  });
  const latest = createSessionDiscordConfig({
    emojis: {
      registrationManualState: "open",
      staffRoleId: "old-staff-role",
    },
  });
  let savedPayload: any = null;
  const api = createApi({
    getSessionDiscordConfig: async () => latest,
    updateSessionDiscordConfig: async (_sessionId: string, payload: any) => {
      savedPayload = payload;
      return createSessionDiscordConfig({
        ...payload,
        emojis: payload.emojis,
      });
    },
  });
  const service = new DiscordSessionService(api as any);

  await (service as any).persistDiscordSetupConfig(
    "session-1",
    createScrimDiscordSetup(),
    "guild-1",
    stale,
  );

  assert.equal(savedPayload.emojis.registrationManualState, "open");
  assert.equal(savedPayload.emojis.staffRoleId, "staff-role");
  assert.deepEqual(savedPayload.manageRoleIds, ["staff-role"]);
});

test("persistDiscordSetupConfig keeps configured server staff roles instead of adding fallback role", async () => {
  const latest = createSessionDiscordConfig({
    manageRoleIds: ["server-staff-role"],
    emojis: {
      registrationManualState: "open",
      staffRoleId: "old-bot-staff-role",
    },
  });
  let savedPayload: any = null;
  const api = createApi({
    getSessionDiscordConfig: async () => latest,
    updateSessionDiscordConfig: async (_sessionId: string, payload: any) => {
      savedPayload = payload;
      return createSessionDiscordConfig({
        ...payload,
        emojis: payload.emojis,
      });
    },
  });
  const service = new DiscordSessionService(api as any);

  await (service as any).persistDiscordSetupConfig(
    "session-1",
    createScrimDiscordSetup({
      staffRoleId: "server-staff-role",
      staffRoleName: "Server Staff",
    }),
    "guild-1",
    latest,
  );

  assert.equal(savedPayload.emojis.registrationManualState, "open");
  assert.equal(savedPayload.emojis.staffRoleId, "server-staff-role");
  assert.deepEqual(savedPayload.manageRoleIds, ["server-staff-role"]);
});

test("setRegistrationChannelState stores manual override for weekly registration schedules", async () => {
  const setup = createScrimDiscordSetup();
  const alwaysOpenSchedule = JSON.stringify({
    sunday: { enabled: true, open: "00:00", close: "00:00" },
    monday: { enabled: true, open: "00:00", close: "00:00" },
    tuesday: { enabled: true, open: "00:00", close: "00:00" },
    wednesday: { enabled: true, open: "00:00", close: "00:00" },
    thursday: { enabled: true, open: "00:00", close: "00:00" },
    friday: { enabled: true, open: "00:00", close: "00:00" },
    saturday: { enabled: true, open: "00:00", close: "00:00" },
  });
  const config = createSessionDiscordConfig({
    ...(setup as Partial<SessionDiscordConfigResponse>),
    guildId: "guild-1",
    emojis: {
      check: "CHECK",
      warning: "WARN",
      registrationTimeZone: "UTC",
      registrationWeeklySchedule: alwaysOpenSchedule,
      staffRoleId: "staff-role",
      staffRoleName: "Staff",
    },
  });
  const savedPayloads: any[] = [];
  const api = createApi({
    getSession: async () => createSessionResponse(),
    getSessionDiscordConfig: async () => config,
    updateSession: async (_sessionId: string, payload: any) =>
      createSessionResponse({
        status: payload.status ?? "OPEN",
        registrationOpenAt: payload.registrationOpenAt ?? null,
        registrationCloseAt: payload.registrationCloseAt ?? null,
      }),
    updateSessionDiscordConfig: async (_sessionId: string, payload: any) => {
      savedPayloads.push(payload);
      return createSessionDiscordConfig({
        ...config,
        emojis: payload.emojis ?? config.emojis,
      });
    },
  });
  const scrimSetup = {
    syncRegistrationChannelState: async () => ({ id: "panel-message" }),
  };
  const service = new DiscordSessionService(api as any, scrimSetup as any);

  const result = await service.setRegistrationChannelState(
    { id: "guild-1" } as Guild,
    "session-1",
    "open",
  );

  assert.match(result, /Registration is open/);
  assert.equal(
    savedPayloads.some(
      (payload) => payload.disableSlotAndVipRegistration === false,
    ),
    true,
  );
  assert.equal(
    savedPayloads.some(
      (payload) => payload.emojis?.registrationManualState === "open",
    ),
    false,
  );
  assert.equal(
    savedPayloads.some(
      (payload) => payload.emojis?.registrationScheduleOverrideState === "open",
    ),
    true,
  );
  assert.equal(
    savedPayloads.some((payload) =>
      Boolean(payload.emojis?.registrationScheduleOverrideUpdatedAt),
    ),
    true,
  );
  assert.equal(
    savedPayloads.some(
      (payload) => payload.emojis?.registrationScheduleOverrideState === "",
    ),
    false,
  );
  assert.equal(
    savedPayloads.at(-1)?.emojis?.managedRegistrationPanelMessageId,
    "panel-message",
  );

  const closeResult = await service.setRegistrationChannelState(
    { id: "guild-1" } as Guild,
    "session-1",
    "closed",
  );

  assert.match(closeResult, /Registration is closed/);
  assert.equal(
    savedPayloads.some(
      (payload) =>
        payload.emojis?.registrationScheduleOverrideState === "closed",
    ),
    true,
  );
  assert.equal(
    savedPayloads.some(
      (payload) => payload.disableSlotAndVipRegistration === true,
    ),
    true,
  );
});

test("weekly registration schedule clears manual closed override at the next open window", async () => {
  const config = createSessionDiscordConfig({
    disableSlotAndVipRegistration: true,
    emojis: {
      registrationTimeZone: "UTC",
      registrationWeeklySchedule: JSON.stringify({
        monday: { enabled: true, open: "10:00", close: "12:00" },
      }),
      registrationScheduleOverrideState: "closed",
      registrationScheduleOverrideUpdatedAt: "2026-05-04T09:30:00.000Z",
    },
  });
  const savedPayloads: any[] = [];
  const savedSessionPayloads: any[] = [];
  const api = createApi({
    updateSession: async (_sessionId: string, payload: any) => {
      savedSessionPayloads.push(payload);
      return createSessionResponse({
        registrationOpenAt: payload.registrationOpenAt ?? null,
        registrationCloseAt: payload.registrationCloseAt ?? null,
      });
    },
    updateSessionDiscordConfig: async (_sessionId: string, payload: any) => {
      savedPayloads.push(payload);
      return createSessionDiscordConfig({
        ...config,
        disableSlotAndVipRegistration:
          payload.disableSlotAndVipRegistration ??
          config.disableSlotAndVipRegistration,
        emojis: payload.emojis ?? config.emojis,
      });
    },
  });
  const service = new DiscordSessionService(api as any);

  const result = await (
    service as any
  ).applyDueWeeklyRegistrationScheduleTransition(
    createSessionResponse({
      registrationCloseAt: "2026-05-04T09:30:00.000Z",
    }),
    config,
    new Date("2026-05-04T10:01:00.000Z"),
  );

  assert.equal(savedPayloads.length, 1);
  assert.equal(savedSessionPayloads.length, 1);
  assert.equal(savedPayloads[0].disableSlotAndVipRegistration, false);
  assert.equal(savedPayloads[0].emojis.registrationScheduleOverrideState, "");
  assert.equal(
    savedPayloads[0].emojis.registrationScheduleOverrideUpdatedAt,
    "",
  );
  assert.equal(savedSessionPayloads[0].registrationOpenAt, null);
  assert.equal(savedSessionPayloads[0].registrationCloseAt, null);
  assert.equal(result.config.disableSlotAndVipRegistration, false);
  assert.equal(result.config.emojis?.registrationScheduleOverrideState, "");
});

test("weekly registration schedule keeps manual close during the current open window", async () => {
  const config = createSessionDiscordConfig({
    disableSlotAndVipRegistration: true,
    emojis: {
      registrationTimeZone: "UTC",
      registrationWeeklySchedule: JSON.stringify({
        monday: { enabled: true, open: "10:00", close: "12:00" },
      }),
      registrationScheduleOverrideState: "closed",
      registrationScheduleOverrideUpdatedAt: "2026-05-04T10:30:00.000Z",
    },
  });
  const savedPayloads: any[] = [];
  const savedSessionPayloads: any[] = [];
  const api = createApi({
    updateSession: async (_sessionId: string, payload: any) => {
      savedSessionPayloads.push(payload);
      return createSessionResponse({
        registrationOpenAt: payload.registrationOpenAt ?? null,
        registrationCloseAt: payload.registrationCloseAt ?? null,
      });
    },
    updateSessionDiscordConfig: async (_sessionId: string, payload: any) => {
      savedPayloads.push(payload);
      return createSessionDiscordConfig({
        ...config,
        disableSlotAndVipRegistration:
          payload.disableSlotAndVipRegistration ??
          config.disableSlotAndVipRegistration,
        emojis: payload.emojis ?? config.emojis,
      });
    },
  });
  const service = new DiscordSessionService(api as any);

  const result = await (
    service as any
  ).applyDueWeeklyRegistrationScheduleTransition(
    createSessionResponse({
      registrationCloseAt: "2026-05-04T10:30:00.000Z",
    }),
    config,
    new Date("2026-05-04T10:45:00.000Z"),
  );

  assert.equal(savedPayloads.length, 0);
  assert.equal(savedSessionPayloads.length, 0);
  assert.equal(result.config.disableSlotAndVipRegistration, true);
  assert.equal(
    result.config.emojis?.registrationScheduleOverrideState,
    "closed",
  );
});

test("weekly registration schedule keeps manual open override after the close window", async () => {
  const config = createSessionDiscordConfig({
    emojis: {
      registrationTimeZone: "UTC",
      registrationWeeklySchedule: JSON.stringify({
        monday: { enabled: true, open: "10:00", close: "12:00" },
      }),
      registrationScheduleOverrideState: "open",
    },
  });
  const savedPayloads: any[] = [];
  const savedSessionPayloads: any[] = [];
  const api = createApi({
    updateSession: async (_sessionId: string, payload: any) => {
      savedSessionPayloads.push(payload);
      return createSessionResponse({
        registrationOpenAt: payload.registrationOpenAt ?? null,
        registrationCloseAt: payload.registrationCloseAt ?? null,
      });
    },
    updateSessionDiscordConfig: async (_sessionId: string, payload: any) => {
      savedPayloads.push(payload);
      return createSessionDiscordConfig({
        ...config,
        disableSlotAndVipRegistration:
          payload.disableSlotAndVipRegistration ??
          config.disableSlotAndVipRegistration,
        emojis: payload.emojis ?? config.emojis,
      });
    },
  });
  const service = new DiscordSessionService(api as any);

  const result = await (
    service as any
  ).applyDueWeeklyRegistrationScheduleTransition(
    createSessionResponse({
      registrationOpenAt: "2026-05-04T10:01:00.000Z",
    }),
    config,
    new Date("2026-05-04T12:01:00.000Z"),
  );

  assert.equal(savedPayloads.length, 0);
  assert.equal(savedSessionPayloads.length, 0);
  assert.equal(result.config.emojis?.registrationScheduleOverrideState, "open");
});

test("setWaitlistPromotionChannelState stores override for weekly waitlist schedules", async () => {
  const weeklySchedule = JSON.stringify({
    monday: { enabled: true, open: "10:00", close: "12:00" },
  });
  const config = createSessionDiscordConfig({
    guildId: "guild-1",
    waitlistChannelId: "waitlist-channel",
    emojis: {
      check: "CHECK",
      warning: "WARN",
      waitlistPromotionTimeZone: "UTC",
      waitlistPromotionWeeklySchedule: weeklySchedule,
      waitlistPromotionManualState: "closed",
    },
  });
  const savedPayloads: any[] = [];
  const api = createApi({
    getSession: async () => createSessionResponse({ slotCount: 25 }),
    getSessionDiscordConfig: async () => config,
    listRegistrations: async () => [],
    updateSessionDiscordConfig: async (_sessionId: string, payload: any) => {
      savedPayloads.push(payload);
      return createSessionDiscordConfig({
        ...config,
        emojis: payload.emojis ?? config.emojis,
      });
    },
  });
  const service = new DiscordSessionService(api as any);
  (service as any).syncVisibleDiscordMessagesFast = async () => true;
  (service as any).syncDiscordScrimStateInBackground = () => undefined;
  (service as any).sendDiscordActionLog = async () => undefined;

  const result = await service.setWaitlistPromotionChannelState(
    { id: "guild-1" } as Guild,
    "session-1",
    "open",
  );

  assert.match(result, /Waitlist promotion is open/);
  assert.equal(savedPayloads.length, 1);
  assert.equal(savedPayloads[0].emojis.waitlistPromotionManualState, "");
  assert.equal(
    savedPayloads[0].emojis.waitlistPromotionScheduleOverrideState,
    "open",
  );
  assert.ok(savedPayloads[0].emojis.waitlistPromotionScheduleOverrideUpdatedAt);
});

test("weekly waitlist promotion schedule clears old manual closed override", async () => {
  const config = createSessionDiscordConfig({
    emojis: {
      waitlistPromotionTimeZone: "UTC",
      waitlistPromotionWeeklySchedule: JSON.stringify({
        monday: { enabled: true, open: "10:00", close: "12:00" },
      }),
      waitlistPromotionScheduleOverrideState: "closed",
      waitlistPromotionScheduleOverrideUpdatedAt: "2026-05-04T09:30:00.000Z",
    },
  });
  const savedPayloads: any[] = [];
  const api = createApi({
    updateSessionDiscordConfig: async (_sessionId: string, payload: any) => {
      savedPayloads.push(payload);
      return createSessionDiscordConfig({
        ...config,
        emojis: payload.emojis ?? config.emojis,
      });
    },
  });
  const service = new DiscordSessionService(api as any);

  const result = await (
    service as any
  ).applyDueWeeklyWaitlistPromotionScheduleTransition(
    createSessionResponse({ status: "OPEN" }),
    config,
    new Date("2026-05-04T10:01:00.000Z"),
  );

  assert.equal(savedPayloads.length, 1);
  assert.equal(
    savedPayloads[0].emojis.waitlistPromotionScheduleOverrideState,
    "",
  );
  assert.equal(
    savedPayloads[0].emojis.waitlistPromotionScheduleOverrideUpdatedAt,
    "",
  );
  assert.equal(
    result.config.emojis?.waitlistPromotionScheduleOverrideState,
    "",
  );
});

test("weekly waitlist promotion schedule keeps manual close inside current window", async () => {
  const config = createSessionDiscordConfig({
    emojis: {
      waitlistPromotionTimeZone: "UTC",
      waitlistPromotionWeeklySchedule: JSON.stringify({
        monday: { enabled: true, open: "10:00", close: "12:00" },
      }),
      waitlistPromotionScheduleOverrideState: "closed",
      waitlistPromotionScheduleOverrideUpdatedAt: "2026-05-04T10:30:00.000Z",
    },
  });
  const savedPayloads: any[] = [];
  const api = createApi({
    updateSessionDiscordConfig: async (_sessionId: string, payload: any) => {
      savedPayloads.push(payload);
      return createSessionDiscordConfig({
        ...config,
        emojis: payload.emojis ?? config.emojis,
      });
    },
  });
  const service = new DiscordSessionService(api as any);

  const result = await (
    service as any
  ).applyDueWeeklyWaitlistPromotionScheduleTransition(
    createSessionResponse({ status: "OPEN" }),
    config,
    new Date("2026-05-04T10:45:00.000Z"),
  );

  assert.equal(savedPayloads.length, 0);
  assert.equal(
    result.config.emojis?.waitlistPromotionScheduleOverrideState,
    "closed",
  );
});

test("access announcement recreates a missing stored VIP message", async () => {
  const config = createSessionDiscordConfig({
    guildId: "guild-1",
    registrationChannelId: "registration-1",
    vipAccessRoleId: "vip-role",
    vipAccessRoleName: "VIP",
    emojis: {
      vipAccessEnabled: "true",
      vipAccessOpensAt: "2026-01-01T00:00:00.000Z",
      vipAccessClosesAt: "2027-01-01T00:00:00.000Z",
      vipAccessMessageEnabled: "true",
      vipAccessOpenMessageText: "{role} VIP open for {session}",
      managedVipAccessStatusState: "open",
      managedVipAccessStatusMessageId: "123456789012345678",
    },
  });
  const sentPayloads: any[] = [];
  const savedPayloads: any[] = [];
  const channel = {
    client: { user: { id: "bot-1" } },
    isTextBased: () => true,
    isDMBased: () => false,
    messages: {
      fetch: async (query: unknown) => {
        if (typeof query === "string") {
          return null;
        }
        return new Collection();
      },
    },
    send: async (payload: any) => {
      sentPayloads.push(payload);
      return { id: "new-vip-message" };
    },
  };
  const guild = {
    id: "guild-1",
    name: "Guild One",
    channels: {
      fetch: async (channelId: string) =>
        channelId === "registration-1" ? channel : null,
    },
  };
  const api = createApi({
    getSessionDiscordConfig: async () => config,
    updateSessionDiscordConfig: async (_sessionId: string, payload: any) => {
      savedPayloads.push(payload);
      return createSessionDiscordConfig({
        ...config,
        emojis: payload.emojis ?? config.emojis,
      });
    },
  });
  const service = new DiscordSessionService(api as any, {} as any);

  await (service as any).syncAccessAnnouncement(
    guild,
    createSessionResponse({ id: "session-1", name: "20 SCRIM" }),
    config,
    "vipAccess",
  );

  assert.equal(sentPayloads.length, 1);
  assert.match(sentPayloads[0].content, /VIP open for 20 SCRIM/);
  assert.equal(
    savedPayloads.at(-1).emojis.managedVipAccessStatusMessageId,
    "new-vip-message",
  );
});

test("access announcement recovers a recent VIP message instead of reposting", async () => {
  const config = createSessionDiscordConfig({
    guildId: "guild-1",
    registrationChannelId: "registration-1",
    vipAccessRoleId: "vip-role",
    vipAccessRoleName: "VIP",
    emojis: {
      vipAccessEnabled: "true",
      vipAccessOpensAt: "2026-01-01T00:00:00.000Z",
      vipAccessClosesAt: "2027-01-01T00:00:00.000Z",
      vipAccessMessageEnabled: "true",
      vipAccessOpenMessageText: "{role} VIP open for {session}",
      managedVipAccessStatusState: "open",
      managedVipAccessStatusMessageId: "123456789012345678",
    },
  });
  const sentPayloads: any[] = [];
  const savedPayloads: any[] = [];
  const deletedIds: string[] = [];
  const recentMessage = {
    id: "recent-vip-message",
    author: { id: "bot-1" },
    content: "**VIP Access Open**\n\n<@&vip-role> VIP open for 20 SCRIM",
    embeds: [],
    createdTimestamp: 2000,
    delete: async () => {
      deletedIds.push("recent-vip-message");
    },
  };
  const oldDuplicate = {
    id: "old-vip-message",
    author: { id: "bot-1" },
    content: "**VIP Access Open**\n\n<@&vip-role> VIP open for 20 SCRIM",
    embeds: [],
    createdTimestamp: 1000,
    delete: async () => {
      deletedIds.push("old-vip-message");
    },
  };
  const channel = {
    client: { user: { id: "bot-1" } },
    isTextBased: () => true,
    isDMBased: () => false,
    messages: {
      fetch: async (query: unknown) => {
        if (typeof query === "string") {
          return null;
        }
        return new Collection([
          [recentMessage.id, recentMessage],
          [oldDuplicate.id, oldDuplicate],
        ]);
      },
    },
    send: async (payload: any) => {
      sentPayloads.push(payload);
      return { id: "new-vip-message" };
    },
  };
  const guild = {
    id: "guild-1",
    name: "Guild One",
    channels: {
      fetch: async (channelId: string) =>
        channelId === "registration-1" ? channel : null,
    },
  };
  const api = createApi({
    getSessionDiscordConfig: async () => config,
    updateSessionDiscordConfig: async (_sessionId: string, payload: any) => {
      savedPayloads.push(payload);
      return createSessionDiscordConfig({
        ...config,
        emojis: payload.emojis ?? config.emojis,
      });
    },
  });
  const service = new DiscordSessionService(api as any, {} as any);

  await (service as any).syncAccessAnnouncement(
    guild,
    createSessionResponse({ id: "session-1", name: "20 SCRIM" }),
    config,
    "vipAccess",
  );

  assert.equal(sentPayloads.length, 0);
  assert.deepEqual(deletedIds, ["old-vip-message"]);
  assert.equal(
    savedPayloads.at(-1).emojis.managedVipAccessStatusMessageId,
    "recent-vip-message",
  );
});

test("VIP access window uses weekly schedule before legacy date window", () => {
  const weeklySchedule = JSON.stringify({
    monday: { enabled: true, open: "10:00", close: "11:00" },
  });
  const config = createSessionDiscordConfig({
    emojis: {
      vipAccessEnabled: "true",
      vipAccessWeeklySchedule: weeklySchedule,
      vipAccessTimeZone: "UTC",
      vipAccessOpensAt: "2030-01-01T00:00:00.000Z",
      vipAccessClosesAt: "2030-01-02T00:00:00.000Z",
    },
  });
  const service = new DiscordSessionService({} as any, {} as any);

  const openWindow = (service as any).accessWindow(
    config,
    "vipAccess",
    new Date("2026-05-04T10:30:00.000Z"),
  );
  const closedWindow = (service as any).accessWindow(
    config,
    "vipAccess",
    new Date("2026-05-04T11:30:00.000Z"),
  );

  assert.equal(openWindow.configured, true);
  assert.equal(openWindow.allowsAction, true);
  assert.equal(openWindow.state, "open");
  assert.equal(closedWindow.configured, true);
  assert.equal(closedWindow.allowsAction, false);
  assert.equal(closedWindow.state, "closed");
});

test("custom role access groups allow only their configured registration mode", async () => {
  const config = createSessionDiscordConfig({
    emojis: {
      roleAccessGroups: JSON.stringify({
        version: 1,
        groups: [
          {
            id: "vip-test",
            name: "VIP Test",
            roleId: "vip-role",
            roleName: "VIP",
            mode: "vip",
            enabled: true,
            timeZone: "UTC",
            weeklySchedule: JSON.stringify({
              monday: { enabled: true, open: "10:00", close: "11:00" },
            }),
          },
        ],
      }),
    },
  });
  const guild = {
    members: {
      fetch: async () => ({
        roles: {
          cache: {
            has: (roleId: string) => roleId === "vip-role",
          },
        },
      }),
    },
  } as unknown as Guild;
  const service = new DiscordSessionService(createApi({}) as any, {} as any);
  const now = new Date("2026-05-04T10:30:00.000Z");

  assert.equal(
    await service.userHasCustomRoleRegistrationAccess(
      "user-1",
      guild,
      config,
      "vip",
      now,
    ),
    true,
  );
  assert.equal(
    await service.userHasCustomRoleRegistrationAccess(
      "user-1",
      guild,
      config,
      "normal",
      now,
    ),
    false,
  );
  assert.equal(
    await service.userHasCustomRoleRegistrationAccess(
      "user-1",
      guild,
      config,
      "vip",
      new Date("2026-05-04T11:30:00.000Z"),
    ),
    false,
  );
});

test("registration refresh candidates list sessions in each linked guild organization", async () => {
  const organizationScopes: Array<string | null | undefined> = [];
  const api = createApi({
    resolveDiscordGuild: async (guildId: string) => ({
      organizationId: guildId === "guild-a" ? "org-a" : "org-b",
      organizationName: guildId,
      organizationSlug: guildId,
      guildId,
      guildName: guildId,
      source: "guild-link",
    }),
    withOrganization: async (
      organizationId: string | null | undefined,
      fn: () => Promise<unknown>,
    ) => {
      organizationScopes.push(organizationId);
      return fn();
    },
    listSessions: async () => [
      createSessionResponse({
        id: `session-${organizationScopes.at(-1)}`,
      }),
    ],
  });
  const service = new DiscordSessionService(api as any);
  const client = {
    guilds: {
      cache: new Collection([
        ["guild-a", { id: "guild-a" }],
        ["guild-b", { id: "guild-b" }],
      ]),
    },
  };

  const result = await (service as any).listRegistrationRefreshCandidates(
    client,
  );

  assert.deepEqual(organizationScopes, ["org-a", "org-b"]);
  assert.deepEqual(
    result.map((entry: any) => [
      entry.guild.id,
      entry.organizationId,
      entry.session.id,
    ]),
    [
      ["guild-a", "org-a", "session-org-a"],
      ["guild-b", "org-b", "session-org-b"],
    ],
  );
});

test("confirmation window refresh skips a bad session and continues", async () => {
  const refreshedSessions: string[] = [];
  const api = createApi({
    resolveDiscordGuild: async (guildId: string) => ({
      organizationId: "org-a",
      organizationName: "Org A",
      organizationSlug: "org-a",
      guildId,
      guildName: guildId,
      source: "guild-link",
    }),
    withOrganization: async (
      _organizationId: string | null | undefined,
      fn: () => Promise<unknown>,
    ) => fn(),
    listSessions: async () => [
      createSessionResponse({ id: "bad-session" }),
      createSessionResponse({ id: "good-session" }),
    ],
    getSessionDiscordConfig: async (sessionId: string) =>
      createSessionDiscordConfig({
        sessionId,
        guildId: "guild-a",
      }),
  });
  const service = new DiscordSessionService(api as any);
  (service as any).applyDueWeeklyRegistrationScheduleTransition = async (
    session: SessionResponse,
    config: SessionDiscordConfigResponse,
  ) => ({ session, config });
  (service as any).runDueAutoCleanups = async (
    _guild: Guild,
    session: SessionResponse,
  ) => {
    if (session.id === "bad-session") {
      throw new Error("bad session config");
    }
  };
  (service as any).syncAccessWindowAnnouncements = async (
    _guild: Guild,
    session: SessionResponse,
  ) => {
    refreshedSessions.push(session.id);
  };
  (service as any).runDueConfirmationReminders = async () => undefined;
  (service as any).scheduleRegistrationWindowSync = () => undefined;
  (service as any).syncRegistrationWindowStateInBackground = () => undefined;
  (service as any).scheduleConfirmationWindowSync = () => undefined;
  (service as any).syncDiscordScrimMessagesInBackground = () => undefined;

  const client = {
    guilds: {
      cache: new Collection([["guild-a", { id: "guild-a" }]]),
      fetch: async () => ({ id: "guild-a" }),
    },
  };

  await (service as any).refreshConfirmationWindowSyncs(client);

  assert.deepEqual(refreshedSessions, ["good-session"]);
});

test("setRegistrationChannelState still saves Discord state when session timestamp update is blocked", async () => {
  const setup = createScrimDiscordSetup();
  const config = createSessionDiscordConfig({
    ...(setup as Partial<SessionDiscordConfigResponse>),
    guildId: "guild-1",
    emojis: {
      reject: "REJECT",
      registrationManualState: "open",
      staffRoleId: "staff-role",
      staffRoleName: "Staff",
    },
  });
  const savedPayloads: any[] = [];
  let syncedConfig: any = null;
  const api = createApi({
    getSession: async () => createSessionResponse({ status: "OPEN" }),
    getSessionDiscordConfig: async () => config,
    updateSession: async () => {
      throw new Error(
        "This organizer account is limited to Discord management.",
      );
    },
    updateSessionDiscordConfig: async (_sessionId: string, payload: any) => {
      savedPayloads.push(payload);
      return createSessionDiscordConfig({
        ...config,
        ...payload,
        emojis: payload.emojis ?? config.emojis,
      });
    },
  });
  const scrimSetup = {
    syncRegistrationChannelState: async (
      _guild: Guild,
      _setup: unknown,
      _session: unknown,
      updatedConfig: SessionDiscordConfigResponse,
    ) => {
      syncedConfig = updatedConfig;
      return { id: "panel-message" };
    },
  };
  const service = new DiscordSessionService(api as any, scrimSetup as any);

  const result = await service.setRegistrationChannelState(
    { id: "guild-1" } as Guild,
    "session-1",
    "closed",
  );

  assert.match(result, /Registration is closed/);
  assert.equal(savedPayloads[0].disableSlotAndVipRegistration, true);
  assert.equal(savedPayloads[0].emojis.registrationManualState, "closed");
  assert.equal(syncedConfig?.disableSlotAndVipRegistration, true);
  assert.equal(syncedConfig?.emojis.registrationManualState, "closed");
});

test("scheduled registration transition replaces the managed status announcement", async () => {
  const markerText = "arenzyra:session-1:registration-status";
  const deletedIds: string[] = [];
  const sentPayloads: any[] = [];
  const oldStatusMessage = {
    id: "123456789012345678",
    author: { id: "bot-1" },
    embeds: [],
    delete: async () => {
      deletedIds.push("old-status");
    },
  };
  const staleStatusMessage = {
    id: "234567890123456789",
    author: { id: "bot-1" },
    embeds: [{ footer: { text: markerText }, fields: [] }],
    delete: async () => {
      deletedIds.push("stale-status");
    },
  };
  const registrationChannel = {
    id: "registration-channel",
    client: { user: { id: "bot-1" } },
    isTextBased: () => true,
    isDMBased: () => false,
    messages: {
      fetch: async (query?: any) => {
        if (query === "123456789012345678") {
          return oldStatusMessage;
        }
        return new Collection([
          [staleStatusMessage.id, staleStatusMessage],
        ] as any);
      },
    },
    send: async (payload: any) => {
      sentPayloads.push(payload);
      return { id: "345678901234567890" };
    },
  };
  const guild = {
    id: "guild-1",
    channels: {
      fetch: async (channelId: string) =>
        channelId === "registration-channel" ? registrationChannel : null,
    },
  } as unknown as Guild;
  const setup = createScrimDiscordSetup();
  let currentConfig = createSessionDiscordConfig({
    ...(setup as Partial<SessionDiscordConfigResponse>),
    guildId: "guild-1",
    registrationChannelId: "registration-channel",
    emojis: {
      check: "CHECK",
      reject: "X",
      managedRegistrationStatusMessageId: "123456789012345678",
      managedRegistrationStatusState: "closed",
      registrationOpenAnnouncementText:
        "@everyone Registration is now open for {session}. <@&123456789012345678>",
    },
  });
  const savedPayloads: any[] = [];
  const api = createApi({
    getSession: async () => createSessionResponse(),
    getSessionDiscordConfig: async () => currentConfig,
    updateSessionDiscordConfig: async (_sessionId: string, payload: any) => {
      savedPayloads.push(payload);
      currentConfig = createSessionDiscordConfig({
        ...currentConfig,
        emojis: payload.emojis ?? currentConfig.emojis,
      });
      return currentConfig;
    },
  });
  const scrimSetup = {
    syncRegistrationChannelState: async () => ({ id: "panel-message" }),
  };
  const service = new DiscordSessionService(api as any, scrimSetup as any);

  const result = await (service as any).syncRegistrationWindowState(
    guild,
    "session-1",
    undefined,
    undefined,
    { announceTransition: true },
  );

  assert.equal(result, true);
  assert.deepEqual(deletedIds, ["old-status", "stale-status"]);
  assert.equal(sentPayloads.length, 1);
  assert.equal(sentPayloads[0].embeds, undefined);
  assert.match(sentPayloads[0].content, /\*\*Registration Open\*\*/);
  assert.match(sentPayloads[0].content, /Registration is now open/);
  assert.deepEqual(sentPayloads[0].allowedMentions, {
    parse: ["everyone"],
    roles: ["123456789012345678"],
  });
  assert.equal(
    savedPayloads.at(-1).emojis.managedRegistrationStatusMessageId,
    "345678901234567890",
  );
  assert.equal(
    savedPayloads.at(-1).emojis.managedRegistrationStatusState,
    "open",
  );
  assert.equal(
    savedPayloads.at(-1).emojis.managedRegistrationPanelMessageId,
    "panel-message",
  );
});

test("registration status announcement uses configured embed copy", async () => {
  const sentPayloads: any[] = [];
  const registrationChannel = {
    id: "registration-channel",
    client: { user: { id: "bot-1" } },
    isTextBased: () => true,
    isDMBased: () => false,
    messages: {
      fetch: async () => new Collection(),
    },
    send: async (payload: any) => {
      sentPayloads.push(payload);
      return { id: "345678901234567890" };
    },
  };
  const guild = {
    id: "guild-1",
    name: "Guild One",
    channels: {
      fetch: async (channelId: string) =>
        channelId === "registration-channel" ? registrationChannel : null,
    },
  } as unknown as Guild;
  const setup = createScrimDiscordSetup();
  let currentConfig = createSessionDiscordConfig({
    ...(setup as Partial<SessionDiscordConfigResponse>),
    guildId: "guild-1",
    registrationChannelId: "registration-channel",
    emojis: {
      check: "CHECK",
      reject: "X",
      registrationStatusAnnouncementMode: "embed",
      registrationOpenAnnouncementTitle: "Live Now: {session}",
      registrationOpenAnnouncementText: "{success} Join {session}.\n{status}",
      managedRegistrationStatusState: "closed",
    },
  });
  const api = createApi({
    getSession: async () => createSessionResponse(),
    getSessionDiscordConfig: async () => currentConfig,
    updateSessionDiscordConfig: async (_sessionId: string, payload: any) => {
      currentConfig = createSessionDiscordConfig({
        ...currentConfig,
        emojis: payload.emojis ?? currentConfig.emojis,
      });
      return currentConfig;
    },
  });
  const scrimSetup = {
    syncRegistrationChannelState: async () => ({ id: "panel-message" }),
  };
  const service = new DiscordSessionService(api as any, scrimSetup as any);

  await (service as any).syncRegistrationWindowState(
    guild,
    "session-1",
    undefined,
    undefined,
    { announceTransition: true },
  );

  assert.equal(sentPayloads.length, 1);
  assert.equal(sentPayloads[0].content, undefined);
  const embed = sentPayloads[0].embeds[0].toJSON();
  assert.equal(embed.title, "Live Now: Daily Scrim");
  assert.match(embed.description, /Join Daily Scrim\./);
  assert.match(embed.description, /Registration is open/);
});

test("parallel registration transitions send one managed status announcement", async () => {
  const sentPayloads: any[] = [];
  const deletedIds: string[] = [];
  const oldStatusMessage = {
    id: "123456789012345678",
    author: { id: "bot-1" },
    embeds: [],
    delete: async () => {
      deletedIds.push("old-status");
    },
  };
  const registrationChannel = {
    id: "registration-channel",
    client: { user: { id: "bot-1" } },
    isTextBased: () => true,
    isDMBased: () => false,
    messages: {
      fetch: async (query?: any) => {
        if (query === "123456789012345678") {
          return oldStatusMessage;
        }
        return new Collection();
      },
    },
    send: async (payload: any) => {
      sentPayloads.push(payload);
      return { id: "345678901234567890" };
    },
  };
  const guild = {
    id: "guild-1",
    channels: {
      fetch: async (channelId: string) =>
        channelId === "registration-channel" ? registrationChannel : null,
    },
  } as unknown as Guild;
  const setup = createScrimDiscordSetup();
  let currentConfig = createSessionDiscordConfig({
    ...(setup as Partial<SessionDiscordConfigResponse>),
    guildId: "guild-1",
    registrationChannelId: "registration-channel",
    emojis: {
      check: "CHECK",
      reject: "X",
      managedRegistrationStatusMessageId: "123456789012345678",
      managedRegistrationStatusState: "closed",
    },
  });
  const api = createApi({
    getSession: async () => createSessionResponse(),
    getSessionDiscordConfig: async () => currentConfig,
    updateSessionDiscordConfig: async (_sessionId: string, payload: any) => {
      currentConfig = createSessionDiscordConfig({
        ...currentConfig,
        emojis: payload.emojis ?? currentConfig.emojis,
      });
      return currentConfig;
    },
  });
  const scrimSetup = {
    syncRegistrationChannelState: async () => ({ id: "panel-message" }),
  };
  const service = new DiscordSessionService(api as any, scrimSetup as any);

  await Promise.all([
    (service as any).syncRegistrationWindowState(
      guild,
      "session-1",
      undefined,
      undefined,
      { announceTransition: true },
    ),
    (service as any).syncRegistrationWindowState(
      guild,
      "session-1",
      undefined,
      undefined,
      { announceTransition: true },
    ),
  ]);

  assert.equal(sentPayloads.length, 1);
  assert.deepEqual(deletedIds, ["old-status"]);
  assert.equal(
    currentConfig.emojis.managedRegistrationStatusMessageId,
    "345678901234567890",
  );
  assert.equal(currentConfig.emojis.managedRegistrationStatusState, "open");
});

test("previewAutomaticResultScreenshot creates the requested game match from code", async () => {
  const createdPayloads: Array<{ sessionId: string; payload: any }> = [];
  let previewPayload: any = null;
  const api = createApi({
    listSessionMatches: async () => [],
    createSessionMatch: async (sessionId: string, payload: any) => {
      createdPayloads.push({ sessionId, payload });
      return createSessionMatchResponse({
        id: "match-g1",
        sessionId,
        name: "Game 1",
        matchNumber: 1,
      });
    },
    previewScreenshotResults: async (payload: any) => {
      previewPayload = payload;
      const entry = {
        position: 1,
        tag: "DXB",
        kills: 8,
        teamId: "team-1",
        slotId: "slot-1",
        slotNumber: 3,
        status: "OK",
      };
      return {
        matchId: payload.matchId,
        preview: [entry],
        resolved: [entry],
        unresolved: [],
        ambiguous: [],
      };
    },
  });

  const service = new DiscordSessionService(api as any);
  const result = await service.previewAutomaticResultScreenshot(
    "session-1",
    "https://cdn.discordapp.com/result.png",
    "results",
    { emojis: {} },
    { matchNumber: 1 },
  );

  assert.equal(result.matchId, "match-g1");
  assert.equal(result.canApply, true);
  assert.deepEqual(
    createdPayloads.map((entry) => entry.sessionId),
    ["session-1"],
  );
  assert.equal(createdPayloads[0].payload.matchNumber, 1);
  assert.equal(createdPayloads[0].payload.dataMode, "MANUAL");
  assert.equal(createdPayloads[0].payload.dataSource, "MANUAL");
  assert.equal(createdPayloads[0].payload.resultSource, undefined);
  assert.equal(createdPayloads[0].payload.status, undefined);
  assert.equal(createdPayloads[0].payload.startAt, undefined);
  assert.equal(createdPayloads[0].payload.endsAt, undefined);
  assert.deepEqual(previewPayload, {
    matchId: "match-g1",
    imageUrl: "https://cdn.discordapp.com/result.png",
    imageUrls: ["https://cdn.discordapp.com/result.png"],
  });
  assert.match(result.content, /Game code: G1/);
  assert.match(result.content, /Created match/);
});

test("findScrimForLogoChannel matches configured logo channel ids", async () => {
  const api = createApi({
    listSessions: async () => [
      createSessionResponse({ id: "session-1", status: "ENDED" }),
    ],
    getSessionDiscordConfig: async () =>
      createSessionDiscordConfig({
        guildId: "guild-1",
        emojis: {
          discordLogoChannelIds: "<#111111111111111111>\n222222222222222222",
        },
      }),
  });
  const service = new DiscordSessionService(api as any, {} as any);

  const result = await service.findScrimForLogoChannel(
    "guild-1",
    "222222222222222222",
  );

  assert.equal(result?.session.id, "session-1");
});

test("findScrimForLogoChannel accepts organization logo channel resolver result", async () => {
  const api = createApi({
    resolveDiscordChannel: async (guildId: string, channelId: string) => ({
      session: createSessionResponse({ id: "session-global-logo" }),
      config: createSessionDiscordConfig({
        id: "config-global-logo",
        organizationId: "org-logo",
        guildId,
        emojis: {
          discordLogoChannelIds: "",
        },
      }),
      channelKind: "logos",
    }),
  });
  const service = new DiscordSessionService(api as any, {} as any);

  const result = await service.findScrimForLogoChannel(
    "guild-1",
    "222222222222222222",
  );

  assert.equal(result?.session.id, "session-global-logo");
  assert.equal(result?.organizationLogoChannel, true);
});

test("findScrimForPlayerPhotoChannel matches configured photo channel ids", async () => {
  const api = createApi({
    listSessions: async () => [
      createSessionResponse({ id: "session-1", status: "ENDED" }),
    ],
    getSessionDiscordConfig: async () =>
      createSessionDiscordConfig({
        guildId: "guild-1",
        emojis: {
          discordPlayerPhotoChannelIds:
            "<#333333333333333333>\n444444444444444444",
        },
      }),
  });
  const service = new DiscordSessionService(api as any, {} as any);

  const result = await service.findScrimForPlayerPhotoChannel(
    "guild-1",
    "444444444444444444",
  );

  assert.equal(result?.session.id, "session-1");
});

test("findScrimForRegistrationChannel resolves organization from Discord channel", async () => {
  const api = createApi({
    resolveDiscordChannel: async (guildId: string, channelId: string) => ({
      session: createSessionResponse({ id: "session-fix" }),
      config: createSessionDiscordConfig({
        id: "config-fix",
        organizationId: "org-fix",
        guildId,
        registrationChannelId: channelId,
      }),
      channelKind: "registration",
    }),
  });
  const service = new DiscordSessionService(api as any, {} as any);

  const result = await service.findScrimForRegistrationChannel(
    "guild-fix",
    "registration-fix",
  );

  assert.equal(result?.session.id, "session-fix");
  assert.equal(result?.config.organizationId, "org-fix");
  assert.equal(result?.accepting, true);
});

test("findScrimForRegistrationChannel sends topic marker fallback to API", async () => {
  let fallbackSessionId: string | null | undefined;
  let fallbackKind: string | null | undefined;
  const api = createApi({
    resolveDiscordChannel: async (
      guildId: string,
      channelId: string,
      topicSessionId?: string | null,
      topicKind?: string | null,
    ) => {
      fallbackSessionId = topicSessionId;
      fallbackKind = topicKind;
      return {
        session: createSessionResponse({ id: "session-topic" }),
        config: createSessionDiscordConfig({
          organizationId: "org-topic",
          guildId,
          registrationChannelId: "primary-registration",
        }),
        channelKind: "registration",
      };
    },
  });
  const service = new DiscordSessionService(api as any, {} as any);

  const result = await service.findScrimForRegistrationChannel(
    "guild-topic",
    "extra-registration",
    "arenzyra-session=session-topic;kind=registration",
  );

  assert.equal(result?.session.id, "session-topic");
  assert.equal(fallbackSessionId, "session-topic");
  assert.equal(fallbackKind, "registration");
});

test("findScrimForRegistrationChannel respects a weekly closed override before accepting", async () => {
  const alwaysOpenSchedule = JSON.stringify({
    sunday: { enabled: true, open: "00:00", close: "00:00" },
    monday: { enabled: true, open: "00:00", close: "00:00" },
    tuesday: { enabled: true, open: "00:00", close: "00:00" },
    wednesday: { enabled: true, open: "00:00", close: "00:00" },
    thursday: { enabled: true, open: "00:00", close: "00:00" },
    friday: { enabled: true, open: "00:00", close: "00:00" },
    saturday: { enabled: true, open: "00:00", close: "00:00" },
  });
  const config = createSessionDiscordConfig({
    disableSlotAndVipRegistration: false,
    guildId: "guild-1",
    registrationChannelId: "registration-1",
    emojis: {
      registrationTimeZone: "UTC",
      registrationWeeklySchedule: alwaysOpenSchedule,
      registrationScheduleOverrideState: "closed",
    },
  });
  const savedPayloads: any[] = [];
  const api = createApi({
    resolveDiscordChannel: async (guildId: string, channelId: string) => ({
      session: createSessionResponse({ id: "session-scheduled" }),
      config: {
        ...config,
        guildId,
        registrationChannelId: channelId,
      },
      channelKind: "registration",
    }),
    updateSessionDiscordConfig: async (_sessionId: string, payload: any) => {
      savedPayloads.push(payload);
      return createSessionDiscordConfig({
        ...config,
        disableSlotAndVipRegistration:
          payload.disableSlotAndVipRegistration ??
          config.disableSlotAndVipRegistration,
        emojis: payload.emojis ?? config.emojis,
      });
    },
  });
  const service = new DiscordSessionService(api as any, {} as any);

  const result = await service.findScrimForRegistrationChannel(
    "guild-1",
    "registration-1",
  );

  assert.equal(savedPayloads.length, 0);
  assert.equal(result?.accepting, false);
});

test("findScrimForWaitlistChannel reads registrations in the resolved organization", async () => {
  let organizationContext: string | null = null;
  let registrationLookupOrganization: string | null = null;
  const api = createApi({
    resolveDiscordChannel: async (guildId: string, channelId: string) => ({
      session: createSessionResponse({ id: "session-fix" }),
      config: createSessionDiscordConfig({
        id: "config-fix",
        organizationId: "org-fix",
        guildId,
        waitlistChannelId: channelId,
      }),
      channelKind: "waitlist",
    }),
    withOrganization: async (
      organizationId: string | null | undefined,
      fn: () => Promise<unknown>,
    ) => {
      organizationContext = organizationId ?? null;
      try {
        return await fn();
      } finally {
        organizationContext = null;
      }
    },
    listRegistrations: async (sessionId: string) => {
      registrationLookupOrganization = organizationContext;
      assert.equal(sessionId, "session-fix");
      return [];
    },
  });
  const service = new DiscordSessionService(api as any, {} as any);

  const result = await service.findScrimForWaitlistChannel(
    "guild-fix",
    "waitlist-fix",
  );

  assert.equal(result?.session.id, "session-fix");
  assert.equal(result?.config.organizationId, "org-fix");
  assert.equal(registrationLookupOrganization, "org-fix");
});

test("staff can promote a waitlist team while the waitlist window is closed", async () => {
  let placementArgs: unknown[] | null = null;
  const waitlistRegistration = createSessionRegistration({
    id: "waitlist-1",
    teamId: "team-wait",
    status: "WAITLIST",
    slotNumber: null,
    waitlistPosition: 1,
    team: {
      id: "team-wait",
      name: "Oppressors",
      tag: "OPS",
      logoUrl: null,
      countryCode: null,
      region: null,
    },
  });
  const api = createApi({
    getSession: async () => createSessionResponse({ slotCount: 3 }),
    getSessionDiscordConfig: async () =>
      createSessionDiscordConfig({
        manageRoleIds: ["staff-role"],
        startSlot: 3,
        normalSlots: 1,
      }),
    listRegistrations: async () => [waitlistRegistration],
  });
  const service = new DiscordSessionService(api as any, {} as any);
  (service as any).updateRegistrationPlacement = async (...args: unknown[]) => {
    placementArgs = args;
    return "Slot 3";
  };
  const guild = {
    members: {
      fetch: async () => ({
        permissions: { has: () => false },
        roles: { cache: { has: (roleId: string) => roleId === "staff-role" } },
      }),
    },
  } as unknown as Guild;

  const result = await service.promoteWaitlistedTeamFromDiscord(
    "staff-1",
    "staff",
    "OPS",
    "Oppressors",
    [],
    guild,
    "session-1",
  );

  assert.equal(result, "✅ Waitlist team moved to Slot 3.");
  assert.ok(placementArgs);
  assert.equal(placementArgs[1], "waitlist-1");
  assert.deepEqual(placementArgs[2], { action: "APPROVE" });
});

test("staff waitlist promotion still requires an empty normal slot", async () => {
  let placementCalled = false;
  const registrations = [
    createSessionRegistration({
      id: "confirmed-1",
      slotNumber: 3,
      status: "CONFIRMED",
    }),
    createSessionRegistration({
      id: "waitlist-1",
      teamId: "team-wait",
      status: "WAITLIST",
      slotNumber: null,
      waitlistPosition: 1,
      team: {
        id: "team-wait",
        name: "Oppressors",
        tag: "OPS",
        logoUrl: null,
        countryCode: null,
        region: null,
      },
    }),
  ];
  const api = createApi({
    getSession: async () => createSessionResponse({ slotCount: 3 }),
    getSessionDiscordConfig: async () =>
      createSessionDiscordConfig({
        manageRoleIds: ["staff-role"],
        startSlot: 3,
        normalSlots: 1,
      }),
    listRegistrations: async () => registrations,
  });
  const service = new DiscordSessionService(api as any, {} as any);
  (service as any).updateRegistrationPlacement = async () => {
    placementCalled = true;
    return "Slot 3";
  };
  const guild = {
    members: {
      fetch: async () => ({
        permissions: { has: () => false },
        roles: { cache: { has: (roleId: string) => roleId === "staff-role" } },
      }),
    },
  } as unknown as Guild;

  await assert.rejects(
    () =>
      service.promoteWaitlistedTeamFromDiscord(
        "staff-1",
        "staff",
        "OPS",
        "Oppressors",
        [],
        guild,
        "session-1",
      ),
    /No normal slot is empty/,
  );
  assert.equal(placementCalled, false);
});

test("scheduled registration can accept from a draft Discord session", async () => {
  const alwaysOpenSchedule = JSON.stringify({
    sunday: { enabled: true, open: "00:00", close: "00:00" },
    monday: { enabled: true, open: "00:00", close: "00:00" },
    tuesday: { enabled: true, open: "00:00", close: "00:00" },
    wednesday: { enabled: true, open: "00:00", close: "00:00" },
    thursday: { enabled: true, open: "00:00", close: "00:00" },
    friday: { enabled: true, open: "00:00", close: "00:00" },
    saturday: { enabled: true, open: "00:00", close: "00:00" },
  });
  const api = createApi({
    resolveDiscordChannel: async (guildId: string, channelId: string) => ({
      session: createSessionResponse({ id: "session-draft", status: "DRAFT" }),
      config: createSessionDiscordConfig({
        guildId,
        registrationChannelId: channelId,
        emojis: {
          registrationTimeZone: "UTC",
          registrationWeeklySchedule: alwaysOpenSchedule,
        },
      }),
      channelKind: "registration",
    }),
  });
  const service = new DiscordSessionService(api as any, {} as any);

  const result = await service.findScrimForRegistrationChannel(
    "guild-1",
    "registration-1",
  );

  assert.equal(result?.accepting, true);
});

test("draft Discord sessions stay closed without registration timing", async () => {
  const api = createApi({
    resolveDiscordChannel: async (guildId: string, channelId: string) => ({
      session: createSessionResponse({ id: "session-draft", status: "DRAFT" }),
      config: createSessionDiscordConfig({
        guildId,
        registrationChannelId: channelId,
      }),
      channelKind: "registration",
    }),
  });
  const service = new DiscordSessionService(api as any, {} as any);

  const result = await service.findScrimForRegistrationChannel(
    "guild-1",
    "registration-1",
  );

  assert.equal(result?.accepting, false);
});

test("updateTeamLogoFromDiscord resolves team name and uploads logo", async () => {
  let uploadedTeamId: string | null = null;
  let uploadedLogo: any = null;
  const api = createApi({
    searchTeams: async () => [
      {
        id: "team-1",
        name: "Team DXB",
        tag: "DXB",
        logoUrl: null,
      },
    ],
    uploadTeamLogo: async (teamId: string, logoUpload: unknown) => {
      uploadedTeamId = teamId;
      uploadedLogo = logoUpload;
      return {
        ok: true,
        logoUrl: "https://cdn.arenzyra.com/team-dxb.png",
        version: 1,
      };
    },
  });
  const service = new DiscordSessionService(api as any, {} as any);
  const logoUpload = {
    buffer: Buffer.from([1, 2, 3]),
    filename: "team-logo.png",
    contentType: "image/png",
  };

  const reply = await service.updateTeamLogoFromDiscord(
    "Team DXB",
    logoUpload,
    { emojis: { check: "OK" } },
  );

  assert.equal(uploadedTeamId, "team-1");
  assert.equal(uploadedLogo, logoUpload);
  assert.equal(
    reply,
    "OK Logo saved for Team DXB (DXB). It will be used in registrations, slot lists, and result widgets.",
  );
});

test("updatePlayerPhotoFromDiscord uploads by uid and session context", async () => {
  let uploadedPayload: any = null;
  let uploadedPhoto: any = null;
  const api = createApi({
    uploadDiscordPlayerPhoto: async (
      payload: unknown,
      photoUpload: unknown,
    ) => {
      uploadedPayload = payload;
      uploadedPhoto = photoUpload;
      return {
        ok: true,
        playerId: "player-1",
        uid: "111111",
        playerName: "Volt",
        team: { id: "team-1", name: "Team DXB", tag: "DXB" },
        created: false,
        matchedRoster: true,
        photoUrl: "https://cdn.arenzyra.com/player.png",
        version: 1,
      };
    },
  });
  const service = new DiscordSessionService(api as any, {} as any);
  const photoUpload = {
    buffer: Buffer.from([1, 2, 3]),
    filename: "player-photo.png",
    contentType: "image/png",
  };

  const reply = await service.updatePlayerPhotoFromDiscord(
    { uid: "111111", playerName: "Volt", teamName: "Team DXB" },
    photoUpload,
    createSessionDiscordConfig({
      sessionId: "session-1",
      registrationMode: "TOURNAMENT",
      emojis: { check: "OK" },
    }),
  );

  assert.deepEqual(uploadedPayload, {
    sessionId: "session-1",
    registrationMode: "TOURNAMENT",
    uid: "111111",
    teamName: "Team DXB",
    playerName: "Volt",
  });
  assert.equal(uploadedPhoto, photoUpload);
  assert.equal(
    reply,
    "OK Player photo saved for Volt (111111) for Team DXB (DXB). It will update current and future widgets by UID.",
  );
});

test("updateTeamLogoFromDiscord saves pending logo when team is not registered yet", async () => {
  let savedSessionId: string | null = null;
  let savedPayload: any = null;
  const config = createSessionDiscordConfig({ emojis: { check: "OK" } });
  const api = createApi({
    searchTeams: async () => [],
    getTeamByTag: async () => {
      throw new Error("Requested resource not found");
    },
    updateSessionDiscordConfig: async (sessionId: string, payload: any) => {
      savedSessionId = sessionId;
      savedPayload = payload;
      return createSessionDiscordConfig({ emojis: payload.emojis });
    },
  });
  const service = new DiscordSessionService(api as any, {} as any);

  const reply = await service.updateTeamLogoFromDiscord(
    "Future Team",
    {
      buffer: Buffer.from([1, 2, 3]),
      filename: "future.png",
      contentType: "image/png",
    },
    config,
    {
      teamName: "Future Team",
      tag: "FT",
      channelId: "logo-channel",
      messageId: "logo-message",
      attachmentId: "attachment-1",
      url: "https://cdn.discordapp.com/future-team.png",
      filename: "future-team.png",
      contentType: "image/png",
      savedByDiscordId: "staff-1",
      savedByDiscordUsername: "staff",
    },
  );

  assert.equal(savedSessionId, "session-1");
  const saved = JSON.parse(savedPayload.emojis.pendingTeamLogos);
  assert.equal(saved["future team"].teamName, "Future Team");
  assert.equal(saved["future team"].tag, "FT");
  assert.equal(
    saved["future team"].url,
    "https://cdn.discordapp.com/future-team.png",
  );
  assert.match(reply, /attached automatically when this team registers/);
});

test("updateTeamLogoFromDiscord saves global pending logos to active guild sessions", async () => {
  const savedSessionIds: string[] = [];
  const configBySession = new Map([
    [
      "session-1",
      createSessionDiscordConfig({
        sessionId: "session-1",
        guildId: "guild-1",
        emojis: { check: "OK" },
      }),
    ],
    [
      "session-2",
      createSessionDiscordConfig({
        sessionId: "session-2",
        guildId: "guild-1",
        emojis: { check: "OK" },
      }),
    ],
    [
      "session-other-guild",
      createSessionDiscordConfig({
        sessionId: "session-other-guild",
        guildId: "guild-2",
        emojis: { check: "OK" },
      }),
    ],
  ]);
  const api = createApi({
    searchTeams: async () => [],
    getTeamByTag: async () => {
      throw new Error("Requested resource not found");
    },
    listSessions: async () => [
      createSessionResponse({ id: "session-1", status: "OPEN" }),
      createSessionResponse({ id: "session-2", status: "CHECKIN" }),
      createSessionResponse({ id: "session-archived", status: "ARCHIVED" }),
      createSessionResponse({ id: "session-other-guild", status: "OPEN" }),
    ],
    getSessionDiscordConfig: async (sessionId: string) =>
      configBySession.get(sessionId) ??
      createSessionDiscordConfig({ sessionId }),
    updateSessionDiscordConfig: async (sessionId: string, payload: any) => {
      savedSessionIds.push(sessionId);
      return createSessionDiscordConfig({ sessionId, emojis: payload.emojis });
    },
  });
  const service = new DiscordSessionService(api as any, {} as any);

  const reply = await service.updateTeamLogoFromDiscord(
    "Future Team",
    {
      buffer: Buffer.from([1, 2, 3]),
      filename: "future.png",
      contentType: "image/png",
    },
    configBySession.get("session-1"),
    {
      teamName: "Future Team",
      tag: "FT",
      channelId: "global-logo-channel",
      messageId: "logo-message",
      attachmentId: "attachment-1",
      url: "https://cdn.discordapp.com/future-team.png",
      filename: "future-team.png",
      contentType: "image/png",
      savedByDiscordId: "staff-1",
      savedByDiscordUsername: "staff",
    },
    { savePendingToActiveGuildSessions: { guildId: "guild-1" } },
  );

  assert.deepEqual(savedSessionIds.sort(), ["session-1", "session-2"]);
  assert.match(reply, /across 2 active sessions/);
});

test("pending team logo lookup matches exact saved tag", () => {
  const pending = {
    "galactic seven": {
      key: "galactic seven",
      tagKey: "g7",
      teamName: "Galactic Seven",
      tag: "G7",
      channelId: "logo-channel",
      messageId: "logo-message",
      attachmentId: "attachment-1",
      url: "https://cdn.discordapp.com/galactic-seven.png",
      filename: "galactic-seven.png",
      contentType: "image/png",
      savedByDiscordId: "staff-1",
      savedByDiscordUsername: "staff",
      savedAt: new Date().toISOString(),
    },
  };
  const config = createSessionDiscordConfig({
    emojis: { pendingTeamLogos: JSON.stringify(pending) },
  });
  const service = new DiscordSessionService(createApi({}) as any, {} as any);

  const record = (service as any).pendingLogoForTeam(
    "Galactic 7",
    "G7",
    config,
  );

  assert.equal(record?.teamName, "Galactic Seven");
});

test("pending team logo lookup falls back to active sessions in the same guild", async () => {
  const currentConfig = createSessionDiscordConfig({
    sessionId: "session-20",
    guildId: "guild-1",
    emojis: {},
  });
  const sourceConfig = createSessionDiscordConfig({
    sessionId: "session-16",
    guildId: "guild-1",
    emojis: {
      pendingTeamLogos: JSON.stringify({
        "galactic seven": {
          key: "galactic seven",
          tagKey: "g7",
          teamName: "Galactic Seven",
          tag: "G7",
          channelId: "logo-channel",
          messageId: "logo-message",
          attachmentId: "attachment-1",
          url: "https://cdn.discordapp.com/galactic-seven.png",
          filename: "galactic-seven.png",
          contentType: "image/png",
          savedByDiscordId: "staff-1",
          savedByDiscordUsername: "staff",
          savedAt: new Date().toISOString(),
        },
      }),
    },
  });
  const api = createApi({
    listSessions: async () => [
      createSessionResponse({ id: "session-20", status: "OPEN" }),
      createSessionResponse({ id: "session-16", status: "OPEN" }),
      createSessionResponse({ id: "session-other", status: "OPEN" }),
    ],
    getSessionDiscordConfig: async (sessionId: string) => {
      if (sessionId === "session-20") return currentConfig;
      if (sessionId === "session-16") return sourceConfig;
      return createSessionDiscordConfig({
        sessionId,
        guildId: "guild-other",
        emojis: {},
      });
    },
  });
  const service = new DiscordSessionService(api as any, {} as any);

  const record = await (
    service as any
  ).pendingLogoForTeamAcrossActiveGuildSessions(
    "Galactic 7",
    "G7",
    currentConfig,
  );

  assert.equal(record?.teamName, "Galactic Seven");
});

test("previewAutomaticResultScreenshot falls back to PUBG defaults when session game is missing", async () => {
  const createdPayloads: any[] = [];
  const api = createApi({
    listSessionMatches: async () => [],
    createSessionMatch: async (_sessionId: string, payload: any) => {
      createdPayloads.push(payload);
      if (createdPayloads.length === 1) {
        throw new Error("gameKey is required");
      }
      return createSessionMatchResponse({
        id: "match-g2",
        name: "Game 2",
        matchNumber: 2,
      });
    },
    previewScreenshotResults: async (payload: any) => ({
      matchId: payload.matchId,
      preview: [],
      resolved: [],
      unresolved: [],
      ambiguous: [],
    }),
  });

  const service = new DiscordSessionService(api as any);
  await service.previewAutomaticResultScreenshot(
    "session-1",
    "https://cdn.discordapp.com/result.png",
    "results",
    { emojis: {} },
    { matchNumber: 2 },
  );

  assert.equal(createdPayloads.length, 2);
  assert.equal(createdPayloads[0].gameKey, undefined);
  assert.equal(createdPayloads[1].gameKey, "PUBG_MOBILE");
  assert.equal(createdPayloads[1].map, "ERANGEL");
});

test("joinScrim allows the registered leader to claim a slot", async () => {
  const team: TeamSummary = { id: "team-1", name: "Team DXB", tag: "DXB" };
  const api = createApi({
    getTeamByTag: async () => team,
    getSessionDiscordConfig: async () => createSessionDiscordConfig(),
    listRegistrations: async () => [],
    listTeamMembers: async () => [createTeamMember()],
    registerTeam: async () => createSessionRegistration(),
  });

  const service = new DiscordSessionService(api as any);
  const result = await service.joinScrim("leader-1", "session-1", " dxb ");

  assert.equal(result, "\u2705 Joined (Slot #3)");
});

test("joinScrim enforces max teams per manager from session config", async () => {
  const team: TeamSummary = { id: "team-2", name: "Team NYC", tag: "NYC" };
  const api = createApi({
    getTeamByTag: async () => team,
    getSessionDiscordConfig: async () =>
      createSessionDiscordConfig({ maxTeamsPerManager: 1 }),
    listRegistrations: async () => [
      createSessionRegistration({
        id: "registration-other",
        teamId: "team-1",
      }),
    ],
    listTeamMembers: async (teamId: string) =>
      teamId === "team-2"
        ? [createTeamMember({ teamId: "team-2" })]
        : [createTeamMember({ teamId: "team-1" })],
  });

  const service = new DiscordSessionService(api as any);

  await assert.rejects(
    () => service.joinScrim("leader-1", "session-1", "NYC"),
    /Limit is 1/,
  );
});

test("joinScrim rejects callers who are not the registered leader", async () => {
  const team: TeamSummary = { id: "team-1", name: "Team DXB", tag: "DXB" };
  const api = createApi({
    getTeamByTag: async () => team,
    listTeamMembers: async () => [createTeamMember()],
  });

  const service = new DiscordSessionService(api as any);

  await assert.rejects(
    () => service.joinScrim("player-9", "session-1", "DXB"),
    /Only the registered team leader can use this command/,
  );
});

test("leaveScrim rejects callers who are not the registered leader", async () => {
  const team: TeamSummary = { id: "team-1", name: "Team DXB", tag: "DXB" };
  const api = createApi({
    getTeamByTag: async () => team,
    listTeamMembers: async () => [createTeamMember()],
  });

  const service = new DiscordSessionService(api as any);

  await assert.rejects(
    () => service.leaveScrim("player-9", "session-1", "DXB"),
    /Only the registered team leader can use this command/,
  );
});

test("registerTeamAndJoinScrim lets staff requester register a mentioned manager as leader", async () => {
  let capturedTeamPayload: any = null;
  let capturedSessionPayload: any = null;
  const config = createSessionDiscordConfig({
    manageRoleIds: ["staff-role"],
    registrationRoleIds: ["player-role"],
  });
  const setup = {
    categoryId: "category-1",
    categoryName: "Scrim",
    registrationChannelId: "registration-channel",
    registrationChannelName: "registration",
    slotListChannelId: "slot-list-channel",
    slotListChannelName: "slot-list",
    waitlistChannelId: "waitlist-channel",
    waitlistChannelName: "waitlist",
    idpChannelId: "idp-channel",
    idpChannelName: "idp",
    managerChannelId: "manager-channel",
    managerChannelName: "manager",
    manageChannelId: "manage-channel",
    manageChannelName: "manage",
    resultsChannelId: "results-channel",
    resultsChannelName: "results",
    screenshotsChannelId: "screenshots-channel",
    screenshotsChannelName: "screenshots",
    bansChannelId: "bans-channel",
    bansChannelName: "bans",
    logChannelId: "log-channel",
    logChannelName: "log",
    slotRoleId: "slot-role",
    slotRoleName: "Slot",
    waitlistRoleId: "waitlist-role",
    waitlistRoleName: "Waitlist",
    idpRoleId: "idp-role",
    idpRoleName: "IDP",
    bannedRoleId: "banned-role",
    bannedRoleName: "Banned",
  };
  const api = createApi({
    getDiscordConfig: async () => ({
      enabled: false,
      guildId: null,
      captainRoleId: null,
      participantRoleId: null,
      autoSyncRoles: false,
    }),
    getSession: async () => createSessionResponse(),
    getSessionDiscordConfig: async () => config,
    listRegistrations: async () => [],
    listTeamMembers: async () => [],
    registerDiscordTeam: async (payload: any) => {
      capturedTeamPayload = payload;
      return createRegistrationResponse({
        team: {
          id: "team-1",
          name: payload.name,
          tag: payload.tag,
          organizationId: "org-1",
        },
        members: [
          createTeamMember({
            discordUserId: payload.leaderDiscordUserId,
            discordUsername: payload.leaderDiscordUsername,
            displayName: payload.leaderDisplayName,
          }),
        ],
      });
    },
    registerTeam: async (_sessionId: string, payload: any) => {
      capturedSessionPayload = payload;
      return createSessionRegistration();
    },
    updateSessionDiscordConfig: async () => config,
  });
  const scrimSetup = {
    ensureSetup: async () => setup,
    syncSlotListAndWaitlistMessages: async () => {
      return {
        managedSlotListMessageId: "slot-message",
        managedWaitlistMessageId: "waitlist-message",
      };
    },
    syncMessages: async () => undefined,
  };
  const roleCache = (roleIds: string[] = []) => ({
    has: (roleId: string) => roleIds.includes(roleId),
    some: () => false,
  });
  const guild = {
    id: "guild-1",
    members: {
      fetch: async (discordUserId: string) => ({
        roles: {
          cache:
            discordUserId === "staff-1"
              ? roleCache(["staff-role"])
              : roleCache([]),
        },
        permissions: { has: () => false },
      }),
    },
  } as unknown as Guild;

  const service = new DiscordSessionService(api as any, scrimSetup as any);
  const result = await service.registerTeamAndJoinScrim(
    "manager-1",
    "manager",
    "Manager",
    "FIX",
    "FiX Esports",
    [{ discordUserId: "manager-1", discordUsername: "manager" }],
    guild,
    "session-1",
    null,
    null,
    { requesterDiscordId: "staff-1" },
  );

  assert.match(result, /FiX Esports/);
  assert.equal(capturedTeamPayload.leaderDiscordUserId, "manager-1");
  assert.equal(capturedTeamPayload.leaderDiscordUsername, "manager");
  assert.equal(capturedSessionPayload.bypassRegistrationWindow, true);
});

test("registerTeamAndJoinScrim immediately syncs slot roles for background registrations", async () => {
  const setup = createScrimDiscordSetup();
  const config = createSessionDiscordConfig({
    ...(setup as Partial<SessionDiscordConfigResponse>),
    guildId: "guild-1",
    manageRoleIds: ["staff-role"],
    emojis: {
      check: "CHECK",
      reject: "X",
      staffRoleId: "staff-role",
      staffRoleName: "Staff",
    },
  });
  let sessionRegistration = createSessionRegistration({
    teamId: "team-1",
    slotNumber: 18,
    leaderDiscordUserId: "manager-1",
    managerDiscordUserIds: ["manager-1"],
    team: {
      id: "team-1",
      name: "TorqueX Esports",
      tag: "TQX",
      logoUrl: null,
      countryCode: null,
      region: null,
    },
  });
  const api = createApi({
    getDiscordConfig: async () => ({
      enabled: false,
      guildId: null,
      captainRoleId: null,
      participantRoleId: null,
      autoSyncRoles: false,
    }),
    getSession: async () => createSessionResponse(),
    getSessionDiscordConfig: async () => config,
    listRegistrations: async () => [sessionRegistration],
    listTeamMembers: async (teamId: string) =>
      teamId === "team-1"
        ? [
            createTeamMember({
              teamId: "team-1",
              discordUserId: "manager-1",
              discordUsername: "manager",
              displayName: "Manager",
              role: "LEADER",
            }),
          ]
        : [],
    registerDiscordTeam: async (payload: any) =>
      createRegistrationResponse({
        team: {
          id: "team-1",
          name: payload.name,
          tag: payload.tag,
          organizationId: "org-1",
        },
        members: [
          createTeamMember({
            teamId: "team-1",
            discordUserId: "manager-1",
            discordUsername: "manager",
            displayName: "Manager",
          }),
        ],
      }),
    registerTeam: async () => sessionRegistration,
    updateSessionDiscordConfig: async () => config,
  });
  const roleAdds: string[][] = [];
  const memberRoles = new Map<string, Set<string>>([
    ["staff-1", new Set(["staff-role"])],
    ["manager-1", new Set()],
  ]);
  const roleCache = (memberId: string) => ({
    has: (roleId: string) => memberRoles.get(memberId)?.has(roleId) ?? false,
    some: () => false,
  });
  const guild = {
    id: "guild-1",
    members: {
      fetch: async (discordUserId: string) => ({
        id: discordUserId,
        roles: {
          cache: roleCache(discordUserId),
          add: async (roleIds: string[]) => {
            roleAdds.push(roleIds);
            const roles = memberRoles.get(discordUserId) ?? new Set<string>();
            for (const roleId of roleIds) {
              roles.add(roleId);
            }
            memberRoles.set(discordUserId, roles);
          },
          remove: async () => undefined,
        },
        permissions: { has: () => false },
      }),
    },
  } as unknown as Guild;
  const scrimSetup = {
    ensureSetup: async () => setup,
    syncSlotListAndWaitlistMessages: async () => ({
      managedSlotListMessageId: "slot-message",
      managedWaitlistMessageId: "waitlist-message",
    }),
    syncMessages: async () => undefined,
    sendRegistrationManagePanel: async () => undefined,
  };
  const service = new DiscordSessionService(api as any, scrimSetup as any);

  await service.registerTeamAndJoinScrim(
    "manager-1",
    "manager",
    "Manager",
    "TQX",
    "TorqueX Esports",
    [{ discordUserId: "manager-1", discordUsername: "manager" }],
    guild,
    "session-1",
    null,
    null,
    {
      requesterDiscordId: "staff-1",
      backgroundDiscordSync: true,
    },
  );

  assert.deepEqual(roleAdds[0], ["slot-role"]);
});

test("registerTeamAndJoinScrim rejects normal requester without the required registration role", async () => {
  let registerDiscordTeamCalled = false;
  const config = createSessionDiscordConfig({
    registrationRoleIds: ["player-role"],
  });
  const api = createApi({
    getSessionDiscordConfig: async () => config,
    registerDiscordTeam: async () => {
      registerDiscordTeamCalled = true;
      return createRegistrationResponse();
    },
  });
  const roleCache = (roleIds: string[] = []) => ({
    has: (roleId: string) => roleIds.includes(roleId),
    some: () => false,
  });
  const guild = {
    id: "guild-1",
    members: {
      fetch: async () => ({
        roles: { cache: roleCache([]) },
        permissions: { has: () => false },
      }),
    },
  } as unknown as Guild;

  const service = new DiscordSessionService(api as any);

  await assert.rejects(
    () =>
      service.registerTeamAndJoinScrim(
        "manager-1",
        "manager",
        "Manager",
        "FIX",
        "FiX Esports",
        [{ discordUserId: "manager-1", discordUsername: "manager" }],
        guild,
        "session-1",
      ),
    /You do not have a registration role for this scrim/,
  );
  assert.equal(registerDiscordTeamCalled, false);
});

test("registerTeamAndJoinScrim accepts verified role-access groups with a normal role allow-list", async () => {
  let capturedSessionPayload: any = null;
  const config = createSessionDiscordConfig({
    disableSlotAndVipRegistration: true,
    registrationRoleIds: ["normal-role"],
    emojis: {
      check: "CHECK",
      reject: "X",
      roleAccessGroups: JSON.stringify({
        groups: [
          {
            id: "fast-access",
            name: "Fast Access",
            roleId: "fast-role",
            roleName: "Fast Role",
            mode: "normal",
            enabled: true,
            weeklySchedule: JSON.stringify({
              monday: { enabled: true, open: "10:00", close: "12:00" },
            }),
            timeZone: "UTC",
          },
        ],
      }),
    },
  });
  const api = createApi({
    getDiscordConfig: async () => ({
      enabled: false,
      guildId: null,
      captainRoleId: null,
      participantRoleId: null,
      autoSyncRoles: false,
    }),
    getSessionDiscordConfig: async () => config,
    listRegistrations: async () => [],
    listTeamMembers: async () => [],
    registerDiscordTeam: async (payload: any) =>
      createRegistrationResponse({
        team: {
          id: "team-1",
          name: payload.name,
          tag: payload.tag,
          organizationId: "org-1",
        },
      }),
    registerTeam: async (_sessionId: string, payload: any) => {
      capturedSessionPayload = payload;
      return createSessionRegistration();
    },
  });
  const roleCache = (roleIds: string[] = []) => ({
    has: (roleId: string) => roleIds.includes(roleId),
    some: () => false,
  });
  const guild = {
    id: "guild-1",
    members: {
      fetch: async () => ({
        roles: { cache: roleCache(["fast-role"]) },
        permissions: { has: () => false },
      }),
    },
  } as unknown as Guild;

  const service = new DiscordSessionService(api as any, {} as any);
  (service as any).syncSessionRegistrationAccessRolesNow = async () => false;
  (service as any).syncVisibleDiscordMessagesFast = async () => true;
  (service as any).syncDiscordRoles = async () => null;
  (service as any).syncDiscordScrimState = async () => undefined;
  (service as any).postRegistrationManagePanel = async () => undefined;
  (service as any).sendDiscordActionLog = async () => undefined;

  const result = await service.registerTeamAndJoinScrim(
    "manager-1",
    "manager",
    "Manager",
    "FIX",
    "FiX Esports",
    [{ discordUserId: "manager-1", discordUsername: "manager" }],
    guild,
    "session-1",
    null,
    null,
    {
      requesterDiscordId: "manager-1",
      registrationWindowBypass: true,
      registrationRoleBypass: true,
      backgroundDiscordSync: true,
    },
  );

  assert.equal(capturedSessionPayload.bypassRegistrationWindow, true);
  assert.match(result, /FiX Esports/);
});

test("registerTeamAndJoinScrim sends VIP placement to session registration", async () => {
  let capturedSessionPayload: any = null;
  const config = createSessionDiscordConfig();
  const api = createApi({
    getDiscordConfig: async () => ({
      enabled: false,
      guildId: null,
      captainRoleId: null,
      participantRoleId: null,
      autoSyncRoles: false,
    }),
    getSessionDiscordConfig: async () => config,
    listRegistrations: async () => [],
    listTeamMembers: async () => [],
    registerDiscordTeam: async (payload: any) =>
      createRegistrationResponse({
        team: {
          id: "team-1",
          name: payload.name,
          tag: payload.tag,
          organizationId: "org-1",
        },
      }),
    registerTeam: async (_sessionId: string, payload: any) => {
      capturedSessionPayload = payload;
      return createSessionRegistration({ slotNumber: 23 });
    },
  });
  const service = new DiscordSessionService(api as any, {} as any);

  const result = await service.registerTeamAndJoinScrim(
    "leader-1",
    "leader",
    "Leader",
    "DXB",
    "Team DXB",
    [{ discordUserId: "leader-1", discordUsername: "leader" }],
    null,
    "session-1",
    null,
    null,
    { placement: "VIP" },
  );

  assert.equal(capturedSessionPayload.placement, "VIP");
  assert.match(result, /Team DXB/);
});

test("registerTeamAndJoinScrim ignores stale registrations whose team is missing", async () => {
  const config = createSessionDiscordConfig({ maxTeamsPerManager: 1 });
  let lookedUpStaleTeamMembers = false;
  const api = createApi({
    getDiscordConfig: async () => ({
      enabled: false,
      guildId: null,
      captainRoleId: null,
      participantRoleId: null,
      autoSyncRoles: false,
    }),
    getSessionDiscordConfig: async () => config,
    listRegistrations: async () => [
      createSessionRegistration({
        id: "stale-registration",
        teamId: "deleted-team",
        team: null,
      }),
    ],
    listTeamMembers: async () => {
      lookedUpStaleTeamMembers = true;
      throw new Error("Team not found");
    },
    registerDiscordTeam: async (payload: any) =>
      createRegistrationResponse({
        team: {
          id: "team-1",
          name: payload.name,
          tag: payload.tag,
          organizationId: "org-1",
        },
      }),
    registerTeam: async () => createSessionRegistration(),
  });
  const service = new DiscordSessionService(api as any, {} as any);

  const result = await service.registerTeamAndJoinScrim(
    "leader-1",
    "leader",
    "Leader",
    "DXB",
    "Team DXB",
    [{ discordUserId: "leader-1", discordUsername: "leader" }],
    null,
    "session-1",
  );

  assert.equal(lookedUpStaleTeamMembers, false);
  assert.match(result, /Team DXB/);
});

test("registerTeamAndJoinScrim attaches saved logo from synced logo channel", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    (globalThis as any).fetch = originalFetch;
  });
  (globalThis as any).fetch = async () => ({
    ok: true,
    headers: {
      get: (name: string) =>
        name.toLowerCase() === "content-type"
          ? "image/png"
          : name.toLowerCase() === "content-length"
            ? "3"
            : null,
    },
    arrayBuffer: async () => Uint8Array.of(8, 9, 10).buffer,
  });

  let uploadedLogo: any = null;
  let savedPayload: any = null;
  const pendingLogo = {
    key: "team dxb",
    tagKey: "dxb",
    teamName: "Team DXB",
    tag: "DXB",
    channelId: "1501285101550567605",
    messageId: "logo-message",
    attachmentId: "attachment-1",
    url: "https://cdn.discordapp.com/team-dxb.png",
    filename: "team-dxb.png",
    contentType: "image/png",
    savedByDiscordId: "staff-1",
    savedByDiscordUsername: "staff",
    savedAt: new Date().toISOString(),
  };
  const config = createSessionDiscordConfig({
    emojis: {
      check: "OK",
      discordLogoChannelIds: "<#1501285101550567605>",
      pendingTeamLogos: JSON.stringify({ "team dxb": pendingLogo }),
    },
  });
  const api = createApi({
    getDiscordConfig: async () => ({
      enabled: false,
      guildId: null,
      captainRoleId: null,
      participantRoleId: null,
      autoSyncRoles: false,
    }),
    getSessionDiscordConfig: async () => config,
    listRegistrations: async () => [],
    listTeamMembers: async () => [],
    registerDiscordTeam: async (payload: any) =>
      createRegistrationResponse({
        team: {
          id: "team-1",
          name: payload.name,
          tag: payload.tag,
          organizationId: "org-1",
        },
      }),
    uploadTeamLogo: async (_teamId: string, logoUpload: unknown) => {
      uploadedLogo = logoUpload;
      return {
        ok: true,
        logoUrl: "https://cdn.arenzyra.com/team-dxb.png",
        version: 1,
      };
    },
    updateSessionDiscordConfig: async (_sessionId: string, payload: any) => {
      savedPayload = payload;
      return createSessionDiscordConfig({ emojis: payload.emojis });
    },
    registerTeam: async () => createSessionRegistration(),
  });
  const service = new DiscordSessionService(api as any, {} as any);

  const result = await service.registerTeamAndJoinScrim(
    "leader-1",
    "leader",
    "Leader",
    "DXB",
    "Team DXB",
    [{ discordUserId: "leader-1", discordUsername: "leader" }],
    null,
    "session-1",
    null,
    null,
  );

  assert.deepEqual([...uploadedLogo.buffer], [8, 9, 10]);
  assert.equal(uploadedLogo.filename, "team-logo.png");
  assert.equal(uploadedLogo.contentType, "image/png");
  assert.ok(savedPayload.emojis.pendingTeamLogos);
  assert.match(result, /Saved logo attached from the logo channel/);
});

test("registerTeamAndJoinScrim does not attach saved logo from a different team with the same tag", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    (globalThis as any).fetch = originalFetch;
  });
  let fetchedLogo = false;
  (globalThis as any).fetch = async () => {
    fetchedLogo = true;
    return {
      ok: true,
      headers: {
        get: () => "image/png",
      },
      arrayBuffer: async () => Uint8Array.of(8, 9, 10).buffer,
    };
  };

  let uploadedLogo = false;
  const pendingLogo = {
    key: "mrthoko",
    tagKey: "mt",
    teamName: "MrThoko",
    tag: "MT",
    channelId: "1501285101550567605",
    messageId: "logo-message",
    attachmentId: "attachment-1",
    url: "https://cdn.discordapp.com/mrthoko.png",
    filename: "mrthoko.png",
    contentType: "image/png",
    savedByDiscordId: "staff-1",
    savedByDiscordUsername: "staff",
    savedAt: new Date().toISOString(),
  };
  const config = createSessionDiscordConfig({
    emojis: {
      check: "OK",
      discordLogoChannelIds: "<#1501285101550567605>",
      pendingTeamLogos: JSON.stringify({ mrthoko: pendingLogo }),
    },
  });
  const api = createApi({
    getDiscordConfig: async () => ({
      enabled: false,
      guildId: null,
      captainRoleId: null,
      participantRoleId: null,
      autoSyncRoles: false,
    }),
    getSessionDiscordConfig: async () => config,
    listRegistrations: async () => [],
    listTeamMembers: async () => [],
    registerDiscordTeam: async (payload: any) =>
      createRegistrationResponse({
        team: {
          id: "team-1",
          name: payload.name,
          tag: payload.tag,
          organizationId: "org-1",
        },
      }),
    uploadTeamLogo: async () => {
      uploadedLogo = true;
      return {
        ok: true,
        logoUrl: "https://cdn.arenzyra.com/meeting-titans.png",
        version: 1,
      };
    },
    registerTeam: async () => createSessionRegistration(),
  });
  const service = new DiscordSessionService(api as any, {} as any);

  const result = await service.registerTeamAndJoinScrim(
    "leader-1",
    "leader",
    "Leader",
    "MT",
    "MEETING TITANS",
    [{ discordUserId: "leader-1", discordUsername: "leader" }],
    null,
    "session-1",
    null,
    null,
  );

  assert.equal(fetchedLogo, false);
  assert.equal(uploadedLogo, false);
  assert.doesNotMatch(result, /Saved logo attached from the logo channel/);
});

test("updateRegistrationPlacement returns text-only slot confirmation by default", async () => {
  const api = createApi({
    getSession: async () => createSessionResponse(),
    getSessionDiscordConfig: async () => createSessionDiscordConfig(),
    updateRegistrationPlacement: async () =>
      createSessionRegistration({ slotNumber: 3 }),
  });

  const service = new DiscordSessionService(api as any);
  const result = await service.updateRegistrationPlacement(
    "session-1",
    "registration-1",
    { action: "SLOT", slotNumber: 3 },
    null,
  );

  assert.equal(result, "Slot 3");
});

test("updateRegistrationPlacement immediately replaces waitlist role when moved to slot", async () => {
  const registration = createSessionRegistration({
    status: "CONFIRMED",
    slotNumber: 3,
    waitlistPosition: null,
    leaderDiscordUserId: "manager-1",
    managerDiscordUserIds: ["manager-1"],
  });
  const config = createSessionDiscordConfig({
    guildId: "guild-1",
    categoryId: "category-1",
    registrationChannelId: "registration-channel",
    slotListChannelId: "slot-list-channel",
    waitlistChannelId: "waitlist-channel",
    slotRoleId: "slot-role",
    idpRoleId: "idp-role",
    waitlistRoleId: "waitlist-role",
  });
  const calls: string[] = [];
  const currentRoles = new Set(["waitlist-role"]);
  const removedRoleIds: string[][] = [];
  const addedRoleIds: string[][] = [];
  const api = createApi({
    getSession: async () => createSessionResponse(),
    getSessionDiscordConfig: async () => config,
    listRegistrations: async () => [registration],
    listTeamMembers: async () => [
      createTeamMember({ discordUserId: "manager-1" }),
    ],
    updateRegistrationPlacement: async () => {
      calls.push("updateRegistrationPlacement");
      return registration;
    },
  });
  const scrimSetup = {
    syncSlotListAndWaitlistMessages: async () => {
      calls.push("fastMessages");
      return {
        managedSlotListMessageId: "slot-message",
        managedWaitlistMessageId: "waitlist-message",
      };
    },
  };
  const guild = {
    id: "guild-1",
    members: {
      fetch: async () => ({
        roles: {
          cache: {
            has: (roleId: string) => currentRoles.has(roleId),
          },
          remove: async (roleIds: string[]) => {
            calls.push("roles.remove");
            removedRoleIds.push(roleIds);
            for (const roleId of roleIds) {
              currentRoles.delete(roleId);
            }
          },
          add: async (roleIds: string[]) => {
            calls.push("roles.add");
            addedRoleIds.push(roleIds);
            for (const roleId of roleIds) {
              currentRoles.add(roleId);
            }
          },
        },
      }),
    },
  } as unknown as Guild;

  const service = new DiscordSessionService(api as any, scrimSetup as any);
  const result = await service.updateRegistrationPlacement(
    "session-1",
    "registration-1",
    { action: "APPROVE" },
    guild,
  );

  assert.equal(result, "Slot 3");
  assert.deepEqual(removedRoleIds, [["waitlist-role"]]);
  assert.deepEqual(addedRoleIds, [["slot-role"]]);
  assert.equal(currentRoles.has("waitlist-role"), false);
  assert.equal(currentRoles.has("slot-role"), true);
  assert.equal(calls.includes("fastMessages"), false);

  await new Promise((resolve) => setTimeout(resolve, 20));
});

test("updateRegistrationPlacement reports stale waitlist control rows clearly", async () => {
  const api = createApi({
    getSession: async () => createSessionResponse(),
    getSessionDiscordConfig: async () =>
      createSessionDiscordConfig({ emojis: { warning: "WARN" } }),
    updateRegistrationPlacement: async () => {
      throw new Error("Requested resource not found");
    },
  });
  const service = new DiscordSessionService(api as any);

  await assert.rejects(
    () =>
      service.updateRegistrationPlacement(
        "session-1",
        "deleted-registration",
        { action: "APPROVE" },
        null,
      ),
    /out of date\. Refresh the panel and try again/,
  );
});

test("updateRegistrationPlacement returns waitlist emoji only in emoji confirmation mode", async () => {
  const api = createApi({
    getSession: async () => createSessionResponse(),
    getSessionDiscordConfig: async () =>
      createSessionDiscordConfig({
        emojis: {
          confirmationMode: "emoji",
          waitlist: "WAITLIST",
        },
      }),
    updateRegistrationPlacement: async () =>
      createSessionRegistration({
        status: "WAITLIST",
        slotNumber: null,
        waitlistPosition: 1,
      }),
  });

  const service = new DiscordSessionService(api as any);
  const result = await service.updateRegistrationPlacement(
    "session-1",
    "registration-1",
    { action: "WAITLIST" },
    null,
  );

  assert.equal(result, "\u{1F552}");
});

test("updateRegistrationPlayStatus blocks outside the confirmation window", async () => {
  let updated = false;
  const api = createApi({
    getSession: async () => createSessionResponse(),
    listRegistrations: async () => [createSessionRegistration()],
    getSessionDiscordConfig: async () =>
      createSessionDiscordConfig({
        emojis: {
          playConfirmationClosesAt: new Date(Date.now() - 60_000).toISOString(),
        },
      }),
    updateRegistrationPlayStatus: async () => {
      updated = true;
      return createSessionRegistration();
    },
  });

  const service = new DiscordSessionService(api as any);
  const result = await service.updateRegistrationPlayStatus(
    "session-1",
    "leader-1",
    "leader",
    "CONFIRM",
  );

  assert.match(result, /Confirmation is closed/);
  assert.equal(updated, false);
});

test("play status buttons ask for a target when one manager owns multiple teams", async () => {
  const registrations = [
    createSessionRegistration({
      id: "registration-a",
      teamId: "team-a",
      slotNumber: 5,
      team: {
        id: "team-a",
        name: "Alpha Team",
        tag: "ALP",
        logoUrl: null,
        countryCode: null,
        region: null,
      },
    }),
    createSessionRegistration({
      id: "registration-b",
      teamId: "team-b",
      slotNumber: 9,
      team: {
        id: "team-b",
        name: "Bravo Team",
        tag: "BRV",
        logoUrl: null,
        countryCode: null,
        region: null,
      },
    }),
  ];
  const api = createApi({
    listRegistrations: async () => registrations,
    getSessionDiscordConfig: async () =>
      createSessionDiscordConfig({ emojis: { reject: "X" } }),
    listTeamMembers: async (teamId: string) => [
      createTeamMember({
        id: `member-${teamId}`,
        teamId,
        discordUserId: "manager-1",
      }),
    ],
  });

  const service = new DiscordSessionService(api as any);
  const result = await service.resolveRegistrationPlayStatusTargets(
    "session-1",
    "manager-1",
    "CONFIRM",
  );

  assert.equal(result.kind, "multiple");
  assert.match(result.content, /multiple teams/);
  if (result.kind !== "multiple") {
    throw new Error("Expected multiple target resolution");
  }
  assert.deepEqual(
    result.targets.map((target) => [target.registrationId, target.optionLabel]),
    [
      ["registration-a", "Slot #5 - Alpha Team (ALP)"],
      ["registration-b", "Slot #9 - Bravo Team (BRV)"],
    ],
  );
});

test("play status buttons skip teams already matching the selected action", async () => {
  const registrations = [
    createSessionRegistration({
      id: "registration-a",
      teamId: "team-a",
      slotNumber: 5,
      note: playStatusNote("CONFIRM"),
      team: {
        id: "team-a",
        name: "Alpha Team",
        tag: "ALP",
        logoUrl: null,
        countryCode: null,
        region: null,
      },
    }),
    createSessionRegistration({
      id: "registration-b",
      teamId: "team-b",
      slotNumber: 9,
      team: {
        id: "team-b",
        name: "Bravo Team",
        tag: "BRV",
        logoUrl: null,
        countryCode: null,
        region: null,
      },
    }),
  ];
  const api = createApi({
    listRegistrations: async () => registrations,
    getSessionDiscordConfig: async () => createSessionDiscordConfig(),
    listTeamMembers: async (teamId: string) => [
      createTeamMember({
        id: `member-${teamId}`,
        teamId,
        discordUserId: "manager-1",
      }),
    ],
  });

  const service = new DiscordSessionService(api as any);
  const result = await service.resolveRegistrationPlayStatusTargets(
    "session-1",
    "manager-1",
    "CONFIRM",
  );

  assert.equal(result.kind, "single");
  if (result.kind !== "single") {
    throw new Error("Expected single target resolution");
  }
  assert.equal(result.target.registrationId, "registration-b");
});

test("play status buttons report when every owned team is already confirmed", async () => {
  const registrations = [
    createSessionRegistration({
      id: "registration-a",
      teamId: "team-a",
      slotNumber: 5,
      note: playStatusNote("CONFIRM"),
    }),
    createSessionRegistration({
      id: "registration-b",
      teamId: "team-b",
      slotNumber: 9,
      note: playStatusNote("CONFIRM"),
    }),
  ];
  const api = createApi({
    listRegistrations: async () => registrations,
    getSessionDiscordConfig: async () =>
      createSessionDiscordConfig({ emojis: { check: "CHECK" } }),
    listTeamMembers: async (teamId: string) => [
      createTeamMember({
        id: `member-${teamId}`,
        teamId,
        discordUserId: "manager-1",
      }),
    ],
  });

  const service = new DiscordSessionService(api as any);
  const result = await service.resolveRegistrationPlayStatusTargets(
    "session-1",
    "manager-1",
    "CONFIRM",
  );

  assert.equal(result.kind, "blocked");
  if (result.kind !== "blocked") {
    throw new Error("Expected blocked target resolution");
  }
  assert.match(result.content, /already confirmed/);
});

test("play status buttons report when every owned team is already not playing", async () => {
  const registrations = [
    createSessionRegistration({
      id: "registration-a",
      teamId: "team-a",
      slotNumber: 5,
      note: playStatusNote("NOT_PLAYING"),
    }),
    createSessionRegistration({
      id: "registration-b",
      teamId: "team-b",
      slotNumber: 9,
      note: playStatusNote("NOT_PLAYING"),
    }),
  ];
  const api = createApi({
    listRegistrations: async () => registrations,
    getSessionDiscordConfig: async () =>
      createSessionDiscordConfig({ emojis: { reject: "X" } }),
    listTeamMembers: async (teamId: string) => [
      createTeamMember({
        id: `member-${teamId}`,
        teamId,
        discordUserId: "manager-1",
      }),
    ],
  });

  const service = new DiscordSessionService(api as any);
  const result = await service.resolveRegistrationPlayStatusTargets(
    "session-1",
    "manager-1",
    "NOT_PLAYING",
  );

  assert.equal(result.kind, "blocked");
  if (result.kind !== "blocked") {
    throw new Error("Expected blocked target resolution");
  }
  assert.match(result.content, /already marked not playing/);
});

test("idp dm recipients include only confirmed-playing slot managers", async () => {
  const registrations = [
    createSessionRegistration({
      id: "registration-playing",
      teamId: "team-playing",
      slotNumber: 1,
      managerDiscordUserIds: ["111111111111111111"],
      note: playStatusNote("CONFIRM", "111111111111111111"),
    }),
    createSessionRegistration({
      id: "registration-playing-leader",
      teamId: "team-playing-leader",
      slotNumber: 2,
      leaderDiscordUserId: "222222222222222222",
      managerDiscordUserIds: [],
      note: playStatusNote("CONFIRM", "222222222222222222"),
    }),
    createSessionRegistration({
      id: "registration-not-playing",
      teamId: "team-not-playing",
      slotNumber: 3,
      managerDiscordUserIds: ["333333333333333333"],
      note: playStatusNote("NOT_PLAYING", "333333333333333333"),
    }),
    createSessionRegistration({
      id: "registration-pending",
      teamId: "team-pending",
      slotNumber: 4,
      managerDiscordUserIds: ["444444444444444444"],
      note: null,
    }),
    createSessionRegistration({
      id: "registration-waitlist",
      teamId: "team-waitlist",
      status: "WAITLIST",
      slotNumber: null,
      waitlistPosition: 1,
      managerDiscordUserIds: ["555555555555555555"],
      note: playStatusNote("CONFIRM", "555555555555555555"),
    }),
    createSessionRegistration({
      id: "registration-removed",
      teamId: "team-removed",
      status: "REMOVED",
      slotNumber: 5,
      managerDiscordUserIds: ["666666666666666666"],
      note: playStatusNote("CONFIRM", "666666666666666666"),
    }),
  ];
  const api = createApi({
    listRegistrations: async () => registrations,
  });

  const service = new DiscordSessionService(api as any);
  const result = await service.listRegisteredSlotManagerDiscordIds("session-1");

  assert.deepEqual(result, [
    "111111111111111111",
    "222222222222222222",
  ]);
});

test("updateRegistrationPlayStatus can apply to all teams owned by one manager", async () => {
  const registrations = [
    createSessionRegistration({
      id: "registration-a",
      teamId: "team-a",
      slotNumber: 5,
      team: {
        id: "team-a",
        name: "Alpha Team",
        tag: "ALP",
        logoUrl: null,
        countryCode: null,
        region: null,
      },
    }),
    createSessionRegistration({
      id: "registration-b",
      teamId: "team-b",
      slotNumber: 9,
      team: {
        id: "team-b",
        name: "Bravo Team",
        tag: "BRV",
        logoUrl: null,
        countryCode: null,
        region: null,
      },
    }),
  ];
  const updatedIds: string[] = [];
  const api = createApi({
    getSession: async () => createSessionResponse(),
    listRegistrations: async () => registrations,
    getSessionDiscordConfig: async () =>
      createSessionDiscordConfig({ emojis: { check: "CHECK" } }),
    listTeamMembers: async (teamId: string) => [
      createTeamMember({
        id: `member-${teamId}`,
        teamId,
        discordUserId: "manager-1",
      }),
    ],
    updateRegistrationPlayStatus: async (
      _sessionId: string,
      registrationId: string,
    ) => {
      updatedIds.push(registrationId);
      return registrations.find((item) => item.id === registrationId)!;
    },
  });

  const service = new DiscordSessionService(api as any);
  (service as any).syncDiscordScrimStateInBackground = () => undefined;
  const result = await service.updateRegistrationPlayStatus(
    "session-1",
    "manager-1",
    "manager",
    "CONFIRM",
    null,
    {},
    { applyAll: true },
  );

  assert.deepEqual(updatedIds, ["registration-a", "registration-b"]);
  assert.match(result, /Confirmed 2 teams/);
  assert.match(result, /slot #5 for Alpha Team \(ALP\)/);
  assert.match(result, /slot #9 for Bravo Team \(BRV\)/);
});

test("updateRegistrationPlayStatus apply all skips already matching teams", async () => {
  const registrations = [
    createSessionRegistration({
      id: "registration-a",
      teamId: "team-a",
      slotNumber: 5,
      note: playStatusNote("CONFIRM"),
      team: {
        id: "team-a",
        name: "Alpha Team",
        tag: "ALP",
        logoUrl: null,
        countryCode: null,
        region: null,
      },
    }),
    createSessionRegistration({
      id: "registration-b",
      teamId: "team-b",
      slotNumber: 9,
      team: {
        id: "team-b",
        name: "Bravo Team",
        tag: "BRV",
        logoUrl: null,
        countryCode: null,
        region: null,
      },
    }),
  ];
  const updatedIds: string[] = [];
  const api = createApi({
    getSession: async () => createSessionResponse(),
    listRegistrations: async () => registrations,
    getSessionDiscordConfig: async () =>
      createSessionDiscordConfig({ emojis: { check: "CHECK" } }),
    listTeamMembers: async (teamId: string) => [
      createTeamMember({
        id: `member-${teamId}`,
        teamId,
        discordUserId: "manager-1",
      }),
    ],
    updateRegistrationPlayStatus: async (
      _sessionId: string,
      registrationId: string,
    ) => {
      updatedIds.push(registrationId);
      return registrations.find((item) => item.id === registrationId)!;
    },
  });

  const service = new DiscordSessionService(api as any);
  (service as any).syncDiscordScrimStateInBackground = () => undefined;
  const result = await service.updateRegistrationPlayStatus(
    "session-1",
    "manager-1",
    "manager",
    "CONFIRM",
    null,
    {},
    { applyAll: true },
  );

  assert.deepEqual(updatedIds, ["registration-b"]);
  assert.match(result, /Confirmed slot #9 for Bravo Team \(BRV\)/);
});

test("updateRegistrationPlayStatus reports when owned teams already match", async () => {
  let updated = false;
  const registrations = [
    createSessionRegistration({
      id: "registration-a",
      teamId: "team-a",
      slotNumber: 5,
      note: playStatusNote("CONFIRM"),
    }),
  ];
  const api = createApi({
    getSession: async () => createSessionResponse(),
    listRegistrations: async () => registrations,
    getSessionDiscordConfig: async () =>
      createSessionDiscordConfig({ emojis: { check: "CHECK" } }),
    listTeamMembers: async (teamId: string) => [
      createTeamMember({
        id: `member-${teamId}`,
        teamId,
        discordUserId: "manager-1",
      }),
    ],
    updateRegistrationPlayStatus: async () => {
      updated = true;
      return createSessionRegistration();
    },
  });

  const service = new DiscordSessionService(api as any);
  const result = await service.updateRegistrationPlayStatus(
    "session-1",
    "manager-1",
    "manager",
    "CONFIRM",
  );

  assert.match(result, /already confirmed/);
  assert.equal(updated, false);
});

test("updateRegistrationPlayStatus applies only the selected owned team", async () => {
  const registrations = [
    createSessionRegistration({
      id: "registration-a",
      teamId: "team-a",
      slotNumber: 5,
      team: {
        id: "team-a",
        name: "Alpha Team",
        tag: "ALP",
        logoUrl: null,
        countryCode: null,
        region: null,
      },
    }),
    createSessionRegistration({
      id: "registration-b",
      teamId: "team-b",
      slotNumber: 9,
      team: {
        id: "team-b",
        name: "Bravo Team",
        tag: "BRV",
        logoUrl: null,
        countryCode: null,
        region: null,
      },
    }),
  ];
  const updatedIds: string[] = [];
  const api = createApi({
    getSession: async () => createSessionResponse(),
    listRegistrations: async () => registrations,
    getSessionDiscordConfig: async () =>
      createSessionDiscordConfig({ emojis: { reject: "X" } }),
    listTeamMembers: async (teamId: string) => [
      createTeamMember({
        id: `member-${teamId}`,
        teamId,
        discordUserId: "manager-1",
      }),
    ],
    updateRegistrationPlayStatus: async (
      _sessionId: string,
      registrationId: string,
    ) => {
      updatedIds.push(registrationId);
      return registrations.find((item) => item.id === registrationId)!;
    },
  });

  const service = new DiscordSessionService(api as any);
  (service as any).syncDiscordScrimStateInBackground = () => undefined;
  const result = await service.updateRegistrationPlayStatus(
    "session-1",
    "manager-1",
    "manager",
    "NOT_PLAYING",
    null,
    {},
    { registrationId: "registration-b" },
  );

  assert.deepEqual(updatedIds, ["registration-b"]);
  assert.match(result, /Marked not playing slot #9 for Bravo Team \(BRV\)/);
});

test("confirmation close cleanup removes not-playing and unconfirmed slots only", async () => {
  const now = new Date("2026-06-08T12:05:00.000Z");
  const config = createSessionDiscordConfig({
    guildId: "guild-1",
    emojis: {
      check: "CHECK",
      reject: "X",
      playConfirmationCleanupEnabled: "true",
      playConfirmationWeeklySchedule: JSON.stringify({
        monday: {
          enabled: true,
          open: "11:00",
          close: "12:00",
          waitlistStart: "",
        },
      }),
      playConfirmationTimeZone: "UTC",
    },
  });
  const confirmed = createSessionRegistration({
    id: "registration-confirmed",
    teamId: "team-confirmed",
    slotNumber: 3,
    note: playStatusNote("CONFIRM"),
  });
  const notPlaying = createSessionRegistration({
    id: "registration-not-playing",
    teamId: "team-not-playing",
    slotNumber: 4,
    note: playStatusNote("NOT_PLAYING"),
  });
  const pending = createSessionRegistration({
    id: "registration-pending",
    teamId: "team-pending",
    slotNumber: 5,
    note: null,
  });
  const removedIds: string[] = [];
  const persistedEmojis: Array<Record<string, string>> = [];
  const syncs: any[] = [];
  let roleCleanupQueued = false;
  const api = createApi({
    listRegistrations: async () => [confirmed, notPlaying, pending],
    listTeamMembers: async (teamId: string) => [
      createTeamMember({ teamId, discordUserId: `${teamId}-manager` }),
    ],
    removeRegistration: async (_sessionId: string, registrationId: string) => {
      removedIds.push(registrationId);
      const registration = [notPlaying, pending].find(
        (entry) => entry.id === registrationId,
      )!;
      return {
        removedRegistration: { ...registration, status: "REMOVED" },
        promotedRegistration: null,
      };
    },
    updateSessionDiscordConfig: async (_sessionId: string, payload: any) => {
      persistedEmojis.push(payload.emojis);
      return createSessionDiscordConfig({
        ...config,
        emojis: payload.emojis,
      });
    },
  });
  const service = new DiscordSessionService(api as any);
  (service as any).syncDiscordScrimStateInBackground = (
    _guild: Guild,
    _sessionId: string,
    opts: any,
  ) => syncs.push(opts);
  (service as any).cleanScrimRolesInBackground = () => {
    roleCleanupQueued = true;
  };
  const guild = { id: "guild-1" } as unknown as Guild;

  const updatedConfig = await (service as any).applyDueConfirmationCloseCleanup(
    guild,
    createSessionResponse(),
    config,
    now,
  );

  assert.deepEqual(removedIds, [
    "registration-not-playing",
    "registration-pending",
  ]);
  assert.equal(
    updatedConfig.emojis.playConfirmationCleanupLastClosedAt,
    "2026-06-08T12:00:00.000Z",
  );
  assert.equal(
    persistedEmojis.at(-1)?.playConfirmationCleanupLastClosedAt,
    "2026-06-08T12:00:00.000Z",
  );
  assert.equal(roleCleanupQueued, true);
  assert.deepEqual(syncs[0].removedTeamIds.sort(), [
    "team-not-playing",
    "team-pending",
  ]);
});

test("confirmation cleanup uses configured cleanup time after close", async () => {
  const now = new Date("2026-06-08T12:11:00.000Z");
  const config = createSessionDiscordConfig({
    guildId: "guild-1",
    emojis: {
      check: "CHECK",
      reject: "X",
      playConfirmationCleanupEnabled: "true",
      playConfirmationWeeklySchedule: JSON.stringify({
        monday: {
          enabled: true,
          open: "11:00",
          close: "12:00",
          cleanup: "12:10",
          waitlistStart: "",
        },
      }),
      playConfirmationTimeZone: "UTC",
    },
  });
  const pending = createSessionRegistration({
    id: "registration-pending",
    teamId: "team-pending",
    slotNumber: 5,
    note: null,
  });
  const removedIds: string[] = [];
  const persistedEmojis: Array<Record<string, string>> = [];
  const api = createApi({
    listRegistrations: async () => [pending],
    listTeamMembers: async (teamId: string) => [
      createTeamMember({ teamId, discordUserId: `${teamId}-manager` }),
    ],
    removeRegistration: async (_sessionId: string, registrationId: string) => {
      removedIds.push(registrationId);
      return {
        removedRegistration: { ...pending, status: "REMOVED" },
        promotedRegistration: null,
      };
    },
    updateSessionDiscordConfig: async (_sessionId: string, payload: any) => {
      persistedEmojis.push(payload.emojis);
      return createSessionDiscordConfig({
        ...config,
        emojis: payload.emojis,
      });
    },
  });
  const service = new DiscordSessionService(api as any);
  (service as any).syncDiscordScrimStateInBackground = () => undefined;
  (service as any).cleanScrimRolesInBackground = () => undefined;
  const guild = { id: "guild-1" } as unknown as Guild;

  const updatedConfig = await (service as any).applyDueConfirmationCloseCleanup(
    guild,
    createSessionResponse(),
    config,
    now,
  );

  assert.deepEqual(removedIds, ["registration-pending"]);
  assert.equal(
    updatedConfig.emojis.playConfirmationCleanupLastClosedAt,
    "2026-06-08T12:10:00.000Z",
  );
  assert.equal(
    persistedEmojis.at(-1)?.playConfirmationCleanupLastClosedAt,
    "2026-06-08T12:10:00.000Z",
  );
});

test("confirmation close cleanup temporarily opens waitlist and confirmation when slots free", async () => {
  const now = new Date("2026-06-08T12:05:00.000Z");
  const config = createSessionDiscordConfig({
    guildId: "guild-1",
    emojis: {
      check: "CHECK",
      reject: "X",
      playConfirmationCleanupEnabled: "true",
      playConfirmationWaitlistGraceMinutes: "20",
      playConfirmationWeeklySchedule: JSON.stringify({
        monday: {
          enabled: true,
          open: "11:00",
          close: "12:00",
          waitlistStart: "",
        },
      }),
      playConfirmationTimeZone: "UTC",
    },
  });
  const confirmed = createSessionRegistration({
    id: "registration-confirmed",
    teamId: "team-confirmed",
    slotNumber: 3,
    note: playStatusNote("CONFIRM"),
  });
  const pending = createSessionRegistration({
    id: "registration-pending",
    teamId: "team-pending",
    slotNumber: 4,
    note: null,
  });
  const waitlist = createSessionRegistration({
    id: "registration-waitlist",
    teamId: "team-waitlist",
    status: "WAITLIST",
    slotNumber: null,
    waitlistPosition: 1,
    note: null,
  });
  let listCalls = 0;
  const persistedEmojis: Array<Record<string, string>> = [];
  const api = createApi({
    listRegistrations: async () => {
      listCalls += 1;
      return listCalls === 1
        ? [confirmed, pending, waitlist]
        : [confirmed, waitlist];
    },
    listTeamMembers: async (teamId: string) => [
      createTeamMember({ teamId, discordUserId: `${teamId}-manager` }),
    ],
    removeRegistration: async () => ({
      removedRegistration: { ...pending, status: "REMOVED" },
      promotedRegistration: null,
    }),
    updateSessionDiscordConfig: async (_sessionId: string, payload: any) => {
      persistedEmojis.push(payload.emojis);
      return createSessionDiscordConfig({
        ...config,
        emojis: payload.emojis,
      });
    },
  });
  const service = new DiscordSessionService(api as any);
  (service as any).syncDiscordScrimStateInBackground = () => undefined;
  (service as any).cleanScrimRolesInBackground = () => undefined;
  const guild = { id: "guild-1" } as unknown as Guild;

  const updatedConfig = await (service as any).applyDueConfirmationCloseCleanup(
    guild,
    createSessionResponse({ slotCount: 25, waitlistEnabled: true }),
    config,
    now,
  );

  const gracePayload = persistedEmojis.find(
    (emojis) => emojis.playConfirmationWaitlistGraceUntil,
  );
  assert.equal(
    gracePayload?.playConfirmationWaitlistGraceStartedAt,
    "2026-06-08T12:05:00.000Z",
  );
  assert.equal(
    gracePayload?.playConfirmationWaitlistGraceUntil,
    "2026-06-08T12:25:00.000Z",
  );
  assert.equal(
    gracePayload?.waitlistPromotionAutoOpenUntil,
    "2026-06-08T12:25:00.000Z",
  );
  assert.equal(
    updatedConfig.emojis.playConfirmationCleanupLastClosedAt,
    "2026-06-08T12:00:00.000Z",
  );
  assert.equal(
    updatedConfig.emojis.playConfirmationWaitlistGraceUntil,
    "2026-06-08T12:25:00.000Z",
  );
});

test("confirmation close cleanup can create bans and apply the configured role", async () => {
  const now = new Date("2026-06-08T12:05:00.000Z");
  const config = createSessionDiscordConfig({
    guildId: "guild-1",
    bansChannelId: "bans-channel",
    emojis: {
      check: "CHECK",
      reject: "X",
      playConfirmationCleanupEnabled: "true",
      playConfirmationCleanupBanEnabled: "true",
      playConfirmationCleanupReason: "Missed confirmation for {session}",
      playConfirmationWeeklySchedule: JSON.stringify({
        monday: {
          enabled: true,
          open: "11:00",
          close: "12:00",
          waitlistStart: "",
        },
      }),
      playConfirmationTimeZone: "UTC",
      banRoleIds: "123456789012345678",
      banServerAction: "ROLE",
      noShowBanRules: JSON.stringify([
        {
          enabled: true,
          misses: 1,
          durationDays: 5,
          scope: "SESSION",
          reason: "Missed {misses} match(es) in {session}",
        },
      ]),
    },
  });
  const pending = createSessionRegistration({
    id: "registration-pending",
    teamId: "team-pending",
    slotNumber: 5,
    leaderDiscordUserId: "manager-1",
    managerDiscordUserIds: ["manager-1"],
    note: null,
    team: {
      id: "team-pending",
      name: "Pending Team",
      tag: "PEN",
      logoUrl: null,
      countryCode: null,
      region: null,
    },
  });
  let banPayload: any = null;
  const roleAdds: Array<{ userId: string; roleId: string; reason: string }> =
    [];
  const sentMessages: Array<{ channelId: string; payload: any }> = [];
  let removedRegistrationId: string | null = null;
  const api = createApi({
    listRegistrations: async () => [pending],
    listTeamMembers: async () => [
      createTeamMember({
        teamId: "team-pending",
        discordUserId: "manager-1",
        discordUsername: "manager",
        displayName: "Manager",
      }),
    ],
    createTeamBan: async (payload: any) => {
      banPayload = payload;
      return [
        {
          id: "ban-1",
          organizationId: "org-1",
          teamId: payload.teamId,
          scope: payload.scope,
          sessionId: payload.sessionId ?? null,
          matchId: null,
          reason: payload.reason,
          note: payload.note ?? null,
          expiresAt: payload.expiresAt ?? null,
          revokedAt: null,
          revokeReason: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          active: true,
          team: pending.team,
          session: { id: "session-1", name: "Daily Scrim", status: "OPEN" },
          match: null,
        },
      ];
    },
    removeRegistration: async (_sessionId: string, registrationId: string) => {
      removedRegistrationId = registrationId;
      return {
        removedRegistration: { ...pending, status: "REMOVED" },
        promotedRegistration: null,
      };
    },
    updateSessionDiscordConfig: async (_sessionId: string, payload: any) =>
      createSessionDiscordConfig({ ...config, emojis: payload.emojis }),
  });
  const bannedRole = { id: "123456789012345678", name: "Banned" };
  const guild = {
    id: "guild-1",
    roles: {
      cache: {
        get: (roleId: string) =>
          roleId === bannedRole.id ? bannedRole : undefined,
        find: () => undefined,
      },
    },
    members: {
      fetch: async (userId: string) => ({
        roles: {
          add: async (role: typeof bannedRole, reason: string) => {
            roleAdds.push({ userId, roleId: role.id, reason });
          },
        },
      }),
    },
    channels: {
      fetch: async (channelId: string) => ({
        isTextBased: () => true,
        isDMBased: () => false,
        send: async (payload: any) => {
          sentMessages.push({ channelId, payload });
          return { id: `message-${channelId}` };
        },
      }),
    },
  } as unknown as Guild;
  const service = new DiscordSessionService(api as any);
  (service as any).syncDiscordScrimStateInBackground = () => undefined;
  (service as any).cleanScrimRolesInBackground = () => undefined;
  (service as any).refreshDiscordBanListMessage = async () => undefined;

  await (service as any).applyDueConfirmationCloseCleanup(
    guild,
    createSessionResponse(),
    config,
    now,
  );

  assert.equal(banPayload.teamId, "team-pending");
  assert.equal(banPayload.scope, "SESSION");
  assert.equal(banPayload.sessionId, "session-1");
  assert.equal(banPayload.reason, "Missed confirmation for Daily Scrim");
  assert.ok(banPayload.expiresAt);
  assert.equal(removedRegistrationId, "registration-pending");
  assert.deepEqual(roleAdds, [
    {
      userId: "manager-1",
      roleId: "123456789012345678",
      reason: "Missed confirmation for Daily Scrim",
    },
  ]);
  assert.equal(sentMessages[0].channelId, "bans-channel");
  assert.match(sentMessages[0].payload.content, /Confirmation cleanup bans/);
  assert.match(sentMessages[0].payload.content, /PEN/);
});

test("confirmSlotFromDiscord lets staff confirm any assigned slot", async () => {
  let updatedRegistrationId: string | null = null;
  let updatedPayload: any = null;
  let memberLookupCount = 0;
  const registration = createSessionRegistration({
    id: "registration-22",
    slotNumber: 22,
  });
  const api = createApi({
    getSession: async () => createSessionResponse(),
    listRegistrations: async () => [registration],
    getSessionDiscordConfig: async () =>
      createSessionDiscordConfig({
        manageRoleIds: ["staff-role"],
        emojis: {
          check: "CHECK",
          reject: "X",
          playConfirmationClosesAt: new Date(Date.now() - 60_000).toISOString(),
        },
      }),
    listTeamMembers: async () => {
      memberLookupCount += 1;
      return [];
    },
    updateRegistrationPlayStatus: async (
      _sessionId: string,
      registrationId: string,
      payload: any,
    ) => {
      updatedRegistrationId = registrationId;
      updatedPayload = payload;
      return createSessionRegistration({
        id: registrationId,
        slotNumber: 22,
      });
    },
  });
  const guild = {
    members: {
      fetch: async () => ({
        permissions: { has: () => false },
        roles: { cache: { has: (roleId: string) => roleId === "staff-role" } },
      }),
    },
  } as unknown as Guild;

  const service = new DiscordSessionService(api as any);
  (service as any).syncDiscordScrimStateInBackground = () => undefined;

  const result = await service.confirmSlotFromDiscord(
    "staff-1",
    "staff",
    22,
    guild,
    "session-1",
  );

  assert.match(result, /Confirmed slot #22/);
  assert.equal(updatedRegistrationId, "registration-22");
  assert.deepEqual(updatedPayload, {
    action: "CONFIRM",
    discordUserId: "staff-1",
    discordUsername: "staff",
  });
  assert.equal(memberLookupCount, 0);
});

test("confirmSlotFromDiscord only lets team managers confirm their own slot", async () => {
  let updated = false;
  const api = createApi({
    getSession: async () => createSessionResponse(),
    listRegistrations: async () => [
      createSessionRegistration({
        id: "registration-22",
        teamId: "team-22",
        slotNumber: 22,
        team: {
          id: "team-22",
          name: "Slot Team",
          tag: "SLT",
          logoUrl: null,
          countryCode: null,
          region: null,
        },
      }),
    ],
    getSessionDiscordConfig: async () =>
      createSessionDiscordConfig({
        emojis: { check: "CHECK", reject: "X" },
      }),
    listTeamMembers: async (teamId: string) => [
      createTeamMember({
        teamId,
        discordUserId: "manager-1",
      }),
    ],
    updateRegistrationPlayStatus: async () => {
      updated = true;
      return createSessionRegistration({
        id: "registration-22",
        teamId: "team-22",
        slotNumber: 22,
        team: {
          id: "team-22",
          name: "Slot Team",
          tag: "SLT",
          logoUrl: null,
          countryCode: null,
          region: null,
        },
      });
    },
  });
  const guild = {
    members: {
      fetch: async () => ({
        permissions: { has: () => false },
        roles: { cache: { has: () => false, some: () => false } },
      }),
    },
  } as unknown as Guild;

  const service = new DiscordSessionService(api as any);
  (service as any).syncDiscordScrimStateInBackground = () => undefined;

  const rejected = await service.confirmSlotFromDiscord(
    "manager-2",
    "manager-2",
    22,
    guild,
    "session-1",
  );
  assert.match(rejected, /Only staff or this slot's team managers/);
  assert.equal(updated, false);

  const confirmed = await service.confirmSlotFromDiscord(
    "manager-1",
    "manager-1",
    22,
    guild,
    "session-1",
  );
  assert.match(confirmed, /Confirmed slot #22 for Slot Team \(SLT\)/);
  assert.equal(updated, true);
});

test("registration action logs use public registration wording", () => {
  const service = new DiscordSessionService(createApi({}) as any);
  const logStatus = (
    service as unknown as {
      registrationActionLogStatus: (
        registration: Pick<
          SessionRegistrationResponse,
          "status" | "slotNumber" | "waitlistPosition"
        > | null,
      ) => string;
    }
  ).registrationActionLogStatus.bind(service);

  assert.equal(
    logStatus(createSessionRegistration({ status: "CONFIRMED" })),
    "registered",
  );
  assert.equal(
    logStatus(createSessionRegistration({ status: "CHECKED_IN" })),
    "registered",
  );
  assert.equal(
    logStatus(
      createSessionRegistration({
        status: "WAITLIST",
        slotNumber: null,
        waitlistPosition: 1,
      }),
    ),
    "waitlisted",
  );
  assert.equal(
    logStatus(
      createSessionRegistration({
        status: "REMOVED",
        slotNumber: null,
        waitlistPosition: null,
      }),
    ),
    "not registered",
  );
  assert.equal(
    logStatus(
      createSessionRegistration({
        status: "DECLINED",
        slotNumber: null,
        waitlistPosition: null,
      }),
    ),
    "not registered",
  );
});

test("updateRegistrationPlacement queues one background Discord sync for rapid actions", async () => {
  let updateCount = 0;
  let syncMessageCount = 0;
  let fastMessageCount = 0;
  let listRegistrationCount = 0;
  const registration = createSessionRegistration();
  const config = createSessionDiscordConfig({
    categoryId: "category-1",
    registrationChannelId: "registration-channel",
    slotListChannelId: "slot-list-channel",
    waitlistChannelId: "waitlist-channel",
  });
  const setup = {
    categoryId: "category-1",
    categoryName: "Scrim",
    registrationChannelId: "registration-channel",
    registrationChannelName: "registration",
    slotListChannelId: "slot-list-channel",
    slotListChannelName: "slot-list",
    waitlistChannelId: "waitlist-channel",
    waitlistChannelName: "waitlist",
    idpChannelId: "idp-channel",
    idpChannelName: "idp",
    managerChannelId: "manager-channel",
    managerChannelName: "manager",
    manageChannelId: "manage-channel",
    manageChannelName: "manage",
    resultsChannelId: "results-channel",
    resultsChannelName: "results",
    screenshotsChannelId: "screenshots-channel",
    screenshotsChannelName: "screenshots",
    bansChannelId: "bans-channel",
    bansChannelName: "bans",
    logChannelId: "log-channel",
    logChannelName: "log",
    slotRoleId: "slot-role",
    slotRoleName: "Slot",
    waitlistRoleId: "waitlist-role",
    waitlistRoleName: "Waitlist",
    idpRoleId: "idp-role",
    idpRoleName: "IDP",
    bannedRoleId: "banned-role",
    bannedRoleName: "Banned",
  };
  const api = createApi({
    getSession: async () => createSessionResponse(),
    getSessionDiscordConfig: async () => config,
    listRegistrations: async () => {
      listRegistrationCount += 1;
      return [registration];
    },
    listTeamMembers: async () => [createTeamMember()],
    updateRegistrationPlacement: async () => {
      updateCount += 1;
      return registration;
    },
    updateSessionDiscordConfig: async () => config,
  });
  const scrimSetup = {
    ensureSetup: async () => setup,
    syncSlotListAndWaitlistMessages: async () => {
      fastMessageCount += 1;
      return {
        managedSlotListMessageId: "slot-message",
        managedWaitlistMessageId: "waitlist-message",
      };
    },
    syncMessages: async () => {
      syncMessageCount += 1;
    },
  };
  const guild = {
    id: "guild-1",
    members: {
      fetch: async () => ({
        roles: {
          add: async () => undefined,
          remove: async () => undefined,
        },
      }),
    },
  } as unknown as Guild;

  const service = new DiscordSessionService(api as any, scrimSetup as any);
  const first = await service.updateRegistrationPlacement(
    "session-1",
    "registration-1",
    { action: "SLOT", slotNumber: 3 },
    guild,
  );
  const second = await service.updateRegistrationPlacement(
    "session-1",
    "registration-1",
    { action: "SLOT", slotNumber: 4 },
    guild,
  );

  assert.equal(first, "Slot 3");
  assert.equal(second, "Slot 3");
  assert.equal(updateCount, 2);
  assert.equal(syncMessageCount, 0);

  await new Promise((resolve) => setTimeout(resolve, 1100));

  assert.equal(fastMessageCount, 1);
  assert.equal(syncMessageCount, 0);
  assert.equal(listRegistrationCount, 3);
});

test("updateRegistrationPlacement remove releases roster after background Discord role sync", async () => {
  const calls: string[] = [];
  const removedRegistration = createSessionRegistration({
    leaderDiscordUserId: "manager-removed",
    managerDiscordUserIds: ["manager-removed"],
  });
  const config = createSessionDiscordConfig({
    guildId: "guild-1",
    categoryId: "category-1",
    registrationChannelId: "registration-channel",
    slotListChannelId: "slot-list-channel",
    waitlistChannelId: "waitlist-channel",
    slotRoleId: "slot-role",
    waitlistRoleId: "waitlist-role",
    idpRoleId: "idp-role",
  });
  const setup = {
    categoryId: "category-1",
    categoryName: "Scrim",
    registrationChannelId: "registration-channel",
    registrationChannelName: "registration",
    slotListChannelId: "slot-list-channel",
    slotListChannelName: "slot-list",
    waitlistChannelId: "waitlist-channel",
    waitlistChannelName: "waitlist",
    idpChannelId: "idp-channel",
    idpChannelName: "idp",
    managerChannelId: "manager-channel",
    managerChannelName: "manager",
    manageChannelId: "manage-channel",
    manageChannelName: "manage",
    resultsChannelId: "results-channel",
    resultsChannelName: "results",
    screenshotsChannelId: "screenshots-channel",
    screenshotsChannelName: "screenshots",
    bansChannelId: "bans-channel",
    bansChannelName: "bans",
    logChannelId: "log-channel",
    logChannelName: "log",
    slotRoleId: "slot-role",
    slotRoleName: "Slot",
    waitlistRoleId: "waitlist-role",
    waitlistRoleName: "Waitlist",
    idpRoleId: "idp-role",
    idpRoleName: "IDP",
    bannedRoleId: "banned-role",
    bannedRoleName: "Banned",
  };
  const removedRoleIds: string[][] = [];
  const api = createApi({
    getSession: async () => createSessionResponse(),
    getSessionDiscordConfig: async () => config,
    listRegistrations: async () => [],
    listTeamMembers: async () => {
      calls.push("listTeamMembers");
      return [];
    },
    removeRegistration: async () => ({
      removedRegistration,
      promotedRegistration: null,
    }),
    updateSessionDiscordConfig: async () => config,
    cleanupDiscordTeam: async () => {
      calls.push("cleanupDiscordTeam");
      return {
        ok: true,
        teamId: removedRegistration.teamId,
        releasedMembers: 1,
      };
    },
  });
  const scrimSetup = {
    ensureSetup: async () => setup,
    syncSlotListAndWaitlistMessages: async () => {
      calls.push("fastMessages");
      return {
        managedSlotListMessageId: "slot-message",
        managedWaitlistMessageId: "waitlist-message",
      };
    },
    syncMessages: async () => undefined,
  };
  const guild = {
    id: "guild-1",
    members: {
      fetch: async (memberId: string) => ({
        id: memberId,
        roles: {
          remove: async (roleIds: string[]) => {
            calls.push("roles.remove");
            removedRoleIds.push(roleIds);
          },
          add: async () => undefined,
        },
      }),
    },
  } as unknown as Guild;

  const service = new DiscordSessionService(api as any, scrimSetup as any);
  const result = await service.updateRegistrationPlacement(
    "session-1",
    "registration-1",
    { action: "REMOVE" },
    guild,
  );

  assert.equal(result, "Removed");
  await new Promise((resolve) => setTimeout(resolve, 1100));

  assert.deepEqual(removedRoleIds, [
    ["slot-role", "waitlist-role", "idp-role"],
  ]);
  assert.ok(calls.indexOf("fastMessages") < calls.indexOf("roles.remove"));
  assert.ok(
    calls.indexOf("roles.remove") < calls.indexOf("cleanupDiscordTeam"),
  );
});

test("affected role sync treats re-added teams as active and manager-only", async () => {
  const config = createSessionDiscordConfig({
    guildId: "guild-1",
    categoryId: "category-1",
    registrationChannelId: "registration-channel",
    slotListChannelId: "slot-list-channel",
    waitlistChannelId: "waitlist-channel",
    slotRoleId: "slot-role",
    waitlistRoleId: "waitlist-role",
    idpRoleId: "idp-role",
  });
  const registration = createSessionRegistration({
    leaderDiscordUserId: "manager-1",
    managerDiscordUserIds: ["manager-1"],
    status: "CONFIRMED",
    slotNumber: 3,
    waitlistPosition: null,
  });
  const roleAdds: Array<{ memberId: string; roleIds: string[] }> = [];
  const roleRemovals: Array<{ memberId: string; roleIds: string[] }> = [];
  const makeMember = (memberId: string, roleIds: string[]) => {
    const roles = new Set(roleIds);
    return {
      id: memberId,
      roles: {
        cache: {
          has: (roleId: string) => roles.has(roleId),
        },
        add: async (ids: string[]) => {
          ids.forEach((roleId) => roles.add(roleId));
          roleAdds.push({ memberId, roleIds: ids });
        },
        remove: async (ids: string[]) => {
          ids.forEach((roleId) => roles.delete(roleId));
          roleRemovals.push({ memberId, roleIds: ids });
        },
      },
    };
  };
  const members = new Map<string, any>([
    ["manager-1", makeMember("manager-1", ["waitlist-role"])],
    ["player-1", makeMember("player-1", ["slot-role", "waitlist-role"])],
  ]);
  const api = createApi({
    getSessionDiscordConfig: async () => config,
    listRegistrations: async () => [registration],
    listTeamMembers: async () => [
      createTeamMember({
        discordUserId: "manager-1",
        role: "LEADER",
      }),
      createTeamMember({
        id: "member-player",
        discordUserId: "player-1",
        role: "PLAYER",
      }),
    ],
  });
  const guild = {
    id: "guild-1",
    members: {
      fetch: async (memberId: string) => members.get(memberId) ?? null,
    },
  } as unknown as Guild;
  const service = new DiscordSessionService(api as any);

  const updated = await (service as any).syncAffectedTeamAccessRoles(
    guild,
    "session-1",
    {
      removedTeamIds: ["team-1"],
      activeTeamIds: ["team-1"],
    },
  );

  assert.equal(updated, true);
  assert.deepEqual(
    Object.fromEntries(
      roleAdds.map((entry) => [entry.memberId, entry.roleIds]),
    ),
    {
      "manager-1": ["slot-role"],
    },
  );
  assert.deepEqual(
    Object.fromEntries(
      roleRemovals.map((entry) => [entry.memberId, entry.roleIds]),
    ),
    {
      "manager-1": ["waitlist-role"],
      "player-1": ["slot-role", "waitlist-role"],
    },
  );
});

test("affected role sync preserves shared slot idp role for active managers", async () => {
  const config = createSessionDiscordConfig({
    guildId: "guild-1",
    categoryId: "category-1",
    registrationChannelId: "registration-channel",
    slotListChannelId: "slot-list-channel",
    waitlistChannelId: "waitlist-channel",
    slotRoleId: "slot-idp-role",
    waitlistRoleId: "waitlist-role",
    idpRoleId: "slot-idp-role",
  });
  const activeRegistration = createSessionRegistration({
    id: "registration-active",
    teamId: "team-active",
    leaderDiscordUserId: "manager-1",
    managerDiscordUserIds: ["manager-1"],
    status: "CONFIRMED",
    slotNumber: 3,
    waitlistPosition: null,
  });
  const removedRegistration = createSessionRegistration({
    id: "registration-removed",
    teamId: "team-removed",
    leaderDiscordUserId: "manager-1",
    managerDiscordUserIds: ["manager-1"],
    status: "REMOVED",
    slotNumber: null,
    waitlistPosition: null,
  });
  const roleAdds: Array<{ memberId: string; roleIds: string[] }> = [];
  const roleRemovals: Array<{ memberId: string; roleIds: string[] }> = [];
  const makeMember = (memberId: string, roleIds: string[]) => {
    const roles = new Set(roleIds);
    return {
      id: memberId,
      roles: {
        cache: {
          has: (roleId: string) => roles.has(roleId),
        },
        add: async (ids: string[]) => {
          ids.forEach((roleId) => roles.add(roleId));
          roleAdds.push({ memberId, roleIds: ids });
        },
        remove: async (ids: string[]) => {
          ids.forEach((roleId) => roles.delete(roleId));
          roleRemovals.push({ memberId, roleIds: ids });
        },
      },
    };
  };
  const members = new Map<string, any>([
    ["manager-1", makeMember("manager-1", ["slot-idp-role", "waitlist-role"])],
  ]);
  const api = createApi({
    getSessionDiscordConfig: async () => config,
    listRegistrations: async () => [activeRegistration, removedRegistration],
    listTeamMembers: async (teamId: string) => [
      createTeamMember({
        teamId,
        discordUserId: "manager-1",
        role: "LEADER",
      }),
    ],
  });
  const guild = {
    id: "guild-1",
    members: {
      fetch: async (memberId: string) => members.get(memberId) ?? null,
    },
  } as unknown as Guild;
  const service = new DiscordSessionService(api as any);

  const updated = await (service as any).syncAffectedTeamAccessRoles(
    guild,
    "session-1",
    {
      removedTeamIds: ["team-removed"],
      activeTeamIds: ["team-active"],
    },
  );

  assert.equal(updated, true);
  assert.deepEqual(roleAdds, []);
  assert.deepEqual(roleRemovals, [
    {
      memberId: "manager-1",
      roleIds: ["waitlist-role"],
    },
  ]);
});

test("affected role sync moves slot manager to waitlist and strips player roles", async () => {
  const config = createSessionDiscordConfig({
    guildId: "guild-1",
    categoryId: "category-1",
    registrationChannelId: "registration-channel",
    slotListChannelId: "slot-list-channel",
    waitlistChannelId: "waitlist-channel",
    slotRoleId: "slot-role",
    waitlistRoleId: "waitlist-role",
    idpRoleId: "idp-role",
  });
  const registration = createSessionRegistration({
    leaderDiscordUserId: "manager-1",
    managerDiscordUserIds: ["manager-1"],
    status: "WAITLIST",
    slotNumber: null,
    waitlistPosition: 1,
  });
  const roleAdds: Array<{ memberId: string; roleIds: string[] }> = [];
  const roleRemovals: Array<{ memberId: string; roleIds: string[] }> = [];
  const makeMember = (memberId: string, roleIds: string[]) => {
    const roles = new Set(roleIds);
    return {
      id: memberId,
      roles: {
        cache: {
          has: (roleId: string) => roles.has(roleId),
        },
        add: async (ids: string[]) => {
          ids.forEach((roleId) => roles.add(roleId));
          roleAdds.push({ memberId, roleIds: ids });
        },
        remove: async (ids: string[]) => {
          ids.forEach((roleId) => roles.delete(roleId));
          roleRemovals.push({ memberId, roleIds: ids });
        },
      },
    };
  };
  const members = new Map<string, any>([
    ["manager-1", makeMember("manager-1", ["slot-role"])],
    ["player-1", makeMember("player-1", ["slot-role", "waitlist-role"])],
  ]);
  const api = createApi({
    getSessionDiscordConfig: async () => config,
    listRegistrations: async () => [registration],
    listTeamMembers: async () => [
      createTeamMember({
        discordUserId: "manager-1",
        role: "LEADER",
      }),
      createTeamMember({
        id: "member-player",
        discordUserId: "player-1",
        role: "PLAYER",
      }),
    ],
  });
  const guild = {
    id: "guild-1",
    members: {
      fetch: async (memberId: string) => members.get(memberId) ?? null,
    },
  } as unknown as Guild;
  const service = new DiscordSessionService(api as any);

  const updated = await (service as any).syncAffectedTeamAccessRoles(
    guild,
    "session-1",
    {
      activeTeamIds: ["team-1"],
    },
  );

  assert.equal(updated, true);
  assert.deepEqual(
    Object.fromEntries(
      roleAdds.map((entry) => [entry.memberId, entry.roleIds]),
    ),
    {
      "manager-1": ["waitlist-role"],
    },
  );
  assert.deepEqual(
    Object.fromEntries(
      roleRemovals.map((entry) => [entry.memberId, entry.roleIds]),
    ),
    {
      "manager-1": ["slot-role"],
      "player-1": ["slot-role", "waitlist-role"],
    },
  );
});

test("affected role sync removes roles from extra removed manager ids", async () => {
  const config = createSessionDiscordConfig({
    guildId: "guild-1",
    categoryId: "category-1",
    registrationChannelId: "registration-channel",
    slotListChannelId: "slot-list-channel",
    waitlistChannelId: "waitlist-channel",
    slotRoleId: "slot-role",
    waitlistRoleId: "waitlist-role",
    idpRoleId: "idp-role",
  });
  const roleRemovals: Array<{ memberId: string; roleIds: string[] }> = [];
  const roles = new Set(["slot-role", "idp-role"]);
  const api = createApi({
    getSessionDiscordConfig: async () => config,
    listRegistrations: async () => [],
    listTeamMembers: async () => [],
  });
  const guild = {
    id: "guild-1",
    members: {
      fetch: async (memberId: string) =>
        memberId === "manager-removed"
          ? {
              id: memberId,
              roles: {
                cache: {
                  has: (roleId: string) => roles.has(roleId),
                },
                add: async () => undefined,
                remove: async (ids: string[]) => {
                  ids.forEach((roleId) => roles.delete(roleId));
                  roleRemovals.push({ memberId, roleIds: ids });
                },
              },
            }
          : null,
    },
  } as unknown as Guild;
  const service = new DiscordSessionService(api as any);

  const updated = await (service as any).syncAffectedTeamAccessRoles(
    guild,
    "session-1",
    {
      removedTeamIds: ["team-removed"],
      extraDiscordUserIds: ["manager-removed"],
    },
  );

  assert.equal(updated, true);
  assert.deepEqual(roleRemovals, [
    {
      memberId: "manager-removed",
      roleIds: ["slot-role", "idp-role"],
    },
  ]);
});

test("team cleanup skips teams that became active again", async () => {
  const cleanupCalls: string[] = [];
  const api = createApi({
    listRegistrations: async () => [
      createSessionRegistration({
        teamId: "team-1",
        status: "CONFIRMED",
        slotNumber: 3,
      }),
    ],
    cleanupDiscordTeam: async (teamId: string) => {
      cleanupCalls.push(teamId);
      return { ok: true, teamId, releasedMembers: 1 };
    },
  });
  const service = new DiscordSessionService(api as any);

  const released = await (service as any).cleanupDiscordTeamsForSession(
    "session-1",
    ["team-1", "team-2"],
  );

  assert.deepEqual(cleanupCalls, ["team-2"]);
  assert.equal(released.get("team-1"), undefined);
  assert.equal(released.get("team-2"), 1);
});

test("cleanSlotFromScrim removes Discord roles before releasing the team roster", async () => {
  const calls: string[] = [];
  const removedRegistration = createSessionRegistration();
  const config = createSessionDiscordConfig({
    guildId: "guild-1",
    categoryId: "category-1",
    registrationChannelId: "registration-channel",
    slotListChannelId: "slot-list-channel",
    waitlistChannelId: "waitlist-channel",
    slotRoleId: "slot-role",
    waitlistRoleId: "waitlist-role",
    idpRoleId: "idp-role",
  });
  const setup = {
    categoryId: "category-1",
    categoryName: "Scrim",
    registrationChannelId: "registration-channel",
    registrationChannelName: "registration",
    slotListChannelId: "slot-list-channel",
    slotListChannelName: "slot-list",
    waitlistChannelId: "waitlist-channel",
    waitlistChannelName: "waitlist",
    idpChannelId: "idp-channel",
    idpChannelName: "idp",
    managerChannelId: "manager-channel",
    managerChannelName: "manager",
    manageChannelId: "manage-channel",
    manageChannelName: "manage",
    resultsChannelId: "results-channel",
    resultsChannelName: "results",
    screenshotsChannelId: "screenshots-channel",
    screenshotsChannelName: "screenshots",
    bansChannelId: "bans-channel",
    bansChannelName: "bans",
    logChannelId: "log-channel",
    logChannelName: "log",
    slotRoleId: "slot-role",
    slotRoleName: "Slot",
    waitlistRoleId: "waitlist-role",
    waitlistRoleName: "Waitlist",
    idpRoleId: "idp-role",
    idpRoleName: "IDP",
    bannedRoleId: "banned-role",
    bannedRoleName: "Banned",
  };
  let removed = false;
  const removedRoleIds: string[][] = [];
  const api = createApi({
    getSession: async () => createSessionResponse(),
    getSessionDiscordConfig: async () => config,
    listRegistrations: async () => (removed ? [] : [removedRegistration]),
    listTeamMembers: async () => {
      calls.push("listTeamMembers");
      return [createTeamMember()];
    },
    removeRegistration: async () => {
      calls.push("removeRegistration");
      removed = true;
      return {
        removedRegistration,
        promotedRegistration: null,
      };
    },
    updateSessionDiscordConfig: async () => config,
    cleanupDiscordTeam: async () => {
      calls.push("cleanupDiscordTeam");
      return { ok: true, teamId: "team-1", releasedMembers: 1 };
    },
  });
  const scrimSetup = {
    ensureSetup: async () => setup,
    syncSlotListAndWaitlistMessages: async () => {
      calls.push("fastMessages");
      return {
        managedSlotListMessageId: "slot-message",
        managedWaitlistMessageId: "waitlist-message",
      };
    },
    syncMessages: async () => undefined,
  };
  const guild = {
    id: "guild-1",
    members: {
      fetch: async () => ({
        roles: {
          remove: async (roleIds: string[]) => {
            calls.push("roles.remove");
            removedRoleIds.push(roleIds);
          },
          add: async () => undefined,
        },
      }),
    },
  } as unknown as Guild;

  const service = new DiscordSessionService(api as any, scrimSetup as any);
  const result = await service.cleanSlotFromScrim("session-1", 3, guild);

  assert.match(result, /Discord refresh and roster release queued/);
  assert.deepEqual(removedRoleIds, []);

  await new Promise((resolve) => setTimeout(resolve, 250));

  assert.deepEqual(removedRoleIds, [
    ["slot-role", "waitlist-role", "idp-role"],
  ]);
  assert.ok(calls.indexOf("fastMessages") < calls.indexOf("roles.remove"));
  assert.ok(
    calls.indexOf("roles.remove") < calls.indexOf("cleanupDiscordTeam"),
  );
});

test("cleanSlotFromScrim restores active ban roles after access role cleanup", async () => {
  const calls: string[] = [];
  const permanentRoleId = "111111111111111111";
  const bannedRoleId = "222222222222222222";
  const removedRegistration = createSessionRegistration({
    leaderDiscordUserId: "leader-1",
    managerDiscordUserIds: ["leader-1"],
    slotNumber: 3,
  });
  const config = createSessionDiscordConfig({
    guildId: "guild-1",
    categoryId: "category-1",
    registrationChannelId: "registration-channel",
    slotListChannelId: "slot-list-channel",
    waitlistChannelId: "waitlist-channel",
    slotRoleId: "333333333333333333",
    slotRoleName: "Slot",
    waitlistRoleId: "444444444444444444",
    waitlistRoleName: "Waitlist",
    idpRoleId: "333333333333333333",
    idpRoleName: "Slot",
    bannedRoleId,
    bannedRoleName: "Banned",
    emojis: {
      ban: "BAN",
      banServerAction: "ROLE",
      permanentBanRoleIds: `${permanentRoleId}\n${bannedRoleId}`,
    },
  });
  const setup = {
    categoryId: "category-1",
    categoryName: "Scrim",
    registrationChannelId: "registration-channel",
    registrationChannelName: "registration",
    slotListChannelId: "slot-list-channel",
    slotListChannelName: "slot-list",
    waitlistChannelId: "waitlist-channel",
    waitlistChannelName: "waitlist",
    idpChannelId: "idp-channel",
    idpChannelName: "idp",
    managerChannelId: "manager-channel",
    managerChannelName: "manager",
    transferChannelId: "transfer-channel",
    transferChannelName: "transfer",
    manageChannelId: "manage-channel",
    manageChannelName: "manage",
    resultsChannelId: "results-channel",
    resultsChannelName: "results",
    screenshotsChannelId: "screenshots-channel",
    screenshotsChannelName: "screenshots",
    bansChannelId: "bans-channel",
    bansChannelName: "bans",
    logChannelId: "log-channel",
    logChannelName: "log",
    slotRoleId: "333333333333333333",
    slotRoleName: "Slot",
    waitlistRoleId: "444444444444444444",
    waitlistRoleName: "Waitlist",
    idpRoleId: "333333333333333333",
    idpRoleName: "Slot",
    bannedRoleId,
    bannedRoleName: "Banned",
  };
  let removed = false;
  const roleAdds: Array<{ roleId: string; reason: string }> = [];
  const memberRoles = new Set<string>([
    "333333333333333333",
    permanentRoleId,
    bannedRoleId,
  ]);
  const api = createApi({
    getSession: async () => createSessionResponse(),
    getSessionDiscordConfig: async () => config,
    listRegistrations: async () => (removed ? [] : [removedRegistration]),
    listTeamMembers: async () => [
      createTeamMember({
        discordUserId: "leader-1",
        role: "LEADER",
      }),
    ],
    listSessionMatches: async () => [],
    listManagerBans: async (params: any) =>
      params.active === true && params.discordUserId === "leader-1"
        ? [
            {
              id: "manager-ban-1",
              organizationId: "org-1",
              discordUserId: "leader-1",
              discordUsername: "leader",
              displayName: "Leader",
              scope: "SESSION",
              sessionId: "session-1",
              matchId: null,
              reason: "Manual Discord ban",
              note: null,
              expiresAt: null,
              revokedAt: null,
              revokeReason: null,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              active: true,
            },
          ]
        : [],
    removeRegistration: async () => {
      removed = true;
      return {
        removedRegistration,
        promotedRegistration: null,
      };
    },
    updateSessionDiscordConfig: async () => config,
    cleanupDiscordTeam: async () => {
      calls.push("cleanupDiscordTeam");
      return { ok: true, teamId: "team-1", releasedMembers: 1 };
    },
  });
  const scrimSetup = {
    ensureSetup: async () => setup,
    syncSlotListAndWaitlistMessages: async () => {
      calls.push("fastMessages");
      return {
        managedSlotListMessageId: "slot-message",
        managedWaitlistMessageId: "waitlist-message",
      };
    },
    syncMessages: async () => undefined,
  };
  const roles = new Map([
    [permanentRoleId, { id: permanentRoleId, name: "Permanent Banned" }],
    [bannedRoleId, { id: bannedRoleId, name: "Banned" }],
  ]);
  const member = {
    id: "leader-1",
    roles: {
      cache: {
        has: (roleId: string) => memberRoles.has(roleId),
      },
      remove: async (roleIds: string[]) => {
        calls.push("roles.remove");
        for (const roleId of roleIds) {
          memberRoles.delete(roleId);
        }
        memberRoles.delete(permanentRoleId);
        memberRoles.delete(bannedRoleId);
      },
      add: async (role: { id: string }, reason: string) => {
        calls.push(`roles.add:${role.id}`);
        memberRoles.add(role.id);
        roleAdds.push({ roleId: role.id, reason });
      },
    },
  };
  const guild = {
    id: "guild-1",
    roles: {
      cache: {
        get: (roleId: string) => roles.get(roleId),
        find: () => undefined,
      },
    },
    members: {
      fetch: async () => member,
    },
  } as unknown as Guild;

  const service = new DiscordSessionService(api as any, scrimSetup as any);
  const result = await service.cleanSlotFromScrim("session-1", 3, guild);

  assert.match(result, /Discord refresh and roster release queued/);
  await new Promise((resolve) => setTimeout(resolve, 350));

  assert.deepEqual(roleAdds, [
    {
      roleId: permanentRoleId,
      reason: "Arenzyra active ban role restore session-",
    },
  ]);
  assert.equal(memberRoles.has(permanentRoleId), true);
  assert.equal(memberRoles.has(bannedRoleId), false);
  assert.ok(
    calls.indexOf("roles.remove") <
      calls.indexOf(`roles.add:${permanentRoleId}`),
  );
  assert.equal(calls.includes(`roles.add:${bannedRoleId}`), false);
  assert.ok(
    calls.indexOf(`roles.add:${permanentRoleId}`) <
      calls.indexOf("cleanupDiscordTeam"),
  );
});

test("cleanAllSlotsFromScrim clears assigned slots without promoting waitlist rows", async () => {
  const calls: string[] = [];
  const removedRegistrations = [
    createSessionRegistration({
      id: "registration-1",
      teamId: "team-1",
      slotNumber: 3,
    }),
    createSessionRegistration({
      id: "registration-2",
      teamId: "team-2",
      slotNumber: 4,
      team: {
        id: "team-2",
        name: "Team NXT",
        tag: "NXT",
        logoUrl: null,
        countryCode: null,
        region: null,
      },
    }),
  ];
  const config = createSessionDiscordConfig({
    guildId: "guild-1",
    categoryId: "category-1",
    registrationChannelId: "registration-channel",
    slotListChannelId: "slot-list-channel",
    waitlistChannelId: "waitlist-channel",
    slotRoleId: "slot-role",
    waitlistRoleId: "waitlist-role",
    idpRoleId: "idp-role",
  });
  const setup = {
    categoryId: "category-1",
    categoryName: "Scrim",
    registrationChannelId: "registration-channel",
    registrationChannelName: "registration",
    slotListChannelId: "slot-list-channel",
    slotListChannelName: "slot-list",
    waitlistChannelId: "waitlist-channel",
    waitlistChannelName: "waitlist",
    idpChannelId: "idp-channel",
    idpChannelName: "idp",
    managerChannelId: "manager-channel",
    managerChannelName: "manager",
    manageChannelId: "manage-channel",
    manageChannelName: "manage",
    resultsChannelId: "results-channel",
    resultsChannelName: "results",
    screenshotsChannelId: "screenshots-channel",
    screenshotsChannelName: "screenshots",
    bansChannelId: "bans-channel",
    bansChannelName: "bans",
    logChannelId: "log-channel",
    logChannelName: "log",
    slotRoleId: "slot-role",
    slotRoleName: "Slot",
    waitlistRoleId: "waitlist-role",
    waitlistRoleName: "Waitlist",
    idpRoleId: "idp-role",
    idpRoleName: "IDP",
    bannedRoleId: "banned-role",
    bannedRoleName: "Banned",
  };
  const api = createApi({
    getSession: async () => createSessionResponse(),
    getSessionDiscordConfig: async () => config,
    listRegistrations: async () => [],
    listTeamMembers: async (teamId: string) => {
      calls.push(`listTeamMembers:${teamId}`);
      return [createTeamMember({ teamId, discordUserId: `${teamId}-leader` })];
    },
    removeSlotRegistrations: async () => {
      calls.push("removeSlotRegistrations");
      return {
        removedRegistrations,
        removedTeamIds: ["team-1", "team-2"],
        removedSlots: [3, 4],
      };
    },
    updateSessionDiscordConfig: async () => config,
    cleanupDiscordTeam: async (teamId: string) => {
      calls.push(`cleanupDiscordTeam:${teamId}`);
      return { ok: true, teamId, releasedMembers: 1 };
    },
  });
  const scrimSetup = {
    ensureSetup: async () => setup,
    syncSlotListAndWaitlistMessages: async () => {
      calls.push("fastMessages");
      return {
        managedSlotListMessageId: "slot-message",
        managedWaitlistMessageId: "waitlist-message",
      };
    },
    syncMessages: async () => undefined,
  };
  const guild = {
    id: "guild-1",
    members: {
      fetch: async () => ({
        roles: {
          remove: async () => {
            calls.push("roles.remove");
          },
          add: async () => undefined,
        },
      }),
    },
  } as unknown as Guild;

  const service = new DiscordSessionService(api as any, scrimSetup as any);
  const result = await service.cleanAllSlotsFromScrim("session-1", guild);

  assert.match(result, /Cleaned all assigned slots \(#3, #4\)/);
  assert.match(result, /2 teams removed/);
  assert.match(result, /Waitlist entries were kept/);
  assert.equal(
    calls.filter((call) => call === "removeSlotRegistrations").length,
    1,
  );
  assert.equal(calls.filter((call) => call === "roles.remove").length, 0);

  await new Promise((resolve) => setTimeout(resolve, 250));

  assert.ok(calls.indexOf("fastMessages") < calls.indexOf("roles.remove"));
  assert.equal(calls.filter((call) => call === "roles.remove").length, 2);
  assert.ok(
    calls.indexOf("roles.remove") < calls.indexOf("cleanupDiscordTeam:team-1"),
  );
});

test("cleanAllSlotsFromScrim refreshes Discord when database slots are already empty", async () => {
  const calls: string[] = [];
  const config = createSessionDiscordConfig({
    guildId: "guild-1",
    categoryId: "category-1",
    registrationChannelId: "registration-channel",
    slotListChannelId: "slot-list-channel",
    waitlistChannelId: "waitlist-channel",
  });
  const setup = {
    categoryId: "category-1",
    categoryName: "Scrim",
    registrationChannelId: "registration-channel",
    registrationChannelName: "registration",
    slotListChannelId: "slot-list-channel",
    slotListChannelName: "slot-list",
    waitlistChannelId: "waitlist-channel",
    waitlistChannelName: "waitlist",
    idpChannelId: "idp-channel",
    idpChannelName: "idp",
    managerChannelId: "manager-channel",
    managerChannelName: "manager",
    manageChannelId: "manage-channel",
    manageChannelName: "manage",
    resultsChannelId: "results-channel",
    resultsChannelName: "results",
    screenshotsChannelId: "screenshots-channel",
    screenshotsChannelName: "screenshots",
    bansChannelId: "bans-channel",
    bansChannelName: "bans",
    logChannelId: "log-channel",
    logChannelName: "log",
    slotRoleId: "slot-role",
    slotRoleName: "Slot",
    staffRoleId: "staff-role",
    staffRoleName: "Staff",
    waitlistRoleId: "waitlist-role",
    waitlistRoleName: "Waitlist",
    idpRoleId: "idp-role",
    idpRoleName: "IDP",
    bannedRoleId: "banned-role",
    bannedRoleName: "Banned",
  };
  const api = createApi({
    getSession: async () => createSessionResponse(),
    getSessionDiscordConfig: async () => config,
    listRegistrations: async () => [],
    removeSlotRegistrations: async () => {
      calls.push("removeSlotRegistrations");
      return {
        removedRegistrations: [],
        removedTeamIds: [],
        removedSlots: [],
      };
    },
    updateSessionDiscordConfig: async () => {
      calls.push("updateSessionDiscordConfig");
      return config;
    },
  });
  const scrimSetup = {
    ensureSetup: async () => {
      calls.push("ensureSetup");
      return setup;
    },
    syncSlotListAndWaitlistMessages: async () => {
      calls.push("fastMessages");
      return {
        managedSlotListMessageId: "slot-message",
        managedWaitlistMessageId: "waitlist-message",
      };
    },
    syncMessages: async () => {
      calls.push("syncMessages");
      return undefined;
    },
  };
  const guild = { id: "guild-1" } as unknown as Guild;

  const service = new DiscordSessionService(api as any, scrimSetup as any);
  const result = await service.cleanAllSlotsFromScrim("session-1", guild);

  assert.match(result, /No assigned slots to clean/);
  assert.match(result, /role reconciliation queued from the database/);
  assert.deepEqual(calls, ["removeSlotRegistrations"]);

  await new Promise((resolve) => setTimeout(resolve, 250));

  assert.deepEqual(calls, [
    "removeSlotRegistrations",
    "fastMessages",
    "updateSessionDiscordConfig",
  ]);
});

test("cleanWaitlistFromScrim removes only waitlist teams and queues role cleanup", async () => {
  const calls: string[] = [];
  const registrations = [
    createSessionRegistration({
      id: "registration-slot",
      teamId: "team-slot",
      slotNumber: 3,
      waitlistPosition: null,
    }),
    createSessionRegistration({
      id: "registration-waitlist-1",
      teamId: "team-wait-1",
      slotNumber: null,
      waitlistPosition: 1,
      status: "WAITLIST",
    }),
    createSessionRegistration({
      id: "registration-waitlist-2",
      teamId: "team-wait-2",
      slotNumber: null,
      waitlistPosition: 2,
      status: "WAITLIST",
    }),
  ];
  const config = createSessionDiscordConfig({
    guildId: "guild-1",
    waitlistChannelId: "waitlist-channel",
    waitlistRoleId: "waitlist-role",
  });
  const api = createApi({
    getSessionDiscordConfig: async () => config,
    listRegistrations: async () => registrations,
    removeRegistration: async (
      _sessionId: string,
      registrationId: string,
      payload: any,
    ) => {
      calls.push(`${registrationId}:${payload?.removalReason}`);
      const removedRegistration = registrations.find(
        (registration) => registration.id === registrationId,
      );
      assert.ok(removedRegistration);
      return {
        removedRegistration,
        promotedRegistration: null,
      };
    },
  });
  const service = new DiscordSessionService(api as any);
  (service as any).syncDiscordScrimStateInBackground = (
    _guild: unknown,
    _sessionId: string,
    options: { removedTeamIds?: string[]; cleanupTeamIds?: string[] },
  ) => {
    calls.push(
      `sync:${options.removedTeamIds?.join(",")}:${options.cleanupTeamIds?.join(",")}`,
    );
  };
  (service as any).cleanScrimRolesInBackground = () => {
    calls.push("cleanScrimRolesInBackground");
  };
  (service as any).sendDiscordActionLog = async () => {
    calls.push("sendDiscordActionLog");
  };
  (service as any).cleanupStaleWaitlistDiscordState = async () => {
    calls.push("cleanupStaleWaitlistDiscordState");
    return {
      deletedMessages: 0,
      failedRoles: 0,
      removedRoles: 0,
      staleUserIds: 0,
    };
  };

  const result = await service.cleanWaitlistFromScrim("session-1", {
    id: "guild-1",
  } as unknown as Guild);

  assert.match(result, /Cleaned waitlist \(#1, #2\)/);
  assert.match(result, /2 teams removed/);
  assert.match(result, /Assigned slot teams were kept/);
  assert.deepEqual(calls, [
    "registration-waitlist-1:Cleaned waitlist via Discord bot",
    "registration-waitlist-2:Cleaned waitlist via Discord bot",
    "cleanupStaleWaitlistDiscordState",
    "sync:team-wait-1,team-wait-2:team-wait-1,team-wait-2",
    "cleanScrimRolesInBackground",
    "sendDiscordActionLog",
  ]);
});

test("registerTeam syncs configured Discord roles after backend registration", async () => {
  const registration = createRegistrationResponse();
  const appliedRoles = new Map<string, string[]>();
  let capturedPayload: any = null;
  const config: DiscordConfigResponse = {
    enabled: true,
    guildId: "guild-1",
    captainRoleId: "captain-role",
    participantRoleId: "participant-role",
    autoSyncRoles: true,
  };

  const api = createApi({
    registerDiscordTeam: async (payload: any) => {
      capturedPayload = payload;
      return registration;
    },
    getDiscordConfig: async () => config,
  });

  const guild = {
    id: "guild-1",
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
    "leader-1",
    "leader",
    "Leader",
    " dxb ",
    "Team DXB",
    [
      {
        discordUserId: "player-1",
        discordUsername: "player",
        displayName: "Player",
      },
    ],
    guild,
    "https://cdn.discordapp.com/team-dxb.png",
  );

  assert.equal(
    capturedPayload.logoUrl,
    "https://cdn.discordapp.com/team-dxb.png",
  );
  assert.match(result, /Discord roles synced for 2 member\(s\)\./);
  assert.deepEqual(appliedRoles.get("leader-1"), [
    "participant-role",
    "captain-role",
  ]);
  assert.deepEqual(appliedRoles.get("player-1"), ["participant-role"]);
});

test("listSlots includes only clickable mentions for every active team manager", async () => {
  const api = createApi({
    getSession: async () => createSessionResponse({ slotCount: 3 }),
    getSessionDiscordConfig: async () =>
      createSessionDiscordConfig({
        startSlot: 3,
        normalSlots: 1,
        vipSlots: 0,
      }),
    listRegistrations: async () => [createSessionRegistration()],
    listTeamMembers: async () => [
      createTeamMember({
        discordUserId: "leader-1",
        role: "LEADER",
        createdAt: "2026-05-10T10:00:00.000Z",
      }),
      createTeamMember({
        id: "member-2",
        discordUserId: "manager-2",
        discordUsername: "manager",
        displayName: "Manager",
        role: "LEADER",
        createdAt: "2026-05-10T10:01:00.000Z",
      }),
      createTeamMember({
        id: "member-3",
        discordUserId: "inactive-1",
        role: "PLAYER",
        leftAt: "2026-05-10T10:02:00.000Z",
      }),
    ],
  });

  const service = new DiscordSessionService(api as any);
  const result = await service.listSlots("session-1");

  assert.match(result, /\[DXB\] Team DXB <@leader-1> <@manager-2>/);
  assert.doesNotMatch(result, /@Leader/);
  assert.doesNotMatch(result, /@Manager/);
  assert.doesNotMatch(result, /inactive-1/);
});

test("listSlots renders only the saved registration manager snapshot when present", async () => {
  const api = createApi({
    getSession: async () => createSessionResponse({ slotCount: 3 }),
    getSessionDiscordConfig: async () =>
      createSessionDiscordConfig({
        startSlot: 3,
        normalSlots: 1,
        vipSlots: 0,
      }),
    listRegistrations: async () => [
      createSessionRegistration({
        leaderDiscordUserId: "requester-1",
        managerDiscordUserIds: ["mentioned-1"],
      }),
    ],
    listTeamMembers: async () => [
      createTeamMember({
        discordUserId: "requester-1",
        role: "LEADER",
      }),
      createTeamMember({
        id: "member-2",
        discordUserId: "old-manager-1",
        discordUsername: "old-manager",
        displayName: "Old Manager",
        role: "LEADER",
      }),
    ],
  });

  const service = new DiscordSessionService(api as any);
  const result = await service.listSlots("session-1");

  assert.match(result, /\[DXB\] Team DXB <@mentioned-1>/);
  assert.doesNotMatch(result, /requester-1/);
  assert.doesNotMatch(result, /old-manager-1/);
});

test("addSessionTeamManager appends the mentioned manager to the session snapshot", async () => {
  const registration = createSessionRegistration({
    id: "registration-1",
    leaderDiscordUserId: "old-manager",
    managerDiscordUserIds: ["old-manager"],
  });
  const calls: string[] = [];
  let capturedTransferPayload: any = null;
  let capturedManagerPayload: any = null;
  const api = createApi({
    getSession: async () => createSessionResponse(),
    getSessionDiscordConfig: async () => createSessionDiscordConfig(),
    listRegistrations: async () => [registration],
    listTeamMembers: async () => [
      createTeamMember({
        discordUserId: "old-manager",
        discordUsername: "old",
        displayName: "Old Manager",
        role: "LEADER",
      }),
    ],
    registerDiscordTeam: async (payload: any) => {
      calls.push("registerDiscordTeam");
      capturedTransferPayload = payload;
      return createRegistrationResponse({ created: false });
    },
    updateRegistrationManagers: async (
      sessionId: string,
      registrationId: string,
      payload: any,
    ) => {
      calls.push("updateRegistrationManagers");
      assert.equal(sessionId, "session-1");
      assert.equal(registrationId, "registration-1");
      capturedManagerPayload = payload;
      return {
        ...registration,
        leaderDiscordUserId: payload.leaderDiscordUserId,
        managerDiscordUserIds: payload.managerDiscordUserIds,
      };
    },
  });
  const service = new DiscordSessionService(api as any);
  (service as any).syncAffectedTeamAccessRoles = async () => {
    calls.push("syncAffectedTeamAccessRoles");
    return true;
  };
  (service as any).syncVisibleDiscordMessagesFast = async () => {
    calls.push("syncVisibleDiscordMessagesFast");
    return true;
  };
  (service as any).sendDiscordActionLog = async () => undefined;

  const result = await service.addSessionTeamManager(
    { id: "guild-1" } as unknown as Guild,
    "session-1",
    "DXB",
    {
      discordUserId: "new-manager",
      discordUsername: "new",
      displayName: "New Manager",
    },
    {
      requesterDiscordId: "old-manager",
      actorDiscordId: "old-manager",
      actorLabel: "Old Manager",
      sourceChannelId: "transfer-channel",
    },
  );

  assert.deepEqual(calls, [
    "registerDiscordTeam",
    "updateRegistrationManagers",
    "syncAffectedTeamAccessRoles",
    "syncVisibleDiscordMessagesFast",
  ]);
  assert.equal(capturedTransferPayload.allowDiscordMemberTransfer, true);
  assert.equal(capturedTransferPayload.contextSessionId, "session-1");
  assert.deepEqual(capturedTransferPayload.members, [
    {
      discordUserId: "new-manager",
      discordUsername: "new",
      displayName: "New Manager",
      role: "LEADER",
    },
  ]);
  assert.deepEqual(capturedManagerPayload, {
    leaderDiscordUserId: "old-manager",
    managerDiscordUserIds: ["old-manager", "new-manager"],
  });
  assert.match(result, /Added <@new-manager>/);
});

test("removeSessionTeamManager removes only the target from the session snapshot", async () => {
  const registration = createSessionRegistration({
    id: "registration-1",
    leaderDiscordUserId: "old-manager",
    managerDiscordUserIds: ["old-manager", "new-manager"],
  });
  const calls: string[] = [];
  let capturedManagerPayload: any = null;
  const api = createApi({
    getSession: async () => createSessionResponse(),
    getSessionDiscordConfig: async () => createSessionDiscordConfig(),
    listRegistrations: async () => [registration],
    listTeamMembers: async () => [
      createTeamMember({
        discordUserId: "old-manager",
        discordUsername: "old",
        displayName: "Old Manager",
        role: "LEADER",
      }),
      createTeamMember({
        id: "member-2",
        discordUserId: "new-manager",
        discordUsername: "new",
        displayName: "New Manager",
        role: "LEADER",
      }),
    ],
    updateRegistrationManagers: async (
      sessionId: string,
      registrationId: string,
      payload: any,
    ) => {
      calls.push("updateRegistrationManagers");
      assert.equal(sessionId, "session-1");
      assert.equal(registrationId, "registration-1");
      capturedManagerPayload = payload;
      return {
        ...registration,
        leaderDiscordUserId: payload.leaderDiscordUserId,
        managerDiscordUserIds: payload.managerDiscordUserIds,
      };
    },
    releaseDiscordTeamMember: async (teamId: string, discordUserId: string) => {
      calls.push(`releaseDiscordTeamMember:${teamId}:${discordUserId}`);
      return {
        ok: true,
        teamId,
        removedMember: createTeamMember({ discordUserId }),
        promotedMember: null,
      };
    },
  });
  const service = new DiscordSessionService(api as any);
  (service as any).syncAffectedTeamAccessRoles = async () => {
    calls.push("syncAffectedTeamAccessRoles");
    return true;
  };
  (service as any).syncVisibleDiscordMessagesFast = async () => {
    calls.push("syncVisibleDiscordMessagesFast");
    return true;
  };
  (service as any).sendDiscordActionLog = async () => undefined;

  const result = await service.removeSessionTeamManager(
    { id: "guild-1" } as unknown as Guild,
    "session-1",
    "DXB",
    "new-manager",
    {
      requesterDiscordId: "old-manager",
      actorDiscordId: "old-manager",
      actorLabel: "Old Manager",
      sourceChannelId: "transfer-channel",
    },
  );

  assert.deepEqual(calls, [
    "updateRegistrationManagers",
    "releaseDiscordTeamMember:team-1:new-manager",
    "syncAffectedTeamAccessRoles",
    "syncVisibleDiscordMessagesFast",
  ]);
  assert.deepEqual(capturedManagerPayload, {
    leaderDiscordUserId: "old-manager",
    managerDiscordUserIds: ["old-manager"],
  });
  assert.match(result, /Removed <@new-manager>/);
});

test("listSlots falls back to registration manager snapshots when team lookup fails", async () => {
  const api = createApi({
    getSession: async () => createSessionResponse({ slotCount: 3 }),
    getSessionDiscordConfig: async () =>
      createSessionDiscordConfig({
        startSlot: 3,
        normalSlots: 1,
        vipSlots: 0,
      }),
    listRegistrations: async () => [
      createSessionRegistration({
        leaderDiscordUserId: "manager-1",
        managerDiscordUserIds: ["manager-1"],
      }),
    ],
    listTeamMembers: async () => {
      throw new Error("Team not found");
    },
  });
  const guild = {
    members: {
      cache: new Collection([["manager-1", { user: { bot: false } }]] as any),
      fetch: async () => ({ user: { bot: false } }),
    },
  } as unknown as Guild;

  const service = new DiscordSessionService(api as any);
  const result = await service.listSlots("session-1", guild);

  assert.match(result, /\[DXB\] Team DXB <@manager-1>/);
});

test("listSlots hides leader mentions that are not visible in the guild", async () => {
  const api = createApi({
    getSession: async () => createSessionResponse({ slotCount: 3 }),
    getSessionDiscordConfig: async () =>
      createSessionDiscordConfig({
        startSlot: 3,
        normalSlots: 1,
        vipSlots: 0,
      }),
    listRegistrations: async () => [createSessionRegistration()],
    listTeamMembers: async () => [
      createTeamMember({
        discordUserId: "leader-1",
        discordUsername: "leader",
        displayName: "Leader",
        role: "LEADER",
      }),
      createTeamMember({
        id: "member-2",
        discordUserId: "missing-1",
        discordUsername: "missing-manager",
        displayName: "Missing Manager",
        role: "LEADER",
      }),
    ],
  });
  const guild = {
    members: {
      cache: new Collection([["leader-1", { user: { bot: false } }]] as any),
      fetch: async ({ user }: { user: string }) => {
        if (user === "leader-1") {
          return { user: { bot: false } };
        }
        throw new Error("Unknown Member");
      },
    },
  } as unknown as Guild;

  const service = new DiscordSessionService(api as any);
  const result = await service.listSlots("session-1", guild);

  assert.match(result, /\[DXB\] Team DXB <@leader-1>/);
  assert.doesNotMatch(result, /missing-1/);
  assert.doesNotMatch(result, /@Leader/);
  assert.doesNotMatch(result, /@Missing Manager/);
});

test("listSlots still renders when guild member lookup stalls", async () => {
  const api = createApi({
    getSession: async () => createSessionResponse({ slotCount: 3 }),
    getSessionDiscordConfig: async () =>
      createSessionDiscordConfig({
        startSlot: 3,
        normalSlots: 1,
        vipSlots: 0,
      }),
    listRegistrations: async () => [createSessionRegistration()],
    listTeamMembers: async () => [
      createTeamMember({
        discordUserId: "slow-leader-1",
        discordUsername: "slow-leader",
        displayName: "Slow Leader",
        role: "LEADER",
      }),
    ],
  });
  const guild = {
    members: {
      cache: new Collection(),
      fetch: async () => new Promise(() => undefined),
    },
  } as unknown as Guild;

  const service = new DiscordSessionService(api as any);
  const startedAt = Date.now();
  const result = await service.listSlots("session-1", guild);

  assert.ok(Date.now() - startedAt < 2_000);
  assert.match(result, /\[DXB\] Team DXB/);
  assert.doesNotMatch(result, /<@slow-leader-1>/);
  assert.doesNotMatch(result, /@Slow Leader/);
});

test("findLatestAcceptingScrim returns the newest open or check-in scrim", async () => {
  const api = createApi({
    getSessionDiscordConfig: async () => createSessionDiscordConfig(),
    listSessions: async () => [
      createSessionResponse({
        id: "event-1",
        type: "EVENT",
        status: "OPEN",
      }),
      createSessionResponse({
        id: "ended-scrim",
        status: "ENDED",
      }),
      createSessionResponse({
        id: "open-scrim",
        status: "OPEN",
      }),
    ],
  });

  const service = new DiscordSessionService(api as any);
  const result = await service.findLatestAcceptingScrim();

  assert.equal(result?.id, "open-scrim");
});

test("scheduled auto cleanup deletes only unprotected channel messages once per day", async () => {
  const deletedIds: string[] = [];
  const logMessages: any[] = [];
  let fetchCount = 0;
  let targetChannel: any;

  const createMessage = (id: string, overrides: Record<string, unknown> = {}) =>
    ({
      id,
      pinned: false,
      embeds: [],
      createdTimestamp: Date.now(),
      channel: targetChannel,
      delete: async () => {
        deletedIds.push(id);
      },
      ...overrides,
    }) as any;

  const messages = [
    createMessage("delete-1"),
    createMessage("pinned-1", { pinned: true }),
    createMessage("protected-1"),
    createMessage("early-access-1"),
    createMessage("vip-access-1"),
    createMessage("managed-1", {
      embeds: [{ footer: { text: "arenzyra:session-1:slot-list" } }],
    }),
  ];

  targetChannel = {
    id: "registration-channel",
    isTextBased: () => true,
    isDMBased: () => false,
    messages: {
      fetch: async () => {
        fetchCount += 1;
        return new Collection(messages.map((message) => [message.id, message]));
      },
    },
    bulkDelete: async (chunk: any[]) => {
      const deleted = new Collection<string, any>();
      for (const message of chunk) {
        deletedIds.push(message.id);
        deleted.set(message.id, message);
      }
      return deleted;
    },
  };
  for (const message of messages) {
    message.channel = targetChannel;
  }

  const logChannel = {
    id: "log-channel",
    isTextBased: () => true,
    isDMBased: () => false,
    send: async (payload: any) => {
      logMessages.push(payload);
    },
  };
  const guild = {
    id: "guild-1",
    channels: {
      fetch: async (channelId: string) =>
        channelId === "registration-channel"
          ? targetChannel
          : channelId === "log-channel"
            ? logChannel
            : null,
    },
  } as unknown as Guild;
  const config = createSessionDiscordConfig({
    guildId: "guild-1",
    registrationChannelId: "registration-channel",
    logChannelId: "log-channel",
    emojis: {
      autoCleanupTimeZone: "UTC",
      autoCleanupSchedules: JSON.stringify([
        {
          channel: "registration",
          enabled: true,
          time: "12:34",
          mode: "safe",
          limit: 50,
        },
      ]),
      managedRegistrationPanelMessageId: "protected-1",
      managedEarlyAccessStatusMessageId: "early-access-1",
      managedVipAccessStatusMessageId: "vip-access-1",
    },
  });
  const service = new DiscordSessionService(createApi({}) as any);
  const session = createSessionResponse();
  const now = new Date(Date.UTC(2026, 4, 7, 12, 34, 10));

  await (service as any).runDueAutoCleanups(guild, session, config, now);
  await (service as any).runDueAutoCleanups(guild, session, config, now);

  assert.deepEqual(deletedIds, ["delete-1"]);
  assert.equal(fetchCount, 1);
  assert.equal(logMessages.length, 1);
  assert.match(logMessages[0].content, /Deleted: 1/);
  assert.doesNotMatch(logMessages[0].content, /protected-1/);
  assert.doesNotMatch(logMessages[0].content, /early-access-1/);
  assert.doesNotMatch(logMessages[0].content, /vip-access-1/);
});

test("slot-list cleanup preserves real slot-list messages while removing stale buttons", async () => {
  const service = new DiscordSessionService(createApi({}) as any) as any;
  let deleted = false;
  let editPayload: any = null;
  const message: any = {
    id: "new-slot-list",
    type: MessageType.Default,
    guild: { id: "guild-1" },
    author: { id: "bot-user" },
    client: { user: { id: "bot-user" } },
    channelId: "slot-list-channel",
    content: "**Slot List (1/20)**\n#1 Team",
    embeds: [],
    components: [
      {
        components: [{ customId: "play:confirm:old-session" }],
      },
    ],
    edit: async (payload: any) => {
      editPayload = payload;
      message.components = payload.components;
      return message;
    },
    delete: async () => {
      deleted = true;
    },
  };
  message.channel = {
    messages: {
      fetch: async () => message,
    },
  };
  service.resolveDiscordChannel = async () => ({
    session: { id: "session-1", type: "SCRIM" },
    channelKind: "slot-list",
    config: createSessionDiscordConfig({
      emojis: {
        managedSlotListMessageId: "old-managed-message",
        playControlMode: "buttons",
      },
    }),
  });

  const handled = await service.cleanupStaleManagedBotMessage(message);

  assert.equal(handled, true);
  assert.equal(deleted, false);
  assert.deepEqual(editPayload, { components: [] });
});

test("scheduled auto cleanup accepts a missed-minute catch-up window", () => {
  const service = new DiscordSessionService(createApi({}) as any) as any;

  assert.equal(
    service.autoCleanupScheduleDue({ time: "12:34" } as any, {
      hour: 12,
      minute: 37,
    }),
    true,
  );
  assert.equal(
    service.autoCleanupScheduleDue({ time: "12:34" } as any, {
      hour: 12,
      minute: 59,
    }),
    true,
  );
  assert.equal(
    service.autoCleanupScheduleDue({ time: "12:34" } as any, {
      hour: 13,
      minute: 5,
    }),
    false,
  );
});

test("scheduled auto cleanup skips stale startup catch-up", async () => {
  const deletedIds: string[] = [];
  const logMessages: any[] = [];
  let fetchCount = 0;
  const targetChannel = {
    id: "registration-channel",
    isTextBased: () => true,
    isDMBased: () => false,
    messages: {
      fetch: async () => {
        fetchCount += 1;
        const message = {
          id: "delete-1",
          pinned: false,
          embeds: [],
          createdTimestamp: Date.now(),
          delete: async () => {
            deletedIds.push("delete-1");
          },
        };
        return new Collection([[message.id, message]]) as any;
      },
    },
    bulkDelete: async (chunk: any[]) => {
      for (const message of chunk) {
        deletedIds.push(message.id);
      }
      return new Collection(chunk.map((message) => [message.id, message]));
    },
  };
  const logChannel = {
    id: "log-channel",
    isTextBased: () => true,
    isDMBased: () => false,
    send: async (payload: any) => {
      logMessages.push(payload);
    },
  };
  const guild = {
    id: "guild-1",
    channels: {
      fetch: async (channelId: string) =>
        channelId === "registration-channel"
          ? targetChannel
          : channelId === "log-channel"
            ? logChannel
            : null,
    },
  } as unknown as Guild;
  const config = createSessionDiscordConfig({
    guildId: "guild-1",
    registrationChannelId: "registration-channel",
    logChannelId: "log-channel",
    emojis: {
      autoCleanupTimeZone: "UTC",
      autoCleanupSchedules: JSON.stringify([
        {
          channel: "registration",
          enabled: true,
          time: "12:34",
          mode: "safe",
          limit: 50,
        },
      ]),
    },
  });
  const service = new DiscordSessionService(createApi({}) as any);
  (service as any).autoCleanupStartedAt = Date.UTC(2026, 4, 7, 12, 45, 0);

  await (service as any).runDueAutoCleanups(
    guild,
    createSessionResponse(),
    config,
    new Date(Date.UTC(2026, 4, 7, 12, 50, 0)),
  );

  assert.deepEqual(deletedIds, []);
  assert.equal(fetchCount, 0);
  assert.equal(logMessages.length, 0);
});

test("scheduled full session cleanup protects pinned and managed messages while stripping temporary roles", async () => {
  const setup = createScrimDiscordSetup();
  const deletedIds: string[] = [];
  const roleRemovals: Array<{ memberId: string; roleIds: string[] }> = [];
  const logMessages: any[] = [];
  const channels = new Map<string, any>();

  const makeChannel = (channelId: string) => {
    let channel: any;
    const createMessage = (
      id: string,
      overrides: Record<string, unknown> = {},
    ) =>
      ({
        id,
        pinned: false,
        embeds: [],
        createdTimestamp: Date.now(),
        channel,
        delete: async () => {
          deletedIds.push(id);
        },
        ...overrides,
      }) as any;
    const messages = [
      createMessage(`delete-${channelId}`),
      createMessage(`pinned-${channelId}`, { pinned: true }),
      createMessage(`managed-${channelId}`, {
        embeds: [{ footer: { text: "arenzyra:session-1:managed" } }],
      }),
    ];
    channel = {
      id: channelId,
      isTextBased: () => true,
      isDMBased: () => false,
      messages: {
        fetch: async () =>
          new Collection(messages.map((message) => [message.id, message])),
      },
      bulkDelete: async (chunk: any[]) => {
        const deleted = new Collection<string, any>();
        for (const message of chunk) {
          deletedIds.push(message.id);
          deleted.set(message.id, message);
        }
        return deleted;
      },
      send: async (payload: any) => {
        logMessages.push(payload);
      },
    };
    for (const message of messages) {
      message.channel = channel;
    }
    channels.set(channelId, channel);
  };

  for (const channelId of [
    setup.registrationChannelId,
    setup.slotListChannelId,
    setup.waitlistChannelId,
    setup.idpChannelId,
    setup.managerChannelId,
    setup.manageChannelId,
    setup.resultsChannelId,
    setup.screenshotsChannelId,
    setup.bansChannelId,
    setup.logChannelId,
    "123456789012345678",
  ]) {
    makeChannel(channelId);
  }

  const makeMember = (memberId: string, roles: string[]) =>
    ({
      id: memberId,
      roles: {
        cache: {
          has: (roleId: string) => roles.includes(roleId),
        },
        remove: async (roleIds: string[]) => {
          roleRemovals.push({ memberId, roleIds });
        },
        add: async () => undefined,
      },
    }) as any;

  const slotMember = makeMember("member-slot", [
    setup.slotRoleId,
    setup.bannedRoleId,
  ]);
  const waitlistMember = makeMember("member-waitlist", [
    setup.waitlistRoleId,
    setup.idpRoleId,
  ]);
  const members = new Collection<string, any>([
    [slotMember.id, slotMember],
    [waitlistMember.id, waitlistMember],
  ]);
  const roleMembers = new Map<string, Collection<string, any>>([
    [setup.slotRoleId, new Collection([[slotMember.id, slotMember]])],
    [
      setup.waitlistRoleId,
      new Collection([[waitlistMember.id, waitlistMember]]),
    ],
    [setup.idpRoleId, new Collection([[waitlistMember.id, waitlistMember]])],
    [setup.bannedRoleId, new Collection([[slotMember.id, slotMember]])],
  ]);

  const guild = {
    id: "guild-1",
    channels: {
      fetch: async (channelId: string) => channels.get(channelId) ?? null,
    },
    members: {
      fetch: async (memberId?: string) =>
        memberId ? (members.get(memberId) ?? null) : members,
    },
    roles: {
      fetch: async (roleId: string) => ({
        id: roleId,
        members: roleMembers.get(roleId) ?? new Collection(),
      }),
    },
  } as unknown as Guild;
  const config = createSessionDiscordConfig({
    guildId: "guild-1",
    ...setup,
    emojis: {
      autoCleanupTimeZone: "UTC",
      autoCleanupSchedules: JSON.stringify([
        {
          channel: "session",
          enabled: true,
          time: "12:34",
          mode: "all",
          limit: 1000,
        },
      ]),
      discordLogoChannelIds: "123456789012345678",
    },
  });
  const api = createApi({
    listRegistrations: async () => [],
  });
  const service = new DiscordSessionService(api as any);
  const session = createSessionResponse();

  await (service as any).runDueAutoCleanups(
    guild,
    session,
    config,
    new Date(Date.UTC(2026, 4, 7, 12, 34, 10)),
  );

  assert.ok(deletedIds.includes("delete-registration-channel"));
  assert.ok(deletedIds.includes("delete-manage-channel"));
  assert.ok(deletedIds.includes("delete-log-channel"));
  assert.ok(!deletedIds.includes("delete-123456789012345678"));
  assert.ok(!deletedIds.some((id) => id.startsWith("pinned-")));
  assert.ok(!deletedIds.some((id) => id.startsWith("managed-")));
  assert.deepEqual(roleRemovals, [
    {
      memberId: "member-slot",
      roleIds: [setup.slotRoleId, setup.bannedRoleId],
    },
    {
      memberId: "member-waitlist",
      roleIds: [setup.waitlistRoleId, setup.idpRoleId],
    },
  ]);
  assert.equal(logMessages.length, 1);
  assert.match(logMessages[0].content, /Scheduled full channel cleanup/);
  assert.match(logMessages[0].content, /Roles Removed: 4/);
});

test("scheduled assigned slot cleanup removes slot registrations and keeps waitlist", async () => {
  const logMessages: any[] = [];
  const calls: string[] = [];
  const removedRegistrations = [
    createSessionRegistration({
      id: "registration-slot-3",
      teamId: "team-3",
      slotNumber: 3,
      waitlistPosition: null,
    }),
    createSessionRegistration({
      id: "registration-slot-4",
      teamId: "team-4",
      slotNumber: 4,
      waitlistPosition: null,
    }),
  ];
  const logChannel = {
    id: "log-channel",
    isTextBased: () => true,
    isDMBased: () => false,
    send: async (payload: any) => {
      logMessages.push(payload);
    },
  };
  const guild = {
    id: "guild-1",
    channels: {
      fetch: async (channelId: string) =>
        channelId === "log-channel" ? logChannel : null,
    },
  } as unknown as Guild;
  const config = createSessionDiscordConfig({
    guildId: "guild-1",
    logChannelId: "log-channel",
    emojis: {
      autoCleanupTimeZone: "UTC",
      autoCleanupSchedules: JSON.stringify([
        {
          channel: "slotData",
          enabled: true,
          time: "12:34",
          mode: "safe",
          limit: 1000,
        },
      ]),
    },
  });
  const api = createApi({
    removeSlotRegistrations: async (_sessionId: string, payload: any) => {
      calls.push(`removeSlotRegistrations:${payload?.removalReason}`);
      return {
        removedRegistrations,
        removedTeamIds: ["team-3", "team-4"],
        removedSlots: [3, 4],
      };
    },
  });
  const service = new DiscordSessionService(api as any);
  (service as any).syncDiscordScrimStateInBackground = () => {
    calls.push("syncDiscordScrimStateInBackground");
  };
  (service as any).cleanScrimRolesInBackground = () => {
    calls.push("cleanScrimRolesInBackground");
  };

  await (service as any).runDueAutoCleanups(
    guild,
    createSessionResponse(),
    config,
    new Date(Date.UTC(2026, 4, 7, 12, 34, 10)),
  );

  assert.deepEqual(calls, [
    "removeSlotRegistrations:Scheduled assigned slot cleanup",
    "syncDiscordScrimStateInBackground",
    "cleanScrimRolesInBackground",
  ]);
  assert.equal(logMessages.length, 1);
  assert.match(logMessages[0].content, /Scheduled assigned slot cleanup/);
  assert.match(logMessages[0].content, /Removed: 2/);
  assert.match(logMessages[0].content, /Slots: #3, #4/);
  assert.match(logMessages[0].content, /Waitlist entries were kept/);
});

test("scheduled all registered teams cleanup removes slots and waitlist registrations", async () => {
  const logMessages: any[] = [];
  const calls: string[] = [];
  const slotRegistration = createSessionRegistration({
    id: "registration-slot",
    teamId: "team-slot",
    slotNumber: 3,
    waitlistPosition: null,
  });
  const waitlistRegistration = createSessionRegistration({
    id: "registration-waitlist",
    teamId: "team-waitlist",
    status: "WAITLIST",
    slotNumber: null,
    waitlistPosition: 1,
  });
  const registrations = [slotRegistration, waitlistRegistration];
  const logChannel = {
    id: "log-channel",
    isTextBased: () => true,
    isDMBased: () => false,
    send: async (payload: any) => {
      logMessages.push(payload);
    },
  };
  const guild = {
    id: "guild-1",
    channels: {
      fetch: async (channelId: string) =>
        channelId === "log-channel" ? logChannel : null,
    },
  } as unknown as Guild;
  const config = createSessionDiscordConfig({
    guildId: "guild-1",
    logChannelId: "log-channel",
    emojis: {
      autoCleanupTimeZone: "UTC",
      autoCleanupSchedules: JSON.stringify([
        {
          channel: "registrations",
          enabled: true,
          time: "12:34",
          mode: "safe",
          limit: 1000,
        },
      ]),
    },
  });
  const api = createApi({
    listRegistrations: async () => registrations,
    removeRegistration: async (
      _sessionId: string,
      registrationId: string,
      payload: any,
    ) => {
      calls.push(`${registrationId}:${payload?.removalReason}`);
      const removedRegistration = registrations.find(
        (registration) => registration.id === registrationId,
      );
      assert.ok(removedRegistration);
      return {
        removedRegistration,
        promotedRegistration: null,
      };
    },
    resetSessionResults: async (_sessionId: string, payload: any) => {
      calls.push(`resetSessionResults:${payload?.reason}`);
      return {
        sessionId: "session-1",
        organizationId: "org-1",
        matchesRemoved: 3,
        matchIds: ["match-1", "match-2", "match-3"],
        reason: payload?.reason ?? null,
        resetAt: new Date().toISOString(),
      };
    },
  });
  const service = new DiscordSessionService(api as any);
  (service as any).syncDiscordScrimStateInBackground = () => {
    calls.push("syncDiscordScrimStateInBackground");
  };
  (service as any).cleanScrimRolesInBackground = () => {
    calls.push("cleanScrimRolesInBackground");
  };

  await (service as any).runDueAutoCleanups(
    guild,
    createSessionResponse(),
    config,
    new Date(Date.UTC(2026, 4, 7, 12, 34, 10)),
  );

  assert.deepEqual(calls, [
    "registration-slot:Scheduled registered team cleanup",
    "registration-waitlist:Scheduled registered team cleanup",
    "resetSessionResults:Scheduled registered team cleanup",
    "syncDiscordScrimStateInBackground",
    "cleanScrimRolesInBackground",
  ]);
  assert.equal(logMessages.length, 1);
  assert.match(logMessages[0].content, /Scheduled registered team cleanup/);
  assert.match(logMessages[0].content, /Selected: 2/);
  assert.match(logMessages[0].content, /Removed: 2/);
  assert.match(logMessages[0].content, /Slots: #3/);
  assert.match(logMessages[0].content, /Waitlist: #1/);
  assert.match(
    logMessages[0].content,
    /Result system reset: 3 matches removed/,
  );
});

test("no-show team ban command creates session bans for no-show teams", async () => {
  const calls: any[] = [];
  const config = createSessionDiscordConfig({
    guildId: "guild-1",
    emojis: { ban: "BAN" },
  });
  const api = createApi({
    getSessionDiscordConfig: async () => config,
    createNoShowTeamBans: async (payload: any) => {
      calls.push(payload);
      return {
        session: { id: "session-1", name: "Daily Scrim", status: "OPEN" },
        match: {
          id: "match-1",
          name: "Game 1",
          matchNumber: 1,
          status: "FINISHED",
        },
        scope: "SESSION",
        reason: payload.reason,
        expiresAt: payload.expiresAt,
        teams: [
          {
            teamId: "team-1",
            slotNumber: 7,
            team: { id: "team-1", name: "No Show One", tag: "NS1" },
            alreadyBanned: false,
          },
          {
            teamId: "team-2",
            slotNumber: 8,
            team: { id: "team-2", name: "No Show Two", tag: "NS2" },
            alreadyBanned: false,
          },
        ],
        noShowCount: 2,
        alreadyBannedCount: 0,
        creatableCount: 2,
        createdCount: 2,
        createdBans: [
          {
            id: "ban-1",
            organizationId: "org-1",
            teamId: "team-1",
            scope: "SESSION",
            sessionId: "session-1",
            matchId: null,
            reason: payload.reason,
            note: null,
            expiresAt: payload.expiresAt,
            revokedAt: null,
            revokeReason: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            active: true,
            team: { id: "team-1", name: "No Show One", tag: "NS1" },
          },
          {
            id: "ban-2",
            organizationId: "org-1",
            teamId: "team-2",
            scope: "SESSION",
            sessionId: "session-1",
            matchId: null,
            reason: payload.reason,
            note: null,
            expiresAt: payload.expiresAt,
            revokedAt: null,
            revokeReason: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            active: true,
            team: { id: "team-2", name: "No Show Two", tag: "NS2" },
          },
        ],
      };
    },
  });
  const service = new DiscordSessionService(api as any);

  const result = await service.createNoShowTeamBansFromDiscord({
    sessionId: "session-1",
    matchNumber: 1,
    scope: "SESSION",
    days: 3,
    reason: "Manual no-show",
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].sessionId, "session-1");
  assert.equal(calls[0].matchNumber, 1);
  assert.equal(calls[0].scope, "SESSION");
  assert.equal(calls[0].reason, "Manual no-show");
  assert.match(calls[0].expiresAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.match(result, /No-show bans completed/);
  assert.match(result, /Created: 2/);
  assert.match(result, /#7 No Show One \(NS1\)/);
});

test("no-show team ban applies configured ban role and refreshes bans channel list", async () => {
  const roleAdds: Array<{ userId: string; roleId: string; reason: string }> =
    [];
  const sentMessages: any[] = [];
  const updatedConfigs: any[] = [];
  const bannedRole = { id: "banned-role", name: "Banned" };
  const config = createSessionDiscordConfig({
    guildId: "guild-1",
    bansChannelId: "bans-channel",
    logChannelId: null,
    bannedRoleId: "banned-role",
    emojis: {
      ban: "BAN",
      banServerAction: "ROLE",
      banRoleIds: "banned-role",
      noShowBanRules: JSON.stringify([
        { enabled: true, misses: 1, durationDays: 10 },
      ]),
    },
  });
  const teamBan = {
    id: "ban-1",
    organizationId: "org-1",
    teamId: "team-1",
    scope: "SESSION" as const,
    sessionId: "session-1",
    matchId: null,
    reason: "Manual no-show",
    note: null,
    expiresAt: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(),
    revokedAt: null,
    revokeReason: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    active: true,
    team: { id: "team-1", name: "No Show One", tag: "NS1" },
    session: { id: "session-1", name: "Daily Scrim", status: "OPEN" },
    match: null,
  };
  const api = createApi({
    getSessionDiscordConfig: async () => config,
    createNoShowTeamBans: async (payload: any) => ({
      session: { id: "session-1", name: "Daily Scrim", status: "OPEN" },
      match: {
        id: "match-1",
        name: "Game 1",
        matchNumber: 1,
        status: "FINISHED",
      },
      scope: "SESSION",
      reason: payload.reason,
      expiresAt: payload.expiresAt,
      teams: [
        {
          teamId: "team-1",
          slotNumber: 7,
          team: { id: "team-1", name: "No Show One", tag: "NS1" },
          managers: [
            {
              discordUserId: "leader-1",
              discordUsername: "leader",
              displayName: "Leader",
            },
          ],
          alreadyBanned: false,
        },
      ],
      noShowCount: 1,
      alreadyBannedCount: 0,
      creatableCount: 1,
      createdCount: 1,
      createdManagerBans: 1,
      createdBans: [teamBan],
    }),
    listTeamBans: async () => [teamBan],
    listManagerBans: async () => [],
    listSessionMatches: async () => [],
    listTeamMembers: async () => [
      createTeamMember({
        discordUserId: "leader-1",
        discordUsername: "leader",
        displayName: "Leader",
      }),
    ],
    updateSessionDiscordConfig: async (_sessionId: string, payload: any) => {
      updatedConfigs.push(payload);
      return createSessionDiscordConfig({
        ...config,
        emojis: { ...config.emojis, ...(payload.emojis ?? {}) },
      });
    },
  });
  const bansChannel = {
    id: "bans-channel",
    isTextBased: () => true,
    isDMBased: () => false,
    messages: {
      fetch: async () => null,
    },
    send: async (payload: any) => {
      sentMessages.push(payload);
      return { id: `message-${sentMessages.length}` };
    },
  };
  const guild = {
    id: "guild-1",
    client: { user: { id: "bot-1" } },
    roles: {
      cache: {
        get: (roleId: string) =>
          roleId === bannedRole.id ? bannedRole : undefined,
        find: () => undefined,
      },
    },
    members: {
      fetch: async (userId: string) => ({
        roles: {
          add: async (role: typeof bannedRole, reason: string) => {
            roleAdds.push({ userId, roleId: role.id, reason });
          },
        },
      }),
    },
    channels: {
      fetch: async (channelId: string) =>
        channelId === "bans-channel" ? bansChannel : null,
    },
  } as unknown as Guild;

  const service = new DiscordSessionService(api as any);
  (service as any).syncDiscordScrimStateInBackground = () => undefined;
  (service as any).cleanScrimRolesInBackground = () => undefined;

  const result = await service.createNoShowTeamBansFromDiscord(
    {
      sessionId: "session-1",
      matchNumber: 1,
      scope: "SESSION",
      days: 10,
      reason: "Manual no-show",
    },
    guild,
  );

  assert.deepEqual(roleAdds, [
    { userId: "leader-1", roleId: "banned-role", reason: "Manual no-show" },
  ]);
  assert.match(sentMessages[0].content, /1 total miss => 10 days \(SESSION\)/);
  assert.match(sentMessages[0].content, /No Show One/);
  assert.match(sentMessages[0].content, /10 days left/);
  assert.ok(updatedConfigs[0].emojis.managedBanListMessageIds);
  assert.match(result, /banned role\(s\) applied to 1\/1 linked member/);
});

test("final auto no-show bans fetch configured ban role when Discord role cache is cold", async () => {
  const roleAdds: Array<{ userId: string; roleId: string; reason: string }> =
    [];
  const bannedRole = { id: "banned-role", name: "Banned" };
  const config = createSessionDiscordConfig({
    guildId: "guild-1",
    bannedRoleId: "banned-role",
    bannedRoleName: "Banned",
    emojis: {
      ban: "BAN",
      banServerAction: "ROLE",
      banRoleIds: "banned-role",
    },
  });
  const api = createApi({
    applyNoShowAutoBansForMatch: async () => ({
      ok: true,
      matchId: "match-1",
      candidateTeamCount: 1,
      rulesConfigured: 1,
      createdTeamBans: 1,
      createdManagerBans: 1,
      createdTeamIds: ["team-1"],
      createdManagerDiscordUserIds: [],
      createdBans: [
        {
          teamId: "team-1",
          teamName: "No Show One",
          teamTag: "NS1",
          scope: "SESSION" as const,
          reason: "Missed 1 match",
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          durationDays: 1,
          missedMatches: ["G1"],
          managerDiscordUserIds: ["leader-1"],
        },
      ],
      skippedAlreadyBanned: 0,
      skippedProtected: 0,
      skippedNoRule: 0,
    }),
  });
  const guild = {
    id: "guild-1",
    roles: {
      cache: {
        get: () => undefined,
        find: () => undefined,
      },
      fetch: async (roleId?: string) =>
        roleId === bannedRole.id ? bannedRole : new Collection(),
    },
    members: {
      fetch: async (userId: string) => ({
        roles: {
          add: async (role: typeof bannedRole, reason: string) => {
            roleAdds.push({ userId, roleId: role.id, reason });
          },
        },
      }),
    },
  } as unknown as Guild;

  const service = new DiscordSessionService(api as any);
  (service as any).syncDiscordScrimStateInBackground = () => undefined;
  (service as any).cleanScrimRolesInBackground = () => undefined;

  const result = await service.applyFinalNoShowAutoBansFromDiscord(
    { matchId: "match-1", sessionId: "session-1" },
    guild,
    config,
  );

  assert.deepEqual(roleAdds, [
    {
      userId: "leader-1",
      roleId: "banned-role",
      reason: "Automatic no-show ban",
    },
  ]);
  assert.deepEqual(result.serverActionDetails, [
    "Server action: banned role(s) applied to 1/1 linked member(s): Banned.",
  ]);
});

test("expired ban role cleanup removes configured ban role when no active ban remains", async () => {
  const roleRemovals: Array<{
    userId: string;
    roleIds: string[];
    reason: string;
  }> = [];
  const bannedRole = { id: "banned-role", name: "Banned" };
  const expiredBan = {
    id: "manager-ban-1",
    organizationId: "org-1",
    discordUserId: "leader-1",
    discordUsername: "leader",
    displayName: "Leader",
    scope: "SESSION" as const,
    sessionId: "session-1",
    matchId: null,
    reason: "Missed match",
    note: null,
    expiresAt: new Date(Date.now() - 60_000).toISOString(),
    revokedAt: null,
    revokeReason: null,
    createdAt: new Date(Date.now() - 120_000).toISOString(),
    updatedAt: new Date(Date.now() - 60_000).toISOString(),
    active: false,
  };
  const api = createApi({
    listManagerBans: async (params: any) =>
      params.active === false ? [expiredBan] : [],
    listSessionMatches: async () => [],
  });
  const guild = {
    id: "guild-1",
    roles: {
      cache: {
        get: (roleId: string) =>
          roleId === bannedRole.id ? bannedRole : undefined,
        find: () => undefined,
      },
      fetch: async () => bannedRole,
    },
    members: {
      fetch: async (input: string | { user: string }) => {
        const userId = typeof input === "string" ? input : input.user;
        return {
          id: userId,
          roles: {
            cache: { has: (roleId: string) => roleId === bannedRole.id },
            remove: async (roleIds: string[], reason: string) => {
              roleRemovals.push({ userId, roleIds, reason });
            },
          },
        };
      },
    },
  } as unknown as Guild;
  const config = createSessionDiscordConfig({
    guildId: "guild-1",
    bannedRoleId: "banned-role",
    bannedRoleName: "Banned",
    emojis: { ban: "BAN", banRoleIds: "banned-role" },
  });
  const service = new DiscordSessionService(api as any);

  const result = await (service as any).cleanupExpiredBanRolesForSession(
    guild,
    createSessionResponse({ id: "session-1" }),
    config,
  );

  assert.equal(result.expiredManagerBans, 1);
  assert.equal(result.removedRoles, 1);
  assert.deepEqual(roleRemovals, [
    {
      userId: "leader-1",
      roleIds: ["banned-role"],
      reason: "Arenzyra expired ban role cleanup session-1",
    },
  ]);
});

test("expired ban role cleanup keeps role while another active ban still applies", async () => {
  let memberFetches = 0;
  const bannedRole = { id: "banned-role", name: "Banned" };
  const expiredBan = {
    id: "manager-ban-1",
    organizationId: "org-1",
    discordUserId: "leader-1",
    discordUsername: "leader",
    displayName: "Leader",
    scope: "SESSION" as const,
    sessionId: "session-1",
    matchId: null,
    reason: "Missed match",
    note: null,
    expiresAt: new Date(Date.now() - 60_000).toISOString(),
    revokedAt: null,
    revokeReason: null,
    createdAt: new Date(Date.now() - 120_000).toISOString(),
    updatedAt: new Date(Date.now() - 60_000).toISOString(),
    active: false,
  };
  const activeBan = {
    ...expiredBan,
    id: "manager-ban-2",
    scope: "TEAM" as const,
    sessionId: null,
    expiresAt: null,
    active: true,
  };
  const api = createApi({
    listManagerBans: async (params: any) =>
      params.active === false ? [expiredBan] : [activeBan],
    listSessionMatches: async () => [],
  });
  const guild = {
    id: "guild-1",
    roles: {
      cache: {
        get: (roleId: string) =>
          roleId === bannedRole.id ? bannedRole : undefined,
        find: () => undefined,
      },
      fetch: async () => bannedRole,
    },
    members: {
      fetch: async () => {
        memberFetches += 1;
        throw new Error("member should not be fetched when active ban remains");
      },
    },
  } as unknown as Guild;
  const config = createSessionDiscordConfig({
    guildId: "guild-1",
    bannedRoleId: "banned-role",
    bannedRoleName: "Banned",
    emojis: { ban: "BAN", banRoleIds: "banned-role" },
  });
  const service = new DiscordSessionService(api as any);

  const result = await (service as any).cleanupExpiredBanRolesForSession(
    guild,
    createSessionResponse({ id: "session-1" }),
    config,
  );

  assert.equal(result.expiredManagerBans, 1);
  assert.equal(result.keptActive, 1);
  assert.equal(result.removedRoles, 0);
  assert.equal(memberFetches, 0);
});

test("confirmation reminders switch from role mention to pending manager mentions", async () => {
  const sentMessages: any[] = [];
  const sentMessageRecords: any[] = [];
  const storedMessages = new Map<string, any>();
  let nextMessageId = 1;
  let registrations = [
    createSessionRegistration({
      id: "registration-1",
      teamId: "team-1",
      slotNumber: 3,
      team: {
        id: "team-1",
        name: "Team One",
        tag: "ONE",
        logoUrl: null,
        countryCode: null,
        region: null,
      },
    }),
    createSessionRegistration({
      id: "registration-2",
      teamId: "team-2",
      slotNumber: 4,
      team: {
        id: "team-2",
        name: "Team Two",
        tag: "TWO",
        logoUrl: null,
        countryCode: null,
        region: null,
      },
    }),
  ];
  const slotChannel = {
    id: "slot-list-channel",
    isTextBased: () => true,
    isDMBased: () => false,
    messages: {
      fetch: async (messageId: string) => storedMessages.get(messageId) ?? null,
    },
    send: async (payload: any) => {
      const message: any = {
        id: `message-${nextMessageId++}`,
        deleted: false,
        delete: async () => {
          message.deleted = true;
          storedMessages.delete(message.id);
          return message;
        },
      };
      storedMessages.set(message.id, message);
      sentMessageRecords.push(message);
      sentMessages.push(payload);
      return message;
    },
  };
  const guild = {
    id: "guild-1",
    channels: {
      fetch: async (channelId: string) =>
        channelId === "slot-list-channel" ? slotChannel : null,
    },
  } as unknown as Guild;
  let config = createSessionDiscordConfig({
    guildId: "guild-1",
    slotListChannelId: "slot-list-channel",
    slotRoleId: "123456789012345678",
    emojis: {
      playConfirmationOpensAt: "2026-05-07T12:00:00.000Z",
      playConfirmationClosesAt: "2026-05-07T13:00:00.000Z",
      playConfirmationReminderEnabled: "true",
      playConfirmationReminderOpenDelayMinutes: "0",
      playConfirmationReminderIntervalMinutes: "10",
      playConfirmationReminderMaxMessages: "2",
      playConfirmationReminderPendingMentionThreshold: "1",
      playConfirmationReminderRoleMessageText:
        "@everyone {role} confirm now {pendingCount}/{totalCount}",
      playConfirmationReminderManagerMessageText:
        "@here {managers} final pending {pendingTeams}",
    },
  });
  const updatedConfigs: any[] = [];
  const api = createApi({
    getSessionDiscordConfig: async () => config,
    listRegistrations: async () => registrations,
    listTeamMembers: async (teamId: string) => [
      createTeamMember({
        id: `member-${teamId}`,
        teamId,
        discordUserId:
          teamId === "team-1" ? "111111111111111111" : "222222222222222222",
        role: "LEADER",
      }),
    ],
    updateSessionDiscordConfig: async (_sessionId: string, payload: any) => {
      updatedConfigs.push(payload);
      config = createSessionDiscordConfig({
        ...config,
        emojis: { ...config.emojis, ...(payload.emojis ?? {}) },
      });
      return config;
    },
  });
  const service = new DiscordSessionService(api as any);

  await (service as any).runDueConfirmationReminders(
    guild,
    createSessionResponse(),
    config,
    new Date("2026-05-07T12:00:15.000Z"),
  );
  await (service as any).runDueConfirmationReminders(
    guild,
    createSessionResponse(),
    config,
    new Date("2026-05-07T12:00:30.000Z"),
  );

  assert.equal(sentMessages.length, 1);
  assert.match(
    sentMessages[0].content,
    /<@&123456789012345678> confirm now 2\/2/,
  );
  assert.deepEqual(sentMessages[0].allowedMentions.roles, [
    "123456789012345678",
  ]);
  assert.deepEqual(sentMessages[0].allowedMentions.users ?? [], []);
  assert.deepEqual(sentMessages[0].allowedMentions.parse, ["everyone"]);

  registrations = [
    {
      ...registrations[0],
      note: 'ARENZYRA_PLAY_STATUS:{"status":"CONFIRM","discordUserId":"111111111111111111"}',
    },
    registrations[1],
  ];

  const restartedService = new DiscordSessionService(api as any);
  await (restartedService as any).runDueConfirmationReminders(
    guild,
    createSessionResponse(),
    config,
    new Date("2026-05-07T12:11:00.000Z"),
  );

  assert.equal(sentMessages.length, 2);
  assert.match(
    sentMessages[1].content,
    /<@222222222222222222> final pending #4 \[TWO\]/,
  );
  assert.deepEqual(sentMessages[1].allowedMentions.roles ?? [], []);
  assert.deepEqual(sentMessages[1].allowedMentions.users, [
    "222222222222222222",
  ]);
  assert.deepEqual(sentMessages[1].allowedMentions.parse, ["everyone"]);
  assert.equal(sentMessageRecords[0].deleted, true);
  assert.equal(sentMessageRecords[1].deleted, false);
  assert.equal(
    updatedConfigs[0].emojis.managedConfirmationReminderMessageId,
    "message-1",
  );
  assert.equal(
    updatedConfigs[1].emojis.managedConfirmationReminderMessageId,
    "message-2",
  );
  assert.ok(updatedConfigs[1].emojis.managedConfirmationReminderWindowKey);
});

test("production channel help pin refreshes existing managed pin", async () => {
  const service = new DiscordSessionService({} as any);
  const messages = new Collection<string, any>();
  const pins = new Collection<string, any>();
  let nextId = 1;

  const createMessage = (content: string, pinned = false) => {
    const message: any = {
      id: `message-${nextId++}`,
      content,
      pinned,
      author: { id: "bot-1" },
      edit: async (payload: { content: string }) => {
        message.content = payload.content;
        return message;
      },
      pin: async () => {
        message.pinned = true;
        pins.set(message.id, message);
        return message;
      },
      unpin: async () => {
        message.pinned = false;
        pins.delete(message.id);
        return message;
      },
    };
    messages.set(message.id, message);
    if (pinned) pins.set(message.id, message);
    return message;
  };

  const existing = createMessage(
    "Old help\n[ARENZYRA_PRODUCTION_HELP:production-1:logos]",
    true,
  );
  const channel: any = {
    client: { user: { id: "bot-1" } },
    messages: {
      fetchPinned: async () => pins,
      fetch: async () => messages,
    },
    send: async (payload: { content: string }) =>
      createMessage(payload.content, false),
  };
  const set = {
    key: "production-1",
    index: 1,
    setName: "set-1",
    eventId: "event-1",
    eventName: "Pro League",
  };

  await (service as any).ensureProductionChannelHelpPin({
    channel,
    kind: "logos",
    set,
    productionRoleId: "role-1",
  });
  await (service as any).ensureProductionChannelHelpPin({
    channel,
    kind: "logos",
    set,
    productionRoleId: "role-1",
  });

  assert.equal(messages.size, 1);
  assert.equal(existing.pinned, true);
  assert.match(existing.content, /Arenzyra Production - Logos/);
  assert.match(existing.content, /%logo Team Name \| TAG/);
  assert.match(
    existing.content,
    /\[ARENZYRA_PRODUCTION_HELP:production-1:logos\]/,
  );
});
