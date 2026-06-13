"use strict";

const { createCombatMemoryStore } = require("./combat-memory-store.cjs");
const { resolveObserverAssistConfig } = require("./observer-assist-config.cjs");
const { generateFocusCandidates } = require("./focus-candidate-generator.cjs");
const { detectHotZones } = require("./hot-zone-detector.cjs");
const {
  detectTeamProximities,
  distanceBetween,
  summarizeTeams,
} = require("./team-proximity-utils.cjs");

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

function cloneHotZone(hotZone) {
  return {
    id: hotZone.id,
    centerX: hotZone.centerX,
    centerY: hotZone.centerY,
    radius: hotZone.radius,
    involvedTeamIds: [...hotZone.involvedTeamIds],
    score: hotZone.score,
    recentKillCount: hotZone.recentKillCount,
    recentCombatCount: hotZone.recentCombatCount,
    currentKnockedCount: hotZone.currentKnockedCount,
    distanceToZoneEdge: hotZone.distanceToZoneEdge,
    updatedAt: hotZone.updatedAt,
  };
}

function cloneProximity(proximity) {
  return {
    teamA: proximity.teamA,
    teamB: proximity.teamB,
    distance: proximity.distance,
    centerX: proximity.centerX,
    centerY: proximity.centerY,
    severity: proximity.severity,
    updatedAt: proximity.updatedAt,
    teamACenterX: proximity.teamACenterX,
    teamACenterY: proximity.teamACenterY,
    teamBCenterX: proximity.teamBCenterX,
    teamBCenterY: proximity.teamBCenterY,
  };
}

function cloneFocusCandidate(candidate) {
  return {
    id: candidate.id,
    label: candidate.label,
    centerX: candidate.centerX,
    centerY: candidate.centerY,
    score: candidate.score,
    category: candidate.category,
    involvedTeamIds: [...candidate.involvedTeamIds],
    updatedAt: candidate.updatedAt,
  };
}

function cloneCombatEvent(event) {
  return {
    id: event.id,
    kind: event.kind,
    x: event.x,
    y: event.y,
    timestamp: event.timestamp,
    killerPlayerId: event.killerPlayerId ?? null,
    killerTeamId: event.killerTeamId ?? null,
    killerName: event.killerName ?? null,
    victimPlayerId: event.victimPlayerId ?? null,
    victimTeamId: event.victimTeamId ?? null,
    victimName: event.victimName ?? null,
  };
}

function cloneRankedFight(fight) {
  return {
    fightId: fight.fightId,
    score: fight.score,
    displayScore: fight.displayScore,
    priorityLabel: fight.priorityLabel,
    reason: fight.reason,
    teamIds: [...fight.teamIds],
    teamCount: fight.teamCount,
    confidence: fight.confidence,
    intensity: fight.intensity,
    playersAlive: fight.playersAlive,
    phase: fight.phase,
    zonePressure: fight.zonePressure,
    zonePressureLabel: fight.zonePressureLabel ?? null,
    status: fight.status,
    centerX: fight.centerX,
    centerY: fight.centerY,
    radius: fight.radius,
    suggestedPlayerId: fight.suggestedPlayerId ?? null,
    suggestedPlayerName: fight.suggestedPlayerName ?? null,
    suggestedTeamId: fight.suggestedTeamId ?? null,
    lastRefreshedAt: fight.lastRefreshedAt ?? fight.updatedAt,
    updatedAt: fight.updatedAt,
  };
}

function cloneBestSuggestion(suggestion) {
  if (!suggestion) {
    return null;
  }

  return {
    fightId: suggestion.fightId,
    score: suggestion.score,
    displayScore: suggestion.displayScore,
    priorityLabel: suggestion.priorityLabel,
    reason: suggestion.reason,
    teamIds: [...suggestion.teamIds],
    suggestedPlayerId: suggestion.suggestedPlayerId ?? null,
    suggestedPlayerName: suggestion.suggestedPlayerName ?? null,
    suggestedTeamId: suggestion.suggestedTeamId ?? null,
    centerX: suggestion.centerX,
    centerY: suggestion.centerY,
    radius: suggestion.radius,
    status: suggestion.status,
    confidence: suggestion.confidence,
    phase: suggestion.phase,
    lastRefreshedAt: suggestion.lastRefreshedAt ?? suggestion.updatedAt,
    updatedAt: suggestion.updatedAt,
  };
}

function cloneFallbackState(fallbackState) {
  if (!fallbackState) {
    return null;
  }

  return {
    kind: fallbackState.kind || "idle",
    title: fallbackState.title || "No active fight",
    detail: fallbackState.detail || "Scanning map",
  };
}

function cloneAssistSnapshot(snapshot) {
  if (!snapshot) {
    return null;
  }

  return {
    mapKey: snapshot.mapKey,
    updatedAt: snapshot.updatedAt,
    hotZones: snapshot.hotZones.map(cloneHotZone),
    teamProximities: snapshot.teamProximities.map(cloneProximity),
    focusCandidates: snapshot.focusCandidates.map(cloneFocusCandidate),
    combatEvents: snapshot.combatEvents.map(cloneCombatEvent),
    recentCombatCount: snapshot.recentCombatCount,
    activeFightCount: snapshot.activeFightCount,
    lastCombatAt: snapshot.lastCombatAt,
    bestSuggestion: cloneBestSuggestion(snapshot.bestSuggestion),
    rankedFights: snapshot.rankedFights.map(cloneRankedFight),
    fallbackState: cloneFallbackState(snapshot.fallbackState),
    config: { ...snapshot.config },
  };
}

function buildConfigSnapshot(config) {
  return {
    HOT_ZONE_TEAM_RADIUS: config.HOT_ZONE_TEAM_RADIUS,
    PROXIMITY_RADIUS: config.PROXIMITY_RADIUS,
    COMBAT_MEMORY_MS: config.COMBAT_MEMORY_MS,
    MAX_FOCUS_CANDIDATES: config.MAX_FOCUS_CANDIDATES,
    OBSERVER_ASSIST_CONFIDENCE_WEIGHT: config.OBSERVER_ASSIST_CONFIDENCE_WEIGHT,
    OBSERVER_ASSIST_TEAM_COUNT_WEIGHT: config.OBSERVER_ASSIST_TEAM_COUNT_WEIGHT,
    OBSERVER_ASSIST_ALIVE_PLAYER_WEIGHT: config.OBSERVER_ASSIST_ALIVE_PLAYER_WEIGHT,
    OBSERVER_ASSIST_PHASE_WEIGHT: config.OBSERVER_ASSIST_PHASE_WEIGHT,
    OBSERVER_ASSIST_ZONE_PRESSURE_WEIGHT: config.OBSERVER_ASSIST_ZONE_PRESSURE_WEIGHT,
    OBSERVER_ASSIST_MINIMUM_HOLD_MS: config.OBSERVER_ASSIST_MINIMUM_HOLD_MS,
    OBSERVER_ASSIST_REPLACEMENT_DELTA_THRESHOLD:
      config.OBSERVER_ASSIST_REPLACEMENT_DELTA_THRESHOLD,
    OBSERVER_ASSIST_MAX_RANKED_FIGHTS: config.OBSERVER_ASSIST_MAX_RANKED_FIGHTS,
    OBSERVER_ASSIST_SUGGESTION_EXPIRY_MS: config.OBSERVER_ASSIST_SUGGESTION_EXPIRY_MS,
    OBSERVER_ASSIST_SCORE_DISPLAY_STEP: config.OBSERVER_ASSIST_SCORE_DISPLAY_STEP,
  };
}

function createEmptyAssistSnapshot(mapKey, config, updatedAt) {
  return {
    mapKey,
    updatedAt,
    hotZones: [],
    teamProximities: [],
    focusCandidates: [],
    combatEvents: [],
    recentCombatCount: 0,
    activeFightCount: 0,
    lastCombatAt: null,
    bestSuggestion: null,
    rankedFights: [],
    fallbackState: {
      kind: "idle",
      title: "No active fight",
      detail: "Scanning map",
    },
    config: buildConfigSnapshot(config),
  };
}

function logOnce(state, key, message, updatedAt, log, minIntervalMs = 1_200) {
  const now = Number.isFinite(updatedAt) ? updatedAt : Date.now();
  const previousAt = state.logState.recentLogAtByKey.get(key);
  if (previousAt !== undefined && now - previousAt < minIntervalMs) {
    return;
  }

  state.logState.recentLogAtByKey.set(key, now);
  log(message);
}

function logFightScore(state, fight, updatedAt, log) {
  const roundedScore = Math.round(toFiniteNumber(fight?.score, 0) || 0);
  const previous = state.logState.scoredFightStateById.get(fight.fightId);
  if (
    previous &&
    Math.abs(previous.score - roundedScore) < 6 &&
    updatedAt - previous.updatedAt < 4_000
  ) {
    return;
  }

  state.logState.scoredFightStateById.set(fight.fightId, {
    score: roundedScore,
    updatedAt,
  });
  log(
    `[Assist] Fight scored id=${fight.fightId} score=${roundedScore} teams=${buildTeamSetKey(
      fight.teamIds,
    )} reason=${fight.reason}`,
  );
}

function cleanupScoredFightLogs(state, rankedFightIds) {
  const validIds = new Set(rankedFightIds);
  for (const fightId of state.logState.scoredFightStateById.keys()) {
    if (!validIds.has(fightId)) {
      state.logState.scoredFightStateById.delete(fightId);
    }
  }
}

function resolvePhase(zonePacket) {
  return Math.max(0, Math.round(toFiniteNumber(zonePacket?.phase, 0) || 0));
}

function computeZonePressure(zonePacket, fight, config) {
  const centerX = toFiniteNumber(zonePacket?.centerX ?? zonePacket?.currentCircle?.centerX);
  const centerY = toFiniteNumber(zonePacket?.centerY ?? zonePacket?.currentCircle?.centerY);
  const radius = toFiniteNumber(zonePacket?.radius ?? zonePacket?.currentCircle?.radius);
  if (centerX === null || centerY === null || radius === null) {
    return {
      distanceToZoneEdge: null,
      factor: 0,
      label: null,
    };
  }

  const edgeBand = Math.max(1, toFiniteNumber(config?.ZONE_EDGE_BAND, 0) || 1);
  const distanceToEdge =
    radius - distanceBetween(
      centerX,
      centerY,
      toFiniteNumber(fight?.centerX, 0) || 0,
      toFiniteNumber(fight?.centerY, 0) || 0,
    );

  if (distanceToEdge <= 0) {
    return {
      distanceToZoneEdge: distanceToEdge,
      factor: 1,
      label: "out of zone",
    };
  }
  if (distanceToEdge <= edgeBand * 0.5) {
    return {
      distanceToZoneEdge: distanceToEdge,
      factor: 0.9,
      label: "zone edge",
    };
  }
  if (distanceToEdge <= edgeBand) {
    return {
      distanceToZoneEdge: distanceToEdge,
      factor: 0.55,
      label: "near zone edge",
    };
  }

  return {
    distanceToZoneEdge: distanceToEdge,
    factor: 0,
    label: null,
  };
}

function buildPriorityLabel(score) {
  const numeric = toFiniteNumber(score, 0) || 0;
  if (numeric >= 210) {
    return "critical";
  }
  if (numeric >= 165) {
    return "high";
  }
  if (numeric >= 120) {
    return "medium";
  }
  return "watch";
}

function normalizeReasonDescriptor(teamCount, zonePressureLabel) {
  if (zonePressureLabel) {
    return zonePressureLabel;
  }
  if (teamCount >= 3) {
    return "multi-team fight";
  }
  if (teamCount === 2) {
    return "head-to-head";
  }
  return "contested";
}

function buildReasonSignature({ fightId, teamCount, phase, zonePressureLabel }) {
  return [
    String(fightId || ""),
    String(Math.max(1, Math.round(toFiniteNumber(teamCount, 1) || 1))),
    String(Math.max(0, Math.round(toFiniteNumber(phase, 0) || 0))),
    String(zonePressureLabel || normalizeReasonDescriptor(teamCount, zonePressureLabel)),
  ].join("|");
}

function buildReason({ teamCount, phase, zonePressureLabel }) {
  const parts = [`${Math.max(1, teamCount)} ${teamCount === 1 ? "team" : "teams"}`];
  parts.push(normalizeReasonDescriptor(teamCount, zonePressureLabel));
  if (phase > 0) {
    parts.push(`phase ${phase}`);
  }
  return parts.slice(0, 3).join(", ");
}

function normalizeDisplayScore(score, config) {
  const numeric = Math.max(0, toFiniteNumber(score, 0) || 0);
  const step = Math.max(
    1,
    Math.round(toFiniteNumber(config?.OBSERVER_ASSIST_SCORE_DISPLAY_STEP, 5) || 5),
  );
  return Math.round(numeric / step) * step;
}

function isPlayerStateEligibleForSuggestion(player) {
  if (!player || typeof player !== "object") {
    return false;
  }
  return player.alive !== false && player.knocked !== true;
}

function findPlayerBySuggestion(playersPacket, suggestion) {
  if (!suggestion || !suggestion.suggestedPlayerId) {
    return null;
  }

  const sourcePlayers = Array.isArray(playersPacket?.players) ? playersPacket.players : [];
  for (const player of sourcePlayers) {
    if (!player || typeof player !== "object") {
      continue;
    }
    const playerId = String(player.playerId || "").trim();
    const externalPlayerId = String(player.externalPlayerId || "").trim();
    const pubgPlayerId = String(player.pubgPlayerId || "").trim();
    if (
      suggestion.suggestedPlayerId === playerId ||
      suggestion.suggestedPlayerId === externalPlayerId ||
      suggestion.suggestedPlayerId === pubgPlayerId
    ) {
      return player;
    }
  }
  return null;
}

function buildFallbackState(kind, detail) {
  if (kind === "stale") {
    return {
      kind,
      title: "Suggestion expired",
      detail: detail || "Scanning map for a fresh fight",
    };
  }

  return {
    kind: "idle",
    title: "No active fight",
    detail: detail || "Scanning map",
  };
}

function applyStableFightPresentation(state, fight, updatedAt, log) {
  const signature = buildReasonSignature({
    fightId: fight.fightId,
    teamCount: fight.teamCount,
    phase: fight.phase,
    zonePressureLabel: fight.zonePressureLabel,
  });
  const existing = state.presentationStateByFightId.get(fight.fightId) || null;
  let reason = existing?.reason || null;
  if (!reason || existing.signature !== signature) {
    reason = buildReason({
      teamCount: fight.teamCount,
      phase: fight.phase,
      zonePressureLabel: fight.zonePressureLabel,
    });
    state.presentationStateByFightId.set(fight.fightId, {
      signature,
      reason,
    });
    if (existing && existing.reason !== reason) {
      logOnce(
        state,
        `reason:${fight.fightId}`,
        `[Assist] Reason updated fight=${fight.fightId} reason=${reason}`,
        updatedAt,
        log,
      );
    }
  }

  return {
    ...fight,
    displayScore: normalizeDisplayScore(fight.score, state.latestConfig),
    reason,
  };
}

function cleanupPresentationState(state, rankedFightIds) {
  const validIds = new Set(rankedFightIds);
  for (const fightId of state.presentationStateByFightId.keys()) {
    if (!validIds.has(fightId)) {
      state.presentationStateByFightId.delete(fightId);
    }
  }
}

function isSuggestedPlayerEligible(player, fightTeamIds) {
  if (!player || typeof player !== "object") {
    return false;
  }
  if (!fightTeamIds.includes(player.teamId)) {
    return false;
  }
  if (player.alive === false || player.knocked === true) {
    return false;
  }
  return (
    Number.isFinite(toFiniteNumber(player.x)) &&
    Number.isFinite(toFiniteNumber(player.y))
  );
}

function compareSuggestedPlayers(left, right) {
  if (left.effectiveDistance !== right.effectiveDistance) {
    return left.effectiveDistance - right.effectiveDistance;
  }
  if (left.rawDistance !== right.rawDistance) {
    return left.rawDistance - right.rawDistance;
  }

  const teamDelta = compareIds(left.player.teamId, right.player.teamId);
  if (teamDelta !== 0) {
    return teamDelta;
  }

  const leftName = String(left.player.playerName || "");
  const rightName = String(right.player.playerName || "");
  const nameDelta = leftName.localeCompare(rightName, undefined, {
    numeric: true,
    sensitivity: "base",
  });
  if (nameDelta !== 0) {
    return nameDelta;
  }

  return compareIds(left.player.playerId, right.player.playerId);
}

function selectSuggestedPlayer(playersPacket, fight, previousSuggestion) {
  const sourcePlayers = Array.isArray(playersPacket?.players) ? playersPacket.players : [];
  const fightTeamIds = normalizeTeamIds(fight?.teamIds);
  const stickyPlayerId =
    previousSuggestion && previousSuggestion.fightId === fight.fightId
      ? previousSuggestion.suggestedPlayerId
      : null;
  const playerBias = Math.min(
    Math.max((toFiniteNumber(fight?.radius, 0) || 0) * 0.08, 900),
    2_200,
  );

  const rankedPlayers = sourcePlayers
    .filter((player) => isSuggestedPlayerEligible(player, fightTeamIds))
    .map((player) => {
      const rawDistance = distanceBetween(
        toFiniteNumber(player.x, 0) || 0,
        toFiniteNumber(player.y, 0) || 0,
        toFiniteNumber(fight.centerX, 0) || 0,
        toFiniteNumber(fight.centerY, 0) || 0,
      );

      return {
        effectiveDistance:
          player.playerId && stickyPlayerId && player.playerId === stickyPlayerId
            ? Math.max(0, rawDistance - playerBias)
            : rawDistance,
        player,
        rawDistance,
      };
    })
    .sort(compareSuggestedPlayers);

  if (rankedPlayers.length === 0) {
    return {
      suggestedPlayerId: null,
      suggestedPlayerName: null,
      suggestedTeamId: null,
    };
  }

  const selected = rankedPlayers[0].player;
  return {
    suggestedPlayerId: selected.playerId ?? null,
    suggestedPlayerName: selected.playerName || selected.playerId || null,
    suggestedTeamId: selected.teamId ?? null,
  };
}

function resolvePlayersAlive(playersPacket, fightTeamIds, fallbackCount) {
  const sourcePlayers = Array.isArray(playersPacket?.players) ? playersPacket.players : [];
  const aliveCount = sourcePlayers.filter((player) => {
    if (!fightTeamIds.includes(player?.teamId)) {
      return false;
    }
    return player?.alive !== false;
  }).length;

  return aliveCount > 0 ? aliveCount : Math.max(0, Math.round(toFiniteNumber(fallbackCount, 0) || 0));
}

function compareRankedFights(left, right) {
  if (right.score !== left.score) {
    return right.score - left.score;
  }
  if (right.teamCount !== left.teamCount) {
    return right.teamCount - left.teamCount;
  }
  if (right.playersAlive !== left.playersAlive) {
    return right.playersAlive - left.playersAlive;
  }
  if (left.status !== right.status) {
    return left.status === "active" ? -1 : 1;
  }
  if (right.updatedAt !== left.updatedAt) {
    return right.updatedAt - left.updatedAt;
  }
  return compareIds(left.fightId, right.fightId);
}

function buildRankedFight({
  highlight,
  playersPacket,
  previousSuggestion,
  zonePacket,
  config,
  updatedAt,
}) {
  const confidence = clamp01(
    toFiniteNumber(
      highlight?.confidence ?? highlight?.renderConfidence ?? highlight?.baseConfidence,
      0,
    ) || 0,
  );
  const intensity = clamp01(
    toFiniteNumber(
      highlight?.intensity ?? highlight?.renderIntensity ?? highlight?.baseIntensity,
      0,
    ) || 0,
  );
  const teamIds = normalizeTeamIds(highlight?.teamIds);
  const teamCount = Math.max(1, teamIds.length);
  const playersAlive = resolvePlayersAlive(
    playersPacket,
    teamIds,
    highlight?.playersAlive,
  );
  const phase = resolvePhase(zonePacket);
  const zonePressure = computeZonePressure(zonePacket, highlight, config);
  const baseScore =
    confidence * (toFiniteNumber(config?.OBSERVER_ASSIST_CONFIDENCE_WEIGHT, 100) || 100) +
    Math.max(0, teamCount - 1) *
      (toFiniteNumber(config?.OBSERVER_ASSIST_TEAM_COUNT_WEIGHT, 24) || 24) +
    playersAlive * (toFiniteNumber(config?.OBSERVER_ASSIST_ALIVE_PLAYER_WEIGHT, 6) || 6) +
    phase * (toFiniteNumber(config?.OBSERVER_ASSIST_PHASE_WEIGHT, 5) || 5) +
    zonePressure.factor * (toFiniteNumber(config?.OBSERVER_ASSIST_ZONE_PRESSURE_WEIGHT, 14) || 14);
  const statusMultiplier = highlight?.status === "fading" ? 0.82 : 1;
  const score = Math.round(baseScore * statusMultiplier * 10) / 10;
  const suggestedPlayer = selectSuggestedPlayer(playersPacket, {
    fightId: highlight.id,
    teamIds,
    centerX: highlight.centerX,
    centerY: highlight.centerY,
    radius: highlight.radius,
  }, previousSuggestion);

  return {
    fightId: highlight.id,
    score,
    priorityLabel: buildPriorityLabel(score),
    teamIds,
    teamCount,
    confidence,
    intensity,
    playersAlive,
    phase,
    zonePressure: zonePressure.factor,
    zonePressureLabel: zonePressure.label,
    status: highlight?.status || "active",
    centerX: toFiniteNumber(highlight?.centerX, 0) || 0,
    centerY: toFiniteNumber(highlight?.centerY, 0) || 0,
    radius: Math.max(0, toFiniteNumber(highlight?.radius, 0) || 0),
    suggestedPlayerId: suggestedPlayer.suggestedPlayerId,
    suggestedPlayerName: suggestedPlayer.suggestedPlayerName,
    suggestedTeamId: suggestedPlayer.suggestedTeamId,
    lastRefreshedAt:
      toFiniteNumber(
        highlight?.lastSeenAt ?? highlight?.updatedAt ?? highlight?.firstSeenAt,
        updatedAt,
      ) || updatedAt,
    updatedAt: Math.max(
      toFiniteNumber(highlight?.updatedAt, 0) || 0,
      Number.isFinite(updatedAt) ? updatedAt : Date.now(),
    ),
  };
}

function buildSuggestionFromFight(fight, previousSuggestion, updatedAt) {
  return {
    fightId: fight.fightId,
    score: fight.score,
    displayScore: fight.displayScore,
    priorityLabel: fight.priorityLabel,
    reason: fight.reason,
    teamIds: [...fight.teamIds],
    suggestedPlayerId: fight.suggestedPlayerId ?? null,
    suggestedPlayerName: fight.suggestedPlayerName ?? null,
    suggestedTeamId: fight.suggestedTeamId ?? null,
    centerX: fight.centerX,
    centerY: fight.centerY,
    radius: fight.radius,
    status: fight.status,
    confidence: fight.confidence,
    phase: fight.phase,
    lastRefreshedAt: fight.lastRefreshedAt ?? updatedAt,
    updatedAt,
    selectedAt:
      previousSuggestion && previousSuggestion.fightId === fight.fightId
        ? previousSuggestion.selectedAt
        : updatedAt,
  };
}

function isSuggestionExpired(suggestion, updatedAt, config) {
  if (!suggestion) {
    return false;
  }

  const expiryMs = Math.max(
    2_500,
    Math.round(toFiniteNumber(config?.OBSERVER_ASSIST_SUGGESTION_EXPIRY_MS, 9_000) || 9_000),
  );
  const lastRefreshedAt =
    toFiniteNumber(suggestion.lastRefreshedAt ?? suggestion.updatedAt, 0) || 0;
  return lastRefreshedAt > 0 && updatedAt - lastRefreshedAt >= expiryMs;
}

function expireCurrentSuggestion(state, updatedAt, config, log) {
  const currentSuggestion = state.currentSuggestion;
  if (!currentSuggestion || !isSuggestionExpired(currentSuggestion, updatedAt, config)) {
    return false;
  }

  logOnce(
    state,
    `expired:${currentSuggestion.fightId}`,
    `[Assist] Suggestion expired fight=${currentSuggestion.fightId} ageMs=${Math.max(
      0,
      updatedAt -
        (toFiniteNumber(currentSuggestion.lastRefreshedAt ?? currentSuggestion.updatedAt, 0) ||
          updatedAt),
    )}`,
    updatedAt,
    log,
    1_000,
  );
  state.currentSuggestion = null;
  return true;
}

function chooseBestSuggestion(state, rankedFights, updatedAt, config, log) {
  const previousSuggestion = state.currentSuggestion;
  const suggestionExpired = expireCurrentSuggestion(state, updatedAt, config, log);
  const activeSuggestion = state.currentSuggestion;
  if (!Array.isArray(rankedFights) || rankedFights.length === 0) {
    if (activeSuggestion || previousSuggestion || suggestionExpired) {
      logOnce(
        state,
        "assist:fallback:no-fight",
        "[Assist] No active fight fallback",
        updatedAt,
        log,
        1_000,
      );
    }
    state.currentSuggestion = null;
    state.fallbackState = buildFallbackState(
      suggestionExpired ? "stale" : "idle",
      suggestionExpired ? "Scanning map for a fresh fight" : "Scanning map",
    );
    return null;
  }

  const topFight = rankedFights[0];
  state.fallbackState = null;
  if (!activeSuggestion) {
    const nextSuggestion = buildSuggestionFromFight(topFight, null, updatedAt);
    state.currentSuggestion = nextSuggestion;
    log(
      `[Assist] Best suggestion selected fight=${nextSuggestion.fightId} score=${Math.round(
        nextSuggestion.displayScore ?? nextSuggestion.score,
      )} reason=${nextSuggestion.reason}`,
    );
    if (nextSuggestion.suggestedPlayerId) {
      log(
        `[Assist] Suggested player updated fight=${nextSuggestion.fightId} player=${nextSuggestion.suggestedPlayerName} team=${nextSuggestion.suggestedTeamId}`,
      );
    }
    return nextSuggestion;
  }

  const currentFight =
    rankedFights.find((fight) => fight.fightId === activeSuggestion.fightId) || null;
  let selectedFight = topFight;
  const previousPlayer = findPlayerBySuggestion(state.playersPacket, activeSuggestion);
  const previousPlayerInvalid =
    activeSuggestion.suggestedPlayerId &&
    (!previousPlayer || !isPlayerStateEligibleForSuggestion(previousPlayer));
  let playerRecovered = false;
  const allowFightReplacementForPlayerRecovery =
    previousPlayerInvalid &&
    currentFight &&
    !currentFight.suggestedPlayerId &&
    topFight.fightId !== currentFight.fightId;

  if (currentFight && previousPlayerInvalid && currentFight.suggestedPlayerId) {
    selectedFight = currentFight;
    if (currentFight.suggestedPlayerId !== activeSuggestion.suggestedPlayerId) {
      playerRecovered = true;
      logOnce(
        state,
        `recovered:${currentFight.fightId}:${currentFight.suggestedPlayerId}`,
        `[Assist] Suggested player recovered fight=${currentFight.fightId} player=${currentFight.suggestedPlayerName} team=${currentFight.suggestedTeamId}`,
        updatedAt,
        log,
        1_000,
      );
    }
  }

  if (
    !allowFightReplacementForPlayerRecovery &&
    selectedFight === topFight &&
    currentFight &&
    topFight.fightId !== currentFight.fightId
  ) {
    const heldMs = Math.max(
      0,
      updatedAt - (toFiniteNumber(activeSuggestion.selectedAt, updatedAt) || updatedAt),
    );
    const scoreDelta = topFight.score - currentFight.score;
    const holdMs = Math.max(
      0,
      toFiniteNumber(config?.OBSERVER_ASSIST_MINIMUM_HOLD_MS, 7_000) || 7_000,
    );
    const replacementDelta = Math.max(
      0,
      toFiniteNumber(config?.OBSERVER_ASSIST_REPLACEMENT_DELTA_THRESHOLD, 22) || 22,
    );

    if (heldMs < holdMs || scoreDelta < replacementDelta) {
      selectedFight = currentFight;
      logOnce(
        state,
        `held:${currentFight.fightId}:${topFight.fightId}`,
        `[Assist] Suggestion held by hysteresis current=${currentFight.fightId} candidate=${topFight.fightId} delta=${scoreDelta.toFixed(
          1,
        )}`,
        updatedAt,
        log,
      );
    }
  }

  const nextSuggestion = buildSuggestionFromFight(
    selectedFight,
    activeSuggestion,
    updatedAt,
  );
  const fightChanged = activeSuggestion.fightId !== nextSuggestion.fightId;
  const playerChanged =
    activeSuggestion.suggestedPlayerId !== nextSuggestion.suggestedPlayerId ||
    activeSuggestion.suggestedTeamId !== nextSuggestion.suggestedTeamId;

  state.currentSuggestion = nextSuggestion;

  if (fightChanged) {
    log(
      `[Assist] Best suggestion selected fight=${nextSuggestion.fightId} score=${Math.round(
        nextSuggestion.displayScore ?? nextSuggestion.score,
      )} reason=${nextSuggestion.reason}`,
    );
  }
  if (playerChanged && nextSuggestion.suggestedPlayerId && !playerRecovered) {
    log(
      `[Assist] Suggested player updated fight=${nextSuggestion.fightId} player=${nextSuggestion.suggestedPlayerName} team=${nextSuggestion.suggestedTeamId}`,
    );
  }

  return nextSuggestion;
}

function createObserverAssistEngine({ config: configOverrides = null, log = () => {} } = {}) {
  const statesByMap = new Map();

  function ensureMapState(mapKey, resolvedConfig) {
    let state = statesByMap.get(mapKey);
    if (!state) {
      state = {
        combatMemory: createCombatMemoryStore({
          retentionMs: resolvedConfig.COMBAT_MEMORY_MS,
          maxHistory: resolvedConfig.MAX_COMBAT_HISTORY,
        }),
        currentSuggestion: null,
        fallbackState: buildFallbackState("idle"),
        latestAssist: null,
        latestConfig: resolvedConfig,
        logState: {
          recentLogAtByKey: new Map(),
          scoredFightStateById: new Map(),
        },
        presentationStateByFightId: new Map(),
        playersPacket: null,
        productionSupportSnapshot: null,
        zonePacket: null,
      };
      statesByMap.set(mapKey, state);
    }
    state.latestConfig = resolvedConfig;
    return state;
  }

  function recomputeSignalSnapshot(mapKey, mapDefinition, state, updatedAt) {
    const resolvedConfig = resolveObserverAssistConfig(mapDefinition, configOverrides);
    state.latestConfig = resolvedConfig;
    const players = state.playersPacket?.players ?? [];
    const teamSummaries = summarizeTeams(players, resolvedConfig);
    const combatEvents = state.combatMemory.getEvents(updatedAt);
    const teamProximities = detectTeamProximities(
      teamSummaries,
      resolvedConfig,
      updatedAt,
    );
    const hotZones = detectHotZones({
      teamSummaries,
      combatEvents,
      zone: state.zonePacket,
      config: resolvedConfig,
      updatedAt,
    });
    const focusCandidates = generateFocusCandidates({
      hotZones,
      combatEvents,
      zone: state.zonePacket,
      config: resolvedConfig,
      updatedAt,
    });
    const suggestionExpired = expireCurrentSuggestion(state, updatedAt, resolvedConfig, log);
    const previousSnapshot = state.latestAssist;
    const productionSupportUpdatedAt =
      toFiniteNumber(state.productionSupportSnapshot?.updatedAt, 0) || 0;
    const productionSupportExpired =
      productionSupportUpdatedAt > 0 &&
      updatedAt - productionSupportUpdatedAt >=
        Math.max(
          2_500,
          Math.round(
            toFiniteNumber(resolvedConfig?.OBSERVER_ASSIST_SUGGESTION_EXPIRY_MS, 9_000) || 9_000,
          ),
        );
    const persistedFallbackState =
      suggestionExpired || productionSupportExpired
        ? buildFallbackState("stale", "Scanning map for a fresh fight")
        : state.fallbackState || previousSnapshot?.fallbackState || buildFallbackState("idle");
    const latestAssist = {
      mapKey,
      updatedAt,
      hotZones,
      teamProximities,
      focusCandidates,
      combatEvents,
      recentCombatCount: combatEvents.length,
      activeFightCount: hotZones.filter(
        (hotZone) =>
          hotZone.recentCombatCount > 0 || hotZone.currentKnockedCount > 0,
      ).length,
      lastCombatAt: combatEvents.reduce(
        (latest, event) => Math.max(latest, event.timestamp),
        0,
      ) || null,
      bestSuggestion:
        suggestionExpired || productionSupportExpired ? null : state.currentSuggestion || null,
      rankedFights:
        suggestionExpired || productionSupportExpired ? [] : previousSnapshot?.rankedFights ?? [],
      fallbackState: persistedFallbackState,
      config: buildConfigSnapshot(resolvedConfig),
    };

    state.latestAssist = latestAssist;
    return cloneAssistSnapshot(latestAssist);
  }

  function applyZoneUpdate(zonePacket, mapDefinition) {
    const mapKey = normalizeMapKey(zonePacket?.mapKey);
    if (!mapKey || !mapDefinition) {
      return null;
    }

    const resolvedConfig = resolveObserverAssistConfig(mapDefinition, configOverrides);
    const state = ensureMapState(mapKey, resolvedConfig);
    state.zonePacket = zonePacket || null;
    return recomputeSignalSnapshot(
      mapKey,
      mapDefinition,
      state,
      zonePacket?.timestamp ?? Date.now(),
    );
  }

  function applyPlayerPositions(playersPacket, mapDefinition) {
    const mapKey = normalizeMapKey(playersPacket?.mapKey);
    if (!mapKey || !mapDefinition) {
      return null;
    }

    const resolvedConfig = resolveObserverAssistConfig(mapDefinition, configOverrides);
    const state = ensureMapState(mapKey, resolvedConfig);
    state.playersPacket = playersPacket || null;
    return recomputeSignalSnapshot(
      mapKey,
      mapDefinition,
      state,
      playersPacket?.timestamp ?? Date.now(),
    );
  }

  function applyCombatEvents({ mapKey, events, timestamp } = {}, mapDefinition) {
    const normalizedMapKey = normalizeMapKey(mapKey);
    if (!normalizedMapKey || !mapDefinition) {
      return null;
    }

    const resolvedConfig = resolveObserverAssistConfig(mapDefinition, configOverrides);
    const state = ensureMapState(normalizedMapKey, resolvedConfig);
    state.combatMemory.addMany(events, timestamp ?? Date.now());
    return recomputeSignalSnapshot(
      normalizedMapKey,
      mapDefinition,
      state,
      timestamp ?? Date.now(),
    );
  }

  function applyProductionSupport(productionSupportSnapshot, mapDefinition) {
    const mapKey = normalizeMapKey(productionSupportSnapshot?.mapKey);
    if (!mapKey || !mapDefinition) {
      return null;
    }

    const resolvedConfig = resolveObserverAssistConfig(mapDefinition, configOverrides);
    const state = ensureMapState(mapKey, resolvedConfig);
    state.latestConfig = resolvedConfig;
    state.productionSupportSnapshot = productionSupportSnapshot || null;

    const updatedAt =
      toFiniteNumber(productionSupportSnapshot?.updatedAt, Date.now()) || Date.now();
    const baseSnapshot =
      state.latestAssist || createEmptyAssistSnapshot(mapKey, resolvedConfig, updatedAt);
    const rankedFights = (Array.isArray(productionSupportSnapshot?.fightHighlights)
      ? productionSupportSnapshot.fightHighlights
      : []
    )
      .filter((highlight) => highlight && (highlight.status === "active" || highlight.status === "fading"))
      .map((highlight) =>
        buildRankedFight({
          highlight,
          playersPacket: state.playersPacket,
          previousSuggestion: state.currentSuggestion,
          zonePacket: state.zonePacket,
          config: resolvedConfig,
          updatedAt,
        }),
      )
      .map((fight) => applyStableFightPresentation(state, fight, updatedAt, log))
      .sort(compareRankedFights);
    cleanupPresentationState(
      state,
      rankedFights.map((fight) => fight.fightId),
    );

    cleanupScoredFightLogs(
      state,
      rankedFights.map((fight) => fight.fightId),
    );
    for (const fight of rankedFights) {
      logFightScore(state, fight, updatedAt, log);
    }

    const bestSuggestion = chooseBestSuggestion(
      state,
      rankedFights,
      updatedAt,
      resolvedConfig,
      log,
    );
    const maxRankedFights = Math.max(
      1,
      Math.round(toFiniteNumber(resolvedConfig.OBSERVER_ASSIST_MAX_RANKED_FIGHTS, 6) || 6),
    );

    state.latestAssist = {
      ...baseSnapshot,
      mapKey,
      updatedAt,
      bestSuggestion,
      rankedFights: rankedFights.slice(0, maxRankedFights),
      fallbackState: state.fallbackState || null,
      config: buildConfigSnapshot(resolvedConfig),
    };

    return cloneAssistSnapshot(state.latestAssist);
  }

  function get(mapKey) {
    const state = statesByMap.get(normalizeMapKey(mapKey));
    return cloneAssistSnapshot(state?.latestAssist ?? null);
  }

  function clear(mapKey) {
    if (!mapKey) {
      statesByMap.clear();
      return;
    }

    statesByMap.delete(normalizeMapKey(mapKey));
  }

  return {
    applyCombatEvents,
    applyPlayerPositions,
    applyProductionSupport,
    applyZoneUpdate,
    clear,
    get,
  };
}

module.exports = {
  createObserverAssistEngine,
};
