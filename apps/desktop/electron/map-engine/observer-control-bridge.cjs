"use strict";

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

function buildObserverControlSuggestion({
  watchTargets,
  activeAlerts,
  pinState,
  updatedAt,
} = {}) {
  const topWatchTargets = Array.isArray(watchTargets) ? watchTargets.slice(0, 5) : [];
  const alerts = Array.isArray(activeAlerts) ? activeAlerts : [];
  const suggestedFocus = topWatchTargets.length
    ? {
        x: topWatchTargets[0].centerX,
        y: topWatchTargets[0].centerY,
      }
    : null;

  return {
    topWatchTargets: topWatchTargets.map((target) => ({
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
    })),
    activeAlerts: alerts.map((alert) => ({
      id: alert.id,
      type: alert.type,
      severity: alert.severity,
      label: alert.label,
      centerX: alert.centerX,
      centerY: alert.centerY,
      involvedTeamIds: [...alert.involvedTeamIds],
      createdAt: alert.createdAt,
      expiresAt: alert.expiresAt,
    })),
    pinnedTeams: Array.isArray(pinState?.pinnedTeams) ? [...pinState.pinnedTeams] : [],
    suggestedFocusCenter: suggestedFocus,
    updatedAt: Number.isFinite(updatedAt) ? updatedAt : Date.now(),
  };
}

function buildObserverOperatorSuggestion({
  operatorState,
  operatorWorkflowState,
  replayCandidates,
  updatedAt,
} = {}) {
  return {
    watchingNowTargetId: operatorState?.watchingNowTargetId ?? null,
    replayCandidates: Array.isArray(replayCandidates)
      ? replayCandidates.map(cloneReplayCandidate)
      : [],
    suppressedTargetIds: Array.isArray(operatorState?.suppressedTargetIds)
      ? [...operatorState.suppressedTargetIds]
      : [],
    dismissedAlertIds: Array.isArray(operatorState?.dismissedAlertIds)
      ? [...operatorState.dismissedAlertIds]
      : [],
    primaryPinnedTeamIds: Array.isArray(operatorState?.primaryPinnedTeamIds)
      ? [...operatorState.primaryPinnedTeamIds]
      : [],
    primaryPinnedTargetIds: Array.isArray(operatorState?.primaryPinnedTargetIds)
      ? [...operatorState.primaryPinnedTargetIds]
      : [],
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
    updatedAt: Number.isFinite(updatedAt) ? updatedAt : Date.now(),
  };
}

module.exports = {
  buildObserverControlSuggestion,
  buildObserverOperatorSuggestion,
};
