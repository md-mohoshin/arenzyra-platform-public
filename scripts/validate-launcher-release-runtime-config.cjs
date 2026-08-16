"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");

const MAX_CONFIG_BYTES = 16 * 1024;
const MAX_ARTIFACT_BYTES = 2 * 1024 * 1024 * 1024;
const RELEASE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{2,79}$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z][0-9A-Za-z.-]{0,31})?$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value, keys) {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

function isBoundedString(value, minimum, maximum) {
  return (
    typeof value === "string" &&
    value === value.trim() &&
    value.length >= minimum &&
    value.length <= maximum
  );
}

function isIsoTimestamp(value) {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T.*Z$/.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

function validateImmutableHttpsUrl(rawUrl, releaseId, extension) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  const hostname = url.hostname.toLowerCase();
  const isLocal =
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname) ||
    hostname.includes(":");
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443") ||
    url.search ||
    url.hash ||
    isLocal ||
    !url.pathname.toLowerCase().endsWith(extension)
  ) {
    return null;
  }

  const segments = url.pathname
    .split("/")
    .filter(Boolean)
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return "";
      }
    });
  return segments.includes(releaseId) ? url.toString() : null;
}

function validateArtifact(value, releaseId, extension) {
  if (
    !isObject(value) ||
    !hasOnlyKeys(value, ["url", "sha256", "sizeBytes"]) ||
    !isBoundedString(value.url, 1, 2048) ||
    typeof value.sha256 !== "string" ||
    !SHA256_PATTERN.test(value.sha256) ||
    /^0{64}$/.test(value.sha256) ||
    !Number.isSafeInteger(value.sizeBytes) ||
    value.sizeBytes <= 0 ||
    value.sizeBytes > MAX_ARTIFACT_BYTES
  ) {
    return null;
  }

  const url = validateImmutableHttpsUrl(value.url, releaseId, extension);
  return url
    ? { url, sha256: value.sha256, sizeBytes: value.sizeBytes }
    : null;
}

function validateLauncherReleaseRuntimeConfig(rawInput) {
  const raw = String(rawInput ?? "");
  if (
    !raw ||
    raw !== raw.trim() ||
    Buffer.byteLength(raw, "utf8") > MAX_CONFIG_BYTES ||
    /[\r\n]/.test(raw) ||
    raw.includes("$") ||
    raw.includes("'")
  ) {
    return null;
  }

  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }

  if (
    !isObject(value) ||
    !hasOnlyKeys(value, [
      "schemaVersion",
      "version",
      "releaseId",
      "publishedAt",
      "signing",
      "integrity",
      "manifestUrl",
      "artifacts",
    ]) ||
    value.schemaVersion !== 2 ||
    !isBoundedString(value.version, 1, 64) ||
    !VERSION_PATTERN.test(value.version) ||
    !isBoundedString(value.releaseId, 3, 80) ||
    !RELEASE_ID_PATTERN.test(value.releaseId) ||
    /^(latest|current|stable|production|prod)$/i.test(value.releaseId) ||
    !value.releaseId.includes(value.version) ||
    !isIsoTimestamp(value.publishedAt) ||
    !isObject(value.signing) ||
    !hasOnlyKeys(value.signing, [
      "status",
      "publisher",
      "certificateSha256",
      "checkedAt",
      "warning",
    ]) ||
    value.signing.status !== "unsigned" ||
    value.signing.publisher !== null ||
    value.signing.certificateSha256 !== null ||
    !isIsoTimestamp(value.signing.checkedAt) ||
    Date.parse(value.signing.checkedAt) < Date.parse(value.publishedAt) ||
    !isBoundedString(value.signing.warning, 20, 500) ||
    !/\bUnknown publisher\b/i.test(value.signing.warning) ||
    /[\u0000-\u001f\u007f]/.test(value.signing.warning) ||
    !isObject(value.integrity) ||
    !hasOnlyKeys(value.integrity, [
      "status",
      "algorithm",
      "manifestSha256",
      "verifiedAt",
    ]) ||
    value.integrity.status !== "verified" ||
    value.integrity.algorithm !== "SHA-256" ||
    typeof value.integrity.manifestSha256 !== "string" ||
    !SHA256_PATTERN.test(value.integrity.manifestSha256) ||
    /^0{64}$/.test(value.integrity.manifestSha256) ||
    !isIsoTimestamp(value.integrity.verifiedAt) ||
    Date.parse(value.integrity.verifiedAt) < Date.parse(value.publishedAt) ||
    !isBoundedString(value.manifestUrl, 1, 2048) ||
    !isObject(value.artifacts) ||
    !hasOnlyKeys(value.artifacts, ["installer", "portableZip"])
  ) {
    return null;
  }

  const manifestUrl = validateImmutableHttpsUrl(
    value.manifestUrl,
    value.releaseId,
    ".json",
  );
  const installer = validateArtifact(
    value.artifacts.installer,
    value.releaseId,
    ".exe",
  );
  const portableZip = validateArtifact(
    value.artifacts.portableZip,
    value.releaseId,
    ".zip",
  );
  if (!manifestUrl || !installer || !portableZip) return null;

  const expectedOrigin = new URL(manifestUrl).origin;
  if (
    new URL(installer.url).origin !== expectedOrigin ||
    new URL(portableZip.url).origin !== expectedOrigin ||
    new Set([manifestUrl, installer.url, portableZip.url]).size !== 3
  ) {
    return null;
  }

  return {
    version: value.version,
    releaseId: value.releaseId,
    configSha256: crypto.createHash("sha256").update(raw, "utf8").digest("hex"),
  };
}

function main() {
  const raw = fs.readFileSync(0, "utf8");
  const result = validateLauncherReleaseRuntimeConfig(raw);
  if (!result) {
    console.error("Launcher release runtime configuration is invalid.");
    process.exitCode = 75;
    return;
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (require.main === module) main();

module.exports = { validateLauncherReleaseRuntimeConfig };
