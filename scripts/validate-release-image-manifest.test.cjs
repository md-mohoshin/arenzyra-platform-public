"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const { COMPONENTS } = require("./validate-publish-release-env.cjs");
const {
  createReleaseImageManifest,
  validateReleaseImageManifest,
} = require("./validate-release-image-manifest.cjs");

const RELEASE_ID = "git-20260805-123456789-aaaaaaaaaaaa";
const IMAGE_ID = `sha256:${"e".repeat(64)}`;

function encodedJson(value) {
  const bytes = Buffer.from(JSON.stringify(value));
  return {
    encoded: bytes.toString("base64url"),
    digest: `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`,
  };
}

function releaseEnvironment() {
  const base = encodedJson(["base-image"]);
  const runtime = encodedJson(["runtime-image"]);
  const rows = {
    ARENZYRA_RELEASE_ID: RELEASE_ID,
    ARENZYRA_SOURCE_DIGEST: `sha256:${"a".repeat(64)}`,
    ARENZYRA_BUILD_ID: RELEASE_ID,
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
    rows[`ARENZYRA_${component}_GIT_COMMIT`] = "b".repeat(12);
    rows[`ARENZYRA_${component}_GIT_DIRTY`] = "false";
  }
  return `${Object.entries(rows)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n")}\n`;
}

function labels() {
  return {
    "org.opencontainers.image.version": RELEASE_ID,
    "org.opencontainers.image.revision": "b".repeat(12),
    "org.opencontainers.image.created": "2026-08-05T12:34:56.789Z",
    "com.arenzyra.source-digest": `sha256:${"a".repeat(64)}`,
    "com.arenzyra.release-source": "git",
  };
}

function inspection(service = "api") {
  const repository = {
    api: "arenzyra-api",
    web: "arenzyra-web",
    "media-ai": "arenzyra-media-ai",
    "discord-bot": "arenzyra-discord-bot",
  }[service];
  return JSON.stringify([
    {
      Id: IMAGE_ID,
      RepoTags: [`${repository}:${RELEASE_ID}`],
      Config: { Labels: labels() },
    },
  ]);
}

test("image manifests bind all built service identities to exact release bytes", () => {
  const release = Buffer.from(releaseEnvironment());
  for (const service of ["api", "web", "media-ai", "discord-bot"]) {
    const manifest = createReleaseImageManifest(
      inspection(service),
      release,
      RELEASE_ID,
      service,
    );
    assert.equal(manifest.schemaVersion, 1);
    assert.equal(manifest.service, service);
    assert.equal(manifest.imageId, IMAGE_ID);
    assert.equal(
      manifest.releaseEnvironmentSha256,
      `sha256:${crypto.createHash("sha256").update(release).digest("hex")}`,
    );
    assert.deepEqual(
      validateReleaseImageManifest(
        JSON.stringify(manifest),
        release,
        RELEASE_ID,
        service,
      ),
      manifest,
    );
  }
});

test("image manifest validation rejects extra keys and identity drift", () => {
  const release = Buffer.from(releaseEnvironment());
  const original = createReleaseImageManifest(
    inspection(),
    release,
    RELEASE_ID,
    "api",
  );
  const mutations = [
    { ...original, extra: true },
    { ...original, imageId: "not-an-image-id" },
    { ...original, releaseEnvironmentSha256: `sha256:${"0".repeat(64)}` },
    { ...original, imageReference: `arenzyra-api:${RELEASE_ID}-other` },
    { ...original, labels: { ...original.labels, unexpected: "value" } },
    {
      ...original,
      labels: {
        ...original.labels,
        "com.arenzyra.source-digest": `sha256:${"9".repeat(64)}`,
      },
    },
  ];
  for (const manifest of mutations) {
    assert.throws(() =>
      validateReleaseImageManifest(
        JSON.stringify(manifest),
        release,
        RELEASE_ID,
        "api",
      ),
    );
  }
  assert.throws(() =>
    validateReleaseImageManifest(
      JSON.stringify(original),
      Buffer.concat([release, Buffer.from("\n")]),
      RELEASE_ID,
      "api",
    ),
  );
});

test("manifest creation rejects ambiguous images, tag drift, and label drift", () => {
  const release = Buffer.from(releaseEnvironment());
  assert.throws(
    () =>
      createReleaseImageManifest(
        JSON.stringify([]),
        release,
        RELEASE_ID,
        "api",
      ),
    /exactly one image/,
  );

  const wrongTag = JSON.parse(inspection());
  wrongTag[0].RepoTags = ["arenzyra-api:other"];
  assert.throws(
    () =>
      createReleaseImageManifest(
        JSON.stringify(wrongTag),
        release,
        RELEASE_ID,
        "api",
      ),
    /expected release reference/,
  );

  const wrongLabel = JSON.parse(inspection());
  wrongLabel[0].Config.Labels["org.opencontainers.image.revision"] = "0".repeat(
    12,
  );
  assert.throws(
    () =>
      createReleaseImageManifest(
        JSON.stringify(wrongLabel),
        release,
        RELEASE_ID,
        "api",
      ),
    /differs from release metadata/,
  );
});

test("validated CLI lookup prints only the immutable API image ID", (t) => {
  const temporaryDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "arenzyra-image-manifest-"),
  );
  t.after(() =>
    fs.rmSync(temporaryDirectory, { recursive: true, force: true }),
  );
  const releaseFile = path.join(temporaryDirectory, `${RELEASE_ID}.env`);
  const manifestFile = path.join(
    temporaryDirectory,
    `${RELEASE_ID}.api-image.json`,
  );
  const release = Buffer.from(releaseEnvironment());
  const manifest = createReleaseImageManifest(
    inspection(),
    release,
    RELEASE_ID,
    "api",
  );
  fs.writeFileSync(releaseFile, release);
  fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);

  const result = spawnSync(
    process.execPath,
    [
      path.join(__dirname, "validate-release-image-manifest.cjs"),
      "--file",
      manifestFile,
      "--release-env",
      releaseFile,
      "--expected-release",
      RELEASE_ID,
      "--service",
      "api",
      "--print-image-id",
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, `${IMAGE_ID}\n`);
});
