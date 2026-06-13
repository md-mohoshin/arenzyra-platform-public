import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
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
  MatchResultSource,
  MatchStatus,
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
  @IsBoolean()
  loadTeamsFromEvent?: boolean;

  @IsOptional()
  @IsIn([DataMode.MANUAL])
  dataMode?: DataMode;

  @IsOptional()
  @IsIn([MatchDataSource.MANUAL, MatchDataSource.API])
  dataSource?: MatchDataSource;

  @IsOptional()
  @IsEnum(MatchResultSource)
  resultSource?: MatchResultSource;

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
