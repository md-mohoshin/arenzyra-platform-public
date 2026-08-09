"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  canonicalPinnedOverride,
  createPinnedOverride,
  validatePinnedOverride,
} = require("./production-pinned-image-override.cjs");

const ids = Object.freeze({
  api: `sha256:${"a".repeat(64)}`,
  web: `sha256:${"b".repeat(64)}`,
  "media-ai": `sha256:${"c".repeat(64)}`,
  "discord-bot": `sha256:${"d".repeat(64)}`,
});

test("full override pins runtime and migration services to immutable IDs", () => {
  const fullIds = { api: ids.api, web: ids.web, "media-ai": ids["media-ai"] };
  const override = createPinnedOverride("full", fullIds);
  assert.deepEqual(override.services, {
    api: { image: ids.api },
    "api-migrate": { image: ids.api },
    web: { image: ids.web },
    "studio-migrate": { image: ids.web },
    "media-ai": { image: ids["media-ai"] },
  });
  const text = canonicalPinnedOverride("full", fullIds);
  assert.deepEqual(validatePinnedOverride(text, "full", fullIds), override);
});

test("Discord override contains only the bot and rejects mutable or extra images", () => {
  const botIds = { "discord-bot": ids["discord-bot"] };
  const text = canonicalPinnedOverride("discord-bot", botIds);
  assert.deepEqual(validatePinnedOverride(text, "discord-bot", botIds), {
    services: { "discord-bot": { image: ids["discord-bot"] } },
  });
  assert.throws(() =>
    validatePinnedOverride(
      text.replace(ids["discord-bot"], "arenzyra-discord-bot:latest"),
      "discord-bot",
      botIds,
    ),
  );
  assert.throws(() =>
    createPinnedOverride("discord-bot", { ...botIds, api: ids.api }),
  );
});

test("override validation rejects noncanonical and expanded Compose documents", () => {
  const fullIds = { api: ids.api, web: ids.web, "media-ai": ids["media-ai"] };
  const canonical = canonicalPinnedOverride("full", fullIds);
  assert.throws(() => validatePinnedOverride(canonical.trim(), "full", fullIds));
  const expanded = JSON.parse(canonical);
  expanded.services.api.environment = { UNSAFE: "true" };
  assert.throws(() =>
    validatePinnedOverride(`${JSON.stringify(expanded, null, 2)}\n`, "full", fullIds),
  );
});
