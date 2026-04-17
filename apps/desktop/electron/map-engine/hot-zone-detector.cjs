"use strict";

const {
  computeTeamPairDistance,
  distanceBetween,
} = require("./team-proximity-utils.cjs");

function getCurrentCircle(zone) {
  if (!zone || typeof zone !== "object") {
    return null;
  }

  const current = zone.currentCircle || zone;
  const centerX = Number(current?.centerX ?? current?.x);
  const centerY = Number(current?.centerY ?? current?.y);
  const radius = Number(current?.radius);

  if (!Number.isFinite(centerX) || !Number.isFinite(centerY) || !Number.isFinite(radius)) {
    return null;
  }

  return {
    centerX,
    centerY,
    radius,
  };
}

function computeDistanceToZoneEdge(centerX, centerY, zone) {
  const circle = getCurrentCircle(zone);
  if (!circle) {
    return null;
  }

  const distanceToCenter = distanceBetween(centerX, centerY, circle.centerX, circle.centerY);
  return Math.abs(circle.radius - distanceToCenter);
}

function detectHotZones({
  teamSummaries,
  combatEvents,
  zone,
  config,
  updatedAt,
} = {}) {
  const sourceTeams = Array.isArray(teamSummaries) ? teamSummaries : [];
  if (sourceTeams.length < 2) {
    return [];
  }

  const hotZoneRadius = config?.HOT_ZONE_TEAM_RADIUS ?? 0;
  const adjacency = new Map();

  for (const team of sourceTeams) {
    adjacency.set(team.teamId, []);
  }

  for (let leftIndex = 0; leftIndex < sourceTeams.length; leftIndex += 1) {
    const left = sourceTeams[leftIndex];
    for (let rightIndex = leftIndex + 1; rightIndex < sourceTeams.length; rightIndex += 1) {
      const right = sourceTeams[rightIndex];
      const distance = computeTeamPairDistance(left, right);
      if (distance === null || distance > hotZoneRadius) {
        continue;
      }

      adjacency.get(left.teamId).push(right.teamId);
      adjacency.get(right.teamId).push(left.teamId);
    }
  }

  const teamsById = new Map(sourceTeams.map((team) => [team.teamId, team]));
  const visited = new Set();
  const hotZones = [];
  const recentEvents = Array.isArray(combatEvents) ? combatEvents : [];

  for (const team of sourceTeams) {
    if (visited.has(team.teamId) || adjacency.get(team.teamId).length === 0) {
      continue;
    }

    const queue = [team.teamId];
    const involvedTeamIds = [];
    visited.add(team.teamId);

    for (let index = 0; index < queue.length; index += 1) {
      const currentTeamId = queue[index];
      involvedTeamIds.push(currentTeamId);
      for (const linkedTeamId of adjacency.get(currentTeamId)) {
        if (visited.has(linkedTeamId)) {
          continue;
        }
        visited.add(linkedTeamId);
        queue.push(linkedTeamId);
      }
    }

    if (involvedTeamIds.length < 2) {
      continue;
    }

    const involvedTeams = involvedTeamIds
      .map((teamId) => teamsById.get(teamId))
      .filter(Boolean);

    let playerCount = 0;
    let knockedCount = 0;
    let weight = 0;
    let centerX = 0;
    let centerY = 0;
    let minPairDistance = Number.POSITIVE_INFINITY;

    for (let outerIndex = 0; outerIndex < involvedTeams.length; outerIndex += 1) {
      const currentTeam = involvedTeams[outerIndex];
      const teamWeight = Math.max(1, currentTeam.activePlayerCount);
      playerCount += currentTeam.activePlayerCount;
      knockedCount += currentTeam.knockedCount;
      centerX += currentTeam.centroidX * teamWeight;
      centerY += currentTeam.centroidY * teamWeight;
      weight += teamWeight;

      for (let innerIndex = outerIndex + 1; innerIndex < involvedTeams.length; innerIndex += 1) {
        const pairDistance = computeTeamPairDistance(
          currentTeam,
          involvedTeams[innerIndex],
        );
        if (pairDistance !== null) {
          minPairDistance = Math.min(minPairDistance, pairDistance);
        }
      }
    }

    centerX /= Math.max(1, weight);
    centerY /= Math.max(1, weight);

    let radius = hotZoneRadius * 0.42;
    for (const currentTeam of involvedTeams) {
      const members =
        Array.isArray(currentTeam.coreMembers) && currentTeam.coreMembers.length > 0
          ? currentTeam.coreMembers
          : currentTeam.members;
      for (const member of members) {
        radius = Math.max(
          radius,
          distanceBetween(centerX, centerY, member.x, member.y),
        );
      }
    }
    radius += config?.HOT_ZONE_RADIUS_PADDING ?? 0;

    let recentKillCount = 0;
    let recentCombatCount = 0;
    for (const event of recentEvents) {
      if (!event || distanceBetween(centerX, centerY, event.x, event.y) > radius) {
        continue;
      }
      recentCombatCount += 1;
      if (event.kind !== "knock") {
        recentKillCount += 1;
      }
    }

    const distanceToZoneEdge = computeDistanceToZoneEdge(centerX, centerY, zone);
    const zoneEdgeBoost =
      distanceToZoneEdge !== null && distanceToZoneEdge <= (config?.ZONE_EDGE_BAND ?? 0)
        ? 12
        : 0;

    let score =
      involvedTeams.length * 34 +
      playerCount * 7 +
      recentCombatCount * 18 +
      knockedCount * 10 +
      zoneEdgeBoost;

    if (involvedTeams.length >= 3) {
      score += 24 + (involvedTeams.length - 3) * 8;
    }

    if (Number.isFinite(minPairDistance)) {
      if (minPairDistance <= (config?.PROXIMITY_HIGH_DISTANCE ?? 0)) {
        score += 14;
      } else if (minPairDistance <= (config?.PROXIMITY_MEDIUM_DISTANCE ?? 0)) {
        score += 7;
      }
    }

    hotZones.push({
      id: `hot:${involvedTeamIds.slice().sort().join("|")}`,
      centerX,
      centerY,
      radius,
      involvedTeamIds: involvedTeamIds.slice().sort(),
      score,
      recentKillCount,
      recentCombatCount,
      currentKnockedCount: knockedCount,
      distanceToZoneEdge,
      updatedAt,
    });
  }

  hotZones.sort((left, right) => right.score - left.score);
  return hotZones;
}

module.exports = {
  computeDistanceToZoneEdge,
  detectHotZones,
};
