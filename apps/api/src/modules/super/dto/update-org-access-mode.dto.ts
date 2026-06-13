import { OrganizerAccessMode } from '@prisma/client';
import { IsEnum } from 'class-validator';

export class UpdateOrgAccessModeDto {
  @IsEnum(OrganizerAccessMode)
  accessMode!: OrganizerAccessMode;
}
