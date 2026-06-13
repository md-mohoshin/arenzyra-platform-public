import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class PlayerResultUpdateDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  playerId?: string;

  @IsOptional()
  @IsUUID()
  playerResultId?: string;

  @IsNumber()
  @Min(0)
  kills!: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  assists?: number;

  @IsBoolean()
  alive!: boolean;

  @IsBoolean()
  knocked!: boolean;
}

export class UpdateTeamResultsDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  expectedVersion?: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PlayerResultUpdateDto)
  players!: PlayerResultUpdateDto[];
}
