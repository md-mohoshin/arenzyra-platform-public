import assert from "node:assert/strict";
import test from "node:test";
import type { ChatInputCommandInteraction } from "discord.js";
import { DiscordIdpBroadcastService } from "./idp-broadcast.service";
import type { DiscordSessionService } from "./session.service";

test("interaction IDP broadcast uses the configured IDP channel and preserves reply routing", async () => {
  const deliveries: Array<Record<string, unknown>> = [];
  const actionLogs: Array<Record<string, unknown>> = [];
  const sessionService = {
    findConfiguredScrimForDiscordChannel: async () => ({
      session: { id: "11111111-1111-4111-8111-111111111111", name: "Finals" },
      config: {
        organizationId: "org-1",
        emojis: { idpDmForwardingEnabled: "true" },
      },
      channelKind: "idp",
    }),
    userHasStaffAccess: async () => true,
    withOrganization: async (
      organizationId: string,
      callback: () => Promise<string[]>,
    ) => {
      assert.equal(organizationId, "org-1");
      return callback();
    },
    listRegisteredSlotManagerDiscordIds: async () => [
      "222222222222222222",
    ],
    sendDiscordActionLog: async (
      _guild: unknown,
      _config: unknown,
      params: Record<string, unknown>,
    ) => {
      actionLogs.push(params);
    },
  } as unknown as DiscordSessionService;
  const interaction = {
    id: "333333333333333333",
    guild: { id: "guild-1" },
    guildId: "guild-1",
    channelId: "channel-1",
    channel: { topic: "arenzyra-session=11111111-1111-4111-8111-111111111111" },
    user: {
      id: "444444444444444444",
      username: "organizer",
      tag: "organizer#0001",
    },
    client: {
      users: {
        fetch: async (userId: string) => ({
          send: async (payload: Record<string, unknown>) => {
            deliveries.push({ userId, ...payload });
          },
        }),
      },
    },
  } as unknown as ChatInputCommandInteraction;
  const service = new DiscordIdpBroadcastService(sessionService, 0);

  const result = await service.broadcast(interaction, {
    content: "Room credentials were updated.",
    attachments: [],
  });

  assert.equal(result, "IDP broadcast delivered to 1/1 managers.");
  assert.equal(deliveries.length, 1);
  assert.match(String(deliveries[0]?.content), /Room credentials were updated/);
  const componentJson = (
    deliveries[0]?.components as Array<{ toJSON(): Record<string, unknown> }>
  )[0]?.toJSON();
  const button = (
    componentJson?.components as Array<{ custom_id?: string }> | undefined
  )?.[0];
  assert.equal(
    button?.custom_id,
    "idpdm:reply:11111111-1111-4111-8111-111111111111:333333333333333333:222222222222222222",
  );
  assert.equal(actionLogs.length, 1);
  assert.equal(actionLogs[0]?.status, "1/1 delivered");
});

test("interaction IDP broadcast refuses non-IDP channels", async () => {
  const sessionService = {
    findConfiguredScrimForDiscordChannel: async () => ({
      session: { id: "session-1", name: "Finals" },
      config: { organizationId: "org-1", emojis: {} },
      channelKind: "results",
    }),
  } as unknown as DiscordSessionService;
  const interaction = {
    guild: { id: "guild-1" },
    guildId: "guild-1",
    channelId: "channel-1",
    channel: null,
    user: { id: "user-1" },
  } as unknown as ChatInputCommandInteraction;

  await assert.rejects(
    () =>
      new DiscordIdpBroadcastService(sessionService, 0).broadcast(interaction, {
        content: "secret",
        attachments: [],
      }),
    /configured IDP channel/i,
  );
});
