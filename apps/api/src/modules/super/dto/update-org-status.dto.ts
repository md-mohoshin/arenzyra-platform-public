import { OrganizationStatus } from '@prisma/client';
import { IsEnum } from 'class-validator';

export class UpdateOrgStatusDto {
  @IsEnum(OrganizationStatus)
  status!: OrganizationStatus;
}
