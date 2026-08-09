"use strict";

const path = require("node:path");
const { fileURLToPath } = require("node:url");

const IPC_SENDER_REJECTED_CODE = "ARENZYRA_IPC_SENDER_REJECTED";

function normalizeFilePath(value) {
  const resolved = path.resolve(String(value || ""));
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function isAllowedLauncherRendererUrl(value, options = {}) {
  let parsed;
  try {
    parsed = new URL(String(value || ""));
  } catch {
    return false;
  }

  if (parsed.protocol === "file:") {
    try {
      return (
        normalizeFilePath(fileURLToPath(parsed)) ===
        normalizeFilePath(options.rendererFilePath)
      );
    } catch {
      return false;
    }
  }

  if (options.isDev !== true || parsed.protocol !== "http:") {
    return false;
  }

  const allowedDevOrigins = Array.isArray(options.allowedDevOrigins)
    ? options.allowedDevOrigins
    : [];
  return allowedDevOrigins.includes(parsed.origin);
}

function assertTrustedLauncherIpcSender(event, options = {}) {
  const expectedWebContents = options.getMainWebContents?.() ?? null;
  const sender = event?.sender ?? null;
  const senderFrame = event?.senderFrame ?? null;
  const mainFrame = sender?.mainFrame ?? null;
  const senderUrl = String(senderFrame?.url || sender?.getURL?.() || "");

  if (
    !expectedWebContents ||
    expectedWebContents.isDestroyed?.() === true ||
    sender !== expectedWebContents ||
    !senderFrame ||
    (mainFrame && senderFrame !== mainFrame) ||
    !isAllowedLauncherRendererUrl(senderUrl, options)
  ) {
    const error = new Error("Launcher IPC request was rejected.");
    error.code = IPC_SENDER_REJECTED_CODE;
    throw error;
  }
}

module.exports = {
  IPC_SENDER_REJECTED_CODE,
  assertTrustedLauncherIpcSender,
  isAllowedLauncherRendererUrl,
};
