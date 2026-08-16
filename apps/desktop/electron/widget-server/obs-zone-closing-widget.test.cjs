"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const SCRIPT_PATH = path.join(__dirname, "public", "obs-zone-closing-widget.js");
const STYLE_PATH = path.join(__dirname, "public", "obs-zone-closing-widget.css");

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

function createHarness({
  bootstrap: bootstrapOverride,
  fetch: fetchOverride,
  reducedMotion = false,
} = {}) {
  const elements = new Map([
    ["next-zone-update-root", createElement()],
    ["next-zone-update-phase", createElement()],
    ["next-zone-update-countdown", createElement()],
    ["next-zone-update-progress", createElement()],
    ["next-zone-update-status", createElement()],
    ["next-zone-update-alive", createElement()],
    ["next-zone-update-metric-label", createElement()],
  ]);
  elements.get("next-zone-update-root").dataset.style =
    bootstrapOverride?.styleVariant || "";
  const animationFrames = new Map();
  const windowListeners = new Map();
  const sockets = [];
  const intervals = [];
  const rootStyle = new Map();
  let nextAnimationFrameId = 0;

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
    setInterval(callback, delayMs) {
      intervals.push({ callback, delayMs });
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
    matchMedia() {
      return { matches: reducedMotion };
    },
    requestAnimationFrame(callback) {
      nextAnimationFrameId += 1;
      animationFrames.set(nextAnimationFrameId, callback);
      return nextAnimationFrameId;
    },
    cancelAnimationFrame(id) {
      animationFrames.delete(id);
    },
    setInterval: context.setInterval,
    clearInterval: context.clearInterval,
    setTimeout: context.setTimeout,
    clearTimeout: context.clearTimeout,
    addEventListener(type, listener) {
      const next = windowListeners.get(type) || [];
      next.push(listener);
      windowListeners.set(type, next);
    },
    dispatchEvent(event) {
      for (const listener of windowListeners.get(event.type) || []) {
        listener(event);
      }
      return true;
    },
  };

  vm.runInNewContext(fs.readFileSync(SCRIPT_PATH, "utf8"), context, {
    filename: SCRIPT_PATH,
  });

  return {
    elements,
    intervals,
    sockets,
    rootStyle,
    window: context.window,
    flushFrame() {
      const entry = animationFrames.entries().next().value;
      if (!entry) return false;
      animationFrames.delete(entry[0]);
      entry[1](Date.now());
      return true;
    },
    flushUntil(predicate, maximumFrames = 12) {
      for (let index = 0; index < maximumFrames && !predicate(); index += 1) {
        if (!this.flushFrame()) break;
      }
      return predicate();
    },
    get pendingFrames() {
      return animationFrames.size;
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

test("Gold Ring keeps the approved 180 by 204 black-and-gold geometry", () => {
  const css = fs.readFileSync(STYLE_PATH, "utf8");
  const goldRoot = css.match(
    /\.obs-next-zone-update-root--gold-ring\s*\{[\s\S]*?\}/,
  )?.[0];

  assert.ok(goldRoot);
  assert.match(
    css,
    /\.obs-next-zone-update-root--gold-ring\s*\{[\s\S]*?width:\s*180px;[\s\S]*?height:\s*204px;/,
  );
  assert.match(
    css,
    /\.next-zone-update-gold-face\s*\{[\s\S]*?width:\s*180px;[\s\S]*?height:\s*170px;/,
  );
  assert.match(
    css,
    /\.next-zone-update-gold-footer\s*\{[\s\S]*?height:\s*34px;/,
  );
  assert.match(
    css,
    /--gold-broadcast-font:\s*"Bahnschrift Condensed",\s*"Arial Narrow",\s*Impact,\s*Arial,\s*sans-serif;/,
  );
  assert.match(
    css,
    /\.next-zone-update-gold-face\s*\{[\s\S]*?font-family:\s*var\(--gold-broadcast-font\);/,
  );
  assert.match(css, /#eedd77/);
  assert.match(css, /#050505/);
  assert.match(
    goldRoot,
    /--next-zone-primary:\s*var\(--gold-solid,\s*#eedd77\);/,
  );
  assert.match(goldRoot, /--next-zone-panel:\s*#050505;/);
  assert.match(goldRoot, /background:\s*transparent\s*!important;/);
  assert.doesNotMatch(goldRoot, /#34d399|#00e5ff|#38bdf8/i);
  assert.match(
    css,
    /\.next-zone-update-gold-face\s*\{[\s\S]*?var\(--gold-solid,\s*#eedd77\)[\s\S]*?color-mix\(in srgb,\s*var\(--gold-solid,\s*#eedd77\) 82%,\s*var\(--next-zone-panel\)\)/,
  );
  assert.doesNotMatch(css, /#635205/i);
  assert.match(
    css,
    /\.obs-next-zone-update-root--gold-ring \.next-zone-update-progress span\s*\{[\s\S]*?background:\s*var\(--gold-solid,\s*#eedd77\);/,
  );
});

test("Gold Ring uses only strict capability organization primary for its Gold token", () => {
  const harness = createHarness({
    bootstrap: {
      widgetKey: "next-zone-update-gold-ring",
      styleVariant: "gold-ring",
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
  });

  assert.equal(harness.rootStyle.get("--gold-solid"), "#ffffff");
});

test("Gold Ring falls back without accepting hostile, direct, or non-Gold palette input", () => {
  const hostile = createHarness({
    bootstrap: {
      widgetKey: "next-zone-update-gold-ring",
      styleVariant: "gold-ring",
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
  });
  const missingOrganization = createHarness({
    bootstrap: {
      widgetKey: "next-zone-update-gold-ring",
      styleVariant: "gold-ring",
      branding: { primaryColor: "#00e5ff" },
    },
  });
  const unrelated = createHarness({
    bootstrap: {
      widgetKey: "next-zone-update",
      organization: { branding: { primaryColor: "#ffffff" } },
    },
  });

  assert.equal(hostile.rootStyle.get("--gold-solid"), "#eedd77");
  assert.equal(missingOrganization.rootStyle.get("--gold-solid"), "#eedd77");
  assert.equal(unrelated.rootStyle.has("--gold-solid"), false);
});

test("Gold Ring accepts the strict organization primary alias when primaryColor is unusable", () => {
  const harness = createHarness({
    bootstrap: {
      widgetKey: "next-zone-update-gold-ring",
      styleVariant: "gold-ring",
      organization: {
        branding: { primaryColor: "not-a-color", primary: "#AbC" },
      },
    },
  });

  assert.equal(harness.rootStyle.get("--gold-solid"), "#aabbcc");
});

test("Gold Ring refreshes its capability-scoped primary on the existing 5 second loop", async () => {
  const calls = [];
  const harness = createHarness({
    bootstrap: {
      widgetKey: "next-zone-update-gold-ring",
      styleVariant: "gold-ring",
      brandingRefreshPath: "/obs/widget-context/gold-ring-capability",
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

  assert.equal(harness.rootStyle.get("--gold-solid"), "#123abc");
  assert.equal(
    harness.intervals.some(({ delayMs }) => delayMs === 5000),
    true,
  );
  await flushAsyncWork();
  assert.deepEqual(calls, ["/obs/widget-context/gold-ring-capability"]);
  assert.equal(harness.rootStyle.get("--gold-solid"), "#ffffff");
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

test("Gold Ring renders live alive teams, stage, and countdown without changing reset or offline behavior", () => {
  const harness = createHarness({
    bootstrap: { styleVariant: "gold-ring" },
  });

  sendZoneUpdate(harness, {
    phase: 4,
    aliveTeams: 12,
    matchPhase: "combat",
    mode: "closing",
    targetEndAt: Date.now() + 16_000,
    receivedAt: Date.now(),
  });

  const root = harness.elements.get("next-zone-update-root");
  assert.equal(root.hidden, false);
  assert.equal(root.dataset.goldMetric, "alive");
  assert.equal(harness.elements.get("next-zone-update-alive").textContent, "12");
  assert.equal(
    harness.elements.get("next-zone-update-metric-label").textContent,
    "ALIVE",
  );
  assert.equal(
    harness.elements.get("next-zone-update-countdown").textContent,
    "00:16",
  );
  assert.equal(
    harness.elements.get("next-zone-update-phase").textContent,
    "STAGE 4",
  );

  harness.sockets[0].close();
  assert.equal(
    harness.flushUntil(() => root.dataset.offline === "true"),
    true,
  );
  assert.equal(root.dataset.offline, "true");
  assert.equal(
    harness.elements.get("next-zone-update-status").textContent,
    "WS OFFLINE",
  );

  harness.sockets[0].dispatch("message", {
    data: JSON.stringify({ type: "runtime_reset", timestamp: Date.now() }),
  });
  assert.equal(harness.flushUntil(() => root.hidden), true);
  assert.equal(root.hidden, true);
});

test("Gold Ring labels the center value as seconds when alive-team data is absent", () => {
  const harness = createHarness({
    bootstrap: { styleVariant: "gold-ring" },
  });

  sendZoneUpdate(harness, {
    phase: 4,
    matchPhase: "combat",
    mode: "closing",
    targetEndAt: Date.now() + 16_000,
    receivedAt: Date.now(),
  });

  const root = harness.elements.get("next-zone-update-root");
  assert.equal(root.dataset.goldMetric, "seconds");
  assert.equal(harness.elements.get("next-zone-update-alive").textContent, "16");
  assert.equal(
    harness.elements.get("next-zone-update-metric-label").textContent,
    "SECONDS",
  );
});

test("Gold Ring reveals from its hidden pose only after the nested two-frame replay", () => {
  const harness = createHarness({
    bootstrap: { styleVariant: "gold-ring" },
  });

  sendZoneUpdate(harness, {
    phase: 5,
    aliveTeams: 9,
    matchPhase: "combat",
    mode: "closing",
    targetEndAt: Date.now() + 16_000,
    receivedAt: Date.now(),
  });

  const root = harness.elements.get("next-zone-update-root");
  assert.equal(root.hidden, false);
  assert.equal(root.dataset.goldObsMotion, "preparing");
  assert.equal(root.classList.values.has("is-visible"), false);

  // The first motion frame only arms the second one; it cannot expose the card.
  harness.flushFrame();
  assert.equal(root.dataset.goldObsMotion, "preparing");
  assert.equal(root.classList.values.has("is-visible"), false);
  assert.equal(
    harness.flushUntil(() => root.dataset.goldObsMotion === "playing"),
    true,
  );
  assert.equal(root.classList.values.has("is-visible"), true);

  harness.window.dispatchEvent({
    type: "arenzyra:gold-obs-replay",
    detail: { reason: "launcher-hotkey-show", reducedMotion: false },
  });
  assert.equal(root.dataset.goldObsMotion, "preparing");
  assert.equal(root.classList.values.has("is-visible"), false);
  assert.equal(
    harness.flushUntil(() => root.dataset.goldObsMotion === "playing"),
    true,
  );
  assert.equal(root.classList.values.has("is-visible"), true);
});

test("Gold Ring cannot be resurrected by queued or replay motion outside zone eligibility", () => {
  const harness = createHarness({
    bootstrap: { styleVariant: "gold-ring" },
  });

  sendZoneUpdate(harness, {
    phase: 5,
    aliveTeams: 9,
    matchPhase: "combat",
    mode: "closing",
    targetEndAt: Date.now() + 16_000,
    receivedAt: Date.now(),
  });
  const root = harness.elements.get("next-zone-update-root");
  assert.equal(root.dataset.goldObsMotion, "preparing");

  harness.sockets[0].dispatch("message", {
    data: JSON.stringify({
      type: "zone_update",
      timestamp: Date.now(),
      payload: {
        phase: 5,
        aliveTeams: 9,
        matchPhase: "combat",
        mode: "waiting",
        targetEndAt: Date.now() + 16_000,
        receivedAt: Date.now(),
      },
    }),
  });
  assert.equal(harness.flushUntil(() => root.hidden), true);
  assert.equal(root.dataset.goldObsMotion, "idle");
  assert.equal(root.classList.values.has("is-visible"), false);

  // Flush several perpetual render frames to prove canceled reveal callbacks do
  // not put an ineligible card back on screen.
  for (let index = 0; index < 5; index += 1) harness.flushFrame();
  harness.window.dispatchEvent({
    type: "arenzyra:gold-obs-replay",
    detail: { reason: "obs-source-visible", reducedMotion: false },
  });
  for (let index = 0; index < 5; index += 1) harness.flushFrame();
  assert.equal(root.hidden, true);
  assert.equal(root.dataset.goldObsMotion, "idle");
  assert.equal(root.classList.values.has("is-visible"), false);
});

test("Gold Ring skips transition frames under reduced motion", () => {
  const harness = createHarness({
    bootstrap: { styleVariant: "gold-ring" },
    reducedMotion: true,
  });

  sendZoneUpdate(harness, {
    phase: 5,
    aliveTeams: 9,
    matchPhase: "combat",
    mode: "closing",
    targetEndAt: Date.now() + 16_000,
    receivedAt: Date.now(),
  });

  const root = harness.elements.get("next-zone-update-root");
  assert.equal(root.hidden, false);
  assert.equal(root.dataset.goldObsMotion, "reduced");
  assert.equal(root.classList.values.has("is-visible"), true);

  harness.window.dispatchEvent({
    type: "arenzyra:gold-obs-replay",
    detail: { reason: "obs-source-visible", reducedMotion: false },
  });
  assert.equal(root.dataset.goldObsMotion, "reduced");
  assert.equal(root.classList.values.has("is-visible"), true);
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
