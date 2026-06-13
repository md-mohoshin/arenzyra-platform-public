import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
} from 'class-validator';

export enum RegisterSessionTeamPlacement {
  NORMAL = 'NORMAL',
  VIP = 'VIP',
}

export class RegisterSessionTeamDto {
  @IsString()
  teamId!: string;

  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  @IsBoolean()
  bypassRegistrationWindow?: boolean;

  @IsOptional()
  @IsEnum(RegisterSessionTeamPlacement)
  placement?: RegisterSessionTeamPlacement;

  @IsOptional()
  @IsString()
  leaderDiscordUserId?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  managerDiscordUserIds?: string[];

  @IsOptional()
  @IsObject()
  tournamentRosterJson?: Record<string, unknown>;
}
