import {
  IsIn,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MinLength,
} from 'class-validator';
import { KycStatus, OrganizationStatus } from '@prisma/client';

export class CreateOrganizationDto {
  @IsString()
  @MinLength(2)
  name!: string;

  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9-]+$/, {
    message: 'slug must be lowercase letters, numbers, or dashes',
  })
  slug?: string;

  @IsOptional()
  @IsString()
  ownerUserId?: string | null;

  @IsOptional()
  @IsIn(['FULL_PRODUCTION', 'DISCORD_ONLY'])
  accessMode?: 'FULL_PRODUCTION' | 'DISCORD_ONLY';

  @IsOptional()
  @IsString()
  planId?: string | null;

  @IsOptional()
  @IsArray()
  enabledGames?: string[] | null;

  @IsOptional()
  @IsArray()
  enabledAddOns?: string[] | null;

  @IsOptional()
  @IsEnum(OrganizationStatus)
  status?: OrganizationStatus;

  @IsOptional()
  @IsEnum(KycStatus)
  kycStatus?: KycStatus;
}
