(function () {
  "use strict";

  var bootstrap = window.__ARENZYRA_LOCAL_WIDGET_BOOTSTRAP__ || {};
  var root = document.documentElement;
  var refreshInFlight = false;
  var refreshTimer = null;
  var REFRESH_INTERVAL_MS = 15000;
  var GOLD_SOLID_FALLBACK = "#eedd77";
  var GOLD_FOCUSED_WIDGET_KEYS = {
    "gold-broadcast-focused-roster": true,
    "gold-broadcast-player-stats": true,
  };

  function asString(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function parseRecord(value) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value;
    }
    var raw = asString(value);
    if (!raw) return null;
    try {
      var parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed
        : null;
    } catch (_) {
      return null;
    }
  }

  function normalizeHex(value, fallback) {
    var raw = asString(value).replace(/^#/, "");
    if (/^[0-9a-f]{3}$/i.test(raw)) {
      return (
        "#" +
        raw
          .split("")
          .map(function (part) {
            return part + part;
          })
          .join("")
          .toLowerCase()
      );
    }
    return /^[0-9a-f]{6}$/i.test(raw) ? "#" + raw.toLowerCase() : fallback;
  }

  function rgba(hex, alpha) {
    var normalized = normalizeHex(hex, "#00e5ff");
    var value = Number.parseInt(normalized.slice(1), 16);
    var red = (value >> 16) & 255;
    var green = (value >> 8) & 255;
    var blue = value & 255;
    return "rgba(" + red + ", " + green + ", " + blue + ", " + alpha + ")";
  }

  function brandingFromContext(context) {
    var organization = parseRecord(context && context.organization);
    var nested =
      parseRecord(organization && organization.branding) ||
      parseRecord(context && context.branding) ||
      parseRecord(context && context.data);
    if (nested) return nested;

    // `/branding/:organizationId` returns the palette directly, while local
    // widget routes wrap it in an organization/context object.
    return context &&
      typeof context === "object" &&
      (context.primaryColor || context.secondaryColor || context.accent)
      ? context
      : null;
  }

  function organizationBrandingFromContext(context) {
    var organization = parseRecord(context && context.organization);
    return parseRecord(organization && organization.branding);
  }

  function resolveGoldSolid(branding) {
    if (!branding) return GOLD_SOLID_FALLBACK;
    return (
      normalizeHex(branding.primaryColor, "") ||
      normalizeHex(branding.primary, "") ||
      GOLD_SOLID_FALLBACK
    );
  }

  function applyFocusedGoldSolid(context) {
    if (!GOLD_FOCUSED_WIDGET_KEYS[asString(bootstrap.widgetKey)]) {
      return false;
    }
    root.style.setProperty(
      "--gold-solid",
      resolveGoldSolid(organizationBrandingFromContext(context)),
    );
    return true;
  }

  function applyBranding(context) {
    var appliedFocusedGold = applyFocusedGoldSolid(context);
    var branding = brandingFromContext(context);
    if (!branding) return appliedFocusedGold;

    var primary = normalizeHex(branding.primaryColor || branding.primary, "#00e5ff");
    var secondary = normalizeHex(
      branding.secondaryColor || branding.secondary || branding.accent,
      "#38bdf8",
    );
    var accent = normalizeHex(branding.accent || branding.primaryColor, "#f5a524");
    var panel = normalizeHex(
      branding.panel || branding.widgetBackground || branding.backgroundSolid || branding.effectiveBackground,
      "#0b1220",
    );
    var background = normalizeHex(
      branding.effectiveBackground || branding.backgroundSolid || branding.widgetBackground || branding.panel,
      "#071018",
    );
    var text = normalizeHex(branding.textPrimary || branding.badgeText, "#f8fbff");
    var muted = normalizeHex(branding.textMuted, "#cbd5e1");
    var border = asString(branding.border) || rgba(primary, 0.34);
    var glow = asString(branding.glowAccent) || rgba(primary, 0.3);

    root.style.setProperty("--obs-brand-primary", primary);
    root.style.setProperty("--obs-brand-secondary", secondary);
    root.style.setProperty("--obs-brand-accent", accent);
    root.style.setProperty("--obs-brand-panel", panel);
    root.style.setProperty("--obs-brand-background", background);
    root.style.setProperty("--obs-brand-text", text);
    root.style.setProperty("--obs-brand-muted", muted);
    root.style.setProperty("--obs-brand-border", border);
    root.style.setProperty("--obs-brand-glow", glow);
    root.style.setProperty("--obs-brand-primary-soft", rgba(primary, 0.2));
    root.style.setProperty("--obs-brand-secondary-soft", rgba(secondary, 0.18));
    root.style.setProperty("--obs-brand-accent-soft", rgba(accent, 0.18));
    return true;
  }

  async function refreshBranding() {
    var localRefreshPath = asString(bootstrap.brandingRefreshPath);
    // Local widgets must refresh through the launcher-owned same-origin route.
    // Fetching brandingApiUrl as well causes an unnecessary cross-origin call
    // every 15 seconds even after the local refresh succeeded. Keep the remote
    // URL only as compatibility for pages that do not provide a local proxy.
    var paths = localRefreshPath
      ? [localRefreshPath]
      : [asString(bootstrap.brandingApiUrl)].filter(Boolean);
    if (paths.length === 0 || refreshInFlight) return;

    refreshInFlight = true;
    try {
      for (var index = 0; index < paths.length; index += 1) {
        try {
          var response = await fetch(paths[index], { cache: "no-store" });
          if (!response.ok) continue;
          var context = await response.json();
          if (context && typeof context === "object" && applyBranding(context)) {
            return;
          }
        } catch (_) {
          // Keep the last usable palette until the same-origin route recovers.
        }
      }
    } finally {
      refreshInFlight = false;
    }
  }

  applyBranding(bootstrap);
  // The next-zone client already refreshes this same context for its richer
  // per-widget palette. Avoid a second polling loop on those pages.
  var usesDedicatedBrandingClient = /^next-zone(?:-|$)/.test(asString(bootstrap.widgetKey));
  if (
    (asString(bootstrap.brandingRefreshPath) ||
      asString(bootstrap.brandingApiUrl)) &&
    !usesDedicatedBrandingClient
  ) {
    void refreshBranding();
    refreshTimer = window.setInterval(refreshBranding, REFRESH_INTERVAL_MS);
  }

  window.addEventListener("beforeunload", function () {
    if (refreshTimer !== null) {
      window.clearInterval(refreshTimer);
    }
  });
})();
