import assert from "node:assert/strict";
import test from "node:test";
import { DiscordIdpScheduleService } from "./idp-schedule.service";

type IdpScheduleInternals = {
  localTimeToIso(value: string, timeZone: string, now: Date): string;
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
