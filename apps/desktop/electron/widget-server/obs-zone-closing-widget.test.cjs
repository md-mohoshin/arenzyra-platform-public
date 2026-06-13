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

function createHarness() {
  const elements = new Map([
    ["next-zone-update-root", createElement()],
    ["next-zone-update-phase", createElement()],
    ["next-zone-update-countdown", createElement()],
    ["next-zone-update-progress", createElement()],
    ["next-zone-update-status", createElement()],
  ]);
  const animationFrames = [];
  const sockets = [];

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
          setProperty() {},
        },
      },
      getElementById(id) {
        return elements.get(id) || null;
      },
    },
    fetch: async () => ({
      ok: true,
      json: async () => ({ ok: true }),
    }),
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
    flushFrame() {
      const callback = animationFrames.shift();
      if (callback) {
        callback(Date.now());
      }
    },
  };
}

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
    "00:17",
  );
  assert.match(
    harness.elements.get("next-zone-update-progress").style.transform,
    /^scaleX\(0\.[0-9]+\)$/,
  );
});

test("next zone update applies display-only latency compensation", () => {
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
    "00:16",
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
