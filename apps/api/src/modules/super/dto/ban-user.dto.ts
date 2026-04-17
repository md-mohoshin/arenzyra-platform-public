import { IsDateString, IsOptional, IsString } from 'class-validator';

export class SuperBanUserDto {
  @IsOptional()
  @IsDateString()
  bannedUntil?: string | null;

  @IsOptional()
  @IsString()
  reason?: string | null;
}
