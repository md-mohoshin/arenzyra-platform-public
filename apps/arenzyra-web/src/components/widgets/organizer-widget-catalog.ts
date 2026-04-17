import { LIVE_WIDGETS, type LiveWidgetCatalogItem } from "@/components/widgets/live-widgets";

export type WidgetRoadmapItem = {
  key: string;
  title: string;
  description: string;
};

export type WidgetSectionKey = "pre-match" | "in-match" | "post-match";

export type WidgetRoadmapSection = {
  key: WidgetSectionKey;
  title: string;
  description: string;
  family: "legacy" | "live";
  buildFirst?: string;
  widgets: WidgetRoadmapItem[];
};

export type OrganizerWidgetCatalogItem = WidgetRoadmapItem & {
  sectionKey: WidgetSectionKey;
  sectionTitle: string;
  family: "legacy" | "live";
  implemented: boolean;
  liveKey: LiveWidgetCatalogItem["key"] | null;
};

export const implementedLegacyWidgets = new Set([
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

export function slugify(input?: string | null) {
  return (
    input
      ?.toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "arenzyra"
  );
}

export function isLiveRoadmapKey(key: string): key is LiveWidgetCatalogItem["key"] {
  return LIVE_WIDGETS.some((widget) => widget.key === key);
}

export const organizerWidgetRoadmap: WidgetRoadmapSection[] = [
  {
    key: "pre-match",
    title: "Pre-Match Widgets",
    description: "Broadcast elements shown before a match starts.",
    family: "legacy",
    buildFirst: "Countdown",
    widgets: [
      {
        key: "countdown",
        title: "Countdown",
        description: "Pre-show timer for lobbies, intros, and sponsored segments.",
      },
      {
        key: "match-intro",
        title: "Match Intro",
        description: "Opening slate with match name, map, and broadcast context.",
      },
      {
        key: "teams-lineup",
        title: "Teams Lineup",
        description: "Starting lineup card for all teams entering the lobby.",
      },
      {
        key: "map-card",
        title: "Map Card",
        description: "Map spotlight graphic shown before the drop.",
      },
      {
        key: "lobby-slot-list",
        title: "Lobby / Slot List",
        description: "Team slot overview for casters and observers before go-live.",
      },
      {
        key: "sponsor-banner",
        title: "Sponsor Banner",
        description: "Brand placement module for pre-show sponsor visibility.",
      },
      {
        key: "next-match",
        title: "Next Match",
        description: "Upcoming match reminder card for transitions and breaks.",
      },
    ],
  },
  {
    key: "in-match",
    title: "In-Match Widgets",
    description: "Live overlays used during active gameplay.",
    family: "live",
    widgets: LIVE_WIDGETS.map((widget) => ({
      key: widget.key,
      title: widget.title,
      description: widget.description,
    })),
  },
  {
    key: "post-match",
    title: "Post-Match Widgets",
    description: "Broadcast widgets for results and wrap-up.",
    family: "legacy",
    widgets: [
      {
        key: "match-results",
        title: "Match Results",
        description: "Final match summary board with placements and kills.",
      },
      {
        key: "match-summary",
        title: "Match Summary",
        description: "Aggregate match totals for kills, knocks, assists, damage, and duration.",
      },
      {
        key: "head-to-head-comparison",
        title: "Head to Head Comparison",
        description: "Winner versus runner-up board once telemetry confirms the final last-team-alive result.",
      },
      {
        key: "mvp-top-fragger",
        title: "MVP / Top Fragger",
        description: "Hero card for standout players after the match ends.",
      },
      {
        key: "points-breakdown",
        title: "Points Breakdown",
        description: "Detailed points split for placement, kills, and bonuses.",
      },
      {
        key: "overall-standings",
        title: "Overall Standings",
        description: "Tournament leaderboard update after each completed match.",
      },
      {
        key: "winner-celebration",
        title: "Winner Celebration",
        description: "Victory moment overlay for the winning team or player.",
      },
      {
        key: "next-match-break",
        title: "Next Match / Break",
        description: "Transition panel for upcoming match flow and downtime.",
      },
    ],
  },
];

export const organizerWidgetCatalog: OrganizerWidgetCatalogItem[] =
  organizerWidgetRoadmap.flatMap((section) =>
    section.widgets.map((widget) => ({
      ...widget,
      sectionKey: section.key,
      sectionTitle: section.title,
      family: section.family,
      implemented:
        section.family === "live" ? true : implementedLegacyWidgets.has(widget.key),
      liveKey: isLiveRoadmapKey(widget.key) ? widget.key : null,
    })),
  );

export function findOrganizerWidgetCatalogItem(widgetKey: string) {
  return organizerWidgetCatalog.find((widget) => widget.key === widgetKey) ?? null;
}

export function buildLegacyWidgetPath(orgSlug: string, widgetKey: string) {
  return `/widgets/${orgSlug}/${widgetKey}`;
}

export function buildLiveWidgetPath(
  orgSlug: string,
  widgetKey: LiveWidgetCatalogItem["key"],
  options?: {
    matchId?: string | null;
    preview?: boolean;
    clean?: boolean;
  },
) {
  const query = new URLSearchParams({
    orgSlug,
  });

  if (options?.matchId?.trim()) {
    query.set("matchId", options.matchId.trim());
  }
  if (options?.preview) {
    query.set("preview", "true");
  }
  if (options?.clean) {
    query.set("clean", "1");
  }

  return `/widgets/${widgetKey}?${query.toString()}`;
}

export function buildOrganizerWidgetDetailPath(widgetKey: string) {
  return `/organizer/widgets/${widgetKey}`;
}
