"use strict";

const releaseConfig = require("./electron-builder.config.cjs");
const {
  assertCandidatePackagingInvocation,
} = require("./release/candidate-packaging-policy.cjs");

const { beforePack: _releaseBlock, ...sharedConfig } = releaseConfig;

const assertCandidateInvocation = () => {
  assertCandidatePackagingInvocation();
  return true;
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
  // uiohook-napi 1.5.5 ships a Windows x64 N-API prebuild that is verified
  // against the pinned Electron runtime before local candidate packaging.
  // Avoid requiring a machine-local Visual Studio toolchain for this
  // deliberately non-publishable artifact.
  npmRebuild: false,
  electronDist: "node_modules/electron/dist",
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
