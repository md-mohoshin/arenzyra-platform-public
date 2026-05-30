"use strict";

function toFiniteNumber(value, fallback) {
  const numeric =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(numeric) ? numeric : fallback;
}

const DEFAULT_OBSERVER_ASSIST_CONFIG = Object.freeze({
  // Ratio-based thresholds resolve against the current map world size.
  HOT_ZONE_TEAM_RADIUS: 0.06,
  PROXIMITY_RADIUS: 0.048,
  TEAM_STRAGGLER_RADIUS: 0.018,
  HOT_ZONE_RADIUS_PADDING: 0.012,
  COMBAT_CLUSTER_RADIUS: 0.026,
  ZONE_EDGE_BAND: 0.032,
  COMBAT_MEMORY_MS: 30_000,
  MAX_COMBAT_HISTORY: 90,
  MAX_FOCUS_CANDIDATES: 5,
  MAX_WATCH_TARGETS: 6,
  ALERT_COOLDOWN_MS: 18_000,
  ALERT_EXPIRY_MS: 22_000,
  TEAM_SPLIT_RADIUS_THRESHOLD: 0.034,
  TEAM_SPLIT_MEDIUM_FACTOR: 1.35,
  TEAM_SPLIT_HIGH_FACTOR: 1.8,
  FINAL_CIRCLE_PHASE_THRESHOLD: 7,
  WATCH_TARGET_DEDUPE_RADIUS: 0.022,
  PINNED_PRIORITY_BOOST: 260,
  WATCHING_NOW_PRIORITY_BOOST: 520,
  SUPPRESSED_PRIORITY_PENALTY: 320,
  MAX_ACTIVE_ALERTS: 18,
  MAX_SUPPRESSED_TARGETS: 18,
  MAX_DISMISSED_ALERTS: 24,
  KNOCK_SPIKE_THRESHOLD: 2,
  HIGH_RISK_FIGHT_SCORE: 150,
  TARGET_SUPPRESSION_MS: 45_000,
  REPLAY_CANDIDATE_TTL_MS: 180_000,
  MAX_REPLAY_CANDIDATES: 10,
  MIN_WATCH_DWELL_MS: 9_000,
  SWITCH_COOLDOWN_MS: 7_000,
  PREPARE_DELTA_THRESHOLD: 70,
  SWITCH_DELTA_THRESHOLD: 130,
  EMERGENCY_SWITCH_DELTA: 240,
  RECOMMENDATION_FLAP_WINDOW_MS: 16_000,
  MAX_CAMERA_RECOMMENDATION_HISTORY: 10,
  MAP_FOCUS_HIGHLIGHT_MS: 4_500,
  OPERATOR_ACTION_STATUS_MS: 3_800,
  MAX_SELECTABLE_WATCH_TARGETS: 5,
  PROXIMITY_HIGH_FACTOR: 0.55,
  PROXIMITY_MEDIUM_FACTOR: 0.82,
  FIGHT_HIGHLIGHT_RADIUS: 0.054,
  FIGHT_HIGHLIGHT_MERGE_DISTANCE: 0.026,
  FIGHT_HIGHLIGHT_MATCH_DISTANCE: 0.03,
  FIGHT_HIGHLIGHT_ACTIVATION_TICKS: 3,
  FIGHT_HIGHLIGHT_FADE_HOLD_MS: 4_500,
  FIGHT_HIGHLIGHT_CANDIDATE_TTL_MS: 1_800,
  FIGHT_HIGHLIGHT_MIN_PLAYERS: 2,
  FIGHT_HIGHLIGHT_HIGH_CONFIDENCE: 0.9,
  MAX_FIGHT_HIGHLIGHTS: 4,
  MAX_VISIBLE_FIGHT_HIGHLIGHTS: 3,
  FIGHT_HIGHLIGHT_CENTER_SMOOTHING: 0.62,
  FIGHT_HIGHLIGHT_RADIUS_SMOOTHING: 0.68,
  FIGHT_HIGHLIGHT_CENTER_JITTER_RATIO: 0.075,
  FIGHT_HIGHLIGHT_RADIUS_JITTER_RATIO: 0.09,
  FIGHT_HIGHLIGHT_CENTER_SNAP_RATIO: 0.55,
  FIGHT_HIGHLIGHT_RADIUS_SNAP_RATIO: 0.42,
  OBSERVER_ASSIST_CONFIDENCE_WEIGHT: 100,
  OBSERVER_ASSIST_TEAM_COUNT_WEIGHT: 24,
  OBSERVER_ASSIST_ALIVE_PLAYER_WEIGHT: 6,
  OBSERVER_ASSIST_PHASE_WEIGHT: 5,
  OBSERVER_ASSIST_ZONE_PRESSURE_WEIGHT: 14,
  OBSERVER_ASSIST_MINIMUM_HOLD_MS: 7_000,
  OBSERVER_ASSIST_REPLACEMENT_DELTA_THRESHOLD: 22,
  OBSERVER_ASSIST_MAX_RANKED_FIGHTS: 6,
  OBSERVER_ASSIST_SUGGESTION_EXPIRY_MS: 9_000,
  OBSERVER_ASSIST_SCORE_DISPLAY_STEP: 5,
});

function resolveObserverAssistConfig(mapDefinition, overrides = {}) {
  const worldSize = Math.max(1, toFiniteNumber(mapDefinition?.worldSize, 1));
  const base = {
    ...DEFAULT_OBSERVER_ASSIST_CONFIG,
    ...(overrides && typeof overrides === "object" ? overrides : {}),
  };

  const hotZoneTeamRadius = Math.max(7_500, worldSize * toFiniteNumber(base.HOT_ZONE_TEAM_RADIUS, 0.06));
  const proximityRadius = Math.max(6_500, worldSize * toFiniteNumber(base.PROXIMITY_RADIUS, 0.048));

  return Object.freeze({
    HOT_ZONE_TEAM_RADIUS: hotZoneTeamRadius,
    PROXIMITY_RADIUS: proximityRadius,
    TEAM_STRAGGLER_RADIUS: Math.max(
      5_500,
      worldSize * toFiniteNumber(base.TEAM_STRAGGLER_RADIUS, 0.018),
    ),
    HOT_ZONE_RADIUS_PADDING: Math.max(
      4_000,
      worldSize * toFiniteNumber(base.HOT_ZONE_RADIUS_PADDING, 0.012),
    ),
    COMBAT_CLUSTER_RADIUS: Math.max(
      6_000,
      worldSize * toFiniteNumber(base.COMBAT_CLUSTER_RADIUS, 0.026),
    ),
    ZONE_EDGE_BAND: Math.max(5_000, worldSize * toFiniteNumber(base.ZONE_EDGE_BAND, 0.032)),
    COMBAT_MEMORY_MS: Math.max(5_000, Math.round(toFiniteNumber(base.COMBAT_MEMORY_MS, 30_000))),
    MAX_COMBAT_HISTORY: Math.max(
      10,
      Math.round(toFiniteNumber(base.MAX_COMBAT_HISTORY, 90)),
    ),
    MAX_WATCH_TARGETS: Math.max(
      1,
      Math.min(12, Math.round(toFiniteNumber(base.MAX_WATCH_TARGETS, 6))),
    ),
    MAX_FOCUS_CANDIDATES: Math.max(
      1,
      Math.min(8, Math.round(toFiniteNumber(base.MAX_FOCUS_CANDIDATES, 5))),
    ),
    ALERT_COOLDOWN_MS: Math.max(
      2_500,
      Math.round(toFiniteNumber(base.ALERT_COOLDOWN_MS, 18_000)),
    ),
    ALERT_EXPIRY_MS: Math.max(
      3_000,
      Math.round(toFiniteNumber(base.ALERT_EXPIRY_MS, 22_000)),
    ),
    TEAM_SPLIT_RADIUS_THRESHOLD: Math.max(
      6_500,
      worldSize * toFiniteNumber(base.TEAM_SPLIT_RADIUS_THRESHOLD, 0.034),
    ),
    TEAM_SPLIT_MEDIUM_FACTOR: Math.max(
      1.1,
      toFiniteNumber(base.TEAM_SPLIT_MEDIUM_FACTOR, 1.35),
    ),
    TEAM_SPLIT_HIGH_FACTOR: Math.max(
      1.3,
      toFiniteNumber(base.TEAM_SPLIT_HIGH_FACTOR, 1.8),
    ),
    FINAL_CIRCLE_PHASE_THRESHOLD: Math.max(
      1,
      Math.round(toFiniteNumber(base.FINAL_CIRCLE_PHASE_THRESHOLD, 7)),
    ),
    WATCH_TARGET_DEDUPE_RADIUS: Math.max(
      5_000,
      worldSize * toFiniteNumber(base.WATCH_TARGET_DEDUPE_RADIUS, 0.022),
    ),
    PINNED_PRIORITY_BOOST: Math.max(
      10,
      Math.round(toFiniteNumber(base.PINNED_PRIORITY_BOOST, 260)),
    ),
    WATCHING_NOW_PRIORITY_BOOST: Math.max(
      20,
      Math.round(toFiniteNumber(base.WATCHING_NOW_PRIORITY_BOOST, 520)),
    ),
    SUPPRESSED_PRIORITY_PENALTY: Math.max(
      20,
      Math.round(toFiniteNumber(base.SUPPRESSED_PRIORITY_PENALTY, 320)),
    ),
    MAX_ACTIVE_ALERTS: Math.max(
      4,
      Math.min(40, Math.round(toFiniteNumber(base.MAX_ACTIVE_ALERTS, 18))),
    ),
    MAX_SUPPRESSED_TARGETS: Math.max(
      4,
      Math.min(40, Math.round(toFiniteNumber(base.MAX_SUPPRESSED_TARGETS, 18))),
    ),
    MAX_DISMISSED_ALERTS: Math.max(
      4,
      Math.min(48, Math.round(toFiniteNumber(base.MAX_DISMISSED_ALERTS, 24))),
    ),
    KNOCK_SPIKE_THRESHOLD: Math.max(
      1,
      Math.round(toFiniteNumber(base.KNOCK_SPIKE_THRESHOLD, 2)),
    ),
    HIGH_RISK_FIGHT_SCORE: Math.max(
      40,
      Math.round(toFiniteNumber(base.HIGH_RISK_FIGHT_SCORE, 150)),
    ),
    TARGET_SUPPRESSION_MS: Math.max(
      5_000,
      Math.round(toFiniteNumber(base.TARGET_SUPPRESSION_MS, 45_000)),
    ),
    REPLAY_CANDIDATE_TTL_MS: Math.max(
      20_000,
      Math.round(toFiniteNumber(base.REPLAY_CANDIDATE_TTL_MS, 180_000)),
    ),
    MAX_REPLAY_CANDIDATES: Math.max(
      3,
      Math.min(24, Math.round(toFiniteNumber(base.MAX_REPLAY_CANDIDATES, 10))),
    ),
    MIN_WATCH_DWELL_MS: Math.max(
      2_000,
      Math.round(toFiniteNumber(base.MIN_WATCH_DWELL_MS, 9_000)),
    ),
    SWITCH_COOLDOWN_MS: Math.max(
      1_000,
      Math.round(toFiniteNumber(base.SWITCH_COOLDOWN_MS, 7_000)),
    ),
    PREPARE_DELTA_THRESHOLD: Math.max(
      10,
      Math.round(toFiniteNumber(base.PREPARE_DELTA_THRESHOLD, 70)),
    ),
    SWITCH_DELTA_THRESHOLD: Math.max(
      20,
      Math.round(toFiniteNumber(base.SWITCH_DELTA_THRESHOLD, 130)),
    ),
    EMERGENCY_SWITCH_DELTA: Math.max(
      30,
      Math.round(toFiniteNumber(base.EMERGENCY_SWITCH_DELTA, 240)),
    ),
    RECOMMENDATION_FLAP_WINDOW_MS: Math.max(
      3_000,
      Math.round(toFiniteNumber(base.RECOMMENDATION_FLAP_WINDOW_MS, 16_000)),
    ),
    MAX_CAMERA_RECOMMENDATION_HISTORY: Math.max(
      4,
      Math.min(20, Math.round(toFiniteNumber(base.MAX_CAMERA_RECOMMENDATION_HISTORY, 10))),
    ),
    MAP_FOCUS_HIGHLIGHT_MS: Math.max(
      1_500,
      Math.round(toFiniteNumber(base.MAP_FOCUS_HIGHLIGHT_MS, 4_500)),
    ),
    OPERATOR_ACTION_STATUS_MS: Math.max(
      1_000,
      Math.round(toFiniteNumber(base.OPERATOR_ACTION_STATUS_MS, 3_800)),
    ),
    MAX_SELECTABLE_WATCH_TARGETS: Math.max(
      1,
      Math.min(5, Math.round(toFiniteNumber(base.MAX_SELECTABLE_WATCH_TARGETS, 5))),
    ),
    FIGHT_HIGHLIGHT_RADIUS: Math.max(
      6_500,
      worldSize * toFiniteNumber(base.FIGHT_HIGHLIGHT_RADIUS, 0.054),
    ),
    FIGHT_HIGHLIGHT_MERGE_DISTANCE: Math.max(
      4_500,
      worldSize * toFiniteNumber(base.FIGHT_HIGHLIGHT_MERGE_DISTANCE, 0.026),
    ),
    FIGHT_HIGHLIGHT_MATCH_DISTANCE: Math.max(
      5_000,
      worldSize * toFiniteNumber(base.FIGHT_HIGHLIGHT_MATCH_DISTANCE, 0.03),
    ),
    FIGHT_HIGHLIGHT_ACTIVATION_TICKS: Math.max(
      1,
      Math.min(6, Math.round(toFiniteNumber(base.FIGHT_HIGHLIGHT_ACTIVATION_TICKS, 3))),
    ),
    FIGHT_HIGHLIGHT_FADE_HOLD_MS: Math.max(
      1_000,
      Math.round(toFiniteNumber(base.FIGHT_HIGHLIGHT_FADE_HOLD_MS, 4_500)),
    ),
    FIGHT_HIGHLIGHT_CANDIDATE_TTL_MS: Math.max(
      300,
      Math.round(toFiniteNumber(base.FIGHT_HIGHLIGHT_CANDIDATE_TTL_MS, 1_800)),
    ),
    FIGHT_HIGHLIGHT_MIN_PLAYERS: Math.max(
      2,
      Math.min(8, Math.round(toFiniteNumber(base.FIGHT_HIGHLIGHT_MIN_PLAYERS, 2))),
    ),
    FIGHT_HIGHLIGHT_HIGH_CONFIDENCE: Math.min(
      0.99,
      Math.max(0.5, toFiniteNumber(base.FIGHT_HIGHLIGHT_HIGH_CONFIDENCE, 0.9)),
    ),
    MAX_FIGHT_HIGHLIGHTS: Math.max(
      1,
      Math.min(8, Math.round(toFiniteNumber(base.MAX_FIGHT_HIGHLIGHTS, 4))),
    ),
    MAX_VISIBLE_FIGHT_HIGHLIGHTS: Math.max(
      1,
      Math.min(5, Math.round(toFiniteNumber(base.MAX_VISIBLE_FIGHT_HIGHLIGHTS, 3))),
    ),
    FIGHT_HIGHLIGHT_CENTER_SMOOTHING: Math.min(
      0.92,
      Math.max(0.3, toFiniteNumber(base.FIGHT_HIGHLIGHT_CENTER_SMOOTHING, 0.62)),
    ),
    FIGHT_HIGHLIGHT_RADIUS_SMOOTHING: Math.min(
      0.92,
      Math.max(0.3, toFiniteNumber(base.FIGHT_HIGHLIGHT_RADIUS_SMOOTHING, 0.68)),
    ),
    FIGHT_HIGHLIGHT_CENTER_JITTER_RATIO: Math.min(
      0.2,
      Math.max(0.01, toFiniteNumber(base.FIGHT_HIGHLIGHT_CENTER_JITTER_RATIO, 0.075)),
    ),
    FIGHT_HIGHLIGHT_RADIUS_JITTER_RATIO: Math.min(
      0.2,
      Math.max(0.01, toFiniteNumber(base.FIGHT_HIGHLIGHT_RADIUS_JITTER_RATIO, 0.09)),
    ),
    FIGHT_HIGHLIGHT_CENTER_SNAP_RATIO: Math.min(
      1.2,
      Math.max(0.15, toFiniteNumber(base.FIGHT_HIGHLIGHT_CENTER_SNAP_RATIO, 0.55)),
    ),
    FIGHT_HIGHLIGHT_RADIUS_SNAP_RATIO: Math.min(
      1,
      Math.max(0.15, toFiniteNumber(base.FIGHT_HIGHLIGHT_RADIUS_SNAP_RATIO, 0.42)),
    ),
    OBSERVER_ASSIST_CONFIDENCE_WEIGHT: Math.max(
      10,
      toFiniteNumber(base.OBSERVER_ASSIST_CONFIDENCE_WEIGHT, 100),
    ),
    OBSERVER_ASSIST_TEAM_COUNT_WEIGHT: Math.max(
      4,
      toFiniteNumber(base.OBSERVER_ASSIST_TEAM_COUNT_WEIGHT, 24),
    ),
    OBSERVER_ASSIST_ALIVE_PLAYER_WEIGHT: Math.max(
      1,
      toFiniteNumber(base.OBSERVER_ASSIST_ALIVE_PLAYER_WEIGHT, 6),
    ),
    OBSERVER_ASSIST_PHASE_WEIGHT: Math.max(
      1,
      toFiniteNumber(base.OBSERVER_ASSIST_PHASE_WEIGHT, 5),
    ),
    OBSERVER_ASSIST_ZONE_PRESSURE_WEIGHT: Math.max(
      0,
      toFiniteNumber(base.OBSERVER_ASSIST_ZONE_PRESSURE_WEIGHT, 14),
    ),
    OBSERVER_ASSIST_MINIMUM_HOLD_MS: Math.max(
      1_000,
      Math.round(toFiniteNumber(base.OBSERVER_ASSIST_MINIMUM_HOLD_MS, 7_000)),
    ),
    OBSERVER_ASSIST_REPLACEMENT_DELTA_THRESHOLD: Math.max(
      4,
      toFiniteNumber(base.OBSERVER_ASSIST_REPLACEMENT_DELTA_THRESHOLD, 22),
    ),
    OBSERVER_ASSIST_MAX_RANKED_FIGHTS: Math.max(
      1,
      Math.min(8, Math.round(toFiniteNumber(base.OBSERVER_ASSIST_MAX_RANKED_FIGHTS, 6))),
    ),
    OBSERVER_ASSIST_SUGGESTION_EXPIRY_MS: Math.max(
      2_500,
      Math.round(toFiniteNumber(base.OBSERVER_ASSIST_SUGGESTION_EXPIRY_MS, 9_000)),
    ),
    OBSERVER_ASSIST_SCORE_DISPLAY_STEP: Math.max(
      1,
      Math.min(25, Math.round(toFiniteNumber(base.OBSERVER_ASSIST_SCORE_DISPLAY_STEP, 5))),
    ),
    PROXIMITY_HIGH_DISTANCE:
      proximityRadius * toFiniteNumber(base.PROXIMITY_HIGH_FACTOR, 0.55),
    PROXIMITY_MEDIUM_DISTANCE:
      proximityRadius * toFiniteNumber(base.PROXIMITY_MEDIUM_FACTOR, 0.82),
    WORLD_SIZE: worldSize,
  });
}

module.exports = {
  DEFAULT_OBSERVER_ASSIST_CONFIG,
  resolveObserverAssistConfig,
};
