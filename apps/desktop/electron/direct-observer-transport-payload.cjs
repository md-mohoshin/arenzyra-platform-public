"use strict";

const {
  sanitizeObserverTelemetryPayload,
} = require("./observer-telemetry-contract.cjs");

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function cloneShallow(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => (asRecord(entry) ? { ...entry } : entry));
  }
  if (asRecord(value)) {
    return { ...value };
  }
  return value;
}

function listFrom(value, keys = []) {
  if (Array.isArray(value)) {
    return cloneShallow(value);
  }

  const record = asRecord(value);
  if (!record) {
    return [];
  }

  for (const key of keys) {
    if (Array.isArray(record[key])) {
      return cloneShallow(record[key]);
    }
  }

  return [];
}

function hasCircleCoreFields(record) {
  if (!record) {
    return false;
  }

  return (
    record.CircleArray !== undefined ||
    record.safeZone !== undefined ||
    record.safezone !== undefined ||
    record.blueZone !== undefined ||
    record.nextZone !== undefined ||
    record.nextzone !== undefined ||
    record.whiteZone !== undefined ||
    record.zoneCenter !== undefined ||
    record.zoneRadius !== undefined ||
    record.phase !== undefined ||
    record.phaseIndex !== undefined ||
    record.circlePhase !== undefined ||
    record.CircleIndex !== undefined ||
    record.circleIndex !== undefined ||
    record.CircleStatus !== undefined ||
    record.circleStatus !== undefined ||
    record.Counter !== undefined ||
    record.MaxTime !== undefined
  );
}

function extractCurrentCirclePayload(payload) {
  const root = asRecord(payload);
  if (!root) {
    return {};
  }

  const allInfo = asRecord(root.allinfo ?? root.allInfo);
  const candidates = [root, allInfo].filter(Boolean);
  for (const source of candidates) {
    if (hasCircleCoreFields(source)) {
      return cloneShallow(source);
    }

    for (const key of [
      "circle",
      "Circle",
      "circleInfo",
      "CircleInfo",
      "zone",
      "data",
      "Data",
      "result",
      "Result",
    ]) {
      const nested = asRecord(source[key]);
      if (hasCircleCoreFields(nested)) {
        return cloneShallow(nested);
      }
    }
  }

  return {};
}

function normalizeKillInfoPayload(payload) {
  const list = listFrom(payload, [
    "kills",
    "killInfo",
    "killInfoList",
    "KillInfo",
    "KillInfoList",
    "KillList",
    "killList",
  ]);
  if (list.length > 0) {
    return list;
  }

  const record = asRecord(payload);
  return record && Object.keys(record).length > 0 ? [cloneShallow(record)] : [];
}

function normalizeBackpackInfoPayload(payload) {
  const list = listFrom(payload, [
    "TeamBackpackInfo",
    "teamBackpackInfo",
    "TeamBackPackInfo",
    "teamBackPackInfo",
    "TeamBackpackList",
    "teamBackpackList",
    "TeamBackPackList",
    "teamBackPackList",
    "backpacks",
    "Backpacks",
    "data",
    "Data",
  ]);
  if (list.length > 0) {
    return list;
  }

  const record = asRecord(payload);
  if (
    record &&
    Object.keys(record).length > 0 &&
    (record.teamId !== undefined ||
      record.TeamId !== undefined ||
      record.team !== undefined ||
      record.Team !== undefined) &&
    (record.items !== undefined ||
      record.Items !== undefined ||
      record.backpack !== undefined ||
      record.Backpack !== undefined ||
      record.equipment !== undefined ||
      record.Equipment !== undefined)
  ) {
    return [cloneShallow(record)];
  }

  return [];
}

const BACKPACK_TEAM_ID_KEYS = [
  "teamId",
  "TeamId",
  "teamID",
  "TeamID",
  "team",
  "Team",
];
const BACKPACK_SLOT_KEYS = [
  "slot",
  "Slot",
  "teamNo",
  "TeamNo",
  "teamNumber",
  "TeamNumber",
  "teamIndex",
  "TeamIndex",
  "order",
  "Order",
];
const BACKPACK_PLAYER_ID_KEYS = [
  "playerId",
  "PlayerId",
  "playerID",
  "PlayerID",
  "playerKey",
  "PlayerKey",
  "uid",
  "uId",
  "UId",
  "UID",
];

function textKey(value) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  return null;
}

function numberKey(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function firstTextKey(record, keys) {
  const source = asRecord(record);
  if (!source) {
    return null;
  }
  for (const key of keys) {
    const value = textKey(source[key]);
    if (value) {
      return value;
    }
  }
  return null;
}

function firstNumberKey(record, keys) {
  const source = asRecord(record);
  if (!source) {
    return null;
  }
  for (const key of keys) {
    const value = numberKey(source[key]);
    if (value !== null) {
      return value;
    }
  }
  return null;
}

function backpackIdentity(entry) {
  const source = asRecord(entry);
  if (!source) {
    return null;
  }

  const playerId = firstTextKey(source, BACKPACK_PLAYER_ID_KEYS);
  if (playerId) {
    return `player:${playerId}`;
  }

  const teamId = firstTextKey(source, BACKPACK_TEAM_ID_KEYS);
  if (teamId) {
    return `team:${teamId}`;
  }

  const slot = firstNumberKey(source, BACKPACK_SLOT_KEYS);
  if (slot !== null) {
    return `slot:${Math.trunc(slot)}`;
  }

  return null;
}

function backpackTeamId(entry) {
  const source = asRecord(entry);
  return source ? firstTextKey(source, BACKPACK_TEAM_ID_KEYS) : null;
}

function backpackSlot(entry) {
  const source = asRecord(entry);
  if (!source) {
    return null;
  }
  const slot = firstNumberKey(source, [
    ...BACKPACK_SLOT_KEYS,
    ...BACKPACK_TEAM_ID_KEYS,
  ]);
  return slot === null ? null : Math.trunc(slot);
}

function buildBackpackReplacementScope(entries) {
  const slots = new Set();
  const teamIds = new Set();

  for (const entry of Array.isArray(entries) ? entries : []) {
    const slot = backpackSlot(entry);
    if (slot !== null) {
      slots.add(slot);
    }

    const teamId = backpackTeamId(entry);
    if (teamId) {
      teamIds.add(teamId);
    }
  }

  return {
    slots,
    teamIds,
    hasScope: slots.size > 0 || teamIds.size > 0,
  };
}

function isBackpackReplacedByIncoming(entry, replacementScope) {
  if (!replacementScope?.hasScope) {
    return false;
  }

  const slot = backpackSlot(entry);
  if (slot !== null && replacementScope.slots.has(slot)) {
    return true;
  }

  const teamId = backpackTeamId(entry);
  return Boolean(teamId && replacementScope.teamIds.has(teamId));
}

function mergeBackpackInfoRecord(previous, incoming) {
  const previousRecord = asRecord(previous);
  const incomingRecord = asRecord(incoming);
  if (!previousRecord || !incomingRecord) {
    return cloneShallow(incoming);
  }

  const merged = { ...previousRecord, ...incomingRecord };
  for (const [key, value] of Object.entries(previousRecord)) {
    if (merged[key] === undefined || merged[key] === null || merged[key] === "") {
      merged[key] = value;
    }
  }
  return merged;
}

function mergeBackpackInfoLists(current, incoming) {
  const currentList = Array.isArray(current) ? current : [];
  const incomingList = Array.isArray(incoming) ? incoming : [];
  if (incomingList.length === 0) {
    return cloneShallow(currentList);
  }

  const replacementScope = buildBackpackReplacementScope(incomingList);
  const merged = [];
  const byIdentity = new Map();

  for (const entry of currentList) {
    if (isBackpackReplacedByIncoming(entry, replacementScope)) {
      continue;
    }
    const identity = backpackIdentity(entry);
    const copy = cloneShallow(entry);
    if (identity && byIdentity.has(identity)) {
      const existing = byIdentity.get(identity);
      const nextEntry = mergeBackpackInfoRecord(existing.entry, copy);
      merged[existing.index] = nextEntry;
      byIdentity.set(identity, { index: existing.index, entry: nextEntry });
      continue;
    }
    if (identity) {
      byIdentity.set(identity, { index: merged.length, entry: copy });
    }
    merged.push(copy);
  }

  for (const entry of incomingList) {
    const identity = backpackIdentity(entry);
    const copy = cloneShallow(entry);
    if (identity && byIdentity.has(identity)) {
      const existing = byIdentity.get(identity);
      const nextEntry = mergeBackpackInfoRecord(existing.entry, copy);
      merged[existing.index] = nextEntry;
      byIdentity.set(identity, { index: existing.index, entry: nextEntry });
      continue;
    }
    if (identity) {
      byIdentity.set(identity, { index: merged.length, entry: copy });
    }
    merged.push(copy);
  }

  return merged;
}

function createDirectObserverTransportState() {
  const state = {
    allInfo: {},
    playerInfoList: [],
    teamInfoList: [],
    teamBackpackInfo: [],
    killInfo: [],
    circleInfo: {},
    observingPlayer: {},
    updatedAtMs: 0,
    generation: 1,
    circleVersion: 0,
  };

  function markUpdated() {
    state.updatedAtMs = Date.now();
  }

  return {
    state,
    ingestTotalMessage(payload) {
      const allInfo = asRecord(payload?.allinfo ?? payload?.allInfo ?? payload) ?? {};
      state.allInfo = cloneShallow(allInfo);
      state.playerInfoList = listFrom(
        allInfo.TotalPlayerList ?? allInfo.playerInfoList,
      );
      state.teamInfoList = listFrom(allInfo.TeamInfoList ?? allInfo.teamInfoList);
      const nextTeamBackpackInfo = normalizeBackpackInfoPayload(allInfo);
      if (nextTeamBackpackInfo.length > 0) {
        state.teamBackpackInfo = mergeBackpackInfoLists(
          state.teamBackpackInfo,
          nextTeamBackpackInfo,
        );
      }
      const circle = extractCurrentCirclePayload({ allInfo });
      if (Object.keys(circle).length > 0) {
        state.circleInfo = circle;
        state.circleVersion += 1;
      }
      markUpdated();
      return state;
    },
    ingestPlayerList(payload) {
      state.playerInfoList = listFrom(payload, [
        "playerInfoList",
        "TotalPlayerList",
        "players",
      ]);
      markUpdated();
      return state;
    },
    ingestTeamList(payload) {
      state.teamInfoList = listFrom(payload, [
        "teamInfoList",
        "TeamInfoList",
        "teams",
      ]);
      markUpdated();
      return state;
    },
    ingestBackpackInfo(payload) {
      state.teamBackpackInfo = mergeBackpackInfoLists(
        state.teamBackpackInfo,
        normalizeBackpackInfoPayload(payload),
      );
      markUpdated();
      return state;
    },
    ingestKillInfo(payload) {
      state.killInfo.push(...normalizeKillInfoPayload(payload));
      markUpdated();
      return state;
    },
    ingestCircleInfo(payload) {
      state.circleInfo = extractCurrentCirclePayload(payload);
      state.circleVersion += 1;
      markUpdated();
      return state;
    },
    ingestObserver(payload) {
      state.observingPlayer = asRecord(payload) ? cloneShallow(payload) : {};
      markUpdated();
      return state;
    },
    ingestInferredCircle(payload) {
      const circle = extractCurrentCirclePayload(payload);
      if (Object.keys(circle).length > 0) {
        state.circleInfo = circle;
        state.circleVersion += 1;
        markUpdated();
      }
      return state;
    },
    captureTransientCursor() {
      return {
        generation: state.generation,
        killCount: state.killInfo.length,
        circleVersion: state.circleVersion,
      };
    },
    ackTransientEvents(cursor) {
      if (!cursor || cursor.generation !== state.generation) {
        return state;
      }
      const killCount = Math.max(
        0,
        Math.min(state.killInfo.length, Math.trunc(Number(cursor.killCount) || 0)),
      );
      if (killCount > 0) {
        state.killInfo.splice(0, killCount);
      }
      if (
        Number.isFinite(Number(cursor.circleVersion)) &&
        state.circleVersion <= Math.trunc(Number(cursor.circleVersion))
      ) {
        state.circleInfo = {};
      }
      return state;
    },
    clearTransientEvents() {
      state.killInfo = [];
      state.circleInfo = {};
      return state;
    },
    resetState() {
      state.allInfo = {};
      state.playerInfoList = [];
      state.teamInfoList = [];
      state.teamBackpackInfo = [];
      state.killInfo = [];
      state.circleInfo = {};
      state.observingPlayer = {};
      state.updatedAtMs = Date.now();
      state.generation += 1;
      state.circleVersion += 1;
      return state;
    },
    buildPayload({ matchId, sessionId = null, timestamp = Date.now() } = {}) {
      const payload = {
        matchId,
        sessionId: sessionId || null,
        timestamp,
        players: cloneShallow(state.playerInfoList),
        teams: cloneShallow(state.teamInfoList),
        backpacks: cloneShallow(state.teamBackpackInfo),
        teamBackpackInfo: cloneShallow(state.teamBackpackInfo),
        kills: cloneShallow(state.killInfo),
        observer: cloneShallow(state.observingPlayer),
        circle: cloneShallow(state.circleInfo),
        circleInfo: cloneShallow(state.circleInfo),
      };
      return sanitizeObserverTelemetryPayload(payload).sanitizedPayload;
    },
  };
}

module.exports = {
  createDirectObserverTransportState,
};
