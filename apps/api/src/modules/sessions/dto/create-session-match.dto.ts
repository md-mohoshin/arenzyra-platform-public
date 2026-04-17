import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  DataMode,
  MatchDataSource,
  MatchStatus,
  PcobStatus,
} from '@prisma/client';

export class CreateSessionMatchDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  map?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  slotCount?: number;

  @IsOptional()
  @IsBoolean()
  recallEnabled?: boolean;

  @IsOptional()
  @IsEnum(DataMode)
  dataMode?: DataMode;

  @IsOptional()
  @IsEnum(MatchDataSource)
  dataSource?: MatchDataSource;

  @IsOptional()
  @IsEnum(PcobStatus)
  pcobStatus?: PcobStatus;

  @IsOptional()
  @IsString()
  pcobSessionId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  matchNumber?: number;

  @IsOptional()
  @IsString()
  gameId?: string;

  @IsOptional()
  @IsString()
  gameKey?: string;

  @IsOptional()
  @IsString()
  rulesetId?: string;

  @IsOptional()
  @IsString()
  adapterKey?: string;

  @IsOptional()
  @IsEnum(MatchStatus)
  status?: MatchStatus;

  @IsOptional()
  @IsDateString()
  scheduledAt?: string;

  @IsOptional()
  @IsDateString()
  startAt?: string;

  @IsOptional()
  @IsDateString()
  endsAt?: string;
}
