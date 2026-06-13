import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { TeamBanScope } from '@prisma/client';

export class NoShowTeamBansDto {
  @IsString()
  sessionId!: string;

  @IsOptional()
  @IsString()
  matchId?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  matchNumber?: number | null;

  @IsOptional()
  @IsEnum(TeamBanScope)
  scope?: TeamBanScope;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string | null;

  @IsOptional()
  @IsISO8601()
  expiresAt?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  teamIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(250)
  @IsString({ each: true })
  managerDiscordUserIds?: string[];
}
