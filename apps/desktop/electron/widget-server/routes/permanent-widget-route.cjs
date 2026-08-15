"use strict";

const crypto = require("node:crypto");
const { getProcessDefaultApiBase } = require("../../apiBaseDefaults.cjs");
const {
  isWidgetCapability,
} = require("../../widgetCapabilityStore.cjs");

const DEFAULT_API_BASE =
  process.env.ARENZYRA_API_URL ||
  process.env.ARENZYRA_API_BASE ||
  getProcessDefaultApiBase();
const DEFAULT_WS_PATH = "/ws";
const PLAYER_PHOTO_WIDGET_ASSET_VERSION = "player-photo-clean-v5";
const NEXT_ZONE_WIDGET_ASSET_VERSION = "next-zone-launcher-v17";
const GOLD_FOCUSED_WIDGET_ASSET_VERSION = "gold-focused-local-v4";
const WIDGET_VISIBILITY_ASSET_VERSION = "widget-hotkey-v2";
const REMOTE_WEB_BASE_ENV_KEYS = [
  "ARENZYRA_WEB_URL",
  "ARENZYRA_WEB_BASE",
];

const LIVE_WIDGET_KEYS = new Set([
  "teams-alive",
  "leaderboard",
  "final-five-alive",
  "overall-live-ranking",
  "match-lower-third",
  "match-start-notification",
  "kill-feed",
  "player-card",
  "player-photo",
  "map-overlay",
  "next-zone-update",
  "next-zone-update-blade",
  "next-zone-update-fold-down",
  "next-zone-update-kinetic-hud",
  "next-zone-update-pro-sidebar",
  "next-zone-update-radar-sweep",
  "next-zone-update-gold-ring",
  "wwcd",
  "winner",
  "fight-alert",
  "achievement-alert",
  "team-eliminated-alert",
]);

const ORGANIZER_WIDGET_KEYS = new Set([
  "countdown",
  "match-intro",
  "teams-lineup",
  "map-card",
  "lobby-slot-list",
  "sponsor-banner",
  "next-match",
  "team-status",
  "match-results",
  "match-summary",
  "head-to-head-comparison",
  "winner-celebration",
  "overall-standings",
  "mvp-top-fragger",
  "next-match-break",
  "points-breakdown",
]);

function normalizeBaseUrl(value, fallback = DEFAULT_API_BASE) {
  const raw = String(value || fallback || "").trim();
  if (!raw) {
    return fallback;
  }

  const withProtocol = raw.includes("://") ? raw : `http://${raw}`;
  const parsed = new URL(withProtocol);
  return parsed.toString().replace(/\/$/, "");
}

function parseHttpOrigin(value) {
  const raw = asString(value);
  if (!raw) return null;

  try {
    const parsed = new URL(raw.includes("://") ? raw : `https://${raw}`);
    if (
      !["http:", "https:"].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function deriveRemoteWebOrigin(apiOrigin) {
  const hostname = apiOrigin.hostname.toLowerCase();
  if (hostname.startsWith("api.") && hostname.length > 4) {
    const derived = new URL(apiOrigin.origin);
    derived.hostname = hostname.slice(4);
    return derived;
  }

  const isLocalHost =
    hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
  if (isLocalHost && apiOrigin.port === "3000") {
    const derived = new URL(apiOrigin.origin);
    derived.port = "3001";
    return derived;
  }

  return new URL(apiOrigin.origin);
}

function isLoopbackHostname(hostname) {
  const normalized = asString(hostname).toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "[::1]"
  );
}

function isTrustedRemoteWebOrigin(apiOrigin, derivedOrigin, candidate) {
  if (
    candidate.origin === apiOrigin.origin ||
    candidate.origin === derivedOrigin.origin
  ) {
    return true;
  }

  return (
    isLoopbackHostname(apiOrigin.hostname) &&
    isLoopbackHostname(candidate.hostname) &&
    candidate.protocol === apiOrigin.protocol
  );
}

function resolveRemoteWebBase(apiBase) {
  const apiOrigin = parseHttpOrigin(apiBase);
  if (!apiOrigin) {
    return normalizeBaseUrl(apiBase);
  }
  const derivedOrigin = deriveRemoteWebOrigin(apiOrigin);

  for (const key of REMOTE_WEB_BASE_ENV_KEYS) {
    const explicit = parseHttpOrigin(process.env[key]);
    if (
      explicit &&
      isTrustedRemoteWebOrigin(apiOrigin, derivedOrigin, explicit)
    ) {
      return explicit.origin;
    }
  }

  return derivedOrigin.origin;
}

function asString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function widgetKeyReference(value) {
  const digest = crypto
    .createHash("sha256")
    .update(String(value || ""), "utf8")
    .digest("hex")
    .slice(0, 12);
  return `sha256:${digest}`;
}

function readQueryValue(value) {
  if (Array.isArray(value)) {
    return asString(value[0]);
  }
  return asString(value);
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeJson(value) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e");
}

function copyQueryParams(query) {
  const params = new URLSearchParams();

  for (const [name, value] of Object.entries(query || {})) {
    const normalized = readQueryValue(value);
    if (!normalized) {
      continue;
    }
    params.set(name, normalized);
  }

  return params;
}

function buildCanonicalLocalPath(instanceKey, query) {
  const params = copyQueryParams(query);
  const search = params.toString();
  const path = `/w/${encodeURIComponent(instanceKey)}`;
  return search ? `${path}?${search}` : path;
}

function buildRemoteWidgetUrl(apiBase, context, query, instanceKey) {
  const widgetKey = asString(context?.widgetKey);
  const organizationSlug =
    asString(context?.organization?.slug) || asString(context?.organizationSlug);
  if (!widgetKey || !organizationSlug) {
    return null;
  }

  const webBase = resolveRemoteWebBase(apiBase);

  let target = null;
  if (LIVE_WIDGET_KEYS.has(widgetKey)) {
    target = new URL(`/widgets/${encodeURIComponent(widgetKey)}`, `${webBase}/`);
    target.searchParams.set("orgSlug", organizationSlug);
    if (!readQueryValue(query?.clean) && !readQueryValue(query?.preview)) {
      target.searchParams.set("clean", "1");
    }
  } else if (ORGANIZER_WIDGET_KEYS.has(widgetKey)) {
    target = new URL(
      `/widgets/${encodeURIComponent(organizationSlug)}/${encodeURIComponent(widgetKey)}`,
      `${webBase}/`,
    );
  } else {
    return null;
  }

  const resolvedMatchId =
    asString(context?.match?.id) || asString(context?.matchId);
  if (resolvedMatchId && !readQueryValue(query?.matchId)) {
    target.searchParams.set("matchId", resolvedMatchId);
  }
  const resolvedOrganizationId =
    asString(context?.organization?.id) || asString(context?.organizationId);
  if (resolvedOrganizationId && !readQueryValue(query?.organizationId)) {
    // Let the browser start its match-control read in parallel with context
    // discovery. The capability remains in the fragment and is never copied
    // into this network-visible query string.
    target.searchParams.set("organizationId", resolvedOrganizationId);
  }

  for (const [name, value] of Object.entries(query || {})) {
    const normalized = readQueryValue(value);
    if (!normalized) {
      continue;
    }
    target.searchParams.set(name, normalized);
  }

  // Keep the match-bound widget credential out of the network-visible URL.
  // The remote browser runtime reads it from the fragment and forwards it to
  // guarded data routes only as x-match-access-key.
  if (isWidgetCapability(instanceKey)) {
    target.hash = new URLSearchParams({
      matchAccessKey: instanceKey,
    }).toString();
  }

  return target.toString();
}

function renderStatePage(title, detail, reason, options = {}) {
  const safeTitle = escapeHtml(title);
  const safeDetail = escapeHtml(detail);
  const safeReason = escapeHtml(reason);
  const retryMs = Number(options?.retryMs);
  const retryDelayMs =
    options?.retry === true &&
    Number.isFinite(retryMs) &&
    retryMs >= 1000 &&
    retryMs <= 30000
      ? Math.round(retryMs)
      : options?.retry === true
        ? 3000
        : null;
  const retrySeconds =
    retryDelayMs === null ? null : Math.max(1, Math.ceil(retryDelayMs / 1000));

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta http-equiv="Cache-Control" content="no-store, no-cache, must-revalidate" />
    <meta http-equiv="Pragma" content="no-cache" />
    <meta http-equiv="Expires" content="0" />
    ${
      retrySeconds === null
        ? ""
        : `<meta http-equiv="refresh" content="${retrySeconds}" />`
    }
    <title>${safeTitle}</title>
    <style>
      html,
      body {
        margin: 0;
        width: 100%;
        height: 100%;
        overflow: hidden;
        background: transparent;
        color: #f4f7fb;
        font-family: "Segoe UI", sans-serif;
      }

      body {
        display: grid;
        place-items: center;
        padding: 24px;
      }

      .shell {
        width: min(560px, 100%);
        border-radius: 18px;
        border: 1px solid rgba(149, 191, 220, 0.16);
        background: rgba(4, 12, 18, 0.92);
        padding: 20px 22px;
      }

      .reason {
        display: inline-flex;
        margin-bottom: 10px;
        border-radius: 999px;
        border: 1px solid rgba(113, 240, 212, 0.22);
        background: rgba(10, 41, 39, 0.52);
        color: #71f0d4;
        padding: 4px 10px;
        font-size: 12px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }

      h1 {
        margin: 0 0 8px;
        font-size: 20px;
      }

      p {
        margin: 0;
        color: rgba(232, 240, 247, 0.78);
        line-height: 1.5;
      }
    </style>
  </head>
  <body>
    <main class="shell">
      <div class="reason">${safeReason}</div>
      <h1>${safeTitle}</h1>
      <p>${safeDetail}</p>
    </main>
    ${
      retryDelayMs === null
        ? ""
        : `<script>
      window.setTimeout(function () {
        window.location.reload();
      }, ${retryDelayMs});
    </script>`
    }
  </body>
</html>`;
}

function sendStatePage(
  res,
  { status = 200, title, detail, reason, retry = false, retryMs = 3000 },
) {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res
    .status(status)
    .type("html")
    .send(renderStatePage(title, detail, reason, { retry, retryMs }));
}

function renderWidgetHostPage({
  widgetKey,
  organizationName,
  tournamentName,
  targetUrl,
  wsPath,
}) {
  const titleParts = ["Arenzyra Widget", widgetKey];
  if (organizationName) {
    titleParts.push(organizationName);
  }
  if (tournamentName) {
    titleParts.push(tournamentName);
  }

  const safeTitle = escapeHtml(titleParts.filter(Boolean).join(" | "));
  const safeTargetUrl = escapeHtml(targetUrl);
  const visibilityBootstrap = safeJson({
    widgetKey,
    wsPath: asString(wsPath) || DEFAULT_WS_PATH,
  });

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta http-equiv="Cache-Control" content="no-store, no-cache, must-revalidate" />
    <title>${safeTitle}</title>
    <style>
      html,
      body {
        margin: 0;
        width: 100%;
        height: 100%;
        overflow: hidden;
        background: transparent;
      }

      body {
        display: block;
      }

      iframe {
        display: block;
        width: 100vw;
        height: 100vh;
        border: 0;
        background: transparent;
      }
    </style>
  </head>
  <body>
    <iframe
      src="${safeTargetUrl}"
      title="${safeTitle}"
      allow="autoplay; clipboard-read; clipboard-write"
      referrerpolicy="no-referrer-when-downgrade"
    ></iframe>
    <script>window.__ARENZYRA_WIDGET_VISIBILITY_BOOTSTRAP__ = ${visibilityBootstrap};</script>
    <script src="/obs/static/widget-visibility-client.js?v=${WIDGET_VISIBILITY_ASSET_VERSION}"></script>
  </body>
</html>`;
}

function buildLocalWidgetBootstrap({
  apiBase,
  wsPath,
  instanceKey,
  resolved,
}) {
  return {
    apiBase,
    instanceKey,
    brandingRefreshPath: `/obs/widget-context/${encodeURIComponent(instanceKey)}`,
    widgetKey: asString(resolved?.widgetKey),
    wsPath: asString(wsPath) || DEFAULT_WS_PATH,
    organizationId:
      asString(resolved?.organization?.id) || asString(resolved?.organizationId) || null,
    organizationSlug:
      asString(resolved?.organization?.slug) || asString(resolved?.organizationSlug) || null,
    tournamentId:
      asString(resolved?.tournament?.id) || asString(resolved?.tournamentId) || null,
    matchId:
      asString(resolved?.match?.id) || asString(resolved?.matchId) || null,
    organization: resolved?.organization
      ? {
          id: asString(resolved.organization.id) || null,
          name: asString(resolved.organization.name) || null,
          slug: asString(resolved.organization.slug) || null,
          branding: resolved.organization.branding ?? null,
        }
      : null,
    tournament: resolved?.tournament
      ? {
          id: asString(resolved.tournament.id) || null,
          name: asString(resolved.tournament.name) || null,
        }
      : null,
    match: resolved?.match
      ? {
          id: asString(resolved.match.id) || null,
          name: asString(resolved.match.name) || null,
          status: asString(resolved.match.status) || null,
          matchNumber: resolved.match.matchNumber ?? null,
          map: asString(resolved.match.map) || null,
        }
      : null,
  };
}

function renderLocalWidgetPage({
  widgetTitle,
  stylePath,
  scriptPath,
  bootstrap,
  markup,
  extraScripts,
}) {
  const safeTitle = escapeHtml(widgetTitle);
  const safeStylePath = escapeHtml(stylePath);
  const safeScriptPath = escapeHtml(scriptPath);
  const payload = safeJson(bootstrap);

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta http-equiv="Cache-Control" content="no-store, no-cache, must-revalidate" />
    <title>${safeTitle}</title>
    <link rel="stylesheet" href="${safeStylePath}" />
    <link rel="stylesheet" href="/obs/static/widget-branding-bridge.css?v=widget-branding-v2" />
  </head>
  <body>
    ${markup}
    <script>window.__ARENZYRA_LOCAL_WIDGET_BOOTSTRAP__ = ${payload};</script>
    <script src="/obs/static/widget-branding-client.js?v=widget-branding-v2"></script>
    <script src="/obs/static/widget-visibility-client.js?v=${WIDGET_VISIBILITY_ASSET_VERSION}"></script>
    ${extraScripts || ""}
    <script src="${safeScriptPath}"></script>
  </body>
</html>`;
}

function renderTeamEliminatedPage({ apiBase, bootstrap, title }) {
  const socketClientUrl = `${apiBase}/socket.io/socket.io.js`;
  return renderLocalWidgetPage({
    widgetTitle: title,
    stylePath: "/obs/static/team-eliminated-widget.css",
    scriptPath: "/obs/static/team-eliminated-widget.js",
    bootstrap,
    extraScripts: `<script src="${escapeHtml(socketClientUrl)}"></script>`,
    markup: `
    <main class="team-eliminated-root" id="team-eliminated-root">
      <section class="team-eliminated-banner" aria-live="polite" aria-atomic="true">
        <div class="team-eliminated-banner__logo-shell">
          <img
            class="team-eliminated-banner__logo"
            id="team-eliminated-logo"
            alt=""
            draggable="false"
          />
        </div>
        <div class="team-eliminated-banner__copy">
          <div class="team-eliminated-banner__eyebrow" id="team-eliminated-eyebrow">TEAM ELIMINATED</div>
          <div class="team-eliminated-banner__name" id="team-eliminated-name">
            Waiting for elimination
          </div>
          <div class="team-eliminated-banner__placement" id="team-eliminated-placement">
            PLACE PENDING
          </div>
        </div>
      </section>
    </main>`,
  });
}

function renderReplayMarkerPage({ bootstrap, title }) {
  return renderLocalWidgetPage({
    widgetTitle: title,
    stylePath: "/obs/static/replay-marker-widget.css",
    scriptPath: "/obs/static/replay-marker-widget.js",
    bootstrap,
    markup: `
    <main
      class="replay-marker-root"
      id="replay-marker-root"
      data-visible="false"
      aria-hidden="true"
    >
      <section class="replay-marker-card" id="replay-marker-card" role="status" aria-live="polite">
        <div class="replay-marker-kicker">REPLAY MOMENT</div>
        <div class="replay-marker-title" id="replay-marker-title">Waiting for replay marker</div>
        <div class="replay-marker-detail" id="replay-marker-detail">Marker feed idle</div>
      </section>
    </main>`,
  });
}

function buildLocalWidgetPage({
  widgetKey,
  apiBase,
  wsPath,
  instanceKey,
  resolved,
}) {
  const bootstrap = buildLocalWidgetBootstrap({
    apiBase,
    wsPath,
    instanceKey,
    resolved,
  });

  if (widgetKey === "zone-timer") {
    return renderLocalWidgetPage({
      widgetTitle: "Arenzyra Zone Timer Widget",
      stylePath: "/obs/static/obs-zone-closing-widget.css",
      scriptPath: "/obs/static/obs-zone-closing-widget.js",
      bootstrap,
      markup: `
    <div
      class="obs-zone-timer-root"
      id="zone-timer-root"
      data-mode="unknown"
      data-stale="false"
      data-offline="false"
      hidden
    >
      <section class="zone-timer-card" aria-live="polite" aria-atomic="true">
        <div class="zone-timer-header">
          <div class="zone-timer-copy">
            <div class="zone-timer-eyebrow">Zone Timer</div>
            <div class="zone-timer-phase" id="zone-timer-phase">Phase --</div>
          </div>
          <div class="zone-timer-status" id="zone-timer-status" hidden>
            WS OFFLINE
          </div>
        </div>
        <div class="zone-timer-mode" id="zone-timer-mode">Next Zone</div>
        <div class="zone-timer-countdown" id="zone-timer-countdown">--:--</div>
      </section>
    </div>`,
    });
  }

  if (widgetKey === "next-zone-update") {
    return renderLocalWidgetPage({
      widgetTitle: "Arenzyra Next Zone Update",
      stylePath:
        `/obs/static/obs-zone-closing-widget.css?v=${NEXT_ZONE_WIDGET_ASSET_VERSION}`,
      scriptPath:
        `/obs/static/obs-zone-closing-widget.js?v=${NEXT_ZONE_WIDGET_ASSET_VERSION}`,
      bootstrap: {
        ...bootstrap,
        displayMode: "next-zone-update",
        revealWindowMs: 20_000,
        brandingRefreshPath: `/obs/widget-context/${encodeURIComponent(instanceKey)}`,
      },
      markup: `
    <main
      class="obs-next-zone-update-root"
      id="next-zone-update-root"
      data-stale="false"
      data-offline="false"
      hidden
    >
      <section class="next-zone-update-card" role="status" aria-live="polite" aria-atomic="true">
        <div class="next-zone-update-phase-block">
          <span id="next-zone-update-phase">P--</span>
        </div>
        <div class="next-zone-update-copy">
          <div class="next-zone-update-topline">Zone Closing</div>
          <div class="next-zone-update-title">Next Zone Update</div>
          <div class="next-zone-update-subtitle">Zone closes in</div>
        </div>
        <div class="next-zone-update-timer">
          <div class="next-zone-update-timer-inner">
            <div class="next-zone-update-countdown" id="next-zone-update-countdown">00:20</div>
            <div class="next-zone-update-timer-label">Remaining</div>
          </div>
        </div>
        <div class="next-zone-update-status" id="next-zone-update-status" hidden>
          WS OFFLINE
        </div>
      </section>
      <div class="next-zone-update-progress" aria-hidden="true">
        <span id="next-zone-update-progress"></span>
      </div>
    </main>`,
    });
  }

  if (widgetKey === "next-zone-update-pro-sidebar") {
    return renderLocalWidgetPage({
      widgetTitle: "Arenzyra Next Zone Update Pro Sidebar",
      stylePath:
        `/obs/static/obs-zone-closing-widget.css?v=${NEXT_ZONE_WIDGET_ASSET_VERSION}`,
      scriptPath:
        `/obs/static/obs-zone-closing-widget.js?v=${NEXT_ZONE_WIDGET_ASSET_VERSION}`,
      bootstrap: {
        ...bootstrap,
        displayMode: "next-zone-update",
        styleVariant: "pro-sidebar",
        revealWindowMs: 20_000,
        brandingRefreshPath: `/obs/widget-context/${encodeURIComponent(instanceKey)}`,
      },
      markup: `
    <main
      class="obs-next-zone-update-root obs-next-zone-update-root--pro-sidebar"
      id="next-zone-update-root"
      data-stale="false"
      data-offline="false"
      data-style="pro-sidebar"
      hidden
    >
      <section class="next-zone-update-card next-zone-update-card--pro-sidebar" role="status" aria-live="polite" aria-atomic="true">
        <div class="next-zone-update-phase-block next-zone-update-phase-block--pro-sidebar">
          <span id="next-zone-update-phase">P--</span>
        </div>
        <div class="next-zone-update-copy next-zone-update-copy--pro-sidebar">
          <div class="next-zone-update-topline next-zone-update-topline--pro-sidebar">Blue Zone</div>
          <div class="next-zone-update-title next-zone-update-title--pro-sidebar">Zone Shift</div>
          <div class="next-zone-update-subtitle next-zone-update-subtitle--pro-sidebar">Final shrink window</div>
        </div>
        <div class="next-zone-update-timer next-zone-update-timer--pro-sidebar">
          <div class="next-zone-update-timer-inner next-zone-update-timer-inner--pro-sidebar">
            <div class="next-zone-update-countdown next-zone-update-countdown--pro-sidebar" id="next-zone-update-countdown">00:20</div>
            <div class="next-zone-update-timer-label next-zone-update-timer-label--pro-sidebar">Remaining</div>
          </div>
        </div>
        <div class="next-zone-update-status" id="next-zone-update-status" hidden>
          WS OFFLINE
        </div>
      </section>
      <div class="next-zone-update-progress next-zone-update-progress--pro-sidebar" aria-hidden="true">
        <span id="next-zone-update-progress"></span>
      </div>
    </main>`,
    });
  }

  if (widgetKey === "next-zone-update-kinetic-hud") {
    return renderLocalWidgetPage({
      widgetTitle: "Arenzyra Next Zone Update Kinetic HUD",
      stylePath:
        `/obs/static/obs-zone-closing-widget.css?v=${NEXT_ZONE_WIDGET_ASSET_VERSION}`,
      scriptPath:
        `/obs/static/obs-zone-closing-widget.js?v=${NEXT_ZONE_WIDGET_ASSET_VERSION}`,
      bootstrap: {
        ...bootstrap,
        displayMode: "next-zone-update",
        styleVariant: "kinetic-hud",
        revealWindowMs: 20_000,
        brandingRefreshPath: `/obs/widget-context/${encodeURIComponent(instanceKey)}`,
      },
      markup: `
    <main
      class="obs-next-zone-update-root obs-next-zone-update-root--kinetic-hud"
      id="next-zone-update-root"
      data-stale="false"
      data-offline="false"
      data-style="kinetic-hud"
      hidden
    >
      <section class="next-zone-update-card next-zone-update-card--kinetic-hud" role="status" aria-live="polite" aria-atomic="true">
        <div class="next-zone-update-phase-block next-zone-update-phase-block--kinetic-hud">
          <span id="next-zone-update-phase">P--</span>
        </div>
        <div class="next-zone-update-copy next-zone-update-copy--kinetic-hud">
          <div class="next-zone-update-topline next-zone-update-topline--kinetic-hud">Zone Telemetry</div>
          <div class="next-zone-update-title next-zone-update-title--kinetic-hud">Next Zone Update</div>
          <div class="next-zone-update-subtitle next-zone-update-subtitle--kinetic-hud">Final shrink window</div>
        </div>
        <div class="next-zone-update-timer next-zone-update-timer--kinetic-hud">
          <div class="next-zone-update-timer-inner next-zone-update-timer-inner--kinetic-hud">
            <div class="next-zone-update-countdown next-zone-update-countdown--kinetic-hud" id="next-zone-update-countdown">00:20</div>
            <div class="next-zone-update-timer-label next-zone-update-timer-label--kinetic-hud">Remaining</div>
          </div>
        </div>
        <div class="next-zone-update-status" id="next-zone-update-status" hidden>
          WS OFFLINE
        </div>
      </section>
      <div class="next-zone-update-progress next-zone-update-progress--kinetic-hud" aria-hidden="true">
        <span id="next-zone-update-progress"></span>
      </div>
    </main>`,
    });
  }

  if (widgetKey === "next-zone-update-blade") {
    return renderLocalWidgetPage({
      widgetTitle: "Arenzyra Next Zone Update Blade Countdown",
      stylePath:
        `/obs/static/obs-zone-closing-widget.css?v=${NEXT_ZONE_WIDGET_ASSET_VERSION}`,
      scriptPath:
        `/obs/static/obs-zone-closing-widget.js?v=${NEXT_ZONE_WIDGET_ASSET_VERSION}`,
      bootstrap: {
        ...bootstrap,
        displayMode: "next-zone-update",
        styleVariant: "blade",
        revealWindowMs: 20_000,
        brandingRefreshPath: `/obs/widget-context/${encodeURIComponent(instanceKey)}`,
      },
      markup: `
    <main
      class="obs-next-zone-update-root obs-next-zone-update-root--blade"
      id="next-zone-update-root"
      data-stale="false"
      data-offline="false"
      data-style="blade"
      hidden
    >
      <section class="next-zone-update-card next-zone-update-card--blade" role="status" aria-live="polite" aria-atomic="true">
        <div class="next-zone-update-phase-block next-zone-update-phase-block--blade">
          <span id="next-zone-update-phase">P--</span>
        </div>
        <div class="next-zone-update-copy next-zone-update-copy--blade">
          <div class="next-zone-update-topline next-zone-update-topline--blade">Zone Closing</div>
          <div class="next-zone-update-title next-zone-update-title--blade">Final 20 Seconds</div>
          <div class="next-zone-update-subtitle next-zone-update-subtitle--blade">Next safe area update</div>
        </div>
        <div class="next-zone-update-timer next-zone-update-timer--blade">
          <div class="next-zone-update-timer-inner next-zone-update-timer-inner--blade">
            <div class="next-zone-update-countdown next-zone-update-countdown--blade" id="next-zone-update-countdown">00:20</div>
            <div class="next-zone-update-timer-label next-zone-update-timer-label--blade">Sec Left</div>
          </div>
        </div>
        <div class="next-zone-update-status" id="next-zone-update-status" hidden>
          WS OFFLINE
        </div>
      </section>
      <div class="next-zone-update-progress next-zone-update-progress--blade" aria-hidden="true">
        <span id="next-zone-update-progress"></span>
      </div>
    </main>`,
    });
  }

  if (widgetKey === "next-zone-update-radar-sweep") {
    return renderLocalWidgetPage({
      widgetTitle: "Arenzyra Next Zone Update Radar Sweep",
      stylePath:
        `/obs/static/obs-zone-closing-widget.css?v=${NEXT_ZONE_WIDGET_ASSET_VERSION}`,
      scriptPath:
        `/obs/static/obs-zone-closing-widget.js?v=${NEXT_ZONE_WIDGET_ASSET_VERSION}`,
      bootstrap: {
        ...bootstrap,
        displayMode: "next-zone-update",
        styleVariant: "radar-sweep",
        revealWindowMs: 20_000,
        brandingRefreshPath: `/obs/widget-context/${encodeURIComponent(instanceKey)}`,
      },
      markup: `
    <main
      class="obs-next-zone-update-root obs-next-zone-update-root--radar-sweep"
      id="next-zone-update-root"
      data-stale="false"
      data-offline="false"
      data-style="radar-sweep"
      hidden
    >
      <section class="next-zone-update-card next-zone-update-card--radar-sweep" role="status" aria-live="polite" aria-atomic="true">
        <div class="next-zone-update-phase-block next-zone-update-phase-block--radar-sweep">
          <span id="next-zone-update-phase">P--</span>
        </div>
        <div class="next-zone-update-copy next-zone-update-copy--radar-sweep">
          <div class="next-zone-update-topline next-zone-update-topline--radar-sweep">Zone Telemetry</div>
          <div class="next-zone-update-title next-zone-update-title--radar-sweep">Blue Zone Shift</div>
          <div class="next-zone-update-subtitle next-zone-update-subtitle--radar-sweep">Final shrink window</div>
        </div>
        <div class="next-zone-update-timer next-zone-update-timer--radar-sweep">
          <div class="next-zone-update-timer-inner next-zone-update-timer-inner--radar-sweep">
            <div class="next-zone-update-countdown next-zone-update-countdown--radar-sweep" id="next-zone-update-countdown">00:20</div>
            <div class="next-zone-update-timer-label next-zone-update-timer-label--radar-sweep">Remaining</div>
          </div>
        </div>
        <div class="next-zone-update-status" id="next-zone-update-status" hidden>
          WS OFFLINE
        </div>
      </section>
      <div class="next-zone-update-progress next-zone-update-progress--radar-sweep" aria-hidden="true">
        <span id="next-zone-update-progress"></span>
      </div>
    </main>`,
    });
  }

  if (widgetKey === "next-zone-update-fold-down") {
    return renderLocalWidgetPage({
      widgetTitle: "Arenzyra Next Zone Update Fold Down",
      stylePath:
        `/obs/static/obs-zone-closing-widget.css?v=${NEXT_ZONE_WIDGET_ASSET_VERSION}`,
      scriptPath:
        `/obs/static/obs-zone-closing-widget.js?v=${NEXT_ZONE_WIDGET_ASSET_VERSION}`,
      bootstrap: {
        ...bootstrap,
        displayMode: "next-zone-update",
        styleVariant: "fold-down",
        revealWindowMs: 20_000,
        brandingRefreshPath: `/obs/widget-context/${encodeURIComponent(instanceKey)}`,
      },
      markup: `
    <main
      class="obs-next-zone-update-root obs-next-zone-update-root--fold-down"
      id="next-zone-update-root"
      data-stale="false"
      data-offline="false"
      data-style="fold-down"
      hidden
    >
      <section class="next-zone-update-card next-zone-update-card--fold-down" role="status" aria-live="polite" aria-atomic="true">
        <div class="next-zone-update-phase-block next-zone-update-phase-block--fold-down">
          <span id="next-zone-update-phase">P--</span>
        </div>
        <div class="next-zone-update-copy next-zone-update-copy--fold-down">
          <div class="next-zone-update-topline next-zone-update-topline--fold-down">Zone Closing</div>
          <div class="next-zone-update-title next-zone-update-title--fold-down">Next Zone Update</div>
          <div class="next-zone-update-subtitle next-zone-update-subtitle--fold-down">Final seconds before rotation</div>
        </div>
        <div class="next-zone-update-timer next-zone-update-timer--fold-down">
          <div class="next-zone-update-timer-inner next-zone-update-timer-inner--fold-down">
            <div class="next-zone-update-countdown next-zone-update-countdown--fold-down" id="next-zone-update-countdown">00:20</div>
            <div class="next-zone-update-timer-label next-zone-update-timer-label--fold-down">Remaining</div>
          </div>
        </div>
        <div class="next-zone-update-status" id="next-zone-update-status" hidden>
          WS OFFLINE
        </div>
      </section>
      <div class="next-zone-update-progress next-zone-update-progress--fold-down" aria-hidden="true">
        <span id="next-zone-update-progress"></span>
      </div>
    </main>`,
    });
  }

  if (widgetKey === "next-zone-update-gold-ring") {
    return renderLocalWidgetPage({
      widgetTitle: "Arenzyra Next Zone Update Gold Ring",
      stylePath:
        `/obs/static/obs-zone-closing-widget.css?v=${NEXT_ZONE_WIDGET_ASSET_VERSION}`,
      scriptPath:
        `/obs/static/obs-zone-closing-widget.js?v=${NEXT_ZONE_WIDGET_ASSET_VERSION}`,
      bootstrap: {
        ...bootstrap,
        displayMode: "next-zone-update",
        styleVariant: "gold-ring",
        revealWindowMs: 20_000,
        brandingRefreshPath: `/obs/widget-context/${encodeURIComponent(instanceKey)}`,
      },
      markup: `
    <main
      class="obs-next-zone-update-root obs-next-zone-update-root--gold-ring"
      id="next-zone-update-root"
      data-stale="false"
      data-offline="false"
      data-style="gold-ring"
      data-gold-metric="alive"
      hidden
    >
      <section class="next-zone-update-card next-zone-update-card--gold-ring" role="status" aria-live="polite" aria-atomic="true">
        <div class="next-zone-update-gold-face">
          <div class="next-zone-update-gold-ring" aria-hidden="true"></div>
          <strong class="next-zone-update-gold-metric" id="next-zone-update-alive">--</strong>
          <span class="next-zone-update-gold-metric-label" id="next-zone-update-metric-label">ALIVE</span>
        </div>
        <div class="next-zone-update-gold-footer">
          <span class="next-zone-update-countdown next-zone-update-countdown--gold-ring" id="next-zone-update-countdown">--:--</span>
          <strong class="next-zone-update-phase-block next-zone-update-phase-block--gold-ring">
            <span id="next-zone-update-phase">STAGE --</span>
          </strong>
        </div>
        <div class="next-zone-update-status next-zone-update-status--gold-ring" id="next-zone-update-status" hidden>
          WS OFFLINE
        </div>
      </section>
      <div class="next-zone-update-progress next-zone-update-progress--gold-ring" aria-hidden="true">
        <span id="next-zone-update-progress"></span>
      </div>
    </main>`,
    });
  }

  if (widgetKey === "zone-closing") {
    return renderLocalWidgetPage({
      widgetTitle: "Arenzyra Zone Closing Alert Banner",
      stylePath: "/obs/static/obs-zone-closing-widget.css",
      scriptPath: "/obs/static/obs-zone-closing-widget.js",
      bootstrap,
      markup: `
    <main
      class="obs-zone-alert-root"
      id="zone-alert-root"
      data-alert="idle"
      data-stale="false"
      data-offline="false"
      hidden
    >
      <section class="zone-alert-banner" role="status" aria-live="polite" aria-atomic="true">
        <div class="zone-alert-kicker" id="zone-alert-kicker">ZONE CLOSING ALERT</div>
        <div class="zone-alert-title" id="zone-alert-title">Zone closes in</div>
        <div class="zone-alert-meta">
          <div class="zone-alert-phase" id="zone-alert-phase">Phase --</div>
          <div class="zone-alert-countdown" id="zone-alert-countdown">00:10</div>
          <div class="zone-alert-status" id="zone-alert-status" hidden>
            WS OFFLINE
          </div>
        </div>
      </section>
    </main>`,
    });
  }

  if (widgetKey === "team-status") {
    const socketClientUrl = `${apiBase}/socket.io/socket.io.js`;
    return renderLocalWidgetPage({
      widgetTitle: "Arenzyra Team Status Bar",
      stylePath: "/obs/static/obs-team-status-widget.css",
      scriptPath: "/obs/static/obs-team-status-widget.js",
      bootstrap,
      extraScripts: `<script src="${escapeHtml(socketClientUrl)}"></script>`,
      markup: `
    <div
      class="obs-team-status-root"
      id="team-status-root"
      data-offline="false"
      hidden
    >
      <section class="team-status-shell" aria-live="polite" aria-atomic="false">
        <div class="team-status-header">
          <div class="team-status-copy">
            <div class="team-status-eyebrow">Team Status</div>
            <div class="team-status-team" id="team-status-team">TEAM</div>
          </div>
          <div class="team-status-connection" id="team-status-connection" hidden>
            WS OFFLINE
          </div>
        </div>
        <div class="team-status-strip" id="team-status-strip"></div>
      </section>
    </div>`,
    });
  }

  if (widgetKey === "player-photo") {
    const playerPhotoStateUrl = bootstrap.matchId
      ? `/obs/player-photo/state?matchId=${encodeURIComponent(bootstrap.matchId)}`
      : "/obs/player-photo/state";
    const playerPhotoStylePath =
      `/obs/static/obs-player-photo-widget.css?v=${PLAYER_PHOTO_WIDGET_ASSET_VERSION}`;
    const playerPhotoScriptPath =
      `/obs/static/obs-player-photo-widget.js?v=${PLAYER_PHOTO_WIDGET_ASSET_VERSION}`;
    return renderLocalWidgetPage({
      widgetTitle: "Arenzyra Player Photo Widget",
      stylePath: playerPhotoStylePath,
      scriptPath: playerPhotoScriptPath,
      bootstrap: {
        ...bootstrap,
        localStateUrl: playerPhotoStateUrl,
        localFocusUrl: "/obs/player-photo/focus",
      },
      markup: `
    <div
      class="obs-player-photo-root"
      id="player-photo-root"
      data-status="alive"
      data-offline="false"
      data-stale="false"
      hidden
    >
      <article class="player-photo-shell" aria-hidden="true">
        <div class="player-photo-frame">
          <img id="player-photo-image" alt="Focused player portrait" draggable="false" />
        </div>
      </article>
    </div>`,
    });
  }

  if (
    widgetKey === "gold-broadcast-focused-roster" ||
    widgetKey === "gold-broadcast-player-stats"
  ) {
    const displayMode =
      widgetKey === "gold-broadcast-focused-roster" ? "roster" : "player-stats";
    const goldBroadcastAssetBase = resolveRemoteWebBase(apiBase);
    const stateUrl = bootstrap.matchId
      ? `/obs/gold-focused/state?matchId=${encodeURIComponent(bootstrap.matchId)}`
      : "/obs/gold-focused/state";
    const rosterRows = [0, 1, 2, 3]
      .map(
        (index) => `
        <article class="gold-roster-player" data-player-index="${index}" data-status="unknown" data-utility-available="false" style="--health:0%;--row-delay:${220 + index * 75}ms" hidden>
          <div class="gold-player-copy">
            <strong id="gold-player-${index}-name">PLAYER</strong>
            <div class="gold-player-meta">
              <span aria-label="kills">
                <svg aria-hidden="true" viewBox="0 0 32 32"><path d="M16 3C9.1 3 4 7.4 4 14c0 4.5 2.2 7.5 5.8 9v5h4v-3h4.4v3h4v-5c3.6-1.5 5.8-4.5 5.8-9C28 7.4 22.9 3 16 3Zm-5 14.5A3.5 3.5 0 1 1 11 10a3.5 3.5 0 0 1 0 7.5Zm10 0A3.5 3.5 0 1 1 21 10a3.5 3.5 0 0 1 0 7.5ZM13 21h6l-3 3-3-3Z" fill="currentColor"/></svg>
                <b id="gold-player-${index}-kills">--</b>
              </span>
              <span aria-label="knockouts">&#9670; <b id="gold-player-${index}-knockouts">--</b></span>
              <span aria-label="utility total">&#9679; <b id="gold-player-${index}-utility">--</b></span>
            </div>
          </div>
          <div class="gold-roster-portrait">
            <img id="gold-player-${index}-photo" alt="" draggable="false" />
          </div>
          <div class="gold-health-block">
            <b id="gold-player-${index}-health">--</b>
            <span><i></i></span>
          </div>
        </article>`,
      )
      .join("");
    const markup =
      displayMode === "roster"
        ? `
    <main class="gold-focused-root" id="gold-focused-root" data-gold-panel="roster" data-offline="true" data-stale="false" hidden>
      <section class="gold-roster gold-enter-left" data-utility-available="false" aria-live="polite" aria-atomic="false">
        <header class="gold-roster-header">
          <span class="gold-team-mark"><img id="gold-team-logo" alt="" draggable="false" /></span>
          <strong id="gold-team-name">TEAM</strong>
          <span class="gold-header-kills">
            <svg aria-hidden="true" viewBox="0 0 32 32"><path d="M16 3C9.1 3 4 7.4 4 14c0 4.5 2.2 7.5 5.8 9v5h4v-3h4.4v3h4v-5c3.6-1.5 5.8-4.5 5.8-9C28 7.4 22.9 3 16 3Zm-5 14.5A3.5 3.5 0 1 1 11 10a3.5 3.5 0 0 1 0 7.5Zm10 0A3.5 3.5 0 1 1 21 10a3.5 3.5 0 0 1 0 7.5ZM13 21h6l-3 3-3-3Z" fill="currentColor"/></svg>
            <b id="gold-team-kills">--</b>
          </span>
        </header>
        <div class="gold-roster-rows">${rosterRows}</div>
      </section>
    </main>`
        : `
    <main class="gold-focused-root" id="gold-focused-root" data-gold-panel="player-stats" data-offline="true" data-stale="false" hidden>
      <section class="gold-player-stats gold-enter-bottom" aria-live="polite" aria-atomic="false">
        <div class="gold-player-stat-row">
          <span><small>DAMAGE DEALT</small><strong id="gold-stat-damage">--</strong></span>
          <i>
            <img data-gold-static-asset="/assets/pubg/asset-hud/flaregun.png" alt="" draggable="false" referrerpolicy="no-referrer" />
            <svg class="gold-stat-icon-fallback" aria-hidden="true" viewBox="0 0 64 64"><path d="M8 28h28l9-8 5 4-7 9 13 6-3 7-16-5-7 9h-8l4-11H8zM15 21l20-9 3 7-21 9z" fill="currentColor"/></svg>
          </i>
        </div>
        <div class="gold-player-stat-row">
          <span><small>LONGEST ELIM DIST.</small><strong id="gold-stat-distance">--</strong></span>
          <i><svg aria-hidden="true" viewBox="0 0 64 64"><circle cx="32" cy="32" r="20" fill="none" stroke="currentColor" stroke-width="5"/><circle cx="32" cy="32" r="5" fill="currentColor"/><path d="M32 2v16M32 46v16M2 32h16M46 32h16" stroke="currentColor" stroke-width="5"/></svg></i>
        </div>
        <div class="gold-player-stat-row">
          <span><small>AIRDROPS LOOTED</small><strong id="gold-stat-airdrops">--</strong></span>
          <i>
            <img data-gold-static-asset="/assets/pubg/asset-hud/parachute.png" alt="" draggable="false" referrerpolicy="no-referrer" />
            <svg class="gold-stat-icon-fallback" aria-hidden="true" viewBox="0 0 64 64"><path d="M7 21C10 9 20 3 32 3s22 6 25 18L44 16 32 21 20 16 7 21Zm13-2 10 5v11h4V24l10-5-5 19H25l-5-19Zm7 23h10l3 18H24l3-18Z" fill="currentColor"/></svg>
          </i>
        </div>
      </section>
    </main>`;
    return renderLocalWidgetPage({
      widgetTitle:
        displayMode === "roster"
          ? "Arenzyra Gold Broadcast Focused Roster"
          : "Arenzyra Gold Broadcast Player Stats",
      stylePath: `/obs/static/gold-focused-widget.css?v=${GOLD_FOCUSED_WIDGET_ASSET_VERSION}`,
      scriptPath: `/obs/static/gold-focused-widget.js?v=${GOLD_FOCUSED_WIDGET_ASSET_VERSION}`,
      bootstrap: {
        ...bootstrap,
        displayMode,
        direction: displayMode === "roster" ? "left" : "down",
        localStateUrl: stateUrl,
        staleAfterMs: 2_500,
        goldBroadcastAssetBase,
        defaultPlayerPhoto: "/assets/default-player.svg",
        defaultTeamLogo: "/assets/default-team.png",
      },
      markup,
    });
  }

  if (widgetKey === "fight-alert") {
    return renderLocalWidgetPage({
      widgetTitle: "Arenzyra Fight Detection",
      stylePath: "/obs/static/fight-alert-widget.css",
      scriptPath: "/obs/static/fight-alert-widget.js",
      bootstrap,
      markup: `
    <main
      class="fight-alert-shell"
      id="fight-alert-root"
      data-visible="false"
      aria-hidden="true"
    >
      <section class="fight-alert-panel" id="fight-alert-panel" role="status" aria-live="polite">
        <div class="fight-alert-kicker">LIVE FIGHT</div>
        <div class="fight-alert-matchup">
          <span id="fight-alert-team-a">Team A</span>
          <span class="fight-alert-divider" aria-hidden="true">VS</span>
          <span id="fight-alert-team-b">Team B</span>
        </div>
      </section>
    </main>`,
    });
  }

  if (widgetKey === "replay-marker") {
    return renderReplayMarkerPage({
      bootstrap: {
        ...bootstrap,
        displayWindowMs: 12_000,
      },
      title:
        [
          asString(resolved?.organization?.name),
          asString(resolved?.match?.name),
          "Replay Marker",
        ]
          .filter(Boolean)
          .join(" | ") || "Arenzyra Replay Marker",
    });
  }

  if (widgetKey === "team-eliminated") {
    const matchId = asString(resolved?.match?.id) || asString(resolved?.matchId);
    if (!matchId) {
      return renderStatePage(
        "Match context unavailable",
        "The resolved widget key does not currently point to a match with live state.",
        "match unavailable",
        { retry: true },
      );
    }

    return renderTeamEliminatedPage({
      apiBase,
      bootstrap: {
        ...bootstrap,
        fadeInMs: 220,
        holdMs: 2400,
        fadeOutMs: 320,
        simultaneousWindowMs: 300,
        teamLogoBasePath: "/assets/teams",
        defaultLogoPath: "/assets/default-team.png",
      },
      title:
        [
          asString(resolved?.organization?.name),
          asString(resolved?.match?.name),
          "Team Eliminated Banner",
        ]
          .filter(Boolean)
          .join(" | ") || "Arenzyra Team Eliminated Banner",
    });
  }

  return null;
}

function resolveWidgetRequestError(error) {
  const status = Number(error?.response?.status ?? error?.status);
  const responseData = error?.response?.data;
  const message =
    (Array.isArray(responseData?.message) && responseData.message.length > 0
      ? responseData.message.map((item) => String(item)).join(", ")
      : null) ||
    (typeof responseData?.message === "string" && responseData.message.trim()
      ? responseData.message.trim()
      : null) ||
    (typeof responseData?.error === "string" && responseData.error.trim()
      ? responseData.error.trim()
      : null) ||
    (error instanceof Error ? error.message : String(error || "")) ||
    "The backend widget resolver returned an unexpected response.";

  if (!error?.response && !Number.isFinite(status)) {
    return {
      httpStatus: 502,
      title: "Backend unavailable",
      detail:
        "The desktop widget server could not reach the backend widget resolver.",
      reason: "backend unavailable",
      logReason: message,
    };
  }

  if (status === 404) {
    return {
      httpStatus: 404,
      title: "Widget key not found",
      detail: "The backend did not resolve this widget instance key.",
      reason: "widget key not found",
      logReason: message,
    };
  }

  return {
    httpStatus: 502,
    title: "Widget resolve failed",
    detail: message,
    reason: `backend returned ${status || "unknown status"}`,
    logReason: message,
  };
}

async function resolveWidgetContext({
  apiBase,
  instanceKey,
  log,
  resolveWidgetContextRequest,
}) {
  const keyRef = widgetKeyReference(instanceKey);
  log(`[widget-server] widget key requested keyRef=${keyRef}`);

  try {
    if (typeof resolveWidgetContextRequest !== "function") {
      const error = new Error(
        "The authenticated widget resolver is not configured.",
      );
      error.status = 503;
      throw error;
    }
    const resolved = await resolveWidgetContextRequest({
      apiBase,
      instanceKey,
    });
    log(
      `[widget-server] widgetKey resolved keyRef=${keyRef} widgetKey=${asString(
        resolved?.widgetKey,
      ) || "unresolved"}`,
    );
    return {
      ok: true,
      resolved,
    };
  } catch (error) {
    const failure = resolveWidgetRequestError(error);
    log(
      `[widget-server] resolve failure reason=${failure.reason} keyRef=${keyRef}`,
    );
    return {
      ok: false,
      failure,
    };
  }
}

function chooseWidgetRenderer(widgetKey) {
  if (
    widgetKey === "zone-timer" ||
    widgetKey === "next-zone-update" ||
    widgetKey === "next-zone-update-blade" ||
    widgetKey === "next-zone-update-fold-down" ||
    widgetKey === "next-zone-update-kinetic-hud" ||
    widgetKey === "next-zone-update-pro-sidebar" ||
    widgetKey === "next-zone-update-radar-sweep" ||
    widgetKey === "next-zone-update-gold-ring" ||
    widgetKey === "zone-closing" ||
    widgetKey === "team-status" ||
    widgetKey === "player-photo" ||
    widgetKey === "gold-broadcast-focused-roster" ||
    widgetKey === "gold-broadcast-player-stats" ||
    widgetKey === "fight-alert" ||
    widgetKey === "replay-marker" ||
    widgetKey === "team-eliminated"
  ) {
    return {
      kind: "local",
      name: `local:${widgetKey}`,
    };
  }

  if (LIVE_WIDGET_KEYS.has(widgetKey)) {
    return {
      kind: "remote-live",
      name: `remote-live:${widgetKey}`,
    };
  }

  if (ORGANIZER_WIDGET_KEYS.has(widgetKey)) {
    return {
      kind: "remote-organizer",
      name: `remote-organizer:${widgetKey}`,
    };
  }

  return {
    kind: "placeholder",
    name: `placeholder:${widgetKey || "unknown"}`,
  };
}

async function handleCanonicalWidgetRequest(
  req,
  res,
  {
    resolveApiBase = () => DEFAULT_API_BASE,
    resolveWidgetContextRequest = null,
    wsPath = DEFAULT_WS_PATH,
    log = () => {},
  } = {},
) {
  const instanceKey = asString(req.params?.widgetInstanceKey);

  if (!instanceKey) {
    sendStatePage(res, {
      status: 400,
      title: "Invalid widget URL",
      detail:
        "The backend-issued widget instance key is required to render this widget.",
      reason: "invalid request",
    });
    return;
  }

  const apiBase = normalizeBaseUrl(resolveApiBase());
  const resolvedResponse = await resolveWidgetContext({
    apiBase,
    instanceKey,
    log,
    resolveWidgetContextRequest,
  });

  if (!resolvedResponse.ok) {
    sendStatePage(res, {
      status: resolvedResponse.failure.httpStatus,
      title: resolvedResponse.failure.title,
      detail: resolvedResponse.failure.detail,
      reason: resolvedResponse.failure.reason,
      retry: true,
    });
    return;
  }

  const resolved = resolvedResponse.resolved;
  const resolvedWidgetKey = asString(resolved?.widgetKey);
  const resolvedId = asString(resolved?.id);

  if (!resolvedWidgetKey) {
    sendStatePage(res, {
      status: 404,
      title: "Widget key not found",
      detail:
        "The backend did not return a supported widget type for this widget instance key.",
      reason: "widget key not found",
      retry: true,
    });
    return;
  }

  if (!resolvedId) {
    sendStatePage(res, {
      status: 404,
      title: "Widget instance unavailable",
      detail:
        "The backend key did not resolve to an active, approved widget instance.",
      reason: "widget instance unavailable",
      retry: true,
    });
    return;
  }

  const renderer = chooseWidgetRenderer(resolvedWidgetKey);
  log(
    `[widget-server] local renderer chosen renderer=${renderer.name} widgetKey=${resolvedWidgetKey} keyRef=${widgetKeyReference(
      instanceKey,
    )}`,
  );

  if (renderer.kind === "local") {
    const localWidgetPage = buildLocalWidgetPage({
      widgetKey: resolvedWidgetKey,
      apiBase,
      wsPath,
      instanceKey,
      resolved,
    });
    res.type("html").send(localWidgetPage);
    return;
  }

  if (renderer.kind === "remote-live" || renderer.kind === "remote-organizer") {
    const targetUrl = buildRemoteWidgetUrl(
      apiBase,
      resolved,
      req.query,
      instanceKey,
    );
    if (!targetUrl) {
      sendStatePage(res, {
        status: 501,
        title: "Unsupported widget type",
        detail: `The desktop widget server does not have a renderer mapping for "${resolvedWidgetKey}".`,
        reason: "unsupported widget type",
      });
      return;
    }

    res.type("html").send(
      renderWidgetHostPage({
        widgetKey: resolvedWidgetKey,
        organizationName: asString(resolved?.organization?.name),
        tournamentName: asString(resolved?.tournament?.name),
        targetUrl,
        wsPath,
      }),
    );
    return;
  }

  sendStatePage(res, {
    status: 501,
    title: "Unsupported widget type",
    detail: `The widget "${resolvedWidgetKey}" is resolved by the backend, but a desktop renderer is not implemented yet.`,
    reason: "unsupported widget type",
  });
}

function registerPermanentWidgetRoute(
  app,
  {
    resolveApiBase = () => DEFAULT_API_BASE,
    resolveWidgetContext: resolveWidgetContextRequest = null,
    wsPath = DEFAULT_WS_PATH,
    log = () => {},
  } = {},
) {
  app.get("/w/:widgetInstanceKey", async (req, res) => {
    await handleCanonicalWidgetRequest(req, res, {
      resolveApiBase,
      resolveWidgetContextRequest,
      wsPath,
      log,
    });
  });

  app.get("/w/replay-marker/:widgetInstanceKey", async (req, res) => {
    await handleCanonicalWidgetRequest(req, res, {
      resolveApiBase,
      resolveWidgetContextRequest,
      wsPath,
      log,
    });
  });

  app.get("/obs/widget-context/:widgetInstanceKey", async (req, res) => {
    const instanceKey = asString(req.params?.widgetInstanceKey);
    if (!instanceKey) {
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
      res.status(400).json({
        ok: false,
        error: "widget instance key is required",
      });
      return;
    }

    const apiBase = normalizeBaseUrl(resolveApiBase());
    const resolvedResponse = await resolveWidgetContext({
      apiBase,
      instanceKey,
      log,
      resolveWidgetContextRequest,
    });

    if (!resolvedResponse.ok) {
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
      res.status(resolvedResponse.failure.httpStatus).json({
        ok: false,
        error: resolvedResponse.failure.detail,
      });
      return;
    }

    const resolved = resolvedResponse.resolved;
    const resolvedWidgetKey = asString(resolved?.widgetKey);
    const resolvedId = asString(resolved?.id);
    if (!resolvedWidgetKey || !resolvedId) {
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
      res.status(404).json({
        ok: false,
        error: "widget instance unavailable",
      });
      return;
    }

    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    res.json({
      ok: true,
      ...buildLocalWidgetBootstrap({
        apiBase,
        wsPath,
        instanceKey,
        resolved,
      }),
    });
  });

  app.get("/w/:widgetKey/:key", (req, res) => {
    const requestedWidgetKey = asString(req.params?.widgetKey);
    const instanceKey = asString(req.params?.key);

    if (!requestedWidgetKey || !instanceKey) {
      sendStatePage(res, {
        status: 400,
        title: "Invalid widget URL",
        detail:
          "The legacy widget route must include both the widget type and the backend-issued key.",
        reason: "invalid request",
      });
      return;
    }

    log(
      `[widget-server] legacy widget route requested widgetKey=${requestedWidgetKey} keyRef=${widgetKeyReference(
        instanceKey,
      )}`,
    );
    res.redirect(302, buildCanonicalLocalPath(instanceKey, req.query));
  });
}

module.exports = {
  registerPermanentWidgetRoute,
};
