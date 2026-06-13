import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

const DISCORD_SNOWFLAKE = /^\d+$/;

export class MarkDiscordGuildRemovedDto {
  @IsString()
  @MaxLength(32)
  @Matches(DISCORD_SNOWFLAKE, {
    message: 'guildId must be a Discord snowflake',
  })
  guildId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  guildName?: string | null;
}
