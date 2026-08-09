"use strict";

const {
  REQUIRED_PUBG_MAP_KEYS,
  SUPPORTED_MAP_ASSET_EXTENSIONS,
  createMapAssetResolver,
  resolveDefaultMapAssetsRoot,
} = require("./map-asset-resolver.cjs");
const { MAP_POI_LABELS, MAP_TILE_SOURCES } = require("./map-poi-labels.cjs");

const DEFAULT_COORDINATE_SCALE_HINT = 102;
const TELEMETRY_CALIBRATION_STATUS = Object.freeze({
  PROVISIONAL: "provisional",
  RECORDING_BACKED: "recording-backed",
});

const MAP_DEFINITIONS = [
  {
    key: "erangel",
    label: "Erangel",
    worldSize: 816000,
    telemetryCalibrationStatus: TELEMETRY_CALIBRATION_STATUS.RECORDING_BACKED,
    imagePath: "erangel.png",
    imageIncludesPoiLabels: true,
    tileSource: MAP_TILE_SOURCES.erangel,
    poiLabels: MAP_POI_LABELS.erangel,
    aliases: [
      "ERANGEL",
      "ERANGEL8X8",
      "ERANGEL_MAIN",
      "BALTIC_MAIN",
      "BALTICMAIN",
    ],
  },
  {
    key: "miramar",
    label: "Miramar",
    worldSize: 816000,
    imagePath: "miramar.png",
    tileSource: MAP_TILE_SOURCES.miramar,
    poiLabels: MAP_POI_LABELS.miramar,
    aliases: ["MIRAMAR", "MIRAMAR8X8", "DESERT_MAIN", "DESERTMAIN"],
  },
  {
    key: "sanhok",
    label: "Sanhok",
    worldSize: 408000,
    imagePath: "sanhok.jpg",
    aliases: ["SANHOK", "SANHOK4X4", "SAVAGE_MAIN", "SAVAGEMAIN"],
  },
  {
    key: "vikendi",
    label: "Vikendi",
    // PCOB/ShadowTracker calibration is not yet recording-backed. Preserve the
    // legacy 6x6 coordinate frame until a real observer capture proves otherwise.
    worldSize: 612000,
    imagePath: "vikendi.jpg",
    aliases: ["VIKENDI", "VIKENDI6X6", "DIHOROTOK_MAIN", "DIHOROTOKMAIN"],
  },
  {
    key: "livik",
    label: "Livik",
    worldSize: 408000,
    imagePath: "livik.jpg",
    imageIncludesPoiLabels: true,
    poiLabels: MAP_POI_LABELS.livik,
    aliases: ["LIVIK", "LIVIK4X4"],
    notes:
      "TODO: confirm the exact raw ShadowTracker world size if Livik renders with a constant offset.",
  },
  {
    key: "livik_aftermath",
    label: "Livik Aftermath",
    worldSize: 408000,
    imagePath: "livik-aftermath.png",
    // The PNG's nontransparent artwork bounds are not a verified telemetry
    // calibration. Keep renderBounds unset until live coordinates establish it.
    aliases: ["LIVIKAFTERMATH", "LIVIK_AFTERMATH", "AFTERMATH"],
    notes:
      "TODO: confirm whether ShadowTracker reports this as a distinct map key or as Livik.",
  },
  {
    key: "karakin",
    label: "Karakin",
    worldSize: 204000,
    imagePath: "karakin.jpg",
    aliases: ["KARAKIN", "KARAKIN2X2", "SUMMERLAND_MAIN", "SUMMERLANDMAIN"],
  },
  {
    key: "nusa",
    label: "Nusa",
    worldSize: 102000,
    imagePath: "nusa.png",
    // Alpha bounds describe the irregular island artwork and labels, not a
    // proven rectangular telemetry extent. Do not infer renderBounds from them.
    aliases: ["NUSA", "NUSA1X1"],
    notes:
      "TODO: verify the exact raw world size from live ShadowTracker packets before final polish.",
  },
  {
    key: "rondo",
    label: "Rondo",
    worldSize: 816000,
    telemetryCalibrationStatus: TELEMETRY_CALIBRATION_STATUS.RECORDING_BACKED,
    imagePath: "rondo.webp",
    poiLabels: MAP_POI_LABELS.rondo,
    aliases: [
      "RONDO",
      "RONDO8X8",
      "RONDO_MAIN",
      "RONDOMAIN",
      "NEON_MAIN",
      "NEONMAIN",
    ],
  },
  {
    key: "taego",
    label: "Taego",
    worldSize: 816000,
    imagePath: "taego.png",
    aliases: ["TAEGO", "TAEGO8X8", "TIGER_MAIN", "TIGERMAIN"],
    notes:
      "TODO: confirm asset naming and alias coverage if Taego is added to production rotation.",
  },
  {
    key: "deston",
    label: "Deston",
    worldSize: 816000,
    imagePath: "deston.png",
    aliases: ["DESTON", "DESTON8X8", "KIKI_MAIN", "KIKIMAIN"],
    notes:
      "TODO: confirm whether ShadowTracker reports Deston as Kiki in the current observer build.",
  },
  {
    key: "paramo",
    label: "Paramo",
    worldSize: 306000,
    imagePath: "paramo.png",
    aliases: ["PARAMO", "PARAMO3X3", "CHIMERA_MAIN", "CHIMERAMAIN"],
    notes:
      "TODO: verify exact telemetry scale before enabling Paramo in production overlays.",
  },
  {
    key: "haven",
    label: "Haven",
    worldSize: 102000,
    imagePath: "haven.png",
    aliases: ["HAVEN", "HAVEN1X1", "HAVENMAIN", "HEAVEN_MAIN", "HEAVENMAIN"],
    notes:
      "TODO: confirm Haven aliasing if the observer client reports a different internal map key.",
  },
];

function normalizeLookup(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function isMapLookupMatch(value, candidate) {
  const normalizedValue = normalizeLookup(value);
  const normalizedCandidate = normalizeLookup(candidate);
  if (!normalizedValue || !normalizedCandidate) {
    return false;
  }
  if (normalizedValue === normalizedCandidate) {
    return true;
  }

  // Observer payloads sometimes wrap an internal map name (for example,
  // MATCH_NEON_MAIN_VARIANT). Match only complete normalized tokens so an
  // unrelated future key such as SUPERERANGELCLONE cannot silently select a
  // known map merely because it contains the same letters.
  return `_${normalizedValue}_`.includes(`_${normalizedCandidate}_`);
}

function cloneTileSource(tileSource) {
  if (!tileSource || typeof tileSource !== "object") {
    return null;
  }

  return {
    endpoint: tileSource.endpoint,
    includesPoiLabels: tileSource.includesPoiLabels === true,
    prefix: tileSource.prefix,
    sourceSize: tileSource.sourceSize,
    minZoom: tileSource.minZoom,
    maxZoom: tileSource.maxZoom,
    tileSize: tileSource.tileSize,
  };
}

function clonePoiLabels(poiLabels) {
  if (!poiLabels || typeof poiLabels !== "object") {
    return null;
  }

  return {
    sourceSize: poiLabels.sourceSize,
    sourceWidth: poiLabels.sourceWidth,
    sourceHeight: poiLabels.sourceHeight,
    labels: Array.isArray(poiLabels.labels)
      ? poiLabels.labels.map((label) => ({
          label: label.label,
          x: label.x,
          y: label.y,
          tier: label.tier,
        }))
      : [],
  };
}

function cloneClientDefinition(definition) {
  if (!definition) {
    return null;
  }

  return {
    key: definition.key,
    label: definition.label,
    worldSize: definition.worldSize,
    imagePath: definition.imagePath,
    imageUrl: definition.imageUrl,
    fallbackImageUrl: definition.fallbackImageUrl ?? null,
    imageWidth: definition.imageWidth ?? null,
    imageHeight: definition.imageHeight ?? null,
    imageIncludesPoiLabels: definition.imageIncludesPoiLabels === true,
    renderBounds: definition.renderBounds
      ? {
          x: definition.renderBounds.x,
          y: definition.renderBounds.y,
          width: definition.renderBounds.width,
          height: definition.renderBounds.height,
        }
      : null,
    coordinateScaleHint:
      definition.coordinateScaleHint ?? DEFAULT_COORDINATE_SCALE_HINT,
    telemetryCalibrationStatus:
      definition.telemetryCalibrationStatus ??
      TELEMETRY_CALIBRATION_STATUS.PROVISIONAL,
    tileSource: cloneTileSource(definition.tileSource),
    poiLabels: clonePoiLabels(definition.poiLabels),
    notes: definition.notes ?? null,
    assetAvailable: definition.assetAvailable === true,
    isRequiredMapAsset: definition.isRequiredMapAsset === true,
    aliases: Array.isArray(definition.aliases) ? [...definition.aliases] : [],
  };
}

function buildLookupMap(definitions) {
  const lookup = new Map();

  for (const definition of definitions) {
    lookup.set(definition.lookup, definition);
    lookup.set(normalizeLookup(definition.label), definition);
    for (const alias of definition.aliases) {
      lookup.set(alias, definition);
    }
  }

  return lookup;
}

function createMapRegistry({
  assetsRoot = resolveDefaultMapAssetsRoot(),
  log = () => {},
} = {}) {
  const definitions = MAP_DEFINITIONS.map((entry) => {
    const key = String(entry.key || "")
      .trim()
      .toLowerCase();
    const preferredImagePath = String(entry.imagePath || "").trim();

    return {
      key,
      label: entry.label,
      worldSize: entry.worldSize,
      imagePath: preferredImagePath,
      preferredImagePath,
      imageUrl: null,
      fallbackImageUrl: null,
      imageWidth: entry.imageWidth ?? null,
      imageHeight: entry.imageHeight ?? null,
      imageIncludesPoiLabels: entry.imageIncludesPoiLabels === true,
      renderBounds: entry.renderBounds
        ? {
            x: entry.renderBounds.x,
            y: entry.renderBounds.y,
            width: entry.renderBounds.width,
            height: entry.renderBounds.height,
          }
        : null,
      coordinateScaleHint:
        entry.coordinateScaleHint ?? DEFAULT_COORDINATE_SCALE_HINT,
      telemetryCalibrationStatus:
        entry.telemetryCalibrationStatus ??
        TELEMETRY_CALIBRATION_STATUS.PROVISIONAL,
      tileSource: cloneTileSource(entry.tileSource),
      poiLabels: clonePoiLabels(entry.poiLabels),
      notes: entry.notes ?? null,
      aliases: Array.isArray(entry.aliases)
        ? entry.aliases.map((alias) => normalizeLookup(alias))
        : [],
      lookup: normalizeLookup(key),
      imageAbsolutePath: null,
      assetAvailable: false,
      isRequiredMapAsset: REQUIRED_PUBG_MAP_KEYS.includes(key),
    };
  });
  const byLookup = buildLookupMap(definitions);
  const assetResolver = createMapAssetResolver({
    assetsRoot,
    definitions,
    requiredMapKeys: REQUIRED_PUBG_MAP_KEYS,
    log,
  });

  function syncDefinitionAssets() {
    for (const definition of definitions) {
      const assetStatus = assetResolver.getMapAssetStatus(definition.key);
      definition.assetAvailable = assetStatus?.assetAvailable === true;
      definition.imagePath =
        assetStatus?.resolvedImagePath ?? definition.preferredImagePath;
      definition.imageUrl =
        assetStatus?.imageUrl ??
        assetResolver.getFallbackAssetUrl(definition.key);
      definition.fallbackImageUrl =
        assetStatus?.fallbackImageUrl ??
        assetResolver.getFallbackAssetUrl(definition.key);
      definition.imageAbsolutePath =
        assetStatus?.assetAbsolutePath ?? assetResolver.getFallbackAssetPath();
    }
  }

  function refreshAvailability({ emitLog = false } = {}) {
    if (emitLog) {
      assetResolver.validateAssets();
    }
    syncDefinitionAssets();
    return getValidationSummary();
  }

  function getValidationSummary() {
    return assetResolver.getStatus();
  }

  function getDefaultDefinition() {
    return (
      definitions.find((definition) => definition.assetAvailable) ||
      definitions[0] ||
      null
    );
  }

  function resolve(input) {
    if (!input) {
      return null;
    }

    const normalized = normalizeLookup(input);
    if (!normalized) {
      return null;
    }

    const direct = byLookup.get(normalized);
    if (direct) {
      return direct;
    }

    let mostSpecificMatch = null;
    let mostSpecificLookupLength = -1;

    for (const definition of definitions) {
      for (const lookup of [definition.lookup, ...definition.aliases]) {
        if (
          isMapLookupMatch(normalized, lookup) &&
          lookup.length > mostSpecificLookupLength
        ) {
          mostSpecificMatch = definition;
          mostSpecificLookupLength = lookup.length;
        }
      }
    }

    return mostSpecificMatch;
  }

  refreshAvailability();

  return {
    getAssetResolver: () => assetResolver,
    getAssetsRoot: () => assetResolver.getAssetsRoot(),
    getDefaultDefinition,
    getDefaultKey: () =>
      getDefaultDefinition() ? getDefaultDefinition().key : null,
    getDefinition: (mapKey) => resolve(mapKey),
    getMapAssetStatus: (mapKey) => assetResolver.getMapAssetStatus(mapKey),
    getValidationSummary,
    listDefinitions: () =>
      definitions.map((definition) => cloneClientDefinition(definition)),
    normalizeLookup,
    resolve,
    resolveAssetRequest: (requestPath) =>
      assetResolver.resolveAssetRequest(requestPath),
    toClientDefinition: cloneClientDefinition,
    validateAssets() {
      return refreshAvailability({ emitLog: true });
    },
  };
}

module.exports = {
  MAP_DEFINITIONS,
  REQUIRED_PUBG_MAP_KEYS,
  SUPPORTED_MAP_ASSET_EXTENSIONS,
  TELEMETRY_CALIBRATION_STATUS,
  createMapAssetResolver,
  createMapRegistry,
  isMapLookupMatch,
  normalizeLookup,
  resolveDefaultMapAssetsRoot,
};
