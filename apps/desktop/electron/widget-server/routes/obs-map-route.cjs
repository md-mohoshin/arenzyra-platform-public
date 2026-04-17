"use strict";

function safeJson(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e");
}

function normalizeDebugFlag(value) {
  return value === "1" || value === "true";
}

function registerObsMapRoute(app, { engine, registry, wsPath }) {
  app.get("/obs/map", (req, res) => {
    const requestedMapDefinition = registry.resolve(req.query?.map);
    const snapshot = engine.getSnapshot(requestedMapDefinition?.key ?? null);
    const bootstrap = {
      debug: normalizeDebugFlag(String(req.query?.debug || "")),
      requestedMapKey:
        requestedMapDefinition?.key ?? snapshot?.mapContext?.mapKey ?? registry.getDefaultKey(),
      wsPath,
      snapshot,
      serverTime: Date.now(),
    };

    res.type("html").send(`<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Arenzyra OBS Map</title>
    <link rel="stylesheet" href="/obs/static/obs-map-widget.css?v=blue-zone-v5" />
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
          <canvas id="map-overlay"></canvas>
          <div class="status-pill" id="status-pill">Connecting...</div>
          <div class="timer-panel" id="timer-panel">
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
    <script src="/obs/static/obs-map-widget.js?v=blue-zone-v5"></script>
  </body>
</html>`);
  });
}

module.exports = {
  registerObsMapRoute,
};
