import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';

const DISCORD_SNOWFLAKE_PATTERN = /^\d{15,25}$/;

export class ImportDiscordEventDto {
  @IsOptional()
  @IsString()
  @Matches(DISCORD_SNOWFLAKE_PATTERN, {
    message: 'guildId must be a Discord snowflake',
  })
  guildId?: string | null;

  @IsString()
  @IsNotEmpty()
  @Matches(DISCORD_SNOWFLAKE_PATTERN, {
    message: 'categoryId must be a Discord snowflake',
  })
  categoryId!: string;

  @IsOptional()
  @IsString()
  @Matches(DISCORD_SNOWFLAKE_PATTERN, {
    message: 'slotListChannelId must be a Discord snowflake',
  })
  slotListChannelId?: string | null;

  @IsOptional()
  @IsBoolean()
  importTeams?: boolean;

  @IsOptional()
  @IsString()
  gameKey?: string;
}
