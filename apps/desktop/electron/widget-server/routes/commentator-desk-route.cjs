"use strict";

const DEFAULT_ACCESS = Object.freeze({
  approved: false,
  canUse: false,
  reason: "SUPER_ADMIN_APPROVAL_REQUIRED",
});

function safeJson(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function toFiniteNumber(value) {
  const numeric =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeText(value) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || null;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return null;
}

function normalizeSlot(value) {
  const numeric = toFiniteNumber(value);
  if (numeric === null) {
    return null;
  }
  const slot = Math.trunc(numeric);
  return slot > 0 ? slot : null;
}

function normalizeAccess(value) {
  const source = value && typeof value === "object" ? value : DEFAULT_ACCESS;
  const approved = source.approved === true;
  const canUse = source.canUse === true || (approved && source.canUse !== false);
  return {
    featureKey: "commentator-desk",
    widgetKey: "commentator-desk",
    organization: source.organization ?? null,
    approved,
    approval: source.approval ?? null,
    canUse,
    reason:
      typeof source.reason === "string" && source.reason.trim()
        ? source.reason.trim()
        : canUse
          ? null
          : "SUPER_ADMIN_APPROVAL_REQUIRED",
  };
}

function buildLockedState(access) {
  return {
    ok: false,
    status: "locked",
    reason: access.reason || "SUPER_ADMIN_APPROVAL_REQUIRED",
    access,
    updatedAt: Date.now(),
    message: "Commentator Desk requires Super Admin approval.",
  };
}

function buildBrandingIndex(teamBranding) {
  const byTeamId = new Map();
  const bySlot = new Map();
  const teams = Array.isArray(teamBranding?.teams) ? teamBranding.teams : [];

  for (const team of teams) {
    if (!team || typeof team !== "object") {
      continue;
    }
    const teamId = normalizeText(team.teamId);
    const slot = normalizeSlot(team.slot);
    const normalized = {
      teamId,
      slot,
      teamName: normalizeText(team.teamName) || normalizeText(team.teamTag),
      teamTag: normalizeText(team.teamTag),
      logoUrl: normalizeText(team.logoUrl),
      color: normalizeText(team.color),
    };
    if (teamId) {
      byTeamId.set(teamId.toLowerCase(), normalized);
    }
    if (slot !== null) {
      bySlot.set(slot, normalized);
    }
  }

  return { byTeamId, bySlot };
}

function getBrandingForPlayer(player, brandingIndex) {
  const teamId = normalizeText(player?.teamId);
  const slot = normalizeSlot(player?.teamSlot ?? player?.slot);
  if (teamId && brandingIndex.byTeamId.has(teamId.toLowerCase())) {
    return brandingIndex.byTeamId.get(teamId.toLowerCase());
  }
  if (slot !== null && brandingIndex.bySlot.has(slot)) {
    return brandingIndex.bySlot.get(slot);
  }
  return null;
}

function getTeamKey(player, branding) {
  const slot = normalizeSlot(player?.teamSlot ?? player?.slot ?? branding?.slot);
  if (slot !== null) {
    return `slot:${slot}`;
  }
  return normalizeText(player?.teamId) || normalizeText(branding?.teamId) || "unknown";
}

function formatTeamLabelFromParts(teamId, slot, branding) {
  const name = normalizeText(branding?.teamName) || normalizeText(branding?.teamTag);
  if (name) {
    return name.length > 18 ? `${name.slice(0, 15).trim()}...` : name;
  }
  if (slot !== null) {
    return `S${slot}`;
  }
  const normalized = normalizeText(teamId);
  if (!normalized) {
    return "Unknown";
  }
  return normalized.length > 18 ? `${normalized.slice(0, 15).trim()}...` : normalized;
}

function formatSlotLabel(slot) {
  const normalized = normalizeSlot(slot);
  return normalized === null ? "Slot ?" : `Slot ${normalized}`;
}

function formatSlotMatchup(leftSlot, rightSlot) {
  return `${formatSlotLabel(leftSlot)} vs ${formatSlotLabel(rightSlot)}`;
}

function formatTeamLabel(teamId) {
  const normalized = normalizeText(teamId);
  if (!normalized) {
    return "Unknown";
  }
  const numeric = Number(normalized);
  if (Number.isFinite(numeric)) {
    return `Team ${Math.trunc(numeric)}`;
  }
  return normalized.length > 18 ? `${normalized.slice(0, 15).trim()}...` : normalized;
}

function isActivePlayer(player) {
  return player && (player.alive !== false || player.knocked === true);
}

function normalizePlayer(player, brandingIndex) {
  if (!player || typeof player !== "object") {
    return null;
  }
  const x = toFiniteNumber(player.x);
  const y = toFiniteNumber(player.y);
  const branding = getBrandingForPlayer(player, brandingIndex);
  const slot = normalizeSlot(player.teamSlot ?? player.slot ?? branding?.slot);
  const teamId = normalizeText(player.teamId) || normalizeText(branding?.teamId);
  const teamKey = getTeamKey(player, branding);

  return {
    playerId: normalizeText(player.playerId),
    playerName: normalizeText(player.playerName),
    teamKey,
    teamId,
    teamSlot: slot,
    teamLabel: formatTeamLabelFromParts(teamId, slot, branding),
    teamLogoUrl: normalizeText(branding?.logoUrl) || "/assets/default-team.png",
    teamColor: normalizeText(branding?.color) || "#5eead4",
    x,
    y,
    kills: Math.max(0, Math.trunc(toFiniteNumber(player.kills) ?? 0)),
    alive: player.alive !== false,
    knocked: player.knocked === true,
    health: toFiniteNumber(player.health),
    isFiring: player.isFiring === true,
    fireAngle: toFiniteNumber(player.fireAngle),
    fireDirection:
      player.fireDirection && typeof player.fireDirection === "object"
        ? {
            x: toFiniteNumber(player.fireDirection.x),
            y: toFiniteNumber(player.fireDirection.y),
          }
        : null,
  };
}

function buildTeamRows(players) {
  const rowsByKey = new Map();
  for (const player of players) {
    if (!player || !player.teamKey) {
      continue;
    }
    let row = rowsByKey.get(player.teamKey);
    if (!row) {
      row = {
        key: player.teamKey,
        teamId: player.teamId,
        slot: player.teamSlot,
        label: player.teamLabel,
        logoUrl: player.teamLogoUrl,
        color: player.teamColor,
        totalPlayers: 0,
        activePlayers: 0,
        standingPlayers: 0,
        knockedPlayers: 0,
        firingPlayers: 0,
        kills: 0,
      };
      rowsByKey.set(player.teamKey, row);
    }

    row.totalPlayers += 1;
    row.kills += player.kills;
    if (isActivePlayer(player)) {
      row.activePlayers += 1;
    }
    if (player.alive === true && player.knocked !== true) {
      row.standingPlayers += 1;
    }
    if (player.knocked === true) {
      row.knockedPlayers += 1;
    }
    if (player.isFiring === true && player.alive !== false) {
      row.firingPlayers += 1;
    }
  }

  return [...rowsByKey.values()].sort((left, right) => {
    if (right.activePlayers !== left.activePlayers) {
      return right.activePlayers - left.activePlayers;
    }
    if (right.kills !== left.kills) {
      return right.kills - left.kills;
    }
    const leftSlot = left.slot ?? Number.MAX_SAFE_INTEGER;
    const rightSlot = right.slot ?? Number.MAX_SAFE_INTEGER;
    return leftSlot - rightSlot;
  });
}

function buildDistancePairs(players) {
  const groups = new Map();
  for (const player of players) {
    if (!isActivePlayer(player) || player.x === null || player.y === null) {
      continue;
    }
    let group = groups.get(player.teamKey);
    if (!group) {
      group = {
        key: player.teamKey,
        label: player.teamLabel,
        slot: player.teamSlot,
        activePlayers: 0,
        knockedPlayers: 0,
        players: [],
      };
      groups.set(player.teamKey, group);
    }
    group.activePlayers += 1;
    if (player.knocked === true) {
      group.knockedPlayers += 1;
    }
    group.players.push(player);
  }

  const teamGroups = [...groups.values()];
  const rows = [];
  for (let leftIndex = 0; leftIndex < teamGroups.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < teamGroups.length; rightIndex += 1) {
      const left = teamGroups[leftIndex];
      const right = teamGroups[rightIndex];
      let minDistance = Number.POSITIVE_INFINITY;
      let leftPlayer = null;
      let rightPlayer = null;

      for (const leftMember of left.players) {
        for (const rightMember of right.players) {
          const distance = Math.hypot(leftMember.x - rightMember.x, leftMember.y - rightMember.y);
          if (distance < minDistance) {
            minDistance = distance;
            leftPlayer = leftMember;
            rightPlayer = rightMember;
          }
        }
      }

      if (!Number.isFinite(minDistance)) {
        continue;
      }

      const distanceMeters = Math.max(0, Math.round(minDistance / 100));
      rows.push({
        key: `${left.key}:${right.key}`,
        leftLabel: left.label,
        rightLabel: right.label,
        leftSlot: left.slot,
        rightSlot: right.slot,
        slotMatchup: formatSlotMatchup(left.slot, right.slot),
        leftPlayerName: leftPlayer?.playerName || null,
        rightPlayerName: rightPlayer?.playerName || null,
        leftActive: left.activePlayers,
        rightActive: right.activePlayers,
        knockedCount: left.knockedPlayers + right.knockedPlayers,
        firingCount:
          (leftPlayer?.isFiring === true ? 1 : 0) + (rightPlayer?.isFiring === true ? 1 : 0),
        distanceMeters,
        tone:
          distanceMeters <= 80
            ? "hot"
            : distanceMeters <= 160
              ? "close"
              : distanceMeters <= 280
                ? "watch"
                : "wide",
      });
    }
  }

  return rows.sort((left, right) => left.distanceMeters - right.distanceMeters).slice(0, 10);
}

function buildSplitRows(players) {
  const groups = new Map();
  for (const player of players) {
    if (!isActivePlayer(player) || player.x === null || player.y === null) {
      continue;
    }
    let group = groups.get(player.teamKey);
    if (!group) {
      group = {
        key: player.teamKey,
        label: player.teamLabel,
        players: [],
      };
      groups.set(player.teamKey, group);
    }
    group.players.push(player);
  }

  const rows = [];
  for (const group of groups.values()) {
    if (group.players.length < 2) {
      continue;
    }

    let maxDistance = 0;
    for (let leftIndex = 0; leftIndex < group.players.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < group.players.length; rightIndex += 1) {
        const left = group.players[leftIndex];
        const right = group.players[rightIndex];
        maxDistance = Math.max(maxDistance, Math.hypot(left.x - right.x, left.y - right.y));
      }
    }

    const spreadMeters = Math.max(0, Math.round(maxDistance / 100));
    if (spreadMeters >= 180) {
      rows.push({
        key: group.key,
        label: group.label,
        activePlayers: group.players.length,
        spreadMeters,
      });
    }
  }

  return rows.sort((left, right) => right.spreadMeters - left.spreadMeters).slice(0, 6);
}

function getRemainingMs(zone) {
  return (
    toFiniteNumber(zone?.timeRemainingMs) ??
    toFiniteNumber(zone?.timing?.remainingMs) ??
    (toFiniteNumber(zone?.timeRemaining) === null
      ? null
      : Math.round(toFiniteNumber(zone.timeRemaining) * 1000))
  );
}

function formatSeconds(ms) {
  if (ms === null || !Number.isFinite(ms)) {
    return "--:--";
  }
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

function readRecommendationText(cameraAssistPayload) {
  const recommendation = cameraAssistPayload?.recommendation || null;
  if (!recommendation || typeof recommendation !== "object") {
    return null;
  }
  return (
    normalizeText(recommendation.label) ||
    normalizeText(recommendation.title) ||
    normalizeText(recommendation.reason) ||
    normalizeText(recommendation.mode) ||
    null
  );
}

function buildCues(snapshot, teams, distancePairs, splitRows) {
  const cues = [];
  const production = snapshot?.productionSupport || null;
  const assist = snapshot?.observerAssist || null;
  const zone = snapshot?.zone || null;
  const remainingMs = getRemainingMs(zone);
  const fight = production?.fightAlertCandidate || null;

  if (fight && Array.isArray(fight.teamIds) && fight.teamIds.length >= 2) {
    cues.push({
      tone: "fight",
      label: "Fight",
      line:
        normalizeText(fight.matchup) ||
        fight.teamIds.slice(0, 2).map(formatTeamLabel).join(" vs "),
      meta: "Hold camera for trade potential",
    });
  }

  const alert = Array.isArray(production?.activeAlerts) ? production.activeAlerts[0] : null;
  if (alert) {
    cues.push({
      tone: "alert",
      label: "Alert",
      line: normalizeText(alert.label) || normalizeText(alert.type) || "Production alert",
      meta: normalizeText(alert.reason) || "Mark replay if it converts",
    });
  }

  const suggestion = assist?.bestSuggestion || null;
  if (suggestion) {
    cues.push({
      tone: "focus",
      label: "Focus",
      line:
        normalizeText(suggestion.reason) ||
        normalizeText(suggestion.label) ||
        "Observer assist found a priority angle",
      meta:
        normalizeText(suggestion.suggestedPlayerName) ||
        formatTeamLabel(suggestion.suggestedTeamId),
    });
  }

  if (remainingMs !== null && remainingMs <= 60_000) {
    cues.push({
      tone: "zone",
      label: "Zone",
      line: `Zone ${zone?.phase ?? ""} closes in ${formatSeconds(remainingMs)}`.trim(),
      meta: "Call late rotations and edge pressure",
    });
  }

  const hotPair = distancePairs.find((pair) => pair.distanceMeters <= 160);
  if (hotPair) {
    cues.push({
      tone: "distance",
      label: "Distance",
      line: `${hotPair.slotMatchup || formatSlotMatchup(hotPair.leftSlot, hotPair.rightSlot)} at ${hotPair.distanceMeters}m`,
      meta: hotPair.knockedCount > 0 ? "Knock pressure active" : "Contact range",
    });
  }

  if (splitRows.length > 0) {
    cues.push({
      tone: "split",
      label: "Split",
      line: `${splitRows[0].label} spread ${splitRows[0].spreadMeters}m`,
      meta: "Possible isolation angle",
    });
  }

  const topKills = teams.filter((team) => team.kills > 0).sort((a, b) => b.kills - a.kills)[0];
  if (topKills) {
    cues.push({
      tone: "kills",
      label: "Kills",
      line: `${topKills.label} leads with ${topKills.kills} kills`,
      meta: `${topKills.activePlayers} active`,
    });
  }

  if (cues.length === 0) {
    cues.push({
      tone: "idle",
      label: teams.length > 0 ? "Live" : "Standby",
      line:
        teams.length > 0
          ? `${teams.filter((team) => team.activePlayers > 0).length} teams active`
          : "Waiting for launcher map telemetry",
      meta: "Scanning for fight, zone, and distance signals",
    });
  }

  return cues.slice(0, 8);
}

function buildState(snapshot, access) {
  if (!access.canUse) {
    return buildLockedState(access);
  }

  const brandingIndex = buildBrandingIndex(snapshot?.teamBranding);
  const players = (Array.isArray(snapshot?.players?.players) ? snapshot.players.players : [])
    .map((player) => normalizePlayer(player, brandingIndex))
    .filter(Boolean);
  const teams = buildTeamRows(players);
  const distancePairs = buildDistancePairs(players);
  const splits = buildSplitRows(players);
  const cues = buildCues(snapshot, teams, distancePairs, splits);
  const zone = snapshot?.zone || null;
  const remainingMs = getRemainingMs(zone);
  const cameraRecommendation = readRecommendationText(
    snapshot?.productionSupport?.cameraAssistPayload,
  );

  return {
    ok: true,
    status: "live",
    access,
    updatedAt: Date.now(),
    map: {
      key: snapshot?.mapContext?.mapKey || null,
      label: snapshot?.mapContext?.sourceMapName || snapshot?.mapContext?.definition?.label || null,
    },
    telemetry: {
      playerCount: players.length,
      activeTeams: teams.filter((team) => team.activePlayers > 0).length,
      activePlayers: teams.reduce((sum, team) => sum + team.activePlayers, 0),
      knockedPlayers: teams.reduce((sum, team) => sum + team.knockedPlayers, 0),
      firingPlayers: teams.reduce((sum, team) => sum + team.firingPlayers, 0),
      distancePairs: distancePairs.length,
      updatedAt:
        toFiniteNumber(snapshot?.players?.timestamp) ??
        toFiniteNumber(snapshot?.productionSupport?.updatedAt) ??
        toFiniteNumber(snapshot?.observerAssist?.updatedAt) ??
        Date.now(),
    },
    zone: {
      phase: zone?.phase ?? null,
      status: normalizeText(zone?.status || zone?.mode || zone?.zoneMode),
      remainingMs,
      remainingLabel: formatSeconds(remainingMs),
    },
    camera: {
      recommendation: cameraRecommendation,
      watchTargets: Array.isArray(snapshot?.productionSupport?.watchTargets)
        ? snapshot.productionSupport.watchTargets.length
        : 0,
      alerts: Array.isArray(snapshot?.productionSupport?.activeAlerts)
        ? snapshot.productionSupport.activeAlerts.length
        : 0,
      replayCandidates: Array.isArray(snapshot?.productionSupport?.replayCandidates)
        ? snapshot.productionSupport.replayCandidates.length
        : 0,
    },
    cues,
    teams,
    distancePairs,
    splits,
  };
}

function buildMapFrameUrl(requestedMapKey) {
  const params = new URLSearchParams();
  if (requestedMapKey) {
    params.set("map", requestedMapKey);
  }
  const query = params.toString();
  return query ? `/obs/map?${query}` : "/obs/map";
}

function registerCommentatorDeskRoute(app, { engine, getAccess }) {
  function readRequestedMapKey(req) {
    return typeof req.query?.map === "string" && req.query.map.trim()
      ? req.query.map.trim()
      : null;
  }

  function buildRouteState(req) {
    const access = normalizeAccess(typeof getAccess === "function" ? getAccess() : null);
    const snapshot = engine.getSnapshot(readRequestedMapKey(req));
    return buildState(snapshot, access);
  }

  app.get("/obs/commentator-desk/state", (req, res) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    res.json(buildRouteState(req));
  });

  app.get("/obs/commentator-desk", (req, res) => {
    const requestedMapKey = readRequestedMapKey(req);
    const bootstrap = {
      requestedMapKey,
      mapFrameUrl: buildMapFrameUrl(requestedMapKey),
      state: buildRouteState(req),
    };
    const visibilityBootstrap = {
      widgetKey: "commentator-desk",
      wsPath: "/ws",
      direction: "right",
    };

    res.type("html").send(`<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Arenzyra Commentator Desk</title>
    <link rel="stylesheet" href="/obs/static/commentator-desk-widget.css?v=commentator-desk-v1" />
  </head>
  <body>
    <main class="commentator-desk" id="commentator-desk" data-status="loading">
      <section class="map-pane" aria-label="Live map">
        <iframe id="map-frame" title="Live map" data-src="${escapeHtml(
          bootstrap.mapFrameUrl,
        )}"></iframe>
        <div class="locked-cover" id="locked-cover">
          <div class="locked-title">Commentator Desk locked</div>
          <div class="locked-copy" id="locked-copy">Waiting for Super Admin approval.</div>
        </div>
      </section>
      <section class="cue-pane">
        <header class="desk-header">
          <div>
            <div class="eyebrow">Commentator Desk</div>
            <h1 id="desk-title">Live Map Desk</h1>
          </div>
          <div class="status-pill" id="status-pill">Loading</div>
        </header>
        <article class="primary-cue" id="primary-cue">
          <div class="cue-label">Standby</div>
          <div class="cue-line">Loading local telemetry.</div>
          <div class="cue-meta">Launcher data only</div>
        </article>
        <div class="panel">
          <div class="panel-title">Next Cues</div>
          <div class="cue-list" id="cue-list"></div>
        </div>
        <div class="panel split-panel">
          <div class="panel-title">Team Splits</div>
          <div id="split-list" class="compact-list"></div>
        </div>
      </section>
      <section class="read-pane">
        <div class="metric-grid">
          <div class="metric">
            <span>Teams</span>
            <strong id="metric-teams">0</strong>
          </div>
          <div class="metric">
            <span>Players</span>
            <strong id="metric-players">0</strong>
          </div>
          <div class="metric">
            <span>Knocked</span>
            <strong id="metric-knocked">0</strong>
          </div>
          <div class="metric">
            <span>Firing</span>
            <strong id="metric-firing">0</strong>
          </div>
        </div>
        <div class="panel zone-panel">
          <div class="panel-title">Zone</div>
          <div class="zone-row">
            <strong id="zone-timer">--:--</strong>
            <span id="zone-status">Standby</span>
          </div>
        </div>
        <div class="panel">
          <div class="panel-title">Closest Teams</div>
          <div id="distance-list" class="distance-list"></div>
        </div>
        <div class="panel">
          <div class="panel-title">Production</div>
          <div id="production-list" class="compact-list"></div>
        </div>
      </section>
    </main>
    <script>window.__ARENZYRA_COMMENTATOR_DESK_BOOTSTRAP__ = ${safeJson(bootstrap)};</script>
    <script>window.__ARENZYRA_WIDGET_VISIBILITY_BOOTSTRAP__ = ${safeJson(visibilityBootstrap)};</script>
    <script src="/obs/static/widget-visibility-client.js?v=widget-hotkey-v1"></script>
    <script src="/obs/static/commentator-desk-widget.js?v=commentator-desk-v1"></script>
  </body>
</html>`);
  });
}

module.exports = {
  registerCommentatorDeskRoute,
};
