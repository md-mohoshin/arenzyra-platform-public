"use strict";

function toFiniteNumber(value) {
  const numeric =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(numeric) ? numeric : null;
}

function toNullableBoolean(value) {
  if (typeof value === "boolean") {
    return value;
  }
  return null;
}

function normalizeMapKey(value) {
  return String(value || "").trim().toLowerCase();
}

function clonePlayer(player) {
  return {
    playerId: player.playerId,
    playerName: player.playerName,
    teamId: player.teamId,
    teamSlot: player.teamSlot,
    x: player.x,
    y: player.y,
    kills: player.kills,
    alive: player.alive,
    knocked: player.knocked,
    health: player.health,
  };
}

function cloneUpdate(update) {
  return {
    mapKey: update.mapKey,
    players: update.players.map(clonePlayer),
    timestamp: update.timestamp,
    receivedAt: update.receivedAt,
    coordinate: update.coordinate ? { ...update.coordinate } : null,
    warnings: [...update.warnings],
  };
}

function createPlayerPositionStore() {
  const updatesByMap = new Map();

  function set(update) {
    const mapKey = normalizeMapKey(update?.mapKey);
    if (!mapKey) {
      return null;
    }

    const normalizedPlayers = Array.isArray(update?.players)
      ? update.players
          .map((player, index) => {
            const x = toFiniteNumber(player?.x);
            const y = toFiniteNumber(player?.y);
            if (x === null || y === null) {
              return null;
            }

            return {
              playerId:
                String(player?.playerId || "").trim() || `player-${index + 1}`,
              playerName:
                typeof player?.playerName === "string" && player.playerName.trim()
                  ? player.playerName.trim()
                  : null,
              teamId:
                typeof player?.teamId === "string" && player.teamId.trim()
                  ? player.teamId.trim()
                  : null,
              teamSlot: toFiniteNumber(player?.teamSlot),
              x,
              y,
              kills: Math.max(0, Math.trunc(toFiniteNumber(player?.kills) ?? 0)),
              alive: toNullableBoolean(player?.alive),
              knocked: toNullableBoolean(player?.knocked),
              health: toFiniteNumber(player?.health),
            };
          })
          .filter(Boolean)
      : [];

    const receivedAt = toFiniteNumber(update?.receivedAt) ?? Date.now();
    const nextUpdate = {
      mapKey,
      players: normalizedPlayers,
      timestamp: toFiniteNumber(update?.timestamp) ?? receivedAt,
      receivedAt,
      coordinate: update?.coordinate ? { ...update.coordinate } : null,
      warnings: Array.isArray(update?.warnings) ? [...update.warnings] : [],
    };

    updatesByMap.set(mapKey, nextUpdate);
    return cloneUpdate(nextUpdate);
  }

  function get(mapKey) {
    const current = updatesByMap.get(normalizeMapKey(mapKey));
    if (!current) {
      return null;
    }

    return cloneUpdate(current);
  }

  function clear(mapKey) {
    if (!mapKey) {
      updatesByMap.clear();
      return;
    }

    updatesByMap.delete(normalizeMapKey(mapKey));
  }

  function getLatest() {
    let latest = null;
    for (const value of updatesByMap.values()) {
      if (!latest || value.timestamp >= latest.timestamp) {
        latest = value;
      }
    }

    return latest ? cloneUpdate(latest) : null;
  }

  return {
    set,
    get,
    clear,
    getLatest,
  };
}

module.exports = {
  createPlayerPositionStore,
};
