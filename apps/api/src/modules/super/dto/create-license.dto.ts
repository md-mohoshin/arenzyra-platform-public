import { LicenseStatus, LicenseType } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateLicenseDto {
  @IsString()
  @MaxLength(191)
  licenseKey!: string;

  @IsEnum(LicenseType)
  type!: LicenseType;

  @IsEnum(LicenseStatus)
  status!: LicenseStatus;

  @IsInt()
  @Min(1)
  maxObservers!: number;

  @IsDateString()
  expiresAt!: string;
}
