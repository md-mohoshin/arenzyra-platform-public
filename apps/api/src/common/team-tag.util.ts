export const TEAM_TAG_MIN_LENGTH = 2;
export const TEAM_TAG_MAX_LENGTH = 12;
export const TEAM_TAG_PATTERN = /^[A-Z0-9]+$/;

export const normalizeTeamTag = (value: string | null | undefined) => {
  if (value === null || value === undefined) return null;
  const normalized = `${value}`.trim().toUpperCase().replace(/\s+/g, '');
  return normalized.length > 0 ? normalized : null;
};

export const validateNormalizedTeamTag = (value: string) => {
  if (value.length < TEAM_TAG_MIN_LENGTH) {
    return `tag must be at least ${TEAM_TAG_MIN_LENGTH} characters`;
  }
  if (value.length > TEAM_TAG_MAX_LENGTH) {
    return `tag must be at most ${TEAM_TAG_MAX_LENGTH} characters`;
  }
  if (!TEAM_TAG_PATTERN.test(value)) {
    return 'tag may only contain A-Z and 0-9';
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
