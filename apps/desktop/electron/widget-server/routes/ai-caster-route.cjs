"use strict";

const {
  renderWidgetBrandingHead,
  renderWidgetBrandingScripts,
} = require("./widget-branding-page.cjs");

function safeJson(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e");
}

function registerAiCasterRoute(
  app,
  { engine, aiCasterEngine, getOrganizationBranding },
) {
  function buildState(req) {
    const snapshot = engine.getSnapshot(req.query?.map ?? null);
    return aiCasterEngine.evaluate(snapshot);
  }

  app.get("/obs/ai-caster/state", (req, res) => {
    res.json(buildState(req));
  });

  app.get("/obs/ai-caster", (req, res) => {
    const bootstrap = {
      widgetKey: "ai-caster",
      wsPath: "/ws",
      state: buildState(req),
      requestedMapKey:
        typeof req.query?.map === "string" && req.query.map.trim()
          ? req.query.map.trim()
          : null,
    };

    res.type("html").send(`<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Arenzyra AI Caster</title>
    <link rel="stylesheet" href="/obs/static/ai-caster-widget.css?v=ai-caster-v1" />
    ${renderWidgetBrandingHead()}
  </head>
  <body>
    <main class="ai-caster-root" id="ai-caster-root" data-status="loading">
      <div class="ai-caster-header">
        <div class="ai-caster-title">AI Caster</div>
        <div class="ai-caster-meta" id="ai-caster-meta">Standby</div>
      </div>
      <div class="ai-caster-line" id="ai-caster-line">Loading caster state.</div>
      <div class="ai-caster-footer">
        <span id="ai-caster-voice">system</span>
        <span id="ai-caster-style">control</span>
      </div>
    </main>
    <script>window.__ARENZYRA_AI_CASTER_BOOTSTRAP__ = ${safeJson(bootstrap)};</script>
    <script>window.__ARENZYRA_WIDGET_VISIBILITY_BOOTSTRAP__ = ${safeJson(bootstrap)};</script>
    ${renderWidgetBrandingScripts("ai-caster", getOrganizationBranding)}
    <script src="/obs/static/widget-visibility-client.js?v=widget-hotkey-v1"></script>
    <script src="/obs/static/ai-caster-widget.js?v=ai-caster-v1"></script>
  </body>
</html>`);
  });
}

module.exports = {
  registerAiCasterRoute,
};
