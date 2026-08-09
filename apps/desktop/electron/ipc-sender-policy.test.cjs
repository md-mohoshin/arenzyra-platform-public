"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const {
  IPC_SENDER_REJECTED_CODE,
  assertTrustedLauncherIpcSender,
  isAllowedLauncherRendererUrl,
} = require("./ipc-sender-policy.cjs");

const rendererFilePath = path.join(__dirname, "..", "dist", "index.html");

function makeEvent(url, options = {}) {
  const mainFrame = { url };
  const webContents = {
    mainFrame,
    getURL: () => url,
    isDestroyed: () => false,
  };
  return {
    event: {
      sender: options.sender || webContents,
      senderFrame: options.senderFrame || mainFrame,
    },
    webContents,
  };
}

function policy(webContents, overrides = {}) {
  return {
    getMainWebContents: () => webContents,
    rendererFilePath,
    isDev: false,
    allowedDevOrigins: [],
    ...overrides,
  };
}

test("accepts only the owned top-level packaged renderer", () => {
  const trusted = makeEvent(pathToFileURL(rendererFilePath).toString());
  assert.doesNotThrow(() =>
    assertTrustedLauncherIpcSender(trusted.event, policy(trusted.webContents)),
  );

  const other = makeEvent(pathToFileURL(rendererFilePath).toString());
  assert.throws(
    () =>
      assertTrustedLauncherIpcSender(
        { ...trusted.event, sender: other.webContents },
        policy(trusted.webContents),
      ),
    (error) => error?.code === IPC_SENDER_REJECTED_CODE,
  );

  assert.throws(
    () =>
      assertTrustedLauncherIpcSender(
        { ...trusted.event, senderFrame: { url: trusted.event.senderFrame.url } },
        policy(trusted.webContents),
      ),
    (error) => error?.code === IPC_SENDER_REJECTED_CODE,
  );
});

test("development origin allowlist is explicit", () => {
  const options = {
    rendererFilePath,
    isDev: true,
    allowedDevOrigins: ["http://localhost:5400"],
  };
  assert.equal(
    isAllowedLauncherRendererUrl("http://localhost:5400/dashboard", options),
    true,
  );
  assert.equal(
    isAllowedLauncherRendererUrl("http://127.0.0.1:5400/dashboard", options),
    false,
  );
  assert.equal(
    isAllowedLauncherRendererUrl("http://localhost.evil.test:5400/", options),
    false,
  );
  assert.equal(
    isAllowedLauncherRendererUrl("https://localhost:5400/", options),
    false,
  );
});

test("every launcher IPC channel is registered through the trusted wrapper", () => {
  const source = require("node:fs").readFileSync(
    path.join(__dirname, "main.cjs"),
    "utf8",
  );
  assert.doesNotMatch(
    source,
    /ipcMain\.(?:handle|on)\(\s*["']launcher:/,
  );
  for (const channel of [
    "launcher:login",
    "launcher:logout",
    "launcher:chooseFile",
    "launcher:openExternal",
    "launcher:launchShadowTracker",
    "launcher:startTelemetryBridge",
    "launcher:stopTelemetryBridge",
    "launcher:startObserverFeed",
    "launcher:stopObserverFeed",
  ]) {
    assert.match(
      source,
      new RegExp(
        `registerTrustedLauncher(?:Handle|On)\\(\\s*["']${channel}["']`,
      ),
    );
  }
});
