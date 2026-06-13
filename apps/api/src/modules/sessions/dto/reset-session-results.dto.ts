import { IsOptional, IsString } from 'class-validator';

export class ResetSessionResultsDto {
  @IsOptional()
  @IsString()
  reason?: string;
}
