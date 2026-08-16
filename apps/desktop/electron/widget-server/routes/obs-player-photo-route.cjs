"use strict";

const axios = require("axios");
const { getProcessDefaultApiBase } = require("../../apiBaseDefaults.cjs");

const DEFAULT_API_BASE =
  process.env.ARENZYRA_API_URL ||
  process.env.ARENZYRA_API_BASE ||
  getProcessDefaultApiBase();
const DEFAULT_OBSERVER_BASE_URL = "http://127.0.0.1:10086";
const DEFAULT_WS_PATH = "/ws";
const PLAYER_PHOTO_WIDGET_ASSET_VERSION = "player-photo-clean-v9";
const OBSERVER_FOCUS_TIMEOUT_MS = 900;
const {
  buildWidgetBrandingBootstrap,
  renderWidgetBrandingHead,
} = require("./widget-branding-page.cjs");

function asString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeBaseUrl(value, fallback = DEFAULT_API_BASE) {
  const raw = String(value || fallback || "").trim();
  if (!raw) {
    return fallback;
  }

  const withProtocol = raw.includes("://") ? raw : `http://${raw}`;
  const parsed = new URL(withProtocol);
  return parsed.toString().replace(/\/$/, "");
}

function readQueryValue(value) {
  if (Array.isArray(value)) {
    return asString(value[0]);
  }
  return asString(value);
}

function safeJson(value) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e");
}

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function firstTextValue(record, keys) {
  const source = asRecord(record);
  if (!source) {
    return null;
  }

  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }

  return null;
}

function normalizeLookup(value) {
  return asString(value).toLowerCase();
}

function isDefaultPlayerPhotoUrl(value) {
  const raw = asString(value).toLowerCase();
  return (
    !raw ||
    raw.includes("default-player") ||
    raw.includes("defaults/default") ||
    raw.includes("placeholder")
  );
}

function firstUsefulPlayerPhotoUrl(...values) {
  for (const value of values) {
    const raw = asString(value);
    if (raw && !isDefaultPlayerPhotoUrl(raw)) {
      return raw;
    }
  }
  return null;
}

function collectPlayerLookupIds(player) {
  return [
    player?.playerId,
    player?.playerID,
    player?.PlayerId,
    player?.PlayerID,
    player?.id,
    player?.ID,
    player?.uId,
    player?.uid,
    player?.UID,
    player?.playerKey,
    player?.PlayerKey,
    player?.externalPlayerId,
    player?.pubgPlayerId,
    player?.pubgAccountId,
    player?.playerOpenId,
    player?.playerOpenID,
    player?.PlayerOpenId,
    player?.PlayerOpenID,
    player?.openId,
    player?.OpenId,
    player?.inGameId,
  ]
    .map(normalizeLookup)
    .filter(Boolean);
}

function resolveLocalWidgetSnapshot(getLocalWidgetSnapshot) {
  if (typeof getLocalWidgetSnapshot !== "function") {
    return null;
  }

  try {
    return asRecord(getLocalWidgetSnapshot());
  } catch {
    return null;
  }
}

function getLocalSnapshotPlayers(localWidgetSnapshot) {
  if (Array.isArray(localWidgetSnapshot?.players)) {
    return localWidgetSnapshot.players;
  }

  return Array.isArray(localWidgetSnapshot?.players?.players)
    ? localWidgetSnapshot.players.players
    : [];
}

function findFocusedLocalPlayer(localWidgetSnapshot, focus) {
  if (!focus) {
    return null;
  }

  const players = getLocalSnapshotPlayers(localWidgetSnapshot);
  const focusIds = collectPlayerLookupIds(focus);
  if (focusIds.length > 0) {
    const matchedById = players.find((player) =>
      collectPlayerLookupIds(player).some((id) => focusIds.includes(id)),
    );
    if (matchedById) {
      return matchedById;
    }
  }

  const focusName = normalizeLookup(focus.playerName || focus.name);
  return (
    players.find(
      (player) =>
        focusName &&
        focusName === normalizeLookup(player?.playerName || player?.name),
    ) ?? null
  );
}

function enrichObserverFocusFromLocalSnapshot(focus, localWidgetSnapshot) {
  if (!focus) {
    return null;
  }

  const player = findFocusedLocalPlayer(localWidgetSnapshot, focus);
  if (!player) {
    return focus;
  }

  return {
    ...focus,
    playerId:
      focus.playerId ??
      player.playerId ??
      player.id ??
      player.playerKey ??
      null,
    playerName:
      focus.playerName ?? player.playerName ?? player.name ?? null,
    teamId: focus.teamId ?? player.teamId ?? null,
    teamName: focus.teamName ?? player.teamName ?? null,
    teamTag: focus.teamTag ?? player.teamTag ?? null,
    slot: focus.slot ?? player.teamSlot ?? player.slot ?? null,
    avatarUrl: firstUsefulPlayerPhotoUrl(
      focus.avatarUrl,
      player.avatarUrl,
      player.photoUrl,
      player.picUrl,
    ),
  };
}

function buildLocalCircle(localWidgetSnapshot) {
  const zone = asRecord(localWidgetSnapshot?.zone);
  if (!zone) {
    return null;
  }

  const currentCircle = asRecord(zone.currentCircle);
  const nextCircle = asRecord(zone.nextCircle);
  return {
    phase: zone.phase ?? null,
    nextShrinkAt: zone.targetEndAt ?? null,
    safeZone: currentCircle
      ? {
          x: currentCircle.centerX ?? currentCircle.x ?? null,
          y: currentCircle.centerY ?? currentCircle.y ?? null,
          radius: currentCircle.radius ?? null,
        }
      : null,
    nextZone: nextCircle
      ? {
          x: nextCircle.centerX ?? nextCircle.x ?? null,
          y: nextCircle.centerY ?? nextCircle.y ?? null,
          radius: nextCircle.radius ?? null,
        }
      : null,
  };
}

function mergeLocalWidgetSnapshot(observerState, localWidgetSnapshot) {
  const currentState = asRecord(observerState);
  const localPlayers = getLocalSnapshotPlayers(localWidgetSnapshot);
  const localCircle = buildLocalCircle(localWidgetSnapshot);
  if (!currentState && localPlayers.length === 0 && !localCircle) {
    return observerState;
  }

  const state = currentState ? { ...currentState } : {};
  if (!Array.isArray(state.leaderboard) || state.leaderboard.length === 0) {
    const rowsByTeam = new Map();
    for (const player of localPlayers) {
      const teamId = asString(player?.teamId) || "unknown";
      if (!rowsByTeam.has(teamId)) {
        rowsByTeam.set(teamId, {
          teamId: teamId === "unknown" ? null : teamId,
          teamName: null,
          teamTag: null,
          players: [],
        });
      }
      rowsByTeam.get(teamId).players.push({ ...player });
    }
    state.leaderboard = Array.from(rowsByTeam.values());
  }
  if (!asRecord(state.circle) && localCircle) {
    state.circle = localCircle;
  }

  return state;
}

function resolveNestedRecord(payload, keys) {
  const root = asRecord(payload);
  if (!root) {
    return null;
  }

  for (const key of keys) {
    const nested = asRecord(root[key]);
    if (nested) {
      return nested;
    }
  }

  return root;
}

function normalizeObserverFocus(payload) {
  const record = resolveNestedRecord(payload, [
    "observingPlayer",
    "observer",
    "ObservingPlayer",
    "data",
    "Data",
    "result",
    "Result",
  ]);
  if (!record) {
    return null;
  }

  const pubgPlayerId = firstTextValue(record, [
    "uId",
    "uid",
    "UID",
    "0",
    "playerId",
    "playerID",
    "PlayerId",
    "PlayerID",
    "id",
    "ID",
  ]);
  const externalPlayerId = firstTextValue(record, [
    "externalPlayerId",
    "externalId",
  ]);
  const playerOpenId = firstTextValue(record, [
    "playerOpenId",
    "playerOpenID",
    "PlayerOpenId",
    "PlayerOpenID",
    "openId",
    "OpenId",
  ]);
  const playerId = pubgPlayerId ?? externalPlayerId ?? playerOpenId;
  const playerName = firstTextValue(record, [
    "playerName",
    "PlayerName",
    "name",
    "Name",
    "ign",
    "IGN",
  ]);
  const teamId = firstTextValue(record, [
    "teamId",
    "teamID",
    "TeamId",
    "TeamID",
    "team_id",
  ]);
  const teamName = firstTextValue(record, ["teamName", "TeamName"]);
  const teamTag = firstTextValue(record, ["teamTag", "TeamTag", "tag", "Tag"]);
  const slot = firstTextValue(record, [
    "slot",
    "Slot",
    "teamNo",
    "TeamNo",
    "teamNumber",
    "TeamNumber",
  ]);

  if (!playerId && !playerName) {
    return null;
  }

  return {
    playerId,
    externalPlayerId,
    pubgPlayerId,
    playerOpenId,
    playerName,
    teamId,
    teamName,
    teamTag,
    slot,
    avatarUrl: firstTextValue(record, ["avatarUrl", "AvatarUrl", "photoUrl", "PhotoUrl"]),
  };
}

async function fetchLocalObserverFocus(observerBaseUrl, accessToken = "") {
  const baseUrl = normalizeBaseUrl(
    observerBaseUrl || DEFAULT_OBSERVER_BASE_URL,
    DEFAULT_OBSERVER_BASE_URL,
  );
  try {
    const response = await axios.get(`${baseUrl}/getobservingplayer`, {
      timeout: OBSERVER_FOCUS_TIMEOUT_MS,
      ...(String(accessToken || "").trim()
        ? {
            headers: {
              "X-Arenzyra-Connector-Token": String(accessToken).trim(),
            },
          }
        : {}),
      validateStatus: () => true,
    });
    if (response?.status < 200 || response?.status >= 300) {
      return null;
    }
    return normalizeObserverFocus(response?.data);
  } catch {
    return null;
  }
}

function findFocusedLeaderboardMatch(observerState, focus) {
  if (!focus || !Array.isArray(observerState?.leaderboard)) {
    return null;
  }

  const focusId = normalizeLookup(focus.playerId);
  const focusName = normalizeLookup(focus.playerName);
  const focusTeamId = normalizeLookup(focus.teamId);
  const focusTeamName = normalizeLookup(focus.teamName);
  const focusTeamTag = normalizeLookup(focus.teamTag);
  const focusSlot = normalizeLookup(focus.slot);

  for (const row of observerState.leaderboard) {
    const rowTeamId = normalizeLookup(row?.teamId);
    const rowTeamName = normalizeLookup(row?.teamName);
    const rowTeamTag = normalizeLookup(row?.teamTag);
    const rowSlot = normalizeLookup(row?.slot);
    const teamMatches =
      !focusTeamId && !focusTeamName && !focusTeamTag && !focusSlot
        ? true
        : (focusTeamId && focusTeamId === rowTeamId) ||
          (focusTeamId && focusTeamId === rowSlot) ||
          (focusTeamName && focusTeamName === rowTeamName) ||
          (focusTeamTag && focusTeamTag === rowTeamTag) ||
          (focusSlot && focusSlot === rowSlot);
    const players = Array.isArray(row?.players) ? row.players : [];

    for (const player of players) {
      const playerIds = collectPlayerLookupIds(player);
      if (!focusId || !playerIds.includes(focusId) || !teamMatches) {
        continue;
      }

      return {
        row,
        player,
      };
    }
  }

  for (const row of observerState.leaderboard) {
    const rowTeamId = normalizeLookup(row?.teamId);
    const rowTeamName = normalizeLookup(row?.teamName);
    const rowTeamTag = normalizeLookup(row?.teamTag);
    const rowSlot = normalizeLookup(row?.slot);
    const teamMatches =
      !focusTeamId && !focusTeamName && !focusTeamTag && !focusSlot
        ? true
        : (focusTeamId && focusTeamId === rowTeamId) ||
          (focusTeamId && focusTeamId === rowSlot) ||
          (focusTeamName && focusTeamName === rowTeamName) ||
          (focusTeamTag && focusTeamTag === rowTeamTag) ||
          (focusSlot && focusSlot === rowSlot);
    const players = Array.isArray(row?.players) ? row.players : [];

    for (const player of players) {
      const playerName = normalizeLookup(player?.playerName || player?.name);
      if (!focusName || focusName !== playerName || !teamMatches) {
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

function applyLocalObserverFocus(observerState, focus, localWidgetSnapshot = null) {
  const state = mergeLocalWidgetSnapshot(observerState, localWidgetSnapshot);
  if (!asRecord(state) || !focus) {
    return state;
  }

  const matched = findFocusedLeaderboardMatch(state, focus);
  const row = matched?.row ?? null;
  const player = matched?.player ?? null;
  const existingPlayerCard = asRecord(state.playerCard);
  const realPhotoUrl = firstUsefulPlayerPhotoUrl(
    player?.avatarUrl,
    player?.photoUrl,
    existingPlayerCard?.avatarUrl,
    existingPlayerCard?.photoUrl,
    focus.avatarUrl,
  );

  return {
    ...state,
    playerCard: {
      playerId:
        player?.playerId ??
        player?.id ??
        player?.playerKey ??
        existingPlayerCard?.playerId ??
        existingPlayerCard?.id ??
        focus.playerId ??
        null,
      externalPlayerId:
        player?.externalPlayerId ?? existingPlayerCard?.externalPlayerId ?? null,
      pubgPlayerId:
        player?.pubgPlayerId ?? existingPlayerCard?.pubgPlayerId ?? null,
      name:
        player?.playerName ??
        player?.name ??
        existingPlayerCard?.playerName ??
        existingPlayerCard?.name ??
        focus.playerName ??
        null,
      avatarUrl:
        realPhotoUrl,
      photoUrl:
        realPhotoUrl,
      teamId: row?.teamId ?? existingPlayerCard?.teamId ?? focus.teamId ?? null,
      teamName:
        row?.teamName ?? existingPlayerCard?.teamName ?? focus.teamName ?? null,
      teamTag:
        row?.teamTag ?? existingPlayerCard?.teamTag ?? focus.teamTag ?? null,
      logoUrl: row?.logoUrl ?? existingPlayerCard?.logoUrl ?? null,
      color: row?.color ?? existingPlayerCard?.color ?? null,
      kills: Number.isFinite(Number(player?.kills))
        ? Number(player.kills)
        : Number.isFinite(Number(existingPlayerCard?.kills))
          ? Number(existingPlayerCard.kills)
          : 0,
      alive:
        typeof player?.alive === "boolean"
          ? player.alive
          : typeof existingPlayerCard?.alive === "boolean"
            ? existingPlayerCard.alive
            : true,
      knocked:
        typeof player?.knocked === "boolean"
          ? player.knocked
          : typeof existingPlayerCard?.knocked === "boolean"
            ? existingPlayerCard.knocked
            : false,
      damage: Number.isFinite(Number(player?.damage))
        ? Number(player.damage)
        : Number.isFinite(Number(existingPlayerCard?.damage))
          ? Number(existingPlayerCard.damage)
          : null,
    },
  };
}

function resolveCurrentMatchContext(getCurrentMatchContext) {
  const resolved =
    typeof getCurrentMatchContext === "function" ? getCurrentMatchContext() : null;

  return {
    matchId: asString(resolved?.matchId) || null,
    source: asString(resolved?.source) || null,
    workflowState: asString(resolved?.workflowState) || null,
    productionStatus: asString(resolved?.productionStatus) || null,
  };
}

function renderPlayerPhotoPage({ bootstrap }) {
  const payload = safeJson(bootstrap);
  const stylePath = `/obs/static/obs-player-photo-widget.css?v=${PLAYER_PHOTO_WIDGET_ASSET_VERSION}`;
  const scriptPath = `/obs/static/obs-player-photo-widget.js?v=${PLAYER_PHOTO_WIDGET_ASSET_VERSION}`;

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta http-equiv="Cache-Control" content="no-store, no-cache, must-revalidate" />
    <title>Arenzyra Player Photo Widget</title>
    <link rel="stylesheet" href="${stylePath}" />
    ${renderWidgetBrandingHead()}
  </head>
  <body>
    <div
      class="obs-player-photo-root"
      id="player-photo-root"
      data-status="alive"
      data-offline="false"
      data-stale="false"
      hidden
    >
      <article class="player-photo-shell" aria-hidden="true">
        <div class="player-photo-frame">
          <img id="player-photo-image" alt="Focused player portrait" draggable="false" />
        </div>
      </article>
    </div>
    <script>window.__ARENZYRA_LOCAL_WIDGET_BOOTSTRAP__ = ${payload};</script>
    <script src="/obs/static/widget-branding-client.js?v=widget-branding-v2"></script>
    <script src="/obs/static/widget-visibility-client.js?v=widget-hotkey-v1"></script>
    <script src="${scriptPath}"></script>
  </body>
</html>`;
}

function resolveStateError(error) {
  const status = Number(error?.response?.status);
  const message =
    (typeof error?.response?.data?.message === "string" &&
    error.response.data.message.trim()
      ? error.response.data.message.trim()
      : null) ||
    (typeof error?.response?.data?.error === "string" &&
    error.response.data.error.trim()
      ? error.response.data.error.trim()
      : null) ||
    (error instanceof Error ? error.message : String(error || "")) ||
    "observer widget state unavailable";

  return {
    status,
    message,
  };
}

function registerObsPlayerPhotoRoute(
  app,
  {
    resolveApiBase = () => DEFAULT_API_BASE,
    wsPath = DEFAULT_WS_PATH,
    getCurrentMatchContext = () => null,
    getPlayerAssetsVersion = () => null,
    resolveObserverBaseUrl = () => null,
    getObserverAccessToken = () => "",
    getLocalWidgetSnapshot = () => null,
    requestPlayerPhotoRefresh = null,
    getOrganizationBranding = () => null,
    log = () => {},
  } = {},
) {
  function requestPhotoRefresh(matchId) {
    if (!matchId || typeof requestPlayerPhotoRefresh !== "function") {
      return;
    }

    try {
      requestPlayerPhotoRefresh(matchId);
    } catch (error) {
      log(
        `[widget-server] player photo refresh request failed matchId=${matchId} detail=${
          error instanceof Error ? error.message : String(error || "")
        }`,
      );
    }
  }

  app.get("/obs/player-photo", (_req, res) => {
    const apiBase = normalizeBaseUrl(resolveApiBase());
    const currentMatchContext = resolveCurrentMatchContext(getCurrentMatchContext);
    requestPhotoRefresh(currentMatchContext.matchId);

    res
      .set("Cache-Control", "no-store, no-cache, must-revalidate")
      .type("html")
      .send(
      renderPlayerPhotoPage({
        bootstrap: {
          ...buildWidgetBrandingBootstrap(
            "player-photo",
            getOrganizationBranding,
          ),
          apiBase,
          widgetKey: "player-photo",
          wsPath: asString(wsPath) || DEFAULT_WS_PATH,
          matchId: currentMatchContext.matchId,
          localStateUrl: "/obs/player-photo/state",
          localFocusUrl: "/obs/player-photo/focus",
          playerAssetsVersion: asString(getPlayerAssetsVersion()) || "0:0",
        },
      }),
    );
  });

  app.get("/obs/player-photo/focus", async (_req, res) => {
    res.set("Cache-Control", "no-store, no-cache, must-revalidate");
    const currentMatchContext = resolveCurrentMatchContext(getCurrentMatchContext);
    const playerAssetsVersion = asString(getPlayerAssetsVersion()) || null;

    try {
      const focus = enrichObserverFocusFromLocalSnapshot(
        await fetchLocalObserverFocus(
          resolveObserverBaseUrl(),
          getObserverAccessToken(),
        ),
        resolveLocalWidgetSnapshot(getLocalWidgetSnapshot),
      );
      res.json({
        ok: true,
        matchId: currentMatchContext.matchId,
        focus,
        playerAssetsVersion,
        source: currentMatchContext.source,
        workflowState: currentMatchContext.workflowState,
        productionStatus: currentMatchContext.productionStatus,
      });
    } catch (error) {
      res.status(502).json({
        ok: false,
        matchId: currentMatchContext.matchId,
        focus: null,
        playerAssetsVersion,
        reason: "observer focus unavailable",
        detail: error instanceof Error ? error.message : String(error || ""),
        source: currentMatchContext.source,
        workflowState: currentMatchContext.workflowState,
        productionStatus: currentMatchContext.productionStatus,
      });
    }
  });

  app.get("/obs/player-photo/state", async (req, res) => {
    res.set("Cache-Control", "no-store, no-cache, must-revalidate");
    const apiBase = normalizeBaseUrl(resolveApiBase());
    const currentMatchContext = resolveCurrentMatchContext(getCurrentMatchContext);
    const requestedMatchId = readQueryValue(req.query?.matchId);
    const matchId = requestedMatchId || currentMatchContext.matchId;
    const playerAssetsVersion = asString(getPlayerAssetsVersion()) || null;
    const localWidgetSnapshot = resolveLocalWidgetSnapshot(
      getLocalWidgetSnapshot,
    );

    if (!matchId) {
      res.json({
        ok: true,
        matchId: null,
        observerState: null,
        playerAssetsVersion,
        reason: "match unavailable",
        source: currentMatchContext.source,
        workflowState: currentMatchContext.workflowState,
        productionStatus: currentMatchContext.productionStatus,
      });
      return;
    }

    const localObserverFocusPromise = fetchLocalObserverFocus(
      resolveObserverBaseUrl(),
      getObserverAccessToken(),
    ).then((focus) =>
      enrichObserverFocusFromLocalSnapshot(focus, localWidgetSnapshot),
    );

    try {
      const [response, localObserverFocus] = await Promise.all([
        axios.get(
        `${apiBase}/api/observer/match/${encodeURIComponent(matchId)}/widget-state`,
        {
          timeout: 10000,
          headers: {
            Accept: "application/json",
          },
        },
        ),
        localObserverFocusPromise,
      ]);
      const observerState = applyLocalObserverFocus(
        response?.data ?? null,
        localObserverFocus,
        localWidgetSnapshot,
      );

      res.json({
        ok: true,
        matchId,
        observerState,
        playerAssetsVersion,
        source: currentMatchContext.source,
        workflowState: currentMatchContext.workflowState,
        productionStatus: currentMatchContext.productionStatus,
      });
    } catch (error) {
      const failure = resolveStateError(error);
      const localObserverFocus = await localObserverFocusPromise;
      const localObserverState = applyLocalObserverFocus(
        null,
        localObserverFocus,
        localWidgetSnapshot,
      );
      log(
        `[widget-server] local player-photo state failure status=${failure.status || "unknown"} matchId=${matchId} detail=${failure.message}`,
      );

      if (asRecord(localObserverState)) {
        res.json({
          ok: true,
          matchId,
          observerState: localObserverState,
          playerAssetsVersion,
          reason: "backend unavailable; using local observer telemetry",
          source: currentMatchContext.source,
          workflowState: currentMatchContext.workflowState,
          productionStatus: currentMatchContext.productionStatus,
        });
        return;
      }

      if (failure.status === 404) {
        res.json({
          ok: true,
          matchId,
          observerState: null,
          playerAssetsVersion,
          reason: "observer state unavailable",
          source: currentMatchContext.source,
          workflowState: currentMatchContext.workflowState,
          productionStatus: currentMatchContext.productionStatus,
        });
        return;
      }

      res.status(502).json({
        ok: false,
        matchId,
        observerState: null,
        playerAssetsVersion,
        reason: "backend unavailable",
        detail: failure.message,
        source: currentMatchContext.source,
        workflowState: currentMatchContext.workflowState,
        productionStatus: currentMatchContext.productionStatus,
      });
    }
  });

}

module.exports = {
  normalizeObserverFocus,
  registerObsPlayerPhotoRoute,
};
