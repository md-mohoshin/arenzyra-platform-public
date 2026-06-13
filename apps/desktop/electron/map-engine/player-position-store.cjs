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

function normalizeAngleDegrees(value) {
  const numeric = toFiniteNumber(value);
  if (numeric === null) {
    return null;
  }

  return ((numeric % 360) + 360) % 360;
}

function normalizeDirectionVector(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : null;
  if (!source) {
    return null;
  }

  const x = toFiniteNumber(source.x ?? source.X);
  const y = toFiniteNumber(source.y ?? source.Y);
  if (x === null || y === null) {
    return null;
  }

  const magnitude = Math.hypot(x, y);
  if (!Number.isFinite(magnitude) || magnitude <= 0.0001) {
    return null;
  }

  return {
    x: x / magnitude,
    y: y / magnitude,
  };
}

function normalizeMapKey(value) {
  return String(value || "").trim().toLowerCase();
}

const SOURCE_PRIORITY = new Map([
  ["backend-canonical", 110],
  ["canonical-backend", 110],
  ["telemetry-bridge", 100],
  ["launcher-bridge", 100],
  ["backend", 90],
  ["direct-observer", 50],
  ["mock", 10],
  ["unknown", 0],
]);

function normalizeSource(value) {
  const source = String(value || "").trim().toLowerCase();
  return source || "unknown";
}

function sourcePriority(source) {
  return SOURCE_PRIORITY.get(normalizeSource(source)) ?? 0;
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
    inVehicle: player.inVehicle,
    health: player.health,
    isFiring: player.isFiring,
    fireAngle: player.fireAngle,
    fireDirection: player.fireDirection ? { ...player.fireDirection } : null,
  };
}

function cloneUpdate(update) {
  return {
    mapKey: update.mapKey,
    players: update.players.map(clonePlayer),
    timestamp: update.timestamp,
    receivedAt: update.receivedAt,
    source: update.source,
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
              inVehicle: toNullableBoolean(player?.inVehicle),
              health: toFiniteNumber(player?.health),
              isFiring: toNullableBoolean(player?.isFiring) === true,
              fireAngle: normalizeAngleDegrees(player?.fireAngle),
              fireDirection: normalizeDirectionVector(player?.fireDirection),
            };
          })
          .filter(Boolean)
      : [];

    const receivedAt = toFiniteNumber(update?.receivedAt) ?? Date.now();
    const timestamp = toFiniteNumber(update?.timestamp) ?? receivedAt;
    const source = normalizeSource(update?.source);
    const current = updatesByMap.get(mapKey);
    if (
      current &&
      (timestamp < current.timestamp ||
        (timestamp === current.timestamp &&
          sourcePriority(source) < sourcePriority(current.source)) ||
        (timestamp === current.timestamp &&
          sourcePriority(source) === sourcePriority(current.source) &&
          receivedAt < current.receivedAt))
    ) {
      return null;
    }

    const nextUpdate = {
      mapKey,
      players: normalizedPlayers,
      timestamp,
      receivedAt,
      source,
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
