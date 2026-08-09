"use strict";

const axios = require("axios");
const {
  isLoopbackHostname,
} = require("../../connector-http-access-policy.cjs");
const {
  renderWidgetBrandingHead,
  renderWidgetBrandingScripts,
} = require("./widget-branding-page.cjs");

function safeJson(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e");
}

function normalizeDebugFlag(value) {
  return value === "1" || value === "true";
}

async function fetchLocalObserverPlayers(
  observerBaseUrl,
  accessToken,
  axiosClient = axios,
) {
  const token = String(accessToken || "").trim();
  if (!token) {
    throw new Error("PCOB connector capability is unavailable.");
  }
  const baseUrl = new URL(
    String(observerBaseUrl || "http://127.0.0.1:10086"),
  );
  if (
    baseUrl.protocol !== "http:" ||
    !isLoopbackHostname(baseUrl.hostname) ||
    baseUrl.username ||
    baseUrl.password
  ) {
    throw new Error("PCOB connector URL must be loopback HTTP.");
  }
  const endpoint = new URL("/gettotalplayerlist", baseUrl).toString();
  const response = await axiosClient.get(endpoint, {
    timeout: 900,
    headers: {
      "X-Arenzyra-Connector-Token": token,
    },
    validateStatus: () => true,
  });
  if (response?.status < 200 || response?.status >= 300) {
    throw new Error(`PCOB connector returned HTTP ${response?.status || 0}.`);
  }
  return response?.data && typeof response.data === "object"
    ? response.data
    : { playerInfoList: [] };
}

function registerObsMapRoute(
  app,
  {
    engine,
    registry,
    wsPath,
    getOrganizationBranding,
    resolveObserverBaseUrl = () => "http://127.0.0.1:10086",
    getObserverAccessToken = () => "",
  },
) {
  app.get("/obs/map", (req, res) => {
    const controlMode = normalizeDebugFlag(String(req.query?.control || ""));
    const requestedMapValue = String(req.query?.map || "").trim();
    const requestedMapDefinition = registry.resolve(requestedMapValue);
    if (requestedMapValue && !requestedMapDefinition) {
      res
        .status(400)
        .type("text")
        .send("Unsupported map key. Update the OBS browser-source URL with a registered map.");
      return;
    }
    const snapshot = engine.getSnapshot(requestedMapDefinition?.key ?? null);
    const bootstrap = {
      widgetKey: "map",
      debug: normalizeDebugFlag(String(req.query?.debug || "")),
      requestedMapKey:
        requestedMapDefinition?.key ?? snapshot?.mapContext?.mapKey ?? registry.getDefaultKey(),
      mapLocked: Boolean(requestedMapDefinition && requestedMapValue),
      wsPath,
      snapshot,
      serverTime: Date.now(),
      ...(controlMode ? { controlMode: true } : {}),
    };
    const visibilityClientMarkup = controlMode
      ? ""
      : '<script src="/obs/static/widget-visibility-client.js?v=widget-hotkey-v1"></script>';

    res.type("html").send(`<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Arenzyra OBS Map</title>
    <link rel="stylesheet" href="/obs/static/obs-map-widget.css?v=hd-map-v5" />
    ${renderWidgetBrandingHead()}
  </head>
  <body>
    <div class="obs-map-root">
      <div class="widget-shell" id="widget-shell" data-left-visible="false" data-distance-visible="false">
        <div class="side-rail" id="side-rail">
          <div class="legend-panel" id="legend-panel" hidden>
            <div class="legend-header">
              <div class="legend-title">Teams</div>
              <div class="legend-meta" id="legend-meta">--</div>
            </div>
            <div class="legend-list" id="legend-list"></div>
          </div>
          <div class="commentary-panel" id="commentary-panel" hidden>
            <div class="commentary-header">
              <div class="commentary-title">AI Commentary</div>
              <div class="commentary-meta" id="commentary-meta">--</div>
            </div>
            <div class="commentary-list" id="commentary-list"></div>
          </div>
        </div>
        <div class="map-stage" id="map-stage">
          <img id="map-image" alt="PUBG map image" draggable="false" />
          <div id="map-tile-layer" aria-hidden="true"></div>
          <canvas id="map-overlay"></canvas>
          <div class="status-pill" id="status-pill" hidden aria-hidden="true">Connecting...</div>
          <div class="timer-panel" id="timer-panel" hidden aria-hidden="true">
            <div class="timer-label">Zone Timer</div>
            <div class="timer-value" id="timer-value">--:--</div>
          </div>
          <div class="operator-stack" id="operator-stack">
            <div class="assist-panel" id="assist-panel" hidden>
              <div class="assist-title">Observer Assist</div>
              <div class="assist-grid" id="assist-grid"></div>
            </div>
            <div class="operator-panel" id="operator-panel" hidden>
              <div class="assist-title">Observer Panel</div>
              <div class="operator-panel-body" id="operator-panel-body"></div>
            </div>
            <div class="watch-queue-panel" id="watch-queue-panel" hidden>
              <div class="assist-title">Watch Queue</div>
              <div class="watch-queue-list" id="watch-queue-list"></div>
            </div>
            <div class="alerts-panel" id="alerts-panel" hidden>
              <div class="assist-title">Production Alerts</div>
              <div class="alerts-list" id="alerts-list"></div>
            </div>
          </div>
          <div class="debug-panel" id="debug-panel" hidden>
            <div class="debug-title">Map Debug</div>
            <div class="debug-grid" id="debug-grid"></div>
          </div>
        </div>
        <div class="right-rail" id="right-rail">
          <div class="distance-panel" id="distance-panel" hidden>
            <div class="distance-header">
              <div class="distance-title">Team Distance</div>
              <div class="distance-meta" id="distance-meta">--</div>
            </div>
            <div class="distance-list" id="distance-list"></div>
          </div>
        </div>
      </div>
    </div>
    <script>window.__ARENZYRA_MAP_WIDGET_BOOTSTRAP__ = ${safeJson(bootstrap)};</script>
    ${renderWidgetBrandingScripts("map", getOrganizationBranding)}
    ${visibilityClientMarkup}
    <script src="/obs/static/obs-map-widget.js?v=hd-map-v5"></script>
  </body>
</html>`);
  });

  app.get("/obs/map/vehicle-players", async (_req, res) => {
    res.set("Cache-Control", "no-store, no-cache, must-revalidate");
    try {
      const payload = await fetchLocalObserverPlayers(
        resolveObserverBaseUrl(),
        getObserverAccessToken(),
      );
      res.json(payload);
    } catch {
      res.status(502).json({
        error: "pcob_vehicle_players_unavailable",
        playerInfoList: [],
      });
    }
  });
}

module.exports = {
  fetchLocalObserverPlayers,
  registerObsMapRoute,
};
