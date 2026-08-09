"use strict";

const LOOPBACK_HOST = "127.0.0.1";
const NETWORK_HOST = "0.0.0.0";

function isEnabled(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function hasOwnEnv(env, key) {
  return Boolean(env) && Object.prototype.hasOwnProperty.call(env, key);
}

function readHostOverride(env, key) {
  const value = String(env?.[key] || "").trim();
  return value || null;
}

function resolveWidgetServerHost({
  isPackaged,
  env = process.env,
  allowNetwork = false,
} = {}) {
  if (!isPackaged) {
    return readHostOverride(env, "ARENZYRA_WIDGET_HOST") || NETWORK_HOST;
  }

  if (
    allowNetwork !== true &&
    !isEnabled(allowNetwork) &&
    !isEnabled(env.ARENZYRA_WIDGET_ALLOW_NETWORK)
  ) {
    return LOOPBACK_HOST;
  }

  return readHostOverride(env, "ARENZYRA_WIDGET_HOST") || NETWORK_HOST;
}

function resolveObserverBindHost({ isPackaged, env = process.env } = {}) {
  if (!isPackaged) {
    return readHostOverride(env, "ARENZYRA_OBSERVER_HOST") || LOOPBACK_HOST;
  }

  if (!isEnabled(env.ARENZYRA_OBSERVER_ALLOW_NETWORK)) {
    return LOOPBACK_HOST;
  }

  return readHostOverride(env, "ARENZYRA_OBSERVER_HOST") || NETWORK_HOST;
}

function shouldEnableWidgetMutationRoutes({ isPackaged, env = process.env } = {}) {
  return !isPackaged || isEnabled(env.ARENZYRA_WIDGET_ENABLE_MUTATION_ROUTES);
}

function shouldAllowDirectObserverWidgetPolling({
  isPackaged: _isPackaged,
  env = process.env,
} = {}) {
  if (isEnabled(env.ARENZYRA_WIDGET_DISABLE_DIRECT_OBSERVER)) {
    return false;
  }

  if (hasOwnEnv(env, "ARENZYRA_WIDGET_ALLOW_DIRECT_OBSERVER")) {
    return isEnabled(env.ARENZYRA_WIDGET_ALLOW_DIRECT_OBSERVER);
  }

  return true;
}

function shouldPollDirectObserverWidgetRuntime({
  isPackaged,
  env = process.env,
  widgetPollingEnabled = false,
  observerFeedRunning = false,
  shadowReachable = false,
  telemetryRunning = false,
} = {}) {
  if (
    !shouldAllowDirectObserverWidgetPolling({
      isPackaged,
      env,
    })
  ) {
    return false;
  }

  if (telemetryRunning === true) {
    return false;
  }

  return (
    widgetPollingEnabled === true ||
    observerFeedRunning === true ||
    shadowReachable === true
  );
}

module.exports = {
  LOOPBACK_HOST,
  NETWORK_HOST,
  resolveObserverBindHost,
  resolveWidgetServerHost,
  shouldAllowDirectObserverWidgetPolling,
  shouldPollDirectObserverWidgetRuntime,
  shouldEnableWidgetMutationRoutes,
};
