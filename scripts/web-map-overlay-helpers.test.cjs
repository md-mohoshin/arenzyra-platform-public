"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

const repoRoot = path.resolve(__dirname, "..");
const helperPath = path.join(
  repoRoot,
  "apps",
  "arenzyra-web",
  "src",
  "components",
  "widgets",
  "live-widget-map-overlay-helpers.ts",
);
const gameCatalogPath = path.join(
  repoRoot,
  "apps",
  "arenzyra-web",
  "src",
  "lib",
  "game-catalog.ts",
);

function loadTypeScriptModule(filename) {
  const source = fs.readFileSync(filename, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: filename,
    reportDiagnostics: true,
  });
  const errors = (compiled.diagnostics || []).filter(
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
  );
  assert.equal(
    errors.length,
    0,
    errors.map((error) => ts.flattenDiagnosticMessageText(error.messageText, "\n")).join("\n"),
  );

  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  loaded._compile(compiled.outputText, filename);
  return loaded.exports;
}

const helpers = loadTypeScriptModule(helperPath);
const gameCatalog = loadTypeScriptModule(gameCatalogPath);

const maps = [
  ["ERANGEL", 816_000, 8_000],
  ["MIRAMAR", 816_000, 8_000],
  ["SANHOK", 408_000, 4_000],
  ["VIKENDI", 612_000, 6_000],
  ["LIVIK", 408_000, 4_000],
  ["LIVIK_AFTERMATH", 408_000, 4_000],
  ["KARAKIN", 204_000, 2_000],
  ["NUSA", 102_000, 1_000],
  ["RONDO", 816_000, 8_000],
  ["TAEGO", 816_000, 8_000],
  ["DESTON", 816_000, 8_000],
  ["PARAMO", 306_000, 3_000],
  ["HAVEN", 102_000, 1_000],
];

test("PUBG authoring and overlay catalogs expose the same complete map set", () => {
  const pubgCatalog = gameCatalog.GAME_CATALOG.find(
    (game) => game.key === "PUBG_MOBILE",
  );
  assert.ok(pubgCatalog, "PUBG Mobile catalog must exist");
  assert.deepEqual(
    pubgCatalog.maps.map((map) => map.key),
    maps.map(([mapName]) => mapName),
  );
});

test("all registered web maps have bundled assets and exact canonical transforms", () => {
  assert.equal(Object.keys(helpers.LOCAL_MAP_OVERLAY_ASSETS).length, maps.length);

  for (const [mapName, canonicalWorldSize, renderWorldSize] of maps) {
    const asset = helpers.resolveLocalMapOverlayAsset(mapName);
    assert.ok(asset, `${mapName} must resolve`);
    assert.equal(asset.worldSize, renderWorldSize, `${mapName} render size`);
    assert.equal(
      helpers.resolveCanonicalMapOverlayWorldSize(mapName),
      canonicalWorldSize,
      `${mapName} canonical size`,
    );
    const assetPath = path.join(
      repoRoot,
      "apps",
      "arenzyra-web",
      "public",
      asset.imageUrl.replace(/^\/+/, ""),
    );
    assert.ok(fs.statSync(assetPath).size > 0, `${mapName} asset must be non-empty`);

    const fullTransform = helpers.resolveMapOverlayCoordinateTransform(
      mapName,
      canonicalWorldSize,
      true,
    );
    assert.deepEqual(fullTransform, {
      sourceWorldSize: canonicalWorldSize,
      renderWorldSize,
      scale: renderWorldSize / canonicalWorldSize,
    });
    assert.equal(
      helpers.scaleMapOverlayCoordinate(canonicalWorldSize, fullTransform),
      renderWorldSize,
    );

    const compactTransform = helpers.resolveMapOverlayCoordinateTransform(
      mapName,
      renderWorldSize,
      false,
    );
    assert.deepEqual(compactTransform, {
      sourceWorldSize: renderWorldSize,
      renderWorldSize,
      scale: 1,
    });
  }
});

test("PUBG internal aliases resolve consistently and wrapped tokens remain safe", () => {
  const aliases = {
    BALTIC_MAIN: "ERANGEL",
    DESERT_MAIN: "MIRAMAR",
    SAVAGE_MAIN: "SANHOK",
    DIHOROTOK_MAIN: "VIKENDI",
    LIVIK4X4: "LIVIK",
    AFTERMATH: "LIVIK AFTERMATH",
    SUMMERLAND_MAIN: "KARAKIN",
    NUSA1X1: "NUSA",
    MATCH_NEON_MAIN_VARIANT: "RONDO",
    MATCH_LIVIK_AFTERMATH_VARIANT: "LIVIK AFTERMATH",
    TIGER_MAIN: "TAEGO",
    KIKI_MAIN: "DESTON",
    CHIMERA_MAIN: "PARAMO",
    HEAVEN_MAIN: "HAVEN",
  };

  for (const [alias, expected] of Object.entries(aliases)) {
    assert.equal(helpers.resolveLocalMapOverlayAsset(alias)?.mapName, expected, alias);
  }
  assert.equal(helpers.resolveLocalMapOverlayAsset("SUPERERANGELCLONE"), null);
  assert.equal(helpers.resolveLocalMapOverlayAsset("NEONATAL"), null);
});

test("recorded Rondo flight-path coordinates use the exact 102:1 map scale", () => {
  const transform = helpers.resolveMapOverlayCoordinateTransform(
    "NEON_MAIN",
    816_000,
    true,
  );
  assert.equal(transform.scale, 1 / 102);
  assert.equal(
    helpers.scaleMapOverlayCoordinate(-112_046.1875, transform),
    -112_046.1875 / 102,
  );
  assert.equal(
    helpers.scaleMapOverlayCoordinate(965_938.4375, transform),
    965_938.4375 / 102,
  );

  const clipped = helpers.clipMapOverlaySegmentToWorldBounds(
    {
      x: helpers.scaleMapOverlayCoordinate(-112_046.1875, transform),
      y: helpers.scaleMapOverlayCoordinate(168_940.71875, transform),
    },
    {
      x: helpers.scaleMapOverlayCoordinate(965_938.4375, transform),
      y: helpers.scaleMapOverlayCoordinate(342_524.8125, transform),
    },
    transform.renderWorldSize,
  );
  assert.ok(clipped);
  assert.equal(clipped.start.x, 0);
  assert.equal(clipped.end.x, 8_000);
  assert.ok(clipped.start.y > 0 && clipped.start.y < 8_000);
  assert.ok(clipped.end.y > 0 && clipped.end.y < 8_000);
});

test("recorded PCOB points retain their top-left WORLD orientation", () => {
  const erangelSpawn = helpers.projectMapOverlayPointToPercent(
    796_819,
    20_496,
    816_000,
    "WORLD",
  );
  assert.ok(erangelSpawn.left > 95, "spawn island remains on the right");
  assert.ok(erangelSpawn.top < 5, "spawn island remains at the top");

  const wronglyFlipped = helpers.projectMapOverlayPointToPercent(
    796_819,
    20_496,
    816_000,
    "WORLD_BOTTOM_LEFT",
  );
  assert.ok(wronglyFlipped.top > 95, "bottom-left producers still flip explicitly");

  const erangelTransform = helpers.resolveMapOverlayCoordinateTransform(
    "BALTIC_MAIN",
    816_000,
    true,
  );
  const erangelPath = helpers.clipMapOverlaySegmentToWorldBounds(
    {
      x: helpers.scaleMapOverlayCoordinate(543_300.625, erangelTransform),
      y: helpers.scaleMapOverlayCoordinate(951_586.5625, erangelTransform),
    },
    {
      x: helpers.scaleMapOverlayCoordinate(358_180.875, erangelTransform),
      y: helpers.scaleMapOverlayCoordinate(-161_006.8125, erangelTransform),
    },
    erangelTransform.renderWorldSize,
  );
  assert.ok(erangelPath);
  const erangelStart = helpers.projectMapOverlayPointToPercent(
    erangelPath.start.x,
    erangelPath.start.y,
    erangelTransform.renderWorldSize,
    "WORLD",
  );
  const erangelEnd = helpers.projectMapOverlayPointToPercent(
    erangelPath.end.x,
    erangelPath.end.y,
    erangelTransform.renderWorldSize,
    "WORLD",
  );
  assert.equal(erangelStart.top, 100);
  assert.equal(erangelEnd.top, 0);
});

test("segment clipping rejects a plane route that never intersects the map", () => {
  assert.equal(
    helpers.clipMapOverlaySegmentToWorldBounds(
      { x: -500, y: -500 },
      { x: -100, y: -100 },
      8_000,
    ),
    null,
  );
});
