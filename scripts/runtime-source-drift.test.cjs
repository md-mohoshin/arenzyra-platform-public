"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");

const proxies = [
  {
    label: "Electron main process",
    rootFile: path.join(repoRoot, "main.cjs"),
    canonicalFile: path.join(repoRoot, "apps", "desktop", "electron", "main.cjs"),
    target: "./apps/desktop/electron/main.cjs",
    safeToRequire: false,
  },
  {
    label: "Telemetry bridge",
    rootFile: path.join(repoRoot, "telemetryBridge.cjs"),
    canonicalFile: path.join(repoRoot, "apps", "desktop", "electron", "telemetryBridge.cjs"),
    target: "./apps/desktop/electron/telemetryBridge.cjs",
    safeToRequire: true,
  },
  {
    label: "Map coordinate utilities",
    rootFile: path.join(repoRoot, "coordinate-utils.cjs"),
    canonicalFile: path.join(
      repoRoot,
      "apps",
      "desktop",
      "electron",
      "map-engine",
      "coordinate-utils.cjs",
    ),
    target: "./apps/desktop/electron/map-engine/coordinate-utils.cjs",
    safeToRequire: true,
  },
];

function normalizeContent(value) {
  return value.replace(/\r\n/g, "\n").trim();
}

test("root runtime files contain only pure canonical proxies", () => {
  for (const proxy of proxies) {
    const expected = `"use strict";\n\nmodule.exports = require("${proxy.target}");`;
    assert.equal(
      normalizeContent(fs.readFileSync(proxy.rootFile, "utf8")),
      expected,
      `${proxy.label} root copy must not contain runtime logic`,
    );
  }
});

test("safe root runtime proxies return the canonical module implementation", () => {
  for (const proxy of proxies.filter((entry) => entry.safeToRequire)) {
    assert.equal(
      require(proxy.rootFile),
      require(proxy.canonicalFile),
      `${proxy.label} root proxy must resolve to canonical implementation`,
    );
  }
});
