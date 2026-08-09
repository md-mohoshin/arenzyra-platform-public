#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const {
  validateReleaseEnvironmentText,
} = require("./validate-publish-release-env.cjs");

const IMAGE_ID = /^sha256:[a-f0-9]{64}$/;
const MANIFEST_KEYS = Object.freeze([
  "schemaVersion",
  "releaseId",
  "releaseEnvironmentSha256",
  "service",
  "imageReference",
  "imageId",
  "labels",
]);
const REQUIRED_LABEL_KEYS = Object.freeze([
  "org.opencontainers.image.version",
  "org.opencontainers.image.revision",
  "org.opencontainers.image.created",
  "com.arenzyra.source-digest",
  "com.arenzyra.release-source",
]);
const SERVICES = Object.freeze({
  api: "arenzyra-api",
  web: "arenzyra-web",
  "media-ai": "arenzyra-media-ai",
  "discord-bot": "arenzyra-discord-bot",
});

function assertPlainObject(value, description) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${description} must be one JSON object.`);
  }
}

function assertExactKeys(value, expectedKeys, description) {
  assertPlainObject(value, description);
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${description} keys do not match the closed schema.`);
  }
}

function sha256(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function buildReleaseContext(
  releaseEnvironmentBytes,
  expectedReleaseId,
  service,
) {
  if (!Buffer.isBuffer(releaseEnvironmentBytes)) {
    releaseEnvironmentBytes = Buffer.from(releaseEnvironmentBytes);
  }
  if (!Object.hasOwn(SERVICES, service)) {
    throw new Error("Image-manifest service is unsupported.");
  }
  const release = validateReleaseEnvironmentText(
    releaseEnvironmentBytes.toString("utf8"),
    expectedReleaseId,
  );
  const imageReference = `${SERVICES[service]}:${release.ARENZYRA_RELEASE_ID}`;
  // Both reviewed Dockerfiles receive the root release revision as their
  // ARENZYRA_GIT_COMMIT build argument. Component revisions remain separately
  // authenticated by the release-environment validator.
  const expectedLabels = Object.freeze({
    "org.opencontainers.image.version": release.ARENZYRA_RELEASE_ID,
    "org.opencontainers.image.revision": release.ARENZYRA_GIT_COMMIT,
    "org.opencontainers.image.created": release.ARENZYRA_BUILD_AT,
    "com.arenzyra.source-digest": release.ARENZYRA_SOURCE_DIGEST,
    "com.arenzyra.release-source": release.ARENZYRA_BUILD_SOURCE,
  });
  return Object.freeze({
    releaseId: release.ARENZYRA_RELEASE_ID,
    releaseEnvironmentSha256: sha256(releaseEnvironmentBytes),
    service,
    imageReference,
    expectedLabels,
  });
}

function assertRequiredLabels(labels, expectedLabels) {
  assertPlainObject(labels, "Docker image labels");
  for (const key of REQUIRED_LABEL_KEYS) {
    if (labels[key] !== expectedLabels[key]) {
      throw new Error(
        `Docker image label ${key} differs from release metadata.`,
      );
    }
  }
}

function createReleaseImageManifest(
  dockerInspectText,
  releaseEnvironmentBytes,
  expectedReleaseId,
  service,
) {
  const context = buildReleaseContext(
    releaseEnvironmentBytes,
    expectedReleaseId,
    service,
  );
  let inspection;
  try {
    inspection = JSON.parse(dockerInspectText);
  } catch {
    throw new Error("Docker image inspection is not valid JSON.");
  }
  if (!Array.isArray(inspection) || inspection.length !== 1) {
    throw new Error("Docker image inspection must contain exactly one image.");
  }
  const image = inspection[0];
  assertPlainObject(image, "Docker image inspection entry");
  if (!IMAGE_ID.test(image.Id ?? "")) {
    throw new Error("Docker image ID is not an immutable sha256 identity.");
  }
  if (
    !Array.isArray(image.RepoTags) ||
    !image.RepoTags.includes(context.imageReference)
  ) {
    throw new Error(
      "Docker image is not tagged with the expected release reference.",
    );
  }
  assertRequiredLabels(image.Config?.Labels, context.expectedLabels);

  return {
    schemaVersion: 1,
    releaseId: context.releaseId,
    releaseEnvironmentSha256: context.releaseEnvironmentSha256,
    service: context.service,
    imageReference: context.imageReference,
    imageId: image.Id,
    labels: { ...context.expectedLabels },
  };
}

function parseReleaseImageManifest(text) {
  let manifest;
  try {
    manifest = JSON.parse(text);
  } catch {
    throw new Error("Release image manifest is not valid JSON.");
  }
  assertExactKeys(manifest, MANIFEST_KEYS, "Release image manifest");
  assertExactKeys(
    manifest.labels,
    REQUIRED_LABEL_KEYS,
    "Release image manifest labels",
  );
  return manifest;
}

function validateReleaseImageManifest(
  manifestOrText,
  releaseEnvironmentBytes,
  expectedReleaseId,
  service,
) {
  const manifest =
    typeof manifestOrText === "string"
      ? parseReleaseImageManifest(manifestOrText)
      : manifestOrText;
  assertExactKeys(manifest, MANIFEST_KEYS, "Release image manifest");
  assertExactKeys(
    manifest.labels,
    REQUIRED_LABEL_KEYS,
    "Release image manifest labels",
  );
  const context = buildReleaseContext(
    releaseEnvironmentBytes,
    expectedReleaseId,
    service,
  );
  if (manifest.schemaVersion !== 1) {
    throw new Error("Release image manifest schema version is unsupported.");
  }
  for (const [key, expected] of [
    ["releaseId", context.releaseId],
    ["releaseEnvironmentSha256", context.releaseEnvironmentSha256],
    ["service", context.service],
    ["imageReference", context.imageReference],
  ]) {
    if (manifest[key] !== expected) {
      throw new Error(
        `Release image manifest ${key} differs from release metadata.`,
      );
    }
  }
  if (!IMAGE_ID.test(manifest.imageId ?? "")) {
    throw new Error("Release image manifest imageId is invalid.");
  }
  assertRequiredLabels(manifest.labels, context.expectedLabels);
  return manifest;
}

function readRegularNonSymlink(file, description) {
  const resolved = path.resolve(file);
  const noFollow = fs.constants.O_NOFOLLOW ?? 0;
  let descriptor;
  try {
    descriptor = fs.openSync(resolved, fs.constants.O_RDONLY | noFollow);
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile()) {
      throw new Error(`${description} must be one regular non-symlink file.`);
    }
    return fs.readFileSync(descriptor);
  } catch (error) {
    if (error?.message?.includes("must be one regular")) throw error;
    throw new Error(`${description} must be one readable regular non-symlink file.`);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function parseArguments(argv) {
  const values = Object.create(null);
  const booleanFlags = new Set(["--from-docker-inspect", "--print-image-id"]);
  const valueFlags = new Set([
    "--file",
    "--release-env",
    "--expected-release",
    "--service",
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (booleanFlags.has(flag)) {
      if (Object.hasOwn(values, flag))
        throw new Error(`Duplicate flag: ${flag}`);
      values[flag] = true;
      continue;
    }
    if (!valueFlags.has(flag)) throw new Error(`Unknown flag: ${flag}`);
    if (Object.hasOwn(values, flag)) throw new Error(`Duplicate flag: ${flag}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${flag}.`);
    }
    values[flag] = value;
    index += 1;
  }
  return values;
}

function main() {
  try {
    const args = parseArguments(process.argv.slice(2));
    const releaseEnvironmentFile = args["--release-env"];
    const expectedReleaseId = args["--expected-release"];
    const service = args["--service"];
    const manifestFile = args["--file"];
    const fromDockerInspect = args["--from-docker-inspect"] === true;
    const printImageId = args["--print-image-id"] === true;
    if (!releaseEnvironmentFile || !expectedReleaseId || !service) {
      throw new Error(
        "--release-env, --expected-release, and --service are required.",
      );
    }
    if (Boolean(manifestFile) === fromDockerInspect) {
      throw new Error(
        "Choose exactly one --file or --from-docker-inspect input mode.",
      );
    }
    if (printImageId && !manifestFile) {
      throw new Error("--print-image-id requires --file.");
    }
    const releaseEnvironmentBytes = readRegularNonSymlink(
      releaseEnvironmentFile,
      "Release environment",
    );
    if (fromDockerInspect) {
      const manifest = createReleaseImageManifest(
        fs.readFileSync(0, "utf8"),
        releaseEnvironmentBytes,
        expectedReleaseId,
        service,
      );
      process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
      return;
    }
    const manifestBytes = readRegularNonSymlink(
      manifestFile,
      "Release image manifest",
    );
    const manifest = validateReleaseImageManifest(
      manifestBytes.toString("utf8"),
      releaseEnvironmentBytes,
      expectedReleaseId,
      service,
    );
    process.stdout.write(
      printImageId
        ? `${manifest.imageId}\n`
        : "RELEASE IMAGE MANIFEST VERIFIED\n",
    );
  } catch (error) {
    process.stderr.write(`RELEASE IMAGE MANIFEST BLOCKED: ${error.message}\n`);
    process.exitCode = 75;
  }
}

if (require.main === module) main();

module.exports = {
  IMAGE_ID,
  MANIFEST_KEYS,
  REQUIRED_LABEL_KEYS,
  SERVICES,
  buildReleaseContext,
  createReleaseImageManifest,
  parseReleaseImageManifest,
  validateReleaseImageManifest,
};
