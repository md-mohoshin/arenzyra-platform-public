"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const sharp = require("sharp");

const {
  MAP_DEFINITIONS,
  REQUIRED_PUBG_MAP_KEYS,
  TELEMETRY_CALIBRATION_STATUS,
  createMapRegistry,
} = require("./map-registry.cjs");
const {
  assertDevelopmentOnlyInvocation,
  syncDesktopMaps,
} = require("../../../../scripts/sync-desktop-maps.cjs");

const EXPECTED_MAPS = Object.freeze({
  erangel: { imagePath: "erangel.png", worldSize: 816000 },
  miramar: { imagePath: "miramar.png", worldSize: 816000 },
  sanhok: { imagePath: "sanhok.jpg", worldSize: 408000 },
  vikendi: { imagePath: "vikendi.jpg", worldSize: 612000 },
  livik: { imagePath: "livik.jpg", worldSize: 408000 },
  livik_aftermath: { imagePath: "livik-aftermath.png", worldSize: 408000 },
  karakin: { imagePath: "karakin.jpg", worldSize: 204000 },
  nusa: { imagePath: "nusa.png", worldSize: 102000 },
  rondo: { imagePath: "rondo.webp", worldSize: 816000 },
  taego: { imagePath: "taego.png", worldSize: 816000 },
  deston: { imagePath: "deston.png", worldSize: 816000 },
  paramo: { imagePath: "paramo.png", worldSize: 306000 },
  haven: { imagePath: "haven.png", worldSize: 102000 },
});

test("map registry exposes the complete supported map metadata", () => {
  assert.equal(MAP_DEFINITIONS.length, 13);
  assert.deepEqual(
    Object.fromEntries(
      MAP_DEFINITIONS.map((definition) => [
        definition.key,
        {
          imagePath: definition.imagePath,
          worldSize: definition.worldSize,
        },
      ]),
    ),
    EXPECTED_MAPS,
  );
  assert.deepEqual(
    [...REQUIRED_PUBG_MAP_KEYS].sort(),
    Object.keys(EXPECTED_MAPS).sort(),
    "every registered map asset should be required package content",
  );
});

test("map registry resolves every exact alias and the most specific embedded alias", () => {
  const registry = createMapRegistry();

  for (const definition of MAP_DEFINITIONS) {
    assert.equal(registry.resolve(definition.key)?.key, definition.key);
    assert.equal(registry.resolve(definition.label)?.key, definition.key);
    for (const alias of definition.aliases) {
      assert.equal(
        registry.resolve(alias)?.key,
        definition.key,
        `${alias} should resolve to ${definition.key}`,
      );
    }
  }

  assert.equal(registry.resolve("Neon_Main")?.key, "rondo");
  assert.equal(registry.resolve("NeonMain")?.key, "rondo");
  assert.equal(
    registry.resolve("match_livik_aftermath_variant")?.key,
    "livik_aftermath",
  );
  assert.equal(
    registry.resolve("match_livikaftermath_variant")?.key,
    "livik_aftermath",
  );
  assert.equal(
    registry.resolve("match_aftermath_variant")?.key,
    "livik_aftermath",
  );
  assert.equal(registry.resolve("match_livik_variant")?.key, "livik");
  assert.equal(registry.resolve("VIKENDI6X6")?.key, "vikendi");
  assert.equal(registry.resolve("match_vikendi8x8_variant"), null);
  assert.equal(registry.resolve("unknownerangelclone"), null);
  assert.equal(registry.resolve("super_miramarish_variant"), null);
  assert.equal(registry.resolve("heavenly_future_map"), null);
  assert.equal(registry.resolve("unknown_new_map"), null);
});

test("registered map keys, labels, and aliases do not collide across maps", () => {
  const ownership = new Map();
  for (const definition of MAP_DEFINITIONS) {
    for (const candidate of [
      definition.key,
      definition.label,
      ...(definition.aliases || []),
    ]) {
      const lookup = String(candidate || "")
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, "_")
        .replace(/_+/g, "_")
        .replace(/^_+|_+$/g, "");
      const owner = ownership.get(lookup);
      assert.ok(
        !owner || owner === definition.key,
        `${lookup} is owned by both ${owner} and ${definition.key}`,
      );
      ownership.set(lookup, definition.key);
    }
  }
});

test("map registry exposes recording-backed versus provisional calibration confidence", () => {
  const registry = createMapRegistry();
  const statuses = Object.fromEntries(
    registry
      .listDefinitions()
      .map((definition) => [
        definition.key,
        definition.telemetryCalibrationStatus,
      ]),
  );

  assert.equal(statuses.erangel, TELEMETRY_CALIBRATION_STATUS.RECORDING_BACKED);
  assert.equal(statuses.rondo, TELEMETRY_CALIBRATION_STATUS.RECORDING_BACKED);
  for (const mapKey of Object.keys(EXPECTED_MAPS)) {
    assert.equal(
      statuses[mapKey],
      mapKey === "erangel" || mapKey === "rondo"
        ? TELEMETRY_CALIBRATION_STATUS.RECORDING_BACKED
        : TELEMETRY_CALIBRATION_STATUS.PROVISIONAL,
      mapKey,
    );
  }
});

test("map registry preserves rectangular POI source dimensions", () => {
  const registry = createMapRegistry();
  const erangel = registry.getDefinition("erangel");
  const livik = registry.getDefinition("livik");

  assert.equal(erangel.imageIncludesPoiLabels, true);
  assert.equal(livik.poiLabels.sourceWidth, 697);
  assert.equal(livik.poiLabels.sourceHeight, 700);
  assert.equal(livik.imageIncludesPoiLabels, true);
  assert.equal(livik.poiLabels.labels.length, 21);

  const clientLivik = registry
    .listDefinitions()
    .find((definition) => definition.key === "livik");
  assert.equal(clientLivik.poiLabels.sourceWidth, 697);
  assert.equal(clientLivik.poiLabels.sourceHeight, 700);
});

test("the release source exposes only the neutral fallback when commercial map rasters are absent", () => {
  const registry = createMapRegistry();
  const summary = registry.getValidationSummary();

  assert.equal(summary.total, 13);
  assert.equal(summary.available, 0);
  assert.equal(summary.requiredTotal, 13);
  assert.equal(summary.requiredAvailable, 0);
  assert.equal(summary.requiredMissing, 13);
  assert.deepEqual([...summary.missingKeys].sort(), Object.keys(EXPECTED_MAPS).sort());
  assert.deepEqual(
    [...summary.requiredMissingKeys].sort(),
    Object.keys(EXPECTED_MAPS).sort(),
  );
  assert.match(summary.fallbackAssetPath, /map-not-available\.svg$/);

  for (const mapKey of Object.keys(EXPECTED_MAPS)) {
    const status = registry.getMapAssetStatus(mapKey);
    assert.equal(
      status.assetAvailable,
      false,
      `${mapKey} must not claim the neutral fallback is a production map asset`,
    );
    assert.equal(status.resolvedImagePath, null);
    assert.equal(status.assetAbsolutePath, null);
    assert.match(
      status.imageUrl,
      /^\/assets\/maps\/map-not-available\.svg\?map=/,
    );
  }
});

test("the project-owned neutral map fallback is a decodable image", async () => {
  const registry = createMapRegistry();
  const fallbackPath = registry.getValidationSummary().fallbackAssetPath;
  const metadata = await sharp(fallbackPath).metadata();
  assert.equal(metadata.format, "svg");
  assert.ok(Number(metadata.width) > 0);
  assert.ok(Number(metadata.height) > 0);
});

test("desktop map sync CLI is explicitly development-only", () => {
  assert.equal(
    assertDevelopmentOnlyInvocation({ argv: ["--development-only"] }),
    true,
  );
  assert.throws(
    () => assertDevelopmentOnlyInvocation({ argv: [] }),
    /development-only.*release and candidate builds must not import/i,
  );
  assert.throws(
    () =>
      assertDevelopmentOnlyInvocation({
        argv: ["--development-only", "--extra"],
      }),
    /requires exactly --development-only/i,
  );
});

test("desktop map sync keeps bundled assets when the optional web source is absent", () => {
  const temporaryRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "arenzyra-map-sync-"),
  );
  const destinationDir = path.join(temporaryRoot, "maps");
  const bundledAssetPath = path.join(destinationDir, "erangel.png");

  try {
    fs.mkdirSync(destinationDir, { recursive: true });
    fs.writeFileSync(bundledAssetPath, "bundled-map");

    const result = syncDesktopMaps({
      log: () => {},
      definitions: [{ key: "erangel", imagePath: "erangel.png" }],
      destinationDir,
      sourceDirectories: [],
      preservedBundledMapKeys: new Set(),
    });

    assert.deepEqual(result.missing, []);
    assert.deepEqual(result.removed, []);
    assert.equal(result.copied.length, 1);
    assert.equal(result.copied[0].bundledFallback, true);
    assert.equal(fs.readFileSync(bundledAssetPath, "utf8"), "bundled-map");
  } finally {
    const resolvedTemporaryRoot = path.resolve(temporaryRoot);
    assert.ok(resolvedTemporaryRoot.startsWith(path.resolve(os.tmpdir())));
    fs.rmSync(resolvedTemporaryRoot, { recursive: true, force: true });
  }
});
