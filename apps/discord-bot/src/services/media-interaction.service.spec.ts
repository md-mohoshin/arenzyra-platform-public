import assert from "node:assert/strict";
import test from "node:test";
import type { Attachment, ChatInputCommandInteraction } from "discord.js";
import { teamMediaCommand } from "../commands/teamMedia";
import { DiscordMediaInteractionService } from "./media-interaction.service";
import type { DiscordSessionService } from "./session.service";

function interactionStub() {
  return {
    id: "333333333333333333",
    guild: { id: "guild-1" },
    guildId: "guild-1",
    channelId: "channel-1",
    channel: { topic: "arenzyra-session=session-1" },
    user: {
      id: "user-1",
      username: "manager",
      tag: "manager#0001",
    },
    memberPermissions: { has: () => true },
  } as unknown as ChatInputCommandInteraction;
}

function imageStub() {
  return {
    id: "attachment-1",
    name: "source.webp",
    url: "https://cdn.discordapp.com/attachments/1/2/source.webp",
    contentType: "image/webp",
    size: 1234,
  } as Attachment;
}

test("interaction logo upload preserves image policy without a synthetic message source", async () => {
  let updateArgs: unknown[] | null = null;
  const sessionService = {
    findScrimForLogoChannel: async () => ({
      session: { id: "session-1", name: "Weekly" },
      config: { organizationId: "org-1", sessionId: "session-1" },
    }),
    withOrganization: async (
      organizationId: string,
      callback: () => Promise<string>,
    ) => {
      assert.equal(organizationId, "org-1");
      return callback();
    },
    updateTeamLogoFromDiscord: async (...args: unknown[]) => {
      updateArgs = args;
      return "Logo saved";
    },
    queueVisibleDiscordScrimRefreshForActiveGuildSessions: async () => undefined,
    sendDiscordActionLog: async () => undefined,
  } as unknown as DiscordSessionService;
  let fetched: { url: string; maxBytes: number } | null = null;
  const service = new DiscordMediaInteractionService(
    sessionService,
    async (url, options) => {
      fetched = { url, maxBytes: options?.maxBytes ?? 0 };
      return {
        buffer: Buffer.from("safe-image"),
        contentType: "image/png",
        url,
      };
    },
  );

  const result = await service.uploadLogo(interactionStub(), {
    teamName: " Alpha ",
    tag: " ALP ",
    image: imageStub(),
  });

  assert.equal(result, "Logo saved");
  assert.deepEqual(fetched, {
    url: "https://cdn.discordapp.com/attachments/1/2/source.webp",
    maxBytes: 8 * 1024 * 1024,
  });
  assert.ok(updateArgs);
  assert.equal(updateArgs![0], "Alpha (ALP)");
  assert.equal(updateArgs![3], null);
});

test("non-tournament player photos require team and player names", async () => {
  const sessionService = {
    findScrimForPlayerPhotoChannel: async () => ({
      session: { id: "session-1", name: "Weekly" },
      config: {
        organizationId: "org-1",
        sessionId: "session-1",
        registrationMode: "SCRIM",
      },
    }),
  } as unknown as DiscordSessionService;
  const service = new DiscordMediaInteractionService(
    sessionService,
    async () => ({
      buffer: Buffer.from("safe-image"),
      contentType: "image/png",
      url: "https://cdn.discordapp.com/attachments/1/2/source.webp",
    }),
  );

  await assert.rejects(
    () =>
      service.uploadPlayerPhoto(interactionStub(), {
        uid: "1234",
        teamName: null,
        playerName: null,
        image: imageStub(),
      }),
    /team name and player name are required/i,
  );
});

test("interaction media uploads do not bypass legacy channel send permissions", async () => {
  const sessionService = {} as DiscordSessionService;
  const interaction = interactionStub() as unknown as {
    memberPermissions: { has(): boolean };
  };
  interaction.memberPermissions = { has: () => false };

  await assert.rejects(
    () =>
      new DiscordMediaInteractionService(sessionService).uploadLogo(
        interaction as unknown as ChatInputCommandInteraction,
        {
          teamName: "Alpha",
          tag: "ALP",
          image: imageStub(),
        },
      ),
    /permission to send messages and attach files/i,
  );
});

test("interaction logo upload rejects unknown teams instead of saving an ephemeral pending source", async () => {
  let source: unknown = "not-called";
  const sessionService = {
    findScrimForLogoChannel: async () => ({
      session: { id: "session-1", name: "Weekly" },
      config: { organizationId: "org-1", sessionId: "session-1" },
    }),
    withOrganization: async (
      _organizationId: string,
      callback: () => Promise<string>,
    ) => callback(),
    updateTeamLogoFromDiscord: async (...args: unknown[]) => {
      source = args[3];
      throw new Error("Team not found");
    },
  } as unknown as DiscordSessionService;
  const service = new DiscordMediaInteractionService(
    sessionService,
    async () => ({
      buffer: Buffer.from("safe-image"),
      contentType: "image/png",
      url: imageStub().url,
    }),
  );

  await assert.rejects(
    () =>
      service.uploadLogo(interactionStub(), {
        teamName: "Future Team",
        tag: "NEW",
        image: imageStub(),
      }),
    /register the team first.*legacy `%logo`/i,
  );
  assert.equal(source, null);
});

test("interaction media commands explicitly preserve legacy production routing", async () => {
  const interaction = interactionStub() as unknown as {
    channel: { topic: string };
  };
  interaction.channel.topic =
    "arenzyra-production=org-1;set=production-1;kind=logo";
  const sessionService = {
    findScrimForLogoChannel: async () => {
      assert.fail("production channels must not enter scrim logo resolution");
    },
    findScrimForPlayerPhotoChannel: async () => {
      assert.fail("production channels must not enter scrim photo resolution");
    },
  } as unknown as DiscordSessionService;
  const service = new DiscordMediaInteractionService(sessionService);

  await assert.rejects(
    () =>
      service.uploadLogo(
        interaction as unknown as ChatInputCommandInteraction,
        {
          teamName: "Alpha",
          tag: "ALP",
          image: imageStub(),
        },
    ),
    /scrim\/event media channels only.*`%logo`.*production/i,
  );

  interaction.channel.topic =
    "arenzyra-production=org-1;set=production-1;kind=player-photo";
  await assert.rejects(
    () =>
      service.uploadPlayerPhoto(
        interaction as unknown as ChatInputCommandInteraction,
        {
          uid: "1234",
          teamName: "Alpha",
          playerName: "Player One",
          image: imageStub(),
        },
      ),
    /scrim\/event media channels only.*`%photo`.*production/i,
  );
});

test("team-media command metadata does not claim production support", () => {
  const command = teamMediaCommand.data.toJSON();
  assert.match(command.description, /scrim\/event/i);
  assert.match(command.description, /not production/i);
});
