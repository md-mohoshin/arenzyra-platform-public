import { IsString } from 'class-validator';

export class WarnPlayerDto {
  @IsString()
  reason!: string;
}
