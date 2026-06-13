import {
  IsOptional,
  IsString,
  IsInt,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateOrganizerStageDto {
  @IsString()
  tournamentId!: string;

  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  type?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  order?: number;

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
