"use strict";

function compareIds(left, right) {
  return String(left || "").localeCompare(String(right || ""), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function normalizeId(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeSourceType(value) {
  return value === "alert" || value === "manual" ? value : "watch_target";
}

function normalizeTeamIds(teamIds) {
  if (!Array.isArray(teamIds)) {
    return [];
  }

  return Array.from(
    new Set(teamIds.map(normalizeId).filter(Boolean)),
  ).sort(compareIds);
}

function buildReplayCandidateId(sourceType, sourceId) {
  return `replay:${sourceType}:${sourceId}`;
}

function cloneReplayCandidate(candidate) {
  return {
    id: candidate.id,
    sourceType: candidate.sourceType,
    sourceId: candidate.sourceId,
    label: candidate.label,
    centerX: candidate.centerX,
    centerY: candidate.centerY,
    involvedTeamIds: [...candidate.involvedTeamIds],
    createdAt: candidate.createdAt,
    expiresAt: candidate.expiresAt,
  };
}

function compareReplayCandidates(left, right) {
  return (
    right.createdAt - left.createdAt ||
    right.priorityHint - left.priorityHint ||
    left.id.localeCompare(right.id, undefined, {
      numeric: true,
      sensitivity: "base",
    })
  );
}

function normalizeReplayCandidate(candidate, defaultTtlMs, now = Date.now()) {
  const source = candidate && typeof candidate === "object" ? candidate : {};
  const sourceType = normalizeSourceType(source.sourceType);
  const sourceId = normalizeId(source.sourceId || source.id);
  if (!sourceId) {
    return null;
  }

  const id = normalizeId(source.id) || buildReplayCandidateId(sourceType, sourceId);
  const createdAt = Number.isFinite(source.createdAt) ? source.createdAt : now;
  const expiresAt =
    source.expiresAt === null
      ? null
      : Number.isFinite(source.expiresAt)
        ? source.expiresAt
        : createdAt + defaultTtlMs;

  return {
    id,
    sourceType,
    sourceId,
    label: String(source.label || "").trim() || sourceId,
    centerX: Number.isFinite(source.centerX) ? source.centerX : undefined,
    centerY: Number.isFinite(source.centerY) ? source.centerY : undefined,
    involvedTeamIds: normalizeTeamIds(source.involvedTeamIds),
    createdAt,
    expiresAt,
    priorityHint: Math.max(0, Math.round(Number.isFinite(source.priorityHint) ? source.priorityHint : 0)),
  };
}

function createReplayCandidateStore() {
  const candidatesById = new Map();

  function purgeExpired(now = Date.now()) {
    let didChange = false;

    for (const [id, candidate] of candidatesById.entries()) {
      if (candidate.expiresAt !== null && Number.isFinite(candidate.expiresAt) && candidate.expiresAt <= now) {
        candidatesById.delete(id);
        didChange = true;
      }
    }

    return didChange;
  }

  function enforceCapacity(maxEntries) {
    if (!(maxEntries > 0) || candidatesById.size <= maxEntries) {
      return false;
    }

    const ordered = Array.from(candidatesById.values()).sort(compareReplayCandidates);
    let didChange = false;

    while (ordered.length > maxEntries) {
      const candidate = ordered.pop();
      if (candidate && candidatesById.delete(candidate.id)) {
        didChange = true;
      }
    }

    return didChange;
  }

  function addCandidate(candidate, config = {}, now = Date.now()) {
    const normalized = normalizeReplayCandidate(
      candidate,
      config.REPLAY_CANDIDATE_TTL_MS ?? 180_000,
      now,
    );
    if (!normalized) {
      return null;
    }

    purgeExpired(now);

    const existing = Array.from(candidatesById.values()).find(
      (entry) =>
        entry.sourceType === normalized.sourceType &&
        entry.sourceId === normalized.sourceId,
    );

    const nextCandidate = existing
      ? {
          ...existing,
          ...normalized,
          id: existing.id,
          createdAt: now,
          expiresAt:
            normalized.expiresAt === null
              ? null
              : now + (config.REPLAY_CANDIDATE_TTL_MS ?? 180_000),
        }
      : normalized;

    candidatesById.set(nextCandidate.id, nextCandidate);
    enforceCapacity(config.MAX_REPLAY_CANDIDATES ?? 12);
    return cloneReplayCandidate(nextCandidate);
  }

  function removeCandidate(id) {
    const normalizedId = normalizeId(id);
    return normalizedId ? candidatesById.delete(normalizedId) : false;
  }

  function removeCandidateBySourceId(sourceId) {
    const normalizedSourceId = normalizeId(sourceId);
    if (!normalizedSourceId) {
      return false;
    }

    let didChange = false;
    for (const [id, candidate] of candidatesById.entries()) {
      if (candidate.sourceId === normalizedSourceId || id === normalizedSourceId) {
        candidatesById.delete(id);
        didChange = true;
      }
    }

    return didChange;
  }

  function getCandidates(config = {}, now = Date.now()) {
    purgeExpired(now);
    enforceCapacity(config.MAX_REPLAY_CANDIDATES ?? 12);

    return Array.from(candidatesById.values())
      .sort(compareReplayCandidates)
      .map(cloneReplayCandidate);
  }

  return {
    addCandidate,
    getCandidates,
    removeCandidate,
    removeCandidateBySourceId,
  };
}

module.exports = {
  createReplayCandidateStore,
};
