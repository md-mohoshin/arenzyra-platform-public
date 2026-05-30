"use strict";

const { createCameraRecommendationHistory } = require("./camera-recommendation-history.cjs");

function normalizeId(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function clamp01(value) {
  return clamp(value, 0, 1);
}

function roundConfidence(value) {
  return Math.round(clamp01(value) * 100) / 100;
}

function uniqueList(values) {
  return Array.from(new Set((Array.isArray(values) ? values : []).filter(Boolean)));
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

function cloneRecommendationHistoryEntry(entry) {
  return {
    action: entry.action,
    currentTargetId: entry.currentTargetId,
    recommendedTargetId: entry.recommendedTargetId,
    generatedAt: entry.generatedAt,
  };
}

function getTargetScore(target) {
  if (!target || typeof target !== "object") {
    return 0;
  }

  if (Number.isFinite(target.priority)) {
    return target.priority;
  }

  return Number.isFinite(target.score) ? target.score : 0;
}

function teamOverlapCount(leftTeamIds, rightTeamIds) {
  const left = new Set(Array.isArray(leftTeamIds) ? leftTeamIds.filter(Boolean) : []);
  let overlap = 0;

  for (const teamId of Array.isArray(rightTeamIds) ? rightTeamIds : []) {
    if (left.has(teamId)) {
      overlap += 1;
    }
  }

  return overlap;
}

function getRelevantAlertsForTarget(target, activeAlerts) {
  if (!target || !Array.isArray(activeAlerts) || activeAlerts.length === 0) {
    return [];
  }

  return activeAlerts.filter((alert) => teamOverlapCount(target.involvedTeamIds, alert.involvedTeamIds) > 0);
}

function analyzeTarget(target, activeAlerts, now, config, options = {}) {
  if (!target) {
    return {
      alerts: [],
      cooledDown: true,
      hasCriticalAlert: false,
      hasRecentCombatReason: false,
      hasWarningAlert: false,
      isCompelling: false,
      isZoneEdgeCritical: false,
      recentUpdateMs: Number.POSITIVE_INFINITY,
      score: 0,
      teamCount: 0,
      target,
      targetFoundInQueue: Boolean(options.targetFoundInQueue),
    };
  }

  const alerts = getRelevantAlertsForTarget(target, activeAlerts);
  const hasCriticalAlert = alerts.some((alert) => String(alert.severity || "").toLowerCase() === "critical");
  const hasWarningAlert = alerts.some((alert) => String(alert.severity || "").toLowerCase() === "warning");
  const hasRecentCombatReason = Array.isArray(target.reason)
    ? target.reason.some((entry) => /combat|knock|fight/i.test(String(entry || "")))
    : false;
  const isZoneEdgeCritical =
    target.category === "zone-edge" &&
    alerts.some(
      (alert) =>
        String(alert.type || "").toLowerCase() === "zone_edge_engagement" &&
        String(alert.severity || "").toLowerCase() === "critical",
    );
  const recentUpdateMs = Number.isFinite(target.updatedAt)
    ? Math.max(0, now - target.updatedAt)
    : Number.POSITIVE_INFINITY;
  const staleThresholdMs = Math.max(
    6_000,
    Math.round((config.MIN_WATCH_DWELL_MS ?? 8_000) * 1.2),
  );
  const cooledDown =
    !hasCriticalAlert &&
    !hasWarningAlert &&
    !hasRecentCombatReason &&
    recentUpdateMs > staleThresholdMs;
  const teamCount = Array.isArray(target.involvedTeamIds) ? target.involvedTeamIds.length : 0;

  return {
    alerts,
    cooledDown,
    hasCriticalAlert,
    hasRecentCombatReason,
    hasWarningAlert,
    isCompelling:
      hasCriticalAlert ||
      isZoneEdgeCritical ||
      teamCount >= 3 ||
      (hasWarningAlert && target.category === "zone-edge"),
    isZoneEdgeCritical,
    recentUpdateMs,
    score: getTargetScore(target),
    teamCount,
    target,
    targetFoundInQueue: Boolean(options.targetFoundInQueue),
  };
}

function describeCurrentTarget(signal) {
  const target = signal.target;
  if (!target) {
    return "no current watched target";
  }
  if (!signal.targetFoundInQueue) {
    return "current target cooled down";
  }
  if (signal.isZoneEdgeCritical) {
    return "current zone-edge engagement still active";
  }
  if (signal.teamCount >= 3) {
    return `current ${signal.teamCount}-team cluster still active`;
  }
  if (signal.hasCriticalAlert || signal.hasWarningAlert || signal.hasRecentCombatReason) {
    return "current fight still active";
  }
  if (!signal.cooledDown) {
    return "current target still competitive";
  }
  return "current target cooled down";
}

function describeCandidateTarget(signal) {
  const target = signal.target;
  if (!target) {
    return "no alternate target available";
  }
  if (signal.isZoneEdgeCritical) {
    return "zone-edge critical engagement";
  }
  if (signal.teamCount >= 3) {
    return `new higher-intensity ${signal.teamCount}-team cluster`;
  }
  if (signal.hasCriticalAlert) {
    return "new critical engagement";
  }
  if (signal.hasWarningAlert) {
    return "new high-priority engagement";
  }
  if (target.category === "zone-edge") {
    return "zone-edge engagement building";
  }
  if (target.category === "recent-combat") {
    return "recent combat hotspot building";
  }
  if (target.category === "cluster") {
    return "multi-team cluster building";
  }
  return "emerging higher-priority target";
}

function buildBackupTargetIds(watchTargets, excludedIds, limit = 3) {
  const excluded = new Set((Array.isArray(excludedIds) ? excludedIds : []).map(normalizeId).filter(Boolean));
  return (Array.isArray(watchTargets) ? watchTargets : [])
    .map((target) => normalizeId(target.id))
    .filter((id) => id && !excluded.has(id))
    .slice(0, limit);
}

function isFlapRisk(historyEntries, candidateId, currentTargetId, now, config) {
  const normalizedCandidateId = normalizeId(candidateId);
  const normalizedCurrentId = normalizeId(currentTargetId);
  if (!normalizedCandidateId || !normalizedCurrentId || normalizedCandidateId === normalizedCurrentId) {
    return false;
  }

  const windowMs = Math.max(
    4_000,
    Math.round(config.RECOMMENDATION_FLAP_WINDOW_MS ?? 16_000),
  );
  const candidateSequence = (Array.isArray(historyEntries) ? historyEntries : [])
    .filter(
      (entry) =>
        entry &&
        normalizeId(entry.recommendedTargetId) &&
        Number.isFinite(entry.generatedAt) &&
        now - entry.generatedAt <= windowMs,
    )
    .map((entry) => normalizeId(entry.recommendedTargetId));

  candidateSequence.push(normalizedCandidateId);
  const tail = candidateSequence.slice(-4);
  if (tail.length < 3) {
    return false;
  }

  const uniqueTargets = Array.from(new Set(tail));
  if (
    uniqueTargets.length !== 2 ||
    !uniqueTargets.includes(normalizedCandidateId) ||
    !uniqueTargets.includes(normalizedCurrentId)
  ) {
    return false;
  }

  for (let index = 1; index < tail.length; index += 1) {
    if (tail[index] === tail[index - 1]) {
      return false;
    }
  }

  for (let index = 2; index < tail.length; index += 1) {
    if (tail[index] !== tail[index - 2]) {
      return false;
    }
  }

  return true;
}

function buildConfidence({
  action,
  currentSignal,
  candidateSignal,
  scoreDelta,
  emergencySwitchEligible,
  switchBlockedByCooldown,
  switchBlockedByDwell,
  flapGuardActive,
}) {
  let confidence = action === "switch" ? 0.62 : action === "prepare" ? 0.56 : 0.68;

  if (!currentSignal.target && action === "switch") {
    confidence += 0.14;
  }
  if (Number.isFinite(scoreDelta)) {
    confidence += clamp(scoreDelta / 400, -0.12, 0.18);
  }
  if (candidateSignal.hasCriticalAlert || candidateSignal.isZoneEdgeCritical) {
    confidence += action === "stay" ? -0.08 : 0.08;
  }
  if (currentSignal.hasCriticalAlert && action === "stay") {
    confidence += 0.08;
  }
  if ((switchBlockedByDwell || switchBlockedByCooldown) && action === "prepare") {
    confidence += 0.05;
  }
  if (flapGuardActive && action !== "stay" && !emergencySwitchEligible) {
    confidence -= 0.12;
  }
  if (currentSignal.cooledDown && action === "stay") {
    confidence -= 0.16;
  }

  return roundConfidence(confidence);
}

function buildRecommendation({
  action,
  currentTarget,
  recommendedTarget,
  watchTargets,
  reasons,
  confidence,
  scoreDelta,
  generatedAt,
}) {
  return {
    action,
    currentTargetId: currentTarget ? currentTarget.id : null,
    recommendedTargetId:
      recommendedTarget && recommendedTarget.id
        ? recommendedTarget.id
        : action === "stay" && currentTarget
          ? currentTarget.id
          : null,
    backupTargetIds: buildBackupTargetIds(
      watchTargets,
      [
        currentTarget ? currentTarget.id : null,
        recommendedTarget ? recommendedTarget.id : null,
      ],
      3,
    ),
    confidence,
    reasons: uniqueList(reasons).slice(0, 3),
    scoreDelta: Number.isFinite(scoreDelta) ? Math.round(scoreDelta) : null,
    generatedAt,
  };
}

function createCameraAssistEngine() {
  const historyStore = createCameraRecommendationHistory();

  function evaluate({
    watchTargets,
    activeAlerts,
    operatorState,
    operatorDetails,
    updatedAt,
    config,
  } = {}) {
    const now = Number.isFinite(updatedAt) ? updatedAt : Date.now();
    const sourceTargets = Array.isArray(watchTargets) ? watchTargets : [];
    const sourceAlerts = Array.isArray(activeAlerts) ? activeAlerts : [];
    const currentWatchedTargetId = normalizeId(operatorState?.watchingNowTargetId);
    const currentTargetInQueue = currentWatchedTargetId
      ? sourceTargets.find((target) => target.id === currentWatchedTargetId) || null
      : null;
    const currentTarget =
      currentTargetInQueue ||
      (operatorDetails?.watchingNowTarget
        ? {
            ...operatorDetails.watchingNowTarget,
            priority: 0,
            score: 0,
            category: "watching",
            reason: [],
          }
        : null);
    const currentSetAt = Number.isFinite(operatorDetails?.watchingNowTarget?.setAt)
      ? operatorDetails.watchingNowTarget.setAt
      : null;

    historyStore.observeWatchedTarget(currentWatchedTargetId, currentSetAt, now);
    const historyBefore = historyStore.getState(now, config);

    const alternativeTargets = sourceTargets.filter((target) => target.id !== currentWatchedTargetId);
    const recommendedTarget = alternativeTargets.length > 0 ? alternativeTargets[0] : null;
    const currentSignal = analyzeTarget(
      currentTarget,
      sourceAlerts,
      now,
      config || {},
      {
        targetFoundInQueue: Boolean(currentTargetInQueue),
      },
    );
    const candidateSignal = analyzeTarget(
      recommendedTarget,
      sourceAlerts,
      now,
      config || {},
      {
        targetFoundInQueue: Boolean(recommendedTarget),
      },
    );
    const scoreDelta = recommendedTarget
      ? candidateSignal.score - currentSignal.score
      : null;
    const dwellStartedAt = Number.isFinite(currentSetAt)
      ? currentSetAt
      : historyBefore.lastSwitchAt;
    const dwellElapsedMs =
      currentWatchedTargetId && Number.isFinite(dwellStartedAt)
        ? Math.max(0, now - dwellStartedAt)
        : null;
    const dwellRemainingMs =
      currentWatchedTargetId && Number.isFinite(dwellElapsedMs)
        ? Math.max(0, (config.MIN_WATCH_DWELL_MS ?? 9_000) - dwellElapsedMs)
        : 0;
    const switchCooldownRemainingMs = Number.isFinite(historyBefore.lastSwitchAt)
      ? Math.max(0, historyBefore.lastSwitchAt + (config.SWITCH_COOLDOWN_MS ?? 7_000) - now)
      : 0;
    const switchBlockedByDwell = Boolean(currentWatchedTargetId && dwellRemainingMs > 0);
    const switchBlockedByCooldown = Boolean(currentWatchedTargetId && switchCooldownRemainingMs > 0);
    const emergencySwitchEligible = Boolean(
      currentWatchedTargetId &&
        recommendedTarget &&
        Number.isFinite(scoreDelta) &&
        scoreDelta >= (config.EMERGENCY_SWITCH_DELTA ?? 240),
    );
    const flapGuardActive = isFlapRisk(
      historyBefore.recentRecommendationHistory,
      recommendedTarget?.id,
      currentWatchedTargetId,
      now,
      config || {},
    );

    let recommendation;

    if (!currentWatchedTargetId) {
      if (!recommendedTarget) {
        recommendation = buildRecommendation({
          action: "stay",
          currentTarget: null,
          recommendedTarget: null,
          watchTargets: sourceTargets,
          reasons: ["no active watch targets"],
          confidence: 0.24,
          scoreDelta: null,
          generatedAt: now,
        });
      } else {
        recommendation = buildRecommendation({
          action: "switch",
          currentTarget: null,
          recommendedTarget,
          watchTargets: sourceTargets,
          reasons: [
            describeCandidateTarget(candidateSignal),
            "no watched target selected",
            ...candidateSignal.target.reason.slice(0, 1),
          ],
          confidence: buildConfidence({
            action: "switch",
            currentSignal,
            candidateSignal,
            scoreDelta: candidateSignal.score,
            emergencySwitchEligible: false,
            switchBlockedByCooldown: false,
            switchBlockedByDwell: false,
            flapGuardActive: false,
          }),
          scoreDelta: candidateSignal.score,
          generatedAt: now,
        });
      }
    } else if (!recommendedTarget) {
      recommendation = buildRecommendation({
        action: "stay",
        currentTarget,
        recommendedTarget: null,
        watchTargets: sourceTargets,
        reasons: [
          describeCurrentTarget(currentSignal),
          "no stronger alternative available",
        ],
        confidence: buildConfidence({
          action: "stay",
          currentSignal,
          candidateSignal,
          scoreDelta: null,
          emergencySwitchEligible,
          switchBlockedByCooldown,
          switchBlockedByDwell,
          flapGuardActive,
        }),
        scoreDelta: null,
        generatedAt: now,
      });
    } else {
      const prepareEligible = Boolean(
        (Number.isFinite(scoreDelta) &&
          scoreDelta >= (config.PREPARE_DELTA_THRESHOLD ?? 70)) ||
          candidateSignal.isCompelling,
      );
      const switchEligible = Boolean(
        Number.isFinite(scoreDelta) &&
          scoreDelta >= (config.SWITCH_DELTA_THRESHOLD ?? 130),
      );

      if (emergencySwitchEligible) {
        recommendation = buildRecommendation({
          action: "switch",
          currentTarget,
          recommendedTarget,
          watchTargets: sourceTargets,
          reasons: [
            describeCandidateTarget(candidateSignal),
            currentSignal.cooledDown
              ? "current target cooled down"
              : "alternative clearly exceeds the current fight",
            "emergency switch threshold exceeded",
          ],
          confidence: buildConfidence({
            action: "switch",
            currentSignal,
            candidateSignal,
            scoreDelta,
            emergencySwitchEligible,
            switchBlockedByCooldown,
            switchBlockedByDwell,
            flapGuardActive,
          }),
          scoreDelta,
          generatedAt: now,
        });
      } else if (switchBlockedByDwell || switchBlockedByCooldown) {
        recommendation = buildRecommendation({
          action: prepareEligible ? "prepare" : "stay",
          currentTarget,
          recommendedTarget: prepareEligible ? recommendedTarget : null,
          watchTargets: sourceTargets,
          reasons: prepareEligible
            ? [
                describeCandidateTarget(candidateSignal),
                switchBlockedByDwell
                  ? "minimum dwell window still active"
                  : "switch cooldown still active",
                describeCurrentTarget(currentSignal),
              ]
            : [
                describeCurrentTarget(currentSignal),
                switchBlockedByDwell
                  ? "minimum dwell window still active"
                  : "switch cooldown still active",
              ],
          confidence: buildConfidence({
            action: prepareEligible ? "prepare" : "stay",
            currentSignal,
            candidateSignal,
            scoreDelta,
            emergencySwitchEligible,
            switchBlockedByCooldown,
            switchBlockedByDwell,
            flapGuardActive,
          }),
          scoreDelta,
          generatedAt: now,
        });
      } else if (flapGuardActive && prepareEligible) {
        recommendation = buildRecommendation({
          action: "prepare",
          currentTarget,
          recommendedTarget,
          watchTargets: sourceTargets,
          reasons: [
            describeCandidateTarget(candidateSignal),
            "holding current target to avoid flip-flop",
            describeCurrentTarget(currentSignal),
          ],
          confidence: buildConfidence({
            action: "prepare",
            currentSignal,
            candidateSignal,
            scoreDelta,
            emergencySwitchEligible,
            switchBlockedByCooldown,
            switchBlockedByDwell,
            flapGuardActive,
          }),
          scoreDelta,
          generatedAt: now,
        });
      } else if (switchEligible) {
        recommendation = buildRecommendation({
          action: "switch",
          currentTarget,
          recommendedTarget,
          watchTargets: sourceTargets,
          reasons: [
            describeCandidateTarget(candidateSignal),
            currentSignal.cooledDown
              ? "current target cooled down"
              : "alternative clearly leads the queue",
            ...recommendedTarget.reason.slice(0, 1),
          ],
          confidence: buildConfidence({
            action: "switch",
            currentSignal,
            candidateSignal,
            scoreDelta,
            emergencySwitchEligible,
            switchBlockedByCooldown,
            switchBlockedByDwell,
            flapGuardActive,
          }),
          scoreDelta,
          generatedAt: now,
        });
      } else if (prepareEligible) {
        recommendation = buildRecommendation({
          action: "prepare",
          currentTarget,
          recommendedTarget,
          watchTargets: sourceTargets,
          reasons: [
            describeCandidateTarget(candidateSignal),
            currentSignal.cooledDown
              ? "current target cooled down"
              : describeCurrentTarget(currentSignal),
            "prepare next target early",
          ],
          confidence: buildConfidence({
            action: "prepare",
            currentSignal,
            candidateSignal,
            scoreDelta,
            emergencySwitchEligible,
            switchBlockedByCooldown,
            switchBlockedByDwell,
            flapGuardActive,
          }),
          scoreDelta,
          generatedAt: now,
        });
      } else {
        recommendation = buildRecommendation({
          action: "stay",
          currentTarget,
          recommendedTarget: null,
          watchTargets: sourceTargets,
          reasons: [
            describeCurrentTarget(currentSignal),
            "alternative not yet strong enough to justify a switch",
          ],
          confidence: buildConfidence({
            action: "stay",
            currentSignal,
            candidateSignal,
            scoreDelta,
            emergencySwitchEligible,
            switchBlockedByCooldown,
            switchBlockedByDwell,
            flapGuardActive,
          }),
          scoreDelta,
          generatedAt: now,
        });
      }
    }

    historyStore.recordRecommendation(recommendation, now, config);
    const history = historyStore.getState(now, config);

    return {
      recommendation,
      currentWatchedTargetId: currentWatchedTargetId ?? null,
      topWatchTargets: sourceTargets.slice(0, 5).map(cloneWatchTarget),
      activeAlerts: sourceAlerts.map(cloneAlert),
      observerState: {
        watchingNowTargetId: currentWatchedTargetId ?? null,
        primaryPinnedTeamIds: Array.isArray(operatorState?.primaryPinnedTeamIds)
          ? [...operatorState.primaryPinnedTeamIds]
          : [],
        primaryPinnedTargetIds: Array.isArray(operatorState?.primaryPinnedTargetIds)
          ? [...operatorState.primaryPinnedTargetIds]
          : [],
      },
      history: {
        lastSwitchAt: history.lastSwitchAt ?? null,
        previousTargetId: history.previousTargetId ?? null,
        lastAction: history.lastAction ?? null,
        recentRecommendationHistory: history.recentRecommendationHistory.map(
          cloneRecommendationHistoryEntry,
        ),
      },
      debug: {
        currentTargetScore: Math.round(currentSignal.score),
        recommendedTargetScore: Math.round(candidateSignal.score),
        scoreDelta: Number.isFinite(scoreDelta) ? Math.round(scoreDelta) : null,
        dwellElapsedMs: Number.isFinite(dwellElapsedMs) ? dwellElapsedMs : null,
        dwellRemainingMs,
        switchCooldownRemainingMs,
        switchBlockedByDwell,
        switchBlockedByCooldown,
        emergencySwitchEligible,
        flapGuardActive,
        currentTargetFoundInQueue: Boolean(currentTargetInQueue),
        lastSwitchAt: history.lastSwitchAt ?? null,
        previousTargetId: history.previousTargetId ?? null,
        lastAction: history.lastAction ?? null,
        lastRecommendationAt: history.lastRecommendationAt ?? null,
        recentRecommendationHistory: history.recentRecommendationHistory.map(
          cloneRecommendationHistoryEntry,
        ),
      },
      updatedAt: now,
    };
  }

  function getState(now = Date.now(), config = {}) {
    return historyStore.getState(now, config);
  }

  function resetHistory() {
    historyStore.reset();
  }

  return {
    evaluate,
    getState,
    resetHistory,
  };
}

module.exports = {
  createCameraAssistEngine,
};
