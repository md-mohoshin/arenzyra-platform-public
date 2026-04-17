import { IsInt, IsOptional, IsString, Min } from 'class-validator';

export class BanPlayerDto {
  @IsString()
  reason!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  durationDays?: number;
}
