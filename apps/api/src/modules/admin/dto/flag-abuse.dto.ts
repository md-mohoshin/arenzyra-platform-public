import { IsString } from 'class-validator';

export class FlagAbuseDto {
  @IsString()
  reason!: string;
}
