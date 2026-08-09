"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  resolveObserverBindHost,
  resolveWidgetServerHost,
  shouldAllowDirectObserverWidgetPolling,
  shouldPollDirectObserverWidgetRuntime,
  shouldEnableWidgetMutationRoutes,
} = require("./launcher-runtime-policy.cjs");

test("production launcher defaults to loopback-only widget and observer hosts", () => {
  assert.equal(resolveWidgetServerHost({ isPackaged: true, env: {} }), "127.0.0.1");
  assert.equal(resolveObserverBindHost({ isPackaged: true, env: {} }), "127.0.0.1");
  assert.equal(
    shouldEnableWidgetMutationRoutes({ isPackaged: true, env: {} }),
    false,
  );
  assert.equal(
    shouldAllowDirectObserverWidgetPolling({ isPackaged: true, env: {} }),
    true,
  );
});

test("production debug overrides must be explicit", () => {
  const env = {
    ARENZYRA_WIDGET_ALLOW_NETWORK: "1",
    ARENZYRA_WIDGET_HOST: "0.0.0.0",
    ARENZYRA_OBSERVER_ALLOW_NETWORK: "1",
    ARENZYRA_OBSERVER_HOST: "0.0.0.0",
    ARENZYRA_WIDGET_ENABLE_MUTATION_ROUTES: "1",
  };

  assert.equal(resolveWidgetServerHost({ isPackaged: true, env }), "0.0.0.0");
  assert.equal(resolveObserverBindHost({ isPackaged: true, env }), "0.0.0.0");
  assert.equal(shouldEnableWidgetMutationRoutes({ isPackaged: true, env }), true);
  assert.equal(
    shouldAllowDirectObserverWidgetPolling({ isPackaged: true, env }),
    true,
  );
});

test("production widget host can be opened by launcher LAN setting", () => {
  assert.equal(
    resolveWidgetServerHost({
      isPackaged: true,
      env: {},
      allowNetwork: true,
    }),
    "0.0.0.0",
  );
});

test("direct observer widget polling can be explicitly disabled", () => {
  const env = {
    ARENZYRA_WIDGET_DISABLE_DIRECT_OBSERVER: "1",
  };

  assert.equal(
    shouldAllowDirectObserverWidgetPolling({ isPackaged: true, env }),
    false,
  );
  assert.equal(
    shouldPollDirectObserverWidgetRuntime({
      isPackaged: true,
      env,
      shadowReachable: true,
    }),
    false,
  );
});

test("development launcher keeps existing local-debug behavior", () => {
  assert.equal(resolveWidgetServerHost({ isPackaged: false, env: {} }), "0.0.0.0");
  assert.equal(resolveObserverBindHost({ isPackaged: false, env: {} }), "127.0.0.1");
  assert.equal(
    shouldEnableWidgetMutationRoutes({ isPackaged: false, env: {} }),
    true,
  );
  assert.equal(
    shouldAllowDirectObserverWidgetPolling({ isPackaged: false, env: {} }),
    true,
  );
});

test("direct observer widget runtime recovers from a live local observer endpoint", () => {
  assert.equal(
    shouldPollDirectObserverWidgetRuntime({
      isPackaged: true,
      env: {},
      widgetPollingEnabled: false,
      observerFeedRunning: false,
      shadowReachable: true,
      telemetryRunning: false,
    }),
    true,
  );
});

test("telemetry bridge activity suppresses direct observer widget polling", () => {
  assert.equal(
    shouldPollDirectObserverWidgetRuntime({
      isPackaged: true,
      env: {},
      widgetPollingEnabled: true,
      observerFeedRunning: true,
      shadowReachable: true,
      telemetryRunning: true,
    }),
    false,
  );
});
