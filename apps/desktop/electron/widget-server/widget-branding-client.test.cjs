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
  let intervalMs = null;
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
    setInterval(callback, delayMs) {
      intervalCallback = callback;
      intervalMs = delayMs;
      return 1;
    },
    clearInterval() {},
    addEventListener() {},
  };

  vm.runInNewContext(fs.readFileSync(SCRIPT_PATH, "utf8"), context, {
    filename: SCRIPT_PATH,
  });

  return {
    style,
    get intervalMs() {
      return intervalMs;
    },
    runInterval: () => intervalCallback?.(),
  };
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

for (const widgetKey of [
  "gold-broadcast-focused-roster",
  "gold-broadcast-player-stats",
]) {
  test(`${widgetKey} uses only strict capability organization primary for Gold`, () => {
    const harness = createHarness({
      bootstrap: {
        widgetKey,
        organization: {
          branding: {
            primaryColor: "#FFF",
            primary: "#123456",
            secondaryColor: "#00e5ff",
            accent: "#2fc600",
            panel: "#fe293d",
            backgroundSolid: "#38bdf8",
          },
        },
        branding: { primaryColor: "#00e5ff" },
      },
      fetch: async () => ({ ok: false, json: async () => ({}) }),
    });

    assert.equal(harness.style.get("--gold-solid"), "#ffffff");
  });
}

test("focused Gold falls back without accepting hostile or direct palette values", () => {
  const hostile = createHarness({
    bootstrap: {
      widgetKey: "gold-broadcast-focused-roster",
      organization: {
        branding: {
          primaryColor: "url(https://invalid.test/gold)",
          primary: "rgb(0, 229, 255)",
          secondaryColor: "#00e5ff",
          accent: "#2fc600",
        },
      },
      branding: { primaryColor: "#00e5ff" },
    },
    fetch: async () => ({ ok: false, json: async () => ({}) }),
  });
  const missingOrganization = createHarness({
    bootstrap: {
      widgetKey: "gold-broadcast-player-stats",
      branding: { primaryColor: "#00e5ff" },
    },
    fetch: async () => ({ ok: false, json: async () => ({}) }),
  });
  const unrelated = createHarness({
    bootstrap: {
      widgetKey: "map-overlay",
      organization: { branding: { primaryColor: "#ffffff" } },
    },
    fetch: async () => ({ ok: false, json: async () => ({}) }),
  });

  assert.equal(hostile.style.get("--gold-solid"), "#eedd77");
  assert.equal(missingOrganization.style.get("--gold-solid"), "#eedd77");
  assert.equal(unrelated.style.has("--gold-solid"), false);
});

test("focused Gold accepts the strict organization primary alias when primaryColor is unusable", () => {
  const harness = createHarness({
    bootstrap: {
      widgetKey: "gold-broadcast-player-stats",
      organization: {
        branding: { primaryColor: "not-a-color", primary: "#AbC" },
      },
    },
    fetch: async () => ({ ok: false, json: async () => ({}) }),
  });

  assert.equal(harness.style.get("--gold-solid"), "#aabbcc");
});

test("focused Gold refreshes its capability-scoped primary on the existing 15 second loop", async () => {
  const calls = [];
  const harness = createHarness({
    bootstrap: {
      widgetKey: "gold-broadcast-player-stats",
      brandingRefreshPath: "/obs/widget-context/focused-capability",
      organization: { branding: { primaryColor: "#123abc" } },
    },
    fetch: async (url) => {
      calls.push(String(url));
      return {
        ok: true,
        json: async () => ({
          organization: { branding: { primaryColor: "#ffffff" } },
          branding: { primaryColor: "#00e5ff" },
        }),
      };
    },
  });

  assert.equal(harness.style.get("--gold-solid"), "#123abc");
  assert.equal(harness.intervalMs, 15000);
  await flushAsyncWork();
  assert.deepEqual(calls, ["/obs/widget-context/focused-capability"]);
  assert.equal(harness.style.get("--gold-solid"), "#ffffff");
});
