import {
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';

export const CONTROL_STATES = [
  'READY',
  'COUNTDOWN',
  'LIVE',
  'FINISH_PENDING',
  'FINISHED',
] as const;
export type ControlState = (typeof CONTROL_STATES)[number];
export type PersistedControlState =
  | ControlState
  | 'COUNTDOWN'
  | 'PAUSED'
  | 'ENDED'
  | 'CONFIRMED';
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

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsObject()
  meta?: Record<string, unknown>;
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
