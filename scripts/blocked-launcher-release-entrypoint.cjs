"use strict";

function assertTrustedLauncherReleaseBootstrapAvailable() {
  const bootstrapError = new Error(
    "Launcher release staging and verification are unavailable from same-checkout npm/Node entrypoints. Use the reviewed outer Windows launcher documented in infra/PUBLISH.md; it clears runtime/Git injection, pins the trusted toolchain, and builds a clean detached checkout. The underlying modules are callable only after that attestation.",
  );
  throw bootstrapError;
}

function runBlockedLauncherReleaseEntrypoint() {
  try {
    assertTrustedLauncherReleaseBootstrapAvailable();
  } catch (error) {
    console.error(`[launcher-release-blocked] ${error.message}`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  runBlockedLauncherReleaseEntrypoint();
}

module.exports = {
  assertTrustedLauncherReleaseBootstrapAvailable,
  runBlockedLauncherReleaseEntrypoint,
};
