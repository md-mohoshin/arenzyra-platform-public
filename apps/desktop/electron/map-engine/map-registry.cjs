"use strict";

const {
  REQUIRED_PUBG_MAP_KEYS,
  SUPPORTED_MAP_ASSET_EXTENSIONS,
  createMapAssetResolver,
  resolveDefaultMapAssetsRoot,
} = require("./map-asset-resolver.cjs");

const DEFAULT_COORDINATE_SCALE_HINT = 102;

const MAP_DEFINITIONS = [
  {
    key: "erangel",
    label: "Erangel",
    worldSize: 816000,
    imagePath: "erangel.png",
    aliases: ["ERANGEL", "ERANGEL8X8", "ERANGEL_MAIN", "BALTIC_MAIN"],
  },
  {
    key: "miramar",
    label: "Miramar",
    worldSize: 816000,
    imagePath: "miramar.png",
    aliases: ["MIRAMAR", "MIRAMAR8X8", "DESERT_MAIN"],
  },
  {
    key: "sanhok",
    label: "Sanhok",
    worldSize: 408000,
    imagePath: "sanhok.png",
    aliases: ["SANHOK", "SANHOK4X4", "SAVAGE_MAIN"],
  },
  {
    key: "vikendi",
    label: "Vikendi",
    worldSize: 612000,
    imagePath: "vikendi.png",
    aliases: ["VIKENDI", "VIKENDI6X6", "DIHOROTOK_MAIN"],
  },
  {
    key: "livik",
    label: "Livik",
    worldSize: 408000,
    imagePath: "livik.png",
    aliases: ["LIVIK", "LIVIK4X4"],
    notes:
      "TODO: confirm the exact raw ShadowTracker world size if Livik renders with a constant offset.",
  },
  {
    key: "livik_aftermath",
    label: "Livik Aftermath",
    worldSize: 408000,
    imagePath: "livik-aftermath.png",
    aliases: ["LIVIKAFTERMATH", "LIVIK_AFTERMATH", "AFTERMATH"],
    notes:
      "TODO: confirm whether ShadowTracker reports this as a distinct map key or as Livik.",
  },
  {
    key: "karakin",
    label: "Karakin",
    worldSize: 204000,
    imagePath: "karakin.png",
    aliases: ["KARAKIN", "KARAKIN2X2", "SUMMERLAND_MAIN"],
  },
  {
    key: "nusa",
    label: "Nusa",
    worldSize: 102000,
    imagePath: "nusa.png",
    aliases: ["NUSA", "NUSA1X1"],
    notes:
      "TODO: verify the exact raw world size from live ShadowTracker packets before final polish.",
  },
  {
    key: "rondo",
    label: "Rondo",
    worldSize: 816000,
    imagePath: "rondo.png",
    aliases: ["RONDO", "RONDO8X8", "RONDO_MAIN"],
    notes:
      "TODO: confirm the raw world size and alias set once live Rondo telemetry is available.",
  },
  {
    key: "taego",
    label: "Taego",
    worldSize: 816000,
    imagePath: "taego.png",
    aliases: ["TAEGO", "TAEGO8X8", "TIGER_MAIN"],
    notes:
      "TODO: confirm asset naming and alias coverage if Taego is added to production rotation.",
  },
  {
    key: "deston",
    label: "Deston",
    worldSize: 816000,
    imagePath: "deston.png",
    aliases: ["DESTON", "DESTON8X8", "KIKI_MAIN"],
    notes:
      "TODO: confirm whether ShadowTracker reports Deston as Kiki in the current observer build.",
  },
  {
    key: "paramo",
    label: "Paramo",
    worldSize: 306000,
    imagePath: "paramo.png",
    aliases: ["PARAMO", "PARAMO3X3", "CHIMERA_MAIN"],
    notes:
      "TODO: verify exact telemetry scale before enabling Paramo in production overlays.",
  },
  {
    key: "haven",
    label: "Haven",
    worldSize: 102000,
    imagePath: "haven.png",
    aliases: ["HAVEN", "HAVEN1X1", "HEAVEN_MAIN"],
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
    const key = String(entry.key || "").trim().toLowerCase();
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
        assetStatus?.imageUrl ?? assetResolver.getFallbackAssetUrl(definition.key);
      definition.fallbackImageUrl =
        assetStatus?.fallbackImageUrl ??
        assetResolver.getFallbackAssetUrl(definition.key);
      definition.imageAbsolutePath =
        assetStatus?.assetAbsolutePath ??
        assetResolver.getFallbackAssetPath();
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

    for (const definition of definitions) {
      if (
        normalized.includes(definition.lookup) ||
        definition.aliases.some((alias) => normalized.includes(alias))
      ) {
        return definition;
      }
    }

    return null;
  }

  refreshAvailability();

  return {
    getAssetResolver: () => assetResolver,
    getAssetsRoot: () => assetResolver.getAssetsRoot(),
    getDefaultDefinition,
    getDefaultKey: () => (getDefaultDefinition() ? getDefaultDefinition().key : null),
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
  createMapAssetResolver,
  createMapRegistry,
  normalizeLookup,
  resolveDefaultMapAssetsRoot,
};
