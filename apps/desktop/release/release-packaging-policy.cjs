"use strict";

const path = require("node:path");

const DEFAULT_POLICY_PATH = path.join(
  __dirname,
  "packaged-runtime-verification.json",
);

function assertReleasePackagingReady() {
  // This is deliberately a code-level block, not a metadata approval gate.
  // Replacing strings in packaged-runtime-verification.json must never turn the
  // production builder into an artifact-producing command. Once the complete
  // verifier exists, this function must be replaced by that verifier and its
  // immutable evidence binding in a reviewed source change.
  throw new Error(
    "Desktop release packaging is blocked until ASAR integrity and complete real-package verification are implemented, proven, and bound to immutable evidence in code.",
  );
}

module.exports = {
  DEFAULT_POLICY_PATH,
  assertReleasePackagingReady,
};
