import assert from "node:assert/strict";
import test from "node:test";
import {
  ChannelType,
  Collection,
  MessageType,
  OverwriteType,
  PermissionFlagsBits,
} from "discord.js";
import { ScrimDiscordSetupService } from "./scrim-discord-setup.service";

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

  assert.equal(preserveFlags.length, 11);
  assert.ok(preserveFlags.every(Boolean));
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
    [
      "bot-user",
      "extra-role",
      "guild-1",
      "registration-role",
      "staff-role",
    ],
  );
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
  const extraRoleEdit = permissionEdits.find(
    (entry) => entry.target === "extra-role",
  );
  assert.deepEqual(extraRoleEdit.options, {
    AddReactions: false,
    CreatePublicThreads: false,
    CreatePrivateThreads: false,
    SendMessagesInThreads: false,
    SendMessages: false,
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

test("slot list shows all active manager mentions after play confirmation", () => {
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
  assert.equal(
    payload.content,
    "Managers: <@111111111111111111> <@222222222222222222>",
  );
  assert.deepEqual(payload.allowedMentions?.users, [
    "111111111111111111",
    "222222222222222222",
  ]);
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
