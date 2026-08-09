"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { ensureDefaultTeamLogo } = require("./defaultTeamLogo.cjs");

function withTempDirectory(run) {
  const tempDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "arenzyra-default-team-logo-"),
  );
  try {
    return run(tempDirectory);
  } finally {
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  }
}

test("refreshes only the launcher-owned default logo when the bundle changes", () => {
  withTempDirectory((tempDirectory) => {
    const assetsDirectory = path.join(tempDirectory, "assets", "teams");
    const bundledLogoPath = path.join(tempDirectory, "bundled-default.png");
    const localDefaultPath = path.join(assetsDirectory, "default-team.png");
    const assignedTeamPath = path.join(assetsDirectory, "001.png");

    fs.mkdirSync(assetsDirectory, { recursive: true });
    fs.writeFileSync(bundledLogoPath, Buffer.from("new-system-logo"));
    fs.writeFileSync(localDefaultPath, Buffer.from("old-system-logo"));
    fs.writeFileSync(assignedTeamPath, Buffer.from("assigned-team-logo"));

    const result = ensureDefaultTeamLogo({
      teamAssetsDir: assetsDirectory,
      bundledDefaultTeamPath: bundledLogoPath,
    });

    assert.equal(result.refreshed, true);
    assert.deepEqual(fs.readFileSync(localDefaultPath), Buffer.from("new-system-logo"));
    assert.deepEqual(
      fs.readFileSync(assignedTeamPath),
      Buffer.from("assigned-team-logo"),
    );
  });
});

test("does not rewrite a matching default logo", () => {
  withTempDirectory((tempDirectory) => {
    const assetsDirectory = path.join(tempDirectory, "assets", "teams");
    const bundledLogoPath = path.join(tempDirectory, "bundled-default.png");
    fs.mkdirSync(assetsDirectory, { recursive: true });
    fs.writeFileSync(bundledLogoPath, Buffer.from("system-logo"));
    fs.copyFileSync(
      bundledLogoPath,
      path.join(assetsDirectory, "default-team.png"),
    );

    const result = ensureDefaultTeamLogo({
      teamAssetsDir: assetsDirectory,
      bundledDefaultTeamPath: bundledLogoPath,
    });

    assert.equal(result.refreshed, false);
    assert.equal(result.source, "bundled");
  });
});
