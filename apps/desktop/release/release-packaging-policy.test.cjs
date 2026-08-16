"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  validateConfiguration,
} = require("app-builder-lib/out/util/config/config");
const { DebugLogger } = require("builder-util");

const candidateConfig = require("../electron-builder.candidate.config.cjs");
const releaseConfig = require("../electron-builder.config.cjs");
const {
  assertCandidatePackagingInvocation,
} = require("./candidate-packaging-policy.cjs");
const {
  DEFAULT_POLICY_PATH,
  assertReleasePackagingReady,
} = require("./release-packaging-policy.cjs");

function withCandidateArgv(callback) {
  const originalArgv = process.argv;
  process.argv = [
    process.execPath,
    "electron-builder",
    "--config",
    "electron-builder.candidate.config.cjs",
    "--publish",
    "never",
  ];
  try {
    return callback();
  } finally {
    process.argv = originalArgv;
  }
}

test("tracked desktop package policy enables the fail-closed verifier", () => {
  assert.equal(assertReleasePackagingReady(), true);
  const policy = JSON.parse(fs.readFileSync(DEFAULT_POLICY_PATH, "utf8"));
  assert.equal(policy.schemaVersion, 3);
  assert.equal(
    policy.implementationState,
    "implemented-fail-closed-unsigned",
  );
  assert.deepEqual(policy.enforcedChecks, [
    "exact-installer-inventory",
    "exact-portable-inventory",
    "inner-executables-explicitly-unsigned",
    "electron-runtime-and-native-dependency-hashes",
    "asar-integrity-and-only-load-from-asar-fuses",
    "checksum-bound-immutable-manifest",
  ]);
});

test("callers cannot replace the tracked packaging policy with review strings", () => {
  const forgedApproval = {
    policy: {
      schemaVersion: 1,
      implementationState: "verified-ready",
      approval: {
        state: "approved",
        reviewedAt: "2026-08-09T12:00:00.000Z",
        reviewedBy: "Fixture Security Reviewer",
        reviewReference: "SECURITY-REVIEW-123",
      },
    },
  };
  assert.equal(assertReleasePackagingReady(forgedApproval), true);
  assert.equal(releaseConfig.beforePack(forgedApproval), undefined);
});

test("production packaging preserves root ob.js while the local candidate remains non-publishable", () => {
  assert.equal(releaseConfig.beforePack(), undefined);
  assert.equal(releaseConfig.forceCodeSigning, false);
  assert.equal(releaseConfig.win.signExecutable, false);
  assert.equal(releaseConfig.win.verifyUpdateCodeSignature, false);
  assert.equal(releaseConfig.win.signtoolOptions, undefined);
  assert.equal(
    releaseConfig.extraResources.some(
      (resource) =>
        resource.from === "../../ob.js" &&
        resource.to === "connectors/ob.js",
    ),
    true,
  );
  assert.equal(withCandidateArgv(() => candidateConfig.beforeBuild()), false);
});

test("representative candidate config is ASAR-bound and non-publishable", () => {
  assert.equal(candidateConfig.asar, true);
  assert.deepEqual(candidateConfig.asarUnpack, [
    "**/*.node",
    "node_modules/sharp/**/*",
    "node_modules/@img/**/*",
  ]);
  assert.equal(candidateConfig.disableSanityCheckAsar, false);
  assert.equal(candidateConfig.forceCodeSigning, false);
  assert.equal(candidateConfig.npmRebuild, undefined);
  assert.equal(candidateConfig.electronDist, "node_modules/electron/dist");
  for (const dependencyName of [
    "uiohook-napi",
    "node-gyp-build",
    "sharp",
    "@img/sharp-win32-x64",
  ]) {
    assert.ok(
      candidateConfig.files.some(
        (entry) =>
          typeof entry === "object" &&
          entry.to === `node_modules/${dependencyName}`,
      ),
      `candidate must package app-local ${dependencyName}`,
    );
  }
  assert.equal(candidateConfig.publish, null);
  assert.equal(
    candidateConfig.directories.output,
    "dist-candidate-not-for-distribution",
  );
  assert.match(candidateConfig.artifactName, /CANDIDATE-NOT-FOR-DISTRIBUTION/);
  assert.deepEqual(candidateConfig.electronFuses, {
    runAsNode: true,
    enableNodeOptionsEnvironmentVariable: false,
    enableNodeCliInspectArguments: false,
    enableEmbeddedAsarIntegrityValidation: true,
    onlyLoadAppFromAsar: true,
  });
  assert.deepEqual(candidateConfig.win.target, ["nsis", "zip"]);
});

test("production and candidate configs satisfy the installed builder schema", async () => {
  await validateConfiguration(releaseConfig, new DebugLogger(false));
  await validateConfiguration(candidateConfig, new DebugLogger(false));
});

test("representative candidate invocation requires the dedicated config and publish never", () => {
  const accepted = [
    "node",
    "electron-builder",
    "--config",
    "electron-builder.candidate.config.cjs",
    "--publish",
    "never",
  ];
  assert.equal(assertCandidatePackagingInvocation({ argv: accepted }), true);

  for (const rejected of [
    accepted.filter((argument) => argument !== "never"),
    accepted.map((argument) => (argument === "never" ? "always" : argument)),
    [...accepted, "--publish=never"],
    accepted.map((argument) =>
      argument === "electron-builder.candidate.config.cjs"
        ? "electron-builder.config.cjs"
        : argument,
    ),
  ]) {
    assert.throws(
      () => assertCandidatePackagingInvocation({ argv: rejected }),
      /requires the dedicated candidate config.*--publish never/i,
    );
  }
});

test("desktop scripts enable production packaging and isolate the candidate", () => {
  const desktopPackage = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"),
  );
  const releaseCommand = desktopPackage.scripts["build:electron"];
  const candidateCommand = desktopPackage.scripts["build:electron:candidate"];

  assert.match(
    releaseCommand,
    /electron-builder --config electron-builder\.config\.cjs$/,
  );
  assert.doesNotMatch(releaseCommand, /candidate|--publish/i);
  assert.match(
    candidateCommand,
    /verify:release-inputs && electron-builder --config electron-builder\.candidate\.config\.cjs --publish never$/,
  );
  assert.doesNotMatch(
    candidateCommand,
    /verify:connector-provenance|verify:map-provenance/,
  );
  assert.doesNotMatch(
    candidateCommand,
    /stage:launcher-release|sync-launcher-downloads|public[\\/]downloads/i,
  );
});
