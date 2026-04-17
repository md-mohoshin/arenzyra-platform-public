import { LicenseStatus, LicenseType } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class UpdateLicenseDto {
  @IsOptional()
  @IsString()
  @MaxLength(191)
  licenseKey?: string;

  @IsOptional()
  @IsEnum(LicenseType)
  type?: LicenseType;

  @IsOptional()
  @IsEnum(LicenseStatus)
  status?: LicenseStatus;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxObservers?: number;

  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}
