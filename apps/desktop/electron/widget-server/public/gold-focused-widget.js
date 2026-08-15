(function () {
  "use strict";

  const bootstrap = window.__ARENZYRA_LOCAL_WIDGET_BOOTSTRAP__ || {};
  const root = document.getElementById("gold-focused-root");
  if (!root) return;

  const displayMode = bootstrap.displayMode === "player-stats" ? "player-stats" : "roster";
  const bootstrapMatchId = cleanText(
    (bootstrap.match && bootstrap.match.id) || bootstrap.matchId,
  );
  const stateUrl = cleanText(bootstrap.localStateUrl || "/obs/gold-focused/state");
  const contextRefreshPath = cleanText(bootstrap.brandingRefreshPath);
  const goldBroadcastAssetBase = cleanText(bootstrap.goldBroadcastAssetBase);
  const staleAfterMs = finiteNumber(bootstrap.staleAfterMs) || 2_500;
  const defaultPlayerPhoto = cleanText(bootstrap.defaultPlayerPhoto) || "/assets/default-player.svg";
  const defaultTeamLogo = cleanText(bootstrap.defaultTeamLogo) || "/assets/default-team.png";
  const GOLD_OBS_REPLAY_EVENT = "arenzyra:gold-obs-replay";
  const state = {
    currentMatchId: bootstrapMatchId || null,
    data: null,
    httpConnected: false,
    wsConnected: false,
    socket: null,
    pollInFlight: false,
    reconnectTimer: null,
    contextRefreshInFlight: false,
    contextRefreshAfter: 0,
    reloading: false,
    metricMaxByPlayer: new Map(),
    killMaxByPlayer: new Map(),
    killMaxByTeam: new Map(),
    lastImageTokens: new Map(),
    motionFrameOne: null,
    motionFrameTwo: null,
    pendingMotionReplay: false,
  };

  function cleanText(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function finiteNumber(value) {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function timestampMs(value) {
    const numeric = finiteNumber(value);
    if (numeric !== null) return numeric > 0 && numeric < 1e12 ? numeric * 1000 : numeric;
    const parsed = Date.parse(cleanText(value));
    return Number.isFinite(parsed) ? parsed : null;
  }

  function key(value) {
    return String(value || "").trim().toLowerCase();
  }

  function byId(id) {
    return document.getElementById(id);
  }

  function prefersReducedMotion() {
    return Boolean(
      typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    );
  }

  function scheduleMotionFrame(callback) {
    if (typeof window.requestAnimationFrame === "function") {
      return window.requestAnimationFrame(callback);
    }
    return window.setTimeout(callback, 16);
  }

  function cancelMotionFrame(frame) {
    if (frame === null) return;
    if (typeof window.cancelAnimationFrame === "function") {
      window.cancelAnimationFrame(frame);
      return;
    }
    window.clearTimeout(frame);
  }

  function cancelGoldMotionFrames() {
    cancelMotionFrame(state.motionFrameOne);
    cancelMotionFrame(state.motionFrameTwo);
    state.motionFrameOne = null;
    state.motionFrameTwo = null;
  }

  function restartGoldMotion(reducedMotion) {
    if (root.hidden) {
      state.pendingMotionReplay = true;
      return;
    }

    state.pendingMotionReplay = false;
    cancelGoldMotionFrames();
    if (reducedMotion === true || prefersReducedMotion()) {
      root.dataset.goldObsMotion = "reduced";
      return;
    }

    root.dataset.goldObsMotion = "preparing";
    state.motionFrameOne = scheduleMotionFrame(function () {
      state.motionFrameOne = null;
      state.motionFrameTwo = scheduleMotionFrame(function () {
        state.motionFrameTwo = null;
        root.dataset.goldObsMotion = "playing";
      });
    });
  }

  function setText(id, value) {
    const element = byId(id);
    if (element) element.textContent = value;
  }

  function formatCount(value, pad) {
    const number = finiteNumber(value);
    if (number === null) return "--";
    const rounded = String(Math.max(0, Math.trunc(number)));
    return pad ? rounded.padStart(pad, "0") : rounded;
  }

  function formatDistance(value) {
    const number = finiteNumber(value);
    return number === null ? "--" : `${Math.max(0, Math.round(number))}M`;
  }

  function resolveBrowserUrl(pathname) {
    try {
      return new URL(pathname, window.location.href).toString();
    } catch (_) {
      return pathname;
    }
  }

  function resolveApiUrl(pathname) {
    if (/^https?:\/\//i.test(pathname)) return pathname;
    const apiBase = cleanText(bootstrap.apiBase);
    if (!apiBase) return resolveBrowserUrl(pathname);
    try {
      return new URL(pathname, `${apiBase.replace(/\/$/, "")}/`).toString();
    } catch (_) {
      return resolveBrowserUrl(pathname);
    }
  }

  function resolveGoldAssetUrl(pathname) {
    if (!goldBroadcastAssetBase) return resolveBrowserUrl(pathname);
    try {
      return new URL(
        pathname,
        `${goldBroadcastAssetBase.replace(/\/$/, "")}/`,
      ).toString();
    } catch (_) {
      return resolveBrowserUrl(pathname);
    }
  }

  function initializeStaticAssets() {
    const assets = document.querySelectorAll("img[data-gold-static-asset]");
    assets.forEach(function (element) {
      const markFailed = function () {
        element.dataset.loadFailed = "true";
      };
      element.dataset.loadFailed = "false";
      element.addEventListener("error", markFailed, { once: true });
      element.src = resolveGoldAssetUrl(element.dataset.goldStaticAsset);
      if (element.complete && element.naturalWidth === 0) markFailed();
    });
  }

  function setImage(element, token, candidates, alt) {
    if (!element) return;
    element.alt = alt || "";
    const cleanCandidates = Array.from(
      new Set(candidates.map(cleanText).filter(Boolean)),
    );
    if (state.lastImageTokens.get(element.id) === token) return;
    state.lastImageTokens.set(element.id, token);
    let index = 0;
    element.onerror = function () {
      index += 1;
      if (index >= cleanCandidates.length) {
        element.onerror = null;
        return;
      }
      element.src = cleanCandidates[index];
    };
    if (cleanCandidates.length > 0) element.src = cleanCandidates[0];
  }

  function playerIds(player) {
    return Array.from(
      new Set(
        [player && player.id]
          .concat(Array.isArray(player && player.lookupIds) ? player.lookupIds : [])
          .map(key)
          .filter(Boolean),
      ),
    );
  }

  function playerIdentity(player) {
    return playerIds(player)[0] || key(player && player.name);
  }

  function samePlayer(left, right) {
    const leftIds = playerIds(left);
    const rightIds = playerIds(right);
    if (leftIds.some((id) => rightIds.includes(id))) return true;
    return Boolean(key(left && left.name) && key(left && left.name) === key(right && right.name));
  }

  function playerPhotoCandidates(player, assetsVersion) {
    const candidates = [];
    const explicit = cleanText(player && player.avatarUrl);
    if (explicit) candidates.push(resolveApiUrl(explicit));
    for (const id of playerIds(player)) {
      candidates.push(
        resolveBrowserUrl(
          `/assets/players/${encodeURIComponent(id)}.png?v=${encodeURIComponent(assetsVersion || "0:0")}`,
        ),
      );
    }
    candidates.push(resolveBrowserUrl(defaultPlayerPhoto));
    return candidates;
  }

  function teamLogoCandidates(roster) {
    const candidates = [];
    const explicit = cleanText(roster && roster.logoUrl);
    if (explicit) candidates.push(resolveApiUrl(explicit));
    const teamId = cleanText(roster && roster.teamId);
    if (teamId) candidates.push(resolveBrowserUrl(`/assets/teams/${encodeURIComponent(teamId)}.png`));
    candidates.push(resolveBrowserUrl(defaultTeamLogo));
    return candidates;
  }

  function preserveCumulativeMetrics(data) {
    if (!data || !data.focus) return data;
    const playerKey = playerIdentity(data.focus);
    if (!playerKey) return data;
    const nextStats = data.playerStats || {};
    const previous = state.metricMaxByPlayer.get(playerKey) || {};
    const merged = {};
    for (const name of ["damage", "longestEliminationDistanceMeters", "airdropsLooted"]) {
      const incoming = finiteNumber(nextStats[name]);
      const existing = finiteNumber(previous[name]);
      merged[name] = incoming === null ? existing : existing === null ? incoming : Math.max(existing, incoming);
    }
    state.metricMaxByPlayer.set(playerKey, merged);
    return { ...data, playerStats: merged };
  }

  function preserveCumulativeKills(data) {
    const roster = data && data.roster;
    if (!roster || !Array.isArray(roster.players)) return data;
    const players = roster.players.map(function (player) {
      const playerKey = playerIdentity(player);
      const incoming = finiteNumber(player.kills);
      const existing = state.killMaxByPlayer.get(playerKey);
      const kills =
        incoming === null ? (existing ?? null) : existing === undefined ? incoming : Math.max(existing, incoming);
      if (playerKey && kills !== null) state.killMaxByPlayer.set(playerKey, kills);
      return { ...player, kills };
    });
    const derivedKills = players.some((player) => finiteNumber(player.kills) !== null)
      ? players.reduce((total, player) => total + (finiteNumber(player.kills) || 0), 0)
      : null;
    const teamKey =
      key(roster.teamId) || String(roster.teamSlot ?? "") || key(roster.teamName);
    const reportedKills = finiteNumber(roster.kills);
    const incomingTeamKills =
      reportedKills === null
        ? derivedKills
        : derivedKills === null
          ? reportedKills
          : Math.max(reportedKills, derivedKills);
    const existingTeamKills = state.killMaxByTeam.get(teamKey);
    const teamKills =
      incomingTeamKills === null
        ? (existingTeamKills ?? null)
        : existingTeamKills === undefined
          ? incomingTeamKills
          : Math.max(existingTeamKills, incomingTeamKills);
    if (teamKey && teamKills !== null) state.killMaxByTeam.set(teamKey, teamKills);
    return {
      ...data,
      roster: {
        ...roster,
        kills: teamKills,
        players,
      },
    };
  }

  function resetRuntime(nextMatchId) {
    cancelGoldMotionFrames();
    state.pendingMotionReplay = false;
    state.currentMatchId = nextMatchId || null;
    state.data = null;
    state.metricMaxByPlayer.clear();
    state.killMaxByPlayer.clear();
    state.killMaxByTeam.clear();
    state.lastImageTokens.clear();
    root.hidden = true;
    root.dataset.stale = "false";
    delete root.dataset.goldObsMotion;
  }

  function isLiveWorkflow(payload) {
    const workflow = cleanText(payload && payload.workflowState).toUpperCase();
    const production = cleanText(payload && payload.productionStatus).toUpperCase();
    if (!workflow && !production) return true;
    return ["MATCH_LIVE", "PRODUCTION_LIVE", "LIVE", "RUNNING"].includes(workflow) ||
      ["LIVE", "RUNNING", "ACTIVE"].includes(production);
  }

  function renderRoster(data) {
    const roster = data && data.roster;
    if (!roster) return false;
    setText("gold-team-name", cleanText(roster.teamName) || cleanText(roster.teamTag) || "TEAM");
    setText("gold-team-kills", formatCount(roster.kills, 2));
    const teamLogo = byId("gold-team-logo");
    setImage(
      teamLogo,
      [roster.teamId, roster.logoUrl].join("|"),
      teamLogoCandidates(roster),
      `${cleanText(roster.teamName) || "Team"} logo`,
    );
    const players = Array.isArray(roster.players) ? roster.players.slice(0, 4) : [];
    const rosterElement = root.querySelector(".gold-roster");
    const hasUtilityData = players.some(
      (player) => player && player.utilities && player.utilities.hasData === true,
    );
    if (rosterElement) {
      rosterElement.dataset.utilityAvailable = hasUtilityData ? "true" : "false";
    }
    for (let index = 0; index < 4; index += 1) {
      const player = players[index] || null;
      const row = root.querySelector(`[data-player-index="${index}"]`);
      const health = finiteNumber(player && player.health);
      const status = player ? cleanText(player.status) || "alive" : "unknown";
      const utilityHasData = Boolean(
        player && player.utilities && player.utilities.hasData === true,
      );
      if (row) {
        row.hidden = !player;
        row.dataset.status = status;
        row.dataset.hasData = player ? "true" : "false";
        row.dataset.utilityAvailable = utilityHasData ? "true" : "false";
        row.style.setProperty("--health", `${health === null ? 0 : Math.max(0, Math.min(100, health))}%`);
      }
      setText(`gold-player-${index}-name`, cleanText(player && player.name) || "PLAYER");
      setText(`gold-player-${index}-kills`, formatCount(player && player.kills, 2));
      setText(`gold-player-${index}-knockouts`, formatCount(player && player.knockouts, 2));
      setText(
        `gold-player-${index}-utility`,
        utilityHasData ? formatCount(player.utilities.total, 2) : "--",
      );
      setText(`gold-player-${index}-health`, formatCount(health));
      const photo = byId(`gold-player-${index}-photo`);
      setImage(
        photo,
        [playerIdentity(player), player && player.avatarUrl, data.playerAssetsVersion].join("|"),
        playerPhotoCandidates(player || {}, data.playerAssetsVersion),
        cleanText(player && player.name) || "Player",
      );
    }
    return true;
  }

  function renderStats(data) {
    if (!data || !data.focus || !data.playerStats) return false;
    setText("gold-stat-damage", formatCount(data.playerStats.damage));
    setText(
      "gold-stat-distance",
      formatDistance(data.playerStats.longestEliminationDistanceMeters),
    );
    setText("gold-stat-airdrops", formatCount(data.playerStats.airdropsLooted, 2));
    return true;
  }

  function syncDom() {
    const wasHidden = root.hidden;
    const data = state.data;
    const visible = displayMode === "roster" ? renderRoster(data) : renderStats(data);
    const updatedAt = timestampMs(data && data.updatedAt);
    const stale = Boolean(
      (data && data.stale === true) ||
        (updatedAt !== null && Date.now() - updatedAt > staleAfterMs),
    );
    root.dataset.stale = stale ? "true" : "false";
    const offline = !state.httpConnected && !state.wsConnected;
    root.dataset.offline = offline ? "true" : "false";
    root.hidden = !visible || stale || offline;
    if (!root.hidden && (wasHidden || state.pendingMotionReplay)) {
      restartGoldMotion(false);
    }
  }

  function contextMatchId(context) {
    return cleanText(
      (context && context.match && context.match.id) ||
        (context && context.matchId),
    );
  }

  async function refreshPermanentContext(expectedMatchId) {
    const expected = cleanText(expectedMatchId);
    const now = Date.now();
    if (
      !expected ||
      !contextRefreshPath ||
      state.reloading ||
      state.contextRefreshInFlight ||
      now < state.contextRefreshAfter
    ) {
      return;
    }
    state.contextRefreshInFlight = true;
    state.contextRefreshAfter = now + 1_000;
    try {
      const response = await window.fetch(resolveBrowserUrl(contextRefreshPath), {
        cache: "no-store",
      });
      if (!response.ok) return;
      const context = await response.json();
      if (
        cleanText(context && context.widgetKey) !== cleanText(bootstrap.widgetKey) ||
        contextMatchId(context) !== expected
      ) {
        return;
      }
      state.reloading = true;
      window.location.reload();
    } catch (_) {
      // The fixed state URL remains match-scoped and hidden until context catches up.
    } finally {
      state.contextRefreshInFlight = false;
    }
  }

  function applyPayload(payload) {
    const nextMatchId = cleanText(payload && payload.matchId) || null;
    if (bootstrapMatchId && nextMatchId && nextMatchId !== bootstrapMatchId) {
      resetRuntime(nextMatchId);
      void refreshPermanentContext(nextMatchId);
      return;
    }
    if (nextMatchId && state.currentMatchId && nextMatchId !== state.currentMatchId) {
      resetRuntime(nextMatchId);
    } else if (nextMatchId) {
      state.currentMatchId = nextMatchId;
    }
    if (!isLiveWorkflow(payload)) {
      state.data = null;
      syncDom();
      return;
    }
    const next = payload && payload.goldFocused && typeof payload.goldFocused === "object"
      ? payload.goldFocused
      : null;
    if (!next) {
      state.data = null;
      syncDom();
      return;
    }
    state.data = preserveCumulativeKills(preserveCumulativeMetrics(next));
    syncDom();
  }

  async function pollState() {
    if (state.pollInFlight || !stateUrl) return;
    state.pollInFlight = true;
    try {
      const response = await window.fetch(resolveBrowserUrl(stateUrl), { cache: "no-store" });
      if (!response.ok) throw new Error(`gold focused state ${response.status}`);
      state.httpConnected = true;
      applyPayload(await response.json());
    } catch (_) {
      state.httpConnected = false;
      syncDom();
    } finally {
      state.pollInFlight = false;
    }
  }

  function applyPlayerPositions(message) {
    if (!state.data || !state.data.roster) return;
    const incoming = Array.isArray(message && message.payload && message.payload.players)
      ? message.payload.players
      : [];
    if (incoming.length === 0) return;
    const players = state.data.roster.players.map(function (current) {
      const update = incoming.find((candidate) => samePlayer(current, candidate));
      if (!update) return current;
      const kills = finiteNumber(update.kills);
      const health = finiteNumber(update.health);
      const alive = typeof update.alive === "boolean" ? update.alive : current.alive;
      const knocked = typeof update.knocked === "boolean" ? update.knocked : current.knocked;
      return {
        ...current,
        kills: kills === null ? current.kills : kills,
        health: health === null ? current.health : health,
        alive,
        knocked,
        status:
          alive === false
            ? "eliminated"
            : knocked
              ? "knocked"
              : alive === true
                ? "alive"
                : "unknown",
      };
    });
    state.data = preserveCumulativeKills({
      ...state.data,
      updatedAt: timestampMs(message.timestamp) || Date.now(),
      stale: false,
      roster: { ...state.data.roster, players },
    });
    syncDom();
  }

  function socketUrl() {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return new URL(`${protocol}//${window.location.host}${bootstrap.wsPath || "/ws"}`).toString();
  }

  function scheduleReconnect() {
    if (state.reconnectTimer !== null) return;
    state.reconnectTimer = window.setTimeout(function () {
      state.reconnectTimer = null;
      connect();
    }, 2_000);
  }

  function connect() {
    if (
      state.socket &&
      (state.socket.readyState === WebSocket.OPEN || state.socket.readyState === WebSocket.CONNECTING)
    ) return;
    const socket = new WebSocket(socketUrl());
    state.socket = socket;
    socket.addEventListener("open", function () {
      if (state.socket !== socket) return;
      state.wsConnected = true;
      syncDom();
    });
    socket.addEventListener("message", function (event) {
      let message = null;
      try {
        message = JSON.parse(event.data);
      } catch (_) {
        return;
      }
      if (message.type === "runtime_reset") {
        resetRuntime(null);
        return;
      }
      if (message.type === "player_positions") {
        applyPlayerPositions(message);
        return;
      }
      if (message.type === "observer_focus" || message.type === "team_branding") {
        void pollState();
      }
    });
    socket.addEventListener("close", function () {
      if (state.socket === socket) state.socket = null;
      state.wsConnected = false;
      syncDom();
      scheduleReconnect();
    });
    socket.addEventListener("error", function () {
      try {
        socket.close();
      } catch (_) {
        // Reconnect scheduling is handled by the close path when available.
      }
    });
  }

  function resizeCanvas() {
    const scale = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
    root.style.setProperty("--gold-canvas-scale", String(Number.isFinite(scale) && scale > 0 ? scale : 1));
  }

  initializeStaticAssets();
  resizeCanvas();
  window.addEventListener("resize", resizeCanvas);
  window.addEventListener(GOLD_OBS_REPLAY_EVENT, function (event) {
    restartGoldMotion(Boolean(event && event.detail && event.detail.reducedMotion));
  });
  window.addEventListener("beforeunload", cancelGoldMotionFrames);
  window.setInterval(pollState, 350);
  window.setInterval(syncDom, 500);
  void pollState();
  connect();
})();
