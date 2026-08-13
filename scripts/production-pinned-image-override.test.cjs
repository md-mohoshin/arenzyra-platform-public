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

test("web candidate override pins only the stateless web service", () => {
  const webIds = { web: ids.web };
  const text = canonicalPinnedOverride("web-candidate", webIds);
  assert.deepEqual(validatePinnedOverride(text, "web-candidate", webIds), {
    services: { web: { image: ids.web } },
  });
  assert.doesNotMatch(text, /api|postgres|redis|media-ai|discord-bot/);
  assert.throws(() =>
    createPinnedOverride("web-candidate", { ...webIds, api: ids.api }),
  );
});

test("API recovery override pins only the API runtime service", () => {
  const apiIds = { api: ids.api };
  const text = canonicalPinnedOverride("api-recovery", apiIds);
  assert.deepEqual(validatePinnedOverride(text, "api-recovery", apiIds), {
    services: { api: { image: ids.api } },
  });
  assert.doesNotMatch(text, /api-migrate|postgres|redis|web|media-ai|discord-bot/);
  assert.throws(() =>
    createPinnedOverride("api-recovery", { ...apiIds, web: ids.web }),
  );
});

test("legacy cutover pins every runtime, migrator, and IDP maintenance image", () => {
  const text = canonicalPinnedOverride("legacy-cutover", ids);
  const override = validatePinnedOverride(text, "legacy-cutover", ids);
  assert.deepEqual(override.services["discord-bot"], {
    image: ids["discord-bot"],
  });
  assert.deepEqual(override.services["api-maintenance-idp-apply"], {
    image: ids.api,
  });
  assert.deepEqual(override.services["api-maintenance-idp-validate"], {
    image: ids.api,
  });
  assert.deepEqual(override.services["studio-migrate"], { image: ids.web });
});

test("IDP maintenance override pins the complete reviewed credential closure", () => {
  const apiIds = { api: ids.api };
  const text = canonicalPinnedOverride("idp-maintenance", apiIds);
  assert.deepEqual(validatePinnedOverride(text, "idp-maintenance", apiIds), {
    services: {
      "api-maintenance-idp-dry-run": { image: ids.api },
      "api-maintenance-idp-apply": { image: ids.api },
      "api-maintenance-idp-validate": { image: ids.api },
    },
  });
  assert.doesNotMatch(text, /youtube|api-migrate|\"api\":/i);
});

test("override validation rejects noncanonical and expanded Compose documents", () => {
  const fullIds = { api: ids.api, web: ids.web, "media-ai": ids["media-ai"] };
  const canonical = canonicalPinnedOverride("full", fullIds);
  assert.throws(() =>
    validatePinnedOverride(canonical.trim(), "full", fullIds),
  );
  const expanded = JSON.parse(canonical);
  expanded.services.api.environment = { UNSAFE: "true" };
  assert.throws(() =>
    validatePinnedOverride(
      `${JSON.stringify(expanded, null, 2)}\n`,
      "full",
      fullIds,
    ),
  );
});
