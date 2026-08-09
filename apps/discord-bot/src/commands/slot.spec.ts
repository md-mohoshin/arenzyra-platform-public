import assert from "node:assert/strict";
import test from "node:test";
import type { ChatInputCommandInteraction } from "discord.js";
import { slotCommand } from "./slot";
import type { DiscordSessionService } from "../services/session.service";

function interactionStub(subcommand: "confirm" | "free", slotNumber = 22) {
  const replies: string[] = [];
  const interaction = {
    guild: { id: "guild-1" },
    guildId: "guild-1",
    channelId: "channel-1",
    channel: { topic: "arenzyra-session=session-1" },
    user: {
      id: "user-1",
      username: "captain",
      tag: "captain#0001",
    },
    options: {
      getSubcommand: () => subcommand,
      getInteger: (name: string) => {
        assert.equal(name, "number");
        return slotNumber;
      },
    },
    deferReply: async (payload: unknown) => {
      assert.deepEqual(payload, { ephemeral: true });
    },
    editReply: async (content: string) => {
      replies.push(content);
    },
    reply: async () => undefined,
  } as unknown as ChatInputCommandInteraction;
  return { interaction, replies };
}

function resolvedSessionService(overrides: Record<string, unknown> = {}) {
  return {
    findConfiguredScrimForDiscordChannel: async () => ({
      session: { id: "session-1", name: "Weekly Scrim" },
      config: { organizationId: "org-1" },
      channelKind: "slot-list",
    }),
    withOrganization: async (
      organizationId: string,
      callback: () => Promise<string>,
    ) => {
      assert.equal(organizationId, "org-1");
      return callback();
    },
    ...overrides,
  } as unknown as DiscordSessionService;
}

test("slot command publishes stable confirm and free subcommands", () => {
  const json = slotCommand.data.toJSON();
  assert.equal(json.name, "slot");
  assert.deepEqual(
    json.options?.map((option) => option.name),
    ["confirm", "free"],
  );
});

test("slot free resolves only the configured current session", async () => {
  const { interaction, replies } = interactionStub("free");
  let freeStatusCalls = 0;
  const sessionService = resolvedSessionService({
    freeSlotStatusMessage: async (sessionId: string) => {
      freeStatusCalls += 1;
      assert.equal(sessionId, "session-1");
      return "2 normal slots free";
    },
  });

  await slotCommand.execute(interaction, { sessionService });

  assert.equal(freeStatusCalls, 1);
  assert.deepEqual(replies, ["2 normal slots free"]);
});

test("slot confirm forwards the user, slot, session, and audit context once", async () => {
  const { interaction, replies } = interactionStub("confirm", 31);
  let confirmCalls = 0;
  const sessionService = resolvedSessionService({
    confirmSlotFromDiscord: async (...args: unknown[]) => {
      confirmCalls += 1;
      assert.equal(args[0], "user-1");
      assert.equal(args[1], "captain#0001");
      assert.equal(args[2], 31);
      assert.equal(args[4], "session-1");
      assert.deepEqual(args[5], {
        actorDiscordId: "user-1",
        actorLabel: "captain#0001",
        sourceChannelId: "channel-1",
        sessionName: "Weekly Scrim",
      });
      return "Slot confirmed";
    },
  });

  await slotCommand.execute(interaction, { sessionService });

  assert.equal(confirmCalls, 1);
  assert.deepEqual(replies, ["Slot confirmed"]);
});
