import { notFound, redirect } from "next/navigation";

const liveWidgetKeys = new Set([
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

type LegacyLiveWidgetRedirectPageProps = {
  params: Promise<{
    orgSlug: string;
    widgetKey: string;
  }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function readFirstQueryValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return typeof value[0] === "string" ? value[0] : null;
  }
  return typeof value === "string" ? value : null;
}

export default async function LegacyLiveWidgetRedirectPage({
  params,
  searchParams,
}: LegacyLiveWidgetRedirectPageProps) {
  const { orgSlug, widgetKey } = await params;

  if (!liveWidgetKeys.has(widgetKey)) {
    notFound();
  }

  const query = await searchParams;
  const nextQuery = new URLSearchParams({
    orgSlug,
  });

  const matchId = readFirstQueryValue(query.matchId)?.trim();
  const preview = readFirstQueryValue(query.preview)?.trim();

  if (matchId) {
    nextQuery.set("matchId", matchId);
  }
  if (preview) {
    nextQuery.set("preview", preview);
  }

  redirect(`/widgets/${widgetKey}?${nextQuery.toString()}`);
}
