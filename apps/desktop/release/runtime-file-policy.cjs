"use strict";

const fs = require("node:fs");
const path = require("node:path");

const DESKTOP_ROOT = path.resolve(__dirname, "..");
const ELECTRON_ROOT = path.join(DESKTOP_ROOT, "electron");

const EXCLUDED_EXACT_PATHS = new Set([
  "electron/overlayServer.cjs",
  "electron/cs2-gsi/run-proof.cjs",
  "electron/widgetsServer.cjs",
  "electron/widgetsServer.ts",
]);
const COMMERCIAL_MAP_RASTER_RUNTIME_PATH =
  /^electron\/assets\/maps\/.+\.(?:jpe?g|png|webp)$/i;

function toPosix(value) {
  return String(value || "").replace(/\\/g, "/");
}

function isCommercialMapRasterRuntimePath(relativePath) {
  const normalized = toPosix(relativePath).replace(/^\.\//, "");
  return COMMERCIAL_MAP_RASTER_RUNTIME_PATH.test(normalized);
}

function isPackagedElectronRuntimePath(
  relativePath,
  { approvedCommercialMapPaths = [] } = {},
) {
  const normalized = toPosix(relativePath).replace(/^\.\//, "");
  if (!normalized.startsWith("electron/")) return false;
  if (EXCLUDED_EXACT_PATHS.has(normalized)) return false;
  if (isCommercialMapRasterRuntimePath(normalized)) {
    const approvedPaths =
      approvedCommercialMapPaths instanceof Set
        ? approvedCommercialMapPaths
        : new Set(
            Array.isArray(approvedCommercialMapPaths)
              ? approvedCommercialMapPaths
              : [],
          );
    if (!approvedPaths.has(normalized)) return false;
  }
  if (normalized.endsWith(".test.cjs") || normalized.endsWith(".md")) {
    return false;
  }
  const segments = normalized.split("/");
  return !segments.includes("fixtures") && !segments.includes("test-fixtures");
}

function comparablePath(value) {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function assertRegularUnlinkedPath(filePath, label) {
  const stat = fs.lstatSync(filePath);
  if (stat.isSymbolicLink()) {
    throw new Error(
      `${label} must not be a symbolic link or junction: ${filePath}`,
    );
  }
  if (
    comparablePath(fs.realpathSync.native(filePath)) !==
    comparablePath(filePath)
  ) {
    throw new Error(
      `${label} traverses a redirected or reparse path: ${filePath}`,
    );
  }
  if (stat.isFile() && Number(stat.nlink || 1) !== 1) {
    throw new Error(`${label} must not be a multiply linked file: ${filePath}`);
  }
  return stat;
}

function listPackagedElectronRuntimeFiles({
  desktopRoot = DESKTOP_ROOT,
  electronRoot = path.join(desktopRoot, "electron"),
  approvedCommercialMapPaths = [],
} = {}) {
  if (!fs.existsSync(electronRoot)) {
    throw new Error(
      `Electron runtime source directory is missing: ${electronRoot}`,
    );
  }
  const rootStat = assertRegularUnlinkedPath(
    electronRoot,
    "Electron runtime source directory",
  );
  if (!rootStat.isDirectory()) {
    throw new Error(
      `Electron runtime source is not a directory: ${electronRoot}`,
    );
  }

  const files = [];
  const visit = (directory) => {
    for (const entry of fs
      .readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name))) {
      const filePath = path.join(directory, entry.name);
      const stat = assertRegularUnlinkedPath(
        filePath,
        "Electron runtime source entry",
      );
      if (stat.isDirectory()) {
        visit(filePath);
        continue;
      }
      if (!stat.isFile()) continue;
      const relativePath = toPosix(path.relative(desktopRoot, filePath));
      if (
        isPackagedElectronRuntimePath(relativePath, {
          approvedCommercialMapPaths,
        })
      ) {
        files.push(relativePath);
      }
    }
  };
  visit(electronRoot);

  if (!files.includes("electron/main.cjs")) {
    throw new Error(
      "Electron runtime policy excluded the application entrypoint.",
    );
  }
  return files.sort((left, right) => left.localeCompare(right));
}

module.exports = {
  DESKTOP_ROOT,
  ELECTRON_ROOT,
  EXCLUDED_EXACT_PATHS,
  isCommercialMapRasterRuntimePath,
  isPackagedElectronRuntimePath,
  listPackagedElectronRuntimeFiles,
};
