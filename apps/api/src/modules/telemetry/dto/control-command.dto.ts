import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import {
  CONTROL_COMMAND_TYPES,
  type ControlCommandType,
} from '../telemetry.types';

export class ControlCommandDto {
  @IsIn(CONTROL_COMMAND_TYPES)
  type!: ControlCommandType;

  @IsString()
  @IsNotEmpty()
  matchId!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  timestamp?: number;

  @IsOptional()
  @IsString()
  source?: string;
}
