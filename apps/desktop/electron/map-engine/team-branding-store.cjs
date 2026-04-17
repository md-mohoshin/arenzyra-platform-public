"use strict";

const DEFAULT_TEAM_NAME = "Arenzyra";
const DEFAULT_TEAM_TAG = "AZ";

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

function cloneTeam(team) {
  return {
    teamId: team.teamId,
    slot: team.slot,
    teamName: team.teamName,
    teamTag: team.teamTag,
    logoUrl: team.logoUrl,
    color: team.color,
  };
}

function cloneUpdate(update) {
  return {
    matchId: update.matchId,
    teams: update.teams.map(cloneTeam),
    timestamp: update.timestamp,
  };
}

function normalizeTeam(source, index) {
  const record = source && typeof source === "object" && !Array.isArray(source) ? source : {};
  const nestedTeam =
    record.team && typeof record.team === "object" && !Array.isArray(record.team)
      ? record.team
      : {};
  const teamId = textValue(record.teamId ?? record.id ?? nestedTeam.id);
  const slot = normalizeSlot(record.slot ?? record.slotNumber ?? record.teamNo);
  const teamName = textValue(record.teamName ?? record.name ?? nestedTeam.name);
  const teamTag = textValue(record.teamTag ?? record.tag ?? nestedTeam.tag);
  const logoUrl = textValue(record.logoUrl ?? record.localLogoUrl ?? nestedTeam.logoUrl);
  const color = textValue(
    record.color ??
      record.resolvedColor ??
      record.accentLight ??
      record.teamColor ??
      nestedTeam.accentLight ??
      nestedTeam.accentDark,
  );

  if (!teamId && slot === null && !teamName && !teamTag && !logoUrl) {
    return null;
  }

  return {
    teamId,
    slot,
    teamName: teamName ?? teamTag ?? DEFAULT_TEAM_NAME,
    teamTag: teamTag ?? DEFAULT_TEAM_TAG,
    logoUrl,
    color,
  };
}

function normalizeTeamBrandingUpdate(update) {
  const source =
    Array.isArray(update)
      ? update
      : Array.isArray(update?.teams)
        ? update.teams
        : Array.isArray(update?.slots)
          ? update.slots
          : [];
  const teams = source
    .map((team, index) => normalizeTeam(team, index))
    .filter(Boolean);
  const timestamp = toFiniteNumber(update?.timestamp) ?? Date.now();

  return {
    matchId: textValue(update?.matchId),
    teams,
    timestamp,
  };
}

function createTeamBrandingStore() {
  let current = null;

  function set(update) {
    current = normalizeTeamBrandingUpdate(update);
    return cloneUpdate(current);
  }

  function get() {
    return current ? cloneUpdate(current) : null;
  }

  function clear() {
    current = null;
  }

  return {
    clear,
    get,
    set,
  };
}

module.exports = {
  createTeamBrandingStore,
};
