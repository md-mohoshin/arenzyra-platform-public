import { OrganizationSubscriptionStatus } from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsISO8601,
  IsOptional,
  ValidateIf,
} from 'class-validator';

export class UpdateOrgSubscriptionDto {
  @IsEnum(OrganizationSubscriptionStatus)
  subscriptionStatus!: OrganizationSubscriptionStatus;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsISO8601()
  trialEndsAt?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsISO8601()
  paidUntil?: string | null;

  @IsOptional()
  @IsBoolean()
  restartTrial?: boolean;
}
