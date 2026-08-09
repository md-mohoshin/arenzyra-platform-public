import sharp from "sharp";

const DISCORD_MEDIA_ORIGINS = new Set([
  "https://cdn.discordapp.com",
  "https://media.discordapp.net",
  "https://images-ext-1.discordapp.net",
  "https://images-ext-2.discordapp.net",
]);
const OFFICIAL_API_ORIGIN = "https://api.arenzyra.com";
const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;
const DEFAULT_MAX_PIXELS = 16 * 1024 * 1024;
const DEFAULT_MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 10_000;
const ALLOWED_CONTENT_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const ALLOWED_FORMATS = new Set(["jpeg", "png", "webp"]);

export type RemoteImageFetchOptions = {
  apiBaseUrl?: string;
  allowedOrigins?: string[];
  mediaOrigins?: string;
  maxBytes?: number;
  maxPixels?: number;
  maxOutputBytes?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
};

function normalizeOrigin(value: string | null | undefined) {
  try {
    const parsed = new URL(String(value ?? ""));
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    if (parsed.username || parsed.password) return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

export function collectRemoteImageOrigins(options: RemoteImageFetchOptions = {}) {
  const origins = new Set(DISCORD_MEDIA_ORIGINS);
  origins.add(OFFICIAL_API_ORIGIN);
  const apiBaseUrl =
    options.apiBaseUrl ?? process.env.ARENZYRA_API_BASE_URL ?? "";
  const apiOrigin = normalizeOrigin(apiBaseUrl);
  if (apiOrigin) origins.add(apiOrigin);

  const configured = [
    ...(options.allowedOrigins ?? []),
    ...String(
      options.mediaOrigins ??
        process.env.ARENZYRA_MEDIA_ALLOWED_ORIGINS ??
        "",
    )
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  ];
  for (const value of configured) {
    const origin = normalizeOrigin(value);
    if (origin && new URL(origin).protocol === "https:") origins.add(origin);
  }
  return origins;
}

export function resolveAllowedRemoteImageUrl(
  value: string,
  options: RemoteImageFetchOptions = {},
) {
  const apiBaseUrl =
    options.apiBaseUrl ?? process.env.ARENZYRA_API_BASE_URL ?? "";
  try {
    const parsed = new URL(value, apiBaseUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    if (parsed.username || parsed.password || parsed.hash) return null;
    if (!collectRemoteImageOrigins(options).has(parsed.origin)) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function hasAllowedRasterMagic(buffer: Buffer) {
  if (buffer.length < 12) return false;
  return (
    buffer.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")) ||
    (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) ||
    (buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
      buffer.subarray(8, 12).toString("ascii") === "WEBP")
  );
}

async function readBodyWithLimit(response: Response, limit: number) {
  if (!response.body) throw new Error("Remote image response body is empty.");
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel().catch(() => undefined);
        throw new Error("Remote image exceeds the streamed byte limit.");
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}

export async function fetchRemoteRasterImage(
  value: string,
  options: RemoteImageFetchOptions = {},
) {
  const resolvedUrl = resolveAllowedRemoteImageUrl(value, options);
  if (!resolvedUrl) {
    throw new Error("Remote image URL is outside the configured media origins.");
  }
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxPixels = options.maxPixels ?? DEFAULT_MAX_PIXELS;
  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  const controller = new AbortController();
  const abort = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  timeout.unref?.();

  try {
    const response = await (options.fetchImpl ?? fetch)(resolvedUrl, {
      redirect: "error",
      signal: controller.signal,
      headers: { accept: "image/png,image/jpeg,image/webp" },
    });
    if (!response.ok) {
      throw new Error(`Remote image request failed with ${response.status}.`);
    }
    const contentType = String(response.headers.get("content-type") ?? "")
      .split(";", 1)[0]
      .trim()
      .toLowerCase();
    const contentLength = Number(response.headers.get("content-length") ?? 0);
    if (
      !ALLOWED_CONTENT_TYPES.has(contentType) ||
      (Number.isFinite(contentLength) && contentLength > maxBytes)
    ) {
      throw new Error("Remote image response type or size is not allowed.");
    }

    const source = await readBodyWithLimit(response, maxBytes);
    if (!hasAllowedRasterMagic(source)) {
      throw new Error("Remote image did not contain an allowed raster format.");
    }
    const pipeline = sharp(source, {
      failOn: "warning",
      limitInputPixels: maxPixels,
      sequentialRead: true,
    });
    const metadata = await pipeline.metadata();
    const width = Number(metadata.width ?? 0);
    const height = Number(metadata.height ?? 0);
    if (
      !ALLOWED_FORMATS.has(String(metadata.format ?? "").toLowerCase()) ||
      width <= 0 ||
      height <= 0 ||
      width * height > maxPixels
    ) {
      throw new Error("Remote image dimensions or format are not allowed.");
    }
    const buffer = await pipeline
      .rotate()
      .ensureAlpha()
      .png({ compressionLevel: 9 })
      .toBuffer();
    if (buffer.length > maxOutputBytes) {
      throw new Error("Sanitized remote image exceeds the output size limit.");
    }
    return { buffer, contentType: "image/png" as const, url: resolvedUrl };
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abort);
  }
}
