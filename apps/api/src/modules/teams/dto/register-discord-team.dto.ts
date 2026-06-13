import {
  ArrayMaxSize,
  IsBoolean,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

const DISCORD_SNOWFLAKE_PATTERN = /^\d+$/;

export class DiscordTeamMemberInputDto {
  @IsString()
  @IsNotEmpty()
  @Matches(DISCORD_SNOWFLAKE_PATTERN, {
    message: 'discordUserId must be a Discord snowflake',
  })
  discordUserId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  discordUsername?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  displayName?: string;

  @IsOptional()
  @IsIn(['LEADER', 'PLAYER'])
  role?: 'LEADER' | 'PLAYER';
}

export class RegisterDiscordTeamDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @IsString()
  @IsNotEmpty()
  tag!: string;

  @IsString()
  @IsNotEmpty()
  @Matches(DISCORD_SNOWFLAKE_PATTERN, {
    message: 'leaderDiscordUserId must be a Discord snowflake',
  })
  leaderDiscordUserId!: string;

  @IsOptional()
  @IsString()
  @IsUrl({ require_protocol: true, protocols: ['http', 'https'] })
  @MaxLength(1000)
  logoUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  leaderDiscordUsername?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  leaderDisplayName?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => DiscordTeamMemberInputDto)
  members?: DiscordTeamMemberInputDto[];

  @IsOptional()
  @IsBoolean()
  allowDiscordMemberTransfer?: boolean;

  @IsOptional()
  @IsString()
  @IsUUID()
  contextSessionId?: string;
}
