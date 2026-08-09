"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const SCRIPT_PATH = path.join(__dirname, "public", "obs-zone-closing-widget.js");

function createElement() {
  return {
    dataset: {},
    hidden: true,
    style: {},
    textContent: "",
    classList: {
      values: new Set(),
      toggle(name, enabled) {
        if (enabled) {
          this.values.add(name);
        } else {
          this.values.delete(name);
        }
      },
    },
  };
}

function createHarness({ bootstrap: bootstrapOverride, fetch: fetchOverride } = {}) {
  const elements = new Map([
    ["next-zone-update-root", createElement()],
    ["next-zone-update-phase", createElement()],
    ["next-zone-update-countdown", createElement()],
    ["next-zone-update-progress", createElement()],
    ["next-zone-update-status", createElement()],
  ]);
  const animationFrames = [];
  const sockets = [];
  const rootStyle = new Map();

  class FakeWebSocket {
    constructor() {
      this.readyState = FakeWebSocket.OPEN;
      this.listeners = new Map();
      sockets.push(this);
    }

    addEventListener(type, listener) {
      const nextListeners = this.listeners.get(type) || [];
      nextListeners.push(listener);
      this.listeners.set(type, nextListeners);
    }

    dispatch(type, event = {}) {
      for (const listener of this.listeners.get(type) || []) {
        listener(event);
      }
    }

    close() {
      this.readyState = FakeWebSocket.CLOSED;
      this.dispatch("close");
    }
  }

  FakeWebSocket.CONNECTING = 0;
  FakeWebSocket.OPEN = 1;
  FakeWebSocket.CLOSED = 3;

  const context = {
    console: {
      info() {},
      error() {},
    },
    document: {
      documentElement: {
        style: {
          setProperty(name, value) {
            rootStyle.set(name, value);
          },
        },
      },
      getElementById(id) {
        return elements.get(id) || null;
      },
    },
    fetch:
      fetchOverride ||
      (async () => ({
        ok: true,
        json: async () => ({ ok: true }),
      })),
    setInterval() {
      return 1;
    },
    clearInterval() {},
    setTimeout() {
      return 1;
    },
    clearTimeout() {},
    WebSocket: FakeWebSocket,
    URL,
    Date,
  };

  context.window = {
    __ARENZYRA_LOCAL_WIDGET_BOOTSTRAP__: {
      displayMode: "next-zone-update",
      revealWindowMs: 20_000,
      wsPath: "/ws",
      ...(bootstrapOverride || {}),
    },
    location: {
      protocol: "http:",
      host: "127.0.0.1:3000",
    },
    requestAnimationFrame(callback) {
      animationFrames.push(callback);
      return animationFrames.length;
    },
    cancelAnimationFrame() {},
    setInterval: context.setInterval,
    clearInterval: context.clearInterval,
    setTimeout: context.setTimeout,
    clearTimeout: context.clearTimeout,
    addEventListener() {},
  };

  vm.runInNewContext(fs.readFileSync(SCRIPT_PATH, "utf8"), context, {
    filename: SCRIPT_PATH,
  });

  return {
    elements,
    sockets,
    rootStyle,
    flushFrame() {
      const callback = animationFrames.shift();
      if (callback) {
        callback(Date.now());
      }
    },
  };
}

async function flushAsyncWork() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

test("next zone update uses the shared widget palette when no organization palette is available", () => {
  const harness = createHarness();

  assert.equal(harness.rootStyle.get("--next-zone-primary"), "#34d399");
  assert.equal(harness.rootStyle.get("--next-zone-accent"), "#a78bfa");
  assert.equal(harness.rootStyle.get("--next-zone-panel"), "#1c2330");
});

test("next zone update applies the saved organization palette to every local style", () => {
  const harness = createHarness({
    bootstrap: {
      organization: {
        branding: {
          primaryColor: "#c026d3",
          secondaryColor: "#0ea5e9",
          accent: "#f59e0b",
          panel: "#111827",
          textPrimary: "#fef3c7",
          textMuted: "#cbd5e1",
          border: "rgba(192, 38, 211, 0.5)",
          glowAccent: "rgba(245, 158, 11, 0.4)",
        },
      },
    },
  });

  assert.equal(harness.rootStyle.get("--next-zone-primary"), "#c026d3");
  assert.equal(harness.rootStyle.get("--next-zone-accent"), "#f59e0b");
  assert.equal(harness.rootStyle.get("--next-zone-panel"), "#111827");
  assert.equal(harness.rootStyle.get("--next-zone-text"), "#fef3c7");
  assert.equal(
    harness.rootStyle.get("--next-zone-border"),
    "rgba(192, 38, 211, 0.5)",
  );
});

test("next zone update retains direct branding returned by a refresh endpoint", async () => {
  const harness = createHarness({
    bootstrap: {
      brandingRefreshPath: "/obs/widget-context/next-zone",
      organization: { branding: { primaryColor: "#22c55e" } },
    },
    fetch: async () => ({
      ok: true,
      json: async () => ({
        ok: true,
        branding: {
          primaryColor: "#db2777",
          accent: "#f97316",
          panel: "#18181b",
        },
      }),
    }),
  });

  await flushAsyncWork();

  assert.equal(harness.rootStyle.get("--next-zone-primary"), "#22c55e");
  assert.equal(harness.rootStyle.get("--next-zone-accent"), "#f97316");
  assert.equal(harness.rootStyle.get("--next-zone-panel"), "#18181b");
});

function sendZoneUpdate(harness, payload) {
  const socket = harness.sockets[0];
  assert.ok(socket, "widget should open a websocket");
  socket.dispatch("open");
  socket.dispatch("message", {
    data: JSON.stringify({
      type: "zone_update",
      timestamp: Date.now(),
      payload,
    }),
  });
  harness.flushFrame();
}

test("next zone update shows final countdown while the zone is closing", () => {
  const harness = createHarness();

  sendZoneUpdate(harness, {
    phase: 7,
    matchPhase: "endgame",
    mode: "closing",
    targetEndAt: Date.now() + 16_000,
    receivedAt: Date.now(),
  });

  assert.equal(harness.elements.get("next-zone-update-root").hidden, false);
  assert.equal(
    harness.elements.get("next-zone-update-countdown").textContent,
    "00:16",
  );
  assert.match(
    harness.elements.get("next-zone-update-progress").style.transform,
    /^scaleX\(0\.[0-9]+\)$/,
  );
});

test("next zone update does not add artificial display latency compensation", () => {
  const harness = createHarness();

  sendZoneUpdate(harness, {
    phase: 7,
    matchPhase: "endgame",
    mode: "closing",
    targetEndAt: Date.now() + 15_000,
    receivedAt: Date.now(),
  });

  assert.equal(harness.elements.get("next-zone-update-root").hidden, false);
  assert.equal(
    harness.elements.get("next-zone-update-countdown").textContent,
    "00:15",
  );
});

test("next zone update stays hidden while the zone is waiting", () => {
  const harness = createHarness();

  sendZoneUpdate(harness, {
    phase: 7,
    matchPhase: "endgame",
    mode: "waiting",
    targetEndAt: Date.now() + 16_000,
    receivedAt: Date.now(),
  });

  assert.equal(harness.elements.get("next-zone-update-root").hidden, true);
});

test("next zone update stays hidden during opening match phases", () => {
  const harness = createHarness();

  sendZoneUpdate(harness, {
    phase: 1,
    matchPhase: "plane",
    mode: "waiting",
    targetEndAt: Date.now() + 16_000,
    receivedAt: Date.now(),
  });

  assert.equal(harness.elements.get("next-zone-update-root").hidden, true);
});
