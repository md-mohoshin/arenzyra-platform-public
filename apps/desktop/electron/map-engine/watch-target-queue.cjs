"use strict";

const { distanceBetween } = require("./team-proximity-utils.cjs");

const DEFAULT_TEAM_NAME = "Arenzyra";

function compareTeamIds(left, right) {
  return String(left || "").localeCompare(String(right || ""), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function uniqueList(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function buildTeamSetKey(teamIds) {
  return uniqueList(Array.isArray(teamIds) ? teamIds : [])
    .sort(compareTeamIds)
    .join("|");
}

function formatTeamLabel(teamId) {
  const normalized = String(teamId || "").trim();
  if (!normalized) {
    return DEFAULT_TEAM_NAME;
  }

  if (/^\d{1,3}$/.test(normalized)) {
    return DEFAULT_TEAM_NAME;
  }

  const match = normalized.match(/(?:team|t|slot|seed)[-_ ]?(\d{1,3})$/i);
  if (match) {
    return DEFAULT_TEAM_NAME;
  }

  return `${DEFAULT_TEAM_NAME} ${normalized}`;
}

function formatMatchup(teamIds) {
  const source = uniqueList(Array.isArray(teamIds) ? teamIds : []).sort(compareTeamIds);
  if (source.length === 0) {
    return DEFAULT_TEAM_NAME;
  }
  if (source.length === 1) {
    return formatTeamLabel(source[0]);
  }
  if (source.length === 2) {
    return `${formatTeamLabel(source[0])} vs ${formatTeamLabel(source[1])}`;
  }

  return `${source.length}-team cluster`;
}

function toWatchTarget(candidate, context = {}, updatedAt) {
  const reason = [];
  const hotZone = context.hotZone || null;

  if (hotZone) {
    reason.push(`${hotZone.involvedTeamIds.length} teams nearby`);
    if (hotZone.recentCombatCount > 0) {
      reason.push(`${hotZone.recentCombatCount} recent combat points`);
    }
    if (hotZone.currentKnockedCount > 0) {
      reason.push(`${hotZone.currentKnockedCount} knocked in area`);
    }
    if (
      hotZone.distanceToZoneEdge !== null &&
      hotZone.distanceToZoneEdge <= (context.config?.ZONE_EDGE_BAND ?? 0)
    ) {
      reason.push("near zone edge");
    }
  }

  if (context.nearestSplitRisk?.severity) {
    reason.push(`team split risk ${context.nearestSplitRisk.severity}`);
  }

  if (candidate.category === "recent-combat") {
    reason.push("recent combat memory");
  } else if (candidate.category === "cluster") {
    reason.push("multi-team cluster");
  } else if (candidate.category === "zone-edge") {
    reason.push("edge pressure");
  } else {
    reason.push("fight potential");
  }

  const score = Number.isFinite(candidate.score) ? candidate.score : 0;
  const priority =
    score +
    (hotZone ? hotZone.recentCombatCount * 8 + hotZone.currentKnockedCount * 14 : 0) +
    (candidate.category === "recent-combat" ? 10 : 0) +
    (candidate.category === "cluster" ? 14 : 0) +
    (candidate.category === "zone-edge" ? 8 : 0);

  return {
    id: String(candidate.id || "").trim(),
    label: String(candidate.label || "").trim() || formatMatchup(candidate.involvedTeamIds),
    score,
    centerX: candidate.centerX,
    centerY: candidate.centerY,
    category: candidate.category || "fight",
    involvedTeamIds: uniqueList(candidate.involvedTeamIds || []).sort(compareTeamIds),
    reason: uniqueList(reason),
    updatedAt,
    priority,
    radius: hotZone?.radius ?? null,
    teamSetKey: buildTeamSetKey(candidate.involvedTeamIds),
  };
}

function shouldMergeTargets(left, right, config) {
  const distance = distanceBetween(left.centerX, left.centerY, right.centerX, right.centerY);
  const dedupeRadius = Math.max(
    config?.WATCH_TARGET_DEDUPE_RADIUS ?? 0,
    Math.max(left.radius || 0, right.radius || 0) * 0.65,
  );

  if (distance > dedupeRadius) {
    return false;
  }

  if (!left.teamSetKey || !right.teamSetKey) {
    return true;
  }

  if (left.teamSetKey === right.teamSetKey) {
    return true;
  }

  const leftSet = new Set(left.involvedTeamIds);
  const rightSet = new Set(right.involvedTeamIds);
  let overlap = 0;

  for (const teamId of leftSet) {
    if (rightSet.has(teamId)) {
      overlap += 1;
    }
  }

  const overlapRatio = overlap / Math.max(1, Math.min(leftSet.size, rightSet.size));
  return overlapRatio >= 0.5;
}

function mergeTargets(base, candidate) {
  const leftWeight = Math.max(1, base.priority);
  const rightWeight = Math.max(1, candidate.priority);
  const keepCandidateLabel = candidate.priority > base.priority;
  const next = {
    ...base,
    id: keepCandidateLabel ? candidate.id : base.id,
    label: keepCandidateLabel ? candidate.label : base.label,
    score: Math.max(base.score, candidate.score),
    centerX: (base.centerX * leftWeight + candidate.centerX * rightWeight) / (leftWeight + rightWeight),
    centerY: (base.centerY * leftWeight + candidate.centerY * rightWeight) / (leftWeight + rightWeight),
    category:
      base.category === "pinned" || candidate.category === "pinned"
        ? "pinned"
        : keepCandidateLabel
          ? candidate.category
          : base.category,
    involvedTeamIds: uniqueList([...base.involvedTeamIds, ...candidate.involvedTeamIds]).sort(compareTeamIds),
    reason: uniqueList([...base.reason, ...candidate.reason]),
    updatedAt: Math.max(base.updatedAt, candidate.updatedAt),
    priority: Math.max(base.priority, candidate.priority),
    radius: Math.max(base.radius || 0, candidate.radius || 0) || null,
  };
  next.teamSetKey = buildTeamSetKey(next.involvedTeamIds);
  return next;
}

function createPinnedTeamTarget(teamSummary, config, updatedAt) {
  if (!teamSummary) {
    return null;
  }

  const priorityBoost = config?.PINNED_PRIORITY_BOOST ?? 0;
  return {
    id: `pinned-team:${teamSummary.teamId}`,
    label: `Pinned: ${formatTeamLabel(teamSummary.teamId)}`,
    score: teamSummary.activePlayerCount * 12,
    centerX: teamSummary.centroidX,
    centerY: teamSummary.centroidY,
    category: "pinned",
    involvedTeamIds: [teamSummary.teamId],
    reason: uniqueList(["Pinned by operator"]),
    updatedAt,
    priority: priorityBoost + teamSummary.activePlayerCount * 12,
    radius: teamSummary.spread || null,
    teamSetKey: buildTeamSetKey([teamSummary.teamId]),
  };
}

function buildWatchTargetQueue({
  focusCandidates,
  hotZones,
  teamProximities,
  teamSummaries,
  teamSplitRisks,
  pinState,
  mapKey,
  config,
  updatedAt,
} = {}) {
  const sourceCandidates = Array.isArray(focusCandidates) ? focusCandidates : [];
  const sourceHotZones = Array.isArray(hotZones) ? hotZones : [];
  const sourceSplits = Array.isArray(teamSplitRisks) ? teamSplitRisks : [];
  const pinInfo = pinState && typeof pinState === "object" ? pinState : {};
  const targets = [];

  for (const candidate of sourceCandidates) {
    const relatedHotZone = sourceHotZones.find((hotZone) => {
      if (candidate.id === hotZone.id) {
        return true;
      }

      const hotZoneTeams = buildTeamSetKey(hotZone.involvedTeamIds);
      const candidateTeams = buildTeamSetKey(candidate.involvedTeamIds);
      return (
        (candidateTeams && hotZoneTeams && candidateTeams === hotZoneTeams) ||
        distanceBetween(
          candidate.centerX,
          candidate.centerY,
          hotZone.centerX,
          hotZone.centerY,
        ) <= Math.max(config?.WATCH_TARGET_DEDUPE_RADIUS ?? 0, hotZone.radius * 0.7)
      );
    }) || null;

    const nearestSplitRisk = sourceSplits.find(
      (splitRisk) =>
        candidate.involvedTeamIds.includes(splitRisk.teamId) &&
        distanceBetween(
          candidate.centerX,
          candidate.centerY,
          splitRisk.centerX,
          splitRisk.centerY,
        ) <= (config?.PROXIMITY_RADIUS ?? 0),
    ) || null;

    const target = toWatchTarget(
      candidate,
      {
        hotZone: relatedHotZone,
        nearestSplitRisk,
        teamProximities,
        config,
      },
      updatedAt,
    );

    if (target.id) {
      targets.push(target);
    }
  }

  targets.sort((left, right) => right.priority - left.priority || right.score - left.score);

  const mergedTargets = [];
  for (const target of targets) {
    const existingIndex = mergedTargets.findIndex((existingTarget) =>
      shouldMergeTargets(existingTarget, target, config),
    );

    if (existingIndex === -1) {
      mergedTargets.push(target);
      continue;
    }

    mergedTargets[existingIndex] = mergeTargets(mergedTargets[existingIndex], target);
  }

  const teamSummaryById = new Map(
    (Array.isArray(teamSummaries) ? teamSummaries : []).map((teamSummary) => [
      teamSummary.teamId,
      teamSummary,
    ]),
  );
  const coveredPinnedTeams = new Set();
  const pinnedTargetIds = new Set(Array.isArray(pinInfo.pinnedTargetIds) ? pinInfo.pinnedTargetIds : []);

  for (let index = 0; index < mergedTargets.length; index += 1) {
    const target = mergedTargets[index];
    const pinnedTeamsInTarget = (pinInfo.pinnedTeams || []).filter((teamId) =>
      target.involvedTeamIds.includes(teamId),
    );
    const isPinned = pinnedTargetIds.has(target.id) || pinnedTeamsInTarget.length > 0;
    if (!isPinned) {
      continue;
    }

    mergedTargets[index] = {
      ...target,
      category: "pinned",
      label: target.label.startsWith("Pinned:") ? target.label : `Pinned: ${target.label}`,
      reason: uniqueList([
        "Pinned by operator",
        ...pinnedTeamsInTarget.map((teamId) => `${formatTeamLabel(teamId)} pinned`),
        ...target.reason,
      ]),
      priority: target.priority + (config?.PINNED_PRIORITY_BOOST ?? 0),
      updatedAt,
    };

    for (const teamId of pinnedTeamsInTarget) {
      coveredPinnedTeams.add(teamId);
    }
  }

  for (const teamId of pinInfo.pinnedTeams || []) {
    if (coveredPinnedTeams.has(teamId)) {
      continue;
    }

    const syntheticTarget = createPinnedTeamTarget(
      teamSummaryById.get(teamId),
      config,
      updatedAt,
    );
    if (syntheticTarget) {
      mergedTargets.push(syntheticTarget);
    }
  }

  for (const pinnedTarget of pinInfo.pinnedTargets || []) {
    if (
      pinnedTarget.mapKey &&
      mapKey &&
      pinnedTarget.mapKey !== mapKey
    ) {
      continue;
    }

    if (mergedTargets.some((target) => target.id === pinnedTarget.id)) {
      continue;
    }

    mergedTargets.push({
      ...pinnedTarget,
      category: "pinned",
      label: pinnedTarget.label.startsWith("Pinned:")
        ? pinnedTarget.label
        : `Pinned: ${pinnedTarget.label}`,
      reason: uniqueList(["Pinned by operator", ...pinnedTarget.reason]),
      priority:
        (Number.isFinite(pinnedTarget.priority) ? pinnedTarget.priority : 0) +
        (config?.PINNED_PRIORITY_BOOST ?? 0),
      updatedAt,
      teamSetKey: buildTeamSetKey(pinnedTarget.involvedTeamIds),
    });
  }

  mergedTargets.sort((left, right) => right.priority - left.priority || right.score - left.score);

  return mergedTargets
    .slice(0, config?.MAX_WATCH_TARGETS ?? 6)
    .map((target) => ({
      id: target.id,
      label: target.label,
      score: target.score,
      centerX: target.centerX,
      centerY: target.centerY,
      category: target.category,
      involvedTeamIds: [...target.involvedTeamIds],
      reason: [...target.reason],
      updatedAt: target.updatedAt,
      priority: target.priority,
    }));
}

module.exports = {
  buildWatchTargetQueue,
  formatMatchup,
  formatTeamLabel,
};
