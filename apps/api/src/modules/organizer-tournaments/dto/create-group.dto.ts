import { IsOptional, IsString, IsInt, Min } from 'class-validator';

export class CreateOrganizerGroupDto {
  @IsString()
  stageId!: string;

  @IsString()
  name!: string;

  @IsOptional()
  @IsInt()
  @Min(2)
  maxTeams?: number;
}
