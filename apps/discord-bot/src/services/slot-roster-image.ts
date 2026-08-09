import { createHash } from "node:crypto";
import sharp from "sharp";
import { botConfig } from "../config";
import { fetchRemoteRasterImage } from "../security/remote-image";

const LOGO_SIZE = 56;
const ROSTER_WIDTH = 1080;
const ROSTER_HEADER_HEIGHT = 88;
const ROSTER_ROW_HEIGHT = 72;
const ROSTER_ROWS_PER_PAGE = 32;
const MAX_ROSTER_PAGES = 5;
const MAX_ROSTER_ROWS = ROSTER_ROWS_PER_PAGE * MAX_ROSTER_PAGES;
const MAX_SOURCE_LOGO_BYTES = 4 * 1024 * 1024;
const MAX_RENDERED_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_LOGO_INPUT_PIXELS = 4096 * 4096;
const LOGO_FETCH_TIMEOUT_MS = 5_000;
const LOGO_FETCH_CONCURRENCY = 4;
const MAX_PENDING_LOGOS = 320;
const LOGO_RESOLUTION_BUDGET_MS = 15_000;
const LOGO_CACHE_TTL_MS = 10 * 60_000;
const MAX_LOGO_CACHE_ENTRIES = 160;
const MAX_LOGO_CACHE_BYTES = 16 * 1024 * 1024;
const ROSTER_CACHE_TTL_MS = 2 * 60_000;
const MAX_ROSTER_CACHE_ENTRIES = 64;
const MAX_ROSTER_CACHE_BYTES = 32 * 1024 * 1024;
const PUBLIC_API_HOST = "api.arenzyra.com";
const DISCORD_CDN_HOST = "cdn.discordapp.com";

export type SlotRosterKind = "slots" | "waitlist";

export type SlotRosterImageRow = {
  position: string;
  teamName: string;
  teamTag?: string | null;
  status?: string | null;
  logoUrl?: string | null;
  empty?: boolean;
};

export type SlotRosterImagePage = {
  attachment: Buffer;
  name: string;
  description: string;
  rows: number;
};

export type SlotRosterImageOptions = {
  serverDefaultLogoUrl?: string | null;
};

type CachedLogo = {
  buffer: Buffer;
  expiresAt: number;
};

type CachedRoster = {
  pages: SlotRosterImagePage[];
  expiresAt: number;
  bytes: number;
};

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function truncate(value: string | null | undefined, maxLength: number) {
  const normalized = (value ?? "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function statusColor(status: string | null | undefined) {
  switch ((status ?? "").trim().toUpperCase()) {
    case "CONFIRM":
    case "CONFIRMED":
    case "CHECKED_IN":
      return "#22c55e";
    case "NOT_PLAYING":
    case "DECLINED":
      return "#ef4444";
    case "WAITLIST":
      return "#f59e0b";
    default:
      return "#60a5fa";
  }
}

export class SlotRosterImageRenderer {
  private readonly logoCache = new Map<string, CachedLogo>();
  private readonly pendingLogos = new Map<string, Promise<Buffer | null>>();
  private readonly rosterCache = new Map<string, CachedRoster>();
  private activeLogoFetches = 0;
  private readonly logoFetchWaiters: Array<() => void> = [];

  async render(
    kind: SlotRosterKind,
    sessionId: string,
    title: string,
    rows: SlotRosterImageRow[],
    options: SlotRosterImageOptions = {},
  ): Promise<SlotRosterImagePage[]> {
    const visibleRows = rows.slice(0, MAX_ROSTER_ROWS);
    if (visibleRows.length === 0) {
      return [];
    }
    const serverDefaultLogoUrl = this.serverDefaultLogoUrl(
      options.serverDefaultLogoUrl,
    );
    const rosterCacheKey = createHash("sha256")
      .update(
        JSON.stringify({
          kind,
          sessionId,
          title,
          rows: visibleRows,
          serverDefaultLogoUrl,
        }),
      )
      .digest("hex");
    this.evictExpiredRosterCacheEntries();
    const cachedRoster = this.rosterCache.get(rosterCacheKey);
    if (cachedRoster && cachedRoster.expiresAt > Date.now()) {
      this.rosterCache.delete(rosterCacheKey);
      this.rosterCache.set(rosterCacheKey, cachedRoster);
      return cachedRoster.pages;
    }

    const logos = await this.resolveLogos(
      visibleRows,
      serverDefaultLogoUrl,
    );
    const serverDefaultLogo = serverDefaultLogoUrl
      ? (logos.get(serverDefaultLogoUrl) ?? null)
      : null;
    let needsServerDefault = false;
    let hasUnresolvedTeamLogo = false;
    for (const row of visibleRows) {
      if (row.empty) {
        continue;
      }
      const canonicalUrl = this.canonicalLogoUrl(row.logoUrl);
      if (!canonicalUrl || !logos.has(canonicalUrl)) {
        needsServerDefault = true;
      }
      if (canonicalUrl && !logos.has(canonicalUrl)) {
        hasUnresolvedTeamLogo = true;
      }
    }
    if (needsServerDefault && !serverDefaultLogo) {
      throw new Error(
        "server default team logo is unavailable; refusing to render incomplete roster rows",
      );
    }
    const pages: SlotRosterImagePage[] = [];
    for (
      let offset = 0;
      offset < visibleRows.length && pages.length < MAX_ROSTER_PAGES;
      offset += ROSTER_ROWS_PER_PAGE
    ) {
      const pageRows = visibleRows.slice(offset, offset + ROSTER_ROWS_PER_PAGE);
      const pageNumber = pages.length + 1;
      const pageCount = Math.ceil(
        visibleRows.length / ROSTER_ROWS_PER_PAGE,
      );
      const attachment = await this.renderPage(
        kind,
        title,
        pageRows,
        logos,
        serverDefaultLogo,
        pageNumber,
        pageCount,
      );
      if (attachment.length > MAX_RENDERED_IMAGE_BYTES) {
        throw new Error(
          `rendered ${kind} roster page exceeds the Discord attachment limit`,
        );
      }

      const digest = createHash("sha256")
        .update(attachment)
        .digest("hex")
        .slice(0, 12);
      const sessionDigest = createHash("sha256")
        .update(sessionId)
        .digest("hex")
        .slice(0, 10);
      pages.push({
        attachment,
        name: `arenzyra-${kind}-${sessionDigest}-p${pageNumber}-${digest}.png`,
        description: `${title}, page ${pageNumber} of ${pageCount}`,
        rows: pageRows.length,
      });
    }
    // A canonical team-logo URL that temporarily failed is rendered with the
    // server icon for this sync, but that degraded page must not hide recovery
    // behind the rendered-page TTL. The bounded normalized-logo cache still
    // makes successful assets cheap to reuse.
    if (!hasUnresolvedTeamLogo) {
      this.rosterCache.set(rosterCacheKey, {
        pages,
        expiresAt: Date.now() + ROSTER_CACHE_TTL_MS,
        bytes: pages.reduce((total, page) => total + page.attachment.length, 0),
      });
      this.enforceRosterCacheLimits();
    }
    return pages;
  }

  private async resolveLogos(
    rows: SlotRosterImageRow[],
    serverDefaultLogoUrl: string | null,
  ) {
    const urls = [
      ...new Set(
        [
          serverDefaultLogoUrl,
          ...rows
            .filter((row) => !row.empty)
            .map((row) => this.canonicalLogoUrl(row.logoUrl)),
        ].filter((url): url is string => Boolean(url)),
      ),
    ];
    const logos = new Map<string, Buffer>();
    const deadline = Date.now() + LOGO_RESOLUTION_BUDGET_MS;
    let cursor = 0;
    const worker = async () => {
      while (cursor < urls.length && Date.now() < deadline) {
        const index = cursor;
        cursor += 1;
        const url = urls[index];
        const logo = await this.loadLogoBeforeDeadline(url, deadline);
        if (logo) {
          logos.set(url, logo);
        }
      }
    };
    await Promise.all(
      Array.from(
        { length: Math.min(LOGO_FETCH_CONCURRENCY, urls.length) },
        () => worker(),
      ),
    );
    return logos;
  }

  private async loadLogoBeforeDeadline(url: string, deadline: number) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      return null;
    }

    let timeout: ReturnType<typeof setTimeout> | undefined;
    const deadlineResult = new Promise<null>((resolve) => {
      timeout = setTimeout(() => resolve(null), remaining);
      timeout.unref?.();
    });
    try {
      return await Promise.race([this.loadLogo(url), deadlineResult]);
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
    }
  }

  private canonicalLogoUrl(rawValue: string | null | undefined) {
    const raw = rawValue?.trim();
    if (!raw) {
      return null;
    }

    let apiBase: URL;
    let source: URL;
    try {
      apiBase = new URL(botConfig.apiBaseUrl);
      source = new URL(raw, apiBase);
    } catch {
      return null;
    }

    const isRelative = !/^[a-z][a-z\d+.-]*:/i.test(raw);
    if (
      !isRelative &&
      source.origin !== apiBase.origin &&
      source.hostname.toLowerCase() !== PUBLIC_API_HOST
    ) {
      return null;
    }

    const isTeamRoute =
      /^\/media\/teams\/[a-zA-Z0-9_-]{1,128}\/logo$/.test(source.pathname);
    const isAssetRoute =
      /^\/media\/team-logo-assets\/[a-f0-9]{64}\.png$/.test(source.pathname);
    if (!isTeamRoute && !isAssetRoute) {
      return null;
    }

    const internalUrl = new URL(apiBase.toString());
    internalUrl.pathname = source.pathname;
    internalUrl.search = source.search;
    internalUrl.hash = "";
    return internalUrl.toString();
  }

  private serverDefaultLogoUrl(rawValue: string | null | undefined) {
    const raw = rawValue?.trim();
    if (!raw) {
      return null;
    }

    let source: URL;
    try {
      source = new URL(raw);
    } catch {
      return null;
    }
    if (
      source.protocol !== "https:" ||
      source.hostname.toLowerCase() !== DISCORD_CDN_HOST ||
      source.port !== "" ||
      Boolean(source.username || source.password) ||
      !/^\/icons\/\d{1,32}\/[a-zA-Z0-9_]{1,128}\.png$/.test(
        source.pathname,
      )
    ) {
      return null;
    }
    const searchKeys = [...source.searchParams.keys()];
    if (
      searchKeys.some((key) => key !== "size") ||
      source.searchParams.getAll("size").length > 1 ||
      (source.searchParams.has("size") &&
        !/^(?:16|32|64|128|256|512|1024|2048|4096)$/.test(
          source.searchParams.get("size") ?? "",
        ))
    ) {
      return null;
    }
    source.username = "";
    source.password = "";
    source.hash = "";
    return source.toString();
  }

  private async loadLogo(url: string) {
    this.evictExpiredCacheEntries();
    const cached = this.logoCache.get(url);
    if (cached && cached.expiresAt > Date.now()) {
      this.logoCache.delete(url);
      this.logoCache.set(url, cached);
      return cached.buffer;
    }

    const pending = this.pendingLogos.get(url);
    if (pending) {
      return pending;
    }
    if (this.pendingLogos.size >= MAX_PENDING_LOGOS) {
      return null;
    }

    const request = this.withLogoFetchPermit(() =>
      this.fetchAndNormalizeLogo(url),
    )
      .then((buffer) => {
        this.logoCache.set(url, {
          buffer,
          expiresAt: Date.now() + LOGO_CACHE_TTL_MS,
        });
        this.enforceCacheLimits();
        return buffer;
      })
      .catch(() => null)
      .finally(() => {
        this.pendingLogos.delete(url);
      });
    this.pendingLogos.set(url, request);
    return request;
  }

  private async withLogoFetchPermit<T>(work: () => Promise<T>) {
    if (this.activeLogoFetches >= LOGO_FETCH_CONCURRENCY) {
      await new Promise<void>((resolve) => {
        this.logoFetchWaiters.push(resolve);
      });
    } else {
      this.activeLogoFetches += 1;
    }
    try {
      return await work();
    } finally {
      const next = this.logoFetchWaiters.shift();
      if (next) {
        next();
      } else {
        this.activeLogoFetches -= 1;
      }
    }
  }

  private async fetchAndNormalizeLogo(url: string) {
    const { buffer } = await fetchRemoteRasterImage(url, {
      apiBaseUrl: botConfig.apiBaseUrl,
      maxBytes: MAX_SOURCE_LOGO_BYTES,
      maxPixels: MAX_LOGO_INPUT_PIXELS,
      timeoutMs: LOGO_FETCH_TIMEOUT_MS,
    });
    return this.normalizeLogo(buffer);
  }

  private normalizeLogo(source: Buffer) {
    return sharp(source, { limitInputPixels: MAX_LOGO_INPUT_PIXELS })
      .rotate()
      .resize(LOGO_SIZE, LOGO_SIZE, {
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 },
        withoutEnlargement: false,
      })
      .ensureAlpha()
      .png({ compressionLevel: 9 })
      .toBuffer();
  }

  private evictExpiredCacheEntries() {
    const now = Date.now();
    for (const [key, entry] of this.logoCache) {
      if (entry.expiresAt <= now) {
        this.logoCache.delete(key);
      }
    }
  }

  private enforceCacheLimits() {
    let totalBytes = [...this.logoCache.values()].reduce(
      (total, entry) => total + entry.buffer.length,
      0,
    );
    while (
      this.logoCache.size > MAX_LOGO_CACHE_ENTRIES ||
      totalBytes > MAX_LOGO_CACHE_BYTES
    ) {
      const oldest = this.logoCache.entries().next().value as
        | [string, CachedLogo]
        | undefined;
      if (!oldest) {
        break;
      }
      this.logoCache.delete(oldest[0]);
      totalBytes -= oldest[1].buffer.length;
    }
  }

  private evictExpiredRosterCacheEntries() {
    const now = Date.now();
    for (const [key, entry] of this.rosterCache) {
      if (entry.expiresAt <= now) {
        this.rosterCache.delete(key);
      }
    }
  }

  private enforceRosterCacheLimits() {
    let totalBytes = [...this.rosterCache.values()].reduce(
      (total, entry) => total + entry.bytes,
      0,
    );
    while (
      this.rosterCache.size > MAX_ROSTER_CACHE_ENTRIES ||
      totalBytes > MAX_ROSTER_CACHE_BYTES
    ) {
      const oldest = this.rosterCache.entries().next().value as
        | [string, CachedRoster]
        | undefined;
      if (!oldest) {
        break;
      }
      this.rosterCache.delete(oldest[0]);
      totalBytes -= oldest[1].bytes;
    }
  }

  private async renderPage(
    kind: SlotRosterKind,
    title: string,
    rows: SlotRosterImageRow[],
    logos: Map<string, Buffer>,
    serverDefaultLogo: Buffer | null,
    pageNumber: number,
    pageCount: number,
  ) {
    const height = ROSTER_HEADER_HEIGHT + rows.length * ROSTER_ROW_HEIGHT + 24;
    const safeTitle = escapeXml(truncate(title, 90));
    const accent = kind === "slots" ? "#22d3ee" : "#f59e0b";
    const rowSvg = rows
      .map((row, index) => {
        const top = ROSTER_HEADER_HEIGHT + index * ROSTER_ROW_HEIGHT;
        const teamName = row.empty
          ? "EMPTY"
          : truncate(row.teamName || "Unknown Team", 46);
        const teamTag = row.empty ? "" : truncate(row.teamTag, 14);
        const status = row.empty
          ? "Available"
          : truncate(row.status || (kind === "waitlist" ? "WAITLIST" : ""), 18);
        const subtitle = [teamTag ? `[${teamTag}]` : "", status]
          .filter(Boolean)
          .join("  ");
        const nameX = row.empty ? 132 : 212;
        return `
          <rect x="24" y="${top + 4}" width="${ROSTER_WIDTH - 48}" height="${
            ROSTER_ROW_HEIGHT - 8
          }" rx="12" fill="${index % 2 === 0 ? "#111827" : "#0f172a"}"/>
          <text x="48" y="${top + 45}" fill="#94a3b8" font-size="22" font-weight="700">${escapeXml(
            truncate(row.position, 12),
          )}</text>
          <text x="${nameX}" y="${top + 32}" fill="${
            row.empty ? "#64748b" : "#f8fafc"
          }" font-size="23" font-weight="700">${escapeXml(teamName)}</text>
          ${
            subtitle
              ? `<circle cx="${nameX + 5}" cy="${top + 51}" r="4" fill="${statusColor(
                  row.status,
                )}"/>
                 <text x="${nameX + 18}" y="${top + 58}" fill="#94a3b8" font-size="16">${escapeXml(
                   subtitle,
                 )}</text>`
              : ""
          }
        `;
      })
      .join("");
    const svg = Buffer.from(`
      <svg width="${ROSTER_WIDTH}" height="${height}" viewBox="0 0 ${ROSTER_WIDTH} ${height}" xmlns="http://www.w3.org/2000/svg">
        <rect width="100%" height="100%" rx="20" fill="#070b14"/>
        <rect x="0" y="0" width="8" height="100%" fill="${accent}"/>
        <text x="32" y="42" fill="#f8fafc" font-family="Noto Sans, DejaVu Sans, sans-serif" font-size="28" font-weight="700">${safeTitle}</text>
        <text x="32" y="69" fill="#64748b" font-family="Noto Sans, DejaVu Sans, sans-serif" font-size="16">ARENZYRA • Page ${pageNumber}/${pageCount}</text>
        <g font-family="Noto Sans, DejaVu Sans, sans-serif">${rowSvg}</g>
      </svg>
    `);

    const composites: sharp.OverlayOptions[] = [];
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      if (row.empty) {
        continue;
      }
      const canonicalUrl = this.canonicalLogoUrl(row.logoUrl);
      const logo = canonicalUrl
        ? (logos.get(canonicalUrl) ?? serverDefaultLogo)
        : serverDefaultLogo;
      if (!logo) {
        continue;
      }
      composites.push({
        input: logo,
        left: 132,
        top:
          ROSTER_HEADER_HEIGHT +
          index * ROSTER_ROW_HEIGHT +
          Math.floor((ROSTER_ROW_HEIGHT - LOGO_SIZE) / 2),
      });
    }

    return sharp(svg, { limitInputPixels: MAX_LOGO_INPUT_PIXELS })
      .composite(composites)
      .png({ compressionLevel: 9, palette: true, quality: 90 })
      .toBuffer();
  }
}

export const slotRosterImageLimits = {
  maxRows: MAX_ROSTER_ROWS,
  maxPages: MAX_ROSTER_PAGES,
  rowsPerPage: ROSTER_ROWS_PER_PAGE,
} as const;
