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
  const configuredRuntimeFiles = builderConfig.files.filter(
    (filePath) =>
      typeof filePath === "string" && filePath.startsWith("electron/"),
  );

  assert.deepEqual(configuredRuntimeFiles, runtimeFiles);
  assert.deepEqual(
    candidateBuilderConfig.files.filter(
      (filePath) =>
        typeof filePath === "string" && filePath.startsWith("electron/"),
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

test("desktop release configuration explicitly disables executable signing", () => {
  assert.equal(builderConfig.asar, true);
  assert.equal(builderConfig.disableSanityCheckAsar, false);
  assert.equal(builderConfig.electronFuses.enableEmbeddedAsarIntegrityValidation, true);
  assert.equal(builderConfig.electronFuses.onlyLoadAppFromAsar, true);
  assert.equal(builderConfig.forceCodeSigning, false);
  assert.equal(builderConfig.win.signExecutable, false);
  assert.equal(builderConfig.win.verifyUpdateCodeSignature, false);
  assert.equal(builderConfig.win.signtoolOptions, undefined);
});

test("desktop builder preserves the root ob.js connector without the provenance release gate", () => {
  assert.equal(builderConfig.beforePack(), undefined);
  assert.equal(
    builderConfig.extraResources.some(
      (entry) =>
        entry.from === "../../ob.js" && entry.to === "connectors/ob.js",
    ),
    true,
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
