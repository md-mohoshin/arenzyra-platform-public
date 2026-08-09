(function () {
  const bootstrap = window.__ARENZYRA_LOCAL_WIDGET_BOOTSTRAP__ || {};
  const defaultApiBase = bootstrap.apiBase || "https://api.arenzyra.com";
  const root = document.getElementById("player-photo-root");
  const image = document.getElementById("player-photo-image");

  if (!root || !image) {
    return;
  }

  const OBSERVER_STATE_POLL_MS = 5000;
  const OBSERVER_FOCUS_POLL_MS = 100;
  const RECONNECT_DELAY_MS = 2000;
  const LIVE_STATE_STABILIZE_MS = 0;
  const WS_PLAYER_STALE_MS = 1500;
  const LIVE_WORKFLOW_STATES = new Set(["MATCH_LIVE", "PRODUCTION_LIVE"]);
  const bootstrapMatchId = asString(
    (bootstrap.match && bootstrap.match.id) || bootstrap.matchId || "",
  );
  const localStateUrl = asString(
    bootstrap.localStateUrl || bootstrap.observerStateUrl || "",
  );
  const localFocusUrl = asString(
    bootstrap.localFocusUrl || bootstrap.observerFocusUrl || "",
  );

  const state = {
    currentMatchId: bootstrapMatchId || null,
    focusedPlayer: null,
    focusSignature: "",
    observerTimer: null,
    focusTimer: null,
    reconnectTimer: null,
    renderFrame: null,
    socket: null,
    wsConnected: false,
    focusRequestToken: 0,
    lastImageToken: "",
    lastRenderSignature: "",
    lastObserverState: null,
    focusPollInFlight: false,
    appliedLiveState: null,
    appliedLiveSignature: "",
    pendingLiveState: null,
    pendingLiveToken: 0,
    stabilizeTimer: null,
    staleTimer: null,
    staleWs: false,
    lastFocusedWsSeenAt: 0,
    workflowState: asString(bootstrap.workflowState) || null,
    productionStatus: asString(bootstrap.productionStatus) || null,
    playerAssetsVersion: asString(bootstrap.playerAssetsVersion) || "0:0",
    roundStarted: false,
  };

  function asString(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function toTimestampMs(value) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }

    const raw = asString(value);
    if (!raw) {
      return null;
    }

    const parsed = Date.parse(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function normalizeKey(value) {
    return String(value || "")
      .trim()
      .toLowerCase();
  }

  function getFocusedPlayerId(player) {
    return normalizeKey(player && player.playerId);
  }

  function getFocusedPlayerName(player) {
    return normalizeKey(player && player.name);
  }

  function collectPlayerLookupIds(player) {
    return [
      player && player.playerId,
      player && player.id,
      player && player.playerKey,
      player && player.externalPlayerId,
      player && player.pubgPlayerId,
      player && player.pubgAccountId,
      player && player.playerOpenId,
      player && player.openId,
      player && player.inGameId,
    ]
      .map(normalizeKey)
      .filter(Boolean);
  }

  function resolveApiUrl(pathname) {
    if (!pathname) {
      return null;
    }

    if (/^https?:\/\//i.test(pathname)) {
      return pathname;
    }

    return new URL(pathname, `${defaultApiBase}/`).toString();
  }

  function resolveBrowserUrl(pathname) {
    if (!pathname) {
      return null;
    }

    if (/^https?:\/\//i.test(pathname)) {
      return pathname;
    }

    return new URL(pathname, window.location.href).toString();
  }

  function isDefaultPlayerPhotoUrl(value) {
    const raw = String(value || "")
      .trim()
      .toLowerCase();
    return (
      !raw ||
      raw.includes("default-player") ||
      raw.includes("defaults/default") ||
      raw.includes("placeholder")
    );
  }

  function firstUsefulPlayerPhotoUrl() {
    for (const value of arguments) {
      const raw = String(value || "").trim();
      if (raw && !isDefaultPlayerPhotoUrl(raw)) {
        return raw;
      }
    }
    return "";
  }

  function getExplicitPlayerPhotoUrl(player) {
    return firstUsefulPlayerPhotoUrl(
      player && player.avatarUrl,
      player && player.photoUrl,
    );
  }

  function collectPlayerPhotoCacheIds(player) {
    if (!player || typeof player !== "object") {
      return [];
    }

    return Array.from(
      new Set(
        [
          player.playerId,
          player.id,
          player.playerKey,
          player.externalPlayerId,
          player.pubgPlayerId,
          player.pubgAccountId,
          player.playerOpenId,
          player.openId,
          player.inGameId,
        ]
          .map((value) => String(value || "").trim())
          .filter(Boolean),
      ),
    );
  }

  function getPlayerImageVersionToken(player) {
    return getExplicitPlayerPhotoUrl(player) ||
      collectPlayerPhotoCacheIds(player).length > 0
      ? state.playerAssetsVersion
      : "default";
  }

  function usesVersionedPlayerAsset(player) {
    return Boolean(
      getExplicitPlayerPhotoUrl(player) ||
      collectPlayerPhotoCacheIds(player).length > 0,
    );
  }

  function setVisible(visible) {
    root.hidden = !visible;
    root.classList.toggle("is-visible", visible);
  }

  function setDataset(key, value) {
    if (root.dataset[key] !== value) {
      root.dataset[key] = value;
    }
  }

  function isLiveWorkflowState(value) {
    return LIVE_WORKFLOW_STATES.has(asString(value));
  }

  function hasZoneSignal(zone) {
    return Boolean(
      zone &&
      typeof zone === "object" &&
      (typeof zone.radius === "number" ||
        typeof zone.centerX === "number" ||
        typeof zone.centerY === "number" ||
        typeof zone.x === "number" ||
        typeof zone.y === "number"),
    );
  }

  function hasCircleSignal(circle) {
    if (!circle || typeof circle !== "object") {
      return false;
    }

    return Boolean(
      typeof circle.phase === "number" ||
      toTimestampMs(circle.nextShrinkAt) !== null ||
      hasZoneSignal(circle.safeZone) ||
      hasZoneSignal(circle.nextZone),
    );
  }

  function hasFreshTelemetrySignal(observerState) {
    const leaderboard = Array.isArray(
      observerState && observerState.leaderboard,
    )
      ? observerState.leaderboard
      : [];

    for (const row of leaderboard) {
      const players = Array.isArray(row && row.players) ? row.players : [];
      for (const player of players) {
        if (player && player.lifeTelemetryFresh === true) {
          return true;
        }
      }
    }

    return false;
  }

  function hasRoundStartedSignal(observerState) {
    if (!observerState || typeof observerState !== "object") {
      return false;
    }

    return (
      hasCircleSignal(observerState.circle) ||
      hasFreshTelemetrySignal(observerState)
    );
  }

  function applyPreferredLayout() {
    root.style.left = "calc(50% + clamp(250px, 17vw, 340px))";
    root.style.right = "auto";
    root.style.bottom = "0";
    root.style.width = "clamp(124px, 7.8vw, 154px)";
    root.style.maxWidth = "154px";
  }

  function clearRenderFrame() {
    if (state.renderFrame !== null) {
      window.cancelAnimationFrame(state.renderFrame);
      state.renderFrame = null;
    }
  }

  function clearStabilizeTimer() {
    if (state.stabilizeTimer !== null) {
      window.clearTimeout(state.stabilizeTimer);
      state.stabilizeTimer = null;
    }
  }

  function clearStaleTimer() {
    if (state.staleTimer !== null) {
      window.clearTimeout(state.staleTimer);
      state.staleTimer = null;
    }
  }

  function buildImageCandidates(player) {
    const candidates = [];
    const explicitPhotoUrl = getExplicitPlayerPhotoUrl(player);
    const localPhotoVersion = encodeURIComponent(
      [state.playerAssetsVersion, explicitPhotoUrl].filter(Boolean).join("|") ||
        "0",
    );

    if (explicitPhotoUrl) {
      candidates.push(resolveApiUrl(explicitPhotoUrl));
    }

    for (const playerId of collectPlayerPhotoCacheIds(player)) {
      const localPlayerPhotoPath = `/assets/players/${encodeURIComponent(
        playerId,
      )}.png?v=${localPhotoVersion}`;
      candidates.push(resolveBrowserUrl(localPlayerPhotoPath));
    }

    candidates.push(resolveBrowserUrl("/assets/default-player.svg"));

    return Array.from(
      new Set(
        candidates.filter(
          (candidate) => typeof candidate === "string" && candidate.trim(),
        ),
      ),
    );
  }

  function setImageSource(player) {
    const imageToken = [
      getFocusedPlayerId(player),
      getPlayerImageVersionToken(player),
      getExplicitPlayerPhotoUrl(player),
    ].join("|");

    if (imageToken === state.lastImageToken) {
      return;
    }

    state.lastImageToken = imageToken;
    const candidates = buildImageCandidates(player);

    if (candidates.length === 0) {
      image.removeAttribute("src");
      image.onerror = null;
      return;
    }

    let index = 0;
    image.onerror = function () {
      index += 1;
      if (index >= candidates.length) {
        image.onerror = null;
        return;
      }
      image.src = candidates[index];
    };
    image.src = candidates[index];
  }

  function getStatusKey(player) {
    if (player && player.alive === false) {
      return "eliminated";
    }
    if (player && player.knocked === true) {
      return "knocked";
    }
    return "alive";
  }

  function resolveFocusedPlayerCard(observerState) {
    if (
      observerState &&
      observerState.playerCard &&
      typeof observerState.playerCard === "object"
    ) {
      return observerState.playerCard;
    }

    if (
      observerState &&
      observerState.focusedPlayer &&
      typeof observerState.focusedPlayer === "object"
    ) {
      return observerState.focusedPlayer;
    }

    if (
      observerState &&
      (observerState.playerId ||
        observerState.playerName ||
        observerState.name ||
        observerState.teamId ||
        observerState.teamName)
    ) {
      return observerState;
    }

    return null;
  }

  function findLeaderboardMatch(observerState, playerCard) {
    const leaderboard = Array.isArray(
      observerState && observerState.leaderboard,
    )
      ? observerState.leaderboard
      : [];
    const playerId = normalizeKey(
      playerCard &&
        (playerCard.playerId ||
          playerCard.id ||
          playerCard.playerKey ||
          playerCard.externalPlayerId ||
          playerCard.pubgPlayerId ||
          playerCard.pubgAccountId ||
          playerCard.playerOpenId ||
          playerCard.openId ||
          playerCard.inGameId),
    );
    const playerName = normalizeKey(
      playerCard &&
        (playerCard.playerName || playerCard.name || playerCard.player),
    );

    for (const row of leaderboard) {
      const players = Array.isArray(row && row.players) ? row.players : [];
      for (const player of players) {
        if (playerId && collectPlayerLookupIds(player).includes(playerId)) {
          return {
            row,
            player,
          };
        }
      }
    }

    if (!playerId && playerName) {
      for (const row of leaderboard) {
        const players = Array.isArray(row && row.players) ? row.players : [];
        for (const player of players) {
          if (
            normalizeKey(
              player && (player.playerName || player.name || player.player),
            ) === playerName
          ) {
            return {
              row,
              player,
            };
          }
        }
      }
    }

    return null;
  }

  function normalizeFocusedPlayer(observerState) {
    const playerCard = resolveFocusedPlayerCard(observerState);
    if (!playerCard || typeof playerCard !== "object") {
      return null;
    }

    const matched = findLeaderboardMatch(observerState, playerCard);
    const player = matched ? matched.player : null;
    const realPhotoUrl = firstUsefulPlayerPhotoUrl(
      playerCard.avatarUrl,
      playerCard.photoUrl,
      player && player.avatarUrl,
      player && player.photoUrl,
    );

    return {
      playerId:
        asString(
          (player && (player.playerId || player.id || player.playerKey)) ||
            playerCard.playerId ||
            playerCard.id ||
            playerCard.playerKey ||
            playerCard.externalPlayerId ||
            playerCard.pubgPlayerId ||
            playerCard.pubgAccountId ||
            playerCard.playerOpenId ||
            playerCard.openId ||
            playerCard.inGameId,
        ) || null,
      name:
        asString(
          playerCard.playerName ||
            playerCard.name ||
            (player && (player.playerName || player.name)),
        ) || null,
      avatarUrl: asString(realPhotoUrl) || null,
      photoUrl: asString(realPhotoUrl) || null,
      alive:
        typeof playerCard.alive === "boolean"
          ? playerCard.alive
          : player && typeof player.alive === "boolean"
            ? player.alive
            : null,
      knocked:
        typeof playerCard.knocked === "boolean"
          ? playerCard.knocked
          : player && typeof player.knocked === "boolean"
            ? player.knocked
            : false,
    };
  }

  function getFocusSignature(player) {
    if (!player) {
      return "";
    }

    return [
      getFocusedPlayerId(player),
      getFocusedPlayerName(player),
      String(player.avatarUrl || player.photoUrl || ""),
      String(player.alive),
      String(player.knocked),
    ].join("|");
  }

  function normalizeLivePlayer(player, timestamp, seenAt) {
    if (!player || typeof player !== "object") {
      return null;
    }

    const playerId = normalizeKey(
      player.playerId || player.id || player.playerKey,
    );
    if (!playerId) {
      return null;
    }

    return {
      playerId,
      alive: typeof player.alive === "boolean" ? player.alive : null,
      knocked: typeof player.knocked === "boolean" ? player.knocked : null,
      updatedAt: toTimestampMs(timestamp) ?? Date.now(),
      seenAt: seenAt || Date.now(),
    };
  }

  function getLiveSignature(liveState) {
    if (!liveState) {
      return "";
    }

    return [
      liveState.playerId,
      String(liveState.alive),
      String(liveState.knocked),
    ].join("|");
  }

  function getMergedPlayer() {
    if (!state.focusedPlayer) {
      return null;
    }

    const liveState =
      state.appliedLiveState &&
      state.appliedLiveState.playerId ===
        getFocusedPlayerId(state.focusedPlayer)
        ? state.appliedLiveState
        : null;

    return {
      ...state.focusedPlayer,
      alive:
        liveState && typeof liveState.alive === "boolean"
          ? liveState.alive
          : typeof state.focusedPlayer.alive === "boolean"
            ? state.focusedPlayer.alive
            : null,
      knocked:
        liveState && typeof liveState.knocked === "boolean"
          ? liveState.knocked
          : typeof state.focusedPlayer.knocked === "boolean"
            ? state.focusedPlayer.knocked
            : false,
    };
  }

  function syncDom() {
    if (
      !isLiveWorkflowState(state.workflowState) ||
      state.roundStarted !== true
    ) {
      setVisible(false);
      state.lastRenderSignature = "";
      state.lastImageToken = "";
      return;
    }

    const player = getMergedPlayer();

    if (!player) {
      setVisible(false);
      state.lastRenderSignature = "";
      state.lastImageToken = "";
      return;
    }

    const playerId = getFocusedPlayerId(player);
    const playerName = asString(player.name) || "Focused player photo";
    const statusKey = getStatusKey(player);
    const isOffline = state.wsConnected !== true;
    const isStale = state.staleWs === true && !isOffline;
    const renderSignature = [
      playerId,
      playerName,
      statusKey,
      getPlayerImageVersionToken(player),
      getExplicitPlayerPhotoUrl(player),
      isOffline ? "offline" : "online",
      isStale ? "stale" : "fresh",
    ].join("|");

    if (renderSignature === state.lastRenderSignature) {
      return;
    }

    setDataset("status", statusKey);
    setDataset("offline", isOffline ? "true" : "false");
    setDataset("stale", isStale ? "true" : "false");
    image.alt = playerName;
    setImageSource(player);
    setVisible(true);

    state.lastRenderSignature = renderSignature;
  }

  function scheduleSync() {
    if (state.renderFrame !== null) {
      return;
    }

    state.renderFrame = window.requestAnimationFrame(function () {
      state.renderFrame = null;
      syncDom();
    });
  }

  function flushSync() {
    clearRenderFrame();
    syncDom();
  }

  function resetFocusRuntime(previousPlayerId, nextPlayerId) {
    clearStabilizeTimer();
    clearStaleTimer();
    state.appliedLiveState = null;
    state.appliedLiveSignature = "";
    state.pendingLiveState = null;
    state.pendingLiveToken = 0;
    state.lastFocusedWsSeenAt = 0;
    state.staleWs = false;
    state.lastRenderSignature = "";
    state.lastImageToken = "";
    setDataset("stale", "false");
    console.info("[Widget] PlayerPhoto focus switched", {
      fromPlayerId: previousPlayerId || null,
      toPlayerId: nextPlayerId || null,
    });
  }

  function applyRuntimeReset() {
    const previousPlayerId =
      state.focusedPlayer && state.focusedPlayer.playerId;
    state.wsConnected = false;
    state.focusedPlayer = null;
    state.focusSignature = "";
    resetFocusRuntime(previousPlayerId || null, null);
    flushSync();
  }

  function markFocusedStateStale() {
    if (!state.lastFocusedWsSeenAt || state.staleWs) {
      return;
    }

    const ageMs = Date.now() - state.lastFocusedWsSeenAt;
    if (ageMs < WS_PLAYER_STALE_MS) {
      state.staleTimer = window.setTimeout(
        markFocusedStateStale,
        WS_PLAYER_STALE_MS - ageMs,
      );
      return;
    }

    state.staleWs = true;
    console.info("[Widget] PlayerPhoto stale WS fallback", {
      playerId: getFocusedPlayerId(state.focusedPlayer),
      ageMs,
    });
    scheduleSync();
  }

  function armStaleTimer() {
    clearStaleTimer();
    if (!state.lastFocusedWsSeenAt) {
      return;
    }
    state.staleTimer = window.setTimeout(
      markFocusedStateStale,
      WS_PLAYER_STALE_MS,
    );
  }

  function applyFocusedLiveState(nextState) {
    if (!nextState) {
      return;
    }

    const focusedPlayerId = getFocusedPlayerId(state.focusedPlayer);
    if (!focusedPlayerId || nextState.playerId !== focusedPlayerId) {
      return;
    }

    const nextSignature = getLiveSignature(nextState);
    if (
      nextSignature === state.appliedLiveSignature &&
      state.staleWs !== true
    ) {
      return;
    }

    state.appliedLiveState = nextState;
    state.appliedLiveSignature = nextSignature;
    state.pendingLiveState = null;
    state.staleWs = false;

    console.info("[Widget] PlayerPhoto state stabilized", {
      playerId: nextState.playerId,
      alive: nextState.alive,
      knocked: nextState.knocked,
    });
    scheduleSync();
  }

  function stageFocusedLiveState(nextState) {
    const nextSignature = getLiveSignature(nextState);
    if (nextSignature === getLiveSignature(state.pendingLiveState)) {
      return;
    }

    state.pendingLiveState = nextState;
    const nextToken = state.pendingLiveToken + 1;
    state.pendingLiveToken = nextToken;
    clearStabilizeTimer();
    if (LIVE_STATE_STABILIZE_MS <= 0) {
      applyFocusedLiveState(state.pendingLiveState);
      return;
    }
    state.stabilizeTimer = window.setTimeout(function () {
      state.stabilizeTimer = null;
      if (state.pendingLiveToken !== nextToken) {
        return;
      }
      applyFocusedLiveState(state.pendingLiveState);
    }, LIVE_STATE_STABILIZE_MS);
  }

  function applyFocusedPlayer(nextFocusedPlayer) {
    const previousFocusedPlayer = state.focusedPlayer;
    const previousPlayerId = getFocusedPlayerId(previousFocusedPlayer);
    const nextPlayerId = getFocusedPlayerId(nextFocusedPlayer);
    const focusSwitched = previousPlayerId !== nextPlayerId;

    if (focusSwitched) {
      resetFocusRuntime(previousPlayerId, nextPlayerId);
      state.focusedPlayer = nextFocusedPlayer;
      state.focusSignature = getFocusSignature(nextFocusedPlayer);
      flushSync();
      return;
    }

    const nextSignature = getFocusSignature(nextFocusedPlayer);
    state.focusedPlayer = nextFocusedPlayer;
    if (nextSignature !== state.focusSignature) {
      state.focusSignature = nextSignature;
      scheduleSync();
    }
  }

  function applyObserverFocusPayload(payload) {
    const focus =
      payload && payload.focus && typeof payload.focus === "object"
        ? payload.focus
        : payload && typeof payload === "object"
          ? payload
          : null;
    if (!focus || !state.lastObserverState) {
      return;
    }

    const focusedObserverState = {
      ...state.lastObserverState,
      playerCard: {
        ...focus,
        name: focus.name || focus.playerName || null,
        playerName: focus.playerName || focus.name || null,
      },
    };
    applyFocusedPlayer(normalizeFocusedPlayer(focusedObserverState));
  }

  async function fetchObserverFocusPayload() {
    if (!localFocusUrl) {
      return null;
    }

    const response = await window.fetch(resolveBrowserUrl(localFocusUrl), {
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error(`player photo focus ${response.status}`);
    }
    return response.json();
  }

  async function pollObserverFocus() {
    if (!localFocusUrl || state.focusPollInFlight) {
      return;
    }

    state.focusPollInFlight = true;
    try {
      const payload = await fetchObserverFocusPayload();
      const nextMatchId = asString(payload && payload.matchId) || null;
      if (nextMatchId && nextMatchId !== state.currentMatchId) {
        state.currentMatchId = nextMatchId;
        state.lastObserverState = null;
        applyFocusedPlayer(null);
      }

      state.workflowState =
        asString(payload && payload.workflowState) ||
        state.workflowState ||
        null;
      state.productionStatus =
        asString(payload && payload.productionStatus) ||
        state.productionStatus ||
        null;

      const nextPlayerAssetsVersion =
        asString(payload && payload.playerAssetsVersion) ||
        state.playerAssetsVersion;
      const playerAssetsChanged =
        nextPlayerAssetsVersion !== state.playerAssetsVersion;
      state.playerAssetsVersion = nextPlayerAssetsVersion;

      applyObserverFocusPayload(payload);
      if (playerAssetsChanged && usesVersionedPlayerAsset(getMergedPlayer())) {
        state.lastRenderSignature = "";
        state.lastImageToken = "";
        scheduleSync();
      }
    } catch (_) {
      // Keep the last known focus during transient local observer failures.
    } finally {
      state.focusPollInFlight = false;
    }
  }

  async function fetchObserverStatePayload() {
    if (localStateUrl) {
      const response = await window.fetch(resolveBrowserUrl(localStateUrl), {
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error(`player photo state ${response.status}`);
      }

      const payload = await response.json();
      return {
        matchId: asString(payload && payload.matchId) || null,
        workflowState: asString(payload && payload.workflowState) || null,
        productionStatus: asString(payload && payload.productionStatus) || null,
        playerAssetsVersion:
          asString(payload && payload.playerAssetsVersion) || "0:0",
        observerState:
          payload &&
          payload.observerState &&
          typeof payload.observerState === "object"
            ? payload.observerState
            : null,
      };
    }

    if (!bootstrapMatchId) {
      return {
        matchId: null,
        observerState: null,
      };
    }

    const response = await window.fetch(
      resolveApiUrl(
        `/api/observer/match/${encodeURIComponent(bootstrapMatchId)}/widget-state`,
      ),
      {
        cache: "no-store",
      },
    );
    if (!response.ok) {
      throw new Error(`observer widget state ${response.status}`);
    }

    return {
      matchId: bootstrapMatchId,
      workflowState: asString(bootstrap.workflowState) || null,
      productionStatus: asString(bootstrap.productionStatus) || null,
      playerAssetsVersion: "0:0",
      observerState: await response.json(),
    };
  }

  async function pollObserverState() {
    const requestToken = ++state.focusRequestToken;

    try {
      const payload = await fetchObserverStatePayload();
      if (requestToken !== state.focusRequestToken) {
        return;
      }

      const nextMatchId = asString(payload && payload.matchId) || null;
      if (nextMatchId !== state.currentMatchId) {
        state.currentMatchId = nextMatchId;
        applyFocusedPlayer(null);
      }

      state.workflowState = asString(payload && payload.workflowState) || null;
      state.productionStatus =
        asString(payload && payload.productionStatus) || null;
      const nextPlayerAssetsVersion =
        asString(payload && payload.playerAssetsVersion) || "0:0";
      const playerAssetsChanged =
        nextPlayerAssetsVersion !== state.playerAssetsVersion;
      state.playerAssetsVersion = nextPlayerAssetsVersion;

      const observerState =
        payload &&
        payload.observerState &&
        typeof payload.observerState === "object"
          ? payload.observerState
          : null;
      state.roundStarted = hasRoundStartedSignal(observerState);
      if (!observerState) {
        state.lastObserverState = null;
        applyFocusedPlayer(null);
        return;
      }

      state.lastObserverState = observerState;
      applyFocusedPlayer(normalizeFocusedPlayer(observerState));
      if (playerAssetsChanged && usesVersionedPlayerAsset(getMergedPlayer())) {
        state.lastRenderSignature = "";
        state.lastImageToken = "";
        scheduleSync();
      }
    } catch (_) {
      // Keep the last known focus during transient API failures.
    }
  }

  function buildSocketUrl() {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return new URL(
      `${protocol}//${window.location.host}${bootstrap.wsPath || "/ws"}`,
    ).toString();
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

  function handlePlayerPositions(message) {
    const focusedPlayerId = getFocusedPlayerId(state.focusedPlayer);
    if (!focusedPlayerId) {
      return;
    }

    const players = Array.isArray(message.payload && message.payload.players)
      ? message.payload.players
      : [];
    if (players.length > 0) {
      state.roundStarted = true;
    }
    const receivedAt = Date.now();
    let focusedPacket = null;

    for (const player of players) {
      if (
        normalizeKey(
          player && (player.playerId || player.id || player.playerKey),
        ) !== focusedPlayerId
      ) {
        continue;
      }
      focusedPacket = normalizeLivePlayer(
        player,
        message.timestamp,
        receivedAt,
      );
      break;
    }

    if (!focusedPacket) {
      markFocusedStateStale();
      return;
    }

    state.lastFocusedWsSeenAt = focusedPacket.seenAt;
    if (state.staleWs) {
      state.staleWs = false;
      scheduleSync();
    }
    armStaleTimer();
    stageFocusedLiveState(focusedPacket);
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

    if (message.type === "player_positions") {
      handlePlayerPositions(message);
      return;
    }

    if (message.type === "observer_focus") {
      applyObserverFocusPayload(message.payload);
      return;
    }

    if (message.type === "runtime_reset") {
      applyRuntimeReset();
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

    socket.addEventListener("open", function () {
      if (state.socket !== socket) {
        return;
      }
      state.wsConnected = true;
      console.info("[Widget] PlayerPhoto WS connected");
      scheduleSync();
    });

    socket.addEventListener("message", function (event) {
      handleMessage(event.data);
    });

    socket.addEventListener("close", function () {
      if (state.socket === socket) {
        state.socket = null;
      }
      state.wsConnected = false;
      clearStaleTimer();
      scheduleSync();
      scheduleReconnect();
    });

    socket.addEventListener("error", function () {
      try {
        socket.close();
      } catch (_) {
        // Ignore socket close errors.
      }
    });
  }

  function startObserverStatePolling() {
    if (state.observerTimer !== null) {
      return;
    }

    void pollObserverState();
    state.observerTimer = window.setInterval(function () {
      void pollObserverState();
    }, OBSERVER_STATE_POLL_MS);
  }

  function startObserverFocusPolling() {
    if (!localFocusUrl || state.focusTimer !== null) {
      return;
    }

    void pollObserverFocus();
    state.focusTimer = window.setInterval(function () {
      void pollObserverFocus();
    }, OBSERVER_FOCUS_POLL_MS);
  }

  applyPreferredLayout();
  connect();
  startObserverStatePolling();
  startObserverFocusPolling();

  window.addEventListener("beforeunload", function () {
    clearRenderFrame();
    clearStabilizeTimer();
    clearStaleTimer();

    if (state.observerTimer !== null) {
      window.clearInterval(state.observerTimer);
      state.observerTimer = null;
    }
    if (state.focusTimer !== null) {
      window.clearInterval(state.focusTimer);
      state.focusTimer = null;
    }
    if (state.reconnectTimer !== null) {
      window.clearTimeout(state.reconnectTimer);
      state.reconnectTimer = null;
    }
    if (state.socket) {
      try {
        state.socket.close();
      } catch (_) {
        // Ignore socket close errors.
      }
    }
  });
})();
