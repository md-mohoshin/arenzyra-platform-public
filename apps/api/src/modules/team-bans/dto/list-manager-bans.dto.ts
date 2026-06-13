import { IsBooleanString, IsEnum, IsOptional, IsString } from 'class-validator';
import { TeamBanScope } from '@prisma/client';

export class ListManagerBansDto {
  @IsOptional()
  @IsString()
  discordUserId?: string;

  @IsOptional()
  @IsString()
  sessionId?: string;

  @IsOptional()
  @IsString()
  matchId?: string;

  @IsOptional()
  @IsEnum(TeamBanScope)
  scope?: TeamBanScope;

  @IsOptional()
  @IsBooleanString()
  active?: string;
}
