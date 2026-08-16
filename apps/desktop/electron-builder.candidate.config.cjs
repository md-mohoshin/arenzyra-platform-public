"use strict";

const releaseConfig = require("./electron-builder.config.cjs");
const {
  assertCandidatePackagingInvocation,
} = require("./release/candidate-packaging-policy.cjs");

const { beforePack: _releaseBlock, ...sharedConfig } = releaseConfig;

const assertCandidateInvocation = () => {
  assertCandidatePackagingInvocation();
  // Dependency packaging is already handled by the exact app-local file sets
  // inherited from the production configuration.
  return false;
};

module.exports = {
  ...sharedConfig,
  // This configuration exists only to produce a representative package for
  // verifier development. Its output names and directory cannot satisfy the
  // release verifier's canonical artifact lookup.
  asar: true,
  asarUnpack: [
    "**/*.node",
    "node_modules/sharp/**/*",
    "node_modules/@img/**/*",
  ],
  disableSanityCheckAsar: false,
  forceCodeSigning: false,
  electronDist: "node_modules/electron/dist",
  // electron-builder detects the monorepo's declared pnpm manager even when
  // this Windows checkout is installed with npm. Explicit app-local file sets
  // prevent it from silently packaging the root dependency graph instead of
  // the launcher's declared production dependency graph.
  publish: null,
  artifactName:
    "Arenzyra-Observer-Launcher-${version}-${arch}-CANDIDATE-NOT-FOR-DISTRIBUTION.${ext}",
  directories: {
    ...sharedConfig.directories,
    output: "dist-candidate-not-for-distribution",
  },
  electronFuses: {
    // The managed connector currently requires ELECTRON_RUN_AS_NODE. The
    // remaining explicitly set fuses prevent common runtime injection and bind
    // application loading to the integrity-checked app.asar.
    runAsNode: true,
    enableNodeOptionsEnvironmentVariable: false,
    enableNodeCliInspectArguments: false,
    enableEmbeddedAsarIntegrityValidation: true,
    onlyLoadAppFromAsar: true,
  },
  beforeBuild: assertCandidateInvocation,
  beforePack: assertCandidateInvocation,
  afterAllArtifactBuild: () => {
    assertCandidateInvocation();
    return [];
  },
};
