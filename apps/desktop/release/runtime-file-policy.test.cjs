"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const builderConfig = require("../electron-builder.config.cjs");
const candidateBuilderConfig = require("../electron-builder.candidate.config.cjs");
const {
  isCommercialMapRasterRuntimePath,
  isPackagedElectronRuntimePath,
  listPackagedElectronRuntimeFiles,
} = require("./runtime-file-policy.cjs");

test("desktop builder and release verifier share one exact runtime source list", () => {
  const runtimeFiles = listPackagedElectronRuntimeFiles();
  const configuredRuntimeFiles = builderConfig.files.filter((filePath) =>
    filePath.startsWith("electron/"),
  );

  assert.deepEqual(configuredRuntimeFiles, runtimeFiles);
  assert.deepEqual(
    candidateBuilderConfig.files.filter((filePath) =>
      filePath.startsWith("electron/"),
    ),
    runtimeFiles,
  );
  assert.ok(runtimeFiles.includes("electron/main.cjs"));
  assert.ok(runtimeFiles.includes("electron/widget-server/server.cjs"));
  assert.ok(
    runtimeFiles.includes("electron/assets/maps/map-not-available.svg"),
  );
  assert.deepEqual(
    runtimeFiles.filter(isCommercialMapRasterRuntimePath),
    [],
  );
  assert.equal(new Set(runtimeFiles).size, runtimeFiles.length);
});

test("desktop runtime policy excludes tests, fixtures, docs, proofs, and proxies", () => {
  for (const excluded of [
    "electron/overlayServer.cjs",
    "electron/cs2-gsi/run-proof.cjs",
    "electron/widgetsServer.cjs",
    "electron/widgetsServer.ts",
    "electron/configManager.test.cjs",
    "electron/cs2-gsi/README.md",
    "electron/cs2-gsi/fixtures/synthetic-observer.json",
    "electron/map-engine/test-fixtures/pcob/erangel-opening.json",
  ]) {
    assert.equal(isPackagedElectronRuntimePath(excluded), false, excluded);
  }
});

test("desktop runtime excludes commercial map rasters unless an evidence-approved path list is supplied", () => {
  const rasterPath = "electron/assets/maps/erangel.png";
  assert.equal(isCommercialMapRasterRuntimePath(rasterPath), true);
  assert.equal(isPackagedElectronRuntimePath(rasterPath), false);
  assert.equal(
    isPackagedElectronRuntimePath(rasterPath, {
      approvedCommercialMapPaths: [rasterPath],
    }),
    true,
  );
  assert.equal(
    isPackagedElectronRuntimePath("electron/assets/maps/map-not-available.svg"),
    true,
  );
});

test("desktop release configuration forces SHA-256 signing and RFC3161 timestamping", () => {
  assert.equal(builderConfig.forceCodeSigning, true);
  assert.deepEqual(builderConfig.win.signtoolOptions.signingHashAlgorithms, [
    "sha256",
  ]);
  assert.match(
    builderConfig.win.signtoolOptions.rfc3161TimeStampServer,
    /^http:\/\/timestamp\.digicert\.com$/,
  );
});

test("desktop builder refuses packaging while the runtime policy is blocked", () => {
  assert.throws(
    () => builderConfig.beforePack(),
    /release packaging is blocked/i,
  );
});

test("desktop builder extra resources resolve to regular source files", () => {
  const desktopRoot = path.resolve(__dirname, "..");
  assert.ok(
    Array.isArray(builderConfig.extraResources) &&
      builderConfig.extraResources.length > 0,
  );
  for (const resource of builderConfig.extraResources) {
    assert.equal(typeof resource?.from, "string");
    const sourcePath = path.resolve(desktopRoot, resource.from);
    assert.equal(
      fs.statSync(sourcePath).isFile(),
      true,
      `Missing desktop package resource source: ${resource.from}`,
    );
  }
});
