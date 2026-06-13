import {
  buildAllowedCorsOrigins,
  isAllowedCorsOrigin,
  normalizeCorsOrigin,
} from './cors.util';

describe('cors util', () => {
  it('normalizes origins to scheme, host, and optional port', () => {
    expect(normalizeCorsOrigin('https://Arenzyra.com/')).toBe(
      'https://arenzyra.com',
    );
    expect(normalizeCorsOrigin('arenzyra.com')).toBe('https://arenzyra.com');
    expect(normalizeCorsOrigin('http://LOCALHOST:3005/path?q=1')).toBe(
      'http://localhost:3005',
    );
  });

  it('builds a deduplicated origin list from defaults and env values', () => {
    const allowed = buildAllowedCorsOrigins({
      WEB_APP_ORIGIN: 'https://arenzyra.com/',
      FRONTEND_ORIGIN:
        'www.arenzyra.com, https://staging.arenzyra.com https://arenzyra.com',
    });

    expect(allowed).toEqual(
      expect.arrayContaining([
        'https://arenzyra.com',
        'https://www.arenzyra.com',
        'https://staging.arenzyra.com',
        'http://localhost:3005',
      ]),
    );
    expect(
      allowed.filter((origin) => origin === 'https://arenzyra.com'),
    ).toHaveLength(1);
  });

  it('accepts publish env values with trailing CRLF characters', () => {
    const allowed = buildAllowedCorsOrigins({
      WEB_APP_ORIGIN: 'https://arenzyra.com\r\n',
    });

    expect(allowed).toContain('https://arenzyra.com');
    expect(isAllowedCorsOrigin('https://arenzyra.com', allowed)).toBe(true);
  });

  it('allows canonical Arenzyra origins even when env is absent', () => {
    const allowed = buildAllowedCorsOrigins({});

    expect(isAllowedCorsOrigin('https://arenzyra.com', allowed)).toBe(true);
    expect(isAllowedCorsOrigin('https://www.arenzyra.com', allowed)).toBe(true);
    expect(isAllowedCorsOrigin(undefined, allowed)).toBe(true);
    expect(isAllowedCorsOrigin('https://evil.example', allowed)).toBe(false);
  });
});
