import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
  ValidateIf,
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

  @ValidateIf((dto: ControlCommandDto) =>
    ['SET_PLAYER_ALIVE', 'SET_PLAYER_KNOCKED', 'SET_PLAYER_KILLS'].includes(
      dto.type,
    ),
  )
  @IsString()
  @IsNotEmpty()
  playerId?: string;

  @ValidateIf((dto: ControlCommandDto) => dto.type === 'SET_PLAYER_ALIVE')
  @IsBoolean()
  alive?: boolean;

  @ValidateIf((dto: ControlCommandDto) => dto.type === 'SET_PLAYER_KNOCKED')
  @IsBoolean()
  knocked?: boolean;

  @ValidateIf((dto: ControlCommandDto) => dto.type === 'SET_PLAYER_KILLS')
  @IsInt()
  @Min(0)
  kills?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  timestamp?: number;

  @IsOptional()
  @IsString()
  source?: string;
}
