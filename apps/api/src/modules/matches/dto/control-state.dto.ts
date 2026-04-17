import { IsEnum, IsObject, IsOptional, IsString } from 'class-validator';
import {
  CONTROL_STATES,
  type ControlState,
} from '../../match-control/dto/control.dto';

export class SetControlStateDto {
  @IsEnum(CONTROL_STATES)
  state!: ControlState;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsObject()
  meta?: Record<string, unknown>;
}
