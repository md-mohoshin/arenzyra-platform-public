"use strict";

const { createCameraAssistEngine } = require("./camera-assist-engine.cjs");
const { createFightHighlightEngine } = require("./fight-highlight-engine.cjs");
const { resolveObserverAssistConfig } = require("./observer-assist-config.cjs");
const {
  buildObserverControlSuggestion,
  buildObserverOperatorSuggestion,
} = require("./observer-control-bridge.cjs");
const { createOperatorActionStore } = require("./operator-action-store.cjs");
const { createOperatorWorkflowStore } = require("./operator-workflow-store.cjs");
const { createPinnedWatchStore } = require("./pinned-watch-store.cjs");
const { createProductionAlertEngine } = require("./production-alert-engine.cjs");
const { createReplayCandidateStore } = require("./replay-candidate-store.cjs");
const { createReplayMarkerStore } = require("./replay-marker-store.cjs");
const { selectFightAlertCandidate } = require("./fight-alert-detector.cjs");
const { detectTeamSplitRisks } = require("./team-split-risk-detector.cjs");
const { createTeamLabelResolver } = require("./team-label-resolver.cjs");
const { summarizeTeams } = require("./team-proximity-utils.cjs");
const { buildWatchTargetQueue, formatMatchup, formatTeamLabel } = require("./watch-target-queue.cjs");

const MAJOR_FIGHT_MARKER_COOLDOWN_MS = 30_000;
const MAJOR_FIGHT_MARKER_RESET_MS = 10_000;
const ZONE_CLOSING_MARKER_THRESHOLD_MS = 20_000;
const KILL_STREAK_WINDOW_MS = 15_000;
const MAX_SNAPSHOT_REPLAY_MARKERS = 20;

function uniqueList(values) {
  return Array.from(new Set((Array.isArray(values) ? values : []).filter(Boolean)));
}

function normalizeId(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function toFiniteNumber(value) {
  const numeric =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(numeric) ? numeric : null;
}

function compareIds(left, right) {
  return String(left || "").localeCompare(String(right || ""), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function formatOrdinal(value) {
  const numeric = Math.max(0, Math.round(toFiniteNumber(value) ?? 0));
  if (!numeric) {
    return null;
  }

  const mod100 = numeric % 100;
  if (mod100 >= 11 && mod100 <= 13) {
    return `${numeric}th`;
  }

  switch (numeric % 10) {
    case 1:
      return `${numeric}st`;
    case 2:
      return `${numeric}nd`;
    case 3:
      return `${numeric}rd`;
    default:
      return `${numeric}th`;
  }
}

function cloneWatchTarget(target) {
  return {
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
    operatorWatchingNow: Boolean(target.operatorWatchingNow),
    operatorPinned: Boolean(target.operatorPinned),
    operatorSuppressed: Boolean(target.operatorSuppressed),
    operatorReplayCandidate: Boolean(target.operatorReplayCandidate),
  };
}

function cloneAlert(alert) {
  return {
    id: alert.id,
    type: alert.type,
    severity: alert.severity,
    label: alert.label,
    centerX: alert.centerX,
    centerY: alert.centerY,
    involvedTeamIds: [...alert.involvedTeamIds],
    createdAt: alert.createdAt,
    expiresAt: alert.expiresAt,
    operatorReplayCandidate: Boolean(alert.operatorReplayCandidate),
  };
}

function cloneReplayCandidate(candidate) {
  return {
    id: candidate.id,
    sourceType: candidate.sourceType,
    sourceId: candidate.sourceId,
    label: candidate.label,
    centerX: candidate.centerX,
    centerY: candidate.centerY,
    involvedTeamIds: [...candidate.involvedTeamIds],
    createdAt: candidate.createdAt,
    expiresAt: candidate.expiresAt,
  };
}

function cloneReplayMarker(marker) {
  return {
    id: marker.id,
    timestamp: marker.timestamp,
    type: marker.type,
    description: marker.description,
    teams: Array.isArray(marker.teams) ? [...marker.teams] : undefined,
    players: Array.isArray(marker.players) ? [...marker.players] : undefined,
    map: marker.map ?? undefined,
  };
}

function cloneTeamSplitRisk(splitRisk) {
  return {
    teamId: splitRisk.teamId,
    spreadRadius: splitRisk.spreadRadius,
    severity: splitRisk.severity,
    centerX: splitRisk.centerX,
    centerY: splitRisk.centerY,
    updatedAt: splitRisk.updatedAt,
    activePlayerCount: splitRisk.activePlayerCount,
    nearestHotZoneId: splitRisk.nearestHotZoneId,
    nearestHotZoneDistance: splitRisk.nearestHotZoneDistance,
    distanceToZoneEdge: splitRisk.distanceToZoneEdge,
    isLateGame: splitRisk.isLateGame,
    isNearHotZone: splitRisk.isNearHotZone,
    isZoneEdgeDanger: splitRisk.isZoneEdgeDanger,
    inDangerContext: splitRisk.inDangerContext,
  };
}

function cloneFightAlertCandidate(candidate) {
  if (!candidate) {
    return null;
  }

  return {
    id: candidate.id,
    hotZoneId: candidate.hotZoneId ?? null,
    watchTargetId: candidate.watchTargetId ?? null,
    teamIds: [...(candidate.teamIds ?? [])],
    teamALabel: candidate.teamALabel ?? null,
    teamBLabel: candidate.teamBLabel ?? null,
    matchup: candidate.matchup ?? null,
    combatScore: candidate.combatScore ?? 0,
    combatThreshold: candidate.combatThreshold ?? 0,
    distance: candidate.distance ?? null,
    proximityRadius: candidate.proximityRadius ?? null,
    playersAlive: candidate.playersAlive ?? 0,
    centerX: candidate.centerX,
    centerY: candidate.centerY,
    recentCombatCount: candidate.recentCombatCount ?? 0,
    currentKnockedCount: candidate.currentKnockedCount ?? 0,
    severity: candidate.severity ?? "low",
    updatedAt: candidate.updatedAt ?? Date.now(),
  };
}

function cloneFightHighlight(highlight) {
  return {
    id: highlight.id,
    centerX: highlight.centerX,
    centerY: highlight.centerY,
    radius: highlight.radius,
    teamIds: [...highlight.teamIds],
    confidence: highlight.confidence,
    intensity: highlight.intensity,
    renderConfidence: highlight.renderConfidence ?? highlight.confidence,
    renderIntensity: highlight.renderIntensity ?? highlight.intensity,
    status: highlight.status,
    firstSeenAt: highlight.firstSeenAt,
    lastSeenAt: highlight.lastSeenAt,
    playersAlive: highlight.playersAlive ?? 0,
    sourcePairCount: highlight.sourcePairCount ?? 1,
    visible: Boolean(highlight.visible),
    priorityRank: highlight.priorityRank ?? null,
    updatedAt: highlight.updatedAt ?? Date.now(),
  };
}

function cloneOperatorState(operatorState) {
  return {
    watchingNowTargetId: operatorState.watchingNowTargetId ?? null,
    primaryPinnedTeamIds: [...operatorState.primaryPinnedTeamIds],
    primaryPinnedTargetIds: [...operatorState.primaryPinnedTargetIds],
    replayCandidateIds: [...operatorState.replayCandidateIds],
    dismissedAlertIds: [...operatorState.dismissedAlertIds],
    suppressedTargetIds: [...operatorState.suppressedTargetIds],
    updatedAt: operatorState.updatedAt,
  };
}

function cloneOperatorDetails(operatorDetails) {
  return {
    watchingNowTarget: operatorDetails.watchingNowTarget
      ? {
          ...operatorDetails.watchingNowTarget,
          involvedTeamIds: [...operatorDetails.watchingNowTarget.involvedTeamIds],
        }
      : null,
    suppressedTargets: operatorDetails.suppressedTargets.map((target) => ({
      ...target,
      involvedTeamIds: [...target.involvedTeamIds],
    })),
    dismissedAlerts: operatorDetails.dismissedAlerts.map((alert) => ({
      ...alert,
      involvedTeamIds: [...alert.involvedTeamIds],
    })),
    updatedAt: operatorDetails.updatedAt,
  };
}

function cloneOperatorWorkflowState(operatorWorkflowState) {
  return {
    selectedTargetId: operatorWorkflowState?.selectedTargetId ?? null,
    selectedAlertId: operatorWorkflowState?.selectedAlertId ?? null,
    highlightedTargetId: operatorWorkflowState?.highlightedTargetId ?? null,
    mapFocusCenter: operatorWorkflowState?.mapFocusCenter
      ? {
          x: operatorWorkflowState.mapFocusCenter.x,
          y: operatorWorkflowState.mapFocusCenter.y,
        }
      : null,
    mapFocusUntil: operatorWorkflowState?.mapFocusUntil ?? null,
    lastAction: operatorWorkflowState?.lastAction ?? null,
    updatedAt: operatorWorkflowState?.updatedAt ?? Date.now(),
  };
}

function cloneOperatorWorkflowConfig(operatorWorkflowConfig) {
  return {
    mapFocusHighlightMs: operatorWorkflowConfig?.mapFocusHighlightMs ?? null,
    operatorActionStatusMs: operatorWorkflowConfig?.operatorActionStatusMs ?? null,
    maxSelectableWatchTargets: operatorWorkflowConfig?.maxSelectableWatchTargets ?? null,
  };
}

function cloneObserverOperatorSuggestion(suggestion) {
  return {
    watchingNowTargetId: suggestion.watchingNowTargetId ?? null,
    replayCandidates: suggestion.replayCandidates.map(cloneReplayCandidate),
    suppressedTargetIds: [...suggestion.suppressedTargetIds],
    dismissedAlertIds: [...suggestion.dismissedAlertIds],
    primaryPinnedTeamIds: [...suggestion.primaryPinnedTeamIds],
    primaryPinnedTargetIds: [...suggestion.primaryPinnedTargetIds],
    selectedTargetId: suggestion.selectedTargetId ?? null,
    selectedAlertId: suggestion.selectedAlertId ?? null,
    highlightedTargetId: suggestion.highlightedTargetId ?? null,
    mapFocusCenter: suggestion.mapFocusCenter
      ? {
          x: suggestion.mapFocusCenter.x,
          y: suggestion.mapFocusCenter.y,
        }
      : null,
    mapFocusUntil: suggestion.mapFocusUntil ?? null,
    lastAction: suggestion.lastAction ?? null,
    updatedAt: suggestion.updatedAt,
  };
}

function cloneCameraAssistRecommendation(recommendation) {
  return {
    action: recommendation.action,
    currentTargetId: recommendation.currentTargetId ?? null,
    recommendedTargetId: recommendation.recommendedTargetId ?? null,
    backupTargetIds: [...recommendation.backupTargetIds],
    confidence: recommendation.confidence,
    reasons: [...recommendation.reasons],
    scoreDelta: recommendation.scoreDelta ?? null,
    generatedAt: recommendation.generatedAt,
  };
}

function cloneCameraAssistHistoryEntry(entry) {
  return {
    action: entry.action,
    currentTargetId: entry.currentTargetId ?? null,
    recommendedTargetId: entry.recommendedTargetId ?? null,
    generatedAt: entry.generatedAt,
  };
}

function cloneCameraAssistPayload(payload) {
  if (!payload) {
    return null;
  }

  return {
    recommendation: cloneCameraAssistRecommendation(payload.recommendation),
    currentWatchedTargetId: payload.currentWatchedTargetId ?? null,
    topWatchTargets: payload.topWatchTargets.map(cloneWatchTarget),
    activeAlerts: payload.activeAlerts.map(cloneAlert),
    observerState: {
      watchingNowTargetId: payload.observerState?.watchingNowTargetId ?? null,
      primaryPinnedTeamIds: [...(payload.observerState?.primaryPinnedTeamIds ?? [])],
      primaryPinnedTargetIds: [...(payload.observerState?.primaryPinnedTargetIds ?? [])],
    },
    history: {
      lastSwitchAt: payload.history?.lastSwitchAt ?? null,
      previousTargetId: payload.history?.previousTargetId ?? null,
      lastAction: payload.history?.lastAction ?? null,
      recentRecommendationHistory: Array.isArray(payload.history?.recentRecommendationHistory)
        ? payload.history.recentRecommendationHistory.map(cloneCameraAssistHistoryEntry)
        : [],
    },
    debug: payload.debug
      ? {
          ...payload.debug,
          recentRecommendationHistory: Array.isArray(payload.debug.recentRecommendationHistory)
            ? payload.debug.recentRecommendationHistory.map(cloneCameraAssistHistoryEntry)
            : [],
        }
      : null,
    updatedAt: payload.updatedAt,
  };
}

function getAlertReplayPriority(severity) {
  if (severity === "critical") {
    return 320;
  }
  if (severity === "warning") {
    return 220;
  }
  return 140;
}

function normalizeMapKey(value) {
  return String(value || "").trim().toLowerCase();
}

function getTargetDisplayRank(target) {
  if (target.operatorWatchingNow) {
    return 0;
  }
  if (target.operatorPinned && !target.operatorSuppressed) {
    return 1;
  }
  if (!target.operatorSuppressed) {
    return 2;
  }
  return 3;
}

function compareWatchTargets(left, right) {
  return (
    getTargetDisplayRank(left) - getTargetDisplayRank(right) ||
    right.priority - left.priority ||
    right.score - left.score ||
    String(left.id || "").localeCompare(String(right.id || ""), undefined, {
      numeric: true,
      sensitivity: "base",
    })
  );
}

function decorateWatchTargets(watchTargets, operatorState, replayCandidates, config, updatedAt) {
  const sourceTargets = Array.isArray(watchTargets) ? watchTargets : [];
  const suppressedIds = new Set(operatorState?.suppressedTargetIds || []);
  const pinnedTeamIds = new Set(operatorState?.primaryPinnedTeamIds || []);
  const pinnedTargetIds = new Set(operatorState?.primaryPinnedTargetIds || []);
  const replaySourceIds = new Set(
    (Array.isArray(replayCandidates) ? replayCandidates : []).map((candidate) => candidate.sourceId),
  );
  const watchingNowTargetId = operatorState?.watchingNowTargetId ?? null;
  const visibleTargets = [];

  for (const target of sourceTargets) {
    const isWatchingNow = watchingNowTargetId === target.id;
    const isPinned =
      pinnedTargetIds.has(target.id) ||
      target.involvedTeamIds.some((teamId) => pinnedTeamIds.has(teamId));
    const isSuppressed = suppressedIds.has(target.id);
    const isReplayCandidate = replaySourceIds.has(target.id);
    const decorated = {
      ...target,
      priority:
        target.priority +
        (isWatchingNow ? config?.WATCHING_NOW_PRIORITY_BOOST ?? 0 : 0) -
        (isSuppressed ? config?.SUPPRESSED_PRIORITY_PENALTY ?? 0 : 0),
      reason: uniqueList([
        ...(isWatchingNow ? ["Watching now"] : []),
        ...(isPinned ? ["Pinned by operator"] : []),
        ...(isReplayCandidate ? ["Replay candidate"] : []),
        ...(isSuppressed ? ["Suppressed by operator"] : []),
        ...target.reason,
      ]),
      updatedAt: Number.isFinite(updatedAt) ? updatedAt : target.updatedAt,
      operatorWatchingNow: isWatchingNow,
      operatorPinned: isPinned,
      operatorSuppressed: isSuppressed,
      operatorReplayCandidate: isReplayCandidate,
    };

    if (isSuppressed && !isPinned && !isWatchingNow) {
      continue;
    }

    visibleTargets.push(decorated);
  }

  return visibleTargets
    .sort(compareWatchTargets)
    .slice(0, config?.MAX_WATCH_TARGETS ?? 6);
}

function decorateActiveAlerts(activeAlerts, operatorState, replayCandidates) {
  const sourceAlerts = Array.isArray(activeAlerts) ? activeAlerts : [];
  const dismissedIds = new Set(operatorState?.dismissedAlertIds || []);
  const replaySourceIds = new Set(
    (Array.isArray(replayCandidates) ? replayCandidates : []).map((candidate) => candidate.sourceId),
  );

  return sourceAlerts
    .filter((alert) => !dismissedIds.has(alert.id))
    .map((alert) => ({
      ...alert,
      operatorReplayCandidate: replaySourceIds.has(alert.id),
    }));
}

function buildReplayCandidateFromTarget(target, now) {
  return {
    sourceType: "watch_target",
    sourceId: target.id,
    label: target.label,
    centerX: target.centerX,
    centerY: target.centerY,
    involvedTeamIds: target.involvedTeamIds,
    createdAt: now,
    priorityHint: Math.round(Number.isFinite(target.priority) ? target.priority : target.score || 0),
  };
}

function buildReplayCandidateFromAlert(alert, now) {
  return {
    sourceType: "alert",
    sourceId: alert.id,
    label: alert.label,
    centerX: alert.centerX,
    centerY: alert.centerY,
    involvedTeamIds: alert.involvedTeamIds,
    createdAt: now,
    priorityHint: getAlertReplayPriority(alert.severity),
  };
}

function createReplayMarkerState() {
  return {
    hasTeamBaseline: false,
    previousActiveTeams: new Map(),
    lastMajorFightAt: 0,
    lastMajorFightSeenAt: 0,
    lastMajorFightSignature: null,
    lastZoneClosingSignature: null,
    lastKillStreakSignatureBySource: new Map(),
  };
}

function captureActiveTeams(teamSummaries) {
  return new Map(
    (Array.isArray(teamSummaries) ? teamSummaries : [])
      .filter((summary) => normalizeId(summary?.teamId))
      .map((summary) => [
        summary.teamId,
        {
          teamId: summary.teamId,
          activePlayerCount: summary.activePlayerCount ?? 0,
          knockedCount: summary.knockedCount ?? 0,
        },
      ]),
  );
}

function buildTeamEliminationMarkers({
  replayMarkerStore,
  replayMarkerState,
  teamSummaries,
  mapKey,
  updatedAt,
  teamLabelResolver,
}) {
  const currentActiveTeams = captureActiveTeams(teamSummaries);

  if (!replayMarkerState.hasTeamBaseline) {
    if (currentActiveTeams.size > 0) {
      replayMarkerState.hasTeamBaseline = true;
      replayMarkerState.previousActiveTeams = currentActiveTeams;
    }
    return;
  }

  if (currentActiveTeams.size === 0) {
    replayMarkerState.hasTeamBaseline = false;
    replayMarkerState.previousActiveTeams = new Map();
    return;
  }

  const missingTeamIds = Array.from(replayMarkerState.previousActiveTeams.keys())
    .filter((teamId) => !currentActiveTeams.has(teamId))
    .sort(compareIds);

  if (missingTeamIds.length > 0 && missingTeamIds.length <= 4) {
    const placementStart = replayMarkerState.previousActiveTeams.size;

    missingTeamIds.forEach((teamId, index) => {
      const placementText = formatOrdinal(Math.max(1, placementStart - index));
      replayMarkerStore.addMarker(
        {
          timestamp: updatedAt,
          type: "TEAM_ELIMINATED",
          description: `${formatTeamLabel(teamId, teamLabelResolver)} eliminated${
            placementText ? ` - ${placementText} place` : ""
          }`,
          teams: [teamId],
          map: mapKey,
        },
        updatedAt,
      );
    });
  }

  replayMarkerState.previousActiveTeams = currentActiveTeams;
}

function buildKillStreakSourceKey(event) {
  const playerId = normalizeId(event?.killerPlayerId);
  const teamId = normalizeId(event?.killerTeamId);
  const killerName = normalizeId(event?.killerName);

  if (playerId && teamId) {
    return `player:${teamId}:${playerId}`;
  }
  if (playerId) {
    return `player:${playerId}`;
  }
  if (killerName && teamId) {
    return `name:${teamId}:${killerName.toLowerCase()}`;
  }
  if (killerName) {
    return `name:${killerName.toLowerCase()}`;
  }
  if (teamId) {
    return `team:${teamId}`;
  }
  return null;
}

function buildKillStreakLabel(event, teamLabelResolver = null) {
  return normalizeId(event?.killerName) || normalizeId(event?.killerPlayerId) || formatTeamLabel(event?.killerTeamId, teamLabelResolver) || "Unknown player";
}

function compareKillStreakCandidates(left, right) {
  return (
    right.killCount - left.killCount ||
    right.windowEnd - left.windowEnd ||
    right.windowStart - left.windowStart ||
    String(left.sourceKey || "").localeCompare(String(right.sourceKey || ""), undefined, {
      numeric: true,
      sensitivity: "base",
    })
  );
}

function detectKillStreakCandidate(combatEvents, teamLabelResolver = null) {
  const killsBySource = new Map();

  for (const event of Array.isArray(combatEvents) ? combatEvents : []) {
    if (event?.kind !== "kill") {
      continue;
    }

    const sourceKey = buildKillStreakSourceKey(event);
    if (!sourceKey) {
      continue;
    }

    let entries = killsBySource.get(sourceKey);
    if (!entries) {
      entries = [];
      killsBySource.set(sourceKey, entries);
    }
    entries.push(event);
  }

  const candidates = [];
  for (const [sourceKey, kills] of killsBySource.entries()) {
    kills.sort((left, right) => left.timestamp - right.timestamp);
    let windowStartIndex = 0;

    for (let index = 0; index < kills.length; index += 1) {
      while (
        windowStartIndex < index &&
        kills[index].timestamp - kills[windowStartIndex].timestamp > KILL_STREAK_WINDOW_MS
      ) {
        windowStartIndex += 1;
      }

      const killCount = index - windowStartIndex + 1;
      if (killCount < 3) {
        continue;
      }

      const firstKill = kills[windowStartIndex];
      const latestKill = kills[index];
      candidates.push({
        sourceKey,
        signature: `${sourceKey}:${firstKill.timestamp}:${latestKill.timestamp}:${killCount}`,
        killCount,
        label: buildKillStreakLabel(latestKill, teamLabelResolver),
        playerId: normalizeId(latestKill.killerPlayerId),
        teamId: normalizeId(latestKill.killerTeamId),
        windowStart: firstKill.timestamp,
        windowEnd: latestKill.timestamp,
      });
    }
  }

  candidates.sort(compareKillStreakCandidates);
  return candidates[0] || null;
}

function buildReplayMarkers({
  replayMarkerStore,
  replayMarkerState,
  assistSnapshot,
  fightAlertCandidate,
  teamSummaries,
  zonePacket,
  mapKey,
  updatedAt,
  teamLabelResolver,
}) {
  buildTeamEliminationMarkers({
    replayMarkerStore,
    replayMarkerState,
    teamSummaries,
    mapKey,
    updatedAt,
    teamLabelResolver,
  });

  if (fightAlertCandidate?.teamIds?.length >= 2) {
    const signature =
      normalizeId(fightAlertCandidate.id) ||
      normalizeId(fightAlertCandidate.watchTargetId) ||
      uniqueList(fightAlertCandidate.teamIds).sort(compareIds).join("|");

    replayMarkerState.lastMajorFightSeenAt = updatedAt;
    if (
      signature &&
      (replayMarkerState.lastMajorFightSignature !== signature ||
        updatedAt - replayMarkerState.lastMajorFightAt >= MAJOR_FIGHT_MARKER_COOLDOWN_MS)
    ) {
      replayMarkerStore.addMarker(
        {
          timestamp: updatedAt,
          type: "MAJOR_FIGHT",
          description: fightAlertCandidate.matchup || formatMatchup(fightAlertCandidate.teamIds, teamLabelResolver),
          teams: fightAlertCandidate.teamIds,
          map: mapKey,
        },
        updatedAt,
      );
      replayMarkerState.lastMajorFightSignature = signature;
      replayMarkerState.lastMajorFightAt = updatedAt;
    }
  } else if (
    replayMarkerState.lastMajorFightSignature &&
    updatedAt - replayMarkerState.lastMajorFightSeenAt >= MAJOR_FIGHT_MARKER_RESET_MS
  ) {
    replayMarkerState.lastMajorFightSignature = null;
  }

  const remainingMs =
    toFiniteNumber(zonePacket?.timeRemainingMs) ??
    (toFiniteNumber(zonePacket?.timeRemaining) !== null
      ? Math.round(toFiniteNumber(zonePacket?.timeRemaining) * 1000)
      : null);
  if (remainingMs !== null && remainingMs > ZONE_CLOSING_MARKER_THRESHOLD_MS) {
    replayMarkerState.lastZoneClosingSignature = null;
  }
  if (
    remainingMs !== null &&
    remainingMs > 0 &&
    remainingMs <= ZONE_CLOSING_MARKER_THRESHOLD_MS
  ) {
    const phase = toFiniteNumber(zonePacket?.phase);
    const targetEndAt = toFiniteNumber(zonePacket?.targetEndAt);
    const signature = targetEndAt !== null ? `${phase ?? "?"}:${targetEndAt}` : `${phase ?? "?"}`;

    if (signature !== replayMarkerState.lastZoneClosingSignature) {
      replayMarkerStore.addMarker(
        {
          timestamp: updatedAt,
          type: "ZONE_CLOSING",
          description: `Zone closes in ${Math.max(1, Math.ceil(remainingMs / 1000))}s`,
          map: mapKey,
        },
        updatedAt,
      );
      replayMarkerState.lastZoneClosingSignature = signature;
    }
  }

  const killStreakCandidate = detectKillStreakCandidate(
    assistSnapshot?.combatEvents,
    teamLabelResolver,
  );
  const activeKillStreakKeys = new Set(
    (Array.isArray(assistSnapshot?.combatEvents) ? assistSnapshot.combatEvents : [])
      .map(buildKillStreakSourceKey)
      .filter(Boolean),
  );

  for (const sourceKey of replayMarkerState.lastKillStreakSignatureBySource.keys()) {
    if (!activeKillStreakKeys.has(sourceKey)) {
      replayMarkerState.lastKillStreakSignatureBySource.delete(sourceKey);
    }
  }

  if (killStreakCandidate) {
    const previousSignature =
      replayMarkerState.lastKillStreakSignatureBySource.get(killStreakCandidate.sourceKey) || null;

    if (previousSignature !== killStreakCandidate.signature) {
      replayMarkerStore.addMarker(
        {
          timestamp: updatedAt,
          type: "KILL_STREAK",
          description: `${killStreakCandidate.label} - ${killStreakCandidate.killCount} kills in 15s`,
          teams: killStreakCandidate.teamId ? [killStreakCandidate.teamId] : [],
          players: uniqueList([
            killStreakCandidate.playerId || killStreakCandidate.label,
          ]),
          map: mapKey,
        },
        updatedAt,
      );
      replayMarkerState.lastKillStreakSignatureBySource.set(
        killStreakCandidate.sourceKey,
        killStreakCandidate.signature,
      );
    }
  }
}

function findTargetById(state, id) {
  const normalizedId = normalizeId(id);
  if (!normalizedId || !state) {
    return null;
  }

  const operatorDetails = state.operatorActionStore.getDetails();
  const collections = [
    state.rawWatchTargets,
    state.latestSnapshot?.watchTargets,
    state.latestSnapshot?.pinState?.pinnedTargets,
    operatorDetails.suppressedTargets,
    operatorDetails.watchingNowTarget ? [operatorDetails.watchingNowTarget] : [],
  ];

  for (const collection of collections) {
    const match = (Array.isArray(collection) ? collection : []).find((target) => target.id === normalizedId);
    if (match) {
      return match;
    }
  }

  return null;
}

function findAlertById(state, id) {
  const normalizedId = normalizeId(id);
  if (!normalizedId || !state) {
    return null;
  }

  const operatorDetails = state.operatorActionStore.getDetails();
  const collections = [
    state.rawActiveAlerts,
    state.latestSnapshot?.activeAlerts,
    operatorDetails.dismissedAlerts,
  ];

  for (const collection of collections) {
    const match = (Array.isArray(collection) ? collection : []).find((alert) => alert.id === normalizedId);
    if (match) {
      return match;
    }
  }

  return null;
}

function findReplayCandidateById(state, id) {
  const normalizedId = normalizeId(id);
  if (!normalizedId || !state) {
    return null;
  }

  const candidates = Array.isArray(state.latestSnapshot?.replayCandidates)
    ? state.latestSnapshot.replayCandidates
    : [];

  return (
    candidates.find((candidate) => candidate.id === normalizedId) ||
    candidates.find((candidate) => candidate.sourceId === normalizedId) ||
    null
  );
}

function cloneProductionSupportSnapshot(snapshot) {
  if (!snapshot) {
    return null;
  }

  return {
    mapKey: snapshot.mapKey,
    updatedAt: snapshot.updatedAt,
    watchTargets: snapshot.watchTargets.map(cloneWatchTarget),
    fightHighlights: (snapshot.fightHighlights ?? []).map(cloneFightHighlight),
    fightAlertCandidate: cloneFightAlertCandidate(snapshot.fightAlertCandidate),
    activeAlerts: snapshot.activeAlerts.map(cloneAlert),
    teamSplitRisks: snapshot.teamSplitRisks.map(cloneTeamSplitRisk),
    replayMarkers: snapshot.replayMarkers.map(cloneReplayMarker),
    pinState: {
      pinnedTeams: [...snapshot.pinState.pinnedTeams],
      pinnedTargetIds: [...snapshot.pinState.pinnedTargetIds],
      pinnedTargets: snapshot.pinState.pinnedTargets.map((target) => ({
        ...target,
        involvedTeamIds: [...target.involvedTeamIds],
        reason: [...target.reason],
      })),
    },
    operatorState: cloneOperatorState(snapshot.operatorState),
    operatorDetails: cloneOperatorDetails(snapshot.operatorDetails),
    operatorWorkflowState: cloneOperatorWorkflowState(snapshot.operatorWorkflowState),
    operatorWorkflowConfig: cloneOperatorWorkflowConfig(snapshot.operatorWorkflowConfig),
    replayCandidates: snapshot.replayCandidates.map(cloneReplayCandidate),
    cameraAssistPayload: cloneCameraAssistPayload(snapshot.cameraAssistPayload),
    observerControlSuggestion: {
      ...snapshot.observerControlSuggestion,
      topWatchTargets: snapshot.observerControlSuggestion.topWatchTargets.map(cloneWatchTarget),
      activeAlerts: snapshot.observerControlSuggestion.activeAlerts.map(cloneAlert),
      pinnedTeams: [...snapshot.observerControlSuggestion.pinnedTeams],
      suggestedFocusCenter: snapshot.observerControlSuggestion.suggestedFocusCenter
        ? { ...snapshot.observerControlSuggestion.suggestedFocusCenter }
        : null,
    },
    observerOperatorSuggestion: cloneObserverOperatorSuggestion(
      snapshot.observerOperatorSuggestion,
    ),
  };
}

function buildOperatorWorkflowConfig(config) {
  return {
    mapFocusHighlightMs: config?.MAP_FOCUS_HIGHLIGHT_MS ?? 4_500,
    operatorActionStatusMs: config?.OPERATOR_ACTION_STATUS_MS ?? 3_800,
    maxSelectableWatchTargets: config?.MAX_SELECTABLE_WATCH_TARGETS ?? 5,
  };
}

function createProductionSupportEngine({ config: configOverrides = null, log = () => {} } = {}) {
  const statesByMap = new Map();
  const pinnedWatchStore = createPinnedWatchStore();
  const replayMarkerStore = createReplayMarkerStore();
  const teamLabels = createTeamLabelResolver();
  const resolveTeamLabel = (teamId) => teamLabels.resolve(teamId);

  function ensureMapState(mapKey) {
    let state = statesByMap.get(mapKey);
    if (!state) {
      state = {
        alertEngine: createProductionAlertEngine(),
        assistSnapshot: null,
        cameraAssistEngine: createCameraAssistEngine(),
        fightHighlightEngine: createFightHighlightEngine({ log }),
        latestSnapshot: null,
        operatorActionStore: createOperatorActionStore(),
        operatorWorkflowStore: createOperatorWorkflowStore(),
        playersPacket: null,
        rawActiveAlerts: [],
        rawWatchTargets: [],
        replayCandidateStore: createReplayCandidateStore(),
        replayMarkerState: createReplayMarkerState(),
        zonePacket: null,
      };
      statesByMap.set(mapKey, state);
    }
    return state;
  }

  function recompute(mapKey, mapDefinition, updatedAt) {
    const normalizedMapKey = normalizeMapKey(mapKey);
    if (!normalizedMapKey || !mapDefinition) {
      return null;
    }

    const state = ensureMapState(normalizedMapKey);
    const config = resolveObserverAssistConfig(mapDefinition, configOverrides);
    const teamSummaries = summarizeTeams(state.playersPacket?.players ?? [], config);
    const teamSplitRisks = detectTeamSplitRisks({
      teamSummaries,
      hotZones: state.assistSnapshot?.hotZones ?? [],
      zone: state.zonePacket,
      config,
      updatedAt,
    });
    const fightHighlights = state.fightHighlightEngine.evaluate({
      assistSnapshot: state.assistSnapshot,
      config,
      mapKey: normalizedMapKey,
      teamSummaries,
      updatedAt,
    });
    const pinState = pinnedWatchStore.getState();
    const rawWatchTargets = buildWatchTargetQueue({
      focusCandidates: state.assistSnapshot?.focusCandidates ?? [],
      hotZones: state.assistSnapshot?.hotZones ?? [],
      teamProximities: state.assistSnapshot?.teamProximities ?? [],
      teamSummaries,
      teamSplitRisks,
      teamLabelResolver: resolveTeamLabel,
      pinState,
      mapKey: normalizedMapKey,
      config,
      updatedAt,
    });

    pinnedWatchStore.updatePinnedTargets(normalizedMapKey, rawWatchTargets);
    const refreshedPinState = pinnedWatchStore.getState();
    const rawActiveAlerts = state.alertEngine.evaluate({
      assistSnapshot: state.assistSnapshot,
      teamSplitRisks,
      zone: state.zonePacket,
      config,
      updatedAt,
      teamLabelResolver: resolveTeamLabel,
    });
    const replayCandidates = state.replayCandidateStore.getCandidates(config, updatedAt);

    state.operatorActionStore.refreshFromSnapshot({
      watchTargets: rawWatchTargets,
      activeAlerts: rawActiveAlerts,
      pinState: refreshedPinState,
      replayCandidates,
      updatedAt,
    });

    const operatorState = state.operatorActionStore.getState(updatedAt);
    const operatorDetails = state.operatorActionStore.getDetails(updatedAt);
    const watchTargets = decorateWatchTargets(
      rawWatchTargets,
      operatorState,
      replayCandidates,
      config,
      updatedAt,
    );
    const fightAlertCandidate = selectFightAlertCandidate({
      watchTargets: rawWatchTargets,
      assistSnapshot: state.assistSnapshot,
      teamSummaries,
      config,
      updatedAt,
      teamLabelResolver: resolveTeamLabel,
    });
    const activeAlerts = decorateActiveAlerts(
      rawActiveAlerts,
      operatorState,
      replayCandidates,
    );
    buildReplayMarkers({
      replayMarkerStore,
      replayMarkerState: state.replayMarkerState,
      assistSnapshot: state.assistSnapshot,
      fightAlertCandidate,
      teamSummaries,
      zonePacket: state.zonePacket,
      mapKey: normalizedMapKey,
      updatedAt,
      teamLabelResolver: resolveTeamLabel,
    });
    const replayMarkers = replayMarkerStore.getMarkers(
      {
        mapKey: normalizedMapKey,
        limit: MAX_SNAPSHOT_REPLAY_MARKERS,
      },
      updatedAt,
    );
    const cameraAssistPayload = state.cameraAssistEngine.evaluate({
      watchTargets,
      activeAlerts,
      operatorState,
      operatorDetails,
      updatedAt,
      config,
    });
    state.operatorWorkflowStore.refreshFromSnapshot({
      watchTargets,
      activeAlerts,
      pinState: refreshedPinState,
      operatorDetails,
      cameraAssistPayload,
      updatedAt,
    });
    const operatorWorkflowState = state.operatorWorkflowStore.getState(updatedAt);
    const observerControlSuggestion = buildObserverControlSuggestion({
      watchTargets,
      activeAlerts,
      pinState: refreshedPinState,
      updatedAt,
    });
    const observerOperatorSuggestion = buildObserverOperatorSuggestion({
      operatorState,
      operatorWorkflowState,
      replayCandidates,
      updatedAt,
    });

    state.rawWatchTargets = rawWatchTargets;
    state.rawActiveAlerts = rawActiveAlerts;
    state.latestSnapshot = {
      mapKey: normalizedMapKey,
      updatedAt,
      watchTargets,
      fightHighlights,
      fightAlertCandidate,
      activeAlerts,
      teamSplitRisks,
      replayMarkers,
      pinState: refreshedPinState,
      operatorState,
      operatorDetails,
      operatorWorkflowState,
      operatorWorkflowConfig: buildOperatorWorkflowConfig(config),
      replayCandidates,
      cameraAssistPayload,
      observerControlSuggestion,
      observerOperatorSuggestion,
    };

    return cloneProductionSupportSnapshot(state.latestSnapshot);
  }

  function setZoneUpdate(zonePacket, mapDefinition) {
    const mapKey = normalizeMapKey(zonePacket?.mapKey);
    if (!mapKey || !mapDefinition) {
      return null;
    }

    const state = ensureMapState(mapKey);
    state.zonePacket = zonePacket || null;
    return null;
  }

  function setPlayerPositions(playersPacket, mapDefinition) {
    const mapKey = normalizeMapKey(playersPacket?.mapKey);
    if (!mapKey || !mapDefinition) {
      return null;
    }

    const state = ensureMapState(mapKey);
    state.playersPacket = playersPacket || null;
    return null;
  }

  function applyObserverAssist(assistSnapshot, mapDefinition) {
    const mapKey = normalizeMapKey(assistSnapshot?.mapKey);
    if (!mapKey || !mapDefinition) {
      return null;
    }

    const state = ensureMapState(mapKey);
    state.assistSnapshot = assistSnapshot || null;
    return recompute(mapKey, mapDefinition, assistSnapshot?.updatedAt ?? Date.now());
  }

  function get(mapKey) {
    const state = statesByMap.get(normalizeMapKey(mapKey));
    return cloneProductionSupportSnapshot(state?.latestSnapshot ?? null);
  }

  function getReplayMarkers(mapKey = null, limit = MAX_SNAPSHOT_REPLAY_MARKERS) {
    return replayMarkerStore.getMarkers(
      {
        mapKey: mapKey ? normalizeMapKey(mapKey) : null,
        limit,
      },
      Date.now(),
    );
  }

  function getPinState() {
    return pinnedWatchStore.getState();
  }

  function resetCameraAssistHistory(mapDefinition, mapKeyHint = null) {
    const mapKey = normalizeMapKey(mapKeyHint || mapDefinition?.key);
    if (!mapKey || !mapDefinition) {
      return null;
    }

    const state = ensureMapState(mapKey);
    state.cameraAssistEngine.resetHistory();
    return recompute(mapKey, mapDefinition, Date.now());
  }

  function watchNowTargetById(id, mapDefinition, mapKeyHint = null) {
    const mapKey = normalizeMapKey(mapKeyHint || mapDefinition?.key);
    const state = statesByMap.get(mapKey);
    const target = findTargetById(state, id);
    if (!target) {
      return null;
    }

    const now = Date.now();
    state.operatorActionStore.watchNow(target, now);
    state.operatorWorkflowStore.noteTargetAction(target, `Watching ${target.label}`, now);
    return recompute(mapKey, mapDefinition, now);
  }

  function pinTeam(teamId, mapDefinition, mapKeyHint = null) {
    const didPin = pinnedWatchStore.pinTeam(teamId);
    if (!didPin) {
      return null;
    }

    const mapKey = normalizeMapKey(mapKeyHint || mapDefinition?.key);
    const state = ensureMapState(mapKey);
    const now = Date.now();
    state.operatorActionStore.pinTeam(teamId, now);
    state.operatorWorkflowStore.noteAction(`Pinned team ${teamId}`, now);
    return recompute(mapKey, mapDefinition, now);
  }

  function unpinTeam(teamId, mapDefinition, mapKeyHint = null) {
    pinnedWatchStore.unpinTeam(teamId);
    const mapKey = normalizeMapKey(mapKeyHint || mapDefinition?.key);
    const state = ensureMapState(mapKey);
    const now = Date.now();
    state.operatorActionStore.unpinTeam(teamId, now);
    state.operatorWorkflowStore.noteAction(`Unpinned team ${teamId}`, now);
    return recompute(mapKey, mapDefinition, now);
  }

  function pinTargetById(id, mapDefinition, mapKeyHint = null) {
    const mapKey = normalizeMapKey(mapKeyHint || mapDefinition?.key);
    const state = statesByMap.get(mapKey);
    const target = findTargetById(state, id);
    if (!target) {
      return null;
    }

    pinnedWatchStore.pinTarget({
      ...target,
      mapKey,
    });
    const now = Date.now();
    state.operatorActionStore.pinTarget(target, now);
    state.operatorWorkflowStore.noteTargetAction(target, `Pinned ${target.label}`, now);
    return recompute(mapKey, mapDefinition, now);
  }

  function unpinTarget(id, mapDefinition, mapKeyHint = null) {
    pinnedWatchStore.unpinTarget(id);
    const mapKey = normalizeMapKey(mapKeyHint || mapDefinition?.key);
    const state = ensureMapState(mapKey);
    const now = Date.now();
    const target = findTargetById(state, id);
    state.operatorActionStore.unpinTarget(id, now);
    if (target) {
      state.operatorWorkflowStore.noteTargetAction(target, `Unpinned ${target.label}`, now);
    } else {
      state.operatorWorkflowStore.noteAction(`Unpinned target ${id}`, now);
    }
    return recompute(mapKey, mapDefinition, now);
  }

  function markReplayById(id, mapDefinition, mapKeyHint = null) {
    const mapKey = normalizeMapKey(mapKeyHint || mapDefinition?.key);
    const state = statesByMap.get(mapKey);
    if (!state) {
      return null;
    }

    const now = Date.now();
    const config = resolveObserverAssistConfig(mapDefinition, configOverrides);
    const target = findTargetById(state, id);
    if (target) {
      state.replayCandidateStore.addCandidate(
        buildReplayCandidateFromTarget(target, now),
        config,
        now,
      );
      state.operatorWorkflowStore.noteTargetAction(
        target,
        `Marked replay ${target.label}`,
        now,
      );
      return recompute(mapKey, mapDefinition, now);
    }

    const alert = findAlertById(state, id);
    if (!alert) {
      return null;
    }

    state.replayCandidateStore.addCandidate(
      buildReplayCandidateFromAlert(alert, now),
      config,
      now,
    );
    state.operatorWorkflowStore.noteAlertAction(alert, `Marked replay ${alert.label}`, now);
    return recompute(mapKey, mapDefinition, now);
  }

  function unmarkReplayById(id, mapDefinition, mapKeyHint = null) {
    const mapKey = normalizeMapKey(mapKeyHint || mapDefinition?.key);
    const state = statesByMap.get(mapKey);
    if (!state) {
      return null;
    }

    const replayCandidate = findReplayCandidateById(state, id);
    const target = replayCandidate ? findTargetById(state, replayCandidate.sourceId) : findTargetById(state, id);
    const alert = replayCandidate ? findAlertById(state, replayCandidate.sourceId) : findAlertById(state, id);
    const removed = state.replayCandidateStore.removeCandidateBySourceId(id);
    if (!removed) {
      return null;
    }

    const now = Date.now();
    if (target) {
      state.operatorWorkflowStore.noteTargetAction(
        target,
        `Removed replay ${target.label}`,
        now,
      );
    } else if (alert) {
      state.operatorWorkflowStore.noteAlertAction(alert, `Removed replay ${alert.label}`, now);
    } else if (replayCandidate) {
      state.operatorWorkflowStore.noteAction(`Removed replay ${replayCandidate.label}`, now);
    }

    return recompute(mapKey, mapDefinition, now);
  }

  function suppressTargetById(id, mapDefinition, mapKeyHint = null) {
    const mapKey = normalizeMapKey(mapKeyHint || mapDefinition?.key);
    const state = statesByMap.get(mapKey);
    const target = findTargetById(state, id);
    if (!target) {
      return null;
    }

    const config = resolveObserverAssistConfig(mapDefinition, configOverrides);
    const now = Date.now();
    state.operatorActionStore.suppressTarget(
      target,
      config.TARGET_SUPPRESSION_MS,
      now,
      config,
    );
    state.operatorWorkflowStore.noteTargetAction(target, `Suppressed ${target.label}`, now);
    return recompute(mapKey, mapDefinition, now);
  }

  function unsuppressTarget(id, mapDefinition, mapKeyHint = null) {
    const mapKey = normalizeMapKey(mapKeyHint || mapDefinition?.key);
    const state = ensureMapState(mapKey);
    const target = findTargetById(state, id);
    const now = Date.now();
    const didUnsuppress = state.operatorActionStore.unsuppressTarget(id, now);
    if (!didUnsuppress) {
      return null;
    }

    if (target) {
      state.operatorWorkflowStore.noteTargetAction(
        target,
        `Unsuppressed ${target.label}`,
        now,
      );
    } else {
      state.operatorWorkflowStore.noteAction(`Unsuppressed target ${id}`, now);
    }

    return recompute(mapKey, mapDefinition, now);
  }

  function dismissAlertById(id, mapDefinition, mapKeyHint = null) {
    const mapKey = normalizeMapKey(mapKeyHint || mapDefinition?.key);
    const state = statesByMap.get(mapKey);
    const alert = findAlertById(state, id);
    if (!alert) {
      return null;
    }

    const config = resolveObserverAssistConfig(mapDefinition, configOverrides);
    const now = Date.now();
    const didDismiss = state.operatorActionStore.dismissAlert(alert, now, config);
    if (!didDismiss) {
      return null;
    }

    state.operatorWorkflowStore.noteAlertAction(alert, `Dismissed ${alert.label}`, now);
    return recompute(mapKey, mapDefinition, now);
  }

  function undismissAlertById(id, mapDefinition, mapKeyHint = null) {
    const mapKey = normalizeMapKey(mapKeyHint || mapDefinition?.key);
    const state = ensureMapState(mapKey);
    const alert = findAlertById(state, id);
    const now = Date.now();
    const didUndismiss = state.operatorActionStore.undismissAlert(id, now);
    if (!didUndismiss) {
      return null;
    }

    if (alert) {
      state.operatorWorkflowStore.noteAlertAction(alert, `Restored ${alert.label}`, now);
    } else {
      state.operatorWorkflowStore.noteAction(`Restored alert ${id}`, now);
    }

    return recompute(mapKey, mapDefinition, now);
  }

  function selectTargetById(id, mapDefinition, mapKeyHint = null) {
    const mapKey = normalizeMapKey(mapKeyHint || mapDefinition?.key);
    const state = statesByMap.get(mapKey);
    const target = findTargetById(state, id);
    if (!target) {
      return null;
    }

    const now = Date.now();
    state.operatorWorkflowStore.selectTarget(target, now);
    return recompute(mapKey, mapDefinition, now);
  }

  function selectAlertById(id, mapDefinition, mapKeyHint = null) {
    const mapKey = normalizeMapKey(mapKeyHint || mapDefinition?.key);
    const state = statesByMap.get(mapKey);
    const alert = findAlertById(state, id);
    if (!alert) {
      return null;
    }

    const now = Date.now();
    state.operatorWorkflowStore.selectAlert(alert, now);
    return recompute(mapKey, mapDefinition, now);
  }

  function centerTargetById(id, mapDefinition, mapKeyHint = null) {
    const mapKey = normalizeMapKey(mapKeyHint || mapDefinition?.key);
    const state = statesByMap.get(mapKey);
    const target = findTargetById(state, id);
    if (!target) {
      return null;
    }

    const now = Date.now();
    const config = resolveObserverAssistConfig(mapDefinition, configOverrides);
    state.operatorWorkflowStore.focusTarget(
      target,
      config.MAP_FOCUS_HIGHLIGHT_MS,
      now,
      `Centered ${target.label}`,
    );
    return recompute(mapKey, mapDefinition, now);
  }

  function centerAlertById(id, mapDefinition, mapKeyHint = null) {
    const mapKey = normalizeMapKey(mapKeyHint || mapDefinition?.key);
    const state = statesByMap.get(mapKey);
    const alert = findAlertById(state, id);
    if (!alert) {
      return null;
    }

    const now = Date.now();
    const config = resolveObserverAssistConfig(mapDefinition, configOverrides);
    const didFocus = state.operatorWorkflowStore.focusAlert(
      alert,
      config.MAP_FOCUS_HIGHLIGHT_MS,
      now,
      `Centered alert ${alert.label}`,
    );
    if (!didFocus) {
      return null;
    }
    return recompute(mapKey, mapDefinition, now);
  }

  function centerReplayCandidateById(id, mapDefinition, mapKeyHint = null) {
    const mapKey = normalizeMapKey(mapKeyHint || mapDefinition?.key);
    const state = statesByMap.get(mapKey);
    const replayCandidate = findReplayCandidateById(state, id);
    if (!replayCandidate) {
      return null;
    }

    const now = Date.now();
    const config = resolveObserverAssistConfig(mapDefinition, configOverrides);
    const didFocus = state.operatorWorkflowStore.focusReplayCandidate(
      replayCandidate,
      config.MAP_FOCUS_HIGHLIGHT_MS,
      now,
      `Centered replay ${replayCandidate.label}`,
    );
    if (!didFocus) {
      return null;
    }
    return recompute(mapKey, mapDefinition, now);
  }

  function acceptCameraRecommendation(mapDefinition, mapKeyHint = null) {
    const mapKey = normalizeMapKey(mapKeyHint || mapDefinition?.key);
    const state = statesByMap.get(mapKey);
    const recommendation = state?.latestSnapshot?.cameraAssistPayload?.recommendation || null;
    if (
      !recommendation ||
      recommendation.action === "stay" ||
      !normalizeId(recommendation.recommendedTargetId)
    ) {
      return null;
    }

    const target = findTargetById(state, recommendation.recommendedTargetId);
    if (!target) {
      return null;
    }

    const now = Date.now();
    const config = resolveObserverAssistConfig(mapDefinition, configOverrides);
    state.operatorActionStore.watchNow(target, now);
    state.operatorWorkflowStore.acceptRecommendation(
      target,
      config.MAP_FOCUS_HIGHLIGHT_MS,
      recommendation.action,
      now,
    );
    return recompute(mapKey, mapDefinition, now);
  }

  function setTeamBranding(update) {
    teamLabels.setTeamBranding(update);
  }

  function refresh(mapDefinition, mapKeyHint = null) {
    const mapKey = normalizeMapKey(mapKeyHint || mapDefinition?.key);
    if (!mapKey || !mapDefinition || !statesByMap.has(mapKey)) {
      return null;
    }

    return recompute(mapKey, mapDefinition, Date.now());
  }

  function clear(mapKey = null) {
    const normalizedMapKey = normalizeMapKey(mapKey);
    if (!normalizedMapKey) {
      statesByMap.clear();
      pinnedWatchStore.clear();
      replayMarkerStore.clear();
      return;
    }

    statesByMap.delete(normalizedMapKey);
    replayMarkerStore.clear(normalizedMapKey);
  }

  return {
    acceptCameraRecommendation,
    applyObserverAssist,
    clear,
    centerAlertById,
    centerReplayCandidateById,
    centerTargetById,
    dismissAlertById,
    get,
    getPinState,
    getReplayMarkers,
    markReplayById,
    pinTargetById,
    pinTeam,
    refresh,
    resetCameraAssistHistory,
    selectAlertById,
    selectTargetById,
    setPlayerPositions,
    setTeamBranding,
    setZoneUpdate,
    suppressTargetById,
    undismissAlertById,
    unmarkReplayById,
    unpinTarget,
    unpinTeam,
    unsuppressTarget,
    watchNowTargetById,
  };
}

module.exports = {
  createProductionSupportEngine,
};
