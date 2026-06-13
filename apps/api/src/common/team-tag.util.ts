export const TEAM_TAG_MIN_LENGTH = 1;
export const TEAM_TAG_MAX_LENGTH = 15;

export const getTeamTagLength = (value: string) => Array.from(value).length;

export const normalizeTeamTag = (value: string | null | undefined) => {
  if (value === null || value === undefined) return null;
  const normalized = `${value}`.trim();
  return normalized.length > 0 ? normalized : null;
};

export const validateNormalizedTeamTag = (value: string) => {
  const length = getTeamTagLength(value);
  if (length < TEAM_TAG_MIN_LENGTH) {
    return `tag must be at least ${TEAM_TAG_MIN_LENGTH} characters`;
  }
  if (length > TEAM_TAG_MAX_LENGTH) {
    return `tag must be at most ${TEAM_TAG_MAX_LENGTH} characters`;
  }
  return null;
};

export const normalizeAndValidateTeamTag = (
  value: string | null | undefined,
) => {
  const normalized = normalizeTeamTag(value);
  if (!normalized) {
    return { normalized: null, error: null };
  }
  return {
    normalized,
    error: validateNormalizedTeamTag(normalized),
  };
};
