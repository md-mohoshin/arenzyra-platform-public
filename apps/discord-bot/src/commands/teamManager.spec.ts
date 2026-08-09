import assert from "node:assert/strict";
import test from "node:test";
import type { ChatInputCommandInteraction } from "discord.js";
import type { DiscordSessionService } from "../services/session.service";
import { teamManagerCommand } from "./teamManager";

function interactionStub(
  subcommand: "add" | "remove",
  sessionId: string | null = null,
) {
  const edits: unknown[] = [];
  const interaction = {
    guild: {
      id: "guild-1",
      channels: {
        fetch: async (channelId: string) => ({
          id: channelId,
          isTextBased: () => true,
          isDMBased: () => false,
        }),
      },
      members: {
        fetch: async () => ({ displayName: "New Manager" }),
      },
    },
    guildId: "guild-1",
    channelId: "transfer-channel",
    channel: { id: "transfer-channel", topic: null },
    user: {
      id: "requester-1",
      username: "requester",
      tag: "requester#0001",
    },
    options: {
      getSubcommand: () => subcommand,
      getString: (name: string) =>
        name === "team"
          ? "TEAM TAG"
          : name === "session-id"
            ? sessionId
            : null,
      getUser: () => ({
        id: "manager-2",
        username: "manager2",
        globalName: "Manager Two",
        bot: false,
      }),
    },
    inGuild: () => true,
    deferReply: async (payload: unknown) => {
      assert.deepEqual(payload, { ephemeral: true });
    },
    editReply: async (payload: unknown) => {
      edits.push(payload);
    },
    reply: async () => undefined,
  } as unknown as ChatInputCommandInteraction;
  return { interaction, edits };
}

function sessionServiceStub(overrides: Record<string, unknown> = {}) {
  return {
    findConfiguredScrimForDiscordChannel: async () => ({
      session: { id: "session-1", name: "Weekly Scrim", type: "SCRIM" },
      config: {
        enabled: true,
        guildId: "guild-1",
        organizationId: "org-1",
        transferChannelId: "transfer-channel",
      },
      channelKind: "transfer",
    }),
    withOrganization: async (
      organizationId: string,
      callback: () => Promise<unknown>,
    ) => {
      assert.equal(organizationId, "org-1");
      return callback();
    },
    ...overrides,
  } as unknown as DiscordSessionService;
}

test("team-manager exposes separate add and remove self-service actions", () => {
  const json = teamManagerCommand.data.toJSON();
  assert.equal(json.name, "team-manager");
  assert.deepEqual(
    json.options?.map((option) => option.name),
    ["add", "remove"],
  );
});

test("team-manager add preserves manager self-service by forwarding staffBypass=false", async () => {
  const { interaction, edits } = interactionStub("add");
  let addArgs: unknown[] | null = null;
  let staffChecks = 0;
  const sessionService = sessionServiceStub({
    userHasStaffAccess: async (
      requesterId: string,
      _guild: unknown,
      sessionId: string,
    ) => {
      staffChecks += 1;
      assert.equal(requesterId, "requester-1");
      assert.equal(sessionId, "session-1");
      return false;
    },
    addSessionTeamManager: async (...args: unknown[]) => {
      addArgs = args;
      return "Manager added";
    },
  });

  await teamManagerCommand.execute(interaction, { sessionService });

  assert.equal(staffChecks, 1);
  assert.equal(addArgs?.[1], "session-1");
  assert.equal(addArgs?.[2], "TEAM TAG");
  assert.deepEqual(addArgs?.[3], {
    discordUserId: "manager-2",
    discordUsername: "manager2",
    displayName: "New Manager",
    role: "LEADER",
  });
  assert.deepEqual(addArgs?.[4], {
    actorDiscordId: "requester-1",
    actorLabel: "requester#0001",
    sourceChannelId: "transfer-channel",
    sessionName: "Weekly Scrim",
    requesterDiscordId: "requester-1",
    staffBypass: false,
  });
  assert.equal((edits[0] as { content: string }).content, "Manager added");
});

test("team-manager rejects use outside the configured transfer channel", async () => {
  const { interaction } = interactionStub("add");
  Object.assign(interaction, { channelId: "registration-channel" });
  const sessionService = sessionServiceStub();

  await assert.rejects(
    () => teamManagerCommand.execute(interaction, { sessionService }),
    /configured transfer roles channel/i,
  );
});

test("team-manager rejects an explicit session from another organization", async () => {
  const { interaction } = interactionStub("add", "foreign-session");
  let addCalls = 0;
  const sessionService = sessionServiceStub({
    resolveOrganizationIdForGuild: async () => "org-1",
    getSessionContext: async () => ({
      session: { id: "foreign-session", name: "Foreign", type: "SCRIM" },
      config: {
        enabled: true,
        guildId: "guild-1",
        organizationId: "foreign-org",
        transferChannelId: "transfer-channel",
      },
    }),
    addSessionTeamManager: async () => {
      addCalls += 1;
      return "unexpected";
    },
  });

  await assert.rejects(
    () => teamManagerCommand.execute(interaction, { sessionService }),
    /not a configured Arenzyra scrim for this Discord server/i,
  );
  assert.equal(addCalls, 0);
});
