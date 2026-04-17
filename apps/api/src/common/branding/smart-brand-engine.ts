const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

export type BrandingMode = 'solid' | 'gradient';
export type GradientDirection =
  | 'horizontal'
  | 'vertical'
  | 'diagonal'
  | 'reverse-diagonal';

export type BrandingInputs = {
  mode: BrandingMode;
  primaryColor: string;
  accent: string;
  widgetBackground: string;
  liveColor: string;
  gradientStart: string;
  gradientEnd: string;
  gradientDirection: GradientDirection;
};

export type BrandingDerivedTokens = {
  backgroundStart: string;
  backgroundEnd: string;
  backgroundCss: string;
  effectiveBackground: string;
  textPrimary: string;
  textMuted: string;
  border: string;
  panel: string;
  shadow: string;
  glowAccent: string;
  badgeBg: string;
  badgeText: string;
};

export type BrandingTokens = BrandingInputs & BrandingDerivedTokens;

const WHITE = '#ffffff';
const BLACK = '#000000';
const LIGHT_TEXT = '#f8fafc';
const DARK_TEXT = '#0f172a';
const LIGHT_BORDER_COLOR = 'rgba(255,255,255,0.14)';
const DARK_BORDER_COLOR = 'rgba(15,23,42,0.18)';

export const DEFAULT_BRAND_INPUTS: BrandingInputs = {
  mode: 'solid',
  primaryColor: '#00E5FF',
  accent: '#F5A524',
  widgetBackground: '#0B1220',
  liveColor: '#22C55E',
  gradientStart: '#050B18',
  gradientEnd: '#0B1220',
  gradientDirection: 'diagonal',
};

const normalizeHex = (input: string): string => {
  const value = (input ?? '').toString().trim().replace('#', '');
  if (/^[0-9a-fA-F]{3}$/.test(value)) {
    const [r, g, b] = value;
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  if (/^[0-9a-fA-F]{6}$/.test(value)) {
    return `#${value}`.toLowerCase();
  }
  throw new Error(`Invalid hex color: ${input}`);
};

const safeHex = (value: string | null | undefined, fallback: string) => {
  try {
    return normalizeHex(value ?? '');
  } catch {
    return normalizeHex(fallback);
  }
};

export const hexToRgb = (hex: string) => {
  const n = parseInt(normalizeHex(hex).slice(1), 16);
  return {
    r: (n >> 16) & 0xff,
    g: (n >> 8) & 0xff,
    b: n & 0xff,
  };
};

const rgbToHex = (r: number, g: number, b: number) =>
  `#${[r, g, b]
    .map((v) =>
      Math.max(0, Math.min(255, Math.round(v)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;

export const mix = (a: string, b: string, weight: number) => {
  const t = clamp01(weight);
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  return rgbToHex(
    ca.r * (1 - t) + cb.r * t,
    ca.g * (1 - t) + cb.g * t,
    ca.b * (1 - t) + cb.b * t,
  );
};

export const darken = (hex: string, amount: number) =>
  mix(safeHex(hex, DEFAULT_BRAND_INPUTS.primaryColor), BLACK, clamp01(amount));

export const relativeLuminance = (hex: string) => {
  const { r, g, b } = hexToRgb(hex);
  const toLinear = (v: number) => {
    const n = v / 255;
    return n <= 0.03928 ? n / 12.92 : Math.pow((n + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
};

export const contrastRatio = (a: string, b: string) => {
  const l1 = relativeLuminance(a);
  const l2 = relativeLuminance(b);
  const light = Math.max(l1, l2);
  const dark = Math.min(l1, l2);
  return (light + 0.05) / (dark + 0.05);
};

const isDarkSurface = (hex: string) =>
  relativeLuminance(safeHex(hex, DEFAULT_BRAND_INPUTS.widgetBackground)) < 0.36;

const preferredTone = (background: string) =>
  isDarkSurface(background) ? LIGHT_TEXT : DARK_TEXT;

export function ensureContrast(
  fgHex: string,
  bgHex: string,
  minRatio = 4.5,
): string {
  const fg = safeHex(fgHex, LIGHT_TEXT);
  const bg = safeHex(bgHex, DEFAULT_BRAND_INPUTS.widgetBackground);
  if (contrastRatio(fg, bg) >= minRatio) return fg;

  const adjustToward = (target: string) => {
    let low = 0;
    let high = 1;
    let best = fg;
    for (let i = 0; i < 18; i += 1) {
      const t = (low + high) / 2;
      const mixed = mix(fg, target, t);
      if (contrastRatio(mixed, bg) >= minRatio) {
        best = mixed;
        high = t;
      } else {
        low = t;
      }
    }
    return best;
  };

  const towardWhite = adjustToward(WHITE);
  const towardBlack = adjustToward(BLACK);
  return contrastRatio(towardWhite, bg) >= contrastRatio(towardBlack, bg)
    ? towardWhite
    : towardBlack;
}

const ensureContrastToward = (
  foreground: string,
  background: string,
  target: string,
  minRatio = 4.5,
) => {
  const fg = safeHex(foreground, LIGHT_TEXT);
  const bg = safeHex(background, DEFAULT_BRAND_INPUTS.widgetBackground);
  const toneTarget = safeHex(target, preferredTone(bg));

  if (contrastRatio(fg, bg) >= minRatio) {
    return fg;
  }

  let low = 0;
  let high = 1;
  let best = mix(fg, toneTarget, 1);

  for (let index = 0; index < 18; index += 1) {
    const weight = (low + high) / 2;
    const candidate = mix(fg, toneTarget, weight);
    if (contrastRatio(candidate, bg) >= minRatio) {
      best = candidate;
      high = weight;
    } else {
      low = weight;
    }
  }

  return best;
};

const harmonizeColor = (
  value: string,
  background: string,
  minRatio = 3,
  fallback = DEFAULT_BRAND_INPUTS.primaryColor,
) => {
  const bg = safeHex(background, DEFAULT_BRAND_INPUTS.widgetBackground);
  const base = safeHex(value, fallback);
  return ensureContrastToward(base, bg, preferredTone(bg), minRatio);
};

export const generateSecondaryColor = (
  primaryColor: string,
  background: string = DEFAULT_BRAND_INPUTS.widgetBackground,
) => {
  const bg = safeHex(background, DEFAULT_BRAND_INPUTS.widgetBackground);
  const safePrimary = harmonizeColor(
    primaryColor,
    bg,
    2.6,
    DEFAULT_BRAND_INPUTS.primaryColor,
  );
  const target = preferredTone(bg);
  return ensureContrastToward(mix(safePrimary, target, 0.22), bg, target, 2.9);
};

export const generatePanelColor = (background: string) => {
  const bg = safeHex(background, DEFAULT_BRAND_INPUTS.widgetBackground);
  const toneTarget = preferredTone(bg);
  const seededPanel = mix(bg, toneTarget, isDarkSurface(bg) ? 0.12 : 0.08);
  return ensureContrastToward(seededPanel, bg, toneTarget, 1.18);
};

export const generateBackgroundSolidColor = () =>
  DEFAULT_BRAND_INPUTS.widgetBackground;

export const generateBorderColor = (background: string) =>
  isDarkSurface(background) ? LIGHT_BORDER_COLOR : DARK_BORDER_COLOR;

export const generateTextPrimaryColor = (background: string) => {
  const bg = safeHex(background, DEFAULT_BRAND_INPUTS.widgetBackground);
  const baseline =
    contrastRatio(LIGHT_TEXT, bg) >= contrastRatio(DARK_TEXT, bg)
      ? LIGHT_TEXT
      : DARK_TEXT;
  return ensureContrast(baseline, bg, 4.5);
};

export const generateTextMutedColor = (
  textPrimary: string,
  background: string,
) => {
  const bg = safeHex(background, DEFAULT_BRAND_INPUTS.widgetBackground);
  const base = mix(
    safeHex(textPrimary, generateTextPrimaryColor(bg)),
    bg,
    0.38,
  );
  return ensureContrast(base, bg, 3.1);
};

export const generateGradientPalette = (
  primaryColor: string,
  accent: string,
) => ({
  gradientStart: darken(mix(primaryColor, accent, 0.16), 0.7),
  gradientEnd: darken(mix(accent, primaryColor, 0.3), 0.82),
});

const generateGlowAccent = (
  accent: string,
  background: string = DEFAULT_BRAND_INPUTS.widgetBackground,
) => {
  const { r, g, b } = hexToRgb(safeHex(accent, DEFAULT_BRAND_INPUTS.accent));
  const alpha = isDarkSurface(background) ? 0.38 : 0.24;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

const generateBadgeBackground = (accent: string, panel: string) => {
  const safePanel = safeHex(
    panel,
    generatePanelColor(DEFAULT_BRAND_INPUTS.widgetBackground),
  );
  const tonedAccent = harmonizeColor(
    accent,
    safePanel,
    2.2,
    DEFAULT_BRAND_INPUTS.accent,
  );
  const base = mix(tonedAccent, safePanel, 0.45);
  return ensureContrastToward(base, safePanel, preferredTone(safePanel), 1.35);
};

const generateLiveColor = (background: string) =>
  harmonizeColor(
    DEFAULT_BRAND_INPUTS.liveColor,
    background,
    2.8,
    DEFAULT_BRAND_INPUTS.liveColor,
  );

const generateShadow = (background: string) =>
  isDarkSurface(background)
    ? '0 22px 64px rgba(0,0,0,0.45)'
    : '0 18px 44px rgba(15,23,42,0.18)';

const directionToCss = (dir?: GradientDirection | null): string => {
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

const resolveEffectiveBackground = (
  mode: BrandingMode,
  backgroundSolid: string,
  gradientStart: string,
  gradientEnd: string,
) =>
  mode === 'gradient' ? mix(gradientStart, gradientEnd, 0.5) : backgroundSolid;

export function generateBrandTokens(
  input: Partial<BrandingInputs> = {},
): BrandingTokens {
  const mode = input.mode === 'gradient' ? 'gradient' : 'solid';
  const primaryColor = safeHex(
    input.primaryColor,
    DEFAULT_BRAND_INPUTS.primaryColor,
  );
  const accent = safeHex(
    input.accent ?? input.primaryColor,
    DEFAULT_BRAND_INPUTS.accent,
  );
  const widgetBackground = safeHex(
    input.widgetBackground,
    DEFAULT_BRAND_INPUTS.widgetBackground,
  );
  const generatedGradient = generateGradientPalette(primaryColor, accent);
  const gradientStart =
    mode === 'gradient'
      ? safeHex(input.gradientStart, generatedGradient.gradientStart)
      : widgetBackground;
  const gradientEnd =
    mode === 'gradient'
      ? safeHex(input.gradientEnd, generatedGradient.gradientEnd)
      : widgetBackground;
  const effectiveBackground = resolveEffectiveBackground(
    mode,
    widgetBackground,
    gradientStart,
    gradientEnd,
  );
  const backgroundCss =
    mode === 'gradient'
      ? `linear-gradient(${directionToCss(input.gradientDirection ?? DEFAULT_BRAND_INPUTS.gradientDirection)}, ${gradientStart}, ${gradientEnd})`
      : widgetBackground;
  const panel = generatePanelColor(effectiveBackground);
  const textPrimary = generateTextPrimaryColor(panel);
  const textMuted = generateTextMutedColor(textPrimary, panel);
  const border = generateBorderColor(panel);
  const badgeBg = generateBadgeBackground(accent, panel);
  const badgeText = generateTextPrimaryColor(badgeBg);

  return {
    mode,
    primaryColor,
    accent,
    widgetBackground,
    liveColor: safeHex(input.liveColor, generateLiveColor(panel)),
    gradientStart,
    gradientEnd,
    gradientDirection:
      input.gradientDirection === 'horizontal' ||
      input.gradientDirection === 'vertical' ||
      input.gradientDirection === 'diagonal' ||
      input.gradientDirection === 'reverse-diagonal'
        ? input.gradientDirection
        : DEFAULT_BRAND_INPUTS.gradientDirection,
    backgroundStart: gradientStart,
    backgroundEnd: gradientEnd,
    backgroundCss,
    effectiveBackground,
    textPrimary,
    textMuted,
    border,
    panel,
    shadow: generateShadow(effectiveBackground),
    glowAccent: generateGlowAccent(accent, effectiveBackground),
    badgeBg,
    badgeText,
  };
}
