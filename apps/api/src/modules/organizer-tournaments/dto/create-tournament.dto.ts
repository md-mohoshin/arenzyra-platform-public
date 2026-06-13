import {
  IsBoolean,
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateOrganizerTournamentDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsOptional()
  @IsString()
  shortName?: string;

  @IsOptional()
  @IsString()
  game?: string;

  @IsOptional()
  @IsString()
  timezone?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  region?: string;

  @IsDateString()
  @IsNotEmpty()
  startDate!: string;

  @IsDateString()
  @IsNotEmpty()
  endDate!: string;

  @IsOptional()
  @IsString()
  bannerUrl?: string;

  @IsOptional()
  @IsString()
  logoUrl?: string;

  @IsOptional()
  @IsBoolean()
  registrationPaused?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(999)
  qualifiedTeamsCount?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(999)
  qualificationBubbleCount?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  qualificationLabel?: string | null;
}
