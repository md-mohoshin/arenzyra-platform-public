import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

const DISCORD_SNOWFLAKE_PATTERN = /^\d{15,25}$/;

export class UpdateProductionDiscordConfigDto {
  @IsOptional()
  @IsString()
  setKey?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  setIndex?: number | null;

  @IsOptional()
  @IsString()
  setName?: string | null;

  @IsOptional()
  @IsString()
  eventId?: string | null;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsString()
  @Matches(DISCORD_SNOWFLAKE_PATTERN)
  guildId?: string | null;

  @IsOptional()
  @IsString()
  guildName?: string | null;

  @IsOptional()
  @IsString()
  @Matches(DISCORD_SNOWFLAKE_PATTERN)
  categoryId?: string | null;

  @IsOptional()
  @IsString()
  categoryName?: string | null;

  @IsOptional()
  @IsString()
  @Matches(DISCORD_SNOWFLAKE_PATTERN)
  slotsChannelId?: string | null;

  @IsOptional()
  @IsString()
  slotsChannelName?: string | null;

  @IsOptional()
  @IsString()
  @Matches(DISCORD_SNOWFLAKE_PATTERN)
  logosChannelId?: string | null;

  @IsOptional()
  @IsString()
  logosChannelName?: string | null;

  @IsOptional()
  @IsString()
  @Matches(DISCORD_SNOWFLAKE_PATTERN)
  playerPhotosChannelId?: string | null;

  @IsOptional()
  @IsString()
  playerPhotosChannelName?: string | null;

  @IsOptional()
  @IsString()
  @Matches(DISCORD_SNOWFLAKE_PATTERN)
  idpChannelId?: string | null;

  @IsOptional()
  @IsString()
  idpChannelName?: string | null;

  @IsOptional()
  @IsString()
  @Matches(DISCORD_SNOWFLAKE_PATTERN)
  logsChannelId?: string | null;

  @IsOptional()
  @IsString()
  logsChannelName?: string | null;

  @IsOptional()
  @IsString()
  @Matches(DISCORD_SNOWFLAKE_PATTERN)
  controlChannelId?: string | null;

  @IsOptional()
  @IsString()
  controlChannelName?: string | null;

  @IsOptional()
  @IsString()
  @Matches(DISCORD_SNOWFLAKE_PATTERN)
  productionRoleId?: string | null;

  @IsOptional()
  @IsString()
  productionRoleName?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  startSlot?: number | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  normalSlots?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  vipSlots?: number | null;
}

export class CreateProductionDiscordSetDto {
  @IsOptional()
  @IsString()
  eventId?: string | null;
}

export class ImportProductionDiscordSlotsDto {
  @IsOptional()
  @IsString()
  setKey?: string | null;

  @IsString()
  @IsNotEmpty()
  content!: string;

  @IsOptional()
  @IsString()
  @Matches(DISCORD_SNOWFLAKE_PATTERN)
  guildId?: string | null;

  @IsOptional()
  @IsString()
  @Matches(DISCORD_SNOWFLAKE_PATTERN)
  sourceChannelId?: string | null;

  @IsOptional()
  @IsString()
  @Matches(DISCORD_SNOWFLAKE_PATTERN)
  sourceMessageId?: string | null;
}

export class UpsertProductionDiscordTeamDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsOptional()
  @IsString()
  tag?: string | null;

  @IsOptional()
  @IsString()
  @Matches(DISCORD_SNOWFLAKE_PATTERN)
  guildId?: string | null;

  @IsOptional()
  @IsString()
  @Matches(DISCORD_SNOWFLAKE_PATTERN)
  sourceChannelId?: string | null;

  @IsOptional()
  @IsString()
  @Matches(DISCORD_SNOWFLAKE_PATTERN)
  sourceMessageId?: string | null;
}

export class ProductionDiscordFeatureUpdateDto {
  @IsString()
  @IsNotEmpty()
  key!: string;

  @IsBoolean()
  enabled!: boolean;
}

export class UpdateProductionDiscordFeatureDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductionDiscordFeatureUpdateDto)
  features!: ProductionDiscordFeatureUpdateDto[];
}
