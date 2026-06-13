"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createConfigManager } = require("./configManager.cjs");

function withTempUserDataDir(fn) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "arenzyra-config-"));
  try {
    return fn(tempDir);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function writeLauncherConfig(userDataDir, config) {
  const launcherDir = path.join(userDataDir, "launcher");
  fs.mkdirSync(launcherDir, { recursive: true });
  fs.writeFileSync(
    path.join(launcherDir, "config.json"),
    JSON.stringify(config, null, 2),
  );
}

test("packaged production launcher clears stale localhost api override", () => {
  withTempUserDataDir((userDataDir) => {
    writeLauncherConfig(userDataDir, {
      version: 1,
      apiBase: "http://localhost:3000",
      apiEnvironment: "auto",
      shadowTrackerPath: "",
      settings: {},
    });

    const manager = createConfigManager({
      getUserDataPath: () => userDataDir,
      isPackaged: true,
      env: { NODE_ENV: "production" },
      log: () => {},
    });

    const config = manager.getPublicConfig();
    assert.equal(config.apiBase, "https://api.arenzyra.com");
    assert.equal(config.apiBaseSource, "fallback");
    assert.equal(config.apiBaseOverride, null);

    const persisted = JSON.parse(
      fs.readFileSync(path.join(userDataDir, "launcher", "config.json"), "utf8"),
    );
    assert.equal(persisted.apiBase, "");
  });
});

test("packaged production launcher keeps localhost override when explicitly allowed", () => {
  withTempUserDataDir((userDataDir) => {
    writeLauncherConfig(userDataDir, {
      version: 1,
      apiBase: "http://localhost:3000",
      apiEnvironment: "auto",
      shadowTrackerPath: "",
      settings: {},
    });

    const manager = createConfigManager({
      getUserDataPath: () => userDataDir,
      isPackaged: true,
      env: {
        NODE_ENV: "production",
        ARENZYRA_ALLOW_LOCAL_API_BASE: "1",
      },
      log: () => {},
    });

    const config = manager.getPublicConfig();
    assert.equal(config.apiBase, "http://localhost:3000");
    assert.equal(config.apiBaseSource, "config");
    assert.equal(config.apiBaseOverride, "http://localhost:3000");
  });
});

test("unpackaged launcher keeps localhost override in local workflows", () => {
  withTempUserDataDir((userDataDir) => {
    writeLauncherConfig(userDataDir, {
      version: 1,
      apiBase: "http://localhost:3000",
      apiEnvironment: "auto",
      shadowTrackerPath: "",
      settings: {},
    });

    const manager = createConfigManager({
      getUserDataPath: () => userDataDir,
      isPackaged: false,
      env: { NODE_ENV: "production" },
      log: () => {},
    });

    const config = manager.getPublicConfig();
    assert.equal(config.apiBase, "http://localhost:3000");
    assert.equal(config.apiBaseSource, "config");
    assert.equal(config.apiBaseOverride, "http://localhost:3000");
  });
});

test("packaged production launcher rejects saving a localhost override", () => {
  withTempUserDataDir((userDataDir) => {
    const manager = createConfigManager({
      getUserDataPath: () => userDataDir,
      isPackaged: true,
      env: { NODE_ENV: "production" },
      log: () => {},
    });

    const result = manager.setApiBase("http://localhost:3000", {
      source: "test",
    });

    assert.equal(result.changed, false);
    assert.equal(result.apiBase, "https://api.arenzyra.com");
    assert.equal(manager.resolveApiBase("http://localhost:3000"), "https://api.arenzyra.com");
    assert.equal(manager.getPublicConfig().apiBaseOverride, null);
  });
});
