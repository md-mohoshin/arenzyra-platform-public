"use strict";

const fs = require("node:fs");
const path = require("node:path");

const MAP_ASSET_ROUTE_PREFIX = "/assets/maps";
const MAP_FALLBACK_ASSET_FILENAME = "map-not-available.svg";
const SUPPORTED_MAP_ASSET_EXTENSIONS = Object.freeze([
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
]);
// Every registered map remains required for production readiness even though
// the release source intentionally ships no commercial map raster. The
// project-owned SVG fallback keeps previews stable, while production mode
// blocks independently when its specifically selected map asset is absent.
const REQUIRED_PUBG_MAP_KEYS = Object.freeze([
  "erangel",
  "miramar",
  "sanhok",
  "vikendi",
  "livik",
  "livik_aftermath",
  "karakin",
  "nusa",
  "rondo",
  "taego",
  "deston",
  "paramo",
  "haven",
]);

function resolveDefaultMapAssetsRoot() {
  const override = String(process.env.ARENZYRA_WIDGET_MAPS_DIR || "").trim();
  if (override) {
    return path.resolve(override);
  }

  return path.join(__dirname, "..", "assets", "maps");
}

function normalizeMapKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function toPublicAssetUrl(relativePath, query = null) {
  const normalizedRelativePath = String(relativePath || "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+/, "");
  if (!normalizedRelativePath) {
    return `${MAP_ASSET_ROUTE_PREFIX}/${MAP_FALLBACK_ASSET_FILENAME}`;
  }

  const encodedPath = normalizedRelativePath
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  const queryString =
    query && typeof query === "object"
      ? new URLSearchParams(
          Object.entries(query).filter(([, value]) => String(value || "").trim()),
        ).toString()
      : "";

  return `${MAP_ASSET_ROUTE_PREFIX}/${encodedPath}${queryString ? `?${queryString}` : ""}`;
}

function escapeXml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function isExistingFile(targetPath) {
  try {
    return fs.statSync(targetPath).isFile();
  } catch {
    return false;
  }
}

function sanitizeRequestPath(requestPath) {
  const normalized = String(requestPath || "")
    .split("?")[0]
    .trim()
    .replace(/\\/g, "/");
  if (!normalized) {
    return null;
  }

  const withoutPrefix = normalized
    .replace(/^\/assets\/maps\/?/i, "")
    .replace(/^\/+/, "");
  if (!withoutPrefix) {
    return null;
  }

  const safeRelativePath = path.posix.normalize(withoutPrefix);
  if (
    !safeRelativePath ||
    safeRelativePath === "." ||
    safeRelativePath.startsWith("../") ||
    safeRelativePath.includes("/../")
  ) {
    return null;
  }

  return safeRelativePath;
}

function buildFallbackSvgMarkup(mapKey = null) {
  const normalizedMapKey = normalizeMapKey(mapKey);
  const mapLabel = normalizedMapKey ? normalizedMapKey.toUpperCase() : "UNKNOWN MAP";

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1600" viewBox="0 0 1600 1600" role="img" aria-labelledby="title desc">
  <title id="title">Map Not Available</title>
  <desc id="desc">Placeholder image shown because the desktop launcher does not have a local asset for ${escapeXml(
    mapLabel,
  )}.</desc>
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#071018" />
      <stop offset="100%" stop-color="#163142" />
    </linearGradient>
  </defs>
  <rect width="1600" height="1600" fill="url(#bg)" />
  <rect x="120" y="120" width="1360" height="1360" rx="48" fill="none" stroke="#5fb7dc" stroke-width="8" stroke-dasharray="20 18" opacity="0.7" />
  <rect x="232" y="1010" width="1136" height="198" rx="28" fill="#08141c" opacity="0.92" />
  <text x="800" y="642" text-anchor="middle" fill="#f4fbff" font-family="Bahnschrift, Segoe UI, Arial, sans-serif" font-size="118" font-weight="700">MAP NOT AVAILABLE</text>
  <text x="800" y="762" text-anchor="middle" fill="#9fd8ee" font-family="Bahnschrift, Segoe UI, Arial, sans-serif" font-size="48" letter-spacing="6">Arenzyra OBSERVER LAUNCHER</text>
  <text x="800" y="1110" text-anchor="middle" fill="#f4fbff" font-family="Bahnschrift, Segoe UI, Arial, sans-serif" font-size="58" font-weight="700">${escapeXml(
    mapLabel,
  )}</text>
  <text x="800" y="1186" text-anchor="middle" fill="#97aeb9" font-family="Bahnschrift, Segoe UI, Arial, sans-serif" font-size="34">This desktop package is missing the local map image. Widgets continue with a safe fallback.</text>
</svg>`;
}

function cloneStatusRecord(record) {
  if (!record) {
    return null;
  }

  return {
    key: record.key,
    label: record.label,
    required: record.required === true,
    preferredImagePath: record.preferredImagePath,
    resolvedImagePath: record.resolvedImagePath ?? null,
    imageUrl: record.imageUrl,
    fallbackImageUrl: record.fallbackImageUrl,
    assetAbsolutePath: record.assetAbsolutePath ?? null,
    fallbackAssetPath: record.fallbackAssetPath ?? null,
    assetAvailable: record.assetAvailable === true,
  };
}

function cloneStatusSummary(summary) {
  const maps = {};
  for (const [key, record] of Object.entries(summary?.maps || {})) {
    maps[key] = cloneStatusRecord(record);
  }

  return {
    checkedAt:
      typeof summary?.checkedAt === "number" ? summary.checkedAt : null,
    assetsRoot: summary?.assetsRoot ? String(summary.assetsRoot) : null,
    routePrefix: MAP_ASSET_ROUTE_PREFIX,
    fallbackAssetUrl: summary?.fallbackAssetUrl
      ? String(summary.fallbackAssetUrl)
      : `${MAP_ASSET_ROUTE_PREFIX}/${MAP_FALLBACK_ASSET_FILENAME}`,
    fallbackAssetPath: summary?.fallbackAssetPath
      ? String(summary.fallbackAssetPath)
      : null,
    total: Number(summary?.total ?? 0) || 0,
    available: Number(summary?.available ?? 0) || 0,
    missing: Number(summary?.missing ?? 0) || 0,
    availableKeys: Array.isArray(summary?.availableKeys)
      ? [...summary.availableKeys]
      : [],
    missingKeys: Array.isArray(summary?.missingKeys) ? [...summary.missingKeys] : [],
    requiredTotal: Number(summary?.requiredTotal ?? 0) || 0,
    requiredAvailable: Number(summary?.requiredAvailable ?? 0) || 0,
    requiredMissing: Number(summary?.requiredMissing ?? 0) || 0,
    requiredAvailableKeys: Array.isArray(summary?.requiredAvailableKeys)
      ? [...summary.requiredAvailableKeys]
      : [],
    requiredMissingKeys: Array.isArray(summary?.requiredMissingKeys)
      ? [...summary.requiredMissingKeys]
      : [],
    maps,
  };
}

function createMapAssetResolver({
  assetsRoot = resolveDefaultMapAssetsRoot(),
  definitions = [],
  requiredMapKeys = REQUIRED_PUBG_MAP_KEYS,
  log = () => {},
} = {}) {
  const normalizedAssetsRoot = path.resolve(assetsRoot);
  const normalizedRequiredMapKeys = requiredMapKeys
    .map((mapKey) => normalizeMapKey(mapKey))
    .filter(Boolean);
  const requiredMapKeySet = new Set(normalizedRequiredMapKeys);
  const fallbackAssetPath = path.join(
    normalizedAssetsRoot,
    MAP_FALLBACK_ASSET_FILENAME,
  );
  let trackedDefinitions = [];
  let statusSummary = cloneStatusSummary({
    checkedAt: Date.now(),
    assetsRoot: normalizedAssetsRoot,
    fallbackAssetPath: isExistingFile(fallbackAssetPath) ? fallbackAssetPath : null,
    fallbackAssetUrl: toPublicAssetUrl(MAP_FALLBACK_ASSET_FILENAME),
    total: 0,
    available: 0,
    missing: 0,
    availableKeys: [],
    missingKeys: [],
    requiredTotal: normalizedRequiredMapKeys.length,
    requiredAvailable: 0,
    requiredMissing: normalizedRequiredMapKeys.length,
    requiredAvailableKeys: [],
    requiredMissingKeys: [...normalizedRequiredMapKeys],
    maps: {},
  });

  function registerDefinitions(nextDefinitions) {
    trackedDefinitions = Array.isArray(nextDefinitions)
      ? nextDefinitions
          .map((definition) => {
            const key = normalizeMapKey(definition?.key);
            if (!key) {
              return null;
            }

            return {
              key,
              label: String(definition?.label || key).trim() || key,
              preferredImagePath:
                String(
                  definition?.preferredImagePath || definition?.imagePath || "",
                ).trim() || `${key}.png`,
            };
          })
          .filter(Boolean)
      : [];
  }

  function findAssetFile(preferredImagePath) {
    const normalizedPreferredImagePath = String(preferredImagePath || "").trim();
    if (!normalizedPreferredImagePath) {
      return null;
    }

    const preferredExtension = path.extname(normalizedPreferredImagePath).toLowerCase();
    const baseName = path.parse(normalizedPreferredImagePath).name;
    const candidates = [normalizedPreferredImagePath];

    for (const extension of SUPPORTED_MAP_ASSET_EXTENSIONS) {
      if (extension === preferredExtension) {
        continue;
      }

      const candidate = `${baseName}${extension}`;
      if (!candidates.includes(candidate)) {
        candidates.push(candidate);
      }
    }

    for (const relativePath of candidates) {
      const absolutePath = path.join(normalizedAssetsRoot, relativePath);
      if (isExistingFile(absolutePath)) {
        return {
          absolutePath,
          relativePath,
        };
      }
    }

    return null;
  }

  function buildFallbackResolution(mapKey = null) {
    const normalizedMapKey = normalizeMapKey(mapKey);
    if (isExistingFile(fallbackAssetPath)) {
      return {
        mode: "file",
        absolutePath: fallbackAssetPath,
        relativePath: MAP_FALLBACK_ASSET_FILENAME,
        assetAvailable: false,
        fallback: true,
        mapKey: normalizedMapKey || null,
        mimeType: "image/svg+xml",
      };
    }

    return {
      mode: "inline",
      body: buildFallbackSvgMarkup(normalizedMapKey),
      assetAvailable: false,
      fallback: true,
      mapKey: normalizedMapKey || null,
      mimeType: "image/svg+xml",
    };
  }

  function refreshStatus({ emitLog = false } = {}) {
    const maps = {};
    const availableKeys = [];
    const missingKeys = [];

    for (const definition of trackedDefinitions) {
      const resolvedAsset = findAssetFile(definition.preferredImagePath);
      const assetAvailable = Boolean(resolvedAsset);
      const record = {
        key: definition.key,
        label: definition.label,
        required: requiredMapKeySet.has(definition.key),
        preferredImagePath: definition.preferredImagePath,
        resolvedImagePath: resolvedAsset?.relativePath ?? null,
        imageUrl: assetAvailable
          ? toPublicAssetUrl(resolvedAsset.relativePath)
          : toPublicAssetUrl(MAP_FALLBACK_ASSET_FILENAME, { map: definition.key }),
        fallbackImageUrl: toPublicAssetUrl(MAP_FALLBACK_ASSET_FILENAME, {
          map: definition.key,
        }),
        assetAbsolutePath: resolvedAsset?.absolutePath ?? null,
        fallbackAssetPath: isExistingFile(fallbackAssetPath) ? fallbackAssetPath : null,
        assetAvailable,
      };

      maps[definition.key] = record;
      if (assetAvailable) {
        availableKeys.push(definition.key);
      } else {
        missingKeys.push(definition.key);
      }
    }

    const requiredAvailableKeys = normalizedRequiredMapKeys.filter(
      (mapKey) => maps[mapKey]?.assetAvailable === true,
    );
    const requiredMissingKeys = normalizedRequiredMapKeys.filter(
      (mapKey) => maps[mapKey]?.assetAvailable !== true,
    );

    statusSummary = cloneStatusSummary({
      checkedAt: Date.now(),
      assetsRoot: normalizedAssetsRoot,
      fallbackAssetPath: isExistingFile(fallbackAssetPath) ? fallbackAssetPath : null,
      fallbackAssetUrl: toPublicAssetUrl(MAP_FALLBACK_ASSET_FILENAME),
      total: trackedDefinitions.length,
      available: availableKeys.length,
      missing: missingKeys.length,
      availableKeys,
      missingKeys,
      requiredTotal: normalizedRequiredMapKeys.length,
      requiredAvailable: requiredAvailableKeys.length,
      requiredMissing: requiredMissingKeys.length,
      requiredAvailableKeys,
      requiredMissingKeys,
      maps,
    });

    if (emitLog) {
      log(`[Assets] Desktop map root: ${normalizedAssetsRoot}`);
      log(
        `[Assets] Maps available: ${statusSummary.requiredAvailable}/${statusSummary.requiredTotal}`,
      );
      log(
        `[Assets] Missing maps: ${
          statusSummary.requiredMissingKeys.length > 0
            ? statusSummary.requiredMissingKeys.join(", ")
            : "none"
        }`,
      );
    }

    return cloneStatusSummary(statusSummary);
  }

  function getMapAssetStatus(mapKey) {
    const normalizedMapKey = normalizeMapKey(mapKey);
    return cloneStatusRecord(statusSummary.maps[normalizedMapKey] || null);
  }

  function getMapAssetPath(mapKey, options = {}) {
    const assetStatus = getMapAssetStatus(mapKey);
    if (assetStatus?.assetAvailable && assetStatus.assetAbsolutePath) {
      return assetStatus.assetAbsolutePath;
    }

    if (options?.allowFallback === true && isExistingFile(fallbackAssetPath)) {
      return fallbackAssetPath;
    }

    return null;
  }

  function getMapAssetUrl(mapKey, options = {}) {
    const assetStatus = getMapAssetStatus(mapKey);
    if (assetStatus?.assetAvailable) {
      return assetStatus.imageUrl;
    }

    if (options?.allowFallback === true) {
      return toPublicAssetUrl(MAP_FALLBACK_ASSET_FILENAME, {
        map: normalizeMapKey(mapKey) || undefined,
      });
    }

    return null;
  }

  function resolveAssetRequest(requestPath) {
    const safeRelativePath = sanitizeRequestPath(requestPath);
    if (!safeRelativePath) {
      return null;
    }

    const directAbsolutePath = path.join(normalizedAssetsRoot, safeRelativePath);
    if (isExistingFile(directAbsolutePath)) {
      return {
        mode: "file",
        absolutePath: directAbsolutePath,
        relativePath: safeRelativePath,
        assetAvailable: true,
        fallback: false,
        mapKey: normalizeMapKey(path.parse(safeRelativePath).name) || null,
        mimeType: null,
      };
    }

    const baseName = normalizeMapKey(path.parse(safeRelativePath).name);
    if (
      baseName === normalizeMapKey(path.parse(MAP_FALLBACK_ASSET_FILENAME).name)
    ) {
      return buildFallbackResolution(null);
    }

    const assetStatus = statusSummary.maps[baseName];
    if (assetStatus?.assetAvailable && assetStatus.assetAbsolutePath) {
      return {
        mode: "file",
        absolutePath: assetStatus.assetAbsolutePath,
        relativePath: assetStatus.resolvedImagePath,
        assetAvailable: true,
        fallback: false,
        mapKey: assetStatus.key,
        mimeType: null,
      };
    }

    if (assetStatus) {
      return buildFallbackResolution(assetStatus.key);
    }

    return null;
  }

  registerDefinitions(definitions);
  refreshStatus();

  return {
    getAssetsRoot: () => normalizedAssetsRoot,
    getFallbackAssetPath: () =>
      isExistingFile(fallbackAssetPath) ? fallbackAssetPath : null,
    getFallbackAssetUrl: (mapKey = null) =>
      toPublicAssetUrl(MAP_FALLBACK_ASSET_FILENAME, {
        map: normalizeMapKey(mapKey) || undefined,
      }),
    getMapAssetPath,
    getMapAssetStatus,
    getMapAssetUrl,
    getStatus: () => cloneStatusSummary(statusSummary),
    hasMapAsset: (mapKey) => getMapAssetStatus(mapKey)?.assetAvailable === true,
    resolveAssetRequest,
    setDefinitions(nextDefinitions) {
      registerDefinitions(nextDefinitions);
      return refreshStatus();
    },
    validateAssets() {
      return refreshStatus({ emitLog: true });
    },
  };
}

module.exports = {
  MAP_ASSET_ROUTE_PREFIX,
  MAP_FALLBACK_ASSET_FILENAME,
  REQUIRED_PUBG_MAP_KEYS,
  SUPPORTED_MAP_ASSET_EXTENSIONS,
  buildFallbackSvgMarkup,
  createMapAssetResolver,
  normalizeMapKey,
  resolveDefaultMapAssetsRoot,
  toPublicAssetUrl,
};
