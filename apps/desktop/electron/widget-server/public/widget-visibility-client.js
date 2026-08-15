(function () {
  "use strict";

  var bootstrap =
    window.__ARENZYRA_WIDGET_VISIBILITY_BOOTSTRAP__ ||
    window.__ARENZYRA_LOCAL_WIDGET_BOOTSTRAP__ ||
    window.__ARENZYRA_MAP_WIDGET_BOOTSTRAP__ ||
    {};
  var widgetKey = String(bootstrap.widgetKey || bootstrap.widgetId || "").trim();
  var wsPath = String(bootstrap.wsPath || "/ws").trim() || "/ws";
  var state = {
    active: false,
    direction: "auto",
    transitionMs: 260,
  };
  var reconnectTimer = null;
  var visibilityInitialized = false;
  var replayFrame = null;
  var replaySequence = 0;
  var obsLifecycleShown = false;
  var lastObsReplayRequestedAt = 0;
  var OBS_LIFECYCLE_BURST_MS = 250;
  var GOLD_OBS_REPLAY_EVENT = "arenzyra:gold-obs-replay";

  function normalize(value) {
    return String(value || "").trim().toLowerCase();
  }

  function normalizeDirection(value) {
    var direction = normalize(value);
    if (
      direction === "left" ||
      direction === "right" ||
      direction === "up" ||
      direction === "down"
    ) {
      return direction;
    }
    return "auto";
  }

  function inferDirection() {
    var explicit = normalizeDirection(bootstrap.direction);
    if (explicit !== "auto") {
      return explicit;
    }
    var key = normalize(widgetKey);
    if (
      key.indexOf("leaderboard") >= 0 ||
      key.indexOf("ranking") >= 0 ||
      key.indexOf("kill-feed") >= 0 ||
      key.indexOf("photo") >= 0 ||
      key.indexOf("desk") >= 0
    ) {
      return "right";
    }
    if (key.indexOf("lower-third") >= 0) {
      return "left";
    }
    return "up";
  }

  function getTransform(direction) {
    switch (direction) {
      case "left":
        return "translate3d(-112%, 0, 0)";
      case "right":
        return "translate3d(112%, 0, 0)";
      case "down":
        return "translate3d(0, 112%, 0)";
      case "up":
      default:
        return "translate3d(0, -112%, 0)";
    }
  }

  function getTarget() {
    return (
      document.getElementById("arenzyra-widget-visibility-root") ||
      document.body ||
      document.documentElement
    );
  }

  function prefersReducedMotion() {
    return Boolean(
      typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    );
  }

  function dispatchReplayEvent(detail) {
    var replayEvent = null;
    try {
      if (typeof window.CustomEvent === "function") {
        replayEvent = new window.CustomEvent(GOLD_OBS_REPLAY_EVENT, {
          detail: detail,
        });
      } else if (typeof document.createEvent === "function") {
        replayEvent = document.createEvent("CustomEvent");
        replayEvent.initCustomEvent(GOLD_OBS_REPLAY_EVENT, false, false, detail);
      }
    } catch (_) {
      replayEvent = null;
    }

    if (replayEvent && typeof window.dispatchEvent === "function") {
      window.dispatchEvent(replayEvent);
    }
  }

  function postReplayToRemoteFrames(detail) {
    if (typeof document.querySelectorAll !== "function") {
      return;
    }
    var frames = document.querySelectorAll("iframe");
    for (var index = 0; index < frames.length; index += 1) {
      var frame = frames[index];
      if (!frame || !frame.contentWindow) {
        continue;
      }
      try {
        var source = String(
          frame.src ||
            (typeof frame.getAttribute === "function" && frame.getAttribute("src")) ||
            "",
        ).trim();
        var target = new URL(source, window.location.href);
        if (target.protocol !== "http:" && target.protocol !== "https:") {
          continue;
        }
        frame.contentWindow.postMessage(
          {
            type: GOLD_OBS_REPLAY_EVENT,
            reason: detail.reason,
            widgetKey: detail.widgetKey,
            reducedMotion: detail.reducedMotion,
            sequence: detail.sequence,
          },
          target.origin,
        );
      } catch (_) {
        // A malformed or unavailable iframe is never a reason to break visibility.
      }
    }
  }

  function emitGoldObsReplay(reason) {
    replayFrame = null;
    replaySequence += 1;
    var detail = {
      reason: String(reason || "obs-lifecycle"),
      widgetKey: widgetKey,
      reducedMotion: prefersReducedMotion(),
      sequence: replaySequence,
    };
    dispatchReplayEvent(detail);
    postReplayToRemoteFrames(detail);
  }

  function queueGoldObsReplay(reason) {
    if (replayFrame !== null) {
      return;
    }
    lastObsReplayRequestedAt = Date.now();
    if (typeof window.requestAnimationFrame === "function") {
      replayFrame = window.requestAnimationFrame(function () {
        emitGoldObsReplay(reason);
      });
      return;
    }
    replayFrame = window.setTimeout(function () {
      emitGoldObsReplay(reason);
    }, 0);
  }

  function eventFlagIsTrue(event, property) {
    var detail = event && event.detail;
    return detail === true || Boolean(detail && detail[property] === true);
  }

  function eventFlagIsFalse(event, property) {
    var detail = event && event.detail;
    return detail === false || Boolean(detail && detail[property] === false);
  }

  function applyObsLifecycleFlag(event, property, reason) {
    if (eventFlagIsFalse(event, property)) {
      obsLifecycleShown = false;
      lastObsReplayRequestedAt = 0;
      return;
    }
    if (!eventFlagIsTrue(event, property) || obsLifecycleShown) {
      return;
    }
    obsLifecycleShown = true;
    queueGoldObsReplay(reason);
  }

  function installObsLifecycleReplay() {
    if (typeof window.addEventListener === "function") {
      window.addEventListener("obsSourceVisibleChanged", function (event) {
        applyObsLifecycleFlag(event, "visible", "obs-source-visible");
      });
      window.addEventListener("obsSourceActiveChanged", function (event) {
        applyObsLifecycleFlag(event, "active", "obs-source-active");
      });
      window.addEventListener("obsSceneChanged", function (event) {
        var detail = event && event.detail;
        if (detail && (detail.active === false || detail.visible === false)) {
          obsLifecycleShown = false;
          lastObsReplayRequestedAt = 0;
          return;
        }
        if (
          obsLifecycleShown &&
          Date.now() - lastObsReplayRequestedAt <= OBS_LIFECYCLE_BURST_MS
        ) {
          return;
        }
        obsLifecycleShown = true;
        queueGoldObsReplay("obs-scene-changed");
      });
    }

    if (typeof document.addEventListener === "function") {
      document.addEventListener("visibilitychange", function () {
        var documentVisible =
          document.hidden === false || document.visibilityState === "visible";
        if (!documentVisible) {
          obsLifecycleShown = false;
          lastObsReplayRequestedAt = 0;
          return;
        }
        if (!obsLifecycleShown) {
          obsLifecycleShown = true;
          queueGoldObsReplay("document-visible");
        }
      });
    }
  }

  function findSelection(payload) {
    var widgets = Array.isArray(payload && payload.widgets) ? payload.widgets : [];
    var normalizedWidgetKey = normalize(widgetKey);
    if (!normalizedWidgetKey) {
      return null;
    }
    for (var index = 0; index < widgets.length; index += 1) {
      var item = widgets[index] || {};
      if (item.enabled === false) {
        continue;
      }
      var candidateKey = normalize(item.widgetKey || item.id);
      if (candidateKey === "*" || candidateKey === normalizedWidgetKey) {
        return item;
      }
    }
    return null;
  }

  function applyVisibility(payload) {
    var wasHidden = visibilityInitialized && state.active === true;
    var selection = findSelection(payload || {});
    var active = Boolean(payload && payload.active && selection);
    var direction = normalizeDirection(selection && selection.direction);
    var transitionMs = Number(payload && payload.transitionMs);
    state = {
      active: active,
      direction: direction === "auto" ? inferDirection() : direction,
      transitionMs:
        Number.isFinite(transitionMs) && transitionMs >= 80 && transitionMs <= 1000
          ? Math.round(transitionMs)
          : 260,
    };

    var target = getTarget();
    if (!target) {
      return;
    }

    target.style.transition = prefersReducedMotion()
      ? "none"
      : "transform " +
        state.transitionMs +
        "ms cubic-bezier(0.22, 1, 0.36, 1), opacity " +
        Math.max(140, state.transitionMs - 60) +
        "ms ease";
    target.style.willChange = "transform, opacity";
    target.style.transform = state.active
      ? getTransform(state.direction)
      : "translate3d(0, 0, 0)";
    target.style.opacity = state.active ? "0" : "1";
    target.style.pointerEvents = state.active ? "none" : "";
    document.documentElement.dataset.arenzyraWidgetVisibility = state.active
      ? "hidden"
      : "visible";
    visibilityInitialized = true;

    if (wasHidden && !state.active) {
      obsLifecycleShown = true;
      queueGoldObsReplay("launcher-hotkey-show");
    } else if (state.active) {
      obsLifecycleShown = false;
    }
  }

  function buildSocketUrl() {
    var protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return new URL(protocol + "//" + window.location.host + wsPath).toString();
  }

  function scheduleReconnect() {
    if (reconnectTimer) {
      return;
    }
    reconnectTimer = window.setTimeout(function () {
      reconnectTimer = null;
      connect();
    }, 1000);
  }

  function connect() {
    if (!widgetKey || typeof WebSocket === "undefined") {
      return;
    }

    var socket = null;
    try {
      socket = new WebSocket(buildSocketUrl());
    } catch (_) {
      scheduleReconnect();
      return;
    }

    socket.addEventListener("message", function (event) {
      var message = null;
      try {
        message = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
      } catch (_) {
        return;
      }
      if (!message || message.type !== "widget_visibility") {
        return;
      }
      applyVisibility(message.payload || {});
    });

    socket.addEventListener("close", scheduleReconnect);
    socket.addEventListener("error", function () {
      try {
        socket.close();
      } catch (_) {
        scheduleReconnect();
      }
    });
  }

  installObsLifecycleReplay();

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", connect, { once: true });
  } else {
    connect();
  }
})();
