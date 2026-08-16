#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const {
  verifyLauncherReleaseArtifacts,
} = require("./launcher-release-artifact-verifier.cjs");
const {
  stageVerifiedLauncherRelease,
} = require("./sync-launcher-downloads.cjs");
const {
  assertDesktopReleaseInputsClean,
} = require("./verify-desktop-release-inputs.cjs");

const ATTESTATION_ENV = "ARENZYRA_LAUNCHER_RELEASE_ATTESTATION";
const STAGING_ROOT_ENV = "ARENZYRA_LAUNCHER_STAGING_ROOT";

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function comparablePath(value) {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function parseAttestation(value = process.env[ATTESTATION_ENV]) {
  let attestation;
  try {
    attestation = JSON.parse(String(value || ""));
  } catch {
    throw new Error("Reviewed launcher release attestation is missing or invalid.");
  }
  const reviewedCommit = String(attestation?.reviewedCommit || "")
    .trim()
    .toLowerCase();
  const checkoutRoot = path.resolve(String(attestation?.checkoutRoot || ""));
  const gitPath = path.resolve(String(attestation?.gitPath || ""));
  const gitSha256 = String(attestation?.gitSha256 || "").trim().toLowerCase();
  const nodeSha256 = String(attestation?.nodeSha256 || "").trim().toLowerCase();
  if (
    attestation?.schemaVersion !== 1 ||
    !/^[a-f0-9]{40}$/.test(reviewedCommit) ||
    !path.isAbsolute(checkoutRoot) ||
    !path.isAbsolute(gitPath) ||
    !/^[a-f0-9]{64}$/.test(gitSha256) ||
    !/^[a-f0-9]{64}$/.test(nodeSha256)
  ) {
    throw new Error("Reviewed launcher release attestation is incomplete.");
  }
  return { checkoutRoot, gitPath, gitSha256, nodeSha256, reviewedCommit };
}

function runGit(attestation, args) {
  const env = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (!/^GIT_/i.test(name)) env[name] = value;
  }
  Object.assign(env, {
    GIT_CONFIG_GLOBAL: "NUL",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_NO_REPLACE_OBJECTS: "1",
    GIT_OPTIONAL_LOCKS: "0",
  });
  const result = spawnSync(
    attestation.gitPath,
    [
      "-c",
      "core.fsmonitor=false",
      "-c",
      "core.hooksPath=NUL",
      "-C",
      attestation.checkoutRoot,
      ...args,
    ],
    { encoding: "utf8", env, windowsHide: true },
  );
  if (result.error || result.status !== 0) {
    const detail = String(result.stderr || result.stdout || result.error || "").trim();
    throw new Error(`Reviewed launcher Git inspection failed: ${detail || "unknown error"}`);
  }
  return String(result.stdout || "").trim();
}

function assertReviewedCheckout(attestation) {
  if (process.platform !== "win32") {
    throw new Error("Reviewed launcher releases must run on Windows.");
  }
  if (comparablePath(process.cwd()) !== comparablePath(attestation.checkoutRoot)) {
    throw new Error("Reviewed launcher worker must run at the attested checkout root.");
  }
  if (
    sha256File(process.execPath) !== attestation.nodeSha256 ||
    sha256File(attestation.gitPath) !== attestation.gitSha256
  ) {
    throw new Error("Reviewed launcher Node or Git tool hash changed.");
  }
  const root = runGit(attestation, ["rev-parse", "--show-toplevel"]);
  const head = runGit(attestation, ["rev-parse", "HEAD"]).toLowerCase();
  if (
    comparablePath(root) !== comparablePath(attestation.checkoutRoot) ||
    head !== attestation.reviewedCommit
  ) {
    throw new Error("Reviewed launcher checkout identity does not match its attestation.");
  }
  if (runGit(attestation, ["replace", "-l"])) {
    throw new Error("Reviewed launcher checkout contains Git replacement refs.");
  }
  for (const graftPath of [
    path.join(attestation.checkoutRoot, ".git", "info", "grafts"),
    path.join(attestation.checkoutRoot, ".git", "objects", "info", "alternates"),
  ]) {
    if (fs.existsSync(graftPath)) {
      throw new Error(`Reviewed launcher checkout contains substitution metadata: ${graftPath}`);
    }
  }
  assertDesktopReleaseInputsClean({ repoRoot: attestation.checkoutRoot });
  return attestation;
}

function runReviewedLauncherRelease({
  action,
  attestationValue,
  stagingRoot = process.env[STAGING_ROOT_ENV],
} = {}) {
  const normalizedAction = String(action || "").trim().toLowerCase();
  if (!new Set(["verify", "stage"]).has(normalizedAction)) {
    throw new Error("Reviewed launcher release action must be verify or stage.");
  }
  const attestation = assertReviewedCheckout(parseAttestation(attestationValue));
  const verified = verifyLauncherReleaseArtifacts({
    distDir: path.join(attestation.checkoutRoot, "apps", "desktop", "dist"),
    packageJsonPath: path.join(
      attestation.checkoutRoot,
      "apps",
      "desktop",
      "package.json",
    ),
  });
  if (normalizedAction === "verify") {
    return {
      action: normalizedAction,
      ok: true,
      version: verified.version,
      installerSha256: verified.installer.sha256,
      portableZipSha256: verified.portableZip.sha256,
    };
  }
  const resolvedStagingRoot = path.resolve(String(stagingRoot || ""));
  if (!String(stagingRoot || "").trim() || !path.isAbsolute(resolvedStagingRoot)) {
    throw new Error(`${STAGING_ROOT_ENV} must be an absolute path for staging.`);
  }
  const staged = stageVerifiedLauncherRelease({ verified, stagingRoot: resolvedStagingRoot });
  return {
    action: normalizedAction,
    ok: true,
    version: staged.version,
    releaseId: staged.releaseId,
    releaseDirectory: staged.releaseDirectory,
  };
}

function main() {
  try {
    const result = runReviewedLauncherRelease({ action: process.argv[2] });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(
      `[launcher-release-blocked] ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  ATTESTATION_ENV,
  STAGING_ROOT_ENV,
  assertReviewedCheckout,
  parseAttestation,
  runReviewedLauncherRelease,
  sha256File,
};
