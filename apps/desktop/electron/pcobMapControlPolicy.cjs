"use strict";

const FINISHED_MATCH_STATUSES = new Set([
  "ENDED",
  "FINISH_PENDING",
  "FINISHED",
]);

function normalizeOptionalString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeMatchStatus(value) {
  return normalizeOptionalString(value)?.toUpperCase() ?? null;
}

function matchesCurrentMatch(sourceMatchId, currentMatchId) {
  const normalizedSourceMatchId = normalizeOptionalString(sourceMatchId);
  return Boolean(
    normalizedSourceMatchId &&
      currentMatchId &&
      normalizedSourceMatchId === currentMatchId,
  );
}

function resolvePcobMapControlLifecycle({
  matchFlow,
  telemetry,
  observerFeed,
} = {}) {
  const matchId = normalizeOptionalString(matchFlow?.currentMatchId);
  const matchStatus = normalizeMatchStatus(matchFlow?.currentStatus);
  const matchLive = Boolean(matchId && matchStatus === "LIVE");
  const matchFinished = FINISHED_MATCH_STATUSES.has(matchStatus);

  const telemetryBridgeReady = Boolean(
    telemetry?.running === true &&
      matchesCurrentMatch(telemetry?.matchId, matchId) &&
      (telemetry?.telemetryActive === true ||
        telemetry?.telemetryAccepted === true),
  );
  const observerFeedReady = Boolean(
    observerFeed?.running === true &&
      observerFeed?.ready === true &&
      matchesCurrentMatch(observerFeed?.matchId, matchId),
  );
  const telemetrySource = telemetryBridgeReady
    ? "telemetry-bridge"
    : observerFeedReady
      ? "observer-feed"
      : null;
  const telemetrySourceReady = Boolean(telemetrySource);

  return {
    eligible: matchLive && telemetrySourceReady,
    matchId,
    matchStatus,
    matchLive,
    matchFinished,
    telemetrySource,
    telemetrySourceReady,
  };
}

module.exports = {
  resolvePcobMapControlLifecycle,
};
