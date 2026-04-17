import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class TelemetryBindDto {
  @IsString()
  @IsNotEmpty()
  matchId!: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  source?: string;
}
