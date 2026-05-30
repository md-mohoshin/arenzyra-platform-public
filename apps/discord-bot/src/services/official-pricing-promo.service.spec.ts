import assert from "node:assert/strict";
import test from "node:test";
import { Collection } from "discord.js";
import { OfficialPricingPromoService } from "./official-pricing-promo.service";

function service() {
  return new OfficialPricingPromoService({
    enabled: true,
    guildId: "guild-1",
    channelId: "channel-1",
    pricingMessageId: "pinned-price",
    timeZone: "UTC",
    pollMs: 15_000,
  });
}

function fakeClient(messages: Collection<string, any>, sent: any[]) {
  const channel = {
    isTextBased: () => true,
    messages: {
      fetch: async () => messages,
    },
    send: async (payload: any) => {
      const message = {
        id: `new-message-${sent.length + 1}`,
        pinned: false,
        author: { id: "bot-1" },
        embeds: payload.embeds ?? [],
        pin: async () => undefined,
      };
      sent.push(payload);
      return message;
    },
  };
  return {
    user: { id: "bot-1" },
    guilds: {
      fetch: async () => ({
        channels: {
          fetch: async () => channel,
        },
      }),
    },
  };
}

test("official pricing promo is due only at configured local times", () => {
  const promo = service();

  assert.equal(
    promo.dueSchedule(new Date("2026-05-28T11:00:05Z"))?.key,
    "2026-05-28-1100",
  );
  assert.equal(
    promo.dueSchedule(new Date("2026-05-28T19:00:30Z"))?.key,
    "2026-05-28-1900",
  );
  assert.equal(promo.dueSchedule(new Date("2026-05-28T11:01:00Z")), null);
});

test("official pricing promo refreshes pinned pricing and sends everyone mention", async () => {
  const promo = service();
  const deleted: string[] = [];
  const pricingEdits: any[] = [];
  const messages = new Collection<string, any>();
  messages.set("old-promo", {
    id: "old-promo",
    author: { id: "bot-1" },
    embeds: [{ footer: { text: "Arenzyra streaming pricing promo | old" } }],
    delete: async () => {
      deleted.push("old-promo");
    },
  });
  messages.set("pinned-price", {
    id: "pinned-price",
    pinned: true,
    author: { id: "bot-1" },
    embeds: [{ title: "Arenzyra Pricing Plans" }],
    edit: async (payload: any) => {
      pricingEdits.push(payload);
      return messages.get("pinned-price");
    },
    delete: async () => {
      deleted.push("pinned-price");
    },
  });
  const sent: any[] = [];

  const ran = await promo.runOnce(
    fakeClient(messages, sent) as any,
    new Date("2026-05-28T11:00:05Z"),
  );

  assert.equal(ran, true);
  assert.deepEqual(deleted, ["old-promo"]);
  assert.equal(pricingEdits.length, 1);
  const pricingEmbed = pricingEdits[0].embeds[0].toJSON();
  assert.match(
    pricingEmbed.fields.find(
      (field: any) => field.name === "Official Streaming Service",
    ).value,
    /16\u20ac/,
  );
  assert.equal(sent.length, 1);
  assert.equal(sent[0].content, "@everyone");
  assert.deepEqual(sent[0].allowedMentions, { parse: ["everyone"] });
  const embed = sent[0].embeds[0].toJSON();
  assert.match(embed.fields[0].value, /16\u20ac/);
  assert.match(embed.fields[1].value, /14\u20ac/);
  assert.match(embed.footer.text, /2026-05-28-1100/);
});

test("official pricing promo does not resend inside the same scheduled minute", async () => {
  const promo = service();
  const pricingEdits: any[] = [];
  const messages = new Collection<string, any>();
  messages.set("pinned-price", {
    id: "pinned-price",
    pinned: true,
    author: { id: "bot-1" },
    embeds: [{ footer: { text: "Arenzyra Official pricing plan" } }],
    edit: async (payload: any) => {
      pricingEdits.push(payload);
      return messages.get("pinned-price");
    },
  });
  messages.set("current-promo", {
    id: "current-promo",
    author: { id: "bot-1" },
    embeds: [
      {
        footer: {
          text: "Arenzyra streaming pricing promo | 2026-05-28-1100 | UTC",
        },
      },
    ],
    delete: async () => {
      throw new Error("should not delete current promo");
    },
  });
  const sent: any[] = [];

  const ran = await promo.runOnce(
    fakeClient(messages, sent) as any,
    new Date("2026-05-28T11:00:10Z"),
  );

  assert.equal(ran, true);
  assert.equal(pricingEdits.length, 1);
  assert.equal(sent.length, 0);
});
