import { IsOptional, IsString, MaxLength } from 'class-validator';

export class RevokeTeamBanDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string | null;
}
