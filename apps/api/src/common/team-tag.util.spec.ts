import {
  normalizeAndValidateTeamTag,
  normalizeTeamTag,
  validateNormalizedTeamTag,
} from './team-tag.util';

describe('team-tag util', () => {
  it('normalizes tags by trimming outer whitespace only', () => {
    expect(normalizeTeamTag(' pe ak y ')).toBe('pe ak y');
    expect(normalizeTeamTag('DxB ')).toBe('DxB');
  });

  it('accepts symbols, mixed case, numbers, and spaces', () => {
    expect(validateNormalizedTeamTag('DXB-9!')).toBeNull();
    expect(normalizeAndValidateTeamTag(' d x b #9! ')).toEqual({
      normalized: 'd x b #9!',
      error: null,
    });
  });

  it('allows one character and rejects tags over fifteen characters', () => {
    expect(normalizeAndValidateTeamTag('A')).toEqual({
      normalized: 'A',
      error: null,
    });
    expect(validateNormalizedTeamTag('123456789012345')).toBeNull();
    expect(normalizeAndValidateTeamTag('1234567890123456').error).toContain(
      'at most',
    );
  });

  it('counts unicode symbols as single characters', () => {
    const symbol = '\u{1F525}';
    expect(validateNormalizedTeamTag(symbol.repeat(15))).toBeNull();
    expect(validateNormalizedTeamTag(symbol.repeat(16))).toBe(
      'tag must be at most 15 characters',
    );
  });
});
