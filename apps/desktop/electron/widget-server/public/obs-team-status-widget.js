(function () {
  const bootstrap = window.__ARENZYRA_LOCAL_WIDGET_BOOTSTRAP__ || {};
  const defaultApiBase = bootstrap.apiBase || "https://api.arenzyra.com";
  const root = document.getElementById("team-status-root");
  const teamEl = document.getElementById("team-status-team");
  const connectionEl = document.getElementById("team-status-connection");
  const stripEl = document.getElementById("team-status-strip");

  if (!root || !teamEl || !connectionEl || !stripEl) {
    return;
  }

  const OBSERVER_POLL_MS = 2500;
  const RECONNECT_DELAY_MS = 2000;
  const HP_ANIMATION_MS = 160;
  const LIVE_STATE_STABILIZE_MS = 120;
  const WS_PLAYER_STALE_MS = 1500;
  const MAX_TRACKED_KILL_IDS = 512;

  const matchId = asString(
    (bootstrap.match && bootstrap.match.id) || bootstrap.matchId,
  );
  const killFeedApiBase = normalizeBaseUrl(bootstrap.apiBase);

  const state = {
    team: null,
    teamSignature: "",
    structureSignature: "",
    teamRuntimeVersion: 0,
    observerTimer: null,
    reconnectTimer: null,
    renderFrame: null,
    socket: null,
    wsConnected: false,
    killSocket: null,
    focusRequestToken: 0,
    lastHeaderSignature: "",
    playerRefsById: new Map(),
    appliedLiveById: new Map(),
    appliedLiveSignatureById: new Map(),
    pendingLiveById: new Map(),
    pendingLiveSignatureById: new Map(),
    pendingLiveTokenById: new Map(),
    stabilizeTimerById: new Map(),
    staleTimerById: new Map(),
    stalePlayerIds: new Set(),
    lastSeenAtById: new Map(),
    optimisticKillBoostById: new Map(),
    processedKillIds: new Set(),
    latestKillFeedSequence: -1,
    latestKillFeedAppliedAt: 0,
    queuedPlayerIds: new Set(),
    headerQueued: false,
    structureQueued: false,
  };

  function asString(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function toDisplayText(value, fallback) {
    const normalized = asString(value);
    return normalized || fallback;
  }

  function toFiniteNumber(value) {
    const numeric =
      typeof value === "number"
        ? value
        : typeof value === "string"
          ? Number(value)
          : NaN;
    return Number.isFinite(numeric) ? numeric : null;
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

  function clampHealth(value) {
    const numeric = toFiniteNumber(value);
    if (numeric === null) {
      return null;
    }
    return Math.max(0, Math.min(100, numeric));
  }

  function normalizeKey(value) {
    return String(value || "")
      .trim()
      .toLowerCase();
  }

  function normalizeBaseUrl(value) {
    const raw = asString(value);
    if (!raw) {
      return window.location.origin;
    }

    try {
      const parsed = new URL(raw.includes("://") ? raw : `http://${raw}`);
      return parsed.toString().replace(/\/$/, "");
    } catch (_) {
      return window.location.origin;
    }
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

  function setVisible(visible) {
    root.hidden = !visible;
    root.classList.toggle("is-visible", visible);
  }

  function setText(node, value) {
    if (node.textContent !== value) {
      node.textContent = value;
    }
  }

  function setHidden(node, hidden) {
    if (node.hidden !== hidden) {
      node.hidden = hidden;
    }
  }

  function setElementData(node, key, value) {
    if (node.dataset[key] !== value) {
      node.dataset[key] = value;
    }
  }

  function clearRenderFrame() {
    if (state.renderFrame !== null) {
      window.cancelAnimationFrame(state.renderFrame);
      state.renderFrame = null;
    }
  }

  function clearQueuedRenders() {
    state.queuedPlayerIds.clear();
    state.headerQueued = false;
    state.structureQueued = false;
  }

  function clearTimeoutMap(map) {
    for (const timer of map.values()) {
      window.clearTimeout(timer);
    }
    map.clear();
  }

  function clearPlayerStabilizeTimer(playerKey) {
    const timer = state.stabilizeTimerById.get(playerKey);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      state.stabilizeTimerById.delete(playerKey);
    }
  }

  function clearPlayerStaleTimer(playerKey) {
    const timer = state.staleTimerById.get(playerKey);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      state.staleTimerById.delete(playerKey);
    }
  }

  function cancelPlayerHpAnimation(refs) {
    if (refs.hpAnimationFrame !== null) {
      window.cancelAnimationFrame(refs.hpAnimationFrame);
      refs.hpAnimationFrame = null;
    }
  }

  function renderPlayerHp(refs, value, isKnown) {
    const numeric = isKnown ? clampHealth(value) || 0 : 0;
    const width = isKnown ? `${numeric}%` : "0%";
    const label = isKnown ? String(Math.round(numeric)) : "--";

    setElementData(refs.card, "hpKnown", isKnown ? "true" : "false");
    if (refs.hpFillEl.style.width !== width) {
      refs.hpFillEl.style.width = width;
    }
    setText(refs.hpValueEl, label);
  }

  function resetPlayerHp(refs) {
    cancelPlayerHpAnimation(refs);
    refs.displayedHealth = null;
    renderPlayerHp(refs, 0, false);
  }

  function stepPlayerHpAnimation(refs, frameTime) {
    const elapsed = Math.max(0, frameTime - refs.hpAnimationStartedAt);
    const progress = Math.min(1, elapsed / HP_ANIMATION_MS);
    const eased = 1 - Math.pow(1 - progress, 3);
    const nextValue =
      refs.hpAnimationFrom +
      (refs.hpAnimationTo - refs.hpAnimationFrom) * eased;

    refs.displayedHealth = nextValue;
    renderPlayerHp(refs, nextValue, true);

    if (progress >= 1) {
      refs.displayedHealth = refs.hpAnimationTo;
      refs.hpAnimationFrame = null;
      renderPlayerHp(refs, refs.hpAnimationTo, true);
      return;
    }

    refs.hpAnimationFrame = window.requestAnimationFrame(
      function (nextFrameTime) {
        stepPlayerHpAnimation(refs, nextFrameTime);
      },
    );
  }

  function updatePlayerHp(refs, nextHealth, snap) {
    const health = clampHealth(nextHealth);
    if (health === null) {
      resetPlayerHp(refs);
      return;
    }

    if (
      snap ||
      refs.displayedHealth === null ||
      Math.abs(refs.displayedHealth - health) < 0.1
    ) {
      cancelPlayerHpAnimation(refs);
      refs.displayedHealth = health;
      renderPlayerHp(refs, health, true);
      return;
    }

    cancelPlayerHpAnimation(refs);
    refs.hpAnimationFrom = refs.displayedHealth;
    refs.hpAnimationTo = health;
    refs.hpAnimationStartedAt = window.performance.now();
    refs.hpAnimationFrame = window.requestAnimationFrame(function (frameTime) {
      stepPlayerHpAnimation(refs, frameTime);
    });
  }

  function buildImageCandidates(player) {
    const candidates = [];
    if (player && player.playerId) {
      const localPlayerPhotoPath = `/assets/players/${encodeURIComponent(player.playerId)}.png`;
      candidates.push(resolveBrowserUrl(localPlayerPhotoPath));
      candidates.push(resolveApiUrl(localPlayerPhotoPath));
    }
    if (player && player.avatarUrl) {
      candidates.push(resolveApiUrl(player.avatarUrl));
    }
    if (player && player.photoUrl) {
      candidates.push(resolveApiUrl(player.photoUrl));
    }

    candidates.push(resolveBrowserUrl("/assets/default-player.svg"));
    candidates.push(resolveApiUrl("/assets/default-player.png"));
    candidates.push(resolveApiUrl("/assets/defaults/default-player.png"));

    return Array.from(
      new Set(
        candidates.filter(
          (candidate) => typeof candidate === "string" && candidate.trim(),
        ),
      ),
    );
  }

  function setPlayerImageSource(refs, player) {
    const imageToken = [
      player.playerId || player.playerKey,
      String(player.avatarUrl || player.photoUrl || "").trim(),
    ].join("|");

    if (imageToken === refs.lastImageToken) {
      return;
    }

    refs.lastImageToken = imageToken;
    const candidates = buildImageCandidates(player);

    if (candidates.length === 0) {
      refs.imageEl.removeAttribute("src");
      refs.imageEl.onerror = null;
      return;
    }

    let index = 0;
    refs.imageEl.onerror = function () {
      index += 1;
      if (index >= candidates.length) {
        refs.imageEl.onerror = null;
        return;
      }
      refs.imageEl.src = candidates[index];
    };
    refs.imageEl.src = candidates[index];
  }

  function getStatus(player) {
    if (player.alive === false || player.hasDied === true) {
      return {
        key: "eliminated",
        label: "ELIMINATED",
      };
    }

    if (player.knocked === true) {
      return {
        key: "knocked",
        label: "KNOCKED",
      };
    }

    return {
      key: "alive",
      label: "ALIVE",
    };
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
        (playerCard.playerId || playerCard.id || playerCard.playerKey),
    );
    const playerName = normalizeKey(
      playerCard &&
        (playerCard.playerName || playerCard.name || playerCard.player),
    );

    for (const row of leaderboard) {
      const players = Array.isArray(row && row.players) ? row.players : [];
      for (const player of players) {
        const matchesPlayerId =
          playerId &&
          normalizeKey(
            player && (player.playerId || player.id || player.playerKey),
          ) === playerId;
        const matchesName =
          playerName &&
          normalizeKey(
            player && (player.playerName || player.name || player.player),
          ) === playerName;

        if (!matchesPlayerId && !matchesName) {
          continue;
        }

        return {
          row,
          player,
        };
      }
    }

    return null;
  }

  function findTeamRow(leaderboard, options) {
    const teamId = normalizeKey(options && options.teamId);
    const teamName = normalizeKey(options && options.teamName);
    const teamTag = normalizeKey(options && options.teamTag);

    for (const row of leaderboard) {
      if (!row || typeof row !== "object") {
        continue;
      }

      if (teamId && normalizeKey(row.teamId) === teamId) {
        return row;
      }
      if (teamName && normalizeKey(row.teamName) === teamName) {
        return row;
      }
      if (teamTag && normalizeKey(row.teamTag) === teamTag) {
        return row;
      }
    }

    return null;
  }

  function normalizeBackendPlayer(player, index) {
    if (!player || typeof player !== "object") {
      return null;
    }

    const playerName =
      asString(player.playerName || player.name || player.player) ||
      `Player ${index + 1}`;
    const playerId =
      asString(player.playerId || player.id || player.playerKey) || null;
    const playerKey =
      normalizeKey(playerId) || normalizeKey(playerName) || `slot-${index + 1}`;
    const rawSlotIndex = toFiniteNumber(
      player.slotIndex !== undefined
        ? player.slotIndex
        : player.slot !== undefined
          ? player.slot
          : null,
    );
    const slotIndex =
      rawSlotIndex === null ? null : Math.max(0, Math.round(rawSlotIndex));

    return {
      playerId,
      playerKey,
      slotIndex,
      playerName,
      playerNameKey: normalizeKey(playerName),
      avatarUrl:
        asString(player.avatarUrl || player.photoUrl || player.playerPhoto) ||
        null,
      photoUrl:
        asString(player.playerPhoto || player.photoUrl || player.avatarUrl) ||
        null,
      kills: Math.max(0, Math.round(toFiniteNumber(player.kills) || 0)),
      alive: typeof player.alive === "boolean" ? player.alive : null,
      knocked: typeof player.knocked === "boolean" ? player.knocked : false,
      health: clampHealth(player.health),
      hasDied: player.hasDied === true,
    };
  }

  function comparePlayersForStableOrder(left, right) {
    const leftSlot =
      left && typeof left.slotIndex === "number" ? left.slotIndex : null;
    const rightSlot =
      right && typeof right.slotIndex === "number" ? right.slotIndex : null;

    if (leftSlot !== null && rightSlot !== null && leftSlot !== rightSlot) {
      return leftSlot - rightSlot;
    }
    if (leftSlot !== null && rightSlot === null) {
      return -1;
    }
    if (leftSlot === null && rightSlot !== null) {
      return 1;
    }

    const leftId = asString(left && (left.playerId || left.playerKey));
    const rightId = asString(right && (right.playerId || right.playerKey));
    return leftId.localeCompare(rightId);
  }

  function buildPlayerLookups(players) {
    const byId = new Map();
    const byName = new Map();

    for (const player of players) {
      const playerIdKey = normalizeKey(player.playerId);
      if (playerIdKey && !byId.has(playerIdKey)) {
        byId.set(playerIdKey, player.playerKey);
      }
      if (player.playerNameKey && !byName.has(player.playerNameKey)) {
        byName.set(player.playerNameKey, player.playerKey);
      }
    }

    return {
      byId,
      byName,
    };
  }

  function resolveFocusedPlayerKey(focusedPlayerCard, lookups, fallbackPlayer) {
    const focusedPlayerId = normalizeKey(
      focusedPlayerCard &&
        (focusedPlayerCard.playerId ||
          focusedPlayerCard.id ||
          focusedPlayerCard.playerKey),
    );
    const focusedPlayerName = normalizeKey(
      focusedPlayerCard &&
        (focusedPlayerCard.playerName ||
          focusedPlayerCard.name ||
          focusedPlayerCard.player),
    );

    if (focusedPlayerId && lookups.byId.has(focusedPlayerId)) {
      return lookups.byId.get(focusedPlayerId);
    }
    if (focusedPlayerName && lookups.byName.has(focusedPlayerName)) {
      return lookups.byName.get(focusedPlayerName);
    }

    return fallbackPlayer ? fallbackPlayer.playerKey : null;
  }

  function normalizeTeamState(observerState) {
    const leaderboard = Array.isArray(
      observerState && observerState.leaderboard,
    )
      ? observerState.leaderboard
      : [];
    const focusedPlayerCard = resolveFocusedPlayerCard(observerState);
    const matchedFocused = focusedPlayerCard
      ? findLeaderboardMatch(observerState, focusedPlayerCard)
      : null;
    const previousTeam = state.team;

    let row = matchedFocused ? matchedFocused.row : null;
    if (!row) {
      row =
        findTeamRow(leaderboard, {
          teamId: focusedPlayerCard && focusedPlayerCard.teamId,
          teamName: focusedPlayerCard && focusedPlayerCard.teamName,
          teamTag: focusedPlayerCard && focusedPlayerCard.teamTag,
        }) ||
        findTeamRow(leaderboard, {
          teamId: previousTeam && previousTeam.teamId,
          teamName: previousTeam && previousTeam.teamName,
          teamTag: previousTeam && previousTeam.teamTag,
        });
    }

    const rawPlayers =
      row && Array.isArray(row.players) && row.players.length > 0
        ? row.players
        : focusedPlayerCard
          ? [focusedPlayerCard]
          : [];
    const players = rawPlayers.map(normalizeBackendPlayer).filter(Boolean);
    players.sort(comparePlayersForStableOrder);

    if (!row && players.length === 0) {
      return null;
    }

    const lookups = buildPlayerLookups(players);
    return {
      teamId:
        asString(
          (row && row.teamId) ||
            (focusedPlayerCard && focusedPlayerCard.teamId),
        ) || null,
      teamName:
        asString(
          (row && row.teamName) ||
            (focusedPlayerCard && focusedPlayerCard.teamName),
        ) || null,
      teamTag:
        asString(
          (row && row.teamTag) ||
            (focusedPlayerCard && focusedPlayerCard.teamTag),
        ) || null,
      focusedPlayerKey: resolveFocusedPlayerKey(
        focusedPlayerCard,
        lookups,
        players[0] || null,
      ),
      players,
      lookupById: lookups.byId,
      lookupByName: lookups.byName,
    };
  }

  function getStructureSignature(team) {
    if (!team) {
      return "";
    }

    return [
      normalizeKey(team.teamId),
      ...team.players.map((player) => player.playerKey),
    ].join("|");
  }

  function getTeamSignature(team) {
    if (!team) {
      return "";
    }

    return [
      getStructureSignature(team),
      team.focusedPlayerKey || "",
      ...team.players.map((player) =>
        [
          player.playerKey,
          player.playerName,
          player.kills,
          player.avatarUrl || player.photoUrl || "",
          String(player.alive),
          String(player.knocked),
          player.health === null ? "null" : String(Math.round(player.health)),
          String(player.hasDied),
        ].join("~"),
      ),
    ].join("|");
  }

  function getPlayerDebugId(playerKey) {
    if (!state.team) {
      return playerKey;
    }

    const player = state.team.players.find(
      (entry) => entry.playerKey === playerKey,
    );
    return (player && player.playerId) || playerKey;
  }

  function disposePlayerRefs(refs) {
    cancelPlayerHpAnimation(refs);
    if (refs.card.parentNode) {
      refs.card.parentNode.removeChild(refs.card);
    }
  }

  function disposeAllPlayerRefs() {
    for (const refs of state.playerRefsById.values()) {
      disposePlayerRefs(refs);
    }
    state.playerRefsById.clear();
  }

  function resetTeamRuntime() {
    state.teamRuntimeVersion += 1;
    clearTimeoutMap(state.stabilizeTimerById);
    clearTimeoutMap(state.staleTimerById);
    state.appliedLiveById.clear();
    state.appliedLiveSignatureById.clear();
    state.pendingLiveById.clear();
    state.pendingLiveSignatureById.clear();
    state.pendingLiveTokenById.clear();
    state.stalePlayerIds.clear();
    state.lastSeenAtById.clear();
    state.optimisticKillBoostById.clear();
    state.lastHeaderSignature = "";
    clearQueuedRenders();
    disposeAllPlayerRefs();
  }

  function applyRuntimeReset() {
    state.wsConnected = false;
    resetTeamRuntime();
    scheduleSync();
  }

  function reconcileOptimisticKills(previousTeam, nextTeam) {
    if (!previousTeam || !nextTeam) {
      return;
    }

    const previousKillsById = new Map(
      previousTeam.players.map((player) => [player.playerKey, player.kills]),
    );
    const nextPlayerIds = new Set(
      nextTeam.players.map((player) => player.playerKey),
    );

    for (const player of nextTeam.players) {
      const previousKills = previousKillsById.get(player.playerKey);
      const optimisticKills =
        state.optimisticKillBoostById.get(player.playerKey) || 0;
      if (typeof previousKills !== "number" || optimisticKills <= 0) {
        continue;
      }

      const previousDisplayedKills = previousKills + optimisticKills;
      const remaining = Math.max(
        0,
        Math.min(optimisticKills, previousDisplayedKills - player.kills),
      );
      if (remaining > 0) {
        if (remaining !== optimisticKills) {
          console.info("[Widget] TeamStatus kill sync corrected", {
            playerId: getPlayerDebugId(player.playerKey),
            backendKills: player.kills,
            localBoostKills: remaining,
          });
          state.optimisticKillBoostById.set(player.playerKey, remaining);
        }
      } else {
        console.info("[Widget] TeamStatus kill sync corrected", {
          playerId: getPlayerDebugId(player.playerKey),
          backendKills: player.kills,
          localBoostKills: 0,
        });
        state.optimisticKillBoostById.delete(player.playerKey);
      }
    }

    for (const playerKey of Array.from(state.optimisticKillBoostById.keys())) {
      if (!nextPlayerIds.has(playerKey)) {
        state.optimisticKillBoostById.delete(playerKey);
      }
    }
  }

  function createPlayerRefs(playerKey) {
    const card = document.createElement("article");
    card.className = "team-status-player";
    card.dataset.playerId = playerKey;
    card.dataset.status = "alive";
    card.dataset.focused = "false";
    card.dataset.stale = "false";
    card.dataset.hpKnown = "false";

    const media = document.createElement("div");
    media.className = "team-status-player-media";

    const imageEl = document.createElement("img");
    imageEl.alt = "Team player";
    imageEl.draggable = false;
    media.appendChild(imageEl);

    const body = document.createElement("div");
    body.className = "team-status-player-body";

    const nameEl = document.createElement("div");
    nameEl.className = "team-status-player-name";
    body.appendChild(nameEl);

    const meta = document.createElement("div");
    meta.className = "team-status-player-meta";

    const kills = document.createElement("div");
    kills.className = "team-status-player-kills";
    const killsValueEl = document.createElement("span");
    killsValueEl.className = "team-status-player-kills-value";
    const killsLabelEl = document.createElement("span");
    killsLabelEl.className = "team-status-player-kills-label";
    killsLabelEl.textContent = "KILLS";
    kills.appendChild(killsValueEl);
    kills.appendChild(killsLabelEl);

    const statusEl = document.createElement("div");
    statusEl.className = "team-status-player-status";
    meta.appendChild(kills);
    meta.appendChild(statusEl);
    body.appendChild(meta);

    const hpBlock = document.createElement("div");
    hpBlock.className = "team-status-player-hp";

    const hpHeader = document.createElement("div");
    hpHeader.className = "team-status-player-hp-header";
    const hpLabelEl = document.createElement("span");
    hpLabelEl.className = "team-status-player-hp-label";
    hpLabelEl.textContent = "HP";
    const hpValueEl = document.createElement("span");
    hpValueEl.className = "team-status-player-hp-value";
    hpHeader.appendChild(hpLabelEl);
    hpHeader.appendChild(hpValueEl);

    const hpRailEl = document.createElement("div");
    hpRailEl.className = "team-status-player-hp-rail";
    const hpFillEl = document.createElement("div");
    hpFillEl.className = "team-status-player-hp-fill";
    hpRailEl.appendChild(hpFillEl);

    hpBlock.appendChild(hpHeader);
    hpBlock.appendChild(hpRailEl);
    body.appendChild(hpBlock);

    card.appendChild(media);
    card.appendChild(body);

    return {
      card,
      imageEl,
      nameEl,
      killsValueEl,
      statusEl,
      hpValueEl,
      hpFillEl,
      displayedHealth: null,
      hpAnimationFrame: null,
      hpAnimationFrom: 0,
      hpAnimationTo: 0,
      hpAnimationStartedAt: 0,
      lastImageToken: "",
      lastRenderSignature: "",
    };
  }

  function ensurePlayerCards(players) {
    const desiredPlayerIds = new Set();

    for (const player of players) {
      desiredPlayerIds.add(player.playerKey);

      let refs = state.playerRefsById.get(player.playerKey);
      if (!refs) {
        refs = createPlayerRefs(player.playerKey);
        state.playerRefsById.set(player.playerKey, refs);
      }

      stripEl.appendChild(refs.card);
    }

    for (const [playerKey, refs] of Array.from(
      state.playerRefsById.entries(),
    )) {
      if (desiredPlayerIds.has(playerKey)) {
        continue;
      }

      clearPlayerStabilizeTimer(playerKey);
      clearPlayerStaleTimer(playerKey);
      state.appliedLiveById.delete(playerKey);
      state.appliedLiveSignatureById.delete(playerKey);
      state.pendingLiveById.delete(playerKey);
      state.pendingLiveSignatureById.delete(playerKey);
      state.pendingLiveTokenById.delete(playerKey);
      state.stalePlayerIds.delete(playerKey);
      state.lastSeenAtById.delete(playerKey);
      state.optimisticKillBoostById.delete(playerKey);
      disposePlayerRefs(refs);
      state.playerRefsById.delete(playerKey);
    }
  }

  function getMergedPlayer(player) {
    const liveState = state.appliedLiveById.get(player.playerKey) || null;
    const alive =
      liveState && typeof liveState.alive === "boolean"
        ? liveState.alive
        : player.hasDied === true
          ? false
          : typeof player.alive === "boolean"
            ? player.alive
            : null;
    const knocked =
      alive === false
        ? false
        : liveState && typeof liveState.knocked === "boolean"
          ? liveState.knocked
          : player.knocked === true;

    return {
      ...player,
      alive,
      knocked,
      health:
        liveState && liveState.health !== null
          ? liveState.health
          : alive === false
            ? 0
            : player.health,
      stale: state.stalePlayerIds.has(player.playerKey),
      focused: state.team && state.team.focusedPlayerKey === player.playerKey,
      kills: Math.max(
        0,
        player.kills +
          (state.optimisticKillBoostById.get(player.playerKey) || 0),
      ),
    };
  }

  function queueHeaderUpdate() {
    state.headerQueued = true;
  }

  function queuePlayerUpdate(playerKey) {
    if (playerKey) {
      state.queuedPlayerIds.add(playerKey);
    }
  }

  function queueAllPlayerUpdates(players) {
    for (const player of players) {
      queuePlayerUpdate(player.playerKey);
    }
  }

  function queueStructureUpdate(players) {
    state.structureQueued = true;
    queueHeaderUpdate();
    queueAllPlayerUpdates(players);
  }

  function renderHeader() {
    if (!state.team) {
      return;
    }

    const teamLabel = toDisplayText(
      state.team.teamTag || state.team.teamName,
      "TEAM",
    );
    const connectionLabel = state.wsConnected ? "" : "WS OFFLINE";
    const headerSignature = [teamLabel, connectionLabel].join("|");

    if (headerSignature === state.lastHeaderSignature) {
      return;
    }

    setText(teamEl, teamLabel);
    setText(connectionEl, connectionLabel);
    setHidden(connectionEl, !connectionLabel);
    setElementData(root, "offline", state.wsConnected ? "false" : "true");
    state.lastHeaderSignature = headerSignature;
  }

  function renderPlayerCard(player) {
    const refs = state.playerRefsById.get(player.playerKey);
    if (!refs) {
      return false;
    }

    const mergedPlayer = getMergedPlayer(player);
    const status = getStatus(mergedPlayer);
    const renderSignature = [
      mergedPlayer.playerName,
      mergedPlayer.kills,
      status.key,
      mergedPlayer.health === null
        ? "null"
        : String(Math.round(mergedPlayer.health)),
      String(mergedPlayer.focused),
      String(mergedPlayer.stale),
      mergedPlayer.avatarUrl || mergedPlayer.photoUrl || "",
    ].join("|");

    if (renderSignature === refs.lastRenderSignature) {
      return false;
    }

    setElementData(refs.card, "status", status.key);
    setElementData(
      refs.card,
      "focused",
      mergedPlayer.focused ? "true" : "false",
    );
    setElementData(refs.card, "stale", mergedPlayer.stale ? "true" : "false");
    setText(refs.nameEl, toDisplayText(mergedPlayer.playerName, "PLAYER"));
    setText(refs.killsValueEl, String(Math.max(0, mergedPlayer.kills)));
    setText(refs.statusEl, status.label);
    refs.imageEl.alt = toDisplayText(mergedPlayer.playerName, "Player");
    setPlayerImageSource(refs, mergedPlayer);
    updatePlayerHp(refs, mergedPlayer.health, refs.lastRenderSignature === "");
    refs.lastRenderSignature = renderSignature;
    return true;
  }

  function syncWidget() {
    if (!state.team || state.team.players.length === 0) {
      clearQueuedRenders();
      setVisible(false);
      return;
    }

    if (state.structureQueued) {
      ensurePlayerCards(state.team.players);
      queueAllPlayerUpdates(state.team.players);
      state.structureQueued = false;
    }

    if (state.headerQueued || state.lastHeaderSignature === "") {
      renderHeader();
    }
    state.headerQueued = false;

    const queuedPlayerIds = Array.from(state.queuedPlayerIds);
    state.queuedPlayerIds.clear();

    let appliedPlayerUpdates = 0;
    if (queuedPlayerIds.length > 0) {
      const playersById = new Map(
        state.team.players.map((player) => [player.playerKey, player]),
      );

      for (const playerKey of queuedPlayerIds) {
        const player = playersById.get(playerKey);
        if (!player) {
          continue;
        }

        if (renderPlayerCard(player)) {
          appliedPlayerUpdates += 1;
        }
      }
    }

    if (queuedPlayerIds.length > 1 || appliedPlayerUpdates > 1) {
      console.info("[Widget] TeamStatus batch update applied", {
        teamId: state.team.teamId,
        queuedPlayerCount: queuedPlayerIds.length,
        appliedPlayerCount: appliedPlayerUpdates,
      });
    }

    setVisible(true);
  }

  function scheduleSync() {
    if (state.renderFrame !== null) {
      return;
    }

    state.renderFrame = window.requestAnimationFrame(function () {
      state.renderFrame = null;
      syncWidget();
    });
  }

  function flushSync() {
    clearRenderFrame();
    syncWidget();
  }

  function applyTeamState(nextTeam) {
    if (!nextTeam) {
      if (state.team || state.playerRefsById.size > 0) {
        state.team = null;
        state.teamSignature = "";
        state.structureSignature = "";
        state.lastHeaderSignature = "";
        resetTeamRuntime();
        flushSync();
      }
      return;
    }

    const previousTeam = state.team;
    const previousTeamId = normalizeKey(previousTeam && previousTeam.teamId);
    const nextTeamId = normalizeKey(nextTeam.teamId);
    const teamSwitched = Boolean(previousTeam && previousTeamId !== nextTeamId);
    const nextStructureSignature = getStructureSignature(nextTeam);
    const structureChanged =
      nextStructureSignature !== state.structureSignature;

    if (structureChanged) {
      state.structureSignature = nextStructureSignature;
      resetTeamRuntime();
    } else {
      reconcileOptimisticKills(previousTeam, nextTeam);
    }

    const nextTeamSignature = getTeamSignature(nextTeam);
    if (!structureChanged && nextTeamSignature === state.teamSignature) {
      return;
    }

    state.team = nextTeam;
    state.teamSignature = nextTeamSignature;
    queueHeaderUpdate();
    queueAllPlayerUpdates(nextTeam.players);

    if (teamSwitched) {
      console.info("[Widget] TeamStatus team switched", {
        previousTeamId: previousTeam.teamId,
        nextTeamId: nextTeam.teamId,
        playerCount: nextTeam.players.length,
      });
    }
    console.info("[Widget] TeamStatus state updated", {
      teamId: nextTeam.teamId,
      focusedPlayerId: nextTeam.focusedPlayerKey,
      playerCount: nextTeam.players.length,
    });

    if (structureChanged) {
      queueStructureUpdate(nextTeam.players);
      flushSync();
      return;
    }

    scheduleSync();
  }

  async function pollObserverState() {
    if (!matchId) {
      applyTeamState(null);
      return;
    }

    const requestToken = ++state.focusRequestToken;

    try {
      const response = await window.fetch(
        resolveApiUrl(
          `/api/observer/match/${encodeURIComponent(matchId)}/widget-state`,
        ),
        {
          cache: "no-store",
        },
      );
      if (!response.ok) {
        throw new Error(`observer widget state ${response.status}`);
      }

      const observerState = await response.json();
      if (requestToken !== state.focusRequestToken) {
        return;
      }

      applyTeamState(normalizeTeamState(observerState));
    } catch (_) {
      // Keep the last known team during transient API failures.
    }
  }

  function getPlayerLiveSignature(liveState) {
    if (!liveState) {
      return "";
    }

    return [
      liveState.playerKey,
      String(liveState.alive),
      String(liveState.knocked),
      liveState.health === null ? "null" : String(Math.round(liveState.health)),
    ].join("|");
  }

  function normalizeLivePlayer(playerKey, player, timestamp, seenAt) {
    return {
      playerKey,
      alive: typeof player.alive === "boolean" ? player.alive : null,
      knocked: typeof player.knocked === "boolean" ? player.knocked : null,
      health: clampHealth(
        player.health !== undefined
          ? player.health
          : player.hp !== undefined
            ? player.hp
            : null,
      ),
      updatedAt: toTimestampMs(timestamp) ?? Date.now(),
      seenAt,
    };
  }

  function playerBelongsToActiveTeam(playerKey) {
    return Boolean(
      state.team &&
      state.team.players.some((player) => player.playerKey === playerKey),
    );
  }

  function markPlayerStale(playerKey, teamRuntimeVersion) {
    if (
      teamRuntimeVersion !== state.teamRuntimeVersion ||
      !state.team ||
      !playerBelongsToActiveTeam(playerKey)
    ) {
      return;
    }

    const lastSeenAt = state.lastSeenAtById.get(playerKey) || 0;
    if (!lastSeenAt || state.stalePlayerIds.has(playerKey)) {
      return;
    }

    const ageMs = Date.now() - lastSeenAt;
    if (ageMs < WS_PLAYER_STALE_MS) {
      const timer = window.setTimeout(function () {
        markPlayerStale(playerKey, teamRuntimeVersion);
      }, WS_PLAYER_STALE_MS - ageMs);
      state.staleTimerById.set(playerKey, timer);
      return;
    }

    state.staleTimerById.delete(playerKey);
    state.stalePlayerIds.add(playerKey);
    console.info("[Widget] TeamStatus player stale detected", {
      playerId: getPlayerDebugId(playerKey),
      ageMs,
    });
    queuePlayerUpdate(playerKey);
    scheduleSync();
  }

  function armPlayerStaleTimer(playerKey) {
    clearPlayerStaleTimer(playerKey);
    if (
      !state.team ||
      !state.lastSeenAtById.has(playerKey) ||
      !playerBelongsToActiveTeam(playerKey)
    ) {
      return;
    }

    const teamRuntimeVersion = state.teamRuntimeVersion;
    const timer = window.setTimeout(function () {
      markPlayerStale(playerKey, teamRuntimeVersion);
    }, WS_PLAYER_STALE_MS);
    state.staleTimerById.set(playerKey, timer);
  }

  function applyPlayerLiveState(playerKey, nextState) {
    if (!nextState || !state.team || !state.playerRefsById.has(playerKey)) {
      return;
    }

    const nextSignature = getPlayerLiveSignature(nextState);
    if (
      nextSignature === state.appliedLiveSignatureById.get(playerKey) &&
      !state.stalePlayerIds.has(playerKey)
    ) {
      return;
    }

    state.appliedLiveById.set(playerKey, nextState);
    state.appliedLiveSignatureById.set(playerKey, nextSignature);
    state.pendingLiveById.delete(playerKey);
    state.pendingLiveSignatureById.delete(playerKey);
    state.stalePlayerIds.delete(playerKey);
    console.info("[Widget] TeamStatus player stabilized", {
      playerId: getPlayerDebugId(playerKey),
      health: nextState.health,
      alive: nextState.alive,
      knocked: nextState.knocked,
    });
    queuePlayerUpdate(playerKey);
    scheduleSync();
  }

  function stagePlayerLiveState(playerKey, nextState) {
    const nextSignature = getPlayerLiveSignature(nextState);
    if (nextSignature === state.pendingLiveSignatureById.get(playerKey)) {
      return false;
    }

    state.pendingLiveById.set(playerKey, nextState);
    state.pendingLiveSignatureById.set(playerKey, nextSignature);
    const nextToken = (state.pendingLiveTokenById.get(playerKey) || 0) + 1;
    state.pendingLiveTokenById.set(playerKey, nextToken);
    clearPlayerStabilizeTimer(playerKey);
    const timer = window.setTimeout(function () {
      state.stabilizeTimerById.delete(playerKey);
      if (state.pendingLiveTokenById.get(playerKey) !== nextToken) {
        return;
      }
      applyPlayerLiveState(
        playerKey,
        state.pendingLiveById.get(playerKey) || null,
      );
    }, LIVE_STATE_STABILIZE_MS);
    state.stabilizeTimerById.set(playerKey, timer);
    return true;
  }

  function resolveTeamPlayerKeyFromPacket(player) {
    if (!state.team) {
      return null;
    }

    const playerIdKey = normalizeKey(
      player && (player.playerId || player.id || player.playerKey),
    );
    if (playerIdKey && state.team.lookupById.has(playerIdKey)) {
      return state.team.lookupById.get(playerIdKey);
    }

    const playerNameKey = normalizeKey(
      player && (player.playerName || player.name || player.player),
    );
    if (playerNameKey && state.team.lookupByName.has(playerNameKey)) {
      return state.team.lookupByName.get(playerNameKey);
    }

    return null;
  }

  function handlePlayerPositions(message) {
    if (!state.team) {
      return;
    }

    const players = Array.isArray(message.payload && message.payload.players)
      ? message.payload.players
      : [];
    const receivedAt = Date.now();
    let hasRelevantUpdate = false;

    for (const player of players) {
      const playerKey = resolveTeamPlayerKeyFromPacket(player);
      if (!playerKey) {
        continue;
      }

      const nextState = normalizeLivePlayer(
        playerKey,
        player,
        message.timestamp,
        receivedAt,
      );
      state.lastSeenAtById.set(playerKey, nextState.seenAt);
      armPlayerStaleTimer(playerKey);
      const nextSignature = getPlayerLiveSignature(nextState);
      if (
        nextSignature !== state.appliedLiveSignatureById.get(playerKey) &&
        nextSignature !== state.pendingLiveSignatureById.get(playerKey)
      ) {
        hasRelevantUpdate = true;
      }
      stagePlayerLiveState(playerKey, nextState);
    }

    if (hasRelevantUpdate) {
      console.info("[Widget] TeamStatus state updated", {
        teamId: state.team.teamId,
        playerCount: state.team.players.length,
      });
    }
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

    if (message.type === "runtime_reset") {
      applyRuntimeReset();
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
      console.info("[Widget] TeamStatus WS connected");
      queueHeaderUpdate();
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
      clearTimeoutMap(state.staleTimerById);
      queueHeaderUpdate();
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

  function trackProcessedKillId(killId) {
    if (!killId || state.processedKillIds.has(killId)) {
      return false;
    }

    state.processedKillIds.add(killId);
    if (state.processedKillIds.size > MAX_TRACKED_KILL_IDS) {
      const oldest = state.processedKillIds.values().next();
      if (!oldest.done) {
        state.processedKillIds.delete(oldest.value);
      }
    }

    return true;
  }

  function isObserverKillFeedUpdatePayload(value) {
    if (!value || typeof value !== "object") {
      return false;
    }

    return (
      typeof value.matchId === "string" &&
      Array.isArray(value.entries) &&
      typeof value.sequence === "number" &&
      typeof value.emittedAt === "string"
    );
  }

  function resolveTeamPlayerKeyFromKillEntry(entry) {
    if (!state.team) {
      return null;
    }

    const killerPlayerId = normalizeKey(entry && entry.killerPlayerId);
    if (killerPlayerId && state.team.lookupById.has(killerPlayerId)) {
      return state.team.lookupById.get(killerPlayerId);
    }

    const killerName = normalizeKey(entry && entry.killerName);
    if (killerName && state.team.lookupByName.has(killerName)) {
      return state.team.lookupByName.get(killerName);
    }

    return null;
  }

  function handleKillFeedUpdate(payload) {
    if (
      !isObserverKillFeedUpdatePayload(payload) ||
      payload.matchId !== matchId ||
      !state.team
    ) {
      return;
    }

    const appliedAt = toTimestampMs(payload.emittedAt) || 0;
    if (
      payload.sequence < state.latestKillFeedSequence ||
      (payload.sequence === state.latestKillFeedSequence &&
        appliedAt <= state.latestKillFeedAppliedAt)
    ) {
      return;
    }

    state.latestKillFeedSequence = payload.sequence;
    state.latestKillFeedAppliedAt = appliedAt;

    let didChange = false;
    for (const entry of payload.entries) {
      const killId = asString(entry && entry.id);
      if (!trackProcessedKillId(killId)) {
        continue;
      }
      if (entry && entry.isKnock === true) {
        continue;
      }

      const playerKey = resolveTeamPlayerKeyFromKillEntry(entry);
      if (!playerKey) {
        continue;
      }

      state.optimisticKillBoostById.set(
        playerKey,
        (state.optimisticKillBoostById.get(playerKey) || 0) + 1,
      );
      queuePlayerUpdate(playerKey);
      didChange = true;
    }

    if (didChange) {
      scheduleSync();
    }
  }

  function connectKillFeedRealtime() {
    if (!matchId || typeof window.io !== "function") {
      return;
    }

    state.killSocket = window.io(`${killFeedApiBase}/realtime`, {
      transports: ["websocket"],
      query: {
        matchId,
      },
      forceNew: true,
    });

    state.killSocket.on("observer:killfeed:update", function (payload) {
      handleKillFeedUpdate(payload);
    });
  }

  function startObserverPolling() {
    if (state.observerTimer !== null) {
      return;
    }

    void pollObserverState();
    state.observerTimer = window.setInterval(function () {
      void pollObserverState();
    }, OBSERVER_POLL_MS);
  }

  connect();
  connectKillFeedRealtime();
  startObserverPolling();

  window.addEventListener("beforeunload", function () {
    clearRenderFrame();
    clearTimeoutMap(state.stabilizeTimerById);
    clearTimeoutMap(state.staleTimerById);
    disposeAllPlayerRefs();

    if (state.observerTimer !== null) {
      window.clearInterval(state.observerTimer);
      state.observerTimer = null;
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
    if (state.killSocket && typeof state.killSocket.disconnect === "function") {
      state.killSocket.disconnect();
    }
  });
})();
