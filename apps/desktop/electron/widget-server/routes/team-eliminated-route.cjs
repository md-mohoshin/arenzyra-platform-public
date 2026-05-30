"use strict";

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

function buildCanonicalPath(instanceKey, query) {
  const params = new URLSearchParams();

  for (const [name, value] of Object.entries(query || {})) {
    const normalized = readQueryValue(value);
    if (!normalized) {
      continue;
    }
    params.set(name, normalized);
  }

  const search = params.toString();
  const path = `/w/${encodeURIComponent(instanceKey)}`;
  return search ? `${path}?${search}` : path;
}

function renderErrorPage(title, detail) {
  const safeTitle = escapeHtml(title);
  const safeDetail = escapeHtml(detail);

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
        width: min(520px, 100%);
        border-radius: 18px;
        border: 1px solid rgba(149, 191, 220, 0.16);
        background: rgba(4, 12, 18, 0.92);
        padding: 20px 22px;
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
      <h1>${safeTitle}</h1>
      <p>${safeDetail}</p>
    </main>
  </body>
</html>`;
}

function registerTeamEliminatedRoute(app, { log = () => {} } = {}) {
  app.get("/w/team-eliminated/:key", (req, res) => {
    const instanceKey = asString(req.params?.key);
    if (!instanceKey) {
      res
        .status(400)
        .type("html")
        .send(
          renderErrorPage(
            "Invalid widget URL",
            "The backend-issued widget instance key is required to render this widget.",
          ),
        );
      return;
    }

    log(`[widget-server] legacy team-eliminated route requested key=${instanceKey}`);
    res.redirect(302, buildCanonicalPath(instanceKey, req.query));
  });
}

module.exports = {
  registerTeamEliminatedRoute,
};
