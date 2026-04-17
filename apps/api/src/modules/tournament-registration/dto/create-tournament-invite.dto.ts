import { IsEmail, IsOptional, IsString } from 'class-validator';

export class CreateTournamentInviteDto {
  @IsEmail()
  contactEmail!: string;

  @IsString()
  stageId!: string;

  @IsOptional()
  @IsString()
  groupId?: string;
}
