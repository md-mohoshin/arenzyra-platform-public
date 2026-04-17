import { IsOptional, IsString } from 'class-validator';

export class RegisterSessionTeamDto {
  @IsString()
  teamId!: string;

  @IsOptional()
  @IsString()
  note?: string;
}
