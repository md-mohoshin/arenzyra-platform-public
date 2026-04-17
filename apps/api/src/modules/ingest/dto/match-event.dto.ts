import {
  IsEnum,
  IsISO8601,
  IsInt,
  IsObject,
  IsOptional,
  IsUUID,
  Min,
} from 'class-validator';

export enum MatchEventType {
  KILL = 'KILL',
  TEAM_PLACEMENT = 'TEAM_PLACEMENT',
  MATCH_START = 'MATCH_START',
  MATCH_END = 'MATCH_END',
  PLAYER_STATE = 'PLAYER_STATE',
}

export class MatchEventDto {
  @IsUUID()
  event_id!: string;

  @IsUUID()
  match_id!: string;

  @IsInt()
  @Min(0)
  seq!: number;

  @IsEnum(MatchEventType)
  type!: MatchEventType;

  @IsOptional()
  @IsUUID()
  team_id?: string;

  @IsOptional()
  @IsUUID()
  player_id?: string;

  @IsISO8601()
  timestamp!: string;

  @IsOptional()
  @IsObject()
  payload?: Record<string, any>;

  @IsObject()
  raw_payload!: Record<string, any>;
}
