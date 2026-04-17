"use strict";

const { distanceBetween } = require("./team-proximity-utils.cjs");

function toFiniteNumber(value, fallback = null) {
  const numeric =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(numeric) ? numeric : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function clamp01(value) {
  return clamp(value, 0, 1);
}

function lerp(start, end, progress) {
  return start + (end - start) * progress;
}

function compareIds(left, right) {
  return String(left || "").localeCompare(String(right || ""), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function normalizeMapKey(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeTeamIds(values) {
  return Array.from(new Set((Array.isArray(values) ? values : []).filter(Boolean))).sort(compareIds);
}

function buildTeamSetKey(teamIds) {
  return normalizeTeamIds(teamIds).join("|");
}

function buildHighlightId(mapKey, teamIds) {
  const normalizedMapKey = normalizeMapKey(mapKey) || "unknown";
  const teamKey = buildTeamSetKey(teamIds) || "unknown";
  return `fight-highlight:${normalizedMapKey}:${teamKey}`;
}

function countTeamOverlap(left, right) {
  const rightSet = new Set(normalizeTeamIds(right));
  let overlap = 0;

  for (const teamId of normalizeTeamIds(left)) {
    if (rightSet.has(teamId)) {
      overlap += 1;
    }
  }

  return overlap;
}

function getHighlightStatusRank(highlight) {
  if (highlight.status === "active") {
    return 0;
  }
  if (highlight.status === "fading") {
    return 1;
  }
  return 2;
}

function compareVisibilityPriority(left, right) {
  const leftConfidence = toFiniteNumber(left?.baseConfidence, 0) || 0;
  const rightConfidence = toFiniteNumber(right?.baseConfidence, 0) || 0;
  if (rightConfidence !== leftConfidence) {
    return rightConfidence - leftConfidence;
  }

  const leftTeamCount = Array.isArray(left?.teamIds) ? left.teamIds.length : 0;
  const rightTeamCount = Array.isArray(right?.teamIds) ? right.teamIds.length : 0;
  if (rightTeamCount !== leftTeamCount) {
    return rightTeamCount - leftTeamCount;
  }

  const leftLastSeenAt = toFiniteNumber(left?.lastSeenAt, 0) || 0;
  const rightLastSeenAt = toFiniteNumber(right?.lastSeenAt, 0) || 0;
  if (rightLastSeenAt !== leftLastSeenAt) {
    return rightLastSeenAt - leftLastSeenAt;
  }

  const leftIntensity = toFiniteNumber(left?.baseIntensity, 0) || 0;
  const rightIntensity = toFiniteNumber(right?.baseIntensity, 0) || 0;
  if (rightIntensity !== leftIntensity) {
    return rightIntensity - leftIntensity;
  }

  return compareIds(left?.id, right?.id);
}

function compareSnapshotPriority(left, right) {
  const leftVisible = Boolean(left?.visible);
  const rightVisible = Boolean(right?.visible);
  if (leftVisible !== rightVisible) {
    return rightVisible ? 1 : -1;
  }

  const statusDelta = getHighlightStatusRank(left) - getHighlightStatusRank(right);
  if (statusDelta !== 0) {
    return statusDelta;
  }

  return compareVisibilityPriority(left, right);
}

function buildPairSupportLookup(assistSnapshot) {
  const lookup = new Map();
  const proximities = Array.isArray(assistSnapshot?.teamProximities)
    ? assistSnapshot.teamProximities
    : [];

  for (const proximity of proximities) {
    const key = buildTeamSetKey([proximity?.teamA, proximity?.teamB]);
    if (!key) {
      continue;
    }

    const previous = lookup.get(key);
    if (!previous) {
      lookup.set(key, proximity);
      continue;
    }

    const previousDistance = toFiniteNumber(previous.distance, Number.POSITIVE_INFINITY);
    const nextDistance = toFiniteNumber(proximity.distance, Number.POSITIVE_INFINITY);
    if (nextDistance < previousDistance) {
      lookup.set(key, proximity);
    }
  }

  return lookup;
}

function hasHotZoneSupport(assistSnapshot, teamIds) {
  const teamSet = new Set(normalizeTeamIds(teamIds));
  const hotZones = Array.isArray(assistSnapshot?.hotZones) ? assistSnapshot.hotZones : [];

  return hotZones.some((hotZone) => {
    const involvedTeamIds = normalizeTeamIds(hotZone?.involvedTeamIds);
    if (involvedTeamIds.length < 2) {
      return false;
    }

    let overlap = 0;
    for (const teamId of involvedTeamIds) {
      if (teamSet.has(teamId)) {
        overlap += 1;
      }
    }

    return overlap >= 2;
  });
}

function getSeverityBoost(severity) {
  if (severity === "high") {
    return 0.14;
  }
  if (severity === "medium") {
    return 0.09;
  }
  if (severity === "low") {
    return 0.05;
  }
  return 0;
}

function buildPairCandidates(teamSummaries, assistSnapshot, config, updatedAt) {
  const candidates = [];
  const sourceSummaries = Array.isArray(teamSummaries) ? teamSummaries : [];
  const fightRadius = Math.max(1, toFiniteNumber(config?.FIGHT_HIGHLIGHT_RADIUS, 0) || 1);
  const pairSupportLookup = buildPairSupportLookup(assistSnapshot);
  const minPlayers = Math.max(
    2,
    Math.round(toFiniteNumber(config?.FIGHT_HIGHLIGHT_MIN_PLAYERS, 2) || 2),
  );
  const highConfidenceThreshold = clamp01(
    toFiniteNumber(config?.FIGHT_HIGHLIGHT_HIGH_CONFIDENCE, 0.88) || 0.88,
  );

  for (let leftIndex = 0; leftIndex < sourceSummaries.length; leftIndex += 1) {
    const left = sourceSummaries[leftIndex];
    if (!(toFiniteNumber(left?.activePlayerCount, 0) > 0) || !left?.teamId) {
      continue;
    }

    for (let rightIndex = leftIndex + 1; rightIndex < sourceSummaries.length; rightIndex += 1) {
      const right = sourceSummaries[rightIndex];
      if (!(toFiniteNumber(right?.activePlayerCount, 0) > 0) || !right?.teamId) {
        continue;
      }

      const centroidDistance = distanceBetween(
        toFiniteNumber(left.centroidX, 0) || 0,
        toFiniteNumber(left.centroidY, 0) || 0,
        toFiniteNumber(right.centroidX, 0) || 0,
        toFiniteNumber(right.centroidY, 0) || 0,
      );
      const spreadAllowance = Math.min(
        fightRadius * 0.36,
        (toFiniteNumber(left.spread, 0) || 0) * 0.5 +
          (toFiniteNumber(right.spread, 0) || 0) * 0.5,
      );
      const effectiveDistance = Math.max(0, centroidDistance - spreadAllowance);
      if (effectiveDistance > fightRadius) {
        continue;
      }

      const teamIds = normalizeTeamIds([left.teamId, right.teamId]);
      const playersAlive =
        Math.max(0, Math.round(toFiniteNumber(left.activePlayerCount, 0) || 0)) +
        Math.max(0, Math.round(toFiniteNumber(right.activePlayerCount, 0) || 0));
      if (playersAlive < minPlayers) {
        continue;
      }

      const pairSupport = pairSupportLookup.get(buildTeamSetKey(teamIds)) || null;
      const severityBoost = getSeverityBoost(pairSupport?.severity);
      const hotZoneBoost = hasHotZoneSupport(assistSnapshot, teamIds) ? 0.08 : 0;
      const supportBoost = severityBoost + hotZoneBoost;
      const knockedCount =
        Math.max(0, Math.round(toFiniteNumber(left.knockedCount, 0) || 0)) +
        Math.max(0, Math.round(toFiniteNumber(right.knockedCount, 0) || 0));
      const knockedBoost = Math.min(0.18, knockedCount * 0.08);
      const playerDensity = clamp01(playersAlive / 8);
      const closeness = clamp01(1 - effectiveDistance / fightRadius);
      const confidence = clamp01(
        0.35 + closeness * 0.38 + playerDensity * 0.12 + knockedBoost + supportBoost,
      );
      const intensity = clamp01(
        0.28 +
          closeness * 0.42 +
          playerDensity * 0.14 +
          knockedBoost * 1.2 +
          supportBoost * 0.9,
      );
      const leftWeight = Math.max(
        1,
        Math.round(toFiniteNumber(left.activePlayerCount, 0) || 0),
      );
      const rightWeight = Math.max(
        1,
        Math.round(toFiniteNumber(right.activePlayerCount, 0) || 0),
      );
      const centerX =
        ((toFiniteNumber(left.centroidX, 0) || 0) * leftWeight +
          (toFiniteNumber(right.centroidX, 0) || 0) * rightWeight) /
        (leftWeight + rightWeight);
      const centerY =
        ((toFiniteNumber(left.centroidY, 0) || 0) * leftWeight +
          (toFiniteNumber(right.centroidY, 0) || 0) * rightWeight) /
        (leftWeight + rightWeight);
      const radius = clamp(
        Math.max(
          fightRadius * 0.42,
          centroidDistance * 0.5 +
            Math.max(
              toFiniteNumber(left.spread, 0) || 0,
              toFiniteNumber(right.spread, 0) || 0,
            ) *
              0.55,
          effectiveDistance * 0.55 + fightRadius * 0.2,
        ),
        fightRadius * 0.38,
        fightRadius * 0.95,
      );

      candidates.push({
        activationTicks: Math.max(
          1,
          Math.round(toFiniteNumber(config?.FIGHT_HIGHLIGHT_ACTIVATION_TICKS, 3) || 3),
        ),
        centerX,
        centerY,
        confidence,
        effectiveDistance,
        immediateActivation:
          confidence >= highConfidenceThreshold && (knockedCount > 0 || supportBoost >= 0.08),
        intensity,
        knockedCount,
        lastSeenAt: updatedAt,
        pairKey: buildTeamSetKey(teamIds),
        playersAlive,
        radius,
        sourcePairCount: 1,
        status: "candidate",
        teamIds,
        updatedAt,
      });
    }
  }

  candidates.sort(compareVisibilityPriority);
  return candidates;
}

function shouldMergeCandidates(left, right, config) {
  const centerDistance = distanceBetween(
    left.centerX,
    left.centerY,
    right.centerX,
    right.centerY,
  );
  const overlap = countTeamOverlap(left.teamIds, right.teamIds);
  const mergeDistance = Math.max(
    toFiniteNumber(config?.FIGHT_HIGHLIGHT_MERGE_DISTANCE, 0) || 0,
    Math.min(left.radius, right.radius) * 0.9,
  );

  if (overlap >= 1) {
    return centerDistance <= Math.max(mergeDistance, Math.max(left.radius, right.radius));
  }

  return centerDistance <= mergeDistance;
}

function mergeCandidateInto(target, source, config) {
  const targetWeight = Math.max(0.2, target.intensity);
  const sourceWeight = Math.max(0.2, source.intensity);
  const totalWeight = targetWeight + sourceWeight;

  target.centerX = (target.centerX * targetWeight + source.centerX * sourceWeight) / totalWeight;
  target.centerY = (target.centerY * targetWeight + source.centerY * sourceWeight) / totalWeight;
  target.teamIds = normalizeTeamIds([...target.teamIds, ...source.teamIds]);
  target.playersAlive = Math.max(target.playersAlive, source.playersAlive);
  target.knockedCount = Math.max(target.knockedCount, source.knockedCount);
  target.confidence = clamp01(Math.max(target.confidence, source.confidence) + 0.04);
  target.intensity = clamp01(Math.max(target.intensity, source.intensity) + 0.05);
  target.immediateActivation = target.immediateActivation || source.immediateActivation;
  target.activationTicks = Math.min(target.activationTicks, source.activationTicks);
  target.sourcePairCount += source.sourcePairCount;
  target.lastSeenAt = Math.max(target.lastSeenAt, source.lastSeenAt);
  target.updatedAt = Math.max(target.updatedAt, source.updatedAt);
  target.radius = clamp(
    Math.max(
      target.radius,
      source.radius,
      distanceBetween(target.centerX, target.centerY, source.centerX, source.centerY) * 0.5 +
        Math.max(target.radius, source.radius) * 0.66,
    ),
    Math.min(target.radius, source.radius),
    Math.max(target.radius, source.radius) +
      (toFiniteNumber(config?.FIGHT_HIGHLIGHT_MERGE_DISTANCE, 0) || 0),
  );

  return target;
}

function findMatchingHighlight(highlightsById, candidate, config, mapKey, claimedIds) {
  const directId = buildHighlightId(mapKey, candidate.teamIds);
  const directMatch = highlightsById.get(directId);
  if (directMatch && !claimedIds.has(directMatch.id)) {
    return directMatch;
  }

  const candidateTeamKey = buildTeamSetKey(candidate.teamIds);
  let best = null;

  for (const highlight of highlightsById.values()) {
    if (claimedIds.has(highlight.id)) {
      continue;
    }

    const highlightTeamKey = buildTeamSetKey(highlight.teamIds);
    const exactTeamMatch = highlightTeamKey === candidateTeamKey;
    const teamOverlap = countTeamOverlap(highlight.teamIds, candidate.teamIds);
    const centerDistance = distanceBetween(
      highlight.centerX,
      highlight.centerY,
      candidate.centerX,
      candidate.centerY,
    );
    const matchDistance = Math.max(
      toFiniteNumber(config?.FIGHT_HIGHLIGHT_MATCH_DISTANCE, 0) || 0,
      highlight.radius * 0.9,
      candidate.radius * 0.9,
    );

    if (!exactTeamMatch && teamOverlap === 0 && centerDistance > matchDistance) {
      continue;
    }
    if (!exactTeamMatch && teamOverlap > 0 && centerDistance > matchDistance * 1.35) {
      continue;
    }

    const comparison = {
      centerDistance,
      exactTeamMatch,
      highlight,
      teamOverlap,
    };

    if (!best) {
      best = comparison;
      continue;
    }

    if (comparison.exactTeamMatch !== best.exactTeamMatch) {
      if (comparison.exactTeamMatch) {
        best = comparison;
      }
      continue;
    }

    if (comparison.teamOverlap !== best.teamOverlap) {
      if (comparison.teamOverlap > best.teamOverlap) {
        best = comparison;
      }
      continue;
    }

    if (comparison.centerDistance < best.centerDistance) {
      best = comparison;
    }
  }

  return best?.highlight ?? null;
}

function smoothHighlightGeometry(highlight, candidate, config) {
  const currentRadius = Math.max(1, toFiniteNumber(highlight?.radius, 0) || 1);
  const candidateRadius = Math.max(1, toFiniteNumber(candidate?.radius, currentRadius) || currentRadius);
  const baseRadius = Math.max(currentRadius, candidateRadius, 1);
  const centerDistance = distanceBetween(
    toFiniteNumber(highlight?.centerX, 0) || 0,
    toFiniteNumber(highlight?.centerY, 0) || 0,
    toFiniteNumber(candidate?.centerX, 0) || 0,
    toFiniteNumber(candidate?.centerY, 0) || 0,
  );
  const radiusDelta = Math.abs(candidateRadius - currentRadius);
  const centerJitterDistance = Math.max(
    1_200,
    baseRadius * (toFiniteNumber(config?.FIGHT_HIGHLIGHT_CENTER_JITTER_RATIO, 0.075) || 0.075),
  );
  const radiusJitterDistance = Math.max(
    900,
    baseRadius * (toFiniteNumber(config?.FIGHT_HIGHLIGHT_RADIUS_JITTER_RATIO, 0.09) || 0.09),
  );
  const centerSnapDistance = Math.max(
    centerJitterDistance * 1.8,
    baseRadius * (toFiniteNumber(config?.FIGHT_HIGHLIGHT_CENTER_SNAP_RATIO, 0.55) || 0.55),
  );
  const radiusSnapDistance = Math.max(
    radiusJitterDistance * 1.8,
    baseRadius * (toFiniteNumber(config?.FIGHT_HIGHLIGHT_RADIUS_SNAP_RATIO, 0.42) || 0.42),
  );

  let nextCenterX = candidate.centerX;
  let nextCenterY = candidate.centerY;
  let nextRadius = candidate.radius;
  let didSmooth = false;

  if (centerDistance <= centerJitterDistance) {
    nextCenterX = highlight.centerX;
    nextCenterY = highlight.centerY;
    didSmooth = centerDistance > 0;
  } else if (centerDistance < centerSnapDistance) {
    const centerSmoothing = toFiniteNumber(config?.FIGHT_HIGHLIGHT_CENTER_SMOOTHING, 0.62) || 0.62;
    nextCenterX = lerp(highlight.centerX, candidate.centerX, centerSmoothing);
    nextCenterY = lerp(highlight.centerY, candidate.centerY, centerSmoothing);
    didSmooth = true;
  }

  if (radiusDelta <= radiusJitterDistance) {
    nextRadius = highlight.radius;
    didSmooth = didSmooth || radiusDelta > 0;
  } else if (radiusDelta < radiusSnapDistance) {
    const radiusSmoothing = toFiniteNumber(config?.FIGHT_HIGHLIGHT_RADIUS_SMOOTHING, 0.68) || 0.68;
    nextRadius = lerp(highlight.radius, candidate.radius, radiusSmoothing);
    didSmooth = true;
  }

  return {
    centerDistance,
    didSmooth,
    nextCenterX,
    nextCenterY,
    nextRadius,
    radiusDelta,
  };
}

function buildSnapshotHighlight(highlight, config, updatedAt, options = {}) {
  const now = Number.isFinite(updatedAt) ? updatedAt : Date.now();
  let visualFade = 1;
  if (highlight.status === "fading") {
    const holdMs = Math.max(
      1,
      Math.round(toFiniteNumber(config?.FIGHT_HIGHLIGHT_FADE_HOLD_MS, 4_500) || 4_500),
    );
    visualFade = clamp01(1 - (now - highlight.lastSeenAt) / holdMs);
  } else if (highlight.status === "candidate") {
    visualFade = 0.24;
  }

  return {
    id: highlight.id,
    centerX: highlight.centerX,
    centerY: highlight.centerY,
    radius: highlight.radius,
    teamIds: [...highlight.teamIds],
    confidence: highlight.baseConfidence,
    intensity: highlight.baseIntensity,
    renderConfidence: clamp01(highlight.baseConfidence * Math.max(0.18, visualFade)),
    renderIntensity: clamp01(highlight.baseIntensity * Math.max(0.14, visualFade)),
    status: highlight.status,
    firstSeenAt: highlight.firstSeenAt,
    lastSeenAt: highlight.lastSeenAt,
    playersAlive: highlight.playersAlive,
    sourcePairCount: highlight.sourcePairCount,
    updatedAt: now,
    visible: Boolean(options.visible),
    priorityRank: Number.isFinite(options.priorityRank) ? options.priorityRank : null,
  };
}

function createFightHighlightEngine({ log = () => {} } = {}) {
  const highlightsById = new Map();
  const recentLogAtByKey = new Map();

  function logOnce(key, message, updatedAt, minIntervalMs = 2_500) {
    const now = Number.isFinite(updatedAt) ? updatedAt : Date.now();
    const previous = recentLogAtByKey.get(key);
    if (previous !== undefined && now - previous < minIntervalMs) {
      return;
    }

    recentLogAtByKey.set(key, now);
    log(message);
  }

  function createHighlight(candidate, mapKey, updatedAt) {
    const id = buildHighlightId(mapKey, candidate.teamIds);
    const highlight = {
      activationTickCount: 1,
      activationTicksRequired: candidate.immediateActivation ? 1 : candidate.activationTicks,
      baseConfidence: candidate.confidence,
      baseIntensity: candidate.intensity,
      centerX: candidate.centerX,
      centerY: candidate.centerY,
      firstSeenAt: updatedAt,
      id,
      lastSeenAt: updatedAt,
      lastUpdatedAt: updatedAt,
      playersAlive: candidate.playersAlive,
      radius: candidate.radius,
      sourcePairCount: candidate.sourcePairCount,
      status: "candidate",
      teamIds: [...candidate.teamIds],
      wasEverActive: false,
    };

    highlightsById.set(id, highlight);
    logOnce(
      `candidate:${mapKey || "unknown"}:${id}`,
      `[Widget] Fight candidate detected id=${id} teams=${buildTeamSetKey(
        highlight.teamIds,
      )} confidence=${highlight.baseConfidence.toFixed(2)}`,
      updatedAt,
      1_000,
    );

    if (highlight.activationTickCount >= highlight.activationTicksRequired) {
      highlight.status = "active";
      highlight.wasEverActive = true;
      logOnce(
        `activated:${mapKey || "unknown"}:${id}`,
        `[Widget] Fight highlight activated id=${id} teams=${buildTeamSetKey(
          highlight.teamIds,
        )} intensity=${highlight.baseIntensity.toFixed(2)}`,
        updatedAt,
        1_000,
      );
    }

    return highlight;
  }

  function refreshHighlight(highlight, candidate, config, mapKey, updatedAt) {
    const previousStatus = highlight.status;

    highlight.playersAlive = candidate.playersAlive;
    highlight.sourcePairCount = candidate.sourcePairCount;
    highlight.teamIds = [...candidate.teamIds];
    highlight.baseConfidence = candidate.confidence;
    highlight.baseIntensity = candidate.intensity;
    highlight.lastSeenAt = updatedAt;
    highlight.lastUpdatedAt = updatedAt;
    highlight.activationTicksRequired = candidate.immediateActivation
      ? 1
      : Math.max(1, candidate.activationTicks);

    if (highlight.wasEverActive) {
      const smoothedGeometry = smoothHighlightGeometry(highlight, candidate, config);
      highlight.centerX = smoothedGeometry.nextCenterX;
      highlight.centerY = smoothedGeometry.nextCenterY;
      highlight.radius = smoothedGeometry.nextRadius;
      highlight.activationTickCount = Math.min(
        highlight.activationTicksRequired + 4,
        highlight.activationTickCount + 1,
      );
      highlight.status = "active";

      if (smoothedGeometry.didSmooth) {
        logOnce(
          `smoothed:${highlight.id}`,
          `[Widget] Fight highlight smoothed id=${highlight.id} centerDelta=${Math.round(
            smoothedGeometry.centerDistance,
          )} radiusDelta=${Math.round(smoothedGeometry.radiusDelta)}`,
          updatedAt,
          1_200,
        );
      }
      if (previousStatus === "fading") {
        logOnce(
          `reactivated:${highlight.id}`,
          `[Widget] Fight highlight reactivated id=${highlight.id} teams=${buildTeamSetKey(
            highlight.teamIds,
          )}`,
          updatedAt,
          1_000,
        );
      }

      return highlight;
    }

    highlight.centerX = candidate.centerX;
    highlight.centerY = candidate.centerY;
    highlight.radius = candidate.radius;
    highlight.activationTickCount = Math.min(
      highlight.activationTicksRequired + 4,
      highlight.activationTickCount + 1,
    );

    if (highlight.activationTickCount >= highlight.activationTicksRequired) {
      highlight.status = "active";
      highlight.wasEverActive = true;
      logOnce(
        `activated:${mapKey || "unknown"}:${highlight.id}`,
        `[Widget] Fight highlight activated id=${highlight.id} teams=${buildTeamSetKey(
          highlight.teamIds,
        )} intensity=${highlight.baseIntensity.toFixed(2)}`,
        updatedAt,
        1_000,
      );
    } else {
      highlight.status = "candidate";
    }

    return highlight;
  }

  function buildMergedCandidates(candidates, config, mapKey, updatedAt) {
    const merged = [];

    for (const candidate of candidates) {
      let matched = null;
      for (const existing of merged) {
        if (shouldMergeCandidates(existing, candidate, config)) {
          matched = existing;
          break;
        }
      }

      if (!matched) {
        merged.push({ ...candidate, teamIds: [...candidate.teamIds] });
        continue;
      }

      const previousTeamKey = buildTeamSetKey(matched.teamIds);
      mergeCandidateInto(matched, candidate, config);
      const nextTeamKey = buildTeamSetKey(matched.teamIds);
      logOnce(
        `merged:${mapKey || "unknown"}:${nextTeamKey}`,
        `[Widget] Fight highlight merged teams=${nextTeamKey} sourcePairs=${matched.sourcePairCount}`,
        updatedAt,
        2_000,
      );
      if (previousTeamKey !== nextTeamKey) {
        matched.pairKey = nextTeamKey;
      }
    }

    return merged;
  }

  function pruneStaleHighlights(config, updatedAt, claimedIds, mapKey) {
    const candidateTtlMs = Math.max(
      250,
      Math.round(toFiniteNumber(config?.FIGHT_HIGHLIGHT_CANDIDATE_TTL_MS, 1_800) || 1_800),
    );
    const fadeHoldMs = Math.max(
      1_000,
      Math.round(toFiniteNumber(config?.FIGHT_HIGHLIGHT_FADE_HOLD_MS, 4_500) || 4_500),
    );

    for (const [id, highlight] of highlightsById.entries()) {
      if (claimedIds.has(id)) {
        continue;
      }

      const ageMs = Math.max(0, updatedAt - highlight.lastSeenAt);

      if (!highlight.wasEverActive) {
        if (ageMs > candidateTtlMs) {
          highlightsById.delete(id);
        }
        continue;
      }

      if (ageMs <= fadeHoldMs) {
        if (highlight.status !== "fading") {
          highlight.status = "fading";
          highlight.lastUpdatedAt = updatedAt;
          logOnce(
            `faded:${mapKey || "unknown"}:${id}`,
            `[Widget] Fight highlight faded id=${id} teams=${buildTeamSetKey(
              highlight.teamIds,
            )} ageMs=${ageMs}`,
            updatedAt,
            1_000,
          );
        }
        continue;
      }

      highlightsById.delete(id);
    }
  }

  function buildSnapshotHighlights(config, updatedAt = Date.now(), mapKey = null) {
    const maxHighlights = Math.max(
      1,
      Math.round(toFiniteNumber(config?.MAX_FIGHT_HIGHLIGHTS, 4) || 4),
    );
    const maxVisibleHighlights = Math.max(
      1,
      Math.round(
        toFiniteNumber(config?.MAX_VISIBLE_FIGHT_HIGHLIGHTS, Math.min(maxHighlights, 3)) ||
          Math.min(maxHighlights, 3),
      ),
    );
    const sourceHighlights = Array.from(highlightsById.values());
    const renderableHighlights = sourceHighlights
      .filter((highlight) => highlight.status === "active" || highlight.status === "fading")
      .sort(compareVisibilityPriority);
    const visibleIds = new Set(
      renderableHighlights.slice(0, maxVisibleHighlights).map((highlight) => highlight.id),
    );
    const priorityRanksById = new Map(
      renderableHighlights.map((highlight, index) => [highlight.id, index + 1]),
    );
    const hiddenRenderableCount = Math.max(0, renderableHighlights.length - maxVisibleHighlights);

    if (hiddenRenderableCount > 0) {
      logOnce(
        `priority-capped:${normalizeMapKey(mapKey)}:${renderableHighlights
          .slice(0, maxVisibleHighlights)
          .map((highlight) => highlight.id)
          .join("|")}`,
        `[Widget] Fight highlight priority-capped visible=${Math.min(
          renderableHighlights.length,
          maxVisibleHighlights,
        )} hidden=${hiddenRenderableCount}`,
        updatedAt,
        1_500,
      );
    }

    return sourceHighlights
      .map((highlight) =>
        buildSnapshotHighlight(highlight, config, updatedAt, {
          priorityRank: priorityRanksById.get(highlight.id) ?? null,
          visible: visibleIds.has(highlight.id),
        }),
      )
      .sort(compareSnapshotPriority)
      .slice(0, maxHighlights);
  }

  function evaluate({ assistSnapshot, config, mapKey = null, teamSummaries, updatedAt } = {}) {
    const now = Number.isFinite(updatedAt) ? updatedAt : Date.now();
    const claimedIds = new Set();
    const candidates = buildMergedCandidates(
      buildPairCandidates(teamSummaries, assistSnapshot, config, now),
      config,
      mapKey,
      now,
    );

    for (const candidate of candidates) {
      const matchedHighlight = findMatchingHighlight(
        highlightsById,
        candidate,
        config,
        mapKey,
        claimedIds,
      );
      if (matchedHighlight) {
        refreshHighlight(matchedHighlight, candidate, config, mapKey, now);
        claimedIds.add(matchedHighlight.id);
        continue;
      }

      const createdHighlight = createHighlight(candidate, mapKey, now);
      claimedIds.add(createdHighlight.id);
    }

    pruneStaleHighlights(config, now, claimedIds, mapKey);
    return buildSnapshotHighlights(config, now, mapKey);
  }

  function getHighlights(config, updatedAt = Date.now(), mapKey = null) {
    return buildSnapshotHighlights(config, updatedAt, mapKey);
  }

  function reset() {
    highlightsById.clear();
    recentLogAtByKey.clear();
  }

  return {
    evaluate,
    getHighlights,
    reset,
  };
}

module.exports = {
  createFightHighlightEngine,
};
