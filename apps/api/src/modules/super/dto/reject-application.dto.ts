import { Transform } from 'class-transformer';
import { IsOptional, IsString, MinLength } from 'class-validator';

export class RejectApplicationDto {
  @IsOptional()
  @IsString()
  @Transform(({ value }) =>
    typeof value === 'string'
      ? value.trim().length === 0
        ? undefined
        : value.trim()
      : undefined,
  )
  @MinLength(1)
  reason?: string;
}
