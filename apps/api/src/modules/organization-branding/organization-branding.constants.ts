import {
  DEFAULT_BRAND_INPUTS,
  generateBrandTokens,
  type BrandingInputs,
  type BrandingMode,
  type BrandingTokens,
  type GradientDirection,
} from '../../common/branding/smart-brand-engine';

export type BrandingAuthoringMode = 'minimal' | 'advanced';
export type MinimalPanelMode = 'auto' | 'custom';

export type MinimalBrandingConfig = {
  mode: BrandingMode;
  primaryColor: string;
  accent: string;
  backgroundSolid: string;
  gradientStart: string;
  gradientEnd: string;
  gradientDirection: GradientDirection;
  panelMode: MinimalPanelMode;
  panelColor: string;
};

export type AdvancedBrandingConfig = Partial<BrandingInputs> & {
  backgroundSolid?: string | null;
  secondaryColor?: string | null;
  textPrimary?: string | null;
  textMuted?: string | null;
  border?: string | null;
  panel?: string | null;
  shadow?: string | null;
  glowAccent?: string | null;
  badgeBg?: string | null;
  badgeText?: string | null;
};

export type OrganizationBrandingInput = Partial<BrandingInputs> & {
  organizationId?: string | null;
  backgroundSolid?: string | null;
  secondaryColor?: string | null;
  textPrimary?: string | null;
  textMuted?: string | null;
  border?: string | null;
  panel?: string | null;
  shadow?: string | null;
  glowAccent?: string | null;
  badgeBg?: string | null;
  badgeText?: string | null;
  defaultTeamLogoUrl?: string | null;
  defaultPlayerPhotoUrl?: string | null;
  authoringMode?: BrandingAuthoringMode | null;
  minimalConfig?: MinimalBrandingConfig | null;
  advancedConfig?: AdvancedBrandingConfig | null;
};

export type OrganizationBrandingDto = BrandingTokens & {
  organizationId?: string | null;
  backgroundSolid: string;
  secondaryColor: string;
  defaultTeamLogoUrl: string | null;
  defaultPlayerPhotoUrl: string | null;
  authoringMode: BrandingAuthoringMode;
  minimalConfig: MinimalBrandingConfig;
  advancedConfig: AdvancedBrandingConfig;
};

export type SessionBrandingDto = OrganizationBrandingDto & {
  sessionId: string;
  inheritOrganization: boolean;
  source: 'organization' | 'session';
};

export { BrandingMode, GradientDirection };

export const DEFAULT_ORGANIZATION_BRANDING_INPUT: BrandingInputs = {
  ...DEFAULT_BRAND_INPUTS,
};

export const DEFAULT_MINIMAL_BRANDING_CONFIG: MinimalBrandingConfig = {
  mode: DEFAULT_BRAND_INPUTS.mode,
  primaryColor: DEFAULT_BRAND_INPUTS.primaryColor,
  accent: DEFAULT_BRAND_INPUTS.accent,
  backgroundSolid: DEFAULT_BRAND_INPUTS.widgetBackground,
  gradientStart: DEFAULT_BRAND_INPUTS.gradientStart,
  gradientEnd: DEFAULT_BRAND_INPUTS.gradientEnd,
  gradientDirection: DEFAULT_BRAND_INPUTS.gradientDirection,
  panelMode: 'auto',
  panelColor: generateBrandTokens(DEFAULT_ORGANIZATION_BRANDING_INPUT).panel,
};

export const DEFAULT_ADVANCED_BRANDING_CONFIG: AdvancedBrandingConfig = {
  mode: DEFAULT_BRAND_INPUTS.mode,
  primaryColor: DEFAULT_BRAND_INPUTS.primaryColor,
  accent: DEFAULT_BRAND_INPUTS.accent,
  liveColor: DEFAULT_BRAND_INPUTS.liveColor,
  backgroundSolid: DEFAULT_BRAND_INPUTS.widgetBackground,
  gradientStart: DEFAULT_BRAND_INPUTS.gradientStart,
  gradientEnd: DEFAULT_BRAND_INPUTS.gradientEnd,
  gradientDirection: DEFAULT_BRAND_INPUTS.gradientDirection,
  secondaryColor: '#0093FF',
  textPrimary: '#ffffff',
  textMuted: '#cdd5e1',
  border: 'rgba(255,255,255,0.12)',
  panel: '#0b1220',
  shadow: '0 22px 64px rgba(0,0,0,0.45)',
  glowAccent: 'rgba(0,229,255,0.32)',
  badgeBg: '#142032',
  badgeText: '#ffffff',
};

export const DEFAULT_ORGANIZATION_BRANDING: OrganizationBrandingDto = {
  ...generateBrandTokens(DEFAULT_ORGANIZATION_BRANDING_INPUT),
  organizationId: null,
  backgroundSolid: DEFAULT_BRAND_INPUTS.widgetBackground,
  secondaryColor: '#0093FF',
  defaultTeamLogoUrl: null,
  defaultPlayerPhotoUrl: null,
  authoringMode: 'minimal',
  minimalConfig: DEFAULT_MINIMAL_BRANDING_CONFIG,
  advancedConfig: DEFAULT_ADVANCED_BRANDING_CONFIG,
};
