"use strict";

const { distanceBetween } = require("./team-proximity-utils.cjs");

const DEFAULT_TEAM_NAME = "Arenzyra";

function parseTeamNumber(teamId) {
  const normalized = String(teamId || "").trim();
  if (!normalized) {
    return null;
  }

  if (/^\d{1,3}$/.test(normalized)) {
    return Number(normalized);
  }

  const match = normalized.match(/(?:team|t|slot|seed)[-_ ]?(\d{1,3})$/i);
  return match ? Number(match[1]) : null;
}

function formatTeamLabel(teamId) {
  const numeric = parseTeamNumber(teamId);
  if (numeric !== null) {
    return DEFAULT_TEAM_NAME;
  }

  const normalized = String(teamId || "").trim();
  return normalized ? `${DEFAULT_TEAM_NAME} ${normalized}` : DEFAULT_TEAM_NAME;
}

function formatMatchup(teamIds) {
  const source = Array.isArray(teamIds) ? teamIds.filter(Boolean) : [];
  if (source.length <= 1) {
    return source.length === 1 ? formatTeamLabel(source[0]) : DEFAULT_TEAM_NAME;
  }

  if (source.length === 2) {
    return `${formatTeamLabel(source[0])} vs ${formatTeamLabel(source[1])}`;
  }

  return `${source.length}-team cluster`;
}

function describeDirection(centerX, centerY, referenceX, referenceY) {
  const angle = Math.atan2(centerY - referenceY, centerX - referenceX);
  const octants = [
    "east",
    "north-east",
    "north",
    "north-west",
    "west",
    "south-west",
    "south",
    "south-east",
  ];
  const index = Math.round(((angle + Math.PI) / (Math.PI * 2)) * 8) % 8;
  return octants[(index + 4) % 8];
}

function describeLocation(centerX, centerY, zone, config) {
  const circle =
    zone?.currentCircle && Number.isFinite(zone.currentCircle.centerX)
      ? zone.currentCircle
      : zone &&
          Number.isFinite(zone.centerX) &&
          Number.isFinite(zone.centerY) &&
          Number.isFinite(zone.radius)
        ? zone
        : null;

  if (!circle) {
    return "recently active";
  }

  const distanceToCenter = distanceBetween(
    centerX,
    centerY,
    circle.centerX,
    circle.centerY,
  );
  const distanceToEdge = Math.abs(circle.radius - distanceToCenter);

  if (distanceToCenter <= circle.radius * 0.28) {
    return "central zone";
  }

  const direction = describeDirection(
    centerX,
    centerY,
    circle.centerX,
    circle.centerY,
  );

  if (distanceToEdge <= (config?.ZONE_EDGE_BAND ?? 0)) {
    return `${direction} zone edge`;
  }

  return `${direction} zone`;
}

function clusterCombatEvents(events, config) {
  const clusters = [];
  const radius = config?.COMBAT_CLUSTER_RADIUS ?? 0;
  const source = Array.isArray(events) ? events.slice() : [];
  source.sort((left, right) => right.timestamp - left.timestamp);

  for (const event of source) {
    let matchedCluster = null;

    for (const cluster of clusters) {
      if (distanceBetween(event.x, event.y, cluster.centerX, cluster.centerY) <= radius) {
        matchedCluster = cluster;
        break;
      }
    }

    if (!matchedCluster) {
      matchedCluster = {
        centerX: event.x,
        centerY: event.y,
        count: 0,
        killCount: 0,
        latestAt: event.timestamp,
        involvedTeamIds: new Set(),
      };
      clusters.push(matchedCluster);
    }

    matchedCluster.centerX =
      (matchedCluster.centerX * matchedCluster.count + event.x) /
      (matchedCluster.count + 1);
    matchedCluster.centerY =
      (matchedCluster.centerY * matchedCluster.count + event.y) /
      (matchedCluster.count + 1);
    matchedCluster.count += 1;
    if (event.kind !== "knock") {
      matchedCluster.killCount += 1;
    }
    matchedCluster.latestAt = Math.max(matchedCluster.latestAt, event.timestamp);
    if (event.killerTeamId) {
      matchedCluster.involvedTeamIds.add(event.killerTeamId);
    }
    if (event.victimTeamId) {
      matchedCluster.involvedTeamIds.add(event.victimTeamId);
    }
  }

  return clusters.map((cluster) => ({
    centerX: cluster.centerX,
    centerY: cluster.centerY,
    count: cluster.count,
    killCount: cluster.killCount,
    latestAt: cluster.latestAt,
    involvedTeamIds: Array.from(cluster.involvedTeamIds).sort(),
  }));
}

function buildCandidateId(category, primaryKey) {
  return `${category}:${primaryKey}`;
}

function generateFocusCandidates({
  hotZones,
  combatEvents,
  zone,
  config,
  updatedAt,
} = {}) {
  const candidates = [];
  const sourceHotZones = Array.isArray(hotZones) ? hotZones : [];
  const recentCombatClusters = clusterCombatEvents(combatEvents, config);

  for (const hotZone of sourceHotZones) {
    const locationLabel = describeLocation(hotZone.centerX, hotZone.centerY, zone, config);
    const teamCount = hotZone.involvedTeamIds.length;
    const isActiveFight =
      hotZone.recentCombatCount > 0 || hotZone.currentKnockedCount > 0;
    const nearZoneEdge =
      hotZone.distanceToZoneEdge !== null &&
      hotZone.distanceToZoneEdge <= (config?.ZONE_EDGE_BAND ?? 0);

    let category = "fight";
    let label = `High fight potential: ${formatMatchup(hotZone.involvedTeamIds)}`;
    let score = hotZone.score + (isActiveFight ? 18 : 6);

    if (teamCount >= 3) {
      category = nearZoneEdge ? "zone-edge" : "cluster";
      label = nearZoneEdge
        ? `${teamCount}-team cluster near ${locationLabel}`
        : `${teamCount}-team cluster in ${locationLabel}`;
      score += 12;
    } else if (isActiveFight) {
      label = `Active fight: ${formatMatchup(hotZone.involvedTeamIds)}`;
      score += 10;
    } else if (nearZoneEdge) {
      category = "zone-edge";
      label = `${formatMatchup(hotZone.involvedTeamIds)} near ${locationLabel}`;
      score += 8;
    }

    candidates.push({
      id: buildCandidateId(category, hotZone.id),
      label,
      centerX: hotZone.centerX,
      centerY: hotZone.centerY,
      score,
      category,
      involvedTeamIds: [...hotZone.involvedTeamIds],
      updatedAt,
    });
  }

  for (const cluster of recentCombatClusters) {
    const coveredByHotZone = sourceHotZones.some(
      (hotZone) =>
        distanceBetween(cluster.centerX, cluster.centerY, hotZone.centerX, hotZone.centerY) <=
        Math.max(hotZone.radius, (config?.COMBAT_CLUSTER_RADIUS ?? 0) * 0.85),
    );

    if (coveredByHotZone && cluster.count < 2) {
      continue;
    }

    const locationLabel = describeLocation(cluster.centerX, cluster.centerY, zone, config);
    const recencyBoost = Math.max(
      0,
      18 - Math.round((updatedAt - cluster.latestAt) / 2_500),
    );
    const label =
      cluster.killCount >= 2
        ? `Recent double kill near ${locationLabel}`
        : `Recent combat near ${locationLabel}`;

    candidates.push({
      id: buildCandidateId(
        "recent-combat",
        `${Math.round(cluster.centerX)}:${Math.round(cluster.centerY)}:${cluster.latestAt}`,
      ),
      label,
      centerX: cluster.centerX,
      centerY: cluster.centerY,
      score: cluster.count * 24 + cluster.killCount * 10 + recencyBoost,
      category: "recent-combat",
      involvedTeamIds: [...cluster.involvedTeamIds],
      updatedAt,
    });
  }

  candidates.sort((left, right) => right.score - left.score);

  const deduped = [];
  const seen = new Set();
  for (const candidate of candidates) {
    const signature = `${candidate.category}:${candidate.involvedTeamIds.join("|")}:${Math.round(
      candidate.centerX / 1000,
    )}:${Math.round(candidate.centerY / 1000)}`;
    if (seen.has(signature)) {
      continue;
    }
    seen.add(signature);
    deduped.push(candidate);
    if (deduped.length >= (config?.MAX_FOCUS_CANDIDATES ?? 5)) {
      break;
    }
  }

  return deduped;
}

module.exports = {
  formatTeamLabel,
  generateFocusCandidates,
};
