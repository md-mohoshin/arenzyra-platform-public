import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import { KycStatus } from '@prisma/client';

export class UpdateOrgConfigDto {
  @IsOptional()
  @IsString()
  @Transform(({ value }) =>
    typeof value === 'string'
      ? value.trim().length === 0
        ? undefined
        : value.trim()
      : undefined,
  )
  @MinLength(2)
  name?: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) =>
    typeof value === 'string'
      ? value.trim().length === 0
        ? undefined
        : value.trim()
      : undefined,
  )
  @MinLength(2)
  slug?: string;

  @IsOptional()
  @IsEnum(KycStatus)
  kycStatus?: KycStatus;

  @IsOptional()
  @IsString()
  @Transform(({ value }) =>
    typeof value === 'string'
      ? value.trim().length === 0
        ? undefined
        : value.trim()
      : undefined,
  )
  @MinLength(3)
  kycNote?: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) =>
    typeof value === 'string'
      ? value.trim().length === 0
        ? undefined
        : value.trim()
      : undefined,
  )
  @MinLength(1)
  reason?: string;
}
