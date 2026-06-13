import { IsBooleanString, IsEnum, IsOptional, IsString } from 'class-validator';
import { TeamBanScope } from '@prisma/client';

export class ListTeamBansDto {
  @IsOptional()
  @IsString()
  teamId?: string;

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
