import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';

export const CONTROL_STATES = [
  'READY',
  'COUNTDOWN',
  'LIVE',
  'PAUSED',
  'ENDED',
  'CONFIRMED',
] as const;
export type ControlState = (typeof CONTROL_STATES)[number];
// Backward compatibility for legacy imports
export const CONTROL_STATUSES = CONTROL_STATES;
export type ControlStatus = ControlState;

export class SetStatusDto {
  @IsEnum(CONTROL_STATES)
  status!: ControlState;

  @IsOptional()
  @IsInt()
  @Min(0)
  version?: number;
}

export class UpdateScoreDto {
  @IsUUID()
  teamId!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  placement?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  kills?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  version?: number;
}

export class JoinMatchDto {
  @IsString()
  matchId!: string;
}
