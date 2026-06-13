import assert from "node:assert/strict";
import test from "node:test";
import { Collection } from "discord.js";
import { MessageRegistrationService } from "./message-registration.service";

test("unknown Arenzyra session topic is ignored without reject reaction", async () => {
  const reactions: string[] = [];
  const replies: string[] = [];
  let registrationLookupCalled = false;
  const message = {
    author: {
      id: "manager-1",
      username: "manager",
      globalName: "Manager",
      bot: false,
      tag: "manager",
    },
    content: "%register\nUnknown Session Team\nUNK\n<@manager-1>",
    guild: { id: "guild-1" },
    channel: {
      id: "registration-channel",
      topic:
        "arenzyra-session=281002fb-3fd4-4fd0-97f7-ee447cacbe08;kind=registration",
    },
    mentions: {
      users: new Map(),
      channels: { first: () => null },
    },
    attachments: { find: () => undefined },
    react: async (emoji: string) => {
      reactions.push(emoji);
    },
    reply: async (payload: string | { content?: string }) => {
      replies.push(
        typeof payload === "string" ? payload : (payload.content ?? ""),
      );
    },
  };
  const sessionService = {
    findScrimForDiscordChannel: async () => null,
    findScrimForWaitlistChannel: async () => null,
    findScrimForRegistrationChannel: async () => {
      registrationLookupCalled = true;
      return null;
    },
  };

  const service = new MessageRegistrationService(sessionService as any);
  const handled = await service.handleMessage(message as any);

  assert.equal(handled, true);
  assert.equal(registrationLookupCalled, false);
  assert.deepEqual(reactions, []);
  assert.deepEqual(replies, []);
});

test("free slot query replies with aggregate counts by default", async () => {
  const sent: string[] = [];
  const message = {
    author: { id: "user-1", bot: false, tag: "user" },
    content: "any free slots today?",
    guild: { id: "guild-1" },
    channel: {
      id: "session-chat",
      send: async (payload: { content?: string }) => {
        sent.push(payload.content ?? "");
        return { delete: async () => undefined };
      },
    },
  };
  const sessionService = {
    findScrimForDiscordChannel: async () => ({
      session: { id: "session-1", name: "Scrim 1" },
      config: {
        organizationId: "org-1",
        emojis: {},
      },
      channelKind: "manager",
    }),
    freeSlotStatusMessage: async () =>
      "SLOT Free slots: 4\nVIP Free VIP slots: 1",
  };

  const service = new MessageRegistrationService(sessionService as any);
  const handled = await service.handleMessage(message as any);

  assert.equal(handled, true);
  assert.deepEqual(sent, ["SLOT Free slots: 4\nVIP Free VIP slots: 1"]);
  assert(!sent[0].includes("#"));
  assert(!/waitlist/i.test(sent[0]));
});

test("slot status command toggles the per-session free slot replies", async () => {
  const sent: string[] = [];
  let updated: { sessionId: string; enabled: boolean } | null = null;
  let deleted = false;
  const message = {
    author: { id: "staff-1", bot: false, tag: "staff" },
    content: "%slot status on",
    guild: { id: "guild-1" },
    channel: {
      id: "session-chat",
      send: async (payload: { content?: string }) => {
        sent.push(payload.content ?? "");
        return { delete: async () => undefined };
      },
    },
    member: {
      permissions: { has: () => true },
      roles: { cache: { has: () => false, some: () => false } },
    },
    delete: async () => {
      deleted = true;
    },
  };
  const sessionService = {
    findScrimForDiscordChannel: async () => ({
      session: { id: "session-1", name: "Scrim 1" },
      config: { organizationId: "org-1", manageRoleIds: [], emojis: {} },
      channelKind: "manager",
    }),
    setSlotStatusResponseEnabled: async (
      sessionId: string,
      enabled: boolean,
    ) => {
      updated = { sessionId, enabled };
      return { emojis: { check: "CHECK" } };
    },
  };

  const service = new MessageRegistrationService(sessionService as any);
  const handled = await service.handleMessage(message as any);

  assert.equal(handled, true);
  assert.equal(deleted, true);
  assert.deepEqual(updated, { sessionId: "session-1", enabled: true });
  assert.deepEqual(sent, [
    "\u2705 Free-slot status replies are now on for Scrim 1.",
  ]);
});

test("idp dm command toggles forwarding for the synced idp channel", async () => {
  const sent: string[] = [];
  let updated: { sessionId: string; enabled: boolean } | null = null;
  const config = {
    sessionId: "00000000-0000-4000-8000-000000000001",
    organizationId: "org-1",
    guildId: "guild-1",
    manageRoleIds: [],
    emojis: {},
  };
  const message = {
    id: "123456789012345678",
    author: { id: "staff-1", bot: false, tag: "staff#0001" },
    content: "%dm on",
    guild: { id: "guild-1" },
    channel: {
      id: "idp-channel",
      send: async (payload: { content?: string }) => {
        sent.push(payload.content ?? "");
        return { delete: async () => undefined };
      },
    },
    member: {
      permissions: { has: () => true },
      roles: { cache: { has: () => false, some: () => false } },
    },
  };
  const sessionService = {
    findScrimForDiscordChannel: async () => ({
      session: {
        id: "00000000-0000-4000-8000-000000000001",
        name: "Scrim 1",
      },
      config,
      channelKind: "idp",
    }),
    setIdpDmForwardingEnabled: async (
      sessionId: string,
      enabled: boolean,
    ) => {
      updated = { sessionId, enabled };
      return {
        ...config,
        emojis: { idpDmForwardingEnabled: enabled ? "true" : "false" },
      };
    },
  };

  const service = new MessageRegistrationService(sessionService as any);
  const handled = await service.handleMessage(message as any);

  assert.equal(handled, true);
  assert.deepEqual(updated, {
    sessionId: "00000000-0000-4000-8000-000000000001",
    enabled: true,
  });
  assert.match(sent[0], /IDP DM forwarding is now on for Scrim 1/);
});

test("idp staff message forwards to registered slot managers with reply button", async () => {
  const dmPayloads: any[] = [];
  let logPayload: any = null;
  const managerId = "111111111111111111";
  const config = {
    sessionId: "00000000-0000-4000-8000-000000000001",
    organizationId: "org-1",
    guildId: "guild-1",
    logChannelId: "log-channel",
    manageRoleIds: [],
    emojis: { idpDmForwardingEnabled: "true" },
  };
  const message = {
    id: "123456789012345678",
    author: { id: "staff-1", bot: false, tag: "staff#0001" },
    content: "Room ID: 123\nPass: abc",
    guild: { id: "guild-1" },
    channel: { id: "idp-channel" },
    member: {
      permissions: { has: () => true },
      roles: { cache: { has: () => false, some: () => false } },
    },
    attachments: new Collection(),
    embeds: [],
    client: {
      users: {
        fetch: async (userId: string) => ({
          id: userId,
          send: async (payload: any) => {
            dmPayloads.push(payload);
          },
        }),
      },
    },
  };
  const sessionService = {
    findScrimForDiscordChannel: async () => ({
      session: {
        id: "00000000-0000-4000-8000-000000000001",
        name: "Scrim 1",
      },
      config,
      channelKind: "idp",
    }),
    listRegisteredSlotManagerDiscordIds: async () => [managerId],
    sendDiscordActionLog: async (_guild: any, _config: any, payload: any) => {
      logPayload = payload;
    },
  };

  const service = new MessageRegistrationService(sessionService as any);
  const handled = await service.handleMessage(message as any);

  assert.equal(handled, true);
  assert.equal(dmPayloads.length, 1);
  assert.match(dmPayloads[0].content, /IDP update: Scrim 1/);
  assert.match(dmPayloads[0].content, /Room ID: 123/);
  assert.equal(dmPayloads[0].allowedMentions.parse.length, 0);
  const button = dmPayloads[0].components[0].toJSON().components[0];
  assert.equal(button.label, "Reply");
  assert.match(
    button.custom_id,
    new RegExp(`^idpdm:reply:.*:123456789012345678:${managerId}$`),
  );
  assert.equal(logPayload.status, "1/1 delivered");
});

test("idp dm reply modal sends only manager identity and text to manager channel", async () => {
  let managerMessage: any = null;
  let replyPayload: any = null;
  const managerId = "111111111111111111";
  const sessionId = "00000000-0000-4000-8000-000000000001";
  const sourceMessageId = "123456789012345678";
  const service = new MessageRegistrationService({
    getSessionDiscordContext: async () => ({
      session: { id: sessionId, name: "Scrim 1" },
      config: {
        sessionId,
        guildId: "guild-1",
        managerChannelId: "manager-channel",
        emojis: {},
      },
    }),
  } as any);

  const handled = await service.handleModalSubmit({
    customId: `idpdm:modal:${sessionId}:${sourceMessageId}:${managerId}`,
    user: {
      id: managerId,
      username: "manager",
      globalName: "Manager Name",
    },
    fields: {
      getTextInputValue: () => "Need 5 minutes extra.",
    },
    client: {
      guilds: {
        fetch: async () => ({
          channels: {
            fetch: async () => ({
              isTextBased: () => true,
              send: async (payload: any) => {
                managerMessage = payload;
              },
            }),
          },
          members: {
            fetch: async () => ({ displayName: "Manager Display" }),
          },
        }),
      },
    },
    reply: async (payload: any) => {
      replyPayload = payload;
    },
  } as any);

  assert.equal(handled, true);
  assert.match(managerMessage.content, /\*\*IDP reply\*\*/);
  assert.match(managerMessage.content, new RegExp(`<@${managerId}>`));
  assert.match(managerMessage.content, /Manager Display/);
  assert.match(managerMessage.content, /Need 5 minutes extra/);
  assert.doesNotMatch(managerMessage.content, /team/i);
  assert.deepEqual(managerMessage.allowedMentions.users, [managerId]);
  assert.equal(replyPayload.ephemeral, true);
});

test("rejected VIP registration logs original message proof", async () => {
  const replies: string[] = [];
  const logs: any[] = [];
  const message = {
    id: "message-1",
    url: "https://discord.test/channels/guild-1/registration-channel/message-1",
    author: {
      id: "manager-1",
      username: "manager",
      globalName: "Manager",
      bot: false,
      tag: "manager#0001",
    },
    content: "%register\nvip\nTeam Alpha\nALP",
    guild: { id: "guild-1" },
    client: { user: { id: "bot-1" } },
    channel: {
      id: "registration-channel",
      topic: "arenzyra-session=session-1;kind=registration",
    },
    member: {
      permissions: { has: () => false },
      roles: { cache: { has: () => false, some: () => false } },
    },
    mentions: {
      users: new Collection(),
      channels: { first: () => null },
    },
    attachments: new Collection([
      [
        "attachment-1",
        {
          id: "attachment-1",
          name: "logo.png",
          url: "https://cdn.discord.test/logo.png",
        },
      ],
    ]),
    reactions: {
      resolve: () => null,
      cache: { find: () => undefined },
    },
    react: async () => undefined,
    reply: async (payload: string | { content?: string }) => {
      replies.push(
        typeof payload === "string" ? payload : (payload.content ?? ""),
      );
      return { delete: async () => undefined };
    },
  };
  const sessionService = {
    findScrimForDiscordChannel: async () => null,
    findScrimForRegistrationChannel: async () => ({
      session: { id: "session-1", name: "Scrim 1" },
      config: {
        sessionId: "session-1",
        organizationId: "org-1",
        registrationMode: "SCRIM",
        logChannelId: "log-channel",
        manageRoleIds: [],
        emojis: {},
      },
      accepting: true,
    }),
    userHasVipRegistrationAccess: async () => false,
    userHasCustomRoleRegistrationAccess: async () => false,
    sendDiscordActionLog: async (
      _guild: unknown,
      _config: unknown,
      log: any,
    ) => {
      logs.push(log);
    },
  };

  const service = new MessageRegistrationService(sessionService as any);
  const handled = await service.handleMessage(message as any);

  assert.equal(handled, true);
  assert.match(replies[0], /VIP registration is closed/);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].action, "Registration rejected");
  assert.equal(logs[0].status, "vip denied");
  assert.deepEqual(logs[0].team, { name: "Team Alpha", tag: "ALP" });
  assert.match(logs[0].details.join("\n"), /Original message ID: message-1/);
  assert.match(logs[0].details.join("\n"), /%register/);
  assert.match(logs[0].details.join("\n"), /logo\.png/);
});

test("ban-role registration rejection logs proof without public reply", async () => {
  const replies: string[] = [];
  const reactions: string[] = [];
  const logs: any[] = [];
  const message = {
    id: "message-ban-role",
    url: "https://discord.test/channels/guild-1/registration-channel/message-ban-role",
    author: {
      id: "manager-1",
      username: "manager",
      globalName: "Manager",
      bot: false,
      tag: "manager#0001",
    },
    content: "%register\nTeam Blocked\nBLK\n<@111111111111111111>",
    guild: { id: "guild-1" },
    client: { user: { id: "bot-1" } },
    channel: {
      id: "registration-channel",
      topic: "arenzyra-session=session-1;kind=registration",
    },
    member: {
      permissions: { has: () => false },
      roles: { cache: { has: () => false, some: () => false } },
    },
    mentions: {
      users: new Collection([
        [
          "111111111111111111",
          {
            id: "111111111111111111",
            username: "blocked-manager",
            globalName: "Blocked Manager",
            bot: false,
            tag: "blocked#0001",
          },
        ],
      ]),
      channels: { first: () => null },
    },
    attachments: new Collection(),
    reactions: {
      resolve: () => null,
      cache: { find: () => undefined },
    },
    react: async (emoji: string) => {
      reactions.push(emoji);
    },
    reply: async (payload: string | { content?: string }) => {
      replies.push(
        typeof payload === "string" ? payload : (payload.content ?? ""),
      );
      return { delete: async () => undefined };
    },
  };
  const sessionService = {
    findScrimForDiscordChannel: async () => null,
    findScrimForRegistrationChannel: async () => ({
      session: { id: "session-1", name: "Scrim 1" },
      config: {
        sessionId: "session-1",
        organizationId: "org-1",
        registrationMode: "SCRIM",
        logChannelId: "log-channel",
        manageRoleIds: [],
        emojis: { ban: "BAN", reject: "REJECT" },
      },
      accepting: true,
    }),
    registerTeamAndJoinScrim: async () => {
      throw new Error(
        "REJECT You are blocked from registering for this scrim.",
      );
    },
    sendDiscordActionLog: async (
      _guild: unknown,
      _config: unknown,
      log: any,
    ) => {
      logs.push(log);
    },
  };

  const service = new MessageRegistrationService(sessionService as any);
  const handled = await service.handleMessage(message as any);

  assert.equal(handled, true);
  assert.deepEqual(replies, []);
  assert.ok(reactions.length >= 1);
  assert.equal(reactions.at(-1), "🚫");
  assert.equal(logs.length, 1);
  assert.equal(logs[0].action, "Registration rejected");
  assert.equal(logs[0].status, "banned");
  assert.match(logs[0].reason, /blocked from registering/);
  assert.match(logs[0].details.join("\n"), /message-ban-role/);
});

test("rejected confirm command logs proof before deleting original", async () => {
  const replies: string[] = [];
  const logs: any[] = [];
  let deleted = false;
  const message = {
    id: "message-2",
    url: "https://discord.test/channels/guild-1/slot-list/message-2",
    author: { id: "manager-1", bot: false, tag: "manager#0001" },
    content: "%confirm 22",
    guild: { id: "guild-1" },
    channel: {
      id: "slot-list",
      send: async (payload: { content?: string }) => {
        replies.push(payload.content ?? "");
        return { delete: async () => undefined };
      },
    },
    attachments: new Collection(),
    delete: async () => {
      deleted = true;
    },
    reply: async (payload: string | { content?: string }) => {
      replies.push(
        typeof payload === "string" ? payload : (payload.content ?? ""),
      );
      return { delete: async () => undefined };
    },
  };
  const sessionService = {
    findScrimForDiscordChannel: async () => ({
      session: { id: "session-1", name: "Scrim 1" },
      config: {
        sessionId: "session-1",
        organizationId: "org-1",
        registrationMode: "SCRIM",
        logChannelId: "log-channel",
        manageRoleIds: [],
        emojis: {},
      },
      channelKind: "slot-list",
    }),
    confirmSlotFromDiscord: async () =>
      "\u274C No confirmed team is assigned to slot #22.",
    sendDiscordActionLog: async (
      _guild: unknown,
      _config: unknown,
      log: any,
    ) => {
      logs.push(log);
    },
  };

  const service = new MessageRegistrationService(sessionService as any);
  const handled = await service.handleMessage(message as any);

  assert.equal(handled, true);
  assert.equal(deleted, true);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].action, "Command rejected and deleted");
  assert.equal(logs[0].status, "slot confirmation rejected");
  assert.match(logs[0].details.join("\n"), /%confirm 22/);
});

test("%ban permanent choice asks for reason before creating manager ban", async () => {
  let createdCommand: any = null;
  let shownModal: any = null;
  let promptEdit: any = null;
  let editPayload: any = null;
  const replies: any[] = [];
  const manager = {
    id: "111111111111111111",
    username: "manager",
    bot: false,
  };
  const guild = { id: "guild-1" };
  const sessionService = {
    findScrimForDiscordChannel: async () => ({
      session: { id: "session-1", name: "Scrim 1" },
      config: {
        organizationId: "org-1",
        manageRoleIds: [],
        emojis: { banDefaultReason: "Manual Discord ban" },
      },
      channelKind: "manager",
    }),
    withOrganization: async (_organizationId: string, fn: () => Promise<any>) =>
      fn(),
    createTeamBanFromDiscord: async (command: any) => {
      createdCommand = command;
      return "Manager ban saved\nDuration: permanent";
    },
  };
  const message = {
    id: "message-1",
    url: "https://discord.test/message-1",
    author: { id: "staff-1", bot: false, tag: "staff#0001" },
    content: "%ban <@111111111111111111> + abusive behavior",
    guild,
    channel: { id: "manager-channel" },
    client: { user: { id: "bot-1" } },
    member: {
      permissions: { has: () => true },
      roles: { cache: { has: () => false, some: () => false } },
    },
    mentions: {
      users: new Collection([[manager.id, manager]]),
    },
    reply: async (payload: any) => {
      replies.push(payload);
      return { id: "prompt-1" };
    },
  };

  const service = new MessageRegistrationService(sessionService as any);
  const handled = await service.handleMessage(message as any);

  assert.equal(handled, true);
  assert.equal(replies.length, 1);
  assert.match(replies[0].content, /Choose the ban duration/);
  const selectId = replies[0].components[0].toJSON().components[0].custom_id;

  const selectHandled = await service.handleStringSelectMenu({
    customId: selectId,
    values: ["permanent"],
    user: { id: "staff-1", tag: "staff#0001" },
    memberPermissions: { has: () => true },
    member: null,
    guild,
    showModal: async (modal: any) => {
      shownModal = modal;
    },
    reply: async () => undefined,
  } as any);

  assert.equal(selectHandled, true);
  assert.equal(createdCommand, null);
  const modalJson = shownModal.toJSON();
  assert.equal(modalJson.title, "Permanent Ban Reason");
  assert.equal(modalJson.components[0].components[0].custom_id, "reason");
  assert.equal(modalJson.components[0].components[0].value, "abusive behavior");

  const modalHandled = await service.handleModalSubmit({
    customId: modalJson.custom_id,
    user: { id: "staff-1", tag: "staff#0001" },
    memberPermissions: { has: () => true },
    member: null,
    guild,
    channel: {
      messages: {
        fetch: async () => ({
          edit: async (payload: any) => {
            promptEdit = payload;
            return payload;
          },
        }),
      },
    },
    fields: {
      getTextInputValue: () => "abusive behavior",
    },
    deferReply: async () => undefined,
    editReply: async (payload: any) => {
      editPayload = payload;
      return payload;
    },
    reply: async () => undefined,
  } as any);

  assert.equal(modalHandled, true);
  assert.match(promptEdit.content, /Manager ban saved/);
  assert.match(editPayload.content, /Manager ban saved/);
  assert.deepEqual(createdCommand, {
    target: { kind: "manager", discordUserId: "111111111111111111" },
    scope: "SESSION",
    sessionId: "session-1",
    matchNumbers: [],
    allMatches: false,
    serverAction: null,
    days: null,
    reason: "abusive behavior",
    note: "Created from Discord %ban command: https://discord.test/message-1",
  });
});

test("%ban accepts all-sessions scope as an organization-wide manager ban", async () => {
  let createdCommand: any = null;
  const manager = {
    id: "111111111111111111",
    username: "manager",
    bot: false,
  };
  const guild = { id: "guild-1" };
  const sessionService = {
    findScrimForDiscordChannel: async () => ({
      session: { id: "session-1", name: "Scrim 1" },
      config: {
        organizationId: "org-1",
        manageRoleIds: [],
        emojis: { banDefaultReason: "Manual Discord ban" },
      },
      channelKind: "manager",
    }),
    withOrganization: async (_organizationId: string, fn: () => Promise<any>) =>
      fn(),
    createTeamBanFromDiscord: async (command: any) => {
      createdCommand = command;
      return "Manager ban saved";
    },
  };
  const replies: any[] = [];
  const message = {
    id: "message-all-sessions",
    url: "https://discord.test/message-all-sessions",
    author: { id: "staff-1", bot: false, tag: "staff#0001" },
    content:
      "%ban <@111111111111111111> scope=all-sessions days=2 + repeated no-show",
    guild,
    channel: { id: "manager-channel" },
    client: { user: { id: "bot-1" } },
    member: {
      permissions: { has: () => true },
      roles: { cache: { has: () => false, some: () => false } },
    },
    mentions: {
      users: new Collection([[manager.id, manager]]),
    },
    reply: async (payload: any) => {
      replies.push(payload);
      return { id: "reply-1" };
    },
  };

  const service = new MessageRegistrationService(sessionService as any);
  const handled = await service.handleMessage(message as any);

  assert.equal(handled, true);
  assert.deepEqual(createdCommand, {
    target: { kind: "manager", discordUserId: "111111111111111111" },
    scope: "TEAM",
    sessionId: "session-1",
    matchNumbers: [],
    allMatches: false,
    serverAction: null,
    days: 2,
    reason: "repeated no-show",
    note: "Created from Discord %ban command: https://discord.test/message-all-sessions",
  });
  assert.match(replies[0].content, /Manager ban saved/);
});

test("%ban accepts selected sessions by name", async () => {
  let createdCommand: any = null;
  const guild = { id: "guild-1" };
  const sessionService = {
    findScrimForDiscordChannel: async () => ({
      session: { id: "session-1", name: "Scrim 1" },
      config: {
        organizationId: "org-1",
        manageRoleIds: [],
        emojis: { banDefaultReason: "Manual Discord ban" },
      },
      channelKind: "manager",
    }),
    withOrganization: async (_organizationId: string, fn: () => Promise<any>) =>
      fn(),
    createTeamBanFromDiscord: async (command: any) => {
      createdCommand = command;
      return "Manager ban saved";
    },
  };
  const replies: any[] = [];
  const message = {
    id: "message-selected-sessions",
    url: "https://discord.test/message-selected-sessions",
    author: { id: "staff-1", bot: false, tag: "staff#0001" },
    content:
      '%ban DXB sessions="Scrim 16:00, Scrim 20:00" days=3 + wrong lobby',
    guild,
    channel: { id: "manager-channel" },
    client: { user: { id: "bot-1" } },
    member: {
      permissions: { has: () => true },
      roles: { cache: { has: () => false, some: () => false } },
    },
    mentions: {
      users: new Collection(),
    },
    reply: async (payload: any) => {
      replies.push(payload);
      return { id: "reply-1" };
    },
  };

  const service = new MessageRegistrationService(sessionService as any);
  const handled = await service.handleMessage(message as any);

  assert.equal(handled, true);
  assert.deepEqual(createdCommand, {
    target: { kind: "team", query: "DXB" },
    scope: "SESSION",
    sessionId: "session-1",
    sessionSelectors: ["Scrim 16:00", "Scrim 20:00"],
    matchNumbers: [],
    allMatches: false,
    serverAction: null,
    days: 3,
    reason: "wrong lobby",
    note: "Created from Discord %ban command: https://discord.test/message-selected-sessions",
  });
  assert.match(replies[0].content, /Manager ban saved/);
});

test("%ban timed choice asks for days and creates timed manager ban", async () => {
  let createdCommand: any = null;
  let shownModal: any = null;
  let promptEdit: any = null;
  let modalReply: any = null;
  const replies: any[] = [];
  const guild = { id: "guild-1" };
  const sessionService = {
    findScrimForDiscordChannel: async () => ({
      session: { id: "session-1", name: "Scrim 1" },
      config: {
        organizationId: "org-1",
        manageRoleIds: [],
        emojis: {
          banDefaultDurationDays: "3",
          banDefaultReason: "Manual Discord ban",
        },
      },
      channelKind: "manager",
    }),
    withOrganization: async (_organizationId: string, fn: () => Promise<any>) =>
      fn(),
    createTeamBanFromDiscord: async (command: any) => {
      createdCommand = command;
      return "Manager ban saved\nDuration: 7 day(s)";
    },
  };
  const message = {
    id: "message-2",
    url: "https://discord.test/message-2",
    author: { id: "staff-1", bot: false, tag: "staff#0001" },
    content: "%ban DXB + no-show abuse",
    guild,
    channel: { id: "manager-channel" },
    client: { user: { id: "bot-1" } },
    member: {
      permissions: { has: () => true },
      roles: { cache: { has: () => false, some: () => false } },
    },
    mentions: {
      users: new Collection(),
    },
    reply: async (payload: any) => {
      replies.push(payload);
      return { id: "prompt-2" };
    },
  };

  const service = new MessageRegistrationService(sessionService as any);
  await service.handleMessage(message as any);
  const selectId = replies[0].components[0].toJSON().components[0].custom_id;

  const selectHandled = await service.handleStringSelectMenu({
    customId: selectId,
    values: ["days"],
    user: { id: "staff-1", tag: "staff#0001" },
    memberPermissions: { has: () => true },
    member: null,
    showModal: async (modal: any) => {
      shownModal = modal;
    },
    reply: async () => undefined,
  } as any);

  assert.equal(selectHandled, true);
  const modalId = shownModal.toJSON().custom_id;

  const modalHandled = await service.handleModalSubmit({
    customId: modalId,
    user: { id: "staff-1", tag: "staff#0001" },
    memberPermissions: { has: () => true },
    member: null,
    guild,
    channel: {
      messages: {
        fetch: async () => ({
          edit: async (payload: any) => {
            promptEdit = payload;
            return payload;
          },
        }),
      },
    },
    fields: {
      getTextInputValue: (customId: string) =>
        customId === "days" ? "7" : "no-show abuse",
    },
    deferReply: async () => undefined,
    editReply: async (payload: any) => {
      modalReply = payload;
      return payload;
    },
    reply: async () => undefined,
  } as any);

  assert.equal(modalHandled, true);
  assert.match(promptEdit.content, /Manager ban saved/);
  assert.match(modalReply.content, /Duration: 7 day/);
  assert.deepEqual(createdCommand, {
    target: { kind: "team", query: "DXB" },
    scope: "SESSION",
    sessionId: "session-1",
    matchNumbers: [],
    allMatches: false,
    serverAction: null,
    days: 7,
    reason: "no-show abuse",
    note: "Created from Discord %ban command: https://discord.test/message-2",
  });
});

test("%ban-team permanent choice asks for reason before creating team target ban", async () => {
  let createdCommand: any = null;
  let shownModal: any = null;
  let promptEdit: any = null;
  let editPayload: any = null;
  const replies: any[] = [];
  const manager = {
    id: "111111111111111111",
    username: "manager",
    bot: false,
  };
  const guild = { id: "guild-1" };
  const sessionService = {
    findScrimForDiscordChannel: async () => ({
      session: { id: "session-1", name: "Scrim 1" },
      config: {
        organizationId: "org-1",
        manageRoleIds: [],
        emojis: { banDefaultReason: "Manual Discord ban" },
      },
      channelKind: "manager",
    }),
    withOrganization: async (_organizationId: string, fn: () => Promise<any>) =>
      fn(),
    createTeamBanFromDiscord: async (command: any) => {
      createdCommand = command;
      return "Manager ban saved for DXB [DXB]\nDuration: permanent";
    },
  };
  const message = {
    id: "message-team-ban",
    url: "https://discord.test/message-team-ban",
    author: { id: "staff-1", bot: false, tag: "staff#0001" },
    content: "%ban-team DXB <@111111111111111111> + stream sniping",
    guild,
    channel: { id: "manager-channel" },
    client: { user: { id: "bot-1" } },
    member: {
      permissions: { has: () => true },
      roles: { cache: { has: () => false, some: () => false } },
    },
    mentions: {
      users: new Collection([[manager.id, manager]]),
    },
    reply: async (payload: any) => {
      replies.push(payload);
      return { id: "prompt-team-ban" };
    },
  };

  const service = new MessageRegistrationService(sessionService as any);
  const handled = await service.handleMessage(message as any);

  assert.equal(handled, true);
  assert.equal(createdCommand, null);
  assert.match(replies[0].content, /Team ban prepared/);
  assert.match(replies[0].content, /Target: DXB/);
  assert.match(replies[0].content, /Choose the ban duration/);
  const selectId = replies[0].components[0].toJSON().components[0].custom_id;

  const selectHandled = await service.handleStringSelectMenu({
    customId: selectId,
    values: ["permanent"],
    user: { id: "staff-1", tag: "staff#0001" },
    memberPermissions: { has: () => true },
    member: null,
    guild,
    showModal: async (modal: any) => {
      shownModal = modal;
    },
    reply: async () => undefined,
  } as any);

  assert.equal(selectHandled, true);
  assert.equal(createdCommand, null);
  const modalJson = shownModal.toJSON();
  assert.equal(modalJson.title, "Permanent Ban Reason");
  assert.equal(modalJson.components[0].components[0].custom_id, "reason");
  assert.equal(modalJson.components[0].components[0].value, "stream sniping");

  const modalHandled = await service.handleModalSubmit({
    customId: modalJson.custom_id,
    user: { id: "staff-1", tag: "staff#0001" },
    memberPermissions: { has: () => true },
    member: null,
    guild,
    channel: {
      messages: {
        fetch: async () => ({
          edit: async (payload: any) => {
            promptEdit = payload;
            return payload;
          },
        }),
      },
    },
    fields: {
      getTextInputValue: () => "stream sniping",
    },
    deferReply: async () => undefined,
    editReply: async (payload: any) => {
      editPayload = payload;
      return payload;
    },
    reply: async () => undefined,
  } as any);

  assert.equal(modalHandled, true);
  assert.match(promptEdit.content, /Manager ban saved for DXB/);
  assert.match(editPayload.content, /Manager ban saved for DXB/);
  assert.deepEqual(createdCommand, {
    target: { kind: "team", query: "DXB" },
    scope: "SESSION",
    sessionId: "session-1",
    matchNumbers: [],
    allMatches: false,
    serverAction: null,
    days: null,
    reason: "stream sniping",
    note: "Created from Discord %ban-team command: https://discord.test/message-team-ban",
  });
});

test("%unban manager mention revokes active manager bans", async () => {
  let revokedCommand: any = null;
  const replies: any[] = [];
  const manager = {
    id: "111111111111111111",
    username: "manager",
    bot: false,
  };
  const guild = { id: "guild-1" };
  const sessionService = {
    findScrimForDiscordChannel: async () => ({
      session: { id: "session-1", name: "Scrim 1" },
      config: {
        organizationId: "org-1",
        manageRoleIds: [],
        emojis: { banDefaultReason: "Manual Discord ban" },
      },
      channelKind: "manager",
    }),
    withOrganization: async (_organizationId: string, fn: () => Promise<any>) =>
      fn(),
    revokeTeamBansFromDiscord: async (command: any) => {
      revokedCommand = command;
      return "Revoked 1 active manager ban(s).";
    },
  };
  const message = {
    id: "message-3",
    url: "https://discord.test/message-3",
    author: { id: "staff-1", bot: false, tag: "staff#0001" },
    content: "%unban <@111111111111111111> + mistaken ban",
    guild,
    channel: { id: "manager-channel" },
    client: { user: { id: "bot-1" } },
    member: {
      permissions: { has: () => true },
      roles: { cache: { has: () => false, some: () => false } },
    },
    mentions: {
      users: new Collection([[manager.id, manager]]),
    },
    reply: async (payload: any) => {
      replies.push(payload);
      return payload;
    },
  };

  const service = new MessageRegistrationService(sessionService as any);
  const handled = await service.handleMessage(message as any);

  assert.equal(handled, true);
  assert.match(replies[0].content, /Revoked 1 active manager ban/);
  assert.deepEqual(revokedCommand, {
    target: { kind: "manager", discordUserId: "111111111111111111" },
    scope: null,
    sessionId: "session-1",
    matchNumbers: [],
    allMatches: false,
    reason: "mistaken ban",
  });
});

test("%unban-team with team and manager mention revokes immediately for team target", async () => {
  let revokedCommand: any = null;
  const replies: any[] = [];
  const manager = {
    id: "111111111111111111",
    username: "manager",
    bot: false,
  };
  const guild = { id: "guild-1" };
  const sessionService = {
    findScrimForDiscordChannel: async () => ({
      session: { id: "session-1", name: "Scrim 1" },
      config: {
        organizationId: "org-1",
        manageRoleIds: [],
        emojis: {},
      },
      channelKind: "manager",
    }),
    withOrganization: async (_organizationId: string, fn: () => Promise<any>) =>
      fn(),
    revokeTeamBansFromDiscord: async (command: any) => {
      revokedCommand = command;
      return "Revoked 1 active manager ban(s) for DXB.";
    },
  };
  const message = {
    id: "message-team-unban",
    url: "https://discord.test/message-team-unban",
    author: { id: "staff-1", bot: false, tag: "staff#0001" },
    content: "%unban-team DXB <@111111111111111111> + appeal accepted",
    guild,
    channel: { id: "manager-channel" },
    client: { user: { id: "bot-1" } },
    member: {
      permissions: { has: () => true },
      roles: { cache: { has: () => false, some: () => false } },
    },
    mentions: {
      users: new Collection([[manager.id, manager]]),
    },
    reply: async (payload: any) => {
      replies.push(payload);
      return payload;
    },
  };

  const service = new MessageRegistrationService(sessionService as any);
  const handled = await service.handleMessage(message as any);

  assert.equal(handled, true);
  assert.match(replies[0].content, /Revoked 1 active manager ban/);
  assert.deepEqual(revokedCommand, {
    target: { kind: "team", query: "DXB" },
    scope: null,
    sessionId: "session-1",
    matchNumbers: [],
    allMatches: false,
    reason: "appeal accepted",
  });
});

test("!ban manager mention is ignored", async () => {
  let lookupCalled = false;
  const replies: any[] = [];
  const manager = {
    id: "111111111111111111",
    username: "manager",
    bot: false,
  };
  const sessionService = {
    findScrimForDiscordChannel: async () => {
      lookupCalled = true;
      return null;
    },
  };
  const message = {
    id: "message-4",
    url: "https://discord.test/message-4",
    author: { id: "staff-1", bot: false, tag: "staff#0001" },
    content: "!ban <@111111111111111111> + chargeback",
    guild: { id: "guild-1" },
    channel: { id: "manager-channel" },
    client: { user: { id: "bot-1" } },
    mentions: {
      users: new Collection([[manager.id, manager]]),
    },
    reply: async (payload: any) => {
      replies.push(payload);
      return payload;
    },
  };

  const service = new MessageRegistrationService(sessionService as any);
  const handled = await service.handleMessage(message as any);

  assert.equal(handled, false);
  assert.equal(lookupCalled, false);
  assert.deepEqual(replies, []);
});

test("staff registration messages use the first mentioned user as team leader", async () => {
  let capturedArgs: unknown[] | null = null;
  const reactions: string[] = [];
  const manager = {
    id: "manager-1",
    username: "manager",
    globalName: "Manager",
    bot: false,
  };
  const message = {
    author: {
      id: "staff-1",
      username: "staff",
      globalName: "Staff",
      bot: false,
      tag: "staff",
    },
    content: "%register\nFiX Esports\nFiX\n<@manager-1>",
    guild: { id: "guild-1" },
    channel: { id: "registration-channel" },
    member: {
      permissions: { has: () => false },
      roles: {
        cache: {
          has: (roleId: string) => roleId === "staff-role",
          some: () => false,
        },
      },
    },
    mentions: {
      users: new Map([[manager.id, manager]]),
      channels: { first: () => null },
    },
    attachments: { find: () => undefined },
    client: { user: { id: "bot-1" } },
    reactions: {
      resolve: () => ({
        users: { remove: async () => undefined },
      }),
    },
    react: async (emoji: string) => {
      reactions.push(emoji);
    },
    reply: async () => undefined,
  };
  const sessionService = {
    findScrimForRegistrationChannel: async () => ({
      accepting: true,
      session: { id: "session-1", name: "Scrim 1" },
      config: {
        organizationId: "org-1",
        manageRoleIds: ["staff-role"],
        emojis: { check: "\u2611\uFE0F" },
      },
    }),
    registerTeamAndJoinScrim: async (...args: unknown[]) => {
      capturedArgs = args;
      const options = args[10] as {
        onSessionRegistration?: (result: unknown) => Promise<void>;
      };
      await options.onSessionRegistration?.({
        registration: { status: "CONFIRMED", waitlistPosition: null },
        status: "registered",
        warning: null,
      });
      return "Team registered";
    },
  };

  const service = new MessageRegistrationService(sessionService as any);
  const handled = await service.handleMessage(message as any);

  assert.equal(handled, true);
  assert.ok(capturedArgs);
  assert.equal(capturedArgs[0], "manager-1");
  assert.equal(capturedArgs[1], "manager");
  assert.equal(capturedArgs[2], "Manager");
  const options = capturedArgs[10] as {
    requesterDiscordId?: string;
    backgroundDiscordSync?: boolean;
    onSessionRegistration?: unknown;
  };
  assert.equal(options.requesterDiscordId, "staff-1");
  assert.equal(options.backgroundDiscordSync, true);
  assert.equal(typeof options.onSessionRegistration, "function");
  assert.deepEqual(reactions, ["\u23F3", "\u2611\uFE0F"]);
});

test("waitlist channel register promotes an existing waitlist team", async () => {
  let promotedArgs: unknown[] | null = null;
  const replies: string[] = [];
  const reactions: string[] = [];
  const manager = {
    id: "manager-1",
    username: "manager",
    globalName: "Manager",
    bot: false,
  };
  const message = {
    author: {
      id: "manager-1",
      username: "manager",
      globalName: "Manager",
      bot: false,
      tag: "manager",
    },
    content: "%register\nOppressors\nOPS\n<@manager-1>",
    guild: { id: "guild-1" },
    channel: { id: "waitlist-channel" },
    member: {
      permissions: { has: () => false },
      roles: { cache: { has: () => false, some: () => false } },
    },
    mentions: {
      users: new Map([[manager.id, manager]]),
      channels: { first: () => null },
    },
    attachments: { find: () => undefined },
    client: { user: { id: "bot-1" } },
    reactions: {
      resolve: () => ({
        users: { remove: async () => undefined },
      }),
    },
    react: async (emoji: string) => {
      reactions.push(emoji);
    },
    reply: async (payload: string | { content?: string }) => {
      replies.push(
        typeof payload === "string" ? payload : (payload.content ?? ""),
      );
    },
  };
  const sessionService = {
    findScrimForWaitlistChannel: async () => ({
      accepting: true,
      session: { id: "session-1", name: "Scrim 1" },
      config: { organizationId: "org-1", emojis: { check: "\u2705" } },
    }),
    promoteWaitlistedTeamFromDiscord: async (...args: unknown[]) => {
      promotedArgs = args;
      return "\u2705 Waitlist team moved to Slot 7.";
    },
    findScrimForRegistrationChannel: async () => {
      throw new Error("registration channel should not be used");
    },
    registerTeamAndJoinScrim: async () => {
      throw new Error("registration should not create a new team");
    },
  };

  const service = new MessageRegistrationService(sessionService as any);
  const handled = await service.handleMessage(message as any);

  assert.equal(handled, true);
  assert.ok(promotedArgs);
  assert.equal(promotedArgs[0], "manager-1");
  assert.equal(promotedArgs[2], "OPS");
  assert.equal(promotedArgs[3], "Oppressors");
  assert.equal(replies[0], "\u2705 Waitlist team moved to Slot 7.");
  assert.deepEqual(reactions, ["\u23F3", "\u2705"]);
});

test("staff waitlist channel register bypasses closed promotion window gate", async () => {
  let promotedArgs: unknown[] | null = null;
  const replies: string[] = [];
  const manager = {
    id: "manager-1",
    username: "manager",
    globalName: "Manager",
    bot: false,
  };
  const message = {
    author: {
      id: "staff-1",
      username: "staff",
      globalName: "Staff",
      bot: false,
      tag: "staff",
    },
    content: "%register\nOppressors\nOPS\n<@manager-1>",
    guild: { id: "guild-1" },
    channel: { id: "waitlist-channel" },
    member: {
      permissions: { has: () => false },
      roles: {
        cache: {
          has: (roleId: string) => roleId === "staff-role",
          some: () => false,
        },
      },
    },
    mentions: {
      users: new Map([[manager.id, manager]]),
      channels: { first: () => null },
    },
    attachments: { find: () => undefined },
    client: { user: { id: "bot-1" } },
    reactions: {
      resolve: () => ({
        users: { remove: async () => undefined },
      }),
    },
    react: async () => undefined,
    reply: async (payload: string | { content?: string }) => {
      replies.push(
        typeof payload === "string" ? payload : (payload.content ?? ""),
      );
    },
  };
  const sessionService = {
    findScrimForWaitlistChannel: async () => ({
      accepting: false,
      session: { id: "session-1", name: "Scrim 1" },
      config: {
        organizationId: "org-1",
        manageRoleIds: ["staff-role"],
        emojis: { check: "\u2705" },
      },
    }),
    promoteWaitlistedTeamFromDiscord: async (...args: unknown[]) => {
      promotedArgs = args;
      return "\u2705 Waitlist team moved to Slot 7.";
    },
  };

  const service = new MessageRegistrationService(sessionService as any);
  const handled = await service.handleMessage(message as any);

  assert.equal(handled, true);
  assert.ok(promotedArgs);
  assert.equal(promotedArgs[0], "staff-1");
  assert.equal(promotedArgs[2], "OPS");
  assert.equal(replies[0], "\u2705 Waitlist team moved to Slot 7.");
});

test("staff vip registration command requests VIP placement", async () => {
  let capturedArgs: unknown[] | null = null;
  const manager = {
    id: "123456789012345678",
    username: "manager",
    globalName: "Manager",
    bot: false,
  };
  const message = {
    author: {
      id: "staff-1",
      username: "staff",
      globalName: "Staff",
      bot: false,
      tag: "staff",
    },
    content: "%register vip\nHORUS ESPORTS\nHORUS\n<@123456789012345678>",
    guild: { id: "guild-1" },
    channel: { id: "registration-channel" },
    member: {
      permissions: { has: () => false },
      roles: {
        cache: {
          has: (roleId: string) => roleId === "staff-role",
          some: () => false,
        },
      },
    },
    mentions: {
      users: new Map([[manager.id, manager]]),
      channels: { first: () => null },
    },
    attachments: { find: () => undefined },
    client: { user: { id: "bot-1" } },
    reactions: {
      resolve: () => ({
        users: { remove: async () => undefined },
      }),
    },
    react: async () => undefined,
    reply: async () => undefined,
  };
  const sessionService = {
    findScrimForRegistrationChannel: async () => ({
      accepting: true,
      session: { id: "session-1", name: "Scrim Registration" },
      config: {
        organizationId: "org-1",
        registrationMode: "SCRIM",
        manageRoleIds: ["staff-role"],
        emojis: {},
      },
    }),
    registerTeamAndJoinScrim: async (...args: unknown[]) => {
      capturedArgs = args;
      return "VIP team registered";
    },
  };

  const service = new MessageRegistrationService(sessionService as any);
  const handled = await service.handleMessage(message as any);

  assert.equal(handled, true);
  assert.ok(capturedArgs);
  assert.equal(capturedArgs[0], "123456789012345678");
  assert.equal(capturedArgs[3], "HORUS");
  assert.equal(capturedArgs[4], "HORUS ESPORTS");
  assert.equal((capturedArgs[10] as { placement?: string }).placement, "VIP");
});

test("normal users cannot use vip registration command", async () => {
  let registered = false;
  let replyPayload: any = null;
  const manager = {
    id: "123456789012345678",
    username: "manager",
    globalName: "Manager",
    bot: false,
  };
  const message = {
    author: {
      id: "123456789012345678",
      username: "manager",
      globalName: "Manager",
      bot: false,
      tag: "manager",
    },
    content: "%register vip\nHORUS ESPORTS\nHORUS\n<@123456789012345678>",
    guild: { id: "guild-1" },
    channel: { id: "registration-channel" },
    member: {
      permissions: { has: () => false },
      roles: {
        cache: { has: () => false, some: () => false },
      },
    },
    mentions: {
      users: new Map([[manager.id, manager]]),
      channels: { first: () => null },
    },
    attachments: { find: () => undefined },
    client: { user: { id: "bot-1" } },
    reactions: {
      resolve: () => ({
        users: { remove: async () => undefined },
      }),
    },
    react: async () => undefined,
    reply: async (payload: any) => {
      replyPayload = payload;
    },
  };
  const sessionService = {
    findScrimForRegistrationChannel: async () => ({
      accepting: true,
      session: { id: "session-1", name: "Scrim Registration" },
      config: {
        organizationId: "org-1",
        registrationMode: "SCRIM",
        manageRoleIds: [],
        emojis: {},
      },
    }),
    registerTeamAndJoinScrim: async () => {
      registered = true;
      return "Should not happen";
    },
    userHasVipRegistrationAccess: async () => false,
    userHasCustomRoleRegistrationAccess: async () => false,
    userHasEarlyAccessRegistrationAccess: async () => false,
  };

  const service = new MessageRegistrationService(sessionService as any);
  const handled = await service.handleMessage(message as any);

  assert.equal(handled, true);
  assert.equal(registered, false);
  assert.match(replyPayload?.content, /VIP registration is closed/);
});

test("event registration channel accepts pipe format without register command", async () => {
  let capturedArgs: unknown[] | null = null;
  const manager = {
    id: "123456789012345678",
    username: "manager",
    globalName: "Manager",
    bot: false,
  };
  const message = {
    author: {
      id: "staff-1",
      username: "staff",
      globalName: "Staff",
      bot: false,
      tag: "staff",
    },
    content: "HORUS ESPORTS | HORUS | <@123456789012345678>",
    guild: { id: "guild-1" },
    channel: { id: "registration-channel" },
    member: {
      permissions: { has: () => false },
      roles: {
        cache: {
          has: (roleId: string) => roleId === "staff-role",
          some: () => false,
        },
      },
    },
    mentions: {
      users: new Map([[manager.id, manager]]),
      channels: { first: () => null },
    },
    attachments: { find: () => undefined },
    client: { user: { id: "bot-1" } },
    reactions: {
      resolve: () => ({
        users: { remove: async () => undefined },
      }),
    },
    react: async () => undefined,
    reply: async () => undefined,
  };
  const sessionService = {
    findScrimForRegistrationChannel: async () => ({
      accepting: true,
      session: { id: "session-1", name: "Event Registration" },
      config: {
        organizationId: "org-1",
        registrationMode: "EVENT",
        manageRoleIds: ["staff-role"],
        emojis: {},
      },
    }),
    registerTeamAndJoinScrim: async (...args: unknown[]) => {
      capturedArgs = args;
      return "Team registered";
    },
  };

  const service = new MessageRegistrationService(sessionService as any);
  const handled = await service.handleMessage(message as any);

  assert.equal(handled, true);
  assert.ok(capturedArgs);
  assert.equal(capturedArgs[0], "123456789012345678");
  assert.equal(capturedArgs[3], "HORUS");
  assert.equal(capturedArgs[4], "HORUS ESPORTS");
});

test("event registration channel enforces configured max managers per team", async () => {
  let registered = false;
  let replyPayload: any = null;
  const firstManager = {
    id: "123456789012345678",
    username: "first",
    globalName: "First",
    bot: false,
  };
  const secondManager = {
    id: "223456789012345678",
    username: "second",
    globalName: "Second",
    bot: false,
  };
  const message = {
    author: {
      id: "staff-1",
      username: "staff",
      globalName: "Staff",
      bot: false,
      tag: "staff",
    },
    content:
      "HORUS ESPORTS | HORUS | <@123456789012345678> <@223456789012345678>",
    guild: { id: "guild-1" },
    channel: { id: "registration-channel" },
    member: {
      permissions: { has: () => false },
      roles: {
        cache: {
          has: (roleId: string) => roleId === "staff-role",
          some: () => false,
        },
      },
    },
    mentions: {
      users: new Map([
        [firstManager.id, firstManager],
        [secondManager.id, secondManager],
      ]),
      channels: { first: () => null },
    },
    attachments: { find: () => undefined },
    client: { user: { id: "bot-1" } },
    reactions: {
      resolve: () => ({
        users: { remove: async () => undefined },
      }),
    },
    react: async () => undefined,
    reply: async (payload: { content?: string }) => {
      replyPayload = payload;
      return { delete: async () => undefined };
    },
  };
  const sessionService = {
    findScrimForRegistrationChannel: async () => ({
      accepting: true,
      session: { id: "session-1", name: "Event Registration" },
      config: {
        organizationId: "org-1",
        registrationMode: "EVENT",
        manageRoleIds: ["staff-role"],
        maxManagersPerTeam: 1,
        emojis: {},
      },
    }),
    registerTeamAndJoinScrim: async () => {
      registered = true;
      return "Should not happen";
    },
  };

  const service = new MessageRegistrationService(sessionService as any);
  const handled = await service.handleMessage(message as any);

  assert.equal(handled, true);
  assert.equal(registered, false);
  const replyContent =
    (replyPayload as { content?: string } | null)?.content ?? "";
  assert.match(replyContent, /Mention up to 1 manager per team/);
});

test("tournament registration stores roster JSON and only assigns manager roles", async () => {
  let capturedArgs: unknown[] | null = null;
  const manager = {
    id: "123456789012345678",
    username: "manager",
    globalName: "Manager",
    bot: false,
  };
  const player = {
    id: "223456789012345678",
    username: "player",
    globalName: "Player",
    bot: false,
  };
  const sub = {
    id: "323456789012345678",
    username: "sub",
    globalName: "Sub",
    bot: false,
  };
  const message = {
    author: {
      id: "staff-1",
      username: "staff",
      globalName: "Staff",
      bot: false,
      tag: "staff",
    },
    content: [
      "team name: HORUS ESPORTS",
      "team tag: HRS",
      "team manager: <@123456789012345678>",
      "player 1 name: Manager IGN <@123456789012345678>",
      "player 1 uid: 111111",
      "player 2 name: Player Two <@223456789012345678>",
      "player 2 uid: 222222",
      "substitute 1 name: Sub One <@323456789012345678>",
      "substitute 1 uid: 333333",
    ].join("\n"),
    guild: { id: "guild-1" },
    channel: { id: "registration-channel" },
    member: {
      permissions: { has: () => false },
      roles: {
        cache: {
          has: (roleId: string) => roleId === "staff-role",
          some: () => false,
        },
      },
    },
    mentions: {
      users: new Map([
        [manager.id, manager],
        [player.id, player],
        [sub.id, sub],
      ]),
      channels: { first: () => null },
    },
    attachments: { find: () => undefined },
    client: { user: { id: "bot-1" } },
    reactions: {
      resolve: () => ({
        users: { remove: async () => undefined },
      }),
    },
    react: async () => undefined,
    reply: async () => undefined,
  };
  const sessionService = {
    findScrimForRegistrationChannel: async () => ({
      accepting: true,
      session: { id: "session-1", name: "Tournament Registration" },
      config: {
        organizationId: "org-1",
        registrationMode: "TOURNAMENT",
        tournamentMainPlayersRequired: 2,
        tournamentLogoRequired: false,
        manageRoleIds: ["staff-role"],
        emojis: {},
      },
    }),
    registerTeamAndJoinScrim: async (...args: unknown[]) => {
      capturedArgs = args;
      return "Team registered";
    },
  };

  const service = new MessageRegistrationService(sessionService as any);
  const handled = await service.handleMessage(message as any);

  assert.equal(handled, true);
  assert.ok(capturedArgs);
  assert.equal(capturedArgs[0], manager.id);
  assert.equal(capturedArgs[3], "HRS");
  assert.equal(capturedArgs[4], "HORUS ESPORTS");
  assert.deepEqual(capturedArgs[5], []);
  const options = capturedArgs[10] as {
    tournamentRosterJson?: {
      manager?: { discordUserId?: string };
      teamTag?: string;
      players?: Array<{
        lineupType?: string;
        discordUserId?: string;
        uid?: string;
      }>;
    };
  };
  assert.equal(
    options.tournamentRosterJson?.manager?.discordUserId,
    manager.id,
  );
  assert.equal(options.tournamentRosterJson?.teamTag, "HRS");
  assert.deepEqual(
    options.tournamentRosterJson?.players?.map((entry) => [
      entry.lineupType,
      entry.discordUserId,
      entry.uid,
    ]),
    [
      ["MAIN", manager.id, "111111"],
      ["MAIN", player.id, "222222"],
      ["SUBSTITUTE", sub.id, "333333"],
    ],
  );
});

test("tournament registration accepts compact roster format", async () => {
  let capturedArgs: unknown[] | null = null;
  const manager = {
    id: "123456789012345678",
    username: "manager",
    globalName: "Manager",
    bot: false,
  };
  const player = {
    id: "223456789012345678",
    username: "player",
    globalName: "Player",
    bot: false,
  };
  const message = {
    author: {
      id: "123456789012345678",
      username: "manager",
      globalName: "Manager",
      bot: false,
      tag: "manager",
    },
    content: [
      "Compact Team",
      "CMP",
      "<@123456789012345678>",
      "Manager IGN <@123456789012345678>",
      "111111",
      "Player Two <@223456789012345678>",
      "222222",
    ].join("\n"),
    guild: { id: "guild-1" },
    channel: { id: "registration-channel" },
    member: {
      permissions: { has: () => false },
      roles: { cache: { has: () => false, some: () => false } },
    },
    mentions: {
      users: new Map([
        [manager.id, manager],
        [player.id, player],
      ]),
      channels: { first: () => null },
    },
    attachments: { find: () => undefined },
    client: { user: { id: "bot-1" } },
    reactions: {
      resolve: () => ({
        users: { remove: async () => undefined },
      }),
    },
    react: async () => undefined,
    reply: async () => undefined,
  };
  const sessionService = {
    findScrimForRegistrationChannel: async () => ({
      accepting: true,
      session: { id: "session-1", name: "Tournament Registration" },
      config: {
        organizationId: "org-1",
        registrationMode: "TOURNAMENT",
        tournamentMainPlayersRequired: 2,
        tournamentLogoRequired: false,
        manageRoleIds: [],
        emojis: {},
      },
    }),
    registerTeamAndJoinScrim: async (...args: unknown[]) => {
      capturedArgs = args;
      return "Team registered";
    },
  };

  const service = new MessageRegistrationService(sessionService as any);
  const handled = await service.handleMessage(message as any);

  assert.equal(handled, true);
  assert.ok(capturedArgs);
  assert.equal(capturedArgs[0], manager.id);
  assert.equal(capturedArgs[3], "CMP");
  assert.equal(capturedArgs[4], "Compact Team");
  assert.deepEqual(capturedArgs[5], []);
});

test("tournament registration rejects duplicate player mentions", async () => {
  let registered = false;
  let replyPayload: any = null;
  const manager = {
    id: "123456789012345678",
    username: "manager",
    globalName: "Manager",
    bot: false,
  };
  const player = {
    id: "223456789012345678",
    username: "player",
    globalName: "Player",
    bot: false,
  };
  const message = {
    author: {
      id: "123456789012345678",
      username: "manager",
      globalName: "Manager",
      bot: false,
      tag: "manager",
    },
    content: [
      "team name: Duplicate Team",
      "team tag: DUP",
      "team manager: <@123456789012345678>",
      "player 1 name: First <@223456789012345678>",
      "player 1 uid: 111111",
      "player 2 name: Second <@223456789012345678>",
      "player 2 uid: 222222",
    ].join("\n"),
    guild: { id: "guild-1" },
    channel: { id: "registration-channel" },
    member: {
      permissions: { has: () => false },
      roles: { cache: { has: () => false, some: () => false } },
    },
    mentions: {
      users: new Map([
        [manager.id, manager],
        [player.id, player],
      ]),
      channels: { first: () => null },
    },
    attachments: { find: () => undefined },
    client: { user: { id: "bot-1" } },
    reactions: {
      resolve: () => ({
        users: { remove: async () => undefined },
      }),
    },
    react: async () => undefined,
    reply: async (payload: { content?: string }) => {
      replyPayload = payload;
      return { delete: async () => undefined };
    },
  };
  const sessionService = {
    findScrimForRegistrationChannel: async () => ({
      accepting: true,
      session: { id: "session-1", name: "Tournament Registration" },
      config: {
        organizationId: "org-1",
        registrationMode: "TOURNAMENT",
        tournamentMainPlayersRequired: 2,
        tournamentLogoRequired: false,
        manageRoleIds: [],
        emojis: {},
      },
    }),
    registerTeamAndJoinScrim: async () => {
      registered = true;
      return "Should not happen";
    },
  };

  const service = new MessageRegistrationService(sessionService as any);
  const handled = await service.handleMessage(message as any);

  assert.equal(handled, true);
  assert.equal(registered, false);
  assert.match(replyPayload?.content ?? "", /used more than once/);
});

test("tournament registration requires an explicit team tag", async () => {
  let registered = false;
  let replyPayload: any = null;
  const manager = {
    id: "123456789012345678",
    username: "manager",
    globalName: "Manager",
    bot: false,
  };
  const player = {
    id: "223456789012345678",
    username: "player",
    globalName: "Player",
    bot: false,
  };
  const message = {
    author: {
      id: "123456789012345678",
      username: "manager",
      globalName: "Manager",
      bot: false,
      tag: "manager",
    },
    content: [
      "team name: Missing Tag Team",
      "team manager: <@123456789012345678>",
      "player 1 name: Manager IGN <@123456789012345678>",
      "player 1 uid: 111111",
      "player 2 name: Player Two <@223456789012345678>",
      "player 2 uid: 222222",
    ].join("\n"),
    guild: { id: "guild-1" },
    channel: { id: "registration-channel" },
    member: {
      permissions: { has: () => false },
      roles: { cache: { has: () => false, some: () => false } },
    },
    mentions: {
      users: new Map([
        [manager.id, manager],
        [player.id, player],
      ]),
      channels: { first: () => null },
    },
    attachments: { find: () => undefined },
    client: { user: { id: "bot-1" } },
    reactions: {
      resolve: () => ({
        users: { remove: async () => undefined },
      }),
    },
    react: async () => undefined,
    reply: async (payload: { content?: string }) => {
      replyPayload = payload;
      return { delete: async () => undefined };
    },
  };
  const sessionService = {
    findScrimForRegistrationChannel: async () => ({
      accepting: true,
      session: { id: "session-1", name: "Tournament Registration" },
      config: {
        organizationId: "org-1",
        registrationMode: "TOURNAMENT",
        tournamentMainPlayersRequired: 2,
        tournamentLogoRequired: false,
        manageRoleIds: [],
        emojis: {},
      },
    }),
    registerTeamAndJoinScrim: async () => {
      registered = true;
      return "Should not happen";
    },
  };

  const service = new MessageRegistrationService(sessionService as any);
  const handled = await service.handleMessage(message as any);

  assert.equal(handled, true);
  assert.equal(registered, false);
  assert.match(replyPayload?.content ?? "", /Team tag is required/);
});

test("tournament registration enforces required team logo", async () => {
  let registered = false;
  let replyPayload: any = null;
  const manager = {
    id: "123456789012345678",
    username: "manager",
    globalName: "Manager",
    bot: false,
  };
  const player = {
    id: "223456789012345678",
    username: "player",
    globalName: "Player",
    bot: false,
  };
  const message = {
    author: {
      id: "123456789012345678",
      username: "manager",
      globalName: "Manager",
      bot: false,
      tag: "manager",
    },
    content: [
      "team name: Logo Team",
      "team tag: LOGO",
      "team manager: <@123456789012345678>",
      "player 1 name: Manager IGN <@123456789012345678>",
      "player 1 uid: 111111",
      "player 2 name: Player Two <@223456789012345678>",
      "player 2 uid: 222222",
    ].join("\n"),
    guild: { id: "guild-1" },
    channel: { id: "registration-channel" },
    member: {
      permissions: { has: () => false },
      roles: { cache: { has: () => false, some: () => false } },
    },
    mentions: {
      users: new Map([
        [manager.id, manager],
        [player.id, player],
      ]),
      channels: { first: () => null },
    },
    attachments: { find: () => undefined },
    client: { user: { id: "bot-1" } },
    reactions: {
      resolve: () => ({
        users: { remove: async () => undefined },
      }),
    },
    react: async () => undefined,
    reply: async (payload: { content?: string }) => {
      replyPayload = payload;
      return { delete: async () => undefined };
    },
  };
  const sessionService = {
    findScrimForRegistrationChannel: async () => ({
      accepting: true,
      session: { id: "session-1", name: "Tournament Registration" },
      config: {
        organizationId: "org-1",
        registrationMode: "TOURNAMENT",
        tournamentMainPlayersRequired: 2,
        tournamentLogoRequired: true,
        manageRoleIds: [],
        emojis: {},
      },
    }),
    registerTeamAndJoinScrim: async () => {
      registered = true;
      return "Should not happen";
    },
  };

  const service = new MessageRegistrationService(sessionService as any);
  const handled = await service.handleMessage(message as any);

  assert.equal(handled, true);
  assert.equal(registered, false);
  assert.match(replyPayload?.content ?? "", /Team logo is required/);
});

test("duplicate registration reacts with warning instead of accepted", async () => {
  const reactions: string[] = [];
  const manager = {
    id: "123456789012345678",
    username: "manager",
    globalName: "Manager",
    bot: false,
  };
  const message = {
    author: {
      id: "123456789012345678",
      username: "manager",
      globalName: "Manager",
      bot: false,
      tag: "manager",
    },
    content: "%register\nHORUS ESPORTS\nHORUS\n<@123456789012345678>",
    guild: { id: "guild-1" },
    channel: { id: "registration-channel" },
    member: {
      permissions: { has: () => false },
      roles: {
        cache: { has: () => false, some: () => false },
      },
    },
    mentions: {
      users: new Map([[manager.id, manager]]),
      channels: { first: () => null },
    },
    attachments: { find: () => undefined },
    client: { user: { id: "bot-1" } },
    reactions: {
      resolve: () => ({
        users: { remove: async () => undefined },
      }),
    },
    react: async (emoji: string) => {
      reactions.push(emoji);
    },
    reply: async () => undefined,
  };
  const sessionService = {
    findScrimForRegistrationChannel: async () => ({
      accepting: true,
      session: { id: "session-1", name: "Scrim Registration" },
      config: {
        organizationId: "org-1",
        registrationMode: "SCRIM",
        manageRoleIds: [],
        emojis: { check: "\u2705", warning: "\u26A0\uFE0F" },
      },
    }),
    registerTeamAndJoinScrim: async (...args: unknown[]) => {
      const options = args[10] as {
        onSessionRegistration?: (result: unknown) => Promise<void>;
      };
      await options.onSessionRegistration?.({
        registration: {
          status: "CONFIRMED",
          slotNumber: 1,
          waitlistPosition: null,
        },
        status: "already registered",
        warning: null,
      });
      return "Already registered";
    },
  };

  const service = new MessageRegistrationService(sessionService as any);
  const handled = await service.handleMessage(message as any);

  assert.equal(handled, true);
  assert.deepEqual(reactions, ["\u23F3", "\u26A0\uFE0F"]);
});

test("duplicate registration ignores generic lock warning emoji", async () => {
  const reactions: string[] = [];
  const manager = {
    id: "123456789012345678",
    username: "manager",
    globalName: "Manager",
    bot: false,
  };
  const message = {
    author: {
      id: "123456789012345678",
      username: "manager",
      globalName: "Manager",
      bot: false,
      tag: "manager",
    },
    content: "%register\nHORUS ESPORTS\nHORUS\n<@123456789012345678>",
    guild: { id: "guild-1" },
    channel: { id: "registration-channel" },
    member: {
      permissions: { has: () => false },
      roles: {
        cache: { has: () => false, some: () => false },
      },
    },
    mentions: {
      users: new Map([[manager.id, manager]]),
      channels: { first: () => null },
    },
    attachments: { find: () => undefined },
    client: { user: { id: "bot-1" } },
    reactions: {
      resolve: () => ({
        users: { remove: async () => undefined },
      }),
    },
    react: async (emoji: string) => {
      reactions.push(emoji);
    },
    reply: async () => undefined,
  };
  const sessionService = {
    findScrimForRegistrationChannel: async () => ({
      accepting: true,
      session: { id: "session-1", name: "Scrim Registration" },
      config: {
        organizationId: "org-1",
        registrationMode: "SCRIM",
        manageRoleIds: [],
        emojis: {
          check: "\u2705",
          warning: "<:white_lock:1370123022312280194>",
        },
      },
    }),
    registerTeamAndJoinScrim: async (...args: unknown[]) => {
      const options = args[10] as {
        onSessionRegistration?: (result: unknown) => Promise<void>;
      };
      await options.onSessionRegistration?.({
        registration: {
          status: "CONFIRMED",
          slotNumber: 1,
          waitlistPosition: null,
        },
        status: "already registered",
        warning: null,
      });
      return "Already registered";
    },
  };

  const service = new MessageRegistrationService(sessionService as any);
  const handled = await service.handleMessage(message as any);

  assert.equal(handled, true);
  assert.deepEqual(reactions, ["\u23F3", "\u26A0\uFE0F"]);
});

test("registration resolves raw manager mentions when Discord omits mention payload", async () => {
  let capturedArgs: unknown[] | null = null;
  const manager = {
    id: "123456789012345678",
    username: "manager",
    globalName: "Manager",
    bot: false,
  };
  const message = {
    author: {
      id: "222222222222222222",
      username: "captain",
      globalName: "Captain",
      bot: false,
      tag: "captain",
    },
    content: "%register\nHORUS ESPORTS\nHORUS\n<@123456789012345678>",
    guild: {
      id: "guild-1",
      members: {
        fetch: async ({ user }: { user: string }) =>
          user === manager.id ? { user: manager } : null,
      },
    },
    channel: { id: "registration-channel" },
    member: {
      permissions: { has: () => false },
      roles: {
        cache: { has: () => false, some: () => false },
      },
    },
    mentions: {
      users: new Map(),
      channels: { first: () => null },
    },
    attachments: { find: () => undefined },
    client: { user: { id: "bot-1" } },
    reactions: {
      resolve: () => ({
        users: { remove: async () => undefined },
      }),
    },
    react: async () => undefined,
    reply: async () => undefined,
  };
  const sessionService = {
    findScrimForRegistrationChannel: async () => ({
      accepting: true,
      session: { id: "session-1", name: "Scrim Registration" },
      config: {
        organizationId: "org-1",
        registrationMode: "SCRIM",
        manageRoleIds: [],
        emojis: { check: "\u2705" },
      },
    }),
    registerTeamAndJoinScrim: async (...args: unknown[]) => {
      capturedArgs = args;
      return "Team registered";
    },
  };

  const service = new MessageRegistrationService(sessionService as any);
  const handled = await service.handleMessage(message as any);

  assert.equal(handled, true);
  assert.ok(capturedArgs);
  assert.equal(capturedArgs[0], "222222222222222222");
  assert.deepEqual(capturedArgs[5], [
    {
      discordUserId: manager.id,
      discordUsername: manager.username,
      displayName: manager.globalName,
      role: "LEADER",
    },
  ]);
});

test("tournament registration channel rejects percent-register format", async () => {
  let registered = false;
  let replyPayload: unknown = null;
  const manager = {
    id: "123456789012345678",
    username: "manager",
    globalName: "Manager",
    bot: false,
  };
  const message = {
    author: {
      id: "123456789012345678",
      username: "manager",
      globalName: "Manager",
      bot: false,
      tag: "manager",
    },
    content: "%register\nHORUS ESPORTS\nHORUS\n<@123456789012345678>",
    guild: { id: "guild-1" },
    channel: { id: "registration-channel" },
    member: {
      permissions: { has: () => false },
      roles: {
        cache: { has: () => false, some: () => false },
      },
    },
    mentions: {
      users: new Map([[manager.id, manager]]),
      channels: { first: () => null },
    },
    attachments: { find: () => undefined },
    client: { user: { id: "bot-1" } },
    reactions: {
      resolve: () => ({
        users: { remove: async () => undefined },
      }),
    },
    react: async () => undefined,
    reply: async (payload: unknown) => {
      replyPayload = payload;
      return { delete: async () => undefined };
    },
  };
  const sessionService = {
    findScrimForRegistrationChannel: async () => ({
      accepting: true,
      session: { id: "session-1", name: "Tournament Registration" },
      config: {
        organizationId: "org-1",
        registrationMode: "TOURNAMENT",
        manageRoleIds: [],
        emojis: {},
      },
    }),
    registerTeamAndJoinScrim: async () => {
      registered = true;
      return "Should not happen";
    },
  };

  const service = new MessageRegistrationService(sessionService as any);
  const handled = await service.handleMessage(message as any);

  assert.equal(handled, true);
  assert.equal(registered, false);
  assert.match(String(replyPayload), /team tag: TEAMTAG/);
  assert.match(String(replyPayload), /team manager: @manager/);
});

test("scrim registration channel rejects tournament pipe format", async () => {
  let registered = false;
  let replyPayload: unknown = null;
  const manager = {
    id: "123456789012345678",
    username: "manager",
    globalName: "Manager",
    bot: false,
  };
  const message = {
    author: {
      id: "123456789012345678",
      username: "manager",
      globalName: "Manager",
      bot: false,
      tag: "manager",
    },
    content: "HORUS ESPORTS | HORUS | <@123456789012345678>",
    guild: { id: "guild-1" },
    channel: { id: "registration-channel" },
    member: {
      permissions: { has: () => false },
      roles: {
        cache: { has: () => false, some: () => false },
      },
    },
    mentions: {
      users: new Map([[manager.id, manager]]),
      channels: { first: () => null },
    },
    attachments: { find: () => undefined },
    client: { user: { id: "bot-1" } },
    reactions: {
      resolve: () => ({
        users: { remove: async () => undefined },
      }),
    },
    react: async () => undefined,
    reply: async (payload: unknown) => {
      replyPayload = payload;
      return { delete: async () => undefined };
    },
  };
  const sessionService = {
    findScrimForRegistrationChannel: async () => ({
      accepting: true,
      session: { id: "session-1", name: "Scrim Registration" },
      config: {
        organizationId: "org-1",
        registrationMode: "SCRIM",
        manageRoleIds: [],
        emojis: {},
      },
    }),
    registerTeamAndJoinScrim: async () => {
      registered = true;
      return "Should not happen";
    },
  };

  const service = new MessageRegistrationService(sessionService as any);
  const handled = await service.handleMessage(message as any);

  assert.equal(handled, true);
  assert.equal(registered, false);
  assert.match(String(replyPayload), /%register/);
});

test("logo command in synced logo channel updates the saved team logo", async (t) => {
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
    arrayBuffer: async () => Uint8Array.of(1, 2, 3).buffer,
  });

  let uploadedTeamName: string | null = null;
  let uploadedLogo: any = null;
  let uploadedSource: any = null;
  let refreshedSessionId: string | null = null;
  let refreshedGuildId: string | null = null;
  let replyPayload: any = null;
  const message = {
    id: "logo-message-1",
    author: {
      id: "manager-1",
      username: "manager",
      globalName: "Manager",
      bot: false,
      tag: "manager",
    },
    content: "%logo\nTeam DXB",
    guild: { id: "guild-1" },
    channel: { id: "111111111111111111" },
    mentions: {
      users: new Map(),
      channels: { first: () => null },
    },
    attachments: {
      find: () => ({
        id: "attachment-1",
        url: "https://cdn.discordapp.com/team-logo.png",
        name: "team-logo.png",
        contentType: "image/png",
        size: 3,
      }),
    },
    client: { user: { id: "bot-1" } },
    reactions: {
      resolve: () => ({
        users: { remove: async () => undefined },
      }),
    },
    react: async () => undefined,
    reply: async (payload: any) => {
      replyPayload = payload;
    },
  };
  const sessionService = {
    findScrimForLogoChannel: async (guildId: string, channelId: string) => ({
      session: { id: "session-1" },
      config: {
        sessionId: "session-1",
        guildId,
        manageRoleIds: [],
        emojis: { discordLogoChannelIds: channelId },
      },
    }),
    updateTeamLogoFromDiscord: async (
      teamName: string,
      logoUpload: unknown,
      _config: unknown,
      source: unknown,
    ) => {
      uploadedTeamName = teamName;
      uploadedLogo = logoUpload;
      uploadedSource = source;
      return "Logo saved for Team DXB.";
    },
    queueVisibleDiscordScrimRefresh: (
      guild: { id: string },
      sessionId: string,
    ) => {
      refreshedGuildId = guild.id;
      refreshedSessionId = sessionId;
    },
    queueVisibleDiscordScrimRefreshForActiveGuildSessions: async (
      guild: { id: string },
      config: { sessionId?: string },
    ) => {
      refreshedGuildId = guild.id;
      refreshedSessionId = config.sessionId ?? null;
    },
  };

  const service = new MessageRegistrationService(sessionService as any);
  const handled = await service.handleMessage(message as any);

  assert.equal(handled, true);
  assert.equal(uploadedTeamName, "Team DXB");
  assert.equal(uploadedLogo?.contentType, "image/png");
  assert.equal(uploadedLogo?.filename, "team-logo.png");
  assert.equal(uploadedSource?.channelId, "111111111111111111");
  assert.equal(uploadedSource?.messageId, "logo-message-1");
  assert.equal(uploadedSource?.attachmentId, "attachment-1");
  assert.equal(replyPayload?.content, "Logo saved for Team DXB.");
  assert.equal(refreshedGuildId, "guild-1");
  assert.equal(refreshedSessionId, "session-1");
});

test("sync old logos command scans the current synced logo channel", async () => {
  let requested: any = null;
  let refreshedSessionId: string | null = null;
  let replyPayload: any = null;
  const message = {
    id: "sync-old-logos-message-1",
    author: {
      id: "staff-1",
      username: "staff",
      globalName: "Staff",
      bot: false,
      tag: "staff",
    },
    member: {
      permissions: { has: () => true },
      roles: { cache: { has: () => false, some: () => false } },
    },
    content: "%sync-old-logos 250",
    guild: { id: "guild-1" },
    channel: { id: "111111111111111111" },
    mentions: {
      users: new Map(),
      channels: { first: () => null },
    },
    attachments: { find: () => undefined },
    client: { user: { id: "bot-1" } },
    reactions: {
      resolve: () => ({
        users: { remove: async () => undefined },
      }),
    },
    react: async () => undefined,
    reply: async (payload: any) => {
      replyPayload = payload;
    },
  };
  const sessionService = {
    findScrimForLogoChannel: async (guildId: string, channelId: string) => ({
      session: { id: "session-1" },
      config: {
        organizationId: "org-1",
        guildId,
        manageRoleIds: [],
        emojis: { discordLogoChannelIds: channelId },
      },
    }),
    syncOldDiscordLogos: async (params: any) => {
      requested = params;
      return {
        ok: true,
        sessionId: "session-1",
        guildId: "guild-1",
        channelIds: ["111111111111111111"],
        limit: params.limit,
        scanned: 250,
        matched: 10,
        saved: 6,
        pending: 3,
        backfilled: 2,
        skipped: 1,
        failed: 0,
        failures: [],
      };
    },
    queueVisibleDiscordScrimRefresh: (
      _guild: { id: string },
      sessionId: string,
    ) => {
      refreshedSessionId = sessionId;
    },
  };

  const service = new MessageRegistrationService(sessionService as any);
  const handled = await service.handleMessage(message as any);

  assert.equal(handled, true);
  assert.deepEqual(requested, {
    sessionId: "session-1",
    organizationId: "org-1",
    channelId: "111111111111111111",
    limit: 250,
  });
  assert.match(replyPayload?.content, /Scanned: 250/);
  assert.match(replyPayload?.content, /Saved to teams: 6/);
  assert.match(replyPayload?.content, /Backfilled active teams: 2/);
  assert.equal(refreshedSessionId, "session-1");
});

test("player photo command in tournament mode uploads by uid", async (t) => {
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
    arrayBuffer: async () => Uint8Array.of(1, 2, 3).buffer,
  });

  let uploadedPayload: any = null;
  let uploadedPhoto: any = null;
  let refreshedSessionId: string | null = null;
  let replyPayload: any = null;
  const message = {
    id: "photo-message-1",
    author: {
      id: "manager-1",
      username: "manager",
      globalName: "Manager",
      bot: false,
      tag: "manager",
    },
    content: "%photo\n111111",
    guild: { id: "guild-1" },
    channel: { id: "333333333333333333" },
    mentions: {
      users: new Map(),
      channels: { first: () => null },
    },
    attachments: {
      find: () => ({
        id: "attachment-1",
        url: "https://cdn.discordapp.com/player-photo.png",
        name: "player-photo.png",
        contentType: "image/png",
        size: 3,
      }),
    },
    client: { user: { id: "bot-1" } },
    reactions: {
      resolve: () => ({
        users: { remove: async () => undefined },
      }),
    },
    react: async () => undefined,
    reply: async (payload: any) => {
      replyPayload = payload;
    },
  };
  const sessionService = {
    findScrimForPlayerPhotoChannel: async (
      guildId: string,
      channelId: string,
    ) => ({
      session: { id: "session-1", name: "Arenzyra Tournament" },
      config: {
        organizationId: "org-1",
        sessionId: "session-1",
        guildId,
        registrationMode: "TOURNAMENT",
        manageRoleIds: [],
        emojis: { discordPlayerPhotoChannelIds: channelId },
      },
    }),
    updatePlayerPhotoFromDiscord: async (payload: unknown, photo: unknown) => {
      uploadedPayload = payload;
      uploadedPhoto = photo;
      return "Player photo saved.";
    },
    queueVisibleDiscordScrimRefresh: (
      _guild: { id: string },
      sessionId: string,
    ) => {
      refreshedSessionId = sessionId;
    },
  };

  const service = new MessageRegistrationService(sessionService as any);
  const handled = await service.handleMessage(message as any);

  assert.equal(handled, true);
  assert.deepEqual(uploadedPayload, {
    uid: "111111",
    teamName: null,
    playerName: null,
  });
  assert.equal(uploadedPhoto?.contentType, "image/png");
  assert.equal(uploadedPhoto?.filename, "player-photo.png");
  assert.equal(replyPayload?.content, "Player photo saved.");
  assert.equal(refreshedSessionId, "session-1");
});

test("staff can clean all slots from the synced slot-list channel", async () => {
  let cleanedSessionId: string | null = null;
  let confirmationPrompt: string | null = null;
  let buttonDeferred = false;
  let editedReply: string | null = null;
  let commandDeleted = false;
  let promptCreated!: () => void;
  const promptReady = new Promise<void>((resolve) => {
    promptCreated = resolve;
  });
  const message = {
    id: "message-1",
    author: {
      id: "staff-1",
      username: "staff",
      globalName: "Staff",
      bot: false,
      tag: "staff",
    },
    content: "%clean-All-slots",
    guild: { id: "guild-1" },
    channel: { id: "slot-list-channel" },
    member: {
      permissions: { has: () => true },
      roles: {
        cache: {
          has: () => false,
          some: () => false,
        },
      },
    },
    mentions: {
      users: new Map(),
      channels: { first: () => null },
    },
    client: { user: { id: "bot-1" } },
    delete: async () => {
      commandDeleted = true;
    },
    reply: async (payload: { content?: string }) => {
      confirmationPrompt = payload.content ?? "";
      promptCreated();
      return {
        content: payload.content,
        edit: async (editPayload: string | { content?: string }) => {
          editedReply =
            typeof editPayload === "string"
              ? editPayload
              : (editPayload.content ?? "");
          return { delete: async () => undefined };
        },
        delete: async () => undefined,
      };
    },
  };
  const sessionService = {
    findScrimForSlotListChannel: async () => ({
      session: { id: "session-1" },
      config: {
        manageRoleIds: [],
        emojis: {},
      },
    }),
    cleanAllSlotsFromScrim: async (sessionId: string) => {
      cleanedSessionId = sessionId;
      return "Cleaned all assigned slots (#3, #4): 2 teams removed.";
    },
  };

  const service = new MessageRegistrationService(sessionService as any);
  const handledPromise = service.handleMessage(message as any);
  await promptReady;
  await new Promise((resolve) => setImmediate(resolve));
  const buttonHandled = await service.handleButton({
    customId: "destructive:clean-all-slots:confirm:message-1",
    user: { id: "staff-1" },
    deferUpdate: async () => {
      buttonDeferred = true;
    },
  } as any);
  const handled = await handledPromise;

  assert.equal(handled, true);
  assert.equal(buttonHandled, true);
  assert.match(confirmationPrompt ?? "", /Clean all assigned slots/);
  assert.equal(buttonDeferred, true);
  assert.equal(cleanedSessionId, "session-1");
  assert.equal(commandDeleted, true);
  assert.equal(
    editedReply,
    "Cleaned all assigned slots (#3, #4): 2 teams removed.",
  );
});

test("staff can clean waitlist from the synced waitlist channel", async () => {
  let cleanedSessionId: string | null = null;
  let confirmationPrompt: string | null = null;
  let buttonDeferred = false;
  let editedReply: string | null = null;
  let commandDeleted = false;
  let promptCreated!: () => void;
  const promptReady = new Promise<void>((resolve) => {
    promptCreated = resolve;
  });
  const message = {
    id: "message-1",
    author: {
      id: "staff-1",
      username: "staff",
      globalName: "Staff",
      bot: false,
      tag: "staff",
    },
    content: "%clean-waitlist",
    guild: { id: "guild-1" },
    channel: { id: "waitlist-channel" },
    member: {
      permissions: { has: () => true },
      roles: {
        cache: {
          has: () => false,
          some: () => false,
        },
      },
    },
    mentions: {
      users: new Map(),
      channels: { first: () => null },
    },
    client: { user: { id: "bot-1" } },
    delete: async () => {
      commandDeleted = true;
    },
    reply: async (payload: { content?: string }) => {
      confirmationPrompt = payload.content ?? "";
      promptCreated();
      return {
        content: payload.content,
        edit: async (editPayload: string | { content?: string }) => {
          editedReply =
            typeof editPayload === "string"
              ? editPayload
              : (editPayload.content ?? "");
          return { delete: async () => undefined };
        },
        delete: async () => undefined,
      };
    },
  };
  const sessionService = {
    findScrimForDiscordChannel: async () => ({
      session: { id: "session-1", name: "Daily Scrim" },
      config: {
        organizationId: "org-1",
        manageRoleIds: [],
        emojis: {},
      },
      channelKind: "waitlist",
    }),
    cleanWaitlistFromScrim: async (sessionId: string) => {
      cleanedSessionId = sessionId;
      return "Cleaned waitlist (#1, #2): 2 teams removed.";
    },
  };

  const service = new MessageRegistrationService(sessionService as any);
  const handledPromise = service.handleMessage(message as any);
  await promptReady;
  await new Promise((resolve) => setImmediate(resolve));
  const buttonHandled = await service.handleButton({
    customId: "destructive:clean-waitlist:confirm:message-1",
    user: { id: "staff-1" },
    deferUpdate: async () => {
      buttonDeferred = true;
    },
  } as any);
  const handled = await handledPromise;

  assert.equal(handled, true);
  assert.equal(buttonHandled, true);
  assert.match(confirmationPrompt ?? "", /Clean waitlist/);
  assert.equal(buttonDeferred, true);
  assert.equal(cleanedSessionId, "session-1");
  assert.equal(commandDeleted, true);
  assert.equal(editedReply, "Cleaned waitlist (#1, #2): 2 teams removed.");
});

test("expired destructive confirmation buttons are handled", async () => {
  let replyPayload: any = null;
  const service = new MessageRegistrationService({} as any);

  const handled = await service.handleButton({
    customId: "destructive:clean-slot-7:confirm:message-1",
    user: { id: "staff-1" },
    reply: async (payload: any) => {
      replyPayload = payload;
      return payload;
    },
  } as any);

  assert.equal(handled, true);
  assert.match(replyPayload.content, /confirmation expired/i);
  assert.equal(replyPayload.ephemeral, true);
});

test("confirm slot command resolves the scrim and confirms by slot number", async () => {
  let organizationContext: string | null = null;
  let confirmArgs: any[] | null = null;
  let replyPayload: any = null;
  let commandDeleted = false;
  const message = {
    author: {
      id: "manager-1",
      username: "manager",
      globalName: "Manager",
      bot: false,
      tag: "manager",
    },
    content: "%cofirrm slot 22",
    guild: { id: "guild-1" },
    channel: { id: "slot-list-channel" },
    mentions: {
      users: new Map(),
      channels: { first: () => null },
    },
    client: { user: { id: "bot-1" } },
    delete: async () => {
      commandDeleted = true;
    },
    reply: async (payload: any) => {
      replyPayload = payload;
      return { delete: async () => undefined };
    },
  };
  const sessionService = {
    findScrimForDiscordChannel: async () => ({
      session: { id: "session-1", name: "Daily Scrim" },
      channelKind: "slot-list",
      config: {
        organizationId: "org-1",
        manageRoleIds: [],
        emojis: {},
      },
    }),
    withOrganization: async (
      organizationId: string,
      fn: () => Promise<string>,
    ) => {
      organizationContext = organizationId;
      return fn();
    },
    confirmSlotFromDiscord: async (...args: any[]) => {
      confirmArgs = args;
      return "Confirmed slot #22 for TEAM.";
    },
  };

  const service = new MessageRegistrationService(sessionService as any);
  const handled = await service.handleMessage(message as any);

  assert.equal(handled, true);
  assert.equal(organizationContext, "org-1");
  assert.ok(confirmArgs);
  assert.equal(confirmArgs[0], "manager-1");
  assert.equal(confirmArgs[2], 22);
  assert.equal(confirmArgs[4], "session-1");
  assert.equal(replyPayload.content, "Confirmed slot #22 for TEAM.");
  assert.deepEqual(replyPayload.allowedMentions, { parse: [] });
  assert.equal(commandDeleted, true);
});

test("staff can open registration from the synced registration channel", async () => {
  let organizationContext: string | null = null;
  let stateArgs: unknown[] | null = null;
  let sentPayload: any = null;
  let commandDeleted = false;
  const previousConfirmation = {
    author: { id: "bot-1" },
    content: "CHECK Registration is closed.",
    pinned: false,
    delete: async () => {
      previousDeleted = true;
    },
  };
  let previousDeleted = false;
  const message = {
    author: {
      id: "staff-1",
      username: "staff",
      globalName: "Staff",
      bot: false,
      tag: "staff",
    },
    content: "!open",
    guild: { id: "guild-1" },
    channel: {
      id: "registration-channel",
      messages: {
        fetch: async () =>
          new Collection([
            [previousConfirmation.content, previousConfirmation],
          ]),
      },
      send: async (payload: any) => {
        sentPayload = payload;
      },
    },
    member: {
      permissions: { has: () => true },
      roles: {
        cache: {
          has: () => false,
          some: () => false,
        },
      },
    },
    client: { user: { id: "bot-1" } },
    delete: async () => {
      commandDeleted = true;
    },
    reply: async () => undefined,
  };
  const sessionService = {
    findScrimForRegistrationChannel: async () => ({
      session: { id: "session-1", name: "Daily Scrim" },
      accepting: false,
      config: {
        organizationId: "org-1",
        manageRoleIds: [],
        emojis: {},
      },
    }),
    withOrganization: async (
      organizationId: string,
      fn: () => Promise<string>,
    ) => {
      organizationContext = organizationId;
      return fn();
    },
    setRegistrationChannelState: async (...args: unknown[]) => {
      stateArgs = args;
      return "CHECK Registration is open.";
    },
  };

  const service = new MessageRegistrationService(sessionService as any);
  const handled = await service.handleMessage(message as any);

  assert.equal(handled, true);
  assert.equal(organizationContext, "org-1");
  assert.ok(stateArgs);
  assert.equal(stateArgs[1], "session-1");
  assert.equal(stateArgs[2], "open");
  assert.equal(commandDeleted, true);
  assert.equal(previousDeleted, true);
  assert.equal(sentPayload.content, "CHECK Registration is open.");
});

test("staff can close registration with the short close command", async () => {
  let organizationContext: string | null = null;
  let stateArgs: unknown[] | null = null;
  let sentPayload: any = null;
  let commandDeleted = false;
  let previousDeleted = false;
  const previousConfirmation = {
    author: { id: "bot-1" },
    content: "CHECK Registration is open.",
    pinned: false,
    delete: async () => {
      previousDeleted = true;
    },
  };
  const message = {
    author: {
      id: "staff-1",
      username: "staff",
      globalName: "Staff",
      bot: false,
      tag: "staff",
    },
    content: "!close",
    guild: { id: "guild-1" },
    channel: {
      id: "registration-channel",
      messages: {
        fetch: async () =>
          new Collection([
            [previousConfirmation.content, previousConfirmation],
          ]),
      },
      send: async (payload: any) => {
        sentPayload = payload;
      },
    },
    member: {
      permissions: { has: () => true },
      roles: {
        cache: {
          has: () => false,
          some: () => false,
        },
      },
    },
    client: { user: { id: "bot-1" } },
    delete: async () => {
      commandDeleted = true;
    },
    reply: async () => undefined,
  };
  const sessionService = {
    findScrimForRegistrationChannel: async () => ({
      session: { id: "session-1", name: "Daily Scrim" },
      accepting: true,
      config: {
        organizationId: "org-1",
        manageRoleIds: [],
        emojis: {},
      },
    }),
    withOrganization: async (
      organizationId: string,
      fn: () => Promise<string>,
    ) => {
      organizationContext = organizationId;
      return fn();
    },
    setRegistrationChannelState: async (...args: unknown[]) => {
      stateArgs = args;
      return "REJECT Registration is closed.";
    },
  };

  const service = new MessageRegistrationService(sessionService as any);
  const handled = await service.handleMessage(message as any);

  assert.equal(handled, true);
  assert.equal(organizationContext, "org-1");
  assert.ok(stateArgs);
  assert.equal(stateArgs[1], "session-1");
  assert.equal(stateArgs[2], "closed");
  assert.equal(commandDeleted, true);
  assert.equal(previousDeleted, true);
  assert.equal(sentPayload.content, "REJECT Registration is closed.");
});

test("staff can open waitlist promotion from the synced waitlist channel", async () => {
  let organizationContext: string | null = null;
  let stateArgs: unknown[] | null = null;
  let sentPayload: any = null;
  let commandDeleted = false;
  let previousDeleted = false;
  const previousConfirmation = {
    author: { id: "bot-1" },
    content: "REJECT Waitlist promotion is closed.",
    pinned: false,
    delete: async () => {
      previousDeleted = true;
    },
  };
  const message = {
    author: {
      id: "staff-1",
      username: "staff",
      globalName: "Staff",
      bot: false,
      tag: "staff",
    },
    content: "%open-waitlist",
    guild: { id: "guild-1" },
    channel: {
      id: "waitlist-channel",
      messages: {
        fetch: async () =>
          new Collection([
            [previousConfirmation.content, previousConfirmation],
          ]),
      },
      send: async (payload: any) => {
        sentPayload = payload;
      },
    },
    member: {
      permissions: { has: () => true },
      roles: {
        cache: {
          has: () => false,
          some: () => false,
        },
      },
    },
    client: { user: { id: "bot-1" } },
    delete: async () => {
      commandDeleted = true;
    },
    reply: async () => undefined,
  };
  const sessionService = {
    findScrimForWaitlistChannel: async () => ({
      session: { id: "session-1", name: "Daily Scrim" },
      accepting: false,
      config: {
        organizationId: "org-1",
        manageRoleIds: [],
        emojis: {},
      },
    }),
    withOrganization: async (
      organizationId: string,
      fn: () => Promise<string>,
    ) => {
      organizationContext = organizationId;
      return fn();
    },
    setWaitlistPromotionChannelState: async (...args: unknown[]) => {
      stateArgs = args;
      return "CHECK Waitlist promotion is open.";
    },
  };

  const service = new MessageRegistrationService(sessionService as any);
  const handled = await service.handleMessage(message as any);

  assert.equal(handled, true);
  assert.equal(organizationContext, "org-1");
  assert.ok(stateArgs);
  assert.equal(stateArgs[1], "session-1");
  assert.equal(stateArgs[2], "open");
  assert.equal(commandDeleted, true);
  assert.equal(previousDeleted, true);
  assert.equal(sentPayload.content, "CHECK Waitlist promotion is open.");
});

test("normal users cannot close registration from the registration channel", async () => {
  let called = false;
  let sentPayload: any = null;
  let commandDeleted = false;
  const message = {
    author: {
      id: "user-1",
      username: "user",
      globalName: "User",
      bot: false,
      tag: "user",
    },
    content: "!closed",
    guild: { id: "guild-1" },
    channel: {
      id: "registration-channel",
      send: async (payload: any) => {
        sentPayload = payload;
        return {
          ...payload,
          delete: async () => undefined,
        };
      },
    },
    member: {
      permissions: { has: () => false },
      roles: {
        cache: {
          has: () => false,
          some: () => false,
        },
      },
    },
    delete: async () => {
      commandDeleted = true;
    },
    reply: async () => undefined,
  };
  const sessionService = {
    findScrimForRegistrationChannel: async () => ({
      session: { id: "session-1", name: "Daily Scrim" },
      accepting: true,
      config: {
        organizationId: "org-1",
        manageRoleIds: [],
        emojis: {},
      },
    }),
    setRegistrationChannelState: async () => {
      called = true;
      return "Should not happen";
    },
  };

  const service = new MessageRegistrationService(sessionService as any);
  const handled = await service.handleMessage(message as any);

  assert.equal(handled, true);
  assert.equal(called, false);
  assert.equal(commandDeleted, true);
  assert.equal(
    sentPayload.content,
    "Only Arenzyra staff can open or close registration.",
  );
});

test("team managers can add a session manager from the synced transfer channel", async () => {
  const newManager = {
    id: "222222222222222222",
    username: "new-manager",
    globalName: "New Manager",
    bot: false,
  };
  let organizationContext: string | null = null;
  let addArgs: any[] | undefined;
  let commandDeleted = false;
  let sentPayload: any = null;
  const message = {
    author: {
      id: "111111111111111111",
      username: "captain",
      globalName: "Captain",
      bot: false,
      tag: "captain",
    },
    content: "%manager\nDXB\n<@222222222222222222>",
    guild: { id: "guild-1" },
    channel: {
      id: "transfer-channel",
      send: async (payload: any) => {
        sentPayload = payload;
      },
    },
    member: {
      permissions: { has: () => false },
      roles: {
        cache: {
          has: () => false,
          some: () => false,
        },
      },
    },
    mentions: {
      users: new Map([[newManager.id, newManager]]),
      channels: { first: () => null },
    },
    client: { user: { id: "bot-1" } },
    delete: async () => {
      commandDeleted = true;
    },
    reply: async () => undefined,
  };
  const sessionService = {
    findScrimForDiscordChannel: async () => ({
      session: { id: "session-1", name: "Daily Scrim" },
      channelKind: "transfer",
      config: {
        organizationId: "org-1",
        manageRoleIds: [],
        emojis: {},
      },
    }),
    withOrganization: async (
      organizationId: string,
      fn: () => Promise<string>,
    ) => {
      organizationContext = organizationId;
      return fn();
    },
    addSessionTeamManager: async (...args: any[]) => {
      addArgs = args;
      return `Manager added <@${newManager.id}>`;
    },
  };

  const service = new MessageRegistrationService(sessionService as any);
  const handled = await service.handleMessage(message as any);

  assert.equal(handled, true);
  assert.equal(organizationContext, "org-1");
  assert.equal(commandDeleted, true);
  assert.ok(addArgs);
  const capturedAddArgs = addArgs;
  assert.equal(capturedAddArgs[1], "session-1");
  assert.equal(capturedAddArgs[2], "DXB");
  assert.equal(capturedAddArgs[3].discordUserId, newManager.id);
  assert.equal(capturedAddArgs[3].role, "LEADER");
  assert.equal(capturedAddArgs[4].requesterDiscordId, "111111111111111111");
  assert.equal(capturedAddArgs[4].staffBypass, false);
  assert.equal(sentPayload.content, `Manager added <@${newManager.id}>`);
  assert.deepEqual(sentPayload.allowedMentions?.users, [newManager.id]);
});

test("team managers can remove a session manager from the synced transfer channel", async () => {
  const removedManager = {
    id: "222222222222222222",
    username: "old-manager",
    globalName: "Old Manager",
    bot: false,
  };
  let removeArgs: any[] | undefined;
  let commandDeleted = false;
  let sentPayload: any = null;
  const message = {
    author: {
      id: "111111111111111111",
      username: "captain",
      globalName: "Captain",
      bot: false,
      tag: "captain",
    },
    content: "%remove\nDXB\n<@222222222222222222>",
    guild: { id: "guild-1" },
    channel: {
      id: "transfer-channel",
      send: async (payload: any) => {
        sentPayload = payload;
      },
    },
    member: {
      permissions: { has: () => false },
      roles: {
        cache: {
          has: () => false,
          some: () => false,
        },
      },
    },
    mentions: {
      users: new Map([[removedManager.id, removedManager]]),
      channels: { first: () => null },
    },
    client: { user: { id: "bot-1" } },
    delete: async () => {
      commandDeleted = true;
    },
    reply: async () => undefined,
  };
  const sessionService = {
    findScrimForDiscordChannel: async () => ({
      session: { id: "session-1", name: "Daily Scrim" },
      channelKind: "transfer",
      config: {
        organizationId: "org-1",
        manageRoleIds: [],
        emojis: {},
      },
    }),
    withOrganization: async (
      _organizationId: string,
      fn: () => Promise<string>,
    ) => fn(),
    removeSessionTeamManager: async (...args: any[]) => {
      removeArgs = args;
      return `Manager removed <@${removedManager.id}>`;
    },
  };

  const service = new MessageRegistrationService(sessionService as any);
  const handled = await service.handleMessage(message as any);

  assert.equal(handled, true);
  assert.equal(commandDeleted, true);
  assert.ok(removeArgs);
  const capturedRemoveArgs = removeArgs;
  assert.equal(capturedRemoveArgs[1], "session-1");
  assert.equal(capturedRemoveArgs[2], "DXB");
  assert.equal(capturedRemoveArgs[3], removedManager.id);
  assert.equal(capturedRemoveArgs[4].requesterDiscordId, "111111111111111111");
  assert.equal(sentPayload.content, `Manager removed <@${removedManager.id}>`);
  assert.deepEqual(sentPayload.allowedMentions?.users, [removedManager.id]);
});

test("staff can pause and resume bot activity in any server channel", async () => {
  const channelId = "123456789012345678";
  let organizationContext: string | null | undefined = null;
  const pauseCalls: Array<{
    guildId: string;
    channelId: string;
    paused: boolean;
  }> = [];
  let commandDeleted = 0;
  let sentPayload: any = null;
  let previousDeleted = false;
  const previousConfirmation = {
    author: { id: "bot-1" },
    content: "Arenzyra bot is now active in this channel.",
    pinned: false,
    delete: async () => {
      previousDeleted = true;
    },
  };
  const baseMessage = {
    author: {
      id: "staff-1",
      username: "staff",
      globalName: "Staff",
      bot: false,
      tag: "staff",
    },
    guild: { id: "guild-1" },
    channel: {
      id: channelId,
      messages: {
        fetch: async () =>
          new Collection([
            [previousConfirmation.content, previousConfirmation],
          ]),
      },
      send: async (payload: any) => {
        sentPayload = payload;
      },
    },
    member: {
      permissions: { has: () => true },
      roles: {
        cache: {
          has: () => false,
          some: () => false,
        },
      },
    },
    client: { user: { id: "bot-1" } },
    delete: async () => {
      commandDeleted += 1;
    },
    reply: async () => undefined,
  };
  const sessionService = {
    findScrimForDiscordChannel: async () => null,
    findScrimForLogoChannel: async () => null,
    withOrganization: async (
      organizationId: string | undefined,
      fn: () => Promise<any>,
    ) => {
      organizationContext = organizationId;
      return fn();
    },
    setDiscordChannelPaused: async (
      guildId: string,
      targetChannelId: string,
      paused: boolean,
    ) => {
      pauseCalls.push({ guildId, channelId: targetChannelId, paused });
      return {
        guildId,
        channelId: targetChannelId,
        paused,
      };
    },
  };

  const service = new MessageRegistrationService(sessionService as any);
  const stopped = await service.handleMessage({
    ...baseMessage,
    content: "%stop",
  } as any);
  const started = await service.handleMessage({
    ...baseMessage,
    content: "%start",
  } as any);

  assert.equal(stopped, true);
  assert.equal(started, true);
  assert.equal(organizationContext, undefined);
  assert.deepEqual(pauseCalls, [
    { guildId: "guild-1", channelId, paused: true },
    { guildId: "guild-1", channelId, paused: false },
  ]);
  assert.equal(commandDeleted, 2);
  assert.equal(previousDeleted, true);
  assert.equal(
    sentPayload.content,
    "Arenzyra bot is now active in this channel.",
  );
});

test("paused server channels ignore bot activity until started", async () => {
  const channelId = "123456789012345678";
  let previewCalled = false;
  const message = {
    id: "123456789012345679",
    author: {
      id: "staff-1",
      username: "staff",
      globalName: "Staff",
      bot: false,
      tag: "staff",
    },
    content: "G1",
    guild: { id: "guild-1" },
    channel: { id: channelId },
    member: {
      permissions: { has: () => true },
      roles: {
        cache: {
          has: () => false,
          some: () => false,
        },
      },
    },
    mentions: {
      users: new Map(),
      channels: { first: () => null },
    },
    attachments: {
      find: () => ({
        url: "https://cdn.discordapp.com/result.png",
        name: "result.png",
        contentType: "image/png",
      }),
    },
    client: { user: { id: "bot-1" } },
    reply: async () => {
      throw new Error("paused channel should not reply");
    },
  };
  const sessionService = {
    isDiscordChannelPaused: async () => true,
    previewAutomaticResultScreenshot: async () => {
      previewCalled = true;
    },
  };

  const service = new MessageRegistrationService(sessionService as any);
  const handled = await service.handleMessage(message as any);

  assert.equal(handled, true);
  assert.equal(previewCalled, false);
});

test("staff result screenshot in screenshots channel creates preview apply buttons", async () => {
  let previewArgs: unknown[] | null = null;
  let editedReply: any = null;
  const message = {
    id: "123456789012345678",
    author: {
      id: "staff-1",
      username: "staff",
      globalName: "Staff",
      bot: false,
      tag: "staff",
    },
    content: "G1",
    guild: { id: "guild-1" },
    channel: { id: "screenshots-channel" },
    member: {
      permissions: { has: () => true },
      roles: {
        cache: {
          has: () => false,
          some: () => false,
        },
      },
    },
    mentions: {
      users: new Map(),
      channels: { first: () => null },
    },
    attachments: {
      find: () => ({
        url: "https://cdn.discordapp.com/result.png",
        name: "result.png",
        contentType: "image/png",
      }),
    },
    client: { user: { id: "bot-1" } },
    reactions: {
      resolve: () => ({
        users: { remove: async () => undefined },
      }),
    },
    react: async () => undefined,
    reply: async () => ({
      edit: async (payload: any) => {
        editedReply = payload;
        return payload;
      },
    }),
  };
  const sessionService = {
    findScrimForDiscordChannel: async () => ({
      session: { id: "session-1" },
      channelKind: "screenshots",
      config: {
        manageRoleIds: [],
        emojis: {},
      },
    }),
    previewAutomaticResultScreenshot: async (...args: unknown[]) => {
      previewArgs = args;
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
        sessionId: "session-1",
        matchId: "match-1",
        matchLabel: "Match 1",
        imageUrl: "https://cdn.discordapp.com/result.png",
        mode: "results",
        content: "Automatic result preview\nMatch: Match 1",
        canApply: true,
        preview: {
          matchId: "match-1",
          preview: [entry],
          resolved: [entry],
          unresolved: [],
          ambiguous: [],
        },
        slots: [
          {
            id: "slot-1",
            matchId: "match-1",
            slotNumber: 3,
            teamId: "team-1",
            team: { id: "team-1", tag: "DXB" },
          },
        ],
      };
    },
  };

  const service = new MessageRegistrationService(sessionService as any);
  const handled = await service.handleMessage(message as any);

  assert.equal(handled, true);
  assert.deepEqual(previewArgs, [
    "session-1",
    ["https://cdn.discordapp.com/result.png"],
    "results",
    { manageRoleIds: [], emojis: {} },
    { matchNumber: 1 },
  ]);
  assert.match(editedReply.content, /Result Review Panel/);
  assert.match(editedReply.content, /Status: ready to apply/);
  const applyButton = editedReply.components[1].toJSON().components[1];
  assert.equal(applyButton.custom_id, "result:auto:apply:123456789012345678");
});

test("automatic result screenshot accepts match-name aliases as game code", async () => {
  const cases = [
    ["match 1", 1],
    ["Match #2 final", 2],
    ["M3", 3],
    ["game no 4", 4],
    ["round-5", 5],
  ] as const;

  for (const [content, expectedMatchNumber] of cases) {
    let previewArgs: unknown[] | null = null;
    let editedReply: any = null;
    const message = {
      id: `1234567890123456${expectedMatchNumber}`,
      author: {
        id: "staff-1",
        username: "staff",
        globalName: "Staff",
        bot: false,
        tag: "staff",
      },
      content,
      guild: { id: "guild-1" },
      channel: { id: "screenshots-channel" },
      member: {
        permissions: { has: () => true },
        roles: {
          cache: {
            has: () => false,
            some: () => false,
          },
        },
      },
      mentions: {
        users: new Map(),
        channels: { first: () => null },
      },
      attachments: {
        find: () => ({
          url: "https://cdn.discordapp.com/result.png",
          name: "result.png",
          contentType: "image/png",
        }),
      },
      client: { user: { id: "bot-1" } },
      reactions: {
        resolve: () => ({
          users: { remove: async () => undefined },
        }),
      },
      react: async () => undefined,
      reply: async () => ({
        edit: async (payload: any) => {
          editedReply = payload;
          return payload;
        },
      }),
    };
    const sessionService = {
      findScrimForDiscordChannel: async () => ({
        session: { id: "session-1" },
        channelKind: "screenshots",
        config: {
          manageRoleIds: [],
          emojis: {},
        },
      }),
      previewAutomaticResultScreenshot: async (...args: unknown[]) => {
        previewArgs = args;
        return {
          sessionId: "session-1",
          matchId: `match-${expectedMatchNumber}`,
          matchLabel: `Match ${expectedMatchNumber}`,
          imageUrl: "https://cdn.discordapp.com/result.png",
          mode: "results",
          content: `Automatic result preview\nMatch: Match ${expectedMatchNumber}`,
          canApply: false,
          preview: {
            matchId: `match-${expectedMatchNumber}`,
            preview: [],
            resolved: [],
            unresolved: [],
            ambiguous: [],
          },
          slots: [],
        };
      },
    };

    const service = new MessageRegistrationService(sessionService as any);
    const handled = await service.handleMessage(message as any);

    assert.equal(handled, true, content);
    assert.deepEqual(
      previewArgs?.[4],
      { matchNumber: expectedMatchNumber },
      content,
    );
    assert.match(editedReply.content, /Automatic result preview/, content);
  }
});

test("result screenshots in results channel do not create OCR previews", async () => {
  let previewCalled = false;
  const message = {
    id: "123456789012345680",
    author: {
      id: "staff-1",
      username: "staff",
      globalName: "Staff",
      bot: false,
      tag: "staff",
    },
    content: "G1",
    guild: { id: "guild-1" },
    channel: { id: "results-channel" },
    member: {
      permissions: { has: () => true },
      roles: {
        cache: {
          has: () => false,
          some: () => false,
        },
      },
    },
    mentions: {
      users: new Map(),
      channels: { first: () => null },
    },
    attachments: {
      find: () => ({
        url: "https://cdn.discordapp.com/result.png",
        name: "result.png",
        contentType: "image/png",
      }),
    },
    client: { user: { id: "bot-1" } },
    reply: async () => {
      throw new Error("results channel screenshot should not reply");
    },
  };
  const sessionService = {
    findScrimForDiscordChannel: async () => ({
      session: { id: "session-1" },
      channelKind: "results",
      config: {
        manageRoleIds: [],
        emojis: {},
      },
    }),
    previewAutomaticResultScreenshot: async () => {
      previewCalled = true;
    },
  };

  const service = new MessageRegistrationService(sessionService as any);
  const handled = await service.handleMessage(message as any);

  assert.equal(handled, false);
  assert.equal(previewCalled, false);
});

test("staff result screenshot sends every attached image to OCR preview", async () => {
  let previewArgs: unknown[] | null = null;
  let editedReply: any = null;
  const attachments = [
    {
      url: "https://cdn.discordapp.com/result-1.png",
      name: "result-1.png",
      contentType: "image/png",
    },
    {
      url: "https://cdn.discordapp.com/result-2.png",
      name: "result-2.png",
      contentType: "image/png",
    },
  ];
  const message = {
    id: "123456789012345681",
    author: {
      id: "staff-1",
      username: "staff",
      globalName: "Staff",
      bot: false,
      tag: "staff",
    },
    content: "G1",
    guild: { id: "guild-1" },
    channel: { id: "screenshots-channel" },
    member: {
      permissions: { has: () => true },
      roles: {
        cache: {
          has: () => false,
          some: () => false,
        },
      },
    },
    mentions: {
      users: new Map(),
      channels: { first: () => null },
    },
    attachments: {
      values: () => attachments.values(),
    },
    client: { user: { id: "bot-1" } },
    reactions: {
      resolve: () => ({
        users: { remove: async () => undefined },
      }),
    },
    react: async () => undefined,
    reply: async () => ({
      edit: async (payload: any) => {
        editedReply = payload;
        return payload;
      },
    }),
  };
  const entry = {
    position: 1,
    tag: "DXB",
    kills: 8,
    teamId: "team-1",
    slotId: "slot-1",
    slotNumber: 3,
    status: "OK",
  };
  const sessionService = {
    findScrimForDiscordChannel: async () => ({
      session: { id: "session-1" },
      channelKind: "screenshots",
      config: {
        manageRoleIds: [],
        emojis: {},
      },
    }),
    previewAutomaticResultScreenshot: async (...args: unknown[]) => {
      previewArgs = args;
      return {
        sessionId: "session-1",
        matchId: "match-1",
        matchLabel: "Match 1",
        imageUrl: "https://cdn.discordapp.com/result-1.png",
        imageUrls: attachments.map((attachment) => attachment.url),
        mode: "results",
        content: "Automatic result preview\nMatch: Match 1",
        canApply: true,
        preview: {
          matchId: "match-1",
          preview: [entry],
          resolved: [entry],
          unresolved: [],
          ambiguous: [],
        },
        slots: [
          {
            id: "slot-1",
            matchId: "match-1",
            slotNumber: 3,
            teamId: "team-1",
            team: { id: "team-1", tag: "DXB" },
          },
        ],
      };
    },
  };

  const service = new MessageRegistrationService(sessionService as any);
  const handled = await service.handleMessage(message as any);

  assert.equal(handled, true);
  assert.deepEqual(previewArgs?.[1], [
    "https://cdn.discordapp.com/result-1.png",
    "https://cdn.discordapp.com/result-2.png",
  ]);
  assert.match(editedReply.content, /Images: 2/);
});

test("automatic result screenshots always use official slots, even with slot-list text", async () => {
  let previewArgs: unknown[] | null = null;
  const message = {
    id: "123456789012345680",
    author: {
      id: "staff-1",
      username: "staff",
      globalName: "Staff",
      bot: false,
      tag: "staff",
    },
    content: "G2 slot list",
    guild: { id: "guild-1" },
    channel: { id: "screenshots-channel" },
    member: {
      permissions: { has: () => true },
      roles: {
        cache: {
          has: () => false,
          some: () => false,
        },
      },
    },
    mentions: {
      users: new Map(),
      channels: { first: () => null },
    },
    attachments: {
      find: () => ({
        url: "https://cdn.discordapp.com/result.png",
        name: "result.png",
        contentType: "image/png",
      }),
    },
    client: { user: { id: "bot-1" } },
    reactions: {
      resolve: () => ({
        users: { remove: async () => undefined },
      }),
    },
    react: async () => undefined,
    reply: async () => ({
      edit: async (payload: any) => payload,
    }),
  };
  const sessionService = {
    findScrimForDiscordChannel: async () => ({
      session: { id: "session-1" },
      channelKind: "screenshots",
      config: {
        manageRoleIds: [],
        emojis: {},
      },
    }),
    previewAutomaticResultScreenshot: async (...args: unknown[]) => {
      previewArgs = args;
      return {
        sessionId: "session-1",
        matchId: "match-1",
        matchLabel: "Match 1",
        imageUrl: "https://cdn.discordapp.com/result.png",
        mode: "results",
        content:
          "Automatic result preview\nMatch: Match 1\nSlot source: official scrim slot list",
        canApply: true,
      };
    },
  };

  const service = new MessageRegistrationService(sessionService as any);
  const handled = await service.handleMessage(message as any);

  assert.equal(handled, true);
  assert.deepEqual(previewArgs, [
    "session-1",
    ["https://cdn.discordapp.com/result.png"],
    "results",
    { manageRoleIds: [], emojis: {} },
    { matchNumber: 2 },
  ]);
});

test("staff slot-player screenshot with game map code saves mappings without apply buttons", async () => {
  let previewArgs: unknown[] | null = null;
  let editedReply: any = null;
  const message = {
    id: "123456789012345684",
    author: {
      id: "staff-1",
      username: "staff",
      globalName: "Staff",
      bot: false,
      tag: "staff",
    },
    content: "G1 map",
    guild: { id: "guild-1" },
    channel: { id: "screenshots-channel" },
    member: {
      permissions: { has: () => true },
      roles: {
        cache: {
          has: () => false,
          some: () => false,
        },
      },
    },
    mentions: {
      users: new Map(),
      channels: { first: () => null },
    },
    attachments: {
      find: () => ({
        url: "https://cdn.discordapp.com/slots.png",
        name: "slots.png",
        contentType: "image/png",
      }),
    },
    client: { user: { id: "bot-1" } },
    reactions: {
      resolve: () => ({
        users: { remove: async () => undefined },
      }),
    },
    react: async () => undefined,
    reply: async () => ({
      edit: async (payload: any) => {
        editedReply = payload;
        return payload;
      },
    }),
  };
  const sessionService = {
    findScrimForDiscordChannel: async () => ({
      session: { id: "session-1" },
      channelKind: "screenshots",
      config: {
        manageRoleIds: [],
        emojis: {},
      },
    }),
    previewAutomaticResultScreenshot: async (...args: unknown[]) => {
      previewArgs = args;
      return {
        sessionId: "session-1",
        matchId: "match-1",
        matchLabel: "Match 1",
        imageUrl: "https://cdn.discordapp.com/slots.png",
        mode: "slot-map",
        content: "Automatic slot map\nSaved mappings",
        canApply: false,
      };
    },
  };

  const service = new MessageRegistrationService(sessionService as any);
  const handled = await service.handleMessage(message as any);

  assert.equal(handled, true);
  assert.deepEqual(previewArgs, [
    "session-1",
    ["https://cdn.discordapp.com/slots.png"],
    "slot-map",
    { manageRoleIds: [], emojis: {} },
    { matchNumber: 1 },
  ]);
  assert.match(editedReply.content, /Saved mappings/);
  assert.equal(editedReply.components.length, 0);
});

test("automatic result screenshot requires a game code", async () => {
  let previewCalled = false;
  let replyContent = "";
  const message = {
    id: "123456789012345681",
    author: {
      id: "staff-1",
      username: "staff",
      globalName: "Staff",
      bot: false,
      tag: "staff",
    },
    content: "",
    guild: { id: "guild-1" },
    channel: { id: "screenshots-channel" },
    member: {
      permissions: { has: () => true },
      roles: {
        cache: {
          has: () => false,
          some: () => false,
        },
      },
    },
    mentions: {
      users: new Map(),
      channels: { first: () => null },
    },
    attachments: {
      find: () => ({
        url: "https://cdn.discordapp.com/result.png",
        name: "result.png",
        contentType: "image/png",
      }),
    },
    client: { user: { id: "bot-1" } },
    reactions: {
      resolve: () => ({
        users: { remove: async () => undefined },
      }),
    },
    react: async () => undefined,
    reply: async (payload: any) => {
      replyContent = payload.content;
      return { edit: async () => undefined };
    },
  };
  const sessionService = {
    findScrimForDiscordChannel: async () => ({
      session: { id: "session-1" },
      channelKind: "screenshots",
      config: {
        manageRoleIds: [],
        emojis: {},
      },
    }),
    previewAutomaticResultScreenshot: async () => {
      previewCalled = true;
      throw new Error("preview should not run");
    },
  };

  const service = new MessageRegistrationService(sessionService as any);
  const handled = await service.handleMessage(message as any);

  assert.equal(handled, true);
  assert.equal(previewCalled, false);
  assert.match(replyContent, /G1/);
});

test("automatic result apply button applies the stored screenshot", async () => {
  let appliedArgs: unknown[] | null = null;
  let finalEdit: any = null;
  let resultsPost: any = null;
  const message = {
    id: "123456789012345679",
    author: {
      id: "staff-1",
      username: "staff",
      globalName: "Staff",
      bot: false,
      tag: "staff",
    },
    content: "G1",
    guild: { id: "guild-1" },
    channel: { id: "screenshots-channel" },
    member: {
      permissions: { has: () => true },
      roles: {
        cache: {
          has: () => false,
          some: () => false,
        },
      },
    },
    mentions: {
      users: new Map(),
      channels: { first: () => null },
    },
    attachments: {
      find: () => ({
        url: "https://cdn.discordapp.com/result.png",
        name: "result.png",
        contentType: "image/png",
      }),
    },
    client: { user: { id: "bot-1" } },
    reactions: {
      resolve: () => ({
        users: { remove: async () => undefined },
      }),
    },
    react: async () => undefined,
    reply: async () => ({
      edit: async () => undefined,
    }),
  };
  const sessionService = {
    findScrimForDiscordChannel: async () => ({
      session: { id: "session-1" },
      channelKind: "screenshots",
      config: {
        managerChannelId: "manager-channel",
        resultsChannelId: "results-channel",
        manageRoleIds: [],
        emojis: { banDefaultReason: "No-show" },
      },
    }),
    previewAutomaticResultScreenshot: async () => ({
      sessionId: "session-1",
      matchId: "match-1",
      matchLabel: "Match 1",
      imageUrl: "https://cdn.discordapp.com/result.png",
      mode: "results",
      content: "Automatic result preview\nMatch: Match 1",
      canApply: true,
      preview: {
        matchId: "match-1",
        preview: [
          {
            position: 1,
            tag: "DXB",
            kills: 8,
            teamId: "team-1",
            slotId: "slot-1",
            slotNumber: 3,
            status: "OK",
          },
        ],
        resolved: [
          {
            position: 1,
            tag: "DXB",
            kills: 8,
            teamId: "team-1",
            slotId: "slot-1",
            slotNumber: 3,
            status: "OK",
          },
        ],
        unresolved: [],
        ambiguous: [],
      },
      slots: [
        {
          id: "slot-1",
          matchId: "match-1",
          slotNumber: 3,
          teamId: "team-1",
          team: { id: "team-1", tag: "DXB" },
        },
      ],
    }),
    applyReviewedResults: async (...args: unknown[]) => {
      appliedArgs = args;
      return {
        content: "Results applied",
        publicContent: "Public results",
        imageFiles: [{ name: "match-result.png", buffer: Buffer.from([1]) }],
      };
    },
  };
  const service = new MessageRegistrationService(sessionService as any);
  await service.handleMessage(message as any);

  const handled = await service.handleButton({
    customId: "result:auto:apply:123456789012345679",
    memberPermissions: { has: () => true },
    member: null,
    deferUpdate: async () => undefined,
    editReply: async (payload: any) => {
      finalEdit = payload;
      return payload;
    },
    guild: {
      channels: {
        fetch: async (channelId: string) =>
          channelId === "results-channel"
            ? {
                send: async (payload: any) => {
                  resultsPost = payload;
                  return payload;
                },
              }
            : null,
      },
    },
    reply: async () => undefined,
  } as any);

  assert.equal(handled, true);
  const applied = appliedArgs ?? [];
  assert.equal(applied[0], "match-1");
  assert.deepEqual(applied[1], [
    {
      position: 1,
      tag: "DXB",
      kills: 8,
      teamId: "team-1",
      slotId: "slot-1",
      slotNumber: 3,
      status: "OK",
      include: true,
      ocrTag: "DXB",
      ocrPlayerNames: [],
    },
  ]);
  assert.match(finalEdit.content, /Results applied/);
  assert.match(finalEdit.content, /results-channel/);
  assert.equal(finalEdit.components.length, 0);
  assert.equal(finalEdit.files.length, 0);
  assert.equal(resultsPost.content, "Public results");
  assert.equal(resultsPost.files.length, 1);
});

test("automatic result review channel defaults to screenshots before manage", () => {
  const service = new MessageRegistrationService({} as any) as any;

  assert.equal(
    service.resultReviewChannelId({
      screenshotsChannelId: "screenshots-channel",
      manageChannelId: "admin-channel",
      emojis: {},
    }),
    "screenshots-channel",
  );
  assert.equal(
    service.resultReviewChannelId({
      screenshotsChannelId: "screenshots-channel",
      manageChannelId: "admin-channel",
      emojis: { resultReviewChannelId: "review-channel" },
    }),
    "review-channel",
  );
  assert.equal(
    service.resultReviewChannelId({
      screenshotsChannelId: null,
      manageChannelId: "admin-channel",
      emojis: {},
    }),
    "admin-channel",
  );
});

test("automatic result review controls move to explicitly configured private channel", async () => {
  let screenshotEdit: any = null;
  let reviewPost: any = null;
  const message = {
    id: "123456789012345690",
    author: {
      id: "staff-1",
      username: "staff",
      globalName: "Staff",
      bot: false,
      tag: "staff",
    },
    content: "G1",
    guild: {
      id: "guild-1",
      channels: {
        fetch: async (channelId: string) =>
          channelId === "admin-channel"
            ? {
                isTextBased: () => true,
                isDMBased: () => false,
                send: async (payload: any) => {
                  reviewPost = payload;
                  return { id: "review-message" };
                },
              }
            : null,
      },
    },
    channel: { id: "screenshots-channel" },
    member: {
      permissions: { has: () => true },
      roles: {
        cache: {
          has: () => false,
          some: () => false,
        },
      },
    },
    attachments: {
      find: () => ({
        url: "https://cdn.discordapp.com/result.png",
        name: "result.png",
        contentType: "image/png",
      }),
    },
    client: { user: { id: "bot-1" } },
    reactions: {
      resolve: () => ({
        users: { remove: async () => undefined },
      }),
    },
    react: async () => undefined,
    reply: async () => ({
      id: "dashboard-message",
      edit: async (payload: any) => {
        screenshotEdit = payload;
        return payload;
      },
    }),
  };
  const sessionService = {
    findScrimForDiscordChannel: async () => ({
      session: { id: "session-1" },
      channelKind: "screenshots",
      config: {
        manageChannelId: "admin-channel",
        screenshotsChannelId: "screenshots-channel",
        manageRoleIds: [],
        emojis: { resultReviewChannelId: "admin-channel" },
      },
    }),
    previewAutomaticResultScreenshot: async () => ({
      sessionId: "session-1",
      matchId: "match-1",
      matchLabel: "Match 1",
      imageUrl: "https://cdn.discordapp.com/result.png",
      mode: "results",
      content: "Automatic result preview\nMatch: Match 1",
      canApply: true,
      preview: {
        matchId: "match-1",
        preview: [
          {
            position: 1,
            tag: "DXB",
            kills: 8,
            teamId: "team-1",
            slotId: "slot-1",
            slotNumber: 3,
            status: "OK",
          },
        ],
        resolved: [
          {
            position: 1,
            tag: "DXB",
            kills: 8,
            teamId: "team-1",
            slotId: "slot-1",
            slotNumber: 3,
            status: "OK",
          },
        ],
        unresolved: [],
        ambiguous: [],
      },
      slots: [
        {
          id: "slot-1",
          matchId: "match-1",
          slotNumber: 3,
          teamId: "team-1",
          team: { id: "team-1", tag: "DXB" },
        },
      ],
    }),
  };

  const service = new MessageRegistrationService(sessionService as any);
  const handled = await service.handleMessage(message as any);

  assert.equal(handled, true);
  assert.match(screenshotEdit.content, /admin-channel/);
  assert.equal(screenshotEdit.components.length, 0);
  assert.match(reviewPost.content, /Result Review Panel/i);
  assert.ok(reviewPost.components.length > 0);
});

test("automatic result apply blocks duplicate clicks while processing", async () => {
  let replyPayload: any = null;
  const service = new MessageRegistrationService({} as any) as any;
  service.pendingAutoResults.set("123456789012345684", {
    sessionId: "session-1",
    matchId: "match-1",
    matchLabel: "Match 1",
    imageUrl: "https://cdn.discordapp.com/result.png",
    imageUrls: ["https://cdn.discordapp.com/result.png"],
    sourceGuildId: "guild-1",
    sourceMessageId: "123456789012345684",
    sourceChannelId: "screenshots-channel",
    dashboardChannelId: "screenshots-channel",
    dashboardMessageId: "123456789012345684",
    config: {
      organizationId: null,
      manageRoleIds: [],
      emojis: {},
    },
    rows: [
      {
        position: 1,
        tag: "DXB",
        kills: 8,
        teamId: "team-1",
        slotId: "slot-1",
        slotNumber: 3,
        status: "OK",
        include: true,
      },
    ],
    slots: [],
    expiresAt: Date.now() + 60_000,
    processing: true,
  });

  const handled = await service.handleButton({
    customId: "result:auto:apply:123456789012345684",
    memberPermissions: { has: () => true },
    member: null,
    reply: async (payload: any) => {
      replyPayload = payload;
      return payload;
    },
  } as any);

  assert.equal(handled, true);
  assert.match(replyPayload.content, /already being applied/i);
  assert.equal(replyPayload.ephemeral, true);
});

test("automatic result no-show apply explains missing slot map without failing button", async () => {
  let finalEdit: any = null;
  let deferCalled = false;
  const service = new MessageRegistrationService({
    applyReviewedResults: async () => {
      throw new Error(
        "Slot/player screenshot mapping is required before marking missing slots no-show",
      );
    },
  } as any) as any;
  service.pendingAutoResults.set("123456789012345691", {
    sessionId: "session-1",
    matchId: "match-1",
    matchLabel: "Match 1",
    imageUrl: "https://cdn.discordapp.com/result.png",
    imageUrls: ["https://cdn.discordapp.com/result.png"],
    sourceGuildId: "guild-1",
    sourceMessageId: "123456789012345691",
    sourceChannelId: "screenshots-channel",
    dashboardChannelId: "screenshots-channel",
    dashboardMessageId: "123456789012345691",
    config: {
      organizationId: null,
      manageRoleIds: [],
      emojis: {},
    },
    rows: [
      {
        position: 1,
        tag: "DXB",
        kills: 8,
        teamId: "team-1",
        slotId: "slot-1",
        slotNumber: 3,
        status: "OK",
        include: true,
      },
    ],
    slots: [
      {
        id: "slot-1",
        matchId: "match-1",
        slotNumber: 3,
        teamId: "team-1",
        team: { id: "team-1", tag: "DXB" },
      },
      {
        id: "slot-2",
        matchId: "match-1",
        slotNumber: 4,
        teamId: "team-2",
        team: { id: "team-2", tag: "MISS" },
      },
    ],
    expiresAt: Date.now() + 60_000,
  });

  const handled = await service.handleButton({
    customId: "result:auto:apply-noshow:123456789012345691",
    memberPermissions: { has: () => true },
    member: null,
    deferUpdate: async () => {
      deferCalled = true;
    },
    editReply: async (payload: any) => {
      finalEdit = payload;
      return payload;
    },
    reply: async () => undefined,
  } as any);

  assert.equal(handled, true);
  assert.equal(deferCalled, true);
  assert.match(finalEdit.content, /Cannot apply no-shows yet/i);
  assert.match(finalEdit.content, /slot\/player screenshot/i);
  assert.match(finalEdit.content, /Current results were not applied/i);
  assert.ok(finalEdit.components.length > 0);
  assert.equal(
    service.pendingAutoResults.get("123456789012345691")?.processing,
    false,
  );
});

test("automatic result ban missing button previews and confirms no-show bans", async () => {
  let previewCommand: any = null;
  let createCommand: any = null;
  let previewEdit: any = null;
  let confirmUpdate: any = null;
  let confirmEdit: any = null;
  const service = new MessageRegistrationService({
    previewNoShowTeamBansFromDiscord: async (command: any) => {
      previewCommand = command;
      return {
        response: {
          creatableCount: 1,
        },
        content: "No-show ban preview\nNew bans: 1",
      };
    },
    createNoShowTeamBansFromDiscord: async (command: any) => {
      createCommand = command;
      return "No-show bans completed.\nCreated: 1";
    },
  } as any) as any;
  service.pendingAutoResults.set("123456789012345692", {
    sessionId: "session-1",
    matchId: "match-1",
    matchLabel: "Match 1",
    imageUrl: "https://cdn.discordapp.com/result.png",
    imageUrls: ["https://cdn.discordapp.com/result.png"],
    sourceGuildId: "guild-1",
    sourceMessageId: "123456789012345692",
    sourceChannelId: "screenshots-channel",
    dashboardChannelId: "screenshots-channel",
    dashboardMessageId: "123456789012345692",
    config: {
      organizationId: "org-1",
      manageRoleIds: [],
      emojis: {
        banDefaultDurationDays: "3",
        banDefaultReason: "Manual no-show",
        banDefaultScope: "SESSION",
      },
    },
    rows: [],
    slots: [],
    expiresAt: Date.now() + 60_000,
    completed: true,
  });

  const previewHandled = await service.handleButton({
    customId: "result:auto:ban-missing:123456789012345692",
    user: { id: "staff-1", tag: "staff#0001" },
    memberPermissions: { has: () => true },
    member: null,
    deferReply: async () => undefined,
    editReply: async (payload: any) => {
      previewEdit = payload;
      return payload;
    },
    reply: async () => undefined,
  } as any);

  assert.equal(previewHandled, true);
  assert.deepEqual(previewCommand, {
    sessionId: "session-1",
    matchId: "match-1",
    scope: "SESSION",
    days: 3,
    reason: "Manual no-show",
    note: "Created from Discord result review for Match 1",
  });
  assert.match(previewEdit.content, /No-show ban preview/);
  assert.match(previewEdit.content, /Confirm within 60 seconds/);
  const confirmId = previewEdit.components[0].toJSON().components[0].custom_id;

  const confirmHandled = await service.handleButton({
    customId: confirmId,
    user: { id: "staff-1", tag: "staff#0001" },
    memberPermissions: { has: () => true },
    member: null,
    guild: { id: "guild-1" },
    channelId: "screenshots-channel",
    update: async (payload: any) => {
      confirmUpdate = payload;
      return payload;
    },
    editReply: async (payload: any) => {
      confirmEdit = payload;
      return payload;
    },
    reply: async () => undefined,
  } as any);

  assert.equal(confirmHandled, true);
  assert.match(confirmUpdate.content, /Banning no-show teams/);
  assert.deepEqual(createCommand, previewCommand);
  assert.match(confirmEdit.content, /No-show bans completed/);
});

test("automatic apply with no-shows counts ban candidates without creating bans", async () => {
  let finalEdit: any = null;
  const service = new MessageRegistrationService({
    applyReviewedResults: async () => ({
      content: "Results applied\nBan candidates counted: 1",
      noShowCount: 1,
    }),
  } as any) as any;
  service.pendingAutoResults.set("123456789012345693", {
    sessionId: "session-1",
    matchId: "match-1",
    matchLabel: "Match 1",
    imageUrl: "https://cdn.discordapp.com/result.png",
    imageUrls: ["https://cdn.discordapp.com/result.png"],
    sourceGuildId: "guild-1",
    sourceMessageId: "123456789012345693",
    sourceChannelId: "screenshots-channel",
    dashboardChannelId: "screenshots-channel",
    dashboardMessageId: "123456789012345693",
    config: {
      organizationId: null,
      manageRoleIds: [],
      emojis: {},
    },
    rows: [
      {
        position: 1,
        tag: "DXB",
        kills: 8,
        teamId: "team-1",
        slotId: "slot-1",
        slotNumber: 3,
        status: "OK",
        include: true,
      },
    ],
    slots: [],
    expiresAt: Date.now() + 60_000,
  });

  const handled = await service.handleButton({
    customId: "result:auto:apply-noshow:123456789012345693",
    memberPermissions: { has: () => true },
    member: null,
    deferUpdate: async () => undefined,
    editReply: async (payload: any) => {
      finalEdit = payload;
      return payload;
    },
    reply: async () => undefined,
  } as any);

  assert.equal(handled, true);
  assert.match(finalEdit.content, /Ban candidates counted: 1/);
  assert.equal(finalEdit.components.length, 0);
  assert.equal(service.pendingAutoResults.has("123456789012345693"), false);
});

test("automatic result apply replaces stale MVP and top fragger widget posts", async () => {
  const deletedMessages: string[] = [];
  let sentPayload: any = null;
  const service = new MessageRegistrationService({
    applyReviewedResults: async () => ({
      content: "Results applied\n\nMatch ID: match-1",
      imageFiles: [
        { name: "match-result.png", buffer: Buffer.from([1]) },
        { name: "top-mvp.png", buffer: Buffer.from([2]) },
        { name: "top-fraggers.png", buffer: Buffer.from([3]) },
      ],
    }),
  } as any) as any;
  service.pendingAutoResults.set("123456789012345685", {
    sessionId: "session-1",
    matchId: "match-1",
    matchLabel: "Match 1",
    imageUrl: "https://cdn.discordapp.com/result.png",
    imageUrls: ["https://cdn.discordapp.com/result.png"],
    sourceGuildId: "guild-1",
    sourceMessageId: "123456789012345685",
    sourceChannelId: "screenshots-channel",
    dashboardChannelId: "screenshots-channel",
    dashboardMessageId: "123456789012345685",
    config: {
      organizationId: null,
      managerChannelId: "manager-channel",
      manageRoleIds: [],
      emojis: {},
    },
    rows: [
      {
        position: 1,
        tag: "DXB",
        kills: 8,
        teamId: "team-1",
        slotId: "slot-1",
        slotNumber: 3,
        status: "OK",
        include: true,
      },
    ],
    slots: [],
    expiresAt: Date.now() + 60_000,
    processing: false,
  });
  const staleMessage = {
    id: "old-widget",
    author: { id: "bot-1", bot: true },
    content: "Results applied\n\nMatch ID: match-1",
    attachments: new Collection([["attachment-1", { name: "top-mvp.png" }]]),
    delete: async () => {
      deletedMessages.push("old-widget");
    },
  };
  const unrelatedMessage = {
    id: "other-match-widget",
    author: { id: "bot-1", bot: true },
    content: "Results applied\n\nMatch ID: other-match",
    attachments: new Collection([
      ["attachment-2", { name: "top-fraggers.png" }],
    ]),
    delete: async () => {
      deletedMessages.push("other-match-widget");
    },
  };
  const sentMessage = {
    id: "new-widget",
    author: { id: "bot-1", bot: true },
    content: "Results applied\n\nMatch ID: match-1",
    attachments: new Collection(),
  };
  const channel = {
    send: async (payload: any) => {
      sentPayload = payload;
      return sentMessage;
    },
    messages: {
      fetch: async () =>
        new Collection([
          ["old-widget", staleMessage],
          ["other-match-widget", unrelatedMessage],
          ["new-widget", sentMessage],
        ]),
    },
  };

  const handled = await service.handleButton({
    customId: "result:auto:apply:123456789012345685",
    memberPermissions: { has: () => true },
    member: null,
    deferUpdate: async () => undefined,
    editReply: async (payload: any) => payload,
    guild: {
      channels: {
        fetch: async (channelId: string) =>
          channelId === "manager-channel" ? channel : null,
      },
    },
    client: { user: { id: "bot-1" } },
    reply: async () => undefined,
  } as any);

  assert.equal(handled, true);
  assert.deepEqual(deletedMessages, ["old-widget"]);
  assert.deepEqual(
    sentPayload.files.map((file: { name?: string }) => file.name),
    ["match-result.png", "top-mvp.png", "top-fraggers.png"],
  );
});

test("automatic result apply marks public posts and cleans recent unmarked widget posts", async () => {
  const deletedMessages: string[] = [];
  let sentPayload: any = null;
  const service = new MessageRegistrationService({
    applyReviewedResults: async () => ({
      content: "Results applied\n\nMatch ID: match-1",
      publicContent: "Public results",
      imageFiles: [
        { name: "match-result.png", buffer: Buffer.from([1]) },
        { name: "top-mvp.png", buffer: Buffer.from([2]) },
      ],
    }),
  } as any) as any;
  service.pendingAutoResults.set("123456789012345686", {
    sessionId: "session-1",
    matchId: "match-1",
    matchLabel: "Match 1",
    imageUrl: "https://cdn.discordapp.com/result.png",
    imageUrls: ["https://cdn.discordapp.com/result.png"],
    sourceGuildId: "guild-1",
    sourceMessageId: "123456789012345686",
    sourceChannelId: "screenshots-channel",
    dashboardChannelId: "screenshots-channel",
    dashboardMessageId: "123456789012345686",
    config: {
      organizationId: null,
      managerChannelId: "manager-channel",
      manageRoleIds: [],
      emojis: {},
    },
    rows: [
      {
        position: 1,
        tag: "DXB",
        kills: 8,
        teamId: "team-1",
        slotId: "slot-1",
        slotNumber: 3,
        status: "OK",
        include: true,
      },
    ],
    slots: [],
    expiresAt: Date.now() + 60_000,
    processing: false,
  });

  const recentUnmarkedMessage = {
    id: "old-public-widget",
    author: { id: "bot-1", bot: true },
    content: "Public results",
    createdTimestamp: Date.now() - 60_000,
    attachments: new Collection([
      ["attachment-1", { name: "match-result.png" }],
    ]),
    delete: async () => {
      deletedMessages.push("old-public-widget");
    },
  };
  const oldUnmarkedMessage = {
    id: "old-other-widget",
    author: { id: "bot-1", bot: true },
    content: "Public results",
    createdTimestamp: Date.now() - 7 * 60 * 60 * 1000,
    attachments: new Collection([
      ["attachment-2", { name: "match-result.png" }],
    ]),
    delete: async () => {
      deletedMessages.push("old-other-widget");
    },
  };
  const markedOtherMatchMessage = {
    id: "marked-other-match-widget",
    author: { id: "bot-1", bot: true },
    content: "Public results\n\nMatch ID: other-match",
    createdTimestamp: Date.now() - 60_000,
    attachments: new Collection([
      ["attachment-3", { name: "match-result.png" }],
    ]),
    delete: async () => {
      deletedMessages.push("marked-other-match-widget");
    },
  };
  const sentMessage = {
    id: "new-widget",
    author: { id: "bot-1", bot: true },
    content: "Public results",
    attachments: new Collection(),
  };
  const channel = {
    send: async (payload: any) => {
      sentPayload = payload;
      return sentMessage;
    },
    messages: {
      fetch: async () =>
        new Collection([
          ["old-public-widget", recentUnmarkedMessage],
          ["old-other-widget", oldUnmarkedMessage],
          ["marked-other-match-widget", markedOtherMatchMessage],
          ["new-widget", sentMessage],
        ]),
    },
  };

  const handled = await service.handleButton({
    customId: "result:auto:apply:123456789012345686",
    memberPermissions: { has: () => true },
    member: null,
    deferUpdate: async () => undefined,
    editReply: async (payload: any) => payload,
    guild: {
      channels: {
        fetch: async (channelId: string) =>
          channelId === "manager-channel" ? channel : null,
      },
    },
    client: { user: { id: "bot-1" } },
    reply: async () => undefined,
  } as any);

  assert.equal(handled, true);
  assert.equal(sentPayload.content, "Public results");
  assert.deepEqual(deletedMessages, ["old-public-widget"]);
});

test("automatic result row edit stores player kills for MVP widgets", () => {
  const service = new MessageRegistrationService({} as any) as any;
  const pending = {
    slots: [
      {
        id: "slot-1",
        slotNumber: 3,
        teamId: "team-1",
        team: { id: "team-1", tag: "DXB", name: "DXB" },
      },
    ],
  };
  const current = {
    position: 1,
    tag: "DXB",
    kills: 8,
    teamId: "team-1",
    slotId: "slot-1",
    slotNumber: 3,
    status: "OK",
    include: true,
    players: [{ name: "Old Player", kills: 8 }],
  };
  const values: Record<string, string> = {
    include: "yes",
    position: "1",
    kills: "8",
    slot: "3",
    players: "Alice=5\nBob=3",
  };
  const result = service.readEditedResultRow(
    {
      fields: {
        getTextInputValue: (field: string) => values[field] ?? "",
      },
    },
    pending,
    current,
  );

  assert.equal(result.ok, true);
  assert.deepEqual(result.row.players, [
    { name: "Alice", kills: 5 },
    { name: "Bob", kills: 3 },
  ]);
  assert.equal(result.row.edited, true);
});

test("automatic result row edit requires player kills to match team kills", () => {
  const service = new MessageRegistrationService({} as any) as any;
  const pending = {
    slots: [
      {
        id: "slot-1",
        slotNumber: 3,
        teamId: "team-1",
        team: { id: "team-1", tag: "DXB", name: "DXB" },
      },
    ],
  };
  const current = {
    position: 1,
    tag: "DXB",
    kills: 8,
    teamId: "team-1",
    slotId: "slot-1",
    slotNumber: 3,
    status: "OK",
    include: true,
  };
  const values: Record<string, string> = {
    include: "yes",
    position: "1",
    kills: "8",
    slot: "3",
    players: "Alice=5\nBob=2",
  };
  const result = service.readEditedResultRow(
    {
      fields: {
        getTextInputValue: (field: string) => values[field] ?? "",
      },
    },
    pending,
    current,
  );

  assert.equal(result.ok, false);
  assert.match(result.error, /add up to team kills/);
});

test("automatic final result posts match and overall widgets to results by default", async () => {
  let finalEdit: any = null;
  let managerPost: any = null;
  let applyNoShowOpts: any = null;
  let finalBanPreviewInput: any = null;
  let finalBanReviewPost: any = null;
  const operationOrder: string[] = [];
  const resultsPosts: any[] = [];
  const message = {
    id: "123456789012345683",
    author: {
      id: "staff-1",
      username: "staff",
      globalName: "Staff",
      bot: false,
      tag: "staff",
    },
    content: "G2",
    guild: { id: "guild-1" },
    channel: { id: "screenshots-channel" },
    member: {
      permissions: { has: () => true },
      roles: {
        cache: {
          has: () => false,
          some: () => false,
        },
      },
    },
    mentions: {
      users: new Map(),
      channels: { first: () => null },
    },
    attachments: {
      find: () => ({
        url: "https://cdn.discordapp.com/result.png",
        name: "result.png",
        contentType: "image/png",
      }),
    },
    client: { user: { id: "bot-1" } },
    reactions: {
      resolve: () => ({
        users: { remove: async () => undefined },
      }),
    },
    react: async () => undefined,
    reply: async () => ({
      edit: async () => undefined,
    }),
  };
  const sessionService = {
    findScrimForDiscordChannel: async () => ({
      session: { id: "session-1" },
      channelKind: "screenshots",
      config: {
        managerChannelId: "manager-channel",
        resultsChannelId: "results-channel",
        manageRoleIds: [],
        emojis: { banDefaultReason: "No-show" },
      },
    }),
    previewAutomaticResultScreenshot: async () => ({
      sessionId: "session-1",
      matchId: "match-2",
      matchLabel: "Match 2",
      imageUrl: "https://cdn.discordapp.com/result.png",
      mode: "results",
      content: "Automatic result preview\nMatch: Match 2",
      canApply: true,
      preview: {
        matchId: "match-2",
        preview: [
          {
            position: 1,
            tag: "DXB",
            kills: 8,
            teamId: "team-1",
            slotId: "slot-1",
            slotNumber: 3,
            status: "OK",
          },
        ],
        resolved: [],
        unresolved: [],
        ambiguous: [],
      },
      slots: [
        {
          id: "slot-1",
          matchId: "match-2",
          slotNumber: 3,
          teamId: "team-1",
          team: { id: "team-1", tag: "DXB" },
        },
      ],
    }),
    applyReviewedResults: async (...args: any[]) => {
      applyNoShowOpts = args[3];
      return {
        content: "Match widgets",
        publicContent: "Public match results",
        noShowCount: 1,
        imageFiles: [
          { name: "match-result.png", buffer: Buffer.from([1]) },
          { name: "overall-ranking.png", buffer: Buffer.from([2]) },
          { name: "top-mvp.png", buffer: Buffer.from([3]) },
          { name: "top-fraggers.png", buffer: Buffer.from([4]) },
        ],
      };
    },
    previewNoShowTeamBansFromDiscord: async (input: any) => {
      operationOrder.push("preview-no-show-ban-review");
      finalBanPreviewInput = input;
      return {
        response: {
          session: {
            id: "session-1",
            name: "Session 1",
            status: "LIVE",
          },
          match: {
            id: "session:session-1:no-shows",
            name: "Session 1 no-shows",
            matchNumber: null,
            status: "FINISHED",
          },
          scope: "SESSION",
          reason: "No-show",
          expiresAt: null,
          teams: [
            {
              teamId: "team-1",
              slotNumber: 3,
              team: { id: "team-1", name: "DXB", tag: "DXB" },
              alreadyBanned: false,
              missedMatches: [
                {
                  matchId: "match-1",
                  matchNumber: 1,
                  matchName: "Game 1",
                  slotNumber: 3,
                },
              ],
              managers: [
                {
                  discordUserId: "111111111111111111",
                  discordUsername: null,
                  displayName: null,
                },
              ],
            },
          ],
          noShowCount: 1,
          alreadyBannedCount: 0,
          creatableCount: 1,
          createdCount: 0,
          createdManagerBans: 0,
          createdBans: [],
        },
        content: "No-show ban preview",
      };
    },
    buildFinalResultPost: async () => ({
      content: "Final widgets",
      publicContent: "Public overall results",
      imageFiles: [
        { name: "overall-ranking.png", buffer: Buffer.from([2]) },
        { name: "overall-top-mvp.png", buffer: Buffer.from([3]) },
        { name: "overall-top-fraggers.png", buffer: Buffer.from([4]) },
        { name: "match-schedule.png", buffer: Buffer.from([5]) },
      ],
    }),
    resetSessionResultSystem: async () => {
      operationOrder.push("reset-result-system");
      return {
        sessionId: "session-1",
        organizationId: "org-1",
        matchesRemoved: 2,
        matchIds: ["match-1", "match-2"],
        reason: "Final result posted",
        resetAt: new Date().toISOString(),
      };
    },
  };
  const service = new MessageRegistrationService(sessionService as any);
  await service.handleMessage(message as any);

  const handled = await service.handleButton({
    customId: "result:auto:final:123456789012345683",
    user: { id: "staff-1", tag: "staff#0001" },
    memberPermissions: { has: () => true },
    member: null,
    deferUpdate: async () => undefined,
    editReply: async (payload: any) => {
      finalEdit = payload;
      return payload;
    },
    guild: {
      channels: {
        fetch: async (channelId: string) => ({
          send: async (payload: any) => {
            if (channelId === "manager-channel") {
              managerPost = payload;
            }
            if (channelId === "results-channel") {
              resultsPosts.push(payload);
            }
            return payload;
          },
        }),
      },
    },
    channel: {
      send: async (payload: any) => {
        operationOrder.push("post-no-show-ban-review");
        finalBanReviewPost = payload;
        return payload;
      },
    },
    reply: async () => undefined,
  } as any);

  assert.equal(handled, true);
  assert.match(finalEdit.content, /results-channel/);
  assert.match(
    finalEdit.content,
    /No-show ban review posted with 1 team candidate/,
  );
  assert.match(finalEdit.content, /Result system reset: 2 old matches removed/);
  assert.equal(applyNoShowOpts.markMissingSlotsNoShow, true);
  assert.deepEqual(finalBanPreviewInput, {
    sessionId: "session-1",
    scope: "SESSION",
    days: 3,
    reason: "No-show",
    note: "Created from Discord final no-show review for Match 2",
  });
  assert.match(finalBanReviewPost.content, /No-show Ban Review/);
  assert.deepEqual(operationOrder, [
    "preview-no-show-ban-review",
    "post-no-show-ban-review",
    "reset-result-system",
  ]);
  assert.match(finalBanReviewPost.content, /DXB \(DXB\) \| missed G1/);
  assert.match(finalBanReviewPost.content, /M1 <@111111111111111111>/);
  const reviewButtons = finalBanReviewPost.components[0]
    .toJSON()
    .components.map((component: any) => component.label);
  assert.deepEqual(reviewButtons, ["Edit Selection", "Apply Bans", "Cancel"]);
  assert.equal(managerPost, null);
  assert.equal(resultsPosts[0].content, "Public match results");
  assert.equal(resultsPosts[1].content, "Public overall results");
  assert.equal(resultsPosts[0].files.length, 4);
  assert.equal(resultsPosts[1].files.length, 4);
  assert.deepEqual(
    resultsPosts[1].files.map((file: { name?: string }) => file.name),
    [
      "overall-ranking.png",
      "overall-top-mvp.png",
      "overall-top-fraggers.png",
      "match-schedule.png",
    ],
  );
});

test("automatic final result applies configured no-show rules before reset", async () => {
  let finalEdit: any = null;
  let applyNoShowOpts: any = null;
  let autoBanInput: any = null;
  let finalBanReviewPosted = false;
  const operationOrder: string[] = [];
  const resultsPosts: any[] = [];
  const banPosts: any[] = [];
  const message = {
    id: "123456789012345684",
    author: {
      id: "staff-1",
      username: "staff",
      globalName: "Staff",
      bot: false,
      tag: "staff",
    },
    content: "G2",
    guild: { id: "guild-1" },
    channel: { id: "screenshots-channel" },
    member: {
      permissions: { has: () => true },
      roles: {
        cache: {
          has: () => false,
          some: () => false,
        },
      },
    },
    mentions: {
      users: new Map(),
      channels: { first: () => null },
    },
    attachments: {
      find: () => ({
        url: "https://cdn.discordapp.com/result.png",
        name: "result.png",
        contentType: "image/png",
      }),
    },
    client: { user: { id: "bot-1" } },
    reactions: {
      resolve: () => ({
        users: { remove: async () => undefined },
      }),
    },
    react: async () => undefined,
    reply: async () => ({
      edit: async () => undefined,
    }),
  };
  const sessionService = {
    findScrimForDiscordChannel: async () => ({
      session: { id: "session-1" },
      channelKind: "screenshots",
      config: {
        managerChannelId: "manager-channel",
        resultsChannelId: "results-channel",
        bansChannelId: "bans-channel",
        manageRoleIds: [],
        organizationId: "org-1",
        emojis: {
          banDefaultReason: "No-show",
          noShowBanRules: JSON.stringify([
            {
              enabled: true,
              misses: 1,
              durationDays: 3,
              scope: "SESSION",
              reason: "Missed {misses} match(es) in {session}",
            },
          ]),
        },
      },
    }),
    previewAutomaticResultScreenshot: async () => ({
      sessionId: "session-1",
      matchId: "match-2",
      matchLabel: "Match 2",
      imageUrl: "https://cdn.discordapp.com/result.png",
      mode: "results",
      content: "Automatic result preview\nMatch: Match 2",
      canApply: true,
      preview: {
        matchId: "match-2",
        preview: [
          {
            position: 1,
            tag: "DXB",
            kills: 8,
            teamId: "team-1",
            slotId: "slot-1",
            slotNumber: 3,
            status: "OK",
          },
        ],
        resolved: [],
        unresolved: [],
        ambiguous: [],
      },
      slots: [
        {
          id: "slot-1",
          matchId: "match-2",
          slotNumber: 3,
          teamId: "team-1",
          team: { id: "team-1", tag: "DXB" },
        },
        {
          id: "slot-2",
          matchId: "match-2",
          slotNumber: 4,
          teamId: "team-2",
          team: { id: "team-2", tag: "NS" },
        },
      ],
    }),
    applyReviewedResults: async (...args: any[]) => {
      applyNoShowOpts = args[3];
      return {
        content: "Match widgets",
        publicContent: "Public match results",
        noShowCount: 1,
        imageFiles: [
          { name: "match-result.png", buffer: Buffer.from([1]) },
          { name: "overall-ranking.png", buffer: Buffer.from([2]) },
        ],
      };
    },
    applyFinalNoShowAutoBansFromDiscord: async (...args: any[]) => {
      operationOrder.push("apply-auto-no-show-rules");
      autoBanInput = args;
      return {
        ok: true,
        matchId: "match-2",
        candidateTeamCount: 1,
        rulesConfigured: 1,
        createdTeamBans: 1,
        createdManagerBans: 1,
        createdTeamIds: ["team-2"],
        createdManagerDiscordUserIds: [
          "123456789012345678",
          "223456789012345678",
        ],
        createdBans: [
          {
            teamId: "team-2",
            teamName: "No Show",
            teamTag: "NS",
            scope: "SESSION",
            reason: "Missed 1 match(es) in Daily Scrim - Missed G1",
            expiresAt: new Date(
              Date.now() + 3 * 24 * 60 * 60 * 1000,
            ).toISOString(),
            durationDays: 3,
            missedMatches: ["G1"],
            managerDiscordUserIds: [
              "123456789012345678",
              "223456789012345678",
            ],
          },
        ],
        skippedAlreadyBanned: 0,
        skippedProtected: 0,
        skippedNoRule: 0,
        serverActionDetails: [
          "Server action: banned role(s) applied to 1/1 linked member(s): Banned.",
        ],
      };
    },
    previewNoShowTeamBansFromDiscord: async () => {
      throw new Error("manual no-show review should not be created");
    },
    buildFinalResultPost: async () => ({
      content: "Final widgets",
      publicContent: "Public overall results",
      imageFiles: [{ name: "overall-ranking.png", buffer: Buffer.from([2]) }],
    }),
    resetSessionResultSystem: async () => {
      operationOrder.push("reset-result-system");
      return {
        sessionId: "session-1",
        organizationId: "org-1",
        matchesRemoved: 2,
        matchIds: ["match-1", "match-2"],
        reason: "Final result posted",
        resetAt: new Date().toISOString(),
      };
    },
  };
  const service = new MessageRegistrationService(sessionService as any);
  await service.handleMessage(message as any);

  const guild = {
    id: "guild-1",
    members: {
      fetch: async (userId: string) =>
        userId === "123456789012345678"
          ? { user: { bot: false } }
          : null,
    },
    channels: {
      fetch: async (channelId: string) => ({
        isTextBased: () => true,
        isDMBased: () => false,
        send: async (payload: any) => {
          if (channelId === "bans-channel") {
            banPosts.push(payload);
          } else {
            resultsPosts.push(payload);
          }
          return payload;
        },
      }),
    },
  };
  const handled = await service.handleButton({
    customId: "result:auto:final:123456789012345684",
    user: { id: "staff-1", tag: "staff#0001" },
    memberPermissions: { has: () => true },
    member: null,
    deferUpdate: async () => undefined,
    editReply: async (payload: any) => {
      finalEdit = payload;
      return payload;
    },
    guild,
    channel: {
      send: async () => {
        finalBanReviewPosted = true;
      },
    },
    reply: async () => undefined,
  } as any);

  assert.equal(handled, true);
  assert.equal(applyNoShowOpts.markMissingSlotsNoShow, true);
  assert.deepEqual(autoBanInput[0], {
    matchId: "match-2",
    sessionId: "session-1",
  });
  assert.equal(autoBanInput[1], guild);
  assert.equal(autoBanInput[2].organizationId, "org-1");
  assert.deepEqual(operationOrder, [
    "apply-auto-no-show-rules",
    "reset-result-system",
  ]);
  assert.equal(finalBanReviewPosted, false);
  assert.match(
    finalEdit.content,
    /Automatic no-show rules applied: 1 team ban\(s\), 1 manager ban\(s\)\./,
  );
  assert.match(
    finalEdit.content,
    /Banned teams report posted to <#bans-channel>\./,
  );
  assert.match(
    finalEdit.content,
    /banned role\(s\) applied to 1\/1 linked member/,
  );
  assert.doesNotMatch(finalEdit.content, /No-show ban review posted/);
  assert.equal(resultsPosts.length, 2);
  assert.equal(banPosts.length, 1);
  assert.match(
    banPosts[0].content,
    /banned role\(s\) applied to 1\/1 linked member/,
  );
  assert.match(banPosts[0].content, /Banned teams:/);
  assert.match(
    banPosts[0].content,
    /No Show \(NS\): managers <@123456789012345678>, Discord ID 223456789012345678; missed G1;/,
  );
  assert.match(
    banPosts[0].content,
    /reason: Missed 1 match\(es\) in Daily Scrim - Missed G1;/,
  );
  assert.deepEqual(banPosts[0].allowedMentions, {
    parse: [],
    users: ["123456789012345678"],
  });
  assert.doesNotMatch(banPosts[0].content, /<@223456789012345678>/);
});

test("final no-show ban review applies only selected teams and managers", async () => {
  let appliedCommand: any = null;
  let updatePayload: any = null;
  let editPayload: any = null;
  const service = new MessageRegistrationService({
    createNoShowTeamBansFromDiscord: async (command: any) => {
      appliedCommand = command;
      return "No-show bans completed.\nTeam bans created: 1\nManager bans: 1";
    },
  } as any) as any;

  service.pendingFinalNoShowBanReviews.set("token-123", {
    userId: "staff-1",
    sessionId: "session-1",
    matchId: "match-2",
    command: {
      sessionId: "session-1",
      scope: "SESSION",
      days: 3,
      reason: "No-show",
      note: "Created from Discord final no-show review for Match 2",
    },
    config: { organizationId: "org-1", manageRoleIds: [], emojis: {} },
    preview: {
      session: { id: "session-1", name: "Session 1", status: "LIVE" },
      match: {
        id: "session:session-1:no-shows",
        name: "Session 1 no-shows",
        matchNumber: null,
        status: "FINISHED",
      },
      scope: "SESSION",
      reason: "No-show",
      expiresAt: null,
      teams: [
        {
          teamId: "team-1",
          slotNumber: 3,
          team: { id: "team-1", name: "DXB", tag: "DXB" },
          alreadyBanned: false,
          missedMatches: [
            {
              matchId: "match-1",
              matchNumber: 1,
              matchName: "Game 1",
              slotNumber: 3,
            },
          ],
          managers: [
            {
              discordUserId: "111111111111111111",
              discordUsername: null,
              displayName: null,
            },
          ],
        },
        {
          teamId: "team-2",
          slotNumber: 4,
          team: { id: "team-2", name: "NXT", tag: "NXT" },
          alreadyBanned: false,
          missedMatches: [
            {
              matchId: "match-2",
              matchNumber: 2,
              matchName: "Game 2",
              slotNumber: 4,
            },
          ],
          managers: [
            {
              discordUserId: "222222222222222222",
              discordUsername: null,
              displayName: null,
            },
          ],
        },
      ],
      noShowCount: 2,
      alreadyBannedCount: 0,
      creatableCount: 2,
      createdCount: 0,
      createdManagerBans: 0,
      createdBans: [],
    },
    selectedTeamIds: new Set(["team-1"]),
    selectedManagerIds: new Set(["111111111111111111"]),
    expiresAt: Date.now() + 60_000,
  });

  const handled = await service.handleButton({
    customId: "result:auto:final-ban-apply:token-123",
    user: { id: "staff-1", tag: "staff#0001" },
    memberPermissions: { has: () => true },
    member: null,
    guild: { id: "guild-1" },
    channelId: "screenshots-channel",
    update: async (payload: any) => {
      updatePayload = payload;
      return payload;
    },
    editReply: async (payload: any) => {
      editPayload = payload;
      return payload;
    },
    reply: async () => undefined,
  } as any);

  assert.equal(handled, true);
  assert.match(updatePayload.content, /Applying no-show bans/);
  assert.deepEqual(appliedCommand, {
    sessionId: "session-1",
    scope: "SESSION",
    days: 3,
    reason: "No-show",
    note: "Created from Discord final no-show review for Match 2",
    teamIds: ["team-1"],
    managerDiscordUserIds: ["111111111111111111"],
  });
  assert.match(editPayload.content, /No-show bans completed/);
  assert.equal(service.pendingFinalNoShowBanReviews.has("token-123"), false);
});

test("final no-show ban review modal removes teams and managers before apply", async () => {
  let updatePayload: any = null;
  const service = new MessageRegistrationService({} as any) as any;
  service.pendingFinalNoShowBanReviews.set("token-456", {
    userId: "staff-1",
    sessionId: "session-1",
    matchId: "match-2",
    command: {
      sessionId: "session-1",
      scope: "SESSION",
      days: 3,
      reason: "No-show",
      note: "Created from Discord final no-show review for Match 2",
    },
    config: { organizationId: "org-1", manageRoleIds: [], emojis: {} },
    preview: {
      session: { id: "session-1", name: "Session 1", status: "LIVE" },
      match: {
        id: "session:session-1:no-shows",
        name: "Session 1 no-shows",
        matchNumber: null,
        status: "FINISHED",
      },
      scope: "SESSION",
      reason: "No-show",
      expiresAt: null,
      teams: [
        {
          teamId: "team-1",
          slotNumber: 3,
          team: { id: "team-1", name: "DXB", tag: "DXB" },
          alreadyBanned: false,
          missedMatches: [
            {
              matchId: "match-1",
              matchNumber: 1,
              matchName: "Game 1",
              slotNumber: 3,
            },
          ],
          managers: [
            {
              discordUserId: "111111111111111111",
              discordUsername: null,
              displayName: null,
            },
          ],
        },
        {
          teamId: "team-2",
          slotNumber: 4,
          team: { id: "team-2", name: "NXT", tag: "NXT" },
          alreadyBanned: false,
          missedMatches: [
            {
              matchId: "match-2",
              matchNumber: 2,
              matchName: "Game 2",
              slotNumber: 4,
            },
          ],
          managers: [
            {
              discordUserId: "222222222222222222",
              discordUsername: null,
              displayName: null,
            },
          ],
        },
      ],
      noShowCount: 2,
      alreadyBannedCount: 0,
      creatableCount: 2,
      createdCount: 0,
      createdManagerBans: 0,
      createdBans: [],
    },
    selectedTeamIds: new Set(["team-1", "team-2"]),
    selectedManagerIds: new Set(["111111111111111111", "222222222222222222"]),
    expiresAt: Date.now() + 60_000,
  });

  const handled = await service.handleModalSubmit({
    customId: "result:auto:final-ban-modal:token-456",
    user: { id: "staff-1", tag: "staff#0001" },
    memberPermissions: { has: () => true },
    member: null,
    fields: {
      getTextInputValue: (field: string) =>
        field === "teamNumbers" ? "1" : "1",
    },
    update: async (payload: any) => {
      updatePayload = payload;
      return payload;
    },
    reply: async () => undefined,
  } as any);

  const review = service.pendingFinalNoShowBanReviews.get("token-456");
  assert.equal(handled, true);
  assert.deepEqual([...review.selectedTeamIds], ["team-1"]);
  assert.deepEqual([...review.selectedManagerIds], ["111111111111111111"]);
  assert.match(updatePayload.content, /Selected teams: 1\/2/);
  assert.doesNotMatch(updatePayload.content, /NXT/);
});

test("automatic result posting prefers configured output channels", () => {
  const service = new MessageRegistrationService({} as any) as any;
  const baseConfig = {
    managerChannelId: "manager-channel",
    resultsChannelId: "results-channel",
    emojis: {},
  };

  assert.equal(service.matchResultPostChannelId(baseConfig), "results-channel");
  assert.equal(
    service.overallResultPostChannelId(baseConfig),
    "results-channel",
  );
  assert.equal(
    service.matchResultPostChannelId({
      ...baseConfig,
      emojis: { matchResultPostChannelId: "custom-match-channel" },
    }),
    "custom-match-channel",
  );
  assert.equal(
    service.overallResultPostChannelId({
      ...baseConfig,
      emojis: { overallResultPostChannelId: "custom-overall-channel" },
    }),
    "custom-overall-channel",
  );
});

test("automatic result apply blocks auto-skipped rows until staff confirms them", async () => {
  let applied = false;
  let editedReply: any = null;
  let replyPayload: any = null;
  const message = {
    id: "123456789012345682",
    author: {
      id: "staff-1",
      username: "staff",
      globalName: "Staff",
      bot: false,
      tag: "staff",
    },
    content: "G1",
    guild: { id: "guild-1" },
    channel: { id: "screenshots-channel" },
    member: {
      permissions: { has: () => true },
      roles: {
        cache: {
          has: () => false,
          some: () => false,
        },
      },
    },
    mentions: {
      users: new Map(),
      channels: { first: () => null },
    },
    attachments: {
      find: () => ({
        url: "https://cdn.discordapp.com/result.png",
        name: "result.png",
        contentType: "image/png",
      }),
    },
    client: { user: { id: "bot-1" } },
    reactions: {
      resolve: () => ({
        users: { remove: async () => undefined },
      }),
    },
    react: async () => undefined,
    reply: async () => ({
      edit: async (payload: any) => {
        editedReply = payload;
        return payload;
      },
    }),
  };
  const okRow = {
    position: 1,
    tag: "DXB",
    kills: 8,
    teamId: "team-1",
    slotId: "slot-1",
    slotNumber: 3,
    status: "OK",
  };
  const skippedRow = {
    position: 2,
    tag: "MISS",
    kills: 4,
    teamId: null,
    slotId: null,
    slotNumber: null,
    status: "UNRESOLVED",
    reason: "TEAM_TAG_NOT_FOUND",
  };
  const sessionService = {
    findScrimForDiscordChannel: async () => ({
      session: { id: "session-1" },
      channelKind: "screenshots",
      config: {
        manageRoleIds: [],
        emojis: {},
      },
    }),
    previewAutomaticResultScreenshot: async () => ({
      sessionId: "session-1",
      matchId: "match-1",
      matchLabel: "Match 1",
      imageUrl: "https://cdn.discordapp.com/result.png",
      mode: "results",
      content: "Automatic result preview\nMatch: Match 1",
      canApply: false,
      preview: {
        matchId: "match-1",
        preview: [okRow, skippedRow],
        resolved: [okRow],
        unresolved: [skippedRow],
        ambiguous: [],
      },
      slots: [
        {
          id: "slot-1",
          matchId: "match-1",
          slotNumber: 3,
          teamId: "team-1",
          team: { id: "team-1", tag: "DXB" },
        },
      ],
    }),
    applyReviewedResults: async () => {
      applied = true;
      return { content: "Should not apply" };
    },
  };
  const service = new MessageRegistrationService(sessionService as any);
  await service.handleMessage(message as any);

  const applyButton = editedReply.components[1].toJSON().components[1];
  assert.equal(applyButton.disabled, true);
  assert.match(editedReply.content, /row 2 is skipped/i);

  const handled = await service.handleButton({
    customId: "result:auto:apply:123456789012345682",
    memberPermissions: { has: () => true },
    member: null,
    reply: async (payload: any) => {
      replyPayload = payload;
      return payload;
    },
  } as any);

  assert.equal(handled, true);
  assert.equal(applied, false);
  assert.match(replyPayload.content, /row 2 is skipped/i);
  assert.equal(replyPayload.ephemeral, true);
});

test("automatic result review auto-skips duplicate OCR team rows", () => {
  const service = new MessageRegistrationService({} as any) as any;
  const rows = service.toReviewedRows({
    preview: {
      preview: [
        {
          position: 1,
          tag: "DXB",
          kills: 8,
          teamId: "team-1",
          slotId: "slot-1",
          slotNumber: 3,
          status: "OK",
        },
        {
          position: 1,
          tag: "DXB",
          kills: 3,
          teamId: "team-1",
          slotId: "slot-1",
          slotNumber: 3,
          status: "OK",
        },
        {
          position: 2,
          tag: "NXT",
          kills: 4,
          teamId: "team-2",
          slotId: "slot-2",
          slotNumber: 4,
          status: "OK",
        },
      ],
    },
  });
  const pending = {
    sourceGuildId: "guild-1",
    sourceChannelId: "screenshots-channel",
    sourceMessageId: "123456789012345686",
    matchLabel: "Match 1",
    imageUrls: ["https://cdn.discordapp.com/result.png"],
    config: { emojis: {} },
    rows,
    slots: [
      {
        id: "slot-1",
        matchId: "match-1",
        slotNumber: 3,
        teamId: "team-1",
        team: { id: "team-1", tag: "DXB" },
      },
      {
        id: "slot-2",
        matchId: "match-1",
        slotNumber: 4,
        teamId: "team-2",
        team: { id: "team-2", tag: "NXT" },
      },
    ],
  };

  assert.equal(rows[0].include, true);
  assert.equal(rows[1].include, false);
  assert.equal(rows[1].autoSkipped, true);
  assert.match(rows[1].autoSkipReason, /duplicate official slot/i);
  assert.equal(rows[2].include, true);
  assert.deepEqual(service.reviewIssues(pending), []);
  assert.match(
    service.formatAutoResultDashboard(pending),
    /Auto-skipped duplicates: 1/,
  );
  assert.match(service.formatAutoResultDetails(pending), /\[auto-skip\]/);
  assert.match(service.formatAutoResultDetails(pending), /duplicate team DXB/i);
});

test("automatic result review describes unreadable kills on matched rows", () => {
  const service = new MessageRegistrationService({} as any) as any;
  const pending = {
    sourceGuildId: "guild-1",
    sourceChannelId: "screenshots-channel",
    sourceMessageId: "123456789012345687",
    matchLabel: "Match 1",
    imageUrls: ["https://cdn.discordapp.com/result.png"],
    config: { emojis: {} },
    rows: [
      {
        position: 9,
        tag: "AG",
        kills: 0,
        teamId: "team-ag",
        slotId: "slot-23",
        slotNumber: 23,
        status: "UNRESOLVED",
        reason: "OCR_KILLS_UNREADABLE",
        include: false,
      },
      {
        position: 10,
        tag: "FNC",
        kills: 2,
        teamId: "team-fnc",
        slotId: "slot-6",
        slotNumber: 6,
        status: "OK",
        include: true,
      },
    ],
    slots: [],
  };

  assert.deepEqual(service.reviewIssues(pending), [
    "row 1 has unreadable kills for AG slot 23. Edit kills or confirm skip.",
    "Missing placement row(s): 1, 2, 3, 4, 5, 6, 7, 8, 9. Edit a skipped OCR row, use Add Row, or resend the complete result screenshots before applying.",
  ]);
  assert.doesNotMatch(
    service.formatAutoResultDashboard(pending),
    /row 1 is skipped/i,
  );
});

test("automatic result apply blocks missing placement rows", async () => {
  let applied = false;
  let editedReply: any = null;
  let replyPayload: any = null;
  const message = {
    id: "123456789012345684",
    author: {
      id: "staff-1",
      username: "staff",
      globalName: "Staff",
      bot: false,
      tag: "staff",
    },
    content: "G1",
    guild: { id: "guild-1" },
    channel: { id: "screenshots-channel" },
    member: {
      permissions: { has: () => true },
      roles: {
        cache: {
          has: () => false,
          some: () => false,
        },
      },
    },
    mentions: {
      users: new Map(),
      channels: { first: () => null },
    },
    attachments: {
      find: () => ({
        url: "https://cdn.discordapp.com/result.png",
        name: "result.png",
        contentType: "image/png",
      }),
    },
    client: { user: { id: "bot-1" } },
    reactions: {
      resolve: () => ({
        users: { remove: async () => undefined },
      }),
    },
    react: async () => undefined,
    reply: async () => ({
      edit: async (payload: any) => {
        editedReply = payload;
        return payload;
      },
    }),
  };
  const firstRow = {
    position: 1,
    tag: "DXB",
    kills: 8,
    teamId: "team-1",
    slotId: "slot-1",
    slotNumber: 3,
    status: "OK",
  };
  const thirdRow = {
    position: 3,
    tag: "NXT",
    kills: 4,
    teamId: "team-2",
    slotId: "slot-2",
    slotNumber: 4,
    status: "OK",
  };
  const sessionService = {
    findScrimForDiscordChannel: async () => ({
      session: { id: "session-1" },
      channelKind: "screenshots",
      config: {
        manageRoleIds: [],
        emojis: {},
      },
    }),
    previewAutomaticResultScreenshot: async () => ({
      sessionId: "session-1",
      matchId: "match-1",
      matchLabel: "Match 1",
      imageUrl: "https://cdn.discordapp.com/result.png",
      mode: "results",
      content: "Automatic result preview\nMatch: Match 1",
      canApply: true,
      preview: {
        matchId: "match-1",
        preview: [firstRow, thirdRow],
        resolved: [firstRow, thirdRow],
        unresolved: [],
        ambiguous: [],
      },
      slots: [
        {
          id: "slot-1",
          matchId: "match-1",
          slotNumber: 3,
          teamId: "team-1",
          team: { id: "team-1", tag: "DXB" },
        },
        {
          id: "slot-2",
          matchId: "match-1",
          slotNumber: 4,
          teamId: "team-2",
          team: { id: "team-2", tag: "NXT" },
        },
      ],
    }),
    applyReviewedResults: async () => {
      applied = true;
      return { content: "Should not apply" };
    },
  };
  const service = new MessageRegistrationService(sessionService as any);
  await service.handleMessage(message as any);

  const applyButton = editedReply.components[1].toJSON().components[1];
  assert.equal(applyButton.disabled, true);
  assert.match(editedReply.content, /Missing placement row\(s\): 2/i);

  const handled = await service.handleButton({
    customId: "result:auto:apply:123456789012345684",
    memberPermissions: { has: () => true },
    member: null,
    reply: async (payload: any) => {
      replyPayload = payload;
      return payload;
    },
  } as any);

  assert.equal(handled, true);
  assert.equal(applied, false);
  assert.match(replyPayload.content, /Missing placement row\(s\): 2/i);
  assert.equal(replyPayload.ephemeral, true);
});

test("automatic result review exposes add row for missing placements", () => {
  const service = new MessageRegistrationService({} as any) as any;
  const pending = {
    sourceMessageId: "123456789012345684",
    rows: [
      {
        position: 1,
        tag: "DXB",
        kills: 8,
        teamId: "team-1",
        slotId: "slot-1",
        slotNumber: 3,
        status: "OK",
        include: true,
      },
      {
        position: 3,
        tag: "NXT",
        kills: 4,
        teamId: "team-2",
        slotId: "slot-2",
        slotNumber: 4,
        status: "OK",
        include: true,
      },
    ],
    slots: [],
    config: { emojis: {} },
  };

  const components = service.autoResultComponents(pending);
  const reviewButtons = components[2].toJSON().components;
  const addButton = reviewButtons.find(
    (component: any) =>
      component.custom_id === "result:auto:add-row:123456789012345684",
  );
  assert.equal(addButton.label, "Add Row");

  const modal = service
    .buildAutoResultAddRowModal("123456789012345684", pending)
    .toJSON();
  assert.equal(modal.custom_id, "result:auto:add-modal:123456789012345684");
  assert.equal(modal.components[0].components[0].value, "2");
});

test("automatic result add row maps official slot to reviewed row", () => {
  const service = new MessageRegistrationService({} as any) as any;
  const fields = new Map([
    ["position", "2"],
    ["kills", "5"],
    ["slot", "4"],
    ["players", "Player One=3\nPlayer Two=2"],
  ]);
  const pending = {
    slots: [
      {
        id: "slot-4",
        matchId: "match-1",
        slotNumber: 4,
        teamId: "team-4",
        team: { id: "team-4", name: "Next Team", tag: "NXT" },
      },
    ],
  };

  const result = service.readAddedResultRow(
    {
      fields: {
        getTextInputValue: (customId: string) => fields.get(customId) ?? "",
      },
    },
    pending,
  );

  assert.equal(result.ok, true);
  assert.equal(result.row.include, true);
  assert.equal(result.row.edited, true);
  assert.equal(result.row.status, "OK");
  assert.equal(result.row.position, 2);
  assert.equal(result.row.kills, 5);
  assert.equal(result.row.slotId, "slot-4");
  assert.equal(result.row.teamId, "team-4");
  assert.equal(result.row.slotNumber, 4);
  assert.equal(result.row.tag, "NXT");
  assert.deepEqual(result.row.players, [
    { name: "Player One", kills: 3 },
    { name: "Player Two", kills: 2 },
  ]);
});

test("automatic result review lists official slots missing from applied OCR rows", () => {
  const service = new MessageRegistrationService({} as any) as any;
  const pending = {
    sourceGuildId: "guild-1",
    sourceChannelId: "screenshots-channel",
    sourceMessageId: "123456789012345685",
    matchLabel: "Match 1",
    imageUrls: ["https://cdn.discordapp.com/result.png"],
    config: { emojis: {} },
    rows: [
      {
        position: 1,
        tag: "DXB",
        kills: 8,
        teamId: "team-1",
        slotId: "slot-3",
        slotNumber: 3,
        status: "OK",
        include: true,
      },
      {
        position: 2,
        tag: "MISS",
        kills: 4,
        teamId: null,
        slotId: null,
        slotNumber: null,
        status: "UNRESOLVED",
        reason: "TEAM_TAG_NOT_FOUND",
        include: false,
      },
    ],
    slots: [
      {
        id: "slot-3",
        matchId: "match-1",
        slotNumber: 3,
        teamId: "team-1",
        team: { id: "team-1", name: "Dubai", tag: "DXB" },
      },
      {
        id: "slot-16",
        matchId: "match-1",
        slotNumber: 16,
        teamId: "team-16",
        team: { id: "team-16", name: "Kinetic Hub", tag: "KH" },
      },
      {
        id: "slot-17",
        matchId: "match-1",
        slotNumber: 17,
        teamId: null,
        team: null,
      },
    ],
  };

  const dashboard = service.formatAutoResultDashboard(pending);
  assert.match(dashboard, /Missing official slots: 1/);
  assert.match(dashboard, /Slot 16 KH - Kinetic Hub/);
  assert.doesNotMatch(dashboard, /Slot 17/);

  const details = service.formatAutoResultDetails(pending);
  assert.match(details, /Missing official slots \/ not applied from OCR \(1\):/);
  assert.match(details, /- Slot 16 KH - Kinetic Hub/);
  assert.doesNotMatch(details, /Slot 17/);
});

test("automatic result review paginates every skipped row and missing official slot", () => {
  const service = new MessageRegistrationService({} as any) as any;
  const rows = Array.from({ length: 30 }, (_, index) => {
    const number = index + 1;
    return {
      position: number,
      tag: `T${number}`,
      kills: 0,
      teamId: null,
      slotId: null,
      slotNumber: null,
      status: "UNRESOLVED",
      reason: "TEAM_TAG_NOT_FOUND",
      include: false,
    };
  });
  const slots = Array.from({ length: 30 }, (_, index) => {
    const number = index + 1;
    return {
      id: `slot-${number}`,
      matchId: "match-1",
      slotNumber: number,
      teamId: `team-${number}`,
      team: { id: `team-${number}`, name: `Team ${number}`, tag: `T${number}` },
    };
  });
  const pending = {
    sourceGuildId: "guild-1",
    sourceChannelId: "screenshots-channel",
    sourceMessageId: "123456789012345685",
    matchLabel: "Match 1",
    imageUrls: ["https://cdn.discordapp.com/result.png"],
    config: { emojis: {} },
    rows,
    slots,
  };

  const pageCount = service.autoResultDetailPageCount(pending);
  assert.ok(pageCount > 1);

  const combined = Array.from({ length: pageCount }, (_, page) =>
    service.formatAutoResultDetails(pending, page),
  ).join("\n");

  assert.match(combined, /\[skip\] 30\) P30 T30 no slot - 0 kills/);
  assert.match(combined, /- Slot 30 T30 - Team 30/);
  assert.doesNotMatch(combined, /\+\d+ more/);
  assert.doesNotMatch(combined, /more rows/);
  assert.doesNotMatch(combined, /Output truncated/);

  const components = service.autoResultPreviewComponents(pending, 0);
  assert.match(
    components[0].toJSON().components[2].custom_id,
    /result:auto:preview-page:123456789012345685:1/,
  );
});
