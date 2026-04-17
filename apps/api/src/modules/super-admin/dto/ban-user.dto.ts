import { Transform } from 'class-transformer';
import { IsInt, IsOptional, IsString, Min } from 'class-validator';

export class BanUserDto {
  @IsOptional()
  @IsString()
  @Transform(({ value }) =>
    typeof value === 'string'
      ? value.trim().length === 0
        ? undefined
        : value.trim()
      : undefined,
  )
  reason?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  durationDays?: number;
}
