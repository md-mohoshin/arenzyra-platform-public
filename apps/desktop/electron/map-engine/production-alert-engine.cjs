"use strict";

const { formatMatchup, formatTeamLabel } = require("./watch-target-queue.cjs");

function buildSpatialKey(centerX, centerY) {
  if (!Number.isFinite(centerX) || !Number.isFinite(centerY)) {
    return "na";
  }

  return `${Math.round(centerX / 7500)}:${Math.round(centerY / 7500)}`;
}

function buildAlertKey(type, involvedTeamIds, centerX, centerY) {
  const teamKey = Array.isArray(involvedTeamIds)
    ? involvedTeamIds
        .filter(Boolean)
        .sort((left, right) =>
          String(left).localeCompare(String(right), undefined, {
            numeric: true,
            sensitivity: "base",
          }),
        )
        .join("|")
    : "";

  return `${type}:${teamKey}:${buildSpatialKey(centerX, centerY)}`;
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
  };
}

function createProductionAlertEngine() {
  let alertCounter = 0;
  const lastTriggeredByKey = new Map();
  const previousHotZonesById = new Map();
  const activeAlerts = [];

  function purgeExpired(now) {
    let writeIndex = 0;

    for (let readIndex = 0; readIndex < activeAlerts.length; readIndex += 1) {
      const alert = activeAlerts[readIndex];
      if (
        alert.expiresAt !== null &&
        Number.isFinite(alert.expiresAt) &&
        alert.expiresAt <= now
      ) {
        continue;
      }

      activeAlerts[writeIndex] = alert;
      writeIndex += 1;
    }

    activeAlerts.length = writeIndex;
  }

  function emitAlert(candidate, config, now) {
    const key = buildAlertKey(
      candidate.type,
      candidate.involvedTeamIds,
      candidate.centerX,
      candidate.centerY,
    );
    const lastTriggeredAt = lastTriggeredByKey.get(key) ?? 0;
    if (now - lastTriggeredAt < (config?.ALERT_COOLDOWN_MS ?? 0)) {
      return null;
    }

    lastTriggeredByKey.set(key, now);

    const expiryBase = config?.ALERT_EXPIRY_MS ?? 0;
    const expiresAt =
      candidate.expiresAt === null
        ? null
        : now +
          Math.round(
            candidate.severity === "critical"
              ? expiryBase * 1.35
              : candidate.severity === "warning"
                ? expiryBase
                : expiryBase * 0.8,
          );

    const alert = {
      id: `alert:${now}:${alertCounter += 1}`,
      type: candidate.type,
      severity: candidate.severity,
      label: candidate.label,
      centerX: Number.isFinite(candidate.centerX) ? candidate.centerX : undefined,
      centerY: Number.isFinite(candidate.centerY) ? candidate.centerY : undefined,
      involvedTeamIds: Array.isArray(candidate.involvedTeamIds)
        ? candidate.involvedTeamIds.filter(Boolean)
        : [],
      createdAt: now,
      expiresAt,
    };

    activeAlerts.unshift(alert);
    if (activeAlerts.length > (config?.MAX_ACTIVE_ALERTS ?? 18)) {
      activeAlerts.length = config.MAX_ACTIVE_ALERTS;
    }

    return alert;
  }

  function evaluate({
    assistSnapshot,
    teamSplitRisks,
    zone,
    config,
    updatedAt,
  } = {}) {
    const now = Number.isFinite(updatedAt) ? updatedAt : Date.now();
    const hotZones = Array.isArray(assistSnapshot?.hotZones) ? assistSnapshot.hotZones : [];
    const splitRisks = Array.isArray(teamSplitRisks) ? teamSplitRisks : [];
    const zonePhase = Number.isFinite(zone?.phase) ? zone.phase : null;
    const finalCirclePhaseThreshold = config?.FINAL_CIRCLE_PHASE_THRESHOLD ?? 7;

    purgeExpired(now);

    for (const hotZone of hotZones) {
      const previousHotZone = previousHotZonesById.get(hotZone.id) || null;
      const teamCount = hotZone.involvedTeamIds.length;
      const activeCombat = hotZone.recentCombatCount > 0 || hotZone.currentKnockedCount > 0;
      const nearZoneEdge =
        hotZone.distanceToZoneEdge !== null &&
        hotZone.distanceToZoneEdge <= (config?.ZONE_EDGE_BAND ?? 0);

      if (hotZone.score >= (config?.HIGH_RISK_FIGHT_SCORE ?? 150) && activeCombat) {
        emitAlert(
          {
            type: "high_risk_fight",
            severity:
              hotZone.currentKnockedCount >= (config?.KNOCK_SPIKE_THRESHOLD ?? 2) ||
              hotZone.recentKillCount >= 2 ||
              hotZone.score >= (config?.HIGH_RISK_FIGHT_SCORE ?? 150) + 30
                ? "critical"
                : "warning",
            label: `High risk fight: ${formatMatchup(hotZone.involvedTeamIds)}`,
            centerX: hotZone.centerX,
            centerY: hotZone.centerY,
            involvedTeamIds: hotZone.involvedTeamIds,
          },
          config,
          now,
        );
      }

      if (teamCount >= 3) {
        emitAlert(
          {
            type: "multi_team_convergence",
            severity: teamCount >= 4 ? "critical" : "warning",
            label: `${teamCount}-team convergence: ${formatMatchup(hotZone.involvedTeamIds)}`,
            centerX: hotZone.centerX,
            centerY: hotZone.centerY,
            involvedTeamIds: hotZone.involvedTeamIds,
          },
          config,
          now,
        );
      }

      if (activeCombat && nearZoneEdge) {
        emitAlert(
          {
            type: "zone_edge_engagement",
            severity: hotZone.score >= (config?.HIGH_RISK_FIGHT_SCORE ?? 150) ? "critical" : "warning",
            label: `Zone edge engagement: ${formatMatchup(hotZone.involvedTeamIds)}`,
            centerX: hotZone.centerX,
            centerY: hotZone.centerY,
            involvedTeamIds: hotZone.involvedTeamIds,
          },
          config,
          now,
        );
      }

      if (zonePhase !== null && zonePhase >= finalCirclePhaseThreshold && teamCount >= 2) {
        emitAlert(
          {
            type: "final_circle_cluster",
            severity: teamCount >= 3 ? "critical" : "warning",
            label: `Final circle cluster: ${formatMatchup(hotZone.involvedTeamIds)}`,
            centerX: hotZone.centerX,
            centerY: hotZone.centerY,
            involvedTeamIds: hotZone.involvedTeamIds,
          },
          config,
          now,
        );
      }

      const knockIncrease =
        hotZone.currentKnockedCount - (previousHotZone?.currentKnockedCount ?? 0);
      if (
        hotZone.currentKnockedCount >= (config?.KNOCK_SPIKE_THRESHOLD ?? 2) &&
        knockIncrease > 0
      ) {
        emitAlert(
          {
            type: "knock_spike",
            severity:
              hotZone.currentKnockedCount >= (config?.KNOCK_SPIKE_THRESHOLD ?? 2) + 1
                ? "critical"
                : "warning",
            label: `Knock spike: ${hotZone.currentKnockedCount} downs in ${formatMatchup(
              hotZone.involvedTeamIds,
            )}`,
            centerX: hotZone.centerX,
            centerY: hotZone.centerY,
            involvedTeamIds: hotZone.involvedTeamIds,
          },
          config,
          now,
        );
      }

      if (
        previousHotZone &&
        (previousHotZone.recentCombatCount ?? 0) === 0 &&
        hotZone.recentCombatCount > 0
      ) {
        emitAlert(
          {
            type: "recent_combat_reignite",
            severity: hotZone.recentCombatCount >= 2 ? "warning" : "info",
            label: `Combat reignites: ${formatMatchup(hotZone.involvedTeamIds)}`,
            centerX: hotZone.centerX,
            centerY: hotZone.centerY,
            involvedTeamIds: hotZone.involvedTeamIds,
          },
          config,
          now,
        );
      }
    }

    for (const splitRisk of splitRisks) {
      if (
        !splitRisk.inDangerContext ||
        (splitRisk.severity !== "medium" && splitRisk.severity !== "high")
      ) {
        continue;
      }

      emitAlert(
        {
          type: "team_split_risk",
          severity: splitRisk.severity === "high" ? "critical" : "warning",
          label: `${formatTeamLabel(splitRisk.teamId)} split wide under pressure`,
          centerX: splitRisk.centerX,
          centerY: splitRisk.centerY,
          involvedTeamIds: [splitRisk.teamId],
        },
        config,
        now,
      );
    }

    previousHotZonesById.clear();
    for (const hotZone of hotZones) {
      previousHotZonesById.set(hotZone.id, {
        currentKnockedCount: hotZone.currentKnockedCount,
        recentCombatCount: hotZone.recentCombatCount,
      });
    }

    const severityWeight = {
      critical: 3,
      warning: 2,
      info: 1,
    };

    activeAlerts.sort((left, right) => {
      const severityDelta =
        (severityWeight[right.severity] || 0) - (severityWeight[left.severity] || 0);
      if (severityDelta !== 0) {
        return severityDelta;
      }
      return right.createdAt - left.createdAt;
    });

    return activeAlerts.map(cloneAlert);
  }

  return {
    evaluate,
  };
}

module.exports = {
  createProductionAlertEngine,
};
