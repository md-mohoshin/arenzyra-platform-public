import { resolveAssetBaseUrlForStorage } from './asset.util';

describe('asset.util', () => {
  it('stores relative media paths when only localhost api bases are configured', () => {
    expect(
      resolveAssetBaseUrlForStorage({
        API_BASE_URL: 'http://localhost:3000',
      } as NodeJS.ProcessEnv),
    ).toBe('');

    expect(
      resolveAssetBaseUrlForStorage({
        API_PUBLIC_URL: '127.0.0.1:3000',
      } as NodeJS.ProcessEnv),
    ).toBe('');
  });

  it('keeps a public api origin when one is configured', () => {
    expect(
      resolveAssetBaseUrlForStorage({
        API_PUBLIC_URL: 'https://api.arenzyra.com/',
      } as NodeJS.ProcessEnv),
    ).toBe('https://api.arenzyra.com');

    expect(
      resolveAssetBaseUrlForStorage({
        ASSET_BASE_URL: 'api.arenzyra.com',
      } as NodeJS.ProcessEnv),
    ).toBe('https://api.arenzyra.com');
  });
});
