"use strict";

function registerHealthRoute(app, { startedAt, port, engine, registry }) {
  app.get("/health", (_req, res) => {
    const engineStatus = engine.getStatus();
    res.json({
      status: "ok",
      port,
      startedAt: new Date(startedAt).toISOString(),
      uptimeMs: Date.now() - startedAt,
      activeMapKey: engineStatus.currentMapKey,
      mockFeedRunning: engineStatus.mockFeedRunning,
      assetValidation: registry.getValidationSummary(),
    });
  });
}

module.exports = {
  registerHealthRoute,
};
