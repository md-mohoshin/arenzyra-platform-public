import {
  contrastRatio,
  ensureContrast,
  generateBrandTokens,
  DEFAULT_BRAND_INPUTS,
} from './smart-brand-engine';

describe('smart-brand-engine', () => {
  it('raises foreground contrast to meet WCAG AA', () => {
    const adjusted = ensureContrast('#888888', '#8a8a8a', 4.5);
    expect(contrastRatio(adjusted, '#8a8a8a')).toBeGreaterThanOrEqual(4.5);
  });

  it('generates derived tokens with accessible text', () => {
    const tokens = generateBrandTokens({
      ...DEFAULT_BRAND_INPUTS,
      mode: 'gradient',
      gradientStart: '#101828',
      gradientEnd: '#0b1220',
      primaryColor: '#00e5ff',
    });

    expect(tokens.textPrimary).toBeDefined();
    expect(tokens.backgroundCss.startsWith('linear-gradient')).toBe(true);
    expect(
      contrastRatio(tokens.textPrimary, tokens.backgroundStart),
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrastRatio(tokens.textPrimary, tokens.backgroundEnd),
    ).toBeGreaterThanOrEqual(4.5);
  });
});
