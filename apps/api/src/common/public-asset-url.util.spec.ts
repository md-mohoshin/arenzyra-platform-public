import { normalizePublicAssetUrl } from './public-asset-url.util';

describe('public-asset-url.util', () => {
  it('keeps public absolute urls unchanged', () => {
    expect(
      normalizePublicAssetUrl('https://cdn.arenzyra.com/teams/logo.png'),
    ).toBe('https://cdn.arenzyra.com/teams/logo.png');
  });

  it('turns localhost asset urls into browser-safe relative paths', () => {
    expect(
      normalizePublicAssetUrl(
        'http://localhost:3000/uploads/teams/logo.png?size=sm#preview',
      ),
    ).toBe('/uploads/teams/logo.png?size=sm#preview');

    expect(
      normalizePublicAssetUrl('http://127.0.0.1:3000/uploads/players/a.png'),
    ).toBe('/uploads/players/a.png');

    expect(normalizePublicAssetUrl('localhost:3000/uploads/teams/b.png')).toBe(
      '/uploads/teams/b.png',
    );
  });

  it('keeps relative asset paths and drops empty values', () => {
    expect(normalizePublicAssetUrl('/uploads/teams/logo.png')).toBe(
      '/uploads/teams/logo.png',
    );
    expect(normalizePublicAssetUrl('')).toBeNull();
    expect(normalizePublicAssetUrl(null)).toBeNull();
  });
});
