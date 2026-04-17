import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

export class TournamentRegistrationPlayerDto {
  @IsString()
  name!: string;
}

export class TournamentRegistrationRosterDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TournamentRegistrationPlayerDto)
  @ArrayMinSize(4)
  @ArrayMaxSize(4)
  main!: TournamentRegistrationPlayerDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TournamentRegistrationPlayerDto)
  @ArrayMaxSize(2)
  subs?: TournamentRegistrationPlayerDto[];
}

export class SubmitTournamentRegistrationDto {
  @IsString()
  teamName!: string;

  @IsEmail()
  contactEmail!: string;

  @ValidateNested()
  @Type(() => TournamentRegistrationRosterDto)
  players!: TournamentRegistrationRosterDto;
}
