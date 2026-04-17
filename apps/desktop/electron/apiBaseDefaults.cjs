"use strict";

const DEFAULT_LOCAL_API_BASE = "http://localhost:3000";
const DEFAULT_PRODUCTION_API_BASE = "https://api.arenzyra.com";

function normalizeApiEnvironment(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();

  if (!normalized) {
    return "auto";
  }

  if (["dev", "development", "local"].includes(normalized)) {
    return "dev";
  }

  if (["lan", "network"].includes(normalized)) {
    return "lan";
  }

  if (["stage", "staging", "qa"].includes(normalized)) {
    return "staging";
  }

  if (["prod", "production"].includes(normalized)) {
    return "production";
  }

  return "auto";
}

function getDefaultProtocolForEnvironment(apiEnvironment) {
  return ["production", "staging"].includes(apiEnvironment) ? "https:" : "http:";
}

function getEnvironmentApiBaseCandidates(apiEnvironment, env = process.env) {
  const genericCandidates = [
    env.ARENZYRA_API_URL,
    env.ARENZYRA_API_BASE,
    env.VITE_API_BASE_URL,
    env.NEXT_PUBLIC_API_URL,
    env.API_BASE_URL,
  ];

  if (apiEnvironment === "dev") {
    return [
      env.ARENZYRA_DEV_API_BASE,
      env.VITE_DEV_API_BASE_URL,
      env.DEV_API_BASE_URL,
      ...genericCandidates,
    ];
  }

  if (apiEnvironment === "lan") {
    return [
      env.ARENZYRA_LAN_API_BASE,
      env.LAN_API_BASE_URL,
      ...genericCandidates,
    ];
  }

  if (apiEnvironment === "staging") {
    return [
      env.ARENZYRA_STAGING_API_BASE,
      env.STAGING_API_BASE_URL,
      ...genericCandidates,
    ];
  }

  return [
    env.ARENZYRA_PRODUCTION_API_BASE,
    env.PRODUCTION_API_BASE_URL,
    ...genericCandidates,
  ];
}

function normalizeApiBaseCandidate(value, defaultProtocol) {
  const trimmed = String(value || "").trim();
  if (!trimmed) {
    return "";
  }

  const candidate = trimmed.includes("://")
    ? trimmed
    : `${defaultProtocol}//${trimmed}`;

  try {
    return new URL(candidate).toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

function resolveProcessApiEnvironment(env = process.env) {
  if (String(env.DEV_SERVER_PORT || "").trim()) {
    return "dev";
  }

  const resolvedEnvironment = normalizeApiEnvironment(
    env.ARENZYRA_API_ENV || env.ARENZYRA_ENV || env.NODE_ENV,
  );

  return resolvedEnvironment === "auto" ? "production" : resolvedEnvironment;
}

function getProcessDefaultApiBase(env = process.env) {
  const apiEnvironment = resolveProcessApiEnvironment(env);
  const defaultProtocol = getDefaultProtocolForEnvironment(apiEnvironment);

  for (const candidate of getEnvironmentApiBaseCandidates(apiEnvironment, env)) {
    const normalizedCandidate = normalizeApiBaseCandidate(
      candidate,
      defaultProtocol,
    );
    if (normalizedCandidate) {
      return normalizedCandidate;
    }
  }

  return apiEnvironment === "dev"
    ? DEFAULT_LOCAL_API_BASE
    : DEFAULT_PRODUCTION_API_BASE;
}

module.exports = {
  DEFAULT_LOCAL_API_BASE,
  DEFAULT_PRODUCTION_API_BASE,
  getDefaultProtocolForEnvironment,
  getProcessDefaultApiBase,
  normalizeApiEnvironment,
  normalizeApiBaseCandidate,
  resolveProcessApiEnvironment,
};
