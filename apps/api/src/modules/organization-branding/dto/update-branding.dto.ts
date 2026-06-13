import {
  IsBoolean,
  IsHexColor,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
} from 'class-validator';
import type {
  BrandingMode,
  GradientDirection,
} from '../../../common/branding/smart-brand-engine';

export class OrganizationBrandingInputDto {
  @IsOptional()
  @IsIn(['minimal', 'advanced'])
  authoringMode?: 'minimal' | 'advanced';

  @IsOptional()
  @IsObject()
  minimalConfig?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  advancedConfig?: Record<string, unknown>;

  @IsOptional()
  @IsIn(['solid', 'gradient'])
  mode?: BrandingMode;

  @IsOptional()
  @IsHexColor()
  widgetBackground?: string;

  @IsOptional()
  @IsHexColor()
  primaryColor?: string;

  @IsOptional()
  @IsHexColor()
  accent?: string;

  @IsOptional()
  @IsHexColor()
  liveColor?: string;

  @IsOptional()
  @IsHexColor()
  gradientStart?: string;

  @IsOptional()
  @IsHexColor()
  gradientEnd?: string;

  @IsOptional()
  @IsIn(['horizontal', 'vertical', 'diagonal', 'reverse-diagonal'])
  gradientDirection?: GradientDirection;

  @IsOptional()
  @IsHexColor()
  backgroundSolid?: string;

  @IsOptional()
  @IsHexColor()
  secondaryColor?: string;

  @IsOptional()
  @IsHexColor()
  textPrimary?: string;

  @IsOptional()
  @IsHexColor()
  textMuted?: string;

  @IsOptional()
  @IsString()
  border?: string;

  @IsOptional()
  @IsHexColor()
  panel?: string;

  @IsOptional()
  @IsString()
  glowAccent?: string;

  @IsOptional()
  @IsString()
  shadow?: string;

  @IsOptional()
  @IsHexColor()
  badgeBg?: string;

  @IsOptional()
  @IsHexColor()
  badgeText?: string;

  @IsOptional()
  @IsString()
  defaultTeamLogoUrl?: string;

  @IsOptional()
  @IsString()
  defaultPlayerPhotoUrl?: string;
}

export class SessionBrandingInputDto extends OrganizationBrandingInputDto {
  @IsOptional()
  @IsBoolean()
  inheritOrganization?: boolean;
}

// Backwards compatibility for existing imports
export { OrganizationBrandingInputDto as UpdateBrandingDto };
