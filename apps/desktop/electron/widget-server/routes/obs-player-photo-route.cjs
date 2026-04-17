"use strict";

const axios = require("axios");
const { getProcessDefaultApiBase } = require("../../apiBaseDefaults.cjs");

const DEFAULT_API_BASE =
  process.env.ARENZYRA_API_URL ||
  process.env.ARENZYRA_API_BASE ||
  getProcessDefaultApiBase();
const DEFAULT_WS_PATH = "/ws";

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

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta http-equiv="Cache-Control" content="no-store, no-cache, must-revalidate" />
    <title>Arenzyra Player Photo Widget</title>
    <link rel="stylesheet" href="/obs/static/obs-player-photo-widget.css" />
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
    <script src="/obs/static/obs-player-photo-widget.js"></script>
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
    log = () => {},
  } = {},
) {
  app.get("/obs/player-photo", (_req, res) => {
    const apiBase = normalizeBaseUrl(resolveApiBase());
    const currentMatchContext = resolveCurrentMatchContext(getCurrentMatchContext);

    res.type("html").send(
      renderPlayerPhotoPage({
        bootstrap: {
          apiBase,
          wsPath: asString(wsPath) || DEFAULT_WS_PATH,
          matchId: currentMatchContext.matchId,
          localStateUrl: "/obs/player-photo/state",
        },
      }),
    );
  });

  app.get("/obs/player-photo/state", async (req, res) => {
    const apiBase = normalizeBaseUrl(resolveApiBase());
    const currentMatchContext = resolveCurrentMatchContext(getCurrentMatchContext);
    const requestedMatchId = readQueryValue(req.query?.matchId);
    const matchId = requestedMatchId || currentMatchContext.matchId;

    if (!matchId) {
      res.json({
        ok: true,
        matchId: null,
        observerState: null,
        reason: "match unavailable",
        source: currentMatchContext.source,
        workflowState: currentMatchContext.workflowState,
        productionStatus: currentMatchContext.productionStatus,
      });
      return;
    }

    try {
      const response = await axios.get(
        `${apiBase}/api/observer/match/${encodeURIComponent(matchId)}/widget-state`,
        {
          timeout: 10000,
          headers: {
            Accept: "application/json",
          },
        },
      );

      res.json({
        ok: true,
        matchId,
        observerState: response?.data ?? null,
        source: currentMatchContext.source,
        workflowState: currentMatchContext.workflowState,
        productionStatus: currentMatchContext.productionStatus,
      });
    } catch (error) {
      const failure = resolveStateError(error);
      log(
        `[widget-server] local player-photo state failure status=${failure.status || "unknown"} matchId=${matchId} detail=${failure.message}`,
      );

      if (failure.status === 404) {
        res.json({
          ok: true,
          matchId,
          observerState: null,
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
  registerObsPlayerPhotoRoute,
};
