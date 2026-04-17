(function () {
  const bootstrap = window.__ARENZYRA_LOCAL_WIDGET_BOOTSTRAP__ || {};
  const root = document.getElementById("fight-alert-root");
  const panel = document.getElementById("fight-alert-panel");
  const teamAEl = document.getElementById("fight-alert-team-a");
  const teamBEl = document.getElementById("fight-alert-team-b");

  if (!root || !panel || !teamAEl || !teamBEl) {
    return;
  }

  const RECONNECT_DELAY_MS = 2000;
  const TELEMETRY_STALE_MS = 9000;

  const state = {
    activeCandidateId: null,
    lastProductionSupportAt: 0,
    reconnectTimer: null,
    socket: null,
    staleTimer: null,
  };

  function buildSocketUrl() {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return new URL(`${protocol}//${window.location.host}${bootstrap.wsPath || "/ws"}`).toString();
  }

  function setVisible(visible) {
    root.dataset.visible = visible ? "true" : "false";
    root.setAttribute("aria-hidden", visible ? "false" : "true");
  }

  function animateEntry() {
    panel.classList.remove("is-entering");
    void panel.offsetWidth;
    panel.classList.add("is-entering");
  }

  function clearCandidate() {
    state.activeCandidateId = null;
    setVisible(false);
  }

  function renderCandidate(candidate) {
    if (!candidate || !candidate.teamALabel || !candidate.teamBLabel) {
      clearCandidate();
      return;
    }

    const nextId = String(candidate.id || "").trim() || null;
    const shouldAnimate = !state.activeCandidateId || state.activeCandidateId !== nextId;

    teamAEl.textContent = candidate.teamALabel;
    teamBEl.textContent = candidate.teamBLabel;
    setVisible(true);

    if (shouldAnimate) {
      animateEntry();
    }

    state.activeCandidateId = nextId;
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

  function refreshStaleTimer() {
    if (state.staleTimer !== null) {
      window.clearTimeout(state.staleTimer);
    }

    state.staleTimer = window.setTimeout(function () {
      if (Date.now() - state.lastProductionSupportAt >= TELEMETRY_STALE_MS) {
        clearCandidate();
      }
    }, TELEMETRY_STALE_MS);
  }

  function applyProductionSupport(snapshot) {
    state.lastProductionSupportAt = Date.now();
    refreshStaleTimer();

    const candidate =
      snapshot && typeof snapshot === "object" ? snapshot.fightAlertCandidate || null : null;
    renderCandidate(candidate);
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
      return;
    }

    if (message.type === "heartbeat" && Date.now() - state.lastProductionSupportAt >= TELEMETRY_STALE_MS) {
      clearCandidate();
    }
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

  connect();

  window.addEventListener("beforeunload", function () {
    if (state.reconnectTimer !== null) {
      window.clearTimeout(state.reconnectTimer);
      state.reconnectTimer = null;
    }
    if (state.staleTimer !== null) {
      window.clearTimeout(state.staleTimer);
      state.staleTimer = null;
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
