import { generateThemeColors } from './theme-colors.util';
import { DEFAULT_ORGANIZATION_BRANDING } from './organization-branding.constants';

describe('generateThemeColors', () => {
  it('maps derived tokens to theme colors', () => {
    const colors = generateThemeColors(DEFAULT_ORGANIZATION_BRANDING);

    expect(colors.backgroundCss).toBe(
      DEFAULT_ORGANIZATION_BRANDING.backgroundCss,
    );
    expect(colors.textPrimary).toBe(DEFAULT_ORGANIZATION_BRANDING.textPrimary);
    expect(colors.accent).toBe(DEFAULT_ORGANIZATION_BRANDING.accent);
  });

  it('honors provided gradient stops and accent', () => {
    const colors = generateThemeColors({
      ...DEFAULT_ORGANIZATION_BRANDING,
      gradientStart: '#ffffff',
      gradientEnd: '#eeeeee',
      secondaryColor: '#334455',
      accent: '#0077ff',
      primaryColor: '#112233',
    });

    expect(colors.backgroundStart).toBe('#ffffff');
    expect(colors.backgroundEnd).toBe('#eeeeee');
    expect(colors.accent).toBe('#0077ff');
    expect(colors.primary).toBe('#112233');
    expect(colors.secondary).toBe('#334455');
  });

  it('maps reverse diagonal gradients to 45deg CSS', () => {
    const colors = generateThemeColors({
      ...DEFAULT_ORGANIZATION_BRANDING,
      mode: 'gradient',
      gradientDirection: 'reverse-diagonal',
      gradientStart: '#101820',
      gradientEnd: '#304050',
    });

    expect(colors.backgroundCss).toContain('45deg');
  });
});
