"use strict";

const {
  buildTeamBrandingIndex,
  resolveTeamLabel,
} = require("../map-engine/team-label-resolver.cjs");

const DEFAULT_ACCESS = Object.freeze({
  approved: false,
  canConfigure: false,
  canUse: false,
  reason: "SUPER_ADMIN_APPROVAL_REQUIRED",
  settings: null,
});

const DEFAULT_SETTINGS = Object.freeze({
  enabled: false,
  muted: false,
  mode: "professional",
  voiceMode: "single",
  primaryVoice: "play-by-play",
  secondaryVoice: "analyst",
  language: "en",
  talkFrequency: "balanced",
  minGapMs: 10000,
  maxLineWords: 22,
  speakingSpeed: "normal",
  expression: "professional",
  priority: "high-value",
  profanityFilter: true,
  logLines: true,
  allowedRoles: ["ADMIN", "ORGANIZER"],
});

const TALK_FREQUENCY_GAP_MS = Object.freeze({
  low: 15000,
  balanced: 10000,
  high: 6000,
});

const HISTORY_LIMIT = 20;
const RECENT_KEY_MIN_COOLDOWN_MS = 25000;

const LINE_VARIANTS = Object.freeze({
  fight: Object.freeze([
    ({ matchup }) => `Fight opening up: ${matchup}. Stay with the pressure.`,
    ({ matchup }) => `Contact building between ${matchup}. Watch the first knock.`,
    ({ matchup }) => `${matchup} are close enough to commit. Hold this angle.`,
    ({ matchup }) => `Pressure rising around ${matchup}. The next knock decides the camera.`,
    ({ matchup }) => `${matchup} are about to collide. Keep the feed on this fight.`,
    ({ matchup }) => `Engagement forming: ${matchup}. This can turn into a wipe quickly.`,
  ]),
  alert: Object.freeze([
    ({ label }) => `${label}. Keep the observer close to the pressure.`,
    ({ label }) => `${label}. Replay this if it turns into a wipe.`,
    ({ label }) => `${label}. Stay with the team that finds the next knock.`,
    ({ label }) => `${label}. This is the moment to hold the feed.`,
    ({ label }) => `${label}. Watch for the trade before moving away.`,
  ]),
  zone: Object.freeze([
    ({ phaseText, remaining }) => `${phaseText} closes in ${remaining}. Rotations have to commit now.`,
    ({ phaseText, remaining }) => `${phaseText} is nearly shut, ${remaining} left. Late teams are under pressure.`,
    ({ phaseText, remaining }) => `${phaseText} timer is down to ${remaining}. Expect forced crosses now.`,
    ({ phaseText, remaining }) => `${remaining} until ${phaseText} closes. Hold the edge fights.`,
  ]),
  split: Object.freeze([
    ({ team }) => `${team} is split wide. This is an isolation risk.`,
    ({ team }) => `${team} has a player detached. Watch for a punish.`,
    ({ team }) => `${team} is stretched across the map. The regroup is dangerous.`,
    ({ team }) => `${team} is giving up trade distance. A collapse can hurt them here.`,
  ]),
  kills: Object.freeze([
    ({ team, kills, alive }) => `${team} leads with ${kills} kills and ${alive} alive.`,
    ({ team, kills, alive }) => `${team} is setting the pace: ${kills} kills, ${alive} still alive.`,
    ({ team, kills, alive }) => `${team} owns the frag lead with ${kills}. They still have ${alive} alive.`,
    ({ team, kills, alive }) => `${team} is converting fights well, up to ${kills} kills with ${alive} alive.`,
  ]),
  standbyNoTelemetry: Object.freeze([
    () => "Waiting for live PUBG telemetry.",
    () => "No live telemetry yet. The caster will stay quiet until the feed updates.",
    () => "Telemetry is idle. Commentary will resume when match data returns.",
  ]),
  standbyActive: Object.freeze([
    ({ teams, players }) => `${teams} teams active with ${players} players alive. Waiting for a high-value moment.`,
    ({ teams, players }) => `${players} players remain across ${teams} teams. Holding commentary for the next trigger.`,
    ({ teams }) => `${teams} teams still in play. The caster is watching for fights, zone pressure, or knocks.`,
  ]),
});

function toFiniteNumber(value) {
  const numeric =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeBoolean(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeString(value, fallback, maxLength = 80) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return (normalized || fallback).slice(0, maxLength);
}

function normalizeEnum(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function normalizeSettings(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    enabled: normalizeBoolean(source.enabled, DEFAULT_SETTINGS.enabled),
    muted: normalizeBoolean(source.muted, DEFAULT_SETTINGS.muted),
    mode: normalizeEnum(source.mode, ["professional", "hype"], DEFAULT_SETTINGS.mode),
    voiceMode: normalizeEnum(source.voiceMode, ["single", "dual"], DEFAULT_SETTINGS.voiceMode),
    primaryVoice: normalizeString(source.primaryVoice, DEFAULT_SETTINGS.primaryVoice),
    secondaryVoice: normalizeString(source.secondaryVoice, DEFAULT_SETTINGS.secondaryVoice),
    language: normalizeString(source.language, DEFAULT_SETTINGS.language, 16),
    talkFrequency: normalizeEnum(
      source.talkFrequency,
      ["low", "balanced", "high"],
      DEFAULT_SETTINGS.talkFrequency,
    ),
    minGapMs: Math.max(
      4000,
      Math.min(
        30000,
        Math.round(
          toFiniteNumber(source.minGapMs) ??
            TALK_FREQUENCY_GAP_MS[source.talkFrequency] ??
            DEFAULT_SETTINGS.minGapMs,
        ),
      ),
    ),
    maxLineWords: Math.max(
      8,
      Math.min(40, Math.round(toFiniteNumber(source.maxLineWords) ?? DEFAULT_SETTINGS.maxLineWords)),
    ),
    speakingSpeed: normalizeEnum(
      source.speakingSpeed,
      ["slow", "normal", "fast"],
      DEFAULT_SETTINGS.speakingSpeed,
    ),
    expression: normalizeEnum(
      source.expression,
      ["neutral", "professional", "energetic", "dramatic"],
      DEFAULT_SETTINGS.expression,
    ),
    priority: normalizeEnum(
      source.priority,
      ["high-value", "balanced", "all"],
      DEFAULT_SETTINGS.priority,
    ),
    profanityFilter: normalizeBoolean(source.profanityFilter, DEFAULT_SETTINGS.profanityFilter),
    logLines: normalizeBoolean(source.logLines, DEFAULT_SETTINGS.logLines),
    allowedRoles: Array.isArray(source.allowedRoles)
      ? source.allowedRoles.filter((role) => role === "ADMIN" || role === "ORGANIZER")
      : [...DEFAULT_SETTINGS.allowedRoles],
  };
}

function normalizeAccess(value) {
  const source = value && typeof value === "object" ? value : DEFAULT_ACCESS;
  const settings = normalizeSettings(source.settings);
  return {
    featureKey: "ai-caster",
    widgetKey: "ai-caster",
    organization: source.organization ?? null,
    approved: source.approved === true,
    approval: source.approval ?? null,
    canConfigure: source.canConfigure === true,
    canUse: source.canUse === true,
    reason:
      typeof source.reason === "string" && source.reason.trim()
        ? source.reason.trim()
        : null,
    settings,
  };
}

function buildLockedState(access, history) {
  const reason = access.reason || "SUPER_ADMIN_APPROVAL_REQUIRED";
  const message =
    reason === "AI_CASTER_DISABLED"
      ? "AI Caster is approved but disabled."
      : reason === "AI_CASTER_MUTED"
        ? "AI Caster is muted."
        : reason === "ROLE_NOT_ALLOWED"
          ? "AI Caster is not allowed for this role."
          : "AI Caster requires SuperAdmin approval.";

  return {
    ok: false,
    status: "locked",
    reason,
    settings: access.settings,
    currentLine: {
      id: `locked:${reason}`,
      text: message,
      voice: "system",
      role: "system",
      style: "control",
      priority: "control",
      createdAt: Date.now(),
      source: "access",
    },
    history: history.slice(0, 20),
  };
}

function resolveCustomTeamLabel(teamId, teamLabelResolver) {
  if (typeof teamLabelResolver !== "function") {
    return null;
  }

  const resolved = teamLabelResolver(teamId);
  return typeof resolved === "string" && resolved.trim() ? resolved.trim() : null;
}

function formatTeamLabel(teamId, teamLabelResolver = null) {
  const customLabel = resolveCustomTeamLabel(teamId, teamLabelResolver);
  if (customLabel) {
    return customLabel;
  }

  const value = String(teamId || "").trim();
  if (!value) {
    return "Unknown team";
  }
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return `Team ${numeric}`;
  }
  return value.length > 18 ? `${value.slice(0, 15).trim()}...` : value;
}

function formatSeconds(ms) {
  const seconds = Math.max(0, Math.ceil((toFiniteNumber(ms) ?? 0) / 1000));
  return `${seconds}s`;
}

function lineWordLimit(text, maxWords) {
  const words = String(text || "").trim().split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) {
    return words.join(" ");
  }
  return `${words.slice(0, maxWords).join(" ")}...`;
}

function stableHash(value) {
  const text = String(value ?? "");
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function normalizeLineForRepeatCheck(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function lineOpeningSignature(text) {
  return normalizeLineForRepeatCheck(text).split(" ").slice(0, 4).join(" ");
}

function isRecentlyRepeatedLine(text, style, history) {
  const normalized = normalizeLineForRepeatCheck(text);
  const opener = lineOpeningSignature(text);
  if (!normalized) {
    return true;
  }
  return history.some((line) => {
    const otherText = normalizeLineForRepeatCheck(line?.text);
    if (otherText === normalized) {
      return true;
    }
    return line?.style === style && opener && lineOpeningSignature(line.text) === opener;
  });
}

function renderCandidateText(candidate, settings, now, history, { allowRepeat = false } = {}) {
  const variants = Array.isArray(candidate.variants) && candidate.variants.length
    ? candidate.variants
    : [() => candidate.text];
  const start = stableHash(`${candidate.key}:${now}:${history[0]?.text || ""}`) % variants.length;

  for (let offset = 0; offset < variants.length; offset += 1) {
    const variant = variants[(start + offset) % variants.length];
    const text = lineWordLimit(variant(candidate.context || {}), settings.maxLineWords);
    if (allowRepeat || !isRecentlyRepeatedLine(text, candidate.style, history)) {
      return text;
    }
  }

  return null;
}

function alivePlayers(players) {
  return (Array.isArray(players) ? players : []).filter(
    (player) => player && player.alive !== false,
  );
}

function summarizeTeamsFromPlayers(players, teamLabelResolver = null) {
  const teams = new Map();
  for (const player of alivePlayers(players)) {
    const teamId = player.teamSlot ?? player.teamId ?? "unknown";
    const key = String(teamId);
    const current =
      teams.get(key) ||
      {
        teamId,
        label: formatTeamLabel(teamId, teamLabelResolver),
        alivePlayers: 0,
        kills: 0,
      };
    current.alivePlayers += 1;
    current.kills += Math.max(0, Math.trunc(toFiniteNumber(player.kills) ?? 0));
    teams.set(key, current);
  }
  return [...teams.values()].sort((left, right) => {
    if (right.kills !== left.kills) return right.kills - left.kills;
    return right.alivePlayers - left.alivePlayers;
  });
}

function selectVoice(settings, role) {
  if (settings.voiceMode === "dual" && role === "analyst") {
    return settings.secondaryVoice;
  }
  return settings.primaryVoice;
}

function createSnapshotTeamLabelResolver(snapshot) {
  const index = buildTeamBrandingIndex(snapshot?.teamBranding);
  return (teamId) => resolveTeamLabel(index, teamId);
}

function candidateFromFight(snapshot, teamLabelResolver) {
  const fight = snapshot?.productionSupport?.fightAlertCandidate;
  if (!fight || !Array.isArray(fight.teamIds) || fight.teamIds.length < 2) {
    return null;
  }
  const resolvedMatchup = fight.teamIds
    .slice(0, 2)
    .map((teamId) => formatTeamLabel(teamId, teamLabelResolver))
    .join(" versus ");
  const rawMatchup =
    typeof fight.matchup === "string" && fight.matchup.trim() ? fight.matchup.trim() : "";
  const rawUsesFallbackNames = /^(Arenzyra|Team \d{1,3})\s+(?:vs|versus)\s+(Arenzyra|Team \d{1,3})$/i.test(
    rawMatchup,
  );
  const matchup =
    rawMatchup && (!rawUsesFallbackNames || rawMatchup === resolvedMatchup)
      ? rawMatchup
      : resolvedMatchup;
  return {
    key: `fight:${fight.id || matchup}`,
    role: "play-by-play",
    style: "fight",
    priority: "high",
    context: { matchup },
    variants: LINE_VARIANTS.fight,
  };
}

function candidateFromAlert(snapshot) {
  const alert = Array.isArray(snapshot?.productionSupport?.activeAlerts)
    ? snapshot.productionSupport.activeAlerts[0]
    : null;
  if (!alert) {
    return null;
  }
  const label = normalizeString(alert.label, "Production alert", 120);
  return {
    key: `alert:${alert.id || label}`,
    role: "play-by-play",
    style: "alert",
    priority: "high",
    context: { label },
    variants: LINE_VARIANTS.alert,
  };
}

function candidateFromZone(snapshot) {
  const zone = snapshot?.zone;
  const remainingMs =
    toFiniteNumber(zone?.timeRemainingMs) ??
    toFiniteNumber(zone?.timing?.remainingMs) ??
    (toFiniteNumber(zone?.timeRemaining) === null
      ? null
      : toFiniteNumber(zone?.timeRemaining) * 1000);
  if (remainingMs === null || remainingMs > 30000) {
    return null;
  }
  const phase = toFiniteNumber(zone?.phase);
  const phaseText = `Zone ${phase !== null ? phase : "circle"}`;
  return {
    key: `zone:${phase ?? "unknown"}:${Math.ceil(remainingMs / 5000)}`,
    role: "analyst",
    style: "zone",
    priority: remainingMs <= 15000 ? "high" : "medium",
    context: { phaseText, remaining: formatSeconds(remainingMs) },
    variants: LINE_VARIANTS.zone,
  };
}

function candidateFromSplit(snapshot, teamLabelResolver) {
  const split = Array.isArray(snapshot?.productionSupport?.teamSplitRisks)
    ? snapshot.productionSupport.teamSplitRisks[0]
    : null;
  if (!split || split.severity === "low") {
    return null;
  }
  return {
    key: `split:${split.teamId}:${split.severity}`,
    role: "analyst",
    style: "split",
    priority: split.severity === "high" ? "high" : "medium",
    context: { team: formatTeamLabel(split.teamId, teamLabelResolver) },
    variants: LINE_VARIANTS.split,
  };
}

function candidateFromKills(snapshot, teamLabelResolver) {
  const teams = summarizeTeamsFromPlayers(snapshot?.players?.players, teamLabelResolver);
  const top = teams.find((team) => team.kills > 0);
  if (!top) {
    return null;
  }
  return {
    key: `kills:${top.teamId}:${top.kills}:${top.alivePlayers}`,
    role: "analyst",
    style: "kills",
    priority: "medium",
    context: { team: top.label, kills: top.kills, alive: top.alivePlayers },
    variants: LINE_VARIANTS.kills,
  };
}

function candidateFromStandby(snapshot) {
  const players = alivePlayers(snapshot?.players?.players);
  if (!players.length) {
    return {
      key: "standby:no-telemetry",
      role: "analyst",
      style: "standby",
      priority: "low",
      context: {},
      variants: LINE_VARIANTS.standbyNoTelemetry,
      idle: true,
    };
  }
  const teams = summarizeTeamsFromPlayers(players, createSnapshotTeamLabelResolver(snapshot));
  return {
    key: `standby:${teams.length}:${players.length}`,
    role: "analyst",
    style: "standby",
    priority: "low",
    context: { teams: teams.length, players: players.length },
    variants: LINE_VARIANTS.standbyActive,
    idle: true,
  };
}

function buildCandidates(snapshot, settings) {
  const teamLabelResolver = createSnapshotTeamLabelResolver(snapshot);
  const candidates = [
    candidateFromFight(snapshot, teamLabelResolver),
    candidateFromAlert(snapshot),
    candidateFromZone(snapshot),
    candidateFromSplit(snapshot, teamLabelResolver),
    settings.priority === "high-value" ? null : candidateFromKills(snapshot, teamLabelResolver),
    settings.priority === "all" ? candidateFromStandby(snapshot) : null,
  ].filter(Boolean);
  return candidates.length ? candidates : [candidateFromStandby(snapshot)].filter(Boolean);
}

function createAiCasterEngine({ log = () => {} } = {}) {
  let access = normalizeAccess(DEFAULT_ACCESS);
  let currentLine = null;
  let lastLineAt = 0;
  const recentKeys = new Map();
  const history = [];

  function shouldSuppressIdleCandidate(candidate) {
    return candidate?.idle === true && currentLine?.key === candidate.key;
  }

  function pushLine(candidate, settings, now, options = {}) {
    const text = renderCandidateText(candidate, settings, now, history, options);
    if (!text) {
      return null;
    }
    const role = candidate.role === "analyst" ? "analyst" : "play-by-play";
    const line = {
      id: `${candidate.key}:${now}`,
      key: candidate.key,
      text,
      voice: selectVoice(settings, role === "analyst" ? "analyst" : "play-by-play"),
      role,
      style: candidate.style,
      priority: candidate.priority,
      createdAt: now,
      source: candidate.key.split(":")[0],
      speakingSpeed: settings.speakingSpeed,
      expression: settings.expression,
      language: settings.language,
    };
    currentLine = line;
    lastLineAt = now;
    recentKeys.set(candidate.key, now);
    history.unshift(line);
    history.splice(HISTORY_LIMIT);
    log("AI caster line", { text: line.text, voice: line.voice, role: line.role });
    return line;
  }

  function evaluate(snapshot, now = Date.now()) {
    const settings = access.settings;
    const usable =
      access.canUse === true &&
      settings.enabled === true &&
      settings.muted !== true;

    if (!usable) {
      return buildLockedState(access, history);
    }

    const minGapMs =
      toFiniteNumber(settings.minGapMs) ??
      TALK_FREQUENCY_GAP_MS[settings.talkFrequency] ??
      DEFAULT_SETTINGS.minGapMs;
    const candidates = buildCandidates(snapshot, settings);
    const selected = candidates.find((candidate) => {
      if (!recentKeys.has(candidate.key)) {
        return true;
      }
      const lastSeenAt = recentKeys.get(candidate.key) ?? 0;
      return now - lastSeenAt >= Math.max(RECENT_KEY_MIN_COOLDOWN_MS, minGapMs * 2);
    });

    if (
      selected &&
      !shouldSuppressIdleCandidate(selected) &&
      (!currentLine || now - lastLineAt >= minGapMs)
    ) {
      pushLine(selected, settings, now);
    }

    if (!currentLine) {
      pushLine(candidateFromStandby(snapshot), settings, now, { allowRepeat: true });
    }

    return {
      ok: true,
      status: currentLine ? "live" : "standby",
      reason: null,
      settings,
      currentLine,
      history: history.slice(0, HISTORY_LIMIT),
    };
  }

  return {
    evaluate,
    getAccess() {
      return access;
    },
    setAccess(nextAccess) {
      access = normalizeAccess(nextAccess);
      return access;
    },
  };
}

module.exports = {
  createAiCasterEngine,
  normalizeSettings,
};
