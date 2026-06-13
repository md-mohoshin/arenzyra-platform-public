import { SponsorTier } from '@prisma/client';
import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateSessionSponsorDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsOptional()
  @IsString()
  logoUrl?: string;

  @IsEnum(SponsorTier)
  tier!: SponsorTier;

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
