"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const repositoryRoot = path.resolve(__dirname, "../..");

test("legacy overlay server is development-only and loopback-bound", () => {
  const launcher = fs.readFileSync(path.join(__dirname, "main.js"), "utf8");
  const server = fs.readFileSync(
    path.join(repositoryRoot, "apps/overlay-server/server.js"),
    "utf8",
  );

  assert.match(launcher, /!app\.isPackaged/);
  assert.match(launcher, /process\.env\.NODE_ENV !== "production"/);
  assert.match(launcher, /I_UNDERSTAND_DEV_ONLY/);
  assert.match(
    launcher,
    /ALLOW_LEGACY_SHADOW_API === "I_UNDERSTAND_DEV_ONLY"/,
  );
  assert.match(server, /process\.env\.NODE_ENV === "production"/);
  assert.match(server, /I_UNDERSTAND_DEV_ONLY/);
  assert.match(server, /const HOST = "127\.0\.0\.1"/);
  assert.doesNotMatch(server, /origin:\s*["']\*["']/);
});

test("unsafe desktop overlay server is excluded and has no runtime caller", () => {
  const desktopRoot = path.join(repositoryRoot, "apps/desktop");
  const manifest = JSON.parse(
    fs.readFileSync(path.join(desktopRoot, "package.json"), "utf8"),
  );
  assert.ok(manifest.build.files.includes("!electron/overlayServer.cjs"));

  const electronRoot = path.join(desktopRoot, "electron");
  const pending = [electronRoot];
  const callers = [];
  while (pending.length > 0) {
    const directory = pending.pop();
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        pending.push(fullPath);
      } else if (
        /\.(?:cjs|js|mjs)$/.test(entry.name) &&
        entry.name !== "overlayServer.cjs" &&
        /overlayServer\.cjs/.test(fs.readFileSync(fullPath, "utf8"))
      ) {
        callers.push(path.relative(desktopRoot, fullPath));
      }
    }
  }
  assert.deepEqual(callers, []);
});
