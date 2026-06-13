"use strict";

function toFiniteNumber(value) {
  const numeric =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(numeric) ? numeric : null;
}

function textValue(value) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
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

function parseSlotIdentifier(value) {
  const normalized = textValue(value);
  if (!normalized) {
    return null;
  }

  if (/^\d{1,3}$/.test(normalized)) {
    return Number(normalized);
  }

  const match = normalized.match(/(?:team|t|slot|seed)[-_ ]?(\d{1,3})$/i);
  return match ? Number(match[1]) : null;
}

function normalizeTeamRecord(source) {
  const record = source && typeof source === "object" && !Array.isArray(source) ? source : {};
  const nestedTeam =
    record.team && typeof record.team === "object" && !Array.isArray(record.team)
      ? record.team
      : {};

  const teamId = textValue(record.teamId ?? record.id ?? nestedTeam.id);
  const slot = normalizeSlot(record.slot ?? record.slotNumber ?? record.teamNo);
  const teamName = textValue(record.teamName ?? record.name ?? nestedTeam.name);
  const teamTag = textValue(record.teamTag ?? record.tag ?? nestedTeam.tag);

  if (!teamId && slot === null && !teamName && !teamTag) {
    return null;
  }

  return {
    teamId,
    slot,
    teamName,
    teamTag,
  };
}

function buildTeamBrandingIndex(update) {
  const source =
    Array.isArray(update)
      ? update
      : Array.isArray(update?.teams)
        ? update.teams
        : Array.isArray(update?.slots)
          ? update.slots
          : [];
  const byTeamId = new Map();
  const bySlot = new Map();

  for (const entry of source.map(normalizeTeamRecord).filter(Boolean)) {
    if (entry.teamId) {
      byTeamId.set(entry.teamId.toLowerCase(), entry);
    }
    if (entry.slot !== null) {
      bySlot.set(entry.slot, entry);
    }
  }

  return {
    byTeamId,
    bySlot,
  };
}

function displayLabel(record) {
  if (!record) {
    return null;
  }

  return textValue(record.teamName) || textValue(record.teamTag) || textValue(record.teamId);
}

function resolveTeamLabel(index, teamId) {
  const normalized = textValue(teamId);
  if (!normalized || !index) {
    return null;
  }

  const byTeamId = index.byTeamId instanceof Map ? index.byTeamId : new Map();
  const bySlot = index.bySlot instanceof Map ? index.bySlot : new Map();
  const idMatch = byTeamId.get(normalized.toLowerCase());
  const idLabel = displayLabel(idMatch);
  if (idLabel) {
    return idLabel;
  }

  const slot = parseSlotIdentifier(normalized);
  if (slot !== null) {
    const slotLabel = displayLabel(bySlot.get(slot));
    if (slotLabel) {
      return slotLabel;
    }
  }

  return null;
}

function createTeamLabelResolver(initialBranding = null) {
  let index = buildTeamBrandingIndex(initialBranding);

  return {
    resolve(teamId) {
      return resolveTeamLabel(index, teamId);
    },
    setTeamBranding(update) {
      index = buildTeamBrandingIndex(update);
      return index;
    },
  };
}

module.exports = {
  buildTeamBrandingIndex,
  createTeamLabelResolver,
  resolveTeamLabel,
};
