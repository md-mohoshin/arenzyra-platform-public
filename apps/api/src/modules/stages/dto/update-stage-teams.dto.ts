import { ArrayUnique, IsArray, IsString } from 'class-validator';

export class UpdateStageTeamsDto {
  @IsArray()
  @IsString({ each: true })
  @ArrayUnique()
  tournamentTeamIds!: string[];
}
