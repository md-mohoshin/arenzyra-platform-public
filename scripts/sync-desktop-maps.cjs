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
const DEVELOPMENT_ONLY_FLAG = "--development-only";

// The release source intentionally contains no bundled commercial map raster.
// This development-only importer may create local, untracked raster files for
// visual testing, but the release-input and provenance gates reject them.
const PRESERVED_BUNDLED_MAP_KEYS = new Set();

function toPosixPath(value) {
  return value.split(path.sep).join("/");
}

function getMapBaseName(definition) {
  return path.parse(
    String(definition?.imagePath || definition?.key || "").trim(),
  ).name;
}

function getPreferredExtensions(definition) {
  const preferredExtension = path
    .extname(String(definition?.imagePath || "").trim())
    .toLowerCase();
  const extensions = [];

  if (SUPPORTED_MAP_ASSET_EXTENSIONS.includes(preferredExtension)) {
    extensions.push(preferredExtension);
  }

  for (const extension of SUPPORTED_MAP_ASSET_EXTENSIONS) {
    if (!extensions.includes(extension)) {
      extensions.push(extension);
    }
  }

  return extensions;
}

function findAssetInDirectory(directory, baseName, definition) {
  const extensions = getPreferredExtensions(definition);

  if (!fs.existsSync(directory)) {
    return null;
  }

  for (const extension of extensions) {
    const candidatePath = path.join(directory, `${baseName}${extension}`);
    if (fs.existsSync(candidatePath)) {
      return candidatePath;
    }
  }

  return null;
}

function findSourceAsset(
  baseName,
  definition,
  sourceDirectories = WEB_MAP_SOURCE_DIRS,
) {
  const directories = Array.isArray(sourceDirectories) ? sourceDirectories : [];

  for (const directory of directories) {
    const candidatePath = findAssetInDirectory(directory, baseName, definition);
    if (candidatePath) {
      return candidatePath;
    }
  }

  return null;
}

function removeStaleAssets(
  baseName,
  keepAbsolutePath = null,
  destinationDirectory = DESKTOP_MAPS_DIR,
) {
  const removed = [];

  for (const extension of SUPPORTED_MAP_ASSET_EXTENSIONS) {
    const candidatePath = path.join(
      destinationDirectory,
      `${baseName}${extension}`,
    );
    if (!fs.existsSync(candidatePath)) {
      continue;
    }

    if (
      keepAbsolutePath &&
      path.resolve(candidatePath) === path.resolve(keepAbsolutePath)
    ) {
      continue;
    }

    fs.rmSync(candidatePath, { force: true });
    removed.push(candidatePath);
  }

  return removed;
}

function syncDesktopMaps({
  log = console.log,
  definitions = MAP_DEFINITIONS,
  destinationDir = DESKTOP_MAPS_DIR,
  sourceDirectories = WEB_MAP_SOURCE_DIRS,
  preservedBundledMapKeys = PRESERVED_BUNDLED_MAP_KEYS,
} = {}) {
  const resolvedDestinationDir = path.resolve(destinationDir);
  const preservedMapKeys =
    preservedBundledMapKeys instanceof Set
      ? preservedBundledMapKeys
      : new Set(
          Array.isArray(preservedBundledMapKeys) ? preservedBundledMapKeys : [],
        );
  fs.mkdirSync(resolvedDestinationDir, { recursive: true });

  const copied = [];
  const missing = [];
  const removed = [];

  for (const definition of definitions) {
    const baseName = getMapBaseName(definition);
    if (!baseName) {
      continue;
    }

    if (preservedMapKeys.has(definition.key)) {
      const desktopAssetPath = path.join(
        resolvedDestinationDir,
        definition.imagePath,
      );
      if (fs.existsSync(desktopAssetPath)) {
        copied.push({
          key: definition.key,
          source: desktopAssetPath,
          destination: desktopAssetPath,
          preservedBundled: true,
        });
      } else {
        missing.push(definition.key);
      }
      continue;
    }

    const sourceAssetPath = findSourceAsset(
      baseName,
      definition,
      sourceDirectories,
    );
    if (!sourceAssetPath) {
      // The web application is an ignored embedded repository and is not
      // guaranteed to exist in a clean launcher checkout. Never delete a
      // valid bundled desktop map just because that optional sync source is
      // unavailable.
      const bundledAssetPath = findAssetInDirectory(
        resolvedDestinationDir,
        baseName,
        definition,
      );
      if (bundledAssetPath) {
        copied.push({
          key: definition.key,
          source: bundledAssetPath,
          destination: bundledAssetPath,
          bundledFallback: true,
        });
      } else {
        missing.push(definition.key);
      }
      continue;
    }

    const extension = path.extname(sourceAssetPath).toLowerCase();
    const destinationAssetPath = path.join(
      resolvedDestinationDir,
      `${baseName}${extension}`,
    );
    removed.push(
      ...removeStaleAssets(
        baseName,
        destinationAssetPath,
        resolvedDestinationDir,
      ),
    );
    fs.copyFileSync(sourceAssetPath, destinationAssetPath);

    copied.push({
      key: definition.key,
      source: sourceAssetPath,
      destination: destinationAssetPath,
    });
  }

  for (const entry of copied) {
    if (entry.preservedBundled || entry.bundledFallback) {
      log(
        `[sync-desktop-maps] kept bundled ${entry.key} -> ${toPosixPath(
          path.relative(REPO_ROOT, entry.destination),
        )}`,
      );
      continue;
    }

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
    `[sync-desktop-maps] synced ${copied.length}/${definitions.length} maps into ${toPosixPath(
      path.relative(REPO_ROOT, resolvedDestinationDir),
    )}`,
  );

  return {
    copied,
    destinationDir: resolvedDestinationDir,
    missing,
    removed,
  };
}

function assertDevelopmentOnlyInvocation({ argv = process.argv.slice(2) } = {}) {
  if (argv.length !== 1 || argv[0] !== DEVELOPMENT_ONLY_FLAG) {
    throw new Error(
      `Desktop map sync is development-only and requires exactly ${DEVELOPMENT_ONLY_FLAG}. Release and candidate builds must not import map rasters.`,
    );
  }
  return true;
}

if (require.main === module) {
  try {
    assertDevelopmentOnlyInvocation();
    syncDesktopMaps();
  } catch (error) {
    const message =
      error instanceof Error ? error.stack || error.message : String(error);
    console.error(`[sync-desktop-maps] failed: ${message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  DEVELOPMENT_ONLY_FLAG,
  DESKTOP_MAPS_DIR,
  PRESERVED_BUNDLED_MAP_KEYS,
  WEB_MAP_SOURCE_DIRS,
  assertDevelopmentOnlyInvocation,
  syncDesktopMaps,
};
