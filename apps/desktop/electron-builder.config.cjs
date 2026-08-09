"use strict";

const {
  listPackagedElectronRuntimeFiles,
} = require("./release/runtime-file-policy.cjs");
const {
  assertReleasePackagingReady,
} = require("./release/release-packaging-policy.cjs");

const electronRuntimeFiles = listPackagedElectronRuntimeFiles();

module.exports = {
  appId: "com.arenzyra.observerlauncher",
  productName: "Arenzyra Observer Launcher",
  // Keep this explicit until the managed connector no longer relies on
  // ELECTRON_RUN_AS_NODE and a representative signed package proves the ASAR
  // integrity/fuse migration. Publication remains blocked by the release gate.
  asar: false,
  forceCodeSigning: true,
  publish: null,
  beforePack: () => assertReleasePackagingReady(),
  protocols: [
    {
      name: "Arenzyra Observer Launcher",
      schemes: ["arenzyra-launcher"],
    },
  ],
  files: [
    "dist/index.html",
    "dist/assets/**/*",
    ...electronRuntimeFiles,
    "package.json",
  ],
  extraResources: [
    { from: "../../ob.js", to: "connectors/ob.js" },
    {
      from: "electron/direct-observer-transport-payload.cjs",
      to: "connectors/direct-observer-transport-payload.cjs",
    },
    {
      from: "electron/observer-runtime-health.cjs",
      to: "connectors/observer-runtime-health.cjs",
    },
    {
      from: "electron/observer-telemetry-contract.cjs",
      to: "connectors/observer-telemetry-contract.cjs",
    },
    {
      from: "electron/connector-http-access-policy.cjs",
      to: "connectors/connector-http-access-policy.cjs",
    },
    { from: "build/icon.ico", to: "icon.ico" },
    { from: "build/default-team.png", to: "default-team.png" },
    { from: "build/default-player.svg", to: "default-player.svg" },
    { from: "build/shadow-logo-template.svg", to: "shadow-logo-template.svg" },
  ],
  directories: { buildResources: "build" },
  win: {
    icon: "icon.ico",
    target: ["nsis", "zip"],
    signtoolOptions: {
      signingHashAlgorithms: ["sha256"],
      rfc3161TimeStampServer: "http://timestamp.digicert.com",
    },
    verifyUpdateCodeSignature: true,
  },
};
