import { IsInt, IsOptional, IsString, Min } from 'class-validator';

export class GenerateMatchesDto {
  @IsInt()
  @Min(1)
  count!: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  startFromMatchNumber?: number;

  @IsOptional()
  @IsString()
  scheduleStartAt?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  intervalMinutes?: number;
}
