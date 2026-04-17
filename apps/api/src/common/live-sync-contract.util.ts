type JsonRecord = Record<string, unknown>;

export const LIVE_SYNC_META_KEY = 'liveSync';

export const LIVE_SYNC_OWNER_VALUES = [
  'TELEMETRY',
  'MANUAL',
  'SYSTEM',
] as const;

export type LiveSyncOwner = (typeof LIVE_SYNC_OWNER_VALUES)[number];

export type LiveSyncFieldOwnership = {
  owner: LiveSyncOwner;
  override: boolean;
  updatedAt: number;
  actorId?: string | null;
  source?: string | null;
};

export type LiveSyncPlayerOwnership = {
  alive?: LiveSyncFieldOwnership;
  knocked?: LiveSyncFieldOwnership;
  kills?: LiveSyncFieldOwnership;
};

export type LiveSyncTeamOwnership = {
  eliminated?: LiveSyncFieldOwnership;
  placement?: LiveSyncFieldOwnership;
  totalKills?: LiveSyncFieldOwnership;
};

export type LiveSyncOverrides = {
  players: Record<string, LiveSyncPlayerOwnership>;
  teams: Record<string, LiveSyncTeamOwnership>;
};

export const LIVE_SYNC_AUDIT_ACTION_VALUES = ['OVERRIDE', 'RELEASE'] as const;

export type LiveSyncAuditAction =
  (typeof LIVE_SYNC_AUDIT_ACTION_VALUES)[number];

export const LIVE_SYNC_AUDIT_SCOPE_VALUES = [
  'MATCH',
  'TEAM',
  'PLAYER',
] as const;

export type LiveSyncAuditScopeLevel =
  (typeof LIVE_SYNC_AUDIT_SCOPE_VALUES)[number];

export type LiveSyncAuditScope = {
  level: LiveSyncAuditScopeLevel;
  teamId?: string | null;
  playerId?: string | null;
  fields?: string[];
};

export type LiveSyncAuditEntry = {
  action: LiveSyncAuditAction;
  timestamp: number;
  actorId?: string | null;
  source?: string | null;
  scope: LiveSyncAuditScope;
};

export type LiveSyncContract = {
  version: number;
  updatedAt: number | null;
  overrides: LiveSyncOverrides;
  auditTrail: LiveSyncAuditEntry[];
};

const MAX_LIVE_SYNC_AUDIT_TRAIL = 100;

const isRecord = (value: unknown): value is JsonRecord =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const toStringValue = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
};

const toNumberValue = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
  }
  return null;
};

const normalizeOwner = (value: unknown): LiveSyncOwner => {
  const normalized = toStringValue(value)?.toUpperCase() ?? 'TELEMETRY';
  if (normalized === 'MANUAL' || normalized === 'SYSTEM') {
    return normalized;
  }
  return 'TELEMETRY';
};

const normalizeFieldOwnership = (
  value: unknown,
): LiveSyncFieldOwnership | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }
  return {
    owner: normalizeOwner(value.owner),
    override: value.override === true,
    updatedAt: Math.max(0, toNumberValue(value.updatedAt) ?? 0),
    actorId: toStringValue(value.actorId),
    source: toStringValue(value.source),
  };
};

const normalizePlayerOwnership = (
  value: unknown,
): LiveSyncPlayerOwnership | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }
  const next: LiveSyncPlayerOwnership = {};
  const alive = normalizeFieldOwnership(value.alive);
  const knocked = normalizeFieldOwnership(value.knocked);
  const kills = normalizeFieldOwnership(value.kills);
  if (alive) next.alive = alive;
  if (knocked) next.knocked = knocked;
  if (kills) next.kills = kills;
  return Object.keys(next).length ? next : undefined;
};

const normalizeTeamOwnership = (
  value: unknown,
): LiveSyncTeamOwnership | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }
  const next: LiveSyncTeamOwnership = {};
  const eliminated = normalizeFieldOwnership(value.eliminated);
  const placement = normalizeFieldOwnership(value.placement);
  const totalKills = normalizeFieldOwnership(value.totalKills);
  if (eliminated) next.eliminated = eliminated;
  if (placement) next.placement = placement;
  if (totalKills) next.totalKills = totalKills;
  return Object.keys(next).length ? next : undefined;
};

const normalizePlayerOverrides = (
  value: unknown,
): Record<string, LiveSyncPlayerOwnership> => {
  if (!isRecord(value)) {
    return {};
  }
  const next: Record<string, LiveSyncPlayerOwnership> = {};
  for (const [playerId, ownership] of Object.entries(value)) {
    const normalized = normalizePlayerOwnership(ownership);
    if (normalized) {
      next[playerId] = normalized;
    }
  }
  return next;
};

const normalizeTeamOverrides = (
  value: unknown,
): Record<string, LiveSyncTeamOwnership> => {
  if (!isRecord(value)) {
    return {};
  }
  const next: Record<string, LiveSyncTeamOwnership> = {};
  for (const [teamId, ownership] of Object.entries(value)) {
    const normalized = normalizeTeamOwnership(ownership);
    if (normalized) {
      next[teamId] = normalized;
    }
  }
  return next;
};

const normalizeScopeLevel = (value: unknown): LiveSyncAuditScopeLevel => {
  const normalized = toStringValue(value)?.toUpperCase() ?? 'MATCH';
  if (normalized === 'TEAM' || normalized === 'PLAYER') {
    return normalized;
  }
  return 'MATCH';
};

const normalizeStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => toStringValue(entry))
    .filter((entry): entry is string => Boolean(entry));
};

const normalizeAuditEntry = (
  value: unknown,
): LiveSyncAuditEntry | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }
  const scopeValue = isRecord(value.scope) ? value.scope : {};
  const timestamp = Math.max(0, toNumberValue(value.timestamp) ?? 0);
  if (!timestamp) {
    return undefined;
  }
  const action = toStringValue(value.action)?.toUpperCase() ?? 'OVERRIDE';
  return {
    action: action === 'RELEASE' ? 'RELEASE' : 'OVERRIDE',
    timestamp,
    actorId: toStringValue(value.actorId),
    source: toStringValue(value.source),
    scope: {
      level: normalizeScopeLevel(scopeValue.level),
      teamId: toStringValue(scopeValue.teamId),
      playerId: toStringValue(scopeValue.playerId),
      fields: normalizeStringArray(scopeValue.fields),
    },
  };
};

const normalizeAuditTrail = (value: unknown): LiveSyncAuditEntry[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => normalizeAuditEntry(entry))
    .filter((entry): entry is LiveSyncAuditEntry => Boolean(entry))
    .slice(-MAX_LIVE_SYNC_AUDIT_TRAIL);
};

const serializeContract = (contract: LiveSyncContract): JsonRecord => ({
  version: contract.version,
  updatedAt: contract.updatedAt,
  overrides: {
    players: contract.overrides.players,
    teams: contract.overrides.teams,
  },
  auditTrail: contract.auditTrail,
});

export const emptyLiveSyncContract = (): LiveSyncContract => ({
  version: 0,
  updatedAt: null,
  overrides: {
    players: {},
    teams: {},
  },
  auditTrail: [],
});

export const readLiveSyncContract = (metaJson: unknown): LiveSyncContract => {
  const root = isRecord(metaJson) ? metaJson : null;
  const raw =
    root && isRecord(root[LIVE_SYNC_META_KEY])
      ? root[LIVE_SYNC_META_KEY]
      : null;

  if (!raw) {
    return emptyLiveSyncContract();
  }

  const overrides = isRecord(raw.overrides) ? raw.overrides : {};
  return {
    version: Math.max(0, toNumberValue(raw.version) ?? 0),
    updatedAt: toNumberValue(raw.updatedAt),
    overrides: {
      players: normalizePlayerOverrides(overrides.players),
      teams: normalizeTeamOverrides(overrides.teams),
    },
    auditTrail: normalizeAuditTrail(raw.auditTrail),
  };
};

export const writeLiveSyncContract = (
  metaJson: unknown,
  contract: LiveSyncContract,
): JsonRecord => {
  const root = isRecord(metaJson) ? { ...metaJson } : {};
  root[LIVE_SYNC_META_KEY] = serializeContract(contract);
  return root;
};

export const setLiveSyncPlayerOverride = (
  contract: LiveSyncContract,
  playerId: string,
  field: keyof LiveSyncPlayerOwnership,
  ownership: LiveSyncFieldOwnership,
): LiveSyncContract => {
  const next: LiveSyncContract = {
    ...contract,
    updatedAt: ownership.updatedAt,
    overrides: {
      players: { ...contract.overrides.players },
      teams: { ...contract.overrides.teams },
    },
    auditTrail: [...contract.auditTrail],
  };
  const current = next.overrides.players[playerId] ?? {};
  next.overrides.players[playerId] = {
    ...current,
    [field]: ownership,
  };
  return next;
};

export const setLiveSyncTeamOverride = (
  contract: LiveSyncContract,
  teamId: string,
  field: keyof LiveSyncTeamOwnership,
  ownership: LiveSyncFieldOwnership,
): LiveSyncContract => {
  const next: LiveSyncContract = {
    ...contract,
    updatedAt: ownership.updatedAt,
    overrides: {
      players: { ...contract.overrides.players },
      teams: { ...contract.overrides.teams },
    },
    auditTrail: [...contract.auditTrail],
  };
  const current = next.overrides.teams[teamId] ?? {};
  next.overrides.teams[teamId] = {
    ...current,
    [field]: ownership,
  };
  return next;
};

export const hasManualOverride = (
  ownership: LiveSyncFieldOwnership | null | undefined,
): boolean => ownership?.owner === 'MANUAL' && ownership.override === true;

export const clearLiveSyncPlayerOverrides = (
  contract: LiveSyncContract,
  playerId: string,
  fields?: Array<keyof LiveSyncPlayerOwnership>,
): LiveSyncContract => {
  const next: LiveSyncContract = {
    ...contract,
    overrides: {
      players: { ...contract.overrides.players },
      teams: { ...contract.overrides.teams },
    },
    auditTrail: [...contract.auditTrail],
  };
  const current = next.overrides.players[playerId];
  if (!current) {
    return next;
  }
  if (!fields || fields.length === 0) {
    delete next.overrides.players[playerId];
    return next;
  }
  const updated: LiveSyncPlayerOwnership = { ...current };
  for (const field of fields) {
    delete updated[field];
  }
  if (Object.keys(updated).length === 0) {
    delete next.overrides.players[playerId];
  } else {
    next.overrides.players[playerId] = updated;
  }
  return next;
};

export const clearLiveSyncTeamOverrides = (
  contract: LiveSyncContract,
  teamId: string,
  fields?: Array<keyof LiveSyncTeamOwnership>,
): LiveSyncContract => {
  const next: LiveSyncContract = {
    ...contract,
    overrides: {
      players: { ...contract.overrides.players },
      teams: { ...contract.overrides.teams },
    },
    auditTrail: [...contract.auditTrail],
  };
  const current = next.overrides.teams[teamId];
  if (!current) {
    return next;
  }
  if (!fields || fields.length === 0) {
    delete next.overrides.teams[teamId];
    return next;
  }
  const updated: LiveSyncTeamOwnership = { ...current };
  for (const field of fields) {
    delete updated[field];
  }
  if (Object.keys(updated).length === 0) {
    delete next.overrides.teams[teamId];
  } else {
    next.overrides.teams[teamId] = updated;
  }
  return next;
};

export const clearAllLiveSyncOverrides = (
  contract: LiveSyncContract,
): LiveSyncContract => ({
  ...contract,
  overrides: {
    players: {},
    teams: {},
  },
  auditTrail: [...contract.auditTrail],
});

export const appendLiveSyncAuditEntry = (
  contract: LiveSyncContract,
  entry: LiveSyncAuditEntry,
): LiveSyncContract => ({
  ...contract,
  updatedAt: entry.timestamp,
  auditTrail: [...contract.auditTrail, entry].slice(-MAX_LIVE_SYNC_AUDIT_TRAIL),
});
