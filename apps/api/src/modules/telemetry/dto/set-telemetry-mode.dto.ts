import { IsIn } from 'class-validator';
import type { TelemetryControlMode } from '../telemetry.types';

const TELEMETRY_CONTROL_MODES = ['AUTO', 'MANUAL', 'HYBRID'] as const;

export class SetTelemetryModeDto {
  @IsIn(TELEMETRY_CONTROL_MODES)
  mode!: TelemetryControlMode;
}
