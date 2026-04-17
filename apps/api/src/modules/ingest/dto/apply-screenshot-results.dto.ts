import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
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
}

export class ApplyScreenshotResultsDto {
  @IsString()
  @IsNotEmpty()
  matchId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ApplyScreenshotResultEntryDto)
  results!: ApplyScreenshotResultEntryDto[];
}
