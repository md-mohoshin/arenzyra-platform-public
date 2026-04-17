import {
  normalizeAndValidateTeamTag,
  normalizeTeamTag,
  validateNormalizedTeamTag,
} from './team-tag.util';

describe('team-tag util', () => {
  it('normalizes tags to uppercase without spaces', () => {
    expect(normalizeTeamTag(' pe ak y ')).toBe('PEAKY');
    expect(normalizeTeamTag('DxB ')).toBe('DXB');
  });

  it('accepts valid normalized tags', () => {
    expect(validateNormalizedTeamTag('DXB9')).toBeNull();
    expect(normalizeAndValidateTeamTag(' d x b 9 ')).toEqual({
      normalized: 'DXB9',
      error: null,
    });
  });

  it('rejects invalid characters and invalid lengths', () => {
    expect(normalizeAndValidateTeamTag('A').error).toContain('at least');
    expect(normalizeAndValidateTeamTag('BAD-TAG').error).toContain(
      'A-Z and 0-9',
    );
    expect(normalizeAndValidateTeamTag('THISISWAYTOOLONG').error).toContain(
      'at most',
    );
  });
});
