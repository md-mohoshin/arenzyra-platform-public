"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  resolveLiveMapRuntimePaths,
} = require("../apps/desktop/electron/live-map-preview.cjs");
const {
  resolveLauncherRuntimePaths,
} = require("./start-observer-feed-direct.cjs");
const {
  requireLauncherUserData,
  resolveLauncherUserData,
} = require("../tools/pcob-live-utils.cjs");

const ROOT = path.resolve(__dirname, "..");

test("desktop helper paths derive from Windows platform data directories", () => {
  const env = {
    APPDATA: "D:\\Profiles\\Operator\\Roaming",
    LOCALAPPDATA: "D:\\Profiles\\Operator\\Local",
    SystemRoot: "D:\\Windows",
  };

  assert.deepEqual(resolveLiveMapRuntimePaths(env, "win32"), {
    launcherLogPath:
      "D:\\Profiles\\Operator\\Roaming\\arenzyra-observer-launcher\\logs\\launcher.log",
    teamAssetsRoot: "D:\\ArenzyraObserver\\assets\\teams",
    teamBrandingIniPath:
      "D:\\Profiles\\Operator\\Local\\ShadowTrackerExtra\\Saved\\TeamLogoAndColor.ini",
  });
  assert.deepEqual(resolveLauncherRuntimePaths(env, "win32"), {
    configPath:
      "D:\\Profiles\\Operator\\Roaming\\arenzyra-observer-launcher\\launcher\\config.json",
    launcherUserData:
      "D:\\Profiles\\Operator\\Roaming\\arenzyra-observer-launcher",
    localStatePath:
      "D:\\Profiles\\Operator\\Roaming\\arenzyra-observer-launcher\\Local State",
    sessionPath:
      "D:\\Profiles\\Operator\\Roaming\\arenzyra-observer-launcher\\launcher\\session.json",
  });
  assert.equal(
    resolveLauncherUserData(env, "win32"),
    "D:\\Profiles\\Operator\\Roaming\\arenzyra-observer-launcher",
  );
});

test("explicit absolute path overrides do not depend on an operator profile", () => {
  assert.deepEqual(
    resolveLiveMapRuntimePaths(
      {
        ARENZYRA_LAUNCHER_LOG_PATH: "E:\\LauncherData\\logs\\launcher.log",
        ARENZYRA_TEAM_ASSETS_ROOT: "E:\\ObserverData\\assets\\teams",
        ARENZYRA_TEAM_BRANDING_INI_PATH:
          "E:\\PcobData\\Saved\\TeamLogoAndColor.ini",
      },
      "win32",
    ),
    {
      launcherLogPath: "E:\\LauncherData\\logs\\launcher.log",
      teamAssetsRoot: "E:\\ObserverData\\assets\\teams",
      teamBrandingIniPath: "E:\\PcobData\\Saved\\TeamLogoAndColor.ini",
    },
  );
  assert.equal(
    resolveLauncherUserData(
      { ARENZYRA_LAUNCHER_USER_DATA: "E:\\LauncherData" },
      "win32",
    ),
    "E:\\LauncherData",
  );
});

test("path resolution fails closed when platform data is missing or relative", () => {
  assert.throws(
    () => resolveLiveMapRuntimePaths({}, "win32"),
    /Unable to resolve live-map runtime paths/,
  );
  assert.throws(
    () => resolveLauncherRuntimePaths({}, "win32"),
    /Launcher user-data path is unavailable/,
  );
  assert.throws(
    () => resolveLauncherRuntimePaths({ APPDATA: "relative" }, "win32"),
    /APPDATA must be an absolute path/,
  );
  assert.equal(resolveLauncherUserData({}, "linux"), null);
  assert.throws(
    () => requireLauncherUserData(null, "linux"),
    /Launcher user-data path is unavailable/,
  );
});

test("candidate-required sources contain no personal installed-app or user-data literal", () => {
  const requiredSources = [
    "apps/desktop/electron/live-map-preview.cjs",
    "apps/desktop/src/App.tsx",
    "scripts/start-observer-feed-direct.cjs",
    "tools/pcob-live-utils.cjs",
  ];

  for (const relativePath of requiredSources) {
    const source = fs.readFileSync(path.join(ROOT, relativePath), "utf8");
    assert.doesNotMatch(
      source,
      /[A-Za-z]:\\\\Users\\\\/i,
      relativePath,
    );
    assert.doesNotMatch(
      source,
      /AppData\\\\Local\\\\Programs\\\\arenzyra-observer-launcher/i,
      relativePath,
    );
  }

  const rendererSource = fs.readFileSync(
    path.join(ROOT, "apps", "desktop", "src", "App.tsx"),
    "utf8",
  );
  assert.doesNotMatch(
    rendererSource,
    /[A-Za-z]:\\\\ArenzyraObserver\\\\assets/i,
  );

  assert.equal(
    fs.existsSync(path.join(ROOT, "tools", "pcob-live-bridge-diagnostic.cjs")),
    false,
  );
});
