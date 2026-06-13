import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export enum ScreenshotPreviewStatusDto {
  OK = 'OK',
  UNRESOLVED = 'UNRESOLVED',
  AMBIGUOUS = 'AMBIGUOUS',
}

export class ApplyScreenshotPlayerEntryDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  kills!: number;
}

export class ApplyScreenshotResultEntryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  position!: number;

  @IsString()
  @IsNotEmpty()
  tag!: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  kills!: number;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  teamId?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  slotId?: string;

  @IsEnum(ScreenshotPreviewStatusDto)
  status!: ScreenshotPreviewStatusDto;

  @IsOptional()
  @IsString()
  ocrTag?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  playerNames?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  ocrPlayerNames?: string[];

  @IsOptional()
  @IsBoolean()
  edited?: boolean;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ApplyScreenshotPlayerEntryDto)
  players?: ApplyScreenshotPlayerEntryDto[];
}

export class ApplyScreenshotResultsDto {
  @IsString()
  @IsNotEmpty()
  matchId!: string;

  @IsOptional()
  @IsBoolean()
  markMissingSlotsNoShow?: boolean;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ApplyScreenshotResultEntryDto)
  results!: ApplyScreenshotResultEntryDto[];
}
