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

  @IsBoolean()
  alive!: boolean;

  @IsBoolean()
  knocked!: boolean;
}

export class UpdateTeamResultsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PlayerResultUpdateDto)
  players!: PlayerResultUpdateDto[];
}
