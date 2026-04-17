import { IsOptional, IsString } from 'class-validator';

export class UpdateOrgOwnerDto {
  @IsOptional()
  @IsString()
  ownerUserId?: string | null;
}
