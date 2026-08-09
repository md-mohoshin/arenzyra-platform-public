"use strict";

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : null;
}

function cleanString(value, maxLength = 160) {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

function finiteNumber(value) {
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : Number.NaN;
  return Number.isFinite(numeric) ? numeric : null;
}

function finiteInteger(value) {
  const numeric = finiteNumber(value);
  return numeric === null ? null : Math.trunc(numeric);
}

function normalizeTeam(team) {
  const record = asRecord(team) || {};
  return {
    name: cleanString(record.name, 80),
    score: finiteInteger(record.score),
    consecutiveRoundLosses: finiteInteger(record.consecutive_round_losses),
    timeoutsRemaining: finiteInteger(record.timeouts_remaining),
    matchesWonThisSeries: finiteInteger(record.matches_won_this_series),
  };
}

function normalizeWeapon(weapon) {
  const record = asRecord(weapon) || {};
  return {
    name: cleanString(record.name, 80),
    type: cleanString(record.type, 40),
    state: cleanString(record.state, 32),
    ammoClip: finiteInteger(record.ammo_clip),
    ammoClipMax: finiteInteger(record.ammo_clip_max),
    ammoReserve: finiteInteger(record.ammo_reserve),
  };
}

function normalizeRoundWins(roundWins) {
  const record = asRecord(roundWins) || {};
  return Object.entries(record)
    .slice(0, 64)
    .map(([roundNumber, result]) => ({
      roundNumber: cleanString(roundNumber, 16),
      result: cleanString(result, 48),
    }));
}

function normalizePlayer(steamId, player) {
  const record = asRecord(player) || {};
  const state = asRecord(record.state) || {};
  const stats = asRecord(record.match_stats) || {};
  const weaponsRecord = asRecord(record.weapons) || {};

  return {
    steamId: cleanString(steamId || record.steamid, 40),
    name: cleanString(record.name, 80),
    team: cleanString(record.team, 8),
    activity: cleanString(record.activity, 24),
    observerSlot: finiteInteger(record.observer_slot),
    state: {
      health: finiteInteger(state.health),
      armor: finiteInteger(state.armor),
      helmet: typeof state.helmet === "boolean" ? state.helmet : null,
      flashed: finiteInteger(state.flashed),
      smoked: finiteInteger(state.smoked),
      burning: finiteInteger(state.burning),
      money: finiteInteger(state.money),
      roundKills: finiteInteger(state.round_kills),
      roundHeadshotKills: finiteInteger(state.round_killhs),
      equipmentValue: finiteInteger(state.equip_value),
    },
    stats: {
      kills: finiteInteger(stats.kills),
      assists: finiteInteger(stats.assists),
      deaths: finiteInteger(stats.deaths),
      mvps: finiteInteger(stats.mvps),
      score: finiteInteger(stats.score),
    },
    weapons: Object.values(weaponsRecord).map(normalizeWeapon),
  };
}

function comparePlayers(left, right) {
  const leftSlot =
    left.observerSlot === 0
      ? 10
      : left.observerSlot ?? Number.MAX_SAFE_INTEGER;
  const rightSlot =
    right.observerSlot === 0
      ? 10
      : right.observerSlot ?? Number.MAX_SAFE_INTEGER;
  if (leftSlot !== rightSlot) {
    return leftSlot - rightSlot;
  }
  return String(left.name || left.steamId || "").localeCompare(
    String(right.name || right.steamId || ""),
  );
}

function normalizeCs2GsiPayload(payload, options = {}) {
  const root = asRecord(payload);
  if (!root) {
    throw new Error("CS2 GSI payload must be a JSON object.");
  }

  const provider = asRecord(root.provider) || {};
  const appId = finiteInteger(provider.appid);
  if (appId !== 730) {
    throw new Error("CS2 GSI payload provider.appid must be 730.");
  }

  const map = asRecord(root.map) || {};
  const round = asRecord(root.round) || {};
  const bomb = asRecord(root.bomb) || {};
  const countdowns = asRecord(root.phase_countdowns) || {};
  const allPlayers = asRecord(root.allplayers);
  const observerRosterCount = allPlayers
    ? Object.keys(allPlayers).length
    : 0;
  const players = allPlayers
    ? Object.entries(allPlayers).map(([steamId, player]) =>
        normalizePlayer(steamId, player),
      )
    : root.player
      ? [normalizePlayer(root.player?.steamid, root.player)]
      : [];

  players.sort(comparePlayers);

  const receivedAt =
    typeof options.receivedAt === "string" && options.receivedAt
      ? options.receivedAt
      : new Date().toISOString();

  return {
    schemaVersion: 1,
    source: "CS2_GSI",
    game: "CS2",
    receivedAt,
    provider: {
      appId,
      name: cleanString(provider.name, 80),
      version: finiteInteger(provider.version),
      timestamp: finiteInteger(provider.timestamp),
    },
    match: {
      mapName: cleanString(map.name, 80),
      mode: cleanString(map.mode, 40),
      phase: cleanString(map.phase, 32),
      roundNumber: finiteInteger(map.round),
      matchesToWinSeries: finiteInteger(map.num_matches_to_win_series),
      currentSpectators: finiteInteger(map.current_spectators),
      ct: normalizeTeam(map.team_ct),
      t: normalizeTeam(map.team_t),
      roundWins: normalizeRoundWins(map.round_wins),
    },
    round: {
      phase: cleanString(round.phase, 32),
      winningTeam: cleanString(round.win_team, 8),
      bombState: cleanString(round.bomb, 32),
    },
    bomb: {
      state: cleanString(bomb.state, 32),
      playerSteamId: cleanString(bomb.player, 40),
      position: cleanString(bomb.position, 96),
      countdown: finiteNumber(bomb.countdown),
    },
    phaseCountdown: {
      phase: cleanString(countdowns.phase, 32),
      secondsRemaining: finiteNumber(countdowns.phase_ends_in),
    },
    watchedPlayerSteamId: cleanString(root.player?.steamid, 40),
    hasAllPlayersPayload: allPlayers !== null,
    observerRosterCount,
    players,
  };
}

module.exports = {
  normalizeCs2GsiPayload,
};
