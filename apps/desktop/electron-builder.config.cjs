"use strict";

const {
  listPackagedElectronRuntimeFiles,
} = require("./release/runtime-file-policy.cjs");
const {
  assertReleasePackagingReady,
} = require("./release/release-packaging-policy.cjs");
const {
  collectLocalDependencyFileSets,
} = require("./release/local-dependency-file-policy.cjs");
const {
  listSharpNativeRuntimeExtraResources,
} = require("./release/sharp-native-runtime-policy.cjs");

const electronRuntimeFiles = listPackagedElectronRuntimeFiles();
const localDependencyFileSets = collectLocalDependencyFileSets();
const sharpNativeRuntimeExtraResources =
  listSharpNativeRuntimeExtraResources();

function assertProductionPackagingReady() {
  assertReleasePackagingReady();
}

module.exports = {
  appId: "com.arenzyra.observerlauncher",
  productName: "Arenzyra Observer Launcher",
  asar: true,
  asarUnpack: ["**/*.node"],
  disableSanityCheckAsar: false,
  electronFuses: {
    // The managed connector still requires ELECTRON_RUN_AS_NODE. Every other
    // reviewed fuse is explicit, and application loading is bound to the
    // integrity-checked app.asar.
    runAsNode: true,
    enableNodeOptionsEnvironmentVariable: false,
    enableNodeCliInspectArguments: false,
    enableEmbeddedAsarIntegrityValidation: true,
    onlyLoadAppFromAsar: true,
    loadBrowserProcessSpecificV8Snapshot: false,
    grantFileProtocolExtraPrivileges: true,
  },
  forceCodeSigning: false,
  publish: null,
  beforeBuild: () => {
    assertProductionPackagingReady();
    // Exact app-local dependency file sets below replace electron-builder's
    // workspace-root dependency discovery.
    return false;
  },
  beforePack: () => assertProductionPackagingReady(),
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
    ...localDependencyFileSets,
  ],
  extraResources: [
    ...sharpNativeRuntimeExtraResources,
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
    // The owner selected an explicitly unsigned distribution. Keep executable
    // resource editing, but prevent electron-builder from signing even when a
    // certificate happens to be present in the environment or certificate store.
    signExecutable: false,
    verifyUpdateCodeSignature: false,
  },
};
