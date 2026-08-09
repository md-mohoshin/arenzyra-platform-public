import assert from "node:assert/strict";
import test from "node:test";
import type { ChatInputCommandInteraction } from "discord.js";
import type { DiscordSessionService } from "../services/session.service";
import { sessionAdminCommand } from "./sessionAdmin";

type InteractionOptions = {
  subcommand: string;
  strings?: Record<string, string | null>;
  integers?: Record<string, number | null>;
  channel?: { id: string; topic?: string | null } | null;
};

function interactionStub(options: InteractionOptions) {
  const edits: unknown[] = [];
  const fetchedChannels: string[] = [];
  const interaction = {
    guild: {
      id: "guild-1",
      channels: {
        fetch: async (channelId: string) => {
          fetchedChannels.push(channelId);
          return {
            id: channelId,
            isTextBased: () => true,
            isDMBased: () => false,
          };
        },
      },
    },
    guildId: "guild-1",
    channelId: "manage-channel",
    channel: { id: "manage-channel", topic: null },
    user: {
      id: "staff-1",
      username: "staff",
      tag: "staff#0001",
    },
    options: {
      getSubcommand: () => options.subcommand,
      getString: (name: string) => options.strings?.[name] ?? null,
      getInteger: (name: string) => options.integers?.[name] ?? null,
      getChannel: () => options.channel ?? null,
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
  return { interaction, edits, fetchedChannels };
}

function sessionContext() {
  return {
    session: { id: "session-1", name: "Weekly Scrim", type: "SCRIM" },
    config: {
      enabled: true,
      guildId: "guild-1",
      organizationId: "org-1",
      registrationChannelId: "registration-channel",
      waitlistChannelId: "waitlist-channel",
      idpChannelId: "idp-channel",
      slotListChannelId: "slot-list-channel",
      resultsChannelId: "results-channel",
    },
    channelKind: "manage",
  };
}

function sessionServiceStub(overrides: Record<string, unknown> = {}) {
  return {
    findConfiguredScrimForDiscordChannel: async () => sessionContext(),
    getSessionContext: async () => sessionContext(),
    resolveOrganizationIdForGuild: async () => "org-1",
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

function commandServices(
  sessionService: DiscordSessionService,
  invalidateIdpDmChannelCache = (_guildId: string, _channelId: string) => {},
) {
  return {
    sessionService,
    messageRegistrationService: { invalidateIdpDmChannelCache },
  };
}

test("session-admin publishes only the reversible state/config subcommands", () => {
  const json = sessionAdminCommand.data.toJSON();
  assert.equal(json.name, "session-admin");
  assert.deepEqual(
    json.options?.map((option) => option.name),
    [
      "channel-state",
      "registration-state",
      "waitlist-state",
      "idp-forwarding",
      "slot-responses",
      "result-summary",
    ],
  );
});

test("channel-state validates the selected configured channel before resuming it", async () => {
  const { interaction, edits } = interactionStub({
    subcommand: "channel-state",
    strings: { state: "active" },
    channel: { id: "registration-channel", topic: "arenzyra-session=session-1" },
  });
  let resolvedChannelId: string | null = null;
  let pauseCall: unknown[] | null = null;
  const sessionService = sessionServiceStub({
    findConfiguredScrimForDiscordChannel: async (
      guildId: string,
      channelId: string,
    ) => {
      assert.equal(guildId, "guild-1");
      resolvedChannelId = channelId;
      return sessionContext();
    },
    setDiscordChannelPaused: async (...args: unknown[]) => {
      pauseCall = args;
      return { paused: false };
    },
  });

  await sessionAdminCommand.execute(interaction, commandServices(sessionService));

  assert.equal(resolvedChannelId, "registration-channel");
  assert.deepEqual(pauseCall, ["guild-1", "registration-channel", false]);
  assert.match(String((edits[0] as { content: string }).content), /now active/);
});

test("registration-state resolves the current configured session and forwards audit context", async () => {
  const { interaction, edits, fetchedChannels } = interactionStub({
    subcommand: "registration-state",
    strings: { state: "closed", "session-id": null },
  });
  let registrationArgs: unknown[] | null = null;
  const sessionService = sessionServiceStub({
    setRegistrationChannelState: async (...args: unknown[]) => {
      registrationArgs = args;
      return "Registration is closed.";
    },
  });

  await sessionAdminCommand.execute(interaction, commandServices(sessionService));

  assert.deepEqual(fetchedChannels, ["registration-channel"]);
  assert.equal(registrationArgs?.[1], "session-1");
  assert.equal(registrationArgs?.[2], "closed");
  assert.deepEqual(registrationArgs?.[3], {
    actorDiscordId: "staff-1",
    actorLabel: "staff#0001",
    sourceChannelId: "manage-channel",
    sessionName: "Weekly Scrim",
  });
  assert.equal((edits[0] as { content: string }).content, "Registration is closed.");
});

test("result-summary maps row-template to the public row config patch", async () => {
  const { interaction, fetchedChannels } = interactionStub({
    subcommand: "result-summary",
    strings: {
      action: "row-template",
      text: "{position}. {teamName} - {totalPoints}",
      "session-id": "session-1",
    },
  });
  let resultSummaryArgs: unknown[] | null = null;
  const sessionService = sessionServiceStub({
    updateResultSummaryConfig: async (...args: unknown[]) => {
      resultSummaryArgs = args;
      return "Result summary updated";
    },
  });

  await sessionAdminCommand.execute(interaction, commandServices(sessionService));

  assert.deepEqual(fetchedChannels, ["results-channel"]);
  assert.deepEqual(resultSummaryArgs, [
    "session-1",
    { action: "row", value: "{position}. {teamName} - {totalPoints}" },
  ]);
});

test("explicit session IDs must belong to the organization linked to the guild", async () => {
  const { interaction } = interactionStub({
    subcommand: "result-summary",
    strings: {
      action: "reset",
      "session-id": "foreign-session",
    },
  });
  let updateCalls = 0;
  const sessionService = sessionServiceStub({
    getSessionContext: async () => ({
      ...sessionContext(),
      config: {
        ...sessionContext().config,
        organizationId: "foreign-org",
      },
    }),
    updateResultSummaryConfig: async () => {
      updateCalls += 1;
      return "unexpected";
    },
  });

  await assert.rejects(
    () => sessionAdminCommand.execute(interaction, commandServices(sessionService)),
    /not a configured Arenzyra scrim for this Discord server/i,
  );
  assert.equal(updateCalls, 0);
});

test("idp-forwarding invalidates the passive-forwarding cache after the API update", async () => {
  const { interaction, fetchedChannels } = interactionStub({
    subcommand: "idp-forwarding",
    strings: { state: "disabled", "session-id": null },
  });
  const calls: string[] = [];
  const sessionService = sessionServiceStub({
    setIdpDmForwardingEnabled: async (sessionId: string, enabled: boolean) => {
      assert.equal(sessionId, "session-1");
      assert.equal(enabled, false);
      calls.push("updated");
      return { ...sessionContext().config, emojis: { idpDmForwardingEnabled: "false" } };
    },
  });

  await sessionAdminCommand.execute(
    interaction,
    commandServices(sessionService, (guildId, channelId) => {
      assert.equal(guildId, "guild-1");
      assert.equal(channelId, "idp-channel");
      calls.push("invalidated");
    }),
  );

  assert.deepEqual(fetchedChannels, ["idp-channel"]);
  assert.deepEqual(calls, ["updated", "invalidated"]);
});
