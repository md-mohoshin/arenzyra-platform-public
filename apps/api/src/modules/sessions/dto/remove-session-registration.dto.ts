import { IsOptional, IsString } from 'class-validator';

export class RemoveSessionRegistrationDto {
  @IsOptional()
  @IsString()
  removalReason?: string;

  @IsOptional()
  @IsString()
  note?: string;
}
