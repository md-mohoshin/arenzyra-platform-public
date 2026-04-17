"use strict";

const { computeDistanceToZoneEdge } = require("./hot-zone-detector.cjs");
const { distanceBetween } = require("./team-proximity-utils.cjs");

function detectTeamSplitRisks({
  teamSummaries,
  hotZones,
  zone,
  config,
  updatedAt,
} = {}) {
  const sourceTeams = Array.isArray(teamSummaries) ? teamSummaries : [];
  const sourceHotZones = Array.isArray(hotZones) ? hotZones : [];
  const splitThreshold = config?.TEAM_SPLIT_RADIUS_THRESHOLD ?? 0;
  const mediumThreshold =
    splitThreshold * (config?.TEAM_SPLIT_MEDIUM_FACTOR ?? 1.35);
  const highThreshold =
    splitThreshold * (config?.TEAM_SPLIT_HIGH_FACTOR ?? 1.8);
  const finalCirclePhaseThreshold = config?.FINAL_CIRCLE_PHASE_THRESHOLD ?? 7;
  const zonePhase = Number.isFinite(zone?.phase) ? zone.phase : null;
  const isLateGame =
    zonePhase !== null && zonePhase >= Math.max(1, finalCirclePhaseThreshold - 1);
  const splitRisks = [];

  for (const team of sourceTeams) {
    if (!team || team.activePlayerCount < 2 || team.spread < splitThreshold) {
      continue;
    }

    let severity = "low";
    if (team.spread >= highThreshold) {
      severity = "high";
    } else if (team.spread >= mediumThreshold) {
      severity = "medium";
    }

    let nearestHotZoneId = null;
    let nearestHotZoneDistance = Number.POSITIVE_INFINITY;

    for (const hotZone of sourceHotZones) {
      const distanceToHotZone = Math.max(
        0,
        distanceBetween(
          team.centroidX,
          team.centroidY,
          hotZone.centerX,
          hotZone.centerY,
        ) - hotZone.radius,
      );

      if (distanceToHotZone < nearestHotZoneDistance) {
        nearestHotZoneDistance = distanceToHotZone;
        nearestHotZoneId = hotZone.id;
      }
    }

    const distanceToZoneEdge = computeDistanceToZoneEdge(
      team.centroidX,
      team.centroidY,
      zone,
    );
    const isNearHotZone =
      Number.isFinite(nearestHotZoneDistance) &&
      nearestHotZoneDistance <= (config?.PROXIMITY_RADIUS ?? 0) * 0.45;
    const isZoneEdgeDanger =
      distanceToZoneEdge !== null &&
      distanceToZoneEdge <= (config?.ZONE_EDGE_BAND ?? 0);
    const inDangerContext = Boolean(isLateGame || isNearHotZone || isZoneEdgeDanger);

    splitRisks.push({
      teamId: team.teamId,
      spreadRadius: team.spread,
      severity,
      centerX: team.centroidX,
      centerY: team.centroidY,
      updatedAt,
      activePlayerCount: team.activePlayerCount,
      nearestHotZoneId,
      nearestHotZoneDistance: Number.isFinite(nearestHotZoneDistance)
        ? nearestHotZoneDistance
        : null,
      distanceToZoneEdge,
      isLateGame,
      isNearHotZone,
      isZoneEdgeDanger,
      inDangerContext,
    });
  }

  splitRisks.sort((left, right) => right.spreadRadius - left.spreadRadius);
  return splitRisks;
}

module.exports = {
  detectTeamSplitRisks,
};
