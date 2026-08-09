"use strict";

const crypto = require("node:crypto");

const CONNECTOR_TOKEN_HEADER = "x-arenzyra-connector-token";
const MIN_CAPABILITY_LENGTH = 24;

function normalizeHostname(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
}

function isLoopbackHostname(value) {
  const hostname = normalizeHostname(value);
  if (hostname === "localhost" || hostname === "::1") {
    return true;
  }
  if (!/^127(?:\.\d{1,3}){3}$/.test(hostname)) {
    return false;
  }
  return hostname
    .split(".")
    .every((part) => Number(part) >= 0 && Number(part) <= 255);
}

function isLoopbackRemoteAddress(value) {
  const address = normalizeHostname(value);
  return (
    isLoopbackHostname(address) ||
    (address.startsWith("::ffff:") &&
      isLoopbackHostname(address.slice("::ffff:".length)))
  );
}

function parseAuthority(value) {
  const authority = String(value || "").trim();
  if (!authority || /[\s/@]/.test(authority)) {
    return null;
  }
  try {
    const parsed = new URL(`http://${authority}`);
    return {
      hostname: normalizeHostname(parsed.hostname),
      port: parsed.port,
    };
  } catch {
    return null;
  }
}

function hasAllowedHost(request, expectedPort) {
  const authority = parseAuthority(request?.headers?.host);
  if (!authority || !isLoopbackHostname(authority.hostname)) {
    return false;
  }
  const port = String(expectedPort || "").trim();
  if (!port) {
    return false;
  }
  return authority.port === port || (port === "80" && authority.port === "");
}

function requestUrl(request) {
  try {
    return new URL(String(request?.originalUrl || request?.url || "/"), "http://pcob.local");
  } catch {
    return new URL("http://pcob.local/");
  }
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ""), "utf8");
  const rightBuffer = Buffer.from(String(right || ""), "utf8");
  return (
    leftBuffer.length > 0 &&
    leftBuffer.length === rightBuffer.length &&
    crypto.timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function suppliedCapability(request) {
  const headers = request?.headers || {};
  return String(headers[CONNECTOR_TOKEN_HEADER] || "").trim();
}

function requestPath(request) {
  const path = String(request?.path || requestUrl(request).pathname || "");
  return path.toLowerCase();
}

function isTrustedPcobIngress(request) {
  if (String(request?.method || "").toUpperCase() !== "POST") {
    return false;
  }
  if (
    String(request?.headers?.origin || "").trim() ||
    String(request?.headers?.["sec-fetch-site"] || "").trim()
  ) {
    return false;
  }
  return /^\/(?:totalmessage|set[a-z0-9]{1,64})$/.test(requestPath(request));
}

function createConnectorHttpAccessPolicy({ token, port, log = () => {} } = {}) {
  const capability = String(token || "").trim();
  const expectedPort = Number(port);
  if (capability.length < MIN_CAPABILITY_LENGTH) {
    throw new Error(
      `PCOB local capability must be at least ${MIN_CAPABILITY_LENGTH} characters.`,
    );
  }
  if (!Number.isInteger(expectedPort) || expectedPort < 1 || expectedPort > 65535) {
    throw new Error("PCOB local HTTP port is invalid.");
  }

  function authorizeCapability(request) {
    return safeEqual(suppliedCapability(request), capability);
  }

  function middleware(request, response, next) {
    if (!isLoopbackRemoteAddress(request?.socket?.remoteAddress)) {
      response.status(403).json({ error: "pcob_loopback_required" });
      return;
    }
    if (!hasAllowedHost(request, expectedPort)) {
      response.status(421).json({ error: "pcob_host_not_allowed" });
      return;
    }

    if (String(request?.headers?.origin || "").trim()) {
      response.status(403).json({ error: "pcob_origin_not_allowed" });
      return;
    }

    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("X-Content-Type-Options", "nosniff");
    if (String(request.method || "").toUpperCase() === "OPTIONS") {
      response.status(403).json({ error: "pcob_browser_cors_disabled" });
      return;
    }

    if (isTrustedPcobIngress(request) || authorizeCapability(request)) {
      next();
      return;
    }

    log("[connector-access] rejected request without the per-launch capability", {
      method: request.method,
      path: requestPath(request),
    });
    response.status(401).json({ error: "pcob_local_capability_required" });
  }

  return {
    authorizeCapability,
    isTrustedPcobIngress,
    middleware,
  };
}

module.exports = {
  CONNECTOR_TOKEN_HEADER,
  MIN_CAPABILITY_LENGTH,
  createConnectorHttpAccessPolicy,
  hasAllowedHost,
  isLoopbackHostname,
  isLoopbackRemoteAddress,
  isTrustedPcobIngress,
};
