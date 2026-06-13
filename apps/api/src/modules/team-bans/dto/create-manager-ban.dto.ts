import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { TeamBanScope } from '@prisma/client';

export class CreateManagerBanDto {
  @IsOptional()
  @IsString()
  teamId?: string | null;

  @IsOptional()
  @IsString()
  discordUserId?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  discordUserIds?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(100)
  discordUsername?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  displayName?: string | null;

  @IsEnum(TeamBanScope)
  scope!: TeamBanScope;

  @IsOptional()
  @IsString()
  sessionId?: string | null;

  @IsOptional()
  @IsString()
  matchId?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  matchIds?: string[];

  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string | null;

  @IsOptional()
  @IsISO8601()
  expiresAt?: string | null;
}
