"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  collectLocalDependencyFileSets,
} = require("./local-dependency-file-policy.cjs");

function writePackage(directory, name, dependencies = {}) {
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(
    path.join(directory, "package.json"),
    `${JSON.stringify({ name, version: "1.0.0", dependencies })}\n`,
  );
}

function withFixture(callback) {
  const fixtureRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "arenzyra-desktop-dependencies-"),
  );
  try {
    const workspaceRoot = path.join(fixtureRoot, "workspace");
    const desktopRoot = path.join(workspaceRoot, "apps", "desktop");
    writePackage(workspaceRoot, "workspace");
    writePackage(desktopRoot, "desktop", { alpha: "1.0.0" });
    return callback({ fixtureRoot, workspaceRoot, desktopRoot });
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

test("maps npm-ci workspace-hoisted dependencies into packaged app node_modules", () => {
  withFixture(({ workspaceRoot, desktopRoot }) => {
    writePackage(
      path.join(workspaceRoot, "node_modules", "alpha"),
      "alpha",
      { beta: "1.0.0" },
    );
    writePackage(path.join(workspaceRoot, "node_modules", "beta"), "beta");

    const fileSets = collectLocalDependencyFileSets({
      desktopRoot,
      workspaceRoot,
    });
    assert.deepEqual(
      fileSets.map(({ from, to }) => ({
        from: path.relative(workspaceRoot, from).replaceAll(path.sep, "/"),
        to,
      })),
      [
        { from: "node_modules/alpha", to: "node_modules/alpha" },
        { from: "node_modules/beta", to: "node_modules/beta" },
      ],
    );
  });
});

test("prefers an app-local dependency over a workspace-hoisted copy", () => {
  withFixture(({ workspaceRoot, desktopRoot }) => {
    writePackage(path.join(workspaceRoot, "node_modules", "alpha"), "alpha");
    writePackage(path.join(desktopRoot, "node_modules", "alpha"), "alpha");

    const [fileSet] = collectLocalDependencyFileSets({
      desktopRoot,
      workspaceRoot,
    });
    assert.equal(
      path.relative(desktopRoot, fileSet.from).replaceAll(path.sep, "/"),
      "node_modules/alpha",
    );
    assert.equal(fileSet.to, "node_modules/alpha");
  });
});

test("nests a conflicting hoisted version before it can resolve to the wrong package", () => {
  withFixture(({ workspaceRoot, desktopRoot }) => {
    fs.writeFileSync(
      path.join(desktopRoot, "package.json"),
      `${JSON.stringify({
        name: "desktop",
        version: "1.0.0",
        dependencies: { alpha: "1.0.0", gamma: "1.0.0" },
      })}\n`,
    );
    writePackage(
      path.join(workspaceRoot, "node_modules", "alpha"),
      "alpha",
      { debug: "1.0.0" },
    );
    writePackage(path.join(workspaceRoot, "node_modules", "debug"), "debug");
    writePackage(
      path.join(desktopRoot, "node_modules", "gamma"),
      "gamma",
      { debug: "2.0.0" },
    );
    writePackage(path.join(desktopRoot, "node_modules", "debug"), "debug");

    const fileSets = collectLocalDependencyFileSets({
      desktopRoot,
      workspaceRoot,
    });
    const debugSets = fileSets
      .filter(({ to }) => to.endsWith("/debug"))
      .map(({ from, to }) => ({
        from: path.relative(workspaceRoot, from).replaceAll(path.sep, "/"),
        to,
      }));
    assert.deepEqual(debugSets, [
      { from: "node_modules/debug", to: "node_modules/debug" },
      {
        from: "apps/desktop/node_modules/debug",
        to: "node_modules/gamma/node_modules/debug",
      },
    ]);
  });
});

test("does not resolve dependencies above the reviewed workspace", () => {
  withFixture(({ fixtureRoot, workspaceRoot, desktopRoot }) => {
    writePackage(path.join(fixtureRoot, "node_modules", "alpha"), "alpha");
    assert.throws(
      () => collectLocalDependencyFileSets({ desktopRoot, workspaceRoot }),
      /dependency is not installed/i,
    );
  });
});
