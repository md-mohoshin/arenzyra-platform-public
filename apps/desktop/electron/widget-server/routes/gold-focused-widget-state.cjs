"use strict";

const DEFAULT_STALE_AFTER_MS = 2_500;

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function text(value) {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function firstText(record, keys) {
  const source = asRecord(record);
  if (!source) return null;
  for (const key of keys) {
    const value = text(source[key]);
    if (value) return value;
  }
  return null;
}

function firstNumber(record, keys) {
  const source = asRecord(record);
  if (!source) return null;
  for (const key of keys) {
    const value = source[key];
    if (value === null || value === undefined || value === "") continue;
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
  }
  return null;
}

function firstTimestamp(record, keys) {
  const source = asRecord(record);
  if (!source) return null;
  for (const key of keys) {
    const value = source[key];
    if (value === null || value === undefined || value === "") continue;
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return numeric > 0 && numeric < 1e12 ? numeric * 1000 : numeric;
    }
    const parsed = Date.parse(String(value));
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function booleanValue(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value !== 0;
  const normalized = text(value)?.toLowerCase();
  if (["true", "1", "yes", "alive", "knocked", "down", "dbno"].includes(normalized)) {
    return true;
  }
  if (["false", "0", "no", "dead", "eliminated"].includes(normalized)) {
    return false;
  }
  return null;
}

function firstBoolean(record, keys) {
  const source = asRecord(record);
  if (!source) return null;
  for (const key of keys) {
    if (source[key] === null || source[key] === undefined || source[key] === "") continue;
    const normalized = booleanValue(source[key]);
    if (normalized !== null) return normalized;
  }
  return null;
}

function lookup(value) {
  return String(value || "").trim().toLowerCase();
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

const PLAYER_ID_KEYS = [
  "playerId",
  "playerID",
  "PlayerId",
  "PlayerID",
  "id",
  "ID",
  "uId",
  "UId",
  "uid",
  "UID",
  "playerKey",
  "externalPlayerId",
  "pubgPlayerId",
  "pubgAccountId",
  "playerOpenId",
  "playerOpenID",
  "PlayerOpenId",
  "PlayerOpenID",
  "openId",
  "OpenId",
  "inGameId",
];

function collectPlayerIds(record) {
  const source = asRecord(record);
  if (!source) return [];
  return unique(PLAYER_ID_KEYS.map((key) => lookup(source[key])));
}

function getPlayerName(record) {
  return firstText(record, [
    "playerName",
    "PlayerName",
    "name",
    "Name",
    "player",
    "ign",
    "IGN",
  ]);
}

function getTeamId(record) {
  return firstText(record, [
    "teamId",
    "teamID",
    "TeamId",
    "TeamID",
    "team_id",
    "team",
  ]);
}

function getTeamSlot(record) {
  const slot = firstNumber(record, [
    "teamSlot",
    "slot",
    "Slot",
    "slotNumber",
    "SlotNumber",
    "teamNo",
    "TeamNo",
    "teamNumber",
    "TeamNumber",
  ]);
  return slot === null ? null : Math.trunc(slot);
}

function playerIsAlive(record) {
  const explicitAlive = firstBoolean(record, ["isAlive", "IsAlive", "alive", "Alive", "bAlive"]);
  const explicitDead = firstBoolean(record, [
    "hasDied",
    "HasDied",
    "bHasDied",
    "dead",
    "isDead",
    "eliminated",
  ]);

  const stateValue = firstText(record, [
    "liveState",
    "LiveState",
    "live_state",
    "state",
    "State",
    "status",
    "Status",
  ]);
  if (stateValue !== null) {
    const numeric = Number(stateValue);
    if (Number.isFinite(numeric)) {
      if (numeric === 5) return false;
      if ([0, 1, 2, 3, 4].includes(numeric)) return true;
    }
    const label = stateValue.toLowerCase();
    if (["dead", "eliminated"].includes(label)) return false;
    if (["alive", "live", "running", "down", "knocked", "dbno"].includes(label)) {
      return true;
    }
  }

  // PCOB can retain bHasDied=true while a recalled player has already moved
  // back to liveState 0-4. A known liveState is the authoritative lifecycle
  // signal; only consult the older booleans when that state is unavailable.
  if (explicitAlive === false || explicitDead === true) return false;

  const health = firstNumber(record, ["health", "Health", "hp", "HP", "currentHealth", "CurrentHealth"]);
  if (health !== null) return health > 0;
  if (explicitAlive === true || explicitDead === false) return true;
  return null;
}

function playerIsKnocked(record) {
  const stateValue = firstText(record, [
    "liveState",
    "LiveState",
    "state",
    "State",
    "status",
    "Status",
  ]);
  if (stateValue !== null) {
    const numeric = Number(stateValue);
    if (Number.isFinite(numeric) && [0, 1, 2, 3, 4, 5].includes(numeric)) {
      return numeric === 4;
    }
    const label = stateValue.toLowerCase();
    if (["knocked", "down", "dbno"].includes(label)) return true;
    if (["alive", "live", "running", "dead", "eliminated"].includes(label)) {
      return false;
    }
  }

  const explicit = firstBoolean(record, [
    "isKnocked",
    "IsKnocked",
    "knocked",
    "down",
    "isDown",
    "isDowned",
  ]);
  return explicit ?? false;
}

function normalizePlayer(record, index, source) {
  const raw = asRecord(record);
  if (!raw) return null;
  const ids = collectPlayerIds(raw);
  const name = getPlayerName(raw);
  if (ids.length === 0 && !name) return null;
  const alive = playerIsAlive(raw);
  const knocked = alive === false ? false : playerIsKnocked(raw);
  const health = firstNumber(raw, ["health", "Health", "hp", "HP", "currentHealth", "CurrentHealth"]);
  return {
    id: ids[0] || `player-${index + 1}`,
    ids,
    name: name || "PLAYER",
    teamId: getTeamId(raw),
    teamSlot: getTeamSlot(raw),
    playerNumber: firstNumber(raw, ["playerNumber", "PlayerNumber", "memberNo", "MemberNo"]),
    firstSeen: index,
    avatarUrl: firstText(raw, ["avatarUrl", "AvatarUrl", "photoUrl", "PhotoUrl", "picUrl", "PicUrl"]),
    kills: firstNumber(raw, ["kills", "Kills", "killNum", "KillNum", "killCount", "killnum", "kill_count"]),
    knockouts: firstNumber(raw, ["knockouts", "knocks", "Knockouts", "KnockNum", "knockNum"]),
    health: health === null ? null : Math.max(0, Math.min(100, health)),
    alive,
    knocked,
    damage: firstNumber(raw, ["damageDealt", "DamageDealt", "damage", "Damage", "totalDamage", "TotalDamage"]),
    longestEliminationDistanceMeters: firstNumber(raw, [
      "longestEliminationDistanceM",
      "longestEliminationDistanceMeters",
      "maxKillDistance",
      "MaxKillDistance",
    ]),
    airdropsLooted: firstNumber(raw, [
      "airdropLootCount",
      "airdropsLooted",
      "gotAirDropNum",
      "GotAirDropNum",
    ]),
    source,
    raw,
  };
}

function playerMatches(left, right) {
  if (!left || !right) return false;
  if (left.ids.some((id) => right.ids.includes(id))) return true;
  const leftName = lookup(left.name);
  const rightName = lookup(right.name);
  if (!leftName || leftName !== rightName) return false;
  const leftTeam = lookup(left.teamId || left.teamSlot);
  const rightTeam = lookup(right.teamId || right.teamSlot);
  return !leftTeam || !rightTeam || leftTeam === rightTeam;
}

function mergePlayer(primary, fallback) {
  if (!primary) return fallback;
  if (!fallback) return primary;
  return {
    ...fallback,
    ...primary,
    ids: unique([...primary.ids, ...fallback.ids]),
    avatarUrl: primary.avatarUrl || fallback.avatarUrl,
    teamId: primary.teamId || fallback.teamId,
    teamSlot: primary.teamSlot ?? fallback.teamSlot,
    playerNumber: primary.playerNumber ?? fallback.playerNumber,
    kills: primary.kills ?? fallback.kills,
    knockouts: primary.knockouts ?? fallback.knockouts,
    health: primary.health ?? fallback.health,
    alive: primary.alive ?? fallback.alive,
    knocked: primary.knocked ?? fallback.knocked,
    damage: primary.damage ?? fallback.damage,
    longestEliminationDistanceMeters:
      primary.longestEliminationDistanceMeters ?? fallback.longestEliminationDistanceMeters,
    airdropsLooted: primary.airdropsLooted ?? fallback.airdropsLooted,
  };
}

function normalizeTeam(record, index, source) {
  const raw = asRecord(record);
  if (!raw) return null;
  const teamId = getTeamId(raw) || firstText(raw, ["id", "ID"]);
  const slot = getTeamSlot(raw);
  const teamName = firstText(raw, ["teamName", "TeamName", "name", "Name"]);
  const teamTag = firstText(raw, ["teamTag", "TeamTag", "tag", "Tag", "shortName"]);
  if (!teamId && slot === null && !teamName && !teamTag) return null;
  return {
    id: teamId || (slot === null ? `team-${index + 1}` : String(slot)),
    teamId,
    slot,
    teamName,
    teamTag,
    logoUrl: firstText(raw, ["logoUrl", "LogoUrl", "localLogoUrl", "teamLogoUrl"]),
    kills: firstNumber(raw, ["kills", "Kills", "teamKills", "TeamKills", "killNum", "KillNum"]),
    source,
  };
}

function teamMatches(left, right) {
  if (!left || !right) return false;
  const leftId = lookup(left.teamId || left.id);
  const rightId = lookup(right.teamId || right.id);
  if (leftId && rightId && leftId === rightId) return true;
  if (left.slot !== null && right.slot !== null && left.slot === right.slot) return true;
  const leftName = lookup(left.teamName);
  const rightName = lookup(right.teamName);
  if (leftName && rightName && leftName === rightName) return true;
  const leftTag = lookup(left.teamTag);
  const rightTag = lookup(right.teamTag);
  return Boolean(leftTag && rightTag && leftTag === rightTag);
}

function mergeTeam(primary, fallback) {
  if (!primary) return fallback;
  if (!fallback) return primary;
  return {
    ...fallback,
    ...primary,
    teamId: primary.teamId || fallback.teamId,
    slot: primary.slot ?? fallback.slot,
    teamName: primary.teamName || fallback.teamName,
    teamTag: primary.teamTag || fallback.teamTag,
    logoUrl: primary.logoUrl || fallback.logoUrl,
    kills: primary.kills ?? fallback.kills,
  };
}

function buildGoldFocusedWidgetState({
  matchId = null,
  focus = null,
  localObserverSnapshot = null,
  localWidgetSnapshot = null,
  playerAssetsVersion = null,
  now = Date.now(),
  staleAfterMs = DEFAULT_STALE_AFTER_MS,
} = {}) {
  const observer = asRecord(localObserverSnapshot);
  const widget = asRecord(localWidgetSnapshot);
  const directPlayers = Array.isArray(observer?.players) ? observer.players : [];
  const enginePlayers = Array.isArray(widget?.players?.players)
    ? widget.players.players
    : Array.isArray(widget?.players)
      ? widget.players
      : [];
  const players = [];
  for (const [source, sourcePlayers] of [
    ["direct-observer", directPlayers],
    ["launcher-engine", enginePlayers],
  ]) {
    sourcePlayers.forEach((record, index) => {
      const normalized = normalizePlayer(record, index, source);
      if (!normalized) return;
      const existingIndex = players.findIndex((candidate) => playerMatches(candidate, normalized));
      if (existingIndex < 0) {
        normalized.firstSeen = players.length;
        players.push(normalized);
      }
      else if (source === "direct-observer") players[existingIndex] = mergePlayer(normalized, players[existingIndex]);
      else players[existingIndex] = mergePlayer(players[existingIndex], normalized);
    });
  }

  const directTeams = Array.isArray(observer?.teams) ? observer.teams : [];
  const brandingTeams = Array.isArray(widget?.teamBranding?.teams)
    ? widget.teamBranding.teams
    : [];
  const teams = [];
  for (const [source, sourceTeams] of [
    ["direct-observer", directTeams],
    ["launcher-branding", brandingTeams],
  ]) {
    sourceTeams.forEach((record, index) => {
      const normalized = normalizeTeam(record, index, source);
      if (!normalized) return;
      const existingIndex = teams.findIndex((candidate) => teamMatches(candidate, normalized));
      if (existingIndex < 0) teams.push(normalized);
      else if (source === "launcher-branding") teams[existingIndex] = mergeTeam(normalized, teams[existingIndex]);
      else teams[existingIndex] = mergeTeam(teams[existingIndex], normalized);
    });
  }

  const focusRecord = asRecord(focus);
  if (!focusRecord) {
    return {
      matchId: text(matchId),
      updatedAt: null,
      stale: false,
      focus: null,
      roster: null,
      playerStats: null,
      playerAssetsVersion: text(playerAssetsVersion) || "0:0",
    };
  }

  const focusIds = collectPlayerIds(focusRecord);
  const focusName = lookup(getPlayerName(focusRecord));
  const focusedPlayer =
    players.find((player) => focusIds.some((id) => player.ids.includes(id))) ||
    players.find((player) => focusName && lookup(player.name) === focusName) ||
    null;
  const focusTeamCandidate = {
    id: getTeamId(focusRecord),
    teamId: getTeamId(focusRecord) || focusedPlayer?.teamId || null,
    slot: getTeamSlot(focusRecord) ?? focusedPlayer?.teamSlot ?? null,
    teamName: firstText(focusRecord, ["teamName", "TeamName"]),
    teamTag: firstText(focusRecord, ["teamTag", "TeamTag", "tag", "Tag"]),
  };
  const focusedTeam =
    teams.find((team) => teamMatches(team, focusTeamCandidate)) ||
    normalizeTeam(focusTeamCandidate, 0, "observer-focus");
  const teamPlayers = players
    .filter((player) =>
      teamMatches(
        {
          id: player.teamId,
          teamId: player.teamId,
          slot: player.teamSlot,
          teamName: null,
          teamTag: null,
        },
        focusedTeam || focusTeamCandidate,
      ),
    )
    .sort((left, right) => {
      return (
        (left.playerNumber ?? 99) - (right.playerNumber ?? 99) ||
        left.firstSeen - right.firstSeen
      );
    })
    .slice(0, 4);

  const derivedKills = teamPlayers.some((player) => player.kills !== null)
    ? teamPlayers.reduce((total, player) => total + (player.kills ?? 0), 0)
    : null;
  const updatedAt =
    firstTimestamp(observer, ["receivedAt", "timestamp", "updatedAt"]) ??
    firstTimestamp(widget?.players, ["receivedAt", "timestamp", "updatedAt"]) ??
    null;
  const stale = updatedAt === null || now - updatedAt > staleAfterMs;

  function publicPlayer(player) {
    return {
      id: player.id,
      lookupIds: player.ids,
      name: player.name,
      avatarUrl: player.avatarUrl,
      kills: player.kills,
      knockouts: player.knockouts,
      utilities: {
        hasData: false,
        total: null,
      },
      health: player.health,
      alive: player.alive,
      knocked: player.knocked,
      status:
        player.alive === false
          ? "eliminated"
          : player.knocked
            ? "knocked"
            : player.alive === true
              ? "alive"
              : "unknown",
    };
  }

  return {
    matchId: text(matchId),
    updatedAt,
    stale,
    focus: focusedPlayer ? publicPlayer(focusedPlayer) : {
      id: focusIds[0] || null,
      lookupIds: focusIds,
      name: getPlayerName(focusRecord),
    },
    roster:
      focusedTeam || teamPlayers.length > 0
        ? {
            teamId: focusedTeam?.teamId || focusedPlayer?.teamId || null,
            teamSlot: focusedTeam?.slot ?? focusedPlayer?.teamSlot ?? null,
            teamName:
              focusedTeam?.teamName ||
              focusedTeam?.teamTag ||
              firstText(focusRecord, ["teamName", "TeamName", "teamTag", "TeamTag"]) ||
              "TEAM",
            teamTag: focusedTeam?.teamTag || null,
            logoUrl: focusedTeam?.logoUrl || null,
            kills: focusedTeam?.kills ?? derivedKills,
            players: teamPlayers.map(publicPlayer),
          }
        : null,
    playerStats: {
      damage: focusedPlayer?.damage ?? null,
      longestEliminationDistanceMeters:
        focusedPlayer?.longestEliminationDistanceMeters ?? null,
      airdropsLooted: focusedPlayer?.airdropsLooted ?? null,
    },
    playerAssetsVersion: text(playerAssetsVersion) || "0:0",
  };
}

module.exports = {
  DEFAULT_STALE_AFTER_MS,
  buildGoldFocusedWidgetState,
};
