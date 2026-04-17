import { Type } from 'class-transformer';
import { IsString, ValidateNested } from 'class-validator';
import { TournamentRegistrationRosterDto } from './submit-tournament-registration.dto';

export class AcceptTournamentInviteDto {
  @IsString()
  teamName!: string;

  @ValidateNested()
  @Type(() => TournamentRegistrationRosterDto)
  players!: TournamentRegistrationRosterDto;
}
