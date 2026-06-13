import { SponsorTier } from '@prisma/client';
import { IsEnum, IsOptional, IsString } from 'class-validator';

export class UpdateSessionSponsorDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  logoUrl?: string;

  @IsOptional()
  @IsEnum(SponsorTier)
  tier?: SponsorTier;

  @IsOptional()
  displayOrder?: number | string;

  @IsOptional()
  isActive?: boolean | string;

  @IsOptional()
  rotationIntervalSeconds?: number | string | null;

  @IsOptional()
  @IsString()
  websiteUrl?: string | null;
}
