import { IsEnum, IsOptional } from 'class-validator';
import { SessionRegistrationStatus } from '@prisma/client';

export class ListSessionRegistrationsDto {
  @IsOptional()
  @IsEnum(SessionRegistrationStatus)
  status?: SessionRegistrationStatus;
}
