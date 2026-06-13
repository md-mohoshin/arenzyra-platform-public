import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

const DISCORD_SNOWFLAKE = /^\d+$/;

export class CompleteDiscordInstallDto {
  @IsString()
  @MaxLength(512)
  state!: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  @Matches(DISCORD_SNOWFLAKE, {
    message: 'guildId must be a Discord snowflake',
  })
  guildId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  @Matches(DISCORD_SNOWFLAKE, {
    message: 'guild_id must be a Discord snowflake',
  })
  guild_id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  permissions?: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  code?: string;
}
