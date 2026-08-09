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

test("packaged production launcher requires HTTPS and an allowed API host", () => {
  withTempUserDataDir((userDataDir) => {
    const manager = createConfigManager({
      getUserDataPath: () => userDataDir,
      isPackaged: true,
      env: { NODE_ENV: "production" },
      log: () => {},
    });

    assert.equal(manager.validateConfig("apiBase", "http://api.arenzyra.com").valid, false);
    assert.equal(manager.validateConfig("apiBase", "https://evil.example").valid, false);
    assert.equal(manager.validateConfig("apiBase", "https://api.arenzyra.com").valid, true);
  });
});

test("trusted deployments can extend the packaged API host allowlist", () => {
  withTempUserDataDir((userDataDir) => {
    const manager = createConfigManager({
      getUserDataPath: () => userDataDir,
      isPackaged: true,
      env: {
        NODE_ENV: "production",
        ARENZYRA_ALLOWED_API_HOSTS: "api.partner.example",
      },
      log: () => {},
    });

    const result = manager.setApiBase("https://api.partner.example");
    assert.equal(result.changed, true);
    assert.equal(result.apiBase, "https://api.partner.example");
  });
});

test("launcher settings normalize the widget LAN toggle", () => {
  withTempUserDataDir((userDataDir) => {
    const manager = createConfigManager({
      getUserDataPath: () => userDataDir,
      isPackaged: true,
      env: { NODE_ENV: "production" },
      log: () => {},
    });

    manager.setConfigValue("settings", {
      widgetLanEnabled: "yes",
    });
    assert.equal(manager.getSettings().widgetLanEnabled, true);

    manager.setConfigValue("settings", {
      widgetLanEnabled: 0,
    });
    assert.equal(manager.getSettings().widgetLanEnabled, false);
  });
});

test("launcher settings normalize the pinned map always-on-top preference", () => {
  withTempUserDataDir((userDataDir) => {
    const manager = createConfigManager({
      getUserDataPath: () => userDataDir,
      isPackaged: true,
      env: { NODE_ENV: "production" },
      log: () => {},
    });

    manager.setSettings({
      pinnedMapControlAlwaysOnTop: "yes",
    });
    assert.equal(manager.getSettings().pinnedMapControlAlwaysOnTop, true);

    manager.setSettings({
      pinnedMapControlAlwaysOnTop: 0,
    });
    assert.equal(manager.getSettings().pinnedMapControlAlwaysOnTop, false);
  });
});
