import { IsString, MinLength } from 'class-validator';

export class RejectTournamentRegistrationDto {
  @IsString()
  @MinLength(1)
  reason!: string;
}
