import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class UpdateGroupDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(9999)
  order?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(9999)
  orderNumber?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(9999)
  position?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(9999)
  sortOrder?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxTeams?: number;

  @IsOptional()
  @IsString()
  notes?: string | null;

  @IsOptional()
  @IsString()
  qualificationRule?: string | null;

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
