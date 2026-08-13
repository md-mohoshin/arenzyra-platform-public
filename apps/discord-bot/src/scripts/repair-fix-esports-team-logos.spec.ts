import assert from "node:assert/strict";
import test from "node:test";
import {
  configuredLogoChannelIds,
  logoCandidateForMessage,
  logoMessageLabels,
  managedGuildEmojiCandidates,
  newestLogoCandidates,
  normalizeFixText,
  selectResultRefreshTarget,
} from "./repair-fix-esports-team-logos";

const team = { id: "team-1", name: "Aura Esports", tag: "AURA", logoUrl: null };

test("normalizes Fix Esports logo identities", () => {
  assert.equal(normalizeFixText("  Áura—Esports  "), "aura esports");
});

test("extracts exact name and tag from command and legacy captions", () => {
  assert.deepEqual(logoMessageLabels("%logo\nAura Esports | AURA"), {
    source: "command",
    labels: ["aura esports", "aura"],
  });
  assert.deepEqual(logoMessageLabels("Aura Esports | AURA"), {
    source: "plain-exact",
    labels: ["aura esports", "aura"],
  });
});

test("maps only one raster attachment and one exact team", () => {
  const candidate = logoCandidateForMessage(
    {
      id: "100",
      content: "%logo\nAura Esports | AURA",
      attachments: [
        {
          id: "200",
          url: "https://cdn.discordapp.com/attachments/1/200/logo.png",
          filename: "logo.png",
          content_type: "image/png",
        },
      ],
    },
    "channel-1",
    [team],
  );
  assert.equal(candidate?.team.id, team.id);
  assert.equal(candidate?.source, "command");
  assert.equal(
    logoCandidateForMessage(
      {
        id: "101",
        content: "Aura Esports won tonight",
        attachments: [
          {
            url: "https://cdn.discordapp.com/attachments/1/201/logo.png",
            filename: "logo.png",
          },
        ],
      },
      "channel-1",
      [team],
    ),
    null,
  );
});

test("keeps the newest exact logo for each team", () => {
  const base = {
    team,
    channelId: "channel-1",
    attachment: {
      url: "https://cdn.discordapp.com/attachments/1/2/logo.png",
    },
    source: "command" as const,
  };
  const selected = newestLogoCandidates([
    { ...base, messageId: "100" },
    { ...base, messageId: "200" },
  ]);
  assert.equal(selected.length, 1);
  assert.equal(selected[0].messageId, "200");
});

test("maps only an exact Arenzyra-managed guild emoji to its hashed team id", () => {
  const managed = managedGuildEmojiCandidates(
    [
      { id: "123456789012345678", name: "azt_v1_c4b40f26b2_123abc" },
      { id: "223456789012345678", name: "aura" },
    ],
    "guild-1",
    [team],
  );
  assert.equal(managed.length, 1);
  assert.equal(managed[0].team.id, team.id);
  assert.equal(managed[0].source, "managed-guild-emoji");
  assert.match(managed[0].attachment.url, /123456789012345678\.png/);
});

test("rejects managed emoji ambiguity and unavailable or animated assets", () => {
  const hashCollision = { ...team, id: "team-1", name: "Duplicate" };
  assert.deepEqual(
    managedGuildEmojiCandidates(
      [{ id: "123456789012345678", name: "azt_v1_c4b40f26b2_123abc" }],
      "guild-1",
      [team, hashCollision],
    ),
    [],
  );
  assert.deepEqual(
    managedGuildEmojiCandidates(
      [
        {
          id: "123456789012345678",
          name: "azt_v1_c4b40f26b2_123abc",
          animated: true,
        },
      ],
      "guild-1",
      [team],
    ),
    [],
  );
});

test("deduplicates configured logo channel IDs", () => {
  assert.deepEqual(
    configuredLogoChannelIds([
      {
        emojis: {
          logoChannelIds: "111111111111111111, 222222222222222222",
          discordLogoChannelIds: "222222222222222222",
        },
      },
    ]),
    ["222222222222222222", "111111111111111111"],
  );
});

test("selects the newest completed stored post in channel 16 result", () => {
  const makeContext = (id: string, startsAt: string) => ({
    session: {
      id,
      name: `Session ${id}`,
      slug: null,
      type: "SCRIM" as const,
      status: "ENDED" as const,
      slotCount: 20,
      maxTeams: 20,
      waitlistEnabled: false,
      registrationOpenAt: null,
      registrationCloseAt: null,
      startsAt,
      counts: { confirmedCount: 0, waitlistCount: 0, totalRegisteredCount: 0 },
    },
    config: {
      enabled: true,
      guildId: "guild-1",
      resultsChannelName: "16 | result",
      emojis: {
        finalResultPostChannelId: "111111111111111111",
        finalResultPostMessageId: `message-${id}`,
      },
    } as never,
  });
  const selected = selectResultRefreshTarget(
    [makeContext("old", "2026-08-12T16:00:00Z"), makeContext("new", "2026-08-13T16:00:00Z")],
    new Map([["111111111111111111", "16丨result"]]),
  );
  assert.equal(selected?.session.id, "new");
});
