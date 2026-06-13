import { IsIn } from 'class-validator';
import type { TelemetryControlMode } from '../telemetry.types';

const TELEMETRY_CONTROL_MODES = ['API', 'MANUAL'] as const;

export class SetTelemetryModeDto {
  @IsIn(TELEMETRY_CONTROL_MODES)
  mode!: TelemetryControlMode;
}
