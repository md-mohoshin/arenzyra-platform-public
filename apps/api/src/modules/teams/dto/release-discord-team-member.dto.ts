import { IsNotEmpty, IsString, Matches } from 'class-validator';

const DISCORD_SNOWFLAKE_PATTERN = /^\d+$/;

export class ReleaseDiscordTeamMemberDto {
  @IsString()
  @IsNotEmpty()
  @Matches(DISCORD_SNOWFLAKE_PATTERN, {
    message: 'discordUserId must be a Discord snowflake',
  })
  discordUserId!: string;
}
