import assert from "node:assert/strict";
import test from "node:test";
import {
  ChannelType,
  Collection,
  EmbedBuilder,
  MessageType,
  OverwriteType,
  PermissionFlagsBits,
} from "discord.js";
import sharp from "sharp";
import { fetchRemoteRasterImage } from "../security/remote-image";
import { ScrimDiscordSetupService } from "./scrim-discord-setup.service";
import {
  SlotRosterImageRenderer,
  slotRosterImageLimits,
} from "./slot-roster-image";

function setupPayload() {
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
    publicChatChannelId: "public-chat-channel",
    publicChatChannelName: "public-chat",
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
    waitlistRoleId: "waitlist-role",
    waitlistRoleName: "Waitlist",
    idpRoleId: "idp-role",
    idpRoleName: "IDP",
    bannedRoleId: "banned-role",
    bannedRoleName: "Banned",
  };
}

function sessionPayload() {
  return {
    id: "session-1",
    name: "Scrim",
    status: "OPEN",
    slotCount: 25,
    registrationOpenAt: null,
    registrationCloseAt: null,
  };
}

function registrationPayload() {
  return {
    id: "registration-1",
    teamId: "team-1",
    leaderDiscordUserId: null,
    managerDiscordUserIds: [],
    status: "WAITLIST",
    slotNumber: null,
    waitlistPosition: 1,
    team: {
      id: "team-1",
      name: "CLSX",
      tag: "CLSX",
      logoUrl: null,
    },
  };
}

test("registration manage buttons keep clean labels when custom emojis are unavailable", async () => {
  let sentPayload: any = null;
  const channel = {
    type: ChannelType.GuildText,
    send: async (payload: any) => {
      sentPayload = payload;
      return {};
    },
  };
  const guild = {
    channels: { fetch: async () => channel },
    emojis: {
      cache: new Collection(),
      fetch: async () => null,
    },
  };

  await new ScrimDiscordSetupService().sendRegistrationManagePanel(
    guild as any,
    setupPayload() as any,
    sessionPayload() as any,
    registrationPayload() as any,
    {
      emojis: {
        check: "<:beoYES:1425255824464412764>",
        slot: "📋",
        waitlist: "🕘",
        vip: "<:4bsVIP23:1502057342014066849>",
        reject: "<:beoNO:1425255906437890052>",
        ban: "??",
        team: "🦉",
      },
    } as any,
  );

  const buttons = sentPayload.components[0].components.map((button: any) =>
    button.toJSON(),
  );
  assert.deepEqual(
    buttons.map((button: any) => button.label),
    ["Approve", "Set Slot", "Waitlist", "VIP", "Remove"],
  );
  assert.equal(buttons[0].emoji, undefined);
  assert.equal(buttons[1].emoji?.name, "📋");
  assert.equal(buttons[2].emoji?.name, "🕘");
  assert.equal(buttons[3].emoji, undefined);
  assert.equal(buttons[4].emoji, undefined);

  const banButtons = sentPayload.components[1].components.map((button: any) =>
    button.toJSON(),
  );
  assert.deepEqual(
    banButtons.map((button: any) => button.label),
    ["Ban", "Permanent Ban"],
  );
  assert.deepEqual(
    banButtons.map((button: any) => button.custom_id),
    ["cardban:d:session-1:team-1", "cardban:p:session-1:team-1"],
  );
  assert.deepEqual(
    banButtons.map((button: any) => button.emoji),
    [undefined, undefined],
  );
});

test("ensure setup preserves existing channels when use-existing is enabled", async () => {
  const service = new ScrimDiscordSetupService() as any;
  const preserveFlags: boolean[] = [];

  service.ensureStaffRole = async () => ({ id: "staff-role", name: "Staff" });
  service.ensureSessionRoles = async () => ({
    slotRole: { id: "slot-role", name: "Slot" },
    waitlistRole: { id: "waitlist-role", name: "Waitlist" },
    idpRole: { id: "idp-role", name: "IDP" },
    legacyIdpRole: null,
    bannedRole: { id: "banned-role", name: "Banned" },
  });
  service.ensureCategory = async () => ({ id: "category-1", name: "Category" });
  service.staffRoles = () => [];
  service.registrationOverwrites = () => [];
  service.protectedOverwrites = () => [];
  service.publicWritableOverwrites = () => [];
  service.roleWritableOverwrites = () => [];
  service.staffOnlyOverwrites = () => [];
  service.upsertRegistrationPanel = async () => undefined;
  service.ensureTextChannel = async (
    _guild: unknown,
    _categoryId: string,
    _sessionId: string,
    kind: string,
    name: string,
    _configuredId: string | null | undefined,
    _permissionOverwrites: unknown[],
    preserveExistingChannels: boolean,
  ) => {
    preserveFlags.push(preserveExistingChannels);
    return {
      id: `${kind}-channel`,
      name,
      type: ChannelType.GuildText,
    };
  };

  await service.ensureSetup(
    {
      channels: { fetch: async () => undefined },
      roles: { fetch: async () => undefined },
    },
    sessionPayload(),
    {
      emojis: {
        discordUseExistingChannels: "true",
        discordManageExistingChannels: "true",
      },
    },
  );

  assert.equal(preserveFlags.length, 12);
  assert.ok(preserveFlags.every(Boolean));
});

test("ensure session roles keeps a configured IDP role separate from slot", async () => {
  const service = new ScrimDiscordSetupService() as any;
  const roleByKind = {
    Slot: { id: "slot-role", name: "Slot" },
    Waitlist: { id: "waitlist-role", name: "Waitlist" },
    IDP: { id: "idp-role", name: "IDP" },
    Banned: { id: "banned-role", name: "Banned" },
  } as const;
  const ensuredKinds: string[] = [];
  service.ensureRole = async (_guild: unknown, _session: unknown, kind: keyof typeof roleByKind) => {
    ensuredKinds.push(kind);
    return roleByKind[kind];
  };

  const roles = await service.ensureSessionRoles(
    {} as any,
    sessionPayload(),
    setupPayload(),
    false,
  );

  assert.equal(roles.slotRole.id, "slot-role");
  assert.equal(roles.idpRole.id, "idp-role");
  assert.deepEqual(ensuredKinds, ["Slot", "Waitlist", "IDP", "Banned"]);
});

test("configured existing channel is not edited while preserving existing channels", async () => {
  const service = new ScrimDiscordSetupService() as any;
  let editCount = 0;
  let createCount = 0;
  const channel = {
    id: "mapped-channel",
    type: ChannelType.GuildText,
    name: "20丨registration",
    parentId: "original-category",
    topic: "original topic",
    edit: async () => {
      editCount += 1;
      throw new Error("existing channel should not be edited");
    },
  };

  const result = await service.ensureTextChannel(
    {
      channels: {
        cache: new Collection(),
        fetch: async (channelId: string) =>
          channelId === channel.id ? channel : null,
        create: async () => {
          createCount += 1;
          throw new Error("existing channel should not be recreated");
        },
      },
    },
    "new-category",
    "session-1",
    "registration",
    "20-registration",
    channel.id,
    [{ id: "everyone-role", deny: [] }],
    true,
  );

  assert.equal(result, channel);
  assert.equal(editCount, 0);
  assert.equal(createCount, 0);
});

test("preserved bot-controlled channels only patch reaction and thread bits", async () => {
  const service = new ScrimDiscordSetupService() as any;
  let editCount = 0;
  const permissionEdits: any[] = [];
  const permissionCache = new Collection<string, any>([
    [
      "guild-1",
      {
        id: "guild-1",
        type: OverwriteType.Role,
        allow: { has: () => false },
        deny: { has: () => false },
      },
    ],
    [
      "extra-role",
      {
        id: "extra-role",
        type: OverwriteType.Role,
        allow: {
          has: (permission: bigint) =>
            permission === PermissionFlagsBits.AddReactions,
        },
        deny: { has: () => false },
      },
    ],
    [
      "staff-role",
      {
        id: "staff-role",
        type: OverwriteType.Role,
        allow: { has: () => false },
        deny: { has: () => false },
      },
    ],
  ]);
  const channel = {
    id: "mapped-slot-list",
    type: ChannelType.GuildText,
    name: "custom-slot-list",
    parentId: "original-category",
    topic: "original topic",
    permissionOverwrites: {
      cache: permissionCache,
      edit: async (target: string, options: unknown, overwriteOptions: any) => {
        permissionEdits.push({
          target,
          options,
          type: overwriteOptions?.type,
          reason: overwriteOptions?.reason,
        });
        return channel;
      },
    },
    edit: async () => {
      editCount += 1;
      throw new Error("existing channel should not be edited");
    },
  };

  const result = await service.ensureTextChannel(
    {
      client: { user: { id: "bot-user" } },
      members: { me: { id: "bot-user" } },
      roles: {
        everyone: { id: "guild-1" },
        cache: new Collection(),
      },
      channels: {
        cache: new Collection(),
        fetch: async (channelId: string) =>
          channelId === channel.id ? channel : null,
        create: async () => {
          throw new Error("existing channel should not be recreated");
        },
      },
    },
    "new-category",
    "session-1",
    "slot-list",
    "slot-list",
    channel.id,
    [
      {
        id: "guild-1",
        deny: [PermissionFlagsBits.ViewChannel],
      },
      {
        id: "slot-role",
        deny: [PermissionFlagsBits.SendMessages],
      },
      {
        id: "staff-role",
        allow: [PermissionFlagsBits.ManageMessages],
      },
    ],
    true,
    false,
  );

  assert.equal(result, channel);
  assert.equal(editCount, 0);
  assert.deepEqual(
    permissionEdits.map((entry) => entry.target).sort(),
    ["bot-user", "extra-role", "guild-1", "slot-role", "staff-role"],
  );
  const everyoneEdit = permissionEdits.find(
    (entry) => entry.target === "guild-1",
  );
  assert.equal(everyoneEdit.type, OverwriteType.Role);
  assert.deepEqual(everyoneEdit.options, {
    AddReactions: false,
    CreatePublicThreads: false,
    CreatePrivateThreads: false,
    SendMessagesInThreads: false,
  });
  const staffEdit = permissionEdits.find(
    (entry) => entry.target === "staff-role",
  );
  assert.equal(staffEdit.type, OverwriteType.Role);
  assert.deepEqual(staffEdit.options, {
    AddReactions: true,
    CreatePublicThreads: true,
    CreatePrivateThreads: true,
    SendMessagesInThreads: true,
  });
  const botEdit = permissionEdits.find((entry) => entry.target === "bot-user");
  assert.equal(botEdit.type, OverwriteType.Member);
  assert.match(botEdit.reason, /slot-list reaction\/thread permission lock/);
});

test("preserved registration channels patch send access without rewriting metadata", async () => {
  const service = new ScrimDiscordSetupService() as any;
  let editCount = 0;
  const permissionEdits: any[] = [];
  const permissionDeletes: any[] = [];
  const permissionCache = new Collection<string, any>([
    [
      "guild-1",
      {
        id: "guild-1",
        type: OverwriteType.Role,
        allow: {
          has: (permission: bigint) =>
            permission === PermissionFlagsBits.SendMessages,
        },
        deny: { has: () => false },
      },
    ],
    [
      "registration-role",
      {
        id: "registration-role",
        type: OverwriteType.Role,
        allow: {
          has: (permission: bigint) =>
            permission === PermissionFlagsBits.SendMessages,
        },
        deny: { has: () => false },
      },
    ],
    [
      "extra-role",
      {
        id: "extra-role",
        type: OverwriteType.Role,
        allow: {
          has: (permission: bigint) =>
            permission === PermissionFlagsBits.SendMessages,
        },
        deny: { has: () => false },
      },
    ],
    [
      "staff-role",
      {
        id: "staff-role",
        type: OverwriteType.Role,
        allow: { has: () => false },
        deny: { has: () => false },
      },
    ],
  ]);
  const channel = {
    id: "mapped-registration",
    type: ChannelType.GuildText,
    name: "custom-registration",
    parentId: "original-category",
    topic: "original topic",
    permissionOverwrites: {
      cache: permissionCache,
      edit: async (target: string, options: unknown, overwriteOptions: any) => {
        permissionEdits.push({
          target,
          options,
          type: overwriteOptions?.type,
          reason: overwriteOptions?.reason,
        });
        return channel;
      },
      delete: async (target: string, reason: string) => {
        permissionDeletes.push({ target, reason });
        return channel;
      },
    },
    edit: async () => {
      editCount += 1;
      throw new Error("existing channel should not be edited");
    },
  };

  const result = await service.ensureTextChannel(
    {
      client: { user: { id: "bot-user" } },
      members: { me: { id: "bot-user" } },
      roles: {
        everyone: { id: "guild-1" },
        cache: new Collection(),
      },
      channels: {
        cache: new Collection(),
        fetch: async (channelId: string) =>
          channelId === channel.id ? channel : null,
        create: async () => {
          throw new Error("existing channel should not be recreated");
        },
      },
    },
    "new-category",
    "session-1",
    "registration",
    "registration",
    channel.id,
    [
      {
        id: "guild-1",
        deny: [PermissionFlagsBits.SendMessages],
      },
      {
        id: "registration-role",
        allow: [PermissionFlagsBits.SendMessages],
      },
      {
        id: "staff-role",
        allow: [
          PermissionFlagsBits.ManageMessages,
          PermissionFlagsBits.SendMessages,
        ],
      },
    ],
    true,
    false,
  );

  assert.equal(result, channel);
  assert.equal(editCount, 0);
  assert.deepEqual(
    permissionEdits.map((entry) => entry.target).sort(),
    ["bot-user", "guild-1", "registration-role", "staff-role"],
  );
  assert.deepEqual(permissionDeletes, [
    {
      target: "extra-role",
      reason: "Arenzyra stale registration role cleanup",
    },
  ]);
  const everyoneEdit = permissionEdits.find(
    (entry) => entry.target === "guild-1",
  );
  assert.deepEqual(everyoneEdit.options, {
    AddReactions: false,
    CreatePublicThreads: false,
    CreatePrivateThreads: false,
    SendMessagesInThreads: false,
    SendMessages: false,
  });
  const registrationRoleEdit = permissionEdits.find(
    (entry) => entry.target === "registration-role",
  );
  assert.deepEqual(registrationRoleEdit.options, {
    AddReactions: false,
    CreatePublicThreads: false,
    CreatePrivateThreads: false,
    SendMessagesInThreads: false,
    SendMessages: true,
  });
  const staffEdit = permissionEdits.find(
    (entry) => entry.target === "staff-role",
  );
  assert.deepEqual(staffEdit.options, {
    AddReactions: true,
    CreatePublicThreads: true,
    CreatePrivateThreads: true,
    SendMessagesInThreads: true,
    SendMessages: true,
  });
  const botEdit = permissionEdits.find((entry) => entry.target === "bot-user");
  assert.equal(botEdit.type, OverwriteType.Member);
  assert.deepEqual(botEdit.options, {
    AddReactions: true,
    CreatePublicThreads: true,
    CreatePrivateThreads: true,
    SendMessagesInThreads: true,
    SendMessages: true,
  });
  assert.match(botEdit.reason, /registration access permission lock/);
});

test("preserved waitlist channels patch promotion send access without rewriting metadata", async () => {
  const service = new ScrimDiscordSetupService() as any;
  let editCount = 0;
  const permissionEdits: any[] = [];
  const permissionCache = new Collection<string, any>([
    [
      "guild-1",
      {
        id: "guild-1",
        type: OverwriteType.Role,
        allow: { has: () => false },
        deny: {
          has: (permission: bigint) =>
            permission === PermissionFlagsBits.SendMessages,
        },
      },
    ],
    [
      "waitlist-role",
      {
        id: "waitlist-role",
        type: OverwriteType.Role,
        allow: { has: () => false },
        deny: {
          has: (permission: bigint) =>
            permission === PermissionFlagsBits.SendMessages,
        },
      },
    ],
    [
      "staff-role",
      {
        id: "staff-role",
        type: OverwriteType.Role,
        allow: { has: () => false },
        deny: { has: () => false },
      },
    ],
  ]);
  const channel = {
    id: "mapped-waitlist",
    type: ChannelType.GuildText,
    name: "custom-waitlist",
    parentId: "original-category",
    topic: "original topic",
    permissionOverwrites: {
      cache: permissionCache,
      edit: async (target: string, options: unknown, overwriteOptions: any) => {
        permissionEdits.push({
          target,
          options,
          type: overwriteOptions?.type,
          reason: overwriteOptions?.reason,
        });
        return channel;
      },
    },
    edit: async () => {
      editCount += 1;
      throw new Error("existing channel should not be edited");
    },
  };

  const result = await service.ensureTextChannel(
    {
      client: { user: { id: "bot-user" } },
      members: { me: { id: "bot-user" } },
      roles: {
        everyone: { id: "guild-1" },
        cache: new Collection(),
      },
      channels: {
        cache: new Collection(),
        fetch: async (channelId: string) =>
          channelId === channel.id ? channel : null,
        create: async () => {
          throw new Error("existing channel should not be recreated");
        },
      },
    },
    "new-category",
    "session-1",
    "waitlist",
    "waitlist",
    channel.id,
    [
      {
        id: "guild-1",
        deny: [PermissionFlagsBits.ViewChannel],
      },
      {
        id: "waitlist-role",
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.SendMessages,
        ],
      },
      {
        id: "staff-role",
        allow: [
          PermissionFlagsBits.ManageMessages,
          PermissionFlagsBits.SendMessages,
        ],
      },
    ],
    true,
    false,
  );

  assert.equal(result, channel);
  assert.equal(editCount, 0);
  const waitlistRoleEdit = permissionEdits.find(
    (entry) => entry.target === "waitlist-role",
  );
  assert.deepEqual(waitlistRoleEdit.options, {
    AddReactions: false,
    CreatePublicThreads: false,
    CreatePrivateThreads: false,
    SendMessagesInThreads: false,
    SendMessages: true,
  });
  const staffEdit = permissionEdits.find(
    (entry) => entry.target === "staff-role",
  );
  assert.deepEqual(staffEdit.options, {
    AddReactions: true,
    CreatePublicThreads: true,
    CreatePrivateThreads: true,
    SendMessagesInThreads: true,
    SendMessages: true,
  });
  const botEdit = permissionEdits.find((entry) => entry.target === "bot-user");
  assert.equal(botEdit.type, OverwriteType.Member);
  assert.deepEqual(botEdit.options, {
    AddReactions: true,
    CreatePublicThreads: true,
    CreatePrivateThreads: true,
    SendMessagesInThreads: true,
    SendMessages: true,
  });
  assert.match(botEdit.reason, /waitlist promotion access permission lock/);
});

test("explicit manage roles define staff access without broad permission fallback", () => {
  const service = new ScrimDiscordSetupService() as any;
  const guild = {
    roles: {
      cache: new Collection<string, any>([
        [
          "manage-role",
          {
            id: "manage-role",
            name: "Configured Manager",
            permissions: { has: () => false },
          },
        ],
        [
          "admin-role",
          {
            id: "admin-role",
            name: "Broad Admin",
            permissions: {
              has: (permission: bigint) =>
                permission === PermissionFlagsBits.Administrator,
            },
          },
        ],
        [
          "named-staff-role",
          {
            id: "named-staff-role",
            name: "Arenzyra Staff",
            permissions: { has: () => false },
          },
        ],
      ]),
    },
  };

  const staffRoles = service.staffRoles(
    guild,
    { manageRoleIds: ["manage-role"] },
    null,
  );

  assert.deepEqual([...staffRoles.keys()], ["manage-role"]);
});

test("slot-list sync reuses an existing plain bot message when saved id is stale", async () => {
  const service = new ScrimDiscordSetupService() as any;
  service.slotRosterImageRenderer = {
    render: async () => {
      throw new Error("native slot-list sync must not render an image");
    },
  };
  let editPayload: any = null;
  let pinCount = 0;
  let sendCount = 0;
  const message = {
    id: "existing-slot-list",
    type: MessageType.Default,
    author: { id: "bot-user" },
    content: "**Slot List (0/25)**\nOld slot list",
    embeds: [],
    components: [],
    pinned: false,
    client: { user: { id: "bot-user" } },
    edit: async (payload: any) => {
      editPayload = payload;
      message.content = payload.content;
      return message;
    },
    pin: async () => {
      pinCount += 1;
      message.pinned = true;
      return message;
    },
    delete: async () => {
      throw new Error("managed message should not be deleted");
    },
  };
  const messages = new Collection<string, any>([[message.id, message]]);
  const channel = {
    id: "slot-list-channel",
    client: { user: { id: "bot-user" } },
    messages: {
      fetch: async (arg: any) => {
        if (typeof arg === "string") {
          throw new Error("saved message id is stale");
        }
        return messages;
      },
      fetchPinned: async () => new Collection<string, any>(),
    },
    send: async () => {
      sendCount += 1;
      throw new Error("existing slot list should be reused");
    },
  };
  service.fetchTextChannel = async () => channel;
  service.resolveTeamLogoEmojis = async () => ({});
  service.syncPlayConfirmationReactions = async () => undefined;

  const synced = await service.syncSlotListMessage(
    {
      id: "guild-1",
      emojis: { cache: new Collection(), fetch: async () => null },
    },
    setupPayload(),
    { ...sessionPayload(), slotCount: 25 },
    [
      {
        ...registrationPayload(),
        status: "CONFIRMED",
        slotNumber: 3,
        waitlistPosition: null,
      },
    ],
    {
      emojis: {
        managedSlotListMessageId: "deleted-message",
        slotListMessageMode: "plain",
      },
    },
  );

  assert.equal(synced.id, message.id);
  assert.equal(sendCount, 0);
  assert.equal(pinCount, 1);
  assert.match(editPayload.content, /Slot List \(1\/\d+\)/);
  assert.match(editPayload.content, /\[CLSX\] CLSX/);
  assert.deepEqual(editPayload.embeds, []);
  assert.deepEqual(editPayload.files, []);
  assert.deepEqual(editPayload.attachments, []);
});

test("existing channel sync does not rewrite permission overwrites by default", async () => {
  const service = new ScrimDiscordSetupService() as any;
  let editPayload: any = null;
  const channel = {
    id: "mapped-channel",
    type: ChannelType.GuildText,
    name: "old-registration",
    parentId: "category-1",
    topic: "old topic",
    edit: async (payload: unknown) => {
      editPayload = payload;
      return channel;
    },
  };

  const result = await service.ensureTextChannel(
    {
      channels: {
        cache: new Collection(),
        fetch: async (channelId: string) =>
          channelId === channel.id ? channel : null,
        create: async () => {
          throw new Error("existing channel should not be recreated");
        },
      },
    },
    "category-1",
    "session-1",
    "registration",
    "registration",
    channel.id,
    [{ id: "everyone-role", deny: [] }],
    false,
  );

  assert.equal(result, channel);
  assert.deepEqual(editPayload, {
    parent: "category-1",
    topic: "arenzyra-session=session-1;kind=registration",
  });
  assert.equal("permissionOverwrites" in editPayload, false);
});

test("existing channel sync can explicitly rewrite permission overwrites", async () => {
  const service = new ScrimDiscordSetupService() as any;
  let editPayload: any = null;
  const permissionOverwrites = [{ id: "everyone-role", deny: [] }];
  const channel = {
    id: "mapped-channel",
    type: ChannelType.GuildText,
    name: "old-registration",
    parentId: "category-1",
    topic: "old topic",
    edit: async (payload: unknown) => {
      editPayload = payload;
      return channel;
    },
  };

  const result = await service.ensureTextChannel(
    {
      channels: {
        cache: new Collection(),
        fetch: async (channelId: string) =>
          channelId === channel.id ? channel : null,
        create: async () => {
          throw new Error("existing channel should not be recreated");
        },
      },
    },
    "category-1",
    "session-1",
    "registration",
    "registration",
    channel.id,
    permissionOverwrites,
    false,
    true,
  );

  assert.equal(result, channel);
  assert.deepEqual(editPayload, {
    parent: "category-1",
    topic: "arenzyra-session=session-1;kind=registration",
    permissionOverwrites,
  });
});

test("registration channel overwrites restrict sending to configured registration roles", () => {
  const service = new ScrimDiscordSetupService() as any;
  const accessRole = { id: "access-role", name: "16 Scrim" };
  const staffRole = { id: "staff-role", name: "Staff" };
  const guild = {
    roles: {
      everyone: { id: "guild-1" },
      cache: new Collection([
        [accessRole.id, accessRole],
        [staffRole.id, staffRole],
      ]),
    },
  };
  const overwrites = service.registrationOverwrites(
    guild,
    new Map([[staffRole.id, staffRole]]),
    sessionPayload(),
    {
      registrationRoleIds: [accessRole.id, staffRole.id],
      specialRegistrationRoleIds: [],
      vipRoleIds: [],
    },
  );

  assert.deepEqual(overwrites[0], {
    id: "guild-1",
    allow: [
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.ReadMessageHistory,
    ],
    deny: [
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.AddReactions,
      PermissionFlagsBits.CreatePublicThreads,
      PermissionFlagsBits.CreatePrivateThreads,
      PermissionFlagsBits.SendMessagesInThreads,
    ],
  });
  assert.deepEqual(overwrites[1], {
    id: "access-role",
    allow: [
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.ReadMessageHistory,
      PermissionFlagsBits.SendMessages,
    ],
    deny: [
      PermissionFlagsBits.AddReactions,
      PermissionFlagsBits.CreatePublicThreads,
      PermissionFlagsBits.CreatePrivateThreads,
      PermissionFlagsBits.SendMessagesInThreads,
    ],
  });
  assert.deepEqual(overwrites[2], {
    id: "staff-role",
    allow: [
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.ReadMessageHistory,
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.ManageMessages,
      PermissionFlagsBits.AddReactions,
      PermissionFlagsBits.CreatePublicThreads,
      PermissionFlagsBits.CreatePrivateThreads,
      PermissionFlagsBits.SendMessagesInThreads,
    ],
  });
});

test("registration channel overwrites allow an open early access role while public registration is closed", () => {
  const service = new ScrimDiscordSetupService() as any;
  const normalRole = { id: "normal-role", name: "20 Scrim" };
  const earlyRole = { id: "early-role", name: "Fast Track" };
  const staffRole = { id: "staff-role", name: "Staff" };
  const guild = {
    roles: {
      everyone: { id: "guild-1" },
      cache: new Collection([
        [normalRole.id, normalRole],
        [earlyRole.id, earlyRole],
        [staffRole.id, staffRole],
      ]),
    },
  };

  const overwrites = service.registrationOverwrites(
    guild,
    new Map([[staffRole.id, staffRole]]),
    {
      ...sessionPayload(),
      registrationOpenAt: "2999-01-01T00:00:00.000Z",
    },
    {
      earlyAccessRoleId: earlyRole.id,
      vipAccessRoleId: null,
      registrationRoleIds: [normalRole.id],
      specialRegistrationRoleIds: [],
      vipRoleIds: [],
      emojis: {
        earlyAccessEnabled: "true",
        earlyAccessOpensAt: "2000-01-01T00:00:00.000Z",
        earlyAccessClosesAt: "2999-01-01T00:00:00.000Z",
      },
    },
  );

  const byId = new Map(overwrites.map((overwrite: any) => [overwrite.id, overwrite]));
  assert.deepEqual(byId.get("guild-1"), {
    id: "guild-1",
    allow: [
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.ReadMessageHistory,
    ],
    deny: [
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.AddReactions,
      PermissionFlagsBits.CreatePublicThreads,
      PermissionFlagsBits.CreatePrivateThreads,
      PermissionFlagsBits.SendMessagesInThreads,
    ],
  });
  assert.deepEqual(byId.get("normal-role"), {
    id: "normal-role",
    allow: [
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.ReadMessageHistory,
    ],
    deny: [
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.AddReactions,
      PermissionFlagsBits.CreatePublicThreads,
      PermissionFlagsBits.CreatePrivateThreads,
      PermissionFlagsBits.SendMessagesInThreads,
    ],
  });
  assert.deepEqual(byId.get("early-role"), {
    id: "early-role",
    allow: [
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.ReadMessageHistory,
      PermissionFlagsBits.SendMessages,
    ],
    deny: [
      PermissionFlagsBits.AddReactions,
      PermissionFlagsBits.CreatePublicThreads,
      PermissionFlagsBits.CreatePrivateThreads,
      PermissionFlagsBits.SendMessagesInThreads,
    ],
  });
});

test("registration channel overwrites do not treat inactive access roles as normal registration roles", () => {
  const service = new ScrimDiscordSetupService() as any;
  const normalRole = { id: "normal-role", name: "20 Scrim" };
  const vipRole = { id: "vip-role", name: "VIP" };
  const staffRole = { id: "staff-role", name: "Staff" };
  const guild = {
    roles: {
      everyone: { id: "guild-1" },
      cache: new Collection([
        [normalRole.id, normalRole],
        [vipRole.id, vipRole],
        [staffRole.id, staffRole],
      ]),
    },
  };

  const overwrites = service.registrationOverwrites(
    guild,
    new Map([[staffRole.id, staffRole]]),
    sessionPayload(),
    {
      earlyAccessRoleId: null,
      vipAccessRoleId: vipRole.id,
      registrationRoleIds: [normalRole.id],
      specialRegistrationRoleIds: [],
      vipRoleIds: [],
      emojis: {
        vipAccessEnabled: "false",
      },
    },
  );

  const byId = new Map(
    overwrites.map((overwrite: any) => [overwrite.id, overwrite]),
  );
  assert.deepEqual(byId.get("normal-role"), {
    id: "normal-role",
    allow: [
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.ReadMessageHistory,
      PermissionFlagsBits.SendMessages,
    ],
    deny: [
      PermissionFlagsBits.AddReactions,
      PermissionFlagsBits.CreatePublicThreads,
      PermissionFlagsBits.CreatePrivateThreads,
      PermissionFlagsBits.SendMessagesInThreads,
    ],
  });
  assert.deepEqual(byId.get("vip-role"), {
    id: "vip-role",
    allow: [
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.ReadMessageHistory,
    ],
    deny: [
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.AddReactions,
      PermissionFlagsBits.CreatePublicThreads,
      PermissionFlagsBits.CreatePrivateThreads,
      PermissionFlagsBits.SendMessagesInThreads,
    ],
  });
});

test("registration channel stays public when only organization VIP access role is configured", () => {
  const service = new ScrimDiscordSetupService() as any;
  const vipRole = { id: "vip-role", name: "VIP" };
  const staffRole = { id: "staff-role", name: "Staff" };
  const guild = {
    roles: {
      everyone: { id: "guild-1" },
      cache: new Collection([
        [vipRole.id, vipRole],
        [staffRole.id, staffRole],
      ]),
    },
  };

  const overwrites = service.registrationOverwrites(
    guild,
    new Map([[staffRole.id, staffRole]]),
    sessionPayload(),
    {
      earlyAccessRoleId: null,
      vipAccessRoleId: vipRole.id,
      registrationRoleIds: [],
      specialRegistrationRoleIds: [],
      vipRoleIds: [],
      emojis: {
        vipAccessEnabled: "false",
      },
    },
  );

  const byId = new Map(overwrites.map((overwrite: any) => [overwrite.id, overwrite]));
  assert.deepEqual(byId.get("guild-1"), {
    id: "guild-1",
    allow: [
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.ReadMessageHistory,
      PermissionFlagsBits.SendMessages,
    ],
    deny: [
      PermissionFlagsBits.AddReactions,
      PermissionFlagsBits.CreatePublicThreads,
      PermissionFlagsBits.CreatePrivateThreads,
      PermissionFlagsBits.SendMessagesInThreads,
    ],
  });
  assert.deepEqual(byId.get("vip-role"), {
    id: "vip-role",
    allow: [
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.ReadMessageHistory,
      PermissionFlagsBits.SendMessages,
    ],
    deny: [
      PermissionFlagsBits.AddReactions,
      PermissionFlagsBits.CreatePublicThreads,
      PermissionFlagsBits.CreatePrivateThreads,
      PermissionFlagsBits.SendMessagesInThreads,
    ],
  });
});

test("bot-controlled channel overwrites block member reactions and threads", () => {
  const service = new ScrimDiscordSetupService() as any;
  const accessRole = { id: "slot-role", name: "Slot" };
  const staffRole = { id: "staff-role", name: "Staff" };
  const guild = {
    client: { user: { id: "bot-user" } },
    members: { me: { id: "bot-user" } },
    roles: {
      everyone: { id: "guild-1" },
      cache: new Collection([
        [accessRole.id, accessRole],
        [staffRole.id, staffRole],
      ]),
    },
  };

  const overwrites = service.protectedOverwrites(
    guild,
    new Map([[staffRole.id, staffRole]]),
    accessRole,
    true,
  );

  assert.deepEqual(overwrites[0].deny, [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.AddReactions,
    PermissionFlagsBits.CreatePublicThreads,
    PermissionFlagsBits.CreatePrivateThreads,
    PermissionFlagsBits.SendMessagesInThreads,
  ]);
  assert.deepEqual(overwrites[1].deny, [
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.AddReactions,
    PermissionFlagsBits.CreatePublicThreads,
    PermissionFlagsBits.CreatePrivateThreads,
    PermissionFlagsBits.SendMessagesInThreads,
  ]);
  assert.ok(
    overwrites[2].allow.includes(PermissionFlagsBits.AddReactions),
  );
  assert.ok(
    overwrites[2].allow.includes(PermissionFlagsBits.CreatePublicThreads),
  );
  assert.deepEqual(overwrites[3], {
    id: "bot-user",
    allow: [
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.ReadMessageHistory,
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.EmbedLinks,
      PermissionFlagsBits.AttachFiles,
      PermissionFlagsBits.AddReactions,
      PermissionFlagsBits.CreatePublicThreads,
      PermissionFlagsBits.CreatePrivateThreads,
      PermissionFlagsBits.SendMessagesInThreads,
      PermissionFlagsBits.ManageMessages,
    ],
  });
});

test("registration panel sends organiser text as plain content", async () => {
  const service = new ScrimDiscordSetupService() as any;
  let sentPayload: any = null;
  const channel = {
    client: { user: { id: "bot-1" } },
    messages: {
      fetch: async () => null,
      fetchPinned: async () => new Collection(),
    },
    send: async (payload: any) => {
      sentPayload = payload;
      return { id: "panel-message", pin: async () => undefined };
    },
  };

  await service.upsertRegistrationPanel(channel, sessionPayload(), {
    registrationCommand: "%register",
    emojis: {
      registrationMessageTitle: "Custom Registration",
      registrationMessageText: "Register here for {session}.",
    },
  });

  assert.equal(sentPayload.embeds.length, 0);
  assert.match(sentPayload.content, /\*\*Custom Registration\*\*/);
  assert.match(sentPayload.content, /Register here for Scrim\./);
  assert.match(sentPayload.content, /\*\*Window\*\*/);
});

test("registration panel allows explicit organiser mentions", async () => {
  const service = new ScrimDiscordSetupService() as any;
  let sentPayload: any = null;
  const channel = {
    client: { user: { id: "bot-1" } },
    messages: {
      fetch: async () => null,
      fetchPinned: async () => new Collection(),
    },
    send: async (payload: any) => {
      sentPayload = payload;
      return { id: "panel-message", pin: async () => undefined };
    },
  };

  await service.upsertRegistrationPanel(channel, sessionPayload(), {
    registrationCommand: "%register",
    emojis: {
      registrationMessageTitle: "Custom Registration",
      registrationMessageText:
        "@everyone Register <@&123456789012345678> <@111111111111111111>",
    },
  });

  assert.deepEqual(sentPayload.allowedMentions, {
    parse: ["everyone"],
    users: ["111111111111111111"],
    roles: ["123456789012345678"],
  });
});

test("registration panel can send organiser text as an embed", async () => {
  const service = new ScrimDiscordSetupService() as any;
  let sentPayload: any = null;
  const channel = {
    client: { user: { id: "bot-1" } },
    messages: {
      fetch: async () => null,
      fetchPinned: async () => new Collection(),
    },
    send: async (payload: any) => {
      sentPayload = payload;
      return { id: "panel-message", pin: async () => undefined };
    },
  };

  await service.upsertRegistrationPanel(channel, sessionPayload(), {
    registrationCommand: "%register",
    emojis: {
      registrationMessageDisplayMode: "embed",
      registrationMessageTitle: "Custom Registration",
      registrationMessageText: "Register here for {session}.",
    },
  });

  const embed = sentPayload.embeds[0].toJSON();
  assert.equal(sentPayload.content, undefined);
  assert.equal(embed.title, "Custom Registration");
  assert.equal(embed.description, "Register here for Scrim.");
  assert.equal(embed.fields[0].name, "Window");
});

test("registration panel embed emits mention content for organiser pings", async () => {
  const service = new ScrimDiscordSetupService() as any;
  let sentPayload: any = null;
  const channel = {
    client: { user: { id: "bot-1" } },
    messages: {
      fetch: async () => null,
      fetchPinned: async () => new Collection(),
    },
    send: async (payload: any) => {
      sentPayload = payload;
      return { id: "panel-message", pin: async () => undefined };
    },
  };

  await service.upsertRegistrationPanel(channel, sessionPayload(), {
    registrationCommand: "%register",
    emojis: {
      registrationMessageDisplayMode: "embed",
      registrationMessageTitle: "Custom Registration",
      registrationMessageText: "@here Register <@&123456789012345678>",
    },
  });

  assert.equal(sentPayload.content, "@here <@&123456789012345678>");
  assert.deepEqual(sentPayload.allowedMentions, {
    parse: ["everyone"],
    roles: ["123456789012345678"],
  });
});

test("play confirmation message sends organiser text as plain content", async () => {
  const service = new ScrimDiscordSetupService() as any;
  let sentPayload: any = null;
  const channel = {
    client: { user: { id: "bot-1" } },
    messages: {
      fetch: async () => new Collection(),
    },
    send: async (payload: any) => {
      sentPayload = payload;
      return { id: "confirmation-message" };
    },
  };

  await service.syncPlayConfirmationMessage(
    channel,
    { id: "session-1" },
    {
      emojis: {
        playConfirmationMessageEnabled: "true",
        playConfirmationMessageTitle: "Confirm Lineup",
        playConfirmationMessageText:
          "@here Choose {confirm} or {notPlaying} <@111111111111111111>.",
      },
    },
  );

  assert.equal(sentPayload.embeds.length, 0);
  assert.match(sentPayload.content, /\*\*Confirm Lineup\*\*/);
  assert.match(sentPayload.content, /Choose/);
  assert.equal(sentPayload.components.length, 1);
  assert.deepEqual(sentPayload.allowedMentions, {
    parse: ["everyone"],
    users: ["111111111111111111"],
  });
});

test("play confirmation message is removed when confirmation is closed", async () => {
  const service = new ScrimDiscordSetupService() as any;
  let deleted = 0;
  const existingMessage = {
    id: "123456789012345678",
    author: { id: "bot-1" },
    delete: async () => {
      deleted += 1;
    },
  };
  const channel = {
    client: { user: { id: "bot-1" } },
    messages: {
      fetch: async (input?: string | { limit: number }) =>
        typeof input === "string" ? existingMessage : new Collection(),
    },
    send: async () => {
      throw new Error("closed confirmation must not be posted");
    },
  };

  const result = await service.syncPlayConfirmationMessage(
    channel,
    { id: "session-1" },
    {
      emojis: {
        playConfirmationMessageEnabled: "true",
        managedConfirmationMessageId: "123456789012345678",
        playConfirmationOpensAt: "2026-07-13T10:00:00.000Z",
        playConfirmationClosesAt: "2026-07-13T11:00:00.000Z",
      },
    },
    new Date("2026-07-13T12:00:00.000Z"),
  );

  assert.equal(result, null);
  assert.equal(deleted, 1);
});

test("long plain slot lists use compact rows before Discord truncation", () => {
  const service = new ScrimDiscordSetupService() as any;
  const registrations = Array.from({ length: 21 }, (_, index) => {
    const teamId = `team-${index + 1}`;
    return {
      id: `registration-${index + 1}`,
      teamId,
      status: "CONFIRMED",
      slotNumber: index + 3,
      waitlistPosition: null,
      checkedInAt: null,
      confirmedAt: null,
      removedAt: null,
      removalReason: null,
      note: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      team: {
        id: teamId,
        name: `Very Long Registered Team ${index + 1} ${"X".repeat(70)}`,
        tag: `T${index + 1}`,
        logoUrl: null,
        countryCode: null,
        region: null,
      },
    };
  });
  const teamLogoEmojiByTeamId = new Map(
    registrations.map((registration, index) => [
      registration.teamId,
      `<:azg_v1_${index + 1}_1502057439212732527:1502057439212732527>`,
    ]),
  );

  const payload = service.buildSlotListPayload(
    sessionPayload(),
    registrations,
    {
      enabled: true,
      startSlot: 3,
      normalSlots: 19,
      vipSlots: 3,
      emojis: {
        slotListMessageMode: "plain",
        slotListMode: "number",
      },
    },
    {
      managerMentionByTeamId: new Map(
        registrations.map((registration, index) => [
          registration.teamId,
          `<@${String(100000000000000000 + index).padStart(18, "0")}>`,
        ]),
      ),
      teamLogoEmojiByTeamId,
      defaultTeamLogoEmoji: "<:azg_v1_default:1502057439212732527>",
    },
  );

  assert.ok(payload.content);
  assert.equal(payload.embeds.length, 0);
  assert.ok(payload.content.length <= 2000);
  assert.match(payload.content, /VIP 2/);
  assert.match(payload.content, /Very Long Registered Team 21/);
  assert.match(payload.content, /\.\.\./);
});

test("waitlist message defaults to embed", () => {
  const service = new ScrimDiscordSetupService() as any;
  const payload = service.buildWaitlistPayload(
    sessionPayload(),
    [registrationPayload()],
    {
      enabled: true,
      emojis: {
        waitlist: "WAIT",
        empty: "EMPTY",
      },
    },
  );

  assert.equal(payload.content, null);
  assert.equal(payload.embeds.length, 1);
  const embed = payload.embeds[0].toJSON();
  assert.equal(embed.title, "WAIT Waitlist (1)");
  assert.match(embed.description ?? "", /CLSX/);
});

test("waitlist message can render as plain text", () => {
  const service = new ScrimDiscordSetupService() as any;
  const payload = service.buildWaitlistPayload(
    sessionPayload(),
    [registrationPayload()],
    {
      enabled: true,
      emojis: {
        waitlistMessageMode: "plain",
        waitlist: "WAIT",
        empty: "EMPTY",
      },
    },
  );

  assert.ok(payload.content);
  assert.equal(payload.embeds.length, 0);
  assert.match(payload.content, /\*\*WAIT Waitlist \(1\)\*\*/);
  assert.match(payload.content, /CLSX/);
});

test("slot list logo resolver creates per-team emojis for saved logos", async () => {
  const service = new ScrimDiscordSetupService() as any;
  service.fetchEmojiImage = async () => Buffer.from([1, 2, 3]);
  const emojiCache = new Collection<string, any>();
  const guild = {
    id: "guild-1",
    icon: null,
    emojis: {
      cache: emojiCache,
      fetch: async () => null,
      create: async ({ name }: { name: string }) => {
        const emoji = {
          id: `emoji-${emojiCache.size + 1}`,
          name,
          animated: false,
        };
        emojiCache.set(emoji.id, emoji);
        return emoji;
      },
    },
  };
  const registration = {
    ...registrationPayload(),
    status: "CONFIRMED",
    slotNumber: 3,
    waitlistPosition: null,
    team: {
      id: "team-1",
      name: "Team DXB",
      tag: "DXB",
      logoUrl: "https://api.arenzyra.com/media/teams/team-1/logo?v=1",
    },
  };

  const result = await service.resolveTeamLogoEmojis(guild, [registration], {
    slotTeamEmojiEnabled: true,
    emojis: { team: "🎮" },
  });

  assert.match(
    result.teamLogoEmojiByTeamId.get("team-1") ?? "",
    /^<:azt_v1_[a-f0-9]{10}_[a-f0-9]{6}:emoji-2>$/,
  );
});

test("slot list logo resolver skips new emoji uploads when static emoji slots are full", async () => {
  const service = new ScrimDiscordSetupService() as any;
  let fetchedLogo = false;
  service.fetchEmojiImage = async () => {
    fetchedLogo = true;
    return Buffer.from([1, 2, 3]);
  };
  const emojiCache = new Collection<string, any>(
    Array.from({ length: 100 }, (_, index) => [
      `emoji-${index + 1}`,
      {
        id: `emoji-${index + 1}`,
        name: `existing_${index + 1}`,
        animated: false,
      },
    ]),
  );
  let createCalled = false;
  const guild = {
    id: "guild-1",
    icon: null,
    premiumTier: 1,
    emojis: {
      cache: emojiCache,
      fetch: async () => null,
      create: async () => {
        createCalled = true;
        throw new Error("should not create emoji when full");
      },
    },
  };
  const registration = {
    ...registrationPayload(),
    status: "CONFIRMED",
    slotNumber: 3,
    waitlistPosition: null,
    team: {
      id: "team-1",
      name: "Team DXB",
      tag: "DXB",
      logoUrl: "https://api.arenzyra.com/media/teams/team-1/logo?v=1",
    },
  };

  const result = await service.resolveTeamLogoEmojis(guild, [registration], {
    slotTeamEmojiEnabled: true,
    emojis: { team: "TEAM" },
  });

  assert.equal(result.defaultTeamLogoEmoji, "TEAM");
  assert.equal(result.teamLogoEmojiByTeamId.has("team-1"), false);
  assert.equal(createCalled, false);
  assert.equal(fetchedLogo, false);
});

test("slot list logo resolver treats tier 3 servers with 200 static emojis as not full", async () => {
  const service = new ScrimDiscordSetupService() as any;
  service.fetchEmojiImage = async () => Buffer.from([1, 2, 3]);
  const emojiCache = new Collection<string, any>(
    Array.from({ length: 200 }, (_, index) => [
      `emoji-${index + 1}`,
      {
        id: `emoji-${index + 1}`,
        name: `existing_${index + 1}`,
        animated: false,
      },
    ]),
  );
  const createdNames: string[] = [];
  const guild = {
    id: "guild-1",
    icon: null,
    premiumTier: 3,
    emojis: {
      cache: emojiCache,
      fetch: async () => null,
      create: async ({ name }: { name: string }) => {
        createdNames.push(name);
        const emoji = {
          id: `guild-emoji-${emojiCache.size + 1}`,
          name,
          animated: false,
        };
        emojiCache.set(emoji.id, emoji);
        return emoji;
      },
    },
  };
  const registration = {
    ...registrationPayload(),
    status: "CONFIRMED",
    slotNumber: 3,
    waitlistPosition: null,
    team: {
      id: "team-1",
      name: "Team DXB",
      tag: "DXB",
      logoUrl: "https://api.arenzyra.com/media/teams/team-1/logo?v=1",
    },
  };

  const result = await service.resolveTeamLogoEmojis(guild, [registration], {
    slotTeamEmojiEnabled: true,
    emojis: { team: "TEAM" },
  });

  assert.equal(createdNames[0], "az_default_logo_a");
  assert.match(createdNames[1] ?? "", /^azt_v1_[a-f0-9]{10}_[a-f0-9]{6}$/);
  assert.match(
    result.teamLogoEmojiByTeamId.get("team-1") ?? "",
    /^<:azt_v1_[a-f0-9]{10}_[a-f0-9]{6}:guild-emoji-\d+>$/,
  );
});

test("slot list logo resolver falls back safely when guild static emoji slots are full", async () => {
  const service = new ScrimDiscordSetupService() as any;
  let fetchedLogo = false;
  service.fetchEmojiImage = async () => {
    fetchedLogo = true;
    return Buffer.from([1, 2, 3]);
  };
  const guildEmojiCache = new Collection<string, any>(
    Array.from({ length: 100 }, (_, index) => [
      `guild-emoji-${index + 1}`,
      {
        id: `guild-emoji-${index + 1}`,
        name: `existing_${index + 1}`,
        animated: false,
      },
    ]),
  );
  const applicationEmojiCache = new Collection<string, any>();
  const createdApplicationEmojiNames: string[] = [];
  let guildCreateCalled = false;
  const applicationEmojiManager = {
    application: { id: "application-1" },
    cache: applicationEmojiCache,
    fetch: async () => applicationEmojiCache,
    create: async ({ name }: { name: string }) => {
      createdApplicationEmojiNames.push(name);
      const emoji = {
        id: `app-emoji-${applicationEmojiCache.size + 1}`,
        name,
        animated: false,
      };
      applicationEmojiCache.set(emoji.id, emoji);
      return emoji;
    },
  };
  const guild = {
    id: "guild-1",
    icon: null,
    premiumTier: 1,
    client: {
      application: {
        emojis: applicationEmojiManager,
      },
    },
    emojis: {
      cache: guildEmojiCache,
      fetch: async () => null,
      create: async () => {
        guildCreateCalled = true;
        throw new Error("guild emoji should not be created");
      },
    },
  };
  const registration = {
    ...registrationPayload(),
    status: "CONFIRMED",
    slotNumber: 3,
    waitlistPosition: null,
    team: {
      id: "team-1",
      name: "Team DXB",
      tag: "DXB",
      logoUrl: "https://api.arenzyra.com/media/teams/team-1/logo?v=1",
    },
  };

  const result = await service.resolveTeamLogoEmojis(guild, [registration], {
    slotTeamEmojiEnabled: true,
    emojis: { team: "TEAM" },
  });

  assert.equal(guildCreateCalled, false);
  assert.equal(fetchedLogo, false);
  assert.deepEqual(createdApplicationEmojiNames, []);
  assert.equal(result.defaultTeamLogoEmoji, "TEAM");
  assert.equal(result.teamLogoEmojiByTeamId.has("team-1"), false);
});

test("slot list logo resolver skips new application emojis when application slots are full", async () => {
  const service = new ScrimDiscordSetupService() as any;
  service.fetchEmojiImage = async () => Buffer.from([1, 2, 3]);
  const guildEmojiCache = new Collection<string, any>();
  const applicationEmojiCache = new Collection<string, any>(
    Array.from({ length: 2000 }, (_, index) => [
      `app-emoji-${index + 1}`,
      {
        id: `app-emoji-${index + 1}`,
        name: `azt_v1_${String(index).padStart(10, "0")}_abcdef`,
        animated: false,
      },
    ]),
  );
  let applicationCreateCalled = false;
  const guildCreatedNames: string[] = [];
  const applicationEmojiManager = {
    application: { id: "application-1" },
    cache: applicationEmojiCache,
    fetch: async () => applicationEmojiCache,
    create: async () => {
      applicationCreateCalled = true;
      throw new Error("application emoji should not be created");
    },
  };
  const guild = {
    id: "guild-1",
    icon: null,
    premiumTier: 1,
    client: {
      application: {
        emojis: applicationEmojiManager,
      },
    },
    emojis: {
      cache: guildEmojiCache,
      fetch: async () => null,
      create: async ({ name }: { name: string }) => {
        guildCreatedNames.push(name);
        const emoji = {
          id: `guild-emoji-${guildEmojiCache.size + 1}`,
          name,
          animated: false,
        };
        guildEmojiCache.set(emoji.id, emoji);
        return emoji;
      },
    },
  };
  const registration = {
    ...registrationPayload(),
    status: "CONFIRMED",
    slotNumber: 3,
    waitlistPosition: null,
    team: {
      id: "team-1",
      name: "Team DXB",
      tag: "DXB",
      logoUrl: "https://api.arenzyra.com/media/teams/team-1/logo?v=1",
    },
  };

  const result = await service.resolveTeamLogoEmojis(guild, [registration], {
    slotTeamEmojiEnabled: true,
    emojis: { team: "TEAM" },
  });

  assert.equal(applicationCreateCalled, false);
  assert.equal(guildCreatedNames[0], "az_default_logo_a");
  assert.match(guildCreatedNames[1] ?? "", /^azt_v1_[a-f0-9]{10}_[a-f0-9]{6}$/);
  assert.match(
    result.defaultTeamLogoEmoji ?? "",
    /^<:az_default_logo_a:guild-emoji-1>$/,
  );
  assert.match(
    result.teamLogoEmojiByTeamId.get("team-1") ?? "",
    /^<:azt_v1_[a-f0-9]{10}_[a-f0-9]{6}:guild-emoji-2>$/,
  );
});

test("slot list logo resolver prefers existing guild team logo emoji over application duplicate", async () => {
  const service = new ScrimDiscordSetupService() as any;
  const logoUrl = "https://api.arenzyra.com/media/teams/team-1/logo?v=1";
  const teamEmojiName = service.teamLogoEmojiName("team-1", logoUrl);
  const guildEmojiCache = new Collection<string, any>([
    [
      "guild-default",
      {
        id: "guild-default",
        name: "az_default_logo_a",
        animated: false,
      },
    ],
    [
      "guild-team",
      {
        id: "guild-team",
        name: teamEmojiName,
        animated: false,
      },
    ],
  ]);
  const applicationEmojiCache = new Collection<string, any>([
    [
      "app-default",
      {
        id: "app-default",
        name: "az_default_logo_a",
        animated: false,
      },
    ],
    [
      "app-team",
      {
        id: "app-team",
        name: teamEmojiName,
        animated: false,
      },
    ],
  ]);
  const applicationEmojiManager = {
    application: { id: "application-1" },
    cache: applicationEmojiCache,
    fetch: async () => applicationEmojiCache,
    create: async () => {
      throw new Error("existing application emoji should be reused");
    },
  };
  const guild = {
    id: "guild-1",
    icon: null,
    premiumTier: 1,
    client: {
      application: {
        emojis: applicationEmojiManager,
      },
    },
    emojis: {
      cache: guildEmojiCache,
      fetch: async () => null,
      create: async () => {
        throw new Error("guild emoji should not be created");
      },
    },
  };
  const registration = {
    ...registrationPayload(),
    status: "CONFIRMED",
    slotNumber: 3,
    waitlistPosition: null,
    team: {
      id: "team-1",
      name: "Team DXB",
      tag: "DXB",
      logoUrl,
    },
  };

  const result = await service.resolveTeamLogoEmojis(guild, [registration], {
    slotTeamEmojiEnabled: true,
    emojis: { team: "TEAM" },
  });

  assert.equal(
    result.defaultTeamLogoEmoji,
    "<:az_default_logo_a:guild-default>",
  );
  assert.equal(
    result.teamLogoEmojiByTeamId.get("team-1"),
    `<:${teamEmojiName}:guild-team>`,
  );
});

test("slot list logo resolver replaces stale application emojis cached as guild emojis", async () => {
  const service = new ScrimDiscordSetupService() as any;
  service.fetchEmojiImage = async () => Buffer.from([1, 2, 3]);
  const logoUrl = "https://api.arenzyra.com/media/teams/team-1/logo?v=1";
  const teamEmojiName = service.teamLogoEmojiName("team-1", logoUrl);
  const staleApplicationEmojiId = "application-team-emoji";
  const emojiCache = new Collection<string, any>([
    [
      staleApplicationEmojiId,
      {
        id: staleApplicationEmojiId,
        name: teamEmojiName,
        animated: false,
      },
    ],
  ]);
  const authoritativeGuildEmojis = new Collection<string, any>();
  const createdNames: string[] = [];
  const guild = {
    id: "guild-1",
    icon: null,
    premiumTier: 3,
    emojis: {
      cache: emojiCache,
      fetch: async () => authoritativeGuildEmojis,
      create: async ({ name }: { name: string }) => {
        createdNames.push(name);
        const emoji = {
          id: `guild-emoji-${emojiCache.size + 1}`,
          name,
          animated: false,
        };
        emojiCache.set(emoji.id, emoji);
        return emoji;
      },
    },
  };
  const registration = {
    ...registrationPayload(),
    status: "CONFIRMED",
    slotNumber: 3,
    waitlistPosition: null,
    team: {
      id: "team-1",
      name: "Team DXB",
      tag: "DXB",
      logoUrl,
    },
  };

  const result = await service.resolveTeamLogoEmojis(guild, [registration], {
    slotTeamEmojiEnabled: true,
    emojis: { team: "TEAM" },
  });

  assert.equal(emojiCache.has(staleApplicationEmojiId), false);
  assert.equal(createdNames[0], "az_default_logo_a");
  assert.equal(createdNames[1], teamEmojiName);
  assert.equal(
    result.teamLogoEmojiByTeamId.get("team-1"),
    `<:${teamEmojiName}:guild-emoji-2>`,
  );
});

test("slot list logo resolver serializes concurrent guild team logo uploads", async () => {
  const service = new ScrimDiscordSetupService() as any;
  service.fetchEmojiImage = async () => Buffer.from([1, 2, 3]);
  const logoUrl = "https://api.arenzyra.com/media/teams/team-1/logo?v=1";
  const emojiCache = new Collection<string, any>([
    [
      "default",
      {
        id: "default",
        name: "az_default_logo_a",
        animated: false,
      },
    ],
  ]);
  let createCount = 0;
  const guild = {
    id: "guild-1",
    icon: null,
    premiumTier: 3,
    emojis: {
      cache: emojiCache,
      fetch: async () => emojiCache,
      create: async ({ name }: { name: string }) => {
        createCount += 1;
        await new Promise((resolve) => setTimeout(resolve, 20));
        const emoji = {
          id: `guild-team-${createCount}`,
          name,
          animated: false,
        };
        emojiCache.set(emoji.id, emoji);
        return emoji;
      },
    },
  };
  const registration = {
    ...registrationPayload(),
    status: "CONFIRMED",
    slotNumber: 3,
    waitlistPosition: null,
    team: {
      id: "team-1",
      name: "Team DXB",
      tag: "DXB",
      logoUrl,
    },
  };

  const results = await Promise.all([
    service.resolveTeamLogoEmojis(guild, [registration], {
      slotTeamEmojiEnabled: true,
      emojis: { team: "TEAM" },
    }),
    service.resolveTeamLogoEmojis(guild, [registration], {
      slotTeamEmojiEnabled: true,
      emojis: { team: "TEAM" },
    }),
  ]);

  assert.equal(createCount, 1);
  assert.equal(
    results[0].teamLogoEmojiByTeamId.get("team-1"),
    results[1].teamLogoEmojiByTeamId.get("team-1"),
  );
});

test("slot list logo resolver never falls back to application emojis in embeds", async () => {
  const service = new ScrimDiscordSetupService() as any;
  service.fetchEmojiImage = async () => Buffer.from([1, 2, 3]);
  const logoUrl = "https://api.arenzyra.com/media/teams/team-1/logo?v=1";
  const teamEmojiName = service.teamLogoEmojiName("team-1", logoUrl);
  const guildEmojiCache = new Collection<string, any>(
    Array.from({ length: 100 }, (_, index) => [
      `guild-emoji-${index + 1}`,
      {
        id: `guild-emoji-${index + 1}`,
        name: `existing_${index + 1}`,
        animated: false,
      },
    ]),
  );
  const applicationEmojiCache = new Collection<string, any>();
  let applicationCreateCalled = false;
  let forceFetchCalled = false;
  const applicationEmojiManager = {
    application: { id: "application-1" },
    cache: applicationEmojiCache,
    fetch: async () => {
      forceFetchCalled = true;
      applicationEmojiCache.set("app-team", {
        id: "app-team",
        name: teamEmojiName,
        animated: false,
      });
      return applicationEmojiCache;
    },
    create: async () => {
      applicationCreateCalled = true;
      const error = new Error("Invalid Form Body");
      (error as Error & { code?: number }).code = 50035;
      throw error;
    },
  };
  service.applicationEmojiCacheStates.set("application-1", {
    expiresAt: Date.now() + 60_000,
  });
  const guild = {
    id: "guild-1",
    icon: null,
    premiumTier: 1,
    client: {
      application: {
        emojis: applicationEmojiManager,
      },
    },
    emojis: {
      cache: guildEmojiCache,
      fetch: async () => null,
      create: async () => {
        throw new Error("guild emoji should not be created when full");
      },
    },
  };
  const registration = {
    ...registrationPayload(),
    status: "CONFIRMED",
    slotNumber: 3,
    waitlistPosition: null,
    team: {
      id: "team-1",
      name: "Team DXB",
      tag: "DXB",
      logoUrl,
    },
  };

  const result = await service.resolveTeamLogoEmojis(guild, [registration], {
    slotTeamEmojiEnabled: true,
    emojis: { team: "TEAM" },
  });

  assert.equal(applicationCreateCalled, false);
  assert.equal(forceFetchCalled, false);
  assert.equal(result.teamLogoEmojiByTeamId.has("team-1"), false);
});

test("slot list logo resolver prunes duplicate generated logo emojis before capacity is full", async () => {
  const service = new ScrimDiscordSetupService() as any;
  const logoUrl = "https://api.arenzyra.com/media/teams/team-1/logo?v=1";
  const teamEmojiName = service.teamLogoEmojiName("team-1", logoUrl);
  const deletedEmojiIds: string[] = [];
  const emojiCache = new Collection<string, any>([
    [
      "default",
      {
        id: "default",
        name: "az_default_logo_a",
        animated: false,
      },
    ],
    [
      "team-original",
      {
        id: "team-original",
        name: teamEmojiName,
        animated: false,
      },
    ],
    [
      "team-duplicate",
      {
        id: "team-duplicate",
        name: teamEmojiName,
        animated: false,
        delete: async function () {
          deletedEmojiIds.push(this.id);
          return this;
        },
      },
    ],
  ]);
  const guild = {
    id: "guild-1",
    icon: null,
    premiumTier: 3,
    emojis: {
      cache: emojiCache,
      fetch: async () => emojiCache,
      create: async () => {
        throw new Error("existing emoji should be reused");
      },
    },
  };
  const registration = {
    ...registrationPayload(),
    status: "CONFIRMED",
    slotNumber: 3,
    waitlistPosition: null,
    team: {
      id: "team-1",
      name: "Team DXB",
      tag: "DXB",
      logoUrl,
    },
  };

  const result = await service.resolveTeamLogoEmojis(guild, [registration], {
    slotTeamEmojiEnabled: true,
    emojis: { team: "TEAM" },
  });

  assert.deepEqual(deletedEmojiIds, ["team-duplicate"]);
  assert.equal(emojiCache.has("team-duplicate"), false);
  assert.equal(
    result.teamLogoEmojiByTeamId.get("team-1"),
    `<:${teamEmojiName}:team-original>`,
  );
});

test("slot list logo resolver keeps unique generated logo emojis from other sessions", async () => {
  const service = new ScrimDiscordSetupService() as any;
  service.fetchEmojiImage = async () => Buffer.from([1, 2, 3]);
  const deletedEmojiNames: string[] = [];
  const emojiCache = new Collection<string, any>(
    Array.from({ length: 100 }, (_, index) => [
      `emoji-${index + 1}`,
      {
        id: `emoji-${index + 1}`,
        name:
          index === 0
            ? "az_default_logo_a"
            : index === 1
              ? "azt_v1_0000000001_abcdef"
            : `existing_${index + 1}`,
        animated: false,
        delete: async function () {
          deletedEmojiNames.push(this.name);
          return this;
        },
      },
    ]),
  );
  const guild = {
    id: "guild-1",
    icon: null,
    premiumTier: 1,
    emojis: {
      cache: emojiCache,
      fetch: async () => null,
      create: async ({ name }: { name: string }) => {
        const emoji = {
          id: `emoji-created-${emojiCache.size + 1}`,
          name,
          animated: false,
          delete: async function () {
            deletedEmojiNames.push(this.name);
            return this;
          },
        };
        emojiCache.set(emoji.id, emoji);
        return emoji;
      },
    },
  };
  const registration = {
    ...registrationPayload(),
    status: "CONFIRMED",
    slotNumber: 3,
    waitlistPosition: null,
    team: {
      id: "team-1",
      name: "Team DXB",
      tag: "DXB",
      logoUrl: "https://api.arenzyra.com/media/teams/team-1/logo?v=1",
    },
  };

  const result = await service.resolveTeamLogoEmojis(guild, [registration], {
    slotTeamEmojiEnabled: true,
    emojis: { team: "TEAM" },
  });

  assert.deepEqual(deletedEmojiNames, []);
  assert.equal(result.teamLogoEmojiByTeamId.has("team-1"), false);
});

test("slot list logo resolver keeps unknown unique generated logo emojis in cache", async () => {
  const service = new ScrimDiscordSetupService() as any;
  service.fetchEmojiImage = async () => Buffer.from([1, 2, 3]);
  const emojiCache = new Collection<string, any>([
    [
      "default",
      {
        id: "default",
        name: "az_default_logo_a",
        animated: false,
      },
    ],
    [
      "stale",
      {
        id: "stale",
        name: "azt_v1_0000000001_abcdef",
        animated: false,
        delete: async () => {
          const error = new Error("Unknown Emoji");
          (error as Error & { code?: number }).code = 10014;
          throw error;
        },
      },
    ],
    ...Array.from({ length: 98 }, (_, index) => [
      `emoji-${index + 1}`,
      {
        id: `emoji-${index + 1}`,
        name: `existing_${index + 1}`,
        animated: false,
      },
    ] as const),
  ]);
  const guild = {
    id: "guild-1",
    icon: null,
    premiumTier: 1,
    emojis: {
      cache: emojiCache,
      fetch: async () => null,
      create: async ({ name }: { name: string }) => {
        const emoji = {
          id: "emoji-created",
          name,
          animated: false,
        };
        emojiCache.set(emoji.id, emoji);
        return emoji;
      },
    },
  };
  const registration = {
    ...registrationPayload(),
    status: "CONFIRMED",
    slotNumber: 3,
    waitlistPosition: null,
    team: {
      id: "team-1",
      name: "Team DXB",
      tag: "DXB",
      logoUrl: "https://api.arenzyra.com/media/teams/team-1/logo?v=1",
    },
  };

  const result = await service.resolveTeamLogoEmojis(guild, [registration], {
    slotTeamEmojiEnabled: true,
    emojis: { team: "TEAM" },
  });

  assert.equal(emojiCache.has("stale"), true);
  assert.equal(result.teamLogoEmojiByTeamId.has("team-1"), false);
});

test("roster renderer rewrites only canonical Arenzyra logo routes to the internal API", () => {
  const renderer = new SlotRosterImageRenderer() as any;
  assert.equal(
    renderer.canonicalLogoUrl(
      "https://api.arenzyra.com/media/teams/team-1/logo?v=7",
    ),
    "http://localhost:3000/media/teams/team-1/logo?v=7",
  );
  assert.equal(
    renderer.canonicalLogoUrl(
      `/media/team-logo-assets/${"a".repeat(64)}.png`,
    ),
    `http://localhost:3000/media/team-logo-assets/${"a".repeat(64)}.png`,
  );
  assert.equal(
    renderer.canonicalLogoUrl(
      "https://cdn.discordapp.com/attachments/channel/message/logo.png",
    ),
    null,
  );
  assert.equal(
    renderer.canonicalLogoUrl(
      "https://api.arenzyra.com/uploads/unbounded-logo.png",
    ),
    null,
  );
  assert.equal(
    renderer.canonicalLogoUrl(
      "http://127.0.0.1:9000/media/teams/team-1/logo",
    ),
    null,
  );
  assert.equal(
    renderer.serverDefaultLogoUrl(
      "https://cdn.discordapp.com/icons/856187505475846156/a_guildhash.png?size=128",
    ),
    "https://cdn.discordapp.com/icons/856187505475846156/a_guildhash.png?size=128",
  );
  assert.equal(
    renderer.serverDefaultLogoUrl(
      "https://cdn.discordapp.com/attachments/channel/message/logo.png",
    ),
    null,
  );
  assert.equal(
    renderer.serverDefaultLogoUrl(
      "https://example.com/icons/856187505475846156/guildhash.png?size=128",
    ),
    null,
  );
  assert.equal(
    renderer.serverDefaultLogoUrl(
      "https://cdn.discordapp.com:8443/icons/856187505475846156/guildhash.png?size=128",
    ),
    null,
  );
  assert.equal(
    renderer.serverDefaultLogoUrl(
      "https://user@cdn.discordapp.com/icons/856187505475846156/guildhash.png?size=128",
    ),
    null,
  );
  assert.equal(
    renderer.serverDefaultLogoUrl(
      "https://cdn.discordapp.com/icons/856187505475846156/guildhash.png?size=128&size=256",
    ),
    null,
  );
});

test("roster renderer places team and server-default logos inside their rows", async () => {
  const renderer = new SlotRosterImageRenderer();
  const originalFetch = globalThis.fetch;
  const teamLogo = await sharp({
    create: {
      width: 56,
      height: 56,
      channels: 4,
      background: { r: 230, g: 30, b: 40, alpha: 1 },
    },
  })
    .png()
    .toBuffer();
  const serverLogo = await sharp({
    create: {
      width: 56,
      height: 56,
      channels: 4,
      background: { r: 20, g: 210, b: 80, alpha: 1 },
    },
  })
    .png()
    .toBuffer();
  const fetches = {
    team: 0,
    failedTeam: 0,
    server: 0,
    rejected: 0,
  };
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("/icons/856187505475846156/")) {
      fetches.server += 1;
      return new Response(new Uint8Array(serverLogo), {
        status: 200,
        headers: { "content-type": "image/png" },
      });
    }
    if (url.includes("/media/teams/team-1/logo")) {
      fetches.team += 1;
      return new Response(new Uint8Array(teamLogo), {
        status: 200,
        headers: { "content-type": "image/png" },
      });
    }
    if (url.includes("/media/teams/team-2/logo")) {
      fetches.failedTeam += 1;
      return new Response(null, { status: 404 });
    }
    fetches.rejected += 1;
    return new Response(null, { status: 500 });
  };

  try {
    const page = (
      await renderer.render(
        "slots",
        "session-server-default",
        "Server Default Slot List",
        [
          {
            position: "#1",
            teamName: "Own Logo",
            logoUrl:
              "https://api.arenzyra.com/media/teams/team-1/logo?v=1",
          },
          { position: "#2", teamName: "No Logo", logoUrl: null },
          {
            position: "#3",
            teamName: "Missing Logo",
            logoUrl:
              "https://api.arenzyra.com/media/teams/team-2/logo?v=1",
          },
          {
            position: "#4",
            teamName: "Rejected Logo",
            logoUrl:
              "https://cdn.discordapp.com/attachments/channel/message/logo.png",
          },
          { position: "#5", teamName: "EMPTY", empty: true },
        ],
        {
          serverDefaultLogoUrl:
            "https://cdn.discordapp.com/icons/856187505475846156/a_guildhash.png?size=128",
        },
      )
    )[0];
    const { data, info } = await sharp(page.attachment)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const pixel = (x: number, y: number) => {
      const offset = (y * info.width + x) * info.channels;
      return [...data.subarray(offset, offset + 3)];
    };
    const logoSampleY = (rowIndex: number) => 88 + rowIndex * 72 + 12;

    assert.deepEqual(pixel(140, logoSampleY(0)), [230, 30, 40]);
    assert.deepEqual(pixel(140, logoSampleY(1)), [20, 210, 80]);
    assert.deepEqual(pixel(140, logoSampleY(2)), [20, 210, 80]);
    assert.deepEqual(pixel(140, logoSampleY(3)), [20, 210, 80]);
    assert.deepEqual(pixel(140, logoSampleY(4)), [17, 24, 39]);
    assert.deepEqual(fetches, {
      team: 1,
      failedTeam: 1,
      server: 1,
      rejected: 0,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("roster renderer refuses an incomplete image and retries a failed server icon", async () => {
  const renderer = new SlotRosterImageRenderer();
  const originalFetch = globalThis.fetch;
  const serverLogo = await sharp({
    create: {
      width: 56,
      height: 56,
      channels: 4,
      background: { r: 20, g: 210, b: 80, alpha: 1 },
    },
  })
    .png()
    .toBuffer();
  let serverFetches = 0;
  globalThis.fetch = async () => {
    serverFetches += 1;
    if (serverFetches === 1) {
      return new Response(null, { status: 503 });
    }
    return new Response(new Uint8Array(serverLogo), {
      status: 200,
      headers: { "content-type": "image/png" },
    });
  };
  const options = {
    serverDefaultLogoUrl:
      "https://cdn.discordapp.com/icons/856187505475846156/recovering.png?size=128",
  };

  try {
    await assert.rejects(
      renderer.render(
        "slots",
        "session-without-server-icon",
        "No Server Icon",
        [{ position: "#1", teamName: "No Logo", logoUrl: null }],
      ),
      /server default team logo is unavailable/,
    );
    await assert.rejects(
      renderer.render(
        "slots",
        "session-server-recovery",
        "Server Recovery",
        [{ position: "#1", teamName: "No Logo", logoUrl: null }],
        options,
      ),
      /server default team logo is unavailable/,
    );

    const recovered = await renderer.render(
      "slots",
      "session-server-recovery",
      "Server Recovery",
      [{ position: "#1", teamName: "No Logo", logoUrl: null }],
      options,
    );
    const { data, info } = await sharp(recovered[0].attachment)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const offset = ((88 + 12) * info.width + 140) * info.channels;

    assert.deepEqual([...data.subarray(offset, offset + 3)], [20, 210, 80]);
    assert.equal(serverFetches, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("roster renderer retries a transient team logo instead of caching its fallback", async () => {
  const renderer = new SlotRosterImageRenderer();
  const originalFetch = globalThis.fetch;
  const teamLogo = await sharp({
    create: {
      width: 56,
      height: 56,
      channels: 4,
      background: { r: 230, g: 30, b: 40, alpha: 1 },
    },
  })
    .png()
    .toBuffer();
  const serverLogo = await sharp({
    create: {
      width: 56,
      height: 56,
      channels: 4,
      background: { r: 20, g: 210, b: 80, alpha: 1 },
    },
  })
    .png()
    .toBuffer();
  let teamFetches = 0;
  let serverFetches = 0;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("/icons/")) {
      serverFetches += 1;
      return new Response(new Uint8Array(serverLogo), {
        status: 200,
        headers: { "content-type": "image/png" },
      });
    }
    teamFetches += 1;
    if (teamFetches === 1) {
      return new Response(null, { status: 503 });
    }
    return new Response(new Uint8Array(teamLogo), {
      status: 200,
      headers: { "content-type": "image/png" },
    });
  };
  const rows = [
    {
      position: "#1",
      teamName: "Recovering Team",
      logoUrl: "https://api.arenzyra.com/media/teams/team-recovery/logo?v=1",
    },
  ];
  const options = {
    serverDefaultLogoUrl:
      "https://cdn.discordapp.com/icons/856187505475846156/server.png?size=128",
  };

  try {
    const degraded = await renderer.render(
      "slots",
      "session-team-recovery",
      "Team Recovery",
      rows,
      options,
    );
    const recovered = await renderer.render(
      "slots",
      "session-team-recovery",
      "Team Recovery",
      rows,
      options,
    );
    const sample = async (attachment: Buffer) => {
      const { data, info } = await sharp(attachment)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const offset = ((88 + 12) * info.width + 140) * info.channels;
      return [...data.subarray(offset, offset + 3)];
    };

    assert.deepEqual(await sample(degraded[0].attachment), [20, 210, 80]);
    assert.deepEqual(await sample(recovered[0].attachment), [230, 30, 40]);
    assert.notEqual(recovered[0].name, degraded[0].name);
    assert.equal(teamFetches, 2);
    assert.equal(serverFetches, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("roster renderer includes the server icon identity in its page cache", async () => {
  const renderer = new SlotRosterImageRenderer();
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  const firstLogo = await sharp({
    create: {
      width: 56,
      height: 56,
      channels: 4,
      background: { r: 20, g: 210, b: 80, alpha: 1 },
    },
  })
    .png()
    .toBuffer();
  const secondLogo = await sharp({
    create: {
      width: 56,
      height: 56,
      channels: 4,
      background: { r: 70, g: 90, b: 230, alpha: 1 },
    },
  })
    .png()
    .toBuffer();
  globalThis.fetch = async (input) => {
    fetchCount += 1;
    const sourceLogo = String(input).includes("/first.png")
      ? firstLogo
      : secondLogo;
    return new Response(new Uint8Array(sourceLogo), {
      status: 200,
      headers: { "content-type": "image/png" },
    });
  };
  const rows = [{ position: "#1", teamName: "No Logo", logoUrl: null }];

  try {
    const first = await renderer.render(
      "slots",
      "session-icon-change",
      "Icon Change",
      rows,
      {
        serverDefaultLogoUrl:
          "https://cdn.discordapp.com/icons/856187505475846156/first.png?size=128",
      },
    );
    const second = await renderer.render(
      "slots",
      "session-icon-change",
      "Icon Change",
      rows,
      {
        serverDefaultLogoUrl:
          "https://cdn.discordapp.com/icons/856187505475846156/second.png?size=128",
      },
    );

    assert.notEqual(second, first);
    assert.equal(fetchCount, 2);
    assert.notEqual(second[0].name, first[0].name);
    const sample = async (attachment: Buffer) => {
      const { data, info } = await sharp(attachment)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const offset = ((88 + 12) * info.width + 140) * info.channels;
      return [...data.subarray(offset, offset + 3)];
    };
    assert.deepEqual(await sample(first[0].attachment), [20, 210, 80]);
    assert.deepEqual(await sample(second[0].attachment), [70, 90, 230]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("roster renderer bounds pages and reuses its rendered-page cache", async () => {
  const renderer = new SlotRosterImageRenderer();
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  const sourceLogo = await sharp({
    create: {
      width: 80,
      height: 80,
      channels: 4,
      background: { r: 30, g: 144, b: 255, alpha: 1 },
    },
  })
    .png()
    .toBuffer();
  globalThis.fetch = async () => {
    fetchCount += 1;
    return new Response(new Uint8Array(sourceLogo), {
      status: 200,
      headers: {
        "content-type": "image/png",
        "content-length": String(sourceLogo.length),
      },
    });
  };

  try {
    const rows = Array.from(
      { length: slotRosterImageLimits.maxRows + 20 },
      (_, index) => ({
        position: `#${index + 1}`,
        teamName: `Team ${index + 1}`,
        teamTag: `T${index + 1}`,
        status: "CONFIRMED",
        logoUrl: "https://api.arenzyra.com/media/teams/team-1/logo?v=1",
      }),
    );
    const first = await renderer.render(
      "slots",
      "session-cache",
      "Cached Slot List",
      rows,
    );
    const second = await renderer.render(
      "slots",
      "session-cache",
      "Cached Slot List",
      rows,
    );

    assert.equal(first.length, slotRosterImageLimits.maxPages);
    assert.equal(
      first.reduce((total, page) => total + page.rows, 0),
      slotRosterImageLimits.maxRows,
    );
    assert.equal(fetchCount, 1);
    assert.equal(second, first);
    assert.deepEqual(
      second.map((page) => page.name),
      first.map((page) => page.name),
    );
    assert.match(first[0].name, /^arenzyra-slots-[a-f0-9]+-p1-[a-f0-9]+\.png$/);
    const metadata = await sharp(first[0].attachment).metadata();
    assert.equal(metadata.format, "png");
    assert.equal(metadata.width, 1080);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("roster renderer globally bounds concurrent logo fetch and normalization work", async () => {
  const renderer = new SlotRosterImageRenderer();
  const originalFetch = globalThis.fetch;
  const sourceLogo = await sharp({
    create: {
      width: 56,
      height: 56,
      channels: 4,
      background: { r: 30, g: 144, b: 255, alpha: 1 },
    },
  })
    .png()
    .toBuffer();
  let activeFetches = 0;
  let maxActiveFetches = 0;
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    activeFetches += 1;
    maxActiveFetches = Math.max(maxActiveFetches, activeFetches);
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 10);
    });
    activeFetches -= 1;
    return new Response(new Uint8Array(sourceLogo), {
      status: 200,
      headers: { "content-type": "image/png" },
    });
  };

  try {
    await Promise.all(
      Array.from({ length: 3 }, (_, sessionIndex) =>
        renderer.render(
          "slots",
          `session-concurrency-${sessionIndex}`,
          `Concurrent ${sessionIndex}`,
          Array.from({ length: 8 }, (_, teamIndex) => ({
            position: `#${teamIndex + 1}`,
            teamName: `Team ${sessionIndex}-${teamIndex}`,
            logoUrl: `https://api.arenzyra.com/media/teams/team-${sessionIndex}-${teamIndex}/logo?v=1`,
          })),
        ),
      ),
    );

    assert.equal(fetchCount, 24);
    assert.equal(activeFetches, 0);
    assert.ok(maxActiveFetches <= 4);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("roster image fetch stops streaming as soon as its byte cap is exceeded", async () => {
  await assert.rejects(
    fetchRemoteRasterImage(
      "https://api.arenzyra.com/media/teams/team-1/logo",
      {
        maxBytes: 4,
        fetchImpl: async () =>
          new Response(new Uint8Array([1, 2, 3, 4, 5]), {
            status: 200,
            headers: { "content-type": "image/png" },
          }),
      },
    ),
    /streamed byte limit/,
  );
});

test("managed team logo cleanup is bounded and preserves unrelated emojis", async () => {
  const service = new ScrimDiscordSetupService() as any;
  const deletedNames: string[] = [];
  const emojiCache = new Collection<string, any>();
  for (let index = 0; index < 55; index += 1) {
    const name = `azt_v1_${String(index).padStart(10, "0")}_abcdef`;
    emojiCache.set(`managed-${index}`, {
      id: `managed-${index}`,
      name,
      animated: false,
      delete: async () => {
        deletedNames.push(name);
      },
    });
  }
  for (const [id, name] of [
    ["control", "az_slot_control"],
    ["community", "community_team_logo"],
  ]) {
    emojiCache.set(id, {
      id,
      name,
      animated: false,
      delete: async () => {
        throw new Error(`${name} must be preserved`);
      },
    });
  }
  let createCount = 0;
  const guild = {
    id: "guild-cleanup",
    client: { application: null },
    emojis: {
      cache: emojiCache,
      fetch: async () => emojiCache,
      create: async () => {
        createCount += 1;
      },
    },
  };

  const deleted = await service.pruneManagedTeamLogoEmojis(guild);

  assert.equal(deleted, 50);
  assert.equal(deletedNames.length, 50);
  assert.equal(
    [...emojiCache.values()].filter((emoji) =>
      emoji.name.startsWith("azt_"),
    ).length,
    5,
  );
  assert.equal(emojiCache.has("control"), true);
  assert.equal(emojiCache.has("community"), true);
  assert.equal(createCount, 0);
});

test("managed roster logo cleanup removes obsolete fallback emojis", async () => {
  const service = new ScrimDiscordSetupService() as any;
  const deletedNames: string[] = [];
  const emojiCache = new Collection<string, any>();
  for (const [id, name] of [
    ["default", "az_default_logo_a"],
    ["server-default", "azg_v1_1234abcd_abcdef"],
    ["control", "az_slot_control"],
    ["community", "community_team_logo"],
    ["team-lookalike", "azt_v1_application_abcdef"],
    ["server-lookalike", "azg_v1_server_icon"],
    ["default-lookalike", "az_default_logo_a_custom"],
  ]) {
    emojiCache.set(id, {
      id,
      name,
      animated: false,
      delete: async () => {
        if (id.endsWith("lookalike")) {
          throw new Error(`${name} must be preserved`);
        }
        deletedNames.push(name);
      },
    });
  }
  const guild = {
    id: "guild-fallback-cleanup",
    client: { application: null },
    emojis: {
      cache: emojiCache,
      fetch: async () => emojiCache,
      create: async () => {
        throw new Error("cleanup must not create emojis");
      },
    },
  };

  const deleted = await service.pruneManagedTeamLogoEmojis(guild);

  assert.equal(deleted, 2);
  assert.deepEqual(deletedNames.sort(), [
    "az_default_logo_a",
    "azg_v1_1234abcd_abcdef",
  ]);
  assert.equal(emojiCache.has("default"), false);
  assert.equal(emojiCache.has("server-default"), false);
  assert.equal(emojiCache.has("control"), true);
  assert.equal(emojiCache.has("community"), true);
  assert.equal(emojiCache.has("team-lookalike"), true);
  assert.equal(emojiCache.has("server-lookalike"), true);
  assert.equal(emojiCache.has("default-lookalike"), true);
});

test("managed team logo cleanup also removes only managed application emojis", async () => {
  const service = new ScrimDiscordSetupService() as any;
  const applicationEmojiCache = new Collection<string, any>([
    [
      "app-team",
      {
        id: "app-team",
        name: "azt_v1_a1b2c3d4e5_abcdef",
        delete: async () => undefined,
      },
    ],
    [
      "app-control",
      {
        id: "app-control",
        name: "az_registration_control",
        delete: async () => {
          throw new Error("control emoji must be preserved");
        },
      },
    ],
  ]);
  const applicationEmojiManager = {
    application: { id: "application-cleanup" },
    cache: applicationEmojiCache,
    fetch: async () => applicationEmojiCache,
  };
  const guildEmojiCache = new Collection<string, any>();
  const guild = {
    id: "guild-application-cleanup",
    client: {
      application: {
        emojis: applicationEmojiManager,
      },
    },
    emojis: {
      cache: guildEmojiCache,
      fetch: async () => guildEmojiCache,
      create: async () => {
        throw new Error("cleanup must not create emojis");
      },
    },
  };

  const deleted = await service.pruneManagedTeamLogoEmojis(guild);

  assert.equal(deleted, 1);
  assert.equal(applicationEmojiCache.has("app-team"), false);
  assert.equal(applicationEmojiCache.has("app-control"), true);
});

test("slot sync restores native rows without roster images or team emoji uploads", async () => {
  const service = new ScrimDiscordSetupService() as any;
  service.slotRosterImageRenderer = {
    render: async () => {
      throw new Error("native slot-list sync must not render an image");
    },
  };
  service.scheduleManagedTeamLogoEmojiCleanup = () => undefined;
  service.syncPlayConfirmationReactions = async () => undefined;

  let editPayload: any = null;
  let emojiCreateCount = 0;
  const message = {
    id: "1513664703413485610",
    type: MessageType.Default,
    author: { id: "bot-user" },
    content: "Managers: <@111111111111111111>",
    embeds: [
      new EmbedBuilder()
        .setTitle("Slot List (0/2)")
        .setImage(
          "https://cdn.discordapp.com/attachments/123/456/old-roster.png",
        ),
    ],
    components: [],
    attachments: new Collection([
      [
        "old-attachment",
        { id: "old-attachment", name: "old-roster.png" },
      ],
    ]),
    mentions: { users: new Collection() },
    pinned: true,
    edit: async (payload: any) => {
      editPayload = payload;
      return message;
    },
    pin: async () => message,
    delete: async () => message,
  };
  const messages = new Collection([[message.id, message]]);
  const channel = {
    id: "slot-list-channel",
    client: { user: { id: "bot-user" } },
    messages: {
      fetch: async (arg: any) =>
        typeof arg === "string" ? message : messages,
      fetchPinned: async () => new Collection([[message.id, message]]),
    },
    send: async () => {
      throw new Error("managed message should be edited");
    },
  };
  service.fetchTextChannel = async () => channel;
  const guild = {
    id: "guild-zero-emoji",
    icon: "guild-icon-hash",
    emojis: {
      cache: new Collection(),
      fetch: async () => new Collection(),
      create: async () => {
        emojiCreateCount += 1;
        throw new Error("team roster rendering must not create emojis");
      },
    },
  };
  const pendingRegistration = {
    ...registrationPayload(),
    status: "CONFIRMED",
    slotNumber: 3,
    waitlistPosition: null,
    note: null,
    team: {
      ...registrationPayload().team,
      logoUrl: "https://api.arenzyra.com/media/teams/team-1/logo?v=1",
    },
  };
  const confirmedRegistration = {
    ...registrationPayload(),
    id: "registration-2",
    teamId: "team-2",
    status: "CONFIRMED",
    slotNumber: 4,
    waitlistPosition: null,
    note: `ARENZYRA_PLAY_STATUS:${JSON.stringify({
      status: "CONFIRM",
      discordUserId: "222222222222222222",
    })}`,
    team: {
      id: "team-2",
      name: "Ready Squad",
      tag: "RDY",
      logoUrl: null,
    },
  };

  await service.syncSlotListMessage(
    guild,
    setupPayload(),
    { ...sessionPayload(), slotCount: 4 },
    [pendingRegistration, confirmedRegistration],
    {
      slotTeamEmojiEnabled: false,
      emojis: {
        managedSlotListMessageId: message.id,
        slotListMessageMode: "plain",
      },
    },
    {
      managerMentionByTeamId: new Map([
        ["team-1", "<@111111111111111111>"],
        ["team-2", "<@222222222222222222>"],
      ]),
    },
  );

  assert.equal(emojiCreateCount, 0);
  assert.equal(typeof editPayload.content, "string");
  const pendingLine = editPayload.content
    .split("\n")
    .find((line: string) => line.includes("[CLSX]"));
  const confirmedLine = editPayload.content
    .split("\n")
    .find((line: string) => line.includes("[RDY]"));
  assert.match(pendingLine ?? "", /<@111111111111111111>/);
  assert.doesNotMatch(pendingLine ?? "", /^__.*__$/);
  assert.match(confirmedLine ?? "", /^__.*<@222222222222222222>.*__$/);
  assert.deepEqual(editPayload.allowedMentions, {
    parse: [],
    users: ["111111111111111111", "222222222222222222"],
  });
  assert.deepEqual(editPayload.embeds, []);
  assert.deepEqual(editPayload.attachments, []);
  assert.deepEqual(editPayload.files, []);
});

test("native waitlist keeps each manager in its row and clears roster attachments", () => {
  const service = new ScrimDiscordSetupService() as any;
  const payload = service.withoutRosterImageAttachments(
    service.buildWaitlistPayload(
      sessionPayload(),
      [registrationPayload()],
      {
        emojis: {
          waitlistMessageMode: "plain",
          waitlist: "WAIT",
        },
      },
      {
        managerMentionByTeamId: new Map([
          ["team-1", "<@333333333333333333>"],
        ]),
        hideTeamLogos: true,
      },
    ),
  );

  assert.match(
    payload.content ?? "",
    /WAIT 1\. \[CLSX\] CLSX <@333333333333333333>/,
  );
  assert.deepEqual(payload.allowedMentions, {
    parse: [],
    users: ["333333333333333333"],
  });
  assert.deepEqual(payload.embeds, []);
  assert.deepEqual(payload.files, []);
  assert.deepEqual(payload.attachments, []);
});

test("roster image payload removes embed roster duplication but preserves metadata", () => {
  const service = new ScrimDiscordSetupService() as any;
  const payload = service.withRosterImagePages(
    {
      content: null,
      embeds: [
        new EmbedBuilder()
          .setColor(0x232323)
          .setTitle("Slot List (2/4)")
          .setDescription(
            "#3 Team One <@111111111111111111>\n#4 Team Two",
          )
          .addFields({
            name: "Confirmation",
            value: "Open",
            inline: false,
          }),
      ],
      allowedMentions: { parse: [] },
    },
    [
      {
        attachment: Buffer.from("roster"),
        name: "arenzyra-slots-page.png",
        description: "Slot List, page 1 of 1",
        rows: 4,
      },
    ],
  );
  const embed = payload.embeds[0].toJSON();

  assert.equal(payload.content, "Managers: <@111111111111111111>");
  assert.deepEqual(payload.allowedMentions, {
    parse: [],
    users: ["111111111111111111"],
  });
  assert.equal(embed.title, "Slot List (2/4)");
  assert.equal(embed.description, undefined);
  assert.deepEqual(embed.fields, [
    { name: "Confirmation", value: "Open", inline: false },
  ]);
  assert.equal(embed.image?.url, "attachment://arenzyra-slots-page.png");
});

test("roster image payload keeps only the compact manager mention mirror", () => {
  const service = new ScrimDiscordSetupService() as any;
  const payload = service.withRosterImagePages(
    {
      content:
        "**Slot List (2/4)**\n#3 Team One <@111111111111111111>\n#4 Team Two <@222222222222222222>",
      embeds: [],
      allowedMentions: {
        parse: [],
        users: ["111111111111111111", "222222222222222222"],
      },
    },
    [
      {
        attachment: Buffer.from("roster"),
        name: "arenzyra-slots-page.png",
        description: "Slot List, page 1 of 1",
        rows: 4,
      },
    ],
  );

  assert.equal(
    payload.content,
    "Managers: <@111111111111111111> <@222222222222222222>",
  );
  assert.deepEqual(payload.allowedMentions, {
    parse: [],
    users: ["111111111111111111", "222222222222222222"],
  });
  assert.equal(payload.embeds[0].toJSON().description, undefined);
});

test("plain slot lists remove logos before shortening team names", () => {
  const service = new ScrimDiscordSetupService() as any;
  const registrations = Array.from({ length: 21 }, (_, index) => {
    const teamId = `team-${index + 1}`;
    return {
      id: `registration-${index + 1}`,
      teamId,
      status: "CONFIRMED",
      slotNumber: index + 3,
      waitlistPosition: null,
      checkedInAt: null,
      confirmedAt: null,
      removedAt: null,
      removalReason: null,
      note: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      team: {
        id: teamId,
        name: `Moderately Long Team Name ${index + 1} Should Stay Full`,
        tag: `M${index + 1}`,
        logoUrl: null,
        countryCode: null,
        region: null,
      },
    };
  });
  const teamLogoEmojiByTeamId = new Map(
    registrations.map((registration, index) => [
      registration.teamId,
      `<:azg_v1_${index + 1}_1502057439212732527:1502057439212732527>`,
    ]),
  );

  const payload = service.buildSlotListPayload(
    sessionPayload(),
    registrations,
    {
      enabled: true,
      startSlot: 3,
      normalSlots: 21,
      vipSlots: 0,
      emojis: {
        slotListMessageMode: "plain",
        slotListMode: "number",
      },
    },
    {
      managerMentionByTeamId: new Map(
        registrations.map((registration, index) => [
          registration.teamId,
          `<@${String(200000000000000000 + index).padStart(18, "0")}>`,
        ]),
      ),
      teamLogoEmojiByTeamId,
    },
  );

  assert.ok(payload.content);
  assert.equal(payload.embeds.length, 0);
  assert.ok(payload.content.length <= 2000);
  assert.doesNotMatch(payload.content, /<:azg_v1_1_/);
  assert.match(
    payload.content,
    /Moderately Long Team Name 21 Should Stay Full/,
  );
  assert.doesNotMatch(payload.content, /\.\.\./);
});

test("slot list embeds keep manager mentions only inside roster rows", () => {
  const service = new ScrimDiscordSetupService() as any;
  const registration = {
    ...registrationPayload(),
    status: "CONFIRMED",
    slotNumber: 3,
    waitlistPosition: null,
    note: `ARENZYRA_PLAY_STATUS:${JSON.stringify({
      status: "CONFIRM",
      discordUserId: "leader-1",
    })}`,
  };

  const payload = service.buildSlotListPayload(
    sessionPayload(),
    [registration],
    {
      enabled: true,
      startSlot: 3,
      normalSlots: 1,
      vipSlots: 0,
      emojis: {
        slotListMode: "number",
      },
    },
    {
      managerMentionByTeamId: new Map([
        ["team-1", "<@111111111111111111> <@222222222222222222>"],
      ]),
    },
  );

  const embed = payload.embeds[0].toJSON();
  assert.match(
    embed.description ?? "",
    /\[CLSX\] CLSX <@111111111111111111> <@222222222222222222>/,
  );
  assert.equal(payload.content, null);
  assert.deepEqual(payload.allowedMentions, { parse: [] });
});

test("waitlist embed mirrors manager mentions in content for Discord parsing", () => {
  const service = new ScrimDiscordSetupService() as any;
  const payload = service.buildWaitlistPayload(
    sessionPayload(),
    [registrationPayload()],
    {
      enabled: true,
      emojis: {
        waitlist: "WAIT",
        empty: "EMPTY",
      },
    },
    {
      managerMentionByTeamId: new Map([
        ["team-1", "<@333333333333333333>"],
      ]),
    },
  );

  const embed = payload.embeds[0].toJSON();
  assert.match(embed.description ?? "", /<@333333333333333333>/);
  assert.equal(payload.content, "Managers: <@333333333333333333>");
  assert.deepEqual(payload.allowedMentions?.users, ["333333333333333333"]);
});

test("managed message edit skips unchanged parsed mention content", async () => {
  const service = new ScrimDiscordSetupService() as any;
  let edited = false;
  const message = {
    content: "Slot 1 <@111111111111111111>",
    embeds: [],
    components: [],
    mentions: {
      users: new Collection([["111111111111111111", {}]]),
    },
    edit: async () => {
      edited = true;
      return message;
    },
  };

  const result = await service.editManagedMessage(message, {
    content: "Slot 1 <@111111111111111111>",
    embeds: [],
    components: [],
    allowedMentions: { parse: [], users: ["111111111111111111"] },
  });

  assert.equal(result, message);
  assert.equal(edited, false);
});

test("managed message edit forces reparse when raw mentions were not parsed", async () => {
  const service = new ScrimDiscordSetupService() as any;
  let editedPayload: any = null;
  const message = {
    content: "Slot 1 <@111111111111111111>",
    embeds: [],
    components: [],
    mentions: {
      users: new Collection(),
    },
    edit: async (payload: any) => {
      editedPayload = payload;
      return message;
    },
  };

  await service.editManagedMessage(message, {
    content: "Slot 1 <@111111111111111111>",
    embeds: [],
    components: [],
    allowedMentions: { parse: [], users: ["111111111111111111"] },
  });

  assert.equal(editedPayload.content, "Slot 1 <@111111111111111111>\u200B");
});

test("managed roster comparison treats a Discord CDN image as its attachment URL", () => {
  const service = new ScrimDiscordSetupService() as any;
  const attachment = service.comparableEmbed(
    new EmbedBuilder().setImage("attachment://arenzyra-slots-page.png"),
  );
  const delivered = service.comparableEmbed({
    image: {
      url: "https://cdn.discordapp.com/attachments/123/456/arenzyra-slots-page.png?ex=abc&is=def&hm=ghi",
    },
  });

  assert.deepEqual(delivered, attachment);
});

test("managed roster comparison accepts Discord embed files omitted from attachments", () => {
  const service = new ScrimDiscordSetupService() as any;
  const fileName = "arenzyra-slots-stable-page.png";
  const message = {
    content: "",
    embeds: [
      new EmbedBuilder()
        .setTitle("Slot List (2/4)")
        .setImage(
          `https://cdn.discordapp.com/attachments/123/456/${fileName}?ex=abc&is=def&hm=ghi`,
        ),
    ],
    components: [],
    attachments: new Collection(),
    mentions: { users: new Collection() },
  };
  const payload = {
    content: null,
    embeds: [
      new EmbedBuilder()
        .setTitle("Slot List (2/4)")
        .setImage(`attachment://${fileName}`),
    ],
    components: [],
    files: [
      {
        attachment: Buffer.from("stable roster"),
        name: fileName,
      },
    ],
    allowedMentions: { parse: [] },
  };

  assert.equal(service.managedMessagePayloadMatches(message, payload), true);
});

test("enhanced slot list status rows use bold, muted rows, and configured emojis", () => {
  const service = new ScrimDiscordSetupService() as any;
  const confirmed = {
    ...registrationPayload(),
    status: "CONFIRMED",
    slotNumber: 3,
    waitlistPosition: null,
    note: `ARENZYRA_PLAY_STATUS:${JSON.stringify({
      status: "CONFIRM",
      discordUserId: "111111111111111111",
    })}`,
  };
  const notPlaying = {
    ...registrationPayload(),
    id: "registration-2",
    teamId: "team-2",
    team: {
      id: "team-2",
      name: "No Show Squad",
      tag: "NSS",
      logoUrl: null,
    },
    status: "CONFIRMED",
    slotNumber: 4,
    waitlistPosition: null,
    note: `ARENZYRA_PLAY_STATUS:${JSON.stringify({
      status: "NOT_PLAYING",
      discordUserId: "222222222222222222",
    })}`,
  };

  const payload = service.buildSlotListPayload(
    { ...sessionPayload(), slotCount: 4 },
    [confirmed, notPlaying],
    {
      enabled: true,
      startSlot: 3,
      normalSlots: 2,
      vipSlots: 0,
      emojis: {
        slotListMode: "number",
        playStatusRowStyle: "enhanced",
        playStatusConfirmEmoji: "<:ready:123456789012345678>",
        playStatusNotPlayingEmoji: "<:out:223456789012345678>",
      },
    },
  );

  const embed = payload.embeds[0].toJSON();
  assert.match(
    embed.description ?? "",
    /\*\*.*\[CLSX\] CLSX <@111111111111111111>.*\*\* <:ready:123456789012345678>/,
  );
  assert.match(
    embed.description ?? "",
    /~~_.*\[NSS\] No Show Squad <@222222222222222222>.*_~~ <:out:223456789012345678>/,
  );
});

test("configured server staff role is reused without creating or renaming fallback role", async () => {
  const service = new ScrimDiscordSetupService() as any;
  let created = false;
  let edited = false;
  const serverStaffRole = {
    id: "server-staff-role",
    name: "Server Staff",
    permissions: { has: () => false },
    edit: async () => {
      edited = true;
      return serverStaffRole;
    },
  };
  const guild = {
    roles: {
      cache: new Collection([[serverStaffRole.id, serverStaffRole]]),
      fetch: async (roleId?: string) =>
        roleId ? (guild.roles.cache.get(roleId) ?? null) : guild.roles.cache,
      create: async () => {
        created = true;
        return serverStaffRole;
      },
    },
  };

  const role = await service.ensureStaffRole(guild, {
    manageRoleIds: ["server-staff-role"],
    emojis: {
      staffRoleName: "Arenzyra Staff",
    },
  });

  assert.equal(role.id, "server-staff-role");
  assert.equal(created, false);
  assert.equal(edited, false);
});

test("missing Discord roles are not created unless auto-create is enabled", async () => {
  const service = new ScrimDiscordSetupService() as any;
  const createdRoles: string[] = [];
  const guild = {
    roles: {
      cache: new Collection(),
      fetch: async (roleId?: string) =>
        roleId ? (guild.roles.cache.get(roleId) ?? null) : guild.roles.cache,
      create: async (payload: { name: string }) => {
        createdRoles.push(payload.name);
        const role = {
          id: `created-${createdRoles.length}`,
          name: payload.name,
          permissions: { has: () => false },
        };
        guild.roles.cache.set(role.id, role);
        return role;
      },
    },
  };

  const staffRole = await service.ensureStaffRole(guild, {
    emojis: { staffRoleName: "Arenzyra Staff" },
  });
  const roles = await service.ensureSessionRoles(
    guild,
    sessionPayload(),
    { emojis: {} },
    false,
  );

  assert.equal(staffRole, null);
  assert.equal(roles.slotRole, null);
  assert.equal(roles.waitlistRole, null);
  assert.equal(roles.bannedRole, null);
  assert.deepEqual(createdRoles, []);

  const createdStaffRole = await service.ensureStaffRole(
    guild,
    {
      emojis: { staffRoleName: "Arenzyra Staff" },
    },
    true,
  );
  const createdSessionRoles = await service.ensureSessionRoles(
    guild,
    sessionPayload(),
    { emojis: {} },
    true,
  );

  assert.equal(createdStaffRole.name, "Arenzyra Staff");
  assert.equal(createdSessionRoles.slotRole.name, "Arenzyra Slot session-");
  assert.equal(
    createdSessionRoles.waitlistRole.name,
    "Arenzyra Waitlist session-",
  );
  assert.equal(createdSessionRoles.bannedRole.name, "Arenzyra Banned session-");
  assert.deepEqual(createdRoles, [
    "Arenzyra Staff",
    "Arenzyra Slot session-",
    "Arenzyra Waitlist session-",
    "Arenzyra Banned session-",
  ]);
});

test("waitlist control panel uses a select menu for current waitlist teams", () => {
  const service = new ScrimDiscordSetupService();
  const registrations = [
    registrationPayload(),
    {
      ...registrationPayload(),
      id: "registration-2",
      teamId: "team-2",
      waitlistPosition: 2,
      team: {
        id: "team-2",
        name: "Oppressors",
        tag: "OPS",
        logoUrl: null,
      },
    },
  ];

  const panel = service.buildWaitlistControlPanelPayload(
    sessionPayload() as any,
    registrations as any,
    null,
  );
  const embed = panel.payload.embeds?.[0].toJSON();
  const firstRow = panel.payload.components?.[0] as any;
  const select = firstRow.components[0].toJSON() as any;

  assert.equal(panel.waitlistCount, 2);
  assert.equal(embed?.title, "Waitlist Control");
  assert.match(embed?.description ?? "", /Select a team below/);
  assert.equal(select.custom_id, "waitctl:select:session-1:0");
  assert.deepEqual(
    select.options.map((option: any) => option.value),
    ["registration-1", "registration-2"],
  );
});
