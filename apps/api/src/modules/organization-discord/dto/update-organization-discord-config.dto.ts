import {
  IsBoolean,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

const DISCORD_SNOWFLAKE_OR_EMPTY = /^\d*$/;

export class UpdateOrganizationDiscordConfigDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  @Matches(DISCORD_SNOWFLAKE_OR_EMPTY, {
    message: 'guildId must be a Discord snowflake',
  })
  guildId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  guildName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  @Matches(DISCORD_SNOWFLAKE_OR_EMPTY, {
    message: 'hubCategoryId must be a Discord snowflake',
  })
  hubCategoryId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  hubCategoryName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  @Matches(DISCORD_SNOWFLAKE_OR_EMPTY, {
    message: 'registrationsChannelId must be a Discord snowflake',
  })
  registrationsChannelId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  registrationsChannelName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  @Matches(DISCORD_SNOWFLAKE_OR_EMPTY, {
    message: 'slotsChannelId must be a Discord snowflake',
  })
  slotsChannelId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  slotsChannelName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  @Matches(DISCORD_SNOWFLAKE_OR_EMPTY, {
    message: 'resultsChannelId must be a Discord snowflake',
  })
  resultsChannelId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  resultsChannelName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  @Matches(DISCORD_SNOWFLAKE_OR_EMPTY, {
    message: 'standingsChannelId must be a Discord snowflake',
  })
  standingsChannelId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  standingsChannelName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  @Matches(DISCORD_SNOWFLAKE_OR_EMPTY, {
    message: 'supportChannelId must be a Discord snowflake',
  })
  supportChannelId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  supportChannelName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  @Matches(DISCORD_SNOWFLAKE_OR_EMPTY, {
    message: 'organizerRoleId must be a Discord snowflake',
  })
  organizerRoleId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  organizerRoleName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  @Matches(DISCORD_SNOWFLAKE_OR_EMPTY, {
    message: 'captainRoleId must be a Discord snowflake',
  })
  captainRoleId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  captainRoleName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  @Matches(DISCORD_SNOWFLAKE_OR_EMPTY, {
    message: 'participantRoleId must be a Discord snowflake',
  })
  participantRoleId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  participantRoleName?: string;

  @IsOptional()
  @IsBoolean()
  autoCreateSessionCategories?: boolean;

  @IsOptional()
  @IsBoolean()
  autoCreateSessionChannels?: boolean;

  @IsOptional()
  @IsBoolean()
  autoSyncRoles?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  sessionCategoryPrefix?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  sessionChannelPrefix?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
