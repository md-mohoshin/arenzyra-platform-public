(function () {
  const bootstrap = window.__ARENZYRA_LOCAL_WIDGET_BOOTSTRAP__ || {};
  const root = document.getElementById("replay-marker-root");
  const card = document.getElementById("replay-marker-card");
  const title = document.getElementById("replay-marker-title");
  const detail = document.getElementById("replay-marker-detail");

  if (!root || !card || !title || !detail) {
    return;
  }

  const RECONNECT_DELAY_MS = 2000;
  const RENDER_TICK_MS = 250;
  const DISPLAY_WINDOW_MS = Math.max(
    4000,
    typeof bootstrap.displayWindowMs === "number" ? bootstrap.displayWindowMs : 12_000,
  );

  const state = {
    latestMarker: null,
    latestMarkerId: null,
    reconnectTimer: null,
    renderTimer: null,
    socket: null,
  };

  function asString(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function toFiniteNumber(value) {
    const numeric =
      typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
    return Number.isFinite(numeric) ? numeric : null;
  }

  function buildSocketUrl() {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return new URL(`${protocol}//${window.location.host}${bootstrap.wsPath || "/ws"}`).toString();
  }

  function setVisible(visible) {
    root.dataset.visible = visible ? "true" : "false";
    root.setAttribute("aria-hidden", visible ? "false" : "true");
  }

  function animateEntry() {
    card.classList.remove("is-entering");
    void card.offsetWidth;
    card.classList.add("is-entering");
  }

  function prettifyType(value) {
    const normalized = asString(value);
    if (!normalized) {
      return "Replay marker";
    }
    return normalized
      .toLowerCase()
      .split("_")
      .map(function (part) {
        return part ? part.charAt(0).toUpperCase() + part.slice(1) : "";
      })
      .join(" ");
  }

  function resolveMarkerCopy(marker) {
    const description = asString(marker && marker.description) || "Replay marker";
    const splitIndex = description.indexOf(" - ");
    if (splitIndex > 0) {
      return {
        title: description.slice(0, splitIndex),
        detail: description.slice(splitIndex + 3),
      };
    }

    return {
      title: description,
      detail: prettifyType(marker && marker.type),
    };
  }

  function render() {
    const marker = state.latestMarker;
    if (!marker) {
      setVisible(false);
      return;
    }

    const timestamp = toFiniteNumber(marker.timestamp);
    if (timestamp === null || Date.now() - timestamp > DISPLAY_WINDOW_MS) {
      setVisible(false);
      return;
    }

    const copy = resolveMarkerCopy(marker);
    title.textContent = copy.title;
    detail.textContent = copy.detail;
    setVisible(true);
  }

  function applyProductionSupport(snapshot) {
    const markers =
      snapshot && Array.isArray(snapshot.replayMarkers) ? snapshot.replayMarkers : [];
    const marker = markers[0] && typeof markers[0] === "object" ? markers[0] : null;
    const nextMarkerId = asString(marker && marker.id) || null;
    const shouldAnimate = nextMarkerId && nextMarkerId !== state.latestMarkerId;

    state.latestMarker = marker;
    state.latestMarkerId = nextMarkerId;

    if (shouldAnimate) {
      animateEntry();
    }

    render();
  }

  function handleMessage(raw) {
    let message = null;

    try {
      message = typeof raw === "string" ? JSON.parse(raw) : raw;
    } catch (_) {
      return;
    }

    if (!message || typeof message !== "object") {
      return;
    }

    if (message.type === "production_support") {
      applyProductionSupport(message.payload);
    }
  }

  function scheduleReconnect() {
    if (state.reconnectTimer !== null) {
      return;
    }

    state.reconnectTimer = window.setTimeout(function () {
      state.reconnectTimer = null;
      connect();
    }, RECONNECT_DELAY_MS);
  }

  function connect() {
    if (
      state.socket &&
      (state.socket.readyState === WebSocket.OPEN ||
        state.socket.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    const socket = new WebSocket(buildSocketUrl());
    state.socket = socket;

    socket.addEventListener("message", function (event) {
      handleMessage(event.data);
    });

    socket.addEventListener("close", function () {
      if (state.socket === socket) {
        state.socket = null;
      }
      scheduleReconnect();
    });

    socket.addEventListener("error", function () {
      try {
        socket.close();
      } catch (_) {
        // ignore socket close errors
      }
    });
  }

  state.renderTimer = window.setInterval(render, RENDER_TICK_MS);
  connect();

  window.addEventListener("beforeunload", function () {
    if (state.reconnectTimer !== null) {
      window.clearTimeout(state.reconnectTimer);
      state.reconnectTimer = null;
    }
    if (state.renderTimer !== null) {
      window.clearInterval(state.renderTimer);
      state.renderTimer = null;
    }
    if (state.socket) {
      try {
        state.socket.close();
      } catch (_) {
        // ignore socket close errors
      }
    }
  });
})();
