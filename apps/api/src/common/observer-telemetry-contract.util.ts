const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
};

const normalizeFieldName = (value: string): string =>
  value.replace(/[^a-z0-9]/gi, '').toLowerCase();

const TOP_LEVEL_SANITIZABLE_FIELDS = new Set([
  'aliveteams',
  'aliveplayers',
  'rank',
  'ranks',
]);

const TOP_LEVEL_FORBIDDEN_FIELDS = new Set([
  'matchstatus',
  'isfinished',
  'finished',
  'isended',
  'ended',
  'winnerteamid',
  'winnerteam',
  'winner',
  'finalplacements',
  'finalplacement',
  'placements',
  'placement',
  'matchendedat',
]);

const NESTED_SANITIZABLE_FIELDS = new Set(['rank', 'ranks']);

const NESTED_RESULT_FIELDS = new Set([
  'winnerteamid',
  'winnerteam',
  'winner',
  'finalplacements',
  'finalplacement',
  'placements',
  'placement',
  'placementindex',
  'position',
  'matchendedat',
  'isfinished',
  'finished',
  'isended',
  'ended',
]);

const TEAM_COLLECTION_KEYS = new Set(['teams', 'teaminfolist', 'teamlist']);

const PLAYER_COLLECTION_KEYS = new Set([
  'players',
  'playerinfolist',
  'totalplayerlist',
  'playerlist',
]);

const LIVE_TEAM_PLACEMENT_FIELDS = new Set([
  'rank',
  'placement',
  'placementindex',
  'position',
]);

const buildPath = (base: string, key: string): string =>
  base.length > 0 ? `${base}.${key}` : key;

const isLiveTeamPlacementField = (
  segments: string[],
  normalizedField: string,
) =>
  LIVE_TEAM_PLACEMENT_FIELDS.has(normalizedField) &&
  TEAM_COLLECTION_KEYS.has(normalizeFieldName(segments[0] ?? ''));

const isSanitizableField = (segments: string[], normalizedField: string) => {
  if (segments.length === 0) {
    return TOP_LEVEL_SANITIZABLE_FIELDS.has(normalizedField);
  }

  const root = normalizeFieldName(segments[0] ?? '');
  if (TEAM_COLLECTION_KEYS.has(root)) {
    return (
      NESTED_SANITIZABLE_FIELDS.has(normalizedField) &&
      !isLiveTeamPlacementField(segments, normalizedField)
    );
  }

  if (TEAM_COLLECTION_KEYS.has(root) || PLAYER_COLLECTION_KEYS.has(root)) {
    return NESTED_SANITIZABLE_FIELDS.has(normalizedField);
  }

  return false;
};

const isForbiddenField = (segments: string[], normalizedField: string) => {
  if (segments.length === 0) {
    return TOP_LEVEL_FORBIDDEN_FIELDS.has(normalizedField);
  }

  const root = normalizeFieldName(segments[0] ?? '');
  if (TEAM_COLLECTION_KEYS.has(root)) {
    return (
      NESTED_RESULT_FIELDS.has(normalizedField) &&
      !isLiveTeamPlacementField(segments, normalizedField)
    );
  }

  if (PLAYER_COLLECTION_KEYS.has(root)) {
    return NESTED_RESULT_FIELDS.has(normalizedField);
  }

  return false;
};

export const sanitizeObserverTelemetryPayload = <T>(payload: T) => {
  const stripped = new Set<string>();

  const sanitize = (
    value: unknown,
    segments: string[],
    path: string,
  ): unknown => {
    if (Array.isArray(value)) {
      return value.map((entry, index) =>
        sanitize(entry, segments, `${path}[${index}]`),
      );
    }

    const record = asRecord(value);
    if (!record) {
      return value;
    }

    const clone: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(record)) {
      const normalizedField = normalizeFieldName(key);
      if (isSanitizableField(segments, normalizedField)) {
        stripped.add(buildPath(path, key));
        continue;
      }
      clone[key] = sanitize(nested, [...segments, key], buildPath(path, key));
    }
    return clone;
  };

  return {
    sanitizedPayload: sanitize(payload, [], '') as T,
    strippedFields: Array.from(stripped.values()).sort((left, right) =>
      left.localeCompare(right),
    ),
  };
};

export const findForbiddenObserverTelemetryFields = (
  payload: unknown,
): string[] => {
  const hits = new Set<string>();

  const visit = (value: unknown, segments: string[], path: string) => {
    if (Array.isArray(value)) {
      value.forEach((entry, index) => {
        visit(entry, segments, `${path}[${index}]`);
      });
      return;
    }

    const record = asRecord(value);
    if (!record) {
      return;
    }

    for (const [key, nested] of Object.entries(record)) {
      const normalizedField = normalizeFieldName(key);
      if (isForbiddenField(segments, normalizedField)) {
        hits.add(buildPath(path, key));
      }
      visit(nested, [...segments, key], buildPath(path, key));
    }
  };

  visit(payload, [], '');
  return Array.from(hits.values()).sort((left, right) =>
    left.localeCompare(right),
  );
};
