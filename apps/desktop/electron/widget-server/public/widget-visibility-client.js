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

    target.style.transition =
      "transform " +
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

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", connect, { once: true });
  } else {
    connect();
  }
})();
