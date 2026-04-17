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
  "In-Match",
  "Production",
  "Permanent Widgets",
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
    id: "map_operator",
    name: "Map Operator Panel",
    category: "Desktop Raw Widgets",
    description:
      "Adds the operator panel for watch targets, alerts, and production control.",
    path: "/obs/map",
    query: {
      commentary: "1",
      distances: "1",
      legend: "1",
      operatorpanel: "1",
    },
    previewHeight: 520,
    routeKind: "raw",
  },
  {
    id: "map_camera",
    name: "Map Camera Assist",
    category: "Desktop Raw Widgets",
    description:
      "Shows camera-assist recommendations alongside the live map overlay.",
    path: "/obs/map",
    query: {
      cameraassist: "1",
      commentary: "1",
      distances: "1",
      legend: "1",
    },
    previewHeight: 520,
    routeKind: "raw",
  },
  {
    id: "map_operator_console",
    name: "Map Operator Console",
    category: "Desktop Raw Widgets",
    description:
      "Combined operator, assist, and camera panels for advanced monitoring.",
    path: "/obs/map",
    query: {
      assistpanel: "1",
      cameraassist: "1",
      commentary: "1",
      debug: "1",
      distances: "1",
      legend: "1",
      operatorpanel: "1",
    },
    previewHeight: 560,
    routeKind: "raw",
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
  {
    id: "team-eliminated",
    name: "Team Eliminated Banner",
    category: "In-Match",
    description:
      "Local desktop banner that resolves a widget key and animates from backend-issued observer team elimination events.",
    path: "/w/:widgetInstanceKey",
    previewHeight: 260,
    routeKind: "permanent",
    widgetKey: "team-eliminated",
    requiresWidgetInstanceKey: true,
  },
  {
    id: "replay-marker",
    name: "Replay Marker",
    category: "Production",
    description:
      "Permanent backend-issued route for the local replay marker widget.",
    path: "/w/replay-marker/:widgetInstanceKey",
    previewHeight: 280,
    routeKind: "permanent",
    widgetKey: "replay-marker",
    requiresWidgetInstanceKey: true,
  },
  {
    id: "permanent_map_overlay",
    name: "Map Overlay",
    category: "Permanent Widgets",
    description:
      "Permanent backend-issued route for the web map overlay widget.",
    path: "/w/:widgetInstanceKey",
    previewHeight: 520,
    routeKind: "permanent",
    widgetKey: "map-overlay",
    requiresWidgetInstanceKey: true,
  },
  {
    id: "permanent_leaderboard",
    name: "Leaderboard",
    category: "Permanent Widgets",
    description:
      "Permanent backend-issued route for the live leaderboard widget.",
    path: "/w/:widgetInstanceKey",
    previewHeight: 520,
    routeKind: "permanent",
    widgetKey: "leaderboard",
    requiresWidgetInstanceKey: true,
  },
  {
    id: "permanent_kill_feed",
    name: "Kill Feed",
    category: "Permanent Widgets",
    description:
      "Permanent backend-issued route for the kill feed widget.",
    path: "/w/:widgetInstanceKey",
    previewHeight: 520,
    routeKind: "permanent",
    widgetKey: "kill-feed",
    requiresWidgetInstanceKey: true,
  },
  {
    id: "permanent_teams_alive",
    name: "Teams Alive",
    category: "Permanent Widgets",
    description:
      "Permanent backend-issued route for the teams alive widget.",
    path: "/w/:widgetInstanceKey",
    previewHeight: 520,
    routeKind: "permanent",
    widgetKey: "teams-alive",
    requiresWidgetInstanceKey: true,
  },
  {
    id: "permanent_overall_live_ranking",
    name: "Overall Live Ranking",
    category: "Permanent Widgets",
    description:
      "Permanent backend-issued route for the overall live ranking widget.",
    path: "/w/:widgetInstanceKey",
    previewHeight: 520,
    routeKind: "permanent",
    widgetKey: "overall-live-ranking",
    requiresWidgetInstanceKey: true,
  },
  {
    id: "permanent_match_lower_third",
    name: "Match Lower Third",
    category: "Permanent Widgets",
    description:
      "Permanent backend-issued route for the match lower-third widget.",
    path: "/w/:widgetInstanceKey",
    previewHeight: 520,
    routeKind: "permanent",
    widgetKey: "match-lower-third",
    requiresWidgetInstanceKey: true,
  },
  {
    id: "permanent_team_status",
    name: "Team Status Bar",
    category: "Permanent Widgets",
    description:
      "Permanent backend-issued route for the local team status bar widget with live HP, state, and focus highlight.",
    path: "/w/:widgetInstanceKey",
    previewHeight: 340,
    routeKind: "permanent",
    widgetKey: "team-status",
    requiresWidgetInstanceKey: true,
  },
  {
    id: "permanent_player_card",
    name: "Player Card",
    category: "Permanent Widgets",
    description:
      "Permanent backend-issued route for the focused player card widget.",
    path: "/w/:widgetInstanceKey",
    previewHeight: 520,
    routeKind: "permanent",
    widgetKey: "player-card",
    requiresWidgetInstanceKey: true,
  },
  {
    id: "permanent_player_photo",
    name: "Player Photo (Permanent)",
    category: "Permanent Widgets",
    description:
      "Permanent backend-issued route for the focused player portrait widget with no text or stats.",
    path: "/w/:widgetInstanceKey",
    previewHeight: 300,
    routeKind: "permanent",
    widgetKey: "player-photo",
    requiresWidgetInstanceKey: true,
  },
  {
    id: "permanent_zone_timer",
    name: "Zone Timer Widget",
    category: "Permanent Widgets",
    description:
      "Permanent backend-issued route for the local zone timer countdown card driven entirely by desktop zone updates.",
    path: "/w/:widgetInstanceKey",
    previewHeight: 300,
    routeKind: "permanent",
    widgetKey: "zone-timer",
    requiresWidgetInstanceKey: true,
  },
  {
    id: "permanent_zone_closing",
    name: "Zone Closing Alert Banner",
    category: "Permanent Widgets",
    description:
      "Permanent backend-issued route for the local zone closing alert banner.",
    path: "/w/:widgetInstanceKey",
    previewHeight: 320,
    routeKind: "permanent",
    widgetKey: "zone-closing",
    requiresWidgetInstanceKey: true,
  },
  {
    id: "permanent_next_zone_update",
    name: "Next Zone Update",
    category: "Permanent Widgets",
    description:
      "Permanent backend-issued route for the next zone update widget.",
    path: "/w/:widgetInstanceKey",
    previewHeight: 520,
    routeKind: "permanent",
    widgetKey: "next-zone-update",
    requiresWidgetInstanceKey: true,
  },
  {
    id: "permanent_wwcd",
    name: "WWCD",
    category: "Permanent Widgets",
    description:
      "Permanent backend-issued route for the WWCD widget.",
    path: "/w/:widgetInstanceKey",
    previewHeight: 520,
    routeKind: "permanent",
    widgetKey: "wwcd",
    requiresWidgetInstanceKey: true,
  },
  {
    id: "permanent_winner",
    name: "Winner",
    category: "Permanent Widgets",
    description:
      "Permanent backend-issued route for the winner widget.",
    path: "/w/:widgetInstanceKey",
    previewHeight: 520,
    routeKind: "permanent",
    widgetKey: "winner",
    requiresWidgetInstanceKey: true,
  },
  {
    id: "permanent_fight_alert",
    name: "Fight Detection",
    category: "Permanent Widgets",
    description:
      "Permanent backend-issued route for the local fight detection OBS widget.",
    path: "/w/:widgetInstanceKey",
    previewHeight: 520,
    routeKind: "permanent",
    widgetKey: "fight-alert",
    requiresWidgetInstanceKey: true,
  },
  {
    id: "permanent_achievement_alert",
    name: "Achievement Alert",
    category: "Permanent Widgets",
    description:
      "Permanent backend-issued route for the achievement alert widget.",
    path: "/w/:widgetInstanceKey",
    previewHeight: 520,
    routeKind: "permanent",
    widgetKey: "achievement-alert",
    requiresWidgetInstanceKey: true,
  },
  {
    id: "permanent_team_eliminated_alert",
    name: "Team Eliminated Alert",
    category: "Permanent Widgets",
    description:
      "Permanent backend-issued route for the team eliminated alert widget.",
    path: "/w/:widgetInstanceKey",
    previewHeight: 520,
    routeKind: "permanent",
    widgetKey: "team-eliminated-alert",
    requiresWidgetInstanceKey: true,
  },
];

function normalizeBaseUrl(baseUrl: string) {
  return baseUrl.replace(/\/$/, "");
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
    return `${normalizedBaseUrl}${resolvePermanentWidgetPath(widget, "<widget-instance-key>")}`;
  }

  const url = new URL(widget.path, `${normalizedBaseUrl}/`);
  applyWidgetQuery(url, widget);
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
    return `${normalizedBaseUrl}${resolvePermanentWidgetPath(
      widget,
      encodeURIComponent(widgetInstanceKey),
    )}`;
  }

  const url = new URL(widget.path, `${normalizedBaseUrl}/`);
  applyWidgetQuery(url, widget);
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
