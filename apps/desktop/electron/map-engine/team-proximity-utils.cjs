"use strict";

function toFiniteNumber(value) {
  const numeric =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(numeric) ? numeric : null;
}

function distanceBetween(leftX, leftY, rightX, rightY) {
  return Math.hypot(leftX - rightX, leftY - rightY);
}

function isActivePlayer(player) {
  if (!player || typeof player !== "object") {
    return false;
  }

  if (typeof player.teamId !== "string" || !player.teamId.trim()) {
    return false;
  }

  return player.alive !== false || player.knocked === true;
}

function computeCentroid(members) {
  if (!Array.isArray(members) || members.length === 0) {
    return null;
  }

  let sumX = 0;
  let sumY = 0;
  for (const member of members) {
    sumX += member.x;
    sumY += member.y;
  }

  return {
    x: sumX / members.length,
    y: sumY / members.length,
  };
}

function selectCoreMembers(members, centroid, stragglerRadius) {
  if (!Array.isArray(members) || members.length <= 2 || !centroid) {
    return members;
  }

  const scored = members
    .map((member) => ({
      member,
      distance: distanceBetween(member.x, member.y, centroid.x, centroid.y),
    }))
    .sort((left, right) => left.distance - right.distance);

  const core = scored
    .filter((entry) => entry.distance <= stragglerRadius)
    .map((entry) => entry.member);

  if (core.length >= 2) {
    return core;
  }

  return scored.slice(0, Math.min(3, scored.length)).map((entry) => entry.member);
}

function computeSpread(members, centroid) {
  if (!Array.isArray(members) || members.length === 0 || !centroid) {
    return 0;
  }

  let spread = 0;
  for (const member of members) {
    spread = Math.max(spread, distanceBetween(member.x, member.y, centroid.x, centroid.y));
  }
  return spread;
}

function summarizeTeams(players, config) {
  const buckets = new Map();
  const source = Array.isArray(players) ? players : [];

  for (const player of source) {
    if (!isActivePlayer(player)) {
      continue;
    }

    const x = toFiniteNumber(player.x);
    const y = toFiniteNumber(player.y);
    if (x === null || y === null) {
      continue;
    }

    const teamId = player.teamId.trim();
    let members = buckets.get(teamId);
    if (!members) {
      members = [];
      buckets.set(teamId, members);
    }

    members.push({
      playerId:
        typeof player.playerId === "string" && player.playerId.trim()
          ? player.playerId.trim()
          : null,
      x,
      y,
      knocked: player.knocked === true,
    });
  }

  const summaries = [];
  for (const [teamId, members] of buckets.entries()) {
    const initialCentroid = computeCentroid(members);
    const coreMembers = selectCoreMembers(
      members,
      initialCentroid,
      config?.TEAM_STRAGGLER_RADIUS ?? 0,
    );
    const centroid = computeCentroid(coreMembers) || initialCentroid;

    summaries.push({
      teamId,
      activePlayerCount: members.length,
      knockedCount: members.reduce(
        (count, member) => count + (member.knocked === true ? 1 : 0),
        0,
      ),
      centroidX: centroid?.x ?? 0,
      centroidY: centroid?.y ?? 0,
      spread: computeSpread(coreMembers, centroid),
      members,
      coreMembers,
    });
  }

  summaries.sort((left, right) => left.teamId.localeCompare(right.teamId, undefined, {
    numeric: true,
    sensitivity: "base",
  }));

  return summaries;
}

function computeTeamPairDistance(left, right) {
  const leftMembers = Array.isArray(left?.coreMembers) && left.coreMembers.length > 0 ? left.coreMembers : left?.members;
  const rightMembers =
    Array.isArray(right?.coreMembers) && right.coreMembers.length > 0 ? right.coreMembers : right?.members;

  if (!Array.isArray(leftMembers) || !Array.isArray(rightMembers)) {
    return null;
  }

  let minimum = Number.POSITIVE_INFINITY;
  for (const leftMember of leftMembers) {
    for (const rightMember of rightMembers) {
      minimum = Math.min(
        minimum,
        distanceBetween(leftMember.x, leftMember.y, rightMember.x, rightMember.y),
      );
    }
  }

  return Number.isFinite(minimum) ? minimum : null;
}

function detectTeamProximities(teamSummaries, config, updatedAt) {
  const proximities = [];
  const source = Array.isArray(teamSummaries) ? teamSummaries : [];
  const proximityRadius = config?.PROXIMITY_RADIUS ?? 0;
  const highDistance = config?.PROXIMITY_HIGH_DISTANCE ?? proximityRadius * 0.55;
  const mediumDistance = config?.PROXIMITY_MEDIUM_DISTANCE ?? proximityRadius * 0.82;

  for (let leftIndex = 0; leftIndex < source.length; leftIndex += 1) {
    const left = source[leftIndex];
    for (let rightIndex = leftIndex + 1; rightIndex < source.length; rightIndex += 1) {
      const right = source[rightIndex];
      const distance = computeTeamPairDistance(left, right);
      if (distance === null || distance > proximityRadius) {
        continue;
      }

      let severity = "low";
      if (
        distance <= highDistance ||
        left.knockedCount > 0 ||
        right.knockedCount > 0
      ) {
        severity = "high";
      } else if (distance <= mediumDistance) {
        severity = "medium";
      }

      proximities.push({
        teamA: left.teamId,
        teamB: right.teamId,
        distance,
        centerX: (left.centroidX + right.centroidX) / 2,
        centerY: (left.centroidY + right.centroidY) / 2,
        severity,
        updatedAt,
        teamACenterX: left.centroidX,
        teamACenterY: left.centroidY,
        teamBCenterX: right.centroidX,
        teamBCenterY: right.centroidY,
      });
    }
  }

  proximities.sort((left, right) => left.distance - right.distance);
  return proximities;
}

module.exports = {
  computeTeamPairDistance,
  detectTeamProximities,
  distanceBetween,
  summarizeTeams,
};
