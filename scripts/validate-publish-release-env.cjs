#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const COMPONENTS = ["ROOT", "API", "WEB", "DISCORD", "MEDIA", "INFRA"];
const BASE_KEYS = [
  "ARENZYRA_RELEASE_ID",
  "ARENZYRA_SOURCE_DIGEST",
  "ARENZYRA_BUILD_ID",
  "ARENZYRA_GIT_COMMIT",
  "ARENZYRA_BUILD_AT",
  "ARENZYRA_BUILD_SOURCE",
  "ARENZYRA_BUILD_DIRTY",
  "ARENZYRA_BASE_IMAGES_SHA256",
  "ARENZYRA_BASE_IMAGES_B64",
  "ARENZYRA_RUNTIME_IMAGES_SHA256",
  "ARENZYRA_RUNTIME_IMAGES_B64",
  "ARENZYRA_PROVENANCE_OVERRIDE",
];
const EXPECTED_KEYS = new Set([
  ...BASE_KEYS,
  ...COMPONENTS.flatMap((component) => [
    `ARENZYRA_${component}_GIT_COMMIT`,
    `ARENZYRA_${component}_GIT_DIRTY`,
  ]),
]);
const SHA256 = /^sha256:[a-f0-9]{64}$/;
const REVISION = /^[a-f0-9]{12}$/;
const RELEASE_ID = /^git-[0-9]{8}-[0-9]{9}-[a-f0-9]{12}$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;

function parseReleaseEnvironment(text) {
  const values = Object.create(null);
  for (const [index, rawLine] of text.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const equalsAt = line.indexOf("=");
    if (equalsAt < 1 || /\s/.test(line.slice(0, equalsAt))) {
      throw new Error(`Release metadata line ${index + 1} is invalid.`);
    }
    const key = line.slice(0, equalsAt);
    if (Object.hasOwn(values, key)) {
      throw new Error(`Release metadata key ${key} is duplicated.`);
    }
    values[key] = line.slice(equalsAt + 1);
  }
  const actualKeys = Object.keys(values).sort();
  const expectedKeys = [...EXPECTED_KEYS].sort();
  if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) {
    throw new Error("Release metadata keys do not match the closed schema.");
  }
  return values;
}

function decodeHashedJson(values, valueKey, digestKey) {
  const encoded = values[valueKey];
  if (!BASE64URL.test(encoded)) {
    throw new Error(`${valueKey} is not canonical base64url.`);
  }
  const decoded = Buffer.from(encoded, "base64url");
  if (decoded.toString("base64url") !== encoded) {
    throw new Error(`${valueKey} is not canonical base64url.`);
  }
  const actualDigest = `sha256:${crypto.createHash("sha256").update(decoded).digest("hex")}`;
  if (actualDigest !== values[digestKey]) {
    throw new Error(`${digestKey} does not authenticate its payload.`);
  }
  let parsed;
  try {
    parsed = JSON.parse(decoded.toString("utf8"));
  } catch {
    throw new Error(`${valueKey} is not valid JSON.`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`${valueKey} must contain a JSON array.`);
  }
}

function validateReleaseEnvironment(values, expectedReleaseId = null) {
  const releaseId = values.ARENZYRA_RELEASE_ID;
  const sourceDigest = values.ARENZYRA_SOURCE_DIGEST;
  const buildAt = values.ARENZYRA_BUILD_AT;
  const canonicalBuildAt = Number.isFinite(Date.parse(buildAt))
    ? new Date(buildAt).toISOString()
    : "";
  const buildTimestamp = canonicalBuildAt
    .replace(/[-:.]/g, "")
    .replace("T", "-")
    .replace("Z", "");

  if (!RELEASE_ID.test(releaseId)) {
    throw new Error("Release ID is not an immutable clean-Git release ID.");
  }
  if (expectedReleaseId !== null && releaseId !== expectedReleaseId) {
    throw new Error("Release metadata does not match the requested release.");
  }
  if (!SHA256.test(sourceDigest)) {
    throw new Error("Release source digest is invalid.");
  }
  if (
    values.ARENZYRA_BUILD_ID !== releaseId ||
    values.ARENZYRA_BUILD_SOURCE !== "git" ||
    values.ARENZYRA_BUILD_DIRTY !== "false" ||
    values.ARENZYRA_PROVENANCE_OVERRIDE !== "false" ||
    canonicalBuildAt !== buildAt ||
    releaseId !==
      `git-${buildTimestamp}-${sourceDigest.slice("sha256:".length, "sha256:".length + 12)}`
  ) {
    throw new Error(
      "Release identity or clean-provenance fields are inconsistent.",
    );
  }
  if (!REVISION.test(values.ARENZYRA_GIT_COMMIT)) {
    throw new Error("Root Git revision is invalid.");
  }
  for (const component of COMPONENTS) {
    const commit = values[`ARENZYRA_${component}_GIT_COMMIT`];
    const dirty = values[`ARENZYRA_${component}_GIT_DIRTY`];
    if (!REVISION.test(commit) || dirty !== "false") {
      throw new Error(
        `Release component ${component} is not clean and immutable.`,
      );
    }
  }
  for (const component of ["ROOT", "DISCORD", "MEDIA", "INFRA"]) {
    if (
      values[`ARENZYRA_${component}_GIT_COMMIT`] !== values.ARENZYRA_GIT_COMMIT
    ) {
      throw new Error(
        `Release component ${component} is not rooted in the release revision.`,
      );
    }
  }
  for (const digestKey of [
    "ARENZYRA_BASE_IMAGES_SHA256",
    "ARENZYRA_RUNTIME_IMAGES_SHA256",
  ]) {
    if (!SHA256.test(values[digestKey])) {
      throw new Error(`${digestKey} is invalid.`);
    }
  }
  decodeHashedJson(
    values,
    "ARENZYRA_BASE_IMAGES_B64",
    "ARENZYRA_BASE_IMAGES_SHA256",
  );
  decodeHashedJson(
    values,
    "ARENZYRA_RUNTIME_IMAGES_B64",
    "ARENZYRA_RUNTIME_IMAGES_SHA256",
  );
  return values;
}

function validateReleaseEnvironmentText(text, expectedReleaseId = null) {
  return validateReleaseEnvironment(
    parseReleaseEnvironment(text),
    expectedReleaseId,
  );
}

function assertDiscordComposeImage(compose, expectedReleaseId) {
  const expected = `arenzyra-discord-bot:${expectedReleaseId}`;
  if (compose?.services?.["discord-bot"]?.image !== expected) {
    throw new Error(
      "Resolved Discord bot image differs from the requested release.",
    );
  }
}

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function readRegularNonSymlink(file) {
  const resolvedFile = path.resolve(file);
  const noFollow = fs.constants.O_NOFOLLOW ?? 0;
  let descriptor;
  try {
    descriptor = fs.openSync(resolvedFile, fs.constants.O_RDONLY | noFollow);
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile()) {
      throw new Error("Release metadata must be one regular non-symlink file.");
    }
    return fs.readFileSync(descriptor, "utf8");
  } catch (error) {
    if (error?.message?.includes("must be one regular")) throw error;
    throw new Error("Release metadata must be one readable regular non-symlink file.");
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function main() {
  try {
    const file = argumentValue("--file");
    const expectedReleaseId = argumentValue("--expected-release") ?? null;
    if (!file) throw new Error("--file is required.");
    validateReleaseEnvironmentText(
      readRegularNonSymlink(file),
      expectedReleaseId,
    );
    if (process.argv.includes("--assert-discord-compose-json")) {
      let compose;
      try {
        compose = JSON.parse(fs.readFileSync(0, "utf8"));
      } catch {
        throw new Error("Resolved Compose JSON is invalid.");
      }
      if (!expectedReleaseId) {
        throw new Error(
          "--expected-release is required for Compose assertion.",
        );
      }
      assertDiscordComposeImage(compose, expectedReleaseId);
    }
    process.stdout.write("PUBLISH RELEASE METADATA VERIFIED\n");
  } catch (error) {
    process.stderr.write(
      `PUBLISH RELEASE METADATA BLOCKED: ${error.message}\n`,
    );
    process.exitCode = 75;
  }
}

if (require.main === module) main();

module.exports = {
  COMPONENTS,
  EXPECTED_KEYS,
  assertDiscordComposeImage,
  parseReleaseEnvironment,
  validateReleaseEnvironment,
  validateReleaseEnvironmentText,
};
