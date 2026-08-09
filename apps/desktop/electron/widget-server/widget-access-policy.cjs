"use strict";

const crypto = require("node:crypto");

const ACCESS_QUERY = "access_token";
const ACCESS_COOKIE = "ArenzyraWidgetAccess";

function normalizeHostname(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
}

function requestHostname(request) {
  const host = String(request?.headers?.host || "").trim();
  if (!host) {
    return "";
  }
  try {
    return normalizeHostname(new URL(`http://${host}`).hostname);
  } catch {
    return "";
  }
}

function cookieValue(request, name) {
  const cookieHeader = String(request?.headers?.cookie || "");
  for (const pair of cookieHeader.split(";")) {
    const separator = pair.indexOf("=");
    if (separator < 0 || pair.slice(0, separator).trim() !== name) {
      continue;
    }
    try {
      return decodeURIComponent(pair.slice(separator + 1).trim());
    } catch {
      return "";
    }
  }
  return "";
}

function requestUrl(request) {
  try {
    return new URL(String(request?.url || "/"), "http://widget.local");
  } catch {
    return new URL("http://widget.local/");
  }
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ""));
  const rightBuffer = Buffer.from(String(right || ""));
  return (
    leftBuffer.length > 0 &&
    leftBuffer.length === rightBuffer.length &&
    crypto.timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function createWidgetAccessPolicy({ token, allowedHosts = [], log = () => {} } = {}) {
  const normalizedToken = String(token || "").trim();
  const enabled = normalizedToken.length >= 24;
  const hosts = new Set(
    ["localhost", "127.0.0.1", "::1", ...allowedHosts]
      .map(normalizeHostname)
      .filter(Boolean),
  );

  function hasAllowedHost(request) {
    return hosts.has(requestHostname(request));
  }

  function hasAllowedOrigin(request) {
    const origin = String(request?.headers?.origin || "").trim();
    if (!origin) {
      return true;
    }
    try {
      const parsed = new URL(origin);
      const originHost = normalizeHostname(parsed.hostname);
      const requestHost = requestHostname(request);
      return (
        (parsed.protocol === "http:" || parsed.protocol === "https:") &&
        hosts.has(originHost) &&
        originHost === requestHost
      );
    } catch {
      return false;
    }
  }

  function suppliedToken(request) {
    const urlToken = requestUrl(request).searchParams.get(ACCESS_QUERY);
    const headerToken = request?.headers?.["x-arenzyra-widget-token"];
    return (
      String(urlToken || "").trim() ||
      String(headerToken || "").trim() ||
      cookieValue(request, ACCESS_COOKIE)
    );
  }

  function authorizeRequest(request) {
    return (
      hasAllowedHost(request) &&
      hasAllowedOrigin(request) &&
      (!enabled || safeEqual(suppliedToken(request), normalizedToken))
    );
  }

  function middleware(request, response, next) {
    if (!hasAllowedHost(request)) {
      response.status(421).json({ error: "Unrecognized widget host" });
      return;
    }
    if (!hasAllowedOrigin(request)) {
      response.status(403).json({ error: "Widget origin is not allowed" });
      return;
    }

    const origin = String(request.headers.origin || "").trim();
    if (origin) {
      response.setHeader("Access-Control-Allow-Origin", origin);
      response.setHeader("Access-Control-Allow-Credentials", "true");
      response.setHeader("Vary", "Origin");
    }
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("X-Content-Type-Options", "nosniff");
    if (request.method === "OPTIONS") {
      response.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type, X-Arenzyra-Widget-Token",
      );
      response.setHeader("Access-Control-Allow-Methods", "GET, HEAD, POST, OPTIONS");
      response.status(204).end();
      return;
    }

    if (request.path === "/health") {
      next();
      return;
    }
    if (!enabled || safeEqual(suppliedToken(request), normalizedToken)) {
      if (enabled && requestUrl(request).searchParams.has(ACCESS_QUERY)) {
        response.append(
          "Set-Cookie",
          `${ACCESS_COOKIE}=${encodeURIComponent(normalizedToken)}; Path=/; HttpOnly; SameSite=Strict`,
        );
      }
      next();
      return;
    }

    log("[widget-access] rejected unauthenticated request", {
      method: request.method,
      path: request.path,
    });
    response.status(401).json({ error: "Widget access token is required" });
  }

  function authorizeUrl(baseUrl) {
    if (!enabled || !baseUrl) {
      return baseUrl ?? null;
    }
    const parsed = new URL(baseUrl);
    parsed.searchParams.set(ACCESS_QUERY, normalizedToken);
    return parsed.toString();
  }

  return {
    authorizeRequest,
    authorizeUrl,
    enabled,
    middleware,
  };
}

module.exports = {
  ACCESS_COOKIE,
  ACCESS_QUERY,
  createWidgetAccessPolicy,
};
