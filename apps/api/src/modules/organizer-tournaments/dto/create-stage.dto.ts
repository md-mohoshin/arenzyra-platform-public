import { IsOptional, IsString, IsInt, Min } from 'class-validator';

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
}
