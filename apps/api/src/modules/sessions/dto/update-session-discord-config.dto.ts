import {
  IsArray,
  IsBoolean,
  IsInt,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateSessionDiscordConfigDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsString()
  @IsIn(['USER_TOGGLE'])
  enabledChangeIntent?: 'USER_TOGGLE';

  @IsOptional()
  @IsString()
  @IsIn(['SCRIM', 'EVENT', 'TOURNAMENT'])
  registrationMode?: 'SCRIM' | 'EVENT' | 'TOURNAMENT';

  @IsOptional()
  @IsString()
  guildId?: string | null;

  @IsOptional()
  @IsString()
  categoryId?: string | null;

  @IsOptional()
  @IsString()
  categoryName?: string | null;

  @IsOptional()
  @IsString()
  registrationChannelId?: string | null;

  @IsOptional()
  @IsString()
  registrationChannelName?: string | null;

  @IsOptional()
  @IsString()
  slotListChannelId?: string | null;

  @IsOptional()
  @IsString()
  slotListChannelName?: string | null;

  @IsOptional()
  @IsString()
  waitlistChannelId?: string | null;

  @IsOptional()
  @IsString()
  waitlistChannelName?: string | null;

  @IsOptional()
  @IsString()
  idpChannelId?: string | null;

  @IsOptional()
  @IsString()
  idpChannelName?: string | null;

  @IsOptional()
  @IsString()
  managerChannelId?: string | null;

  @IsOptional()
  @IsString()
  managerChannelName?: string | null;

  @IsOptional()
  @IsString()
  transferChannelId?: string | null;

  @IsOptional()
  @IsString()
  transferChannelName?: string | null;

  @IsOptional()
  @IsString()
  manageChannelId?: string | null;

  @IsOptional()
  @IsString()
  manageChannelName?: string | null;

  @IsOptional()
  @IsString()
  resultsChannelId?: string | null;

  @IsOptional()
  @IsString()
  resultsChannelName?: string | null;

  @IsOptional()
  @IsString()
  screenshotsChannelId?: string | null;

  @IsOptional()
  @IsString()
  screenshotsChannelName?: string | null;

  @IsOptional()
  @IsString()
  bansChannelId?: string | null;

  @IsOptional()
  @IsString()
  bansChannelName?: string | null;

  @IsOptional()
  @IsString()
  logChannelId?: string | null;

  @IsOptional()
  @IsString()
  logChannelName?: string | null;

  @IsOptional()
  @IsString()
  slotRoleId?: string | null;

  @IsOptional()
  @IsString()
  slotRoleName?: string | null;

  @IsOptional()
  @IsString()
  waitlistRoleId?: string | null;

  @IsOptional()
  @IsString()
  waitlistRoleName?: string | null;

  @IsOptional()
  @IsString()
  idpRoleId?: string | null;

  @IsOptional()
  @IsString()
  idpRoleName?: string | null;

  @IsOptional()
  @IsString()
  bannedRoleId?: string | null;

  @IsOptional()
  @IsString()
  bannedRoleName?: string | null;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  registrationRoleIds?: string[] | null;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  specialRegistrationRoleIds?: string[] | null;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  manageRoleIds?: string[] | null;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  vipRoleIds?: string[] | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  startSlot?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  normalSlots?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(20)
  vipSlots?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  maxManagersPerTeam?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  maxTeamsPerManager?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2)
  @Max(4)
  tournamentMainPlayersRequired?: number;

  @IsOptional()
  @IsBoolean()
  tournamentLogoRequired?: boolean;

  @IsOptional()
  @IsString()
  registrationCommand?: string;

  @IsOptional()
  @IsString()
  registrationFormat?: string | null;

  @IsOptional()
  @IsBoolean()
  disableSlotAndVipRegistration?: boolean;

  @IsOptional()
  @IsBoolean()
  slotTeamEmojiEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  downloadPlayerElims?: boolean;

  @IsOptional()
  @IsString()
  spreadsheetId?: string | null;

  @IsOptional()
  @IsObject()
  emojis?: Record<string, string> | null;

  @IsOptional()
  @IsString()
  notes?: string | null;
}
