"use strict";

const crypto = require("node:crypto");
const http = require("node:http");

const { assertSafeToken } = require("./config.cjs");
const { normalizeCs2GsiPayload } = require("./normalizer.cjs");

const LOOPBACK_HOST = "127.0.0.1";
const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;
const DEFAULT_REQUEST_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_REQUESTS_PER_SECOND = 30;

function isAuthorizedToken(actual, expected) {
  if (typeof actual !== "string") {
    return false;
  }
  const actualBuffer = Buffer.from(actual, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  return (
    actualBuffer.length === expectedBuffer.length &&
    crypto.timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

function sendJson(response, statusCode, payload) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.end(JSON.stringify(payload));
}

function readJsonBody(request, maxBodyBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;

    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBodyBytes) {
        tooLarge = true;
        chunks.length = 0;
        return;
      }
      if (!tooLarge) {
        chunks.push(chunk);
      }
    });

    request.on("end", () => {
      if (tooLarge) {
        const error = new Error("CS2 GSI payload is too large.");
        error.statusCode = 413;
        reject(error);
        return;
      }

      try {
        const body = Buffer.concat(chunks).toString("utf8");
        resolve(JSON.parse(body));
      } catch {
        const error = new Error("CS2 GSI payload is not valid JSON.");
        error.statusCode = 400;
        reject(error);
      }
    });

    request.on("error", reject);
  });
}

function assertLoopbackHost(host) {
  if (host !== LOOPBACK_HOST) {
    throw new Error("CS2 GSI listener must bind to 127.0.0.1.");
  }
}

function isLoopbackRemoteAddress(address) {
  return address === "127.0.0.1" || address === "::ffff:127.0.0.1";
}

async function startCs2GsiServer(options = {}) {
  const host = options.host || LOOPBACK_HOST;
  assertLoopbackHost(host);

  const port = options.port ?? 0;
  if (
    !Number.isInteger(port) ||
    port < 0 ||
    port > 65_535
  ) {
    throw new Error("CS2 GSI listener port must be an integer from 0-65535.");
  }

  const token = assertSafeToken(options.token);
  const maxBodyBytes =
    Number.isInteger(options.maxBodyBytes) && options.maxBodyBytes > 0
      ? options.maxBodyBytes
      : DEFAULT_MAX_BODY_BYTES;
  const requestTimeoutMs =
    Number.isInteger(options.requestTimeoutMs) && options.requestTimeoutMs > 0
      ? options.requestTimeoutMs
      : DEFAULT_REQUEST_TIMEOUT_MS;
  const maxRequestsPerSecond =
    Number.isInteger(options.maxRequestsPerSecond) &&
    options.maxRequestsPerSecond > 0
      ? options.maxRequestsPerSecond
      : DEFAULT_MAX_REQUESTS_PER_SECOND;
  const onSnapshot =
    typeof options.onSnapshot === "function" ? options.onSnapshot : () => {};

  const status = {
    acceptedSnapshots: 0,
    rejectedRequests: 0,
    lastSnapshotAt: null,
    lastError: null,
  };
  let rateWindowStartedAt = 0;
  let requestsInRateWindow = 0;

  const server = http.createServer(async (request, response) => {
    response.setHeader("Referrer-Policy", "no-referrer");

    if (!isLoopbackRemoteAddress(request.socket.remoteAddress)) {
      status.rejectedRequests += 1;
      sendJson(response, 403, { error: "loopback-only" });
      request.resume();
      return;
    }

    const address = server.address();
    const expectedHost = `${LOOPBACK_HOST}:${address.port}`;
    if (String(request.headers.host || "").toLowerCase() !== expectedHost) {
      status.rejectedRequests += 1;
      sendJson(response, 400, { error: "invalid-host" });
      request.resume();
      return;
    }

    if (request.method === "GET" && request.url === "/health") {
      sendJson(response, 200, {
        ok: true,
        source: "CS2_GSI",
        acceptedSnapshots: status.acceptedSnapshots,
        lastSnapshotAt: status.lastSnapshotAt,
      });
      return;
    }

    if (request.url !== "/gsi") {
      status.rejectedRequests += 1;
      sendJson(response, 404, { error: "not-found" });
      request.resume();
      return;
    }

    if (request.method !== "POST") {
      status.rejectedRequests += 1;
      response.setHeader("Allow", "POST");
      sendJson(response, 405, { error: "method-not-allowed" });
      request.resume();
      return;
    }

    const contentEncoding = String(request.headers["content-encoding"] || "")
      .toLowerCase()
      .trim();
    if (contentEncoding && contentEncoding !== "identity") {
      status.rejectedRequests += 1;
      sendJson(response, 415, { error: "content-encoding-not-supported" });
      request.resume();
      return;
    }

    const contentType = String(request.headers["content-type"] || "")
      .toLowerCase()
      .split(";", 1)[0]
      .trim();
    if (contentType !== "application/json") {
      status.rejectedRequests += 1;
      sendJson(response, 415, { error: "content-type-must-be-json" });
      request.resume();
      return;
    }

    const contentLength = Number(request.headers["content-length"]);
    if (
      Number.isFinite(contentLength) &&
      contentLength > maxBodyBytes
    ) {
      status.rejectedRequests += 1;
      sendJson(response, 413, { error: "payload-too-large" });
      request.resume();
      return;
    }

    request.setTimeout(requestTimeoutMs, () => {
      request.destroy(new Error("CS2 GSI request timed out."));
    });

    let snapshot;
    try {
      const payload = await readJsonBody(request, maxBodyBytes);
      if (!isAuthorizedToken(payload?.auth?.token, token)) {
        status.rejectedRequests += 1;
        sendJson(response, 401, { error: "unauthorized" });
        return;
      }

      const now = Date.now();
      if (now - rateWindowStartedAt >= 1_000) {
        rateWindowStartedAt = now;
        requestsInRateWindow = 0;
      }
      requestsInRateWindow += 1;
      if (requestsInRateWindow > maxRequestsPerSecond) {
        status.rejectedRequests += 1;
        response.setHeader("Retry-After", "1");
        sendJson(response, 429, { error: "rate-limit-exceeded" });
        return;
      }

      snapshot = normalizeCs2GsiPayload(payload);
    } catch (error) {
      const statusCode =
        Number.isInteger(error?.statusCode) &&
        error.statusCode >= 400 &&
        error.statusCode <= 599
          ? error.statusCode
          : 400;
      status.rejectedRequests += 1;
      status.lastError = error?.message || "Unknown CS2 GSI error.";
      sendJson(response, statusCode, {
        error:
          statusCode === 413
            ? "payload-too-large"
            : "invalid-gsi-payload",
      });
      return;
    }

    try {
      await Promise.resolve(onSnapshot(snapshot));
    } catch {
      status.rejectedRequests += 1;
      status.lastError = "CS2 GSI snapshot handler failed.";
      sendJson(response, 500, { error: "snapshot-handler-failed" });
      return;
    }

    status.acceptedSnapshots += 1;
    status.lastSnapshotAt = snapshot.receivedAt;
    status.lastError = null;
    response.statusCode = 204;
    response.setHeader("Cache-Control", "no-store");
    response.end();
  });

  server.headersTimeout = requestTimeoutMs + 1_000;
  server.requestTimeout = requestTimeoutMs;
  server.keepAliveTimeout = 1_000;
  server.maxHeadersCount = 32;

  await new Promise((resolve, reject) => {
    const handleError = (error) => {
      server.removeListener("listening", handleListening);
      reject(error);
    };
    const handleListening = () => {
      server.removeListener("error", handleError);
      resolve();
    };
    server.once("error", handleError);
    server.once("listening", handleListening);
    server.listen(port, host);
  });

  const address = server.address();
  return {
    host,
    port: address.port,
    url: `http://${host}:${address.port}/gsi`,
    getStatus() {
      return { ...status };
    },
    close() {
      return new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  };
}

module.exports = {
  DEFAULT_MAX_REQUESTS_PER_SECOND,
  DEFAULT_MAX_BODY_BYTES,
  LOOPBACK_HOST,
  startCs2GsiServer,
};
