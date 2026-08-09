export type ObsWidgetDefinition = {
  id: string;
  name: string;
  category: string;
  description: string;
  path: string;
  query?: Record<string, string>;
  previewHeight?: number;
  routeKind?: "raw" | "permanent";
  widgetKey?: string;
  requiresWidgetInstanceKey?: boolean;
};

type BuildWidgetUrlOptions = {
  widgetInstanceKey?: string | null;
};

export const widgetCategoryOrder = [
  "Desktop Raw Widgets",
];

export const widgets: ObsWidgetDefinition[] = [
  {
    id: "map",
    name: "Live Map",
    category: "Desktop Raw Widgets",
    description:
      "Primary tactical map overlay for the live broadcast feed.",
    path: "/obs/map",
    query: {
      commentary: "1",
      distances: "1",
      legend: "1",
    },
    previewHeight: 520,
    routeKind: "raw",
  },
  {
    id: "ai_caster",
    name: "AI Caster",
    category: "Desktop Raw Widgets",
    description:
      "Approved AI caster output driven by the live launcher map telemetry.",
    path: "/obs/ai-caster",
    previewHeight: 160,
    routeKind: "raw",
  },
  {
    id: "commentator_desk",
    name: "Commentator Desk",
    category: "Desktop Raw Widgets",
    description:
      "Approved local desk view with live map, fight cues, distances, and production notes.",
    path: "/obs/commentator-desk",
    previewHeight: 720,
    routeKind: "raw",
  },
  {
    id: "next_zone_update",
    name: "Next Zone Update",
    category: "Desktop Raw Widgets",
    description:
      "Low-latency final 20-second zone countdown driven by launcher telemetry.",
    path: "/w/:widgetInstanceKey",
    previewHeight: 160,
    routeKind: "permanent",
    widgetKey: "next-zone-update",
    requiresWidgetInstanceKey: true,
  },
  {
    id: "next_zone_update_pro_sidebar",
    name: "Next Zone Update - Pro Sidebar",
    category: "Desktop Raw Widgets",
    description:
      "Approved Pro Sidebar style final 20-second zone countdown driven by launcher telemetry.",
    path: "/w/:widgetInstanceKey",
    previewHeight: 160,
    routeKind: "permanent",
    widgetKey: "next-zone-update-pro-sidebar",
    requiresWidgetInstanceKey: true,
  },
  {
    id: "next_zone_update_kinetic_hud",
    name: "Next Zone Update - Kinetic HUD",
    category: "Desktop Raw Widgets",
    description:
      "Animated Kinetic HUD style final 20-second zone countdown driven by launcher telemetry.",
    path: "/w/:widgetInstanceKey",
    previewHeight: 160,
    routeKind: "permanent",
    widgetKey: "next-zone-update-kinetic-hud",
    requiresWidgetInstanceKey: true,
  },
  {
    id: "next_zone_update_blade",
    name: "Next Zone Update - Blade Countdown",
    category: "Desktop Raw Widgets",
    description:
      "Approved Blade Countdown style final 20-second zone countdown using organization branding.",
    path: "/w/:widgetInstanceKey",
    previewHeight: 160,
    routeKind: "permanent",
    widgetKey: "next-zone-update-blade",
    requiresWidgetInstanceKey: true,
  },
  {
    id: "next_zone_update_radar_sweep",
    name: "Next Zone Update - Radar Sweep",
    category: "Desktop Raw Widgets",
    description:
      "Approved Radar Sweep style final 20-second zone countdown using organization branding.",
    path: "/w/:widgetInstanceKey",
    previewHeight: 180,
    routeKind: "permanent",
    widgetKey: "next-zone-update-radar-sweep",
    requiresWidgetInstanceKey: true,
  },
  {
    id: "next_zone_update_fold_down",
    name: "Next Zone Update - Fold Down",
    category: "Desktop Raw Widgets",
    description:
      "Approved fold-down page style final 20-second zone countdown using organization branding.",
    path: "/w/:widgetInstanceKey",
    previewHeight: 180,
    routeKind: "permanent",
    widgetKey: "next-zone-update-fold-down",
    requiresWidgetInstanceKey: true,
  },
  {
    id: "obs_player_photo",
    name: "Player Photo",
    category: "Desktop Raw Widgets",
    description:
      "Low-latency local focused player portrait widget tied to the current launcher session.",
    path: "/obs/player-photo",
    previewHeight: 300,
    routeKind: "raw",
  },
];

function normalizeBaseUrl(baseUrl: string) {
  const parsed = new URL(baseUrl);
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/$/, "");
}

function applyBaseQuery(url: URL, baseUrl: string) {
  new URL(baseUrl).searchParams.forEach((value, key) => {
    url.searchParams.set(key, value);
  });
}

function appendBaseQuery(url: string, baseUrl: string) {
  const query = new URL(baseUrl).searchParams.toString();
  if (!query) {
    return url;
  }
  return `${url}${url.includes("?") ? "&" : "?"}${query}`;
}

function resolvePermanentWidgetPath(
  widget: ObsWidgetDefinition,
  widgetInstanceKey: string,
) {
  const template = widget.path || "/w/:widgetInstanceKey";
  if (template.includes(":widgetInstanceKey")) {
    return template.replace(":widgetInstanceKey", widgetInstanceKey);
  }
  return `${template.replace(/\/$/, "")}/${widgetInstanceKey}`;
}

function applyWidgetQuery(url: URL, widget: ObsWidgetDefinition) {
  Object.entries(widget.query ?? {}).forEach(([key, value]) => {
    const normalizedValue = String(value || "").trim();
    if (normalizedValue) {
      url.searchParams.set(key, normalizedValue);
    }
  });
}

export function buildWidgetUrlTemplate(baseUrl: string, widget: ObsWidgetDefinition) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);

  if (widget.routeKind === "permanent") {
    return appendBaseQuery(
      `${normalizedBaseUrl}${resolvePermanentWidgetPath(widget, "<widget-instance-key>")}`,
      baseUrl,
    );
  }

  const url = new URL(widget.path, `${normalizedBaseUrl}/`);
  applyWidgetQuery(url, widget);
  applyBaseQuery(url, baseUrl);
  return url.toString();
}

export function buildWidgetUrl(
  baseUrl: string,
  widget: ObsWidgetDefinition,
  options?: BuildWidgetUrlOptions,
) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);

  if (widget.routeKind === "permanent") {
    const widgetInstanceKey = String(options?.widgetInstanceKey || "").trim();
    if (!widgetInstanceKey) {
      return buildWidgetUrlTemplate(normalizedBaseUrl, widget);
    }
    return appendBaseQuery(
      `${normalizedBaseUrl}${resolvePermanentWidgetPath(
        widget,
        encodeURIComponent(widgetInstanceKey),
      )}`,
      baseUrl,
    );
  }

  const url = new URL(widget.path, `${normalizedBaseUrl}/`);
  applyWidgetQuery(url, widget);
  applyBaseQuery(url, baseUrl);
  return url.toString();
}

export function canBuildWidgetUrl(
  widget: ObsWidgetDefinition,
  options?: BuildWidgetUrlOptions,
) {
  if (widget.routeKind !== "permanent") {
    return true;
  }
  return Boolean(String(options?.widgetInstanceKey || "").trim());
}
