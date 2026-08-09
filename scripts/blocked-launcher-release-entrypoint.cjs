"use strict";

function assertTrustedLauncherReleaseBootstrapAvailable() {
  throw new Error(
    "Launcher release staging and verification are unavailable from same-checkout npm/Node entrypoints. Use a future reviewed outer Windows launcher that clears runtime/Git injection, pins the trusted toolchain, and builds a clean detached checkout. The underlying modules remain non-production test scaffolds.",
  );
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
