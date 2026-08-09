"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const {
  DesktopReleaseInputError,
  assertDesktopReleaseInputsClean,
  inspectDesktopReleaseInputs,
} = require("./verify-desktop-release-inputs.cjs");

function writeFile(root, relativePath, content = relativePath) {
  const target = path.join(root, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

function git(root, args) {
  const result = spawnSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout;
}

function createFixture() {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "arenzyra-desktop-release-inputs-"),
  );
  git(root, ["init", "--quiet"]);
  git(root, ["config", "user.email", "release-guard@example.invalid"]);
  git(root, ["config", "user.name", "Release Guard Test"]);
  writeFile(
    root,
    ".gitignore",
    [
      "apps/desktop/node_modules/",
      "apps/desktop/dist/",
      "apps/desktop/coverage/",
      "apps/desktop/test-results/",
      "apps/desktop/.vite/",
      "apps/desktop/build/*.png",
      "*.log",
      "",
    ].join("\n"),
  );
  writeFile(root, "package.json", '{"name":"fixture-root","private":true}\n');
  writeFile(root, "package-lock.json", '{"lockfileVersion":3,"packages":{}}\n');
  writeFile(root, "pnpm-lock.yaml", "lockfileVersion: '9.0'\n");
  writeFile(root, "pnpm-workspace.yaml", "packages:\n  - apps/*\n");
  writeFile(root, "scripts/sync-brand-icons.cjs", "module.exports = 1;\n");
  writeFile(root, "scripts/sync-desktop-maps.cjs", "module.exports = 1;\n");
  writeFile(
    root,
    "scripts/blocked-launcher-release-entrypoint.cjs",
    "module.exports = 1;\n",
  );
  writeFile(
    root,
    "scripts/launcher-release-artifact-verifier.cjs",
    "module.exports = 1;\n",
  );
  writeFile(
    root,
    "scripts/sync-launcher-downloads.cjs",
    "module.exports = 1;\n",
  );
  writeFile(
    root,
    "scripts/verify-desktop-connector-provenance.cjs",
    "module.exports = 1;\n",
  );
  writeFile(
    root,
    "scripts/verify-desktop-map-provenance.cjs",
    "module.exports = 1;\n",
  );
  writeFile(
    root,
    "scripts/verify-desktop-release-inputs.cjs",
    "module.exports = 1;\n",
  );
  writeFile(root, "apps/desktop/package.json", '{"name":"fixture"}\n');
  writeFile(root, "apps/desktop/src/App.tsx", "export default 1;\n");
  writeFile(root, "apps/desktop/electron/main.cjs", "module.exports = 1;\n");
  writeFile(root, "apps/desktop/electron/assets/maps/rondo.webp", "rondo-v1");
  writeFile(root, "apps/desktop/build/icon.ico", "icon-v1");
  writeFile(root, "ob.js", "module.exports = 1;\n");
  writeFile(root, "docs/unrelated.md", "initial\n");
  git(root, ["add", "."]);
  git(root, [
    "-c",
    "commit.gpgsign=false",
    "commit",
    "--quiet",
    "-m",
    "fixture",
  ]);
  return root;
}

function fixtureTest(name, callback) {
  test(name, (t) => {
    const root = createFixture();
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    callback(root);
  });
}

fixtureTest(
  "accepts clean inputs while ignoring unrelated repository changes",
  (root) => {
    writeFile(root, "docs/unrelated.md", "modified outside guarded paths\n");
    writeFile(root, "scratch/untracked.txt", "outside guarded paths\n");
    assert.equal(
      assertDesktopReleaseInputsClean({ repoRoot: root }).clean,
      true,
    );
  },
);

fixtureTest("rejects a modified tracked desktop map", (root) => {
  writeFile(
    root,
    "apps/desktop/electron/assets/maps/rondo.webp",
    "unreviewed-rondo-replacement",
  );
  assert.throws(
    () => assertDesktopReleaseInputsClean({ repoRoot: root }),
    (error) =>
      error instanceof DesktopReleaseInputError &&
      /M apps\/desktop\/electron\/assets\/maps\/rondo\.webp/.test(
        error.message,
      ),
  );
});

for (const releaseInput of [
  "package.json",
  "package-lock.json",
  "scripts/sync-brand-icons.cjs",
  "scripts/sync-desktop-maps.cjs",
  "scripts/blocked-launcher-release-entrypoint.cjs",
  "scripts/verify-desktop-connector-provenance.cjs",
]) {
  fixtureTest(`rejects a dirty release dependency ${releaseInput}`, (root) => {
    writeFile(root, releaseInput, `dirty ${releaseInput}\n`);
    const result = inspectDesktopReleaseInputs({ repoRoot: root });
    assert.equal(result.clean, false);
    assert.deepEqual(result.trackedChanges, [
      { status: "M", path: releaseInput },
    ]);
  });
}

fixtureTest("ignores unrelated pnpm web-workspace metadata", (root) => {
  writeFile(root, "pnpm-lock.yaml", "dirty web-only pnpm lock\n");
  writeFile(root, "pnpm-workspace.yaml", "packages: []\n");
  assert.equal(assertDesktopReleaseInputsClean({ repoRoot: root }).clean, true);
});

fixtureTest("rejects an untracked desktop map asset", (root) => {
  writeFile(
    root,
    "apps/desktop/electron/assets/maps/sanhok.webp",
    "untracked-map",
  );
  const result = inspectDesktopReleaseInputs({ repoRoot: root });
  assert.equal(result.clean, false);
  assert.deepEqual(result.untrackedPaths, [
    "apps/desktop/electron/assets/maps/sanhok.webp",
  ]);
});

fixtureTest(
  "rejects ignored package-adjacent files but permits generated output",
  (root) => {
    writeFile(root, "apps/desktop/dist/index.html", "generated renderer");
    writeFile(root, "apps/desktop/node_modules/example/index.js", "dependency");
    writeFile(root, "apps/desktop/electron-debug.log", "local debug log");
    writeFile(root, "apps/desktop/build/default-player.png", "legacy asset");
    writeFile(
      root,
      "apps/desktop/electron/private.log",
      "runtime-adjacent log",
    );
    const result = inspectDesktopReleaseInputs({ repoRoot: root });
    assert.equal(result.clean, false);
    assert.deepEqual(result.ignoredPackagePaths, [
      "apps/desktop/build/default-player.png",
      "apps/desktop/electron/private.log",
    ]);
  },
);

fixtureTest("rejects a missing root connector", (root) => {
  fs.rmSync(path.join(root, "ob.js"));
  assert.throws(
    () => assertDesktopReleaseInputsClean({ repoRoot: root }),
    /D ob\.js/,
  );
});

fixtureTest(
  "rejects assume-unchanged inputs that Git would normally skip",
  (root) => {
    git(root, [
      "update-index",
      "--assume-unchanged",
      "apps/desktop/electron/main.cjs",
    ]);
    writeFile(root, "apps/desktop/electron/main.cjs", "locally replaced\n");
    const result = inspectDesktopReleaseInputs({ repoRoot: root });
    assert.equal(result.clean, false);
    assert.deepEqual(result.unsafeIndexFlags, [
      { flag: "h", path: "apps/desktop/electron/main.cjs" },
    ]);
  },
);

test("rejects a clean Git-tracked desktop symlink or junction", (t) => {
  const root = createFixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const linkPath = path.join(root, "apps", "desktop", "electron", "main.cjs");
  const targetPath = path.join(root, "docs", "unrelated.md");
  fs.rmSync(linkPath);
  try {
    fs.symlinkSync(
      path.relative(path.dirname(linkPath), targetPath),
      linkPath,
      "file",
    );
  } catch (error) {
    t.skip(`Filesystem links are unavailable: ${error.code || error.message}`);
    return;
  }
  git(root, ["add", "apps/desktop/electron/main.cjs"]);
  git(root, [
    "-c",
    "commit.gpgsign=false",
    "commit",
    "--quiet",
    "-m",
    "track linked release input",
  ]);
  const result = inspectDesktopReleaseInputs({ repoRoot: root });
  assert.equal(result.trackedChanges.length, 0);
  assert.equal(result.clean, false);
  assert.deepEqual(result.linkedPaths, [
    {
      path: "apps/desktop/electron/main.cjs",
      linkedAt: "apps/desktop/electron/main.cjs",
      kind: "symbolic-link-or-junction",
    },
  ]);
});

test("rejects a clean Git-tracked desktop file with multiple hardlinks", (t) => {
  const root = createFixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const trackedPath = path.join(
    root,
    "apps",
    "desktop",
    "electron",
    "main.cjs",
  );
  const secondLink = path.join(root, "docs", "main-hardlink.cjs");
  try {
    fs.linkSync(trackedPath, secondLink);
  } catch (error) {
    t.skip(
      `Filesystem hardlinks are unavailable: ${error.code || error.message}`,
    );
    return;
  }

  const result = inspectDesktopReleaseInputs({ repoRoot: root });
  assert.deepEqual(result.trackedChanges, []);
  assert.equal(result.clean, false);
  assert.deepEqual(result.linkedPaths, [
    {
      path: "apps/desktop/electron/main.cjs",
      linkedAt: "apps/desktop/electron/main.cjs",
      kind: "multiply-linked-file",
    },
  ]);
  assert.throws(
    () => assertDesktopReleaseInputsClean({ repoRoot: root }),
    (error) =>
      error instanceof DesktopReleaseInputError &&
      /multiply-linked-file apps\/desktop\/electron\/main\.cjs/.test(
        error.message,
      ),
  );
});

test("desktop release and candidate builds never import maps and guard inputs immediately before packaging", () => {
  const repoRoot = path.resolve(__dirname, "..");
  const desktopPackage = JSON.parse(
    fs.readFileSync(
      path.join(repoRoot, "apps", "desktop", "package.json"),
      "utf8",
    ),
  );
  for (const [scriptName, expectedConfig] of [
    ["build:electron", "electron-builder.config.cjs"],
    ["build:electron:candidate", "electron-builder.candidate.config.cjs"],
  ]) {
    const command = desktopPackage.scripts[scriptName];
    const firstGuard = command.indexOf("npm run verify:release-inputs");
    const firstConnectorProvenanceGate = command.indexOf(
      "npm run verify:connector-provenance",
    );
    const brandSync = command.indexOf("npm run sync:branding");
    const secondGuard = command.indexOf(
      "npm run verify:release-inputs",
      firstGuard + 1,
    );
    const rendererBuild = command.indexOf("npm run build");
    const thirdGuard = command.indexOf(
      "npm run verify:release-inputs",
      secondGuard + 1,
    );
    const secondConnectorProvenanceGate = command.indexOf(
      "npm run verify:connector-provenance",
      firstConnectorProvenanceGate + 1,
    );
    const provenanceGate = command.indexOf("npm run verify:map-provenance");
    const packager = command.indexOf("electron-builder");

    assert.doesNotMatch(command, /sync:maps/);
    assert.ok(firstGuard >= 0, scriptName);
    assert.ok(firstGuard < firstConnectorProvenanceGate, scriptName);
    assert.ok(firstConnectorProvenanceGate < brandSync, scriptName);
    assert.ok(brandSync < secondGuard, scriptName);
    assert.ok(secondGuard < rendererBuild, scriptName);
    assert.ok(rendererBuild < thirdGuard, scriptName);
    assert.ok(thirdGuard < secondConnectorProvenanceGate, scriptName);
    assert.ok(secondConnectorProvenanceGate < provenanceGate, scriptName);
    assert.ok(provenanceGate < packager, scriptName);
    assert.match(
      command,
      new RegExp(`--config ${expectedConfig.replaceAll(".", "\\.")}`),
    );
  }
});
