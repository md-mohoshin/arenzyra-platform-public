"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const SCRIPT_PATH = path.join(
  __dirname,
  "public",
  "widget-visibility-client.js",
);
const GOLD_OBS_REPLAY_EVENT = "arenzyra:gold-obs-replay";

function createEventTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, listener) {
      const next = listeners.get(type) || [];
      next.push(listener);
      listeners.set(type, next);
    },
    dispatchEvent(event) {
      for (const listener of listeners.get(event.type) || []) {
        listener(event);
      }
      return true;
    },
  };
}

function createHarness({ reducedMotion = false } = {}) {
  const windowEvents = createEventTarget();
  const documentEvents = createEventTarget();
  const replayEvents = [];
  const frameMessages = [];
  const animationFrames = [];
  const sockets = [];
  const target = {
    dataset: {},
    style: {},
  };
  const frame = {
    src: "https://arenzyra.com/widgets/leaderboard?style=gold-broadcast",
    contentWindow: {
      postMessage(message, targetOrigin) {
        frameMessages.push({ message, targetOrigin });
      },
    },
  };

  class FakeCustomEvent {
    constructor(type, init = {}) {
      this.type = type;
      this.detail = init.detail;
    }
  }

  class FakeWebSocket {
    constructor(url) {
      this.url = url;
      this.listeners = new Map();
      sockets.push(this);
    }

    addEventListener(type, listener) {
      const next = this.listeners.get(type) || [];
      next.push(listener);
      this.listeners.set(type, next);
    }

    dispatch(type, event = {}) {
      for (const listener of this.listeners.get(type) || []) {
        listener(event);
      }
    }

    close() {}
  }

  const document = {
    ...documentEvents,
    readyState: "complete",
    hidden: false,
    visibilityState: "visible",
    body: target,
    documentElement: {
      dataset: {},
      style: {},
    },
    getElementById() {
      return null;
    },
    querySelectorAll(selector) {
      return selector === "iframe" ? [frame] : [];
    },
  };
  const window = {
    ...windowEvents,
    __ARENZYRA_WIDGET_VISIBILITY_BOOTSTRAP__: {
      widgetKey: "leaderboard",
      wsPath: "/ws",
    },
    CustomEvent: FakeCustomEvent,
    WebSocket: FakeWebSocket,
    location: {
      href: "http://127.0.0.1:48123/w/capability",
      protocol: "http:",
      host: "127.0.0.1:48123",
    },
    matchMedia() {
      return { matches: reducedMotion };
    },
    requestAnimationFrame(callback) {
      animationFrames.push(callback);
      return animationFrames.length;
    },
    setTimeout(callback) {
      animationFrames.push(callback);
      return animationFrames.length;
    },
  };
  window.addEventListener(GOLD_OBS_REPLAY_EVENT, (event) => {
    replayEvents.push(event.detail);
  });

  vm.runInNewContext(fs.readFileSync(SCRIPT_PATH, "utf8"), {
    CustomEvent: FakeCustomEvent,
    URL,
    WebSocket: FakeWebSocket,
    document,
    window,
  });

  function sendVisibility(active) {
    assert.ok(sockets[0], "visibility client should open a WebSocket");
    sockets[0].dispatch("message", {
      data: JSON.stringify({
        type: "widget_visibility",
        payload: {
          active,
          transitionMs: 260,
          widgets: [
            {
              widgetKey: "leaderboard",
              enabled: true,
              direction: "right",
            },
          ],
        },
      }),
    });
  }

  function flushFrame() {
    const callback = animationFrames.shift();
    if (callback) callback();
  }

  return {
    document,
    frameMessages,
    replayEvents,
    sendVisibility,
    target,
    window,
    flushFrame,
    get pendingFrames() {
      return animationFrames.length;
    },
  };
}

test("launcher hotkey re-show emits one Gold replay locally and to the exact iframe origin", () => {
  const harness = createHarness();

  harness.sendVisibility(false);
  assert.equal(harness.replayEvents.length, 0, "initial visible snapshot is not a replay");

  harness.sendVisibility(true);
  assert.equal(harness.target.opacity, undefined);
  assert.equal(harness.target.style.opacity, "0");
  assert.equal(harness.replayEvents.length, 0);

  harness.sendVisibility(false);
  assert.equal(harness.target.style.opacity, "1");
  assert.equal(harness.replayEvents.length, 0, "replay is staged to the next frame");
  harness.flushFrame();

  assert.equal(harness.replayEvents.length, 1);
  assert.equal(harness.replayEvents[0].reason, "launcher-hotkey-show");
  assert.equal(harness.replayEvents[0].widgetKey, "leaderboard");
  assert.equal(harness.frameMessages.length, 1);
  assert.equal(harness.frameMessages[0].targetOrigin, "https://arenzyra.com");
  assert.deepEqual(
    JSON.parse(JSON.stringify(harness.frameMessages[0].message)),
    {
      type: GOLD_OBS_REPLAY_EVENT,
      reason: "launcher-hotkey-show",
      widgetKey: "leaderboard",
      reducedMotion: false,
      sequence: 1,
    },
  );
});

test("OBS lifecycle ignores false and duplicate true events and coalesces a show burst", () => {
  const harness = createHarness();
  harness.sendVisibility(false);

  harness.window.dispatchEvent({
    type: "obsSourceVisibleChanged",
    detail: { visible: false },
  });
  harness.window.dispatchEvent({
    type: "obsSourceActiveChanged",
    detail: { active: false },
  });
  harness.window.dispatchEvent({
    type: "obsSceneChanged",
    detail: { name: "Holding", active: false },
  });
  assert.equal(harness.pendingFrames, 0);
  assert.equal(harness.replayEvents.length, 0);

  // OBS commonly emits visible, active, and scene events together. They are one
  // source appearance, so the inner Gold animation must only restart once.
  harness.window.dispatchEvent({
    type: "obsSourceVisibleChanged",
    detail: { visible: true },
  });
  harness.window.dispatchEvent({
    type: "obsSourceActiveChanged",
    detail: { active: true },
  });
  harness.window.dispatchEvent({
    type: "obsSceneChanged",
    detail: { name: "Gameplay" },
  });
  assert.equal(harness.pendingFrames, 1);
  harness.flushFrame();

  assert.equal(harness.replayEvents.length, 1);
  assert.equal(harness.replayEvents[0].reason, "obs-source-visible");

  // A scene notification arriving just after OBS's first paint still belongs
  // to the same visible/active burst.
  harness.window.dispatchEvent({
    type: "obsSceneChanged",
    detail: { name: "Gameplay" },
  });
  assert.equal(harness.pendingFrames, 0);
  assert.equal(harness.replayEvents.length, 1);

  // Repeated true notifications, even after the queued frame has completed,
  // are not new appearances.
  harness.window.dispatchEvent({
    type: "obsSourceVisibleChanged",
    detail: { visible: true },
  });
  harness.window.dispatchEvent({
    type: "obsSourceActiveChanged",
    detail: { active: true },
  });
  assert.equal(harness.pendingFrames, 0);
  assert.equal(harness.replayEvents.length, 1);

  // A real false -> true edge is a new source appearance.
  harness.window.dispatchEvent({
    type: "obsSourceVisibleChanged",
    detail: { visible: false },
  });
  harness.window.dispatchEvent({
    type: "obsSourceVisibleChanged",
    detail: { visible: true },
  });
  harness.flushFrame();
  assert.equal(harness.replayEvents.at(-1).reason, "obs-source-visible");
  assert.equal(harness.replayEvents.length, 2);

  harness.document.hidden = true;
  harness.document.visibilityState = "hidden";
  harness.document.dispatchEvent({ type: "visibilitychange" });
  assert.equal(harness.pendingFrames, 0);

  harness.document.hidden = false;
  harness.document.visibilityState = "visible";
  harness.document.dispatchEvent({ type: "visibilitychange" });
  harness.flushFrame();
  assert.equal(harness.replayEvents.at(-1).reason, "document-visible");
  assert.equal(harness.replayEvents.length, 3);

  // Scene change remains a fallback when OBS does not supply visibility edges.
  harness.window.dispatchEvent({
    type: "obsSceneChanged",
    detail: { name: "Holding", active: false },
  });
  assert.equal(harness.pendingFrames, 0);
  harness.window.dispatchEvent({
    type: "obsSceneChanged",
    detail: { name: "Final Circle" },
  });
  harness.flushFrame();
  assert.equal(harness.replayEvents.at(-1).reason, "obs-scene-changed");
  assert.equal(harness.replayEvents.length, 4);
});

test("reduced motion removes the outer hotkey transition and is forwarded to inner replay", () => {
  const harness = createHarness({ reducedMotion: true });

  harness.sendVisibility(true);
  harness.sendVisibility(false);
  harness.flushFrame();

  assert.equal(harness.target.style.transition, "none");
  assert.equal(harness.replayEvents.length, 1);
  assert.equal(harness.replayEvents[0].reducedMotion, true);
  assert.equal(harness.frameMessages[0].message.reducedMotion, true);
});
