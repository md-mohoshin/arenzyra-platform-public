"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  MAP_DEFINITIONS,
  SUPPORTED_MAP_ASSET_EXTENSIONS,
} = require("../apps/desktop/electron/map-engine/map-registry.cjs");

const REPO_ROOT = path.resolve(__dirname, "..");
const DESKTOP_MAPS_DIR = path.join(
  REPO_ROOT,
  "apps",
  "desktop",
  "electron",
  "assets",
  "maps",
);
const WEB_MAP_SOURCE_DIRS = [
  path.join(REPO_ROOT, "apps", "arenzyra-web", "public", "maps"),
  path.join(REPO_ROOT, "apps", "arenzyra-web", "public", "assets", "maps"),
  path.join(REPO_ROOT, "apps", "arenzyra-web", "public", "images", "maps"),
];

function toPosixPath(value) {
  return value.split(path.sep).join("/");
}

function getMapBaseName(definition) {
  return path.parse(String(definition?.imagePath || definition?.key || "").trim()).name;
}

function findSourceAsset(baseName) {
  for (const directory of WEB_MAP_SOURCE_DIRS) {
    if (!fs.existsSync(directory)) {
      continue;
    }

    for (const extension of SUPPORTED_MAP_ASSET_EXTENSIONS) {
      const candidatePath = path.join(directory, `${baseName}${extension}`);
      if (fs.existsSync(candidatePath)) {
        return candidatePath;
      }
    }
  }

  return null;
}

function removeStaleAssets(baseName, keepAbsolutePath = null) {
  const removed = [];

  for (const extension of SUPPORTED_MAP_ASSET_EXTENSIONS) {
    const candidatePath = path.join(DESKTOP_MAPS_DIR, `${baseName}${extension}`);
    if (!fs.existsSync(candidatePath)) {
      continue;
    }

    if (keepAbsolutePath && path.resolve(candidatePath) === path.resolve(keepAbsolutePath)) {
      continue;
    }

    fs.rmSync(candidatePath, { force: true });
    removed.push(candidatePath);
  }

  return removed;
}

function syncDesktopMaps({ log = console.log } = {}) {
  fs.mkdirSync(DESKTOP_MAPS_DIR, { recursive: true });

  const copied = [];
  const missing = [];
  const removed = [];

  for (const definition of MAP_DEFINITIONS) {
    const baseName = getMapBaseName(definition);
    if (!baseName) {
      continue;
    }

    const sourceAssetPath = findSourceAsset(baseName);
    if (!sourceAssetPath) {
      missing.push(definition.key);
      removed.push(...removeStaleAssets(baseName));
      continue;
    }

    const extension = path.extname(sourceAssetPath).toLowerCase();
    const destinationAssetPath = path.join(DESKTOP_MAPS_DIR, `${baseName}${extension}`);
    removed.push(...removeStaleAssets(baseName, destinationAssetPath));
    fs.copyFileSync(sourceAssetPath, destinationAssetPath);

    copied.push({
      key: definition.key,
      source: sourceAssetPath,
      destination: destinationAssetPath,
    });
  }

  for (const entry of copied) {
    log(
      `[sync-desktop-maps] copied ${entry.key} -> ${toPosixPath(
        path.relative(REPO_ROOT, entry.destination),
      )} from ${toPosixPath(path.relative(REPO_ROOT, entry.source))}`,
    );
  }

  for (const entry of removed) {
    log(
      `[sync-desktop-maps] removed stale ${toPosixPath(path.relative(REPO_ROOT, entry))}`,
    );
  }

  if (missing.length > 0) {
    log(`[sync-desktop-maps] missing: ${missing.join(", ")}`);
  }

  log(
    `[sync-desktop-maps] synced ${copied.length}/${MAP_DEFINITIONS.length} maps into ${toPosixPath(
      path.relative(REPO_ROOT, DESKTOP_MAPS_DIR),
    )}`,
  );

  return {
    copied,
    destinationDir: DESKTOP_MAPS_DIR,
    missing,
    removed,
  };
}

if (require.main === module) {
  try {
    syncDesktopMaps();
  } catch (error) {
    const message = error instanceof Error ? error.stack || error.message : String(error);
    console.error(`[sync-desktop-maps] failed: ${message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  DESKTOP_MAPS_DIR,
  WEB_MAP_SOURCE_DIRS,
  syncDesktopMaps,
};
