"use strict";

const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_POLICY_PATH = path.join(
  __dirname,
  "packaged-runtime-verification.json",
);

function assertReleasePackagingReady() {
  const policyStat = fs.lstatSync(DEFAULT_POLICY_PATH);
  if (
    policyStat.isSymbolicLink() ||
    !policyStat.isFile() ||
    Number(policyStat.nlink || 1) !== 1 ||
    path.resolve(fs.realpathSync.native(DEFAULT_POLICY_PATH)) !==
      path.resolve(DEFAULT_POLICY_PATH)
  ) {
    throw new Error(
      "Desktop release packaging policy must be a regular, unlinked repository file.",
    );
  }
  const policy = JSON.parse(fs.readFileSync(DEFAULT_POLICY_PATH, "utf8"));
  const requiredChecks = [
    "exact-installer-inventory",
    "exact-portable-inventory",
    "inner-executables-explicitly-unsigned",
    "electron-runtime-and-native-dependency-hashes",
    "asar-integrity-and-only-load-from-asar-fuses",
    "checksum-bound-immutable-manifest",
  ];
  if (
    policy?.schemaVersion !== 3 ||
    policy?.implementationState !== "implemented-fail-closed-unsigned" ||
    !Array.isArray(policy?.enforcedChecks) ||
    policy.enforcedChecks.length !== requiredChecks.length ||
    requiredChecks.some((check) => !policy.enforcedChecks.includes(check))
  ) {
    throw new Error(
      "Desktop release packaging verifier policy is incomplete or not fail-closed.",
    );
  }
  const verifier = require("../../../scripts/packaged-runtime-integrity-verifier.cjs");
  for (const exportedCheck of [
    "verifyCompletePackagedRuntime",
    "verifyAsarFileIntegrity",
    "readEmbeddedAsarIntegrity",
    "readFuseWire",
    "readPeSignatureBlob",
    "comparePayloadInventories",
  ]) {
    if (typeof verifier[exportedCheck] !== "function") {
      throw new Error(
        `Desktop release packaging verifier is missing ${exportedCheck}.`,
      );
    }
  }
  return true;
}

module.exports = {
  DEFAULT_POLICY_PATH,
  assertReleasePackagingReady,
};
