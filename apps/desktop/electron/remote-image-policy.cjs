"use strict";

const axios = require("axios");
const crypto = require("node:crypto");
const sharp = require("sharp");

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
const DEFAULT_MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
const DEFAULT_MAX_PIXELS = 16 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 10_000;
const ALLOWED_FORMATS = new Set(["jpeg", "png", "webp"]);

function normalizeOrigin(value) {
  try {
    const parsed = new URL(String(value || ""));
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    if (parsed.username || parsed.password) return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

function collectAllowedMediaOrigins(baseUrl, options = {}) {
  const origins = new Set();
  const apiOrigin = normalizeOrigin(baseUrl);
  if (apiOrigin) origins.add(apiOrigin);

  const configured = [
    ...(Array.isArray(options.allowedOrigins) ? options.allowedOrigins : []),
    ...String(
      options.mediaOrigins ?? process.env.ARENZYRA_MEDIA_ALLOWED_ORIGINS ?? "",
    )
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  ];
  for (const value of configured) {
    const origin = normalizeOrigin(value);
    if (!origin) continue;
    const parsed = new URL(origin);
    if (parsed.protocol !== "https:") continue;
    origins.add(origin);
  }
  return origins;
}

function resolveAllowedRemoteImageUrl(baseUrl, candidate, options = {}) {
  const raw = String(candidate || "").trim();
  if (
    !raw ||
    /^[a-zA-Z]:[\\/]/.test(raw) ||
    raw.startsWith("\\\\")
  ) {
    return null;
  }

  try {
    const parsed = new URL(raw, `${String(baseUrl || "").replace(/\/$/, "")}/`);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    if (parsed.username || parsed.password) return null;
    if (!collectAllowedMediaOrigins(baseUrl, options).has(parsed.origin)) {
      return null;
    }
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return null;
  }
}

function hasAllowedRasterMagic(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return false;
  if (buffer.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) {
    return true;
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return true;
  }
  return (
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  );
}

async function sanitizeRasterImage(buffer, options = {}) {
  const maxPixels = Number(options.maxPixels || DEFAULT_MAX_PIXELS);
  const maxOutputBytes = Number(
    options.maxOutputBytes || DEFAULT_MAX_OUTPUT_BYTES,
  );
  if (!hasAllowedRasterMagic(buffer)) {
    throw new Error("Remote image did not contain an allowed raster format.");
  }

  const pipeline = sharp(buffer, {
    failOn: "warning",
    limitInputPixels: maxPixels,
    sequentialRead: true,
  });
  const metadata = await pipeline.metadata();
  const width = Number(metadata.width || 0);
  const height = Number(metadata.height || 0);
  if (
    !ALLOWED_FORMATS.has(String(metadata.format || "").toLowerCase()) ||
    width <= 0 ||
    height <= 0 ||
    width * height > maxPixels
  ) {
    throw new Error("Remote image dimensions or format are not allowed.");
  }

  const output = await pipeline
    .rotate()
    .ensureAlpha()
    .png({ compressionLevel: 9 })
    .toBuffer();
  if (output.length > maxOutputBytes) {
    throw new Error("Sanitized remote image exceeds the output size limit.");
  }
  return output;
}

async function downloadAndSanitizeRemoteImage({
  baseUrl,
  url,
  allowedOrigins,
  mediaOrigins,
  maxBytes = DEFAULT_MAX_BYTES,
  maxOutputBytes = DEFAULT_MAX_OUTPUT_BYTES,
  maxPixels = DEFAULT_MAX_PIXELS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  httpClient = axios,
}) {
  const resolvedUrl = resolveAllowedRemoteImageUrl(baseUrl, url, {
    allowedOrigins,
    mediaOrigins,
  });
  if (!resolvedUrl) {
    throw new Error("Remote image URL is outside the configured media origins.");
  }

  const response = await httpClient.get(resolvedUrl, {
    responseType: "arraybuffer",
    timeout: timeoutMs,
    maxRedirects: 0,
    maxContentLength: maxBytes,
    maxBodyLength: maxBytes,
    headers: { Accept: "image/png,image/jpeg,image/webp" },
    validateStatus: (status) => status >= 200 && status < 300,
  });
  const declaredLength = Number(response?.headers?.["content-length"] || 0);
  const contentType = String(response?.headers?.["content-type"] || "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (
    (declaredLength && declaredLength > maxBytes) ||
    !["image/png", "image/jpeg", "image/webp"].includes(contentType)
  ) {
    throw new Error("Remote image response type or size is not allowed.");
  }

  const input = Buffer.from(response.data || []);
  if (!input.length || input.length > maxBytes) {
    throw new Error("Remote image response exceeds the input size limit.");
  }
  const buffer = await sanitizeRasterImage(input, {
    maxOutputBytes,
    maxPixels,
  });
  return { buffer, url: resolvedUrl, contentType: "image/png" };
}

function remoteImageReference(value) {
  return `sha256:${crypto
    .createHash("sha256")
    .update(String(value || ""), "utf8")
    .digest("hex")
    .slice(0, 12)}`;
}

module.exports = {
  DEFAULT_MAX_BYTES,
  collectAllowedMediaOrigins,
  downloadAndSanitizeRemoteImage,
  hasAllowedRasterMagic,
  remoteImageReference,
  resolveAllowedRemoteImageUrl,
  sanitizeRasterImage,
};
