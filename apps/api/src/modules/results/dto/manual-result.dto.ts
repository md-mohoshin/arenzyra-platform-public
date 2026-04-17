import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class ManualResultDto {
  @IsString()
  @IsNotEmpty()
  teamId!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  placementManual?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  killsManual?: number;

  @IsOptional()
  @IsInt()
  pointsManual?: number;

  @IsOptional()
  @IsInt()
  penaltyPoints?: number;

  @IsOptional()
  @IsBoolean()
  isManualOverride?: boolean;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsString()
  @IsNotEmpty()
  reason!: string;
}
