"use strict";

const axios = require("axios");
const { getProcessDefaultApiBase } = require("../../apiBaseDefaults.cjs");

const DEFAULT_API_BASE =
  process.env.ARENZYRA_API_URL ||
  process.env.ARENZYRA_API_BASE ||
  getProcessDefaultApiBase();
const DEFAULT_WS_PATH = "/ws";

const LIVE_WIDGET_KEYS = new Set([
  "teams-alive",
  "leaderboard",
  "overall-live-ranking",
  "match-lower-third",
  "kill-feed",
  "player-card",
  "player-photo",
  "map-overlay",
  "next-zone-update",
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

function asString(value) {
  return typeof value === "string" ? value.trim() : "";
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

function buildRemoteWidgetUrl(apiBase, context, query) {
  const widgetKey = asString(context?.widgetKey);
  const organizationSlug =
    asString(context?.organization?.slug) || asString(context?.organizationSlug);
  if (!widgetKey || !organizationSlug) {
    return null;
  }

  let target = null;
  if (LIVE_WIDGET_KEYS.has(widgetKey)) {
    target = new URL(`/widgets/${encodeURIComponent(widgetKey)}`, `${apiBase}/`);
    target.searchParams.set("orgSlug", organizationSlug);
    if (!readQueryValue(query?.clean) && !readQueryValue(query?.preview)) {
      target.searchParams.set("clean", "1");
    }
  } else if (ORGANIZER_WIDGET_KEYS.has(widgetKey)) {
    target = new URL(
      `/widgets/${encodeURIComponent(organizationSlug)}/${encodeURIComponent(widgetKey)}`,
      `${apiBase}/`,
    );
  } else {
    return null;
  }

  const resolvedMatchId =
    asString(context?.match?.id) || asString(context?.matchId);
  if (resolvedMatchId && !readQueryValue(query?.matchId)) {
    target.searchParams.set("matchId", resolvedMatchId);
  }

  for (const [name, value] of Object.entries(query || {})) {
    const normalized = readQueryValue(value);
    if (!normalized) {
      continue;
    }
    target.searchParams.set(name, normalized);
  }

  return target.toString();
}

function renderStatePage(title, detail, reason) {
  const safeTitle = escapeHtml(title);
  const safeDetail = escapeHtml(detail);
  const safeReason = escapeHtml(reason);

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
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
  </body>
</html>`;
}

function renderWidgetHostPage({ widgetKey, organizationName, tournamentName, targetUrl }) {
  const titleParts = ["Arenzyra Widget", widgetKey];
  if (organizationName) {
    titleParts.push(organizationName);
  }
  if (tournamentName) {
    titleParts.push(tournamentName);
  }

  const safeTitle = escapeHtml(titleParts.filter(Boolean).join(" | "));
  const safeTargetUrl = escapeHtml(targetUrl);

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
  </head>
  <body>
    ${markup}
    <script>window.__ARENZYRA_LOCAL_WIDGET_BOOTSTRAP__ = ${payload};</script>
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
          <div class="team-eliminated-banner__eyebrow">TEAM ELIMINATED</div>
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
    return renderLocalWidgetPage({
      widgetTitle: "Arenzyra Player Photo Widget",
      stylePath: "/obs/static/obs-player-photo-widget.css",
      scriptPath: "/obs/static/obs-player-photo-widget.js",
      bootstrap: {
        ...bootstrap,
        localStateUrl: playerPhotoStateUrl,
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
      );
    }

    return renderTeamEliminatedPage({
      apiBase,
      bootstrap: {
        ...bootstrap,
        fadeInMs: 420,
        holdMs: 4600,
        fadeOutMs: 640,
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
  const status = Number(error?.response?.status);
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

  if (!error?.response) {
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

async function resolveWidgetContext({ apiBase, instanceKey, log }) {
  log(`[widget-server] widget key requested key=${instanceKey}`);

  try {
    const response = await axios.get(`${apiBase}/api/widgets/resolve`, {
      params: { key: instanceKey },
      timeout: 10000,
      headers: {
        Accept: "application/json",
      },
    });
    const resolved = response?.data ?? null;
    log(
      `[widget-server] widgetKey resolved key=${instanceKey} widgetKey=${asString(
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
      `[widget-server] resolve failure reason=${failure.reason} key=${instanceKey} detail=${failure.logReason}`,
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
    widgetKey === "zone-closing" ||
    widgetKey === "team-status" ||
    widgetKey === "player-photo" ||
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
    wsPath = DEFAULT_WS_PATH,
    log = () => {},
  } = {},
) {
  const instanceKey = asString(req.params?.widgetInstanceKey);

  if (!instanceKey) {
    res
      .status(400)
      .type("html")
      .send(
        renderStatePage(
          "Invalid widget URL",
          "The backend-issued widget instance key is required to render this widget.",
          "invalid request",
        ),
      );
    return;
  }

  const apiBase = normalizeBaseUrl(resolveApiBase());
  const resolvedResponse = await resolveWidgetContext({
    apiBase,
    instanceKey,
    log,
  });

  if (!resolvedResponse.ok) {
    res
      .status(resolvedResponse.failure.httpStatus)
      .type("html")
      .send(
        renderStatePage(
          resolvedResponse.failure.title,
          resolvedResponse.failure.detail,
          resolvedResponse.failure.reason,
        ),
      );
    return;
  }

  const resolved = resolvedResponse.resolved;
  const resolvedWidgetKey = asString(resolved?.widgetKey);
  const resolvedId = asString(resolved?.id);

  if (!resolvedWidgetKey) {
    res
      .status(404)
      .type("html")
      .send(
        renderStatePage(
          "Widget key not found",
          "The backend did not return a supported widget type for this widget instance key.",
          "widget key not found",
        ),
      );
    return;
  }

  if (!resolvedId) {
    res
      .status(404)
      .type("html")
      .send(
        renderStatePage(
          "Widget instance unavailable",
          "The backend key did not resolve to an active, approved widget instance.",
          "widget instance unavailable",
        ),
      );
    return;
  }

  const renderer = chooseWidgetRenderer(resolvedWidgetKey);
  log(
    `[widget-server] local renderer chosen renderer=${renderer.name} widgetKey=${resolvedWidgetKey} key=${instanceKey}`,
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
    const targetUrl = buildRemoteWidgetUrl(apiBase, resolved, req.query);
    if (!targetUrl) {
      res
        .status(501)
        .type("html")
        .send(
          renderStatePage(
            "Unsupported widget type",
            `The desktop widget server does not have a renderer mapping for "${resolvedWidgetKey}".`,
            "unsupported widget type",
          ),
        );
      return;
    }

    res.type("html").send(
      renderWidgetHostPage({
        widgetKey: resolvedWidgetKey,
        organizationName: asString(resolved?.organization?.name),
        tournamentName: asString(resolved?.tournament?.name),
        targetUrl,
      }),
    );
    return;
  }

  res
    .status(501)
    .type("html")
    .send(
      renderStatePage(
        "Unsupported widget type",
        `The widget "${resolvedWidgetKey}" is resolved by the backend, but a desktop renderer is not implemented yet.`,
        "unsupported widget type",
      ),
    );
}

function registerPermanentWidgetRoute(
  app,
  {
    resolveApiBase = () => DEFAULT_API_BASE,
    wsPath = DEFAULT_WS_PATH,
    log = () => {},
  } = {},
) {
  app.get("/w/:widgetInstanceKey", async (req, res) => {
    await handleCanonicalWidgetRequest(req, res, {
      resolveApiBase,
      wsPath,
      log,
    });
  });

  app.get("/w/replay-marker/:widgetInstanceKey", async (req, res) => {
    await handleCanonicalWidgetRequest(req, res, {
      resolveApiBase,
      wsPath,
      log,
    });
  });

  app.get("/w/:widgetKey/:key", (req, res) => {
    const requestedWidgetKey = asString(req.params?.widgetKey);
    const instanceKey = asString(req.params?.key);

    if (!requestedWidgetKey || !instanceKey) {
      res
        .status(400)
        .type("html")
        .send(
          renderStatePage(
            "Invalid widget URL",
            "The legacy widget route must include both the widget type and the backend-issued key.",
            "invalid request",
          ),
        );
      return;
    }

    log(
      `[widget-server] legacy widget route requested widgetKey=${requestedWidgetKey} key=${instanceKey}`,
    );
    res.redirect(302, buildCanonicalLocalPath(instanceKey, req.query));
  });
}

module.exports = {
  registerPermanentWidgetRoute,
};
