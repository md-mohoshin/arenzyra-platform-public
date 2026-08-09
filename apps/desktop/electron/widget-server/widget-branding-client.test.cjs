"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const SCRIPT_PATH = path.join(
  __dirname,
  "public",
  "widget-branding-client.js",
);

function createHarness({ bootstrap, fetch }) {
  const style = new Map();
  let intervalCallback = null;
  const context = {
    document: {
      documentElement: {
        style: {
          setProperty(name, value) {
            style.set(name, value);
          },
        },
      },
    },
    fetch,
  };
  context.window = {
    __ARENZYRA_LOCAL_WIDGET_BOOTSTRAP__: bootstrap,
    setInterval(callback) {
      intervalCallback = callback;
      return 1;
    },
    clearInterval() {},
    addEventListener() {},
  };

  vm.runInNewContext(fs.readFileSync(SCRIPT_PATH, "utf8"), context, {
    filename: SCRIPT_PATH,
  });

  return { style, runInterval: () => intervalCallback?.() };
}

async function flushAsyncWork() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

test("local widget branding refresh never follows success with a remote CORS request", async () => {
  const calls = [];
  const harness = createHarness({
    bootstrap: {
      widgetKey: "map-overlay",
      brandingRefreshPath: "/obs/widget-branding",
      brandingApiUrl: "https://api.arenzyra.com/branding/org-1",
    },
    fetch: async (url) => {
      calls.push(String(url));
      return {
        ok: true,
        json: async () => ({ branding: { primaryColor: "#123abc" } }),
      };
    },
  });

  await flushAsyncWork();
  assert.deepEqual(calls, ["/obs/widget-branding"]);
  assert.equal(harness.style.get("--obs-brand-primary"), "#123abc");

  harness.runInterval();
  await flushAsyncWork();
  assert.deepEqual(calls, ["/obs/widget-branding", "/obs/widget-branding"]);
});

test("local widget branding failure does not fall through to the cross-origin API", async () => {
  const calls = [];
  createHarness({
    bootstrap: {
      widgetKey: "map-overlay",
      brandingRefreshPath: "/obs/widget-branding",
      brandingApiUrl: "https://api.arenzyra.com/branding/org-1",
      branding: { primaryColor: "#22c55e" },
    },
    fetch: async (url) => {
      calls.push(String(url));
      return { ok: false, json: async () => ({}) };
    },
  });

  await flushAsyncWork();
  assert.deepEqual(calls, ["/obs/widget-branding"]);
});

test("legacy pages without a local branding proxy can still use their configured URL", async () => {
  const calls = [];
  createHarness({
    bootstrap: {
      widgetKey: "legacy-widget",
      brandingApiUrl: "https://branding.test/org-1",
    },
    fetch: async (url) => {
      calls.push(String(url));
      return {
        ok: true,
        json: async () => ({ primaryColor: "#abcdef" }),
      };
    },
  });

  await flushAsyncWork();
  assert.deepEqual(calls, ["https://branding.test/org-1"]);
});
