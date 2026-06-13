"use strict";

const { distanceBetween } = require("./team-proximity-utils.cjs");
const { formatTeamLabel } = require("./watch-target-queue.cjs");

function normalizeTeamIds(values) {
  return Array.from(new Set((Array.isArray(values) ? values : []).filter(Boolean))).sort(
    (left, right) =>
      String(left).localeCompare(String(right), undefined, {
        numeric: true,
        sensitivity: "base",
      }),
  );
}

function buildTeamSetKey(teamIds) {
  return normalizeTeamIds(teamIds).join("|");
}

function countOverlap(left, right) {
  const rightSet = new Set(normalizeTeamIds(right));
  let overlap = 0;

  for (const teamId of normalizeTeamIds(left)) {
    if (rightSet.has(teamId)) {
      overlap += 1;
    }
  }

  return overlap;
}

function getSeverityWeight(severity) {
  if (severity === "high") {
    return 3;
  }
  if (severity === "medium") {
    return 2;
  }
  return 1;
}

function findBestWatchTarget(watchTargets, teamIds, centerX, centerY) {
  const sourceTargets = Array.isArray(watchTargets) ? watchTargets : [];
  const requestedTeamSetKey = buildTeamSetKey(teamIds);
  let best = null;

  for (const target of sourceTargets) {
    const targetTeamIds = normalizeTeamIds(target?.involvedTeamIds);
    if (targetTeamIds.length < 2) {
      continue;
    }

    const overlap = countOverlap(targetTeamIds, teamIds);
    if (overlap < 2) {
      continue;
    }

    const candidate = {
      target,
      exactTeamMatch: buildTeamSetKey(targetTeamIds) === requestedTeamSetKey,
      overlap,
      distance:
        Number.isFinite(target?.centerX) && Number.isFinite(target?.centerY)
          ? distanceBetween(target.centerX, target.centerY, centerX, centerY)
          : Number.POSITIVE_INFINITY,
    };

    if (!best) {
      best = candidate;
      continue;
    }

    if (candidate.exactTeamMatch !== best.exactTeamMatch) {
      if (candidate.exactTeamMatch) {
        best = candidate;
      }
      continue;
    }

    if (candidate.overlap !== best.overlap) {
      if (candidate.overlap > best.overlap) {
        best = candidate;
      }
      continue;
    }

    const candidatePriority = Number.isFinite(candidate.target?.priority)
      ? candidate.target.priority
      : Number.isFinite(candidate.target?.score)
        ? candidate.target.score
        : 0;
    const bestPriority = Number.isFinite(best.target?.priority)
      ? best.target.priority
      : Number.isFinite(best.target?.score)
        ? best.target.score
        : 0;
    if (candidatePriority !== bestPriority) {
      if (candidatePriority > bestPriority) {
        best = candidate;
      }
      continue;
    }

    if (candidate.distance < best.distance) {
      best = candidate;
    }
  }

  return best?.target ?? null;
}

function selectFightAlertCandidate({
  watchTargets,
  assistSnapshot,
  teamSummaries,
  config,
  updatedAt,
  teamLabelResolver,
} = {}) {
  const hotZones = Array.isArray(assistSnapshot?.hotZones) ? assistSnapshot.hotZones : [];
  const teamProximities = Array.isArray(assistSnapshot?.teamProximities)
    ? assistSnapshot.teamProximities
    : [];
  const sourceTargets = Array.isArray(watchTargets) ? watchTargets : [];
  const sourceTeamSummaries = Array.isArray(teamSummaries) ? teamSummaries : [];
  const proximityRadius = Number.isFinite(config?.PROXIMITY_RADIUS) ? config.PROXIMITY_RADIUS : 0;
  const combatThreshold = Number.isFinite(config?.HIGH_RISK_FIGHT_SCORE)
    ? config.HIGH_RISK_FIGHT_SCORE
    : 150;

  if (!hotZones.length || !teamProximities.length || !sourceTeamSummaries.length) {
    return null;
  }

  const teamSummaryById = new Map(
    sourceTeamSummaries
      .filter((teamSummary) => teamSummary?.teamId)
      .map((teamSummary) => [teamSummary.teamId, teamSummary]),
  );
  const candidates = [];

  for (const hotZone of hotZones) {
    const involvedTeamIds = normalizeTeamIds(hotZone?.involvedTeamIds);
    const combatScore = Number.isFinite(hotZone?.score) ? hotZone.score : 0;
    const recentCombatCount = Number.isFinite(hotZone?.recentCombatCount)
      ? hotZone.recentCombatCount
      : 0;
    const currentKnockedCount = Number.isFinite(hotZone?.currentKnockedCount)
      ? hotZone.currentKnockedCount
      : 0;
    const activeCombat = recentCombatCount > 0 || currentKnockedCount > 0;

    if (involvedTeamIds.length < 2 || !activeCombat || combatScore <= combatThreshold) {
      continue;
    }

    const relatedProximities = teamProximities.filter(
      (proximity) =>
        involvedTeamIds.includes(proximity?.teamA) &&
        involvedTeamIds.includes(proximity?.teamB) &&
        Number.isFinite(proximity?.distance) &&
        proximity.distance < proximityRadius,
    );

    for (const proximity of relatedProximities) {
      const teamA = teamSummaryById.get(proximity.teamA);
      const teamB = teamSummaryById.get(proximity.teamB);
      const playersAlive =
        (Number.isFinite(teamA?.activePlayerCount) ? teamA.activePlayerCount : 0) +
        (Number.isFinite(teamB?.activePlayerCount) ? teamB.activePlayerCount : 0);

      if (playersAlive < 2) {
        continue;
      }

      const bestWatchTarget =
        findBestWatchTarget(
          sourceTargets,
          [proximity.teamA, proximity.teamB],
          Number.isFinite(proximity?.centerX) ? proximity.centerX : hotZone.centerX,
          Number.isFinite(proximity?.centerY) ? proximity.centerY : hotZone.centerY,
        ) ||
        findBestWatchTarget(sourceTargets, involvedTeamIds, hotZone.centerX, hotZone.centerY);

      const watchTargetPriority = Number.isFinite(bestWatchTarget?.priority)
        ? bestWatchTarget.priority
        : Number.isFinite(bestWatchTarget?.score)
          ? bestWatchTarget.score
          : 0;

      const teamALabel = formatTeamLabel(proximity.teamA, teamLabelResolver);
      const teamBLabel = formatTeamLabel(proximity.teamB, teamLabelResolver);
      candidates.push({
        id: `fight:${hotZone.id}:${[proximity.teamA, proximity.teamB].sort().join("|")}`,
        hotZoneId: hotZone.id,
        watchTargetId: bestWatchTarget?.id ?? null,
        teamIds: normalizeTeamIds([proximity.teamA, proximity.teamB]),
        teamALabel,
        teamBLabel,
        matchup: `${teamALabel} vs ${teamBLabel}`,
        combatScore,
        combatThreshold,
        distance: proximity.distance,
        proximityRadius,
        playersAlive,
        centerX:
          Number.isFinite(proximity?.centerX) && Number.isFinite(proximity?.centerY)
            ? proximity.centerX
            : hotZone.centerX,
        centerY:
          Number.isFinite(proximity?.centerX) && Number.isFinite(proximity?.centerY)
            ? proximity.centerY
            : hotZone.centerY,
        recentCombatCount,
        currentKnockedCount,
        severity: proximity?.severity || "low",
        updatedAt: Number.isFinite(updatedAt) ? updatedAt : Date.now(),
        watchTargetPriority,
      });
    }
  }

  candidates.sort((left, right) => {
    if (right.watchTargetPriority !== left.watchTargetPriority) {
      return right.watchTargetPriority - left.watchTargetPriority;
    }
    if (right.combatScore !== left.combatScore) {
      return right.combatScore - left.combatScore;
    }
    const severityDelta = getSeverityWeight(right.severity) - getSeverityWeight(left.severity);
    if (severityDelta !== 0) {
      return severityDelta;
    }
    if (left.distance !== right.distance) {
      return left.distance - right.distance;
    }
    if (right.playersAlive !== left.playersAlive) {
      return right.playersAlive - left.playersAlive;
    }
    return String(left.id || "").localeCompare(String(right.id || ""), undefined, {
      numeric: true,
      sensitivity: "base",
    });
  });

  if (!candidates.length) {
    return null;
  }

  const best = candidates[0];
  return {
    id: best.id,
    hotZoneId: best.hotZoneId,
    watchTargetId: best.watchTargetId,
    teamIds: [...best.teamIds],
    teamALabel: best.teamALabel,
    teamBLabel: best.teamBLabel,
    matchup: best.matchup,
    combatScore: best.combatScore,
    combatThreshold: best.combatThreshold,
    distance: best.distance,
    proximityRadius: best.proximityRadius,
    playersAlive: best.playersAlive,
    centerX: best.centerX,
    centerY: best.centerY,
    recentCombatCount: best.recentCombatCount,
    currentKnockedCount: best.currentKnockedCount,
    severity: best.severity,
    updatedAt: best.updatedAt,
  };
}

module.exports = {
  selectFightAlertCandidate,
};
