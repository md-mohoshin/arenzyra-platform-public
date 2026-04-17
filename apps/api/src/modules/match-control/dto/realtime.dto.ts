import { IsEnum, IsInt, IsOptional, IsUUID, Min } from 'class-validator';
import { CONTROL_STATES, type ControlState } from './control.dto';

export const MATCH_COMMAND_TYPES = [
  'START_MATCH',
  'SET_STATUS',
  'END_MATCH',
  'SET_FOCUS',
] as const;
export type MatchCommandType = (typeof MATCH_COMMAND_TYPES)[number];

export class JoinMatchRoomDto {
  @IsUUID()
  matchId!: string;
}

export class MatchCommandBaseDto {
  @IsEnum(MATCH_COMMAND_TYPES)
  type!: (typeof MATCH_COMMAND_TYPES)[number];

  @IsUUID()
  matchId!: string;
}

export class StartMatchCommandDto extends MatchCommandBaseDto {
  readonly type = 'START_MATCH';
}

export class EndMatchCommandDto extends MatchCommandBaseDto {
  readonly type = 'END_MATCH';
}

export class SetStatusCommandDto extends MatchCommandBaseDto {
  readonly type = 'SET_STATUS';

  @IsEnum(CONTROL_STATES)
  status!: ControlState;

  @IsOptional()
  @IsInt()
  @Min(0)
  version?: number;
}

export class SetFocusCommandDto extends MatchCommandBaseDto {
  readonly type = 'SET_FOCUS';

  @IsOptional()
  @IsUUID()
  teamId?: string;

  @IsOptional()
  @IsUUID()
  playerId?: string;
}

export type MatchCommandDto =
  | StartMatchCommandDto
  | EndMatchCommandDto
  | SetStatusCommandDto
  | SetFocusCommandDto;
