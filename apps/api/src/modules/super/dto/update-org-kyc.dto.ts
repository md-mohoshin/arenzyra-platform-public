import { KycStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateOrgKycDto {
  @IsEnum(KycStatus)
  kycStatus!: KycStatus;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string | null;
}
