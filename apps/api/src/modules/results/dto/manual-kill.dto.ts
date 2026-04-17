import { IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';

export class ManualKillDto {
  @IsString()
  @IsNotEmpty()
  teamId!: string;

  @IsOptional()
  @IsString()
  victimTeamId?: string;

  @IsOptional()
  @IsString()
  killerPlayerId?: string;

  @IsOptional()
  @IsString()
  victimPlayerId?: string;

  @IsOptional()
  @IsString()
  weapon?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  timeSec?: number;

  @IsString()
  @IsNotEmpty()
  reason!: string;
}

export class RevertKillDto {
  @IsString()
  @IsNotEmpty()
  reason!: string;
}
