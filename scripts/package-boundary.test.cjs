"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const repositoryRoot = path.resolve(__dirname, "..");

test("npm and pnpm workspace ownership is explicit and non-overlapping", () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(repositoryRoot, "package.json"), "utf8"),
  );
  const pnpmWorkspace = fs.readFileSync(
    path.join(repositoryRoot, "pnpm-workspace.yaml"),
    "utf8",
  );

  assert.equal(manifest.packageManager, "pnpm@10.26.1");
  assert.ok(manifest.engines.node);
  assert.deepEqual(manifest.workspaces, [
    "apps/desktop",
    "apps/discord-bot",
    "apps/launcher",
    "packages/*",
  ]);
  assert.match(pnpmWorkspace, /- "apps\/arenzyra-web"/);
  assert.doesNotMatch(pnpmWorkspace, /apps\/\*/);
  assert.doesNotMatch(pnpmWorkspace, /apps\/api/);
  assert.equal(Object.hasOwn(manifest.scripts, "postinstall"), false);
});

test("owned lockfiles contain only their declared application importers", () => {
  const npmLock = JSON.parse(
    fs.readFileSync(path.join(repositoryRoot, "package-lock.json"), "utf8"),
  );
  assert.equal(Object.hasOwn(npmLock.packages, "apps/api"), false);
  assert.equal(Object.hasOwn(npmLock.packages, "apps/arenzyra-web"), false);

  const pnpmLock = fs.readFileSync(
    path.join(repositoryRoot, "pnpm-lock.yaml"),
    "utf8",
  );
  assert.match(pnpmLock, /^  apps\/arenzyra-web:$/m);
  for (const excluded of [
    "api",
    "desktop",
    "discord-bot",
    "launcher",
    "match-state-service",
    "overlay-server",
    "shadow_api",
  ]) {
    assert.doesNotMatch(pnpmLock, new RegExp(`^  apps/${excluded}:$`, "m"));
  }
});
