import assert from "node:assert/strict";
import test from "node:test";
import { DiscordIdpScheduleService } from "./idp-schedule.service";

type IdpScheduleInternals = {
  localTimeToIso(value: string, timeZone: string, now: Date): string;
  primaryMessageContent(schedule: {
    startsAt: string;
    timeZone: string;
    primaryMessage: string;
  }): string;
  sendRoomIdCopyMessage(guild: unknown, schedule: { channelId: string }, roomId: string): Promise<void>;
};

test("IDP local time uses the configured time zone and the next local day when needed", () => {
  const service = new DiscordIdpScheduleService() as unknown as IdpScheduleInternals;
  const now = new Date("2026-07-13T14:00:00.000Z"); // 17:00 in Bucharest summer time.

  assert.equal(
    service.localTimeToIso("18:30", "Europe/Bucharest", now),
    "2026-07-13T15:30:00.000Z",
  );
  assert.equal(
    service.localTimeToIso("16:30", "Europe/Bucharest", now),
    "2026-07-14T13:30:00.000Z",
  );
  assert.throws(
    () => service.localTimeToIso("2026-07-13 18:30", "Europe/Bucharest", now),
    /local HH:MM/i,
  );
});

test("IDP primary message keeps Discord time and adds copyable configured local time", () => {
  const service = new DiscordIdpScheduleService() as unknown as IdpScheduleInternals;
  const startsAt = "2026-07-13T15:30:00.000Z";
  const unix = Math.floor(new Date(startsAt).getTime() / 1000);

  assert.equal(
    service.primaryMessageContent({
      startsAt,
      timeZone: "Europe/Bucharest",
      primaryMessage: `Start: <t:${unix}:t> (<t:${unix}:R>)`,
    }),
    `Start: 18:30 (Europe/Bucharest) · <t:${unix}:t> (<t:${unix}:R>)`,
  );
});

test("IDP primary message leaves a custom template without a Discord start timestamp unchanged", () => {
  const service = new DiscordIdpScheduleService() as unknown as IdpScheduleInternals;
  const primaryMessage = "Room opens after the staff announcement.";

  assert.equal(
    service.primaryMessageContent({
      startsAt: "2026-07-13T15:30:00.000Z",
      timeZone: "Europe/Bucharest",
      primaryMessage,
    }),
    primaryMessage,
  );
});

test("IDP plain time fallback never pushes a valid primary message over Discord's limit", () => {
  const service = new DiscordIdpScheduleService() as unknown as IdpScheduleInternals;
  const startsAt = "2026-07-13T15:30:00.000Z";
  const unix = Math.floor(new Date(startsAt).getTime() / 1000);
  const timestamp = `<t:${unix}:t>`;
  const primaryMessage = `${"x".repeat(2000 - timestamp.length)}${timestamp}`;

  assert.equal(
    service.primaryMessageContent({
      startsAt,
      timeZone: "Europe/Bucharest",
      primaryMessage,
    }),
    primaryMessage,
  );
});

test("IDP Room ID copy message contains only the raw Room ID", async () => {
  const service = new DiscordIdpScheduleService() as unknown as IdpScheduleInternals;
  let sent: unknown = null;
  const channel = {
    isTextBased: () => true,
    send: async (payload: unknown) => {
      sent = payload;
    },
  };
  const guild = { channels: { fetch: async () => channel } };

  await service.sendRoomIdCopyMessage(guild, { channelId: "123456789012345678" }, "6666564");

  assert.deepEqual(sent, {
    content: "6666564",
    allowedMentions: { parse: [] },
  });
});
