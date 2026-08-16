"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const repoRoot = path.resolve(__dirname, "..");

test("reviewed launcher worker refuses an unattested same-checkout invocation", () => {
  const worker = path.join(__dirname, "run-reviewed-launcher-release.cjs");
  const env = { ...process.env };
  delete env.ARENZYRA_LAUNCHER_RELEASE_ATTESTATION;
  const result = spawnSync(process.execPath, [worker, "verify"], {
    cwd: repoRoot,
    encoding: "utf8",
    env,
    windowsHide: true,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /launcher-release-blocked/);
  assert.match(result.stderr, /attestation is missing or invalid/i);
});

test("reviewed Windows dispatcher binds clean checkout and pinned toolchain", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "reviewed-launcher-release-entrypoint.ps1"),
    "utf8",
  );
  const policy = JSON.parse(
    fs.readFileSync(
      path.join(
        repoRoot,
        "apps",
        "desktop",
        "release",
        "release-toolchain.json",
      ),
      "utf8",
    ),
  );
  const windows = policy.windowsRelease;
  assert.equal(policy.schemaVersion, 1);
  for (const tool of [windows.git, windows.node, windows.powershell]) {
    assert.equal(path.win32.isAbsolute(tool.path), true);
    assert.match(tool.sha256, /^[a-f0-9]{64}$/);
    assert.ok(String(tool.version).trim());
  }
  assert.equal(path.win32.isAbsolute(windows.npm.cliPath), true);
  assert.equal(path.win32.isAbsolute(windows.npm.rootPath), true);
  assert.match(windows.npm.treeSha256, /^[a-f0-9]{64}$/);
  assert.ok(Number.isSafeInteger(windows.npm.treeFileCount));

  const clearIndex = source.indexOf("foreach ($name in @(");
  const gitShowIndex = source.indexOf('show "${reviewedCommit}:');
  const npmCiIndex = source.indexOf('"ci", "--include=dev"');
  const detachedIndex = source.indexOf('"checkout", "--detach"');
  const workerIndex = source.indexOf("run-reviewed-launcher-release.cjs");
  assert.ok(clearIndex >= 0 && clearIndex < gitShowIndex);
  assert.ok(gitShowIndex < detachedIndex);
  assert.ok(detachedIndex < npmCiIndex);
  assert.ok(npmCiIndex < workerIndex);
  assert.match(source, /Get-ReviewedTreeDigest/);
  assert.match(source, /GIT_NO_REPLACE_OBJECTS/);
  assert.match(source, /fsck.*--full/s);
  assert.match(source, /"CSC_LINK".*"CSC_NAME".*"WIN_CSC_LINK"/s);
  assert.doesNotMatch(source, /signing identity is required/i);
  assert.doesNotMatch(source, /Invoke-Expression|\biex\b/i);
});

test("documentation loads only the reviewed dispatcher bytes through absolute sanitized Git", () => {
  const guide = fs.readFileSync(
    path.join(repoRoot, "infra", "PUBLISH.md"),
    "utf8",
  );
  assert.match(guide, /reviewed outer Windows launcher/i);
  assert.match(
    guide,
    /show "\$\{reviewedCommit\}:scripts\/reviewed-launcher-release-entrypoint\.ps1"/,
  );
  assert.match(guide, /Get-FileHash.*gitPath.*SHA256/s);
  assert.match(guide, /-NoProfile -NonInteractive -EncodedCommand/);
});
