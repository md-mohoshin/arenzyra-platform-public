import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class CreateGroupDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(9999)
  order?: number;

  // Accept alternative client keys for order while whitelisting.
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
  @Max(100)
  maxTeams?: number;

  @IsOptional()
  @IsString()
  notes?: string | null;

  @IsOptional()
  @IsString()
  qualificationRule?: string | null;
}
