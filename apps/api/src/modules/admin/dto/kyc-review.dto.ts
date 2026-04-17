import { IsEnum, IsOptional, IsString } from 'class-validator';
import { KycStatus } from '@prisma/client';

export class KycReviewDto {
  @IsEnum(KycStatus)
  status!: KycStatus;

  @IsOptional()
  @IsString()
  note?: string;
}
