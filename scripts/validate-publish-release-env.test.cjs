"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");
const {
  COMPONENTS,
  assertDiscordComposeImage,
  validateReleaseEnvironmentText,
} = require("./validate-publish-release-env.cjs");

function encodedJson(value) {
  const bytes = Buffer.from(JSON.stringify(value));
  return {
    encoded: bytes.toString("base64url"),
    digest: `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`,
  };
}

function validMetadata() {
  const sourceDigest = `sha256:${"a".repeat(64)}`;
  const releaseId = "git-20260805-123456789-aaaaaaaaaaaa";
  const base = encodedJson(["base-image"]);
  const runtime = encodedJson(["runtime-image"]);
  const rows = {
    ARENZYRA_RELEASE_ID: releaseId,
    ARENZYRA_SOURCE_DIGEST: sourceDigest,
    ARENZYRA_BUILD_ID: releaseId,
    ARENZYRA_GIT_COMMIT: "b".repeat(12),
    ARENZYRA_BUILD_AT: "2026-08-05T12:34:56.789Z",
    ARENZYRA_BUILD_SOURCE: "git",
    ARENZYRA_BUILD_DIRTY: "false",
    ARENZYRA_BASE_IMAGES_SHA256: base.digest,
    ARENZYRA_BASE_IMAGES_B64: base.encoded,
    ARENZYRA_RUNTIME_IMAGES_SHA256: runtime.digest,
    ARENZYRA_RUNTIME_IMAGES_B64: runtime.encoded,
    ARENZYRA_PROVENANCE_OVERRIDE: "false",
  };
  for (const component of COMPONENTS) {
    rows[`ARENZYRA_${component}_GIT_COMMIT`] = new Set([
      "ROOT",
      "DISCORD",
      "MEDIA",
      "INFRA",
    ]).has(component)
      ? "b".repeat(12)
      : component === "API"
        ? "c".repeat(12)
        : "d".repeat(12);
    rows[`ARENZYRA_${component}_GIT_DIRTY`] = "false";
  }
  return Object.entries(rows)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
}

test("strict release metadata accepts one canonical clean-Git identity", () => {
  const text = validMetadata();
  assert.equal(
    validateReleaseEnvironmentText(text, "git-20260805-123456789-aaaaaaaaaaaa")
      .ARENZYRA_BUILD_SOURCE,
    "git",
  );
});

test("strict release metadata rejects duplicate, extra, dirty, and mismatched fields", () => {
  const text = validMetadata();
  for (const changed of [
    `${text}\nARENZYRA_RELEASE_ID=duplicate`,
    `${text}\nDATABASE_URL=do-not-accept`,
    text.replace("ARENZYRA_BUILD_DIRTY=false", "ARENZYRA_BUILD_DIRTY=true"),
    text.replace(
      "ARENZYRA_PROVENANCE_OVERRIDE=false",
      "ARENZYRA_PROVENANCE_OVERRIDE=true",
    ),
    text.replace("sha256:aaaaaaaaaaaa", "sha256:eeeeeeeeeeee"),
  ]) {
    assert.throws(() => validateReleaseEnvironmentText(changed));
  }
  assert.throws(() =>
    validateReleaseEnvironmentText(text, "git-20260805-000000000-aaaaaaaaaaaa"),
  );
});

test("strict release metadata authenticates encoded image inventories", () => {
  const text = validMetadata().replace(
    /ARENZYRA_BASE_IMAGES_B64=([^\n]+)/,
    "ARENZYRA_BASE_IMAGES_B64=eyJ0YW1wZXJlZCI6dHJ1ZX0",
  );
  assert.throws(() => validateReleaseEnvironmentText(text), /authenticate/);
});

test("rollback Compose assertion binds the Discord image to the requested release", () => {
  const releaseId = "git-20260805-123456789-aaaaaaaaaaaa";
  const compose = {
    services: { "discord-bot": { image: `arenzyra-discord-bot:${releaseId}` } },
  };
  assert.doesNotThrow(() => assertDiscordComposeImage(compose, releaseId));
  compose.services["discord-bot"].image = "arenzyra-discord-bot:other";
  assert.throws(() => assertDiscordComposeImage(compose, releaseId));
});
