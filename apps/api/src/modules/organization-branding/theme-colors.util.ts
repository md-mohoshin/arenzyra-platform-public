import {
  DEFAULT_ORGANIZATION_BRANDING,
  type OrganizationBrandingDto,
} from './organization-branding.constants';
import { mix } from '../../common/branding/smart-brand-engine';

export type ThemeColors = {
  backgroundCss: string;
  backgroundStart: string;
  backgroundEnd: string;
  widgetBackground: string;
  textPrimary: string;
  textMuted: string;
  border: string;
  primary: string;
  secondary: string;
  live: string;
  accent: string;
  accentSoft: string;
  glow: string;
};

const directionToCss = (dir?: string | null): string => {
  switch (dir) {
    case 'horizontal':
      return '90deg';
    case 'vertical':
      return '180deg';
    case 'reverse-diagonal':
      return '45deg';
    case 'diagonal':
    default:
      return '135deg';
  }
};

export function generateThemeColors(
  branding: OrganizationBrandingDto,
): ThemeColors {
  const base = { ...DEFAULT_ORGANIZATION_BRANDING, ...branding };
  const backgroundStart =
    branding.gradientStart ??
    branding.backgroundStart ??
    DEFAULT_ORGANIZATION_BRANDING.backgroundStart;
  const backgroundEnd =
    branding.gradientEnd ??
    branding.backgroundEnd ??
    backgroundStart ??
    DEFAULT_ORGANIZATION_BRANDING.backgroundEnd;
  const widgetBackground =
    base.widgetBackground ?? base.effectiveBackground ?? backgroundStart;

  const backgroundCss =
    base.mode === 'gradient'
      ? `linear-gradient(${directionToCss(base.gradientDirection)}, ${backgroundStart}, ${backgroundEnd})`
      : (base.backgroundCss ?? widgetBackground);

  const accent = base.accent ?? base.primaryColor;
  const accentSoft = mix(
    accent,
    base.effectiveBackground ?? widgetBackground ?? accent,
    0.55,
  );
  const glow =
    base.glowAccent && !base.glowAccent.includes(' 0 ')
      ? `0 0 32px ${base.glowAccent}`
      : (base.glowAccent ?? base.shadow);

  return {
    backgroundCss,
    backgroundStart,
    backgroundEnd,
    widgetBackground,
    textPrimary: base.textPrimary,
    textMuted: base.textMuted,
    border: base.border,
    primary: base.primaryColor,
    secondary: base.secondaryColor ?? accent ?? base.primaryColor,
    live: base.liveColor,
    accent: accent ?? base.primaryColor,
    accentSoft,
    glow,
  };
}
