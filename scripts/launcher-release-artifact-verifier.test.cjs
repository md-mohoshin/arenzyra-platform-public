"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const {
  assertSafeManifestReplacement,
  defaultSourceEntries,
  launcherArtifactNames,
  verifyLauncherReleaseArtifacts,
} = require("./launcher-release-artifact-verifier.cjs");

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "arenzyra-launcher-release-"));
  const sourceRoot = path.join(root, "source");
  const archiveRoot = path.join(root, "archive");
  const distDir = path.join(root, "dist");
  const version = "9.8.7";
  const packageJsonPath = path.join(sourceRoot, "package.json");
  writeFile(
    packageJsonPath,
    JSON.stringify({ name: "arenzyra-observer-launcher", version }),
  );

  const sourceEntries = [
    ["resources/connectors/ob.js", "connector-v2"],
    [
      "resources/connectors/direct-observer-transport-payload.cjs",
      "transport-v2",
    ],
    [
      "resources/connectors/observer-telemetry-contract.cjs",
      "contract-v2",
    ],
    ["resources/app/electron/main.cjs", "launcher-v2"],
  ].map(([entryPath, content], index) => {
    const sourcePath = path.join(sourceRoot, `source-${index}.txt`);
    writeFile(sourcePath, content);
    writeFile(path.join(archiveRoot, ...entryPath.split("/")), content);
    return { entryPath, sourcePath };
  });
  writeFile(
    path.join(archiveRoot, "resources", "app", "package.json"),
    JSON.stringify({ name: "arenzyra-observer-launcher", version }),
  );

  fs.mkdirSync(distDir, { recursive: true });
  const sevenZipPath = require("7zip-bin").path7za;
  const fixtureZip = path.join(root, "fixture.zip");
  const archived = spawnSync(sevenZipPath, ["a", "-tzip", fixtureZip, "."], {
    cwd: archiveRoot,
    encoding: "utf8",
    windowsHide: true,
  });
  assert.equal(archived.status, 0, archived.stderr);
  const names = launcherArtifactNames(version);
  fs.copyFileSync(fixtureZip, path.join(distDir, names.installer));
  fs.copyFileSync(fixtureZip, path.join(distDir, names.portableZip));

  return { root, distDir, packageJsonPath, sourceEntries, version };
}

test("verifies exact-version installer and ZIP contents against source", (t) => {
  const fixture = createFixture();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  const result = verifyLauncherReleaseArtifacts(fixture);
  assert.equal(result.version, fixture.version);
  assert.equal(
    result.installer.resources["resources/connectors/ob.js"].sha256,
    result.portableZip.resources["resources/connectors/ob.js"].sha256,
  );
});

test("rejects a stale packaged resource", (t) => {
  const fixture = createFixture();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  fs.writeFileSync(fixture.sourceEntries[0].sourcePath, "newer-connector");
  assert.throws(
    () => verifyLauncherReleaseArtifacts(fixture),
    /Stale launcher resource/,
  );
});

test("never republishes a version with different or unverifiable artifacts", () => {
  const next = {
    version: "0.1.27",
    files: {
      installer: { sha256: "installer-new" },
      portableZip: { sha256: "zip-new" },
    },
  };
  assert.doesNotThrow(() =>
    assertSafeManifestReplacement({ version: "0.1.26" }, next),
  );
  assert.doesNotThrow(() =>
    assertSafeManifestReplacement(JSON.parse(JSON.stringify(next)), next),
  );
  assert.throws(
    () =>
      assertSafeManifestReplacement(
        {
          version: "0.1.27",
          files: {
            installer: { sha256: "installer-old" },
            portableZip: { sha256: "zip-old" },
          },
        },
        next,
      ),
    /Refusing to replace launcher 0\.1\.27/,
  );
  assert.throws(
    () => assertSafeManifestReplacement({ version: "0.1.27" }, next),
    /Refusing to replace launcher 0\.1\.27/,
  );
});

test("default release verification covers runtime, map, widget, renderer, and static assets", () => {
  const entries = new Set(
    defaultSourceEntries().map((entry) => entry.entryPath),
  );
  for (const required of [
    "resources/connectors/ob.js",
    "resources/app/electron/main.cjs",
    "resources/app/electron/telemetryBridge.cjs",
    "resources/app/electron/observerFeedSupervisor.cjs",
    "resources/app/electron/map-engine/map-registry.cjs",
    "resources/app/electron/map-engine/telemetry-map-bridge.cjs",
    "resources/app/electron/widget-server/server.cjs",
    "resources/app/electron/widget-server/public/obs-map-widget.js",
    "resources/app/electron/assets/maps/erangel.png",
    "resources/app/electron/assets/maps/rondo.webp",
    "resources/app/dist/index.html",
    "resources/default-team.png",
    "resources/default-player.png",
  ]) {
    assert.ok(entries.has(required), `missing release verification for ${required}`);
  }
  assert.ok(entries.size > 100, "release verification set is unexpectedly small");
});
