"use strict";

function toFiniteNumber(value) {
  const numeric =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(numeric) ? numeric : null;
}

function cloneEvent(event) {
  return {
    id: event.id,
    kind: event.kind,
    x: event.x,
    y: event.y,
    timestamp: event.timestamp,
    killerPlayerId: event.killerPlayerId,
    killerTeamId: event.killerTeamId,
    killerName: event.killerName,
    victimPlayerId: event.victimPlayerId,
    victimTeamId: event.victimTeamId,
    victimName: event.victimName,
  };
}

function createCombatMemoryStore({
  retentionMs = 30_000,
  maxHistory = 90,
} = {}) {
  const events = [];
  const seenIds = new Map();

  function purge(now = Date.now()) {
    let writeIndex = 0;

    for (let readIndex = 0; readIndex < events.length; readIndex += 1) {
      const event = events[readIndex];
      if (!event || now - event.timestamp > retentionMs) {
        if (event?.id) {
          seenIds.delete(event.id);
        }
        continue;
      }

      events[writeIndex] = event;
      writeIndex += 1;
    }

    events.length = writeIndex;

    while (events.length > maxHistory) {
      const removed = events.shift();
      if (removed?.id) {
        seenIds.delete(removed.id);
      }
    }
  }

  function add(event, now = Date.now()) {
    if (!event || typeof event !== "object") {
      return false;
    }

    const id = String(event.id || "").trim();
    const x = toFiniteNumber(event.x);
    const y = toFiniteNumber(event.y);
    const timestamp = toFiniteNumber(event.timestamp) ?? now;

    if (!id || x === null || y === null) {
      return false;
    }

    purge(now);
    if (now - timestamp > retentionMs || seenIds.has(id)) {
      return false;
    }

    const normalized = {
      id,
      kind: event.kind === "knock" ? "knock" : "kill",
      x,
      y,
      timestamp,
      killerPlayerId:
        typeof event.killerPlayerId === "string" && event.killerPlayerId.trim()
          ? event.killerPlayerId.trim()
          : null,
      killerTeamId:
        typeof event.killerTeamId === "string" && event.killerTeamId.trim()
          ? event.killerTeamId.trim()
          : null,
      killerName:
        typeof event.killerName === "string" && event.killerName.trim()
          ? event.killerName.trim()
          : null,
      victimPlayerId:
        typeof event.victimPlayerId === "string" && event.victimPlayerId.trim()
          ? event.victimPlayerId.trim()
          : null,
      victimTeamId:
        typeof event.victimTeamId === "string" && event.victimTeamId.trim()
          ? event.victimTeamId.trim()
          : null,
      victimName:
        typeof event.victimName === "string" && event.victimName.trim()
          ? event.victimName.trim()
          : null,
    };

    events.push(normalized);
    seenIds.set(normalized.id, normalized.timestamp);

    while (events.length > maxHistory) {
      const removed = events.shift();
      if (removed?.id) {
        seenIds.delete(removed.id);
      }
    }

    return true;
  }

  function addMany(list, now = Date.now()) {
    let added = 0;
    const source = Array.isArray(list) ? list : [];
    for (const event of source) {
      if (add(event, now)) {
        added += 1;
      }
    }
    return added;
  }

  function getEvents(now = Date.now()) {
    purge(now);
    return events.map(cloneEvent);
  }

  function count(now = Date.now()) {
    purge(now);
    return events.length;
  }

  function clear() {
    events.length = 0;
    seenIds.clear();
  }

  return {
    add,
    addMany,
    clear,
    count,
    getEvents,
    purge,
  };
}

module.exports = {
  createCombatMemoryStore,
};
