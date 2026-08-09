"use strict";

const {
  verifyDesktopConnectorCommercialProvenance,
} = require("./verify-desktop-connector-provenance.cjs");

function assertTrustedLauncherReleaseBootstrapAvailable({
  connectorProvenanceVerifier = verifyDesktopConnectorCommercialProvenance,
} = {}) {
  let provenanceError = null;
  try {
    connectorProvenanceVerifier();
  } catch (error) {
    provenanceError = error;
  }
  const bootstrapError = new Error(
    "Launcher release staging and verification are unavailable from same-checkout npm/Node entrypoints. Use a future reviewed outer Windows launcher that clears runtime/Git injection, pins the trusted toolchain, and builds a clean detached checkout. The underlying modules remain non-production test scaffolds.",
  );
  if (provenanceError) {
    throw new AggregateError(
      [bootstrapError, provenanceError],
      `${bootstrapError.message} Connector commercial provenance is also blocked: ${
        provenanceError instanceof Error
          ? provenanceError.message
          : String(provenanceError)
      }`,
    );
  }
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
